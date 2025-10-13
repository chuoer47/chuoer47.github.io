---
title: SpringTask
date: 2024-06-22
tags: Spring
category: Spring
order: 7
icon: "/img/定时任务.svg"
---

<!--more--->

# SpringTask

## 一、介绍

Spring Task 是Spring框架提供的任务调度工具，可以按照约定的时间自动执行某个代码逻辑

::: tip  应用场景：

•信用卡每月还款提醒

•银行贷款每月还款提醒

•火车票售票系统处理未支付订单

•入职纪念日为用户发送通知

**只要是需要定时处理的场景都可以使用Spring Task**

:::

## 二、cron表达式

cron表达式其实就是一个字符串，通过cron表达式可以**定义任务触发的时间**

构成规则：分为6或7个域，由空格分隔开，每个域代表一个含义，每个域的含义分别为：秒、分钟、小时、日、月、周、年(可选)

![](/image\spring\spring2.png)

2022年10月12日上午9点整 对应的cron表达式为：0 0 9 12 10 ? 2022

cron表达式在线生成器：[https://cron.qqe2.com/](https://cron.qqe2.com/)

## 三、快速使用

::: info Spring Task使用步骤：

①导入maven坐标 spring-context （已经包含，不需要单独导入）

②启动类添加注解 @EnableScheduling 开启任务调度

③自定义定时任务类

:::

**1）开启任务调度**

```java
@EnableScheduling   //开启任务调度
@EnableCaching //开启 springcache
@SpringBootApplication
@EnableTransactionManagement //开启注解方式的事务管理
@Slf4j
public class SkyApplication {
    public static void main(String[] args) {
        SpringApplication.run(SkyApplication.class, args);
        log.info("server started");
    }
}
```

**2）创建定时任务类**

```java
/**
 * 自定义定时任务类，可以单独创建一个task包
 */
@Component
@Slf4j
public class MyTask {

    @Scheduled(cron = "0/5 * * * * ?") //第0秒开始每个五秒触发一次
    public void executeTask(){
        log.info("定时任务开始执行:{}", new Date());
    }
}
```

## 四、多线程

Spring Task定时器默认是单线程的，如果项目中使用多个定时器，使用一个线程会造成效率低下。

此时我们可以给SpringTask配置线程池。代码如下：

```java
package com.example.springboottaskdemo;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;

import java.util.concurrent.Executors;

@Configuration
public class SchedulingConfig implements SchedulingConfigurer {
    @Override
    public void configureTasks(ScheduledTaskRegistrar taskRegistrar) {
        // 创建线程池，设置五个线程
        taskRegistrar.setScheduler(Executors.newScheduledThreadPool(4));
    }
}
```

这样就不会出现阻塞问题了,但是如果定时任务过多，超过了配置的线程池的线程数量还是会运行错乱。

# 参考

[1] [https://cloud.tencent.com/developer/article/2355644](https://cloud.tencent.com/developer/article/2355644)

[2] [B站苍穹外卖](https://www.bilibili.com/video/BV1TP411v7v6?p=126&spm_id_from=pageDriver&vd_source=80162809c800d9d3f638b9ee4096e6d6)