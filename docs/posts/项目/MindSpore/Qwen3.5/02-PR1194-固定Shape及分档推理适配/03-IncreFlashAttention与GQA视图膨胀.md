# 03 IncreFlashAttention 与 GQA 视图膨胀

> 前置：`02-KVCache原位更新与静态Decode导出.md` §1 讲 Scatter（怎么写进 cache），本篇讲 IFA（怎么从 cache 里读出来算注意力），以及为什么读的时候要把 4 个头看成 16 个。

## 结论先行

1. **IFA 是本 PR 唯一新增的"计算类" Custom 算子**（Scatter 只是搬运）。它的 `symbolic` 有 10 个属性，比 CGDR/RGDR 多出一个关键项：`input_layout_s="BNSD"`——内核被明确告知头轴在 seq 轴之前，这与 PyTorch 侧 `transpose(1,2)` 之后的实际排布一致。
2. **`atten_mask` 是可选入参，可选性写在两个属性里**：`optional_input_names_s=["atten_mask"]` 声明名字，`input_index_i` 决定是否真的出现（无 mask 时只有 `[0,1,2]`，有 mask 时才是 `[0,1,2,3]`）。同一个 PR 里 Scatter 的 `optional_input_names_s=[]` 正好是反例，两者对照着读最省力。
3. **`block_size_i=0` 与 `inner_precise_i=1` 是"非分块 + 内核内高精度"的一对声明**。代码里没有注释解释它们，本 PR 也没改过它们（h01 一次写入，此后三个 commit 未触碰该段）。
4. **第一个 commit 直接把紧凑 GQA cache 喂给 IFA，第三个 commit 才补上视图膨胀**。h23 在 `export_qwen3_5_4b_onnx.py:781-784` 留下了一句唯一的因果注释："The current 310P IFA tiler rejects GQA with head_dim=256."——这是整个 PR 里第一处、也是唯一一处把"为什么这样实现"写进代码文本的地方。
5. **膨胀是视图不是持久状态**：`_expand_kv_heads_for_ifa` 用 `unsqueeze(2).expand(...).reshape(...)` 造出一个 MHA 形状的新张量，**只在 IFA 调用前**做；cache 本体（Scatter 写入、跨 token 保留的那块）始终是 4 个 KV 头。
6. **`ifa_num_kv_heads = num_heads` 是配套的谎报**：既然已经在图上展开成 16 头，就必须告诉内核"这就是 16 个 KV 头"，否则内核会再展开一次。展开与属性声明是一个动作的两半，缺一即错。
7. **`forward` 侧保留了独立的 `repeat_interleave` 实现**（`:647-650`），与 `symbolic` 的展开路径不是同一份代码：前者供追踪期算参考值，后者供图上算。两者必须等价，`90` 用"Cosine Similarity 为 1.0、NRMSE 为 0、Max Absolute Error 为 0"记录了这条等价性被验过。
8. **代价被精确地放在"每次调用"而不是"每步持久"上**：按 Shape 表口径算，8 层 k+v 的紧凑 cache 常驻量是本报告计算的 64 MiB（推导见 §6.2），展开后为 256 MiB；两者之差只存在于 IFA 的前向瞬时，不进入跨 token 状态。

## §1 IFA 的 symbolic 契约

### 1.1 整段实现

`export_qwen3_5_4b_onnx.py:637-687`（终态；此段自 h01 起未被后续 commit 改动）：

