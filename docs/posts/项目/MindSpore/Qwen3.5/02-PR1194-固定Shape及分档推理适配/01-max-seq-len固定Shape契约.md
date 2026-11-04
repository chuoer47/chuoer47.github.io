# 01 `--max-seq-len` 固定 Shape 契约

> 前置讲清了变长 KV 为什么每步要新建输出 Tensor。本篇讲 !1194 把"每步都在变"换成"从头到尾不变"之后，契约的两侧各要付什么。

## 结论先行

1. **`--max-seq-len` 是全 PR 唯一的用户可写入口**，默认 `2048`（h18）。它在导出脚本里只有两个消费者：`Qwen35LlmPrefill.max_seq_len`（补齐输出 KV）和 `_export_llm_decode(..., max_seq_len=...)`（造 dummy mask 与 dummy KV 的宽度）。没有第三个真相源。
2. **它是被 `USE_CUSTOM_RGDR` 二次门控的**（h16）：不启用 RGDR 时，全量导出路径把 `max_seq_len` 折算成 `None` 交给 Prefill，Prefill 就完全走接入前的写法。参数存在但不生效，是本 PR 刻意的形状。
3. **"固定 Shape" 不是靠删动态轴实现的，而是靠"根本不传 `dynamic_axes`"**——终态把动态轴字典改成单一定义，只在 `not fixed_kv_cache` 时塞进 `export_options`。这一处（h15）是 02 篇 §5 的主题，本篇只在 §5 成本清单里记它的位置。
4. **Prefill 侧的补齐只碰一个轴**：`F.pad(present_kv_stack, (0, 0, 0, pad_size))` 只加长倒数第二轴；配套两条硬校验（输出长度超容 raise、`dummy_seq` 超容 raise），把"补齐"和"截断"区分开——本 PR 里没有截断这条路。
5. **图像注入必须换写法**：`masked_scatter` 依赖"按展平顺序消费源张量"，这个隐式游标在固定宽度的图上无法静态表达；终态改成 `cumsum/clamp(min=1)-1` 造索引 + 花式索引取值 + `torch.where` 写回（h04）。这是全 PR 里唯一一处"为固定 Shape 而重写的算子级语义"。
6. **推理侧不读任何 CLI**：容量从 Decode MindIR 元数据反推（`_detect_fixed_decode_capacity`，属 02 篇 §6），再由 `_prepare_decode_attention_mask` 的五条 raise 把 Host 侧输入钉死在这个容量上（h27/h45）。导出侧和推理侧之间没有任何显式参数传递，契约完全靠形状对齐。
7. **mask 从"每步拼接增长"变成"固定宽度上的前缀推进"**：`next_pos = int(attention_mask.sum())`、`attention_mask[0, next_pos] = 1`、达容量即 raise（h28/h47）。位置编码直接吃这个 `next_pos`，mask 与 Position 从两处计算变成同一处派生。
8. **A/B 双缓冲的前提是形状恒定**：`device_outputs["kv"]` 只在检测到固定容量时才预分配（h25），`_build_decode_step_io` 因此分叉成"取现成 buffer"和"每步重算 `kv_output_shape[-2] += 1`"两条（h26）。变长那条正是 !1169 的终态，本 PR 把它原样留在 `else` 分支。

## §1 --max-seq-len 的两处落点

### 1.1 入口：一个 CLI 参数

`export_qwen3_5_4b_onnx.py:1418-1423`
```python
    parser.add_argument("--dummy-seq-len", type=int, default=8,
        help="Dummy sequence length for LLM export",
    )
    parser.add_argument("--max-seq-len", type=int, default=2048,
        help="Maximum sequence length for the fixed Decode mask and KV cache",
    )
```

help 文案已经把契约说全了：固定的是 **Decode 的 mask 和 KV cache**，不是 Prefill 的输入长度。Prefill 输入长度走的是另一条线（04 篇 §2 的四档 `ge.dynamicDims`），两者共用同一个数值上限但不共用同一个机制。

`--max-seq-len` 与 `--dummy-seq-len` 被排在相邻位置不是巧合：后者是导出时喂给图的假序列长度，前者是图对外承诺的容量上限。终态给两者都加了校验，见 §2.3。

### 1.2 全量导出：透传但被门控

