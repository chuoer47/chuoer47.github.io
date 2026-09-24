# 01 · host 侧 def / InferShape / tiling 结构体头

## 0. 先给结论：这三个文件在 !1108 → !1135 之间一个字节都没改

`op_host/` 四个文件里 **只有 `chunk_gated_delta_rule_tiling.cpp` 的哈希变了**（`e685ab…` → `86ecdf…`），另外三个（含本篇的 def 与 infershape）逐字节相同


这个"零变更"不是偷懒，它反过来精确刻画了 !1135 的改动边界，三条推论都值得记住：

1. **Cube 化是纯内部实现升级**：公共接口（7 输入 / 2 输出 / 1 属性、dtype 集合、format）没有任何一处需要为 Cube 让路。矩阵乘换单元不需要新输入、不需要新属性（没有 `enable_cube` 这类开关）、不需要输出 dtype 变化。
2. **分桶信息不走 tiling 字节流，走 tilingKey**：tiling 结构体 16 个字段一个没加（§4）。桶宽 `kSpecializedDk` 由 kernel 的**模板参数**承载，而模板参数由 host 的 `SetTilingKey()` 选出来（见 02/02b 篇 `chunk_gated_delta_rule_tiling.cpp:323-333`）。于是 `alignK` 这个 !1108 时代"必须由 host 算好传下去"的量，在 !1135 变成 device 侧从 `dk + 编译期常量` 现算（`chunk_gated_delta_rule.h:90-92`）——字段表因此不用扩容。
3. **workspace 扩容也不需要新字段**：!1135 给每核多留了 128 KiB 的 Cube GM 暂存区，但那是 host 侧 `SetBlockDim` 之后按 `blockDim × 常量` 算出来的字节数（`tiling.cpp:342`），device 侧用同一个常量重算偏移（`kernel.h:38-39, 249-254`）。跨 host/device 的一致性靠**两个同值常量**保证，而不是靠 tiling 传参——这是一个可移植的写法，也是一个可攻击的写法（02b 篇会算给你看它的失效条件）。

因此本篇的职责不是"讲改动"，而是**把这三份"没改的契约文本"完整读一遍**，让后面 02/03 篇里每个改动都能落回一张已知的坐标系上。所有与 !1108 同源的行都仍然成块出现在下面，不留空洞。

## 1. `chunk_gated_delta_rule_def.cpp:1-83` —— 算子原型注册

锚点：chunk_gated_delta_rule_def.cpp:1-15

```cpp
/**
 * Copyright 2026 Huawei Technologies Co., Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
```

Apache-2.0 头，15 行，仓库里每个新增文件都逐字复制一份（本篇后两节会再次原样出现）。行 16 空行，行 17 是唯一的 include。

锚点：chunk_gated_delta_rule_def.cpp:16-22

```cpp

#include "register/op_def_registry.h"

namespace ops {
class ChunkGatedDeltaRule : public OpDef {
 public:
  explicit ChunkGatedDeltaRule(const char *name) : OpDef(name) {
```

- 行 17 `register/op_def_registry.h`：CANN 自定义算子的原型注册头，提供 `OpDef` 基类、`OpAICoreConfig`、`OP_ADD` 宏。这个 TU 只参与 host 侧编译，产物进 `libcust_opapi.so`/元数据，与 device 字节码无关。
- 行 19-20：`namespace ops` + 继承 `OpDef` 的类声明。**类名 `ChunkGatedDeltaRule` 就是注册名**（行 82 的 `OP_ADD` 用它字符串化），必须和 `IMPL_OP_INFERSHAPE(ChunkGatedDeltaRule)`、`IMPL_OP_OPTILING(ChunkGatedDeltaRule)` 三处同名——这是本算子三个 host 文件之间最强的隐式契约，任何一处改名会让编译期或运行期找不到实现。
- 行 21-22：构造函数收 `const char *name` 转交基类，注册动作全在构造函数体内完成——`OP_ADD` 会在静态初始化期 new 出这个对象，所以"写构造 = 写注册表"。

锚点：chunk_gated_delta_rule_def.cpp:23-52

```cpp
    this->Input("query")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
    this->Input("key")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
    this->Input("value")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
    this->Input("beta")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
    this->Input("initial_state")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
    this->Input("actual_seq_lengths")
      .ParamType(REQUIRED)
      .DataType({ge::DT_INT32})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
```

