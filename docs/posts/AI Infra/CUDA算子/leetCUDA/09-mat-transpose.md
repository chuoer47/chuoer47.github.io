---
title: Mat Transpose
order: 9
---

# Mat Transpose CUDA代码学习

> 本人学习笔记，AI总结

矩阵转置是**访存模式**教学的经典案例：计算量为零（纯搬数据），性能 100% 由访存决定。它把"访存对齐"这个在 elementwise/reduce 里被计算掩盖的问题，放大到肉眼可见。本篇慢慢走：每个 kernel 从数据布局开始画，索引公式代入具体线程一步步算，最后再看 bank conflict 的数字算例。

## 第 0 步：理解 GPU 访存的一条黄金法则

在讲转置之前，必须先把 **coalesced access（合并访存）**讲透，因为本篇所有性能差异都是它的直接后果。

**warp 是访存的基本单位**。一个 warp 的 32 个线程如果**同时发出访存指令**（比如都执行 `x[idx]`），硬件不是真的发 32 次独立请求，而是把这 32 个地址**合并（coalesce）**：

```
情况 A (coalesced): warp 内 32 个线程访问连续地址
  线程0→x[0], 线程1→x[1], ..., 线程31→x[31]  (每个 4 字节, 共 128 字节连续)
  → 硬件合并成 1 次 128 字节事务, 一次搬运全部搞定 ✓

情况 B (uncoalesced): warp 内 32 个线程访问散开的地址
  线程0→x[0], 线程1→x[1024], 线程2→x[2048], ... (每个隔 4KB)
  → 32 个地址落在 32 条不同的 cache line 上
  → 硬件被迫发 32 次独立事务, 每次只搬 128 字节但只用 4 字节
  → 带宽利用率 4/128 = 1/32 ✗
```

为什么是 128 字节？global memory 和 L2 之间按 **cache line（128B）**传输，一个 line 装 32 个 float。情况 A 恰好把一条 line 装满用光；情况 B 每个 4 字节都要拉一整条 line，浪费 31/32。

**记住标尺：coalesced = 1，uncoalesced = 32 倍访存开销。** 下面所有版本的性能差距，都是这个 32 倍标尺的不同表现形式。

## 第 1 步：转置问题本身

输入 `x: (M, N)`，输出 `y: (N, M)`，满足 `y[c][r] = x[r][c]`。

先在纸上把内存布局画出来。`x` 是 row-major（行优先），二维下标到一维地址的映射：

```
x[r][c] 的地址 = r * N + c        (N 是列数, 即每行多少个)

以 M=4, N=8 为例, x 的内存:
      c=0  c=1  c=2  c=3  c=4  c=5  c=6  c=7
r=0 [  0    1    2    3    4    5    6    7 ]   ← 逻辑值(取 x[r][c]=r*8+c)
r=1 [  8    9   10   11   12   13   14   15 ]
r=2 [ 16   17   18   19   20   21   22   23 ]
r=3 [ 24   25   26   27   28   29   30   31 ]
     ↑ 每行 8 个连续, 行与行也连续(共 32 个 float 一根直线)
```

`y` 是 `(N, M) = (8, 4)` 的矩阵，`y[c][r] = x[r][c]`：

```
      r=0  r=1  r=2  r=3
c=0 [  0    8   16   24 ]
c=1 [  1    9   17   25 ]
c=2 [  2   10   18   26 ]
...
c=7 [  7   15   23   31 ]
```

**看 x 的第 0 行（0,1,2,...,7）去哪了**：它们变成 y 的第 0 列（y[0][0], y[1][0], ..., y[7][0]），在 y 的内存里地址是 `0, 4, 8, ..., 28`（间隔 M=4 个 float，即 stride=4）。

**这就是转置的天然矛盾**：

```
同一批数据 (x 的一行):  在 x 里连续 (地址差 1)
                       在 y 里散开 (地址差 M)
反过来: y 里连续的数据 (y 的一行 = x 的一列), 在 x 里也是散开的 (地址差 N)
```

**"读连续"和"写连续"不可兼得**——一个 warp 的 32 个线程要么顺着 x 的行搬（读 coalesced、写 uncoalesced），要么顺着 y 的行搬（写 coalesced、读 uncoalesced）。本篇所有版本，都是在这个矛盾里选边、然后想办法补救。

## 完整代码

### `mat_transpose.cu`
<details>
<summary> mat_transpose.cu（手写部分，CuTe 版另见）</summary>

