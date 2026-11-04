# 10 · Output 与 StateUpdate 的 Cube 融合（上）：ComputeOutputCube

## 0. 结论先行

锚点：chunk_gated_delta_rule.h:1918-2093

1. **`ComputeOutputCube` 把 Step5 和 Step6 压成一次 L0C 累加**：`output = (Q·e^g) @ S + lower(attn_i) @ v_new`
   写成"两个乘积、四个 Mmad、一块 L0C、一次 L0C→UB、一次 NZ→ND"。全函数没有任何一次"中间结果落地再读回"。
2. **省掉的那次往返可以精确算出来**：`attn_inter` 是 `[64,128]` FP32 tile = **32768 B**。
   !1108 的写法是 Step5 把它 `Duplicate+Axpy` 写进 `chunkAttnOutFp32`，Step6 再逐行读回来累加
   （`00e39ab5:814-816` 写、`00e39ab5:836` 读），即 32 KB 的一写一读 + 32 KB 的第二次读；
   融合后 `attn_inter` 只存在于 L0C 里，直到两个乘积都加完才搬出一次。省的是**一次 UB 写 + 一次 UB 读 + 一块 UB 中间矩阵的身份**。
3. **B 矩阵是白捡的**：第一个乘积的 B（FP16 state tile）**不是本函数装的**。
   上一个函数 `ComputeValueAndVNewCube` 在 `:1683` 用 `StageHalf(stateInFp32, bStageGm, kBStateElements)`
   把 state 写进 GM slot0 的 B 段，本函数 `:1968` 直接从**同一个地址、同一个元素数**把它 Nd2Nz 进 L1。
   两个函数对 `kAStateElements / kBStateElements` 用的是同一组 constexpr，所以偏移逐字节重合（见 §3 的算术）。
   这是"融合"的第二层收益：连 B 侧的 GM 暂存都只花一次。
4. **补偿分裂只在 A 侧**：本函数的 4 次 Mmad 是 `(A_hi + A_lo) · B_fp16` 两个乘积各两次，
   不是四叉项全展开。四次乘积（`A_hi B_hi + A_lo B_hi + A_hi B_lo + A_lo B_lo`）只出现在
   `MatmulBlockFp32Compensated`（`:454`，见 05 章）里——那里 B 侧也做 hi/lo。
   全文件的 `StageHalf*` 调用点里只有 `:471` 一处给 B 做残差（grep 可证）。主循环所有 Cube 函数的 B 都是**单次 FP16 量化**。
5. **Dispatch 只做一件事**：把模板桶宽 `kSpecializedDk` 同时喂给 `kStateK` 与 `kMatmulN`
   （`:1920`），并用 `if constexpr (kSpecializedDk != 0)` 让整个函数在非桶化实例里被编译期裁掉。
   与 !1135 初版 `a9c66ddb:1907-1914` 的 `== 128 / == 80` 两分支枚举相比，终态把所有桶统一成一条 `!= 0`。
6. **两处 Vector fallback（2058-2093）与 !1108 不是逐字节相同**：算术、循环、缓冲身份**完全一致**，
   唯一差异是 !1108 里 3 行 `TQueSync<PIPE_S, PIPE_V> coefficientSync` 的声明与 `SetFlag/WaitFlag` 对被删掉了。
   因为不是零改动，§10 完整重讲，并把这处删除单独评估。
7. **`:1914-1917` 的函数头注释（属于 09 章区间 1603-1917）说的就是本章的函数**：
   "Fuse Step 5 and Step 6 for the fixed 64x128 fast path"——读到 1918 行之前必须先看那 4 行。

**融合收益账（单 chunk 单 V-tile，128 桶）**

| 项 | !1108（`:811-846`） | d0906c3e 快路径（`:1918-2055`） |
| --- | --- | --- |
| Q·e^g 系数取数 | 8192 次标量 `queryGm_.GetValue` | 1 条带 gap 的 2D DMA（`LoadPaddedRows`） |
| attn_inter 的算术 | 64 行 × 128 = 8192 条 `Axpy` | 2 次 Mmad（A_hi/A_lo × 驻留 B） |
| attn_inter 落地 | 写 `chunkAttnOutFp32` 32 KB，再读回 | 不落地，留在 L0C |
| attn_i @ v_new | 2080 条 `Axpy`（下三角平均 32.5 × 64 行） | 2 次 Mmad 续累加进同一 L0C |
| 清上三角 | 不需要（循环用 `jj <= i` 表达） | 63 条 `Duplicate`（`:2002-2004`） |
| L0C→UB + NZ→ND | 无 | 1 次矩阵模式 DataCopy + 64 次行 DataCopy |
| 跨管事件 | `TQueSync` S↔V × 10240 处 | `MTE2_MTE1 / MTE1_M / M_MTE1` 成对 × 4 |

