# 02 · kernel 逐段精读（上）：入口、参数装载、递推主干

> 行域：`src/96ea3f55/op_kernel/recurrent_gated_delta_rule.h:1-310`（`wc -l` 全文件 675 行，
> `:311-434` 归 `02a` 篇、`:435-675` 归 `02b` 篇；台账行
> `op_kernel/recurrent_gated_delta_rule.h 1 310 02 primary`）。
> 所有行号锚点属 commit `96ea3f55` 快照；交叉引用的 `op_host/` 行号属同快照。

## 1. 结论先行

1. **kernel 侧只有一个 675 行的头文件 + 一个 40 行的入口 `.cpp`，没有 `.cc`/无 auto-fusion 生成码。**
   全部算术语义手写在 `RGDR<inType, outType>` 里，模板只在入口被实例化一次
   （`recurrent_gated_delta_rule.cpp:36` 的 `RGDR<half, half>`），因此 `inType == outType == half`
   是唯一运行期事实，FP32 只存在于 UB 里的 `LocalTensor<float>`。
2. **递推是标量-向量混合的，不是矩阵乘。** `Compute`（`:435`，属 `02b`）对每个 v 通道调一次
   `DotFp32`（`:405-424`，全录见 `02a` 篇 §7），后者用 `Mul` + `WholeReduceSum` + **标量循环相加**收尾；
   这条链决定了 kernel 的算力形态是"很多小点积"，与 CGDR 的分块矩阵乘完全不同（`05` 篇展开）。
3. **`Process`（`:260-309`）是三层循环的最外层，且它自己不做任何数据搬运**——
   它只做四件事：解 `cu_seqlens`、守卫 `seqLen`、按 `(batch, head)` 线性 id 取模分片、
   在分片的第一个 head 上装载 `gama/beta` 与 `stateOffset`。
4. **`state` 的读写槽位不同源**：读槽由 `GetSsmStateIndex(stateTokenIdx)` 得到（`:303`，
   受 `num_accepted_tokens` 回退影响），写槽由 `GetSsmStateIndex(seq_i)` 逐 token 得到（`:570`，属 `02b`）。
   这一不对称是 decode 语义的核心，`03` 篇专述。
5. **UB 布局完全由 host 的 `ubRestBytes` 决定**：`InitLocalBuffers` 只用一次
   `InitBuffer(tmpBuff, restUbSize_)`（`:227`）承接 8~10 个 FP32 `LocalTensor` 的切分（`:228-251`），
   队列则各自单独 `InitBuffer`。host 侧算少一个字节，这里就越界写，编译期无任何检查。

## 2. 文件骨架与本/他篇分界

`:1-19` 是 Apache-2.0 版权声明（`Copyright 2026 Huawei Technologies Co., Ltd`），
`:21-22` 两个 include：

```cpp
#include "kernel_operator.h"                         // NOLINT(build/include_subdir)
#include "recurrent_gated_delta_rule_tiling_data.h"  // NOLINT(build/include_subdir)
```

两条 `NOLINT(build/include_subdir)` 注释说明本仓库跑 cpplint，且这两个头**不按 `path/file.h` 的
子目录形式书写**——它们与 `.h` 同目录（`op_kernel/`），构建系统靠 include path 解析。
`tiling_data.h` 的 49 行逐字段解读在 `01` 篇 §4；本篇只用到它作为 `ctor` 的入参类型。

`:23` 是 `using namespace AscendC;  // NOLINT(build/namespaces)`。头文件里 `using namespace`
是 cpplint 明确反对的写法，这里用 NOLINT 压制——副作用是本文件内所有 AscendC 符号
（`LocalTensor`、`GlobalTensor`、`TQue`、`DataCopy`、`Ceil`、`CeilAlign`、`Std::min`）
都无需限定，读代码时不能靠命名空间区分"AscendC 提供"与"本文件自定义"。
`Std::min`（`:329`、`:429`）带限定名，正因为 `using namespace` 之后裸 `min` 会歧义。

三篇的切点选在源码的两个天然缝上：`:311` 的 ` private:` 与 `:435` 的 `Compute` 签名行。

| 篇 | 行域 | 内容 |
| --- | --- | --- |
| `02`（本篇） | `:1-310` | 常量、3 个 `DataCopy` 包装、`RGDRInitParams`、ctor、`Init`、`SetGlobalTensors`、`InitLocalBuffers`、`WaitVectorToScalar`、`Process` |
| `02a` | `:311-434` | 2 个 dtype 适配器、2 个 `Cast` 包装、`CopyInQKV`、`PrefetchState`/`LoadPrefetchedState`、`DotFp32` |
| `02b` | `:435-675` | `Compute`、`CopyOutAttn`/`CopyOutState`、`CopyInGamaBeta`、2 个 `Queue*Output`、`ProcessSequenceChunk`、`ProcessHead`、成员清单 |

即"骨架与调度"归 `02`、"上游装载工具"归 `02a`、"下游计算与回收"归 `02b`，
`Process` 是三者唯一入口。拆成三篇只因单篇 700 行上限（任务 §9.4），
**内容未增未减，只搬移并重编号**。

## 3. 编译期常量（`:24-32`）

```cpp
constexpr uint64_t BUFFER_NUM = 1;
constexpr uint32_t MAX_OUT_BUFFER_NUM = 2;
constexpr uint64_t MAX_MTP = 8;
constexpr uint64_t FP16_NUM_PER_BLOCK = 16;
constexpr uint64_t FP32_NUM_PER_BLOCK = 8;
constexpr uint32_t REPEAT_LENGTH = 64;
constexpr uint32_t MAX_REPEAT_TIME = 255;
constexpr uint32_t MAX_CAST_ELEMENTS = REPEAT_LENGTH * MAX_REPEAT_TIME;
constexpr int64_t BLOCK_BYTES = 32;
```

