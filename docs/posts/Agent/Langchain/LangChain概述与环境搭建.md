---
title: LangChain概述与环境搭建
date: 2025-06-22
tags: [Python, LangChain, LLM, AI]
category: LangChain
order: 1
---

# LangChain 概述与环境搭建

## 1. LangChain 是什么

LangChain 是一个用于构建 LLM（大语言模型）应用的开源框架。它提供了一整套工具和抽象，让开发者能够将大语言模型与外部数据、工具和工作流结合起来，构建复杂的 AI 应用。

### 核心价值

- **标准化接口**：统一封装了各种 LLM 提供商（OpenAI、Anthropic、Google 等）的 API，切换模型只需改一行代码
- **组件化架构**：模型、提示词、检索、工具等模块可自由组合
- **LCEL 表达式语言**：用管道运算符 `|` 声明式地构建处理链
- **生态丰富**：数百个集成组件，覆盖文档加载、向量存储、工具调用等场景

### 典型应用场景

| 场景 | 说明 |
|------|------|
| RAG 检索增强生成 | 基于私有知识库的问答系统 |
| AI Agent | 具备工具调用能力的自主代理 |
| 对话系统 | 带记忆的多轮对话 |
| 数据分析 | 自然语言查询数据库/文档 |
| 内容生成 | 结构化文本生成、翻译、摘要 |

## 2. 架构概览

LangChain 采用模块化的分层架构：

```
┌─────────────────────────────────────────────────┐
│                   应用层                          │
│         LangGraph / LangServe / 应用代码          │
├─────────────────────────────────────────────────┤
│                   链与代理层                       │
│        Chains / Agents / Retrieval               │
├─────────────────────────────────────────────────┤
│               LCEL 表达式语言                      │
│     Runnable 协议 | 管道运算符 | 并行/分支          │
├─────────────────────────────────────────────────┤
│                   组件层                          │
│  Models | Prompts | Output Parsers | Tools       │
│  Retrievers | Vector Stores | Memory             │
├─────────────────────────────────────────────────┤
│               langchain-core                     │
│         基础抽象、接口定义、运行时                   │
└─────────────────────────────────────────────────┘
```

### 核心包

| 包名 | 作用 |
|------|------|
| `langchain-core` | 基础抽象和接口（Runnable、LCEL） |
| `langchain` | 链、Agent、检索策略等高级组件 |
| `langchain-community` | 第三方集成（LLM、向量存储、工具等） |
| `langchain-text-splitters` | 文本分割工具 |
| `langchain-openai` | OpenAI 专用集成 |
| `langchain-anthropic` | Anthropic (Claude) 专用集成 |
| `langchain-google-genai` | Google Gemini 专用集成 |

:::tip
从 v0.3 开始，各 LLM 提供商的集成被拆分为独立的 `langchain-xxx` 包。不再通过 `langchain.chat_models` 导入，而是使用 `langchain_openai`、`langchain_anthropic` 等专用包。
:::

## 3. 环境搭建

### 3.1 安装 Python 环境

```bash
# 推荐 Python 3.10+
python --version  # 确保 >= 3.9

# 创建虚拟环境
python -m venv langchain-env
source langchain-env/bin/activate  # Linux/macOS
# langchain-env\Scripts\activate   # Windows
```

### 3.2 安装 LangChain

```bash
# 核心包（必装）
pip install langchain langchain-core

# 按需安装 LLM 提供商
pip install langchain-openai          # OpenAI GPT 系列
pip install langchain-anthropic       # Anthropic Claude 系列
pip install langchain-google-genai    # Google Gemini 系列

# 社区集成（可选，包含更多第三方工具）
pip install langchain-community

# 文本分割（RAG 场景需要）
pip install langchain-text-splitters
```

### 3.3 配置 API Key

大多数 LLM 需要 API Key，推荐通过环境变量配置：

```bash
# OpenAI
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxx"

# Anthropic (Claude)
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxx"

# Google Gemini
export GOOGLE_API_KEY="AIzaxxxxxxxxxxxxxxxxxxxx"
```

也可以使用 `.env` 文件 + `python-dotenv` 管理：

```bash
pip install python-dotenv
```

```env
# .env 文件
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

```python
from dotenv import load_dotenv
load_dotenv()  # 自动读取 .env 文件
```

## 4. 快速上手

### 4.1 第一个 LangChain 程序

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# 创建模型实例
llm = ChatOpenAI(model="gpt-4o-mini")

# 直接调用
response = llm.invoke([HumanMessage(content="你好，请用一句话介绍LangChain")])
print(response.content)
```

### 4.2 使用 Prompt Template

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# 创建提示词模板
prompt = ChatPromptTemplate.from_template(
    "请用{language}写一首关于{topic}的五言绝句"
)

