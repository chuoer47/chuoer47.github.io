---
title: HGEMV (FP16 GEMV)
order: 22
---

# HGEMV CUDA代码学习

> 本人学习笔记，AI总结

16 篇 SGEMV 用 FP32 把"一行一个点积"的并行设计讲完了，本篇是它的 FP16 续篇——但不是简单换个 dtype：hgemv 目录里多出**三个 CuTe 版本**（`hgemv_cute.cu`），包括一个**用 Tensor Core 做 GEMV** 的版本。同一个 GEMV 问题，从"手写 CUDA Core + shuffle 归约"到"CuTe TiledCopy 抽象"再到"MMA Atom 塞给 Tensor Core"，正好是 15~19 篇走过的技术阶梯在 GEMV 上的重演。先看实测（M=1024, K=128, FP16, RTX 4090, warmup 10 / iters 200）：

| kernel | 耗时 | 相对 |
|---|---|---|
| hgemv_k32_f16 | 0.00301 ms | 1.00x |
| hgemv_k128_f16x4 | 0.00293 ms | 0.97x |
| hgemv_f16_cute | 0.00290 ms | 0.96x |
| hgemv_f16x8_cute | 0.00297 ms | 0.99x |
| hgemv_tensor_core_cute | 0.00468 ms | 1.55x |
| torch.matmul (F16) | 0.00785 ms | 2.60x |

**Tensor Core 版反而最慢**（比手写 CUDA Core 慢 55%）——不是意外，是 GEMV 的问题形状和 Tensor Core 的设计前提天然错位，后面细说。手写版比 torch.matmul 快 2.6 倍，和 16 篇 F32 的结论一致：小 shape 特化 kernel 没有框架的通用性税。

## 完整代码

### `hgemv.cu`（CUDA Core 三连：与 sgemv 逐 kernel 对应）

<details>
<summary> hgemv.cu </summary>

