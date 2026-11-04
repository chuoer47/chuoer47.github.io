# 02b · kernel 逐段精读（下）：递推本体、输出回收到成员清单

> 行域：`src/96ea3f55/op_kernel/recurrent_gated_delta_rule.h:435-675`（`wc -l` 全文件 675 行，
> 前半 `:1-310` 在 `02` 篇、`:311-434` 在 `02a` 篇；台账行 `op_kernel/recurrent_gated_delta_rule.h 435 675 02b primary`）。
> 行号锚点属 commit `96ea3f55`。本篇的交叉引用一律标 `also:` 并指向 `02` 的对应小节。

## 1. 结论先行

1. **`Compute`（`:435-472`）是 DeltaNet 递推的一行直译**，38 行里没有任何 tiling 技巧：
   衰减 → `memory = kᵀS` → `delta = (v − memory)·β` → `S += k·deltaᵀ` → `out = qᵀS`。
   技巧全在装载侧（`02a` 篇 §6）与回收侧（本篇 §3、§4）。
2. **输出队列的"pending"机制不是双缓冲而是"延迟一次释放"**（`QueueAttnOutput`/`QueueStateOutput`，
   `:532-556`）：深度 1 时直接 `CopyOut`；深度 2 时把上一次的 offset 记下、本次结束时才回收。
   这个设计让 `stateOutBufferNum_`/`attnOutBufferNum_` 成为**唯一的流水开关**，
   而 `01b` 篇 §5.1 已推出它实际只能取 `1` 或 `2`。
3. **`ProcessHead`（`:587-611`）才是 v 方向的流水调度器**：进入即在 `:597` 预取第一片，
   循环内在 `LoadPrefetchedState` 之后、`ProcessSequenceChunk` 之前插入下一片的 `PrefetchState`
   （`:600-607`）——**MTE2 与 V 的重叠窗口只有一次 DMA 的长度**。
4. **`:478-479` 与 `:491` 的 `SetWaitFlag<HardEvent::MTE3_V>` 是全文件唯一的 MTE3 回收屏障**，
   它把"MTE3 还在搬"与"Vector 可以覆写该槽"强制串行，是 §2 结论 1 的另一半理由。
5. **成员清单（`:613-673`，61 行）里有 4 个从未被写入、1 个从未被读取**，详见 §7。

## 2. `Compute`（`:435-472`）：数学本体

```cpp
  __aicore__ inline void Compute(uint32_t curSingleV, uint64_t curQKOffset, uint64_t curVOffset) {
    uint32_t alignedV = Ceil(curSingleV, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;
    if (hasGama_) {
      Muls(stateInUb, stateInUb, gama_, alignK_ * alignedV);
    }
    if (hasGamaK_) {
      if (gamaKScalar_) {
        Muls(stateInUb, stateInUb, gamaK_, alignK_ * alignedV);
      } else {
        for (uint32_t v = 0; v < alignedV; ++v) {
          Mul(stateInUb[v * alignK_], stateInUb[v * alignK_], gamaKInUb[curQKOffset], alignK_);
        }
      }
    }
```

对照 

$$S_t = γ_t·S_{t-1} + β_t·k_t(v_t − k_tᵀS_{t-1})ᵀ$$

- `alignedV`（`:436`）与 `02a` 篇 §6 里 `LoadPrefetchedState:398` 的 `alignedV` 是**同名同式的两次独立计算**
  （`Ceil(curSingleV,16)*16`）。两处必须同值，否则衰减长度与 `Cast` 长度错开。
  `stateInUb` 在 `:400` 被写到 `alignK_*alignedV`（用 `LoadPrefetchedState` 的 `alignedV`），
  `:438` 又按 `alignK_*alignedV`（用 `Compute` 的 `alignedV`）缩放——两处 `curSingleV`
  来自同一变量（`:575` 传下去的 `curSingleV`），所以同值。**不是缺陷，但是脆弱**：
  任何一个调用者给 `Compute` 传了不同的 `curSingleV`，就会静默算错尾片。
- `Muls` 是标量乘（`:438`、`:442`），`Mul` 是张量乘（`:445`）。
  `gamaKScalar_` 的两条分支因此只差在 `gamaK_`（成员 float，`:668`）与 `gamaKInUb[curQKOffset]`（UB 向量）之间。
