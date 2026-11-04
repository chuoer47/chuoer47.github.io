# 06 · V-Tile 七步处理：无 Cube 矩阵乘的完整形态

本篇覆盖 `src/00e39ab5/op_kernel/chunk_gated_delta_rule.h` 第 **649-916** 行（268 行，占整个 kernel 的 28%）。结论先行：

1. 这 268 行是**唯一与 V 维有关**的代码，被切成"1 个循环（:649）+ 1 个编排（:659）+ 7 个步骤函数"。每处理一个 `[chunkLen, vStep]` 的 V-tile，就把七步完整跑一遍。
2. 七步之间靠**三块 FP32 tile 缓冲的身份轮换**串起来：`chunkVFp32` 是 v_beta 又是 v_new，`chunkAttnOutFp32` 依次是 Q 缓存 → V 的 FP16 staging → value_new → attn_inter → 最终 output，`stateInFp32` 与 `chunkScoresFp32` 在特定分支下是**同一块内存**。顺序因此不可交换，§0 的"身份时间表"是本篇最重要的图。
3. 中间 block state **始终留在 FP32**（写 workspace，:885-887），**只有 `isLastChunk` 为真那一次**才 `Cast` 成 FP16 写 `finalState`（:896-914，判据在 :878）。原因是源码 :876-877 自己写明的：逐块 cast 会让误差累积且结果依赖 chunk_size。
4. 公共接口把 state 定义成 `[B, Nv, Dv, Dk]`（910B 惯例），kernel 内部用 `[Dk, vStep]`，所以**转置只发生在两个接口边界**：入口 :775-780（标量转置读）、出口 :908-913（标量转置写）。内部计算全程不转置。
5. 本区间是**指令量黑洞**：`dk=128, vStep=16` 时每个 `(chunk, tile)` 约 2.87 万条 16 元素向量指令 + 约 1.66 万次标量取系数。§15 给逐步骤的账，并指出哪几处是可以安全省掉的。

## 0. 前置：七步总表与缓冲身份时间表

七步（函数入口行号）：

| 步骤 | 函数 | 锚点 | 数学式 | 读 | 写 |
|---|---|---|---|---|---|
| 1 | `LoadVBeta` | :674 | v_beta = V ⊙ β | `valueGm_`,`betaGm_` | `chunkAttnOutFp32`(staging) → `chunkVFp32` |
| 2 | `ComputeValueNew` | :732 | value_new = A·v_beta | `chunkScoresFp32`(=A),`chunkVFp32` | `chunkAttnOutFp32` |
| 3 | `LoadStateTile` | :750 | 取 $S_{c-1}$ | `stateWorkspaceGm_` 或 `initStateGm_` | `stateInFp32` |
| 4 | `ComputeVNew` | :789 | v_new = value_new − K_cd·S | `chunkKFp32`(=K_cd),`stateInFp32`,`chunkAttnOutFp32` | `chunkVFp32` |
| 5 | `ComputeAttnInter` | :811 | attn_inter = (Q·scale·e^G)·S | `queryGm_`,`expGCumFp32`,`stateInFp32` | `chunkAttnOutFp32` |
| 6 | `AccumOutput` | :832 | out = attn_inter + M·v_new | `decayMaskFp32`(=M),`chunkVFp32` | `chunkAttnOutFp32` |
| 出 | `WriteAttnTileToGm` | :341（04 篇） | — | `chunkAttnOutFp32` | `attnOutGm_` |
| 7 | `UpdateAndWriteState` | :849 | S ← e^{G_l}S + Σ e^{G_l−G_i}k_i⊗v_new_i | `expGCumFp32`,`gCumsumFp32`,`keyGm_`,`chunkVFp32`,`stateInFp32` | workspace / `finalStateGm_` |

缓冲身份时间表（一行 = 一个时间点，列 = 缓冲）。**"死"表示该缓冲的内容已无消费者，因此被拿去当别的用**——这就是本 kernel 复用 UB 的唯一规则：

| 时间点 | chunkVFp32 | chunkAttnOutFp32 | chunkScoresFp32 | stateInFp32 |
|---|---|---|---|---|
| Phase 1/3.5（:456/:552） | K/Q 的 FP16 staging | Q·scale 缓存（活） | 未写 | — |
| Phase 4（:576） | staging 残值（死） | Q·scale 缓存（活，被 `DotFp32` 读） | A（活） | 与 scores 重叠则同址 |
| Step 1（:687） | v_beta（活） | V 的 FP16 staging（**Q 缓存被覆写**） | A（活） | — |
| Step 2（:734） | v_beta（活） | value_new（活） | A（活，最后一次读 :740） | 与 scores 重叠则同址（未写） |
| Step 3（:753） | v_beta（死，Step2 已消费完） | value_new（活） | **已被清零覆盖**（重叠分支） | state（活） |
| Step 4（:793） | v_new（活） | value_new（活，:805 读后死） | 死 | state（活） |
| Step 5/6 | v_new（活） | attn_inter → output（活） | 死 | state（活） |
| Step 7 | v_new（活，最后读） | 已由 `WriteAttnTileToGm` 落 GM | 死 | 更新后的 state → GM |

关键读法：**Step 3 必须在 Step 2 之后**，不只是数据依赖，而是 `stateInFp32` 与 `chunkScoresFp32` 在 `InitLocalBuffers`（:168-172，重叠分支）里取同一 `off`——Step 3 的 `Duplicate`（:753）会把 A 矩阵就地抹掉。:749 的注释 "overlaps chunkScoresFp32 — must run after Step 2" 说的就是这件事。

本篇涉及的 AscendC 原语的机器语义（`Cast`/`Duplicate`/`Muls`/`Axpy`/`PipeBarrier`/`DataCopyParams`/`TQueSync`/`GetValue`/`SetValue`/`ReinterpretCast`/`likely`/`Ceil`）已在 04 篇 §0 逐条给过，本篇不重复，只在具体行上引用。另外两条本篇反复用到的约定：

- `avFp32` 就是 `vStepAligned_`（:407、:427 两个 `Process*Chunk*` 里各赋值一次），它是所有 `[cs, V]` 形 FP32 tile 的**行 stride**。代码里两个名字并存，纯属参数传递的可读性产物。
- `SetFlag<HardEvent::A_B>(id)` 会被编译进 **A 管道**的指令流，`WaitFlag<HardEvent::A_B>(id)` 被编译进 **B 管道**的指令流。所以源码里紧挨着的两行在硬件上不是紧挨着的：前者是"A 流到此打卡"，后者是"B 流在此设闸"。本篇把这类三段式（S→MTE2、V→MTE2、DMA、MTE2→V）当作一个整体看。

---

## 1. ProcessVTiles：V 维切块与尾块夹取

锚点：chunk_gated_delta_rule.h:649-658

