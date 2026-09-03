---
title: ReLU & GELU
order: 11
---

# ReLU / GELU CUDA代码学习

> 本人学习笔记，AI总结

激活函数是 elementwise（02 篇）的收官练习：结构完全一样（一进一出、逐元素、向量化模式照搬），但运算本身从"一条加法"变成"超越函数"。本篇选 relu 和 gelu 两个：relu 展示"简单到极致的 kernel 长什么样"；gelu 则是宝藏——**tanh 近似公式、half 没有三角函数怎么手搓、数值范围 clamp、以及一个反直觉的实测（f32 手写反而输给 torch）**。

## 数学先摆清楚

**ReLU**：`y = max(0, x)`。一条 max 指令，没有更多可说的。

**GELU**（Gaussian Error Linear Unit）：`y = x·Φ(x)`，Φ 是标准正态分布的 CDF。精确形式含 `erf`：

```
y = 0.5x·(1 + erf(x/√2))                    ← erf 版 (gelu_none_approximate)
```

erf 没有初等闭式、硬件上极贵。Transformer 里的标准做法是 **tanh 近似**（BERT/GPT 用的就是它）：

```
y = 0.5x·(1 + tanh(√(2/π)·(x + 0.044715x³)))  ← tanh 版 (本篇主线的 GELU_OPS)
```

近似误差 ~1e-3，对训练无损。两条公式代码里都有，宏 `GELU_OPS` 切换。

## 完整代码

### `relu.cu`
<details>
<summary> relu.cu（kernel 部分）</summary>

```c++
// FP32
// Relu x: N, y: N y=max(0,x)
// grid(N/256), block(K=256)
__global__ void relu_f32_kernel(float *x, float *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    y[idx] = fmaxf(0.0f, x[idx]);
}

// Relu x: N, y: N y=max(0,x) Vec4
// grid(N/256/4), block(256/4)
__global__ void relu_f32x4_kernel(float *x, float *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 4;
  if (idx < N) {
    float4 reg_x = FLOAT4(x[idx]);
    float4 reg_y;
    reg_y.x = fmaxf(0.0f, reg_x.x);
    reg_y.y = fmaxf(0.0f, reg_x.y);
    reg_y.z = fmaxf(0.0f, reg_x.z);
    reg_y.w = fmaxf(0.0f, reg_x.w);
    FLOAT4(y[idx]) = reg_y;
  }
}

//  FP16
__global__ void relu_f16_kernel(half *x, half *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    y[idx] = __hmax(__float2half(0.0f), x[idx]);
}

__global__ void relu_f16x2_kernel(half *x, half *y, int N) {
  int idx = 2 * (blockIdx.x * blockDim.x + threadIdx.x);
  if (idx < N) {
    half2 reg_x = HALF2(x[idx]);
    half2 reg_y = HALF2(y[idx]);
    reg_y.x = __hmax(__float2half(0.0f), reg_x.x);
    reg_y.y = __hmax(__float2half(0.0f), reg_x.y);
    HALF2(y[idx]) = reg_y;
  }
}

__global__ void relu_f16x8_kernel(half *x, half *y, int N) {
  int idx = 8 * (blockIdx.x * blockDim.x + threadIdx.x);
  half2 reg_x_0 = HALF2(x[idx + 0]);
  half2 reg_x_1 = HALF2(x[idx + 2]);
  half2 reg_x_2 = HALF2(x[idx + 4]);
  half2 reg_x_3 = HALF2(x[idx + 6]);
  half2 reg_y_0, reg_y_1, reg_y_2, reg_y_3;
  reg_y_0.x = __hmax(__float2half(0.0f), reg_x_0.x);
  reg_y_0.y = __hmax(__float2half(0.0f), reg_x_0.y);
  reg_y_1.x = __hmax(__float2half(0.0f), reg_x_1.x);
  reg_y_1.y = __hmax(__float2half(0.0f), reg_x_1.y);
  reg_y_2.x = __hmax(__float2half(0.0f), reg_x_2.x);
  reg_y_2.y = __hmax(__float2half(0.0f), reg_x_2.y);
  reg_y_3.x = __hmax(__float2half(0.0f), reg_x_3.x);
  reg_y_3.y = __hmax(__float2half(0.0f), reg_x_3.y);
  if ((idx + 0) < N) {
    HALF2(y[idx + 0]) = reg_y_0;
  }
  if ((idx + 2) < N) {
    HALF2(y[idx + 2]) = reg_y_1;
  }
  if ((idx + 4) < N) {
    HALF2(y[idx + 4]) = reg_y_2;
  }
  if ((idx + 6) < N) {
    HALF2(y[idx + 6]) = reg_y_3;
  }
}

// f16x8_pack 版与 02 的 elementwise_add_f16x8_pack 同构, 详见源文件
// host binding 亦同构
```