```c++
#include <algorithm>
#include <cuda_bf16.h>
#include <cuda_fp16.h>
#include <cuda_fp8.h>
#include <cuda_runtime.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>

#define WARP_SIZE 32
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define BFLOAT2(value) (reinterpret_cast<__nv_bfloat162 *>(&(value))[0])

// FP16
// Warp Reduce Sum
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ half warp_reduce_sum_f16(half val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

// HGEMV: Warp HGEMV K32
// 假设K为32的倍数，每个warp负责一行
// grid(M/4), block(32,4) blockDim.x=32=K, blockDim.y=4
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
__global__ void hgemv_k32_f16_kernel(half *a, half *x, half *y, int M, int K) {
  int tx = threadIdx.x;         // 0~31
  int ty = threadIdx.y;         // 0~4
  int bx = blockIdx.x;          // 0~M/4
  int lane = tx % WARP_SIZE;    // 0~31
  int m = bx * blockDim.y + ty; // (0~M/4) * 4 + (0~3)
  if (m < M) {
    half sum = 0.0f;
    int NUM_WARPS = (K + WARP_SIZE - 1) / WARP_SIZE;
#pragma unroll
    for (int w = 0; w < NUM_WARPS; ++w) {
      // 若NUM_WARPS>=2，先将当前行的数据累加到第一个warp中
      int k = w * WARP_SIZE + lane;
      sum += a[m * K + k] * x[k];
    }
    sum = warp_reduce_sum_f16<WARP_SIZE>(sum);
    if (lane == 0)
      y[m] = sum;
  }
}

// HGEMV: Warp HGEMV K128 + half2x2
// 假设K为128的倍数 float4
// grid(M/4), block(32,4) blockDim.x=32=K, blockDim.y=4
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
__global__ void hgemv_k128_f16x4_kernel(half *a, half *x, half *y, int M,
                                        int K) {
  // 每个线程负责4个元素，一个warp覆盖128个元素
  int tx = threadIdx.x;         // 0~31
  int ty = threadIdx.y;         // 0~3
  int bx = blockIdx.x;          // 0~M/4
  int lane = tx % WARP_SIZE;    // 0~31
  int m = blockDim.y * bx + ty; // (0~M/4) * 4 + (0~3)

  if (m < M) {
    half sum = 0.0f;
    // process 4*WARP_SIZE elements per warp.
    int NUM_WARPS = (((K + WARP_SIZE - 1) / WARP_SIZE) + 4 - 1) / 4;
#pragma unroll
    for (int w = 0; w < NUM_WARPS; ++w) {
      int k = (w * WARP_SIZE + lane) * 4;
      half2 reg_x_0 = HALF2(x[k + 0]);
      half2 reg_x_1 = HALF2(x[k + 2]);
      half2 reg_a_0 = HALF2(a[m * K + k + 0]);
      half2 reg_a_1 = HALF2(a[m * K + k + 2]);
      sum += (reg_x_0.x * reg_a_0.x + reg_x_0.y * reg_a_0.y +
              reg_x_1.x * reg_a_1.x + reg_x_1.y * reg_a_1.y);
    }
    sum = warp_reduce_sum_f16<WARP_SIZE>(sum);
    if (lane == 0)
      y[m] = sum;
  }
}

// HGEMV: Warp HGEMV K16
// 假设K为16 < 32,每个warp负责2行，每行有16个元素
// NUM_THREADS=128, NUM_WARPS=NUM_THREADS/WARP_SIZE;
// NUM_ROWS=NUM_WARPS * ROW_PER_WARP, grid(M/NUM_ROWS), block(32,NUM_WARPS)
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
template <const int ROW_PER_WARP = 2>
__global__ void hgemv_k16_f16_kernel(half *A, half *x, half *y, int M, int K) {
  constexpr int K_WARP_SIZE = (WARP_SIZE + ROW_PER_WARP - 1) / ROW_PER_WARP;
  int tx = threadIdx.x;      // 0~31
  int ty = threadIdx.y;      // 0~NUM_WARPS
  int bx = blockIdx.x;       // 0~M/NUM_ROWS (NUM_ROWS=NUM_WARPS * ROW_PER_WARP)
  int lane = tx % WARP_SIZE; // 0~31
  int k = lane % K_WARP_SIZE; // 0~15
  // gloabl row of a: MxK and y:Mx1, blockDim.y=NUM_WARPS
  int m = (blockDim.y * bx + ty) * ROW_PER_WARP + lane / K_WARP_SIZE;
  if (m < M) {
    half sum = A[m * K + k] * x[k];
    sum = warp_reduce_sum_f16<K_WARP_SIZE>(sum);
    // 注意是k == 0，而不是lane == 0
    if (k == 0)
      y[m] = sum;
  }
}

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

#define ASSERT_K_IS_MULTIBLE_OF(V)                                             \
  if (K % (V) != 0) {                                                          \
    throw std::runtime_error("K must be multiple of " #V);                     \
  }

#define ASSERT_K_IS_EQUAL_OF(V)                                                \
  if (K != (V)) {                                                              \
    throw std::runtime_error("K must be " #V);                                 \
  }

void hgemv_k32_f16(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(x, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(y, M, 1)
  ASSERT_K_IS_MULTIBLE_OF(32)

  dim3 block(32, 4);
  dim3 grid((M + 4 - 1) / 4);

  hgemv_k32_f16_kernel<<<grid, block>>>(reinterpret_cast<half *>(a.data_ptr()),
                                        reinterpret_cast<half *>(x.data_ptr()),
                                        reinterpret_cast<half *>(y.data_ptr()),
                                        M, K);
}

void hgemv_k128_f16x4(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(x, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(y, M, 1)
  ASSERT_K_IS_MULTIBLE_OF(128)

  dim3 block(32, 4);
  dim3 grid((M + 4 - 1) / 4);

  hgemv_k128_f16x4_kernel<<<grid, block>>>(
      reinterpret_cast<half *>(a.data_ptr()),
      reinterpret_cast<half *>(x.data_ptr()),
      reinterpret_cast<half *>(y.data_ptr()), M, K);
}

void hgemv_k16_f16(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(x, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(y, M, 1)
  ASSERT_K_IS_EQUAL_OF(16)

  constexpr int NUM_THREADS = 128;
  constexpr int ROW_PER_WARP = 2;
  constexpr int NUM_WARPS = NUM_THREADS / WARP_SIZE; // 4
  constexpr int NUM_ROWS = NUM_WARPS * ROW_PER_WARP; // 4 * 2 = 8

  dim3 block(32, NUM_WARPS);
  dim3 grid((M + NUM_ROWS - 1) / NUM_ROWS);

  hgemv_k16_f16_kernel<ROW_PER_WARP>
      <<<grid, block>>>(reinterpret_cast<half *>(a.data_ptr()),
                        reinterpret_cast<half *>(x.data_ptr()),
                        reinterpret_cast<half *>(y.data_ptr()), M, K);
}

extern void hgemv_f16_cute(torch::Tensor, torch::Tensor, torch::Tensor);
extern void hgemv_f16x8_cute(torch::Tensor, torch::Tensor, torch::Tensor);
extern void hgemv_tensor_core_cute(torch::Tensor, torch::Tensor, torch::Tensor);

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(hgemv_k32_f16)
  TORCH_BINDING_COMMON_EXTENSION(hgemv_k128_f16x4)
  TORCH_BINDING_COMMON_EXTENSION(hgemv_k16_f16)
  TORCH_BINDING_COMMON_EXTENSION(hgemv_f16_cute)
  TORCH_BINDING_COMMON_EXTENSION(hgemv_f16x8_cute)
  TORCH_BINDING_COMMON_EXTENSION(hgemv_tensor_core_cute)
}
```

