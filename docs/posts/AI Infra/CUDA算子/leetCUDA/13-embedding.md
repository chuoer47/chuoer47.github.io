---
title: Embedding
order: 13
---

# Embedding CUDA代码学习

> 本人学习笔记，AI总结

Embedding 查表是 LLM 第一层算子：token id 序列 `(N,)` → 查权重表 `(V, H)` 的对应行 → 输出 `(N, H)`。本质是**gather（按索引收集）**：没有计算、纯搬运，但索引由数据决定（`idx[bx]` 是运行时才知道的）——和转置的"固定模式访存"不同，这是**数据依赖访存**第一次登场。kernel 本身是本系列最短的之一，但实测藏着一个漂亮的反例：**手动展开的 x4 版本比标量版慢 2 倍**。

## 完整代码

### `embedding.cu`
<details>
<summary> embedding.cu </summary>

```c++
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])

__global__ void embedding_f32_kernel(const int *idx, float *weight,
                                     float *output, int n, int emb_size) {
  int tx = threadIdx.x;
  int bx = blockIdx.x;
  int tid = bx * blockDim.x + tx;
  int offset = idx[bx] * emb_size;
  output[bx * emb_size + tx] = weight[offset + tx];
}

__global__ void embedding_f32x4_kernel(const int *idx, float *weight,
                                       float *output, int n, int emb_size) {
  int tx = threadIdx.x * 4;
  int bx = blockIdx.x;
  int offset = idx[bx] * emb_size;
  output[bx * emb_size + tx] = weight[offset + tx];
  output[bx * emb_size + tx + 1] = weight[offset + tx + 1];
  output[bx * emb_size + tx + 2] = weight[offset + tx + 2];
  output[bx * emb_size + tx + 3] = weight[offset + tx + 3];
}

__global__ void embedding_f32x4_pack_kernel(const int *idx, float *weight,
                                            float *output, int n,
                                            int emb_size) {
  int tx = threadIdx.x;
  int bx = blockIdx.x;
  int tid = bx * blockDim.x + tx;
  int offset = idx[bx] * emb_size;
  LDST128BITS(output[bx * emb_size + 4 * tx]) =
      LDST128BITS(weight[offset + 4 * tx]);
}

__global__ void embedding_f16_kernel(const int *idx, half *weight, half *output,
                                     int n, int emb_size) {
  int tx = threadIdx.x;
  int bx = blockIdx.x;
  int tid = bx * blockDim.x + tx;
  int offset = idx[bx] * emb_size;
  output[bx * emb_size + tx] = weight[offset + tx];
}

__global__ void embedding_f16x8_kernel(const int *idx, half *weight,
                                       half *output, int n, int emb_size) {
  int tx = threadIdx.x * 8;
  int bx = blockIdx.x;
  int offset = idx[bx] * emb_size;
  output[bx * emb_size + tx] = weight[offset + tx];
  output[bx * emb_size + tx + 1] = weight[offset + tx + 1];
  output[bx * emb_size + tx + 2] = weight[offset + tx + 2];
  output[bx * emb_size + tx + 3] = weight[offset + tx + 3];
  output[bx * emb_size + tx + 4] = weight[offset + tx + 4];
  output[bx * emb_size + tx + 5] = weight[offset + tx + 5];
  output[bx * emb_size + tx + 6] = weight[offset + tx + 6];
  output[bx * emb_size + tx + 7] = weight[offset + tx + 7];
}

__global__ void embedding_f16x8_pack_kernel(const int *idx, half *weight,
                                            half *output, int n, int emb_size) {
  int tx = threadIdx.x;
  int bx = blockIdx.x;
  int tid = bx * blockDim.x + tx;
  int offset = idx[bx] * emb_size;
  LDST128BITS(output[bx * emb_size + 8 * tx]) =
      LDST128BITS(weight[offset + 8 * tx]);
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define TORCH_BINDING_EMBEDDING(packed_type, th_type, element_type,            \
                                n_elements)                                    \
  void embedding_##packed_type(torch::Tensor a, torch::Tensor weight,          \
                               torch::Tensor o) {                              \
    CHECK_TORCH_TENSOR_DTYPE(a, (torch::kInt32));                              \
    CHECK_TORCH_TENSOR_DTYPE(weight, (th_type));                               \
    CHECK_TORCH_TENSOR_DTYPE(o, (th_type));                                    \
                                                                               \
    const int N = a.size(0);                                                   \
    const int emb_size = weight.size(1);                                       \
    dim3 block(emb_size / n_elements);                                         \
    dim3 grid(N);                                                              \
    embedding_##packed_type##_kernel<<<grid, block>>>(                         \
        reinterpret_cast<int *>(a.data_ptr()),                                 \
        reinterpret_cast<element_type *>(weight.data_ptr()),                   \
        reinterpret_cast<element_type *>(o.data_ptr()), N, emb_size);          \
  }

TORCH_BINDING_EMBEDDING(f32, torch::kFloat32, float, 1)
TORCH_BINDING_EMBEDDING(f32x4, torch::kFloat32, float, 4)
TORCH_BINDING_EMBEDDING(f32x4_pack, torch::kFloat32, float, 4)
TORCH_BINDING_EMBEDDING(f16, torch::kHalf, half, 8)
TORCH_BINDING_EMBEDDING(f16x8, torch::kHalf, half, 8)
TORCH_BINDING_EMBEDDING(f16x8_pack, torch::kHalf, half, 8)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(embedding_f32);
  TORCH_BINDING_COMMON_EXTENSION(embedding_f32x4);
  TORCH_BINDING_COMMON_EXTENSION(embedding_f32x4_pack);
  TORCH_BINDING_COMMON_EXTENSION(embedding_f16);
  TORCH_BINDING_COMMON_EXTENSION(embedding_f16x8);
  TORCH_BINDING_COMMON_EXTENSION(embedding_f16x8_pack);
}
```

