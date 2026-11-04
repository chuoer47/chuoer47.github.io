# 02a · kernel 逐段精读（中）：`private:` 工具段与输入装载

> 行域：`src/96ea3f55/op_kernel/recurrent_gated_delta_rule.h:311-434`（`wc -l` 全文件 675 行，
> `:1-310` 归 `02` 篇、`:435-675` 归 `02b` 篇；台账行
> `op_kernel/recurrent_gated_delta_rule.h 311 434 02a primary`）。
> 所有行号锚点属 commit `96ea3f55` 快照；交叉引用的 `op_host/` 行号属同快照。

## 1. 结论先行

1. **`:311` 的 `private:` 段是 8 个 `__aicore__ inline` 函数，没有一个是"通用工具"**——
   每个只服务 `ProcessHead`/`Compute` 的一条具体通路。读完这 124 行就读完了本 kernel 的
   **全部输入装载语义**：`CopyInQKV` 装 q/k/v/gk，`PrefetchState`+`LoadPrefetchedState` 装 state，
   两个 `Cast` 包装做 fp16↔fp32 转换，两个 `Get*` 适配器做 int32/int64 分支。
2. **本段唯一的"算力"函数是 `DotFp32`（`:405-424`）**：1 次 `Mul` + 至多 1 次 `WholeReduceSum` +
   标量顺序加。整条链不碰矩阵乘单元，所以 RGDR 的性能由 Vector 与 Scalar 的交替决定，
   而不是 Cube（`05` 篇 §4 展开）。
3. **`CopyInQKV` 一次装齐整个 `seqLen` 的 q/k/v**（`:362-373`），此后 token 循环期间不再有任何
   输入方向的 GM→UB 搬运（只剩 state 预取）。这是"大批装载 + 小步计算"的形态，与
   `02b` §6 的 `ProcessSequenceChunk` 分工一致。
4. **两处名不副实定义了污染范围**：`DataCopyPadCustom` 不做 pad（`padParams` 从未使用，`02` 篇 §5.1），
   因此 `dk` 非 16 倍数时 `stateInUb` 列尾是历史残留；`Cast(..., CAST_NONE)` 在 FP32→FP16 方向
   就是**唯一量化点**（`:430`）。前者是"缺的填充"，后者是"多的舍入"。

## 2. `private:` 段地图（`:311-434`）

`:311` 是一行 ` private:`（`Process` 的收尾花括号 `:309` 与 `:310` 空行之后）。其下 8 个函数、
共 124 行，按源码顺序与其调用点：

| 行域 | 函数 | 职责 | 调用点（所属篇） |
| --- | --- | --- | --- |
| `:312-317` | `GetCuSeqlen` | 按 dtype 开关读 `cu_seqlens` 的一个标量 | `:267`、`:268`、`:271`、`:274`（`02` §13.1） |
| `:319-324` | `GetSsmStateIndex` | 按 dtype 开关读 `ssm_state_indices` 的一个标量 | `:303`（`02` §13.3）、`:570`（`02b` §6.1） |
| `:326-333` | `CastInputToFp32` | fp16→fp32，按 `MAX_CAST_ELEMENTS` 分片 | `:400`（本篇 §6） |
| `:335-380` | `CopyInQKV` | 整段 q/k/v（+向量版 gk）入 UB 并转 fp32 | `:590`（`02b` §6.2） |
| `:382-395` | `PrefetchState` | 一段 state 的 GM→UB 搬运，入队列 | `:597`、`:606`（`02b` §6.2） |
| `:397-403` | `LoadPrefetchedState` | 出队 + 转 fp32 写进 `stateInUb` | `:600`（`02b` §6.2） |
| `:405-424` | `DotFp32` | 长度 `alignK_` 的点积，返回标量 | `:453`、`:461`（`02b` §2） |
| `:426-433` | `CastFp32ToOutput` | fp32→fp16，按 `MAX_CAST_ELEMENTS` 分片 | `:467`、`:470`（`02b` §2） |

两点结构观察：

