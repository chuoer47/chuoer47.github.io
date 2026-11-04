# 01 · 算子骨架与 op_host 侧

## 1. 结论先行

RGDR 的 host 侧只做三件事：**把接口钉成 ND 布局的 10 入 2 出**、**把 UB 预算解成一个 `vStep` 和两个队列深度**、
**把 22 个字段的 tiling struct 原样递给 kernel**。它没有 CGDR 的四路 `tilingKey` 分桶
（`SelectCubeDk` 64/80/96/128），只有一个桶 `0`
（`context->SetTilingKey(0);`）。

原因在数据形状上：decode 的 `seq_len ∈ [1, MAX_MTP]`
（`constexpr uint64_t MAX_MTP = 8;`）
`dk`/`dv` 由模型固定（Qwen3.5-4B 是 `Nk=16/Nv=32/Dk=Dv=128`），变化维度只有 batch 与头数，
而它们全部进 `blockDim` 而不进编译期特化。

五件套地图：

| 文件 | 行数（`wc -l`） | 职责 | 本篇小节 |
|---|---|---|---|
| `op_host/…_def.cpp` | 99 | 算子签名注册、arch 配置 | §2 |
| `op_host/…_infershape.cpp` | 64 | out/state 两个输出的形状与类型 | §3 |
| `op_host/…_tiling.h` | 49 | tiling struct（host 侧副本） | §4 |
| `op_host/…_tiling.cpp` | 325 | 平台侦察 + UB 预算 + 填表 | §5（1-129）与 `01b`（130-325） |
| `op_kernel/…_rule.cpp` | 40 | 入口、任务类型、实例化 | §6.1 |
| `op_kernel/…_tiling_data.h` | 49 | tiling struct（kernel 侧副本） | §4 |



## 2. `def.cpp`：十个入参里三个可选

注册类与 `OP_ADD`（`…_def.cpp:20`、`:98`）：

```cpp
class RecurrentGatedDeltaRule : public OpDef {
 public:
  explicit RecurrentGatedDeltaRule(const char *name) : OpDef(name) {
```
（以上 `…_def.cpp:20-22`。）注册宏在 `…_def.cpp:98`：
```cpp
OP_ADD(RecurrentGatedDeltaRule);
```

`…_def.cpp:23-72` 依次声明 10 个 Input，`{ge::DT_FLOAT16}` / `{ge::DT_INT32}` / `{ge::DT_FLOAT}` 三种 dtype
各自成块，格式一律 `FORMAT_ND`，且 `ParamType` 与 `UnknownShapeFormat` 同配置：

| # | 名字 | ParamType | dtype | kernel 侧消费者 |
|---|---|---|---|---|
| 0 | `query` | REQUIRED | FLOAT16 | `queryGm_`（`…_rule.h:196`） |
| 1 | `key` | REQUIRED | FLOAT16 | `keyGm_`（`:197`） |
| 2 | `value` | REQUIRED | FLOAT16 | `valueGm_`（`:198`） |
| 3 | `beta` | REQUIRED | FLOAT16 | `betaGm_`（`:201`） |
| 4 | `state` | REQUIRED | FLOAT16 | `initStateGm_`（`:202`） |
| 5 | `actual_seq_lengths` | REQUIRED | INT32 | `cuSeqlens32Gm_`/`64Gm_`（`:203-204`） |
| 6 | `ssm_state_indices` | REQUIRED | INT32 | `ssmStateIndices32Gm_`/`64Gm_`（`:205-206`） |
| 7 | `g` | **OPTIONAL** | FLOAT | `gamaGm_`（`:199`） |
| 8 | `gk` | **OPTIONAL** | FLOAT | `gamaKGm_`（`:200`） |
| 9 | `num_accepted_tokens` | **OPTIONAL** | INT32 | `numAcceptedTokensGm_`（`:207`） |

三个可选输入就是 decode 接口的全部增量（`docs/PR-1140-96ea3f55/00-PR总览与实验复现.md:29-35` 的"三新概念"），
它们在 host 侧被探测成三个 bool 位（`01b` §2.4）。

两个输出（`:73-84`）都带 `.AutoContiguous()`：

```cpp
    this->Output("out")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND})
      .AutoContiguous();
```

`out` 与 `state` 同名成对——第二个输出 `state` 与第五个输入 `state` 是同一块 GM 的**原地更新**，
这点由 infershape 保证（§3），是 state 池语义的前提。

