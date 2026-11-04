---
title: Softmax
order: 4
---

# Softmax CUDA代码学习

> 本人学习笔记，AI总结

softmax 是 LLM attention 的入口算子（`softmax(QK^T/√d)`）。本篇把 03 的两阶段 reduce 当积木，叠加 **"一行（token）一个 block"的 per-token 映射**，并引出 safe softmax（数值稳定）和 online softmax（单遍扫描，FlashAttention 的核心思想）。

## 完整代码

### `softmax.cu`
<details>
<summary> softmax.cu </summary>

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
// DS required for Online Softmax
struct __align__(8) MD {
  float m;
  float d;
};
// Warp Reduce for Online Softmax
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ MD warp_reduce_md_op(MD value) {
  unsigned int mask = 0xffffffff;
#pragma unroll
  for (int stride = kWarpSize >> 1; stride >= 1; stride >>= 1) {
    MD other;
    other.m = __shfl_xor_sync(mask, value.m, stride);
    other.d = __shfl_xor_sync(mask, value.d, stride);

    bool value_bigger = (value.m > other.m);
    MD bigger_m = value_bigger ? value : other;
    MD smaller_m = value_bigger ? other : value;

    value.d = bigger_m.d + smaller_m.d * __expf(smaller_m.m - bigger_m.m);
    value.m = bigger_m.m;
  }
  return value;
}

// Warp Reduce Sum
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_f32(float val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

// Warp Reduce Max
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_max_f32(float val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val = fmaxf(val, __shfl_xor_sync(0xffffffff, val, mask));
  }
  return val;
}

// grid 1D block 1D, grid(N/256), block(256)
template <const int NUM_THREADS = 256>
__device__ float block_reduce_sum_f32(float val) {
  // always <= 32 warps per block (limited by 1024 threads per block)
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  int warp = threadIdx.x / WARP_SIZE;
  int lane = threadIdx.x % WARP_SIZE;
  static __shared__ float shared[NUM_WARPS];

  float value = warp_reduce_sum_f32<WARP_SIZE>(val);
  if (lane == 0)
    shared[warp] = value;
  __syncthreads();
  value = (lane < NUM_WARPS) ? shared[lane] : 0.0f;
  value = warp_reduce_sum_f32<NUM_WARPS>(value);
  // WRAN: need to broadcast value to all threads within warp
  value = __shfl_sync(0xffffffff, value, 0, 32);
  return value;
}

template <const int NUM_THREADS = 256>
__device__ float block_reduce_max_f32(float val) {
  // always <= 32 warps per block (limited by 1024 threads per block)
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  int warp = threadIdx.x / WARP_SIZE;
  int lane = threadIdx.x % WARP_SIZE;
  static __shared__ float shared[NUM_WARPS];

  float value = warp_reduce_max_f32<WARP_SIZE>(val);
  if (lane == 0)
    shared[warp] = value;
  __syncthreads();
  value = (lane < NUM_WARPS) ? shared[lane] : -FLT_MAX;
  value = warp_reduce_max_f32<NUM_WARPS>(value);
  // WRAN: need to broadcast value to all threads within warp
  value = __shfl_sync(0xffffffff, value, 0, 32);
  return value;
}

// NOTE: softmax per-token
// Softmax x: (S,h), y: (S,h)
// grid(S*h/h), block(h), assume h<=1024
// one token per thread block, only support 64<=h<=1024 and 2^n
// HEAD_SIZE/KV_LEN=NUM_THREADS
template <const int NUM_THREADS = 256>
__global__ void softmax_f32_per_token_kernel(float *x, float *y, int N) {
  const int tid = threadIdx.x;
  const int idx = blockIdx.x * blockDim.x + tid;

  float exp_val = (idx < N) ? expf(x[idx]) : 0.0f;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if (idx < N)
    y[idx] = exp_val / exp_sum;
}

template <const int NUM_THREADS = 256 / 4>
__global__ void softmax_f32x4_per_token_kernel(float *x, float *y, int N) {
  const int tid = threadIdx.x;
  const int idx = (blockIdx.x * blockDim.x + tid) * 4;

  float4 reg_x = FLOAT4(x[idx]);
  float4 reg_exp;
  reg_exp.x = (idx + 0 < N) ? expf(reg_x.x) : 0.0f;
  reg_exp.y = (idx + 1 < N) ? expf(reg_x.y) : 0.0f;
  reg_exp.z = (idx + 2 < N) ? expf(reg_x.z) : 0.0f;
  reg_exp.w = (idx + 3 < N) ? expf(reg_x.w) : 0.0f;

  float exp_val = (reg_exp.x + reg_exp.y + reg_exp.z + reg_exp.w);
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if (idx + 3 < N) {
    float4 reg_y;
    reg_y.x = reg_exp.x / (exp_sum);
    reg_y.y = reg_exp.y / (exp_sum);
    reg_y.z = reg_exp.z / (exp_sum);
    reg_y.w = reg_exp.w / (exp_sum);
    FLOAT4(y[idx]) = reg_y;
  }
}

