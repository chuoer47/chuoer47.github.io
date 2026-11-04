# 02b · host 侧 tiling 主流程：四桶归属、三维工作项与 workspace 预算


> 本篇覆盖 **227-349**（`FillTilingData` / `LogTiling` / `ChunkGatedDeltaRuleTilingFunc` / 注册宏）。
> 1-227（常量、`ShapeDims`、平台与 shape 解析、`ComputeTmpBuffBytes`、`ComputeOutQueueBytes`、`SolveVStep`、`SelectCubeDk`）见 `02-host侧tiling四分桶与workspace预算.md`。


## 0. 本篇结论（先读这五条）

1. **主流程只有 85 行，但它是"四个编译期 kernel 实例"的唯一分派点**。行 323-333 的 `tilingKey` 四分派决定了 `chunk_gated_delta_rule.cpp:33-49` 里 64/80/96/128 四个模板实例中的哪一个被装载；这条 if-chain 是全 PR 唯一把"host 的桶策略"与"device 的模板实参"缝合起来的代码。
2. **`alignK = cubeDk`（行 286）是本 PR 影响面最大的一行**。它同时改变了 UB 记账（`ComputeTmpBuffBytes` 的 `kTileBytes`/`stateStrideK`）、GM state 镜像的行距（device 侧 `stateStrideK_ = alignK_`）与 Cube 的 N 维（`kMatmulK` 语义上的"补齐宽度"）。
3. **工作项单位从"一个 value head"变成 `(batch, value-head, V-tile)` 三元组**（行 312-317）。这不是性能微调，而是 `allowScoresStateOverlap` 能无条件为 `true`（行 295）的前提：每核只处理一个 tile 的全部 chunk，scores 的生命周期就不再依赖"核够不够分"。
4. **workspace 的第二项 `blockDim × 128 KiB` 是按核数而非按工作项数申请的**（行 342）。这与 `GetCubeStageBase` 用 `blockIdx_` 索引严格对应；按 `B × Hv` 申请会把内存放大几十倍，按核申请才是"每核私有暂存"的正确量。`kWorkspaceBytes = 32 MiB` 是**下限**，本篇的表格显示所有中小 shape 都落在这个下限上。
5. **三阶段演化在主流程上留下三处可读的化石**：行 285 的 `SelectCubeDk`（725cf45d 新增）、行 299 的 `preferredVStep = cubeDk`（同一 commit 把 8 行 if 链折成 1 行）、行 323-333 的四桶注释 + 行 328 那个 `kMidSmallCubeDk`（69300ffc 补桶时插入，注释却没跟着改，见 §8）。逐行对照见 §12。

---

## 1. `FillTilingData`：把解出的标量灌进 tiling 结构体（227-248）

锚点：chunk_gated_delta_rule_tiling.cpp:227-248

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

 !1108逐字节相同，16 次赋值一字未改。

---

## 2. `LogTiling`：观测窗（249-263）

锚点：chunk_gated_delta_rule_tiling.cpp:249-263

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

同样与 !1108（`00e39ab5:213-226`）**逐字节相同**，包括格式串。

---

## 3. 主流程第一段：三段前置校验（264-281）

锚点：chunk_gated_delta_rule_tiling.cpp:264-281

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