- **`GetSsmStateIndex` 是全文件唯一被两个篇章（读槽 `:303` / 写槽 `:570`）同时使用的函数**，
  这正是 `03` 篇"读槽/写槽不同源"结论的代码落点。
- 8 个函数里只有 `DotFp32` 有返回值，其余 7 个返回 `void` 并靠 UB 里的具名 `LocalTensor`
  成员传递结果（`qInUb`、`kInUb`、`vInUb`、`gamaKInUb`、`stateInUb`、`broadTmpInUb`）。
  所以这些函数**不能并发调用**，`02b` 篇 §2 的 `PipeBarrier<PIPE_V>()` 序列就是这套共享
  缓冲的护身符。

## 3. 两个 dtype 适配器（`:312-324`）

`GetCuSeqlen`（`:312-317`）与 `GetSsmStateIndex`（`:319-324`）形状完全相同：
`if (isInt64_) return (int32_t)gm64.GetValue(idx); return gm32.GetValue(idx);`。
**返回值都是 `int32_t`**，即 int64 索引被截断到 32 位。对 `cu_seqlens` 无害（token 数不会过 21 亿）；
对 `ssmStateIndices` 是**状态池槽位号**，池大小受 `state` 张量首维限制，也不可能过 21 亿。
截断在语义上安全，但它说明一件事：**int64 绑定只是为了接住 dtype，不是为了支持大索引**。
真正的动机在 def 侧——mindspore-lite 的图里 `arange` 产出 int64，不接住就得插 cast 算子。

## 4. `CastInputToFp32`（`:326-333`）与 `CastFp32ToOutput`（`:426-433`）

两个函数体**逐字符相同**（除了名字与 `dstTensor`/`srcTensor` 的方向注释性差异），
都是按 `MAX_CAST_ELEMENTS` 切分 + `Cast(..., RoundMode::CAST_NONE, currentCount)` + `PipeBarrier<PIPE_V>()`。

```cpp
    for (uint32_t offset = 0; offset < elementCount; offset += MAX_CAST_ELEMENTS) {
      uint32_t currentCount = Std::min(MAX_CAST_ELEMENTS, elementCount - offset);
      Cast(dstTensor[offset], srcTensor[offset], RoundMode::CAST_NONE, currentCount);
      PipeBarrier<PIPE_V>();
    }
```

（`:328-332` 照抄；`:428-432` 与之逐字符一致。）
`RoundMode::CAST_NONE` 在本文件出现 6 次（`:330`、`:371`、`:372`、`:373`、`:430`、`:503`）。
`CAST_NONE` 在 AscendC 里对 FP16→FP32 是"精确加宽"（无精度损失），对 FP32→FP16 是
**截断还是舍入取决于实现**，通常是就近舍入到偶数。`CastFp32ToOutput`（`:426`）就是 FP32→FP16，
`:430` 的 `CAST_NONE` 因此是**输出量化点**，`05` 篇 §3 的误差链终点在这里。

`CastInputToFp32` 的唯一调用者是 `LoadPrefetchedState`（`:400`）；
`CastFp32ToOutput` 的唯一调用者是 `Compute` 的 `:467` 与 `:470`（`02b`）。

## 5. `CopyInQKV`（`:335-380`）

一次装入本 head 的 `q/k/v`（以及向量版 `gk`），全部 `seqLen` 个 token。签名：

```cpp
  __aicore__ inline void CopyInQKV(uint64_t vOffset, uint64_t qkOffset, int32_t seqLen) {
```

`vOffset`/`qkOffset` 由 `ProcessHead` 的 `:588-589` 算出（`02b`），
其中 `qkOffset = (seq0*NK_ + head_i/(NV_/NK_)) * realK_` —— GQA 的 head 映射，
`NV_/NK_` 是每组 KV head 服务的 Q head 数。

`gk` 向量版（`:345-361`）的顺序值得注意——**它在 `q/k/v` 之前装载**：

