# 04 四档 dynamicDims 与 Model.resize

> 前置：02 篇 §5 讲清了 Decode 为什么可以完全没有动态轴。本篇讲另一侧——**Prefill 并没有静态化，它被改成了"允许多个离散形状"**，这两件事是同一个 PR 的两半，但机制完全不同。

## 结论先行

1. **Prefill 与 Decode 走的是两条相反的路**：Decode 是"消除动态"（不传 `dynamic_axes`，图形状全常量），Prefill 是"约束动态"（ONNX 仍带 `-1`，改由转换期配置声明可选值）。混淆这两者会读错整个 PR。
2. **四档不是写在代码里，而是写在 `configs/config_prefill.ini` 的一行字符串里**：`ge.dynamicDims="32,32,32,16;512,512,512,16;1024,1024,1024,16;2048,2048,2048,16"`。分号分隔档位、逗号分隔该档位的各动态维取值。
3. **每档 4 个数字与 `input_shape` 里 4 个 `-1` 一一对应**：`input_ids` 的 seq、`attention_mask` 的 seq、`position_ids` 的 seq、`image_embeds` 的行数（§1.3 给出对齐推导）。四个档位里第 4 个数字恒为 16，这就是 README 所说"`image_embeds` 固定为 16 个 Token"的落地方式。
4. **推理脚本新增的 `_resize_dynamic_model_inputs` 只做三件事**：按名（或按 `preferred_order`）把 feed 排成与模型输入同序的列表、比较当前形状与目标形状、**只在不同时**才调 `model.resize(inputs, target_shapes)`。它不校验目标形状是否落在四档之内。
5. **resize 只加在 Prefill，Decode 一次都没有**（h42 只改 Prefill 调用点）。原因即结论 1：Decode 图形状本来就是常量，resize 是空操作。
6. **h11 把 Prefill 动态轴的收缩条件从"启用 CGDR"扩成"启用 CGDR 或设置了 `max_seq_len`"**。这意味着即使只用 RGDR 不用 CGDR，Prefill 也会走 batch=1 的窄动态轴集合。
7. **h12 是"KV 输出静态化"的实际发生地**：`present_kv_cache` 的动态 seq 轴改成只在 `max_seq_len is None` 时声明。基线里无条件声明的 `{3: "seq_len"}` 在固定路径下被摘掉，Prefill 因此输出一个形状为 `[16, 1, 4, max_seq_len, 256]` 的常量输出——这是 Prefill/Decode 能对接上的前提。
8. **代价是一份"只能命中四个离散点"的输入约束**。README 的中文表述是"实际输入必须命中其中一个档位"（§4.1）。脚本侧没有任何前置检查，越界只能在 `resize`/`predict` 内部报错。

## §1 config_prefill.ini 逐行

### 1.1 全文

h40 是本 PR 唯一的**新建文件**（`92-raw-git.patch` 第三段里该文件的旧侧是 `--- /dev/null`，7 增 0 删）。终态 `src/942a0107/qwen3.5_4b/configs/config_prefill.ini` 全文 7 行：

```ini
[acl_init_options]
ge.exec.precision_mode=force_fp32

[acl_build_options]
input_format="ND"
input_shape="input_ids:1,-1;attention_mask:1,-1;position_ids:4,1,-1;image_embeds:-1,2560"
ge.dynamicDims="32,32,32,16;512,512,512,16;1024,1024,1024,16;2048,2048,2048,16"
```

（`wc -l` 复核为 7；第 3 行是空行，`cat -A` 显示各行为 LF 结尾、无行尾空白。）

### 1.2 与既有 `config.ini` 的关系

同目录的 `config.ini`（本 PR 未改动，基线与终态逐字相同，`wc -l` = 2）：

```ini
[acl_init_options]
ge.exec.precision_mode=force_fp32
```

