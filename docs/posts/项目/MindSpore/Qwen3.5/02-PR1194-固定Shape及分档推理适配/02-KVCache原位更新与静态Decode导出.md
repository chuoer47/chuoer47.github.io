# 02 KV Cache 原位更新与静态 Decode 导出

> 前置：`01-max-seq-len固定Shape契约.md` 讲契约的两端；本篇讲图内部——"原位更新"这四个字在 ONNX 图上到底长什么样。

## 结论先行

1. **原位更新是靠"输出名等于输入名"表达的**。`ScatterUpdateFunction.symbolic` 写的是 `input_names_s=["var","indices","updates"]` + `output_names_s=["var"]`，输入张量和输出张量共用 `var` 这个名字；Ascend 侧的 Custom mapper 因此可以把这一节点识别成对同一块设备的写入。追踪期用的 `var.clone() + scatter_` 只是为了让 Python 层拿到正确数值，图上不存在 clone。
2. **写单条 KV 用的是"1 个索引 + 整块 updates"**。`forward` 里 `positions.reshape(-1,1,1,1).expand(B, KV, 1, head_dim)`，索引轴长度是 1、`updates` 的 seq 轴长度也是 1，一次 Scatter 写一层的一个头块。8 个全注意力层 × (k, v) = **16 个 Scatter 节点**，与 `90` 测试计划自述的节点数吻合。
3. **`axis` 被钉死为 2，并且 forward 里显式 raise**。BNSD 排布（batch-numHead-seq-headDim）下 token 轴是第 2 轴；`symbolic` 侧不做检查，只有 `forward` 检查——也就是说这个约束只在导出期生效，图上写错 axis 不会被拦住。
4. **`cache_pos` 是图上的标量张量，不是 Python 整数**：`(attention_mask.sum(dim=1, keepdim=True) - q_len).reshape(())`。这一步是全 PR 最关键的实现选择：位置由 mask 在图内算出来，所以同一张 Decode 图能在 2048 步里不做任何重编译地复用，Host 侧也不需要告诉图"现在第几步"。
5. **掩码从"加性 float 张量"换成"bool 张量"**。固定分支自己用 `arange <= cache_pos & mask` 造 `allowed`，再取反 view 成 `[1,1,1,max_seq_len]`；`_make_additive_causal_mask` 在固定路径上完全不被调用（但函数本身一字未改，仍由回退路径使用）。
6. **基线的 `past_len` 推导语被整段删掉**。基线那段 `for layer ... if kv_idx == 0 and past_kv_cache.shape[0] > 0: past_len = past_kv_cache[0].shape[2]` 里 `kv_idx` 在进入循环前恒为 0，条件依赖的是"第一个 full_attention 层"，写得很绕；终态 `else` 分支一行 `past_len = past_kv_cache.shape[3]` 取代了它——这是 h08 里 17 增 13 删的主要来源。
7. **"静态导出"的实现方式是不传 `dynamic_axes`**。终态把基线里两份并列的 `dynamic_axes` 字典合并成一份，然后 `if not fixed_kv_cache: export_options["dynamic_axes"] = dynamic_axes`。固定路径下 ONNX 图的所有输入输出都是导出期常量形状。
8. **推理侧靠元数据反推容量，不接受用户传参**：`_detect_fixed_decode_capacity` 读 `attention_mask`/`past_kv_cache`/`present_kv_cache` 三个描述符的形状，要求"mask 末轴 = past 倒数第二轴 = present 倒数第二轴 > 0"才认定固定（h29/h43/h44）。判据是**三个形状互相印证**，任何一个不吻合就退回变长流程。

## §1 Scatter 原位写 KV

### 1.1 完整实现

`export_qwen3_5_4b_onnx.py:698-733`：

