# 09 · Value 与 v_new 的三处 Cube 融合

## 9.1 本章结论先行

锚点：chunk_gated_delta_rule.h:1603-1917

1. **融合省下的是"读回"和"向量加减"，不是 Mmad 数量。** 融合版 `ComputeValueAndVNewCube` 发 **4 发 Mmad**（两个乘积各 2 发 hi/lo），非融合版 `ComputeValueNewCube` + `ComputeVNewCube` 也是 2 + 2 = **4 发**。差别在于融合版 4 发全部累加进**同一个 `c1Local`**（只有 1660 那一发 `init=true`），于是整段计算只有 **1 次 L0C→UB（32KB）+ 64 次 NZ→ND 逐行 DataCopy**，而非融合版要做 2 次；同时中间 tile `value_new` 不再存在（它本要占满 `chunkAttnOutFp32` 的 8192 个 FP32），`ComputeVNewCube` 收尾的 `Muls(-1) + Add` 两趟 8192 元素向量操作也随之消失（1908-1911）。
2. **"两组 A/B stage 交替复用"的真实形态是：同一个 slot 内的三段 + 只重载 A。** 融合版只调 `GetCubeStageBase(0)`（1613），slot 内切成 `A_hi | B_hi | A_lo` 三段（1618-1622）。每个乘积内部是 "A_hi→Mmad→A_lo→Mmad"，B 侧只在乘积开头装一次并**常驻 L0B**（第 05 章 §5.4 的同一手法，这里放大到 64×128）。两个乘积之间是**整段 slot 复用**：1677-1678 的 `M_MTE1` 一过，1682-1683 立刻用第二个乘积的 A_hi/B_hi/A_lo 覆盖同一批 GM 地址。真正的 slot0/slot1 乒乓只存在于 `ComputeAttnProductsCube`（1028 + 1032 `GetCubeStageBase(1)`），本章三个函数都不碰 slot1。
3. **NZ→ND 的地址算术在四个分桶下 `kNzSrcStride` 恒等于 126 块（4032B）**，因为式子里只有 `kMatmulM`，而 `kMatmulM` 被写死为 64（1606/1737/1823）。逐桶变化的只有 `blockCount = kMatmulN/16`：64→4、80→5、96→6、128→8 段，每段 2 块 = 64B = 16 个 FP32。128 桶下单行 8×64B = 512B = 128 个 FP32，64 行 = 64 发 = 32KB，正好等于 `kCElements × 4B`。完整代入见 9.10。
4. **融合与非融合的选择条件在终态已经退化，非融合双雄是"运行时死代码"。** `IsFusedValueOutputCubeFastPath`（264-266）只是转发 `IsCubeFastPath`（257-262），而 `ProcessOneVTile`（1313）与两个 dispatch（1412、1535）传的是同一组 `(chunkLen, avFp32)`，所以走 else 分支时 `IsCubeFastPath` 必为 false → `ComputeValueNewCube()`（1413）和 `ComputeVNewCube(...)`（1536）**在任何分桶下都进不去**。`docs/PR-1135-d0906c3e/10-Commit演进史.md:65` 说非融合版是"128 宽 tile 用"，与快照不符（见 9.13）。
5. **三处 Cube 的精度姿态一致，都只补 A 不补 B。** 每个乘积是 `A_hi·B_hi + A_lo·B_hi`，B 侧走裸 `StageHalf`（1633/1683/1762/1843）截断成 FP16，交叉项 `A_hi·B_lo`、`A_lo·B_lo` 被丢掉。这与第 05 章 `MatmulBlockFp32Compensated`（484-493，四项全留、4 发 Mmad）是两种取舍——固定形状的大乘用"B 侧 FP16 级误差"换一半 Mmad。1874-1875 的注释 "compensates **most** of the FP16 quantization error" 用词是准确的。
6. **三个函数体在 `a9c66ddb → d0906c3e` 之间一字未改**（`diff` 输出为空，见自查），唯一的演进是 dispatch 从硬编码两桶（`==128 → <128,128>` / `==80 → <80,80>`）泛化成 `kSpecializedDk != 0 → <kSpecializedDk, kSpecializedDk>`（1598-1600），把 64 和 96 桶也接进融合路径。
7. **1721 / 1810 / 1896 三处 `DataCopy(cNz, c1Local, ...)` 缺 M/V 双向事件栅栏**——`M_MTE1` 只保证 Mmad 不再需要 L1，不保证 L0C 对向量/MTE 侧可读；后续 PR !1174 把这三处（连同第 05/07/10/11 章的另外五处）统一换成带 `M_V`/`V_M` 栅栏的 `CopyL0CToUb`（`src/048d0427/...:116-126`）。

## 9.2 融合版的契约：1591-1595 的四行注释

锚点：chunk_gated_delta_rule.h:1591-1595

这五行属第 08 章区间，但它是本章全部论述的锚，重贴一次：

```cpp
  // Fixed-shape fused Step 2 + Step 4:
  //   v_new = lower(attn) @ v_beta - k_cumdecay @ state.
  // Both products accumulate in the same FP32 L0C matrix. Compared with the
  // former pair of Cube functions this removes one L0C->UB conversion, the
  // intermediate value_new tile, and the final Vector negate/add pass.
```

对照 `docs/PR-406-00e39ab5/06-kernel-VTile处理.md` 的算法步骤：**Step 2** = `value_new = lower(attn) @ (v·beta)`，**Step 4** = `v_new = value_new − K_cumdecay @ S`。!1108 用两次三重循环（`Axpy` 累加）分步落地，!1135 融合版把 Step 4 的减号吸收进 Step 2 的累加器——见 9.5 与 9.8 里那两个"把负号提前乘进 A"的动作。

