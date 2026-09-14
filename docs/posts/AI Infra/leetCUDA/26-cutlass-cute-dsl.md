---
title: CUTLASS CuTe DSL (Python)
order: 26
---

# CUTLASS CuTe DSL：用 Python 写 CUDA Kernel

> 本人学习笔记，AI总结

28 篇总结把它列为"如果继续"的路标之一，本篇兑现。`kernels/cutlass/` 下有两个世界：`cute/`（C++ CuTe 的散件：vector_add、MMA layout 转 LaTeX 的可视化工具）和 `cute_dsl/`（**CUTLASS Python DSL**——用 `@cute.kernel` 装饰器在 Python 里写 GPU kernel，JIT 编译成同一个 PTX）。后者是 NVIDIA 官方 2025 年主推的新范式（CUTLASS 4.x 的 python DSL），写的是 Python、跑的是 CUDA——本篇以 `cute_dsl/sgemm/` 的三个递进文件为主线，把"同一个 SGEMM 用 Python DSL 写三遍"的抽象阶梯走完。

先交代环境（这一节全是坑，实测记录）：

```bash
# pip 装 DSL（leetcuda env）
pip install nvidia-cutlass-dsl==4.5.3
# 坑1：4.7.x 依赖 cuda-python 13.x，驱动 570/CUDA12.8 会报 cudaErrorInsufficientDriver(35)
#      → 必须降版本；4.2.x 又有 "Expect 3d grid!" 的旧 API 报错 → 4.5.x 恰好兼容
# 坑2：这个 pip 包的 import 结构奇葩，cutlass 模块在子目录里，要手动挂 PYTHONPATH：
export PYTHONPATH=$HOME/miniconda3/envs/leetcuda/lib/python3.11/site-packages/nvidia_cutlass_dsl/python_packages:$PYTHONPATH
# 坑3：cute/cute/experimental/__init__.py 硬编码"仅支持 CUDA toolkit 13.1+"，CUDA 12.4 环境直接 raise
#      → sed 把 raise 替换成 pass（该模块本篇用不到，patch 无副作用）
# 坑4：仓库代码里的 options="--generate-line-info" 在新版被禁用 → 删掉该参数
#      sgemm.py 的 launch(grid=(x,y)) 需补成 3 元组 (x,y,1)
```

## 三个文件的实测（4090, 2048³, F32, warmup 10）

| 文件 | 抽象级别 | cute TFLOPS | torch F32 | 正确性 |
|---|---|---|---|---|
| `sgemm.py` | 纯 Python 循环，无 smem | 4.67 | 45.28 | passed |
| `mma_atom.py` | smem tile + TiledMMA | 21.12 | 45.27 | passed |
| `pipelining.py` | + cp.async 三级流水 | 18.84 | 45.29 | passed |

先看清两个事实：**手写 DSL 从 naive 到 MMA 版 4.5 倍提升**（和 15 篇 C++ 的爬坡曲线同构），以及 **MMA 版 21 TFLOPS 只有 torch 的 47%**——教学实现离 cuBLAS 级还远，这与 17 篇"手写 MMA 要到 150 TFLOPS 必须叠满 swizzle/double-buffer/x4"的结论一致，工具换成 Python 不改变这个距离。

## sgemm.py：DSL 的最小形态

```python
@cute.kernel
def matmul_kernel(A: cute.Tensor, B: cute.Tensor, C: cute.Tensor, M, N, K):
    bidx_x, bidx_y = cute.arch.block_idx()[0], cute.arch.block_idx()[1]
    ...
    acc = cute.Float32(0)          # 不能定义在控制流内部！
    if row < M and col < N:
        for k in range(K):          # 共享维
            acc += cute.Float32(A[row, k]) * cute.Float32(B[k, col])  # 显式 upcast
    C[row, col] = cute.Float16(acc)

@cute.jit
def host(A: cute.Tensor, B: cute.Tensor, C: cute.Tensor):
    ...
    matmul_kernel(A, B, C, M, N, K).launch(
        grid=(grid_x, grid_y, 1), block=(block, block, 1))
```

这就是"Python 写 CUDA"的全部仪式感：`@cute.kernel` 标记 device 函数、`@cute.jit` 标记 host 函数、`.launch(grid=, block=)` 替代 `<<<>>>`。三个与 C++ 直觉不同的约束（注释里官方给了原因）：

