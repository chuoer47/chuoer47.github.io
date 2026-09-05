---
title: SGEMV (FP32 GEMV)
order: 16
---

# SGEMV CUDA代码学习

> 本人学习笔记，AI总结

GEMV（矩阵向量乘）`y = A·x` 是 GEMM 的特例：**N=1**。这个"特例"不是退化，而是换了一个世界——LLM decode 阶段的每一个 token 生成，全量权重只乘一个向量，GEMV 就是 decode 的算力主菜。本篇代码只有三个 kernel，但每个都在回答同一个问题：**当输出只有 M 个数时，GPU 的并行性从哪来**。

先看实测（M=1024, K=128，RTX 4090，warmup 10 / iters 200）：

| kernel | 耗时 | 相对 |
|---|---|---|
| sgemv_k32_f32 | 0.00283ms | 1.00x |
| sgemv_k128_f32x4 | 0.00276ms | 0.98x |
| torch.matmul (F32) | 0.00766ms | 2.71x |

手写比 torch.matmul 快 2.7 倍——这是本系列第一次反超框架。原因后面讲。

## 问题定义：一行一个点积

`y[m] = Σ_k A[m][k] · x[k]`，A 是 M×K，x 是 K×1，y 是 M×1。

```
        K
    ┌─────────┐        ┌─┐
 M  │         │    ×   │x│  =  y[M×1]
    │   A     │        └─┘
    └─────────┘
y[m] = A 的第 m 行 · x        ← 每个输出 = 一个 K 长度点积（05 篇的主场）
```

和 GEMM 对比一下就看出问题（GEMM 见 15 篇）：
- GEMM：M×N 个输出，天然海量并行；数据复用率高
- GEMV：**只有 M 个输出**。每个输出的计算是独立的（各点各的行），但每个点积内部是**归约**（03 篇）——归约天然不好并行

所以 GEMV 的设计空间只有一个轴：**每个点积（每行）分配多少线程，M 行怎么凑满 GPU**。三个 kernel 就是这个轴上的三个刻度：K=32 一行一个 warp、K=128 一行一个 warp 但每人多吃 4 倍、K=16 一个 warp 吃两行。

## Kernel 1：k32——一行一个 warp

（假设 K 是 32 的倍数）

```
grid(M/4), block(32, 4):  4 个 warp / block, 每个 warp 负责一行

blockIdx.x=0 的 block 内:
  warp 0 (ty=0) → 行 0     lane 0..31 各算 A[0][lane]*x[lane]
  warp 1 (ty=1) → 行 1     ...
  warp 2 (ty=2) → 行 2
  warp 3 (ty=3) → 行 3
```

核心代码：

```c++
int lane = tx % WARP_SIZE;             // 0~31
int m = bx * blockDim.y + ty;          // 我负责的行号
float sum = 0.0f;
int NUM_WARPS = (K + WARP_SIZE - 1) / WARP_SIZE;
for (int w = 0; w < NUM_WARPS; ++w) {  // K>32 时一行要多个 warp 段
  int k = w * WARP_SIZE + lane;
  sum += a[m * K + k] * x[k];          // ← 乘加在寄存器里攒着
}
sum = warp_reduce_sum_f32<WARP_SIZE>(sum);   // 03 篇的蝴蝶归约
if (lane == 0) y[m] = sum;
```

对照 05 篇的点积：一模一样的骨架（每人攒一段 → `warp_reduce_sum` → lane 0 落盘），只是那篇全 grid 算一个点积，这里**一个 warp 独占一个点积**。K=128 时 NUM_WARPS=4，循环 4 轮，每轮 warp 覆盖 32 个元素。

