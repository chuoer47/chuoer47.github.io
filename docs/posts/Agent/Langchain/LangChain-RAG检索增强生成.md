---
title: LangChain-RAG检索增强生成
date: 2025-06-22
tags: [Python, LangChain, RAG, 向量数据库]
category: LangChain
order: 4
---

# LangChain RAG 检索增强生成

## 1. 什么是 RAG

RAG（Retrieval-Augmented Generation，检索增强生成）是一种将外部知识注入 LLM 的技术。核心思路：**先检索相关文档，再将文档作为上下文交给 LLM 生成回答**。

### 为什么需要 RAG

| 问题 | 解决方案 |
|------|---------|
| LLM 知识有截止日期 | RAG 注入最新数据 |
| LLM 不了解私有数据 | RAG 连接企业知识库 |
| LLM 会"幻觉" | RAG 提供事实依据 |
| Fine-tuning 成本高 | RAG 无需训练，即插即用 |

### RAG 流程

```
用户提问
    ↓
┌─────────────────────┐
│ 1. 文档加载          │  加载 PDF/网页/数据库等
│ 2. 文本分割          │  切成小块（chunks）
│ 3. 向量化（Embedding）│  转为向量表示
│ 4. 存入向量数据库     │  FAISS / Chroma / Pinecone
└─────────────────────┘
    ↓
┌─────────────────────┐
│ 5. 用户提问向量化     │  将问题转为向量
│ 6. 相似度检索         │  找到最相关的 k 个文档块
│ 7. 构建 Prompt       │  将文档 + 问题组合成提示词
│ 8. LLM 生成回答      │  基于上下文回答
└─────────────────────┘
```

## 2. 文档加载（Document Loaders）

LangChain 提供了上百种文档加载器，覆盖常见数据源。

### 2.1 文本文件

```python
from langchain_community.document_loaders import TextLoader

loader = TextLoader("data.txt", encoding="utf-8")
docs = loader.load()

print(len(docs))         # 文档数量
print(docs[0].page_content)  # 文档内容
print(docs[0].metadata)      # {'source': 'data.txt'}
```

### 2.2 PDF 文件

```python
from langchain_community.document_loaders import PyPDFLoader

loader = PyPDFLoader("report.pdf")
docs = loader.load()

# 每页是一个 Document
for doc in docs:
    print(f"第{doc.metadata['page']+1}页: {doc.page_content[:100]}...")
```

:::tip
需要安装依赖：`pip install pypdf`
:::

### 2.3 网页

```python
from langchain_community.document_loaders import WebBaseLoader

loader = WebBaseLoader("https://example.com/article")
docs = loader.load()

print(docs[0].page_content)
```

:::tip
需要安装依赖：`pip install beautifulsoup4`
:::

### 2.4 CSV 文件

```python
from langchain_community.document_loaders import CSVLoader

loader = CSVLoader("data.csv", encoding="utf-8")
docs = loader.load()
```

### 2.5 目录批量加载

```python
from langchain_community.document_loaders import DirectoryLoader, TextLoader

loader = DirectoryLoader(
    "./docs/",
    glob="**/*.md",          # 匹配所有 .md 文件
    loader_cls=TextLoader,
    loader_kwargs={"encoding": "utf-8"},
    show_progress=True,
)
docs = loader.load()
print(f"共加载 {len(docs)} 个文档")
```

### 2.6 常用加载器一览

| 加载器 | 数据源 | 依赖 |
|--------|--------|------|
| `TextLoader` | 纯文本 | 无 |
| `PyPDFLoader` | PDF | `pypdf` |
| `WebBaseLoader` | 网页 | `beautifulsoup4` |
| `CSVLoader` | CSV | 无 |
| `DirectoryLoader` | 本地目录 | 无 |
| `JSONLoader` | JSON | `jq` |
| `NotionDirectoryLoader` | Notion | 无 |
| `GitLoader` | Git 仓库 | `gitpython` |

## 3. 文本分割（Text Splitters）

文档需要分割成合适大小的块（chunks），才能有效检索和处理。

### 3.1 RecursiveCharacterTextSplitter（推荐）

最常用的分割器，按递归分隔符分割：

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,        # 每块最大字符数
    chunk_overlap=50,      # 块之间的重叠字符数
    length_function=len,
    separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""],
)

text = "这是一篇很长的文章..." * 100
chunks = splitter.split_text(text)

print(f"分割为 {len(chunks)} 块")
print(f"第一块：{chunks[0][:100]}...")
```

```python
# 分割 Document 对象
from langchain_core.documents import Document

docs = [Document(page_content="很长的文本内容...", metadata={"source": "test"})]
chunks = splitter.split_documents(docs)
```

### 3.2 中文文本分割

```python
# 针对中文优化的分割器
splitter = RecursiveCharacterTextSplitter(
    chunk_size=300,
    chunk_overlap=30,
    separators=["\n\n", "\n", "。", "！", "？", "；", "，", "、", " ", ""],
)
```

### 3.3 Markdown 分割

```python
from langchain_text_splitters import MarkdownTextSplitter