```c++
#include <algorithm>
#include <cuda_fp16.h>
#include <cuda_fp8.h>
#include <cuda_runtime.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>

#define WARP_SIZE 256
#define WARP_SIZE_S 16
#define PAD 1
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])

// FP32
// col2row means read x[row][col] and write y[col][row]
__global__ void mat_transpose_f32_col2row_kernel(float *x, float *y,
                                                 const int row, const int col) {
  const int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_row = global_idx / col;
  const int global_col = global_idx % col;
  if (global_idx < row * col) {
    y[global_col * row + global_row] = x[global_idx];
  }
}

// row2col means read x[col][row] and write y[row][col]
__global__ void mat_transpose_f32_row2col_kernel(float *x, float *y,
                                                 const int row, const int col) {
  const int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_col = global_idx / row;
  const int global_row = global_idx % row;
  if (global_idx < row * col) {
    y[global_idx] = x[global_row * col + global_col];
  }
}

__global__ void mat_transpose_f32x4_col2row_kernel(float *x, float *y,
                                                   const int row,
                                                   const int col) {
  int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  int global_col = (global_idx * 4) % col;
  int global_row = (global_idx * 4) / col;

  if (global_row < row && global_col + 3 < col) {
    float4 x_val = reinterpret_cast<float4 *>(x)[global_idx];

    y[global_col * row + global_row] = x_val.x;
    y[(global_col + 1) * row + global_row] = x_val.y;
    y[(global_col + 2) * row + global_row] = x_val.z;
    y[(global_col + 3) * row + global_row] = x_val.w;
  }
}
__global__ void mat_transpose_f32x4_row2col_kernel(float *x, float *y,
                                                   const int row,
                                                   const int col) {
  const int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_col = (global_idx * 4) / row;
  const int global_row = (global_idx * 4) % row;

  if (global_row < row && global_col < col) {
    float4 x_val;
    x_val.x = x[global_row * col + global_col];
    x_val.y = x[(global_row + 1) * col + global_col];
    x_val.z = x[(global_row + 2) * col + global_col];
    x_val.w = x[(global_row + 3) * col + global_col];
    reinterpret_cast<float4 *>(y)[global_idx] = FLOAT4(x_val);
  }
}

// work for row == col
__global__ void mat_transpose_f32_diagonal2d_kernel(float *x, float *y, int row,
                                                    int col) {
  const int block_y = blockIdx.x;
  const int block_x = (blockIdx.x + blockIdx.y) % gridDim.x;
  const int global_col = threadIdx.x + blockDim.x * block_x;
  const int global_row = threadIdx.y + blockDim.y * block_y;
  if (global_col < col && global_row < row) {
    y[global_row * col + global_col] = x[global_col * row + global_row];
  }
}

__global__ void mat_transpose_f32_col2row2d_kernel(float *x, float *y,
                                                   const int row,
                                                   const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  if (global_x < col && global_y < row) {
    y[global_x * row + global_y] = x[global_y * col + global_x];
  }
}

__global__ void mat_transpose_f32_row2col2d_kernel(float *x, float *y,
                                                   const int row,
                                                   const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  if (global_y < col && global_x < row) {
    y[global_y * row + global_x] = x[global_x * col + global_y];
  }
}

__global__ void mat_transpose_f32x4_col2row2d_kernel(float *x, float *y,
                                                     const int row,
                                                     const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  if (global_x * 4 + 3 < col && global_y < row) {
    float4 x_val = reinterpret_cast<float4 *>(x)[global_y * col / 4 + global_x];
    y[(global_x * 4) * row + global_y] = x_val.x;
    y[(global_x * 4 + 1) * row + global_y] = x_val.y;
    y[(global_x * 4 + 2) * row + global_y] = x_val.z;
    y[(global_x * 4 + 3) * row + global_y] = x_val.w;
  }
}

__global__ void mat_transpose_f32x4_row2col2d_kernel(float *x, float *y,
                                                     const int row,
                                                     const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  if (global_y * 4 + 3 < row && global_x < col) {
    float4 x_val;
    x_val.x = x[(global_y * 4) * col + global_x];
    x_val.y = x[(global_y * 4 + 1) * col + global_x];
    x_val.z = x[(global_y * 4 + 2) * col + global_x];
    x_val.w = x[(global_y * 4 + 3) * col + global_x];
    reinterpret_cast<float4 *>(y)[global_x * row / 4 + global_y] =
        FLOAT4(x_val);
  }
}

__global__ void mat_transpose_f32x4_shared_col2row2d_kernel(float *x, float *y,
                                                            const int row,
                                                            const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  const int local_x = threadIdx.x;
  const int local_y = threadIdx.y;
  __shared__ float tile[16][64];
  if (global_x * 4 + 3 < col + 3 && global_y < row) {
    // load value from x to shared memory
    float4 x_val = reinterpret_cast<float4 *>(x)[global_y * col / 4 + global_x];
    FLOAT4(tile[local_y][local_x * 4]) = FLOAT4(x_val);
    __syncthreads();
    float4 smem_val;
    // load value from shared memory to y.
    // add STRIDE to satisfied different block size.
    constexpr int STRIDE = 16 / 4;
    smem_val.x =
        tile[(local_y % STRIDE) * 4 + 0][local_x * 4 + local_y / STRIDE];
    smem_val.y =
        tile[(local_y % STRIDE) * 4 + 1][local_x * 4 + local_y / STRIDE];
    smem_val.z =
        tile[(local_y % STRIDE) * 4 + 2][local_x * 4 + local_y / STRIDE];
    smem_val.w =
        tile[(local_y % STRIDE) * 4 + 3][local_x * 4 + local_y / STRIDE];
    // map index n*n to (n/4)*(n*4)
    const int bid_y = blockIdx.y * blockDim.y;
    const int out_y = global_x * 4 + local_y / STRIDE;
    const int out_x = (local_y % STRIDE) * 4 + bid_y;
    reinterpret_cast<float4 *>(y)[(out_y * row + out_x) / 4] = FLOAT4(smem_val);
  }
}

__global__ void mat_transpose_f32x4_shared_bcf_col2row2d_kernel(float *x,
                                                                float *y,
                                                                const int row,
                                                                const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  const int local_x = threadIdx.x;
  const int local_y = threadIdx.y;
  __shared__ float tile[16][64 + PAD];   // ← PAD=1, bank conflict free
  if (global_x * 4 + 3 < col + 3 && global_y < row) {
    // load value from x to shared memory
    float4 x_val = reinterpret_cast<float4 *>(x)[global_y * col / 4 + global_x];
    tile[local_y][local_x * 4] = x_val.x;
    tile[local_y][local_x * 4 + 1] = x_val.y;
    tile[local_y][local_x * 4 + 2] = x_val.z;
    tile[local_y][local_x * 4 + 3] = x_val.w;
    __syncthreads();
    float4 smem_val;
    constexpr int STRIDE = 16 / 4;
    smem_val.x = tile[(local_y % STRIDE) * 4][local_x * 4 + local_y / STRIDE];
    smem_val.y =
        tile[(local_y % STRIDE) * 4 + 1][local_x * 4 + local_y / STRIDE];
    smem_val.z =
        tile[(local_y % STRIDE) * 4 + 2][local_x * 4 + local_y / STRIDE];
    smem_val.w =
        tile[(local_y % STRIDE) * 4 + 3][local_x * 4 + local_y / STRIDE];
    const int bid_y = blockIdx.y * blockDim_y_;
    const int out_y = global_x * 4 + local_y / STRIDE;
    const int out_x = (local_y % STRIDE) * 4 + bid_y;
    reinterpret_cast<float4 *>(y)[(out_y * row + out_x) / 4] = FLOAT4(smem_val);
  }
}

// ... shared_row2col / bcf_row2col / bcf_merge_write 同构,
//     host 侧 TORCH_BINDING 宏与 CuTe 绑定见仓库源文件
```

