---
title: LangGraph Platform与部署
date: 2025-06-22
tags: [Python, LangGraph, 部署, 生产]
category: LangGraph
order: 8
---

# LangGraph Platform 与部署

开发完 LangGraph 应用后，下一步是将其部署到生产环境。LangGraph 提供了完整的部署方案——从本地开发到云端生产。

## 部署方式概览

| 方式 | 适用场景 | 复杂度 | 成本 |
|------|---------|:------:|:----:|
| 直接运行 | 开发/测试 | 低 | 低 |
| FastAPI 封装 | 自托管 API | 中 | 中 |
| LangGraph Cloud | 托管服务 | 低 | 高 |
| Docker 容器 | 自托管生产 | 中 | 中 |
| Kubernetes | 大规模部署 | 高 | 高 |

## 方式一：FastAPI 封装

最灵活的自托管方式，将 LangGraph 应用封装为 REST API：

```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver
import uvicorn

# 创建 LangGraph 应用
checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:pass@localhost:5432/langgraph"
)
app_graph = graph.compile(checkpointer=checkpointer)

# FastAPI 应用
app = FastAPI(title="LangGraph API")

class ChatRequest(BaseModel):
    thread_id: str
    message: str

class ChatResponse(BaseModel):
    response: str
    thread_id: str

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    try:
        result = await app_graph.ainvoke(
            {"messages": [("user", request.message)]},
            config=config,
        )
        last_msg = result["messages"][-1]
        return ChatResponse(
            response=last_msg.content,
            thread_id=request.thread_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}

    async def generate():
        async for event in app_graph.astream(
            {"messages": [("user", request.message)]},
            config=config,
            stream_mode="messages",
        ):
            yield f"data: {event.content}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/threads/{thread_id}/state")
async def get_thread_state(thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    state = app_graph.get_state(config)
    return {
        "values": state.values,
        "next": state.next,
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 带中断恢复的 API

```python
from langgraph.types import Command

@app.post("/chat/resume")
async def resume_chat(request: dict):
    thread_id = request["thread_id"]
    human_input = request["input"]
    config = {"configurable": {"thread_id": thread_id}}

    result = await app_graph.ainvoke(
        Command(resume=human_input),
        config=config,
    )

    # 检查是否再次中断
    state = app_graph.get_state(config)
    if state.next and "__interrupt__" in str(state.next):
        return {
            "status": "interrupted",
            "interrupt": state.tasks[0].interrupts[0].value,
        }

    return {
        "status": "completed",
        "response": result["messages"][-1].content,
    }
```

## 方式二：Docker 部署

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 暴露端口
EXPOSE 8000

# 启动
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### requirements.txt

```
langgraph>=0.2.0
langchain>=0.3.0
langchain-openai>=0.2.0
fastapi>=0.100.0
uvicorn>=0.30.0
psycopg2-binary>=2.9.0
langgraph-checkpoint-postgres>=2.0.0
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DATABASE_URL=postgresql://postgres:password@db:5432/langgraph
    depends_on:
      - db

  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=langgraph
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
```

## 方式三：LangGraph Cloud

LangGraph Cloud 是 LangChain 提供的托管服务，提供开箱即用的部署体验。

### 架构

```
┌─────────────────────────────────────────┐
│            LangGraph Cloud              │
│  ┌──────────┐  ┌──────────┐            │
│  │  API     │  │  Stream  │            │
│  │  Server  │  │  Server  │            │
│  └────┬─────┘  └────┬─────┘            │
│       │              │                  │
│  ┌────▼──────────────▼─────┐            │
│  │    LangGraph Runtime    │            │
│  │  ┌─────┐  ┌─────────┐  │            │
│  │  │Graph│  │Checkpoin│  │            │
│  │  │Exec │  │ter      │  │            │
│  │  └─────┘  └─────────┘  │            │
│  └─────────────────────────┘            │
└─────────────────────────────────────────┘
```

### 部署步骤

1. **准备项目结构**

```
my-agent/
├── src/
│   └── agent.py          # 图定义
├── langgraph.json         # 配置文件
├── requirements.txt
└── .env
```

2. **langgraph.json**

```json
{
  "dependencies": ["./src", "requirements.txt"],
  "graphs": {
    "my_agent": "./src/agent.py:app"
  },
  "env": ".env"
}
```

3. **部署**

```bash
# 安装 CLI
pip install langgraph-cli

# 本地测试
langgraph dev

# 部署到 Cloud
langgraph deploy
```

### LangGraph Cloud API

```python
from langgraph_sdk import get_client

# 连接到 LangGraph Cloud
client = get_client(url="https://your-app.langchain.cloud")

# 创建线程
thread = await client.threads.create()

# 运行图
result = await client.runs.create(
    thread_id=thread["thread_id"],
    assistant_id="my_agent",
    input={"messages": [("user", "你好")]},
)

# 流式输出
async for event in client.runs.stream(
    thread_id=thread["thread_id"],
    assistant_id="my_agent",
    input={"messages": [("user", "你好")]},
):
    print(event)
