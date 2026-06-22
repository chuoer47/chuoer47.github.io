---
title: 多Agent协作
date: 2025-06-22
tags: [Python, LangGraph, 多Agent, Supervisor, Swarm]
category: LangGraph
order: 7
---

# 多 Agent 协作

当任务足够复杂时，单个 Agent 往往力不从心。多 Agent 协作让多个专精不同领域的 Agent 分工合作，共同完成复杂任务。LangGraph 提供了多种多 Agent 架构模式。

## 多 Agent 架构模式

```
┌─────────────────────────────────────────────────────┐
│                 多 Agent 架构                        │
├──────────────┬──────────────┬───────────────────────┤
│  Supervisor  │    Swarm     │   Hierarchical        │
│  监督者模式   │   群体模式    │   层级模式             │
├──────────────┼──────────────┼───────────────────────┤
│ 中央调度器    │ Agent 间     │ 多层 Supervisor       │
│ 决定谁来执行  │ 自主交接     │ 逐级分发               │
│              │              │                       │
│   ┌─────┐   │  A ←→ B     │    Top-Supervisor      │
│   │Super│   │  ↕     ↕     │    ╱          ╲        │
│   └──┬──┘   │  C ←→ D     │  Mid-Sup   Mid-Sup     │
│   ╱  │  ╲   │              │  ╱  ╲       ╱  ╲       │
│  A   B   C  │              │ A   B      C   D       │
└──────────────┴──────────────┴───────────────────────┘
```

## 模式一：Supervisor（监督者模式）

最常用的多 Agent 模式。一个 Supervisor Agent 负责分析任务并路由给合适的 Worker Agent。

### 基本架构

```python
from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# 状态
class SupervisorState(TypedDict):
    messages: Annotated[list, add_messages]
    next_agent: str

# Supervisor 节点（路由决策）
def supervisor_node(state: SupervisorState) -> dict:
    llm = ChatOpenAI(model="gpt-4o")
    response = llm.invoke([
        SystemMessage(content="""你是一个任务调度器。根据用户的需求，决定由哪个 Agent 来处理：
- researcher: 负责信息搜索和研究
- coder: 负责编写和执行代码
- writer: 负责撰写文档和报告
- FINISH: 任务完成，不需要更多处理

请只回复 Agent 名称，不要回复其他内容。"""),
        *state["messages"],
    ])

    agent_name = response.content.strip().lower()
    return {"next_agent": agent_name}

# Researcher Agent
def researcher_node(state: SupervisorState) -> dict:
    llm = ChatOpenAI(model="gpt-4o").bind_tools([search_tool])
    response = llm.invoke([
        SystemMessage(content="你是一个研究员，善于搜索和整理信息。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Coder Agent
def coder_node(state: SupervisorState) -> dict:
    llm = ChatOpenAI(model="gpt-4o").bind_tools([python_repl])
    response = llm.invoke([
        SystemMessage(content="你是一个程序员，善于编写和执行代码。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Writer Agent
def writer_node(state: SupervisorState) -> dict:
    llm = ChatOpenAI(model="gpt-4o")
    response = llm.invoke([
        SystemMessage(content="你是一个写作专家，善于撰写清晰的文档。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# 路由函数
def route_to_agent(state: SupervisorState) -> str:
    agent = state.get("next_agent", "FINISH")
    if agent == "finish" or agent not in ["researcher", "coder", "writer"]:
        return END
    return agent

# 构建图
graph = StateGraph(SupervisorState)
graph.add_node("supervisor", supervisor_node)
graph.add_node("researcher", researcher_node)
graph.add_node("coder", coder_node)
graph.add_node("writer", writer_node)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_to_agent, {
    "researcher": "researcher",
    "coder": "coder",
    "writer": "writer",
    END: END,
})

# Worker 执行后回到 Supervisor
graph.add_edge("researcher", "supervisor")
graph.add_edge("coder", "supervisor")
graph.add_edge("writer", "supervisor")

app = graph.compile()
```

### 执行流程

```
用户: "帮我调研 LangGraph 的多 Agent 架构，写一个示例代码，然后写一份报告"

1. Supervisor → 分析任务 → 选择 researcher
2. Researcher → 搜索 LangGraph 多 Agent 相关资料 → 返回 Supervisor
3. Supervisor → 选择 coder
4. Coder → 编写示例代码 → 返回 Supervisor
5. Supervisor → 选择 writer
6. Writer → 撰写报告 → 返回 Supervisor
7. Supervisor → 判断任务完成 → END
```

