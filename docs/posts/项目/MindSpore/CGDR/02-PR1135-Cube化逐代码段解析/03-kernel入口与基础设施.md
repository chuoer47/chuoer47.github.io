# 03 · kernel 入口与基础设施：AIC_ONLY、四实例与 tiling 结构体镜像

## 0. 本篇结论（先读这六条）

1. **入口 .cpp 的改动只有两处、净 14 行**：`KERNEL_TASK_TYPE_DEFAULT` 的实参从 `KERNEL_TYPE_AIV_ONLY` 换成 `KERNEL_TYPE_AIC_ONLY`（行 28），以及单个 `ChunkGatedDeltaRule<half, half>` 变成四个带桶宽实参的实例（行 33-49）。其余 32 行与 !1108 逐字节相同。**整个 PR 对"算子如何被框架装载"这件事只改了这两行级别的事**。
2. **`kSpecializedDk` 作为第三个模板参数是"编译期分桶"的载体**：同一个 `if constexpr` 在四个实例里折叠成四份不同的机器码，桶宽参与常量传播（`kernel.h:628` 的 `constexpr uint32_t kBlockedScratchMinV = ... kSpecializedDk` 是最直白的证据）。运行期没有任何"选桶"分支——桶是装载哪段二进制决定的。
3. **构造函数的行 90-92 是 host 侧 `tiling.cpp:286` 的 device 镜像**：`naturalAlignK` 保留 !1108 原式作为兜底，`alignK_` 在有桶且 `dk ≤ 桶宽` 时取桶宽，`stateStrideK_` 从此不再独立算 FP32 对齐而是直接等于 `alignK_`。**一个 `Ceil` 调用被删掉，换来 GM state 镜像行距、UB K tile 行宽、Cube N 维三者统一到同一个数**。
4. **`tiling_data.h` 与 !1108 逐字节相同**（`diff` 无输出）。Cube 化一个新字段都没加：桶信息走 `tilingKey`，UB 记账走 `ubRestBytes` 的数值，workspace 走框架的 `GetWorkspaceSizes`。这是 01 篇结论在 device 侧的复证。
5. **GM 上的 Cube 双 slot 在入口侧只做两件事**：常量 `CUBE_STAGE_SLOT_BYTES = 64*1024` / `CUBE_STAGE_SLOT_COUNT = 2`（行 38-39）与"把裸 workspace 地址留一份"（`workspaceAddr_`，行 102 初始化、行 129 赋值）。**行 38 的字面量与 host 侧 `kRawMatmulStageBytesPerCore` 的算式之间没有任何编译期校验**，这是全 PR 最脆的一处跨侧契约。
6. **四个 `if constexpr` 位置的语义被折叠成 `kSpecializedDk != 0`**。**桶从"枚举身份"退化为"有没有桶"**，这是能扩展到任意桶数的前提。

---

# 第一部分：`chunk_gated_delta_rule.cpp`（1-50，全文）

## 1. License、include 与全局作用域声明（1-20）

锚点：chunk_gated_delta_rule.cpp:1-20

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

#include "chunk_gated_delta_rule.h"  // NOLINT(build/include_subdir)

using namespace AscendC;  // NOLINT(build/namespaces)
```

## 2. 入口签名与四个框架宏（21-32）

锚点：chunk_gated_delta_rule.cpp:21-32

```cpp
// The kernel entry and tiling macros must remain in the global namespace.
extern "C" __global__ __aicore__ void chunk_gated_delta_rule(GM_ADDR query, GM_ADDR key, GM_ADDR value, GM_ADDR beta,
                                                             GM_ADDR initialState, GM_ADDR actualSeqLengths,
                                                             GM_ADDR gOptional, GM_ADDR out, GM_ADDR finalState,
                                                             GM_ADDR workspaceGM, GM_ADDR tilingGM) {
  REGISTER_TILING_DEFAULT(ChunkGatedDeltaRuleTilingData);
  GET_TILING_DATA(tilingData, tilingGM);
  KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIC_ONLY);
  GM_ADDR userWorkspace = GetUserWorkspace(workspaceGM);
  CGDRInitParams initParams{query,     key, value,      beta,         initialState, actualSeqLengths,
                            gOptional, out, finalState, userWorkspace};
  TPipe pipe;