// safe_softmax per token
template <const int NUM_THREADS = 256>
__global__ void safe_softmax_f32_per_token_kernel(float *x, float *y, int N) {
  const int tid = threadIdx.x;
  const int idx = blockIdx.x * blockDim.x + tid;

  float val = (idx < N) ? x[idx] : -FLT_MAX;
  float max_val = block_reduce_max_f32<NUM_THREADS>(val); // block max
  float exp_val = (idx < N) ? expf(val - max_val) : 0.0f;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if (idx < N)
    y[idx] = exp_val / exp_sum;
}

template <const int NUM_THREADS = 256 / 4>
__global__ void safe_softmax_f32x4_per_token_kernel(float *x, float *y, int N) {
  const int tid = threadIdx.x;
  const int idx = (blockIdx.x * blockDim.x + tid) * 4;

  float4 reg_x = FLOAT4(x[idx]);
  reg_x.x = (idx + 0 < N) ? reg_x.x : -FLT_MAX;
  reg_x.y = (idx + 1 < N) ? reg_x.y : -FLT_MAX;
  reg_x.z = (idx + 2 < N) ? reg_x.z : -FLT_MAX;
  reg_x.w = (idx + 3 < N) ? reg_x.w : -FLT_MAX;
  float val = reg_x.x;
  val = fmaxf(val, reg_x.y);
  val = fmaxf(val, reg_x.z);
  val = fmaxf(val, reg_x.w);
  float max_val = block_reduce_max_f32<NUM_THREADS>(val); // block max

  float4 reg_exp;
  reg_exp.x = (idx + 0 < N) ? expf(reg_x.x - max_val) : 0.0f;
  reg_exp.y = (idx + 1 < N) ? expf(reg_x.y - max_val) : 0.0f;
  reg_exp.z = (idx + 2 < N) ? expf(reg_x.z - max_val) : 0.0f;
  reg_exp.w = (idx + 3 < N) ? expf(reg_x.w - max_val) : 0.0f;

  float exp_val = (reg_exp.x + reg_exp.y + reg_exp.z + reg_exp.w);
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if (idx + 3 < N) {
    float4 reg_y;
    reg_y.x = reg_exp.x / (exp_sum);
    reg_y.y = reg_exp.y / (exp_sum);
    reg_y.z = reg_exp.z / (exp_sum);
    reg_y.w = reg_exp.w / (exp_sum);
    FLOAT4(y[idx]) = reg_y;
  }
}

template <const int NUM_THREADS = 256>
__global__ void safe_softmax_f16_f32_per_token_kernel(half *x, half *y, int N) {
  const int tid = threadIdx.x;
  const int idx = blockIdx.x * blockDim.x + tid;

  float val = (idx < N) ? __half2float(x[idx]) : -FLT_MAX;
  float max_val = block_reduce_max_f32<NUM_THREADS>(val); // block max
  float exp_val = (idx < N) ? expf(val - max_val) : 0.0f;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if (idx < N)
    y[idx] = __float2half_rn(exp_val / exp_sum);
}

template <const int NUM_THREADS = 256>
__global__ void safe_softmax_f16x2_f32_per_token_kernel(half *x, half *y,
                                                        int N) {
  const int tid = threadIdx.x;
  const int idx = (blockIdx.x * blockDim.x + tid) * 2;

  float2 reg_x = __half22float2(HALF2(x[idx]));
  float max_val = -FLT_MAX;
  max_val = ((idx + 0) < N) ? fmaxf(reg_x.x, max_val) : -FLT_MAX;
  max_val = ((idx + 1) < N) ? fmaxf(reg_x.y, max_val) : -FLT_MAX;
  max_val = block_reduce_max_f32<NUM_THREADS>(max_val); // block max

  float2 reg_exp;
  reg_exp.x = ((idx + 0) < N) ? expf(reg_x.x - max_val) : 0.0f;
  reg_exp.y = ((idx + 1) < N) ? expf(reg_x.y - max_val) : 0.0f;

  float exp_val = reg_exp.x + reg_exp.y;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum

  float2 reg_y;
  reg_y.x = reg_exp.x / (exp_sum);
  reg_y.y = reg_exp.y / (exp_sum);

  // e^x_i/sum(e^x_0,...,e^x_n-1)
  if ((idx + 1) < N)
    HALF2(y[idx]) = __float22half2_rn(reg_y);
}

