锚点见各小节首行。本篇覆盖三个文件的指定区间：`op_kernel/chunk_gated_delta_rule.cpp` 1-36（全文）、`op_kernel/chunk_gated_delta_rule_tiling_data.h` 1-52（全文）、`op_kernel/chunk_gated_delta_rule.h` 1-126。kernel.h 的剩余部分（127-238：`InitLocalBuffers` 的 UB 手工布局、`ComputeAvgload`、`Process` 的分核逻辑）由 03b 篇承接——两篇合起来才是该文件前 238 行的全覆盖。拆分位置选在 126/127，因为 L126 是 `SetGlobalTensors` 的收尾（"外部世界"绑定完毕），L127 起是 `InitLocalBuffers`（"内部资源"分配），语义边界与行号边界重合。

## 1. kernel.cpp:1-19 — 许可证、单一 include 与全局 using

锚点：chunk_gated_delta_rule.cpp:1-19

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


- L17 `#include "chunk_gated_delta_rule.h"`：本文件**只有这一个 include**。这是 AscendC 算子 kernel 的典型"单一 TU"结构——`chunk_gated_delta_rule.cpp` 是唯一被单独编译的 device 翻译单元，所有实现都在同名头里（含 `tiling_data.h`，由 kernel.h:21 带入）。尾部的 `// NOLINT(build/include_subdir)` 是 cpplint 抑制标记：同目录引号 include 会被规则误判为"应写成子目录路径"，三个文件（host tiling.cpp:19、kernel.h:20-21、此处）都带同样的标记，说明这是仓库级统一处理而非个人习惯。

- L19 `using namespace AscendC;`：`GM_ADDR`、`TPipe`、`GetUserWorkspace`、`__aicore__` 相关的内建类型与 API 全部在 `AscendC` 命名空间下，不引这个 using 就得把 L29 写成 `AscendC::GetUserWorkspace(...)`。`// NOLINT(build/namespaces)` 抑制的是"头文件里禁止 using-directive"这条 lint——在 .cpp 里其实合法，加标记是为了和 kernel.h:23 的同一条 using 保持一致口径。

## 2. kernel.cpp:20-25 — 全局命名空间声明与 11 个 GM_ADDR 形参

锚点：chunk_gated_delta_rule.cpp:20-25

```cpp

// The kernel entry and tiling macros must remain in the global namespace.
extern "C" __global__ __aicore__ void chunk_gated_delta_rule(GM_ADDR query, GM_ADDR key, GM_ADDR value, GM_ADDR beta,
                                                             GM_ADDR initialState, GM_ADDR actualSeqLengths,
                                                             GM_ADDR gOptional, GM_ADDR out, GM_ADDR finalState,
                                                             GM_ADDR workspaceGM, GM_ADDR tilingGM) {
```

- L21 一句注释把整篇最关键的一条硬约束写在**入口正上方**：入口函数与 tiling 宏必须待在全局命名空间。为什么"写在三个文件里还不嫌多"：这条约束没有任何编译期机制保护（加个 `namespace cgdr { ... }` 完全"看起来正常"），失效形式是远端 device 编译报两条难懂的错，而 tiling_data.h:22-29 记录的正是那次失败的原始报错文本。
- L22-25 函数声明，三个修饰语叠加，各自不可省：
  - `extern "C"`：关闭 C++ name mangling。框架是按**算子名字符串**（def.cpp:80 `OP_ADD(ChunkGatedDeltaRule)` 注册出来的 kernel 名 `chunk_gated_delta_rule`）去 `.o`/`.bc` 里找符号的，一旦 mangle 成 `_Z22chunk_gated_delta_ruleP...` 就找不到，表现为"算子注册成功但下发时报 undefined symbol"。
  - `__global__`：设备侧核函数（有独立地址空间、由 host/框架 launch）。
  - `__aicore__`：CANN 对"跑在 AI Core 上"的额外标记，影响编译器选择 aicore 指令集与 ABI；两者同时出现是 Ascend310P/910B 两代后端的共同要求。
- 返回类型 `void`：kernel 不向框架回传状态，正确性完全靠数据本身（这也是为什么 kernel 里所有异常路径都只能"少算"而不能"报错"）。
- **形参是 11 个 `GM_ADDR`，而公共接口只有 7 入 2 出 = 9 个张量**。多出来的两个是框架追加的：`workspaceGM`（02 篇 §16 申请的那段 workspace 的首地址）与 `tilingGM`（host 那份 64 字节协议结构体的设备侧地址）。前 9 个的顺序**严格等于 def.cpp 里 `Input(...)/Output(...)` 的书写顺序**（query key value beta initial_state actual_seq_lengths g | out final_state），是纯**按位置绑定**，编译器不检查名字也不检查类型/精度——类型信息只存在于 host 的 def 声明和 kernel 里 `SetGlobalBuffer` 的强转两边，两处都写错才会被发现。
- `gOptional` 这个名字（而非 `g`）在点上一句提醒：它是 OPTIONAL 输入。图里没给 g 时框架传的是空指针，kernel 必须靠 `hasGamma_` 判断后再解引用（kernel.h:119-121）。


## 3. kernel.cpp:26-31 — 两个 tiling 宏、AIV-only 声明、workspace 与参数打包

锚点：chunk_gated_delta_rule.cpp:26-31

```cpp
  REGISTER_TILING_DEFAULT(ChunkGatedDeltaRuleTilingData);
  GET_TILING_DATA(tilingData, tilingGM);
  KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIV_ONLY);
  GM_ADDR userWorkspace = GetUserWorkspace(workspaceGM);
  CGDRInitParams initParams{query,     key, value,      beta,         initialState, actualSeqLengths,
                            gOptional, out, finalState, userWorkspace};
```

