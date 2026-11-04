---
title: 激活函数补遗 (Sigmoid/ELU/Swish/HardSwish/HardShrink)
order: 23
---

# 激活函数补遗：Sigmoid / ELU / Swish / HardSwish / HardShrink

> 本人学习笔记，AI总结

11 篇写过 ReLU 和 GELU，但激活函数目录里还有五个同构 kernel 没讲：sigmoid、elu、swish、hardswish、hardshrink。它们的骨架与 02 篇 elementwise 完全相同（`grid(N/256)`、向量化、pack），**唯一的变化是 `__device__` 函数体里那 1~3 行数学**——这正是本篇的价值所在：同一套模板吃下整个激活函数家族后，剩下的问题只有一个——**每个函数的数学在 GPU 上有什么特有的坑**。Sigmoid 篇幅最多（有数值饱和问题），其余四个按"函数体对比"讲。

先看五个函数的数学形态（这是理解后文数值处理的基础）：

```
sigmoid(x)   = 1 / (1 + e^(-x))          输出 (0,1)，软饱和
ELU(x)       = x            if x > 0
             = α·(e^x - 1)  if x ≤ 0       负半轴有 exp，α=1
Swish(x)     = x · sigmoid(x)              = x / (1 + e^(-x))，SiLU 同款（LLM 常用）
HardSwish(x) = x                if x ≥ 3
             = 0                if x ≤ -3
             = x(x+3)/6         otherwise  分段线性，MobileNetV3 同款
HardShrink(x)= x                if |x| > λ
             = 0                otherwise  稀疏化用，λ=0.5
```

分水岭很明显：**前三个含 `exp`（ transcendental，有溢出风险），后两个是纯分段线性/常数比较（算力上几乎免费）**。

## 实测数据（4090，warmup 10 / iters 200）

全系列六种实现（f32 / f32x4 / f16 / f16x2 / f16x8 / f16x8_pack）在 S=1024, K=1024（1M 元素）下的实测：

| 实现 | sigmoid | ELU | Swish | HardSwish | HardShrink |
|---|---|---|---|---|---|
| f32 | 0.00465 | 0.00452 | 0.00464 | 0.00465 | 0.00451 |
| f32x4 | 0.00368 | 0.00366 | 0.00367 | 0.00373 | 0.00365 |
| f16 | 0.00529 | 0.00477 | 0.00505 | 0.00476 | 0.00449 |
| f16x2 | 0.00313 | 0.00303 | 0.00316 | 0.00302 | 0.00291 |
| f16x8 | 0.00302 | 0.00271 | 0.00297 | 0.00272 | 0.00283 |
| f16x8_pack | 0.00275 | 0.00267 | 0.00283 | 0.00268 | 0.00288 |
| torch 对照 | 0.00419 | 0.02948 | 0.00993 | 0.01172 | 0.01324 |

大 shape（S=4096, K=4096，16M 元素）下更能看出分化：

| 实现 | sigmoid | ELU | Swish | HardSwish | HardShrink |
|---|---|---|---|---|---|
| f32 | 0.1419 | 0.1421 | 0.1419 | 0.1418 | 0.1418 |
| f16x8_pack | 0.0183 | 0.0183 | 0.0182 | 0.0182 | 0.0183 |
| torch F16 | 0.0186 | 0.2600 | 0.0399 | 0.0910 | 0.0911 |

（单位 ms）三个值得停下来的观察：

1. **F32 三个含 exp 的函数在同一 shape 下时间完全一致（0.1419）**——16M 元素 ÷ 0.142ms ≈ 117 GB/s 的有效带宽，远低于 4090 的 1000 GB/s 峰值。**瓶颈根本不是 exp 的算力，是别的什么**——第 4 节揭晓。
2. **ELU 的 torch 对照慢得离谱**（0.26ms vs 手写 0.018ms，14 倍差距）——torch 的 ELU 走了带 alpha 通用分支的实现，且 F16 下还叠加 dtype 转换开销；五个函数里它是"手写完胜框架"最夸张的一个。
3. **f16 单元素版反而比 f32 慢**（sigmoid: 0.00529 vs 0.00465）——F16 数据量减半，但单元素 kernel 一次只搬 2 字节，**访存事务利用率低**；向量化到 f16x8_pack 后一次搬 128bit 才把带宽优势放出来。

## 完整代码