# 创建模型
llm = ChatOpenAI(model="gpt-4o-mini")

# 组合链
chain = prompt | llm

# 调用
result = chain.invoke({"language": "中文", "topic": "春天"})
print(result.content)
```

### 4.3 使用 LCEL 管道

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

prompt = ChatPromptTemplate.from_template("用一句话解释什么是{concept}")
llm = ChatOpenAI(model="gpt-4o-mini")
parser = StrOutputParser()

# 用管道运算符组合
chain = prompt | llm | parser

result = chain.invoke({"concept": "量子计算"})
print(result)  # 直接输出字符串
```

### 4.4 流式输出

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(model="gpt-4o-mini")

# 流式输出
for chunk in llm.stream([HumanMessage(content="写一个短故事")]):
    print(chunk.content, end="", flush=True)
```

## 5. 版本演进与迁移

### 5.1 v0.1 → v0.3 的主要变化

| 变化 | v0.1 (旧) | v0.3 (新) |
|------|-----------|-----------|
| Pydantic | v1 | v2（v1 已废弃） |
| 集成导入 | `langchain.chat_models` | `langchain_openai` 等独立包 |
| 链构建 | `LLMChain`、`SequentialChain` | LCEL 管道 `\|` |
| Agent | `AgentExecutor` | LangGraph `StateGraph` |
| Memory | `ConversationBufferMemory` | LangGraph `checkpointer` |
| Python | ≥ 3.8 | ≥ 3.9 |

### 5.2 旧代码迁移示例

**旧写法（已废弃）：**

```python
# ❌ 不推荐
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI

chain = LLMChain(
    llm=ChatOpenAI(),
    prompt=PromptTemplate.from_template("Tell me about {topic}")
)
result = chain.run(topic="AI")
```

**新写法（LCEL）：**

```python
# ✅ 推荐
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

chain = (
    ChatPromptTemplate.from_template("Tell me about {topic}")
    | ChatOpenAI()
    | StrOutputParser()
)
result = chain.invoke({"topic": "AI"})
```

## 6. LangSmith 调试追踪

LangSmith 是 LangChain 官方的可观测性平台，用于追踪、调试和评估 LLM 应用。

### 6.1 配置

```bash
pip install langsmith
```

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY="lsv2_xxxxxxxxxxxxxxxx"
export LANGCHAIN_PROJECT="my-project"  # 可选，项目名称
```

### 6.2 自动追踪

配置环境变量后，所有 LangChain 调用会自动发送追踪数据到 LangSmith：

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# 这些调用会自动被 LangSmith 追踪
prompt = ChatPromptTemplate.from_template("说一个关于{topic}的笑话")
llm = ChatOpenAI(model="gpt-4o-mini")
chain = prompt | llm

result = chain.invoke({"topic": "程序员"})
# 在 langsmith.com 上可以看到完整的调用链
```

:::tip
LangSmith 有免费额度，个人开发和学习完全够用。在 [smith.langchain.com](https://smith.langchain.com) 注册即可。
:::

## 7. 常见问题

### Q1: 安装后导入报错

```
ModuleNotFoundError: No module named 'langchain_openai'
```

**解决**：LLM 集成已拆分为独立包，需要单独安装：

```bash
pip install langchain-openai
```

### Q2: API Key 不生效

```python
# 方式一：环境变量（推荐）
import os
os.environ["OPENAI_API_KEY"] = "sk-xxx"

# 方式二：直接传参
llm = ChatOpenAI(api_key="sk-xxx")

# 方式三：使用 .env 文件
from dotenv import load_dotenv
load_dotenv()
```

### Q3: 国内网络访问问题

```python
# 配置代理
import os
os.environ["OPENAI_API_BASE"] = "https://your-proxy.com/v1"

# 或使用国内兼容的 LLM（如通义千问、文心一言）
# 安装对应集成包即可
```

### Q4: 如何选择模型

| 模型 | 适用场景 | 价格 |
|------|---------|------|
| `gpt-4o-mini` | 日常对话、简单任务 | 便宜 |
| `gpt-4o` | 复杂推理、代码生成 | 中等 |
| `claude-sonnet-4-20250514` | 长文本、分析 | 中等 |
| `gemini-2.0-flash` | 快速响应、多模态 | 便宜 |

## 总结

| 知识点 | 要点 |
|--------|------|
| LangChain 定位 | LLM 应用开发框架 |
| 核心包 | `langchain-core`、`langchain`、`langchain-community` |
| 安装 | `pip install langchain langchain-openai` |
| 配置 | 环境变量设置 API Key |
| 旧 → 新 | `LLMChain` → LCEL 管道 `\|` |
| 调试 | LangSmith 自动追踪 |