九个常量的**实际消费点**（全文件 grep 实测）：

| 常量 |  用途 |
|---|---|
| `BUFFER_NUM` | 输入队列深度恒为 1；输出队列与 2 比较后二选一 |
| `MAX_OUT_BUFFER_NUM` |输出队列模板上限 = 2，即 host 最多能让 `TQue` 有 2 槽 |
| `MAX_MTP` | 投机解码的最大草稿 token 数，同时是 UB 尺寸的乘数 |
| `FP16_NUM_PER_BLOCK` |  16 个 half = 32 字节，host/kernel 共用的对齐单位 |
| `FP32_NUM_PER_BLOCK` |  8 个 float = 32 字节 |
| `REPEAT_LENGTH` |  `WholeReduceSum` 的每次归约长度 |
| `MAX_REPEAT_TIME` | 与上一条相乘得到单次 `Cast` 的上限 |
| `MAX_CAST_ELEMENTS` |  `Cast` 的分片粒度 = 16320 元素 |
| `BLOCK_BYTES` |  32 字节 DMA block |

`MAX_CAST_ELEMENTS = 64 × 255 = 16320`（`:31`）。这个数不是随意挑的：AscendC 的 `Cast` 在
310P 上单条指令的 repeat 上限是 255，`REPEAT_LENGTH=64` 是 FP32 侧每 repeat 的元素数，
两者相乘给出**一次 `Cast` 能安全处理的最大元素数**，所以 `CastInputToFp32`/`CastFp32ToOutput`
都要按它切循环（`:328`、`:428`）。

注意 `MAX_MTP` 同时出现在 host 侧（`op_host/recurrent_gated_delta_rule_tiling.cpp` 的
`CalcWorkingUbBytes` 用到 `MAX_MTP`，见 `01b` 篇 §5.3），**同名同值但两份独立定义**——
kernel.h `:26` 与 tiling 侧各有一份 `constexpr`。这是"host/kernel 双算"的第 2 处
（第 1 处是 `workBlockDim_`，见本篇 §8.3），改一处不改另一处会让 UB 预算与实测错位。

## 4. `SetWaitFlag<event>`：自造的"发完立刻等"原语（`:33-39`）

```cpp
template <HardEvent event>
__aicore__ inline void SetWaitFlag(HardEvent evt) {
  event_t eventId = static_cast<event_t>(GetTPipePtr()->FetchEventID(evt));
  SetFlag<event>(eventId);
  WaitFlag<event>(eventId);
}
```

它实现的是"隔离点"而非"流水事件"：真正的生产者/消费者流水不会 SetFlag 之后立刻 WaitFlag，
那等价于一次同步屏障。作者的取舍很清楚：**这是手写流水的调试护栏**，
宁可牺牲重叠也要保证不出现数据竞争。这与 `04` 篇讨论的"为什么双缓冲没有铺开"是同一动机的两面。

`GetTPipePtr()` 是全局 pipe 指针（不依赖 `pipe_` 成员），所以 `:34-39` 这个自由函数
在 `RGDR` 类外也能用——`:91` 等调用点确实都在类外的 `DataCopyCustom` 里。

## 5. 三个 DataCopy 包装（`:40-136`）

`kernel_operator.h` 提供的 `DataCopy` 要求 GM 地址 32 字节对齐、block 长度是 32 字节的整数倍，
而 RGDR 的输入形状里 `dk`/`dv` 是任意值（`01` 篇 §2 的 def 侧允许 `dv` 非 16 倍数）。
所以本文件写了三个包装，分工是：

- `DataCopyPadCustom`（`:41-59`）：**GM→UB 读入**，处理"行间有 stride"的 gather；
- `DataCopyCustom(DST, SRC, params)`（`:61-67`）：**UB→GM 写出**的最简形式，只做 block 上取整；
- `DataCopyCustom<T, needBack, isAtomic>`（`:69-136`）：**UB→GM 写出**的完整版，处理尾部非对齐。

### 5.1 `DataCopyPadCustom`（`:40-59`）

```cpp
template <typename T>
__aicore__ inline void DataCopyPadCustom(LocalTensor<T> inLocal, GlobalTensor<T> srcGm,
                                         DataCopyExtParams tokenCopyParams, DataCopyPadExtParams<T> padParams) {
  int64_t elem = tokenCopyParams.blockLen / sizeof(T);
  int64_t numPerBlock = BLOCK_BYTES / sizeof(T);
  int64_t alignElem = AlignUp(elem, numPerBlock);
  int64_t srcStrideElem = tokenCopyParams.srcStride / sizeof(T);
  int64_t gmStepPerRow = elem + srcStrideElem;

  if (likely(alignElem == elem && srcStrideElem == 0)) {
    DataCopyParams copyParams = {tokenCopyParams.blockCount, static_cast<uint16_t>(alignElem / numPerBlock), 0, 0};
    DataCopy(inLocal, srcGm, copyParams);
  } else {
    DataCopyParams copyParams = {1, static_cast<uint16_t>(alignElem / numPerBlock), 0, 0};
    for (uint32_t i = 0; i < tokenCopyParams.blockCount; i++) {
      DataCopy(inLocal[i * alignElem], srcGm[i * gmStepPerRow], copyParams);
    }
  }
}
```

三点值得记：

