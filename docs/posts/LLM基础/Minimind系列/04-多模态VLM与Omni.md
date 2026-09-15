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

::: details 完整源码：model_vlm.py（MiniMind-V 全部 171 行核心）
```python
import os, torch, warnings
from .model_minimind import *
from typing import Optional, Tuple, List, Union
from torch import nn
from transformers import SiglipImageProcessor, SiglipVisionModel
from transformers.modeling_outputs import MoeCausalLMOutputWithPast

warnings.filterwarnings('ignore')


class VLMConfig(MiniMindConfig):
    model_type = "minimind-v"

    def __init__(self, image_special_token='<|image_pad|>', image_ids=[12], **kwargs):
        self.image_special_token = image_special_token
        self.image_ids = image_ids
        self.image_hidden_size = kwargs.get("image_hidden_size", 768)
        self.image_token_len = kwargs.get("image_token_len", 64)
        super().__init__(**kwargs)

class MMVisionProjector(nn.Module):
    def __init__(self, in_dim, out_dim, source_tokens=64, target_tokens=64):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.LayerNorm(in_dim),
            nn.Linear(in_dim, out_dim),
            nn.GELU(),
            nn.Linear(out_dim, out_dim),
        )
    def forward(self, x):
        return self.mlp(x)

# 继承自语言模型
class MiniMindVLM(MiniMindForCausalLM):
    config_class = VLMConfig

    def __init__(self, config: VLMConfig = None, vision_model_path="./model/siglip2-base-p32-256-ve"):
        self.config = config or VLMConfig()
        super().__init__(self.config)
        self.vision_encoder, self.processor = self.__class__.get_vision_model(vision_model_path)
        self.vision_proj = MMVisionProjector(self.config.image_hidden_size, self.config.hidden_size, target_tokens=self.config.image_token_len)

    @staticmethod
    def get_vision_model(model_path: str):
        from transformers import logging as hf_logging
        hf_logging.set_verbosity_error()
        if not os.path.exists(model_path):
            return None, None
        try:
            model = SiglipVisionModel.from_pretrained(model_path)
        except (RuntimeError, ValueError):
            return None, None
        processor = SiglipImageProcessor.from_pretrained(model_path)
        # 冻结 vision_encoder 的所有参数
        for param in model.parameters():
            param.requires_grad = False
        return model.eval(), processor

    @staticmethod
    def image2tensor(image, processor):
        if image.mode in ['RGBA', 'LA']: image = image.convert('RGB')
        inputs = processor(images=image, return_tensors="pt")
        return inputs

    @staticmethod
    def get_image_embeddings(image_inputs, vision_model):
        if hasattr(image_inputs, 'keys'):
            image_inputs = {k: v.squeeze(1) if v.ndim > 2 and v.shape[1] == 1 else v for k, v in image_inputs.items()}
        with torch.no_grad():
            outputs = vision_model(**image_inputs)
        return outputs.last_hidden_state

    @torch.compiler.disable
    def count_vision_proj(self, tokens, h, vision_tensors=None, seqlen=512):
        if vision_tensors is None or not self.config.image_ids:
            return h
        marker, vf = self.config.image_ids[0], vision_tensors
        if vf.dim() == 3:
            vf = vf.unsqueeze(1)
        out = []
        for b in range(h.size(0)):
            hb, seq, k, i = h[b], tokens[b].tolist(), 0, 0
            while i < len(seq):
                if seq[i] == marker:
                    start = i
                    while i < len(seq) and seq[i] == marker:
                        i += 1
                    if k < vf.size(1):
                        hb = torch.cat((hb[:start], vf[b][k][:i - start], hb[i:]), dim=0)[:seqlen]
                        k += 1
                else:
                    i += 1
            out.append(hb)
        return torch.stack(out)

    def forward(self,
                input_ids: Optional[torch.Tensor] = None,
                attention_mask: Optional[torch.Tensor] = None,
                past_key_values: Optional[List[Tuple[torch.Tensor, torch.Tensor]]] = None,
                use_cache: bool = False,
                logits_to_keep: Union[int, torch.Tensor] = 0,
                labels: Optional[torch.Tensor] = None,
                pixel_values: Optional[torch.FloatTensor] = None,
                **args):
        batch_size, seq_length = input_ids.shape
        if hasattr(past_key_values, 'layers'): past_key_values = None
        past_key_values = past_key_values or [None] * len(self.model.layers)
        start_pos = past_key_values[0][0].shape[1] if past_key_values[0] is not None else 0

        hidden_states = self.model.dropout(self.model.embed_tokens(input_ids))

        if pixel_values is not None and start_pos == 0:
            if hasattr(pixel_values, 'keys'):
                sample_val = next(iter(pixel_values.values()))
                if sample_val.ndim == 5:
                    bs, num = sample_val.shape[:2]
                    vision_tensors = self.vision_proj(MiniMindVLM.get_image_embeddings({k: v.flatten(0, 1) for k, v in pixel_values.items()}, self.vision_encoder)).view(bs, num, self.config.image_token_len, -1)
                else:
                    vision_tensors = self.vision_proj(MiniMindVLM.get_image_embeddings(pixel_values, self.vision_encoder))
            else:
                if len(pixel_values.shape) == 6:
                    pixel_values = pixel_values.squeeze(2)
                bs, num, c, im_h, im_w = pixel_values.shape
                vision_tensors = torch.stack([self.vision_proj(MiniMindVLM.get_image_embeddings(pixel_values[:, i, :, :, :], self.vision_encoder)) for i in range(num)], dim=1)
            hidden_states = self.count_vision_proj(tokens=input_ids, h=hidden_states, vision_tensors=vision_tensors, seqlen=input_ids.shape[1])

        # Recompute RoPE buffers lost during meta-device init (transformers>=5.x)
        if self.model.freqs_cos[0, 0] == 0:
            freqs_cos, freqs_sin = precompute_freqs_cis(dim=self.config.head_dim, end=self.config.max_position_embeddings, rope_base=self.config.rope_theta, rope_scaling=self.config.rope_scaling)
            self.model.freqs_cos, self.model.freqs_sin = freqs_cos.to(hidden_states.device), freqs_sin.to(hidden_states.device)
        position_embeddings = (
            self.model.freqs_cos[start_pos:start_pos + seq_length],
            self.model.freqs_sin[start_pos:start_pos + seq_length]
        )

        presents = []
        for layer_idx, (layer, past_key_value) in enumerate(zip(self.model.layers, past_key_values)):
            hidden_states, present = layer(
                hidden_states,
                position_embeddings,
                past_key_value=past_key_value,
                use_cache=use_cache,
                attention_mask=attention_mask
            )
            presents.append(present)

        hidden_states = self.model.norm(hidden_states)

        aux_loss = sum([l.mlp.aux_loss for l in self.model.layers if isinstance(l.mlp, MOEFeedForward)], hidden_states.new_zeros(1).squeeze())
        aux_loss = aux_loss + sum(p.sum() for p in self.vision_proj.parameters()) * 0  # dummy gradient for DDP
        slice_indices = slice(-logits_to_keep, None) if isinstance(logits_to_keep, int) else logits_to_keep
        logits = self.lm_head(hidden_states[:, slice_indices, :])

        loss = None
        if labels is not None:
            shift_logits = logits[..., :-1, :].contiguous()
            shift_labels = labels[..., 1:].contiguous()
            loss = F.cross_entropy(shift_logits.view(-1, shift_logits.size(-1)), shift_labels.view(-1), ignore_index=-100)

        output = MoeCausalLMOutputWithPast(loss=loss, aux_loss=aux_loss, logits=logits, past_key_values=presents, hidden_states=hidden_states)
        return output

    def generate(self, *args, num_return_sequences=1, **kwargs):
        if num_return_sequences > 1 and 'pixel_values' in kwargs:
            pv = kwargs['pixel_values']
            if hasattr(pv, 'keys'):
                kwargs['pixel_values'] = {k: v.repeat(num_return_sequences, *([1] * (v.ndim - 1))) for k, v in pv.items()}
            else:
                kwargs['pixel_values'] = pv.repeat(num_return_sequences, *([1] * (pv.ndim - 1)))
        return super().generate(*args, num_return_sequences=num_return_sequences, **kwargs)
```
:::

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