`main()` 的 `all` 分支把 CLI 值原样递下去（`export_qwen3_5_4b_onnx.py:1459-1464`）：

```python
    if args.component == "all":
        export_vision_tower(
            model, output_dir / "vision", args.device, args.vision_image_size
        )
        export_llm_prefill_decode(model, output_dir, args.device, args.dummy_seq_len,
                                  dtype=torch_dtype, max_seq_len=args.max_seq_len)
```

门控发生在被调用函数内部（h16，`export_qwen3_5_4b_onnx.py:1374-1393`）：

```python
    prefill = Qwen35LlmPrefill(
        text_model, lm_head, image_token_id,
        max_seq_len=max_seq_len if USE_CUSTOM_RGDR else None,
    ).to(device).eval()
    decode = Qwen35LlmDecode(
        text_model, lm_head, fixed_kv_cache=USE_CUSTOM_RGDR
    ).to(device).eval()

    # Independent component exports can assign the same graph-local external
    # data filename to different tensors.  Keep every graph self-contained so
    # that repeated or component-only exports cannot overwrite another graph.
    output_dir = Path(output_dir)
    _export_llm_prefill(
        prefill, output_dir / "prefill", device, dummy_seq,
        dummy_num_img_tokens, dtype=dtype,
    )
    _export_llm_decode(
        decode, meta, output_dir / "decode", device, dummy_seq,
        max_seq_len=max_seq_len,
    )
```

注意两个不对称：

| 消费者 | 门控方式 | 未启用 RGDR 时的实际取值 |
|---|---|---|
| `Qwen35LlmPrefill` | 构造实参里 `max_seq_len if USE_CUSTOM_RGDR else None` | `None`（哨兵值，不是 0 也不是 2048） |
| `_export_llm_decode` | 不做门控，`max_seq_len` 恒传入 | 仍是 2048，但函数内所有使用点都在 `if fixed_kv_cache` 之内 |

这个不对称是有意的：Prefill 用 `self.max_seq_len is None` 当分支条件（§2），所以必须在构造点折算；Decode 用 `decode.fixed_kv_cache` 当分支条件，`max_seq_len` 只是被它遮蔽的备用值。

### 1.3 单独导出：门控写在调用点

`--component prefill/decode` 两条分支（h21 归属 02 篇 §3）里，同样的判断写在了调用点上（`export_qwen3_5_4b_onnx.py:1465-1487`）：

```python
    elif args.component == "prefill":
        meta = _get_model_meta(model)
        text_model = meta["text_model"].to(args.device).eval()
        lm_head = meta["lm_head"].to(args.device).eval()
        prefill = Qwen35LlmPrefill(
            text_model, lm_head, meta["image_token_id"],
            max_seq_len=args.max_seq_len if USE_CUSTOM_RGDR else None,
        ).to(args.device).eval()
…
    else:
…
        decode = Qwen35LlmDecode(
            text_model, lm_head, fixed_kv_cache=USE_CUSTOM_RGDR
        ).to(args.device).eval()
        _export_llm_decode(
            decode, meta, output_dir / "decode", args.device, args.dummy_seq_len,
            max_seq_len=args.max_seq_len,
        )
```

**同一句三元表达式在文件里出现两次**（1376 与 1471）。!1194 没有把它抽成函数。代价是一个隐性约束：以后若给 Prefill 增加第三种门控条件，两处必须同步改。

### 1.4 落点一：`Qwen35LlmPrefill.max_seq_len`

h02/h03 只加了两行（`export_qwen3_5_4b_onnx.py:923-932`）：

```python
    def __init__(self, text_model, lm_head, image_token_id, max_seq_len=None):
        """
        Initialize the Qwen3.5 LLM prefill model.
        """
        super().__init__()
        self.text_model = text_model
        self.lm_head = lm_head
        self.image_token_id = int(image_token_id)
        self.config = text_model.config
        self.max_seq_len = None if max_seq_len is None else int(max_seq_len)
```

`int()` 转换看起来多余，实际是必要的：CLI 出来的是 `int`，但 `export_llm_prefill_decode` 也是库函数，允许外部以 `numpy` 整数或字符串调用。把它归一化在构造点，`forward` 里的两处 `self.max_seq_len` 比较才不必各自再转。

