# 04 推理侧：NPU 常驻状态与输出 buffer 复用

> 前置：`02`/`03` 篇讲导出侧把 state 变成图的输入输出；本篇讲这些 state 在 MindSpore Lite 运行时里真正怎么活、怎么传、怎么被反复写入。

## 结论先行

1. **接入 Custom 算子的代价，一半在推理侧。** 导出只要保证图能转、能跑；推理要决定「每步几十 MB 的 state 到底放在哪」。!1169 的答案是：**Conv 与 Recurrent 两类 state 常驻 NPU，logits 固定形状复用，KV 每步重新分配**。
2. **常驻的实现只有 3 行核心**：`mslite.Tensor(np_array, device="ascend:0")` 上传一次，之后每步把上一步的**输出 Tensor 对象**直接当作下一步的输入 Tensor 传回去。`_mslite_tensor()` 的 `isinstance` 早返回是这条链得以闭合的唯一机关。
3. **双缓冲不是优化，是正确性要求。** `predict(inputs, output_buffers)` 是原位写入，若第 N 步的输出 buffer 就是第 N 步的输入 tensor，图的执行序无法保证「先读后写」。`output_index = step_index & 1` 用两份交替 buffer 规避了这个 WAR 冒险。
4. **本 PR 的 KV 仍是变长的，而且推理侧明确配合它变长**：`kv_output_shape[-2] += 1` 每步新建一个 Tensor。这与 `03` 篇里导出侧 `torch.cat([past_key, key_states], dim=2)` 是同一件事的两端。固定容量是 !1194 才引入的，见 `../reports-PR1194/02-KVCache原位更新与静态Decode导出.md`。
5. **回退路径完整保留，且只有一个 CLI 开关的距离**：`--host-state-roundtrip` 把三类 state 退回每步 NumPy 往返。它同时是调试手段与 A/B 对照，因为两条路径吃同样的图、同样的输入。
6. **计时有两种口径，而且都打印**：`decode_times` 只裹住 `predict`，`decode_wall_times` 从每步开头算起；`_initialize_decode_device_states` 的上传耗时只进 wall 口径。**读任何 Decode 数字前必须先确认它是哪个口径**。

## §1 一个 isinstance 早返回，撑起整条常驻链

`_build_mslite_inputs` 不区分「这是 numpy 还是设备张量」，它把所有 feed 值统一交给 `_mslite_tensor`（`infer_qwen3_5_4b_mslite.py:183-189`）：

```python
def _mslite_tensor(np_array):
    """
    Convert numpy array to MindSpore Lite tensor.
    """
    if isinstance(np_array, mslite.Tensor):
        return np_array
    return mslite.Tensor(np_array)
```

这个函数在 !1169 之前承担的唯一职责是「numpy → mslite.Tensor」，本次改动给它加了一条早返回。原因是**常驻路径下，同一个变量在两步之间换了类型**：

| 步 | `past_conv` 的实际类型 | 来源 |
|---|---|---|
| Prefill 之后、第 0 步之前 | `numpy.ndarray` | `prefill_out[1].get_data_to_numpy()`（`:522`） |
| 上传之后 | `mslite.Tensor`（在 `ascend:0`） | `_initialize_decode_device_states` 的 `mslite.Tensor(..., device=device_name)` |
| 第 N 步之后 | `mslite.Tensor`（模型的输出张量） | `past_conv, past_recurrent, past_kv = decode_out[1:]`（`:438`） |

如果没有那条 `isinstance` 早返回，第三步就会把设备张量重新包成主机张量（或者构造失败），常驻立刻退化。**一次 isinstance 判断换来整条零拷贝链**——这是本篇能成立的地基，也是改动量与实际效果最不成比例的一处。

对应的输出侧构造器是新建的（`infer_qwen3_5_4b_mslite.py:192-197`）：

```python
def _device_output_tensor(template, shape, device):
    """Create an Ascend output tensor matching a model output descriptor."""
    tensor = mslite.Tensor(shape=list(shape), dtype=template.dtype, device=device)
    tensor.name = template.name
    tensor.format = template.format
    return tensor
```

