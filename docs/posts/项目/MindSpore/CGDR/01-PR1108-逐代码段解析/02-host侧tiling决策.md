

先行结论四条：

1. 这个文件的**唯一产出**是三样东西：64 字节的 tiling 结构体、`SetBlockDim` 的核数、`ws[0]` 的 workspace 字节数。所有中间函数都是在解一个约束问题：**"在单核 UB 装得下的前提下，V 维 tile 尽量大"**（`SolveVStep`），以及 **"在工作项数与核数之间取 min"**（`blockDim`）。
2. `ComputeTmpBuffBytes` 不是"估算"，而是与 kernel 侧 `InitLocalBuffers` 逐字段对齐的**同一套记账**（03b 篇 §1-§3）。它的返回值决定 `ubRestBytes`，写错一个字节的公式，症状是 device 侧 UB 越界或 `InitBuffer` 失败，而不是编译错误。
3. UB 记账里有一组 **与 vStep 无关的固定项**（K 侧两块 + decayMask + 两条 cs 向量 + dotProduct），本 commit 的 shape 下是 82944 B；`SolveVStep` 的搜索本质上是"用剩下的预算去养 V 侧缓冲"。固定项若已超预算，函数直接返回 false → `GRAPH_FAILED`，这就是"某些 dk/chunk 组合在 310P 上根本不出二进制"的判据。
4. `allowScoresStateOverlap = dims.hv < aivNum` 是一条**关于并行度的物理判断**：只有当"每个核一辈子只碰一个 V-tile"成立时，注意力矩阵才可以和 state tile 共用同一段内存。docs/PR-1135/10 记录了后续 !1135 把它改成无条件 true——因为那时 V-tile 成了独立工作单元。

## 1. tiling.cpp:1-16 — 许可证头与其后空行

锚点：chunk_gated_delta_rule_tiling.cpp:1-16

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

L1-L15 与本目录 01 篇 §1 引用的 def.cpp 许可证头**逐字节相同**（`diff` 已验证）：L1/L15 是块注释定界，L2 是 2026 华为版权行，L4-L8 是 Apache-2.0 适用声明与条款获取地址，L10-L12 是 "AS IS" 无担保免责段，L13-L14 把权限与限制细节导回条款正文，L3/L7/L9 为条款排版空行；逐行解释以 01 篇 §1 为准。L16 是许可证块与 include 段之间的排版空行。

## 2. tiling.cpp:17-26 — 三个 include、两个 using 与一条"为什么不需要 using"的注释

锚点：chunk_gated_delta_rule_tiling.cpp:17-26

```cpp
#include "register/op_def_registry.h"
#include "tiling/platform/platform_ascendc.h"
#include "chunk_gated_delta_rule_tiling.h"  // NOLINT(build/include_subdir)

using namespace ge;    // NOLINT(build/namespaces)
using namespace gert;  // NOLINT(build/namespaces)

// ChunkGatedDeltaRuleTilingData is global (see chunk_gated_delta_rule_tiling.h),
// so no using-declaration is needed here.
```

- L17 `register/op_def_registry.h`：提供 `TilingContext`、`GRAPH_SUCCESS/GRAPH_FAILED` 以及文件末尾的 `IMPL_OP_OPTILING` 绑定宏。
- L18 `tiling/platform/platform_ascendc.h`：提供 `platform_ascendc::PlatformAscendC`——**这是本文件唯一"侦察真实硬件"的入口**（L67-84），拿不到它就会退化成硬编码核数/UB，也就没有 `SolveVStep` 的可移植性。
- L19 `chunk_gated_delta_rule_tiling.h`：01 篇 §14-§17 的那份 64 字节协议；尾部的 `// NOLINT(build/include_subdir)` 是 cpplint 抑制标记（同一目录下的引号 include 被 lint 规则误判为"应写成子目录路径"）。**注意这个 include 的存在本身**：host 编译 tiling 时用的结构体定义与 device 编译时用的是两个文件里的两份拷贝，而不是同一份头文件。

- L21 `using namespace ge;`：给 `GRAPH_*` 返回码与 `ge::` 类型松绑；但 L232/L237 等处直接写裸 `GRAPH_FAILED`，说明这条 using 在这里是**真正被使用的**（与 infershape.cpp 里"用了 using 却仍写 `ge::` 全限定"形成对照）。
- L22 `using namespace gert;`：给 `TilingContext` 省名。

- L24-25 注释：把"结构体在全局命名空间"这条硬约束在**第三个文件**里重复声明一遍。不是冗余——它是防御性的：01 篇 §15 记录的 autogen 命名空间坑一旦有人手滑加 `namespace cgdr {}`，注释就是他最先看到的路障。


## 3. tiling.cpp:27-54 — 常量块与两个对齐工具函数

锚点：chunk_gated_delta_rule_tiling.cpp:27-54

```cpp
namespace {

constexpr uint32_t FP16_NUM_PER_BLOCK = 16;
constexpr uint32_t FP32_NUM_PER_BLOCK = 8;
// Chunk size is an internal implementation detail, matching the 910B operator.
constexpr uint32_t kDefaultChunkSize = 64;
// Axis index of the head-dim within the [T, H, D] query/value layouts.
constexpr int32_t kHeadDimAxis = 2;
// chunkKFp32 & kCumdecayFp32 (and chunkVFp32 & chunkAttnOutFp32) each share the
// same layout, so their byte cost is counted twice when sizing tmpBuff.
constexpr uint32_t kPairedTileCount = 2;
// Fixed workspace size requested for the op (32 MiB).
constexpr uint64_t kWorkspaceBytes = 32ULL * 1024 * 1024;
// Input indices for the CGDR operator.
constexpr uint32_t kQueryInput = 0;
constexpr uint32_t kValueInput = 2;
constexpr uint32_t kInitialStateInput = 4;
constexpr uint32_t kGammaInput = 6;
// Shape dimension indices within the [T, H, D] layout.
constexpr uint32_t kDimT = 0;
constexpr uint32_t kDimH = 1;
// Minimum block dimension for AIV core dispatch.
constexpr uint32_t kMinBlockDim = 1;
// Number of workspace slots requested from the runtime.
constexpr uint32_t kWorkspaceCount = 1;

uint32_t CeilAlign(uint32_t val, uint32_t align) { return (val + align - 1) / align * align; }
uint32_t DivCeil(uint32_t val, uint32_t divisor) { return (val + divisor - 1) / divisor; }
```

- L27 `namespace {`：匿名 namespace ⇒ 内部链接。本文件 12 个 helper 全是自由函数，锁在内部才不会和 `liboptiling.so` 里其它算子的 tiling helper 撞名（尤其 `ParseShapeDims`/`LogTiling` 这类通用名）。
- **L29-30 `FP16_NUM_PER_BLOCK = 16` / `FP32_NUM_PER_BLOCK = 8`**：这两个数是 **32 字节 DMA block 的元素数**——MTE2/MTE3 只能以 32B 为最小粒度搬运，`32/2 = 16` 个 half、`32/4 = 8` 个 float。它们与 kernel 侧 chunk_gated_delta_rule.h:35-36 的同名常量是**两份独立拷贝**，含义必须一致：host 用它们算缓冲宽度，device 用它们做同样的算术。凡是被这两块除不尽的行宽，DMA 快路径就不可用，kernel 侧会退化到标量逐元素搬运。
- **L31-32 `kDefaultChunkSize = 64`**：chunk 长度硬编码，注释说明"与 910B 算子对齐"。它不是 attr，因此**用户不可调**；64 的选值同时决定了 `decayMaskFp32`/`chunkScoresFp32` 的 `cs*cs` 面积（4096 元素）和递推修正的 `O(cs²)` 项——调大会让 UB 记账爆掉，调小会让 chunk 数与 state 往返次数线性增加。
- **L33-34 `kHeadDimAxis = 2`**：`int32_t`，与 01 篇 §8 讲的同一件事——`Shape::GetDim` 的 axis 形参是有符号 int32（可用负数表示倒数轴）。它在这里只被 `ParseShapeDims` 用来取 `dk`/`dv`。
- **L35-37 `kPairedTileCount = 2`**：两条注释精确说明了它的用途——`chunkKFp32`+`kCumdecayFp32` 同布局（`cs*alignK`），`chunkVFp32`+`chunkAttnOutFp32` 同布局（`cs*avStepAligned`），各是"一对"，所以字节数各乘 2。**为什么必须乘 2**：这对兄弟不是生命周期错开，而是**同时存活**——一个装原始数据（K/V 的原值），一个装变换结果（k_cumdecay / attn 输出），计算过程要同时读两边。把 `kPairedTileCount` 写成变量而不是在表达式里写死 2，是为了让"这里乘的是配对数"这个语义在乘法里显式出现。
- **L38-39 `kWorkspaceBytes = 32ULL * 1024 * 1024`**：`uint64_t` + `ULL` 字面量，避免 `32*1024*1024` 在 int 里算（虽未溢出但会触发 lint 与移植隐患）。这是 workspace 的**下限**（L289 取 max），语义与理由见 §16。
- **L40-44 输入索引 0/2/4/6**：`kQueryInput=0`、`kValueInput=2`、`kInitialStateInput=4`、`kGammaInput=6`，全部是 def.cpp 里 `Input(...)` 的**书写顺序位置**（query0 key1 value2 beta3 initial_state4 actual_seq_lengths5 g6）。与 infershape.cpp 的那一份相比，这里多了 `kGammaInput`：只有 tiling 需要知道"可选的 g 到底给没给"（L119 `HasGamma`），因为答案要经 `hasGamma` 字段传到 device 决定装载路径；形状推导阶段 g 是否存在不影响任何输出。
- **L45-47 `kDimT=0`/`kDimH=1`**：`[T,H,D]` 的前两根轴。注意这里**没有** `kDimB`——batch 是从 `initial_state` 的第 0 轴取的（L102 `dims.batch = stateDims.GetDim(kDimT)`），复用 `kDimT` 这个常量来表达"state 的第 0 维就是 B"，是刻意的"少一个常量"而不是笔误。
- **L48-49 `kMinBlockDim = 1`**：它在全文件只出现一次（L277），唯一职能是**兜住 `blockDim == 0`**：当 `aivNum` 被平台报成 0（`GetCoreNumAiv()` 与 `GetCoreNum()` 都返回 0，见 §5）或 `dims.hv == 0` 时，L275 的 min 会给出 0，而 `SetBlockDim(0)` 是非法启动参数。这一行常量是"零核也能退化成一核串行"的保险丝。
- **L50-51 `kWorkspaceCount = 1`**：向 runtime 申请的 workspace **槽位数**（不是字节数），L284 `GetWorkspaceSizes(1)` 拿到的 `ws` 是指向槽位数组的指针，`ws[0]` 才是字节。用常量而不是直接写 1，是为了让"本算子只用一段 workspace"这件事有一个可搜索的名字——后续 PR 若要把 raw matmul 的暂存段也挂到 workspace（!1135 确实这么做了，见 docs/PR-1135/01 §workspace 加 `kRawMatmulStageBytesPerCore`），改的就是这个计数。

