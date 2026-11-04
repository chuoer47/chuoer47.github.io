# 07 · 注意力与 K_cumdecay 的 Cube 化

本篇**不重讲**第 05 章已建立的裸 Mmad 五件套原语：`LoadMatmulBlockA/B`（:415-437）、`MmadMatmulBlock`（:439-447）、`MatmulBlockFp32Compensated`（:449-508）、`GetCubeStageBase`（:249-255）、`StageHalfWithResidual`（:1556-1579）与 `StageHalf`（:1581-1589，第 08 章 §7/§8）。凡涉及这些原语的内部语义一律按锚点引用，只讲本区间**特有的**部分。

## 7.0 结论先行与三函数量表

锚点：chunk_gated_delta_rule.h:1021-1297（本表只汇总下文逐行论证过的数字）

1. **`ComputeAttnProductsCube` 把 !1108 的两次"逐行对逐行点积"整体换成 64×64×dk 的稠密乘，4 发 Mmad 一次函数调用收口。** 数学上是两个乘积（`scores = −(K·β) @ Kᵀ ⊙ decay` 与 `attn_i = (Q·scale) @ Kᵀ ⊙ decay`），共享同一份常驻 L0B 的 Kᵀ（B 只在 :1081/:1089-1092 装一次，第二个乘积不重载）。对照 :978-996 的兜底：2016 + 2080 = **4096 次 `DotFp32`**，每次展开为 2 条 V 算术（`Mul` + `WholeReduceSum`）+ 1 对 `TQueSync`（2 条）+ 2 次标量 `GetValue`（`DotFp32` 本体 :390-413，`count = realK_ = 128` → `fullRepeats = 2`、`tail = 0`）= **约 2.46 万条发射**，且每 128 长度点积之间都夹一次 V→S 往返。本函数用 4 发 Mmad + 5 发 Nd2Nz + 20-24 发 LoadData + 64 发逐行 NZ→ND 把它替掉。
2. **本区间的补偿姿态是"只补 A、不补 B"，每个乘积 2 发 Mmad，不是 4 发。** **全区间 Mmad 发射点 6 处**（:1095/:1108/:1130/:1142/:1266/:1278），逐 chunk 执行 **6 发 = 2 乘积×2 + 1 乘积×2**
3. **B 侧不补偿在两个乘积里的"合法性"不一样，这是本篇抓出来的口径差。** :1043-1044 的注释给出了 `ComputeAttnProductsCube` 的理由——"K originated as FP16, so this conversion is exact"，Kᵀ 的 FP16 Cast 无损，B_lo 恒为 0，不补是对的。但 `ComputeKCumdecayCube` 的 B 是 `kCumdecayFp32`，它等于 K·β·e^{g_cumsum}（:869-899 的 Brcb+高维 Mul，再 :1186 的 `Muls`），含指数量，**FP16 截断必然有损**，相对误差 ~5e-4 且无补偿项。同一块矩阵在第 09 章 :1632 作为 A 时被 `StageHalfWithResidual` 分裂成 hi/lo，在本章 :1240 作为 B 时只走 `StageHalf`——**精度取决于它站在乘积的哪一侧**。`docs` §2.2 给 `StageHalf` 的辩护（"B 操作数本来就是 fp16 升上来的，Cast 无损"）只对 :1066 成立，对 :1240 不成立。
4. **slot0/slot1 双缓冲真正的形态是"同一 chunk 内第二个乘积的 A 与第一个乘积的 Mmad 并行"，不是跨迭代预取。** 全文件只有本函数调 `GetCubeStageBase(1)`（:1032）。能并行不是因为多了一槽 GM，而是因为 :1113 的写槽动作与 :1118-1120 的收槽栅栏用的是**定向的 MTE3→MTE2 事件**而非 `PipeBarrier<PIPE_ALL>`——后者会连 M 管一起排空，把 :1108 那发还在跑的 Mmad 也等掉。第 09 章 §9.4 把这里称作"跨迭代预取"，措辞需要修正（本篇 §7.4 给证明：本函数体内没有任何 chunk 级循环）。
5. **本区间是 !1174 的 M/V 栅栏缺口的两处现场之一。** L0C→UB 的 `DataCopy` 在 :1170 与 :1285，两处都只有 `M_MTE1` 事件对（:1164-1165 / :1279-1280）加事后 `PipeBarrier<PIPE_ALL>`（:1171 / :1286），没有 `M_V`/`V_M`。修复后对应 `src/048d0427/...:1183` 与 `:1298`（详见 §7.12 的逐行映射表）。**每个 chunk 这类读回执行 3 次**（:1170 因 :1114/:1143 两次调用执行 2 次 + :1285 一次）。
6. **兜底臂在本区间只有一处：:1197-1206 的下三角 Axpy 巢**（07b §7.8 逐行）。它与 :978-1013 的注意力兜底**同生同灭**：注意力臂虽多一个 `CanCacheAttnQuery(chunkLen)`（:966-:977 调用，:942-:947 定义），但在 `realK_ <= kSpecializedDk` 下由 :91 得 `alignK_ == kSpecializedDk`，而 `chunkSize_` 恒为 64（`tiling.cpp:32` 的 `kDefaultChunkSize`），于是该谓词的三条判据化简为 `kSpecializedDk <= 2·vStepAligned_` 与 `kSpecializedDk <= vStepAligned_`，前者被后者蕴含 → 它恰好等价于 :1192 的第三条件（完整推导见 07b §7.8）。**两个 Cube 臂选中的是同一批 chunk，不可能一个走 Cube 一个走兜底。** 触发兜底的三类形状：尾块（`chunkLen < 64`）、`dk > 128`（host 落到通用臂，`tiling.cpp:324` 注释自陈）、UB 容不下 `vStep = 桶宽` 从而 `vStepAligned_ < kSpecializedDk`。**另有一处口径差值得记**：:1192/:968 用 `vStepAligned_ >= kSpecializedDk`，而 :257-:259 的 `IsCubeFastPath`（第 09/10 章的融合臂守门）用 `vStepAligned_ == kSpecializedDk`——同一个量在两处用了宽窄不同的判据。
7. **本区间没有不可达函数**。三个函数逐个 grep 到调用点：`ComputeAttnProductsCube` ← :970、`CopyAttnCubeResult` ← :1114 与 :1143、`ComputeKCumdecayCube` ← :1193。唯一的"部分死"是 :1207-1209 的 `outputSync` 三行——Cube 臂在 :1194 提前 `return`，快路径永远不执行它；以及 :1191 的 `if constexpr` 假侧在四个实例化（64/80/96/128，`chunk_gated_delta_rule.cpp:34/38/42/46`）下根本不进 binary。

