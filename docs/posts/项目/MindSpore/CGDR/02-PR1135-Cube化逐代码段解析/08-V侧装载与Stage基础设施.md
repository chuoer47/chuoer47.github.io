# 08-V侧装载与Stage基础设施

锚点见各小节首行。本篇逐行覆盖 `src/d0906c3e/op_kernel/chunk_gated_delta_rule.h` 的 **1298-1602**（305 行）：V 侧七步骨架（`ProcessVTiles` / `ProcessOneVTile`）、Step 1 的 `LoadVBeta`、Step 2/4 的 Vector 主体、Step 3 的 `LoadStateTile`，以及 Cube 化的唯一出口 `StageHalfWithResidual` / `StageHalf` / `ComputeValueAndVNewCubeDispatch`。

三条先行结论：

1. **V 侧以 tile 为单位串行推进，融合路径把 `LoadStateTile` 从主循环里"抽"进了 Cube 等待窗口**。`ProcessOneVTile` 只有两条分支：`useFusedCubeFastPath` 为真时 Step 2+4 一次调用做完（内部再调 `LoadStateTile`），为假时才按 !1108 的顺序 `ComputeValueNew → LoadStateTile → ComputeVNew`（:1313-1319）。
2. **`LoadVBeta` 相对 !1108 是"指令发射次数"的重写**：!1108 每行一次标量 `LoadBeta` + 一次 `Cast` + 一次 `Muls`（64 行 = 192 次发射 + 64 次标量 GM 读），终态压成 1 条 2D strided DMA + 1 条整块 `Cast` + 1 条 `Brcb` + 最多 2 条高维 `Mul`；关键增量是 `DataCopyParams` 的第四个字段 dstGap 终于被用上，DMA 直接按最终 padding 行距落位。
3. **`StageHalfWithResidual` 是全 kernel 把 FP32 中间量喂给 Cube 的唯一出口**，一次调用产出同一矩阵的两个 FP16 分片（hi/lo）写到 GM 的两个不相交子区；它借 `stateOutQueue_` 而不是 tmpBuff 做 FP16 落手处，因为该队列的容量恰好等于最大一块 FP16 操作数（B = state tile `[dk, vStep]`）的尺寸，且 `TQue` 天然提供 V→MTE3 的交接口。

本篇涉及的定形硬件语义（后续 09/10 篇复用）：Cube 侧三级片上存储由 `TPosition::A1/B1`（L1）、`A2/B2`（L0A/L0B）、`CO1`（L0C）寻址；Mmad 只吃 FP16 的 NZ（分形）排布，L0C 是 FP32 累加器且同样按 NZ 输出；dav_m200（310P）没有 Fixpipe，所以 L0C→UB 之后必须手工 NZ→ND（09 篇）。UB 内部 ND = 行主序，NZ = 16×16 分形内部行主序、分形之间按面板排列。

## 1. chunk_gated_delta_rule.h:1298-1307 — ProcessVTiles：V 维切分循环

锚点：chunk_gated_delta_rule.h:1298-1307

```cpp
  __aicore__ inline void ProcessVTiles(int32_t t_start, uint32_t chunkLen, uint64_t head_i, uint64_t qkHead,
                                       uint32_t avFp32, uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset,
                                       uint32_t c, bool isLastChunk) {
    for (uint32_t v_i = 0; v_i < realV_; v_i += vStep_) {
      uint32_t curV = (v_i + vStep_ > realV_) ? realV_ - v_i : vStep_;
      ProcessOneVTile(t_start, chunkLen, head_i, qkHead, avFp32, stateBaseOffset, workspaceStateBaseOffset, c,
                      isLastChunk, v_i, curV);
    }
  }
```

- L1298-1300 函数签名换行：入参 `avFp32` 由调用方 `ProcessChunk`（:719）赋成 `vStepAligned_`，即"本 tile 在 UB 里的 FP32 行宽"；`stateBaseOffset` / `workspaceStateBaseOffset` 是同一份 state 在两个不同容器里的基址（公共 `initialState`/`finalState` 与 FP32 workspace），:689-690 与 :703-704 各算一次。
- L1301 `for (v_i = 0; v_i < realV_; v_i += vStep_)`：沿 Dv 维按 `vStep_` 切 tile。`vStep_` 由 host 侧 `SolveVStep` 决定，优先取 `preferredVStep = cubeDk`（tiling.cpp:299），也就是让 V tile 宽度和 K 的 Cube 桶宽（64/80/96/128）落在同一档——这是后文所有定形 Cube 函数能用 `kMatmulN = kSpecializedDk` 的前提。
- L1302 `curV`：末 tile 的截断宽度（`realV_ - v_i`），其余 tile 等于 `vStep_`。`curV < vStepAligned_` 是本文件里多处 padding 分支（:1485、:2364）的唯一触发源。
- L1303-1305 调用 `ProcessOneVTile` 并收尾。`v_i/curV` 在最后传，是因为它们是本层唯一新算出来的量。
- 结构要点：`ProcessVTiles` 只在"单 V tile 也够装"的 `ProcessChunk` 路径里被调用（:732）；当 `ShouldSplitVTiles()` 为真（`realV_ > vStep_`）时改由 `ProcessChunkVTile`（:752-755）在**外层 chunk 循环内**直接调 `ProcessOneVTile`，此时一个 (head, V-tile) 二元组是一个独立的核级工作项（tiling.cpp:315-318 的 `vTileCount`）。两种调用形态共用 `ProcessOneVTile`，所以七步骨架只有一份实现。

## 2. chunk_gated_delta_rule.h:1308-1331 — ProcessOneVTile：七步骨架与融合/非融合二分

锚点：chunk_gated_delta_rule.h:1308-1331

```cpp
  __aicore__ inline void ProcessOneVTile(int32_t t_start, uint32_t chunkLen, uint64_t head_i, uint64_t qkHead,
                                         uint32_t avFp32, uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset,
                                         uint32_t c, bool isLastChunk, uint32_t v_i, uint32_t curV) {
    LoadVBeta(t_start, head_i, chunkLen, v_i, curV, avFp32);
    bool useFusedCubeFastPath = IsFusedValueOutputCubeFastPath(chunkLen, avFp32);
    if (likely(useFusedCubeFastPath)) {
      ComputeValueAndVNewCubeDispatch(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    } else {
      ComputeValueNew(chunkLen, curV, avFp32);
      LoadStateTile(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
      ComputeVNew(chunkLen, avFp32);
    }
    if (likely(useFusedCubeFastPath)) {
      ComputeOutputCubeDispatch(t_start, qkHead);
    } else {
      ComputeAttnInter(t_start, qkHead, chunkLen, avFp32);
      AccumOutput(chunkLen, avFp32);
    }
    WriteAttnTileToGm(t_start, chunkLen, head_i, v_i, curV, avFp32);
    UpdateAndWriteState(t_start, chunkLen, v_i, curV, qkHead, stateBaseOffset, workspaceStateBaseOffset, avFp32,
                        isLastChunk);
  }
```

- L1308-1310 签名：与 !1108 的 `ProcessOneVTile`（00e39ab5:659-671）逐字符相同，差异全在函数体。
- L1311 `LoadVBeta` 无条件先跑：Step 1 是两条分支共同的生产者（v_beta 进 `chunkVFp32`）。
- L1312 判定**放在 LoadVBeta 之后**、且算一次存进局部量：`IsFusedValueOutputCubeFastPath` 要读 `realK_/chunkLen/vStepAligned_`，是标量管上的纯比较，提前算好复用给 L1320 的第二个 `if`，避免同一个谓词求两次值（也避免两次 `likely` 分支预测不一致时出现"上半程走融合、下半程走向量"的错配）。
- L1313/L1320 两个 `if (likely(...))`：融合版是"预期路径"，`likely` 把它的代码块排在前面、把 fallback 甩到冷区。注意两处判断用**同一个** `useFusedCubeFastPath`，所以 Step 2+4 与 Step 5+6 的选路必然一致——这正是 `IsFusedValueOutputCubeFastPath` 与 `IsCubeFastPath` 在终态被写成等价（:264-266）的原因。
- L1316-1318 非融合三步：与 !1108 的 :663-665 同序（Step 2 → Step 3 → Step 4）。顺序是硬约束：`stateInFp32` 与 `chunkScoresFp32` 在 UB 里重叠（:173-183），必须等 Step 2 用完 scores 才能装载 state。
- L1321 / L1323-1324 Step 5+6 的两种形态：融合版一次 Cube 出完整输出，非融合版仍是 `ComputeAttnInter` + `AccumOutput` 两趟 Axpy。
- L1326 `WriteAttnTileToGm`：两条分支汇合后的第一件事，把 `chunkAttnOutFp32`（此刻身份 = output）FP16 化后 2D 写回 GM。
- L1327-1328 `UpdateAndWriteState`：Step 7，`isLastChunk` 决定中间块（FP32 写 workspace）还是最后一块（cast FP16 写 `finalState`）。
- L1329-1331 `}`、空行、Step 1 的文档注释首行 `// Step 1: v_beta = V * beta -> chunkVFp32.`——注释保留 !1108 的 "Step N" 编号体系，全篇用它当算法坐标。

