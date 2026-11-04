---
title: SGEMM (FP32 GEMM)
order: 15
---

# SGEMM CUDA代码学习

> 本人学习笔记，AI总结

GEMM（矩阵乘 `C = A×B`）是深度学习的"印钞机"——全连接、注意力、卷积（im2col 之后）全是它。本篇开始进入第二阶段，是前面所有知识点的**总装**：09 的 smem/bank conflict、03 的归约思想、02 的向量化，在这里全部要同时用上。

先看这一篇要打的擂台（RTX 4090，M=N=8192, K=4096，F32）：

| 版本 | TFLOPS | 相对基线 |
|---|---|---|
| f32x4 基础分块版 (t8x8sk) | 36.6 | 1.00x |
| + smem padding 消 bank conflict (bcf) | 39.6 | 1.08x |
| + double buffer (dbuf) | 41.9 | 1.14x |
| cuBLAS (F32) | 48.7~51.2 | ~1.35x |
| **WMMA TF32 Tensor Core 版** | **59.4** | **1.62x** |
| WMMA + swizzle | **60.0** | **1.64x** |
| cuBLAS TF32 | 74.3 | 2.03x |

4090 的 FP32 理论峰值 82.6 TFLOPS、TF32 Tensor Core 峰值 ~82.6（开稠密）——手写最优版打到峰值的 50~73%，而起点只有 44%。这一篇走完从 36.6 到 60.0 的每一步，以及为什么最后一步（Tensor Core）是断崖而不是渐进。

## 完整代码

### `sgemm.cu`（naive → sliced-K → t8x8sk → bcf → dbuf 五连）
<details>
<summary> sgemm.cu </summary>

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

// modified from: https://zhuanlan.zhihu.com/p/657632577
// FP32
// SGEMM naive: compute one c[i,j]
// element per threads, all row major
__global__ void sgemm_naive_f32_kernel(float *a, float *b, float *c, int M,
                                       int N, int K) {
  int n = blockIdx.x * blockDim.x + threadIdx.x;
  int m = blockIdx.y * blockDim.y + threadIdx.y;

  if (m < M && n < N) {
    float psum = 0.0;
#pragma unroll
    for (int k = 0; k < K; k++) {
      // m row in a matrix, n col in b matrix
      psum += a[m * K + k] * b[k * N + n];
    }
    c[m * N + n] = psum; // c[m,n]
  }
}

// SGEMM: Block Tile + K Tile, with smem
// Block Tile (BM, BN) + K Tile (BK=32)
// grid((N + BN - 1) / BN, (M + BM - 1) / BM), block(BN, BM)
// a: MxK, b: KxN, c: MxN, compute: c = a * b, all row major
template <const int BM = 32, const int BN = 32, const int BK = 32>
__global__ void sgemm_sliced_k_f32_kernel(float *a, float *b, float *c, int M,
                                          int N, int K) {
  // [1] Block Tile: 32x32的block处理c上一块32x32的元素计算
  // [2]     K Tile: 使用共享内存，并将K分块为BK大小的块
  __shared__ float s_a[BM][BK], s_b[BK][BN];

  int bx = blockIdx.x;
  int by = blockIdx.y;
  int tx = threadIdx.x;
  int ty = threadIdx.y;
  int tid = threadIdx.y * blockDim.x + tx; // tid within the block
  // load values to shared memory, 32x32 threads working together
  // to fetch data along the row direction of a and b both for s_a
  // and s_b 32x32x4x2=8KB, we use 32x32 threads within block to
  // load 32x32 elements from global memory to shared memory, namely,
  // each thread will load 1 element.
  int load_smem_a_m = tid / 32; // 0~31, tid / 32, tid / BM, threadIdx.y
  int load_smem_a_k = tid % 32; // 0~31, tid % 32, tid % BK, threadIdx.x
  int load_smem_b_k = tid / 32; // 0~31, tid / 32, tid / BK, threadIdx.y
  int load_smem_b_n = tid % 32; // 0~31, tid % 32, tid % BN, threadIdx.x
  int load_gmem_a_m = by * BM + load_smem_a_m; // global row of a and c
  int load_gmem_b_n = bx * BN + load_smem_b_n; // global col of b and c
  // if (load_gmem_a_m >= M || load_gmem_b_n >= N) return;

  float sum = 0.f;
  for (int bk = 0; bk < (K + BK - 1) / BK; ++bk) {
    int load_gmem_a_k = bk * BK + load_smem_a_k;
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    s_a[load_smem_a_m][load_smem_a_k] = a[load_gmem_a_addr];
    int load_gmem_b_k = bk * BK + load_smem_b_k;
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;
    s_b[load_smem_b_k][load_smem_b_n] = b[load_gmem_b_addr];
    __syncthreads();
#pragma unroll
    for (int k = 0; k < BK; ++k) {
      int comp_smem_a_m = load_smem_a_m;
      int comp_smem_b_n = load_smem_b_n;
      sum += s_a[comp_smem_a_m][k] * s_b[k][comp_smem_b_n];
    }
    __syncthreads();
  }
  int store_gmem_c_m = load_gmem_a_m;
  int store_gmem_c_n = load_gmem_b_n;
  int store_gmem_c_addr = store_gmem_c_m * N + store_gmem_c_n;
  c[store_gmem_c_addr] = sum;
}

// SGEMM: Block Tile + Thread Tile + K Tile + Vec4, with smem
// BK:TILE_K=8 BM=BN=128
// TM=TN=8 增加计算密度 BM/TM=16 BN/TN=16
// dim3 blockDim(BN/TN, BM/TM);
// dim3 gridDim((N + BN - 1) / BN, (M + BM - 1) / BM)
template <const int BM = 128, const int BN = 128, const int BK = 8,
          const int TM = 8, const int TN = 8>
__global__ void sgemm_t_8x8_sliced_k_f32x4_kernel(float *a, float *b, float *c,
                                                  int M, int N, int K) {
  // [1]  Block Tile: 一个16x16的block处理C上大小为128X128的一个目标块
  // [2] Thread Tile: 每个thread负责计算TM*TN(8*8)个元素，增加计算密度
  // [3]      K Tile: 将K分块，每块BK大小，迭代(K+BK-1/BK)次，
  //                  每次计算TM*TN个元素各自的部分乘累加
  // [4]   Vectorize: 减少load和store指令，使用float4

  int bx = blockIdx.x;
  int by = blockIdx.y;
  int tx = threadIdx.x;
  int ty = threadIdx.y;
  int tid = threadIdx.y * blockDim.x + tx;   // tid within the block
  __shared__ float s_a[BM][BK], s_b[BK][BN]; // 2*128*8*4=8KB

  // 0. 先计算shared memory中的索引
  // tid和需要加载的smem s_a[BM][BK] 之间的索引关系 BM=128 BK=8 按行读取 A行主序
  // 对于s_a每行8个数据，每个线程读取4个，需要2个线程；总共128行，需要128x2刚好256线程
  int load_smem_a_m = tid / 2; // tid/2 (128/8)*(128/8)=256 threads per block,
                               // tid/2->[0,128), BM=128 0~127
  int load_smem_a_k =
      (tid % 2 == 0) ? 0 : 4; // (tid%2 == 0) ? 0 : 4, col of s_a 0,4
  // tid和需要加载的smem s_b[BK][BN] 之间的索引关系 BK=8 BN=128 按行读取 B行主序
  // 对于s_b每行128个数据，每个线程读4个数据，需要32个线程；总共8行，需要32x8=256个线程
  int load_smem_b_k = tid / 32;       // tid/32, row of s_b 256/32=8 行 0~7
  int load_smem_b_n = (tid % 32) * 4; // (tid % 32) * 4, col of s_b 0,4,...,124
  // 1. 再计算全局内存中的索引
  // 要加载到s_a中的元素对应到A全局内存中的行数
  // 每个block负责出C中大小为BM*BN的块
  int load_gmem_a_m = by * BM + load_smem_a_m; // global row of a and c
  int load_gmem_b_n = bx * BN + load_smem_b_n; // global col of b and c

  float r_c[TM][TN] = {0.0}; // 8x8
  // 2. 先对K进行分块，每块BK大小
  for (int bk = 0; bk < (K + BK - 1) / BK; ++bk) {
    // 加载数据到共享内存smem s_a BM*BK 128*8 vectorize float4
    int load_gmem_a_k = bk * BK + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    FLOAT4(s_a[load_smem_a_m][load_smem_a_k]) = FLOAT4(a[load_gmem_a_addr]);
    // 加载数据到共享内存smem s_b BK*BN 8*128 vectorize float4
    int load_gmem_b_k = bk * BK + load_smem_b_k; // global row of b
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;
    FLOAT4(s_b[load_smem_b_k][load_smem_b_n]) = FLOAT4(b[load_gmem_b_addr]);
    __syncthreads();
#pragma unroll
    for (int k = 0; k < BK; k++) {
// 3. 每个线程负责计算BM*BN(12x128)中的TM*TN(8x8)个元素
#pragma unroll
      for (int m = 0; m < TM; m++) {
#pragma unroll
        for (int n = 0; n < TN; n++) {
          // k from 0~7，0 ~ BK, ty and tx range from 0 to 15, 16x8=128
          int comp_smem_a_m = ty * TM + m; // 128*8 128/TM(8)=16 M方向 16线程
          int comp_smem_b_n = tx * TN + n; // 8*128 128/TN(8)=16 N方向 16线程
          r_c[m][n] += s_a[comp_smem_a_m][k] * s_b[k][comp_smem_b_n];
        }
      }
    }
    __syncthreads();
  }

#pragma unroll
  for (int m = 0; m < TM; ++m) {
    int store_gmem_c_m = by * BM + ty * TM + m;
#pragma unroll
    for (int n = 0; n < TN; n += 4) {
      int store_gmem_c_n = bx * BN + tx * TN + n;
      int store_gmem_c_addr = store_gmem_c_m * N + store_gmem_c_n;
      FLOAT4(c[store_gmem_c_addr]) = FLOAT4(r_c[m][n]);
    }
  }
}

template <const int BM = 128, const int BN = 128, const int BK = 8,
          const int TM = 8, const int TN = 8, const int OFFSET = 0>