| 函数 | 行区间 | 行数 | 模板实参 | 每调用 Mmad | 每 chunk 调用 | L0C→UB | 逐行 NZ→ND |
|---|---|---|---|---|---|---|---|
| `ComputeAttnProductsCube` | 1021-1159 | 139 | `kMatmulK = kSpecializedDk` | 4 | 1 | 2（借 `CopyAttnCubeResult`） | 128 |
| `CopyAttnCubeResult` | 1161-1179 | 19 | **无**（非模板） | 0 | 2 | 1 | 64 |
| `ComputeKCumdecay` | 1181-1210 | 30 | — | 0 | 1 | 0 | 0 |
| `ComputeKCumdecayCube` | 1212-1294 | 83 | `kMatmulN = kSpecializedDk` | 2 | 1 | 1 | 64 |
| 合计（快路径，逐 chunk） | 1021-1297 | 277 | — | **6** | — | **3** | **192** |

## 7.1 chunk_gated_delta_rule.h:1021-1042 — 模板参数、三个常量与 slot0/slot1 的六段 GM 布局

锚点：chunk_gated_delta_rule.h:1021-1042

```cpp
  template <uint32_t kMatmulK>
  __aicore__ inline void ComputeAttnProductsCube() {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kMatmulN = 64;
    constexpr uint32_t kAElements = kMatmulM * kMatmulK;
    constexpr uint32_t kBElements = kMatmulK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);
    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    __gm__ uint8_t *nextStageBase = GetCubeStageBase(1);
    GlobalTensor<half> nextAStageGm;
    GlobalTensor<half> nextAResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAElements * sizeof(half)), kBElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAElements + kBElements) * sizeof(half)), kAElements);
    nextAStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(nextStageBase), kAElements);
    nextAResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(nextStageBase + (kAElements + kBElements) * sizeof(half)), kAElements);

```

- :1021 `template <uint32_t kMatmulK>`——**只有 reduction 维是模板参数**。M 与 N 在 :1023-:1024 写死 64，因为两个乘积的输出都是 `chunkLen × chunkLen = 64 × 64` 的注意力矩阵，与 dk 无关。调用点 :970 传的是 `kSpecializedDk`，于是四个实例化各自把 `kMatmulK` 钉成 64/80/96/128。
- :1025-:1027 三个元素数。注意一个**恒等式**：`kAElements = 64*kMatmulK` 与 `kBElements = kMatmulK*64` **数值永远相等**（乘法交换，且 M=N=64）。因此 slot0 的三段是等长的三块，:1035-:1038 的偏移算式 `kAElements`、`kAElements + kBElements` 可以写成同一个常量倍数；`kCElements = 4096` 与 `kMatmulK` 无关，这是 L0C 与读回通路在四个桶下**完全同形**的原因（§7.7）。
- :1028 `GetCubeStageBase(0)` 与 :1032 `GetCubeStageBase(1)`：全文件 8 次调用里，只有这两行相邻出现（其余 6 处均为 `(0)`：:458/:1221/:1613/:1743/:1832/:1933/:2112）。slot 尺寸由 :38 `CUBE_STAGE_SLOT_BYTES = 64 * 1024` 与 :39 `CUBE_STAGE_SLOT_COUNT = 2` 定死，每核 2×64KB，基址算式见 :249-:255（第 05 章 §5.6.1）。
- :1029-:1034 六个 `GlobalTensor<half>` 句柄，**只有 A 侧有残差半区**（`aResidualStageGm`、`nextAResidualStageGm`），没有 `bResidualStageGm`——这是 §7.0 第 2 条"只补 A"的**声明级证据**：想补也没有地址。
- :1035-:1041 六次 `SetGlobalBuffer(ptr, elementCount)`，把同一个 slot 切成 `[A_hi | B | A_lo]`。slot1 的 :1039/:1041 刻意沿用 slot0 的**同一套 intra-slot 偏移**（`(kAElements + kBElements) * sizeof(half)`），于是 A_lo 永远在 2/3 处，两槽的地址算式共用。代价是 slot1 的中段 `[kAElements, kAElements+kBElements)` **申请了但从不使用**（:1039 写 A_hi、:1041 写 A_lo，无人写 B 段）：128 桶下白占 16KB。
- 逐桶的 slot 字节账（`2*kAElements + kBElements = 3*64*kMatmulK` 个 half = `384*kMatmulK` 字节）：

