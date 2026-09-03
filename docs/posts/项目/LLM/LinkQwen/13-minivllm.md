---
title: 13. 推理加速（三）：minivllm — 适配 MiniQwen 混合架构
order: 13
---

# 13. 推理加速（三）：minivllm — 适配 MiniQwen 混合架构

## 13.1 背景与动机

上一章我们实现了完整的 nano-vllm 推理引擎，但它只支持 Qwen3（纯 GQA 注意力架构）。我们的 MiniQwen 是 Qwen3.5 架构，采用了一种更复杂的**混合架构**：

```
Qwen3:    GQA | GQA | GQA | GQA | ... | GQA     （24 层全 GQA）
MiniQwen: DN  | DN  | DN  | GQA | DN  | DN  | ... （18 层 DeltaNet + 6 层 GQA）
```

每 4 层中 3 层用 **Gated DeltaNet**（线性注意力），1 层用 **GQA**（全注意力）。这种混合设计在理论上结合了线性注意力的高效和全注意力的表达能力，但也给推理引擎带来了全新的工程挑战。

本章讲解如何将 nano-vllm 改造为 **minivllm**，适配这一混合架构，并通过 FLA 算子库、CUDA Graph、Prefix Cache 显著提升 decode 吞吐。

> 具体内容可见：[5. 线性注意力](./05-线性注意力.md)

### 架构对比

```
nano-vllm                              minivllm
─────────────────────────────────────────────────────────
模型层: Qwen3ForCausalLM              MiniQwenForCausalLM
  └─ 24 层 GQA                          └─ 18 层 GatedDeltaNet
  └─ 每层有 KV Cache                    └─ 6 层 GQA + KV Cache

权重加载: q_proj→qkv_proj (融合)        linear_attn→mixer, gate+up→gate_up

RMSNorm:  output = weight × norm(x)    output = (1+weight) × norm(x)
```

## 13.2 适配总览

适配 nano-vllm 到 MiniQwen 混合架构，不只是把模型类替换掉，而是要同时处理缓存形态、线性注意力状态、权重命名、训练/推理公式一致性和调度器生命周期。本章按**从简到难**的顺序讲解：

| 节 | 改动 | 难度 | 核心问题 |
|----|------|------|----------|
| 13.3 | 权重名称映射 | 简单 | 训练 checkpoint 和推理模型模块名不同 |
| 13.3 | RMSNorm 公式修正 | 简单 | Qwen3.5 用零初始化 `(1+weight)` |
| 13.3 | RoPE theta 一致性 | 简单 | config 缺省值回退训练默认 10000.0 |
| 13.3 | KV Cache 选择性分配 | 简单 | 只有 6 层 GQA 需要，18 层 DeltaNet 不需要 |
| 13.4 | DeltaNet 推理实现 | **核心** | 从头写线性注意力 + FLA 集成 |
| 13.5 | Conv1d Decode Cache | 中等 | DeltaNet decode 必须缓存 pre-conv QKV |
| 13.6 | CUDA Graph 加速 | 中等 | 预分配 buffer + 稳定 state_slot |
| 13.7 | Prefix Cache 混合实现 | **最难** | 同时恢复 GQA KV 和每层 DeltaNet state |
| 13.8 | 性能数字 | — | 代表性吞吐结果 |

## 13.3 简单适配（四个快速修正）

本节的四个改动都是"配置/公式层面"的小修正，建立信心后再进入核心的 DeltaNet 实现。

### 13.3.1 权重名称映射

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/models/miniqwen.py) + [utils/loader.py](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/utils/loader.py)

checkpoint 和模型的模块名不一致：

```
checkpoint (weight_adapter 生成):         minivllm模型 (miniqwen.py):
model.layers.0.linear_attn.in_proj_qkv  → model.layers.0.mixer.in_proj_qkv
model.layers.3.self_attn.q_proj         → model.layers.3.mixer.q_proj
model.layers.0.mlp.gate_proj            → model.layers.0.mlp.gate_up_proj (融合)
model.layers.0.mlp.up_proj              → model.layers.0.mlp.gate_up_proj (融合)
```

```python
class MiniQwenForCausalLM(nn.Module):
    packed_modules_mapping = {
        "linear_attn": ("mixer", None),    # DeltaNet 层名映射
        "self_attn": ("mixer", None),       # GQA 层名映射
        "gate_proj": ("gate_up_proj", 0),   # MLP gate → 融合层 shard 0
        "up_proj": ("gate_up_proj", 1),     # MLP up → 融合层 shard 1
    }
```

**loader 的分段匹配**：如果 loader 用子串匹配（`k in weight_name`），语义上不安全：

