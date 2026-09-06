---
title: HGEMM (CuTe)
order: 19
---

# HGEMM CuTe 版代码学习

> 本人学习笔记，AI总结

10 篇用 CuTe 重写过转置（性能持平手写），当时的结论是"CuTe 抽象掉下标体操"。17/18 篇把手写 MMA 推到 155 TFLOPS 后，本篇用 CuTe 把**同一套优化**（mma atom 分形、smem swizzle、多级流水、block swizzle）重新表达一遍——这次 CuTe 不是"持平"，是**反超**：

| 形状 | 手写 MMA（17/18 篇最优） | **CuTe 版** | 差距 |
|---|---|---|---|
| 2048³ | 130.8 | 152.0 | **+16%** |
| 4096³ | 149.7 | 258.1 | **+73%** |
| 8192³ | 154.7 | **296.6** | **+92%** |
| 12288³ | 150.0 | 290.0 | +93% |
| 16384³ | 155.0 | 286.9 | +85% |

296.6 TFLOPS 是 4090 FP16 峰值（~330 TFLOPS F16 acc 理论）的 **90%**。反超的关键不是"DSL 更快"（编译出来都是同样的 PTX），而是 **tile 可以开更大**：手写版 BM=BN=128 × stage2 已经把 96KB smem 和 256 线程的寄存器排满了；CuTe 版 BN=256、BK=32、LDMATRIX 更宽的 x4 复用——它用类型系统替你管住了更大的布局复杂度。本篇回答：**CuTe 到底"管住了"什么**。

（诚实声明：CuTe 版仍用 f16 acc（`SM80_16x8x16_F16F16F16F16_TN`），和手写版同精度档位，对比公平。）

## 第 1 步：layout 一步到位——类型里长出来的 tile

手写版（17 篇）的 tile 尺寸靠三族模板参数连乘（BM=MMA_M×MMA_TILE_M×WARP_TILE_M），smem 声明、装载映射、ldmatrix 地址全是手推。CuTe 版把 tile **声明**出来：

```c++
auto BM = Int<128>{};
auto BN = Int<256>{};   // ← 手写版的两倍宽
auto BK = Int<32>{};
auto KStage = Int<2>{};

using SmemLayoutAtom = decltype(composition(
    Swizzle<3, 3, 3>{}, make_layout(make_shape(Int<8>{}, Int<BK>{}),
                                    make_stride(Int<BK>{}, Int<1>{}))));
using SmemLayoutA = decltype(tile_to_shape(
    SmemLayoutAtom{}, make_shape(Int<BM>{}, Int<BK>{}, Int<KStage>{})));
```

三行浓缩了 18 篇的全部手工推导：`composition(Swizzle<3,3,3>, layout)` 就是 18 篇那个 `((j>>3)^(i>>2))` 位异或的**代数化**（B=3 位、M=3 位起点、S=3 位步长——8×16 half 的 atom 恰好 1024 字节，源码注释：`(2^3)*(2^3)*(2^3)=512 values=1024 bytes`）；`tile_to_shape` 把 atom 平铺到 BM×BK×stage——**swizzle 的粒度、smem 的三维（含流水级）全部在类型里**，不用在装载循环里逐地址换算。

**这 3 个声明是一条流水线，不是 3 个独立操作**——按"做出什么"顺序读:

1. **`Int<128>{}` 等**——把数字升级成**编译期类型**（`Int<N>` 是 `cute::Int<N>{}` 的 C++ 模板包装），好处是 `make_layout(Int<8>{}, ...)` 的所有运算**编译期算完**, 0 运行时开销
2. **`make_layout(make_shape(...), make_stride(...))`**——造出 8×16 的 smem atom, **底层是 (Shape, Stride) 二元组**; 你可以理解成 09 篇的 `s_a[BM][BK]` 但 Stride 自动算出 (8 行 × stride 16, 16 列 × stride 1)
3. **`composition(Swizzle<3,3,3>{}, layout)`**——把 Swizzle **套在** 上面那个 layout 上, 18 篇那个位异或现在就是这里的一个代数对象; **关键: composition 不复制数据, 只生成"用 Swizzle 算地址"的视图**——这是 10 篇转置"composition 是视图套视图"的复用
4. **`tile_to_shape(atom, make_shape(BM, BK, KStage))`**——把 8×16 的 atom 平铺到 128×32×2 的三维 smem 块, **swizzle 自动跟着平铺**; KStage=2 这一维是流水线级 (15/17 篇 dbuf 的 cp.async 流水用)

**结果**——下游 `make_tensor(make_smem_ptr(Ashm), SmemLayoutA{})` 拿到的是一个**类型**, 后面所有 gmem→smem、smem→reg、smem→gmem 的 copy 都从这个类型构造, swizzle 自动继承 (18 篇"写端读端都要插函数"的侵入负担, 类型系统消化了)

10 篇讲过 composition 是"视图套视图"，当时只用于转置的读写两端。这里的用法升级：**swizzle 进了 layout 类型，后续所有 copy 对象都从这个类型构造**——装载、计算、回写全自动继承 swizzle 后的地址换算，18 篇"写端读端都要插同一个函数"的侵入式负担，在类型系统里消失。

## 第 2 步：TiledMMA——分形结构的类型化

17 篇的分形（Block→Warp→MMA→atom）靠常量连乘+人工映射。CuTe 的表达：

```c++
using mma_op = SM80_16x8x16_F16F16F16F16_TN;    // 硬件 atom: 还是 m16n8k16!
using mma_atom = MMA_Atom<MMA_Traits<mma_op>>;
// 每 warp 重复 2x2 (M×N), 不沿 K 重复
using MMA_EU_RepeatT = decltype(make_layout(make_shape(Int<32>{}, Int<32>{}), ...));
// 4 warp 拼成 32x32; 再 tile 到 block 级
using MMA = decltype(make_tiled_mma(mma_atom{}, MMA_EU_RepeatT{}, MMA_P_T{}));
```

