# 04 · 快路径判定与 LoadPaddedRows 装载

## 4.1 本章结论先行

锚点：chunk_gated_delta_rule.h:247-414

1. **`ShouldSplitVTiles` 从两条条件砍成一条**（247），不是简化逻辑而是**职责上移**：V-tile 数已经进入 host 侧 blockDim 计算，kernel 侧必须用同一个条件，否则 `IsCurrentBlock` 的工作项编号会和 host 的分派错位。
2. **`GetCubeStageBase`（249-256）是整个 Cube 化的地基**：从 workspace 的 state 区后面切出「每核 2 个 64KB slot」。之所以要借 GM 中转，是因为 310P 上 UB→L1 没有 DMA 通路——Mmad 只能吃 L1，所以 UB 上的 FP32 中间量必须先 MTE3 写出去、再 MTE2 读进 L1。
3. **`IsCubeFastPath`（257-263）的泛化点是 `realK_ <= kSpecializedDk`**：初版 `a9c66ddb` 要求 dk 恰好等于桶宽，终态改成"桶内所有 dk 都走 Cube"。`vStepAligned_`/`avFp32` 仍保持 `==`，因为这三个被它守卫的融合函数把 tile 宽写死成 `kSpecializedDk`；`>=` 式的放宽出现在另外两处内联 dispatch（968、1192），不在这个函数里。
4. **`LoadPaddedRows`（272-341）是"三段式防御装载"**：整块 `Duplicate` 清零 → 按完整 32B 块的 strided `DataCopy` → 尾巴（≤15 元素）走"整块预读 + 标量清零越界"，最后一行永远纯标量。它**刻意不使用 `DataCopyPad`**：中间 commit `725cf45d` 用过，在 dav_m200 上 MTE2 静默不写数据导致输出全零，`69300ffc` 才重写成现在这版。
5. **342-414 这五个函数（IsCurrentBlock / LoadG / LoadBeta / ScalarExp / DotFp32）与 !1108 的 241-312 逐字节相同**（`diff` 已验证），它们在本 PR 里集体降级为"慢路径专用"——快路径上分别被 Gather 批量装载、`Exp` 高维指令、Cube 矩阵乘取代，所以一个字节都不用改。

## 4.2 硬件底座：本章用到的机器语义

锚点：chunk_gated_delta_rule.h:34-41

```cpp
constexpr uint64_t BUFFER_NUM = 1;
constexpr uint64_t FP16_NUM_PER_BLOCK = 16;
constexpr uint64_t FP32_NUM_PER_BLOCK = 8;
constexpr int64_t BLOCK_BYTES = 32;
constexpr uint64_t CUBE_STAGE_SLOT_BYTES = 64 * 1024;
constexpr uint32_t CUBE_STAGE_SLOT_COUNT = 2;
// Number of Taylor-series terms used by ScalarExp to approximate exp on a scalar.
constexpr int kExpTaylorTerms = 12;
```

这 8 行是第 03 章的范围，本章全部推导都建立在它们之上，所以先摆出来：`BLOCK_BYTES=32` 是 Ascend DMA 的最小搬运单位（一个"数据块"）；`FP16_NUM_PER_BLOCK=16` / `FP32_NUM_PER_BLOCK=8` 就是 32B 里能装的元素数（16×2B、8×4B）；后两行是 Cube GM 暂存区的槽宽与槽数，本章 4.4 节会用到。

**存储与搬运层级（310P / dav_m200 这一代）**

| 层级 | 谁在用 | 本章相关事实 |
|---|---|---|
| GM（HBM） | 所有核共享 | `LoadPaddedRows` 的源；`GetCubeStageBase` 返回的也是 GM 地址 |
| UB（统一缓冲） | Vector 管唯一可算的片上存储 | `tmpBuff` 切成 chunkKFp32/chunkVFp32/… ；`Duplicate`/`Cast` 都作用在 UB |
| L1 | Cube 的操作数总仓 | 分成 A1（放 A 操作数）/B1（放 B 操作数）两个区，`TPosition::A1/B1` 就是这两个槽位 |
| L0A / L0B | Mmad 直读的操作数锁存 | `TPosition::A2/B2`；由 MTE1 从 L1 搬入，见第 05 章 |
| L0C | Mmad 的 FP32 累加器 | `TPosition::CO1`；**原生排布是 NZ 分形序**，读回只能手工做 NZ→ND |

三条硬约束决定了本章代码的形状：

1. **Mmad 的操作数只能在 L1**，而 **UB→L1 没有直接 DMA**。唯一的绕行是 UB →(MTE3)→ GM →(MTE2, Nd2Nz)→ L1。这就是 `GetCubeStageBase` 存在的理由。
2. **310P 没有 Fixpipe**（Ascend 910B 上负责"L0C→下游、顺手做 NZ→ND 转置与 Cast"的后处理单元）。后果是高层 `Matmul` API 整条链路不可用，必须手写裸 `Mmad` + 自己做 L0C(NZ)→UB(ND) 的逐行地址算术（第 05 章 5.5 节）。`docs/PR-1135-d0906c3e/10-Commit演进史.md` §1.1 把这条列为本 PR 的两点初版决策之一，本章只负责它的前半段（GM 暂存）。
3. **Cube 单元只接受 FP16 输入**，而算法中间量必须 FP32 → 高低位补偿分裂，一个 FP32 矩阵乘展开成 4 次 Cube 乘积（第 05 章）。本章的 `LoadPaddedRows` 要为它准备**桶宽对齐、填充区严格为 0** 的 FP32 源。