::: details 完整源码：model_omni.py 的 Talker 模块（MTP 共享 head + 混合嵌入）
```python
class TalkerHead(nn.Module):
    def __init__(self, in_features, out_features, num_layers=8, rank=256):
        super().__init__()
        self.num_layers = num_layers
        self.base = nn.Linear(in_features, out_features, bias=False)      # 768→2112 共享主体
        self.adapters = nn.ModuleList([nn.Sequential(nn.Linear(in_features, rank, bias=False), nn.GELU(), nn.Linear(rank, out_features, bias=False)) for _ in range(num_layers)])
    def forward(self, x):
        base_out = self.base(x)
        return [base_out + adapter(x) for adapter in self.adapters]       # 8 份 logits


class TalkerEmbedding(nn.Module):
    def __init__(self, num_embeddings, embedding_dim, num_layers=8, rank=256):
        super().__init__()
        self.num_layers = num_layers
        self.base = nn.Embedding(num_embeddings, embedding_dim)
        self.adapters = nn.ModuleList([nn.Sequential(nn.Embedding(num_embeddings, rank), nn.GELU(), nn.Linear(rank, embedding_dim, bias=False)) for _ in range(num_layers)])
    def forward(self, x):
        base_out = self.base(x)
        return sum(base_out[:, i, :] + self.adapters[i](x[:, i, :]) for i in range(len(self.adapters))) / self.num_layers


class TalkerModule(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.talker_config = MiniMindConfig(hidden_size=config.talker_hidden_size, use_moe=config.use_moe)
        self.layers = nn.ModuleList([MiniMindBlock(l, self.talker_config) for l in range(config.num_talker_hidden_layers)])
        self.norm = RMSNorm(config.talker_hidden_size, eps=config.rms_norm_eps)
        self.lm_head = TalkerHead(config.talker_hidden_size, config.audio_vocab_size)
        self.embed_tokens = TalkerEmbedding(config.audio_vocab_size, config.talker_hidden_size)
        self.codec_proj = nn.Sequential(nn.Linear(config.talker_hidden_size, config.talker_hidden_size), nn.GELU(), nn.Linear(config.talker_hidden_size, config.talker_hidden_size), RMSNorm(config.talker_hidden_size, eps=config.rms_norm_eps))
        self.embed_proj = nn.Sequential(nn.Linear(config.hidden_size, config.hidden_size), nn.GELU(), nn.Linear(config.hidden_size, config.talker_hidden_size), RMSNorm(config.talker_hidden_size, eps=config.rms_norm_eps))
        self.text_scale, self.audio_scale = nn.Parameter(torch.tensor(3.0)), nn.Parameter(torch.tensor(1.0))   # 可学习配比
        self.spk_proj = nn.Linear(config.spk_emb_size, config.talker_hidden_size, bias=False)
        freqs_cos, freqs_sin = precompute_freqs_cis(dim=self.talker_config.head_dim, end=config.max_position_embeddings, rope_base=config.rope_theta, rope_scaling=config.rope_scaling)
        self.register_buffer("freqs_cos", freqs_cos, persistent=False)
        self.register_buffer("freqs_sin", freqs_sin, persistent=False)
```
:::