## 1. Dispatch：桶宽同时喂给两个模板参数

锚点：chunk_gated_delta_rule.h:1918-1923

```cpp
  // Fuse Step 5 and Step 6 for the fixed 64x128 fast path:
  //   output = (Q * exp(g)) @ state + lower(attn_i) @ v_new.
  // Both products accumulate in one L0C matrix. A high/low FP16 split keeps
  // the same FP32-accumulation accuracy strategy used by ComputeVNewCube. 
  __aicore__ inline void ComputeOutputCubeDispatch(int32_t t_start, uint64_t qkHead) {
    if constexpr (kSpecializedDk != 0) {
      ComputeOutputCube<kSpecializedDk, kSpecializedDk>(t_start, qkHead);
    }
  }

```

- `:1918` 形参只有 `t_start`（chunk 首 token 在 T 上的偏移）与 `qkHead`（GQA 下 Q/K 的头号），
  没有 `chunkLen / avFp32`——因为能走到这里就说明 `IsCubeFastPath` 已经保证 `chunkLen==64`、
  `avFp32 == vStepAligned_ == kSpecializedDk`（`:257-262`），全部形状信息都进了模板参数。
- `:1919-1921` 用 `if constexpr` 而不是 `if`：`kSpecializedDk == 0` 的兜底实例（dk>128 时用 96 桶类跑纯 Vector，
  见 02 章 tiling 的 `tilingKey = 2` 分支）里，函数体被编译期删掉，`ComputeOutputCube` 也不会被实例化，
  否则 L0C 分配器和 `Nd2NzParams` 会凭空多出四份模板代码。
- `:1920` 把同一个桶宽传给 `kStateK` 和 `kMatmulN` 两个位置：
  乘积是 `[64, alignK_] @ [alignK_, alignK_]`，K 方向（state 的行数）和 N 方向（state 的列数）都等于桶宽，
  所以两者同值；写成两个参数是为了让同一个模板体也能被非方阵调用（对照 `:2096` 同样是 `<kSpecializedDk, kSpecializedDk>`）。
- 与 !1135 初版的差异（`a9c66ddb:1907-1914`）：那里逐个枚举 `== 128` / `== 80`，
  64/96 两个桶**没有** Cube 输出版本，只能走 fallback；终态一行 `!= 0` 覆盖四桶。

## 2. 两组乘积的尺寸常量

锚点：chunk_gated_delta_rule.h:1924-1932

```cpp
  template <uint32_t kStateK, uint32_t kMatmulN>
  __aicore__ inline void ComputeOutputCube(int32_t t_start, uint64_t qkHead) {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kAttnK = 64;
    constexpr uint32_t kAStateElements = kMatmulM * kStateK;
    constexpr uint32_t kBStateElements = kStateK * kMatmulN;
    constexpr uint32_t kAAttnElements = kMatmulM * kAttnK;
    constexpr uint32_t kBAttnElements = kAttnK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
```

- `:1924` 模板参数名 `kStateK` / `kMatmulN` 描述的是**第一个乘积**的 K 维与 N 维；
  第二个乘积的 K 维固定是 `kAttnK = 64`（chunk 方向），所以另起常量。
- `:1926-1927` 两个 64 是不同含义：`kMatmulM = 64` 是 chunkSize（输出行数），`kAttnK = 64` 是 attn 矩阵的列数（同一个 64 换身份）。
- 五个"元素数"常量的含义与 128 桶实数：

| 常量 | 公式 | 128 桶 | 字节（FP16） | 用途 |
| --- | --- | --- | --- | --- |
| `kAStateElements` | `64 × kStateK` | 8192 | 16384 | A₁ = Q·e^g，也用于 slot 偏移 |
| `kBStateElements` | `kStateK × kMatmulN` | 16384 | 32768 | B₁ = state tile |
| `kAAttnElements` | `64 × 64` | 4096 | 8192 | A₂ = lower(attn) |
| `kBAttnElements` | `64 × kMatmulN` | 8192 | 16384 | B₂ = v_new |
| `kCElements` | `64 × kMatmulN` | 8192 | 32768（FP32） | L0C，两个乘积共用 |

- 注意 `kAStateElements == kCElements`（都是 `64×kMatmulN`，因为 `kStateK == kMatmulN == 桶宽`）。
  `ComputeVNewCube` 在 `:1829-1831` 专门为这个巧合写了注释并要求"把名字拼全以免把 A 残差板当成 C 板"——
  本函数沿用同一命名，是刻意的防误读约定。

## 3. GM slot 的三段布局：A_hi / B / A_lo

锚点：chunk_gated_delta_rule.h:1933-1942