__global__ void
sgemm_t_8x8_sliced_k_f32x4_bcf_kernel(float *a, float *b, float *c, const int M,
                                      const int N, const int K) {
  const int bx = blockIdx.x;
  const int by = blockIdx.y;
  const int tx = threadIdx.x;
  const int ty = threadIdx.y;
  const int tid = ty * blockDim.x + tx;

  __shared__ float s_a[BK][BM + OFFSET];
  __shared__ float s_b[BK][BN + OFFSET];
  // __shared__ float s_a[BK][BM + 4];
  // __shared__ float s_b[BK][BN + 4];

  float r_load_a[TM / 2]; // 4
  float r_load_b[TN / 2]; // 4
  float r_comp_a[TM];
  float r_comp_b[TN];
  float r_c[TM][TN] = {0.0};

  // mapping tid to s_a[BK][BM], for each orginal m-th row, load 4 + 4 K-dim
  // row major values from A matrix, and store it in COL major s_a[BK][BM].
  int load_a_smem_m = tid / 2; // tid / 2，(0,1,2,...,128)
  // (0b00000000 & 0b00000001) << 2 = 0
  // (0b00000001 & 0b00000001) << 2 = 4
  // (0b00000010 & 0b00000001) << 2 = 0
  // (0b00000011 & 0b00000001) << 2 = 4
  int load_a_smem_k = (tid & 1) << 2; // (0,4)
  // mapping tid to s_b[BK][BN], for each orginal k-th row, load 4 + 4 N-dim
  // row major values from B matrix, and store it in ROW major s_b[BK][BN].
  int load_b_smem_k = tid / 32; // 0~8
  // (0b00000000 & 0b00011111) << 2 = 0
  // (0b00000001 & 0b00011111) << 2 = 4
  // (0b00000010 & 0b00011111) << 2 = 8
  // (0b00000011 & 0b00011111) << 2 = 12
  int load_b_smem_n = (tid & 31) << 2; // (0,4,8,12,...,124)

  int load_a_gmem_m = by * BM + load_a_smem_m;
  int load_b_gmem_n = bx * BN + load_b_smem_n;

  if (load_a_gmem_m >= M || load_b_gmem_n >= N)
    return;

  for (int bk = 0; bk < (K + BK - 1) / BK; bk++) {
    int load_a_gmem_k = bk * BK + load_a_smem_k;
    int load_a_gmem_addr = load_a_gmem_m * K + load_a_gmem_k;
    int load_b_gmem_k = bk * BK + load_b_smem_k;
    int load_b_gmem_addr = load_b_gmem_k * N + load_b_gmem_n;
    FLOAT4(r_load_a[0]) = FLOAT4(a[load_a_gmem_addr]);
    FLOAT4(r_load_b[0]) = FLOAT4(b[load_b_gmem_addr]);

    // 0. bank layout analysis: s_a[8][128]
    // 4 bytes per bank(32 banks, total 128 bytes, 32 float values),
    // 1 float per bank. smem banks layout for s_a[8][128]:
    // 8*(128/32)=32 bank layers, 4 layers per k-th row.
    // [k=0][m=  [0],   [1],   [2],...,    [31]]
    // layer_0   [b0],  [b1],  [b2],...,   [b31]
    // [k=0][m=  [32],  [33],  [34],...,   [63]]
    // layer_1   [b0],  [b1],  [b2],...,   [b31]
    // [k=0][m=  [64],  [65],  [66],...,   [95]]
    // layer_2   [b0],  [b1],  [b2],...,   [b31]
    // [k=0][m=  [96],  [97],  [98],...,   [127]]
    // layer_3   [b0],  [b1],  [b2],...,   [b31]
    // ...       ...               ...
    // [k=7][m=  [0],   [1],   [2],...,    [31]]
    // layer_28  [b0],  [b1],  [b2],...,   [b31]
    // [k=7][m=  [32],  [33],  [34],...,   [63]]
    // layer_29  [b0],  [b1],  [b2],...,   [b31]
    // [k=7][m=  [64],  [65],  [66],...,   [95]]
    // layer_30  [b0],  [b1],  [b2],...,   [b31]
    // [k=7][m=  [96],  [97],  [98],...,   [127]]
    // layer_31  [b0],  [b1],  [b2],...,   [b31]
    // 1. bank conficts analysis: s_a[8][128]
    // tid 0   -> m 0,   k 0 -> all access bank 0  (layer_0/4/8/12)
    // tid 1   -> m 0,   k 4 -> all access bank 0  (layer_16/20/24/28)
    // tid 2   -> m 1,   k 0 -> all access bank 1  (layer_0/4/8/12)
    // tid 3   -> m 1,   k 4 -> all access bank 1  (layer_16/20/24/28)
    // tid 4   -> m 2,   k 0 -> all access bank 2  (layer_0/4/8/12)
    // tid 5   -> m 2,   k 4 -> all access bank 2  (layer_16/20/24/28)
    // tid 6   -> m 3,   k 0 -> all access bank 3  (layer_0/4/8/12)
    // tid 7   -> m 3,   k 4 -> all access bank 3  (layer_16/20/24/28)
    // ...        ...           ...                ...
    // tid 28  -> m 14,  k 0 -> all access bank 14 (layer_0/4/8/12)
    // tid 29  -> m 14,  k 4 -> all access bank 14 (layer_16/20/24/28)
    // tid 30  -> m 15,  k 0 -> all access bank 15 (layer_0/2/4/6)
    // tid 31  -> m 15,  k 4 -> all access bank 15 (layer_16/20/24/28)
    // conclusion: we still have bank conflicts for smem_a write access,
    // each 2 consecutive threads within warp access the same bank!
    // thus, we still need 2 memory issues as least per warp.
    s_a[load_a_smem_k][load_a_smem_m] = r_load_a[0];     // e.g layer_0  b0
    s_a[load_a_smem_k + 1][load_a_smem_m] = r_load_a[1]; // e.g layer_4  b0
    s_a[load_a_smem_k + 2][load_a_smem_m] = r_load_a[2]; // e.g layer_8  b0
    s_a[load_a_smem_k + 3][load_a_smem_m] = r_load_a[3]; // e.g layer_12 b0
    // 2. bank layout analysis: s_b[8][128] same as s_a[8][128]
    // 3. bank conficts analysis: s_b[8][128]
    // tid 0   -> k 0, n 0   -> all access bank 0~3   (layer_0)
    // tid 1   -> k 0, n 4   -> all access bank 4~7   (layer_0)
    // tid 2   -> k 0, n 8   -> all access bank 7~11  (layer_0)
    // tid 7   -> k 0, n 28  -> all access bank 28~31 (layer_0)
    // tid 8   -> k 0, n 32  -> all access bank 0~3   (layer_1)
    // ...        ...         ...                 ...
    // tid 15  -> k 0, n 60  -> all access bank 28~31 (layer_1)
    // tid 16  -> k 0, n 64  -> all access bank 0~3   (layer_2)
    // ...        ...         ...                 ...
    // tid 31  -> k 0, n 124 -> all access bank 28~31 (layer_3)
    // conclusion: we still have bank conflicts within warp,
    // 0/8/16/24 -> bank 0~3, 1/9/17/25 -> bank 4~7, etc.
    // thus, we still need 4 memory issues at least per warp.
    FLOAT4(s_b[load_b_smem_k][load_b_smem_n]) = FLOAT4(r_load_b[0]);

    __syncthreads();

#pragma unroll
    for (int tk = 0; tk < BK; tk++) {
      // bank conflicts analysis, tx/ty 0~15, 0~7 bank 4*8=32 bytes
      // tid 0~15 access bank 0~3,  tid 16~31 access bank 4~7, etc.
      // tid 0,  tk 0 -> ty 0 -> [0][0+0~3],[0][64+0~3] -> bank 0~3(layer_0/2),
      // tid 0,  tk 7 -> ty 0 -> [7][0+0~3],[0][64+0~3] -> bank
      // 0~3(layer_28/30), tid 15, tk 0 -> ty 0 -> [0][0+0~3],[0][64+0~3] ->
      // bank 0~3(layer_0/2), tid 15, tk 7 -> ty 0 -> [7][0+0~3],[0][64+0~3] ->
      // bank 0~3(layer_28/30), tid 16, tk 0 -> ty 1 -> [0][0+4~7],[0][64+4~7]
      // -> bank 4~7(layer_0/2), tid 16, tk 7 -> ty 1 -> [7][0+4~7],[0][64+4~7]
      // -> bank 4~7(layer_28/30), tid 31, tk 0 -> ty 1 ->
      // [0][0+4~7],[0][64+4~7] -> bank 4~7(layer_0/2), tid 31, tk 7 -> ty 1 ->
      // [7][0+4~7],[0][64+4~7] -> bank 4~7(layer_28/30), tid 255,tk 0 -> ty 15
      // -> [0][0+60~63],[0][64+60~63] -> bank 28~31(layer_1/3), tid 255,tk 7 ->
      // ty 15 -> [7][0+60~63],[0][64+60~63] -> bank 28~31(layer_29/31),
      FLOAT4(r_comp_a[0]) = FLOAT4(s_a[tk][ty * TM / 2]);
      FLOAT4(r_comp_a[4]) = FLOAT4(s_a[tk][ty * TM / 2 + BM / 2]);
      // if (tid == < 32 && bx == 0 && by == 0) {
      //   printf("tid: %d, tx: %d, ty: %d, [%d][%d]\n", tid, tx, ty, tk, ty *
      //   TM / 2); printf("tid: %d, tx: %d, ty: %d, [%d][%d]\n", tid, tx, ty,
      //   tk, ty * TM / 2 + BM / 2);
      // }
      // conclusion: still have bank conflicts, need 16 memory issues ?

      // tid 0/8/16/24  access bank 0~3,  tid 1/9/17/25  access bank 4~7,
      // tid 2/10/18/26 access bank 8~11, tid 7/15/23/31 access bank 28~31, etc.
      // tid 0, tk 0 -> tx 0 -> [0][0+0~3],[0][64+0~3] -> bank 0~3(layer_0/2),
      // tid 0, tk 7 -> tx 0 -> [7][0+0~3],[0][64+0~3] -> bank 0~3(layer_28/30),
      // tid 1, tk 0 -> tx 1 -> [0][0+4~7],[0][64+4~7] -> bank 4~7(layer_0/2),
      // tid 1, tk 7 -> tx 1 -> [7][0+4~7],[0][64+4~7] -> bank 4~7(layer_28/30),
      FLOAT4(r_comp_b[0]) = FLOAT4(s_b[tk][tx * TN / 2]);
      FLOAT4(r_comp_b[4]) = FLOAT4(s_b[tk][tx * TN / 2 + BN / 2]);
      // conclusion: still have some bank conflicts, need 4 memory issues.

#pragma unroll
      for (int tm = 0; tm < TM; tm++) {
#pragma unroll
        for (int tn = 0; tn < TN; tn++) {
          // r_c[tm][tn] += r_comp_a[tm] * r_comp_b[tn];
          r_c[tm][tn] = __fmaf_rn(r_comp_a[tm], r_comp_b[tn], r_c[tm][tn]);
        }
      }
    }
    // sync per BK.
    __syncthreads();
  }

#pragma unroll
  for (int i = 0; i < TM / 2; i++) {
    int store_c_gmem_m = by * BM + ty * TM / 2 + i;
    int store_c_gmem_n = bx * BN + tx * TN / 2;
    int store_c_gmem_addr = store_c_gmem_m * N + store_c_gmem_n;
    FLOAT4(c[store_c_gmem_addr]) = FLOAT4(r_c[i][0]);
    FLOAT4(c[store_c_gmem_addr + BN / 2]) = FLOAT4(r_c[i][4]);
  }
#pragma unroll
  for (int i = 0; i < TM / 2; i++) {
    int store_c_gmem_m = by * BM + BM / 2 + ty * TM / 2 + i;
    int store_c_gmem_n = bx * BN + tx * TN / 2;
    int store_c_gmem_addr = store_c_gmem_m * N + store_c_gmem_n;
    FLOAT4(c[store_c_gmem_addr]) = FLOAT4(r_c[i + TM / 2][0]);
    FLOAT4(c[store_c_gmem_addr + BN / 2]) = FLOAT4(r_c[i + TM / 2][4]);
  }
}

template <const int BM = 128, const int BN = 128, const int BK = 8,
          const int TM = 8, const int TN = 8, const int OFFSET = 0>