```python
# 危险的是更长字段里包含 up_proj，例如已融合模型名 gate_up_proj
"up_proj" in "model.layers.0.mlp.gate_up_proj.weight"  # → True
```

修复为**按 `.` 分段匹配**（`k in segments`），只处理完整模块段。

### 13.3.2 RMSNorm 公式修正

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/layers/layernorm.py)

Qwen3.5 的 RMSNorm 使用**零初始化** + `(1+weight)` 公式：

```python
# nano-vllm: 一初始化
class RMSNorm(nn.Module):
    def __init__(self, dim):
        self.weight = nn.Parameter(torch.ones(dim))    # 一初始化
    def forward(self, x):
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps) * self.weight  # w 公式

# minivllm: 零初始化 + (1+w) 公式（对齐 Qwen3.5）
class RMSNorm(nn.Module):
    def __init__(self, hidden_size, eps=1e-6):
        self.weight = nn.Parameter(torch.zeros(hidden_size))  # 零初始化！
    def forward(self, x):
        ...
        x = x * (1.0 + self.weight.float())  # (1+w) 公式
        return x.to(orig_dtype)
```

checkpoint 中的权重是按 `(1+weight)` 公式训练的，如果用 `weight` 公式加载，输出完全不同。

> **注意**：移除了 `@torch.compile` 装饰器和原地操作（`mul_`, `add_`），因为在 `torch.inference_mode()` 下会触发 autograd 错误。

### 13.3.3 RoPE theta 配置一致性

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/models/miniqwen.py)

MiniQwen 训练侧的 RoPE 默认值是 `theta=10000.0`。minivllm 推理侧如果在 config 缺少 `rope_theta` 时回退到 `1000000`，GQA 层的位置编码会和训练不一致。

```python
def get_rope_theta(config) -> float:
    configs = [config]
    text_config = getattr(config, "text_config", None)
    if text_config is not None:
        configs.append(text_config)
    for cfg in configs:
        # 优先读显式配置
        ...
    return 10000.0  # 最后回退到训练默认值
```

推理侧要优先读取显式配置，最后才回退到训练默认值 `10000.0`。

### 13.3.4 KV Cache 选择性分配

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/engine/model_runner.py)

nano-vllm 为每一层都分配 KV Cache，MiniQwen 只有 6 层 GQA 需要——给所有层分配会浪费 75% 显存。

```python
def allocate_kv_cache(self):
    num_attn_layers = len(self.attn_layers)   # isinstance 收集，只有 GQA 层

    # 先预留 CUDA Graph + DeltaNet graph state，再分 KV cache
    graph_reserve = 0
    if not self.enforce_eager:
        graph_reserve = 2 * 1024**3                       # graph 捕获开销约 2GB
        graph_reserve += self.deltanet_states.reserve_bytes()  # DeltaNet 缓冲预算

    block_bytes = 2 * num_attn_layers * block_size * num_kv_heads * head_dim * dtype.itemsize
    config.num_kvcache_blocks = int(
        total * gpu_memory_utilization - used - peak + current - graph_reserve
    ) // block_bytes

    self.kv_cache = torch.empty(2, num_attn_layers, num_blocks, block_size, num_kv_heads, head_dim)
    for layer_id, module in enumerate(self.attn_layers):
        module.k_cache = self.kv_cache[0, layer_id]
        module.v_cache = self.kv_cache[1, layer_id]
```

**效果**：KV Cache 显存减少 75%。**关键细节**：不是简单地"少分配层"，而是**先预留 DeltaNet graph state 再分 KV cache**——`reserve_bytes()` 返回 `max_slots × 每层(recurrent + conv 状态)` 的字节数，避免 KV cache 把 DeltaNet 缓冲的显存吃光。

## 13.4 DeltaNet 推理实现（核心 + FLA 集成）

这是整个适配中工作量最大的改动。nano-vllm 完全没有线性注意力的实现，需要从头写。

> DeltaNet 是 FLA（flash-linear-attention）的原生支持算子，直接用官方 fused kernel 既正确又高效。所以本节把"DeltaNet 实现"和"FLA 集成"合并讲一次。

### GatedDeltaNet 的算法思想

GatedDeltaNet 的核心是维护一个**固定大小的递归状态矩阵** $S$，每个 decode 步更新一次：

$$
\begin{aligned}
S_t &= S_{t-1} \odot g_t + k_t \cdot \left[ \beta_t \odot (v_t - S_{t-1}^T k_t) \right]^T \\
o_t &= S_t^T q_t
\end{aligned}
$$