::: details 完整源码：MiniMindOmni.forward（Thinker→bridge→Talker 双路前向）
```python
def forward(self, input_ids, attention_mask=None, past_key_values=None, use_cache=False, logits_to_keep=0, audio_inputs=None, audio_lens=None, pixel_values=None, **args):
    if len(input_ids.shape) == 2:          # 纯文本推理：audio 全填 pad
        batch_size, seq_length = input_ids.shape
        text_ids = input_ids
        audio_ids = torch.full((batch_size, 8, seq_length), self.audio_pad_token, dtype=torch.long, device=input_ids.device)
    else:                                  # 训练：(B, 9, T)
        batch_size, _, seq_length = input_ids.shape
        text_ids, audio_ids = input_ids[:, 8, :], input_ids[:, :8, :]
    if hasattr(past_key_values, 'layers'): past_key_values = None
    n_thinker, n_talker = len(self.thinker.layers), len(self.talker.layers)
    past_key_values = past_key_values or ([None] * (n_thinker + n_talker))
    start_pos = past_key_values[0][0].shape[1] if past_key_values[0] is not None else 0
    # Recompute RoPE buffers lost during meta-device init (transformers>=5.x)
    if self.thinker.freqs_cos[0, 0] == 0:
        freqs_cos, freqs_sin = precompute_freqs_cis(dim=self.config.head_dim, end=self.config.max_position_embeddings, rope_base=self.config.rope_theta, rope_scaling=self.config.rope_scaling)
        self.thinker.freqs_cos, self.thinker.freqs_sin = freqs_cos.to(input_ids.device), freqs_sin.to(input_ids.device)
    if self.talker.freqs_cos[0, 0] == 0:
        freqs_cos, freqs_sin = precompute_freqs_cis(dim=self.talker.talker_config.head_dim, end=self.config.max_position_embeddings, rope_base=self.config.rope_theta, rope_scaling=self.config.rope_scaling)
        self.talker.freqs_cos, self.talker.freqs_sin = freqs_cos.to(input_ids.device), freqs_sin.to(input_ids.device)
    presents = []

    # ======= Thinker: text-only input, output text logits =======
    hidden_states = self.thinker.dropout(self.thinker.embed_tokens(text_ids))
    position_embeddings = (self.thinker.freqs_cos[start_pos:start_pos + seq_length], self.thinker.freqs_sin[start_pos:start_pos + seq_length])
    if audio_inputs is not None and start_pos == 0:
        audio_features = self.encode_audio_inputs(audio_inputs, audio_lens)
        hidden_states = self.inject_audio_features(text_ids, hidden_states, audio_features, seq_length)
    if pixel_values is not None and start_pos == 0:
        if hasattr(pixel_values, 'keys'):
            img_emb = self.get_image_embeddings(pixel_values).to(hidden_states.dtype)
            vision_tensors = self.vision_proj(img_emb)
        else:
            if len(pixel_values.shape) == 6:
                pixel_values = pixel_values.squeeze(2)
            if len(pixel_values.shape) == 4:
                pixel_values = pixel_values.unsqueeze(1)
            bs, num, c, im_h, im_w = pixel_values.shape
            stack_dim = 1 if bs > 1 else 0
            vision_tensors = torch.stack([
                self.encode_image_inputs(pixel_values[:, i, :, :, :])
                for i in range(num)
            ], dim=stack_dim)
        hidden_states = self.count_vision_proj(tokens=text_ids, h=hidden_states, vision_tensors=vision_tensors, seqlen=seq_length)
    bridge_states = hidden_states                     # bridge 层之前的状态先存下
    for i, (layer, past_key_value) in enumerate(zip(self.thinker.layers, past_key_values[:n_thinker])):
        hidden_states, present = layer(hidden_states, position_embeddings, past_key_value=past_key_value, use_cache=use_cache, attention_mask=attention_mask)
        presents.append(present)
        if i == self.config.bridge_layer: bridge_states = hidden_states    # 半路截取！
    h_thinker = self.thinker.norm(hidden_states)

    # ======= Talker: thinker hidden + audio codes, output audio logits =======
    talker_emb = self.talker.embed_tokens(audio_ids)
    spk_emb = args.get('spk_emb', None)
    if spk_emb is not None:
        spk_mask = (audio_ids[:, 0, :] == self.audio_spk_token).unsqueeze(-1)
        talker_emb = torch.where(spk_mask, self.talker.spk_proj(spk_emb).unsqueeze(1), talker_emb)   # 音色条件注入
    hidden_states = self.talker.embed_proj(bridge_states) * self.talker.text_scale + self.talker.codec_proj(talker_emb) * self.talker.audio_scale
    talker_pos_emb = (self.talker.freqs_cos[start_pos:start_pos + seq_length], self.talker.freqs_sin[start_pos:start_pos + seq_length])
    for layer, past_key_value in zip(self.talker.layers, past_key_values[n_thinker:]):
        hidden_states, present = layer(hidden_states, talker_pos_emb, past_key_value=past_key_value, use_cache=use_cache, attention_mask=attention_mask)
        presents.append(present)
    h_talker = self.talker.norm(hidden_states)

    slice_indices = slice(-logits_to_keep, None) if isinstance(logits_to_keep, int) else logits_to_keep
    aux_loss = sum(l.mlp.aux_loss for l in list(self.thinker.layers) + list(self.talker.layers) if isinstance(l.mlp, MOEFeedForward))
    aux_loss += sum(p.sum() for p in self.audio_proj.parameters()) * 0 + sum(p.sum() for p in self.vision_proj.parameters()) * 0 + sum(p.sum() for p in self.talker.lm_head.adapters.parameters()) * 0 + sum(p.sum() for p in self.talker.spk_proj.parameters()) * 0  # dummy gradient
    text_logits = self.thinker.lm_head(h_thinker[:, slice_indices, :])
    audio_logits = self.talker.lm_head(h_talker[:, slice_indices, :])

    out = MoeCausalLMOutputWithPast(aux_loss=aux_loss, logits=text_logits, past_key_values=presents)
    out.audio_logits = audio_logits
    return out
```
:::

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