| 桶（`kMatmulK`） | `kAElements` = `kBElements` | `kCElements` | slot0 地址跨度 | slot1 有效数据量 | 占用率 = 跨度/64KB |
|---|---|---|---|---|---|
| 64 | 4096 half = 8KB | 4096 fp32 = 16KB | 24KB | 16KB | 37.5% |
| 80 | 5120 = 10KB | 16KB | 30KB | 20KB | 46.9% |
| 96 | 6144 = 12KB | 16KB | 36KB | 24KB | 56.3% |
| 128 | 8192 = 16KB | 16KB | 48KB | 32KB | **75%** |

  列义：`slot0 跨度 = (2*kAElements + kBElements) * 2B`（三段连续，无空洞）；`slot1 跨度 = (2*kAElements + kBElements) * 2B` 同上，但其间 `[kAElements, kAElements+kBElements)` 那 16KB 永不写入；`占用率 = slot0 跨度 / 64KB`。**由此得到的硬约束是 `384*kMatmulK ≤ 65536` → `kMatmulK ≤ 170`**：四个桶都在界内，128 桶已用掉每槽 75%，再加一档 160 桶就会溢出 slot。这是 host 侧 `SelectCubeDk`（`tiling.cpp:211-225`）在 128 之上返回 0、把 `dk > 128` 推给通用臂的**第二个理由**（第一个是 UB 容量），docs 与第 02 篇都未提这一格。另外 `slot1 跨度` 与 `slot0 跨度` 相等，说明双槽方案在 128 桶下要吃 96KB GM 暂存（48KB×2），而 :1039/:1041 的中段空洞意味着**理论上可以只留 32KB/槽**——作者选择让两个槽共用同一套偏移常量，用 16KB 的地址浪费换掉两套地址算式的维护成本。

## 7.2 chunk_gated_delta_rule.h:1043-1069 — Kᵀ 的 FP16 转置、出 GM 与 A_hi/A_lo 分裂

锚点：chunk_gated_delta_rule.h:1043-1069

```cpp
    // Transpose the FP32 K cache through FP16 in UB; K originated as FP16, so
    // this conversion is exact and avoids another GM read of the source tensor.
    LocalTensor<half> keyLocal = stateOutQueue_.AllocTensor<half>();
    LocalTensor<half> keyTransposed = chunkVFp32.template ReinterpretCast<half>();
    Cast(keyLocal, chunkKFp32, RoundMode::CAST_NONE, kAElements);
    PipeBarrier<PIPE_V>();
    TransDataTo5HDParams transposeParams;
    transposeParams.repeatTimes = static_cast<uint8_t>(kMatmulK / 16);
    transposeParams.srcRepStride = 1;
    transposeParams.dstRepStride = kMatmulM;
    for (uint32_t block = 0; block < kMatmulM / 16; ++block) {
      LocalTensor<half> srcRows[16];
      LocalTensor<half> dstRows[16];
      for (uint32_t row = 0; row < 16; ++row) {
        srcRows[row] = keyLocal[block * 16 * kMatmulK + row * kMatmulK];
        dstRows[row] = keyTransposed[block * 16 + row * kMatmulM];
      }
      TransDataTo5HD<half>(dstRows, srcRows, transposeParams);
    }
    PipeBarrier<PIPE_V>();
    event_t vectorToMte3 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE3));
    SetFlag<HardEvent::V_MTE3>(vectorToMte3);
    WaitFlag<HardEvent::V_MTE3>(vectorToMte3);
    DataCopy(bStageGm, keyTransposed, kBElements);
    stateOutQueue_.FreeTensor(keyLocal);
    StageHalfWithResidual(kCumdecayFp32, chunkVFp32, aStageGm, aResidualStageGm, kAElements);
    PipeBarrier<PIPE_ALL>();
```