其中：
- $q_t, k_t, v_t$：查询、键、值向量（经过 Conv1d 和投影）
- $g_t$：**遗忘门**，控制历史信息的保留程度，$g_t = \exp(-e^{A} \cdot \text{softplus}(a_t + b))$
- $\beta_t$：**更新强度**，$\beta_t = \sigma(b_t)$
- $S_t$：**递归状态矩阵**，维度固定为 [num_heads, k_head_dim, v_head_dim]

与 KV Cache 不同（随序列长度线性增长），DeltaNet 的状态矩阵是**固定大小**的：

```
KV Cache:   [num_layers, 2, seq_len, num_kv_heads, head_dim]  → 随 seq_len 增长
DeltaNet S: [num_heads, k_head_dim, v_head_dim] = [16, 128, 128] → 固定 ~1MB/层
```

> 计算量是 O(d²)（d = k_head_dim = v_head_dim），详见 [5. 线性注意力](./05-线性注意力.md)

### 两种推理模式

| | Prefill（chunk 模式） | Decode（recurrent 模式） |
|---|---------------------|------------------------|
| 输入 | N 个 token 一起处理 | 1 个 token |
| 复杂度 | O(N) 并行 | O(d²) 每步 |
| 算法 | chunk 内并行 + chunk 间递归 | 纯递归 |
| 状态 | 计算并保存最终状态 | 更新状态矩阵 |

### Q/K L2 归一化细节

Gated DeltaNet 的 Q/K 归一化要和训练代码保持完全一致：

```python
def l2norm(x, dim=-1, eps=1e-6):
    return x * torch.rsqrt((x * x).sum(dim=dim, keepdim=True) + eps)
```

不要写成 `x / (x.norm(dim, keepdim=True) + eps)`。两者看起来接近，但 epsilon 的位置不同——训练实现是在平方和上加 `eps` 后开根号，推理侧必须对齐，否则线性注意力层会产生细小但可累积的数值偏差。

### FLA 集成：chunk + recurrent 两个 kernel

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/layers/deltanet/delta_rule.py)

Prefill 用 FLA 的 `chunk_gated_delta_rule`（chunk 内并行 + chunk 间递归），Decode 用 `fused_recurrent_gated_delta_rule`（纯递归融合 kernel）：

```python
from fla.ops.gated_delta_rule import (
    chunk_gated_delta_rule,           # prefill: chunk 并行
    fused_recurrent_gated_delta_rule, # decode: 融合 recurrent
)

def run_prefill_delta_rule(query, key, value, g, beta, *, cu_seqlens,
                           initial_state=None, scale=None):
    return chunk_gated_delta_rule(
        q=query, k=key, v=value, g=g, beta=beta,
        scale=query.shape[-1] ** -0.5, initial_state=initial_state,
        output_final_state=True, use_qk_l2norm_in_kernel=True, cu_seqlens=cu_seqlens,
    )

def run_decode_delta_rule(query, key, value, g, beta, initial_state=None, scale=None):
    return fused_recurrent_gated_delta_rule(
        q=query, k=key, v=value, g=g, beta=beta,
        scale=query.shape[-1] ** -0.5, initial_state=initial_state,
        output_final_state=True, use_qk_l2norm_in_kernel=True,
    )
```

**为什么不用自研 Triton**：早期自研 Triton kernel 的设计思路和 FLA 一致（State [128×128] 分 tile 两遍扫描，Pass1 算 kv_mem+output、应用 gate decay，Pass2 算 delta、rank-1 更新）。重构后这部分改用 FLA——算法一致、收益一致，但由 FLA 维护、正确性验证更充分。minivllm 的角色是"把 FLA 接进 continuous batching + CUDA Graph 的调度框架"，而不是"重新发明 DeltaNet kernel"。

> **FLA 不可用时直接报错**（无 fallback）

因果卷积也走 FLA（`fla.modules.convolution`）：

```python
from fla.modules.convolution import causal_conv1d, causal_conv1d_update
# prefill: 变长序列的 conv（按 cu_seqlens）
mixed_qkv, new_conv_state = causal_conv1d(
    x=mixed_qkv_pre.unsqueeze(0), weight=self._conv_weight(),
    initial_state=conv_state, output_final_state=True,
    activation="silu", backend="triton", cu_seqlens=cu_seqlens,
)
# decode: 单步 conv update
mixed_qkv, new_conv_state = causal_conv1d_update(
    x=current_qkv, cache=conv_state, weight=self._conv_weight(), activation="silu",
)
```

### Per-Sequence 状态隔离（eager 模式）

**这是隐蔽而且关键的改动。**

