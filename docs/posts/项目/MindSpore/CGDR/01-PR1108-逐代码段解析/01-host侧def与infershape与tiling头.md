锚点见各小节首行。本篇覆盖 `src/00e39ab5/op_host/` 的三个"接口层"文件：算子原型（def.cpp 1-83）、形状/类型推导（infershape.cpp 1-84）、tiling 结构体 host 镜像（tiling.h 1-50），共 217 行，全部逐行覆盖。

三条先行结论：

1. **def.cpp 只做三件事**：把 7 入 2 出 1 属性的原型登记进 `op_proto` 库、声明"这份实现只服务 `ascend310p` 这一颗 SoC"、用六个 flag 把动态形状/动态 rank 的责任从框架侧接管过来。它是纯元数据，没有任何计算。
2. **infershape.cpp 是"位置索引契约"的第一处落点**：`0/2/4` 这三个数字必须与 def.cpp 里 `Input(...)` 的书写顺序严格同步，编译器不检查，错了就是静默读错张量。
3. **tiling.h 是 64 字节的二进制协议**：16 个字段没有一个有名字标签随流传递，host/device 靠"声明顺序 + 类型宽度"对齐。本篇把每个字段的偏移、写者、读者全部列出——其中 6 个字段在本 commit 里"只写不读"。

## 1. def.cpp:1-16 — Apache 许可证头与随后的空行

锚点：chunk_gated_delta_rule_def.cpp:1-16

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

## 2. def.cpp:17-22 — 唯一依赖、命名空间与注册类骨架

锚点：chunk_gated_delta_rule_def.cpp:17-22

```cpp
#include "register/op_def_registry.h"

namespace ops {
class ChunkGatedDeltaRule : public OpDef {
 public:
  explicit ChunkGatedDeltaRule(const char *name) : OpDef(name) {
```

- L17 单个 include：`register/op_def_registry.h` 同时提供 `OpDef` 基类、`OpAICoreConfig`、`OP_ADD` 宏，所以原型注册文件不需要第二个头；它落在 `op_proto`（`libcust_opproto.so`）里，与 infershape/tiling 所在的 `op_tiling`（`liboptiling.so`）是**两个不同的编译产物**，靠符号名而非 include 关系绑定。

- L19 `namespace ops {`：CANN 规定的原型注册命名空间；`OP_ADD` 宏展开时会在同一命名空间里生成 `ops::ChunkGatedDeltaRule` 的构造调用，换名字空间就注册不上。注意与 kernel 侧相反——device 侧那两个 tiling 头刻意留在全局命名空间（见 §16 与 03 篇）。
- L20 `class ChunkGatedDeltaRule : public OpDef`：类名即算子注册名（graph 里 `ChunkGatedDeltaRule` 这个 op type 的来源），继承 `OpDef` 后所有成员函数都是"链式 builder"。
- L21 ` public:`。
- L22 `explicit ChunkGatedDeltaRule(const char *name) : OpDef(name)`：`explicit` 阻断 `const char* → OpDef` 的隐式转换；名字由 `OP_ADD` 在 L82 反串化传入，所以类名与算子名同源、不可能写偏；基类构造收到的 `name` 就是后续 `IMPL_OP_INFERSHAPE`/`IMPL_OP_OPTILING` 查表用的 key。

## 3. def.cpp:23-57 — 七个 Input 逐个（含 g 的 OPTIONAL/FP32 之谜）

锚点：chunk_gated_delta_rule_def.cpp:23-57

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
    this->Input("g")
      .ParamType(OPTIONAL)
      .DataType({ge::DT_FLOAT})
      .Format({ge::FORMAT_ND})
      .UnknownShapeFormat({ge::FORMAT_ND});