对照可见 h40 的构造方式：**保留原 `[acl_init_options]` 段不动，追加一个 `[acl_build_options]` 段**。也就是说新配置不是"另一套精度策略"，而是在同一精度策略上叠了构建期的形状声明。三个转换对象（Vision / Prefill / Decode）里只有 Prefill 换用了新文件（§5）。

### 1.3 每个键的作用

| 键 | 值 | 作用层 | 若缺省 |
|---|---|---|---|
| `ge.exec.precision_mode` | `force_fp32` | 运行期执行精度 | 沿用 `config.ini` 的同一值，无变化 |
| `input_format` | `"ND"` | 输入排布 | 与 `config.ini` 一致（该键未在原文件中出现） |
| `input_shape` | 4 个张量的形状 | **声明哪些输入张量存在、哪几维是 `-1`** | 转换期无从知道动态维在哪 |
| `ge.dynamicDims` | 4 档 × 4 值 | **声明 `-1` 允许取的具体值** | 动态维退化为任意值，GE 需按最小/最大范围编译 |

`input_shape` 与 `ge.dynamicDims` 是一个配对：前者用 `-1` 挖出洞，后者按同样顺序填洞。数一下 `input_shape` 里的 `-1`：

| 张量 | 形状 | `-1` 所在轴 | 序号 |
|---|---|---|---|
| `input_ids` | `1,-1` | 第 1 轴（seq） | 1 |
| `attention_mask` | `1,-1` | 第 1 轴（seq） | 2 |
| `position_ids` | `4,1,-1` | 第 2 轴（seq） | 3 |
| `image_embeds` | `-1,2560` | 第 0 轴（token 数） | 4 |

每档 4 个数字，顺序即上表的"序号"列。以第一档 `32,32,32,16` 为例：`input_ids=[1,32]`、`attention_mask=[1,32]`、`position_ids=[4,1,32]`、`image_embeds=[16,2560]`。**前三维一起变、第四维恒为 16** —— 这与 README 转换小节的表述完全对应（h35 新增段落，终态 `README.md:221-222`）：

```text
四个序列长度档位，`image_embeds`固定为16个Token；实际输入必须命中其中一个档位。
```

（该行摘自 `src/942a0107/qwen3.5_4b/README.md` 第 222 行的后半句；该 hunk h35 的记账在 05 篇 §3。）

### 1.4 为什么第 4 维恒为 16

`image_embeds` 的行数等于图片占位 token 数。Vision Tower 的输出形状在 README 的 Shape 表里是 `[16, 2560]`（`src/942a0107/.../README.md:180`），由 `--vision-image-size 128` 与 patch 排布 `8x8` 决定。既然示例固定用一张 128 见方的图，这一维在四档里都不必变化——**把它写进 `ge.dynamicDims` 而不是从 `input_shape` 里删掉 `-1`，等于"保留动态声明、但只给一个合法值"**。

> 观察：如果直接把 `image_embeds` 写成 `16,2560`（无 `-1`），`ge.dynamicDims` 每档就只需 3 个数字。作者选择了保留 `-1`。两种写法在效果上等价，选择前者的好处是四个张量的形状描述风格统一（都带一个动态维），代价是那串数字变长。代码里没有说明。

## §2 四档各自的轴对应

### 2.1 h11：条件从"CGDR"扩成"CGDR 或固定容量"

基线 `src/449fbf7b/.../export_qwen3_5_4b_onnx.py:1022-1031`：

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
```

终态 `src/942a0107/.../export_qwen3_5_4b_onnx.py:1226-1236`（h11 + h12）：

```python
    if USE_CUSTOM_CGDR or prefill.max_seq_len is not None:
        # Both the fused Prefill and fixed-cache Decode paths target batch one.
        dynamic_axes = {
            "input_ids": {1: "seq_len"},
            "attention_mask": {1: "seq_len"},
            "position_ids": {2: "seq_len"},
            "image_embeds": {0: "num_image_tokens"},
            "logits": {1: "seq_len"},
        }
        if prefill.max_seq_len is None:
            dynamic_axes["present_kv_cache"] = {3: "seq_len"}