对照表（17 篇的手工数字 → CuTe 的类型）：

| 手写（17 篇） | CuTe |
|---|---|
| `MMA_M=16, MMA_N=8, MMA_K=16` 硬编码宏 | `mma_op` 类型 |
| `MMA_TILE_M/N=2/4, WARP_TILE_M/N=4/4` 连乘 | `MMA_EU_RepeatT`（warp 内重复）+ `MMA_P_T`（warp 间拼图） |
| 手推 ldmatrix 的 lane↔smem 映射 | `thr_mma.partition_A/B/C` 自动给出 |

**`SM80_16x8x16_F16F16F16F16_TN` 名字怎么读**（名字自带全部信息, 不神秘）——拆 4 段:

- `SM80` = sm_80 起的硬件指令 (4090 sm_89 向后兼容, 所以能用)
- `16x8x16` = m × n × k = 一次 mma.sync 算的尺寸 (和 17 篇 HMMA16816 一样)
- `F16.F16.F16.F16` = 4 个尾缀分别对应 **A 类型 / B 类型 / 累加器入参 / 累加器出参**——和 17 篇 PTX `mma.sync.aligned.m16n8k16.row.col.f16.f16.f16.f16` 是一一对应的 4 个 f16
- `_TN` = 和 17 篇 `mma_tn` 含义相同

**关键收益**：`thr_mma.partition_fragment_C(gD)` 直接给每个线程算好"我负责 C 的哪些 fragment"——17 篇手写 `RC[4][4][2]` 的布局和收尾 shuffle（322~358 行那 30 行手工体操），这里一行 `tCrD = thr_mma.partition_fragment_C(gD)` 拿到，且**和 ldmatrix/copy atom 的布局自动对齐**（atom 间布局契约由 traits 保证，不靠人肉保证）。这就是 BN 能开到 256 的底气：布局维度翻倍后，手写的地址推导量平方增长，类型的推导量不变。

**`MMA_EU_RepeatT` 和 `MMA_P_T` 怎么算**（拆数字账, 17 篇的手算对应到这里的类型参数）——源码 L380-396 注释原文:

```c++
static constexpr int kMmaEURepeatM = 2;  // MMA repeat 2 times across M
static constexpr int kMmaEURepeatN = 2;  // MMA repeat 2 times across N
static constexpr int kMmaEURepeatK = 1;  // MMA no repeat across K
// 1*2*16=32  kMmaPM = 1 * kMmaEURepeatM * get<0>(mma_atom_shape{})
// 2*2*8=32   kMmaPN = 2 * kMmaEURepeatN * get<1>(mma_atom_shape{})
// 1*1*16=16  kMmaPK = 1 * kMmaEURepeatK * get<2>(mma_atom_shape{})
```

`MMA_EU_RepeatT = Layout<2,2,1>` 是 **"warp 内沿 m/n 各重复 2 次, k 重复 1 次"**——一个 warp 算 2×2 个 m16n8 , 对比 17 篇的 1×1 atom , 这里是更"宽"的 warp tile (输出多了 1.5x).

`MMA_P_T = Tile<32, 32, 16>` = **"warp 间拼图"**——4 个 warp (32 threads × 4 = 128) 在 m/n 维各拼 32×32, 沿 k 不扩展, 完整 tile 64×32×16 = 1 个 mma.sync × 4 次重复 (k=16 是 mma atom 一次能吃的 K). 

## 第 3 步：copy 的三段式——和手写版逐环节对上

主循环（g2s → s2r → mma）逐环节对照 17 篇：

| 环节 | 手写（17 篇） | CuTe |
|---|---|---|
| global→smem | `CP_ASYNC_CG` 宏 + 手推 smem 地址（含 18 篇 swizzle 换算） | `SM80_CP_ASYNC_CACHEGLOBAL<uint128_t>` copy atom + `make_tiled_copy` + `partition_src/partition_dst` |
| smem→reg | `LDMATRIX_X4/X2` + 手推 lane 映射 | `thr_mma.make_fragment_A(sA)`（直接从 swizzle layout 构造，mma atom 配套的 copy 链路） |
| 计算 | `HMMA16816` 宏循环 | `cute::gemm(tiled_mma, tCrA, tCrB, tCrD)` |
| 回写 | 30 行 `__shfl_sync` 收尾体操 | copy atom（`SM80_16x8x8_32x32x8_...` 的 store 分解）自动 coalesce |

**`cute::gemm(tiled_mma, ...)` 是全篇的点睛**——它不是"调用库"，是把 17 篇手写的三层 unroll 循环（K 块 × warp tile × mma tile）**编译期展开**：tiled_mma 的类型里带着全部重复结构，gemm 函数沿布局走一遍，生成的指令流和手写 unroll 相同。10 篇说"CuTe 抽象掉下标体操"，在 GEMM 这里兑现成：**17 篇的 400 行 kernel 缩成约 200 行，且每个环节的优化（128bit copy、swizzle、多 stage）都还在**——不是黑盒换白盒，是声明换推导。

**打开源码**（`<details>` 里的 `hgemm_mma_stage_tn_cute.cu`），主循环 L248-293 是 CuTe 版的"流水"——**和 17 篇 dbuf 三段式一一对照**, 每个 `cute::copy` 都有手写版对应:

```c++
// PREFETCH 阶段 (L232-241): 预载 kStage-1 块, 走 g2s copy atom
for (int istage = 0; istage < kStage - 1; ++istage) {
  cute::copy(g2s_tiled_copy_a, tAgA_copy(_, _, _, istage),
             tAsA_copy(_, _, _, istage));
  cute::copy(g2s_tiled_copy_b, tBgB_copy(_, _, _, istage),
             tBsB_copy(_, _, _, istage));
  cp_async_fence();
  ...
}
cp_async_wait<kStage - 2>();  // 等 kStage-2 组, 留 1 组在路上
__syncthreads();

// 主循环 (L256-293): 4 段嵌套按 dbuf 模板走
for (int itile = 0; itile < ntile; ++itile) {       // K 块外层
  for (int ik = 0; ik < nk; ++ik) {                 // K 块内 mma 重复
    // ① ik=0 发起下一个 g2s (预载, 不等)
    if (ik == 0) { ... cp_async_fence(); }
    // ② ik=last 时等当前 g2s 完成
    if (ik == nk - 1) { cp_async_wait<kStage-2>(); __syncthreads(); ... }
    // ③ 装下一片 K 到 reg
    cute::copy(s2r_tiled_copy_a, tAsA(_, _, ik_next, ismem_read), tCrA_view(_, _, ik_next));
    cute::copy(s2r_tiled_copy_b, tBsB(_, _, ik_next, ismem_read), tCrB_view(_, _, ik_next));
    // ④ 算当前 ik 的 mma
    cute::gemm(tiled_mma, tCrD, tCrA(_, _, ik), tCrB(_, _, ik), tCrD);
  }
}
```

**和 17 篇的逐行对照**——4 个 `cute::copy/gemm` 对应 17 篇的 4 步:

| CuTe 源码 | 17 篇手写 | 含义 |
|---|---|---|
| `cute::copy(g2s_tiled_copy_a, tAgA, tAsA)` | `CP_ASYNC_CG(smem, gmem, 16)` | gmem → smem |
| `cute::copy(s2r_tiled_copy_a, tAsA, tCrA_view)` | `LDMATRIX_X4(RA, smem)` | smem → reg, 装成 mma 期望布局 |
| `cute::gemm(tiled_mma, tCrD, tCrA, tCrB, tCrD)` | `HMMA16816(RC, RA, RB, RC)` | mma 算, **tCrD 是 in-out accum** |
| 收尾 `cute::copy(r2s_tiled_copy_c, t, tCsC_r2s)` + `s2g_tiled_copy_c` | `__shfl_sync` + `LDST128BITS` | reg → smem → gmem (R2S + S2G 两段, C 的 smem 复用 A 的) |

**关键观察**——17 篇要 4 个独立的原子宏 (CP_ASYNC_CG, LDMATRIX_X4, HMMA16816, LDST128BITS) 加 30 行 shfl 收尾; CuTe 版每个环节**只有 1 个 `cute::copy(atom, src, dst)`**——atom 是什么 (CP_ASYNC / LDSM / mma / UniversalCopy) 编译器看参数类型知道, 你不用选指令. **这是"声明换推导"的兑现**——你写的是"我想把 A 从这里搬到那里", 编译器生成具体 PTX.

## 第 4 步：block swizzle——L2 层的调度重排（补 15 篇的欠账）

15 篇 WMMA 版提过 block swizzle（实测 +7%）但没展开，这里补齐（CuTe 版也开了，2048）。

问题：默认 grid 调度下，同一行（by 固定）的 block 沿 bx 依次执行——它们都要读 **A 的同一行块**；等到下一行才换 A 块。A 的行块很大（128×K），L2（72MB）装不下几行 × 全宽的 B。

```
默认执行顺序 (by 优先):          swizzle 后 (bx 优先, stride=2048 列):
bx0 bx1 bx2 ... bx63            bx0 bx1 ... bx15   ← 先把一行 B 块(2048 列)打完
bx0 bx1 bx2 ... bx63  (by=1)    bx16 ... bx31      (换下一段 B, A 行全在 L2)
...                             ...
```

swizzle 后**同时驻留的 block 全在读同一批 A 行块**（128 行 × K 的一半宽度），A 留在 L2；B 沿列轮换也保持局部性。实现一行：`ix = blockIdx.z * gridDim.x + blockIdx.x`（grid 加一维 z 当"组号"）——15 篇 sgemm WMMA 版同一个公式。**它是调度层优化**：kernel 内计算不变，改的是"哪些 block 倾向于同时跑"。

**`swizzle_stride = 2048` 的数字账**（为什么是 2048 不是 1024 不是 4096）——源码 L548 写死:

```
BN = 256
stride = 2048 = 8 × BN = "N 维每 8 个 block 分一组"
```

- **8 这个数** = 一次同时驻留 SM 的 block 数 × 资源约束估算. 4090 的 128 SM × 每 SM 跑 ~2 block ≈ 250 block 同时在飞, **N 维方向 250 ÷ 32 (M 维) ≈ 8**. 选 8 让"同一组的 8 个 block 沿 N 切"大约是 1 个 wave 的规模——A 在 L2 留住的窗口约 1 个 wave 长度
- **2048 = 8 × 256** 是 N 维覆盖范围, 8192³ 时 bx=32, 分 4 组 (z 维 0~3), 每组 8 block, 物理意义清晰
- 选 4096 / 1024 也行, 但太小 (单组 block 数不够 1 wave) 或太大 (A 块在 L2 留不住那么久). **这是一个手调参数, 不是数学最优**——CUTLASS 内部有 heuristic 自动选, LeetCUDA 这版写死了 2048

**block swizzle vs bank swizzle (18 篇) 数字量级完全不同**——容易混, 写下来:

| 优化 | 作用层 | 资源容量 | 调度单位 |
|---|---|---|---|
| smem swizzle (18/19 篇) | shared memory | 96KB / block | 32 banks × 4B = 128B |
| block swizzle (15/19 篇) | L2 cache | 72MB 全局 | 2048 列一组 (≈ 256KB A 块) |

block swizzle 是**全局调度**——它在"哪些 block 一起跑"这层干预, 改变的是 L2 的命中率; bank swizzle 是**指令级**——在 smem 装/读地址的位级重排. 一个是"调块儿的顺序", 一个是"调位的顺序", **数字量级差 5 个数量级**.