### 2.1 AICore 配置六个 flag

```cpp
    OpAICoreConfig aicConfig;
    aicConfig.DynamicCompileStaticFlag(true)
      .DynamicFormatFlag(true)
      .DynamicRankSupportFlag(true)
      .DynamicShapeSupportFlag(true)
      .NeedCheckSupportFlag(false)
      .ExtendCfgInfo("softsync.flag", "true");
    this->AICore().AddConfig("ascend310p", aicConfig);
```

四个 `Dynamic* = true` 对应 §1 末段：算子不假设固定 rank/shape，`[T,N,D]` 的 T 可 1~8、N 由模型给。
`NeedCheckSupportFlag(false)` 关掉注册期的能力校验——与 `05` 章要讲的"自定义算子与 CANN 内置算子
同名共存"直接相关（校验开着时同名会互斥）。

`softsync.flag=true` 是本算子唯一一条 `ExtendCfgInfo`。它的必要性可以从 kernel 侧读回来：
`CopyInGamaBeta` 尾部（`…_rule.h:521-523`）与 `CopyOutAttn` 尾部（`:478-481`）都留了显式跨管同步，
`GetSsmStateIndex`/`numAcceptedTokensGm_.GetValue` 这类**标量读**遍布调度循环，说明作者明知存在 V↔S 与 S↔MTE 的隐式次序要交代。
## 3. `infershape.cpp`：只读三个输入就定完两个输出

```cpp
static uint32_t RecurrentGatedDeltaRuleInferShape(InferShapeContext *context) {
  auto queryShape = context->GetInputShape(0);  // [T, NK, DK]
  auto valueShape = context->GetInputShape(2);  // [T, NV, DV]
  if (queryShape == nullptr || valueShape == nullptr) {
    return ge::GRAPH_FAILED;
  }

  int64_t t = queryShape->GetDim(0);
  int64_t nv = valueShape->GetDim(1);
  int64_t dv = valueShape->GetDim(2);
```

（`:24-33`）`out` 取 `[T, NV, DV]`——注意 T 来自 query、NV/DV 来自 value，**没有任何一致性校验**，
与 tiling 里 `GetShapeDims` 的取法完全相同。GQA 的方向约束（`H_v` 是 `H_k` 的整数倍）
不在这里。

第二个输出是**逐维照抄输入 state**（`:42-50`）：

```cpp
  auto stateShape = context->GetInputShape(4);
  auto stateOutShape = context->GetOutputShape(1);
  if (stateShape == nullptr || stateOutShape == nullptr) {
    return ge::GRAPH_FAILED;
  }
  stateOutShape->SetDimNum(4);
  for (size_t i = 0; i < 4; ++i) {
    stateOutShape->SetDim(i, stateShape->GetDim(i));
  }
```

`SetDimNum(4)` 写死四秩：state 是 `[state_slots, NV, DV, DK]` 的池，`dim0` 是**槽位数**而不是 batch。

一个算子把它的状态维度从"batch 的第几份"换成"池的第几号"，
形状推导层就必须放弃对 dim0 的语义解释，只做透传。

类型推导只有 4 行（`:55-59`）：两个输出都钉成 `DT_FLOAT16`。于是"in-place fp16 state"这条
精度主线的另一半在 host 侧就锁死了：写回的 state 必然是 fp16，`05` 章的量化累积模型由此而来。

## 4. 同一个 struct 抄两遍：`tiling.h` 与 `tiling_data.h`

```c++
#ifndef RECURRENT_GATED_DELTA_RULE_TILING_H
#define RECURRENT_GATED_DELTA_RULE_TILING_H

#include <cstdint>

#pragma pack(push, 8)
struct alignas(8) RecurrentGatedDeltaRuleTilingData {
  uint32_t vectorCoreNum;
  uint32_t ubCalSize;
  uint32_t ubRestBytes;
  uint32_t t;
  uint32_t nk;
  uint32_t dk;
  uint32_t nv;
  uint32_t dv;
  uint32_t sBlockNum;
  uint32_t b;
  uint32_t vStep;
  uint32_t stateOutBufferNum;
  uint32_t attnOutBufferNum;
  float scale;
  uint32_t hasGama;
  uint32_t hasGamaK;
  uint32_t hasAcceptedTokens;
  uint32_t gamaKScalar;        // 1: gamaK is per-head scalar [T, NV], broadcast to DK; 0: per-head vector [T, NV*DK]
  uint32_t cuSeqlensIsPrefix;  // 1: cu_seqlens style [B+1]; 0: actual_seq_lengths style [B]
  uint32_t cuSeqlensIsInt64;   // 1: input dtype is int64; 0: int32
  uint32_t ssmStateIndicesIsInt64;  // 1: input dtype is int64; 0: int32
  uint32_t reserved;
};
#pragma pack(pop)

#endif  // RECURRENT_GATED_DELTA_RULE_TILING_H
```

