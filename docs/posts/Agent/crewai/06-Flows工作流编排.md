---
title: Flows工作流编排
date: 2025-06-22
tags: [Python, CrewAI, Flows, 工作流, 事件驱动]
category: CrewAI
order: 6
---

# Flows 工作流编排

## 1. Flows 概述

Flows 是 CrewAI 的工作流编排框架，用于将多个 Crew 和任务组织成复杂的端到端工作流。如果说 Crew 是"一个团队完成一个项目"，那么 Flow 就是"多个团队协作完成一个大型工程"。

### 为什么需要 Flows

| 场景 | 仅用 Crew | 使用 Flows |
|------|----------|-----------|
| 简单流水线 | ✅ Sequential 够用 | 没必要 |
| 需要条件分支 | ❌ 无法实现 | ✅ `@router` |
| 多 Crew 串联 | ⚠️ 手动拼接 | ✅ 声明式编排 |
| 并行 + 汇合 | ❌ 不支持 | ✅ `@and_` / `@or_` |
| 状态管理 | ❌ 无状态 | ✅ Pydantic State |
| 人类审批节点 | ⚠️ 不优雅 | ✅ 条件路由 |

### 核心概念

```
┌─────────────────────────────────────────────┐
│                    Flow                     │
│                                             │
│   @start()     → 入口方法                    │
│   @listen()    → 监听上游完成事件              │
│   @router()    → 条件路由                    │
│   @or_()       → 任一事件触发                 │
│   @and_()      → 全部事件触发                 │
│   @persist     → 状态持久化                   │
│                                             │
│   State (Pydantic) → 跨步骤共享状态            │
│                                             │
│   Flow 可以包含多个 Crew                      │
└─────────────────────────────────────────────┘
```

## 2. Flow 基础

### 2.1 最简示例

```python
from crewai.flow.flow import Flow, listen, start

class SimpleFlow(Flow):

    @start()
    def begin(self):
        print("Flow 开始！")
        return "Hello"

    @listen(begin)
    def step_two(self, data):
        print(f"收到: {data}")
        return f"{data} World"

flow = SimpleFlow()
result = flow.kickoff()
print(result)  # "Hello World"
```

### 2.2 带状态的 Flow

```python
from crewai.flow.flow import Flow, listen, start
from pydantic import BaseModel

# 定义状态模型
class FlowState(BaseModel):
    topic: str = ""
    research: str = ""
    article: str = ""
    word_count: int = 0

class ContentFlow(Flow[FlowState]):

    @start()
    def set_topic(self):
        self.state.topic = "AI Agent 框架对比"
        return self.state.topic

    @listen(set_topic)
    def research(self, topic):
        # 调用 Crew 进行调研
        crew_result = self.research_crew.kickoff(inputs={"topic": topic})
        self.state.research = crew_result.raw
        return self.state.research

    @listen(research)
    def write_article(self, research):
        # 调用 Crew 撰写文章
        crew_result = self.writer_crew.kickoff(inputs={"research": research})
        self.state.article = crew_result.raw
        self.state.word_count = len(self.state.article)
        return self.state.article

flow = ContentFlow()
result = flow.kickoff()
print(f"文章字数: {flow.state.word_count}")
```

## 3. 核心装饰器详解

### 3.1 `@start()` — 入口

标记 Flow 的起始方法。一个 Flow 可以有多个 `@start()` 方法，它们会并行执行：

```python
class MyFlow(Flow):

    @start()
    def init_research(self):
        return "调研数据"

    @start()
    def init_config(self):
        return {"language": "zh"}
```

### 3.2 `@listen()` — 事件监听

监听指定方法完成后的事件：

```python
class MyFlow(Flow):

    @start()
    def step_one(self):
        return "data"

    @listen(step_one)
    def step_two(self, data):
        # data 是 step_one 的返回值
        return f"处理: {data}"

    @listen(step_two)
    def step_three(self, data):
        return f"最终: {data}"
```

也可以用字符串引用方法名：

```python
@listen("step_one")
def step_two(self, data):
    ...
```

### 3.3 `@router()` — 条件路由

根据返回值路由到不同的处理路径：

```python
class ApprovalFlow(Flow[FlowState]):

    @start()
    def generate_content(self):
        # 生成内容
        return "生成的内容"

    @router(generate_content)
    def review(self, content):
        # 审核并返回路由键
        if len(content) > 1000:
            return "approved"
        return "needs_revision"

    @listen("approved")
    def publish(self):
        print("内容已发布！")

    @listen("needs_revision")
    def revise(self):
        print("需要修改...")
```