```

五行一组是固定套路：`Input(名字)` → `ParamType` → `DataType`（花括号是**候选集合**，此处集合长度 1 = 只接受该类型，框架在 build 期直接做类型校验）→ `Format`（已知形状时的格式）→ `UnknownShapeFormat`（形状未知时的格式，收尾分号即声明结束）。

逐个说明：

- **L23-27 `query`**：位置索引 0，`[T, Hqk, Dk]` 打包变长布局（T 是所有 batch 拼接后的总长）。FP16 是因为 310P 上 GM 带宽与 UB 容量都按字节算，K/Q 只作为 DMA 源、真正的计算立刻 `Cast` 到 FP32 临时量，输入侧 FP16 不损失有效位（权重/激活本身是 FP16 训练产物）。
- **L28-32 `key`**：索引 1，与 query 同布局 `[T, Hqk, Dk]`；GQA 下 Q/K 头数 `hqk` 可以小于 V 头数 `hv`，但 def 层不表达这个关系，只由 tiling 读 dim1 得到 `NK_`。
- **L33-37 `value`**：索引 2，`[T, Hv, Dv]`。infershape/tiling 都从它取 `hv`、`dv`（见 §8）。
- **L38-42 `beta`**：索引 3，`[T, Hv]` 的每 token 标量门。**它是 REQUIRED 而 g 是 OPTIONAL**，原因在数学上：delta rule 的更新是 `S ← S + β·k(v − kᵀS)`，β≡0 会让递推退化成"只读不写"的恒等，算子语义直接丢失；而 g（log-decay）缺失时只是丢掉衰减项，`g ≡ 0` 是**合法的语义特例**（纯 DeltaNet），所以做成 OPTIONAL 并在 kernel 里"为 0 时 g 恒取 0"。
- **L43-47 `initial_state`**：索引 4，`[B, Hv, Dv, Dk]`（或 rank-3 的 `[Hv, Dv, Dk]`）。这里**只要求 FP16**，是全链路的精度收敛点：公共接口把 state 定义为 FP16（与 910B/A2 版对齐），跨 chunk 的高精度传递被挪到 workspace 里用 FP32 做（见 02 篇 §5），因此 def 层不需要 FP32 候选。
- **L48-52 `actual_seq_lengths`**：索引 5，`[B]` 的每序列真实长度。**INT32 的三个理由**：
  - ① 上游（PyTorch/MindSpore 的 varlen 约定 `cu_seqlens`/`seq_lens`）给的就是 int32，用 `{ge::DT_INT64}` 会在框架侧插一个 `Cast` 节点；
  - ② device 侧 `actualSeqLengthsGm_.GetValue()` 绑定的是 `__gm__ int32_t*`（kernel.h:118），标量单元一次 32 位取数即得，INT64 需要两次取数再拼接；
  - ③ 值域上 uint16 会把 T 卡在 65535，而本算子的 T 是跨 batch 拼接总长（测试已有 2048×16 头的量级），必须有符号 32 位——顺带允许"长度 ≤ 0 表示空 batch"这一 kernel 内的防御语义（`if (seqLen <= 0)`）。
- **L53-57 `g`**：索引 6，`[T, Hv]` 的 log 衰减。**OPTIONAL 见上**；**DT_FLOAT（FP32）而 beta 是 FP16**，是本 PR 唯一的 dtype 不对称，理由是：g 参与的是**对数域累加**（chunk 内 64 次前缀和 `gCumsumFp32`，再进 `Exp`）。FP16 的尾数只有 11 位，当 g 是 ~1e-2 量级的负小数时，`g_i − g_j` 会发生灾难性消去，误差再被 `exp` 指数放大；beta 只做一次乘性缩放（`v*β`），没有累加放大通路，FP16 足够。代价是 g 不能与 beta 合并成一次 DMA，kernel 里必须单独绑定 `GlobalTensor<float> gGm_`。

## 4. def.cpp:58-70 — 两个 Output、一个 Attr 与其后的空行

锚点：chunk_gated_delta_rule_def.cpp:58-70

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
    this->Attr("scale_value").AttrType(OPTIONAL).Float(1.0);

```

- **L58-63 `out`**：输出索引 0，`[T, Hv, Dv]`，FP16（kernel 内部算的是 FP32，出 UB 前一条 `Cast(..., CAST_NONE)` 折回 FP16）。L63 的 `.AutoContiguous()` 是**本文件唯一的输出侧格式承诺**：它告诉图编译器"这个张量按最内层连续的 ND 布局产出"，因此下游若要别的格式不必再插 `TransData` 节点，同时框架也不会为它预留格式转换空间。只给 `out` 不加给 `final_state` 的含义很实际——`out` 是"消费型"输出（进 loss/进下一层矩阵乘，格式由框架挑），而 `final_state` 在自回归场景里会被回灌成下一轮的 `initial_state`，它的布局已被那个**输入**钉死（`Format` 只有 `FORMAT_ND`），再加 `AutoContiguous` 是冗余承诺；反过来看，如果哪天 `final_state` 被别的格式的算子消费，缺这个承诺就会多插一次转置——这是一个刻意的、可回顾的不对称。
- **L64-68 `final_state`**：输出索引 1，FP16，形状由 infershape 逐维照抄 `initial_state`。
- **L69 `scale_value`**：`AttrType(OPTIONAL)` + `Float(1.0)` 表示"可缺省、缺省 1.0"。用 `Float`（不是 `Number`）意味着属性是强类型 FP32 标量，tiling 侧就能用 `attrs->GetAttrPointer<float>(0)` 直接取（02 篇 §7）；它是**全篇唯一一个直接进 FP32 算术的标量属性**，所以不能定义成 `Int` 让框架做隐式转换。`OPTIONAL` 是必要的：老模型/参考实现里 `scale = 1/sqrt(dk)` 常常已经在外部算好。
- L70 空行：把"输入/输出/属性声明段"与"AICore 配置段"在视觉上分开，无编译语义。

## 5. def.cpp:71-79 — AICore config：六个开关 + softsync + SoC 绑定

锚点：chunk_gated_delta_rule_def.cpp:71-79

```cpp
    OpAICoreConfig aicConfig;
    aicConfig.DynamicCompileStaticFlag(true)
      .DynamicShapeSupportFlag(true)
      .NeedCheckSupportFlag(false)
      .DynamicFormatFlag(true)
      .DynamicRankSupportFlag(true)
      .ExtendCfgInfo("softsync.flag", "true");
    this->AICore().AddConfig("ascend310p", aicConfig);
  }
```