```python
class IncreFlashAttentionFunction(torch.autograd.Function):
    """Export full-attention Decode as the CANN IncreFlashAttention op."""

    @staticmethod
    def forward(ctx, query, key, value, atten_mask, num_heads, scale_value,
                num_kv_heads):
        """Run a PyTorch reference implementation during ONNX tracing."""
        del ctx
        key_ref = key
        value_ref = value
        if 0 < num_kv_heads < num_heads:
            repeat = num_heads // num_kv_heads
            key_ref = key_ref.repeat_interleave(repeat, dim=1)
            value_ref = value_ref.repeat_interleave(repeat, dim=1)
        attn = torch.matmul(query, key_ref.transpose(2, 3)) * float(scale_value)
        if atten_mask is not None:
            mask = atten_mask.to(torch.bool)
            if mask.dim() == 4 and mask.shape[1] == 1:
                mask = mask.expand(attn.shape[0], attn.shape[1], mask.shape[2], mask.shape[3])
            attn = attn.masked_fill(mask, torch.finfo(attn.dtype).min)
        attn = F.softmax(attn, dim=-1, dtype=torch.float32).to(query.dtype)
        output = torch.matmul(attn, value_ref)
        return output

    @staticmethod
    def symbolic(graph, query, key, value, atten_mask, num_heads, scale_value,
                 num_kv_heads):
        """Export an IncreFlashAttention Custom node."""
        inputs = [query, key, value]
        input_index = [0, 1, 2]
        if atten_mask is not None:
            inputs.append(atten_mask)
            input_index.append(3)
        output = graph.op(
            "Custom",
            *inputs,
            type_s="IncreFlashAttention",
            input_names_s=["query", "key", "value", "atten_mask"],
            optional_input_names_s=["atten_mask"],
            output_names_s=["attention_out"],
            output_num_i=1,
            input_index_i=input_index,
            num_heads_i=int(num_heads),
            scale_value_f=float(scale_value),
            input_layout_s="BNSD",
            num_key_value_heads_i=int(num_kv_heads),
            block_size_i=0,
            inner_precise_i=1,
        )
        output.setType(query.type())
        return output
```

### 1.2 属性表

| 属性 | 值 | 语义 | 本 PR 内的对照物 |
|---|---|---|---|
| `type_s` | `"IncreFlashAttention"` | CANN 内核类型名 | Scatter 用 `"Scatter"` |
| `input_names_s` | 4 个固定名字 | 即使 mask 缺席，名字表仍列满 4 项 | Scatter 列 3 项且全必填 |
| `optional_input_names_s` | `["atten_mask"]` | 声明第 4 项可缺 | Scatter 是 `[]` |
| `input_index_i` | `[0,1,2]` 或 `[0,1,2,3]` | **实际连了几个入参** | Scatter 恒为 `[0,1,2]` |
| `output_names_s` | `["attention_out"]` | 输出名与输入名不同（非原位） | Scatter 输出名等于输入名 `var` |
| `output_num_i` | `1` | 单输出 | RGDR 是多输出，见 !1169 报告 |
| `num_heads_i` | 16 | Q 头数 | — |
| `num_key_value_heads_i` | `int(num_kv_heads)` | KV 头数；**§4 之后固定路径传的是 16** | — |
| `scale_value_f` | `1/sqrt(head_dim)` 或 `layer.scaling` | 缩放系数以 float 属性下传 | — |
| `input_layout_s` | `"BNSD"` | 声明头轴先于 seq 轴 | CGDR/RGDR 侧无此项 |
| `block_size_i` | `0` | 不分块 | — |
| `inner_precise_i` | `1` | 内核内高精度累加 | — |

三条判断（非文中标述，来自属性对照）：

- **原位与否由 `output_names_s` 是否复用输入名表达**。Scatter 复用、IFA 不复用，这正好是两者在设备内存上的行为差异。
- **可选性由"名字表"和"索引表"共同表达**：`input_names_s` 声明候选，`input_index_i` 声明实连。缺一个都可能让 mapper 在解绑定时错位。
- `input_layout_s="BNSD"` 是 **IFA 相对 CGDR/RGDR 多出来的排布声明**。它把 `transpose(1,2)` 之后的隐式约定变成图上的显式属性，因此内核不必猜。

### 1.3 输出类型继承

`output.setType(query.type())`——输出张量的类型跟随 Q。Q 在调用点被显式折算到 cache 的 dtype（`:797` `query_states.to(key_cache.dtype)`），所以 IFA 的输出是 FP16。与 !1169 报告里"内核边界 FP16、模型可见 state FP32"的边界纪律同一思路（`../reports-PR1169/01-导出侧-Custom节点如何进入ONNX图.md` §3）。

## §2 forward 参考实现：追踪期版本

`forward` 的三件事按顺序：GQA 展开 → 缩放点积 + 掩码 → FP32 softmax 后回投。两个细节值得单独看：

