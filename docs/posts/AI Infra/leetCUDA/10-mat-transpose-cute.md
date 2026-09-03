---
title: Mat Transpose (CuTe)
order: 10
---

# Mat Transpose CuTe 版代码学习

> 本人学习笔记，AI总结

[09 篇](./09-mat-transpose.md)用手写 CUDA 把转置的访存优化推到了 0.0039ms。本篇用 **CuTe**（CUTLASS 的 layout DSL）把同一堆 kernel 重写一遍——性能持平（最优 0.0041ms vs 手写 0.0039ms），但**表达方式完全不同**：09 里手调的下标体操（`(local_y%4)*4`、padding、float4 拆组）全部消失，取而代之的是几个 Layout 对象的组合。本篇回答一个问题：**CuTe 到底抽象掉了什么**。

先声明学习预期：CuTe 是"描述 layout 的代数系统"，抽象层次高、类型体操重，第一遍**看懂每一行类型不现实**。本篇抓主线：五个版本的递进（reg → smem → swizzle → 向量化 → 三段式），每个版本只抠"它比上一版多了哪个 layout 原语、对应 09 的哪个手工技巧"。

## CuTe 三要素（10 分钟速成）

CuTe 的世界观：**一切数据布局 = Layout（Shape + Stride）**，一切数据搬运 = 对 Tensor（指针 + Layout）的 `copy`。

```c++
// Shape: 每个维度多大;  Stride: 每个维度走一步地址跳多少
make_layout(make_shape(1024, 1024), GenRowMajor{})
// = Shape<(1024,1024), Stride<(1,1024)>>
// 含义: 二维 (M,N) 矩阵, 行主序 —— m(i,j) 的地址 = i*1 + j*1024?
// 不对, 是地址 = i + j*1024? 记法: 沿 shape 的第 0 维走 1 步地址 +stride[0]
```

三个核心原语（本篇全部 kernel 只用这几个）：

```c++
// 1. make_tensor: 指针 + layout = 可索引的"张量视图"
auto mA = make_tensor(make_gmem_ptr(pA), make_layout(make_shape(M, N), GenRowMajor{}));
mA(i, j);                          // 直接二维索引, 地址由 layout 算出

// 2. local_tile: 从大张量切出一个 block 负责的子块 (不搬数据, 只是个视图)
auto gA = local_tile(mA, make_shape(Int<16>{}, Int<16>{}), make_coord(bx, by));
// mA 的第 (bx, by) 块 16x16 tile, gA(i,j) 索引的是 tile 内坐标

// 3. local_partition: 把 tile 按线程 layout 切给各线程 (每个线程一个视图)
auto tAgA = local_partition(gA, tA, tx);
// tA 描述"256 个线程怎么摆成 16x16", tx 是本线程编号
// tAgA 是本线程分到的元素集合 (通常 1 个或几个)
```

**和 09 手写的对照**：

```
手写:  y[global_y * row + global_x] = x[global_x * col + global_y]
        ↑ 下标公式手工推导, 编译器不知道结构

CuTe:  mA/mB 的 layout 描述了 x/y 的形状
       local_tile + local_partition 算出本线程的 gA/gB
       copy_if(...) 一行完成搬运
        ↑ 结构写在类型里, 编译器看得见, 能自动优化
```

**最大的区别**：手写版里 `global_x * col + global_y` 只是运行时的整数运算；CuTe 里 `Shape<16,16>, Stride<1,16>` 是**编译期类型**，编译器知道"这是一个 16×16 行主序 tile"的全部结构——所以它能自动判断对齐、自动选 copy 指令（`AutoVectorizingCopy`）、自动避开 bank conflict（swizzle）。**这就是 09 手工技巧能被抽象的根基：结构信息从"运行时数字"升级成"编译期类型"**。

## 完整代码

### `mat_transpose_cute.cu`
<details>
<summary> mat_transpose_cute.cu（前半：reg/smem/swizzle 版）</summary>