两份定义逐字段相同，`#pragma pack(push, 8)` + `struct alignas(8)`（`…_tiling.h:22-23`、
`…_tiling_data.h:22-23`）。字段表（host 副本 `…_tiling.h:24-45`）：

## 5. `tiling.cpp:1-129`：UB 预算的纯算术半区

这一段没有任何 CANN API 调用，全是可纸面验算的整数算术——它是理解 RGDR 为什么"敢"在 decode 上
手工编排流水的前提。

### 5.1 五个常量（`:26-30`）

```cpp
constexpr uint32_t MAX_MTP = 8;
constexpr uint32_t FP16_NUM_PER_BLOCK = 16;
constexpr uint32_t MAX_TQUE_BUFFER_NUM_310P = 8;
constexpr uint32_t MAX_SCHEDULABLE_AICORE_310P = 8;
constexpr size_t SYSTEM_WORKSPACE_BYTES = 16ULL << 20;
```

`MAX_MTP = 8` 与 kernel 侧 `…_rule.h:26` 同名常量重复定义一份（host/kernel 各一份，无共享头）。
它是 speculative decode(投机推理)  一次验证的最大 token 数，**并且是 UB 预算的单位**：下面每一条公式里的
`MAX_MTP *` 都源于此。`FP16_NUM_PER_BLOCK = 16` 同样两边各一份——fp16 32 字节块 = 16 元素，
对应 kernel 侧 `BLOCK_BYTES = 32`（`…_rule.h:32`）。

`MAX_TQUE_BUFFER_NUM_310P = 8` 是 TQue 队列总数上限，`SelectBufferProfile` 用它筛候选（`01b` §2.6）。
`MAX_SCHEDULABLE_AICORE_310P = 8` 是核数钳制值，初版它定义在函数体内
（`src/f3f5e676/op_host/…_tiling.cpp:128`），终态提到匿名 namespace 顶部（`:29`）——
`06` 章 hunk H5 的一部分。

### 5.2 两个取整 helper（`:32-34`）

```cpp
uint32_t CeilAlign(uint32_t val, uint32_t align) { return (val + align - 1) / align * align; }

uint32_t CeilDiv(uint32_t val, uint32_t div) { return (val + div - 1) / div; }
```

与 kernel 里用的 `AlignUp`/`Ceil` 是同语义不同来源：host 用自带整数式，kernel 用 AscendC 提供的
`AlignUp`、`Ceil`。

三处 16 对齐口径必须一致，否则 host 算出的 `vStep` 会在 kernel 里被重新 `Ceil` 成别的值。实测两边都对 16 取整，一致。

### 5.3 `CalcFixedUbBytes`（`:36-48`）：队列侧的常驻开销

```cpp
  int64_t usedUbBytes = MAX_MTP * (4 * aDk + 2 * aDv);
  usedUbBytes += 128;
  if (hasGamaK) {
    if (gamaKScalar) {
      usedUbBytes += MAX_MTP * 4 * aNv;  // scalar per head, same size as gama
    } else {
      usedUbBytes += MAX_MTP * 4 * aDk;
    }
  }
  usedUbBytes += MAX_MTP * 2 * aNv;
```

逐项对账到 kernel 的 `InitBuffer`（`…_rule.h:217-227`，本报告列表）：

