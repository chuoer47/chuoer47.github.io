---
title: Reduce
order: 3
---

# Block All Reduce CUDA代码学习

> 本人学习笔记，AI总结

前面 elementwise 是"每个线程独立算自己的输出"，本篇开始是 **reduce（归约）**：把一串数变成一个数（求和）。核心难点从"怎么访存"变成"**线程之间怎么通信**"——这是后面 softmax / layer-norm / rms-norm 的地基。

## 完整代码

### `block_all_reduce.cu`
<details>
<summary> block_all_reduce.cu </summary>

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

// Block All Reduce Sum
// grid(N/256), block(256)
// a: Nx1, y=sum(a)
template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_f32_f32_kernel(float *a, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // keep the data in register is enough for warp operaion.
  float sum = (idx < N) ? a[idx] : 0.0f;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum = warp_reduce_sum_f32<WARP_SIZE>(sum);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = sum;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

// Block All Reduce Sum + float4
// grid(N/256), block(256/4)
// a: Nx1, y=sum(a)
template <const int NUM_THREADS = 256 / 4>
__global__ void block_all_reduce_sum_f32x4_f32_kernel(float *a, float *y,
                                                      int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 4;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  float4 reg_a = FLOAT4(a[idx]);
  // keep the data in register is enough for warp operaion.
  float sum = (idx < N) ? (reg_a.x + reg_a.y + reg_a.z + reg_a.w) : 0.0f;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum = warp_reduce_sum_f32<WARP_SIZE>(sum);
  // warp leaders store the data to shared memory.
  if (lane == 0)
    reduce_smem[warp] = sum;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

//  FP16
//  Warp Reduce Sum: Half
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

// Block All Reduce Sum: Half
// grid(N/256), block(256)
// a: Nx1, y=sum(a)
template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_f16_f16_kernel(half *a, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // keep the data in register is enough for warp operaion.
  half sum_f16 = (idx < N) ? a[idx] : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f16 = warp_reduce_sum_f16_f16<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = __half2float(sum_f16);
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_f16_f32_kernel(half *a, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // keep the data in register is enough for warp operaion.
  half sum_f16 = (idx < N) ? a[idx] : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float sum_f32 = warp_reduce_sum_f16_f32<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 2>
__global__ void block_all_reduce_sum_f16x2_f32_kernel(half *a, float *y,
                                                      int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 2; // 2 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  half2 reg_a = HALF2(a[idx]);
  half sum_f16 = (idx < N) ? __hadd(reg_a.x, reg_a.y) : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float sum_f32 = warp_reduce_sum_f16_f32<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 2>
__global__ void block_all_reduce_sum_f16x2_f16_kernel(half *a, float *y,
                                                      int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 2; // 2 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  half2 reg_a = HALF2(a[idx]);
  half sum_f16 = (idx < N) ? __hadd(reg_a.x, reg_a.y) : __float2half(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f16 = warp_reduce_sum_f16_f16<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = __half2float(sum_f16);
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 8>
__global__ void block_all_reduce_sum_f16x8_pack_f16_kernel(half *a, float *y,
                                                           int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 8; // 8 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // temporary register(memory), .local space in ptx, addressable
  half pack_a[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
  const half z = __float2half(0.0f);

  half sum_f16 = z;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    sum_f16 += (((idx + i) < N) ? pack_a[i] : z);
  }

  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f16 = warp_reduce_sum_f16_f16<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = __half2float(sum_f16);
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 8>
__global__ void block_all_reduce_sum_f16x8_pack_f32_kernel(half *a, float *y,
                                                           int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 8; // 8 half elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // temporary register(memory), .local space in ptx, addressable
  half pack_a[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits

  float sum_f32 = 0.0f;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    sum_f32 += (((idx + i) < N) ? __half2float(pack_a[i]) : 0.0f);
  }

  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f32 = warp_reduce_sum_f32<WARP_SIZE>(sum_f32);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

//  BF16
//  Warp Reduce Sum: Half
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ __nv_bfloat16
warp_reduce_sum_bf16_bf16(__nv_bfloat16 val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val = __hadd(val, __shfl_xor_sync(0xffffffff, val, mask));
  }
  return val;
}

template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_bf16_f32(__nv_bfloat16 val) {
  float val_f32 = __bfloat162float(val);
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val_f32 += __shfl_xor_sync(0xffffffff, val_f32, mask);
  }
  return val_f32;
}

// Block All Reduce Sum: BF16
// grid(N/256), block(256)
// a: Nx1, y=sum(a)
template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_bf16_bf16_kernel(__nv_bfloat16 *a,
                                                      float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ __nv_bfloat16 reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_bfloat16 sum_bf16 = (idx < N) ? a[idx] : __float2bfloat16(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_bf16 = warp_reduce_sum_bf16_bf16<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_bf16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  __nv_bfloat16 sum =
      (lane < NUM_WARPS) ? reduce_smem[lane] : __float2bfloat16(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_bf16_bf16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __bfloat162float(sum));
}

template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_bf16_f32_kernel(__nv_bfloat16 *a, float *y,
                                                     int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_bfloat16 sum_bf16 = (idx < N) ? a[idx] : __float2bfloat16(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float sum_f32 = warp_reduce_sum_bf16_f32<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 2>
__global__ void block_all_reduce_sum_bf16x2_bf16_kernel(__nv_bfloat16 *a,
                                                        float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 2; // 2 bf16 elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ __nv_bfloat16 reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_bfloat162 reg_a = BFLOAT2(a[idx]);
  __nv_bfloat16 sum_bf16 =
      (idx < N) ? __hadd(reg_a.x, reg_a.y) : __float2bfloat16(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_bf16 = warp_reduce_sum_bf16_bf16<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_bf16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  __nv_bfloat16 sum =
      (lane < NUM_WARPS) ? reduce_smem[lane] : __float2bfloat16(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_bf16_bf16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __bfloat162float(sum));
}

template <const int NUM_THREADS = 256 / 2>
__global__ void block_all_reduce_sum_bf16x2_f32_kernel(__nv_bfloat16 *a,
                                                       float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 2; // 2 bf16 elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_bfloat162 reg_a = BFLOAT2(a[idx]);
  __nv_bfloat16 sum_bf16 =
      (idx < N) ? __hadd(reg_a.x, reg_a.y) : __float2bfloat16(0.0f);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float sum_f32 = warp_reduce_sum_bf16_f32<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 8>
__global__ void block_all_reduce_sum_bf16x8_pack_bf16_kernel(__nv_bfloat16 *a,
                                                             float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 8; // 8 bf16 elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ __nv_bfloat16 reduce_smem[NUM_WARPS];
  // temporary register(memory), .local space in ptx, addressable
  __nv_bfloat16 pack_a[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
  const __nv_bfloat16 z = __float2bfloat16(0.0f);

  __nv_bfloat16 sum_bf16 = z;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    sum_bf16 += (((idx + i) < N) ? pack_a[i] : z);
  }

  // keep the data in register is enough for warp operaion.
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_bf16 = warp_reduce_sum_bf16_bf16<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_bf16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  __nv_bfloat16 sum = (lane < NUM_WARPS) ? reduce_smem[lane] : z;
  if (warp == 0)
    sum = warp_reduce_sum_bf16_bf16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __bfloat162float(sum));
}

template <const int NUM_THREADS = 256 / 8>
__global__ void block_all_reduce_sum_bf16x8_pack_f32_kernel(__nv_bfloat16 *a,
                                                            float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 8; // 8 bf16 elements per thread
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  // temporary register(memory), .local space in ptx, addressable
  __nv_bfloat16 pack_a[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
  const __nv_bfloat16 z = __float2bfloat16(0.0f);

  __nv_bfloat16 sum_bf16 = z;
#pragma unroll
  for (int i = 0; i < 8; ++i) {
    sum_bf16 += (((idx + i) < N) ? pack_a[i] : z);
  }

  // keep the data in register is enough for warp operaion.
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  float sum_f32 = warp_reduce_sum_bf16_f32<WARP_SIZE>(sum_bf16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp32 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  float sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

//  FP8
//
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ half
warp_reduce_sum_fp8_e4m3_f16(__nv_fp8_storage_t val) {
  // typedef unsigned char __nv_fp8_storage_t;
  // __half &operator=(const __half_raw &hr);
  half val_f16 = __nv_cvt_fp8_to_halfraw(val, __NV_E4M3);
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val_f16 = __hadd(val_f16, __shfl_xor_sync(0xffffffff, val_f16, mask));
  }
  return val_f16;
}

template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ half
warp_reduce_sum_fp8_e5m2_f16(__nv_fp8_storage_t val) {
  // typedef unsigned char __nv_fp8_storage_t;
  // __half &operator=(const __half_raw &hr);
  half val_f16 = __nv_cvt_fp8_to_halfraw(val, __NV_E5M2);
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val_f16 = __hadd(val_f16, __shfl_xor_sync(0xffffffff, val_f16, mask));
  }
  return val_f16;
}

template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_fp8_e4m3_f16_kernel(__nv_fp8_storage_t *a,
                                                         float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ half reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_fp8_storage_t sum_f8 =
      (idx < N) ? a[idx]
                : __nv_cvt_float_to_fp8(0.0f, __NV_SATFINITE, __NV_E4M3);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  half sum_f16 = warp_reduce_sum_fp8_e4m3_f16<WARP_SIZE>(sum_f8);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp16 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  half sum = (lane < NUM_WARPS) ? reduce_smem[lane] : __float2half(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_f16_f16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __half2float(sum));
}

template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_fp8_e5m2_f16_kernel(__nv_fp8_storage_t *a,
                                                         float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ half reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  __nv_fp8_storage_t sum_f8 =
      (idx < N) ? a[idx]
                : __nv_cvt_float_to_fp8(0.0f, __NV_SATFINITE, __NV_E5M2);
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  half sum_f16 = warp_reduce_sum_fp8_e5m2_f16<WARP_SIZE>(sum_f8);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp16 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  half sum = (lane < NUM_WARPS) ? reduce_smem[lane] : __float2half(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_f16_f16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __half2float(sum));
}

template <const int NUM_THREADS = 256 / 16>
__global__ void
block_all_reduce_sum_fp8_e4m3x16_pack_f16_kernel(__nv_fp8_storage_t *a,
                                                 float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 16;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ half reduce_smem[NUM_WARPS];
  __nv_fp8_storage_t pack_a[16]; // 16x8 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits

  half sum_f16 = __float2half(0.0f);
#pragma unroll
  for (int i = 0; i < 16; ++i) {
    sum_f16 += __nv_cvt_fp8_to_halfraw(pack_a[i], __NV_E4M3);
  }
  // keep the data in register is enough for warp operaion.
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f16 = warp_reduce_sum_f16_f16<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp16 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  half sum = (lane < NUM_WARPS) ? reduce_smem[lane] : __float2half(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_f16_f16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __half2float(sum));
}

template <const int NUM_THREADS = 256 / 16>
__global__ void
block_all_reduce_sum_fp8_e5m2x16_pack_f16_kernel(__nv_fp8_storage_t *a,
                                                 float *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 16;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ half reduce_smem[NUM_WARPS];
  __nv_fp8_storage_t pack_a[16]; // 16x8 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits

  half sum_f16 = __float2half(0.0f);
#pragma unroll
  for (int i = 0; i < 16; ++i) {
    sum_f16 += __nv_cvt_fp8_to_halfraw(pack_a[i], __NV_E5M2);
  }
  // keep the data in register is enough for warp operaion.
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_f16 = warp_reduce_sum_f16_f16<WARP_SIZE>(sum_f16);
  // warp leaders store the data to shared memory.
  // use float to keep sum from each block and reduce
  // with fp16 inter warps.
  if (lane == 0)
    reduce_smem[warp] = sum_f16;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  half sum = (lane < NUM_WARPS) ? reduce_smem[lane] : __float2half(0.0f);
  if (warp == 0)
    sum = warp_reduce_sum_f16_f16<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, __half2float(sum));
}

//  INT8
//
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ int32_t warp_reduce_sum_i8_i32(int8_t val) {
  int32_t val_i32 = static_cast<int32_t>(val);
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val_i32 += __shfl_xor_sync(0xffffffff, val_i32, mask);
  }
  return val_i32;
}

template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ int32_t warp_reduce_sum_i32_i32(int32_t val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_i8_i32_kernel(int8_t *a, int32_t *y,
                                                   int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ int32_t reduce_smem[NUM_WARPS];

  // keep the data in register is enough for warp operaion.
  int8_t sum_i8 = (idx < N) ? a[idx] : 0;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  int32_t sum_i32 = warp_reduce_sum_i8_i32<WARP_SIZE>(sum_i8);
  if (lane == 0)
    reduce_smem[warp] = sum_i32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  int32_t sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0;
  if (warp == 0)
    sum = warp_reduce_sum_i32_i32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

template <const int NUM_THREADS = 256 / 16>
__global__ void block_all_reduce_sum_i8x16_pack_i32_kernel(int8_t *a,
                                                           int32_t *y, int N) {
  int tid = threadIdx.x;
  int idx = (blockIdx.x * NUM_THREADS + tid) * 16;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ int32_t reduce_smem[NUM_WARPS];
  int8_t pack_a[16]; // 16x8=128 bits
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits

  // keep the data in register is enough for warp operaion.
  int32_t sum_i32 = 0;
#pragma unroll
  for (int i = 0; i < 16; ++i) {
    sum_i32 += (static_cast<int32_t>(pack_a[i]));
  }

  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  // perform warp sync reduce.
  sum_i32 = warp_reduce_sum_i32_i32<WARP_SIZE>(sum_i32);
  if (lane == 0)
    reduce_smem[warp] = sum_i32;
  __syncthreads(); // make sure the data is in shared memory.
  // the first warp compute the final sum.
  int32_t sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0;
  if (warp == 0)
    sum = warp_reduce_sum_i32_i32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define LANUCH_REDUCE_KERNEL(NT, packed_type, acc_type, element_type,          \
                             out_type)                                         \
  block_all_reduce_sum_##packed_type##_##acc_type##_kernel<(NT)>               \
      <<<grid, block>>>(reinterpret_cast<element_type *>(x.data_ptr()),        \
                        reinterpret_cast<out_type *>(y.data_ptr()), N);

#define DISPATCH_REDUCE_KERNEL(K, packed_type, acc_type, element_type,         \
                               n_elements, out_type)                           \
  const int NT = (K) / (n_elements);                                           \
  dim3 block(NT);                                                              \
  dim3 grid((S));                                                              \
  switch (NT) {                                                                \
  case 32:                                                                     \
    LANUCH_REDUCE_KERNEL(32, packed_type, acc_type, element_type, out_type)    \
    break;                                                                     \
  case 64:                                                                     \
    LANUCH_REDUCE_KERNEL(64, packed_type, acc_type, element_type, out_type)    \
    break;                                                                     \
  case 128:                                                                    \
    LANUCH_REDUCE_KERNEL(128, packed_type, acc_type, element_type, out_type)   \
    break;                                                                     \
  case 256:                                                                    \
    LANUCH_REDUCE_KERNEL(256, packed_type, acc_type, element_type, out_type)   \
    break;                                                                     \
  case 512:                                                                    \
    LANUCH_REDUCE_KERNEL(512, packed_type, acc_type, element_type, out_type)   \
    break;                                                                     \
  case 1024:                                                                   \
    LANUCH_REDUCE_KERNEL(1024, packed_type, acc_type, element_type, out_type)  \
    break;                                                                     \
  default:                                                                     \
    throw std::runtime_error(                                                  \
        "only support (K)/(n_elements): 32/64/128/256/512/1024");              \
    break;                                                                     \
  }

#define TORCH_BINDING_REDUCE(packed_type, acc_type, th_type, element_type,     \
                             n_elements, out_type)                             \
  torch::Tensor block_all_reduce_sum_##packed_type##_##acc_type(               \
      torch::Tensor x) {                                                       \
    CHECK_TORCH_TENSOR_DTYPE(x, (th_type))                                     \
    auto y_th_type =                                                           \
        (th_type) == torch::kInt8 ? torch::kInt32 : torch::kFloat32;           \
    auto options =                                                             \
        torch::TensorOptions().dtype(y_th_type).device(torch::kCUDA, 0);       \
    auto y = torch::zeros({1}, options);                                       \
    const int ndim = x.dim();                                                  \
    if (ndim != 2) {                                                           \
      int N = 1;                                                               \
      for (int i = 0; i < ndim; ++i) {                                         \
        N *= x.size(i);                                                        \
      }                                                                        \
      dim3 block(1024 / (n_elements));                                         \
      dim3 grid((N + 1024 - 1) / 1024);                                        \
      block_all_reduce_sum_##packed_type##_##acc_type##_kernel<1024 /          \
                                                               (n_elements)>   \
          <<<grid, block>>>(reinterpret_cast<element_type *>(x.data_ptr()),    \
                            reinterpret_cast<out_type *>(y.data_ptr()), N);    \
    } else {                                                                   \
      const int S = x.size(0);                                                                 \
      const int K = x.size(1);                                                                 \
      const int N = S * K;                                                                     \
      if ((K / (n_elements)) <= 1024) {                                        \
        DISPATCH_REDUCE_KERNEL(K, packed_type, acc_type, element_type,         \
                               n_elements, out_type)                           \
      } else {                                                                 \
        int N = 1;                                                             \
        for (int i = 0; i < ndim; ++i) {                                       \
          N *= x.size(i);                                                      \
        }                                                                      \
        dim3 block(1024 / (n_elements));                                       \
        dim3 grid((N + 1024 - 1) / 1024);                                      \
        block_all_reduce_sum_##packed_type##_##acc_type##_kernel<1024 /        \
                                                                 (n_elements)> \
            <<<grid, block>>>(reinterpret_cast<element_type *>(x.data_ptr()),  \
                              reinterpret_cast<out_type *>(y.data_ptr()), N);  \
      }                                                                        \
    }                                                                          \
    return y;                                                                  \
  }

// packed_type, acc_type, th_type, element_type, n_elements_per_pack, out_type
TORCH_BINDING_REDUCE(f32, f32, torch::kFloat32, float, 1, float)
TORCH_BINDING_REDUCE(f32x4, f32, torch::kFloat32, float, 4, float)
TORCH_BINDING_REDUCE(f16, f16, torch::kHalf, half, 1, float)
TORCH_BINDING_REDUCE(f16, f32, torch::kHalf, half, 1, float)
TORCH_BINDING_REDUCE(f16x2, f16, torch::kHalf, half, 2, float)
TORCH_BINDING_REDUCE(f16x2, f32, torch::kHalf, half, 2, float)
TORCH_BINDING_REDUCE(f16x8_pack, f16, torch::kHalf, half, 8, float)
TORCH_BINDING_REDUCE(f16x8_pack, f32, torch::kHalf, half, 8, float)
TORCH_BINDING_REDUCE(bf16, bf16, torch::kBFloat16, __nv_bfloat16, 1, float)
TORCH_BINDING_REDUCE(bf16, f32, torch::kBFloat16, __nv_bfloat16, 1, float)
TORCH_BINDING_REDUCE(bf16x2, bf16, torch::kBFloat16, __nv_bfloat16, 2, float)
TORCH_BINDING_REDUCE(bf16x2, f32, torch::kBFloat16, __nv_bfloat16, 2, float)
TORCH_BINDING_REDUCE(bf16x8_pack, bf16, torch::kBFloat16, __nv_bfloat16, 8,
                     float)
TORCH_BINDING_REDUCE(bf16x8_pack, f32, torch::kBFloat16, __nv_bfloat16, 8,
                     float)
TORCH_BINDING_REDUCE(fp8_e4m3, f16, torch::kFloat8_e4m3fn, __nv_fp8_storage_t,
                     1, float)
TORCH_BINDING_REDUCE(fp8_e4m3x16_pack, f16, torch::kFloat8_e4m3fn,
                     __nv_fp8_storage_t, 16, float)
TORCH_BINDING_REDUCE(fp8_e5m2, f16, torch::kFloat8_e5m2, __nv_fp8_storage_t, 1,
                     float)
TORCH_BINDING_REDUCE(fp8_e5m2x16_pack, f16, torch::kFloat8_e5m2,
                     __nv_fp8_storage_t, 16, float)
TORCH_BINDING_REDUCE(i8, i32, torch::kInt8, int8_t, 1, int32_t)
TORCH_BINDING_REDUCE(i8x16_pack, i32, torch::kInt8, int8_t, 16, int32_t)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f32_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f32x4_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16x2_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16x2_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16x8_pack_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_f16x8_pack_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16_bf16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16x2_bf16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16x2_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16x8_pack_bf16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_bf16x8_pack_f32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_fp8_e4m3_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_fp8_e4m3x16_pack_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_fp8_e5m2_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_fp8_e5m2x16_pack_f16)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_i8_i32)
  TORCH_BINDING_COMMON_EXTENSION(block_all_reduce_sum_i8x16_pack_i32)
}
```

</details>

### `block_all_reduce.py`
<details>
<summary> block_all_reduce.py </summary>

```python
import time

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="block_all_reduce_lib",
    sources=["block_all_reduce.cu"],
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
    values: torch.Tensor,
    tag: str,
    warmup: int = 10,
    iters: int = 1000,
):
    # if perf_func.__name__ == torch.sum.__name__:
    #     values = values.float() # for precision
    for i in range(warmup):
        out = perf_func(values)  # warmup
    torch.cuda.synchronize()
    start = time.time()
    for i in range(iters):
        out = perf_func(values)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.item()
    if tag.startswith("i8"):
        print(f"{out_info:>25}: {out_val:<15}, time:{mean_time:.8f}ms")
    else:
        print(f"{out_info:>25}: {out_val:<15.8f}, time:{mean_time:.8f}ms")
    return out, mean_time


Ss = [1024, 2048, 4096]
Ks = [1024, 2048, 4096]
SKs = [(S, K) for S in Ss for K in Ks]

for S, K in SKs:
    print("-" * 80)
    print(" " * 40 + f"S={S}, K={K}")
    values = torch.randn((S, K)).cuda().float()
    run_benchmark(lib.block_all_reduce_sum_f32_f32, values, "f32f32")
    run_benchmark(lib.block_all_reduce_sum_f32x4_f32, values, "f32x4f32")
    run_benchmark(torch.sum, values, "f32f32_th")

    print("-" * 80)
    values_half = values.half()
    run_benchmark(lib.block_all_reduce_sum_f16_f16, values_half, "f16f16")
    run_benchmark(lib.block_all_reduce_sum_f16_f32, values_half, "f16f32")
    run_benchmark(lib.block_all_reduce_sum_f16x2_f32, values_half, "f16x2f32")
    run_benchmark(lib.block_all_reduce_sum_f16x2_f16, values_half, "f16x2f16")
    run_benchmark(
        lib.block_all_reduce_sum_f16x8_pack_f16, values_half, "f16x8packf16"
    )
    run_benchmark(
        lib.block_all_reduce_sum_f16x8_pack_f32, values_half, "f16x8packf32"
    )
    run_benchmark(torch.sum, values_half, "f16f16_th")

    print("-" * 80)
    values_bf16 = values.bfloat16()
    run_benchmark(lib.block_all_reduce_sum_bf16_bf16, values_bf16, "bf16bf16")
    run_benchmark(lib.block_all_reduce_sum_bf16_f32, values_bf16, "bf16f32")
    run_benchmark(lib.block_all_reduce_sum_bf16x2_f32, values_bf16, "bf16x2f32")
    run_benchmark(
        lib.block_all_reduce_sum_bf16x2_bf16, values_bf16, "bf16x2bf16"
    )
    run_benchmark(
        lib.block_all_reduce_sum_bf16x8_pack_f32, values_bf16, "bf16x8packf32"
    )
    run_benchmark(
        lib.block_all_reduce_sum_bf16x8_pack_bf16, values_bf16, "bf16x8packbf16"
    )
    run_benchmark(torch.sum, values_bf16, "bf16bf16_th")

    print("-" * 80)
    values_f8e4m3 = values.to(dtype=torch.float8_e4m3fn)
    run_benchmark(
        lib.block_all_reduce_sum_fp8_e4m3_f16, values_f8e4m3, "f8e4m3f16"
    )
    run_benchmark(
        lib.block_all_reduce_sum_fp8_e4m3x16_pack_f16,
        values_f8e4m3,
        "f8e4m3x16packf16",
    )
    run_benchmark(
        torch.sum, values_f8e4m3.half(), "f8e4m3f16_th"
    )  # torch.sum not support fp8

    print("-" * 80)
    values_f8e5m2 = values.to(dtype=torch.float8_e5m2)
    run_benchmark(
        lib.block_all_reduce_sum_fp8_e5m2_f16, values_f8e5m2, "f8e5m2f16"
    )
    run_benchmark(
        lib.block_all_reduce_sum_fp8_e5m2x16_pack_f16,
        values_f8e5m2,
        "f8e5m2x16packf16",
    )
    run_benchmark(
        torch.sum, values_f8e5m2.half(), "f8e5m2f16_th"
    )  # torch.sum not support fp8

    print("-" * 80)
    values_i8 = values.to(dtype=torch.int8)
    run_benchmark(lib.block_all_reduce_sum_i8_i32, values_i8, "i8i32")
    run_benchmark(
        lib.block_all_reduce_sum_i8x16_pack_i32, values_i8, "i8x16packi32"
    )
    run_benchmark(torch.sum, values_i8, "i8i32_th")
    print("-" * 80)
```

</details>

## 逐段代码剖析/学习

```c++
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_f32(float val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}
```

本篇最核心的 10 行。逐个拆：

- `__shfl_xor_sync(mask, var, lane_mask)`：**warp shuffle**，让同一 warp 内的 32 个线程直接交换寄存器值，不走 shared memory。`var` 是要交换的值，`lane_mask` 决定跟谁换。**这是 warp 内线程通信的唯一低成本方式**。
- `xor`：跟"自己 lane 号 ^ lane_mask"的线程交换。比如 `lane_mask=16`，lane 0 ↔ lane 16，lane 1 ↔ lane 17……
- `0xffffffff`：全 32 位 mask，要求 warp 内 32 个线程**全部**到齐才能 shuffle（这也是为什么 NUM_THREADS 必须凑满 warp——残缺 warp 会挂起）。
- 循环 5 轮（mask = 16, 8, 4, 2, 1），**蝴蝶（butterfly）归约**，log₂32 = 5 步完成 32 个数的求和：

```
轮次 mask=16:  lane[i] += lane[i^16]   32个数 → 16个数（每对加起来）
轮次 mask=8 :  lane[i] += lane[i^8]    16个数 → 8个数
轮次 mask=4 :  lane[i] += lane[i^4]    8个数 → 4个数
轮次 mask=2 :  lane[i] += lane[i^2]    4个数 → 2个数
轮次 mask=1 :  lane[i] += lane[i^1]    2个数 → 1个数
最终所有 lane 都拿到总和（不只是 lane 0）
```

- `kWarpSize` 是模板参数而不是写死 32：后面第二阶段要用**更小的 warp_size**（如 8 个 warp 的 reduce 用 `kWarpSize=8`），同一份代码复用。
- `__forceinline__`：强制内联，reduce 这种小函数不内联的话函数调用开销比函数体还大。

---

```c++
template <const int NUM_THREADS = 256>
__global__ void block_all_reduce_sum_f32_f32_kernel(float *a, float *y, int N) {
  int tid = threadIdx.x;
  int idx = blockIdx.x * NUM_THREADS + tid;
  constexpr int NUM_WARPS = (NUM_THREADS + WARP_SIZE - 1) / WARP_SIZE;
  __shared__ float reduce_smem[NUM_WARPS];
  float sum = (idx < N) ? a[idx] : 0.0f;
  int warp = tid / WARP_SIZE;
  int lane = tid % WARP_SIZE;
  sum = warp_reduce_sum_f32<WARP_SIZE>(sum);
  if (lane == 0)
    reduce_smem[warp] = sum;
  __syncthreads();
  sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;
  if (warp == 0)
    sum = warp_reduce_sum_f32<NUM_WARPS>(sum);
  if (tid == 0)
    atomicAdd(y, sum);
}
```

**两阶段 block reduce** 的标准骨架（warp 内 shuffle → 跨 warp shared memory → 首个 warp 再 shuffle）：

- `warp = tid / 32`、`lane = tid % 32`：block 256 线程切成 8 个 warp，warp 是"block 内的 32 人小组"，lane 是"组内编号"。
- **阶段 1（warp 内）**：`warp_reduce_sum_f32<WARP_SIZE>(sum)`，每个 warp 32 个数变成 1 个数。**全程寄存器，零 shared memory 访问，零同步开销**——这就是 shuffle 的价值。
- `if (lane == 0) reduce_smem[warp] = sum;`：每个 warp 的组长（lane 0）把该 warp 的部分和写进 shared memory。只有 8 个 warp，所以 `reduce_smem` 只要 8 个 float。
- `__syncthreads()`：**block 级栅栏**，等所有 warp 都写完 shared memory 才能往下读。第一次在本系列见到：elementwise 各线程互不相干不需要同步，reduce 必须同步。注意 `__syncthreads` 只同步**本 block 内**线程，跨 block 要靠别的手段（下面 atomicAdd）。
- **阶段 2（跨 warp）**：`sum = (lane < NUM_WARPS) ? reduce_smem[lane] : 0.0f;`——把 8 个 warp 的部分和搬回 warp 0 的前 8 个 lane，再用一次 `warp_reduce_sum_f32<NUM_WARPS>`（注意模板参数是 **8** 不是 32！8 个数 3 轮 shuffle 就归约完）。
  - 这一步**只有 warp 0 干活**（`if (warp == 0)`），其余 7 个 warp 的线程空等。这是标准做法，损失可以接受。
  - `lane < NUM_WARPS ? ... : 0.0f`：warp 0 有 32 个 lane 但只有 8 个有效数据，多的填 0（加 0 不影响和）。
- `if (tid == 0) atomicAdd(y, sum);`：每个 block 算出自己的部分和后，用**原子加**累加到全局的 `y`。因为有很多 block 并发跑，它们同时写 `y` 会互相覆盖，`atomicAdd` 保证加法是原子的。**这是 block 间的通信方式**（block 之间没有 shuffle，也没有共享的 shared memory，只能靠 global memory + 原子操作）。
  - 代价：atomicAdd 是串行化的，多个 block 同时原子加会排队。所以**先在 block 内归约到位、每个 block 只发一次 atomicAdd**，而不是每个线程都 atomicAdd——256 次→1 次。
- 命名 `f32_f32`：输入 f32、累加器 f32。后面 `f16_f32` 就是输入 f16、累加器升 f32。

**整体数据流**（block=256, N=任意）：

```
每线程1个数 → (warp shuffle, 5轮) → 8个warp各1个部分和
            → (写smem + __syncthreads) → warp0的8个lane
            → (8路shuffle, 3轮) → block总和
            → atomicAdd 到全局 y
```

---

```c++
template <const int NUM_THREADS = 256 / 4>
__global__ void block_all_reduce_sum_f32x4_f32_kernel(float *a, float *y,
                                                      int N) {
  int idx = (blockIdx.x * NUM_THREADS + tid) * 4;
  float4 reg_a = FLOAT4(a[idx]);
  float sum = (idx < N) ? (reg_a.x + reg_a.y + reg_a.z + reg_a.w) : 0.0f;
  // ... 后面两阶段 reduce 与上面完全相同
```

- f32x4 版本：每线程先 `FLOAT4` 向量化读 4 个数、**在寄存器里先加成 1 个数**，再进 reduce。向量化 load（02 讲过）+ reduce 组合：线程数从 256 降到 64，但每个线程带 4 个数据进来。
- **关键理解：reduce 前先"线程内归并"**。每个线程管的数据越多（x4/x8/x16 pack），进入 shuffle 阶段的数据越少，reduce 轮数和同步开销不变但吞吐越高——这就是为什么 benchmark 里 pack 版本显著更快。
- 注意这个 kernel 的尾部分支**没有逐元素 fallback**：`(idx < N) ? ... : 0.0f` 只是整组丢弃，读到越界垃圾也会被 `idx < N` 挡掉。reduce 是"多加一个 0 无所谓"的运算，所以边界处理比 elementwise 宽松得多（elementwise 是每个输出都不能错，reduce 只要和不错）。

---

```c++
//  FP16: 两种 acc 策略
__device__ half warp_reduce_sum_f16_f16(half val) { ... __hadd ... }        // 半精度累加
__device__ float warp_reduce_sum_f16_f32(half val) { 先转f32，float累加 }    // 全精度累加
```

- `f16_f16`：加载 half、`__hadd` 半精度加。**快但精度崩**：f16 只有 10 位尾数（有效数字 ~3 位十进制），32 个数连加误差快速累积。
- `f16_f32`：加载 half 后**立刻转 float** 再累加。这就是**混合精度（mixed precision）**的精髓：**存储用低精度（省带宽），计算/累加用高精度（保精度）**。LLM kernel 的标准套路（softmax 的 exp 累加、layer-norm 的均值方差、GEMM 的 MMA 累加全是 f32 acc）。
- 对比 benchmark 实测（S=1024, K=1024, 真值 ≈ 565.67）：

| 版本 | 结果 | 误差 |
|---|---|---|
| f16_f16 | 565.835 | ~0.17 |
| f16_f32 | 565.809 | ~0.14 |
| f16x8pack_f32 | 565.808 | ~0.14 |
| torch (f16 acc) | 566.0 | ~0.33 |

  可以看到同精度下 f32 acc 误差更小。但这里 N 才 100 万级，f16 acc 的误差尚可；数据量再大或方差再大，f16 acc 会明显漂移。

---

```c++
// FP8: e4m3 / e5m2 两种格式，先转 half 再 reduce
half val_f16 = __nv_cvt_fp8_to_halfraw(val, __NV_E4M3);
```

- FP8 没有硬件加法指令，**必须先转成 half 再算**。`E4M3`（4位指数3位尾数，精度优先）和 `E5M2`（5位指数2位尾数，动态范围优先）是两种 FP8 格式，转换时用 `__nv_cvt_fp8_to_halfraw` 指明格式。
- FP8 一字节一个，所以 pack 到 128bit 需要 **16 个元素**（`x16_pack`），比 f16 的 x8_pack 数量翻倍。
- INT8 同理：`int8_t` 转 `int32_t` 再加，i8 也无硬件加法（且 int8 加法极易溢出，必须升位）。

---

```c++
#define TORCH_BINDING_REDUCE(packed_type, acc_type, ...) \
  torch::Tensor block_all_reduce_sum_##packed_type##_##acc_type(torch::Tensor x) { \
    ... \
    if (ndim != 2) { 一维摊平 } \
    else { \
      if ((K / n_elements) <= 1024) { \
        DISPATCH_REDUCE_KERNEL(...)   /* 每行一个block, NT=K/n_elements */ \
      } else { 一维摊平 } \
    } \
  }
```

host 侧 dispatch 的切块策略（宏展开生成 20 个绑定函数）：

- **2D 且一行能被一个 block 覆盖**（`K/n_elements ≤ 1024`）：**一行一个 block**，`block(NT)`, `grid(S)`。这样每个 block 的 reduce 结果直接就是一行的和，一次 atomicAdd 完事。NT（每 block 线程数）从 K 算出来，switch 到编译期常量实例化模板——和 elementwise 的 dispatch 思路一样，但这里多一层：**模板 NUM_THREADS 必须是 2 的幂**（32/64/128/256/512/1024），因为两阶段 shuffle 的 mask 是 2 的幂次递减，非 2 幂线程数会让第二阶段 `warp_reduce<NUM_WARPS>` 的部分 lane 拿不到正确数据。
- **1D 或行太长**：整体摊平成 1D，固定 `block(1024/n_elements)`、grid = ceil(N/1024)，所有 block 各自 reduce 后 atomicAdd 汇总。**牺牲行边界换满 block**——reduce 求和对切法不敏感（加法交换律），这是 reduce 特有的自由度（softmax/layernorm 就没这个自由，后面会看到它们必须保行边界）。

## 实测数据（4090, S=1024, K=1024）

| kernel | 结果 | 耗时 |
|---|---|---|
| f32_f32 | 565.66943359 | 0.00837ms |
| f32x4_f32 | 565.66851807 | 0.00843ms |
| torch.sum(f32) | 565.66979980 | 0.01000ms |
| f16_f16 | 565.83532715 | 0.00844ms |
| f16_f32 | 565.80932617 | 0.00823ms |
| f16x8pack_f16 | 565.57714844 | 0.00837ms |
| f16x8pack_f32 | 565.80841064 | 0.00836ms |
| torch.sum(f16) | 566.0 | 0.00967ms |

- 全部比 torch.sum 快（torch 要走通用 dispatch + 泛型逻辑）。
- K=1024 时各版本差距不大（每个 block 只有 1024 个数，reduce 部分占比小，瓶颈在 load）。**K 变大后向量化优势拉大**：K=4096 时标量版 f32_f32 = 0.0211ms，而 f32x4 = 0.0088ms（2.4x）——数据量越大，"线程内先归并 + 向量化 load"省下的访存轮次越多。
- i8 系列对照 torch 快近 2 倍（0.0082 vs 0.0158ms）。

## 本篇小结

1. **warp shuffle**（`__shfl_xor_sync`）：warp 内 32 线程的寄存器直通交换，蝴蝶 5 轮归约，全寄存器零访存。
2. **两阶段 block reduce**：warp 内 shuffle（免同步）→ lane 0 写 smem → `__syncthreads` → warp 0 再 shuffle（模板参数复用，`kWarpSize=NUM_WARPS`）。
3. **`__syncthreads`**：block 级栅栏，第一个出现的同步原语；只管本 block。
4. **`atomicAdd`**：block 间通信唯一手段（无 shuffle、无共享 smem），先 block 内归约到位再原子加，摊薄原子操作次数。
5. **acc dtype 混合精度**：存储低精度（省带宽）+ 累加高精度（保精度），`f16_f32` 命名法。
6. **reduce 的边界自由度**：多加 0 不影响和，所以尾处理比 elementwise 宽松；1D 摊平也合法（加法交换律）。
7. **模板 NUM_THREADS 必须 2 的幂**：shuffle 的 mask 减半结构决定的硬约束。

下一篇 softmax 直接把本篇的两阶段 reduce 当积木用（求 max、求 exp 和），再叠加"一行一个 block"的 per-token 映射。