```

两处改动，注释也被换掉（原注释只提 CGDR，新注释同时提"fixed-cache Decode paths"）。

| 项 | 基线 | 终态 |
|---|---|---|
| 生效条件 | `USE_CUSTOM_CGDR` | `USE_CUSTOM_CGDR or prefill.max_seq_len is not None` |
| `present_kv_cache` 第 3 轴 | 恒为动态 | 仅当未设容量时动态 |
| 注释文案 | 只提 CGDR | 同时提 CGDR 与固定 cache |

第一行带来的实际组合变化：`--enable-rgdr-custom` 单独使用（不加 `--enable-cgdr-custom`）时，基线会走 10 项全动态轴（含 batch），终态走 batch=1 的窄轴集。这与 `90` 第 1 条的口径一致——固定容量路径"仅支持 batch=1"，而这个约束必须同时作用在 Prefill 图上，否则 Prefill 允许 batch>1、Decode 不允许，交接就断。

### 2.2 h12：KV 输出静态化

上面那块里的 `if prefill.max_seq_len is None:` 是本次导出**唯一一处让某个输出张量的动态轴被摘掉**的地方。摘掉之后，`present_kv_cache` 在 ONNX 里的形状就是 trace 时的实际形状 `[16, 1, 4, dummy_seq, 256]` 再被 01 篇 §2.3 的 `F.pad` 补到 `[16, 1, 4, max_seq_len, 256]`——因为 trace 时 `present_kv_stack.shape[3]` 已经等于 `max_seq_len`，静态形状被记成常量。

于是三方对齐成立：

| 侧 | 数量 | 来源 |
|---|---|---|
| Prefill 输出 `present_kv_cache` 第 3 轴 | `max_seq_len`（常量） | h12 + 01 篇 §2.3 的 `F.pad` |
| Decode 输入 `past_kv_cache` 第 3 轴 | `max_seq_len`（常量） | h14 + 02 篇 §5.2 的 `kv_cache_len` |
| Decode 输出 `present_kv_cache` 第 3 轴 | `max_seq_len`（常量） | h15 不传 `dynamic_axes` |

`90` 第 102 行记录的正是这个结果的前两项：

```text 出处=90
   - Prefill MindIR输入保持动态元数据，输出KV Cache固定为`[16, 1, 4, 2048, 256]`。
```

"输入保持动态元数据、输出固定"这一句是本篇全部内容的浓缩：**Prefill 的动态性没有被消除，只是从输出侧收回、在输入侧交给转换配置去约束。**

### 2.3 `else` 分支里的一处恒真判断

终态 `export_qwen3_5_4b_onnx.py:1237-1249` 的 `else` 分支：

```python
    else:
        dynamic_axes = {
            "input_ids": {0: "batch", 1: "seq_len"},
            "attention_mask": {0: "batch", 1: "seq_len"},
            "position_ids": {1: "batch", 2: "seq_len"},
            "image_embeds": {0: "num_image_tokens"},
            "logits": {0: "batch", 1: "seq_len"},
            "present_conv_states": {1: "batch"},
            "present_recurrent_states": {1: "batch"},
            "present_kv_cache": {1: "batch"},
        }
        if prefill.max_seq_len is None:
            dynamic_axes["present_kv_cache"][3] = "seq_len"