| 行 | 代码 | 为什么在参考实现里 |
|---|---|---|
| `if 0 < num_kv_heads < num_heads:` | 三段条件而非两段 | `num_kv_heads=0` 或负值时不展开；给"不声明 KV 头数"留了兼容位 |
| `key_ref = key_ref.repeat_interleave(repeat, dim=1)` | 展开的是**参考值**，与 §5 的图上展开是两条实现 | 图上没有 `repeat_interleave` 节点，有 `Unsqueeze+Expand+Reshape` |
| `mask = atten_mask.to(torch.bool)` | 掩码是布尔，不是加性 float | 与 02 篇 §4.3 的 `~allowed` 直接对应 |
| `if mask.dim() == 4 and mask.shape[1] == 1:` | 只在"头轴宽度为 1"时手工 expand | 与 `masked_fill` 的广播规则配合，把 `[1,1,1,L]` 铺到 `[B,16,1,L]` |
| `torch.finfo(attn.dtype).min` | 屏蔽值取当前 dtype 的最小值 | 与 `_make_additive_causal_mask` 的 `mask_value` 同一来源 |
| `F.softmax(..., dtype=torch.float32).to(query.dtype)` | 累加在 FP32、输出回 FP16 | 追踪期数值口径，图上由 `inner_precise_i=1` 表达同类要求 |

`attn_mask` 在固定路径下的形状是 `[1,1,1,max_seq_len]`（02 篇 §4.3 最后一行），`mask.shape[1] == 1` 成立，因此走 expand 分支；这与基线加性掩码 `[B,1,q_len,k_len]` 的宽度（`shape[1]` 也常为 1）不同处在于：固定路径的最后一轴恒等于容量，而不是"当前 KV 长度"。

## §3 组装：`_full_attn_decode_fixed`

终态 `export_qwen3_5_4b_onnx.py:758-805`（h01 引入骨架、h23 插入中段）：

```python
def _full_attn_decode_fixed(layer, hidden_states, position_embeddings,
                            attention_mask, past_key, past_value, cache_pos):
    """Run one full-attention Decode layer with a fixed-capacity KV cache."""
    input_shape = hidden_states.shape[:-1]
    head_dim = layer.head_dim
    num_heads = int(layer.config.num_attention_heads)
    num_kv_heads = int(layer.config.num_key_value_heads)
    hidden_shape = (*input_shape, -1, head_dim)

    qkv = layer.q_proj(hidden_states).view(*input_shape, -1, head_dim * 2)
    query_states, gate = torch.chunk(qkv, 2, dim=-1)
    gate = gate.reshape(*input_shape, -1)
    query_states = layer.q_norm(query_states.view(hidden_shape)).transpose(1, 2)
    key_states = layer.k_norm(layer.k_proj(hidden_states).view(hidden_shape)).transpose(1, 2)
    value_states = layer.v_proj(hidden_states).view(hidden_shape).transpose(1, 2)

    cos, sin = position_embeddings
    from transformers.models.qwen3_5.modeling_qwen3_5 import apply_rotary_pos_emb
    query_states, key_states = apply_rotary_pos_emb(query_states, key_states, cos, sin)

    key_cache = _kv_cache_update(past_key, key_states, cache_pos)
    value_cache = _kv_cache_update(past_value, value_states, cache_pos)
    scaling = getattr(layer, "scaling", 1.0 / (head_dim ** 0.5))
    if num_kv_heads < num_heads:
        # The current 310P IFA tiler rejects GQA with head_dim=256.
        # Keep the persistent cache in compact GQA form and materialize an
        # equivalent MHA view only for the fused attention call.
        key_for_attn = _expand_kv_heads_for_ifa(
            key_cache, num_heads, num_kv_heads, head_dim
        )
        value_for_attn = _expand_kv_heads_for_ifa(
            value_cache, num_heads, num_kv_heads, head_dim
        )
        ifa_num_kv_heads = num_heads
    else:
        key_for_attn = key_cache
        value_for_attn = value_cache
        ifa_num_kv_heads = num_kv_heads
    attn_output = _incre_flash_attention(
        query_states.to(key_cache.dtype).contiguous(),
        key_for_attn.contiguous(), value_for_attn.contiguous(),
        attention_mask, num_heads, scaling, ifa_num_kv_heads,
    )
    attn_output = attn_output.to(hidden_states.dtype)
    attn_output = attn_output.transpose(1, 2).reshape(*input_shape, -1).contiguous()
    attn_output = attn_output * torch.sigmoid(gate)
    attn_output = layer.o_proj(attn_output)
    return attn_output, key_cache, value_cache
```

与基线 `_full_attn_forward`）的结构对照：

