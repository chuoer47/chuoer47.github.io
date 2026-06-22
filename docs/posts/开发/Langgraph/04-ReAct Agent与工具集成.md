---
title: ReAct Agent与工具集成
date: 2025-06-22
tags: [Python, LangGraph, Agent, ReAct, Tool]
category: LangGraph
order: 4
---

# ReAct Agent 与工具集成

ReAct（Reasoning + Acting）是当前最主流的 Agent 模式：LLM 先**推理**（思考下一步该做什么），再**行动**（调用工具），然后**观察**（获取工具返回结果），如此循环直到任务完成。LangGraph 是实现 ReAct 模式的最佳框架。

## ReAct 循环原理

```
用户输入
   ↓
┌──→ LLM 推理（Thought）
│       ↓
│   是否需要工具？
│    ╱        ╲
│  是           否
│   ↓            ↓
│ 调用工具     返回最终答案 → END
│  (Action)
│   ↓
│ 获取结果
│ (Observation)
│   ↓
└───┘
```

传统 `AgentExecutor` 用一个 `while` 循环实现了这个模式，但缺乏灵活性。LangGraph 用**图结构**来表达，更清晰也更可定制。

## 方式一：create_react_agent（快速开始）

LangGraph 提供了 `create_react_agent` 快捷函数，一行代码创建 ReAct Agent：

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

# 定义工具
@tool
def search(query: str) -> str:
    """搜索互联网获取最新信息"""
    return f"搜索结果：{query} 相关内容..."

@tool
def calculator(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))

# 创建 Agent
llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(
    model=llm,
    tools=[search, calculator],
)

# 运行
result = agent.invoke({
    "messages": [("user", "帮我查一下北京今天的天气，然后计算华氏温度")]
})
```

### create_react_agent 的参数

```python
agent = create_react_agent(
    model=llm,                    # LLM 模型
    tools=[search, calculator],   # 工具列表
    prompt="你是一个助手",         # 系统提示（可选）
    state_schema=CustomState,     # 自定义状态（可选）
    checkpointer=MemorySaver(),   # 检查点（可选）
)
```

### 自定义系统提示

```python
from langchain_core.messages import SystemMessage

# 方式 1：字符串
agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt="你是一个专业的数据分析师，善于使用工具解决问题。",
)

# 方式 2：消息列表
agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt=[SystemMessage(content="你是一个数据分析师")],
)

# 方式 3：函数（动态生成）
def get_prompt(state):
    user_name = state.get("user_name", "用户")
    return [SystemMessage(content=f"你好 {user_name}，我是你的助手。")]

agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt=get_prompt,
)
```

## 方式二：手动构建 ReAct Agent（完全控制）

当需要更多控制时，用 StateGraph 手动构建：

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# 1. 定义状态
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]

# 2. 定义工具
tools = [search, calculator]
llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

# 3. 定义节点
def agent_node(state: AgentState) -> dict:
    """LLM 推理节点"""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

tool_node = ToolNode(tools)  # 内置的工具执行节点

# 4. 定义路由
def should_continue(state: AgentState) -> str:
    """判断是否需要继续调用工具"""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"   # 有工具调用 → 执行工具
    return END           # 无工具调用 → 结束

# 5. 构建图
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
graph.add_node("tools", tool_node)

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    END: END,
})
graph.add_edge("tools", "agent")  # 工具执行后回到 agent

# 6. 编译
app = graph.compile()
```

这个图的执行流程：

```
START → agent → [有工具调用?]
                    │
              ┌─ 是 ─┼─ 否 ─┐
              ↓       │      ↓
           tools      │     END
              │       │
              └─→ agent ←┘
```

## ToolNode 详解

`ToolNode` 是 LangGraph 内置的工具执行节点，自动处理 `tool_calls`：

```python
from langgraph.prebuilt import ToolNode

# 基本用法
tool_node = ToolNode([search, calculator])

# 带错误处理
tool_node = ToolNode(
    [search, calculator],
    handle_tool_errors=True,  # 工具出错时返回错误信息而不是抛异常
)
```

### ToolNode 的工作原理

ToolNode 从最后一条 AI 消息中提取 `tool_calls`，逐个执行，返回 `ToolMessage`：

```python
# AI 消息中的 tool_calls
AIMessage(
    content="",
    tool_calls=[
        {"name": "search", "args": {"query": "天气"}, "id": "call_1"},
        {"name": "calculator", "args": {"expression": "25*9/5+32"}, "id": "call_2"},
    ]
)

# ToolNode 会并行执行两个工具，返回：
[
    ToolMessage(content="搜索结果...", tool_call_id="call_1"),
    ToolMessage(content="77.0", tool_call_id="call_2"),
]
```

### 自定义 ToolNode

如果需要更复杂的工具执行逻辑，可以自己实现：

