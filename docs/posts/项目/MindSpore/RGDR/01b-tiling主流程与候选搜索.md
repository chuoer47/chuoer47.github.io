# 01b · tiling 主流程与候选搜索（`recurrent_gated_delta_rule_tiling.cpp:130-325`）

> 台账区间：`op_host/recurrent_gated_delta_rule_tiling.cpp` 第 130-325 行（196 行，commit `96ea3f55` 快照），
> 本篇为该区间唯一 `primary` 归属。前半段（1-129：常量、`CeilAlign`/`CeilDiv`、三个 `Calc*` 预算函数、
> `BufferProfile`、`EvaluateBufferProfile`、`IsBetterProfile`）在 `01` 篇 §5 逐行精读，本篇不重复引用块。
> 切分点在 `:130` 空行（`:129` 是 `IndexTypes` 结构体的收尾 `};`），依据记于 `_journal.md` 阶段 2。

## 1. 结论先行

1. `:130-292` 是 **8 个纯函数 + 3 个 POD 结构体**的静态侦察层，`:296-322` 的主函数只剩 27 行顺序调用。
   这层拆分本身由 commit `ab45f0dc` 完成（`06` 篇 §2 逐 hunk 对照），算法零改动。
2. **`{2,2}` 候选是结构性死代码**：`MAX_TQUE_BUFFER_NUM_310P = 8`（`:28`）+ `fixedQueueBufferNum = 5U + gamaK`
   （`:233`）使得 `5 + 2 + 2 = 9 > 8` 恒成立——三档候选里只有 `{1,1}` 和 `{1,2}` 可能入选，
   而 `gamaK` 为向量模式时（`fixedQueueBufferNum = 6`）连 `{1,2}` 也会被拒，只剩 `{1,1}`。推导见 §4.3。
3. `ubRestBytes` 不是"剩余空间随便给"，它是**唯一的越界防线**：kernel 侧 `restUbSize_ = tilingData->ubRestBytes`
   （`recurrent_gated_delta_rule.h:175`）→ `pipe_->InitBuffer(tmpBuff, restUbSize_)`（`:227`），
   fp32 暂存池的全部 `GetWithOffset` 都在这块里切。因此 `:247-250` 的 `queueCoeff` 算错一个字节，
   就是运行期 UB 溢出。本篇 §5 会给出 `queueCoeff` 与 `CalcVStepCoeff` 的系数对照，
   并确认 `01` 篇 §6.5 发现的 `2·aDk` 缺口**在同一文件的两个函数之间自相矛盾**。
4. `cuSeqlensIsPrefix` 在 `:287` 被**硬编码为 0**，kernel 侧 `:266-277` 的 prefix 分支成为不可达代码。
   这是终态快照里三处"字段活着、路径死了"之一（另两处：`sBlockNum` 只写不读、`reserved`）。
5. `GetScale(context)` 在 `:282` 才被调用——它藏在 `FillTilingData` 内部而不是主流程里，
   是这套"纯函数 + 结构体传参"分解里唯一破坏约定的点（`FillTilingData` 因此又拿了一次 `TilingContext`）。

## 2. 三个侦察结构体（`:109-129`，归属 `01` 篇，此处只作数据流入口）

`ShapeDims`（`:109-117`，7 字段）/ `OptionalInputs`（`:119-124`，4 字段）/ `IndexTypes`（`:126-129`，2 字段）
把 22 字段的 tiling 结构体在 host 侧切成三组来源互不相干的证据：
形状探测、可选输入探测、dtype 探测。`01` 篇 §4 已给全字段生产者表，本篇按函数逐个讲生产者。

```cpp
struct OptionalInputs {
  uint32_t hasGama;
  uint32_t hasGamaK;
  uint32_t hasAcceptedTokens;
  uint32_t gamaKScalar;
};
```

四个字段都是 `uint32_t` 布尔而非 `bool`——它们最终原样写入
`RecurrentGatedDeltaRuleTilingData` 的同名 `uint32_t` 字段（`:283-286`），kernel 侧再转回 `bool`
。

整条链上"0/1 整数 → bool → 整数"绕了一圈，
换来的是 tiling 结构体无需 padding 猜测。

