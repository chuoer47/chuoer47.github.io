---
title: Nsight Profiling
order: 27
---

# Nsight Profiling：nsys 与 ncu 的分工

> 本人学习笔记，AI总结

前 26 篇的优化几乎全靠"改代码 → 计时 → 对比"，这是一种盲调。Nsight 是把眼睛睁开：**nsys（Nsight Systems）看时间线**——kernel 什么时候启动、间隔多少、被什么卡住；**ncu（Nsight Compute）看 kernel 内部**——每个 SM 在干什么、bank conflict 多少、SASS 汇编长什么样。`kernels/nvidia-nsight/` 这个目录用 ReLU 和 elementwise 做例子给全系列补上 profiling 这一课，本篇按"能跑起来的完整工作流"组织，并记录 4090-public 服务器上的真实踩坑。

先给两个工具的选型判断（新手最常混的点）：

| | nsys (Systems) | ncu (Compute) |
|---|---|---|
| 视角 | 整个程序的时间线 | 单个 kernel 的内部 |
| 回答的问题 | "时间花在哪一步？" | "这个 kernel 为什么慢？" |
| 典型发现 | kernel 间空隙、同步浪费、memcpy 占比 | bank conflict、寄存器溢出、占用率 |
| 开销 | 低（可全程开着） | 高（默认重放 kernel 多次） |
| 对应优化阶段 | 先用（找该优化谁） | 后用（怎么优化它） |

**先 nsys 后 ncu** 是标准工作流：时间线确定热点 kernel，ncu 才进场解剖它。

## 环境与踩坑（4090-public 实测）

无 sudo 的公共服务器上，两个工具都可能是"装了但用不了"的状态：

1. **ncu 不在 PATH**。conda 装的 nsight-compute 在 env 目录里（如 `~/miniconda3/envs/<env>/nsight-compute-2025.4.1/ncu`），`which ncu` 找不到很正常，`find / -name ncu -type f` 定位。
2. **ncu 权限墙（最常见）**：`ERR_NGPUCTRPERM - The user does not have permission to access NVIDIA GPU Performance Counters`。根因：驱动参数 `RmProfilingAdminOnly: 1`（`cat /proc/driver/nvidia/params` 可查）。解法需要 root：`sudo sh -c 'echo 0 > /proc/driver/nvidia/params/RmProfilingAdminOnly'` 或内核模块参数加 `NVreg_RestrictProfilingToAdminUsers=0`。公共服务器改不了时 ncu 的 metrics 采集全部不可用——本文 ncu 部分引用仓库文档在授权机器上的实测 log（24 篇 swizzle 也是同一坑）。
3. **nsys 可用但二进制在奇葩位置**：本机在 `nsight-compute-2025.4.1/host/target-linux-x64/nsys`（对，nsys 藏在 nsight-compute 的包里）。
4. **nsys 命令行直接跑会撞 shell 参数解析**（ssh 非交互 shell 下 `$NSYS profile ...` 报 `profile: 未找到命令`）——包进脚本文件再执行。
5. 编译 profiling 目标要带 `--generate-line-info -g`（源码行才能映射到 SASS）；链接参数同 24 篇（conda gcc13 `-ccbin`、stub 库、`--cudart shared`）。

## 实测一：nsys 时间线（relu.89.bin）

编译 + profile：

```bash
nvcc -arch=sm_89 -o relu.89.bin --generate-line-info -g relu.cu \
  -ccbin $CONDA_PREFIX/bin/x86_64-conda-linux-gnu-g++ -lcublas -L... --cudart shared
nsys profile --stats=true -t cuda -o relu.prof -f true ./relu.89.bin
```

4090 实跑输出（截取两段最值得读的统计）：

```
[4/6] cuda_gpu_kern_sum
 Time(%)  Total(ns)  Inst  Avg(ns)   Name
  42.0     874,279    15   58,285    relu_f16_kernel
  29.0     603,878    15   40,258    relu_f16x8_kernel      (unpack 版)
  15.9     330,339    15   22,022    relu_f16x2_kernel
  13.2     274,755    15   18,317    relu_f16x8_pack_kernel
```

这张表就是 nsys 的核心价值——**四个 ReLU kernel 的耗时排序一眼可见**（pack 18.3μs < f16x2 22.0μs < unpack 40.3μs < naive 58.3μs），与程序自己打印的计时一致，且额外给出了 min/max/StdDev（stddev 只有 ~200ns，说明计时稳定）。同表的 `[3/6] cuda_api_sum` 还暴露了另一类信息：`cudaDeviceSynchronize` 累计 1.9ms、`cudaFree` 0.8ms——**host 侧 API 开销在这里**，如果做的是实际应用（而非纯 benchmark），这些行才是优化重点。

```
[5/6] cuda_gpu_mem_time_sum
  89.4%  29.1ms  4 次  D2H memcpy（每次 33.5MB）
  10.6%   3.5ms  1 次  H2D memcpy
```

一个小程序的 GPU 时间里 **memcpy 占大头、kernel 只占 1.5ms**——nsys 时间线把"优化 kernel vs 优化数据搬运"的决策依据直接摆在脸上。这正是 23 篇"小 shape 看开销、大 shape 看带宽"的 profiler 证据版。