template <const int NUM_THREADS = 256>
__global__ void safe_softmax_f16x8_pack_f32_per_token_kernel(half *x, half *y,
                                                             int N) {
  const int tid = threadIdx.x;
  const int idx = (blockIdx.x * blockDim.x + tid) * 8;
  // temporary register(memory), .local space in ptx, addressable
  half pack_x[8], pack_y[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_x[0]) = LDST128BITS(x[idx]); // load 128 bits

  float max_val = -FLT_MAX;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    max_val = fmaxf(__half2float(pack_x[i]), max_val);
  }
  max_val = block_reduce_max_f32<NUM_THREADS>(max_val); // block max

  // store the exp_vals
  float exp_vals[8] = {0.0f};
  float exp_sum = 0.0f;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    float val = __half2float(pack_x[i]);
    float exp_val = (((idx + i) < N) ? expf(val - max_val) : 0.0f);
    exp_vals[i] = exp_val;
    exp_sum += exp_val;
  }
  exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_sum); // block sum

#pragma unroll
  for (int i = 0; i < 8; ++i) {
    // e^x_i/sum(e^x_0,...,e^x_n-1)
    pack_y[i] = __float2half_rn(exp_vals[i] / exp_sum);
  }
  // reinterpret as float4 and store 128 bits in 1 memory issue.
  if ((idx + 7) < N) {
    LDST128BITS(y[idx]) = LDST128BITS(pack_y[0]);
  }
  // TODO: support non 8-multiple K here
}

template <const int NUM_THREADS = 256>
__global__ void online_safe_softmax_f32_per_token_kernel(const float *x,
                                                         float *y, int N) {
  // reference: https://arxiv.org/pdf/1805.02867 (Online normalizer calculation
  // for softmax)
  int local_tid = threadIdx.x;
  int global_tid = blockIdx.x * NUM_THREADS + threadIdx.x;
  const int WARP_NUM = NUM_THREADS / WARP_SIZE;
  int warp_id = local_tid / WARP_SIZE;
  int lane_id = local_tid % WARP_SIZE;
  MD val;
  val.m = global_tid < N ? x[global_tid] : -FLT_MAX;
  val.d = global_tid < N ? 1.0f : 0.0f;

  __shared__ MD shared[WARP_NUM];
  MD res = warp_reduce_md_op<WARP_SIZE>(val);

  if (lane_id == 0)
    shared[warp_id] = res;
  __syncthreads();

  if (local_tid < WARP_SIZE) {
    MD block_res =
        local_tid < WARP_NUM ? shared[local_tid] : MD{-FLT_MAX, 0.0f};
    block_res = warp_reduce_md_op<WARP_NUM>(block_res);
    if (local_tid == 0) {
      shared[0] = block_res;
    }
  }
  __syncthreads();

  MD final_res = shared[0];
  float d_total_inverse = __fdividef(1.0f, final_res.d);
  if (global_tid < N) {
    y[global_tid] = __expf(x[global_tid] - final_res.m) * d_total_inverse;
  }
}

