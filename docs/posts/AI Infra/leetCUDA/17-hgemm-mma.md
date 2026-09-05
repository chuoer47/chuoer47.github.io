---
title: HGEMM (WMMA & MMA PTX)
order: 17
---

# HGEMM：WMMA 与 MMA PTX 代码学习

> 本人学习笔记，AI总结

15 篇 SGEMM 的终点是 WMMA TF32 打到 60 TFLOPS（cuBLAS 的 80%），并把最后的差距归因为"WMMA 接口离底层还有一层"。本篇就来拆这层：用 FP16 数据 + **裸 MMA PTX 指令**写 HGEMM，4090 实测能打到 **150+ TFLOPS**（cuBLAS 的 98%+）——15 篇欠的债在这里还清。

实测数据（RTX 4090，三版 MMA kernel，方阵，W=1/R=1 取三轮均值）：

| 形状 | mma_tn（基础版） | + smem swizzle | + A&B swizzle x4 |
|---|---|---|---|
| 2048³ | 122.7 | **130.8** | 122.2 |
| 4096³ | 145.8 | 148.5 | **149.7** |
| 8192³ | 153.1 | 151.9 | **154.7** |
| 12288³ | 148.6 | 147.3 | **150.0** |
| 16384³ | 155.9 | 154.3 | 155.0 |

4090 的 FP16 Tensor Core 理论峰值 ~165 TFLOPS（F16 acc）——手写版在 8192³ 打到峰值的 **94%**。先看这一篇要拆的三个新名词：**ldmatrix、mma.sync、smem swizzle**。

## 从 WMMA 到 MMA PTX：差的那一层是什么

15 篇的 WMMA 是"黑盒 wmma API"：`load_matrix_sync` 装 fragment、`mma_sync` 计算、`store_matrix_sync` 落盘。方便，但两个代价：

1. **fragment 是黑盒**。数据在 32 个线程的寄存器里怎么分布，API 不告诉你——你无法在 fragment 上做任何后处理（比如直接在寄存器里对结果做缩放/转置），必须先 store 出去。
2. **指令固定**。WMMA 的最小单元是 `16×16×16`，而硬件 MMA 指令实际支持 `m16n8k16`——WMMA 内部要拼两条硬件指令，寄存器布局不由你控制。

裸 MMA PTX 把这层拆开：**直接写 `mma.sync.aligned.m16n8k16` 指令，自己管理每个线程的寄存器布局**。代价是所有布局 gymnastics 都要手写，收益是布局完全受控——FA2（20 篇）里"softmax 结果直接喂回 MMA"这种操作，只有裸 MMA 才做得顺。

## 核心指令一：ldmatrix——为 mma 量身定做的 smem→reg 搬运

15 篇 WMMA 版从 smem 装载靠 `load_matrix_sync`（黑盒）。裸 MMA 版的装载指令是 **`ldmatrix`**：一条 warp 级指令，从 smem 一次搬 8×8 的 b16 矩阵块到寄存器，**并且搬完的寄存器布局恰好是 mma.sync 要的布局**。

```
LDMATRIX_X4: 一个 warp 32 线程, 每人出 1 个 smem 地址 (指向 8 个 half 的行首)
             → 一次搬 4 个 8x8 块, 每线程分到 4 个 32bit 寄存器 (每寄存器 2 个 half)
             
             关键: 这 4 个寄存器里的 half 位置, 正好是 mma.sync.m16n8k16
                   期望该 lane 持有的 A 片段 —— ldmatrix 和 mma 是配套设计
```

源码里的调用（A 矩阵装载，`hgemm_mma_stage_tn.cu:241`）：

```c++
int lane_smem_a_m = warp_smem_a_m + lane_id % 16;  // lane 0~15 → m, 16~31 → m+? 
int lane_smem_a_k = (lane_id / 16) * 8;            // lane 0~15 管 k 0~7, 16~31 管 k 8~15
uint32_t lane_smem_a_ptr = ...(smem_a_base_ptr +
    (smem_sel * s_a_stage_offset + lane_smem_a_m * (BK + A_PAD) + lane_smem_a_k) * sizeof(half));
LDMATRIX_X4(RA[i][0], RA[i][1], RA[i][2], RA[i][3], lane_smem_a_ptr);
```

注意 A 的 **TN 布局处理**：本 kernel 是 TN（A row-major、B col-major、C row-major），B 在 smem 里存成 `s_b[BN][BK]`（转置存储，和 15 篇 bcf 的手法同源），装载 B 用 `LDMATRIX_X2`（B 只要 m16n8k16 的 N=8 宽，2 个 8×8 块）。

## 核心指令二：mma.sync.m16n8k16——比 WMMA 小一半的原子操作

```c++
// 一个 warp 一条指令: C[16x8] += A[16x16] × B[16x8]
// A: 4 个 32bit reg / lane (每 reg 装 2 个 half)
// B: 2 个 32bit reg / lane
// C: 2 个 32bit reg / lane (每 reg 装 2 个 half —— 注意 f16 acc 时 C 也是 half!)
HMMA16816(RC[i][j][0], RC[i][j][1], RA[i][0], RA[i][1], RA[i][2], RA[i][3],
          RB[j][0], RB[j][1], RC[i][j][0], RC[i][j][1]);
```

