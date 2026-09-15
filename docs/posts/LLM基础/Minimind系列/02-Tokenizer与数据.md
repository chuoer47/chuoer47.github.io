---
title: "Minimind 系列笔记 02：Tokenizer 与数据"
date: 2026-09-15
tags:
- LLM
- Tokenizer
- 数据工程
category:
- AI
order: 2
---

# Minimind 系列笔记 02：Tokenizer 与数据

> 源码：[jingyaogong/minimind](https://github.com/jingyaogong/minimind)（`trainer/train_tokenizer.py`、`dataset/lm_dataset.py`）。

模型结构（[01 篇](./01-模型结构精读.md)）决定"怎么算"，数据决定"算什么"。这一篇讲两件事：token 是怎么被定义出来的（Tokenizer 训练），以及不同训练阶段的数据长什么样、label 是怎么切的（数据构造与 loss mask）。

## 一、Tokenizer：6400 词表的 BPE

### 1.1 为什么词表这么小

MiniMind 词表只有 6400（Qwen3 约 15 万，Llama 3 约 12.8 万）。词表大小是三难权衡：

- **大词表**：压缩率高（中文 1 字 ≈ 0.6 token），序列短、注意力快；但 embedding 参数 = vocab × d_model，6400×768 只有 4.9M，15 万词表要 115M——比整个 MiniMind 模型还大。
- **小词表**：参数省、每个 token 都有充分训练语料（不出现训练不足的"长尾 token"）；但序列变长，同等上下文容量下能装的文本变少。

对 64M 的模型，6400 是合理甜点。README 实测压缩率：中文约 1.5~1.7 字符/token，英文约 3.8 字符/token——也就是说同样的文本，MiniMind 序列长度是 Qwen 的 2 倍左右。这是"小模型配小词表"的显式代价。

### 1.2 BPE 训练

```python
tokenizer = Tokenizer(models.BPE())
tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
trainer = trainers.BpeTrainer(
    vocab_size=6400,
    initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
    special_tokens=all_special_tokens
)
tokenizer.train_from_iterator(texts, trainer=trainer)
tokenizer.decoder = decoders.ByteLevel()
```

BPE（Byte-Pair Encoding）训练循环：先把语料切成字节级最小单元，统计相邻 pair 频率 → 合并频率最高的 pair 成新 token → 重复直到词表填满 6400。两个关键选择：

1. **ByteLevel 预切分**：先把文本转成 256 个字节的基础 alphabet，再往上合并。好处是**零 OOV**——任何字符串（生僻字、emoji、乱码）都能被编码和解码回来。训练数据取自 SFT 语料的 1 万行对话文本。
2. **special tokens 一次定型**：256 字节 + 合并出的 token + 特殊 token 共 6400 个。

### 1.3 特殊 token：为未来预留的"暗桩"

值得逐个看这份特殊 token 列表——它暴露了模型的全部能力边界：

```python
special_tokens_list = [
    "<|endoftext|>",                  # pad / unk 兼任
    "<|im_start|>", "<|im_end|>",     # chat 模板的边界（ChatML 风格）
    "<|object_ref_start|>", ...,      # Qwen 视觉类标记（预留）
    "<|vision_start|>", "<|vision_end|>", "<|image_pad|>", "<|video_pad|>",
    "<|audio_start|>", "<|audio_end|>", "<|audio_pad|>",
    "<tts_pad>", ...                  # TTS 类（预留）
]
additional_tokens_list = [
    "<tool_call>", "</tool_call>",
    "<tool_response>", "</tool_response>",
    "<think>", "</think>"
]
# 剩余名额用 buffer token 填满 36 个
num_buffer = special_tokens_num - len(special_tokens_list + additional_tokens_list)
buffer_tokens = [f"<|buffer{i}|>" for i in range(1, num_buffer + 1)]
```

- `<|im_start|>` / `<|im_end|>` 充当 bos/eos（config 里 `bos_token_id=1, eos_token_id=2`）——一个 token 同时承担"对话回合开始"和"序列结束"两种语义。
- 视觉/音频/TTS 标记是**为多模态预留的暗桩**：主库训练时它们从不出现，但 [04 篇](./04-多模态VLM与Omni.md) 的 VLM/Omni 直接复用同一份 tokenizer，`<|image_pad|>`（id=12）、`<|audio_pad|>`（id=16）在多模态里承担"图像/音频特征占位符"的角色。同一词表贯穿三个仓库，是多模态扩展零成本的根基。
- `<think>` 标签进了词表意味着"思考过程"是模型的原生输出格式，而不是拼接出来的普通文本。
- buffer token：特意留的空位。任何后续想加的新标记（新工具、新模态）都能塞进去而不必重训词表。

一个容易忽略的细节：训练完后脚本会手动把 non-special 的 added token 的 `special` 字段改回 `False`——因为 `tokenizer.add_special_tokens` 会把整批标记为 special（跳过 normalize），而 `<think>` 等功能标记在文本处理时需要被当普通 token 切分。

### 1.4 chat template

tokenizer 自带一份 Jinja2 chat template（和 Qwen 同构的 ChatML 格式）。渲染多轮对话的结果长这样：

```text
<|im_start|>system
# Tools ...（有 tools 时）
<|im_end|>
<|im_start|>user
你好<|im_end|>
<|im_start|>assistant
<think>

</think>

你好！有什么可以帮你？<|im_end|>
```

对本文最重要的是 `add_generation_prompt` 与 `open_thinking` 两个开关的行为：

- `add_generation_prompt=True`：在末尾追加 `<|im_start|>assistant\n`，给模型"起话头"。RLHF/RLAIF 训练时数据只有 user 问题，靠它构造推理 prompt。
- `open_thinking`：
  - `True` → 追加 `<think>\n`，模型接着输出思考内容再 `</think>` 后作答；
  - `False` → 追加空壳 `<think>\n\n</think>\n\n`，思考段已闭合，模型直接作答。

这就是"自适应思考"的实现全部：**不训单独的思考模型，把"是否思考"下沉到模板层的占位结构**。同一个权重，推理时切换开关即可改变行为。空壳技巧的妙处：模型的训练数据里两种模式都见过（SFT 数据 20% 概率保留空 think，80% 概率被 `post_processing_chat` 移除），所以模型对两种前缀都稳定。

### 1.5 loss mask：哪些 token 该学

01 篇看到模型用 `ignore_index=-100` 忽略部分位置。谁来决定哪些位置是 -100？答案在 dataloader：

```python
class SFTDataset(Dataset):
    def __init__(self, jsonl_path, tokenizer, max_length=1024):
        # assistant 回合的起止标记（在 token 序列里精确定位回合边界）
        self.bos_id = tokenizer(f'{tokenizer.bos_token}assistant\n', add_special_tokens=False).input_ids
        self.eos_id = tokenizer(f'{tokenizer.eos_token}\n', add_special_tokens=False).input_ids

    def generate_labels(self, input_ids):
        labels = [-100] * len(input_ids)          # 默认全部不学
        i = 0
        while i < len(input_ids):
            if input_ids[i:i+len(self.bos_id)] == self.bos_id:
                start = i + len(self.bos_id)      # 回答起点
                end = start
                while end < len(input_ids):
                    if input_ids[end:end+len(self.eos_id)] == self.eos_id:
                        break
                    end += 1
                for j in range(start, min(end + len(self.eos_id), self.max_length)):
                    labels[j] = input_ids[j]      # 只有回答（含 eos）设为真值
                i = end + len(self.eos_id)
            else:
                i += 1
        return labels
```

SFT 的 label 构造：默认整条序列都是 -100，然后扫描 token 序列找 `<|im_start|>assistant\n` 这个**子序列**（不是单 token！），从它之后到 `<|im_end|>\n` 为止的位置填入真值。效果：

```text
<|im_start|>user   你好            <|im_end|>  <|im_start|>assistant   你好！...   <|im_end|>
[-100              -100 ...        -100]       -100(头)               学          学(含eos)
```

**模型只对"回答部分"计算损失**——prompt 部分（问题、历史轮、模板标记）全部遮蔽。这背后的原理：

- Pretrain 是全文语言模型（`labels = input_ids.clone()`，只遮 padding），模型学"看到前文任何部分→续写"；
- SFT 只对 assistant 回答算损失，模型的任务从"模仿全文"收窄为"给定对话上文→生成回答"。如果 prompt 位置也算损失，模型会浪费容量去学习"生成用户的话"，还会把"回答里复述问题"强化成习惯。

配套的数据增强（`pre_processing_chat`）：20% 概率给对话随机加一条 system prompt（10 条中英文池子随机选）——让模型对"有没有 system、system 说了什么"都鲁棒，而不是过拟合到"永远没有 system"的分布。

## 二、Pretrain 数据：学语言规律

`PretrainDataset` 非常直白：

```python
def __getitem__(self, index):
    tokens = self.tokenizer(str(sample['text']), add_special_tokens=False,
                            max_length=self.max_length - 2, truncation=True).input_ids
    tokens = [bos] + tokens + [eos]
    input_ids = tokens + [pad] * (self.max_length - len(tokens))
    labels = input_ids.clone()
    labels[input_ids == pad] = -100
    return input_ids, labels
```

数据就是纯文本（`{"text": "..."}` 的 jsonl），首尾手动加 bos/eos，pad 到 max_len，pad 位置 label 置 -100。默认 `max_seq_len=340`（中文约 500~580 字）——预训练阶段主要学词法和常识，不需要长上下文，短序列让 batch 更大、训练更快。

MiniMind 的预训练数据 `pretrain_t2t_mini`（约 1.4GB）是混合语料：中文 Wiki、开放问答、以及**从更大模型蒸馏的知识性问答**——小模型预训练的常见做法：与其给海量低质网文，不如精选高密度知识文本，64M 参数根本"吃不完"1.4GB 语料（2 epoch 才 2.8B token 量级）。

## 三、SFT 数据：从文本到对话

SFT 数据格式是多轮对话 jsonl：

```json
{"conversations": [
  {"role": "user", "content": "解释什么是机器学习"},
  {"role": "assistant", "content": "机器学习是人工智能的核心技术之一..."}
]}
```

工具调用样本复用 OpenAI 格式，`tools` 挂 system、`tool_calls` 挂 assistant：

```json
{"conversations": [
  {"role": "system", "content": "# Tools ...", "tools": "[{...}]"},
  {"role": "user", "content": "帮我算一下 256 乘以 37"},
  {"role": "assistant", "content": "", "tool_calls": "[{\"name\":\"calculate_math\",\"arguments\":{\"expression\":\"256 * 37\"}}]"},
  {"role": "tool", "content": "{\"result\":\"9472\"}"},
  {"role": "assistant", "content": "256 乘以 37 等于 9472。"}
]}
```

`create_chat_prompt` 把它交给 chat template 渲染成纯文本再 tokenize——**训练时模型见到的格式和推理时完全一致**，这是 SFT 能稳定生效的前提（训练/推理分布一致原则）。工具调用的 `<tool_call>...</tool_call>`、`<tool_response>...</tool_response>` 片段全部由模板展开，模型学的就是这种原生格式。

规模与组成：主线 `sft_t2t_mini` 数百 MB，混合了通用问答、多轮对话、tool call 样本（qwen3-4b 采样约 10 万条）、带 `<think>` 思考链的推理样本。README 的定位很准确：这个体量的 SFT 已经不是纯"格式对齐"，而更接近 **mid-training**——继续向参数里灌知识。

## 四、DPO 数据：偏好对

```python
class DPODataset(Dataset):
    def __getitem__(self, index):
        chosen = sample['chosen']      # list[{role, content}]  好回答的完整对话
        rejected = sample['rejected']  # list[{role, content}]  差回答的完整对话
        chosen_prompt = self.tokenizer.apply_chat_template(chosen, tokenize=False, ...)
        ...
        # x = ids[:-1], y = ids[1:], mask 同样只标 assistant 回答段
        return {'x_chosen': ..., 'y_chosen': ..., 'mask_chosen': ...,
                'x_rejected': ..., 'y_rejected': ..., 'mask_rejected': ...}
```

每条样本是**同一对话的两个版本**（chosen vs rejected），各自独立走一遍 template→tokenize→loss mask。返回 6 个张量：chosen 和 rejected 各 (input, label, mask) 三元组，训练时在 batch 维拼接（见 03 篇 DPO loss）。

注意 DPO 的数据里**每个答案都是完整对话**——不是只给"答案对"，而是"（上文+好回答）"vs"（上文+差回答）"。因为 DPO 需要 log π(y|x) 对整段回答的概率，上下文必须完整。

## 五、RLAIF / Agent RL 数据

RLAIF 数据格式与 SFT 相同，但 assistant 内容是占位符：

```json
{"conversations": [
  {"role": "user", "content": "请解释一下什么是光合作用？"},
  {"role": "assistant", "content": "无"}
]}
```

`RLAIFDataset` 返回的是 `{prompt, answer: ""}`——只有 prompt 进模型，回答完全由策略模型实时采样生成（on-policy）。这是 RL 训练与监督训练最本质的数据差异：监督学习的 label 是静态的（数据集给定），RL 的"label"是模型自己生成、再被奖励函数评价的。`create_chat_prompt` 里 `open_thinking` 按 `thinking_ratio`（默认 0.9）随机开关，让模型在思考/直答两种模式上都得到训练。

Agent RL 数据多了 `gt`（ground truth）字段：

```python
class AgentRLDataset(Dataset):
    def __getitem__(self, index):
        sample = self.samples[index]
        messages, tools = self.parse_conversations(sample['conversations'])
        return {'messages': messages, 'tools': tools, 'gt': sample['gt']}
```

训练时模型要多轮调用工具（`<tool_call>` → 环境 → `<tool_response>` → 再生成），最终答案和 `gt` 比对计分。数据里同样只有问题没有答案——整条轨迹都靠 rollout 生成，详见 03 篇 Agentic RL。

## 六、一张表总结

| 数据集 | 格式 | label 来源 | 用于 |
|---|---|---|---|
| pretrain_t2t | `{"text": ...}` | 全文（遮 pad） | 预训练 |
| sft_t2t | 多轮对话 | 仅 assistant 回答段 | SFT / 蒸馏 / LoRA |
| dpo | chosen/rejected 对 | 每个回答段的 logprob | DPO |
| rlaif | 仅问题 | 无（on-policy 生成 + 奖励） | PPO / GRPO / CISPO |
| agent_rl | 问题 + tools + gt | 整条轨迹的奖励 | Agentic RL |

贯穿全程的一条主线：**同一个 tokenizer、同一套 chat template、同一种 loss mask 机制**，只是数据格式和监督信号逐阶段变化。Pretrain 教模型"说话"，SFT 教"按对话格式说话"，RL 教"说更好的话"。

下一篇 [03-训练全流程](./03-训练全流程.md)：把这些数据喂进 11 个训练脚本，拆解每一阶段的算法与工程细节。
