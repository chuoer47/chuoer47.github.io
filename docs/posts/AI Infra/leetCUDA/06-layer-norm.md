---
title: Layer Norm
order: 6
---

# Layer Norm CUDA代码学习

> 本人学习笔记，AI总结

LayerNorm 是 Transformer 每层都跑两遍的算子。本篇 = 04 的 per-token 映射 + 03 的 block reduce + **一个新的东西：reduce 结果要广播回全 block**（softmax 的 reduce 结果只是用来除，这里 mean/std 要参与每个元素的后续计算），以及 **Welford 之外的两遍法**和**寄存器缓存数据避免二次 load**。

公式：`y = (x - mean) / std * g + b`，其中 `mean = Σx/K`，`1/std = rsqrt(Σ(x-mean)²/K + ε)`。

## 完整代码

### `layer_norm.cu`
<details>
<summary> layer_norm.cu </summary>

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

// Block reduce sum/max/min device helper for Layer/RMS Norm/Softmax etc.
// grid 1D block 1D, grid(N/256), block(256)
template <const int NUM_THREADS = 256>
__device__ float block_reduce_sum_f32(float val) {
  // always <= 32 warps per block (limited by 1024 threads per block)
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  int warp = threadIdx.x / WARP_SIZE;
  int lane = threadIdx.x % WARP_SIZE;
  static __shared__ float shared[NUM_WARPS];

  val = warp_reduce_sum_f32<WARP_SIZE>(val);
  if (lane == 0)
    shared[warp] = val;
  __syncthreads();
  val = (lane < NUM_WARPS) ? shared[lane] : 0.0f;
  val = warp_reduce_sum_f32<NUM_WARPS>(val);
  return val;
}

// Layer Norm: x: NxK(K=256<1024), y': NxK, y'=x-mean(x)/std(x) each row
// mean(x) = sum(x)/K, 1/std(x) = rsqrtf( sum( (x-mean(x))^2 )/K ) each row
// grid(N*K/K), block(K<1024) N=batch_size*seq_len, K=hidden_size
// y=y'*g + b (g: scale, b: bias)
template <const int NUM_THREADS = 256>
__global__ void layer_norm_f32_kernel(float *x, float *y, float g, float b,
                                      int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = bid * blockDim.x + threadIdx.x;
  const float epsilon = 1e-5f;

  __shared__ float s_mean;                     // shared within block
  __shared__ float s_variance;                 // shared within block
  float value = (idx < N * K) ? x[idx] : 0.0f; // load once only
  float sum = block_reduce_sum_f32<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / (float)K;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  float variance = (value - s_mean) * (value - s_mean);
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K)
    y[idx] = ((value - s_mean) * s_variance) * g + b;
}

// Layer Norm Vec4: x: NxK(K=256<1024), y': NxK, y'=x-mean(x)/std(x) each row
// mean(x) = sum(x)/K, 1/std(x) = rsqrtf( sum( (x-mean(x))^2 )/K ) each row
// grid(N*K/K), block(K/4<1024) N=batch_size*seq_len, K=hidden_size
// y=y'*g + b (g: scale, b: bias)
template <const int NUM_THREADS = 256 / 4>
__global__ void layer_norm_f32x4_kernel(float *x, float *y, float g, float b,
                                        int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 4;
  const float epsilon = 1e-5f;

  __shared__ float s_mean;     // shared within block
  __shared__ float s_variance; // shared within block
  float4 reg_x = FLOAT4(x[idx]);
  float value = (idx < N * K) ? (reg_x.x + reg_x.y + reg_x.z + reg_x.w) : 0.0f;
  float sum = block_reduce_sum_f32<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / (float)K;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  float4 reg_x_hat;
  reg_x_hat.x = reg_x.x - s_mean;
  reg_x_hat.y = reg_x.y - s_mean;
  reg_x_hat.z = reg_x.z - s_mean;
  reg_x_hat.w = reg_x.w - s_mean;
  float variance = reg_x_hat.x * reg_x_hat.x + reg_x_hat.y * reg_x_hat.y +
                   reg_x_hat.z * reg_x_hat.z + reg_x_hat.w * reg_x_hat.w;
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  float4 reg_y;
  reg_y.x = reg_x_hat.x * s_variance * g + b;
  reg_y.y = reg_x_hat.y * s_variance * g + b;
  reg_y.z = reg_x_hat.z * s_variance * g + b;
  reg_y.w = reg_x_hat.w * s_variance * g + b;
  if (idx < N * K)
    FLOAT4(y[idx]) = reg_y;
}