```python
class ScatterUpdateFunction(torch.autograd.Function):
    """Export fixed KV-cache updates as the CANN Scatter Custom operator."""

    @staticmethod
    def forward(ctx, var, indices, updates, axis):
        """Run the cache update used while tracing the ONNX graph."""
        del ctx
        axis = int(axis)
        if axis != 2:
            raise ValueError(f"Only BNSD axis 2 is supported, but got axis={axis}")
        result = var.clone()
        positions = indices.to(torch.int64).reshape(-1)
        index = positions.reshape(-1, 1, 1, 1).expand(
            updates.size(0), updates.size(1), 1, updates.size(3)
        )
        result.scatter_(axis, index, updates.to(var.dtype))
        return result

    @staticmethod
    def symbolic(graph, var, indices, updates, axis):
        """Export a Scatter Custom node in update mode."""
        output = graph.op(
            "Custom",
            var,
            indices,
            updates,
            input_index_i=[0, 1, 2],
            input_names_s=["var", "indices", "updates"],
            optional_input_names_s=[],
            output_names_s=["var"],
            type_s="Scatter",
            reduce_s="update",
            axis_i=int(axis),
        )
        output.setType(var.type())
        return output
```

### 1.2 属性表逐项

这 8 个属性是 Lite Ascend Custom mapper 的输入。与 RGDR/CGDR 的属性写法同一套，本表只列 Scatter 自己需要的：

| 属性 | 值 | 语义 | 若不写会怎样 |
|---|---|---|---|
| `type_s` | `"Scatter"` | CANN 算子类型名，mapper 按它查内核 | Custom 节点无类型，转换失败 |
| `reduce_s` | `"update"` | 不做累加/取最值，直接覆盖 | 默认语义可能变成 add，KV 被污染 |
| `axis_i` | `2` | BNSD 的第 2 轴（token 轴） | 写错轴 = 写进 head_dim |
| `input_names_s` | `["var","indices","updates"]` | 三个实参的名字 | 内核取不到入参 |
| `optional_input_names_s` | `[]` | **无可选入参** | — |
| `output_names_s` | `["var"]` | 输出与输入同名 | — |
| `input_index_i` | `[0,1,2]` | 图上三个节点的顺序绑定 | — |

两个值得单独说的：

- **`output_names_s=["var"]` 与输入同名**。这不是笔误，是"原位"这件事在 ONNX 层唯一可表达的线索。目标提示词里"Scatter 原位更新 KV"的"原位"落到代码上就是这一行。
- **`optional_input_names_s=[]` 与 IFA 形成对照**。03 篇 §1 会看到 IFA 用 `["atten_mask"]` 声明了可选入参——同一个 PR 里两个 Custom 节点正好演示了这条属性的两种取值。

### 1.3 `forward` 只做追踪期的事

`result = var.clone()` + `result.scatter_(...)` 是给 PyTorch 参考实现用的，图上不存在 clone 节点（`symbolic` 只输出一个 `Custom`）。但 `forward` 里有两处约束值得注意：

| 行 | 约束 | 生效期 |
|---|---|---|
| `if axis != 2: raise` | 只允许 BNSD 的 token 轴 | **仅导出期**；`symbolic` 不检查 |
| `updates.size(0), updates.size(1), 1, updates.size(3)` | 索引张量在 seq 轴上长度必须是 1 | 仅导出期；决定了每节点只写 1 个 token 槽 |

第二行还有一个隐含前提：`updates` 是 4D（`expand` 用了 `size(0..3)`）。Decode 的 `key_states` 在 `apply_rotary_pos_emb` 之后是 `[B, KV, q_len, head_dim]`，`q_len=1` 时正好满足。**若有人把这段搬到 Prefill，`q_len>1` 会让 expand 出来的索引形状对不上**——这是"原位更新只服务 Decode 单 token"的结构性原因，不是策略选择。

## §2 `_kv_cache_update` 与 `cache_pos`

### 2.1 三行 adapter

`export_qwen3_5_4b_onnx.py:736-739`：