</details>

### `embedding.py`
<details>
<summary> embedding.py </summary>

```python
import time
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

lib = load(
    name="embedding_lib",
    sources=["embedding.cu"],
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

def run_benchmark(perf_func, a, w, tag, out, warmup=10, iters=1000, ...):
    # ... 与前面各篇同构

for SeqLen in [2048, 4096]:
    for EmbSize in [512, 1024]:
        MaxV = 1024   # 词表大小
        a = torch.randint(0, MaxV, (SeqLen,), dtype=torch.int32).cuda()
        w = torch.randn(MaxV, EmbSize).cuda().float().contiguous()
        out = torch.zeros(SeqLen, EmbSize).cuda().float().contiguous()
        run_benchmark(lib.embedding_f32, a, w, "f32", out)
        run_benchmark(lib.embedding_f32x4, a, w, "f32x4", out)
        run_benchmark(lib.embedding_f32x4_pack, a, w, "f32x4_pack", out)
        run_benchmark(torch.nn.functional.embedding, a, w, "f32_th", out)

        w_f16 = w.half(); out_f16 = out.half()
        run_benchmark(lib.embedding_f16, a, w_f16, "f16", out_f16)
        run_benchmark(lib.embedding_f16x8, a, w_f16, "f16x8", out_f16)
        run_benchmark(lib.embedding_f16x8_pack, a, w_f16, "f16x8_pack", out_f16)
        run_benchmark(torch.nn.functional.embedding, a, w_f16, "f16_th", out_f16)
```

</details>

## 逐段代码剖析/学习

### 1. 映射结构：一行一个 block，查表即拷贝一行

```c++
__global__ void embedding_f32_kernel(const int *idx, float *weight,
                                     float *output, int n, int emb_size) {
  int tx = threadIdx.x;
  int bx = blockIdx.x;
  int offset = idx[bx] * emb_size;      // ★ 数据依赖的偏移
  output[bx * emb_size + tx] = weight[offset + tx];
}
```

映射是 per-token 的（04 的模式）：`grid(N)` 一个 block 负责一个 token，`block(emb_size)` 一个线程负责 embedding 的一维。核心就一行半：

- `idx[bx]`：**从 global 内存读索引**——这个值编译期不知道、每个 block 不同，它是"访存地址的地址"。这就是 gather 的定义：**目标地址由数据决定**。
- `offset = idx[bx] * emb_size`：token id × 行宽 = 权重表的行起点。
- 之后的 `weight[offset+tx] → output[bx*emb_size+tx]` 就是纯行拷贝，warp 内 tx 连续 → 读写两端都 coalesced（09 的黄金法则在 gather 的"行内"部分依然成立）。

**和转置的对比**：转置的访存模式是编译期可分析的（stride 固定）；embedding 的行起点在运行时才确定——**块间访存完全无规律**（相邻 block 查的行可能相邻也可能相隔半个词表），只有块内（行内）连续。这带来 gather 特有的性能特征：L2 命中率取决于 token id 的分布（自然语言里高频 token 会被反复查，L2 友好；随机 id 则每次都 miss）。

另一个细节：`idx[bx]` 每个**线程**都会执行一次吗？不——同一 block 的 256 个线程读同一个 `idx[bx]`，硬件会合并成一次 broadcast 读（09 bank conflict 一节提过：同地址读 = broadcast，不算冲突），且大概率命中 L1。所以索引读取不构成瓶颈。

### 2. x4 手动展开版：一次漂亮的翻车

看实测（SeqLen=2048, EmbSize=512）：

| kernel | 耗时 | 相对标量 |
|---|---|---|
| f32 | 0.00507ms | 1x |
| **f32x4（手动展开）** | **0.01113ms** | **0.46x（慢一倍！）** |
| f32x4_pack（LDST128BITS） | **0.00446ms** | 1.14x ✓ |
| torch embedding | 0.00982ms | |