- **`:445` 的 `gamaKInUb[curQKOffset]` 少了一维**：逐 v 通道的 per-dim 衰减本应随 v 变化，
  但这里所有 v 都用同一个 `curQKOffset` 起点、`alignK_` 长度。
  这不是 bug：`gk` 是 **per (token, k-dim)** 的向量（`[T, NV, DK]`，`01` 篇 §2），
  与 v 通道无关——它沿 `k` 维衰减状态矩阵的**行**（`stateInUb[v*alignK_]` 是第 v 列的 `dk` 维向量）。
  所以"所有 v 乘同一条 `gk`"正是数学要求。
- `:449-451` 的条件 barrier：

```cpp
    if (hasGama_ || hasGamaK_) {
      PipeBarrier<PIPE_V>();
    }
```

  无衰减时（两个 flag 都假）**跳过** barrier。合理，但注意 `:445` 的循环体内没有 barrier，
  `alignedV` 次 `Mul` 写的是互不重叠的区段，Vector 流水内部不会自冲突。

```cpp
    for (uint32_t v = 0; v < curSingleV; ++v) {
      float memory = DotFp32(stateInUb[v * alignK_], kInUb[curQKOffset]);
      float delta = (vInUb.GetValue(curVOffset + v) - memory) * beta_;
      Muls(broadTmpInUb, kInUb[curQKOffset], delta, alignK_);
      PipeBarrier<PIPE_V>();
      Add(stateInUb[v * alignK_], stateInUb[v * alignK_], broadTmpInUb, alignK_);
      PipeBarrier<PIPE_V>();
    }
    for (uint32_t v = 0; v < curSingleV; ++v) {
      attnInUb.SetValue(v, DotFp32(stateInUb[v * alignK_], qInUb[curQKOffset]));
    }
```

1. **`kInUb[curQKOffset]` 在 `:453` 被当第 2 入参、在 `:455` 又被当被乘源**，
   中间 `:453` 的 `DotFp32` 覆写了 `broadTmpInUb`（`02a` 篇 §7 第 1 点）。
   `kInUb` 全程只读，所以 `:455` 安全。
2. **`vInUb.GetValue(curVOffset + v)` 是标量读**（`:454`）：`v` 分量按标量取，
   不需要向量指令。`curVOffset = (seq_i-seq0)*alignV_ + v_i`（`:567`），
   所以 v 方向是**按 `alignV_` 跨步**的——与 `02` 篇 §8.1 的"UB 用 `align`、GM 用 `real`"规则一致。
   标量读要求 `V_S` 同步，由 `DotFp32` 内部末尾的 `WaitVectorToScalar()`（`:414`）顺带完成——
   `:453` 的 `DotFp32` 必然先于 `:454` 的 `GetValue` 执行，**顺序保证而非事件保证**。
   若 `curSingleV == 0`（空分片），`DotFp32` 不会跑，`:454` 也不跑，无碍。
3. **`:456` 与 `:458` 两个 barrier 是必需的**：`Muls` 写 `broadTmpInUb`、`Add` 读它并写 `stateInUb`，
   都是 Vector 指令，但 `Muls`/`Add` 之间存在 WAR 与 RAW 混合（`broadTmpInUb` 的 RAW、
   `stateInUb[v*alignK_]` 的 WAR——`:453` 的 `Mul` 也读过它）。
   Vector 流水内同管道无需事件，但**跨指令的同一目标区需要 `PipeBarrier<PIPE_V>`**，
   AscendC 的 `PipeBarrier` 正是这个用途。
4. **`:460-462` 的第二个循环与第一个分离**，不能合并：`out_t = qᵀS_t` 要求 `S_t` 的该列
   已经完整更新。同一 v 内可以合并（`Add` 之后立刻 `DotFp32`），但作者选择两个循环——
   差别是 `stateInUb` 的整块更新先做完，再统一读。对单 v 无差别（v 之间不相关），
   所以两种写法等价；拆开的收益是 `qInUb` 的读取模式更规整。

```cpp
    TQueSync<PIPE_S, PIPE_V> scalarToVectorSync;
    scalarToVectorSync.SetFlag(0);
    scalarToVectorSync.WaitFlag(0);
    LocalTensor<outType> attnOutLocal = attnOutQueue_.AllocTensor<outType>();
    CastFp32ToOutput(attnOutLocal, attnInUb, alignedV);
    attnOutQueue_.EnQue<outType>(attnOutLocal);
    LocalTensor<outType> stateOutLocal = stateOutQueue_.AllocTensor<outType>();
    CastFp32ToOutput(stateOutLocal, stateInUb, alignK_ * alignedV);
    stateOutQueue_.EnQue<outType>(stateOutLocal);
```