三个属性的来源各不相同，值得逐条看：

| 字段 | 取自 | 为什么必须取自那里 |
|---|---|---|
| `shape` | 调用方传入 | 唯一一个由运行期决定的量；KV 每步 +1，其余固定 |
| `dtype` | `template.dtype`（模型输出描述符） | 手写 dtype 一旦与图不符，`predict` 就会拒绝写入或静默截断 |
| `name` | `template.name` | 按名字匹配输出；导出侧 `output_names_s` 决定了它 |
| `format` | `template.format` | Ascend 上 ND/NZ 布局差异会改变内存排布，不能留默认值 |

**「按形状新建、其余全部抄模板」** 是这套 buffer 复用方案的定义式。`list(shape)` 是为了防止调用方传进来的 list 被后续改写——注意它同时把 numpy 的 shape 元组转成可变的 list，这与 §5 的 `+= 1` 直接相关。

## §2 三类 state 的上传：一次，且在计时窗口内

`_initialize_decode_device_states` 的签名与早退（`infer_qwen3_5_4b_mslite.py:302-305`）：

```python
    def _initialize_decode_device_states(self, logits, past_conv, past_recurrent, past_kv):
        """Upload decode states and allocate reusable device output tensors."""
        if not self.device_resident_states:
            return past_conv, past_recurrent, past_kv, 0.0, None
```

返回五元组：三类 state、一个初始化耗时、一个 `device_outputs` 字典。回退模式下耗时给 `0.0`、字典给 `None`——这两个占位值在 §4 和 §8 各被消费一次。

上传三行（`infer_qwen3_5_4b_mslite.py:307-317`）：

```python
        device_name = f"ascend:{self.device_id}"
        state_init_start = time.perf_counter()
        past_conv = mslite.Tensor(
            past_conv.astype(np.float16), device=device_name
        )
        past_recurrent = mslite.Tensor(
            past_recurrent.astype(np.float32), device=device_name
        )
        past_kv = mslite.Tensor(
            past_kv.astype(np.float16), device=device_name
        )
```

三个 dtype 不是随手写的，它们与导出侧一一对应：

| state | 上传 dtype | 导出侧依据 |
|---|---|---|
| `past_conv` | `float16` | 卷积状态在图上就是 FP16 |
| `past_recurrent` | **`float32`** | `03` 篇 §2：adapter 出口 `.float()`，模型可见 recurrent state 是 FP32 |
| `past_kv` | `float16` | KV cache 全链 FP16 |

`past_recurrent` 这一行是**跨文件契约的落地点**：导出侧 `state_out.transpose(-2, -1).contiguous().float()` 决定了这里必须写 `float32`。两处任一处单独改动都会让 Decode 图拿到 dtype 不匹配的输入，而 MindSpore Lite 在这种情况下的报错位置离真正原因很远。`01` 篇 §3 讲的「dtype 三处一致」，第三处就是这里。

紧接着是对图输出个数的硬校验（`infer_qwen3_5_4b_mslite.py:318-322`）：

```python
        output_templates = self.decode_model.get_outputs()
        if len(output_templates) != 4:
            raise RuntimeError(
                f"expected 4 Decode outputs, got {len(output_templates)}"
            )
```

`4 = logits + conv + recurrent + kv`。这条断言把「Decode 图必须恰好四个输出」写成了运行时约束——如果哪天给 Decode 加第五个输出，这里会立刻拒绝，而不是让下面的字典悄悄建错。

`device_outputs` 的组装（`infer_qwen3_5_4b_mslite.py:323-344`，中间省略）：

```python
        device_outputs = {
            "device_name": device_name,
            "templates": output_templates,
            "conv": [
                _device_output_tensor(output_templates[1], past_conv.shape, device_name),
                _device_output_tensor(output_templates[1], past_conv.shape, device_name),
            ], 
            ....
            "logits": _device_output_tensor(
                output_templates[0], [1, 1, logits.shape[-1]], device_name
            ),
        }
        device_state_init_ms = (time.perf_counter() - state_init_start) * 1000
        print(f"Decode state upload time: {device_state_init_ms:.2f} ms")
        return past_conv, past_recurrent, past_kv, device_state_init_ms, device_outputs
```