## 3. `GetPlatformResources`：核数侦察的三级降级（`:131-151`）

```cpp
bool GetPlatformResources(TilingContext *context, uint32_t &coreNum, int64_t &ubSize) {
  auto platformInfo = context->GetPlatformInfo();
  if (platformInfo == nullptr) {
    return false;
  }
  platform_ascendc::PlatformAscendC platform(platformInfo);
  coreNum = platform.GetCoreNumAiv();
  if (coreNum == 0) {
    coreNum = platform.GetCoreNum();
  }
  if (coreNum == 0) {
    coreNum = 1;
  }
  if (coreNum > MAX_SCHEDULABLE_AICORE_310P) {
    coreNum = MAX_SCHEDULABLE_AICORE_310P;
  }
  uint64_t ubSize64 = 0;
  platform.GetCoreMemSize(platform_ascendc::CoreMemType::UB, ubSize64);
  ubSize = static_cast<int64_t>(ubSize64);
  return true;
}
```

### 3.1 `GetCoreNumAiv()` 优先，`GetCoreNum()` 兜底

### 3.2 `ubSize` 没有下界校验

`GetCoreMemSize` 的返回值被忽略（`:148` 无判空），`ubSize64` 初值 0。
若该 API 在某个不支持的 SoC 上失败，`ubSize = 0` 会传到 `EvaluateBufferProfile`（定义 `:73`，vStep 计算 `:76`），
`(0 - workingUbBytes) / coeff` 为负，`vStep < 16` 直接 `return false` →
`SelectBufferProfile` 返回 false → 主函数 `GRAPH_FAILED`。

即：**UB 侦察失败的表现形式是编译期 tiling 失败，而不是运行期崩**，
这是 §1-3 那句"唯一防线是 ubRestBytes"能成立的隐含前提。

## 4. `GetShapeDims` / `GetScale` / `GetOptionalInputs` / `GetIndexTypes`（`:153-220`）

### 4.1 `GetShapeDims`：五个入参里只读四个形状（`:153-176`）

```cpp
  const auto &qDims = queryShape->GetStorageShape();
  const auto &vDims = valueShape->GetStorageShape();
  const auto &sDims = stateShape->GetStorageShape();
  const auto &cDims = cuSeqlensShape->GetStorageShape();
  dims.t = qDims.GetDim(0);
  dims.nk = qDims.GetDim(1);
  dims.dk = qDims.GetDim(2);
  dims.nv = vDims.GetDim(1);
  dims.dv = vDims.GetDim(2);
  dims.sBlockNum = sDims.GetDim(0);
  dims.b = cDims.GetDim(0);
  if (dims.b == 0) {
    dims.b = 1;
  }
```

三点：

- **key（input 1）根本没读**：`nk` 取自 query 的 dim1，`dk` 取自 query 的 dim2。
  def 侧对 q/k 的 shape 一致性没有任何断言（`01` 篇 §3 已记 infershape 全程不做一致性校验，
  `InferDataType` 只设两个输出的 dtype），
  所以 k 的实际头数错配只能由 kernel 侧越界读爆出来。
- `b` 的来源是 **`cu_seqlens` 的长度**而不是任何 4D 输入的第一维——这与 `01` 篇 §3 讲的
  "decode 场景 `cu_seqlen` 是 per-batch 长度数组（非前缀和）"配套：`cLen = B`，
  且 `:172-174` 把 `b == 0` 抬到 1，保证 `taskUnits = b * nv ≥ 1`。
- `sBlockNum = sDims.GetDim(0)`：state 池的槽位总数。它被写进 tiling（`:277`）
  但 kernel 侧**从未读取**（`01` 篇 §4 生产者/消费者表的 write-only 项之一）。
  它是留给"越界访问池"检查的字段，而那个检查最终没写。

### 4.2 `GetOptionalInputs`：`gamaK` 的标量/向量判别与一条互斥规则（`:187-207`）

