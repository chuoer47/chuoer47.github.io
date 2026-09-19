---
title: Histogram
order: 12
---

# Histogram CUDA代码学习

> 本人学习笔记，AI总结

直方图统计是 **原子操作（atomic）** 教学的经典案例：N 个元素往 M 个桶里计数，"多对一写"没法用任何常规手段避开竞争——`count[b] += 1` 这种"读-改-写"在并行下必然丢更新，必须原子化。本篇代码极短（两个 kernel 共 30 行），但它引出的问题不小：**全局原子操作到底有多贵、什么时候成为灾难、工业界怎么救**。实测会看到一个触目惊心的数字：**手写全局原子版比 torch.histc 慢 25 倍**。

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
        block 内 256 个线程往 私有 桶 atomicAdd
阶段 2: block 结束前, 把私有直方图 256 桶 归并 到 global:
        atomicAdd(y[b], private[b])  ← 每 block 只发 256 次全局原子
```

先算总次数的账（N=17M，block=256 线程，bin=256，block 数 = 17M/256 ≈ 66k）：

```
手写:  全局原子 17,000,000 次
两阶段: smem 原子 17,000,000 次 + 全局原子 66k × 256 ≈ 16,900,000 次
```

奇怪——**全局原子的总次数几乎没降**！那 25 倍的收益从哪来？来自三个质变，而不是量变：

**① smem 原子的执行位置完全不同**。手写版的 17M 次原子全在 global memory 上，要过 L2：L2 的原子单元按地址分布，**同一地址的操作在同一个单元里完全串行**——17M 次原子挤 256 个地址，等于 256 条串行队列，每条排 66k 个操作。两阶段版的 17M 次原子发生在 smem 上，由 SM 本地的 LSU（load-store unit）直接执行，**不去 L2 排队**；不同 bank 的原子可以并行处理。这一步是把"17M 次 L2 排队"换成了"17M 次 SM 本地操作"。

**② 竞争范围从全 grid 缩小到 block 内**。手写版里，一个线程的原子要和**全 grid 66k×256 个线程**竞争同一个桶地址；两阶段版阶段 1 里，竞争者只有**同 block 的 255 个线程**——SM 内就地把竞争消化掉了。

**③ 归并阶段的全局原子"天然打散"**。每个 block 发的 256 次归并原子是**桶 0..255 各一次**——同 block 内 256 次全部不同地址，零竞争；跨 block 之间同一桶地址才冲突，且每个地址的总排队长度 = block 数（66k），和手写版单地址 66k 的排队长度一样……但注意：手写版是**每个地址排 66k 个"1 次加 1"的操作**，归并版是**每个地址排 66k 个"1 次加 private[b]"的批量操作**——后者单次携带的信息量大得多（一整段 block 内计数），排队次数相同但干的事多得多。

一句话总结：**两阶段归并没有减少原子总次数，它改变的是原子在哪里执行、和谁竞争**——从"L2 上全 grid 互踩"变成"SM 内 256 人小房间 + 出门时每人交一次打包好的账"。

这个模式在 03 的"block 内 reduce 到位再 atomicAdd"就出现过——直方图是它的加强版：**reduce 的载体从寄存器（一个数）换成 smem 数组（每桶一个数）**。

### 4. i32x4 的向量化再次失效

i32x4 用 `INT4` 一条指令读 4 个 int，然后发 4 次 atomicAdd——**load 端省了，原子端一条没省**。实测 bin=256 时 3.62 vs 3.68ms（持平），bin=N 时 0.407 vs 0.364ms（**反而慢 12%**，寄存器压力）。又一次验证 09/11 的结论：**向量化只优化访存端；瓶颈在原子（计算/同步）时，向量化无效甚至负收益**。本篇是这个教训的第三次出场，也是最后一次——到此可以总结成铁律了：

> **优化手段必须打在瓶颈上**：访存瓶颈 → 向量化/coalescing/staging（02/09）；计算瓶颈 → 换算法/查表/降精度（08/11）；同步瓶颈 → 摊薄原子/私有副本/重排访问（03/12）。

### 5. host 侧：kernel 之前的准备工作——桶从哪来

回看 kernel 本体只有一行 `atomicAdd(&(y[a[idx]]), 1)`——它**假设 `y` 已经存在**，且长度必须覆盖 `max(a)`（否则 `y[a[idx]]` 越界）。但 kernel 里没人分配 `y`，这个准备落在 host 侧的绑定代码里，顺序必须是三步：

```
第 1 步: 看一眼数据 → M = max(a)        ← 不知道最大值，就不知道要开几个桶
第 2 步: 开长度 M+1 的全零计数数组 y     ← 桶号 0..M，torch::zeros 保证从 0 开始数
第 3 步: 启动 kernel 往 y 里数数
```

比如 `a = [3,1,4,1,5,...]`，max=5，就开 6 个桶（0~5 号），元素 5 落在 `y[5]`。这三步对应代码：

```c++
std::tuple<torch::Tensor, torch::Tensor> max_a = torch::max(a, 0);  // 第 1 步: GPU 上算 max
torch::Tensor max_val = std::get<0>(max_a).cpu();   // ← 全部的坑在这一行
const int M = max_val.item().to<int>();             // 拿到 host 侧 int
auto y = torch::zeros({M + 1}, options);            // 第 2 步: 开桶
... histogram_i32_kernel<<<grid, block>>>(...)      // 第 3 步: 启动 kernel
```

**坑在 `.cpu()` 这一行**。`torch::max` 是在 GPU 上算的（`a` 是 CUDA tensor），但接下来开桶需要的是 host 侧的 int `M`——CPU 必须等这个数从显存拷回来才能继续。CUDA 里 CPU 发射 kernel 本来是异步的（发射完立刻返回，不等 GPU 干完），但这次拷回把整条流水线打断了：

```
正常: CPU 发射 kernel → 立刻去干别的 → GPU 慢慢算
这里: CPU 发射 max → [等 GPU 算完 + 拷回] → CPU 醒来开桶 → 再发射直方图 kernel
                     ↑ 这个等待就是"设备同步点"
```

所以数据流上，这版实现实际做了**两遍扫描**：一遍 GPU max（N 个元素），一遍直方图本体——外加一次强制同步。真实库（如 `torch.histc(a, bins=256)`）让调用方直接指定桶数，`y = zeros(256)` 不需要看数据，max 这一遍扫描和同步就全省了。本实现选"自动适配桶数"是教学取舍：接口简单（调用方不用管桶数）、任何值域都对，代价是 host 侧多一遍全量扫描 + 一次同步。

## 本篇小结

1. **atomic 的必要性**：读-改-写在并行下丢更新，`y[b]+=1` 必须原子；代价是同地址串行排队。
2. **竞争强度 = N / bin_count**：bin 少（256）时 17M 次原子挤 256 个地址，比无竞争慢 10 倍；直方图性能公式 `∝ max(访存, 竞争×原子延迟)`。
3. **两阶段归并**（torch.histc 快 25 倍的秘诀）：block 私有 smem 直方图（SM 本地原子）+ block 间归并（每 block 只发 bin_count 次全局原子）——03"先归约再原子"的数组加强版。
4. **smem 原子 vs global 原子**：smem 原子在 SM 内完成、吞吐高；global 原子过 L2 同地址完全串行——这也是 smem 继"访存整形器"（09）之后的第二个角色：**原子竞争的隔离层**。
5. **瓶颈铁律第三次验证**：向量化在原子瓶颈下零收益（i32x4 实测持平/更慢）——优化手段必须打在瓶颈上。