__global__ void sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_kernel(
    float *a, float *b, float *c, const int M, const int N, const int K) {
  const int bx = blockIdx.x;
  const int by = blockIdx.y;
  const int tx = threadIdx.x;
  const int ty = threadIdx.y;
  const int tid = ty * blockDim.x + tx;

  __shared__ float s_a[2][BK][BM + OFFSET];
  __shared__ float s_b[2][BK][BN + OFFSET];

  float r_load_a[TM / 2];
  float r_load_b[TN / 2];
  float r_comp_a[TM];
  float r_comp_b[TN];
  float r_c[TM][TN] = {0.0};

  // mapping tid to s_a[BK][BM], for each orginal m-th row, load 4 + 4 K-dim
  // row major values from A matrix, and store it in COL major s_a[BK][BM].
  int load_a_smem_m = tid / 2; // tid / 2，(0,1,2,...,128)
  // (0b00000000 & 0b00000001) << 2 = 0
  // (0b00000001 & 0b00000001) << 2 = 4
  // (0b00000010 & 0b00000001) << 2 = 0
  // (0b00000011 & 0b00000001) << 2 = 4
  int load_a_smem_k = (tid & 1) << 2; // (0,4)
  // mapping tid to s_b[BK][BN], for each orginal k-th row, load 4 + 4 N-dim
  // row major values from B matrix, and store it in ROW major s_b[BK][BN].
  int load_b_smem_k = tid / 32; // 0~8
  // (0b00000000 & 0b00011111) << 2 = 0
  // (0b00000001 & 0b00011111) << 2 = 4
  // (0b00000010 & 0b00011111) << 2 = 8
  // (0b00000011 & 0b00011111) << 2 = 12
  int load_b_smem_n = (tid & 31) << 2; // (0,4,8,12,...,124)

  int load_a_gmem_m = by * BM + load_a_smem_m;
  int load_b_gmem_n = bx * BN + load_b_smem_n;

  // 1）主循环从bk = 1
  // 开始，第一次数据加载在主循环之前，最后一次计算在主循环之后，这是pipeline
  // 的特点决定的； 2）由于计算和下一次访存使用的Shared
  // Memory不同，因此主循环中每次循环只需要一次__syncthreads()即可
  // 3）由于GPU不能向CPU那样支持乱序执行，主循环中需要先将下一次循环计算需要的Gloabal
  // Memory中的数据load
  // 到寄存器，然后进行本次计算，之后再将load到寄存器中的数据写到Shared
  // Memory，这样在LDG指令向Global
  // Memory做load时，不会影响后续FFMA及其它运算指令的 launch
  // 执行，也就达到了Double Buffering的目的。

  // bk = 0 is loading here, buffer 0

  {
    int load_a_gmem_k = load_a_smem_k;
    int load_a_gmem_addr = load_a_gmem_m * K + load_a_gmem_k;
    int load_b_gmem_k = load_b_smem_k;
    int load_b_gmem_addr = load_b_gmem_k * N + load_b_gmem_n;
    FLOAT4(r_load_a[0]) = FLOAT4(a[load_a_gmem_addr]);
    FLOAT4(r_load_b[0]) = FLOAT4(b[load_b_gmem_addr]);

    s_a[0][load_a_smem_k + 0][load_a_smem_m] = r_load_a[0];
    s_a[0][load_a_smem_k + 1][load_a_smem_m] = r_load_a[1];
    s_a[0][load_a_smem_k + 2][load_a_smem_m] = r_load_a[2];
    s_a[0][load_a_smem_k + 3][load_a_smem_m] = r_load_a[3];
    FLOAT4(s_b[0][load_b_smem_k][load_b_smem_n]) = FLOAT4(r_load_b[0]);
  }
  // Without this synchronization, accuracy may occasionally be abnormal.
  __syncthreads();

  // bk start from 1，需要注意的是，虽然 bk 从 1 开始，但实际上 bk=1时，使用的是
  // 第0块BK中的数据（已经加载到共享内存s_a[0]和s_b[0]）；bk=2时，实际计算的是第1块
  // BK中的数据。其余以此类推，这个循环结束后，剩下最后一块BK大小的数据需要计算。
  for (int bk = 1; bk < (K + BK - 1) / BK; bk++) {
    int smem_sel = (bk - 1) & 1;
    int smem_sel_next = bk & 1;

    int load_a_gmem_k = bk * BK + load_a_smem_k;
    int load_a_gmem_addr = load_a_gmem_m * K + load_a_gmem_k;
    int load_b_gmem_k = bk * BK + load_b_smem_k;
    int load_b_gmem_addr = load_b_gmem_k * N + load_b_gmem_n;
    FLOAT4(r_load_a[0]) = FLOAT4(a[load_a_gmem_addr]);
    FLOAT4(r_load_b[0]) = FLOAT4(b[load_b_gmem_addr]);

#pragma unroll
    for (int tk = 0; tk < BK; tk++) {
      FLOAT4(r_comp_a[0]) = FLOAT4(s_a[smem_sel][tk][ty * TM / 2]);
      FLOAT4(r_comp_a[4]) = FLOAT4(s_a[smem_sel][tk][ty * TM / 2 + BM / 2]);
      FLOAT4(r_comp_b[0]) = FLOAT4(s_b[smem_sel][tk][tx * TN / 2]);
      FLOAT4(r_comp_b[4]) = FLOAT4(s_b[smem_sel][tk][tx * TN / 2 + BN / 2]);

#pragma unroll
      for (int tm = 0; tm < TM; tm++) {
#pragma unroll
        for (int tn = 0; tn < TN; tn++) {
          // r_c[tm][tn] += r_comp_a[tm] * r_comp_b[tn];
          r_c[tm][tn] = __fmaf_rn(r_comp_a[tm], r_comp_b[tn], r_c[tm][tn]);
        }
      }
    }

    // 对比非double buffers版本，此处不需要__syncthreads()，总共节省了
    // ((K + BK - 1) / BK) - 1 次block内的同步操作。比如，bk=1时，HFMA计算
    // 使用的是s_a[0]和s_b[0]，因此，和s_a[1]和s_b[1]的加载是没有依赖关系的。
    // 从global内存到s_a[1]和s_b[1]和HFMA计算可以并行。s_a[1]和s_b[1]用于
    // 加载下一块BK需要的数据到共享内存。
    s_a[smem_sel_next][load_a_smem_k + 0][load_a_smem_m] = r_load_a[0];
    s_a[smem_sel_next][load_a_smem_k + 1][load_a_smem_m] = r_load_a[1];
    s_a[smem_sel_next][load_a_smem_k + 2][load_a_smem_m] = r_load_a[2];
    s_a[smem_sel_next][load_a_smem_k + 3][load_a_smem_m] = r_load_a[3];
    FLOAT4(s_b[smem_sel_next][load_b_smem_k][load_b_smem_n]) =
        FLOAT4(r_load_b[0]);

    __syncthreads();
  }

// 计算剩下最后一块BK
  // 最后一块 BK 落在哪个 buffer，取决于循环最后一次 (bk = numTiles-1) 的
  // smem_sel_next = bk & 1，即 ((K + BK - 1) / BK - 1) & 1
  int smem_sel_last = ((K + BK - 1) / BK - 1) & 1;

#pragma unroll
  for (int tk = 0; tk < BK; tk++) {
    FLOAT4(r_comp_a[0]) = FLOAT4(s_a[smem_sel_last][tk][ty * TM / 2]);
    FLOAT4(r_comp_a[4]) = FLOAT4(s_a[smem_sel_last][tk][ty * TM / 2 + BM / 2]);
    FLOAT4(r_comp_b[0]) = FLOAT4(s_b[smem_sel_last][tk][tx * TN / 2]);
    FLOAT4(r_comp_b[4]) = FLOAT4(s_b[smem_sel_last][tk][tx * TN / 2 + BN / 2]);

#pragma unroll
    for (int tm = 0; tm < TM; tm++) {
#pragma unroll
      for (int tn = 0; tn < TN; tn++) {
        // r_c[tm][tn] += r_comp_a[tm] * r_comp_b[tn];
        r_c[tm][tn] = __fmaf_rn(r_comp_a[tm], r_comp_b[tn], r_c[tm][tn]);
      }
    }
  }

#pragma unroll
  for (int i = 0; i < TM / 2; i++) {
    int store_c_gmem_m = by * BM + ty * TM / 2 + i;
    int store_c_gmem_n = bx * BN + tx * TN / 2;
    int store_c_gmem_addr = store_c_gmem_m * N + store_c_gmem_n;
    FLOAT4(c[store_c_gmem_addr]) = FLOAT4(r_c[i][0]);
    FLOAT4(c[store_c_gmem_addr + BN / 2]) = FLOAT4(r_c[i][4]);
  }
#pragma unroll
  for (int i = 0; i < TM / 2; i++) {
    int store_c_gmem_m = by * BM + BM / 2 + ty * TM / 2 + i;
    int store_c_gmem_n = bx * BN + tx * TN / 2;
    int store_c_gmem_addr = store_c_gmem_m * N + store_c_gmem_n;
    FLOAT4(c[store_c_gmem_addr]) = FLOAT4(r_c[i + TM / 2][0]);
    FLOAT4(c[store_c_gmem_addr + BN / 2]) = FLOAT4(r_c[i + TM / 2][4]);
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

// SGEMM naive: compute one c[i,j] element per threads, all row major
void sgemm_naive_f32(torch::Tensor a, torch::Tensor b, torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 32;
  constexpr int BN = 32;

  dim3 block(BN, BM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_naive_f32_kernel<<<grid, block>>>(
      reinterpret_cast<float *>(a.data_ptr()),
      reinterpret_cast<float *>(b.data_ptr()),
      reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

// SGEMM: Block Tile + K Tile, with smem
// Block Tile (BM, BN) + K Tile (BK=32)
// grid((N + BN - 1) / BN, (M + BM - 1) / BM), block(BN, BM)
// a: MxK, b: KxN, c: MxN, compute: c = a * b, all row major
void sgemm_sliced_k_f32(torch::Tensor a, torch::Tensor b, torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 32;
  constexpr int BN = 32;
  constexpr int BK = 32;

  dim3 block(BN, BM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_sliced_k_f32_kernel<BM, BN, BK>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

// SGEMM: Block Tile + Thread Tile + K Tile + Vec4, with smem
// BK:TILE_K=8 BM=BN=128
// TM=TN=8 增加计算密度 BM/TM=16 BN/TN=16
// dim3 blockDim(BN/TN, BM/TM);
// dim3 gridDim((N + BN - 1) / BN, (M + BM - 1) / BM)
void sgemm_t_8x8_sliced_k_f32x4(torch::Tensor a, torch::Tensor b,
                                torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 128;
  constexpr int BN = 128;
  constexpr int BK = 8;
  constexpr int TM = 8;
  constexpr int TN = 8;

  dim3 block(BN / TN, BM / TM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_t_8x8_sliced_k_f32x4_kernel<BM, BN, BK, TM, TN>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

void sgemm_t_8x8_sliced_k_f32x4_bcf(torch::Tensor a, torch::Tensor b,
                                    torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 128;
  constexpr int BN = 128;
  constexpr int BK = 8;
  constexpr int TM = 8;
  constexpr int TN = 8;

  dim3 block(BN / TN, BM / TM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_t_8x8_sliced_k_f32x4_bcf_kernel<BM, BN, BK, TM, TN>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

void sgemm_t_8x8_sliced_k_f32x4_bcf_offset(torch::Tensor a, torch::Tensor b,
                                           torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 128;
  constexpr int BN = 128;
  constexpr int BK = 8;
  constexpr int TM = 8;
  constexpr int TN = 8;
  constexpr int OFFSET = 4;

  dim3 block(BN / TN, BM / TM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_t_8x8_sliced_k_f32x4_bcf_kernel<BM, BN, BK, TM, TN, OFFSET>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

void sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf(torch::Tensor a, torch::Tensor b,
                                         torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 128;
  constexpr int BN = 128;
  constexpr int BK = 8;
  constexpr int TM = 8;
  constexpr int TN = 8;

  dim3 block(BN / TN, BM / TM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_kernel<BM, BN, BK, TM, TN>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

void sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_offset(torch::Tensor a,
                                                torch::Tensor b,
                                                torch::Tensor c) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int BM = 128;
  constexpr int BN = 128;
  constexpr int BK = 8;
  constexpr int TM = 8;
  constexpr int TN = 8;
  constexpr int OFFSET = 4;

  dim3 block(BN / TN, BM / TM);
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);

  sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_kernel<BM, BN, BK, TM, TN, OFFSET>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(b.data_ptr()),
                        reinterpret_cast<float *>(c.data_ptr()), M, N, K);
}

// from sgemm_async.cu
void sgemm_t_8x4_sliced_k16_f32x4_bcf_dbuf(torch::Tensor a, torch::Tensor b,
                                           torch::Tensor c);
void sgemm_t_8x4_sliced_k16_f32x4_bcf_dbuf_async(torch::Tensor a,
                                                 torch::Tensor b,
                                                 torch::Tensor c);
void sgemm_t_8x8_sliced_k16_f32x4_bcf_dbuf(torch::Tensor a, torch::Tensor b,
                                           torch::Tensor c);
void sgemm_t_8x8_sliced_k16_f32x4_bcf_dbuf_async(torch::Tensor a,
                                                 torch::Tensor b,
                                                 torch::Tensor c);
void sgemm_t_8x16_sliced_k16_f32x4_bcf_dbuf(torch::Tensor a, torch::Tensor b,
                                            torch::Tensor c);
void sgemm_t_8x16_sliced_k16_f32x4_bcf_dbuf_async(torch::Tensor a,
                                                  torch::Tensor b,
                                                  torch::Tensor c);
// from sgemm_cublas.cu
void sgemm_cublas(torch::Tensor a, torch::Tensor b, torch::Tensor c);
void sgemm_cublas_tf32(torch::Tensor a, torch::Tensor b, torch::Tensor c);
// from sgemm_wmma_tf32_stage.cu
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stage2(torch::Tensor a, torch::Tensor b,
                                               torch::Tensor c);
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stage2_offset(torch::Tensor a,
                                                      torch::Tensor b,
                                                      torch::Tensor c);
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stage3(torch::Tensor a, torch::Tensor b,
                                               torch::Tensor c);
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stage3_offset(torch::Tensor a,
                                                      torch::Tensor b,
                                                      torch::Tensor c);

void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages(torch::Tensor a, torch::Tensor b,
                                               torch::Tensor c, int stages,
                                               bool swizzle,
                                               int swizzle_stride);
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem(torch::Tensor a,
                                                     torch::Tensor b,
                                                     torch::Tensor c,
                                                     int stages, bool swizzle,
                                                     int swizzle_stride);

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  // CUDA Cores
  TORCH_BINDING_COMMON_EXTENSION(sgemm_naive_f32)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_sliced_k_f32)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k_f32x4)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k_f32x4_bcf)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k_f32x4_bcf_offset)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_offset)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x4_sliced_k16_f32x4_bcf_dbuf)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x4_sliced_k16_f32x4_bcf_dbuf_async)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k16_f32x4_bcf_dbuf)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x8_sliced_k16_f32x4_bcf_dbuf_async)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x16_sliced_k16_f32x4_bcf_dbuf)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_t_8x16_sliced_k16_f32x4_bcf_dbuf_async)
  // cuBLAS Tensor Cores
  TORCH_BINDING_COMMON_EXTENSION(sgemm_cublas)
  TORCH_BINDING_COMMON_EXTENSION(sgemm_cublas_tf32)
  // WMMA API Tensor Cores, stage, thread block swizzle, dsmem
  TORCH_BINDING_COMMON_EXTENSION(sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages)
  TORCH_BINDING_COMMON_EXTENSION(
      sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem)
}
```

</details>

### `sgemm_wmma_tf32_stage.cu`（WMMA TF32 版）
<details>
<summary> sgemm_wmma_tf32_stage.cu </summary>

```c++
#include <algorithm>
#include <cuda_bf16.h>
#include <cuda_fp16.h>
#include <cuda_fp8.h>
#include <cuda_runtime.h>
#include <float.h>
#include <mma.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>