### 1.5 落点二：`_export_llm_decode` 的 `max_seq_len=2048` 形参

函数签名默认值也是 2048（h13，归属 02 篇 §5）。也就是说 **2048 这个数字在终态文件里出现在三个独立位置**：CLI 默认值、`export_llm_prefill_decode` 形参默认值、`_export_llm_decode` 形参默认值。三处一致纯靠人工维持。

| 位置 | 行号（终态） | 作用 |
|---|---|---|
| `--max-seq-len` default | 1421 | 用户不传时的值 |
| `export_llm_prefill_decode` default | 1360 | 库调用不传时的值 |
| `_export_llm_decode` default | 1263 | 单独调用该函数不传时的值 |

## §2 Prefill KV 补齐与越界报错

### 2.1 基线：一条 `masked_scatter`

```python
        inputs_embeds = self.text_model.embed_tokens(input_ids)
        image_mask = input_ids == self.image_token_id
        image_mask = image_mask.unsqueeze(-1).expand_as(inputs_embeds)
        inputs_embeds = inputs_embeds.masked_scatter(
            image_mask,
            image_embeds.to(device=inputs_embeds.device, dtype=inputs_embeds.dtype),
        )
```

### 2.2 终态：按 `max_seq_len` 分叉

```python
        inputs_embeds = self.text_model.embed_tokens(input_ids)
        image_mask = input_ids == self.image_token_id
        image_values = image_embeds.to(
            device=inputs_embeds.device, dtype=inputs_embeds.dtype
        )
        if self.max_seq_len is None:
            image_mask = image_mask.unsqueeze(-1).expand_as(inputs_embeds)
            inputs_embeds = inputs_embeds.masked_scatter(image_mask, image_values)
        else:
            image_indices = image_mask.long().cumsum(dim=1).clamp(min=1) - 1
            image_values = image_values[image_indices]
            inputs_embeds = torch.where(
                image_mask.unsqueeze(-1), image_values, inputs_embeds
            )
```

三条读法：

| 读点 | 事实 | 为什么固定长度下必须换 |
|---|---|---|
| `cumsum(dim=1)` 在 **token 轴**上做 | 得到的不是布尔掩码而是每个 token 的 image 序号 | 把 `masked_scatter` 的隐式"消费游标"显式化成一张索引张量 |
| `clamp(min=1) - 1` | 非 image token 位置的 cumsum 值为 0，先夹到 1 再减 1 得到合法的 0 索引 | 花式索引不接受负下标；这些位置的取值随后被 `where` 丢弃 |
| `torch.where(image_mask.unsqueeze(-1), ...)` | 写回不再依赖顺序 | `where` 是按位置取值的纯映射，图上每个节点形状都等于 `input_ids` 的形状 |

> 推测（标记）：把 `masked_scatter` 换掉的最可能动机是它在动态/固定宽度切换时会让导出图中的 scatter 索引依赖外部顺序；这是从代码形状推出的推断，不是文中标述的事实。

值得注意的副作用：`else` 分支里 `image_values[image_indices]` 会产出一个与 `inputs_embeds` 同形状的大张量，而 `masked_scatter` 是就地消费源数据。两条分支在导出期的内存占用不同量级，但只有 `else` 分支会进入最终 ONNX 图——运行时开销属于图结构，不属于 Python。

### 2.3 补齐：只加长一个轴

`export_qwen3_5_4b_onnx.py:999-1010`（h05）：

```python
        present_conv_stack = torch.stack(present_conv, dim=0) if present_conv else torch.zeros(0)
        present_recurrent_stack = torch.stack(present_recurrent, dim=0) if present_recurrent else torch.zeros(0)
        present_kv_stack = torch.stack(present_kv, dim=0) if present_kv else torch.zeros(0)
        if self.max_seq_len is not None and present_kv_stack.dim() >= 4:
            if present_kv_stack.shape[3] > self.max_seq_len:
                raise ValueError(
                    f"Prefill sequence length exceeds max_seq_len={self.max_seq_len}"
                )
            if present_kv_stack.shape[3] < self.max_seq_len:
                pad_size = self.max_seq_len - present_kv_stack.shape[3]
                present_kv_stack = F.pad(present_kv_stack, (0, 0, 0, pad_size))
```