## 9.3 模板参数与"成对出现"的常量（1603-1613）

锚点：chunk_gated_delta_rule.h:1603-1613

```cpp
  template <uint32_t kStateK, uint32_t kMatmulN>
  __aicore__ inline void ComputeValueAndVNewCube(uint64_t stateBaseOffset, uint64_t workspaceStateBaseOffset,
                                                 uint32_t v_i, uint32_t curV, uint32_t c) {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kAttnK = 64;
    constexpr uint32_t kAAttnElements = kMatmulM * kAttnK;
    constexpr uint32_t kBAttnElements = kAttnK * kMatmulN;
    constexpr uint32_t kAStateElements = kMatmulM * kStateK;
    constexpr uint32_t kBStateElements = kStateK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);
```

- 1603 两个模板参数：`kStateK` 是**第二个乘积的 K 方向长度**（= `realK_` 的桶上界，即 state tile 的行数 DK），`kMatmulN` 是**两个乘积共用的输出列宽**（= 当前 V tile 的宽度）。实例化点唯一：1599 `ComputeValueAndVNewCube<kSpecializedDk, kSpecializedDk>`，所以编译期恒有 **`kStateK == kMatmulN == 桶宽`**。这不是巧合：host 侧 `preferredVStep = cubeDk`（`op_host/chunk_gated_delta_rule_tiling.cpp:299`）把 V tile 宽度绑到 K 桶上，`IsCubeFastPath` 又要求 `vStepAligned_ == kSpecializedDk && avFp32 == kSpecializedDk`（259），三者合起来才让"一个 tile 宽"能同时服务 K 侧和 V 侧。
- 1606-1612 **七个 constexpr 之所以"成对"，是因为一次调用要装两个形状不同的乘积**：`*Attn*` 三件（1608-1609）服务 `64×64 → N`，`*State*` 三件（1610-1611）服务 `64×kStateK → N`；`kMatmulM`（1606）与 `kMatmulN`（1603）是两者共用的。若只有一组常量，GM slot 的三段偏移就必须按两个乘积分别计算，代码会把同一块地址算两遍并失去"第二段能装下第一段"这个可验证的性质（见 9.4）。
- 1606 `kMatmulM = 64`：M 方向**不分带**，永远是 `chunkSize_ = 64`。这正是 L0C 放得下的原因——128 桶的 C tile 是 `64×128×4B = 32KB`，而不是 `128×128` 的 64KB。`ComputeStateUpdateCube` 的注释（2102-2104 "the 128 bucket keeps the conservative 64-row split"）从反面确认了这个约束。
- 1613 `GetCubeStageBase(0)`：见 9.1 第 2 条——本章函数只用 slot0。`GetCubeStageBase`（249-255）的地址是 `stateWorkspace 之后 + (blockIdx_*CUBE_STAGE_SLOT_COUNT + slot) * CUBE_STAGE_SLOT_BYTES`，即每核 2×64KB，本函数只吃掉前 64KB。

**代入四个分桶的数值**（`kMatmulM=64`、`kAttnK=64`，单位：FP16 元素 / FP32 元素）：

| 桶 | `kAAttnElements` | `kBAttnElements` | `kAStateElements` | `kBStateElements` | `kCElements` |
|---|---|---|---|---|---|
| 64 | 4096 | 4096 | 4096 | 4096 | 4096 |
| 80 | 4096 | 5120 | 5120 | 6400 | 5120 |
| 96 | 4096 | 6144 | 6144 | 9216 | 6144 |
| 128 | 4096 | 8192 | 8192 | 16384 | 8192 |

## 9.4 slot 内三段布局与"下一 slot"（1614-1622）

锚点：chunk_gated_delta_rule.h:1614-1622

```cpp
    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAStateElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAStateElements * sizeof(half)),
                             kBStateElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAStateElements + kBStateElements) * sizeof(half)), kAStateElements);
```

- 1615-1617：三个空的 `GlobalTensor<half>` 视图——本仓库 Cube 化的一致写法（先声明、再 `SetGlobalBuffer`），目的是让同一份描述服务两个乘积（见下条）。
- 1618-1622 布局顺序是 **A_hi | B_hi | A_lo**，尺寸取自**第二个（更大的）乘积**：`kAStateElements ≥ kAAttnElements`（因为 `kStateK ≥ kAttnK = 64`）、`kBStateElements ≥ kBAttnElements`。于是第一个乘积只用每段的前 `kAAttnElements` / `kBAttnElements` 个元素，**第二个乘积重填时不需要挪任何基址**——1682-1683 和 1632-1633 用的是同一组 `GlobalTensor` 对象、同一组偏移，只有写进去的字节数变多。这就是"slot 复用"在地址层面的实现。
- **字节代入（128 桶）**：`A_hi @ +0 (16KB)`、`B_hi @ +16384 (32KB)`、`A_lo @ +49152 (16KB)`，合计 **65536B = 64KB = `CUBE_STAGE_SLOT_BYTES`（38 行）压线**。其余三桶：64 桶 24KB、80 桶 32.5KB、96 桶 42KB，都留有余量。
- **host 侧预算吻合**：`op_host/.../chunk_gated_delta_rule_tiling.cpp:48-49` 的 `kRawMatmulStageBytesPerCore = 2 * (2*kMatmulM*kMatmulK + kMatmulK*kMatmulN) * 2B`，其中 host 常量 `kMatmulM=64, kMatmulK=128, kMatmulN=128`（40-42 行）→ 单 slot `2·64·128 + 128·128 = 32768` 个 FP16 = **64KB**，`×2` slot = **128KB/核**。也就是说 host 的 64KB 是按"最坏桶（128）的 A_hi|B_hi|A_lo 三段"精确开出来的，本函数刚好用满一个 slot。
- **为什么这里不申请"下一 slot"**：`ComputeAttnProductsCube` 用 `GetCubeStageBase(1)`（1032）是因为它在算当前 64×64 块的同时要把**下一块**的 A/B 写进 GM（真正的跨迭代预取）。本函数没有这个窗口：两个乘积之间只有 8 行向量操作（1680-1683），把它们并行到两个 slot 需要把 1686 的 L1 覆盖也并行，而 L1/L0A/L0B 各只有一份分配（1640-1643）——所以第二个 slot 在本函数里无处可用，只能整段复用。