- `TQueSync<PIPE_S, PIPE_V>`（`:463`）是**局部对象**（栈上、每次 `Compute` 构造一次），
  与 `SetWaitFlag` 的效果同（Set+Wait 连用），但走的是 `TQueSync` 而不是 `TPipe::FetchEventID`。
  它的作用是"Scalar 上的一串 `SetValue`（`:461`）已经落到 UB"之后 Vector 才能 `Cast`。
  这是本文件里**第三种** Scalar→Vector 同步写法（另两种：`WaitVectorToScalar:254`、
  `SetWaitFlag<HardEvent::V_S>:34`）。三种并存说明作者在不同段落试过不同 API。
  `:463` 的局部变量在离开作用域时析构，`TQueSync` 是否自动回收事件 id 由 AscendC 决定，
- `CastFp32ToOutput(attnOutLocal, attnInUb, alignedV)`（`:467`）**长度用 `alignedV` 而不是 `curSingleV`**：
  把 `alignedV` 个元素 cast 进 `vStep_` 大小的输出槽（`:226` 的槽容量是 `vStep_*sizeof(outType)`）。
  `attnInUb` 的容量正是 `vStep_`（`:229`），所以 `alignedV ≤ vStep_` 必须成立。
  `alignedV = Ceil(curSingleV,16)*16`，`curSingleV ≤ vStep_`（`:599`），
  而 `vStep_` 是 16 的倍数（host `EvaluateBufferProfile` 保证，`01b` 篇 §5.2），
  故 `alignedV ≤ vStep_` 恒成立。**这条链条是 `vStep` 必须 16 对齐的真实原因**，
  不是 DMA 对齐要求。
- 两个输出都在**同一个 `Compute` 末尾**入队，所以 `stateOutQueue_` 与 `attnOutQueue_` 的
  深度必须各自独立可配（`:225-226`）——这正是候选表要两个维度的原因。

## 3. 两个 `CopyOut`（`:473-493`）

```cpp
  __aicore__ inline void CopyOutAttn(uint64_t attnOffset, uint32_t curSingleV) {
    LocalTensor<outType> attnLocal = attnOutQueue_.DeQue<outType>();
    DataCopyParams attnOutParams{1, static_cast<uint16_t>(curSingleV * sizeof(outType)), 0, 0};
    DataCopyCustom(attnOutGm_[attnOffset], attnLocal, attnOutParams);
    // The queue has a single output buffer on 310P.  Do not return it to
    // the Vector producer until the asynchronous MTE3 copy has finished.
    SetWaitFlag<HardEvent::MTE3_V>(HardEvent::MTE3_V);
    attnOutQueue_.FreeTensor(attnLocal);
  }
```

`"a single output buffer"` 与 `:225-226` 的可配深度**表面上矛盾**：注释说 310P 上只有 1 个输出缓冲，
而 `stateOutBufferNum_` 可以是 2。调和方式：注释写的是**默认/最坏情形**（`01b` 篇 §5.1 的
候选搜索在 `gamaK` 为向量时确实收敛到 `{1,1}`）。所以 `:480` 的 barrier 在深度 1 时是必需的
（否则 `FreeTensor` 后下一次 `AllocTensor` 拿到同一块、Vector 立刻覆写，MTE3 还在读），
在深度 2 时是**保守但无害**的。

`attnOutParams` 的 `blockLen = curSingleV * sizeof(outType)`（`:476`）——**这正是 `02` 篇 §5.4 末
"尾部多写"窗口的来源**：`DataCopyCustom` 三参版（`:61-67`）会把它 `AlignUp` 到 32 字节。
`curSingleV` 只在最后一列片可能非 16 倍数。

`CopyOutState`（`:484-493`）：

```cpp
    LocalTensor<outType> stateOutLocal = stateOutQueue_.DeQue<outType>();
    for (uint32_t v = 0; v < curSingleV; ++v) {
      DataCopyParams stateOutParams{1, static_cast<uint16_t>(realK_ * sizeof(outType)), 0, 0};
      DataCopyCustom(finalStateGm_[stateOffset + static_cast<uint64_t>(v) * realK_],
                     stateOutLocal[static_cast<uint64_t>(v) * alignK_], stateOutParams);
    }
    SetWaitFlag<HardEvent::MTE3_V>(HardEvent::MTE3_V);
    stateOutQueue_.FreeTensor(stateOutLocal);
```

（`:485-492` 照抄。）与 attn 版三点不同：