```

逐个说清这四个宏/调用的**机器语义**，因为它们是本篇唯一"看不见实现"的代码：

- **`extern "C"` + `__global__` + `__aicore__`（行 22）**：`extern "C"` 关掉名字修饰，让 host 侧生成的 launch stub 能用符号名 `chunk_gated_delta_rule` 找到这段二进制；`__global__` 标"核函数入口"（有返回类型 `void`、被 host 调用）；`__aicore__` 标"编译目标为 AiCore 指令集"。三者缺一不可，且**函数名必须与 `op_impl` 侧注册的名字一致**。** dav_m200（310P）与 910B 的 dav_2202 在这一层是同一套前端，差别在后端。**
- **11 个形参**：`query/key/value/beta/initialState/actualSeqLengths/gOptional/out/finalState` 是 9 个张量的 GM 基址（与 def.cpp 的输入输出顺序一一对应，见 01 篇 §1），再加 `workspaceGM`（框架按 tiling 报上的账申请好的工作区）与 `tilingGM`（host 写好的 tiling 字节流）。**所有参数都是 `GM_ADDR`（64 位裸地址）**，类型信息完全靠 tiling 数据与 device 代码自己维护——这就是为什么 def.cpp 里声明的 dtype 必须与 `ChunkGatedDeltaRule<half, half, …>` 的模板实参一致，编译器不做任何交叉校验。

- **`REGISTER_TILING_DEFAULT(T)`（行 26）**：向 autogen 声明"本 kernel 的 tiling 结构体类型是 `T`"，它生成 tiling-key 相关的符号表项。它必须出现在函数体最前面，因为后面的 `TILING_KEY_IS` 要用它生成的符号。
- **`GET_TILING_DATA(t, tilingGM)`（行 27）**：把 `tilingGM` 指向的裸字节流**按 `T` 的布局重新解释**，声明一个局部对象 `t`（这里是 `ChunkGatedDeltaRuleTilingData`）。它不做拷贝、不做大小端转换，纯靠两侧结构体逐字节一致。**这就是本篇 §4 整份 `tiling_data.h` 存在的理由**：行 26 的类型与 `op_host/chunk_gated_delta_rule_tiling.h` 里那份必须是同一个字节布局。
- **`KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIC_ONLY)`（行 28）**——**本文件唯一的实参改动**（!1108 是 `KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIV_ONLY)`）。机器语义：它告诉编译器本 kernel 需要的流水线资源集合，从而决定 `TPipe` 的 `Init/Destroy` 要申请哪些硬件队列与 barrier，以及 autogen 生成的任务描述里把这段代码派给哪类核。三种取值的区别：

| 宏值 | 申请的资源 | 典型后果 |
| --- | --- | --- |
| `KERNEL_TYPE_AIV_ONLY` | 仅 Vector 侧（MTE1/MTE2/V/MTE3/UB） | 不占 Cube/L0 资源；用不了 `Mmad`/`LoadData` |
| `KERNEL_TYPE_AIC_ONLY` | Cube 侧（M/MT / L1 / L0A / L0B / L0C）；310P 上还包含共用的 V/MTE 队列 | 允许裸 `Mmad`；不再申请只属于纯 Cube 产品的 Fixpipe |
| `KERNEL_TYPE_MIX_AIV_1_2` | AIC + AIV 混跑，且 block 数按 1:2 切分 | 需要双端 `TQueSync`/跨核同步，最复杂 |

**为什么在 310P 上这个标志的含义与 910B 不同**：
- 910B（dav_2202）的 Cube 与 Vector 是**分开的物理核**（`GetCoreNumAic()` 与 `GetCoreNumAiv()` 返回不同的数，两者按 1:2 配比），AIC_ONLY 意味着"这段代码只跑在 Cube 核上，所有 Vector 运算要靠 cross-core queue 送给 AIV"。
- **310P（dav_m200）的 AiCore 是 Cube + Vector + MTE 融合在同一个核里**，"AIC" 与 "AIV" 只是同一种核上不同的**流水线资源视图**。所以在 310P 上 `KERNEL_TYPE_AIC_ONLY` 的实际效果是"这个 block 独占一颗 AiCore，并同时拥有 Cube 与 Vector 流水"，而**不是**"只能碰 Cube"——这正是本 kernel 能在同一个函数体里既 `Mmad` 又 `Cast`/`Add`/`Duplicate` 的前提。反过来说，**这个写法把 kernel 绑死在融合核产品上**：若换到 Cube/Vector 分离的产品形态，`Process()` 里的 Vector 段就得走 cross-core 队列，代码结构要重做。

---

- **`GetUserWorkspace(workspaceGM)`（行 29）**：`workspaceGM` 是框架的"总工作区"，其中前若干字节被 autogen 用作内部用途，这个调用返回**扣除内部用途之后**的用户可用基址。**关键连带后果**：device 侧任何 workspace 偏移都必须以这个返回值为准，而 host 侧 `tiling.cpp:337-343` 报的账是"用户需要多少"。两侧都以 `userWorkspace` 为原点，所以 `GetCubeStageBase` 的 `workspaceAddr_ + offset`（`kernel.h:254`）与 host 的 `stateWorkspaceBytes + blockDim*128KiB` 是同一个坐标系。
- **`CGDRInitParams initParams{...}`（行 30-31）**：聚合初始化（aggregate initialization），**顺序即语义**——10 个成员对应 §8 的 struct 定义。
- 行 32 `TPipe pipe;`：管线对象在栈上构造（device 侧的栈就在栈空间），**它的 `Init/Destroy` 由 `KERNEL_TASK_TYPE_DEFAULT` 决定申请什么**。真正的 buffer 分配发生在 `op.Init(initParams, &pipe)` 里（`kernel.h:105-114`）。

## 3. 四个模板实例：`TILING_KEY_IS` 与实例数权衡（33-50）

锚点：chunk_gated_delta_rule.cpp:33-50

```cpp
  if (TILING_KEY_IS(0)) {
    ChunkGatedDeltaRule<half, half, 64> op(&tilingData);
    op.Init(initParams, &pipe);
    op.Process();
  } else if (TILING_KEY_IS(1)) {
    ChunkGatedDeltaRule<half, half, 80> op(&tilingData);
    op.Init(initParams, &pipe);
    op.Process();
  } else if (TILING_KEY_IS(2)) {
    ChunkGatedDeltaRule<half, half, 96> op(&tilingData);
    op.Init(initParams, &pipe);
    op.Process();
  } else if (TILING_KEY_IS(3)) {
    ChunkGatedDeltaRule<half, half, 128> op(&tilingData);
    op.Init(initParams, &pipe);
    op.Process();
  }
}
```

**机器语义**：`TILING_KEY_IS(k)` 展开后是"当前 kernel 实例的 tiling key 是否等于 `k`"的**运行期**判断（key 值由 `tiling.cpp:333` 的 `SetTilingKey` 写入 tiling 元数据）。但因为这个判断只依赖元数据、不依赖数据，框架实际会为不同 key **装载不同的二进制**，所以这四条分支在真正跑起来时是"只有一条为真"的分派，而不是四次比较的开销。更重要的是：**每个分支里 `ChunkGatedDeltaRule<half, half, N>` 是不同的类**，`N` 作为模板实参参与全部编译期计算，所以这四段代码是四份独立生成的机器码，彼此不共享任何 `if constexpr` 的未选中分支。

- **键值 ↔ 实例 ↔ 桶的对应表**（与 02b §8 的 host 侧表互为证明，两侧各写一次、必须一致）：

| `tilingKey` | 本文件的实例 | `kSpecializedDk` | host 命中条件（`tiling.cpp:325-332`） | `dk` 实际范围 |
| --- | --- | --- | --- | --- |
| 0 | 行 34 | 64 | `cubeDk == kSmallCubeDk` | 1-64 |
| 1 | 行 38 | 80 | `cubeDk == kMidSmallCubeDk` | 65-80 |
| 2 | 行 42 | 96 | 默认值（未被改写） | 81-96，**外加 `dk ≥ 129` 的兜底** |
| 3 | 行 46 | 128 | `cubeDk == kLargeCubeDk` | 97-128 |

- **实例数与 launch 开销的权衡是真实的、而且作者明确算过这笔账**。!1108 只有 1 个实例、1 个 key；初版 a9c66ddb 是 3 个实例（`a9c66ddb/.../chunk_gated_delta_rule.cpp:33-44`）并留下注释"只编 3 个 kernel，避免小 generic shape 上可测量的 launch 开销"；69300ffc 补 80 桶时把它改成 4 个实例、并把那句注释改写成 02b §8 引用的两句。**这段历史说明"多一个实例"不是零成本**，否则作者不会专门写注释辩护、更不会在一天后专门推翻它。
- 为什么必须四个而不是"一个通用 + 运行期参数"：Cube 的 Mmad 形状、L0A/L0B 的分配大小、`LoadData` 的循环次数全是编译期常量。把 `kSpecializedDk` 降级成运行期变量，这些 `constexpr` 就全塌成运行期算术，`for (blockIdx = 0; blockIdx < kBlock/16; ++blockIdx)` 这类循环无法展开，Cube 侧性能直接损失。
- **兜底寄居在 key2**：`dk > 128` 时 `tilingKey` 走默认值 2。 **代价说清楚**：兜底 shape 会连带载入 96 桶实例里的整段 Cube 机器码，而这些指令永不被执行——换来的是"不必为兜底编第 5 个实例"。这是"实例数"与"死代码体积"之间的取舍，作者选了实例数。
- 行 33-49 的四段**逐字符同构**。

---

# 第二部分：`chunk_gated_delta_rule_tiling_data.h`（1-52，全文）

**先给结论：这份文件与 !1108 的同名文件 `diff` 无输出（逐字节相同，52 行含末行空行）。** 所以本节的重点不是"改了什么"，而是"为什么 Cube 化不需要动它"——这本身就是对 Cube 化性质最有力的刻画。

## 4. `tiling_data.h` 逐字段（1-52，全文）

下面 4.1-4.5 五节按行区间覆盖整份 52 行；4.4 是本节的实质（16 个字段逐个给出 device 侧读者与"Cube 化改变了哪个字段的解释"）。

### 4.1 License 头（1-16）

锚点：chunk_gated_delta_rule_tiling_data.h:1-16

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

### 4.2 Include guard 与唯一的 include（17-21）

锚点：chunk_gated_delta_rule_tiling_data.h:17-21

```cpp
#ifndef CHUNK_GATED_DELTA_RULE_TILING_DATA_H
#define CHUNK_GATED_DELTA_RULE_TILING_DATA_H