</details>

### `hgemv_cute.cu`（CuTe 三连：TiledCopy / 向量化 / Tensor Core）

<details>
<summary> hgemv_cute.cu </summary>

```c++
#include <cublas_v2.h>
#include <cuda.h> // NOLINT

#include <cute/layout.hpp>
#include <cute/tensor.hpp>
#include <stdlib.h>
#include <torch/extension.h>

using namespace cute;

template <const int kWarpSize = 32>
__device__ __forceinline__ half warp_reduce_sum_f16(half val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

template <typename T_, int NWarpPerBlock_> struct HgemvConfig {
  using T = T_;
  static constexpr int NWarpPerBlock = NWarpPerBlock_;
  static constexpr int NumThreads = NWarpPerBlock * 32;

  static constexpr int BlockM = 16 * NWarpPerBlock;
  static constexpr int BlockN = 8;
  static constexpr int BlockK = 16;

  using MMA_Atom = MMA_Atom<SM80_16x8x16_F16F16F16F16_TN>;
  using TiledMMA = decltype(make_tiled_mma(
      MMA_Atom{},
      make_layout(Shape<Int<NWarpPerBlock>, _1, _1>{}, GenColMajor{})));

  static_assert(size(TiledMMA{}) == NumThreads && size(TiledMMA{}) <= 1024,
                "NumThreads must be less than or equal 1024");
};

template <typename TiledCopy, int BlockM, int BlockK, int WARP_SIZE = 32>
__global__ void hgemv_f16_cute_kernel(half *Aptr, half *Bptr, half *Cptr,
                                      const int M, const int K) {
  using namespace cute;

  int thrid = threadIdx.x + threadIdx.y * blockDim.x;
  int blockid = blockIdx.x;

  int laneid = threadIdx.x % WARP_SIZE;
  int warpid = threadIdx.y;

  auto A = make_tensor(make_gmem_ptr(Aptr),
                       make_layout(make_shape(M, K), make_stride(K, Int<1>{})));
  auto B = make_tensor(make_gmem_ptr(Bptr),
                       make_layout(make_shape(M, K), make_stride(0, Int<1>{})));
  auto C = make_tensor(make_gmem_ptr(Cptr),
                       make_layout(make_shape(M, 1), make_stride(Int<1>{}, 0)));

  auto ABPre = make_identity_tensor(shape(A));
  auto CPre = make_identity_tensor(shape(C));

  auto gA = local_tile(A, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gB = local_tile(B, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gC = local_tile(C, make_shape(Int<BlockM>{}, Int<1>{}),
                       make_coord(blockid, 0));

  auto gABPre = local_tile(ABPre, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                           make_coord(blockid, _));
  auto gCPre = local_tile(CPre, make_shape(Int<BlockM>{}, Int<1>{}),
                          make_coord(blockid, _));

  TiledCopy tiled_copy;
  auto thr_copy = tiled_copy.get_slice(thrid);

  auto tAgA = thr_copy.partition_S(gA);
  auto tBgB = thr_copy.partition_S(gB);

  auto rABPre = thr_copy.partition_S(gABPre);

  int num_tile_k = size<2>(gA);

  auto tArA = make_tensor_like(tAgA(_, _, _, 0));
  auto tBrB = make_tensor_like(tBgB(_, _, _, 0));

  auto sum = make_tensor_like(gC(0, _));
  clear(sum);

#pragma unroll
  for (int num_iter_k = 0; num_iter_k < num_tile_k; num_iter_k++) {
    auto pre_ = rABPre(_, _, _, num_iter_k);
    auto pred = [&](auto... coords) {
      return cute::elem_less(pre_(0), shape(A));
    };

    clear(tArA);
    copy_if(tiled_copy, pred, tAgA(_, _, _, num_iter_k), tArA);
    clear(tBrB);
    copy_if(tiled_copy, pred, tBgB(_, _, _, num_iter_k), tBrB);

    sum(0) += tArA(0) * tBrB(0);
  }

  sum(0) = warp_reduce_sum_f16<WARP_SIZE>(sum(0));

  auto stord_pred = [&](auto... coords) {
    return cute::elem_less(gCPre(warpid), shape(C)) && laneid == 0;
  };
  copy_if(stord_pred, sum, gC(warpid, _));
}

template <typename TiledCopy, int BlockM, int BlockK, int NumElemPerThread,
          int WARP_SIZE = 32>
__global__ void hgemv_f16x8_cute_kernel(half *Aptr, half *Bptr, half *Cptr,
                                        const int M, const int K) {
  using namespace cute;

  int thrid = threadIdx.x + threadIdx.y * blockDim.x;
  int blockid = blockIdx.x;

  int laneid = threadIdx.x % WARP_SIZE;
  int warpid = threadIdx.y;

  auto A = make_tensor(make_gmem_ptr(Aptr),
                       make_layout(make_shape(M, K), make_stride(K, Int<1>{})));
  auto B = make_tensor(make_gmem_ptr(Bptr),
                       make_layout(make_shape(M, K), make_stride(0, Int<1>{})));
  auto C = make_tensor(make_gmem_ptr(Cptr),
                       make_layout(make_shape(M, 1), make_stride(Int<1>{}, 0)));

  auto ABPre = make_identity_tensor(shape(A));
  auto CPre = make_identity_tensor(shape(C));

  auto gA = local_tile(A, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gB = local_tile(B, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gC = local_tile(C, make_shape(Int<BlockM>{}, Int<1>{}),
                       make_coord(blockid, 0));

  auto gABPre = local_tile(ABPre, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                           make_coord(blockid, _));
  auto gCPre = local_tile(CPre, make_shape(Int<BlockM>{}, Int<1>{}),
                          make_coord(blockid, _));

  TiledCopy tiled_copy;
  auto thr_copy = tiled_copy.get_slice(thrid);

  auto tAgA = thr_copy.partition_S(gA);
  auto tBgB = thr_copy.partition_S(gB);
  auto rABPre = thr_copy.partition_S(gABPre);

  int num_tile_k = size<2>(gA);

  auto tArA = make_tensor_like(tAgA(_, _, _, 0));
  auto tBrB = make_tensor_like(tBgB(_, _, _, 0));

  auto sum = make_tensor_like(gC(0, _));
  clear(sum);

#pragma unroll
  for (int iter_k = 0; iter_k < num_tile_k; iter_k++) {
    auto pre_ = rABPre(_, _, _, iter_k);
    auto pred = [&](auto... coords) {
      return cute::elem_less(pre_(NumElemPerThread - 1), shape(A));
    };

    clear(tArA);
    copy_if(tiled_copy, pred, tAgA(_, _, _, iter_k), tArA);
    clear(tBrB);
    copy_if(tiled_copy, pred, tBgB(_, _, _, iter_k), tBrB);

    auto tArA_half2 = recast<half2>(tArA);
    auto tBrB_half2 = recast<half2>(tBrB);
    auto sum_half2 = make_tensor<half2>(make_shape(Int<1>{}));

#pragma unroll
    for (int iter_elem = 0; iter_elem < size(tArA_half2); iter_elem++) {
      sum_half2(0) =
          tArA_half2(iter_elem) * tBrB_half2(iter_elem) + sum_half2(0);
    }

    sum(0) += sum_half2(0).x + sum_half2(0).y;
  }

  sum(0) = warp_reduce_sum_f16<WARP_SIZE>(sum(0));

  auto stord_pred = [&](auto... coords) {
    return cute::elem_less(gCPre(warpid), shape(C)) && laneid == 0;
  };
  copy_if(stord_pred, sum, gC(warpid, _));
}

// using tensor core
template <typename HgemvConfig_>
__global__ void hgemv_tensor_core_cute_kernel(typename HgemvConfig_::T *Aptr,
                                              typename HgemvConfig_::T *Bptr,
                                              typename HgemvConfig_::T *Cptr,
                                              const int M, const int K) {
  using namespace cute;

  using T = typename HgemvConfig_::T;
  using TiledMMA = typename HgemvConfig_::TiledMMA;
  constexpr int BlockM = HgemvConfig_::BlockM;
  constexpr int BlockN = HgemvConfig_::BlockN;
  constexpr int BlockK = HgemvConfig_::BlockK;

  int thrid = threadIdx.x;
  int blockid = blockIdx.x;

  int warpid = threadIdx.x / 32;
  int laneid = threadIdx.x % 32;

  auto A = make_tensor(make_gmem_ptr(Aptr),
                       make_layout(make_shape(M, K), make_stride(K, Int<1>{})));
  auto B = make_tensor(make_gmem_ptr(Bptr),
                       make_layout(make_shape(M, K), make_stride(0, Int<1>{})));
  auto C = make_tensor(make_gmem_ptr(Cptr),
                       make_layout(make_shape(M, 1), make_stride(Int<1>{}, 0)));

  auto ABPre = make_identity_tensor(shape(A));
  auto CPre = make_identity_tensor(shape(C));

  auto gA = local_tile(A, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gB = local_tile(B, make_shape(Int<BlockN>{}, Int<BlockK>{}),
                       make_coord(blockid, _));
  auto gC = local_tile(C, make_shape(Int<BlockM>{}, Int<1>{}),
                       make_coord(blockid, 0));

  auto gABPre = local_tile(ABPre, make_shape(Int<BlockM>{}, Int<BlockK>{}),
                           make_coord(blockid, _));
  auto gCPre = local_tile(CPre, make_shape(Int<BlockM>{}, Int<1>{}),
                          make_coord(blockid, _));

  TiledMMA tiled_mma;
  auto thr_mma = tiled_mma.get_slice(thrid);
  auto tAgA = thr_mma.partition_A(gA);
  auto tBgB = thr_mma.partition_B(gB);

  auto rAPre = thr_mma.partition_A(gABPre);
  auto rBPre = thr_mma.partition_B(gABPre);

  auto tArA = make_tensor_like(tAgA(_, _, _, 0));
  auto tBrB = make_tensor_like(tBgB(_, _, _, 0));

  auto tCrC =
      partition_fragment_C(tiled_mma, Shape<Int<BlockM>, Int<BlockN>>{});

  clear(tCrC);

  int num_tile_k = size<2>(gA);
#pragma unroll
  for (int itile = 0; itile < num_tile_k; itile++) {
    auto pre_A = rAPre(_, _, _, itile);
    auto pre_B = rBPre(_, _, _, itile);
    auto pred_A = [&](auto... coords) {
      return cute::elem_less(pre_A(coords...), shape(A));
    };
    auto pred_B = [&](auto... coords) {
      return cute::elem_less(pre_B(coords...), shape(A));
    };

    clear(tArA);
    copy_if(pred_A, tAgA(_, _, _, itile), tArA);
    clear(tBrB);
    copy_if(pred_B, tBgB(_, _, _, itile), tBrB);

    gemm(tiled_mma, tArA, tBrB, tCrC);
  }

  int elem_index1 = warpid * 16 + laneid / 4;
  int elem_index2 = warpid * 16 + laneid / 4 + 8;

  auto sum = make_tensor_like(gC(0, _));
  sum(0) = tCrC(0);
  auto elem_pred1 = [&](auto... coords) {
    return (laneid % 4 == 0) && cute::elem_less(gCPre(elem_index1), shape(C));
  };
  copy_if(elem_pred1, sum, gC(elem_index1, _));

  sum(0) = tCrC(2);
  auto elem_pred2 = [&](auto... coords) {
    return (laneid % 4 == 0) && cute::elem_less(gCPre(elem_index2), shape(C));
  };
  copy_if(elem_pred2, sum, gC(elem_index2, _));
}

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

#define ASSERT_K_IS_MULTIBLE_OF(V)                                             \
  if (K % (V) != 0) {                                                          \
    throw std::runtime_error("K must be multiple of " #V);                     \
  }

#define ASSERT_K_IS_EQUAL_OF(V)                                                \
  if (K != (V)) {                                                              \
    throw std::runtime_error("K must be " #V);                                 \
  }

void hgemv_f16_cute(torch::Tensor A, torch::Tensor B, torch::Tensor C) {

  CHECK_TORCH_TENSOR_DTYPE(A, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(B, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(C, torch::kHalf)
  const int M = A.size(0);
  const int K = A.size(1);
  CHECK_TORCH_TENSOR_SHAPE(A, M, K)
  CHECK_TORCH_TENSOR_SHAPE(B, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(C, M, 1)
  // ASSERT_K_IS_MULTIBLE_OF(8)

  constexpr int NumThreadPerRow = 32;
  constexpr int NumThreadPerBlock = 128;
  constexpr int NumRowPerBlcok = NumThreadPerBlock / 32;

  using LoadType = uint16_t;

  constexpr int NumElemPerThread = sizeof(LoadType) / sizeof(half);

  using CopyAtom = Copy_Atom<UniversalCopy<LoadType>, half>;
  using TiledCopy = decltype(make_tiled_copy(
      CopyAtom{},
      make_layout(Shape<Int<NumRowPerBlcok>, Int<NumThreadPerRow>>{},
                  GenRowMajor{}),
      make_layout(Shape<_1, Int<NumElemPerThread>>{}, GenRowMajor{})));

  dim3 blcok(NumThreadPerRow, NumRowPerBlcok);
  dim3 grid(ceil_div(M, NumRowPerBlcok));

  hgemv_f16_cute_kernel<TiledCopy, NumRowPerBlcok,
                        NumThreadPerRow * NumElemPerThread>
      <<<grid, blcok>>>(reinterpret_cast<half *>(A.data_ptr()),
                        reinterpret_cast<half *>(B.data_ptr()),
                        reinterpret_cast<half *>(C.data_ptr()), M, K);
}

void hgemv_f16x8_cute(torch::Tensor A, torch::Tensor B, torch::Tensor C) {
  CHECK_TORCH_TENSOR_DTYPE(A, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(B, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(C, torch::kHalf)
  const int M = A.size(0);
  const int K = A.size(1);
  CHECK_TORCH_TENSOR_SHAPE(A, M, K)
  CHECK_TORCH_TENSOR_SHAPE(B, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(C, M, 1)
  ASSERT_K_IS_MULTIBLE_OF(8)

  constexpr int NumThreadPerRow = 32;
  constexpr int NumThreadPerBlock = 128;
  constexpr int NumRowPerBlcok = NumThreadPerBlock / 32;

  using LoadType = uint128_t;

  constexpr int NumElemPerThread = sizeof(LoadType) / sizeof(half);

  using CopyAtom = Copy_Atom<UniversalCopy<LoadType>, half>;
  using TiledCopy = decltype(make_tiled_copy(
      CopyAtom{},
      make_layout(Shape<Int<NumRowPerBlcok>, Int<NumThreadPerRow>>{},
                  GenRowMajor{}),
      make_layout(Shape<_1, Int<NumElemPerThread>>{}, GenRowMajor{})));

  dim3 blcok(NumThreadPerRow, NumRowPerBlcok);
  dim3 grid(ceil_div(M, NumRowPerBlcok));

  hgemv_f16x8_cute_kernel<TiledCopy, NumRowPerBlcok,
                          NumThreadPerRow * NumElemPerThread, NumElemPerThread>
      <<<grid, blcok>>>(reinterpret_cast<half *>(A.data_ptr()),
                        reinterpret_cast<half *>(B.data_ptr()),
                        reinterpret_cast<half *>(C.data_ptr()), M, K);
}

void hgemv_tensor_core_cute(torch::Tensor A, torch::Tensor B, torch::Tensor C) {

  CHECK_TORCH_TENSOR_DTYPE(A, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(B, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(C, torch::kHalf)
  const int M = A.size(0);
  const int K = A.size(1);
  CHECK_TORCH_TENSOR_SHAPE(A, M, K)
  CHECK_TORCH_TENSOR_SHAPE(B, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(C, M, 1)
  // ASSERT_K_IS_MULTIBLE_OF(8)

  using config = HgemvConfig<half, 4>;

  dim3 blcok(size(config::NumThreads));
  dim3 grid(ceil_div(M, config::BlockM));

  hgemv_tensor_core_cute_kernel<config>
      <<<grid, blcok>>>(reinterpret_cast<half *>(A.data_ptr()),
                        reinterpret_cast<half *>(B.data_ptr()),
                        reinterpret_cast<half *>(C.data_ptr()), M, K);
}
```