六个必填输入，注册顺序 = kernel 入口 `chunk_gated_delta_rule.cpp:22-25` 的形参顺序，也就是 tiling 侧 `kQueryInput=0 / kValueInput=2 / kInitialStateInput=4 / kGammaInput=6`（`tiling.cpp:51-54`）这套下标常量的来源。链式调用的四行模板每输入重复一次，语义分别是：

| 行 | 方法 | 机器语义 |
|---|---|---|
| 23 | `Input("query")` | 按声明序追加一个输入到 op 的输入表；名字用于 Python/C++ 侧按名绑定 |
| 24 | `.ParamType(REQUIRED)` | 必填。框架在构图期就会拒绝缺这个输入的节点 |
| 25 | `.DataType({ge::DT_FLOAT16})` | dtype 候选集，单元素花括号＝只接受 FP16。花括号形式是因为一个入参可以声明多个合法 dtype |
| 26 | `.Format({ge::FORMAT_ND})` | 该 dtype 对应的物理排布声明为 ND（行主序，row-major） |
| 27 | `.UnknownShapeFormat({ge::FORMAT_ND})` | shape 未知时的兜底 format，保证 InferShape 之前框架插的 transpose/contiguous 决策有依据 |

query/key/value/beta/initial_state 都只有 FP16 一档——**这正是 Cube 化的前提**：Mmad 的原生输入是 FP16，而 !1108 的纯 Vector 版其实也吃 FP16（升到 FP32 在 UB 里算），所以 dtype 表在两个版本间无需改动。`actual_seq_lengths` 是 `DT_INT32`（kernel 里 `actualSeqLengthsGm_` 正是 `GlobalTensor<int32_t>`，`kernel.h:122/2417`），它决定 kernel 每个 batch 的真实 T，因此**在 device 侧被标量随机读**（`Process()` 每 batch 一次 `GetValue`，`kernel.h:208/221`）——这是唯一一个不能整块 DMA 的输入。

锚点：chunk_gated_delta_rule_def.cpp:53-57

```cpp
    this->Input("g")
      .ParamType(OPTIONAL)
      .DataType({ge::DT_FLOAT})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
```

第 7 个输入（下标 6）：可选的 log-decay `g`，**dtype 是 FP32**，和其余输入不同。三点：

- `OPTIONAL` 对应 tiling 侧 `HasGamma()` 的三重探测（desc/tensor/shape 都非空才算存在，`tiling.cpp:129-133`），结果压成 `hasGamma` 一个 0/1 字段下发；device 侧只有 `hasGamma_ != 0` 时才给 `gGm_` 绑地址（`kernel.h:123-125`）。
- 传 FP32 而不是 FP16 是数值决策不是接口遗留：g 是 log-decay，前缀和能到 −100 量级，`exp` 拆分的溢出陷阱见 docs/PR-1135 精读 §4 对 `PrepareDecayAndExp` 的注释解读。
- 本行与 !1108 完全一致，且与 Cube 化正交——**注意 def 没有因为"Cube 只吃 FP16"而把 g 降级**，g 全程留在 FP32 域，Cube 侧的操作数（K/Q/V/beta）才是 FP16 + 高低位分裂。

锚点：chunk_gated_delta_rule_def.cpp:58-68

```cpp
    this->Output("out")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND})
      .AutoContiguous();
    this->Output("final_state")
      .ParamType(REQUIRED)
      .DataType({ge::DT_FLOAT16})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
```

两个输出。`out` 挂了一个 `AutoContiguous()`（行 63）：框架会在必要时插一个 contiguous 化节点，保证 kernel 拿到的是紧凑行主序内存——kernel 里 `attnOutGm_` 直接按 `t*NK_ + head` 的扁平偏移写（`kernel.h:660` 附近），依赖这个保证。`final_state` 没有 `AutoContiguous`，因为它的 shape/dtype 由 InferShape 从 `initial_state` 原样镜像（§2），框架不会再动它；两侧都是 `FORMAT_ND`，即公共接口的 state 是 `[B, Hv, Dv, Dk]` 行主序。

一个容易被忽略的事实：def 里 **没有任何输出对应"中间 state 的 FP32 版本"**。块间以 FP32 传递 state 的通道是 workspace（`stateWorkspaceGm_`），也就是运行时申请的临时显存——它对图不可见、不需要注册。这解释了为什么把 state 中转从 UB 挪到 GM、再挪到 GM 里的第二段（Cube 暂存区）都不需要碰 def：**workspace 是算子私有内存，扩展它只需要 tiling 改申请量**（02b 篇 `tiling.cpp:337-344`）。