- L26 `REGISTER_TILING_DEFAULT(ChunkGatedDeltaRuleTilingData);`：展开后在**全局作用域**生成该算子的 tiling key 与结构体关联（0/号 tiling key 对应 host 侧 `SetTilingKey(0)`，见 02 篇 §15）。宏参数就是结构体类型名，因此这个名字必须是全局可见的——这正是 L21 那条约束的两个消费点之一。
- L27 `GET_TILING_DATA(tilingData, tilingGM);`：以 `tilingGM` 为源，在**栈上**声明一个名为 `tilingData` 的 `ChunkGatedDeltaRuleTilingData` 对象并把字节流解释成结构体。注意它用的是 **device 侧那份定义**（`chunk_gated_delta_rule_tiling_data.h`），而写入方用的是 host 那份（`op_host/chunk_gated_delta_rule_tiling.h`）；两份定义没有任何编译期联系，"字段顺序/宽度/对齐三件套必须一致"完全靠人肉纪律，这是 §9 做逐字段镜像对照的全部动机。
- L28 `KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIV_ONLY);`：向编译器声明"本 kernel 只用 Vector 核，不产生 Cube 任务"。作用是三条：
  - ① 允许后端不做 Cube/Vector 混合调度与相应的 L1/L0 资源预留，省下的编译期检查与运行时开销都在 AIC 路径上；
  - ② 与 def.cpp:78 的 `AICore()` 配置、`AddConfig("ascend310p")` 相呼应；
  - ③ 必须出现在任何 AscendC API 之前，它是编译指示而不是运行时代码。本 PR 就是标题里的"向量化基线"：一切矩阵乘都用 Vector 的逐元素 + 归约模拟。
- L29 `GM_ADDR userWorkspace = GetUserWorkspace(workspaceGM);`：`workspaceGM` 的头一段由框架自用（记录大小、对齐等管理信息），`GetUserWorkspace` 返回**跳过头部之后的用户可用起点**。所以 kernel 里所有 workspace 寻址都以 `userWorkspace` 为基址，与 host 侧 `ws[0] = 字节数`（02 篇 §16）说的是"同一段用户区的大小"。这层间接是必须的：直接把 `workspaceGM` 当数据区用会踩到框架的管理头。
- L30-31 `CGDRInitParams initParams{...}`：**聚合初始化**，十个初值按 §5 结构体的字段顺序逐个落位。两个细节值得单独说：
  - 第 8 个实参是入口形参 `out`，落进的字段却叫 `attnOut`（kernel.h:67）——**改名是有意的语义标注**：公共接口输出的是"注意力/新值序列" `[T, Hv, Dv]`，kernel 内部一律把它当 attn 结果写，叫 `attnOut` 让后面 200 多行的读写点不会和 `finalState` 混淆。因为聚合初始化按位置不按名字，改名是零成本的。
  - 第 10 个实参是 L29 算出的 `userWorkspace` 而不是 `workspaceGM`，即"剥头"这件事在入口做一次，kernel 内部再不管。

## 4. kernel.cpp:32-36 — TPipe、模板实参与两次调用

锚点：chunk_gated_delta_rule.cpp:32-36

```cpp
  TPipe pipe;
  ChunkGatedDeltaRule<half, half> op(&tilingData);
  op.Init(initParams, &pipe);
  op.Process();
}
```

- L32 `TPipe pipe;`：TPipe 是 UB 分配与流水线的总管，`InitBuffer` 全部经由它（kernel.h:138/153）。**声明顺序即生命周期顺序**：`pipe` 必须先于 `op` 构造、因此在 `op` 之后析构——op 里存的是 `TPipe *pipe_` 裸指针，若把两者声明顺序反过来，函数返回时 `pipe` 先析构，`op` 的析构（虽然平凡）就会看到野指针。当前写法是 AscendC 的通用样板。
- L33 `ChunkGatedDeltaRule<half, half> op(&tilingData);`：两个模板实参是 `inType/outType`（kernel.h:72）。**输入 FP16、输出 FP16**，与 def.cpp 的 `DT_FLOAT16` 对齐；`float` 只在中间量与 workspace 里出现，所以不体现在模板参数上（`gGm_`/`stateWorkspaceGm_` 是硬编码 `float`，见 kernel.h:921/927）。传 `&tilingData` 是取 L27 那个栈对象的地址——因此永不为空，构造函数里也就没有判空。
- L34 `op.Init(initParams, &pipe);`：Init 内部依次做 `GetBlockNum/GetBlockIdx` → 存 `pipe_` → `SetGlobalTensors` → `InitLocalBuffers`（§18）。注意 Init **可能有条件地什么都不做**（L104 的提前返回），这是本篇末尾一个跨函数的隐患点。
- L35 `op.Process();`：真正的计算主体（03b 篇 §5）。它被**无条件**调用，即使 L34 的 Init 提前返回了——正常情况下 L104 的条件永不成立，所以今天不出事，但这个不对称写法意味着：哪天框架真的多下发了 block，`Process` 会在未绑定的 GlobalTensor 上取值。
- L36 `}`：入口结束。没有显式的 `SetAtomicCounter`/结束同步——AIV kernel 的结束由框架的 task 语义处理，函数体自然返回即可。整个入口 36 行里没有一处业务逻辑，这是 AscendC 算子的通用形态：**入口只负责"取协议、拆 GM、组装对象"**，其余全在类里。

## 5. tiling_data.h:1-16 — 许可证头

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

- L1-L15 与前面两个文件逐字符相同的 Apache-2.0 许可证头（L2 年份 2026、L15 `*/` 收束），L16 空行。它出现在每个新文件里，因此读代码时可整体跳过，但"覆盖"要求下它得在这里被算一次：三份拷贝完全一致这一点本身就是仓库纪律的证据。

## 6. tiling_data.h:17-21 — include guard 与 device 端 kernel_operator.h

锚点：chunk_gated_delta_rule_tiling_data.h:17-21

```cpp
#ifndef CHUNK_GATED_DELTA_RULE_TILING_DATA_H
#define CHUNK_GATED_DELTA_RULE_TILING_DATA_H

#include "kernel_operator.h"  // NOLINT(build/include_subdir)

```