| 段落 | 基线 | 固定版 | 差异 |
|---|---|---|---|
| QKV 投影 + norm + RoPE | 有 | 逐字相同 | 无 |
| cache 合并 | `torch.cat([past_key, key_states], dim=2)` | `_kv_cache_update(past_key, key_states, cache_pos)` | cat → Scatter |
| GQA 展开 | 在 `if num_kv_heads < num_heads` 下 `repeat_interleave(..., dim=1)` | `_expand_kv_heads_for_ifa` 同一条件 | 展开位置搬到 cache 之后、IFA 之前 |
| 注意力计算 | 手写 matmul + softmax + matmul | `_incre_flash_attention` 单节点 | 融成 Custom |
| 输出返回 | `key_states, value_states`（长度 past+1） | `key_cache, value_cache`（长度恒为容量） | 形状语义变了，名字没变 |
| gate/sigmoid/o_proj 收尾 | 有 | 逐字相同 | 无 |

倒数第二行是这次改写最容易被忽略的成果：**`present_kv_cache` 这个名字、轴序、以及"输出全量 cache"的接口约定都没变，变的只是它的长度不再增长**。所以 02 篇 §3.3 里 Host 侧的 `present_kv.append(pk)` 一行都不用改。

三个 `.contiguous()`（`:797-798`）都必要：`expand` 之后的 reshape 结果、以及 `transpose(1,2)` 之后的 Q，在 PyTorch 侧都不是连续存储；`contiguous()` 在图上落成 `Transpose/Reshape` 类节点，是内核要求紧排布的代价。

## §4 tiler 拒绝 `head_dim=256` 的 GQA

### 4.1 h23 之前长什么样

`src/1e6c7412/qwen3.5_4b/export_qwen3_5_4b_onnx.py:762-769`（第一个 commit）：

```python
    key_cache = _kv_cache_update(past_key, key_states, cache_pos)
    value_cache = _kv_cache_update(past_value, value_states, cache_pos)
    scaling = getattr(layer, "scaling", 1.0 / (head_dim ** 0.5))
    attn_output = _incre_flash_attention(
        query_states.to(key_cache.dtype).contiguous(),
        key_cache.contiguous(), value_cache.contiguous(),
        attention_mask, num_heads, scaling, num_kv_heads,
    )
```

四个差异点：没有 `if num_kv_heads < num_heads:` 分叉、没有展开、`key_cache`/`value_cache` 直接进 IFA、最后一个实参是 `num_kv_heads`（即 4）。也就是说**第一个 commit 的固定路径是把 GQA cache 原样交给 IFA**，`num_key_value_heads_i=4`。

### 4.2 注释与自述

h23 的 17 增 2 删发生在 `-762,10 → +778,25` 这段 hunk 上下文里（台账行 h23），插入的是 §3 引出的那段 `if/else` 与三行注释（`:782-784`）：

```python
        # The current 310P IFA tiler rejects GQA with head_dim=256.
        # Keep the persistent cache in compact GQA form and materialize an
        # equivalent MHA view only for the fused attention call.
```

PR 正文第 3 条给出的中文口径（`90` 第 73 行，逐字）：

```text 出处=90
3. 针对Ascend 310P在`head_dim=256`时不支持GQA大于1的限制，仅在IFA调用前将K/V从4个KV Head等价展开为16个Head；跨Token持久化的KV Cache仍保持4个KV Head。
```

两条表述合起来给出了完整因果：限制是 **tiler 层面**的（不是"精度不对"、也不是"数值不支持"），触发条件是 `head_dim=256` 且 `num_heads/num_kv_heads > 1` 同时成立，Qwen3.5-4B 恰好两个条件都满足（`head_dim=256`、16/4=4）。

`90` 第 107 行说明这条限制是**先被最小图复现、再被绕开**的：

```text 出处=90
   - `max_seq_len=17`和`max_seq_len=2048`的IFA最小子图均完成ONNX导出、MindIR转换和Ascend 310P执行。
```

`max_seq_len=17` 这个非典型值本身就是证据：17 足够小（4×17×256×2B ≈ 34 KiB/头块），能在几分钟内转完一个仅含 IFA 的最小子图，用来判定"是不是 tiler 拒绝"而不是"是不是内存不够"。

### 4.3 `ifa_num_kv_heads = num_heads` 的必要性

终态 `:791` 与 `:795` 两条赋值构成一个"诚实/谎报"的分支对：