数字感受：一条 warp 指令 = 16×8×16 = **2048 次乘加**（和 15 篇 WMMA 的 m16n16k16=4096 同量级，但单元更小、布局可控）。乘加吞吐 F16→F16 在 4090 上是 ~165 TFLOPS——这就是"换武器"的完整威力：15 篇 TF32 WMMA 60 TFLOPS → 裸 MMA F16 150 TFLOPS，2.5 倍。

**精度警告**（15 篇提过，这里实测兑现）：`f16.f16.f16.f16` 尾缀 = 累加器也是 half。K 很长时 f16 累加会溢出/失真——所以 error check 显示小形状 Max Error = 0，但生产代码要用 `f16.f16.f32.f32`（FP32 累加，吞吐减半但精度保住）。LeetCUDA 的 FA2（20 篇）统一用 FP32 acc，原因同此（softmax 的分母/减 max 必须全精度）。

## 分形结构升级：MMA=2x4, WARP=4x4

15 篇的结构是 Block→Warp→mmaTile。本 kernel 的配置：

```
Block 128×128 (8 warps, 256 threads)
  └ warp_m = warp_id % 2  → 2 行 × 4 列 = 8 warp, 每个管 64×32
      └ MMA tile: 4×4 个 m16n8k16   (WARP_TILE_M=4, WARP_TILE_N=4)
          └ 64×32 输出 / warp
```

参数连乘关系（这组数字贯穿 17~19 篇）：

```
BM = MMA_M × MMA_TILE_M × WARP_TILE_M = 16×2×4 = 128
BN = MMA_N × MMA_TILE_N × WARP_TILE_N =  8×4×4 = 128
BK = MMA_K = 16
寄存器: RC[4][4][2] = 32 个 32bit + RA[4][4] + RB[4][2] = 56 个 32bit ≈ 56 regs
```

`RC` 32 个累加寄存器 vs 15 篇 CUDA Core 版的 64 个 float——**寄存器压力减半**（half 累加器一个 32bit reg 装两个），这正是能堆 4×4 MMA tile 的原因。

## 主循环：cp.async 三段式（15 篇 dbuf 的硬件版）

15 篇 dbuf 用"global→reg→smem"两跳藏延迟；本 kernel 用 `cp.async` 直连 + 多级 stage（15 篇 WMMA 版已引入，这里结构完全一致，复习关键点）：

```c++
// 预载: 前 K_STAGE-1 块用 cp.async 直接 gmem→smem, commit 成组
for (k = 0; k < K_STAGE-1; k++) {
  CP_ASYNC_CG(smem_ptr(k), &A[...], 16);   // 16 字节 = 8 个 half
  CP_ASYNC_COMMIT_GROUP();
}
CP_ASYNC_WAIT_GROUP(K_STAGE - 2);           // 等 K_STAGE-2 组, 手里留 1 组在路上
__syncthreads();

// 主循环: 发起下一块 → 用当前块算 → 等待
for (k = K_STAGE-1; k < NUM_K_TILES; k++) {
  CP_ASYNC_CG(smem_ptr_next, ...);          // ① k+2 块开始搬运
  CP_ASYNC_COMMIT_GROUP();
  LDMATRIX_X4(RA, s_a[cur]);                // ② 当前块 smem→reg (配套布局)
  LDMATRIX_X2(RB, s_b[cur]);
  HMMA16816(RC, RA, RB, RC);                // ③ 计算
  CP_ASYNC_WAIT_GROUP(K_STAGE - 2);         // ④ ①完成了吗
  __syncthreads();
}
```

和 15 篇的关键差异点：**寄存器双缓冲消失了**。15 篇 dbuf 必须 global→reg→smem 是因为普通 load 是同步指令（阻塞到数据到位）；`cp.async` 是真异步——发起后硬件自己搬，CPU（GPU core）继续跑——所以"下一块的数据在路上"这件事硬件白送，不需要寄存器中转站。

**cp.async 的 ca/cg 之分**（源码注释原文）：`ca` = cache all（L1+L2），支持 4/8/16 字节；`cg` = cache global（只 L2），只支持 16 字节。GEMM 的装载没有数据复用（每块数据只用一次），走 L1 纯浪费——**用 cg**。

## 收尾：warp shuffle 版 collective store

MMA 的输出 RC 布局：每 lane 持有 C 的 2×2 个位置（碎片化），直接写 gmem 是散的。收尾用 **`__shfl_sync` 在 warp 内收集**：4 个 lane 的碎片拼成 8 half 连续段，`LDST128BITS` 一条 128bit 指令写出（源码 322~358 行，注释原文："How to use LDST128BITS here? __shfl_sync -> lane 0 -> store 8 half. thus, we only need 8 memory issues with 128 bits"）。

对照 15 篇：WMMA 版收尾用 `store_matrix_sync`（黑盒）+ 直接散写；本版手排 shuffle 把写端也做成 coalesced 128bit——**卸下黑盒后每个环节都能手动优化**，这就是那 20% 差距的来源。