```c++
#include <cuda_runtime.h>
#include <stdio.h>
#include <torch/extension.h>

#include <cute/layout.hpp>
#include <cute/tensor.hpp>
using namespace cute;

#define UNIT_BLK_SIZE 16

#define CUDA_CHECK(call)                                                       \
  do {                                                                         \
    cudaError_t err = call;                                                    \
    if (err != cudaSuccess) {                                                  \
      fprintf(stderr, "CUDA error at %s:%d: %s\n", __FILE__, __LINE__,         \
              cudaGetErrorString(err));                                         \
      exit(EXIT_FAILURE);                                                      \
    }                                                                          \
  } while (0)

template <typename T, int BLK_M, int BLK_N, typename ThreadLayoutA,
          typename ThreadLayoutB>
__global__ void mat_transpose_cute_reg_kernel(const T *pA, T *pB, int M, int N,
                                              ThreadLayoutA tA,
                                              ThreadLayoutB tB) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{})); // (M, N)
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{})); // (N, M)

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)
  auto cA = local_tile(make_identity_tensor(mA.shape()),
                       make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)

  Tensor tAgA = local_partition(gA, tA, tx);
  Tensor tBgB = local_partition(gB, tB, tx);
  Tensor tAcA = local_partition(cA, tA, tx);

  Tensor tApA = make_tensor<bool>(tAcA.shape(), tAcA.stride());
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tApA); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tApA); j++) {
      tApA(i, j) = get<0>(tAcA(i, j)) < M && get<1>(tAcA(i, j)) < N;
    }
  }
  copy_if(tApA, tAgA, tBgB);
}

void mat_transpose_cute_row2col_reg(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_reg_kernel<float, BM, BN, decltype(tA), decltype(tB)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB);
  CUDA_CHECK(cudaGetLastError());
}

void mat_transpose_cute_col2row_reg(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_reg_kernel<float, BM, BN, decltype(tA), decltype(tB)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB);
  CUDA_CHECK(cudaGetLastError());
}

template <typename T, int BLK_M, int BLK_N, typename ThreadLayoutA,
          typename ThreadLayoutB, typename SmemLayoutA, typename SmemLayoutB>
__global__ void
mat_transpose_cute_smem_kernel(const T *pA, T *pB, int M, int N,
                               ThreadLayoutA tA, ThreadLayoutB tB,
                               SmemLayoutA sA_layout, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{})); // (M, N)
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{})); // (N, M)

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)
  auto cA = local_tile(make_identity_tensor(mA.shape()),
                       make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto cB = local_tile(make_identity_tensor(mB.shape()),
                       make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)

  __shared__ T smem[BLK_M * BLK_N];
  auto sA = make_tensor(make_smem_ptr(smem), sA_layout); // (BM, BN)
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout); // (BN, BM)

  Tensor tAgA = local_partition(gA, tA, tx);
  Tensor tBgB = local_partition(gB, tB, tx);
  Tensor tAsA = local_partition(sA, tA, tx);
  Tensor tBsB = local_partition(sB, tB, tx);
  Tensor tAcA = local_partition(cA, tA, tx);
  Tensor tBcB = local_partition(cB, tB, tx);

  // 边界 mask: 用 identity tensor 算每个元素的全局坐标, 判断是否越界
  Tensor tApA = make_tensor<bool>(tAcA.shape(), tAcA.stride());
  Tensor tBpB = make_tensor<bool>(tBcB.shape(), tBcB.stride());
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tApA); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tApA); j++) {
      tApA(i, j) = get<0>(tAcA(i, j)) < M && get<1>(tAcA(i, j)) < N;
    }
  }
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tBpB); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tBpB); j++) {
      tBpB(i, j) = get<0>(tBcB(i, j)) < N && get<1>(tBcB(i, j)) < M;
    }
  }
  copy_if(tApA, tAgA, tAsA);      // gmem -> smem (A 的布局)
  __syncthreads();
  copy_if(tBpB, tBsB, tBgB);      // smem (B 的布局) -> gmem
}

constexpr int log2(int x) {
  assert(x > 0);
  return (x & (x - 1)) == 0 ? __builtin_ctz(x)
                            : (throw "x is not a power of 2", 0);
}

void mat_transpose_cute_col_smem(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  auto sA_layout = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto sB_layout = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_kernel<float, BM, BN, decltype(tA), decltype(tB),
                                 decltype(sA_layout), decltype(sB_layout)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB,
                        sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}

// row_smem / col_smem_swizzled / row_smem_swizzled 同构, 详见仓库源文件

void mat_transpose_cute_col_smem_swizzled(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  const int S = log2(BM);
  auto swizzle_func = Swizzle<S, 0, S>{};                    // ★ swizzle
  auto sA_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{}));
  auto sB_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{}));
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_kernel<float, BM, BN, decltype(tA), decltype(tB),
                                 decltype(sA_layout), decltype(sB_layout)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB,
                        sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}
```

