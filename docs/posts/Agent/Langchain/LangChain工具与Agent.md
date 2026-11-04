---
title: LangChain工具与Agent
date: 2025-06-22
tags: [Python, LangChain, Agent, Tool]
category: LangChain
order: 5
---

# LangChain 工具与 Agent

## 1. 什么是 Agent

Agent（代理）是能够**自主决策**使用哪些工具来完成任务的 LLM 应用。与固定链不同，Agent 会根据用户的输入**动态选择**调用哪些工具、调用几次、以什么顺序调用。

### Agent vs Chain

| 特性 | Chain | Agent |
|------|-------|-------|
| 执行流程 | 固定，开发者预定义 | 动态，LLM 自主决策 |
| 工具调用 | 硬编码在链中 | LLM 根据需要选择 |
| 适用场景 | 流程确定的任务 | 需要推理和决策的任务 |
| 灵活性 | 低 | 高 |

### Agent 工作流程

```
用户输入
    ↓
┌──────────────┐
│   LLM 推理   │←─────────────────┐
└──────┬───────┘                  │
       ↓                          │
┌──────────────┐     有工具调用     │
│  决策：调工具？│──────────────────→│
└──────┬───────┘                  │
       ↓ 无工具调用                │
┌──────────────┐                  │
│  输出最终回答  │    ┌──────────┐  │
└──────────────┘    │ 执行工具  │──┘
                    └──────────┘
```

## 2. Tool 定义

### 2.1 @tool 装饰器（推荐）

```python
from langchain_core.tools import tool

@tool
def multiply(a: int, b: int) -> int:
    """将两个整数相乘并返回结果。

    Args:
        a: 第一个整数
        b: 第二个整数
    """
    return a * b

@tool
def add(a: int, b: int) -> int:
    """将两个整数相加并返回结果。

    Args:
        a: 第一个整数
        b: 第二个整数
    """
    return a + b

# 查看工具信息
print(multiply.name)         # "multiply"
print(multiply.description)  # "将两个整数相乘并返回结果。"
print(multiply.args_schema.model_json_schema())  # 参数的 JSON Schema
```

:::tip
函数的 docstring 非常重要！LLM 通过它来理解工具的用途。务必写清楚工具的功能和参数说明。
:::

### 2.2 StructuredTool（更灵活）

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class SearchInput(BaseModel):
    query: str = Field(description="搜索关键词")
    max_results: int = Field(default=5, description="最大结果数")

def search_func(query: str, max_results: int = 5) -> str:
    # 模拟搜索
    return f"找到 {max_results} 条关于 '{query}' 的结果"

search_tool = StructuredTool.from_function(
    func=search_func,
    name="web_search",
    description="在互联网上搜索信息",
    args_schema=SearchInput,
)
```

### 2.3 常用内置工具

```python
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper

# Wikipedia 查询工具
wiki_tool = WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper())

# DuckDuckGo 搜索
from langchain_community.tools import DuckDuckGoSearchRun
search_tool = DuckDuckGoSearchRun()
```

```bash
# 安装依赖
pip install wikipedia duckduckgo-search
```

### 2.4 工具列表

```python
tools = [multiply, add, search_tool]

# 查看所有工具信息
for t in tools:
    print(f"- {t.name}: {t.description}")
```

## 3. Tool Calling（工具调用）

现代 LLM（GPT-4o、Claude 3.5 等）原生支持 **Tool Calling**：模型可以输出结构化的工具调用请求，由应用执行后再将结果返回给模型。

### 3.1 基本 Tool Calling

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> str:
    """获取指定城市的天气信息"""
    return f"{city}今天晴天，气温25°C"

llm = ChatOpenAI(model="gpt-4o-mini")

# 绑定工具到模型
llm_with_tools = llm.bind_tools([get_weather])

# 模型会决定是否调用工具
response = llm_with_tools.invoke("北京今天天气怎么样？")

print(response.tool_calls)
# [{'name': 'get_weather', 'args': {'city': '北京'}, 'id': 'call_xxx'}]
```

### 3.2 执行工具调用