| host 项 | 字节 | 对应 kernel 缓冲 | 
|---|---|---|
| `MAX_MTP*4*aDk` | q+k 两条 fp16 队列 | `qInQueue_`、`kInQueue_` 各 `MAX_MTP*alignK_*sizeof(inType)` | `
| `MAX_MTP*2*aDv` | v 队列 fp16 | `vInQueue_` | 
| `+128` | 常数裕量 | — | — |
| `MAX_MTP*4*aDk`（`!gamaKScalar`） | gamaK **fp32** 队列 | `gamaKInQueue_`（`:221-223` 的 `if (hasGamaK_ && !gamaKScalar_)`） | 
| `MAX_MTP*4*aNv`（`gamaKScalar`） | scalar 板 | `gamaKScalarInUb`（`:248-251`，`FP32_NUM_PER_BLOCK=8` 对齐） |
| `MAX_MTP*2*aNv` | beta 队列 fp16 | `betaInQueue_` |

也就是说 **fixed = 六条（有向量 gk 时七条）VECIN 队列的常驻空间**，与 kernel 的 `BUFFER_NUM=1`
严格对应：每条队列只有一份缓冲，所以 host 按单份计费。

### 5.4 `CalcWorkingUbBytes`（`:50-57`）：再加上 fp32 展开区

```cpp
  int64_t usedUbBytes = CalcFixedUbBytes(aNv, aDv, aDk, hasGama, hasGamaK, gamaKScalar);
  usedUbBytes += MAX_MTP * (8 * aDk + 4 * aDv + 4 * aNv);
  if (hasGama) {
    usedUbBytes += MAX_MTP * 4 * aNv;
  }
```

新增四项各对应 `tmpBuff` 里一块 fp32 展开：

- `4*aDk*MTP` = `qInUb`（`:233`）
- `4*aDk*MTP` = `kInUb`（`:235`）
- `4*aDv*MTP` = `vInUb`（`:231`）
- `4*aNv*MTP` = `betaInUb`（host 用 `MAX_MTP*aNv` 近似 kernel 的
`Ceil(MAX_MTP*NV_,16)*16`，`β` 相关项 `βUbSize` ）
- `hasGama` 时的 `4*aNv*MTP` = `gamaInUb`

**working 与 fixed 的差 = `tmpBuff` 里与 `vStep` 无关的那部分**。剩下的 `vStep` 相关部分由
§5.5 的系数负责。这个两层拆法是读懂 `SelectBufferProfile` 返回值语义的钥匙（`01b` §2.6）。

### 5.5 `CalcVStepCoeff`（`:59-63`）：每单位 `vStep` 的字节价

```cpp
int64_t CalcVStepCoeff(int64_t aDk, uint32_t stateOutBufferNum, uint32_t attnOutBufferNum) {
  int64_t coeff = static_cast<int64_t>(2 * stateOutBufferNum) * aDk + static_cast<int64_t>(2 * attnOutBufferNum);
  coeff += (4 + 4) * aDk + 4;
  return coeff;
}
```

### 5.6 `EvaluateBufferProfile`（`:73-92`）：两步解 `vStep`

```cpp
  int64_t coeff = CalcVStepCoeff(aDk, stateOutBufferNum, attnOutBufferNum);
  int64_t vStep = (ubSize - usedUbBytes) / coeff / static_cast<int64_t>(FP16_NUM_PER_BLOCK) *
                  static_cast<int64_t>(FP16_NUM_PER_BLOCK);
  if (vStep < static_cast<int64_t>(FP16_NUM_PER_BLOCK)) {
    return false;
  }
  int64_t repeatTime = CeilDiv(dv, static_cast<uint32_t>(vStep));
  vStep = CeilAlign(CeilDiv(dv, static_cast<uint32_t>(repeatTime)), FP16_NUM_PER_BLOCK);