using namespace nvcuda;

#define WARP_SIZE 32
#define DEVICE_INLINE __device__ inline
#define HOST_DEVICE_INLINE __device__ __host__ inline
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define BFLOAT2(value) (reinterpret_cast<__nv_bfloat162 *>(&(value))[0])
#define LDST32BITS(value) (reinterpret_cast<half2 *>(&(value))[0])
#define LDST64BITS(value) (reinterpret_cast<float2 *>(&(value))[0])
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])
#define CP_ASYNC_COMMIT_GROUP() asm volatile("cp.async.commit_group;\n" ::)
#define CP_ASYNC_WAIT_ALL() asm volatile("cp.async.wait_all;\n" ::)
#define CP_ASYNC_WAIT_GROUP(n)                                                 \
  asm volatile("cp.async.wait_group %0;\n" ::"n"(n))
// ca(cache all, L1 + L2): support 4, 8, 16 bytes, cg(cache global, L2): only
// support 16 bytes.
#define CP_ASYNC_CA(dst, src, bytes)                                           \
  asm volatile(                                                                \
      "cp.async.ca.shared.global.L2::128B [%0], [%1], %2;\n" ::"r"(dst),       \
      "l"(src), "n"(bytes))
#define CP_ASYNC_CG(dst, src, bytes)                                           \
  asm volatile(                                                                \
      "cp.async.cg.shared.global.L2::128B [%0], [%1], %2;\n" ::"r"(dst),       \
      "l"(src), "n"(bytes))
// Support A and B matrix with row-major inorder to compare with the kernels
// using CUDA Cores in sgemm.cu and sgemm_async.cu. also need flag when
// compiling.

HOST_DEVICE_INLINE
int div_ceil(int a, int b) { return (a % b != 0) ? (a / b + 1) : (a / b); }

__global__ void f32x4_tf32x4_kernel(float *x, float *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 4;
  if (idx < N) {
    float4 reg_x = FLOAT4(x[idx]);
    float4 reg_y;
    reg_y.x = wmma::__float_to_tf32(reg_x.x);
    reg_y.y = wmma::__float_to_tf32(reg_x.y);
    reg_y.z = wmma::__float_to_tf32(reg_x.z);
    reg_y.w = wmma::__float_to_tf32(reg_x.w);
    FLOAT4(y[idx]) = reg_y;
  }
}

// stage2/3/4 (stage2=double buffers+copy async)
// 1. When using shared memory exceeds 48 KB, dynamic shared memory needs to be
// used, i.e., declare a block of dynamic shared memory with extern shared half
// smem[];. When calling the kernel, the size of the dynamic shared memory needs
// to be specified, and smem addressing should be used in a one-dimensional
// array manner.
// 2. Improve L2 Cache locality (Thread Block Swizzle):
// https://zhuanlan.zhihu.com/p/555339335
// 3. __launch_bounds__: avoid error 'too many resources required for launch'
// reference: https://blog.csdn.net/feng__shuai/article/details/124395023
template <const int WMMA_M = 16, const int WMMA_N = 16, const int WMMA_K = 8,
          const int WMMA_TILE_M = 4, const int WMMA_TILE_N = 2,
          const int WARP_TILE_M = 2, const int WARP_TILE_N = 4,
          const int A_PAD = 0, const int B_PAD = 0, const int K_STAGE = 2,
          const bool BLOCK_SWIZZLE = false>
__global__ void
sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_kernel(float *A, float *B, float *C,
                                                 int M, int N, int K) {
  // 256 threads(8 warps) per block.
  // const int bx = blockIdx.x;
  // BLOCK_SWIZZLE 0/1 控制是否使用 block swizzle
  const int bx = ((int)BLOCK_SWIZZLE) * blockIdx.z * gridDim.x + blockIdx.x;
  const int by = blockIdx.y;
  const int NUM_K_TILES = div_ceil(K, WMMA_K);
  constexpr int BM = WMMA_M * WMMA_TILE_M * WARP_TILE_M; // 16x4*2=128
  constexpr int BN = WMMA_N * WMMA_TILE_N * WARP_TILE_N; // 16x2*4=128
  constexpr int BK = WMMA_K;                             // 8
  __shared__ float s_a[K_STAGE][BM][BK + A_PAD], s_b[K_STAGE][BK][BN + B_PAD];

  // 要保证相同的warp下thread执行相同的指令
  const int tid = threadIdx.y * blockDim.x + threadIdx.x;
  const int warp_id = tid / WARP_SIZE; // 0~7 warp_id within block
  const int warp_m = warp_id / 2;      // 0,1,2,3
  const int warp_n = warp_id % 2;      // 0,1

  // 先计算shared memory中的索引
  // tid和需要加载的smem s_a[BM][BK] 之间的索引关系 BM=128 BK=8 按行读取 A行主序
  // 对于s_a每行8个数据，每个线程读取4个，需要2个线程；总共128行，需要128x2刚好256线程
  int load_smem_a_m = tid / 2;                // row 0~127
  int load_smem_a_k = (tid % 2 == 0) ? 0 : 4; // col 0,4
  // tid和需要加载的smem s_b[BK][BN] 之间的索引关系 BK=8 BN=128 按行读取 B行主序
  // 对于s_b每行128个数据，每个线程读4个数据，需要32个线程；总共8行，需要32x8=256个线程
  int load_smem_b_k = tid / 32;       // row 0~7
  int load_smem_b_n = (tid % 32) * 4; // col 0,4,...,124,...
  // 再计算全局内存中的索引
  // 要加载到s_a中的元素对应到A全局内存中的行数
  // 每个block负责出C中大小为BM*BN的块
  int load_gmem_a_m = by * BM + load_smem_a_m; // global row of a and c
  int load_gmem_b_n = bx * BN + load_smem_b_n; // global col of b and c

  wmma::fragment<wmma::accumulator, WMMA_M, WMMA_N, WMMA_K, float>
      C_frag[WARP_TILE_M][WARP_TILE_N];

#pragma unroll
  for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      wmma::fill_fragment(C_frag[i][j], 0.0);
    }
  }

#pragma unroll
  for (int k = 0; k < (K_STAGE - 1); ++k) {         // 0, 1
    int load_gmem_a_k = k * WMMA_K + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * WMMA_K + load_smem_b_k; // global row of b
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;

    uint32_t load_smem_a_ptr =
        __cvta_generic_to_shared(&s_a[k][load_smem_a_m][load_smem_a_k]);
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr =
        __cvta_generic_to_shared(&s_b[k][load_smem_b_k][load_smem_b_n]);
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);

    CP_ASYNC_COMMIT_GROUP();
  }

  CP_ASYNC_WAIT_GROUP(K_STAGE - 2); // s2->0, s3->1, s4->2
  __syncthreads();

#pragma unroll
  for (int k = (K_STAGE - 1); k < NUM_K_TILES; k++) {
    // s2/4 can use bitwise ops but s3 can not, so, we use mod
    // ops for all stages kernel. s2: (k + 1)&1, s4: (k + 1)&3
    // s3: (k + 1) % 3
    int smem_sel = (k + 1) % K_STAGE; // s3 k 2->0, k 3->1, k 4->2...
    int smem_sel_next = k % K_STAGE;  // s3 k 2->2, k 3->0, k 4->1...

    // k * WMMA_K, WMMA_K=16 -> (k << 4)
    int load_gmem_a_k = k * WMMA_K + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * WMMA_K + load_smem_b_k; // global row of b
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;

    // load stage 2, k start from 2
    uint32_t load_smem_a_ptr = __cvta_generic_to_shared(
        &s_a[smem_sel_next][load_smem_a_m][load_smem_a_k]);
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr = __cvta_generic_to_shared(
        &s_b[smem_sel_next][load_smem_b_k][load_smem_b_n]);
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);
    CP_ASYNC_COMMIT_GROUP();

    wmma::fragment<wmma::matrix_a, WMMA_M, WMMA_N, WMMA_K,
                   wmma::precision::tf32, wmma::row_major>
        A_frag[WARP_TILE_M];
    wmma::fragment<wmma::matrix_b, WMMA_M, WMMA_N, WMMA_K,
                   wmma::precision::tf32, wmma::row_major>
        B_frag[WARP_TILE_N];

// compute stage 0
#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
      // load 2 tiles -> reg, smem a -> frags a, warp_m 0~3
      const int warp_smem_a_m = warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
      wmma::load_matrix_sync(A_frag[i], &s_a[smem_sel][warp_smem_a_m][0],
                             BK + A_PAD);
    }

#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      // load 4 tiles -> reg, smem b -> frags b, warp_n 0~2
      const int warp_smem_b_n = warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
      wmma::load_matrix_sync(B_frag[j], &s_b[smem_sel][0][warp_smem_b_n],
                             BN + B_PAD);
    }

#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        wmma::mma_sync(C_frag[i][j], A_frag[i], B_frag[j], C_frag[i][j]);
      }
    }

    CP_ASYNC_WAIT_GROUP(K_STAGE - 2);
    __syncthreads();
  }

  // make sure all memory issues ready.
  if ((K_STAGE - 2) > 0) {
    CP_ASYNC_WAIT_GROUP(0);
    __syncthreads();
  }
  // processing last (K_STAGE-1) k iters.
  {
#pragma unroll
    for (int k = 0; k < (K_STAGE - 1); k++) {
      const int stage_sel = ((NUM_K_TILES - (K_STAGE - 1) + k) % K_STAGE);
      wmma::fragment<wmma::matrix_a, WMMA_M, WMMA_N, WMMA_K,
                     wmma::precision::tf32, wmma::row_major>
          A_frag[WARP_TILE_M];
      wmma::fragment<wmma::matrix_b, WMMA_M, WMMA_N, WMMA_K,
                     wmma::precision::tf32, wmma::row_major>
          B_frag[WARP_TILE_N];

#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
        // load 2 tiles -> reg, smem a -> frags a, warp_m 0~3
        const int warp_smem_a_m = warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
        wmma::load_matrix_sync(A_frag[i], &s_a[stage_sel][warp_smem_a_m][0],
                               BK + A_PAD);
      }

#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        // load 4 tiles -> reg, smem b -> frags b, warp_n 0~2
        const int warp_smem_b_n = warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
        wmma::load_matrix_sync(B_frag[j], &s_b[stage_sel][0][warp_smem_b_n],
                               BN + B_PAD);
      }

#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
        for (int j = 0; j < WARP_TILE_N; ++j) {
          wmma::mma_sync(C_frag[i][j], A_frag[i], B_frag[j], C_frag[i][j]);
        }
      }
    }
  }

// finally, store back to C matrix.
#pragma unroll
  for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      const int store_gmem_a_m =
          by * BM + warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
      const int store_gmem_a_n =
          bx * BN + warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
      wmma::store_matrix_sync(C + store_gmem_a_m * N + store_gmem_a_n,
                              C_frag[i][j], N, wmma::mem_row_major);
    }
  }
}

// stage2/3/4 (stage2=double buffers+copy async)
// 1. When using shared memory exceeds 48 KB, dynamic shared memory needs to be
// used, i.e., declare a block of dynamic shared memory with extern shared half
// smem[];. When calling the kernel, the size of the dynamic shared memory needs
// to be specified, and smem addressing should be used in a one-dimensional
// array manner.
// 2. Improve L2 Cache locality (Thread Block Swizzle):
// https://zhuanlan.zhihu.com/p/555339335
// 3. __launch_bounds__: avoid error 'too many resources required for launch'
// reference: https://blog.csdn.net/feng__shuai/article/details/124395023
template <const int WMMA_M = 16, const int WMMA_N = 16, const int WMMA_K = 8,
          const int WMMA_TILE_M = 4, const int WMMA_TILE_N = 2,
          const int WARP_TILE_M = 2, const int WARP_TILE_N = 4,
          const int A_PAD = 0, const int B_PAD = 0, const int K_STAGE = 2,
          const bool BLOCK_SWIZZLE = false>
