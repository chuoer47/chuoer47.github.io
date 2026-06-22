---
title: "XJTUSE-软件质量保证大作业"
date: 2023-12-07 :30
tags:
- 其他
category: 本科课程笔记
order: 24
---

# XJTUSE-软件质量保证大作业

## 前言
这篇blog主要是为那些可能软件质量保证大作业赶不完的同学写的，同时也是记录自己写这个大作业用到的一些工具和测试思路。

## 项目介绍
我的项目主要是小学期编写的项目(oh，on！痛苦的回忆涌上心头，我到现在还没学会springboot+vue，麻)

## 工具推荐
### 工具1
Apipost一个用来调试的工具。

[Apipost-API 文档、设计、调试、自动化测试一体化协作平台](https://www.apipost.cn/)

使用文档：

[产品介绍 | Apipost](https://v7-wiki.apipost.cn/docs/2/)

### 工具2
主要就是python综合训练的爬虫使用的selenium

## 测试思路
### Selenium自动测试(易用性测试)
可以使用python综合训练的selenium，对网页的每一个按钮，输入框进行测试。应该是属于易用性测试。

### 压力测试
可以使用Apipost工具中的一键测压，进行压力测试！

![](https://i-blog.csdnimg.cn/blog_migrate/c4b436f636e5d20836464eaa3b83cc79.png)

测压完成后还会给参数，测起来很方便！

### 功能测试
由于每个项目的功能不同，不过应该都包含增删改出操作。使用Apipost对指定的链接进行请求，然后对返回值进行断言即可。

比如这样子：

![](https://i-blog.csdnimg.cn/blog_migrate/cceebc72ee15792e5834a8a18db1dc72.png)

![](https://i-blog.csdnimg.cn/blog_migrate/474219467c0f207f2ce702228c85c576.png)

 更多的Apipost功能还可以通过官方文档摸索。

值得一提，可以生成代码：

![](https://i-blog.csdnimg.cn/blog_migrate/8d09050ce73e9cb63d0031235fd019ef.png)

选择适合的代码，可以用来应付报告！

 还有一件事情！！接口用例，可以生产多个测试用例！！

![](https://i-blog.csdnimg.cn/blog_migrate/65c9c05b71aea76e1c9946e83cd048c0.png)

### 等价类测试
这个就是请根据自己的情况，编写适合的测试用例了！！！

### 场景测试
Apipost可以编写场景测试的测试用例，使用如下功能即可

![](https://i-blog.csdnimg.cn/blog_migrate/47296193ee16e465b069686abb6c989e.png)

 自己编写场景，选择相应的条件，HTTP请求，等待时间等等。

## 优化思路
该工具还可以编写测试套件

![](https://i-blog.csdnimg.cn/blog_migrate/11329ab1ffb5a79de0c90d3e92ea5b01.png)

## 温馨提醒
测试思路和方法都没有用Junit，只用了Selenium和已经高度集成的软件。

所以说如果老师较真，可以存在问题。不过按照我的方法可以快速写完大作业。

whatever，祝大家期末月加油，科科高分！
