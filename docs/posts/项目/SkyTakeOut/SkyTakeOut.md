---
title: "苍穹外卖 SkyTakeOut"
date: 2025-06-22
---

# 苍穹外卖 SkyTakeOut

> GitHub: [SkyTakeOut](https://github.com/chuoer47/SkyTakeOut)

## 项目简介

苍穹外卖是一个基于 Java 开发的在线外卖平台系统，是我自学过程中完成的一个实战项目。整个项目历时约 27 个小时，分 12 天完成，涵盖了从后端接口开发到微信小程序前端的完整流程。对于一个练手项目来说，功能覆盖面还是挺全的。

## 技术栈

**后端：** Java、Spring Boot、Spring MVC、MyBatis-Plus、Spring Cache、Spring Task

**数据库：** MySQL、Redis

**其他：** Swagger（接口文档）、WebSocket（消息推送）、Apache Echart（数据可视化）、Apache POI（Excel 导出）

**外部工具：** PageHelper（分页）、AliyunOSS（文件存储）、微信小程序开发者工具

## 主要功能

### 用户端

- 浏览商品、分类筛选
- 加入购物车、修改数量
- 提交订单、查看订单状态
- 伪微信支付流程
- 催单功能
- 收货地址管理

### 商家端

- 登录验证（JWT）
- 员工管理（CRUD + 权限控制）
- 订单管理（接单、拒单、完成）
- 菜品管理（含阿里云 OSS 图片上传）
- 套餐管理
- 分类管理
- 数据统计（Apache Echart 可视化）
- 报表导出（Apache POI 生成 Excel）
- 工作台（今日数据概览）

### 其他功能

- 微信小程序开发
- 伪微信支付模拟
- WebSocket 订单状态实时推送
- Spring Task 定时处理超时订单

## 开发进展

整个项目的开发过程记录如下，总计约 27 小时：

| 阶段 | 内容 | 累计耗时 |
|------|------|----------|
| Day 01-02 | 开发环境搭建 + 员工模块 | 5.5H |
| Day 03-04 | 公共字段自动填充 + 菜品模块 + 套餐模块 | 9H |
| Day 05-06 | Redis 入门 + 微信小程序开发 | 14.5H |
| Day 07-08 | 缓存套餐 + 购物车 + 下单 + 伪造微信支付 | 20.5H |
| Day 09-10 | 实战优化 + Spring Task + WebSocket | 22.5H |
| Day 11-12 | 统计模块 + 工作台 + Excel 报表导出 | 27H |

## 个人感受

这个项目做下来，最大的收获是对 SpringBoot 全家桶有了更实际的理解。之前学 MyBatis-Plus、Redis、Spring Cache 这些技术的时候都是零散的知识点，通过这个项目把它们串在一起用了，理解就深刻多了。

微信小程序那部分也是第一次接触，虽然前端不是我的重点，但了解小程序和后端的交互方式还是很有必要的。WebSocket 实现订单推送那块也挺有意思，做出来能看到实时效果，成就感不错。

如果你也在学 SpringBoot 全栈开发，苍穹外卖是一个不错的练手项目，推荐试试。