## swizzle 版：B 的 smem swizzle（18 篇的主角，这里先预告）

基础版 A_PAD=B_PAD=0——smem 装载和 ldmatrix 读取都可能有 bank conflict。实测加 smem swizzle 后小形状提升明显（2048³: 122.7→130.8），大形状几乎持平（计算太稠密，冲突被掩盖）。机理（swizzle 位运算怎么做到"零 padding 零冲突"）是 18 篇的主菜，本篇先埋个钩子。

## 编译实录（本篇的隐藏知识点）

`make mma_tn_89` 在我们的 4090 环境上连环踩了 5 个坑（每个都是 conda 环境和 makefile 假设的系统 CUDA 安装打架）：

| 坑 | 报错 | 解法 |
|---|---|---|
| 1 | `nvcc: 没有那个文件或目录` | nohup 环境无 conda，显式 PATH |
| 2 | `cublas_v2.h: No such file` | conda 的 cublas 在 pip 包里，`CPATH` 补 include |
| 3 | `unsupported GNU version! gcc 14` | `-ccbin` 指 conda 的 gcc-13 |
| 4 | `cannot find -lcudadevrt/-lcudart_static` | conda 装的 CUDA 没带静态库，`--cudart shared` 走动态 |
| 5 | `undefined reference to fmaxf/cudaEventDestroy` | conda sysroot 的 ld 挑剔，补 `-lm -lstdc++ -lcudart` |

最终形态是一个 nvcc wrapper 脚本（`--cudart shared -lm -lstdc++ -lcudart`）+ 三个环境变量。**教学价值**：makefile 型项目假设"系统级 CUDA 安装"（/usr/local/cuda 有全套静态库），而 conda 环境是"散装的"（cublas 在 pip 包、只有动态 cudart）——两种世界观打架时，wrapper 比改 makefile 干净（不用动上游代码，将来好提 PR）。

## 完整代码

### `hgemm_mma_stage_tn.cu`（基础 MMA TN 版）
<details>
<summary> hgemm_mma_stage_tn.cu </summary>

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
// gmem -> smem
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
// smem -> gmem: requires sm_90 or higher.
#define CP_ASYNC_BULK_COMMIT_GROUP()                                           \
  asm volatile("cp.async.bulk.commit_group;\n" ::)
#define CP_ASYNC_BULK_WAIT_ALL() asm volatile("cp.async.bulk.wait_all;\n" ::)
#define CP_ASYNC_BULK_WAIT_GROUP(n)                                            \
  asm volatile("cp.async.bulk.wait_group %0;\n" ::"n"(n))
#define CP_ASYNC_BULK(dst, src, bytes)                                         \
  asm volatile(                                                                \
      "cp.async.bulk.global.shared::cta.bulk_group.L2::128B [%0], [%1], "      \
      "%2;\n" ::"r"(dst),                                                      \
      "l"(src), "n"(bytes))
// ldmatrix
#define LDMATRIX_X1(R, addr)                                                   \
  asm volatile("ldmatrix.sync.aligned.x1.m8n8.shared.b16 {%0}, [%1];\n"        \
               : "=r"(R)                                                       \
               : "r"(addr))
#define LDMATRIX_X2(R0, R1, addr)                                              \
  asm volatile("ldmatrix.sync.aligned.x2.m8n8.shared.b16 {%0, %1}, [%2];\n"    \
               : "=r"(R0), "=r"(R1)                                            \
               : "r"(addr))
#define LDMATRIX_X4(R0, R1, R2, R3, addr)                                      \
  asm volatile(                                                                \
      "ldmatrix.sync.aligned.x4.m8n8.shared.b16 {%0, %1, %2, %3}, [%4];\n"     \
      : "=r"(R0), "=r"(R1), "=r"(R2), "=r"(R3)                                 \
      : "r"(addr))
#define LDMATRIX_X1_T(R, addr)                                                 \
  asm volatile("ldmatrix.sync.aligned.x1.trans.m8n8.shared.b16 {%0}, [%1];\n"  \
               : "=r"(R)                                                       \
               : "r"(addr))
#define LDMATRIX_X2_T(R0, R1, addr)                                            \
  asm volatile(                                                                \
      "ldmatrix.sync.aligned.x2.trans.m8n8.shared.b16 {%0, %1}, [%2];\n"       \
      : "=r"(R0), "=r"(R1)                                                     \
      : "r"(addr))
#define LDMATRIX_X4_T(R0, R1, R2, R3, addr)                                    \
  asm volatile(                                                                \
      "ldmatrix.sync.aligned.x4.trans.m8n8.shared.b16 {%0, %1, %2, %3}, "      \
      "[%4];\n"                                                                \
      : "=r"(R0), "=r"(R1), "=r"(R2), "=r"(R3)                                 \
      : "r"(addr))
// stmatrix: requires sm_90 or higher.
#define STMATRIX_X1(addr, R)                                                   \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x1.m8n8.shared.b16 [%0], {%1};\n" ::"r"(addr),    \
      "r"(R))