路由逻辑图：

```
generate_content
       │
       ▼
    review ──────┬──→ "approved" ──→ publish()
                 │
                 └──→ "needs_revision" ──→ revise()
```

### 3.4 `@or_()` — 任一触发

当监听的多个事件中**任意一个**完成时触发：

```python
from crewai.flow.flow import Flow, listen, start, or_

class OrFlow(Flow):

    @start()
    def fast_path(self):
        return "快速路径"

    @start()
    def slow_path(self):
        import time
        time.sleep(2)
        return "慢速路径"

    @listen(or_("fast_path", "slow_path"))
    def on_any_complete(self, data):
        # 任意一个完成就触发
        print(f"收到: {data}")
```

### 3.5 `@and_()` — 全部触发

当监听的多个事件**全部完成**后才触发：

```python
from crewai.flow.flow import Flow, listen, start, and_

class AndFlow(Flow):

    @start()
    def task_a(self):
        return "A 完成"

    @start()
    def task_b(self):
        return "B 完成"

    @listen(and_("task_a", "task_b"))
    def on_both_complete(self):
        # A 和 B 都完成才触发
        print("A 和 B 都完成了！")
```

## 4. Flow 中集成 Crew

### 4.1 基本集成

```python
from crewai import Agent, Task, Crew, Process
from crewai.flow.flow import Flow, listen, start

class ResearchFlow(Flow):

    def create_research_crew(self, topic):
        researcher = Agent(
            role="研究员",
            goal=f"深入调研 {topic}",
            backstory="资深研究员"
        )

        task = Task(
            description=f"调研 {topic} 的最新进展",
            expected_output="调研报告",
            agent=researcher
        )

        return Crew(
            agents=[researcher],
            tasks=[task],
            process=Process.sequential
        )

    @start()
    def begin(self):
        topic = "大语言模型"
        crew = self.create_research_crew(topic)
        result = crew.kickoff()
        return result.raw

flow = ResearchFlow()
result = flow.kickoff()
```

### 4.2 多 Crew 串联

```python
class MultiCrewFlow(Flow[FlowState]):

    @start()
    def research_phase(self):
        """阶段 1：调研"""
        crew = self._build_research_crew()
        result = crew.kickoff(inputs={"topic": self.state.topic})
        self.state.research = result.raw
        return result.raw

    @listen(research_phase)
    def analysis_phase(self, research):
        """阶段 2：分析"""
        crew = self._build_analysis_crew()
        result = crew.kickoff(inputs={"data": research})
        self.state.analysis = result.raw
        return result.raw

    @listen(analysis_phase)
    def writing_phase(self, analysis):
        """阶段 3：撰写"""
        crew = self._build_writing_crew()
        result = crew.kickoff(inputs={"analysis": analysis})
        self.state.article = result.raw
        return result.raw
```

### 4.3 条件分支 + 不同 Crew

```python
class AdaptiveFlow(Flow):

    @start()
    def classify(self):
        # 分类任务类型
        task_type = "research"  # 实际中由 LLM 判断
        return task_type

    @router(classify)
    def route_by_type(self, task_type):
        return task_type

    @listen("research")
    def handle_research(self):
        crew = self._build_research_crew()
        return crew.kickoff().raw

    @listen("analysis")
    def handle_analysis(self):
        crew = self._build_analysis_crew()
        return crew.kickoff().raw

    @listen("coding")
    def handle_coding(self):
        crew = self._build_coding_crew()
        return crew.kickoff().raw
```

## 5. 状态持久化

### 5.1 `@persist` 装饰器

```python
from crewai.flow.flow import Flow, listen, start, persist

@persist  # 启用自动状态持久化
class PersistentFlow(Flow[FlowState]):

    @start()
    def begin(self):
        self.state.topic = "AI"
        return "started"

    @listen(begin)
    def process(self, data):
        self.state.research = "调研结果"
        return "done"
```

### 5.2 状态恢复

```python
# Flow 执行中断后，可以从上次的状态恢复
flow = PersistentFlow()
flow.kickoff()  # 自动恢复到上次的状态
```

## 6. Flow 可视化

