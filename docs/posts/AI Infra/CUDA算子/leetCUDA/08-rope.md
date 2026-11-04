---
title: RoPE
order: 8
---

# RoPE CUDA代码学习

> 本人学习笔记，AI总结

RoPE（Rotary Position Embedding，旋转位置编码）是 Llama/Qwen 等主流 LLM 的位置编码方案。前面的 kernel 都是"整数加减乘"级别的运算，本篇第一次遇到**三角函数**（sin/cos/pow），并且它**没有 reduce**——是纯 elementwise kernel，但要处理"成对元素"的复数旋转结构。同时对比两种索引方案（一维展平 vs 二维映射），引出 **div/mod 整数除法的代价**问题。

## RoPE 数学（1 分钟版）

把 hidden 维度两两配对，每一对看成一个复数，按位置乘一个单位复数（转角度）：

```
对 token_pos 的第 i 对 (x_{2i}, x_{2i+1}):
  角度 θ_i = token_pos / theta^(2i/hidden)      // theta=10000, 越后面的对转得越慢
  (x', y') = (x·cosθ - y·sinθ, x·sinθ + y·cosθ)  // 二维旋转矩阵
```

直觉：低维对（i 小）转得快（高频），高维对转得慢（低频），每个 token 的"旋转指纹"唯一，且注意力内积只依赖相对位置（q·k 的角度差）。这就是 Llama 用它替代绝对位置编码的原因。

## 完整代码

### `rope.cu`
<details>
<summary> rope.cu </summary>

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

#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define BFLOAT2(value) (reinterpret_cast<__nv_bfloat162 *>(&(value))[0])
#define BLOCK_SIZE 256
#define theta 10000.0f

__global__ void rope_f32_kernel(float *x, float *out, int seq_len, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  float x1 = x[idx * 2];
  float x2 = x[idx * 2 + 1];
  int token_pos = idx / N;
  int token_idx = idx % N;
  float exp_v = 1.0f / powf(theta, 2 * token_idx / (N * 2.0f));
  float sin_v = sinf(token_pos * exp_v);
  float cos_v = cosf(token_pos * exp_v);
  float out1 = x1 * cos_v - x2 * sin_v;
  float out2 = x1 * sin_v + x2 * cos_v;
  out[idx * 2] = out1;
  out[idx * 2 + 1] = out2;
}

// another index method of rope.
__global__ void rope_f32_v2_kernel(float *x, float *out, int seq_len, int N) {
  int token_pos = blockIdx.x;
  int tid = threadIdx.x;
  float x1 = x[token_pos * N * 2 + tid * 2];
  float x2 = x[token_pos * N * 2 + tid * 2 + 1];
  float exp_v = 1.0f / powf(theta, 2 * tid / (N * 2.0f));
  float sin_v = sinf(token_pos * exp_v);
  float cos_v = cosf(token_pos * exp_v);
  float out1 = x1 * cos_v - x2 * sin_v;
  float out2 = x1 * sin_v + x2 * cos_v;
  out[token_pos * N * 2 + tid * 2] = out1;
  out[token_pos * N * 2 + tid * 2 + 1] = out2;
}

__global__ void rope_f32x4_pack_kernel(float *x, float *out, int seq_len,
                                       int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  float4 x_v = FLOAT4(x[idx * 4]);
  int token_pos = idx / N;
  int token_idx = idx % N;
  float exp_f_v = 1.0f / powf(theta, 2 * token_idx * 2 / (N * 4.0f));
  float exp_s_v = 1.0f / powf(theta, 2 * (token_idx * 2 + 1) / (N * 4.0f));
  float sin_f_v = sinf(token_pos * exp_f_v);
  float cos_f_v = cosf(token_pos * exp_f_v);
  float sin_s_v = sinf(token_pos * exp_s_v);
  float cos_s_v = cosf(token_pos * exp_s_v);
  float4 out_v;
  out_v.x = x_v.x * cos_f_v - x_v.y * sin_f_v;
  out_v.y = x_v.x * sin_f_v + x_v.y * cos_f_v;
  out_v.z = x_v.z * cos_s_v - x_v.w * sin_s_v;
  out_v.w = x_v.z * sin_s_v + x_v.w * cos_s_v;
  FLOAT4(out[idx * 4]) = out_v;
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

void rope_f32(torch::Tensor x, torch::Tensor out) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(out, torch::kFloat32)
  int seq_len = x.size(0);
  int hidden_size = x.size(1);
  int N = (int)(hidden_size / 2);
  dim3 grid((seq_len * N + BLOCK_SIZE - 1) / BLOCK_SIZE);
  dim3 block(BLOCK_SIZE);
  rope_f32_kernel<<<grid, block>>>(x.data_ptr<float>(), out.data_ptr<float>(),
                                   seq_len, N);
}