锚点：chunk_gated_delta_rule_def.cpp:69-80

```cpp
    this->Attr("scale_value").AttrType(OPTIONAL).Float(1.0);

    OpAICoreConfig aicConfig;
    aicConfig.DynamicCompileStaticFlag(true)
      .DynamicShapeSupportFlag(true)
      .NeedCheckSupportFlag(false)
      .DynamicFormatFlag(true)
      .DynamicRankSupportFlag(true)
      .ExtendCfgInfo("softsync.flag", "true");
    this->AICore().AddConfig("ascend310p", aicConfig);
  }
};
```

- 行 69：唯一一个属性，`OPTIONAL` + 默认值 `1.0f`。tiling 用 `attrs->GetAttrPointer<float>(0)` 读，读不到就退回同样的 `1.0f`（`tiling.cpp:117-127`）——默认值在 def 和 tiling 两处各写了一遍，这是 CANN 自定义算子的常见冗余（两处必须一致，否则"不传 attr"和"框架补默认"会得到不同结果）。
- 行 71-77 `OpAICoreConfig` 六个开关，逐个的机器语义：

| 配置 | 含义（AiCore 元数据侧） | 对本 kernel 的实际后果 |
|---|---|---|
| `DynamicCompileStaticFlag(true)` | 允许"动态算子 + 静态编译"共存：shape 在构图期已知时按静态特化编译 | tiling 函数仍会被调用，但可以把决策当编译期常量的机会留给图侧 |
| `DynamicShapeSupportFlag(true)` | 声明支持动态 shape，运行时执行 tiling | 必须支持——T 由 `actual_seq_lengths` 决定，numChunks/vStep/blockDim 全是运行时量 |
| `NeedCheckSupportFlag(false)` | 跳过 Support Check 阶段 | 不给框架"这个 shape 我不支持"的拒绝通道；超出 Cube 支持域（dk>128）的 shape 靠 tiling 回退 generic 路径而不是报错 |
| `DynamicFormatFlag(true)` | 允许 format 动态（不只 ND） | 与 `FORMAT_ND` 声明并存，表示框架可以插 transpose 后交给 kernel |
| `DynamicRankSupportFlag(true)` | 允许 rank 动态 | 主要给 `initial_state`/`final_state` 让路：InferShape 是按 `GetDimNum()` 循环镜像 rank 的（§2 行 66-70），rank 不固定 |
| `ExtendCfgInfo("softsync.flag", "true")` | 打开**软件同步**：跨算子的数据依赖用软件同步协议而不是硬件同步资源 | kernel 内部因此可以随意使用大量 `SetFlag/WaitFlag/PipeBarrier` 手工栅栏（`kernel.h:56`、以及 Cube 流水里成对的 M/V/MTE 事件），不必担心与图级硬件同步资源冲突 |

`softsync.flag` 这一条在 Cube 化后变得更关键而不是更不重要：!1135 的 M/V/MTE1/MTE2/MTE3 五管手工栅栏数量远超 !1108（docs/PR-1174 记录的 `CopyL0CToUb` 缺 M/V 双向栅栏就是这套手工栅栏出的问题），软件同步把"kernel 之间的同步"和"kernel 内部的同步"两套机制解耦，kernel 内部的时序责任完全落在作者自己写的栅栏上。

- 行 78：`AddConfig("ascend310p", aicConfig)`——**这份配置只对 SoC `ascend310p` 生效**。整份 def 没有为 ascend910b 之类配置任何 AiCore 条目，这与 02 篇会看到的"tiling 用 `GetCoreNumAiv()`、workspace 按核数乘"配套：本算子的 host 元数据把硬件目标钉死在 310P 上。这也意味着同一份源码在别的 SoC 上编译产物会缺配置，属于"只测 310P"的代码级自证。
- 行 79-80 闭合构造函数与类。

锚点：chunk_gated_delta_rule_def.cpp:80-83

```cpp
};

OP_ADD(ChunkGatedDeltaRule);
}  // namespace ops
```