访存分析（拿具体数字算，09 篇的规矩）：
- **A 的访问**：warp 内 lane 0~31 读 `a[m*K + w*32 + lane]`——连续 32 个 float，**coalesced** ✓
- **x 的访问**：所有 warp、所有轮次读的是**同一段 x**——K=128 时 x 总共 128 个 float = 512B，常驻 L1/L2，等于免费 ✓
- M=1024, K=128 时 grid=256 个 block × 4 warp = 1024 warp，4090 有 128 个 SM，每 SM 摊 8 个 warp——**够喂**。但如果 M 很小（比如 8，decode 早期 batch=1 时 M 就是模型宽度的行数），grid 只有 2 个 block，GPU 大量 SM 闲置——这是 GEMV 的固有困境，也是后面 vLLM 等框架要凑 batch 的原因

## Kernel 2：k128 + Vec4——每线程吃 4 个

（假设 K 是 128 的倍数）

Kernel 1 里 NUM_WARPS=4 时，归约循环转 4 轮。Kernel 2 把"转 4 轮"压成"1 轮、每人拿 4 个"：

```c++
int k = (w * WARP_SIZE + lane) * 4;    // 注意 *4：lane 0→k0, lane 1→k4...
float4 reg_x = FLOAT4(x[k]);           // 一条指令读 4 个 x
float4 reg_a = FLOAT4(a[m * K + k]);   // 一条指令读 4 个 A
sum += reg_a.x*reg_x.x + reg_a.y*reg_x.y + reg_a.z*reg_x.z + reg_a.w*reg_x.w;
```

**warp 的覆盖方式变了**：Kernel 1 里 lane 0~31 覆盖连续的 32 个元素；Kernel 2 里 lane 0 读 k 0~3、lane 1 读 k 4~7……32 个线程覆盖 **128 个连续元素**。访存还是 coalesced（128 个 float 连续 = 4 条 128B cache line，一个 warp 事务正好搬完）。

向量化该省的访存指令省了：**load 指令数 /4**。但实测只快了 2%（0.00283→0.00276ms）——**老朋友又来了**：这个 kernel 的问题规模太小（1024×128×4B = 512KB 数据量），总耗时 2.8μs 里 launch 开销占比不小，向量化省下的几百条访存指令根本不在关键路径上。02/09/11/12 反复验证的铁律换个说法：**优化手段既要打在瓶颈上，也要看瓶颈占总耗时的比例**——分母太小，分子优化没意义。

**为什么手写比 torch.matmul 快 2.7 倍**？torch.matmul 对 (1024,128)×(128,1) 这个形状会走通用 GEMM 路径（cuBLAS gemv 或退化 kernel），它要为任意 N 准备分块逻辑；而这里的 kernel 是**为"K 是 32/128 倍数的 GEMV"特化的**——没有 N 维逻辑、没有边界检查、launch 配置直接压到最小。shape 越小越特化，框架的通用性税越显眼。

## Kernel 3：k16——一个 warp 吃两行

（假设 K=16）反向问题来了：K < 32，一个 warp 32 个线程只有 16 个元素可算，一半线程闲着。

解法：**一个 warp 同时算 2 行**，16 个线程一行：

```
K_WARP_SIZE = 32 / 2 = 16     ← 每行的"点积宽度"
lane 的分解: k   = lane % 16   ← 我算哪一列
             行  = lane / 16   ← 我算哪一行 (0 或 1)

warp 内布局 (K=16):
  lane 0~15  → 行 m+0 的 k=0~15
  lane 16~31 → 行 m+1 的 k=0~15
```

```c++
int k = lane % K_WARP_SIZE;                              // 0~15
int m = (blockDim.y * bx + ty) * ROW_PER_WARP + lane / K_WARP_SIZE;  // +0 或 +1
float sum = A[m * K + k] * x[k];
sum = warp_reduce_sum_f32<K_WARP_SIZE>(sum);             // ← 注意模板参数是 16!
if (k == 0) y[m] = sum;                                  // ← 是 k==0, 不是 lane==0
```

三个细节是本 kernel 的精华：