template <const int NUM_THREADS = 256 / 4>
__global__ void
online_safe_softmax_f32x4_pack_per_token_kernel(float *x, float *y, int N) {
  // reference: https://arxiv.org/pdf/1805.02867 (Online normalizer calculation
  // for softmax)
  int local_tid = threadIdx.x;
  int global_tid = (blockIdx.x * NUM_THREADS + local_tid) * 4;

  const int WARP_NUM = NUM_THREADS / WARP_SIZE;
  int warp_id = local_tid / WARP_SIZE;
  int lane_id = local_tid % WARP_SIZE;
  // compare local max value
  float4 val = FLOAT4((x)[global_tid]);
  float local_m = fmaxf(fmaxf(val.x, val.y), fmaxf(val.z, val.w));
  float local_d = __expf(val.x - local_m) + __expf(val.y - local_m) +
                  __expf(val.z - local_m) + __expf(val.w - local_m);

  MD local_md = {local_m, local_d};
  MD res = warp_reduce_md_op<WARP_SIZE>(local_md);
  __shared__ MD shared[WARP_NUM];

  if (lane_id == 0)
    shared[warp_id] = res;
  __syncthreads();
  // do block reduce
  if (local_tid < WARP_SIZE) {
    MD block_res =
        local_tid < WARP_NUM ? shared[local_tid] : MD{-FLT_MAX, 0.0f};
    block_res = warp_reduce_md_op<WARP_NUM>(block_res);
    if (local_tid == 0)
      shared[0] = block_res;
  }
  __syncthreads();
  // write back
  MD final_res = shared[0];
  float d_total_inverse = __fdividef(1.0f, final_res.d);
  if (global_tid < N) {
    float4 reg_y;
    reg_y.x = __expf(val.x - final_res.m) * d_total_inverse;
    reg_y.y = __expf(val.y - final_res.m) * d_total_inverse;
    reg_y.z = __expf(val.z - final_res.m) * d_total_inverse;
    reg_y.w = __expf(val.w - final_res.m) * d_total_inverse;
    FLOAT4((y)[global_tid]) = reg_y;
  }
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define CHECK_TORCH_TENSOR_SHAPE(T1, T2)                                       \
  assert((T1).dim() == (T2).dim());                                            \
  for (int i = 0; i < (T1).dim(); ++i) {                                       \
    if ((T2).size(i) != (T1).size(i)) {                                        \
      throw std::runtime_error("Tensor size mismatch!");                       \
    }                                                                          \
  }

// softmax per token
#define LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(H)                                 \
  softmax_f32_per_token_kernel<(H)>                                            \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)                            \
  dim3 block((H));                                                             \
  dim3 grid((S));                                                              \
  switch ((H)) {                                                               \
  case 32:                                                                     \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(32)                                    \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(64)                                    \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(128)                                   \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(256)                                   \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(512)                                   \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_SOFTMAX_F32_PER_TOKEN_KERNEL(1024)                                  \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/256/512/1024");           \
    break;                                                                     \
  }

#define LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(H)                               \
  softmax_f32x4_per_token_kernel<(H) / 4>                                      \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(S, H)                          \
  const int NT = (H) / 4;                                                      \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (H) {                                                                 \
  case 32:                                                                     \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(32) break;                           \
  case 64:                                                                     \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(64) break;                           \
  case 128:                                                                    \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(128) break;                          \
  case 256:                                                                    \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(256) break;                          \
  case 512:                                                                    \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(512) break;                          \
  case 1024:                                                                   \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(1024) break;                         \
  case 2048:                                                                   \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(2048) break;                         \
  case 4096:                                                                   \
    LANUCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(4096) break;                         \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/.../1024*4");             \
    break;                                                                     \
  }

// safe softmax per token
#define LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(H)                            \
  safe_softmax_f32_per_token_kernel<(H)>                                       \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_SATE_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)                       \
  dim3 block((H));                                                             \
  dim3 grid((S));                                                              \
  switch ((H)) {                                                               \
  case 32:                                                                     \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(32)                               \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(64)                               \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(128)                              \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(256)                              \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(512)                              \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_SAFE_SOFTMAX_F32_PER_TOKEN_KERNEL(1024)                             \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/256/512/1024");           \
    break;                                                                     \
  }

// online softmax per token
#define LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(H)                          \
  online_safe_softmax_f32_per_token_kernel<(H)>                                \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)                     \
  dim3 block((H));                                                             \
  dim3 grid((S));                                                              \
  switch ((H)) {                                                               \
  case 32:                                                                     \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(32)                             \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(64)                             \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(128)                            \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(256)                            \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(512)                            \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(1024)                           \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/256/512/1024");           \
    break;                                                                     \
  }

// online softmax per token
#define LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(H)                   \
  online_safe_softmax_f32x4_pack_per_token_kernel<(H / 4)>                     \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(S, H)              \
  dim3 block((H / 4));                                                         \
  dim3 grid((S));                                                              \
  switch ((H)) {                                                               \
  case 128:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(128)                     \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(256)                     \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(512)                     \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(1024)                    \
    break;                                                                     \
  case 2048:                                                                   \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(2048)                    \
    break;                                                                     \
  case 4096:                                                                   \
    LANUCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(4096)                    \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support H: 128/256/.../4096;");             \
    break;                                                                     \
  }

#define LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(H)                          \
  safe_softmax_f32x4_per_token_kernel<(H) / 4>                                 \
      <<<grid, block>>>(reinterpret_cast<float *>(x.data_ptr()),               \
                        reinterpret_cast<float *>(y.data_ptr()), N);

#define DISPATCH_SATE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(S, H)                     \
  const int NT = (H) / 4;                                                      \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (H) {                                                                 \
  case 32:                                                                     \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(32) break;                      \
  case 64:                                                                     \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(64) break;                      \
  case 128:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(128) break;                     \
  case 256:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(256) break;                     \
  case 512:                                                                    \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(512) break;                     \
  case 1024:                                                                   \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(1024) break;                    \
  case 2048:                                                                   \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(2048) break;                    \
  case 4096:                                                                   \
    LANUCH_SAFE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(4096) break;                    \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/.../1024*4");             \
    break;                                                                     \
  }

#define LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(H)                        \
  safe_softmax_f16_f32_per_token_kernel<(H)>                                   \
      <<<grid, block>>>(reinterpret_cast<half *>(x.data_ptr()),                \
                        reinterpret_cast<half *>(y.data_ptr()), N);

#define DISPATCH_SATE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(S, H)                   \
  dim3 block((H));                                                             \
  dim3 grid((S));                                                              \
  switch ((H)) {                                                               \
  case 32:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(32)                           \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(64)                           \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(128)                          \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(256)                          \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(512)                          \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(1024)                         \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/256/512/1024");           \
    break;                                                                     \
  }

#define LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(H)                      \
  safe_softmax_f16x2_f32_per_token_kernel<(H) / 2>                             \
      <<<grid, block>>>(reinterpret_cast<half *>(x.data_ptr()),                \
                        reinterpret_cast<half *>(y.data_ptr()), N);

#define DISPATCH_SATE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(S, H)                 \
  const int NT = (H) / 2;                                                      \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (H) {                                                                 \
  case 32:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(32) break;                  \
  case 64:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(64) break;                  \
  case 128:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(128) break;                 \
  case 256:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(256) break;                 \
  case 512:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(512) break;                 \
  case 1024:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(1024) break;                \
  case 2048:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(2048) break;                \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/.../1024*2");             \
    break;                                                                     \
  }

#define LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(H)                 \
  safe_softmax_f16x8_pack_f32_per_token_kernel<(H) / 8>                        \
      <<<grid, block>>>(reinterpret_cast<half *>(x.data_ptr()),                \
                        reinterpret_cast<half *>(y.data_ptr()), N);

#define DISPATCH_SATE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(S, H)            \
  const int NT = (H) / 8;                                                      \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (H) {                                                                 \
  case 32:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(32) break;             \
  case 64:                                                                     \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(64) break;             \
  case 128:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(128) break;            \
  case 256:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(256) break;            \
  case 512:                                                                    \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(512) break;            \
  case 1024:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(1024) break;           \
  case 2048:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(2048) break;           \
  case 4096:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(4096) break;           \
  case 8192:                                                                   \
    LANUCH_SAFE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(8192) break;           \
  default:                                                                     \
    throw std::runtime_error("only support H: 64/128/.../1024*8");             \
    break;                                                                     \
  }

// per token fp32
void softmax_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)
}

void softmax_f32x4_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SOFTMAX_F32x4_PER_TOKEN_KERNEL(S, H)
}

void safe_softmax_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SATE_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)
}

void safe_softmax_f32x4_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SATE_SOFTMAX_F32x4_PER_TOKEN_KERNEL(S, H)
}

