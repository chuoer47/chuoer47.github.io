---
title: 1. MLP（前馈网络）
order: 1
---

# 1. MLP（前馈网络）

## 概述

前馈网络（Feed-Forward Network, FFN）是 Transformer 中每个层的核心组件之一，位于注意力机制之后。它的作用是对每个 token 的表示进行非线性变换，增强模型的表达能力。

本章将介绍常用的 FFN ，然后再介绍 Qwen3.5 使用的：

```
FFN_ReLU → FFN_GeLU → FFN_SwiGLU (Qwen3.5 采用)
```

## 1.1 FFN_ReLU：最原始的前馈网络

### 原理

最简单的 FFN 由两个线性变换和一个 ReLU 激活函数组成：

$$\text{FFN}(x) = \text{ReLU}( x \cdot W_1 + b_1) \cdot W_2 + b_2$$

其中：
- $x \in \mathbb{R}^{1 \times d_{mode}}$：行向量
- $W_1 \in \mathbb{R}^{d_{model} \times d_{ff}}$：上投影矩阵，将维度从 $d_{model}$ 扩展到 $d_{ff}$
- $W_2 \in \mathbb{R}^{d_{ff} \times d_{model}}$：下投影矩阵，将维度从 $d_{ff}$ 压缩回 $d_{model}$
- $d_{ff}$：中间层维度，通常为 $4 \times d_{model}$（经典设置）
- ReLU：激活函数，$\text{ReLU}(x) = \max(0, x)$

其实 FFN 的基础框架简单明了，但是改进点非常多，常见的有：激活函数类型、公式表达

### 代码实现

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/reference/basic/FFN/FFN_ReLU.py)

```python
import torch
import torch.nn as nn


class FFN_ReLU(nn.Module):
    def __init__(self, d_model, d_ff=None, dropout=0.):
        super().__init__()
        if d_ff is None:
            d_ff = 4 * d_model
        self.linear1 = nn.Linear(d_model, d_ff)
        self.linear2 = nn.Linear(d_ff, d_model)
        self.dropout = nn.Dropout(p=dropout)
        self.relu = nn.ReLU()

    def forward(self, x):
        x = self.linear1(x)     
        x = self.relu(x)        
        x = self.dropout(x)    
        x = self.linear2(x)     
        return x
```

### ReLU 的局限性

ReLU 激活函数虽然简单高效，但存在以下问题：

1. **Dead ReLU 问题**：当输入为负值时，ReLU 输出恒为 0，梯度也为 0，导致该神经元永远不会被更新
2. **非平滑**：在 x=0 处不可导，可能影响优化
3. **输出非零中心化**：ReLU 的输出总是非负的，可能导致后续层的输入分布偏移

## 1.2 FFN_GeLU：平滑激活函数

### 原理

GeLU（Gaussian Error Linear Unit）是一种平滑的激活函数，由 Google 在 2016 年提出：

$$\text{GeLU}(x) = x \cdot \Phi(x) \approx x \cdot \sigma(1.702x)$$

其中 $\Phi(x)$ 是标准正态分布的累积分布函数（CDF）。

**直觉理解**：GeLU 可以看作是一种"概率门控"——输入值越大，被保留的概率越高；输入值越小（负值），被抑制的概率越高。与 ReLU 的"硬截断"不同，GeLU 是"软衰减"。

### 代码实现
[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/reference/basic/FFN/FFN_GeLU.py)

```python
class FFN_GELU(nn.Module):
    def __init__(self, d_model, d_ff=None, dropout=0.):
        super().__init__()
        if d_ff is None:
            d_ff = 4 * d_model
        self.linear1 = nn.Linear(d_model, d_ff)
        self.linear2 = nn.Linear(d_ff, d_model)
        self.dropout = nn.Dropout(p=dropout)
        self.gelu = nn.GELU()

    def forward(self, x):
        x = self.linear1(x)      # (batch, seq_len, d_ff)
        x = self.gelu(x)         # (batch, seq_len, d_ff)
        x = self.dropout(x)      # (batch, seq_len, d_ff)
        x = self.linear2(x)      # (batch, seq_len, d_model)
        return x
```

