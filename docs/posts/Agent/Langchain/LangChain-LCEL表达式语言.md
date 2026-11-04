---
title: LangChain-LCEL表达式语言
date: 2025-06-22
tags: [Python, LangChain, LCEL, Runnable]
category: LangChain
order: 3
---

# LangChain LCEL 表达式语言

## 1. LCEL 简介

LCEL（LangChain Expression Language）是 LangChain 的核心编程模型。它基于 **Runnable 协议**，通过管道运算符 `|` 将各个组件串联起来，形成声明式的处理链。

### 核心优势

- **统一接口**：所有组件都实现 `Runnable` 协议，支持 `.invoke()`、`.batch()`、`.stream()`、`.ainvoke()`
- **管道语法**：用 `|` 连接组件，代码直观易读
- **自动支持流式**：管道链天然支持 `.stream()` 逐 token 输出
- **自动支持批量**：`.batch()` 可并行处理多个输入
- **自动支持异步**：`.ainvoke()`、`.astream()` 原生异步
- **LangSmith 集成**：自动追踪每一环节

### 基本语法

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

prompt = ChatPromptTemplate.from_template("解释什么是{concept}")
model = ChatOpenAI(model="gpt-4o-mini")
parser = StrOutputParser()

# 管道链：prompt → model → parser
chain = prompt | model | parser

# 调用方式
result = chain.invoke({"concept": "机器学习"})       # 同步调用
# batch_result = chain.batch([{"concept": "AI"}, {"concept": "DL"}])  # 批量
# for chunk in chain.stream({"concept": "AI"}): print(chunk, end="")  # 流式
# result = await chain.ainvoke({"concept": "AI"})    # 异步
```

## 2. Runnable 接口

所有 LCEL 组件都实现 `Runnable` 协议，提供统一的方法：

### 2.1 核心方法

```python
from langchain_core.runnables import RunnableLambda

# 自定义 Runnable
square = RunnableLambda(lambda x: x ** 2)

# invoke —— 单次调用
result = square.invoke(5)           # 25

# batch —— 批量调用
results = square.batch([1, 2, 3, 4])  # [1, 4, 9, 16]

# stream —— 流式输出
for chunk in square.stream(5):
    print(chunk)  # 25

# ainvoke —— 异步调用
result = await square.ainvoke(5)    # 25
```

### 2.2 输入输出类型

```python
# Runnable 的输入输出可以是任意类型
# 但管道连接时，上游的输出必须匹配下游的输入

# ChatPromptTemplate: dict → ChatPromptValue
# ChatModel: ChatPromptValue → AIMessage
# StrOutputParser: AIMessage → str

# 所以完整管道：dict → str
```

## 3. 核心 Runnable 组件

### 3.1 RunnablePassthrough

透传输入，不做任何修改。常用于保持原始数据：

```python
from langchain_core.runnables import RunnablePassthrough

passthrough = RunnablePassthrough()
result = passthrough.invoke({"key": "value"})
# 输出：{"key": "value"}（原样透传）
```

**实际用途**：在 RAG 链中保留原始问题：

```python
from langchain_core.runnables import RunnablePassthrough

# context 由 retriever 处理，question 直接透传
chain = (
    {"context": retriever, "question": RunnablePassthrough()}
    | prompt
    | llm
    | parser
)
```

### 3.2 RunnableLambda

将普通 Python 函数包装为 Runnable：

```python
from langchain_core.runnables import RunnableLambda

# 简单函数
def word_count(text: str) -> dict:
    return {"text": text, "word_count": len(text.split())}

counter = RunnableLambda(word_count)
result = counter.invoke("Hello world foo bar")
# {'text': 'Hello world foo bar', 'word_count': 4}
```

```python
# 在管道中使用
from langchain_core.runnables import RunnableLambda

def format_output(result):
    return f"🤖 回答：{result}"

