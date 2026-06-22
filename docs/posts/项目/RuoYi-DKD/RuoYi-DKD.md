---
title: "RuoYi-DKD 自动售货机系统"
date: 2025-06-22
---

> GitHub: [RuoYi-DKD](https://github.com/chuoer47/RuoYi-DKD)

## 项目简介

RuoYi-DKD 是基于 [RuoYi](https://github.com/yangzongzhuan/RuoYi) 框架进行二次开发的**自动售货机管理系统**。

项目利用若依强大的基础能力（权限管理、代码生成、系统监控等），在此基础上实现了售货机业务的完整管理功能。采用 SpringBoot + Vue 前后端分离架构，功能原型达到 0 代码开发，非常适合有一定 Java 基础、想提升全栈开发能力的学习者。

## 项目结构

```
RuoYi-DKD/
├── dkd_backend/       # 后端代码
├── dkd_frontend/      # 前端代码
├── 售货机屏幕端/       # 售货机界面
├── 工单App端/          # 工单管理 App
└── 笔记/              # 学习笔记
```

项目包含多个端：管理后台、售货机屏幕端、工单 App 端，覆盖了售货机运营的各个场景。

## 快速开始

### 1. 导入数据库

导入 `dkd_backend/sql/dkd.sql` 到 MySQL 数据库。

### 2. 启动后端

配置 `dkd_backend/dkd-admin/src/main/resources/*.yml` 中的数据库连接信息，启动 `dkd-admin` 模块，默认端口 `8080`。

### 3. 启动前端

进入 `dkd_frontend` 目录，修改 `vite.config.js` 中的后端地址，然后执行：

```bash
npm install
npm run dev
```

前端默认端口 `2077`。

## 项目亮点

- **基于 RuoYi 框架**：继承若依成熟的权限管理、代码生成等企业级能力
- **前后端分离**：SpringBoot + Vue，符合主流开发模式
- **0 代码开发**：利用若依代码生成器，快速搭建功能原型
- **多端覆盖**：管理后台 + 售货机屏幕端 + 工单 App，贴近真实业务

## 写在后面

RuoYi-DKD 是一个很实用的二次开发案例。通过在若依基础上扩展自动售货机业务，既能学习若依框架的使用方式，又能接触到前后端分离的全栈开发流程。项目还贴心地附带了学习笔记，对初学者非常友好。如果你想在 Java Web 开发上更进一步，这个项目值得一试。