</details>

<details>
<summary> mat_transpose_cute.cu（后半：向量化与 optimized 版，含关键 host 函数）</summary>

```c++
__host__ __device__ inline bool is_aligned_128(const void *ptr) {
  return (reinterpret_cast<uintptr_t>(ptr) & 0xF) == 0;
}

// 向量化版 kernel: 用 TiledCopy 描述"线程怎么合作拷 tile"
template <typename T, int BLK_M, int BLK_N, typename TiledCopyA,
          typename TiledCopyB, typename SmemLayoutA, typename SmemLayoutB>
__global__ void mat_transpose_cute_smem_vectorized_kernel(
    const T *pA, T *pB, int M, int N, TiledCopyA copy_a, TiledCopyB copy_b,
    SmemLayoutA sA_layout, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{}));
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{}));

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)

  __shared__ T smem[BLK_M * BLK_N];
  auto sA = make_tensor(make_smem_ptr(smem), sA_layout);
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout);

  // TiledCopy: 一等公民的"拷贝计划" —— 线程怎么摆 + 每线程拷几个
  auto thr_copy_a = copy_a.get_slice(tx);
  Tensor tAgA = thr_copy_a.partition_S(gA);   // 本线程的源切片
  Tensor tAsA = thr_copy_a.partition_D(sA);   // 本线程的目标切片

  auto thr_copy_b = copy_b.get_slice(tx);
  Tensor tBsB = thr_copy_b.partition_S(sB);
  Tensor tBgB = thr_copy_b.partition_D(gB);

  copy(copy_a, tAgA, tAsA);       // AutoVectorizingCopy: 编译器自动发 float4!
  __syncthreads();
  copy(copy_b, tBsB, tBgB);
}

void mat_transpose_cute_row_cvectorized(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE * 4;    // 64
  const int BN = UNIT_BLK_SIZE;        // 16
  auto ptr_A = x.data_ptr<float>();
  auto ptr_B = y.data_ptr<float>();
  const int M = x.size(0);
  const int N = x.size(1);

  // sanity checks: 向量化前提 = 形状 4 对齐 + 指针 16B 对齐 (04 的老朋友)
  assert(M % 4 == 0);
  assert(N % 4 == 0);
  assert(is_aligned_128(ptr_A));
  assert(is_aligned_128(ptr_B));

  // 线程摆 (BM/4, BN) 个位置, 每线程值布局 (4,1) —— 读端每线程连取 4 个
  auto tile_copy_a = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BM / 4>{}, Int<BN>{}), GenRowMajor{}),
      make_layout(make_shape(Int<4>{}, Int<1>{}), GenRowMajor{}));
  // 写端镜像: 线程摆 (BN, BM/4), 每线程值布局 (1,4) —— 写端连写 4 个
  auto tile_copy_b = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BN>{}, Int<BM / 4>{}), GenRowMajor{}),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));
  auto sA_layout = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto sB_layout = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});

  static_assert(size(tile_copy_a) == size(tile_copy_b));
  dim3 block(size(tile_copy_a));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_vectorized_kernel<
      float, BM, BN, decltype(tile_copy_a), decltype(tile_copy_b),
      decltype(sA_layout), decltype(sB_layout)><<<grid, block>>>(
      ptr_A, ptr_B, M, N, tile_copy_a, tile_copy_b, sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}

// rvectorized / cvectorized_swizzled / rvectorized_swizzled 同构,
// 区别只在 tile_copy 的 shape 和 swizzle 与否, 详见仓库源文件

// 最终优化版: 三段式 (gmem->reg -> reg 重排 -> smem -> gmem), BM=8, BN=128
template <typename T, int BLK_M, int BLK_N, typename TiledCopyA,
          typename TiledCopyTrans, typename TiledCopyB, typename SmemLayoutB>
__global__ void mat_transpose_cute_smem_vectorized_optimized_kernel(
    const T *pA, T *pB, int M, int N, TiledCopyA copy_a,
    TiledCopyTrans copy_trans, TiledCopyB copy_b, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{}));
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{}));

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by));
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx));

  __shared__ T smem[BLK_M * BLK_N];
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout);   // 只有 B 的布局

  // 第 1 段: gmem -> 寄存器 (走 A 的读布局, 连读)
  auto thr_copy_a = copy_a.get_slice(tx);
  Tensor tAgA = thr_copy_a.partition_S(gA);
  auto tAsA = make_tensor_like(tAgA);              // 寄存器张量!
  Tensor tAsA_view = thr_copy_a.retile_D(tAsA);
  copy(copy_a, tAgA, tAsA_view);

  // 第 2 段: 寄存器内重排 (转置发生在这里, 全在寄存器!)
  auto thr_copy_trans = copy_trans.get_slice(tx);
  auto tAsB = thr_copy_trans.retile_S(tAsA);
  auto tBsB_trans = thr_copy_trans.partition_D(sB);
  copy(copy_trans, tAsB, tBsB_trans);

  // 第 3 段: smem -> gmem (走 B 的写布局, 连写)
  auto thr_copy_b = copy_b.get_slice(tx);
  Tensor tBsB = thr_copy_b.partition_S(sB);
  Tensor tBgB = thr_copy_b.partition_D(gB);
  copy(copy_b, tBsB, tBgB);
}

void mat_transpose_cute_row_rvectorized_swizzled_optimized(torch::Tensor x,
                                                           torch::Tensor y) {
  const int BM = 8;
  const int BN = 16 * 8;    // 128
  auto ptr_A = x.data_ptr<float>();
  auto ptr_B = y.data_ptr<float>();
  const int M = x.size(0);
  const int N = x.size(1);

  assert(M % 4 == 0);
  assert(N % 4 == 0);
  assert(is_aligned_128(ptr_A));
  assert(is_aligned_128(ptr_B));

  // 一次性加载 8*16 大小的矩阵
  auto tile_copy_a = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BM>{}, make_shape(Int<4>{}, Int<BN / 16>{})),
                  make_stride(Int<4>{}, make_stride(Int<1>{}, Int<32>{}))),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));

  // 转换数据
  auto tile_copy_trans = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(make_shape(Int<4>{}, Int<BN / 16>{}), Int<BM>{}),
                  make_stride(make_stride(Int<1>{}, Int<32>{}), Int<4>{})),
      make_layout(make_shape(Int<4>{}, Int<1>{}), GenRowMajor{}));

  // 一次性存储 16*8 大小的矩阵
  auto tile_copy_b = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BN>{}, Int<BM / 4>{}), GenRowMajor{}),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));

  auto swizzle_func = Swizzle<2, 3, 2>{};
  auto sB_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{}));

  static_assert(size(tile_copy_a) == size(tile_copy_b));

  dim3 block(size(tile_copy_a));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);

  mat_transpose_cute_smem_vectorized_optimized_kernel<
      float, BM, BN, decltype(tile_copy_a), decltype(tile_copy_trans),
      decltype(tile_copy_b), decltype(sB_layout)><<<grid, block>>>(
      ptr_A, ptr_B, M, N, tile_copy_a, tile_copy_trans, tile_copy_b, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}
```

