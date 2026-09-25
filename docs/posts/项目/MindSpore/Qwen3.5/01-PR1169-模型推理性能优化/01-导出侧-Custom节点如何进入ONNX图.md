# 01 导出侧：Custom 节点如何进入 ONNX 图

> 所属报告集：`reports-PR1169/`（PR !1169，合入 commit `43b97b06`）
> 本篇参照树：`src/43b97b06/qwen3.5_4b/export_qwen3_5_4b_onnx.py`（1261 行）。基线树 `src/909a1a75` 只在需要「改动前是什么形状」时按 diff 台账引用。
> 对应 diff 台账行：h13、h18–h25（见 `_coverage_diff.tsv`）。

## 结论先行

1. **`torch.autograd.Function` 是这条链路唯一的「双语接口」**：`forward()` 里的纯 PyTorch 代码是给导出器 trace 用的参考实现，决定数值语义；`symbolic()` 才是真正往 ONNX 图里写节点的地方，决定图上长什么样。!1169 的全部导出侧改动都落在这两个静态方法的配对上，图外没有第二个入口。
2. **Custom 节点不携带算子实现，只携带一份「属性契约」**。`type_s` 是内核注册名，`input_names_s` / `optional_input_names_s` / `input_index_i` 描述 GE 侧算子签名，`output_names_s` / `output_num_i` / `output_types_i` / `outputs_shape_s` 描述输出契约。任何一项与注册到 CANN 的 OpDef 不一致，故障都发生在转换期而不是运行期，且报错信息通常不指向具体属性——这就是本篇要把词典逐个钉死的原因。
3. **最贵的一条隐性约束是 dtype**：Lite 的 Ascend Custom mapper 在一张图里含多个 Custom 类型时，会回退到「第一个输入的 dtype」来分配输出。因此 CGDR/RGDR 的图输出被强制声明成 FP16（MindSpore TypeId `42`），而模型侧的 recurrent state 仍是 FP32，只能在出图后靠一次显式 `.transpose(-2, -1).contiguous().float()` 转回来。这是一条「为了让 mapper 不猜错而付出的精度代价」。
4. **代价还包括表达能力**：`--enable-cgdr-custom` / `--enable-rgdr-custom` 打开时，导出的图把 batch 维从动态轴里摘掉，等价于宣布「融合路径只支持 batch=1 的演示链路」。原有多 batch 动态轴路径完整保留在 `else` 分支里，靠开关回退。
5. **一个自定义算子真正进主干，改的不只是算子接入点**：!1169 的 37 个 hunk 里，导出侧占 13 个，其中 8 个（h18–h25）与 CGDR/RGDR 本身无关，而是在改导出目录结构、动态轴和命令行。这个比例本身就是「接入代价」的量化证据。

## §1 forward 与 symbolic 的分工

两个类是全部剧情的载体。先看最小可读的 CGDR 骨架（`export_qwen3_5_4b_onnx.py:154-159`、`198-201`）：

```python
class ChunkGatedDeltaRuleFunction(torch.autograd.Function):
    """Export the 310P seven-input ChunkGatedDeltaRule Custom operator."""

    @staticmethod
    def forward(ctx, query, key, value, beta, state, actual_seq_lengths, g_decay):
        """Run the PyTorch reference implementation used during ONNX export."""
        del ctx, actual_seq_lengths
```

```python
    @staticmethod
    def symbolic(graph, query, key, value, beta, state, actual_seq_lengths, g_decay):
        """Export ChunkGatedDeltaRule as an ONNX Custom node."""
        scale_value = 1.0 / (128.0 ** 0.5)
        out, final_state = graph.op(
            "Custom",
```

分工要点：

| 位置 | 谁执行 | 决定什么 | 出错表现 |
|---|---|---|---|
| `forward()` | torch 导出期 trace（`torch.no_grad()` 下走 `.apply()`） | 数值语义、shape 推断、dtype 传播 | 导出报错，或图能出但数值不对 |
| `symbolic()` | torch ONNX exporter 遍历节点时 | 图上 Custom 节点的属性与输出契约 | 导出不报错，转 MindIR 或跑图时才炸 |
| `.setType(...)` | 紧跟 `graph.op` 之后 | 让下游 trace 知道输出 dtype | shape 推断链断裂、后续算子选错 dtype |

