---
title: Triton Kernels
order: 21
---

# Triton Kernel 代码学习

> 本人学习笔记，AI总结

用 Triton 写了 20 篇手写 CUDA 之后回头看 Triton，视角和入门者完全不同：**不再是"学一个新框架"，而是"检验 CUDA 功力之后看抽象层替你干了哪些活"**。本篇用两个 kernel（vector-add、fused-softmax）做这个对照实验。

实测（RTX 4090）：

| kernel | 指标 | Triton | 对照 |
|---|---|---|---|
| vector-add（134M 元素） | 带宽 | 944 GB/s | 4090 理论 ~1008 GB/s 的 **94%** |
| fused-softmax（~16K 列） | 带宽 | ~870 GB/s | naive torch softmax ~235 GB/s 的 **3.7x** |

先给结论：**Triton 不是"不用懂 CUDA 的 GPU 编程"，是"懂 CUDA 的人把重复劳动外包出去"**。04 篇结尾提过"我之前就是学习了 Triton，原来 CUDA 有这种坑"——现在反过来验收：Triton 到底替你躲了哪些坑。

## Vector-Add：30 行 Python = 02 篇的完整演进链

```python
@triton.jit
def add_kernel(x_ptr, y_ptr, output_ptr, n_elements, BLOCK_SIZE: tl.constexpr):
    pid = tl.program_id(axis=0)                    # ← blockIdx.x
    block_start = pid * BLOCK_SIZE
    offsets = block_start + tl.arange(0, BLOCK_SIZE)  # ← 本 program 的 1024 个下标
    mask = offsets < n_elements                    # ← 边界保护
    x = tl.load(x_ptr + offsets, mask=mask)        # ← load, 自动向量化
    y = tl.load(y_ptr + offsets, mask=mask)
    output = x + y                                 # ← 1024 宽的 SIMD 运算
    tl.store(output_ptr + offsets, output, mask=mask)
```

逐行对照 02 篇 elementwise 的手写演进（elementwise_add_f32 → f32x4 → ... → LDST128BITS）：

| Triton 概念 | 对应的手写 CUDA | 02 篇花了多少版 |
|---|---|---|
| `tl.arange(0, BLOCK_SIZE)` | 每线程算 `idx = blockIdx.x*blockDim.x + tid` | 手算索引 |
| `tl.load(ptr + offsets, mask=)` | 向量化 load + 边界判断 + **自动挑向量宽度** | f32 → f32x4 → LDST128BITS 共 5 版 |
| `x + y`（tensor 级运算） | 每线程标量运算，或手写 float4 拆 .x/.y/.z/.w | 手写 pack/unpack |
| `BLOCK_SIZE: tl.constexpr` | 模板参数 + dispatch switch | softmax PR 里我们刚手写过 `_NT` dispatch |

**最关键的对照：向量化宽度的选择**。02 篇我们手推 FLOAT4/HALF2/LDST128BITS 的适用条件，04 篇的 PR 修非 8 对齐修了一下午——Triton 编译器看 `tl.load` 的对齐信息**自动**选宽度、**自动**生成尾部标量路径。04 篇踩的"128bit 加载要求 16 字节对齐，行基址对齐是行属性"的坑，Triton 用户根本不知道存在。这就是"编译器自动化"的含金量。

**但注意 Triton 没替你做的**：`BLOCK_SIZE=1024` 这个数还是要你给——它对应手写的"block 多大、每线程几元素"的资源权衡（寄存器/smem/占用率），Triton 只是把它从"不可写错"变成"可调优"。自动挡不等于不用会开手动挡。

## Grid 的两种形态：静态 vs lambda

```python
grid = lambda meta: (triton.cdiv(n_elements, meta["BLOCK_SIZE"]),)
add_kernel[grid](x, y, output, n_elements, BLOCK_SIZE=1024)
```

`grid` 可以是 tuple（静态）也可以是 lambda（按 meta 参数动态算）——对应 CUDA 的 `dim3 grid(N/256)`，但把"BLOCK_SIZE 改了 grid 要跟着改"的联动收进一个闭包，不会改漏。

## Fused-Softmax：和 04 篇手写版的结构对照

```python
@triton.jit
def softmax_kernel(output_ptr, input_ptr, ..., n_cols, BLOCK_SIZE: tl.constexpr, k_stages: tl.constexpr):
    row_start = tl.program_id(0)
    row_step = tl.num_programs(0)                       # grid-stride loop!
    for row_idx in tl.range(row_start, n_rows, row_step, num_stages=k_stages):
        ...
        row = tl.load(input_ptrs, mask=mask, other=-float("inf"))   # ← other 参数!
        row_minus_max = row - tl.max(row, axis=0)        # 行内归约
        numerator = tl.exp(row_minus_max)
        denominator = tl.sum(numerator, axis=0)
        softmax_output = numerator / denominator
        tl.store(...)
```