## §3 为什么 conv/recurrent 是两份、logits 是一份

`device_outputs` 这个字典的形状本身就是一张决策表：

| 键 | 份数 | 形状来源 | 每步是否变化 |
|---|---|---|---|
| `"conv"` | **2**（列表） | `past_conv.shape` | 不变 |
| `"recurrent"` | **2**（列表） | `past_recurrent.shape` | 不变 |
| `"logits"` | 1 | 字面量 `[1, 1, logits.shape[-1]]` | 不变 |
| （KV） | **没有条目** | 见 §5 | 每步 +1 |

**logits 不需要双缓冲**：它是每步的终点，读走（`decode_out[0].get_data_to_numpy()`，`:436`）之后没有任何东西再依赖它上一轮的内容——它不参与 state 回环。conv 与 recurrent 则同时出现在第 N 步的输入和第 N 步的输出上，正是这种「本步读它、本步也写它」的关系需要两份交替。

`[1, 1, vocab]` 这个字面量是 batch=1、单 token 的断言第二次出现在代码里（第一次是 `02` 篇 §2 的 `query.shape[0] // batch_size`）。这里没有任何注释或校验保护它：如果 `01` 篇 §5 摘掉的 batch 动态轴被恢复，这行会静默产出形状错误的 logits buffer。属于本篇范围内的隐性契约。

`output_templates[0]` 是 logits、`[1]` 是 conv、`[2]` 是 recurrent、`[3]` 是 KV，这个下标顺序在两个不同函数里被分别硬编码了两次（本函数的 `[1]/[2]` 与 §4 的 `[3]`）。

它必须与导出侧 `output_names_s=["logits", ...]` 的注册顺序一致——顺序也是一种跨文件契约。

## §4 一步的输入输出：`_build_decode_step_io`

（`infer_qwen3_5_4b_mslite.py:346-376`，保留关键行）

```python
    def _build_decode_step_io(self, step_id, attention_mask, position_ids,
                              past_conv, past_recurrent, past_kv, step_index,
                              device_outputs):
        """Build one decode step's inputs and optional reusable output tensors."""
        decode_feed = {
            "input_ids": step_id,
            "attention_mask": attention_mask,
            "position_ids": position_ids,
            "past_conv_states": past_conv,
            "past_recurrent_states": past_recurrent,
            "past_kv_cache": past_kv,
        }
        if not self.device_resident_states:
            decode_feed["past_conv_states"] = past_conv.astype(np.float16)
            decode_feed["past_recurrent_states"] = past_recurrent.astype(np.float32)
            decode_feed["past_kv_cache"] = past_kv.astype(np.float16)
            return decode_feed, None
```

六个键的顺序与 `_decode_generate` 里的 `preferred_order` 完全一致（`:427-429`）。这层冗余是必要的：MindSpore Lite 在 `get_inputs()` 拿不到名字时（例如某些 MindIR 转换丢元数据）会退化到「按位置喂」，此时字典顺序不再可靠，`preferred_order` 才是权威。

回退分支的 dtype 与 §2 上传时逐一相同，**不是巧合而是要求**：两条路径最终必须让图看到同样的输入类型，否则 §6 的 A/B 比较就混入了 dtype 变量。

常驻分支的后半（`infer_qwen3_5_4b_mslite.py:364-376`）：

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
        return decode_feed, output_buffers