## 实测二：ncu kernel 解剖（引用仓库授权机器数据）

ncu 不可用的机器上，对照 `bank_conflicts.md` 的实跑 log 学读法。它演示了 bank conflict 的完整检查流程：

```bash
# 第一步：查询当前设备支持的 metrics（名字随架构会变，先查再抄）
ncu --query-metrics | grep data | grep bank | grep l1tex
# 第二步：按指令类型分别采集（LDS/LD 是普通读，LDSM 是 ldmatrix，ST 是写）
ncu --metrics l1tex__data_bank_conflicts_pipe_lsu_mem_shared_op_ld.sum <bin>
ncu --metrics sm__sass_l1tex_data_bank_conflicts_pipe_lsu_mem_shared_op_ldsm <bin>
```

log 里的关键读法（flash attention 的 combine kernel 为例）：

- `op_ld.avg = 11.18`、`sum = 1029`——普通 LDS 指令**有** bank conflict（平均每指令 ~11 次冲突）；
- `op_ldsm.avg = 0`、`sum = 0`——**ldmatrix 指令零冲突**。

同一个 kernel 里两种指令一有一无，说明什么？**ldmatrix 的访问模式（每 lane 提供行地址、硬件整行搬运）天然抗 conflict，而手排的标量 LDS 有 11-way 级别的冲突**——这正是 17/18 篇"用 ldmatrix 替代手写下标读 smem"的量化依据。也是 24 篇 swizzle 工具箱的 ncu 验证入口（README 里 `naive 22795 vs swizzle 0` 的对照就是这条 metrics 链）。

### SASS/PTX 检视：ncu 的第三个用途

`ncu -o relu.prof -f relu.bin` 生成 .ncu-rep 后，GUI 里能看每个 kernel 的 PTX 与 SASS 对照（README 给了 `relu_f16_kernel` 的片段：`max.f16 %rs2,%rs1,%rs4` 一条指令就是 F16 ReLU 的全部计算）。配合编译时的 `--generate-line-info`，SASS 行能映射回 .cu 源码行——**看一条 max.f16 旁边标着的源码行号，就能确认编译器没有把你的循环搞乱**。没有 ncu 权限时，`cuobjdump -sass relu.89.bin` 是个低配替代（只看汇编，没有源码映射和指标）。

## 一次完整的优化闭环（方法论总结）

把本系列用过的 profiling 流程串一遍，以 ReLU 的 f16 优化为例：

```
1. nsys kern_sum 排名
   → naive 58.3μs 最慢，pack 18.3μs 最快  （该优化谁：naive/unpack）
2. ncu 看 naive 的指标（授权机器）
   → 无 conflict、无寄存器溢出 → 瓶颈是访存事务数（每线程 2 字节 load）
3. 猜想：向量化减少事务数 → f16x2 22.0μs ✓
4. 再往上看 SASS：f16x8 unpack 版 40.3μs 比 f16x2 还慢——反常
   → 读 SASS/PTX：8 个标量 load 未合并成 128bit（编译器没做）
5. 手动 pack（LDST128BITS 一次搬 8 个）→ 18.3μs ✓
```

每一步的判断依据都能落到 profiler 的具体数字上——**优化不是猜的，是测出来的**。23 篇 elementwise 家族的所有结论（f16 单元素比 f32 慢、pack 一枝独秀）在这个流程里都有对应环节。

## 本篇小结

1. **先 nsys 后 ncu**：nsys 找"哪个 kernel/哪个 API 耗时"（kern_sum/api_sum/mem_time_sum 三张表），ncu 解剖"单个 kernel 为什么慢"——顺序颠倒会浪费大量时间在错误的层面。
2. **公共服务器的 profiler 权限坑**：`ERR_NVGPUCTRPERM` 查 `/proc/driver/nvidia/params` 的 `RmProfilingAdminOnly`，改它要 root；无权限时 metrics 不可用，但 nsys 时间线通常照常能用（它不走 perf counter）。
3. **metrics 按指令类型分桶查**：`op_ld`（LDS）/`op_ldsm`（ldmatrix）/`op_st`（STS）各自有独立计数——"一个 kernel 有没有 conflict"要拆到指令粒度看，ldsm=0 + ld=11 的组合是 ldmatrix 价值的直接量化。
4. **SASS 检视是优化的最后一步**：`--generate-line-info -g` 编译 → ncu GUI 或 `cuobjdump -sass` 看"算子最终翻译成什么"——f16x8 unpack 版慢于 f16x2 的反常只有看汇编才能定位（标量 load 未合并）。
5. **memcpy 统计容易被忽视**：nsys 的 mem_time_sum 表经常显示 memcpy 占 GPU 时间大头——真实应用的第一优化点常在数据搬运而非 kernel 本身。
6. **工具链脚本化**：nsys/ncu 在非交互 shell 下有各种参数解析坑，把完整 profile 命令写成脚本文件执行是最稳的姿势（本文所有实测均由脚本完成）。