```python
def custom_tool_node(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    results = []

    for tool_call in last_message.tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]

        try:
            # 查找并执行工具
            tool = next(t for t in tools if t.name == tool_name)
            result = tool.invoke(tool_args)
            results.append(ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"],
            ))
        except Exception as e:
            # 错误处理
            results.append(ToolMessage(
                content=f"工具执行出错：{e}",
                tool_call_id=tool_call["id"],
            ))

    return {"messages": results}
```

## 工具定义方式

### 方式一：@tool 装饰器（推荐）

```python
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """搜索互联网获取最新信息。

    Args:
        query: 搜索关键词
    """
    return do_search(query)
```

### 方式二：StructuredTool（复杂参数）

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class SearchInput(BaseModel):
    query: str = Field(description="搜索关键词")
    max_results: int = Field(default=5, description="最大结果数")
    language: str = Field(default="zh", description="搜索语言")

search_tool = StructuredTool.from_function(
    func=do_search,
    name="search",
    description="搜索互联网",
    args_schema=SearchInput,
)
```

### 方式三：BaseTool（完全控制）

```python
from langchain_core.tools import BaseTool
from typing import Optional

class SearchTool(BaseTool):
    name: str = "search"
    description: str = "搜索互联网获取最新信息"

    def _run(self, query: str) -> str:
        return do_search(query)

    async def _arun(self, query: str) -> str:
        return await async_do_search(query)
```

## 实战：带工具的完整 Agent

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode, create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

# 工具定义
@tool
def web_search(query: str) -> str:
    """搜索互联网"""
    # 实际项目中接入搜索 API
    return f"关于 '{query}' 的搜索结果..."

@tool
def python_repl(code: str) -> str:
    """执行 Python 代码并返回结果"""
    try:
        result = {}
        exec(code, {"__builtins__": {}}, result)
        return str(result)
    except Exception as e:
        return f"执行出错：{e}"

@tool
def read_file(file_path: str) -> str:
    """读取文件内容"""
    with open(file_path, "r") as f:
        return f.read()

# 创建 Agent
llm = ChatOpenAI(model="gpt-4o", temperature=0)
tools = [web_search, python_repl, read_file]

agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt="""你是一个强大的 AI 助手，可以：
1. 搜索互联网获取信息
2. 执行 Python 代码进行计算和数据分析
3. 读取文件内容

请根据用户的需求，灵活使用这些工具。""",
    checkpointer=MemorySaver(),
)

# 运行（带对话记忆）
config = {"configurable": {"thread_id": "user-1"}}

# 第一轮对话
result1 = agent.invoke(
    {"messages": [("user", "帮我写一个计算斐波那契数列的函数")]},
    config=config,
)

# 第二轮对话（记住上下文）
result2 = agent.invoke(
    {"messages": [("user", "用这个函数计算前20项")]},
    config=config,
)
```

## 限制 Agent 循环次数

ReAct Agent 可能陷入无限循环。有几种限制方式：

### 方式一：recursion_limit

```python
# 限制最大步数（包括所有节点的执行）
app = graph.compile()
result = app.invoke(
    input_data,
    {"recursion_limit": 15},  # 最多执行 15 步
)
```

### 方式二：状态计数

```python
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    step_count: int

def agent_node(state: AgentState) -> dict:
    return {
        "messages": [response],
        "step_count": state.get("step_count", 0) + 1,
    }

def should_continue(state: AgentState) -> str:
    if state.get("step_count", 0) >= 10:
        return END  # 超过 10 步强制结束
    if state["messages"][-1].tool_calls:
        return "tools"
    return END
```

### 方式三：MaxIterationsError

```python
from langgraph.errors import GraphRecursionError

try:
    result = app.invoke(input_data, {"recursion_limit": 15})
except GraphRecursionError:
    print("Agent 达到最大循环次数")
```

## 流式输出

LangGraph 支持多种粒度的流式输出：

```python
# 方式 1：流式消息
for chunk in app.stream(input_data, stream_mode="messages"):
    print(chunk.content, end="", flush=True)

# 方式 2：流式状态更新
for event in app.stream(input_data, stream_mode="updates"):
    print(event)  # 每个节点执行后的状态更新

# 方式 3：流式事件（最细粒度）
async for event in app.astream_events(input_data, version="v2"):
    if event["event"] == "on_chat_model_stream":
        print(event["data"]["chunk"].content, end="")
```

## 小结

| 方式 | 适用场景 | 复杂度 |
|------|---------|:------:|
| `create_react_agent` | 标准 ReAct Agent | 低 |
| 手动 StateGraph | 需要自定义控制流 | 中 |
| 自定义 ToolNode | 需要特殊工具处理 | 中 |
| 带限制的 Agent | 生产环境 | 低 |

## 下一篇

→ [持久化与检查点](./05-持久化与检查点)：Checkpointer 机制、MemorySaver、SQLite/Postgres、时间旅行调试。