</details>

## 逐版本剖析

### 版本 1：reg 版 —— "切法"变成参数

```c++
auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{});
```

09 里 col2row/row2col 是**两个 kernel**（读公式写公式都不同）；CuTe 里是**同一个 kernel、两份 ThreadLayout 参数**——`tA` 描述"线程在读端 tile 里怎么摆"（ColMajor = 线程编号先走列方向）、`tB` 描述写端摆法。**col2row vs row2col 的选择，从"改代码"变成"传不同的 layout 对象"**——这就是 DSL 的威力：结构差异被参数化了。

kernel 体的流程固定：`make_tensor`（gmem 视图）→ `local_tile`（切出本 block 的 tile）→ `local_partition`（切出本线程的片）→ `copy_if`（带边界 mask 的搬运）。**没有任何手写下标**——`copy_if(tApA, tAgA, tBgB)` 一行 = 09 的"算 (row,col) → 算 y 地址 → 越界判断 → 赋值"四件事。

实测 row2col_reg = 0.0043ms，col2row_reg = 0.0110ms——**row2col 依然快一倍**，09 的"保写端"法则在 CuTe 里原样复现（因为法则由访存物理决定，跟表达方式无关）。

### 版本 2：smem 版 —— staging 的"两次切法"

smem 版多了一个角色：**同一块 smem，两份布局**。