</details>

### `gelu.cu`
<details>
<summary> gelu.cu </summary>

```c++
#define MIN_EXP_F32 -88.3762626647949f
#define MAX_EXP_F16 __float2half(11.089866488461016f)
#define MIN_EXP_F16 __float2half(-9.704060527839234f)
#define SQRT_2_PI M_SQRT2 *M_2_SQRTPI *0.5f
#define HALF_1 __float2half(1.0f)
#define HALF_2 __float2half(2.0f)
#define HALF_DIV2 __float2half(0.5f)
// to clear the error among self defined gelu and pytorch gelu. Calculate
// $\sqrt{\frac{\pi}{2}}$ by $\sqrt{2 * \pi} / 2$
#define HALF_SQRT_2_PI                                                         \
  __float2half(M_SQRT2) * __float2half(M_2_SQRTPI) *HALF_DIV2
#define HALF_V_APP __float2half(0.044715f)

#define HALF_GELU_OPS gelu_tanh_approximate
#define GELU_OPS gelu_tanh_approximate

// There is no half presicion operation like sinh, cosh, tanh. [Half Math
// Functions]
// $$ tanh(x) = \frac{exp^{2x} - 1}{exp^{2x} + 1}$$
// But ops above will introduce error.
__inline__ __device__ half gelu_tanh_approximate(half x) {
  half x_cube = x * x * x;
  // compute mid value : inner = 0.7978845608 * (x + 0.044715 * x * x * x)
  half inner = HALF_SQRT_2_PI * (x + HALF_V_APP * x_cube);
  // compute tanh
  return HALF_DIV2 * x *
         (HALF_1 +
          ((hexp(inner * HALF_2) - HALF_1) / (hexp(inner * HALF_2) + HALF_1)));
}

__inline__ __device__ float gelu_tanh_approximate(float x) {
  return 0.5f * x * (1.0f + tanhf(SQRT_2_PI * (x + 0.044715f * x * x * x)));
}

__inline__ __device__ float gelu_none_approximate(float x) {
  return x * 0.5 * (1 + erff(x * M_SQRT1_2));
}

// FP32
// GELU tanh approximate: x, y:x 0.5 * x
// * (1.0 + tanh(0.7978845608 * x * (1.0 + 0.044715 * x * x))) grid(N/256),
// block(K=256)
__global__ void gelu_f32_kernel(float *x, float *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N) {
    float v = fminf(fmaxf(x[idx], MIN_EXP_F32), MAX_EXP_F32);
    y[idx] = GELU_OPS(v);
  }
}

// GELU tanh approximate; Vec4
__global__ void gelu_f32x4_kernel(float *x, float *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 4;
  float4 reg_x = FLOAT4(x[idx]);
  float4 reg_y;

  reg_x.x = fminf(fmaxf(reg_x.x, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.y = fminf(fmaxf(reg_x.y, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.z = fminf(fmaxf(reg_x.z, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.w = fminf(fmaxf(reg_x.w, MIN_EXP_F32), MAX_EXP_F32);

  reg_y.x = GELU_OPS(reg_x.x);
  reg_y.y = GELU_OPS(reg_x.y);
  reg_y.z = GELU_OPS(reg_x.z);
  reg_y.w = GELU_OPS(reg_x.w);

  if ((idx + 0) < N) {
    FLOAT4(y[idx]) = reg_y;
  }
}

// FP16
__global__ void gelu_f16_kernel(half *x, half *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N) {
    half v = x[idx];
    v = __hmin(__hmax(v, MIN_EXP_F16), MAX_EXP_F16);

    y[idx] = HALF_GELU_OPS(v);
  }
}

// f16x2 / f16x8 / f16x8_pack 与 relu 同构 (换运算为 HALF_GELU_OPS),
// host binding 同构, 详见源文件
```

</details>

### `relu.py` / `gelu.py`
<details>
<summary> gelu.py（relu.py 同构）</summary>