#define STMATRIX_X2(addr, R0, R1)                                              \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x2.m8n8.shared.b16 [%0], {%1, %2};\n" ::"r"(      \
          addr),                                                               \
      "r"(R0), "r"(R1))
#define STMATRIX_X4(addr, R0, R1, R2, R3)                                      \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x4.m8n8.shared.b16 [%0], {%1, %2, %3, %4};\n" ::  \
          "r"(addr),                                                           \
      "r"(R0), "r"(R1), "r"(R2), "r"(R3))
#define STMATRIX_X1_T(addr, R)                                                 \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x1.trans.m8n8.shared.b16 [%0], {%1};\n" ::"r"(    \
          addr),                                                               \
      "r"(R))
#define STMATRIX_X2_T(addr, R0, R1)                                            \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x2.trans.m8n8.shared.b16 [%0], {%1, %2};\n" ::    \
          "r"(addr),                                                           \
      "r"(R0), "r"(R1))
#define STMATRIX_X4_T(addr, R0, R1, R2, R3)                                    \
  asm volatile(                                                                \
      "stmatrix.sync.aligned.x4.trans.m8n8.shared.b16 [%0], {%1, %2, %3, "     \
      "%4};\n" ::"r"(addr),                                                    \
      "r"(R0), "r"(R1), "r"(R2), "r"(R3))
// mma m16n8k16
#define HMMA16816(RD0, RD1, RA0, RA1, RA2, RA3, RB0, RB1, RC0, RC1)            \
  asm volatile(                                                                \
      "mma.sync.aligned.m16n8k16.row.col.f16.f16.f16.f16 {%0, %1}, {%2, %3, "  \
      "%4, %5}, {%6, %7}, {%8, %9};\n"                                         \
      : "=r"(RD0), "=r"(RD1)                                                   \
      : "r"(RA0), "r"(RA1), "r"(RA2), "r"(RA3), "r"(RB0), "r"(RB1), "r"(RC0),  \
        "r"(RC1))

HOST_DEVICE_INLINE
int div_ceil(int a, int b) { return (a % b != 0) ? (a / b + 1) : (a / b); }

// NN: A/B/C All row major
// TN: A row major MxK, B col major NxK, C row major MxN
// 128x128, mma2x4, warp4x4(64,32,16), stages, block swizzle, dsmem
template <const int MMA_M = 16, const int MMA_N = 8, const int MMA_K = 16,
          const int MMA_TILE_M = 2, const int MMA_TILE_N = 4,
          const int WARP_TILE_M = 4, const int WARP_TILE_N = 4,
          const int A_PAD = 0, const int B_PAD = 0, const int K_STAGE = 2,
          const bool BLOCK_SWIZZLE = false>
__global__ void __launch_bounds__(256)
    hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel(half *A, half *B,
                                                             half *C, int M,
                                                             int N, int K) {
  // BLOCK_SWIZZLE 0/1 control use block swizzle or not.
  const int bx = ((int)BLOCK_SWIZZLE) * blockIdx.z * gridDim.x + blockIdx.x;
  const int by = blockIdx.y;
  const int NUM_K_TILES = div_ceil(K, MMA_K);
  constexpr int BM = MMA_M * MMA_TILE_M * WARP_TILE_M; // 16*2*4=128
  constexpr int BN = MMA_N * MMA_TILE_N * WARP_TILE_N; // 8*4*4=128
  constexpr int BK = MMA_K;                            // 16

  extern __shared__ half smem[];
  half *s_a = smem;
  half *s_b = smem + K_STAGE * BM * (BK + A_PAD);
  constexpr int s_a_stage_offset = BM * (BK + A_PAD); // BMxBK 128*16
  constexpr int s_b_stage_offset = BN * (BK + B_PAD); // BNxBK 128*16

  const int tid = threadIdx.y * blockDim.x + threadIdx.x; // within block
  const int warp_id = tid / WARP_SIZE; // 0~7 warp_id within block
  const int lane_id = tid % WARP_SIZE; // 0~31
  const int warp_m = warp_id % 2;      // 0,1
  const int warp_n = warp_id / 2;      // 0,1,2,3

  int load_smem_a_m = tid / 2;                 // row 0~127
  int load_smem_a_k = (tid % 2 == 0) ? 0 : 8;  // col 0,8
  int load_smem_b_n = tid / 2;                 // row 0~127
  int load_smem_b_k = (tid % 2 == 0) ? 0 : 8;  // col 0,8
  int load_gmem_a_m = by * BM + load_smem_a_m; // global row of c
  int load_gmem_b_n = bx * BN + load_smem_b_n; // global col of c
  if (load_gmem_a_m >= M || load_gmem_b_n >= N)
    return;

  uint32_t RC[WARP_TILE_M][WARP_TILE_N][2];
#pragma unroll
  for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      RC[i][j][0] = 0;
      RC[i][j][1] = 0;
    }
  }

  // may avoid cvta overhead ? only cvta smem base ptr once for cp.async.
  uint32_t smem_a_base_ptr = __cvta_generic_to_shared(s_a);
  uint32_t smem_b_base_ptr = __cvta_generic_to_shared(s_b);

