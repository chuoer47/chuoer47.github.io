---
title: RMS Norm
order: 7
---

# RMS Norm CUDA代码学习

> 本人学习笔记，AI总结

RMSNorm 是 LayerNorm 的减法：**去掉均值中心化和 bias**，只做"除以均方根"。Llama 等现代 LLM 全面用它替代 LayerNorm。公式：`y = x / rms(x) * g`，其中 `1/rms(x) = rsqrt(Σx²/K + ε)`。

对照 06 的 LayerNorm，结构差异一目了然：

```
LayerNorm: load → reduce(mean) → sync → reduce((x-mean)²) → sync → (x-mean)/std*g+b
RMSNorm:   load → reduce(x²)   → sync → x*rms_inv*g
```

**两次依赖的 reduce 变一次，一个 sync 没了**，没有 mean 减法、没有 bias。所以本篇极短，讲三件事：为什么 LLM 都换 RMSNorm、一个新变体 `f16x8_f32` 的 cache 命中技巧、以及 x² 的溢出比 LN 更凶。

## 完整代码

### `rms_norm.cu`
<details>
<summary> rms_norm.cu（核心 kernel 部分）</summary>

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

// Warp Reduce Sum / Block Reduce Sum 等辅助函数与 layer-norm 完全一致,见 06

// RMS Norm: x: NxK(K=256<1024), y': NxK, y'=x/rms(x) each row
// 1/rms(x) = rsqrtf( sum(x^2)/K ) each row
// grid(N*K/K), block(K<1024) N=batch_size*seq_len, K=hidden_size
// y=y'*g (g: scale)
template <const int NUM_THREADS = 256>
__global__ void rms_norm_f32_kernel(float *x, float *y, float g, int N, int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = bid * blockDim.x + threadIdx.x;
  const float epsilon = 1e-5f;

  __shared__ float s_variance;                 // shared within block
  float value = (idx < N * K) ? x[idx] : 0.0f; // load once only
  float variance = value * value;
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  if (idx < N * K)
    y[idx] = (value * s_variance) * g;
}

template <const int NUM_THREADS = 256 / 4>
__global__ void rms_norm_f32x4_kernel(float *x, float *y, float g, int N,
                                      int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 4;
  const float epsilon = 1e-5f;

  __shared__ float s_variance; // shared within block
  float4 reg_x = FLOAT4(x[idx]);
  float variance = (idx < N * K) ? (reg_x.x * reg_x.x + reg_x.y * reg_x.y +
                                    reg_x.z * reg_x.z + reg_x.w * reg_x.w)
                                 : 0.0f;
  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  float4 reg_y;
  reg_y.x = reg_x.x * s_variance * g;
  reg_y.y = reg_x.y * s_variance * g;
  reg_y.z = reg_x.z * s_variance * g;
  reg_y.w = reg_x.w * s_variance * g;
  if (idx < N * K)
    FLOAT4(y[idx]) = reg_y;
}

// ... f16_f16 / f16x2_f16 / f16x8_f16 / f16x8_pack_f16 / f16x8_pack_f32
//     与 layer-norm 同构(去掉 mean/bias), 见 06