- 行 80：类定义右括号。
- 行 82：`OP_ADD(ChunkGatedDeltaRule)` 在全局（实为 `namespace ops` 内）生成静态注册对象，构造时 new 出上面那个类，从而把整张输入/输出/属性/AiCore 表登记进自定义算子元数据。
- 行 83：闭 namespace，带 NOLINT 之外的常规尾注释。

## 2. `chunk_gated_delta_rule_infershape.cpp:1-84` —— 形状与数据类型推导

锚点：chunk_gated_delta_rule_infershape.cpp:1-21

```cpp
/**
 * Copyright 2026 Huawei Technologies Co., Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "register/op_def_registry.h"
#include "exe_graph/runtime/infer_datatype_context.h"

using namespace ge;    // NOLINT(build/namespaces)
using namespace gert;  // NOLINT(build/namespaces)
```

- 行 1-15：与 def.cpp:1-15 逐字相同的许可证头（本篇按"每行都要出现"的规则重复列出一次）。
- 行 17：又 include 了一次 `op_def_registry.h`——InferShape 的 TU 不需要 OpDef，但 `IMPL_OP_INFERSHAPE` 的展开体和 `ge::` 类型部分依赖它，作者按仓库惯例保留。
- 行 18：`infer_datatype_context.h` 提供 `InferDataTypeContext`，即行 75 那个函数的参数类型。
- 行 20-21：两个 `using namespace` + cpplint 豁免注释。`ge` 是图引擎命名空间（`GeShape`/`GRAPH_SUCCESS`），`gert` 是运行时接口命名空间（`InferShapeContext`）。注意它们**开在全局**而不是包进 `namespace ops`——这与 def.cpp 把类放进 `namespace ops` 不同：InferShape 是通过"注册名匹配"挂上去的，不需要与 def 同命名空间。

锚点：chunk_gated_delta_rule_infershape.cpp:22-36

```cpp

namespace {
// out is rank-3 [T, Hv, Dv]; the head-dim axis is the last of the [T, H, D] layouts.
constexpr uint32_t kOutputRank = 3;
constexpr int32_t kHeadDimAxis = 2;
// Input indices for the CGDR operator.
constexpr uint32_t kQueryInput = 0;
constexpr uint32_t kValueInput = 2;
constexpr uint32_t kInitialStateInput = 4;
// Shape dimension indices within the [T, H, D] layout.
constexpr uint32_t kDimT = 0;
constexpr uint32_t kDimH = 1;
// Output indices.
constexpr uint32_t kOutShapeIndex = 0;
constexpr uint32_t kFinalStateOutIndex = 1;
```

- 行 23：匿名 namespace——这两个函数是 TU 内部的，导出符号只由行 82 的宏产生。
- 行 24：注释把 out 的 rank-3 语义 `[T, Hv, Dv]` 说清楚，并解释 head-dim 轴是 `[T, H, D]` 布局的最后一轴。
- 行 25 `kOutputRank = 3`：out 的维数常量。
- 行 26 `kHeadDimAxis = 2`：**唯一一个 `int32_t`**，其余都是 `uint32_t`。原因是 `GeShape::GetDim/SetDim` 的轴下标形参是 `int32_t`，作者在这里迁就接口；行 55/62 用 `kHeadDimAxis` 时是"有符号轴号"，行 60-61 用 `kDimT/kDimH` 时发生 `uint32_t → int32_t` 的隐式转换。这不是 bug（值恒为非负小整数），但它提示了一个真实约束：**head-dim 永远在最后一轴**，所以 `[T, H, D]` 的 D 轴下标恒为 2。
- 行 28-30：三个输入下标 0/2/4，与 def.cpp 的注册顺序严格对应（跳过 1=key、3=beta、5=actual_seq_lengths），也与 tiling.cpp:51-53 的三个同名常量逐字同值——两个 TU 各写一份，同样是冗余契约。
- 行 32-33：`kDimT=0`、`kDimH=1`。
- 行 35-36：两个输出下标，0=out、1=final_state。

锚点：chunk_gated_delta_rule_infershape.cpp:37-50

```cpp

static uint32_t ChunkGatedDeltaRuleInferShape(InferShapeContext *context) {
  auto queryShape = context->GetInputShape(kQueryInput);
  if (queryShape == nullptr) {
    return ge::GRAPH_FAILED;
  }
  auto valueShape = context->GetInputShape(kValueInput);
  if (valueShape == nullptr) {
    return ge::GRAPH_FAILED;
  }
  auto initialStateShape = context->GetInputShape(kInitialStateInput);
  if (initialStateShape == nullptr) {
    return ge::GRAPH_FAILED;
  }

```