## 3. chunk_gated_delta_rule.h:1332-1410 — LoadVBeta：2D strided DMA 与非对齐 fallback

锚点：chunk_gated_delta_rule.h:1332-1410

```cpp
  // Step 1: v_beta = V * beta -> chunkVFp32.
  __aicore__ inline void LoadVBeta(int32_t t_start, uint64_t head_i, uint32_t chunkLen, uint32_t v_i, uint32_t curV,
                                   uint32_t avFp32) {
    // The compact output tile is dead until ComputeValueNew, so reuse it as
    // FP16 staging and replace chunkLen*curV scalar GM loads with one strided
    // standard DataCopy. Only use the fast path when both row width and source
    // gap are exactly representable in 32-byte blocks.
    uint64_t srcRowGapElems = static_cast<uint64_t>(NV_) * realV_ - curV;
    uint64_t srcRowGapBytes = srcRowGapElems * sizeof(inType);
    uint64_t dstRowGapBytes = static_cast<uint64_t>(avFp32 - curV) * sizeof(inType);
    if (likely((curV * sizeof(inType)) % BLOCK_BYTES == 0 && srcRowGapBytes % BLOCK_BYTES == 0 &&
               dstRowGapBytes % BLOCK_BYTES == 0 && srcRowGapBytes / BLOCK_BYTES <= 65535 &&
               dstRowGapBytes / BLOCK_BYTES <= 65535)) {
      LocalTensor<inType> valueLocal = chunkAttnOutFp32.template ReinterpretCast<inType>();
      uint64_t vOff = (static_cast<uint64_t>(t_start) * NV_ + head_i) * realV_ + v_i;
      uint16_t rowBlocks = static_cast<uint16_t>(curV * sizeof(inType) / BLOCK_BYTES);
      uint16_t srcRowGapBlocks = static_cast<uint16_t>(srcRowGapBytes / BLOCK_BYTES);
      uint16_t dstRowGapBlocks = static_cast<uint16_t>(dstRowGapBytes / BLOCK_BYTES);
      DataCopyParams copyParams{static_cast<uint16_t>(chunkLen), rowBlocks, srcRowGapBlocks, dstRowGapBlocks};

      // Zero the aligned destination rows first, then let MTE2 write valid V
      // elements directly at the final row stride. This makes the subsequent
      // FP16->FP32 Cast contiguous and removes one Cast launch per row.
      Duplicate(valueLocal, static_cast<inType>(0), chunkLen * avFp32);
      PipeBarrier<PIPE_V>();

      event_t scalarToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::S_MTE2));
      SetFlag<HardEvent::S_MTE2>(scalarToMte2);
      WaitFlag<HardEvent::S_MTE2>(scalarToMte2);
      event_t vectorToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE2));
      SetFlag<HardEvent::V_MTE2>(vectorToMte2);
      WaitFlag<HardEvent::V_MTE2>(vectorToMte2);
      DataCopy(valueLocal, valueGm_[vOff], copyParams);
      event_t mte2ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_V));
      SetFlag<HardEvent::MTE2_V>(mte2ToVector);
      WaitFlag<HardEvent::MTE2_V>(mte2ToVector);

      Cast(chunkVFp32, valueLocal, RoundMode::CAST_NONE, chunkLen * avFp32);
      PipeBarrier<PIPE_V>();

      // Broadcast one beta per row into 32-byte blocks and scale the complete
      // aligned V tile with high-dimensional Mul instructions. Padding stays
      // zero, while scalar beta reads and row-wise Muls launches disappear.
      LocalTensor<float> betaBlocks = chunkAttnOutFp32;
      uint8_t brcbRepeats = static_cast<uint8_t>(Ceil(chunkLen, FP32_NUM_PER_BLOCK));
      Brcb(betaBlocks, betaFp32, brcbRepeats, BrcbRepeatParams{1, 8});
      PipeBarrier<PIPE_V>();
      uint8_t rowStride = static_cast<uint8_t>(avFp32 / FP32_NUM_PER_BLOCK);
      BinaryRepeatParams mulParams{1, 1, 0, rowStride, rowStride, 1};
      uint32_t vOffset = 0;
      for (; vOffset + 64 <= avFp32; vOffset += 64) {
        Mul(chunkVFp32[vOffset], chunkVFp32[vOffset], betaBlocks, static_cast<uint64_t>(64),
            static_cast<uint8_t>(chunkLen), mulParams);
      }
      if (vOffset < avFp32) {
        Mul(chunkVFp32[vOffset], chunkVFp32[vOffset], betaBlocks, static_cast<uint64_t>(avFp32 - vOffset),
            static_cast<uint8_t>(chunkLen), mulParams);
      }
      PipeBarrier<PIPE_V>();
      TQueSync<PIPE_V, PIPE_S> valueSync;
      valueSync.SetFlag(0);
      valueSync.WaitFlag(0);
      return;
    }

    Duplicate(chunkVFp32, 0.0f, chunkLen * avFp32);
    PipeBarrier<PIPE_V>();
    for (uint32_t i = 0; i < chunkLen; i++) {
      int32_t t = t_start + i;
      uint64_t vOff = (static_cast<uint64_t>(t) * NV_ + head_i) * realV_;
      float beta_val = betaFp32.GetValue(i);
      for (uint32_t v = 0; v < curV; v++) {
        float v_val = static_cast<float>(valueGm_.GetValue(vOff + v_i + v));
        chunkVFp32.SetValue(i * avFp32 + v, v_val * beta_val);
      }
    }
  }

  // Step 2: value_new_tile = attn @ v_beta_tile (lower-tri attn, sum k <= i) ->
  // chunkAttnOutFp32.
```

- L1407-1408 函数收尾 `}` 与空行；L1409-1410 是下一节 `ComputeValueNew` 的两行文档注释，按行区间归本节覆盖，语义在 §4 展开。注释里的 `sum k <= i` 就是 L1421 那个 `k <= i` 的循环界，也是"Cube 不支持三角乘、必须先清上三角"的出处。

### 3.1 数据形状与守卫（L1334-1343）

- L1334-1337 注释：`chunkAttnOutFp32` 此刻是"死缓冲"（Q·scale 缓存已被 `ComputeAttnProductsCube` 消费、输出还没开始写），所以借它当 FP16 DMA 落手处。这是本 kernel 一贯的"借缓冲"手法（对照 :765 借 `chunkVFp32` 装 K）。
- L1338 `srcRowGapElems = NV_ * realV_ - curV`：V 在 GM 里是 `[T, NV, Dv]`，本 tile 取 `(t, head, v_i : v_i+curV)`，跳到下一个 token 的同一 head 要越过本 head 剩下的 `NV*realV - curV` 个元素。
- L1339 / L1340 换算成字节：源 FP16，`sizeof(inType) == 2`。L1340 的 `dstRowGapBytes = (avFp32 - curV) * sizeof(inType)` 是**终态新增的一行**——它描述"UB 目的端每行结束要留多少 padding"。
- L1341-1343 守卫三件事：行宽 32B 整除、两个 gap 32B 整除、两个 gap 的块数能塞进 uint16（`<= 65535`，因为 `DataCopyParams` 四个字段都是 `uint16_t`，块数上限是 65535）。`BLOCK_BYTES = 32`（:37）。
  为什么必须整除：这里用的是 `DataCopyParams`（**块模式**，一切长度/gap 以 32B 为单位）而不是 `DataCopyExtParams`（`blockLen` 是字节数、可以表达非整块尾巴，代价是 `blockCount` 只能为 1、要逐行发指令，见 `CopyToGm` :44-58 的 else 分支）。块模式表达不了"半个 32B 块"，所以一旦 `curV` 或某个 gap 不是 16 个 FP16 的整数倍就整体退回标量路径。
  数值例：`NV_=8, realV_=128, curV=128, avFp32=128` → srcGap = 896 元素 = 1792B = 56 块，dstGap = 0 → 走快路径。`dv=100`（桶宽 128，`vStep_=100` 时 `curV=100, avFp32=104`）→ 行宽 200B 不是 32 的倍数 → 整个 tile 走 L1396 起的 fallback。