#include "kernel_operator.h"  // NOLINT(build/include_subdir)
```

### 4.3 全局作用域的理由与打包指令（22-32）

锚点：chunk_gated_delta_rule_tiling_data.h:22-32

```cpp
// ChunkGatedDeltaRuleTilingData MUST stay in the global namespace (not under a
// user namespace). CANN's REGISTER_TILING_DEFAULT / GET_TILING_DATA autogen emit
// the tiling key and reference this struct from global scope; namespacing it makes
// those symbols <ns>::-qualified ("cgdr::ChunkGatedDeltaRuleTilingData",
// "cgdr::chunk_gated_delta_rule_0_tilingkey") and they fail to resolve, aborting
// the device-kernel compile. Mirrored by op_host/chunk_gated_delta_rule_tiling.h.
// kTilingDataAlign is the 8-byte packing CANN assumes for the host->device tiling
// byte stream; both #pragma pack and alignas must use the same value.
constexpr int kTilingDataAlign = 8;
#pragma pack(push, 8)
struct alignas(kTilingDataAlign) ChunkGatedDeltaRuleTilingData {
```

### 4.4 16 个字段：device 侧的读者是谁（33-49）

锚点：chunk_gated_delta_rule_tiling_data.h:33-49

```cpp
  uint32_t vectorCoreNum;
  uint32_t ubCalSize;
  uint32_t ubRestBytes;
  uint32_t t;    // total sequence length
  uint32_t hqk;  // number of q/k heads
  uint32_t dk;   // key head dim
  uint32_t hv;   // number of value heads
  uint32_t dv;   // value head dim
  uint32_t chunkSize;
  uint32_t numChunks;
  uint32_t b;  // batch size
  uint32_t padSize;
  uint32_t hasGamma;  // optional g input is present
  float scaleValue;
  uint32_t vStep;  // tile size for V dimension in state processing
  uint32_t debug;  // debug print flag
};
```

**读者清单（由 `kernel.h:78-93` 的构造函数唯一决定）**：16 个字段里被 device 读的只有 10 个。下面这张表把"Cube 化让哪几个字段的**解释**变了"讲清楚（字段本身一个没动，见 01 篇 §4 的 host 侧同表）：

| 字段 | device 读者 | Cube 化后的解释变化 |
| --- | --- | --- |
| `vectorCoreNum` | 无 | 无变化；名字里的 "vector" 在 AIC_ONLY 下已不准确，但值仍来自 `GetCoreNumAiv()` |
| `ubCalSize` | 无 | 无变化（仅观测） |
| **`ubRestBytes`** | `kernel.h:89 → restUbSize_ → kernel.h:158 InitBuffer` | **有**：数值由 `alignK = cubeDk` 的新记账公式算出，含义从"UB 减 FP32 队列"变成"UB 减按桶宽对齐的 FP16 队列" |
| `t` | `T_`（写入但从不读，`grep` 计数在两份快照里都是 2） | 无变化，仍是死赋值 |
| `hqk` | `NK_` | 无变化 |
| **`dk`** | `kernel.h:81 → realK_`；`kernel.h:90-91` 参与 `naturalAlignK` 与桶判断 | **有**：从"决定对齐宽度"降级为"只提供真实有效宽度"；对齐改由 `kSpecializedDk` 决定 |
| `hv` | `NV_` | 无变化 |
| **`dv`** | `kernel.h:83 → realV_`；`kernel.h:93 → stateWorkspaceStrideV_` | 无变化，但 `ShouldSplitVTiles()` 改成只看 `realV_ > vStep_` 之后，`dv` 与 `vStep` 的大小关系第一次成为唯一的切 tile 判据 |
| `chunkSize` | `kernel.h:85 → chunkSize_` | 无变化；但 `IsCubeFastPath` 要求 `chunkLen == 64`，64 从性能参数变成硬前提 |
| `numChunks` | `numChunks_`（写而不读） | 无变化，仍是死赋值 |
| `b` | `kernel.h:78 → B_` | 无变化；`B_` 在 `GetCubeStageBase`（`kernel.h:250`）里第一次参与 Cube 暂存偏移的计算 |
| `padSize` | 无 | 无变化（仅观测/仅 host 内部用） |
| `hasGamma` | `kernel.h:87 → hasGamma_ → kernel.h:123` 决定是否 `SetGlobalBuffer` | 无变化 |
| `scaleValue` | `kernel.h:84 → scale_` | 无变化 |
| **`vStep`** | `kernel.h:88 → vStep_ → kernel.h:135/173/213/229` | **有**：允许 `vStep > dv` |
| `debug` | 无 | 无变化（host 写死 0，device 从不读） |

三个"**有**"字段的共同点：**变化发生在"这个数被怎么用"，而不是"这个数是什么类型/叫什么名"**。这也是为什么 01 篇与本篇能同时说"协议一字未改"与"语义大幅变化"。

### 4.5 收尾（50-52）

锚点：chunk_gated_delta_rule_tiling_data.h:50-52

```cpp
#pragma pack(pop)