```cpp
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);

    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAStateElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAStateElements * sizeof(half)),
                             kBStateElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAStateElements + kBStateElements) * sizeof(half)), kAStateElements);
```

- `:1933` `GetCubeStageBase(0)` 取本核 slot0（`:249-255`，`workspaceAddr_` 之后是
  `B·NV·realK_·stateWorkspaceStrideV_` 个 FP32 的 state 区，再往后才是每核 `CUBE_STAGE_SLOT_COUNT=2` 个 64 KB slot）。
- `:1935-1942` 三段依次是 **A_hi、B、A_lo**。`aResidualStageGm` 的偏移是
  `(kAStateElements + kBStateElements) * sizeof(half)`，即 16 KB + 32 KB = **48 KB**，再加 16 KB 恰好压在 64 KB slot 尾上：
  `16384 + 32768 + 16384 = 65536 = CUBE_STAGE_SLOT_BYTES`（`:38`）。
  slot 大小不是估的，是这一处布局的等式；host 侧 `kRawMatmulStageBytesPerCore`（tiling.cpp:48）
  = `2 × (2·64·128 + 128·128) × 2B` = 128 KB = 2 slot，同样吻合。
- `SetGlobalBuffer(ptr, n)` 的第二个实参是**容量提示**（越界检查用），所以
  `aResidualStageGm` 用 `kAStateElements` 声明：它的最大消费者是第一个乘积（16 KB），
  第二个乘积用 `kAAttnElements`（8 KB）时只是把同一块地址当小矩阵读。
- 第二个乘积复用这三段而**不重新声明偏移**（`:2006-2007`），靠的就是"第一个乘积消费完，slot 即死"这一条；
  与 `ComputeValueAndVNewCube:1675-1676` 的注释是同一套规矩。
- 为什么 A 要拆两段而 B 不拆：见 §0 第 4 点。A 侧是 FP32 中间量（Q 乘了 scale 和 e^g，attn 是 FP32 Cube 结果），
  B 侧的 state/v_new 虽然是 FP32 存储，但它们的**上游本来就是 FP16 语义**（state 要写回 FP16 final_state），
  所以作者只在 A 侧做补偿，B 侧一次 `Cast` 到底。

## 4. Q 板：借 chunkKFp32 当 FP16 暂存，把两重缩放吸收进行系数

锚点：chunk_gated_delta_rule.h:1943-1955

```cpp

    // Cache the complete Q chunk with one strided DMA, then apply scale and
    // exp(g) one row at a time. This replaces 8192 scalar GM GetValue calls.
    LocalTensor<inType> queryLocal = chunkKFp32.template ReinterpretCast<inType>();
    uint64_t queryOffset = (static_cast<uint64_t>(t_start) * NK_ + qkHead) * realK_;
    LoadPaddedRows(kCumdecayFp32, queryLocal, queryGm_, queryOffset, kMatmulM, NK_ * realK_);
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      float rowScale = scale_ * expGCumFp32.GetValue(row);
      Muls(kCumdecayFp32[row * kStateK], kCumdecayFp32[row * kStateK], rowScale, kStateK);
    }
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, kAStateElements);
    PipeBarrier<PIPE_ALL>();
```

- `:1944-1945` 注释点明了这一段的动机：替换 8192 次标量 GM 读。这正是 !1108 `ComputeAttnInter`
  （`00e39ab5:821` `queryGm_.GetValue(qkOff + d)`）的痛点，也是本章 §10 对照的落点。
- `:1946` **借 `chunkKFp32` 的 UB 空间当 FP16 暂存板**（`ReinterpretCast<inType>()`）。
  此刻 `chunkKFp32` 的身份是 `k_cumdecay`（被 `ComputeKCumdecayCube` 在 `:1291` 覆盖），
  而 `k_cumdecay` 的唯一消费者 `ComputeValueAndVNewCube` 已在 `:1682` 用完它 → 板子已死，借用合法。
  容量：`LoadPaddedRows` 会写 `rows × alignK_ = 64 × 128 = 8192` 个 FP16 = 16384 B，
  而 `chunkKFp32` 有 `cs × alignK = 8192` 个 FP32 = 32768 B，用掉一半（11 章表 (c) 第 15 行）。
- `:1947` 偏移 `((t_start)·NK_ + qkHead) · realK_`——Q 在 GM 是 `[T, Nk, Dk]` 行主序，
  一次跨 `chunkLen=64` 行、行内 `realK_` 元素、行距 `NK_·realK_` 的 2D 抓取。