### 3.2 一次 2D strided DMA（L1344-1369）

- L1344 `ReinterpretCast<inType>()`：把 FP32 输出缓冲当 FP16 用（同一块 UB 内存，元素编号口径换成 half）。
- L1345 `vOff`：首元素线性下标 `(t_start*NV_ + head_i)*realV_ + v_i`——注意行内偏移 `v_i` 已经并进起点，所以行与行之间只剩 L1338 的 gap。
- L1346-1349 把三个字节量换算成块数并塞进 `DataCopyParams{chunkLen, rowBlocks, srcRowGapBlocks, dstRowGapBlocks}`。四元组的语义（全 kernel 统一，见 docs/PR-406 05 篇 §Phase 1）：重复 `blockCount` 次（=chunkLen 行），每次搬 `blockLen` 个 32B 块，源端行末跳过 `srcStride` 块，目的端行末跳过 `dstStride` 块。`curV=128` 时 `rowBlocks = 128*2/32 = 8`。
- L1351-1353 注释 + L1354 `Duplicate(valueLocal, 0, chunkLen*avFp32)`：**先按最终行距把目的区整体清零**，再让 MTE2 只写每行的有效段。收益是双份的：(a) padding 天然是 0，后面喂 Cube 的稠密乘积不会被脏值污染；(b) 有效数据落在最终行距上，于是 L1368 的 `Cast` 可以一次覆盖 `chunkLen*avFp32` 全块，不必逐行 Cast。L1355 `PipeBarrier<PIPE_V>` 让清零在 V 管内退休，后续 MTE2 覆写才看得见"已清零"。
- L1357-1366 三段硬事件（`S_MTE2`、`V_MTE2`、`MTE2_V`）包一条 `DataCopy`：这是本仓库对"标量/V 写过的 UB 要被 MTE2 覆写、MTE2 写过的 UB 要被 V 读"三类跨管竞争的标准三段式。`pipe_->FetchEventID(...)` 从 TPipe 领一个可编程事件号再 `SetFlag/WaitFlag` 成对使用；与 `PipeBarrier` 的区别是——PipeBarrier 只序列化**同一条管**的指令流（V 管的指令按序退休），完全不管 V↔MTE2 这种跨管关系；硬事件才是跨管的握手。`MTE2_V`（L1364-1366）保证 DMA 真的搬完，V 才在 L1368 读 `valueLocal`。
- L1368 `Cast(chunkVFp32, valueLocal, RoundMode::CAST_NONE, chunkLen * avFp32)`：FP16→FP32 整块升精度，`CAST_NONE` 在该方向上是无损的（FP16 值都能被 FP32 精确表示）。L1369 后随 `PipeBarrier<PIPE_V>`。

### 3.3 beta 广播 + 高维 Mul（L1371-1394）

- L1371-1373 注释：一 beta/行 → 广播成 32B 块 → 一条高维 Mul 覆盖整 tile；"Padding stays zero" 是因为 0×beta 仍是 0。
- L1374 `LocalTensor<float> betaBlocks = chunkAttnOutFp32;`：**同一块借来的内存被复用第二次**——DMA 阶段它是 FP16 的 V 落手处，L1368 之后 V 已进 `chunkVFp32`，于是它改当 beta 广播区。生命周期不重叠，所以可以共用。
- L1375 `brcbRepeats = Ceil(chunkLen, 8)`：`BrcbRepeatParams{1, 8}`（L1376）里 1 是源侧每个 repeat 前进 1 个标量、8 是目的侧每个 repeat 前进 8 个 32B 块；`chunkLen=64` → 8 个 repeat，产出 64 个块 = 512 个 FP32，每块内 8 个元素是同一个 beta。
- L1377 `PipeBarrier<PIPE_V>`：Brcb 的产物要被下一条 Mul 读。
- L1378 `rowStride = avFp32 / FP32_NUM_PER_BLOCK`：一个 FP32 行（含 padding）占多少个 32B 块；`avFp32=128` → 16，`avFp32=80` → 10，都在 uint8 范围内（字段类型是 `uint8_t`）。
- L1379 `BinaryRepeatParams{1, 1, 0, rowStride, rowStride, 1}`：六个字节宽步进值分别给 dst/src0/src1 三个操作数的 block 与 repeat 两个维度。按本处取值要成立的效果读：V 数据（src0）与输出（dst）每个 repeat 前进 `rowStride` 块（=一整行，含 padding），块内步进 1；beta 广播区（src1）**repeat 步进 1、block 步进 0**——同一行的 64 个元素共用一份 8 路广播，跨到下一行才前进一个块。这正是 L1376 Brcb 产物的唯一正确消费方式。
- L1380-1384 沿列方向以 64 个元素为一片切分：`numOfElements=64`、`repeatTimes=chunkLen`。`avFp32=128` → 2 条 Mul；`avFp32=64` → 1 条。切片是为了让单条高维指令覆盖的块数落在硬件一次能描述的范围里（与 `ComputeKBeta` :887-894 用同一个 `+64` 步长，两处互为镜像）。
- L1385-1388 尾巴片：`avFp32 % 64 != 0`（如桶宽 80/96 的 `80-64`、`96-64`）时补一条长度 `avFp32-vOffset` 的 Mul；`avFp32` 是 8 的倍数，所以这条指令的长度仍是 8 的整数倍，不会撞块对齐。
- L1389 `PipeBarrier<PIPE_V>` + L1390-1392 `TQueSync<PIPE_V, PIPE_S> valueSync` 成对 Set/Wait：V→S 方向的栅栏——本函数后面（L1393 `return`）标量管要开始算 Cube 的 shape/offset 并可能被别的 `TQueSync<PIPE_S, PIPE_V>` 消费，所以这里显式让"标量等向量"。`TQueSync<From, To>` 与 `PipeBarrier` 的差别：前者是**跨管**单向栅栏（Set 在 From 侧打点、Wait 让 To 侧阻塞，靠一个可复用事件号），后者是**同管**全序栅栏；`TQueSync` 不带缓冲，纯同步，而 `TQue`（`stateOutQueue_`）额外管内存分配与回收。
- L1393-1394 `return;` 与 `}`：快路径结束，绝不落到 fallback。
- L1395 空行。

### 3.4 非对齐 fallback 与 !1108 的逐行 diff（L1396-1410）

- L1396-1397 `Duplicate(chunkVFp32, 0.0f, chunkLen * avFp32)` + `PipeBarrier`：**终态新移到 fallback 里的一次清零**。!1108 把这次清零写在分支之前（00e39ab5:676-677），快路径里 `valueLocal` 的清零则由外层那次覆盖；终态拆成两次独立清零（L1354 清 FP16 借用区、L1396 清 FP32 目标区），代价是多一条 `Duplicate`，收益是快路径完全不必碰 `chunkVFp32`，向量管占用更少。
- L1398-1406 双层标量循环：`chunkLen*curV` 次 GM `GetValue` + 同样多次 `SetValue`。L1401 `beta_val = betaFp32.GetValue(i)` 是**终态的第二处改动**——!1108 这里是 `LoadBeta(t, head_i)`（00e39ab5:723），每次一行标量 GM 读；终态改读 UB 里已经由 `LoadChunkCoefficients`（:812）整块 DMA + `Gather` 抽列出来的 `betaFp32`，把标量 GM 访问彻底赶出内层循环。
- L1407-1410 函数收尾 `}`、空行、Step 2 注释首行。

!1108（前身 PR !1108，`src/00e39ab5`）同名函数的关键差异，逐字摘出：