</details>

## CUDA Core 三连：F32 → F16 换引擎，架构不动

对照 16 篇，三个 kernel 一一对应（k32 / k128x4 / k16），骨架逐行相同，只有三处 F16 化的具体变化：

1. **归约类型**：`warp_reduce_sum_f16` 在 `half` 上做 `__shfl_xor_sync`——shuffle 交换的是 32-bit 寄存器，half 只占低 16 位，交换后取回的还是自己的 half，功能等价。**注意累加链全程 F16**（`half sum` 一路加到底），而 06/07 篇 layer-norm/rms-norm 的规矩是"F32 acc 保精度"——GEMV 这里没这么做，精度换带宽是 dtype 系列的一贯取舍（16 篇提过 GEMV 是访存受限算子，F32 acc 会让寄存器压力翻倍，且输出本来就是 half）。
2. **向量化从 float4 变 half2×2**：`k128_f16x4` 里一个线程还是吃 4 个元素，但 F16 下 4 个元素只有 8 字节，load 用两条 `HALF2`（half2 = 4 字节）拆开做——half2 硬件指令一次算两个乘加（`reg_x_0.x * reg_a_0.x + reg_x_0.y * reg_a_0.y` 这类成对展开就是 half2 算术的形状）。**64 字节的 float4 在 F16 世界变成 128 字节的"half8"，但代码选择 2×half2 而非一条 128bit load**——见 `hgemv_f16x8_cute` 那边的对照。
3. **k16 的"双行双归约"原样保留**：`warp_reduce_sum_f16<16>` 两小组独立归约 + `k == 0` 选双组长，原理 16 篇已拆过，不重讲。