**指令机器语义（本章出现的）**

| 指令 | 机器语义 | 本章出处 |
|---|---|---|
| `Duplicate(dst, val, count)` | V 管把单个标量 `val` 铺满 UB 连续 `count` 元素，一条指令完成清零，不产生标量循环 | 274 |
| `Cast(dst, src, mode, count)` | V 管逐元素类型转换；`CAST_NONE` 表示不做舍入策略（截断），FP32→FP16 会掉精度，FP16→FP32 无损 | 338 |
| `DataCopy(dst, src, DataCopyParams{bc,bl,ss,ds})` | MTE2/MTE3 的 2D 搬运：`bc` 块数（外层）、`bl` 每段块长、`ss/ds` 源/目的的**跨段间隙**，四者全以 32B 块为单位（`bc` 是 `uint16_t`，故间隙必须 ≤65535） | 292、296 |
| `PipeBarrier<P>()` | 把 P 管当前已发射的指令全部排空，等价于同管自栅栏 | 275、339 |
| `FetchEventID(HardEvent::X_Y)` + `SetFlag/WaitFlag` | 跨管显式事件栅栏：向动态申请来的事件号 Set，再 Wait，等价"等 X 管此前的动作对 Y 管可见" | 276-278、313-315、334-336 |
| `TQueSync<Pa,Pb>` | 不带数据的轻量跨管同步队列，`SetFlag(0)/WaitFlag(0)` 用于 Pa→Pb 的一次性握手 | 330-332 |
| `Mul/Muls/Add/Adds/Axpy/Gather/Brcb/MulAddDst/Exp` | V 管向量指令族。`Muls` 是"向量×标量"，`Adds` 是"向量+标量"（标量侧由立即数或 UB 标量提供），`Exp` 是 V 管的 e^x 查表+多项式近似，`Gather` 按偏移表跨步取列，`Brcb` 把一个标量广播成 8 路 32B 块，`MulAddDst` 一条指令做"带跨行步进的乘加" | 391、405-410（`Mul`/reduce）；Gather/Brcb/MulAddDst 见第 05 章对角块 |

## 4.3 ShouldSplitVTiles：判定条件与 !1108 的差异

锚点：chunk_gated_delta_rule.h:247-247

```cpp
  __aicore__ inline bool ShouldSplitVTiles() { return realV_ > vStep_; }
```

一行。它被 `InitLocalBuffers`（173）、`ComputeAvgload`（213）、`Process`（228）三处调用，决定 kernel 是"一个 value head 一个工作项"还是"一个 (head, V-tile) 一个工作项"。

**与 !1108 的差异**（`src/00e39ab5/op_kernel/chunk_gated_delta_rule.h:239`）：

```cpp
  __aicore__ inline bool ShouldSplitVTiles() { return realV_ > vStep_ && GetBlockNum() > NV_; }
```

差别是少了 `&& GetBlockNum() > NV_`。为什么必须删：

- !1108 里 V-tile 切分是**补救手段**——先按 head 分，核不够（`GetBlockNum() <= NV_`）才回头把 V 维再切。host 侧也是同一套两段式，所以 kernel 里 `false` 与 host 的"不切"是自洽的。
- !1135 把工作项一次性展平成 (batch, head, vTile) 三元组，`blockDim = min(workItems, aivNum)`，而 `workItems` 里已经乘过 `vTileCount = Ceil(dv, vStep)`。**kernel 侧此时没有选择权**：如果还保留 `GetBlockNum() > NV_` 这个附加条件，就会出现"host 按 3 个 tile 开了 3 个工作项、kernel 只处理 1 个"的漏算，输出直接错。所以条件必须收敛成与 host 完全同式的 `realV_ > vStep_`。
- 附带好处：`GetBlockNum()` 在 `__aicore__` 里是读架构寄存器的运行时调用，从每工作项一次的谓词里去掉，省掉重复取数。

## 4.4 GetCubeStageBase：每核 2×64KB 双 slot 从哪来

锚点：chunk_gated_delta_rule.h:249-256

```cpp
  __aicore__ inline __gm__ uint8_t *GetCubeStageBase(uint32_t slot) {
    uint64_t stateWorkspaceElements = static_cast<uint64_t>(B_) * NV_ * realK_ * stateWorkspaceStrideV_;
    uint64_t stageByteOffset =
      stateWorkspaceElements * sizeof(float) +
      (static_cast<uint64_t>(blockIdx_) * CUBE_STAGE_SLOT_COUNT + slot) * CUBE_STAGE_SLOT_BYTES;
    return workspaceAddr_ + stageByteOffset;
  }
```

逐行：249 返回 `__gm__ uint8_t *`——按**字节**粒度暴露，因为调用方（第 05 章 458-468、以及 1029-1042）自己 `reinterpret_cast<__gm__ half *>` 并按元素数摆子缓冲，字节基址最通用。250 先算 state 区有多少 FP32 元素：`B_ × NV_ × realK_ × stateWorkspaceStrideV_`，其中 `stateWorkspaceStrideV_ = Ceil(dv, 8) * 8`（构造 93 行），即 state 的 V 维按 32B/FP32 块向上取整，保证 `realK_`/`dv` 非对齐时这段也不产生跨槽的奇数偏移。251-253 把字节偏移分成两段相加：先跳过整个 state 区（`× sizeof(float)`），再定位到"第 `blockIdx_ * 2 + slot` 个 64KB 槽"。254 加回 workspace 基址。

**布局图**