```

## LangSmith 集成

LangSmith 是 LangChain 的可观测性平台，用于追踪、调试和评估 LangGraph 应用。

### 配置

```bash
# 环境变量
export LANGSMITH_API_KEY="your-key"
export LANGSMITH_TRACING=true
export LANGSMITH_PROJECT="my-langgraph-app"
```

### 追踪内容

LangSmith 会自动追踪：

- **每次图执行**：输入、输出、耗时
- **每个节点**：状态变化、执行时间
- **LLM 调用**：提示词、响应、token 使用量
- **工具调用**：工具名、参数、返回值
- **错误和异常**：完整的错误堆栈

```python
# 无需修改代码，LangSmith 自动追踪
result = app.invoke(input_data, config=config)

# 在 LangSmith UI 中可以看到：
# - 完整的执行图
# - 每个节点的输入/输出
# - LLM 的完整对话
# - 性能指标
```

### 评估和测试

```python
from langsmith import Client

client = Client()

# 创建测试数据集
dataset = client.create_dataset("agent-tests")
client.create_examples(
    inputs=[
        {"question": "1+1等于几？"},
        {"question": "搜索今天的新闻"},
    ],
    outputs=[
        {"answer": "2"},
        {"answer": "..."},
    ],
    dataset_id=dataset.id,
)

# 运行评估
def run_agent(inputs):
    return app.invoke({"messages": [("user", inputs["question")]})

# 在 LangSmith UI 中运行评估
```

## 生产环境最佳实践

### 1. 错误处理和重试

```python
from langchain_core.runnables import RunnableLambda

@tool
def unreliable_api(query: str) -> str:
    """可能失败的外部 API"""
    response = requests.get(f"https://api.example.com?q={query}", timeout=10)
    response.raise_for_status()
    return response.text

# 包装为带重试的工具
from langchain_core.runnables import retry
reliable_tool = RunnableLambda(unreliable_api).with_retry(
    stop_after_attempt=3,
    wait_exponential_multiplier=1000,
)
```

### 2. 限流和并发控制

```python
import asyncio
from asyncio import Semaphore

# 限制并发 LLM 调用
semaphore = Semaphore(10)

async def rate_limited_llm(state):
    async with semaphore:
        return await llm.ainvoke(state["messages"])
```

### 3. 监控和告警

```python
import logging
from langsmith import traceable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@traceable(name="agent_node")
def agent_node(state: AgentState) -> dict:
    logger.info(f"Agent 执行，消息数：{len(state['messages'])}")
    try:
        response = llm.invoke(state["messages"])
        logger.info(f"Agent 完成，响应长度：{len(response.content)}")
        return {"messages": [response]}
    except Exception as e:
        logger.error(f"Agent 执行失败：{e}")
        raise
```

### 4. 安全性

```python
# 输入验证
def validate_input(state: AgentState) -> dict:
    user_msg = state["messages"][-1].content
    if len(user_msg) > 10000:
        raise ValueError("输入过长")
    if contains_injection(user_msg):
        raise ValueError("检测到注入攻击")
    return {}

# 输出过滤
def filter_output(state: AgentState) -> dict:
    response = state["messages"][-1].content
    # 过滤敏感信息
    filtered = remove_pii(response)
    return {"messages": [("assistant", filtered)]}
```

### 5. 性能优化

```python
# LLM 缓存
from langchain_core.globals import set_llm_cache
from langchain_community.cache import SQLiteCache

set_llm_cache(SQLiteCache(database_path=".langchain.db"))

# 批处理
results = app.batch([
    {"messages": [("user", msg)]}
    for msg in messages
])

# 并行工具执行（ToolNode 默认并行）
# 确保工具支持并行调用
```

## 部署检查清单

部署前请确认以下事项：

- [ ] **错误处理**：所有节点都有 try-except
- [ ] **超时设置**：LLM 调用和工具调用有超时
- [ ] **循环限制**：设置了 `recursion_limit`
- [ ] **持久化**：使用生产级 Checkpointer（PostgreSQL）
- [ ] **API Key 安全**：使用环境变量，不硬编码
- [ ] **日志记录**：关键步骤有日志
- [ ] **监控告警**：集成了 LangSmith 或其他监控
- [ ] **输入验证**：验证用户输入
- [ ] **速率限制**：防止滥用
- [ ] **备份恢复**：数据库有备份策略

## 小结

| 部署方式 | 优势 | 劣势 |
|---------|------|------|
| **FastAPI** | 灵活、完全控制 | 需要自己管理基础设施 |
| **Docker** | 环境一致、易迁移 | 需要容器编排 |
| **LangGraph Cloud** | 零运维、内置功能 | 成本高、供应商锁定 |
| **Kubernetes** | 高可用、自动扩缩 | 复杂度高 |

## 总结

本系列教程覆盖了 LangGraph 的全部核心内容：

1. **核心概念**：StateGraph、Node、Edge、State、Checkpointer
2. **状态管理**：TypedDict、Pydantic、Annotated Reducer
3. **控制流**：条件边、并行、Map-Reduce、子图
4. **Agent 构建**：ReAct 模式、ToolNode、create_react_agent
5. **持久化**：Checkpointer、时间旅行
6. **人机交互**：interrupt、审批工作流
7. **多 Agent**：Supervisor、Swarm、子图嵌套
8. **生产部署**：FastAPI、Docker、LangGraph Cloud

掌握这些内容，你就能构建从简单到复杂的各种 AI Agent 应用。

## 参考资源

- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LangChain Academy](https://academy.langchain.com/courses/intro-to-langgraph)
- [LangSmith 文档](https://docs.smith.langchain.com/)