```python
import time
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

lib = load(
    name="gelu_lib",
    sources=["gelu.cu"],
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

def run_benchmark(perf_func, x, tag, out=None, warmup=10, iters=1000, ...):
    # ... 与前面各篇同构

for S, K in [(1024,1024), (1024,2048), (1024,4096), ...]:
    x = torch.randn((S, K)).cuda().float().contiguous()
    out = torch.zeros_like(x).cuda().float().contiguous()
    run_benchmark(lib.gelu_f32, x, "f32", out)
    run_benchmark(lib.gelu_f32x4, x, "f32x4", out)
    run_benchmark(torch.nn.functional.gelu, x, "f32_th")

    x_f16 = x.half()
    out_f16 = out.half()
    run_benchmark(lib.gelu_f16, x_f16, "f16", out_f16)
    run_benchmark(lib.gelu_f16x2, x_f16, "f16x2", out_f16)
    run_benchmark(lib.gelu_f16x8, x_f16, "f16x8", out_f16)
    run_benchmark(lib.gelu_f16x8_pack, x_f16, "f16x8pack", out_f16)
    run_benchmark(torch.nn.functional.gelu, x_f16, "f16_th")
```

</details>

## 逐段代码剖析/学习

elementwise 的 grid/block、向量化模式（f32→f32x4→f16→f16x2→f16x8→f16x8pack 的递进）02 全讲过，本篇不重复。只讲激活函数特有的东西。

### ReLU：一条指令的 kernel

`fmaxf(0, x)` / `__hmax(0, x)`——ReLU 的"计算"只有一条 max 指令，**性能 100% 由访存决定**，是检验"向量化收益"最干净的样本。实测（S=1024, K=2048）：

| kernel | 耗时 | 相对 f16 |
|---|---|---|
| f32 | 0.00603ms | 1x |
| f32x4 | 0.00562ms | 1.07x |
| f16 | 0.00586ms | 1x |
| f16x2 | **0.00446ms** | 1.31x |
| f16x8 | 0.00542ms | 1.08x |
| f16x8pack | 0.00365ms | 1.61x |
| torch relu | 0.00568ms | |

规律：**f16x2pack > f16x2 > f16x8**，与 02 的 elementwise_add 结论一致（数据量减半 + 向量化 load）。relu 的手写版只比 torch 快一点点——因为 torch 的 relu 也是一条 fused kernel，双方都触到访存下限时就拉不开差距。**访存受限且无融合空间的算子，手写收益趋近于零**——这是 relu 留下的边界认知。

### GELU：三个值得抠的点

**① 数值范围 clamp（为什么会有 MIN/MAX_EXP）**

```c++
#define MIN_EXP_F32 -88.3762626647949f
#define MAX_EXP_F16 __float2half(11.089866488461016f)
#define MIN_EXP_F16 __float2half(-9.704060527839234f)
...
float v = fminf(fmaxf(x[idx], MIN_EXP_F32), MAX_EXP_F32);
```

进 GELU 前先把 x **夹进安全区间**。为什么？看 tanh 近似的展开式（half 版）：`hexp(inner * 2)`——**指数函数**。f16 的表示上限 65504 ≈ e^11.09，也就是说 `2·inner > 11.09` 时 `hexp` 直接 inf，inf/inf = NaN。所以 f16 版必须把 x 夹进 `[-9.70, 11.09]`（这两个 magic number 就是反解出来的边界）。f32 版同理（e^88 = f32 上限）。

这是 04 softmax"数值炸弹"的又一案例，但方向相反：softmax 是防溢出（减 max），这里是**输入域裁剪**（超出范围的 x，GELU 的值本来也已饱和到 x 或 0，clamp 不改变正确结果只防 NaN）。**超越函数 kernel 的标配动作：先想清楚输入取值范围和中间量的爆炸点**。

**② half 没有三角函数——手搓 tanh**

```c++
// There is no half presicion operation like sinh, cosh, tanh.
// tanh(x) = (e^{2x} - 1) / (e^{2x} + 1)
__inline__ __device__ half gelu_tanh_approximate(half x) {
  half x_cube = x * x * x;
  half inner = HALF_SQRT_2_PI * (x + HALF_V_APP * x_cube);
  return HALF_DIV2 * x *
         (HALF_1 +
          ((hexp(inner * HALF_2) - HALF_1) / (hexp(inner * HALF_2) + HALF_1)));
}
```

CUDA 的 half 数学函数库**没有 tanh/sinh/cosh**（只有 exp/log/sqrt 等基础款）——所以 tanh 用恒等式 `(e^{2x}-1)/(e^{2x}+1)` 手搓。注意两个工程细节：

