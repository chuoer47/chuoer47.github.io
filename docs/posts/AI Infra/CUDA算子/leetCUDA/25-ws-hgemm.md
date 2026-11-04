---
title: Warp Specialization HGEMM
order: 25
---

# Warp Specialization HGEMM：生产者-消费者模型的 GPU 形态

> 本人学习笔记，AI总结

18/19 篇的 HGEMM 里所有线程"人人有活干"：前半程拷贝 gmem→smem、`__syncthreads()`、后半程算 MMA——**同一批线程在搬运和计算两个角色之间来回切换**。Warp Specialization（WS）是另一种分工哲学：**固定分工，有的 warp 专职搬数据（producer），其余专职算（consumer），用流水线原语而非 `__syncthreads` 通信**。这是 Hopper（sm_90）的 TMA/WGMMA kernel 的标准架构（CUTLASS 的 `KernelScheduleSm90` 系全是 WS），但本篇证明它**在 Ada（sm_89）上用 cp.async + cuda::pipeline 就能搭**——`kernels/ws-hgemm/` 这个单文件实现是读懂 Hopper GEMM 之前的最后一课。

实测（4090, 4096³, F16, warmup 10 / iters 100）：

| kernel | 耗时 | 相对 |
|---|---|---|
| ws_hgemm_naive_cute | 0.673 ms | 1.00x |
| torch.matmul (F16) | 0.897 ms | 1.33x |

手写 WS 版超过 torch 33%（对照 17 篇纯 MMA 版 150 TFLOPS 的成绩，naive WS 还有距离——它是**架构教学实现**，不是性能极限）。README 里记录的早期版本 3.72ms 是配置未调优时的基线。

## 问题的本质：为什么"人人切换"不够好

15 篇的 double buffer（ping-pong smem）已经是"搬运和计算重叠"了，但它重叠在**时间维度**上：同一批线程，这一轮搬、下一轮算，靠 compiler 把访存指令塞进计算间隙。WS 把重叠搬到**空间维度**：

```
18/19 篇（切换式）:            本篇（分工式）:
线程 0~255:                    线程 0~31  (producer):  死循环 cp.async
  [搬 K tile 0]                线程 32~127 (consumer): 死循环 mma
  sync
  [算 K tile 0]                两者只在 smem 的环形缓冲上握手，
  [搬 K tile 1]                producer 永不碰 mma，consumer 永不碰 gmem
  sync
  [算 K tile 1]
```

分工式的收益来源：① producer 的拷贝循环可以**不与 consumer 同步地连续跑**（环形缓冲没满就一直搬）——深流水线不再受"sync 粒度"限制；② consumer 寄存器完全不被地址计算和访存指令污染，MMA 背靠背排布密度更高；③ 这正是 Hopper TMA（硬件异步拷贝引擎）天然要求的软件形态——**在 Ada 上先练好分工，到 Hopper 只需把 producer 的手写循环换成一条 TMA 指令**。

## 完整代码

<details>
<summary> naive_ws_hgemm_sm8x.cu </summary>

