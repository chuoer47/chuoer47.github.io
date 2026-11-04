# 03 Decode 接入 RGDR

> 分工：Custom 机制见 `01-导出侧-Custom节点如何进入ONNX图.md`；RGDR 内核自身的实现与演进见 `reports-RGDR/`，本篇只讲接入侧。

## 结论先行

1. **Decode 侧比 Prefill 侧多付两笔代价**：一是 `input_index_i` 必须按注册签名做「跳号投影」（`gk` 缺席），二是必须显式声明 `output_types_i=[42,42]` 与 `outputs_shape_s`。这两件事都指向同一个根因：**单 token 递推的输出形状无法从输入平凡推导，而 mapper 又不会替你猜**。
2. **`ssm_state_indices` 只能是常量零张量**。它是 state 池的寻址入参，在 batch=1、单 token 的 Decode 语义下恒为 0；一旦按「通用写法」用 `arange(...).repeat_interleave(...)` 生成，torch 导出器会把它 trace 成 ONNX **OneHot** 子图，而 MindSpore Lite 2.9 在 Ascend 上无法映射该算子。代码把这条约束连原因一起写进了注释。
3. **`actual_seq_lengths` 与 `num_accepted_tokens` 在 Decode 侧都退化成 `torch.full((batch_size,), sequence_length, ...)`**，即导出期常量。两者同名不同用：前者给内核划定本序列的 token 区间，后者对应 speculative decoding 的接受数，而 Qwen3.5 这条链路没有 speculative 环节，因此它取「全部已生成」这一平凡值。
4. **精度契约与 Prefill 侧完全同构**：进内核 FP16、内核内部 FP32、出内核 FP16、图外层 `.float()` 回 FP32。这条链路的因果解释在 `01` 篇 §3，本篇只做 Decode 侧的落地核对，不重复推导。

## §1 接线点 _linear_attn_decode

Decode 的线性注意力层与 Prefill 的差别在数据流：它必须吃进上一步的 conv 与 recurrent state（`export_qwen3_5_4b_onnx.py:529-533`、`544-546`）：

```python
def _linear_attn_decode(layer, hidden_states, conv_state_in, recurrent_state_in):
    """
    Linear attention decode for the attention layer.
    """
    batch_size, seq_len, _ = hidden_states.shape
```

```python
    state_len = conv_state_in.shape[-1]
    hidden_states_new = torch.cat([conv_state_in, mixed_qkv], dim=-1).to(layer.conv1d.weight.dtype)
    conv_state_out = hidden_states_new[:, :, -state_len:]
```

开关分支（`export_qwen3_5_4b_onnx.py:566-581`）：

```python
    if USE_CUSTOM_RGDR:
        core_attn_out, last_recurrent_state = _recurrent_gated_delta_rule_custom(
            query, key, value, g=g, beta=beta,
            initial_state=recurrent_state_in, output_final_state=True,
            use_qk_l2norm_in_kernel=True,
        )
    else:
        if layer.num_v_heads // layer.num_k_heads > 1:
            repeat = layer.num_v_heads // layer.num_k_heads
            query = query.repeat_interleave(repeat, dim=2)
            key = key.repeat_interleave(repeat, dim=2)
        core_attn_out, last_recurrent_state = _recurrent_gated_delta_rule(
            query, key, value, g=g, beta=beta,
            initial_state=recurrent_state_in, output_final_state=True,
            use_qk_l2norm_in_kernel=True,
        )
```

与 Prefill 侧的三点差异：

| 维度 | Prefill（`02` 篇 §1） | Decode（本节） |
|---|---|---|
| `initial_state` | `None`（图无 recurrent 输入） | `recurrent_state_in`（图有该输入） |
| 卷积 | `causal_conv1d_fn` 或 `F.conv1d` 整段 | `cat(conv_state_in, x)` 后取尾部，滑窗式 |
| GQA 展开位置 | 只在 `else` | 只在 `else`（同构） |

**这里有一个必须写清的时代边界**：本节的 `_linear_attn_decode` 签名里没有任何「固定 KV」「cache 位置」参数，全注意力侧走 `_full_attn_forward`，其内部是 `torch.cat([past_key, key_states], dim=2)` 的增长式拼接（`export_qwen3_5_4b_onnx.py:615-617`）：

```python
    if past_key is not None:
        key_states = torch.cat([past_key, key_states], dim=2)
        value_states = torch.cat([past_value, value_states], dim=2)
```