chain = prompt | llm | parser | RunnableLambda(format_output)
result = chain.invoke({"concept": "深度学习"})
# "🤖 回答：深度学习是机器学习的一个子领域..."
```

### 3.3 RunnableParallel

并行运行多个 Runnable，结果合并为字典：

```python
from langchain_core.runnables import RunnableParallel, RunnableLambda

# 并行执行多个任务
parallel = RunnableParallel(
    length=RunnableLambda(lambda x: len(x)),
    upper=RunnableLambda(lambda x: x.upper()),
    words=RunnableLambda(lambda x: x.split()),
)

result = parallel.invoke("hello world")
# {'length': 11, 'upper': 'HELLO WORLD', 'words': ['hello', 'world']}
```

```python
# 实际应用：同时生成摘要和翻译
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

llm = ChatOpenAI(model="gpt-4o-mini")
parser = StrOutputParser()

summary_chain = (
    ChatPromptTemplate.from_template("用一句话总结：{text}")
    | llm | parser
)

translate_chain = (
    ChatPromptTemplate.from_template("翻译成英文：{text}")
    | llm | parser
)

# 并行执行
parallel = RunnableParallel(
    summary=summary_chain,
    translation=translate_chain,
)

result = parallel.invoke({"text": "人工智能是计算机科学的一个分支..."})
# {'summary': '...', 'translation': '...'}
```

### 3.4 RunnableBranch

条件分支，根据输入选择不同的处理路径：

```python
from langchain_core.runnables import RunnableBranch, RunnableLambda

# 根据文本长度选择不同处理方式
branch = RunnableBranch(
    # (条件, 处理) 对
    (lambda x: len(x) < 10, RunnableLambda(lambda x: f"短文本：{x}")),
    (lambda x: len(x) < 50, RunnableLambda(lambda x: f"中等文本：{x[:20]}...")),
    # 默认分支（无条件）
    RunnableLambda(lambda x: f"长文本（{len(x)}字）：{x[:20]}..."),
)

print(branch.invoke("hi"))                              # 短文本：hi
print(branch.invoke("这是一段中等长度的文本内容"))        # 中等文本：这是一段中等长度的文本内容...
print(branch.invoke("这是一段很长很长的文本" * 10))       # 长文本（120字）：这是一段很长很长的文本...
```

### 3.5 RunnableSequence

管道运算符 `|` 的底层实现，也可显式创建：

```python
from langchain_core.runnables import RunnableSequence

# 以下两种写法等价
chain1 = prompt | llm | parser

chain2 = RunnableSequence(first=prompt, middle=[llm], last=parser)
```

## 4. 管道组合模式

### 4.1 基本管道

```python
# prompt → model → parser
chain = prompt | llm | parser
```

### 4.2 带预处理的管道

```python
from langchain_core.runnables import RunnableLambda

def preprocess(input_dict):
    # 预处理：清洗输入
    text = input_dict["text"].strip().lower()
    return {**input_dict, "text": text}

chain = RunnableLambda(preprocess) | prompt | llm | parser
```

### 4.3 带并行分支的管道

```python
# 输入 → 并行处理（检索 + 问题）→ 合并 → 模型 → 解析
chain = (
    {"context": retriever, "question": RunnablePassthrough()}
    | prompt
    | llm
    | parser
)
```

### 4.4 链的复用与组合

```python
# 定义可复用的子链
translator = (
    ChatPromptTemplate.from_template("翻译成{lang}：{text}")
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)

summarizer = (
    ChatPromptTemplate.from_template("用一句话总结：{text}")
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)

# 组合子链
pipeline = RunnableParallel(
    chinese=translator.partial(lang="中文"),
    english=translator.partial(lang="英文"),
    summary=summarizer,
)

result = pipeline.invoke({"text": "LangChain is a framework for LLM applications."})
```

## 5. 高级特性

### 5.1 Fallbacks（回退机制）

当主链失败时，自动切换到备选链：

```python
from langchain_openai import ChatOpenAI

# 主模型
primary = ChatOpenAI(model="gpt-4o-mini")

# 备选模型
fallback = ChatOpenAI(model="gpt-3.5-turbo")