Prefill 时多个序列被拼接成一个 batch，但 DeltaNet 的 delta rule 接收整个 batch 时，序列间的状态会**互相污染**：

```
序列 A (10 tokens): S_A = delta_rule(q_A, k_A, v_A, initial_state=None)
序列 B (15 tokens): S_B = delta_rule(q_B, k_B, v_B, initial_state=S_A)  ← 错！
序列 C ( 8 tokens): S_C = delta_rule(q_C, k_C, v_C, initial_state=S_B)  ← 错！

B 的初始状态应该是 None（独立序列），不是 A 的最终状态！
```

**解决方案**：按 `cu_seqlens_q` 切分 batch，每个序列独立处理并缓存状态。

```python
class GatedDeltaNet(nn.Module):
    def __init__(self, config, layer_idx):
        self.recurrent_state_cache = {}  # {seq_id: state_tensor}
        self.conv_state_cache = {}        # {seq_id: state_tensor}
```

Decode 时，batch 中可能有不同的序列在运行。当某个序列完成后，batch 大小缩小，需要精确知道哪些序列还在：

```
Prefill:    [A, B, C, D] → cache = {A: S_A, B: S_B, C: S_C, D: S_D}
Decode #5:  D 完成 → seq_ids=[A, B, C] → 取出 [S_A, S_B, S_C] ✓
```

需要在 Context 中传递 `seq_ids`：

```python
# context.py
@dataclass(slots=True)
class Context:
    seq_ids: list | None = None          # 序列 ID 列表

# model_runner.py — prepare_prefill/prepare_decode
seq_ids = [seq.seq_id for seq in seqs]
set_context(..., seq_ids=seq_ids)
```

> **Graph 模式下的状态管理**（`state_slot` 稳定映射）见 13.6 节。

## 13.5 Conv1d Decode Cache

### 滑动窗口缓存

给每个序列维护一个 `[conv_dim, kernel_size-1]` 的缓存，保存最近 `kernel_size-1` 个 **pre-conv projected QKV**：

```
conv_state_cache[seq_id] = [qkv_{t-3}, qkv_{t-2}, qkv_{t-1}]
```

为什么保存 pre-conv QKV，而不是保存卷积后的输出？因为下一步卷积需要的输入窗口是原始 projected QKV 序列；如果保存卷积输出，就无法重新构造 depthwise conv 的线性窗口。

**eager 模式**用 Python dict（`seq_id → state`），**graph 模式**用预分配 buffer + `state_slot` 索引（见 13.6）。

等价关系可以这样理解：

| 阶段 | 当前 token 的卷积输入 |
|------|----------------------|
| 完整 prefill | `[..., qkv_{t-3}, qkv_{t-2}, qkv_{t-1}, qkv_t, ...]` 中由 Conv1d 取窗口 |
| 正确 decode | `torch.cat([conv_state_cache, current_qkv]) = [qkv_{t-3}, qkv_{t-2}, qkv_{t-1}, qkv_t]` |
| 错误 decode | 对于任意`qkv_t`都用`[0, 0, 0, qkv_t]` |

因此 `conv_state_cache` 的目标不是加速某个矩阵乘法，而是保证 **prefill 一次性计算** 和 **decode 逐 token 计算** 的因果卷积结果一致。

### 和 DeltaNet recurrent state 的关系

DeltaNet decode 实际需要两类状态：

| 状态 | 形状 | 保存内容 | 用途 |
|------|------|----------|------|
| `conv_state_cache` | `[conv_dim, kernel_size-1]` | 最近几个 pre-conv projected QKV | 让 Conv1d 看到局部历史 |
| `recurrent_state_cache` | `[1, heads, key_dim, value_dim]` | Delta Rule 的压缩记忆矩阵 | 让线性注意力看到长程历史 |

两者缺一不可。只有 recurrent state，没有 conv state，会导致当前 token 的 Q/K/V 本身已经算错；只有 conv state，没有 recurrent state，则 Delta Rule 无法接续历史记忆。

## 13.6 CUDA Graph 加速

### 问题

DeltaNet 的状态在 eager 模式下用 Python dict 管理（`recurrent_state_cache`/`conv_state_cache` 按 seq_id），CUDA Graph 无法捕获 Python 控制流：

| 不兼容元素 | 原因 |
|-----------|------|
| `recurrent_state_cache` / `conv_state_cache` (dict) | dict 读写不是 CUDA 操作 |
| `context.seq_ids` (Python list) | 不是 tensor |
| `torch.cat(states, dim=0)` (动态形状) | 每次 batch 大小不同 |

### 解决方案：预分配固定 buffer + 稳定 state slot