函数签名 `uint32_t (InferShapeContext*)` 返回 `GRAPH_SUCCESS/GRAPH_FAILED` 码，这是 `IMPL_OP_INFERSHAPE` 期望的回调形状（行 83 挂上去）。开头三段是同构的空指针防御：三个输入 shape 任一拿不到就整段失败，**不做部分推导**——因为 out 需要 value 的 T/H/Dv、final_state 需要 initial_state 的全维，缺一个就没法产出一致结果。注意这里没有校验 rank，也没有校验 `T % chunkSize`，所有 shape 合理性检查都留给 tiling 和 kernel（回想 def 的 `NeedCheckSupportFlag(false)`）。

锚点：chunk_gated_delta_rule_infershape.cpp:51-62

```cpp

  // query: [T, Hqk, Dk], value: [T, Hv, Dv]
  int64_t T = queryShape->GetDim(kDimT);
  int64_t Hv = valueShape->GetDim(kDimH);
  int64_t Dv = valueShape->GetDim(kHeadDimAxis);

  // out: [T, Hv, Dv]
  auto outShape = context->GetOutputShape(kOutShapeIndex);
  outShape->SetDimNum(kOutputRank);
  outShape->SetDim(kDimT, T);
  outShape->SetDim(kDimH, Hv);
  outShape->SetDim(kHeadDimAxis, Dv);
```

- 行 52：注释给出两侧布局：query `[T, Hqk, Dk]`、value `[T, Hv, Dv]`。**这里的 T 是"全 batch 拼接后的总长"**（varlen 打包），不是单序列长度，这正是 `actual_seq_lengths` 存在的理由。
- 行 53-55：只取三个数——`T` 来自 query，`Hv`、`Dv` 来自 value。`Hqk`、`Dk` 被刻意忽略：out 的 head 数和 head 维**由 value 决定**（GVA 场景下 Hv ≥ Hqk，输出跟着 V 侧走）。
- 行 58：拿 out 的可写 shape 句柄。
- 行 59：`SetDimNum(kOutputRank)` 先把 rank 定成 3，再逐轴 `SetDim`（行 60-62）。顺序有意义：不设 DimNum 就写分量的话，未初始化的高维分量可能被读到。
- 行 60-62：out 的三个分量分别用 `kDimT/kDimH/kHeadDimAxis` 作轴号，等于把 value 的最后两轴原样搬过来。

锚点：chunk_gated_delta_rule_infershape.cpp:63-73

```cpp

  // final_state: [B, Hv, Dv, Dk] — same shape as initial_state
  auto finalStateShape = context->GetOutputShape(kFinalStateOutIndex);
  uint32_t stateDimNum = initialStateShape->GetDimNum();
  finalStateShape->SetDimNum(stateDimNum);
  for (uint32_t i = 0; i < stateDimNum; i++) {
    finalStateShape->SetDim(i, initialStateShape->GetDim(i));
  }

  return ge::GRAPH_SUCCESS;
}
```

final_state 的推导策略是**逐维镜像 initial_state**：先读 `GetDimNum()`（行 66），设给输出（行 67），再 for 循环搬运每个分量（行 68-70）。为什么不写死 4？因为 def 声明了 `DynamicRankSupportFlag(true)`，框架允许 state 的 rank 变化（例如 batch 维被折叠的调用形态）；写死 `[B, Hv, Dv, Dk]` 反而会在 rank≠4 时产出错误 shape。行 64 的注释只是给出常见形态。

行 71 返回 `GRAPH_SUCCESS`，行 72 闭函数。注意整个函数**没有对 `Dk` 做任何约束检查**——dk 能不能走 Cube 是 tiling 的事（`SelectCubeDk`），InferShape 阶段即使 dk=256 也照样成功。这个分层是本 PR 的一个明确设计选择：**Cube 支持域的判断只出现在 tiling 一处**，避免在两个 host 阶段各维护一份支持表。

锚点：chunk_gated_delta_rule_infershape.cpp:74-79

```cpp

uint32_t ChunkGatedDeltaRuleInferDataType(InferDataTypeContext *context) {
  context->SetOutputDataType(kOutShapeIndex, context->GetInputDataType(kQueryInput));
  context->SetOutputDataType(kFinalStateOutIndex, context->GetInputDataType(kInitialStateInput));
  return ge::GRAPH_SUCCESS;
}
```