1. **逐 v 行循环搬**（`:486-490`），因为 GM 侧行距是 `realK_`、UB 侧行距是 `alignK_`——
   两者不等时无法一次 `DataCopy`。这与 `02` 篇 §5.1 的 `gmStepPerRow` 是同一个问题，
   但这里没用 `DataCopyPadCustom` 的镜像（那是读方向），而是**手写循环 + 三参 `DataCopyCustom`**。
2. **每次迭代都新建 `DataCopyParams`（`:487`）**，值恒定，提到循环外即可。
   循环内 `DataCopy` 之间**没有 `PipeBarrier<PIPE_MTE3>()`**——
   对比 `02` 篇 §5.3 多块分支的 `:133`（那里有 barrier）。
   差异的根据：这里各行写的是 GM 上互不重叠的区段，且源 `stateOutLocal` 全程只读，
   MTE3 队列内多条 DMA 不会互相破坏，所以无 barrier 是对的。
3. `realK_ * sizeof(outType)`（`:487`）是**真实字节数**，`DataCopyCustom` 抬到 32 字节，
   于是每行都可能多写至 31 字节到 `finalStateGm_`，**下一行会把它盖掉**（因为下一行的
   写起点是 `stateOffset + (v+1)*realK_`，落在上一行多写区的内部或之后）。
   最后一行仍可能越出状态槽尾端。这与 attn 版是同一类窗口，`02` 篇 §5.4 的裁决同样适用。

## 4. `CopyInGamaBeta`（`:494-524`）与 `ReleaseGamaKInput`（`:525-530`）

`CopyInGamaBeta` 的调用点在 `02` 篇 §13.3（`:304`），每核每 batch 一次。

```cpp
    int32_t seqLen = seq1 - seq0;
    uint64_t bBatchSize = Ceil(seqLen * NV_, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;
    LocalTensor<inType> betaLocal = betaInQueue_.AllocTensor<inType>();
    DataCopyParams betaInParams{1, static_cast<uint16_t>(seqLen * NV_ * sizeof(inType)), 0, 0};
    DataCopyCustom(betaLocal, betaGm_[seq0 * NV_], betaInParams);
    betaInQueue_.EnQue<inType>(betaLocal);
    betaLocal = betaInQueue_.DeQue<inType>();
    Cast(betaInUb, betaLocal, RoundMode::CAST_NONE, bBatchSize);
    SetWaitFlag<HardEvent::V_MTE2>(HardEvent::V_MTE2);
    betaInQueue_.FreeTensor(betaLocal);
```

（`:496-505` 照抄。）注意与 `CopyInQKV`（`02a` 篇 §5）的三处风格差异：

| | `CopyInQKV` | `CopyInGamaBeta` |
|---|---|---|
| DMA 包装 | `DataCopyPadCustom`（ext params，处理 srcStride） | 三参 `DataCopyCustom`（无 stride） |
| Cast 长度 | `alignK_*seqLen`（分段常量） | `bBatchSize`（含 `Ceil(·,16)`） |
| 收尾同步 | `SetWaitFlag<V_MTE2>` 一次（`:376`） | `SetWaitFlag<V_MTE2>` 一次（`:504`）+ `WaitVectorToScalar()`（`:523`） |

`beta` 在 GM 上是 `[T, NV]` 紧排（`:500` 的 `seq0*NV_`），所以不需要 stride——
`beta` 的多 head **天然连续**，与 `q/k/v` 的"跨 head 跳 `(NK_-1)*realK_`"不同。

`gama` 与标量 `gamaK` 两支（`:506-520`）：

```cpp
    if (hasGama_) {
      DataCopyParams gamaInParams{1, static_cast<uint16_t>(seqLen * NV_ * sizeof(float)), 0, 0};
      DataCopyCustom(gamaInUb, gamaGm_[seq0 * NV_], gamaInParams);
      SetWaitFlag<HardEvent::MTE2_V>(HardEvent::MTE2_V);
      Exp(gamaInUb, gamaInUb, seqLen * NV_);
      PipeBarrier<PIPE_V>();
    }
    if (hasGamaK_ && gamaKScalar_) {
      DataCopyParams gamaKInParams{1, static_cast<uint16_t>(seqLen * NV_ * sizeof(float)), 0, 0};
      DataCopyCustom(gamaKScalarInUb, gamaKGm_[seq0 * NV_], gamaKInParams);
      PipeBarrier<PIPE_MTE2>();
      uint32_t gamaKAlignSize = Ceil(seqLen * NV_, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
      Exp(gamaKScalarInUb, gamaKScalarInUb, gamaKAlignSize);
      PipeBarrier<PIPE_V>();
    }
```

