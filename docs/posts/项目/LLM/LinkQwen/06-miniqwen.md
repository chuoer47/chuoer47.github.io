---
title: 6. MiniQwen：从组件到完整模型
order: 6
---

# 6. MiniQwen：从组件到完整模型

## 概述

第 1-5 章介绍了 Transformer 的核心组件：MLP、归一化层、位置编码、注意力机制、线性注意力。本章不再重复这些组件的内部实现，而是聚焦于**如何把它们组装成一个完整的 Qwen3.5 风格模型——MiniQwen 0.8B**。

本章重点讲三件事：
1. **整体架构组织**：Decoder 堆叠、Pre-Norm+残差、混合层布局（3:1）
2. **配置与参数量**：`MiniQwenConfig` 每个字段的作用，逐项推导参数量并用代码验证
3. **数据流**：输入 token 如何经过 embed → 24 层 → norm → lm_head 输出 logits

> 组件细节（RMSNorm 的零初始化、Partial RoPE 的 64 维、GQA 的 Sigmoid Gate、DeltaNet 的 delta rule）请回看第 1-5 章，本章只讲"它们怎么组合"。

## 6.1 整体架构组织

MiniQwen 是一个**纯 Decoder 的自回归语言模型**（和 GPT、LLaMA、Qwen3.5 同类）。它的整体结构是"词嵌入 + N 层 DecoderLayer + 最终归一化 + LM Head"：

<div style="text-align:center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; margin: 20px auto; max-width: 480px; color: #2c3e50;">

  <div style="font-weight: 500;">input_ids <span style="color:#909399; font-size:13px;">(batch, seq_len)</span></div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <div style="display:inline-block; border:1px solid #409eff; background:#ecf5ff; padding:10px 28px; border-radius:6px; font-weight:500;">
    Token Embedding
    <div style="font-size:13px; color:#606266; font-weight:normal; margin-top:2px;">vocab_size → hidden_size</div>
  </div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <div style="border:1px solid #67c23a; border-radius:8px; padding:16px; background:#f0f9eb; display:inline-block; text-align:left;">
    <div style="text-align:center; font-weight:600; margin-bottom:10px;">DecoderLayer × 24</div>
    <div style="border:1px dashed #67c23a; padding:10px 14px; border-radius:4px; background:#fff; margin-bottom:8px; line-height:2;">
      <b>Token Mixer</b>（按层类型选）<br>
      <span style="color:#409eff;">• 18 层用 Gated DeltaNet</span>（线性注意力，第5章）<br>
      <span style="color:#e6a23c;">• 6 层用 GQA + Sigmoid Gate</span>（全注意力，第4章）
    </div>
    <div style="border:1px dashed #67c23a; padding:10px 14px; border-radius:4px; background:#fff; line-height:2;">
      <b>FFN</b>：SwiGLU（第1章）<br>
      <span style="font-size:13px; color:#606266;">gate_proj · silu + up_proj → down_proj</span>
    </div>
  </div>

  <div style="color:#909399; margin: 4px 0;">▼</div>

  <div style="display:inline-block; border:1px solid #e6a23c; background:#fdf6ec; padding:10px 28px; border-radius:6px; font-weight:500;">
    Final RMSNorm
  </div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <div style="display:inline-block; border:1px solid #409eff; background:#ecf5ff; padding:10px 28px; border-radius:6px; font-weight:500;">
    LM Head
    <div style="font-size:13px; color:#606266; font-weight:normal; margin-top:2px;">hidden_size → vocab_size（与 Embedding tie）</div>
  </div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <div style="font-weight: 500;">logits <span style="color:#909399; font-size:13px;">(batch, seq_len, vocab_size)</span></div>

</div>

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/miniqwen/model/modeling_miniqwen.py)：`MiniQwenModel`（embedding + layers + norm）+ `MiniQwenForCausalLM`（加 LM head）。

### 混合层布局（3:1）

