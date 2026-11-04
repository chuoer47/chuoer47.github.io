# 02 Prefill 接入 CGDR

> 前置：`01-导出侧-Custom节点如何进入ONNX图.md` 讲机制，本篇讲 Prefill 这一侧的具体接线与它付出的形状代价。

## 结论先行

1. **接线只有一处**：`_linear_attn_prefill` 里一个 `if USE_CUSTOM_CGDR:` 分支。分支体 5 行，`else` 分支把接入前的原实现整段保留下来。这个形状是全 PR 的缩影——**新增能力靠旁路，不靠改写**。
2. **真正的工作量在形状适配层** `_chunk_gated_delta_rule_custom`：内核吃扁平 3D（`[token_count, H, D]`）、FP16、state 排布 `[B, NV, DV, DK]`；HF 侧是 4D、可为 FP32、state 排布 `[B, NV, DK, DV]`。adapter 负责把这三件事一次对齐。
3. **转置责任在调用方，不在内核包装里**。CGDR 与 RGDR 都遵守同一条约定：`[B,NV,DK,DV] ↔ [B,NV,DV,DK]` 的 `transpose(-2,-1).contiguous()` 由 adapter 进出各做一次，内核视角里只有一个排布。
4. **首帧 state 的构造方式决定了图能不能转**。CGDR 侧的 `actual_seq_lengths` 不是常量，而是从 `query` 的形状张量上切下来再 `expand` 的——这样它在图上就是一条可变的 shape 派生链，而不需要推理侧每步回传长度。
5. **`ssm_state_indices` 这个入参在 Prefill 侧根本不存在**（CGDR 只有 7 个入参）。目标提示词把 OneHot 陷阱列在 Prefill 篇下，但代码证据显示它属于 Decode 的 RGDR；本篇按代码为准，只做交叉引用，详见 `03-Decode接入RGDR.md` §5，差异已记入 `_journal.md`。
6. **adapter 的收尾三行各自挡住一类错**：`use_qk_l2norm_in_kernel` 在参考实现里被显式传 `False`（归一化不能做两次）、输出末尾 `.to(initial_dtype)`（FP16 只属于内核边界，不许泄漏给下游）、`if not output_final_state: state_out = None`（丢弃发生在 Python 层，图上第二个输出照样存在）。详见 §7。

## §1 接线点 _linear_attn_prefill

Prefill 图里每个线性注意力层都走这个函数。它的前半段（投影、卷积、拆 q/k/v、算 beta/g）与融合与否无关，差异只出现在最后一跳（`export_qwen3_5_4b_onnx.py:503-518`）：

```python
    if USE_CUSTOM_CGDR:
        core_attn_out, last_recurrent_state = _chunk_gated_delta_rule_custom(
            query, key, value, g=g, beta=beta,
            initial_state=None, output_final_state=True,
            use_qk_l2norm_in_kernel=True,
        )
    else:
        if layer.num_v_heads // layer.num_k_heads > 1:
            repeat = layer.num_v_heads // layer.num_k_heads
            query = query.repeat_interleave(repeat, dim=2)
            key = key.repeat_interleave(repeat, dim=2)
        core_attn_out, last_recurrent_state = _chunk_gated_delta_rule(
            query, key, value, g=g, beta=beta,
            initial_state=None, output_final_state=True,
            use_qk_l2norm_in_kernel=True,
        )
```

三个读点：

| 读点 | 事实 | 含义 |
|---|---|---|
| `initial_state=None` | Prefill 首层无前序状态 | Prefill 图不承担 state 池寻址，状态只出不进（linear 侧） |
| `use_qk_l2norm_in_kernel=True` | 两侧都声明要做 L2 归一化 | 融合路径下这件事发生在图里，由 adapter 显式补做，见 §3 |
| GQA 展开只在 `else` 里 | 融合路径不做 `repeat_interleave` | 头数复制由内核内部处理，图上因此少一整个展开子图 |

`else` 分支里那 4 行 `repeat_interleave` 是本次改动从主干位置上「搬」下来的：接入前它无条件执行，接入后只在未融合路径执行。这正对应 diff 台账 h16 的 9 行删除——删的是位置，不是逻辑。