#pragma unroll
  for (int k = 0; k < (K_STAGE - 1); ++k) {     // 0, 1
    int load_gmem_a_k = k * BK + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * BK + load_smem_b_k; // global col of b
    int load_gmem_b_addr = load_gmem_b_n * K + load_gmem_b_k;

    uint32_t load_smem_a_ptr =
        (smem_a_base_ptr +
         (k * s_a_stage_offset + load_smem_a_m * (BK + A_PAD) + load_smem_a_k) *
             sizeof(half));
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr =
        (smem_b_base_ptr +
         (k * s_b_stage_offset + load_smem_b_n * (BK + B_PAD) + load_smem_b_k) *
             sizeof(half));
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);

    CP_ASYNC_COMMIT_GROUP();
  }

  CP_ASYNC_WAIT_GROUP(K_STAGE - 2); // s2->0, s3->1, s4->2
  __syncthreads();

#pragma unroll
  for (int k = (K_STAGE - 1); k < NUM_K_TILES; ++k) {
    // gmem -> smem
    // s2/4 can use bitwise ops but s3 can not, so, we use mod
    // ops for all stages kernel. s2: (k + 1)&1, s4: (k + 1)&3
    // s3: (k + 1) % 3
    int smem_sel = (k + 1) % K_STAGE; // s3 k 2->0, k 3->1, k 4->2...
    int smem_sel_next = k % K_STAGE;  // s3 k 2->2, k 3->0, k 4->1...

    int load_gmem_a_k = k * BK + load_smem_a_k; // global col of a
    int load_gmem_a_addr = load_gmem_a_m * K + load_gmem_a_k;
    int load_gmem_b_k = k * BK + load_smem_b_k; // global col of b
    int load_gmem_b_addr = load_gmem_b_n * K + load_gmem_b_k;

    uint32_t load_smem_a_ptr =
        (smem_a_base_ptr + (smem_sel_next * s_a_stage_offset +
                            load_smem_a_m * (BK + A_PAD) + load_smem_a_k) *
                               sizeof(half));
    CP_ASYNC_CG(load_smem_a_ptr, &A[load_gmem_a_addr], 16);

    uint32_t load_smem_b_ptr =
        (smem_b_base_ptr + (smem_sel_next * s_b_stage_offset +
                            load_smem_b_n * (BK + B_PAD) + load_smem_b_k) *
                               sizeof(half));
    CP_ASYNC_CG(load_smem_b_ptr, &B[load_gmem_b_addr], 16);

    CP_ASYNC_COMMIT_GROUP();

    uint32_t RA[WARP_TILE_M][4];
    uint32_t RB[WARP_TILE_N][2];
// smem -> reg
#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
      int warp_smem_a_m = warp_m * (MMA_M * WARP_TILE_M) + i * MMA_M;
      int lane_smem_a_m = warp_smem_a_m + lane_id % 16; // 0~15
      int lane_smem_a_k = (lane_id / 16) * 8;           // 0,8
      uint32_t lane_smem_a_ptr =
          (smem_a_base_ptr + (smem_sel * s_a_stage_offset +
                              lane_smem_a_m * (BK + A_PAD) + lane_smem_a_k) *
                                 sizeof(half));
      LDMATRIX_X4(RA[i][0], RA[i][1], RA[i][2], RA[i][3], lane_smem_a_ptr);
    }

#pragma unroll
    for (int j = 0; j < WARP_TILE_N; ++j) {
      int warp_smem_b_n = warp_n * (MMA_N * WARP_TILE_N) + j * MMA_N;
      int lane_smem_b_n = warp_smem_b_n + lane_id % 8; // 0~7, MMA_N=8
      int lane_smem_b_k = ((lane_id / 8) % 2) * 8;     // 0,8
      uint32_t lane_smem_b_ptr =
          (smem_b_base_ptr + (smem_sel * s_b_stage_offset +
                              lane_smem_b_n * (BK + B_PAD) + lane_smem_b_k) *
                                 sizeof(half));
      LDMATRIX_X2(RB[j][0], RB[j][1], lane_smem_b_ptr);
    }

// MMA compute
#pragma unroll
    for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        HMMA16816(RC[i][j][0], RC[i][j][1], RA[i][0], RA[i][1], RA[i][2],
                  RA[i][3], RB[j][0], RB[j][1], RC[i][j][0], RC[i][j][1]);
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
      uint32_t RA[WARP_TILE_M][4];
      uint32_t RB[WARP_TILE_N][2];

      int stage_sel = ((NUM_K_TILES - (K_STAGE - 1) + k) % K_STAGE);
// ldmatrix for s_a, ldmatrix.trans for s_b.
// smem -> reg
#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
        int warp_smem_a_m = warp_m * (MMA_M * WARP_TILE_M) + i * MMA_M;
        int lane_smem_a_m = warp_smem_a_m + lane_id % 16; // 0~15
        int lane_smem_a_k = (lane_id / 16) * 8;           // 0,8
        uint32_t lane_smem_a_ptr =
            (smem_a_base_ptr + (stage_sel * s_a_stage_offset +
                                lane_smem_a_m * (BK + A_PAD) + lane_smem_a_k) *
                                   sizeof(half));
        LDMATRIX_X4(RA[i][0], RA[i][1], RA[i][2], RA[i][3], lane_smem_a_ptr);
      }