```

进入 `else` 的前提是 `not USE_CUSTOM_CGDR and prefill.max_seq_len is None`，所以末尾这个 `if` 在该分支内**恒为真**。它的净效果等价于基线的 `"present_kv_cache": {1: "batch", 3: "seq_len"}`（`src/449fbf7b/.../export_qwen3_5_4b_onnx.py:1041`）。

> 观察（非缺陷）：这是把同一条 `if` 复制到两个分支留下的冗余。删掉它、直接写回 `{1: "batch", 3: "seq_len"}` 行为不变。它不影响正确性，但会让读者误以为回退路径也存在"容量已设置"的情形。

## §3 选档时机与 resize

### 3.1 新增函数

h41 插入的整个函数（终态 `infer_qwen3_5_4b_mslite.py:228-247`，22 增 0 删）：

```python
def _resize_dynamic_model_inputs(model, feed_dict, preferred_order=None):
    """Resize a dynamic MindSpore Lite model to the current input shapes."""
    inputs = model.get_inputs()
    if not inputs:
        return
    input_names = [getattr(tensor, "name", "") for tensor in inputs]
    if all(name in feed_dict for name in input_names):
        ordered_values = [feed_dict[name] for name in input_names]
    elif preferred_order and len(inputs) == len(preferred_order):
        ordered_values = [feed_dict[name] for name in preferred_order]
    else:
        raise RuntimeError(
            f"input mismatch. model inputs={input_names} "
            f"feed keys={list(feed_dict.keys())}"
        )
    target_shapes = [list(value.shape) for value in ordered_values]
    current_shapes = [list(tensor.shape) for tensor in inputs]
    if current_shapes != target_shapes:
        print(f"Resizing model inputs: {current_shapes} -> {target_shapes}")
        model.resize(inputs, target_shapes)
```

结构与紧邻上方的 `_build_mslite_inputs`（`:200-225`，本 PR 未改）刻意平行：同样是"先按名匹配、再按 `preferred_order` 兜底、否则 raise"。区别在于 `_build_mslite_inputs` 产出的是 Tensor 列表，本函数产出的是**一次 `Model.resize` 调用**。

四个读点：

| 读点 | 事实 | 含义 |
|---|---|---|
| `if not inputs: return` | 拿不到输入描述符时静默跳过 | 不给不支持 `get_inputs` 的版本添麻烦 |
| 按名匹配要求**全部**命中 | 名实不符时不是逐个回退而是整体回退 | 避免半按名半按序的混合绑定 |
| `current_shapes != target_shapes` 才 resize | 同形状时不调用 | 连续多轮同档推理不会重复 resize |
| 无档位合法性检查 | 目标形状是否落在四档内完全不判断 | 合法性由转换期与 GE 负责（§4） |

第三行值得强调：如果每次 `predict` 前都无脑 resize，MindIR 的动态形状缓存可能被反复失效。作者把"形状变了才 resize"写成显式条件，是一次**为多轮会话准备的优化**。

### 3.2 调用点：先 resize 再 predict

h42 的 before（`src/a151fcd1/qwen3.5_4b/infer_qwen3_5_4b_mslite.py:581-591`）：

```python
            prefill_feed = {
                "input_ids": input_ids.astype(np.int32),
                "attention_mask": attention_mask.astype(np.int32),
                "position_ids": position_ids_4.astype(np.int32),
                "image_embeds": image_embeds.astype(np.float16),
            }
            prefill_out = self.prefill_model.predict(
                _build_mslite_inputs(self.prefill_model, prefill_feed,
                                     preferred_order=["input_ids", "attention_mask",
                                                       "position_ids", "image_embeds"])
            )
```

after（终态 `:609-624`）：

```python
            prefill_feed = {
                "input_ids": input_ids.astype(np.int32),
                "attention_mask": attention_mask.astype(np.int32),
                "position_ids": position_ids_4.astype(np.int32),
                "image_embeds": image_embeds.astype(np.float16),
            }
            prefill_order = [
                "input_ids", "attention_mask", "position_ids", "image_embeds"
            ]
            _resize_dynamic_model_inputs(
                self.prefill_model, prefill_feed, preferred_order=prefill_order
            )
            prefill_out = self.prefill_model.predict(
                _build_mslite_inputs(self.prefill_model, prefill_feed,
                                     preferred_order=prefill_order)
            )
