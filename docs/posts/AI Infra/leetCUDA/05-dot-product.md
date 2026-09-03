---
title: Dot Product
order: 5
---

# Dot Product CUDA代码学习

> 本人学习笔记，AI总结

点积 `y = Σ a_i·b_i` 是 reduce 的直接应用：把 03 的"求和"换成"乘了再求和"。本篇很短，新知识点只有一个——**`__hmul2` 双发射半精度乘法**；其余全是 03/04 积木的拼装，正好用来验证前面两篇的东西已经内化。

## 完整代码

### `dot_product.cu`
<details>
<summary> dot_product.cu </summary>

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
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])

// FP32
// Warp Reduce Sum
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_f32(float val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

// Dot Product
// grid(N/256), block(256)
// a: Nx1, b: Nx1, y=sum(elementwise_mul(a,b))
template <const int NUM_THREADS = 256>
__global__ void dot_prod_f32_f32_kernel(float *a, float *b, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  float prod = (idx < N) ? a[idx] * b[idx] : 0.0f;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  prod = warp_reduce_sum_f32<WARP_SIZE>(prod);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = prod;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  prod = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    prod = warp_reduce_sum_f32<NUM_WARPS>(prod);
  if (tid == 0)
    atomicAdd(y, prod);
}

// Dot Product + Vec4
// grid(N/256), block(256/4)
// a: Nx1, b: Nx1, y=sum(elementwise_mul(a,b))
template <const int NUM_THREADS = 256 / 4>
__global__ void dot_prod_f32x4_f32_kernel(float *a, float *b, float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 4;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  float4 reg_a = FLOAT4(a[idx]);
  float4 reg_b = FLOAT4(b[idx]);
  float prod = (idx < N) ? (reg_a.x * reg_b.x + reg_a.y * reg_b.y +
                            reg_a.z * reg_b.z + reg_a.w * reg_b.w)
                         : 0.0f;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  prod = warp_reduce_sum_f32<WARP_SIZE>(prod);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = prod;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  prod = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    prod = warp_reduce_sum_f32<NUM_WARPS>(prod);
  if (tid == 0)
    atomicAdd(y, prod);
}

// FP16
// Warp Reduce Sum: Half
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ half warp_reduce_sum_f16_f16(half val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val = __hadd(val, __shfl_xor_sync(0xffffffff, val, mask));
    // val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_f16_f32(half val) {
  float val_f32 = __half2float(val);
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val_f32 += __shfl_xor_sync(0xffffffff, val_f32, mask);
  }
  return val_f32;
}

template <const int NUM_THREADS = 256>
__global__ void dot_prod_f16_f32_kernel(half *a, half *b, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  half prod_f16 = (idx < N) ? __hmul(a[idx], b[idx]) : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float prod = warp_reduce_sum_f16_f32<WARP_SIZE>(prod_f16);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = prod;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  prod = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    prod = warp_reduce_sum_f32<NUM_WARPS>(prod);
  if (tid == 0)
    atomicAdd(y, prod);
}

template <const int NUM_THREADS = 256 / 2>
__global__ void dot_prod_f16x2_f32_kernel(half *a, half *b, float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 2; // 2 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  half2 reg_a = HALF2(a[idx]);
  half2 reg_b = HALF2(b[idx]);
  half prod_f16 =
      (idx < N) ? __hadd(__hmul(reg_a.x, reg_b.x), __hmul(reg_a.y, reg_b.y))
                : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float prod = warp_reduce_sum_f16_f32<WARP_SIZE>(prod_f16);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = prod;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  prod = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    prod = warp_reduce_sum_f32<NUM_WARPS>(prod);
  if (tid == 0)
    atomicAdd(y, prod);
}