::: details 完整源码：omni_dataset.py 的 9 路序列构造（__getitem__ 核心）
```python
def __getitem__(self, index: int):
    conversations = json.loads(self.table['conversations'][index].as_py())
    question_audios = self.table['question_audios'][index].as_py() if 'question_audios' in self.table.column_names else []
    answer_audios = self.table['answer_audios'][index].as_py() if 'answer_audios' in self.table.column_names else []
    image_bytes = self.table['image_bytes'][index].as_py() if 'image_bytes' in self.table.column_names else []
    if image_bytes and not isinstance(image_bytes, list): image_bytes = [image_bytes]
    ref_audios = self.table['ref_audios'][index].as_py() if 'ref_audios' in self.table.column_names else []
    spk_emb_raw = self.table['spk_emb'][index].as_py() if 'spk_emb' in self.table.column_names else []

    # 随机截断到某一轮（每轮=user+assistant）
    asst_indices = [i for i, t in enumerate(conversations) if t['role'] == 'assistant']
    if len(asst_indices) > 1:
        rand_idx = random.randint(0, len(asst_indices) - 1)
        # 从随机轮次开始，向前回退直到长度安全
        for i in range(rand_idx, -1, -1):
            conversations = conversations[:asst_indices[i] + 1]
            test_prompt = self.create_chat_prompt(conversations, 0)
            if len(self.tokenizer(test_prompt).input_ids) + 100 < self.max_length:
                break

    # 加载最后一个user的图像（按user轮次索引访问，与audio一致）
    pixel_values = None
    if image_bytes and len(image_bytes) > 0 and self.vision_processor:
        pixel_values = self.load_image_inputs(image_bytes[0])

    # 只加载最后一个user的audio
    audio_inputs, audio_len, audio_features_length = None, 0, 0
    user_count = sum(1 for t in conversations if t['role'] == 'user')
    if question_audios and user_count > 0 and user_count <= len(question_audios) and self.audio_processor:
        audio_bytes = question_audios[user_count - 1]
        if audio_bytes:
            mel, valid_len = self.load_audio_inputs(audio_bytes)
            if mel is not None:
                audio_inputs = mel.unsqueeze(0)
                audio_len = valid_len
                audio_features_length = valid_len or 1

    # 混合训练时，无音频样本返回dummy tensor保持batch索引尽可能对齐 (SenseVoice: T x 560)
    if audio_inputs is None and self.audio_processor:
        audio_inputs = torch.zeros(1, 1, 560)
        audio_len = 0
    if pixel_values is None and self.vision_processor:
        pixel_values = {'pixel_values': torch.zeros(1, 3, 256, 256)}

    # 从answer_audios获取最后一个assistant的音频codes：扁平tokens → 8路
    last_audio_codes = None
    asst_count = sum(1 for t in conversations if t['role'] == 'assistant')
    if answer_audios and asst_count > 0 and asst_count <= len(answer_audios):
        tokens = answer_audios[asst_count - 1]
        if tokens:
            audio_codes_8layers = [[] for _ in range(8)]
            for i in range(0, len(tokens) - 7, 8):
                for j in range(8): audio_codes_8layers[j].append(tokens[i + j])
            for layer in audio_codes_8layers: layer.append(self.audio_stop_token)
            last_audio_codes = audio_codes_8layers

    # 生成prompt (text input_ids)
    prompt = self.create_chat_prompt(conversations, audio_features_length)
    if pixel_values is not None: prompt = prompt.replace('<image>', self.image_token)
    input_ids = self.tokenizer(prompt).input_ids[:self.max_length]

    # PAD input_ids到max_length
    input_ids += [self.tokenizer.pad_token_id] * (self.max_length - len(input_ids))

    # 生成labels（只训练最后一个assistant）
    text_labels, assistant_ranges = self.generate_text_labels(input_ids)
    for start, end in assistant_ranges[:-1]:
        mask_end = min(end + len(self.eos_id), self.max_length)
        text_labels[start:mask_end] = [-100] * (mask_end - start)

    # 生成8层audio targets（只填充最后一个assistant）
    Y_audio_layers = [[self.audio_pad_token] * self.max_length for _ in range(8)]
    audio_labels = [[-100] * self.max_length for _ in range(8)]
    if assistant_ranges and last_audio_codes:
        assistant_start, assistant_end = assistant_ranges[-1]
        # 跳过 <think></think> 空壳：思考期不发声
        for pos in range(assistant_start, min(assistant_end, assistant_start + 50)):
            if input_ids[pos:pos + len(self.think_end_ids)] == self.think_end_ids:
                assistant_start = pos + len(self.think_end_ids)
                break
        # spk_emb 占位 + ref_codes 右对齐（50% 概率 drop ref_codes，只保留 spk）
        has_spk = bool(spk_emb_raw)
        has_ref = bool(ref_audios) and random.random() > 0.5
        spk_reserve = 1 if has_spk else 0
        if has_ref:
            ref_codes = [[] for _ in range(8)]
            for i in range(0, len(ref_audios) - 7, 8):
                for j in range(8): ref_codes[j].append(ref_audios[i + j])
            ref_len = len(ref_codes[0])
            ref_start = max(spk_reserve, assistant_start - ref_len)
            for layer_idx in range(8):
                codes = ref_codes[layer_idx][-(assistant_start - ref_start):] if ref_len > (assistant_start - ref_start) else ref_codes[layer_idx]
                for i, code in enumerate(codes):
                    Y_audio_layers[layer_idx][ref_start + i] = code
        else:
            ref_start = assistant_start
        if has_spk and ref_start > 0:
            spk_pos = ref_start - 1
            for layer_idx in range(8):
                Y_audio_layers[layer_idx][spk_pos] = self.audio_spk_token
        # target codes 填充到 assistant_start 之后（参与 loss）
        for layer_idx in range(8):
            codes = last_audio_codes[layer_idx]
            start_pos = assistant_start + layer_idx + 1        # 码本 i 延迟 i+1 步
            for i, code in enumerate(codes):
                if start_pos + i < self.max_length:
                    Y_audio_layers[layer_idx][start_pos + i] = code
                    audio_labels[layer_idx][start_pos + i] = code

    # 构造9路输入：input_ids = (9, T) = 8路audio + 1路text
    X_audio = torch.tensor([layer[:-1] for layer in Y_audio_layers], dtype=torch.long)  # (8, T-1)
    X_text = torch.tensor(input_ids[:-1], dtype=torch.long)  # (T-1,)
    input_ids = torch.cat((X_audio, X_text.unsqueeze(0)), dim=0)  # (9, T-1)
    text_labels = torch.tensor(text_labels[1:], dtype=torch.long)  # (T-1,)
    audio_labels = torch.tensor([layer[1:] for layer in audio_labels], dtype=torch.long)  # (8, T-1)

    input_ids = self.apply_scheduled_sampling(input_ids, audio_labels, text_labels)
    spk_emb = torch.tensor(spk_emb_raw, dtype=torch.float32) if spk_emb_raw else torch.zeros(192)
    return input_ids, text_labels, audio_labels, audio_inputs, audio_len, pixel_values, spk_emb
```
:::

