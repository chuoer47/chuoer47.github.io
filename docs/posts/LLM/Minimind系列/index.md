# Minimind 系列

从 0 到 1 读懂并复现一个小型 LLM。本系列基于 [jingyaogong/minimind](https://github.com/jingyaogong/minimind) 三个仓库（主库 / [minimind-v](https://github.com/jingyaogong/minimind-v) / [minimind-o](https://github.com/jingyaogong/minimind-o)）的源码精读整理：以代码为载体，穿插讲解 Transformer / 训练 / RL / 多模态的基础知识。

::: tip 为什么值得读
MiniMind 主线只有 **287 行模型代码 + 11 个训练脚本（约 4000 行）**，却覆盖了 Qwen3 同款的现代结构（RoPE / GQA / SwiGLU / MoE / 权重共享）和完整训练链路（Pretrain → SFT → LoRA → 蒸馏 → DPO → PPO / GRPO / CISPO → Agentic RL → Tool Use → 自适应思考）。相比直接读 HuggingFace `transformers` 里动辄几千行的实现，它是理解"大模型是怎么被训练出来的"门槛最低的一份完整样本。

主线版本 minimind-3 仅 64M 参数（GPT-3 的 1/2700），单卡 3090 约 2 小时、3 元成本即可从 0 训练。
:::

## 目录

- [模型结构精读](./01-模型结构精读.md) — 逐行读懂 287 行的 MiniMindForCausalLM：RMSNorm、RoPE 与 YaRN 外推、GQA 与 KV Cache、MoE 路由与负载均衡、SwiGLU、权重共享、采样策略
- [Tokenizer 与数据](./02-Tokenizer与数据.md) — BPE 训练、chat template 设计、Pretrain / SFT / DPO 数据构造、loss mask 语义
- [训练全流程](./03-训练全流程.md) — Pretrain → SFT → 对齐三件套（DPO / PPO / GRPO / CISPO）→ 蒸馏 / LoRA → Agentic RL，附混合精度、梯度累积、DDP、断点续训等工程细节
- [多模态：VLM 与 Omni](./04-多模态VLM与Omni.md) — MiniMind-V 的视觉对齐（SigLIP2 + Projector + 占位符注入）；MiniMind-O 的 Thinker-Talker 架构、Mimi 音频编解码、MTP 多码本预测与流式语音
