---
title: Task与Crew详解
date: 2025-06-22
tags: [Python, CrewAI, Task, Crew, 执行流程]
category: CrewAI
order: 3
---

# Task 与 Crew 详解

## 1. Task 核心概念

Task 是分配给 Agent 的具体工作任务。每个 Task 有明确的描述、期望输出和执行者。Task 是 CrewAI 中连接"做什么"和"谁来做"的桥梁。

### Task 的三大要素

| 要素 | 作用 | 示例 |
|------|------|------|
| `description` | 任务描述——告诉 Agent 要做什么 | `"分析竞品的技术架构和定价策略"` |
| `expected_output` | 期望输出——明确成功标准 | `"包含 5 个竞品的对比分析表格"` |
| `agent` | 执行者——由哪个 Agent 执行 | `researcher` |

::: warning
`expected_output` 是必填项。它不是可选的"装饰"，而是 Agent 行为的重要引导。写得越清晰，Agent 的输出质量越高。
:::

## 2. 创建 Task

### 2.1 基础用法

```python
from crewai import Agent, Task

researcher = Agent(
    role="市场研究员",
    goal="深入调研目标市场",
    backstory="资深市场研究员"
)

task = Task(
    description="调研中国新能源汽车市场的竞争格局，重点关注比亚迪、特斯拉、蔚来三家企业的市场份额、技术路线和定价策略",
    expected_output="""一份结构化的竞品分析报告，包含：
1. 市场概况（市场规模、增长率）
2. 三家企业的核心数据对比表格
3. 各企业的 SWOT 分析
4. 趋势预测和建议""",
    agent=researcher
)
```

### 2.2 完整参数配置

```python
from crewai import Task
from pydantic import BaseModel
from typing import List

# 结构化输出模型
class Finding(BaseModel):
    title: str
    description: str
    confidence: float

class ResearchOutput(BaseModel):
    summary: str
    findings: List[Finding]

task = Task(
    # === 核心参数 ===
    description="执行详细的任务描述...",
    expected_output="明确的输出格式要求...",
    agent=researcher,

    # === 上下文 ===
    context=[prior_task1, prior_task2],     # 依赖的前置任务

    # === 输出控制 ===
    output_file="output/report.md",         # 输出保存到文件
    output_pydantic=ResearchOutput,         # Pydantic 结构化输出
    # output_json=ResearchOutput,           # JSON 输出（与 output_pydantic 二选一）

    # === 工具 ===
    tools=[search_tool, data_tool],         # 覆盖 Agent 默认工具

    # === 执行模式 ===
    async_execution=False,                  # 是否异步执行
    human_input=False,                      # 是否需要人类输入

    # === 回调 ===
    callback=task_complete_callback,        # 任务完成回调

    # === 其他 ===
    max_retries=3,                          # 最大重试次数
)
```

### 2.3 参数详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `description` | `str` | 必填 | 任务描述 |
| `expected_output` | `str` | 必填 | 期望输出格式 |
| `agent` | `Agent` | 必填 | 执行任务的 Agent |
| `context` | `list[Task]` | `None` | 前置任务，其输出作为上下文 |
| `tools` | `list` | `None` | 覆盖 Agent 的默认工具 |
| `output_file` | `str` | `None` | 输出文件路径 |
| `output_pydantic` | `BaseModel` | `None` | Pydantic 结构化输出模型 |
| `output_json` | `BaseModel` | `None` | JSON 输出模型 |
| `async_execution` | `bool` | `False` | 是否异步执行 |
| `human_input` | `bool` | `False` | 是否需要人类输入 |
| `callback` | `callable` | `None` | 完成回调函数 |
| `max_retries` | `int` | `3` | 最大重试次数 |

## 3. 任务上下文与依赖

### 3.1 通过 `context` 传递数据

```python
research_task = Task(
    description="调研目标市场的技术趋势",
    expected_output="技术趋势报告",
    agent=researcher
)

analysis_task = Task(
    description="基于调研结果进行深度分析",
    expected_output="包含数据支撑的分析报告",
    agent=analyst,
    context=[research_task]  # research_task 的输出会自动传入
)
```

### 3.2 顺序执行中的隐式依赖

在 `Process.sequential` 模式下，任务按顺序执行，前一个任务的输出自动成为后一个任务的上下文：