**图上少掉的不只是展开**。未融合路径要跑完整的 chunk 递推（`_chunk_gated_delta_rule` 里含一个 `for i in range(1, chunk_size)` 的逐行三角求逆，`export_qwen3_5_4b_onnx.py:117-120`），全部会被 trace 成图节点；融合路径把这些压进一个 Custom 节点。以 chunk_size=64 计，仅这个循环就是 63 次带 `clone`/`sum` 的张量改写。这是接入 Custom 算子最直接的收益来源——**收益不在内核多快，而在图上少掉多少个非融合节点**。该判断来自代码结构对比（循环 vs 单节点），本篇不做性能度量。

函数尾部的返回三元组不随开关变化（`export_qwen3_5_4b_onnx.py:520-526`）：

```python
    core_attn_out = core_attn_out.reshape(-1, layer.head_v_dim)
    z = z.reshape(-1, layer.head_v_dim)
    core_attn_out = layer.norm(core_attn_out, z)
    core_attn_out = core_attn_out.reshape(batch_size, seq_len, -1)

    output = layer.out_proj(core_attn_out)
    return output, conv_state, last_recurrent_state
```

`conv_state` 从 `mixed_qkv` 的尾部切出来（`export_qwen3_5_4b_onnx.py:470-472`），与 CGDR 完全无关，但因为和 recurrent state 同批返回，它成了 `04` 篇里 NPU 常驻三件套之一。

## §2 forward：被 trace 的参考实现

`ChunkGatedDeltaRuleFunction.forward()` 的职责是「让 trace 拿到正确 shape 和 dtype」，不是「和内核逐位一致」。逐段看（`export_qwen3_5_4b_onnx.py:157-196`）：

```python
    @staticmethod
    def forward(ctx, query, key, value, beta, state, actual_seq_lengths, g_decay):
        """Run the PyTorch reference implementation used during ONNX export."""
        del ctx, actual_seq_lengths
        batch_size = state.shape[0]
        sequence_length = query.shape[0] // batch_size
        num_key_heads = query.shape[1]
        num_value_heads = value.shape[1]
        key_dim = query.shape[2]
        value_dim = value.shape[2]
```

**第一件怪事：`sequence_length` 是除出来的。** 因为 adapter 已经把 `[B, T, H, D]` 压成 `[B*T, H, D]` 的扁平 3D，`forward()` 只能靠 `query.shape[0] // batch_size` 反推 T，而 batch_size 又只能从 `state.shape[0]` 拿。这条「shape 信息在压平时丢失、再靠除法找回」的链路，是 batch=1 假设被写进实现层的直接后果：`B` 与 `T` 在扁平维度上不可分，只有先验知道 `B` 才能还原 `T`。

**第二件怪事：`del ctx, actual_seq_lengths`。** 这一行把两个形参显式声明为「本实现不用」。`ctx` 不用是因为 `torch.autograd.Function` 在这里只是导出期的 shape/dtype 载体，不需要为反向传播存任何东西（导出的图是前向的）；`actual_seq_lengths` 不用则暴露了参考实现与内核之间的一处真实不对齐——**内核按变长语义读这个入参，PyTorch 参考实现按整块 chunk 语义算，长度信息在它这里没有消费者**。因此 `forward()` 与 `symbolic()` 对同一入参的解释是不同的（推测：这是参考实现只在 batch=1、整段有效的前提下用于导出期推断，而不是用于逐位对拍的原因）。

拿到 5 个标量后，`forward()` 立刻把扁平 3D 逆推回 4D（`export_qwen3_5_4b_onnx.py:167-177`）：

```python
        query_4d = query.reshape(
            batch_size, sequence_length, num_key_heads, key_dim
        )
        key_4d = key.reshape(
            batch_size, sequence_length, num_key_heads, key_dim
        )
        value_4d = value.reshape(
            batch_size, sequence_length, num_value_heads, value_dim
        )
        beta_3d = beta.reshape(batch_size, sequence_length, num_value_heads)
        g_3d = g_decay.reshape(batch_size, sequence_length, num_value_heads)
```

