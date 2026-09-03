---
title: Histogram
order: 12
---

# Histogram CUDA代码学习

> 本人学习笔记，AI总结

直方图统计是**原子操作（atomic）**教学的经典案例：N 个元素往 M 个桶里计数，"多对一写"没法用任何常规手段避开竞争——`count[b] += 1` 这种"读-改-写"在并行下必然丢更新，必须原子化。本篇代码极短（两个 kernel 共 30 行），但它引出的问题不小：**全局原子操作到底有多贵、什么时候成为灾难、工业界怎么救**。实测会看到一个触目惊心的数字：**手写全局原子版比 torch.histc 慢 25 倍**。

## 完整代码

### `histogram.cu`
<details>
<summary> histogram.cu </summary>

```c++
// Histogram
// grid(N/256), block(256)
// a: Nx1, y: count histogram, a >= 1
__global__ void histogram_i32_kernel(int *a, int *y, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    atomicAdd(&(y[a[idx]]), 1);
}

// Histogram + Vec4
// grid(N/256), block(256/4)
// a: Nx1, y: count histogram, a >= 1
__global__ void histogram_i32x4_kernel(int *a, int *y, int N) {
  int idx = 4 * (blockIdx.x * blockDim.x + threadIdx.x);
  if (idx < N) {
    int4 reg_a = INT4(a[idx]);
    atomicAdd(&(y[reg_a.x]), 1);
    atomicAdd(&(y[reg_a.y]), 1);
    atomicAdd(&(y[reg_a.z]), 1);
    atomicAdd(&(y[reg_a.w]), 1);
  }
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define CHECK_TORCH_TENSOR_SHAPE(T, S0)                                        \
  if (((T).size(0) != (S0))) {                                                 \
    throw std::runtime_error("Tensor size mismatch!");                         \
  }

#define TORCH_BINDING_HIST(packed_type, th_type, element_type, n_elements)     \
  torch::Tensor histogram_##packed_type(torch::Tensor a) {                     \
    CHECK_TORCH_TENSOR_DTYPE(a, (th_type))                                     \
    auto options =                                                             \
        torch::TensorOptions().dtype(torch::kInt32).device(torch::kCUDA, 0);   \
    const int N = a.size(0);                                                   \
    std::tuple<torch::Tensor, torch::Tensor> max_a = torch::max(a, 0);         \
    torch::Tensor max_val = std::get<0>(max_a).cpu();                          \
    const int M = max_val.item().to<int>();                                    \
    auto y = torch::zeros({M + 1}, options);                                   \
    static const int NUM_THREADS_PER_BLOCK = 256 / (n_elements);               \
    const int NUM_BLOCKS = (N + 256 - 1) / 256;                                \
    dim3 block(NUM_THREADS_PER_BLOCK);                                         \
    dim3 grid(NUM_BLOCKS);                                                     \
    histogram_##packed_type##_kernel<<<grid, block>>>(                         \
        reinterpret_cast<element_type *>(a.data_ptr()),                        \
        reinterpret_cast<element_type *>(y.data_ptr()), N);                    \
    return y;                                                                  \
  }

TORCH_BINDING_HIST(i32, torch::kInt32, int, 1)
TORCH_BINDING_HIST(i32x4, torch::kInt32, int, 4)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(histogram_i32)
  TORCH_BINDING_COMMON_EXTENSION(histogram_i32x4)
}
```

</details>

### `histogram.py`
<details>
<summary> histogram.py </summary>

```python
import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

lib = load(
    name="hist_lib",
    sources=["histogram.cu"],
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

a = torch.tensor(list(range(10)) * 1000, dtype=torch.int32).cuda()
h_i32 = lib.histogram_i32(a)
print("-" * 80)
for i in range(h_i32.shape[0]):
    print(f"h_i32   {i}: {h_i32[i]}")

print("-" * 80)
h_i32x4 = lib.histogram_i32x4(a)
for i in range(h_i32x4.shape[0]):
    print(f"h_i32x4 {i}: {h_i32x4[i]}")
print("-" * 80)
```

</details>

## 逐段代码剖析/学习

### 1. 为什么必须 atomic：丢更新现场

先看不用原子会怎样。`y[b] += 1` 不是一条指令，是三步：

```
线程 A: 读 y[5] (旧值 100)          线程 B: 读 y[5] (旧值 100)
线程 A: 加 1 → 101                   线程 B: 加 1 → 101
线程 A: 写回 y[5] = 101              线程 B: 写回 y[5] = 101   ← B 覆盖 A!
结果: 两次 +1, y[5] 只涨了 1 —— 丢了一次更新
```

17M 个元素并发放 256 个桶上，这种竞争每秒发生几十亿次——不用原子结果完全不可信。`atomicAdd` 把"读-改-写"变成硬件保证的不可分割操作，任一时刻同一地址只有一个原子操作在进行，其余排队。

**atomic 的正确性代价是排队**。这正是 03 提过的"先 block 内归约再原子加摊薄次数"的反面教材——本篇 kernel 是**每个元素一次原子加**，一次都不摊。

### 2. 竞争有多惨：数据说话

我补了一个压力测试（N=16M，两种值域分布）：

| 场景 | histogram_i32 | histogram_i32x4 | torch.histc |
|---|---|---|---|
| **bin=256（17M 元素挤 256 桶）** | **3.676ms** | 3.620ms | **0.144ms** |
| bin=N=16M（每桶 ~1 个元素） | 0.364ms | 0.407ms | — |