</details>

### `mat_transpose.py`
<details>
<summary> mat_transpose.py </summary>

```python
import time
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="mat_transpose_lib",
    sources=["mat_transpose.cu", "mat_transpose_cute.cu"],
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
    extra_include_paths=[".../third-party/cutlass/include"],
)

def run_benchmark(
    perf_func: callable,
    a: torch.Tensor,
    tag: str,
    out: Optional[torch.Tensor] = None,
    warmup: int = 10,
    iters: int = 1000,
    show_all: bool = False,
):
    # ... 与前面各篇 run_benchmark 同构;
    #     额外做 validate: out == x.t().contiguous() 则 validate True
    return out, mean_time


M = [1024, 2048, 4096]
N = [1024, 2048, 4096]
MN = [(m, n) for m in M for n in N]
for M, N in MN:
    print("-" * 130)
    print(" " * 55 + f"M={M}, N={N}")
    x = torch.arange(M * N).reshape(M, N).cuda().float().contiguous()
    out = torch.zeros(N, M).cuda().float().contiguous()
    run_benchmark(x.t().contiguous(), x, "original", out)      # lazy 视图对照
    run_benchmark(lib.mat_transpose_f32_col2row, x, "f32_col2row", out)
    run_benchmark(lib.mat_transpose_f32_row2col, x, "f32_row2col", out)
    # ... 2d / diagonal / x4 / shared / bcf / cute 系列 + torch 对照
```

</details>

## 第 2 步：col2row —— 顺着 x 的线性序走

```c++
__global__ void mat_transpose_f32_col2row_kernel(float *x, float *y,
                                                 const int row, const int col) {
  const int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_row = global_idx / col;
  const int global_col = global_idx % col;
  if (global_idx < row * col) {
    y[global_col * row + global_row] = x[global_idx];
  }
}
```

**选边：保读，牺牲写。** 线性 `global_idx` 直接当 x 的地址（`x[global_idx]`，读端 warp 内天然连续），算出它对应的二维坐标 `(global_row, global_col)`，写到 y 的对应位置。

**代入具体数字**。设 M=row=4, N=col=8（就是第 1 步那个小矩阵），blockDim=8，warp 里的线程 0..7 处理 x 的第 0 行：

```
线程 t:  global_idx = t
         global_row = t / 8 = 0            (整除, 0..7 都在行 0)
         global_col = t % 8 = t
读:      x[t]                              → 地址 0..7, 连续 ✓ coalesced
写:      y[global_col * row + global_row] = y[t * 4 + 0]
         → 地址 0, 4, 8, 12, 16, 20, 24, 28  → stride=4, 散开 ✗
```

