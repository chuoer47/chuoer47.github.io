---
title: "LeetCode Agent Lab - LeetCode集成与基准测试"
date: 2025-06-22
order: 5
---

# LeetCode Agent Lab - LeetCode 集成与基准测试

LeetCode 平台集成（`src/core/`）和基准测试（`src/benchmark/`）是项目的"对外连接"层。core 模块负责从 LeetCode 拉题、解析、提交；benchmark 模块负责 baseline 与 agent 的对比实验。本文深入分析这两个模块的设计。

<!-- more -->

## 1. LeetCode 平台集成

### 1.1 题目拉取

`core/sync.py`（约 540 行）通过 GraphQL API 从 leetcode.cn 拉取题目：

```python
# 简化的 GraphQL 查询
QUERY_PROBLEM = """
query questionDetail($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
        questionId
        title
        titleSlug
        content
        difficulty
        topicTags { name slug }
    }
}
"""
```

### 1.2 HTML 归一化

LeetCode 题目的描述是 HTML 格式，需要转换为纯文本。这里有个细节值得注意——`<sup>` 标签的处理：

```python
# 错误处理：10<sup>9</sup> → 109（丢失了指数含义）
# 正确处理：10<sup>9</sup> → 10^9（保留指数含义）
def normalize_superscript(html: str) -> str:
    # 将 <sup> 标签转换为 Unicode 上标或 ^ 表示
    ...
```

这个看似小问题，实际上直接影响 LLM 对约束条件的理解——如果 `10^9` 变成了 `109`，模型可能会给出完全不同的解法。

### 1.3 测试用例提取

从题目描述中自动提取 Input/Output 测试用例：

```
输入：nums = [2,7,11,15], target = 9
输出：[0,1]
    ↓ 解析
{"input": {"nums": [2,7,11,15], "target": 9}, "expected": [0,1]}
```

### 1.4 缓存策略

拉取的题目会做两级缓存：
- **原始缓存**：保存 API 返回的原始 JSON
- **归一化缓存**：保存处理后的结构化数据

这样重复拉取同一道题时不需要再次调用 API。

### 1.5 在线提交

`core/submit.py` 实现了 LeetCode 的在线提交流程：

```
1. 提取 CSRF Token
2. 构建提交 payload（lang + code + question_id）
3. POST 到 leetcode.cn/submit/
4. 轮询 submission status（accepted / wrong answer / runtime error / ...）
5. 返回提交结果
```

## 2. 基准测试系统

### 2.1 为什么需要基准测试

做 Agent 不是目的，证明 Agent 比 baseline 更好才是。基准测试系统提供了标准化的对比实验流程。

### 2.2 四个 CLI 命令

```bash
# 探测 LeetCode 连接
benchmark probe-submit

# 跑 baseline（直接 LLM 生成代码，无 Agent 循环）
benchmark run-baseline --problems data/test --output-dir output/baseline

# 跑 Agent（完整 react_agent 流程）
benchmark run-agent --problems data/test --output-dir output/agent

# 完整套件：探测 + baseline + agent + 报告
benchmark run-suite --problems data/test --output-dir output/benchmark
```

### 2.3 Baseline vs Agent

**Baseline**：直接让 LLM 生成代码，不做任何 Agent 循环。相当于"裸考"。

**Agent**：完整的 react_agent 流程——工具调用、本地测试、修改、对拍等。

对比维度：

| 维度 | 指标 |
|------|------|
| LLM 指标 | token 用量、API 调用次数、延迟 |
| 本地评估 | 测试通过率、执行时间、内存使用 |
| 在线提交 | LeetCode 通过率、运行时间排名 |

### 2.4 指标聚合

`benchmark/metrics.py` 定义了统一的指标模型：

```python
class LlmMetrics(BaseModel):
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    api_calls: int
    total_latency_ms: float

class LocalEvalMetrics(BaseModel):
    pass_count: int
    total_count: int
    pass_ratio: float
    avg_runtime_ms: float
    max_memory_mb: float

class OnlineSubmissionMetrics(BaseModel):
    submitted: bool
    accepted: bool
    runtime_percentile: float
    memory_percentile: float
```

### 2.5 报告生成

`benchmark/report.py` 将实验结果汇总为结构化报告，包含：
- 总体通过率对比
- Token 成本对比
- 延迟对比
- 每道题的详细结果

## 3. 题目数据管理

### 3.1 题目 JSON 格式

```json
{
  "slug": "two-sum",
  "title": "Two Sum",
  "description": "Given an integer array nums...",
  "function_name": "two_sum",
  "signature": "def two_sum(nums: list[int], target: int) -> list[int]:",
  "constraints": [
    "2 <= nums.length <= 10^4",
    "-10^9 <= nums[i] <= 10^9"
  ],
  "tests": [
    {"input": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1]},
    {"input": {"nums": [3, 2, 4], "target": 6}, "expected": [1, 2]}
  ]
}
```

### 3.2 竞赛同步

`core/contest_sync.py` 支持从 LeetCode 拉取竞赛信息，可以用于批量获取竞赛题目做测试。

### 3.3 算法模板库

`templates/` 目录包含 16 个类别、约 128 个算法模板：

```
templates/
├── binary_search/       # 二分查找
├── dynamic_programming/ # 动态规划
├── graph/               # 图论
├── sliding_window/      # 滑动窗口
├── two_pointers/        # 双指针
└── ...
```

模板库通过 `template_retrieve` 工具提供给 Agent 使用，Agent 可以检索相关模板作为解题参考。

## 4. 数据流完整链路

```
LeetCode API → core/sync.py → 题目 JSON → Agent 解题 → core/submit.py → LeetCode API
                                              ↓
                                     benchmark/metrics.py → 报告
```

## 总结

| 知识点 | 要点 |
|--------|------|
| 题目拉取 | GraphQL API + HTML 归一化 + `<sup>` 特殊处理 |
| 测试提取 | 从题目描述自动解析 Input/Output |
| 在线提交 | CSRF Token + 状态轮询 |
| 基准测试 | baseline（裸考）vs agent（完整流程） |
| 指标 | LLM 指标 + 本地评估 + 在线提交 |
| 模板库 | 16 类 ~128 个算法模板，供 Agent 检索参考 |

*项目源码：[leetcode-coder-agent](https://github.com/chuoer47/leetcode-coder-agent)*
