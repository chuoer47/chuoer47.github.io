---
title: Agent详解
date: 2025-06-22
tags: [Python, CrewAI, Agent, LLM, AI]
category: CrewAI
order: 2
---

# Agent 详解

## 1. Agent 核心概念

Agent 是 CrewAI 的基本执行单元。每个 Agent 代表一个具有特定角色、目标和背景的自主智能体。Agent 的设计理念源自现实团队——就像公司里有产品经理、开发工程师、测试工程师一样，每个 Agent 专注于自己的领域。

### Agent 的三大要素

| 要素 | 作用 | 示例 |
|------|------|------|
| `role` | Agent 的身份/职位 | `"高级 Python 开发工程师"` |
| `goal` | Agent 追求的目标 | `"编写高质量、可维护的代码"` |
| `backstory` | 背景上下文，塑造行为模式 | `"你有 10 年 Python 开发经验，精通设计模式..."` |

::: warning
这三个字段是 Agent 的"灵魂"。好的定义能让 Agent 表现出色，模糊的定义会导致输出质量下降。花时间写好这三个字段是值得的。
:::

## 2. 创建 Agent

### 2.1 基础用法

```python
from crewai import Agent

researcher = Agent(
    role="高级 AI 研究员",
    goal="深入分析人工智能领域的最新技术突破和产业应用",
    backstory="""你是一位在顶级 AI 实验室工作了 15 年的资深研究员。
你的专长是计算机视觉和自然语言处理。
你善于从复杂的技术论文中提取关键信息，
并用通俗易懂的语言向非技术人员解释。""",
    verbose=True
)
```

### 2.2 完整参数配置

```python
from crewai import Agent
from crewai_tools import SerperDevTool, WebsiteSearchTool

agent = Agent(
    # === 核心三要素 ===
    role="数据分析师",
    goal="从数据中发现有价值的洞察并生成可视化报告",
    backstory="你是一位资深数据分析师，擅长统计分析和数据可视化。",

    # === LLM 配置 ===
    llm="gpt-4o",                          # 指定 LLM（默认 gpt-4o-mini）

    # === 工具 ===
    tools=[SerperDevTool(), WebsiteSearchTool()],

    # === 行为控制 ===
    verbose=True,                           # 打印详细执行日志
    allow_delegation=True,                  # 允许将任务委托给其他 Agent
    max_iter=15,                            # 单次任务最大迭代次数
    max_rpm=10,                             # 每分钟最大 API 请求数（限流）
    max_retry_limit=3,                      # 出错时最大重试次数

    # === 记忆 ===
    memory=True,                            # 启用记忆

    # === 回调 ===
    step_callback=my_step_callback,         # 每步执行后的回调函数

    # === 系统模板（高级） ===
    system_template=None,                   # 自定义系统提示词模板
    prompt_template=None,                   # 自定义用户提示词模板
    response_template=None,                 # 自定义响应模板

    # === 其他 ===
    use_system_prompt=True,                 # 是否使用系统提示词
)
```

### 2.3 参数详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `role` | `str` | 必填 | Agent 的角色定义 |
| `goal` | `str` | 必填 | Agent 的目标 |
| `backstory` | `str` | 必填 | Agent 的背景故事 |
| `llm` | `str/LLM` | `"gpt-4o-mini"` | 使用的语言模型 |
| `tools` | `list` | `[]` | 可用工具列表 |
| `verbose` | `bool` | `False` | 是否打印详细日志 |
| `allow_delegation` | `bool` | `True` | 是否允许委托任务 |
| `max_iter` | `int` | `20` | 最大迭代次数 |
| `max_rpm` | `int` | `None` | API 限流（请求/分钟） |
| `max_retry_limit` | `int` | `2` | 最大重试次数 |
| `memory` | `bool` | `True` | 是否启用记忆 |

## 3. Agent 设计最佳实践

### 3.1 角色定义技巧

**原则：具体、专业、有区分度**

```python
# ❌ 太模糊
role = "开发者"

# ✅ 具体明确
role = "高级 Python 后端开发工程师，精通 FastAPI 和 PostgreSQL"

# ❌ 太宽泛
goal = "完成任务"

# ✅ 可衡量、有方向
goal = "编写符合 PEP 8 规范、包含完整类型注解和单元测试的 Python 代码"
```

### 3.2 背景故事的作用

背景故事不仅仅是"装饰"，它会显著影响 Agent 的行为模式：

```python
# 背景故事影响写作风格
writer_formal = Agent(
    role="技术文档撰写者",
    goal="撰写技术文档",
    backstory="""你是一位严谨的技术文档工程师，有 15 年企业级软件文档经验。
你习惯使用正式的书面语，文档结构严格按照 Google 技术写作规范。"""
)

writer_casual = Agent(
    role="技术博客作者",
    goal="撰写技术博客",
    backstory="""你是一位活跃的技术博主，以深入浅出、风趣幽默的风格著称。
你擅长用类比和比喻解释复杂概念，文章经常使用表情符号和口语化表达。"""
)
```

### 3.3 避免角色重叠