1. `padParams`（第 3 个入参）**在函数体里一次都没用**。`DataCopyPad` 需要它做零填/边界填充，
   这里改走 `DataCopy` + 手动上取整，所以 `:42-43` 的形参是纯遗留。三个调用点
   （`:356`、`:362-364`、`:392`）照样构造并传入 `DataCopyPadExtParams`——白给的成本。
2. 快路径的条件是 `alignElem == elem && srcStrideElem == 0`（`:50`），用 `likely` 标注。
   对 `q/k/v` 来说 `realK_ == alignK_` 时（`dk` 是 16 的倍数）才走快路径；
   而 `srcStrideElem != 0` 恰恰是**多 head gather 的常态**（`:340` 的 `(NK_-1)*realK_*sizeof(inType)`），
   所以 `CopyInQKV` 在有多个 KV head 时**必走慢路径**——慢路径是 `blockCount` 次逐项 `DataCopy`，
   每次一个 block 数组，`blockCount` 上限是 `seqLen ≤ 8`（`:339`），所以循环最多 8 轮。可接受。
3. `gmStepPerRow = elem + srcStrideElem`（`:47`）而不是 `srcStrideElem`。这说明这里的
   `DataCopyExtParams::srcStride` 语义是"行间**额外**跳过的字节数"，与 AscendC 文档里
   `srcStride` = 相邻 block 起始的地址差（含本块长度）的口径**不一致**。
   调用点 `:340` 传的正是 `(NK_ - 1) * realK_ * sizeof(inType)`——`NK_-1` 而不是 `NK_`，
   与 `elem + srcStride` 的读法自洽。这是本文件里 host 契约与 AscendC 契约的一次**自行调和**，
   阅读 AscendC 文档时不要照抄口径。

### 5.2 `DataCopyCustom(DST, SRC, params)`（`:60-67`）

```cpp
template <typename DST, typename SRC>
__aicore__ inline void DataCopyCustom(DST dst, SRC src, DataCopyParams copyParams) {
  int64_t alignBytes = AlignUp(static_cast<int64_t>(copyParams.blockLen), BLOCK_BYTES);
  int64_t blocks = alignBytes / BLOCK_BYTES;
  DataCopyParams aligned = {copyParams.blockCount, static_cast<uint16_t>(blocks), 0, 0};
  DataCopy(dst, src, aligned);
}
```

`DST`/`SRC` 是**张量类型而非元素类型**（形如 `GlobalTensor<T>`/`LocalTensor<T>`），
所以这个模板不做任何转换，只为让调用点既能 `GM←UB` 也能 `UB←GM`。
消费点：`:477`（attn 输出）、`:488`（state 输出）、`:500`（beta 读入）、`:508`（gama 读入）、
`:515`（标量 gamaK 读入）。它只把 `blockLen` 抬到 32 的倍数，**不处理 `srcStride`**——
所以调用方传的 `srcStride` 必须为 0（`CopyOutAttn:476`、`CopyOutState:487`、`CopyInGamaBeta:499/507/514`
构造的 `DataCopyParams` 四个字段里后两位都是 0，一致）。

多拷的部分：`alignBytes` 可能比真实字节数多出至 31 字节，也就是**最多 15 个 half**。
读方向（`:500` beta）这会在 UB 尾部写入垃圾，但 `betaInUb` 的读取长度由
`bBatchSize = Ceil(seqLen*NV_, 16)*16` 界定，垃圾落在有效区之外；
写方向（`:477`、`:488`）会向 GM 多写至 31 字节，**这是本篇无法从代码内自证安全的地方**：
`attnOutGm_[attnOffset]` 的尾部多写会踩到下一个元素。裁决见 §5.5。

### 5.3 `DataCopyCustom<T, needBack, isAtomic>`（`:68-136`）

完整版签名：

```cpp
template <typename T, bool needBack = false, bool isAtomic = false>
__aicore__ inline void DataCopyCustom(GlobalTensor<T> dstGm, LocalTensor<T> inLocal, DataCopyExtParams copyParamsIn) {
```

默认两个 flag 都是 `false`。`alignElem == elem` 的整齐路径（`:77-80`）与 §5.2 等价。
不整齐时分三种：

- **单块 + `needBack`**（`:81-112`）：把尾部那不足 32 字节的数据**回读—翻转—覆写**。
  `:82-96` 是"已有整块可写"的情形（`elemAlignDown != 0`）：先正常写整块，
  再用标量 `SetValue` 把尾部 `numPerBlock` 个元素**倒序**搬到 `inLocal` 的高地址端（`:92-94`），
  然后单 block 写到 `dstGm[elem - numPerBlock]`（`:96`）。
  `:97-112` 是"连一个整块都没有"的情形：先在栈上 `T tmp[BLOCK_BYTES / sizeof(T)]`（`:97`）
  暂存原值，反向 `DataCopy` 把 GM 那一块读进 `inLocal`（`:106`），标量填回（`:109-111`），
  再写出（`:114`）。这是**读改写**，因此必须先 `SetWaitFlag<MTE3_MTE2>` 保证上一次 MTE3 写完
  （`:104-105` 两行）。
- **单块 + `isAtomic`**（`:113-122`）：把 `alignElem - elem` 个尾部元素标量置 `T(0)`（`:116-118`），
  再按对齐长度整体写出（`:120-121`）。零填的前提是**目标缓冲区尾部有至少 `alignElem-elem` 个元素的可写空间**，
  且写 0 无害——这与 §5.2 末尾的"多写 31 字节"是同一个隐患的两种解法：
  `isAtomic` 明确填 0，默认模板什么都不填。