- L71 `OpAICoreConfig aicConfig;`：一个可链式赋值的 AI Core 侧能力描述对象，此刻还没有和任何 SoC 关联。
- **L72 `DynamicCompileStaticFlag(true)`**："动态算子 + 静态编译"。允许框架在形状**已知**时按静态形状重新编译/挑选一份特化二进制（把 T/H/D 折进代码常量），形状未知时再退回动态路径。对本算子收益明确：`chunkSize`、`alignK_`、`stateStrideK_` 这类派生量在静态形状下可编译期折叠，省掉 device 侧一轮标量除法；这也是后续 !1135 里 `kSpecializedDk` 编译期常量折叠路线的前提开关（docs/PR-1135/10 记录的"泛化零性能损失"正是这条能力的验证）。
- **L73 `DynamicShapeSupportFlag(true)`**：声明"本实现能处理运行时才定的形状"。必须为 true，因为 `actual_seq_lengths` 是**数据**而不是形状：同一份二进制要在 T=64/128/2048、batch 变长下都跑对，所有形状量只能走 tiling 结构体传进来，不能靠静态维度。若为 false，框架会在未知形状时报"不支持"或直接回退 CPU。
- **L74 `NeedCheckSupportFlag(false)`**：关掉框架的 `OpCheckSupport` 能力问询。本 PR 没有注册 `IsSupport/OpCheckSupport` 函数，若此 flag 为 true，框架找不到检查函数会判定"未验证支持"，进而可能把算子丢给 CPU fallback 或在建图期报错；显式写 false 等于声明"我这份 AIV 实现对所有能过 infershape/tiling 的输入都支持"，把不支持的场景留给 `GRAPH_FAILED`（tiling 失败）去兜。
- **L75 `DynamicFormatFlag(true)`**：格式不敏感。与 L26/L61 的 `FORMAT_ND` 单元素集合并不矛盾——后者说"我不会主动转成 NC1HWC0 之类"，前者说"传给我的数据是什么内存格式我不挑"。本算子只按元素线性寻址（行主序 `[T,H,D]`），没有任何卷积式格式偏好。
- **L76 `DynamicRankSupportFlag(true)`**：**rank 可为变量**。这条最容易被误读为冗余，其实它是 `final_state` 的实现依赖：`initial_state` 可以是 `[B,Hv,Dv,Dk]`（rank 4）也可以是 `[Hv,Dv,Dk]`（rank 3），infershape 用 `GetDimNum()` 循环照抄（§11），若不支持动态 rank，框架在建图期就会按参考实现的静态 rank 校验失败。
- **L77 `ExtendCfgInfo("softsync.flag", "true")`**：把同步方式从"硬件事件"切成"软件同步"。**310P 必装的开关**：`SetFlag/WaitFlag<HardEvent::S_MTE2>` 这类跨流水事件 ID 与 `TQueSync<PIPE_A,PIPE_B>` 在 910B 上由 L1 里的硬件事件单元实现；310P（Ascend 310P/310P3）的 AI Core 精简了这套事件资源，同一套硬事件编码在指令选择阶段要么失败要么生成错误的等待语义。`softsync.flag=true` 让编译期把 `SetFlag/WaitFlag`、队列的 EnQue/DeQue 降格为软件标志位/屏障实现。本 kernel 的同步密度正是它存在的原因（每次 Axpy 一次 `TQueSync`、每次 DMA 三段式事件、相邻 chunk 间 `PipeBarrier<PIPE_ALL>` + `MTE3_MTE2`，见 docs/PR-406-00e39ab5/02 §3），少了这个标记基本不可能跑通。四个后续 commit（d0906c3e/88d8b965/048d0427 与 !1140 的 RGDR def.cpp:93）都保留了这一行，可视为 310P 自定义算子的固定装配项。
- **L78 `this->AICore().AddConfig("ascend310p", aicConfig)`**：`AICore()` 取回 AI Core 侧配置容器，`AddConfig` 把上面这一整组能力**绑定到 SoC 名 `ascend310p`**。这是本文件唯一决定"这份源码编给谁"的地方：`build_all_ops.sh` 产出的 `ascend310p/mslite_custom_ops/` 里那份 kernel 与 tiling 元数据就来自主 `AddConfig("ascend310p", ...)` 的注册；910B/A2 走的是仓库里另一套（A2 侧代码，本 commit 时点不同步，PLAN 记录其 SoC 编译失败可忽略）。

## 6. def.cpp:80-83 — 类闭合、OP_ADD 与命名空间闭合

锚点：chunk_gated_delta_rule_def.cpp:80-83

```cpp
};

OP_ADD(ChunkGatedDeltaRule);
}  // namespace ops
```

- **L82 `OP_ADD(ChunkGatedDeltaRule);`**：注册机制的核心。宏展开成"一个带 `__attribute__((constructor))` 语义/全局静态对象"，其构造期以字符串 `"ChunkGatedDeltaRule"` 为算子名 `new` 出上面这个类并交给 `RegisterOp`，最终写进 `libcust_opproto.so` 的 op-def 注册表。要点有二：
  - ① 注册发生在 **dlopen 时刻的静态初始化**，所以只要框架加载了这个 .so，算子原型就在表里，不需要显式调用；
  - ② 表里的 key 是字符串，而 `IMPL_OP_INFERSHAPE(ChunkGatedDeltaRule)` / `IMPL_OP_OPTILING(ChunkGatedDeltaRule)` 也做同一件事——把类名反串化成字符串去查这张表，把回调函数指针挂到那条记录上。
  - 于是 def.cpp（op_proto）与 infershape.cpp/tiling.cpp（op_tiling）**跨 .so 绑定**：链接期不校验、拼写错误不会报错、运行时表现为"算子找不到 InferShape/Tiling 实现"。这就是 §13 要讲的绑定关系的全部真相。

## 7. infershape.cpp:1-21 — 许可证头、两个 include 与两个 using

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

- L17 `register/op_def_registry.h`：这里需要的不是 `OpDef`，而是同头里的 `IMPL_OP_INFERSHAPE` 宏与 `InferShapeContext` 声明——infershape 文件落在 `op_tiling`（`liboptiling.so`）里，但仍要 include 原型注册的公共头才能拿到绑定宏。
- L18 `exe_graph/runtime/infer_datatype_context.h`：**只有第二个回调需要**（`InferDataTypeContext`，L75）。它的存在本身就说明 datatype 推导是后来补的：纯形状推导的文件不需要这个上下文。

