---
title: LeetCUDA
order: 5
---

# LeetCUDA

[LeetCUDA](https://github.com/xlite-dev/LeetCUDA) 学习笔记：手写 CUDA kernel，从 elementwise 到 Tensor Core。

> 本人学习笔记，非 AI 总结，可能存在理解错误。

## 目录

- [01 - 环境搭建](./01-环境搭建.md) — 4090 上无 sudo 装 CUDA 12.4 全套（conda env 方案）
- [02 - Elementwise](./02-elementwise.md) — 第一个 CUDA kernel：elementwise
- [03 - Reduce](./03-reduce.md) — warp shuffle、两阶段 block reduce、atomicAdd、混合精度累加
- [04 - Softmax](./04-softmax.md) — per-token 映射、safe softmax、online softmax（FA 前置）
- [05 - Dot Product](./05-dot-product.md) — reduce 骨架复用、__hmul2 双发射、全局 atomicAdd 规模陷阱
- [06 - Layer Norm](./06-layer-norm.md) — reduce 结果广播、load once、f16 acc 溢出实测、算子融合 10x
- [07 - RMS Norm](./07-rms-norm.md) — LayerNorm 减法、L2/L1 cache line 博弈、eager 精度陷阱
- [08 - RoPE](./08-rope.md) — 旋转位置编码、计算受限 vs 访存受限、div/mod 代价、复数 naive 135x
- [09 - Mat Transpose](./09-mat-transpose.md) — coalesced access、smem staging、bank conflict 与 padding、对角线调度
- [10 - Mat Transpose (CuTe)](./10-mat-transpose-cute.md) — Layout 代数、swizzle、寄存器转置、DSL 与手写对照
- [11 - ReLU & GELU](./11-relu-gelu.md) — tanh 近似、half 无三角函数的手搓、瓶颈类型决定优化有效性
- [12 - Histogram](./12-histogram.md) — 原子操作、竞争强度公式、smem 私有直方图两阶段归并
- [13 - Embedding](./13-embedding.md) — gather 模式、手动展开≠向量化（翻车实录）
- [14 - NMS](./14-nms.md) — 顺序敏感算法、数据竞争实测（结果不稳定）、分块并行化
- [15 - SGEMM](./15-sgemm.md) — tiling 数据复用、thread tile 计算密度、bcf/dbuf、WMMA TF32 Tensor Core
- [16 - SGEMV](./16-sgemv.md) — 一行一 warp、warp 拆行、访存受限算子、decode 语境
- [17 - HGEMM (MMA)](./17-hgemm-mma.md) — ldmatrix/mma.sync、cp.async、warp shuffle 收尾、conda 编译 5 坑
- [18 - HGEMM (Swizzle)](./18-hgemm-swizzle.md) — 128bit 访存 bank conflict、位异或 swizzle、三把刀对照
- [19 - HGEMM (CuTe)](./19-hgemm-cute.md) — TiledMMA、Swizzle 代数化、block swizzle、296 TFLOPS
- [20 - FlashAttention 2](./20-flash-attn.md) — online softmax×MMA、split-q vs split-kv、share-qkv、189 vs SDPA 133
- [21 - Triton](./21-triton.md) — 编译器自动化对照手写、other= 语义边界、num_stages 流水
- [22 - 系列总结](./22-summary.md) — 知识地图、性能总账、五条铁律、手写 vs 抽象的元结论