**写端到底有多惨？** 用 128B line 的标尺算：线程 0 写 y 地址 0（4 字节），这条 line（y[0..31]）被拉进 cache，写 4 字节，剩 28 字节没用；线程 1 写 y 地址 4——**还在同一条 line 里！** 8 个线程写地址 0..28，其实全在 y 的第 0 条 line（0..127 字节 = 32 个 float）内。所以真实开销不是 8 次事务，而是**这条 line 上的"读-改-写"**：硬件写前要先把 line 读进来（write-allocate），改 8 个格子里的 4 字节，最后写回。

惨的地方在**真实尺寸**：M=1024 时写端 stride=1024×4B=4KB，warp 32 个线程的写地址横跨 32 条**不同** line——每条 line 都要走一次"拉进来（128B）→ 改 4B → 写回"，**有效带宽利用率 4/128 = 3%**。写端成了 32 倍税。

实测（1024×1024）：**0.0318ms**。

## 第 3 步：row2col —— 顺着 y 的线性序走（镜像选边）

```c++
__global__ void mat_transpose_f32_row2col_kernel(float *x, float *y,
                                                 const int row, const int col) {
  const int global_idx = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_col = global_idx / row;
  const int global_row = global_idx % row;
  if (global_idx < row * col) {
    y[global_idx] = x[global_row * col + global_col];
  }
}
```

**选边：保写，牺牲读。** 现在线性 `global_idx` 直接当 **y** 的地址（写端连续），反推它对应 x 的哪个元素。

同样代入 M=4, N=8，注意现在 `global_idx` 是按 **y 的布局**（y 是 8 行 4 列，`global_idx = global_col * 4 + global_row`，所以 `global_col = idx/4`、`global_row = idx%4`）：

```
线程 t:  global_idx = t
         global_col = t / 4    (y 的行 = x 的列)
         global_row = t % 4    (y 的列 = x 的行)
写:      y[t]                  → 地址 0..7, 连续 ✓ coalesced
读:      x[global_row * col + global_col] = x[(t%4) * 8 + t/4]
         t=0→x[0], t=1→x[8], t=2→x[16], t=3→x[24],
         t=4→x[1], t=5→x[9], ...
         → 地址 0,8,16,24,1,9,...  → stride=8, 散开 ✗
```

读散写连。**实测 0.0162ms——比 col2row 快一倍**。

**为什么读散比写散便宜？** 同样是 32 倍税的散访存，读和写的实现不一样：

- **离散读**：32 条 line 各拉 128B 进 cache，每条只用 4B。浪费，但拉进来就完事，而且 L2 里这批 line 后续 warp 可能复用（相邻 warp 读相邻列段）。
- **离散写**：write-allocate——写之前**先把整条 line 从内存读进来**（因为只改 4B，得保住其他 124B），改完再**整条写回**。等于散写的每次 4B 有效写入背后是一次 128B 读 + 一次 128B 写，**双倍搬运**。

所以经验法则：**两头只能保一个时，保写端**。这个法则后面所有版本都在遵守。

## 第 4 步：2D 化 —— 让 block 的形状贴合矩阵

```c++
__global__ void mat_transpose_f32_row2col2d_kernel(float *x, float *y,
                                                   const int row,
                                                   const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  if (global_y < col && global_x < row) {
    y[global_y * row + global_x] = x[global_x * col + global_y];
  }
}
```

1D 版每线程要付 `idx/col + idx%col` 两次整数除法（08 讲过 ~40 条指令）。2D 版让 **blockIdx.y 直接当"行号"**、threadIdx.y 当行内偏移，除法直接消失。这里 block 是 `(WARP_SIZE_S, WARP_SIZE_S) = (16,16)`——**一个 block 处理一个 16×16 的 tile**：

```
x 的视角: block(0,0) 处理 x[0..15][0..15] 的方块
```

但要分析访存，得先搞清楚 **(16,16) 的 block 里 warp 是怎么切线程的**——这是 2D block 的关键细节，不搞清楚它，后面所有访存分析都是猜的。

**threadIdx.x 是"最快变化"的维度**：硬件给线程编号时先把 x 排满再排 y（线性化顺序：x 优先）。而 warp 是**按线性编号连续切 32 个**。block(16,16) 共 256 线程 = 8 个 warp，切法是：

```
warp 0 = threadIdx (x=0..15, y=0) ∪ (x=0..15, y=1)    ← 每行只有 16 个线程,
warp 1 = threadIdx (x=0..15, y=2) ∪ (x=0..15, y=3)      所以每个 warp 占两"行"
warp 2 = (y=4,5)   warp 3 = (y=6,7)   ...
```

即：**warp 内 threadIdx.x 连续跑 0..15（y 固定），然后 y+1 再跑 0..15**。对应到矩阵坐标（设 M=col=1024，block(0,0)）：