`present_kv_stack` 的形状是 `[16, batch, 4, seq_len, 256]`（README 表里的 `16=8x2`，8 个全注意力层各出 k/v）。`F.pad` 的四元组 `(0, 0, 0, pad_size)` 只作用在最后两轴：`256` 不动、`seq_len` 在倒数第二轴尾部补零。所以：

- 补齐的是 **KV 的 token 槽位**，不是 head_dim；
- 补进来的槽位全是 0，配合 §3 的 mask 前缀语义（"有效位置只在前 N 个"），这些 0 槽位被图内的 `allowed` 判定挡在注意力之外（02 篇 §4）；
- 分支条件用 `> / <` 两个独立判断而不是 `!=` 加截断：**本 PR 明确不截断**。长度超限是错误，不是需要消化的输入。

`dim() >= 4` 这个守卫值得单独记一句：当模型没有任何全注意力层时 `present_kv_stack` 是 `torch.zeros(0)`（1 维），此时不补齐也不报错。这是防御性写法，在当前 Qwen3.5-4B 配置下不会触发（8 层全注意力）。

### 2.4 导出前的第二道闸

h10（`export_qwen3_5_4b_onnx.py:1209-1214`）：

```python
    if dummy_seq <= 0:
        raise ValueError(f"dummy_seq must be positive, but got {dummy_seq}")
    if prefill.max_seq_len is not None and dummy_seq > prefill.max_seq_len:
        raise ValueError(
            f"dummy_seq must be in [1, {prefill.max_seq_len}], but got {dummy_seq}"
        )
```

这条闸与 §2.3 的那条构成一对：**一条管"导出时喂进去的假输入"，一条管"图运行时真实输入"**。前者在 Python 层立刻失败，后者写在图里、以 `ValueError` 的形式在 trace 期失败——注意它只在 `dummy_seq` 超容时才会在导出期真的走到；正常导出时它是作为常量比较被折叠的。

README 的导出示例把 `--dummy-seq-len` 从基线值改成了 32（h31，05 篇 §3），正好落在 04 篇四档配置的第一档上。

### 2.5 三条 raise 的触发面

| 出处 | 文案（逐字） | 触发时机 |
|---|---|---|
| `export:1004-1006` | `Prefill sequence length exceeds max_seq_len={...}` | Prefill 前向时真实 KV 长度 > 容量 |
| `export:1210` | `dummy_seq must be positive, but got {...}` | 导出参数非法 |
| `export:1212-1214` | `dummy_seq must be in [1, {...}], but got {...}` | 导出假输入超过容量 |

三条都在导出侧，推理侧的对应物在 §3。

## §3 推理侧容量契约

### 3.1 终态：一个函数五条闸

`infer_qwen3_5_4b_mslite.py:439-464`（h27 引入、h45 抽出、h46 替换调用点）：

```python
    def _prepare_decode_attention_mask(self, attention_mask, past_kv):
        """Validate and pad the initial Decode attention mask when required."""
        capacity = self.fixed_decode_max_seq_len
        if capacity is None:
            return attention_mask.astype(np.int32)
        if attention_mask.shape[0] != 1:
            raise ValueError("fixed Decode currently supports batch=1 only")
        if attention_mask.shape[1] > capacity:
            raise ValueError(
                f"prompt length {attention_mask.shape[1]} exceeds fixed Decode "
                f"capacity {capacity}"
            )
        if int(past_kv.shape[-2]) != capacity:
            raise ValueError(
                f"Prefill KV capacity {past_kv.shape[-2]} does not match Decode "
                f"capacity {capacity}"
            )
        if not np.all((attention_mask == 0) | (attention_mask == 1)):
            raise ValueError("fixed Decode attention mask must contain only 0 or 1")
        valid_tokens = int(attention_mask.sum())
        expected_mask = np.arange(attention_mask.shape[1]) < valid_tokens
        if not np.array_equal(attention_mask[0].astype(bool), expected_mask):
            raise ValueError("fixed Decode requires a contiguous prefix attention mask")
        padded_mask = np.zeros((1, capacity), dtype=np.int32)
        padded_mask[:, :attention_mask.shape[1]] = attention_mask.astype(np.int32)
        return padded_mask
```