```cpp
OptionalInputs GetOptionalInputs(TilingContext *context, const ShapeDims &dims) {
  OptionalInputs inputs = {0, 0, 0, 0};
  inputs.hasGama = context->GetOptionalInputShape(7) == nullptr ? 0 : 1;
  auto gamaKShape = context->GetOptionalInputShape(8);
  if (gamaKShape != nullptr) {
    inputs.hasGamaK = 1;
    const auto &gamaKDims = gamaKShape->GetStorageShape();
    int64_t gamaKTotal = 1;
    for (size_t i = 0; i < gamaKDims.GetDimNum(); ++i) {
      gamaKTotal *= gamaKDims.GetDim(i);
    }
    int64_t expectedVector = static_cast<int64_t>(dims.t) * dims.nv * dims.dk;
    inputs.gamaKScalar = gamaKTotal < expectedVector ? 1 : 0;
  }
  inputs.hasAcceptedTokens = context->GetOptionalInputShape(9) == nullptr ? 0 : 1;
  if (inputs.hasGama == 1 && inputs.hasGamaK == 1 && inputs.gamaKScalar == 1) {
    inputs.hasGamaK = 0;
    inputs.gamaKScalar = 0;
  }
  return inputs;
}
```

**判别方式本身是"猜"**：`gamaK` 的两种模式（每头一个标量 `[T, NV]` vs 每维一个向量
`[T, NV, DK]`）在 def 层用同一个可选输入注册（`recurrent_gated_delta_rule_def.cpp:63` 的
`this->Input("gk")`，详见 `01` 篇 §2），没有 attr 区分。host 只能用**元素总数 `< t·nv·dk` 判标量**
（`:194-199`）。这是一个严格不等式：`[T, NV]` 的 `T·NV` 对 `T·NV·DK`，只要 `dk > 1` 就稳稳落进标量档；
反过来若用户传 `[T, NV, 1]`，元素数 `= T·NV < T·NV·dk`（`dk>1`）→ 判为标量，
而语义上它是"沿 K 维全相同"的向量——两种解释数值等价，所以这个歧义无害。

**`:202-205` 的互斥规则**是这段里唯一改变行为的东西：`gama` 与**标量** `gamaK` 同时存在时，
直接把 `gamaK` 关掉。为什么？看 kernel 侧两个量的用法（`recurrent_gated_delta_rule.h:435-472`
`Compute`，`02b` 篇逐行讲）：

- `gama_`：`stateInUb[i] = Muls(stateInUb[i], gama_)` 的**标量衰减**，作用于整个 `dk×vStep` 块；
- `gamaK_`：标量模式下同样是从 `gamaKScalarInUb` 取的一个标量，乘在 `beta` 之后的 delta 上。

两者都是"每头一个标量的衰减因子"，同时给两个的语义没有定义过（是相乘？后者覆盖前者？）。
host 的裁决是**后者不作数**——保留 `gama` 路径，因为 `gama` 有队列、有 `CopyInGamaBeta`
的统一装载（`:495-524`），而标量 `gamaK` 走 `tmpBuff` 里额外一块（`:248-251`）。
代价：这条规则在 def/README 里都没有写（`docs/PR-1140-96ea3f55/` 四篇也无记载——已 grep 确认），
只有代码能读出来。属于本报告在 `00` 篇「未做」里登记的"文档欠账"之一。

### 4.3 `GetIndexTypes`：dtype 探测而非 shape 探测（`:209-220`）

```cpp
IndexTypes GetIndexTypes(TilingContext *context) {
  IndexTypes types = {0, 0};
  auto cuTensor = context->GetInputTensor(5);
  if (cuTensor != nullptr && cuTensor->GetDataType() == ge::DT_INT64) {
    types.cuSeqlensIsInt64 = 1;
  }
  auto ssmTensor = context->GetInputTensor(6);
  if (ssmTensor != nullptr && ssmTensor->GetDataType() == ge::DT_INT64) {
    types.ssmStateIndicesIsInt64 = 1;
  }
  return types;
}
```