```
warp 0 的 32 个线程的 (global_x, global_y):
  (0,0) (1,0) (2,0) ... (15,0)   ← 前一半: global_x=0..15, global_y=0
  (0,1) (1,1) (2,1) ... (15,1)   ← 后一半: global_x=0..15, global_y=1
```

**逐个代入访存公式，看读端**。读地址 = `x[global_x * col + global_y]`（global_x 是 x 的**行**、global_y 是 x 的**列**）：

```
线程 (0,0): x[0*1024+0]    = x[0]
线程 (1,0): x[1*1024+0]    = x[1024]     ← 行 +1, 地址跳 1024
线程 (2,0): x[2*1024+0]    = x[2048]     ← 再跳 1024
...
线程 (15,0): x[15360]
线程 (0,1): x[0*1024+1]    = x[1]        ← 列 +1, 地址 +1 (但已经离 x[0] 很远)
线程 (1,1): x[1025]
...
→ 32 个地址 = {r·1024 + c : r=0..15, c=0或1}
→ 落在 16 条不同的 128B line 上, 每条 line 只用 2 个 float (8 字节)
→ 读端利用率 2/32 ✗✗ (比 1D 版的整行散还要碎)
```

**再看写端**。写地址 = `y[global_y * row + global_x]`（global_y 是 y 的行、global_x 是 y 的**列**）：

```
线程 (0,0): y[0*1024+0]    = y[0]
线程 (1,0): y[0*1024+1]    = y[1]        ← 列 +1, 地址 +1, 连续!
线程 (2,0): y[2]      ...  线程 (15,0): y[15]
线程 (0,1): y[1*1024+0]    = y[1024]     ← 行 +1, 跳到下一行
线程 (1,1): y[1025]   ...  线程 (15,1): y[1039]
→ 32 个地址 = {c + r·1024 : c=0..15, r=0或1}
→ 拼成两段各 16 个连续 float (64 字节): y[0..15] 和 y[1024..1039]
→ 每段恰好半个 128B line, 利用率 16/32 = 50% ✓ (虽然不完美, 但比读端好 8 倍)
```

**对照着看就明白了**：warp 内 threadIdx.x 连续 → `global_x` 连续 → 它在**读公式里是行**（地址跳 1024，惨）、在**写公式里是列**（地址 +1，连续）。同一个"线程编号连续"的事实，在读写两端产生完全相反的效果——这正是"选边"：**2D row2col 选了让连续的 threadIdx.x 对应 y 的列（写端）**。代价是读端比 1D 版更碎（16 条 line 用 2 个 float vs 32 条 line 用 4 个 float），但写端的 write-allocate 代价更贵（第 3 步的结论），总体还是赚的。

实测 **0.0047ms**（1D 版 0.0162ms，快 3.4x）。收益来源：① 消灭 div/mod；② 写端从"每 4B 一条 line"变成"每 64B 半条 line"；③ 16×16 tile 的访存模式规整，编译器/硬件的预取和 L2 局部性都更好。

## 第 5 步：x4 向量化 —— 一个陷阱案例

```c++
__global__ void mat_transpose_f32x4_row2col2d_kernel(...) {
  // 一个线程搬 4 个元素: 读 x 竖着 4 个, 写 y 横着 4 个(float4)
  x_val.x = x[(global_y * 4) * col + global_x];       // 读端: 4 次散读
  x_val.y = x[(global_y * 4 + 1) * col + global_x];
  x_val.z = x[(global_y * 4 + 2) * col + global_x];
  x_val.w = x[(global_y * 4 + 3) * col + global_x];
  reinterpret_cast<float4 *>(y)[...] = FLOAT4(x_val); // 写端: 1 次 16B 连写
}
```

row2col 方向的 x4：**写端 float4 一条 128bit 指令（16B），读端 4 条散指令**。写端从"每线程 4B"变成"每线程 16B"，同一条 line 的利用率 16/128——**写端事务数降为 1/4**。实测 **0.0039ms**（vs f32 版 0.0047ms）✓ 有效。

但**反方向的 col2row x4 是个陷阱**：

```c++
// col2row 的 x4: 读端 float4 (连续 4 个), 写端 4 次散写
float4 x_val = reinterpret_cast<float4 *>(x)[...];   // 读: 1 次 16B ✓
y[global_col * row + global_row] = x_val.x;          // 写: 4 次散写 ✗
y[(global_col + 1) * row + global_row] = x_val.y;    //    且散开的距离从
y[(global_col + 2) * row + global_row] = x_val.z;    //    stride=row 变成
y[(global_col + 3) * row + global_row] = x_val.w;    //    4 个不同列的同一点
```

它把向量化用在了**本来就不是瓶颈的读端**，而写端的离散度一点没变（还是每 4B 一条 line）。实测 col2row x4 = 0.0324ms vs f32 col2row = 0.0318ms——**没有收益甚至略慢**（多出来的寄存器搬运）。