```python
def _kv_cache_update(past, update, cache_pos):
    """Write the current key or value into a fixed-capacity BNSD cache."""
    indices = cache_pos.reshape(-1).to(torch.int64)
    return ScatterUpdateFunction.apply(past, indices, update.to(past.dtype), 2)
```

三件事按顺序发生：`cache_pos` 展平成 1 元素索引、`update` 折算到 cache 的 dtype（FP16）、`axis` 硬编码 2。dtype 折算在这里做而不是在 `forward` 里做，是因为 `forward` 已经写了 `updates.to(var.dtype)`——两处都写，等于双保险。

### 2.2 每层调两次

`export_qwen3_5_4b_onnx.py:778-779`：

```python
    key_cache = _kv_cache_update(past_key, key_states, cache_pos)
    value_cache = _kv_cache_update(past_value, value_states, cache_pos)
```

k 与 v 各一次，`past_key`/`past_value` 来自 `Qwen35LlmDecode.forward` 里按 `kv_idx`、`kv_idx+1` 切出来的一对（§3.3）。所以层数与节点数的关系是：

| 量 | 值 | 来源 |
|---|---|---|
| 全注意力层数 | 8 | README Shape 表 `16=8x2`（`src/942a0107/.../README.md:395`） |
| 每层 Scatter 节点 | 2 | k 与 v 各一 |
| Scatter 节点合计 | 16 | `90` 测试计划第 2 条 |

```text 出处=90
   - Decode ONNX包含24个`RecurrentGatedDeltaRule`、16个`Scatter`和8个`IncreFlashAttention`节点。
```

24 个 RGDR 对应 24 层线性注意力（同表 `24, batch, 8192, 3`），8 个 IFA 对应 8 个全注意力层——**三类节点的计数比例 24:16:8 就是模型层配置 24 线性 + 8 全注意力的直接投影**，任何一个不吻合都说明图结构偏离预期。这是 `90` 那条自述的实际用途。

### 2.3 `cache_pos` 从哪来

`cache_pos` 由 `Qwen35LlmDecode.forward` 计算后穿过层函数（h09），见 §4。本篇先记下它在 adapter 层的形态：一个**形状为 `[]` 的标量张量**被 `reshape(-1)` 成 `[1]`。图上它就是一条 `ReduceSum → Sub → Reshape → Cast` 的末端。

## §3 `fixed_kv_cache` 开关

### 3.1 构造参数

`:1018-1032`：

```python
    def __init__(self, text_model, lm_head, fixed_kv_cache=False):
        """
        Initialize the Qwen3.5 LLM decode model.
        """
        super().__init__()
        self.text_model = text_model
        self.lm_head = lm_head
        self.config = text_model.config
        self.fixed_kv_cache = bool(fixed_kv_cache)

    def forward(self, input_ids, attention_mask, position_ids,
                past_conv_states, past_recurrent_states, past_kv_cache):
        """
        Decode with either the original growing cache or a fixed-capacity cache.
        """
```

**把两种 cache 点名**的说明。这类 docstring 改述在本 PR 里出现了三次（本处、`_export_llm_decode`、`_decode_generate` 的间接改述），共同点是：函数签名兼容、行为分叉，于是靠文档字符串承载"现在有两种"的事实。

### 3.2 谁把它设为 True

只有一个来源：`USE_CUSTOM_RGDR`。

```python
    decode = Qwen35LlmDecode(
        text_model, lm_head, fixed_kv_cache=USE_CUSTOM_RGDR
    ).to(device).eval()
```

该片段在终态出现两次（`export_qwen3_5_4b_onnx.py:1378-1380` 与 `:1481-1483`），已在 01 篇 §1.2、§1.3 逐字给出，此处不重复。**没有独立的 `--enable-fixed-kv-cache` 开关**：固定 KV 与 RGDR 被绑成同一个开关，因此用户无法组合出"RGDR + 变长 KV"或"未融合 + 固定 KV"。

> 推测（标记）：绑定最可能的原因是 IFA 这个内核只在 KV 容量恒定时才可用（03 篇 §4 的头数限制、§5 的视图膨胀都建立在 `cache_len` 已知的前提上）。代码里没有写明这一点。