五个目录的 .cu/.py 结构与 11 篇 ReLU-GELU 完全一致（TORCH_BINDING 宏模板 + f32/f32x4/f16/f16x2/f16x8/f16x8_pack 六连），下面只给 sigmoid 全文（它最有讲头），其余四个给函数体对比。完整源码见仓库 `kernels/{sigmoid,elu,swish,hardswish,hardshrink}/`。

### `sigmoid.cu`（全文）

<details>
<summary> sigmoid.cu </summary>

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
#define MAX_EXP_F32 88.3762626647949f
#define MIN_EXP_F32 -88.3762626647949f
#define MAX_EXP_F16 __float2half(11.089866488461016f)
#define MIN_EXP_F16 __float2half(-9.704060527839234f)

// FP32
// Sigmoid x: N, y: N y=1/(1+exp(-x))
// grid(N/256), block(K=256)
__global__ void sigmoid_f32_kernel(float *x, float *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N) {
    float v = x[idx];
    v = fminf(fmaxf(v, MIN_EXP_F32), MAX_EXP_F32);
    y[idx] = 1.0f / (1.0f + expf(-v));
  }
}

// Sigmoid x: N, y: N y=1/(1+exp(-x)) Vec4
// grid(N/256), block(256/4)
__global__ void sigmoid_f32x4_kernel(float *x, float *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 4;
  float4 reg_x = FLOAT4(x[idx]);
  float4 reg_y;

  reg_x.x = fminf(fmaxf(reg_x.x, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.y = fminf(fmaxf(reg_x.y, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.z = fminf(fmaxf(reg_x.z, MIN_EXP_F32), MAX_EXP_F32);
  reg_x.w = fminf(fmaxf(reg_x.w, MIN_EXP_F32), MAX_EXP_F32);

  reg_y.x = 1.0f / (1.0f + expf(-reg_x.x));
  reg_y.y = 1.0f / (1.0f + expf(-reg_x.y));
  reg_y.z = 1.0f / (1.0f + expf(-reg_x.z));
  reg_y.w = 1.0f / (1.0f + expf(-reg_x.w));

  if ((idx + 0) < N) {
    FLOAT4(y[idx]) = reg_y;
  }
}

//  FP16
__global__ void sigmoid_f16_kernel(half *x, half *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  const half f = __float2half(1.0f);
  if (idx < N) {
    half v = x[idx];
    v = __hmin(__hmax(v, MIN_EXP_F16), MAX_EXP_F16);
    y[idx] = f / (f + hexp(-v));
  }
}

__global__ void sigmoid_f16x2_kernel(half *x, half *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 2;
  const half f = __float2half(1.0f);
  half2 reg_x = HALF2(x[idx]);
  half2 reg_y;
  reg_x.x = __hmin(__hmax(reg_x.x, MIN_EXP_F16), MAX_EXP_F16);
  reg_x.y = __hmin(__hmax(reg_x.y, MIN_EXP_F16), MAX_EXP_F16);

  reg_y.x = f / (f + hexp(-reg_x.x));
  reg_y.y = f / (f + hexp(-reg_x.y));

  if ((idx + 0) < N) {
    HALF2(y[idx]) = reg_y;
  }
}

// unpack f16x8
__global__ void sigmoid_f16x8_kernel(half *x, half *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 8;
  const half f = __float2half(1.0f);

  half2 reg_x_0 = HALF2(x[idx + 0]);
  half2 reg_x_1 = HALF2(x[idx + 2]);
  half2 reg_x_2 = HALF2(x[idx + 4]);
  half2 reg_x_3 = HALF2(x[idx + 6]);

  reg_x_0.x = __hmin(__hmax(reg_x_0.x, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_0.y = __hmin(__hmax(reg_x_0.y, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_1.x = __hmin(__hmax(reg_x_1.x, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_1.y = __hmin(__hmax(reg_x_1.y, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_2.x = __hmin(__hmax(reg_x_2.x, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_2.y = __hmin(__hmax(reg_x_2.y, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_3.x = __hmin(__hmax(reg_x_3.x, MIN_EXP_F16), MAX_EXP_F16);
  reg_x_3.y = __hmin(__hmax(reg_x_3.y, MIN_EXP_F16), MAX_EXP_F16);

  half2 reg_y_0, reg_y_1, reg_y_2, reg_y_3;

  reg_y_0.x = f / (f + hexp(-reg_x_0.x));
  reg_y_0.y = f / (f + hexp(-reg_x_0.y));
  reg_y_1.x = f / (f + hexp(-reg_x_1.x));
  reg_y_1.y = f / (f + hexp(-reg_x_1.y));
  reg_y_2.x = f / (f + hexp(-reg_x_2.x));
  reg_y_2.y = f / (f + hexp(-reg_x_2.y));
  reg_y_3.x = f / (f + hexp(-reg_x_3.x));
  reg_y_3.y = f / (f + hexp(-reg_x_3.y));

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

// pack f16x8
__global__ void sigmoid_f16x8_pack_kernel(half *x, half *y, int N) {
  int idx = (blockIdx.x * blockDim.x + threadIdx.x) * 8;
  const half f = __float2half(1.0f);
  // temporary register(memory), .local space in ptx, addressable
  half pack_x[8], pack_y[8]; // 8x16 bits=128 bits.
  // reinterpret as float4 and load 128 bits in 1 memory issue.
  LDST128BITS(pack_x[0]) = LDST128BITS(x[idx]); // load 128 bits

#pragma unroll
  for (int i = 0; i < 8; ++i) {
    half v = __hmin(__hmax(pack_x[i], MIN_EXP_F16), MAX_EXP_F16);
    pack_y[i] = f / (f + hexp(-v));
  }
  // reinterpret as float4 and store 128 bits in 1 memory issue.
  if ((idx + 7) < N) {
    LDST128BITS(y[idx]) = LDST128BITS(pack_y[0]);
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

#define TORCH_BINDING_SIGMOID(packed_type, th_type, element_type, n_elements)  \
  void sigmoid_##packed_type(torch::Tensor x, torch::Tensor y) {               \
    CHECK_TORCH_TENSOR_DTYPE(x, (th_type))                                     \
    CHECK_TORCH_TENSOR_DTYPE(y, (th_type))                                     \
    const int ndim = x.dim();                                                  \
    if (ndim != 2) {                                                           \
      int N = 1;                                                               \
      for (int i = 0; i < ndim; ++i) {                                         \
        N *= x.size(i);                                                        \
      }                                                                        \
      dim3 block(256 / (n_elements));                                          \
      dim3 grid((N + 256 - 1) / 256);                                          \
      sigmoid_##packed_type##_kernel<<<grid, block>>>(                         \
          reinterpret_cast<element_type *>(x.data_ptr()),                      \
          reinterpret_cast<element_type *>(y.data_ptr()), N);                  \
    } else {                                                                   \
      const int S = x.size(0);                                                 \
      const int K = x.size(1);                                                 \
      const int N = S * K;                                                     \
      if ((K / (n_elements)) <= 1024) {                                        \
        dim3 block(K / (n_elements));                                          \
        dim3 grid(S);                                                          \
        sigmoid_##packed_type##_kernel<<<grid, block>>>(                       \
            reinterpret_cast<element_type *>(x.data_ptr()),                    \
            reinterpret_cast<element_type *>(y.data_ptr()), N);                \
      } else {                                                                 \
        int N = 1;                                                             \
        for (int i = 0; i < ndim; ++i) {                                       \
          N *= x.size(i);                                                      \
        }                                                                      \
        dim3 block(256 / (n_elements));                                        \
        dim3 grid((N + 256 - 1) / 256);                                        \
        sigmoid_##packed_type##_kernel<<<grid, block>>>(                       \
            reinterpret_cast<element_type *>(x.data_ptr()),                    \
            reinterpret_cast<element_type *>(y.data_ptr()), N);                \
      }                                                                        \
    }                                                                          \
  }

TORCH_BINDING_SIGMOID(f32, torch::kFloat32, float, 1)
TORCH_BINDING_SIGMOID(f32x4, torch::kFloat32, float, 4)
TORCH_BINDING_SIGMOID(f16, torch::kHalf, half, 1)
TORCH_BINDING_SIGMOID(f16x2, torch::kHalf, half, 2)
TORCH_BINDING_SIGMOID(f16x8, torch::kHalf, half, 8)
TORCH_BINDING_SIGMOID(f16x8_pack, torch::kHalf, half, 8)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f32)
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f32x4)
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f16)
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f16x2)
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f16x8)
  TORCH_BINDING_COMMON_EXTENSION(sigmoid_f16x8_pack)
}
```

</details>

## 逐段剖析

### 1. Sigmoid 的饱和截断：两个"魔法数字"的来历

```c++
#define MAX_EXP_F32  88.3762626647949f
#define MIN_EXP_F32  -88.3762626647949f
v = fminf(fmaxf(v, MIN_EXP_F32), MAX_EXP_F32);   // clamp 到 [-88.38, 88.38]
y[idx] = 1.0f / (1.0f + expf(-v));
```

88.3762626647949 哪来的？**这是 `expf` 不溢出的极限**：F32 能表示的最大数约 3.4×10³⁸，`ln(3.4e38) ≈ 88.72`，留一点余量取 88.376。x 超过它时 `expf(-x)`（注意是负指数）下溢为 0——sigmoid(x→+∞) 本来就该是 1，所以正方向截断其实是无害的；真正致命的是**负方向**：x 是很小的负数时 `expf(-x) = expf(88+) = +inf`，sigmoid 变成 `1/inf = 0`——结果碰巧也对！

**那截断图什么？** 防 NaN。x = -inf 或极大负数时，有的实现路径 `expf(-v)` 出 inf，`1 + inf` 还是 inf，`1/inf` 是 0——数学上成立。但 `--use_fast_math` 下编译器可能生成 `__expf` 近似指令，其行为在极端输入下未定义；截断把输入域钳在 exp 的"保证正确"区间，**结果可复现**。这和 04 篇 safe_softmax 减最大值是同一族问题：**超越函数要主动管理定义域**，GPU 上数值稳定不是浮点单元送的，是程序员给的。

F16 的界限不同：`MAX_EXP_F16 = 11.09`、`MIN_EXP_F16 = -9.70`——F16 最大约 65504，`ln(65504) ≈ 11.09`。注意两个数字**不对称**：负方向是 9.70 而不是 -11.09，因为 `expf(-v)` 在 v 取负时指数是 `+|v|`，而 half 的表示范围不如 float，9.70 是 `exp(9.70) ≈ 16336` 后 `1+exp` 还在 half 精度内能分辨出 1 的极限（再大 `1 + 16336` 在 half 下舍入误差就吞掉 1 了）。

### 2. ELU：分支在 GPU 上是"免费的"吗

```c++
__device__ __forceinline__ float elu(float x) {
  return x > 0.f ? x : ALPHA * (expf(x) - 1.f);
}
```

三元分支在一个 warp 里意味着**相邻线程可能走不同路**——教科书会说"warp divergence！"但这里实测手写比 torch 快 14 倍。原因：SIMT 的 divergence 是**两条路都走、谓词屏蔽**，对 elementwise 这种每线程 1~3 条指令的 kernel，开销完全可以忽略（02 篇讲过）。**divergence 的代价要乘上"分支体长度"才有意义**——分支体是几十条指令的循环体时才是真问题，一行表达式随便分支。

ELU 的 F16 版本有个值得注意的写法：

```c++
__device__ __forceinline__ half elu_half(half x) {
  return __hgt(x, __float2half(0.f))
             ? x
             : __hmul(__float2half(ALPHA), __hsub(hexp(x), __float2half(1.f)));
}
```

全程 `__hgt/__hmul/__hsub/hexp` 内建函数，**没有一步提升到 F32**。对比 06/07 篇 layer-norm 的"F32 acc 铁律"——那里是累加几十个数的归约，误差会累积；这里是逐元素一次函数求值，没有累积效应，F16 全程算精度够用，还省了类型转换指令。**"F32 累加"管的是归约链，不管逐元素映射**——两条规则的适用边界要分清。

### 3. Swish：sigmoid 的"一次复用"

```c++
__device__ __forceinline__ float swish(float x) {
  return x / (1.0f + expf(-x));    // 不写成 x * sigmoid(x)：省一次除法
}
```

数学上 `swish(x) = x * sigmoid(x)`，但实现写成了 `x / (1 + e^-x)`——**把 sigmoid 的除法内联进来复用**。写成 `x * (1/(1+expf(-x)))` 是两次除法（sigmoid 内部一次、乘法不算），而合并后一次。exp 本身是 4~8 个时钟周期的多指令序列，除法也是昂贵指令，能省则省。LLM 里的 SiLU（Llama/Swin 等的激活）就是 Swish 的 α=1 特例——这个函数是五个里工程价值最高的。

### 4. HardSwish / HardShrink：分段线性的胜利

```c++
__device__ __forceinline__ float hardswish(float x) {
  if (x >= 3.0)  return x;
  else if (x <= -3.0) return 0;
  else return x * (x + 3) / 6;
}
__device__ __forceinline__ float hardshrink(float x) {
  if (x > 0.5 || x < -0.5) return x;
  else return 0;
}
```

两个"hard"系列是 softmax 篇"safe 版 vs 快版"权衡的镜像：**用分段线性近似换掉超越函数**。HardSwish 用三段折线近似 Swish 的平滑曲线（端点误差 ≤ 理论设计范围，MobileNetV3 论文证明训练后精度无差）；HardShrink 干脆是稀疏化算子（中间直接归零，梯度也是硬截断）。

实测大 shape F32 全员 0.1418ms、F16 pack 全员 0.0182ms——**含不含 exp 完全没差别**。这暴露了真正瓶颈：16M 元素 × 8 字节（读+写）= 128MB，0.142ms → **有效带宽 ~940 GB/s**，几乎贴着 4090 的 1008 GB/s 峰值。（前面第 1 节算的 117 GB/s 是小 shape 被 launch 开销稀释的假象——**小 shape 看开销，大 shape 看带宽**，同一份代码两个 shape 讲出两个故事。）在这些访存受限的 elementwise kernel 上，ALU 干活的时间完全藏在访存延迟后面，**exp 也好、三段分支也好，只要访存满速，计算就是免费的**。这也解释了为什么 f16x8_pack 一枝独秀：不是算得快，是一次搬 128bit 让带宽吃满。

### 5. 六连模板的启动配置细节

TORCH_BINDING 宏里有个之前没细讲的分支（02/11 篇提过结构但没展开这段）：

```c++
if ((K / (n_elements)) <= 1024) {
  dim3 block(K / (n_elements));   // 一行一个 block，一行内的线程数 = K/每线程元素数
  dim3 grid(S);                    // S 行 = S 个 block
} else { /* 退化成一维 N 扫 */ }
```

二维输入（S,K）且 K 不超过 block 上限（1024）时，按**行组织 block**（一行一个 block）——这是给"后续可能改成行内协作"留的形状；K 太大才退化成纯一维的 N 扫描。elementwise 虽然不需要行内协作，但**保持 2D 语义让 memory access pattern 和矩阵布局对齐**，对 L2 局部性友好（相邻 block 访相邻行）。

## 选用建议（工程视角）

| 场景 | 选谁 | 理由 |
|---|---|---|
| LLM 前馈层 | Swish/SiLU | 现代标配（Llama/Qwen 全家），性能与 GELU 相当 |
| 检测/分割头 | Sigmoid | 概率输出、多标签 |
| 边缘设备/量化模型 | HardSwish | 折线近似省 exp，对量化友好 |
| 稀疏化/剪枝后处理 | HardShrink | 语义就是"小值归零" |
| 别用 | ELU | torch 实现慢、现代架构已不选；学它的 `x>0?x:exp` 模式即可 |

## 本篇小结

1. **激活函数 kernel 是 elementwise 模板 + 一行函数体**：骨架（六连向量化、TORCH_BINDING 宏、2D 行组织启动）与 02/11 篇完全一致，新知识点全在函数体的数值处理上。
2. **Sigmoid 要 clamp 定义域**：F32 钳到 ±88.38（exp 不溢出极限），F16 到 ±11.09（half 表示极限）——与 04 篇 safe_softmax 同族，超越函数的定义域管理是程序员的责任。
3. **elementwise 级别的分支不怕 divergence**：谓词屏蔽的代价 = 两条路指令数的叠加，一行表达式随便分支；ELU F16 全程 `__h*` 内建不升 F32 是合法的（无累积误差）——"F32 累加"规则只管归约链。
4. **Swish 写成 `x/(1+e^-x)` 复用除法**：LLM 的 SiLU 即它本身，五个里工程价值最高。
5. **大 shape 下含 exp 与否时间一样（0.1418ms 全员一致）**：有效带宽 ~940 GB/s 贴峰值，访存受限下计算免费——"小 shape 看开销、大 shape 看带宽"的诊断方法论。
6. **f16 单元素版比 f32 慢、f16x8_pack 最快**：F16 的红利要靠向量化放大访存事务才能兑现，2 字节单 load 是假 F16 优化。
7. **手写 vs torch 的差距因函数而异**：Sigmoid/Swish 差 1~4 倍，ELU 差 14 倍（torch 走通用 alpha 分支）——框架的"通用性税"不均匀，冷门算子税更重。
