---
title: "XJTUSE-离散数学-命题演算"
date: 2024-08-10 :47
tags:
- 离散数学
category: 本科课程笔记
order: 3
---

# XJTUSE-离散数学-命题演算

## 命题与真值联结词
凡是能分辨真假的语句就是命题

- 合取 : ![](./XJTUSE-离散数学-命题演算.assets/image-001-68b854adf5.png)- 析取 ： ![](./XJTUSE-离散数学-命题演算.assets/image-002-b6ee4b2ad5.png)- 蕴含： ![](./XJTUSE-离散数学-命题演算.assets/image-003-5f8c06cdea.png)
## 指派和真值表
指派就是一个确定的变元组，确定了其真假值。

成真指派，成假指派

真值表 ： 所有指派列出来的表格

永真公式 = 重言式

永假公式 = 矛盾式

## 逻辑等价关系

 挺简单的

替换定理

代入定理

### 其他联结词
异或 ： ![](./XJTUSE-离散数学-命题演算.assets/image-004-6b234c5fdb.png)

与非 ： ![](./XJTUSE-离散数学-命题演算.assets/image-005-2dd88f49b7.png)

或非 ： ![](./XJTUSE-离散数学-命题演算.assets/image-006-da4dbfc183.png)

全功能 (功能完备)的概念 ： 任一真值函数都可以用其联结词表示

极小全功能

### 析取范式、合取范式的概念
析取范式 ： ![](./XJTUSE-离散数学-命题演算.assets/image-007-7c8a13f464.png)

合取范式同理

主析取范式 、主合取范式的概念 .... (提示：小项包含全部变元)

## 逻辑蕴含变换

 略

## 对偶定理
原命题 ![](./XJTUSE-离散数学-命题演算.assets/image-008-1082a3d2ea.png)

对偶命题 ![](./XJTUSE-离散数学-命题演算.assets/image-009-9016d20f0a-02.png) : 把合取换成析取，把析取换为合取。

内否式 ![](./XJTUSE-离散数学-命题演算.assets/image-010-e5e59ad1d8-02.png) : 把变元变成相应的否定形式。

有如下定理：

- ![](./XJTUSE-离散数学-命题演算.assets/image-011-dba1be1652.png) - ![](./XJTUSE-离散数学-命题演算.assets/image-012-0ceb73dba1.png)- ![](./XJTUSE-离散数学-命题演算.assets/image-013-e152d4c4b4.png)
如下定理：

- a为永真公式当且仅当![](./XJTUSE-离散数学-命题演算.assets/image-010-e5e59ad1d8-02.png)为永真公式- ![](./XJTUSE-离散数学-命题演算.assets/image-015-d07e97178f.png)为永真公式当且仅当![](./XJTUSE-离散数学-命题演算.assets/image-009-9016d20f0a-02.png)为永真公式
对偶定理[[1]](https://blog.csdn.net/myRealization/article/details/120175968)：

![](./XJTUSE-离散数学-命题演算.assets/image-017-f3cd984e07.png)

## 命题演算的形式推理
### 直接引入规则
前提引入规则(无代价)

假设引入规则(有代价)

### 直接推理规则
蕴含消去规则

合取消去规则

析取引入规则

等价引入规则

等价消去规则

### 间接推理规则
蕴含引入规则

析取消去规则

否定消去规则

否定引入规则