1. **不支持 early return**——`if (row > M) return;` 在 DSL 里是语法禁区，边界判断只能用谓词化的 `if` 包住计算体（DSL 编译器要把控制流转成 MLIR，提前 return 破坏结构化控制流）。
2. **变量必须定义在控制流外**——`acc` 放在 `if` 内部会编译错，DSL 的作用域规则比 Python 严格（接近 SSA 形式）。
3. **dtype 转换是显式的**——`cute.Float32(A[row,k])` 手动 upcast，没有隐式类型提升；这与 CUDA C++ 的自动提升不同，但和 Triton 的显式风格一致。

编译速度值得记录：`kernel compiled in 0.1020 seconds`——相比 nvcc 编译 hgemm 系列的十几秒，DSL 的 MLIR 编译路径快两个数量级，**迭代速度是 DSL 对 C++ 的最大优势**（比性能更重要）。

## mma_atom.py：把 15 篇的 t8x8sk 翻译成 Python

这是真正有含金量的一版——15 篇 C++ 里几百行的 "sliced-K + smem tile + MMA"，DSL 版 245 行搞定。骨架（对比 15 篇逐块对应）：

```python
# smem layout：行主 + 行尾 padding 4（15 篇的 A_PAD 消 conflict，DSL 里一行 stride 表达）
smem_layout_a = cute.make_layout(shape=(tile_m, tile_k), stride=(1, tile_m + 4))

# gmem→smem 的 TiledCopy：128 线程 × 1 float（CopyUniversalOp = 普通 load/store）
thr_layout_a = cute.make_ordered_layout(shape=(threads // tile_k, tile_k), order=(1, 0))
async_copy_atom_a = cute.make_copy_atom(cute.nvgpu.CopyUniversalOp(), cutlass.Float32, num_bits_per_copy=32)
tiled_copy_a = cute.make_tiled_copy_tv(async_copy_atom_a, thr_layout_a, val_layout_a)

# TiledMMA：16x16 atom 平铺 16×16 个 = 128 线程吃 128×128×8 tile（？不——atom layout (16,16,1) 是 (M,N,K) 轴的 atom 数）
mma_op = cute.nvgpu.MmaUniversalOp(cutlass.Float32)
mma_atoms_layout = cute.make_layout((mma_m, mma_n, 1), stride=(mma_n, 1, 0))
tiled_mma = cute.make_tiled_mma(mma_op, atom_layout_mnk=mma_atoms_layout)
```

主循环的三段式与 19 篇 C++ CuTe 完全同构（gmem copy → barrier → smem partition → make_fragment → gemm → 存回），不再重复——**布局代数的 API 从 C++ 换成 Python，对象名都是同一个**（`local_tile`、`partition_A`、`make_fragment`、`gemm`）。一个 DSL 特有的好处：`VERBOSE = True` 时 kernel 里直接 `print(f"{LOG} tAsA {tAsA}")`，编译期打印每个分片张量的类型和 layout：

```
tAgA tensor<ptr<f32, gmem> o ((1,1),4,1,256):((0,0),65536,0,8)>
tAsA tensor<ptr<f32, smem> o ((1,1),4,1):((0,0),32,0)>
```

等价于 19 篇 C++ 里要靠 `cute::print` 在 device 端费劲输出的内容——**layout 调试体验从"编译错才看"变成"打开开关就看"**。

## pipelining.py：cp.async 三级流水（对照 15 篇 dbuf / 25 篇 WS）

在 mma_atom 版上加流水线，注释写得比代码还精彩（节选原文结构）：

```python
smem_pipe_read = cutlass.Int32(0)                # 读 stage 0
smem_pipe_write = cutlass.Int32(smem_pipe_depth - 1)  # 预写 stage 2

for mma_k_idx in range(num_mma_k, unroll_full=True):
    if mma_k_idx == num_mma_k - 1:               # 当前 smem tile 快吃完了
        cute.arch.cp_async_wait_group(smem_pipe_depth - 2)   # 等"还有 ≤1 组在飞"
        cute.arch.barrier()

    mma_k_next = (mma_k_idx + 1) % num_mma_k
    cute.autovec_copy(tCsA_[..., mma_k_next], tCrA[..., mma_k_next])  # 预取下一份寄存器

    if mma_k_idx == 0:                            # 每吃一个新 tile：
        cute.copy(tiled_copy_a, tAgA[..., gmem_pipe_read], tAsA[..., smem_pipe_write])  # 发起 A 拷贝
    cute.gemm(tiled_mma, tCrC, tCrA[..., mma_k_idx], tCrB[..., mma_k_idx], tCrC)
    if mma_k_idx == 0:
        cute.copy(tiled_copy_b, ...)              # B 的拷贝放在 gemm 之后！
        cute.arch.cp_async_commit_group()
        smem_pipe_write = smem_pipe_read          # 环形推进
        smem_pipe_read += 1
```

