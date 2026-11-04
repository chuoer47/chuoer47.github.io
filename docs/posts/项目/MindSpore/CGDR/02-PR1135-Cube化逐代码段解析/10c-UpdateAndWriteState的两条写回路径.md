# 10c · UpdateAndWriteState：一次算、两条出口写（2290-2410）

> 本篇是 1918-2410 这段的第三块。拆分过程：1918-2410 单文件必然超 700 行，
> 先在 `ComputeStateUpdateCubeDispatch`（`:2094`）处切出 10 章（1918-2093）/10b 章（2094-2289），
> 10b 章含正文仍达 587 行，再接着在 `UpdateAndWriteState`（`:2292`）这个函数边界切出本篇（2290-2410）。
> 三篇合起来对 1918-2410 **逐行全覆盖、无缺口**。
> 正文所有代码块由 `sed -n 'A,Bp' src/d0906c3e/op_kernel/chunk_gated_delta_rule.h` 逐字切出，
> 段内省略以单独一行 `  ...` 标示。文中 `10b §n` 指 `10b-StateUpdateCube与finalState写回.md` 的第 n 节。

## 0. 结论先行

锚点：chunk_gated_delta_rule.h:2290-2410（本篇）

1. **`UpdateAndWriteState` 自己不做乘法**，它只做三件事：
   按 `IsCubeFastPath` 分派（`:2295-2296`）或走 Vector fallback（`:2297-2316`）；
   非末块把 FP32 结果写进 workspace 并 `return`（`:2320-2344`）；
   末块 Cast 成 FP16、转置、写 `final_state`（`:2347-2407`）。
   **10b 章全部篇幅（`:2100-2289`）都是它的被调方。**
2. **三条出口互斥且都必须存在**：Cube 计算 → FP32 workspace（中间块）、
   Cube 计算 → FP16 `final_state` 转置快写（末块、16 对齐）、
   标量逐元素 `SetValue`（末块、守卫失败）。
   `:2398-2406` 的兜底不是死代码，`dk` 非 16 倍数、`curV ≠ vStepAligned_` 且桶 0 时唯一可行。
3. **"跨 chunk 保持 FP32"是 !1135 与前作共同的既有约束**，注释 `:2317-2319`
   把它写成了三条理由（误差累积 / 结果依赖 chunk_size），本篇 §2 逐行核对
   `DataCopyParams` 的双向 gap 如何做到"一条指令搬完整块"。
4. **`transposeCapacity` 的系数 2 是 fp32→fp16 的元素翻倍，128 桶代入后是"恰好相等"**
   （`128*128 = 2*64*128 = 16384`），不是留一倍余量；推导见 §3。
5. **快慢两条写回路径写出的字节序列必须逐位相同**（`:2392` 与 `:2402` 同一偏移式、
   `:2393` 的裁剪长度与 `:2401-2404` 的循环范围一致），
   这是"守卫只挑性能、不改语义"的可验证锚点，也是 03 章 Bug 清单里的回归点。
6. 本篇还留了一个结构性事实：**`stateOutQueue_` 的 `EnQue` 立刻 `DeQue`（`:2354-2355`）
   是仓库里最便宜的跨管栅栏**，`StageHalf:1585-1586` 用的是同一招；
   它同时完成"UB 槽位换主"，所以 `BUFFER_NUM=1` 的单槽队列没有被浪费。
## 1. UpdateAndWriteState 的分派与 Vector fallback

锚点：chunk_gated_delta_rule.h:2290-2316

```cpp

  // Step 7: decay state, add (K * exp(gLast - g))^T @ v_new, then write the state tile back to GM.
  __aicore__ inline void UpdateAndWriteState(int32_t t_start, uint32_t chunkLen, uint32_t v_i, uint32_t curV,
                                             uint64_t qkHead, uint64_t stateBaseOffset,
                                             uint64_t workspaceStateBaseOffset, uint32_t avFp32, bool isLastChunk) {
    if (likely(IsCubeFastPath(chunkLen, avFp32))) {
      ComputeStateUpdateCubeDispatch(t_start, qkHead);
    } else {
      float gLastExp = expGCumFp32.GetValue(chunkLen - 1);
      for (uint32_t d = 0; d < realK_; d++) {
        LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
        Muls(stRow, stRow, gLastExp, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
      for (uint32_t i = 0; i < chunkLen; i++) {
        int32_t t = t_start + i;
        uint64_t qkOff = (static_cast<uint64_t>(t) * NK_ + qkHead) * realK_;
        float diffExp = ScalarExp(gCumsumFp32.GetValue(chunkLen - 1) - gCumsumFp32.GetValue(i));
        LocalTensor<float> vRow = chunkVFp32[i * avFp32];
        for (uint32_t d = 0; d < realK_; d++) {
          float coeff = static_cast<float>(keyGm_.GetValue(qkOff + d)) * diffExp;
          LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
          Axpy(stRow, vRow, coeff, vStepAligned_);
          PipeBarrier<PIPE_V>();
        }
      }
    }
```