// RMS Norm FP16x8: load 8 halfs, acc with float, manual unroll
template <const int NUM_THREADS = 256>
__global__ void rms_norm_f16x8_f32_kernel(half *x, half *y, float g, int N,
                                          int K) {
  int tid = threadIdx.x; // 0..K-1
  int bid = blockIdx.x;  // 0..N-1
  int idx = (bid * blockDim.x + threadIdx.x) * 8;
  const float epsilon = 1e-5f;

  __shared__ float s_variance; // shared within block
  // manual unroll and improve L2 cache hit rate.
  // Only   L2 cache: load 32  bytes in 1 memory issue (default)
  // Enable L1 cache: load 128 bytes in 1 memory issue (-Xptxas -dlcm=ca)
  // why try fp16x8 within 1 threads? ref:
  // https://zhuanlan.zhihu.com/p/641639133 0. first, tid_0 load 32 bytes in 1
  // memory issue and cache data into L2 cache.
  // 1. then, tid_1,...,tid_3 hit L2 cache and load data from L2 cache directly.
  float2 reg_x_0 = __half22float2(HALF2(x[idx + 0]));
  float2 reg_x_1 = __half22float2(HALF2(x[idx + 2]));
  float2 reg_x_2 = __half22float2(HALF2(x[idx + 4]));
  float2 reg_x_3 = __half22float2(HALF2(x[idx + 6]));

  float variance = FLOAT2_VARIANCE(reg_x_0, 0);
  variance += FLOAT2_VARIANCE(reg_x_1, 2);
  variance += FLOAT2_VARIANCE(reg_x_2, 4);
  variance += FLOAT2_VARIANCE(reg_x_3, 6);

  variance = block_reduce_sum_f32<NUM_THREADS>(variance);
  if (tid == 0)
    s_variance = rsqrtf(variance / (float)K + epsilon);
  // wait for s_variance in shared memory to be ready for all threads
  __syncthreads();
  // manual unroll
  float2 reg_y_0, reg_y_1, reg_y_2, reg_y_3;
  FLOAT2_RMS_NORM(reg_y_0, reg_x_0, g);
  FLOAT2_RMS_NORM(reg_y_1, reg_x_1, g);
  FLOAT2_RMS_NORM(reg_y_2, reg_x_2, g);
  FLOAT2_RMS_NORM(reg_y_3, reg_x_3, g);
  if ((idx + 0) < N * K) {
    HALF2(y[idx + 0]) = __float22half2_rn(reg_y_0);
  }
  if ((idx + 2) < N * K) {
    HALF2(y[idx + 2]) = __float22half2_rn(reg_y_1);
  }
  if ((idx + 4) < N * K) {
    HALF2(y[idx + 4]) = __float22half2_rn(reg_y_2);
  }
  if ((idx + 6) < N * K) {
    HALF2(y[idx + 6]) = __float22half2_rn(reg_y_3);
  }
}

// ... dispatch / host binding 与 layer-norm 同构, 见 06
```

</details>

### `rms_norm.py`
<details>
<summary> rms_norm.py </summary>

```python
import time
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="rms_norm_lib",
    sources=["rms_norm.cu"],
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


# un-fused naive rms norm
def naive_rms_norm(x: torch.Tensor, g: float):
    variance = x.pow(2).mean(-1, keepdim=True)  # E(x^2)
    y = x * torch.rsqrt(variance + 1e-5) * g
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
    if out is not None:
        out.fill_(0)
    # ... 与 layer_norm.py 的 run_benchmark 同构, 略
    return out, mean_time


print("-" * 85)
N, K = 4096, 512
print(" " * 40 + f"N={N}, K={K}")
x = torch.randn((N, K)).cuda().float().contiguous()
out = torch.zeros_like(x).cuda().float().contiguous()
run_benchmark(lib.rms_norm_f32, x, "f32", out)
run_benchmark(lib.rms_norm_f32x4, x, "f32x4", out)
run_benchmark(naive_rms_norm, x, "f32_th")

print("-" * 85)
x_f16 = x.half()
out_f16 = out.half()
run_benchmark(lib.rms_norm_f16_f16, x_f16, "f16f16", out_f16)
run_benchmark(lib.rms_norm_f16_f32, x_f16, "f16f32", out_f16)
run_benchmark(lib.rms_norm_f16x2_f16, x_f16, "f16x2f16", out_f16)
run_benchmark(lib.rms_norm_f16x8_f16, x_f16, "f16x8f16", out_f16)
run_benchmark(lib.rms_norm_f16x8_f32, x_f16, "f16x8f32", out_f16)
run_benchmark(lib.rms_norm_f16x8_pack_f16, x_f16, "f16x8packf16", out_f16)
run_benchmark(lib.rms_norm_f16x8_pack_f32, x_f16, "f16x8packf32", out_f16)
run_benchmark(naive_rms_norm, x_f16, "f16_th")
print("-" * 85)