```cpp
  // ---- Phase 6: per v-tile processing (attn matrix and state tile overlap) ----
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

- :652 `v_i` 是**本 tile 在 Dv 维的列起点**，步长 `vStep_`。它同时是 GM 列偏移和 workspace 列偏移，两者都直接加在元素下标上（:688/:763/:886/:909）。
- :653 `curV` 尾块夹取：末 tile 可能 `curV < vStep_`。此后有两个宽度：**逻辑宽度 `curV`（决定读写 GM 多少列、DMA 块长）和物理宽度 `avFp32`（决定行 stride 和所有向量指令的元素数）**。所有七步代码都按 `avFp32`/`vStepAligned_` 做向量运算，只在跨 GM 边界和 `Cast` 元素数时退回 `curV`。这个"宽物理、窄逻辑"的写法让内层循环零分支，代价是 padding 列参与运算——必须靠 :676、:753、:793 的清零保证 padding 无害。
- 循环体内没有任何跨 tile 的流水或双缓冲：每个 tile 独立跑完七步并把 state 写回 GM/workspace。**V-tile 之间完全无数据依赖**（各自的 state 列不相交、A 矩阵和 K_cd 与 V 无关），这正是 §0 之外唯一可以分核并行的维度，于是有了 `ProcessChunkVTile`（:423）+ `ShouldSplitVTiles`（:239）这条路。
- 注意这里**不重算 Phase 1~5**：走 `ProcessVTiles` 说明 `ShouldSplitVTiles()` 为假，一个核要把同一 chunk 的所有 tile 做完，而 Phase 1-5 的产物（A、K_cd、M）在 tile 间是可复用的，所以 `ProcessChunk` 只在循环前算一次（:414-420）。反之走 `ProcessChunkVTile` 时每 tile 一次调用，Phase 1-5 被重复算 `Ceil(dv/vStep)` 遍——用重复计算换并行度。

## 2. ProcessOneVTile：七步编排

锚点：chunk_gated_delta_rule.h:659-673

```cpp
  __aicore__ inline void ProcessOneVTile(int32_t t_start, uint32_t chunkLen, uint64_t head_i, uint64_t qkHead,
                                         uint32_t avFp32, uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset,
                                         uint32_t c, bool isLastChunk, uint32_t v_i, uint32_t curV) {
    LoadVBeta(t_start, head_i, chunkLen, v_i, curV, avFp32);
    ComputeValueNew(chunkLen, curV, avFp32);
    LoadStateTile(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    ComputeVNew(chunkLen, avFp32);
    ComputeAttnInter(t_start, qkHead, chunkLen, avFp32);
    AccumOutput(chunkLen, avFp32);
    WriteAttnTileToGm(t_start, chunkLen, head_i, v_i, curV, avFp32);
    UpdateAndWriteState(t_start, chunkLen, v_i, curV, qkHead, stateBaseOffset, workspaceStateBaseOffset, avFp32,
                        isLastChunk);
  }
```

- 这个函数**一条向量指令、一个同步都没有**，纯粹是顺序声明。它的价值在于：七步的所有正确性约束都被下推到"每步自己保证出口可见性"这一条纪律上，编排层因此不需要插入 `PipeBarrier`。
- :668 输出写回排在 state 更新之前。功能上两者无依赖（一个读 `chunkAttnOutFp32`，一个读 `chunkVFp32`+`stateInFp32`），但两者**共用同一条 `stateOutQueue_`（`BUFFER_NUM=1`，:34/:138）**，谁先谁后只影响 FP16 staging 的占用顺序；排在前面还有一层好处：output 落 GM 后 `chunkAttnOutFp32` 即释放，下一 tile 的 Step 1 可以立刻拿它当 staging。
- 传参里 `v_i/curV` 只出现在 Step 1、Step 3、`WriteAttnTileToGm`、Step 7，而 Step 2/4/5/6 拿不到 V 列位置——因为它们的行 stride 恒为 `avFp32`，**padding 与真实列的边界对这四步不可见**。这是 §0 表里"物理宽度运算"的落地方式。

## 3. Step 1（上）：V 的二维跨步 DMA

锚点：chunk_gated_delta_rule.h:674-703

```cpp
  // Step 1: v_beta = V * beta -> chunkVFp32.  
  __aicore__ inline void LoadVBeta(int32_t t_start, uint64_t head_i, uint32_t chunkLen, uint32_t v_i, uint32_t curV,
                                   uint32_t avFp32) {
    Duplicate(chunkVFp32, 0.0f, chunkLen * avFp32);
    PipeBarrier<PIPE_V>();

    // The compact output tile is dead until ComputeValueNew, so reuse it as
    // FP16 staging and replace chunkLen*curV scalar GM loads with one strided
    // standard DataCopy. Only use the fast path when both row width and source
    // gap are exactly representable in 32-byte blocks.
    uint64_t srcRowGapElems = static_cast<uint64_t>(NV_) * realV_ - curV;
    uint64_t srcRowGapBytes = srcRowGapElems * sizeof(inType);
    if (likely((curV * sizeof(inType)) % BLOCK_BYTES == 0 && srcRowGapBytes % BLOCK_BYTES == 0 &&
               srcRowGapBytes / BLOCK_BYTES <= 65535)) {
      LocalTensor<inType> valueLocal = chunkAttnOutFp32.template ReinterpretCast<inType>();
      uint64_t vOff = (static_cast<uint64_t>(t_start) * NV_ + head_i) * realV_ + v_i;
      uint16_t rowBlocks = static_cast<uint16_t>(curV * sizeof(inType) / BLOCK_BYTES);
      uint16_t srcRowGapBlocks = static_cast<uint16_t>(srcRowGapBytes / BLOCK_BYTES);
      DataCopyParams copyParams{static_cast<uint16_t>(chunkLen), rowBlocks, srcRowGapBlocks, 0};

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

```

- :676 `Duplicate(chunkVFp32, 0.0f, chunkLen*avFp32)` 把整个 tile 清零。**为什么必须清**：:709 的 `Cast` 每行只写 `curV` 个元素，`[curV, avFp32)` 的 padding 列再也没人写过；而 Step 2 的 `Axpy` 按 `avFp32` 全宽累加（:743），padding 若是 staging 残值就会污染 `value_new`。同一段清零也覆盖慢路径（:726 只 `SetValue` 前 `curV` 列）。
- :677 `PipeBarrier<PIPE_V>` 不是装饰。此刻 `chunkAttnOutFp32` 里还躺着 Phase 3.5 缓存的 Q·scale，它最后被 V 管道的 `DotFp32`→`Mul`（:290）读过（Phase 4 的 :592）。接下来 MTE2 要用 V 覆写同一块内存，**必须先让 V 把对旧内容的读全部退休**，否则 WAR 竞争。同理慢路径下它保证 `Duplicate`（V 写）先于 :726 的标量 `SetValue`（S 写）落地。
- :683/:684 源行间距 = `NV_*realV_ - curV` 个 FP16 元素。GM 里 V 是 `[B, T, NV_, Dv]` 扁平排布，相邻两行（t 与 t+1，同一 head）之间隔了整个 head 维，所以是"跨步"拷贝而不是连续拷贝。用 `NV_*realV_-curV` 而不是 `(NV_-1)*realV_+...` 是因为 `blockLen` 已经吃掉了本行的 `curV` 个元素，gap 只补剩下的。
- :685-686 三个快路径条件，逐个对应 `DataCopyParams` 的字段宽度：① `curV*2 % 32 == 0` ⇒ `blockLen` 能以 32B 块精确表示（`curV` 是 16 的倍数或至少 16 的倍数级）；② `gap*2 % 32 == 0` ⇒ `srcGap` 同理；③ `gap/32 ≤ 65535` ⇒ `srcGap` 是 `uint16_t`。三者缺一即退回纯标量。
  - 还有一个**没写进条件但恒成立**的前提：每行的 GM 起始地址要 32B 对齐。`vOff = (t*NV_+head_i)*realV_ + v_i`，其中 `v_i` 是 `vStep_` 的倍数，host 侧 `SolveVStep` 只按 16 枚举 vStep ⇒ `v_i*2` 字节恒为 32 的倍数。若哪天 host 允许 `vStep` 取非 16 倍数，这个快路径会**静默算错地址**而不是退化——是 §15 隐患清单里最值钱的一条。
- :687 `ReinterpretCast<inType>` 把 FP32 tile 的头指针当成 FP16 视图用，容量翻倍：`chunkAttnOutFp32` 有 `cs*avFp32` 个 FP32 = `2*cs*avFp32` 个 FP16 槽位，而 staging 只需 `chunkLen*curV ≤ cs*vStep_` 个 ⇒ 恒够用。
- :691 `DataCopyParams{chunkLen, rowBlocks, srcRowGapBlocks, 0}`：`blockCount` = 行数（**不是字节数**），`blockLen` = 每行块数，`srcGap` = 行间距块数，`dstGap = 0` ⇒ 目的端紧凑堆放成 `[chunkLen, curV]`，正好让 :709 用 `valueLocal[i*curV]` 寻址。
- :693-702 三段式与 :461-470 逐字同构（05 篇 §5 已拆解）。这里只补一句：`S_MTE2` 那一对在本函数里其实是**多余的**，因为 :677 已经把 V 排空、地址与参数是标量寄存器里的即时值；保留它是照抄模板，属"保守"类。

## 4. Step 1（下）：逐行 Cast+Muls 与标量兜底

锚点：chunk_gated_delta_rule.h:704-731

```cpp
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
      TQueSync<PIPE_V, PIPE_S> valueSync;
      valueSync.SetFlag(0);
      valueSync.WaitFlag(0);
      return;
    }

    for (uint32_t i = 0; i < chunkLen; i++) {
      int32_t t = t_start + i;
      uint64_t vOff = (static_cast<uint64_t>(t) * NV_ + head_i) * realV_;
      float beta_val = LoadBeta(t, head_i);
      for (uint32_t v = 0; v < curV; v++) {
        float v_val = static_cast<float>(valueGm_.GetValue(vOff + v_i + v));
        chunkVFp32.SetValue(i * avFp32 + v, v_val * beta_val);
      }
    }
  }
```

- :704 循环外**构造一次**、循环内反复 `SetFlag/WaitFlag`：`TQueSync` 对象的构造会向 `TPipe` 申请一对事件通道，放进循环就是每行一次申请/释放，白付管理开销。这个"对象在环外、打点在环内"的写法在全文件 9 处 `TQueSync` 里都一致。
- :706-708 每行的 `betaVal` 是**标量 GM 读**（:259 `betaGm_.GetValue`），紧接着 S→V 同步，再作为 `Muls` 的标量系数。这条同步是**每行新增一次标量取数**逼出来的，不能提到循环外合并（对比 :501-507 的 `ComputeKBeta`，那里 `LoadBeta` 也在循环里，同样逐次打点）。
- :709 `Cast(..., CAST_NONE, curV)`：FP16→FP32 精确无损（FP32 尾数包含 FP16 全部位），`CAST_NONE` 即默认的就近无饱和。元素数用 `curV` 而不是 `avFp32`——padding 列不参与，保持 :676 的 0。
- :711 `Muls` 目标与源同为 `chunkVFp32[i*avFp32]`，就地乘 β。这是**逐行 16 元素**的短向量操作，两条指令（Cast、Muls）各覆盖 ≤32B；把它跟 :683 的 DMA 对比就明白本 kernel 的性能结构：**搬运已经向量化了，逐元素算术还全是 16 宽**。
- :714-716 `valueSync`（V→S）出口收口。实测全文件没有任何 `chunkVFp32.GetValue`（脚本核对：`GetValue` 只出现在 `chunkScoresFp32`/`decayMaskFp32`/`gCumsumFp32`/`expGCumFp32`/`chunkKFp32`/`dotProductFp32`/`stateLocal` 上），Step 2/4/6/7 都只以**向量**方式读 `chunkVFp32`（同管道按序），所以这一对属"保守收口"。删掉可省一次管道排空。
- :719 `return`：快路径直接结束函数，慢路径从 :721 起。两条路径**语义等价**（同样的 `chunkVFp32` 内容、同样的 padding 为零），这是判定"删条件走慢路"类改动安全性的基准：任何时刻两条路径必须给出逐位相同的 tile。
- :721-729 慢路径是纯标量三重循环，共 `chunkLen*curV` 次 GM 标量读 + 同量 UB 标量写（16 列 × 64 行 = 1024 对），相比快路径的"1 次 DMA + 64 次 16 宽向量指令"差约两个数量级。所以生产配置下这个分支基本不走；它的存在价值是**保证 dk/dv/NV 任意组合都有正确兜底**，而不是性能。
- 慢路径出口**没有**任何同步对象，与快路径的 :714-716 不对称，这恰好证明那对 `valueSync` 是模板带进来的保守件。慢路径的安全性另有来源：:726 的标量 `SetValue` 与 Step 2 的 :743 向量 `Axpy` 之间，被 Step 2 第一次循环的 `coefficientSync`（:741-742，S→V）隔开——**"标量写 UB → 向量读 UB"由消费端而不是生产端授权**，这与 :783-785 的初值同步（生产端授权）是两种可行写法。

## 5. Step 2：value_new = A · v_beta（下三角 GEMV）

锚点：chunk_gated_delta_rule.h:732-749

```cpp
  // Step 2: value_new_tile = attn @ v_beta_tile (lower-tri attn, sum k <= i) -> chunkAttnOutFp32.  
  __aicore__ inline void ComputeValueNew(uint32_t chunkLen, uint32_t curV, uint32_t avFp32) {
    (void)curV;
    Duplicate(chunkAttnOutFp32, 0.0f, chunkLen * avFp32);
    PipeBarrier<PIPE_V>();
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkAttnOutFp32[i * avFp32];
      for (uint32_t k = 0; k <= i; k++) {
        float score = chunkScoresFp32.GetValue(i * chunkSize_ + k);
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(outRow, chunkVFp32[k * avFp32], score, avFp32);
        PipeBarrier<PIPE_V>();
      }
    }
  }