`InferDataType` 两行两输出：out 的 dtype 跟随 **query**，final_state 的 dtype 跟随 **initial_state**。语义上这是"输出 dtype = 对应主输入的 dtype"的透传策略，好处是将来 def 的 DataType 花括号里放开 `DT_BFLOAT16` 时这里一行都不用改（实测 310P 上 bf16 用例是 skip 的，见 README/PLAN 的测试统计），代价是**不做一致性校验**：query 与 initial_state 的 dtype 允许不同而不报错。行 75 的函数没有 `static`（对比行 38），但它在匿名 namespace 内，链接性等价。

锚点：chunk_gated_delta_rule_infershape.cpp:80-84

```cpp
}  // namespace

IMPL_OP_INFERSHAPE(ChunkGatedDeltaRule)
  .InferShape(ChunkGatedDeltaRuleInferShape)
  .InferDataType(ChunkGatedDeltaRuleInferDataType);
```

- 行 80：闭匿名 namespace。
- 行 82-84：`IMPL_OP_INFERSHAPE(op名)` 宏在该 TU 里生成 C 风格导出（按注册名字符串 `ChunkGatedDeltaRule` 与 def.cpp 注册的算子匹配），链式 `.InferShape/.InferDataType` 挂两个回调。**分号在行 84 末尾**——宏展开成一条表达式语句，少了分号会与后续内容粘连。
- 与 def 的关系：`IMPL_OP_INFERSHAPE` 和 `IMPL_OP_OPTILING`（tiling.cpp:349）用**同一个类名字符串**把两个独立 TU 的实现绑到同一个 op 上；def.cpp 里那个 `class ChunkGatedDeltaRule` 只是注册用的宿主，不会被这两个宏引用为类型。理解这一点才明白为什么三个文件可以各自独立改 while 名字必须一致。

## 3. `chunk_gated_delta_rule_tiling.h:1-29` —— 结构体头与"为什么必须全局"

锚点：chunk_gated_delta_rule_tiling.h:1-20

```cpp
/**
 * Copyright 2026 Huawei Technologies Co., Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef CHUNK_GATED_DELTA_RULE_TILING_H
#define CHUNK_GATED_DELTA_RULE_TILING_H

#include <cstdint>
```

- 行 1-15：同一份 Apache-2.0 头，第三次原样出现。
- 行 16：空行；行 17-18：标准 include guard `CHUNK_GATED_DELTA_RULE_TILING_H`。这个头被 tiling.cpp 用引号形式 include（`tiling.cpp:19`，带 `NOLINT(build/include_subdir)` 豁免 cpplint 的"include 应带子目录"规则）。
- 行 20：`<cstdint>` —— 只用 `uint32_t/float`，不依赖任何 CANN 头。**这是这个头能被 host 与 device 两侧同时安全 include 的前提**（device 侧对应文件是 `chunk_gated_delta_rule_tiling_data.h`，那里改成 include `kernel_operator.h`，见 03 篇 §2）。

锚点：chunk_gated_delta_rule_tiling.h:21-29

```cpp

// ChunkGatedDeltaRuleTilingData MUST stay global (mirror of the kernel-side
// chunk_gated_delta_rule_tiling_data.h): the two structs must be byte-identical
// and the CANN tiling macros require a global struct. The byte stream the host
// writes here is read by the device via GET_TILING_DATA.
// kTilingDataAlign mirrors the device-side constant; both #pragma pack and
// alignas must use the same value.
constexpr int kTilingDataAlign = 8;
#pragma pack(push, 8)
```

- 行 22-26（注释块第一句）：三条硬约束的成文记录——① 必须在全局命名空间；② host/device 两个 struct 必须**字节级相同**；③ host 写的字节流由 device 的 `GET_TILING_DATA` 读出。它解释了 CANN tiling 的真实机制：**tiling 参数不是一组 kernel 形参，而是一块被 host 按结构体布局序列化、device 按同一布局 memcpy 解读的裸字节流**（经 `tilingGM` 指针）。任何一侧的字段顺序、位宽、对齐策略改动都会静默错位——不是编译错，是读到别的字段。
- 行 27：`kTilingDataAlign = 8`，注释同时点明 `#pragma pack` 与 `alignas` 必须用同一个值。
- 行 29：`#pragma pack(push, 8)`——把成员对齐压到最多 8 字节（本结构体最大成员是 4 字节，所以实际效果是"不插任何 padding"，并显式声明这一点）。