## 9.5 稠密化 `lower(attn)` 与第一次 hi/lo 分裂（1623-1634）

锚点：chunk_gated_delta_rule.h:1623-1634

```cpp
    // Materialize lower(attn); upper-triangle values are not part of the
    // original recurrence and must not contribute to the dense Cube product.
    Muls(kCumdecayFp32, chunkScoresFp32, 1.0f, kAAttnElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t row = 0; row + 1 < kMatmulM; ++row) {
      Duplicate(kCumdecayFp32[row * kAttnK + row + 1], 0.0f, kAttnK - row - 1);
    }
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, kAAttnElements);
    StageHalf(chunkVFp32, bStageGm, kBAttnElements);
    PipeBarrier<PIPE_ALL>();
```

- 1624-1625 注释点出本节的动机：Cube 只能吃**稠密矩形**，而 `attn` 是严格下三角。稠密化的代价是先物理写出一个完整的 64×64。
- 1626 `Muls(..., 1.0f, ...)` = UB→UB 整块拷贝（`DataCopy` 两端必须有一端是 GM，UB 之间只能用向量指令搬运，本仓库通例）。为什么必须拷：源 `chunkScoresFp32` 是 attn 矩阵，**跨所有 V tile 存活**（1626 每 tile 都要重读；对比 174-183 的多 tile 分支专门为它和 `stateInFp32` 取消重叠），所以清上三角这种原地操作只能在副本上做。
- 1628-1630 每行一次 `Duplicate(dst, 0.0f, len)`：把 `row+1 .. 63` 写 0（**保留对角线**），循环 63 次（`row + 1 < kMatmulM`）。1627/1631 两个 `PIPE_V` 是同管排空，让 `StageHalfWithResidual` 的 `Cast` 读到刚写过的行。
- 1632 `StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, 4096)`：一次调用产出 A 侧的 hi 与 lo 两段（1556-1579，第 08 章）。第二参数 `chunkAttnOutFp32` 是 **FP32 残差暂存**——`X − Cast_fp16(X)` 必须用 FP32 存，所以这里"借用"的是全 kernel 最大的一块 UB 之一（容量 `cs*avStepAligned` = 128 桶下 8192 个 FP32 ≥ 4096）。
- **缓冲身份链（本章最容易读错的地方）**：`kCumdecayFp32` 这个名字装的是 **lower(attn) 的副本**，不是 K_cumdecay；真正的 K_cumdecay 在 `chunkKFp32` 里（`ComputeKCumdecayCube` 的 1198 原地写 `chunkKFp32[i*alignK_]`，函数头注释 1181 也这么写；泛型路径 1544 读的也是 `chunkKFp32`）。2427 的成员注释 "k_beta then k_cumdecay" 已过时。判断依据是"谁是 src、谁是 scratch"：1556 的第一参数是待分裂的操作数、第二参数只是残差落点。
- 1633 `StageHalf(chunkVFp32, bStageGm, kBAttnElements)`：B 侧（v_beta）只截断、不补偿。1634 `PipeBarrier<PIPE_ALL>()`：MTE3 刚写 GM，MTE2 马上要读 GM，跨向全排空（与 4.4/5.6.2 同一写法）。

## 9.6 四级存储分配（1635-1645）

锚点：chunk_gated_delta_rule.h:1635-1645

```cpp
    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kAStateElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBStateElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kAStateElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBStateElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCElements);
```

- 1636-1639 四个 `LocalMemAllocator` 各绑定一类硬件存储；1640-1644 五次 `Alloc` 按 `TPosition` 取槽位（`A1/B1` = L1 的 A/B 区，`A2/B2` = L0A/L0B，`CO1` = L0C 输出缓冲）。分配只是地址水位推进，不发指令，函数返回时随析构释放。语义详见第 05 章 §5.2。
- **容量按"更大的那个乘积"申请**（`kAStateElements`、`kBStateElements`），所以两个乘积共用同一组 L1/L0A/L0B 指针，1686-1697 不需要重新 `Alloc`。
- **128 桶代入**：L1 = 16KB + 32KB = 48KB；L0A = 16KB；L0B = 32KB；L0C = 8192 FP32 = 32KB。96 桶 L0B 只有 18KB。注意 `b2Local` 要装下**整个 B 操作数**（`kStateK × kMatmulN`），这是"L0B 驻留、只重载 A"能够成立的前提；如果 B 比这更大，就必须改成 A/B 双向分块的三重循环（本文件里没有那种写法）。