实测与 F32 对照（M=1024）：

| 版本 | F32 (16篇) | F16 (本篇) |
|---|---|---|
| k32 | 0.00283 ms | 0.00301 ms |
| k128 向量化 | 0.00276 ms | 0.00293 ms |
| torch.matmul | 0.00766 ms | 0.00785 ms |

F16 版**没有更快**（还略慢 6%）——这个 shape 下两者都在 launch 开销和访存延迟的地板上，数据量减半省不了已到Bottom的固定开销。再次验证 16 篇的结论：**2.8μs 量级的 kernel，优化关键路径不在算力和带宽**。

## CuTe 三连：同一算法的三种抽象层级

`hgemv_cute.cu` 是 19 篇（hgemm-cute）之后第一次系统看 CuTe 在"非 GEMM"问题上的用法。三个版本对应三步抽象升级：

### cute 版 1：`hgemv_f16_cute`——TiledCopy 管数据搬运

数据流与手写版完全同构（每 warp 一行、K 维轮次循环、warp 归约、lane 0 落盘），但"哪个线程读哪个元素"这件事不再手写下标，而是交给 CuTe 的布局代数：

```c++
using CopyAtom = Copy_Atom<UniversalCopy<uint16_t>, half>;  // 每线程 1 个 half
using TiledCopy = decltype(make_tiled_copy(
    CopyAtom{},
    make_layout(Shape<_4, _32>{}, GenRowMajor{}),   // 128 线程排成 4 行 × 32 列
    make_layout(Shape<_1, _1>{}, GenRowMajor{})));  // 每线程 1×1 值布局
// kernel 里：
auto tAgA = thr_copy.partition_S(gA);   // 自动算出"我该读 A 的哪些元素"
copy_if(tiled_copy, pred, tAgA(...), tArA);  // 带 predicate 的边界安全拷贝
```