print(" " * 40 + f"f16 overflow without f32")
print("-" * 85)
x_f16 = x.half() * 100  # this will cause overflow for kernels without `f32`
run_benchmark(lib.rms_norm_f16_f16, x_f16, "f16f16", out_f16)
run_benchmark(lib.rms_norm_f16_f32, x_f16, "f16f32", out_f16)
run_benchmark(lib.rms_norm_f16x2_f16, x_f16, "f16x2f16", out_f16)
run_benchmark(lib.rms_norm_f16x8_f16, x_f16, "f16x8f16", out_f16)
run_benchmark(lib.rms_norm_f16x8_f32, x_f16, "f16x8f32", out_f16)
run_benchmark(lib.rms_norm_f16x8_pack_f16, x_f16, "f16x8packf16", out_f16)
run_benchmark(lib.rms_norm_f16x8_pack_f32, x_f16, "f16x8packf32", out_f16)
run_benchmark(naive_rms_norm, x_f16, "f16_th")
print("-" * 85)

# ... 后面 N,K = 4096x1024, 4096x2048, 4096x4096, 4096x8192, 8192x8192 同套路
```

</details>

## 逐段代码剖析/学习

reduce 骨架、per-token 映射、广播 smem、load once、混合精度——03~06 的东西全复用。只讲新的。

---

**为什么 LLM 从 LayerNorm 换成 RMSNorm？**

1. **省一遍 reduce**：LN 要先求 mean 再求方差（两次依赖的 reduce），RMSNorm 只求 `Σx²`（一次）。少一次 block reduce + 少一次 `__syncthreads` + 少 K 次减法。
2. **省参数**：LN 有 g 和 b 两个参数向量，RMSNorm 只留 g（Llama 的 `RMSNorm(weight=...)`）。少一半参数量和访存。
3. 实测收益（N=4096, K=512, f16x8packf32）：RMSNorm 0.0039ms vs 06 的 LayerNorm 0.0042ms——省一遍 reduce 实打实快 ~7%。KV 越大收益越明显（K=4096 时 RMSNorm 0.0088 vs LN 0.0187ms，快 2 倍+，因为 LN 的第二次 reduce 在 K 大时占比更高）。
4. 代价：没有 mean 中心化，理论上表达能力略弱。但 Llama/GPT-NeoX/ mistral 全线实测精度不掉——大家就用它了。

---

```c++
// rms_norm_f16x8_f32: 用 half2 逐对 load, 不用 LDST128BITS
float2 reg_x_0 = __half22float2(HALF2(x[idx + 0]));
float2 reg_x_1 = __half22float2(HALF2(x[idx + 2]));
...
// manual unroll and improve L2 cache hit rate.
// Only   L2 cache: load 32  bytes in 1 memory issue (default)
// Enable L1 cache: load 128 bytes in 1 memory issue (-Xptxas -dlcm=ca)
// why try fp16x8 within 1 threads? ref:
// https://zhuanlan.zhihu.com/p/641639133
// 0. first, tid_0 load 32 bytes in 1 memory issue and cache data into L2 cache.
// 1. then, tid_1,...,tid_3 hit L2 cache and load data from L2 cache directly.
```

本篇最有意思的新变体：`f16x8_f32`（LN 里没有）。它**故意不用** `LDST128BITS` 128bit load，而是发 4 条 32-bit 的 `HALF2` load。为什么"更窄的 load 反而可能是好主意"？代码注释给出了理由——**cache line 与 L2 命中的博弈**：

- GPU 的 L2 cache line 是 32 字节，global load 默认**不经过 L1**（`-dlcm=cg`，只 L2）。一条 128bit（16B）load 需要 L2 里对应的 16B 有效；而一条 32bit load 拿 4 字节。
- 一个 warp 里 32 个线程发连续的 32bit load，硬件会把它们**合并（coalesce）成整条 32B/128B 的 L2 事务**——并不会真的发 32 次独立请求。所以"窄 load"不等于"低带宽"，只要 warp 内地址连续，合并机制会补齐。
- 注释说的策略：tid_0 的 load 先把这条 cache line 拉进 L2，随后 tid_1..3 命中 L2——**访存延迟被 L2 吸收**。
- `-Xptxas -dlcm=ca`：编译开关，让 global load 也走 L1（128B line），进一步提高命中。默认不开是因为 L1 不保证一致性（多线程写场景危险），纯读场景开了更快。

对比 `f16x8_pack`（LDST128BITS 一次 16B）：pack 版胜在指令数少（1 条 vs 4 条）；`f16x8_f32` 版胜在 cache 粒度细 + **load 完立即转 float2**（寄存器里直接是 f32，省掉后面逐元素转换指令）。两者实测几乎同速（0.00389 vs 0.00386ms），选哪个看口味——**这是"访存策略没有银弹，要拿 NCU 实测"的典型案例**。

顺带新 intrinsic：`__half22float2`——half2 一次性转 float2（两条转换合成一条）。

---

```c++
// x² 让溢出比 LN 更早发生
half value = x[idx];          // 假设 x = 250 (f16 可表示)
half variance = value * value; // 250*250 = 62500, f16 max 65504, 勉强
// 但 K=512 个 62500 连加, 第 2 个就 inf 了
```

实测（x×100, K=512）：

| kernel | acc | 输出 |
|---|---|---|
| f16f16 / f16x2f16 / f16x8f16 / f16x8packf16 | f16 | **-0.0, 0.0, -0.0** |
| **naive (torch)** | **f16** | **-0.0, 0.0, -0.0（torch 也炸了！）** |
| f16f32 / f16x8f32 / f16x8packf32 | f32 | 正常 |

注意和 06 的关键区别：**LN 的溢出演示里 torch naive 是正常的**（torch 的 LN 内部用 f32 acc），而 **RMSNorm 的 naive 版（`x.pow(2).mean()`）直接在 f16 上算 x²，torch 也跟着炸**——naive 写法的 `pow(2).mean()` 是两个独立的 f16 算子，中间结果留在 f16。这提醒我们：**"框架的 eager 模式不保证中间量升精度"**，融合 kernel 自己控制 acc dtype 反而更可靠。

## 实测数据（4090, N=4096, K=512）

| kernel | 耗时 |
|---|---|
| f32 | 0.0100ms |
| f32x4 | 0.0057ms |
| naive(torch) | 0.0318ms |
| f16f16 | 0.0099ms |
| f16x2f16 | 0.0058ms |
| f16x8f16 | 0.0042ms |
| f16x8_f32 | 0.0044ms |
| f16x8packf16 | 0.0039ms |
| f16x8packf32 | **0.0039ms** |

- 对比 06 同尺寸 LayerNorm 最快 0.0041ms → RMSNorm 0.0039ms，**少一遍 reduce 的收益直观可见**。
- K=4096 时差距拉大：RMSNorm f16x8packf32 = 0.0088ms vs LayerNorm 同款 0.0187ms（**2.1x**）——K 越大，省掉的那次 reduce 占比越高。

## 本篇小结

1. **RMSNorm = LayerNorm 减法**：去 mean 中心化、去 bias，一次 reduce 替两次；实测小 K 快 ~5%，大 K 快 2 倍。Llama 全线采用的原因就是"更少计算、更少参数、精度不掉"。
2. **L2/L1 cache line 博弈**：128bit pack load vs 32bit 合并 load 没有绝对赢家；`-Xptxas -dlcm=ca` 开 L1 是纯读场景的免费加速开关。
3. **`__half22float2`**：half2→float2 一次转换。
4. **eager 模式的精度陷阱**：`x.pow(2).mean()` 在 f16 上连 torch 自己都溢出——框架不保证中间量升精度，acc dtype 得自己管。