- `:2290` 空行；`:2291` Step 7 的单行注释（与 10 章 `:2089-2093` 的五行块不重复，
  这行是 `UpdateAndWriteState` 自己的：`decay state, add (...)^T @ v_new, then write the state tile back to GM`，
  **明确"本函数负责写回 GM"，Cube 函数只负责算**）。
- `:2292-2294` 9 参数签名：`t_start, chunkLen, v_i, curV, qkHead, stateBaseOffset,
  workspaceStateBaseOffset, avFp32, isLastChunk`。
  与 `:1327-1328` 调用点逐一对应；`v_i/curV` 是 V-tile 维度的切分位置，
  `stateBaseOffset` 指向 `final_state`/`initial_state` 的 `[B,Nv,Dv,Dk]` 展平基址，
  `workspaceStateBaseOffset` 指向内部 FP32 workspace（`:690/:704` 算好传入）。
- `:2295` `if (likely(IsCubeFastPath(chunkLen, avFp32)))`：谓词在 `:257-262`，
  四个条件 `realK_ <= kSpecializedDk && chunkLen == 64 && vStepAligned_ == kSpecializedDk && avFp32 == kSpecializedDk`。
  **`likely` 是给编译器的分支布局提示，不影响语义**。
- `:2296` 进 Cube；`:2297` `else`。
- `:2298` `gLastExp = expGCumFp32.GetValue(chunkLen - 1)`：fallback 用**运行期**长度。
- `:2299-2303` 逐 `d` 衰减 state：`realK_` 条 `Muls`，每条长 `vStepAligned_`。
  对照 Cube 路径 `:2123` 的**一条** `Muls(kStateElements)`。
- `:2304-2315` 双重循环：外层 64 个 token（`:2304`），
  `:2307` `ScalarExp(gCumsumFp32.GetValue(chunkLen-1) - gCumsumFp32.GetValue(i))`
  —— **标量管 8 项泰勒展开**（`:364-385`，项数常数 `kExpTaylorTerms` 见 `:40-41`）；
  `:2310` `keyGm_.GetValue(qkOff+d)` **逐元素读 GM**；
  `:2312` `Axpy(stRow, vRow, coeff, vStepAligned_)` 原地累加。
  **成本：`chunkLen*realK_ = 64*128 = 8192` 次标量 GM 读 + 8192 条 Axpy + 64 次标量 Exp**。
  这正是 `:2332`（Cube 路径的 `DataCopy`）与 `:2393`（一次转置+一条 DataCopy）省掉的东西。
- `:2316` 结束 else。

## 2. 非末块：FP32 workspace 写回（双向 gap 的一条 DataCopy）

锚点：chunk_gated_delta_rule.h:2317-2345

```cpp
    // Preserve the state in FP32 between chunks. Casting to final_state (FP16)
    // after every chunk accumulates quantization error and makes the result
    // depend on chunk_size.
    if (!isLastChunk) {
      PipeBarrier<PIPE_ALL>();
      event_t vectorToMte3 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE3));
      SetFlag<HardEvent::V_MTE3>(vectorToMte3);
      WaitFlag<HardEvent::V_MTE3>(vectorToMte3);
      uint32_t alignedV = Ceil(curV, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
      if constexpr (kSpecializedDk != 0) {
        uint16_t rowBlocks = static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK);
        uint16_t srcGapBlocks = static_cast<uint16_t>((vStepAligned_ - alignedV) / FP32_NUM_PER_BLOCK);
        uint16_t dstGapBlocks = static_cast<uint16_t>((stateWorkspaceStrideV_ - alignedV) / FP32_NUM_PER_BLOCK);
        DataCopyParams stateParams{static_cast<uint16_t>(realK_), rowBlocks, srcGapBlocks, dstGapBlocks};
        uint64_t rowOff = workspaceStateBaseOffset + v_i;
        DataCopy(stateWorkspaceGm_[rowOff], stateInFp32, stateParams);
      } else {
        DataCopyParams stateParams{1, static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK), 0, 0};
        for (uint32_t d = 0; d < realK_; d++) {
          uint64_t rowOff = workspaceStateBaseOffset + static_cast<uint64_t>(d) * stateWorkspaceStrideV_ + v_i;
          DataCopy(stateWorkspaceGm_[rowOff], stateInFp32[d * vStepAligned_], stateParams);
        }
      }
      PipeBarrier<PIPE_ALL>();
      event_t mte3ToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE3_MTE2));
      SetFlag<HardEvent::MTE3_MTE2>(mte3ToMte2);
      WaitFlag<HardEvent::MTE3_MTE2>(mte3ToMte2);
      return;
    }
```