### 3.3 开关在层循环里的用法

终态 `export_qwen3_5_4b_onnx.py:1083-1099`：

```python
            else:
                pk_in = past_kv_cache[kv_idx]
                pv_in = past_kv_cache[kv_idx + 1]
                if self.fixed_kv_cache:
                    attn_out, pk, pv = _full_attn_decode_fixed(
                        layer.self_attn, hidden_states, position_embeddings, attn_mask,
                        pk_in, pv_in, cache_pos,
                    )
                else:
                    attn_out, pk, pv = _full_attn_forward(
                        layer.self_attn, hidden_states, position_embeddings, attn_mask,
                        pk_in, pv_in,
                    )
                hidden_states = residual + attn_out
                present_kv.append(pk)
                present_kv.append(pv)
                kv_idx += 2
```

基线同位置（`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:891-901`）：

```python
            else:
                pk_in = past_kv_cache[kv_idx]
                pv_in = past_kv_cache[kv_idx + 1]
                attn_out, pk, pv = _full_attn_forward(
                    layer.self_attn, hidden_states, position_embeddings, attn_mask,
                    pk_in, pv_in,
                )
                hidden_states = residual + attn_out
                present_kv.append(pk)
                present_kv.append(pv)
                kv_idx += 2
```

差异只有 `if/else` 那 8 行。注意**两个分支返回的 `pk`/`pv` 都被 append 进 `present_kv`**：固定分支返回的是 Scatter 的输出（同一形状的完整 cache，不是新 token），所以输出列表的长度、顺序、命名与基线一致，`present_kv_cache` 这个名字与轴序没有任何变化。这是"原位更新"能无缝接回 Host 侧的原因——从接口看，它仍是一个"输出全量新 cache"的模型。

## §4 图内 mask 构造与 `cache_pos`

### 4.1 基线：先探长度，再造加性掩码

`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:855-868`：

```python
        position_embeddings = self.text_model.rotary_emb(inputs_embeds, mm_position_ids)

        past_len = 0
        kv_idx = 0
        for layer in self.text_model.layers:
            if layer.layer_type == "full_attention":
                if kv_idx == 0 and past_kv_cache.shape[0] > 0:
                    past_len = past_kv_cache[0].shape[2]
                break

        k_len = past_len + q_len
        attn_mask = _make_additive_causal_mask(
            attention_mask, q_len, k_len, past_len, inputs_embeds.dtype
        )
```

这段的 `past_len = 0` 初值加循环内赋值，实际效果是"取第一个 full_attention 层的 cache 长度"。它依赖 `past_kv_cache[0].shape[2]`——注意是第 2 轴：因为 `past_kv_cache[0]` 已经降了一轴，第 2 轴就是 token 轴。等价于 `past_kv_cache.shape[3]`，但要绕两个索引。

### 4.2 终态：一次分叉，两条路

`export_qwen3_5_4b_onnx.py:1043-1060`（h08，17 增 13 删）：

```python
        position_embeddings = self.text_model.rotary_emb(inputs_embeds, mm_position_ids)
        cache_pos = None
        if self.fixed_kv_cache:
            max_seq_len = past_kv_cache.shape[3]
            total_valid_tokens = attention_mask.sum(dim=1, keepdim=True)
            cache_pos = (total_valid_tokens - q_len).reshape(())
            kv_range = torch.arange(
                max_seq_len, device=inputs_embeds.device, dtype=torch.int64
            )
            allowed = kv_range.view(1, -1) <= cache_pos.view(-1, 1)
            allowed = allowed & attention_mask.to(torch.bool)
            attn_mask = (~allowed).view(-1, 1, 1, max_seq_len)
        else:
            past_len = past_kv_cache.shape[3]
            k_len = past_len + q_len
            attn_mask = _make_additive_causal_mask(
                attention_mask, q_len, k_len, past_len, inputs_embeds.dtype
            )
```