- L20 `using namespace ge;`：为 L41 等处的 `ge::GRAPH_FAILED` 与 `ge::GRAPH_SUCCESS` 服务（注意作者在返回码上**仍然写了全限定 `ge::`**，说明这条 using 主要是给 `Shape` 一类类型省名用的，返回码刻意保留限定，避免与 `gert` 里的同名枚举打架）。`// NOLINT(build/namespaces)` 是 cpplint 抑制标记——文件级 using 在 Google style 里属禁止项，这里是仓库既有约定。
- L21 `using namespace gert;`：`gert`（graph execution runtime）提供 `InferShapeContext` / `InferDataTypeContext` 的运行时侧接口，同样带 NOLINT 标记。

## 8. infershape.cpp:22-37 — 匿名 namespace 与 8 个常量：每个数字对应哪根轴

锚点：chunk_gated_delta_rule_infershape.cpp:22-37

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

- L23 `namespace {`：匿名命名空间 ⇒ 内部链接。这两个回调不会被别的 TU 引用（只通过宏注册的函数指针进入），锁在内部可避免和 `op_tiling` 库里其他算子的同名符号冲突；函数因此可以不加 `static`。
- L24 注释：声明 `out` 的语义布局是 rank-3 `[T, Hv, Dv]`，并点明"head-dim 轴永远是 `[T,H,D]` 布局的最后一根"——这句话就是 `kHeadDimAxis = 2` 的正当性来源。

| 常量 | 行 | 类型 | 对应实体 | 为什么是这个值 |
|---|---|---|---|---|
| `kOutputRank` | 25 | `uint32_t` | `out.SetDimNum(...)` 的实参 | out 恒为 `[T,Hv,Dv]`，与输入 rank 无关（batch 已被打包进 T），所以 rank 可以硬编码 |
| `kHeadDimAxis` | 26 | **`int32_t`** | 三处：`query`/`value` 的 D 轴（GetDim）、`out` 的 Dv 轴（SetDim） | 框架 `Shape::GetDim/SetDim` 的 axis 形参是 int32（允许用负数表示倒数轴），而 `GetInputShape/GetOutputShape` 的 index 形参是 uint32 —— **两种类型并存是刻意的**，把"轴"和"槽位"区分开 |
| `kQueryInput` | 28 | `uint32_t` | def.cpp 第 1 个 `Input` → 槽位 0 | 提供 T（seq 总长）；`Dk` 也来自它但本文件用不到 |
| `kValueInput` | 29 | `uint32_t` | def.cpp 第 3 个 `Input` → 槽位 2 | 提供 Hv、Dv。**不取 key（1）/beta（3）**：它们的维度与 query/value 重复，多取一次只是多一次空指针风险 |
| `kInitialStateInput` | 30 | `uint32_t` | def.cpp 第 5 个 `Input` → 槽位 4 | final_state 的整份形状来源 |
| `kDimT` | 32 | `uint32_t` | `[T,H,D]` 的第 0 轴 | 兼作 `out` 的第 0 轴写入位（L60）|
| `kDimH` | 33 | `uint32_t` | `[T,H,D]` 的第 1 轴 | 兼作 `out` 的第 1 轴写入位（L61）|
| `kOutShapeIndex` | 35 | `uint32_t` | def.cpp 第 1 个 `Output` → 槽位 0 | out |
| `kFinalStateOutIndex` | 36 | `uint32_t` | def.cpp 第 2 个 `Output` → 槽位 1 | final_state |

三个"输入索引"是 0/2/4 而不是 0/1/2，纯粹是 def.cpp 的书写顺序决定的（query0 key1 value2 beta3 initial_state4 actual_seq_lengths5 g6）。`kGammaInput = 6` 只存在于 tiling.cpp（02 篇 §5），因为 infershape 不需要知道 g 在不在——可选输入不影响任何输出的形状与类型。**索引常量在两个文件里各自重复定义**（没有共享头），这是"改动 def.cpp 顺序必须同时改两处"的隐性契约。

## 9. infershape.cpp:38-51 — 入口与三个 nullptr 检查各防什么

锚点：chunk_gated_delta_rule_infershape.cpp:38-51

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

- L38 函数签名：`static` + 返回 `uint32_t`（GE 状态码），参数 `InferShapeContext*`。`static` 在这里与匿名 namespace 叠加属于双重保险，无害。**返回类型必须是 `uint32_t`**，因为宏注册的函数指针原型就是它。
- L39-42 **第一个检查（query）**：防的是"上游 shape 还没推出来/这一路输入被裁掉"。query 提供 out 的 T 轴；为 nullptr 时无法产出任何输出维度，直接 `GRAPH_FAILED`。语义上这是**部分推导（partial inference）的软失败**——框架在常量折叠、图裁剪、多轮推导阶段都可能带着未知形状调用本函数，返回失败只是让这一轮不产出形状，不是让进程退出。
- L43-46 **第二个检查（value）**：防 out 的 `Hv/Dv` 两轴无源。注意它和 query 检查不能合并成一个 `||`：两个 shape 句柄是分别 `GetInputShape` 出来的，合并写法会留下未取的那个句柄空指针被后续误用，或者需要把 `auto` 换成显式 `Shape*`，作者选了最直白的三段式。
- L47-50 **第三个检查（initial_state）**：防 final_state 的逐维照抄无源。它是三者中**唯一影响 rank 的**输入——L66 要从它读 `GetDimNum()`，所以哪怕 query/value 都齐、缺它也必须整体失败（不能只推 out：两个输出的产出被绑成一次原子操作，半成品形状会让下游拿到 rank 未定的 final_state）。

不对称值得记住：L58 与 L65 的 `GetOutputShape(...)` 返回值**没有做 nullptr 检查**，直接解引用。原因是输出槽位由 def 注册决定、框架一定会预建 shape 对象，实践上恒非空；但这与前三行的防御强度不一致，属于"只防御外部输入"的取舍。

## 10. infershape.cpp:52-62 — 取三根轴并写出 out