这 11 行是 adapter 那 5 个 `.reshape(token_count, ...)` 的**逐行逆运算**：adapter 压平，`forward()` 复原，两处的维度顺序必须严格互逆。`beta` 与 `g` 从 4D 退到 3D（头维即最后一维，没有 head_dim），与 §4 里 `beta_flat`/`g_flat` 的二维扁平对应。`reshape` 而非 `view` 是有必要的——上游刚做过 `.contiguous().half()`，但 dtype 转换后仍不能保证内存布局可直接 `view`。

接着做 GQA 展开与 state 排布回转（`export_qwen3_5_4b_onnx.py:178-182`）：

```python
        if num_value_heads > num_key_heads:
            repeat = num_value_heads // num_key_heads
            query_4d = query_4d.repeat_interleave(repeat, dim=2)
            key_4d = key_4d.repeat_interleave(repeat, dim=2)
        state_model = state.transpose(-2, -1).contiguous().float()
```

注意方向：进来的 `state` 是内核排布 `[B, NV, DV, DK]`，`forward()` 先 `transpose(-2, -1)` 转回 HF 排布 `[B, NV, DK, DV]` 才喂给 `_chunk_gated_delta_rule`。出口再转回去（`export_qwen3_5_4b_onnx.py:194-196`）：

```python
        out = out.reshape(-1, num_value_heads, value_dim).to(torch.float16)
        final_state = final_state.transpose(-2, -1).contiguous().to(torch.float16)
        return out, final_state
```

于是 `forward()` 的完整形状契约是：**入口收内核排布 + FP16，出口给内核排布 + FP16**，中间用 HF 排布 + FP32 算。这样 `symbolic()` 声明的输出 dtype 与实际 trace 出来的 dtype 才自洽（`01` 篇 §3 的三处一致）。

`_chunk_gated_delta_rule`（`export_qwen3_5_4b_onnx.py:79-151`）本身是接入前就存在的纯 PyTorch 实现，本次未改动，本篇不重述它的算法。需要知道的只有一点：它要求输入已经是 `[B, H, T, D]`（内部第 89 行统一做 `transpose(1, 2)`），并在第 93-98 行按 `chunk_size=64` 做补齐：

```python
    pad_size = (chunk_size - sequence_length % chunk_size) % chunk_size
    query = F.pad(query, (0, 0, 0, pad_size))
```

## §3 symbolic 属性与缺省项

CGDR 的属性块全文（`export_qwen3_5_4b_onnx.py:199-226`）：

```python
    @staticmethod
    def symbolic(graph, query, key, value, beta, state, actual_seq_lengths, g_decay):
        """Export ChunkGatedDeltaRule as an ONNX Custom node."""
        scale_value = 1.0 / (128.0 ** 0.5)
        out, final_state = graph.op(
            "Custom",
            query,
            key,
            value,
            beta,
            state,
            actual_seq_lengths,
            g_decay,
            type_s="ChunkGatedDeltaRule",
            input_names_s=[
                "query", "key", "value", "beta", "initial_state",
                "actual_seq_lengths", "g",
            ],
            optional_input_names_s=["g"],
            output_names_s=["out", "final_state"],
            output_num_i=2,
            input_index_i=list(range(7)),
            scale_value_f=scale_value,
            dtype_i=10,
            outputs=2,
        )
        out.setType(value.type().with_dtype(torch.float16))
        final_state.setType(state.type().with_dtype(torch.float16))
        return out, final_state
```

与 RGDR 的属性对照，把「缺了什么」讲清楚：

| 属性 | CGDR | RGDR | 缺省的含义 |
|---|---|---|---|
| 入参数 | 7 | 9 | Prefill 无 state 池索引、无接受 token 数 |
| `input_index_i` | `list(range(7))` | `[0,1,2,3,4,5,6,7,9]` | CGDR 的注册签名与实际入参一一对应，无需投影 |
| `optional_input_names_s` | `["g"]` | `["g", "gk", "num_accepted_tokens"]` | Prefill 侧只有 decay 是可选的 |
| `output_types_i` | 无 | `[42, 42]` | CGDR 不显式声明输出 TypeId |
| `outputs_shape_s` | 无 | `"3,-1,32,128,4,-1,32,128,128,"` | CGDR 的输出 shape 由 GE 从输入推导 |
| `dtype_i` | `10` | `10` | 两侧都声明 ONNX FLOAT16 |
| `setType` 两行 | 有 | 有 | 保证 torch trace 的下游类型一致 |