- **多块**（`:124-134`）：逐块 `DataCopy(dstGm[i*elem], inLocal[i*alignElem], ...)`，
  **块间插 `PipeBarrier<PIPE_MTE3>()`（`:133`）**。注意 `dstGm` 用 `elem`（非对齐）步进、
  `inLocal` 用 `alignElem` 步进——这是"UB 里按对齐排布、GM 里按紧凑排布"的正确写法，
  也是整个函数存在的理由。每块之间都插 barrier 说明作者放弃了 MTE3 队列内的重叠，
  换取"下一块不会覆写上一块源数据"的确定序。

`needBack` 一支里的 `:103`：

```cpp
          SetWaitFlag<HardEvent::MTE3_MTE2>(HardEvent::S_MTE2);
          SetWaitFlag<HardEvent::MTE3_MTE2>(HardEvent::MTE3_MTE2);
```
## 6. `RGDRInitParams`（`:137-151`）

```cpp
struct RGDRInitParams {
  GM_ADDR query;
  GM_ADDR key;
  GM_ADDR value;
  GM_ADDR gama;
  GM_ADDR gamaK;
  GM_ADDR beta;
  GM_ADDR initState;
  GM_ADDR cuSeqlens;
  GM_ADDR ssmStateIndices;
  GM_ADDR numAcceptedTokens;
  GM_ADDR attnOut;
  GM_ADDR finalState;
};
```

12 个 `GM_ADDR`，**没有 workspace、没有 tilingData**（后者经构造参数单独传入，见 §8）。
入口 `.cpp` 用**位置聚合初始化**填它：

```cpp
  RGDRInitParams initParams{query, key,     value, g, gk, beta, state, cuSeqlens, ssmStateIndices, numAcceptedTokens,
                            out,   stateOut};
```

两处名字不对齐，必须记住：

| 入口形参 | 结构体字段 | 语义 |
|---|---|---|
| `g` | `gama` | 标量衰减的 log 域输入（`exp` 在 `:510` 做） |
| `gk` | `gamaK` | 逐维衰减，per-head 标量或 per-dim 向量（`gamaKScalar_` 区分） |
| `state` | `initState` | 状态池（读源） |
| `out` | `attnOut` | 注意力输出 |
| `stateOut` | `finalState` | 状态池（写目标） |


## 7. 类头与初值列表（`:153-157`）

```cpp
template <typename inType, typename outType>
class RGDR {
 public:
  __aicore__ inline explicit RGDR(const RecurrentGatedDeltaRuleTilingData *tilingData)
      : pipe_(nullptr), gama_(1.0f), gamaK_(1.0f), beta_(0.0f), blockIdx(0) {
```

`explicit` + 裸指针入参（不是引用）：入口 `:36` 传的是 `&tilingData`，
即 `GET_TILING_DATA` 宏在栈上放的结构体副本的地址。`__aicore__` 下没有真正的动态栈，
该地址指向 GM→UB 搬运后的镜像区，`ctor` 里读完全部字段（`:158-175`）后就不再持有指针——
这点很关键：**`tilingData` 指针没有被存成成员**，`02b` 的 `:613-673` 成员清单里找不到它。

初值列表给出三个中性元：`gama_ = 1.0f`、`gamaK_ = 1.0f`（无衰减时的乘单位），
`beta_ = 0.0f`（无更新量）。`:157` 的 `beta_(0.0f)` 与另两个不同符号：如果 `CopyInGamaBeta`
因 `seqLen<=0` 之外的路径被跳过，`beta_=0` 会让 `delta=0`（`:454`）从而**静默恒等**，
而 `gama_=1` 是"什么都不衰减"。选 0 还是 1 是"退化成什么"的策略选择，这里是"退化成不更新"。
`pipe_(nullptr)`：`pipe_` 只在 `Init` 的 `:190` 被赋值，`ctor` 期不能用（见 §9）。

## 8. 构造函数体（`:158-183`）

### 8.1 形状字段（`:158-164`）

```cpp
    B_ = tilingData->b;
    T_ = tilingData->t;
    NK_ = tilingData->nk;
    realK_ = tilingData->dk;
    NV_ = tilingData->nv;
    realV_ = tilingData->dv;
    scale_ = tilingData->scale;
```

命名规律：`real*` 是逻辑长度，`align*` 是 UB 排布长度（`:181-182`），大写单字母（`B_ T_ NK_ NV_`）
是批次/头数。`realK_`/`realV_` 与 `alignK_`/`alignV_` 成对出现，是所有 stride 计算的根：
`realK_` 用于 GM 步进（`:488`、`:570`、`:589`），`alignK_` 用于 UB 步进与向量长度（`:406`、`:445`、`:457`）。

`T_`（总 token 数）在本文件里**只出现在 `:284` 的边界守卫**，不参与任何地址计算；
`NK_`（KV head 数）出现在 `:340` 的 srcStride 与 `:589` 的 head 映射。
`B_` 出现在 `:176`、`:262`。这三个字段的"低使用率"说明它们主要是为**校验与分片**服务，
不是寻址主力——寻址主力是 `realK_`/`realV_`/`NV_`。

### 8.2 7 个 bool 开关（`:165-171`）

`hasAcceptedTokens_`、`hasGama_`、`hasGamaK_`、`gamaKScalar_`、`cuSeqlensIsPrefix_`、
`cuSeqlensIsInt64_`、`ssmStateIndicesIsInt64_`，全部形如 `(tilingData->X == 1)`。
`== 1` 而非 `!= 0`：host 侧写的是 0/1（`01b` 篇 §7），所以两者等价，但 `== 1` 让
"host 万一写了 2"变成 `false` 而不是 `true`——**保守方向一致**，与 `01b` 篇 §4.3 的判空方向同源。