锚点：chunk_gated_delta_rule_infershape.cpp:52-62

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

- L52 注释：把"哪根轴来自哪个张量"写死在代码旁，是本函数唯一的形式化接口文档。
- L53 `T`：**来自 query 而非 value**——两者 dim0 相同（同一个打包序列轴），选 query 与 tiling.cpp:97 的 `dims.t = qDims.GetDim(kDimT)` 保持一致；维度用 `int64_t` 接（框架 `GetDim` 返回 int64），全程不做窄化，避免 T 很大时溢出。
- L54 `Hv`：**来自 value 的 dim1**，不是 query 的 dim1（那是 `Hqk`）。GQA 下 `Hv ≥ Hqk`，out 的头维跟随 value，这与 kernel 里 `qkHead = head_i / nvPerNk` 的映射方向一致。
- L55 `Dv`：**来自 value 的第 2 轴**（`kHeadDimAxis`），即最后一根；`Dk` 在此完全不出现，因为 out 不含 Dk 轴——只有 final_state 含，而它靠照抄得到。

- L57 注释：out 布局结论。
- L58 取输出形状句柄（索引 0 = def 的 `out`），未做空检查（见 §9 末段）。
- L59 `SetDimNum(kOutputRank)`：先定 rank 再定 dim，顺序不能反——`SetDim` 在 rank 尚未设置时可能越出已分配的维度数组。
- L60 `SetDim(kDimT=0, T)`：out 第 0 轴 = 真实打包总长，**不含 pad**。tiling 里算出的 `padSize`（02 篇 §10）只用于内部 chunk 对齐，不暴露给公共形状；kernel 写 out 时按 chunkLen 收缩，天然不越界。
- L61 `SetDim(kDimH=1, Hv)`：out 第 1 轴 = value 头数。
- L62 `SetDim(kHeadDimAxis=2, Dv)`：out 第 2 轴 = value 头维。三行与 L59 的 rank=3 恰好一致，写满即闭合。

## 11. infershape.cpp:63-73 — final_state 逐维照抄与返回

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


- L64 注释给出典型 rank-4 布局 `[B, Hv, Dv, Dk]`（rank-3 时是 `[Hv, Dv, Dk]`），并直说"与 initial_state 同形状"。
- L65 取 final_state 的形状句柄（输出索引 1）。
- L66 `GetDimNum()`：把"几根轴"这个信息交给**输入**决定，这就是 def.cpp:76 `DynamicRankSupportFlag(true)` 必须为 true 的直接原因。
- L67 先设 rank，与 L59 同样的顺序纪律。
- L68-70 **逐维 for 循环照抄**：为什么不硬编码 `SetDim(0,B); SetDim(1,Hv); SetDim(2,Dv); SetDim(3,Dk)`？
  - ① rank 未知（3 或 4）；
  - ② 硬编码会把"kernel 内部 state 布局与 workspace 布局互为转置"这一实现细节错误地暴露成接口约束——接口只需承诺"进出同形"；
  - ③ Dk 的值来自 `initial_state` 的最后一根轴，而 infershape 刻意没有去 `query` 读 `Dk`（避免引入跨张量的一致性假设：若用户给的 state 最后一维不等于 Dk，硬编码路径会静默产出错误形状，照抄路径则至少保持"进出一致"这一 kernel 真实依赖的行为）。

- L72 `return ge::GRAPH_SUCCESS;`：单行返回，两个输出都产出后才返回成功码。


## 12. infershape.cpp:74-81 — InferDataType：谁跟谁走

锚点：chunk_gated_delta_rule_infershape.cpp:74-81

```cpp
uint32_t ChunkGatedDeltaRuleInferDataType(InferDataTypeContext *context) {
  context->SetOutputDataType(kOutShapeIndex, context->GetInputDataType(kQueryInput));
  context->SetOutputDataType(kFinalStateOutIndex, context->GetInputDataType(kInitialStateInput));
  return ge::GRAPH_SUCCESS;
}
}  // namespace
```


- L75 第二个回调：注意它**没有 `static`**（与 L38 不一致），在匿名 namespace 里等价，纯风格漂移；参数类型换成 `InferDataTypeContext`（L18 的 include 就为它）。
- L76 **out 跟 query 走**：out 的 dtype 语义是"query 侧的注意力结果"，而 kernel 里 `attnOutGm_` 绑定为 `__gm__ outType*`，模板实例化用的 `outType = half`（03 篇 kernel.cpp:33）。选择跟随 query 而不是写死 `DT_FLOAT16`，好处是接口对"未来出现 bf16 输入"保持自洽（def.cpp 的候选集合仍会把非 FP16 挡在门外，但类型推导不需要第二处真值）。它同时表达了一条正确性事实：**out 的类型与 value 无关**，即使某天真实现里 out 由 value 侧的累加产生，这条也得重新审视——现在的答案由 `Cast(chunkAttnOutFp32) → outLocal` 的模板参数决定。
- L77 **final_state 跟 initial_state 走**：state 是**回灌型**张量（这一轮的输出 = 下一轮的输入），它的类型必须与输入闭合，否则自回归第二轮就类型不匹配。跟着 initial_state 而不是 query，是把"闭环"这件事交给推导函数而不是靠用户自觉。
- L78 `return ge::GRAPH_SUCCESS;`：单行返回，本函数没有可失败分支（两个句柄都假定非空）。

## 13. infershape.cpp:82-84 — IMPL_OP_INFERSHAPE 与 def.cpp 类名的绑定关系

锚点：chunk_gated_delta_rule_infershape.cpp:82-84