#endif  // CHUNK_GATED_DELTA_RULE_TILING_DATA_H
```

---

# 第三部分：`chunk_gated_delta_rule.h`（1-131，基础设施）

## 5. License、guard 与 include（1-22）

锚点：chunk_gated_delta_rule.h:1-22

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

#ifndef CHUNK_GATED_DELTA_RULE_KERNEL_H_
#define CHUNK_GATED_DELTA_RULE_KERNEL_H_

#include "kernel_operator.h"                     // NOLINT(build/include_subdir)
#include "chunk_gated_delta_rule_tiling_data.h"  // NOLINT(build/include_subdir)
```

- **本文件与 !1108 的 1-33 行逐字节相同**
## 6. 全局作用域注释与常量：两处新增的 GM 暂存常量（23-41）

锚点：chunk_gated_delta_rule.h:23-41

```cpp
using namespace AscendC;  // NOLINT(build/namespaces)

// NOTE: CGDR + helpers intentionally live in the GLOBAL namespace (not a user
// namespace). On some CANN toolchains the op-kernel autogen expands the tiling
// macros (REGISTER_TILING_DEFAULT / GET_TILING_DATA) and, when a user namespace
// is open, emits the tiling-data type / tiling-key as <ns>::-qualified symbols
// that then fail to resolve ("unknown type 'ChunkGatedDeltaRuleTilingData'",
// "undeclared identifier '..._tilingkey'") and abort the device-kernel compile.
// Keeping everything global matches the CANN sample-operator convention and
// removes the namespace as an autogen variable. Each op is its own translation
// unit, so global symbols here do not collide with other ops.
constexpr uint64_t BUFFER_NUM = 1;
constexpr uint64_t FP16_NUM_PER_BLOCK = 16;
constexpr uint64_t FP32_NUM_PER_BLOCK = 8;
constexpr int64_t BLOCK_BYTES = 32;
constexpr uint64_t CUBE_STAGE_SLOT_BYTES = 64 * 1024;
constexpr uint32_t CUBE_STAGE_SLOT_COUNT = 2;
// Number of Taylor-series terms used by ScalarExp to approximate exp on a scalar.
constexpr int kExpTaylorTerms = 12;
```