// FP16
// Warp Reduce Sum: Half
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ half warp_reduce_sum_f16_f16(half val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    // val = __hadd(val, __shfl_xor_sync(0xffffffff, val, mask));
    val += __shfl_xor_sync(0xffffffff, val, mask);
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
__device__ half block_reduce_sum_f16_f16(half val) {
  // always <= 32 warps per block (limited by 1024 threads per block)
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  int warp = threadIdx.x / WARP_SIZE;
  int lane = threadIdx.x % WARP_SIZE;
  static __shared__ half shared[NUM_WARPS];
  // reduce using half dtype within warps
  val = warp_reduce_sum_f16_f16<WARP_SIZE>(val);
  if (lane == 0)
    shared[warp] = val;
  __syncthreads();
  val = (lane < NUM_WARPS) ? shared[lane] : __float2half(0.0f);
  val = warp_reduce_sum_f16_f16<NUM_WARPS>(val);
  return val; // half
}

template <const int NUM_THREADS = 256>
__device__ float block_reduce_sum_f16_f32(half val) {
  // always <= 32 warps per block (limited by 1024 threads per block)
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  int warp = threadIdx.x / WARP_SIZE;
  int lane = threadIdx.x % WARP_SIZE;
  static __shared__ float shared[NUM_WARPS];
  // reduce using float dtype within warps
  float val_f32 = warp_reduce_sum_f16_f32<WARP_SIZE>(val);
  if (lane == 0)
    shared[warp] = val_f32;
  __syncthreads();
  val_f32 = (lane < NUM_WARPS) ? shared[lane] : 0.0f;
  val_f32 = warp_reduce_sum_f32<NUM_WARPS>(val_f32);
  return val_f32; // float
}

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16_f16_kernel(half *x, half *y, float g, float b,
                                          int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = bid * blockDim.x + threadIdx.x;
  const half epsilon = __float2half(1e-5f);
  const half g_ = __float2half(g);
  const half b_ = __float2half(b);
  const half K_ = __int2half_rn(K);

  __shared__ half s_mean;     // shared within block
  __shared__ half s_variance; // shared within block
  half value = (idx < N * K) ? x[idx] : __float2half(0.0f); // load once only
  half sum = block_reduce_sum_f16_f16<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / K_;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  half variance = (value - s_mean) * (value - s_mean);
  variance = block_reduce_sum_f16_f16<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = hrsqrt(variance / K_ + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K) {
    y[idx] = __hfma((value - s_mean) * s_variance, g_, b_);
    // y[idx] = ((value - s_mean) * s_variance) * g_ + b_;
  }
}

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16x2_f16_kernel(half *x, half *y, float g, float b,
                                            int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 2;
  const half epsilon = __float2half(1e-5f);
  const half g_ = __float2half(g);
  const half b_ = __float2half(b);
  const half K_ = __int2half_rn(K);

  __shared__ half s_mean;     // shared within block
  __shared__ half s_variance; // shared within block
  half2 reg_x = HALF2(x[idx]);
  half value = (idx < N * K) ? (reg_x.x + reg_x.y) : __float2half(0.0f);
  half sum = block_reduce_sum_f16_f16<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / K_;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  half2 reg_x_hat;
  reg_x_hat.x = reg_x.x - s_mean;
  reg_x_hat.y = reg_x.y - s_mean;
  half variance = reg_x_hat.x * reg_x_hat.x + reg_x_hat.y * reg_x_hat.y;
  variance = block_reduce_sum_f16_f16<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = hrsqrt(variance / K_ + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K) {
    half2 reg_y;
    reg_y.x = __hfma(reg_x_hat.x * s_variance, g_, b_);
    reg_y.y = __hfma(reg_x_hat.y * s_variance, g_, b_);
    HALF2(y[idx]) = reg_y;
  }
}

#define HALF2_SUM(reg, i)                                                      \
  (((idx + (i)) < N * K) ? ((reg).x + (reg).y) : __float2half(0.0f))

#define HALF2_SUB(reg_y, reg_x)                                                \
  (reg_y).x = (reg_x).x - s_mean;                                              \
  (reg_y).y = (reg_x).y - s_mean;

#define HALF2_VARIANCE(reg, i)                                                 \
  (((idx + (i)) < N * K) ? ((reg).x * (reg).x + (reg).y * (reg).y)             \
                         : __float2half(0.0f))

#define HALF2_LAYER_NORM(reg_y, reg_x, g_, b_)                                 \
  (reg_y).x = __hfma((reg_x).x * s_variance, g_, b_);                          \
  (reg_y).y = __hfma((reg_x).y * s_variance, g_, b_);

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16x8_f16_kernel(half *x, half *y, float g, float b,
                                            int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 8;
  const half epsilon = __float2half(1e-5f);
  const half g_ = __float2half(g);
  const half b_ = __float2half(b);
  const half K_ = __int2half_rn(K);

  __shared__ half s_mean;     // shared within block
  __shared__ half s_variance; // shared within block
  half2 reg_x_0 = HALF2(x[idx + 0]);
  half2 reg_x_1 = HALF2(x[idx + 2]);
  half2 reg_x_2 = HALF2(x[idx + 4]);
  half2 reg_x_3 = HALF2(x[idx + 6]);

  half value = HALF2_SUM(reg_x_0, 0);
  value += HALF2_SUM(reg_x_1, 2);
  value += HALF2_SUM(reg_x_2, 4);
  value += HALF2_SUM(reg_x_3, 6);

  half sum = block_reduce_sum_f16_f16<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / K_;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  // manual unroll
  half2 reg_x_hat_0, reg_x_hat_1, reg_x_hat_2, reg_x_hat_3;
  HALF2_SUB(reg_x_hat_0, reg_x_0);
  HALF2_SUB(reg_x_hat_1, reg_x_1);
  HALF2_SUB(reg_x_hat_2, reg_x_2);
  HALF2_SUB(reg_x_hat_3, reg_x_3);

  half variance = HALF2_VARIANCE(reg_x_hat_0, 0);
  variance += HALF2_VARIANCE(reg_x_hat_1, 2);
  variance += HALF2_VARIANCE(reg_x_hat_2, 4);
  variance += HALF2_VARIANCE(reg_x_hat_3, 6);

  variance = block_reduce_sum_f16_f16<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = hrsqrt(variance / K_ + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  // manual unroll
  half2 reg_y_0, reg_y_1, reg_y_2, reg_y_3;
  HALF2_LAYER_NORM(reg_y_0, reg_x_hat_0, g_, b_);
  HALF2_LAYER_NORM(reg_y_1, reg_x_hat_1, g_, b_);
  HALF2_LAYER_NORM(reg_y_2, reg_x_hat_2, g_, b_);
  HALF2_LAYER_NORM(reg_y_3, reg_x_hat_3, g_, b_);

  if ((idx + 0) < N * K) {
    HALF2(y[idx + 0]) = reg_y_0;
  }
  if ((idx + 2) < N * K) {
    HALF2(y[idx + 2]) = reg_y_1;
  }
  if ((idx + 4) < N * K) {
    HALF2(y[idx + 4]) = reg_y_2;
  }
  if ((idx + 6) < N * K) {
    HALF2(y[idx + 6]) = reg_y_3;
  }
}

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16_f32_kernel(half *x, half *y, float g, float b,
                                          int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = bid * blockDim.x + threadIdx.x;
  const float epsilon = 1e-5f;

  __shared__ float s_mean;     // shared within block
  __shared__ float s_variance; // shared within block
  float value = (idx < N * K) ? __half2float(x[idx]) : 0.0f; // load once only
  float sum = block_reduce_sum_f32<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / (float)K;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  float variance = (value - s_mean) * (value - s_mean);
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K) {
    // x*y + z -> x'*g + b
    y[idx] = __float2half(__fmaf_rn(((value - s_mean) * s_variance), g, b));
  }
}

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16x8_pack_f16_kernel(half *x, half *y, float g,
                                                 float b, int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 8;
  const half epsilon = __float2half(1e-5f);
  const half g_ = __float2half(g);
  const half b_ = __float2half(b);
  const half K_ = __int2half_rn(K);
  const half z_ = __float2half(0.0f);

  __shared__ half s_mean;     // shared within block
  __shared__ half s_variance; // shared within block
  // temporary register(memory), .local space in ptx, addressable
  half pack_x[8], pack_y[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_x[0]) = LDST128BITS(x[idx]); // load 128 bits

  half value = z_;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    value += ((idx + i) < N * K ? pack_x[i] : z_);
  }
  half sum = block_reduce_sum_f16_f16<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / K_;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();

  half variance = z_;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    half v_hat = pack_x[i] - s_mean;
    variance += ((idx + i) < N * K ? v_hat * v_hat : z_);
  }
  variance = block_reduce_sum_f16_f16<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = hrsqrt(variance / K_ + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();

#pragma unroll
  for (int i = 0; i < 8; ++i) {
    // TODO: use __hfma2, __hsub2, __hmul2 here
    pack_y[i] = __hfma((pack_x[i] - s_mean) * s_variance, g_, b_);
  }
  // reinterpret as float4 and store 128 bits in 1 memory issue.
  if ((idx + 7) < N * K) {
    LDST128BITS(y[idx]) = LDST128BITS(pack_y[0]);
  }
  // TODO: support non 8-multiple K here
}