```cpp
IMPL_OP_INFERSHAPE(ChunkGatedDeltaRule)
  .InferShape(ChunkGatedDeltaRuleInferShape)
  .InferDataType(ChunkGatedDeltaRuleInferDataType);
```

- L82 `IMPL_OP_INFERSHAPE(ChunkGatedDeltaRule)`：宏把类名**反串化**成字符串 `"ChunkGatedDeltaRule"`，去 op-def 注册表里找 def.cpp:L82 那条记录，并返回一个可链式的 `Impl` 代理对象。它与 `OP_ADD` 的关系是"注册 vs 挂回调"：前者建立条目，后者填字段。二者**不在同一个 .so**（op_proto vs op_tiling），所以这是纯字符串契约——`ChunkGatedDeltaRule` 拼错、或 def.cpp 改了类名而这里没改，编译与链接都不会报错，故障表现为运行时该算子没有 shape 推导。
- L83 `.InferShape(...)`：把 L38 的函数指针写进条目；这里引用的是匿名 namespace 内的符号，**同 TU 可见**，因此 infershape 实现必须与注册宏在同一个 .cpp（拆分会立刻编译失败，这也是它不像 def 那样分层的理由）。
- L84 `.InferDataType(...);`：第二个回调挂上去并收尾分号。注意末尾的 `;` 是整条语句（宏 + 两次链式调用）的终止符，不是宏的一部分。

tiling 侧是同一机制的第二个实例：`IMPL_OP_OPTILING(ChunkGatedDeltaRule).Tiling(ChunkGatedDeltaRuleTilingFunc, sizeof(ChunkGatedDeltaRuleTilingData));`（tiling.cpp:295）。`sizeof` 作为第二个实参**把 §14-§16 那个结构体的宽度注册给框架**，框架据此分配 tiling 缓冲区并把字节流送到 device 的 `tilingGM` —— 这正是"两端字节必须一致"的机制根源。

## 14. tiling.h:1-21 — 许可证头、include guard 与唯一 include

锚点：chunk_gated_delta_rule_tiling.h:1-21

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

- L17-18 `#ifndef`/`#define`：传统 include guard（不用 `#pragma once`，是为了和 kernel 侧的 `#ifndef ..._TILING_DATA_H` 保持同风格，且 guard 名在 diff 里可检索）。与 L50 的 `#endif` 配对。

- L20 `#include <cstdint>`：**只用标准库**，提供 `uint32_t/int64_t` 等定宽类型。这里刻意**不能**依赖 `int`/`long` 这类宽度随平台变化的类型（LP64 host 与 device 侧含义不同），定宽类型是二进制协议的前提。


## 15. tiling.h:22-30 — 三条约束的实际含义，与 align/pack/alignas 为什么三个一起写

锚点：chunk_gated_delta_rule_tiling.h:22-30

```cpp
// ChunkGatedDeltaRuleTilingData MUST stay global (mirror of the kernel-side
// chunk_gated_delta_rule_tiling_data.h): the two structs must be byte-identical
// and the CANN tiling macros require a global struct. The byte stream the host
// writes here is read by the device via GET_TILING_DATA.
// kTilingDataAlign mirrors the device-side constant; both #pragma pack and
// alignas must use the same value.
constexpr int kTilingDataAlign = 8;
#pragma pack(push, 8)
struct alignas(kTilingDataAlign) ChunkGatedDeltaRuleTilingData {
```

三条约束的实际含义（L22-25 注释，逐句拆）：

1. **MUST stay global（必须留在全局命名空间）**：不是风格偏好，是**编译能不能过**的问题。`REGISTER_TILING_DEFAULT(ChunkGatedDeltaRuleTilingData)` 与 `GET_TILING_DATA(tilingData, tilingGM)` 是 autogen 宏，展开时会生成一个类型名叫 `chunk_gated_delta_rule_0_tilingkey` 之类的中间符号，并用**裸类型名**去引用本结构体。若展开点处在某个 `namespace cgdr {}` 内，生成物会变成 `cgdr::ChunkGatedDeltaRuleTilingData`、`cgdr::chunk_gated_delta_rule_0_tilingkey`，而另一半生成物在全局作用域找这些符号 → 解析失败、device kernel 编译中断（kernel 侧 tiling_data.h:22-27 记录了同一件事的完整错误信息）。所以 host 侧也必须留在全局，两侧才对称。
2. **两端字节一致（byte-identical）**：传输的是**没有字段名、没有类型标签的原始字节流**。host 侧 `IMPL_OP_OPTILING(..., sizeof(...))` 声明宽度、`FillTilingData` 按字段写；device 侧 `GET_TILING_DATA` 用**自己那份结构体定义**做 memcpy/字段读取。任何一侧改字段顺序、换类型宽度、加 `bool`（1 字节）都会让后续所有字段的偏移集体位移——编译器完全看不出来，症状是 kernel 读到莫名其妙的巨大 `vStep` 或 UB 越界。
3. **CANN tiling 宏要求**：宏的生成代码里带 `REGISTER_TILING_DEFAULT` 的类型依赖，且 tiling 缓冲区按 8 字节对齐处理；把结构体塞进 namespace 或让它带非 POD 成员（构造/析构、虚函数、引用成员）都会让 autogen 的 `CopyTilingData`/位流解析失效。本结构体因此被约束成**纯标量 POD**。

L26-27 的注释把"两个常量必须同值"说清后：

- L28 `constexpr int kTilingDataAlign = 8;`：**命名空间作用域的 constexpr 变量具有内部链接**，所以这个常量在"每个包含它的 TU"里各有一份，不会跨 .so 冲突；这也是它能同时被 host 与 device 两侧复制式定义的原因（device 侧 tiling_data.h:30 是**同名同值的另一份**）。
- L29 `#pragma pack(push, 8)`：以 8 字节为上限设置成员对齐，并在 L48 `pack(pop)` 处恢复现场（`push/pop` 成对是硬性要求，避免污染后续头文件）。
- L30 `struct alignas(8) ...`：**结构体自身的对齐要求**。