- **行 38-39 是本 PR 新增的两枚常量**：
  - 行 38 `CUBE_STAGE_SLOT_BYTES = 64 * 1024`：GM 上**一个 slot** 的字节数。它的含义是"一次补偿乘法的操作数总量"：A 的高/低两半各 `64×128` FP16（`2 × 64 × 128 × 2 B = 32768 B`）+ B 的 `128×128` FP16（`32768 B`）= `65536 B`。**注意它用字面量 `64 * 1024` 表达，而不是用 `kMatmulM/K/N` 的乘式表达**——host 侧 `tiling.cpp:48-49` 恰恰是用乘式表达同一个数（`kCubeStageSlotCount * (2*kMatmulM*kMatmulK + kMatmulK*kMatmulN) * sizeof(uint16_t)`）。
  - 行 39 `CUBE_STAGE_SLOT_COUNT = 2`：每核两个 slot，构成 MTE3（UB→GM 写）与 MTE2（GM→L1 读）与 Mmad 之间的软件流水。它是 host 侧 `kCubeStageSlotCount = 2`（`tiling.cpp:47`）的 device 镜像。
  - **这两处构成的跨侧契约是全 PR 最脆的地方**：`2 × 64 KiB = 131072 = kRawMatmulStageBytesPerCore` 只在"两个 64 KiB 字面量恰好等于 host 那道算式"时成立，**没有任何编译期或运行期检查**。一旦有人改 `tiling.cpp` 的 `kMatmulK`（例如 128 → 256，slot 需要 192 KiB）而忘了改 `kernel.h:38`，host 就会少申请 workspace，device 的 `GetCubeStageBase` 会稳定越界。修法是把 slot 大小也做成 device 侧的算式（device 侧本就有 `kMatmulM/K/N` 的 constexpr，见 `kernel.h:1023-1024`），两侧共用同一表达式形状；本 PR 没做。
  - 另一个可见的浪费：**64 桶只用掉 slot 的一半**。slot 按 `64×128` 的 A 与 `128×128` 的 B 预留，而 `dk ≤ 64` 时 A 是 `64×64`、B 是 `64×64`，实际需要 `2×64×64×2 + 64×64×2 = 24576 B`，不到 64 KiB 的 40%。GM 暂存是按核预留的静态空间，浪费不产生时延，但它是"四桶共用同一套 slot 尺寸"的直接后果。
- 行 40-41 `kExpTaylorTerms = 12`：`ScalarExp` 用 12 项泰勒展开近似 `exp`。**这个常量与 Cube 化无关，但它解释了兜底路径为什么慢**：Vector-only 路径逐标量算 exp，12 项乘法链；Cube 版把很多这类标量运算吸收进矩阵乘（02b 篇 §5 提到的 `expGCum` 预计算就是配套改动之一）。