**教训**：向量化不是无条件加速。它加速的是"你用它搬数据的那一端"，**先判断瓶颈在哪端，再向量化那一端**。elementwise 里读写对称所以 x4 无脑赢；转置这种非对称场景，向量化错端就是白干。

## 第 6 步：shared memory staging —— 教科书解法

前面所有版本都在"选边"：要么读散要么写散。**shared memory 版说：我不选了，两头都要。**

```c++
__global__ void mat_transpose_f32x4_shared_col2row2d_kernel(float *x, float *y,
                                                            const int row,
                                                            const int col) {
  const int global_x = blockIdx.x * blockDim.x + threadIdx.x;
  const int global_y = blockIdx.y * blockDim.y + threadIdx.y;
  const int local_x = threadIdx.x;
  const int local_y = threadIdx.y;
  __shared__ float tile[16][64];
  if (global_x * 4 + 3 < col + 3 && global_y < row) {
    // 第一步: coalesced 读 x, 存进 tile
    float4 x_val = reinterpret_cast<float4 *>(x)[global_y * col / 4 + global_x];
    FLOAT4(tile[local_y][local_x * 4]) = FLOAT4(x_val);
    __syncthreads();
    // 第二步: 从 tile 转置取数, coalesced 写 y
    constexpr int STRIDE = 16 / 4;
    smem_val.x = tile[(local_y % STRIDE) * 4 + 0][local_x * 4 + local_y / STRIDE];
    ...
    reinterpret_cast<float4 *>(y)[(out_y * row + out_x) / 4] = FLOAT4(smem_val);
  }
}
```

**思路**：global 内存做不到"读写都连续"，但 shared memory 是 block 私有的高速暂存（~20 cycle 延迟、无 cache line 概念、跳步访问没有 32 倍税）。于是：

```
x (global) --coalesced 行读--> tile (shared) --任意方式取--> 寄存器 --coalesced 写--> y (global)

"跳步"被关进了 shared memory, 两端 global 访问都是连续的
```

这个 block 的分工：block(16,16) 处理 x 的一个 **16 行 × 64 列** tile（每线程 float4 管 4 列），写到 y 的一个 **64 行 × 16 列** tile。

**拿一个具体线程走一遍全程**。设 block(0,0)，`threadIdx = (local_x=3, local_y=5)`，矩阵 col=1024。盯住这一个线程，看它的 4 个数从哪来、在 tile 里躺哪、最后写到 y 的哪：

**第一步：读 x，存 tile（横着进）**

```
global_x = 3, global_y = 5

读:  x 的第 5 行、第 12..15 列
     (float4 视角: 第 5 行的第 3 号 float4 = x 的 5*1024 + 12..15 号 float)
存:  tile[local_y][local_x * 4 .. +3] = tile[5][12..15]
     (tile 的第 5 行、第 12..15 格)

对应关系: tile 的行号 = x 的行号 (local_y ↔ global_y)
          tile 的列号 = x 的列号 (local_x*4 ↔ global_x*4)
     → tile 就是 x 这块 16×64 数据的"原样照搬", 方向不变
```

整个 block 干完后，tile 是 x 第 0..15 行 × 第 0..63 列的完整拷贝（每线程填 4 格）。

**第二步：从 tile 竖着取（转置发生在这里）**

```
STRIDE = 16 / 4 = 4

smem_val.x = tile[(local_y % 4)*4 + 0][local_x*4 + local_y/4]
smem_val.y = tile[(local_y % 4)*4 + 1][同列]
smem_val.z = tile[(local_y % 4)*4 + 2][同列]
smem_val.w = tile[(local_y % 4)*4 + 3][同列]

代入 local_x=3, local_y=5:
  行 = (5%4)*4 + 0..3 = 4, 5, 6, 7
  列 = 3*4 + 5/4 = 13
  → 取 tile[4][13], tile[5][13], tile[6][13], tile[7][13]
  → 第 13 列、第 4..7 行: 同一列竖着 4 个 ✓
```

这 4 个数在原矩阵 x 里是**第 4..7 行、第 13 列**——4 个不同行、同一列的数。

**第三步：写 y（横着出）**

```c++
const int bid_y = blockIdx.y * blockDim.y;             // = 0
const int out_y = global_x * 4 + local_y / STRIDE;     // = 3*4 + 1 = 13
const int out_x = (local_y % STRIDE) * 4 + bid_y;      // = 1*4 + 0 = 4
reinterpret_cast<float4 *>(y)[(out_y * row + out_x) / 4] = FLOAT4(smem_val);
```

代入得 `out_y=13, out_x=4`——写的是 **y 的第 13 行、第 4..7 列**（一个 float4，4 个连续格子）。

**三步连起来看（这就是转置的全部）**：

```
x 的第 4..7 行、第 13 列          (4 个数, 竖着排, 散在 4 行)
    ↓ 第一步: 横着读进 tile (谁读的? 拥有这些格子的 4 个不同线程)
    ↓ 第二步: 本线程从 tile 竖着取出来 (tile[4..7][13])
    ↓ 第三步: 写到 y 的第 13 行、第 4..7 列 (横着排, 4 个连续格子!)

行号 4..7 变成了列号 4..7, 列号 13 变成了行号 13 —— x[i][j] → y[j][i], 严格转置
且写端是 float4: 同一行的 4 个连续 float, 一条 128bit 指令 ✓
```