## 9.7 乘积①：`lower(attn) @ v_beta` 的 hi/lo 两发（1646-1673）

锚点：chunk_gated_delta_rule.h:1646-1673

```cpp
    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kAttnK, 0, kAttnK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kAttnK, kMatmulN, 0, kMatmulN, kAttnK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kAttnK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kAttnK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kAttnK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kAttnK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kAttnK, 0, false, true});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kAttnK, 0, kAttnK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kAttnK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kAttnK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kAttnK, 0, false, false});
```

- 1646-1647 **GM→L1 + ND→NZ 一步做完**（MTE2）。`Nd2NzParams` 八字段按第 05 章 §5.3 的读法：(blockCount=1 组, srcHeight, srcWidth, srcHeightGap=0, dstHeight, dstWidth, inputNormSize=1, outputNormSize=0)。A 侧 `srcWidth = kAttnK = 64`、B 侧 `srcWidth = kMatmulN`，两个 `dstWidth/dstHeight` 与源同值 → 无 padding、不做 norm 换算。
- 1650-1653 A 侧 **L1→L0A 按 16 行一带搬**：`kMatmulM/16 = 4` 次发射；源侧每次前进 `512/sizeof(half) = 256` 个 FP16 = 一个 FP16 分形，目的侧每次前进 `kAttnK*16 = 1024` 个元素 = `kAttnK/16 = 4` 个分形 = 一个 16 行×64 列的行带。`LoadData2DParams{0, kAttnK/16, kMatmulM/16, ...}` 里两个数分别是 **K 方向分形数**与 **M 方向分形数**，倒数第二位的 `false` 是 A 侧标志。
- 1654-1657 B 侧 **L1→L0B 按 16 列一带搬**：`kAttnK/16 = 4` 次发射，`isWeight = true`。这一循环在乘积②里会变成 `kStateK/16` 次（1694），是 LoadData 总发射数随桶变化的唯一来源。
- 1658-1660 `MTE1_M` 夹住 **1660 这一发 `init=true`** ——它是整章唯一清零 L0C 的一发；此后本章所有 Mmad 都是 `init=false` 往同一个 `c1Local` 续加。
- 1662-1673 **只重载 A 的 lo 半区**（1664 读 `aResidualStageGm`），B 保持 L0B 驻留。这正是"交替复用"的第一个层次：GM 侧的 A_hi/A_lo 交替喂进同一个 L0A，B_hi 从头到尾只装一次。1662-1663 的 `M_MTE1` 保证 1660 的 Mmad 读完 L1 之后 1664 才允许覆盖 `a1Local`——这是第 05 章 §5.5 已论证过的"这一对不是多余的"。
- **Mmad 单元数**：1660 与 1673 都是 `MmadParams{64, kMatmulN, 64}` → `(64/16)·(kMatmulN/16)·(64/16) = 16·(kMatmulN/16)`，128 桶 = 128 个 16³ 单元/发。LoadData 发射数：4(A_hi) + 4(B_hi) + 4(A_lo) = 12 发。
- **为什么两发之间不读 L0C**：L0C 累加只在 Mmad 阵列内部发生，`init=false` 的语义就是"保留上一次的值继续加"，所以跨发的 FP32 累加**不落任何存储**——这是补偿分裂能在 310P 上做的根本原因（若在 UB 里累加，就得为每一发做一次 32KB 读回）。

## 9.8 slot 整段复用与 `LoadStateTile` 的插入点（1674-1684）

锚点：chunk_gated_delta_rule.h:1674-1684

```cpp
    // The first product no longer needs chunkScores/v_beta. Wait for Cube,
    // then reuse the same staging slot for the second product.
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LoadStateTile(stateBaseOffset, workspaceStateBaseOffset, v_i, curV, c);
    Muls(chunkKFp32, chunkKFp32, -1.0f, kAStateElements);
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(chunkKFp32, kCumdecayFp32, aStageGm, aResidualStageGm, kAStateElements);
    StageHalf(stateInFp32, bStageGm, kBStateElements);
    PipeBarrier<PIPE_ALL>();
```