```cpp
      LocalTensor<float> gamaKLocal = gamaKInQueue_.AllocTensor<float>();
      Duplicate<float>(gamaKLocal, 0, alignK_ * seqLen);
      TEventID evevtIdVtoMte2 = GetTPipePtr()->FetchEventID(HardEvent::V_MTE2);
      SetFlag<HardEvent::V_MTE2>(evevtIdVtoMte2);
      WaitFlag<HardEvent::V_MTE2>(evevtIdVtoMte2);
      DataCopyPadCustom(gamaKLocal, gamaKGm_[vOffset / realV_ * realK_], gkInParams, gkPadParams);
      gamaKInQueue_.EnQue<float>(gamaKLocal);
      gamaKInUb = gamaKInQueue_.DeQue<float>();
      Exp(gamaKInUb, gamaKInUb, alignK_ * seqLen);
```

（`:351-359` 照抄。）`Duplicate` 先把整块填 0（`:352`），再 `DataCopyPadCustom` 覆盖有效区。
**为什么先 Duplicate**：`gkInParams` 的 `srcStride` 派生出的 `stride` 字段（`:347` 的
`alignKGamma < alignK_ ? 1 : 0`）在某些组合下会导致尾部不被 DMA 覆盖，填 0 保证尾部
`exp(0)=1`（`:359` 的 `Exp` 之后）即"不衰减"。这是**用 0 作中性元**的又一例（对比 `02` 篇 §7 的 `beta_=0`）

`vOffset / realV_ * realK_`（`:356`）：把 v 空间的偏移换算回 k 空间。
`vOffset = (seq0*NV_ + head_i)*realV_`（`:588`），除回 `realV_` 得到扁平的 `(seq0, head)` 索引，
再乘 `realK_` 得到 gk 的元素偏移。但 `gk` 的 head 数应该是 `NV_`（gk 与 v 同 head 数），
`gkInParams` 的 srcStride 用的也是 `(NV_-1)*realK_*sizeof(float)`（`:349`）——**一致**。

`q/k/v` 的 DMA 三连（`:362-364`）后立刻 `EnQue`+`DeQue`（`:365-370`）：
队列深度 1，`EnQue` 后 `DeQue` 必然立即成功（无跨核流水收益），
纯粹是为了让 AscendC 的 tensor 生命周期管理（`FreeTensor` 要求先 `DeQue`）说得通。
`Cast` 三行（`:371-373`）把 half 提升到 FP32，长度 `alignK_*seqLen`/`alignV_*seqLen`——
**这里读的是 UB 里对齐后的区域**，所以尾部垃圾会被 `Cast` 进 `qInUb`/`kInUb`，
再由 `:375` 的 `Muls(qInUb, qInUb, scale_, seqLen*alignK_)` 乘上 scale。
`seqLen * alignK_`（无括号、无 `Ceil`）与 `:371` 的 `alignK_ * seqLen` 同值，仅顺序不同。

`:376` 的 `SetWaitFlag<HardEvent::V_MTE2>(HardEvent::V_MTE2)` 出现在 `Muls` 之后、
`FreeTensor` 之前——它要确保 Vector 对 `qInUb` 的写与 MTE2 对 `qLocal` 的读不冲突？
实际方向是 `qLocal`(MTE2 写入) → `Cast`/`Muls`(V 读)，所以该事件是 **V→MTE2 的 WAR**：
在 `FreeTensor(qLocal)` 之前，确保 Vector 已经读完。这是本文件里 WAR 纪律的最小样例，
`02b` 篇 §3 的 `:480`、`:491` 用的是同一族事件的反方向（`MTE3_V`）。

`scale_` 只在 `:375` 用一次（乘 q），所以 `02` 篇 §8.1 里 `scale_` 的地位与 `T_` 类似——
它服务于"数学正确"而非"寻址"。host 侧 `scale` 来自 attr（`01b` 篇 §7.1）。

## 6. `PrefetchState` / `LoadPrefetchedState`（`:381-403`）