和 04 篇手写 per-token softmax 逐项对：

| 04 篇手写 | Triton |
|---|---|
| `blockIdx.x` = 行号，一行一 block | `program_id(0)` = 行起点 + `num_programs` 步进的 grid-stride |
| 手写 warp 蝴蝶归约 + block 两阶段（03 篇全套） | `tl.max(row, axis=0)` 一行——归约树编译器生成 |
| 尾部脏值手动 mask（`__float2half(-65504)`） | `other=-inf` 参数：mask 外的 load 填 -inf，`exp(-inf)=0` 自动无害 |
| f32 acc 保精度（手写 `__half2float`） | dtype 推导自动升 f32 算 |
| —— | `num_stages=k_stages`：**15/17 篇手写的多级流水，一个参数**（编译器软件流水化循环） |

**`other=-inf` 是精髓**：04 篇 softmax PR 的核心 bug（尾部越界值混进 max/sum）在 Triton 里是 load 的一个可选参数——mask 住的元素参与归约时以 `-inf` 身份出现，对 max 无影响、exp 后为 0 对 sum无贡献。**语义层面的边界处理**取代**指令层面的越界规避**。

`num_stages` 更是把 15 篇 double buffer、17 篇 cp.async 多级流水压缩成一个整数：`tl.range(..., num_stages=3)` 告诉编译器"这个循环帮我软件流水化成 3 级"。手写 400 行的 stage2/3/4 三个 kernel，Triton 里是同一个 kernel 的不同参数——**参数化即版本化**。

## 走一遍编程模型（和新手教程不一样的讲法）

Triton 的执行模型刻意对应 CUDA 但术语换了：

```
CUDA:    grid → block(threads) → warp → lane → element(s)
Triton:  grid → program        → (block 内部结构编译器全权处理)
                └ 每个操作直接作用在 BLOCK_SIZE 宽的 tensor 上
```

最大差异：**CUDA 程序员以"线程"为第一人称写代码（每线程一个标量故事）；Triton 以"program"为第一人称写代码（每 program 一个 block 宽的张量故事）**。中间的"1024 个元素怎么分配给 32×8 线程、每线程拿几个、怎么向量化、归约树怎么搭"全部由编译器决定——它是 block 级的 SPMD，不是线程级的。

这解释了 Triton 的甜点区：**每个 program 内有丰富数据并行、program 间无依赖**的 kernel（elementwise、softmax、matmul tile）——01~06 篇全部命中。而 09 篇对角线转置那种"block 间要协调调度"、14 篇 NMS 那种"顺序敏感 + 全局数据依赖"的算法，Triton 要么写不了要么退化——**数据依赖越怪，越接近硬件层的表达力越不可替代**。

## 环境/兼容实录（跑这俩脚本的坑）

- `pycuda` 编不过（装不上）→ `get_device_properties` 用 torch API 改写（`multi_processor_count`/`regs_per_multiprocessor`/`warp_size`；torch 没暴露 smem/block 和 regs/block，4090 按 sm_89 已知值硬编码）
- 缺 `matplotlib`/`pandas`（benchmark 画图依赖）→ pip 补
- layer-norm 前后向脚本用了旧版 triton API（`get_active_torch_device` 不存在，装的是 3.1.0）→ **没跑成，作为已知问题记录**，不编造数据

## 完整代码

### `triton_vector_add.py`
<details>
<summary> triton_vector_add.py </summary>