也就是说，**!1169 的终态里 KV Cache 仍然是每步变长的**。原位 Scatter 写、固定容量 mask、`_full_attn_decode_fixed` 都属于后续 PR
## §2 参考实现 forward

`RecurrentGatedDeltaRuleFunction.forward()` 是最能说明「参考实现 ≠ 内核」的一段（`export_qwen3_5_4b_onnx.py:329-362`）：

```python
    @staticmethod
    def forward(ctx, query, key, value, beta, state, actual_seq_lengths,
                ssm_state_indices, g_decay, num_accepted_tokens):
        """Run the PyTorch reference implementation used during ONNX export."""
        del ctx, ssm_state_indices, num_accepted_tokens
        scale_value = 1.0 / (128.0 ** 0.5)
        query_fp32 = query.float()
        key_fp32 = key.float()
        value_fp32 = value.float()
        beta_fp32 = beta.float()
        state_fp32 = state.float().clone()
        decay_fp32 = g_decay.float().exp()
```

三个入参被 `del` 掉：`ctx`（不用 autograd）、`ssm_state_indices`、`num_accepted_tokens`。**后两个是内核的运行时寻址与推进量，参考实现直接忽略**——因为在它假设的场景（batch=1、slot 0、一次走完）里忽略与不忽略等价。这是「参考实现只保证形状与 dtype 正确，不保证与内核逐语义等价」的典型样本，读代码时必须意识到。

它随后按 `actual_seq_lengths` 逐序列、逐 value head、逐 token 三重循环递推（`export_qwen3_5_4b_onnx.py:345-362`，此处保留结构行）：

```python
        seq_start = 0
        for batch_idx in range(actual_seq_lengths.numel()):
            seq_len = int(actual_seq_lengths[batch_idx].item())
            seq_end = min(seq_start + seq_len, token_count)
            for value_head in range(num_value_heads):
                key_head = value_head // (num_value_heads // num_key_heads)
        .....
        return result.to(value.dtype), state_fp32.to(state.dtype)
```

注意最后一行的返回类型：**`state_fp32.to(state.dtype)`**。`state` 进来时是 FP16（内核排布、FP16），所以返回值也是 FP16。`symbolic()` 声明的 `output_types_i=[42,42]` 与 `setType(torch.float16)` 正是与这一行对齐的。若这里写成 `.float()`，trace 期得到的类型与图上声明的类型就会分叉——`01` 篇 §3 说的「三处一致」在 Decode 侧的具体落点。

`key_head = value_head // (num_value_heads // num_key_heads)` 一行说明 GQA 的头映射是**在参考实现里显式循环完成的**，而不是靠 `repeat_interleave` 展开。这与 §1 里 `else` 分支的做法相反，也和 CGDR 侧 `forward()` 里的 `repeat_interleave` 相反（`02` 篇 §2）。三处三种写法，读的时候不要串。

## §3 symbolic：input_index_i 跳号

完整属性块（`export_qwen3_5_4b_onnx.py:364-399`）：

```python
    @staticmethod
    def symbolic(graph, query, key, value, beta, state, actual_seq_lengths,
                 ssm_state_indices, g_decay, num_accepted_tokens):
        """Export RecurrentGatedDeltaRule as an ONNX Custom node."""
        scale_value = 1.0 / (128.0 ** 0.5)
        out, state_out = graph.op(
            "Custom",
            query, key, value, beta, state, actual_seq_lengths,
            ssm_state_indices, g_decay, num_accepted_tokens,
            type_s="RecurrentGatedDeltaRule",
            input_names_s=[
                "query", "key", "value", "beta", "state",
                "actual_seq_lengths", "ssm_state_indices", "g", "gk",
                "num_accepted_tokens",
            ],

            ....
            optional_input_names_s=["g", "gk", "num_accepted_tokens"],
            input_index_i=[0, 1, 2, 3, 4, 5, 6, 7, 9],
            # Must match the names registered in recurrent_gated_delta_rule_def.cpp.
            output_names_s=["out", "state"],
            output_num_i=2,
```

**跳号机制逐项拆开**：

| 实参位置 | 实参含义 | `input_names_s` 下标 | 是否出现在 `input_index_i` |
|---|---|---|---|
| 0 | query | 0 `query` | 是 |
| 1 | key | 1 `key` | 是 |
| 2 | value | 2 `value` | 是 |
| 3 | beta | 3 `beta` | 是 |
| 4 | state | 4 `state` | 是 |
| 5 | actual_seq_lengths | 5 `actual_seq_lengths` | 是 |
| 6 | ssm_state_indices | 6 `ssm_state_indices` | 是 |
| 7 | g_decay | 7 `g` | 是 |
| 8 | num_accepted_tokens | **9** `num_accepted_tokens` | 是（下标 9） |
| — | （无对应实参） | **8** `gk` | **否，被跳过** |