template <const int NUM_THREADS = 256 / 8>
__global__ void dot_prod_f16x8_pack_f32_kernel(half *a, half *b, float *y,
                                               int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 8; // 8 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // temporary register(memory), .local space in ptx, addressable
  half pack_a[8], pack_b[8];                    // 8x16 bits=128 bits.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
  LDST128BITS(pack_b[0]) = LDST128BITS(b[idx]); // load 128 bits
  const half z = __float2half(0.0f);

  half prod_f16 = z;
#pragma unroll
  for (int i = 0; i < 8; i += 2) {
    half2 v = __hmul2(HALF2(pack_a[i]), HALF2(pack_b[i]));
    prod_f16 += (((idx + i) < N) ? (v.x + v.y) : z);
  }

  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float prod = warp_reduce_sum_f16_f32<WARP_SIZE>(prod_f16);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = prod;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  prod = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    prod = warp_reduce_sum_f32<NUM_WARPS>(prod);
  if (tid == 0)
    atomicAdd(y, prod);
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define LANUCH_DOT_PROD_KERNEL(NT, packed_type, acc_type, element_type)        \
  dot_prod_##packed_type##_##acc_type##_kernel<(NT)>                           \
      <<<grid, block>>>(reinterpret_cast<element_type *>(a.data_ptr()),        \
                        reinterpret_cast<element_type *>(b.data_ptr()),        \
                        prod.data_ptr<float>(), N);

#define DISPATCH_DOT_PROD_KERNEL(K, packed_type, acc_type, element_type,       \
                                 n_elements)                                   \
  const int NT = (K) / (n_elements);                                           \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (NT) {                                                                \
  case 32:                                                                     \
    LANUCH_DOT_PROD_KERNEL(32, packed_type, acc_type, element_type)            \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_DOT_PROD_KERNEL(64, packed_type, acc_type, element_type)            \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_DOT_PROD_KERNEL(128, packed_type, acc_type, element_type)           \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_DOT_PROD_KERNEL(256, packed_type, acc_type, element_type)           \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_DOT_PROD_KERNEL(512, packed_type, acc_type, element_type)           \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_DOT_PROD_KERNEL(1024, packed_type, acc_type, element_type)          \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error(                                                  \
        "only support (K)/(n_elements): 32/64/128/256/512/1024");              \
    break;                                                                     \
  }

#define TORCH_BINDING_DOT_PROD(packed_type, acc_type, th_type, element_type,   \
                               n_elements)                                     \
  torch::Tensor dot_prod_##packed_type##_##acc_type(torch::Tensor a,           \
                                                    torch::Tensor b) {         \
    CHECK_TORCH_TENSOR_DTYPE(a, (th_type))                                     \
    CHECK_TORCH_TENSOR_DTYPE(b, (th_type))                                     \
    auto options =                                                             \
        torch::TensorOptions().dtype(torch::kFloat32).device(torch::kCUDA, 0); \
    auto prod = torch::zeros({1}, options);                                    \
    const int ndim = a.dim();                                                  \
    if (ndim != 2) {                                                           \
      int N = 1;                                                               \
      for (int i = 0; i < ndim; ++i) {                                         \
        N *= a.size(i);                                                        \
      }                                                                        \
      dim3 block(256);                                                         \
      dim3 grid(((N + 256 - 1) / 256) / (n_elements));                         \
      dot_prod_##packed_type##_##acc_type##_kernel<256>                        \
          <<<grid, block>>>(reinterpret_cast<element_type *>(a.data_ptr()),    \
                            reinterpret_cast<element_type *>(b.data_ptr()),    \
                            prod.data_ptr<float>(), N);                        \
    } else {                                                                   \
      const int S = a.size(0);                                                 \
      const int K = a.size(1);                                                 \
      const int N = S * K;                                                     \
      if ((K / (n_elements)) <= 1024) {                                        \
        DISPATCH_DOT_PROD_KERNEL(K, packed_type, acc_type, element_type,       \
                                 n_elements)                                   \
      } else {                                                                 \
        int N = 1;                                                             \
        for (int i = 0; i < ndim; ++i) {                                       \
          N *= a.size(i);                                                      \
        }                                                                      \
        dim3 block(256);                                                       \
        dim3 grid(((N + 256 - 1) / 256) / (n_elements));                       \
        dot_prod_##packed_type##_##acc_type##_kernel<256>                      \
            <<<grid, block>>>(reinterpret_cast<element_type *>(a.data_ptr()),  \
                              reinterpret_cast<element_type *>(b.data_ptr()),  \
                              prod.data_ptr<float>(), N);                      \
      }                                                                        \
    }                                                                          \
    return prod;                                                               \
  }