- **L53 `CeilAlign(val, align)`**：`(val + align - 1) / align * align`，标准"上取整到 align 的倍数"。两处风险已知且都可接受：`val + align - 1` 在 `val` 接近 `UINT32_MAX` 时会溢出（本文件的 val 是维度与字节数，量级 ≤ MiB）；`align` 必须是 2 的幂或至少非零——调用点只传 8 和 16，恒成立。
- **L54 `DivCeil(val, divisor)`**：同一个分子、少一次乘法，即"商向上取整"。与 L53 成对出现，是因为文件里两类需求都有：字节宽度要**对齐后的值**（喂给 `*sizeof`），而 tile 数量要**向上取整的商**（L271 `vTileCount`）。

## 4. tiling.cpp:55-64 — struct ShapeDims：六个维度的收敛点

锚点：chunk_gated_delta_rule_tiling.cpp:55-64

```cpp
// Collected query/value shape dimensions used across the tiling helpers.
struct ShapeDims {
  uint32_t t;      // total sequence length
  uint32_t hqk;    // number of q/k heads
  uint32_t dk;     // key head dim
  uint32_t hv;     // number of value heads
  uint32_t dv;     // value head dim
  uint32_t batch;  // batch size from initial_state
};
```


- L56 注释：说明这个结构体的定位是"跨 helper 复用的维度集合"——即"一次解析、多处使用"，避免每个 helper 各自去 `GetInputShape` 三遍（那会把空指针检查复制四遍）。
- L57 `struct ShapeDims {`：**它不出现在 tiling 字节流里**，纯 host 侧临时容器；这与 01 篇 §16 那个必须两端一致的 `ChunkGatedDeltaRuleTilingData` 形成对照，也是本文件里两个"结构体"的不同命运。
- L58-63 六个 `uint32_t` 字段：`t` 打包总序列长、`hqk` Q/K 头数、`dk` K 头维、`hv` V 头数、`dv` V 头维、`batch` 批大小。全部选 `uint32_t` 而不是 `int64_t`：
  - ① 它们最终要写进 tiling 结构体的 32 位字段，提前窄化可以让"值超出 32 位"在解析这一步就暴露；
  - ② 后续算术（`cs * alignK * sizeof(float)`）全是 `uint32_t` 域，混进 int64 会让 L132-145 的每个乘积都变成 64 位，反而需要在 L146 求和时再窄化。**`t` 这里是"未 pad"的真实值**，pad 只在 L246-247 派生 `padSize`/`numChunks`。


## 5. tiling.cpp:65-84 — GetPlatformInfo：核数与 UB 的侦察，以及 310P 的 GetCoreNum 坑

锚点：chunk_gated_delta_rule_tiling.cpp:65-84

```cpp
// Query the platform for the AIV core count and UB size. Returns false on any null handle.
bool GetPlatformInfo(TilingContext *context, uint32_t &aivNum, int64_t &ubSize) {
  if (context == nullptr) {
    return false;
  }
  auto platformInfo = context->GetPlatformInfo();
  if (platformInfo == nullptr) {
    return false;
  }
  platform_ascendc::PlatformAscendC platform(platformInfo);
  aivNum = platform.GetCoreNumAiv();
  if (aivNum == 0) {
    aivNum = platform.GetCoreNum();
  }
  uint64_t ubSize64 = 0;
  platform.GetCoreMemSize(platform_ascendc::CoreMemType::UB, ubSize64);
  ubSize = static_cast<int64_t>(ubSize64);
  return true;
}
```

- L66 注释点出契约：出参用引用带回，返回值只表示"成功/失败"，失败条件写全（任一空句柄）。
- L67 函数签名：`TilingContext*` + 两个**非 const 引用**出参。出参而非返回值带数据，是因为 `bool` 已被"成功与否"占用；这也是本文件所有 helper 的统一风格（`ParseShapeDims`/`ParseAttrs`/`SolveVStep` 同）。
- L68-70 检查 `context` 本身为空 → false。`ChunkGatedDeltaRuleTilingFunc` 被框架调用时理论上不会传空，但 L231 的调用点位于解析任何形状之前，所以这道检查必须是**函数内第一句**（否则 L71 的 `context->GetPlatformInfo()` 先崩）。
- L71-74 `GetPlatformInfo()` 返回的 `platformInfo` 句柄可空：这对应"编译期平台信息未注入"（如在没有 device 的纯 CPU 图编译环境、或在 tiling 单测里直接构造 context）。此时无法得知核数与 UB，**任何切分决策都失去依据**，只能整体失败——比"猜一个核数"好，因为猜错会让 blockDim 超过真实核数、kernel 里 `blockIdx_ >= blockDim` 之外的核拿不到数据。
- L75 `platform_ascendc::PlatformAscendC platform(platformInfo);`：把裸句柄包成 CANN 的平台信息门面对象（栈对象，构造即解析，无堆分配）。
- L76 **`aivNum = platform.GetCoreNumAiv();`**：优先取 **AIV（vector 核）计数**。本 kernel 是 `KERNEL_TYPE_AIV_ONLY`，可调度的并行单位就是 AIV，`SetBlockDim` 的上限也只能是它。
- L77-79 **`if (aivNum == 0) aivNum = platform.GetCoreNum();`**：这是**310P 上最容易踩的一坑的正面处理**。`GetCoreNum()` 返回的是"核的总数"这一笼统口径，在 310P 上它给出的是**逻辑 vector lane 数**而非可调度的 AIV 数（蓝区实测记录：`GetCoreNum()` = 32、`GetCoreNumAiv()` = 8，见 docs/PR-1140-96ea3f55/10 §核数侦察的坑）。
  - 把 32 当成 blockDim 会怎样？`SetBlockDim(32)` 超出实际可调度 AIV 数，轻则 L275 的 min 算出过大的 blockDim 导致**工作项被分到根本不会启动的核上**（表现为输出部分未写、结果错），重则框架直接拒绝下发。所以**顺序必须是 AIV 优先、`GetCoreNum` 只作 fallback**，且 fallback 的触发条件是"返回 0"（该 API 在这颗 SoC 上没实现/没填），而不是"觉得它更保险"。
- L80-81 `uint64_t ubSize64 = 0;` + `GetCoreMemSize(CoreMemType::UB, ubSize64)`：UB 容量走的是**出参引用**式 API，返回值（错误码）被忽略——这是本文件里一处**可读到的软弱性**：如果查询失败，`ubSize64` 保持初值 0，于是 `SolveVStep` 在 L164 的 `ubSize <= 0` 上直接返回 false，最终以 `GRAPH_FAILED` 收场。也就是说错误码被丢弃但**故障仍会向上传播**，这是"以保守失败代替显式错误处理"的取舍，代价是日志里看不到"是 UB 查询失败"这个具体原因（要定位就得看 `LogTiling`，但那时已经 return false 了，见 §13）。
- L82 `ubSize = static_cast<int64_t>(ubSize64);`：转成 `int64_t` 而不是 `uint32_t`/`uint64_t`，是为了让 L164 的 `ubSize <= 0` 与 L187 的 `ubSize > (int64_t)outQueueMax` 这两处**有符号比较**写得出来。如果统一用无符号，`<= 0` 就等价于 `== 0`，而"0 以外的负值"这种错误形态也无法表达。
- L83 `return true;`：单行返回，两个出参都已填。
## 6. tiling.cpp:85-104 — ParseShapeDims：六个维度从哪根轴来

锚点：chunk_gated_delta_rule_tiling.cpp:85-104