__global__ void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem_kernel(
    float *A, float *B, float *C, int M, int N, int K) {
  // 256 threads(8 warps) per block.
  // const int bx = blockIdx.x;
  // BLOCK_SWIZZLE 0/1 控制是否使用 block swizzle
  const int bx = ((int)BLOCK_SWIZZLE) * blockIdx.z * gridDim.x + blockIdx.x;
  const int by = blockIdx.y;
  const int NUM_K_TILES = div_ceil(K, WMMA_K);
  constexpr int BM = WMMA_M * WMMA_TILE_M * WARP_TILE_M; // 16x4*2=128
  constexpr int BN = WMMA_N * WMMA_TILE_N * WARP_TILE_N; // 16x2*4=128
  constexpr int BK = WMMA_K;                             // 8
  // s2: 2*128*(8+4)*4=12KB, 2*8*(128+4)*4=8.25KB,   ~21KB
  // s3: 3*128*(8+4)*4=18KB, 3*8*(128+4)*4=12.375KB, ~31KB
  // s4: 4*128*(8+4)*4=24KB, 4*8*(128+4)*4=16.5KB,   ~41KB
  extern __shared__ float smem[];
  float *s_a = smem;
  float *s_b = smem + K_STAGE * BM * (BK + A_PAD);
  constexpr int s_a_stage_offset = BM * (BK + A_PAD);
  constexpr int s_b_stage_offset = BK * (BN + B_PAD);

  // 要保证相同的warp下thread执行相同的指令
  const int tid = threadIdx.y * blockDim.x + threadIdx.x;
  const int warp_id = tid / WARP_SIZE; // 0~7 warp_id within block
  const int warp_m = warp_id / 2;      // 0,1,2,3
  const int warp_n = warp_id % 2;      // 0,1

  // 先计算shared memory中的索引
  // tid和需要加载的smem s_a[BM][BK] 之间的索引关系 BM=128 BK=8 按行读取 A行主序
  // 对于s_a每行8个数据，每个线程读取4个，需要2个线程；总共128行，需要128x2刚好256线程
  int load_smem_a_m = tid / 2;                // row 0~127
  int load_smem_a_k = (tid % 2 == 0) ? 0 : 4; // col 0,4
  // tid和需要加载的smem s_b[BK][BN] 之间的索引关系 BK=8 BN=128 按行读取 B行主序
  // 对于s_b每行128个数据，每个线程读4个数据，需要32个线程；总共8行，需要32x8=256个线程
  int load_smem_b_k = tid / 32;       // row 0~7
  int load_smem_b_n = (tid % 32) * 4; // col 0,4,...,124,...
  // 再计算全局内存中的索引
  // 要加载到s_a中的元素对应到A全局内存中的行数
  // 每个block负责出C中大小为BM*BN的块
  int load_gmem_a_m = by * BM + load_smem_a_m; // global row of a and c
  int load_gmem_b_n = bx * BN + load_smem_b_n; // global col of b and c

  wmma::fragment<wmma::accumulator, WMMA_M, WMMA_N, WMMA_K, float>
      C_frag[WARP_TILE_M][WARP_TILE_N];

#pragma unroll
  for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      wmma::fill_fragment(C_frag[i][j], 0.0);
    }
  }

  // only cvta smem base ptr once for cp.async.
  uint32_t smem_a_base_ptr = __cvta_generic_to_shared(s_a);
  uint32_t smem_b_base_ptr = __cvta_generic_to_shared(s_b);

#pragma unroll
  for (int k = 0; k < (K_STAGE - 1); ++k) {         // 0, 1
    int load_gmem_a_k = k * WMMA_K + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * WMMA_K + load_smem_b_k; // global row of b
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;

    uint32_t load_smem_a_ptr =
        (smem_a_base_ptr +
         (k * s_a_stage_offset + load_smem_a_m * (BK + A_PAD) + load_smem_a_k) *
             sizeof(float));
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr =
        (smem_b_base_ptr +
         (k * s_b_stage_offset + load_smem_b_k * (BN + B_PAD) + load_smem_b_n) *
             sizeof(float));
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);

    CP_ASYNC_COMMIT_GROUP();
  }

  CP_ASYNC_WAIT_GROUP(K_STAGE - 2); // s2->0, s3->1, s4->2
  __syncthreads();

#pragma unroll
  for (int k = (K_STAGE - 1); k < NUM_K_TILES; k++) {
    // s2/4 can use bitwise ops but s3 can not, so, we use mod
    // ops for all stages kernel. s2: (k + 1)&1, s4: (k + 1)&3
    // s3: (k + 1) % 3
    int smem_sel = (k + 1) % K_STAGE; // s3 k 2->0, k 3->1, k 4->2...
    int smem_sel_next = k % K_STAGE;  // s3 k 2->2, k 3->0, k 4->1...

    // k * WMMA_K, WMMA_K=16 -> (k << 4)
    int load_gmem_a_k = k * WMMA_K + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * WMMA_K + load_smem_b_k; // global row of b
    int load_gmem_b_addr = load_gmem_b_k * N + load_gmem_b_n;

    // load stage 2, k start from 2
    uint32_t load_smem_a_ptr =
        (smem_a_base_ptr + (smem_sel_next * s_a_stage_offset +
                            load_smem_a_m * (BK + A_PAD) + load_smem_a_k) *
                               sizeof(float));
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr =
        (smem_b_base_ptr + (smem_sel_next * s_b_stage_offset +
                            load_smem_b_k * (BN + B_PAD) + load_smem_b_n) *
                               sizeof(float));
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);
    CP_ASYNC_COMMIT_GROUP();

    wmma::fragment<wmma::matrix_a, WMMA_M, WMMA_N, WMMA_K,
                   wmma::precision::tf32, wmma::row_major>
        A_frag[WARP_TILE_M];
    wmma::fragment<wmma::matrix_b, WMMA_M, WMMA_N, WMMA_K,
                   wmma::precision::tf32, wmma::row_major>
        B_frag[WARP_TILE_N];

// compute stage 0
#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
      // load 2 tiles -> reg, smem a -> frags a, warp_m 0~3
      int warp_smem_a_m = warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
      float *load_smem_a_frag_ptr =
          (s_a + smem_sel * s_a_stage_offset + warp_smem_a_m * (BK + A_PAD) +
           0); // BK=WMMA_K=8
      wmma::load_matrix_sync(A_frag[i], load_smem_a_frag_ptr, BK + A_PAD);
    }

#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      // load 4 tiles -> reg, smem b -> frags b, warp_n 0~2
      int warp_smem_b_n = warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
      float *load_smem_b_frag_ptr =
          (s_b + smem_sel * s_b_stage_offset + 0 * (BN + B_PAD) +
           warp_smem_b_n); // BK=WMMA_K=8
      wmma::load_matrix_sync(B_frag[j], load_smem_b_frag_ptr, BN + B_PAD);
    }

#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        wmma::mma_sync(C_frag[i][j], A_frag[i], B_frag[j], C_frag[i][j]);
      }
    }

    CP_ASYNC_WAIT_GROUP(K_STAGE - 2);
    __syncthreads();
  }

  // make sure all memory issues ready.
  if ((K_STAGE - 2) > 0) {
    CP_ASYNC_WAIT_GROUP(0);
    __syncthreads();
  }
  // processing last (K_STAGE-1) k iters.
  {
#pragma unroll
    for (int k = 0; k < (K_STAGE - 1); k++) {
      const int stage_sel = ((NUM_K_TILES - (K_STAGE - 1) + k) % K_STAGE);
      wmma::fragment<wmma::matrix_a, WMMA_M, WMMA_N, WMMA_K,
                     wmma::precision::tf32, wmma::row_major>
          A_frag[WARP_TILE_M];
      wmma::fragment<wmma::matrix_b, WMMA_M, WMMA_N, WMMA_K,
                     wmma::precision::tf32, wmma::row_major>
          B_frag[WARP_TILE_N];

#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
        // load 2 tiles -> reg, smem a -> frags a, warp_m 0~3
        int warp_smem_a_m = warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
        float *load_smem_a_frag_ptr =
            (s_a + stage_sel * s_a_stage_offset + warp_smem_a_m * (BK + A_PAD) +
             0); // BK=WMMA_K=8
        wmma::load_matrix_sync(A_frag[i], load_smem_a_frag_ptr, BK + A_PAD);
      }

#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        // load 4 tiles -> reg, smem b -> frags b, warp_n 0~2
        int warp_smem_b_n = warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
        float *load_smem_b_frag_ptr =
            (s_b + stage_sel * s_b_stage_offset + 0 * (BN + B_PAD) +
             warp_smem_b_n); // BK=WMMA_K=8
        wmma::load_matrix_sync(B_frag[j], load_smem_b_frag_ptr, BN + B_PAD);
      }

#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
        for (int j = 0; j < WARP_TILE_N; ++j) {
          wmma::mma_sync(C_frag[i][j], A_frag[i], B_frag[j], C_frag[i][j]);
        }
      }
    }
  }

// finally, store back to C matrix.
#pragma unroll
  for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      const int store_gmem_a_m =
          by * BM + warp_m * (WMMA_M * WARP_TILE_M) + i * WMMA_M;
      const int store_gmem_a_n =
          bx * BN + warp_n * (WMMA_N * WARP_TILE_N) + j * WMMA_N;
      wmma::store_matrix_sync(C + store_gmem_a_m * N + store_gmem_a_n,
                              C_frag[i][j], N, wmma::mem_row_major);
    }
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

// 128x128 w/o dynamic smem
#define LAUNCH_16168_STAGE_SWIZZLE_KERNEL(stages, stride)                      \
  {                                                                            \
    const int N_SWIZZLE = (N + (stride) - 1) / (stride);                       \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid((div_ceil(N, BN) + N_SWIZZLE - 1) / N_SWIZZLE, div_ceil(M, BM),  \
              N_SWIZZLE);                                                      \
    sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_kernel<                          \
        WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,         \
        WARP_TILE_N, A_PAD, B_PAD, (stages), true>                             \
        <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),             \
                          reinterpret_cast<float *>(b.data_ptr()),             \
                          reinterpret_cast<float *>(c.data_ptr()), M, N, K);   \
  }

#define LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(stages)                           \
  {                                                                            \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid(div_ceil(N, BN), div_ceil(M, BM));                               \
    sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_kernel<                          \
        WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,         \
        WARP_TILE_N, A_PAD, B_PAD, (stages), false>                            \
        <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),             \
                          reinterpret_cast<float *>(b.data_ptr()),             \
                          reinterpret_cast<float *>(c.data_ptr()), M, N, K);   \
  }

// 128x128 w dynamic smem, 98304=96KB < Ampere, Ada, Hopper ...
#define LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(stages, stride)                \
  {                                                                            \
    const int smem_max_size = ((stages) * BM * (BK + A_PAD) * sizeof(float) +  \
                               (stages) * BK * (BN + B_PAD) * sizeof(float));  \
    cudaFuncSetAttribute(                                                      \
        sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem_kernel<                \
            WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,     \
            WARP_TILE_N, A_PAD, B_PAD, (stages), true>,                        \
        cudaFuncAttributeMaxDynamicSharedMemorySize, 98304);                   \
    const int N_SWIZZLE = (N + (stride) - 1) / (stride);                       \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid((div_ceil(N, BN) + N_SWIZZLE - 1) / N_SWIZZLE, div_ceil(M, BM),  \
              N_SWIZZLE);                                                      \
    sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem_kernel<                    \
        WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,         \
        WARP_TILE_N, A_PAD, B_PAD, (stages), true>                             \
        <<<grid, block, smem_max_size>>>(                                      \
            reinterpret_cast<float *>(a.data_ptr()),                           \
            reinterpret_cast<float *>(b.data_ptr()),                           \
            reinterpret_cast<float *>(c.data_ptr()), M, N, K);                 \
  }