（`:506-520` 照抄。）三处不对称：

1. `gama` 支用 `SetWaitFlag<MTE2_V>`（`:509`）保证 DMA 完成后 Vector 才 `Exp`；
   `gamaK` 支用 `PipeBarrier<PIPE_MTE2>`（`:516`）。**同一目的、两种 API**。
   `PipeBarrier<PIPE_MTE2>` 只排空 MTE2 队列，不保证 MTE2→V 的事件语义，
   严格说 AscendC 要求跨管道用事件；但 `:523` 的 `WaitVectorToScalar()` 与
   `:519` 的 `PipeBarrier<PIPE_V>` 一起把后续读取兜住了。
   判定 **PSEUDO**：写法不一致但可达路径上有兜底同步，放行。
2. `Exp(gamaInUb, gamaInUb, seqLen*NV_)`（`:510`）长度**不带 16 对齐**，
   而 `Exp(gamaKScalarInUb, ..., gamaKAlignSize)`（`:518`）**带 `Ceil(·,8)*8`**。
   前者只算有效元素（更省），后者多算尾部（尾部是 `DataCopyCustom` 抬齐时带进来的垃圾，
   `Ceil(·,8)*8` 保证 `Exp` 的向量长度合法）。**两种取舍都对，但只有 `gamaK` 那支会 exp 垃圾值**——
   垃圾经 `exp` 可能变 `inf`/`NaN`，而 `gamaKScalarInUb` 的读取点是
   `:574` 的 `gamaKScalarInUb.GetValue(gbOffset)`，`gbOffset < seqLen*NV_`（`:565`），
   **落在有效区内**，NaN 不会被读。放行。
3. `beta` 用 `Cast` 到 FP32、`gama` 系列**直接以 float DMA 进 UB**（因为 GM 侧本来就是 FP32，
   `02` 篇 §10），所以 `gamaInUb` 后没有 `Cast`。

末尾两行注释 + 同步（`:521-523`）：

```cpp
    // beta/gama/gamaK are read with LocalTensor::GetValue in
    // ProcessHead.  Explicitly synchronize Vector writes to Scalar reads.
    WaitVectorToScalar();
```

`"read with LocalTensor::GetValue in ProcessHead"` — 精确说读取点在
`ProcessSequenceChunk`（`:572-574`），不在 `ProcessHead`。注释里的函数名比终态代码晚了一代：
`ProcessSequenceChunk` 是从 `ProcessHead` 里拆出来的（`06` 篇 §5 的 hunk 对应）。

`ReleaseGamaKInput`（`:526-530`）只有一件事：`hasGamaK_ && !gamaKScalar_` 时
`gamaKInQueue_.FreeTensor(gamaKInUb)`。守卫条件与 `InitBuffer`（`:221`）、
装载（`:345`）三处**必须完全一致**，实测三处字面相同。
被释放的 `gamaKInUb` 是成员（`:642`），在 `CopyInQKV:358` 被 `DeQue` 赋值、
在 `Compute:445` 被读——**释放点在 `ProcessHead` 末尾**（`:592`、`:610`），
即"本 head 的所有 v 片算完"之后。`realV_ == 0` 时走 `:592`（提前释放并 return），
该早退分支只在 `dv==0` 时触发。**快照内无人拦 `dv==0`**：
`infershape.cpp:24-53` 只做形状照抄、不比任何维值（`01` 篇 §3），
tiling 侧 `GetShapeDims` 也不因 `dv==0` 而 `return GRAPH_FAILED`（`01b` 篇 §4.1）。
所以 `:591-594` 不是冗余护栏，而是**全链路上唯一一处对 `realV_==0` 的反应**；
它的存在反过来说明作者知道上游不查。

## 5. 两个 Queue 包装（`:531-556`）：唯一的流水开关

```cpp
  __aicore__ inline void QueueAttnOutput(uint64_t attnOffset, uint32_t curSingleV, uint64_t &pendingOffset,
                                         bool &hasPending) {
    if (attnOutBufferNum_ == BUFFER_NUM) {
      CopyOutAttn(attnOffset, curSingleV);
      return;
    }
    if (hasPending) {
      CopyOutAttn(pendingOffset, curSingleV);
    }
    pendingOffset = attnOffset;
    hasPending = true;
  }
```

（`:532-543` 全录。）`QueueStateOutput`（`:545-556`）与之逐字符同构，
只把 `attnOutBufferNum_`→`stateOutBufferNum_`、`CopyOutAttn`→`CopyOutState`。
台账标 `also:` 不重复引用。