### GeLU vs ReLU

| 特性 | ReLU | GeLU |
|------|------|------|
| 负值处理 | 硬截断为 0 | 软衰减（接近0但不等于0） |
| 平滑性 | 在 x=0 处不可导 | 处处可导 |
| 梯度 | 负值区域梯度为 0 | 负值区域仍有微小梯度 |
| 计算开销 | 极低 | 稍高 |
| 代表模型 | BERT, GPT-2 | GPT-3, LLaMA |

## 1.3 FFN_SwiGLU：门控前馈网络（Qwen3.5 采用）

### 原理

SwiGLU（Swish-Gated Linear Unit）是目前大语言模型中最流行的 FFN 变体，由 Noam Shazeer 在 2020 年提出。它的核心思想是引入**门控机制**：

$$\text{SwiGLU}(x) = \text{Swish}(xW_{gate}) \odot (xW_{up})$$

$$\text{FFN}_{SwiGLU}(x) = \text{SwiGLU}(x) \cdot W_{down}= (\text{Swish}(xW_{gate}) \odot (xW_{up})) \cdot W_{down}$$

其中：
- $W_{gate} \in \mathbb{R}^{d_{model} \times d_{ff}}$：门控投影（生成门控信号）
- $W_{up} \in \mathbb{R}^{d_{model} \times d_{ff}}$：上投影（生成隐藏表示）
- $W_{down} \in \mathbb{R}^{d_{ff} \times d_{model}}$：下投影（压缩回模型维度）
- $\odot$：逐元素相乘（门控操作）
- Swish：$\text{Swish}(x) = x \cdot \sigma(\beta x)$，其中 $\sigma$ 是 sigmoid 函数

**直觉理解**：
- 传统 FFN 只有一个信息通路：$x \to W_1 \to \text{ReLU} \to W_2$
- SwiGLU 有两条通路：
  - **门控通路**：$x \to W_{gate} \to \text{Swish}$ → 生成"哪些信息重要"的信号
  - **值通路**：$x \to W_{up}$ → 生成"实际内容"
  - 两条通路逐元素相乘，门控信号筛选重要信息

### 代码实现

#### basic 版本
[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/reference/basic/FFN/FFN_SwiGLU.py)
```python
import torch
import torch.nn as nn

class FFN_SwiGLU(nn.Module):
    def __init__(self, model_dim, ff_hidden_dim=None, dropout_prob=0.):
        super().__init__()
        # 业界标准：8/3 倍维度对齐参数量，对齐到8的倍数适配硬件加速
        if ff_hidden_dim is None:
            ff_hidden_dim = int(8 / 3 * model_dim)
            ff_hidden_dim = ff_hidden_dim + (8 - ff_hidden_dim % 8) % 8
        
        self.gate_proj = nn.Linear(model_dim, ff_hidden_dim, bias=False)   # 门控支路
        self.value_proj = nn.Linear(model_dim, ff_hidden_dim, bias=False)  # 值支路
        self.output_proj = nn.Linear(ff_hidden_dim, model_dim, bias=False) # 输出投影
        self.swish_beta = nn.Parameter(torch.ones(1))  # 可学习的 Swish beta 参数
        self.dropout = nn.Dropout(dropout_prob)
    
    def swish_activation(self, x: torch.Tensor) -> torch.Tensor:
        """带可学习 beta 的 Swish: x * sigmoid(beta * x)"""
        return x * torch.sigmoid(self.swish_beta * x)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, model_dim)
        gate = self.swish_activation(self.gate_proj(x))  # 门控路：带可学习 beta 的 Swish 激活
        value = self.value_proj(x)        # 值路：线性变换
        hidden = gate * value             # 逐元素门控相乘
        output = self.output_proj(hidden)
        output = self.dropout(output)     # 输出前加 dropout，对齐 Transformer 原设计
        return output
```