MiniQwen 24 层里，**18 层用线性注意力（Gated DeltaNet）、6 层用全注意力（GQA）**，按"每 4 层 1 个全注意力"分布：

<div style="text-align:center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 16px auto; max-width: 560px; color: #2c3e50;">
  <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:4px;">
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #e6a23c; background:#fdf6ec; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#e6a23c;">GQA</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #e6a23c; background:#fdf6ec; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#e6a23c;">GQA</div>
    <div style="display:flex; align-items:center; padding:0 6px; color:#909399; font-size:18px;">⋯</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #409eff; background:#ecf5ff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#409eff;">DN</div>
    <div style="width:48px; height:36px; border:1px solid #e6a23c; background:#fdf6ec; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#e6a23c;">GQA</div>
  </div>
  <div style="font-size:13px; color:#606266; margin-top:8px;">
    <span style="color:#409eff;">■ DN = Gated DeltaNet（线性注意力，O(n)）</span> &nbsp;&nbsp;
    <span style="color:#e6a23c;">■ GQA = 全注意力（O(n²)，含 KV Cache）</span>
  </div>
  <div style="font-size:13px; color:#909399; margin-top:4px;">每 4 层中 3 层线性 + 1 层全注意力（full_attention_interval=4）</div>
</div>

**为什么混合？** 线性注意力快（O(n)、无 KV Cache），但长距离建模弱；全注意力表达力强但慢。混合布局兼顾效率和质量——大部分层用高效的 DeltaNet，少数层用 GQA 保证长距离依赖。`full_attention_interval=4` 控制比例（值越大线性层越多）。

## 6.2 配置详解

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/miniqwen/model/config.py)：`MiniQwenConfig` 类。配置分四组：

```python
class MiniQwenConfig:
    def __init__(self,
        # 通用
        vocab_size=248320, hidden_size=1024, intermediate_size=3584,
        num_hidden_layers=24, rms_norm_eps=1e-6, max_position_embeddings=262144,
        rope_theta=10000000.0,            # RoPE 频率基数（官方 0.8B 用 1e7）
        # GQA（全注意力）
        num_attention_heads=8, num_key_value_heads=2, head_dim=256,
        partial_rotary_factor=0.25, attention_bias=False,
        # Gated DeltaNet（线性注意力）
        linear_conv_kernel_dim=4, linear_key_head_dim=128, linear_value_head_dim=128,
        linear_num_key_heads=16, linear_num_value_heads=16,
        # 层布局
        full_attention_interval=4,
        tie_word_embeddings=True,
    ):
```

| 组 | 字段 | 值 | 含义 |
|----|------|-----|------|
| **通用** | vocab_size | 248320 | 词表大小（Qwen3.5 BPE） |
| | hidden_size | 1024 | 模型隐藏维度 $d$ |
| | intermediate_size | 3584 | FFN 中间层维度（≈3.5d） |
| | num_hidden_layers | 24 | Transformer 层数 |
| | rope_theta | 1e7 | RoPE 频率基数（长上下文外推） |
| | max_position_embeddings | 262144 | 最大序列长度（256K） |
| **GQA** | num_attention_heads | 8 | Q 头数 |
| | num_key_value_heads | 2 | KV 头数（8Q 共享 2KV） |
| | head_dim | 256 | 每头维度 |
| | partial_rotary_factor | 0.25 | 只对前 64 维做 RoPE |
| **DeltaNet** | linear_num_key_heads | 16 | 线性注意力 K/V 头数 |
| | linear_key_head_dim | 128 | K 头维度 |
| | linear_value_head_dim | 128 | V 头维度 |
| | linear_conv_kernel_dim | 4 | 因果卷积核大小 |
| **布局** | full_attention_interval | 4 | 每 4 层 1 个全注意力 |
| | tie_word_embeddings | True | lm_head 与 embed 共享权重 |

### 派生参数