`forward()` 里 `del ctx, actual_seq_lengths` 这一行值得停一下：它在明示「本实现不使用 autograd，且忽略 `actual_seq_lengths`」。也就是说，参考实现与内核在这个入参上的语义并不完全对齐——内核拿它做变长边界，PyTorch 参考实现按整段稠密算。这在 batch=1、单条序列的场景下等价，也正是 §5 里动态轴收缩到 batch=1 之后模型的实际形态。这条差异属于「已知不等价点」，不是笔误。

`symbolic()` 的返回值必须与 `forward()` 的返回值一一对应，两处都写成 `return out, final_state`（CGDR）/ `return out, state_out`（RGDR）。任何一处多返回或少返回一个，torch 导出期就会以 tuple 解包错误收场——这是这条链路上少数会「立刻报错」的错法之一。

## §2 symbolic 属性词典

以 RGDR 的 `symbolic()` 为完整样本（`export_qwen3_5_4b_onnx.py:364-399`，此处只保留属性部分）：

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
```

逐属性拆解：

| 属性 | 语义 | 取值来源 | 与注册 OpDef 的关系 |
|---|---|---|---|
| `type_s` | Custom 节点的内核类型名 | 手写字面量 | 必须等于 CANN 侧注册名，如 `"RecurrentGatedDeltaRule"`、`"ChunkGatedDeltaRule"` |
| `input_names_s` | GE 侧算子的完整入参名列表 | 手写字面量 | 顺序、名字都要与 `*_def.cpp` 注册一致；它是「签名」，不是实际连线 |
| `optional_input_names_s` | 其中哪些是可选入参 | 手写字面量 | RGDR 为 `["g", "gk", "num_accepted_tokens"]` |
| `input_index_i` | 实际喂给内核的输入在 `input_names_s` 里的下标 | 手写字面量列表 | RGDR `[0, 1, 2, 3, 4, 5, 6, 7, 9]`——跳过 `8`，即 `gk` |
| `output_names_s` | 输出名 | 手写字面量 | 注释直接点名：`Must match the names registered in recurrent_gated_delta_rule_def.cpp.` |
| `output_num_i` | 输出个数 | 字面量 | 两处都是 `2` |
| `output_types_i` | 每个输出的 MindSpore TypeId | 字面量 | 仅 RGDR 有：`[42, 42]`，注释写明 `MindSpore TypeId 42 is Float16` |
| `outputs_shape_s` | 输出 shape 契约的扁平字符串 | 字面量 | 仅 RGDR 有：`"3,-1,32,128,4,-1,32,128,128,"` |
| `dtype_i` | ONNX 侧 dtype 枚举 | 字面量 | 两处都是 `10`，注释 `ONNX TensorProto.FLOAT16` |
| `scale_value_f` | 传给内核的浮点标量 | 运行时计算 `1.0 / (128.0 ** 0.5)` | 128 是 key head 维，不是 hidden_size |
| `outputs=2` | torch `graph.op` 自身的关键字（非 Custom 属性） | 与 `output_num_i` 一致 | 两者不一致会让 trace 拿不到第二个输出 |

三处「跳号 / 缺省」最容易读错，单独说明：

**其一，`input_index_i` 为什么跳 8。** `input_names_s` 列了 10 个名字，`gk` 在第 8 位，但 Qwen3.5 的调用侧不产 `gk`。类文档与注释把这层关系写得很直白（`export_qwen3_5_4b_onnx.py:379-383`）：

```python
            # Keep the exported GE IR signature aligned with the registered
            # 310P OpDef.  These optional inputs are still supplied below;
            # only gk is absent from this model adapter.
            optional_input_names_s=["g", "gk", "num_accepted_tokens"],
            input_index_i=[0, 1, 2, 3, 4, 5, 6, 7, 9],
```

也就是说：**注册表里的可选参数集合 ≠ 本模型实际喂进去的参数集合**。`input_index_i` 是两者之间的投影，`optional_input_names_s` 则告诉 GE「下标 7、8、9 这三个位置允许缺席」。写 Custom 导出时最常见的误解就是把 `input_index_i` 当成 `range(len(inputs))`；这里它必须是**注册名空间**里的下标。

**其二，CGDR 没有 `output_types_i` / `outputs_shape_s`。** 对照 CGDR 的属性块（`export_qwen3_5_4b_onnx.py:211-223`）：

```python
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
```

它只有 7 个入参、`input_index_i=list(range(7))` 不跳号，`optional_input_names_s` 只有 `"g"`，且完全不声明输出类型与输出 shape 契约。两个算子在这组属性上的差异，说明 Prefill 内核的输出推断可以交给 GE 由输入推导，而 Decode 内核不行——这与它们在图上承担的 role 有关，展开见 `03-Decode接入RGDR.md` §4。

**其三，`input_names_s` 里 state 的名字不统一。** CGDR 叫 `"initial_state"`，RGDR 叫 `"state"`。这不是笔误，而是两个内核各自的注册签名如此。写 adapter 时按算子逐个抄，不能共用一份常量表。

## §3 FP16 边界与 mapper dtype 回退

这是本篇最需要写透的因果链。先看代码给出的三段证据。

**证据 A：属性声明层面把输出钉成 FP16**（`export_qwen3_5_4b_onnx.py:388-397`）：

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
```