#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        int warp_smem_b_n = warp_n * (MMA_N * WARP_TILE_N) + j * MMA_N;
        int lane_smem_b_n = warp_smem_b_n + lane_id % 8; // 0~7, MMA_N=8
        int lane_smem_b_k = ((lane_id / 8) % 2) * 8;     // 0,8
        uint32_t lane_smem_b_ptr =
            (smem_b_base_ptr + (stage_sel * s_b_stage_offset +
                                lane_smem_b_n * (BK + B_PAD) + lane_smem_b_k) *
                                   sizeof(half));
        LDMATRIX_X2(RB[j][0], RB[j][1], lane_smem_b_ptr);
      }

// MMA compute
#pragma unroll
      for (int i = 0; i < WARP_TILE_M; ++i) {
#pragma unroll
        for (int j = 0; j < WARP_TILE_N; ++j) {
          HMMA16816(RC[i][j][0], RC[i][j][1], RA[i][0], RA[i][1], RA[i][2],
                    RA[i][3], RB[j][0], RB[j][1], RC[i][j][0], RC[i][j][1]);
        }
      }
    }
  }

  {
    for (int i = 0; i < WARP_TILE_M; ++i) {
      // How to use LDST128BITS here? __shfl_sync -> lane 0 -> store 8 half.
      // thus, we only need 8 memory issues with 128 bits after shfl_sync.
      // may reuse RA[4][4] as RC0 ? only new RC1[4][4].
      uint32_t RC0[WARP_TILE_N][4];
      uint32_t RC1[WARP_TILE_N][4];
#pragma unroll
      for (int j = 0; j < WARP_TILE_N; ++j) {
        // How to use LDST128BITS here? __shfl_sync -> lane 0 -> store 8 half.
        // thus, we only need 8 memory issues with 128 bits after shfl_sync.
        RC0[j][0] = RC[i][j][0];
        RC1[j][0] = RC[i][j][1];
        RC0[j][1] = __shfl_sync((0xffffffff), RC[i][j][0], lane_id + 1);
        RC0[j][2] = __shfl_sync((0xffffffff), RC[i][j][0], lane_id + 2);
        RC0[j][3] = __shfl_sync((0xffffffff), RC[i][j][0], lane_id + 3);
        RC1[j][1] = __shfl_sync((0xffffffff), RC[i][j][1], lane_id + 1);
        RC1[j][2] = __shfl_sync((0xffffffff), RC[i][j][1], lane_id + 2);
        RC1[j][3] = __shfl_sync((0xffffffff), RC[i][j][1], lane_id + 3);
      }

      if (lane_id % 4 == 0) {
        int store_warp_smem_c_m = warp_m * (MMA_M * WARP_TILE_M) + i * MMA_M;
        int store_lane_gmem_c_m = by * BM + store_warp_smem_c_m + lane_id / 4;
#pragma unroll
        for (int j = 0; j < WARP_TILE_N; ++j) {
          int store_warp_smem_c_n = warp_n * (MMA_N * WARP_TILE_N) + j * MMA_N;
          int store_lane_gmem_c_n = bx * BN + store_warp_smem_c_n;
          int store_gmem_c_addr_0 =
              store_lane_gmem_c_m * N + store_lane_gmem_c_n;
          int store_gmem_c_addr_1 =
              (store_lane_gmem_c_m + 8) * N + store_lane_gmem_c_n;
          LDST128BITS(C[store_gmem_c_addr_0]) = LDST128BITS(RC0[j][0]);
          LDST128BITS(C[store_gmem_c_addr_1]) = LDST128BITS(RC1[j][0]);
        }
      }
    }
  }
}

// build cpp binary
#ifndef NO_MMA_HGEMM_BIN

#include "utils.h"

// 128x128, mma2x4, warp4x4(64,32,16), stages, block swizzle, dsmem, TN
#define LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(stages,      \
                                                                  stride)      \
  {                                                                            \
    const int smem_max_size = ((stages) * BM * (BK + A_PAD) * sizeof(half) +   \
                               (stages) * BN * (BK + B_PAD) * sizeof(half));   \
    cudaFuncSetAttribute(                                                      \
        hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<              \
            MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M,          \
            WARP_TILE_N, A_PAD, B_PAD, (stages), true>,                        \
        cudaFuncAttributeMaxDynamicSharedMemorySize, 98304);                   \
    const int N_SWIZZLE = (N + (stride) - 1) / (stride);                       \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid((div_ceil(N, BN) + N_SWIZZLE - 1) / N_SWIZZLE, div_ceil(M, BM),  \
              N_SWIZZLE);                                                      \
    hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<                  \
        MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M, WARP_TILE_N, \
        A_PAD, B_PAD, (stages), true>                                          \
        <<<grid, block, smem_max_size>>>(a, b, c, M, N, K);                    \
  }