`GetInputShape(i)` 与 `GetInputTensor(i)` 是两个不同的 API：前者拿 shape，后者拿 dtype + buffer。
索引类输入（`cu_seqlens` / `ssm_state_indices`）的 shape 只用于长度，
真正决定 kernel 用哪个 `GlobalTensor` 的是这里探到的 dtype。
`01` 篇 §2 记过口径差：def 里 `cu_seqlens` 声明支持 `DT_INT32/DT_INT64` 两种，
kernel 里则装了**两份** `GlobalTensor`（`recurrent_gated_delta_rule.h:203-206`），
由 tiling 的这两个 0/1 字段选一份用。

注意 `:211` 与 `:215` 的 `!= nullptr` 判空：`ssm_state_indices` 是必选输入，
`GetInputTensor(6)` 理论上不为空，但这里仍然判空——**判空的方向是"探测失败即按 int32 处理"**，
与 `GetPlatformResources` 的 `coreNum` 兜底同一风格：探测失败退到最保守档，而不是失败退出。

## 5. `SelectBufferProfile`：候选搜索与 `ubRestBytes`（`:222-251`）

```cpp
bool SelectBufferProfile(int64_t ubSize, const ShapeDims &dims, const OptionalInputs &inputs, BufferProfile &selected,
                         int64_t &ubRestBytes) {
  uint32_t alignedNv = CeilAlign(dims.nv, FP16_NUM_PER_BLOCK);
  uint32_t alignedDv = CeilAlign(dims.dv, FP16_NUM_PER_BLOCK);
  uint32_t alignedDk = CeilAlign(dims.dk, FP16_NUM_PER_BLOCK);
  int64_t fixedUbBytes = CalcFixedUbBytes(alignedNv, alignedDv, alignedDk, inputs.hasGama == 1, inputs.hasGamaK == 1,
                                          inputs.gamaKScalar == 1);
  int64_t workingUbBytes = CalcWorkingUbBytes(alignedNv, alignedDv, alignedDk, inputs.hasGama == 1,
                                              inputs.hasGamaK == 1, inputs.gamaKScalar == 1);
  selected = {0, 0, 0, 0, false};
  const uint32_t candidates[][2] = {{1, 1}, {1, 2}, {2, 2}};
  uint32_t fixedQueueBufferNum = 5U + ((inputs.hasGamaK == 1U && inputs.gamaKScalar == 0U) ? 1U : 0U);
  for (const auto &candidate : candidates) {
    if (fixedQueueBufferNum + candidate[0] + candidate[1] > MAX_TQUE_BUFFER_NUM_310P) {
      continue;
    }
    BufferProfile profile = {0, 0, 0, 0, false};
    if (EvaluateBufferProfile(ubSize, workingUbBytes, alignedDk, dims.dv, candidate[0], candidate[1], profile) &&
        IsBetterProfile(profile, selected)) {
      selected = profile;
    }
  }
  if (!selected.valid) {
    return false;
  }
  int64_t queueCoeff = (2 + static_cast<int64_t>(2 * selected.stateOutBufferNum)) * alignedDk +
                       static_cast<int64_t>(2 * selected.attnOutBufferNum);
  ubRestBytes = ubSize - fixedUbBytes - queueCoeff * static_cast<int64_t>(selected.vStep);
  return ubRestBytes >= 0;
}
```

（`:222-251` 逐字符照抄，30 行全录。）

### 5.1 队列槽位预算：`{2,2}` 永不可达

`InitBuffer` 的 8 次调用（`recurrent_gated_delta_rule.h:217-227`）与
`fixedQueueBufferNum = 5U + gamaK向量` 的对应关系是精确的：

| 槽位 | 队列 | 深度 | host 记账 |
|---|---|---|---|
| 1 | `qInQueue_` | `BUFFER_NUM = 1` | 计入 5 |
| 2 | `kInQueue_` | 1 | 计入 5 |
| 3 | `vInQueue_` | 1 | 计入 5 |
| 4 | `stateInQueue_` | 1 | 计入 5 |
| 5 | `betaInQueue_` | 1 | 计入 5 |
| 6 | `gamaKInQueue_` | 1 | `hasGamaK && !gamaKScalar` 时计入 +1（`:233`） |
| 7 | `stateOutQueue_` | `stateOutBufferNum_` | 候选 `candidate[0]` |
| 8 | `attnOutQueue_` | `attnOutBufferNum_` | 候选 `candidate[1]` |