```c++
__shared__ T smem[BLK_M * BLK_N];
auto sA = make_tensor(make_smem_ptr(smem), sA_layout);  // 同一块内存的 (BM,BN) 视图
auto sB = make_tensor(make_smem_ptr(smem), sB_layout);  // 同一块内存的 (BN,BM) 视图
```

`sA_layout` 是行主序 `(BM,BN)`，`sB_layout` 是**列主序** `(BN,BM)`——**同一块内存、两种读法**。存的时候按 A 的坐标写进 sA，取的时候按 B 的坐标读 sB，"转置"就发生在这两个 layout 的夹角里。09 手写版的 `tile[r][c]` 存、`tile[c][r]` 取，在这里是**两个 view 天然完成**，下标体操一行都没有：

```
copy_if(tApA, tAgA, tAsA);   // gmem --(A 视角)--> smem
__syncthreads();
copy_if(tBpB, tBsB, tBgB);   // smem --(B 视角)--> gmem
```

09 的"横着进、竖着取"在 CuTe 里是"存进 sA 视图、从 sB 视图取"——**转置 = 同一块内存的两个正交视图**。这是本篇最值得带走的一句话。

实测 col_smem = 0.0064ms、row_smem = 0.0043ms。

### 版本 3：swizzle 版 —— padding 的优雅替代

09 的 padding（行宽 64→65）解决了 bank conflict，代价是破坏 16B 对齐。CuTe 的 `Swizzle` 是更聪明的解法：

```c++
const int S = log2(BM);               // BM=16 → S=4
auto swizzle_func = Swizzle<S, 0, S>{};
auto sA_layout = composition(swizzle_func,
                             make_layout(...));   // swizzle ∘ layout 复合
```

**Swizzle 是什么**：一个**比特级的地址重排函数**。`Swizzle<B,M,S>` 的含义：把地址的第 `[M+S, M+S+B)` 位（一段 B 个比特）与第 `[M, M+B)` 位**异或**。落到这个场景：`Swizzle<4, 0, 4>` 把地址的低 8 位里的高 4 位（行号）异或进低 4 位（列号）——**效果 = 列号 ^= 行号 % 16**。