- :1045 `stateOutQueue_.AllocTensor<half>()` 借的是 :2423 声明的 `TQue<QuePosition::VECOUT, 1>`——**缓冲数写死 1**（:34 `BUFFER_NUM = 1`，:143 用它初始化）。这意味着队列里同时只能有一块在手，所以 :1067 的 `FreeTensor(keyLocal)` **必须**在 :1068 再次进入 `StageHalfWithResidual`（其内部 :1559 自己 `AllocTensor`）之前发生。这两行的先后不是风格问题，是**单缓冲队列的硬性会合点**；把它写成"随手释放"就会在下一桶上死锁。容量核算：`keyLocal` 要 `kAElements` 个 half = `64*dk*2` B，队列容量 :139-:142 取 `max(stateStrideK_*vSA, cs*vSA)*2B`，`stateStrideK_ == alignK_ == dk`（:92/:91）→ 需 `64*dk ≤ dk*vSA` → **`vSA ≥ 64`**，由守卫 `vStepAligned_ >= kSpecializedDk >= 64`（:968）保证。
- :1046 `chunkVFp32.template ReinterpretCast<half>()`：转置目的区借用 V 的 FP32 板。`chunkVFp32` 容量 `cs*vSA` 个 FP32 = `256*vSA` 字节，要装 `kBElements = 64*dk` 个 half = `128*dk` 字节 → 需 `vSA ≥ dk/2`，同样被 :968 覆盖。这是第 06 章 §11 那张"chunkVFp32 五次身份"表之外的**第六次借用**（本区间内它借三次：:1046 转置区、:1068/:1113 残差 scratch、:1166 的 NZ 落点，见 §7.7）。
- :1047 `Cast(keyLocal, chunkKFp32, RoundMode::CAST_NONE, kAElements)`：`chunkKFp32` 是 `LoadChunkKey` 从 `keyGm_`（`inType = half`）升上来的 FP32（:759-:778 + 第 04 章 `LoadPaddedRows`），**降回 FP16 是无损的**——这就是 :1043-:1044 注释的技术含义，也是 B 侧不需要 lo 半区的唯一理由。注释里"avoids another GM read of the source tensor"点出第二个动机：不这么做就得再 DMA 一次 `keyGm_`。
- :1048 `PipeBarrier<PIPE_V>`：同管排空，让 :1053-:1061 的转置读到完整 8192 元素。
- :1049-:1052 三个转置参数：`repeatTimes = kMatmulK/16`（沿 dk 维滚动 4/5/6/8 次）、`srcRepStride = 1`（源侧每轮前进一个 16 元素段）、`dstRepStride = kMatmulM = 64`（目的侧每轮前进 64 个 half）。把 :1053-:1059 的下标代进去可以**唯一确定**输出布局：第 `block`（0..3）轮取 `srcRows[row] = keyLocal[block*16*dk + row*dk]`，即 K 的第 `block*16+row` 行、当前 16 列段；写到 `keyTransposed[block*16 + row*64]`，即地址 `i*64 + (block*16 + j)`。这恰是 **Kᵀ 的行主序 ND 布局，行距 64 = `kMatmulM`**，`dstRepStride` 的 64 就是"目的矩阵换一行"的字节数。故 4×16 条 `dstRows` × `dk/16` 轮 × 16 元素 = `64*dk = kBElements`，与 :1066 的搬运长度**逐元素吻合**——这条等式是"转置区没写漏也没写穿"的充分证明。
- :1062 `PipeBarrier<PIPE_V>` + :1063-:1065 的 `V_MTE3` 配对：本区间**唯二**用 `pipe_->FetchEventID` 申请事件 ID 的地方之一（另一处 :1118）。全区间 `SetFlag`/`WaitFlag` 各 23 处，其中 4 对是 `TQueSync`（:1156/:1188/:1207/:1230）、2 对是这两处申请式，**其余 17 对硬事件全部写死槽号 0**。写死 0 的前提是"同一条管边上同时只有一个未决配对"，本函数满足（每条边都 Set 完立刻 Wait）。
- :1066 `DataCopy(bStageGm, keyTransposed, kBElements)`：**UB→GM 的一维平铺搬运**，不做 NZ 化。NZ 转换推迟到 :1081 的 `Nd2NzParams`，与 `StageHalf`（:1587）→ :1253 的 Nd2Nz 是同一套两段式。之所以能这样，是因为 MTE2 的 `Nd2Nz` 只要求源是行主序 ND。
- :1068 `StageHalfWithResidual(kCumdecayFp32, chunkVFp32, aStageGm, aResidualStageGm, kAElements)`：A = `kCumdecayFp32` = K·β·e^{g}（:869-:899 与 :1186 的产物）。它的 FP16 截断**有损**，所以必须分裂；实现细节见第 08 章 §7，本篇只强调两点：(a) 它内部要 2 次 `stateOutQueue_` 往返，与 :1045/:1067 的 `keyLocal` 抢同一块单缓冲；(b) 它的 `scratch` 参数就是 `chunkVFp32`，**覆写 :1066 刚搬走的转置区**。
- :1069 `PipeBarrier<PIPE_ALL>`：本区间 6 道 ALL 屏障的第一道（其余 :1171/:1178/:1241/:1286/:1293）。它把 V 与 MTE3 的 :1066/:1068 全部排空后才放行 :1081/:1082 的 MTE2 读，因此**这里不需要 MTE3→MTE2 事件**。此时 M 管还是空的（第一发 Mmad 在 :1095），排空代价 = 一次 DMA 的延迟，所以用重屏障不亏。**对照 §7.5：同样性质的槽就绪依赖，:1118 就不能用 PIPE_ALL**——那里 M 管里有两发在飞的 Mmad。

