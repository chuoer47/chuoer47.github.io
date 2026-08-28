---
title: LangGraph概述与核心概念
date: 2025-06-22
tags: [Python, LangGraph, Agent]
category: LangGraph
order: 1
---

# LangGraph 概述与核心概念

## 什么是 LangGraph

LangGraph 是 LangChain 团队于 2024 年推出的**有状态编排框架**，专门用于构建基于图（Graph）结构的 AI Agent 应用。与传统的线性 Chain 不同，LangGraph 使用**有向图**来表达复杂的控制流——包括循环、分支、并行和人机交互——使得构建多步骤推理 Agent 变得直观且可维护。

核心定位：**LangChain 解决的是"如何调用 LLM"，LangGraph 解决的是"如何编排多个 LLM 调用和工具调用的流程"。**

## 为什么需要 LangGraph

在 LangGraph 出现之前，LangChain 使用 `AgentExecutor` 来运行 Agent。但 `AgentExecutor` 本质上是一个简单的 `while` 循环，面对复杂场景时力不从心：

| 能力 | AgentExecutor | LangGraph |
|------|:---:|:---:|
| 多步骤推理 | ✅ 基础 | ✅ 强大 |
| 循环控制流 | ❌ 仅 while 循环 | ✅ 任意循环 |
| 条件分支 | ❌ 有限 | ✅ 灵活路由 |
| 人工审批/中断 | ❌ 不支持 | ✅ 原生支持 |
| 持久化状态 | ❌ 无 | ✅ Checkpointer |
| 多 Agent 协作 | ❌ 困难 | ✅ 子图/Swarm |
| 流式输出 | ❌ 粒度粗 | ✅ 节点级流式 |
| 可视化调试 | ❌ 无 | ✅ Mermaid 图 |
| 生产部署 | ❌ 不适合 | ✅ LangGraph Platform |

简单来说，**只要你需要循环（比如 ReAct 模式的"思考→行动→观察"循环）、条件分支、人工介入、或者多 Agent 协作，LangGraph 就是更好的选择。**

## 核心抽象

LangGraph 的设计围绕 5 个核心抽象：

```
┌─────────────────────────────────────────┐
│              StateGraph                  │
│  ┌─────┐   ┌─────┐   ┌─────┐          │
│  │Node │──→│Node │──→│Node │          │
│  │  A  │   │  B  │   │  C  │          │
│  └─────┘   └──┬──┘   └─────┘          │
│               │                         │
│          [条件边]                        │
│          ╱      ╲                       │
│    ┌─────┐    ┌─────┐                  │
│    │Node │    │Node │                  │
│    │  D  │    │  E  │                  │
│    └─────┘    └─────┘                  │
│                                         │
│  State: 所有节点共享的状态               │
│  Checkpointer: 持久化/恢复状态          │
└─────────────────────────────────────────┘
```

### 1. StateGraph（状态图）

`StateGraph` 是 LangGraph 的核心类，用于定义整个图的结构。它以**状态（State）** 为中心——所有节点共享同一个状态对象，节点通过读取和更新状态来通信。

```python
from langgraph.graph import StateGraph

# 定义状态结构
class MyState(TypedDict):
    messages: list
    current_step: str

# 创建状态图
graph = StateGraph(MyState)
```

### 2. Node（节点）

节点是图中的**计算单元**，本质上是一个 Python 函数。它接收当前状态作为输入，返回一个字典来更新状态。

```python
def my_node(state: MyState) -> dict:
    # 读取状态，执行逻辑，返回更新
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

graph.add_node("my_node", my_node)
```

### 3. Edge（边）

边连接节点，定义执行顺序。LangGraph 支持三种边：

- **普通边**：无条件连接 `A → B`
- **条件边**：根据状态动态路由 `A → B 或 C`
- **起始/终止边**：连接到 `START` 或 `END`

```python
from langgraph.graph import START, END

# 普通边
graph.add_edge("node_a", "node_b")

# 条件边
graph.add_conditional_edges("router", route_function, {
    "path_a": "node_a",
    "path_b": "node_b",
})

# 起始边和终止边
graph.add_edge(START, "first_node")
graph.add_edge("last_node", END)
```

### 4. State（状态）

状态是所有节点共享的**数据结构**，通常用 `TypedDict` 或 Pydantic `BaseModel` 定义。它是整个图的"全局变量"。

```python
from typing import Annotated
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # 消息自动追加
    next_action: str
```

### 5. Checkpointer（检查点）

检查点用于**持久化图的状态**，支持暂停/恢复、时间旅行调试和人机交互。

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
compiled = graph.compile(checkpointer=checkpointer)
```

## 最简示例：Hello World

下面是一个最简单的 LangGraph 示例，展示基本的图构建流程：

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

# 1. 定义状态
class State(TypedDict):
    input: str
    output: str

# 2. 定义节点
def greet(state: State) -> dict:
    return {"output": f"Hello, {state['input']}!"}

# 3. 构建图
graph = StateGraph(State)
graph.add_node("greeter", greet)
graph.add_edge(START, "greeter")
graph.add_edge("greeter", END)

# 4. 编译并运行
app = graph.compile()
result = app.invoke({"input": "LangGraph"})
print(result["output"])  # Hello, LangGraph!
```

## 与 LangChain 的关系

LangGraph **不是** LangChain 的替代品，而是**补充**：

- **LangChain Core**：提供 `BaseChatModel`、`BaseTool`、消息类型等基础接口
- **LangChain**：提供 Chains、Prompts、Retrievers 等组件
- **LangGraph**：提供图编排能力，使用 LangChain 的组件作为节点

```
LangGraph (编排层)
  ├── 使用 LangChain 的 Chat Model 作为节点
  ├── 使用 LangChain 的 Tool 作为工具节点
  ├── 使用 LangChain 的 Retriever 进行检索
  └── 提供状态管理、持久化、多 Agent 等编排能力
```

## 安装与环境配置

```bash
# 基础安装
pip install langgraph

# 完整安装（包含 LangChain 集成）
pip install langgraph langchain langchain-openai

# 可选：LangSmith 追踪
pip install langsmith
export LANGSMITH_API_KEY="your-key"
export LANGSMITH_TRACING=true
```

## 图的生命周期

一个 LangGraph 应用的完整生命周期：

```
1. 定义状态结构（TypedDict / Pydantic）
       ↓
2. 创建 StateGraph（state_schema=State）
       ↓
3. 添加节点（add_node）
       ↓
4. 添加边（add_edge / add_conditional_edges）
       ↓
5. 设置入口和出口（add_edge(START, ...) / add_edge(..., END)）
       ↓
6. 编译图（compile()）
       ↓
7. 运行图（invoke / stream / batch）
```

## 小结

| 概念 | 说明 |
|------|------|
| **StateGraph** | 图的容器，以状态为中心 |
| **Node** | 计算单元，Python 函数 |
| **Edge** | 连接节点的有向边 |
| **State** | 所有节点共享的数据结构 |
| **Checkpointer** | 持久化/恢复状态的机制 |
| **START / END** | 特殊的起始/终止标记 |
| **compile()** | 编译图使其可执行 |
| **invoke() / stream()** | 执行图的入口 |

## 下一篇

→ [状态管理与类型系统](./02-状态管理与类型系统)：深入了解 TypedDict、Pydantic 状态定义、Annotated Reducer 和消息管理机制。