```cpp
// Extract the [T, Hqk, Dk] query and [*, Hv, Dv] value dims. Returns false on a null shape handle.
bool ParseShapeDims(TilingContext *context, ShapeDims &dims) {
  auto queryShape = context->GetInputShape(kQueryInput);
  auto valueShape = context->GetInputShape(kValueInput);
  auto initialStateShape = context->GetInputShape(kInitialStateInput);
  if (queryShape == nullptr || valueShape == nullptr || initialStateShape == nullptr) {
    return false;
  }
  const auto &qDims = queryShape->GetStorageShape();
  const auto &vDims = valueShape->GetStorageShape();
  const auto &stateDims = initialStateShape->GetStorageShape();
  dims.t = qDims.GetDim(kDimT);
  dims.hqk = qDims.GetDim(kDimH);
  dims.dk = qDims.GetDim(kHeadDimAxis);
  dims.hv = vDims.GetDim(kDimH);
  dims.dv = vDims.GetDim(kHeadDimAxis);
  dims.batch = stateDims.GetDim(kDimT);
  return true;
}
```


- L86 注释、L87 签名：风格与 §5 同（一个布尔返回值 + 引用出参）。与 infershape 里**同一批**索引常量（0/2/4）在两个文件各自定义一份，是"改 def.cpp 顺序要同时改两处"的隐性契约（01 篇 §8）。
- L88-93 三个 `GetInputShape` 先全部取出、再用一个 `||` 合并判空。与 infershape 的三段式分开检查（01 篇 §9）**是相反的写法**，差异的合理性在于：本函数后面不区分"谁为空"（六个赋值要么全做要么不做），合并判断少两组 `if`；infershape 那边因为 out 与 final_state 分别依赖不同输入，才需要分开。
- L87 之后不写任何注释直接取形状。注意本函数**不检查 `context` 为空**——它总是紧随 L231 的 `GetPlatformInfo` 之后被调用，那次调用已经验证过 context，所以这里刻意不重复（L235-238 的调用点保证了顺序）。
- L94-96 `GetStorageShape()`（而非 shape 对象本身）：拿到的是**内存布局意义上的维度**（storage shape），对 `FORMAT_ND` 的张量它与逻辑 shape 一致，但对带 padding 的格式（如 NC1HWC0）它是实际排布。本算子只有 ND，选它等于"明确按内存里真实存在的宽度算 UB"，这是 tiling 侧比 infershape 侧更严格的一处口径差别。`const auto &` 绑定是为了避免每取一维都复制一次临时 shape 对象。
- L97-99：`t/hqk/dk` 三个来自 query 的轴 0/1/2 —— 即 `[T, Hqk, Dk]`。
- L100-101：`hv/dv` 来自 value 的轴 1/2 —— 即 `[* , Hv, Dv]`（value 的轴 0 与 query 的轴 0 同为 T，不重复取）。GQA 下 `hv ≥ hqk`，这里**不做一致性校验**（`NeedCheckSupportFlag(false)` 的语义延伸，见 01 篇 §5）：若用户给的比例不是整数倍，出错的是 kernel 里 `nvPerNk = NV_/NK_` 的整除假设，而不是 tiling。
- L102 `dims.batch = stateDims.GetDim(kDimT)`：**复用轴 0 常量取 batch**，因为 `initial_state` 是 `[B, Hv, Dv, Dk]`，第 0 轴就是 B。这是全文件最容易被误读的一行：它不是"把 T 抄过来"，而是"换了个张量取同一条轴"。
- L103 `return true;`：单行返回；
## 7. tiling.cpp:105-117 — ParseAttrs：属性读取与两级兜底

锚点：chunk_gated_delta_rule_tiling.cpp:105-117

```cpp
// Read the optional scale_value attr (idx 0), falling back to the public default.
void ParseAttrs(TilingContext *context, float &scaleValueAttr) {
  scaleValueAttr = 1.0f;
  auto attrs = context->GetAttrs();
  if (attrs == nullptr || attrs->GetAttrNum() == 0) {
    return;
  }
  const float *scalePtr = attrs->GetAttrPointer<float>(0);
  if (scalePtr != nullptr) {
    scaleValueAttr = *scalePtr;
  }
}
```

- L106 注释："读可选属性 scale_value（索引 0），取不到就回落到公共默认值"。
- L107 签名：返回 `void`、出参引用，**并且第一句就赋默认值**（L108）——这种"先赋默认、再条件覆盖、失败即早退"的写法让函数在任何分支下都保证出参合法，不需要调用方再判返回值。调用方 L240 也正是在调用**之前**就把局部量初始化成 `1.0f`（双重兜底）。
- L108 `scaleValueAttr = 1.0f;`：默认值必须与 def.cpp:69 的 `.Float(1.0)` 一致，否则"用户没给 attr"时 host 与框架注册的默认值会产生两套 scale —— 这类"两处真值"的重复是接口默认值的常见 bug 源，这里靠注释 `the public default` 点明关系。
- L109 `auto attrs = context->GetAttrs();`：拿属性集合句柄。
- L110-112 两级兜底的第一级：`attrs == nullptr`（context 没带属性表，例如图裁掉了属性）**或** `GetAttrNum() == 0`（属性表为空，说明框架按"用户未提供且未注入默认"下来到这里）→ 直接 `return`，保持 1.0f。这里的 `||` 顺序不能反（先判空指针再解引用取数量）。
- L113 **`attrs->GetAttrPointer<float>(0)`**：模板实参 `float` 必须与 def 里 `.Float(...)` 声明的类型严格一致（写 `<double>` 会拿到 nullptr 或读错字节），`0` 是属性在注册顺序里的位置（本算子唯一属性）。返回的是**指向属性存储的裸指针**，所以本函数不拷贝、不持有。
- L114-116 第二级兜底：指针非空才 `*scalePtr` 解引用覆盖。若属性声明了但框架未填值，指针为 null，仍是 1.0f。

## 8. tiling.cpp:118-123 — HasGamma：可选输入的三句柄判定

锚点：chunk_gated_delta_rule_tiling.cpp:118-123

```cpp
bool HasGamma(TilingContext *context) {
  return context->GetOptionalInputDesc(kGammaInput) != nullptr &&
         context->GetOptionalInputTensor(kGammaInput) != nullptr &&
         context->GetOptionalInputShape(kGammaInput) != nullptr;
}
```

- L119 签名：无注释的单表达式函数，判定"可选输入 g 到底给没给"。
- L120-122 三个 API 是**三条独立的元数据通道**：desc（编译期输入描述是否占位）、tensor（运行期是否真的绑上了张量）、shape（该张量的形状是否已推出）。任一为空都意味着 device 侧不能安全地 `DataCopy` g。返回 `true` 的充要条件是**三者同时非空**，缺一个就退回"g 恒取 0"的数学退化路径（kernel 里 `hasGamma_ == 0` 分支）。
- 为什么不能只看一个：这是 CANN tiling 里写可选输入的经典陷阱。只查 desc 会在"图里声明了但被常量折叠/裁剪掉"的场合误判为存在，随后 device 解引用一个空 GM 指针；只查 tensor 在 tiling 阶段（张量尚未绑定）永远为假；只查 shape 会在"形状已推、数据没给"时误判为真。docs/PR-406-00e39ab5/03 §2 把这条总结为"必须同时检查 desc、tensor、shape 三个句柄非空，缺一不可"。
- L120 用 `kGammaInput`（6）而非硬编码数字，位置由 def.cpp 的书写顺序唯一决定。

## 9. tiling.cpp:124-148 — ComputeTmpBuffBytes：UB 布局算术逐行展开

锚点：chunk_gated_delta_rule_tiling.cpp:124-148

```cpp
// Total tmpBuff bytes for a candidate vStep. V temporaries are compact tiles.
// With head*V-tile core splitting, each core handles only one tile, so scores
// are dead before that tile loads state and the two buffers may overlap.
uint32_t ComputeTmpBuffBytes(uint32_t vs, uint32_t dv, uint32_t chunkSize, uint32_t dk, uint32_t alignK,
                             bool allowScoresStateOverlap) {
  uint32_t avStepAligned = CeilAlign(vs, FP32_NUM_PER_BLOCK);
  uint32_t cs = chunkSize;
  uint32_t kTileBytes = cs * alignK * sizeof(float);         // chunkKFp32 + kCumdecayFp32
  uint32_t vTileBytes = cs * avStepAligned * sizeof(float);  // chunkVFp32 + chunkAttnOutFp32
  uint32_t tDecay = cs * cs * sizeof(float);                 // decayMaskFp32
  uint32_t tGcum = cs * sizeof(float);                       // gCumsumFp32
  uint32_t stateStrideK = CeilAlign(dk, FP32_NUM_PER_BLOCK);
  uint32_t dotProductElem = (stateStrideK > cs) ? stateStrideK : cs;
  uint32_t deltaElem = (dotProductElem > avStepAligned) ? dotProductElem : avStepAligned;
  uint32_t tDelta = deltaElem * sizeof(float);                     // deltaFp32
  uint32_t tDotProduct = dotProductElem * sizeof(float);           // dotProductFp32
  uint32_t tExpGcum = cs * sizeof(float);                          // expGCumFp32
  uint32_t tScores = cs * cs * sizeof(float);                      // chunkScoresFp32 (attn matrix)
  uint32_t tState = stateStrideK * avStepAligned * sizeof(float);  // stateInFp32 [DK, vStep]
  bool overlapScoresState = vs >= dv || allowScoresStateOverlap;
  uint32_t tScoresState = overlapScoresState ? ((tScores > tState) ? tScores : tState) : (tScores + tState);
  return kPairedTileCount * kTileBytes + tDecay + kPairedTileCount * vTileBytes + tGcum + tDelta + tDotProduct +
         tExpGcum + tScoresState;
}
```