至此三层 swizzle 集齐（容易混，最终对照）：

| 名字 | 作用层 | 优化对象 | 出现篇 |
|---|---|---|---|
| smem swizzle | shared memory | bank conflict | 10/18/19 |
| block swizzle | L2 cache | block 调度的 L2 局部性 | 15/19 |
| warp swizzle | warp 调度 | （hgemm 高阶版，本系列没跑） | — |

## 第 5 步：296 TFLOPS 的账

CuTe 版为什么能比手写版多 92%？拆开看不是魔法：

1. **BN=256 vs 128**：C tile 面积 ×2，每数据元素的计算密度更高（A 复用 ×2）——但手写版不是"没想到"，是 BN=256 的手排布局复杂度（ldmatrix 映射、smem 分段、收尾 shuffle 全部重来）已经不划算。CuTe 把这个成本压到改一个 `Int<256>`
2. **BK=32 vs 16**：K 块翻倍，流水线轮次减半，cp.async 组间等待更少
3. **LDMATRIX x4 复用**（README 的 swizzle_x4 思路）：更宽的装载指令
4. **类型级布局契约**：partition 系列保证 fragment/copy/mma 三方布局一致，编译器能放心激进调度（手写版的 `volatile asm` 边界会阻断某些重排）

同结构下手写版的天花板其实也一样高（CUTLASS 生成的就是"手写"代码）——**差距的本质是复杂度管理成本**，这正是 10 篇转置结论（小 kernel 手写更直白）在 GEMM 尺度上的反转：**问题越大，layout 代数的杠杆越长**。

## 编译注意

- 需要 cutlass 子模块：仓库 `third-party/cutlass` 是空的（clone 没带 submodule），要 `git submodule update --init` 或镜像源手动 clone（4090 直连 github 走 GnuTLS 经常断，我们用 ghproxy 镜像拉下来了）
- 其余坑与 17 篇相同（nvcc wrapper 全套）

## 完整代码

### `hgemm_mma_stage_tn_cute.cu`
<details>
<summary> hgemm_mma_stage_tn_cute.cu </summary>