至于 `(local_y % 4)` / `(local_y / 4)` 那套下标体操：

- 它解决的是"16 个 local_y 值怎么既当 tile 的行号用（第一步存）、又当 y 的列号用（第三步写）"的编排问题——把 0..15 拆成 `q*4+r`（q=local_y/4, r=local_y%4），r 决定取 tile 的哪个行块、q 决定写到 y 的哪个列块。

**不必背这套公式，记住三步的形状就够：横着进、竖着取、横着出，进出都是 coalesced，"竖"被关在 smem 里**。

实测 0.0040ms。对比发现：它和"直接写端向量化"（f32x4_row2col2d 的 0.0039ms）**打平**！为什么 staging 没有碾压？因为 row2col 路线（写连续）只损失读端，读散的代价（~32x 但被 L2 缓解）本来就小于写散——staging 把读端也救回来了，但救回来的部分只占总时间的小头。**staging 的真正威力要等两端都必须连续的 kernel（GEMM）**，那里它是唯一解。

`__syncthreads()` 的位置是精髓：第二步要从 tile 取"别的线程存的格子"（比如本线程取的 tile[4][13] 是 (local_x=3, local_y=4) 那个线程存的）——必须等**所有**线程把 tile 填完才能开始竖取，否则读到垃圾。这是 03 见过的 block 栅栏在"生产-消费"模式下的用法。

## 第 7 步：bank conflict —— shared memory 的隐形税

staging 把矛盾转移进了 shared memory，但 smem 自己也有一条税则：**bank conflict**。

**smem 的物理结构**：shared memory 被切成 **32 个 bank**（和 warp 的 32 线程对应），每个 bank 宽 4 字节、有独立的读写端口。一个 warp 访问 smem 时：

```
32 个线程 → 32 个地址 → 按每 4 字节一段映射到 bank:  bank_id = (地址/4) % 32

情况 A: 32 个线程落在 32 个不同 bank → 32 路并行, 1 个 cycle 完成 ✓
情况 B: 2 个线程落同一 bank (不同地址) → 这两个串行, 2 个 cycle (2-way conflict)
情况 C: 32 个线程全挤同一 bank → 32 个 cycle, 慢 32 倍 ✗✗
例外:   32 个线程读同一地址 → broadcast, 不算 conflict, 1 个 cycle ✓
```

**转置读 tile 为什么会撞 bank？** 拿真实数字算。tile 是 `float tile[16][64]`，C 语言的二维数组**每行连续**，`tile[r][c]` 的地址 = `r*64 + c`（float 计），bank = `(r*64 + c) % 32`。

竖着取一列时（第 6 步的模式），warp 内 32 个线程取 `tile[r0..][c]` 形式的地址。看**相邻两行同列**：

```
tile[4][13] 的 bank = (4*64 + 13) % 32 = (256+13) % 32 = 269 % 32 = 13
tile[5][13] 的 bank = (5*64 + 13) % 32 = (320+13) % 32 = 333 % 32 = 13   ← 撞了!
tile[6][13] 的 bank = (6*64 + 13) % 32 = 397 % 32 = 13                   ← 撞了!
```

**行 +1，地址 +64，64 % 32 = 0，bank 号纹丝不动。** 行宽是 64（32 的倍数）时，同一列的所有元素 bank 号全相同——竖取一列 = 全挤一个 bank，**32-way conflict，慢 32 倍**（实际 warp 按 4 线程一组取不同行块，是 2~4 way，但本质相同）。

**解法蠢但有效——padding**：

```c++
#define PAD 1
__shared__ float tile[16][64 + PAD];    // 行宽 64 → 65
```

再算：

```
tile[4][13] 的 bank = (4*65 + 13) % 32 = 273 % 32 = 17
tile[5][13] 的 bank = (5*65 + 13) % 32 = 338 % 32 = 18   ← 错开 1, 不撞 ✓
tile[6][13] 的 bank = (7*65+13) % 32 = 468 % 32 = 19      ← 再错开 1 ✓
```

**行 +1，地址 +65，65 % 32 = 1，每下一行 bank 错开 1**——竖取一列的 4 个数落在 4 个不同 bank，conflict 消失。这就是 padding 的全部原理：**让行跨度不再是 32 的倍数，行与行的 bank 自然错开**。

**padding 的代价**（看代码就知道）：

```c++
// 无 pad 版(行宽 64): 一条 FLOAT4 写 tile (16B 对齐 ✓)
FLOAT4(tile[local_y][local_x * 4]) = FLOAT4(x_val);

// pad 版(行宽 65): 退化为 4 条逐元素写
tile[local_y][local_x * 4]     = x_val.x;
tile[local_y][local_x * 4 + 1] = x_val.y;
...
```