参数与逐行算术（`vs` = 候选 vStep；`cs` = chunkSize；`alignK` 是**FP16 块对齐**的 dk，由调用方 L248 算好传入）：

- L125-127 三条头注释预告了整个函数的核心思想："V 侧临时量是紧凑 tile""在 head×V-tile 分核下每个核只处理一个 tile，所以 scores 在那个 tile 载入 state 之前已经死了，两块缓冲可以重叠"。
- L128-129 签名换行是因为参数已 7 个；`allowScoresStateOverlap` 单独占第二行，强调它是**行为开关**而非尺寸参数。
- L130 `avStepAligned = CeilAlign(vs, 8)`：把候选 vStep 上取整到 **FP32 的 32B block（8 个 float）**。所有 V 侧行宽都用它而不是 `vs`，因为 vStep 是 FP16 粒度（16 的倍数）搜出来的，但缓冲是 FP32，行宽必须是 8 的倍数才能整块 DMA。注意 `CeilAlign(vs, 8)` 在 `vs % 8 == 0` 时是恒等——搜索步长 16 已保证这一点，所以这行更像"把不变量写出来"的防御。
- L131 `cs = chunkSize`：短名，下面 10 行都要 `cs*…`，可读性与行宽的折衷。
- **L132 `kTileBytes = cs * alignK * 4`**：K 侧 tile 的行数是 chunk 长度、列宽是 `alignK`（**FP16 对齐的 dk**，因为 K 以 FP16 DMA 进来后按 fp16 行宽铺成 FP32），一块的成本；`alignK` 而不是 `dk`，因为 kernel 里所有 K 相关寻址都是 `i * alignK_`（03b 篇 §2 的 `chunkKFp32` 装载）。
- **L133 `vTileBytes = cs * avStepAligned * 4`**：V 侧 tile 同构，列宽换成 FP32 对齐的 vStep。
- **L134 `tDecay = cs*cs*4`**：`decayMaskFp32` 是 64×64 的下三角衰减掩码（按满矩形计费，三角性不省内存——它被 `Duplicate`/`Muls` 整块向量化，矩形布局才有对齐语义）。
- **L135 `tGcum = cs*4`**：`gCumsumFp32`，chunk 内 g 的前缀和，一条 64 长向量。
- **L136 `stateStrideK = CeilAlign(dk, 8)`**：state tile 的**行宽**，注意与 L132 的 `alignK`（16 对齐）**不同**：state 从 workspace 以 FP32 载入，行是 `dk` 个 FP32，故按 FP32 块（8）对齐。同一维度的两个"对齐宽度"在两套缓冲里并存，是本文件最精细的一处区分。
- **L137 `dotProductElem = max(stateStrideK, cs)`**：`dotProductFp32` 是点积归约的乘积暂存，一次要装"state 的一行（`stateStrideK`）"或"K 的一行（`cs`）"，取二者最大。手写 `?:` 而不是 `std::max`，是为了不在 tiling 里引 `<algorithm>`（本文件只用标准库的 `<cstdint>`，见 01 篇 §14 与 L17-19）。
- **L138 `deltaElem = max(dotProductElem, avStepAligned)`**：`deltaFp32` 是"最宽的那条临时行"的通用 scratch，因此要再和 V 侧行宽取 max。
- **L139-141** `tDelta/tDotProduct/tExpGcum`：三个标量乘 `sizeof(float)`；`tExpGcum = cs*4` 是预计算 `exp(gCumsum)` 的向量，与 `tGcum` 等宽——**这两个 `cs*4` 就是 L146-147 求和式里为什么出现两次同尺寸项的原因**。
- **L142 `tScores = cs*cs*4`**：`chunkScoresFp32`，chunk 内注意力矩阵，尺寸与 `tDecay` 相同但**是另一块独立内存**（decayMask 要跨 V-tile 反复乘，scores 每 tile 被重算）。
- **L143 `tState = stateStrideK * avStepAligned * 4`**：state tile `[DK, vStep]`，**k 为行、v 为列**（与公共接口 `[Dv, Dk]` 互为转置，见 §16）。
- **L144 `overlapScoresState = vs >= dv || allowScoresStateOverlap`**：两个独立理由取或。`vs >= dv` 表示"整个 V 就一个 tile"，scores 的最后一次使用（`ComputeValueNew`）发生在 state 载入（`LoadStateTile`）之前，生命周期天然不重叠；`allowScoresStateOverlap` 见下面的物理含义。
- **L145 `tScoresState = overlap ? max(tScores, tState) : tScores + tState`**：能重叠就按最大者计费，否则相加。注意 `tScores` 恒 ≤ `tState`（当 `vs` 接近 `dv` 时 `stateStrideK*avStep` 远大于 `cs*cs`），所以 overlap 的收益主要是**省掉整个 tScores**。
- **L146-147 求和式换行**：`kPairedTileCount*kTileBytes + tDecay + kPairedTileCount*vTileBytes + tGcum + tDelta + tDotProduct + tExpGcum + tScoresState`，正好对应 kernel 侧 `tmpBuff` 的 11 块切片（overlap 时 scores/state 合成 1 块 → 10 块）。求和顺序与 device 的 `off` 推进顺序**无关**（只有总量参与比较），所以两侧可以各自独立书写；但**每一项的尺寸必须一致**，否则 host 给预算、device 花超支，`GetWithOffset` 会越出 `tmpBuff` 而编译期毫无提示。

**参数 `dv` 的唯一用途是 L144 的 `vs >= dv` 比较**，完全没进入任何字节公式——这解释了一个初看奇怪的现象：`ComputeTmpBuffBytes` 里既有 `chunkSize` 又有 `dv`，但 `dv` 只当布尔量用。

### 9.1 数值代入：B=1, H=16, T=128, dk=dv=128（chunkSize=64）

`alignK = CeilAlign(128,16) = 128`，`stateStrideK = CeilAlign(128,8) = 128`，`cs = 64`。搜索第一轮 `vs = 128` → `avStepAligned = 128`：

| 行 | 项 | 公式代入 | 字节 | 是否随 vs 变化 |
|---|---|---|---|---|
| L132 | `kTileBytes` | 64×128×4 | 32 768 | 否（固定） |
| L146 | `2×kTileBytes` | 2×32 768 | 65 536 | 否 |
| L133 | `vTileBytes` | 64×128×4 | 32 768 | 是 |
| L146 | `2×vTileBytes` | 2×32 768 | 65 536 | 是 |
| L134 | `tDecay` | 64×64×4 | 16 384 | 否 |
| L135 | `tGcum` | 64×4 | 256 | 否 |
| L137 | `dotProductElem` | max(128, 64) | 128 元素 | 否 |
| L138 | `deltaElem` | max(128, 128) | 128 元素 | 是（≥128 后不再变） |
| L139 | `tDelta` | 128×4 | 512 | 是 |
| L140 | `tDotProduct` | 128×4 | 512 | 否 |
| L141 | `tExpGcum` | 64×4 | 256 | 否 |
| L142 | `tScores` | 64×64×4 | 16 384 | 否 |
| L143 | `tState` | 128×128×4 | 65 536 | 是 |
| L145 | `tScoresState` | overlap 取 max / 否则相加 | 65 536 或 81 920 | — |
| L146 | **`tmpBuff` 合计** | — | **214 528**（overlap）／**230 912**（不 overlap） | — |

与 vs 无关的固定项合计 = `2×kTileBytes + tDecay + tGcum + tDotProduct + tExpGcum + tScores` = 65536+16384+256+512+256+16384 = **99 328 B**（若不 overlap 还要再加 tState 之外的部分，见上表）。这条"固定地板"就是 §11 里判断循环能否成功的第一要素。

`outQueue`（§10，vs=128）：`stateBytes = 128×128×2 = 32 768`，`chunkBytes = 64×128×2 = 16 384` → **32 768 B**。
`requiredBytes` = 214 528 + 32 768 = **247 296 B**（overlap）或 230 912 + 32 768 = **263 680 B**（不 overlap）。

于是第一轮能否命中完全由 L76-83 侦察到的 `ubSize` 决定：`ubSize ≥ 247 296` 且 overlap → vs=128 直接被接受；否则循环按 16 的步长下探。`ubSize` 的真实值不写死在源码里，运行期把 `CGDR_DEBUG_LOG=1` 打开即可从 `ubSize=%ld` 读到（§13）。

### 9.2 `allowScoresStateOverlap = dims.hv < aivNum` 的物理含义

锚点：chunk_gated_delta_rule_tiling.cpp:254-254（定义处，完整控制流见 §15）

```cpp
  bool allowScoresStateOverlap = dims.hv < aivNum;
```

