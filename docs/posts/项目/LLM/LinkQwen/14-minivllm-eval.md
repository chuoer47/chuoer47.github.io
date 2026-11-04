---
title: 14. MiniVLLM 评测记录
order: 14
---

# 14. MiniVLLM 评测记录

本章记录 MiniVLLM 的正确性、吞吐和任务效果评测。所有结果由 `minivllm/eval/` 下的脚本跑出，存放在 `minivllm/eval/results/`。

> 本文件作为可复查的实验日志：每轮评测写清环境、权重来源、命令、输入输出和结论。复现入口在 [minivllm/eval/README.md](https://github.com/chuoer47/LinkQwen3.5/blob/master/minivllm/eval/README.md)。

## 14.1 评测目标与对象

### 评测目标

1. **MiniVLLM 是否偏离原始实现**：同一权重、同一 prompt 下，MiniVLLM 和 native MiniQwen 的 logits 是否对齐。
2. **吞吐是否符合预期**：graph vs eager 的 prefill/decode 吞吐差异，不同 batch 下的 scaling。
3. **Prefix Cache 是否正确命中、是否带来收益**：共享前缀时 prefill token 是否减少，端到端是否变快。
4. **任务效果**：C-Eval 选择题准确率、GSM8K/GRPO/Agentic math 命中率。

### 评测对象

| 名称 | 路径 | 来源 | 格式 |
|------|------|------|------|
| 后训练适配权重 | `checkpoints/qwen35_posttrain_adapter` | `posttrain/adapter.py` 从官方 Qwen3.5-0.8B（后训练产物）适配 | `model.safetensors` |

> 评测默认用后训练产物适配权重（`qwen35_posttrain_adapter`），它是有对话能力的成品模型；想测 Base 权重可改用 `qwen35_adapter`。

## 14.2 评测套件结构

`minivllm/eval/` 是 MiniVLLM-only 的评测套件。6 个脚本：

| 脚本 | 用途 |
|------|------|
| `run_eval_suite.py` | 编排器：跑 speed/quality 矩阵，写 summary 报告 |
| `bench_dataset.py` | 真实数据集速度基准（C-Eval 或 JSONL，按 batch×backend×prefix 矩阵） |
| `eval_ceval.py` | C-Eval 选择题准确率（0-shot/5-shot） |
| `eval_math.py` | 数学题数值精确匹配（GSM8K/GRPO/Agentic） |
| `profile_deltanet_micro.py` | DeltaNet FLA kernel 微基准（batch×seq_len） |
| `verify_miniqwen_alignment.py` | 对齐 native MiniQwen（权重 + logits） |

一键跑全套：

```bash
MASTER_PORT=29700 python minivllm/eval/run_eval_suite.py \
    --model checkpoints/qwen35_posttrain_adapter --full
```

`--full` 跑全量数据集（C-Eval 52 科目 1346 题、GSM8K 1000 题、GRPO math 1000 题、agentic_math 60 题）；不传则用默认 limit 快速覆盖。结果写到 `minivllm/eval/results/<coverage_eval|full_eval>/<时间戳>/`。

## 14.3 native 对齐（正确性）

`verify_miniqwen_alignment.py` 检查 MiniVLLM 与 native MiniQwen 的权重映射和 logits 是否一致。本轮在 bf16 下通过：

| DType | Seq Len | 状态 | 权重精确 | Prefill max-abs | Prefill top1 | Decode max-abs | Decode top1 |
|-------|---------|------|----------|-----------------|--------------|----------------|-------------|
| bf16 | 128 | **pass** | yes | 0.34 | True | 0.32 | True |
| bf16 | 32 | **pass** | yes | 0.44 | True | 0.44 | True |
| fp32 | 32/128 | unsupported | yes | — | — | — | — |

**结论**：
1. bf16 下权重映射完全精确，prefill/decode 的 top-1 预测完全一致，max-abs-diff 在 bf16 量级（0.3~0.4），属于 bf16 内核累加顺序差异，不是建模错误。
2. fp32 暂不支持——FLA 的 `ChunkGatedDeltaRuleFunction` 要求 bfloat16，fp32 路径会在运行时 dtype 断言处中断。但权重映射检查在断言前就已通过，说明 `linear_attn→mixer`/`self_attn→mixer`/`gate_proj+up_proj→gate_up_proj` 的映射是正确的。

## 14.4 吞吐评测

### 短输出吞吐（max_tokens=8, graph, prefix off）

batch scaling（C-Eval 1346 题 / GSM8K 1000 题，graph decode）：

| Dataset | Batch | Prefill tok/s | Decode tok/s | Output tok/s | Total s | Amort req ms |
|---------|-------|----------------|---------------|--------------|---------|---------------|
| C-Eval | 1 | 1107.6 | 225.8 | 72.2 | 149.15 | 110.8 |
| C-Eval | 2 | 1433.9 | 407.7 | 101.5 | 106.08 | 78.8 |
| C-Eval | 4 | 2487.4 | 654.5 | 173.1 | 62.22 | 46.2 |
| C-Eval | 8 | 3292.0 | 1141.2 | 242.6 | 44.39 | 33.0 |
| C-Eval | 16 | 1680.3 | 1986.7 | 142.6 | 75.53 | 56.1 |
| GSM8K | 1 | 692.7 | 222.3 | 68.2 | 117.29 | 117.3 |
| GSM8K | 2 | 1161.7 | 411.9 | 117.4 | 68.16 | 68.2 |
| GSM8K | 4 | 1933.8 | 650.9 | 192.8 | 41.49 | 41.5 |
| GSM8K | 8 | 4604.4 | 1126.7 | 418.3 | 19.12 | 19.1 |
| GSM8K | 16 | 1892.8 | 2018.5 | 229.4 | 34.87 | 34.9 |

**关键观察**：短输出（max_tokens=8）下 batch=8 是吞吐甜点；batch=16 反而退化（decode 快但 prefill/调度开销分摊不利）。

### 长 decode 吞吐（GSM8K, graph, prefix off）

| Max Tokens | Batch | Decode tok/s | Output tok/s | Total s | Amort req ms |
|------------|-------|--------------|--------------|---------|---------------|
| 32 | 8 | 1343.8 | 531.4 | 60.22 | 60.2 |
| 32 | 16 | 2185.1 | 1044.5 | 30.64 | 30.6 |
| 128 | 8 | 1030.7 | 823.6 | 155.42 | 155.4 |

> 这里 `max_tokens=32, bs16` 的 decode tok/s 达到 2185，output tok/s 达到 1044。长 decode 时 bs16 的优势显现（prefill 成本被更多 output token 摊薄）。

### graph vs eager（sample 256, bs8, prefix off）

| Dataset | Backend | Prefill tok/s | Decode tok/s | Output tok/s | Total s |
|---------|---------|----------------|---------------|--------------|---------|
| C-Eval | eager | 9665.0 | 270.4 | 230.1 | 8.90 |
| C-Eval | graph | 725.6 | 1274.6 | 64.7 | 31.63 |
| GSM8K | eager | 7654.4 | 280.4 | 242.9 | 8.43 |
| GSM8K | graph | 818.8 | 1288.7 | 100.1 | 20.46 |

**关键结论（重要）**：
- **graph 的 decode 比 eager 快约 4.7×**（1274 vs 270 tok/s），这正是 CUDA Graph 减少 kernel launch 开销的收益。
- **但 graph 的 prefill 远慢于 eager**（725 vs 9665 tok/s）——graph 模式下 prefill 仍走 eager forward，但额外的状态准备/slot 管理开销让 prefill 变慢。
- 短输出（max_tokens=8）时 prefill 占比大，**eager 端到端反而更快**（8.9s vs 31.6s）。这说明当前 graph prefill 编排路径是主要优化瓶颈。

## 14.5 Prefix Cache 评测

C-Eval 1346 题，bs8，max_tokens=8，graph：

| Prefix | Prefill tok/s | Decode tok/s | Output tok/s | Total s | Amort req ms |
|--------|----------------|---------------|--------------|---------|---------------|
| off | 3292.0 | 1141.2 | 242.6 | 44.39 | 33.0 |
| on | 1528.5 | 1236.6 | 126.0 | 85.44 | 63.5 |

**结论（当前实现的局限）**：
1. **Prefix Cache 对质量无影响**：C-Eval 5-shot 准确率 off 50.59% vs on 50.45%，几乎一致——命中逻辑正确，没把答案搞坏。
2. **但 Prefix Cache 当前反而更慢**：on 比 off 慢约 2×（85s vs 44s）。原因是当前实现要在 block 边界切分 prefill，并保存/恢复每层 DeltaNet 的 `conv_state + recurrent_state` 快照，调度和 snapshot 成本超过了节省的 prefill 计算。
3. 因此 prefix cache 当前**不宜默认启用**——它是一个优化候选，不是默认收益。这正是 `coverage_report.md` 标记的"next profiling target"。

> 这和第 13 章 13.9 讲的一致：MiniQwen 的 prefix cache 不是纯 KV cache，每个 block 还要绑定 18 层 DeltaNet 的 snapshot（约 9.63 MiB/block），保存/恢复成本高。当前的实现把正确性做对了，速度优化是后续工作。

## 14.6 任务效果评测

### C-Eval 选择题准确率（52 科目，1346 题）

| 配置 | N | Correct | Accuracy | Missing Pred |
|------|---|---------|----------|--------------|
| 0-shot, max_tokens=8 | 1346 | 635 | 47.18% | 65 |
| 5-shot, prefix off | 1346 | 681 | **50.59%** | 0 |
| 5-shot, prefix on | 1346 | 679 | 50.45% | 0 |

**科目极值**（5-shot）：

| 分组 | 科目 | N | Correct | Acc |
|------|------|---|---------|-----|
| 最强 5 | 初中物理 | 19 | 16 | 84.21% |
| | 初中政治 | 21 | 16 | 76.19% |
| | 教师资格 | 44 | 33 | 75.00% |
| 最弱 5 | 高中数学 | 18 | 2 | 11.11% |
| | 离散数学 | 16 | 3 | 18.75% |
| | 法学 | 24 | 6 | 25.00% |

> 5-shot 比 0-shot 高约 3 个点（50.59% vs 47.18%），且 0-shot 有 65 题 missing pred（模型没给出 ABCD）。0.8B 后训练模型在 C-Eval 上约 50% 是合理水平（随机基线 25%）。

### 数学题命中率

| Dataset | Max Tokens | N | Correct | Accuracy |
|---------|------------|---|---------|----------|
| GSM8K | 64 | 1000 | 57 | 5.70% |
| GSM8K | 128 | 1000 | 96 | 9.60% |
| GRPO math | 32 | 1000 | 30 | 3.00% |
| GRPO math | 64 | 1000 | 54 | 5.40% |
| agentic_math | 32 | 60 | 27 | 45.00% |
| agentic_math | 64 | 60 | 29 | 48.33% |

**结论**：
1. 数学准确率整体偏低（GSM8K 5.7~9.6%、GRPO 3~5.4%）——0.8B 模型的数学能力有限，这反映的是**模型本身能力**，不是推理引擎问题（native 侧同样低）。
2. 增加生成 token 数能改善约 2×（GSM8K 64→128 从 5.70% 到 9.60%），说明部分题目是"想得不够长就被截断"。
3. agentic_math 命中率高（45~48%）是因为题目数少（60）且 prompt 短，任务相对简单。

## 14.7 DeltaNet FLA kernel 微基准

`profile_deltanet_micro.py` 测纯 kernel（不含模型/调度开销）：

| Batch | Seq Len | Prefill tok/s | Decode tok/s |
|-------|---------|----------------|--------------|
| 1 | 1 | 842.6 | 111,068.5 |
| 1 | 128 | 470,609.5 | 810,261.2 |
| 1 | 512 | 1,859,371.3 | 807,658.8 |
| 8 | 128 | 3,664,019.9 | 3,046,493.9 |
| 16 | 512 | 6,472,218.9 | 3,838,239.4 |

**结论**：FLA 的 DeltaNet kernel 在大多数测试形状下都是 sub-ms 级别，kernel 本身不是瓶颈。

## 14.8 总结

### 当前 MiniVLLM 的画像

| 维度 | 当前状态 |
|------|----------|
| **正确性** | bf16 下与 native MiniQwen top-1 完全一致，max-abs 在 bf16 量级；fp32 暂不支持（FLA 限制） |
| **decode 吞吐** | graph 比 eager 快约 4.7×（1274 vs 270 tok/s），CUDA Graph 收益明显 |
| **prefill 吞吐** | graph 比 eager 慢（725 vs 9665 tok/s），graph prefill 编排是当前主要瓶颈 |
| **Prefix Cache** | 命中正确、质量中性，但当前反而更慢（需保存/恢复 DeltaNet snapshot），不宜默认开 |
| **C-Eval** | 5-shot 50.59%（0.8B 后训练模型的合理水平） |
| **数学** | GSM8K 5.7~9.6%，受限于模型能力而非引擎 |
| **DeltaNet kernel** | sub-ms，FLA kernel 不是瓶颈 |

### 后续优化方向

1. **优先优化 graph prefill 路径**：graph decode 已快，但 graph prefill 是 E2E 瓶颈。
2. **Prefix Cache 速度优化后再默认启用**：当前正确但慢，需降低 DeltaNet snapshot 的保存/恢复成本。
3. **质量评测分离模型能力与 decode 预算**：数学准确率随生成 token 数提升，应先确定服务预算再跑长生成质量变体。

### 评测的可复现性

所有数字都可由 `minivllm/eval/` 脚本复现：

```bash
# 全量评测（C-Eval 52 科目 + GSM8K/GRPO/Agentic 全量）
python minivllm/eval/run_eval_suite.py --model checkpoints/qwen35_posttrain_adapter --full

# 单项
python minivllm/eval/eval_ceval.py --model checkpoints/qwen35_posttrain_adapter --all-subjects --few-shot 5
python minivllm/eval/eval_math.py --model checkpoints/qwen35_posttrain_adapter --dataset gsm8k --limit 1000
python minivllm/eval/verify_miniqwen_alignment.py --model checkpoints/qwen35_posttrain_adapter --dtype bf16
python minivllm/eval/bench_dataset.py --model checkpoints/qwen35_posttrain_adapter --dataset ceval --batch-sizes 8 --backend graph
python minivllm/eval/profile_deltanet_micro.py --model checkpoints/qwen35_posttrain_adapter
```

具体数值会随 GPU、驱动、PyTorch/FLA 版本、prompt 长度、batch 形态变化；正式对比要保存脚本参数和输出 JSON（见 `minivllm/eval/results/`）。

---

**上一章**：[13. minivllm](./13-minivllm.md)