```cpp
// src/00e39ab5/op_kernel/chunk_gated_delta_rule.h:683-713（节选）
    uint64_t srcRowGapElems = static_cast<uint64_t>(NV_) * realV_ - curV;
    uint64_t srcRowGapBytes = srcRowGapElems * sizeof(inType);
    if (likely((curV * sizeof(inType)) % BLOCK_BYTES == 0 && srcRowGapBytes % BLOCK_BYTES == 0 &&
               srcRowGapBytes / BLOCK_BYTES <= 65535)) {
      ...
      uint16_t rowBlocks = static_cast<uint16_t>(curV * sizeof(inType) / BLOCK_BYTES);
      uint16_t srcRowGapBlocks = static_cast<uint16_t>(srcRowGapBytes / BLOCK_BYTES);
      DataCopyParams copyParams{static_cast<uint16_t>(chunkLen), rowBlocks, srcRowGapBlocks, 0};
      ...
      TQueSync<PIPE_S, PIPE_V> betaValueSync;
      for (uint32_t i = 0; i < chunkLen; i++) {
        float betaVal = LoadBeta(t_start + i, head_i);
        betaValueSync.SetFlag(0);
        betaValueSync.WaitFlag(0);
        Cast(chunkVFp32[i * avFp32], valueLocal[i * curV], RoundMode::CAST_NONE, curV);
        PipeBarrier<PIPE_V>();
        Muls(chunkVFp32[i * avFp32], chunkVFp32[i * avFp32], betaVal, curV);
        PipeBarrier<PIPE_V>();
      }
```

| 项 | !1108（00e39ab5:674-729） | d0906c3e:1332-1407 | 机器语义上的收益 |
|---|---|---|---|
| dstGap | 恒 0，DMA 紧凑落位 | `dstRowGapBlocks`，DMA 按最终行距落位 | `Cast` 从 `chunkLen` 次变 1 次 |
| padding 来源 | 只清 `chunkVFp32`，padding 由 L1396 那侧兜 | 先清借用区再覆写 | Cast 覆盖全块也不用怕脏值 |
| 守卫 | 2 项（行宽、srcGap） | 4 项（加 dstGap 整除 + dstGap≤65535） | 快路径覆盖面略窄，换零分支风险 |
| beta | `LoadBeta(t, head_i)` 每行标量 GM 读 | `betaFp32.GetValue(i)` / `Brcb` | 标量 GM 读 64→0 次 |
| 缩放 | 每行 `Cast`+`Muls`（含 `betaValueSync` 栅栏） | 1 次 `Cast` + 1 次 `Brcb` + ≤2 次高维 `Mul` | 指令发射 128→3；`betaValueSync` 这个 S→V 栅栏整体消失 |
| 收尾栅栏 | `TQueSync<PIPE_V,PIPE_S> valueSync`（保留） | 同 | 一致 |

高维 `Mul` 取代 `Muls` 是必然的：`Muls` 的系数是标量立即数/标量寄存器，一行一个系数就要发一次；`Mul` 的第二个源是"每 repeat 前进一个 32B 广播块"的向量，于是 64 行 64 个系数在一套 repeat 参数里描述完。

## 4. chunk_gated_delta_rule.h:1411-1429 — ComputeValueNew：Step 2 的 Vector 主体

锚点：chunk_gated_delta_rule.h:1411-1429

```cpp
  __aicore__ inline void ComputeValueNew(uint32_t chunkLen, uint32_t curV, uint32_t avFp32) {
    if (likely(IsCubeFastPath(chunkLen, avFp32))) {
      ComputeValueNewCube();
      return;
    }
    (void)curV;
    Duplicate(chunkAttnOutFp32, 0.0f, chunkLen * avFp32);
    PipeBarrier<PIPE_V>();
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      for (uint32_t k = 0; k <= i; k++) {
        float score = chunkScoresFp32.GetValue(i * chunkSize_ + k);
        Axpy(outRow, chunkVFp32[k * avFp32], score, avFp32);
        PipeBarrier<PIPE_V>();
      }
    }
  }
```

- L1412-1415 `if (likely(IsCubeFastPath(...))) { ComputeValueNewCube(); return; }`：**终态新增的 Cube 分支**。L1412 用的谓词与 `ProcessOneVTile:1312` 完全相同（`IsFusedValueOutputCubeFastPath` 就是 `IsCubeFastPath` 的转发，:264-266），而能进到本函数就代表该谓词为假，所以这条分支在终态**永不命中**——`ComputeValueNewCube`（:1736）因此是"保留但不可达"的非融合 Cube 版（09 篇 §4 详述其代价与选择条件）。
- L1416 `(void)curV;`：显式丢弃形参。!1108 同处也有这行（00e39ab5:733），因为 `curV` 只影响 padding，而 padding 已由 `LoadVBeta` 置 0。
- L1417-1418 输出整块清零 + V 管栅栏：`outRow` 是累加目标，起点必须是 0。
- L1419-1425 下三角 GEMV：`outRow_i = Σ_{k<=i} A[i][k] * v_beta[k]`。L1422 `chunkScoresFp32.GetValue(i*chunkSize_+k)` 是**标量管读 UB**（不是 GM），行宽用 `chunkSize_`（=64）而不是 `chunkLen`，因为 scores 矩阵按定长 chunk 排布。L1423 `Axpy(dst, src, coef, count)` 的机器语义是 `dst += coef * src`，系数是标量、`count` 个元素一条向量指令，这是 Ascend 上"用向量指令做矩阵乘一行"的原语。L1424 每次 Axpy 后 `PipeBarrier<PIPE_V>`：`outRow` 原地累加，下一条 Axpy 的 src 与 dst 有重叠，必须串行。
- 复杂度：`Σ_i (i+1) = chunkLen*(chunkLen+1)/2 = 2080` 次标量读 + 同量级 Axpy 发射（`chunkLen=64`），这正是 !1108 在 310P 上的瓶颈之一，也是 09 篇融合 Cube 要拿掉的对象。
- L1426-1429 三层 `}`、空行、Step 3 注释（说明 state 与 scores 重叠、必须排在 Step 2 之后）。

## 5. chunk_gated_delta_rule.h:1430-1533 — LoadStateTile：布局、转置与两条容量式

锚点：chunk_gated_delta_rule.h:1430-1533

