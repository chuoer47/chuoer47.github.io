---
title: CrewAI概述与环境搭建
date: 2025-06-22
tags: [Python, CrewAI, LLM, AI, Agent, 多智能体]
category: CrewAI
order: 1
---

# CrewAI 概述与环境搭建

## 1. CrewAI 是什么

CrewAI 是一个开源的 Python 多智能体编排框架，用于构建由多个 AI Agent 协作完成复杂任务的系统。它借鉴了现实世界中的团队协作模式——每个 Agent 拥有明确的角色（Role）、目标（Goal）和背景故事（Backstory），就像真实团队中的成员一样各司其职。

### 核心理念

- **角色驱动**：每个 Agent 都有清晰的职责定义，而非"万能型"助手
- **协作优先**：多个专业化 Agent 通过任务流转和委托机制协同工作
- **简洁直观**：相比 AutoGen、LangGraph 等框架，CrewAI 的 API 更加直观易用
- **生产就绪**：内置记忆系统、结构化输出、异步执行等生产级特性

### 典型应用场景

| 场景 | 说明 |
|------|------|
| 研究与分析 | 多 Agent 分工调研、交叉验证、生成报告 |
| 内容生产 | 研究员收集素材 → 编辑撰写 → 审稿员校对 |
| 代码开发 | 架构师设计 → 开发者实现 → 测试员验证 |
| 数据分析 | 数据收集 → 清洗处理 → 可视化 → 洞察总结 |
| 客户服务 | 意图识别 → 知识检索 → 回答生成 → 质量审核 |

### 与其他框架对比

| 特性 | CrewAI | LangChain/LangGraph | AutoGen |
|------|--------|---------------------|---------|
| 核心定位 | 角色化团队协作 | 链/图编排 | 多 Agent 对话 |
| 学习曲线 | 低 | 中-高 | 中 |
| 多 Agent 支持 | 原生 | 通过 LangGraph | 原生 |
| 社区规模 | 快速增长 | 最大 | 大 |
| 生产就绪 | 持续改进 | 成熟 | 成熟 |
| 最佳场景 | 团队协作式任务 | 复杂流水线 | 对话式推理 |

## 2. 架构概览

CrewAI 采用分层架构，核心由五大组件构成：

```
┌─────────────────────────────────────────────────┐
│                    Flows                         │
│       事件驱动的工作流编排（多 Crew 协作）          │
├─────────────────────────────────────────────────┤
│                    Crews                         │
│         Agent + Task 的执行引擎                   │
│     Sequential / Hierarchical 流程控制            │
├─────────────────────────────────────────────────┤
│              Agents & Tasks                      │
│    Agent: role / goal / backstory / tools        │
│    Task: description / expected_output / agent   │
├─────────────────────────────────────────────────┤
│                    Tools                         │
│       内置工具 | @tool 装饰器 | BaseTool          │
├─────────────────────────────────────────────────┤
│                   Memory                         │
│    短期记忆 (ChromaDB) | 长期记忆 (SQLite)        │
│              实体记忆 (RAG)                       │
├─────────────────────────────────────────────────┤
│               LiteLLM (内置)                     │
│          支持 100+ LLM 提供商                     │
└─────────────────────────────────────────────────┘
```

### 核心组件一览

| 组件 | 作用 | 关键属性 |
|------|------|----------|
| **Agent** | 自主执行单元 | `role`, `goal`, `backstory`, `tools`, `llm` |
| **Task** | 具体任务定义 | `description`, `expected_output`, `agent` |
| **Crew** | Agent + Task 的执行容器 | `agents`, `tasks`, `process`, `memory` |
| **Tool** | Agent 的外部能力 | 内置工具 / 自定义工具 |
| **Flow** | 多 Crew 工作流编排 | `@start`, `@listen`, `@router`, 状态管理 |

## 3. 环境搭建

### 3.1 安装 Python 环境

```bash
# 确认 Python 版本 (3.10 ~ 3.12)
python --version

# 创建虚拟环境
python -m venv crewai-env
source crewai-env/bin/activate  # Linux/macOS
# crewai-env\Scripts\activate   # Windows
```

### 3.2 安装 CrewAI

```bash
# 基础安装
pip install crewai

# 安装内置工具（推荐）
pip install 'crewai[tools]'
```

::: tip
CrewAI 内置了 LiteLLM，安装后即支持 100+ LLM 提供商，无需额外安装集成包。
:::

### 3.3 配置 API Key

```bash
# OpenAI（默认使用）
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxx"

# 或使用 .env 文件
pip install python-dotenv
```

```env
# .env 文件
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```

```python
from dotenv import load_dotenv
load_dotenv()
```

### 3.4 验证安装

```bash
crewai version
```

```python
import crewai
print(crewai.__version__)
```

## 4. 快速上手

