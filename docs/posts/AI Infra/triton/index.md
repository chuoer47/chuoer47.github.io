---
title: Triton
order: 8
---

# Triton 内核教程

从零到 Flash Attention 的 Triton 中文教程，面向刚入门的小白。基于开源仓库 [evintunador/triton_docs_tutorials](https://github.com/evintunador/triton_docs_tutorials) 改写、扩写并配图，每章逐行拆源码、配大量图示、讲清"为什么这样做"。

核心一句话贯穿全程：**内存搬运比计算贵得多，Triton 内核优化的本质就是减少 DRAM 读写、把更多计算塞进 SRAM。**

## 目录

- [01 - 什么是 Triton](./01-什么是Triton.md)
- [02 - GPU 架构基础](./02-GPU架构基础.md)
- [03 - 向量加法：第一个 Triton 内核](./03-向量加法.md)
- [04 - 融合 Softmax：减少内存读写](./04-融合Softmax.md)
- [05 - 矩阵乘法：自动调优与程序重排](./05-矩阵乘法.md)
- [06 - Dropout：低内存随机失活](./06-Dropout.md)
- [07 - LayerNorm：反向传播与原子锁](./07-LayerNorm.md)
- [08 - Flash Attention：分块注意力](./08-FlashAttention.md)

> 每章开头都有可折叠的「本章对应源码」块，点开即看原仓库 Python 源码全文。