三个 CuTe 核心对象（19 篇的基础在这里全部用到，只列新意）：
- **identity tensor 做 predicate**：`make_identity_tensor` 生成一个"元素值=自身坐标"的逻辑张量，`partition_S` 之后 `elem_less(pre_(0), shape(A))` 就是"我该读的坐标没越界"——**边界判断也被布局代数接管**，手写版的 `if (m < M)` 变成了 copy_if 的谓词参数。
- **B 的 stride 技巧**：x 向量被包装成 `(M,K)` 形状、stride `(0,1)` 的张量——M 维 stride 为 0，所有行"共享"同一个 x，和手写版每个 warp 读同一段 x 完全对应，但表达成了统一的 2D layout。
- **写回仍用 warp 原语**：归约后 `copy_if(stord_pred, sum, gC(warpid, _))`，谓词是 `laneid == 0`——CuTe 管 layout，硬件细节（哪个 lane 代表本行）还是手写。**抽象不是全盘接管，分工明确**。

### cute 版 2：`hgemv_f16x8_cute`——换一个 CopyAtom 就向量化

和版 1 的 kernel 代码逐行相同，唯一的区别在 host 侧：

```c++
using LoadType = uint128_t;   // 版1是 uint16_t
constexpr int NumElemPerThread = sizeof(LoadType) / sizeof(half);  // 16 → 8 个 half
```