```python
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, writing_task],
    process=Process.sequential  # 自动按顺序传递上下文
)
```

## 4. 结构化输出

### 4.1 使用 Pydantic 模型

```python
from pydantic import BaseModel, Field
from typing import List

class TrendItem(BaseModel):
    name: str = Field(description="趋势名称")
    description: str = Field(description="详细说明")
    impact: str = Field(description="影响评估：高/中/低")
    examples: List[str] = Field(description="代表性案例")

class TrendsReport(BaseModel):
    title: str
    summary: str
    trends: List[TrendItem]

task = Task(
    description="分析 2025 年 AI 技术趋势",
    expected_output="结构化的趋势报告",
    agent=analyst,
    output_pydantic=TrendsReport
)

# 执行后访问结构化数据
crew = Crew(agents=[analyst], tasks=[task])
result = crew.kickoff()

# result.pydantic -> TrendsReport 实例
print(result.pydantic.title)
for trend in result.pydantic.trends:
    print(f"- {trend.name}: {trend.impact}")
```

### 4.2 输出到文件

```python
task = Task(
    description="生成月度报告",
    expected_output="完整的月度报告",
    agent=analyst,
    output_file="reports/monthly_report.md"  # 自动保存到文件
)
```

::: tip
`output_pydantic` 和 `output_json` 互斥，只能选一个。
`output_pydantic` 通过 `result.pydantic` 访问，`output_json` 通过 `result.json_dict` 访问。
:::

## 5. Crew 核心概念

Crew 是 Agent 和 Task 的执行容器。它定义了"谁做什么、按什么顺序做"。

### 5.1 基础用法

```python
from crewai import Crew, Process

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
    verbose=True
)

result = crew.kickoff()
```

### 5.2 完整参数配置

```python
crew = Crew(
    # === 核心 ===
    agents=[agent1, agent2],
    tasks=[task1, task2],
    process=Process.sequential,

    # === LLM ===
    manager_llm="gpt-4o",              # hierarchical 模式下的管理 Agent LLM
    manager_agent=None,                 # 自定义管理 Agent（替代自动生成）

    # === 记忆 ===
    memory=True,                        # 启用记忆系统

    # === 规划 ===
    planning=True,                      # 启用自动规划
    planning_llm="gpt-4o",             # 规划用 LLM

    # === 回调 ===
    step_callback=my_step_callback,     # 每步回调
    task_callback=my_task_callback,     # 每个 Task 完成回调

    # === 日志 ===
    verbose=True,                       # 详细日志

    # === 嵌入器（记忆用） ===
    embedder={
        "provider": "openai",
        "config": {"model": "text-embedding-3-small"}
    },

    # === 其他 ===
    max_rpm=10,                         # 全局限流
    language="en",                      # Agent 交互语言
    full_output=True,                   # 返回完整输出（含中间步骤）
)
```

## 6. 执行模式（Process）

### 6.1 Sequential（顺序执行）

任务按列表顺序依次执行。前一个任务的输出自动成为后续任务的上下文。

```
Task1 (Researcher) → Task2 (Analyst) → Task3 (Writer)
     ↓                    ↓                    ↓
   输出1               输出1+2             输出1+2+3
```

```python
from crewai import Crew, Process

crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, writing_task],
    process=Process.sequential
)
result = crew.kickoff()
```

**适用场景**：流水线式工作流，如 调研 → 分析 → 报告。

### 6.2 Hierarchical（层级执行）

自动创建一个 Manager Agent 来协调其他 Agent。Manager 负责任务分配、质量审核和流程控制。

```
         ┌─────────────┐
         │ Manager     │
         │ (自动创建)   │
         └──────┬──────┘
                │ 分配/审核
        ┌───────┼───────┐
        ↓       ↓       ↓
    Researcher Analyst Writer
```

```python
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[task1, task2, task3],
    process=Process.hierarchical,
    manager_llm="gpt-4o"  # Manager 使用的 LLM
)
result = crew.kickoff()
```

**适用场景**：需要动态调度、质量审核、并行执行的复杂场景。

### 6.3 对比