```

- 行 265 `static`：函数只在匿名 namespace 内可见，而注册宏（行 349）按**函数指针**取它，所以 `static` 不会破坏链接。CANN 的 tiling 函数签名固定为 `uint32_t (TilingContext*)`，返回值是 `ge::GraphStatus` 枚举（`GRAPH_SUCCESS` / `GRAPH_FAILED`），不是错误码。
- 行 266-270 与 272-275、277-278 构成**"资源 → shape → 属性"的三段前置**。顺序是有讲究的：`GetPlatformInfo` 要 `context` 非空，所以它自己判空并返回 bool；`ParseShapeDims`/`ParseAttrs` 则不判 `context`，因为它们只在框架回调里被调用，判空责任已经上移。三种前置条件对应三种失败方式：前两种 `return GRAPH_FAILED`，第三种（`ParseAttrs`）**没有返回值**——属性缺失是合法情形，用"默认值 + 覆盖"消化。
- 行 266-267 的初值 `aivNum = 0` / `ubSize = 0`：即使 `GetPlatformInfo` 在写入前失败（它只在 `context == nullptr` 或 `platformInfo == nullptr` 时才失败），也不会读到未初始化值。C++ 里 `uint32_t aivNum;` 是合法但危险的，这里显式初始化是对 02 篇 §6 那条"错误码被丢弃"的补偿。
- 行 279 `uint32_t chunkSize = kDefaultChunkSize;`——**chunkSize 在 !1135 依然是硬编码 64，没有任何按 shape 自适应的逻辑**。
- 行 280 `bool hasGamma = HasGamma(context);` 只算一次、后面传给 `FillTilingData`。这里有个跨侧约束值得记住：device 侧 `SetGlobalTensors` 用 `hasGamma_ != 0` 决定是否给 `gGm_` 绑地址（`kernel.h:123-125`），而 host 侧的 `HasGamma` 用了**三重探测**（`00e39ab5:129-133`，desc / tensor / shape 都非空）。任何一处探测口径与框架实际传入的可读性不一致，device 就会对一个空指针 `SetGlobalBuffer`。

---

## 4. 主流程第二段：pad 与桶宽（282-286）

锚点：chunk_gated_delta_rule_tiling.cpp:282-286

```cpp
  // Pad T up to a multiple of chunkSize and pre-compute the FP16/FP32 block alignments.
  uint32_t padSize = (chunkSize - dims.t % chunkSize) % chunkSize;
  uint32_t numChunks = (dims.t + padSize) / chunkSize;
  uint32_t cubeDk = SelectCubeDk(dims.dk);
  uint32_t alignK = (cubeDk == 0) ? CeilAlign(dims.dk, FP16_NUM_PER_BLOCK) : cubeDk;
```

- 行 283 `(chunkSize - t % chunkSize) % chunkSize`：**这是"向上取整到 chunkSize 的倍数需要补多少"的标准写法**。
- 行 285 是新增的调用点。**`SelectCubeDk` 在主流程里只被调用一次**，其结果 `cubeDk` 随后被用到四个地方（行 286 / 299 / 326-331），这是"单一决策点、多处消费"的最小实现。若每个消费点各自判断一次，四桶策略改五桶时就要改四处。
- 行 286 的三元式值得把两侧都念一遍：
  - `cubeDk != 0`（`dk ≤ 128`）→ `alignK = cubeDk`：**K 的行宽被抬到整个桶宽**。`chunkKFp32`/`kCumdecayFp32` 各占 `cs × alignK`，Cube 的 B 侧矩阵列数也就等于 `alignK`；多出来的 `alignK − dk` 列由 device 侧 `LoadPaddedRows` 的 `Duplicate(staging, 0, rows * alignK_)` 保证为精确 0，因此"多算的列贡献恰好为 0"（02 篇 §12 的桶可覆盖区间的数学依据）。
  - `cubeDk == 0`（`dk > 128`）→ `alignK = CeilAlign(dk, 16)`：**退回 !1108 的原始公式**。`00e39ab5:248` 那一行 `uint32_t alignK = CeilAlign(dk, FP16_NUM_PER_BLOCK);` 被原封不动搬进了三元式的 false 分支。这不是保守，而是**必要**：`dk>128` 时没有编译期桶可用，device 侧 `kSpecializedDk` 为 0 或桶宽小于 `dk`，`alignK_` 会退回 `naturalAlignK`（`kernel.h:90-91`），host 若给成别的值记账就会与 device 实际布局不一致。
- **兜底域跨侧一致性证明**：host 的 `cubeDk == 0` 等价于 `dk > 128`；device 的 `naturalAlignK` 分支条件是 `kSpecializedDk == 0 || dk > kSpecializedDk`。因为 `tilingKey` 保证 `dk ≤ 128` 时一定选中 `kSpecializedDk ≥ dk` 的那个实例，所以 device 走 `naturalAlignK` 的**唯一**情形也是 `dk > 128`——两侧在同一条边界上落下，算出的值都是 `Ceil(dk,16)*16`。行 286 与 `kernel.h:90-91` 因此是同一个表达式的两处书写，这是本篇最需要在 review 时确认的一致性（**没有任何编译期或运行期检查保护它**）。


---

## 5. 主流程第三段：解 vStep（287-303）

锚点：chunk_gated_delta_rule_tiling.cpp:287-303

```cpp
  uint32_t vStepVal = 0;
  uint32_t tbufTotal = 0;
  uint32_t outQueueMax = 0;
  uint32_t restBytes = 0;
  // A V tile is an independent work item. Once the attention matrix has been
  // staged for its Cube product, the state tile can safely reuse the same UB
  // region, including when a head spans multiple V tiles.
  bool allowScoresStateOverlap = true;
  // Keep V and padded K on the same regular Cube tile. This enables the
  // fused path for every Dk in the 64/80/96/128 ranges, including non-aligned
  // dimensions whose valid tail is zero-padded by the kernel.
  uint32_t preferredVStep = cubeDk;
  if (!SolveVStep(dims.dv, ubSize, chunkSize, alignK, allowScoresStateOverlap, preferredVStep, vStepVal, tbufTotal,
                  outQueueMax, restBytes)) {
    return GRAPH_FAILED;
  }