template <const int K_STAGE = 2, const int BLOCK_SWIZZLE_STRIDE = 2048>
void lanunch_hgemm_mma_m16n8k16_tn(half *a, half *b, half *c, int M, int N,
                                   int K) {
  constexpr int MMA_M = 16;
  constexpr int MMA_N = 8;
  constexpr int MMA_K = 16;
  constexpr int MMA_TILE_M = 2;
  constexpr int MMA_TILE_N = 4;
  constexpr int WARP_TILE_M = 4;
  constexpr int WARP_TILE_N = 4;
  constexpr int A_PAD = 0;
  constexpr int B_PAD = 0;
  constexpr int NUM_THREADS =
      (MMA_TILE_M * MMA_TILE_N * WARP_SIZE); // 2 * 4 * 32 = 256
  constexpr int BM = MMA_M * MMA_TILE_M * WARP_TILE_M;
  constexpr int BN = MMA_N * MMA_TILE_N * WARP_TILE_N;
  constexpr int BK = MMA_K;
  // s2: 2*128*(32)*2=16KB, 2*32*(128+16)*2=18KB, ~35KB
  // s3: 3*128*(32)*2=24KB, 3*32*(128+16)*2=27KB, ~51KB
  // s4: 4*128*(32)*2=32KB, 4*32*(128+16)*2=36KB, ~68KB
  // s5: 5*128*(32)*2=40KB, 5*32*(128+16)*2=45KB, ~85KB
  LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(
      K_STAGE, BLOCK_SWIZZLE_STRIDE);
}

#ifdef HGEMM_MMA_DEBUG
#include <iostream>
#endif

int main(int argc, char *argv[]) {
#ifdef HGEMM_MMA_DEBUG
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

#ifdef HGEMM_MMA_DEBUG
  if (argc > 1)
    M_list[0] = std::stoi(argv[1]);
  if (argc > 2)
    N_list[0] = std::stoi(argv[2]);
  if (argc > 3)
    K_list[0] = std::stoi(argv[3]);
#endif

#ifdef HGEMM_MMA_DEBUG
  int outer_repeat = 1, inner_repeat = 1, warmup = 1;
  if (argc > 4)
    warmup = std::stoi(argv[4]);
  if (argc > 5)
    inner_repeat = std::stoi(argv[5]);
#else
  int outer_repeat = 10, inner_repeat = 1, warmup = 1;
#endif

  printf("ALGO = MMA16816 HGEMM TN MMA=2x4 WARP=4x4 STAGES=2 BLOCK "
         "SWIZZLE=2048\n");
#ifndef HGEMM_MMA_DEBUG
  for (int j = 0; j < 5; j++) {
    int M = M_list[j], N = N_list[j], K = K_list[j];
    float max_error = gemm_error_check_tn<half>(
        lanunch_hgemm_mma_m16n8k16_tn<2, 2048>, M, N, K);
    printf("M N K = %6d %6d %6d, ", M, N, K);
    printf("Max Error = %f\n", max_error);
  }
#endif

  for (int j = 0; j < test_num; j++) {
    int M = M_list[j], N = N_list[j], K = K_list[j];

    double max_sec = 0.0;
    double min_sec = DBL_MAX;
    double total_sec = 0.0;

    for (int k = 0; k < outer_repeat; k++) {
      double this_sec = perf_gemm<half>(lanunch_hgemm_mma_m16n8k16_tn<2, 2048>,
                                        M, N, K, inner_repeat, warmup);
      max_sec = max(max_sec, this_sec);
      min_sec = min(min_sec, this_sec);
      total_sec += this_sec;
    }

    // 1 TFLOPS = 10^12 FLOPS
    // ref: https://imgtec.eetrend.com/blog/2021/100062210.html.
    double avg_sec = total_sec / outer_repeat;
    double avg_Tflops = ((double)M) * N * K * 2 * 1e-12 / avg_sec;

    printf("M N K = %6d %6d %6d, W = %1d, R = %2d ", M, N, K, warmup,
           inner_repeat);
    printf("Time = %12.8lf %12.8lf %12.8lf s, ", min_sec, avg_sec, max_sec);
    printf("AVG Performance = %10.4lf Tflops\n", avg_Tflops);
  }

  return 0;
}

#else

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

// 128x128, mma2x4, warp4x4(64,32,16), stages, block swizzle, dsmem, TN
#define LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(stages,      \
                                                                  stride)      \
  {                                                                            \
    const int smem_max_size = ((stages) * BM * (BK + A_PAD) * sizeof(half) +   \
                               (stages) * BN * (BK + B_PAD) * sizeof(half));   \
    cudaFuncSetAttribute(                                                      \
        hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<              \
            MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M,          \
            WARP_TILE_N, A_PAD, B_PAD, (stages), true>,                        \
        cudaFuncAttributeMaxDynamicSharedMemorySize, 98304);                   \
    const int N_SWIZZLE = (N + (stride) - 1) / (stride);                       \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid((div_ceil(N, BN) + N_SWIZZLE - 1) / N_SWIZZLE, div_ceil(M, BM),  \
              N_SWIZZLE);                                                      \
    hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<                  \
        MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M, WARP_TILE_N, \
        A_PAD, B_PAD, (stages), true><<<grid, block, smem_max_size>>>(         \
        reinterpret_cast<half *>(a.data_ptr()),                                \
        reinterpret_cast<half *>(b.data_ptr()),                                \
        reinterpret_cast<half *>(c.data_ptr()), M, N, K);                      \
  }

