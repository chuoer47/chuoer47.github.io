---
title: "JavaWeb-AI-Tlias 学习项目"
date: 2025-06-22
---

# JavaWeb-AI-Tlias 学习项目

> GitHub: [JavaWeb-AI-Tlias](https://github.com/chuoer47/JavaWeb-AI-Tlias)

## 项目背景

这是我自学 JavaWeb 开发过程中的一个练手项目，主要目的是巩固 JavaWeb 的基础知识，同时尝试自定义 SpringBoot Starter 的开发流程。整个项目涵盖了从 Servlet 到 SpringBoot 自动配置的多个知识点，算是对 JavaWeb 技术栈的一次系统性梳理。

## 项目结构

项目包含以下几个模块：

### 1. tlias-web-management - JavaWeb 入门项目

这是整个项目的核心模块，基于 Servlet、SpringMVC、MyBatis 等基础技术搭建，实现了员工管理和部门管理的基础 CRUD 功能。虽然是一个入门级项目，但该有的分层结构都有——Controller、Service、Mapper 层层分明，数据库操作也用了 MyBatis 来简化。

对于刚接触 JavaWeb 的同学来说，这个模块可以帮助理解从请求到响应的完整链路，以及 SpringMVC 是如何接管 Servlet 做请求分发的。

### 2. aliyun-oss-spring-boot-autoconfigure - 阿里云 OSS 自动配置模块

这是我自己动手写的一个 SpringBoot 自动配置模块，用于集成阿里云 OSS 对象存储服务。通过这个模块，可以更深入地理解 SpringBoot 的自动配置原理——`@Conditional`、`spring.factories`、配置属性绑定这些概念在这里都能实践到。

### 3. aliyun-oss-spring-boot-starter - Starter 入口模块

Starter 模块本身不包含业务逻辑，它的作用是把自动配置模块和相关依赖打包在一起，让使用者只需要引入一个 Starter 依赖就能开箱即用。这也是 SpringBoot Starter 的标准开发模式。

### 4. springboot-autoconfiguration-test - 测试模块

用来验证自定义 Starter 是否能正常工作的测试模块。

### 5. appendix - 附件文件夹

包含数据库脚本、截图等辅助文件。

## 技术栈

- JDK 8+
- Maven 3.6+
- MySQL 5.7+
- SpringMVC / MyBatis

## 写在后面

这个项目虽然功能不算复杂，但胜在覆盖的知识点比较全面。从最基础的 JavaWeb 请求处理，到 SpringBoot 的自动配置机制，每个模块都有对应的实践。如果你也在学 JavaWeb 或者想了解 SpringBoot Starter 的开发方式，可以参考一下这个项目。
