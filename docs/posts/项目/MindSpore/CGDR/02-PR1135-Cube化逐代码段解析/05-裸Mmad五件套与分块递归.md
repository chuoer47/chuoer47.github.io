# 05 · 裸 Mmad 五件套与分块递归

## 5.1 本章结论先行

锚点：chunk_gated_delta_rule.h:415-685

1. **"五件套"是本章前 94 行的全部内容**：`LoadMatmulBlockA`/`LoadMatmulBlockB`（GM→L1 的 Nd2Nz + L1→L0A/L0B 的 LoadData）、`MmadMatmulBlock`（配 m/n/k 与 init、发一发 Mmad）、`MatmulBlockFp32Compensated`（把一次 FP32 乘积摊成 4 发 Mmad 并在 L0C 里累加）、以及最后 495-507 行的 **L0C(NZ)→UB(ND) 逐行读回**。它是全 kernel 六处 Cube 化共用的底座。
2. **补偿分裂的四次乘积顺序是 hi×hi → lo×hi → hi×lo → lo×lo**，且只有第一次 `init=true`（清零并重开 L0C 累加器），后三次都往同一个 `c1Local` 里续加。B 侧只在换半区时重载（6 次装载喂 4 发 Mmad），靠的是 L0B 驻留。
3. **NZ→ND 的地址算术在 501-502 两行**：`kNdBlockLen = 2` 个 32B 块（16 个 FP32 = 一个分形的一行），`kNzSrcStride = (kBlock/16*16*16 - 16)*4/32`（kBlock=32 时是 62 块）。这个式子能成立，靠的是 L0C 的分形线性序**以 N（输出列块）为外层**——`cNz[row*16]` 一个表达式同时定位"行块"和"块内行"，因为行块间距恰好也是 16 行 × 16 元素。
4. **分块递归是三档**：64 = 2×32 + 2×(2×16)。16×16 对角块完全在向量管上用 `Gather + Brcb + MulAddDst` 做外积递推（O(16³) 算术零标量）；跨块稠密部分用 `MatmulBlockFp32Compensated` 交给 Cube，合成公式 `U10 = U11·A10·U00`。**注意：32 层用的 `kBlock` 是 16**（即两发 16×16×16 的最小分形 Mmad），只有 64 层才是 32×32×32——这一点与 docs 里"32×32 基本单元"的表述有出入，见 5.13。
5. **`chunkVFp32` 被切成 5 段 scratch（srcA/srcB/residualA/residualB/product）**：`residualA` 在 A 操作数出 GM 之后被再用作 L0C 读回的 `cNz`，所以 5 段而不是 6 段就够；64 层需要 `5×32×32 = 5120` 个 FP32，`ComputeRecursiveAttn` 的门槛据此决定"走分块还是退回 !1108 的 Axpy 递推"。
6. **`WriteAttnTileToGm`（653-685）与 !1108 的 341-373 逐字节相同**（`diff` 验证）——输出写回本来就已经是 2D strided DMA，Cube 化无事可做。

## 5.2 硬件底座：Cube 数据通路、分形与 NZ/ND

锚点：chunk_gated_delta_rule.h:439-447

```cpp
  template <uint32_t kBlock>
  __aicore__ inline void MmadMatmulBlock(LocalTensor<float> c1Local, LocalTensor<half> a2Local,
                                         LocalTensor<half> b2Local, bool init) {
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kBlock, kBlock, kBlock, 0, false, init});
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
  }
```

这 8 行是最小完整的 Cube 闭环，用它讲清概念最合适。

**层级与占用量**（本章只用代码可验证的数字，不引外部规格手册）：

| 存储 | 谁写谁读 | 本章 `kBlock=32` 时的占用 |
|---|---|---|
| L1 | MTE2 从 GM 写入（`Nd2Nz`），MTE1 读出到 L0A/L0B | `a1Local` + `b1Local` = 1024+1024 个 FP16 = 2KB+2KB |
| L0A / L0B | MTE1 写入，**只有 Mmad 能读** | `a2Local`/`b2Local` 各 2KB |
| L0C | Mmad 写入并 FP32 累加，Vector/MTE 侧读回 | `c1Local` = 1024 个 FP32 = 4KB |
| UB | 向量管唯一可算的存储，也是 L0C 读回的落点 | scratch 借 `chunkVFp32` 的 5 段 |

（旁证 L0C 上界：`ComputeStateUpdateCube` 的注释"The 64/80/96 buckets fit one complete M tile in L0C; the 128 bucket keeps the conservative 64-row split"（2102-2104）——96×128 的 FP32 tile = 48KB 放得下、128×128 = 64KB 放不下，可反推单 tile 可用的 L0C 在 48–64KB 之间。）

**fractal（分形）= 16×16**：Cube 的阵列一次处理一个 16×16×16 单元。排布上：

- FP16 分形（A/B 侧）= 16×16 个元素 = 256 元素 = **512 字节**；
- FP32 分形（C 侧）= 16×16 个元素 = 256 元素 = **1024 字节**。

`MmadParams{m, n, k, 0, false, init}` 的三元组 `m/n/k` 必须是 16 的倍数，硬件内部拆成 `(m/16)×(n/16)×(k/16)` 个单元操作。`MmadMatmulBlock<32>` 就是 2×2×2 = 8 个 16³ 单元；最后一位 `init` 决定 L0C 累加器是**清零重开**（`true`）还是**续加**（`false`）——补偿分裂的 4 次乘积全靠这个位串起来。

**NZ 与 ND**：