重构后 CUDA Graph 的捕获和重放被**拆成独立组件 `CudaGraphRunner`**（`engine/cuda_graph_runner.py`），状态缓冲由 `DeltaNetStateManager` 统一预分配。

[代码文件](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/engine/cuda_graph_runner.py) + [engine/deltanet_state.py](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/minivllm/engine/deltanet_state.py)

```python
class CudaGraphRunner:
    def __init__(self, model, config, block_size, max_bs, dummy_state_slots):
        self.max_bs = max_bs
        self.dummy_state_slots = dummy_state_slots   # padding lane 用的占位 slot
        self.graph_bs = build_graph_batch_sizes(max_bs)  # [1,2,4,8,16,32,...,max_bs]
        ...
```

每层 DeltaNet 的状态缓冲由 `DeltaNetStateManager.allocate_buffers` 逐层调用：

```python
class DeltaNetStateManager:
    def allocate_buffers(self, device, dtype):
        """CUDA Graph 模式：预分配所有 DeltaNet 层的 graph state buffer"""
        max_active_slots = self.config.max_num_seqs
        max_slots = max_active_slots + self.max_graph_bs
        self.free_state_slots = deque(range(max_active_slots))
        self.dummy_state_slots = list(range(max_active_slots, max_slots))
        for layer in self.layers:
            layer.allocate_state_buffers(max_slots, device, dtype)
```

> 这里分成两套状态管理（承接 13.4 的 eager per-sequence 隔离）：

| 模式 | 状态存储 | 索引方式 |
|------|----------|----------|
| Eager | Python dict | `seq_id -> conv/recurrent state` |
| CUDA Graph | 预分配 Tensor buffer | `seq_id -> stable state_slot -> buffer[state_slot]`（`index_select`/`index_copy_`） |

> 早期实现（个人实现，现在已没有代码）把 CUDA Graph buffer 直接按 batch position 索引，例如 `buffer[:num_seqs]`。这在固定 batch 下能跑，但 scheduler 的 decode batch 会随着序列完成、抢占、重排而变化：`[A, B]` 下一步可能变成 `[B]`。如果 B 改用 slot 0，就会读到 A 的 DeltaNet 状态。

当前实现用 `state_slot` 解决这个问题：`DeltaNetStateManager` 维护 `seq_id_to_state_slot`，`Context` 额外携带 `state_slots` tensor；DeltaNet 在 graph 模式下通过 `index_select/index_copy_` 按稳定 slot 读写状态。`allocate_state_buffers()` 只在 `not enforce_eager` 时调用。

### Graph replay 的 padded lanes

CUDA Graph 捕获的是固定 batch size，但真实 decode batch 可能更小。当前实现为 graph padding 预留 dummy slots：

```python
graph_vars["state_slots"][:bs] = model_input.state_slots
if graph_bs > bs:
    graph_vars["state_slots"][bs:graph_bs] = graph_vars["dummy_state_slots"][:graph_bs - bs]
```

真实序列使用自己的稳定 slot，padding lane 使用 dummy slot——graph replay 即使执行了多余 lane，也只会污染 dummy slot，不会覆盖真实序列状态。

### 显存预算

CUDA Graph 模式需要额外显存，不能只预留 graph capture 的临时空间。MiniQwen 还要为每层 DeltaNet 预分配 graph state buffer：

```
max_slots = max_num_seqs + max_graph_bs
per_slot_state = 18 层 * (recurrent_state + conv_state)
```

以当前 0.8B 配置估算，每个 slot 的 DeltaNet state 约 9.63 MiB。默认 `max_num_seqs=512`、`max_graph_bs=512` 时，仅 DeltaNet graph state 就接近 9.63 GiB。如果 KV Cache 在它之前把剩余显存全部吃掉，后续 `allocate_deltanet_buffers()` 会在空闲 24GB 4090D 上也 OOM。

因此 `allocate_kv_cache()` 需要把两部分都从 KV Cache 预算中扣掉（见 13.3.4 的 `graph_reserve`）。

## 13.7 Prefix Cache 的混合架构实现（最难）

> 实现并不好，仅供参考

nano-vllm 的 prefix cache 只复用 GQA 层的 KV Cache：调度器通过 block hash 命中前缀后，让新请求只 prefill 后缀 token。这对纯 GQA 模型是正确的，但对 MiniQwen 混合架构还不够。

### 什么是 DeltaNet snapshot

在讲清楚为什么 prefix cache 要额外存东西之前，先定义本节反复出现的"snapshot"：

> **DeltaNet snapshot = 某个请求在某个 KV block 边界处，18 层 DeltaNet 的两类状态的完整快照。**