五条校验各自挡的是不同的错法：

| # | 条件 | 挡住的错法 | 为什么变长路径不需要它 |
|---|---|---|---|
| 1 | `shape[0] != 1` | batch>1 | 变长路径的 mask 是 `[batch, total_len]` 且 batch 是动态轴，容量与 batch 无关 |
| 2 | `shape[1] > capacity` | prompt 已经长过 KV 槽位数 | 变长路径 KV 与 mask 同步增长，永不出界 |
| 3 | `past_kv.shape[-2] != capacity` | Prefill 与 Decode 是两个不同 `--max-seq-len` 导出的模型 | 变长路径允许 Prefill 输出任意长度 |
| 4 | 只允许 0/1 | 传入加性 mask 或 float 概率 mask | `next_pos = mask.sum()` 只有在 0/1 时才等于有效长度 |
| 5 | 前缀连续 | `[1,1,0,1]` 这类空洞 mask | 同上：`sum()` 推位置要求有效位是纯前缀 |

第 3 条是全 PR 最关键的一条跨模型断言：**它把 Prefill 图和 Decode 图绑成一个不可拆分的配对**。用户混用两个不同容量导出的 MindIR 会在第一个 Decode step 之前就以 `ValueError` 结束，而不是在 NPU 上产生错值。

第 5 条的实现值得留意：它不是"检查有没有 0 后面跟 1"，而是重建期望前缀 `[1]*valid_tokens + [0]*rest` 再整体比对。这样 `[1,1,0,1]`（sum=3，期望 `[1,1,1,0]`）会被拒。

最后两行是"补齐"：宽度不足 `capacity` 时新建零矩阵，把原 mask 抄到左端。这与 §2.3 的 `F.pad` 是同一件事在两侧的两次实现——一次在图里补 KV，一次在 Host 上补 mask。

### 3.3 KV 输出 buffer：形状恒定才可能复用

h25（`infer_qwen3_5_4b_mslite.py:375-379`）：

```python
        if self.fixed_decode_max_seq_len is not None:
            device_outputs["kv"] = [
                _device_output_tensor(output_templates[3], past_kv.shape, device_name),
                _device_output_tensor(output_templates[3], past_kv.shape, device_name),
            ]
```

h26 让 `_build_decode_step_io` 分叉（`infer_qwen3_5_4b_mslite.py:402-418`）：

```python
        output_index = step_index & 1
        output_templates = device_outputs["templates"]
        if self.fixed_decode_max_seq_len is None:
            kv_output_shape = list(past_kv.shape)
            kv_output_shape[-2] += 1
            kv_output = _device_output_tensor(
                output_templates[3], kv_output_shape, device_outputs["device_name"]
            )
        else:
            kv_output = device_outputs["kv"][output_index]
        output_buffers = [
            device_outputs["logits"],
            device_outputs["conv"][output_index],
            device_outputs["recurrent"][output_index],
            kv_output,
        ]
        return decode_feed, output_buffers
```

基线只有前一条路：

```python
        kv_output_shape = list(past_kv.shape)
        kv_output_shape[-2] += 1
        output_index = step_index & 1
        output_templates = device_outputs["templates"]
        output_buffers = [
            device_outputs["logits"],
            device_outputs["conv"][output_index],
            device_outputs["recurrent"][output_index],
            _device_output_tensor(
                output_templates[3], kv_output_shape, device_outputs["device_name"]
            ),
        ]
```

`kv_output_shape[-2] += 1` 这一行在 !1169 的报告里是被当作"省掉了 Host→NPU 回传"的成果来讲的


!1194 把它降级成 `else` 分支保留：因为固定容量下输出形状与输入形状**相同**，于是 conv/recurrent/logits 三样东西的复用手法可以原封不动地搬到 KV 上——那三样从 !1169 起就是复用的，唯独 KV 因为每步 +1 而无法复用。这是本次改写在推理侧拿到的实际收益：**四类输出第一次变成同一套机制**。

`logits`/`conv`/`recurrent` 三个键在两个分支里都从 `device_outputs` 取，代码没有重复；只有 kv 需要分叉，而分叉点被收在一个 `if/else` 里，`output_buffers` 的构造保持单一。