固定 5 个槽 + `tmpBuff`（第 9 个 `InitBuffer`，`:227`）不计入 TQue 上限——它是裸 UB 区，不是队列。
标量 `gamaK` 不占槽（走 `tmpBuff`，`:248-251`），这正是 `:233` 那个条件表达式里
`inputs.gamaKScalar == 0U` 的意义。

代入三档候选：

| 场景 | `fixed` | `{1,1}` | `{1,2}` | `{2,2}` |
|---|---|---|---|---|
| 无 `gamaK` / 标量 `gamaK` | 5 | 7 ≤ 8 ✓ | 8 ≤ 8 ✓ | **9 > 8 ✗** |
| 向量 `gamaK` | 6 | 8 ≤ 8 ✓ | 9 > 8 ✗ | 10 > 8 ✗ |

结论（可完全由 `:28`、`:233`、`:235` 三个常数与字面量推出，不依赖任何硬件数值）：

- `{2,2}` 在两种场景下**都被拒**，`candidates` 数组的第三项在 `MAX_TQUE_BUFFER_NUM_310P = 8` 下是死代码；
- 向量 `gamaK` 时只剩 `{1,1}`，此时 `IsBetterProfile`（`:94-107`）的三级排序**永远只有第一次比较生效**
  （`selected.valid == false → return true`），排序逻辑同样不可达；
- 只有在"无/标量 `gamaK` 且 `{1,1}` 与 `{1,2}` 都 UB 可容"时，搜索才真正发生。
  此时两者 `repeatTime` 可能不同（`{1,2}` 的 `coeff` 大 `2·nA = 2`，`vStep` 略小），
  `IsBetterProfile` 第一级 `repeatTime` 少者优先——`vStep` 更大的一方胜出，
  即 `attnOutBufferNum` 从 2 降到 1 换来的 `vStep` 增益比"多一个输出缓冲"更值。
  按第二级排序（depth 大者优先）永远走不到，除非两者 `repeatTime` 相同。

这条推理同时解释了 `EvaluateBufferProfile` 的**两步 vStep 解**（`01` 篇 §5.5）为什么必要：
只有让 `repeatTime` 先由 `vStep` 定下来、再按 `repeatTime` 反解对齐后的 `vStep`，
`{1,1}` 与 `{1,2}` 才会在同一 `repeatTime` 上可比；否则搜索退化成"谁的 coeff 小谁赢"。

### 5.2 `queueCoeff` 与 `CalcVStepCoeff` 的系数差 = `2·aDk`

同一文件里两处"每单位 `vStep` 花多少字节"的系数：

```cpp
  int64_t coeff = static_cast<int64_t>(2 * stateOutBufferNum) * aDk + static_cast<int64_t>(2 * attnOutBufferNum);
  coeff += (4 + 4) * aDk + 4;
```

（`:60-61`，`CalcVStepCoeff`，用于 `:76` 定 `vStep`。）

```cpp
  int64_t queueCoeff = (2 + static_cast<int64_t>(2 * selected.stateOutBufferNum)) * alignedDk +
                       static_cast<int64_t>(2 * selected.attnOutBufferNum);
```

（`:247-248`，用于 `:249` 定 `ubRestBytes`。）

展开对齐项：

| 项 | 含义 | `CalcVStepCoeff`（`:60-61`） | `queueCoeff`（`:247-248`） |
|---|---|---|---|
| `2·nS·aDk` | `stateOutQueue_`（fp16，`aDk·vStep·2` B × nS） | 有 | 有 |
| `2·nA` | `attnOutQueue_`（fp16，`vStep·2` B × nA） | 有 | 有 |
| `2·aDk` | `stateInQueue_`（fp16，`aDk·vStep·2` B × 1） | **无** | **有**（`:247` 的常数 2） |
| `8·aDk` | `stateInUb` + `broadTmpInUb`（fp32，各 `aDk·vStep·4` B） | 有（`(4+4)*aDk`） | 无（属 `tmpBuff`，不在队列里） |
| `4` | `attnInUb`（fp32，`vStep·4` B） | 有 | 无（同上） |