#define LAUNCH_16168_STAGE_NO_SWIZZLE_DSMEM_KERNEL(stages)                     \
  {                                                                            \
    const int smem_max_size = ((stages) * BM * (BK + A_PAD) * sizeof(float) +  \
                               (stages) * BK * (BN + B_PAD) * sizeof(float));  \
    cudaFuncSetAttribute(                                                      \
        sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem_kernel<                \
            WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,     \
            WARP_TILE_N, A_PAD, B_PAD, (stages), false>,                       \
        cudaFuncAttributeMaxDynamicSharedMemorySize, 98304);                   \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid(div_ceil(N, BN), div_ceil(M, BM));                               \
    sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem_kernel<                    \
        WMMA_M, WMMA_N, WMMA_K, WMMA_TILE_M, WMMA_TILE_N, WARP_TILE_M,         \
        WARP_TILE_N, A_PAD, B_PAD, (stages), false>                            \
        <<<grid, block, smem_max_size>>>(                                      \
            reinterpret_cast<float *>(a.data_ptr()),                           \
            reinterpret_cast<float *>(b.data_ptr()),                           \
            reinterpret_cast<float *>(c.data_ptr()), M, N, K);                 \
  }

// 128x128 w/o dynamic smem
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages(torch::Tensor a, torch::Tensor b,
                                               torch::Tensor c, int stages,
                                               bool swizzle,
                                               int swizzle_stride) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)

  const int Na = M * K;
  const int Nb = K * N;
  constexpr int T = 256;

  f32x4_tf32x4_kernel<<<((Na + T * 4 - 1) / (T * 4)), T>>>(
      reinterpret_cast<float *>(a.data_ptr()),
      reinterpret_cast<float *>(a.data_ptr()), Na);

  f32x4_tf32x4_kernel<<<((Nb + T * 4 - 1) / (T * 4)), T>>>(
      reinterpret_cast<float *>(b.data_ptr()),
      reinterpret_cast<float *>(b.data_ptr()), Nb);

  constexpr int WMMA_M = 16;
  constexpr int WMMA_N = 16;
  constexpr int WMMA_K = 8;
  constexpr int WMMA_TILE_M = 4;
  constexpr int WMMA_TILE_N = 2;
  constexpr int WARP_TILE_M = 2;
  constexpr int WARP_TILE_N = 4;
  // s_a 2 ways bank conflicts within warp, after pad 4 -> 2 ways bank
  // conflicts. s_b 8 ways bank conflicts within warp, after pad 4 -> 4 ways
  // bank conflicts. so, the best padding policy for s_a and s_b is A_PAD=0,
  // B_PAD=0/4/8. B_PAD consume 16x~ less smem than A_PAD, 8xB_PAD vs 128xA_PAD.
  constexpr int A_PAD = 0;
  constexpr int B_PAD = 0;
  constexpr int NUM_THREADS =
      (WMMA_TILE_M * WMMA_TILE_N * WARP_SIZE); // 2 * 4 * 32 = 256
  constexpr int BM = WMMA_M * WMMA_TILE_M * WARP_TILE_M;
  constexpr int BN = WMMA_N * WMMA_TILE_N * WARP_TILE_N;
  constexpr int BK = WMMA_K;
  // s2: 2*128*(8)*4=8KB,  2*8*(128+0~4)*4=8.25KB,   12~13KB
  // s3: 3*128*(8)*4=12KB, 3*8*(128+0~4)*4=12.375KB, 24~25KB
  // s4: 4*128*(8)*4=16KB, 4*8*(128+0~4)*4=16.5KB,   32~33KB

  if (swizzle) {
    assert(swizzle_stride % 256 == 0);
    switch (stages) {
    case 2:
      LAUNCH_16168_STAGE_SWIZZLE_KERNEL(2, swizzle_stride);
      break;
    case 3:
      LAUNCH_16168_STAGE_SWIZZLE_KERNEL(3, swizzle_stride);
      break;
    case 4:
      LAUNCH_16168_STAGE_SWIZZLE_KERNEL(4, swizzle_stride);
      break;
    default:
      LAUNCH_16168_STAGE_SWIZZLE_KERNEL(2, swizzle_stride);
      break;
    }
  } else {
    switch (stages) {
    case 2:
      LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(2);
      break;
    case 3:
      LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(3);
      break;
    case 4:
      LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(4);
      break;
    default:
      LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(2);
      break;
    }
  }
}

// 128x128 with dynamic smem
void sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem(torch::Tensor a,
                                                     torch::Tensor b,
                                                     torch::Tensor c,
                                                     int stages, bool swizzle,
                                                     int swizzle_stride) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)

  const int Na = M * K;
  const int Nb = K * N;
  constexpr int T = 256;

  f32x4_tf32x4_kernel<<<((Na + T * 4 - 1) / (T * 4)), T>>>(
      reinterpret_cast<float *>(a.data_ptr()),
      reinterpret_cast<float *>(a.data_ptr()), Na);

  f32x4_tf32x4_kernel<<<((Nb + T * 4 - 1) / (T * 4)), T>>>(
      reinterpret_cast<float *>(b.data_ptr()),
      reinterpret_cast<float *>(b.data_ptr()), Nb);

  constexpr int WMMA_M = 16;
  constexpr int WMMA_N = 16;
  constexpr int WMMA_K = 8;
  constexpr int WMMA_TILE_M = 4;
  constexpr int WMMA_TILE_N = 2;
  constexpr int WARP_TILE_M = 2;
  constexpr int WARP_TILE_N = 4;
  // s_a 2 ways bank conflicts within warp, after pad 4 -> 2 ways bank
  // conflicts. s_b 8 ways bank conflicts within warp, after pad 4 -> 4 ways
  // bank conflicts. so, the best padding policy for s_a and s_b is A_PAD=0,
  // B_PAD=0/4/8. B_PAD consume 16x~ less smem than A_PAD, 8xB_PAD vs 128xA_PAD.
  constexpr int A_PAD = 0;
  constexpr int B_PAD = 0;
  constexpr int NUM_THREADS =
      (WMMA_TILE_M * WMMA_TILE_N * WARP_SIZE); // 2 * 4 * 32 = 256
  constexpr int BM = WMMA_M * WMMA_TILE_M * WARP_TILE_M;
  constexpr int BN = WMMA_N * WMMA_TILE_N * WARP_TILE_N;
  constexpr int BK = WMMA_K;
  // s2: 2*128*(8)*4=8KB,  2*8*(128+0~4)*4=8.25KB,   12~13KB
  // s3: 3*128*(8)*4=12KB, 3*8*(128+0~4)*4=12.375KB, 24~25KB
  // s4: 4*128*(8)*4=16KB, 4*8*(128+0~4)*4=16.5KB,   32~33KB

  if (swizzle) {
    assert(swizzle_stride % 256 == 0);
    switch (stages) {
    case 2:
      LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(2, swizzle_stride);
      break;
    case 3:
      LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(3, swizzle_stride);
      break;
    case 4:
      LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(4, swizzle_stride);
      break;
    case 5:
      LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(5, swizzle_stride);
      break;
    default:
      LAUNCH_16168_STAGE_SWIZZLE_DSMEM_KERNEL(2, swizzle_stride);
      break;
    }
  } else {
    switch (stages) {
    case 2:
      LAUNCH_16168_STAGE_NO_SWIZZLE_DSMEM_KERNEL(2);
      break;
    case 3:
      LAUNCH_16168_STAGE_NO_SWIZZLE_DSMEM_KERNEL(3);
      break;
    case 4:
      LAUNCH_16168_STAGE_NO_SWIZZLE_DSMEM_KERNEL(4);
      break;
    case 5:
      LAUNCH_16168_STAGE_NO_SWIZZLE_DSMEM_KERNEL(5);
    default:
      LAUNCH_16168_STAGE_NO_SWIZZLE_KERNEL(2);
      break;
    }
  }
}
```

</details>

### `sgemm.py`（benchmark）
<details>
<summary> sgemm.py </summary>

```python
import time
from functools import partial
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="sgemm_lib",
    sources=[
        "sgemm.cu",
        "sgemm_async.cu",
        "sgemm_wmma_tf32_stage.cu",
        "sgemm_cublas.cu",
    ],
    extra_include_paths=[
        "/home/amax01/miniconda3/envs/leetcuda/lib/python3.11/site-packages/nvidia/cublas/include",
    ],
    extra_ldflags=[
        "-L/home/amax01/miniconda3/envs/leetcuda/lib/python3.11/site-packages/nvidia/cublas/lib",
        "-lcublas",
    ],
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

MAX_TFLOPS = -1


def run_benchmark(
    perf_func: callable,
    a: torch.Tensor,
    b: torch.Tensor,
    tag: str,
    out: Optional[torch.Tensor] = None,
    stages: int = -1,
    swizzle: bool = False,
    swizzle_stride: int = 1,
    warmup: int = 2,
    iters: int = 20,
    show_all: bool = False,
):

    global MAX_TFLOPS

    M = a.size(0)
    K = a.size(1)
    N = b.size(1)

    if a.size(0) > 1024 or a.size(1) >= 1024 or b.size(1) > 1024:
        iters = 10

    if swizzle:
        # make swizzle stride as N/4 and multiples of 256
        swizzle_stride = int((int(N / 8) // 256) * 256)
        swizzle_stride = swizzle_stride if swizzle_stride >= 256 else 1
        swizzle = swizzle if swizzle_stride >= 256 else False
    else:
        swizzle_stride = 1  # means no thread block swizzle

    if stages:
        assert swizzle_stride is not None

    if out is not None:
        out.fill_(0)
    if out is not None:
        for i in range(warmup):
            if stages > 1:
                perf_func(a, b, out, stages, swizzle, swizzle_stride)
            else:
                perf_func(a, b, out)
    else:
        for i in range(warmup):
            _ = perf_func(a, b)

    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            if stages > 1:
                perf_func(a, b, out, stages, swizzle, swizzle_stride)
            else:
                perf_func(a, b, out)
    else:
        for i in range(iters):
            out = perf_func(a, b)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten()[:2].detach().cpu().numpy().tolist()[:3]
    out_val = [round(v, 8) for v in out_val]
    out_val = [f"{v:<12}"[:10] for v in out_val]
    TFLOPS = (2 * M * N * K) * 1e-9 / (mean_time)
    mean_time = str(f"{mean_time:<12}")[:8]
    swizzle_stride = "NOOP" if swizzle_stride == 1 else swizzle_stride

    # caculate TFLOPS improved.
    if TFLOPS > MAX_TFLOPS:
        if MAX_TFLOPS > 0:
            improve = ((TFLOPS - MAX_TFLOPS) / MAX_TFLOPS) * 100
            improve = round(improve, 2)
        else:
            improve = 0
        MAX_TFLOPS = TFLOPS
        print(
            f"{out_info:>35}: {out_val}, time:{mean_time}ms, "
            f"swizzle: {swizzle_stride:<4}, TFLOPS: {TFLOPS:<6.2f}(+{improve:.2f}%)"
        )
    else:
        print(
            f"{out_info:>35}: {out_val}, time:{mean_time}ms, "
            f"swizzle: {swizzle_stride:<4}, TFLOPS: {TFLOPS:<6.2f}"
        )
    if show_all:
        print(out)
    return out, mean_time


Ms = [4096, 8192, 16384]
Ns = [4096, 8192, 16384]
Ks = [2048, 4096, 8192]
MAX_M, MAX_N, MAX_K = 16384, 16384, 8192
# pre allocate for fast profiling.
A = torch.randn((MAX_M, MAX_K), dtype=torch.float).cuda()
B = torch.randn((MAX_K, MAX_N), dtype=torch.float).cuda()
C = torch.randn((MAX_M, MAX_N), dtype=torch.float).cuda()
torch.cuda.synchronize()

MNKs = [(M, N, K) for M in Ms for N in Ns for K in Ks]
for M, N, K in MNKs:
    MAX_TFLOPS = -1
    print("-" * 130)
    print(" " * 55 + f"M={M}, N={N}, K={K}")
    a = A[:M, :K].contiguous()
    b = B[:K, :N].contiguous()
    c = C[:M, :N].contiguous()
    torch.cuda.synchronize()

    # CUDA Cores FP32
    # run_benchmark(lib.sgemm_naive_f32, a, b, "f32(naive)", c)
    run_benchmark(lib.sgemm_t_8x8_sliced_k_f32x4, a, b, "f32x4(t8x8sk)", c)
    run_benchmark(lib.sgemm_t_8x8_sliced_k_f32x4_bcf, a, b, "f32x4(t8x8bcf)", c)
    run_benchmark(
        lib.sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf, a, b, "f32x4(t8x8dbuf)", c
    )
    run_benchmark(lib.sgemm_cublas, a, b, "f32(cublas)", c)
    run_benchmark(partial(torch.matmul, out=c), a, b, "f32_th")

    print("-" * 62 + "WMMA" + "-" * 64)
    # stage, thread block swizzle, dsmem
    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages,
        a,
        b,
        "tf32(mma2x4+warp2x4+stage3)",
        c,
        stages=3,
    )
    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages,
        a,
        b,
        "tf32(mma2x4+warp2x4+stage2)",
        c,
        stages=2,
    )

    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem,
        a,
        b,
        "tf32(mma2x4+...+stage3+dsmem)",
        c,
        stages=3,
    )
    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem,
        a,
        b,
        "tf32(mma2x4+...+stage2+dsmem)",
        c,
        stages=2,
    )

    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages,
        a,
        b,
        "tf32(mma2x4+...+stage3+swizzle)",
        c,
        stages=3,
        swizzle=True,
    )
    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages,
        a,
        b,
        "tf32(mma2x4+...+stage2+swizzle)",
        c,
        stages=2,
        swizzle=True,
    )

    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem,
        a,
        b,
        "tf32(...+stage3+dsmem+swizzle)",
        c,
        stages=3,
        swizzle=True,
    )
    run_benchmark(
        lib.sgemm_wmma_m16n16k8_mma4x2_warp2x4_stages_dsmem,
        a,
        b,
        "tf32(...+stage2+dsmem+swizzle)",
        c,
        stages=2,
        swizzle=True,
    )

    run_benchmark(lib.sgemm_cublas_tf32, a, b, "tf32(cublas+tf32)", c)
    torch.cuda.synchronize()
    print("-" * 130)