行 30 见下节。

## 4. `chunk_gated_delta_rule_tiling.h:30-50` —— 16 个字段逐个说明

锚点：chunk_gated_delta_rule_tiling.h:30-47

```cpp
struct alignas(kTilingDataAlign) ChunkGatedDeltaRuleTilingData {
  uint32_t vectorCoreNum;
  uint32_t ubCalSize;
  uint32_t ubRestBytes;
  uint32_t t;          // total sequence length (padded)
  uint32_t hqk;        // number of q/k heads
  uint32_t dk;         // key head dim
  uint32_t hv;         // number of value heads
  uint32_t dv;         // value head dim
  uint32_t chunkSize;  // chunk size (e.g., 64)
  uint32_t numChunks;  // number of chunks
  uint32_t b;          // batch size from initial_state
  uint32_t padSize;    // padding size
  uint32_t hasGamma;   // optional g input is present
  float scaleValue;
  uint32_t vStep;
  uint32_t debug;
};
```

结构体名 `ChunkGatedDeltaRuleTilingData`（全局）、`alignas(8)` 与 pack(8) 双重声明。16 个字段的写入处（`FillTilingData`，`tiling.cpp:229-248` 的 16 行赋值，顺序与此处**完全一致**）和消费情况如下表。"device 消费"列按 `kernel.h:78-93` 实测统计：

| # | 行 | 字段 | host 写入值（来源） | device 消费 | 与 !1108 字段表的异同 |
|---|---|---|---|---|---|
| 1 | 31 | `vectorCoreNum` | `aivNum`（`GetCoreNumAiv()`，为 0 时回退 `GetCoreNum()`） | **不读**（device 用 `GetBlockNum()`） | 完全相同。Cube 化后它依然只是调试镜像 |
| 2 | 32 | `ubCalSize` | `(uint32_t)ubSize`（`GetCoreMemSize(UB)`） | **不读** | 完全相同。同上 |
| 3 | 33 | `ubRestBytes` | `SolveVStep` 的 `restBytes = ubSize − outQueueMax` | `restUbSize_` → `pipe_->InitBuffer(tmpBuff, restUbSize_)`（`kernel.h:158`） | 字段相同，**数值口径变了**：!1108 的 `ComputeTmpBuffBytes` 少一个 `tBeta`、且 `stateStrideK=CeilAlign(dk,8)`；!1135 加了 betaFp32 且 `stateStrideK=alignK=桶宽`（02 篇 §6） |
| 4 | 34 | `t` | `dims.t`（query 的第 0 轴，**已 padding 的总长**） | `T_ = tilingData->t`（`kernel.h:79`），赋值后**不再使用** | 完全相同（两侧都是死赋值） |
| 5 | 35 | `hqk` | `dims.hqk`（query 第 1 轴 = Nk） | `NK_`，用于 K/Q 的 GM 行跨距 `NK_*realK_` 与 GVA 映射 | 完全相同，但消费点从 !1108 的 13 处涨到 16 处（`LoadPaddedRows` 的 `gmRowElements` 参数化让它被更多地方引用） |
| 6 | 36 | `dk` | `dims.dk`（query 最后轴，**真实 K 维，未桶化**） | `realK_`（63 处引用）+ `naturalAlignK = Ceil(dk,16)*16`（`kernel.h:90`） | 字段相同，语义地位上升：!1108 里 dk 直接决定 `alignK_/stateStrideK_`；!1135 里 dk 只是"真实宽度"，**桶宽由模板参数决定，dk 不进 tiling**（这正是没加 `cubeDk` 字段的原因） |
| 7 | 37 | `hv` | `dims.hv`（value 第 1 轴 = Nv） | `NV_`，head 循环上界 | 完全相同 |
| 8 | 38 | `dv` | `dims.dv`（value 最后轴） | `realV_`，`vStep_` 相关的 tile 数计算 | 完全相同 |
| 9 | 39 | `chunkSize` | 常量 `kDefaultChunkSize=64` | `chunkSize_`（`cs`），矩阵形状 | 完全相同。**注意 64 同时是 Cube 的 M=64**（`kMatmulM`），Cube 快路径要求 `chunkLen==64` 才成立，这个巧合让 chunkSize 从"性能参数"变成"快路径前提" |
| 10 | 40 | `numChunks` | `(t + padSize) / chunkSize` | `numChunks_`，赋值后**不再使用**（device 按 seqLen 重算） | 完全相同 |
| 11 | 41 | `b` | `dims.batch = initial_state 第 0 轴` | `B_`，batch 循环上界 + Cube 暂存区偏移公式 | 完全相同 |
| 12 | 42 | `padSize` | `(chunkSize − t % chunkSize) % chunkSize` | **不读** | 完全相同（device 侧靠 `actual_seq_lengths` 逐序列处理，不需要全局 padSize） |
| 13 | 43 | `hasGamma` | `HasGamma(context) ? 1 : 0` | `hasGamma_`：是否给 `gGm_` 绑地址（`kernel.h:123-125`） | 完全相同 |
| 14 | 44 | `float scaleValue` | attr `scale_value`（缺省 1.0f） | `scale_`，Q 侧缩放（Cube 快路径里被乘进 A 的行） | 完全相同；它是**唯一的 float 字段**，位置在 13 个 uint32 之后（行 43 结束恰是 14×4 字节，offset 56，天然 4 对齐，pack(8) 下不插 padding） |
| 15 | 45 | `vStep` | `SolveVStep` 的解（可能是 `preferredVStep = cubeDk`） | `vStep_`，V-tile 宽度 + `ShouldSplitVTiles()` | 字段相同，**取值域变了**：!1108 只会给 `CeilAlign(dv,16)` 系列值；!1135 会优先给桶宽 64/80/96/128（02 篇 §8） |
| 16 | 46 | `debug` | `FillTilingData` 里恒写 `0` | **不读** | 完全相同（预留的调试开关位） |