这一行把"**核多活少**"这个资源状态翻译成"**内存可以省**"。因果链：`hv < aivNum` ⇒ L272 的 head×V-tile 二级切分被启用 ⇒ 每个核一辈子只处理**一个** `(head, vTileIdx)` 工作项 ⇒ 该核上的 `chunkScoresFp32` 只被生产一次、消费一次，且在 `LoadStateTile` 之前就已死透 ⇒ scores 与 state tile 共用同一段内存是**生命周期合法**的。

反过来，若 `hv ≥ aivNum`（核不够用），一个核要在 `ProcessVTiles` 里**串行**跑完该 head 的所有 V-tile，`chunkScoresFp32` 作为 K 侧结果必须跨 tile 存活（docs/PR-406-00e39ab5/05 的 phase 编排：Phase 4 产出、Phase 6 每个 tile 复用），此时若与 state 重叠就会互相踩数据。所以这不是"省内存的优化开关"，而是**由并行划分方式决定的复用可行性**。

device 侧的等价表达式在 `InitLocalBuffers`（kernel.h:168）写成 `vStep_ >= realV_ || ShouldSplitVTiles()`，而 `ShouldSplitVTiles()` 是 `realV_ > vStep_ && GetBlockNum() > NV_`。两侧条件**可以证明等价**：`GetBlockNum()` 是 host 自己 `SetBlockDim` 出来的 `min(workItems, aivNum)`；`hv < aivNum && vTileCount > 1` 时它严格大于 `NV_`（因为 `hv*vTileCount > hv` 且 `aivNum > hv`），`vTileCount == 1` 时必有 `vStep ≥ dv` 而落到 host 的第一个条件。docs/PR-406-00e39ab5/03 §3.1 说"两边表达不同、逻辑等价"，本节给出的是它的展开证明——同时提醒：**host 用平台核数 `aivNum`、device 用实际 `GetBlockNum()`**，若哪天有别的代码路径改了 blockDim（例如外部覆盖 `SetBlockDim`），这个等价性会先失效。

## 10. tiling.cpp:149-157 — ComputeOutQueueBytes：出向队列为什么取 max

锚点：chunk_gated_delta_rule_tiling.cpp:149-157

```cpp
// stateOutQueue bytes: max of the state tile and compact chunk output.
uint32_t ComputeOutQueueBytes(uint32_t vs, uint32_t dk, uint32_t chunkSize) {
  uint32_t avStepAligned = CeilAlign(vs, FP32_NUM_PER_BLOCK);
  uint32_t stateStrideK = CeilAlign(dk, FP32_NUM_PER_BLOCK);
  uint32_t stateBytes = stateStrideK * avStepAligned * sizeof(uint16_t);
  uint32_t chunkBytes = chunkSize * avStepAligned * sizeof(uint16_t);
  return (stateBytes > chunkBytes) ? stateBytes : chunkBytes;
}
```

- L150 注释直说"state tile 与紧凑 chunk 输出取 max"。
- L151 签名只有三个参数（不需要 dv/alignK），因为这里算的是**出向**队列。
- L152-153 两个对齐量与 §9 的 L130/L136 同式重算——不是复用，是各算各的，因为这两个函数被 `SolveVStep` 在不同轮次分别调用。
- L154 `stateBytes`：出向队列要装"最终 state tile `[dk, vStep]`"，元素是 **FP16**（`sizeof(uint16_t)`）——队列位置是 `VECOUT`，装的是 `Cast` 之后准备 `DataCopy` 到 GM 的数据。写 `sizeof(uint16_t)` 而不是 `sizeof(half)`，是因为 host 侧没有 AscendC 的 `half` 类型，用等宽的 `uint16_t` 表达"2 字节"这个纯粹的尺寸语义。
- L155 `chunkBytes`：同一队列还要装"注意力输出 tile `[chunkSize, vStep]`"（kernel.h:347 与 :900 两处 `AllocTensor` 共用一个队列）。
- L156 取 max：两类出向数据**从不同时在队列里**（`BUFFER_NUM=1`，见 03 篇 §13），所以队列容量按最大者即可。

与 device 侧 kernel.h:134-137 的 `stateTileBytes/chunkOutBytes/outQueueBytes` 一一镜像；两处都是 `max`，所以"device 用的队列大小"与"host 预算里扣掉的队列大小"天然相等。但注意 host 用 `outQueueMax` 算 `restBytes = ubSize - outQueueMax`（L187），而 device 是 `InitBuffer(stateOutQueue_, BUFFER_NUM, outQueueBytes)` + `InitBuffer(tmpBuff, restUbSize_)` —— 一旦 `BUFFER_NUM` 在 device 侧被改成 2（double buffer 优化），**host 少扣一倍队列**，`tmpBuff` 就会吃掉本该属于第二块队列的内存，而 `SolveVStep` 仍报告"放得下"。这是"两侧记账各自成文"的代价（03b 篇 §1 同题）。

## 11. tiling.cpp:158-189 — SolveVStep：贪心搜索、终止性与两条出口

锚点：chunk_gated_delta_rule_tiling.cpp:158-189

```cpp

// Find the largest vStep (FP32-block aligned, <= dv) whose tmpBuff + outQueue fits in UB.
// Also returns the resulting buffer sizes for tiling/debug.
bool SolveVStep(uint32_t dv, int64_t ubSize, uint32_t chunkSize, uint32_t dk, uint32_t alignK,
                bool allowScoresStateOverlap, uint32_t &vStepVal, uint32_t &tbufTotal, uint32_t &outQueueMax,
                uint32_t &restBytes) {
  if (ubSize <= 0) {
    return false;
  }
  uint32_t maxVStep = CeilAlign(dv, FP16_NUM_PER_BLOCK);
  bool found = false;
  for (uint32_t vs = maxVStep; vs >= FP16_NUM_PER_BLOCK; vs -= FP16_NUM_PER_BLOCK) {
    uint64_t requiredBytes =
      static_cast<uint64_t>(ComputeTmpBuffBytes(vs, dv, chunkSize, dk, alignK, allowScoresStateOverlap)) +
      ComputeOutQueueBytes(vs, dk, chunkSize);
    if (requiredBytes <= static_cast<uint64_t>(ubSize)) {
      vStepVal = vs;
      found = true;
      break;
    }
  }
  if (!found) {
    return false;
  }
  if (vStepVal > dv) {
    vStepVal = CeilAlign(dv, FP16_NUM_PER_BLOCK);
  }
  tbufTotal = ComputeTmpBuffBytes(vStepVal, dv, chunkSize, dk, alignK, allowScoresStateOverlap);
  outQueueMax = ComputeOutQueueBytes(vStepVal, dk, chunkSize);
  restBytes = (ubSize > static_cast<int64_t>(outQueueMax)) ? static_cast<uint32_t>(ubSize - outQueueMax) : 0;
  return true;
}
```