```

</details>

## 问题定义与记号

`C[M,N] = A[M,K] × B[K,N]`，全部 row-major（`A[m][k]` 地址 = `m*K + k`，见 09 篇的布局画法）。

```
          K                N
      ┌──────────┐    ┌──────────┐
   M  │    A     │ ×  │    B     │ =  C[M,N]
      └──────────┘    └──────────┘
                       K
C[m][n] = Σ_k A[m][k] * B[k][n]     ← 一个输出元素 = 一条 K 长度的点积
```

## 第 0 步：naive 版为什么慢到没法测

naive kernel（`sgemm_naive_f32_kernel`）每个线程算一个 `C[m][n]`，K 循环逐个乘加：

```c++
int n = blockIdx.x * blockDim.x + threadIdx.x;
int m = blockIdx.y * blockDim.y + threadIdx.y;
float psum = 0.0;
for (int k = 0; k < K; k++) {
  psum += a[m * K + k] * b[k * N + n];  // ← b 的访问：n 连续但 k 跳 N
}
```

benchmark 里 naive 直接被注释掉了，因为它慢到没法看。两个致命伤，都可以用 09 的标尺算出来：

**伤 1：A/B 完全没有复用。** 算 `C[m][n]` 要读 A 的一行（K 个）和 B 的一列（K 个）。相邻线程 `m, m+1` 各自读**同一列 B 的同一批元素**——每个数据从显存读了 M 次。GEMM 的本质矛盾：**计算量 O(M·N·K)，数据量只有 O(M·K + K·N)**，数据复用率是 K——naive 版把这个复用率完全浪费了。

**伤 2：B 的访问跨步 N。** warp 里相邻线程（n, n+1, ...）读 `b[k*N+n]` 连续，这半是 coalesced；但 k 每走一步，整条 warp 跳 N 个 float。加上每个元素被重复读 M 次，访存量爆炸。

一句话：naive 版是"每个输出元素独立算"，**没有任何分块（tiling）**。所有优化版本的故事，都是"把复用做进哪一层存储"。

## 第 1 步：Block Tile + K 分块——把复用做进 smem

（对应 `sgemm_sliced_k_f32_kernel`，BM=BN=BK=32）

第一个分块思想：**一个 block 负责 C 的一块 32×32，A/B 的对应块先搬进 smem，全 block 共享**。

```
C 全局视角 (M=96, N=64, BN=BM=32), grid=(2, 3) = 6 个 block, 每个 ★ 是 1 个 block 的 32×32 输出:
                      bx=0               bx=1
                  (col 0..31)        (col 32..63)
                ┌───────────────┬───────────────┐ ← N 方向
by=0(row=0..31) │       ★      │       ★      │   bx 是 N 维
                ├───────────────┼───────────────┤
by=1(row=32..63)│       ★      │       ★      │   by 是 M 维
                ├───────────────┼───────────────┤
by=2(row=64..95)│       ★      │       ★      │
                └───────────────┴───────────────┘
    ↑
   M 方向
```

每个 block 内部放大来看, 就是接下来 `sgemm_t_8x8_sliced_k_f32x4_kernel` 那种 128×128 block + 8×8 thread tile 的样子——32×32 是这里的最小教学版 (256 线程一人 1 元素).

**这个 block 一次的 K 步循环要的是 A 和 B 的"对应 32×32 块"**:

```
A 的 32×32 块:  M[by*BM..by*BM+31]  ×  K[k*32..k*32+31]    ← 沿 K 切片循环, 每次取一段
B 的 32×32 块:  K[k*32..k*32+31]  ×  N[bx*BN..bx*BN+31]    ← 共享 K 维坐标
                ↑                  ↑
                同 32 列 K 元素     块内 32 个 block 列共享 A 行
```

**数字账**（K=4096, N=4096, 不分块 vs 分块后，对 A 而言）：
- naive：A 的一行被读 N 次（每列一个线程各自读）→ A 总读取量 = M·K·N
- 分块后：A 的一个 32×32 块进 smem，被 block 内 32 列的计算共享 → A 总读取量 = M·K·(N/32)，**降 32 倍**

kernel 主循环骨架：

```c++
__shared__ float s_a[BM][BK], s_b[BK][BN];   // 32x32 两块 = 8KB
for (int bk = 0; bk < (K + BK - 1) / BK; ++bk) {
  s_a[...] = a[...];  s_b[...] = b[...];      // 256 线程各搬 1 个
  __syncthreads();
  for (int k = 0; k < BK; ++k)
    sum += s_a[...][k] * s_b[k][...];        // 全部从 smem 读
  __syncthreads();                            // ← 下轮覆写前必须等所有人用完
}
```

两个 `__syncthreads()` 画出的就是流水线节拍：**加载 → 同步 → 计算 → 同步 → 加载...**。同一时刻 block 要么全员搬数据、要么全员算——加载和计算**串行**。这个"串行"就是第 3 步 double buffer 要杀的东西。

这个版本还有一个隐患：每线程只算 1 个输出元素，256 线程只覆盖 32×32 块，**线程的计算密度太低**——每搬 2 个数据（A 一个 + B 一个）才发 1 次乘加。计算/访存指令比太差。

## 第 2 步：Thread Tile——每线程 8×8，提高计算密度

（对应 `sgemm_t_8x8_sliced_k_f32x4_kernel`，BM=BN=128, BK=8, TM=TN=8——benchmark 的 t8x8sk）

两个改动同时上：

**改动 1：block 变大**（32×32 → 128×128），但 block 还是 256 线程（16×16 排布）。

**改动 2：每个线程负责 8×8=64 个输出**，而不是 1 个：

```
128×128 的 C 块, 由 16×16 线程网格覆盖, 每人 8×8:
      tx=0      tx=1     ...tx=15
      ┌────────┬────────┬────────┬
ty=0  │ 8×8    │  8×8   │        │     线程(ty,tx)负责的行:
      ├────────┼────────┼────────┬         m ∈ [ty*8, ty*8+8)
ty=1  │        │        │        │     列: n ∈ [tx*8, tx*8+8)
      └────────┴────────┴────────┴
```

计算密度账：smem 里的 A 块是 `128×8`，每线程从 A 取 8 个、B 取 8 个，发 64 次乘加——**每 2 次访存（smem）对 64 次计算**，和第 1 步的 2:1 完全反转。指令代码：

```c++
float r_c[TM][TN] = {0.0};                    // 64 个累加器在寄存器
for (int k = 0; k < BK; k++) {
  for (int m = 0; m < TM; m++)
    for (int n = 0; n < TN; n++)
      r_c[m][n] += s_a[ty*TM + m][k] * s_b[k][tx*TN + n];
}
```

**寄存器压力**（这个数字要记——它解释了为啥不能再堆 thread tile）：`r_c[8][8]` = 64 个 float 累加器是固定的，加载/计算临时变量大概再 20 个，每线程 ~80 个 32bit 寄存器 = 320B 私有存储。**注意这是"每线程个数"，不是 smem 字节**——smem 是 block 共享的另一回事，256 线程都算 `r_c` 在物理上等价于 `256 × 64 × 4B = 64KB` 的"等量压力"分散在寄存器堆里。每线程 255 寄存器是硬件上限（Ampere 架构），80/255 = 31% 占用率；NVCC 看到大 `r_c` 后会降低 block 的 active warps（占用率掉），靠编译器调度填——所以 **TM/TN 不能再翻倍**，否则 8×8 → 16×8 等量翻倍就 256 个寄存器，硬件塞不下。

`r_c[8][8]` 的 64 元素在 NVCC 编译后大概率被 register file 实际占用 80~90 个（编译器临时变量 + spill 缓冲），这就是实测基线 **37 TFLOPS**（4096 组）的硬件原因之一——计算密度堆到这个份上, 寄存器/占用率开始反向咬性能, 再优化得换算法, 不只是改 tile 大小.

## 第 3 步：bcf——smem 转置 + padding 消 bank conflict

（`sgemm_t_8x8_sliced_k_f32x4_bcf_kernel`，benchmark +8~12%）

第 2 步埋的雷炸了：**计算时读 A 是按列读的**。`s_a[BM][BK]` 里 BK=8，同一列的 128 个元素彼此相隔 8 个 float——跨 stride 8 访问。bank 计算复习（09 篇）：bank = (地址/4) % 32。`s_a[m][k]` 和 `s_a[m+1][k]` 地址差 8×4=32 字节 = 差 8 个 bank。warp 内 16 个线程的 m 各不相同 → 地址差 8 bank → **每 4 个线程撞一个 bank**（32/8=4 路 conflict，warp 32 线程挤 8 个 bank × 4 层）。

修法**非对称**——A 改读布局、B 改写布局，两边各打各的雷：

**① A：转置存储修读端**。`s_a` 改成 `s_a[BK][BM]`（**下标反了**），加载时**多写一次转置**把数据从 `A[m][k]` 形态落到 `s_a[k][m]`；计算时 `s_a[k][m]` 是 k 固定、m 沿行内连续（stride 1）——32 线程读 32 个不同 bank，**零冲突**。**零存储浪费**：BK 还是 8 字节没膨胀。源码里 `s_a[load_a_smem_k + i][load_a_smem_m] = r_load_a[i]`（加载写转置）vs `FLOAT4(s_a[tk][ty * TM / 2])`（计算读转置后）就是同一组数据的两个面。

**② B：padding 修写端**。`s_b` 保持 `s_b[BK][BN]` 行主序（计算按行读本来就不冲突——stride 跨 BN 连续，32 线程命中 32 个不同 bank），但**装载阶段 32 线程各写一行**（k 变化、n 在 lane 间分裂）——同 warp 的 32 线程在 8 行里各占 1 行，**行距 = 128 字节 = 32 bank 一个完整周期**，又是 4 路 conflict。修法是行尾塞废位 `s_b[BK][BN+OFFSET]`：行距从 128 变 132 字节 = 33 bank 周期，**错开 1 bank**，写端冲突消失。**代价是真浪费 4×4=16B/行**，stage2 smem 多了 KB 级。

**为什么 A 不能也用 padding、B 不能也用转置**？这个非对称不是人为选择，是**问题形态本身决定的**：
- A 的"读 32 连续"和"写 32 连续"在**同一个维度**（都按 m 走）——能靠反转维度让读变连续，写也跟着重排一下就行，**零浪费**
- B 的"读 32 跨行"和"写 32 连续"在**不同维度**（读按 m 走、写按 k 走）——没法靠反转同时修两边，只能**错开物理位置**（padding），所以必然浪费

**这是 bank conflict 治理的"非对称修法"**：哪个维度冲突就修哪个维度, 零浪费的转置 vs 必须浪费的 padding 是同一种思维的两面。18 篇 swizzle 会再深挖：能不能 A/B 都不浪费？答案是能，但靠的是位运算重排、不是行级 padding——维度换了。

## 第 4 步：dbuf——double buffer，把串行流水线掰开

（`sgemm_t_8x8_sliced_k_f32x4_bcf_dbuf_kernel`，benchmark 再 +5~22%）

第 1 步结尾说过：加载和计算被两个 `__syncthreads()` 隔成串行节拍。图：

```
单 buffer:  [加载K0][barrier][算K0][barrier][加载K1][barrier][算K1]...
            ── 显存带宽闲着(算的时候) ──    ── 计算单元闲着(搬的时候) ──