- ND（Normal Data）= 行主序，UB/GM 里的自然排布，`dst[row*ld + col]`。
- NZ = 以 16×16 分形为单位的排布。**Mmad 的操作数必须是 NZ**，所以 GM→L1 那一跳要用 `DataCopy(dst, src, Nd2NzParams{...})` 顺手完成 ND→NZ 重排。
- **L0C 原生就是 NZ**，而且它的分形线性序是"**N（列块）为外层、M（行块）为内层**"。`docs/PR-1135-d0906c3e/10-Commit演进史.md` §1.1 引用的初版注释原文就是"raw Mmad writes L0C in NZ order and Fixpipe is unavailable. Copy N/16 fractals into UB in NZ order"——"N/16 个分形、每个含 M/16 个 cube 块"这句正是外 N 内 M。
- **Fixpipe 缺失的后果**：Ascend 910B 上 Fixpipe 负责"L0C→下游 + NZ→ND 转置 + Cast"，高层 `Matmul` API 的 `GetTensorC()/SetToOutputBuffer()` 都挂在它上面。310P 没有它 → 高层 API 不可用 → 必须裸 `Mmad`，并且 NZ→ND 得自己用 strided `DataCopy` 逐行拼（501-506）。
- **事件链**：`MTE2_MTE1`（GM→L1 写完才允许 L1→L0）、`MTE1_M`（L0 装好才允许算）、`M_MTE1`（Mmad 读过 L1 才允许下一发覆盖 L1）。本章每个装载/计算函数都是"SetFlag+WaitFlag 夹一条搬运或一发 Mmad"的三段式，`docs/PR-1135-d0906c3e/01-Cube化深度精读.md` §3 称之为"五件套骨架的事件链"。
- **`TPosition` 分配器**：`LocalMemAllocator<Hardware::L1|L0A|L0B|L0C>` + `.Alloc<TPosition::A1|B1|A2|B2|CO1, T>(n)`。`Hardware::` 选硬件存储类别，`TPosition::` 选该类里的物理槽位（A1/B1 是 L1 的 A 区/B 区，A2/B2 是 L0A/L0B 的缓冲编号，CO1 是 L0C 的输出缓冲 1 号）。分配只是编译期/入口期的地址水位推进，不产生指令，函数返回时随对象析构释放。

## 5.3 五件套 ①②（A 侧）：LoadMatmulBlockA

锚点：chunk_gated_delta_rule.h:415-426

```cpp
  template <uint32_t kBlock>
  __aicore__ inline void LoadMatmulBlockA(LocalTensor<half> a1Local, LocalTensor<half> a2Local,
                                          GlobalTensor<half> src) {
    DataCopy(a1Local, src, Nd2NzParams{1, kBlock, kBlock, 0, kBlock, kBlock, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t blockIdx = 0; blockIdx < kBlock / 16; ++blockIdx) {
      LoadData(a2Local[blockIdx * kBlock * 16], a1Local[blockIdx * 512 / sizeof(half)],
               LoadData2DParams{0, kBlock / 16, kBlock / 16, 0, 0, false, 0});
    }
  }
```

- 415-417：模板参数 `kBlock` 就是 Mmad 的 m/n/k（本章两个实例化分别是 16 和 32）。三个形参对应三级存储：`a1Local` = L1 的 A1 区、`a2Local` = L0A、`src` = GM 暂存 slot 里的一段。
- 418 **GM→L1 + ND→NZ 一步做完**：`Nd2NzParams` 八个字段按位置读作 (blockCount=1 组, srcHeight=kBlock, srcWidth=kBlock, srcHeightGap=0, dstHeight=kBlock, dstWidth=kBlock, inputNormSize=1, outputNormSize=0)——即"源是一块 `kBlock×kBlock` 的行主序 FP16，目的同尺寸，没有行间隙，不做 norm-size 换算"，硬件按 16×16 分形重排后落进 L1。（字段名以本机 CANN 头文件为准，本仓库快照不含 CANN 头；此处取值语义可直接由 418 与 484-493 的搬运量验证。）
- 419-420：`MTE2_MTE1` 事件对——L1 里的 NZ 数据必须写完，MTE1 才能往 L0 搬。写死事件号 `0` 而不是动态申请，是因为这个函数每次调用只用到这一对方向，不与自身竞争。
- 421-424：**L1→L0A 按 16 行一带地搬**，循环 `kBlock/16` 次。`a1Local[blockIdx * 512 / sizeof(half)]` = 前进 `blockIdx*256` 个 FP16 = **正好一个 FP16 分形**（512 字节；代码用"字节数 / sizeof(half)"的写法把字节意图显式写出来）；`a2Local[blockIdx * kBlock * 16]` = 前进 `blockIdx*kBlock*16` 个元素 = `kBlock/16` 个分形 = **一个 16 行 × kBlock 列的行带**。也就是说：源侧一次前进 1 个分形、目的侧一次前进 kBlock/16 个分形，差额由 `LoadData2DParams` 补齐。
- 423 `LoadData2DParams{0, kBlock/16, kBlock/16, 0, 0, false, 0}`：七个位置里两个 `kBlock/16` 分别是 **K 方向的分形数**与 **M 方向的分形数**（同一形状在 1125-1126 的 64×128 版本里写成 `{0, kMatmulK/16, kMatmulM/16, ...}`，可直接对照确认这个读法）；两个 0 是块间隙，倒数第二位是 L0 装载的 share-weight 标志（A 侧 `false`），最后一位保留。

**为什么 A/B 要拆成两个几乎一样的函数**：只差 423 与 435 的那个布尔位。B 侧 `true`（权重装载形态），A 侧 `false`。把两件事写成一个函数会让这个唯一的差别被埋掉，而它恰好是 Mmad 正确性的关键。

## 5.4 五件套 ①②（B 侧）：LoadMatmulBlockB

锚点：chunk_gated_delta_rule.h:427-438

```cpp
  template <uint32_t kBlock>
  __aicore__ inline void LoadMatmulBlockB(LocalTensor<half> b1Local, LocalTensor<half> b2Local,
                                          GlobalTensor<half> src) {
    DataCopy(b1Local, src, Nd2NzParams{1, kBlock, kBlock, 0, kBlock, kBlock, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t blockIdx = 0; blockIdx < kBlock / 16; ++blockIdx) {
      LoadData(b2Local[blockIdx * kBlock * 16], b1Local[blockIdx * 512 / sizeof(half)],
               LoadData2DParams{0, kBlock / 16, kBlock / 16, 0, 0, true, 0});
    }
  }
```

与 415-426 完全同构（427-433 与 415-421 逐字符相同，只是形参名从 `a1Local/a2Local` 换成 `b1Local/b2Local`），唯一差别是 435 末位之前的 `true`。语义上：`b1Local` 落在 L1 的 **B1 区**（由 `TPosition::B1` 分配，见 479），`b2Local` 落在 **L0B**（`TPosition::B2`，481）。B 侧的 `kBlock×kBlock` 在这里代表 `k × n`。

一个值得注意的事实：调用方 `MatmulBlockFp32Compensated` 只在 B 半区切换时调用本函数（485、490 两次），中间两次 Mmad 复用驻留在 L0B 的 B——这是 `docs/PR-1135-d0906c3e/01-Cube化深度精读.md` §3.1"Kᵀ 驻留 L0B"同一手法在基本单元层的体现，省掉一半 L1→L0B 流量（也省掉两条 `MTE2_MTE1` 往返）。

## 5.5 五件套 ③：MmadMatmulBlock

锚点：chunk_gated_delta_rule.h:439-448