```cpp
  // Step 3: load state tile into stateInFp32 (overlaps chunkScoresFp32 — must run after Step 2).
  __aicore__ inline void LoadStateTile(uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset, uint32_t v_i,
                                       uint32_t curV, uint32_t c) {
    uint32_t stateTileElem = stateStrideK_ * vStepAligned_;
    Duplicate(stateInFp32, 0.0f, stateTileElem);
    PipeBarrier<PIPE_V>();
    if (c > 0) {
      PipeBarrier<PIPE_ALL>();
      event_t vectorToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE2));
      SetFlag<HardEvent::V_MTE2>(vectorToMte2);
      WaitFlag<HardEvent::V_MTE2>(vectorToMte2);
      uint32_t alignedV = Ceil(curV, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
      if constexpr (kSpecializedDk != 0) {
        uint16_t rowBlocks = static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK);
        uint16_t srcGapBlocks = static_cast<uint16_t>((stateWorkspaceStrideV_ - alignedV) / FP32_NUM_PER_BLOCK);
        uint16_t dstGapBlocks = static_cast<uint16_t>((vStepAligned_ - alignedV) / FP32_NUM_PER_BLOCK);
        DataCopyParams stateParams{static_cast<uint16_t>(realK_), rowBlocks, srcGapBlocks, dstGapBlocks};
        uint64_t rowOff = workspaceStateBaseOffset + v_i;
        DataCopy(stateInFp32, stateWorkspaceGm_[rowOff], stateParams);
      } else {
        DataCopyParams stateParams{1, static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK), 0, 0};
        for (uint32_t d = 0; d < realK_; d++) {
          uint64_t rowOff = workspaceStateBaseOffset + static_cast<uint64_t>(d) * stateWorkspaceStrideV_ + v_i;
          DataCopy(stateInFp32[d * vStepAligned_], stateWorkspaceGm_[rowOff], stateParams);
        }
      }
      PipeBarrier<PIPE_ALL>();
      event_t mte2ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_V));
      SetFlag<HardEvent::MTE2_V>(mte2ToVector);
      WaitFlag<HardEvent::MTE2_V>(mte2ToVector);
      return;
    }

    // The public interface follows 910B and stores state as [B, Nv, Dv, Dk].
    // The internal FP32 tile is [Dk, vStep], so transpose while loading.
    // For 16-aligned tiles, replace the scalar element-wise transpose with one
    // contiguous GM->UB transfer followed by vnchwconv and an FP16->FP32 cast.
    // kCumdecayFp32 and chunkVFp32 are dead at this point and provide the two
    // temporary FP16 matrices when both borrowed buffers are large enough.
    constexpr uint32_t kTransposeBlock = 16;
    uint32_t kBlockCount = realK_ / kTransposeBlock;
    uint32_t vBlockCount = vStepAligned_ / kTransposeBlock;
    uint32_t stateElementCount = realK_ * vStepAligned_;
    uint32_t stateNdCapacity = 2 * chunkSize_ * alignK_;
    uint32_t stateTransposedCapacity = 2 * chunkSize_ * vStepAligned_;
    bool supportedVTile = curV == vStepAligned_;
    if constexpr (kSpecializedDk != 0) {
      supportedVTile = true;
    }
    if (likely(realK_ % kTransposeBlock == 0 && vStepAligned_ % kTransposeBlock == 0 && supportedVTile &&
               kBlockCount <= UINT8_MAX && stateElementCount <= stateNdCapacity &&
               stateElementCount <= stateTransposedCapacity)) {
      LocalTensor<inType> stateNd = kCumdecayFp32.template ReinterpretCast<inType>();
      LocalTensor<inType> stateTransposed = chunkVFp32.template ReinterpretCast<inType>();

      if constexpr (kSpecializedDk != 0) {
        if (curV < vStepAligned_) {
          Duplicate(stateNd, static_cast<inType>(0), stateElementCount);
        }
      }
      event_t vectorToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE2));
      SetFlag<HardEvent::V_MTE2>(vectorToMte2);
      WaitFlag<HardEvent::V_MTE2>(vectorToMte2);
      uint64_t stateOffset = stateBaseOffset + static_cast<uint64_t>(v_i) * realK_;
      DataCopy(stateNd, initStateGm_[stateOffset], curV * realK_);
      event_t mte2ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_V));
      SetFlag<HardEvent::MTE2_V>(mte2ToVector);
      WaitFlag<HardEvent::MTE2_V>(mte2ToVector);

      TransDataTo5HDParams transposeParams;
      transposeParams.repeatTimes = static_cast<uint8_t>(kBlockCount);
      transposeParams.srcRepStride = (kBlockCount == 1) ? 0 : 1;
      transposeParams.dstRepStride = (kBlockCount == 1) ? 0 : vStepAligned_;
      for (uint32_t block = 0; block < vBlockCount; block++) {
        LocalTensor<inType> srcRows[kTransposeBlock];
        LocalTensor<inType> dstRows[kTransposeBlock];
        for (uint32_t row = 0; row < kTransposeBlock; row++) {
          srcRows[row] = stateNd[block * kTransposeBlock * realK_ + row * realK_];
          dstRows[row] = stateTransposed[block * kTransposeBlock + row * vStepAligned_];
        }
        TransDataTo5HD<inType>(dstRows, srcRows, transposeParams);
      }
      PipeBarrier<PIPE_V>();
      Cast(stateInFp32, stateTransposed, RoundMode::CAST_NONE, stateElementCount);
      PipeBarrier<PIPE_V>();
      return;
    }

    TQueSync<PIPE_V, PIPE_S> clearStateSync;
    clearStateSync.SetFlag(0);
    clearStateSync.WaitFlag(0);
    for (uint32_t d = 0; d < realK_; d++) {
      for (uint32_t v = 0; v < curV; v++) {
        uint64_t stateOffset = stateBaseOffset + static_cast<uint64_t>(v_i + v) * realK_ + d;
        stateInFp32.SetValue(d * vStepAligned_ + v, static_cast<float>(initStateGm_.GetValue(stateOffset)));
      }
    }
    // Initial state is loaded by scalar GetValue/SetValue and is consumed by
    // vector Muls in ComputeVNew/ComputeAttnInter.
    TQueSync<PIPE_S, PIPE_V> initialStateSync;
    initialStateSync.SetFlag(0);
    initialStateSync.WaitFlag(0);
  }
```

### 5.1 为什么内部布局是 `[DK, vStep]`，为什么必须转置（L1462-1463）

- state 有两种存放形态：**公共接口** `initialState`/`finalState` 跟 910B 对齐，是 `[B, Nv, Dv, Dk]`（v 在外、k 在内，一行是 `Dk` 个元素）；**kernel 内部** `stateInFp32` 是 `[Dk 行, vStepAligned 列]`（成员注释 :2431）。两者互为转置，所以转置只发生在接口边界：`c == 0` 读初始状态时转置进来，最后一块写 `finalState` 时转置出去（逆操作在 `UpdateAndWriteState` :2360-2395）。
- 为什么内部选 `[DK, vStep]`：这个 tile 有两个消费者。(a) Cube：`K_cd @ S` 的右操作数 B 必须是 `[K=dk 行, N=v 列]` 的行主序 ND 矩阵，正好就是这个方向（09 篇 :1683/:1687）；(b) Vector fallback：`v_new[i] = Σ_d K_cd[i][d]·S[d][:]` 与 Step 7 的 `S[d][:] += coeff·v_new[i][:]` 都按 **S 的 d 行**做整行 Axpy/Muls（:1545、:2311）。两个消费者都要求 dk 是行方向，接口却给的是 v 是行方向，因此必须转置。
- workspace 路径（`c > 0`）不需要转置：中间块 state 以 **FP32** 存在 workspace，写入时用的就是 `[dk, stateWorkspaceStrideV_]`（:2325-2338），与内部 tile 同向，纯 DMA 即可；这也解释了"为什么中间块不落 FP16"——落 FP16 就要在块间做量化，误差会随 chunk 数累积（:2317-2319 注释明说）。

### 5.2 workspace 快路径的两种写法（L1432-1460）

- L1432-1434 `stateTileElem = stateStrideK_ * vStepAligned_`（`stateStrideK_ == alignK_`，:92）+ 整块清零 + `PipeBarrier`：padding 行/列全部归 0，后续 Cube 吃满桶宽才安全。
- L1435 `if (c > 0)`：非首块走 workspace。
- L1436 `PipeBarrier<PIPE_ALL>()` + L1437-1439 `V_MTE2`：`PIPE_ALL` 是**全管**栅栏，用它是因为上一块的 Step 7 是 MTE3 写 workspace、本处是 MTE2 读同一块 GM——跨核内两管的 GM 竞争，先把本核所有在途指令压平，再建立"V 侧准备完成 → MTE2 可发起"的事件。L1440 之后是搬运本体。
- L1440 `alignedV = Ceil(curV, 8)*8`：搬运宽度上取到 FP32 的 32B 块边界（8 个 FP32）。写侧用同一个 `alignedV`（:2325），所以读到的 padding 列正是写侧留下的 0。
- L1441-1447 **定形桶分支**：三个 `uint16_t` 分别是每行块数、源 gap 块数（`stateWorkspaceStrideV_ - alignedV`，跳出 workspace 里同一 dk 行的下一段 padding）、目的 gap 块数（`vStepAligned_ - alignedV`，跳出 UB tile 的行 padding）；`DataCopyParams{realK_, rowBlocks, srcGap, dstGap}` → **一条指令搬完 `realK_` 行**。可行前提：`stateWorkspaceStrideV_`、`vStepAligned_` 都是 8 的倍数（:93 与 :135 都是 `Ceil(...,8)*8`），两个 gap 才能整块表达。
- L1448-1453 **通用桶分支**（`kSpecializedDk == 0`，即 dk>128）：`DataCopyParams{1, rowBlocks, 0, 0}` + `realK_` 次逐行 DMA。原因是通用桶下 `vStepAligned_` 与 `stateWorkspaceStrideV_` 不一定同档，用 `{1,...}` 每次只搬一整行、gap 恒 0，把行间差异交给标量算的 `rowOff`。代价：`realK_` 次指令发射（dk>128 时 ≥ 129 行）。
- L1446 `rowOff = workspaceStateBaseOffset + v_i`：注意 dk 行方向没有出现在偏移里——它是 `DataCopyParams.blockCount`（重复次数）的职责，每 repeat 前进 `stateWorkspaceStrideV_`。
- L1455-1459 反向的 `MTE2_V` 事件 + `PIPE_ALL` + `return`：搬完对 V 管可见，本函数结束。
- L1460 `}` 收 `if (c > 0)`；L1461 空行。