template <const int NUM_THREADS = 256>
__global__ void layer_norm_f16x8_pack_f32_kernel(half *x, half *y, float g,
                                                 float b, int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 8;
  const float epsilon = 1e-5f;

  __shared__ float s_mean;     // shared within block
  __shared__ float s_variance; // shared within block
  // temporary register(memory), .local space in ptx, addressable
  half pack_x[8], pack_y[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_x[0]) = LDST128BITS(x[idx]); // load 128 bits

  float value = 0.0f;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    value += ((idx + i) < N * K ? __half2float(pack_x[i]) : 0.0f);
  }
  float sum = block_reduce_sum_f32<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / (float)K;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();

  float variance = 0.0f;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    float v_hat = __half2float(pack_x[i]) - s_mean;
    variance += ((idx + i) < N * K ? v_hat * v_hat : 0.0f);
  }
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();

#pragma unroll
  for (int i = 0; i < 8; ++i) {
    pack_y[i] = __float2half(
        __fmaf_rn(((__half2float(pack_x[i]) - s_mean) * s_variance), g, b));
  }
  // reinterpret as float4 and store 128 bits in 1 memory issue.
  if ((idx + 7) < N * K) {
    LDST128BITS(y[idx]) = LDST128BITS(pack_y[0]);
  }
  // TODO: support non 8-multiple K here
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