splitter = MarkdownTextSplitter(chunk_size=1000, chunk_overlap=100)
chunks = splitter.split_text(markdown_text)
```

### 3.4 代码分割

```python
from langchain_text_splitters import (
    PythonCodeTextSplitter,
    RecursiveCharacterTextSplitter,
)

# Python 代码分割
splitter = PythonCodeTextSplitter(chunk_size=1000, chunk_overlap=100)
chunks = splitter.split_text(python_code)

# 通用语言分割
splitter = RecursiveCharacterTextSplitter.from_language(
    language="java",
    chunk_size=1000,
    chunk_overlap=100,
)
```

### 3.5 分割策略对比

| 分割器 | 适用场景 | 特点 |
|--------|---------|------|
| `RecursiveCharacterTextSplitter` | 通用文本 | 递归分隔，推荐首选 |
| `MarkdownTextSplitter` | Markdown | 按标题和段落分割 |
| `PythonCodeTextSplitter` | Python 代码 | 按函数/类分割 |
| `TokenTextSplitter` | 精确控制 token | 按 token 数分割 |

## 4. Embeddings（文本向量化）

Embedding 将文本转换为数值向量，语义相似的文本在向量空间中距离更近。

### 4.1 OpenAI Embeddings

```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# 单条文本
vector = embeddings.embed_query("什么是机器学习？")
print(f"向量维度：{len(vector)}")  # 1536

# 批量文本
vectors = embeddings.embed_documents(["文本1", "文本2", "文本3"])
print(f"数量：{len(vectors)}")  # 3
```

### 4.2 本地 Embeddings（免费）

```python
from langchain_community.embeddings import HuggingFaceEmbeddings

# 使用 HuggingFace 上的开源模型（完全免费，本地运行）
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-zh-v1.5",  # 中文小模型
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True},
)

vector = embeddings.embed_query("你好世界")
```

:::tip
需要安装：`pip install sentence-transformers`，首次运行会自动下载模型。
:::

### 4.3 Embedding 模型对比

| 模型 | 维度 | 语言 | 费用 | 特点 |
|------|------|------|------|------|
| `text-embedding-3-small` | 1536 | 多语言 | 付费 | 质量好，速度快 |
| `text-embedding-3-large` | 3072 | 多语言 | 付费 | 质量最好 |
| `bge-small-zh-v1.5` | 512 | 中文 | 免费 | 本地运行，中文优化 |
| `bge-large-zh-v1.5` | 1024 | 中文 | 免费 | 本地运行，质量更好 |
| `all-MiniLM-L6-v2` | 384 | 英文 | 免费 | 体积小，速度快 |

## 5. 向量存储（Vector Stores）

### 5.1 FAISS（推荐入门）

Facebook 开源的向量检索库，纯本地，无需外部服务：

```python
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings

# 从文本创建
texts = ["LangChain是一个LLM框架", "RAG是检索增强生成", "FAISS是向量数据库"]
metadatas = [{"source": "doc1"}, {"source": "doc2"}, {"source": "doc3"}]

vectorstore = FAISS.from_texts(
    texts=texts,
    embedding=OpenAIEmbeddings(),
    metadatas=metadatas,
)

# 相似度搜索
results = vectorstore.similarity_search("什么是LangChain？", k=2)
for doc in results:
    print(f"{doc.page_content} ({doc.metadata})")
```

```python
# 从 Document 对象创建
from langchain_core.documents import Document

docs = [
    Document(page_content="内容1", metadata={"source": "a"}),
    Document(page_content="内容2", metadata={"source": "b"}),
]
vectorstore = FAISS.from_documents(docs, OpenAIEmbeddings())

# 保存到磁盘
vectorstore.save_local("faiss_index")

# 从磁盘加载
vectorstore = FAISS.load_local("faiss_index", OpenAIEmbeddings())
```

:::tip
需要安装：`pip install faiss-cpu`（CPU 版）或 `pip install faiss-gpu`（GPU 版）
:::

### 5.2 Chroma（轻量级）

嵌入式向量数据库，支持持久化：

```python
from langchain_community.vectorstores import Chroma

vectorstore = Chroma.from_texts(
    texts=["文本1", "文本2"],
    embedding=OpenAIEmbeddings(),
    persist_directory="./chroma_db",  # 持久化目录
)