```c++
#pragma once
#include "cooperative_groups.h"
#include "cuda/pipeline"
#include "cute/tensor.hpp"
#include <cooperative_groups/memcpy_async.h>
#include <torch/extension.h>
#include <torch/types.h>

#define DEVICE __device__ __forceinline__

using namespace cute;

template <class CTATile, int ProducerThread, int Stage> struct WSHGEMMTraits {
  using MatrixTypeAB = half;
  using AccType = half;

  constexpr static int kCTAM = get<0>(CTATile{});
  constexpr static int kCTAN = get<1>(CTATile{});
  constexpr static int kCTAK = get<2>(CTATile{});
  constexpr static int kStage = Stage;

  // MMA Trait
  using mma_op = SM80_16x8x16_F16F16F16F16_TN;
  using mma_traits = MMA_Traits<mma_op>;
  using mma_atom = MMA_Atom<mma_traits>;
  using mma_atom_shape = mma_traits::Shape_MNK;

  constexpr static int kMmaThrLayoutM = 2;
  constexpr static int kMmaThrLayoutN = 2;
  constexpr static int kMmaThrLayoutK = 1;

  constexpr static int kMmaPermuteM = kMmaThrLayoutM * get<0>(mma_atom_shape{});
  constexpr static int kMmaPermuteN =
      2 * kMmaThrLayoutN * get<1>(mma_atom_shape{});
  constexpr static int kMmaPermuteK = kMmaThrLayoutK * get<2>(mma_atom_shape{});

  using MmaThrLayout = decltype(make_layout(make_shape(
      Int<kMmaThrLayoutM>{}, Int<kMmaThrLayoutN>{}, Int<kMmaThrLayoutK>{})));

  using MmaPermutation = decltype(make_tile(
      Int<kMmaPermuteM>{}, Int<kMmaPermuteN>{}, Int<kMmaPermuteK>{}));

  // The expanded TiledMMA can process matrices of size 32x32x16 in a single
  // operation.
  using TiledMMA =
      decltype(make_tiled_mma(mma_atom{}, MmaThrLayout{}, MmaPermutation{}));

  constexpr static int kConsumerThread = size(TiledMMA{});
  // To avoid warp divergence
  static_assert(ProducerThread % 32 == 0,
                "The number of ProducerThreads must be a multiple of 32");
  constexpr static int kProducerThread = ProducerThread;
  constexpr static int kAllThread = kProducerThread + kConsumerThread;

  // Smem
  constexpr static int kSwizzleB = 3;
  constexpr static int kSwizzleM = 3;
  constexpr static int kSwizzleS = 3;

  using SmemLayoutAtom =
      decltype(composition(Swizzle<kSwizzleB, kSwizzleM, kSwizzleS>{},
                           make_layout(make_shape(Int<8>{}, Int<kCTAK>{}),
                                       make_stride(Int<kCTAK>{}, Int<1>{}))));

  using SmemLayoutA = decltype(tile_to_shape(
      SmemLayoutAtom{}, make_shape(Int<kCTAM>{}, Int<kCTAK>{}, Int<kStage>{})));

  using SmemLayoutB = decltype(tile_to_shape(
      SmemLayoutAtom{}, make_shape(Int<kCTAN>{}, Int<kCTAK>{}, Int<kStage>{})));

  constexpr static int kSmemSizeA = cosize(SmemLayoutA{});
  constexpr static int kSmemSizeB = cosize(SmemLayoutB{});
  constexpr static int kSmemAllocateAB =
      (kSmemSizeA + kSmemSizeB) * sizeof(MatrixTypeAB);

  constexpr static int kSmemStageAcc = 2;
  using SmemLayoutAcc = decltype(tile_to_shape(
      SmemLayoutAtom{}, make_shape(Int<kMmaPermuteM>{}, Int<kMmaPermuteN>{},
                                   Int<kSmemStageAcc>{})));

  constexpr static int kSmemSizeAcc = cosize(SmemLayoutAcc{});
  constexpr static int kSmemAllocateAcc = kSmemSizeAcc * sizeof(AccType);
  constexpr static int kAllSmemAllocate =
      cute::max(kSmemAllocateAB, kSmemAllocateAcc);

  // Producer g2s copy
  using g2s_copy_op = SM80_CP_ASYNC_CACHEGLOBAL<cute::uint128_t>;
  using g2s_copy_traits = Copy_Traits<g2s_copy_op>;
  using g2s_copy_atom = Copy_Atom<g2s_copy_traits, MatrixTypeAB>;

  constexpr static int g2s_thread_vec_size =
      sizeof(cute::uint128_t) / sizeof(MatrixTypeAB);
  constexpr static int g2s_thread_k = kCTAK / g2s_thread_vec_size;
  constexpr static int g2s_thread_m = kProducerThread / g2s_thread_k;

  using G2SCopyA = decltype(make_tiled_copy(
      g2s_copy_atom{},
      make_layout(make_shape(Int<g2s_thread_m>{}, Int<g2s_thread_k>{}),
                  make_stride(Int<g2s_thread_k>{}, Int<1>{})),
      make_layout(make_shape(Int<1>{}, Int<g2s_thread_vec_size>{}))));

  using G2SCopyB = G2SCopyA;

  // Consumer s2r copy
  using s2r_copy_op = SM75_U32x4_LDSM_N;
  using s2r_copy_traits = Copy_Traits<s2r_copy_op>;
  using s2r_copy_atom = Copy_Atom<s2r_copy_traits, MatrixTypeAB>;

  using S2RCopyA = s2r_copy_atom;
  using S2RCopyB = s2r_copy_atom;

  // Consumer r2s copy
  using R2SCopyC = Copy_Atom<UniversalCopy<int>, AccType>;

  // Consumer s2g copy
  using S2GCopyAtomC = Copy_Atom<UniversalCopy<cute::uint128_t>, AccType>;
  constexpr static int s2g_thread_vec_size =
      sizeof(cute::uint128_t) / sizeof(AccType);
  constexpr static int s2g_thread_n = kMmaPermuteN / s2g_thread_vec_size;
  constexpr static int s2g_thread_m = kConsumerThread / s2g_thread_n;

  using S2GCopyC = decltype(make_tiled_copy(
      S2GCopyAtomC{},
      make_layout(make_shape(Int<s2g_thread_m>{}, Int<s2g_thread_n>{}),
                  make_stride(Int<s2g_thread_n>{}, Int<1>{})),
      make_layout(make_shape(Int<1>{}, Int<s2g_thread_vec_size>{}))));

  struct Arguments {
    void *a_ptr;
    void *b_ptr;
    void *c_ptr;

    using Gemm_Shape = Shape<int, int, int>;

    Gemm_Shape problem_shape;
    Gemm_Shape tile_shape;

    Arguments() = delete;
    Arguments(Gemm_Shape problem_shape_, void *a_ptr_, void *b_ptr_,
              void *c_ptr_)
        : problem_shape(problem_shape_), a_ptr(a_ptr_), b_ptr(b_ptr_),
          c_ptr(c_ptr_) {
      int m = size<0>(problem_shape);
      int n = size<1>(problem_shape);
      int k = size<2>(problem_shape);

      int m_tiles = ceil_div(m, kCTAM);
      int n_tiles = ceil_div(n, kCTAN);
      int k_tiles = ceil_div(k, kCTAK);
      tile_shape = make_shape(m_tiles, n_tiles, k_tiles);
    }

    dim3 get_grid() {
      return dim3(ceil_div(get<0>(problem_shape), kCTAM),
                  ceil_div(get<1>(problem_shape), kCTAN));
    }
  };

  template <typename Pipeline, typename AEngine, typename ALayout,
            typename BEngine, typename BLayout>
  DEVICE static auto producer(void *smem_ptr, Pipeline &pipeline,
                              Tensor<AEngine, ALayout> const &gA,
                              Tensor<BEngine, BLayout> const &gB) {
    using T = typename WSHGEMMTraits::MatrixTypeAB;
    constexpr int SmemSizeA = WSHGEMMTraits::kSmemSizeA;
    auto tidx = threadIdx.x;

    T *SmemPtrA = reinterpret_cast<T *>(smem_ptr);
    T *SmemPtrB = SmemPtrA + SmemSizeA;

    auto sA = make_tensor(make_smem_ptr<T>(SmemPtrA),
                          SmemLayoutA{}); // (CTAM, CTAK, Stage)
    auto sB = make_tensor(make_smem_ptr<T>(SmemPtrB),
                          SmemLayoutB{}); // (CTAN, CTAK, Stage)

    G2SCopyA g2s_copy_A;
    auto thr_g2s_copy_A = g2s_copy_A.get_slice(tidx);
    auto g2s_tAgA = thr_g2s_copy_A.partition_S(gA);
    auto g2s_tAsA = thr_g2s_copy_A.partition_D(sA);

    G2SCopyB g2s_copy_B;
    auto thr_g2s_copy_B = g2s_copy_B.get_slice(tidx);
    auto g2s_tBgB = thr_g2s_copy_B.partition_S(gB);
    auto g2s_tBsB = thr_g2s_copy_B.partition_D(sB);

    const auto kNumIterationK = size<2>(gA);
    int g2s_g_read_idx = 0;
    int g2s_s_write_idx = 0;

    for (int iter_k = 0, stage_idx = 0; iter_k < kNumIterationK; iter_k++) {
      for (; stage_idx < kNumIterationK && stage_idx < (iter_k + kStage);
           stage_idx++) {

        pipeline.producer_acquire();

        copy(g2s_copy_A, g2s_tAgA(_, _, _, g2s_g_read_idx),
             g2s_tAsA(_, _, _, g2s_s_write_idx));

        copy(g2s_copy_B, g2s_tBgB(_, _, _, g2s_g_read_idx),
             g2s_tBsB(_, _, _, g2s_s_write_idx));

        pipeline.producer_commit();

        g2s_g_read_idx++;
        g2s_s_write_idx = (g2s_s_write_idx + 1) % kStage;
      }
    }
  }

  template <typename Pipeline, typename CEngine, typename CLayout>
  DEVICE static auto main_loop(Arguments const &args, void *smem_ptr,
                               Pipeline &pipeline,
                               Tensor<CEngine, CLayout> const &gC) {
    using T = typename WSHGEMMTraits::MatrixTypeAB;
    constexpr int SmemSizeA = WSHGEMMTraits::kSmemSizeA;
    auto tidx = threadIdx.x - kProducerThread;

    T *SmemPtrA = reinterpret_cast<T *>(smem_ptr);
    T *SmemPtrB = SmemPtrA + SmemSizeA;

    auto sA = make_tensor(make_smem_ptr<T>(SmemPtrA),
                          SmemLayoutA{}); // (CTAM, CTAK, Stage)
    auto sB = make_tensor(make_smem_ptr<T>(SmemPtrB),
                          SmemLayoutB{}); // (CTAN, CTAK, Stage)

    TiledMMA tiled_mma;
    auto thr_mma = tiled_mma.get_slice(tidx);

    auto tArA = thr_mma.partition_fragment_A(sA(_, _, 0));
    auto tBrB = thr_mma.partition_fragment_B(sB(_, _, 0));
    auto tCrC = thr_mma.partition_fragment_C(gC);
    clear(tCrC);

    // s2r
    auto s2r_copy_A = make_tiled_copy_A(S2RCopyA{}, tiled_mma);
    auto thr_s2r_copy_A = s2r_copy_A.get_slice(tidx);
    auto s2r_tAsA = thr_s2r_copy_A.partition_S(sA);
    auto s2r_tArA_view = thr_s2r_copy_A.retile_D(tArA);

    auto s2r_copy_B = make_tiled_copy_B(S2RCopyB{}, tiled_mma);
    auto thr_s2r_copy_B = s2r_copy_B.get_slice(tidx);
    auto s2r_tBsB = thr_s2r_copy_B.partition_S(sB);
    auto s2r_tBrB_view = thr_s2r_copy_B.retile_D(tBrB);

    const int kNumIterationK = get<2>(args.tile_shape);
    const int kNumInnerStage = size<2>(tArA);

    int s2r_s_read_idx = 0;
    int next_s2r_s_read_idx = 0;

    if (kNumInnerStage > 1) {
      pipeline.consumer_wait();

      copy(s2r_copy_A, s2r_tAsA(_, _, 0, s2r_s_read_idx),
           s2r_tArA_view(_, _, 0));
      copy(s2r_copy_B, s2r_tBsB(_, _, 0, s2r_s_read_idx),
           s2r_tBrB_view(_, _, 0));
    }

    for (int iter_k = 0; iter_k < kNumIterationK; iter_k++) {
#pragma unroll
      for (int inner_stage = 0; inner_stage < kNumInnerStage; inner_stage++) {
        int next_inner_stage = (inner_stage + 1) % kNumInnerStage;

        if (inner_stage == kNumInnerStage - 1 && iter_k < kNumIterationK - 1) {
          pipeline.consumer_wait();
          s2r_s_read_idx = next_s2r_s_read_idx;
        }

        copy(s2r_copy_A, s2r_tAsA(_, _, next_inner_stage, s2r_s_read_idx),
             s2r_tArA_view(_, _, next_inner_stage));

        copy(s2r_copy_B, s2r_tBsB(_, _, next_inner_stage, s2r_s_read_idx),
             s2r_tBrB_view(_, _, next_inner_stage));

        if (inner_stage == 0) {
          pipeline.consumer_release();
          next_s2r_s_read_idx = (s2r_s_read_idx + 1) % kStage;
        }

        gemm(tiled_mma, tArA(_, _, inner_stage), tBrB(_, _, inner_stage), tCrC);
      }
    }

    return tCrC;
  }

  template <typename AccEngine, typename AccLayout, typename CEngine,
            typename CLayout>
  DEVICE static void epilog(Arguments const &args, void *smem_ptr,
                            Tensor<AccEngine, AccLayout> const &acc,
                            Tensor<CEngine, CLayout> &gC) {
    __syncthreads(); // wait all consumer thread finish main_loop

    int tidx = threadIdx.x - kProducerThread;

    auto sC = make_tensor(
        make_smem_ptr<AccType>(smem_ptr),
        SmemLayoutAcc{}); // (kMmaPermuteM, kMmaPermuteN, kSmemStageAcc)

    // r2s
    auto r2s_copy_C = make_tiled_copy_C(R2SCopyC{}, TiledMMA{});
    auto thr_r2s_copy_C = r2s_copy_C.get_slice(tidx);
    auto r2s_tCrC = thr_r2s_copy_C.retile_S(acc);
    auto r2s_tCsC = thr_r2s_copy_C.partition_D(sC);

    auto r2s_tCrC_view = group_modes<1, 3>(r2s_tCrC);

    // s2g
    S2GCopyC s2g_copy_C;
    auto thr_s2g_copy_C = s2g_copy_C.get_slice(tidx);
    auto s2g_tCsC = thr_s2g_copy_C.partition_S(sC);
    auto s2g_tCgC = thr_s2g_copy_C.partition_D(gC);

    auto s2g_tCgC_view = group_modes<1, 3>(s2g_tCgC);

    const int kEpilogIterations = size<1>(r2s_tCrC_view);
    const int kEpilogStages = size<3>(r2s_tCsC);

#pragma unroll
    for (int epilog_iter = 0; epilog_iter < kEpilogIterations;
         epilog_iter += kEpilogStages) {
#pragma unroll
      for (int epilog_stage_idx = 0; epilog_stage_idx < kEpilogStages;
           epilog_stage_idx++) {
        // r2s
        copy(r2s_copy_C, r2s_tCrC_view(_, epilog_iter + epilog_stage_idx),
             r2s_tCsC(_, 0, 0, epilog_stage_idx));
      }
      __syncthreads(); // wait all consumer thread finish r2s

#pragma unroll
      for (int epilog_stage_idx = 0; epilog_stage_idx < kEpilogStages;
           epilog_stage_idx++) {
        // s2g
        copy(s2g_copy_C, s2g_tCsC(_, 0, 0, epilog_stage_idx),
             s2g_tCgC_view(_, epilog_iter + epilog_stage_idx));
      }
      __syncthreads(); // wait all consumer thread finish s2g
    }
  }

  template <typename Pipeline, typename CEngine, typename CLayout>
  DEVICE static void consumer(Arguments const &args, void *smem_ptr,
                              Pipeline &pipeline,
                              Tensor<CEngine, CLayout> &gC) {
    auto tCrC = main_loop(args, smem_ptr, pipeline, gC);
    epilog(args, smem_ptr, tCrC, gC);
  }
};

#pragma nv_diag_suppress static_var_with_dynamic_init
template <typename WSHGEMMTraits>
__global__ void
ws_hgemm_naive_cute_kernel(typename WSHGEMMTraits::Arguments args) {
  using MatrixTypeAB = typename WSHGEMMTraits::MatrixTypeAB;
  using AccType = typename WSHGEMMTraits::AccType;

  constexpr int kCTAM = WSHGEMMTraits::kCTAM;
  constexpr int kCTAN = WSHGEMMTraits::kCTAN;
  constexpr int kCTAK = WSHGEMMTraits::kCTAK;
  constexpr int kStage = WSHGEMMTraits::kStage;

  auto block = cooperative_groups::this_thread_block();
  auto tidx = threadIdx.x;

  auto tile_id_m = blockIdx.x;
  auto tile_id_n = blockIdx.y;

  // set thread role
  const auto thread_role = tidx < WSHGEMMTraits::kProducerThread
                               ? cuda::pipeline_role::producer
                               : cuda::pipeline_role::consumer;
  // create pipeline
  __shared__ cuda::pipeline_shared_state<cuda::thread_scope::thread_scope_block,
                                         kStage>
      shared_state;
  auto pipeline = cuda::make_pipeline(block, &shared_state, thread_role);

  extern __shared__ MatrixTypeAB smem_ptr[];

  auto A =
      make_tensor(make_gmem_ptr<MatrixTypeAB>(args.a_ptr),
                  select<0, 2>(args.problem_shape), GenRowMajor{}); // (M, K)

  auto B =
      make_tensor(make_gmem_ptr<MatrixTypeAB>(args.b_ptr),
                  select<1, 2>(args.problem_shape), GenRowMajor{}); // (N, K)

  auto C =
      make_tensor(make_gmem_ptr<AccType>(args.c_ptr),
                  select<0, 1>(args.problem_shape), GenRowMajor{}); // (M, N)

  auto gA = local_tile(A, make_tile(Int<kCTAM>{}, Int<kCTAK>{}),
                       make_coord(tile_id_m, _)); // (kCTAM, kCTAK, K/kCTAK)

  auto gB = local_tile(B, make_tile(Int<kCTAN>{}, Int<kCTAK>{}),
                       make_coord(tile_id_n, _)); // (kCTAN, kCTAK, K/kCTAK)

  auto gC = local_tile(C, make_tile(Int<kCTAM>{}, Int<kCTAN>{}),
                       make_coord(tile_id_m, tile_id_n)); // (kCTAM, kCTAN)

  // Different thread_roles execute different branches.
  if (thread_role == cuda::pipeline_role::producer) {
    WSHGEMMTraits::producer(smem_ptr, pipeline, gA, gB);
  } else {
    WSHGEMMTraits::consumer(args, smem_ptr, pipeline, gC);
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

inline int get_max_smem_size() {
  int max_shared_mem;
  cudaDeviceGetAttribute(&max_shared_mem,
                         cudaDevAttrMaxSharedMemoryPerBlockOptin, 0);
  return max_shared_mem;
}

template <typename Kernel> void config_smem(Kernel kernel, int smem_size) {
  if (smem_size >= 32 * 1024) {
    if (cudaFuncSetAttribute(kernel,
                             cudaFuncAttributeMaxDynamicSharedMemorySize,
                             smem_size) != cudaSuccess) {
      int max_shared_mem = get_max_smem_size();
      cudaError_t err = cudaGetLastError();
      std::cerr << "Set kernel attribute failed: " << cudaGetErrorString(err)
                << std::endl;
      std::cerr
          << "Kernel required " << smem_size
          << " shared memory but the max shared memory per block optin is: "
          << max_shared_mem << std::endl;
    }
  }
}

// WarpSpecialization HGEMM
void ws_hgemm_naive_cute(torch::Tensor a, torch::Tensor b, torch::Tensor c) {

  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)

  using GEMM_Traits =
      WSHGEMMTraits<decltype(make_shape(_128{}, _256{}, _32{})), 32, 3>;

  // set smem size
  constexpr int smem_size = GEMM_Traits::kAllSmemAllocate;
  config_smem(ws_hgemm_naive_cute_kernel<GEMM_Traits>, smem_size);

  // set problem size
  using Arguments = typename GEMM_Traits::Arguments;
  Arguments args(make_shape(M, N, K), reinterpret_cast<half *>(a.data_ptr()),
                 reinterpret_cast<half *>(b.data_ptr()),
                 reinterpret_cast<half *>(c.data_ptr()));

  constexpr int block_size = GEMM_Traits::kAllThread;

  dim3 block(block_size);
  dim3 grid(args.get_grid());

  ws_hgemm_naive_cute_kernel<GEMM_Traits><<<grid, block, smem_size>>>(args);
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(ws_hgemm_naive_cute)
}
```