**证据 B：`symbolic()` 里同步改 torch 的类型元数据**（`export_qwen3_5_4b_onnx.py:400-405`）：

```python
        # The registered kernel is RGDR<half, half>.  Its internal recurrent
        # arithmetic is FP32, but both graph outputs intentionally use FP16 to
        # match Lite's Custom-output allocation behavior.
        out.setType(value.type().with_dtype(torch.float16))
        state_out.setType(state.type().with_dtype(torch.float16))
        return out, state_out
```

**证据 C：出图后立刻转回 FP32**（`export_qwen3_5_4b_onnx.py:453-455`）：

```python
    # The model-facing recurrent cache remains FP32 even though the Custom
    # boundary writes FP16; make the conversion explicit in the outer graph.
    state_out = state_out.transpose(-2, -1).contiguous().float()
```

把三条串成因果链：

| 环节 | 事实 | 出处 |
|---|---|---|
| 触发条件 | 一张图里存在多个 Custom 类型 | 注释 `when a graph contains more than one Custom type` |
| mapper 行为 | 输出 dtype 回退到「第一个输入的 dtype」 | 同上注释 |
| 图的现实 | Qwen3.5 每层 recurrent state 数量多、Custom 节点成批出现，第一个输入的 dtype 是 FP16（`export_qwen3_5_4b_onnx.py:425-428` 的 `.to(torch.float16)`） | §5 与 `03-Decode接入RGDR.md` §1 |
| 应对 | 与其指望 mapper 推断正确，不如把「公共内核边界」定义成 FP16：`output_types_i=[42, 42]` + `dtype_i=10` + `setType(torch.float16)` 三处一致 | 证据 A/B |
| 后果 | 模型可见状态仍是 FP32，只能在图上再补一次 `.float()`；同时补一次 `transpose(-2, -1).contiguous()` 把排布转回 HF 约定 | 证据 C |

「三处一致」不是修辞。`output_types_i` 管 GE 分配，`dtype_i` 管 ONNX 侧元数据，`setType` 管 torch trace 的下游推断。三者任意一处漏改，症状分别是：转换期报 dtype 不匹配、图上 tensor 元数据与实际 buffer 精度不符、后续算子被 trace 成 FP32 从而又引入一个新的 Custom 输入 dtype。前两类要等到转 MindIR 才暴露，属于最难定位的一档。

值得记下的是精度代价的**方向**：内核内部递推是 FP32，被截成 FP16 的只有「跨节点传递的那一次」。也就是说，state 在每一步内核内部以 FP32 累加，出内核时落 FP16，下一步再进内核时又被读回。误差在步与步之间累积，而不是在步内累积。这个判断来自注释与代码顺序（`42-42` 的截断发生在输出边界，`.float()` 发生在图外层），属于对代码结构的解读，不是对精度的度量——本集不做任何数值验证。

`04-推理侧-NPU常驻状态与输出buffer复用.md` §2 会看到：推理侧上传 recurrent state 时用的是 `astype(np.float32)`，与这里「模型可见 FP32」的约定严格对齐；而 conv / kv 两类 state 上传用 `astype(np.float16)`。三类 state 的精度契约在导出侧与推理侧各写一半，拼起来才完整。

## §4 两个开关与 --component

开关在文件顶部以模块级变量存在（`export_qwen3_5_4b_onnx.py:50-53`）：

```python
# Keep the original graph as the default and enable the fused linear-attention
# operators explicitly when exporting for Ascend 310P.
USE_CUSTOM_RGDR = False
USE_CUSTOM_CGDR = False
```

默认 False 这件事本身就是设计声明：**融合路径是显式 opt-in 的旁路，未验证过的硬件/版本组合下默认走原图**。命令行赋值（`export_qwen3_5_4b_onnx.py:1206-1210`）：