- L17-L18 `#ifndef/#define` 标准 include guard。宏名 = 文件名大写，与 kernel.h:17 的 `CHUNK_GATED_DELTA_RULE_KERNEL_H_`（多一个尾下划线）风格不一致，属仓库内两种写法并存，无功能影响；真正影响功能的是 guard **必须**存在——这个头会被 kernel.h 与（经由它）入口 .cpp 各引一次，重复定义 `struct ChunkGatedDeltaRuleTilingData` 直接编译失败。

- L20 `#include "kernel_operator.h"`：AscendC 的设备侧总入口头，提供 `uint32_t/float` 在 aicore 上的可用形式、`__aicore__`、`TPipe/TQue/TBuf/GlobalTensor/LocalTensor` 全套。**结构体本身只用基础类型，理论上不需要它**，但 CANN 的 device 编译单元约定先引 `kernel_operator.h`，且 `REGISTER_TILING_DEFAULT` 展开时会依赖它的类型环境；这一行是"协议头"与"实现头"合并编译的安全垫。
## 7. tiling_data.h:22-29 — 把编译失败原因写进注释的八行

锚点：chunk_gated_delta_rule_tiling_data.h:22-29

```cpp
// ChunkGatedDeltaRuleTilingData MUST stay in the global namespace (not under a
// user namespace). CANN's REGISTER_TILING_DEFAULT / GET_TILING_DATA autogen emit
// the tiling key and reference this struct from global scope; namespacing it makes
// those symbols <ns>::-qualified ("cgdr::ChunkGatedDeltaRuleTilingData",
// "cgdr::chunk_gated_delta_rule_0_tilingkey") and they fail to resolve, aborting
// the device-kernel compile. Mirrored by op_host/chunk_gated_delta_rule_tiling.h.
// kTilingDataAlign is the 8-byte packing CANN assumes for the host->device tiling
// byte stream; both #pragma pack and alignas must use the same value.
```
略

## 8. tiling_data.h:30-32 — 对齐常量、pack push 与 struct 头

锚点：chunk_gated_delta_rule_tiling_data.h:30-32

```cpp
constexpr int kTilingDataAlign = 8;
#pragma pack(push, 8)
struct alignas(kTilingDataAlign) ChunkGatedDeltaRuleTilingData {
```

- L30 `constexpr int kTilingDataAlign = 8;`：类型选 `int` 而不是 `uint32_t/size_t`——它只作为 `alignas(...)` 的实参出现（编译器会做整型到 `size_t` 的常量转换），且 host 侧那份同名常量（host tiling.h:28）也是 `int`，两侧**必须同型**，否则"镜像"就不完全。8 的取值来自 CANN 的 tiling 字节流假定，不是本算子的需要。
- L31 `#pragma pack(push, 8)`：`push` 先把当前 packing 压栈，再设为 8。`push/pop` 成对（L50）是必须的——头文件里裸写 `#pragma pack(8)` 会把这条设置泄漏给后续所有 include，污染整条编译链。为什么值是 8 而不是 4：结构体成员最大自然对齐是 4（`uint32_t`/`float`），pack(8) 比自然值更宽，因此**今天不改变任何偏移**；写 8 是取"编译器默认对齐"这个上限，使将来若插入 `uint64_t`（自然对齐 8）时不会被 pack(1)/pack(4) 静默改变布局。
- L32 `struct alignas(8) ChunkGatedDeltaRuleTilingData {`：结构体对齐 8 ⇒ `sizeof` 必须是 8 的倍数。16 个字段各 4 字节 = 64 字节，正好是 8 的倍数 ⇒ **尾部零填充**，`sizeof == 64 == 13*4 + 4 + 2*4`。这个"刚好整除"是巧合也是约束：任何一侧新增一个 4 字节字段仍保持 68→（对齐到 8）72，两侧必须同步；若只一侧加，`sizeof` 差异不会报错，只会让 device 从第 17 个字段起全部错位。

## 9. tiling_data.h:33-48 — 16 个字段的 device 侧读法与两侧镜像对照

锚点：chunk_gated_delta_rule_tiling_data.h:33-48

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
```

- 16 个字段的**类型、顺序、偏移**与 host 那份（host tiling.h:31-46）**逐字节一致**，全部差异只在注释。偏移表（`alignas(8)`+`pack(8)` 下无填充）：`vectorCoreNum@0 ubCalSize@4 ubRestBytes@8 t@12 hqk@16 dk@20 hv@24 dv@28 chunkSize@32 numChunks@36 b@40 padSize@44 hasGamma@48 scaleValue@52 vStep@56 debug@60`，`sizeof=64`。
- 逐字段与 device 代码的对应关系（"谁写"永远是 host `FillTilingData`，02 篇 §12）：

| 字段 | device 行 | host 行 | device 读者（kernel.h） | 注释差异 |
|---|---|---|---|---|
| `vectorCoreNum` | 33 | 31 | **无** | host 也无注释 |
| `ubCalSize` | 34 | 32 | **无** | — |
| `ubRestBytes` | 35 | 33 | L87 → `restUbSize_`，L153 `InitBuffer(tmpBuff, restUbSize_)` | — |
| `t` | 36 | 34 | L77 → `T_`（**只赋值不读**） | host 写 "(padded)"，device 不写；**device 对，host 错**（写入值是未 pad 的 `dims.t`，host tiling.cpp:198） |
| `hqk` | 37 | 35 | L78 → `NK_`（Q/K 头数，GQA 映射的分母） | — |
| `dk` | 38 | 36 | L79 → `realK_`；L88/L89 再算 `alignK_`/`stateStrideK_` | — |
| `hv` | 39 | 37 | L80 → `NV_`（工作项主轴） | — |
| `dv` | 40 | 38 | L81 → `realV_`；L90 → `stateWorkspaceStrideV_` | — |
| `chunkSize` | 41 | 39 | L83 → `chunkSize_`（循环分块长度） | host 多一句 `// chunk size (e.g., 64)` |
| `numChunks` | 42 | 40 | L84 → `numChunks_`（**只赋值不读**） | host 多 `// number of chunks` |
| `b` | 43 | 41 | L76 → `B_`（batch 外循环上界） | device 更简洁：`// batch size` vs host `// batch size from initial_state` |
| `padSize` | 44 | 42 | **无** | host 多 `// padding size` |
| `hasGamma` | 45 | 43 | L85 → `hasGamma_`，L119 绑定 g、L252 `LoadG` 决定取 0 | 两侧同注释 |
| `scaleValue` | 46 | 44 | L82 → `scale_`（唯一被直接消费的 `float`） | 无注释（类型即语义） |
| `vStep` | 47 | 45 | L86 → `vStep_`，参与 L130/134/168/205/221 等全部 V 侧算术 | device 多一句 `// tile size for V dimension in state processing` |
| `debug` | 48 | 46 | **无**（host 也无条件写 0） | device 多 `// debug print flag` |

