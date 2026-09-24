# 02 · host 侧 tiling：Cube 常量、UB 预算与桶策略（tiling.cpp 1-227）

## 0. 先给结论：这个文件被改成了什么形状

1. **新增了 9 个常量 + 1 个函数**：`kMatmulM/K/N`（Cube 名义 tile）、`kSmallCubeDk/kMidSmallCubeDk/kMediumCubeDk/kLargeCubeDk`（四个编译期桶）、`kCubeStageSlotCount`、`kRawMatmulStageBytesPerCore`（每核 GM 暂存预算，**131072 B = 128 KiB**）与 `SelectCubeDk()`。
2. **`dk` 这个参数从三个函数的签名里被删掉了**（`ComputeTmpBuffBytes` / `ComputeOutQueueBytes` / `SolveVStep`）。删除的前提是两件事被统一：`alignK = cubeDk`（桶宽而非 16 对齐）与 `stateStrideK = alignK`。删掉之后 host 侧的 UB 记账只依赖"一个 K 维宽度"，少一个耦合变量。
3. **`SolveVStep` 多了 `preferredVStep` 参数**，它让 `vStep` **允许大于 dv**——V 方向和 K 方向一起补到同一个 Cube 桶宽。整个 PR 的第一性假设（"补齐走 Cube 远比回退 Vector 快"）就是这一条落进代码的。
4. **桶从"枚举三个 benchmark shape"变成"四段值域映射"**（`SelectCubeDk`）。这条演进链（写死 → 值域化 → 补 80 桶）的逐行证据在 02b 篇 §5。
5. 所有 helper 的**字节记账都改成了可以在纸上核算的形式**：本篇给出 dk=80/dv=80 的完整算式，结果 `tbuf=125312` 与真机 `CGDR_DEBUG_LOG=1` 的输出逐位吻合。

## 1. 文件头与匿名 namespace

锚点：chunk_gated_delta_rule_tiling.cpp:1-28

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
#include "tiling/platform/platform_ascendc.h"
#include "chunk_gated_delta_rule_tiling.h"  // NOLINT(build/include_subdir)

using namespace ge;    // NOLINT(build/namespaces)
using namespace gert;  // NOLINT(build/namespaces)

// ChunkGatedDeltaRuleTilingData is global (see chunk_gated_delta_rule_tiling.h),
// so no using-declaration is needed here.