- L159-160 注释给出目标："找到**最大的**、FP32 块对齐且 ≤ dv 的 vStep，使 tmpBuff + outQueue 装进 UB"，并说明顺带回填三个尺寸供 tiling/debug 用。
- L161-163 签名：4 个出参引用（`vStepVal/tbufTotal/outQueueMax/restBytes`）。参数已达 10 个（6 入 4 出）——本文件的函数里最长的一个，可读性已经越界，但换来的是"一次搜索同时产出全部派生量"，避免调用方重算公式（重算就是复制记账，正是最容易写歪的地方）。
- **L164-166 第一道早退：`ubSize <= 0`**。这就是 §5 里"UB 查询失败被丢弃错误码"的实际兜底点。`<=` 而非 `==`：`ubSize` 是有符号 `int64_t`，允许出现负值（某些实现把错误码塞进出参）并一并挡掉。
- **L167 `maxVStep = CeilAlign(dv, 16)`**：搜索起点是 **dv 向上对齐到 16**，注意它**可能大于 dv**（dv=80 → 96）。含义是"一 tile 覆盖整个 V 维、并且行宽满足 FP16 的 32B block"。用 FP16 块（16）而不是 FP32 块（8）做步长，是因为队列与 GM 侧都是 FP16 布局；16 也是 8 的倍数，所以每个候选自动满足 FP32 对齐（L130 的 `CeilAlign` 因此恒等）。
- **L168 `found` 标志**：把"循环里 break 了"与"搜完了没找到"区分开——不能靠 `vStepVal != 0` 判断，因为 `vStepVal` 是外部传入的引用（L250 初始化为 0，但函数不该依赖调用方的初始化）。
- **L169-178 搜索循环：为什么一定终止**。循环变量 `vs` 是**无符号 uint32_t**，条件却是 `vs >= 16`，减法 `vs -= 16` 一旦下溢就会变成巨大值从而**死循环**。这里不会出事，因为：起点 `maxVStep` 是 16 的整数倍（L167 的对齐保证了这一点），所以 `vs` 依次取 `16k, 16(k-1), …, 32, 16`，最后一轮执行完 `vs -= 16` 得 **恰好 0**，而 `0 >= 16` 为假 → 正常退出。**若起点不是步长的倍数（例如把 L167 写成 `maxVStep = dv`），`vs` 会落到 1..15 之间再减 16 → 无符号回绕 → 事实死循环**。这一行对齐就是循环的终止性证明，属于"看起来多余、删了就炸"的代码。
- **L170-172 `requiredBytes`**：`static_cast<uint64_t>` 先把 tmpBuff 升到 64 位再相加。为什么必要：`ComputeTmpBuffBytes` 返回 `uint32_t`，若直接 `uint32_t + uint32_t` 与 `ubSize` 比较，虽然此处两者都不大，但作者刻意用 64 位表达"字节预算比较应当在 64 位域做"的习惯；比较右侧同样显式转换，避免有/无符号混合比较警告。
- **L173-177 命中即 `vStepVal = vs; found = true; break;`**：贪心——从大到小第一个放得下的就是答案。为什么贪心是对的：`ComputeTmpBuffBytes + ComputeOutQueueBytes` 关于 `vs` **单调不减**（每一项都含 `avStepAligned` 因子或与之无关），所以"放得下"在 vs 上是后缀性质，最大值即最优。为什么"越大越好"：vStep 越大 → `vTileCount = ceil(dv/vStep)` 越小 → ① 同一份 K 侧结果被复用的次数少但每次 DMA 的行更长（DMA 效率↑）；② `ProcessVTiles` 的 tile 循环轮次↓，每轮固定的标量开销与 `PipeBarrier` 次数↓。
- **找不到怎么走**：循环自然终止 → L179-181 `if (!found) return false;` → 调用方 L255-258 直接 `return GRAPH_FAILED`，算子在建图阶段报错，**不会下发一个越界的 vStep 让 device 去撞 UB**。这条出口的物理意义见 §9.1 的"固定地板"：若 `2×kTileBytes + tDecay + …`（vs=16 时）仍 > ubSize，本函数必然失败。
- **L182-184 `if (vStepVal > dv) vStepVal = CeilAlign(dv, 16);`**：把"起点超出 dv"的情况压回对齐值。由于 `vStepVal` 只能是候选序列里的值，唯一的 `> dv` 情形就是首轮命中的 `maxVStep`，而它已经等于 `CeilAlign(dv,16)` —— **这行在本 commit 里是恒等赋值（死代码）**，保留的意图是防御：万一将来首轮允许非对齐值（例如改成按 FP32 步长 8 搜），这里兜住 `vStep` 不超过"对齐后的 dv"，从而保证 `vTileCount = DivCeil(dv, vStep) = 1` 时 kernel 的行宽仍然合法。写报告时值得点出：**"读起来像修正、实际不起作用"的行是复核时最容易误判成本的地方**。
- **L185-186 用最终 `vStepVal` 重算两个尺寸**：搜索期间的 `requiredBytes` 是局部量、没留痕，所以要用同一对函数再算一次（**不缓存是好事**：缓存就要在 break 处多存三个变量，也说明这两个函数是纯函数、可重入）。
- **L187 `restBytes = (ubSize > outQueueMax) ? ubSize - outQueueMax : 0`**：把"UB 减掉出向队列"整块交给 tmpBuff。**注意它不等于 `tbufTotal`**，而是 `tbufTotal` 的上界：`restBytes - tbufTotal = ubSize - (tmpBuff + outQueue)`，即**未用余量**。device 侧 `InitBuffer(tmpBuff, restUbSize_)` 拿到的是"全部剩余"，随后 §9 的 `off` 推进只花 `tbufTotal`，余量留空。这里也说明**没有任何安全余量**：TPipe/runtime 若在 UB 里另外保留管理结构，`restBytes` 就会略超可分配空间——`SolveVStep` 的判据 `requiredBytes <= ubSize` 与真实可分配上限之间的差额，是这套记账唯一的软肋（后续 PR 若出现 `InitBuffer` 失败，先查这里）。
- L188 `return true;`、L189 `}`。

## 12. tiling.cpp:190-211 — FillTilingData：16 个字段的落笔处

锚点：chunk_gated_delta_rule_tiling.cpp:190-211

```cpp

// Write the resolved scalar parameters into the device-visible tiling struct.
void FillTilingData(ChunkGatedDeltaRuleTilingData *td, const ShapeDims &dims, uint32_t aivNum, int64_t ubSize,
                    uint32_t chunkSize, uint32_t numChunks, uint32_t padSize, float scaleValue, uint32_t vStepVal,
                    uint32_t restBytes, bool hasGamma) {
  td->vectorCoreNum = aivNum;
  td->ubCalSize = static_cast<uint32_t>(ubSize);
  td->ubRestBytes = restBytes;
  td->t = dims.t;
  td->hqk = dims.hqk;
  td->dk = dims.dk;
  td->hv = dims.hv;
  td->dv = dims.dv;
  td->chunkSize = chunkSize;
  td->numChunks = numChunks;
  td->b = dims.batch;
  td->padSize = padSize;
  td->hasGamma = hasGamma ? 1 : 0;
  td->scaleValue = scaleValue;
  td->vStep = vStepVal;
  td->debug = 0;
}
```

- L190 空行；L191 注释："把已解析的标量参数写进 device 可见的 tiling 结构体"——**这是整个文件里唯一触碰协议的地方**，其余全是决策。
- L192-194 签名：`td` 裸指针（调用方 L260 已判空，见 §15）+ `dims` const 引用 + 8 个标量。`bool hasGamma` 以 bool 传入、在 L207 折成 0/1，因为协议字段是 `uint32_t`（01 篇 §16 的"混宽破坏对齐"理由）。
- L195-210：**16 行赋值与结构体声明顺序严格一致**（vectorCoreNum→…→debug）。顺序本身不影响正确性（是具名字段赋值，靠 host 侧结构体定义解析），但把"赋值顺序 = 布局顺序"当作纪律，可以让人眼校对 01 篇 §16 那张偏移表——**漏一个字段编译期也不会报**（`ChunkGatedDeltaRuleTilingData` 是聚合体，未赋值的字段是未初始化内存，除非 `GetTilingData` 保证清零，否则 device 会读到垃圾）。逐字段的类型/偏移/读者见 01 篇 §16，本篇只补"谁算出来的"：
- L195 `aivNum` ← §5；L196 `static_cast<uint32_t>(ubSize)` ← §5（有符号转无符号，`ubSize <= 0` 已在 §11 L164 挡掉，所以此处不会折出巨值）；
- L197 `restBytes` ← §11 L187，**device 唯一的 UB 预算出口**；
- L198-202 `t/hqk/dk/hv/dv` ← §6 的 `ShapeDims`；
- L203 `chunkSize` ← L242 的 `kDefaultChunkSize`；L204 `numChunks`、L206 `padSize` ← §14 L246-247；
- L205 `b = dims.batch` ← §6 L102；
- L207 `hasGamma` ← §8；L208 `scaleValue` ← §7；L209 `vStep` ← §11；
- L210 `td->debug = 0;` ——**无条件写 0**。它和 §13 的 `CGDR_DEBUG_LOG` 构成两条独立的调试通道：一条在 host 侧 stderr（本 commit 实际可用），一条是给 device 侧打印预留的协议位（本 commit 无读者，但 !1140 的 RGDR kernel 里同类遥测字段 `vectorCoreNum` 已被真正消费，见 `recurrent_gated_delta_rule.h:177`）。
- L211 `}` 闭合。

## 13. tiling.cpp:212-226 — LogTiling 与 CGDR_DEBUG_LOG 门控

锚点：chunk_gated_delta_rule_tiling.cpp:212-226

```cpp

// Optional stderr dump, gated by CGDR_DEBUG_LOG=1. No-op otherwise.
void LogTiling(const ShapeDims &dims, uint32_t chunkSize, uint32_t numChunks, float scaleValue, int64_t ubSize,
               uint32_t vStepVal, uint32_t blockDim, uint32_t outQueueMax, uint32_t tbufTotal, uint32_t restBytes) {
  const char *tilingDbg = std::getenv("CGDR_DEBUG_LOG");
  if (tilingDbg == nullptr || tilingDbg[0] != '1') {
    return;
  }
  fprintf(stderr,
          "ChunkGatedDeltaRule tiling: T=%u, chunkSize=%u, numChunks=%u, hqk=%u, dk=%u, hv=%u, dv=%u, "
          "scaleValue=%f, ubSize=%ld, vStep=%u, blockDim=%u, outQueue=%u, tbuf=%u, restBytes=%u\n",
          dims.t, chunkSize, numChunks, dims.hqk, dims.dk, dims.hv, dims.dv, scaleValue, ubSize, vStepVal, blockDim,
          outQueueMax, tbufTotal, restBytes);
  fflush(stderr);
}
```