两边互补得刚好——除了 `stateInQueue_` 的 `2·aDk` 在**定 `vStep` 的那一侧缺席**。
把两侧写成一个恒等式，kernel 侧真实 UB 需求为：

```
UB_need(vStep) = fixedUbBytes                                  // 与 host 一致
               + CalcWorkingUbBytes − fixedUbBytes             // fp32 暂存池里与 vStep 无关的部分
               + (2·aDk + 2·nS·aDk + 2·nA) · vStep             // 三个 vStep 相关队列 = queueCoeff
               + (8·aDk + 4) · vStep                           // tmpBuff 里 vStep 相关的三项
```

host 实际保证的是（`:76` 的不等式 `vStep·coeff ≤ ubSize − workingUbBytes`）：

```
ubSize ≥ workingUbBytes + (2·nS·aDk + 2·nA + 8·aDk + 4) · vStep
```

两式相减，**恰好缺 `2·aDk·vStep`**：`stateInQueue_` 的 fp16 深度没有参与 `vStep` 定标。
`01` 篇 §6.5 从 `CalcVStepCoeff` 的项表推出同一结论，本篇用 `:247` 的 `queueCoeff` 作反证——
作者**知道** `stateInQueue_` 每单位 `vStep` 要 `2·aDk` 字节（否则 `queueCoeff` 的常数 2 无法解释），
只是没有把它写进 `CalcVStepCoeff`。

`:250` 的 `return ubRestBytes >= 0;` 是唯一兜底：它只保证 `tmpBuff` 不被分配成负数大小，
**不保证** `tmpBuff` 装得下 §5.2 列出的真实需求（缺的就是那 `2·aDk·vStep`）。
换言之，如果这个缺口在真机上确实致命，它不会在 tiling 阶段被 `ubRestBytes >= 0` 拦住。

## 6. `GetBlockDim`：任务单元数与核数取小（`:253-260`）

```cpp
uint32_t GetBlockDim(const ShapeDims &dims, uint32_t coreNum) {
  uint64_t taskUnits = static_cast<uint64_t>(dims.b) * dims.nv;
  if (taskUnits == 0) {
    taskUnits = 1;
  }
  uint32_t blockDim = taskUnits < coreNum ? static_cast<uint32_t>(taskUnits) : coreNum;
  return blockDim == 0 ? 1 : blockDim;
}
```

并行粒度是 `(batch, v-head)` 对——与 `Process()` 的分片索引
`(batch_i * NV_ + head_i) % blockDim != blockIdx`（`recurrent_gated_delta_rule.h:290-293`）
严格同构：任务空间大小 `b·nv`，`blockDim` 取它与可用核数的较小值，多出的核不启动。
decode 的典型规模 `b=1, nv=32` → `taskUnits=32 > 8` → `blockDim=8`，满核；
`b=1, nv=1` → `taskUnits=1` → `blockDim=1`，只起一个核。

`static_cast<uint64_t>(dims.b) * dims.nv` 的溢出防护：`b` 与 `nv` 都是 `uint32_t`，
乘积在 32 位下会回绕（`b` 来自 `cu_seqlens` 长度，正常不会大到 2^16）。
这里升宽是"防御性正确"，与 `GetShapeDims` 的 `b==0 → 1`（`:172-174`）一起，
保证 `taskUnits ∈ [1, 2^64)`、`blockDim ∈ [1, 8]`。

kernel 侧构造函数**独立重算了一遍同一个 `min`**（`recurrent_gated_delta_rule.h:176-180`）：

```cpp
    uint64_t taskUnits = static_cast<uint64_t>(B_) * static_cast<uint64_t>(NV_);
    workBlockDim_ = taskUnits < tilingData->vectorCoreNum ? taskUnits : tilingData->vectorCoreNum;
```