`else` 分支把 §4.1 的 12 行压成 1 行 `past_len = past_kv_cache.shape[3]`。这是台账里"死代码改为 shape[3]"那条的含义：基线循环里的分支在真实模型上只会执行一次并 break，条件 `kv_idx == 0` 恒真、`shape[0] > 0` 由 cache 非空保证，因此整个循环是 `shape[3]` 的一种昂贵写法。终态直接写出来。

### 4.3 固定分支的逐算子解读

| 行 | 算子 | 形状 | 作用 |
|---|---|---|---|
| `max_seq_len = past_kv_cache.shape[3]` | Shape/Gather | Python int（导出期常量） | 容量从**输入张量的形状**读出，不从参数读 |
| `attention_mask.sum(dim=1, keepdim=True)` | ReduceSum | `[1,1]` | 有效 token 数 = 前缀 1 的个数 |
| `- q_len` | Sub | `[1,1]` | 去掉本步新 token，得到写入位置 |
| `.reshape(())` | Reshape | `[]` | 变标量，供 Scatter 与广播两侧使用 |
| `torch.arange(max_seq_len, ...)` | Range | `[2048]` | 槽位号 |
| `kv_range.view(1,-1) <= cache_pos.view(-1,1)` | LessOrEqual + 广播 | `[1,2048]` | "槽位号不超过当前位置"= 因果性 |
| `allowed & attention_mask.to(torch.bool)` | LogicalAnd | `[1,2048]` | 因果 ∩ padding，与加性版本的语义等价 |
| `(~allowed).view(-1,1,1,max_seq_len)` | LogicalNot + Reshape | `[1,1,1,2048]` | 输出为 **True 表示屏蔽**，交给 IFA 的 `masked_fill` |

两个要点：

1. **因果性与 padding 被拆成两次显式布尔运算**。基线的 `_make_additive_causal_mask` 是把两者乘加成浮坑值（`mask_value = torch.finfo(dtype).min`）后相加；终态固定分支不碰 `finfo`，纯布尔。图上因此少了 `Cast/Mul/Sub` 一串浮点常量节点。
2. **`max_seq_len` 来自 `shape[3]` 而不是 Python 常量**。`arange` 的长度在 trace 期由实际输入决定，导出后它就是图上的固定维长；这与 §5 的"不传 dynamic_axes"配套——容量的唯一真相是**这张图自己的输入形状**。

> 观察（非缺陷）：`cache_pos` 的推导用了 `q_len`，而固定路径只支持 `q_len=1`（`_export_llm_decode` 里 `dummy_step = 1`）。若有人以 `q_len>1` 调固定 forward，`cache_pos` 会是"有效数减 q_len"，而 Scatter 只写 1 个槽位——数值会错但不报错。代码里没有对 `q_len == 1` 的断言。

### 4.4 `_make_additive_causal_mask` 未被改写

终态 `export_qwen3_5_4b_onnx.py:64-76` 与基线逐字相同（同一段 helper 在两棵树里行号一致），本 PR 只在固定路径绕开它。这条事实的意义在于：回退路径的掩码语义与 !1169 时代**完全一致**，A/B 对照时不存在"掩码实现也被顺手改了"的干扰。

## §5 静态导出与 dummy 构造

### 5.1 签名与两道校验

终态 `export_qwen3_5_4b_onnx.py:1263-1279`（h13）：

```python
def _export_llm_decode(decode, meta, output_dir, device, dummy_seq, max_seq_len=2048):
    """
    Export fixed-cache Custom Decode or the original dynamic fallback graph.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    decode_path = output_dir / "qwen3_5_llm_decode.onnx"
    dummy_step = 1
    dummy_past_len = dummy_seq
    fixed_kv_cache = decode.fixed_kv_cache
    if dummy_past_len <= 0:
        raise ValueError(f"dummy_seq must be positive, but got {dummy_past_len}")
    if fixed_kv_cache and dummy_past_len + dummy_step > max_seq_len:
        raise ValueError(
            f"dummy_seq must be in [1, {max_seq_len - dummy_step}], "
            f"but got {dummy_past_len}"
        )
```