`f32x4` 的写法：`tx = threadIdx.x * 4`，然后手写 4 对标量读写。它**比标量版还慢 2 倍**——为什么？

```
f32 标量:  block(512), warp 内 32 线程各 1 对读写
           → warp 一拍发射 32 个连续地址的 load, coalesced 打满

f32x4 展开: block(128), 每线程 4 对读写, 顺序是
           output[tx]   = weight[tx]      ← 第一对
           output[tx+1] = weight[tx+1]    ← 第二对...
           warp 内 32 线程的"第一对"地址: tx = 0,4,8,...124 —— 间隔 4!
           → 每次发射的 32 个地址不连续 (stride=4), 一条 128B line 只用 1/4
           → 4 对读写要 4 轮发射, 每轮都只吃到 1/4 带宽
```

**手动展开改变了 warp 内的地址分布**：线程数减 4 后，同拍发射的地址从"32 个连续"变成"32 个间隔 4"——coalescing 被自己亲手破坏。除非编译器聪明地重排指令（把不同线程的 tx、tx+1、tx+2、tx+3 交错拼成连续批次），否则每轮发射都浪费 3/4 带宽。实测证明编译器没救它。

而 `f32x4_pack` 用 `LDST128BITS`：**每线程一条 128bit 指令搬 4 个**——一条指令天然 16 字节连续，warp 内 32 条 128bit 指令覆盖 512 字节 = 4 条 line 全部打满，coalescing 完美。**同样是"每线程管 4 个元素"，手动展开（4 条标量指令）和向量化指令（1 条 128bit）的差别是毁灭性的**。

这个对照的价值：**"每线程多管几个元素"不等于向量化——必须用向量指令（FLOAT4/LDST128BITS）且 warp 内地址连续才算**。02 讲过 FLOAT4 的用法，本篇的 f32x4 翻车数据补上了反面案例：写法差一点，性能差一倍。

### 3. f16 系列与 dispatch 的隐含约束

f16 系列同构（f16 → f16x8 手动展开 → f16x8_pack），实测规律相同：f16x8（手动）0.0114ms 又是最慢，f16x8_pack 0.0031ms 最快（比 torch f16 快 2.8x）。

host 侧 dispatch 有个值得注意的隐含约束：

```c++
dim3 block(emb_size / n_elements);
```

block 大小 = `emb_size / pack`，**没有 switch、没有边界检查**——`emb_size` 必须是 `n_elements` 的倍数且商 ≤ 1024，否则静默出错。f32 系列要求 emb_size ≤ 4096 且 4 整除；f16 系列要求 ≤ 8192 且 8 整除。对比 softmax/LN 系列的 `switch + throw` 显式约束（04 小结的"dispatch 约束链"），这里是无保护的**约定式接口**（调用者自己保证）——教学代码常见取舍，生产代码必须显式检查。

### 4. gather 在 LLM 里的位置

embedding 是 LLM 里最重要的 gather，但不是唯一：attention 里的 KV cache 读取（paged attention 的按页索引）、MoE 的 expert 路由、采样时的 top-k 挑选，全是同一模式——**地址由张量内容决定**。这些场景的优化思路（block 内 smem 聚合重复索引、L2 友好的 id 排序）都建立在理解本篇朴素版的基础上：先知道"行内连续、行间随机"的访存结构，才谈得上优化行间的 cache 行为。

## 实测数据（4090, SeqLen=2048, EmbSize=512）

| kernel | 耗时 |
|---|---|
| f32 | 0.00507ms |
| f32x4（手动展开） | 0.01113ms ← 翻车 |
| **f32x4_pack** | **0.00446ms** |
| torch embedding | 0.00982ms |
| f16 | 0.00442ms |
| f16x8（手动展开） | 0.01143ms ← 翻车 |
| **f16x8_pack** | **0.00314ms** |
| torch embedding (f16) | 0.00868ms |

f16x8_pack 比 torch 快 2.8x；两个手动展开版全部比标量还慢——本系列最极端的"写法差一点、性能差一倍"案例。

## 本篇小结

1. **gather 模式**：目标地址由数据（token id）决定，块内行连续、块间随机——与转置（模式固定）相对的另一类访存；L2 命中率依赖 id 分布。
2. **索引读取的 broadcast**：全 block 读同一 `idx[bx]` 合并为一次广播，不是瓶颈。
3. **手动展开 ≠ 向量化**（本篇核心教训）：`tx=threadIdx.x*4` + 4 条标量读写会把 warp 内地址间隔拉成 4，破坏 coalescing，比标量慢 2 倍；必须用 `LDST128BITS`/`FLOAT4` 单条向量指令。**"每线程多管几个元素"只有在"用向量指令搬"时才是优化**。
4. **约定式 dispatch 的风险**：`block(emb_size/n)` 无检查，形状约束（整除、≤1024）由调用者保证——对比 softmax 系列的显式 throw。