```

改动是三件事：把内联的 `preferred_order` 字面量提成 `prefill_order` 变量（供两处复用）、插入一次 `_resize_dynamic_model_inputs`、其余不动。**`position_ids_4` 的形状是 `[4, 1, seq]`**，正好对上 `input_shape` 里的 `4,1,-1`。

`resize` 在 `predict` 之前、在 `build_from_file` 之后的时间位置也很关键：模型已加载（有元数据形状可读），尚未执行（GE 还能改形状）。README 把这条顺序写成了用户可见的说明（h37，终态 `README.md:305-308`）：

```text
在Ascend设备上，推理脚本默认将Conv State、Recurrent State和KV Cache保留在
NPU侧，并对固定形状的Logits、Conv State、Recurrent State及KV Cache输出Tensor
进行复用。Prefill执行前，推理脚本会根据实际输入Shape调用`Model.resize`以选择
转换时配置的对应档位。
```

这段的最后一句是"根据实际输入 Shape 调用 `Model.resize` 以选择转换时配置的对应档位"——**"转换时配置"四字把 ini 与脚本连了起来**：档位是转换期定死的，选哪个档是运行期决定的，`resize` 是唯一的桥。

### 3.3 为什么 Decode 不需要

Decode 图在 02 篇 §5 之后所有输入输出都是常量形状，`current_shapes` 恒等于 `target_shapes`——即使调用 `_resize_dynamic_model_inputs` 也是空转。!1194 选择在 Decode 调用点上干脆不加，而不是加一个恒不触发的调用。这与本篇结论 1 一致：**两个模型的动态性来源不同，脚本侧的处置也必须不同**。

## §4 档位失配会怎样

### 4.1 README 的口径

终态 `README.md:220-224`（h35 段落，记账在 05 篇 §3）给出了三条面向用户的约束：

| 约束 | 原文位置 | 与本篇的关系 |
|---|---|---|
| 四档序列长度、`image_embeds` 固定 16 token、实际输入必须命中其中一档 | `README.md:221-222` | §1.3 的 4×4 对应 |
| `max_seq_len` 必须大于实际 Prompt 长度并为生成预留空间 | `README.md:223-224` | 01 篇 §5 的"生成上限挪到导出期" |
| Prefill MindIR 仅接受配置中的 Shape 组合；换 Prompt 需保证长度是 32/512/1024/2048 之一 | `README.md:383-384`（h39） | 本节 |

### 4.2 脚本侧没有任何挡错

把 §3.1 的表格最后一行与上面的 README 约束放在一起看，能得出本篇最实际的一条风险提示：

| 环节 | 是否校验"输入长度 ∈ 四档" | 证据 |
|---|---|---|
| 导出脚本 | 否（只校验 `dummy_seq <= max_seq_len`，见 01 篇 §2.4） | `export:1209-1214` |
| 转换 | 是（`ge.dynamicDims` 声明合法值集合） | ini 第 7 行 |
| 推理脚本 resize 前 | **否** | `infer:228-247` 全文无档位相关判断 |
| 推理脚本 predict | 由 MindSpore Lite / GE 决定 | 本工作区无法核对 |

因此：**用户把一个 100 token 的 prompt 喂进按四档转换的 Prefill MindIR 时，第一个可能的报错点是 `_resize_dynamic_model_inputs` 里那次 `model.resize` 调用本身，或者 `predict`。** 脚本不会提前给出"你的长度 100 不在 32/512/1024/2048 中"这样友好的提示。

> 推测（标记）：这是一个可以补的低成本改进（在 resize 前把 `target_shapes` 与配置档位比对并给出清晰报错），但本 PR 未做，也没有在 `90`/`91` 中被提到。不作评价——示例脚本与产品代码的容错标准本就不同。

## §5 为什么只有 Prefill 用 ini

### 5.1 三条转换命令的配置现状

终态 README 的转换小节里，三条命令的 `--configFile` 分别是：

```text
# Vision 转换
$Convert --fmk=ONNX \
  --modelFile=qwen3_5_4b_onnx/vision/qwen3_5_vision.onnx \
  --outputFile=qwen3_5_4b_mindir/qwen3_5_vision \
  --optimize=ascend_oriented \
  --configFile=config.ini \
  --saveType=MINDIR