（`:176-177` 照抄。）注意它用的是 `vectorCoreNum`（tiling 里 `:269` 写入的 `coreNum`），
**不是** host `SetBlockDim` 的值。也就是说 runtime 实际启动的 block 数（`blockDim`）
与 kernel 内部分片用的 `workBlockDim_` 是两个独立算出来的、恰好同式的量。
两者只有在 `coreNum ≤ 8` 且 host 的 `min(b·nv, coreNum)` 与 kernel 的
`min(b·nv, vectorCoreNum)` 同步时才一致——因为 `vectorCoreNum` 就是同一个 `coreNum`，
所以当前恒等。**这是冗余但无害**，一旦 host 改成按别的策略 `SetBlockDim`（比如按 `b` 而非 `b·nv`），
kernel 的分片就会与真实启动数脱节。`02` 篇 §3 会在 `Init` 的提前返回处再遇到它。

## 7. `FillTilingData`：22 个字段的落地点（`:262-292`）

```cpp
  tilingData->scale = GetScale(context);
  tilingData->hasGama = inputs.hasGama;
  tilingData->hasGamaK = inputs.hasGamaK;
  tilingData->hasAcceptedTokens = inputs.hasAcceptedTokens;
  tilingData->gamaKScalar = inputs.gamaKScalar;
  tilingData->cuSeqlensIsPrefix = 0;
```

（`:282-287` 照抄。）

三个只在本文出现的决策：

1. **`scale` 到 `:282` 才读**，而不是主流程里读一次传进来。`FillTilingData` 的签名有 7 个参数，
   唯独缺 `scale`，因为 `GetScale(context)` 被塞进了这个函数体。整套分解的"纯函数 + 参数传递"约定
   在这里破了：`FillTilingData` 是三个"从 context 现取"的函数之一（另两个是它的调用者传入的
   `context->GetTilingData`，`:265`）。副作用是 `GetScale` 的 `attrs == nullptr` 分支
   （`:180-182`）永远不会让主流程失败——它返回 `1.0f`。
2. **`cuSeqlensIsPrefix = 0` 是字面量**（`:287`）。`OptionalInputs` 里根本没有这个字段，
   也没有任何 `Get...` 函数能产出它。kernel 侧 `Process()` 的 `:266-269` prefix 分支
   （`seq0 = GetCuSeqlen(batch_i); seq1 = GetCuSeqlen(batch_i+1)`）因此永久不可达，
   走的必然是 `:270-277` 的"逐 batch 累加"分支：

   ```cpp
       } else {
         seqLen = GetCuSeqlen(batch_i);
         seq0 = 0;
         for (uint64_t i = 0; i < batch_i; i++) {
           seq0 += GetCuSeqlen(i);
       ...
   ```

   （`recurrent_gated_delta_rule.h:270-273` 节选，跳过 `:274-277`。）
   这个 `for` 是 O(B²) 的前缀和重算，decode 下 B 极小（1~8），无性能问题；
   但它意味着 `:266` 那个分支判断是纯开销。
   演进史侧的对照：初版 `f3f5e676` 里 `cuSeqlensIsPrefix` 声明后从未被再赋值，终态只是把"永远是 0"这件事从隐式变成显式常量（`_journal.md` 阶段 3 记为 docs `10` 篇 §2.1 的印证）。
3. **`reserved = 0`**（`:290`）：`tiling_data.h` 里唯一的 padding 字段（`01` 篇 §4 表第 22 行）。



## 8. 主流程与注册（`:296-325`）

```cpp
static uint32_t RecurrentGatedDeltaRuleTilingFunc(TilingContext *context) {
  if (context == nullptr) {
    return GRAPH_FAILED;
  }

  uint32_t coreNum = 0;
  int64_t ubSize = 0;
  ShapeDims dims = {};
  if (!GetPlatformResources(context, coreNum, ubSize) || !GetShapeDims(context, dims)) {
    return GRAPH_FAILED;
  }
  OptionalInputs optionalInputs = GetOptionalInputs(context, dims);
  IndexTypes indexTypes = GetIndexTypes(context);
  BufferProfile selected = {0, 0, 0, 0, false};
  int64_t ubRestBytes = 0;
  if (!SelectBufferProfile(ubSize, dims, optionalInputs, selected, ubRestBytes) ||
      !FillTilingData(context, dims, optionalInputs, indexTypes, selected, coreNum, ubSize, ubRestBytes)) {
    return GRAPH_FAILED;
  }
  context->SetBlockDim(GetBlockDim(dims, coreNum));
  context->SetTilingKey(0);
  size_t *ws = context->GetWorkspaceSizes(1);
  if (ws != nullptr) {
    ws[0] = SYSTEM_WORKSPACE_BYTES;
  }
  return GRAPH_SUCCESS;
}

IMPL_OP_OPTILING(RecurrentGatedDeltaRule)
  .Tiling(RecurrentGatedDeltaRuleTilingFunc, sizeof(RecurrentGatedDeltaRuleTilingData));
```