### 5.3 转置快路径的六个量（L1468-1473）

- L1468 `kTransposeBlock = 16`：`TransDataTo5HD` 一次处理的正是 16×16 分形（"5HD" 是向量管的分形数据格式，指令等价于 `vnchwconv` 类重排：给 16 个行指针，输出这 16×16 转置后的 16 个行指针）。这也是 L1478 要求 `realK_ % 16 == 0 && vStepAligned_ % 16 == 0` 的根因。
- L1469 `kBlockCount = realK_ / 16`：**转置参数里的 repeatTimes**，即"一个 16 高的 v 块里有多少个 16 宽的 k 分形"。
- L1470 `vBlockCount = vStepAligned_ / 16`：**外层循环次数**（源侧的 16 行块数），`stateNd` 沿 v 维分块。
- L1471 `stateElementCount = realK_ * vStepAligned_`：转置后 tile 的元素数，两个借来的 FP16 区都要装得下它。
- L1472 `stateNdCapacity = 2 * chunkSize_ * alignK_`：**为什么有 2**。`stateNd` 借的是 `kCumdecayFp32`，它的 FP32 容量是 `chunkSize_ * alignK_`（:164）；`ReinterpretCast<inType>` 后元素口径从 FP32 变成 FP16，**可寻址元素数翻倍**，所以半精度容量 = `2 * cs * alignK_`。它要装的是接口布局的 `curV × realK_` 块（一行 `realK_` 个），上界即 `vStepAligned_ * realK_`。
- L1473 `stateTransposedCapacity = 2 * chunkSize_ * vStepAligned_`：同理，`stateTransposed` 借 `chunkVFp32`（FP32 容量 `cs * vStepAligned_`，:170），换 FP16 口径后翻倍。
- 两式**为什么必须同时检查**：`alignK_` 与 `vStepAligned_` 是两个独立取整出来的宽度（一个从 dk、一个从 vStep），借来的两块缓冲大小不同，因此"谁更紧"随 shape 变化。数值例（桶宽 128）：
  - `dk=128, dv=128`：`alignK_=128, vStepAligned_=128` → `stateElementCount = 16384`，两个容量式都是 `2*64*128 = 16384` → **恰好压线通过**（这就是 `preferredVStep = cubeDk` 想把所有维度推到的位置）。
  - `dk=128, dv=64`（UB 紧张时 `SolveVStep` 退一档到 `vStep=64`）：`stateElementCount = 128*64 = 8192`，`stateNdCapacity = 2*64*128 = 16384`（宽松），`stateTransposedCapacity = 2*64*64 = 8192`（压线）→ 决定成败的是**第二个**式子。
  - 若只检查 `stateNdCapacity`，第二种 shape 会越界踩到 `chunkVFp32` 之后的缓冲（`tmpBuff` 尾部是 `gCumsumFp32/deltaFp32/...`，:188-202），属于 UB 踩踏类错误，只会在特定 shape 下炸。两式并列 = 把"两块借区的独立上界"各自表达清楚。
- L1474-1477 `supportedVTile = (curV == vStepAligned_)`，定形桶下强制为真：通用桶必须整 tile 满宽才敢 DMA（DMA 元素数 `curV*realK_` 需 32B 整数倍，`realK_ % 16 == 0` 已由 L1478 保证）；定形桶因为可以显式预清零（L1484-1488），允许 `curV < vStepAligned_`。
- L1475 用 `if constexpr`：`supportedVTile = true` 在通用桶下是"死写"，编译期分支让两条路径各自只留一份代码，不留运行时分叉。
- L1478-1480 汇总守卫（6 个合取项，含 L1469 的 `kBlockCount <= UINT8_MAX`——`repeatTimes` 字段是 `uint8_t`，`realK_` 理论上不可能超，但这是所有借用式守卫的统一写法）。

### 5.4 转置的三步：DMA → TransDataTo5HD → Cast（L1481-1514）

- L1481-1482 两个借缓冲，都换成 FP16 口径。此刻 `kCumdecayFp32`（身份 = K_cumdecay）与 `chunkVFp32`（身份 = v_beta）都已被 Step 2 消费完、且还没被 Step 4 写入，符合 :1466-1467 注释声明的死区。
- L1484-1488 定形桶下 `curV < vStepAligned_` 时把整个 `stateNd` 清零：DMA 只覆盖 `curV*realK_` 个元素，剩下的 `vStepAligned_ - curV` 行必须是 0，转置后才会成为 tile 的 0 列。
- L1489-1496 `V_MTE2` → 一次**连续** DMA → `MTE2_V`。L1492 `stateOffset = stateBaseOffset + v_i*realK_`：接口布局里 v 是行方向，所以偏移按 `v_i * realK_` 走；L1493 `DataCopy(stateNd, initStateGm_[stateOffset], curV * realK_)` 是纯 1D 搬运——**接口 `[dv, dk]` 的本 tile 在 GM 里本来就是一段连续内存**，这是"转置发生在 UB 而不是 GM"的前提，也是它比 !1108 逐元素标量读快一个量级的原因（!1108 是同文件 :778-786 的 `realK×curV` 对 GetValue/SetValue）。
- L1498-1501 转置参数：`repeatTimes = kBlockCount`（沿 k 分形重复）；`srcRepStride = 1`（每次重复在源行内前进 1 个元素，取第 `16*block+?` 个分形的列段）；`dstRepStride = vStepAligned_`（每次重复在目的侧落到转置 tile 的下一分形行块）。两个 `(kBlockCount == 1) ? 0 : ...`：只有一组时步进参数不参与寻址，硬件要求填 0，避免越界。这与 `ComputeAttnProductsCube` :1049-1052 里 `(srcRepStride=1, dstRepStride=kMatmulM)` 的同向用法互为镜像——那处方向是"把 K 转成 Kᵀ"，本处方向是"把 `[dv,dk]` 转成 `[dk,dv]`"。
- L1502-1510 外层沿 v 分块、内层组装 16 个源行指针与 16 个目的行指针：`srcRows[row]` 步进 `realK_`（源行距），`dstRows[row]` 步进 `vStepAligned_`（目的行距）。一次 `TransDataTo5HD<inType>` 完成一个 16(v)×16(k) → 16(k)×16(v) 的分形转置，共 `vBlockCount` 次。栈上 16 个 `LocalTensor` 数组是这条指令的接口形状要求（它要"一批行"，不接受单张量），所以有 `srcRows[kTransposeBlock]` 这种定长数组。
- L1511-1513 `PipeBarrier<PIPE_V>` → `Cast(stateInFp32, stateTransposed, CAST_NONE, stateElementCount)` → 再一次 `PipeBarrier`：FP16→FP32 整块升精度落到最终 tile（`stateTransposed` 已按 `[dk, vStep]` 排好，所以这次 Cast 是**同向逐元素**，不需要再排布）。
- L1514 `return;` 走掉了，L1515 `}` 收守卫。

### 5.5 标量 fallback 与两个 TQueSync（L1517-1531）

- L1517-1519 `TQueSync<PIPE_V, PIPE_S> clearStateSync` + Set/Wait：**V→S 栅栏**，卡在标量循环之前。原因：进入本分支前 V 管至少执行过 L1433 的整块 `Duplicate`（可能还有 L1486 的清零），而接下来标量管要 `SetValue` 写同一个 `stateInFp32`；不清这个点，标量写可能与未退休的向量写在 UB 上交错。写成 `TQueSync` 而不是 `PipeBarrier<PIPE_V>`：后者只在 V 管内序列化，**不会**让 S 管等；只有 `<PIPE_V, PIPE_S>` 这个跨管通道能表达"V 的在途工作退休之后 S 才继续"。这是 !1108 没有的一处栅栏（对照 00e39ab5 的 Step 3；本仓库另一处同类补齐见 :2398 `finalStateSync`）。
- L1520-1525 双层标量循环：`stateOffset = stateBaseOffset + (v_i+v)*realK_ + d`（接口方向）↔ `d*vStepAligned_ + v`（内部方向），下标互换即转置；`static_cast<float>` 是 FP16→FP32 的标量等价 Cast。
- L1526-1527 注释原文：初始状态由标量 `GetValue/SetValue` 载入、被向量 `Muls` 消费——一句话点明下一对栅栏的方向。
- L1528-1530 `TQueSync<PIPE_S, PIPE_V> initialStateSync` + Set/Wait：**S→V 栅栏**，让后续 `ComputeVNew`/`ComputeAttnInter` 的向量读看到完整的标量写。注意它和 L1517 那对构成"进/出"两次跨管握手，`PIPE_ALL` 在这里不合适（会连 MTE/M 管一起压平，融合路径下代价太大）。
- L1531-1533 函数收尾 `}`、空行、Step 4 注释首行。

