---
title: Swizzle 专题
order: 24
---

# Swizzle 专题：从 XOR 公式到可视化工具

> 本人学习笔记，AI总结

09 篇讲 bank conflict 时给了 padding 这把刀，18 篇把手写 swizzle 拆到了位运算层，10 篇见过 CuTe 的 `Swizzle<B,M,S>` 抽象。但 `kernels/swizzle/` 这个独立目录一直是"课外读物"——它不属于任何主篇，却把三样散落的东西装进了一个工具箱：**mat_trans_swizzle.cu**（padding vs swizzle 的同题对照）、**mma_simple_swizzle.cu**（最小 MMA + swizzle 教学程序）、**print_swizzle_layout.py**（把 swizzle 后的 bank 分布打印成 ASCII 表的可视化工具）。本篇把这三件套拆完，补上前面各篇欠的"最后一公里"。

## 先跑起来

```bash
cd kernels/swizzle
# makefile 写死系统 nvcc；leetcuda env 下要手动指 conda 的 gcc13（环境搭建笔记的 -ccbin 方案）
nvcc mat_trans_swizzle.cu -o mat_trans_swizzle.89.bin -O2 -gencode arch=compute_89,code=sm_89 \
  -std=c++17 -ccbin $CONDA_PREFIX/bin/x86_64-conda-linux-gnu-g++ --expt-relaxed-constexpr \
  -L$CONDA_PREFIX/lib/python3.11/site-packages/nvidia/cublas/lib -lcublas \
  -L/path/to/stubs --cudart shared     # stubs = 空 libcudadevrt.a/libcudart_static.a（同 interview 的 .stubs 方案）
./mat_trans_swizzle.89.bin    # → Done.（三个 kernel 顺序执行，无正确性输出，配合 ncu 用）
./mma_simple_swizzle.89.bin   # → 打印 swizzle 存储后的 s_a 全部 16x16 内容（验证数据未丢）
```

⚠️ **ncu 权限坑**（本篇实测踩到）：服务器上 ncu 报 `ERR_NVGPUCTRPERM - The user does not have permission to access NVIDIA GPU Performance Counters`。根因是驱动参数 `RmProfilingAdminOnly: 1`（`cat /proc/driver/nvidia/params` 可查），需要管理员 `echo 0 > /proc/driver/nvidia/params/RmProfilingAdminOnly`（或 modprobe 配置）才能放开——公共服务器上大概率改不了，只能要求数据来自有权限的机器（本文 bank conflict 计数引用仓库 README 在已授权机器上的 ncu 结果）。

## 工具一：mat_trans_swizzle.cu——同一个转置的三种 smem 姿势

09 篇用 f32x4 讲过转置的 padding 方案，这里换 int 矩阵、32×32 tile，把三个 kernel 排成对照组。关键差异全在**写 smem 和读 smem 的下标**上：

```c++
// 版1 naive：写端竖跨 32 行（写 dev_A 的行进 smem 的列），读端同 bank 撞车
s_data[threadIdx.x][threadIdx.y] = dev_A[row * N + col];      // 写：行=x 列=y
dev_B[...] = s_data[threadIdx.y][threadIdx.x];                 // 读：同一列竖取 → 32-way conflict

// 版2 padding：行宽 32→33，物理错开
__shared__ int s_data[32][33];                                 // 只改这一处声明
s_data[threadIdx.x][threadIdx.y] = ...;                        // 下标代码完全不动！

// 版3 swizzle：行宽不变，列坐标 XOR 重排
s_data[threadIdx.x][threadIdx.x ^ threadIdx.y] = dev_A[row * N + col];       // 写：列 y → y^x
dev_B[...] = s_data[threadIdx.y][threadIdx.x ^ threadIdx.y];                 // 读：同函数换算
```

三个版本引出三张对照卡：

| | naive | padding | swizzle |
|---|---|---|---|
| 行宽 | 32 | 33（+3% smem） | 32（零浪费） |
| 对齐 | 128B ✓ | 行首 132B，**4B 对齐破坏** | 128B ✓ |
| 代码侵入 | — | 零（只改声明） | 所有访问点都要过 XOR 函数 |
| conflict | 写 32-way / 读 32-way | 0 | 0 |

