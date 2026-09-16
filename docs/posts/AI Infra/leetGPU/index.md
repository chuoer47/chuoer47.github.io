---
title: LeetGPU
order: 7
---

# LeetGPU

[LeetGPU](https://leetgpu.com/) 刷题笔记：一个在线 GPU 编程刷题平台，无需本地 CUDA 环境，在浏览器里写 CUDA kernel 并直接在云端 GPU 上运行、判题。

> 本人是刷题过程中记录的解法与要点，非官方答案，可能存在理解错误。

## 目录

- [Easy Kernel](./Easy-kernel.md) — 18 题 elementwise 全家桶：vector add、矩阵乘法（naive 与 shared memory 分块）、矩阵加法/拷贝、原地反转、图像处理（反色/灰度）、1D 卷积、FNV 哈希、激活函数（ReLU/Leaky ReLU/Sigmoid/SiLU/SwiGLU/GEGLU）、Simple Inference（PyTorch）
- [Medium Kernel](./Medium-kernel.md) — 金字塔归约 Reduction、online softmax 全局版（含 per-block 翻车实录）、一行一 warp 的 Softmax Attention（FA 教学版）、2D Convolution（kernel 常驻 smem 与 halo 分块两版对照）、Prefix Sum（Hillis-Steele 块内扫描与 warp shuffle 两级扫描，含函数详解与通用坑位）

## 相关笔记

- [LeetCUDA](../leetCUDA/) — 同方向的手写 CUDA kernel 笔记，覆盖面更广（reduce、softmax、GEMM、Flash-Attn 等）