```python
from langchain_core.messages import HumanMessage

messages = [HumanMessage(content="3乘以5等于多少？")]

# 1. 模型决定调用工具
response = llm_with_tools.invoke(messages)
messages.append(response)

# 2. 执行工具调用
if response.tool_calls:
    for tool_call in response.tool_calls:
        # 根据名称找到对应工具
        tool_func = {"multiply": multiply, "add": add}[tool_call["name"]]
        result = tool_func.invoke(tool_call["args"])
        from langchain_core.messages import ToolMessage
        messages.append(ToolMessage(
            content=str(result),
            tool_call_id=tool_call["id"],
        ))

# 3. 模型根据工具结果生成最终回答
final_response = llm_with_tools.invoke(messages)
print(final_response.content)  # "3乘以5等于15"
```

## 4. 构建 Agent

### 4.1 使用 create_react_agent（推荐）

`create_react_agent` 是 LangGraph 提供的预构建 ReAct Agent，是最简单的方式：

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

# 定义工具
@tool
def search_web(query: str) -> str:
    """搜索互联网获取最新信息"""
    # 这里可以接入真实的搜索 API
    return f"搜索结果：关于'{query}'的最新信息..."

@tool
def calculator(expression: str) -> str:
    """计算数学表达式"""
    try:
        return str(eval(expression))
    except Exception as e:
        return f"计算错误：{e}"

@tool
def get_current_time() -> str:
    """获取当前时间"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# 创建 Agent
llm = ChatOpenAI(model="gpt-4o-mini")
tools = [search_web, calculator, get_current_time]

agent = create_react_agent(llm, tools)

# 调用 Agent
result = agent.invoke({
    "messages": [("user", "现在几点了？")]
})

# 输出结果
for msg in result["messages"]:
    if msg.content:
        print(f"[{msg.type}] {msg.content}")
```

```bash
pip install langgraph
```

### 4.2 多步推理示例

```python
# Agent 会自动进行多步推理
result = agent.invoke({
    "messages": [("user", "帮我查一下现在几点，然后计算 (23 + 17) * 5 等于多少")]
})

for msg in result["messages"]:
    if msg.content:
        print(f"[{msg.type}] {msg.content}")
```

Agent 执行流程：
1. 调用 `get_current_time` 获取时间
2. 调用 `calculator(" (23 + 17) * 5")` 计算结果
3. 整合两个工具的结果，生成最终回答

### 4.3 自定义 System Prompt

```python
agent = create_react_agent(
    llm,
    tools,
    state_modifier="你是一个专业的数据分析助手。请使用提供的工具来帮助用户分析数据。回答要简洁明了。",
)

result = agent.invoke({
    "messages": [("user", "帮我搜索一下2024年AI领域的最新进展")]
})
```

### 4.4 流式输出

```python
# 流式输出 Agent 的思考和工具调用过程
for chunk in agent.stream(
    {"messages": [("user", "计算 123 * 456 + 789")]},
    stream_mode="values",
):
    last_msg = chunk["messages"][-1]
    if last_msg.content:
        print(f"[{last_msg.type}] {last_msg.content}")
```

## 5. 手动构建 Agent（理解原理）

### 5.1 使用 StateGraph 手动构建

```python
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def multiply(a: int, b: int) -> int:
    """将两个整数相乘"""
    return a * b

@tool
def add(a: int, b: int) -> int:
    """将两个整数相加"""
    return a + b

tools = [multiply, add]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

# 定义节点函数
def agent(state: MessagesState):
    """Agent 节点：调用 LLM"""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: MessagesState):
    """条件边：判断是否继续调用工具"""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"  # 有工具调用 → 去执行工具
    return END           # 无工具调用 → 结束

# 构建图
graph = StateGraph(MessagesState)

# 添加节点
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

# 添加边
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, ["tools", END])
graph.add_edge("tools", "agent")  # 工具执行完回到 agent

# 编译
app = graph.compile()

# 运行
result = app.invoke({"messages": [("user", "计算 (3 + 5) * 12")]})
for msg in result["messages"]:
    print(f"[{msg.type}] {msg.content or msg.tool_calls}")
```

### 5.2 StateGraph 核心概念

```python
# StateGraph 的组成：
# - State（状态）：数据在图中流动的格式
# - Node（节点）：执行操作的函数
# - Edge（边）：节点之间的连接
# - Conditional Edge（条件边）：根据状态动态选择下一个节点

# 执行流程：
# START → agent → [有工具调用] → tools → agent → ...
#                  [无工具调用] → END
```

## 6. 实战示例

### 6.1 智能问答助手

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader

# 1. 构建知识库检索工具
loader = TextLoader("company_docs.txt", encoding="utf-8")
docs = loader.load()
splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
chunks = splitter.split_documents(docs)
vectorstore = FAISS.from_documents(chunks, OpenAIEmbeddings())

@tool
def search_knowledge_base(query: str) -> str:
    """搜索公司知识库，查找相关信息"""
    results = vectorstore.similarity_search(query, k=3)
    return "\n\n".join(doc.page_content for doc in results)

@tool
def get_current_time() -> str:
    """获取当前时间"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# 2. 创建 Agent