- `:1948` `LoadPaddedRows(dst=kCumdecayFp32, staging=queryLocal, src=queryGm_, rows=64, gmRowElements=NK_·realK_)`：
  内部是"清零 → 带双 gap 的 DMA → 尾巴标量 → 整块 `Cast` FP16→FP32"（`:272-340`，04 章细讲）。
  **注意 Cast 的源和目的不是同一块**（`staging` 在 chunkK 上、`dst` 在 kCumdecay 上），
  所以这里没有 !1158 那类原地加宽自毁问题（对比 §11 章风险清单第 2 行）。
- `:1949-1952` 逐行乘 `scale_ · e^{G_i}`：行系数不同所以必须 64 次 `Muls`，
  每次作用域是 `row*kStateK` 起、长度 `kStateK`（= 桶宽，含零填充列——填充列乘任何系数仍是 0）。
  这一步把 attn_inter 的"两重缩放"（softmax 前的 1/√dk 与门控衰减 e^g）**吸收进 A 的源**，
  于是 Step5 的公式在 Cube 侧退化成一个纯矩阵乘。
  `expGCumFp32.GetValue(row)` 是标量管读，`rowScale` 以立即数形式进 V 指令；
  它依赖 `PrepareDecayAndExp` 尾部 `:937-940` 的 `TQueSync<PIPE_V, PIPE_S>` 保证 expGCum 已写完。
- `:1953` `PipeBarrier<PIPE_V>()`：64 条 Muls 之间只需管内有序（`Muls` 是 dst/src 同址的原地写，
  下一条 `Muls` 打不同行，但 `StageHalfWithResidual` 要读整块，所以这里统一收口）。
- `:1954` `StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, kAStateElements)`：
  A 侧 hi/lo 分裂（`:1556-1579`，08 章细讲）。第二个实参 `chunkAttnOutFp32` 是**残差 scratch**——
  此刻输出的 FP32 tile 已经被 `WriteAttnTileToGm` 消费过？没有：`ProcessOneVTile` 的顺序是
  `ComputeOutputCubeDispatch`（`:1321`）→ `WriteAttnTileToGm`（`:1326`）→ `UpdateAndWriteState`（`:1327`），
  所以 **`chunkAttnOutFp32` 在本函数里既是 scratch 又是最终输出目标**：
  `StageHalfWithResidual` 用它算 `src - hi(src)`（`:1570`），随后 `:2052` 又用同一个块接收 L0C 结果，
  两者被 `:1955` 的 `PipeBarrier<PIPE_ALL>()` 严格分开。
- `:1955` `PipeBarrier<PIPE_ALL>()`：MTE3（`StageHalf*` 内部往 GM 写）与后续 MTE1/M 管发射之间的全局收口。

## 5. 四级片上分配器

锚点：chunk_gated_delta_rule.h:1956-1965

```cpp

    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kAStateElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBStateElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kAStateElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBStateElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCElements);
```

- `:1956-1960` 四个 `LocalMemAllocator<Hardware::Lx>` 分别管 L1、L0A、L0B、L0C 四块**片上 Cube 存储**。
  它们是 RAII 式的：构造即取得该硬件域的基址，`Alloc<TPosition, T>(元素数)` 在域内切一块并返回
  `LocalTensor`，离开作用域自动归还。这就是"裸 Mmad 五件套"能不用高层 `Matmul` API 的原因——
  高层 API 里这些位置是隐藏的，作者必须自己点名。
- `TPosition` 五个枚举值是硬件端口名，不是软件概念：
  `A1/B1` = L1 里的 A/B 暂存区（ND→NZ 之后的落点），
  `A2/B2` = L0A/L0B（Mmad 的**唯一**可读入口），
  `CO1` = L0C 的 C 输出区（FP32，NZ 分形序）。
  310P 的 `dav_m200` **没有 UB→L1 的直连通路**，所以 UB 里的 FP16 必须 MTE3 写 GM、再由 MTE2 用 `Nd2NzParams` 搬进 A1/B1（§3）。
- `:1961-1964` 分配量取第一个乘积（较大者）的尺寸，第二个乘积用同一批指针配不同 `LoadData` 参数——
  `a2Local` 在 64×128 与 64×64 之间复用，`b2Local` 在 128×128 与 64×128 之间复用。
  这是"取最大值分配、按当次形状寻址"的惯例，省得在 L0 域里来回申请释放。
- `:1965` `c1Local` 是 FP32 的 `[64, kMatmulN]`，即 32 KB；`init=true` 的第一次 Mmad 会整块清零重写。
  四个 Mmad 全部写同一块 `c1Local`，**这就是"融合"的物理载体**。

## 6. 第一乘积：五件套 + A_lo 补偿

锚点：chunk_gated_delta_rule.h:1966-1994

```cpp

    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kStateK, 0, kStateK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kStateK, kMatmulN, 0, kMatmulN, kStateK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kStateK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kStateK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kStateK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kStateK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kStateK, 0, false, true});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kStateK, 0, kStateK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kStateK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kStateK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kStateK, 0, false, false});
```

