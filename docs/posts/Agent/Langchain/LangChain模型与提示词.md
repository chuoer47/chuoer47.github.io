---
title: LangChain模型与提示词
date: 2025-06-22
tags: [Python, LangChain, LLM, Prompt]
category: LangChain
order: 2
---

# LangChain 模型与提示词

## 1. Chat Models（聊天模型）

LangChain 将各种 LLM 封装为统一的 `BaseChatModel` 接口，切换模型只需更换导入和类名。

### 1.1 基本使用

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

# 创建模型实例
llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0.7,        # 创造性（0-2）
    max_tokens=1024,        # 最大输出 token
    timeout=30,             # 超时时间（秒）
    max_retries=2,          # 最大重试次数
)

# 方式一：传入消息列表
messages = [
    SystemMessage(content="你是一个专业的Python教师"),
    HumanMessage(content="解释什么是装饰器"),
]
response = llm.invoke(messages)
print(response.content)

# 方式二：使用元组简写
response = llm.invoke([
    ("system", "你是一个美食家"),
    ("user", "推荐一道川菜"),
])
print(response.content)
```

### 1.2 主流模型对比

| 模型 | 包 | 类名 | 特点 |
|------|-----|------|------|
| GPT-4o | `langchain-openai` | `ChatOpenAI` | 综合能力强 |
| GPT-4o-mini | `langchain-openai` | `ChatOpenAI` | 速度快、成本低 |
| Claude 3.5 Sonnet | `langchain-anthropic` | `ChatAnthropic` | 长文本、推理强 |
| Gemini 2.0 | `langchain-google-genai` | `ChatGoogleGenerativeAI` | 多模态 |
| DeepSeek | `langchain-openai` | `ChatOpenAI`(自定义base_url) | 国产、性价比高 |

### 1.3 使用不同提供商

```python
# OpenAI
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o-mini")

# Anthropic (Claude)
from langchain_anthropic import ChatAnthropic
llm = ChatAnthropic(model="claude-sonnet-4-20250514")

# Google Gemini
from langchain_google_genai import ChatGoogleGenerativeAI
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash")

# DeepSeek（通过 OpenAI 兼容接口）
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(
    model="deepseek-chat",
    base_url="https://api.deepseek.com/v1",
    api_key="sk-xxx",  # DeepSeek API Key
)
```

### 1.4 模型参数

```python
llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0.7,       # 0=确定性，2=最大随机性
    max_tokens=2048,       # 最大输出长度
    top_p=0.9,             # 核采样
    frequency_penalty=0,   # 频率惩罚（-2到2）
    presence_penalty=0,    # 存在惩罚（-2到2）
    seed=42,               # 随机种子（可复现输出）
    timeout=30,            # 请求超时
    max_retries=2,         # 重试次数
)
```

### 1.5 消息类型

```python
from langchain_core.messages import (
    SystemMessage,      # 系统指令：设定角色和行为
    HumanMessage,       # 用户消息：用户的输入
    AIMessage,          # AI 回复：模型的输出
    ToolMessage,        # 工具结果：工具调用的返回值
)

messages = [
    SystemMessage(content="你是一个翻译助手，将中文翻译成英文"),
    HumanMessage(content="今天天气真好"),
]

response = llm.invoke(messages)
print(type(response))        # AIMessage
print(response.content)      # "The weather is really nice today."
print(response.usage_tokens) # token 使用量
```

## 2. Prompt Templates（提示词模板）

### 2.1 ChatPromptTemplate

最常用的模板类型，适用于聊天模型：

```python
from langchain_core.prompts import ChatPromptTemplate

# 方式一：from_template（单条消息）
prompt = ChatPromptTemplate.from_template(
    "请将以下文本翻译成{language}：{text}"
)
messages = prompt.invoke({"language": "英文", "text": "你好世界"})
print(messages)
# ChatPromptValue(messages=[HumanMessage(content='请将以下文本翻译成英文：你好世界')])
```

```python
# 方式二：from_messages（多条消息）
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个专业的{domain}顾问"),
    ("human", "请解释什么是{concept}"),
    ("ai", "好的，我来解释一下{concept}："),
    ("human", "请用简单的语言，举个例子"),
])

messages = prompt.invoke({
    "domain": "金融",
    "concept": "复利",
})
```

```python
# 方式三：带变量的消息列表
prompt = ChatPromptTemplate.from_messages([
    SystemMessage(content="你是一个{role}"),
    ("user", "{input}"),
])

# 模板中的变量自动从 invoke 的 dict 中提取
result = prompt.invoke({"role": "厨师", "input": "怎么做红烧肉"})
```

### 2.2 Few-Shot Prompt（少样本提示）

通过提供示例来引导模型输出格式：

```python
from langchain_core.prompts import ChatPromptTemplate, FewShotChatMessagePromptTemplate

# 定义示例
examples = [
    {"input": "开心", "output": "😊"},
    {"input": "难过", "output": "😢"},
    {"input": "生气", "output": "😠"},
]

# 示例模板
example_prompt = ChatPromptTemplate.from_messages([
    ("human", "{input}"),
    ("ai", "{output}"),
])

# Few-Shot 模板
few_shot_prompt = FewShotChatMessagePromptTemplate(
    example_prompt=example_prompt,
    examples=examples,
)

# 完整提示词
prompt = ChatPromptTemplate.from_messages([
    ("system", "将情感词转换为对应的emoji"),
    few_shot_prompt,
    ("human", "{input}"),
])