- 1677-1678 的 `M_MTE1` 是**唯一挡在"覆盖 slot / 覆盖 L1"前面的 Cube 栅栏**：1682-1683 会用 MTE3 重写 `aStageGm/bStageGm/aResidualStageGm`（WAR），1686 又会用 MTE2 重写 `a1Local/b1Local`（WAR）。前者已被 1648/1665 的 `MTE2_MTE1` 排掉，后者必须由本对栅栏排掉——注意 1686 之前再没有任何 Cube 等待，所以 1677 是它唯一的守卫。
- 1679 **把 `LoadStateTile` 插在 Cube 等待之后、向量分裂之前**：`LoadStateTile`（1430-1533）是 MTE2 主导的搬运（workspace→UB 的 2D strided DMA 或 DMA+转置），1680-1683 是 V/MTE3 主导。二者管道不同、缓冲不重叠（`stateInFp32` vs `chunkKFp32`），所以这条顺序让 **MTE2 的 state 装载与 V 管取负 + Cast 链并行**。这就是 `docs/PR-1135-d0906c3e/01-Cube化深度精读.md` §3.4 说的"融合点顺手把 Step 3 的装载塞进 Cube 空隙"；需要修正的是：它并**没有**与 Mmad 本身重叠（1677 已经等 Cube），重叠对象是紧随其后的向量段。
- 1680 `Muls(chunkKFp32, chunkKFp32, -1.0f, kAStateElements)`：**把减号吸收进 A 操作数**，且是原地操作——`chunkKFp32` 里的 K_cumdecay 此刻已无其它读者（本 tile 内 1680 是唯一使用点；泛型路径 1544 与它互斥）。取负之后 1682 分裂出的 hi/lo 同时带负号（`lo = (−X) − Cast(−X) = −(X − Cast(X))`，因为 FP16 舍入对取负对称），于是 1700/1713 两发 Mmad 直接往 L0C 里加 `−K_cd@S`，**不需要 `ComputeVNewCube` 收尾那种 `Muls(-1) + Add`**（1908-1910）。这一条就是 1595 所谓 "removes the final Vector negate/add pass" 的实现处。
- 1682 的残差暂存换成 `kCumdecayFp32`：它此刻装的是 lower(attn) 的 FP32 副本，但那副本已在 1632 被搬进 GM 并常驻 L0A，之后无人再读 → 降级为 scratch。容量 `cs*alignK_ = 64*kSpecializedDk = kAStateElements` 压线正好。
- 1683 `StageHalf(stateInFp32, bStageGm, kBStateElements)`：state 从 FP32（workspace 中间块存的正是 FP32）截断成 FP16。这是 9.1 第 5 条说的精度让步点：**跨 chunk 的 state 以 FP32 存 workspace、以 FP16 进 Cube**，B 侧误差不被任何交叉项补偿。
- 1684 `PipeBarrier<PIPE_ALL>()`：MTE3→MTE2 的 GM 交接（与 1634 同）。

## 9.9 乘积②：`−K_cumdecay @ S` 的 hi/lo 两发（1685-1713）

锚点：chunk_gated_delta_rule.h:1685-1713

```cpp
    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kStateK, 0, kStateK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kStateK, kMatmulN, 0, kMatmulN, kStateK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kStateK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kStateK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kStateK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kStateK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kStateK, 0, false, false});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kStateK, 0, kStateK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kStateK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kStateK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kStateK, 0, false, false});
```

与 9.7 完全同构，四处差别，全部来自 `kStateK > kAttnK`：

1. `Nd2NzParams` 的宽度字段从 `kAttnK` 变成 `kStateK`（1686/1687/1704），B 侧从 `64×N` 变成 `kStateK×N`。
2. A 侧 LoadData 的**步长与分形数变了**：`a2Local[mBlock * kStateK * 16]`（1691/1708）——每个 M 行带现在是 `kStateK/16` 个分形，而不是 4 个；`LoadData2DParams{0, kStateK/16, kMatmulM/16, ...}`。源侧仍是每次前进 1 个分形（`mBlock * 512/sizeof(half)`），四个 mBlock 共 4 发不变。
3. **B 侧循环次数 = `kStateK/16`**（1694）→ 128 桶 8 发、96 桶 6 发、80 桶 5 发、64 桶 4 发。这是全函数唯一随桶伸缩的装载循环。
4. **1700 与 1713 都是 `init=false`**——它们把 `−K_cd@S` 累加到乘积①已在 L0C 里攒好的 `lower(attn)@v_beta` 上。**融合的本质就是这两行的最后一个布尔位**：整段代码只有 1660 一个 `true`。

**本章 Mmad 总账**（128 桶）：4 发，其中 1660 为 `init=true`；16°单元数 = 128 + 128 + 256 + 256 = **768 个 16³ 单元**。LoadData 语句 6 条 → 展开 **28 发**（4+4+4 | 4+8+4）。GM→L1 `DataCopy` 6 条。事件栅栏 `MTE2_MTE1` / `MTE1_M` / `M_MTE1` 各 4 对 = 12 对 Set/Wait。

## 9.10 L0C→UB→ND 读回与地址算术（1714-1735）

锚点：chunk_gated_delta_rule.h:1714-1735

```cpp
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LocalTensor<float> cNz = chunkKFp32;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();

    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(chunkVFp32[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```

- 1715-1716 第三对 `M_MTE1`：等 Mmad 收尾。1717 `cNz = chunkKFp32` 又是一次身份切换——`chunkKFp32` 的负 K_cumdecay 已在 1682 出 GM，此后无人读，容量 `cs*alignK_ = 64*kMatmulN = kCElements` 压线正好当 NZ 落点。
- **1717 的 `M_MTE1` 不等于"L0C 可读"**——`docs/PR-1174-048d0427/01-L0C同步与裸Cube编程.md` 的靶心就在这三行上（1718-1721）：`DataCopy(cNz, c1Local, ...)` 是**向量/MTE 侧读 L0C**，需要的栅栏是 `M_V`（或 `M_MTE2`），而 `M_MTE1` 的方向是 M→MTE1（只管 L1）。加上 1721 之后没有任何 `V_M` 回程栅栏，就形成了 "VEC 读写 L0C 与 Cube 读写 L0C 地址相同" 的竞争窗口。!1174 之前全文件共 8 处这类读回，本章占 3 处（1721/1810/1896）。
- 1718-1721 **第一跳：L0C→UB，保持 NZ 序**。`BLOCK_MODE_MATRIX` 把 `DataCopyParams` 的计量单位从 32B 块升格为**分形**：`blockCount = kMatmulN/16`（外层 N 分形数）、`blockLen = kMatmulM/16`（每个 N 分形里连取的 M 分形数）、两个 stride 为 0 → 完全线性连续。128 桶：`8 × 4 = 32` 个 FP32 分形 × 1024B = **32KB**，与 `kCElements × 4B` 吻合。**这里刻意不转置**——310P 无 Fixpipe 可借。
- 1724-1725 **代入 `kMatmulM = 64`（四个桶都相同，因为 64 写死）**：

