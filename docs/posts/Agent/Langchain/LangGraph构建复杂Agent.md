---
title: LangGraph构建复杂Agent
date: 2025-06-22
tags: [Python, LangGraph, Agent, 状态机]
category: LangChain
order: 6
---

# LangGraph 构建复杂 Agent

## 1. LangGraph 简介

LangGraph 是 LangChain 团队开发的**有状态、可编排**的 Agent 框架。它将 Agent 的执行过程建模为一个**状态图（StateGraph）**，支持循环、分支、人工干预等复杂控制流。

### 为什么需要 LangGraph

| 需求 | 简单方案 | LangGraph |
|------|---------|-----------|
| 多步推理 | `create_react_agent` | ✅ 原生支持 |
| 循环执行 | 不支持 | ✅ 状态图天然支持 |
| 人工审批 | 不支持 | ✅ `interrupt_before` |
| 持久化状态 | 不支持 | ✅ `checkpointer` |
| 多 Agent 协作 | 复杂 | ✅ 子图嵌套 |
| 可视化流程 | 不支持 | ✅ 图结构可视化 |

### 核心概念

```
StateGraph（状态图）
├── State（状态）    —— 流转的数据
├── Node（节点）     —— 执行的函数
├── Edge（边）       —— 节点的连接
└── Conditional Edge —— 条件分支
```

## 2. 基础：第一个 StateGraph

### 2.1 最简单的图

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict

# 1. 定义状态
class State(TypedDict):
    input: str
    output: str

# 2. 定义节点函数
def process(state: State):
    return {"output": state["input"].upper()}

# 3. 构建图
graph = StateGraph(State)
graph.add_node("process", process)    # 添加节点
graph.add_edge(START, "process")      # 起始 → process
graph.add_edge("process", END)        # process → 结束

# 4. 编译并运行
app = graph.compile()
result = app.invoke({"input": "hello world", "output": ""})
print(result["output"])  # "HELLO WORLD"
```

### 2.2 多节点流水线

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict

class State(TypedDict):
    text: str
    cleaned: str
    result: str

def clean(state: State):
    """清洗文本"""
    cleaned = state["text"].strip().lower()
    return {"cleaned": cleaned}

def analyze(state: State):
    """分析文本"""
    word_count = len(state["cleaned"].split())
    return {"result": f"共 {word_count} 个单词：{state['cleaned']}"}

# 构建图：START → clean → analyze → END
graph = StateGraph(State)
graph.add_node("clean", clean)
graph.add_node("analyze", analyze)
graph.add_edge(START, "clean")
graph.add_edge("clean", "analyze")
graph.add_edge("analyze", END)

app = graph.compile()
result = app.invoke({"text": "  Hello World  ", "cleaned": "", "result": ""})
print(result["result"])  # "共 2 个单词：hello world"
```

## 3. 状态管理

### 3.1 TypedDict 状态

```python
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    # 普通字段：每次更新会覆盖
    query: str
    answer: str

    # 带 reducer 的字段：多个节点可以追加
    # Annotated[list, add] 表示列表追加操作
    steps: Annotated[list[str], add]
```

### 3.2 使用 Annotated 实现消息累积

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import AnyMessage
from operator import add

class AgentState(TypedDict):
    # 消息列表，多个节点可以追加消息
    messages: Annotated[list[AnyMessage], add]

def node1(state: AgentState):
    from langchain_core.messages import AIMessage
    return {"messages": [AIMessage(content="第一步完成")]}

def node2(state: AgentState):
    from langchain_core.messages import AIMessage
    return {"messages": [AIMessage(content="第二步完成")]}

graph = StateGraph(AgentState)
graph.add_node("node1", node1)
graph.add_node("node2", node2)
graph.add_edge(START, "node1")
graph.add_edge("node1", "node2")
graph.add_edge("node2", END)

app = graph.compile()
result = app.invoke({"messages": []})
for msg in result["messages"]:
    print(msg.content)
# "第一步完成"
# "第二步完成"
```

### 3.3 Pydantic 状态

```python
from pydantic import BaseModel, Field
from typing import Optional

class AgentState(BaseModel):
    query: str = ""
    context: list[str] = Field(default_factory=list)
    answer: Optional[str] = None
    confidence: float = 0.0