`fixed_kv_cache = decode.fixed_kv_cache` 这一行把"从模型对象读开关"固化成局部变量，后面 8 处引用都用它。**容量的唯一入口是 `decode` 对象自身**，与 §4.3 的 `shape[3]` 一致。

基线（`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:1056-1072`）没有这两道校验，`dummy_past_len = dummy_seq` 直接参与构造。

### 5.2 dummy mask：固定宽度 + 前缀 1

终态 `export_qwen3_5_4b_onnx.py:1280-1295`：

```python
    dummy_input_ids_step = torch.randint(
        0, 1000, (1, dummy_step), dtype=torch.int64, device=device
    )
    if fixed_kv_cache:
        dummy_attention_mask_step = torch.zeros(
            1, max_seq_len, dtype=torch.int64, device=device
        )
        dummy_attention_mask_step[:, :dummy_past_len + dummy_step] = 1
        kv_cache_len = max_seq_len
    else:
        dummy_attention_mask_step = torch.ones(
            1, dummy_past_len + dummy_step, dtype=torch.int64, device=device
        )
        kv_cache_len = dummy_past_len
    step_pos = torch.tensor([[dummy_past_len]], dtype=torch.int64, device=device)
    dummy_position_ids_step = step_pos.unsqueeze(0).expand(4, 1, dummy_step)
```

两条 dummy mask 的形状差是本次改写的核心对照：基线是 `[1, dummy_seq+1]`（跟着 dummy 长度走），终态固定路径是 `[1, max_seq_len]`（跟着容量走）。

dummy mask 必须是**前缀 1**（`[:, :n] = 1`），因为 §4.3 的 `sum()` 推导只有在前缀成立时才给出正确位置；若 dummy 用全 1 再加尾部 0 的随机形状，追踪期算出的 `cache_pos` 与 Scatter 写入的槽位就会不一致，导出的图虽然形状对，但常量折叠会把错误位置烧进子图。这与推理侧 §3.1（01 篇）的第 5 条校验是同一条约束在导出期的体现。

`dummy_past_kv` 的长度由 `kv_cache_len` 决定（h14，终态 `:1315-1318`）：

```python
    dummy_past_kv = torch.zeros(
        2 * num_full, 1, num_kv_heads, kv_cache_len, head_dim,
        dtype=torch.float16, device=device,
    )
```

基线此处是 `dummy_past_len`（`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:1092-1095`）。也就是说：固定路径下 dummy KV 与 dummy mask 同为 `max_seq_len` 宽，回退路径下两者同为 `dummy_past_len`——**dummy 始终自洽**，`_detect_fixed_decode_capacity` 的三形状互印条件才可能在推理侧成立。

### 5.3 动态轴：从两份并列变成一份 + 一个 if

终态 `export_qwen3_5_4b_onnx.py:1324-1354`（h15，25 增 24 删）：

```python
    dynamic_axes = {
        "input_ids": {0: "batch", 1: "step"},
        "attention_mask": {0: "batch", 1: "total_seq_len"},
        "position_ids": {1: "batch", 2: "step"},
        "past_conv_states": {1: "batch"},
        "past_recurrent_states": {1: "batch"},
        "past_kv_cache": {1: "batch", 3: "past_seq_len"},
        "logits": {0: "batch", 1: "step"},
        "present_conv_states": {1: "batch"},
        "present_recurrent_states": {1: "batch"},
        "present_kv_cache": {1: "batch", 3: "total_seq_len"},
    }
    from torch.onnx import utils as onnx_utils
    shape_info = f"max_seq_len={max_seq_len}" if fixed_kv_cache else "dynamic KV cache"
    print(f"Exporting LLM decode to {decode_path} ({shape_info})...")
    export_options = {
        "input_names": input_names,
        "output_names": output_names,
        "opset_version": 14,
        "do_constant_folding": True,
    }
    if not fixed_kv_cache:
        export_options["dynamic_axes"] = dynamic_axes
    with torch.no_grad():
        onnx_utils.export(
            decode,
            (dummy_input_ids_step, dummy_attention_mask_step, dummy_position_ids_step,
             dummy_past_conv, dummy_past_recurrent, dummy_past_kv),
            str(decode_path),
            **export_options,
        )
```