（仓库 README 在有 ncu 权限的机器上实测：naive 的 `op_ld`/`op_st` conflict 计数显著非零，padding 与 swizzle 两版均归零——本文因 ncu 权限受限引用其结论，机制层面的验证可用工具二/三。）

swizzle 为什么能归零？拿数字算一遍（09 篇的规矩）。smem 按 4 字节一个 bank，int 元素一行 32 个正好占满 32 bank。naive 读 `s_data[y][x]` 固定 y 变 x——x 连续 32 个正好一人一 bank，**读端本身不撞**；撞的是写端 `s_data[x][y]` 固定 x 变 y：一行 32 个 int 也是一人一 bank？不——**32 个线程在写同一个 x 行的 32 个列，各自 32 个连续地址确实分属 32 bank**……真正的撞点在 `__syncthreads()` 后的读端：`threadIdx.x` 连续的 32 线程读 `s_data[y][x]`，列方向跨行——第 i 个线程读行 y 列 x=i，地址 = y*32 + i，% 32 = i？也各不相同？

这里正是 swizzle 目录教学的精髓：**conflict 与否不取决于"单次访问内部"，取决于 tile 内地址的二维分布**。naive 版写端是"按行写进转置位置"——`threadIdx.x` 变化时行号 x 变、列号 y 定：地址 = x*32 + y，x 跨 32 行 → 32 个地址模 32 全等于 y → **32 线程同 bank**！这就是竖写的 32-way conflict。padding 加一列后地址 = x*33 + y，33%32=1，下一行 bank+1，错开。swizzle 则把列变成 `x^y`：地址 = x*32 + (x^y)，模 32 = x^y，x 连续变化时 x^y 遍历 0~31 **不重复**——一行 XOR 换算替代了一整列 padding。

## 工具二：mma_simple_swizzle.cu——MMA 最小块上的 swizzle 全流程

18 篇的 hgemm_mma_stage_tn_swizzle.cu 有 300+ 行（多 tile、多 stage、cp.async），不适合第一遍读。这个文件把同样的东西砍到最小：**一个 warp、一个 m16n8k16 MMA、一个 K tile**，swizzle 公式退化成最简形态：

```c++
__device__ __host__ __forceinline__ int swizzle_j(int i, int j) {
  return ((int(j / 8) ^ int(i / 4)) % 2) * 8;    // 只有 2 种物理列：0 或 8
}
```

公式逐项读：`j/8` 是"第几个 128bit 组"（8 个 half = 16B），`i/4` 是"行所在的政策组"（4 行一变），XOR 后 %2 决定这 16B 放物理列 0 还是 8。**每个 16B 是搬运原子，XOR 只在 16B 粒度上整块搬移，块内部顺序不动**——所以 `LDST128BITS` 的向量读写天然兼容。

程序自带验证逻辑（这是它比 hgemm 教学版好的地方）：A/B 填充连续整数（`h_a[i] = i`），kernel 中途 `tid==0` 打印 swizzle 存储后的完整 `s_a`：

```
A[ 0][ 0]=   0, A[ 0][ 1]=   1, ..., A[ 0][15]=  15,   ← 行 0：逻辑顺序完好
A[ 1][ 0]=  16, A[ 1][ 1]=  17, ..., A[ 1][15]=  31,   ← 行 1：完好
...
```

打印走的是**逻辑下标** `s_a[i][j]`，而写入走的是 `s_a[m][swizzle_j(m,k)]`——**打印结果还原成 0~255 连续**就证明了"swizzle 是纯物理层重排，逻辑视图零变化"。这正是 18 篇说"写读两端用同一个函数、逻辑数据没动"的可视化证据。ldmatrix 读端对应的换算：

```c++
& s_a[lane_id % 16][swizzle_j(lane_id % 16, (lane_id / 16) * 8)]   // 与写端同一函数
```

## 工具三：print_swizzle_layout.py——把 bank 分布画出来

前两个工具验证"数据没丢"，这个工具回答"bank 分布长什么样"。运行（本机实跑）：

```bash
python print_swizzle_layout.py --rows 16 --logical-col 64 --show-logical-col
```

输出（节选，`逻辑列:物理列`）：