| 特性 | Sequential | Hierarchical |
|------|-----------|--------------|
| 执行顺序 | 线性、预定义 | 动态、由 Manager 调度 |
| 协调方式 | 无需协调 | Manager Agent 自动协调 |
| 并行能力 | 不支持 | 支持（无依赖的任务可并行） |
| 复杂度 | 简单 | 较高 |
| 适用场景 | 流水线工作流 | 多 Agent 协调 |
| 额外 LLM 开销 | 无 | Manager 需要额外 LLM 调用 |

## 7. Crew 执行方法

### 7.1 同步执行

```python
result = crew.kickoff()
print(result)
```

### 7.2 异步执行

```python
import asyncio

async def main():
    result = await crew.kickoff_async()
    print(result)

asyncio.run(main())
```

### 7.3 批量执行

对多组输入并行运行 Crew：

```python
inputs_list = [
    {"topic": "AI 在医疗领域的应用"},
    {"topic": "AI 在金融领域的应用"},
    {"topic": "AI 在教育领域的应用"},
]

results = await crew.kickoff_for_each_async(inputs_list)
for result in results:
    print(result)
```

### 7.4 获取完整输出

```python
crew = Crew(
    agents=[...],
    tasks=[...],
    full_output=True  # 返回详细的执行信息
)

result = crew.kickoff()
# result.tasks_output  -> 所有 Task 的输出列表
# result.token_usage   -> Token 使用统计
# result.raw           -> 原始输出
```

## 8. 规划模式（Planning）

启用 `planning=True` 后，Crew 会在执行前自动生成一个执行计划：

```python
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    planning=True,
    planning_llm="gpt-4o"
)

# kickoff 时会先生成计划，再按计划执行
result = crew.kickoff()
```

::: tip
规划模式会增加一次额外的 LLM 调用来生成计划，但对于复杂任务，它能显著提升执行质量和效率。
:::

## 9. 完整示例：研究报告生成

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import SerperDevTool

# 工具
search = SerperDevTool()

# Agents
researcher = Agent(
    role="高级研究员",
    goal="深入调研指定主题，收集全面可靠的信息",
    backstory="你是一位在顶级研究机构工作 15 年的资深研究员，擅长多源信息交叉验证。",
    tools=[search],
    verbose=True
)

analyst = Agent(
    role="数据分析师",
    goal="对调研数据进行深度分析，发现关键洞察",
    backstory="你是一位经验丰富的数据分析师，善于从数据中发现趋势和规律。",
    verbose=True
)

writer = Agent(
    role="技术报告撰写者",
    goal="将分析结果转化为结构清晰、逻辑严谨的专业报告",
    backstory="你是一位资深技术写作专家，报告曾被多家顶级期刊收录。",
    verbose=True
)

# Tasks
research_task = Task(
    description="全面调研大语言模型在企业级应用中的落地案例，覆盖金融、医疗、教育三个行业",
    expected_output="""一份结构化的调研报告，每个行业包含：
1. 至少 3 个具体案例
2. 技术方案概述
3. 应用效果数据""",
    agent=researcher
)

analysis_task = Task(
    description="基于调研结果，分析不同行业应用 LLM 的共性挑战和差异化策略",
    expected_output="""一份分析报告，包含：
1. 跨行业共性挑战（如数据隐私、成本控制）
2. 各行业差异化策略
3. ROI 分析框架""",
    agent=analyst,
    context=[research_task]
)

report_task = Task(
    description="撰写一份面向企业 CTO 的决策参考报告",
    expected_output="""一份 3000 字左右的专业报告，包含：
1. 执行摘要
2. 行业案例详述
3. 挑战与策略分析
4. 实施建议
5. 附录""",
    agent=writer,
    context=[analysis_task],
    output_file="output/llm_enterprise_report.md"
)

# Crew
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, report_task],
    process=Process.sequential,
    memory=True,
    verbose=True
)

result = crew.kickoff()
print("报告已生成：output/llm_enterprise_report.md")
```

## 总结

| 知识点 | 要点 |
|--------|------|
| Task 三要素 | `description`、`expected_output`、`agent` |
| 上下文传递 | 通过 `context` 或顺序执行自动传递 |
| 结构化输出 | `output_pydantic` / `output_json` |
| Sequential | 线性执行，适合流水线 |
| Hierarchical | Manager 协调，适合复杂协作 |
| 执行方法 | `kickoff()` / `kickoff_async()` / `kickoff_for_each_async()` |
| 规划模式 | `planning=True` 自动生成执行计划 |