被删掉的 24 行是基线里 `if USE_CUSTOM_RGDR: ... else: ...` 的两份字典（`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:1101-1120`）：

```python
    if USE_CUSTOM_RGDR:
        # RGDR is used for single-token, batch-one autoregressive Decode.
        dynamic_axes = {
            "attention_mask": {1: "total_seq_len"},
            "past_kv_cache": {3: "past_seq_len"},
            "present_kv_cache": {3: "total_seq_len"},
        }
    else:
…
```

三件事同时发生了变化，这是本 PR 里最值得单独看清的一处：

| 维度 | 基线（!1169 终态） | 终态（!1194） |
|---|---|---|
| RGDR 开启时的动态轴 | 3 条（mask 第 1 轴、past/present KV 第 3 轴） | **0 条**（不传） |
| 未开启时的动态轴 | 10 项全量字典 | 同一份 10 项字典，原样保留 |
| 判断依据 | 全局 `USE_CUSTOM_RGDR` | 局部 `decode.fixed_kv_cache` |

第一行是"静态化"的全部含义。第二行说明回退路径的动态轴**一条都没少**（包括 batch），所以 `--host-state-roundtrip` 与未融合路径的兼容性没有被削弱。第三行是风格上的改进：把"读模块全局"改成"读模型属性"，使 `_export_llm_decode` 在库调用时不再依赖全局变量被正确设置。

`shape_info` 那一行是本次导出期唯一的自证信息：日志会打印 `max_seq_len=2048` 或 `dynamic KV cache`。除它以外没有任何运行时打印能区分两条路——运行时区分靠的是 `Detected fixed Decode cache capacity: N`（§6.3）。

### 5.4 调用点

h17（终态 `:1390-1393`）已在 01 篇 §1.2 的块里逐字给出：`_export_llm_decode(decode, meta, output_dir / "decode", device, dummy_seq, max_seq_len=max_seq_len)`。`--component decode` 分支（h21）同样透传 `args.max_seq_len`，见 01 篇 §1.3。

## §6 容量反推

### 6.1 生命周期三个点

| 时点 | 代码 | hunk |
|---|---|---|
| 构造期置 `None` | `infer_qwen3_5_4b_mslite.py:294` | h24 |
| Decode 建模后写入 | `:642-647` | h29 |
| `finally` 释放时复位 | `:654-657` | h30 |

写入点（h29）：

```python
            self.fixed_decode_max_seq_len = self._detect_fixed_decode_capacity()
            if self.fixed_decode_max_seq_len is not None:
                print(
                    "Detected fixed Decode cache capacity: "
                    f"{self.fixed_decode_max_seq_len}"
                )
```

复位点（h30）：

```python
        finally:
            self.decode_model = None
            self.fixed_decode_max_seq_len = None
            gc.collect()
```

h30 只加了一行，但它是**跨会话正确性的唯一保证**：终态有四处分支条件读这个字段（`:375` 建 kv 双缓冲、`:404` 选 KV 输出来源、`:441` mask 五条校验、`:468` mask 推进方式），全部把它当作"这张 Decode 图是不是固定容量"的唯一判据。若一次固定容量会话结束后不再复位，紧接着以变长模型跑第二轮时会继续走固定分支，最先撞上的是 `_prepare_decode_attention_mask` 里 `past_kv.shape[-2] != capacity` 那条 `ValueError`；只有当变长模型的 prompt 长度恰好等于残留容量时才会漏过去，那时错到 `device_outputs` 的形状匹配才暴露。把复位写在 `finally` 里而不是成功路径末尾，说明作者考虑到了中途 `raise` 的情形。