// packed_type, acc_type, th_type, element_type, n_elements_per_pack
TORCH_BINDING_DOT_PROD(f32, f32, torch::kFloat32, float, 1)
TORCH_BINDING_DOT_PROD(f32x4, f32, torch::kFloat32, float, 4)
TORCH_BINDING_DOT_PROD(f16, f32, torch::kHalf, half, 1)
TORCH_BINDING_DOT_PROD(f16x2, f32, torch::kHalf, half, 2)
TORCH_BINDING_DOT_PROD(f16x8_pack, f32, torch::kHalf, half, 8)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(dot_prod_f32_f32)
  TORCH_BINDING_COMMON_EXTENSION(dot_prod_f32x4_f32)
  TORCH_BINDING_COMMON_EXTENSION(dot_prod_f16_f32)
  TORCH_BINDING_COMMON_EXTENSION(dot_prod_f16x2_f32)
  TORCH_BINDING_COMMON_EXTENSION(dot_prod_f16x8_pack_f32)
}
```

</details>

### `dot_product.py`
<details>
<summary> dot_product.py </summary>

```python
import time

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="dot_product_lib",
    sources=["dot_product.cu"],
    extra_cuda_cflags=[
        "-O3",
        "-U__CUDA_NO_HALF_OPERATORS__",
        "-U__CUDA_NO_HALF_CONVERSIONS__",
        "-U__CUDA_NO_HALF2_OPERATORS__",
        "-U__CUDA_NO_BFLOAT16_CONVERSIONS__",
        "--expt-relaxed-constexpr",
        "--expt-extended-lambda",
        "--use_fast_math",
    ],
    extra_cflags=["-std=c++17"],
)


def run_benchmark(
    perf_func: callable,
    a: torch.Tensor,
    b: torch.Tensor,
    tag: str,
    warmup: int = 10,
    iters: int = 1000,
):
    # torch.dot vs custom dot_prod kernel
    for i in range(warmup):
        out = perf_func(a, b)  # warmup
    torch.cuda.synchronize()
    start = time.time()
    for i in range(iters):
        out = perf_func(a, b)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.item()
    if tag.startswith("i8"):
        print(f"{out_info:>17}: {out_val:<15}, time:{mean_time:.8f}ms")
    else:
        print(f"{out_info:>17}: {out_val:<15.8f}, time:{mean_time:.8f}ms")
    return out, mean_time


Ss = [1024, 2048, 4096]
Ks = [1024, 2048, 4096]
SKs = [(S, K) for S in Ss for K in Ks]

for S, K in SKs:
    print("-" * 80)
    print(" " * 25 + f"S={S}, K={K}")
    a = torch.randn((S * K)).cuda().float()
    b = torch.randn((S * K)).cuda().float()
    run_benchmark(lib.dot_prod_f32_f32, a, b, "f32f32")
    run_benchmark(lib.dot_prod_f32x4_f32, a, b, "f32x4f32")
    run_benchmark(torch.dot, a, b, "f32f32_th")

    print("-" * 80)
    a_f16 = a.half()
    b_f16 = b.half()
    run_benchmark(lib.dot_prod_f16_f32, a_f16, b_f16, "f16f32")
    run_benchmark(lib.dot_prod_f16x2_f32, a_f16, b_f16, "f16x2f32")
    run_benchmark(lib.dot_prod_f16x8_pack_f32, a_f16, b_f16, "f16x8packf32")
    run_benchmark(torch.dot, a_f16, b_f16, "f16f16_th")
    print("-" * 80)
```

</details>

## 逐段代码剖析/学习

reduce 两阶段骨架（warp shuffle → smem → warp 0 再 shuffle → atomicAdd）、`f16_f32` 混合精度、向量化 load、dispatch 的 2 幂 switch——全部是 03 的原样复用，不重复。对照 03 的 `block_all_reduce_sum_f32_f32_kernel`，唯一区别是进 reduce 之前的这一行：

```c++
// 03 reduce:   float sum = (idx < N) ? a[idx] : 0.0f;
// 05 dot_prod: float prod = (idx < N) ? a[idx] * b[idx] : 0.0f;
```

**reduce 的本质是"任意可结合运算 + 单位元"**。sum 是 `(+, 0)`，max 是 `(fmax, -inf)`（04 用了），dot product 是先做逐元素乘再进 `(+, 0)`——乘法只是进 reduce 前的"预处理"，reduce 本身一字不改。想清楚这一点，dot product 这个 kernel 就没有任何新东西（除了下面一个）。

---

```c++
// f16x8_pack 版本的核心循环
half pack_a[8], pack_b[8];
LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]);
LDST128BITS(pack_b[0]) = LDST128BITS(b[idx]);