配置里还有几个**由构造参数算出来**的派生量（不进 `config.json`，但模型代码用到）：

```python
self.rotary_dim = int(head_dim * partial_rotary_factor)   # 256 × 0.25 = 64
self.kv_size = num_key_value_heads * head_dim              # 2 × 256 = 512
self.q_size = num_attention_heads * head_dim              # 8 × 256 = 2048
```

## 6.3 参数量推导

MiniQwen 0.8B 的总参数量是 **752,393,024**（约 0.75B）。下面逐项推导，最后用代码验证。

> 约定：`tie_word_embeddings=True`，所以 lm_head 不额外占参数（和 embed 共享）。所有 Linear 层 `bias=False`。

### 6.3.1 Embedding

$$\text{embed} = \text{vocab\_size} \times \text{hidden\_size} = 248320 \times 1024 = 254{,}279{,}680$$

### 6.3.2 每层 MLP（SwiGLU，24 层都用）

SwiGLU 有三个 Linear：gate_proj、up_proj（hidden→intermediate）、down_proj（intermediate→hidden）。

$$\text{MLP} = \underbrace{2 \times \text{hidden} \times \text{intermediate}}_{\text{gate+up}} + \underbrace{\text{intermediate} \times \text{hidden}}_{\text{down}} = 3 \times 1024 \times 3584 = 11{,}010{,}048$$

### 6.3.3 每层 GQA（6 层用）

GQA 的投影：q_proj（输出 2×head_dim，一半 query 一半 gate）、k_proj、v_proj（输出 kv_size）、o_proj。加 Q/K RMSNorm。

| 子模块 | 形状 | 参数量 |
|--------|------|--------|
| q_proj | (2×q_size, hidden) = (4096, 1024) | 4,194,304 |
| k_proj | (kv_size, hidden) = (512, 1024) | 524,288 |
| v_proj | (kv_size, hidden) = (512, 1024) | 524,288 |
| o_proj | (hidden, q_size) = (1024, 2048) | 2,097,152 |
| q_norm + k_norm | 2 × head_dim = 2×256 | 512 |

$$\text{GQA（不含 MLP）} = 4{,}194{,}304 + 524{,}288 + 524{,}288 + 2{,}097{,}152 + 512 = 7{,}340{,}544$$

> q_proj 输出 2×q_size 是因为**一半是 query、一半是 sigmoid gate**（第4章 Sigmoid Gate）。o_proj 输入是 q_size（不是 2×），因为 gate 已经 sigmoid 后乘进了 attn 输出。

### 6.3.4 每层 Gated DeltaNet（18 层用）

DeltaNet 的投影：in_proj_qkv（Q+K+V 一起）、in_proj_z（门控）、in_proj_b（beta）、in_proj_a（alpha）、conv1d、norm、out_proj。加 dt_bias、A_log（每头 1 个）。

| 子模块 | 形状 | 参数量 |
|--------|------|--------|
| in_proj_qkv | (2×key_dim+value_dim, hidden) = (6144, 1024) | 6,291,456 |
| in_proj_z | (value_dim, hidden) = (2048, 1024) | 2,097,152 |
| in_proj_b | (num_v_heads, hidden) = (16, 1024) | 16,384 |
| in_proj_a | (num_v_heads, hidden) = (16, 1024) | 16,384 |
| conv1d | (conv_dim, 1, kernel) = (6144, 1, 4) | 24,576 |
| norm (RMSNormGated) | head_v_dim = 128 | 128 |
| out_proj | (hidden, value_dim) = (1024, 2048) | 2,097,152 |
| dt_bias + A_log | 2 × num_v_heads = 2×16 | 32 |

$$\text{DeltaNet（不含 MLP）} = 6{,}291{,}456 + 2{,}097{,}152 + 16{,}384 + 16{,}384 + 24{,}576 + 128 + 2{,}097{,}152 + 32 = 10{,}543{,}264$$