- 所有常数都预先 `__float2half` 成 half 字面量（`HALF_1`、`HALF_DIV2`...），避免运行时做 float→half 转换；
- `HALF_SQRT_2_PI` 特意写成 `√2 · √(2/π)... 不对——是 M_SQRT2 * M_2_SQRTPI * 0.5`（√2×2/√π÷2）**拆成三个 half 常数相乘**，注释说是"to clear the error among self defined gelu and pytorch gelu"——**为了让和 PyTorch 的 f16 GELU 逐位对齐**（PyTorch 内部也是这么拆的，常数组合顺序不同会引入半个 ULP 的差）。追平框架逐位精度时，常数折叠顺序都要复刻——这是对齐工程学的细节。

**③ 反直觉实测：f32 手写输给 torch**

| kernel | S×K | 耗时 |
|---|---|---|
| gelu_f32 | 1024×4096 | 0.0347ms |
| gelu_f32x4 | 1024×4096 | 0.0385ms（更慢！） |
| **torch gelu (f32)** | 1024×4096 | **0.0101ms**（快 3.4x）|
| gelu_f16x8pack | 1024×2048 | 0.0041ms |
| torch gelu (f16) | 1024×2048 | 0.0067ms |

f32 系列被 torch 碾压，且 **f32x4 比 f32 还慢**。原因：

1. `tanhf` 是**开销大户**（软件实现的分段多项式，几十条指令），四个 tanhf 把计算时间堆到比访存还重——kernel 从"访存受限"翻转成"计算受限"（08 RoPE 的老朋友）。
2. 向量化省的是访存指令，计算一条不少——计算受限时向量化**零收益**，寄存器压力反而让 f32x4 变慢（09 向量化陷阱的又一实例，但这次瓶颈是计算不是写端）。
3. torch 的 GELU 用的是**更少指令的多项式拟合**（不用 tanh，直接拟合整个 GELU 曲线），加上 `--use_fast_math` 之外 torch 还做了指令调度优化——框架算子被高度调优，**超越函数+计算受限场景下，手写默认打不过框架**。

而 f16 系列手写反超（f16x8pack 0.0041 vs torch 0.0067ms）：half 的 `hexp` 走硬件 SFU 单元（比 f32 的软件 tanhf 便宜一个量级），瓶颈回到访存，向量化的收益又显形了。

**这张表是本篇最值钱的教学素材**：同一个 kernel 家族，f32 计算受限（手写输、向量化负收益）、f16 访存受限（手写赢、向量化正收益）——**"瓶颈类型"决定一切优化手段的有效性**，用数据把 08/09 的结论又钉了一遍。

## 实测数据（4090）

**ReLU（S=1024, K=2048）**：f32 0.0060 / f32x4 0.0056 / f16 0.0059 / f16x2 0.0045 / f16x8pack **0.0037** / torch 0.0057ms——手写比 torch 快 35%，全部来自向量化访存。

**GELU（S=1024, K=2048）**：f32 0.0182 / f32x4 0.0184 / **torch f32 0.0072** / f16 0.0072 / f16x2 0.0064 / f16x8pack **0.0041** / torch f16 0.0067ms。

## 本篇小结

1. **ReLU 是纯访存 kernel**：一条 max 指令，性能全由访存决定，手写 vs torch 差距小——访存受限且无融合空间的算子，手写收益趋零。
2. **超越函数前先想输入域**：GELU 的 tanh 近似含 exp，f16 下 `|x|>~11` 就 NaN，进 kernel 先 clamp——输入域裁剪是防 NaN 的标准动作（且 GELU 饱和特性保证 clamp 不损正确性）。
3. **half 数学库没有三角函数**：tanh 用 `(e^{2x}-1)/(e^{2x}+1)` 手搓；常数预转 half、折叠顺序复刻框架——逐位对齐的工程细节。
4. **瓶颈类型决定优化有效性**：f32 GELU 计算受限（tanhf 软件实现太贵 → 手写输 torch 3.4x、向量化负收益），f16 GELU 访存受限（hexp 走 SFU → 手写赢、向量化正收益）。先判断瓶颈，再选优化——这个决策框架贯穿 08/09/11 三篇。
5. **框架算子不是软柿子**：torch 的 GELU 是多项式拟合 + 深度调优，超越函数场景手写默认打不过；想赢要么换精度路线（f16），要么上融合（把 GELU 融进相邻 kernel 省访存——这正是第三阶段 FA 里 GELU+softmax+matmul 全融合的动机）。