</details>

## 逐段剖析

### 1. 角色划分：一个 static_assert 里的设计观

```c++
using GEMM_Traits = WSHGEMMTraits<decltype(make_shape(_128{}, _256{}, _32{})), 32, 3>;
//                                              CTATile: 128x256x32        ↑    ↑
//                                                              32 个 producer  3 级流水
constexpr static int kConsumerThread = size(TiledMMA{});   // 96 个 consumer
constexpr static int kAllThread = kProducerThread + kConsumerThread;  // 128 线程/block
static_assert(ProducerThread % 32 == 0, "...must be a multiple of 32");
```

线程预算先算 MMA 再补 producer：TiledMMA 把 m16n8k16 atom 平铺成 2×2（`kMmaThrLayoutM×N = 2×2`），一次 gemm 吃 32×32×16 → 4 个 warp = 96 consumer（`size(TiledMMA)` 返回线程数 4×32；permute 里 `kMmaPermuteN = 2 * kMmaThrLayoutN * 8 = 32` 的外层 2 是 N 方向 C accumulator 复用）。**producer 是 32——恰好一个 warp**。为什么必须整 warp？注释写着 "To avoid warp divergence"：producer 里全是 warp 级的 cp.async 提交，如果 producer 跨两个 warp 的部分线程，同 warp 内 consumer/producer 混居，`pipeline` 的角色分支就在 warp 内部分叉——divergence 回来了。**角色边界必须与 warp 边界对齐**，这是 WS 的第一条军规。