```
|bank  |b 0~3 |b 4~7 |b 0~3 |b 4~7 |b 0~3 |b 4~7 |b 0~3 |b 4~7 |
|row 0 | 0:0  | 8:8  |16:0  |24:8  |32:0  |40:8  |48:0  |56:8  |
|bank  |b 8~11|b12~15|b 8~11|b12~15|b 8~11|b12~15|b 8~11|b12~15|
|row 1 | 0:0  | 8:8  |16:0  |24:8  |32:0  |40:8  |48:0  |56:8  |
...
|row 4 | 0:8  | 8:0  |16:8  |24:0  |32:8  |40:0  |48:8  |56:0  |   ← 4 行一变，0/8 对调
```

三分钟看懂这张图：

1. **bank 行的周期性**：每 4 行 bank 从 `b0~3` 起步轮回到 `b8~11` 起步——4 行正好用完 32 bank（每行 8 组 × 4 bank = 32）。这是"4 行一组"设计的物理含义：**同一政策组内的 4 行，同 16B 组的 bank 完全错开**。
2. **逻辑 64 列 → 物理 16 列**：`0:0, 8:8, 16:0, 24:8...`——逻辑列 0 和 16、32、48 全部映射到物理列 0！这就是文件头注释说的 **col major ZigZag**：逻辑宽度超过 16 时，smem 声明 `[rows][16]`，64 列拆成 4 层 × 16 列（`[4][Br][16]`），层间靠 XOR 保证 bank 错开。这是 FA 里 Q tile `[Br][d=64]` 的真实布局方案（20 篇的 `_shared_qkv` 变体在用）。
3. **`--pad 8` 开关**：同一条命令加 `--smem-padding 8` 可以对比 padding 模式下的 bank 表——两个方案在同一张图上切换，谁占多少 bank、哪里错开一目了然。做 layout 设计时先画表再写代码，比先写代码再 ncu 快一个数量级。

## swizzle 公式族谱

把系列里出现过的三个公式放在一起，看清它们是同一个思想的参数化：

| 公式 | 出处 | 16B 组 | 行组 | 适用 |
|---|---|---|---|---|
| `(c ^ (r & 7))` | 09 篇 CuTe 预告 | 1 元素 | 8 行 | f32 标量 tile |
| `((j/8) ^ (i/4)) % 2 * 8` | 本篇 mma_simple | 8 half | 4 行 | m16n8k16 单 MMA |
| `((j>>3)^(i>>2)) % (stride>>3) << 3` | 18 篇 hgemm | 8 half | 4 行 | 任意 stride（同式参数化） |

结构完全一致：**`物理组 = 逻辑组 XOR 行组`**，差异只在"组"的大小（16B 粒度 8 个 half）和"行组"的周期（4 行一轮 × 32 bank = 一轮吃满）。CuTe 的 `Swizzle<B,M,S>` 是这族公式的代数封装（B=XOR 位宽、M=保留低位、S=位移）——选 layout 时先确定 16B 粒度和行周期，公式自己长出来。

## 本篇小结

1. **swizzle 三件套各司其职**：mat_trans（padding vs swizzle 同题对照）、mma_simple（最小 MMA 全流程 + 自验证打印）、print_swizzle_layout（bank 分布可视化）——读 18/19/20 篇的工业级 kernel 前先过这三件套。
2. **conflict 源自 tile 的二维地址分布**：竖写 32 行时地址模 32 全同余是 32-way conflict 的根源；padding 用 +1 列错开，swizzle 用 `列 = 逻辑列 XOR 行组` 让模 32 结果遍历不重复。
3. **swizzle 是纯物理层**：逻辑下标的读写代码不变（或统一过一个换算函数），打印验证数据完好——与 padding"只改声明"相比，侵入换算函数但零空间浪费、零对齐破坏。
4. **ZigZag 处理宽 tile**：逻辑列 >16 时物理列循环映射（`0:0, 8:8, 16:0, ...`），smem 按 `[层][行][16]` 存——FA 的 Q/K tile 布局基础。
5. **ncu 权限是服务器常见坑**：`ERR_NVGPUCTRPERM` 查 `/proc/driver/nvidia/params` 的 `RmProfilingAdminOnly`，需管理员放开；无权限时用打印验证 + 可视化工具做机制验证，性能计数留给有权限的机器。
6. **先画表再写码**：`print_swizzle_layout.py` 让 layout 设计从"写完再 profile"变成"动手前看图"，bank 表 + `--pad` 对照是设计 smem 布局的第一步。