```

- 行 288-291 四个出参全部初始化为 0，其中 `tbufTotal` / `outQueueMax` **只被 `LogTiling` 用**，不参与任何后续计算（`FillTilingData` 不收它们）。它们是纯观测量，但因为走引用出参，签名上看不出这个差别。
- 行 292-294 的注释（3 行）+ 行 295 是**本 PR 的第二个关键决策**：
  - !1108 写的是 `bool allowScoresStateOverlap = dims.hv < aivNum;`（`00e39ab5:254`）。当时的逻辑是"只有当 head 数少到必须靠拆 V-tile 才填得满核时，一个核才会只处理一个 V-tile，此时 scores 与 state 才不重叠存活"——**overlap 的前提被表达成"核数够不够"**。
  - !1135 把它无条件置 `true`。理由就是注释第 1-3 句：工作项定义本身已经改成"一个 V-tile 是一个独立工作项"（行 312-317），于是"每核只处理一个 tile"不再是 `hv < aivNum` 的推论，而是**工作项定义的结果**，与核数无关。前提消失，判断就是死条件；而且保留旧条件反而会让 `hv ≥ aivNum` 的 shape 白白多付一块 `cs²+stateStrideK×vStep` 的 UB。
  - 代价与保护：这个 `true` 依赖 device 侧 `InitLocalBuffers` 的分支与它同步——`kernel.h` 第 173 行恰好也是 `if (vStep_ >= realV_ || ShouldSplitVTiles())`，在 !1135 的新 `ShouldSplitVTiles()` 定义下**恒为真**（`vStep_ ≥ realV_` 或 `realV_ > vStep_` 二者必居其一）。所以 host 认为重叠、device 也真的重叠。这是一个跨文件、跨编译单元的隐式契约，两处各有一句判断，**没有静态检查**。
- 行 296-299：`preferredVStep = cubeDk`。对照初版 a9c66ddb 的 12 行 if 链（`src/a9c66ddb/op_host/chunk_gated_delta_rule_tiling.cpp` 第 276-287 行，逐字引用）是本篇最直观的一处收敛：

```cpp
  uint32_t preferredVStep = 0;
  if (chunkSize == kMatmulM) {
    if (dims.dk == kMatmulK) {
      preferredVStep = kMatmulN;
    } else if (dims.dk == kMatmulK / 2) {
      preferredVStep = kMatmulN / 2;
    } else if (dims.dk == kDk80) {
      // Dk=80 has a dedicated 64x80 Cube path. Pad narrow Dv tiles to 80 so
      // the UB scratch can also hold the 64x80 NZ result without a fallback.
      preferredVStep = kDk80;
    }
  }