## 6. chunk_gated_delta_rule.h:1534-1555 — ComputeVNew：Step 4 的 Vector 主体

锚点：chunk_gated_delta_rule.h:1534-1555

```cpp
  // Step 4: v_new = value_new - (k_cumdecay @ state) -> chunkVFp32 (reused).
  __aicore__ inline void ComputeVNew(uint32_t chunkLen, uint32_t avFp32) {
    if (likely(IsCubeFastPath(chunkLen, avFp32))) {
      ComputeVNewCube(chunkLen, avFp32);
      return;
    }
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> vpRow = chunkVFp32[i * avFp32];
      Duplicate(vpRow, 0.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      for (uint32_t d = 0; d < realK_; d++) {
        float kcd = chunkKFp32.GetValue(i * alignK_ + d);
        LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
        Axpy(vpRow, stRow, kcd, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
      Muls(vpRow, vpRow, -1.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      Add(vpRow, vpRow, chunkAttnOutFp32[i * avFp32], vStepAligned_);
      PipeBarrier<PIPE_V>();
    }
  }
```

- L1535-1538 与 L1412-1415 同构的 Cube 分支（`ComputeVNewCube`，:1822）；同样在终态不可达（能进本函数代表 `IsCubeFastPath` 为假）。
- L1539-1541 每行先 `Duplicate(vpRow, 0, vStepAligned_)`：`chunkVFp32` 的旧身份是 v_beta，Step 4 要在同一块上重建 v_new，所以逐行清零；宽度用 `vStepAligned_`（含 padding），保证 padding 也是 0。
- L1543-1548 GEMV 主循环：`kcd = chunkKFp32[i*alignK_+d]` 标量读 UB（`chunkKFp32` 此刻身份 = K_cumdecay，被 :1290 附近的 Cube 结果覆盖过），`stRow` 是 S 的第 d 行，整行 Axpy。发射次数 `chunkLen*realK_ = 8192`（`dk=128`），是 !1108 V 侧最重的一段，也是融合 Cube 的主要收益来源。
- L1549-1551 减法靠两条指令凑：`Muls(-1)` 取负、`Add` 上 Step 2 的结果。`Adds`（标量加）在本函数不需要，因为整行加用 `Add`。!1108 的 :805-807 与此完全相同——**这两条 pass 是融合版要消灭的对象**（09 篇 §2：取负融进 A 侧、相加融进同一次 L0C 累加）。
- L1552-1555 三处 `PipeBarrier<PIPE_V>` 之一收 `Add`、循环/函数收尾。

## 7. chunk_gated_delta_rule.h:1556-1580 — StageHalfWithResidual：FP32→FP16 hi/lo 分裂出口

锚点：chunk_gated_delta_rule.h:1556-1580

```cpp
  __aicore__ inline void StageHalfWithResidual(LocalTensor<float> src, LocalTensor<float> scratch,
                                               GlobalTensor<half> hiStageGm, GlobalTensor<half> loStageGm,
                                               uint32_t elementCount) {
    LocalTensor<half> stageLocal = stateOutQueue_.AllocTensor<half>();
    Cast(stageLocal, src, RoundMode::CAST_NONE, elementCount);
    PipeBarrier<PIPE_V>();
    stateOutQueue_.EnQue<half>(stageLocal);
    stageLocal = stateOutQueue_.DeQue<half>();
    DataCopy(hiStageGm, stageLocal, elementCount);

    event_t mte3ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE3_V));
    SetFlag<HardEvent::MTE3_V>(mte3ToVector);
    WaitFlag<HardEvent::MTE3_V>(mte3ToVector);
    Cast(scratch, stageLocal, RoundMode::CAST_NONE, elementCount);
    PipeBarrier<PIPE_V>();
    Sub(scratch, src, scratch, elementCount);
    PipeBarrier<PIPE_V>();
    Cast(stageLocal, scratch, RoundMode::CAST_NONE, elementCount);
    PipeBarrier<PIPE_V>();
    stateOutQueue_.EnQue<half>(stageLocal);
    stageLocal = stateOutQueue_.DeQue<half>();
    DataCopy(loStageGm, stageLocal, elementCount);
    stateOutQueue_.FreeTensor(stageLocal);
  }
```

逐行：

- L1556-1558 形参：`src` = 要送进 Cube 的 FP32 矩阵（ND、行主序）；`scratch` = 同尺寸 FP32 暂存，由**调用方**指定（决定"牺牲哪个缓冲"）；`hiStageGm` / `loStageGm` = GM 上两个不相交子区；`elementCount` = 元素数。`elementCount*sizeof(half)` 必须是 32B 整数倍——所有调用点的尺寸（`kAAttnElements`、`kAStateElements`、`kAElements`）都是 16 的倍数，成立。
- L1559 `stateOutQueue_.AllocTensor<half>()`：见下面"为什么借队列"。`TQue<QuePosition::VECOUT, 1>`（:2423）只有 1 个 buffer，因此第 `n+1` 次调用会阻塞到第 `n` 次的 `FreeTensor`——**队列本身就是 staging 写入的天然串行化**。
- L1560 `Cast(stageLocal, src, CAST_NONE, elementCount)` → `hi = fp16(X)`。`CAST_NONE` 是"按硬件默认舍入"，不是"不做转换"；这里就是 24 位尾数压到 11 位，产生量化误差。
- L1561 `PipeBarrier<PIPE_V>()`：让 Cast 在 V 管内退休，`EnQue` 打点时队列里才没有半写数据。
- L1562-1563 `EnQue` / `DeQue`：把 buffer 交回 VECOUT 队列再取出，语义上建立"V 生产完毕 → 下游（MTE3）可消费"的交接点。这里**没有**新的数据流动，`EnQue/DeQue` 被当作交接口用（与 `WriteAttnTileToGm` :2354-2355、`UpdateAndWriteState` :2354-2355 同一手法）。
- L1564 `DataCopy(hiStageGm, stageLocal, elementCount)`：MTE3 发起的 UB→GM 写，即"hi 出片"。GM 目标由调用方从 `GetCubeStageBase(slot)` 切出来的子区（09 篇 :1613-1622）。
- L1566-1568 `MTE3_V` 事件对：下一条 `Cast` 要**覆写 `stageLocal`**，而 MTE3 可能还在读它——这是 WAR（写后读）竞争，方向是"MTE3 完成后 V 才能继续"，所以用 `MTE3_V`。注意它同时也保证 hi 已经落到 GM（L1569 之后 GM 侧的 hi 与 UB 侧的 hi 是同一份数据）。
- L1569 `Cast(scratch, stageLocal, CAST_NONE, elementCount)`：**FP16→FP32 反量化**，得到"被量化过的 X"在 FP32 里的表示 `X_hi`。这一步必须在 L1566-1568 之后：读的是 `stageLocal` 这个 UB 副本，而它正被 MTE3 占用。
- L1570-1571 `Sub(scratch, src, scratch, elementCount)` → `scratch = X − X_hi` = 残差。为什么这一步是精确的：`X_hi` 只保留 11 位尾数，`p/2 = 12 ≥ 11`，按 Dekker 分裂引理，`X − X_hi` 的有效位不超过 24−11 位，**在 FP32 中可精确表示**，残差本身零误差。
- L1572-1573 `Cast(stageLocal, scratch, CAST_NONE, elementCount)` → `lo = fp16(X − X_hi)`。`lo` 的量级约 `|X|·2^-12`，再被 FP16 舍入一次，引入的是 `lo` **自身**的 11 位相对精度，所以 `hi + lo` 合成约 22 位有效尾数（FP32 是 24 位）。
- L1574-1577 第二遍 `EnQue/DeQue` + `DataCopy(loStageGm, ...)`：lo 出片到第二个 GM 子区。为什么不再需要 `MTE3_V`：L1578 立即 `FreeTensor`，队列只有 1 个 buffer，下一次 `AllocTensor` 必然等它释放，覆写风险被队列挡住。
- L1578-1580 `FreeTensor` 归还、函数收尾、`StageHalf` 签名前空行。