**为什么 CGDR 可以省掉 `output_types_i` / `outputs_shape_s`（推测，依据是代码差异本身）**：Prefill 的两个输出——`out` 是 `[B, T, NV, DV]`、`final_state` 是 `[B, NV, DV, DK]`——都能由输入 shape 直接推出；而 Decode 的单 token 场景下，输出与输入在维度个数上并不平凡对应（state 是 4D，out 是 3D 扁平），所以要把 shape 契约写成字符串交给 GE。这条差异的真正原因需要内核侧注册表才能确证，本集不下定论。

`scale_value` 写死 128 的平方根倒数（两个类里同一行）。128 是 `linear_key_head_dim`。它是**烧进属性里的常量**，与 `dummy_past_len` 之类的可变项不同：换 head_dim 的模型必须改代码，导出期不会有任何提示。属于接入代价里的「隐性硬编码」一类。

## §4 state 排布转置

转置发生在三处，方向必须完全对称，否则 state 会在图上传输过程中被静默转错。整理成一张责任表：

| 位置 | 代码 | 方向 | 行号 |
|---|---|---|---|
| adapter 入口 | `initial_state.transpose(-2, -1).contiguous().half()` | HF `[B,NV,DK,DV]` → 内核 `[B,NV,DV,DK]` | `256` |
| `forward()` 入口 | `state.transpose(-2, -1).contiguous().float()` | 内核 → HF（供纯 PyTorch 参考实现使用） | `182` |
| `forward()` 出口 | `final_state.transpose(-2, -1).contiguous().to(torch.float16)` | HF → 内核 | `195` |
| adapter 出口 | `state_out.transpose(-2, -1).contiguous().float()` | 内核 → HF，并回 FP32 | `271` |

adapter 全文（`export_qwen3_5_4b_onnx.py:229-274`），保留关键行：

```python
def _chunk_gated_delta_rule_custom(query, key, value, g, beta, initial_state=None,
                                   output_final_state=False,
                                   use_qk_l2norm_in_kernel=False):
    """Qwen3.5 adapter for the 310P seven-input CGDR Custom operator."""
    initial_dtype = query.dtype
    if use_qk_l2norm_in_kernel:
        query = _l2norm(query, dim=-1, eps=1e-6)
        key = _l2norm(key, dim=-1, eps=1e-6)
```

…

```python
    if initial_state is None:
        state_custom = torch.zeros(
            batch_size, num_value_heads, value_dim, key_dim,
            dtype=torch.float16, device=query.device,
        )
    else:
        state_custom = initial_state.transpose(-2, -1).contiguous().half()
```

注意首帧分支 `torch.zeros(batch_size, num_value_heads, value_dim, key_dim, ...)`：参数顺序是 **value_dim 在前、key_dim 在后**，也就是 `[B, NV, DV, DK]`——内核排布。而非首帧分支是 `initial_state`（HF 排布）转置而来。**两条分支产出的排布一致**，这是这套对称设计成立的必要条件。

dtype 也一致：两条分支都落到 `torch.float16`。`01` 篇 §3 的结论在这里落地：既然 mapper 会看第一个输入的 dtype，adapter 干脆把所有进内核的张量都定成 FP16——

```python
    query_flat = query.reshape(token_count, num_key_heads, key_dim).contiguous().half()
    key_flat = key.reshape(token_count, num_key_heads, key_dim).contiguous().half()
    value_flat = value.reshape(
        token_count, num_value_heads, value_dim
    ).contiguous().half()
    beta_flat = beta.reshape(token_count, num_value_heads).contiguous().half()
    g_flat = g.reshape(token_count, num_value_heads).contiguous().float()
```

五个扁平化里四个是 `.half()`，**只有 `g`（decay）保持 `.float()`**。这是全篇唯一一处「内核边界上不是 FP16」的输入。`g` 在 `input_names_s` 里对应的名字是 `"g"`，且被列进 `optional_input_names_s`——它承载累加衰减，FP16 的动态范围对指数项不友好，保留 FP32 是有道理的取舍（此处为对代码选择的解读，非文档明示）。

## §5 首帧 state 与 actual_seq_lengths