- 值得单独点出的是三行"注释不一致"：`t` 的 "(padded)" 是**host 侧的事实错误**（写进字段的值来自 `dims.t`，pad 只体现在 `padSize`/`numChunks` 里），docs/PR-406-00e39ab5/03 §6 沿用了这个说法；device 侧不加括号反而是对的。`chunkSize/numChunks/padSize/vStep/debug` 五条 device 独有的注释则是"读者视角"的补充——只有消费方知道自己怎么用这个数，这类**单侧加注释**是健康的，因为它不改变字节；但改注释时把两侧同步掉更省心。
- `vectorCoreNum`/`ubCalSize`/`padSize`/`debug` 四个字段在 !1108 里**没有任何 device 读者**。它们的存在理由各不相同：`debug` 是给 device 打印预留的协议位（host 无条件写 0）；`ubCalSize`（整块 UB 容量）与 `vectorCoreNum`（核数）是"给 tiling 调试留底"，实际决策已在 host 完成并以 `ubRestBytes`/blockDim 的形式落地；`padSize` 是"信息性下发"，kernel 用 `seqLen` 现算 chunk 边界，不需要全局 pad。这解释了为什么协议是 16 个字段而不是 12 个——**协议宽度是向前兼容的代价**（!1140 的 RGDR 协议里同类字段就被真正消费了）。

## 10. tiling_data.h:49-52 — 收尾三件套

锚点：chunk_gated_delta_rule_tiling_data.h:49-52

```cpp
};
#pragma pack(pop)

#endif  // CHUNK_GATED_DELTA_RULE_TILING_DATA_H
```

- L49 `};`：结构体结束。注意成员全是公有（`struct` 默认 public），device 侧是直接 `tilingData->b` 式取字段，没有访问器——协议结构体不需要封装。
- L50 `#pragma pack(pop)`：与 L31 配对恢复 packing。它放在结构体之后、`#endif` 之前，意味着**这个头之后引入的其它类型不受影响**；若漏写，`kernel.h` 里的 `CGDRInitParams`（L59）与 `ChunkGatedDeltaRule` 的若干成员都会被按 pack(8) 处理。虽然当前这些类型在 pack(8) 下布局不变，但"泄漏的 pragma"是 C++ 头文件最难查的一类污染，因为它不影响本文件编译，只影响下游。
- L51 空行。
- L52 `#endif  // CHUNK_GATED_DELTA_RULE_TILING_DATA_H`：`#endif` 后带 guard 名是仓库风格（host tiling.h:50 同样写法），只为让 500+ 行的头在折叠视图里能看出配对。

## 11. kernel.h:1-18 — 许可证与 include guard

锚点：chunk_gated_delta_rule.h:1-18

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
```

- L1-L15 同一份 Apache-2.0 许可证头（L2 年份、L15 `*/`），L16 空行。
- L17-L18 guard `CHUNK_GATED_DELTA_RULE_KERNEL_H_`（带尾下划线，与 §6 那种风格不同；这种名字理论上可能与编译器保留标识冲突，实践中 CANN 全仓库都这么写，属既有约定）。
- 本文件只有 966 行，但它是**全部业务逻辑的所在**（本篇 §11-§19 与 03b 篇 §1-§5 合计覆盖前 238 行的"骨架"，其余 700 行是各 phase 的 Vector 计算），因此头文件保护与依赖顺序在这里比在协议头里更要紧。

## 12. kernel.h:19-33 — 两个 include、全局 using 与"为什么整个类待在全局命名空间"

锚点：chunk_gated_delta_rule.h:19-33

```cpp

#include "kernel_operator.h"                     // NOLINT(build/include_subdir)
#include "chunk_gated_delta_rule_tiling_data.h"  // NOLINT(build/include_subdir)

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
```

- L19 空行。L20-21 两个 include 竖对齐（`NOLINT` 注释被 clang-format 拉齐到同一列）：`kernel_operator.h` 提供 AscendC 运行时；`chunk_gated_delta_rule_tiling_data.h` 提供协议结构体。**这两行就是入口 .cpp 只需要一个 include 的原因**（§1）。
- L22 空行。L23 `using namespace AscendC;` 出现在**头文件**里，正常 C++ 风格会禁止这么做（污染所有引入方），但这里成立的前提写在 L32-33：每个算子是独立翻译单元。这条 lint 抑制标记因此是"有意识地违规"，不是随手加的。

## 13. kernel.h:34-40 — 五个常量与 BUFFER_NUM=1 的连带后果

锚点：chunk_gated_delta_rule.h:34-40

```cpp
constexpr uint64_t BUFFER_NUM = 1;
constexpr uint64_t FP16_NUM_PER_BLOCK = 16;
constexpr uint64_t FP32_NUM_PER_BLOCK = 8;
constexpr int64_t BLOCK_BYTES = 32;
// Number of Taylor-series terms used by ScalarExp to approximate exp on a scalar.
constexpr int kExpTaylorTerms = 12;