```python
"""
Adapted from: https://github.com/triton-lang/triton/blob/main/python/tutorials/01-vector-add.py

Vector Addition
===============

In this tutorial, you will write a simple vector addition using Triton.

In doing so, you will learn about:

* The basic programming model of Triton.

* The `triton.jit` decorator, which is used to define Triton kernels.

* The best practices for validating and benchmarking your custom ops against native reference implementations.

"""

# %%
# Compute Kernel
# --------------

import torch
import triton
import triton.language as tl

DEVICE = torch.device("cuda:0")

@triton.jit
def add_kernel(
    x_ptr,  # *Pointer* to first input vector.
    y_ptr,  # *Pointer* to second input vector.
    output_ptr,  # *Pointer* to output vector.
    n_elements,  # Size of the vector.
    BLOCK_SIZE: tl.constexpr,  # Number of elements each program should process.
    # NOTE: `constexpr` so it can be used as a shape value.
):
    # There are multiple 'programs' processing different data. We identify which program
    # we are here:
    pid = tl.program_id(axis=0)  # We use a 1D launch grid so axis is 0.
    # This program will process inputs that are offset from the initial data.
    # For instance, if you had a vector of length 256 and block_size of 64, the programs
    # would each access the elements [0:64, 64:128, 128:192, 192:256].
    # Note that offsets is a list of pointers:
    block_start = pid * BLOCK_SIZE
    offsets = block_start + tl.arange(0, BLOCK_SIZE)
    # Create a mask to guard memory operations against out-of-bounds accesses.
    mask = offsets < n_elements
    # Load x and y from DRAM, masking out any extra elements in case the input is not a
    # multiple of the block size.
    x = tl.load(x_ptr + offsets, mask=mask)
    y = tl.load(y_ptr + offsets, mask=mask)
    output = x + y
    # Write x + y back to DRAM.
    tl.store(output_ptr + offsets, output, mask=mask)


# %%
# Let's also declare a helper function to (1) allocate the `z` tensor
# and (2) enqueue the above kernel with appropriate grid/block sizes:


def add(x: torch.Tensor, y: torch.Tensor):
    # We need to preallocate the output.
    output = torch.empty_like(x)
    assert x.device == DEVICE and y.device == DEVICE and output.device == DEVICE
    n_elements = output.numel()
    # The SPMD launch grid denotes the number of kernel instances that run in parallel.
    # It is analogous to CUDA launch grids. It can be either Tuple[int], or Callable(metaparameters) -> Tuple[int].
    # In this case, we use a 1D grid where the size is the number of blocks:
    grid = lambda meta: (triton.cdiv(n_elements, meta["BLOCK_SIZE"]),)
    # NOTE:
    #  - Each torch.tensor object is implicitly converted into a pointer to its first element.
    #  - `triton.jit`'ed functions can be indexed with a launch grid to obtain a callable GPU kernel.
    #  - Don't forget to pass meta-parameters as keywords arguments.
    add_kernel[grid](x, y, output, n_elements, BLOCK_SIZE=1024)
    # We return a handle to z but, since `torch.cuda.synchronize()` hasn't been called, the kernel is still
    # running asynchronously at this point.
    return output


# %%
# We can now use the above function to compute the element-wise sum of two `torch.tensor` objects and test its correctness:

torch.manual_seed(0)
size = 98432
x = torch.rand(size, device=DEVICE)
y = torch.rand(size, device=DEVICE)
output_torch = x + y
output_triton = add(x, y)
print(output_torch)
print(output_triton)
print(
    f"The maximum difference between torch and triton is "
    f"{torch.max(torch.abs(output_torch - output_triton))}"
)

# %%
# Seems like we're good to go!

# %%
# Benchmark
# ---------
#
# We can now benchmark our custom op on vectors of increasing sizes to get a sense of how it does relative to PyTorch.
# To make things easier, Triton has a set of built-in utilities that allow us to concisely plot the performance of our custom ops.
# for different problem sizes.


@triton.testing.perf_report(
    triton.testing.Benchmark(
        x_names=["size"],  # Argument names to use as an x-axis for the plot.
        x_vals=[
            2**i for i in range(12, 28, 1)
        ],  # Different possible values for `x_name`.
        x_log=True,  # x axis is logarithmic.
        line_arg="provider",  # Argument name whose value corresponds to a different line in the plot.
        line_vals=["triton", "torch"],  # Possible values for `line_arg`.
        line_names=["Triton", "Torch"],  # Label name for the lines.
        styles=[("blue", "-"), ("green", "-")],  # Line styles.
        ylabel="GB/s",  # Label name for the y-axis.
        plot_name="vector-add-performance",  # Name for the plot. Used also as a file name for saving the plot.
        args={},  # Values for function arguments not in `x_names` and `y_name`.
    )
)
def benchmark(size, provider):
    x = torch.rand(size, device=DEVICE, dtype=torch.float32)
    y = torch.rand(size, device=DEVICE, dtype=torch.float32)
    quantiles = [0.5, 0.2, 0.8]
    if provider == "torch":
        ms, min_ms, max_ms = triton.testing.do_bench(
            lambda: x + y, quantiles=quantiles
        )
    if provider == "triton":
        ms, min_ms, max_ms = triton.testing.do_bench(
            lambda: add(x, y), quantiles=quantiles
        )
    gbps = lambda ms: 3 * x.numel() * x.element_size() * 1e-9 / (ms * 1e-3)
    return gbps(ms), gbps(max_ms), gbps(min_ms)


# %%
# We can now run the decorated function above. Pass `print_data=True` to see the performance number, `show_plots=True` to plot them, and/or
# `save_path='/path/to/results/' to save them to disk along with raw CSV data:
benchmark.run(print_data=True, show_plots=True, save_path="./")
```

</details>

### `triton_fused_softmax.py`
<details>
<summary> triton_fused_softmax.py </summary>

```python
"""
Adapted from Triton tutorial
https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html#sphx-glr-getting-started-tutorials-02-fused-softmax-py
"""