### 3.4 调用点

`infer_qwen3_5_4b_mslite.py:486-499`：

```python
        generated = []
        generated.append(int(np.argmax(logits[0, -1])))
        if stream:
            self._stream_print_token(generated[-1])

        attn_mask_np = self._prepare_decode_attention_mask(attention_mask, past_kv)
        rope_deltas_np = rope_deltas.astype(np.int32)

        past_conv, past_recurrent, past_kv, device_state_init_ms, device_outputs = (
            self._initialize_decode_device_states(
                logits, past_conv, past_recurrent, past_kv
            )
        )
```

一个容易漏掉的顺序依赖：`_prepare_decode_attention_mask` 的第 3 条校验要读 `past_kv.shape[-2]`，因此它必须在 state 上传之前调用（`_initialize_decode_device_states` 会把 `past_kv` 换成 `mslite.Tensor`）。换成设备张量后 `.shape` 仍可读，但报错文案里的"Prefill KV 容量"语义就变成设备张量的了。终态选择先校验、后上传。

## §4 mask 推进与 next_pos

### 4.1 基线：拼接即增长

`src/449fbf7b/qwen3.5_4b/infer_qwen3_5_4b_mslite.py:405-418`：

```python
            wall_start = time.perf_counter()
            step_id = np.array([[generated[-1]]], dtype=np.int32)
            attn_mask_np = np.concatenate(
                [attn_mask_np, np.ones((1, 1), dtype=np.int32)], axis=1
            )
            total_len = int(attn_mask_np.shape[1])

            text_pos_step = np.array([[[total_len - 1]]], dtype=np.int32)
            mm_pos_step = np.broadcast_to(
                text_pos_step + rope_deltas_np.reshape(1, 1, 1), (3, 1, 1)
            ).copy()
            position_ids_step = np.concatenate(
                [text_pos_step, mm_pos_step], axis=0
            ).astype(np.int32)
```

位置的来源是 **mask 的宽度**（`shape[1] - 1`）。这条路在变长世界里成立，因为 mask 宽度始终等于"已写 KV 的槽位数"。

### 4.2 终态：固定宽度上只能问"有多少个 1"

`infer_qwen3_5_4b_mslite.py:466-478`（h28 引入内联版、h47 抽出）：

```python
    def _advance_decode_attention_mask(self, attention_mask):
        """Append or expose one valid Decode position and return its index."""
        capacity = self.fixed_decode_max_seq_len
        if capacity is None:
            attention_mask = np.concatenate(
                [attention_mask, np.ones((1, 1), dtype=np.int32)], axis=1
            )
            return attention_mask, int(attention_mask.shape[1]) - 1
        next_pos = int(attention_mask.sum())
        if next_pos >= capacity:
            raise ValueError(f"Decode reached fixed capacity {capacity}")
        attention_mask[0, next_pos] = 1
        return attention_mask, next_pos
```

docstring 里的 "Append or expose" 是两条路的准确概括：变长分支真的 `concatenate`（宽度 +1），固定分支只是把一个已有的 0 槽位**点亮**（宽度不变）。

固定分支返回 `next_pos` 之前先做 `>= capacity` 判断，因此可写的最大下标是 `capacity - 1`：当 `next_pos == capacity`（所有槽位都已有效）时报错。这意味着 **KV 的第 2048 个槽位是可以被写入的**，用完之后下一步才拒绝。

调用点（`infer_qwen3_5_4b_mslite.py:507-517`）：

```python
            wall_start = time.perf_counter()
            step_id = np.array([[generated[-1]]], dtype=np.int32)
            attn_mask_np, next_pos = self._advance_decode_attention_mask(attn_mask_np)

            text_pos_step = np.array([[[next_pos]]], dtype=np.int32)
            mm_pos_step = np.broadcast_to(
                text_pos_step + rope_deltas_np.reshape(1, 1, 1), (3, 1, 1)
            ).copy()
            position_ids_step = np.concatenate(
                [text_pos_step, mm_pos_step], axis=0
            ).astype(np.int32)
```

`total_len - 1` 换成 `next_pos`，其余四行一字未动。这是本 PR 里"最小改动面"的典型例子：真值来源换了，下游的 mRoPE 广播逻辑完全复用。