#### miniqwen 版本（与 Qwen3.5 对齐）
[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/miniqwen/model/mlp.py)
```python
import torch.nn.functional as F

class SwiGLU(nn.Module):
    """
    SwiGLU 前馈网络
    参考 transformers/models/qwen3_5/modeling_qwen3_5.py L720-733

    公式: down_proj(silu(gate_proj(x)) * up_proj(x))
    """

    def __init__(self, hidden_size: int, intermediate_size: int):
        super().__init__()
        self.gate_proj = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.up_proj = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.down_proj = nn.Linear(intermediate_size, hidden_size, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))
```

**注意**：Qwen3.5 的 SwiGLU 实现与 basic 版本的区别：
1. **直接用 F.silu**：PyTorch 内置的 SiLU（Swish 的特例，beta=1），而非自定义带可学习 beta 的版本
2. **代码/公式更简洁**

### SwiGLU 的三个线性层

**参数量对比**：

| FFN 类型 | 线性层 | 参数量 |
|----------|--------|--------|
| FFN_ReLU | 2 个 | $2 \times d_{model} \times d_{ff}$ |
| FFN_SwiGLU | 3 个 | $3 \times d_{model} \times d_{ff}$ |

SwiGLU 多了一个线性层，所以为了保持总参数量不变，通常会把 $d_{ff}$ 从 $4d_{model}$ 缩小到 $\frac{8}{3}d_{model}$。Qwen3.5 配置中 `hidden_size=1024, intermediate_size=3584`，比例约为 3.5。

## 1.4 MoE 前馈网络（扩展阅读）

### 为什么需要 MoE？

随着模型规模的增长，一个核心矛盾日益突出：**更大的模型能力更强，但计算成本也更高**。MoE（Mixture of Experts，混合专家）提供了一种解决思路——**条件计算**（Conditional Computation）：

| 方案 | 参数量 | 每个 token 的计算量 | 思路 |
|------|--------|-------------------|------|
| 标准 Dense 模型 | $P$ | $P$ | 所有参数都参与计算 |
| MoE 模型 | $N \times P$ | $\frac{K}{N} \times P$ | 只激活 Top-K 个专家 |

**直觉理解**：
- Dense 模型像一个"全能型员工"，什么都会但精力有限
- MoE 模型像一个"专家团队"，每个 token 只找最擅长的 K 个专家处理
- 结果：**参数量大（能力强），但推理运算时激活参数小，计算量小（效率高）**

### MoE 的发展历史

| 年份 | 模型 | 关键创新 |
|------|------|---------|
| 2017 | Shazeer et al. | 首次将 MoE 引入 LSTM 语言模型 |
| 2021 | **Switch Transformer** | Top-1 路由，简化辅助损失 |
| 2022 | Mixtral 8×7B | 开源 MoE 大模型，证明 MoE 的实用性 |
| 2024 | **DeepSeek-V2** | 共享专家 + 细粒度专家 + 无辅助损失负载均衡 |
| 2024 | Qwen3.5 0.8B | 使用 Dense 模型 + 线性注意力（非 MoE） |

> **注意**：Qwen3.5 0.8B 本身**不使用 MoE**，而是用 Dense 模型 + 混合注意力。但 MoE 在 Qwen3.5 的其他系列里面使用了。

### 示意图