三者为什么必须同时出现：`#pragma pack(8)` 管的是"成员之间最多插多少 padding"，它**不改变 sizeof 向上取整到结构体对齐值**这件事；`alignas(8)` 管的是"这个结构体作为对象时的对齐要求"，它决定 `sizeof` 的尾部补齐、也决定它在数组/缓冲区里起址必须 8 字节对齐。C++ 默认规则下本结构体全是 4 字节成员，`alignof` 只有 4，`sizeof` 也就是 56——与 `#pragma pack(push,8)` 单独写出来的结果**恰好相同**，所以两者看起来"冗余"。真实动机是：

- ① device 侧 runtime 以 8 字节粒度搬运 tiling 区（CANN tiling 宏假设的打包粒度），只有 `alignas(8)` 才把"本对象地址 8 对齐"写进类型系统，让编译器在任意容器里都保持该性质；
- ② 两侧必须用**同一套**规则，任何一侧只写一半（例如只写 pack 不写 alignas），将来加一个 `uint64_t` 字段就会让两侧 `sizeof` 分叉（pack 8 时插 4 字节尾 padding 与不插的区别），而这类分叉没有编译期报错。常量 `kTilingDataAlign` 被 `pack` 之外的 `alignas` 引用，是把"同一个数字写一处"的最后一步（`#pragma pack` 不接受变量，只能靠注释约束）。

## 16. tiling.h:31-46 — 16 个字段逐个：类型、偏移、写者、读者

锚点：chunk_gated_delta_rule_tiling.h:31-46

```cpp
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
```

第 30 行的结构体头已在 §15 出现（L30 与其配对），L31-46 是 16 个字段声明。写者一律是 `FillTilingData`（tiling.cpp:192-211，见 02 篇 §9）；读者一律是 kernel 构造函数 `ChunkGatedDeltaRule`（kernel.h:75-99）。偏移按"全 4 字节成员 + pack(8)"逐项累加，无插入 padding：

| 行 | 字段 | 类型 | 偏移 | 含义 | 写者（tiling.cpp） | kernel 读者 / 用途 |
|---|---|---|---|---|---|---|
| 31 | `vectorCoreNum` | uint32_t | 0 | AIV 可调度核数 | :195 ← `GetPlatformInfo` 的 `aivNum` | **本 commit 无读者**（仅 `LogTiling` 间接体现）。同一字段在 !1140 RGDR 的 kernel 里才被真正消费（`recurrent_gated_delta_rule.h:177` 用它算 workBlockDim），可视为作者为下一步预留的载荷 |
| 32 | `ubCalSize` | uint32_t | 4 | 单核 UB 字节数 | :196 ← `ubSize` 窄化 | **无读者**；与 `ubRestBytes` 成对，用于事后核对"UB 总量 - 队列 = tmpBuff 预算"这笔账 |
| 33 | `ubRestBytes` | uint32_t | 8 | tmpBuff 可用字节 | :197 ← `SolveVStep` 的 `restBytes = ubSize - outQueueMax` | :87→`restUbSize_`，:153 `pipe_->InitBuffer(tmpBuff, restUbSize_)`——**device 唯一的 UB 大缓冲尺寸来源** |
| 34 | `t` | uint32_t | 12 | 打包总序列长 | :198 ← `dims.t`（**未含 pad**，注释里的 "(padded)" 与 host 实际写入值不符，见下） | :77→`T_`，但 `T_` 在本 kernel 中只被赋值不被读；真实长度由 `Process` 遍历 `actualSeqLengths` 现算 |
| 35 | `hqk` | uint32_t | 16 | Q/K 头数 | :199 | :78→`NK_`，用于 GQA 映射 `qkHead = head_i / (NV_/NK_)` |
| 36 | `dk` | uint32_t | 20 | K 头维 | :200 | :79→`realK_`；派生 `alignK_`(=ceil(dk,16)*16, :88) 与 `stateStrideK_`(=ceil(dk,8)*8, :89) |
| 37 | `hv` | uint32_t | 24 | V 头数 | :201 | :80→`NV_`，head 循环上界与 `ShouldSplitVTiles` 的比较量 |
| 38 | `dv` | uint32_t | 28 | V 头维 | :202 | :81→`realV_`；派生 `stateWorkspaceStrideV_`(:90)，并决定 `vTileCount` |
| 39 | `chunkSize` | uint32_t | 32 | chunk 长度（64） | :203 ← `kDefaultChunkSize` | :83→`chunkSize_`→`InitLocalBuffers` 里的 `cs`，**UB 布局算术的乘子** |
| 40 | `numChunks` | uint32_t | 36 | 全局 chunk 数 | :204 ← `(t+padSize)/chunkSize` | :84→`numChunks_`，但 device 侧按**本 batch 真实长度**重算 chunk 数，`numChunks_` 实际未被使用 |
| 41 | `b` | uint32_t | 40 | batch 数 | :205 ← `dims.batch`（来自 `initial_state.dim0`） | :76→`B_`，`Process`/`ComputeAvgload` 的外层循环上界 |
| 42 | `padSize` | uint32_t | 44 | T 补到 chunkSize 倍数的补量 | :206 | **无读者**（kernel 用 chunkLen 收缩代替显式 pad 长度） |
| 43 | `hasGamma` | uint32_t | 48 | 可选输入 g 是否存在 | :207 ← `HasGamma(context)` 的三句柄与判定，`? 1 : 0` | :85→`hasGamma_`；kernel.h:119 用它决定是否 `gGm_.SetGlobalBuffer`，装载路径据此走"g 恒 0" |
| 44 | `scaleValue` | **float** | 52 | 1/√dk 之类的注意力缩放 | :208 ← attr `scale_value` | :82→`scale_`（`Muls(chunkAttnOutFp32, ..., scale_, ...)` 一类标量乘） |
| 45 | `vStep` | uint32_t | 56 | V 维 tile 宽度 | :209 ← `SolveVStep` 搜到的最大可行值 | :86→`vStep_`：UB 布局的 `avStepAligned`、`vTileCount`、`ShouldSplitVTiles` 全依赖它，是**整个切分决策的唯一出口** |
| 46 | `debug` | uint32_t | 60 | 调试打印开关 | :210 **恒写 0** | **无读者**（kernel 里的 printf 分支预留位） |