即：`input_index_i` 的长度是 9（实参个数），值域是 `input_names_s` 的下标空间（0..9）。8 号注册名 `gk` 在本模型里没有生产者，于是下标序列出现空洞。注释把这一点写得很直白：

```python
            # Keep the exported GE IR signature aligned with the registered
            # 310P OpDef.  These optional inputs are still supplied below;
            # only gk is absent from this model adapter.
```

「These optional inputs are still supplied below」指 `g` 与 `num_accepted_tokens` 虽被列为 optional，但**照样实喂**；`optional_input_names_s` 在这里的作用不是「决定谁不喂」，而是「向 GE 声明谁允许缺席」。真正的缺席者是 `gk`，缺席的表达方式是从 `input_index_i` 里剔除下标 8。这是本 PR 导出侧最反直觉的一处约定，也是复用 RGDR 内核时最容易写错的一行。

`gk` 是什么：内核注册表里的 key 侧独立衰减项。Qwen3.5 的 gated delta rule 只有一个 decay（`g`），因此该位空着。此处说明来自属性排布与命名（`g` 与 `gk` 并列，`g` 由 `layer.A_log`/`dt_bias` 算出），内核侧定义不在本集范围。

## §4 output_types_i 与 outputs_shape_s

```python
            # MindSpore TypeId 42 is Float16.  Lite's Ascend Custom mapper
            # falls back to the first input dtype when a graph contains more
            # than one Custom type, so keep the public kernel boundary FP16.
            # The recurrent math remains FP32 inside the kernel and the model
            # casts the returned cache back to FP32 below.
            output_types_i=[42, 42],
            outputs_shape_s="3,-1,32,128,4,-1,32,128,128,",
            # ONNX TensorProto.FLOAT16.  Keep this attribute and the value
            # metadata aligned with the registered GE output contract.
            dtype_i=10,
            outputs=2,
        )
```

`outputs_shape_s` 是一串扁平数字，读法是「两个输出的 shape 顺序拼在一起，以逗号分隔，末尾再留一个逗号」。按 Qwen3.5-4B 的线性注意力维度拆：

| 段 | 值 | 对应 | 解释 |
|---|---|---|---|
| out | `3, -1, 32, 128` | 4 个维度 | rank=3；动态 `-1`；32 个 value head；128 head_dim |
| state | `4, -1, 32, 128, 128` | 5 个维度 | rank=4；动态 `-1`（batch）；32 头；`DV=128`、`DK=128` |

这个拆法由「两个输出各是几 rank」反推：`out` 是 `[B*T, NV, DV]` 的扁平 3D，`state` 是 `[B, NV, DV, DK]` 的 4D，正好对应两段的第一个数 3 与 4。

> **为什么这里必须写、CGDR 那里可以不写（推测）**：`out` 的第二维 `-1` 是 token 数，它依赖运行时输入长度；而 Decode 的 Custom 节点上游还接了 KV 与 mask 相关的分支，GE 无法从本节点输入稳定推出该维。把 rank 与通配位显式交给 GE，是绕开推断歧义的做法。这一点没有文档明示，作为推测记录。

`dtype_i=10` 与 `output_types_i=[42,42]` 是同一件事在两套枚举里的两次表述：ONNX `TensorProto.FLOAT16 = 10`，MindSpore `TypeId 42 = Float16`。注释分别标注了两处含义，避免读者去猜数字。**两处必须同时改**，只改一处会让 ONNX 元数据与 GE 分配不一致，故障表现为「图上写的类型与实际 buffer 类型不符」。

出图后的回转（`export_qwen3_5_4b_onnx.py:453-455`）与 CGDR 侧逐字同构：

```python
    # The model-facing recurrent cache remains FP32 even though the Custom
    # boundary writes FP16; make the conversion explicit in the outer graph.
    state_out = state_out.transpose(-2, -1).contiguous().float()
```

一次调用同时做两件事：排布回转（内核 `[B,NV,DV,DK]` → 模型 `[B,NV,DK,DV]`）与精度回转（FP16 → FP32）。`01` 篇 §3 的因果链在这一行收口。