- `:2317-2319` 三行注释是全章的"设计说明"：**跨 chunk 保持 FP32，只在末块 Cast 成 FP16；
  否则量化误差逐块累积、结果依赖 chunk_size**。这条正是 recurrent 参考实现踩过的坑。
- `:2320` `if (!isLastChunk)`。`:2321` `PipeBarrier<PIPE_ALL>()`：V 刚改完 state，
  MTE3 要读它 —— **注意 !1135 在这里用 `PIPE_ALL` 而不是 `V_MTE3` 事件**（下面 `:2322-2324` 又补了一对），
  属于双保险。
- `:2322-2324` `V_MTE3` 成对事件。
- `:2325` `alignedV = Ceil(curV, FP32_NUM_PER_BLOCK)*FP32_NUM_PER_BLOCK`：目的行宽按 8 个 FP32（32 B）对齐。
- `:2326` `if constexpr (kSpecializedDk != 0)` → 桶化快路径：
  - `:2327` `rowBlocks = alignedV/8`
  - `:2328` `srcGapBlocks = (vStepAligned_ - alignedV)/8`：**源（UB）行内 padding 的块数**
  - `:2329` `dstGapBlocks = (stateWorkspaceStrideV_ - alignedV)/8`：**目的（GM）行 stride 与有效长度之差**
  - `:2330` `DataCopyParams stateParams{realK_, rowBlocks, srcGapBlocks, dstGapBlocks}`：
    字段顺序在本仓库固定为 `{repeatTimes, blockLen, srcStride, dstStride}`（块单位，32 B），
    证明见 `CopyToGm:49-50` 与 `LoadPaddedRows:289-291`。
    `repeatTimes = realK_` → **一条指令搬完 dk 行**。
  - `:2331` `rowOff = workspaceStateBaseOffset + v_i`；`:2332` `DataCopy(stateWorkspaceGm_[rowOff], stateInFp32, stateParams)`。
    典型形状（dv=128、vStep=128、dk=128）：`rowBlocks = 16`、`srcGap = dstGap = 0`，
    一次搬 `128*16*32 = 65536 B` = `stateInFp32` 全部 16384 个 FP32 ✓ 与 `kStateElements` 一致。
  - `:2333-2338` 桶 0（纯 Vector）：**逐 d 一次 DataCopy**，`realK_` 条指令，
    `stateParams{1, alignedV/8, 0, 0}`；行偏移 `d*stateWorkspaceStrideV_ + v_i`。
    **快慢两条路径写的是同一块 GM 布局**，这保证 fallback 与 Cube 的结果可逐位比对。
- `:2340` `PipeBarrier<PIPE_ALL>()` + `:2341-2343` `MTE3_MTE2` 成对：
  **出站 DMA 完成之后才允许下一块的 MTE2 入站读同一块 workspace**，
  否则下一 chunk 的 `LoadStateTile:1447` 会读到半新半旧的状态。
- `:2344` `return`；`:2345` 空行。

## 3. 末块：FP32→FP16 与转置容量算术（含 128 桶算例）

锚点：chunk_gated_delta_rule.h:2346-2373