**这个"延迟一格"的语义要说清楚**：深度 2 时，第 n 次调用把 offset 记下，第 n+1 次调用
才真正 `CopyOut(pendingOffset, curSingleV)`——注意第二个实参是**当次的 `curSingleV`**。
两次调用的 `curSingleV` 相同吗？看 `ProcessSequenceChunk`（`:558-585`）：
`curSingleV` 是**函数入参**（`:559`），在整个 `seq_i` 循环里不变（`:564-577`），
所以 `CopyOutAttn(pendingOffset, curSingleV)` 复用的是同一个长度——**正确**。
但 `CopyOutAttn` 的长度语义是"本次要写多少行/多少个 v 通道"，
`pendingOffset` 是**上一个 token** 的 attn 起点。token 间的 v 通道数确实相同（同一分片内），
所以延迟回收不改变写长度。**这是这段代码能成立的隐含前提，函数签名没有任何一处说明它。**
若未来把 `ProcessSequenceChunk` 改成按 token 变长分片，`curSingleV` 不再恒定，此处静默出错。

深度 2 的实际收益：`Compute` 第 n+1 次 `AllocTensor` 时第 n 次的 MTE3 还在飞，
`TQue` 有 2 槽就不会阻塞。而 `CopyOutAttn` 内部的 `SetWaitFlag<MTE3_V>`（`:480`）
又把"回收"串行化了——所以**净收益只有"多一次 `AllocTensor` 不阻塞"这么一点**，
这与 `01b` 篇 §5.1 推出的"候选搜索几乎总是收敛到 `{1,1}`"是自洽的：
作者自己算出来深度 2 的收益不值那 1 个队列槽的 UB。

## 6. `ProcessSequenceChunk`（`:557-585`）与 `ProcessHead`（`:586-611`）

### 6.1 五个 offset 的算式（`:564-571`）

```cpp
      uint64_t gbOffset = head_i + (seq_i - seq0) * NV_;
      uint64_t curQKOffset = (seq_i - seq0) * alignK_;
      uint64_t curVOffset = (seq_i - seq0) * alignV_ + v_i;
      uint64_t attnOffset = (seq_i * NV_ + head_i) * realV_ + v_i;
      uint64_t curStateOutOffset =
        (static_cast<uint64_t>(GetSsmStateIndex(seq_i)) * NV_ + head_i) * static_cast<uint64_t>(realK_) * realV_ +
        v_i * static_cast<uint64_t>(realK_);
```

（`:565-571` 照抄，注意 `:570` 的续行缩进是 8 空格而非 4——与 `:569` 的 6 空格一起，
是本文件里唯一一处非 2 倍数缩进，cpplint 会报 `whitespace/indent`，未加 NOLINT。）

- `gbOffset` 用 `seq_i - seq0`（UB 内相对），`attnOffset` 用 `seq_i`（GM 绝对）。
  这一对比是"UB 相对/GM 绝对"命名约定的范例。
- `curStateOutOffset` 里的 `GetSsmStateIndex(seq_i)`（`:570`）是**逐 token 的读槽**——
  与 `02` 篇 §13.3 的 `stateOffset`（`:303`，回退调整过的**读源**）不同，
  写槽**不做回退调整**。`03` 篇 §4 用这张对照表说明"回退只影响读"。
- `curStateOutOffset` 的 `realK_ * realV_`（`:570`）是**一个状态的元素数**，
  而 `PrefetchState` 的读偏移 `nextStateOffset`（`:604`）也是
  `(stateOffset*NV_ + head_i)*realV_*realK_ + nextVOffset*realK_`。
  两者**结构相同、索引来源不同**（读用 `stateOffset`，写用 `GetSsmStateIndex(seq_i)`）。
- **`:570` 每 token 一次 `GetValue` 标量读 GM**（`ssmStateIndices`）：
  `seqLen × 每 head` 次 GM 标量读，最贵的一种访存。放在 token 循环内 unavoidable，
  因为 `GetSsmStateIndex` 本来就是逐 token 的。

### 6.2 三个衰减标量的取值（`:572-574`）

```cpp
      gama_ = hasGama_ ? gamaInUb.GetValue(gbOffset) : 1;
      beta_ = betaInUb.GetValue(gbOffset);
      gamaK_ = (hasGamaK_ && gamaKScalar_) ? gamaKScalarInUb.GetValue(gbOffset) : 1;
```