`cuSeqlensIsPrefix_`（`:169`）在终态 host 侧被硬编码写 0（`op_host/..._tiling.cpp:287`，
`01b` 篇 §7.2），因此 `Process` 的 `:266-269` 前缀分支是**死码**。
它没有被删，说明 `:270-277` 的 O(B²) 累加是作者愿意付的代价来换取 attr 开关的灵活性。
`03` 篇 §3 沿这条线展开两种 `cu_seqlens` 语义。

### 8.3 队列深度与 `workBlockDim_`（`:172-180`）

```cpp
    vStep_ = tilingData->vStep;
    stateOutBufferNum_ = (tilingData->stateOutBufferNum == MAX_OUT_BUFFER_NUM) ? MAX_OUT_BUFFER_NUM : BUFFER_NUM;
    attnOutBufferNum_ = (tilingData->attnOutBufferNum == MAX_OUT_BUFFER_NUM) ? MAX_OUT_BUFFER_NUM : BUFFER_NUM;
    restUbSize_ = tilingData->ubRestBytes;
    uint64_t taskUnits = static_cast<uint64_t>(B_) * static_cast<uint64_t>(NV_);
    workBlockDim_ = taskUnits < tilingData->vectorCoreNum ? taskUnits : tilingData->vectorCoreNum;
    if (workBlockDim_ == 0) {
      workBlockDim_ = 1;
    }
```

`:173-174` 是**再钳制**：host 给的 `stateOutBufferNum` 只能是 1 或 2（候选表 `{1,1},{1,2},{2,2}`，
`01b` 篇 §5.1），kernel 仍把它压回二值。这层钳制让"host 写了 3"最多退化成 1 槽，
而 `TQue<..., MAX_OUT_BUFFER_NUM>`（`:635-636`）的模板上限是 2，
所以若 host 真写 3 而此处不钳制，`InitBuffer` 会请求 3 个模板只允许 2 个的槽——
**`:173-174` 是防这个的，不是装饰**。

`workBlockDim_ = min(B_*NV_, vectorCoreNum)`（`:176-177`，注意 `<` 加 `?:` 相当于 `min`，
平局时取 `vectorCoreNum`）。这**与 host 的 `GetBlockDim` 是同一条公式的第二次求值**
（`op_host/..._tiling.cpp:253-260`，`01b` 篇 §6）。双算的意义：kernel 不必读 `BlockDim`
也能知道分片模数，代价是两侧必须同步。`:178-180` 的 `==0 → 1` 护栏只存在于 kernel 侧——
host 的 `GetBlockDim` 没有这个护栏（`01b` 篇 §6.2 已记），所以 `B_==0` 时
`SetBlockDim(0)` 与 `workBlockDim_=1` 会不一致；但 `B_==0` 时 `Process:262` 的循环直接不进入，
不一致不会显现。

`taskUnits` 的两个 `static_cast<uint64_t>`（`:176`）是必要的：`B_`/`NV_` 是 `uint32_t`，
`B_ * NV_` 在 32 位里算，`B_=65536`、`NV_=4` 这种极端值会溢出。虽然 `uint32` 乘积溢出在真实
decode 场景不可能发生，写成 `uint64_t` 说明作者按 cpplint 的 `integer-overflow` 类检查做过预防。

`:181-182` 用 `Ceil(x, 16) * 16` 手算上取整，而不是 `CeilAlign`——同文件 tiling `:93` 用的是
`CeilAlign`。两种写法在同一 PR 里并存（`01b` 篇 §5.2 已记 kernel/host 的 API 差异），
`CeilAlign` 只在 `host` 侧出现，`op_kernel` 里全用 `Ceil(a,b)*b`。

## 9. `Init`（`:185-193`）：早退的核

```cpp
  __aicore__ inline void Init(const RGDRInitParams &initParams, TPipe *pipe) {
    blockIdx = GetBlockIdx();
    if (blockIdx >= workBlockDim_) {
      return;
    }
    pipe_ = pipe;
    SetGlobalTensors(initParams);
    InitLocalBuffers();
  }
```

`GetBlockIdx()` 在读任何 GM 之前；`blockIdx >= workBlockDim_` 直接 `return`。
含义：host `SetBlockDim` 启的是 `min(B_*NV_, coreNum)` 个核（§8.3），
runtime 仍可能拉起更多（`coreNum` 与实际 launch 数的关系由 runtime 决定），
多出来的核在 `Init` 就退出，`Process` 里 `:261` 用 `workBlockDim_` 取模分片，
退出的核不会执行 `Process`——**但 `Process` 不是被 `Init` 的返回值控制的**：
入口 `:38` 无条件调 `op.Process()`。所以 `blockIdx >= workBlockDim_` 的核确实会进 `Process`，
靠 `:290-293` 的取模判断跳过每一个 head。`Init` 的早退只省了 `InitBuffer`，没有省循环。

这一点容易误读为"多余核不干活"，准确说法是：**多余核不做 UB 分配，但仍会跑完 `B_×NV_` 的空转循环**。
`InitBuffer` 没被调用的核如果误入需要 UB 的路径就会崩，而 `:290-293` 的 `continue` 恰好保证了
`blockIdx` 不在 `[0, workBlockDim_)` 内时**所有** head 都被跳过（取模结果不可能等于越界的 blockIdx，
因为 `blockDim == workBlockDim_`）——`% blockDim` 的值域是 `[0, blockDim)`，
而 `blockIdx >= blockDim`，故条件 `!= blockIdx` 恒真。这是**数学上必然的静默退出**，不依赖任何运行时检查。