## 7. `CopyToGm`：UB→GM 的对齐分派工具（42-59）

锚点：chunk_gated_delta_rule.h:42-59

```cpp
template <typename T>
__aicore__ inline void CopyToGm(GlobalTensor<T> dstGm, LocalTensor<T> inLocal, DataCopyExtParams copyParamsIn) {
  int64_t elem = copyParamsIn.blockLen / sizeof(T);
  int64_t numPerBlock = BLOCK_BYTES / sizeof(T);
  int64_t alignElem = AlignUp(elem, numPerBlock);
  if (likely(alignElem == elem)) {
    DataCopyParams copyParams = {static_cast<uint16_t>(copyParamsIn.blockCount),
                                 static_cast<uint16_t>(alignElem / numPerBlock), 0, 0};
    DataCopy(dstGm, inLocal, copyParams);
  } else {
    DataCopyParams copyParams = {1, static_cast<uint16_t>(alignElem / numPerBlock), 0, 0};
    for (uint32_t i = 0; i < copyParamsIn.blockCount; i++) {
      DataCopy(dstGm[i * elem], inLocal[i * alignElem], copyParams);
      PipeBarrier<PIPE_MTE3>();
    }
  }
}
```

**这段代码 !1108 有、!1135 一字未改**（`00e39ab5:41-57`）。
## 8. `CGDRInitParams`：入口参数的聚合体（60-72）

锚点：chunk_gated_delta_rule.h:60-72

```cpp
struct CGDRInitParams {
  GM_ADDR query;
  GM_ADDR key;
  GM_ADDR value;
  GM_ADDR beta;
  GM_ADDR initialState;
  GM_ADDR actualSeqLengths;
  GM_ADDR gOptional;
  GM_ADDR attnOut;
  GM_ADDR finalState;
  GM_ADDR workspace;
};
```

- 与 !1108（`00e39ab5:59-70`）**逐字节相同，10 个成员一个没增没减**
## 9. 类模板头与构造函数：编译期分桶的落点（73-103）

锚点：chunk_gated_delta_rule.h:73-103

```cpp

template <typename inType, typename outType, uint32_t kSpecializedDk>
class ChunkGatedDeltaRule {
 public:
  __aicore__ inline explicit ChunkGatedDeltaRule(const ChunkGatedDeltaRuleTilingData *tilingData) {
    B_ = tilingData->b;
    T_ = tilingData->t;
    NK_ = tilingData->hqk;
    realK_ = tilingData->dk;
    NV_ = tilingData->hv;
    realV_ = tilingData->dv;
    scale_ = tilingData->scaleValue;
    chunkSize_ = tilingData->chunkSize;
    numChunks_ = tilingData->numChunks;
    hasGamma_ = tilingData->hasGamma;
    vStep_ = tilingData->vStep;
    restUbSize_ = tilingData->ubRestBytes;
    uint32_t naturalAlignK = Ceil(tilingData->dk, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;
    alignK_ = (kSpecializedDk != 0 && tilingData->dk <= kSpecializedDk) ? kSpecializedDk : naturalAlignK;
    stateStrideK_ = alignK_;
    stateWorkspaceStrideV_ = Ceil(tilingData->dv, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
    load_ = 0;
    usedblk_ = 0;
    avgload_ = 0;
    // Set in Init()/InitLocalBuffers(); zero-initialized here so every member is
    // defined before first use (the kernel constructor runs before those calls).
    pipe_ = nullptr;
    vStepAligned_ = 0;
    blockIdx_ = 0;
    workspaceAddr_ = nullptr;
  }
```

### 9.1 行 74：第三个模板参数的意义

- `template <typename inType, typename outType, uint32_t kSpecializedDk>`：!1108 是 `template <typename inType, typename outType>`（`00e39ab5:72`）。**新增的是第一个非类型模板参数（non-type template parameter）**，它带来三种能力，本 PR 三种都用了：
  1. **参与 `constexpr` 计算**：`kernel.h:628 constexpr uint32_t kBlockedScratchMinV = (kSpecializedDk == 0) ? 128 : kSpecializedDk;` —— 桶宽直接变成一个编译期常量，可以被后续循环边界、数组尺寸使用。
  2. **参与 `if constexpr` 的编译期分支**：**未被选中的分支根本不进入机器码**（不是"运行期跳过"），所以 Vector 兜底代码与 Cube 代码可以在同一个函数体里共存而互不拖累。
  3. **参与常量折叠**：`Mmad` 的 `kBlock`、`Nd2NzParams` 的字段（`kernel.h:1081-1082` 用 `kMatmulK/kMatmulN` 作模板实参）在桶宽确定后全部成为立即数，编译器可以把乘法、除法、移位全折成常量。