1. **`warp_reduce_sum_f32<16>`**：03 篇讲过，蝴蝶归约的 mask 序列由模板参数生成——`16>>1=8, 4, 2, 1`，4 轮归约只在各自 16 人小组内进行，两组互不干扰（`__shfl_xor_sync` 的 xor 掩码恰好保证 lane 0~15 只和 0~15 交换、16~31 只和 16~31 交换——可以拿 mask=8 验证：lane 0 ↔ lane 8，都 <16 ✓）。**同一个硬件 warp 里跑着两个独立的归约**，这就是 03 篇"warp 蝴蝶归约可以任意 2 的幂宽度"的实战兑现。
2. **`k == 0` 而非 `lane == 0`**：两行的结果分别落在 lane 0 和 lane 16——两个小组各自的"lane 0"。判 k==0 自动选中两个组长。
3. **访存亏了**：A 的访问从 lane 看，lane 0~15 读行 m 连续 16 个、lane 16~31 读行 m+1 连续 16 个——两行在内存里不相邻（隔 K 个 float），warp 一次访存跨 2 条 cache line，各用一半。**K<32 时 coalesced 注定不完美**，这是问题形状的物理约束，不是实现失误。

## 三 kernel 的设计空间总结

把三个 kernel 摆在"行×线程"的分配矩阵里：

| kernel | K 假设 | 1 行用几个线程 | 1 warp 几行 | 备注 |
|---|---|---|---|---|
| k32 | K % 32 == 0 | 32（K>32 转轮） | 1 | 基准形态 |
| k128f32x4 | K % 128 == 0 | 32×4 元素 | 1 | 向量化压轮次 |
| k16 | K == 16 | 16 | 2 | 拆 warp 塞小 K |

规律：**每个线程持有的元素数 × 每 warp 的行数 = 32**（warp 大小守恒）。K 大就往"每线程多拿几个"压（k128），K 小就往"每 warp 多拿几行"压（k16），核心都是一条：**别让任何线程闲着**。

GEMV 的三个世界性约束（和 15 篇 GEMM 对照）：
1. **输出太少**：GEMM 的并行来自 M×N，GEMV 只有 M——M 小时 GPU 喂不饱（batch 解法）
2. **归约开销**：每行的点积尾上要一次 warp 归约，行数 = 归约次数；GEMM 没有这一层
3. **算术强度低**：每个 A 元素只参与 1 次乘加（GEMM 里是 N 次）——GEMV 注定是**访存受限**算子，算力再强也用不上，带宽是天花板。这就是为什么 17 篇 hgemm 玩命堆计算密度，而 GEMV 的优化全在访存形态上

LLM decode 语境：batch=1 时每层都是 GEMV（权重 × 单个激活向量），GPU 带宽直接决定 decode 速度——这正是 vLLM/SGLang 拼 KV cache 和 batch 的底层原因之一。

## 完整代码

### `sgemv.cu`
<details>
<summary> sgemv.cu </summary>

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

//  FP32
//  Warp Reduce Sum
template <const int kWarpSize = WARP_SIZE>
__device__ __forceinline__ float warp_reduce_sum_f32(float val) {
#pragma unroll
  for (int mask = kWarpSize >> 1; mask >= 1; mask >>= 1) {
    val += __shfl_xor_sync(0xffffffff, val, mask);
  }
  return val;
}

// SGEMV: Warp SGEMV K32
// 假设K为32的倍数，每个warp负责一行
// grid(M/4), block(32,4) blockDim.x=32=K, blockDim.y=4
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
__global__ void sgemv_k32_f32_kernel(float *a, float *x, float *y, int M,
                                     int K) {
  int tx = threadIdx.x;         // 0~31
  int ty = threadIdx.y;         // 0~4
  int bx = blockIdx.x;          // 0~M/4
  int lane = tx % WARP_SIZE;    // 0~31
  int m = bx * blockDim.y + ty; // (0~M/4) * 4 + (0~3)
  if (m < M) {
    float sum = 0.0f;
    int NUM_WARPS = (K + WARP_SIZE - 1) / WARP_SIZE;
#pragma unroll
    for (int w = 0; w < NUM_WARPS; ++w) {
      // 若NUM_WARPS>=2，先将当前行的数据累加到第一个warp中
      int k = w * WARP_SIZE + lane;
      sum += a[m * K + k] * x[k];
    }
    sum = warp_reduce_sum_f32<WARP_SIZE>(sum);
    if (lane == 0)
      y[m] = sum;
  }
}