## 10. `SetGlobalTensors`（`:194-210`）：14 个绑定点、12 个指针

```cpp
    cuSeqlens32Gm_.SetGlobalBuffer((__gm__ int32_t *)initParams.cuSeqlens);
    cuSeqlens64Gm_.SetGlobalBuffer((__gm__ int64_t *)initParams.cuSeqlens);
    ssmStateIndices32Gm_.SetGlobalBuffer((__gm__ int32_t *)initParams.ssmStateIndices);
    ssmStateIndices64Gm_.SetGlobalBuffer((__gm__ int64_t *)initParams.ssmStateIndices);
```

（`:203-206` 逐字符照抄。）同一个 GM 地址绑到两个不同类型的全局张量上，靠
`cuSeqlensIsInt64_`/`ssmStateIndicesIsInt64_` 在 `GetCuSeqlen`（`:312-317`）与
`GetSsmStateIndex`（`:319-324`）里二选一。这写法零成本（只存指针，不搬数据），
换来的是**没有运行时分支的 dtype 双绑**：读的时候一个 `if` 而已。

其余 10 个绑定点一一对应 §6 的字段：`queryGm_`/`keyGm_`/`valueGm_`（`inType`）、
`gamaGm_`/`gamaKGm_`（**`float`**，`:199-200`，与 def 侧 `g`/`gk` 是 FP32 一致）、
`betaGm_`/`initStateGm_`（`inType`）、`numAcceptedTokensGm_`（**恒 `int32_t`**，`:207`，
无双绑——def 侧 `num_accepted_tokens` 只注册 int32，`01` 篇 §2）、
`finalStateGm_`/`attnOutGm_`（`outType`，`:208-209`）。

`numAcceptedTokensGm_` 用 `GetValue` 单点读（`:298`），从不 `DataCopy`——
一个 batch 一个标量，最多 `B_` 个，走标量通路比走 DMA 便宜。
`cuSeqlens`/`ssmStateIndices` 同理（`GetCuSeqlen`/`GetSsmStateIndex` 都 `GetValue`）。
**本 kernel 的索引类输入全部走标量读，全部输入张量里只有 `q/k/v/beta/gama/gamaK/state` 走 DMA。**

`gamaGm_` 的绑定是**无条件**的（`:199`），即使 `hasGama_==false` 时也执行——
此时 `initParams.gama` 可能是 `nullptr`（def 侧可选输入未提供时，`01` 篇 §2 的判空方向）。
绑一个空指针到 `GlobalTensor` 本身不解引用，只要不 `DataCopy` 就没事；
`:506-512` 的 `if (hasGama_)` 保证了这一点。**这是"绑定宽松、使用严格"的模式**，
在 `hasGamaK_` 上同理（`:200` 无条件绑，`:345`、`:513`、`:527` 严格判）。

## 11. `InitLocalBuffers`（`:211-252`）：UB 的两副面孔

### 11.1 尺寸先导（`:213-216`）

```cpp
    uint32_t cubeSize = alignK_ * vStep_ * sizeof(float);
    uint32_t vSize = MAX_MTP * alignV_ * sizeof(float);
    uint32_t kSize = MAX_MTP * alignK_ * sizeof(float);
    uint32_t betaUbSize = Ceil(MAX_MTP * NV_, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK * sizeof(float);
```

`cubeSize` 是"一个 v 分片的状态矩阵"的 FP32 字节数——名字叫 cube 但它是 2D 切片
（`alignK_ × vStep_`）。`betaUbSize` 里 `MAX_MTP * NV_` 先乘后 `Ceil(·,16)`，
而 `:224` 的队列尺寸是 `MAX_MTP * NV_ * sizeof(inType)`（**不 Ceil**）。
差别的来源：`betaInUb` 是 FP32 且被 `Cast` 写到 `bBatchSize`（`:503`，那里 `Ceil(seqLen*NV_,16)*16`，
用的是**实际 seqLen 而非 MAX_MTP**），所以 `:216` 的 `MAX_MTP` 版本是上界，安全。

### 11.2 队列初始化（`:217-227`）

8 次 `InitBuffer` + 1 次 `tmpBuff`：

| 行 | 队列 | 深度 | 单槽字节 |
|---|---|---|---|
| `:217` | `qInQueue_` | `BUFFER_NUM`=1 | `MAX_MTP*alignK_*sizeof(inType)` |
| `:218` | `kInQueue_` | 1 | 同上 |
| `:219` | `vInQueue_` | 1 | `MAX_MTP*alignV_*sizeof(inType)` |
| `:220` | `stateInQueue_` | 1 | `alignK_*vStep_*sizeof(inType)` |
| `:222` | `gamaKInQueue_` | 1 | `MAX_MTP*alignK_*sizeof(float)`（仅 `hasGamaK_ && !gamaKScalar_`） |
| `:224` | `betaInQueue_` | 1 | `MAX_MTP*NV_*sizeof(inType)` |
| `:225` | `stateOutQueue_` | `stateOutBufferNum_` | `alignK_*vStep_*sizeof(outType)` |
| `:226` | `attnOutQueue_` | `attnOutBufferNum_` | `vStep_*sizeof(outType)` |
| `:227` | `tmpBuff` | — | `restUbSize_`（host 给的余量） |