函数体见 5.2 的代码块。补充两点：

- 439-441 与 427-429 一样是"模板 + 签名"样板行（`kBlock` 同时决定 `MmadParams` 的 m/n/k，所以不需要额外参数）。
- 442-443 的 `MTE1_M` 保证 MTE1 把 L0A/L0B 填完才开算；445-446 的 `M_MTE1` 保证 Mmad 已经读完 L1 才允许调用方用下一发 `DataCopy` 覆盖 `a1Local/b1Local`——**这一对不是多余的**：紧接着的 487 就会用 lo 半区重写同一个 L1 槽位。
- 形参名 `c1Local`（440）直接暴露它指向 `TPosition::CO1`，即 L0C 缓冲 1 号；`init` 由调用方给（486 `true`，488/491/493 `false`）。

## 5.6 五件套 ④⑤：MatmulBlockFp32Compensated（449-508）

锚点：chunk_gated_delta_rule.h:449-508（本函数整体 449-508，含 449-452 头注释与 453 的 `template` 行；下面按 5.6.1-5.6.5 拆五个子锚点逐段讲）

### 5.6.1 头注释与 GM 视图（449-468）

锚点：chunk_gated_delta_rule.h:449-468

```cpp
  // Execute one compensated 32x32 FP32 matrix product on Cube. Both operands
  // are split into FP16 high/low parts and accumulated in FP32 L0C. Retaining
  // every cross term keeps the block solve close to the original FP32
  // recurrence while moving the dense cross-block work off the scalar pipe.
  template <uint32_t kBlock>
  __aicore__ inline void MatmulBlockFp32Compensated(LocalTensor<float> srcA, LocalTensor<float> srcB,
                                                    LocalTensor<float> residualA, LocalTensor<float> residualB,
                                                    LocalTensor<float> dst) {
    constexpr uint32_t kMatrixElements = kBlock * kBlock;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);
    GlobalTensor<half> aHiGm;
    GlobalTensor<half> bHiGm;
    GlobalTensor<half> aLoGm;
    GlobalTensor<half> bLoGm;
    aHiGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kMatrixElements);
    bHiGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kMatrixElements * sizeof(half)), kMatrixElements);
    aLoGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + 2 * kMatrixElements * sizeof(half)),
                          kMatrixElements);
    bLoGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + 3 * kMatrixElements * sizeof(half)),
                          kMatrixElements);
```

- 449-452 头注释三个信息：**"one compensated 32x32 FP32 matrix product"**（作者按主要使用场景写的，但函数本身是 `kBlock` 泛型，16 也用它）、**"Both operands are split into FP16 high/low parts and accumulated in FP32 L0C"**（补偿分裂的定义）、**"Retaining every cross term"**（四个交叉项一个不丢——这是精度姿态：宁可多三发 Mmad 也不近似）。
- 453-456 签名：五个 UB 缓冲 `srcA/srcB/residualA/residualB/dst`，全部由调用方从 `chunkVFp32` 里切（见 563-567、599-603）。`residualA/residualB` 是"残差暂存"，`dst` 是 FP32 结果。
- 457 `kMatrixElements = kBlock*kBlock`：编译期，`kBlock=32` → 1024，`kBlock=16` → 256。
- 458 `GetCubeStageBase(0)`：**只用 slot0，不做双缓冲**——与 `ComputeAttnProductsCube`（1029/1033 用 slot0+slot1）不同，因为本函数一次调用要把 A/B 的 hi/lo **四个半区全部备齐**才能开第一发 Mmad，没有"边算边填"的窗口。
- 459-468：四个 `GlobalTensor<half>` 视图指向 slot0 内的四段，每段 `kMatrixElements` 个 FP16。字节偏移代入 `kBlock=32`：`aHiGm @ +0`、`bHiGm @ +2048`、`aLoGm @ +4096`、`bLoGm @ +6144`，合计 **8KB / 64KB 槽**（`kBlock=16` 时是 0/512/1024/1536，合计 2KB）。**顺序是 hi, hi, lo, lo 交错的（aHi bHi aLo bLo）**，不是 aHi aLo bHi bLo——与 470-471 两次 `StageHalfWithResidual` 的调用顺序一致，一次调用产出相邻的两段（A 的 hi+lo），局部性最好。

### 5.6.2 分裂出 GM（470-472）

锚点：chunk_gated_delta_rule.h:470-472

```cpp
    StageHalfWithResidual(srcA, residualA, aHiGm, aLoGm, kMatrixElements);
    StageHalfWithResidual(srcB, residualB, bHiGm, bLoGm, kMatrixElements);
    PipeBarrier<PIPE_ALL>();
```

`StageHalfWithResidual`（定义在 1556-1579，属第 08 章范围）做五件事：`hi = Cast_fp16(X)` → `DataCopy` 出 GM；`MTE3_V` 栅栏后把 `hi` 回读成 FP32；`scratch = X - hi`（**FP32 减法，所以必须有一块 FP32 残差暂存 = 这里的 `residualA/residualB`**）；`lo = Cast_fp16(scratch)`；`DataCopy` 出 GM。于是 `X = hi + lo`，FP16 的 11 位尾数被叠成约 22 位，逼近 FP32 的 24 位。
472 用 `PipeBarrier<PIPE_ALL>()` 而不是 `MTE3_MTE2` 事件：MTE3 刚把 hi/lo 写进 GM，紧接着 MTE2 要从同一地址读——跨机器方向的全排空是最保守也最不会错的写法（4.7 节的 `LoadPaddedRows` 用的是精确事件，因为那里只跨 V→MTE2 一个方向）。

### 5.6.3 L1/L0A/L0B/L0C 分配（474-482）

锚点：chunk_gated_delta_rule.h:474-482

```cpp
    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kMatrixElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kMatrixElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kMatrixElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kMatrixElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kMatrixElements);
```

四个分配器对象（474-477）分别绑定 `Hardware::L1/L0A/L0B/L0C`；五次 `Alloc`（478-482）按 `TPosition` 取槽。要点：

- **同一硬件区里的两个操作数用不同 `TPosition`**：`A1` 与 `B1` 是 L1 的两个互不重叠的地址区间，所以 478-479 不会互相踩；这是"为什么 L1 要分 A 区/B 区"的直接答案——A/B 由两条独立的 MTE2 事务写，区间分离才能让它们并行且不互相覆盖。
- **元素数而不是字节数**：`Alloc<..., half>(kMatrixElements)` 由模板参数决定步长，FP16 时 1024 元素 = 2KB，FP32 的 `c1Local` 同样 1024 元素 = 4KB。
- 这里分配的量正好是 `kBlock×kBlock` 的一份完整操作数，说明这层"基本单元"每次只装一个矩阵块——64×128 的大乘（第 07/10 章）用的是同样的分配器但按 `kMatmulM*kMatmulK` 计算，并且 M 方向要分带循环（1122-1127）。