### 6.2 判据

终态 `infer_qwen3_5_4b_mslite.py:420-437`（h43/h44 改后）：

```python
    def _detect_fixed_decode_capacity(self):
        """Return the fixed Decode cache capacity, or None for a growing cache."""
        input_list = self.decode_model.get_inputs()
        output_list = self.decode_model.get_outputs()
        attention = _find_model_tensor(input_list, "attention_mask", 1)
        past_kv = _find_model_tensor(input_list, "past_kv_cache", 5)
        present_kv = _find_model_tensor(output_list, "present_kv_cache", 3)
        if attention is None or past_kv is None or present_kv is None:
            return None
        attention_shape = [int(dim) for dim in attention.shape]
        past_shape = [int(dim) for dim in past_kv.shape]
        present_shape = [int(dim) for dim in present_kv.shape]
        if len(attention_shape) < 2 or len(past_shape) < 4 or len(present_shape) < 4:
            return None
        capacity = attention_shape[-1]
        if capacity > 0 and past_shape[-2] == capacity and present_shape[-2] == capacity:
            return capacity
        return None
```

三个形状互相印证的含义：

| 条件 | 挡住的对象 |
|---|---|
| `capacity > 0` | 动态轴（在 MindIR 元数据里通常是 `-1` 或 `0`） |
| `past_shape[-2] == capacity` | Prefill 输出与 Decode 输入宽度不同的错配模型 |
| `present_shape[-2] == capacity` | 仍会增长的 KV 输出（变长图必然 `present = past + 1`） |

第三行是关键：**变长 Decode 图的 `present_kv_cache` 末两轴比 `past` 多 1**（§5.2 与 !1169 报告 `04` §5 同口径），所以这条判据能可靠区分两条路，而不需要读任何外部标记。

### 6.3 第三个 commit 的原始写法，与 h43/h44 的差别

`src/a151fcd1/qwen3.5_4b/infer_qwen3_5_4b_mslite.py:388-413`：

```python
    def _detect_fixed_decode_capacity(self):
        """Return the fixed Decode cache capacity, or None for a growing cache."""
        input_list = self.decode_model.get_inputs()
        output_list = self.decode_model.get_outputs()
        inputs = {getattr(tensor, "name", ""): tensor for tensor in input_list}
        outputs = {getattr(tensor, "name", ""): tensor for tensor in output_list}
        attention = inputs.get("attention_mask")
        past_kv = inputs.get("past_kv_cache")
        present_kv = outputs.get("present_kv_cache")
        if attention is None and len(input_list) > 1:
            attention = input_list[1]
        if past_kv is None and len(input_list) > 5:
            past_kv = input_list[5]
        if present_kv is None and len(output_list) > 3:
            present_kv = output_list[3]
…
```

末 11 行判据与终态逐字一致（`a151fcd1:403-413` == `942a0107:427-437`）。h43/h44 做的是：把"建两个字典 + 三次 `get` + 三段 `is None and len>` 兜底"（11 行）换成"三次 `_find_model_tensor` 调用"（3 行），并抽出通用小函数（终态 `:250-257`）：

```python
def _find_model_tensor(tensors, name, fallback_index):
    """Find a model tensor by name, with an order-based fallback."""
    for tensor in tensors:
        if getattr(tensor, "name", "") == name:
            return tensor
    if len(tensors) > fallback_index:
        return tensors[fallback_index]
    return None
```

台账里 h44 记的是 `3 增 11 删`，净减 8 行；这次改写的动机不在功能——**是门禁**：`91-R06` 的 `Check_Lizard` 单项 FAILURE 与第四个 commit 标题（`05` 篇 §2 详述）。也就是说，"从元数据反推容量"这件事在第三个 commit 就已经能跑，第四个 commit 只是把它改写成复杂度检查能接受的样子。