```cpp
  __aicore__ inline void PrefetchState(uint64_t stateOffest, uint32_t curSingleV) {
    LocalTensor<inType> stateLocal = stateInQueue_.AllocTensor<inType>();
    if (likely(realK_ == alignK_)) {
      uint32_t blockLen = curSingleV * alignK_ / FP16_NUM_PER_BLOCK;
      DataCopyParams stateInParams{1, static_cast<uint16_t>(blockLen), 0, 0};
      DataCopy(stateLocal, initStateGm_[stateOffest], stateInParams);
    } else {
      DataCopyExtParams stateInParams{static_cast<uint16_t>(curSingleV), static_cast<uint32_t>(realK_ * sizeof(inType)),
                                      0, 0, 0};
      DataCopyPadExtParams<inType> padParams{true, 0, static_cast<uint8_t>(alignK_ - realK_), 0};
      DataCopyPadCustom(stateLocal, initStateGm_[stateOffest], stateInParams, padParams);
    }
    stateInQueue_.EnQue<inType>(stateLocal);
  }
```

快路径 `realK_ == alignK_`（`:384`，`likely` 标注）时 `blockLen = curSingleV*alignK_/16` 个 block，
`blockCount=1`——**一维连续搬**。

慢路径用 `blockCount = curSingleV`、`blockLen = realK_*2` 字节、
`srcStride=0`，即"每行一个 block，行间紧挨"，配合 `padParams` 的
`rightPadding = alignK_ - realK_` 做右填充。注意 `DataCopyPadCustom` 的 `srcStride==0` 会走
`:50` 的快路径（`alignElem==elem` 未必成立！`realK_` 非 16 倍数时 `alignElem != elem`），
所以慢路径调用它其实是走 `:53-58` 的 `else` 分支逐项搬——**函数名里的 "Pad" 名不副实**，
它并不做填充，`padParams` 从未被使用（`02` 篇 §5.1 第 1 点）。


**结果：`dk` 非 16 倍数时，`stateInUb` 的列尾是 `AllocTensor` 返回区域里的历史残留，不是 0。**
`DotFp32`（`:405`）在 `alignK_` 长度上做 `Mul`，会把这些残留乘进 `kInUb` 的对应位置。
`kInUb` 的尾部呢？`:372` 的 `Cast` 长度是 `alignK_*seqLen`，`kLocal` 尾部同样未定义。
**两者相乘 → `attnInUb`/`stateInUb` 被污染。**
这是 `dk` 非 16 倍数场景下唯一的正确性缺口，且**测试覆盖不到**


`LoadPrefetchedState`（`:397-403`）：

```cpp
    uint32_t alignedV = Ceil(curSingleV, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;
    LocalTensor<inType> stateLocal = stateInQueue_.DeQue<inType>();
    CastInputToFp32(stateInUb, stateLocal, alignK_ * alignedV);
    SetWaitFlag<HardEvent::V_MTE2>(HardEvent::V_MTE2);
    stateInQueue_.FreeTensor(stateLocal);
```

`alignedV` 是 **v 方向的 16 上取整**（`:398`）——因为 `stateInUb` 是按 `alignK_ × vStep` 排的，
v 方向长度必须是 16 的倍数才能用 `Mul` 整块搬。`curSingleV`（尾片可能非 16 倍数）被抬到 `alignedV`
后 `Cast` 长度是 `alignK_*alignedV`，**多出的 `alignedV-curSingleV` 列被 `Cast` 成 UB 残值的 FP32**，
`Compute` 的 `:438`/`:442`（`Muls` 长度 `alignK_*alignedV`）会带上它们，
但 `:452`、`:460` 的循环只跑 `curSingleV` 次，所以**污染不会流向输出**。
`05` 篇 §5 会给出"哪些多算的量被吸收、哪些没有"的完整清单。

`stateInUb` 是**唯一的状态工作副本**：`LoadPrefetchedState` 写它、`Compute` 原地改它
（`:438`、`:442`、`:445`、`:457`）、`CastFp32ToOutput`（`:470`）读它。
这就是"双缓冲只能靠时序、不能靠两套 UB"的根源——`stateInUb` 只有一份。