```
workspaceAddr_ ─┬─ [FP32 state 镜像区  B*NV*realK_*stateWorkspaceStrideV_*4 字节]
                ├─ [core0 slot0 64KB][core0 slot1 64KB]
                ├─ [core1 slot0 64KB][core1 slot1 64KB]
                └─ ... 共 blockDim × 2 × 64KB
```

**每槽 64KB 怎么算出来的**：一个 Cube 乘积要同时准备 `A_hi[64,128]` + `A_lo[64,128]` + `B[128,128]`（FP16），即 `2×64×128×2B + 128×128×2B = 32768 + 32768 = 65536` 字节。host 侧 `kRawMatmulStageBytesPerCore = kCubeStageSlotCount * (2*kMatmulM*kMatmulK + kMatmulK*kMatmulN) * sizeof(uint16_t) = 2×65536 = 131072`（`op_host/chunk_gated_delta_rule_tiling.cpp:47-49`），再乘 `blockDim` 计入 workspace（同文件 :342）。**device 侧的 `CUBE_STAGE_SLOT_BYTES/COUNT` 与 host 侧的槽宽公式是一对必须同步的常量**——改了 host 不改 device 就是越界写。


----


**为什么要借 GM 中转**：Mmad 的操作数只能从 L1 读，而 Ascend 的 DMA 引擎只有 MTE2（GM→片上）与 MTE3（片上→GM）两个方向，**UB→L1 之间没有通路**，`DataCopy` 的源必须是 `GlobalTensor`。所以 UB 上的 FP32 中间量只能：UB --Cast--> UB(FP16) --MTE3--> GM slot --MTE2(Nd2Nz)--> L1 --MTE1--> L0A/L0B --Mmad--> L0C。这就是本章 4.4 这 8 行存在的全部理由；它的代价（一次乘积多两趟 GM 往返）在第 05 章 5.4 节用 slot 双缓冲和 B 驻留来抵。

**双 slot 干什么**：软件流水。slot0 被 Cube 消费的同时，MTE3 可以往 slot1 填下一个操作数——见 `ComputeAttnProductsCube`（1033-1042）用 `GetCubeStageBase(1)` 预写 Q，注释原文"Stage Q into a disjoint GM slot while the first compensated product is executing"。`MatmulBlockFp32Compensated`（第 05 章）只用 slot0，因为它的 4 个子缓冲总共才 8KB，同一次调用内部没有"边算边填"的机会。

## 4.5 IsCubeFastPath：从等值匹配到区间匹配

锚点：chunk_gated_delta_rule.h:257-263

```cpp
  __aicore__ inline bool IsCubeFastPath(uint32_t chunkLen, uint32_t avFp32) {
    if constexpr (kSpecializedDk != 0) {
      return realK_ <= kSpecializedDk && chunkLen == 64 && vStepAligned_ == kSpecializedDk && avFp32 == kSpecializedDk;
    }
    return false;
  }
```

四个合取项，逐个说为什么是这个形状：

- `if constexpr (kSpecializedDk != 0)`：**编译期**分支，不是运行时 if。`kSpecializedDk` 是模板第三参（74 行），入口按 tilingKey 实例化成 64/80/96/128 四档（`op_kernel/chunk_gated_delta_rule.cpp:32-48`）。Cube 的 Mmad 形状、L1/L0 分配大小全是 constexpr，必须编译期定宽，所以"这个 kernel 实例有没有 Cube 能力"也必须是编译期事实——`kSpecializedDk == 0` 的 generic 实例里 Cube 代码整段消失。
- `realK_ <= kSpecializedDk`：**这就是泛化点**。桶是"最小的装得下 dk 的编译期宽度"（host `SelectCubeDk`：dk≤64→64、≤80→80、≤96→96、≤128→128，>128→0），kernel 把 K 行补零到桶宽。所以桶内所有 dk 都能走同一条固定形状路径，判定条件也必须是区间而不是等值。它还顺手承担"dk>128 的 shape 排除在 Cube 之外"的职责：那些 shape 被 tiling 挂到 tilingKey=2（96 桶实例，`tiling.cpp:325-332` 注释"Shapes above 128 use the generic fallback in the 96-wide kernel class"），此时 `realK_ > kSpecializedDk` → `false` → 退回 !1108 的 Axpy 路径。
- `chunkLen == 64`：**尾块必须走慢路径**。Cube 形状写死 64×64×N，`chunkLen<64`（序列最后一个 chunk）时补齐区必须全零且不能污染结果，作者选择直接放弃 Cube。"真实负载的最后一个 chunk 是短板"那条的出处。
- `vStepAligned_ == kSpecializedDk && avFp32 == kSpecializedDk`：**这两个仍是等值**。因为本函数守卫的三个融合函数（调用点 1412 `ComputeValueAndVNewCubeDispatch` 一类、1535、2295）把 tile 的 N 维直接实例化成 `kSpecializedDk`，实际 V tile 宽必须正好等于桶宽才能一发 Mmad 装满；`avFp32`（本轮 V tile 的有效 FP32 宽）同理。
- 262 `return false;`：generic 实例的常量返回。注意 `src/d0906c3e/op_kernel/chunk_gated_delta_rule.cpp` 只实例化 64/80/96/128 四档，**这条 arm 在终态里是死代码**，保留是为了让 `kSpecializedDk = 0` 的模板仍可编译。

## 4.6 IsFusedValueOutputCubeFastPath：退化成别名

锚点：chunk_gated_delta_rule.h:264-266