## 7.3 chunk_gated_delta_rule.h:1070-1095 — 四级片上存储与乘积①的主项 Mmad

锚点：chunk_gated_delta_rule.h:1070-1095

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

    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0});
    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
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

- :1071-:1074 四个 `LocalMemAllocator<Hardware::X>` 栈对象、:1075-:1079 五次 `Alloc`。这套写法与第 05 章 §5.6.2 完全同构（`MatmulBlockFp32Compensated` :474-:477 + :478-:482），差别只有一处：这里 `kBlock` 不再是方阵，`a1Local/a2Local` 拿 `kAElements = 64*dk`、`b1Local/b2Local` 拿 `kBElements = dk*64`。**`Hardware::` 在 !1174 里被限定成 `AscendC::Hardware::`**（→ `src/048d0427/...:1084-1087`），是本区间除两处读回栅栏外**唯一**的其他改动，见 §7.12 的映射表。
- :1081/:1082 **先 B 后 A**，与 `LoadMatmulBlockA`→`LoadMatmulBlockB`（:484-:485）的顺序相反。两条都是 MTE2 队列里的顺序指令，且 :1083-:1084 的 `MTE2_MTE1` 配对统一在两条之后收口，因此交换**语义中性**；唯一的可观察差别是 L1 里 B 先就绪。值得记一笔是因为它是"顺序即依赖"这类误读的照妖镜：如果谁把 :1083 的栅栏挪到两条 DataCopy 中间，这个交换才会产生行为差。
- `Nd2NzParams` 八元组的两个实例：:1081 是 `{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0}` = `{1, dk, 64, 0, 64, dk, 1, 0}`，:1082 是 `{1, 64, dk, 0, dk, 64, 1, 0}`。两者是同一模板 `{1, K, N, 0, N, K, 1, 0}` 的两次代入（行块数、块内行长互换），与第 05 章 :418/:430 的 `{1, kBlock, kBlock, 0, kBlock, kBlock, 1, 0}` 严格同族——把 `kBlock` 拆成两个独立维度就得到本区的定形。按"净效果"读法（快照不含 AscendC 头文件，第 05/06 章同一口径）：源是行距 `kMatmulK`（A）/`kMatmulN`（B）的 ND 板，输出是 16×16 分形序列。
- :1085-:1088 A 侧 4 发 `LoadData`：`mBlock` 只有 `kMatmulM/16 = 4` 次，每次搬"16 行 × dk 列"的 L1→L0A 面板，`LoadData2DParams{0, dk/16, 4, 0, 0, false, 0}` 的三个数分别是块内轮数、总块数、以及第 7 位 `false` = 不转置。:1089-:1092 B 侧 `dk/16` 发（64→4、80→5、96→6、128→8），`LoadData2DParams{0, 4, dk/16, 0, 0, true, 0}` 第 7 位 `true` 与 `LoadMatmulBlockB`（:435）一致。**逐桶 LoadData 计数 = A 侧 4 + B 侧 dk/16 = 8/9/10/12**。
- :1093-:1094 `MTE1_M` 配对是"数据已进 L0A/L0B，M 可以开工"的边；:1095 第一发 Mmad。
- :1095 `MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true}` = `M=64, N=64, K=dk`，末位 `true` 即 `initC`（判据同第 06 章自查最后一条：:444 的 `MmadParams{kBlock, kBlock, kBlock, 0, false, init}` 把它显式命名了）。这一发清 L0C 重开累加，是"两个乘积共用一块 16KB L0C"的**唯一**清零点之一（另一处 :1130）。
- 乘积①的算术规模：稠密项 `64×64×dk` = 524288（dk=128）/ 327680 / 245760 / 131072 次 MAC，:1095 一发 Mmad 完成主项 `A_hi·B`；加上 :1108 的修正项 `A_lo·B`，**硬件实际做 2×524288 = 1048576 次 MAC、2 发 Mmad**。对照 :978-983 兜底里算同一批元素的 2016 次 `DotFp32`（每次 128 MAC，共 258048 MAC、约 1 万条发射）——**Cube 把 MAC 数放大 4.06 倍（2×524288 / 258048），把发射数从约 1 万压到 2**。放大全部来自"它不认三角、整块稠密"：4096 个输出格里只有 2016 个被下游读取。**"三角结构靠预清零排除、Cube 只吃稠密"这条本 PR 的通用模式（docs §3.3）在 :1150-:1155 的收尾清零里兑现**，见 §7.6。

## 7.4 chunk_gated_delta_rule.h:1096-1114 — 乘积①的残差半区、slot1 预取与第一次读回

锚点：chunk_gated_delta_rule.h:1096-1114