用 09 的数字算一遍（tile 16×16，行主序，`tile[r][c]` 地址 = r*16+c）：

```
原地址:  tile[0][c] → c        (bank = c % 32... 16 个 float 半个 bank 周期)
         tile[1][c] → 16+c     (bank 与 tile[0] 错开 16, 撞一半)
swizzle 后: tile[r][c] 的物理地址 = r*16 + (c ^ r)
         tile[0][c] → c ^ 0 = c          (行 0 不动)
         tile[1][c] → 16 + (c ^ 1)       (行 1 的列 0↔1, 2↔3, ... 成对交换)
         tile[2][c] → 32 + (c ^ 2)       (行 2 的列 0↔2, 1↔3, ...)
         ...
竖取一列 c 时, 第 r 行取的物理列是 c^r —— 不同行取到不同列 → bank 错开 ✓
```

**swizzle 与 padding 的对比**：

| | padding (+1) | swizzle (c^r) |
|---|---|---|
| 消 bank conflict | ✓（行间 bank 错 1） | ✓（行间取交错列） |
| 保持 16B 对齐 | ✗（行宽 65，FLOAT4 崩） | ✓（只是重排位置，总大小不变，每行依然 16B 对齐） |
| 代价 | load 端向量化退化成标量 | "tile[r][c] 的物理位置"不直观，但 copy 由编译器生成，无手写负担 |
| 思想 | 加空间错位 | 换位置错位（免费） |

**swizzle 是 GEMM/FA 里 smem 访问的标准姿势**——第二阶段 hgemm 的 `mma_tn_89_swizzle` 系列全是它。这里第一次见，记住形状：`composition(Swizzle, layout)`，"列 ^= 行"。

实测 col_smem_swizzled = 0.0056ms（vs 无 swizzle 0.0064ms，**快 12%**——16×16 tile 的 conflict 本来轻，但 swizzle 免费白拿）。row_smem_swizzled = 0.0042ms。

### 版本 4：向量化版 —— AutoVectorizingCopy 与"c/r 两个方向"

09 手写版要显式 `FLOAT4(a[idx])` + `reinterpret_cast` 才有 128bit load；CuTe 用 `Copy_Atom<AutoVectorizingCopy, float>`——**"如果 layout 显示连续且对齐，自动发向量指令"**。对齐检查在 host 侧用 `is_aligned_128` assert（04 的老知识：向量化前提）。

有意思的是"两个向量化方向"的命名（对应 09 的"向量化哪端"）：

```c++
// cvectorized (column-vec): 读端向量化
//   tile_copy_a 的值布局 (4,1) —— 每线程沿列方向连取 4 个(读 x 竖条)
//   tile_copy_b 的值布局 (1,4) —— 每线程写 y 横条 4 个
//   BM=64, BN=16: 处理 64×16 tile, 读端是"大边" → 读端向量化

// rvectorized (row-vec): 写端向量化
//   tile_copy_a 的值布局 (1,4) —— 每线程沿行方向连读 4 个(读 x 横条)
//   tile_copy_b 的值布局 (4,1) —— 每线程写 y 竖条? 不——镜像过来写端连写
//   BM=16, BN=64: 处理 16×64 tile, 写端是"大边" → 写端向量化
```

实测印证 09 的结论：**cvectorized 0.0055ms < 无向量化 0.0043ms？不对——0.0055 比 0.0043 慢！** 而 rvectorized 0.0041ms 最快。读端向量化的 cvectorized 反而慢，因为它的值布局 (4,1) 让 warp 的读地址变成"每 4 个一跳"——**向量化错端的惩罚在 CuTe 里同样存在**，这不是表达方式能救的物理规律（09 第 5 步的陷阱，CuTe 也踩，只是数据更直观地摆在这里）。

### 版本 5：optimized 版 —— 转置搬进寄存器

最终版的三段式是个新思路：**smem 只当"写端暂存"，转置本身在寄存器里完成**：