```

## 4. 条件分支

### 4.1 基本条件边

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Literal

class State(TypedDict):
    input: str
    category: str
    output: str

def classify(state: State):
    """分类节点"""
    text = state["input"].lower()
    if "天气" in text or "温度" in text:
        category = "weather"
    elif "计算" in text or "多少" in text:
        category = "math"
    else:
        category = "general"
    return {"category": category}

def handle_weather(state: State):
    return {"output": f"天气查询：{state['input']}"}

def handle_math(state: State):
    return {"output": f"数学计算：{state['input']}"}

def handle_general(state: State):
    return {"output": f"通用回答：{state['input']}"}

def route(state: State) -> Literal["weather", "math", "general"]:
    """条件路由"""
    return state["category"]

# 构建图
graph = StateGraph(State)
graph.add_node("classify", classify)
graph.add_node("weather", handle_weather)
graph.add_node("math", handle_math)
graph.add_node("general", handle_general)

graph.add_edge(START, "classify")

# 条件边：根据 classify 的输出选择下一个节点
graph.add_conditional_edges(
    "classify",         # 源节点
    route,              # 路由函数
    {                   # 路由映射
        "weather": "weather",
        "math": "math",
        "general": "general",
    }
)

graph.add_edge("weather", END)
graph.add_edge("math", END)
graph.add_edge("general", END)

app = graph.compile()

# 测试
print(app.invoke({"input": "今天天气怎么样", "category": "", "output": ""})["output"])
print(app.invoke({"input": "3加5等于多少", "category": "", "output": ""})["output"])
print(app.invoke({"input": "你好", "category": "", "output": ""})["output"])
```

### 4.2 LLM 驱动的路由

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(model="gpt-4o-mini")

def classify_with_llm(state: State):
    """用 LLM 进行意图分类"""
    response = llm.invoke([
        HumanMessage(content=f"""请将以下用户输入分类为：
- weather（天气相关）
- math（数学计算）
- general（其他）

只输出分类标签，不要其他内容。

用户输入：{state['input']}""")
    ])
    category = response.content.strip().lower()
    return {"category": category}
```

## 5. Agent 循环

### 5.1 经典 ReAct 循环

```python
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """搜索互联网信息"""
    return f"搜索结果：{query} 的相关信息..."

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    try:
        return str(eval(expression))
    except Exception as e:
        return f"错误：{e}"

tools = [search, calculate]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

def agent(state: MessagesState):
    """Agent 节点：调用 LLM"""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: MessagesState):
    """判断是否继续"""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END

# 构建 ReAct 循环
graph = StateGraph(MessagesState)
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")  # 工具执行完回到 agent

app = graph.compile()

# 运行
result = app.invoke({"messages": [("user", "搜索一下Python最新版本，然后计算 2 的 10 次方")]})
for msg in result["messages"]:
    if msg.content:
        print(f"[{msg.type}] {msg.content}")
```

### 5.2 带最大轮次限制

```python
# 方法一：编译时限制递归深度
app = graph.compile()
result = app.invoke(
    {"messages": [("user", "...")]},
    {"recursion_limit": 10},  # 最多 10 步
)

# 方法二：在状态中计数
from typing import Annotated
from operator import add

class StateWithCount(MessagesState):
    step_count: int = 0

def agent_with_count(state: StateWithCount):
    if state["step_count"] >= 5:
        from langchain_core.messages import AIMessage
        return {"messages": [AIMessage(content="达到最大步骤限制，请提供更多信息。")]}
    response = llm.invoke(state["messages"])
    return {"messages": [response], "step_count": state["step_count"] + 1}
```

## 6. 人工干预（Human-in-the-Loop）

### 6.1 interrupt_before：执行前暂停

```python
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode, create_react_agent
from langgraph.checkpoint.memory import MemorySaver

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """发送邮件。在执行前需要人工确认。

    Args:
        to: 收件人邮箱
        subject: 邮件主题
        body: 邮件正文
    """
    return f"邮件已发送至 {to}，主题：{subject}"

llm = ChatOpenAI(model="gpt-4o-mini")
tools = [send_email]