- L212 空行；L213 注释把契约压缩成一行：可选、环境变量门控、否则空操作。
- L214-215 签名收 **10 个参数**，全部是"决策结果 + 决策输入"的组合，且**只读**：`const ShapeDims &` + 九个标量。它不参与任何决策，所以可以整段删掉而不影响功能——这正是把它独立成函数的理由。
- L216 `std::getenv("CGDR_DEBUG_LOG")`：`std::` 前缀说明该符号由已经 include 的 CANN 头间接带入的 `<cstdlib>` 提供（本文件没显式 include；严格写法应补 include，靠传递包含是**可移植性风险**）。环境变量名带 `CGDR_` 前缀避免与其它算子的调试开关串味。
- L217-219 门控条件 `tilingDbg == nullptr || tilingDbg[0] != '1'`：只认字面 `"1"`（`"0"`、`"true"`、`"yes"` 都不开）。取 `[0]` 而不是 `strcmp`，省一次调用也省一个 `<cstring>`。**注意短路顺序**：先判 nullptr 再取首字符。
- L220-222 `fprintf` 与格式串分两段字面量拼接（C++ 相邻字符串字面量合并），避免超长行；格式符与实参严格对应：`%u` 对 `uint32_t`、`%f` 对 `float`（提升为 double）、`%ld` 对 `int64_t`。`ubSize` 用 `%ld` 是**平台相关**写法（LP64 Linux 上 `long` 为 64 位），在 Windows/ILP32 下会失配——host tiling 只在 Linux aarch64/x86_64 上编译，所以实践安全，但这是"用 `%ld` 而非 `PRId64`"的取舍。
- L223-224 实参顺序与格式串一一对应，注意**`outQueue/tbuf/restBytes` 三个都打**：这三个数就是 §9.1 表格的最后几行，一次输出即可人工复算 `tbuf + outQueue ≤ ubSize` 是否成立。
- L225 `fflush(stderr);`：stderr 在 glibc 下本就无缓冲，这里显式 flush 是为防某些 runtime 把 stderr 重定向到日志管道（`build_all_ops.sh` + pytest 的捕获场景），保证 tiling 日志与 kernel 日志的时序不串。
- L226 `}`：函数结束。

调用点在 L282（`blockDim` 已定、workspace 尚未申请），所以日志里看不到 `ws[0]` —— 需要 workspace 尺寸时得另加一行，这是本 commit 调试通道的一个实际盲区。

## 14. tiling.cpp:227-258 — TilingFunc 前半：侦察→解析→pad→求解（含四道失败出口）

锚点：chunk_gated_delta_rule_tiling.cpp:227-258

```cpp

static uint32_t ChunkGatedDeltaRuleTilingFunc(TilingContext *context) {
  uint32_t aivNum = 0;
  int64_t ubSize = 0;
  if (!GetPlatformInfo(context, aivNum, ubSize)) {
    return GRAPH_FAILED;
  }

  ShapeDims dims;
  if (!ParseShapeDims(context, dims)) {
    return GRAPH_FAILED;
  }

  float scaleValueAttr = 1.0f;
  ParseAttrs(context, scaleValueAttr);
  uint32_t chunkSize = kDefaultChunkSize;
  bool hasGamma = HasGamma(context);

  // Pad T up to a multiple of chunkSize and pre-compute the FP16/FP32 block alignments.
  uint32_t padSize = (chunkSize - dims.t % chunkSize) % chunkSize;
  uint32_t numChunks = (dims.t + padSize) / chunkSize;
  uint32_t alignK = CeilAlign(dims.dk, FP16_NUM_PER_BLOCK);

  uint32_t vStepVal = 0;
  uint32_t tbufTotal = 0;
  uint32_t outQueueMax = 0;
  uint32_t restBytes = 0;
  bool allowScoresStateOverlap = dims.hv < aivNum;
  if (!SolveVStep(dims.dv, ubSize, chunkSize, dims.dk, alignK, allowScoresStateOverlap, vStepVal, tbufTotal,
                  outQueueMax, restBytes)) {
    return GRAPH_FAILED;
  }
```

- L227 空行。
- L228 `static uint32_t ChunkGatedDeltaRuleTilingFunc(TilingContext *context)`：入口。`static` + 位于匿名 namespace（L27）双重内部链接；返回 `uint32_t` 是 GE 状态码，函数指针原型由 `IMPL_OP_OPTILING(...).Tiling(...)`（§16）固定。
- **L229-233 第一步：侦察硬件**，`aivNum`/`ubSize` 都先初始化为 0，失败即 `GRAPH_FAILED`。**顺序是刻意的**：核数与 UB 是所有后续决策的分母，必须在解析形状之前拿到——把资源失败排第一，也让"平台不支持"这类错误在建图最早期暴露。
- **L235-238 第二步：解析形状**，`ShapeDims dims;` 未显式初始化（六个 `uint32_t` 是未定义值），但 `ParseShapeDims` 成功路径会写满全部六个字段、失败路径直接 `return`，所以安全；`tbufTotal/outQueueMax/restBytes` 在 L250-253 则都显式写 0——**同一函数里两种初始化纪律**，差别在于前者有函数契约兜底、后者要靠自身。
- **L240-241 第三步：属性**。`1.0f` 的本地默认与 §7 的内部默认重复一遍（双重兜底）。
- **L242 第四步：`chunkSize = kDefaultChunkSize`**。写成局部变量而不是到处用常量，是因为后面 8 处引用（L246-247、L255、L264、L282）都以它为准——将来若把它升级成 attr，只改这一行。
- **L243 第五步：`hasGamma`**（§8）。

- **L245 注释**："把 T 补到 chunkSize 的整数倍，并预先算好 FP16/FP32 的块对齐"。
- **L246 `padSize = (chunkSize - dims.t % chunkSize) % chunkSize`**：经典"补到倍数"公式。外层 `% chunkSize` 是关键：当 `dims.t % chunkSize == 0` 时，`chunkSize - 0 = 64` 会被误当成"要补一整块"，取模后归 0。**若省掉外层模，`dims.t = 128` 会算出 padSize=64、numChunks=3**，kernel 就多做一整个空 chunk（并且最后一块语义 `isLastChunk` 会落在错误的块上）。
- **L247 `numChunks = (dims.t + padSize) / chunkSize`**：整除无需 DivCeil——pad 已保证被除数是 64 的倍数。注意它用的是**跨 batch 的总长 T**，而 kernel 里每个 batch 的 chunk 数是按**该 batch 的真实 seqLen** 现算的（docs/PR-406-00e39ab5/04 §3.3），所以这个全局 `numChunks` 传给 device 后其实没人用（01 篇 §16 已核实 `numChunks_` 只赋值不读）。
- **L248 `alignK = CeilAlign(dims.dk, FP16_NUM_PER_BLOCK)`**：K 侧行宽按 **FP16** 块对齐（K 以 half DMA），随后作为参数喂进 §9 的 `kTileBytes`。`stateStrideK` 的 FP32 对齐则在 §9 内部再算——两个对齐常量在同一函数里各司其职。

- **L250-253 四个出参显式清零**：`SolveVStep` 只在**成功**路径写它们（§11 L174 与 L185-187），失败时保持 0，而失败会立刻 `return`，所以 0 只是"防御 + 让 `LogTiling` 的实参不是未定义值"。
- **L254 `allowScoresStateOverlap`**：物理含义与等价性证明见 §9.2。它是 `hv < aivNum`——**头数填不满核**这件事的唯一决策点。
- **L255-258 第六步：`SolveVStep`**，九个实参里前六个是输入、后四个是输出（跨两行排版）。失败即 `GRAPH_FAILED`——本函数四道失败出口（L232/L237/L257/L262）里的第三道，也是**唯一一道与"资源装不下"有关**的：它把"这颗芯片的 UB 无法承载该 dk/dv/chunk 组合"变成建图期错误，而不是运行期 UB 越界。

## 15. tiling.cpp:259-282 — TilingData 落笔、blockDim 决策与调试输出

锚点：chunk_gated_delta_rule_tiling.cpp:259-282

```cpp

  auto td = context->GetTilingData<ChunkGatedDeltaRuleTilingData>();
  if (td == nullptr) {
    return GRAPH_FAILED;
  }
  FillTilingData(td, dims, aivNum, ubSize, chunkSize, numChunks, padSize, scaleValueAttr, vStepVal, restBytes,
                 hasGamma);

  // Normally one work item is one value head. When the number of heads cannot
  // fill the AIV cores and V already needs multiple tiles, expose head*V-tile
  // work items; tiles write disjoint output/state ranges.
  uint32_t workItems = dims.hv;
  uint32_t vTileCount = DivCeil(dims.dv, vStepVal);
  if (dims.hv < aivNum && vTileCount > 1) {
    workItems = dims.hv * vTileCount;
  }
  uint32_t blockDim = (workItems < aivNum) ? workItems : aivNum;
  if (blockDim == 0) {
    blockDim = kMinBlockDim;
  }
  context->SetBlockDim(blockDim);
  context->SetTilingKey(0);

  LogTiling(dims, chunkSize, numChunks, scaleValueAttr, ubSize, vStepVal, blockDim, outQueueMax, tbufTotal, restBytes);
```


- **L260 `context->GetTilingData<ChunkGatedDeltaRuleTilingData>()`**：模板实参就是 01 篇 §16 那个结构体——框架按注册时传入的 `sizeof(...)`（L295）分好一块 host 可写内存返回指针，`FillTilingData` 写它，下发时整块 memcpy 进 tiling GM，device 用 `GET_TILING_DATA` 解读。**协议尺寸与结构体定义通过这两处模板实参/宏参数绑定**，与 `ChunkGatedDeltaRuleTilingData` 的全局命名空间要求同源（01 篇 §15）。
- **L261-263 第四道失败出口**：`td == nullptr`。
- **L264-265 `FillTilingData(...)`**：11 个实参换行续写，把 16 个字段全填完（§12）。注意 `outQueueMax` **不在**实参里——它是纯 host 侧中间量，只进 `LogTiling`。