- `:1967-1968` 两条 `DataCopy(..., Nd2NzParams{...})` 是 GM→L1 的 **ND→NZ 转换搬运**。
  实参按 `(固定 1, 行数, 列数, 0, 源行跨距=列数, 目的块跨距=行数, 1, 0)` 排列：
  `:1967` 是 `[kMatmulM=64 行, kStateK 列]` 的 A 板，`:1968` 是 `[kStateK 行, kMatmulN 列]` 的 B 板。
  NZ（fractal）排布 = 16×16 小块的列优先平铺；Cube 只认 NZ，ND→NZ 这一步在 !1108 的世界里根本不存在。
  `DataCopy` 由 **MTE2 管**发起，落到 L1 的 A1/B1 位置。
- `:1969-1970` `SetFlag/WaitFlag<HardEvent::MTE2_MTE1>(0)`：MTE2 搬完 → MTE1 才能读 L1。
  参数 `0` 是事件槽编号（硬件有少量事件槽，同槽不成对使用会串味）。
  **成对栅栏只保证跨管有序，不保证与 V 管有任何关系**——这是它和 `PipeBarrier` 的本质区别（§7 末再对比）。
- `:1971-1974` `LoadData` 循环把 L1 的 A 板按 16 行一组搬进 L0A（MTE1 管）。
  `a1Local[mBlock * 512 / sizeof(half)]`：一个 16×16 FP16 分形 = 512 B = 256 元素；
  `a2Local[mBlock * kStateK * 16]`：L0A 里每个分形占 `kStateK×16` 个元素槽（沿 K 方向铺满）。
  `LoadData2DParams{0, kStateK/16, kMatmulM/16, 0, 0, false, 0}` 的可见语义是
  （保留 0、源侧每次推进 `列/16` 块、搬运块数 `行/16`、…、最后 `isA2=false` 表示目标是 A 端口）。
- `:1975-1978` 同法装 B，`isA2=true` 表示"按 B 端口的 K 优先分形序写入"，推进量换成 `kMatmulN/16`。
- `:1979-1980` `MTE1_M`：L0 装载完成 → Mmad 才能开火。
- `:1981` **第一次 Mmad**：`MmadParams{kMatmulM, kMatmulN, kStateK, 0, false, true}`
  = `(m=64, n=kMatmulN, k=kStateK, …, …, init=true)`。
  `init=true` 让 L0C 先清零再累加，即"这一次乘积是新账本的第一笔"；
  `m/n/k` 是**分形外的完整尺寸**，硬件内部按 16×16×16 分形流水展开。
  这一次吃的是 `A_hi · B`。
- `:1983-1994` 补偿项 `A_lo · B`：`M_MTE1` 等 Mmad 让出 L0A/L0B → 重新 `DataCopy` A_lo（`:1985`）→
  重新 `LoadData` 到同一个 `a2Local`（`:1988-1991`，`b2Local` **不动**，这就是 B 驻留的收益）→
  `:1994` 的 `Mmad` 末位 `init=false`，**加到同一块 L0C 上**。
- 每个 4 元组（DataCopy → MTE2_MTE1 → LoadData → MTE1_M）都是"同一件事的第二遍"，
  样板重复是裸 Cube 编程的常态：Mmad 前必须保证 L0 里的操作数正是本次要的那份。
- **`:1968` 的 B 从未被本函数写入**——它的 GM 源由 `ComputeValueAndVNewCube:1683` 准备好（§0 第 3 点）。
  这也是为什么 `:1966-1994` 里看不到任何 `bStageGm` 的写侧代码。

## 7. 第二乘积的 A：在"已死的 K 板"上现做下三角

锚点：chunk_gated_delta_rule.h:1995-2008

```cpp

    // Build lower(attn_i) in one dead K buffer. Only the upper triangle needs
    // clearing; the lower triangle and diagonal are already contiguous.
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    Muls(kCumdecayFp32, decayMaskFp32, 1.0f, kAAttnElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t row = 0; row + 1 < kMatmulM; ++row) {
      Duplicate(kCumdecayFp32[row * kAttnK + row + 1], 0.0f, kAttnK - row - 1);
    }
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, kAAttnElements);
    StageHalf(chunkVFp32, bStageGm, kBAttnElements);
    PipeBarrier<PIPE_ALL>();
```

- `:1996-1997` 注释交代了两件事：**A 板借用一块已死的 K 缓冲**；**只需清上三角**（下三角与对角已经连续）。
- `:1998-1999` `M_MTE1` 双向栅栏：确认第一个乘积的 A_hi/A_lo 已经被 L0A 读走（`a2Local` 即将被覆盖，
  而 `kCumdecayFp32` 这块 UB 马上要被 attn 覆写）。
