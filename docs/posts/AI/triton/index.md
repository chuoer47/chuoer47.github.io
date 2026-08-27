---
title: Triton
order: 20
---

# Triton 内核教程

从零到 Flash Attention 的 Triton 中文教程，面向刚入门的小白。基于开源仓库 [evintunador/triton_docs_tutorials](https://github.com/evintunador/triton_docs_tutorials) 改写、扩写并配图，每章逐行拆源码、配大量图示、讲清"为什么这样做"。

核心一句话贯穿全程：**内存搬运比计算贵得多，Triton 内核优化的本质就是减少 DRAM 读写、把更多计算塞进 SRAM。**

## 目录

- [01 - 什么是 Triton](./01-什么是Triton.md)
- [02 - GPU 架构基础](./02-GPU架构基础.md)
- [04 - 向量加法：第一个 Triton 内核](./04-向量加法.md)
- [05 - 融合 Softmax：减少内存读写](./05-融合Softmax.md)
- [06 - 矩阵乘法：自动调优与程序重排](./06-矩阵乘法.md)
- [07 - Dropout：低内存随机失活](./07-Dropout.md)
- [08 - LayerNorm：反向传播与原子锁](./08-LayerNorm.md)
- [09 - Flash Attention：分块注意力](./09-FlashAttention.md)

> 每章开头都有可折叠的「本章对应源码」块，点开即看原仓库 Python 源码全文。