```python
        ifa_num_kv_heads = num_heads
    else:
        key_for_attn = key_cache
        value_for_attn = value_cache
        ifa_num_kv_heads = num_kv_heads
```

展开之后再把真实头数 4 告诉内核，内核会在已经 16 头的张量上再展开 4 倍 → 形状非法。所以**"展开"与"报 16"是同一个语义动作的两半**。这也是 §1.2 属性表里 `num_key_value_heads_i` 那行加注"§4 之后固定路径传的是 16"的原因：同一份 `symbolic` 代码，属性值随调用方而变。

## §5 视图膨胀实现

### 5.1 十四行

h22（`export_qwen3_5_4b_onnx.py:742-755`）新增的整个函数：

```python
def _expand_kv_heads_for_ifa(cache, num_heads, num_kv_heads, head_dim):
    """Expand compact GQA cache heads to the MHA layout accepted by 310P IFA."""
    if num_heads == num_kv_heads:
        return cache
    if num_heads % num_kv_heads != 0:
        raise ValueError(
            f"num_heads={num_heads} must be divisible by num_kv_heads={num_kv_heads}"
        )
    repeat = num_heads // num_kv_heads
    batch_size = cache.shape[0]
    cache_len = cache.shape[2]
    return cache.unsqueeze(2).expand(
        batch_size, num_kv_heads, repeat, cache_len, head_dim
    ).reshape(batch_size, num_heads, cache_len, head_dim)
```

调用方已经用 `if num_kv_heads < num_heads:` 挡过一次，函数内部又写了 `num_heads == num_kv_heads → 原样返回`。两道守卫之间，函数自己多挡的是**不整除**这一种（`%` 判断），调用方挡不住。

### 5.2 索引等价性证明（逐步）

以 `B=1`、`num_kv_heads=4`、`num_heads=16`、`repeat=4` 为例：

| 步骤 | 形状 | 元素含义 |
|---|---|---|
| `cache` | `[1, 4, L, 256]` | 头号 `h ∈ [0,4)` |
| `.unsqueeze(2)` | `[1, 4, 1, L, 256]` | 插入一个长度 1 的"复制位" |
| `.expand(1, 4, 4, L, 256)` | `[1, 4, 4, L, 256]` | 逻辑上 `T[b,kv,r,l,d] = cache[b,kv,l,d]`，无数据拷贝 |
| `.reshape(1, 16, L, 256)` | `[1, 16, L, 256]` | 合并 `kv*4 + r` → 新头号 `h'` |

于是 `out[b, h'] = cache[b, h' // 4]`，而 `repeat_interleave(4, dim=1)` 的定义正是"每个元素连续重复 4 次"，即 `out[b, h'] = cache[b, h' // 4]`。**两者逐元素相同**，因此 `forward`（§2 的 `repeat_interleave`）与 `symbolic`（图上的 `Unsqueeze+Expand+Reshape`）在这一步是等价的——这正是 §6.3 那条精度自述能成立的代数前提。

`reshape` 而非 `view`：`expand` 出来的张量在合并轴上 stride 不连续（复制位 stride 为 0），`view` 会直接报错，`reshape` 则强制拷贝一次。这次拷贝就是"膨胀发生在每次调用"的物证。

### 5.3 为什么不干脆把 cache 存成 16 头

| 方案 | 常驻 KV 状态 | Scatter 节点 | 每次 IFA 前的物化 |
|---|---|---|---|
| 展开后持久化（存 16 头） | 4× 增大 | 需要 16 个头各写一次，或索引复杂化 | 0 |
| 紧凑持久化 + 调用前展开（终态） | 与基线相同 | 16 个（k/v × 8 层），写的是紧凑形状 | 2 次 reshape 拷贝/层 |

终态选了第二行。理由不是省内存这么简单——**如果 cache 存成 16 头，Prefill 到 Decode 的状态交接也必须换形状**，而 Prefill 侧输出的 `[16, 1, 4, 2048, 256]` 来自 `_full_attn_forward` 的紧凑 k/v（01 篇 §2.3 的 `F.pad` 补的就是这个形状）。展开只放在 Decode 内部，交接契约完全不动，改动面被压到最小。

> 推测（标记）：GE 编译器不保证会把这个 `Expand+Reshape` 融合掉；从代码文本看不出作者是否检查过最终图里是否残留独立的拷贝节点。`90` 第 2 条只声明了节点计数（16 Scatter / 8 IFA），未声明 Expand 节点数。