```python
    args = parser.parse_args()

    global USE_CUSTOM_RGDR, USE_CUSTOM_CGDR
    USE_CUSTOM_RGDR = args.enable_rgdr_custom
    USE_CUSTOM_CGDR = args.enable_cgdr_custom
```

三个新参数（`export_qwen3_5_4b_onnx.py:1194-1205`）：

```python
    parser.add_argument(
        "--component", type=str, default="all", choices=["all", "prefill", "decode"],
        help="Export all components, the LLM prefill graph, or the LLM decode graph",
    )
    parser.add_argument(
        "--enable-rgdr-custom", action="store_true",
        help="Replace the expanded decode recurrent rule with the 310P Custom RGDR op",
    )
    parser.add_argument(
        "--enable-cgdr-custom", action="store_true",
        help="Replace the expanded prefill chunk rule with the 310P Custom CGDR op",
    )
```

| 参数 | 影响面 | 与融合开关的关系 |
|---|---|---|
| `--component` | 只决定导出哪些图（all / prefill / decode） | 正交；但 `prefill` 只吃 `--enable-cgdr-custom`、`decode` 只吃 `--enable-rgdr-custom` |
| `--enable-rgdr-custom` | Decode 图里的线性注意力换成 RGDR Custom 节点 | 见 §5 的动态轴联动 |
| `--enable-cgdr-custom` | Prefill 图里的线性注意力换成 CGDR Custom 节点 | 见 §5 的动态轴联动 |

用 `global` 而不是把开关沿调用链透传，是这一版的取舍：模块级布尔被 `_linear_attn_prefill` / `_linear_attn_decode` 直接读，`main()` 一次性写入。代价是「同一进程内导出两批不同配置的图」不再安全（后一次会看到前一次的残留）。以本 PR 的用法（一次进程导一档）不触发。

`--component` 的三条分支（`export_qwen3_5_4b_onnx.py:1225-1249`）把「全量导出」与「单图重导」分开：

```python
    if args.component == "all":
        export_vision_tower(
            model, output_dir / "vision", args.device, args.vision_image_size
        )
        export_llm_prefill_decode(model, output_dir, args.device, args.dummy_seq_len,
                                  dtype=torch_dtype)
```

…（`elif` / `else` 两支各自新建 `Qwen35LlmPrefill` / `Qwen35LlmDecode` 后直接调 `_export_llm_prefill` / `_export_llm_decode`，见 `export_qwen3_5_4b_onnx.py:1231-1249`）。

为什么要给单图重导开口子：调试 Custom 属性契约时，一次全量导出要先把视觉塔和另一张 LLM 图都走完。`--component` 把迭代单位从「整个模型」降到「一张图」，这是接入期的工程效率手段，不是运行时能力。

## §5 动态轴收缩到 batch=1

开关一旦打开，导出的图就不再声明 batch 动态轴。Prefill 侧（`export_qwen3_5_4b_onnx.py:1022-1042`）：

```python
    if USE_CUSTOM_CGDR:
        # The 310P CGDR integration currently targets the batch-one demo path.
        dynamic_axes = {
            "input_ids": {1: "seq_len"},
            "attention_mask": {1: "seq_len"},
            "position_ids": {2: "seq_len"},
            "image_embeds": {0: "num_image_tokens"},
            "logits": {1: "seq_len"},
            "present_kv_cache": {3: "seq_len"},
        }
    else:
        dynamic_axes = {
            "input_ids": {0: "batch", 1: "seq_len"},
            "attention_mask": {0: "batch", 1: "seq_len"},
            "position_ids": {1: "batch", 2: "seq_len"},
            "image_embeds": {0: "num_image_tokens"},
            "logits": {0: "batch", 1: "seq_len"},
            "present_conv_states": {1: "batch"},
            "present_recurrent_states": {1: "batch"},
            "present_kv_cache": {1: "batch", 3: "seq_len"},
        }
```

Decode 侧同构（`export_qwen3_5_4b_onnx.py:1101-1120`）：

```python
    if USE_CUSTOM_RGDR:
        # RGDR is used for single-token, batch-one autoregressive Decode.
        dynamic_axes = {
            "attention_mask": {1: "total_seq_len"},
            "past_kv_cache": {3: "past_seq_len"},
            "present_kv_cache": {3: "total_seq_len"},
        }
    else:
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
```

差异表：