## 模式二：使用 langgraph-supervisor

LangGraph 提供了官方的 Supervisor 库，简化实现：

```bash
pip install langgraph-supervisor
```

```python
from langgraph_supervisor import create_supervisor
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")

# 创建各个 Agent
research_agent = create_react_agent(
    model=llm,
    tools=[search_tool],
    name="researcher",
    prompt="你是一个研究员，善于搜索和整理信息。",
)

code_agent = create_react_agent(
    model=llm,
    tools=[python_repl],
    name="coder",
    prompt="你是一个程序员，善于编写和执行代码。",
)

# 创建 Supervisor
supervisor = create_supervisor(
    agents=[research_agent, code_agent],
    model=llm,
    prompt="你是一个任务调度器，根据用户需求分配任务给合适的 Agent。",
)

app = supervisor.compile()
result = app.invoke({"messages": [("user", "帮我调研并写代码")]})
```

## 模式三：Swarm（群体模式）

Swarm 模式中，Agent 之间可以直接**交接（handoff）**，不需要中央调度器。每个 Agent 自己决定是否需要将控制权交给另一个 Agent。

### 基本概念

```python
from langgraph_swarm import create_swarm, SwarmState
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

llm = ChatOpenAI(model="gpt-4o")

# 定义交接工具
@tool
def transfer_to_coder() -> str:
    """将任务转交给编程专家"""
    return "已转交给编程专家"

@tool
def transfer_to_researcher() -> str:
    """将任务转交给研究员"""
    return "已转交给研究员"

# 创建 Agent（带上交接工具）
research_agent = create_react_agent(
    model=llm,
    tools=[search_tool, transfer_to_coder],
    name="researcher",
    prompt="你是研究员。如果需要写代码，请转交给 coder。",
)

code_agent = create_react_agent(
    model=llm,
    tools=[python_repl, transfer_to_researcher],
    name="coder",
    prompt="你是程序员。如果需要调研，请转交给 researcher。",
)

# 创建 Swarm
swarm = create_swarm(
    agents=[research_agent, code_agent],
    default_active_agent="researcher",
)

app = swarm.compile()
result = app.invoke({"messages": [("user", "帮我调研并实现一个排序算法")]})
```

### Swarm 的工作方式

```
用户 → researcher（默认活跃 Agent）
         │
         │ 发现需要写代码
         ↓
       transfer_to_coder()
         │
         ↓
       coder（接管）
         │
         │ 写完代码，需要验证
         ↓
       transfer_to_researcher()
         │
         ↓
       researcher（接管，验证结果）
```

## 模式四：子图嵌套

使用子图实现更灵活的多 Agent 组合：

```python
from langgraph.graph import StateGraph, START, END

# 创建 Research 子图
def create_research_graph():
    sg = StateGraph(ResearchState)
    sg.add_node("search", search_node)
    sg.add_node("analyze", analyze_node)
    sg.add_edge(START, "search")
    sg.add_edge("search", "analyze")
    sg.add_edge("analyze", END)
    return sg.compile()

# 创建 Code 子图
def create_code_graph():
    sg = StateGraph(CodeState)
    sg.add_node("plan", plan_node)
    sg.add_node("implement", implement_node)
    sg.add_node("test", test_node)
    sg.add_edge(START, "plan")
    sg.add_edge("plan", "implement")
    sg.add_edge("implement", "test")
    sg.add_edge("test", END)
    return sg.compile()

# 主图：组合子图
research_graph = create_research_graph()
code_graph = create_code_graph()

main_graph = StateGraph(MainState)
main_graph.add_node("supervisor", supervisor_node)
main_graph.add_node("research", research_graph)  # 子图作为节点
main_graph.add_node("code", code_graph)          # 子图作为节点

main_graph.add_edge(START, "supervisor")
main_graph.add_conditional_edges("supervisor", route_fn, {
    "research": "research",
    "code": "code",
    END: END,
})
main_graph.add_edge("research", "supervisor")
main_graph.add_edge("code", "supervisor")

app = main_graph.compile()
```

## Agent 间通信

多 Agent 系统中，Agent 之间需要共享信息。LangGraph 通过**共享状态**实现这一点：

### 共享状态模式