**为什么复用 `stateOutQueue_` 来借 FP16 内存**（这是本函数最容易被忽略的一处设计）：

1. 容量刚好够。队列在 :139-143 按 `max(stateTile, chunkOut)` 的 **outType(FP16) 字节数** 分配：桶宽 128 时 `max(128*128, 64*128)*2 = 32KB`。本函数被要求承载的最大一次 `elementCount` 是 `kBStateElements = kStateK*kMatmulN = 128*128 = 16384` 个 half = 32KB——**恰好等于队列尺寸**，因为最大的那片 FP16 操作数就是 state tile `[dk, vStep]`，而队列当初就是为它开的。桶宽 64 时同理（`64*64*2 = 8KB`，队列 `max(64*64, 64*64)*2 = 8KB`）。
2. 不侵入 `tmpBuff`。`tmpBuff` 的尺寸由 host 侧 `ComputeTmpBuffBytes` 精确算尽（tiling.cpp:136-157），`restUbSize_` 一分不剩；在这里塞一块 FP16 staging 就要改 tiling 公式、压缩别的缓冲。
3. 自带跨管语义。`TQue<VECOUT>` 的生产者/消费者是 V 与 MTE3，`AllocTensor/EnQue/DeQue/FreeTensor` 四步把"能不能写这块 UB、MTE3 有没有在读"这两类竞争交给队列管理，函数体内只剩 `MTE3_V` 一处需要手写事件。
4. 天然串行化 staging 写入。`BUFFER_NUM = 1`（:34）意味着两次 `StageHalf*` 调用不可能同时占着 staging——这正是"同一时刻只有一个 Cube 乘积在准备操作数"的实现约束；跨 Cube 函数的真并行是**GM 双 slot**（`CUBE_STAGE_SLOT_COUNT = 2`，:39）提供的，不是这块 UB staging。

**调用点清单**（:470-471 的 32×32 分块乘是唯一对 A、B 双方都分裂的地方，其余全部只对 A 分裂）：`MatmulBlockFp32Compensated` :470/:471、`ComputeAttnProductsCube` :1068/:1113、`ComputeKCumdecayCube` :1239、本篇三个定形函数 :1632/:1682/:1761/:1842、`ComputeOutputCube` :1954/:2006。

## 8. chunk_gated_delta_rule.h:1581-1595 — StageHalf：无残差版与融合函数的预告注释

锚点：chunk_gated_delta_rule.h:1581-1595

```cpp
  __aicore__ inline void StageHalf(LocalTensor<float> src, GlobalTensor<half> stageGm, uint32_t elementCount) {
    LocalTensor<half> stageLocal = stateOutQueue_.AllocTensor<half>();
    Cast(stageLocal, src, RoundMode::CAST_NONE, elementCount);
    PipeBarrier<PIPE_V>();
    stateOutQueue_.EnQue<half>(stageLocal);
    stageLocal = stateOutQueue_.DeQue<half>();
    DataCopy(stageGm, stageLocal, elementCount);
    stateOutQueue_.FreeTensor(stageLocal);
  }
```

- L1581-1588 就是 `StageHalfWithResidual` 去掉 L1566-1577 的残差段：一次 Cast、一次出片、一次 FreeTensor。
- 与带残差版的关系是"同一出口的两个精度档"：**B 侧用 `StageHalf`，A 侧用 `StageHalfWithResidual`**。选档判据是"这个操作数的 FP16 截断误差能不能被容忍"：`StageHalf` 的调用点（`chunkVFp32` = v_beta、`stateInFp32` = state tile、`kCumdecayFp32` = K'_beta）都是"从 FP16 输入升上来的量或它的线性组合"，误差量级已经不小于一次 FP16 舍入，再补 lo 半区收益有限而代价是**双倍 GM 写 + 双倍 Mmad**。
  这一点与 docs/PR-1135-d0906c3e/01-Cube化深度精读.md §2.2 的表述有出入：该文写"消费端（§3 各函数）把 4 个叉积在 FP32 L0C 累加"，展开式 $(A_{hi}+A_{lo})(B_{hi}+B_{lo})$ 也确实只有 4 项。**实测本文件里只有 `MatmulBlockFp32Compensated`（:486/:488/:491/:493）做满 4 次 Mmad**（它对 A、B 都调 `StageHalfWithResidual`）；本篇与 09 篇的三个定形函数每乘积只做 2 次（`A_hi·B_hi` + `A_lo·B_hi`），B 侧截断误差未补偿。

## 9. chunk_gated_delta_rule.h:1596-1602 — ComputeValueAndVNewCubeDispatch：按 kSpecializedDk 选路

锚点：chunk_gated_delta_rule.h:1596-1602

```cpp
  // Fixed-shape fused Step 2 + Step 4:
  //   v_new = lower(attn) @ v_beta - k_cumdecay @ state.
  // Both products accumulate in the same FP32 L0C matrix. Compared with the
  // former pair of Cube functions this removes one L0C->UB conversion, the
  // intermediate value_new tile, and the final Vector negate/add pass.
  __aicore__ inline void ComputeValueAndVNewCubeDispatch(uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset,
                                                         uint32_t v_i, uint32_t curV, uint32_t c) {
    if constexpr (kSpecializedDk != 0) {
      ComputeValueAndVNewCube<kSpecializedDk, kSpecializedDk>(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    }
  }

```

- L1596-1597 签名：五个参数原样转发给模板版实现；`stateBaseOffset`/`workspaceStateBaseOffset` 之所以要透传，是因为融合函数内部要自己调 `LoadStateTile`（:1679）——转置/清桩逻辑完全复用本篇 §5，不存在第二份实现。
- L1598 `if constexpr (kSpecializedDk != 0)`：**编译期**判空。`kSpecializedDk == 0`（dk > 128，host 侧 `SelectCubeDk` :212-227 返回 0）时函数体被整体裁掉，避免用 0 去实例化模板参数（`kMatmulN = 0` 会让所有 `X/16`、`kMatmulN/16` 变成除零/空数组，编译期即错）。运行期正确性由 :1313 的 `likely(useFusedCubeFastPath)` 保证——`IsCubeFastPath` 在 `kSpecializedDk == 0` 时无条件返回 false（:261），所以永远不会走到这个空函数体。
- L1599 两个模板实参都填 `kSpecializedDk`：`kStateK`（第二乘积的 K 维 = state 的行数 = dk 桶宽）与 `kMatmulN`（V 方向 tile 宽）。**它俩必然相等**，因为 `preferredVStep = cubeDk`（tiling.cpp:299）刻意把 V tile 宽度和 K 桶宽绑到同一档——注释在 :296-298："Keep V and padded K on the same regular Cube tile"。这一步选路把融合函数体内所有尺寸变成编译期常量，`Nd2NzParams`/`LoadData2DParams`/`MmadParams` 全部立即数化。
- L1600-1602 收尾 `}`、`}`、空行（1603 起是 09 篇的模板定义）。
- 与分支初版 `src/a9c66ddb` 的同名函数对比（a9c66ddb:1583-1590），这里藏着一段真实的演进：

```cpp
// src/a9c66ddb/op_kernel/chunk_gated_delta_rule.h:1585-1590（节选）
    if constexpr (kSpecializedDk == 128) {
      ComputeValueAndVNewCube<128, 128>(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    } else if constexpr (kSpecializedDk == 80) {
      ComputeValueAndVNewCube<80, 80>(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    }
```

  初版只有 80/128 两档进融合路径（64/96 档的 `if constexpr` 两个分支都不成立 → 空函数体），且尺寸是写死的字面量；终态改成 `!= 0` + `<kSpecializedDk, kSpecializedDk>` 后，四档桶共用一份模板，同时 `LoadStateTile` 里三处 `kSpecializedDk == 80` 的守卫（a9c66ddb:1431/:1465/:1491）也一并放宽成 `!= 0`。**演进方向是把"桶宽决定代码路径"的 N 处二元判断收敛成一处 constexpr 实参**，加一档桶只改 tiling 的常量表，不动 kernel。