每个 Agent 应有清晰的职责边界，避免多个 Agent 做同样的事：

```python
# ❌ 角色重叠
agent1 = Agent(role="Python 开发者", goal="写代码")
agent2 = Agent(role="程序员", goal="写 Python 代码")

# ✅ 职责分明
agent1 = Agent(role="架构师", goal="设计系统架构和技术方案")
agent2 = Agent(role="Python 开发者", goal="根据架构设计实现代码")
agent3 = Agent(role="代码审查员", goal="审查代码质量和规范")
```

## 4. 委托机制（Delegation）

当 `allow_delegation=True` 时，Agent 可以将任务委托给 Crew 中的其他 Agent。这模拟了真实团队中的协作模式。

```python
from crewai import Agent, Task, Crew, Process

planner = Agent(
    role="项目经理",
    goal="制定项目计划并协调团队",
    backstory="你是一位经验丰富的项目经理，善于任务分配和进度管理。",
    allow_delegation=True  # 允许委托
)

developer = Agent(
    role="Python 开发者",
    goal="实现项目功能",
    backstory="你是一位资深 Python 开发者。",
    allow_delegation=False  # 不委托，专注执行
)

task = Task(
    description="设计并实现一个 REST API 服务",
    expected_output="完整的 API 设计文档和实现代码",
    agent=planner  # 项目经理可能会将实现部分委托给 developer
)

crew = Crew(
    agents=[planner, developer],
    tasks=[task],
    process=Process.sequential
)
```

::: tip 何时使用委托
- **层级模式**：项目经理 → 开发者，适合 `hierarchical` 流程
- **协作模式**：研究员发现需要数据分析，委托给数据分析师
- **审核模式**：写手完成初稿后，委托给审稿员检查
:::

## 5. 自定义 LLM

### 5.1 使用不同提供商

```python
from crewai import Agent, LLM

# 使用 Claude
claude_agent = Agent(
    role="分析师",
    goal="深度分析",
    backstory="资深分析师",
    llm=LLM(model="anthropic/claude-sonnet-4-20250514")
)

# 使用本地 Ollama
local_agent = Agent(
    role="代码助手",
    goal="辅助编程",
    backstory="编程助手",
    llm=LLM(model="ollama/llama3.1", base_url="http://localhost:11434")
)

# 使用 Azure OpenAI
azure_agent = Agent(
    role="助手",
    goal="完成任务",
    backstory="AI 助手",
    llm=LLM(
        model="azure/gpt-4o",
        base_url="https://my-resource.openai.azure.com/",
        api_key="your-azure-key"
    )
)
```

### 5.2 混合使用 LLM

不同 Agent 可以使用不同的 LLM，按任务复杂度分配资源：

```python
# 复杂推理用强模型
architect = Agent(
    role="系统架构师",
    goal="设计高可用架构",
    backstory="资深架构师",
    llm=LLM(model="openai/gpt-4o")  # 强模型
)

# 简单任务用轻量模型
note_taker = Agent(
    role="会议记录员",
    goal="记录会议要点",
    backstory="高效的记录员",
    llm=LLM(model="openai/gpt-4o-mini")  # 轻量模型，成本低
)
```

## 6. 回调函数

### 6.1 Step Callback

在 Agent 每执行一步（思考/行动）后触发：

```python
def step_callback(step_output):
    """每次 Agent 执行一步后调用"""
    print(f"--- Step 完成 ---")
    print(f"Agent 思考: {step_output}")
    print(f"------------------")

agent = Agent(
    role="研究员",
    goal="调研",
    backstory="研究员",
    step_callback=step_callback
)
```

### 6.2 Task Callback

在 Task 完成后触发：

```python
def task_callback(output):
    """Task 完成后调用"""
    print(f"Task 完成，输出长度: {len(str(output))} 字符")

crew = Crew(
    agents=[agent],
    tasks=[task],
    task_callback=task_callback
)
```

## 7. Human-in-the-Loop

通过 Task 的 `human_input` 参数，可以在 Agent 执行前请求人类输入：

```python
from crewai import Agent, Task, Crew

agent = Agent(
    role="分析师",
    goal="分析数据并提供建议",
    backstory="资深数据分析师"
)

task = Task(
    description="分析数据并生成报告",
    expected_output="分析报告",
    agent=agent,
    human_input=True  # 执行前会暂停，等待人类输入反馈
)

crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()
```

::: warning
`human_input=True` 会在终端中暂停并等待输入。在 Web 应用或自动化场景中需要谨慎使用。
:::

## 总结

| 知识点 | 要点 |
|--------|------|
| Agent 三要素 | `role`（角色）、`goal`（目标）、`backstory`（背景） |
| 角色设计 | 具体、专业、有区分度 |
| 委托机制 | `allow_delegation=True` 允许 Agent 间协作 |
| LLM 配置 | 不同 Agent 可用不同 LLM，按需分配资源 |
| 回调机制 | `step_callback` 监控执行过程，`task_callback` 监控任务完成 |
| 人机协作 | `human_input=True` 在任务执行前请求人类反馈 |