源码注释自曝设计意图："**B copy placed after the gemm, not before. Why? to interleave memory and compute instructions**"——把 B 的拷贝指令插在 gemm 之后，让访存指令和 MMA 指令在 SASS 流里交错，GPU 才能在等访存时算 MMA。这正是 15 篇 double buffer 的指令级细节，DSL 版把它显式写出来了。流水协议（`cp_async_wait_group(depth-2)`、读写指针环形推进、`gmem_pipe_read` 回绕到 1 而不是 0）与 25 篇 cuda::pipeline 的 acquire/release 语义等价——**三级流水在 C++ 手写版、WS 版、Python DSL 版三处出现，协议一致**，这是值得在脑中固化的"通用协议"。

实测 pipelining 版（18.84）反而略慢于 mma_atom 版（21.12）——2048³ 规模小，流水线的 wait/barrier 开销还没被收益覆盖（15 篇同现象：dbuf 版在 4096 以下不如 sliced-K）。**判断流水线是否值得的 shape 阈值，与语言无关**。

## cute/ 目录的两个 C++ 散件

- **vector_add.cu**：CuTe 版 vector add（`local_tile` 每线程取 8 个 half + `recast<half2>` 成对 hfma2 + `copy` 写回），19 篇 API 的最小练手。注意它**没有 main**，是个纯 kernel 片段（编译要自己补 host 代码或当阅读材料）。
- **mma_tile_tex.cc**：把 MMA atom 的 A/B/C 线程-值 layout 渲染成 TikZ/LaTeX 表格的工具（GitHub gist 移植）。本仓库的 CUTLASS submodule 已到 v4.6.1，其中 `get_layoutC_MN` 等 API 已被移除——编译报 `wrong number of template arguments`。这是 **CuTe API 断代**的活教材（老版本 CUTLASS 3.x 的 API），修复需按新 API 重写模板匹配，教学价值大于使用价值，留作 API 演进的注脚即可。

## DSL vs C++ CuTe vs Triton：三视角

| 维度 | CUDA C++（15/17 篇） | CuTe C++（19 篇） | CuTe DSL（本篇） | Triton（21 篇） |
|---|---|---|---|---|
| 编码粒度 | PTX/寄存器级 | layout 代数 | layout 代数 + Python 语法 | 块级 DSL |
| 编译速度 | 十几秒级 | 同 C++ | **0.1 秒级 JIT** | 秒级 JIT |
| 可控性 | 最大 | 大 | 大（同 C++ 语义） | 小 |
| 调试 | printf/compute-sanitizer | device print | **Python print（VERBOSE 开关）** | Triton 解释器 |
| 生态位 | 极致调优 | 库开发 | 库开发/算法原型 | 快速原型 |

本篇的立场：**DSL 的正确用法是"算法/布局的快速验证台"**——用 Python 的迭代速度把 layout 方案（tile 形状、thr layout、流水协议）调通，再翻译成 C++ CuTe 挂进 CUTLASS 工程化管线。21 TFLOPS 的教学实现不该也不需要追上 cuBLAS——它要回答的是"layout 对不对"，不是"跑得快不快"。

## 本篇小结

1. **CuTe DSL = CuTe 布局代数的 Python 前端**：`@cute.kernel`/`@cute.jit`/`.launch` 三件套，编译到同一套 MLIR/PTX；对象名与 C++ CuTe 一一对应，19 篇的积累直接迁移。
2. **DSL 有结构化控制流约束**：不支持 early return、变量定义在控制流外、显式 dtype 转换——比 C++ 严格，但换来 0.1 秒的 JIT 编译速度。
3. **环境坑四连**：版本必须 4.5.x（4.7 要新驱动、4.2 是旧 API）、PYTHONPATH 手动挂 python_packages、experimental 模块硬编码 13.1+ 要 patch、`--generate-line-info` 已禁用——pip 装完≠能用。
4. **三档抽象实测 4.67 → 21.12 → 18.84 TFLOPS**：naive→MMA 版 4.5 倍（同 15 篇爬坡）；流水线版在小 shape 反而略慢——瓶颈判断与语言无关。
5. **指令交错的显式化**：pipelining.py 把 B 拷贝放在 gemm 之后是刻意的指令调度，源码注释值得读——15 篇 dbuf 的"隐藏细节"在 DSL 版被写在了明面上。
6. **工具定位**：DSL 是 layout/算法的快速验证台（VERBOSE 打印 layout 的调试体验是杀手锏），极致性能仍回 C++；mma_tile_tex.cc 因 CUTLASS 4.6 API 断代暂不能编译——老 API 的历史注脚。