- **L267-269 三行注释**是本文件信息密度最高的一段，逐句读："①通常一个工作项 = 一个 value head；②当 head 数填不满 AIV 核、**且** V 本来就需要多 tile 时，把工作项细化为 head×V-tile；③这些 tile 写的输出/state 区间互不相交。"第 ③ 句是**并行安全性的全部论证**：不同 vTile 写 `attnOutGm_` 的列切片与 state 的行段，地址区间无交集，因此不需要任何原子操作或锁。
- **L270 `workItems = dims.hv`**：默认口径。
- **L271 `vTileCount = DivCeil(dims.dv, vStepVal)`**：V 维被切成几块。`vStepVal` 已在 §11 保证 ≥16 且 ≤ `CeilAlign(dv,16)`，所以除数非零。当 `vStepVal ≥ dv` 时为 1（"一 tile 装下整个 V"）。
- **L272-274 二级切分的启用条件是两个合取**：`hv < aivNum`（有核闲置）**且** `vTileCount > 1`（还有活可分）。只满足前者则 `workItems` 不变（本来一 head 一核，再拆也没意义，且 device 的 `ShouldSplitVTiles()` 会因 `realV_ <= vStep_` 为假而走常规路径）；只满足后者则核不够，拆了也没核去跑。两者同时成立时 `workItems = hv * vTileCount`——**乘法而非 min**，因为此时每个 (head, tile) 都想要一个独立的核。
- **L275 `blockDim = (workItems < aivNum) ? workItems : aivNum;`**：即 `min(workItems, aivNum)`。docs/PR-406-00e39ab5/03 §4 写成 `min(workItems, aivNum)`，语义一致；三元写法是为了避免在 tiling 里引 `<algorithm>`。多出来的核不会启动（framework 按 blockDim 下发），所以**不存在"核忙等"**；少出来的工作项则在同一个核上串行——这正是 `IsCurrentBlock` 加权装箱要处理的情形（03b 篇 §4-§5）。
- **L276-278 `blockDim == 0 → kMinBlockDim(1)`**：兜住 §3 讨论过的 `aivNum == 0`（平台两个 API 都返回 0）与 `hv == 0`（退化形状）两种情形。没有这两行，`SetBlockDim(0)` 会让下发直接失败——**这段代码的存在本身说明作者遇到过 aivNum 报 0 的环境**。
- **L279 `SetBlockDim(blockDim)`**：三个产出中的第二个。它决定 device 侧 `GetBlockNum()` 的返回值，从而反过来影响 `ShouldSplitVTiles()`（§9.2）与 `ComputeAvgload()` 的 `avgload_` 分母——**host 的一次赋值同时决定了切分与负载装箱**，这是读这个 kernel 时最容易漏的一条跨侧因果。
- **L280 `SetTilingKey(0)`**：本算子只有一个 tiling 分支，key 恒 0；它与 kernel 侧 `REGISTER_TILING_DEFAULT` 生成的默认 key 配对。若将来按 dk 分桶（!1135 中间态 69300ffc 的"四桶"就是这条路，见 docs/PR-1135/10 §演进），改这里 + def 侧的 tiling key 声明即可，kernel 会编出多份。

- **L282 `LogTiling(...)`**：十个实参一行写完，位置在 `SetBlockDim` 之后，这样 `blockDim` 才有值可打；workspace 在其后，所以日志里没有 `ws[0]`（§13 末段的盲区）。

## 16. tiling.cpp:283-295 — workspace 申请、返回与两段注册收尾

锚点：chunk_gated_delta_rule_tiling.cpp:283-295

```cpp

  size_t *ws = context->GetWorkspaceSizes(kWorkspaceCount);
  if (ws != nullptr) {
    uint64_t workspaceStrideV = CeilAlign(dims.dv, FP32_NUM_PER_BLOCK);
    uint64_t stateWorkspaceBytes =
      static_cast<uint64_t>(dims.batch) * dims.hv * dims.dk * workspaceStrideV * sizeof(float);
    ws[0] = (stateWorkspaceBytes > kWorkspaceBytes) ? stateWorkspaceBytes : kWorkspaceBytes;
  }
  return GRAPH_SUCCESS;
}
}  // namespace

IMPL_OP_OPTILING(ChunkGatedDeltaRule).Tiling(ChunkGatedDeltaRuleTilingFunc, sizeof(ChunkGatedDeltaRuleTilingData));
```


- **L284 `GetWorkspaceSizes(kWorkspaceCount)`**：向框架申请 1 个 workspace 槽位（§3 的 L51），返回可写数组指针；**可能为 null**（框架不启用 workspace 机制时），所以整段用 `if` 包住而不是直接解引用——workspace 在本算子里是"必须有"的（跨 chunk 的 FP32 state 中转），但这里选择"拿不到就悄悄不写"，让 L291 依然返回 `GRAPH_SUCCESS`。这是一个**值得警惕的宽松**：真拿不到 workspace 时，device 侧 `GetUserWorkspace`（kernel.cpp:29）会拿到一个未声明尺寸的段，越界风险转嫁到运行期。
- **L285 `if (ws != nullptr) {`**：上一条说的"拿不到就悄悄不写"就是这一行的作用域——`ws[0]` 的赋值被包在 `if` 里，null 时整段跳过，`stateWorkspaceBytes` 也算都不算。
- **L286 `uint64_t workspaceStrideV = CeilAlign(dims.dv, FP32_NUM_PER_BLOCK)`**：workspace 的行宽 = dv 按 **FP32 块（8）** 对齐。为什么按 FP32：workspace 存的是 state 的中间态，全程 FP32（防精度损失，见 docs/PR-406-00e39ab5/01 §6 与 07 篇⑦）。为什么行是 v 方向、宽是 dv：workspace 布局是 `[B, Nv, dk, align32(dv)]`，即 **k 为外层行、v 为内层列**，与公共接口的 `[..., Dv, Dk]` 互为转置。转置放这里而不是每次读写做，是为了让 kernel 内部的 `[DK, vStep]` tile（§9 L143 的 `tState`）可以**直接 DMA 不转置**——转置只发生在首块入口（读 FP16 `initial_state` 时逐元素写 workspace）与末块出口（写 FP16 `final_state` 时逐元素读）。这一行必须与 kernel 构造函数的 `stateWorkspaceStrideV_ = Ceil(dv, 8)*8`（kernel.h:90）**完全同式**，否则偏移错位。
- **L287-288 `stateWorkspaceBytes`**：`batch × hv × dk × align32(dv) × 4`。`static_cast<uint64_t>(dims.batch)` 把乘积整体提升到 64 位——**这里必须是 64 位**：`B=2,Hv=8,dk=128,dv=128` 时结果是 1 MiB 没事，但 `B=8,Hv=32,dk=256,dv=256` 时是 64 MiB，四个 uint32 相乘（×4 之后 2^32 以上）会回绕成小值，框架于是只分配一点点 workspace，越界在 device 上炸。与 §11 L170-172 的 `requiredBytes` 同一手法。
- **L289 `ws[0] = max(stateWorkspaceBytes, kWorkspaceBytes)`**：32 MiB 的**下限**（§3 L39）。为什么要有下限：① 本算子声明支持动态形状（def.cpp:73），同一份 kernel 会在 T/B/H 各异的多个 shape 上复用，workspace 尺寸若随 shape 剧烈变化会让框架反复重分配、也难以在图缓存里对齐；给一个 32 MiB 的常量底，绝大多数真实 shape 都落在底之上，**分配结果与形状解耦**；② 反向的开销很小——310P 上 32 MiB 相对 HBM 可忽略。代价是每个实例常驻 32 MiB，decode 类小 shape 场景（B=1,Hv=1）也照样占满。以测试矩阵为例：`1×16×128×128×128` 只需 `1×16×128×128×4 = 1 MiB`、`2×8×512×128×128` 也只需 1 MiB，**六个测试 shape 全部落在 32 MiB 下限上**，即真正的公式分支在现有用例里从未生效（这一点 docs 未指出，可用 `CGDR_DEBUG_LOG` 之外的 `msprof`/内存统计复核）。
- **L290 `}`**：workspace 的 `if` 块闭合。
- **L291 `return GRAPH_SUCCESS;`**：三个产出（tiling 结构体 / blockDim / workspace）都落定后才报成功。
- **L292 `}`**：`ChunkGatedDeltaRuleTilingFunc` 结束。
- **L293 `}  // namespace`**：与 L27 配对的匿名 namespace 闭合。**注册宏必须在它之后**——`IMPL_OP_OPTILING` 生成的静态对象要在全局作用域、并以全局可见的函数指针进入注册表（与 01 篇 §13 的 infershape 同理）。

- **L295 `IMPL_OP_OPTILING(ChunkGatedDeltaRule).Tiling(ChunkGatedDeltaRuleTilingFunc, sizeof(ChunkGatedDeltaRuleTilingData));`**：文件末尾一行完成绑定。第一个实参是函数指针，第二个 `sizeof(...)` **把协议宽度交给框架**（框架据此分配 tiling 缓冲并决定下发时搬运多少字节）。这一行的 `sizeof` 与 kernel 侧 `GET_TILING_DATA` 使用的另一份结构体定义若出现宽度差异（例如只有一侧加了字段），**不会有任何编译错误**，只会让 device 读到错位的参数——这是本篇所有"字节协议"讨论的最终落点，也是 01 篇 §15 三条约束存在的全部原因。