## §5 ssm_state_indices 与 OneHot 陷阱

```python
    # The RGDR Decode export is fixed to batch one and a single token below,
    # so every token reads and updates state slot 0.  Keep this input constant:
    # exporting arange(...).repeat_interleave(...) produces an ONNX OneHot
    # subgraph that MindSpore Lite 2.9 cannot map for Ascend conversion.
    ssm_state_indices = torch.zeros(
        token_count, dtype=torch.int32, device=query.device
    )
```

拆开三层因果：

| 层 | 事实 |
|---|---|
| 内核语义 | `ssm_state_indices[t]` 指明第 t 个 token 使用 state 池里的哪个槽位。这是为 batch packing / 多序列并发设计的间接寻址 |
| 本模型场景 | Decode 恒为 batch=1、单 token，唯一槽位就是 0，`token_count` 亦为 1 |
| 导出期副作用 | 若按通用写法 `torch.arange(batch).repeat_interleave(seq_len)` 生成索引，trace 会产出一个 ONNX **OneHot** 节点；MSL 2.9 的 Ascend 转换不认它，故障发生在转 MindIR 阶段，报错不会指向 `ssm_state_indices` |

因此「写成常量零」不是省事，而是**唯一可行的导出形式**。约束的强度可以从它被写进注释这一事实读出来：作者预见到后来者会把它「修正」回看起来更通用的 `arange` 写法。

同类陷阱在 `02` 篇 §5 有对照：CGDR 侧没有这个入参，因此不受该约束；而 CGDR 用 `shape_as_tensor` 派生 `actual_seq_lengths`，走的是另一条「让图上不出现常量长度」的路。两处的共同点是：**导出期避免任何会展开成特殊 ONNX 子图的操作**。

同一函数里与之相邻的 dtype 约定（`export_qwen3_5_4b_onnx.py:423-432`）：

```python
    # The registered 310P schema accepts FP16 for Q/K/V/beta/state even when
    # the surrounding model is exported with --dtype fp32.
    query_flat = query.reshape(token_count, num_key_heads, key_dim).to(torch.float16).contiguous()
    .
    # Custom kernel layout is [B, NV, DV, DK] and its state input is FP16.
    state_custom = initial_state.transpose(-2, -1).contiguous().to(torch.float16)
```

**`--dtype fp32` 也拦不住这里**。也就是说导出命令行上的精度开关与 Custom 边界的精度无关，模型整体 FP32 时会在每个 RGDR 节点前后各插一次 `.to(float16)` 与 `.float()`。这一点对排查精度问题的影响值得留意（此为对代码事实的陈述，本集不做数值验证）。

## §6 actual_seq_lengths 与 num_accepted_tokens

两者在 Decode adapter 里由同一模板生成（`export_qwen3_5_4b_onnx.py:433-435`、`443-445`）：

```python
    actual_seq_lengths = torch.full(
        (batch_size,), sequence_length, dtype=torch.int32, device=query.device
    )
```

```python
    num_accepted_tokens = torch.full(
        (batch_size,), sequence_length, dtype=torch.int32, device=query.device
    )
```

字面上完全一样（长度 `batch_size`、值 `sequence_length`、类型 `int32`），语义却不同：

| 入参 | 注册名空间下标 | 内核用途 | Decode 场景取值 |
|---|---|---|---|
| `actual_seq_lengths` | 5 | 每个序列在本次调用里覆盖多少 token，决定递推区间与 state 读写边界 | `sequence_length`，单 token 时为 1 |
| `num_accepted_tokens` | 9（跳号后） | speculative decoding 下本次被接受、需要真正推进 state 的 token 数 | 同样为 `sequence_length`，即「全部接受」 |

`num_accepted_tokens` 的存在说明 **RGDR 内核是按支持 speculative decoding 的接口设计的**（内核侧背景见 `reports-RGDR/`），而 Qwen3.5 这条接入链路没有 draft 模型，于是填平凡值。填错会怎样：若它小于 `actual_seq_lengths`，内核会按更少的 token 推进 state，与图上其余分支不一致。代码没有对此做校验，因为它恒等于 `sequence_length`。

**`actual_seq_lengths` 在两侧的角色差异**（对照 `02` 篇 §5）：Prefill 侧它是 shape 派生量（随输入长度变），Decode 侧它是导出期常量。这个不对称正是「Prefill 保留 seq_len 动态轴、Decode 的 conv/recurrent 脱离动态轴」的根因之一（`01` 篇 §5 表）。|