```
kNdBlockLen  = 16 * 4 / 32                                   = 2 块  = 64B   （一个分形的一行 = 16 个 FP32）
kNzSrcStride = (64/16 * 16 * 16 - 16) * 4 / 32 = 1008*4/32   = 126 块 = 4032B
段间距       = kNdBlockLen + kNzSrcStride = 128 块 = 4096B = 1024 个 FP32 = (kMatmulM/16)*16*16  ✓ 恰为"N 分形"的间距
```

  即：ND 的一行由 `kMatmulN/16` 段拼成，相邻两段的字节间距 = **一个列块（N 分形）的间距**，减去本段自占的 2 块 → 间隙 126 块。这正是 1725 式子的含义（第 05 章 §5.6.5 在 `kBlock=32` 下得到 62，`kBlock=64` 得到 126，与此处一致）。
- **逐桶的 NZ→ND 字节账**（`kNdBlockLen=2`、`kNzSrcStride=126` 四桶恒定）：

| 桶 | `blockCount=kMatmulN/16` | 每行字节 = bc×64B | 每行 FP32 | 发射数 | 合计字节 | `cCopyParams{bc, 4}` 分形数 |
|---|---|---|---|---|---|---|
| 64 | 4 | 256B | 64 | 64 | 16 KB | 4×4 = 16 |
| 80 | 5 | 320B | 80 | 64 | 20 KB | 5×4 = 20 |
| 96 | 6 | 384B | 96 | 64 | 24 KB | 6×4 = 24 |
| 128 | 8 | 512B | 128 | 64 | 32 KB | 8×4 = 32 |

- 1727-1729 **为什么 `cNz[row*16]` 一个表达式就同时定位"行块"和"块内行"**：L0C 的分形线性序是**外 N 内 M**，所以行块间距 = 16 行 × 16 元素 = 256 元素；恒等式 `(row/16)*256 + (row%16)*16 = row*16` 因此成立。这是"raw Mmad writes L0C in NZ order"这句注释（1891）能被翻译成地址算术的唯一支点。
- 1728 目的侧 `chunkVFp32[row * kMatmulN]`：`v_new` 直接落在 **Step 6 的 B 操作数地址**上（`ComputeOutputCube` 的 2007 就读这里），所以 `value_new` 这个中间 tile 彻底消失。`dstStride = 0`（1726 第四个字段）因为 ND 行内本就连续。1730 `PIPE_ALL` 让结果对随后的向量指令可见。
- **融合版相对非融合对省下的清单**（128 桶）：1 次 L0C→UB 32KB、64 发 NZ→ND DataCopy、8192 个 FP32 的 `value_new` 落地空间（`chunkAttnOutFp32` 从"输出 tile"降级为"分裂残差 scratch"）、1 趟 `Muls(-1)`（8192 元素）+ 1 趟 `Add`（8192 元素）、2 对 `M_MTE1` 与 1 个 `PIPE_ALL`。**Mmad 一发不少**（4 对 4）。
- 1733-1735 是 `ComputeValueNewCube` 的头注释，落在本章末尾按任务书覆盖。它交代了非融合 Step 2 的**前史**："The old path launched one Axpy for every lower-triangle coefficient" ——对应 `src/00e39ab5/...:732-747` 里 `for i / for k<=i / Axpy` 的双层循环（终态兜底路径 1417-1426 仍逐字节保留）。末句 "the complete 64x64x128 product" 是**面向 128 桶**写的，其余三桶实际是 64×64×64/80/96。

## 9.11 非融合版①：`ComputeValueNewCube`（1736-1763）

锚点：chunk_gated_delta_rule.h:1736-1763

```cpp
  // Fixed-shape Step 2: value_new = lower(attn) @ v_beta. The old path
  // launched one Axpy for every lower-triangle coefficient. Build the two
  // regular matrices once and execute the complete 64x64x128 product on Cube.  
  __aicore__ inline void ComputeValueNewCube() {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kMatmulK = 64;
    constexpr uint32_t kMatmulN = 128;
    constexpr uint32_t kAElements = kMatmulM * kMatmulK;
    constexpr uint32_t kBElements = kMatmulK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);

    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAElements * sizeof(half)), kBElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAElements + kBElements) * sizeof(half)), kAElements);

    // The source buffer may contain values above the diagonal. Preserve the
    // original k<=i semantics by clearing only that upper triangle.
    Muls(kCumdecayFp32, chunkScoresFp32, 1.0f, kAElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t row = 0; row + 1 < kMatmulM; ++row) {
      Duplicate(kCumdecayFp32[row * kMatmulK + row + 1], 0.0f, kMatmulK - row - 1);
    }
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(kCumdecayFp32, chunkAttnOutFp32, aStageGm, aResidualStageGm, kAElements);
    StageHalf(chunkVFp32, bStageGm, kBElements);
    PipeBarrier<PIPE_ALL>();
```