import torch
import triton
import triton.language as tl


# @torch.compile
def naive_softmax(x: torch.Tensor) -> torch.Tensor:
    """Compute row-wise softmax of X using native pytorch

    We subtract the maximum element in order to avoid overflows. Softmax is invariant to
    this shift.
    """
    # read  MN elements ; write M  elements
    x_max = x.max(dim=1)[0]
    # read MN + M elements ; write MN elements
    z = x - x_max[:, None]
    # read  MN elements ; write MN elements
    numerator = torch.exp(z)
    # read  MN elements ; write M  elements
    denominator = numerator.sum(dim=1)
    # read MN + M elements ; write MN elements
    ret = numerator / denominator[:, None]
    # in total: read 5MN + 2M elements ; wrote 3MN + 2M elements
    return ret


@triton.jit
def softmax_kernel(
    output_ptr,
    input_ptr,
    input_row_stride,
    output_row_stride,
    n_rows,
    n_cols,
    BLOCK_SIZE: tl.constexpr,
    k_stages: tl.constexpr,
):
    # starting row of the program
    row_start = tl.program_id(0)
    row_step = tl.num_programs(0)
    for row_idx in tl.range(row_start, n_rows, row_step, num_stages=k_stages):
        # The stride represents how much we need to increase the pointer to advance 1 row
        row_start_ptr = input_ptr + row_idx * input_row_stride
        # The block size is the next power of two greater than n_cols, so we can fit each
        # row in a single block
        col_offsets = tl.arange(0, BLOCK_SIZE)
        input_ptrs = row_start_ptr + col_offsets
        # Load the row into SRAM, using a mask since BLOCK_SIZE may be > than n_cols
        mask = col_offsets < n_cols
        row = tl.load(input_ptrs, mask=mask, other=-float("inf"))
        # Subtract maximum for numerical stability
        row_minus_max = row - tl.max(row, axis=0)
        # Note that exponentiation in Triton is fast but approximate (i.e., think __expf in CUDA)
        numerator = tl.exp(row_minus_max)
        denominator = tl.sum(numerator, axis=0)
        softmax_output = numerator / denominator
        # Write back output to DRAM
        output_row_start_ptr = output_ptr + row_idx * output_row_stride
        output_ptrs = output_row_start_ptr + col_offsets
        tl.store(output_ptrs, softmax_output, mask=mask)


def get_device_properties(device_id=None):
    # pycuda 不可用时用 torch 查询设备属性
    if device_id is None:
        device_id = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(device_id)
    NUM_SM = props.multi_processor_count
    NUM_REGS = props.regs_per_multiprocessor
    SIZE_SMEM = 100 * 1024  # sm_89: 100KB shared per block (opt-in max)
    WARP_SIZE = props.warp_size
    return NUM_SM, NUM_REGS, SIZE_SMEM, WARP_SIZE


DEVICE = torch.cuda.current_device()
NUM_SM, NUM_REGS, SIZE_SMEM, WARP_SIZE = get_device_properties(DEVICE)
print(
    f"NUM_SM: {NUM_SM}, NUM_REGS: {NUM_REGS}, "
    f"SIZE_SMEM: {SIZE_SMEM}, WARP_SIZE: {WARP_SIZE}"
)