### 4.1 第一个 CrewAI 程序

```python
from crewai import Agent, Task, Crew

# 1. 创建 Agent
researcher = Agent(
    role="AI 研究员",
    goal="深入调研最新的 AI 技术趋势",
    backstory="你是一位资深的 AI 研究员，擅长分析和总结前沿技术动态。",
    verbose=True
)

# 2. 定义 Task
research_task = Task(
    description="调研 2025 年最值得关注的 5 个 AI 技术趋势",
    expected_output="一份包含 5 个趋势的详细分析报告，每个趋势包含：名称、原理、应用场景、代表性项目",
    agent=researcher
)

# 3. 组建 Crew 并执行
crew = Crew(
    agents=[researcher],
    tasks=[research_task],
    verbose=True
)

result = crew.kickoff()
print(result)
```

### 4.2 多 Agent 协作

```python
from crewai import Agent, Task, Crew, Process

# 研究员：负责调研
researcher = Agent(
    role="资深研究员",
    goal="深入调研指定领域的最新进展",
    backstory="你是一位经验丰富的研究员，擅长从海量信息中提取关键洞察。",
    verbose=True
)

# 写手：负责撰写
writer = Agent(
    role="技术写手",
    goal="将研究成果转化为高质量的技术文章",
    backstory="你是一位技术写作专家，擅长将复杂概念用通俗易懂的语言表达。",
    verbose=True
)

# 任务 1：调研
research_task = Task(
    description="调研 CrewAI 框架的核心特性和竞争优势",
    expected_output="一份结构化的调研报告，涵盖核心功能、架构设计、竞品对比",
    agent=researcher
)

# 任务 2：撰写（依赖任务 1 的输出）
writing_task = Task(
    description="基于调研结果撰写一篇面向初学者的入门教程",
    expected_output="一篇 2000 字左右的中文技术博客，结构清晰、代码示例丰富",
    agent=writer,
    context=[research_task]  # 自动获取 research_task 的输出作为上下文
)

# 顺序执行
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
    verbose=True
)

result = crew.kickoff()
```

### 4.3 使用 CrewAI CLI 创建项目

```bash
# 脚手架创建项目
crewai create crew my_first_project

# 进入项目目录
cd my_first_project

# 安装依赖
crewai install

# 运行
crewai run
```

生成的项目结构：

```
my_first_project/
├── src/
│   └── my_first_project/
│       ├── main.py          # 入口文件
│       ├── crew.py          # Crew 定义
│       └── tools/           # 自定义工具
├── knowledge/               # 知识源
├── .env                     # 环境变量
└── pyproject.toml           # 项目配置
```

## 5. CLI 命令速查

| 命令 | 作用 |
|------|------|
| `crewai create crew <name>` | 创建新项目脚手架 |
| `crewai install` | 安装项目依赖 |
| `crewai run` | 运行 Crew |
| `crewai train` | 训练 Crew（优化 Agent 行为） |
| `crewai test` | 测试 Crew |
| `crewai replay` | 重放上次执行 |
| `crewai reset-memories` | 重置所有记忆 |
| `crewai version` | 查看版本 |

## 6. LLM 提供商配置

CrewAI 通过内置的 LiteLLM 支持 100+ LLM 提供商：

```python
from crewai import LLM

# OpenAI
llm = LLM(model="openai/gpt-4o", api_key="sk-...")

# Anthropic (Claude)
llm = LLM(model="anthropic/claude-sonnet-4-20250514", api_key="sk-ant-...")

# Azure OpenAI
llm = LLM(model="azure/gpt-4o", base_url="https://<resource>.openai.azure.com/")

# Google Gemini
llm = LLM(model="gemini/gemini-2.0-flash", api_key="...")

# Groq
llm = LLM(model="groq/llama3-70b-8192", api_key="...")

# Ollama（本地部署）
llm = LLM(model="ollama/llama3.1", base_url="http://localhost:11434")
```

在 Agent 中使用：

```python
agent = Agent(
    role="研究员",
    goal="调研技术趋势",
    backstory="资深研究员",
    llm=LLM(model="anthropic/claude-sonnet-4-20250514")
)
```

::: tip
不同 Agent 可以使用不同的 LLM。复杂推理任务用 GPT-4o/Claude，简单任务用轻量模型，兼顾效果与成本。
:::

## 总结

| 知识点 | 要点 |
|--------|------|
| CrewAI 定位 | 多智能体协作编排框架 |
| 核心组件 | Agent、Task、Crew、Tool、Flow |
| 安装 | `pip install crewai` 或 `pip install 'crewai[tools]'` |
| Python 版本 | 3.10 ~ 3.12 |
| LLM 支持 | 通过 LiteLLM 支持 100+ 提供商 |
| 项目脚手架 | `crewai create crew <name>` |