double buffer (smem 开两份, ping-pong):
            [加载K1→buf1] 和 [算K0←buf0] 同时进行!
            [加载K2→buf0] 和 [算K1←buf1] 同时进行!
```

代码结构（也是学习模板级的三段式）：

```c++
// 预载 K=0 块进 buf0
load_global_to_smem(buf[0]);  __syncthreads();
for (bk = 1; bk < numK; bk++) {
  load_global_to_reg(r);                    // ① 先发起 K=bk 的 global→寄存器
  compute_from_smem(buf[(bk-1)&1]);         // ② 上一块数据开算（用另一个 buffer）
  store_reg_to_smem(buf[bk&1]);             // ③ ①的数据落进刚空出来的 buffer
  __syncthreads();
}
compute_from_smem(buf[last]);               // 尾块单独算
```

三个细节值得抠：

1. **为什么要过寄存器**（①和③分开）：如果直接 global→smem 写入 `buf[bk&1]`，写 smem 和算 smem 虽然是不同 buffer，但 `__syncthreads()` 之前发起的 global load 是异步的，直接写会被编译器插同步。先到寄存器再落地，让 global→寄存器的延迟和 ② 的计算重叠。
2. **`(bk-1)&1` 和 `bk&1`**：两块 smem 交替使用的开关，位运算取模。
3. **尾块处理**：循环只跑到倒数第二块，最后一块没有"下一块可预载"，单独收尾。（我修过这个 kernel 里的一个上游 bug：尾块选 buffer 的索引写错了 parity——double buffer 的 off-by-one 都藏在这。）

这一步之后 **41.9 TFLOPS**，手写 CUDA Core 版到顶了。离 cuBLAS F32 还差 20%——这 20% 不是算法问题，是**下一层硬件根本没用上**。

## 第 5 步：换武器——TF32 + WMMA Tensor Core

（`sgemm_wmma_tf32_stage.cu`，一跳到 59~60 TFLOPS）

到这里为止，所有乘加都跑在 **CUDA Core** 上——就是普通 FFMA 指令，1 周期 1 次乘加。4090 的 FP32 理论峰值 82.6 TFLOPS，CUDA Core 路线 41.9 已经是这种路线的极限表演。但 4090 还有另一套硬件：**Tensor Core**——专门为矩阵乘设计的单元，TF32 模式下吞吐直接翻倍以上。

**先讲清三个新概念的层次**（容易混）：

| 概念 | 是什么 | 作用层 |
|---|---|---|
| **TF32** | 19 位浮点（1+8+10），尾数比 FP32 短 13 位 | 精度等级——和 FP32/BF16/FP16 并列 |
| **WMMA** | `nvcuda::wmma` C++ API | 软件层——提供 fragment/load/mma/store 接口 |
| **mma** | 硬件指令 `mma.sync.aligned.m16n16k8` | 硬件层——真正在 Tensor Core 上跑的指令 |

WMMA 是 API、mma 是指令——WMMA 内部**最终还是编译成 mma.sync 指令**，但帮你把 fragment 布局、寄存器映射、lane 调度都管了。TF32 是这一组支持的精度档（硬件 mma.sync 还支持 fp16、int8、bf16 等，15 篇只切 TF32 这条路）。

**TF32 是什么精度**（先别急着写代码）：19 位浮点（1+8+10，尾数比 FP32 短 13 位），范围和 FP32 一样（同 8 位指数）、精度略降（10 位尾数 vs FP32 的 23 位）。数值对比：`out_f32 = -2.2519135` vs `out_tf32 = -2.2517733`——差在尾数第 5 位，对绝大多数场景够用。这也是为什么 benchmark 里 WMMA 版的输出值和 CUDA Core 版不完全一样。

**WMMA 的 fragment——本节最重要的"新东西"**：

```c++
wmma::fragment<wmma::matrix_a, 16, 16, 8, wmma::precision::tf32, ...> a_frag;
wmma::fragment<wmma::matrix_b, 16, 16, 8, wmma::precision::tf32, ...> b_frag;
wmma::fragment<wmma::accumulator, 16, 16, 8, float, ...> c_frag;
```

fragment **不是数据本身**, 是"声明一块 16×16×8 矩阵的存储, 由 32 个 lane 共同持有, 每人领到几份"——具体怎么领, 文档/编译器决定. 这就是 fragment 的**黑盒性**: 32 线程各持有 16×16×8 矩阵的哪些部分, 你无法直接看到, 也无法在 fragment 上做标量后处理(比如对结果做逐元素转置), 必须先 `store_matrix_sync` 写回 smem/gmem. 后面 17 篇讲裸 mma.sync 时, 这层黑盒会被掀开——但 15 篇先接受它, 是"用 WMMA"和"懂 Tensor Core"的过渡.

**mma_sync 到底干了什么, 看代码**：

```c++
wmma::load_matrix_sync(a_frag, &s_a[...][0], BK + A_PAD);  // 1. 整块从 smem 装载, 自动分配给 32 线程
wmma::load_matrix_sync(b_frag, &s_b[0][...], BN + B_PAD);
wmma::mma_sync(c_frag, a_frag, b_frag, c_frag);            // 2. 一条指令: C[16x16] += A[16x8] × B[8x16]
```

第 2 行就是核心. 一条 `mma_sync` 完成 **16×16×8 = 2048 次乘加**. 对照上一版: 那个 kernel 每线程算 8×8=64 个累加器, 64 条 FFMA 指令; 现在**一个 warp 32 线程合发一条 mma_sync, 物理上还是 2048 次 FFMA, 但指令发射只占 1 条**. 关键不是"硬件变快了", 是**指令发射带宽不再是瓶颈**——C 代码 60 行 WMMA 调用背后是几百条 mma.sync, 但发射数 (issue) 少得多, 调度器没那么挤.

**算力密度** vs **指令密度** 的区别, 是这一节的认知升级:
- 上一版 37 TFLOPS = 64 FFMA × N次循环, 每条指令都"认真"在算
- WMMA 60 TFLOPS = mma_sync 把 2048 个 FFMA 打包成 1 条, 算力密度高 32 倍 (256/8, 因为 WMMA atom 是 16×16×8 vs 上一版的 1×1 标量)

**WMMA 后瓶颈翻转**——之前 4 步所有的"提高算力密度"手段 (tiling / thread tile / bcf / dbuf) 全都"让计算更密"; 现在 60 TFLOPS 已经吃满 Tensor Core 算力的 ~75%, 算力这一侧没空间了, 瓶颈**翻到数据通路**: 喂不进 mma_sync, 算力也空转. 所以这版 kernel 的所有优化全在数据侧:

- **cp.async** (sm_80+ 新指令): `cp.async.cg.shared.global` 异步从 gmem 装到 smem, **不用过寄存器**——上一版 dbuf 必须 `gmem→reg→smem` 两跳, cp.async 直接 `gmem→smem` 一跳, 硬件后台搬运, 同步靠 `commit_group/wait_group` 配对. dbuf 的"寄存器中转"被硬件指令取代, 寄存器压力骤降
- **多级 stage** (K_STAGE=2/3/4): double buffer 推广成 N 级流水线. K_STAGE=3 意思是"算第 k 块时, k+1 已经在 smem, k+2 在路上". 实测 stage2 > stage3 > stage4 (4090 这里是 stage2 最优, smem 容量限制下多 stage 收益递减)
- **dsmem (dynamic shared memory)**: stage 多就要大 smem, A100+ 上 100KB+ 必须用 `extern __shared__` 动态分配, 编译期不够装
- **block swizzle** (L2 调度重排): 9 个 block 拼成"bx 优先"顺序, 让同时驻留的 block 全读同一批 A 行, 命中 L2 命中率高; 16/19 篇会再展开

**分形结构** (这套世界观贯穿 17/19 篇):

```
Block 128×128 ← grid 切
  └ Warp 2×4=8 个, 各负责 32×64   ← 8 warp 均分 block 输出
      └ mma tile: 4×2 个 16×16    ← warp 内再切 mma 指令块
          └ 每 mma 16×16×8 TF32   ← Tensor Core 一口吞
```

**和前 4 步的世界观**对比: t8x8sk 那步是 "256 线程 × 8×8 thread tile × 1 个 FFMA/条"; 这里是 "8 warp × 4×2 mma tile × 1 个 mma_sync 顶 2048 FFMA/条". 数据从"标量"到"fragment"再变成"张量", **计算的抽象层次一升, 数据通路的优化就接踵而来**——17 篇 hgemm 还会再升级, 把 mma.sync 当成"原子操作", 围绕它做更精细的布局.

## 第 6 步：cuBLAS 差距盘点

**cuBLAS 是什么**（先讲明白是什么再列差距）：NVIDIA 官方闭源 BLAS 库，PyTorch `torch.matmul` 底层就是它——业内所有 GPU 算子库的"事实天花板"。它和手写版走的是**同一条硬件路径**（同样用 4090 的 Tensor Core，同样 mma.sync 指令），区别是 NVIDIA 自己写、最优调参、闭源 SASS 手排——我们拿它的 TF32 数字当"硬件极限"基线。

**TF32 模式**：cuBLAS 默认走的是"math mode = CUBLAS_TF32_TENSOR_OP_MATH"——和 15 篇手写 TF32 是同一条 mma 路径，只是 cuBLAS 把 tile 大小、stage 数、swizzle 都按形状动态调优。74.3 TFLOPS 不是 "cuBLAS 神奇", 是它把同样的 mma.sync 排得更紧。

最终表（8192×8192×4096）：

| 配置 | TFLOPS | 说明 |
|---|---|---|
| t8x8sk → bcf → dbuf | 36.6 → 39.6 → 41.9 | CUDA Core 手写全链路 |
| WMMA stage2 | 59.4 | Tensor Core 入门版 |
| WMMA stage2+swizzle | **60.0** | 手写最优 |
| **cuBLAS TF32** | **74.3** | **差距 24%**（同硬件, 闭源 SASS 手排） |

还差的 24% 在哪（诚实盘点，不装懂）：
1. **调度与调参**：cuBLAS 对每个形状会选不同 tile 配置/流水级数，手写版是固定模板——8192 和 4096 的最优 (BM,BN,BK,stage) 不一样
2. **SASS 级指令调度**：cuBLAS 的内联 PTX 经过手工调序，寄存器 bank、发射双端口都吃满；WMMA 接口离底层还有一层
3. **TF32 之上的路径**：cuBLAS 可能走了更激进的路径（如分 K 并行 + epilogue 融合）

17 篇（hgemm）会绕过 WMMA 直接写 **MMA PTX**——那是把第 2 条差距也吃掉的路，敬请期待。

## 编译与实测环境

4090（sm_89），leetcuda env，`TORCH_CUDA_ARCH_LIST=8.9` JIT 编译。注意两个坑：
1. `sgemm.py` 一次 JIT 编 4 个 .cu（含 wmma），首次编译数分钟属正常
2. `sgemm_cublas.cu` 找不到 `cublas_v2.h` 时，要在 `load()` 里补 conda pip 包的 include/lib 路径（`nvidia/cublas/include` + `nvidia/cublas/lib`）

数据均为 27 组形状（M,N,K ∈ 4096/8192/16384 组合）实测，表中取 8192×8192×4096 代表组，完整 27 组见 benchmark 输出。

## 本篇小结

1. **GEMM 的本质是数据复用**：计算 O(M·N·K) vs 数据 O(M·K+N·K)，复用率 K——naive 把复用全浪费，tiling 把复用做进 smem（block tile 32×32 降 A 读取量 32 倍）
2. **计算密度决定每线程产量**：thread tile 8×8 让每 2 次 smem 访问对 64 次乘加，但撞上 bank conflict（按列读 stride=BK）
3. **bcf 双修**：smem 转置存储（读连续）+ padding（错 bank）——09 的转置/padding 手法在 GEMM 里的直接应用，+8%
4. **dbuf 藏流水的延迟**：双 buffer + 寄存器中转，加载和计算重叠，+5~22%；循环三段式（发起/计算/落地）是所有流水线 kernel 的模板
5. **Tensor Core 是断崖不是渐进**：CUDA Core 41.9 → WMMA 59.4，一条 mma_sync 顶 2048 次乘加；瓶颈从计算翻转到喂数据，于是 cp.async/多级 stage/swizzle 全是数据通路优化
6. **离 cuBLAS 还差 24%**：调度调参 + SASS 级手工——17 篇用纯 MMA PTX 继续追