- **为什么是"值"而不是"policy 类"**：AscendC 里非类型模板参数是最便宜的分派方式（不需要 tag 类、不需要 traits），而且能直接当尺寸用。代价是它只能表达"一个整数"，所以本 kernel 的整个 Cube 策略被压成"一个 dk 桶宽"——这与 02 篇 §3.2 那张四桶表是同一件事的两种写法。
- **`inType/outType` 一直是 `half/half`**（见 §2/§3 的四次实例化）。def.cpp 里 FP32 的 `initial_state` 在 `SetGlobalTensors` 用 `(__gm__ float *)` 强转（行 128），所以第三个参数才是模板化的重点，前两个目前是形式上的泛化。

### 9.2 行 78-89：12 行 tiling → 成员的搬运

- 行 78-89 是**纯搬运**（`B_ = tilingData->b;` 等 12 行），与 !1108 的 `00e39ab5:76-87` 逐字节相同。
### 9.3 行 90-92：三行是本次构造函数的核心改动

- 行 90 `uint32_t naturalAlignK = Ceil(tilingData->dk, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;`
  **这正是 !1108 行 88 的原始表达式**
- 行 91 `alignK_ = (kSpecializedDk != 0 && tilingData->dk <= kSpecializedDk) ? kSpecializedDk : naturalAlignK;`
  - 前半 `kSpecializedDk != 0`
  - 后半 `tilingData->dk <= kSpecializedDk`：**"桶必须装得下真实宽度"**。这正是 02 篇 §12 说的"padded 列贡献精确 0 所以桶可以大于 dk"的运行期兑现。
  - **`kSpecializedDk != 0` 是编译期可判的**（模板实参是常量），所以四个实例里 `<…,64/80/96/128>` 三个…其实四个都非 0 ——**这个子条件在四个实例里恒为真**，它真正防的是"将来出现 `kSpecializedDk == 0` 的第 5 个实例"（纯通用 kernel）。也就是说：**这半句是给不存在的实例写的保险**。它没有成本（编译期折叠），但读代码时要清楚它当前不起作用，否则会误以为"存在一个 dk=0 桶的实例"。
  - **与 host 侧的等价性**（02b §4 已给完整证明）：因为 `tilingKey` 保证 `dk ≤ 128` 时一定选中 `kSpecializedDk ≥ dk` 的实例，所以行 91 走 false 分支的唯一情形是 `dk > 128`，与 `tiling.cpp:286` 的 `cubeDk == 0` 边界重合。**两侧同值，但无人检查**。
- 行 92 `stateStrideK_ = alignK_;`
  **删掉的是 !1108 行 89 的 `stateStrideK_ = Ceil(dk, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;`**。连带后果（按影响顺序）：
  1. GM state 镜像的行距从"dk 按 8 对齐"变成"按桶宽"，于是 host 侧 `ComputeTmpBuffBytes` 里 `stateStrideK = CeilAlign(dk, 8)` 那一行也必须删（`tiling.cpp:146` 现在是 `stateStrideK = alignK`），否则两侧账不同——**这就是 02 篇 §9.1 那条 `dk` 形参删除级联的 device 侧起点**。
  2. FP32 与 FP16 两套对齐被合并成一套。因为桶宽 64/80/96/128 **同时是 16 和 8 的倍数**，`Ceil(·,16)*16` 与 `Ceil(·,8)*8` 在桶宽上结果相同，所以合并是无损的；而在 `dk > 128` 的兜底分支上，`alignK_ = Ceil(dk,16)*16` 必然也是 8 的倍数，`stateStrideK_ = alignK_` 于是只会**多不会少**（可能比原来的 `Ceil(dk,8)*8` 多至多 8 个 float），安全方向正确。
  3. device 侧所有 `stateStrideK_ * avStepAligned` 形态的容量式与 host 侧一一对应，读代码时 `alignK_` 与 `stateStrideK_` 现在是同一个数的两个名字。**保留两个名字而不是合并成一个**是对的：它们语义不同（UB K tile 行宽 vs GM state 镜像行距），只是当前取值恒等；将来若引入"K 用 FP16 桶、state 用 FP32 桶"的设计，改动点就是这一行。
- 行 93 `stateWorkspaceStrideV_ = Ceil(dv, 8) * 8;`：与 !1108 相同，但**读者变了**——`GetCubeStageBase`（`kernel.h:250`）用它算 state 区元素数，从而决定 Cube 暂存区的起始偏移。也就是说 V 维的 FP32 对齐第一次进入"GM 上给 Cube 用的地址计算"，这正是 §10 要讲的那半件事。

- **行 102 `workspaceAddr_ = nullptr;` 是本 PR 新增的第四处零初始化**（!1108 到行 98 `blockIdx_ = 0;` 就结束）。它对应 `kernel.h:2421` 新增的 `GM_ADDR workspaceAddr_;`，用途见 §10。之所以必须清零：若 `Init()` 在 `blockIdx_ >= blockDim` 时提前 return（下一节），`SetGlobalTensors` 就不会跑，`workspaceAddr_` 会保持未初始化；此后任何误用 `GetCubeStageBase` 的路径都会拿到野指针。这里把它显式置空，是**把"越界写到随机地址"降级成"越界写到地址 0"**——后者在 310P 上会立刻产生可诊断的 aicore exception，而不是静默数据污染。**这是一个成本极低、价值很高的防御性写法**。