<div style="text-align:center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2c3e50; line-height: 1.8; margin: 20px auto; max-width: 720px;">
  <!-- 输入 -->
  <div style="font-weight: 500;">输入 x</div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <!-- MoE 门控模块 -->
  <div style="display:inline-block; border:1px solid #409eff; background:#ecf5ff; padding:10px 24px; border-radius:6px; font-weight:500;">
    MoEGate
    <div style="font-size:12px; color:#606266; font-weight:normal; margin-top:2px;">选择 Top-K 个专家，输出索引与权重</div>
  </div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <!-- 并行专家支路 -->
  <table style="width:100%; border-collapse: collapse; margin: 8px 0;">
    <tr>
      <td style="text-align:center; padding:0 6px;">
        <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 12px; border-radius:6px; display:inline-block; font-size:14px;">Expert 0 (FFN)</div>
        <div style="margin-top:6px; font-size:14px;">× weight_0</div>
      </td>
      <td style="text-align:center; padding:0 6px;">
        <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 12px; border-radius:6px; display:inline-block; font-size:14px;">Expert 1 (FFN)</div>
        <div style="margin-top:6px; font-size:14px;">× weight_1</div>
      </td>
      <td style="text-align:center; padding:0 6px;">
        <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 12px; border-radius:6px; display:inline-block; font-size:14px;">Expert 2 (FFN)</div>
        <div style="margin-top:6px; font-size:14px;">× weight_2</div>
      </td>
      <td style="text-align:center; padding:0 6px;">
        <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 12px; border-radius:6px; display:inline-block; font-size:14px;">Expert 3 (FFN)</div>
        <div style="margin-top:6px; font-size:14px;">× weight_3</div>
      </td>
      <td style="text-align:center; padding:0 6px;">
        <div style="border:1px solid #67c23a; background:#f0f9eb; padding:8px 12px; border-radius:6px; display:inline-block; font-size:14px;">Expert 4 (FFN)</div>
        <div style="margin-top:6px; font-size:14px;">× weight_4</div>
      </td>
    </tr>
  </table>

  <!-- 汇总求和 -->
  <div style="color:#909399; margin: 4px 0;">▼</div>
  <div style="display:inline-block; border:1px solid #e6a23c; background:#fdf6ec; padding:10px 24px; border-radius:6px; font-weight:500;">
    加权求和
  </div>
  <div style="color:#909399; margin: 4px 0;">▼</div>

  <!-- 输出 -->
  <div style="font-weight: 500;">输出</div>
</div>

### MoEGate 门控机制详解

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/reference/basic/MoE/MoEGate.py)：参考minimind实现

门控网络（Router）是 MoE 的核心，它决定了每个 token 被分配给哪些专家。整个流程分为 3 步：

#### 步骤 1：计算专家得分

```python
# 输入: hidden_states (batch, seq_len, hidden_size)
hidden_states = hidden_states.view(-1, hidden_states.shape[-1])  # (batch*seq, hidden)

# 线性变换得到每个专家的 logits
logits = F.linear(hidden_states, self.weight)  # (batch*seq, n_experts)

# Softmax 归一化得到概率分布
scores = logits.softmax(dim=-1)                # (batch*seq, n_experts)
```

**图解**：
```
token_0: [0.1, 0.2, 0.3, 0.4]  → 专家 3 得分最高
token_1: [0.4, 0.3, 0.2, 0.1]  → 专家 0 得分最高
token_2: [0.25, 0.25, 0.25, 0.25] → 均匀分布，难以选择
```

#### 步骤 2：Top-K 选取

```python
# 选择得分最高的 K 个专家 (如 K=2)
topk_weight, topk_idx = torch.topk(scores, k=self.topk, dim=-1)
# topk_weight: (batch*seq, K)  → 选中的专家得分
# topk_idx:    (batch*seq, K)  → 选中的专家索引
```

**图解**（K=2）：
```
token_0: scores=[0.1, 0.2, 0.3, 0.4]
  → topk_idx=[3, 2], topk_weight=[0.4, 0.3]

token_1: scores=[0.4, 0.3, 0.2, 0.1]
  → topk_idx=[0, 1], topk_weight=[0.4, 0.3]
```

#### 步骤 3：权重归一化

```python
# 将 Top-K 权重归一化，使其和为 1
if self.topk > 1 and self.norm_topk_prob:
    denominator = topk_weight.sum(dim=-1, keepdims=True) + 1e-20
    topk_weight = topk_weight / denominator
```

**图解**：
```
token_0: topk_weight=[0.4, 0.3]
  → 归一化: [0.4/0.7, 0.3/0.7] = [0.571, 0.429]
```

#### 完整门控代码