### 5.6.4 四次乘积与 L0C 累加（484-493）

锚点：chunk_gated_delta_rule.h:484-493

```cpp
    LoadMatmulBlockA<kBlock>(a1Local, a2Local, aHiGm);
    LoadMatmulBlockB<kBlock>(b1Local, b2Local, bHiGm);
    MmadMatmulBlock<kBlock>(c1Local, a2Local, b2Local, true);
    LoadMatmulBlockA<kBlock>(a1Local, a2Local, aLoGm);
    MmadMatmulBlock<kBlock>(c1Local, a2Local, b2Local, false);
    LoadMatmulBlockA<kBlock>(a1Local, a2Local, aHiGm);
    LoadMatmulBlockB<kBlock>(b1Local, b2Local, bLoGm);
    MmadMatmulBlock<kBlock>(c1Local, a2Local, b2Local, false);
    LoadMatmulBlockA<kBlock>(a1Local, a2Local, aLoGm);
    MmadMatmulBlock<kBlock>(c1Local, a2Local, b2Local, false);
```

展开式（`A = Ahi + Alo`，`B = Bhi + Blo`）：

```
A·B = Ahi·Bhi  +  Alo·Bhi  +  Ahi·Blo  +  Alo·Blo
      └484-486┘   └487-488┘  └489-491┘  └492-493┘
       init=T      init=F       init=F     init=F      ← 全部累加进同一个 c1Local(L0C)
```

顺序设计的三个理由：

1. **486 是唯一 `init=true`**：第一发把 L0C 清零并写入主项，后三发在 FP32 累加器里续加。FP32 累加是关键——四个乘积里 `Alo·Blo` 的量级只有主项的 ~1e-7，若在 FP16 里相加会被完全吃掉。
2. **A 换 4 次、B 只换 2 次**（484/487/489/492 是 A 装载，485/490 是 B 装载）：次序排成 `hi,lo,hi,lo` 而不是 `hi,hi,lo,lo`，让每次 Mmad 之前需要重载的操作数最少——B 的两个半区各自跨两次 Mmad 驻留 L0B。这是本函数唯一的调度自由度，作者把它用满了。
3. **489 重新装载 `aHiGm`**：A 的 hi 半区第二次进 L1/L0A。这次重载不是浪费——L0A 只有 2KB 的一份缓冲（480），没有双缓冲槽位，`kBlock` 这么小的单元不值得为它申请第二份 L0A。这也是 4 发 Mmad 串行、没做 K 方向流水的原因（`MmadMatmulBlock` 内部就是一次 Set/Wait）。

代价记账：一次"FP32 矩阵乘" = 2 次 `StageHalfWithResidual`（各含 3 次 Cast + 2 次出 GM）+ 6 次 L1 装载 + 4 发 Mmad + 1 次 L0C→UB→ND。换来的是稠密算术从标量/向量管挪到 Cube。

### 5.6.5 五件套 ⑤：L0C(NZ) → UB(ND) 逐行读回（495-508）

锚点：chunk_gated_delta_rule.h:495-508

```cpp
    LocalTensor<float> cNz = residualA;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kBlock / 16), static_cast<uint16_t>(kBlock / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();
    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kBlock / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kBlock / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kBlock; ++row) {
      DataCopy(dst[row * kBlock], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```

**495 `cNz = residualA`——缓冲 reuse**：`residualA` 的使命（承接 A 的残差）在 470 出 GM 后就结束了，此刻它是 4KB 的空闲 UB，正好当 L0C 读回的落点。这是"为什么只需 5 段 scratch 而不是 6 段"的答案（另见 5.1 第 5 条）。

**496-499 第一跳：L0C → UB，保持 NZ 序**。`BlockMode::BLOCK_MODE_MATRIX` 把 `DataCopyParams` 的计量单位从 32B 块升级成**矩阵块（分形）**：`blockCount = kBlock/16`（外层）、`blockLen = kBlock/16`（每次连搬这么多分形），两个 stride 为 0 → 线性连续。`kBlock=32` 时即 2×2 = 4 个 FP32 分形 = 4KB ✓ 与 `cNz` 容量吻合。**注意这里刻意不做转置**——310P 没有 Fixpipe 可借，转置留给下一步用地址算术完成。
**500 `PipeBarrier<PIPE_ALL>()`**：L0C 的数据要经 UB 再被 MTE2 搬，两次 `DataCopy` 之间必须全排空。

**501-502 代入 `kBlock` 算出具体数值**：

```
kNdBlockLen    = 16 * sizeof(float) / 32 = 64B / 32B                = 2 个 32B 块  （= 一个分形的一行 = 16 个 FP32）
kNzSrcStride   = (kBlock/16 * 16*16 - 16) * sizeof(float) / 32
   kBlock=32   → (2*256 - 16) * 4 / 32 = 496*4/32                  = 62 个块（间隙 1984B）
   kBlock=16   → (1*256 - 16) * 4 / 32                             = 30 个块（本例 blockCount=1，stride 实际不被使用）
   kBlock=64   → (4*256 - 16) * 4 / 32 = 1008*4/32                 = 126 个块（CopyAttnCubeResult:1167 就是这个值）
```

**为什么恰好是 62**：ND 的一行由 `kBlock/16` 段（每段 16 个 FP32 = 2 块）拼成，段间距 = **列块（N 分形）间距** = `(kBlock/16) * 16 * 16` 个 FP32 = `kBlock=32` 时 512 元素 = 2048B = 64 块；减去本段自己占的 2 块 → 间隙 **62 块**。这正是 502 的式子。
**为什么 `cNz[row*16]` 一个式子就够**：行块（M 分形）间距是 16 行 × 16 元素 = 256 元素，而 `row*16` 在 `row=16` 时正好前进 256 —— 恒等式 `(row/16)*256 + (row%16)*16 = row*16` 成立，因为一个 M 分形恰好是 16 行、每行 16 个元素。这就是"外 N 内 M"分形序的直接后果。
**503** 第四个字段 `dstStride = 0`：目的侧（ND 的一行）本来就连续。
**504-506**：`kBlock` 次发射，每次拼出一行。**这是全 PR 反复出现的"NZ→ND 逐行 DataCopy"模板的出处**，后续 `CopyAttnCubeResult`（1160-1170）、`ComputeKCumdecayCube`、`ComputeStateUpdateCube` 都是它的变体；后者甚至把 NZ 寻址和累加融成一条高维 `Add`（2263-2272）。
**507** 再来一次 `PIPE_ALL`，确保 `dst` 对随后的向量指令可见。

