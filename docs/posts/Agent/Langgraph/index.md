---
title: LangGraph
date: 2025-06-22
tags: [Python, LangGraph, Agent, AI]
category: 开发
description: LangGraph 从入门到精通的完整教程系列
order: 60
---

# LangGraph 教程

LangGraph 是 LangChain 团队推出的**有状态、可编排的 AI Agent 框架**，基于图（Graph）结构构建复杂的多步骤、多 Agent 工作流。本系列教程从核心概念到生产部署，全面覆盖 LangGraph 的方方面面。

<!-- more -->

## 教程目录

1. **[LangGraph 概述与核心概念](./01-LangGraph概述与核心概念)** — 什么是 LangGraph、为什么需要它、核心抽象与架构设计
2. **[状态管理与类型系统](./02-状态管理与类型系统)** — TypedDict / Pydantic 状态定义、Annotated Reducer、消息管理
3. **[节点与边的高级用法](./03-节点与边的高级用法)** — 条件路由、Send API、Map-Reduce、子图嵌套
4. **[ReAct Agent 与工具集成](./04-ReAct%20Agent与工具集成)** — ReAct 循环、ToolNode、create_react_agent、自定义 Agent
5. **[持久化与检查点](./05-持久化与检查点)** — Checkpointer 机制、MemorySaver、SQLite/Postgres、时间旅行
6. **[人机交互（Human-in-the-Loop）](./06-人机交互)** — interrupt 机制、审批工作流、断点恢复
7. **[多 Agent 协作](./07-多Agent协作)** — Supervisor、Swarm、子图嵌套、Agent 通信模式
8. **[LangGraph Platform 与部署](./08-LangGraph%20Platform与部署)** — 部署架构、API 服务、LangSmith 集成、生产最佳实践

## 适用人群

- 有 Python 基础，了解 LangChain 基本概念的开发者
- 希望构建复杂 Agent 工作流（多步骤推理、多 Agent 协作、人机交互）的工程师
- 需要将 AI Agent 部署到生产环境的技术团队

## 技术栈

| 组件 | 版本 |
|------|------|
| Python | >= 3.9 |
| LangGraph | >= 0.2 |
| LangChain | >= 0.3 |
| LangSmith | 可选（调试/追踪） |