### 2. cuda::pipeline：把 "__syncthreads + 环形下标" 换成语义原语

```c++
const auto thread_role = tidx < kProducerThread ? producer : consumer;
__shared__ cuda::pipeline_shared_state<thread_scope_block, kStage> shared_state;
auto pipeline = cuda::make_pipeline(block, &shared_state, thread_role);
```

18 篇手写多级流水时，同步靠 `CP_ASYNC_WAIT_GROUP(kStage-2)` + `__syncthreads()` + 手底下标取模。这里换成了 cooperative groups 的块级流水线：`producer_acquire()`（等环形缓冲有空的 stage）、`producer_commit()`（本 stage 数据发出）、`consumer_wait()`（等指定 stage 到货）、`consumer_release()`（本 stage 消费完毕）。`kStage=3` 决定生产最多领先消费 2 个 tile。**语义与 15 篇的 ping-pong 完全同构，但"谁等谁"变成了库的类型系统而不是注释**——`pipeline_shared_state<..., 3>` 编译期声明容量，越界即编译错。Hopper 上 CUTLASS 的 `PipelineTmaAsync` 就是这个抽象的加强版（加 mbarrier 硬件原语），概念迁移零成本。

### 3. producer：只有一个 copy 的函数

```c++
DEVICE static auto producer(void *smem_ptr, Pipeline &pipeline, ...) {
  ...
  for (int iter_k = 0, stage_idx = 0; iter_k < kNumIterationK; iter_k++) {
    for (; stage_idx < kNumIterationK && stage_idx < (iter_k + kStage); stage_idx++) {
      pipeline.producer_acquire();
      copy(g2s_copy_A, ...);   // cp.async.cg 128bit
      copy(g2s_copy_B, ...);
      pipeline.producer_commit();
      g2s_g_read_idx++;
      g2s_s_write_idx = (g2s_s_write_idx + 1) % kStage;
    }
  }
}
```