## 5.7 16×16 对角块：全向量管的外积递推（510-556）

锚点：chunk_gated_delta_rule.h:510-556（`ComputeRecursiveAttnDiagonalBlock` 含头注释 510-518、函数体 519-555、556 空行；下面按 5.7.1/5.7.2 拆两个子锚点）

### 5.7.1 头注释与缓冲准备

锚点：chunk_gated_delta_rule.h:510-538（538 为空行）

```cpp
  // Solve one 16x16 diagonal block entirely on the Vector pipe. For every
  // source row k, Gather extracts A[k+1:, k], Brcb expands its coefficients,
  // and one strided MulAddDst applies the outer-product update
  //
  //   U[k+1:, :] += A[k+1:, k] * U[k, :].
  //
  // The only scalar work left is the fixed 15-step dependency schedule and
  // setup of the 16 diagonal/offset entries; the O(block^3) arithmetic and
  // all coefficient application stay on PIPE_V.
  __aicore__ inline void ComputeRecursiveAttnDiagonalBlock(LocalTensor<float> &buf, uint32_t rowBase, uint32_t ld) {
    constexpr uint32_t kBlock = 16;
    constexpr uint32_t kMatrixElements = kBlock * kBlock;
    LocalTensor<float> inverse = chunkVFp32;
    LocalTensor<float> coefficientBlocks = chunkVFp32[kMatrixElements];
    LocalTensor<float> column = deltaFp32;
    LocalTensor<uint32_t> gatherOffsets = dotProductFp32.template ReinterpretCast<uint32_t>();

    Duplicate(inverse, 0.0f, kMatrixElements);
    TQueSync<PIPE_V, PIPE_S> initVectorToScalar;
    initVectorToScalar.SetFlag(0);
    initVectorToScalar.WaitFlag(0);
    for (uint32_t i = 0; i < kBlock; ++i) {
      inverse.SetValue(i * kBlock + i, 1.0f);
      gatherOffsets.SetValue(i, i * ld * sizeof(float));
    }
    TQueSync<PIPE_S, PIPE_V> initScalarToVector;
    initScalarToVector.SetFlag(0);
    initScalarToVector.WaitFlag(0);
```

**数学位置**：递推 `A[i][j] = 直接项 + Σ_{j<m<i} A[i][m]·(...)` 写成矩阵就是 `U = (I - A_strict)^{-1}`，`A_strict` 严格下三角。逐行递推（!1108 的 Axpy 版）是 O(16²) 条指令、每条只处理一行的一小段；本函数把它改写成**外积形式**：`U[k+1:, :] += A[k+1:, k] · U[k, :]`，k 从 0 到 14，共 15 步，每步三条向量指令。

逐行：

- 510-518 头注释：明确"唯一剩下的标量工作是固定 15 步的依赖调度 + 16 个对角/偏移项的初始化"，O(block³) 的算术全留 PIPE_V。
- 519-521：`kBlock = 16` 是编译期常量（不模板化，因为 16 是 Mmad/分形的最小尺寸，对角块没必要更大）；`rowBase` 让同一个函数服务 4 个象限（Blocked32 用 0 和 16 两次调用，Blocked64 经 Blocked32 间接用 0/32）。
- 522-523：`inverse` 与 `coefficientBlocks` 借用 `chunkVFp32` 的前两段，各 256 个 FP32（1KB）。
- 524：`column` 借用 `deltaFp32`（容量 `max(alignK_, cs, vStepAligned)` ≥ 64，放得下 15 个元素的列片段）。
- 525：`dotProductFp32.template ReinterpretCast<uint32_t>()`——`Gather` 的偏移表要求 `uint32_t` 张量，而 `dotProductFp32` 是 FP32 缓冲，所以原地 reinterpret 借壳（该缓冲此刻是死的：`DotFp32` 只在慢路径用，见第 04 章 4.11）。
- 527 `Duplicate` 清零 16×16；528-530 V→S 握手（标量接着要 `SetValue` 同一块 UB）。
- 531-534：16 次标量写完成两件事——把 `inverse` 铺成单位阵 I（532，对角 16 个点）；把行字节间距写进偏移表（533：`i*ld*sizeof(float)`，**单位是字节**）。
- 535-537：S→V 握手。
- 头注释说的"16 diagonal/offset entries"= 531-534 这 32 个标量写；"fixed 15-step dependency schedule"= 下面 539 循环的固定 15 次迭代——这两句是作者对"还剩多少标量工作"的精确记账。

### 5.7.2 三条向量指令完成一步外积

锚点：chunk_gated_delta_rule.h:539-555

```cpp
    for (uint32_t k = 0; k + 1 < kBlock; ++k) {
      uint32_t validRows = kBlock - k - 1;
      Gather(column, buf[(rowBase + k + 1) * ld + rowBase + k], gatherOffsets, static_cast<uint32_t>(0), validRows);
      PipeBarrier<PIPE_V>();
      uint8_t brcbRepeats = static_cast<uint8_t>(Ceil(validRows, FP32_NUM_PER_BLOCK));
      Brcb(coefficientBlocks, column, brcbRepeats, BrcbRepeatParams{1, 8});
      PipeBarrier<PIPE_V>();
      MulAddDst(inverse[(k + 1) * kBlock], coefficientBlocks, inverse[k * kBlock], k + 1,
                static_cast<uint8_t>(validRows), BinaryRepeatParams{1, 0, 1, kBlock / FP32_NUM_PER_BLOCK, 1, 0});
      PipeBarrier<PIPE_V>();
    }

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(buf[(rowBase + row) * ld + rowBase], inverse[row * kBlock], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
  }
```