- `:2000` `Muls(kCumdecayFp32, decayMaskFp32, 1.0f, kAAttnElements)`：
  把 `decayMaskFp32`（此刻身份已是 QK 注意力矩阵，`:1010` 之后）以 ×1.0 的**整块身份迁移**到 `kCumdecayFp32`。
  `kAAttnElements = 4096`，而 `kCumdecayFp32` 有 `cs×alignK = 8192` 个 FP32——装得下，
  行跨距从 `chunkSize_` 变成 `kAttnK`（两者都是 64，所以是**同布局换名字**）。
  为什么不原地清 `decayMaskFp32`：`ClearUpperTriangle` 是破坏性写，
  `decayMaskFp32` 在慢路径（`:2081` 的 `AccumOutput`）里还要按 `chunkSize_` 跨距读；
  把破坏性操作放到已死板上，快慢路径就不必共享一份状态。这个手法在 `ComputeValueAndVNewCube:1626` 一模一样。
- `:2001` `PipeBarrier<PIPE_V>()`：管内收口。
- `:2002-2004` 逐行 `Duplicate(kCumdecayFp32[row*kAttnK + row + 1], 0.0f, kAttnK - row - 1)`：
  把第 row 行 `row+1` 之后清 0，共 63 条；最后一行（row=63）没有上三角要清，所以循环条件是 `row + 1 < kMatmulM`。
- `:2005` 再收一次，因为 `:2006` 的 `StageHalfWithResidual` 要读整块。
- `:2006` A₂ 的 hi/lo 分裂（scratch 仍是 `chunkAttnOutFp32`）。
- `:2007` `StageHalf(chunkVFp32, bStageGm, kBAttnElements)`：B₂ = `v_new`（FP16 无残差）。
  `chunkVFp32` 的身份链：`v_beta`（`:1368`）→ `v_new`（`:1728`/`:1905`）→ 这里被当成 B 的源。
  **写入 `bStageGm` 覆盖了第一个乘积的 state tile**——此时 state 已被 L0B 读走（`:1999-2000` 的栅栏保证），
  但 `stateInFp32` 本身仍是活的（Step7 要用），丢掉的只是它的 FP16 副本。
- `:2008` `PipeBarrier<PIPE_ALL>()`：MTE3 写完 GM 才允许 MTE2 读。

## 8. 第二乘积的五件套与"续累加"

锚点：chunk_gated_delta_rule.h:2009-2038

```cpp

    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kAttnK, 0, kAttnK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kAttnK, kMatmulN, 0, kMatmulN, kAttnK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kAttnK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kAttnK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kAttnK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kAttnK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kAttnK, 0, false, false});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kAttnK, 0, kAttnK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kAttnK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kAttnK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kAttnK, 0, false, false});

```

- 结构与 §6 完全同构，只有三处差异，逐条对齐：
  1. `:2010-2011` 的 `Nd2NzParams` 把 A 的列数换成 `kAttnK=64`，B 的行数换成 `kAttnK=64`；
  2. `:2024` 的 Mmad 末位是 **`false`**——这是全函数最关键的一个比特：
     它不重置 L0C，而是把 `lower(attn) @ v_new` **累加到 `attn_inter` 上面**，
     于是 Step5+Step6 的和在 Cube 内部完成，一次 L0C→UB 都不多花；
  3. `:2037` 同理（A₂_lo 的补偿项）。
- 四次 Mmad 的 init 序列是 `true, false, false, false`：只有一本账、一次开账。
  对照 `ComputeValueAndVNewCube:1660/1686`（也是 `true` 后接 `false`）——本 PR 里"融合"一词在硬件层的
  唯一体现就是**这个 `init` 位**。
- `:2026-2030` 的 `M_MTE1 → DataCopy → MTE2_MTE1` 是"等上一次 Mmad 释放 L0A，再灌 A_lo"，
  与 §6 同义；`:2035-2036` 之后 `:2037` 再等 `MTE1_M`。
- 样板行说明：`:2012-2013 / 2022-2023 / 2026-2027 / 2035-2036` 四条 `SetFlag/WaitFlag` 是
  四个管间边沿（MTE2→MTE1、MTE1→M、M→MTE1、MTE2→MTE1）各一次，不携带数据，只携带"完成"信号。

## 9. L0C 读回与 NZ→ND 算术

锚点：chunk_gated_delta_rule.h:2039-2055

```cpp
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LocalTensor<float> cNz = kCumdecayFp32;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();

    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(chunkAttnOutFp32[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```