> key_dim = num_key_heads × key_head_dim = 16 × 128 = 2048；value_dim = 16 × 128 = 2048。in_proj_qkv 输出 = 2×key_dim + value_dim = 6144（Q 和 K 各 2048、V 2048）。conv1d 是 depthwise（groups=conv_dim），参数量 = conv_dim × 1 × kernel = 6144×1×4。

### 6.3.5 每层 RMSNorm

每层 2 个 RMSNorm（input_layernorm + post_attention_layernorm），各 hidden_size：

$$\text{层内 norm} = 2 \times 1024 = 2{,}048$$

### 6.3.6 汇总

每层总参数：

- **DeltaNet 层**（18 层）：10,543,264 (DeltaNet) + 11,010,048 (MLP) + 2,048 (norm) = **21,555,360**
- **GQA 层**（6 层）：7,340,544 (GQA) + 11,010,048 (MLP) + 2,048 (norm) = **18,352,640**

全局：

| 部分 | 计算 | 参数量 |
|------|------|--------|
| Embedding | 248320 × 1024 | 254,279,680 |
| 18 个 DeltaNet 层 | 18 × 21,555,360 | 387,996,480 |
| 6 个 GQA 层 | 6 × 18,352,640 | 110,115,840 |
| Final RMSNorm | 1 × 1024 | 1,024 |
| LM Head | (tie，0) | 0 |
| **总计** | | **752,393,024** |

### 6.3.7 代码验证

上面是手算推导。实际跑 `MiniQwenForCausalLM(MiniQwenConfig()).count_parameters()`：

```python
from miniqwen.model.config import MiniQwenConfig
from miniqwen.model.modeling_miniqwen import MiniQwenForCausalLM

model = MiniQwenForCausalLM(MiniQwenConfig())
info = model.count_parameters()
print(info)
# {'total': 752393024, 'trainable': 752393024, 'total_B': 0.752393024, ...}
```

**手算 752,393,024 = 代码 752,393,024** ✓ 完全对齐。

> 参数量分布：Embedding 占 254M（34%），24 层占 498M（66%），最终 norm 可忽略。Embedding 占比高是因为 vocab=248320 很大——这是大词表模型的常见特征。

## 6.4 DecoderLayer：组合组件

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/miniqwen/model/layer.py)：`DecoderLayer` 把"token mixer + FFN + 2个 norm"用 **Pre-Norm + 残差** 组合起来。

### 层类型选择

DecoderLayer 在 `__init__` 时按 `layer_types[layer_idx]` 选 mixer：

```python
class DecoderLayer(nn.Module):
    def __init__(self, config, layer_idx):
        self.layer_type = config.layer_types[layer_idx]   # "linear_attention" 或 "full_attention"
        if self.layer_type == "linear_attention":
            self.linear_attn = GatedDeltaNet(config, layer_idx)
        elif self.layer_type == "full_attention":
            self.self_attn = GQAAttention(config, layer_idx)
        self.mlp = SwiGLU(config.hidden_size, config.intermediate_size)
        self.input_layernorm = RMSNorm(config.hidden_size, eps=config.rms_norm_eps)
        self.post_attention_layernorm = RMSNorm(config.hidden_size, eps=config.rms_norm_eps)
```

> **两种层共享 FFN 和 norm**，只有 mixer 不同。这让混合布局的代码很简洁——`DecoderLayer` 不关心具体用哪种注意力，只按 `layer_type` 调度。

### 前向数据流

Pre-Norm 风格：先归一化再进 mixer/FFN，残差跨过整个子层：