| 状态 | 形状 | 内容 |
|------|------|------|
| `conv_state` | `[conv_dim, kernel_size-1]` ≈ `[6144, 3]` | 因果卷积最后 3 个 pre-conv QKV（让下个 token 的卷积能"看到"前 3 个 token） |
| `recurrent_state` | `[num_heads, k_dim, v_dim]` = `[16, 128, 128]` | Delta rule 的递归矩阵 $S$（压缩了历史的 key→value 关联） |

每层 DeltaNet 都有这两份，**18 层**所以一个完整 snapshot ≈ 9.63 MiB（见 13.7 末尾"成本"）。它不是单个 tensor，而是"一个 block 边界时刻、所有 DeltaNet 层的状态集合"，代码里对应 `prefix_state_cache[block_hash]`。

**为什么需要 snapshot**：纯 GQA 模型的历史信息全在 KV 向量里，block 存了 K/V 就等于存了历史；但 MiniQwen 的 DeltaNet 不用 KV Cache，历史存在 `recurrent_state` 和 `conv_state` 里。如果 prefix cache 只恢复 GQA 层的 KV，DeltaNet 层会**从零状态开始**——GQA 看到了正确历史，DeltaNet 却"失忆"了。snapshot 就是那个"失忆的补丁"。

> 打个比方：纯 GQA 像录音机，暂停后从同一位置继续放就行（KV 是"位置"）。混合架构像录音机+笔记本，KV 是录音带（复用位置），DeltaNet 状态是笔记本上记的摘要——必须把摘要一起复制过来，否则从头记。snapshot 就是那个"笔记本摘要的复印件"。

### 问题：Prefix Cache 不能只恢复 KV

原因是 MiniQwen 的 DeltaNet 层还有两类状态：

| 状态 | 用途 | 是否能由 KV Cache 恢复 |
|------|------|----------------------|
| `conv_state_cache` | 保存因果卷积最后 `kernel_size-1` 个 projected QKV | 不能 |
| `recurrent_state_cache` | 保存 Delta Rule 的递归状态矩阵 | 不能 |

如果只复用 KV Cache 并跳过 prompt 前缀，DeltaNet 的状态会从错误的后缀起点开始，输出就不再等价于完整 prefill。因此 MiniQwen 的 prefix cache 必须同时满足三件事：

1. GQA KV Cache 命中
2. 对应 block hash 已保存每层 DeltaNet 的 `conv_state` 和 `recurrent_state`
3. prefill 切分必须落在完整 block 边界上，否则没有稳定的 prefix hash 可以绑定 DeltaNet snapshot

当前 minivllm 默认开启 prefix cache（`Config.enable_prefix_cache=True`）。

### Scheduler 侧：只复用带 DeltaNet state 的 block

`Block` 除了保存 `hash/token_ids/ref_count`，还保存 `has_deltanet_state`：

```python
class Block:
    def __init__(self, block_id):
        self.hash = -1
        self.token_ids = []
        self.has_deltanet_state = False
```

调度器开启 prefix cache 后不会简单复用所有 hash 命中的 block，而是要求：

```python
num_cached_blocks = block_manager.can_allocate(seq, require_deltanet_state=True)
```

`can_allocate()` 会沿着 block hash 链逐块匹配；如果某个 block 只有 KV Cache、没有 DeltaNet snapshot，就不会把它计入可复用前缀。这样可以避免"GQA 正确、DeltaNet 从零状态开始"的隐蔽错误。

### Prefill 侧：按 block 边界切分

为了让 DeltaNet snapshot 和 block hash 一一对应，开启 prefix cache 后，scheduler 会把 prefill 切到下一个 block 边界：

```python
if self.enable_prefix_cache:
    next_block_boundary = ((start // self.block_size) + 1) * self.block_size
    num_tokens = min(num_tokens, next_block_boundary - start)
```

当一个 block 完整 prefill 完成后，`postprocess()` 返回需要保存 DeltaNet 状态的 `(seq_id, block_id, block_hash)`。随后 `LLMEngine.step()` 调用：

```python
model_runner.cache_deltanet_prefix_states([(seq_id, block_hash)])
scheduler.mark_deltanet_prefix_states(prefix_state_specs)
```

第一步把每层 DeltaNet 当前状态 clone 到 `prefix_state_cache[block_hash]`，第二步把 block 标记为 `has_deltanet_state=True`。

### ModelRunner 侧：恢复 prefix snapshot

新请求命中 prefix 时，`Sequence.prefix_cache_hash` 会指向最后一个可复用 block 的 hash。`prepare_deltanet_prefill_states()` 在准备后缀 prefill 前恢复状态：