```cpp
  __aicore__ inline bool IsFusedValueOutputCubeFastPath(uint32_t chunkLen, uint32_t avFp32) {
    return IsCubeFastPath(chunkLen, avFp32);
  }
```

3 行、零信息量的转发。

## 4.7 LoadPaddedRows（上）：接口、头注释与清零段

锚点：chunk_gated_delta_rule.h:268-279

```cpp
  // Copy a row-major GM slab to a zero-padded UB matrix using dav-2002
  // supported primitives. Aligned rows use one strided standard DataCopy;
  // non-aligned rows copy complete 32-byte blocks and fill at most 15 tail
  // elements through Scalar. The remaining 64/80/96/128 Cube tile stays zero.
  __aicore__ inline void LoadPaddedRows(LocalTensor<float> dst, LocalTensor<inType> staging, GlobalTensor<inType> src,
                                        uint64_t srcOffset, uint32_t rows, uint32_t gmRowElements) {
    Duplicate(staging, static_cast<inType>(0), rows * alignK_);
    PipeBarrier<PIPE_V>();
    event_t vectorToMte2 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE2));
    SetFlag<HardEvent::V_MTE2>(vectorToMte2);
    WaitFlag<HardEvent::V_MTE2>(vectorToMte2);
```

**职责**：把 GM 上一块行主序的 `rows × realK_` FP16 数据搬到 UB 的 `rows × alignK_` FP32 矩阵里，**行尾填充区必须严格为 0**。四个调用点分别装载 K（767）、注意力用的 Q 缓存（958）、输出阶段的 Q（1948）、state 阶段的 K（2135）。

参数逐个解释：`dst` 是最终 FP32 UB 目标（chunkKFp32 / chunkAttnOutFp32 / kCumdecayFp32）；`staging` 是**同一块 UB 借来的 FP16 落地区**——调用方给的是 `chunkVFp32.ReinterpretCast<inType>()`（761-762、956-957），所以它的容量是 `chunkVFp32` 元素数 ×2（FP32→FP16 每个槽能放 2 个），这正是调用方前置检查写成 `keyElements <= 2 * chunkSize_ * vStepAligned_`（760）的原因；`src` 是源张量，`srcOffset` 是它的元素级起点，`rows` 是行数（= chunkLen，最多 64），`gmRowElements` 是 **GM 侧的行距**（`NK_ * realK_`：K/Q 的布局是 `[T, Nk, dk]`，同 token 的其它 head 要跳过）。

为什么需要这个函数：!1108 只允许 `alignK_ == realK_`（K 维天然 32B 对齐）时走 DMA，否则整 chunk 标量 `GetValue`。桶宽填充（725cf45d 的 `alignK_ = cubeDk`）让 `alignK_ != realK_` 成为常态，而且 `gmRowElements` 也可能不是 16 的倍数，于是要有一个能处理"行内块数不够 + 源行距非整块 + 行尾变长填充"三件事叠加的装载器。

头注释（268-271）四个信息点：`row-major GM slab → zero-padded UB matrix`（方向与填充语义）、**`using dav-2002 supported primitives`**（这半句是本次重写的题眼，见 4.11 节）、"完整 32B 块 + 最多 15 个标量尾巴"、"剩下的 64/80/96/128 Cube tile 保持为 0"（四档桶宽被点名，说明这函数是桶化后的公共装载器）。

274 `Duplicate(staging, static_cast<inType>(0), rows * alignK_)`：V 管把整块落地区（**连填充区一起**）铺成 0。为什么先把整块清零再搬数据：DMA 只会覆盖每行前 `fullBlocks` 个整块，剩下的尾巴块和 `alignK_ - realK_` 的填充区必须自己保证是 0——所有 Cube 乘法吃完整桶宽，填充区非 0 就直接混进结果（`docs/PR-1135-d0906c3e/01-Cube化深度精读.md` §2.1 末）。
275 `PipeBarrier<PIPE_V>()`：把 `Duplicate` 从 V 管排空，确保后续同管指令（`Cast`）不会读到半写状态。
276-278 三行是 V→MTE2 的显式事件栅栏：`pipe_->FetchEventID(HardEvent::V_MTE2)` 向 TPipe **动态申请**一个事件号，然后对同一号 SetFlag+WaitFlag。Set/Wait 相邻调用等价于"等 V 管此前的写彻底落地再让 MTE2 动这块 UB"——自栅栏，语义上是 `Duplicate` 与紧随其后的 MTE2 之间的依赖。用 `FetchEventID` 而不是像别处那样直接写死 `(0)`，是因为同一事件类型下的 0 号槽位被其他路径复用（第 05 章里 `SetFlag<HardEvent::MTE2_MTE1>(0)` 这类），动态号避免和本函数的其他栅栏抢同一个硬件事件位。

## 4.8 LoadPaddedRows（中）：块几何与 strided 主路径

锚点：chunk_gated_delta_rule.h:280-298