```

- :733 `(void)curV;` 是把形参显式转 void 以消除"未使用参数"告警。它不是废话，而是**信息**：作者知道 `curV` 在这里不需要，因为整个 tile 按 `avFp32` 全宽算，padding 列已由 :676 归零、算出来还是 0。
- :734 `Duplicate` 覆写 `chunkAttnOutFp32`：V 的 FP16 staging 残值就此作废（Step 1 已消费完）。
- :738 行指针 `outRow` 在 i 循环外取一次，内层 `Axpy` 反复累加同一行——这就是"软件矩阵乘"的标准骨架：**目标行常驻，源行按 k 扫过，系数标量喂**。
- :739 `k <= i`：A = (I−B)⁻¹ 是下三角（对角在 :586 被置 1），所以第 i 行只有 `k ≤ i` 非零。这里省掉的不仅是计算量（2080 vs 4096 次 Axpy），更是正确性：上三角槽位里躺的是 `Duplicate` 清零后的 0，即便读到也不影响结果，但循环上界仍是**语义声明**。
- :740 注意 stride 写成 `i * chunkSize_` 而 Step 6（:838）写成 `i * cs`（`cs` 是 :835 的局部别名）。同一个数两种拼法，属文件内的风格漂移，不影响正确性；`chunkScoresFp32` 的分配量是 `cs*cs`（:170-173），行 stride 恒为 `chunkSize_` 与 `chunkLen` 无关。
- :743 `Axpy(dst, src, coeff, count)` 机器语义：`dst[j] += coeff * src[j]`，`coeff` 是标量、`count` 个 FP32 同拍流水。此处 `dst` 与 `src` 分属两块 tile，无重叠，**不依赖**"Axpy 目标即源"的未定义行为。
- 与 :630-643 的 `ComputeKCumdecay` 后半结构完全相同（同一下三角 GEMV 模板），差别只有三个操作数。这两处 + Step 4/5/6/7 合计 6 处同构代码，是全文件最值得抽成一个 `TriGemv(dstBuf, srcBuf, coefBuf, ld, count)` 的地方（07 篇 §5 的"重复模板盘点"）。

## 6. Step 3（上）：tile 清零与 FP32 workspace 读

锚点：chunk_gated_delta_rule.h:750-772

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
      DataCopyParams stateParams{1, static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK), 0, 0};
      for (uint32_t d = 0; d < realK_; d++) {
        uint64_t rowOff = workspaceStateBaseOffset + static_cast<uint64_t>(d) * stateWorkspaceStrideV_ + v_i;
        DataCopy(stateInFp32[d * vStepAligned_], stateWorkspaceGm_[rowOff], stateParams);
      }
      PipeBarrier<PIPE_ALL>();
      event_t mte2ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_V));
      SetFlag<HardEvent::MTE2_V>(mte2ToVector);
      WaitFlag<HardEvent::MTE2_V>(mte2ToVector);
      return;
    }

```