- 539-540：k 从 0 到 14（`k+1 < 16`）；`validRows = 16-k-1` 是"待更新的行数"（第 k 步之后还有 k+1..15 行要吃到 U[k,:] 的贡献）。
- 541 **Gather = 向量查表跨行抽列**：`Gather(dst, src, offsets, base, count)` 的 `dst[i] = *( (char*)&src[0] + offsets[i] + base )`，`offsets[i] = i*ld*sizeof(float)` 是字节偏移，`base` 取 0，`count = validRows`。源指针 `buf[(rowBase+k+1)*ld + rowBase + k]` 是元素 `A[k+1, k]` 的地址，于是 `column[i] = A[k+1+i, k]`——**一条向量指令把 !1108 里那个 `deltaFp32.SetValue(k, buf.GetValue(i*ld+k))` 标量循环（O(16²) 次标量 UB 读）换掉了**。
- 542：`PipeBarrier<PIPE_V>` 让 `column` 对下一步可见（同管内的生产者-消费者，V 管乱序/流水深度要求显式排空）。
- 543-544 **Brcb = 标量 → 32B 广播块**：`brcbRepeats = Ceil(validRows, 8)`（`FP32_NUM_PER_BLOCK = 8`，即每 8 个 FP32 一个重复单元），`BrcbRepeatParams{1, 8}` 让每个 `column[i]` 展开成 8 路连续 FP32 的 32B 块。产物 `coefficientBlocks` 的形状就是"第 i 行的系数在该行的每个 32B 块上重复 8 次"——这样下一步的按块乘法才能把"一个标量系数"作用到一整行上。
- 545：再一次 V 管排空。
- 546-547 **MulAddDst = 带跨行步进的一条"乘了加回去"**：`dst` 起点 `inverse[(k+1)*16]`（要更新的 U 第 k+1 行起）、`src1 = coefficientBlocks`（每行的系数块）、`src2 = inverse[k*16]`（被乘的 U 第 k 行）；`k+1` 与 `validRows` 这一对参数编码"从第 k+1 行开始、共 validRows 行"（外层 k 从 0 到 14 ⇒ 更新区间正好是 [k+1, 16)）；`BinaryRepeatParams{1, 0, 1, kBlock/8=2, 1, 0}` 描述 dst/src1/src2 三路在重复之间的步进——其中 `2` 是"一整行 16 个 FP32 = 64B = 2 个 32B 块"，用来让被乘的 `src2` 行与逐行前进的 `dst` 行各自落在正确偏移上。**一条指令完成 !1108 的 O(k) 条 `Axpy`**。该结构体的字段级命名以本机 CANN 头文件为准，本处取值可由"每次重复前进一整行"这个约束唯一确定。
- 548：同管排空，保证下一步读取的是本轮结果。
- 551-553 **写回 buf**：`Muls(dst, src, 1.0f, 16)` 是这套代码里"UB→UB 整行拷贝"的标准写法——UB 之间不能用 `DataCopy`（它的两端必须有一端是 GM），于是用乘 1.0 的向量指令搬运，同时兼作把结果落到 V 管可见的地址。每行 16 个 FP32 = 64B = 2 个块，一条指令发射；16 行共 16 条。
- 554：收尾 `PipeBarrier<PIPE_V>()`。
- 555：函数结束。整个对角块的标量访存只剩 531-534 的 32 个 `SetValue`。

## 5.8 32 层：两个 16 对角块 + 两次 16³ Cube（557-586）

锚点：chunk_gated_delta_rule.h:557-586

```cpp
  __aicore__ inline void ComputeRecursiveAttnBlocked32(LocalTensor<float> &buf, uint32_t rowBase, uint32_t ld) {
    constexpr uint32_t kBlock = 16;
    constexpr uint32_t kMatrixElements = kBlock * kBlock;
    ComputeRecursiveAttnDiagonalBlock(buf, rowBase, ld);
    ComputeRecursiveAttnDiagonalBlock(buf, rowBase + kBlock, ld);

    LocalTensor<float> srcA = chunkVFp32;
    LocalTensor<float> srcB = chunkVFp32[kMatrixElements];
    LocalTensor<float> residualA = chunkVFp32[2 * kMatrixElements];
    LocalTensor<float> residualB = chunkVFp32[3 * kMatrixElements];
    LocalTensor<float> product = chunkVFp32[4 * kMatrixElements];

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(srcA[row * kBlock], buf[(rowBase + kBlock + row) * ld + rowBase], 1.0f, kBlock);
      Muls(srcB[row * kBlock], buf[(rowBase + row) * ld + rowBase], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
    MatmulBlockFp32Compensated<kBlock>(srcA, srcB, residualA, residualB, product);

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(srcA[row * kBlock], buf[(rowBase + kBlock + row) * ld + rowBase + kBlock], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
    MatmulBlockFp32Compensated<kBlock>(srcA, product, residualA, residualB, product);

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(buf[(rowBase + kBlock + row) * ld + rowBase], product[row * kBlock], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
  }
```

**2×2 块分解**（本层的 `ld` 是 64 矩阵的行距，块尺寸 16）：

```
U00 = (I - A00)^-1   ← 560 对角块（rowBase 起）        U11 = (I - A11)^-1  ← 561 对角块（rowBase+16 起）
U10 = U11 · A10 · U00                                  ← 569-584 两次 Cube 乘
```

- 557：形参 `rowBase` 让本函数可解任意 32×32 子块（Blocked64 用 0 与 32 各调一次）。
- 558-559：**`kBlock = 16`** ——所以本层的两发 Mmad 是 **16×16×16**，即单个分形，Mmad 的最小形状。
- 560-561：先做两个对角块（纯向量管）。对角块之间**没有**数据依赖（A00、A11 互不相干），顺序执行只为省事。
- 563-567：五段 scratch，每段 256 个 FP32 → 合计 1280 个 FP32（5KB）。`chunkVFp32` 容量 `64 * vStepAligned_ ≥ 4096`，本层永远够用（门槛问题只在 64 层出现，见 5.10）。
- 569-572：把 `A10 = buf[(rowBase+16+row)*ld + rowBase]` 和 `U00 = buf[(rowBase+row)*ld + rowBase]` 两个 16×16 块**逐行 ×1.0 拷进 scratch**（同 5.6 的理由：UB→UB 只能靠向量指令；且 Cube 要求操作数是紧凑的 `kBlock×kBlock` 连续块，不能带 `ld=64` 的行距）。
- 573 `PipeBarrier<PIPE_V>`：源块备齐才允许 `StageHalfWithResidual` 的 Cast 读它们。
- 574：第一次乘积 = `A10 · U00`，结果进 `product`。
- 576-578：把 `srcA` 换成 `U11 = buf[(rowBase+16+row)*ld + rowBase+16]`（注意 `+ kBlock` 的列偏移）。`srcB` 不用再动——它就留在 `product` 里。
- 580：第二次乘积 = `U11 · product`，**dst 与 srcB 同为 `product`**。这安全的原因是：`StageHalfWithResidual(srcB, ...)`（471）已经把 srcB 的全部内容搬到 GM，读回时才写 `dst`（505），二者之间隔着整段 Cube 计算；而且 `cNz` 用的是 `residualA` 而不是 `product`（495），写回路径与读回路径不重叠。
- 582-584：`U10` 写回 buf 的左下象限。
- 585-586：`PipeBarrier<PIPE_V>` + 收尾。注意**右下象限 `U11` 与左上 `U00` 原样留在 buf 里**，本层只补 `U10`——这正是 2×2 块下三角逆的形状。