每线程从 1 个 half 变 8 个 half（128bit load），kernel 内部用 `recast<half2>` 把寄存器张量重解释成 half2 做成对乘加。**这就是 CuTe 的卖点**：手写版要重新推导下标公式、重写 load 指令的"k128 版本"，CuTe 版只换一个 CopyAtom 类型参数，partition 自动重排所有下标。实测两者打平（0.00290 vs 0.00297 ms）——又是那个老结论，小 shape 下向量化省的指令不在关键路径。

### cute 版 3：`hgemv_tensor_core_cute`——MMA Atom 上阵，反而最慢

用 `SM80_16x8x16_F16F16F16F16_TN` MMA Atom（17 篇的主角）做 GEMV：

```c++
using MMA_Atom = MMA_Atom<SM80_16x8x16_F16F16F16F16_TN>;
using TiledMMA = decltype(make_tiled_mma(MMA_Atom{},
    make_layout(Shape<_4, _1, _1>{}, GenColMajor{})));  // 4 个 warp 坚排
// 每次 gemm(tiled_mma, tArA, tBrB, tCrC) 算一个 16x8x16 的 MMA 小块
```

关键问题来了：**为什么 Tensor Core 版慢 55%**？把 GEMV 硬塞进 MMA 的框里，三个别扭之处：

