---
title: Spring
date: 2024-06-22
tags: Spring
category: Spring
order: 1
icon: "/img/spring.svg"
---

<!--more--->

# Spring介绍

## 一、概念

#### **1、Spring**

Spring是一个开源容器框架，可以接管web层，业务层，dao层，持久层的组件，并且可以配置各种bean,和维护bean与bean之间的关系。其核心就是控制反转(IOC),和面向切面(AOP),简单的说就是一个分层的轻量级开源框架。

**两大核心利器：**

- IOC(控制反转)
- AOP(面向切面)

为Java应用程序开发提供了全面的基础架构支持。包含很多开箱即用的模块，如：SpringJDBC、SpringSecurity、SpringAOP、SpringORM，提高了应用开发的效率。

#### **2、SpringMVC**

一个网站通常有前台页面和后台处理逻辑，为了打通这层关系，衍生出类似 struts2 框架。专门解决前台页面与后端数据处理之间的映射关系。当然，Spring 家族为了维护其生态地位，把这种 MVC 模式的优势吸收了进来，加以改造，于是就诞生了 Spring MVC。

Spring MVC是 Spring 的 web 框架。通过Dispatcher Servlet、ModelAndView和View Resolver，开发web应用变得很容易。主要针对的是带页面的系统开发，URL路由、Session、模板引擎、静态Web资源等等。`SpringMVC = Struts2 + Spring`

**处理流程：**

![](/image\spring\spring1.png)

Spring MVC 框架与其他 Web MVC 框架一样，是请求驱动的，围绕一个中央 Servlet 设计，该 Servlet 将请求分派给控制器并提供其他功能以促进 Web 应用程序的开发。然而，Spring 的 DispatcherServlet 不仅仅如此。它与 Spring IoC 容器完全集成，因此允许您使用 Spring 的其他功能。

#### **3、SpringBoot**

Springboot是Spring框架的扩展，延续了spring框架的核心思想IOC和AOP，简化了应用的开发和部署。Spring Boot是为了简化Spring应用的创建、运行、调试、部署等而出现的，使用它可以做到专注于Spring应用的开发，而无需过多关注XML的配置。提供了一堆依赖打包，并已经按照使用习惯解决了依赖问题--->习惯大于约定。

Spring Boot 只是简化了配置，如果你需要构建 MVC 架构的 Web 程序，你还是需要使用 Spring MVC 作为 MVC 框架，只是说 Spring Boot 帮你简化了 Spring MVC 的很多配置，真正做到开箱即用！



# 参考

[1]  [https://www.51cto.com/article/699315.html](https://www.51cto.com/article/699315.html)

[2] [https://juejin.cn/post/7086356542554898462](https://juejin.cn/post/7086356542554898462)