```python
class MoEGate(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.topk = config.num_experts_per_tok  # 每个 token 选择的专家数 (如 2)
        self.n_routed_experts = config.n_routed_experts  # 总专家数 (如 4)
        self.norm_topk_prob = config.norm_topk_prob  # 是否归一化 Top-K 权重
        self.weight = nn.Parameter(torch.empty((self.n_routed_experts, config.hidden_size)))

    def forward(self, hidden_states):
        # hidden_states: (batch, seq_len, hidden_size)
        hidden_states = hidden_states.view(-1, hidden_states.shape[-1])  # (batch*seq, hidden)

        # 1. 计算专家得分
        logits = F.linear(hidden_states, self.weight)  # (batch*seq, n_experts)
        scores = logits.softmax(dim=-1)                # (batch*seq, n_experts)

        # 2. Top-K 选取
        topk_weight, topk_idx = torch.topk(scores, k=self.topk, dim=-1)

        # 3. 权重归一化
        if self.topk > 1 and self.norm_topk_prob:
            denominator = topk_weight.sum(dim=-1, keepdims=True) + 1e-20
            topk_weight = topk_weight / denominator

        # 4. 计算辅助损失（见下文详解）
        aux_loss = self._compute_aux_loss(scores, topk_idx, ...)

        return topk_idx, topk_weight, aux_loss
```

### 辅助损失（aux_loss）详解

#### 为什么需要辅助损失？

MoE 训练时会出现**专家坍缩**（Expert Collapse）问题：

```
训练初期:
  Expert 0: 处理 10% 的 token
  Expert 1: 处理 10% 的 token
  Expert 2: 处理 10% 的 token
  Expert 3: 处理 70% 的 token  ← 看似正常

训练后期（无辅助损失）:
  Expert 0: 处理 0% 的 token   ← 完全闲置！
  Expert 1: 处理 0% 的 token   ← 完全闲置！
  Expert 2: 处理 0% 的 token   ← 完全闲置！
  Expert 3: 处理 100% 的 token ← 所有 token 都选它
```

**原因**：一旦某个专家稍微"好一点"，就会被更多 token 选中 → 得到更多训练 → 变得更好 → 被更多 token 选中 → 正反馈循环。

**解决方案**：引入辅助损失，惩罚专家负载不均衡。

#### 辅助损失的数学公式

Switch Transformer (2021) 提出的经典公式：

$$\mathcal{L}_{aux} = \alpha \cdot N \cdot \sum_{i=1}^{N} f_i \cdot P_i$$

其中：
- $N$：专家总数
- $f_i$：专家 $i$ 被选中的频率（有多少比例的 token 选了它）
- $P_i$：专家 $i$ 的平均得分（所有 token 对它的 softmax 值取平均）
- $\alpha$：辅助损失权重（通常 0.01）

**直觉理解**：
- 如果某个专家被选得很频繁（$f_i$ 大），但得分不高（$P_i$ 小）→ 损失小（合理）
- 如果某个专家被选得很频繁（$f_i$ 大），得分也很高（$P_i$ 大）→ 损失大（惩罚！）

#### 两种计算模式：seq_aux

代码中提供了两种计算辅助损失的方式，由 `seq_aux` 参数控制：

| 模式 | seq_aux=True | seq_aux=False |
|------|-------------|---------------|
| 统计粒度 | 按 batch 拆分，batch 内独立统计 | 跨 batch/序列全局统计 |
| 归一化方式 | 按 batch 的 `seq_len×topk` 归一化 | 全局均值后按专家数缩放 |
| 损失聚合 | 先 batch 内求和，再取 batch 均值 | 全局直接求和 |
| 核心特点 | 关注单个样本内的序列级均衡 | 关注所有样本的全局均衡 |

#### seq_aux=True 的计算示例

以 `batch_size=2, seq_len=3, n_experts=4, topk=2` 为例：

**步骤 1：准备数据**