```

- **L34 `BUFFER_NUM = 1`：这是本篇最重要的一个"1"。

**它出现在两处调用里（L138 `InitBuffer(stateOutQueue_, BUFFER_NUM, outQueueBytes)`），而队列的**模板参数本身就是 1**（L929 `TQue<QuePosition::VECOUT, 1> stateOutQueue_`），所以队列深度在编译期与运行期被双重钉死为单缓冲。连带后果是一条严格串行的出向链：`AllocTensor`（拿唯一那块缓冲）→ V 计算写满 → `EnQue` → `DeQue`（插入 V→MTE3 的依赖）→ MTE3 搬运 → `FreeTensor` → 下一次 `AllocTensor` 才能成功。也就是说**写下一个 tile 的 V 指令必须等前一个 tile 的 DMA 排空**，出向路径上 V 与 MTE3 完全不能重叠；本 kernel 里两个出向点（`WriteAttnTileToGm` kernel.h:347-371、最终 state 写回 :900-914）都走这一个队列，所以它们的开销是逐个串起来的。

为什么当时可以接受：`tmpBuff` 吃掉了 `restUbSize_`＝"UB 减去出向队列"的**全部剩余**（L153），要做双缓冲就必须把队列开到 2 块、于是 `tmpBuff` 少一整块 state tile 的空间，而 03b 篇 §1 会看到 state tile 是最大的单项开销（dk×vStep×4 字节）——在 310P 这种 UB 只有一两百 KB 的芯片上，128×128 FP32 的 state tile 与第二块队列**放不下同时成立**。作者选了"容量优先、流水其次"。

代价被后来的 PR 直接确认：!1140 的 RGDR（`src/96ea3f55/op_kernel/recurrent_gated_delta_rule.h`）把队列模板改成 `TQue<QuePosition::VECOUT, MAX_OUT_BUFFER_NUM>`（=2，:25/:635-636），运行期再按 tiling 里的 `stateOutBufferNum/attnOutBufferNum` 在 1 与 2 之间选（:173-174 `stateOutBufferNum_ = (tilingData->stateOutBufferNum == MAX_OUT_BUFFER_NUM) ? MAX_OUT_BUFFER_NUM : BUFFER_NUM;`），并在两处写回里用 `if (attnOutBufferNum_ == BUFFER_NUM)` 分流（:534、:547）。**"BUFFER_NUM 从常量变成由 host 决定的变量"正是把本版的教训写成了代码**——而这个变量之所以要 host 来定，也是因为 host 才知道 `tmpBuff` 还剩多少字节。

- **L35-36 `FP16_NUM_PER_BLOCK = 16` / `FP32_NUM_PER_BLOCK = 8`**：一个 32 字节 DMA block 里的元素数（`32/2`、`32/4`）。与 host tiling.cpp:29-30 那两个同名常量是**两份独立拷贝**，含义必须一致；`constexpr uint64_t`（与 host 的 `uint32_t` 不同）是因为这里要和 `uint64_t` 的元素偏移一起参与 `Ceil(...)`/除法而不引发符号-宽度警告。它们是"能不能走整块 DMA"的判据：任何行宽除不尽这个数，快路径就不可用（L46 的 `likely` 分支、kernel.h:452-453 的 `canUseDma` 都建立在此）。
- **L37 `BLOCK_BYTES = 32`**：MTE2/MTE3 的最小搬运粒度，硬件常数。类型选 **`int64_t`（唯一一个有符号常量）**是刻意的：它在 kernel.h:451 `srcGapBytes`、:453 `% BLOCK_BYTES`、:352 `outElemPerBlock = BLOCK_BYTES / sizeof(outType)` 这类式子里与 64 位偏移量直接混算，用有符号可避免"有符号差值 × 无符号除数"带来的隐式提升错误（`sizeof` 是 `size_t`，`int64_t / size_t` 至少不会改变正负号语义）。
- **L38 注释 + L39 `kExpTaylorTerms = 12`**：唯一带注释的常量，说明它是 `ScalarExp`（kernel.h:263-284）里多项式的项数——12 项是"标量 exp 精度够 + 不溢出"的折衷（Taylor 余项 ~`x^13/13!`）。类型 `int` 因为它的消费点是 `for (int i = 1; i <= kExpTaylorTerms; i++)`（kernel.h:273），循环计数用有符号可自然表达 `<=` 与终止。

## 14. kernel.h:41-57 — CopyToGm：32B 块对齐的两条出口

锚点：chunk_gated_delta_rule.h:41-57

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

- L41-42 全局自由函数模板 + `__aicore__ inline`：`__aicore__` 标注设备侧可内联展开的编译指示，`inline` 防头文件重复定义。两个张量句柄与 `DataCopyExtParams` 都**按值传**——`GlobalTensor/LocalTensor` 本质只是一个（可能带 16bit 对齐偏移的）地址包装，按值传零成本，反而比引用更适合 aicore 的寄存器分配。
- L43 `elem = copyParamsIn.blockLen / sizeof(T)`：**`DataCopyExtParams` 的 `blockLen` 单位是字节**（与 `DataCopyParams` 的"块数"不同，这是两套 API 最容易搞混的一点），这里立刻换算成元素数。
- L44 `numPerBlock = BLOCK_BYTES / sizeof(T)`：一个 32B 块装几个 T。
- L45 `alignElem = AlignUp(elem, numPerBlock)`：行宽向上取整到整块。`AlignUp` 是 AscendC 提供的通用对齐助手（与 host 自己写的 `CeilAlign` 同义，但 host 侧没有 AscendC 头可用，见 02 篇 §3）。
- L46 `likely(alignElem == elem)`：`likely` 是编译器的分支概率提示（内部是 `__builtin_expect`），意即"绝大多数行宽本来就是 32B 的倍数，快路径才是常规路径"。这一句同时是对**性能路径归属**的文档：dv 为 16/32/64/128 这类正常值全部走快路径。
- L47-49 快路径：`DataCopyParams` 四个字段按本 CANN 8.3 快照的顺序是 `{blockCount, blockLen, srcStride, dstStride}`，且**后三项的单位是 32B 块**（同文件 kernel.h:359-361 的 `outParams` 用 `(avFp32 - curV)/outElemPerBlock` 填第三项、`(gmRowStride - curV)/outElemPerBlock` 填第四项，可反证此序）。于是这里读作：`blockCount` 行、每行 `alignElem/numPerBlock` 个块、源与目标步长 0 ⇒ UB 连续、GM 连续，一次 `DataCopy` 完成整块矩阵输出。`static_cast<uint16_t>` 是因为这四项都是 16 位字段——**blockLen 上限 65535 块 = 2 MiB**，单行不可能这么大，转换安全。
- L50-55 慢路径（行宽不是 32B 倍数时）：逐行发一次 `DataCopy`，`blockCount=1`、块数 `alignElem/numPerBlock`，源偏移 `i*alignElem`（UB 侧按**对齐后**的行距走）、目标偏移 `i*elem`（GM 侧按**真实**行距走）——这正是"UB 内是补齐的紧凑 tile、GM 上是紧凑的真实张量"这一路贯穿本 kernel 的两套行距的收尾体现。
- L54 `PipeBarrier<PIPE_MTE3>()`：**每行一次 MTE3 流水栅栏**，把并发下发变成串行。它不是性能选择而是正确性必需，原因在下一条。
- **慢路径写超了**：每行搬运 `alignElem > elem` 个元素，即第 i 行会把 `(alignElem - elem)` 个多余元素写进第 i+1 行的开头。按 `i` 递增 + 每轮 barrier，后一行的真实写入**必定覆盖**前一行留下的尾巴，所以最终除最后一行外数据都正确；**最后一行的尾巴则越出本 tile 写到 GM 相邻内存里**（同一 `attnOut` 张量内则被下一 head/tile 覆盖，若正好落在张量末尾就是越界写）。这是一颗真实的隐患种子：调用点 kernel.h:364-368 每行外面还叠了一次 `PipeBarrier<PIPE_MTE3>()`，进一步坐实"顺序覆盖"是作者依赖的机制。后续 PR 里对"尾行越界/stride 单位"的修正（docs/PR-1158 一族）就是同一家族的问题。dv 为 32 的倍数时慢路径根本不触发，这解释了它为何能一路活到本基线版本。

## 15. kernel.h:58-70 — CGDRInitParams：十个 GM 指针的载体

锚点：chunk_gated_delta_rule.h:58-70

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

- L59 `struct CGDRInitParams {`：全局聚合体、无构造无方法，字段顺序**必须**与入口 L30-31 的花括号列表一一对应（改这里必须同时改那里，编译器只按位置初始化，**不会**因为字段改名而报错）。
- L60-66 六个输入指针：query/key/value/beta/initialState/actualSeqLengths，命名与 def.cpp 的输入名一致（`initialState`/`actualSeqLengths` 用驼峰对应公共接口的下划线名，这是仓库一致的映射习惯）。
- L67 `attnOut`：对应公共输出的 `out`（§3 解释过改名理由）。**它是全结构体里唯一一个"字段名 ≠ 形参名"的输入输出**，读 kernel 时最容易在这里对不上号。
- L68 `finalState`、L69 `workspace`（已剥头的用户区）。
- 全部字段类型都是 `GM_ADDR`（不透明地址），**类型信息在这里被完全抹掉**：FP16/FP32/INT32 的区别要到 `SetGlobalTensors`（§19）的强转那一刻才重新出现。这意味着"def 里的 dtype 与 kernel 里的强转"是两套互不相干的真值，是这类按地址传参接口最典型的错位风险。
- L70 `};`。用一个结构体而不是给 `Init` 传十个参数，是为了让签名可读、且让 `SetGlobalTensors` 能按 `initParams.xxx` 点名取用（§19 的十行就受益于此）。

## 16. kernel.h:71-85 — 类模板声明与构造函数的第一批字段拷贝

锚点：chunk_gated_delta_rule.h:71-85

```cpp