### 9.4 与 !1108 构造函数的完整差异表

| 项 | !1108（`00e39ab5 kernel.h`） | !1135（本篇） |
| --- | --- | --- |
| 类模板参数 | `:72 <inType, outType>` | `:74 <inType, outType, uint32_t kSpecializedDk>` |
| `alignK_` | `:88 Ceil(dk,16)*16` | `:90-91` 先算 `naturalAlignK`，再按桶条件取 `kSpecializedDk` |
| `stateStrideK_` | `:89 Ceil(dk,8)*8` | `:92 = alignK_` |
| `workspaceAddr_` | 不存在 | `:102` 新增并零初始化 |
| 其余 12 行赋值 + 8 行清零/注释 | 同 | 逐字节相同 |

## 10. `Init`：提前 return 与三段初始化（104-114）

锚点：chunk_gated_delta_rule.h:104-114

```cpp
  __aicore__ inline void Init(const CGDRInitParams &initParams, TPipe *pipe) {
    uint64_t blockDim = GetBlockNum();
    blockIdx_ = GetBlockIdx();
    if (blockIdx_ >= blockDim) {
      return;
    }
    pipe_ = pipe;
    SetGlobalTensors(initParams);
    InitLocalBuffers();
  }
```

与 !1108（`00e39ab5:100-110`）**逐字节相同，一行未改**。

## 11. `SetGlobalTensors`：GM Cube 暂存的准备侧（115-131）

锚点：chunk_gated_delta_rule.h:115-131

```cpp
  __aicore__ inline void SetGlobalTensors(const CGDRInitParams &initParams) {
    queryGm_.SetGlobalBuffer((__gm__ inType *)initParams.query);
    keyGm_.SetGlobalBuffer((__gm__ inType *)initParams.key);
    valueGm_.SetGlobalBuffer((__gm__ inType *)initParams.value);
    betaGm_.SetGlobalBuffer((__gm__ inType *)initParams.beta);
    initStateGm_.SetGlobalBuffer((__gm__ inType *)initParams.initialState);
    actualSeqLengthsGm_.SetGlobalBuffer((__gm__ int32_t *)initParams.actualSeqLengths);
    if (hasGamma_ != 0) {
      gGm_.SetGlobalBuffer((__gm__ float *)initParams.gOptional);
    }
    finalStateGm_.SetGlobalBuffer((__gm__ outType *)initParams.finalState);
    attnOutGm_.SetGlobalBuffer((__gm__ outType *)initParams.attnOut);
    stateWorkspaceGm_.SetGlobalBuffer((__gm__ float *)initParams.workspace);
    workspaceAddr_ = initParams.workspace;
  }

```

- 行 117-128（前 12 行）与 !1108（`00e39ab5:113-124`）**逐字节相同**。`SetGlobalBuffer` 只是把 `__gm__` 裸地址写进 `GlobalTensor` 的内部字段，**不分配、不拷贝、不校验长度**。

- **行 129 `workspaceAddr_ = initParams.workspace;` 是本 PR 新增的唯一一行**，也是"GM 上的 Cube stage 双槽"在准备侧的全部内容：
  - 为什么已经有 `stateWorkspaceGm_`（`GlobalTensor<float>`）还要多存一个裸 `GM_ADDR`：`GlobalTensor` 的元素类型是 `float`，用它做偏移会按 4 字节缩放；而 `GetCubeStageBase` 返回的是 `__gm__ uint8_t *`，**偏移单位是字节**。用裸地址 + 显式 `sizeof` 才不会被 `GlobalTensor` 的元素语义绑架，也才能把 A/B 操作数按 `half` 重新解释。
  - 行 128 与行 129 是**同一个地址的两种视图**（带类型的 tensor / 无类型的字节指针），两者必须来自同一个 `initParams.workspace`。若有人只改一行（例如给 state 镜像换成 userWorkspace 的某个偏移），另一行就会漂走——**这里没有共同变量、只有共同右值**，属于可维护性弱点。
  - **"双槽"这件事在本函数里没有任何体现**：slot 的分配是纯地址算术（`blockIdx_ * CUBE_STAGE_SLOT_COUNT + slot`），不需要初始化、不需要绑定 tensor、不需要申请。这是"在 host 已申请好的大 workspace 里做二级分区"的典型做法——**准备侧只有 1 行，代价全部推到使用侧的偏移计算与 host 侧的字节账**。这也是本篇最想传递的结构性判断：GM Cube 暂存是一个"约定"，不是一个"资源对象"，因此它的正确性只能靠人工对齐。
- **与 !1108 的 `SetGlobalTensors` 的唯一差异就是行 129**（`00e39ab5:113-124` 是那 12 行，`!1135` 多 1 行）。

---