namespace {

```

- 行 1-15：Apache-2.0 头，与 def/infershape 逐字相同。行 16 空行。
- 行 17：`register/op_def_registry.h` 提供 `TilingContext` 与 `IMPL_OP_OPTILING`。
- 行 18：`tiling/platform/platform_ascendc.h` —— **tiling 侧查询硬件资源的唯一入口**。它提供 `platform_ascendc::PlatformAscendC` 包装类（行 85 用），能问出核数（`GetCoreNumAiv/GetCoreNum`）与各级存储容量（`GetCoreMemSize(CoreMemType::UB, …)`）。为什么"必须问、不能写死"：同一份 tiling 二进制（`liboptiling.so`）要在不同 SKU 上工作，310P 与 910B 的核数、UB 大小不同，写死会让 UB 预算算错进而越界申请。
- 行 19：include 本篇主角之一的 `chunk_gated_delta_rule_tiling.h`（01 篇 §3-§4），带 cpplint 的 include 子目录豁免。
- 行 21-22：`ge`（图引擎，`GRAPH_SUCCESS`/`GRAPH_FAILED`）、`gert`（运行时，`TilingContext`）。
- 行 24-25：注释记录了一个真实约束——tiling 结构体**留在全局命名空间**，所以这里不需要 `using`。它的另一半理由是 CANN 的 tiling 宏要求全局结构体（01 篇 §3）。
- 行 27：`namespace {` 开匿名 namespace，行 28 空行。**整个文件的 helper 都是 TU 私有的**，只有行 349 的 `IMPL_OP_OPTILING` 落到全局。这带来一个好处：`CeilAlign`、`DivCeil`、`ParseShapeDims` 这些通用名字不会与其他算子的 tiling 冲突（每个算子一个 tiling TU，最终一起链进 `liboptiling.so`）。

## 2. 常量区 A：与 !1108 同源的部分（29-39）

锚点：chunk_gated_delta_rule_tiling.cpp:29-39

```cpp
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
```

- 行 29-30 两个 `*_NUM_PER_BLOCK` 是本文件最重要的机器语义常量：**片上存储与 GM 之间 DMA 的最小粒度是 32 字节（一个 block）**。FP16 每元素 2 B → 一 block 16 个元素；FP32 每元素 4 B → 一 block 8 个元素。`DataCopy` 的 `blockLen` 必须是 32 的倍数，不满足就得逐行搬或标量补尾（kernel 侧 `LoadPaddedRows` 的三段式全部在为这条硬件规则付账）。所以：`alignK` 的"自然对齐"取 `FP16_NUM_PER_BLOCK=16`（K 是 FP16 张量），state 的 FP32 步长对齐取 `FP32_NUM_PER_BLOCK=8`。
- 行 31-32：`kDefaultChunkSize = 64`。注释说明它是对齐 910B 算子的内部细节。**Cube 化之后 64 的地位从"性能参数"升级为"快路径前提"**：`kMatmulM = 64` 与它同值，kernel 的 `IsCubeFastPath` 要求 `chunkLen == 64`（`kernel.h:258`），尾块（chunkLen<64）直接掉回 !1108 的 Vector 路径。
- 行 33-34：`kHeadDimAxis = 2`，`int32_t`（与 `infershape.cpp:26` 同名同值同类型，`GetDim` 形参是 int32）。
- 行 35-37：`kPairedTileCount = 2` 与它的注释——`chunkKFp32/kCumdecayFp32` 同布局、`chunkVFp32/chunkAttnOutFp32` 同布局，所以 UB 记账时各算两次。这是"host 与 device 用同一套切分"契约的算术表达（device 侧 `InitLocalBuffers` 确实各占一份，见 03 篇 §6）。
- 行 38-39：`kWorkspaceBytes = 32 MiB` 是**申请下限而不是上限**（02b 篇 §4 的 `max(required, kWorkspaceBytes)`）。

这 11 行与 !1108 完全相同，一字未改。值得记的是：`kDefaultChunkSize`、`FP16_NUM_PER_BLOCK`、`kPairedTileCount` 三个常量在 Cube 版里的**含义**已经变了，但**值**没变，所以 diff 里看不到它们——这类"语义漂移"是逐行 diff 审查看不出来的，只能靠读下游用法。

## 3. 常量区 B：!1135 新增的 Cube 常量（40-49）

锚点：chunk_gated_delta_rule_tiling.cpp:40-49

```cpp
constexpr uint32_t kMatmulM = 64;
constexpr uint32_t kMatmulK = 128;
constexpr uint32_t kMatmulN = 128;
constexpr uint32_t kSmallCubeDk = 64;
constexpr uint32_t kMidSmallCubeDk = 80;
constexpr uint32_t kMediumCubeDk = 96;
constexpr uint32_t kLargeCubeDk = 128;
constexpr uint32_t kCubeStageSlotCount = 2;
constexpr uint64_t kRawMatmulStageBytesPerCore =
  kCubeStageSlotCount * static_cast<uint64_t>(2 * kMatmulM * kMatmulK + kMatmulK * kMatmulN) * sizeof(uint16_t);
```

**这 10 行是整份 tiling 的地基**，三组常量分别是"名义矩阵形状 / 编译期桶 / 暂存槽"。

### 3.1 `kMatmulM/K/N = 64/128/128`：Cube 的名义 tile，不是单条 Mmad 的形状

Ascend 的矩阵乘存储层级是 **GM → L1 → L0A/L0B → L0C**（310P 上每级都比 910B 小一代）：

- **L1**：Mmad 操作数的唯一来源片上缓冲。UB 里的数据不能直接进 L1，必须经 GM 中转（03 篇会看到 kernel 为此专门开了 GM 暂存区）。
- **L0A / L0B**：Mmad 的左/右操作数暂存（分别由 A/B 矩阵的分形 fractal 组成）。
- **L0C**：FP32 累加器，Mmad 写它、Vector 读它。**L0C 的读出顺序是 NZ（分形序）而不是 ND（行主序）**，且 310P 这代 **Fixpipe 不可用**，所以 L0C → UB 只能用 `DataCopy` 按 16×16 分形搬出来再逐行 `NzToNd`（docs/PR-1135 精读 §2.3 的"五段环形通路"）。
- 单条 Mmad 的硬件形状是 16×16×32 量级的分形乘，**`64/128/128` 不是单条 Mmad 的形状，而是"暂存区按支持域里最宽的桶预留"的名义形状**：kernel 里真正的调用形如 `MmadParams{64, 64, 128, …}`（M=64、N=64、K=128，见 docs 精读 §3.1），128 宽的桶会被切成 N-tile/M-tile 循环。

三个值的来源分别是：`kMatmulM = 64` = chunkSize（一个 chunk 的 64 行 token，公式里 A 矩阵的行数）；`kMatmulK = 128` = 最大 K 桶宽（`kLargeCubeDk`）；`kMatmulN = 128` = 最大 V/输出列宽。也就是说 **M/K/N 三个值就是"支持域的顶点"**，`SelectCubeDk` 的四档里最大的那档 + chunkSize + 最大 vStep。

### 3.2 四个桶常量：`64 / 80 / 96 / 128`

四档不是等比也不是随便取的（`kSmallCubeDk`/`kMidSmallCubeDk`/`kMediumCubeDk`/`kLargeCubeDk` 的命名直接写进 `tilingKey` 归属）：

| 桶 | 值 | 为什么要有它 |
|---|---|---|
| small | 64 | = `kMatmulM` = chunkSize。dk≤64 时 scores 方阵是 64×64，K 补到 64 后 A/B/C 三者同宽，是最省的档 |
| midSmall | 80 | Qwen3 生态的真实 Dk。没有它，dk=80 落 96 桶要多算 16 列（02b §2 会给出实测：同一 shape 的 tbuf 从 125312 涨到 153088 |
| medium | 96 | 中间档，也是**支持域外的兜底 kernel 类**（02b §4：`tilingKey` 默认值 2） |
| large | 128 | = `kMatmulK`/`kMatmulN`，Cube 支持的上限；>128 一律回退 |

`kMidSmallCubeDk` 这个别扭的名字本身就是化石：725cf45d 泛化时只有 64/96/128 三桶（`kSmallCubeDk`/`kMediumCubeDk`/`kLargeCubeDk`），69300ffc 把 80 插回 64 与 96 之间时无处命名，只能叫 "MidSmall"（介于 small 与 medium 之间的小）。**一个命名妥协精确记录了一次桶序列插入**。

### 3.3 `kRawMatmulStageBytesPerCore` = 131072 B = 128 KiB：把算式算给你看

按代码的字面公式展开（行 48-49）：

```text
kRawMatmulStageBytesPerCore
  = kCubeStageSlotCount × (2×kMatmulM×kMatmulK + kMatmulK×kMatmulN) × sizeof(uint16_t)
  = 2 × (2×64×128 + 128×128) × 2 B
  = 2 × (16384 + 16384) × 2 B
  = 2 × 32768 × 2 B
  = 131072 B
  = 128 KiB / 核
```

括号里两项各是什么（这才是"128 KiB"的物理解释）：

| 项 | 元素数 | 含义 |
|---|---|---|
| `2 × kMatmulM × kMatmulK` = 2×64×128 | 16384 | **A 矩阵的两份 FP16**：`X_hi`（64×128）与 `X_lo`（64×128）。FP16 补偿分裂要把一个 FP32 矩阵拆成 hi/lo 两个半区（`StageHalfWithResidual`），所以 A 占双份 |
| `kMatmulK × kMatmulN` = 128×128 | 16384 | **B 矩阵**：一次 Cube 乘的右操作数，最多 128×128 |
| 小计 32768 元素 × 2 B | **65536 B = 64 KiB** | 一个 slot 的容量 |
| × `kCubeStageSlotCount` = 2 | **131072 B = 128 KiB** | 每核双 slot |

双 slot 不是为了"多放数据"，是**软件流水**：slot0 被 Cube 消费的同时 slot1 被 MTE3（UB→GM 出方向 DMA）填充，两机并行（docs 精读 §2.3 引的 `ComputeAttnProductsCube` 注释 "Stage Q into a disjoint GM slot while the first compensated product is executing"）。1×2 就退化成串行等待，2×2 才能满流水——这是每核 128 KiB 而不是 64 KiB 的原因。

注意 `static_cast<uint64_t>` 的位置：括号内的 `2*kMatmulM*kMatmulK + kMatmulK*kMatmulN` 是 `uint32_t` 域内的 32768（远不溢出），转换只保证**乘以 slot 数与字节数之后**仍在 64 位里。这是 C++ 常量表达式的典型写法，`kWorkspaceBytes` 用 `32ULL *` 是同一个动机（行 39）。

### 3.4 为什么按 core 数乘，而不是按 `B × Nv`

02b 篇 §4 的申请式是 `blockDim × kRawMatmulStageBytesPerCore`。选 `blockDim`（核数上界）而不是 `B × Hv × vTileCount`（工作项数）的理由，从 device 侧的索引式直接读得出来（`kernel.h:249-255`）：

```cpp
  __aicore__ inline __gm__ uint8_t *GetCubeStageBase(uint32_t slot) {
    uint64_t stateWorkspaceElements = static_cast<uint64_t>(B_) * NV_ * realK_ * stateWorkspaceStrideV_;
    uint64_t stageByteOffset =
      stateWorkspaceElements * sizeof(float) +
      (static_cast<uint64_t>(blockIdx_) * CUBE_STAGE_SLOT_COUNT + slot) * CUBE_STAGE_SLOT_BYTES;
    return workspaceAddr_ + stageByteOffset;
  }
```

1. **slot 是"每核私有"，不是"每工作项私有"**。索引（`kernel.h:251-253`）里只有 `blockIdx_` 和 `slot`，没有任何工作项坐标：

```cpp
    uint64_t stageByteOffset =
      stateWorkspaceElements * sizeof(float) +
      (static_cast<uint64_t>(blockIdx_) * CUBE_STAGE_SLOT_COUNT + slot) * CUBE_STAGE_SLOT_BYTES;
```

一个核在整个 kernel 生命周期里循环处理多个 (batch, head, V-tile) 工作项（`Process()` 的三重 for，`kernel.h:217-244`），**同一个 slot 对被反复覆写**。所以同时存在的 slot 对数量 = 核数，与工作项数量无关。


2. **`blockDim` 已经是工作项数的上界截断**（`min(workItems, aivNum)`，02b §4），所以 `blockDim × 128 KiB` 恰好是"最坏并发"的精确预算：既不多要一个字节，也不少要一个字节。按 `B × Hv` 乘会在 `2×8` 这种小形状上少要（16 < 核数时反而对，但 32 heads × 多 V-tile 时会多要几十 MiB），本质是**用错误的量纲做预算**。
3. 从硬件视角看这是通用规则：**GM scratch 的并发度由核数决定，不由数据并行度决定**。任何"每核一份 scratch"的申请式都应当乘 `blockDim`。

### 3.5 这条契约的失效方式（值得背下来）

device 侧对应常量是字面量（`kernel.h:38-39`）：

```cpp
constexpr uint64_t CUBE_STAGE_SLOT_BYTES = 64 * 1024;
constexpr uint32_t CUBE_STAGE_SLOT_COUNT = 2;
```

host 用**算式**、device 用**字面量**，两边都等于 64 KiB / 128 KiB，但**没有任何编译期校验**。如果有人把 `kMatmulK` 从 128 改成 64（例如支持域收缩），host 侧算式会变成 `2×(2×64×64+64×64)×2 = 49152 B`，而 device 仍按 64 KiB 的 stride 去索引 slot —— **申请量小于使用量，写出界的是别人的 GM**（表现为对端算子数据被踩或 aicore 异常，而不是本 kernel 立刻崩）。安全的改法是把 `CUBE_STAGE_SLOT_BYTES` 也写成同一个算式，或干脆由 tiling 结构体下发（但那样桶宽就不是编译期常量了，正是 01 篇 §0 推论 2 的取舍）。

另一处同源的"隐性耦合"：slot 容量按**最宽的 128 桶**预算，跑 64 桶时只用掉 `(2×64×64+64×64)×2 = 32 KiB/slot`，剩下一半空转。作者选择用固定预算换掉"按桶动态算 slot 尺寸"的分支复杂度——workspace 是虚拟地址空间的临时申请，浪费不进延迟。

## 4. 常量区 C：输入下标与运行时参数（50-61）

锚点：chunk_gated_delta_rule_tiling.cpp:50-61

```cpp
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
```

行 50-61 与 !1108 逐字节相同。`kMinBlockDim` 的注释是这份 diff 里"文档滞后于实现"的唯一实例，读代码时要靠 03 篇的 `KERNEL_TYPE_AIC_ONLY` 才能反推它已经不准。

## 5. 对齐工具与 ShapeDims（62-74）

锚点：chunk_gated_delta_rule_tiling.cpp:62-74

```cpp
uint32_t CeilAlign(uint32_t val, uint32_t align) { return (val + align - 1) / align * align; }
uint32_t DivCeil(uint32_t val, uint32_t divisor) { return (val + divisor - 1) / divisor; }

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

行 62-74 与 !1108 逐字节相同——**工作单元从"一个 value head"变成 `(batch, head, V-tile)` 三元组之后，ShapeDims 也不需要加字段**，因为 batch 本来就在表里，只是 02b §4 里第一次被真正用于并发度计算（!1108 的 `workItems = dims.hv` 完全没用 batch）。这是一个"数据结构先行、用法后补"的例子。

## 6. `GetPlatformInfo`（75-94）

锚点：chunk_gated_delta_rule_tiling.cpp:75-94

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

行 75-94 与 !1108 逐字节相同。

## 7. `ParseShapeDims`（95-114）

锚点：chunk_gated_delta_rule_tiling.cpp:95-114

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

行 95-114 与 !1108 逐字节相同。**Cube 化不需要知道任何新的 shape 量**——桶宽是从 `dk` 推出来的（§12），不是从外部读进来的。

## 8. `ParseAttrs` 与 `HasGamma`（115-133）

锚点：chunk_gated_delta_rule_tiling.cpp:115-127

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

- 行 118：**先赋默认再尝试覆盖**——所以本函数的所有失败路径（`attrs` 空 / `GetAttrNum()==0` / 指针空）都自然落到 `1.0f`，与 def.cpp:69 的 `.Float(1.0)` 一致。
- 行 120：`GetAttrNum() == 0` 这个判断很实在：可选属性完全未传时 attr 表是空的，`GetAttrPointer<float>(0)` 在这种表上行为不可依赖，所以先用表长挡一道。
- 行 123-126：`GetAttrPointer<float>(0)` 按下标 0 取（本 op 只有一个 attr），返回指针可能为空再判一次。
- 与 Cube 的关系：`scale_value` 在 !1108 只被 Vector 慢路径用；!1135 的 Cube 快路径把它**乘进 A 矩阵的每一行**（`scale_ * expGCumFp32.GetValue(row)`，docs 精读 §3.5），所以它的数值影响域变大了——但 attr 解析本身一行没改。

锚点：chunk_gated_delta_rule_tiling.cpp:128-133

```cpp
bool HasGamma(TilingContext *context) {
  return context->GetOptionalInputDesc(kGammaInput) != nullptr &&
         context->GetOptionalInputTensor(kGammaInput) != nullptr &&
         context->GetOptionalInputShape(kGammaInput) != nullptr;
}
```

三重探测：**desc / tensor / shape 三个视角都非空才算"传了 g"**。为什么三个都要？因为图侧可能注册了可选输入的元信息（desc 有）但没有实际张量（tensor 空，例如常量折叠掉了），或反之。任缺其一就当成没传，device 侧走 `hasGamma_ == 0` 的分支（g 恒取 0，即不衰减）。行 130-132 用 `&&` 短路，第一个空就返回。
行 128-133 与 !1108 逐字节相同。

## 9. `ComputeTmpBuffBytes`：UB 记账（134-159）

锚点：chunk_gated_delta_rule_tiling.cpp:134-159

```cpp

// Total tmpBuff bytes for a candidate vStep. V temporaries are compact tiles.
// With head*V-tile core splitting, each core handles only one tile, so scores
// are dead before that tile loads state and the two buffers may overlap.
uint32_t ComputeTmpBuffBytes(uint32_t vs, uint32_t dv, uint32_t chunkSize, uint32_t alignK,
                             bool allowScoresStateOverlap) {
  uint32_t avStepAligned = CeilAlign(vs, FP32_NUM_PER_BLOCK);
  uint32_t cs = chunkSize;
  uint32_t kTileBytes = cs * alignK * sizeof(float);         // chunkKFp32 + kCumdecayFp32
  uint32_t vTileBytes = cs * avStepAligned * sizeof(float);  // chunkVFp32 + chunkAttnOutFp32
  uint32_t tDecay = cs * cs * sizeof(float);                 // decayMaskFp32
  uint32_t tGcum = cs * sizeof(float);                       // gCumsumFp32
  uint32_t stateStrideK = alignK;
  uint32_t dotProductElem = (stateStrideK > cs) ? stateStrideK : cs;
  uint32_t deltaElem = (dotProductElem > avStepAligned) ? dotProductElem : avStepAligned;
  uint32_t tDelta = deltaElem * sizeof(float);                     // deltaFp32
  uint32_t tDotProduct = dotProductElem * sizeof(float);           // dotProductFp32
  uint32_t tExpGcum = cs * sizeof(float);                          // expGCumFp32
  uint32_t tBeta = tExpGcum;                                       // betaFp32
  uint32_t tScores = cs * cs * sizeof(float);                      // chunkScoresFp32 (attn matrix)
  uint32_t tState = stateStrideK * avStepAligned * sizeof(float);  // stateInFp32 [DK, vStep]
  bool overlapScoresState = vs >= dv || allowScoresStateOverlap;
  uint32_t tScoresState = overlapScoresState ? ((tScores > tState) ? tScores : tState) : (tScores + tState);
  return kPairedTileCount * kTileBytes + tDecay + kPairedTileCount * vTileBytes + tGcum + tDelta + tDotProduct +
         tExpGcum + tBeta + tScoresState;
}
```

这是 host/device 契约里最重的一段：**device 的 `InitLocalBuffers` 必须切出与这里完全相同的字节布局**（03 篇 §6 会逐缓冲对照）。逐行看，标 [新] 的是相对 !1108 的变化。

| 行 | 量 | 表达式 | 语义 |
|---|---|---|---|
| 140 | `avStepAligned` | `CeilAlign(vs, 8)` | V tile 在 FP32 域的行宽，8 元素对齐（32 B block） |
| 142 | `kTileBytes` | `cs × alignK × 4` ×2 | `chunkKFp32` + `kCumdecayFp32`。**K 维用 alignK，即桶宽** |
| 143 | `vTileBytes` | `cs × avStepAligned × 4` ×2 | `chunkVFp32` + `chunkAttnOutFp32` |
| 144 | `tDecay` | `cs × cs × 4` | `decayMaskFp32`（64×64 下三角掩体的存储） |
| 145 | `tGcum` | `cs × 4` | `gCumsumFp32` |
| 146 | `stateStrideK` | `alignK` **[新]** | !1108 是 `CeilAlign(dk, 8)`，两处不同源；这里统一成 alignK 后才能删掉 `dk` 形参 |
| 147-148 | `dotProductElem/deltaElem` | `max(max(stateStrideK, cs), avStepAligned)` | 两个归约 scratch 的宽度 |
| 151 | `tExpGcum` | `cs × 4` | `expGCumFp32` |
| 152 | `tBeta` | `= tExpGcum` **[新]** | `betaFp32`（见下） |
| 153-154 | `tScores/tState` | `cs×cs×4` / `stateStrideK×avStepAligned×4` | 注意力矩阵 / state tile |
| 155-156 | `tScoresState` | overlap 则取 max，否则取 sum | 见 §9.2 |
| 158 | 求和 | 多了 `tBeta` **[新]** | |

### 9.1 签名里 `dk` 被删的连锁后果（这是本 PR 语义升级的枢纽）

!1108：`ComputeTmpBuffBytes(vs, dv, chunkSize, dk, alignK, overlap)`，内部 `stateStrideK = CeilAlign(dk, FP32_NUM_PER_BLOCK)`——**K 维同时存在两个"宽度"**：`alignK`（16 对齐，FP16 的 K 行宽）与 `stateStrideK`（8 对齐，FP32 的 state 行宽）。dk=80 时两者都是 80（80 既被 16 整除也被 8 整除）；但 dk=100 时 `alignK=112`、`stateStrideK=104`，**同一份数据在两个域里行宽不同**。

!1135 把 K 维统一到桶宽：`alignK = cubeDk`（§12 与 02b §3）⇒ state 的 FP32 步长也直接取 `alignK` ⇒ 两个宽度恒等 ⇒ **`dk` 参数变成冗余，删**。删除后：

- `ComputeTmpBuffBytes` 少一个形参（行 138-139）；
- `ComputeOutQueueBytes` 的 `dk` 形参改名成 `stateStrideK` 并删掉内部的 `CeilAlign` 行（§10）；
- `SolveVStep` 的 `dk` 形参一并删除（§11），三处调用点全部简化；
- device 侧 `stateStrideK_ = alignK_;`（`kernel.h:92`）与这里 `stateStrideK = alignK` 形成同一句话的两份实现。

代价是**补零面积变大**：dk=65 落 80 桶，K tile 从 65×64 变 80×64，多 23% 的字节与多 23% 的 Mmad K 长度。**收益**是"非对齐 K 也能吃 Cube 快路径"——因为桶宽 80/96/128 全都是 16 的倍数（32 B 对齐），Cube 只要求操作数行宽对齐，不要求等于真实 dk。这条收益最终落在 `LoadPaddedRows`（03 篇/`04` 篇），它负责把真实 65 列的数据搬进 80 列的行、把 15 列填 0（填 0 是必须的：所有 Cube 乘都吃完整桶宽，脏数据会进结果）。

### 9.2 `overlapScoresState` 的两个来源

`vs >= dv || allowScoresStateOverlap`：

- `vs >= dv` 是**几何必然**：只有一个 V tile 时，scores 用完之后 state tile 才开始活，两个 buffer 生命周期不重叠，可以共用同一段 UB。
- `allowScoresStateOverlap` 是**调度决定**：当"每核只处理一个 V tile"时同样成立。!1108 只能靠 `dims.hv < aivNum` 猜这个条件（head 数不够填核，才会去拆 V tile）；!1135 无条件为 true（02b §3 的 `:295`），因为 V tile 从"可选的二级切分"变成**工作项定义的一部分**（`vTileCount` 恒进 `workItems`），每核恒处理一个 tile。
- 两者取不到 max 时会额外付 `tScores`（64×64×4 = 16 KiB）——所以 `allowScoresStateOverlap` 从条件变常量 true，直接反映在 `ubRestBytes` 变大、进而 vStep 能取更大值上。

### 9.3 `tBeta`：为什么新增、为什么能写成 `= tExpGcum`

- 新增的原因：!1108 读 beta 是**逐 token 标量读 GM**（`LoadBeta(t, head)` 的 `betaGm_.GetValue`），不需要 UB 缓冲；!1135 的 `LoadChunkCoefficients` 改成**整块 `[64, Hv]` slab 一次 DMA + `Gather` 按 head 抽列**，抽出来的这一列必须有落点，于是多一个 `[cs]` 的 `betaFp32`（03 篇 §6 会看到 device 侧对应的第 12 个 LocalTensor）。
- 写成 `tBeta = tExpGcum` 而不是 `cs * sizeof(float)`：两者数值相同（`expGCumFp32` 也是 `cs` 个 float）
### 9.4 纸上核算：`tbuf = 125312` 复现真机日志

以 `CGDR_DEBUG_LOG=1` 在 dk=80 用例上的实测行 `dk=80, vStep=80, tbuf=125312` 为对照，按本函数手算（chunkSize=64、dv=80、alignK=cubeDk=80、vs=80）：

```text
avStepAligned  = CeilAlign(80, 8) = 80
kTileBytes     = 64×80×4 = 20480        → ×2 = 40960
vTileBytes     = 64×80×4 = 20480        → ×2 = 40960
tDecay         = 64×64×4 = 16384
tGcum          = 64×4   =    256
stateStrideK   = 80
dotProductElem = max(80, 64) = 80       → tDotProduct = 320
deltaElem      = max(80, 80) = 80       → tDelta      = 320
tExpGcum       = 64×4   =    256
tBeta          = tExpGcum =    256
tScores        = 64×64×4 = 16384
tState         = 80×80×4 = 25600        → overlap(vs>=dv) → tScoresState = max = 25600
合计 = 40960+16384+40960+256+320+320+256+256+25600 = 125312   ← 与真机日志逐位一致
```

同一 shape 在 三桶，落 96 桶 上是 `vStep=96, tbuf=153088`——把上面的 80 全换成 96 即得。

差额可逐项核对：

- `kPairedTileCount * kTileBytes` 从 40960→49152（+8192），
- `kPairedTileCount * vTileBytes` 从 40960→49152（+8192），
- `tDelta + tDotProduct` 从 640→768（+128），
- `tScoresState` 的重叠区从 `tState = 80×80×4 = 25600` 涨到 `96×96×4 = 36864`（+11264，`tScores = 16384` 仍被压住），
- `tDecay/tGcum/tExpGcum/tBeta` 与 `alignK`、`vStep` 无关不变；`8192+8192+128+11264 = 27776`。
 
**80 桶的存在为这个 shape 省下 27776 B 的 UB**，这就是 §3.2 那张表里"没有 80 就要多算 16 列"的量化。

## 10. `ComputeOutQueueBytes`（160-167）

锚点：chunk_gated_delta_rule_tiling.cpp:160-167

```cpp
// stateOutQueue bytes: max of the state tile and compact chunk output.
uint32_t ComputeOutQueueBytes(uint32_t vs, uint32_t stateStrideK, uint32_t chunkSize) {
  uint32_t avStepAligned = CeilAlign(vs, FP32_NUM_PER_BLOCK);
  uint32_t stateBytes = stateStrideK * avStepAligned * sizeof(uint16_t);
  uint32_t chunkBytes = chunkSize * avStepAligned * sizeof(uint16_t);
  return (stateBytes > chunkBytes) ? stateBytes : chunkBytes;
}
```

- 行 162：**形参 `dk` → `stateStrideK` 的改名 + 删掉内部 `CeilAlign(dk, FP32_NUM_PER_BLOCK)` 那一行**（!1108 行 151-153 / 初版 a9c66ddb 行 159-161 都还带着）。改名后调用方传的就是 `alignK`（见 §11 行 184/193/204），与 device 侧 `stateStrideK_` 同名，跨文件对齐一目了然。
- 行 164-165 都是 `sizeof(uint16_t)`：**这个队列走的是 FP16 域**，与 tmpBuff 的 FP32 不同域。`stateBytes = stateStrideK × avStepAligned × 2` 是"一块 state 的 FP16 落地形状"，`chunkBytes = cs × avStepAligned × 2` 是"一个 chunk 输出的 FP16 形状"。
- 行 166 取 max 而不是相加：同一个 `stateOutQueue_` 被两种载荷复用（写 state 时与写 out 时），队列深度 `BUFFER_NUM = 1`（`kernel.h:34/2423`），所以容量必须按最坏载荷给。
- 概念补一句：`TQue<QuePosition::VECOUT, 1>` 是 AscendC 的**跨管队列**——生产者（这里是 Vector 管 Cast 出 FP16）`EnQue`、消费者（MTE3，UB→GM）`DeQue`，队列自带同步，免掉手写 V→MTE3 事件。`TQueSync` 则是"多生产者/多消费者"版本；本算子只用单向单深度队列，所以是 `TQue`。
- 注意 `outQueueMax` 是**从 UB 总量里先扣掉的那一块**（§11 行 205），剩下的才是 tmpBuff 的 `ubRestBytes`。这个"先扣队列、余下全给 tmpBuff"的顺序在两版里一致。

## 11. `SolveVStep`：新增 `preferredVStep`（168-207）

锚点：chunk_gated_delta_rule_tiling.cpp:168-207

```cpp
// Find the largest vStep (FP32-block aligned, <= dv) whose tmpBuff + outQueue fits in UB.
// Also returns the resulting buffer sizes for tiling/debug.
bool SolveVStep(uint32_t dv, int64_t ubSize, uint32_t chunkSize, uint32_t alignK, bool allowScoresStateOverlap,
                uint32_t preferredVStep, uint32_t &vStepVal, uint32_t &tbufTotal, uint32_t &outQueueMax,
                uint32_t &restBytes) {
  if (ubSize <= 0) {
    return false;
  }
  uint32_t maxVStep = CeilAlign(dv, FP16_NUM_PER_BLOCK);
  bool found = false;
  // Prefer the regular Cube width even when Dv needs several tiles. This keeps
  // every full/tail tile on the same 64/80/96/128 fused implementation.
  if (preferredVStep != 0) {
    uint64_t preferredBytes =
      static_cast<uint64_t>(ComputeTmpBuffBytes(preferredVStep, dv, chunkSize, alignK, allowScoresStateOverlap)) +
      ComputeOutQueueBytes(preferredVStep, alignK, chunkSize);
    if (preferredBytes <= static_cast<uint64_t>(ubSize)) {
      vStepVal = preferredVStep;
      found = true;
    }
  }
  for (uint32_t vs = maxVStep; !found && vs >= FP16_NUM_PER_BLOCK; vs -= FP16_NUM_PER_BLOCK) {
    uint64_t requiredBytes =
      static_cast<uint64_t>(ComputeTmpBuffBytes(vs, dv, chunkSize, alignK, allowScoresStateOverlap)) +
      ComputeOutQueueBytes(vs, alignK, chunkSize);
    if (requiredBytes <= static_cast<uint64_t>(ubSize)) {
      vStepVal = vs;
      found = true;
      break;
    }
  }
  if (!found) {
    return false;
  }
  tbufTotal = ComputeTmpBuffBytes(vStepVal, dv, chunkSize, alignK, allowScoresStateOverlap);
  outQueueMax = ComputeOutQueueBytes(vStepVal, alignK, chunkSize);
  restBytes = (ubSize > static_cast<int64_t>(outQueueMax)) ? static_cast<uint32_t>(ubSize - outQueueMax) : 0;
  return true;
}
```

这是全文件**新增行数最多**的函数（+13 行净），三处改动都有语义后果：

### 11.1 `preferredVStep` 参数与"V 也补到桶宽"

- 行 179-181 的注释是本 PR 的宣言：**"Prefer the regular Cube width even when Dv needs several tiles"**——即使 dv 需要切成多块，也先把 vStep 定成规则桶宽（64/80/96/128），让每一个整块与尾块都落进同一个融合实现。
- 行 181-189：先按 `preferredVStep` 试一次预算（tmpBuff + outQueue，`uint64_t` 比较），装得下就 `vStepVal = preferredVStep; found = true;`。
- 行 190：`for (uint32_t vs = maxVStep; !found && vs >= FP16_NUM_PER_BLOCK; vs -= FP16_NUM_PER_BLOCK)` —— `!found` 塞进循环条件而不是包一层 `if`，用 1 行完成"preferred 成功就完全跳过搜索"。**这个写法有个隐含前提**：`vs` 是 `uint32_t` 且循环体内 `vs -= 16` 会在下界处回绕，所以终止条件必须是 `vs >= 16`（写成 `vs > 0` 就会死循环）。
- 行 181 的判据 `preferredVStep != 0`：0 表示"没有桶"，即 `SelectCubeDk` 返回 0（dk>128）时 `preferredVStep = cubeDk = 0`（02b §3 行 299），此时退回纯搜索。**这条 0 值约定同时贯穿 `alignK`（行 286 的 `cubeDk == 0 ?`）与 device 的 `kSpecializedDk != 0`**，是三处判断共用的哨兵。

### 11.2 `vStep` 允许大于 dv：一处必须删掉的收敛逻辑

!1108 在这里有一段：

```cpp
  if (vStepVal > dv) {
    vStepVal = CeilAlign(dv, FP16_NUM_PER_BLOCK);
  }
```

**!1135 把它删了**。原因不是多余，而是它与新语义直接冲突：`preferredVStep = cubeDk` 完全可能大于 dv（例如 dk=64、dv=32 时 cubeDk=64），保留这段会把刚选好的桶宽又压回 32，preferred 分支白走。

删掉之后 **`vStep > dv` 成为合法状态**：V 方向的 tile 宽度按桶宽 64 走，尾部 32 列是 `LoadPaddedRows` 风格的零填充（V 侧在 `LoadVBeta` 里先清零对齐区，见 docs 精读 §4 表）。这带来两个后果：
- `vTileCount = DivCeil(dv, vStep)`（02b §4 行 315）在 dv<vStep 时得 1，不会多切；
- `ShouldSplitVTiles()` 变成 `realV_ > vStep_`（`kernel.h:247`），**必须同步删掉 !1108 的 `&& GetBlockNum() > NV_` 条件**——否则 dv=32、vStep=64 时它恒为 false，恰好和"不拆 tile"一致，但原先那个"核多才拆"的判据在 vStep>dv 的世界里语义已经反了。这一对改动（host 删收敛、device 删条件）是 03 篇 §7 的主题。

行 169 的注释 `Find the largest vStep (FP32-block aligned, <= dv)` **因此已经不再成立**——现在的 vStep 既可能 >dv，也不是"FP32 block 对齐"（`maxVStep` 用的是 `FP16_NUM_PER_BLOCK`，行 177）。文档滞后于实现的第二例。

### 11.3 为什么 `maxVStep` 用 FP16 对齐（16）而不是 FP32 对齐（8）

行 177：`maxVStep = CeilAlign(dv, FP16_NUM_PER_BLOCK)`。搜索步长也是 16（行 190）。

原因：**vStep 最终决定的是 Cube 的 N 宽与 FP16 载荷的行宽**（`ComputeOutQueueBytes` 全程 `uint16_t`），必须 16 元素（32 B）对齐；tmpBuff 里的 FP32 载荷则各自用 `CeilAlign(vs, 8)` 二次对齐（行 140、163）。用 8 会把搜索空间放大一倍，还可能选出 Cube 用不了的奇数宽。

## 12. `SelectCubeDk`：四段值域映射（208-227）

锚点：chunk_gated_delta_rule_tiling.cpp:208-226

```cpp
// Select the smallest compiled Cube tile that can hold Dk. The kernel pads
// the tail to this width, so this is a shape-range policy rather than a
// one-off specialization for a benchmark dimension.
uint32_t SelectCubeDk(uint32_t dk) {
  if (dk <= kSmallCubeDk) {
    return kSmallCubeDk;
  }
  if (dk <= kMidSmallCubeDk) {
    return kMidSmallCubeDk;
  }
  if (dk <= kMediumCubeDk) {
    return kMediumCubeDk;
  }
  if (dk <= kLargeCubeDk) {
    return kLargeCubeDk;
  }
  return 0;
}
```

- 行 209-211 的注释把设计意图写得很准：**"this is a shape-range policy rather than a one-off specialization for a benchmark dimension"**。
- 结构是**有序的区间下取整**：`dk ≤ 64 → 64`，`≤ 80 → 80`，`≤ 96 → 96`，`≤ 128 → 128`，否则 0。用连续的 `if + return`（没有 `else if`）让四段视觉上等价，也少一层缩进。
- 边界归属实测：`dk=63/64 → 64`、`65/79/80 → 80`、`81/95/96 → 96`、`97/127/128 → 128`、`129+ → 0`。69300ffc 之后测试用的 9 个 dk 值 `(63,65,79,80,81,95,96,97,127)` 正是**每桶边界 ±1**，把这九个喂进本函数即可复核归属

**返回 0 的三条连锁（fallback 的完整路径）**——这是"值域化"最容易被忽略的一半：

| 位置 | 行为 |
|---|---|
| 行 286 `alignK` | `cubeDk == 0` 时回退 `CeilAlign(dk, 16)`，即 !1108 的原始语义 |
| 行 299 `preferredVStep = cubeDk` | 变成 0 ⇒ `SolveVStep` 不进 preferred 分支（`!= 0` 判据）⇒ 贪心搜索任意 16 倍数 |
| 行 325-332 `tilingKey` | 三个 `== 桶` 判据都不成立 ⇒ **落默认值 2**，即 `<half, half, 96>` 这个 kernel 类 |

第三行需要和 device 侧对读才成立：

- `kernel.h:90-91` 是
`alignK_ = (kSpecializedDk != 0 && tilingData->dk <= kSpecializedDk) ? kSpecializedDk : naturalAlignK;`
——dk>128 时虽然 `kSpecializedDk`（96）非 0，但 `dk <= 96` 为假，于是 device 也回退 `naturalAlignK = Ceil(dk,16)*16`，**与 host 行 286 的取值恒等**。
- 同一时刻 `IsCubeFastPath` 的 `realK_ <= kSpecializedDk` 为假，全部 Cube 分支跳过，走 !1108 的 Axpy 嵌套。这就是行 323-324 那句注释 "Shapes above 128 use the generic fallback in the 96-wide kernel class" 的确切机器含义：**不是"96 桶 kernel 去跑 128 以上的 Cube"，而是"借 96 桶那个编译产物当通用 fallback 载体"**。

> 一句话总结本函数：**上界之上不设桶，用"最接近的桶"当 fallback 的家**。代价是 fallback 场景的 tilingKey 与真实意图脱钩（叫 96 其实跑 generic），收益是 kernel 实例数恒为 4、不随支持域扩张。