# 配置回退
chain_with_fallback = primary.with_fallbacks([fallback])

# 如果 primary 调用失败，自动使用 fallback
result = chain_with_fallback.invoke("Hello")
```

### 5.2 Retry（重试机制）

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini", max_retries=3)

# 或使用 Runnable 的 retry
chain = prompt | llm.with_retry(
    stop_after_attempt=3,       # 最多重试3次
    wait_exponential_jitter=True,  # 指数退避
) | parser
```

### 5.3 Binding 参数

通过 `.bind()` 为模型绑定额外参数：

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini")

# 绑定 temperature
creative_llm = llm.bind(temperature=1.8)
precise_llm = llm.bind(temperature=0.1)

chain_creative = prompt | creative_llm | parser
chain_precise = prompt | precise_llm | parser
```

### 5.4 配置运行时参数

```python
from langchain_core.runnables import ConfigurableField

llm = ChatOpenAI(model="gpt-4o-mini")

# 声明可配置字段
configurable_llm = llm.configurable_fields(
    temperature=ConfigurableField(
        id="temperature",
        name="Temperature",
        description="控制输出的随机性",
    )
)

# 运行时指定
chain = prompt | configurable_llm | parser

result = chain.invoke(
    {"concept": "AI"},
    config={"configurable": {"temperature": 0.9}},
)
```

### 5.5 自定义 Runnable

```python
from langchain_core.runnables import RunnableLambda, RunnableConfig
import time

# 使用 @chain 装饰器创建自定义链
from langchain_core.runnables import chain

@chain
def custom_chain(input_dict):
    """自定义链：带计时的文本处理"""
    start = time.time()
    text = input_dict["text"].upper()
    elapsed = time.time() - start
    return {"result": text, "elapsed": elapsed}

result = custom_chain.invoke({"text": "hello"})
# {'result': 'HELLO', 'elapsed': 1.0e-05}
```

## 6. 流式输出详解

### 6.1 基本流式

```python
chain = prompt | llm | StrOutputParser()

for chunk in chain.stream({"concept": "量子计算"}):
    print(chunk, end="", flush=True)
# 逐 token 输出，体感更快
```

### 6.2 异步流式

```python
import asyncio

async def main():
    chain = prompt | llm | StrOutputParser()
    async for chunk in chain.astream({"concept": "量子计算"}):
        print(chunk, end="", flush=True)

asyncio.run(main())
```

### 6.3 事件流（astream_events）

获取链中每个组件的详细事件：

```python
chain = prompt | llm | StrOutputParser()

async def main():
    async for event in chain.astream_events(
        {"concept": "AI"},
        version="v2",
    ):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            print(event["data"]["chunk"].content, end="", flush=True)

asyncio.run(main())
```

## 7. 完整示例：带检索的问答链

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 1. 准备文档
docs = [
    "LangChain是一个用于构建LLM应用的框架",
    "LCEL是LangChain的表达式语言，使用管道运算符",
    "RAG是检索增强生成的缩写",
]

# 2. 创建向量存储
vectorstore = FAISS.from_texts(docs, OpenAIEmbeddings())
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

# 3. 构建 RAG 链
prompt = ChatPromptTemplate.from_template(
    """根据以下上下文回答问题：

上下文：{context}

问题：{question}"""
)

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)

# 4. 调用
answer = rag_chain.invoke("什么是LCEL？")
print(answer)
```

## 总结

| 概念 | 说明 |
|------|------|
| `\|` 管道运算符 | 串联组件，上游输出 → 下游输入 |
| `RunnablePassthrough` | 透传输入 |
| `RunnableLambda` | 包装函数为 Runnable |
| `RunnableParallel` | 并行执行，结果合并为字典 |
| `RunnableBranch` | 条件分支 |
| `.invoke()` | 同步调用 |
| `.batch()` | 批量并行 |
| `.stream()` | 流式输出 |
| `.ainvoke()` | 异步调用 |
| `.with_fallbacks()` | 回退机制 |
| `.bind()` | 绑定参数 |