```python
class MultiAgentState(TypedDict):
    # 所有 Agent 共享的消息列表
    messages: Annotated[list, add_messages]

    # Research Agent 的输出
    research_results: Annotated[list, lambda a, b: a + b]

    # Code Agent 的输出
    code_output: str

    # 当前活跃的 Agent
    current_agent: str

    # 全局上下文
    context: dict
```

### 通过消息传递

最简单的通信方式——所有 Agent 往同一个消息列表中追加消息：

```python
def research_agent(state: MultiAgentState) -> dict:
    # 读取所有消息（包括其他 Agent 的输出）
    context = state["messages"]

    # 执行研究
    result = do_research(context)

    # 通过消息列表共享结果
    return {"messages": [("assistant", f"研究结果：{result}")]}

def code_agent(state: MultiAgentState) -> dict:
    # 可以看到 research_agent 的输出
    research = [m for m in state["messages"] if "研究结果" in m.content]

    # 基于研究结果写代码
    code = write_code(research)
    return {"messages": [("assistant", f"代码：{code}")]}
```

## 实战：研究助手

一个完整的研究助手，包含 Supervisor、Researcher、Coder 和 Reviewer：

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import create_react_agent, ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool

# 工具
@tool
def web_search(query: str) -> str:
    """搜索互联网"""
    return f"搜索结果：{query}"

@tool
def python_execute(code: str) -> str:
    """执行 Python 代码"""
    return str(eval(code))

# 状态
class ResearchState(TypedDict):
    messages: Annotated[list, add_messages]
    research_topic: str
    research_results: list
    code_output: str
    review_feedback: str
    current_phase: str

# LLM
llm = ChatOpenAI(model="gpt-4o")

# Supervisor
def supervisor(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="""你是研究项目主管。当前阶段：
- research: 调研阶段
- code: 编码阶段
- review: 审查阶段
- FINISH: 完成

请根据当前进度决定下一步。只回复阶段名称。"""),
        *state["messages"],
    ])
    phase = response.content.strip().lower()
    return {"current_phase": phase}

# Researcher
def researcher(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="你是研究员，负责搜索和整理信息。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Coder
def coder(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="你是程序员，根据研究结果编写代码。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Reviewer
def reviewer(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="你是审查员，审查研究成果和代码质量，提出改进建议。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# 路由
def route_phase(state: ResearchState) -> str:
    phase = state.get("current_phase", "FINISH")
    if phase in ["research", "code", "review"]:
        return phase
    return END

# 构建图
graph = StateGraph(ResearchState)
graph.add_node("supervisor", supervisor)
graph.add_node("research", researcher)
graph.add_node("code", coder)
graph.add_node("review", reviewer)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_phase, {
    "research": "research",
    "code": "code",
    "review": "review",
    END: END,
})
graph.add_edge("research", "supervisor")
graph.add_edge("code", "supervisor")
graph.add_edge("review", "supervisor")

app = graph.compile(checkpointer=MemorySaver())
```

## 最佳实践

1. **明确职责**：每个 Agent 只负责一个领域，避免职责重叠
2. **清晰的通信协议**：Agent 之间共享的状态结构要明确
3. **避免死循环**：设置最大循环次数，防止 Agent 互相转来转去
4. **错误处理**：某个 Agent 失败时要有降级策略
5. **人机交互**：关键决策点加入人工审批

```python
# ✅ 好的设计
class State(TypedDict):
    messages: Annotated[list, add_messages]
    research: str      # research agent 的输出
    code: str          # code agent 的输出
    decision: str      # supervisor 的决策
    max_rounds: int    # 最大轮次
    current_round: int # 当前轮次

# ❌ 不好的设计
class State(TypedDict):
    everything: dict  # 一个巨大的字典，职责不清
```

## 小结

| 模式 | 特点 | 适用场景 |
|------|------|---------|
| **Supervisor** | 中央调度，明确分工 | 大多数多 Agent 场景 |
| **Swarm** | 去中心化，自主交接 | Agent 间紧密协作 |
| **子图嵌套** | 模块化，可复用 | 复杂的层级工作流 |
| **langgraph-supervisor** | 官方库，开箱即用 | 快速原型 |

## 下一篇

→ [LangGraph Platform 与部署](./08-LangGraph%20Platform与部署)：部署架构、API 服务、LangSmith 集成、生产最佳实践。