def get_num_programs(x):
    n_rows, n_cols = x.shape
    # The block size of each loop iteration is the smallest power
    # of two greater than the number of columns in `x`
    BLOCK_SIZE = triton.next_power_of_2(n_cols)
    num_warps = 8
    # Number of software pipelining stages.
    k_stages = 4 if SIZE_SMEM > 200000 else 2
    # Allocate output
    y = torch.empty_like(x)
    # pre-compile kernel to get register usage and compute thread occupancy.
    kernel = softmax_kernel.warmup(
        y,
        x,
        x.stride(0),
        y.stride(0),
        n_rows,
        n_cols,
        BLOCK_SIZE=BLOCK_SIZE,
        k_stages=k_stages,
        num_warps=num_warps,
        grid=(1,),
    )
    kernel._init_handles()
    n_regs = kernel.n_regs
    # shared > 0 if k_stages is not 0
    size_smem = kernel.metadata.shared
    occupancy = NUM_REGS // (n_regs * WARP_SIZE * num_warps)
    occupancy = min(occupancy, SIZE_SMEM // size_smem)
    num_programs = NUM_SM * occupancy
    return num_programs


NUM_PROGRAMS = get_num_programs(torch.randn(4096, 2048, device="cuda"))


def triton_softmax(x: torch.Tensor):
    """Compute row-wise softmax of X using Triton"""
    n_rows, n_cols = x.shape
    # The block size of each loop iteration is the smallest power of
    # two greater than the number of columns in `x`
    BLOCK_SIZE = triton.next_power_of_2(n_cols)
    num_warps = 8
    # Number of software pipelining stages.
    k_stages = 4 if SIZE_SMEM > 200000 else 2
    # Allocate output
    y = torch.empty_like(x)
    num_programs = min(NUM_PROGRAMS, n_rows)

    # Create a number of persistent programs.
    softmax_kernel[(num_programs, 1, 1)](
        y,
        x,
        x.stride(0),
        y.stride(0),
        n_rows,
        n_cols,
        BLOCK_SIZE=BLOCK_SIZE,
        k_stages=k_stages,
        num_warps=num_warps,
    )
    return y


torch.manual_seed(0)
x = torch.randn(1823, 781, device="cuda")
y_triton = triton_softmax(x)
y_torch = naive_softmax(x)
assert torch.allclose(y_triton, y_torch), (y_triton, y_torch)


@triton.testing.perf_report(
    triton.testing.Benchmark(
        x_names=["M"],  # argument names to use as an x-axis for the plot
        x_vals=[
            256 * i for i in range(1, 64)
        ],  # different possible values for `x_name`
        line_arg="provider",  # argument name whose value corresponds to a different line in the plot
        line_vals=[
            "triton-fused-softmax",
            "torch-fused-softmax",
            "torch-naive-softmax",
        ],  # possible values for `line_arg``
        line_names=[
            "Triton Fused Softmax",
            "Torch Fused Softmax",
            "Torch Naive Softmax",
        ],  # label name for the lines
        styles=[("blue", "-"), ("green", "-"), ("red", "-")],  # line styles
        ylabel="GB/s",  # label name for the y-axis
        xlabel=f"M, {torch.cuda.get_device_name(DEVICE)}",  # label name for the x-axis
        plot_name="softmax-performance",  # name for the plot. Used also as a file name for saving the plot.
        args={
            "N": 2048
        },  # values for function arguments not in `x_names` and `y_name`
    )
)
def benchmark(M, N, provider):
    x = torch.randn(M, N, device=DEVICE, dtype=torch.float32)
    stream = torch.cuda.Stream()
    torch.cuda.set_stream(stream)
    if provider == "torch-naive-softmax":
        ms = triton.testing.do_bench(lambda: naive_softmax(x))
    if provider == "triton-fused-softmax":
        ms = triton.testing.do_bench(lambda: triton_softmax(x))
    if provider == "torch-fused-softmax":
        ms = triton.testing.do_bench(lambda: torch.softmax(x, dim=-1))
    gbps = lambda ms: 2 * x.numel() * x.element_size() * 1e-9 / (ms * 1e-3)
    return gbps(ms)


benchmark.run(show_plots=True, print_data=True, save_path="./")
```

</details>

## 本篇小结

1. **Triton = 手写 CUDA 演进链的编译器自动化**：02 篇 5 版向量化演进 + 04 篇的尾部对齐坑，在 Triton 里是 `tl.load` 一个原语——对齐分析、宽度选择、尾部标量路径全自动
2. **`other=` 参数是语义级边界处理**：mask 外填 -inf，让 exp/sum 数学上自动无害——取代 04 篇 PR 修的整个 bug 类别
3. **`num_stages` 一个整数 = 15/17 篇的多级流水手艺**：软件流水化参数化，手写 400 行三 kernel 变一个参数三档
4. **编程模型差异的本质**：CUDA 线程第一人称（标量故事）vs Triton program 第一人称（BLOCK 宽张量故事）——block 内的分配/归约/向量化全部上交编译器
5. **甜点区边界**：数据并行规则型 kernel（01~06 篇类型）Triton 完胜起步速度；依赖复杂型（09 对角调度、14 NMS）手写不可替代
6. **实跑验证**：vector-add 944 GB/s（峰值 94%）、fused-softmax 870 GB/s（naive 的 3.7x）——抽象不用付性能税（在这类 kernel 上）