两个场景差 **10 倍**（3.68 vs 0.36ms），而数据量完全一样——慢的 10 倍全是**原子竞争**：17M 个原子加挤 256 个地址，硬件把这些操作按地址 hash 进 L2 的有限原子单元排队，同一地址的原子操作完全串行。理论串行下限 ≈ 17M/256 × 单次原子延迟，实测 3.68ms 正是被这个支配。

**bin=N 时几乎无竞争**（每个地址平均只被碰一次），0.36ms 就回到了接近访存下限。所以直方图的性能公式大致是：

```
耗时 ∝ max(访存 N, 竞争 N/bin_count × 原子延迟)
        ↑ bin 少 (256) 时第二项爆炸
```

### 3. torch.histc 为什么快 25 倍：smem 私有直方图 + 归并

bin=256 场景 torch.histc 0.144ms vs 手写 3.68ms——**25 倍**。它赢在**两阶段归并**（thrust/cub 的标准直方图算法）：

```
阶段 1: 每个 block 在 shared memory 里建一个 私有 直方图 (256 个 int, 1KB)
        block 内 256 个线程往 私有 桶 atomicAdd —— smem 原子比 global 原子快
        (smem 在 SM 内部, 原子操作在 SM 本地完成, 不用去 L2 排队)
阶段 2: block 结束前, 把私有直方图 256 桶 归并 到 global:
        atomicAdd(y[b], private[b])  ← 每 block 只发 256 次全局原子, 不再是 N/block_size 次
```

数字对比（N=17M，block=256，bin=256）：

```
手写: 全局原子次数 = N = 17,000,000 次   ← 全部去 L2 排队
两阶段: smem 原子 = 17M 次(SM本地,快) + 全局原子 = block 数 × 256
      = 65536 block × 256 = 16.7M... 也不少?
```

等等，这个账好像不对。真正的关键差异还有一个：**smem 原子的吞吐远高于 global 原子**（smem 原子在 SM 内的 LSU 完成，一个 SM 一拍能处理多个不同 bank 的原子；global 原子要过 L2，同一地址在 L2 的同一 atomic 单元完全串行）。而且归并阶段 65536 个 block 每个发 256 次 atomicAdd，这 1677 万次**分散在 256 个地址上但每个 block 的 256 次是不同地址**（桶 0..255 各一次），排队压力和手写版不同分布。核心收益排序：**① smem 原子取代大部分 global 原子（本地 vs L2）；② 同一 block 内的竞争从"全 grid"缩小到"block 内"（256 线程竞争 vs 65536×256 线程竞争）**。

这个模式在 03 的"block 内 reduce 到位再 atomicAdd"就出现过——直方图是它的加强版：**reduce 的是"每桶计数"，载体从寄存器换成 smem 数组**。

### 4. i32x4 的向量化再次失效

i32x4 用 `INT4` 一条指令读 4 个 int，然后发 4 次 atomicAdd——**load 端省了，原子端一条没省**。实测 bin=256 时 3.62 vs 3.68ms（持平），bin=N 时 0.407 vs 0.364ms（**反而慢 12%**，寄存器压力）。又一次验证 09/11 的结论：**向量化只优化访存端；瓶颈在原子（计算/同步）时，向量化无效甚至负收益**。本篇是这个教训的第三次出场，也是最后一次——到此可以总结成铁律了：

> **优化手段必须打在瓶颈上**：访存瓶颈 → 向量化/coalescing/staging（02/09）；计算瓶颈 → 换算法/查表/降精度（08/11）；同步瓶颈 → 摊薄原子/私有副本/重排访问（03/12）。

### 5. host 侧的 `torch::max` 换桶数

```c++
std::tuple<torch::Tensor, torch::Tensor> max_a = torch::max(a, 0);
torch::Tensor max_val = std::get<0>(max_a).cpu();   // ← GPU→CPU 同步!
const int M = max_val.item().to<int>();
auto y = torch::zeros({M + 1}, options);
```

桶数 = max(a)+1，用 torch 算 max 再 `.cpu()` 拿回标量。注意 `.cpu()` 是**设备同步点**（GPU 算完、拷回、host 才能继续）——数据流上这是一次额外的全量扫描 + 同步。真实库会用固定桶数（如 256/4096）避免这次扫描；本实现是教学取舍：简单、正确，代价是 host 侧多一遍 max。

## 本篇小结

1. **atomic 的必要性**：读-改-写在并行下丢更新，`y[b]+=1` 必须原子；代价是同地址串行排队。
2. **竞争强度 = N / bin_count**：bin 少（256）时 17M 次原子挤 256 个地址，比无竞争慢 10 倍；直方图性能公式 `∝ max(访存, 竞争×原子延迟)`。
3. **两阶段归并**（torch.histc 快 25 倍的秘诀）：block 私有 smem 直方图（SM 本地原子）+ block 间归并（每 block 只发 bin_count 次全局原子）——03"先归约再原子"的数组加强版。
4. **smem 原子 vs global 原子**：smem 原子在 SM 内完成、吞吐高；global 原子过 L2 同地址完全串行——这也是 smem 继"访存整形器"（09）之后的第二个角色：**原子竞争的隔离层**。
5. **瓶颈铁律第三次验证**：向量化在原子瓶颈下零收益（i32x4 实测持平/更慢）——优化手段必须打在瓶颈上。