双层循环的外层是"消费进度"推进、内层是"生产窗口"滑动——`stage_idx < iter_k + kStage` 表达"生产者最多比消费者领先 kStage 个 tile"。拷贝用 `SM80_CP_ASYNC_CACHEGLOBAL<uint128_t>`（cp.async 的 128bit 带 L2 缓存提示版本，19 篇见过它的 CuTe 封装）。注意 **A 和 B 的 smem tile 共用 `SmemLayoutAtom`（Swizzle<3,3,3>，24 篇的 ZigZag 参数化）+ `tile_to_shape` 扩展到 (M,K,Stage)**——swizzle 布局和 stage 环形缓冲的组合在 CuTe 里就是两个 layout 代数的复合，没有一行手写下标。

### 4. consumer 的双重流水：kStage 外环 + kNumInnerStage 内环

main_loop 是全文件最精巧的一段。consumer 内部还有**自己的小流水**：

```c++
for (int iter_k = 0; iter_k < kNumIterationK; iter_k++) {
  for (int inner_stage = 0; inner_stage < kNumInnerStage; inner_stage++) {
    // kNumInnerStage = size<2>(tArA)：一次 smem tile 拆成 MMA 累加器的份数（32x32x16 tile / 32x32x16 MMA = 1，其他配置下 >1）
    if (最后一轮 inner) { pipeline.consumer_wait(); 换 stage; }
    copy(s2r A/B 的下一份);           // 预取下一 inner stage 的寄存器片段
    if (inner == 0) { pipeline.consumer_release(); }
    gemm(tiled_mma, 当前份);
  }
}
```