- `beta_` **没有三元守卫**（`:573`）——`beta` 是必选输入（`01` 篇 §2），恒可读。
- 赋的是**成员**（`:667-669`）而非局部量，所以 `Compute` 通过成员读它们。
  这是"参数太多不想传"的做法，代价是 `Compute` 不再是纯函数（`04` 篇 §3 讨论其对流水的影响）。
- `:1` 而非 `1.0f`：`int` 到 `float` 的隐式转换（成员是 `float`），cpplint 不反对，
  但与 `02` 篇 §7 初值列表的 `1.0f` 风格不一。

### 6.3 首尾收尾（`:579-584`）

`ProcessSequenceChunk` 退出 token 循环后，把两个 pending 各刷一次：

```cpp
    if (hasPendingAttn) {
      CopyOutAttn(pendingAttnOffset, curSingleV);
    }
    if (hasPendingState) {
      CopyOutState(pendingStateOffset, curSingleV);
    }
```

（`:579-584` 照抄。）pending 变量是**函数局部**（`:560-563`），所以它们的生命周期
只在**一个 (head, v 分片)** 内。即：深度 2 的收益仅在同一个 v 分片的多个 token 之间存在，
**跨分片不保留 pending**。这解释了为什么 `:560-563` 放在 `ProcessSequenceChunk`
而不是 `ProcessHead`：token 循环连同这段 pending 状态一起被抽成了新函数（终态 `:558-585`），
`ProcessHead` 从 `:587` 起只管 v 分片调度。抽取过程见 `06` 篇 §3.5 的 hunk #12
（`recurrent_gated_delta_rule.h` 的 `@@ -541,75 +523,91 @@`，旧侧 `f3f5e676:544-613`）。

### 6.4 `ProcessHead`：v 方向的预取调度

```cpp
  __aicore__ inline void ProcessHead(int32_t seq0, int32_t seq1, uint64_t head_i, uint64_t stateOffset) {
    uint64_t vOffset = (seq0 * NV_ + head_i) * realV_;
    uint64_t qkOffset = (seq0 * NK_ + head_i / (NV_ / NK_)) * realK_;
    CopyInQKV(vOffset, qkOffset, seq1 - seq0);
    if (realV_ == 0) {
      ReleaseGamaKInput();
      return;
    }
    uint32_t nextSingleV = realV_ > vStep_ ? vStep_ : realV_;
    uint64_t nextStateOffset = (stateOffset * NV_ + head_i) * static_cast<uint64_t>(realV_) * realK_;
    PrefetchState(nextStateOffset, nextSingleV);
    for (uint64_t v_i = 0; v_i < realV_; v_i += vStep_) {
      uint32_t curSingleV = v_i + vStep_ > realV_ ? realV_ - v_i : vStep_;
      LoadPrefetchedState(curSingleV);
      uint64_t nextVOffset = v_i + vStep_;
      if (nextVOffset < realV_) {
        nextSingleV = nextVOffset + vStep_ > realV_ ? realV_ - nextVOffset : vStep_;
        nextStateOffset = (stateOffset * NV_ + head_i) * static_cast<uint64_t>(realV_) * realK_ +
                          nextVOffset * static_cast<uint64_t>(realK_);
        PrefetchState(nextStateOffset, nextSingleV);
      }
      ProcessSequenceChunk(seq0, seq1, head_i, v_i, curSingleV);
    }
    ReleaseGamaKInput();
  }
```

（`:587-611` 全录，25 行。）结构：

- `qkOffset`（`:589`）的 GQA 映射 `head_i / (NV_/NK_)`：除零与错映射均**无上游校验**，
  裁决见 `02a` 篇 §5（不作 PSEUDO 放行，记「待真机验证」）。
- `CopyInQKV` 在**预取之前**（`:590` vs `:597`）：先把 q/k/v 装进 `qInUb`/`kInUb`/`vInUb`
  （`tmpBuff` 区），再把状态片 DMA 进 `stateInQueue_`。两者不冲突，顺序是"小对象先落地"。
- `:595` 的 `nextSingleV` 初值与 `:599` 的 `curSingleV` 表达式同构（`min(vStep_, realV_ - 起点)`）。
- `:596`/`:604` 两次算 `nextStateOffset`，`:596` 是首片（`v_i=0` 偏移为 0），
  `:604` 是后续片。同一个式子写两遍，`04` 篇 §2 会把它抽成一个"片号 → 偏移"的映射来讲。