# 创建带人工干预的 Agent
# interrupt_before=["tools"] 表示在执行工具前暂停
agent = create_react_agent(
    llm,
    tools,
    checkpointer=MemorySaver(),  # 需要 checkpointer 来保存状态
)

# 编译时设置中断点
app = agent.compile(
    interrupt_before=["tools"],  # 在调用工具前暂停
)

# 第一次运行：会在工具调用前暂停
config = {"configurable": {"thread_id": "email-1"}}
result = app.invoke(
    {"messages": [("user", "给 test@example.com 发一封主题为'会议通知'的邮件")]},
    config,
)

# 查看当前状态（已暂停，等待人工确认）
print("暂停中，等待确认...")

# 查看即将执行的工具调用
last_message = result["messages"][-1]
if hasattr(last_message, "tool_calls"):
    print(f"即将执行：{last_message.tool_calls}")

# 人工确认后继续执行
result = app.invoke(None, config)  # None 表示继续
print(result["messages"][-1].content)
```

### 6.2 interrupt_after：执行后暂停

```python
# 在工具执行后暂停，让用户审核结果
app = agent.compile(
    interrupt_after=["tools"],  # 工具执行后暂停
)
```

### 6.3 动态中断

```python
from langgraph.types import interrupt

@tool
def dangerous_operation(action: str) -> str:
    """执行危险操作"""
    # 动态中断：运行时暂停并请求人工确认
    human_feedback = interrupt(
        f"即将执行危险操作：{action}。请确认 (yes/no)："
    )
    if human_feedback == "yes":
        return f"已执行：{action}"
    else:
        return "操作已取消"
```

## 7. 持久化（Checkpointer）

### 7.1 MemorySaver（内存）

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

app = graph.compile(checkpointer=checkpointer)

# 使用 thread_id 标识对话
config = {"configurable": {"thread_id": "conversation-1"}}

# 第一轮对话
result = app.invoke({"messages": [("user", "我叫张三")]}, config)

# 第二轮对话（状态自动保持）
result = app.invoke({"messages": [("user", "我叫什么名字？")]}, config)
# Agent 能记住"张三"
```

### 7.2 SQLite 持久化

```python
from langgraph.checkpoint.sqlite import SqliteSaver

# 使用 SQLite 持久化（重启后不丢失）
checkpointer = SqliteSaver.from_conn_string(":memory:")
# 或持久化到文件：
# checkpointer = SqliteSaver.from_conn_string("checkpoints.db")

app = graph.compile(checkpointer=checkpointer)
```

```bash
pip install langgraph-checkpoint-sqlite
```

### 7.3 查看历史状态

```python
config = {"configurable": {"thread_id": "conversation-1"}}

# 获取状态历史
history = list(app.get_state_history(config))
for state in history:
    print(f"Step {state.metadata['step']}: {state.values}")
```

## 8. 多 Agent 协作

### 8.1 子图嵌套

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict

# Research Agent 的状态和图
class ResearchState(TypedDict):
    query: str
    findings: str

def research_node(state: ResearchState):
    return {"findings": f"研究结果：{state['query']} 的相关发现..."}

research_graph = StateGraph(ResearchState)
research_graph.add_node("research", research_node)
research_graph.add_edge(START, "research")
research_graph.add_edge("research", END)
research_app = research_graph.compile()

# Writer Agent 的状态和图
class WriterState(TypedDict):
    findings: str
    article: str

def write_node(state: WriterState):
    return {"article": f"基于研究撰写文章：{state['findings'][:50]}..."}

writer_graph = StateGraph(WriterState)
writer_graph.add_node("write", write_node)
writer_graph.add_edge(START, "write")
writer_graph.add_edge("write", END)
writer_app = writer_graph.compile()

# 主 Agent：协调两个子 Agent
class MainState(TypedDict):
    query: str
    findings: str
    article: str

def research_step(state: MainState):
    result = research_app.invoke({"query": state["query"], "findings": ""})
    return {"findings": result["findings"]}

def write_step(state: MainState):
    result = writer_app.invoke({"findings": state["findings"], "article": ""})
    return {"article": result["article"]}