- 1736 **无模板参数、`kMatmulN` 写死 128**：它服务的是"整个 V 一步走完"的形状（`dv ≤ 128` 时 `vStepAligned_ = 128`）。与融合版最大的结构差别是 `kMatmulK = 64`（1738）只有一个 K，所以常量不成对。
- 1743-1751 slot 布局同 9.4，但字节数小得多：`4096 + 8192 + 4096 = 16384` 个 FP16 = **32KB**，只用掉 64KB slot 的一半。这是融合版必须把三段按"State 尺寸"开的原因——两个乘积共用一段。
- 1753-1754 注释比融合版（1624-1625）多交代一句 "**original k<=i semantics**"：被清掉的上三角不参与原递推，`k<=i` 才对角线上"自身贡献"要被保留。1755-1762 与 1626-1633 逐句同构，只有 `kAElements`/`kAttnK` 换名。
- 1762 `StageHalf(chunkVFp32, bStageGm, kBElements)`：B = v_beta，8192 个 FP16。注意 `chunkVFp32` 容量 `cs*vStepAligned_ = 64*128 = 8192` 压线。

## 9.12 非融合版①的后半：单乘积 + 读回（1764-1821）

锚点：chunk_gated_delta_rule.h:1764-1821

```cpp
    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kAElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kAElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCElements);

    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kMatmulK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kMatmulK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, false});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LocalTensor<float> cNz = kCumdecayFp32;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();

    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(chunkAttnOutFp32[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```

与融合版的乘积①（9.7）**逐字符同构**（`kAttnK` 全部换成 `kMatmulK`，二者同为 64），差异只有三处，但每处都是"非融合"的代价：

1. **2 发 Mmad / 3 条 LoadData 语句 / 2 条 GM→L1**：`MAD` 数减半，但 `L0C` 被单独占用一次。
2. **1806 `cNz = kCumdecayFp32`**（融合版是 `chunkKFp32`）——落点不同，容量同为 `cs*alignK_ = 8192` 个 FP32。
3. **1817 写进 `chunkAttnOutFp32`**：这就是 `value_new` 中间 tile。它必须存在，因为下一步 `ComputeVNewCube` 要把 `−K_cd@S` 加回来（1910）。**NZ→ND 参数与融合版完全相同**：`{8, 2, 126, 0}`，64 发、32KB。
4. 1810 与 1721 是同一类缺陷（缺 `M_V`/`V_M` 栅栏），!1174 中同改为 `CopyL0CToUb`。

## 9.13 非融合版②：`ComputeVNewCube` 与钉死 Fixpipe 缺失的注释（1822-1870）

锚点：chunk_gated_delta_rule.h:1822-1870

```cpp
  __aicore__ inline void ComputeVNewCube(uint32_t chunkLen, uint32_t avFp32) {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kMatmulK = 128;
    constexpr uint32_t kMatmulN = 128;
    constexpr uint32_t kAElements = kMatmulM * kMatmulK;
    constexpr uint32_t kBElements = kMatmulK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
    // The workspace stages A_hi, A_lo and B_hi. kAElements equals kCElements
    // for this fixed fast path, but spelling out the actual contents avoids
    // confusing the A residual buffer with an output-C buffer.
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);

    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAElements * sizeof(half)), kBElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAElements + kBElements) * sizeof(half)), kAElements);

    StageHalfWithResidual(chunkKFp32, kCumdecayFp32, aStageGm, aResidualStageGm, kAElements);
    StageHalf(stateInFp32, bStageGm, kBElements);
    PipeBarrier<PIPE_ALL>();

    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kAElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kAElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCElements);

    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kMatmulK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kMatmulK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true});
```

- 1822 **形参 `chunkLen` 与 `avFp32` 在函数体内一次都没被使用**（`grep -n` 复核：1822 之外再无出现）。它们是融合前的历史签名残留——非融合版把 64×128 写死成常量，泛型性只能从 dispatch（1536 仍老实传参）带进来。这是"这段代码为兜底场景保留、但兜底条件已被收紧到永不为真"的最硬证据。
- 1823-1825 `64 × 128 × 128`：这是本章三个 Cube 乘积里 K 最大的一个，`kAElements = 8192`、`kBElements = 16384`、`kCElements = 8192`。slot 用量 `8192+16384+8192 = 32768` 个 FP16 = **64KB，压线用满**（与融合版最坏情形同值）。
- 1826-1828 注释值得逐字读："The workspace stages A_hi, A_lo and B_hi"——**明确三段里没有一个属于输出 C**；"kAElements equals kCElements for this fixed fast path"——`64*128 == 64*128`，两个语义无关的量在 128 桶下数值相同，作者怕人把 `aResidualStageGm` 误读成 C 的落地区，所以特意写成注释。**这是全章唯一一处"数值巧合"被显式标注的地方**，也解释了为什么 1890 的 `cNz` 用的是 `chunkKFp32`（UB）而 GM 侧三段全是 A/B。
- 1842-1843 装载：A = K_cumdecay（**未取负**！负号留到 1908 事后处理，这正是融合版 1680 想消掉的那一步），B = `stateInFp32`。这两行**没有**上三角清理，因为 A 是稠密的 `64×128`。
- 1856-1870 与融合版乘积②（9.9）逐字符同构（`kStateK → kMatmulK`），B 侧 `kMatmulK/16 = 8` 发。Mmad `init=true`，因为这是一次全新的累加。

## 9.14 `ComputeVNewCube` 的后半：Fixpipe 注释与事后加减（1871-1917）

锚点：chunk_gated_delta_rule.h:1871-1917