```cpp
    uint32_t fullBlocks = realK_ / FP16_NUM_PER_BLOCK;
    uint32_t tailElements = realK_ % FP16_NUM_PER_BLOCK;
    uint32_t srcRowBlocks = gmRowElements / FP16_NUM_PER_BLOCK;
    uint32_t dstRowBlocks = alignK_ / FP16_NUM_PER_BLOCK;
    bool canUseStridedFullBlocks = fullBlocks > 0 && gmRowElements % FP16_NUM_PER_BLOCK == 0 &&
                                   alignK_ % FP16_NUM_PER_BLOCK == 0 && srcRowBlocks >= fullBlocks &&
                                   dstRowBlocks >= fullBlocks && srcRowBlocks - fullBlocks <= 65535U &&
                                   dstRowBlocks - fullBlocks <= 65535U;
    if (likely(canUseStridedFullBlocks)) {
      DataCopyParams copyParams{static_cast<uint16_t>(rows), static_cast<uint16_t>(fullBlocks),
                                static_cast<uint16_t>(srcRowBlocks - fullBlocks),
                                static_cast<uint16_t>(dstRowBlocks - fullBlocks)};
      DataCopy(staging, src[srcOffset], copyParams);
    } else if (fullBlocks > 0) {
      DataCopyParams rowParams{1, static_cast<uint16_t>(fullBlocks), 0, 0};
      for (uint32_t row = 0; row < rows; ++row) {
        DataCopy(staging[row * alignK_], src[srcOffset + static_cast<uint64_t>(row) * gmRowElements], rowParams);
      }
    }
```

**280-283 四个量的推导（每一行都对应一个"为什么要除 16"）**

以 `FP16_NUM_PER_BLOCK = 16`（= 32B / 2B）为单位把三个长度换算成块数：

| 变量 | 表达式 | 含义 | 为什么是它 |
|---|---|---|---|
| `fullBlocks` | `realK_ / 16` | 每行**能用整块搬**的块数 | DMA 的 `blockLen` 以 32B 为单位，装不下半个块 |
| `tailElements` | `realK_ % 16` | 每行的**标量尾巴长度**（0..15） | 同上：不足 32B 的余量必须由标量通路补齐 |
| `srcRowBlocks` | `gmRowElements / 16` | GM 侧行距（块） | 2D DataCopy 的"源间隙"= 源行距 − 每段长度 |
| `dstRowBlocks` | `alignK_ / 16` | UB 侧行距（块）= 桶宽 | 目的间隙 = 桶宽 − 每段长度，即行尾填充区 |

于是主路径的四个字段是：`blockCount = rows`（外层循环 64 行）、`blockLen = fullBlocks`（每行搬 `fullBlocks` 个整块）、`srcStride = srcRowBlocks - fullBlocks`（**跳过同 token 其它 head 剩下的部分**）、`dstStride = dstRowBlocks - fullBlocks`（**跳过本行行尾的填充+尾巴区**）。两个间隙一个朝 GM、一个朝 UB，一条 2D DMA 同时表达"跨行读"和"跨行写带填充"，这就是 `docs/.../01-Cube化深度精读.md` §2.1 里标注的"② 2D 带双 gap 一次搬完"。

**284-287 七个合取条件，每个都对应一类硬件/编码限制**：

1. `fullBlocks > 0`：`realK_ < 16` 时整块部分为空，块式 DMA 无意义（退化成纯标量尾巴）。
2. `gmRowElements % 16 == 0`：源行距必须是整块数，否则行间隙落在块中间，2D 描述不出来。
3. `alignK_ % 16 == 0`：目的行距同理——注意桶宽 64/80/96/128 全是 16 的倍数，所以这条在 Cube 桶下恒真；`alignK_` 走 naturalAlign（90-91 行）时也是 16 倍数，恒真。真正卡住的是第 2 条：`NK_ * realK_` 在 realK_=63、Nk=8 时是 504，不整除 → 走 else。
4. `srcRowBlocks >= fullBlocks`、5. `dstRowBlocks >= fullBlocks`：保证两个 `x - fullBlocks` 不做无符号下溢（`uint32_t` 下溢会得到巨大值，`static_cast<uint16_t>` 后变成随机间隙）。
6. `srcRowBlocks - fullBlocks <= 65535U`、7. `dstRowBlocks - fullBlocks <= 65535U`：**`DataCopyParams` 四个字段都是 `uint16_t`**，间隙必须塞进 16 位。注意 289-291 里 `rows` 与 `fullBlocks` 同样被 `static_cast<uint16_t>`，这里靠 `chunkLen <= 64` 的前置条件天然满足，所以没写判定。

`likely(...)`（288）：把主路径标成热分支，编译期分支布局更靠前；这是 CANN 代码里通用的写法，没有硬件语义。

**293-298 else-if 分支**：条件 2 或 3 不满足（行距不是整块数）时，**行间间隙无法用一条 DMA 表达**，但**行内的整块部分仍然是整块**，于是逐行发一条 `rowParams{1, fullBlocks, 0, 0}`——间隙 0、段数 1，退化成 1D，行地址靠 `srcOffset + row * gmRowElements` / `staging[row * alignK_]` 手工算。代价是 `rows` 条 DMA 指令（≤64 条 MTE2），比逐元素标量读便宜两个量级，是"半退化"路径。

这一段的尾巴（300-332）是真正需要技巧的部分，单独一节。

## 4.9 LoadPaddedRows（下）：尾巴的三种处理与"整块预读再清零"

锚点：chunk_gated_delta_rule.h:300-341