// fp32
#define LANUCH_LAYER_NORM_F32_KERNEL(K)                                        \
  layer_norm_f32_kernel<(K)><<<grid, block>>>(                                 \
      reinterpret_cast<float *>(x.data_ptr()),                                 \
      reinterpret_cast<float *>(y.data_ptr()), g, b, N, (K));

#define DISPATCH_LAYER_NORM_F32_KERNEL(N, K)                                   \
  dim3 block((K));                                                             \
  dim3 grid((N));                                                              \
  switch ((K)) {                                                               \
  case 64:                                                                     \
    LANUCH_LAYER_NORM_F32_KERNEL(64)                                           \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_LAYER_NORM_F32_KERNEL(128)                                          \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_LAYER_NORM_F32_KERNEL(256)                                          \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_LAYER_NORM_F32_KERNEL(512)                                          \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_LAYER_NORM_F32_KERNEL(1024)                                         \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error("only support K: 64/128/256/512/1024");           \
    break;                                                                     \
  }

// ... f32x4/f16/f16x2/f16x8/f16x8_pack 的 dispatch 同构, 详见完整代码

#define LANUCH_LAYER_NORM_F16x8_PACK_F32_KERNEL(K)                             \
  layer_norm_f16x8_pack_f32_kernel<(K) / 8>                                    \
      <<<grid, block>>>(reinterpret_cast<half *>(x.data_ptr()),                \
                        reinterpret_cast<half *>(y.data_ptr()), g, b, N, (K));

void layer_norm_f32(torch::Tensor x, torch::Tensor y, float g, float b) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  CHECK_TORCH_TENSOR_SHAPE(x, y)
  const int N = x.size(0);
  const int K = x.size(1);
  DISPATCH_LAYER_NORM_F32_KERNEL(N, K)
}

// ... 其余 7 个 host wrapper 同构

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f32)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f32x4)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16_f16)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16_f32)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16x2_f16)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16x8_f16)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16x8_pack_f16)
  TORCH_BINDING_COMMON_EXTENSION(layer_norm_f16x8_pack_f32)
}
```

</details>

### `layer_norm.py`
<details>
<summary> layer_norm.py </summary>

```python
import time
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="layer_norm_lib",
    sources=["layer_norm.cu"],
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