```

第一步：把可用 UB 按"每单位价"换成 `vStep` 上限，再向下取整到 16 的倍数（两次整型除法实现 floor-to-16）。
第二步：由 `vStep` 反推分片数 `repeatTime = ⌈dv/vStep⌉`，再**用 `repeatTime` 重解 `vStep`** 并向上对齐 16。

第二拍为什么必要：`dv=128` 而首拍 `vStep=48` 时，`repeatTime=⌈128/48⌉=3`，
重解 `vStep=CeilAlign(⌈128/3⌉=43,16)=48`——不变；但若首拍 `vStep=40`，`repeatTime=4`，
重解 `CeilAlign(32,16)=32`，反而变小。**重解只会让实际分片数恰好等于 `repeatTime`**，
避免"预算按 3 片、运行期跑 4 片"的错位。代价是 `vStep` 可能大于首拍值，即 §6.5 的裕量问题。

`vStep < 16` 直接 `return false`：一个 tile 至少一行对齐块，否则 kernel 的
`Ceil(curSingleV, FP16_NUM_PER_BLOCK)`（`:436`）会退化。

### 5.7 `IsBetterProfile`（`:94-107`）：三级排序

```cpp
bool IsBetterProfile(const BufferProfile &candidate, const BufferProfile &current) {
  if (!current.valid) {
    return true;
  }
  if (candidate.repeatTime != current.repeatTime) {
    return candidate.repeatTime < current.repeatTime;
  }
  uint32_t candidateDepth = candidate.stateOutBufferNum + candidate.attnOutBufferNum;
  uint32_t currentDepth = current.stateOutBufferNum + current.attnOutBufferNum;
  if (candidateDepth != currentDepth) {
    return candidateDepth > currentDepth;
  }
  return candidate.vStep > current.vStep;
```

排序意图明确：**先要分片少（`repeatTime` 小 = state 少搬几轮），再要队列深（流水重叠空间大），
最后才要 `vStep` 大**。这与 CGDR 的 `vStep = cubeDk`
取向相反：CGDR 的 `vStep` 受 Cube 块形约束，RGDR 的 `vStep` 是纯 UB 自由度，所以能拿它换流水深度。

## 6. 入口 `…_rule.cpp` 与三方参数顺序

### 6.1 十四参数的顺序问题

def 的输入顺序是 `query, key, value, beta, state, actual_seq_lengths, ssm_state_indices, g, gk, num_accepted_tokens`
（§2 表），入口 kernel 的形参顺序与之**完全一致**（`…_rule.cpp:21-26`）：

```cpp
extern "C" __global__ __aicore__ void recurrent_gated_delta_rule(GM_ADDR query, GM_ADDR key, GM_ADDR value,
                                                                  GM_ADDR beta, GM_ADDR state, GM_ADDR cuSeqlens,
                                                                  GM_ADDR ssmStateIndices, GM_ADDR g, GM_ADDR gk,
                                                                  GM_ADDR numAcceptedTokens, GM_ADDR out,
                                                                  GM_ADDR stateOut, GM_ADDR workspaceGM,
                                                                  GM_ADDR tilingGM) {
```

但聚合成 `RGDRInitParams` 时顺序被重排（`:32-33`）：

```cpp
  RGDRInitParams initParams{query, key,     value, g, gk, beta, state, cuSeqlens, ssmStateIndices, numAcceptedTokens,
                            out,   stateOut};
```

struct 定义（`…_rule.h:138-151`）的字段序是
`query, key, value, gama, gamaK, beta, initState, cuSeqlens, ssmStateIndices, numAcceptedTokens, attnOut, finalState`
——聚合初始化靠**位置**匹配，于是"门控三件套 `g,gk` 被提到 `beta` 之前"这件事在两个文件里必须同步。
`gama`/`gamaK` 与 `beta`/`initState` 一旦错位，编译不会报错（`GM_ADDR` 全是同一指针类型），
运行期表现为静默读错张量。这是本算子接口层最脆的一处约定

### 6.2 任务类型：第三种形态

```cpp
  // Ascend 310P is an M200 AICore product.  Use the unified AICore task;
  // AIV-only task metadata is not a supported inference launch mode here.
  KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AICORE);
```

### 6.3 单桶实例化

```cpp
  if (TILING_KEY_IS(0)) {
    TPipe pipe;
    RGDR<half, half> op(&tilingData);
    op.Init(initParams, &pipe);
    op.Process();
  }
```

（`:34-39`）模板参数 `<inType, outType>` 只有 `<half, half>` 一种实例化，`tilingKey` 恒 0。
与 CGDR 四桶对照：CGDR 用编译期 `kSpecializedDk` 消掉 `alignK_` 的运行时性；RGDR 的 `alignK_`
是构造函数里的运行时量（`…_rule.h:181`），因为它所有向量指令的长度都是 `alignK_` 的倍数，
不需要特化就有规整的 repeat 数。

### 6.4 `Init` 的提前返回

`Process` 之前还有一道（`…_rule.h:185-193`，`02` 章细讲）：

```cpp
  __aicore__ inline void Init(const RGDRInitParams &initParams, TPipe *pipe) {
    blockIdx = GetBlockIdx();
    if (blockIdx >= workBlockDim_) {
      return;
    }
```

host 的 `SetBlockDim` 给多少就起多少块，多起的块立刻返回——`blockDim` 与 `workBlockDim_`
是两处独立计算（`…_tiling.cpp:253-260` 的 `GetBlockDim` 与 `…_rule.h:176-180`），
公式相同但类型不同（host `uint32_t`、kernel `uint64_t`），这是"host 决策、kernel 复算"的双保险写法。