训练流程按数据流逐步接入能力（不搞复杂多阶段 pretrain）：

```text
sft_t2a（文本→语音，对齐 Talker）→ sft_a2a（接入语音输入）→ sft_i2t（视觉路径，只训 vision_proj）
```

freeze 策略同样分级：`all` / `audio_proj`（只对齐音频投影）/ `vision_proj`（只对齐视觉投影），SenseVoice、SigLIP2、Mimi 永远冻结。

### 2.8 实时交互：VAD 与打断

`model_omni.py` 末尾的 `RealtimeSession` 是与模型零耦合的工程层：Silero VAD（ONNX，CPU）检测语音活动 → `min_speech_ms=128ms` 判定开始说话、`min_silence_ms=800ms` 判定说完 → 用户在模型生成时开口（`generating and speaking`）触发 `interrupt`——**实时打断**。配合流式解码，实现"边听边答、随时打断"的近似双工对话。

::: details 完整源码：stream_generate（文本与 8 路音频的流式解码编排）
```python
def stream_generate(self, input_ids, eos_token_id, max_new_tokens, temperature, top_p, rp, use_cache, return_audio_codes=False, **args):
    start_pos, past_kvs, text_finished, first_finished = input_ids.shape[1], None, False, True
    audio_codes = [[] for _ in range(8)]
    audio_stop_pos = [None] * 8
    audio_buffer = torch.full((1, 8, start_pos), self.audio_pad_token, dtype=torch.long, device=input_ids.device)
    spk_emb = args.get('spk_emb', None)
    ref_codes = args.get('ref_codes', None)
    ref_len = ref_codes.shape[2] if ref_codes is not None else 0
    spk_reserve = 1 if spk_emb is not None else 0
    fill_end = start_pos
    fill_start = max(spk_reserve, start_pos - ref_len)
    if ref_codes is not None and fill_start < fill_end:      # 参考音频 codes 右对齐贴入
        audio_buffer[:, :, fill_start:fill_end] = ref_codes[:, :, -(fill_end - fill_start):]
    if spk_emb is not None and fill_start > 0:
        audio_buffer[:, :, fill_start - 1] = self.audio_spk_token
    think_end_step, generated_tokens = None, ([] if args.get('open_thinking', False) else None)
    while input_ids.shape[1] < start_pos + max_new_tokens:
        if past_kvs is None or not use_cache:
            out = self.forward(torch.cat((audio_buffer, input_ids.unsqueeze(1)), dim=1), past_key_values=past_kvs, use_cache=use_cache, **args)
        else:
            out = self.forward(torch.cat((audio_buffer[:, :, -1:], input_ids[:, -1:].unsqueeze(1)), dim=1), past_key_values=past_kvs, use_cache=use_cache, **args)
        past_kvs = out.past_key_values

        # ---- 第一步：采文本 token ----
        logits = out.logits[0, -1, :].clone() / (temperature + 1e-9)
        if rp != 1.0:
            seen = list(set(input_ids[0].tolist())); score = logits[seen]; logits[seen] = torch.where(score > 0, score / rp, score * rp)
        if top_p and top_p < 1.0:
            sorted_l, sorted_i = torch.sort(logits, descending=True)
            mask = torch.cumsum(F.softmax(sorted_l, dim=-1), dim=-1) > top_p
            mask[1:], mask[0] = mask[:-1].clone(), False
            logits[sorted_i[mask]] = -float('Inf')
        text_token = torch.multinomial(F.softmax(logits, dim=-1), 1).item()

        if text_finished:
            text_token = args.get('enter_token_id', 201) if first_finished else args.get('pad_token_id', 0)
            first_finished = False

        # ---- 第二步：按延迟调度推进 8 路音频码 ----
        step = input_ids.shape[1] - start_pos  # 已生成token数（0=首次，此时模型处理prompt末尾token）
        audio_step = step - 1  # 延迟1步：输出第1个text时无audio，输出第2个text时layer0开始
        if generated_tokens is not None:
            generated_tokens.append(text_token)
            if not think_end_step and generated_tokens[-len(self.config.think_end_ids):] == list(self.config.think_end_ids): think_end_step = step + 2
            audio_step = (step - think_end_step) if think_end_step else -1    # </think> 之后才出声
        for i, al in enumerate(out.audio_logits):
            if audio_step < i:               # 第 i 路码本要再等 i 步（阶梯延迟）
                audio_codes[i].append(self.audio_pad_token)
            else:
                logits_i = al[0, -1, :].clone() / 0.2
                for prev_code in audio_codes[i][-3:]: score = logits_i[prev_code]; logits_i[prev_code] = torch.where(score > 0, score / 1.05, score * 1.05)
                top_val, top_idx = logits_i.topk(50)
                code = top_idx[torch.multinomial(F.softmax(top_val, dim=-1), 1)].item()
                audio_codes[i].append(code)
                if audio_stop_pos[i] is None and code >= 2048: audio_stop_pos[i] = len(audio_codes[i]) - 1

        if text_finished and all(audio_stop_pos[i] is not None for i in range(8)): break

        input_ids = torch.cat((input_ids, torch.tensor([[text_token]], device=input_ids.device)), dim=1)
        audio_buffer = torch.cat((audio_buffer, torch.full((1, 8, 1), self.audio_pad_token, dtype=torch.long, device=input_ids.device)), dim=2)
        for i in range(min(audio_step + 1, 8)): audio_buffer[0, i, -1] = audio_codes[i][-1]

        audio_frame = None
        if return_audio_codes and audio_step >= 7:
            frame = [audio_codes[i][step - 7 + i] for i in range(8)]   # 8 路对齐成一帧
            active_layers = sum(1 for i in range(8) if audio_stop_pos[i] is None or step - 7 + i < audio_stop_pos[i])
            if active_layers >= 8: audio_frame = frame
        if not text_finished:
            yield input_ids[:, start_pos:], audio_frame
            if text_token == eos_token_id: text_finished = True
        else:
            yield None, audio_frame
```
:::

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