```cpp

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

    // Stage Q into a disjoint GM slot while the first compensated product is
    // executing. The MTE3->MTE2 dependency below prevents the next consumer
    // from observing a partially written slot.
    StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, nextAStageGm, nextAResidualStageGm, kAElements);
    CopyAttnCubeResult(c1Local, chunkScoresFp32);
```

- :1097-:1098 `M_MTE1` 配对——**方向是 M→MTE1，等的是"L0A 已读完、可以被覆写"**（WAR 保护，同 :445-:446 的位置）。它不是"L0C 可读了"，那需要 `M_V`/`M_MTE2`；这正是 §7.7 与 !1174 的靶心。发完这对栅栏后标量线程继续向前发射，被阻塞的是 MTE1 队列里的 :1099，**M 管里 :1095 那发 Mmad 是否跑完与此无关**。
- :1099-:1105 只重载 **A 的 lo 半区**（`aResidualStageGm` → `a1Local` → `a2Local`），4 发 LoadData，B 一行不动。于是 `b2Local` 里的 Kᵀ 从 :1089 一直驻留到 :1139，**跨越 2 发 Mmad、1 次 A 重载、1 次 slot1 分裂和 1 次整块 L0C→UB 读回**——这就是 :1017 注释 "while K^T remains resident in L0B" 的全部含义，也是本函数相比"两个独立函数各装一次 B"省下的 `dk/16` 发 LoadData + 16KB GM→L1 流量。
- :1106-:1108 第二发 Mmad：`initC = false`（末位）→ 累加进同一块 L0C。至此乘积① = `A_hi·B + A_lo·B`，**两项，非四项**（§7.0 第 2 条）。
- :1110-:1112 三行注释是本 PR 里少见的"并发设计自陈"，逐句拆开：
  - "Stage Q into a disjoint GM slot **while the first compensated product is executing**" —— 主语是"第一个补偿乘积"（:1095 + :1108 两项），**不是"下一个 chunk"**。本函数体内没有任何 `c`/`chunkLen` 级循环（:1021-:1159 全文 8 个 `for`——:1053、:1056、:1085、:1089、:1102、:1124、:1136、:1150——上界全是 `kMatmulM/16`、`kMatmulK/16`、`16`、`kMatmulM` 这类定形常量，没有一处出现 `chunkLen`/`c`），调用点 :970 也在 `ComputeAttnMatrix` 的单次执行里。所以 slot1 装的是**本次调用第二个乘积的 A 操作数**（Q·scale），"双缓冲"的粒度是 chunk 内的两个乘积，不是 chunk 之间。**这是对第 09 章 §9.4 L88"真正的跨迭代预取"说法的修正**（该章的其余结论不受影响）。
  - "The MTE3->MTE2 dependency **below** prevents the next consumer from observing a partially written slot" —— 指 :1118-:1120。**这里不能用 `PipeBarrier<PIPE_ALL>`**：此刻 M 队列里 :1108 还在跑，ALL 屏障会把它一起等掉，:1113 与 :1095/:1108 的重叠就消失了。换成定向事件后，被阻塞的只有 MTE2 队列的 :1121，M 管继续算。§7.2 的 :1069 用重屏障、这里用轻事件，**同一个"槽就绪"依赖在两条路上选择不同，判据只有一个：屏障窗口里 M 管有没有活**。这条对比是全文件读 Cube 代码最实用的一课。
- :1113 `StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, nextAStageGm, nextAResidualStageGm, kAElements)`：A = 缓存好的 Q·scale（:952-:961 `PrepareAttnQueryCache` 的产物，第 06 章 §7）。`chunkAttnOutFp32` 的行距是 `alignK_ = dk`（:959 的 `Muls(..., chunkLen*alignK_)`），与 :1082/:1121 的 `Nd2NzParams{1, 64, dk, ...}` 一致。scratch 仍是 `chunkVFp32`——此时 :1046 的转置区已被 :1066 搬空、内容已死，可覆写。
- :1114 `CopyAttnCubeResult(c1Local, chunkScoresFp32)`：第一次读回。**注意它与 :1113 的关系**：`CopyAttnCubeResult` 内部 :1166 把 `chunkVFp32` 当 NZ 落点，而 :1113 的 `StageHalfWithResidual` 正在用同一块 UB 当残差 scratch（其内部最后一次写是 :1571 的 `Sub`，V 管）。两者之间**没有任何跨管事件**——唯一的屏障 :1171 在写之后才出现（详见 §7.7 的定序清单）。:1118 的 `MTE3_MTE2` 只覆盖 slot1 的 GM 侧，不覆盖 `chunkVFp32` 的 UB 侧。!1174 的 diff 显示这两行**在修复后仍一字未改**（`src/048d0427/...:1126` 与 `:1127`，偏移 +13），属遗留窗口，本篇按事实登记，不推断其是否曾在实测中致错（Report 3 的因果链另有归属）。

## 7.5 chunk_gated_delta_rule.h:1115-1143 — 乘积②：复用常驻 Kᵀ 的 QKᵀ

锚点：chunk_gated_delta_rule.h:1115-1143