```cpp
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    // Accumulate A_lo * B_hi into the same L0C matrix. This compensates most
    // of the FP16 quantization error while keeping the main product on Cube.
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, false});

    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);

    LocalTensor<float> cNz = chunkKFp32;
    // On dav_m200, raw Mmad writes L0C in NZ order and Fixpipe is unavailable.
    // Copy N/16 fractals, each containing M/16 cube blocks, into UB in NZ order.
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();

    // Convert the UB NZ matrix to row-major ND one output row at a time.
    // Each row contributes 16 FP32 values from every N fractal.
    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(chunkVFp32[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
    Muls(chunkVFp32, chunkVFp32, -1.0f, kCElements);
    PipeBarrier<PIPE_V>();
    Add(chunkVFp32, chunkVFp32, chunkAttnOutFp32, kCElements);
    PipeBarrier<PIPE_V>();
  }
```

- 1874-1875（原文照录）："Accumulate A_lo * B_hi into the same L0C matrix. This compensates most of the FP16 quantization error while keeping the main product on Cube." —— **"most" 而非 "all"**：只有 `A_lo·B_hi` 这一项被保留，`A_hi·B_lo` 与 `A_lo·B_lo` 被丢掉（B 根本没有 lo 半区，见 1843 的裸 `StageHalf`）。与第 05 章 `MatmulBlockFp32Compensated` 的"Retaining every cross term"（452）形成精确的档位差。
- **1891-1892 全 PR 最重要的一句注释（原文照录）**：

```
// On dav_m200, raw Mmad writes L0C in NZ order and Fixpipe is unavailable.
// Copy N/16 fractals, each containing M/16 cube blocks, into UB in NZ order.
```

  三个可验证的事实被压在这两行里：① **目标器件是 dav_m200（= 310P）**；② **Fixpipe 不可用**——910B 上由 Fixpipe 负责的"L0C 排空 + NZ→ND 转置 + Cast"三件套全部要靠软件补；③ **L0C 的分形序是"外层 N/16、内层每个含 M/16 个 cube 块"**，这正是 `cCopyParams{blockCount = kMatmulN/16, blockLen = kMatmulM/16}`（1893）的字面翻译，也是 `kNzSrcStride` 用 `kMatmulM/16*16*16` 作段间距（1902）的理由。
  由 ② 直接推出整条链路的因果：**没有 Fixpipe → 高层 `Matmul` API 的 `GetTensorC()` 无从实现 → 只能裸 `Mmad` → L0C 以 NZ 落 UB → 必须自己用 64 发 strided `DataCopy` 逐行拼回 ND**。1899-1900 的第二段注释（"Convert the UB NZ matrix to row-major ND one output row at a time. / Each row contributes 16 FP32 values from every N fractal."）是这套拼行的操作说明书：每行取 `kMatmulN/16` 段、每段 16 个 FP32。
  值得注意：**同样的读回代码在融合版（1718-1721）与非融合版①（1807-1810）里都带着这两行注释里的全部算术，却只在 1891 和 1813 附近留下注释**——1891 是唯一显式点名 `dav_m200` 与 `Fixpipe` 的地方（另外两处 `ComputeValueNewCube`/`ComputeValueAndVNewCube` 的读回没有注释）。因此 `docs/PR-1135-d0906c3e/10-Commit演进史.md:72` 把 Fixpipe 论据引到 `ComputeVNewCube` 是正确的。
- 1908-1910 **事后取负 + 事后加法**：`Muls(chunkVFp32, ..., -1.0f, kCElements)` 把整块 8192 元素取负，再 `Add` 上 `chunkAttnOutFp32`（= 9.12 落地的 `value_new`）。两条各带一个 `PIPE_V`。**融合版把这 4 行整体消掉**（负号提前到 1680 的 A 操作数、`value_new` 提前在 L0C 里累加）——这就是 1595 "the final Vector negate/add pass" 的全部所指，也是 9.1 第 1 条"省的是读回和向量 pass"的具体账目。

## 9.15 三处 Cube 的量表对照与选择代价

锚点：chunk_gated_delta_rule.h:1604-1604, 1736-1736, 1822-1822

| 维度 | 融合 `ComputeValueAndVNewCube` | `ComputeValueNewCube` | `ComputeVNewCube` |
|---|---|---|---|
| 覆盖算法步 | Step 2 + Step 4 | Step 2 | Step 4 |
| 形状 M×K×N | 64×64×N 与 64×kStateK×N | 64×64×128 | 64×128×128 |
| Mmad 发数 | 4（仅 1660 `init=true`） | 2（1789 `init=true`） | 2（1870 `init=true`） |
| LoadData 语句 / 展开（128 桶） | 6 / 28 | 3 / 12 | 3 / 16 |
| GM→L1 `DataCopy` | 6 | 3 | 3 |
| slot0 用量 | 42KB(96) / 64KB(128) | 32KB | 64KB |
| L0C 用量 | 64×N FP32（128 桶 32KB） | 32KB | 32KB |
| L0C→UB 读回次数 | 1 | 1（+1 在 `ComputeVNewCube`） | 1 |
| NZ→ND 逐行发射 | 64 | 64（+64） | 64 |
| 事件栅栏对 | 12（各型 4） | 6 | 6 |
| `PIPE_ALL` / `PIPE_V` | 4 / 3 | 3 / 2 | 3 / 4 |
| 中间 tile | 无 | 需要 `value_new` @ `chunkAttnOutFp32` | 消费 `value_new` |
| 事后向量加减 | 无（负号吸收进 A） | 无 | `Muls(-1)` + `Add`，各 8192 元素 |
| 终态可达性 | 四桶全可达 | **不可达** | **不可达** |