**小结（异同的直接回答）**：!1108 与 !1135 的 tiling 字段表**在字段名、类型、顺序、数量上完全一致**，16 个字段无增无删；变化全部发生在**字段的解释方式**上——`ubRestBytes` 的记账公式变了、`vStep` 的候选值集合变了、`dk` 从"决定对齐"降级为"只提供真实宽度"。加上 device 侧从不读的 6 个字段（`vectorCoreNum/ubCalSize/t/numChunks/padSize/debug`，按 `kernel.h:78-93` 实测），可以得出一个实用判断：**这张表是调试与协议占位为主的镜像，真正驱动 Cube 化的三个量只有 `ubRestBytes`、`vStep` 和 `dk`**，其余是纯搬运。

锚点：chunk_gated_delta_rule_tiling.h:48-50

```cpp
#pragma pack(pop)

#endif  // CHUNK_GATED_DELTA_RULE_TILING_H
```

- 行 48：`#pragma pack(pop)` 恢复默认对齐——push/pop 成对，避免污染后续 include。
- 行 49：空行。
- 行 50：`#endif` 带 guard 名尾注释（cpplint 期望 `#endif` 带注释）。

## 5. 本篇的可迁移结论

1. **接口冻结是升级安全的信号，不是没干活**。!1135 的性能收益从 7.273 ms → 1.151 ms，6.3×）全部落在 tiling.cpp + op_kernel 两层，host 元数据零改动。反过来看，如果 Cube 化需要新输入或新属性，那才说明设计漏了东西（比如需要外部指定桶宽）。
2. **"信息走 tilingKey 还是走 tiling 结构体"是一个真正的架构决策**。本 PR 选 tilingKey（4 个桶 → 4 个 kernel 实例），代价是编译产物与 launch 表变大（02b 篇会展开三分改四分的那次反转），收益是**桶宽在 device 侧成为编译期常量**，Mmad 形状、循环次数、缓冲尺寸全部常量折叠。
3. **两个必须逐字节一致的结构体 + 两个必须同值的常量（`CUBE_STAGE_SLOT_BYTES` / host 算式）**，是本 PR 里唯二"编译器不管、跑错才知道"的跨文件契约。写这种契约时代码里的注释（tiling.h:22-27 那五条）不是礼貌，是给下一位改字段的人唯一的防线。
4. **`softsync.flag` + `NeedCheckSupportFlag(false)` 这对组合值得单独记**：前者把 kernel 内部时序责任全交给作者的栅栏代码（!1174 的 bug 就长在这上面），后者关掉框架的支持性拒绝（超出支持域的 shape 必须在 tiling 内部静默回退，而不是让图报错）。两者都是"框架少管、作者多背"的取向。