## 5.9 64 层：一次解出 64×64（588-622）

锚点：chunk_gated_delta_rule.h:588-622

```cpp
  // For a 64x64 strict-lower A, invert I-A with a 2x2 block factorization:
  //   U00=(I-A00)^-1, U11=(I-A11)^-1,
  //   U10=U11*A10*U00.
  // The diagonal solves remain FP32 Vector recurrences; compensated Cube
  // products handle the dense cross block without weakening FP32 stability.
  __aicore__ inline void ComputeRecursiveAttnBlocked64(LocalTensor<float> &buf, uint32_t ld) {
    constexpr uint32_t kBlock = 32;
    constexpr uint32_t kMatrixElements = kBlock * kBlock;
    ComputeRecursiveAttnBlocked32(buf, 0, ld);
    ComputeRecursiveAttnBlocked32(buf, kBlock, ld);

    LocalTensor<float> srcA = chunkVFp32;
    LocalTensor<float> srcB = chunkVFp32[kMatrixElements];
    LocalTensor<float> residualA = chunkVFp32[2 * kMatrixElements];
    LocalTensor<float> residualB = chunkVFp32[3 * kMatrixElements];
    LocalTensor<float> product = chunkVFp32[4 * kMatrixElements];

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(srcA[row * kBlock], buf[(row + kBlock) * ld], 1.0f, kBlock);
      Muls(srcB[row * kBlock], buf[row * ld], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
    MatmulBlockFp32Compensated<kBlock>(srcA, srcB, residualA, residualB, product);

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(srcA[row * kBlock], buf[(row + kBlock) * ld + kBlock], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
    MatmulBlockFp32Compensated<kBlock>(srcA, product, residualA, residualB, product);

    for (uint32_t row = 0; row < kBlock; ++row) {
      Muls(buf[(row + kBlock) * ld], product[row * kBlock], 1.0f, kBlock);
    }
    PipeBarrier<PIPE_V>();
  }
```

结构与 5.8 同构，四处差别：

1. 588-592 头注释把公式写全：`U00=(I-A00)^-1`、`U11=(I-A11)^-1`、`U10=U11*A10*U00`，并声明设计姿态——"对角块的解仍然是 FP32 向量递推，补偿 Cube 只吃稠密跨块，不拿 FP32 稳定性换速度"。
2. 594 `kBlock = 32`：本层的两发 Mmad 是 **32×32×32**（各 8 个 16³ 单元），595 `kMatrixElements = 1024`。
3. 596-597：两次 `Blocked32`（`rowBase = 0` 与 `32`）各自还要在内部做两发 16³，所以**整个 64×64 递归解一共发 4 次补偿乘积 = 16 发 Mmad**，外加 4 个 16×16 对角块的向量管递推。
4. 599-603 scratch 变成 5 段 1024 个 FP32 = **5120 个 FP32（20KB）**，这是本函数对 `chunkVFp32` 的硬性容量要求；605-621 的搬运次数也从 16 行变成 32 行（每次 `Muls` 搬 32 个 FP32 = 128B = 4 块）。

结合顺序：先 `A10·U00`（610，k=32、m=32、n=32），再 `U11·(A10·U00)`（616）。为什么不做成一次 `U11·A10·U00` 的 32×64×32 大乘：`docs/.../01-Cube化深度精读.md` §3.2 明确说这是**缓冲设计选择而不是 L0C 容量限制**（32×64 FP32 才 8KB），分块能复用同一组 5 段 UB scratch，并保留与对角块递推的重叠窗口。

## 5.10 dispatch：什么条件走分块、什么条件退回 Axpy（624-652）

锚点：chunk_gated_delta_rule.h:624-652

```cpp
  // Compute recursive intra-chunk attn matrix in-place.
  // buf is stored with leading dimension ld (= chunkSize_), and only [chunkLen, chunkLen] is valid.
  // buf is lower-triangular (excluding diagonal), with upper tri (incl diagonal) = 0.
  __aicore__ inline void ComputeRecursiveAttn(LocalTensor<float> &buf, uint32_t chunkLen, uint32_t ld) {
    constexpr uint32_t kBlockedScratchMinV = (kSpecializedDk == 0) ? 128 : kSpecializedDk;
    if (likely(chunkLen == 64 && ld == 64 && vStepAligned_ >= kBlockedScratchMinV)) {
      ComputeRecursiveAttnBlocked64(buf, ld);
      return;
    }
    for (uint32_t i = 1; i < chunkLen; i++) {
      for (uint32_t k = 0; k < i; k++) {
        deltaFp32.SetValue(k, buf.GetValue(i * ld + k));
      }
      LocalTensor<float> outRow = buf[i * ld];
      // For each k, update the prefix j<k in one vector operation:
      // out[j] += original_row[k] * recursive_row_k[j].
      // For every j this visits k=j+1..i-1 in the same order as the scalar
      // recurrence, while element k itself remains untouched.
      for (uint32_t k = 1; k < i; k++) {
        float coeff = deltaFp32.GetValue(k);
        Axpy(outRow, buf[k * ld], coeff, k);
        PipeBarrier<PIPE_V>();
      }
    }
    TQueSync<PIPE_V, PIPE_S> recursiveSync;
    recursiveSync.SetFlag(0);
    recursiveSync.WaitFlag(0);
  }
```

**628 行的 constexpr 是本章最能看出"泛化"痕迹的一行**：

| 快照 | 表达式 | 效果 |
|---|---|---|
| `a9c66ddb:560` | `(kSpecializedDk == 80) ? 80 : 128` | 只有 80 桶的门槛是 80，其余（64/96/128）一律要 128 |
| `d0906c3e:628` | `(kSpecializedDk == 0) ? 128 : kSpecializedDk` | 门槛 = 桶宽本身；generic 实例保守取 128 |

也就是"从枚举特例变成 `桶宽` 策略"，与第 04 章 4.5 节 `IsCubeFastPath` 的折叠是同一次重构（725cf45d）的产物。

**629 三个条件，逐个是"值不值"的判断**：

