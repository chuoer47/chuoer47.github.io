---
title: "XJTUSE-编译原理-第三章-homework"
date: 2024-06-20 :07
tags:
- 编译原理
category: 本科课程笔记
order: 98
---

# XJTUSE-编译原理-第三章-homework

编译原理每年作业题目都不一样，基本就是改几个小数据，我也是希望把今年(2024年)的作业题誊写下来，供各位学弟学妹多点题可以刷，多考高分！

## 第一题

### 题目描述

![](https://i-blog.csdnimg.cn/blog_migrate/052ebf0c9cf738d96d0c4246e026226e.png)

### 第一问

			I

			![](https://i-blog.csdnimg.cn/blog_migrate/3a591ccfc41ea989794340d720566d21.png)

			![](https://i-blog.csdnimg.cn/blog_migrate/b60d10279671f8c68b0c38f31abc0217.png)

			{x,1,2}

			{2,3,y}

			{1,3,y}

			{2,3,y}

			{2.3.y}

			{3,y}

			{1.3.y}

			{2,3,y}

			{1,3,y}

			{3,y}

			{3,y}

			{3,y}

### 第二问

			I

			![](https://i-blog.csdnimg.cn/blog_migrate/dd46bc88ccb4003952fe61e4dbfe29eb.png)

			![](https://i-blog.csdnimg.cn/blog_migrate/87ed664e5a53673c3929a67dae530c39.png)

			1

			2

			3

			2

			2

			4

			3

			2

			3

			4

			4

			4

### 第三问

![](https://i-blog.csdnimg.cn/blog_migrate/9e79199c46285a2a1e8052e188c0c418.jpeg)

### 第四问

化简步骤如下：

1.根据终态和非终态划分为{1},{2,3,4}

2.![](https://i-blog.csdnimg.cn/blog_migrate/1818e4b5451ef30f8ccb2423eeb72f70.png)，将{1}作为集合，下面考察终态

3.![](https://i-blog.csdnimg.cn/blog_migrate/027739e9d5e6eebaeda8e6fee8c89932.png)，均属于终态集合

4.因此划分结束，2,3,4，得到化简后的DFAM''

![](https://i-blog.csdnimg.cn/blog_migrate/609e85f14defe19baa25e3d9b9b7ef30.jpeg)

## 第二题

### 题目描述

![](https://i-blog.csdnimg.cn/blog_migrate/e5aea81f41b59fe639a3aa3dc76189c0.png)

### 第一问

			I

			![](https://i-blog.csdnimg.cn/blog_migrate/acbb630431ba003d44f87de00a545700.png)

			![](https://i-blog.csdnimg.cn/blog_migrate/ec775625e51bfdfbbb59f4b716d0b2fc.png)

			{x,1,2,3}

			{1,3}

			{2,3,y}

			{1,3}

			{1,3}

			{y}

			{2,3,y}

			{1,3}

			{2,3,y}

			{y}

			\

			\

### 第二问

			I

			![](https://i-blog.csdnimg.cn/blog_migrate/e59bd97c1f21fe1e1d908491a7b7c424.png)

			![](https://i-blog.csdnimg.cn/blog_migrate/2caffd43392171f866898c29270d2f19.png)

			1

			2

			3

			2

			2

			4

			3

			2

			3

			4

			\

			\

### 第三问

![](https://i-blog.csdnimg.cn/blog_migrate/88aeb4ae7c96325493ac09fe42999d2d.jpeg)

### 第四问

化简步骤如下：

- 根据终态和非终态划分为{1,2},{3,4}- ![](https://i-blog.csdnimg.cn/blog_migrate/515cd2ae97335233321bace32781020c.png)，观察终态集合- ![](https://i-blog.csdnimg.cn/blog_migrate/d88bc8e8ee1630994f25cac8ec6399d5.png)，无法区分，划分完毕- 因此可以将1,2合并，将3,4合并，得到化简后的DFAM''

![](https://i-blog.csdnimg.cn/blog_migrate/dd6931a9f4f21c8d4a5a6c6a7d809a38.jpeg)