# un-fused naive layer norm
def naive_layer_norm(x: torch.Tensor, g: float, b: float):
    s_mean = torch.mean(x, dim=1, keepdim=True)  # m
    s_variance = 1 / torch.std(x, dim=1, keepdim=True)  # 1/std(x)
    y = ((x - s_mean) * s_variance) * g + b
    return y


def run_benchmark(
    perf_func: callable,
    x: torch.Tensor,
    tag: str,
    out: Optional[torch.Tensor] = None,
    warmup: int = 10,
    iters: int = 1000,
    show_all: bool = False,
):
    g = 1.0
    b = 0.0
    if out is not None:
        out.fill_(0)
    if out is not None:
        for i in range(warmup):
            perf_func(x, out, g, b)
    else:
        for i in range(warmup):
            _ = perf_func(x, g, b)
    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            perf_func(x, out, g, b)
    else:
        for i in range(iters):
            out = perf_func(x, g, b)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten().detach().cpu().numpy().tolist()[:3]
    out_val = [round(v, 8) for v in out_val]
    out_val = [f"{v:<12}" for v in out_val]
    print(f"{out_info:>17}: {out_val}, time:{mean_time:.8f}ms")
    if show_all:
        print(out)
    return out, mean_time


print("-" * 85)
N, K = 4096, 512
print(" " * 40 + f"N={N}, K={K}")
print("-" * 85)
x = torch.randn((N, K)).cuda().float().contiguous()
out = torch.zeros_like(x).cuda().float().contiguous()
run_benchmark(lib.layer_norm_f32, x, "f32", out)
run_benchmark(lib.layer_norm_f32x4, x, "f32x4", out)
run_benchmark(naive_layer_norm, x, "f32_th")

print("-" * 85)
x_f16 = x.half()
out_f16 = out.half()
run_benchmark(lib.layer_norm_f16_f16, x_f16, "f16f16", out_f16)
run_benchmark(lib.layer_norm_f16_f32, x_f16, "f16f32", out_f16)
run_benchmark(lib.layer_norm_f16x2_f16, x_f16, "f16x2f16", out_f16)
run_benchmark(lib.layer_norm_f16x8_f16, x_f16, "f16x8f16", out_f16)
run_benchmark(lib.layer_norm_f16x8_pack_f16, x_f16, "f16x8packf16", out_f16)
run_benchmark(lib.layer_norm_f16x8_pack_f32, x_f16, "f16x8packf32", out_f16)
run_benchmark(naive_layer_norm, x_f16, "f16_th")
print("-" * 85)

print(" " * 40 + f"f16 overflow without f32")
print("-" * 85)
x_f16 = x.half() * 100  # this will cause overflow for kernels without `f32`
run_benchmark(lib.layer_norm_f16_f16, x_f16, "f16f16", out_f16)
run_benchmark(lib.layer_norm_f16_f32, x_f16, "f16f32", out_f16)
run_benchmark(lib.layer_norm_f16x2_f16, x_f16, "f16x2f16", out_f16)
run_benchmark(lib.layer_norm_f16x8_f16, x_f16, "f16x8f16", out_f16)
run_benchmark(lib.layer_norm_f16x8_pack_f16, x_f16, "f16x8packf16", out_f16)
run_benchmark(lib.layer_norm_f16x8_pack_f32, x_f16, "f16x8packf32", out_f16)
run_benchmark(naive_layer_norm, x_f16, "f16_th")
print("-" * 85)