经典软件流水序：**"读下一份 → 算当前份 → 放掉上一份"在同一个循环体里交错**。`consumer_release` 放在 `inner_stage == 0` 时（本 stage 的第一份已经被吃进寄存器，smem 这一份生命周期结束），producer 因此能提前开始写回环形缓冲的这个槽。对照 18 篇手写版的 `CP_ASYNC_WAIT_GROUP` 时序——语义一致，但这里的时序是"寄存器拷贝/算力/MMA"三层重叠，**寄存器片段的预取把 LDSM 延迟也藏进了 MMA 流**。

### 5. epilog：smem 复用 + r2s/s2g 双段

```c++
constexpr static int kAllSmemAllocate = cute::max(kSmemAllocateAB, kSmemAllocateAcc);
```

 accumulator 的 smem 布局 `SmemLayoutAcc` 和 A/B tile **共用同一块 dynamic smem**（max 而不是加）——main_loop 结束后 A/B 的 stage 缓冲已无用，epilog 把 accumulator 先 r2s 到 smem（带 swizzle），再 s2g 128bit 向量化写回。两段之间两个 `__syncthreads()` 保证 r2s 全员完成才 s2g。这个 smem 复用让 128×256 tile + 3 stage 的总 smem 停在 4090 允许的范围内（sm_89 optin 上限 100KB，`config_smem` 里 `cudaFuncSetAttribute` 是超 48KB 时的标准操作）。