```cpp

    // Reuse resident K^T for QK^T. Q*scale was cached in
    // chunkAttnOutFp32 by PrepareAttnQueryCache.
    event_t stageReady = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE3_MTE2));
    SetFlag<HardEvent::MTE3_MTE2>(stageReady);
    WaitFlag<HardEvent::MTE3_MTE2>(stageReady);
    DataCopy(a1Local, nextAStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true});
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, nextAResidualStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, false});
    CopyAttnCubeResult(c1Local, chunkAttnOutFp32);
```

- :1115 空行；:1116-:1117 注释"Reuse resident K^T for QK^T. Q*scale was cached in chunkAttnOutFp32 by PrepareAttnQueryCache"——两句话各自锁住一个不变式：**L0B 未被触碰**（:1118-:1142 无 B 侧重载，也无任何写 `b1Local/b2Local` 的语句），**A 侧必须是 Q·scale 而不是原始 Q**（守卫 :969 的 `CanCacheAttnQuery` 保证 :952-:961 真的写进去了；:953-:955 的早退是这条链的唯一破口）。
- :1118-:1120 slot1 的收槽栅栏（语义见 §7.4）。:1121 与 :1133 两条 `DataCopy(a1Local, ...)` 用**完全相同**的 `Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0}`，与 :1082/:1099 逐字符相同——四个桶下 A 侧的 NZ 参数只有这一份，这是 `kAElements == kBElements` 恒等式（§7.1）带来的第二个红利。
- :1122-:1123、:1128-:1129、:1134-:1135、:1140-:1141 四对栅栏把 "MTE2 写 L1 → MTE1 搬 L0 → M 算" 的三级流水重跑一遍，与 :1083-:1094 同构。**B 侧一条栅栏都没有**，因为 `b2Local` 里没有新数据要覆盖——这是本函数把两发 Mmad 合并进一次调用的净收益：**省下 1 对 `MTE2_MTE1` + dk/16 发 LoadData + 16KB GM→L1**。
- :1130 `initC = true`：第二个乘积**重开** L0C。这是关键选择——两个乘积的输出要落到两块不同的 UB（`chunkScoresFp32` 与 `chunkAttnOutFp32`），不像第 09 章的融合版把两个乘积**加进**同一块 L0C（`docs §3.4` 的"一次 L0C 累加 v_new"）。**同一个 `c1Local` 在本函数里是"复用的缓冲"，在融合版里是"共享的累加器"**，`initC` 的取值就是这两种用法的分水岭：本函数 :1095/:1130 各清一次、共 2 次清零 4 发 Mmad；融合版 :1660 只清 1 次、4 发全累加。
- :1143 第二次读回 `CopyAttnCubeResult(c1Local, chunkAttnOutFp32)`。此处 `dst` 恰是 :1113 那两次 `StageHalfWithResidual` 的**源**（Q·scale），也是 slot1 的 A_hi/A_lo 的地址来源——读回 :1175-:1177 的逐行 `DataCopy` 会把它整体覆盖成 attn_i。**这是刻意的原地复用**：Q 在 :1130/:1142 之后已经变成 L0C 里的积，UB 里的 Q 从此无人再读（下一处读 `chunkAttnOutFp32` 的是 :1233，那里它被当作**空白目的板**用）。反证：如果 attn_i 需要写到别处，全 kernel 找不到第二块 `64×64` FP32 空闲板——`chunkScoresFp32` 要留给 A⁻¹，`decayMaskFp32` 只有 `cs*cs` 且正被 :1145/:1148 读写，`stateInFp32` 与 :173-:183 的重叠规则绑定。
- 逐 chunk 至此的 GM 流量（128 桶）：**UB→GM 出片 80KB**（:1066 的 16KB + :1068 的 32KB + :1113 的 32KB）、**GM→L1 入片 80KB**（:1081/:1082/:1099/:1121/:1133 各 16KB）。这 160KB 是"裸 Mmad 没有 UB→L1 直路"（docs §2.3 第 1 条）的直接代价，也是本函数发射结构里最大的一块：**4 发 Mmad 配 140 发 DataCopy**——其中本函数体内 6 个静态点（:1066/:1081/:1082/:1099/:1121/:1133）、`StageHalfWithResidual` 两次调用带出 4 发（:1564/:1577 各两次）、两次 `CopyAttnCubeResult` 带出 2 发 L0C→UB（:1170）与 **128 发逐行 NZ→ND**（:1176）。行拷贝占掉 91% 的发射量，这是"没有 Fixpipe"最直白的账单（§7.7）。

## 7.6 chunk_gated_delta_rule.h:1144-1159 — Vector 侧收尾：decay 乘、取负、三角清零与一对 V→S

锚点：chunk_gated_delta_rule.h:1144-1159