- `:2039-2040` 最后一次 `M_MTE1`：Mmad 不再需要 L0A/L0B，同时把 L0C 的写暴露给后续读。
  **注意 !1174 之前这里缺的是 `M_V / V_M` 事件**（见 docs/PR-1174 篇 §3）——
  `:2046` 的 `PipeBarrier<PIPE_ALL>()` 只约束发射顺序，不保证 M 管的 DataCopy 执行完成后 V 才读，
  这正是 310P 长序列偶发 `L0C read/write conflict` 的位置（实测记录：docs/PR-1135 02 篇 §6.5）。
- `:2041` `LocalTensor<float> cNz = kCumdecayFp32;`：L0C 的落地缓冲区**又是那块死板**（A₂ 的 hi/lo 已进 GM）。
  需要 `kCElements = 64×kMatmulN` 个 FP32 = 32768 B，而 `kCumdecayFp32` 恰好 32768 B——**零余量**。
  对照 10b 章 `:2249/2253`：state 更新那里用的是 `chunkKFp32` 或 `tmpBuff` 头 2~3 块板的拼接。
- `:2042` `DataCopyParams cCopyParams{kMatmulN/16, kMatmulM/16, 0, 0}`。
  本仓库里 `DataCopyParams` 的字段序是 **`{repeatTimes, blockLen, srcStride, dstStride}`（块=32 B）**，
  可由 `CopyToGm:49-50` 与 `LoadPaddedRows:289-291` 反证。
  在 `BLOCK_MODE_MATRIX` 下 `blockLen` 的语义变成"每个 repeat 搬多少个 16×16 立方块"，
  于是这两个字面量正好是 `:1891-1892` 注释说的那句话：
  **搬 `N/16` 个分形组，每组含 `M/16` 个 16×16 块**。
- `:2043-2045` `DataCopyEnhancedParams` 只设 `blockMode = BLOCK_MODE_MATRIX`，其余字段默认 0；
  这条 DataCopy 的**发起管是 M**（L0C→UB 方向只有 MTE 与 M 能动 L0C）。
  搬完 UB 里的排布是"分形组优先"：`C[m,n]` 落在
  `(n/16)·(M/16·256) + (m/16)·256 + (m%16)·16 + (n%16)`（元素）。
- `:2046` `PipeBarrier<PIPE_ALL>()`。
- `:2048` `kNdBlockLen = 16*sizeof(float)/32 = 2`：ND 行里一次搬 16 个 FP32 = 64 B = 2 块。
- `:2049` `kNzSrcStride = (kMatmulM/16·16·16 - 16)·sizeof(float)/32`。
  128 桶：`(4·256 - 16)·4/32 = 1008/8 = 126` 块。
  含义：源地址在同一个分形组内每 repeat 推进 `2 块 + 126 块 = 128 块 = 1024 个 FP32` = 正好一个分形组
  （`M/16 · 16·16 = 1024`），即"下一列组的同一行"。
  推导：`-16` 扣掉的是本 repeat 自己消费的 16 个元素，`·4/32` 把元素换算成 32 B 块。
- `:2050` `DataCopyParams nzToNdParams{kMatmulN/16, kNdBlockLen, kNzSrcStride, 0}`：
  `repeatTimes = N/16`（一次指令把一整行 ND 拼出来：8 段 × 16 = 128 个 FP32），
  `blockLen = 2`，`srcStride = 126`，`dstStride = 0`（目的连续）。
- `:2051-2053` 逐行 64 次 `DataCopy`：这就是"Fixpipe 缺失"的代价——
  有 Fixpipe 时 L0C→UB 可以直接输出 ND 行，`dav_m200` 上必须**先用矩阵模式搬出 NZ，再用 64 条带跨距的 DataCopy 逐行摊平**。
  `cNz[row*16]` 是每行的 NZ 起点，行内跨 16 个元素。
- `:2054` `PipeBarrier<PIPE_ALL>()`：64 次 V 管 DataCopy 全部收尾，函数返回后 `chunkAttnOutFp32` 即被
  `WriteAttnTileToGm` 读走。
- `:2055` 函数右括号。

## 10. 两处 Vector fallback：与 !1108 的逐行 diff

锚点：chunk_gated_delta_rule.h:2056-2093

### 10.1 d0906c3e 侧全文