results = vectorstore.similarity_search("查询", k=2)
```

:::tip
需要安装：`pip install chromadb`
:::

### 5.3 向量数据库对比

| 数据库 | 类型 | 持久化 | 适用场景 |
|--------|------|--------|---------|
| FAISS | 库 | 手动保存 | 本地开发、研究 |
| Chroma | 嵌入式 | 自动 | 小型项目、原型 |
| Pinecone | 云服务 | 自动 | 生产环境 |
| Weaviate | 自托管/云 | 自动 | 大规模生产 |
| Milvus | 自托管 | 自动 | 大规模生产 |

## 6. 检索器（Retrievers）

### 6.1 基本检索

```python
# 从向量存储创建检索器
retriever = vectorstore.as_retriever(
    search_type="similarity",    # 检索类型
    search_kwargs={"k": 3},      # 返回前3个结果
)

# 检索
docs = retriever.invoke("什么是RAG？")
for doc in docs:
    print(doc.page_content)
```

### 6.2 检索类型

```python
# 1. 相似度检索（默认）
retriever = vectorstore.as_retriever(search_type="similarity")

# 2. MMR 检索（最大边际相关性，结果更多样）
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={"k": 3, "fetch_k": 10},
)

# 3. 带分数阈值的检索
retriever = vectorstore.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"score_threshold": 0.7, "k": 5},
)
```

### 6.3 MMR vs 相似度

```python
# 相似度检索：返回最相似的结果，可能高度重复
# MMR 检索：在相似度和多样性之间取平衡

# 适用场景：
# - 精确问答 → similarity
# - 探索性搜索 → mmr（结果更多样）
```

## 7. 构建完整 RAG 链

### 7.1 基本 RAG 链

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader

# 1. 加载文档
loader = TextLoader("knowledge.txt", encoding="utf-8")
docs = loader.load()

# 2. 分割文本
splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
chunks = splitter.split_documents(docs)

# 3. 创建向量存储
vectorstore = FAISS.from_documents(chunks, OpenAIEmbeddings())

# 4. 创建检索器
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 5. 构建提示词
prompt = ChatPromptTemplate.from_template("""
你是一个专业的问答助手。请根据以下参考文档回答问题。
如果参考文档中没有相关信息，请直接说"我无法从已有知识中找到答案"。

参考文档：
{context}

问题：{question}
""")

# 6. 格式化文档
def format_docs(docs):
    return "\n\n---\n\n".join(doc.page_content for doc in docs)

# 7. 组合 RAG 链
rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)

# 8. 调用
answer = rag_chain.invoke("什么是LangChain？")
print(answer)
```

### 7.2 带引用的 RAG

```python
from langchain_core.runnables import RunnableParallel

# 同时返回答案和引用来源
rag_chain_with_sources = RunnableParallel(
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser(),
    sources=retriever,
)

result = rag_chain_with_sources.invoke("什么是RAG？")
print("答案：", result["answer"])
print("来源：", [doc.metadata["source"] for doc in result["sources"]])
```

### 7.3 多轮对话 RAG

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage

prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个专业的问答助手。根据以下文档回答问题。
如果文档中没有相关信息，请说"我无法从已有知识中找到答案"。

文档：
{context}"""),
    MessagesPlaceholder("chat_history"),
    ("human", "{question}"),
])

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough(), "chat_history": lambda x: chat_history}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)

# 维护对话历史
chat_history = []

def chat(question):
    answer = rag_chain.invoke({"question": question, "chat_history": chat_history})
    chat_history.append(HumanMessage(content=question))
    chat_history.append(AIMessage(content=answer))
    return answer

print(chat("什么是LangChain？"))
print(chat("它有什么优势？"))  # 能理解"它"指的是 LangChain
```

## 8. 评估与优化

### 8.1 常见问题与优化

| 问题 | 原因 | 优化方案 |
|------|------|---------|
| 检索不到相关内容 | chunk_size 太大或太小 | 调整 chunk_size 和 chunk_overlap |
| 回答不准确 | prompt 不够明确 | 优化 prompt，增加约束 |
| 回答包含幻觉 | 模型未参考文档 | 在 prompt 中强调"根据文档" |
| 检索结果重复 | 缺乏多样性 | 使用 MMR 检索 |

### 8.2 Chunk Size 调优

```python
# 过小（<200）：上下文碎片化，语义不完整
# 过大（>2000）：噪声多，检索精度低
# 推荐：500-1000 字符（中文）

# chunk_overlap 通常为 chunk_size 的 10%-20%
```

### 8.3 混合检索

```python
# 结合关键词检索和语义检索
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

# BM25 关键词检索
bm25_retriever = BM25Retriever.from_texts(texts)
bm25_retriever.k = 3

# 向量语义检索
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 混合检索
ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6],  # 权重
)
```

## 总结

| 步骤 | 组件 | 作用 |
|------|------|------|
| 文档加载 | `DocumentLoader` | 加载各种格式的数据 |
| 文本分割 | `TextSplitter` | 将文档切成合适大小的块 |
| 向量化 | `Embeddings` | 将文本转为向量 |
| 存储检索 | `VectorStore` + `Retriever` | 存储和检索向量 |
| 生成回答 | `Prompt` + `LLM` | 基于上下文生成回答 |