1. **N 维浪费**：MMA 的最小形状是 16×8×16，GEMV 的 N=1——16×8 的输出块里 8 列只用 1 列，**Tensor Core 7/8 的乘加算力直接扔掉**。MMA 是为"N 也很大"设计的流水线，N=1 时它退化成昂贵的 16 倍冗余计算器。
2. **数据布局要迁就 MMA**：A 的 16×16 片、x 的 8×16 片要按 MMA 的寄存器所有权切分（`partition_A/B`），每个线程拿到的片段与其"真正想算的那一行"不再对齐——**warp 内自然分工被打破**，末尾还要用 `laneid / 4`、`tCrC(0)/tCrC(2)` 这样的 MMA 输出布局知识把结果拼回 y[m]（对照版 1 干净的 `laneid == 0`）。
3. **16 篇的结论没有变**：GEMV 是访存受限算子（算术强度 1:1），Tensor Core 提升的是算力上限，**对一个带宽封顶的问题堆算力没有意义**——A 必须从显存读一遍这件事没有任何 kernel 能省掉。

这就是本篇最重要的设计课：**Tensor Core 不是"更高级所以更快"，它是特定形状（大 M、大 N、大 K）的专用加速器**。GEMV 的小 N 使它的收益前提不成立。LLM decode 场景真正用 Tensor Core 的方式是**把多个请求的 GEMV 拼回 GEMM**（batch > 1 或 continuous batching），用 N 维的宽度喂满 MMA——而不是给单个 GEMV 上 MMA。

## 四路实现的对照表

| 维度 | k32_f16（手写） | f16_cute | f16x8_cute | tensor_core_cute |
|---|---|---|---|---|
| 计算引擎 | CUDA Core FMA | CUDA Core FMA | CUDA Core half2 | Tensor Core MMA |
| 数据分工 | 手写下标 | TiledCopy (1 half/线程) | TiledCopy (8 half/线程) | MMA partition |
| 边界处理 | `if (m < M)` | copy_if 谓词 | copy_if 谓词 | copy_if 谓词 |
| 归约 | warp shuffle | warp shuffle | warp shuffle | MMA 累加器内建 |
| 耗时 | 0.00301 | 0.00290 | 0.00297 | 0.00468 ms |

规律一目了然：**换抽象（手写→CuTe）不改变性能本质，换引擎（CUDA Core→Tensor Core）只有形状匹配时才有收益**。

## 环境坑记录

- `hgemv_cute.cu` 第一行 `#include <cublas_v2.h>` 需要 cublas 的头文件路径，pip wheel 的 include 分散在 `site-packages/nvidia/cublas/include`（环境搭建笔记里记过 lib 的软链问题，include 同理）。JIT 编译时 export `CPATH` 把它加进去即可，不需要改代码：
  ```bash
  export CPATH=$CONDA_PREFIX/lib/python3.11/site-packages/nvidia/cublas/include:\
  $CONDA_PREFIX/lib/python3.11/site-packages/nvidia/cuda_runtime/include
  ```
- CuTe 版需要 cutlass 头文件：本仓库用 `third-party/cutlass` submodule（旧仓库 lingchen/LeetCUDA 已带，新仓库没有 submodule 的话 clone 时要 `--recursive` 或用镜像补齐）。

## 本篇小结

1. **F32→F16 的 GEMV 是换引擎不换架构**：三个 kernel 与 sgemv 逐行对应，变化在 half 归约、half2 乘加、k16 双行保留；同 shape 下 F16 并不比 F32 快——小 kernel 的耗时地板在 launch 和访存延迟。
2. **CuTe 的价值是下标代数自动化**：TiledCopy + identity tensor 谓词把"谁读谁写"和边界检查交给布局推导，向量化版本只换一个 CopyAtom 参数——手写三小时的下标活一行换完。
3. **Tensor Core 做 GEMV 是负优化**（实测慢 55%）：MMA 的 16×8×16 最小形状在 N=1 时浪费 7/8 算力、寄存器所有权打破自然分工、且访存受限问题堆算力无意义。
4. **decode 场景的正确姿势**：不是给单条 GEMV 上 Tensor Core，而是 continuous batching 把多条 GEMV 拼成 GEMM 用 N 维宽度喂 MMA——问题形状决定引擎选择。
5. **抽象与性能的关系**：四个版本同构（每 warp 一行 + warp 归约），CuTe 版打平手写版——抽象层省的是开发时间不是运行时间；性能来自正确的形状匹配（k32 的"一行一 warp"），不来自工具的高级程度。