llm = ChatOpenAI(model="gpt-4o-mini")
agent = create_react_agent(
    llm,
    [search_knowledge_base, get_current_time],
    state_modifier="你是公司内部的智能助手。请使用知识库工具回答公司相关问题。",
)

# 3. 测试
result = agent.invoke({
    "messages": [("user", "公司的年假政策是什么？")]
})
print(result["messages"][-1].content)
```

### 6.2 数据分析 Agent

```python
import pandas as pd
from langchain_core.tools import tool

# 准备数据
df = pd.read_csv("sales.csv")

@tool
def describe_data() -> str:
    """查看数据的基本统计信息"""
    return df.describe().to_string()

@tool
def query_data(sql_like_condition: str) -> str:
    """根据条件筛选数据。传入 pandas query 表达式。

    Args:
        sql_like_condition: pandas query 表达式，如 "age > 25" 或 "city == '北京'"
    """
    try:
        result = df.query(sql_like_condition)
        return result.head(20).to_string()
    except Exception as e:
        return f"查询错误：{e}"

@tool
def aggregate_data(group_by: str, agg_column: str, agg_func: str) -> str:
    """对数据进行分组聚合。

    Args:
        group_by: 分组列名
        agg_column: 聚合列名
        agg_func: 聚合函数（sum, mean, count, max, min）
    """
    try:
        result = getattr(df.groupby(group_by)[agg_column], agg_func)()
        return result.to_string()
    except Exception as e:
        return f"聚合错误：{e}"

# 创建 Agent
agent = create_react_agent(
    ChatOpenAI(model="gpt-4o-mini"),
    [describe_data, query_data, aggregate_data],
    state_modifier="你是一个数据分析助手。使用提供的工具分析数据集。",
)

result = agent.invoke({
    "messages": [("user", "哪个城市的销售额最高？")]
})
print(result["messages"][-1].content)
```

## 7. 最佳实践

### 7.1 工具设计原则

| 原则 | 说明 |
|------|------|
| **职责单一** | 每个工具只做一件事 |
| **描述清晰** | docstring 要让 LLM 准确理解用途 |
| **参数明确** | 使用类型注解和 Pydantic 描述参数 |
| **错误处理** | 工具内部处理异常，返回友好错误信息 |
| **幂等性** | 相同输入相同输出（避免副作用） |

### 7.2 安全注意事项

```python
# ❌ 危险：直接执行用户代码
@tool
def run_code(code: str) -> str:
    """执行 Python 代码"""
    return str(eval(code))  # 不安全！

# ✅ 安全：限制执行环境
@tool
def safe_calculator(expression: str) -> str:
    """安全计算数学表达式，仅支持基本运算"""
    import re
    # 只允许数字和基本运算符
    if not re.match(r'^[\d\s\+\-\*\/\(\)\.]+$', expression):
        return "错误：仅支持基本数学运算"
    try:
        return str(eval(expression))
    except:
        return "计算错误"
```

### 7.3 调试技巧

```python
# 使用 LangSmith 追踪 Agent 的每一步
# 设置环境变量即可自动追踪：
# export LANGCHAIN_TRACING_V2=true

# 或者使用 verbose 模式查看详细日志
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 总结

| 概念 | 说明 |
|------|------|
| `@tool` | 定义工具的装饰器 |
| `bind_tools()` | 将工具绑定到模型 |
| `create_react_agent()` | 快速创建 ReAct Agent |
| `StateGraph` | 手动构建 Agent 的底层框架 |
| `ToolNode` | 执行工具调用的预构建节点 |
| `tool_calls` | 模型输出的工具调用请求 |
| `ToolMessage` | 工具执行结果消息 |