```python
restore_specs = [
    (seq.seq_id, seq.prefix_cache_hash, state_slot)
    for seq in seqs
    if seq.num_cached_tokens > 0 and seq.prefix_cache_hash is not None
]
```

Eager 模式下，恢复到 `conv_state_cache[seq_id]` 和 `recurrent_state_cache[seq_id]`；CUDA Graph 模式下，恢复到稳定的 `state_slot` 对应的 graph buffer。

### Eviction 侧：回收 block 时删除 DeltaNet snapshot

KV block 被复用时，如果它原来绑定了 DeltaNet snapshot，`BlockManager` 会记录被驱逐的 hash：

```python
if block.has_deltanet_state:
    self.evicted_deltanet_state_hashes.append(block.hash)
```

`LLMEngine.step()` 会在下一次执行前调用 `drop_deltanet_prefix_states()`，从所有 DeltaNet 层删除过期 snapshot，避免 prefix state 和 KV block 生命周期脱节。

### 成本：Prefix Cache 不再只是 KV Cache

MiniQwen 每个 prefix block 的 DeltaNet snapshot 包含 18 层的 `conv_state + recurrent_state`。以当前 0.8B 配置估算，完整 block 的 DeltaNet snapshot 约 9.63 MiB。也就是说，开启 prefix cache 后需要额外关注 DeltaNet snapshot 显存，而不是只看 KV Cache block 数量。

## 13.8 性能数字

基础版 minivllm 跑通后，decode 吞吐约 27 tok/s；相比 naive PyTorch 已经变快，但 DeltaNet recurrent decode 仍被 kernel launch 和 Python 调度开销限制。后续主要做了两轮性能优化（对应 13.4 的 FLA 集成 + 13.6 的 CUDA Graph）：

| 阶段 | 优化项 | Decode tok/s | 加速比 |
|------|--------|-------------|--------|
| 对照 | Naive PyTorch（无 KV Cache） | 9.5 | 1.0× |
| 基础版 | KV Cache + MiniQwen 模型适配 | 27.1 | 2.9× |
| 优化 1 | + FLA fused recurrent kernel（13.4） | ~35 | 3.7× |
| 优化 2 | + CUDA Graph + stable state slots（13.6） | **183.6** | **19.3×** |

**优化 1（FLA）的本质**：decode 每步只处理 1 个 token，朴素 Python 循环会把 delta rule 的 5 步操作（衰减/读状态/算 delta/写状态/输出）拆成 5 个独立 CUDA kernel launch，每个 launch 开销 ~5-10μs。FLA 的 `fused_recurrent_gated_delta_rule` 把 5 步融成 1 个 kernel，收益主要来自减少 launch 和中间 tensor 往返。

**优化 2（CUDA Graph）的本质**：decode 每个 step 要启动几十个 CUDA kernel（embedding/rmsnorm/q_proj/.../lm_head），CPU→GPU 的调度开销成为瓶颈。CUDA Graph 预录制整个 decode 的 kernel 序列，运行时一次 `graph.replay()` 全部执行。但 graph 要求固定形状——所以需要 13.6 的预分配 buffer + 稳定 state_slot 解决"动态 batch + 序列生命周期"的问题。

> 完整吞吐/Prefix Cache/C-Eval/native 对齐的评测见 [14_minivllm_eval.md](./14-minivllm-eval.md)，由 [minivllm/eval/](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/eval/README.md) 下的脚本复现。

## 13.9 总结

### 从 nano-vllm 到 minivllm 的完整改动地图