CGDR 侧 `actual_seq_lengths` 的构造方法值得单独一节，因为它和 RGDR 侧走的是两条完全不同的路（`export_qwen3_5_4b_onnx.py:257-258`）：

```python
    query_shape = torch.onnx.operators.shape_as_tensor(query)
    actual_seq_lengths = query_shape[1:2].to(torch.int32).expand(batch_size)
```

含义：不引入新的图输入，而是**从 `query` 自身的 shape 节点派生**。`query` 是 `[B, T, H, D]`，`shape_as_tensor` 得到 `[B, T, H, D]` 四个标量，切第 1 维即 T，再 `expand` 到 batch 长度。图上表现为 `Shape → Slice → Cast → Expand` 四个普通节点接到 Custom 节点的入参 5。

对比表：

| 侧 | 构造式 | 图上表现 | 推理侧要不要每步供长度 |
|---|---|---|---|
| Prefill/CGDR | `shape_as_tensor(query)[1:2].to(int32).expand(B)` | shape 派生子图，随 `input_ids` 长度自动变 | 不要 |
| Decode/RGDR | `torch.full((batch_size,), sequence_length, ...)` | 常量（导出期折叠） | 不要，但语义退化为「每步 1」 |

这解释了为什么 Prefill 侧可以声明 `input_ids: {1: "seq_len"}` 的动态轴而链路上不出洞：序列长度不需要作为独立输入存在。

首帧 state 的另一个角度：`_linear_attn_prefill` 传的是 `initial_state=None`，于是 adapter 走全零分支。也就是说 **Prefill 图没有 recurrent state 输入**，只有输出。这与 `01` 篇 §5 的表一致：Prefill 的动态轴字典里压根没有 `past_*` 系列。三类 state 的「只出不进」正是 Prefill/Decode 分工的边界，Decode 侧的对应物见 `03` 篇 §1。

**关于 `ssm_state_indices`：CGDR 的 7 个入参里没有这一项**（`input_names_s` 只有 query/key/value/beta/initial_state/actual_seq_lengths/g）。因此「`torch.zeros(token_count)`、避免 trace 成 ONNX OneHot」这条约束在 Prefill 侧不适用，它属于 RGDR。目标提示词把它列在本篇要求下，本篇按代码事实归位到 `03-Decode接入RGDR.md` §5 讲解，并在该节反向引用此处。差异记入 `_journal.md`。

## §6 正确性与回退

「怎么知道自己接对了」在这一版里有三条隐含依据：

1. **同输入双路径可比**。`if/else` 两支吃完全相同的 `query, key, value, g, beta`，返回同样的三元组。开关只是换实现，不改上下游，因此任何 A/B 对比都是同分布的。`04` 篇 §6 的 `--host-state-roundtrip` 正是利用这种可比性做的运行时开关。
2. **参考实现承担了 shape/dtype 预言机角色**。`forward()` 必须与 `symbolic()` 输出契约一致（`01` 篇 §3 的三处一致），否则 torch 导出期就会解包或类型错误。也就是说，「能导出」本身就是对契约一致性的一次校验，尽管它不校验数值。
3. **默认路径未变**。`USE_CUSTOM_CGDR = False` 使得主干默认行为与接入前逐字节等价，回归风险被限制在「有人显式加参数」的范围内。

未融合路径自身也保留了一处与 batch 有关的行为：`else` 分支里按 `layer.num_v_heads // layer.num_k_heads` 决定是否展开，而融合路径把展开交给内核。两支在 batch>1 下是否严格等价，代码没有给出声明；`01` 篇 §5 的注释只保证融合路径按 batch=1 验证过。此处按「未声明」处理，不当作已支持。

**边界与坑清单（本篇范围）**：

| 坑 | 触发条件 | 症状 | 出处 |
|---|---|---|---|
| `scale_value` 烧死 128 | 换 head_dim 的模型 | 数值错，无报错 | `export_qwen3_5_4b_onnx.py:201` |
| `forward()` 靠除法还原 T | batch 未知或 >1 | shape 推断错 | `export_qwen3_5_4b_onnx.py:162` |
| 首帧 state 排布写反 | 手工改 adapter | 图上不报错，结果乱 | `export_qwen3_5_4b_onnx.py:250-256` |
| `g` 被顺手 `.half()` | 统一 dtype 时误改 | 长序列衰减数值崩 | `export_qwen3_5_4b_onnx.py:248` |