<div style="text-align:center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; margin: 20px auto; max-width: 520px; color: #2c3e50;">

  <div style="font-weight: 500;">hidden_states <span style="color:#909399; font-size:13px;">(batch, seq, 1024)</span></div>
  <div style="color:#909399;">▼</div>

  <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
    <div style="border:1px solid #e6a23c; background:#fdf6ec; padding:8px 16px; border-radius:6px;">input_layernorm</div>
    <div style="color:#909399;">→</div>
    <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 16px; border-radius:6px; font-weight:500;">
      Token Mixer
      <div style="font-size:12px; color:#606266; font-weight:normal;">DeltaNet 或 GQA</div>
    </div>
  </div>

  <div style="color:#909399;">▼</div>
  <div style="display:inline-block; border:1px solid #f56c6c; background:#fef0f0; padding:6px 20px; border-radius:16px; color:#f56c6c;">⊕ 残差</div>
  <div style="color:#909399;">▼</div>

  <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
    <div style="border:1px solid #e6a23c; background:#fdf6ec; padding:8px 16px; border-radius:6px;">post_attn_layernorm</div>
    <div style="color:#909399;">→</div>
    <div style="border:1px solid #409eff; background:#ecf5ff; padding:8px 16px; border-radius:6px; font-weight:500;">
      SwiGLU FFN
    </div>
  </div>

  <div style="color:#909399;">▼</div>
  <div style="display:inline-block; border:1px solid #f56c6c; background:#fef0f0; padding:6px 20px; border-radius:16px; color:#f56c6c;">⊕ 残差</div>
  <div style="color:#909399;">▼</div>
  <div style="font-weight: 500;">hidden_states <span style="color:#909399; font-size:13px;">(batch, seq, 1024)</span></div>

</div>

**Pre-Norm 的好处**（第2章讲过）：残差直接加原始输入，梯度流顺畅，训练稳定，允许大学习率。Qwen3.5 选 Pre-Norm。

> 注意：`linear_attn`（DeltaNet）的 forward 不需要 `attention_mask` 和 `position_ids`（它用递归状态隐式建模位置），只有 `self_attn`（GQA）需要这两个参数。这是混合布局的一个细节——两种 mixer 的接口不完全相同。

## 6.5 MiniQwenModel：完整主体

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/miniqwen/model/modeling_miniqwen.py)：`MiniQwenModel` 是 embedding + 24 层 + final norm 的组合。

```python
class MiniQwenModel(nn.Module):
    def __init__(self, config):
        self.embed_tokens = nn.Embedding(config.vocab_size, config.hidden_size)
        self.layers = nn.ModuleList([
            DecoderLayer(config, layer_idx) for layer_idx in range(config.num_hidden_layers)
        ])
        self.norm = RMSNorm(config.hidden_size, eps=config.rms_norm_eps)

    def forward(self, input_ids, attention_mask=None):
        hidden_states = self.embed_tokens(input_ids)           # token → 向量
        causal_mask = self._make_causal_mask(seq_len, ...)      # 只给 GQA 层用
        position_ids = torch.arange(seq_len, ...)                # 只给 GQA 层用
        for layer in self.layers:
            hidden_states = layer(hidden_states, causal_mask, position_ids)
        hidden_states = self.norm(hidden_states)                 # 最终归一化
        return hidden_states
```

> `causal_mask` 和 `position_ids` 只被 6 个 GQA 层使用；DeltaNet 层忽略它们。`DecoderLayer.forward` 把这两个参数透传给 `self_attn`，`linear_attn` 不接。

## 6.6 MiniQwenForCausalLM：因果语言模型

`MiniQwenForCausalLM` 在 `MiniQwenModel` 基础上加 LM head 和训练/生成逻辑。

### LM Head 与权重绑定

```python
class MiniQwenForCausalLM(nn.Module):
    def __init__(self, config):
        self.model = MiniQwenModel(config)
        self.lm_head = nn.Linear(config.hidden_size, config.vocab_size, bias=False)
        if config.tie_word_embeddings:                          # tie
            self.lm_head.weight = self.model.embed_tokens.weight
```