### 8.1 短路顺序

`:304` 把两个 getter 用 `||` 串在一个 `if` 里：`GetPlatformResources` 失败时 `GetShapeDims`
根本不会被调用（短路）。这决定了 `dims = {}`（`:303`）的值初始化不是多余装饰——
虽然失败路径下 `dims` 不再被读，但 `ShapeDims dims = {};` 让"7 个字段全 0"成为静态可见事实，
cppcheck 的 `uninitvar` 才不会报点。对比 `optionalInputs`（`:307`）与 `indexTypes`（`:308`）
不判失败：这两个 getter 的返回类型是值而非 `bool`，它们**不会失败**，只会退到最保守档
（全 0 = 无可选输入、全 int32），这与 §4.3 的判空方向一致。

### 8.2 `SetBlockDim` 在 `FillTilingData` 之后

`:315` 位于 `:311-314` 的成功分支内。若 `FillTilingData` 返回 false（`GetTilingData` 为空），
`SetBlockDim`/`SetTilingKey`/workspace 三件事**一件都不做**，直接 `GRAPH_FAILED`。
这个顺序是对的：失败的 tiling 不该留下部分状态。但它也意味着
`GetBlockDim` 依赖的 `coreNum` 与 `FillTilingData` 写的 `vectorCoreNum` 来自同一次
`:304` 的调用，两者不可能不一致（§6 讨论的 host/kernel 双算冗余在 host 内部是自洽的）。

### 8.3 `SetTilingKey(0)`：单桶

`:316` 硬编码 0，kernel 入口对应 `TILING_KEY_IS(0)`（`recurrent_gated_delta_rule.cpp:34`，
`01` 篇 §6.3）。与 CGDR 的多桶（不同 shape 档走不同 tiling key）不同，RGDR 的所有决策
都塞进 `RecurrentGatedDeltaRuleTilingData` 的 22 个字段，由 kernel 在运行期分支
（`hasGama_`/`hasGamaK_`/`gamaKScalar_`/`ssmStateIndicesIsInt64_`）。
代价是模板只实例化一个 `RGDR<half, half>`（`recurrent_gated_delta_rule.cpp:36`），
换来的是 host 侧不需要任何 `TILING_KEY_IS` 组合爆炸。

### 8.4 workspace 的 16 MB 与静默跳过

`:317-320` 用 `SYSTEM_WORKSPACE_BYTES = 16ULL << 20`（`:30`）申请固定 16 MB，
`GetWorkspaceSizes(1)` 返回空时**不报错**，直接走到 `GRAPH_SUCCESS`。
这是主流程里唯一一处"探测失败即放弃设置"的地方，与 §3.2 的 UB 侦察、§4.3 的 dtype 探测同风格。
RGDR 的 kernel 不使用 workspace（入口签名在 `recurrent_gated_delta_rule.cpp:25` 声明了
`GM_ADDR workspaceGM`，但 `:32-33` 的 `RGDRInitParams` 聚合只列 12 个用户张量，
`:37` 的 `op.Init(initParams, &pipe)` 也就无从拿到它），16 MB 是纯预留。

对比 CGDR：它的 FP32 workspace 修正是真正吃 workspace 的，
RGDR 走"全 UB + 手工流水"，因此躲开了那条修正链——`05` 篇 §4 展开这个分工差异。

### 8.5 `IMPL_OP_OPTILING(RecurrentGatedDeltaRule)`

`:324` 的参数是**算子注册名**，与 def 侧 `OP_ADD(RecurrentGatedDeltaRule, ...)` 配对。