```python
# 专家得分 (6 个 token × 4 个专家)
scores = [
    [0.1, 0.2, 0.3, 0.4],  # token_0
    [0.2, 0.3, 0.4, 0.1],  # token_1
    [0.3, 0.4, 0.1, 0.2],  # token_2
    [0.4, 0.1, 0.2, 0.3],  # token_3
    [0.1, 0.4, 0.2, 0.3],  # token_4
    [0.2, 0.1, 0.4, 0.3],  # token_5
]

# Top-K 专家索引 (K=2)
topk_idx = [
    [3, 2],  # token_0 选了专家 3 和 2
    [2, 1],  # token_1 选了专家 2 和 1
    [1, 0],  # token_2 选了专家 1 和 0
    [0, 3],  # token_3 选了专家 0 和 3
    [1, 3],  # token_4 选了专家 1 和 3
    [2, 3],  # token_5 选了专家 2 和 3
]
```

**步骤 2：统计每个 batch 内各专家被选中的次数**

```python
# batch_0 (token_0,1,2): 选中的专家是 [3,2, 2,1, 1,0]
# → 专家 0: 1次, 专家 1: 2次, 专家 2: 2次, 专家 3: 1次
ce_batch0 = [1, 2, 2, 1]

# batch_1 (token_3,4,5): 选中的专家是 [0,3, 1,3, 2,3]
# → 专家 0: 1次, 专家 1: 1次, 专家 2: 1次, 专家 3: 3次
ce_batch1 = [1, 1, 1, 3]
```

**步骤 3：归一化选中次数**

```python
# 期望每个专家被选中的次数 = seq_len × topk / n_experts = 3×2/4 = 1.5
ce_batch0 = [1/1.5, 2/1.5, 2/1.5, 1/1.5] = [0.667, 1.333, 1.333, 0.667]
ce_batch1 = [1/1.5, 1/1.5, 1/1.5, 3/1.5] = [0.667, 0.667, 0.667, 2.0]
```

**步骤 4：计算每个 batch 的序列平均得分**

```python
# batch_0 的平均得分
scores_mean_batch0 = [0.2, 0.3, 0.267, 0.233]

# batch_1 的平均得分
scores_mean_batch1 = [0.233, 0.2, 0.267, 0.3]
```

**步骤 5：计算最终 aux_loss**

```python
# batch_0: sum(ce × scores_mean) = 0.667×0.2 + 1.333×0.3 + 1.333×0.267 + 0.667×0.233 = 1.045
# batch_1: sum(ce × scores_mean) = 0.667×0.233 + 0.667×0.2 + 0.667×0.267 + 2.0×0.3 = 1.067

# aux_loss = alpha × mean(batch_losses) = 0.01 × (1.045 + 1.067) / 2 ≈ 0.0106
```

#### seq_aux=False 的计算示例

```python
# 1. 全局统计选中频率 (one-hot 编码后取均值)
# 所有选中的专家: [3,2,2,1,1,0,0,3,1,3,2,3]
# one-hot 后取均值: f = [0.167, 0.25, 0.25, 0.333]

# 2. 全局平均得分
# P = mean(all scores) = [0.217, 0.25, 0.267, 0.267]

# 3. 频率缩放
# fi = f × n_experts = [0.667, 1.0, 1.0, 1.333]

# 4. 最终损失
# aux_loss = alpha × sum(P × fi) = 0.01 × 1.017 ≈ 0.0102
```

### MoEFeedForward：完整的 MoE 层

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/reference/basic/MoE/MoEFeedForward.py)

MoEGate 只负责"选专家"，完整的 MoE 层还需要"执行专家 + 聚合结果"：