`tie_word_embeddings=True` 时 lm_head 和 embed_tokens **共享同一份权重**——少 254M 参数（从 1.0B 降到 0.75B）。这是 Qwen3.5 0.8B 的选择（大模型通常不 tie，小模型 tie 省参数）。

### 训练：标签偏移

自回归训练用"前 n-1 个 token 预测后 n-1 个"：

```python
def forward(self, input_ids, labels=None):
    hidden_states = self.model(input_ids, attention_mask)
    logits = self.lm_head(hidden_states)                       # (batch, seq, vocab)
    if labels is not None:
        shift_logits = logits[:, :-1, :]                       # 去掉最后位置
        shift_labels = labels[:, 1:]                           # 去掉第一位置
        loss = F.cross_entropy(shift_logits.view(-1, vocab_size), shift_labels.view(-1),
                               ignore_index=-100)
    return {"loss": loss, "logits": logits}
```

```
input_ids: [BOS, t1, t2, t3, t4]
labels:    [t1,  t2, t3, t4, EOS]
                 ↑ shift 对齐 ↑
用 [BOS,t1,t2,t3] 预测 [t1,t2,t3,t4]
```

### 推理：自回归生成

`generate` 方法逐 token 采样：每步取最后位置 logits → top-p 采样 → 拼回 input_ids → 下一步。

```python
def generate(self, input_ids, max_new_tokens=200, temperature=0.7, top_p=0.9):
    for _ in range(max_new_tokens):
        logits = self.forward(input_ids)["logits"][:, -1, :] / temperature
        # ... top-p 过滤 ...
        next_token = torch.multinomial(probs, num_samples=1)
        input_ids = torch.cat([input_ids, next_token], dim=-1)
        if next_token.item() == eos_token_id: break
    return input_ids
```

**Top-p（核采样）**：保留累积概率达到 p 的最高概率 token，其余设为 -inf。比 greedy 多样性，比全采样可控。

## 6.7 与官方 Qwen3.5 的对比

| 特性 | 官方 Qwen3.5 | MiniQwen |
|------|-------------|----------|
| 参数量 | 0.6B ~ 72B | **0.752B** |
| 层数 | 28 (0.6B) ~ 80 (72B) | 24 |
| hidden_size | 1024 (0.6B) ~ 8192 (72B) | 1024 |
| 实现语言 | Python + C++ (CUDA/Triton) | 纯 Python |
| 推理优化 | Flash Attention, PagedAttention | 无 |
| 训练框架 | 自研 | PyTorch 原生 |

**MiniQwen 的定位**：学习和理解 Qwen3.5 架构，而非生产使用。架构（GQA+DeltaNet 混合、Partial RoPE、Sigmoid Gate、零初始化 RMSNorm）和官方对齐，但工程优化全部去掉。

## 6.8 总结

| 组件 | 选择 | 在 MiniQwen 中的位置 | 详见 |
|------|------|---------------------|------|
| FFN | SwiGLU | 每层的 `self.mlp` | 第1章 |
| 归一化 | RMSNorm（零初始化） | 每层 2 个 + 最终 1 个 | 第2章 |
| 位置编码 | Partial RoPE | GQA 层的 `rotary_emb` | 第3章 |
| 全注意力 | GQA + Sigmoid Gate | 6 个全注意力层的 `self.self_attn` | 第4章 |
| 线性注意力 | Gated DeltaNet | 18 个线性层的 `self.linear_attn` | 第5章 |
| 层布局 | 3:1 混合 | `full_attention_interval=4` | 本章 |
| 权重绑定 | lm_head = embed | `tie_word_embeddings=True` | 本章 |

**本章只讲"组装"**：组件细节回看 1-5 章，配置和参数量见 6.2-6.3，数据流见 6.4-6.5。MiniQwen 0.8B 总参数 752,393,024，手算和代码完全对齐。

---

**上一章**：[5. 线性注意力](./05-线性注意力.md) | **下一章**：[7. 预训练（选读）](./7_预训练（选读）.md)
