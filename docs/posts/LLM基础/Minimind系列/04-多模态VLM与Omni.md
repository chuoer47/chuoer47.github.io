---
title: "Minimind 系列笔记 04：多模态 VLM 与 Omni"
date: 2026-09-15
tags:
- LLM
- 多模态
- VLM
- 语音
category:
- AI
order: 4
---

# Minimind 系列笔记 04：多模态 VLM 与 Omni

> 源码：[jingyaogong/minimind-v](https://github.com/jingyaogong/minimind-v)（`model/model_vlm.py`，171 行）、[jingyaogong/minimind-o](https://github.com/jingyaogong/minimind-o)（`model/model_omni.py`，461 行）。

MiniMind-V 和 MiniMind-O 复用主库的 MiniMindForCausalLM 作为语言主干，各自只加了少量代码：V 加 171 行获得图文理解，O 加 461 行获得语音对话。两者共享同一份 tokenizer 和 `<|image_pad|>` / `<|audio_pad|>` 占位 token——02 篇埋的"暗桩"在这里兑现。

两篇 README 里有个贯穿的思想值得先立起来：**LLM 的"语言"只是历史名称，它本质是自回归 token 流建模器**——token 可以代表文本、图像 patch、音频码本、动作。只要把模态翻译成 token 序列，"多模态"就塌缩成"单模态"。作者引用的类比很直白：图片对 LLM 来说就是一门"外语"，配一本"外语词典"（视觉编码器）翻译即可。

## 一、MiniMind-V：图文多模态

### 1.1 结构：三件套

```text
图像 256×256
  → SigLIP2 ViT-B/32（冻结，~95M）→ 64 × 768 patch features
  → MMVisionProjector（训练，~1M）→ 64 × 768 visual tokens（LLM 隐空间）
  → 替换文本序列里的 64 个 <|image_pad|> 占位符 embedding
  → MiniMind LLM（微调）→ 文本输出
```

```python
class VLMConfig(MiniMindConfig):
    model_type = "minimind-v"
    def __init__(self, image_special_token='<|image_pad|>', image_ids=[12], **kwargs):
        self.image_special_token = image_special_token
        self.image_ids = image_ids              # 占位 token 的 id：12
        self.image_hidden_size = 768            # SigLIP2 输出维度
        self.image_token_len = 64               # 256/32 = 8×8 patch
        super().__init__(**kwargs)

class MMVisionProjector(nn.Module):
    def __init__(self, in_dim, out_dim, source_tokens=64, target_tokens=64):
        self.mlp = nn.Sequential(
            nn.LayerNorm(in_dim),
            nn.Linear(in_dim, out_dim),
            nn.GELU(),
            nn.Linear(out_dim, out_dim),
        )

class MiniMindVLM(MiniMindForCausalLM):     # 直接继承语言模型
    config_class = VLMConfig
```

参数账本：可训练部分 LLM 64M + Projector 1M ≈ 65M（"65M VLM"的口径），SigLIP2 的 95M 全程冻结只做特征提取；推理时整机约 160M。

这个三件套（冻结 ViT + 轻量 Projector + 微调 LLM）就是 **LlaVA 范式**：LlaVA-1 用线性投影对齐，LlaVA-1.5 升级为 2 层 MLP，MiniMind-V 采用后者。对齐的本质：让视觉特征进入文本 token 所在的语义空间，后续 Transformer 不区分"这个位置是文本还是图像"。

### 1.2 特征注入：占位符替换

VLM 最核心的代码是 `count_vision_proj`——把投影后的视觉特征**逐 batch 扫描、替换到占位符位置**：

```python
@torch.compiler.disable
def count_vision_proj(self, tokens, h, vision_tensors=None, seqlen=512):
    marker, vf = self.config.image_ids[0], vision_tensors    # marker = token id 12
    out = []
    for b in range(h.size(0)):
        hb, seq, k, i = h[b], tokens[b].tolist(), 0, 0
        while i < len(seq):
            if seq[i] == marker:                  # 遇到 <|image_pad|>
                start = i
                while i < len(seq) and seq[i] == marker:
                    i += 1                        # 吃掉连续的一整段占位符
                if k < vf.size(1):                # 第 k 张图
                    hb = torch.cat((hb[:start], vf[b][k][:i-start], hb[i:]), dim=0)[:seqlen]
                    k += 1
            else:
                i += 1
        out.append(hb)
    return torch.stack(out)
```

前置步骤在 forward 里：

```python
hidden_states = self.model.dropout(self.model.embed_tokens(input_ids))  # ① 文本先算 embedding
if pixel_values is not None and start_pos == 0:
    vision_tensors = self.vision_proj(                                   # ② 图像编码+投影
        MiniMindVLM.get_image_embeddings(pixel_values, self.vision_encoder))
    hidden_states = self.count_vision_proj(input_ids, hidden_states, vision_tensors, ...)  # ③ 注入
# ④ 之后所有 Transformer 层与纯文本 LLM 完全一致
```

流程：文本 token 先过 embedding 得到隐向量序列 → 图像过冻结 ViT + 可训练 Projector → **在 embedding 层之后、进入 Transformer 之前**，把占位符位置的向量整段替换成视觉向量。注意几个细节：

- **只替换 embedding，不动序列长度**：数据侧把 `<image>` 展开成恰好 64 个 `<|image_pad|>`（`image_token_len=64`），占位段长度 = 视觉 token 数，替换是等长的 `torch.cat` 拼接。如果占位数多于特征数，`vf[b][k][:i-start]` 截断兜底。
- **`start_pos == 0` 才注入**：KV Cache 增量解码时（start_pos > 0）不重算视觉特征——图像信息已经在 prompt 的 KV Cache 里了。
- **支持多图**：`vf.size(1)` 是图数，`k` 计数器按出现顺序逐张分配；数据集侧多图时 `pixel_values` 堆叠为 (bs, num, C, H, W)，forward 里逐张编码再 stack。
- `@torch.compiler.disable`：这段逐 batch 的 Python 循环对 torch.compile 是负优化，显式禁用。

### 1.3 训练策略：冻结粒度分级

```python
parser.add_argument('--freeze_llm', default=2, type=int, choices=[0, 1, 2],
    help="0=完全可训练，1=冻结+解冻首尾层，2=完全冻结仅训练proj")
```

- Pretrain 阶段 `freeze_llm=2`：只训 Projector（1M 参数）。目标是纯对齐——让视觉特征"说得像人话"，此时动 LLM 只会破坏语言能力；
- SFT 阶段 `freeze_llm=1`：解冻 LLM 首尾层（embedding/末层 + lm_head）。中间层保持冻结，防视觉指令数据（量少、噪声大）把语言主干带偏，只让"接口层"适应多模态输入。

数据侧与 02 篇的 SFTDataset 几乎一致，唯一区别是多返回 `image_data`：数据格式 `{"conversations": [...], "image_bytes": ...}`（parquet 存原始图像字节），`<image>` 占位符在 `create_chat_prompt` 里被替换成 64 连发的 `<|image_pad|>`。loss mask 逻辑（`generate_labels`）与主库逐行相同——**VLM 的训练目标仍然是 next-token prediction，只是部分输入 token 来自图像**。

### 1.4 一个 DDP 细节

```python
aux_loss = aux_loss + sum(p.sum() for p in self.vision_proj.parameters()) * 0  # dummy gradient for DDP
```

01 篇讲过 MoE 的哑梯度：DDP 要求所有 rank 的 backward 触达相同参数集。VLM 的 forward 里如果某个 batch 没有 `pixel_values`，vision_proj 就没有梯度 → DDP all-reduce 挂死。`× 0` 的哑梯度保证它永远在梯度名单里。

## 二、MiniMind-O：全模态语音交互

MiniMind-O 的野心更大：不是"LLM+耳朵"或"LLM+嘴"，而是**一个统一序列里同时建模文本推理、语音输入、语音输出**——对标 Qwen-Omni / GLM-4-Voice 的 Thinker-Talker 架构，且不是 ASR→LLM→TTS 的三段式串联，没有级联误差和信息瓶颈。

### 2.1 架构总览

```text
              ┌─ 文本 token ──────────────────────┐
输入 ────────┼─ 音频 → SenseVoice（冻结）→ audio_proj ─┤→ Thinker（MiniMind 8层）
              └─ 图像 → SigLIP2（冻结）→ vision_proj ──┘      ↓ bridge_layer 中间层表征
                                                        Talker（4 层 MiniMind block）
                                                              ↓
                                                    8 层 Mimi codes（MTP 同时预测）
                                                              ↓
                                                    Mimi 解码器（冻结）→ 24kHz 波形
```

模块参数账本（minimind-3o）：

| 模块 | 参数 | 状态 |
|---|---|---|
| Thinker（8 层，hidden 768） | 63.9M | 可训练 |
| Talker（4 层，8 codebook heads） | 47.1M | 可训练 |
| audio_proj / vision_proj | 0.99M / 1.18M | 可训练 |
| SenseVoice-Small（音频编码） | 234M | 冻结 |
| SigLIP2（视觉编码） | 94.6M | 冻结 |
| Mimi codec（音频编解码） | 96.2M | 冻结 |

可训练主体 113M，冻结外挂 425M——和 VLM 一样，"小脑子 + 大感官"。

### 2.2 双序列：文本流 + 8 路音频码流

这是 MiniMind-O 最有意思的设计。训练样本是 9 路并排的序列：

```python
# (9, T-1) = 8 路 audio codes + 1 路 text
X_audio = torch.tensor([layer[:-1] for layer in Y_audio_layers], dtype=torch.long)   # (8, T-1)
X_text  = torch.tensor(input_ids[:-1], dtype=torch.long)                             # (T-1,)
input_ids = torch.cat((X_audio, X_text.unsqueeze(0)), dim=0)
```

Thinker 吃 text 流（0/1 路），Talker 吃 8 路 audio code 流。Mimi codec 把 24kHz 音频压缩成 **8 个 codebook、每秒 12.5 帧**的离散 token（8 × 12.5 = 100 tokens/s 承载 24000 samples/s，压缩率 240:1）。一次前向同时输出 text logits 和 8 路 audio logits：

```python
def forward(self, input_ids, ...):
    if len(input_ids.shape) == 2:          # 纯文本推理：audio 全填 pad
        text_ids = input_ids
        audio_ids = torch.full((B, 8, T), self.audio_pad_token)
    else:                                  # 训练：(B, 9, T)
        text_ids, audio_ids = input_ids[:, 8, :], input_ids[:, :8, :]
    ...
    # Thinker 前向（文本 + 注入的音/图特征）
    for i, layer in enumerate(self.thinker.layers):
        ...
        if i == self.config.bridge_layer: bridge_states = hidden_states   # 半路截取！
    h_thinker = self.thinker.norm(hidden_states)
    # Talker 前向（音频码流条件于 bridge 表征）
    hidden_states = self.talker.embed_proj(bridge_states) * self.talker.text_scale \
                  + self.talker.codec_proj(talker_emb) * self.talker.audio_scale
    for layer in self.talker.layers: ...
    text_logits = self.thinker.lm_head(h_thinker[:, slice_indices, :])
    audio_logits = self.talker.lm_head(h_talker[:, slice_indices, :])     # (B, T, 8, 2112)
```

### 2.3 Bridge：为什么从中间层取

Talker 的条件不是 Thinker 的输出层，而是**中间层**（`bridge_layer = num_hidden_layers // 2 - 1`，8 层取第 3 层）的 hidden states。README 的解释值得完整记下：

- embedding 层语义信息不足（只是查表）；
- 最后一层被 LM head 过度塑形——它是为 next-token 分布专门调过的，丢了太多"原始"信息；
- 中间层已融合上下文与跨模态信息，又还没被输出目标过度压缩，最适合作为"语义条件"交给另一个生成器。

这与特征的 layer-wise 分析结论一致：中间层的表征通用性最强（BERT 时代就发现中层做句向量最好）。

### 2.4 Talker 的 MTP：8 个码本怎么一起预测

如果 8 层码本逐层自回归（layer 0 预测完 → 喂给 layer 1），推理延迟直接翻 8 倍。**MTP（Multi-Token Prediction）**让 8 层码本**同一步并行预测**：

```python
class TalkerHead(nn.Module):      # 输出端：共享 base + 每 codebook 一个轻量 adapter
    def __init__(self, in_features, out_features, num_layers=8, rank=256):
        self.base = nn.Linear(in_features, out_features, bias=False)      # 768→2112
        self.adapters = nn.ModuleList([
            nn.Sequential(nn.Linear(in_features, rank, bias=False), nn.GELU(),
                          nn.Linear(rank, out_features, bias=False))
            for _ in range(num_layers)])
    def forward(self, x):
        return [base_out + adapter(x) for adapter in self.adapters]       # 8 份 logits
```

embedding 端同样"共享主体 + 轻量 adapter"（`TalkerEmbedding`）。为什么这么设计：每个 codebook 的分布确实不同（codebook 0 承载主要语义，codebook 1~7 是残差修正），完全共享会混叠分布；但为每个码本复制整套参数，0.1B 的模型扛不住。共享 base 拿主要容量，rank=256 的 adapter 学各码本的分布修正——参数账：8 个 adapter 只增加 8 × (768×256 + 256×2112) ≈ 5.9M，而完整复制 8 份 head 要 8 × 1.6M × 8 ≈ 100M 量级。

Talker 内部的混合公式也值得看一眼：

```python
hidden = embed_proj(bridge_states) * text_scale + codec_proj(talker_emb) * audio_scale
```

语义条件（来自 Thinker）和声学条件（历史音频码）**先各自投影再标量门控混合**，`text_scale`/`audio_scale` 是可学习的标量参数（初始 3.0 / 1.0）——让网络自己学两个信息源的配比。

### 2.5 流式解码：文本与语音的延迟编排

`stream_generate` 是理解 omni 交互的核心。每一步同时做两件事：

1. 采一个文本 token（温度 0.75 / top_p 0.9，与主库 generate 相同的管线）；
2. 按"延迟调度"推进 8 路音频码：

```python
step = input_ids.shape[1] - start_pos        # 已生成 token 数
audio_step = step - 1                        # 延迟 1 步：输出第 1 个 text 时无 audio
if think_end_step is not None:               # </think> 之后才开始出声！
    audio_step = step - think_end_step
for i, al in enumerate(out.audio_logits):
    if audio_step < i:                       # 第 i 路码本要再等 i 步
        audio_codes[i].append(self.audio_pad_token)
    else:
        ...                                  # 采样第 i 路码
```

两层延迟编排：

- **文本先行 1 步**：audio_step = step - 1，文本 token 先落地，音频跟着走；
- **码本阶梯延迟**：第 i 路码本比第 0 路再晚 i 步（`audio_step < i` 时填 pad）——第 i 路预测时能看到低 i 层码本的完整上下文，**层间依赖通过时间延迟而非结构串行实现**。这正是 Mimi/EnCodec 分层 RVQ 的标准预测法。

还有两个体现"全模态"的细节：

- **思考时不张嘴**：`think_end_ids = tokenizer('</think>\n\n')` 逐步比对，检测到思考结束才启动音频输出——推理模型的"心里想"对用户静默，"说出来"才发声。这与 02 篇的自适应思考模板在生成端闭环。
- **边生成边出流**：Mimi 解码器支持增量解码（12.5Hz 帧率 → 80ms 一帧），`return_audio_codes=True` 时每个完整音频帧立刻 yield 出去，语音播放不等整句生成完。

### 2.6 音色克隆：in-context 条件注入

音色不靠微调、不靠文本 prompt 描述，靠**上下文条件**：

```python
# 参考音频 → Mimi codes，右对齐贴在回答开始之前
ref_codes = answer_audios[...]                # 数据集侧 8 路 ref codes
ref_start = max(spk_reserve, assistant_start - ref_len)
Y_audio_layers[layer_idx][ref_start + i] = code        # 只填输入不填 label！
# spk embedding 占位（50% 概率 drop ref codes，只留 spk）
if has_spk and ref_start > 0:
    Y_audio_layers[layer_idx][spk_pos] = self.audio_spk_token
```

```python
# 推理端：spk embedding 替换到 <|audio_spk|> 位置的 talker embedding
spk_mask = (audio_ids[:, 0, :] == self.audio_spk_token).unsqueeze(-1)
talker_emb = torch.where(spk_mask, self.talker.spk_proj(spk_emb).unsqueeze(1), talker_emb)
```

训练时在 assistant 回合前贴一段参考音频的 codes（**只作为条件、不计算 loss**），模型学会"延续参考音频的音色说话"；同时用 CAM++ 提取的 192 维 speaker embedding 作为冗余条件（50% 概率丢弃其一，防止单一依赖），推理时换音色只需替换这两个条件，权重完全不动。50% drop 也是一种 dropout 式的多模态条件鲁棒性训练——和 VLM 数据里随机加/不加 system prompt 是同一个思想。

### 2.7 训练目标与工程细节

损失是文本 CE 与音频 CE 的和：

```python
loss = text_loss + audio_loss + res.aux_loss
# audio loss：8 路码本各自 CE，stop token 加权 ×10
for i, al in enumerate(res.audio_logits):
    weighted_loss = layer_loss * valid_mask * (1 + stop_mask * 9)   # stop token 权重 10 倍
```

stop token（2050）10 倍加权是音频特有的"学会闭嘴"问题：模型什么时候停止发声决定能否正常结束，漏发 stop 就是"说个不停"，多给 10 倍权重逼模型对终止敏感。

数据侧还有两个对抗过拟合/分布漂移的强化设计：

- **Scheduled Sampling**（概率 0.05）：训练时以小概率把 input 里的历史码/文本替换成随机值——模型要学会"从错误历史中恢复"。 teacher forcing 的原罪是训练永远看金标准、推理却要看自己的输出（exposure bias），SS 是最轻量的缓解手段。实现里还特意保护了 image token 的连续性（随机替换会把 64 连发占位符打穿）。
- **音频增强全家桶**（`augment_wav`）：变速 0.7~1.6x、加高斯白噪、音量 0.8~1.2x、0.25s 时间遮蔽、低通滤波（模拟电话音质）、指数衰减混响、粉红噪声（环境底噪）——七种增强随机叠加，加上 fbank 上的 SpecAugment（频率/时间遮蔽）。文本侧从没有这么重的增强——语音输入的真实世界噪声分布远比文本恶劣。

训练流程按数据流逐步接入能力（不搞复杂多阶段 pretrain）：

```text
sft_t2a（文本→语音，对齐 Talker）→ sft_a2a（接入语音输入）→ sft_i2t（视觉路径，只训 vision_proj）
```

freeze 策略同样分级：`all` / `audio_proj`（只对齐音频投影）/ `vision_proj`（只对齐视觉投影），SenseVoice、SigLIP2、Mimi 永远冻结。

### 2.8 实时交互：VAD 与打断

`model_omni.py` 末尾的 `RealtimeSession` 是与模型零耦合的工程层：Silero VAD（ONNX，CPU）检测语音活动 → `min_speech_ms=128ms` 判定开始说话、`min_silence_ms=800ms` 判定说完 → 用户在模型生成时开口（`generating and speaking`）触发 `interrupt`——**实时打断**。配合流式解码，实现"边听边答、随时打断"的近似双工对话。

## 三、V 与 O 的对照

| | MiniMind-V | MiniMind-O |
|---|---|---|
| 外挂编码器 | SigLIP2（视觉） | SenseVoice（音频）+ SigLIP2 + Mimi（编解码） |
| 注入方式 | 占位符 embedding 替换 | 同 V（audio 同款 count/inject 逻辑） |
| 输出 | 纯文本 | 文本 + 8 路 Mimi codes |
| 新增可训练模块 | Projector ~1M | Talker 47M + 双 Projector ~2.2M |
| 条件传递 | 无（单生成器） | bridge_layer 中间层表征 |
| 训练 | pretrain(proj only) → sft(解冻首尾层) | t2a → a2a → i2t 渐进接入 |
| 对标范式 | LlaVA | Qwen-Omni（Thinker-Talker + MTP） |

共同的架构哲学收敛为一句话：**冻结的感知/生成外挂 + 极小的桥接模块 + 继承主干 + 统一到"预测下一个 token"这一个训练目标**。V 的桥是 1M 的 MLP，O 的桥是 47M 的 Talker（它要生成的内容复杂得多，8 路码本×2112 词表）；无论桥多复杂，"Thinker 始终是那个纯粹的语言模型"——语言主干的能力直接继承自 03 篇的完整训练管线，多模态部分只负责把世界翻译给它听。

至此 Minimind 系列四篇完结。回到 01 篇结尾的判断：结构没有秘密，秘密都在训练里；而训练也没有秘密——秘密都在数据与奖励的设计里。