```

  写死版有 **三个精确值 + 一个 `chunkSize == 64` 前置**，`dk=63/65/96/127` 一律得到 `preferredVStep = 0`，只能走 `SolveVStep` 的贪心搜索，V 侧就脱离融合实现。终版一行 `= cubeDk` 同时做了三件事：把"V 的首选宽度"绑到"K 的桶宽"（两侧必须同宽的物理约束被写进代码）、把覆盖域从 3 个点扩到 `dk ≤ 128` 的全部整数、把 `chunkSize` 的隐含依赖去掉（现在 `chunkSize` 变了也只是桶不变，不会出现"条件不满足所以完全不首选"）。
  注释里 "including non-aligned dimensions whose valid tail is zero-padded by the kernel" 是整份 PR 对**为什么允许桶宽 > 实际宽度**最完整的一句话说明。
- 行 300-303 唯一的 `GRAPH_FAILED` 出口来自 `SolveVStep`。含义是"在 310P 的 UB 里放不下任何 `vs ∈ {16, 32, ...}` 的 V-tile 切法"，即 `tbuf(vs) + outQueue(vs) > ubSize` 对最小候选也成立。**这条路径没有诊断输出**：`LogTiling` 在行 335、失败时根本走不到，用户只会看到 tiling 失败。要定位必须自己在行 302 前临时加打印（`ubSize`/`dv`/`alignK` 三个量足够复现）。这是本篇发现的可观测性缺口，也是它**未被 !1135 改动**的既有弱点（!1108 同样如此）。

---

## 6. tiling 数据落盘（304-310）

锚点：chunk_gated_delta_rule_tiling.cpp:304-310

```cpp
  auto td = context->GetTilingData<ChunkGatedDeltaRuleTilingData>();
  if (td == nullptr) {
    return GRAPH_FAILED;
  }
  FillTilingData(td, dims, aivNum, ubSize, chunkSize, numChunks, padSize, scaleValueAttr, vStepVal, restBytes,
                 hasGamma);
```

- 行 305 `GetTilingData<T>()` 返回的是**框架分配的 tiling 缓冲区指针**，类型由模板参数指定，大小由行 349 的 `sizeof(ChunkGatedDeltaRuleTilingData)` 告知框架。这两处必须一致：模板实参与 `IMPL_OP_OPTILING` 的 `sizeof` 参数指向同一个类型，否则框架给的缓冲区小于写入量就是越界写。它们是**同一文件相距 44 行的两处同名符号**，改一处忘另一处不会被编译器发现（因为都是运行时用的）。
- 行 305 用 `auto`：`td` 的类型即 `ChunkGatedDeltaRuleTilingData*`。这里 `auto` 让"模板参数决定类型"这件事在视觉上更弱，但避免了在 host 侧写长类型名。
- 行 306-308 判空后返回 `GRAPH_FAILED`。框架在当前版本其实不会给空指针（`GetTilingData` 从 context 的固定缓冲区取地址），这个判空属于"照文档写防御"，与 `ParseShapeDims` 的判空同风格。
- 行 309-310 是 `FillTilingData` 的**唯一调用点**。注意 `tbufTotal` 与 `outQueueMax` 没传进来（它们不是 device 可见信息，只服务于日志），所以 §1 说的"tiling 结构体不装桶信息"在这里得到第二次确认：函数签名本身就是一份"哪些量下发、哪些量只用于观测"的清单。
- **顺序约束**：`FillTilingData` 必须在 `SolveVStep` 之后（它写 `vStep` 与 `ubRestBytes`），也必须在 `ParseShapeDims` 之后（它读 `dims`）。反过来，`SetTilingKey`（行 333）与它**无依赖关系**——`tilingKey` 由 `cubeDk` 决定，`FillTilingData` 不碰它。所以行 305-310 与行 323-333 这两段可以互换而不影响结果。这段代码的顺序是"写数据 → 定并行度 → 定实例 → 打日志 → 申请 workspace"，读起来自然，但没有编译器帮忙维持任何一条。

---

## 7. 工作项三维化与 `blockDim`（311-322）

锚点：chunk_gated_delta_rule_tiling.cpp:311-322

```cpp
  // One work item is one (batch, value-head, V-tile) tuple. V tiles write
  // disjoint output/state ranges, and exposing batch here also fills all cores
  // for small-head multi-batch inputs.
  uint32_t vTileCount = DivCeil(dims.dv, vStepVal);
  uint64_t totalWorkItems = static_cast<uint64_t>(dims.batch) * dims.hv * vTileCount;
  uint32_t workItems = (totalWorkItems > UINT32_MAX) ? UINT32_MAX : static_cast<uint32_t>(totalWorkItems);
  uint32_t blockDim = (workItems < aivNum) ? workItems : aivNum;
  if (blockDim == 0) {
    blockDim = kMinBlockDim;
  }
  context->SetBlockDim(blockDim);
```

这一段回答"并行度从哪来"，并且是**工作项单位改变的落点**。

- **!1108 是两段式**（`00e39ab5:267-274`）：

```cpp
  // Normally one work item is one value head. When the number of heads cannot
  // fill the AIV cores and V already needs multiple tiles, expose head*V-tile
  // work items; tiles write disjoint output/state ranges.
  uint32_t workItems = dims.hv;
  uint32_t vTileCount = DivCeil(dims.dv, vStepVal);
  if (dims.hv < aivNum && vTileCount > 1) {
    workItems = dims.hv * vTileCount;
  }