half prod_f16 = z;
#pragma unroll
for (int i = 0; i < 8; i += 2) {
  half2 v = __hmul2(HALF2(pack_a[i]), HALF2(pack_b[i]));
  prod_f16 += (((idx + i) < N) ? (v.x + v.y) : z);
}
```

本篇唯一的新知识点：**`__hmul2`**。

- `__hmul(a, b)`：单发 half 乘法（f16 版用）。
- `__hmul2(half2, half2)`：**一次指令算两个 half 乘法**。把 `pack_a[i], pack_a[i+1]` 重解释成 `half2`，`__hmul2` 一次出 `(a_i·b_i, a_{i+1}·b_{i+1})` 两个结果——half 只有 16 位，GPU 的 half 运算单元天然按 32 位通道成对处理，`__hmul2`/`__hadd2` 就是把这对通道用满的 intrinsic。02 的 elementwise 里 `__hadd2` 已经出现过，这里 `__hmul2` 同理。
- 循环 `i += 2` 步进 2，8 个元素 4 轮 `__hmul2`——比 8 轮 `__hmul` 指令数减半。
- 注意这里的乘法是 **f16 精度**（`__hmul2` 出来还是 half），只有最后的求和升了 f32（`warp_reduce_sum_f16_f32`）。这是精度取舍：单个乘积 a_i·b_i 在 f16 里尚能表示（两个 ~±3 的数相乘还在 f16 范围内），但几十个乘积连加必然溢出 f16，所以加法必须升位。**"乘 f16、加 f32"是 dot/GEMV 类算子的常见分层精度策略**（更激进的 GEMM 是乘加全 f32，第二阶段的 MMA 用 f32 acc）。

---

host 侧 `TORCH_BINDING_DOT_PROD` 宏和 03 的 `TORCH_BINDING_REDUCE` 结构完全一致（ndim!=2 摊平 / 2D 按 K 分 block / K 太长 fallback），不重复拆。

## 实测数据（4090, N=4096×4096=16.7M 元素）

| kernel | 结果 | 耗时 |
|---|---|---|
| f32_f32 | 2150.839 | 0.1399ms |
| f32x4_f32 | 2150.849 | 0.1399ms |
| torch.dot(f32) | 2150.851 | 0.1419ms |
| f16_f32 | 2150.781 | 0.0888ms |
| f16x2_f32 | 2151.823 | 0.0459ms |
| f16x8pack_f32 | 2153.577 | **0.0171ms** |
| torch.dot(f16) | 2150.0 | 0.0190ms |

- f16x8pack_f32 比 torch.dot(f16) 快 ~10%，比朴素 f16_f32 快 **5.2x**——向量化 + `__hmul2` + 线程内归并三层优化叠加。
- 有趣的对照：f32 系列里 f32x4 没有加速（0.1399 = 0.1399ms），和 03 的观察（K=4096 时 f32x4 快 2.4x）相反。原因：这里 N=16.7M、`grid` 开到了 65536 个 block，**瓶颈已经从访存变成了 atomicAdd 排队**——65536 个 block 每个都往同一个 y 原子加，原子操作串行化吃掉了向量化的收益。f16 系列能看到加速是因为 f16 数据量减半后 block 数也减半（pack 8），原子压力小一个量级。
  - 这是个值得记住的坑：**block 级 atomicAdd 的总数 = grid 大小**，数据越大原子竞争越凶。生产 kernel 会用两阶段归约（block 写 partial 到数组、再一个 kernel 归总）替代全局原子。

## 本篇小结

1. **reduce 是通用骨架**：`(运算, 单位元)` 可替换——sum、max、乘积和都是同一骨架的实例，dot product = 逐元素乘预处理 + sum reduce。
2. **`__hmul2`/`__hadd2`**：half2 双发射 intrinsic，一条指令算一对 half，循环步进 2 指令数减半。
3. **分层精度**：乘法可留在 f16（单乘积不溢出），累加必须升 f32（连加溢出）。
4. **全局 atomicAdd 的规模陷阱**：grid 越大原子竞争越凶，N 很大时向量化收益会被原子操作吃掉（f32x4 在 16.7M 元素时零加速的原因），大 N 该用两阶段归约。