`sizeof` = 16 × 4B = 64 B，恰好是 `kTilingDataAlign` 的整数倍 ⇒ `alignas(8)` 不产生尾部 padding，64 B 也是两个 32B DMA block。这个"刚好整除"是 16 这个数字的意义：**加一个字段就变成 68 → 72，尾部凭空多 4 字节空洞**，而两侧必须同时改。

为什么全用 `uint32_t`，不用 `uint16_t` 也不用 `int64_t`：

- 不用 uint16_t：
  - ① `t`/`numChunks`/`vStep`/`dk` 都可能超过 65535 吗？`t` 会（多 batch 长序列拼接），`dk/dv` 不会但 `vStep` 派生自 `dv`；一个字段需要 32 位，为它单独引入混宽布局就破坏了上面"sizeof 恰好 64、零 padding"的整齐性；
  - ② 更关键的是 pack(8) 下混用 16/32 位成员会引入**对齐空洞**，字节流偏移变成需要精算的东西，两侧一致性维护成本陡增；
  - ③ device 侧读 16 位 tiling 字段要经过符号/零扩展指令，AI Core 标量单元的原生宽度是 32 位，`uint32_t` 是**一次 load 到位**的最省事选择。
- 不用 int64_t：
  - ① 这些量全都在 32 位内（UB < 4 GiB，头数/维长 < 65536，`t` 远小于 2^31），没有 64 位需求；
  - ② AI Core 标量单元做 64 位算术要用两条 32 位指令模拟，构造函数里这些字段会被用于乘除（`Ceil(dk,16)*16` 等），32 位明显更快；
  - ③ `sizeof` 会翻倍到 128 并引入对齐空洞；
  - ④ 真正需要 64 位的只有**GM 偏移**（`t_start * NV_ * realV_` 之类），kernel 是在使用处用 `static_cast<uint64_t>` 现场升宽（见 03 篇各偏移计算），而不是在协议里就带 64 位——这是一个明确的分层决定：协议窄、算术后扩。

`float scaleValue` 的特殊性：全结构体**唯一的非整数成员**，位置在 13 个 uint32 之后（偏移 52）。它的存在说明三件事：

- ① tiling 字节流里 float 与 uint32 都是 4 字节，位移不会变，但 device 侧读它得到的是 IEEE-754 位模式，**任何"把它当整数比大小"的代码都是 bug**；





- ② 它是**唯一直接参与 FP32 算术**的协议字段（其余字段全是计数/宽度），所以它的精度不由 tiling 决定而由 attr 决定——def.cpp L69 用 `Float(1.0)` 而非 `Int`，两侧类型必须一致（tiling.cpp 用 `GetAttrPointer<float>(0)` 取）；
- ③ 放在 hasGamma 之后、vStep 之前，是"标量参数聚在尾部"的书写习惯。

`uint32_t debug` 的特殊性：它**不是计算参数而是运行期旋钮**。`FillTilingData` 里无条件写 0（tiling.cpp:210），没有任何 shape/attr 能把它变成 1，所以在本 commit 里它是一个"结构体宽度的凑数字段"。它的价值在于协议层：device 侧昂贵的逐元素打印（`SetValue`/`printf`）若写成编译期常量分支，调试时就得重编 vendor（蓝区一次 3~5 分钟，见 PLAN 复现流程）；留一个 tiling 字段，调试期只改 `FillTilingData` 一行重编 `liboptiling.so` 即可（tiling 是 CPU 侧 .so，比 kernel 编译快一个量级）。用 `uint32_t` 而不是 `bool`，正是上面"混宽引入对齐空洞"的同一条理由。

## 17. tiling.h:47-50 — 结构体闭合、pack 恢复与 guard 收尾

锚点：chunk_gated_delta_rule_tiling.h:47-50

```cpp
};
#pragma pack(pop)

#endif  // CHUNK_GATED_DELTA_RULE_TILING_H
```


- L48 `#pragma pack(pop)`：与 L29 的 `push` 配对，把对齐状态还原。**没有它，本头之后的所有 include/结构体都会带上 pack(8)**——在 op_tiling 这种会把十几个算子头文件串起来的 TU 里，这是最容易扩散的污染。

- L50 `#endif  // CHUNK_GATED_DELTA_RULE_TILING_H`：与 L17 配对，注释标明配对的宏名（仓库风格，与 def.cpp L83 同源）。

本篇不写、但值得注意的一条：host 侧这份头文件的名字是 `..._TILING_H`，device 侧那份是 `..._TILING_DATA_H`（tiling_data.h），**两个 guard 不同名、且定义同名结构体与同名 `kTilingDataAlign`**。这意味着任何一个 TU 同时 include 两者就会重定义报错——这正是"协议只能靠复制维护"的实证：作者宁可写两份，也无法把它们放进同一个编译单元。