```
  默认单位是"一个 value head"，**只有**在 `hv < aivNum`（核填不满）**且** `vTileCount > 1`（V 真的需要切）时才降级为"head × V-tile"。注意它连 `batch` 都不乘：!1108 认为 batch 维不构成并行度。
- **!1135 一次展开三维**：`batch × hv × vTileCount`。三点变化：
  1. `batch` 被纳入并行度（注释第 2-3 句专门解释了动机：小 head 数多 batch 的输入也能填满核）。
  2. 条件判断整体消失——`vTileCount ≥ 1` 恒成立，`vTileCount > 1` 的特殊分支不再必要。
  3. 与 device 侧的分工变了：`kernel.h:228-235` 的 `Process()` 里三层循环 `(batch_i, head_i, vTileIdx)` 顺序展开工作项，配 `IsCurrentBlock` 做"第 k 个工作项归谁"的取模分配。**host 只负责给出核数，具体哪个核干哪个工作项完全由 device 的循环顺序决定**，两侧靠 `Process()` 的枚举顺序隐式对齐。
- 行 315 `DivCeil(dims.dv, vStepVal)`：`vStepVal` 由 `SolveVStep` 保证 `> 0`（找不到候选就返回 false），所以不会除零。`vStepVal > dims.dv` 时 `vTileCount == 1`——这正是"vStep 允许超过 dv"（02 篇 §11）在并行度上的良性后果。
- 行 316 的 `static_cast<uint64_t>(dims.batch) * dims.hv * vTileCount`：**先转 64 位再乘**，避免三维乘积在 `uint32_t` 里溢出。这个写法比 !1108 的 `dims.hv * vTileCount`（纯 32 位）更保守，因为多乘了一个 `batch`，量级上确实需要。但请注意它防的是中间量溢出，行 317 又把它窄化回 `uint32_t`——**因为 `SetBlockDim` 的入参就是 `uint32_t`**，行 317 的 `UINT32_MAX` 钳位是"协议宽度"决定的，不是可选的。三层保护（64 位乘 → 钳位 → 行 318 再被 `aivNum` 夹一次）里其实只有最后一层起作用，前两层是防御性的；写这么多是有代价的（4 行做一件事），但也说明作者知道"这里的乘积不可信"。
- 行 318 `blockDim = (workItems < aivNum) ? workItems : aivNum;`：`min(workItems, aivNum)`。**多开核没有收益**：`Process()` 的 `IsCurrentBlock` 会让超出工作项数的核直接空转，还白占 workspace staging（行 342 的 `blockDim × 128 KiB` 会线性变大）。所以取 min 同时是**正确性**和**内存**要求。
- 行 319-321 `blockDim == 0 → kMinBlockDim(=1)`：`SetBlockDim(0)` 非法。触发条件是 `workItems == 0` 或 `aivNum == 0`。前者来自 `dims.t == 0`；后者更危险——`GetPlatformInfo` 在 `GetCoreNumAiv()` 与 `GetCoreNum()` 都返回 0 时**不会失败**（02 篇 §6 只保证 `platformInfo` 句柄非空），于是 `aivNum == 0 → blockDim == 0 → 钳成 1`。也就是说平台查询静默失败时，算子会以单核配置跑下去，性能塌掉但不报错。**这是本篇识别出的实际风险点**。
- 行 322 `SetBlockDim(blockDim)`：310P 上 AIC_ONLY 的 "block" 就是 AiCore 上的一个执行体，`GetBlockNum()/GetBlockIdx()` 在 device 侧读回同一个数（`kernel.h:106-107`）。

---

## 8. `tilingKey` 四分派：四个实例与一个寄居的兜底（323-333）

锚点：chunk_gated_delta_rule_tiling.cpp:323-333

```cpp
  // Keep four compiled kernels for the 64/80/96/128 padded Cube tiles.
  // Shapes above 128 use the generic fallback in the 96-wide kernel class.
  uint32_t tilingKey = 2;
  if (cubeDk == kSmallCubeDk) {
    tilingKey = 0;
  } else if (cubeDk == kMidSmallCubeDk) {
    tilingKey = 1;
  } else if (cubeDk == kLargeCubeDk) {
    tilingKey = 3;
  }
  context->SetTilingKey(tilingKey);