- **预取窗口只有一次**：`LoadPrefetchedState(curSingleV)`（`:600`，含 `CastInputToFp32`）
  → `PrefetchState(next)`（`:606`，仅发 MTE2）→ `ProcessSequenceChunk(...)`（`:608`，整个 token 循环）。
  所以 MTE2 的 `state` DMA 与 V 的 `Compute` 重叠时长 ≈ 一次 `ProcessSequenceChunk`。
  `seqLen=1`（decode 常态）时这窗口只有**一次 `Compute`**，重叠极小；
  `seqLen=8`（MTP 上限）时窗口 8 倍。这是"`MAX_MTP` 越大流水越值"的代码级依据，
  也是 `04` 篇的核心量化结论。
- `ReleaseGamaKInput()` 在 `:610`（正常末尾）与 `:592`（`realV_==0` 早退）各一次，
  两条路径**互斥且都释放**，不重复释放。

## 7. 成员清单（`:613-673`）：4 个只读、1 个从未用

```cpp
 private:
  GlobalTensor<inType> queryGm_;
```

（`:613-614` 起。）按类型分组统计（`:614-627` 共 14 个 `GlobalTensor`、`:628` 一个 `TPipe *`、
`:629-637` 共 9 个队列/缓冲句柄、`:638-647` 共 10 个 `LocalTensor<float>`、
`:648-659` 共 12 个 `uint32_t`、`:660-666` 共 7 个 `bool`、`:667-670` 共 4 个 `float`、
`:671-672` 共 2 个 `uint64_t`）。合计 60 个成员，与 `:613-673` 的 61 行只差 `private:` 一行。

三条实测结论：

1. **`T_`（`:649`）只在 `:284` 被读，从不参与地址**——`02` 篇 §8.1 已述；它是**校验字段**。
2. **`restUbSize_`（`:659`）只在 `:227` 被读一次**，之后不再使用。它存在的唯一理由是
   把 `Init`→`InitLocalBuffers` 的参数链缩短（否则要传参）。
3. **`gamaKInUb`（`:642`）是队列句柄之外的"跨函数持久 LocalTensor"**：
   它在 `CopyInQKV:358` 被赋值、`Compute:445` 被读、`ReleaseGamaKInput:528` 被释放，
   跨越三个函数。其余 9 个 `LocalTensor<float>` 全部由 `tmpBuff.GetWithOffset` 在
   `InitLocalBuffers` 里一次赋好。**`gamaKInUb` 是唯一来自队列而非 `tmpBuff` 的持久 LocalTensor**——
   这个不对称是因为 `gk` 需要"先 DMA 进队列 → `Exp` → 长驻"，
   而 `Exp` 的目的地恰好就是队列那块内存（`:359` 的 `Exp(gamaKInUb, gamaKInUb, ...)` 原地），
   所以没必要再拷进 `tmpBuff`。省一个 `alignK_*MAX_MTP*4` 的 FP32 缓冲。

`:635-636` 的 `TQue<QuePosition::VECOUT, MAX_OUT_BUFFER_NUM>`：模板深度 2 是**编译期上限**，
`:629-634` 的 `TQue<QuePosition::VECIN, 1>` 是**编译期恒定 1**。
所以本文件里"输入无流水、输出至多两槽"是**类型系统层面写死的**，
`InitBuffer` 的参数只能减少不能增加。`04` 篇据此论证
"为什么 `state` 的双缓冲必须借道 `tmpBuff` 里的 `stateInUb`"。

`:667-670` 的四个 `float` 成员（`gama_ gamaK_ beta_ scale_`）里，
`scale_` 只在 `:375` 读一次、`beta_`/`gama_`/`gamaK_` 在 `:572-574` 写、`:438/442/454` 读。
**`gamaK_` 与 `gamaKInUb` 是同一物理量的两种 dtype 通路**（标量版 vs 向量版），
不会同时有效（`gamaKScalar_` 互斥，`01b` 篇 §4.2）。

## 8. 收尾（`:674-675`）

```cpp
#endif  // RECURRENT_GATED_DELTA_RULE_KERNEL_H_
```

（`:675`；`:674` 是空行。）与 `:18` 的 `#ifndef RECURRENT_GATED_DELTA_RULE_KERNEL_H_` 配对，
`#endif` 后的注释是 cpplint 要求。本文件被入口 `.cpp`（`01` 篇 §6）与
`tiling_data.h`（`01` 篇 §4）间接包含链检查过：**只有入口 `.cpp` 一处 include 它**，
所以 675 行的头文件只被 1 个编译单元展开，编译耗时不是问题。