```cpp

  // Step 5: attn_inter = (q * exp(g_cumsum)) @ state -> chunkAttnOutFp32.
  __aicore__ inline void ComputeAttnInter(int32_t t_start, uint64_t qkHead, uint32_t chunkLen, uint32_t avFp32) {
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      Duplicate(outRow, 0.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      int32_t t = t_start + i;
      uint64_t qkOff = (static_cast<uint64_t>(t) * NK_ + qkHead) * realK_;
      float gExp = expGCumFp32.GetValue(i);
      for (uint32_t d = 0; d < realK_; d++) {
        float qd = static_cast<float>(queryGm_.GetValue(qkOff + d)) * scale_ * gExp;
        LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
        Axpy(outRow, stRow, qd, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
    }
  }

  // Step 6: output = attn_inter + attn_i @ v_new (accumulate into chunkAttnOutFp32).
  __aicore__ inline void AccumOutput(uint32_t chunkLen, uint32_t avFp32) {
    uint32_t cs = chunkSize_;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      for (uint32_t jj = 0; jj <= i; jj++) {
        float a = decayMaskFp32.GetValue(i * cs + jj);
        LocalTensor<float> vRow = chunkVFp32[jj * avFp32];
        Axpy(outRow, vRow, a, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
    }
  }

  // Fixed-shape state update:
  //   state = exp(g_last) * state + (K * exp(g_last - g))^T @ v_new.
  // The weighted K^T @ v_new product uses Cube. The 64/80/96 buckets convert the
  // complete NZ result to contiguous ND and use one wide Vector Add; the 128
  // bucket retains the segmented fallback.
```

- `:2056` 空行；`:2057` / `:2075` 两行注释是 Step5/Step6 的原始定义，**保留在 fallback 之上**，
  说明作者有意让"公式 → 两种实现"的对应关系留在原地。
- `:2058-2073` `ComputeAttnInter`：`Duplicate` 清零输出行 → 逐 d 读 Q 的标量 → `Axpy` 把 `stateInFp32` 的一行加进来。
  `:2061` 长度用 `vStepAligned_` 而不是 `curV`：整行（含 padding）一起算，保证 padding 区也是确定值。
  `:2064` 偏移公式与 `:1947` 同构，但 `t = t_start + i` **逐 token 走**，这是 8192 次标量 GM 读的出处。
  `:2065` `expGCumFp32.GetValue(i)` 是标量管读，`:2069` 的 `Axpy` 在 V 管消费它。
- `:2076-2087` `AccumOutput`：`:2080` 的 `jj <= i` 就是"下三角"的表达方式（Cube 版必须靠清零，Vector 版天然不需要）。
  `:2081` 读 `decayMaskFp32.GetValue(i*cs + jj)`——**这就是 §7 里为什么不原地破坏 decayMaskFp32 的依据**。
  `:2082` `chunkVFp32[jj*avFp32]` 此刻身份是 v_new。
- 两个函数都用 `PipeBarrier<PIPE_V>()` 逐条收口，粒度极细（每次 Axpy 后一条），
  因为 `Axpy` 是原地累加，下一条指令必须看到上一条的结果。
- `:2088` 空行，Step5/Step6 的 fallback 到此结束。
- `:2089-2093` 是 Step 7（state update）的五行说明注释，**它紧跟在 `AccumOutput` 之后、
  `ComputeStateUpdateCubeDispatch` 之前**，因此本章把它当作与 fallback 相邻的边界材料读完：
  `:2090` 给出公式 `state = exp(g_last)*state + (K*exp(g_last-g))^T @ v_new`——注意被转置的是**带衰减权重的 K**，
  而不是 state；`:2091` 声明"加权 K^T @ v_new 这一步用 Cube"；`:2091-2093` 声明分桶策略：
  **64/80/96 三桶把完整 NZ 结果一次转成连续 ND 后用一条宽 Vector Add 收尾，128 桶保留分段 fallback**。
  这句话是 10b 章 `:2249-2289`（`kNzFractalElements` 与分段 Add）与 `:2104`（`kTileM` 拆分）的存在理由，正文逐行验证。

### 10.2 !1108 的对应段（811-846）

锚点：00e39ab5/op_kernel/chunk_gated_delta_rule.h:811-846

```cpp
  __aicore__ inline void ComputeAttnInter(int32_t t_start, uint64_t qkHead, uint32_t chunkLen, uint32_t avFp32) {
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      Duplicate(outRow, 0.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      int32_t t = t_start + i;
      uint64_t qkOff = (static_cast<uint64_t>(t) * NK_ + qkHead) * realK_;
      float gExp = expGCumFp32.GetValue(i);
      for (uint32_t d = 0; d < realK_; d++) {
        float qd = static_cast<float>(queryGm_.GetValue(qkOff + d)) * scale_ * gExp;
        LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(outRow, stRow, qd, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
    }
  }

  // Step 6: output = attn_inter + attn_i @ v_new (accumulate into chunkAttnOutFp32).
  __aicore__ inline void AccumOutput(uint32_t chunkLen, uint32_t avFp32) {
    uint32_t cs = chunkSize_;
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      for (uint32_t jj = 0; jj <= i; jj++) {
        float a = decayMaskFp32.GetValue(i * cs + jj);
        LocalTensor<float> vRow = chunkVFp32[jj * avFp32];
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(outRow, vRow, a, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
    }
  }
```