```

`output_buffers` 是**一个四元素列表，顺序即图的输出顺序**。注意它前三个是复用对象、第四个是新构造对象——一个列表里同时存在两种生命周期，这是理解 §5 的关键。

`output_index = step_index & 1` 的轮转序列是 `0,1,0,1,...`。它保证第 N 步写入的 buffer 不是第 N 步正在读的那个（`step_index` 与 `step_index-1` 的奇偶必然不同）。代价是 host 侧要常驻两份 conv+recurrent 的设备内存。**这是用内存换正确性，而不是换速度**——轮转本身不减少任何拷贝，它只是让「不拷贝」变得可行。

## §5 变长 KV：每步新建一个设备 Tensor

`kv_output_shape[-2] += 1` 这一行是 !1169 推理侧最重要的时代标记。它说明：

1. KV 的第 -2 维（序列维）**每步增长 1**；
2. 因此 KV 的输出 buffer **不可能复用**——形状每步不同；
3. 因此 `device_outputs` 字典里根本没有 `"kv"` 这个键；
4. 因此每步都有一次设备内存分配 + 一次拷贝（旧 KV 全部搬到新 buffer）。

这与导出侧的证据完全吻合。`03` 篇 §1 里 `_linear_attn_decode` 的 attention 分支执行 `torch.cat([past_key, key_states], dim=2)`——那是一张**增长式拼接**的图，不是原位写入。两侧一起看，本 PR 的 KV 路径是「变长拼接 + 每步重分配」的完整闭环。

四类 state 在 !1169 终态的命运对照：

| state | 形状是否变 | 输出 buffer | 每步设备侧代价 |
|---|---|---|---|
| logits | 不变 | 复用（1 份） | 写 + 传回 host（要 argmax） |
| conv | 不变 | 复用（2 份轮转） | 仅写 |
| recurrent | 不变 | 复用（2 份轮转） | 仅写 |
| **KV** | **每步 +1** | **每步新建** | **分配 + 整块搬迁 + 写** |

**「Custom 算子的 state 常驻了，KV 没有」** 是本集对 !1169 推理侧的一句话总结

`attention_mask` 同样在长：`np.concatenate([attn_mask_np, np.ones((1, 1), dtype=np.int32)], axis=1)`（`infer_qwen3_5_4b_mslite.py:407-409`）。它是 host 侧 numpy，每步变长不影响设备常驻（它不是 state），但它是 Decode 图必须带 `attention_mask` 动态轴的原因之一

## §6 回退与 A/B：`--host-state-roundtrip`

（`infer_qwen3_5_4b_mslite.py:581-596`，中间省略）

```python
    parser.add_argument(
        "--host-state-roundtrip", action="store_true",
        help="Copy Conv/Recurrent/KV states through NumPy every decode step",
    )
        ...
        device_resident_states=not args.host_state_roundtrip,
```

CLI 用「反向命名」（声明**回退**而非声明**优化**），所以默认值是 `--host-state-roundtrip=False` → `device_resident_states=True`，即**常驻是默认行为**。这个命名选择值得注意：它把新路径当默认、旧路径当逃生舱，而不是反过来。

构造器里的第二重保护（`infer_qwen3_5_4b_mslite.py:251`）：

```python
        self.device_resident_states = bool(device_resident_states and device == "ascend")
```

`device="cpu"` 时无论命令行怎么传，常驻都被强制关掉。这不是冗余：CPU target 下 `f"ascend:{self.device_id}"` 这个设备名根本无意义，早退比报错友好。

回退模式在解码循环里的落点（`infer_qwen3_5_4b_mslite.py:431-442`，中间省略）：

```python
            if output_buffers is None:
                decode_out = self.decode_model.predict(decode_inputs)
            else:
                decode_out = self.decode_model.predict(decode_inputs, output_buffers)
            ...
            if self.device_resident_states:
                past_conv, past_recurrent, past_kv = decode_out[1:]
            else:
                past_conv = decode_out[1].get_data_to_numpy()
                past_recurrent = decode_out[2].get_data_to_numpy()
                past_kv = decode_out[3].get_data_to_numpy()