### 6. B 的 RowMajor(K,N) 与 TN 布局

注意 B 建张量是 `select<1, 2>(problem_shape), GenRowMajor{}`——**B 按 (N,K) 行主存**（即逻辑上 Bᵀ），配合 `SM80_16x8x16_F16F16F16F16_TN` 的 TN 语义（A row-major、B col-major = B 存为 (N,K) 行主）。这和 17 篇 mma_tn 的约定一致——SaaS 场景权重通常以 (N,K) 布局驻留显存（同一份权重对所有 batch 复用），TN 避免运行时转置。

## 与 19 篇 CuTe HGEMM 的架构对照

| 维度 | 19 篇（切换式 CuTe） | 本篇（WS CuTe） |
|---|---|---|
| 线程角色 | 全员同质，随阶段切换 | producer 32 / consumer 96 固定 |
| 同步 | `__syncthreads` + cp.async wait_group | cuda::pipeline acquire/commit/wait/release |
| 流水 | smem 双/三级 buffer | smem 3 级 + 寄存器内环流水 |
| swizzle | SmemLayoutAtom 组合 | 相同（Swizzle<3,3,3>） |
| epilog | 直接 s2g 或 r2s | smem 复用 + r2s/s2g 两段 |
| 性能 | ~150 TFLOPS | 0.673ms@4096³ ≈ 100 TFLOPS |