```cpp

    // Only the final chunk is cast to the public FP16 final_state output.
    uint32_t alignedElem = stateStrideK_ * vStepAligned_;
    Muls(stateInFp32, stateInFp32, 1.0f, alignedElem);
    PipeBarrier<PIPE_V>();
    LocalTensor<outType> stateLocal = stateOutQueue_.AllocTensor<outType>();
    Cast(stateLocal, stateInFp32, RoundMode::CAST_NONE, alignedElem);
    PipeBarrier<PIPE_V>();
    stateOutQueue_.EnQue<outType>(stateLocal);
    stateLocal = stateOutQueue_.DeQue<outType>();

    // The public final_state is [B, Nv, Dv, Dk], while stateLocal is the
    // internal [Dk, vStep] tile. For aligned full tiles, transpose in Vector
    // and write one contiguous block instead of performing scalar GM stores.
    constexpr uint32_t kTransposeBlock = 16;
    uint32_t kBlockCount = realK_ / kTransposeBlock;
    uint32_t vBlockCount = curV / kTransposeBlock;
    uint32_t stateElementCount = realK_ * curV;
    bool supportedVTile = curV == vStepAligned_;
    if constexpr (kSpecializedDk != 0) {
      vBlockCount = vStepAligned_ / kTransposeBlock;
      stateElementCount = realK_ * vStepAligned_;
      supportedVTile = true;
    }
    uint32_t outputStateElementCount = realK_ * curV;
    uint32_t transposeCapacity = 2 * chunkSize_ * alignK_;
    if (likely(realK_ % kTransposeBlock == 0 && vStepAligned_ % kTransposeBlock == 0 && supportedVTile &&
               vBlockCount <= UINT8_MAX && stateElementCount <= transposeCapacity)) {
```

- `:2346` 空行注释前的一行；`:2347` 注释 `Only the final chunk is cast to the public FP16 final_state output.`
- `:2348` `alignedElem = stateStrideK_ * vStepAligned_`：`stateStrideK_ == alignK_`（`:92`），
  所以这是"**含 padding 的整块 state 元素数**"。
- `:2349` `Muls(stateInFp32, stateInFp32, 1.0f, alignedElem)`：**乘 1 的空操作，目的是把 padding 区
  也过一遍 V 管**，让 `:2352` 的 Cast 覆盖整块、结果确定（同一手法见 `:795/:805/:905/:1233`）。
- `:2351` 从队列取 `outType` 板；`:2352` `Cast(stateLocal, stateInFp32, CAST_NONE, alignedElem)`；
  `:2353` V 栅栏。
- `:2354-2355` `EnQue` 后立即 `DeQue`：**这是"用队列当跨管栅栏"的写法**
  （`VECOUT` 队列的入队/出队隐含 MTE3/V 与 UB 槽位的归属交接），
  比手写 `PipeBarrier<PIPE_ALL>` 便宜，并且同时完成了"槽位换主"。
  与 `StageHalf:1585-1586` 同一模式。
- `:2357-2359` 注释：**对外 `final_state` 是 `[B, Nv, Dv, Dk]`，对内 tile 是 `[Dk, vStep]`**，
  所以对齐鲁棒时"转置 + 一次连续写"替代逐元素标量写。
- `:2360` `kTransposeBlock = 16`（fractal 边长）；`:2361` `kBlockCount = realK_/16`；
  `:2362` `vBlockCount = curV/16`；`:2363` `stateElementCount = realK_*curV`；
  `:2364` `supportedVTile = (curV == vStepAligned_)`。
- `:2365-2369` **桶化快路径放宽**：`vBlockCount = vStepAligned_/16`、
  `stateElementCount = realK_*vStepAligned_`、`supportedVTile = true`。
  即**桶内允许尾块 `curV < vStepAligned_`**：padding 列照样转置，最后按 `outputStateElementCount`
  （`:2370`，仍用真实 `curV`）截断写出。这是"桶内固定形状 + 出口裁剪"的通用套路。
- `:2371` `transposeCapacity = 2 * chunkSize_ * alignK_`：**为什么是 2？**
  `:2374` 的落地板 `stateTransposed` 借的是 `kCumdecayFp32`，
  它的声明容量是 `chunkSize_*alignK_` 个 **FP32**（`:164`），
  按 `outType = half` 复述就变成 `2*chunkSize_*alignK_` 个 half。
  **系数 2 是元素翻倍的算术结果，不是安全余量**。