```

两条分支的差异只在**是否调用 `get_data_to_numpy()`**。`output_buffers is None` 的判空来自 §2 早退时返回的那个 `None` 占位——**一个开关的值经过三次传递（CLI → 构造器 → 初始化函数返回值）才最终决定 `predict` 的调用形式**。链路长是这类「保留回退」设计的固有成本。

`past_conv, past_recurrent, past_kv = decode_out[1:]` 这一行是常驻路径的心脏：三步之后，`past_*` 就再也不是 numpy 了，它们是模型自己的输出张量。读到这里再回看 §1 的 `isinstance` 早返回，闭环才完整。

## §7 分阶段加载与释放：一次只让一个模型活着

构造器里有一段注释解释了整套 try/finally 的动机（`infer_qwen3_5_4b_mslite.py:253-261`）：

```python
        # These three large models can exceed host memory when they are built
        # concurrently on a shared server.  Keep only one model alive at a
        # time; the NumPy outputs are sufficient to bridge the stages.
        self.vision_model_path = vision_model_path
        self.prefill_model_path = prefill_model_path
        self.decode_model_path = decode_model_path
        self.vision_model = None
        self.prefill_model = None
        self.decode_model = None
```

「the NumPy outputs are sufficient to bridge the stages」这句是整个推理侧设计的纲领：三个阶段之间**只靠 host 侧 numpy 传值**，不共享任何模型对象。于是每段的形状都是同一个模板（以 Prefill 段为例，`infer_qwen3_5_4b_mslite.py:502-530`，中间省略）：

```python
        print(f"Loading prefill model from {self.prefill_model_path}...")
        self.prefill_model = mslite.Model()
        try:
            self.prefill_model.build_from_file(
                self.prefill_model_path, mslite.ModelType.MINDIR, self.context
            )
            ...
            del prefill_out
        finally:
            self.prefill_model = None
            gc.collect()
```

三段各有 `build_from_file`，各有 `finally: self.xxx_model = None; gc.collect()`。三段共用一个 `self.context`——context 是设备侧的，不随模型释放。

`self.context` 的建立（`infer_qwen3_5_4b_mslite.py:245-248`）：

```python
        self.context = mslite.Context()
        self.context.target = [device]
        if device == "ascend":
            self.context.ascend.device_id = device_id
```

**一个关键副作用**：`self.context` 在 `__init__` 里建，`device_id` 在这里定，而 §2 的 `device_name = f"ascend:{self.device_id}"` 独立地把同一个 `self.device_id` 拼成字符串。两处必须一致，否则上传到 `ascend:1` 的 state 会被 `ascend:0` 上的模型读取。这是本篇列出的隐性契约里最容易踩的一条。

Prefill 段的四个输出正好接上 Decode 段的四个输入（`infer_qwen3_5_4b_mslite.py:521-524`）：

```python
            logits = prefill_out[0].get_data_to_numpy()
            past_conv = prefill_out[1].get_data_to_numpy()
            past_recurrent = prefill_out[2].get_data_to_numpy()
            past_kv = prefill_out[3].get_data_to_numpy()
```

四个都 `.get_data_to_numpy()`，因为此刻 Prefill 模型即将被 `finally` 释放——**这是全链路最后一次、也是唯一一次把 state 拉回 host**。下一步就是 §2 的上传。常驻优化的真正边界不是「state 不上 host」，而是「state 只在 Prefill→Decode 交界上一次 host」。

顺带一提，段与段之间还夹了一个纯校验逻辑（`infer_qwen3_5_4b_mslite.py:495-500`）：

```python
        image_token_cnt = int((input_ids == int(self.cfg.image_token_id)).sum())
        if int(image_embeds.shape[0]) != image_token_cnt:
            raise RuntimeError(
                f"image_embeds length mismatch: embeds={image_embeds.shape[0]} "
                f"vs image_token_cnt={image_token_cnt}"
            )
```

它在 Vision 模型已释放、Prefill 模型尚未加载的空档执行，检查「image token 个数 == 视觉嵌入条数」。放在这个位置的好处是报错时不牵涉任何设备内存；这是分阶段结构带来的一个顺带收益（该判断是对代码位置作用的解读，非注释明示）。