```

**机器语义**：`SetTilingKey(k)` 把 `k` 写进算子实例的元数据；device 侧同一个 `__global__` 函数被编译成**多份二进制**（模板每个实参一份），运行期按 `k` 选中其中一份。入口 `chunk_gated_delta_rule.cpp:33-49` 的四个 `TILING_KEY_IS(i)` 分支就是这份选择表的另一端（详见 03 篇 §2）。因此 `k` 不是"提示"，是**装载哪段机器码的索引**：键值与实例的对应一旦错位，跑的就是用错桶宽的 kernel。

- 完整映射表（本段与入口文件互为证明）：

| `tilingKey` | device 模板实参 `kSpecializedDk` | host 侧命中条件 | `SelectCubeDk` 返回值 | 实际 `dk` 范围 |
| --- | --- | --- | --- | --- |
| 0 | 64（`kernel.cpp:34`） | `cubeDk == kSmallCubeDk` | 64 | `1 ≤ dk ≤ 64` |
| 1 | 80（`kernel.cpp:38`） | `cubeDk == kMidSmallCubeDk` | 80 | `65 ≤ dk ≤ 80` |
| 2 | 96（`kernel.cpp:42`） | **默认值**（未被任何分支改写） | 96 或 0 | `81 ≤ dk ≤ 96`，以及 `dk ≥ 129` 的兜底 |
| 3 | 128（`kernel.cpp:46`） | `cubeDk == kLargeCubeDk` | 128 | `97 ≤ dk ≤ 128` |

- 行 325 把 `2` 作为**默认值**而不是最后 `else`，于是 key2 天然吸收所有未被显式认领的情况，包括 `cubeDk == 0`（`dk > 128`）。这是"用一个已有实例寄居兜底代码"的技巧：兜底不需要第 5 个 kernel。
- 代价是兜底 shape 在装载上"继承了 96 桶实例"。功能上无害（`dk > 96` 时 `kernel.h:91` 的 `dk <= kSpecializedDk` 不成立，`alignK_` 退回 `naturalAlignK`，`IsCubeFastPath` 的 `realK_ <= kSpecializedDk` 不成立，Cube 快路径整体关闭，行为与通用 kernel 一致）；但**代码尺寸上** `dk > 128` 的 shape 会连带载入 96 桶专用的整段 Cube 机器码，而这些指令永远不会被执行。也就是说"4 个实例"这个账要这么算：兜底路径与 96 桶共用同一份二进制，省掉的不只是"一个 kernel"而是"一个完整的 2461 行模板实例化"。
- 行 323-324 的两行注释在 69300ffc 之后**只更新了第一句**。第二句 "Shapes above 128 use the generic fallback in the 96-wide kernel class" 说的是 725cf45d 的三桶世界（64/96/128，兜底确实寄居在 key1 的 96 桶里）。补回 80 桶之后，兜底搬到了 key2，96 的数值没变、但 `kMediumCubeDk` 这个名字与它相邻的 `kMidSmallCubeDk` 已经不能望文生义。**"kMedium 其实是第三档、kMidSmall 其实是第二档"**——这是插桶留下的命名化石，读代码时不要被误导。
 
**对照初版 a9c66ddb（`src/a9c66ddb/op_host/chunk_gated_delta_rule_tiling.cpp:311-321`）的三桶**，可以精确量出"省 launch 开销"这条决策被推翻的过程：

```cpp
  // Keep exactly three compiled kernels: key 0 is the dense Dk=80 Cube path,
  // key 2 is the fixed Dk=128 path, and key 1 handles both Dk=64 and generic
  // shapes. Avoiding a fourth kernel also avoids a measurable launch overhead
  // on small generic shapes.
  uint32_t tilingKey = 1;
  if (dims.dk == kDk80) {
    tilingKey = 0;
  } else if (dims.dk == kMatmulK) {
    tilingKey = 2;
  }
  context->SetTilingKey(tilingKey);