（0.673ms 对应 2×4096³×2/0.673ms ≈ 204 TFLOPS？不对——**F16 的 FLOPs 是 2×M×N×K = 2×6.87e10 = 1.37e11，÷0.673ms ≈ 204 TFLOPS**，这已经超过 17 篇手写 MMA 的成绩。重新校准：17 篇 150 TFLOPS 是 mma_tn 基础版，x4 swizzle 版 149.7 是 4096³；本篇 naive WS 204 TFLOPS 相当于 4090 F16 峰值（330 TFLOPS 稠密）的 62%——**naive 架构就打平了手写调优版**，WS 的架构红利是真实的。)

## 本篇小结

1. **WS = 空间维度的流水线**：15 篇 double buffer 在时间维重叠搬算，WS 把搬/算分给不同 warp 永久专职——producer 深流水不受 sync 粒度限制，consumer 寄存器零访存污染。
2. **角色边界必须对齐 warp 边界**（`ProducerThread % 32 == 0`）：pipeline 角色分支在 warp 内部分叉会引入 divergence，WS 的"32 producer"是 warp 对齐的最小合法单位。
3. **cuda::pipeline 是 __syncthreads+环形下标的类型系统化**：acquire/commit/wait/release 四原语 + 编译期 stage 容量声明；到 Hopper 迁移到 mbarrier/TMA pipeline 概念零成本。
4. **consumer 内环流水**：s2r 预取下一份寄存器片段与当前份 MMA 交错，release 提前到 inner_stage==0——LDSM 延迟藏进 MMA 流，producer 提前回收槽位。
5. **epilog 复用 smem**（max(A+B, Acc)）：accumulator 经 swizzled smem 中转 r2s→s2g，比直写 gmem 的向量化更可控，smem 预算靠 max 复用压下来。
6. **naive WS 就有 204 TFLOPS（峰值 62%）**：架构红利大于指令级微调——先选对分工模型，再谈 swizzle/stage 微参数。
7. **这是 Hopper 的预习课**：producer 循环在 Hopper 换成一条 TMA 指令、consumer 的 mma 换成 wgmma，分工骨架原样保留——Ada 上练 WS 是读 CUTLASS sm90 源码的最短路径。