```python
flow = MyFlow()
flow.plot()  # 生成 Flow 结构的可视化图表
```

## 7. 完整示例：智能内容生产流水线

```python
from crewai import Agent, Task, Crew, Process
from crewai.flow.flow import Flow, listen, start, router, and_
from pydantic import BaseModel
from typing import Optional

# === 状态定义 ===
class ContentState(BaseModel):
    topic: str = ""
    research_data: str = ""
    outline: str = ""
    draft: str = ""
    review_feedback: str = ""
    final_article: str = ""
    status: str = "pending"

# === Flow 定义 ===
@persist
class ContentPipeline(Flow[ContentState]):

    # --- 阶段 1：调研 ---
    @start()
    def research(self):
        researcher = Agent(
            role="资深研究员",
            goal="深入调研指定主题",
            backstory="15 年研究经验，擅长多源信息交叉验证"
        )
        task = Task(
            description=f"调研 {self.state.topic}，收集权威数据和案例",
            expected_output="结构化的调研报告",
            agent=researcher
        )
        crew = Crew(agents=[researcher], tasks=[task])
        result = crew.kickoff()
        self.state.research_data = result.raw
        return result.raw

    # --- 阶段 2：大纲 + 调研并行完成后进入写作 ---
    @listen(research)
    def create_outline(self, research):
        planner = Agent(
            role="内容策划师",
            goal="制定内容大纲",
            backstory="资深内容策划师"
        )
        task = Task(
            description="基于调研结果制定文章大纲",
            expected_output="文章大纲",
            agent=planner
        )
        crew = Crew(agents=[planner], tasks=[task])
        result = crew.kickoff()
        self.state.outline = result.raw
        return result.raw

    # --- 阶段 3：撰写 ---
    @listen(create_outline)
    def write_draft(self, outline):
        writer = Agent(
            role="技术写手",
            goal="撰写高质量技术文章",
            backstory="知名技术博主"
        )
        task = Task(
            description="根据大纲撰写完整文章",
            expected_output="完整的技术文章",
            agent=writer
        )
        crew = Crew(agents=[writer], tasks=[task])
        result = crew.kickoff()
        self.state.draft = result.raw
        return result.raw

    # --- 阶段 4：审核路由 ---
    @router(write_draft)
    def review(self, draft):
        reviewer = Agent(
            role="内容审核员",
            goal="审核文章质量",
            backstory="资深编辑"
        )
        task = Task(
            description="审核文章，给出通过或修改意见",
            expected_output="审核结果：APPROVED 或具体修改意见",
            agent=reviewer
        )
        crew = Crew(agents=[reviewer], tasks=[task])
        result = crew.kickoff().raw

        if "APPROVED" in result.upper():
            self.state.status = "approved"
            return "approved"
        else:
            self.state.review_feedback = result
            self.state.status = "revision_needed"
            return "revise"

    # --- 路由 A：通过 → 发布 ---
    @listen("approved")
    def publish(self):
        self.state.final_article = self.state.draft
        self.state.status = "published"
        return self.state.final_article

    # --- 路由 B：修改 → 重写 → 再审核 ---
    @listen("revise")
    def revise_draft(self):
        writer = Agent(
            role="技术写手",
            goal="根据反馈修改文章",
            backstory="资深写手"
        )
        task = Task(
            description=f"根据以下反馈修改文章：\n{self.state.review_feedback}",
            expected_output="修改后的文章",
            agent=writer
        )
        crew = Crew(agents=[writer], tasks=[task])
        result = crew.kickoff()
        self.state.draft = result.raw
        return result.raw

# === 运行 ===
flow = ContentPipeline()
flow.state.topic = "CrewAI 多智能体框架深度解析"
result = flow.kickoff()
print(f"状态: {flow.state.status}")
print(f"文章长度: {len(flow.state.final_article)} 字")
```

## 总结

| 知识点 | 要点 |
|--------|------|
| Flow 定位 | 多 Crew 编排，事件驱动工作流 |
| `@start()` | 入口方法，可多个并行 |
| `@listen()` | 监听上游事件，接收返回值 |
| `@router()` | 条件路由，按返回值分支 |
| `@or_()` / `@and_()` | 任一触发 / 全部触发 |
| `@persist` | 状态自动持久化 |
| State | Pydantic 模型，跨步骤共享状态 |
| 集成 Crew | 每个方法中可创建和运行独立 Crew |