# ... 后面 N,K = 4096x1024, 4096x2048, 4096x4096, 4096x8192, 8192x8192
#     同样套路, 略
```

</details>

## 逐段代码剖析/学习

两阶段 block reduce、per-token 映射、向量化、f16+f32acc 命名法——全是 03/04 的积木，不再重复。本篇的新东西按重要性排：

---

```c++
template <const int NUM_THREADS = 256>
__global__ void layer_norm_f32_kernel(float *x, float *y, float g, float b,
                                      int N, int K) {
  int idx = bid * blockDim.x + threadIdx.x;
  const float epsilon = 1e-5f;

  __shared__ float s_mean;                     // shared within block
  __shared__ float s_variance;                 // shared within block
  float value = (idx < N * K) ? x[idx] : 0.0f; // load once only
  float sum = block_reduce_sum_f32<NUM_THREADS>(value);
  if (tid == 0)
    s_mean = sum / (float)K;
  // wait for s_mean in shared memory to be ready for all threads
  __syncthreads();
  float variance = (value - s_mean) * (value - s_mean);
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K)
    y[idx] = ((value - s_mean) * s_variance) * g + b;
}
```

**LayerNorm 主骨架**。对比 softmax，有一个结构性的新问题：**softmax 的 reduce 结果（exp_sum）只是分母，每个线程拿来一除就完事；LayerNorm 的 mean/variance 是"中间量"，每个线程还要用自己的原始数据 `value` 跟它做后续计算**。这带来两个新动作：

1. **reduce 结果必须广播回全 block**。`block_reduce_sum_f32` 归约结束时只有 warp 0 的 lane 0 有结果（03 讲过蝴蝶归约的特点：所有 lane 都有，但第二阶段 `warp_reduce_sum_f32<NUM_WARPS>` 只在 warp 0 里做，其它 warp 没有）。这里的方案：**tid 0 把结果写进一个标量 shared 变量 `s_mean`，`__syncthreads()`，然后全 block 读它**。注意和 03 的 `shared[NUM_WARPS]` 数组不同，这里广播用的是**单标量 smem**——因为要广播的是"最终结果"，只需要一个格子。
2. **原始数据必须留在寄存器**。`value` 只 load 一次（注释 `// load once only`），因为 mean 算完后要再用 `value` 算方差、variance 算完后还要用 `value` 算输出。如果每次用都重新 load x，三次 global 读取代价翻倍。**"load once, 用到底"是所有多遍计算 kernel 的铁律**。

**三段式结构**（load → reduce mean → reduce variance → scale 写回）：

```
value = x[idx]                      (load once, 留在寄存器)
sum = block_reduce(value); s_mean = sum/K; __syncthreads();
variance = block_reduce((value-s_mean)²); s_variance = rsqrt(var/K+ε); __syncthreads();
y[idx] = (value - s_mean) * s_variance * g + b
```

注意**两次 `__syncthreads()` 的位置**：第一次等 `s_mean` 就绪（variance 的计算依赖它），第二次等 `s_variance` 就绪（输出依赖它）。这是"reduce → 广播 → 依赖前值再 reduce"的串行链，sync 点掐在依赖处。04 的 softmax 没这个问题是因为它两次 reduce（max、sum）互相独立，可以背靠背。

- `rsqrtf(var/K + ε)`：直接算 `1/std` 而不是 `1/sqrt(std)`——一次近似倒数开方指令，比 sqrt+div 快，且先除后加 ε 防 std=0 除零。
- `epsilon = 1e-5f`：防方差为 0（全相等行）的护城河，和 PyTorch 的 `torch.nn.LayerNorm` 默认 eps 一致。

---

```c++
// f16x8_pack 的两种 acc, 关键差异行
// f16 acc:
half value = z_;
for (int i = 0; i < 8; ++i) value += pack_x[i];          // half 累加
s_mean = sum / K_;                                        // half 除法
s_variance = hrsqrt(variance / K_ + epsilon);             // half rsqrt

// f32 acc:
float value = 0.0f;
for (int i = 0; i < 8; ++i) value += __half2float(pack_x[i]);  // 转 float 累加
s_mean = sum / (float)K;
s_variance = rsqrtf(variance / (float)K + epsilon);       // float rsqrt
```

**本篇最值得看的实测：f16 acc 的溢出现场**。layer_norm.py 里专门造了一个对照实验：`x_f16 = x.half() * 100`（数值放大 100 倍，K=512 行内和 ≈ ±100×√512×100 量级），f16 max ≈ 65504，求和直接爆。实测（N=4096, K=512, x×100）：

| kernel | acc | 输出前3个值 |
|---|---|---|
| f16f16 | f16 | **0.0, 0.0, 0.0**（溢出→inf→0） |
| f16x2f16 | f16 | **0.0, 0.0, 0.0** |
| f16x8packf16 | f16 | **0.0, 0.0, 0.0** |
| f16f32 | f32 | 0.396, 0.963, -0.559（正常） |
| f16x8packf32 | f32 | 0.396, 0.963, -0.559（正常） |
| naive(torch) | f32 | 0.396, 0.962（正常） |

**所有 f16 acc 版本全灭，输出清一色 0**——和 03 里"f16 acc 只是误差大"不同，这里 K 大 + 数值大时 f16 acc 是**直接溢出报废**。03 的结论要升级：**reduce 类累加，f16 acc 不是"精度选择"而是"定时炸弹"**，LLM 里 hidden_size 常是 4096+，activation 大时必炸。这就是为什么所有生产 LN/RMSNorm kernel 无一例外 f32 acc。