#define LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(stages)   \
  {                                                                            \
    const int smem_max_size = ((stages) * BM * (BK + A_PAD) * sizeof(half) +   \
                               (stages) * BN * (BK + B_PAD) * sizeof(half));   \
    cudaFuncSetAttribute(                                                      \
        hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<              \
            MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M,          \
            WARP_TILE_N, A_PAD, B_PAD, (stages), false>,                       \
        cudaFuncAttributeMaxDynamicSharedMemorySize, 98304);                   \
    dim3 block(NUM_THREADS);                                                   \
    dim3 grid(div_ceil(N, BN), div_ceil(M, BM));                               \
    hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn_kernel<                  \
        MMA_M, MMA_N, MMA_K, MMA_TILE_M, MMA_TILE_N, WARP_TILE_M, WARP_TILE_N, \
        A_PAD, B_PAD, (stages), false><<<grid, block, smem_max_size>>>(        \
        reinterpret_cast<half *>(a.data_ptr()),                                \
        reinterpret_cast<half *>(b.data_ptr()),                                \
        reinterpret_cast<half *>(c.data_ptr()), M, N, K);                      \
  }

// 128x128, mma2x4, warp4x4(64,32,16), stages, block swizzle, dsmem
void hgemm_mma_m16n8k16_mma2x4_warp4x4_stages_dsmem_tn(torch::Tensor a,
                                                       torch::Tensor b,
                                                       torch::Tensor c,
                                                       int stages, bool swizzle,
                                                       int swizzle_stride) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(b, torch::kHalf)
  CHECK_TORCH_TENSOR_DTYPE(c, torch::kHalf)
  const int M = a.size(0);
  const int K = a.size(1);
  const int N = b.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(b, K, N)
  CHECK_TORCH_TENSOR_SHAPE(c, M, N)
  constexpr int MMA_M = 16;
  constexpr int MMA_N = 8;
  constexpr int MMA_K = 16;
  constexpr int MMA_TILE_M = 2;
  constexpr int MMA_TILE_N = 4;
  constexpr int WARP_TILE_M = 4;
  constexpr int WARP_TILE_N = 4;
  constexpr int A_PAD = 0; // 0,8,16
  constexpr int B_PAD = 8; // 0,8,16
  constexpr int NUM_THREADS =
      (MMA_TILE_M * MMA_TILE_N * WARP_SIZE); // 2 * 4 * 32 = 256
  constexpr int BM = MMA_M * MMA_TILE_M * WARP_TILE_M;
  constexpr int BN = MMA_N * MMA_TILE_N * WARP_TILE_N;
  constexpr int BK = MMA_K;

  if (swizzle) {
    // assert(swizzle_stride % 256 == 0);
    switch (stages) {
    case 2:
      LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(2,
                                                                swizzle_stride);
      break;
    case 3:
      LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(3,
                                                                swizzle_stride);
      break;
    case 4:
      LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(4,
                                                                swizzle_stride);
      break;
    case 5:
      LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(5,
                                                                swizzle_stride);
      break;
    default:
      LAUNCH_16816_STAGE_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(2,
                                                                swizzle_stride);
      break;
    }
  } else {
    switch (stages) {
    case 2:
      LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(2);
      break;
    case 3:
      LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(3);
      break;
    case 4:
      LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(4);
      break;
    case 5:
      LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(5);
      break;
    default:
      LAUNCH_16816_STAGE_NO_SWIZZLE_MMA2x4_WARP4x4_DSMEM_TN_KERNEL(2);
      break;
    }
  }
}

#endif
``` 

</details>

## 本篇小结

1. **WMMA→MMA PTX = 拆黑盒**：fragment 布局从黑盒变完全受控，m16n16k16 变硬件原生的 m16n8k16，代价是布局体操全手写
2. **ldmatrix 与 mma 配套**：一条 warp 指令搬 4 个 8×8 块且布局恰好是 mma 要的——装载和计算单元在指令集层面协同设计
3. **cp.async 让寄存器中转站下岗**：真异步搬运硬件白送"下一块在路上"，dbuf 的三段式简化成"发起→算→等"
4. **f16 acc 的精度取舍**：165 TFLOPS vs 溢出风险，error check 小形状 0 误差但生产用 f32 acc——20 篇 FA2 的 softmax 全程 f32 acc 是同一原则
5. **收尾 shuffle**：碎片化输出经 `__shfl_sync` 拼成 128bit coalesced 写——卸黑盒后每个环节都能优化
6. **实测 150+ TFLOPS = 峰值 94%**，cuBLAS 98%+；conda 环境编 makefile 项目的 5 坑实录