行宽 65 后，`tile[r][c*4]` 的字节地址不再保证 16 字节对齐（回忆 04 的对齐课：65 个 float = 260 字节，260 % 16 = 4 ≠ 0）——**FLOAT4 会 misaligned 崩，只能退化为 4 条标量写**。所以 padding 不是免费的：它用"load 端向量化"换"读端 bank 无冲突"。哪个划算要看 conflict 的倍数（32-way 才值得，2~4-way 时损失向量化反而亏）。

**实测**（1024×1024，本 kernel 的 conflict 只有轻度）：bcf 版 0.0039ms vs 无 pad 版 0.0040ms——基本持平。**bank conflict 的伤害要在 smem 密集型 kernel（GEMM 的 tile 复用、卷积的 im2col）里才成倍放大**，这里只是预习。量化工具：NCU 的 `l1tex__data_bank_conflicts_pipe_lsu_mem_shared` 指标。

> 更高阶的解法（CuTe 版用的）：**swizzle**——不改行宽，而是用比特运算重排 tile 内的存储位置（把 `(r, c)` 映射到 `(r, c ^ (r & 7))` 之类的交错位置），既保对齐又消 conflict。GEMM 篇会正式讲。

## 第 8 步：对角线调度与杂项

**对角线调度**：

```c++
const int block_y = blockIdx.x;
const int block_x = (blockIdx.x + blockIdx.y) % gridDim.x;   // 方阵专属
```

普通调度（blockIdx.x → 列、blockIdx.y → 行）下，同一波活跃的 block 在读 x 的**相邻行**、写 y 的**相距很远的列段**——y 的写地址在 L2 里东一块西一块。对角线调度让同一波 block 的**写端列段也相邻**（沿对角线走），L2 友好。实测 0.0048ms，与普通 2D 持平（L2 64MB 很大时差异被吸收）。它是"**block 调度顺序影响 cache 行为**"的启蒙——第二阶段 GEMM 的 tile swizzle 调度是同思想的完全体。

**PyTorch 的 lazy transpose**：实测表里 `out_original`（`x.t()`）一行 validate **False**——不是算错，是 `.t()` 只改 stride 不搬数据（0.007ms 是启动开销），打印的值还是 x 原布局。`.t().contiguous()` 才真转置（0.0189ms，还比手写慢 5 倍）。生产代码里 `A.t() @ B` 会走 cuBLAS 的 trans_a 参数路线，**永远不做物理转置**。

**CuTe 系列**：同一堆技巧（staging/padding/合并写）用 CUTLASS CuTe DSL 的 layout 原语重写，单独成篇：[10 - Mat Transpose (CuTe)](./10-mat-transpose-cute.md)。

## 实测数据（4090, M=N=1024）

| kernel | 时间 | 说明 |
|---|---|---|
| x.t()（视图） | 0.0070ms | 不搬数据，validate False |
| f32_col2row | 0.0318ms | 读连续写散（1D） |
| f32_row2col | 0.0162ms | 写连续读散（1D），**快一倍** |
| f32_col2row(2d) | 0.0131ms | 2D 映射 |
| f32_row2col(2d) | 0.0047ms | 2D + 保写端 |
| f32_diagonal | 0.0048ms | 对角线调度 |
| f32x4_col2row | 0.0324ms | 向量化读端，**无效**（陷阱） |
| f32x4_row2col(2d) | **0.0039ms** | 向量化写端 ✓ |
| f32x4_shared_col2row(2d) | 0.0040ms | smem staging |
| f32x4_shared_bcf_col2row(2d) | 0.0039ms | + padding 抗 conflict |
| torch .t().contiguous() | 0.0189ms | |
| CuTe 最优 | 0.0041ms | 与手写持平 |

优化路径：0.0318 → 0.0039ms，**8 倍全部来自访存，零计算优化**——这就是"转置是纯访存教学案例"的含义。

## 本篇小结

1. **coalesced access**：warp 32 线程连续地址 → 1 次 128B 事务；散地址 → 32 次，带宽 1/32。GPU 访存第一定律。
2. **转置的天然矛盾**：读连续则写散（stride=行宽），反之亦然；所有版本都在选边或调和。
3. **保写端**：离散写触发 write-allocate（128B 读改写），比离散读贵一倍——row2col 比 col2row 快一倍的实证。
4. **shared memory staging**：global 做不到的双端连续，用 smem 中转实现；"跳步"关进 smem（无 cache line 概念）。GEMM 分块搬运的雏形。
5. **bank conflict**：32 bank、同 bank 串行；行宽 32 倍数 + 按列访问 = 必撞；padding(+1) 让行间 bank 错开，代价是破坏 16B 对齐（FLOAT4 退化标量写）。
6. **向量化要选边**：非对称访存下向量化非瓶颈端是白干（col2row x4 实证）。
7. **对角线调度**：调度顺序影响 L2；**lazy transpose**：`.t()` 零拷贝，生产靠 GEMM trans 参数。