void rope_f32_v2(torch::Tensor x, torch::Tensor out) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(out, torch::kFloat32)
  int seq_len = x.size(0);
  int hidden_size = x.size(1);
  int N = (int)(hidden_size / 2);
  dim3 grid(seq_len);
  dim3 block(N);
  rope_f32_v2_kernel<<<grid, block>>>(x.data_ptr<float>(),
                                      out.data_ptr<float>(), seq_len, N);
}

void rope_f32x4_pack(torch::Tensor x, torch::Tensor out) {
  CHECK_TORCH_TENSOR_DTYPE(x, torch::kFloat32)
  CHECK_TORCH_TENSOR_DTYPE(out, torch::kFloat32)
  int seq_len = x.size(0);
  int hidden_size = x.size(1);
  int N = (int)(hidden_size / 4);
  dim3 grid((seq_len * N + BLOCK_SIZE - 1) / BLOCK_SIZE);
  dim3 block(BLOCK_SIZE);
  rope_f32x4_pack_kernel<<<grid, block>>>(x.data_ptr<float>(),
                                          out.data_ptr<float>(), seq_len, N);
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(rope_f32)
  TORCH_BINDING_COMMON_EXTENSION(rope_f32_v2)
  TORCH_BINDING_COMMON_EXTENSION(rope_f32x4_pack)
}
```

</details>

### `rope.py`
<details>
<summary> rope.py </summary>

```python
import time
from typing import Optional, Tuple

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="rope",
    sources=["rope.cu"],
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
    tag: str,
    out: Optional[torch.Tensor] = None,
    warmup: int = 2,
    iters: int = 20,
    show_all: bool = False,
):
    if out is not None:
        out.fill_(0)
    if out is not None:
        for i in range(warmup):
            perf_func(a, out)
    else:
        for i in range(warmup):
            _ = perf_func(a)
    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            perf_func(a, out)
    else:
        for i in range(iters):
            out = perf_func(a)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten().detach().cpu().numpy().tolist()[:3]
    out_val = [round(v, 8) for v in out_val]
    out_val = [f"{v:<12}" for v in out_val]
    print(f"{out_info:>20}: {out_val}, time:{mean_time:.6f}ms")
    if show_all:
        print(out)
    return out.clone(), mean_time