- `:2372-2373` 四条件 `likely` 守卫：
  `realK_%16==0 && vStepAligned_%16==0 && supportedVTile && vBlockCount <= UINT8_MAX && stateElementCount <= transposeCapacity`
  （`vBlockCount <= UINT8_MAX` 与 `:1479` 的 `kBlockCount <= UINT8_MAX` **不同**，
  因为两个方向的 `repeatTimes` 取自不同维度，见 §4）。
  **128 桶 + B=1,H=16,T=128,dk=dv=128 的逐项代入**：

  | 量 | 表达式 | 值 | 判定 |
  | --- | --- | --- | --- |
  | `realK_ % 16` | 128 % 16 | 0 | ✓ |
  | `vStepAligned_ % 16` | 128 % 16 | 0 | ✓ |
  | `supportedVTile` | `:2368` 强制 | true | ✓ |
  | `vBlockCount` | 128/16 | 8 | ≤255 ✓ |
  | `stateElementCount` | 128·128 | 16384 half = 32768 B | 需 ≤ capacity |
  | `transposeCapacity` | 2·64·128 | 16384 half = 32768 B | **16384 ≤ 16384，贴边相等** |
  | `alignedElem`（`:2348`） | 128·128 | 16384 float | = `stateInFp32` 容量 ✓ |
  | 队列容量（`:139-142`） | max(128·128·2, 64·128·2) | 32768 B | = `alignedElem` 字节数 ✓ |

  80 桶：`stateElementCount = 80·80 = 6400`，`transposeCapacity = 2·64·80 = 10240` ✓ 有余量。
  **结论：128 桶是四桶里唯一"刚好塞满"的，任何一次把 kCumdecay 换小的改动都会立刻打穿这条守卫。**

## 4. 转置与一次连续 GM 写

锚点：chunk_gated_delta_rule.h:2374-2396

```cpp
      LocalTensor<outType> stateTransposed = kCumdecayFp32.template ReinterpretCast<outType>();
      TransDataTo5HDParams transposeParams;
      transposeParams.repeatTimes = static_cast<uint8_t>(vBlockCount);
      transposeParams.srcRepStride = (vBlockCount == 1) ? 0 : 1;
      transposeParams.dstRepStride = (vBlockCount == 1) ? 0 : realK_;
      for (uint32_t block = 0; block < kBlockCount; block++) {
        LocalTensor<outType> srcRows[kTransposeBlock];
        LocalTensor<outType> dstRows[kTransposeBlock];
        for (uint32_t row = 0; row < kTransposeBlock; row++) {
          srcRows[row] = stateLocal[block * kTransposeBlock * vStepAligned_ + row * vStepAligned_];
          dstRows[row] = stateTransposed[block * kTransposeBlock + row * realK_];
        }
        TransDataTo5HD<outType>(dstRows, srcRows, transposeParams);
      }
      PipeBarrier<PIPE_V>();
      event_t vectorToMte3 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE3));
      SetFlag<HardEvent::V_MTE3>(vectorToMte3);
      WaitFlag<HardEvent::V_MTE3>(vectorToMte3);
      uint64_t stateOffset = stateBaseOffset + static_cast<uint64_t>(v_i) * realK_;
      DataCopy(finalStateGm_[stateOffset], stateTransposed, outputStateElementCount);
      stateOutQueue_.FreeTensor(stateLocal);
      return;
    }
```

- `:2374` `stateTransposed = kCumdecayFp32.ReinterpretCast<outType>()`：**第三次借 kCumdecay**
  （10b §4 的转置板、10 章 `:2041` 的 `cNz`、此处 `final_state` 转置板）。
- `:2375-2378` 转置参数：
  `repeatTimes = vBlockCount`（**沿源矩阵的列方向铺开 16 列块**，所以 uint8 上界约束的是 `curV/16`，
  与 `LoadStateTile:1499` 的 `repeatTimes = kBlockCount`（约束 `realK_/16`）方向相反，
  这正是两处 `UINT8_MAX` 守卫字段不同的原因）；
  `srcRepStride = (vBlockCount==1) ? 0 : 1`（源每次进 1 块 = 16 个 half = 16 列）；
  `dstRepStride = (vBlockCount==1) ? 0 : realK_`（目的每次进 `realK_` 块 = 16 个目的行）。
  **`=1` 时把 stride 写成 0** 是防御性写法：单 repeat 时 stride 不被使用，
  填 0 可避免超出 `uint8_t` 表示范围（`realK_` 最大 128 ✓，但 8 桶的 `kMatmulK=64` 等也一样安全）。
- `:2379-2387` 外层 `kBlockCount = realK_/16` 次，每次 16 个源行指针
  `stateLocal[block*16*vStepAligned_ + row*vStepAligned_]`（[dk, vStep] 的第 block 组行）
  → 16 个目的行指针 `stateTransposed[block*16 + row*realK_]`（[vStep, dk] 的第 block 组列）。
  **与 10b §5 的 `:2157-2158` 是同一个寻址式，只是元素类型换成 outType、行宽换成 `vStepAligned_`。**