- :752/:753 清零范围是**整个带 padding 的 tile**：`stateStrideK_` 行 × `vStepAligned_` 列。`stateInFp32` 的分配量恰为 `stateStrideK_ * avStepAligned`（:171/:176），所以这次 `Duplicate` 覆盖全缓冲，无越界。padding 列会被 Step 4/5 的 `vStepAligned_` 宽 Axpy 读，必须为 0。
- 两条分支的**唯一判据是 `c > 0`**（chunk 序号），不是 `hasGamma_` 也不是 `isLastChunk`。含义：`c == 0` 时上一状态来自**用户的 initial_state（FP16，公共布局）**；`c > 0` 时来自**自己的 FP32 workspace**。这就是"中间态 FP32、接口态 FP16"的读端。
- :756 `PipeBarrier<PIPE_ALL>` 排空全部管道；:757-759 `V_MTE2` 闸口要求"MTE2 必须等 V 把 :753 的清零做完"——**这是必需的 WAR 保护**：DMA 的目标 `stateInFp32` 与 `Duplicate` 的目标是同一块内存。于是 :756 的 PIPE_ALL 与它重叠（更强的手段包住更弱的手段），属可省的保守叠加。
- :760 `alignedV = Ceil(curV, 8) * 8`：FP32 的 32B 块 = 8 元素，所以 DMA 元素数要向上取到 8 的倍数。`curV ≤ vStep_ ≤ vStepAligned_`，取整后不会写出 tile 之外（同一行的 padding 列被覆盖成 workspace 的 padding 值，随后又被 :753 的…不——顺序是**先清零后 DMA**，所以 `alignedV > curV` 时 padding 列会被 workspace 的**陈旧 padding** 覆盖，见本小节末尾的"隐患"）。
- :761 `DataCopyParams{1, alignedV/8, 0, 0}`：`blockCount = 1`，靠 :762 的 `d` 循环发 **`realK_` 条独立 DMA**。
- :763 读地址：workspace 布局 `[B, Nv, Dk, align8(Dv)]`（:378 的 `workspaceStateBaseOffset = (b*NV_+h)*realK_*stateWorkspaceStrideV_` 是每-head 基址，行 stride = `stateWorkspaceStrideV_`），列起点 `v_i`。
- :764 写地址：`stateInFp32[d * vStepAligned_]`（tile 行 stride = `vStepAligned_`）。**源行宽与目地的行宽是两个不同的量**，这正是 :761 只能 `blockCount=1` 的原因吗？不是：目标端 `dstGap = (vStepAligned_-alignedV)/8` 块、源端 `srcGap = (stateWorkspaceStrideV_-alignedV)/8` 块，两者都是 8 的倍数相减后除 8，**恒为整数**。也就是说这里**可以合成一条 `blockCount = realK_` 的 2D DataCopy**，把 128 次 DMA 指令下发压成 1 次。这是本篇找到的最明确的一处向量化欠账（对比 :691 和 :356-360，作者在别处都会用 2D）。风险点：workspace 的 padding 列（`dv` 到 `stateWorkspaceStrideV_` 之间）会被一起搬进来，但那部分列本 tile 不读，无害。
- :766-769 出口：`PIPE_ALL` + `MTE2_V` 闸口，让 Step 4 的向量 Axpy 保证看到 DMA 结果。`MTE2_V` 必需，`PIPE_ALL`（:766）同样冗余。

## 7. Step 3（下）：初值的标量转置加载

锚点：chunk_gated_delta_rule.h:773-788