- `chunkLen == 64 && ld == 64`：分块实现把 16/32/64 三个尺寸全部写死成编译期常量（519-521、558、594），尾块 `chunkLen<64` 不进分块（与 `IsCubeFastPath` 同一立场）。
- `vStepAligned_ >= kBlockedScratchMinV`：**这就是"能不能借到缓冲"**。64 层要 5120 个 FP32，而 `chunkVFp32` 的容量是 `64 × vStepAligned_`（InitLocalBuffers:170）。`vStep` 太小就借不到，于是退回 !1108 的 Axpy 递推——`docs/.../01-Cube化深度精读.md` §3.2 把这称为"借缓冲的收益（快）和代价（占 UB）在这里直接换算成条件分支"。
- `likely(...)`：分块是主路径，标量递推是兜底。
- 630-631：调用后 `return`，快路径不再经过下面的循环。

**633-651 的 fallback 与 !1108 的差别**（`src/00e39ab5/...:317-337`）：循环体逐字节相同，只少了 !1108 每行的一对

```cpp
      TQueSync<PIPE_S, PIPE_V> rowSync;
      rowSync.SetFlag(0);
      rowSync.WaitFlag(0);
```

!1135 初版（`a9c66ddb:559` 起）就已删掉它，理由（推断，未见于 docs）：标量写 `deltaFp32` 后紧接的只有标量读（`coeff = deltaFp32.GetValue(k)`），S 管自身有序；而 `Axpy` 读的是 `buf`，与 `deltaFp32` 不别名，S→V 方向的握手在每行位置上不再必要。函数末尾那对 `TQueSync<PIPE_V, PIPE_S> recursiveSync`（648-650）保留——最后一行的向量写必须对齐管才有人读 `buf`。
`Axpy(outRow, buf[k*ld], coeff, k)` 的语义：`outRow[j] += coeff * src[j]`，从下标 `k` 开始、长度 `k`（即只更新 `j<k` 的前缀）——与递推式的依赖范围一致，这也是注释 638-641 说明的"访问顺序与标量递推完全相同、下标 k 本身不动"。

## 5.11 WriteAttnTileToGm：与 !1108 逐字节相同（653-685）

锚点：chunk_gated_delta_rule.h:653-685

```cpp
  __aicore__ inline void WriteAttnTileToGm(int32_t t_start, uint32_t chunkLen, uint64_t head_i, uint32_t v_i,
                                           uint32_t curV, uint32_t avFp32) {
    uint32_t totalElem = chunkLen * avFp32;
    uint32_t alignedElem = Ceil(totalElem, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
    Muls(chunkAttnOutFp32, chunkAttnOutFp32, 1.0f, alignedElem);
    PipeBarrier<PIPE_V>();
    LocalTensor<outType> outLocal = stateOutQueue_.AllocTensor<outType>();
    Cast(outLocal, chunkAttnOutFp32, RoundMode::CAST_NONE, alignedElem);
    PipeBarrier<PIPE_V>();
    stateOutQueue_.EnQue<outType>(outLocal);
    outLocal = stateOutQueue_.DeQue<outType>();
    constexpr uint32_t outElemPerBlock = BLOCK_BYTES / sizeof(outType);
    uint64_t gmRowStride = static_cast<uint64_t>(NV_) * realV_;
    bool canUse2DStore = curV % outElemPerBlock == 0 && avFp32 % outElemPerBlock == 0 &&
                         gmRowStride % outElemPerBlock == 0 && (avFp32 - curV) / outElemPerBlock <= UINT16_MAX &&
                         (gmRowStride - curV) / outElemPerBlock <= UINT16_MAX;
    uint64_t outOff = (static_cast<uint64_t>(t_start) * NV_ + head_i) * realV_ + v_i;
    if (likely(canUse2DStore)) {
      DataCopyParams outParams{static_cast<uint16_t>(chunkLen), static_cast<uint16_t>(curV / outElemPerBlock),
                               static_cast<uint16_t>((avFp32 - curV) / outElemPerBlock),
                               static_cast<uint16_t>((gmRowStride - curV) / outElemPerBlock)};
      DataCopy(attnOutGm_[outOff], outLocal, outParams);
    } else {
      for (uint32_t i = 0; i < chunkLen; i++) {
        uint64_t rowOff = (static_cast<uint64_t>(t_start + i) * NV_ + head_i) * realV_ + v_i;
        DataCopyExtParams outParams{1, static_cast<uint32_t>(curV * sizeof(outType)), 0, 0, 0};
        CopyToGm(attnOutGm_[rowOff], outLocal[i * avFp32], outParams);
        PipeBarrier<PIPE_MTE3>();
      }
    }
    stateOutQueue_.FreeTensor(outLocal);
  }
```

## 5.12 五件套总表

锚点：chunk_gated_delta_rule.h:415-508（本表只汇总前文已锚定的行，不引入新区间）

| 件 | 函数/行 | 机器动作 | 管道 | 事件栅栏 |
|---|---|---|---|---|
| ① 装载 A/B：GM→L1 且 ND→NZ | 418 / 430 `DataCopy(..., Nd2NzParams)` | 512B 分形重排后写入 L1 的 A1/B1 区 | MTE2 | `MTE2_MTE1`（419-420 / 431-432） |
| ② L1→L0 | 421-424 / 433-436 `LoadData(..., LoadData2DParams)` | 每次搬一个 16 行 × kBlock 列的行带进 L0A/L0B | MTE1 | 复用 ①③ 的栅栏 |
| ③ 配置 Mmad | 444 `MmadParams{kBlock,kBlock,kBlock,0,false,init}` | m=n=k，`init` 决定 L0C 清零/续加 | — | `MTE1_M`（442-443） |
| ④ 发 Mmad | 444（同调） | 硬件拆成 `(m/16)(n/16)(k/16)` 个 16³ 单元，FP32 累加进 CO1 | M | `M_MTE1`（445-446） |
| ⑤ L0C→UB 读回 | 496-506 | 先按分形连续搬到 UB（仍是 NZ），再逐行 strided `DataCopy` 拼成 ND | MTE2/PIPE_ALL | 终态缺 M/V 双向栅栏（!1174 补，见 5.6.5） |
| （前置）FP32→FP16 hi/lo | 470-471 `StageHalfWithResidual` | Cast/Sub/Cast + 两趟 MTE3 出 GM | V + MTE3 | `PipeBarrier<PIPE_ALL>`（472） |
| （借道）GM 暂存 | 458 `GetCubeStageBase(0)` | slot0 内 4 段（0/2048/4096/6144B，kBlock=32） | — | 见第 04 章 4.4 |