```
nano-vllm                              minivllm
──────────────────────────────────────────────────────────────
qwen3.py                            →  miniqwen.py
  Qwen3ForCausalLM                    MiniQwenForCausalLM
  (纯 GQA)                             (GQA + DeltaNet 混合)
                                      get_rope_theta() 对齐训练默认值

model_runner.py                      →  model_runner.py
  num_layers 层 KV Cache               num_attn_layers 层 KV Cache
  无 DeltaNet buffer                   graph 模式才 allocate_deltanet_buffers()
                                      KV Cache 预算预留 DeltaNet graph state
                                      seq_id -> state_slot 稳定映射
                                      dummy slots 保护 graph padding lanes
  硬编码 NCCL port                     env:// + is_initialized() 检查

config.py                            →  config.py
  默认开启 prefix cache                 enable_prefix_cache=True
                                      Prefix Cache 可和 CUDA Graph 共存

layernorm.py                         →  layernorm.py
  weight = ones(dim)                   weight = zeros(dim)
  output = weight * norm(x)            output = (1+weight) * norm(x)

attention.py                         →  attention.py (不变)

deltanet.py                          →  layers/deltanet/（拆分子包）
  不存在                               module/delta_rule/state/norm 拆分
                                      chunk 模式（FLA chunk_gated_delta_rule）+ recurrent 模式（FLA fused_recurrent）
                                      per-sequence 状态缓存（DeltaNetStateMixin）
                                      packed prefill 按序列独立 conv（FLA causal_conv1d）
                                      Conv1d 滑动窗口缓存
                                      Prefix Cache 保存/恢复 conv + recurrent snapshot
                                      CUDA Graph 预分配 buffer + state_slots 索引

triton_fused_delta.py                →  已删除（改用 FLA）
  自研 Triton fused recurrent          不再自研：直接用 fla.ops.gated_delta_rule
  + PyTorch fallback                  无 fallback，FLA 不可用直接 ImportError

deltanet_state.py                    →  新增!（从 model_runner 拆出）
  不存在                               DeltaNetStateManager：slot 池、seq_id→slot 映射、prefix cache/drop

model_input.py / cuda_graph_runner.py→  新增!（从 model_runner 拆出）
  不存在                               ModelInput + build_prefill/decode_input
                                      CudaGraphRunner（decode-only，自有静态 buffer）

loader.py                            →  loader.py
  子串匹配: k in weight_name           分段匹配: k in segments

context.py                           →  context.py
  无 seq_ids                           新增 seq_ids 字段
                                      新增 state_slots 字段

llm_engine.py                        →  llm_engine.py
  tokenizer 默认加载                   fix_mistral_regex=True，避免错误 regex 分词
  step 无 deltanet 状态同步             每步：preempted drop → evicted prefix drop → run → cache prefix → mark → finished drop
```

### 关键收获

1. **混合架构的推理状态不再只有 KV Cache**：GQA 层的历史信息保存在 KV Cache 里，但 DeltaNet 层的历史信息保存在 `conv_state` 和 `recurrent_state` 里。适配 minivllm 时不能只沿用 nano-vllm 的 Attention 路径，而要把两套状态作为同一个请求生命周期的一部分来调度。

2. **DeltaNet 的正确性首先取决于 per-sequence 状态隔离**：continuous batching 会把多条请求拼在一起执行，但每条请求的 DeltaNet 状态必须独立推进。prefill 要按 `cu_seqlens` 切开，decode 要按 `seq_id` 取状态；只要把 batch position 当成 sequence identity，请求结束、重排或抢占时就会串状态。

3. **FLA 替代了自研 Triton kernel**：decode 每步只处理一个 token，DeltaNet recurrent 的矩阵状态更新会拆成多个小 CUDA 操作。自研 Triton fused kernel 把衰减、读状态、算 delta、写状态和输出融合到一个 kernel，收益来自减少 launch 和中间 tensor 往返；重构后这部分改用 FLA 的 `fused_recurrent_gated_delta_rule`——算法一致、收益一致，但由 FLA 维护、正确性验证更充分。

4. **CUDA Graph 固定的是执行形状，不固定请求身份**：Graph replay 可以固定 batch size、buffer 地址和 kernel 序列，但 scheduler 中的真实请求会完成、插入、重排。DeltaNet graph buffer 必须通过 `seq_id -> state_slot -> buffer[state_slot]` 绑定请求身份，padding lane 也要写入 dummy slot，才能在动态 batching 下保持正确。

5. **Conv1d cache 是正确性状态，不只是性能优化**：DeltaNet decode 的当前 Q/K/V 来自带因果卷积的 projected QKV 窗口。没有缓存最近 `kernel_size-1` 个 pre-conv QKV 时，decode 实际看到的是 `[0, 0, 0, current]`，它和完整 prefill 的卷积结果不等价。

6. **Prefix Cache 在混合架构中必须覆盖完整 prefix state**：纯 GQA 模型只要复用 KV block 就能跳过前缀 prefill；MiniQwen 还要恢复每层 DeltaNet 的 `conv_state` 和 `recurrent_state`。因此 prefix block 的生命周期不只是 `hash/token_ids/ref_count`，还必须包含 DeltaNet snapshot 的保存、命中检查和 eviction 清理。

7. **训练和推理公式必须逐项对齐**：`RMSNorm` 的 `(1+weight)`、RoPE theta 默认值、Q/K L2 norm 的 epsilon 位置，看起来都是小差异，但它们会在 24 层模型里逐层累积。推理侧不是"能加载权重就算对"，而是要和训练侧的数学定义逐项一致。

---

**上一章**：[12. nano-vllm](./12-nano-vllm.md) | **下一章**：[14. minivllm 评测](./14-minivllm-eval.md)