def naive_rope(
    x: torch.Tensor,
    theta: float = 10000.0,
) -> Tuple[torch.Tensor, torch.Tensor]:
    dim = x.shape[-1]
    seq_len = x.shape[-2]
    # get the shape of x (ignore the head dimension).
    # x: [batch_size, seq_len, dim]
    x_ = x.float().reshape(*x.shape[:-1], -1, 2)
    # x_: [batch_size, seq_len, dim//2, 2]
    x_ = torch.view_as_complex(x_)
    # pack neibored element into a complex
    # x_: [batch_size, seq_len, dim//2, 1]. eg: tensor([(1.6116-0.5772j), ...]
    freqs = 1.0 / (
        theta ** (torch.arange(0, dim, 2)[: (dim // 2)].float() / dim)
    )
    t = torch.arange(seq_len, device=freqs.device)
    freqs = torch.outer(t, freqs).float().cuda()
    freqs_cis = torch.polar(torch.ones_like(freqs), freqs)
    # get rotate angle
    xq_out = torch.view_as_real(x_ * freqs_cis).flatten(1)
    # do rotate
    return xq_out.type_as(x)


print("-" * 100)
M = [4096, 8192]
N = [512, 1024]
MN = [[m, n] for m in M for n in N]
for M, N in MN:
    print(" " * 40 + f"M={M}, N={N}")
    print("-" * 100)
    x = torch.randn((M, N)).cuda().float().contiguous()
    out = torch.zeros_like(x).cuda().float().contiguous()
    run_benchmark(lib.rope_f32, x, "f32", out)
    run_benchmark(lib.rope_f32x4_pack, x, "f32x4_pack", out)
    run_benchmark(naive_rope, x, "f32_th")
    print("-" * 100)
```

</details>

## 逐段代码剖析/学习

向量化宏、grid/block 映射、尾部处理——02 已覆盖；无 reduce，03~07 的东西这里不涉及。只讲新的。

---

```c++
#define theta 10000.0f

__global__ void rope_f32_kernel(float *x, float *out, int seq_len, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  float x1 = x[idx * 2];
  float x2 = x[idx * 2 + 1];
  int token_pos = idx / N;      // 第几个 token（行）
  int token_idx = idx % N;     // 该 token 的第几对（列）
  float exp_v = 1.0f / powf(theta, 2 * token_idx / (N * 2.0f));  // 频率
  float sin_v = sinf(token_pos * exp_v);
  float cos_v = cosf(token_pos * exp_v);
  float out1 = x1 * cos_v - x2 * sin_v;
  float out2 = x1 * sin_v + x2 * cos_v;
  out[idx * 2] = out1;
  out[idx * 2 + 1] = out2;
}
```

**朴素版**。数据布局：`x: (seq_len, hidden)`，hidden 两两配对，**一个线程负责一对**（2 个 float）。全局线程 `idx` 映射到 `(token_pos, token_idx)` 二维坐标靠 `/` 和 `%`。

几个值得抠的点：

- **`idx / N` 和 `idx % N`：整数除法/取模的代价**。GPU 没有整数除法硬件，`/` 和 `%` 都要编译成一串乘法移位近似（约 20 条指令），比一次浮点乘慢一个量级。这是"一维展平索引"方案的固有代价——好处是 grid/block 可以用满 256 线程的整齐 block，坏处是每个线程多付一次 div+mod。v2 版就是它的对照实验。
- **`powf(theta, e)` + `sinf` + `cosf`：超越函数很贵**。`powf` 展开是 `exp2f(e * log2f(theta))`，`sinf/cosf` 在 fast_math 下用 `__sinf/__cosf`（SFU 特殊函数单元，快但精度 ~1e-6）。一个线程要付 3 次超越函数 + 若干次乘加。**这是本系列第一个"计算受限"而非"访存受限"的 kernel**——前面 reduce/LN 系列全是搬数据为主，RoPE 是真的在算。
- **`theta^(2i/hidden)` 只依赖 `token_idx`，不依赖 `token_pos`**——同一列的所有线程算的频率完全一样，每个却都重算一遍 `powf`。这是朴素版的明显浪费（v2 用 threadIdx 直接当 token_idx，编译器也救不了跨 block 的重复计算；工业实现会把频率表预计算成 `(N,)` 张量一次 load，或用 `__constant__`/查表）。
- 每线程读 2 个、写 2 个相邻 float：**非向量化访存**（没有 FLOAT4），但 x1/x2 相邻、线程间连续，warp 内 32 线程覆盖 64 个连续 float，coalesce 后访存效率不差。

---

```c++
// another index method of rope.
__global__ void rope_f32_v2_kernel(float *x, float *out, int seq_len, int N) {
  int token_pos = blockIdx.x;   // 行 = block
  int tid = threadIdx.x;        // 列 = 线程
  float x1 = x[token_pos * N * 2 + tid * 2];
  ...
}
```

**v2：二维映射版**。`grid(seq_len)` 一个 block 一行、`block(N)` 一个线程一对——**把 `/` 和 `%` 全部消灭**，坐标由 blockIdx/threadIdx 直接给出。这是"一维展平 vs 二维映射"的经典权衡：

| | v1（展平） | v2（二维） |
|---|---|---|
| 索引成本 | 每线程 div+mod（~40 指令） | 乘加几次（几乎免费） |
| block 形状 | 整齐 256，任意形状都满 | block(N)，N=512 时 OK |
| 限制 | 无 | block ≤ 1024，N 非 2 幂时尾 warp 浪费 |

v2 看起来全面占优，但注意 host 侧 `dim3 block(N)` 要求 N ≤ 1024 且 dispatch 没有 switch 保护——隐藏维度大了直接崩。**展平方案的真正价值是"任意形状无脑通用"**，这就是为什么 03~07 的 dispatch 全走展平。

（benchmark 里 v2 没被测——只测了 f32 和 f32x4_pack，v2 留作教学对照。）

---

```c++
__global__ void rope_f32x4_pack_kernel(float *x, float *out, int seq_len,
                                       int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  float4 x_v = FLOAT4(x[idx * 4]);
  int token_pos = idx / N;
  int token_idx = idx % N;
  float exp_f_v = 1.0f / powf(theta, 2 * token_idx * 2 / (N * 4.0f));
  float exp_s_v = 1.0f / powf(theta, 2 * (token_idx * 2 + 1) / (N * 4.0f));
  ...4 组 sin/cos, 两对各自旋转...
  FLOAT4(out[idx * 4]) = out_v;
}
```

**x4 pack 版**：一个线程负责**两对**（4 个 float），`FLOAT4` 一次 load/store。注意关键细节：

- 两对元素的频率不同（`exp_f_v` 和 `exp_s_v`），要算 **8 个三角函数**（2 对 × sin/cos）——超越函数开销没省，反而因为两对的 token_idx 不同不能共享。
- 收益纯在访存：load/store 指令数减半（02 的老结论），而 coalesce 后带宽本来就够，所以实测只快 ~2%（0.00627 → 0.00602ms）。**这验证了 RoPE 是计算受限：访存优化在计算瓶颈面前收益微弱**。想真提速得砍 `powf/sinf/cosf`（预计算频率表），而不是向量化 load。

---

```python
def naive_rope(x, theta=10000.0):
    x_ = x.float().reshape(*x.shape[:-1], -1, 2)
    x_ = torch.view_as_complex(x_)          # 实数对 → 复数
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 2)[: (dim // 2)].float() / dim))
    freqs = torch.outer(t, freqs).float().cuda()
    freqs_cis = torch.polar(torch.ones_like(freqs), freqs)  # e^{iθ}
    xq_out = torch.view_as_real(x_ * freqs_cis).flatten(1)  # 复数乘 = 旋转
    return xq_out.type_as(x)
```

PyTorch 参考实现用了**复数视角**：`view_as_complex` 把 (x,y) 看成 x+yi，`torch.polar` 造单位复数 e^{iθ}，复数乘法 `(x+yi)(cosθ+isinθ)` 展开正好就是二维旋转矩阵——**复数乘法 ⊗ 2D 旋转，这是 RoPE 的数学本质**。但 eager 模式下这一串 view_as_complex/outer/polar/复数乘是七八个独立 kernel，每个都过一遍显存，实测比手写慢 **135 倍**（0.0063 vs 0.843ms）。又一次印证 06 的结论：**融合的收益来自减少 kernel 间显存往返**，这里的差距比 LN 还夸张，因为涉及的算子更多更碎。

## 实测数据（4090）

| M×N | f32 | f32x4_pack | naive(torch) |
|---|---|---|---|
| 4096×512 | 0.00627ms | 0.00602ms | 0.843ms |
| 4096×1024 | 0.01009ms | 0.00998ms | 1.425ms |
| 8192×512 | 0.01005ms | 0.00993ms | 1.418ms |
| 8192×1024 | 0.01866ms | 0.01843ms | 2.525ms |

- 手写 vs naive 稳定 **135x**——本系列至今最大差距（碎算子链 + 复数开销）。
- f32x4_pack 只快 1~2%：**计算受限 kernel 的访存优化天花板**。若要继续优化，方向是预计算 `theta` 频率表（省 powf）+ `__sincosf`（一次算 sin+cos，比分开算省一半 SFU 指令），而不是更宽的 load。

## 本篇小结

1. **RoPE = 成对元素的二维旋转**：复数乘法视角 `(x+yi)·e^{iθ}` 与旋转矩阵等价；低维对高频、高维对低频。
2. **第一个计算受限 kernel**：超越函数（powf/sinf/cosf）是主要开销，访存优化（x4 pack）只赚 2%——瓶颈判断决定优化方向。
3. **整数 div/mod 的代价**：GPU 无整数除法硬件，`idx/N`+`idx%N` 展平索引每线程 ~40 条指令；v2 的二维映射（blockIdx=行, threadIdx=列）免费拿到坐标，代价是 block 形状受限于 N。
4. **重复计算视角**：频率 `theta^(2i/h)` 只依赖列，朴素版每线程重算 powf 是纯浪费，工业实现预计算频率表。
5. **复数 PyTorch 实现慢 135x**：碎算子链的显存往返极端案例，融合价值的最强例证。