// per token fp16
void safe_softmax_f16_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SATE_SOFTMAX_F16_F32_PER_TOKEN_KERNEL(S, H)
}

void safe_softmax_f16x2_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SATE_SOFTMAX_F16x2_F32_PER_TOKEN_KERNEL(S, H)
}

void safe_softmax_f16x8_pack_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kHalf)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_SATE_SOFTMAX_F16x8_PACK_F32_PER_TOKEN_KERNEL(S, H)
}

void online_safe_softmax_f32_per_token(torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0); // seqlens
  const int H = x.size(1); // head size/kv_len
  const int N = S * H;
  DISPATCH_ONLINE_SOFTMAX_F32_PER_TOKEN_KERNEL(S, H)
}

void online_safe_softmax_f32x4_pack_per_token(torch::Tensor x,
                                              torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int S = x.size(0);
  const int H = x.size(1);
  const int N = S * H;
  DISPATCH_ONLINE_SOFTMAX_F32X4_PACK_PER_TOKEN_KERNEL(S, H)
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(softmax_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(softmax_f32x4_per_token)
  TORCH_BINDING_COMMON_EXTENSION(safe_softmax_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(safe_softmax_f32x4_per_token)
  TORCH_BINDING_COMMON_EXTENSION(safe_softmax_f16_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(safe_softmax_f16x2_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(safe_softmax_f16x8_pack_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(online_safe_softmax_f32_per_token)
  TORCH_BINDING_COMMON_EXTENSION(online_safe_softmax_f32x4_pack_per_token)
}
```

</details>

### `softmax.py`
<details>
<summary> softmax.py </summary>

```python
import time
from functools import partial
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="softmax_lib",
    sources=["softmax.cu"],
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
    x: torch.Tensor,
    tag: str,
    out: Optional[torch.Tensor] = None,
    warmup: int = 10,
    iters: int = 100,
    show_all: bool = False,
):
    if out is not None:
        out.fill_(0)
    if out is not None:
        for i in range(warmup):
            perf_func(x, out)
    else:
        for i in range(warmup):
            _ = perf_func(x)
    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            perf_func(x, out)
    else:
        for i in range(iters):
            out = perf_func(x)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten().detach().cpu().numpy().tolist()[:3]
    out_val = [round(v, 8) for v in out_val]
    out_val = [f"{v:<12}" for v in out_val]
    print(f"{out_info:>24}: {out_val}, time:{mean_time:.8f}ms")
    if show_all:
        print(out)
    return out, mean_time


# per token softmax
print("-" * 100)
S, H = 4096, 256
print(" " * 45 + f"S={S}, H={H}")
print("-" * 100)
x = torch.randn((S, H), device="cuda").cuda().float().contiguous()
out = torch.zeros_like(x).cuda().float().contiguous()
run_benchmark(lib.softmax_f32_per_token, x, "f32(per)", out)
run_benchmark(lib.softmax_f32x4_per_token, x, "f32x4(per)", out)
run_benchmark(lib.safe_softmax_f32_per_token, x, "f32(safe)", out)
run_benchmark(lib.online_safe_softmax_f32_per_token, x, "f32(safe+online)", out)
run_benchmark(
    lib.online_safe_softmax_f32x4_pack_per_token, x, "f32x4(safe+online)", out
)
run_benchmark(lib.safe_softmax_f32x4_per_token, x, "f32x4(safe)", out)
run_benchmark(partial(torch.softmax, dim=1, out=out), x, "f32_th(per)")

print("-" * 100)
x_f16 = x.half().contiguous()
out_f16 = out.half().contiguous()
run_benchmark(
    lib.safe_softmax_f16_f32_per_token, x_f16, "f16f32(safe)", out_f16
)
run_benchmark(
    lib.safe_softmax_f16x2_f32_per_token, x_f16, "f16x2f32(safe)", out_f16
)
run_benchmark(
    lib.safe_softmax_f16x8_pack_f32_per_token,
    x_f16,
    "f16x8packf32(safe)",
    out_f16,
)
run_benchmark(partial(torch.softmax, dim=1, out=out_f16), x_f16, "f16_th(per)")
print("-" * 100)

# ...后面 S/H 组合 4096x512, 4096x1024, 4096x2048, 4096x4096, 4096x8192,
#    8192x8192 同样套路,略
```

</details>

## 逐段代码剖析/学习

reduce 的两阶段骨架（warp shuffle → smem → warp 0 再 shuffle）03 已拆透，本篇不再重复。这里只讲 softmax 新增的东西。

---

```c++
// NOTE: softmax per-token
// Softmax x: (S,h), y: (S,h)
// grid(S*h/h), block(h), assume h<=1024
// one token per thread block, only support 64<=h<=1024 and 2^n
template <const int NUM_THREADS = 256>
__global__ void softmax_f32_per_token_kernel(float *x, float *y, int N) {
  const int tid = threadIdx.x;
  const int idx = blockIdx.x * blockDim.x + tid;

  float exp_val = (idx < N) ? expf(x[idx]) : 0.0f;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  if (idx < N)
    y[idx] = exp_val / exp_sum;
}
```

**朴素版**。softmax 数学定义 `y_i = e^{x_i} / Σe^{x_j}`，一遍 reduce 求分母就够了：

- **per-token 映射**：`grid(S)`、`block(H)`，**一行（一个 token）独占一个 block**。每个 block 内 reduce 出自己这行的 Σe^x，除一下写回。对比 03 的 reduce（所有 block 往一个 y 上 atomicAdd）：softmax 的输出是 `(S,H)`，每行有独立的分母，所以 block 之间**不需要通信**，一个 block 一行天然隔离。
- `block(H)` 要求 H ≤ 1024（一个 block 最多 1024 线程），且 dispatch 里 H 只支持 2 的幂——因为 block_reduce 模板 NUM_THREADS 必须是 2 幂（03 讲过原因）。
- `exp_val` 在 reduce **之前**就算好存进寄存器，reduce 完直接除——注意每个线程的 `exp_val` 在 reduce 过程中没被破坏（reduce 是值传递），所以不用重新 load x。

**数值炸弹**：`expf(x)` 直接算。x 稍大（比如 100），e^100 ≈ 2.7e43，f32 直接溢出成 inf，inf/inf = NaN。softmax 里 x 是 attention score，数值范围不受控，所以裸版只能玩玩，生产必须 safe 版。

---

```c++
// safe_softmax per token
__global__ void safe_softmax_f32_per_token_kernel(float *x, float *y, int N) {
  const int idx = blockIdx.x * blockDim.x + tid;
  float val = (idx < N) ? x[idx] : -FLT_MAX;
  float max_val = block_reduce_max_f32<NUM_THREADS>(val); // block max
  float exp_val = (idx < N) ? expf(val - max_val) : 0.0f;
  float exp_sum = block_reduce_sum_f32<NUM_THREADS>(exp_val); // block sum
  if (idx < N)
    y[idx] = exp_val / exp_sum;
}
```

**数值稳定版（safe softmax）**，torch 内部也是这么做的。恒等变形：

```
softmax(x) = e^{x_i} / Σe^{x_j}
           = e^{x_i - m} / Σe^{x_j - m}     ← 分子分母同乘 e^{-m}
```

- 先 **reduce 求行最大值 m**（`block_reduce_max_f32`——把 03 的 sum reduce 换成 max reduce，`__shfl_xor_sync` 里 `+` 换 `fmaxf`，骨架完全一样）。
- 再算 `expf(x_i - m)`：减去 max 后指数部分 `x_i - m ≤ 0`，exp 结果 ∈ (0, 1]，**永不溢出**。最大那个元素 exp=1，其余更小，数值稳定。
- **代价：两次 reduce**（一次 max、一次 sum），而且 max 必须先算完才能算 exp——两次 reduce 之间有依赖，不能并行。实测也确实慢：H=1024 时 safe 版 0.0387ms vs 朴素版 0.0258ms。
- 越界元素填 `-FLT_MAX`（max 的单位元）——max(-FLT_MAX, x) = x，加进来不影响。

---

```c++
// FP16 变体: f16 加载、f32 计算
float val = (idx < N) ? __half2float(x[idx]) : -FLT_MAX;
float max_val = block_reduce_max_f32<NUM_THREADS>(val);
...
pack_y[i] = __float2half_rn(exp_vals[i] / exp_sum);
```

- 03 的 `f16_f32` 混合精度策略直接套用：**load 是 half（省一半带宽），load 完立刻转 float，全部计算在 f32，最后写回时转 half**。softmax 的 exp 和除法在 f16 下精度/动态范围都很危险，acc 必须 f32。
- `f16x8_pack` 版：`LDST128BITS` 一次 128bit 拉 8 个 half（02 讲过），reduce 前在寄存器里展开逐个转 f32。
- 注意原版 `f16x8_pack` 的 store 是 `if ((idx + 7) < N)` 整块写、**没有尾部逐元素 fallback**（代码里留着 `// TODO: support non 8-multiple K here`）——只支持 8 倍数 H，dispatch 也确实只放行 8 倍数 H。

---

```c++
// DS required for Online Softmax
struct __align__(8) MD {
  float m;
  float d;
};
// Warp Reduce for Online Softmax
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ MD warp_reduce_md_op(MD value) {
  unsigned int mask = 0xffffffff;
#pragma unroll
  for (int stride = kWarpSize >> 1; stride >= 1; stride >>= 1) {
    MD other;
    other.m = __shfl_xor_sync(mask, value.m, stride);
    other.d = __shfl_xor_sync(mask, value.d, stride);

    bool value_bigger = (value.m > other.m);
    MD bigger_m = value_bigger ? value : other;
    MD smaller_m = value_bigger ? other : value;

    value.d = bigger_m.d + smaller_m.d * __expf(smaller_m.m - bigger_m.m);
    value.m = bigger_m.m;
  }
  return value;
}
```

**Online softmax**——本篇高潮，FlashAttention 的核心思想（论文 arXiv:1805.02867）。

问题：safe softmax 要两次 reduce（max、sum），**max 没算完就不能算 exp，必须等**。如果数据不在一个 block 里（比如 KV 序列很长要分块处理，FA 就是这个场景），就要**两遍扫描**所有数据——第一遍找 max，第二遍算 exp 求和。FA 的 KV 分块场景里两遍扫描 = KV 数据过两遍显存，带宽直接翻倍。

online softmax 的答案：**一遍扫描，边扫边修正**。关键观察：如果我处理到一半，目前局部最大是 `m_old`、局部 exp 和是 `d_old`，现在来了个更大的 `m_new`，那么旧的 `d_old` 是按 `m_old` 算的，需要重标定（rescale）：

```
d_new = d_old * e^{m_old - m_new} + e^{x_new - m_new}
m_new = max(m_old, x_new)
```

- `MD` 结构体把 (m, d) 两个数**打包成一个值**参与 reduce。`__align__(8)`：8 字节对齐，这样 `__shfl_xor_sync` 可以一条 shuffle 8 字节（两个 float 一次过），m 和 d 一起搬。
- `warp_reduce_md_op` 是**融合的 max+sum 蝴蝶归约**：每轮 shuffle 同时交换 m 和 d，然后**在寄存器里立刻做重标定**——`bigger_m.d + smaller_m.d * e^{smaller.m - bigger.m}` 就是上面的 rescale 公式。归约结束时 MD 同时拿到全局 max 和全局 sum。**一次 reduce 顶原来两次**，max 和 sum 不是先后依赖而是融合在一轮里同步收敛。
- 这个"合并数据为一个不可交换的复合单位元做归约"的套路，就是经典的 **monoid reduce**——(max, scaled-sum) 构成一个 monoid，m 是"零元"里 max 部分的 -inf，d 部分的 0。

---

```c++
__global__ void online_safe_softmax_f32_per_token_kernel(const float *x,
                                                         float *y, int N) {
  ...
  MD val;
  val.m = global_tid < N ? x[global_tid] : -FLT_MAX;
  val.d = global_tid < N ? 1.0f : 0.0f;
  __shared__ MD shared[WARP_NUM];
  MD res = warp_reduce_md_op<WARP_SIZE>(val);
  if (lane_id == 0) shared[warp_id] = res;
  __syncthreads();
  if (local_tid < WARP_SIZE) {
    MD block_res = local_tid < WARP_NUM ? shared[local_tid] : MD{-FLT_MAX, 0.0f};
    block_res = warp_reduce_md_op<WARP_NUM>(block_res);
    if (local_tid == 0) shared[0] = block_res;
  }
  __syncthreads();
  MD final_res = shared[0];
  float d_total_inverse = __fdividef(1.0f, final_res.d);
  if (global_tid < N) {
    y[global_tid] = __expf(x[global_tid] - final_res.m) * d_total_inverse;
  }
}
```

- 结构还是两阶段 reduce 骨架，只是 reduce 的"值"从 float 换成了 MD。
- **每线程的初始 MD 是 `{x_i, 1}`**：自己的 m 就是自己的值，d=1（自己对自己 exp(x-x)=1）。
- 第二阶段结尾**没有 `__shfl_sync` 广播**，而是 `shared[0]` 读回：MD 是 8 字节，用 smem 广播比再 shuffle 一次简单。之后所有线程拿同一个 (m,d) 算 `exp(x_i-m)/d` 写回。
- `__fdividef`：快速除法（`--use_fast_math` 下等效），把除法变乘 `1/d`——每个线程都要除一次，先算倒数再乘省 31 次除法。
- 注意最后写回时**重新读了一次 x**（`x[global_tid]`）而不是缓存寄存器——因为 MD reduce 之后寄存器里的原始值已被覆盖（val 被合并进 MD 了），重新 load 一次 L1 命中，代价很小。

**在单 block 场景里 online 并不比两遍快多少**（数据本来就在寄存器/smem 里，两次 reduce 的延迟重叠不了而已）。它的真正价值在 **FA 的 KV 分块**：每个 block 处理一段 KV，把上一步的 (m,d) 从寄存器带过来和新块做 `warp_reduce_md_op` 式的合并——**数据只过一遍**。本篇先记住 MD 合并公式，第三阶段 FA 会看到它大放异彩。

## 实测数据（4090, S=4096, 原版）

**H=1024（f32 系列）**：

| kernel | 耗时 |
|---|---|
| f32 朴素 | 0.0258ms |
| f32x4 朴素 | 0.0098ms |
| f32 safe（两遍） | 0.0387ms |
| f32 safe+online（单遍） | 0.0299ms |
| f32x4 safe+online | **0.0101ms** |
| torch.softmax | 0.0127ms |

**H=1024（f16 系列）**：

| kernel | 耗时 |
|---|---|
| f16f32 safe | 0.0377ms |
| f16x2f32 safe | 0.0148ms |
| f16x8packf32 safe | **0.0061ms** |
| torch.softmax(f16) | 0.0088ms |

观察：

- **safe 比朴素慢 ~50%**（两次 reduce 的代价），online 把它追回大半。
- **向量化收益依然是头等因素**：f16x8packf32 比 f16f32 快 6 倍（0.0061 vs 0.0377ms），比 torch 还快 30%+。
- **H 越大 f16x8pack 优势越大**：H=4096 时 f16x8packf32 = 0.0192ms vs torch f16 = 0.0666ms（3.5x）。因为 H 越大单 block 处理数据越多，128bit load 的带宽优势越能摊薄 reduce 固定开销。

## 本篇小结

1. **per-token 映射**：一行一个 block，行间天然隔离不需要 atomicAdd/跨 block 通信，是 per-token 类算子（softmax/layernorm）的标准切法。
2. **safe softmax**：减行 max 防溢出，`e^{x-m}/Σe^{x_j-m}` 恒等变形；代价是 max、sum 两次有依赖的 reduce。
3. **online softmax**：(m,d) 打包成 MD，shuffle 交换 + 寄存器内 rescale（`d_new = d_old·e^{m_old-m_new} + ...`），一次 reduce 同时收敛 max 和 sum；单 block 场景收益有限，FA 的 KV 分块场景（数据只过一遍）才是它的主场。
4. **f16 load + f32 acc**：03 的混合精度策略在 softmax 完整复用，exp/除法必须 f32。
5. **dispatch 约束链**：H ≤ 1024（block 上限）× H 是 2 的幂（reduce 模板）× H 是 pack 宽度倍数（向量化 store 整块写）——三者交集才有 fast path，其余 throw。