```cpp
    if (unlikely(tailElements != 0)) {
      uint32_t tailOffset = fullBlocks * FP16_NUM_PER_BLOCK;
      bool copyTailAsBlock = tailElements > FP16_NUM_PER_BLOCK / 2 && rows > 1 &&
                             gmRowElements % FP16_NUM_PER_BLOCK == 0 && alignK_ % FP16_NUM_PER_BLOCK == 0 &&
                             srcRowBlocks > 0 && dstRowBlocks > 0 && srcRowBlocks - 1 <= 65535U &&
                             dstRowBlocks - 1 <= 65535U;
      if (copyTailAsBlock) {
        // Every row except the last one may safely read through the short tail
        // into the following token/head. Clear those extra elements below.
        DataCopyParams tailParams{static_cast<uint16_t>(rows - 1), 1, static_cast<uint16_t>(srcRowBlocks - 1),
                                  static_cast<uint16_t>(dstRowBlocks - 1)};
        DataCopy(staging[tailOffset], src[srcOffset + tailOffset], tailParams);
      }
      event_t mte2ToScalar = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_S));
      SetFlag<HardEvent::MTE2_S>(mte2ToScalar);
      WaitFlag<HardEvent::MTE2_S>(mte2ToScalar);
      uint32_t scalarStartRow = copyTailAsBlock ? rows - 1 : 0;
      if (copyTailAsBlock) {
        for (uint32_t row = 0; row + 1 < rows; ++row) {
          for (uint32_t col = realK_; col < tailOffset + FP16_NUM_PER_BLOCK; ++col) {
            staging.SetValue(row * alignK_ + col, static_cast<inType>(0));
          }
        }
      }
      for (uint32_t row = scalarStartRow; row < rows; ++row) {
        uint64_t gmRowOffset = srcOffset + static_cast<uint64_t>(row) * gmRowElements;
        for (uint32_t col = tailOffset; col < realK_; ++col) {
          staging.SetValue(row * alignK_ + col, src.GetValue(gmRowOffset + col));
        }
      }
      TQueSync<PIPE_S, PIPE_V> scalarToVector;
      scalarToVector.SetFlag(0);
      scalarToVector.WaitFlag(0);
    } else {
      event_t mte2ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE2_V));
      SetFlag<HardEvent::MTE2_V>(mte2ToVector);
      WaitFlag<HardEvent::MTE2_V>(mte2ToVector);
    }
    Cast(dst, staging, RoundMode::CAST_NONE, rows * alignK_);
    PipeBarrier<PIPE_V>();
  }
```

**301 `tailOffset = fullBlocks * 16`**：整块部分已经写到 `[0, tailOffset)`，尾巴从这个下标开始，是"块边界"而不是"数据边界"——这个区别是整个技巧的核心。

**302-305 `copyTailAsBlock` 的六个条件**：

- `tailElements > FP16_NUM_PER_BLOCK / 2`（即 >8）：**收益/成本判断**。尾巴超过半块才值得为它多发一条 DMA；否则 `tailElements` 个标量 `SetValue`（≤8 次）比"一条 DMA + 一条 DMA 的 MTE2 发射开销 + 清脏循环"更便宜。注意这个阈值是"半个 32B 块"，纯粹由搬运单位推出，不是调参结果。
- `rows > 1`：**最后一条 DMA 只能覆盖前 `rows-1` 行**（见下），`rows == 1` 时 `blockCount = 0`，`DataCopyParams` 的 `blockCount=0` 无意义（不搬任何块），并且唯一一行恰好是最不该越界读的那一行。
- 两个 `% 16 == 0`：这里和主路径的意图不同——要求**行距和桶宽都是整块数**，这样"每行前进一整块"才落在一块的起点上（间隙 = `srcRowBlocks - 1`、`dstRowBlocks - 1`，都是整块数）。
- `srcRowBlocks > 0 && dstRowBlocks > 0`：防无符号下溢（要做 `-1`）。
- 两个 `<= 65535U`：同上，`uint16_t` 容量。

**306-312 "整块预读"**：`tailParams{rows-1, 1, srcRowBlocks-1, dstRowBlocks-1}` 读 `rows-1` 行、每行 1 个 32B 块、块长 1 块。源起点 `src[srcOffset + tailOffset]`，每行读 16 个元素——但真实数据只有 `tailElements`（≤15）个，**多读的 16−tailElements 个元素落在同一张量的下一行开头**（下一个 token 或同一个 token 的下一个 head）。这是合法内存，读进来无害，随后清掉即可：

```
每行 realK_ 个有效元素：  [== 整块部分 fullBlocks*16 ==][== 尾巴 tailElements ==][ 下一行的数据… ]
块预读窗口 (16 元素)：                                     [^^^^ 读 1 块 ^^^^^^^^^^^^^^^^^^^^^^^^^]
```

- **为什么这样可以**：越界读的目标是**同一块 GM 张量内部的合法数据**（不是分配边界外），硬件不会 fault；污染的只是 UB 里 `staging` 的填充位置，而这些位置接下来立刻会被标量清零（317-323）。
- **为什么最后一行不行**：最后一行（`row = rows-1`）的"后 16 个元素"可能已经越过本张量尾（甚至越页边界/保护页），读出去就是非法访存或读到无法预期的邻居数据。所以 `blockCount` 取 `rows-1`，最后一行单独走标量。
- 311 `staging[tailOffset]` 与 `src[srcOffset + tailOffset]` 的基址偏移都是 `tailOffset = fullBlocks*16` 元素 = `fullBlocks` 个整块，所以两侧仍落在 32B 边界上（前提：外层 `srcOffset` 本身对齐，见 4.12 节的存疑点）。

**313-315**：`MTE2_S` 事件栅栏——后面要立刻用标量 `SetValue/GetValue` 动同一块 UB/GM，必须等 MTE2 的两趟搬运（主块 + 尾巴块）真正写完。这与主路径之后的 334-336（`MTE2_V`）是同一件事的两个版本：走标量尾巴就等 MTE2→S，不走标量就直接等 MTE2→V。