```cpp
    // The public interface follows 910B and stores state as [B, Nv, Dv, Dk].
    // The internal FP32 tile is [Dk, vStep], so transpose while loading.
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

- :775-780 双重标量循环，一次读 + 一次写：`init[b,h,v,d] → tile[d,v]`。这就是 §结论 4 说的"转置只在接口边界"。元素数 `realK_*curV`（dk=128、vStep=16 ⇒ 2048 对标量访存），**每 head 只付一次**（只在 `c==0` 走），所以不心疼。
- 为什么不用 DMA + 向量转置？AIV-only 下没有 MDM/Transpose 类指令，UB 内转置只能"逐列 strided 读 + 逐行写"或 `DataCopyExtParams` 的字节粒度搬运，而 FP16 的 `[Dv, Dk]` 里相邻 `d`（步长 1）要变成行——**任何向量化方案都要么需要 2B 粒度的 gather，要么需要一块临时全 tile 缓冲**。用标量换掉一块 UB，是这个 kernel 在 UB 预算下的合理选择。
- :778 写侧带 `vStepAligned_` stride、读侧带 `realK_` stride，两个 stride 分别来自 §14 的两条布局公式，读者核对 state 布局时以这两行为准。
- :783-785 `initialStateSync`（S→V）是**真正必需**的同步：标量写进 UB 的内容，接下来由 V 管道作为 `Axpy` 的源行读（Step 4 的 :797 取行、:800 的 `Axpy`）。"标量写 UB → 向量读 UB"这一类全 kernel 只有 4 处：:498-:500（K/g 的标量兜底路径）、:322-:324（递归行系数写 `deltaFp32`）、:604-:606（慢路径的一行 Q·scale）、:783-:785（初值转置写 `stateInFp32`）。四处都是 `TQueSync<PIPE_S, PIPE_V>`，方向一致，缺一不可。
- 与 `c > 0` 分支的不对称：那条在 :770 直接 `return`，**没有** S→V 同步——因为它的数据是 MTE2 搬进来的，向量侧的可见性由 :767-769 的 `MTE2_V` 闸口负责。看懂这一对差异，就看懂了"谁写的数据由谁负责放行"。
- 隐患（padding 列的初值路径）：`v ≥ curV` 的列在 :753 已清零且此处不写 ⇒ 保持 0，与 :760 的 `alignedV` 语义一致。**但 `d ≥ realK_` 的 padding 行**（`stateStrideK_ > realK_` 时存在，即 `dk % 8 != 0`）两条分支都不写、却会被 Step 7 的 :897-901 整块 `Cast`——读到的是 `Duplicate` 的 0，落进 FP16 也是 0，再被 :908-913 的循环上界丢掉。链条闭合：padding 行/列在整个七步中都不会污染结果，条件是 :753 的清零范围必须等于 tile 分配量（相等，见 :171/:176）。

## 8. Step 4：v_new = value_new − K_cd · S

锚点：chunk_gated_delta_rule.h:789-810

```cpp
 // Step 4: v_new = value_new - (k_cumdecay @ state) -> chunkVFp32 (reused).  
  __aicore__ inline void ComputeVNew(uint32_t chunkLen, uint32_t avFp32) {
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> vpRow = chunkVFp32[i * avFp32];
      Duplicate(vpRow, 0.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      for (uint32_t d = 0; d < realK_; d++) {
        float kcd = chunkKFp32.GetValue(i * alignK_ + d);
        LocalTensor<float> stRow = stateInFp32[d * vStepAligned_];
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(vpRow, stRow, kcd, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
      Muls(vpRow, vpRow, -1.0f, vStepAligned_);
      PipeBarrier<PIPE_V>();
      Add(vpRow, vpRow, chunkAttnOutFp32[i * avFp32], vStepAligned_);
      PipeBarrier<PIPE_V>();
    }
  }

  // Step 5: attn_inter = (q * exp(g_cumsum)) @ state -> chunkAttnOutFp32.
```

- 这是**七步里最贵的一步**：内层 `realK_` 次（dk 上限）逐 (i,d) 的标量 UB 读 + 一次 16 宽 Axpy ⇒ `cs*dk = 8192` 次（vStep=16）。§15 有账。
- :796 `chunkKFp32.GetValue` 之所以合法，靠的是 Phase 5 出口 :642-644 的 `outputSync`（V→S）——此刻 `chunkKFp32` 的身份已经是 K_cd，而它是被 :639 的 `Axpy` 用向量方式覆写的。05 篇 §13 把这条列为"跨函数必需"，本篇确认它是**唯一**的可见性来源。
- :792/:793 就地复用 v_beta 行：先 `Duplicate` 清掉 v_beta（Step 2 已在 :743 消费完最后一行，见 §0 表），再累加 `K_cd·S`。**Step 2 与 Step 4 的顺序因此不可交换**。
- :793 宽度用 `vStepAligned_` 而非 `avFp32`：同一常量、两种写法。同一函数内 :792 的偏移用 `avFp32`、:793 的元素数用 `vStepAligned_`，读代码时容易误以为是两个量——实际 `ProcessChunk` 里 `avFp32 = vStepAligned_`。
- :803-805 取负再加，实现 `v_new = value_new − K_cd·S`。这里有一个**可以合并的冗余**：内层循环结束时 `vpRow = Σ kcd·S = K_cd·S`，要的是 `value_new − vpRow`，用一条 `Sub(chunkAttnOutFp32[i*avFp32]? ...) ` 形态即可：`Add(dst=a, src1=?)`/`Sub` 在本文件已用过（:527 `Sub(deltaFp32, deltaFp32, gCumsumFp32, cs)`），说明三操作数形式可用。改成 `Sub(vpRow, chunkAttnOutFp32[i*avFp32], vpRow, vStepAligned_)`（语义 `dst = src1 - src2`）就能省掉 :803 这次全行乘 −1。作者选 Muls+Add 大概率是为了让"先取负、再相加"两步与 :788 的注释公式逐字对齐。**收益**：每行少一次 16 元素向量写；每 tile 少 `cs` 条指令。
- :805 `Add(vpRow, vpRow, chunkAttnOutFp32[i*avFp32], ...)`：`dst` 与 `src0` 同一张量。AscendC 的三地址向量指令对 `dst==src1` 是常见且安全的（同管道按序），但与 :527 的 `Sub` 一样，这类重叠是 UB 复用逼出来的，值得在 review 后续 PR 时列为"改动前需硬件确认"清单。
- Step 4 之后 `chunkAttnOutFp32` 里的 value_new 只剩这一次读取（:805），随即在 Step 5 被 `Duplicate`（:815）逐行覆写。**依赖链**：Step 5 的第 i 行写必须在 Step 4 的第 i 行读之后——同一条 V 管道按序，故无需额外同步。这是"七步为何不需要步间 barrier"的一般性答案：**跨步依赖全是 V→V 的按序链，唯一的例外是 Step 3 的 DMA（MTE2↔V）和标量取系数（S↔V）**。

## 9. Step 5：attn_inter = (Q·scale·e^G) · S

锚点：chunk_gated_delta_rule.h:811-831

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

 ```

- :819 `gExp` 每行一次 **UB 标量读**（`expGCumFp32` 是 Phase 3 用向量 `Exp` 写的，可见性由 :519-522 `expSync` 授权）。注意它读的是按 `cs` 长度算出的数组，而 `i < chunkLen ≤ cs`，落在有效区内——尾部（`chunkLen..cs`）的 `Exp` 是对残值的计算，从不被读（05 篇 §8）。
- :821 是本 kernel **唯一从 GM 逐标量读 Q** 的地方（另一处是慢路径 :601）。为什么不用 Phase 3.5 的 Q 缓存？因为那块缓存就在 `chunkAttnOutFp32`，而 Step 1 的 :687 已经把同一区域拿去当 V 的 staging 了。**UB 不够 → Q 缓存活不过 K 阶段 → Q 必须二次入场，且这次只能走标量 GM 读**。这是一条完整的因果链，也是 §15 里"最贵的取舍"。
- :821 的 `* scale_ * gExp` 在 d 循环内做：每个系数 2 次标量乘。`scale_` 是 FP32 标量成员（:964）、`gExp` 每行一个，都可以提前折进 state 侧或折进一次 `Muls`，但因为 `Axpy` 的系数只能是标量寄存器，**乘法次数不能靠缓存减少，只能靠把 gExp 与 scale 合并成一个每行标量**（`scale_ * gExp` 提到 :819 同行即可省 `cs*dk` 次标量乘）。这是零风险微优化。
- 与 Step 4 的对称性：两者形状完全一样（`for i: for d: Axpy(目标行, stateInFp32[d], 标量系数)`），差别只在系数来源（K_cd 在 UB，Q 在 GM）和目标 tile（v_new 在 chunkVFp32，attn_inter 在 chunkAttnOutFp32）。所以 Step 4+Step 5 合计 `2*cs*dk = 16384` 次 Axpy，是全 kernel 的一半开销。
- 数学核对：`out_i = e^{G_i}·(Q_i·scale)·S`，与 docs/PR-406-00e39ab5/01 的 `attn_inter = e^{g_cumsum}·Q·S` 一致；`qkHead` 用于 Q 的偏移、`head_i` 用于 state 的列空间，二者在本函数里分别由 :818 与 `stateInFp32`（Step 3 已按 head 定位）承担。

## 10. Step 6：out = attn_inter + M · v_new

锚点：chunk_gated_delta_rule.h:832-848

```cpp
  _// Step 6: output = attn_inter + attn_i @ v_new (accumulate into chunkAttnOutFp32).  
  _aicore__ inline void AccumOutput(uint32_t chunkLen, uint32_t avFp32) {
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

- **`decayMaskFp32` 到这里已经换了身份**。Phase 3 写的是纯 decay $e^{G_i-G_j}$；Phase 4 后半（cache 路径 :592-594，慢路径 :608-610）把**下三角含对角**原地覆写成 $M_{ij}=(Q_i\cdot k_j)\cdot scale\cdot e^{G_i-G_j}$。所以 :838 取的 `a` 已是最终权重，不需要再乘注意力分数。上三角仍是裸 decay 且**从不被读**（:837 的 `jj <= i`）。这是全 kernel 最隐蔽的一处别名：单看 Step 6 会以为它把 QK 分数漏乘了。
- 与 Step 2 的区别只在系数缓冲（`chunkScoresFp32` = A vs `decayMaskFp32` = M）和源 tile（v_beta vs v_new）。两者共用同一个下三角 GEMV 模板。
- :836 拿到的 `outRow` **不清零**：Step 5 已把 attn_inter 写进同一行，本步是"累加"。这与 Step 2/4/5 的显式 `Duplicate` 形成对比，也是 §0 身份表里 `chunkAttnOutFp32` 在 Step 5→6 保持"活"的原因。
- :842 源 `vRow` 是 Step 4 产出的 v_new，宽度 `vStepAligned_`；`chunkVFp32` 自 Step 4 之后不再被写，直到 Step 7 只读、下一 tile 的 :676 才重新清零。**同一条 chunkVFp32 在一个 tile 内被消费 3 次（Step 2 作为 v_beta、Step 6/7 作为 v_new）**，中间被 Step 4 就地改写——所以"Step 2 早于 Step 4 早于 Step 6 早于 Step 7"是硬顺序，交换任何一对都会静默算错。

## 11. Step 7（上）：状态衰减与秩 1 累加

锚点：chunk_gated_delta_rule.h:849-874

```cpp
  // Step 7: decay state, add (K * exp(gLast - g))^T @ v_new, then write the state tile back to GM.  
  __aicore__ inline void UpdateAndWriteState(int32_t t_start, uint32_t chunkLen, uint32_t v_i, uint32_t curV,
                                             uint64_t qkHead, uint64_t stateBaseOffset,
                                             uint64_t workspaceStateBaseOffset, uint32_t avFp32, bool isLastChunk) {
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    float gLastExp = expGCumFp32.GetValue(chunkLen - 1);
    coefficientSync.SetFlag(0);
    coefficientSync.WaitFlag(0);
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
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(stRow, vRow, coeff, vStepAligned_);
        PipeBarrier<PIPE_V>();
      }
    }
```

- :853 `gLastExp = e^{G_{chunkLen-1}}`：本 chunk 最后一个位置的**累计门控指数**，即整个 chunk 的总衰减。用它先把旧状态整体衰减（:856-860），是 $S_c = e^{G_l}S_{c-1}+\dots$ 的第一项。
- :854-855 这对 S→V 同步放在**整个函数开头**，而不是像别处一样紧贴取数。作用：让 :856 起的 `Muls` 系数 `gLastExp`（标量寄存器）在 V 侧可见。它是全区间唯一一处"一次同步服务多条向量指令"的写法，因为后续 `Muls` 全用同一个系数。
- :856-860 `realK_` 条 16 宽 `Muls`。若把整块 tile 当成一维数组，一条 `Muls(stateInFp32, stateInFp32, gLastExp, stateStrideK_*vStepAligned_)` 就够——**这里逐行拆开是因为 padding 行（`d ≥ realK_`）不该被乘**？乘 1 之外的值也无害（那些行从不被逻辑读，只在 :897 被整块 Cast 后由 :908 循环丢掉）。所以逐行是风格选择，合并成一条可省 `realK_-1` 条指令（本区间第二处零风险优化）。
- :864 `ScalarExp(G_l − G_i)`：**软件 exp**（:263 的 12 项 Taylor 实现，04 篇 §4），不用 `Exp` 硬件指令，因为它要的是一个标量而不是向量。为什么不用现成的 $e^{G_l-G_i}$？它本来在 `decayMaskFp32` 的第 `chunkLen-1` 行（列 `i`），但 Phase 4 已把该行下三角覆写成 M，**原值被销毁**。为什么不用 `expGCumFp32[l]/expGCumFp32[i]`？因为 `e^{G_i}` 下溢为 0 时是除零。用 `ScalarExp(差)` 是唯一"既有原值又无分支风险"的路。
  - 参数符号：`g ≤ 0` 时 `G` 单调不增，`G_l − G_i ≤ 0`（i ≤ l），故 `ScalarExp` 走 `val < 0` 分支 = `1/exp(|val|)`。即使 `|val| > 88.72`（FP32 `exp` 溢出界限）使中间量为 `inf`，倒数后得 0，恰是数学极限——**这条路径对负参数天然安全**，与 :518/:528 的硬件 `Exp`（正参数会真溢出）形成对照。
  - 真正会挂的是 `absVal` 为 `inf/NaN`：:267 的 `while (reduced > 1.0f)` 永不退出 ⇒ **kernel 死循环**。要触发需要某个 `g` 为大正数使 `G` 上溢，kernel 对 `g` 的符号没有任何校验（04 篇 §4 已列）。
- :867 `keyGm_.GetValue`：又一次逐标量 GM 读原始 K。`chunkKFp32` 里存的是 K_cd（Phase 5 覆写）、`kCumdecayFp32` 是 $k\beta e^G$，**都不是裸 K**，所以 Step 7 只能回 GM 取。与 Step 5 的 Q 同因：UB 里没有留给裸 K 的位置（`chunkKFp32` 是唯一一份，已被复用）。
- :871 `Axpy(stRow, vRow, coeff, vStepAligned_)`：`stRow` 是 state 的第 d 行（V 方向 16 列），`vRow` 是 v_new 的第 i 行（同样 16 列）。所以**一次 Axpy 就把外积 $k_i\otimes v_{new,i}$ 的第 d 个分量沿 V 维摊开**——这是无 Cube 下做外积的标准形状：外层 `i`（token）、内层 `d`（K 维）、向量轴 = V 维。循环顺序 `i` 外 `d` 内还让 `vRow` 在整个内层循环里保持热点复用，比反过来（每 d 重读 K 一列）更省。
- 累加目标 `stRow` 与 Step 4/5 读它的 Axpy 之间存在 WAR：Step 4/5 的行读必须早于这里的行写。调用顺序（:665/:666 早于 :669）+ V 管道按序即保证，无需同步。

## 12. Step 7（中）：非最后块写 FP32 workspace

锚点：chunk_gated_delta_rule.h:875-895

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
      DataCopyParams stateParams{1, static_cast<uint16_t>(alignedV / FP32_NUM_PER_BLOCK), 0, 0};
      for (uint32_t d = 0; d < realK_; d++) {
        uint64_t rowOff = workspaceStateBaseOffset + static_cast<uint64_t>(d) * stateWorkspaceStrideV_ + v_i;
        DataCopy(stateWorkspaceGm_[rowOff], stateInFp32[d * vStepAligned_], stateParams);
      }
      PipeBarrier<PIPE_ALL>();
      event_t mte3ToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE3_MTE2));
      SetFlag<HardEvent::MTE3_MTE2>(mte3ToMte2);
      WaitFlag<HardEvent::MTE3_MTE2>(mte3ToMte2);
      return;
    }

```

- 这就是**"中间态保持 FP32"的代码位置**：:885-887 与 Step 3 的 :763-764 是同一条 (源/目) 地址公式的正反两面，宽度 FP32、布局 `[Dk, align8(Dv)]`。写与读的 tile 完全对称，是自检该 kernel 时最容易核对的一对。
- :880-882 `V_MTE3`：MTE3（出）必须等 V 把 :856-875 的更新全部退休。必需。
- :890-892 `MTE3_MTE2`：本核**下一个 chunk 的 Step 3** 会用 MTE2 读同一块 workspace。这是"同一内存的写→读"跨 chunk 闸口，必需；也正因为它必需，可以确认 workspace 在本 kernel 里被当作**同一核内的临时寄存器堆**用，不承担跨核通信。
- 跨核为何无需锁：workspace 的 `[d, v_i..v_i+curV)` 元素区间由 `(b*NV_+h, v_i)` 唯一决定，`IsCurrentBlock`（:241）保证一个 `(head, tile)` 只被一个核认领 ⇒ **每个区间只有一个写者一个读者**，且都在同一核内。这条论证是"分核按 head/tile、不分 chunk"的完整理由；任何改动若让两个核处理同一 `(b,h,v_i)`（例如把 chunk 维也拆核）都会立刻破坏它。
- 每 chunk 一次的 GM 往返量：`realK_ * alignedV * 4` 字节（dk=128、vStep=16 ⇒ 8 KB 写 + 8 KB 读）。相对 FP16 接口态翻倍，是 FP32 保真度的代价。
- `alignedV` 与 :760 同式，所以 §6 指出的"可合成 2D DMA"在读写两侧都成立（写侧 `srcGap = 0`、`dstGap = (stateWorkspaceStrideV_-alignedV)/8`）。

## 13. Step 7（下）：最后块 cast FP16 写 final_state

锚点：chunk_gated_delta_rule.h:896-916

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

```

- 与 :878 合起来就是本篇结论 3：**判据是 `isLastChunk`**（由 :384/:397 的 `c + 1 == numC` 传入，`numC` 按真实序列长度算，因此"最后一块"是**每个 batch 各自的最后一条 chunk**，不是全局末尾）。
- :897/:898 `Muls(..., 1.0f, alignedElem)` 数值上是恒等，作用是造一次"V 管道内的自我依赖 + 全 tile 触碰"，配合 :899 的 `PipeBarrier<PIPE_V>` 确保 :856-874 的所有行更新都已落地，再交给 :901 的 `Cast` 整块读。同样的"乘 1 当栅栏"手法在 :344（`WriteAttnTileToGm` 入口）和 :516（`PrepareDecayAndExp` 入口）各出现一次——**全文件三处，语义一致**。严格说这里 `PipeBarrier<PIPE_V>` 已足够（V 按序），`Muls` 是冗余的第三次保险。
- :897 `alignedElem = stateStrideK_ * vStepAligned_`：`Cast` 覆盖**含 padding 的整块 tile**，不是 `realK_*curV`。因此 :900 的队列缓冲必须容得下 `stateStrideK_*vStepAligned_*2` 字节——这正是 :134-138 把 `stateTileBytes` 与 `chunkOutBytes` 取 max 后 `InitBuffer` 的理由。
- :900-904 队列四步曲 `AllocTensor → (V 写) → EnQue → DeQue`。`stateOutQueue_` 是 `TQue<QuePosition::VECOUT, 1>`（:929，且 `BUFFER_NUM = 1`，:34/:138——**无双缓冲**），所以：`AllocTensor` 从空闲池取唯一那块；`EnQue` 把它挂成"已提交给 V 输出"；`DeQue` 阻塞到 V 真正写完；`FreeTensor`（:914）归还。若少了 `FreeTensor`（:914），队列容量 1 会被永久占住——后续 `AllocTensor`（下一个 tile 的 :347 或本函数的 :900）拿到的就是同一块内存且**失去 DeQue 带来的排空语义**，属难查的正确性缺陷。这是本篇认为最应该在报告 2/3 里作为"生命周期不变式"记下来的一条。
- :905-907 `finalStateSync`（V→S）：:911 用标量 `stateLocal.GetValue` 读 FP16 tile，读之前必须让队列/ V 的写对整个标量侧可见。必需。
- :908-913 转置写出，与 :775-780 严格互逆：`final[b,h,v,d] = tile[d,v]`。用 `curV × realK_` 双标量循环（`SetValue` 到 GM = 每元素一次 MTE3 标量写），`dk=128, vStep=16` 时 2048 对，**每 (head, tile) 只付一次**（只在最后一块）。
- 为什么出口不也用 DMA？出口要 FP32→FP16 转置，DMA 不能转置，向量化转置又需要第二块 UB；且写出后不再被读，标量路径最简单。代价是 `dv` 很大时 final_state 的写出会成为尾延迟——但相对七步的 2.87 万条向量指令，2048 次标量写是小头。
- 数值口径：`CAST_NONE` 是 FP32→FP16，超出 ±65504 会得 ±inf（不饱和）。state 经过 `e^{G_l}` 衰减与 v_new 累加，正常配置下不会超；但 :911 的写出**没有任何数值检查**，与"只有最后一块才量化"的误差论述（:876-877）共同构成 state 的精度画像：**跨块零量化误差累积，接口一次量化**。

---

## 14. state tile 与全部 stride 总表

七步里出现的每一种"行 stride"和"块基址"，一张表钉死（定义处行号 + 使用处行号）：

| 缓冲 / 对象 | 逻辑布局 | 行 stride | 元素宽 | 定义处 | 主要使用处 |
|---|---|---|---|---|---|
| `chunkVFp32` | `[cs, vStep]` FP32 | `avFp32 = vStepAligned_` | `curV`（GM 侧）/`vStepAligned_`（向量侧） | :165 | :676/:709/:711/:743/:792/:803/:841/:870 |
| `chunkAttnOutFp32` | `[cs, vStep]` FP32（另兼 FP16 staging / Q 缓存） | `avFp32` | 同上 | :180 | :687/:734/:738/:805/:814/:836/:345 |
| `stateInFp32` | `[Dk, vStep]` FP32 | `vStepAligned_` | `vStepAligned_`（含 padding 列） | :171/:176 | :753/:764/:778/:797/:822/:857/:868/:887/:898/:901 |
| `chunkScoresFp32`(A) / `decayMaskFp32`(M) | `[cs, cs]` FP32 | `chunkSize_`（=64，**恒为编译期分块大小**，非 chunkLen） | `cs` | :170/:174 / :162 | :740/:838 |
| `chunkKFp32`(K→K_cd) / `kCumdecayFp32` | `[cs, dk]` FP32 | `alignK_ = ceil(dk,16)*16` | `realK_` | :157/:161 | :796/:634/:638 |
| `gCumsumFp32` / `expGCumFp32` | `[cs]` FP32 | — | `cs` | :183/:194 | :819/:853/:864 |
| `valueGm_` / `attnOutGm_` | `[B,T,Nv,Dv]` FP16 | `NV_*realV_`（token 行） | `realV_`（head 行） | :113/:120/:122 | :683/:688/:909(类比)/:341 系列 |
| `queryGm_` / `keyGm_` | `[B,T,Nk,dk]` FP16 | `NK_*realK_` | `realK_` | :111/:118/:457 | :818/:863 |
| `initStateGm_` / `finalStateGm_` | `[B,Nv,Dv,Dk]` FP16/outType | `realK_` | `realK_` | :377 | :778/:909 |
| `stateWorkspaceGm_` | `[B,Nv,Dk,ceil(dv,8)*8]` **FP32** | `stateWorkspaceStrideV_` | 同上 | :378/:92 | :763/:886 |

两条 V 方向宽度的区别是这张表的精髓：**`vStepAligned_ = ceil(vStep,8)*8` 描述"计算 tile 的一行"，`stateWorkspaceStrideV_ = ceil(dv,8)*8` 描述"workspace 里一整条 dk 行"**。前者 ≤ 后者，二者的差就是 Step 3/7 必须带 `v_i` 列偏移、并且只能按 `d` 逐行 DMA 的全部原因。

tile 内存图（`dk=128`、`vStep=16`、末 tile `curV=8` 时）：

```
stateInFp32 (FP32, 128 × 16)
 col:      0 ......... 7 | 8 ....... 15      ← vStepAligned_=16
 row d=0:  [ 真实 8 列    ][ 0（:753 清零）]
 row d=1:  [ 真实 8 列    ][ 0            ]
   ...
 row d=127:[ 真实 8 列    ][ 0            ]
 (stateStrideK_=128 = realK_ ⇒ 无 padding 行；dk=100 时会有 124-127 行全 0)
```

## 15. 指令量账与隐患清单

以 `cs=64, dk=128, vStep=16`（`avFp32=16`）为单位 `(chunk, v-tile)`：

| 步骤 | 向量指令（约） | 宽度 | 标量系数读 | 备注 |
|---|---|---|---|---|
| 1 LoadVBeta | 1 `Duplicate` + `cs`×(`Cast`+`Muls`) ≈ 129 | 16 | `cs` 次 GM（β） | 1 条 DMA |
| 2 ComputeValueNew | 2080 `Axpy` + 1 `Duplicate` | 16 | 2080 次 UB | $\sum(i+1)$ |
| 3 LoadStateTile | `dk` 条 DMA（或初值 2048 对标量） | — | — | §6 指出可压成 1 条 2D DMA |
| 4 ComputeVNew | 8192 `Axpy` + 64×(`Duplicate`+`Muls`+`Add`) = 8384 | 16 | 8192 次 UB | `Muls` 可与 `Add` 合并成 `Sub` ⇒ 省 64 |
| 5 ComputeAttnInter | 8192 `Axpy` + 64 `Duplicate` = 8256 | 16 | 8192 次 **GM** + UB 64 | 最贵：GM 标量读 |
| 6 AccumOutput | 2080 `Axpy` | 16 | 2080 次 UB | — |
| 7 UpdateAndWriteState | `dk`×`Muls` + `cs*dk`×`Axpy` = 8320 | 16 | 8192 次 **GM**(K) + UB 129 + 64 次 `ScalarExp`(≈24 标量乘/次) | — |
| 出 WriteAttnTileToGm | 3 条（`Muls`+`Cast`+DMA） | 全 tile | — | 04 篇 §8 |
| **合计** | **≈ 2.9 万条 16 宽向量指令** | 单条 64 B | **≈ 2.1 万次标量取系数，其中 ≈1.65 万次是 GM 标量读** | — |

三条结论：

1. **"无 Cube"的代价不是算术吞吐，是指令下发与标量访存**。2.9 万条 64B 向量指令把 UB 带宽用掉约 1.8 MB，但更致命的是每次 Axpy 前要一次标量取系数（S→V 打点 + 可能的 GM 标量读）。Step 5/7 的 1.65 万次 GM 标量读完全可以避免——如果 UB 里还留着 Q/K 的 FP32 副本。这就是 `ubRestBytes` 预算（02 篇）与七步性能之间的直接因果。
2. **零风险优化只有 4 处**，且都不改语义：§6/§12 的 `realK_` 次 DMA → 1 次 2D DMA；§8 的 `Muls(-1)+Add` → `Sub`；§11 的 `realK_` 次 `Muls` → 1 次整块 `Muls`；§9 的 `scale_` 提前折入 `gExp`。其余（每 Axpy 一次的 `coefficientSync`、每行一次的 `PipeBarrier<PIPE_V>`）能省但要**先证明 V 管道对同缓冲区读写的按序性**，不是零风险。
3. **两条硬隐患**：① §3 的快路径把"`v_i` 是 16 的倍数 ⇒ GM 行首 32B 对齐"当作隐式前提，host 的 `SolveVStep` 若改变枚举步长会**静默错地址**（不是退化到慢路径）；② §11 的 `ScalarExp` 在 `|g|` 导致 `G` 上溢成 `inf` 时会死循环（:267 的 `while`），kernel 对 `g` 的符号与幅度**没有任何校验**，:518/:528 的硬件 `Exp` 也没有饱和。