```c++
Tensor tAgA = thr_copy_a.partition_S(gA);
auto tAsA = make_tensor_like(tAgA);        // ← 寄存器里的张量
copy(copy_a, tAgA, tAsA_view);             // ① gmem -> 寄存器 (读布局, 连读)

auto tAsB = thr_copy_trans.retile_S(tAsA); // ② 寄存器重排 (转置!)
copy(copy_trans, tAsB, tBsB_trans);        //    寄存器 -> smem (swizzle 布局)

copy(copy_b, tBsB, tBgB);                  // ③ smem -> gmem (写布局, 连写)
```

`make_tensor_like` 造的是**寄存器张量**（数组放本地内存/寄存器），`retile_S` 把同一块寄存器按 B 的视角重新切分——"转置"变成**寄存器数组下标重排**，比经过 smem 的往返更快。加上 `Swizzle<2,3,2>` 的 smem 布局和 8×128 的大 tile（BM=8 让读端 8 行连续一次性进寄存器，BN=128 让写端一次铺 128 宽），实测 **0.0041ms**——CuTe 全家最优。

注意这个 `Swizzle<2,3,2>` 和前面 `Swizzle<4,0,4>` 参数不同（B=2 个比特、M=3 偏移、S=2 步长）——swizzle 的参数要按 tile 形状和访问模式调，没有万能值。这套调参正是 CUTLASS 模板代码里满屏 `Swizzle<3,4,3>` 之类常数的来源。

## 实测数据（4090, M=N=1024，与 09 手写对照）

| kernel | 时间 | 对应 09 手写 |
|---|---|---|
| cute col2row_reg | 0.0110ms | f32_col2row 0.0318ms |
| cute row2col_reg | 0.0043ms | f32_row2col(2d) 0.0047ms |
| cute col_smem | 0.0064ms | — |
| cute row_smem | 0.0043ms | — |
| cute col_smem_swizzled | 0.0056ms | — |
| cute row_smem_swizzled | 0.0042ms | — |
| cute row_cvectorized | 0.0055ms | f32x4_col2row（向量化错端的坑）|
| cute row_rvectorized | 0.0041ms | f32x4_row2col(2d) 0.0039ms |
| cute **rvectorized_swizzled_optimized** | **0.0041ms** | 手写最优 0.0039ms |

- CuTe 最优 ≈ 手写最优（0.0041 vs 0.0039ms，差 5%）——**DSL 不改变性能天花板**。
- 09 的所有经验法则在 CuTe 数据里全部复现：保写端（row 系快）、向量化选对端（rvec 快 cvec 慢）、swizzle 免费。**物理规律与表达方式无关，CuTe 只是让你写得更省、错得更少**。

## 本篇小结

1. **CuTe 三要素**：`make_tensor`（指针+布局=视图）、`local_tile`（切 block）、`local_partition`（切线程）；搬运 = `copy/copy_if` 一行。
2. **结构与类型**：手写下标是运行时数字，CuTe layout 是编译期类型——编译器因此能自动向量化（AutoVectorizingCopy）、自动生成 swizzle 访问。
3. **转置 = 同一块内存的两个正交视图**：smem 版用 sA/sB 两个 layout 看同一块 smem，"横进竖出"变成视图差异，下标体操消失。
4. **Swizzle**：`c ^= r` 式比特交错替代 padding——消 bank conflict 且**保 16B 对齐**（padding 的痛点），GEMM/FA 的标准姿势；参数 (B,M,S) 按 tile 形状调。
5. **寄存器转置**（optimized 版）：`make_tensor_like` + `retile` 让转置发生在寄存器里，smem 只做写端暂存。
6. **DSL 不救物理**：向量化错端照样慢（cvectorized 实证）、保写端照样赢——CuTe 的价值是表达力（col2row/row2col = 换 layout 参数）和防错，不是新性能。

下一篇回到纯手写：激活函数（relu/gelu）——elementwise 的收官练习。