**316 `scalarStartRow`**：`copyTailAsBlock` 时是 `rows-1`（前 `rows-1` 行已由 DMA 填好，只剩清脏 + 尾巴区之后的填充区保持 0），否则从 0 开始全标量。这一行是"两条路径共用后面的补齐循环"的接缝。

**317-323 清脏**：对前 `rows-1` 行，把 `[realK_, tailOffset+16)` 这 `16 - tailElements` 个元素显式写 0。注意下界是 `realK_`（有效数据末尾）而不是 `tailOffset`——预读带进来的脏数据正好是这个区间。写 `inType(0)` 而不是 `float(0)`，因为 `staging` 是 FP16 视图。清完之后，每行 `[realK_, alignK_)` 全为 0，满足"Cube 吃完整桶宽"的前提。

**324-329 标量补齐**：`for (col = tailOffset; col < realK_; ++col)` 逐元素 `src.GetValue(gmRowOffset + col)` → `staging.SetValue(...)`。这段是 S 管访问 GM/UB，每元素一次标量访存，最坏 15 次/行；只在尾巴不被当作整块时才成为主开销。

**330-332**：`TQueSync<PIPE_S, PIPE_V>` 的 S→V 握手——标量写 UB 之后要让 V 管的 `Cast` 看到，靠这个不带数据的队列同步（比 `PipeBarrier` 轻，且不需要 GM 地址序）。
**333-337 else**：尾巴为 0 时只等 `MTE2_V`（DMA 写完 → V 管可读）。
**338 `Cast(dst, staging, RoundMode::CAST_NONE, rows * alignK_)`**：整块 FP16→FP32 一次拉通（无损），同时完成"把 inType 视图里的数据搬进真正的 FP32 目标 `dst`"。`CAST_NONE` 表示不加舍入策略——升精度不需要舍入。
**339 `PipeBarrier<PIPE_V>()`**：`Cast` 排空，函数返回后调用方（例如 959 的 `Muls(chunkAttnOutFp32, ..., scale_, ...)`）可以立刻接着用 V 管读这块结果。

## 4.10 为什么不用 DataCopyPad：一次真实的全零事故

锚点：chunk_gated_delta_rule.h:268-271

头注释里的 `using dav-2002 supported primitives` 不是修辞，是事故报告的第一句。
- **725cf45d（8/17 上午）** 把原来散在 4 处的 strided DataCopy + 手工同步收敛成一个 `LoadPaddedRows`，用的是 **`DataCopyPad` + `DataCopyPadExtParams`**（GM→UB 带右填充，官方 API 正好描述"行尾补 0 到桶宽"这件事，看起来是最贴切的选择）。
- **实测后果**：这个构建在标准 dk=64 shape 上**输出全零**（`out/state absmax=0.0`，无 NaN），26 例里 11 failed。根因是 **310P（dav_m200）的 MTE2 对 `DataCopyPad` 支持不完整，表现为静默不写数据**：UB 先被 `Duplicate` 清零、`DataCopyPad` 不落数、后续 `Cast` 读到的全是 0，于是全链路输出全零。因为 `test_shapes_and_dtypes`/`test_optional_g` 只断言 `torch.isfinite`，全零恰好有限，被这类冒烟测试直接放过（§9.3 的方法论第 1 条）。
- **69300ffc（8/17 中午）** 把整个函数重写成现在这版：只用最标准、最保守的 `DataCopy` 四元组 + 标量补齐，每一步都注明硬件约束来源，从此正确。旁证：初版 `a9c66ddb` 的 kernel.h 里 `DataCopyPad` 出现 **0 次**（本仓库快照 `grep -c` 复核：`src/a9c66ddb`、`src/d0906c3e` 两个快照的 `op_kernel/` 下均无 `DataCopyPad`），是 725cf45d 首次引入、69300ffc 归零。

结论对读者的可迁移部分：**在代际较旧的 NPU 上，"高层带 padding 的 DMA API"属于半支持面，跨代复用必须先用最小探针验证**；宁可用 `Duplicate + 标准 DataCopy + 标量尾巴` 这种"笨但每条都有硬件契约"的组合，也不要把正确性押在一条没有实测过的指令上。

## 4.11 342-414：与 !1108 逐字节相同的五个慢路径工具

锚点：chunk_gated_delta_rule.h:342-414

先用机器复核：`sed -n '241,312p' src/00e39ab5/... | diff - <(sed -n '342,413p' src/d0906c3e/...)` **输出为空**——即 342-413 与 !1108 的 241-312 完全一致（414 是函数间空行，与 !1108:313 同为空行）。所以本节成块引用 + 逐函数一行说明，不重抄"改动"，因为没有改动。

```cpp
  __aicore__ inline bool IsCurrentBlock(int32_t seqlen) {
    load_ += seqlen;
    bool ret = (blockIdx_ == usedblk_ && seqlen > 0);
    if (load_ >= avgload_) {
      load_ = 0;
      usedblk_++;
    }
    return ret;
  }

  __aicore__ inline float LoadG(int32_t t, uint64_t head_i) {
    if (hasGamma_ == 0) {
      return 0.0f;
    }
    return gGm_.GetValue(t * NV_ + head_i);
  }

  __aicore__ inline float LoadBeta(int32_t t, uint64_t head_i) {
    inType bVal = betaGm_.GetValue(t * NV_ + head_i);
    return static_cast<float>(bVal);
  }
  ...
```