main_graph = StateGraph(MainState)
main_graph.add_node("research", research_step)
main_graph.add_node("write", write_step)
main_graph.add_edge(START, "research")
main_graph.add_edge("research", "write")
main_graph.add_edge("write", END)

main_app = main_graph.compile()
result = main_app.invoke({"query": "LangChain最新进展", "findings": "", "article": ""})
print(result["article"])
```

### 8.2 Supervisor 模式

```python
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(model="gpt-4o-mini")

def supervisor(state: MessagesState):
    """Supervisor：决定由哪个 Agent 处理"""
    response = llm.invoke([
        HumanMessage(content=f"""根据对话内容，决定下一步应该由谁处理：
- "researcher" - 需要搜索信息
- "coder" - 需要写代码
- "FINISH" - 任务完成

对话历史：
{[m.content for m in state['messages'] if m.content]}

只输出一个标签。""")
    ])
    return {"next": response.content.strip()}

def researcher(state: MessagesState):
    """研究员 Agent"""
    from langchain_core.messages import AIMessage
    return {"messages": [AIMessage(content="[研究员] 搜索并整理了相关信息...")]}

def coder(state: MessagesState):
    """程序员 Agent"""
    from langchain_core.messages import AIMessage
    return {"messages": [AIMessage(content="[程序员] 编写了相关代码...")]}

def route_supervisor(state: MessagesState):
    return state.get("next", "FINISH")

# 构建 Supervisor 图
graph = StateGraph(MessagesState)
graph.add_node("supervisor", supervisor)
graph.add_node("researcher", researcher)
graph.add_node("coder", coder)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_supervisor, {
    "researcher": "researcher",
    "coder": "coder",
    "FINISH": END,
})
graph.add_edge("researcher", "supervisor")
graph.add_edge("coder", "supervisor")

app = graph.compile()
result = app.invoke({"messages": [("user", "帮我写一个快速排序算法")]})
for msg in result["messages"]:
    if msg.content:
        print(msg.content)
```

## 9. 可视化

```python
# 生成 Mermaid 图（可在 Markdown 中渲染）
print(app.get_graph().draw_mermaid())

# 生成 PNG 图片（需要安装依赖）
# pip install pygraphviz
# app.get_graph().draw_png("graph.png")
```

## 10. 完整示例：带审批的研究助手

```python
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, AIMessage

# 工具定义
@tool
def search(query: str) -> str:
    """搜索互联网"""
    return f"搜索结果：{query}"

@tool
def write_report(title: str, content: str) -> str:
    """撰写报告"""
    return f"报告已生成：{title}\n{content[:100]}..."

@tool
def send_report(recipient: str, report: str) -> str:
    """发送报告给指定人员"""
    return f"报告已发送至 {recipient}"

tools = [search, write_report, send_report]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

# Agent 节点
def agent(state: MessagesState):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

# 路由逻辑
def should_continue(state: MessagesState):
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END

# 构建图
graph = StateGraph(MessagesState)
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")

# 编译：在发送报告前需要人工确认
checkpointer = MemorySaver()
app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["tools"],  # 所有工具调用前暂停
)

# 使用
config = {"configurable": {"thread_id": "research-1"}}

# 1. 开始任务
result = app.invoke(
    {"messages": [("user", "搜索 LangChain 的最新进展，写一份报告，发送给 boss@company.com")]},
    config,
)

# 2. 暂停中，检查即将执行的操作
state = app.get_state(config)
last_msg = state.values["messages"][-1]
if hasattr(last_msg, "tool_calls"):
    print(f"即将执行：{last_msg.tool_calls[0]['name']}")

# 3. 人工确认后继续
result = app.invoke(None, config)
```

## 总结

| 概念 | 说明 |
|------|------|
| `StateGraph` | 状态图，LangGraph 的核心 |
| `State` | 图中流转的数据结构 |
| `Node` | 执行操作的函数 |
| `Edge` | 节点之间的连接 |
| `add_conditional_edges` | 条件分支 |
| `START` / `END` | 起始和终止标记 |
| `interrupt_before/after` | 人工干预点 |
| `MemorySaver` | 状态持久化（内存） |
| `create_react_agent` | 快速创建 ReAct Agent |
| `ToolNode` | 执行工具调用的预构建节点 |