关键：**所有输入队列深度都是 1**。`TQue<QuePosition::VECIN, 1>`（`:629-634`）的模板第二参数
也是 1，即队列深度的编译期上限就是 1——`InitBuffer(..., BUFFER_NUM, ...)` 传 1 不是选择而是必须。
所以"双缓冲"**不可能在输入队列里**，只能靠 `stateInUb`（`tmpBuff` 里的 FP32 常驻缓冲）
与 `PrefetchState`/`LoadPrefetchedState` 的一前一后交错实现——这是 `04` 篇的全部主题。

`:222` 的 `gamaKInQueue_` 是**条件初始化**，但 `:632` 的成员始终存在（`TQue` 对象本身不占 UB，
只是描述符）。`ReleaseGamaKInput`（`:526-530`）同样带 `if (hasGamaK_ && !gamaKScalar_)` 守卫，
两处条件必须一致——它们在 `02b` 的 `ProcessHead` 里分别于 `:592`、`:610` 被调。

`:225-226` 用 `stateOutBufferNum_`/`attnOutBufferNum_` 而非字面 2，这正是 `01b` 篇 §5.1
候选表搜索的落地点：host 从 `{1,1},{1,2},{2,2}`（实际只可能取到前两个，见 `01b` §5.1 推导）
里挑一个传下来。**注意 `stateOutQueue_` 的模板上限是 `MAX_OUT_BUFFER_NUM`（`:636`），
`InitBuffer` 的第二参超过它会非法**——§8.3 的钳制因此不可省。

### 11.3 `tmpBuff` 的 9~10 段切分（`:228-251`）

```cpp
    uint32_t buffOffset = 0;
    attnInUb = tmpBuff.GetWithOffset<float>(static_cast<uint32_t>(vStep_), buffOffset);
    buffOffset += vStep_ * sizeof(float);
    vInUb = tmpBuff.GetWithOffset<float>(static_cast<uint32_t>(MAX_MTP * alignV_), buffOffset);
    buffOffset += vSize;
```

（`:228-231` 照抄，其余同构。）顺序与大小：

| 行 | 张量 | 元素数 | 步进字节 | 条件 |
|---|---|---|---|---|
| `:229-230` | `attnInUb` | `vStep_` | `vStep_*4` | 恒 |
| `:231-232` | `vInUb` | `MAX_MTP*alignV_` | `vSize` | 恒 |
| `:233-234` | `qInUb` | `MAX_MTP*alignK_` | `kSize` | 恒 |
| `:235-236` | `kInUb` | `MAX_MTP*alignK_` | `kSize` | 恒 |
| `:237-238` | `stateInUb` | `alignK_*vStep_` | `cubeSize` | 恒 |
| `:239-240` | `broadTmpInUb` | `alignK_*vStep_` | `cubeSize` | 恒 |
| `:241-242` | `betaInUb` | `betaUbSize` | `betaUbSize` | 恒 |
| `:245-246` | `gamaInUb` | `MAX_MTP*NV_` | `MAX_MTP*NV_*4` | `hasGama_` |
| `:250` | `gamaKScalarInUb` | `gamaKScalarSize` | —（不推进） | `hasGamaK_ && gamaKScalar_` |

## 12. `WaitVectorToScalar`（`:254-258`）

```cpp
  __aicore__ inline void WaitVectorToScalar() {
    TEventID eventId = pipe_->FetchEventID(HardEvent::V_S);
    SetFlag<HardEvent::V_S>(eventId);
    WaitFlag<HardEvent::V_S>(eventId);
  }
```

与 §4 的自由函数 `SetWaitFlag` 语义完全相同，区别只有两点：
（a）用成员 `pipe_->FetchEventID` 而非 `GetTPipePtr()->`；（b）事件固定为 `V_S`。
所以它是 §4 的一个**成员方法版重复实现**。消费点 `:414`（`DotFp32` 内）、
`:523`（`CopyInGamaBeta` 末尾）。

为什么需要 `V_S`：`Mul`/`WholeReduceSum` 在 Vector 核上写 `broadTmpInUb`，
而 `GetValue`（`:417`、`:421`）在 Scalar 核上读。AscendC 里 Vector 写→Scalar 读**必须**显式事件同步，
`PipeBarrier<PIPE_V>()` 只保证 Vector 流水线内部有序，不跨越到 Scalar。
`:521-522` 的注释就是这个意思（照抄）：

```cpp
    // beta/gama/gamaK are read with LocalTensor::GetValue in
    // ProcessHead.  Explicitly synchronize Vector writes to Scalar reads.
```

## 13. `Process`（`:259-309`）：三层循环的顶层

### 13.1 `cu_seqlens` 的双语义解析（`:263-277`）

`cuSeqlensIsPrefix_` 为真（`:266-269`）：`seq0 = cu[i]`、`seq1 = cu[i+1]`、`seqLen = seq1-seq0`——
标准前缀和读法，O(1)。**但此分支在终态永不进入**（§8.2）。

`cuSeqlensIsPrefix_` 为假（`:270-277`，终态唯一路径）：

```cpp
        seqLen = GetCuSeqlen(batch_i);
        seq0 = 0;
        for (uint64_t i = 0; i < batch_i; i++) {
          seq0 += GetCuSeqlen(i);
        }
        seq1 = seq0 + seqLen;
```

`cu_seqlens` 此时是**每样本长度数组**而非前缀和，所以起点要现场累加。
复杂度 `O(B²/2)` 次标量 `GetValue`。`B_=1`（decode 常态）时循环 0 次、`seq0=0`、`seq1=seqLen`，
与"变长 batch 的偏移表"退化一致——**这就是 RGDR 只面向 decode 的接口证据**：
prefix 模式是留给 prefill 的骨架，但它被 `:287` 硬编码关掉了。