```python
class MOEFeedForward(nn.Module):
    """混合专家前馈层"""

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 1. 创建 N 个独立的 FFN 专家
        self.experts = nn.ModuleList([
            FeedForward(config) for _ in range(config.n_routed_experts)
        ])

        # 2. 创建门控模块
        self.gate = MoEGate(config)

        # 3. 可选：共享专家（所有 token 都会经过）
        if config.n_shared_experts > 0:
            self.shared_experts = nn.ModuleList([
                FeedForward(config) for _ in range(config.n_shared_experts)
            ])

    def forward(self, x):
        # x: (batch, seq_len, hidden_size)

        # 1. 门控选择专家
        topk_idx, topk_weight, aux_loss = self.gate(x)

        # 2. 展平输入
        x_flat = x.view(-1, x.shape[-1])  # (batch*seq, hidden)
        flat_topk_idx = topk_idx.view(-1)  # (batch*seq*topk)

        # 3. 训练模式：逐专家处理
        if self.training:
            # 每个 token 复制 K 次（因为要分给 K 个专家）
            x_flat = x_flat.repeat_interleave(self.config.num_experts_per_tok, dim=0)
            y = torch.empty_like(x_flat)

            for i, expert in enumerate(self.experts):
                # 找出分配给专家 i 的 token
                mask = (flat_topk_idx == i)
                if mask.any():
                    y[mask] = expert(x_flat[mask])

            # 4. 加权聚合
            y = y.view(*topk_weight.shape, -1) * topk_weight.unsqueeze(-1)
            y = y.sum(dim=1).view(*x.shape)

        # 5. 可选：加上共享专家的输出
        if self.config.n_shared_experts > 0:
            for expert in self.shared_experts:
                y = y + expert(x)

        self.aux_loss = aux_loss
        return y
```

#### 训练 vs 推理的差异

| | 训练模式 | 推理模式 |
|---|---------|---------|
| 处理方式 | 逐专家批量处理 | 排序 + 批量处理 + scatter_add |
| 原因 | 需要梯度回传 | 不需要梯度，追求效率 |
| 内存 | 较高（token 复制 K 次） | 较低（无复制） |

### MoE 的发展：从 Switch Transformer 到 DeepSeek

#### Switch Transformer (Google, 2021)

**创新**：简化 MoE，每个 token 只选 1 个专家（Top-1 路由）。

$$\text{Switch}(x) = \text{softmax}(x \cdot W_{gate})_i \cdot \text{Expert}_i(x)$$

**优点**：实现简单，通信开销小。
**缺点**：表达能力受限（只用一个专家）。

#### DeepSeek-MoE (2024)

DeepSeek 提出了三个关键创新：

**1. 共享专家（Shared Experts）**

```
传统 MoE:
  token → Gate → Expert_2 → 输出

DeepSeek MoE:
  token → Gate → Expert_2 ────────→ 加权求和 → 输出
       └────→ Shared_Expert_0 ──┘
       └────→ Shared_Expert_1 ──┘
```

共享专家处理**所有 token**，捕获通用知识；路由专家处理特定 token，捕获专业知识。

**2. 细粒度专家分割（Fine-Grained Experts）**

```
传统: 8 个大专家，每个 token 选 2 个
DeepSeek: 64 个小专家，每个 token 选 8 个
```

更细粒度的专家 → 更灵活的组合 → 更好的表达能力。

**3. 无辅助损失负载均衡（Auxiliary-Loss-Free Load Balancing）**

传统方法用辅助损失惩罚负载不均衡，但这会干扰主训练目标。DeepSeek-V3 提出用**偏置项**替代辅助损失：

```python
# 传统: scores = softmax(logits)
# DeepSeek-V3: scores = softmax(logits + bias)
# 其中 bias 根据专家负载动态调整，不参与梯度计算
```

#### DeepSeek-MoE vs 传统 MoE

| 特性 | 传统 MoE | DeepSeek-MoE |
|------|---------|--------------|
| 专家数量 | 少量大专家 (如 8) | 大量小专家 (如 64) |
| 共享专家 | 无 | 有 (2 个) |
| 负载均衡 | 辅助损失 | 无辅助损失 (偏置项) |
| 每 token 激活 | Top-2 | Top-6 + 2 共享 |
| 代表模型 | Switch, Mixtral | DeepSeek-V2/V3 |

---

**上一章**：[0. 前言](./00-前言.md) | **下一章**：[2. 归一化层](./02-归一化层.md)
