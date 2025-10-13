---
title: 黑马商城
date: 2024-07-04 16:24:22
tags: 项目
category: 黑马商城
icon: "/img/商城.svg"
---

<!--more--->

# 黑马商城

基于SSM框架的B2C电商平台项目。

## 技术栈

SpringBoot+SpringCloud+MyBatisPlus+MySQL+Redis+Nacos+RabbitMQ+Sentinel+Seata+ElasticSearch

## 实现功能

- 包括商品管理、用户模块、搜索、购物车、订单、支付及物流等核心功能。


## 项目亮点

- 基于 ELK技术栈，实现商品的搜索，提升搜索速度，并且实现竞价排名;
- 基于 Redis 构建高速缓存组件，如:用户 Session、页面导航缓存、活动广告、排行热点、比赛动态数据更新进行实现:
- 使用 RabbitMQ 作为项目消息中间件进行异步通讯，实现库存的扣除，以及超时取消订单等任务，提高系统可用性。
- 使用Sentinel对服务进行保护，实现线程隔离和服务熔断，提高了业务健壮性，降低级联失败问题的出现。
- 使用Seata实现分布式事务，保证了数据的一致性。