```

```text
# Prefill 转换
$Convert --fmk=ONNX \
  --modelFile=qwen3_5_4b_onnx/prefill/qwen3_5_llm_prefill.onnx \
  --outputFile=qwen3_5_4b_mindir/qwen3_5_llm_prefill \
  --optimize=ascend_oriented \
  --configFile=configs/config_prefill.ini \
  --saveType=MINDIR
```

（以上两块逐字摘自 `src/942a0107/qwen3.5_4b/README.md:230-236` 与 `:238-244`；后者是 h36 把 `config.ini` 换成 `configs/config_prefill.ini` 的结果，1 增 1 删。）

Decode 那一栏在 `:246-253`，`--configFile=config.ini` **未变**（它比另两条多一行 `--device=Ascend`，属本 PR 之前的既有差异）。

### 5.2 三条理由

| 模型 | 是否需要 `ge.dynamicDims` | 原因 |
|---|---|---|
| Vision | 不需要 | `pixel_values: [64, 1536]` 是常量形状（README Shape 表 `:179`），本 PR 未改 |
| Prefill | **需要** | 输入侧保留 4 个动态维（§1.3），且要求"只允许这 4 个组合" |
| Decode | 不需要 | 全部形状常量（h15 不传 `dynamic_axes`），无动态维可约束 |

h40 顺带引入了 `configs/` 这个**子目录**——本 PR 之前，该示例目录下只有平铺的 `config.ini`。为什么新建目录而不是并列第二个平铺文件？工作区里没有说明。

> 推测（标记）：最可能的动机是可扩展性预告——一旦为 Decode 或 Vision 增加构建期配置，`configs/` 目录就是它们的落脚点；同时避免 `config.ini` 与 `config_prefill.ini` 在同一层引起"哪个管哪个模型"的误读。

### 5.3 精度模式为什么必须重复

新文件把 `ge.exec.precision_mode=force_fp32` 原样抄了一遍（而不是靠 `config.ini` 继承——`--configFile` 一次只接受一个文件，不存在继承机制）。这意味着 **`force_fp32` 现在有两个副本**，若将来要改精度策略，两个文件都要改。这是 `configs/config_prefill.ini` 与 `config.ini` 之间唯一真实的耦合风险。

## §6 小结：一次"约束"而不是"消除"

把 Prefill 与 Decode 并排收口：

| 维度 | Prefill | Decode |
|---|---|---|
| ONNX 动态轴 | 保留（4 个 `-1`） | 全取消（不传 `dynamic_axes`） |
| 约束落在哪一层 | 转换期 ini 的 `ge.dynamicDims` | 导出期常量形状 |
| 运行时自由度 | 4 个离散档位之间选 | 0 |
| 脚本侧新增动作 | `_resize_dynamic_model_inputs` | `_detect_fixed_decode_capacity`（02 篇 §6） |
| 新增配置文件 | `configs/config_prefill.ini` | 无 |
| 失败模式 | resize/predict 内部报错，无友好提示 | 5 条 `ValueError` 前置校验（01 篇 §3） |
| hunk 数（本篇口径） | h40 h11 h12 h41 h42 h37 h36 = 7 | 记在 01、02 篇 |

两个"新增函数"是一枚硬币的两面：`_resize_dynamic_model_inputs` 让**输入侧**能选档，`_detect_fixed_decode_capacity` 让**输出侧**能被反推。加上 02 篇的 h15，!1194 在运行时侧总共只加了这两个函数与一个 `kv` 双缓冲键，其余改动都发生在导出脚本内。