// SGEMV: Warp SGEMV K128 + Vec4
// 假设K为128的倍数 float4
// grid(M/4), block(32,4) blockDim.x=32=K, blockDim.y=4
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
__global__ void sgemv_k128_f32x4_kernel(float *a, float *x, float *y, int M,
                                        int K) {
  // 每个线程负责4个元素，一个warp覆盖128个元素
  int tx = threadIdx.x;         // 0~31
  int ty = threadIdx.y;         // 0~3
  int bx = blockIdx.x;          // 0~M/4
  int lane = tx % WARP_SIZE;    // 0~31
  int m = blockDim.y * bx + ty; // (0~M/4) * 4 + (0~3)

  if (m < M) {
    float sum = 0.0f;
    // process 4*WARP_SIZE elements per warp.
    int NUM_WARPS = (((K + WARP_SIZE - 1) / WARP_SIZE) + 4 - 1) / 4;
#pragma unroll
    for (int w = 0; w < NUM_WARPS; ++w) {
      int k = (w * WARP_SIZE + lane) * 4;
      float4 reg_x = FLOAT4(x[k]);
      float4 reg_a = FLOAT4(a[m * K + k]);
      sum += (reg_a.x * reg_x.x + reg_a.y * reg_x.y + reg_a.z * reg_x.z +
              reg_a.w * reg_x.w);
    }
    sum = warp_reduce_sum_f32<WARP_SIZE>(sum);
    if (lane == 0)
      y[m] = sum;
  }
}