```cpp

    Mul(chunkScoresFp32, chunkScoresFp32, decayMaskFp32, kCElements);
    PipeBarrier<PIPE_V>();
    Muls(chunkScoresFp32, chunkScoresFp32, -1.0f, kCElements);
    Mul(decayMaskFp32, chunkAttnOutFp32, decayMaskFp32, kCElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      Duplicate(chunkScoresFp32[row * kMatmulN + row], 0.0f, kMatmulN - row);
      if (row + 1 < kMatmulN) {
        Duplicate(decayMaskFp32[row * kMatmulN + row + 1], 0.0f, kMatmulN - row - 1);
      }
    }
    TQueSync<PIPE_V, PIPE_S> attentionSync;
    attentionSync.SetFlag(0);
    attentionSync.WaitFlag(0);
  }
```

- :1144 空行。Cube 只交出两个**无结构的稠密积**，:1018-:1019 注释里那两个公式的"⊙ decay"与"−"号全在这 12 行里兑现——这就是 docs §3.1 总结的"稠密给 Cube，结构给 Vector"分工原则的落地现场。
- :1145 `Mul(chunkScoresFp32, chunkScoresFp32, decayMaskFp32, kCElements)` 与 :1148 `Mul(decayMaskFp32, chunkAttnOutFp32, decayMaskFp32, kCElements)`：两条都是 `kCElements = 4096` 元素的**整块一维** `Mul`，一条发射处理 64×64。**顺序有讲究**：:1145 先读 `decayMaskFp32`（此刻它还是 :903-:940 `PrepareDecayAndExp` 产出的 decay 矩阵），:1148 才把它覆写成 attn_i。若两条互换，第一个乘积会乘上 attn_i 而不是 decay——**同一个 `decayMaskFp32` 在 4 行内从"输入"变成"输出"，这是本函数最紧的一次缓冲交接**，也是 :1146/:1149 两道 `PipeBarrier<PIPE_V>` 存在的原因（同址 RAW/WAR，单管定序即可）。
- :1147 `Muls(chunkScoresFp32, chunkScoresFp32, -1.0f, kCElements)` 实现 :1018 的负号。放在 `Mul` 之后而不是把 `-1` 提前乘进 A 侧，与第 09 章 §9.5 里融合版"把负号提前乘进 A"的选择**恰好相反**；两种都对，代价差一条 4096 元素的 `Muls`（本处）对一次分裂前的标量乘。这里选 Vector 侧是因为 A 侧的分裂（:1068）已经完成，回不去了。
- :1150-:1155 的清零是**上三角**，但两条的起点不同且都必须不同：
  - :1151 从 `row*kMatmulN + row`（**含对角**）起清 `kMatmulN - row` 个 → 每行清 `64-row` 个，合计 `64+63+…+1 = 2080` 个元素，`Duplicate` 发射 64 次。
  - :1153 从 `row*kMatmulN + row + 1`（**不含对角**）起清 `kMatmulN - row - 1` 个 → 合计 `63+62+…+0 = 2016` 个，且 :1152 的 `if (row + 1 < kMatmulN)` 只为挡掉最后一行 `Duplicate(ptr, 0, 0)` 这条无意义发射。
  - 为什么 scores 含对角、decay 乘积不含：`chunkScoresFp32` 交给调用方做 `(I−A)⁻¹`，其**严格下三角**才是 A，对角必须为 0 好让 :972-:974 显式写成 1（第 06 章 §8 已指出这是 !1108 的语义延续）；而 `decayMaskFp32` 装的 attn_i 对角是 `q_i·k_i ⊙ e^{g_i−g_i} = q_i·k_i ≠ 1`，Step 5/6 的 `ComputeOutputCube`（:2006-:2007 直接读这块）要用它，**清掉就错**。1 个元素的差别，两条完全不同的下游契约。
  - :1150 的 64 次 `Duplicate` 每次只清 ≤64 个 FP32（≤ 8 个 32B 块，正好一条向量指令的最大 repeat 宽度），这是"逐行清"而不是"整块清"的原因：上三角不是矩形，一维 `Duplicate` 覆盖不了。
- :1156-:1158 `TQueSync<PIPE_V, PIPE_S> attentionSync`：**本函数唯一的 V→S 出口栅栏**，服务对象不在本函数内，而是紧接其后的调用方代码——:971 `ComputeRecursiveAttn` 的兜底臂（:633-:647）用 `buf.GetValue(i*ld+k)` 标量读、:972-:974 用 `chunkScoresFp32.SetValue(i*cs+i, 1.0f)` **标量写**。没有这对栅栏，标量管可能读到 :1176 行拷贝还没写完的对角，或者更糟：标量写 1.0 被 V 管还在排队的读回覆写掉。**它与 :1230-:1232 的 `recursiveToVector`（S→V）构成一前一后的括号，中间夹着的正是 :972-:974 那个纯标量的对角循环**——这是全 kernel 里 S↔V 配对跨度最大的一处，跨三个函数（本函数 → `ComputeAttnMatrix` → `ComputeKCumdecay` → `ComputeKCumdecayCube`）。
- :1159 右花括号。本函数**没有**任何形式的 `M_V`/`V_M`：它对 L0C 的两次消费全在 :1114/:1143 里，见 **07b §7.7**（`CopyAttnCubeResult`）。本篇到此结束；:1160-1297 的逐行讲解在 `07b-KCumdecay的Cube化与读回.md`。
