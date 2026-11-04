---
title: "黑马商城 Hmall-Monolith"
date: 2025-06-22
---

> GitHub: [Hmall-Monolith](https://github.com/chuoer47/Hmall-Monolith)

## 项目简介

黑马商城是一个基于**单体架构**的电子商务平台，主要帮助学习黑马商城微服务的初学者快速了解和部署该项目。

项目涵盖了电商系统的核心功能模块：商品展示、用户管理、购物车、订单处理、支付集成等，是一个功能完整、适合学习和练手的单体项目。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Spring Boot、MyBatis-Plus |
| 数据库 | MySQL、Redis |
| 安全框架 | Spring Security |
| API 文档 | Swagger / OpenAPI |
| 部署 | Nginx、Docker（可选） |

## 快速开始

### 1. 准备数据库

创建数据库后，导入项目 `mysql` 文件夹中的 SQL 文件。

### 2. 修改后端配置

编辑 `application_dev.yml`，根据本地环境修改数据库连接等配置。

### 3. 配置 Redis（可选）

项目支持 Redis 缓存，如不需要可跳过，但建议配置以获得更好的性能体验。

### 4. 启动后端

构建并运行 Spring Boot 项目，默认端口 `8080`。

### 5. 启动前端

安装前端依赖并启动，默认访问地址为 `http://localhost:18080`。

## 访问地址

| 服务 | 地址 |
|------|------|
| 前端页面 | http://localhost:18080 |
| API 文档 | http://localhost:8080/doc.html |

**默认账号：** jack / 123

## 写在后面

作为单体架构的电商项目，Hmall-Monolith 非常适合 Java 初学者入门。整个项目结构清晰，功能完整，从用户注册登录、商品浏览到下单支付，覆盖了一个电商系统的完整业务流程。如果你正在学习 Spring Boot + MyBatis-Plus 的开发，这个项目会是一个不错的实战练习。