```

  三处结构性差别：

① 初版判的是 `dims.dk == 精确值`，终版判的是 `cubeDk == 桶常量`（值域化后 `dk=79` 与 `dk=80` 必须同桶，用 `dk` 判就写不出四桶）；

② 初版 key1 同时承担"dk≤64 的 Cube"和"64<dk 的兜底"，`kSpecializedDk=64` 与 `kSpecializedDk=0` 挤在同一个实例里；终版的兜底挤在 `kSpecializedDk=96` 里；

③ 初版那句"避免第 4 个 kernel"的承诺在 69300ffc 被自己的四分派推翻了。


  这段前后对照是"技术债的时间尺度"的干净样本：**作者明知多实例有 launch 成本，仍然在一天后付下这笔成本**，因为泛化（覆盖非 benchmark shape）的优先级高于小 shape 的启动开销。

---

## 9. 观测点（334-335）

锚点：chunk_gated_delta_rule_tiling.cpp:334-335

```cpp

  LogTiling(dims, chunkSize, numChunks, scaleValueAttr, ubSize, vStepVal, blockDim, outQueueMax, tbufTotal, restBytes);
```

- 它只打印 10 个量，`cubeDk` / `alignK` / `tilingKey` / `vTileCount` / `requiredWorkspace` **一个都不打**。而 `docs/PR-1135-d0906c3e/02-实验复现.md:186-187` 恰恰要靠"这个 shape 走了哪个桶"来判断 725cf45d 与 d0906c3e 的差异，作者只能从 `vStep=` 与 `tbuf=` 的数值反推。也就是说：**四桶归属这个本篇最重要的新增语义，是这套观测窗唯一看不见的东西**，需要在复现时手工补打印或在 host 侧加断点。

---

## 10. workspace 预算：state 镜像 + 每核 128 KiB（336-346）

锚点：chunk_gated_delta_rule_tiling.cpp:336-346

```cpp
  size_t *ws = context->GetWorkspaceSizes(kWorkspaceCount);
  if (ws != nullptr) {
    uint64_t workspaceStrideV = CeilAlign(dims.dv, FP32_NUM_PER_BLOCK);
    uint64_t stateWorkspaceBytes =
      static_cast<uint64_t>(dims.batch) * dims.hv * dims.dk * workspaceStrideV * sizeof(float);
    uint64_t requiredWorkspace = stateWorkspaceBytes + static_cast<uint64_t>(blockDim) * kRawMatmulStageBytesPerCore;
    ws[0] = (requiredWorkspace > kWorkspaceBytes) ? requiredWorkspace : kWorkspaceBytes;
  }
  return GRAPH_SUCCESS;
}
```

**机器语义**：`GetWorkspaceSizes(n)` 返回一个 `size_t*`（n 个槽位），tiling 在其中填入每槽需要多少字节；框架在真正执行算子前按这个总账从 GM 堆里申请，再把首地址作为 `workspaceGM` 传给 kernel。device 侧 `GetUserWorkspace(workspaceGM)`（入口行 29）取回同一块地址。所以这里的算术错误会直接变成 device 侧越界写，**没有任何越界检测**。

- 行 337 `kWorkspaceCount = 1`（02 篇 §4）→ 只有一个 `ws[0]`。行 338 的判空之后**没有 else 分支**：拿不到指针就静默跳过，`ws` 保持框架给的初值，device 会拿到一块可能不够大的 workspace。与 `ParseShapeDims`/`GetTilingData` 的"判空即 `GRAPH_FAILED`"风格不一致——**这是本篇识别的第二处不一致**，因为这里"失败"的代价是内存越界而不是返回错误。
- **第一块：state 的 GM 镜像**。`B × Hv × dk × CeilAlign(dv, 8) × 4`，逐项与 device 侧 `stateWorkspaceGm_` 的访问模式对齐：`stateStrideK_` 在这里是 **`dims.dk`（未补桶宽）**、行距是 `CeilAlign(dv, 8)`（FP32 的 32B 块）。
  **注意一个容易看错的点**：§4 把 `alignK` 抬到了桶宽，但**state 镜像的行数仍用原始 `dk`**。原因是 state 的 K 维在 GM 上按真实 `dk` 存放、只在进 UB 时才补到桶宽。device 侧 `GetCubeStageBase` 的 `B_ * NV_ * realK_ * stateWorkspaceStrideV_`（`kernel.h:250`）用的是同一组量（`realK_ = tilingData->dk`），**两侧逐项同式**，这是 host 的 workspace 账与 device 的偏移计算能对齐的根据。
  这块在 !1108 里就存在（`00e39ab5:286-288`），!1135 一行未改。
- **第二块：Cube 的 GM 中转暂存，`blockDim × 131072 B`**。`kRawMatmulStageBytesPerCore` 的算式见 02 篇 §3：`2 slots × (2×64×128 + 128×128) × 2 B = 131072 B = 128 KiB`（每 slot 64 KiB = A_hi + A_lo 各 `64×128` 加 B 的 `128×128`，全部 FP16）。
  - **为什么乘 `blockDim` 而不是 `B × Hv`**：device 侧 slot 索引是 `blockIdx_ * CUBE_STAGE_SLOT_COUNT + slot`（`kernel.h:251-253`），**里面没有任何工作项坐标**。暂存区是"每核一份流水缓冲"，同核上先后处理的多个工作项复用同一对 slot。按工作项数申请会放大 `workItems/blockDim` 倍（例如 `1×1×8×64×64` 是 8 倍），纯浪费。反过来，`blockDim` 已由行 318 的 `min(workItems, aivNum)` 给出上界，所以这个乘积既不欠也不多。
  - **为什么经 GM 而不 UB→L1**：310P（dav_m200）上 Mmad 的操作数只能从 L1 读，而 UB→L1 **没有直接通路**；唯一入口是 MTE3 写 GM + MTE2 读 GM。所以"Cube 化的第一笔真实开销"其实是 GM 带宽。
- 行 343 `max(requiredWorkspace, kWorkspaceBytes)`，`kWorkspaceBytes = 32 MiB`（行 39）。**它是下限不是上限**，所以中小 shape 全部落在 32 MiB 上。按公式实算几组（`blockDim` 取 1，即 310P 单核；state 项与 `blockDim` 无关）：

| shape `B×T×H×Dk×Dv` | `cubeDk` | `alignK` | `vStep` | state 镜像 | Cube 暂存 | `requiredWorkspace` | 下发 `ws[0]` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1×1×8×64×64 | 64 | 64 | 64 | 131 072 | 131 072 | 262 144 | 33 554 432 |
| 1×1×8×80×80 | 80 | 80 | 80 | 204 800 | 131 072 | 335 872 | 33 554 432 |
| 1×1×8×96×96 | 96 | 96 | 96 | 294 912 | 131 072 | 425 984 | 33 554 432 |
| 1×1×8×128×128 | 128 | 128 | 128 | 524 288 | 131 072 | 655 360 | 33 554 432 |
| 1×1×4×48×64 | 64 | 64 | 64 | 49 152 | 131 072 | 180 224 | 33 554 432 |
| 1×1×8×144×128 | 0（兜底） | 144 | 128 | 589 824 | 131 072 | 720 896 | 33 554 432 |

  读法：`vStep` 列取的是"UB 装得下 `preferredVStep`"这一理想分支的结果（真机日志 `dk=80 → vStep=80`、泛化期 `dk=80 → vStep=96` 与之吻合）。**最后一列全是 32 MiB，说明 benchmark shape 上 Cube 化没有增加实际 workspace**——增加的只是 `requiredWorkspace` 这个"账面值"，而它远未顶到下限。`blockDim` 从 1 涨到 8 时第二项变成 1 MiB，仍然远小于 32 MiB。

这条实测结论很重要：**"Cube 化要吃 GM"的担忧在这些形状上不成立，代价落在 GM 带宽而不是 GM 容量上**。

真要顶破 32 MiB，需要 `B × Hv × dk × alignV × 4 > 32 MiB`，例如 `B=8, Hv=32, dk=128, dv=128` → `8×32×128×128×4 = 16 MiB`（还没破），再叠 `blockDim × 128 KiB` 才会破线。所以**上限触发的现实风险很低，但一旦触发就是线性放大**。
- 行 345 `return GRAPH_SUCCESS;`：整个函数只有这一个成功出口、四个失败出口（行 269 / 274 / 302 / 307）。这种"单成功、多失败"的形状是 tiling 函数的标准写法，因为框架只看返回值。
- 与 !1108 的 workspace 段对照，差异**只有 `requiredWorkspace` 这一行**

---

## 11. 收尾与注册宏（347-349）

锚点：chunk_gated_delta_rule_tiling.cpp:347-349

```cpp
}  // namespace

IMPL_OP_OPTILING(ChunkGatedDeltaRule).Tiling(ChunkGatedDeltaRuleTilingFunc, sizeof(ChunkGatedDeltaRuleTilingData));
```

- 与 !1108 的对应行（`00e39ab5:293-295`）**逐字节相同**；