### 13.2 两道守卫（`:278-286`）

```cpp
      if (seqLen <= 0) {
        continue;
      }
      if (seqLen > static_cast<int32_t>(MAX_MTP)) {
        return;
      }
```

`continue` 与 `return` 的分工很讲究：`seqLen<=0` 是**该样本为空**，跳过它继续后面的样本；
`seqLen>MAX_MTP` 是**该 kernel 拒绝 prefill**，直接结束整个 block 的工作。
后者用 `return` 而非报错，因为 `__aicore__` 里没有异常通路——越界时**静默产出错误结果**。
infershape 侧是否有 `seq_len ≤ 8` 的校验？`01` 篇 §3 已确认 `…_infershape.cpp:24-53`
**只做形状照抄、不比任何维值**，所以唯一的防线就是 `:281-283` 这个静默 `return`。

`:284-286` 的第二道守卫检查 `seq0`/`seq1` 落在 `[0, T_]` 且 `seq0 <= seq1`，同样 `return`。
两个 `return` 都发生在**已经进入 batch 循环、但尚未分配任何 UB 队列元素**的位置，
所以不会泄漏队列槽（`InitLocalBuffers` 在 `Init` 里就做完了，队列深度 1 的槽只在 `AllocTensor` 才占用）。

### 13.3 分片与 `copyFlag`（`:287-306`）

```cpp
      uint32_t copyFlag = 0;
      uint64_t stateOffset;
      for (uint64_t head_i = 0; head_i < NV_; head_i++) {
        if (blockDim > 0 &&
            (static_cast<uint64_t>(batch_i) * static_cast<uint64_t>(NV_) + head_i) % blockDim != blockIdx) {
          continue;
        }
        copyFlag++;
        if (copyFlag == 1) {
          int32_t stateTokenIdx = seq0;
          if (hasAcceptedTokens_) {
            int32_t acceptedTokenNum = numAcceptedTokensGm_.GetValue(batch_i);
            if (acceptedTokenNum > 0 && acceptedTokenNum <= seqLen) {
              stateTokenIdx = seq0 + acceptedTokenNum - 1;
            }
          }
          stateOffset = GetSsmStateIndex(stateTokenIdx);
          CopyInGamaBeta(seq0, seq1);
        }
        ProcessHead(seq0, seq1, head_i, stateOffset);
      }
```

逐点：

- **分片键是 `batch_i * NV_ + head_i` 的线性 id 对 `blockDim` 取模**（`:290-292`）。
  这是 **round-robin 而非 contiguous 切分**：核 0 拿到 head 0、`blockDim`、`2*blockDim`…
  与 CGDR 的 contiguous 切分不同（CGDR 按块号乘块大小）。round-robin 的好处是所有核的
  负载天然均衡（`B_*NV_` 不能整除时差异 ≤ 1），代价是**同一 batch 的 `gama/beta` 会被多个核
  各自重复装载**——见下一条。
- `copyFlag` 是**本核在本 batch 上处理的第几个 head 的计数器**，不是全局标志。
  `copyFlag == 1` 时装载 `gama/beta` 与 `stateOffset`（`:295-305`）。
  由于 `stateOffset` 与 `head_i` 无关（只依赖 `stateTokenIdx`，即 batch 级），
  而 `CopyInGamaBeta(seq0, seq1)` 也只依赖 batch 级，**把它们放在"每核每 batch 的首个 head"上做**
  是正确的最小化：每核每 batch 一次。`B_ × 核数` 次 `beta` DMA，而不是 `B_ × NV_` 次。
- `stateOffset` 声明为**未初始化**（`:288`，`uint64_t stateOffset;` 无 `= 0`）。
  它唯一的写入点是 `:303`（`copyFlag==1` 分支内），唯一的读取点是 `:306`。
  因为 `copyFlag++` 在 `:294` 无条件先于 `:295`，本核在本 batch 的**第一次**迭代必然进入
  `copyFlag==1`，所以 `:306` 读到的必定是已写值——**逻辑安全但静态检查会报 `uninitvar`**。
  若某个 batch 该核一个 head 都没分到（`B_*NV_ < blockDim` 的极端情况），
  `:306` 根本不会被执行，也不会读未初始化值。cpplint/cppcheck 层面这是 PSEUDO：
  **放行，因为控制流不可达读点。**
- 回退语义（`:297-301`）：`acceptedTokenNum ∈ (0, seqLen]` 时才改写 `stateTokenIdx`，
  读的是 `seq0 + acceptedTokenNum - 1` 这个 token 的槽位。`acceptedTokenNum == 0`（全部草稿被拒）
  时**不**改，退回 `seq0`——注意 `seq0` 是上一个已接受状态对应的 token，
  这与 `:299` 的 `<= seqLen` 一起构成"回退只影响读槽"的完整实现。
  `03` 篇 §4 用一张表把 `acceptedTokenNum ∈ {0, 1, seqLen, seqLen+1}` 四种取值的行为列清楚。
- `numAcceptedTokensGm_.GetValue(batch_i)`（`:298`）：按 batch 索引，**每样本一个标量**，
  与 def 侧 `[B]` 形状一致（`01` 篇 §2）。

本篇 §13 留下的三个悬点都由续篇接住：

- `Process:306` 调用的 `ProcessHead` 在 `02b` §6.2
- `stateOffset` 的两种用法（读槽 `:303` 与逐 token 写槽 `:570`）在 `02b` §6.1 与 `03` 篇 §4
- `InitLocalBuffers` 切出的那 9 段 UB（§11.3）在 `02a` §4~§7 被逐一消费。本篇行域到 `:310`。

