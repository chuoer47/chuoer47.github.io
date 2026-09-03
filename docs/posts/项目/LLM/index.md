---
title: Qwen3.5 复现
order: 1
---

# Qwen3.5 复现

个人可读、可跑、可对照的 Qwen3.5 完整教程，从 MLP、归一化、位置编码、注意力等基础组件，到 MiniQwen 组装、预训练、权重适配、后训练（SFT/DPO/GRPO/PPO）、再到自己手写 vLLM 推理引擎。配套代码在 [chuoer47/LinkQwen3.5](https://github.com/chuoer47/LinkQwen3.5)。

## 目录

- [00 - 前言](./00-前言.md) — 教程介绍与 Qwen3.5 简介
- [00 - Tokenizer（分词器）](./00-tokenizer.md) — 补充阅读：分词器原理
- [01 - MLP（前馈网络）](./01-MLP.md)
- [02 - 归一化层](./02-归一化层.md)
- [03 - 位置编码](./03-位置编码.md)
- [04 - 注意力机制](./04-注意力机制.md)
- [05 - 线性注意力](./05-线性注意力.md)
- [06 - MiniQwen](./06-miniqwen.md)
- [07 - 预训练](./07-预训练.md)
- [08 - 权重适配](./08-权重适配.md)
- [09 - 后训练理论](./09-后训练理论.md)
- [10 - 后训练实战](./10-后训练实战.md)
- [11 - vLLM 原理](./11-vllm.md)
- [12 - nano-vllm（手写 1200 行）](./12-nano-vllm.md)
- [13 - minivllm（适配 MiniQwen 混合架构）](./13-minivllm.md)
- [14 - minivllm 评测](./14-minivllm-eval.md)