## §7 三处收尾细节：不要做两次、不要留 dtype 尾巴、不要假装没有 state

### 7.1 L2 归一化只能做两次中的一次

adapter 的入参 `use_qk_l2norm_in_kernel` 名义上表示「让内核去做归一化」。CGDR 的 7 个注册入参里没有这个开关位（`input_names_s` 见 §3），所以 adapter 选择在图内自己做（`export_qwen3_5_4b_onnx.py:233-236`）：

```python
    initial_dtype = query.dtype
    if use_qk_l2norm_in_kernel:
        query = _l2norm(query, dim=-1, eps=1e-6)
        key = _l2norm(key, dim=-1, eps=1e-6)
```

而 `forward()` 调用纯 PyTorch 参考实现时，把这个参数**显式传成 False**（`export_qwen3_5_4b_onnx.py:183-193`）：

```python
        out, final_state = _chunk_gated_delta_rule(
            query_4d,
            key_4d,
            value_4d,
            g=g_3d,
            beta=beta_3d,
            chunk_size=64,
            initial_state=state_model,
            output_final_state=True,
            use_qk_l2norm_in_kernel=False,
        )
```

两条合起来读才成立：归一化在 adapter 顶部做一次，`forward()` 里做第二次就会把 q/k 变成两次归一化的复合（对已单位化的向量再做一次，数值上虽接近恒等，但 `eps=1e-6` 会引入偏差）。

**「内核签名里没有这个开关」→「adapter 代做」→「参考实现必须关」，是一条三段因果**。这段结构说明 Custom 算子接入时，语义开关不会随 `graph.op` 自动消失——它必须有人在某一层把它接住，接的位置决定了它最终留在图上还是留在图外。留在图上（此处）意味着归一化仍是可融合的普通节点；只有 delta rule 本体被压成 Custom。

`chunk_size=64` 同样是硬编码常量，性质与 §3 的 `scale_value` 一样：改它要改代码，导出期无提示。

### 7.2 `initial_dtype` 让开关不改变上下游类型

adapter 的第一行是 `initial_dtype = query.dtype`，倒数第四行是 `.to(initial_dtype)`（`export_qwen3_5_4b_onnx.py:268-270`）：

```python
    core_attn_out = core_attn_out.reshape(
        batch_size, sequence_length, num_value_heads, value_dim
    ).to(initial_dtype)
```

FP16 只是**内核边界**的约定（`01` 篇 §3），不是模型层约定。这一行把输出退回调用方原本用的 dtype，于是 `USE_CUSTOM_CGDR` 打开与关闭时，`_linear_attn_prefill` 后半段的 `norm`/`out_proj` 看到的类型完全一致——这正是 §6 第 1 点「A/B 对比同分布」在 dtype 维度上的保障。若删掉这一行，融合路径会把 FP16 泄漏进下游，两条路径的比较就不再是同分布的了。

### 7.3 `output_final_state=False` 时返回 None，而不是空张量

```python
    state_out = state_out.transpose(-2, -1).contiguous().float()
    if not output_final_state:
        state_out = None
    return core_attn_out, state_out
```

（`export_qwen3_5_4b_onnx.py:271-274`）

注意这段的**顺序**：先做排布回转与 FP32 还原，再判断是否要丢弃。也就是说即使调用方不要 final state，图上仍然会产出这个 Custom 节点的第二个输出，只是被 Python 层丢弃——**`output_num_i=2` 是内核注册决定的，adapter 无权在导出期把它降成 1**。`01` 篇 §3 提到 Custom mapper 的 dtype 回退看「第一个输入」；与此对称的是，输出的存在性由注册表而非调用点决定。理解这一点，才能理解 `04` 篇里为什么 recurrent state 一定会作为 Prefill 图的第三个输出出现在 `prefill_out` 中。

在 Prefill 的实际调用点，`output_final_state=True`（§1 的代码块），所以 None 分支在本 PR 的 Prefill 路径上不会走到；它保留下来是为了与 `_recurrent_gated_delta_rule`（`03` 篇）保持同一套 adapter 签名。此处按代码事实陈述，不推断其未来用途。