```c++
#include <cublas_v2.h>
#include <cuda.h>
#include <cute/tensor.hpp>
#include <float.h>
#include <stdlib.h>

// BlockSwizzle: means apply thread block swizzle across N dim
template <typename T, int BM, int BN, int BK, int kStage, typename TiledMMA,
          typename G2SCopyA, typename G2SCopyB, typename SmemLayoutA,
          typename SmemLayoutB, typename SmemLayoutC, typename S2RCopyAtomA,
          typename S2RCopyAtomB, typename R2SCopyAtomC, typename S2GCopyAtomC,
          typename S2GCopyC, const bool BlockSwizzle>
__global__ void hgemm_mma_stages_block_swizzle_tn_cute_kernel(T *Aptr, T *Bptr,
                                                              T *Dptr, int m,
                                                              int n, int k) {
  using namespace cute;
  // Initilize shared memory
  extern __shared__ T shm_data[];

  T *Ashm = shm_data;
  T *Bshm = shm_data + cute::cosize(SmemLayoutA{});

  // Initilize thread block
  int idx = threadIdx.x;
  // BlockSwizzle 0/1 control use block swizzle or not.
  int ix = ((int)BlockSwizzle) * blockIdx.z * gridDim.x + blockIdx.x;
  int iy = blockIdx.y;

  if (iy * BM >= m || ix * BN >= n)
    return;

  // use Tensor notation to represent device pointer + dimension
  Tensor A = make_tensor(make_gmem_ptr(Aptr), make_shape(m, k),
                         make_stride(k, Int<1>{}));
  Tensor B = make_tensor(make_gmem_ptr(Bptr), make_shape(n, k),
                         make_stride(k, Int<1>{}));
  Tensor D = make_tensor(make_gmem_ptr(Dptr), make_shape(m, n),
                         make_stride(n, Int<1>{}));

  // slice the tensor to small one which is used for current thread block.
  Tensor gA = local_tile(A, make_tile(Int<BM>{}, Int<BK>{}),
                         make_coord(iy, _)); // (BM, BK, num_tile_k)
  Tensor gB = local_tile(B, make_tile(Int<BN>{}, Int<BK>{}),
                         make_coord(ix, _)); // (BN, BK, num_tile_k)
  Tensor gD = local_tile(D, make_tile(Int<BM>{}, Int<BN>{}),
                         make_coord(iy, ix)); // (BM, BN)

  // shared memory
  auto sA = make_tensor(make_smem_ptr(Ashm), SmemLayoutA{}); // (BM, BK, kStage)
  auto sB = make_tensor(make_smem_ptr(Bshm), SmemLayoutB{}); // (BN, BK, kStage)

  // dispatch TileA/TileB/TileC mma tensor into thread fragment via partition
  TiledMMA tiled_mma;
  auto thr_mma = tiled_mma.get_slice(threadIdx.x);
  auto tCgD = thr_mma.partition_C(gD); // (MMA,MMA_M, MMA_N)

  auto tCrA = thr_mma.partition_fragment_A(gA(_, _, 0)); // (MMA, MMA_M, MMA_K)
  auto tCrB = thr_mma.partition_fragment_B(gB(_, _, 0)); // (MMA, MMA_N, MMA_K)
  auto tCrD = thr_mma.partition_fragment_C(gD);          // (MMA, MMA_M, MMA_N)
  clear(tCrD);

  // from global memory to shared memory
  G2SCopyA g2s_tiled_copy_a;
  auto g2s_thr_copy_a = g2s_tiled_copy_a.get_slice(idx);
  auto tAgA_copy =
      g2s_thr_copy_a.partition_S(gA); // (CPY, CPY_M, CPY_K, num_tile_k)
  auto tAsA_copy =
      g2s_thr_copy_a.partition_D(sA); // (CPY, CPY_M, CPY_K, kStage)
#ifdef CUTE_HGEMM_DEBUG
  if (thread0()) {
    print("\npartition_S(tAgA_copy): \n");
    print(tAgA_copy);
    print("\n");
    print("\nThrCopy(g2s_thr_copy_a): \n");
    print(g2s_thr_copy_a);
    print("\n");
  }
#endif

  G2SCopyB g2s_tiled_copy_b;
  auto g2s_thr_copy_b = g2s_tiled_copy_b.get_slice(idx);
  auto tBgB_copy =
      g2s_thr_copy_b.partition_S(gB); // (CPY, CPY_N, CPY_K, num_tile_k)
  auto tBsB_copy =
      g2s_thr_copy_b.partition_D(sB); // (CPY, CPY_N, CPY_K, kStage)

  // from shared memory to register, use tiled_mma to generate tiled_copy
  auto s2r_tiled_copy_a = make_tiled_copy_A(S2RCopyAtomA{}, tiled_mma);
  auto s2r_thr_copy_a = s2r_tiled_copy_a.get_slice(idx);
  auto tAsA = s2r_thr_copy_a.partition_S(sA);     // (CPY, CPY_M, CPY_K, kStage)
  auto tCrA_view = s2r_thr_copy_a.retile_D(tCrA); // (CPY, CPY_M, CPY_K)

  auto s2r_tiled_copy_b = make_tiled_copy_B(S2RCopyAtomB{}, tiled_mma);
  auto s2r_thr_copy_b = s2r_tiled_copy_b.get_slice(idx);
  auto tBsB = s2r_thr_copy_b.partition_S(sB);     // (CPY, CPY_N, CPY_K, kStage)
  auto tCrB_view = s2r_thr_copy_b.retile_D(tCrB); // (CPY, CPY_N, CPY_K)

  /* PREFETCH */
  // submit kStage - 1 tile
  // gmem -> shm
  int itile_to_read = 0;
  int ismem_read = 0;
  int ismem_write = 0;

#pragma unroll
  for (int istage = 0; istage < kStage - 1; ++istage) {
    cute::copy(g2s_tiled_copy_a, tAgA_copy(_, _, _, istage),
               tAsA_copy(_, _, _, istage));
    cute::copy(g2s_tiled_copy_b, tBgB_copy(_, _, _, istage),
               tBsB_copy(_, _, _, istage));
    cp_async_fence();

    ++itile_to_read;
    ++ismem_write;
  }

  // wait one submitted gmem->smem done
  cp_async_wait<kStage - 2>();
  __syncthreads();

  int ik = 0;
  // smem -> reg
  // tAsA: (CPY, CPY_M, CPY_K, kStage) tCrA_view: (CPY, CPY_M, CPY_K)
  cute::copy(s2r_tiled_copy_a, tAsA(_, _, ik, ismem_read), tCrA_view(_, _, ik));
  cute::copy(s2r_tiled_copy_b, tBsB(_, _, ik, ismem_read), tCrB_view(_, _, ik));

  // loop over k: i. load tile, ii. mma
  int ntile = k / BK;
#pragma unroll 1
  for (int itile = 0; itile < ntile; ++itile) {
    int nk = size<2>(tCrA); // (MMA, MMA_M, MMA_K)

#pragma unroll
    for (int ik = 0; ik < nk; ++ik) {
      int ik_next = (ik + 1) % nk;

      if (ik == nk - 1) {
        cp_async_wait<kStage - 2>();
        __syncthreads();

        ismem_read = (ismem_read + 1) % kStage;
      }

      // shm -> reg s[itile][ik + 1] -> r[ik + 1]
      // tAsA: (CPY, CPY_M, CPY_K, kStage), tCrA_view: (CPY, CPY_M, CPY_K)
      cute::copy(s2r_tiled_copy_a, tAsA(_, _, ik_next, ismem_read),
                 tCrA_view(_, _, ik_next));
      // tBsB: (CPY, CPY_M, CPY_K, kStage), tCrB_view: (CPY, CPY_M, CPY_K)
      cute::copy(s2r_tiled_copy_b, tBsB(_, _, ik_next, ismem_read),
                 tCrB_view(_, _, ik_next));

      if (ik == 0) {
        if (itile_to_read < ntile) {
          cute::copy(g2s_tiled_copy_a, tAgA_copy(_, _, _, itile_to_read),
                     tAsA_copy(_, _, _, ismem_write));
          cute::copy(g2s_tiled_copy_b, tBgB_copy(_, _, _, itile_to_read),
                     tBsB_copy(_, _, _, ismem_write));
          ++itile_to_read;
          ismem_write = (ismem_write + 1) % kStage;
        }

        cp_async_fence();
      }

      cute::gemm(tiled_mma, tCrD, tCrA(_, _, ik), tCrB(_, _, ik), tCrD);
    } // for ik
  }

  // use less shared memory as a scratchpad tile to use large wide instuction
  // Dreg -> shm -> reg -> global
  auto sC = make_tensor(sA(_, _, ismem_read).data(), SmemLayoutC{});

  auto r2s_tiled_copy_c = make_tiled_copy_C(R2SCopyAtomC{}, tiled_mma);
  auto r2s_thr_copy_c = r2s_tiled_copy_c.get_slice(idx);
  auto tCrC_r2s = r2s_thr_copy_c.retile_S(tCrD);  // (CPY, CPY_M, CPY_N)
  auto tCsC_r2s = r2s_thr_copy_c.partition_D(sC); // (CPY, _1, _1, pipe)

  S2GCopyC s2g_tiled_copy_c;
  auto s2g_thr_copy_c = s2g_tiled_copy_c.get_thread_slice(idx);
  auto tCsC_s2g = s2g_thr_copy_c.partition_S(sC); // (CPY, _1, _1, pipe)
  auto tCgC_s2g = s2g_thr_copy_c.partition_D(gD); // (CPY, CPY_M, CPY_N)

  auto tCgC_s2gx = group_modes<1, 3>(tCgC_s2g); // (CPY_, CPY_MN)
  auto tCrC_r2sx = group_modes<1, 3>(tCrC_r2s); // (CPY_, CPY_MN)

  int step = size<3>(tCsC_r2s); // pipe
#pragma unroll
  for (int i = 0; i < size<1>(tCrC_r2sx); i += step) {
// reg -> shm
#pragma unroll
    for (int j = 0; j < step; ++j) {
      // we add a temp tensor to cope with accumulator and output data type
      // difference
      auto t = make_tensor_like<T>(tCrC_r2sx(_, i + j));
      cute::copy(tCrC_r2sx(_, i + j), t);

      cute::copy(r2s_tiled_copy_c, t, tCsC_r2s(_, 0, 0, j));
    }
    __syncthreads();

#pragma unroll
    // shm -> global
    for (int j = 0; j < step; ++j) {
      cute::copy(s2g_tiled_copy_c, tCsC_s2g(_, 0, 0, j), tCgC_s2gx(_, i + j));
    }
    __syncthreads();
  } // end for
}

// For torch binding, need dynamic block swizzle stride
template <typename T, const int Stages = 2, const bool BlockSwizzle = false>
void launch_hgemm_mma_stages_block_swizzle_tn_cute(T *a, T *b, T *c, int M,
                                                   int N, int K,
                                                   int swizzle_stride) {
  // block swizzle_stride: 1024/2048/..., etc.
  using namespace cute;

  auto BM = Int<128>{};
  auto BN = Int<256>{};
  auto BK = Int<32>{};
  auto KStage = Int<Stages>{};       // default 2
  auto kSmemLayoutCBatch = Int<4>{}; // namely, stages.

  // Define the smem layouts, Swizzle<3, 3, 3> and
  // Swizzle<2, 3, 3> will get the same results.
  // reference: https://zhuanlan.zhihu.com/p/671419093
  using SmemLayoutAtom = decltype(composition(
      Swizzle<3, 3, 3>{}, make_layout(make_shape(Int<8>{}, Int<BK>{}),
                                      make_stride(Int<BK>{}, Int<1>{}))));
  using SmemLayoutA = decltype(tile_to_shape(
      SmemLayoutAtom{}, make_shape(Int<BM>{}, Int<BK>{}, Int<KStage>{})));
  using SmemLayoutB = decltype(tile_to_shape(
      SmemLayoutAtom{},
      make_shape(Int<BN>{}, Int<BK>{}, Int<KStage>{}))); // (m,n) -> smem_idx
#ifdef CUTE_HGEMM_DEBUG
  print("SmemLayoutA: ");
  print(SmemLayoutA{});
  print("\n");
  print("SmemLayoutB: ");
  print(SmemLayoutB{});
  print("\n");
  print("SmemLayoutB: ");
  print(SmemLayoutB{});
  print("\n");
  print("SmemLayoutAtom A&B Latex: \n");
  print_latex(SmemLayoutAtom{});
  print("\n");
#endif

  // mma
  using mma_op = SM80_16x8x16_F16F16F16F16_TN;
  using mma_traits = MMA_Traits<mma_op>;
  using mma_atom = MMA_Atom<mma_traits>;
  static constexpr int kMmaEURepeatM = 2; // MMA repeat 2 times across M
  static constexpr int kMmaEURepeatN = 2; // MMA repeat 2 times across N
  static constexpr int kMmaEURepeatK = 1; // MMA no repeat across K

  using mma_atom_shape = mma_traits::Shape_MNK; // M,N,K 16,8,16
  static constexpr int kMmaPM =
      1 * kMmaEURepeatM * get<0>(mma_atom_shape{}); // 1*2*16=32
  static constexpr int kMmaPN =
      2 * kMmaEURepeatN * get<1>(mma_atom_shape{}); // 2*2*8 =32
  static constexpr int kMmaPK =
      1 * kMmaEURepeatK * get<2>(mma_atom_shape{}); // 1*1*16=16
  // TiledMMA, more threads, MMAThrLayout(2,2,1), 4 MMA = 4 warps = 32x4
  // threads.
  using MMA_EU_RepeatT = decltype(make_layout(make_shape(
      Int<kMmaEURepeatM>{}, Int<kMmaEURepeatN>{}, Int<kMmaEURepeatK>{})));
  // TiledMMA, more values, Permutations(32,32,16)
  using MMA_P_T = Tile<Int<kMmaPM>, Int<kMmaPN>, Int<kMmaPK>>;
  using MMA = decltype(make_tiled_mma(mma_atom{}, MMA_EU_RepeatT{}, MMA_P_T{}));
#ifdef CUTE_HGEMM_DEBUG
  print("MMA: ");
  print(MMA{});
  print("\n");
  print("MMA Latex: \n");
  print_latex(MMA{});
  print("\n");
#endif

  // copy from global memory to shared memory
  using g2s_copy_op = SM80_CP_ASYNC_CACHEGLOBAL<cute::uint128_t>;
  using g2s_copy_traits = Copy_Traits<g2s_copy_op>;
  using g2s_copy_atom = Copy_Atom<g2s_copy_traits, T>;
  // Make TiledCopy according to ThrLayout and ValLayout.
  // 32x4 threads, each thread load 1x8 values (128 bits) once ?
  //   Produce a TiledCopy from logical thread and values layouts.
  // The thread and value layouts map coordinates to thr_idx and val_idx.
  //   The product of these layouts is taken to produce the TV layout and the
  //   Tiler.
  // Useful when threads and values need very specific mappings onto coordinates
  //   in the target tensors.
  using G2SCopyA = decltype(make_tiled_copy(
      g2s_copy_atom{},
      make_layout(make_shape(Int<32>{}, Int<4>{}), // Thr layout 32x4 k-major
                  make_stride(Int<4>{}, Int<1>{})),
      make_layout(make_shape(Int<1>{}, Int<8>{})))); // Val layout 1x8
  using G2SCopyB = G2SCopyA;
#ifdef CUTE_HGEMM_DEBUG
  print("G2SCopyA: ");
  print(G2SCopyA{});
  print("\n");
  print("G2SCopyB: ");
  print(G2SCopyB{});
  print("\n");
  print("G2SCopyA Latex: \n");
  print_latex(G2SCopyA{});
  print("\n");
  print("G2SCopyB Latex: \n");
  print_latex(G2SCopyB{});
  print("\n");
#endif
  // copy from shared memory to register
  // use mma tiled ,so no tiled here
  using s2r_copy_op = SM75_U32x4_LDSM_N;
  using s2r_copy_traits = Copy_Traits<s2r_copy_op>;
  using s2r_copy_atom = Copy_Atom<s2r_copy_traits, T>;
  using S2RCopyAtomA = s2r_copy_atom;
  using S2RCopyAtomB = s2r_copy_atom;

  // epilogue: register to global via shared memory
  // Swizzle<3, 3, 3>=BxMxS=(2^3)*(2^3)*(2^3)=512 values=1024 bytes.
  // reference: https://zhuanlan.zhihu.com/p/671419093
  using SmemLayoutAtomC = decltype(composition(
      Swizzle<3, 3, 3>{},
      make_layout(make_shape(Int<kMmaPM>{}, Int<kMmaPN>{}), // 32*32
                  make_stride(Int<kMmaPN>{}, Int<1>{}))));
  // kSmemLayoutCBatch=4, 32x32x4=4096 values=8192 bytes
  using SmemLayoutC = decltype(tile_to_shape(
      SmemLayoutAtomC{},
      make_shape(Int<kMmaPM>{}, Int<kMmaPN>{}, Int<kSmemLayoutCBatch>{})));

  static_assert(size<0>(SmemLayoutA{}) * size<1>(SmemLayoutA{}) >=
                    size(SmemLayoutC{}),
                "C shared memory request is large than A's one pipe");
#ifdef CUTE_HGEMM_DEBUG
  print(SmemLayoutC{});
  print("\n");
  static constexpr int tmp_sizeC = size(SmemLayoutC{});
  static constexpr int tmp_sizeA_0 = size<0>(SmemLayoutA{});
  static constexpr int tmp_sizeA_1 = size<1>(SmemLayoutA{});
  static constexpr int tmp_sizeA = tmp_sizeA_0 * tmp_sizeA_1;
  print("size SmemLayoutC: %d", tmp_sizeC);
  print("\n");
  print("size SmemLayoutA: %d", tmp_sizeA);
  print("\n");
  print("size 0 SmemLayoutA: %d", tmp_sizeA_0);
  print("\n");
  print("size 1 SmemLayoutA: %d", tmp_sizeA_1);
  print("\n");
#endif

  using R2SCopyAtomC = Copy_Atom<UniversalCopy<int>, T>;

  using S2GCopyAtomC = Copy_Atom<UniversalCopy<cute::uint128_t>, T>;
  using S2GCopyC =
      decltype(make_tiled_copy(S2GCopyAtomC{},
                               make_layout(make_shape(Int<32>{}, Int<4>{}),
                                           make_stride(Int<4>{}, Int<1>{})),
                               make_layout(make_shape(Int<1>{}, Int<8>{}))));

  int BX = (N + BN - 1) / BN;
  int BY = (M + BM - 1) / BM;
  // NOTE: Apply thread block swizzle across N dim.
  int BZ = BlockSwizzle ? (N + (swizzle_stride)-1) / (swizzle_stride) : 1;
  BX = BlockSwizzle ? (BX + BZ - 1) / BZ : BX;

  dim3 block(size(MMA{}));
  dim3 grid(BX, BY, BZ);

  // C_shm is shared with A_shm and B_shm
  // we don't allocate new smem for C_shm.
  // (128 * 32 * 2) * 2 + (256 * 32 * 2) * 2 = 49152 bytes, stages=2
  static constexpr int shm_size_AB =
      cute::cosize(SmemLayoutA{}) + cute::cosize(SmemLayoutB{});
  static constexpr int shm_size_C = cute::cosize(SmemLayoutC{});
  static constexpr int kShmSize =
      cute::max(shm_size_AB, shm_size_C) * sizeof(T);

  int shm_size = kShmSize;
#ifdef CUTE_HGEMM_DEBUG
  print("shm_size: %d bytes, shm_size_AB: %d bytes, shm_size_C: %d bytes\n",
        shm_size, shm_size_AB * (int)sizeof(T), shm_size_C * (int)sizeof(T));
#endif

  cudaFuncSetAttribute(
      hgemm_mma_stages_block_swizzle_tn_cute_kernel<
          T, BM, BN, BK, KStage, MMA, G2SCopyA, G2SCopyB, SmemLayoutA,
          SmemLayoutB, SmemLayoutC, S2RCopyAtomA, S2RCopyAtomB, R2SCopyAtomC,
          S2GCopyAtomC, S2GCopyC, BlockSwizzle>,
      cudaFuncAttributeMaxDynamicSharedMemorySize, shm_size);

  hgemm_mma_stages_block_swizzle_tn_cute_kernel<
      T, BM, BN, BK, KStage, MMA, G2SCopyA, G2SCopyB, SmemLayoutA, SmemLayoutB,
      SmemLayoutC, S2RCopyAtomA, S2RCopyAtomB, R2SCopyAtomC, S2GCopyAtomC,
      S2GCopyC, BlockSwizzle><<<grid, block, shm_size>>>(a, b, c, M, N, K);
}

// build cpp binary
#ifndef NO_CUTE_HGEMM_BIN

#include "utils.h"

int main() {
  using T = cute::half_t;
  using namespace cute;
#ifdef CUTE_HGEMM_DEBUG
  const int test_num = 1;
#else
  const int test_num = 64;
#endif
  int M_list[test_num];
  int N_list[test_num];
  int K_list[test_num];

  for (int i = 0; i < test_num; i++) {
    M_list[i] = (i + 1) * 256;
    N_list[i] = (i + 1) * 256;
    K_list[i] = (i + 1) * 256;
  }

  const int thread_block_swizzle_stride = 2048; // thread block swizzle stride
  printf("ALGO = CuTe HGEMM, TN, STAGES=2, SMEM SWIZZLE=<3, 3, 3>, BLOCK "
         "SWIZZLE=2048\n");
  int check_num = test_num > 5 ? 5 : 1;
  for (int j = 0; j < check_num; j++) {
    int M = M_list[j], N = N_list[j], K = K_list[j];
    float max_error = gemm_error_check_tn_swizzle<T>(
        launch_hgemm_mma_stages_block_swizzle_tn_cute<T, 2, true>, M, N, K,
        thread_block_swizzle_stride);
    printf("M N K = %6d %6d %6d, ", M, N, K);
    printf("Max Error = %f\n", max_error);
  }

#ifndef CUTE_HGEMM_DEBUG
  const int outer_repeat = 10, inner_repeat = 1;
  for (int j = 0; j < test_num; j++) {
    int M = M_list[j], N = N_list[j], K = K_list[j];

    double max_sec = 0.0;
    double min_sec = DBL_MAX;
    double total_sec = 0.0;

    for (int k = 0; k < outer_repeat; k++) {
      double this_sec = perf_gemm_swizzle<T>(
          launch_hgemm_mma_stages_block_swizzle_tn_cute<T, 2, true>, M, N, K,
          thread_block_swizzle_stride, inner_repeat);
      max_sec = max(max_sec, this_sec);
      min_sec = min(min_sec, this_sec);
      total_sec += this_sec;
    }

    // 1 TFLOPS = 10^12 FLOPS
    // ref: https://imgtec.eetrend.com/blog/2021/100062210.html.
    double avg_sec = total_sec / outer_repeat;
    double avg_Tflops = ((double)M) * N * K * 2 * 1e-12 / avg_sec;

    printf("M N K = %6d %6d %6d, ", M, N, K);
    printf("Time = %12.8lf %12.8lf %12.8lf s, ", min_sec, avg_sec, max_sec);
    printf("AVG Performance = %10.4lf Tflops\n", avg_Tflops);
  }
#endif

  return 0;
}

#else
// build torch python binding

#include <torch/extension.h>
#include <torch/types.h>

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T).options() << std::endl;                 \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define CHECK_TORCH_TENSOR_SHAPE(T, S0, S1)                                    \
  if (((T).size(0) != (S0)) || ((T).size(1) != (S1))) {                        \
    throw std::runtime_error("Tensor size mismatch!");                         \
  }

#define LAUNCH_HGEMM_MMA_STAGES_CUTE_NO_SWIZZLE_TN(stages)                     \
  launch_hgemm_mma_stages_block_swizzle_tn_cute<half, (stages), false>(        \
      reinterpret_cast<half *>(a.data_ptr()),                                  \
      reinterpret_cast<half *>(b.data_ptr()),                                  \
      reinterpret_cast<half *>(c.data_ptr()), M, N, K, 2048);

#define LAUNCH_HGEMM_MMA_STAGES_CUTE_SWIZZLE_TN(stages, stride)                \
  launch_hgemm_mma_stages_block_swizzle_tn_cute<half, (stages), true>(         \
      reinterpret_cast<half *>(a.data_ptr()),                                  \
      reinterpret_cast<half *>(b.data_ptr()),                                  \
      reinterpret_cast<half *>(c.data_ptr()), M, N, K, (stride));

// Multi stages CuTe HGEMM with SMEM Swizzle and Block Swizzle.
void hgemm_mma_stages_block_swizzle_tn_cute(torch::Tensor a, torch::Tensor b,
                                            torch::Tensor c, int stages,
                                            bool swizzle, int swizzle_stride) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)

  if (swizzle) {
    switch (stages) {
    case 2:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_SWIZZLE_TN(2, swizzle_stride);
      break;
    case 3:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_SWIZZLE_TN(3, swizzle_stride);
      break;
    case 4:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_SWIZZLE_TN(4, swizzle_stride);
      break;
    default:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_SWIZZLE_TN(2, swizzle_stride);
      break;
    }
  } else {
    switch (stages) {
    case 2:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_NO_SWIZZLE_TN(2)
      break;
    case 3:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_NO_SWIZZLE_TN(3)
      break;
    case 4:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_NO_SWIZZLE_TN(4)
      break;
    default:
      LAUNCH_HGEMM_MMA_STAGES_CUTE_NO_SWIZZLE_TN(2)
      break;
    }
  }
}
#endif
```

</details>

## 本篇小结

1. **CuTe 版 296.6 TFLOPS**（峰值 90%），比手写 MMA +92%——不是 DSL 编译更快，是 tile 开得更大（BN=256/BK=32），而敢开大是因为布局复杂度被类型系统接管
2. **`composition(Swizzle<3,3,3>, layout)` = 18 篇手写位异或的代数化**：swizzle 进类型，装载/计算/回写自动继承，"写读两端插函数"的侵入负担消失
3. **`make_tiled_mma` = 17 篇分形常量连乘的类型化**：atom→warp 重复→warp 拼图，`partition_A/B/C` 替掉全部手推 lane 映射；`cute::gemm` 编译期展开等价于手写三层 unroll
4. **三层 swizzle 终极对照**：smem swizzle（bank）/ block swizzle（L2 调度）/ warp swizzle（调度）——名字一样，作用层完全不同
5. **10 篇结论的反转**：转置（小问题）手写更直白；GEMM（大问题）layout 代数杠杆压倒一切——问题越大，抽象越值钱