result = prompt.invoke({"input": "惊讶"})
print(result)
```

### 2.3 MessagesPlaceholder（消息占位符）

用于动态插入消息列表，常用于对话历史：

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个有帮助的助手"),
    MessagesPlaceholder("history"),      # 插入历史消息
    ("human", "{input}"),
])

# 模拟对话历史
from langchain_core.messages import HumanMessage, AIMessage

history = [
    HumanMessage(content="我叫张三"),
    AIMessage(content="你好张三！有什么我可以帮助你的吗？"),
]

result = prompt.invoke({
    "history": history,
    "input": "你还记得我叫什么名字吗？",
})

print(result.messages)
```

### 2.4 常用提示词技巧

```python
# 1. 角色设定 + 任务描述 + 输出格式
prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个资深的代码审查专家。

请按照以下格式审查代码：
## 问题
- 列出发现的问题

## 建议
- 给出改进建议

## 评分
给出 1-10 分"""),
    ("human", "请审查以下Python代码：\n```python\n{code}\n```"),
])

# 2. 链式思考（Chain of Thought）
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个数学解题助手。请一步一步地思考问题。"),
    ("human", "问题：{question}\n\n请先分析题目，然后逐步推理，最后给出答案。"),
])

# 3. 输出格式约束
prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个信息提取助手。
请从文本中提取人名、地点和日期，以JSON格式返回。

示例输出：
{{"names": ["张三"], "locations": ["北京"], "dates": ["2024年1月"]}}"""),
    ("human", "{text}"),
])
```

## 3. Output Parsers（输出解析器）

### 3.1 StrOutputParser

最简单，直接提取模型输出的文本：

```python
from langchain_core.output_parsers import StrOutputParser

parser = StrOutputParser()

# 解析 AIMessage
from langchain_core.messages import AIMessage
result = parser.invoke(AIMessage(content="你好世界"))
print(result)  # "你好世界"
```

### 3.2 JsonOutputParser

强制模型输出 JSON：

```python
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.pydantic_v1 import BaseModel, Field

# 定义输出结构
class MovieReview(BaseModel):
    title: str = Field(description="电影名称")
    rating: float = Field(description="评分，0-10")
    summary: str = Field(description="一句话评价")

parser = JsonOutputParser(pydantic_object=MovieReview)

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个影评人。{format_instructions}"),
    ("human", "请评价电影《{movie}》"),
])

# 将格式说明注入提示词
chain = prompt.partial(
    format_instructions=parser.get_format_instructions()
) | llm | parser

result = chain.invoke({"movie": "肖申克的救赎"})
print(result)
# {'title': '肖申克的救赎', 'rating': 9.7, 'summary': '...'}
```

### 3.3 PydanticOutputParser

使用 Pydantic 模型定义严格的输出结构：

```python
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.pydantic_v1 import BaseModel, Field
from typing import List

class Person(BaseModel):
    name: str = Field(description="姓名")
    age: int = Field(description="年龄")
    hobbies: List[str] = Field(description="爱好列表")

parser = PydanticOutputParser(pydantic_object=Person)

prompt = ChatPromptTemplate.from_messages([
    ("system", "从文本中提取人物信息。\n{format_instructions}"),
    ("human", "{text}"),
])

chain = prompt.partial(
    format_instructions=parser.get_format_instructions()
) | llm | parser

result = chain.invoke({"text": "小明今年25岁，喜欢打篮球和看电影"})
print(result.name)    # "小明"
print(result.age)     # 25
print(result.hobbies) # ["打篮球", "看电影"]
```

### 3.4 StructuredOutput（推荐方式）

v0.3 推荐的结构化输出方式，更简洁：

```python
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from typing import List

class Recipe(BaseModel):
    name: str = Field(description="菜名")
    ingredients: List[str] = Field(description="食材列表")
    steps: List[str] = Field(description="步骤列表")
    cook_time: int = Field(description="烹饪时间（分钟）")

# 直接在模型上绑定输出结构
llm = ChatOpenAI(model="gpt-4o-mini")
structured_llm = llm.with_structured_output(Recipe)

# 调用后直接返回 Pydantic 对象
result = structured_llm.invoke("教我做番茄炒蛋")
print(result.name)         # "番茄炒蛋"
print(result.ingredients)  # ["番茄", "鸡蛋", ...]
print(result.cook_time)    # 10
```

## 4. 综合示例：构建一个翻译链

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

# 1. 定义提示词
prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个专业的翻译专家。
规则：
- 翻译要自然流畅，符合目标语言的表达习惯
- 保留原文的语气和风格
- 专有名词首次出现时附带原文"""),
    ("human", "请将以下{source_language}文本翻译成{target_language}：\n\n{text}"),
])

# 2. 创建模型
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)

# 3. 组合链
chain = prompt | llm | StrOutputParser()

# 4. 调用
result = chain.invoke({
    "source_language": "英文",
    "target_language": "中文",
    "text": "The quick brown fox jumps over the lazy dog.",
})
print(result)
# "敏捷的棕色狐狸跳过了懒惰的狗。"
```

## 总结

| 组件 | 作用 | 常用类 |
|------|------|--------|
| Chat Models | 调用大语言模型 | `ChatOpenAI`、`ChatAnthropic` |
| Prompt Templates | 构建结构化提示词 | `ChatPromptTemplate` |
| Output Parsers | 解析模型输出 | `StrOutputParser`、`PydanticOutputParser` |
| Structured Output | 强制结构化输出 | `with_structured_output()` |
| Messages | 消息类型 | `HumanMessage`、`SystemMessage`、`AIMessage` |