- `:2388` V 栅栏；`:2389-2391` `V_MTE3` 成对。
- `:2392` `stateOffset = stateBaseOffset + v_i*realK_`：对外布局 `[B,Nv,Dv,Dk]` 里
  本 V-tile 的起始（`v_i` 是 Dv 维偏移，行宽 `realK_`）。
- `:2393` `DataCopy(finalStateGm_[stateOffset], stateTransposed, outputStateElementCount)`：
  **一条 MTE3 写 `realK_*curV` 个 half**，且用 `outputStateElementCount`（真实 `curV`）**裁掉 padding 列**，
  所以 `:2366-2367` 放宽出来的转置余量不会污染输出。
- `:2394` `FreeTensor`；`:2395` `return`；`:2396` 大 `if` 右括号。

## 5. 标量兜底：只在守卫失败时执行

锚点：chunk_gated_delta_rule.h:2397-2410

```cpp

    TQueSync<PIPE_V, PIPE_S> finalStateSync;
    finalStateSync.SetFlag(0);
    finalStateSync.WaitFlag(0);
    for (uint32_t v = 0; v < curV; v++) {
      uint64_t stateRowOffset = stateBaseOffset + static_cast<uint64_t>(v_i + v) * realK_;
      for (uint32_t d = 0; d < realK_; d++) {
        finalStateGm_.SetValue(stateRowOffset + d, stateLocal.GetValue(d * vStepAligned_ + v));
      }
    }
    stateOutQueue_.FreeTensor(stateLocal);
  }

 private:
```

- `:2397` 空行。`:2398-2400` `TQueSync<PIPE_V, PIPE_S> finalStateSync` 成对：
  10b §4 说的 V→S 不变式的又一实例（`:2404` 要用标量 `GetValue` 读 `stateLocal`，
  而它是 `:2352` V 管 Cast 的产物）。
- `:2401-2406` 三重标量循环：`curV × realK_ = 128×128 = 16384` 次
  `finalStateGm_.SetValue`，**每次一个元素、无 DMA**。
  `:2402` 的 `stateRowOffset = stateBaseOffset + (v_i+v)*realK_` 与 `:2392` 一致，
  `:2404` 的 `stateLocal.GetValue(d*vStepAligned_ + v)` 就是 `[dk, vStep]` 的转置读法。
  **两条路径写出的字节序列必须完全相同**，这是"守卫只挑性能、不改语义"的验证锚点。
- `:2407` `FreeTensor(stateLocal)`；`:2408` 函数右括号。
- `:2409` 空行；`:2410` `private:` —— **本章到此结束，11 章从成员声明区继续**。

## 6. 本章的账

| 项目 | Cube 快路径（`:2296` 起） | !1108 纯 Vector（`:2298-2315`） |
| --- | --- | --- |
| 状态衰减 | 1 条 `Muls`（`:2123`，长 `kStateElements`） | `realK_` 条 `Muls`（`:2301`） |
| 衰减系数 | 3 条批量（`:2124/2126/2128`）+ 64 条宽 `Muls`（`:2141`） | 64 次 `ScalarExp`（`:2307`） |
| K 读取 | 1 条带跨距 DMA（`:2135` → `:289-292`） | 8192 次标量 `GetValue`（`:2310`） |
| 主乘积 | 4 条 Mmad（`:2230/2245` × 2 tile） | 8192 条 `Axpy`（`:2312`） |
| NZ→ND | 8 条融合 `Add`（`:2269`，64/80/96 桶）/ 1024 条 `Add`（`:2283`，128 桶） | 无（累加即结果） |
| workspace 写回 | 1 条 `DataCopy`（`:2332`） | `realK_` 条（`:2337`，桶 0） |
| final_state 写回 | 转置 + 1 条 `DataCopy`（`:2386/2393`） | 16384 次 `SetValue`（`:2404`） |

**Step7 的净收益全部来自"把 8192 次标量 GM 读和 8192 条 Axpy 换成 4 条 Mmad"**，
而代价是 L0C→UB 的一次全管停顿（`:2259`）、A 的两轮转置（`:2153-2161/:2177-2185`）、
以及 10b §9 那条只能服务一个 M-tile 的融合 `Add`——128 桶付了两次分段 Add 的账。