| 张量 | 融合路径动态轴 | 未融合路径动态轴 | 被摘掉的 |
|---|---|---|---|
| `input_ids` | `{1: seq_len}` / `{0: batch, 1: step}` | 含 `{0: batch}` | batch |
| `attention_mask` | `{1: total_seq_len}` | 含 `{0: batch}` | batch |
| `position_ids` | Prefill `{2: seq_len}` | 含 `{1: batch}` | batch |
| `logits` | `{1: seq_len}` / Decode 不声明 | 含 `{0: batch}` | batch |
| `past_conv_states` / `past_recurrent_states` | Decode 融合路径**不出现** | 含 `{1: batch}` | 整个维度声明 |
| `present_kv_cache` | 仍声明 `{3: seq_len/total_seq_len}` | 额外声明 `{1: batch}` | batch |

两个细节值得单独点名：

1. **Decode 融合路径下 conv / recurrent state 完全脱离动态轴**。它们在图上被当成固定形状张量，只有 KV cache 的 seq 维还允许增长。这与 §3 的 dtype 结论是同一件事的两面：融合路径把「可变的只有 KV」当作前提。这个前提在 !1194 里被进一步收紧成「连 KV 的 seq 维也是固定容量」
2. **注释用词是 demo path**（`The 310P CGDR integration currently targets the batch-one demo path.`）。`currently` 是作者自己标的临时性：这不是「算子不支持 batch」的终局结论，而是这一版接入的范围声明。

## §6 导出目录拆分

最后一个改动类别是产物布局。`export_llm_prefill_decode` 里（`export_qwen3_5_4b_onnx.py:1153-1161`）：

```python
    # Independent component exports can assign the same graph-local external
    # data filename to different tensors.  Keep every graph self-contained so
    # that repeated or component-only exports cannot overwrite another graph.
    output_dir = Path(output_dir)
    _export_llm_prefill(
        prefill, output_dir / "prefill", device, dummy_seq,
        dummy_num_img_tokens, dtype=dtype,
    )
    _export_llm_decode(decode, meta, output_dir / "decode", device, dummy_seq)
```

在此之前，视觉塔输出到 `output_dir / "vision"`、两张 LLM 图直接落在 `output_dir` 根上；此后每张图各占一个子目录。动机写在注释里，且与 `--component` 直接相关：**ONNX 的 external data 文件名是「图内局部」的，不同图可以给同一个文件名挂不同权重**。同目录并列时，单图重导就会覆盖另一张图的 external data 文件。拆目录把这个撞名空间隔成每图一份，等价于让每张图自包含。

| 布局 | 融合/未融合是否都受影响 | 是否必须 |
|---|---|---|
| `vision/`、`prefill/`、`decode/` 三子目录 | 是 | 是（否则 `--component` 单图重导会互相覆盖） |
| 两张 LLM 图同放 `output_dir` | — | 否，正是被修掉的形态 |

同函数里还能看到开关如何落到模块构造（`export_qwen3_5_4b_onnx.py:1150-1151`）：

```python
    prefill = Qwen35LlmPrefill(text_model, lm_head, image_token_id).to(device).eval()
    decode = Qwen35LlmDecode(text_model, lm_head).to(device).eval()
```

注意 `Qwen35LlmDecode` 的构造参数**只有两个**。本集反复强调这一点：融合与非融合的选择发生在更内层的 `_linear_attn_decode` 读模块级开关时，模型对象自身不携带「我是不是固定 KV cache」这个事实。后续 PR 才把这个事实提升成构造参数，那已经是另一集的内容（`../reports-PR1194/01-max-seq-len固定Shape契约.md`）。

## 三件值得带走的事

1. **Custom 属性是一份跨模块契约，不是一组配置项**。`type_s`/`input_names_s`/`input_index_i` 对齐注册 OpDef，`output_types_i`/`outputs_shape_s`/`dtype_i` 对齐 mapper 的输出分配策略，`setType` 对齐 trace 下游。三向对齐中任何一项，报错都不发生在写错的那一行。
2. **「能跑」的代价会显式写进代码形态**：默认 False 的双开关、`else` 里整段保留的未融合实现、`--component` 的单图重导口子、三处一致的 FP16 声明、`.float()` 的显式回转。这些不是冗余，而是接入一个未验证算子所需的安全带。
3. **batch=1 是这一版融合路径的边界条件，不是 bug**。两条注释（`batch-one demo path`、`single-token, batch-one autoregressive Decode`）把它写成了契约；下游推理侧的常驻状态设计正是建立在这个契约上，见 `04-推理侧-NPU常驻状态与输出buffer复用.md`。