// SGEMV: Warp SGEMV K16
// 假设K为16 < 32,每个warp负责2行，每行有16个元素
// NUM_THREADS=128, NUM_WARPS=NUM_THREADS/WARP_SIZE;
// NUM_ROWS=NUM_WARPS * ROW_PER_WARP, grid(M/NUM_ROWS), block(32,NUM_WARPS)
// a: MxK, x: Kx1, y: Mx1, compute: y = a * x
template <const int ROW_PER_WARP = 2>
__global__ void sgemv_k16_f32_kernel(float *A, float *x, float *y, int M,
                                     int K) {
  constexpr int K_WARP_SIZE = (WARP_SIZE + ROW_PER_WARP - 1) / ROW_PER_WARP;
  int tx = threadIdx.x;      // 0~31
  int ty = threadIdx.y;      // 0~NUM_WARPS
  int bx = blockIdx.x;       // 0~M/NUM_ROWS (NUM_ROWS=NUM_WARPS * ROW_PER_WARP)
  int lane = tx % WARP_SIZE; // 0~31
  int k = lane % K_WARP_SIZE; // 0~15
  // gloabl row of a: MxK and y:Mx1, blockDim.y=NUM_WARPS
  int m = (blockDim.y * bx + ty) * ROW_PER_WARP + lane / K_WARP_SIZE;
  if (m < M) {
    float sum = A[m * K + k] * x[k];
    sum = warp_reduce_sum_f32<K_WARP_SIZE>(sum);
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

void sgemv_k32_f32(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(x, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(y, M, 1)
  ASSERT_K_IS_MULTIBLE_OF(32)

  dim3 block(32, 4);
  dim3 grid((M + 4 - 1) / 4);

  sgemv_k32_f32_kernel<<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                                        reinterpret_cast<float *>(x.data_ptr()),
                                        reinterpret_cast<float *>(y.data_ptr()),
                                        M, K);
}

void sgemv_k128_f32x4(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
  const int M = a.size(0);
  const int K = a.size(1);
  CHECK_TORCH_TENSOR_SHAPE(a, M, K)
  CHECK_TORCH_TENSOR_SHAPE(x, K, 1)
  CHECK_TORCH_TENSOR_SHAPE(y, M, 1)
  ASSERT_K_IS_MULTIBLE_OF(128)

  dim3 block(32, 4);
  dim3 grid((M + 4 - 1) / 4);

  sgemv_k128_f32x4_kernel<<<grid, block>>>(
      reinterpret_cast<float *>(a.data_ptr()),
      reinterpret_cast<float *>(x.data_ptr()),
      reinterpret_cast<float *>(y.data_ptr()), M, K);
}

void sgemv_k16_f32(torch::Tensor a, torch::Tensor x, torch::Tensor y) {
  CHECK_TORCH_TENSOR_DTYPE(a, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(y, torch::kFloat32)
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

  sgemv_k16_f32_kernel<ROW_PER_WARP>
      <<<grid, block>>>(reinterpret_cast<float *>(a.data_ptr()),
                        reinterpret_cast<float *>(x.data_ptr()),
                        reinterpret_cast<float *>(y.data_ptr()), M, K);
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(sgemv_k32_f32)
  TORCH_BINDING_COMMON_EXTENSION(sgemv_k128_f32x4)
  TORCH_BINDING_COMMON_EXTENSION(sgemv_k16_f32)
}
```

</details>

### `sgemv.py`
<details>
<summary> sgemv.py </summary>

```python
import time
from functools import partial
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="sgemv_lib",
    sources=["sgemv.cu"],
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
    out: Optional[torch.Tensor] = None,
    warmup: int = 10,
    iters: int = 200,
    show_all: bool = False,
):
    if out is not None:
        out.fill_(0)
    if out is not None:
        for i in range(warmup):
            perf_func(a, b, out)
    else:
        for i in range(warmup):
            _ = perf_func(a, b)

    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            perf_func(a, b, out)
    else:
        for i in range(iters):
            out = perf_func(a, b)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten().detach().cpu().numpy().tolist()[:3]
    out_val = [round(v, 8) for v in out_val]
    print(f"{out_info:>13}: {out_val}, time:{mean_time:.8f}ms")
    if show_all:
        print(out)
    return out.clone(), mean_time


print("-" * 80)
M, N, K = 1024, 1, 128
a = torch.randn((M, K)).cuda().float().contiguous()
b = torch.randn((K, N)).cuda().float().contiguous()
c = torch.randn((M, N)).cuda().float().contiguous()
run_benchmark(lib.sgemv_k32_f32, a, b, "k32f32", c)
run_benchmark(lib.sgemv_k128_f32x4, a, b, "k128f32x4", c)
run_benchmark(partial(torch.matmul, out=c), a, b, "f32_th")
print("-" * 80)

M, N, K = 1024, 1, 16
a = torch.randn((M, K)).cuda().float().contiguous()
b = torch.randn((K, N)).cuda().float().contiguous()
c = torch.randn((M, N)).cuda().float().contiguous()
run_benchmark(lib.sgemv_k16_f32, a, b, "k16f32", c)
run_benchmark(partial(torch.matmul, out=c), a, b, "f32_th")
print("-" * 80)
```

</details>

## 本篇小结

1. **GEMV = M 个独立点积**，设计空间只有一根轴：每行分配几个线程——三个 kernel 是这根轴上的三个刻度
2. **k32**：一行一 warp，lane 连续覆盖 K 段，coalesced ✓；K>32 靠轮次循环。骨架完全是 05 点积的 warp 独占版
3. **k128f32x4**：float4 向量化把 4 轮压 1 轮，但小 shape 下 launch 开销主导，仅快 2%——优化要看瓶颈占总耗时比例
4. **k16**：K<32 时一个 warp 拆两行，`warp_reduce<16>` 双归约并行 + `k==0` 选双组长——03 篇"任意 2 的幂归约宽度"的实战兑现
5. **手写快 torch 2.7 倍**：小 shape 特化 kernel 没有框架的通用性税
6. **GEMV 是访存受限算子**（算术强度 1:1），M 小喂不饱 GPU——decode 场景的固有困境，batch 是解药