## 7. `DotFp32`（`:405-424`）：本 kernel 的算力心脏

```cpp
  __aicore__ inline float DotFp32(LocalTensor<float> lhsTensor, LocalTensor<float> rhsTensor) {
    Mul(broadTmpInUb, lhsTensor, rhsTensor, alignK_);
    constexpr uint32_t kReduceDstStride = FP32_NUM_PER_BLOCK;
    uint32_t fullRepeats = alignK_ / REPEAT_LENGTH;
    uint32_t tail = alignK_ % REPEAT_LENGTH;
    if (fullRepeats > 0) {
      WholeReduceSum(broadTmpInUb, broadTmpInUb, REPEAT_LENGTH, fullRepeats, kReduceDstStride, 1,
                     REPEAT_LENGTH / FP32_NUM_PER_BLOCK);
    }
    WaitVectorToScalar();
    float result = 0.0f;
    for (uint32_t i = 0; i < fullRepeats; ++i) {
      result += broadTmpInUb.GetValue(i * kReduceDstStride);
    }
    uint32_t tailOffset = fullRepeats * REPEAT_LENGTH;
    for (uint32_t i = 0; i < tail; ++i) {
      result += broadTmpInUb.GetValue(tailOffset + i);
    }
    return result;
  }
```

（`:405-424` 全录，20 行。）逐段：

1. `Mul` 用 `lhsTensor`（**带 `v*alignK_` 偏移的** `stateInUb` 切片）与 `rhsTensor`
   （`kInUb[curQKOffset]`），长度 `alignK_`。调用点是 `:453` 与 `:461`（`02b`）。
   `broadTmpInUb` 被覆写，所以 `Compute` 里 `:455` 的 `Muls(broadTmpInUb, ...)` 必须在
   `:453` 的 `DotFp32` **之后**——源码顺序即依赖顺序，`PipeBarrier<PIPE_V>()`（`:456`）保证。
2. `WholeReduceSum(dst, src, REPEAT_LENGTH=64, fullRepeats, dstStride=8, 1, 64/8=8)`。
   语义：每 64 个 FP32 归约成一个标量，写到 `dst + i*8` 个元素处（stride 以元素计）。
   `kReduceDstStride = FP32_NUM_PER_BLOCK = 8`：**每个归约结果占 8 个 float 的槽位（32 字节）**，
   所以标量读时是 `GetValue(i * 8)`（`:417`）——**归约结果按 block 对齐散布**，不是紧凑数组。
3. `fullRepeats = alignK_/64`，`tail = alignK_%64`（`:408-409`）。
   `dk=128` 时 `fullRepeats=2, tail=0`，标量侧只加 2 次。
   `dk=96` 时 `alignK_=96`（96 是 16 的倍数），`fullRepeats=1, tail=32` → 1 次归约 + 32 次标量加。
   `dk=8` 时 `alignK_=16`，`fullRepeats=0, tail=16` → **完全跳过 `WholeReduceSum`，
   16 次标量加**（`:410` 的 `if` 就是这个护栏）。
   这条分支差异解释了 `01b` 篇 §3 提到的"小 `dk` 性能塌方"直觉：标量加无法流水。
4. `WaitVectorToScalar()`（`:414`）在归约与标量读之间——`02` 篇 §12 的必要同步。
5. 两次累加都用 `float result = 0.0f` 的**标量顺序加**，与 Vector 树的加顺序不同，
   所以与 PyTorch reference 的差异里含**求和顺序项**。这条进 `05` 篇 §4 的误差分解。

`DotFp32` 每次调用产生 1 次 `Mul` + 至多 1 次 `WholeReduceSum` + `fullRepeats + tail` 次
标量读加，而它在 `Compute` 的内层循环里被调 `curSingleV × 2` 次（`:453`、`:461`）——
**每个 token 每个 v 分片做 `2×curSingleV` 次小点积**。这是"很多小点积"结论的量化依据。