- **342-351 `IsCurrentBlock`**：贪心均分。每个核按工作项顺序累加 `load_`，轮到自己（`blockIdx_ == usedblk_`）就处理，累计负载超过 `avgload_`（213-214 算出的 `Ceil(realT * NV_ * workItemsPerHead, GetBlockNum())`）就把指针 `usedblk_` 推进给下一个核。变长序列下这是把"长序列核"和"短序列核"拉平的老办法；!1135 唯一的关联改动是**调用点**从"每 head 一次"变成"每 (head, vTile) 一次"（232、238），函数体一字未动。
- **352-358 `LoadG`**：标量读可选输入 `g`，布局 `[T, Nv]` FP32，所以行距是 `NV_`；`hasGamma_ == 0` 时返回 0.0f（log 域衰减 0 ⇒ γ=1，退化为无门控 DeltaNet）。
- **359-363 `LoadBeta`**：标量读 `beta`（`inType`=FP16）并升到 FP32，同样是 `[T, Nv]` 行距 `NV_`。
- **364-386 `ScalarExp`**（函数体 364-385，386 为空行）。

```cpp
  __aicore__ inline float ScalarExp(float val) {
    float absVal = (val >= 0.0f) ? val : -val;
    int k = 0;
    float reduced = absVal;
    while (reduced > 1.0f) {
      reduced *= 0.5f;
      k++;
    }
    float result = 1.0f;
    float term = 1.0f;
    for (int i = 1; i <= kExpTaylorTerms; i++) {
      term *= reduced / static_cast<float>(i);
      result += term;
    }
    for (int i = 0; i < k; i++) {
      result *= result;
    }
    if (val < 0.0f) {
      result = 1.0f / result;
    }
    return result;
  }
```

  机器语义：这是**纯标量管**实现，因为 Ascend 的 `Exp` 是 V 管指令、只能在 UB 向量上做，S 管对单个标量没有 e^x。算法是"参数归约 + 泰勒 12 项 + 平方回代 + 取倒数"：`while` 把 |x| 折半到 ≤1（折了几次记在 `k`），在 [0,1] 上用 `kExpTaylorTerms = 12` 项泰勒展开（41 行的常量），然后 `result *= result` 迭代 k 次还原 `exp(x) = exp(x/2^k)^(2^k)`，`val < 0` 时取倒数。为什么不用 `expf`：`__aicore__` 里不保证有 libm。它在终态只剩一个调用点（2307，state 更新的慢路径），快路径上已被 `Exp(deltaFp32, ...)` 一条高维指令替代（2128 附近）——`docs/PR-1135-d0906c3e/01-Cube化深度精读.md` §5 表格里"快路径 ScalarExp 消失"就是这个意思。

```cpp
  // Multiply a contiguous FP32 row pair on the vector pipe, then preserve the
  // partial sums on the vector pipe. Each 64-element repeat writes one scalar
  // at an eight-element stride; only those partials are accumulated by scalar.
  __aicore__ inline float DotFp32(LocalTensor<float> lhs, LocalTensor<float> rhs, uint32_t count) {
    Mul(dotProductFp32, lhs, rhs, count);
    constexpr uint32_t kReduceRepeatElements = 64;
    constexpr uint32_t kReduceDstStride = 8;
    constexpr uint32_t kReduceSrcRepeatStride = 8;
    uint32_t fullRepeats = count / kReduceRepeatElements;
    uint32_t tail = count % kReduceRepeatElements;
    if (fullRepeats > 0) {
      WholeReduceSum(dotProductFp32, dotProductFp32, kReduceRepeatElements, fullRepeats, kReduceDstStride, 1,
                     kReduceSrcRepeatStride);
    }
    TQueSync<PIPE_V, PIPE_S> mulSync;
    mulSync.SetFlag(0);
    mulSync.WaitFlag(0);
    float sum = 0.0f;
    for (uint32_t i = 0; i < fullRepeats; i++) {
      sum += dotProductFp32.GetValue(i * kReduceDstStride);
    }
    uint32_t tailOffset = fullRepeats * kReduceRepeatElements;
    for (uint32_t i = 0; i < tail; i++) {
      sum += dotProductFp32.GetValue(tailOffset + i);
    }
    return sum;
  }
```

- **387-413 `DotFp32`**（387-389 是头注释，414 空行）：慢路径的行点积。`Mul`（V 管逐元素乘）先把两行乘进 `dotProductFp32`；`WholeReduceSum` 做分段归约——每 `kReduceRepeatElements = 64` 个元素归约成**一个标量结果**，写到 `kReduceDstStride = 8`（8 个 FP32 = 32B）的跨步位置上，所以归约后的部分和是"稀疏分布"的，注释第 2-3 句说的就是这件事。`TQueSync<PIPE_V, PIPE_S>` 把 V 的结果交给标量管；然后标量累加两类：前 `fullRepeats` 个部分和（按 8 元素跨步读，405-407）与尾部不足 64 个的原始乘积（408-411）。
- 为什么必须"先归约成部分和再标量加"：Ascend V 管没有原生全长度 reduction，`count` 最大是 `realK_`（≤128），如果全交给标量就是 128 次 UB 标量读；分两段（64 元素一段）把标量访存降到 `128/64 + 尾部`，是当时的最优折中。
- **它在终态的角色**：只剩 980、992、1008 三个调用点，全部位于 `ComputeAttnMatrix` 的慢路径。快路径用 `ComputeAttnProductsCube`（1022 起）把 4096 次 `DotFp32` 变成两次 Mmad——这是 !1135 收益最大的单点，也是本章这五个"一字未改"的函数被留在代码里的原因：它们是 fallback，不是待删的死码。