顺带注意 f16 intrinsic 家族：`hrsqrt`（half rsqrt）、`__hfma`（half 融合乘加，乘加一条指令）、`__hmul`（half 乘）。f32 对应 `rsqrtf`、`__fmaf_rn`。

---

```c++
#define HALF2_SUM(reg, i) ...
#define HALF2_SUB(reg_y, reg_x) ...
#define HALF2_VARIANCE(reg, i) ...
#define HALF2_LAYER_NORM(reg_y, reg_x, g_, b_) ...

// f16x8 版本: 4 个 half2 手动展开
half2 reg_x_0 = HALF2(x[idx + 0]);
half2 reg_x_1 = HALF2(x[idx + 2]);
half2 reg_x_2 = HALF2(x[idx + 4]);
half2 reg_x_3 = HALF2(x[idx + 6]);
```

`f16x8` 版（非 pack）用一个**半手动展开**的写法：8 个 half 拆成 4 个 `half2`，配 4 个小宏（SUM/SUB/VARIANCE/LAYER_NORM）各展开 4 次。和 `f16x8_pack` 的区别：pack 版用 `LDST128BITS` 把 8 个 half 一次 load 进 `pack_x[8]` 数组再循环；非 pack 版直接发 4 条 `HALF2` load。**教学上 pack 版是"load 向量化"，非 pack 版是"计算向量化"**，两者殊途同归（`f16x8` 代码里还留着 `// TODO: use __hfma2, __hsub2, __hmul2 here`——计算向量化还可以再进一步，pack 版留了这个作业没做）。

这种"宏 + 手动展开"在真实工程里常用模板/`#pragma unroll` 替代，但手写展开对理解每条指令在干嘛更友好。

## 实测数据（4090）

**N=4096, K=512（正常量级）**：

| kernel | 耗时 |
|---|---|
| f32 | 0.0155ms |
| f32x4 | 0.0061ms |
| naive(torch) | 0.0561ms |
| f16f16 | 0.0153ms |
| f16x2f16 | 0.0080ms |
| f16x8f16 | 0.0043ms |
| f16x8packf16 | **0.0041ms** |
| f16x8packf32 | 0.0042ms |
| naive f16(torch) | 0.0560ms |

- **手写 kernel 比未融合的 torch 算子快 10 倍以上**（0.0041 vs 0.056ms）——naive 版 `mean/std/减/除/g/b` 是 6 个独立 kernel 串行跑，每个都过一遍显存；手写版**一个 kernel 全融合**，数据只在寄存器/一级缓存里流转。**"算子融合"省的是显存往返，这是手写 CUDA 最大的收益来源**。
- f16x8packf16 和 f16x8packf32 速度几乎一样（0.0041 vs 0.0042ms）——正常量级下 acc 用 f32 **不花钱**（K=512 的求和在 f16 范围内），却买到了防爆保险。
- K=8192 时（N=8192）：f16x8packf32 = 0.2837ms vs naive 1.4562ms，5x 加速维持。

## 本篇小结

1. **reduce 结果广播**：归约完只有 warp 0 有结果，用"单标量 smem + `__syncthreads()`"广播给全 block——这是"reduce 结果参与后续逐元素计算"类算子的固定句式。
2. **load once 铁律**：多遍计算（mean→variance→scale）的原始数据只 load 一次，留在寄存器用到底。
3. **依赖链上的 sync**：两次 reduce 之间有数据依赖（variance 依赖 mean），`__syncthreads()` 掐在依赖处；对比 04 softmax 的两次独立 reduce。
4. **f16 acc 是定时炸弹**：03 说"精度差"，本篇实测 x×100 时 f16 acc 全部溢出报废（输出全 0）——LN/RSMSN 类累加必须 f32 acc，f16 只配做 load 格式。
5. **算子融合**：手写融合 kernel vs torch 未融合算子 = 10x+，收益来自显存往返次数，不是单条指令。
6. **f16 intrinsic 家族**：`hrsqrt`/`__hfma`/`__hmul` 对应 f32 的 `rsqrtf`/`__fmaf_rn`。

下一篇 RMSNorm：去掉均值中心化，只剩"平方和的 rsqrt"——正好是本篇的减法。