template <typename inType, typename outType>
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
```

- L71 空行。L72 `template <typename inType, typename outType>`：两个精度参数化的是**外接口两侧**（in：query/key/value/beta/initialState；out：out/final_state），中间的 FP32 计算量与 workspace 的 FP32 都是硬编码，不受模板影响。入口用 `<half, half>`（cpp:33）。理论上 `<half, float>` 这种组合能表达"输入 FP16、输出 FP32"的变体，但 def 里已把两个输出锁成 `DT_FLOAT16`，模板参数因此是"为将来留的口"。
- L73 `class ChunkGatedDeltaRule {` + L74 ` public:`：`:` 前空一格是 Google style 经 clang-format 的结果。类名与算子名同名，配合全局命名空间（§12）即"一个 TU 一个类"。
- L75 构造函数：`explicit` 阻止从 `ChunkGatedDeltaRuleTilingData*` 隐式构造对象（这里只有一条转换路径，加 explicit 是纯防御 + 表意）；参数是 `const` 指针——构造阶段只读协议，不写。`__aicore__ inline` 同 §14。
- L76-85 十个字段拷贝，命名规则值得注意：
  - `B_`/`T_`/`NK_`/`NV_`：尾下划线是成员，前缀字母是"维度"。`NK_ = hqk`、`NV_ = hv` 的 **K/V 分家**正是 GQA 的体现：Q/K 头数与 V 头数可以不同，kernel 里靠 `qkHead = head_i / (NV_ / NK_)` 做映射（见 kernel.h 后段 `ProcessHead`），所以这里必须两套计数并存。
  - `realK_ = dk`、`realV_ = dv`：**"real"前缀专门用来和"align"后缀/前缀区分**——真实头维 vs `alignK_`(L88)、`stateStrideK_`(L89)、`stateWorkspaceStrideV_`(L90) 三个对齐后的宽度。这套命名是本 kernel 可读性的关键：所有越界/对齐问题的根源都是"real 与 align 不相等"，名字区分开了才查得动。
  - `scale_ = scaleValue`：协议里唯一的 `float`，直接落进 `float scale_`(L962)。它随后被用作 QK 点积的缩放因子（乘进 FP32 中间量），因此精度损失只可能在写回 FP16 时发生。
  - `chunkSize_ = chunkSize`：分块长度，L128 立刻取本地短名 `cs`。
  - `T_`(L77) 与 `numChunks_`(L84) 拷进来但**全文件再未读取**（§9 表已标注）。这不是笔误，而是"协议里有、kernel 暂时不需要"的常见残留：kernel 的分块循环是按运行时 `seqLen` 现算的（03b 篇 §5），全局 `numChunks` 对它没用；`T_` 同理（总长要靠 `seq0/seq1` 累加）。保留它们的代价是零（一次寄存器写），收益是调试时打印方便。
  - `hasGamma_ = hasGamma`：host 已把 bool 折成 0/1（host tiling.cpp:207），device 用 `!= 0` 判定（L119），两侧宽度都是 `uint32_t`，不存在"bool 打包"的字节歧义。

## 17. kernel.h:86-100 — 构造函数后半：三个派生对齐与零初始化纪律

锚点：chunk_gated_delta_rule.h:86-100

```cpp
    vStep_ = tilingData->vStep;
    restUbSize_ = tilingData->ubRestBytes;
    alignK_ = Ceil(tilingData->dk, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK;
    stateStrideK_ = Ceil(tilingData->dk, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
    stateWorkspaceStrideV_ = Ceil(tilingData->dv, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
    load_ = 0;
    usedblk_ = 0;
    avgload_ = 0;
    // Set in Init()/InitLocalBuffers(); zero-initialized here so every member is
    // defined before first use (the kernel constructor runs before those calls).
    pipe_ = nullptr;
    vStepAligned_ = 0;
    blockIdx_ = 0;
  }

```

- L86 `vStep_ = tilingData->vStep`：V 维 tile 宽度，来自 host 的贪心搜索（02 篇 §11）。它是 device 侧一切 V 侧算术的根：L130 由它派生 `avStepAligned`、L168 与 L205/L221 用它决定切几块。
- L87 `restUbSize_ = tilingData->ubRestBytes`：**host 与 device 之间唯一的 UB 预算通道**（host 用 `ubSize - outQueueMax` 算出，02 篇 §11 L187）。device 在 L153 把它整块给 `tmpBuff`。这条线一断（例如 host 侧改了 `BUFFER_NUM` 而没改预算），越界就发生在 03b 篇 §1-§3 的 `off` 推进上，且没有任何运行期检查。
- L88 `alignK_ = Ceil(tilingData->dk, FP16_NUM_PER_BLOCK) * FP16_NUM_PER_BLOCK`：K 侧行宽按 **FP16 块**对齐。`Ceil(a, b)` 在 AscendC 里是"向上取整到 b 的倍数"（不是"除"），与 host 的 `CeilAlign(dk, 16)`（host tiling.cpp:248）**同式不同名**——一侧用 AscendC 助手、一侧用本地小函数，因为 host 编译时没有 AscendC 头。这种"同一公式两种拼法"的镜像是本类代码最难维护的地方，只能靠 02 篇 §9 那张尺寸对照表来人工校对。
- L89 `stateStrideK_ = Ceil(dk, FP32_NUM_PER_BLOCK)*FP32_NUM_PER_BLOCK`：同一维度 dk 的**第二种对齐宽度**（FP32 块），给 state tile 用（L134/L169/L186）。为什么同一个 dk 需要两个对齐宽度：K 从 GM 以 FP16 DMA，行宽必须是 16 的倍数；state 全程 FP32（workspace 中转），行宽只需 8 的倍数。host 侧对应 L136 的 `stateStrideK`。
- L90 `stateWorkspaceStrideV_ = Ceil(dv, FP32_NUM_PER_BLOCK)*FP32_NUM_PER_BLOCK`：**workspace 的行宽**，必须与 host 的 `workspaceStrideV`（host tiling.cpp:286）逐字符同式，否则 workspace 偏移错位、state 在 chunk 之间传递时会读到隔壁 head 的数据。它也是"workspace 布局是 `[B, Nv, dk, align32(dv)]`、与公共接口 `[..., Dv, Dk]` 互为转置"这条设计的 device 侧锚点。
- L91-93 `load_ = 0; usedblk_ = 0; avgload_ = 0;`：三个调度状态量，服务于 03b 篇 §4/§5 的长度加权装箱（`IsCurrentBlock` 用它们，kernel.h:242-247）。这里显式清零是因为它们在构造时还没有意义（要等 `ComputeAvgload` 才有 `avgload_`）。
- L94-95 两行注释解释下面三条赋值的动机："在 Init/InitLocalBuffers 里才真正被设置，这里先清零，使得首次使用前每个成员都有定义（构造函数早于那些调用运行）"。这条纪律在 aicore 上比在 host 上更要紧：类成员的默认初始化在设备编译器上不受任何警告保护（没有 host 那种 `-Wuninitialized` 覆盖），读一个未定义成员得到的是**随机寄存器值**，且因为每个核独立执行同一段构造代码，症状会是"部分核结果错、部分对"这种最难复现的形态。
- L96 `pipe_ = nullptr;`、L97 `vStepAligned_ = 0;`、L98 `blockIdx_ = 0;`：三者各自被 L107/L131/L103 覆盖。**清零不是装饰**：`pipe_` 若非空未赋值，L138 的 `pipe_->InitBuffer` 会解引用野指针；`vStepAligned_` 若未定义，所有用它的 kernel.h:407/427/448 等点会得到随机行宽。
- L99 `}`：构造函数结束。注意整个构造是 24 次标量读写 + 3 次 `Ceil`，**没有任何 DMA/流水操作**——这是刻意的：构造发生在 `TPipe` 分配之前，此时任何 UB 访问都非法。

## 18. kernel.h:101-110 — Init：三句前置检查与两次委托

锚点：chunk_gated_delta_rule.h:101-110

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

- L101 签名：`const CGDRInitParams &`（按 const 引用传十个指针，避免复制十个字）+ `TPipe *pipe`（裸指针，全 kernel 生命周期由入口的栈对象持有）。
- L102 `uint64_t blockDim = GetBlockNum();`：读当前 kernel 的 block 数。这个值**就是 host 侧 `context->SetBlockDim(blockDim)` 写进去的那个数**（02 篇 §15），也就是说 host 的一次赋值同时决定了 device 的并行度、`ShouldSplitVTiles()`（L239）的结果与 `avgload_` 的分母（L206）——跨 host/device 的这条因果链是本 kernel 最容易被漏读的一条。`GetBlockNum()` 是系统寄存器/内建函数级开销，所以本函数与 L206、L239 各调一次不构成问题。
- L103 `blockIdx_ = GetBlockIdx();`：本核编号，存成成员供 `IsCurrentBlock`（L243）比较。**必须在 `Init` 里取，而不是在 `Process` 里取**：它同时被 03b 篇 §5 的装箱逻辑和 L104 的守卫使用。
- L104-106 `if (blockIdx_ >= blockDim) return;`：越界核的守卫。理论上不该触发（框架按 blockDim 下发），但它防的是"平台多下发核"这一类异常。类型上 `blockIdx_` 与 `blockDim` 都是 `uint64_t`，比较不会因符号扩展出问题。
- **守卫与 `Process` 不对称**：`Init` 提前返回后，入口 L35 仍会调 `Process()`，而 `Process` 第一句就是 `ComputeAvgload()`，后者在 L200 用 `actualSeqLengthsGm_.GetValue(...)` 读 GM——若 `SetGlobalTensors` 被跳过，这个 `GlobalTensor` 的基址从未设置，读它即是非法访问。今天不出事**只因为守卫恒不触发**。正确的写法是把 `Init` 的返回类型改成 `bool` 并让入口据此跳过 `Process`，或在 `Process` 开头重复同一判断；这类"只守卫一半"的形状是代码评审里值得单独点出的模式。
- L107 `pipe_ = pipe;`：必须在 L109 之前——`InitLocalBuffers` 里两次 `pipe_->InitBuffer`（L138/L153）直接依赖它。赋值顺序在这里承担了"数据依赖"的表达作用，读者可以据此确认不存在空 `pipe_` 路径。
- L108 `SetGlobalTensors(initParams);`：先绑 GM（§19），L109 `InitLocalBuffers();`：再分 UB（03b 篇 §1-§3）。顺序是先"外部世界"后"内部资源"，与 `Process` 的读→算→写次序同构，也便于在 `InitLocalBuffers` 失败时（例如 `restUbSize_` 为 0）不留下半绑定的 GM 状态。

## 19. kernel.h:111-126 — SetGlobalTensors：十个 GlobalTensor 绑定与一处条件绑定

锚点：chunk_gated_delta_rule.h:111-126

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
  }

```

- L112 签名与 `Init` 一致按 const 引用。函数名带 "Global" 是指"绑定 GM 地址"，不是"全局变量"。
- `(__gm__ T *)` 里的 **`__gm__` 是设备侧的"全局存储地址空间"限定符**，等价于 OpenCL 的 `__global`。`SetGlobalBuffer` 的形参类型带它，所以必须把不透明的 `GM_ADDR` 先转成"GM 空间中的 T*"再传入。C++ 的地址空间转换在编译器里受检：漏写 `__gm__` 会直接报地址空间不匹配，因此这十行**每行都是一个类型断言**。
- 十个成员、四种元素类型，逐行核对与 def.cpp 的一致性：
  - L113-117 五个 `inType`（=half）：query/key/value/beta/initial_state ⇒ def 的 `DT_FLOAT16` ✓。
  - L118 `int32_t`：actualSeqLengths ⇒ def 的 `DT_INT32` ✓。选 INT32 而不是 INT64 是 host 侧 def 与这里唯一的共同约定（01 篇 §3 讨论过）。
  - L119-121 `if (hasGamma_ != 0)` 包住 `gGm_` 的 `float` 绑定 ⇒ def 的 `g: DT_FLOAT` 且 OPTIONAL ✓。**这是十个绑定里唯一的条件绑定**，而且它"安全"不是因为判了空指针，而是因为**消费点同样带条件**：`LoadG`（kernel.h:251-256）第一句就是 `if (hasGamma_ == 0) return 0.0f;`，两侧用同一个 `hasGamma_` 把关，所以 `gGm_` 未绑定时永远不会被解引用。把这两行当成一对来读才不会误判成 bug。
  - L122-123 两个 `outType`：`finalStateGm_` 与 `attnOutGm_` ⇒ def 的两个 `DT_FLOAT16` 输出 ✓。注意**成员名 `attnOutGm_` 对应公共输出 `out`**（§15 的改名在此完成闭环）。
  - L124 `float`：`stateWorkspaceGm_` ← `initParams.workspace`（已剥头的用户区）。它是**唯一按 FP32 绑定的工作区**，因为 state 在 chunk 间中转要求 FP32（防精度损失，02 篇 §16 讨论过布局转置）。
- 十行都不检查 `GM_ADDR` 是否为 0。除 g 以外其余九个是 REQUIRED 输入/输出，框架保证非空；这个前提与 L119 的条件性一起，构成"可选输入必须两侧同时设防、必选输入可以裸绑"的完整口径。
- L125 `}`、L126 空行。成员声明顺序（L918-927）与本函数书写顺序略有差异（`gGm_` 在声明里排第 4），因为绑定是按名字而非按位置，所以无影响——这也是"用名字绑、用位置传参"两种风格在同一处的对比：前者安全得多。
