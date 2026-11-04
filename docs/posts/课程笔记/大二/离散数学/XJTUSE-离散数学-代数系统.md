---
title: "XJTUSE-离散数学-代数系统"
date: 2024-08-10 :22
tags:
- 离散数学
category: 本科课程笔记
order: 5
---

# XJTUSE-离散数学-代数系统

## 代数系统

要满足：

- 封闭性- 后者唯一### 基本性质

- 结合律- 交换律- 消去律- 幺元(若有则唯一)- 零元(若有则唯一)- 逆元- 分配律### 子代数系统

由于代数系统已经满足了后者唯一，子代数系统只需要在子集的情况下满足封闭性即可。

## 代数系统的同构与同态

### 同态公式

设 和 是两个代数系统，存在一个函数h，对于![](./XJTUSE-离散数学-代数系统.assets/image-001-a734cd5d33.png)有如下公式:

![](./XJTUSE-离散数学-代数系统.assets/image-002-53257dde2c.png)

则称h对f，g保持运算，称上面的式子为同态公式。

### 同构

- 代数系统是同类型的- h是双射函数- 满足同态公式### 同态

满足同态公式即可，对于不同的h，有不同的称呼

- h是单射，单同态函数，单同态象。- h是满射，满同台函数，满同态象。- h是双射，同构。## 半群

是半群要满足如下条件：

- 代数系统- *是二元运算- 满足结合律满足交换律 => 交换半群

有幺元 => 含幺半群

### 循环半群

满足如下： ![](./XJTUSE-离散数学-代数系统.assets/image-003-5224c38ac2.png)

循环半群有生成元 ![](./XJTUSE-离散数学-代数系统.assets/image-004-d317dd1d0c.png)

典型的循环半群 ：    ![](./XJTUSE-离散数学-代数系统.assets/image-005-3f5a2808c2.png)

### 子半群

子代数系统 + 半群

## 群

是群要满足如下条件：

- 是代数系统- *是二元运算- 满足结合律- 有幺元- 每个元素都有逆元### 群的基本性质

是群 ， |G| > 1

- 逆元唯一- 无零元满足消去律

### 阶

是群，对每一个g，使得![](./XJTUSE-离散数学-代数系统.assets/image-006-885714c842.png)的最小正整数k就是g的阶。若不存在，则阶是无穷。

- 若k=n，则![](./XJTUSE-离散数学-代数系统.assets/image-007-2a9523fb14.png)各不相同- 若k为正无穷，则全部元素互不相同。- 若|G|=n,则每个元素的阶小于等于n。### 循环群

循环群与循环半群定义相似，不过循环半群是生成元的正整数次幂，循环群是生成元的整数幂。

- a为生成元，a的阶为m，同构于![](./XJTUSE-离散数学-代数系统.assets/image-008-33e28330d6.png)- a为生成元，a的阶为无穷，同构于![](./XJTUSE-离散数学-代数系统.assets/image-009-794da43d81.png)循环群 => 交换群

### 置换群

### 子群

充分必要条件：

- ![](./XJTUSE-离散数学-代数系统.assets/image-010-5b51410826-02.png)- ![](./XJTUSE-离散数学-代数系统.assets/image-011-5423ef3735.png)充分必要条件：

- ![](./XJTUSE-离散数学-代数系统.assets/image-012-81b8698f5c.png)有限群的子群的充分必要条件：

- ![](./XJTUSE-离散数学-代数系统.assets/image-010-5b51410826-02.png)### 陪集和Lagrange定理

    设(H,*)为群(G,*)的子群，对于G中任意元素a，定义集合![](./XJTUSE-离散数学-代数系统.assets/image-014-d0b0570b5e.png)为H的左陪集，同样定义集合![](./XJTUSE-离散数学-代数系统.assets/image-015-99ad114f22.png)为H的右陪集。

#### 陪集的性质

所有陪集构成了划分，而且划分唯一。

|aH| = |H|   |Hb| = |H|

![](./XJTUSE-离散数学-代数系统.assets/image-016-b32b9a97e4.png)分别为左陪集集合，右陪集集合，称|![](./XJTUSE-离散数学-代数系统.assets/image-017-ef4dbde3bc.png)| ，|![](./XJTUSE-离散数学-代数系统.assets/image-018-2ac70a8c29.png)|为G关于H的指数

#### Lagrange定理

有指数k，|G| = k|H|

如下结论：

- 素数阶群，只有两个子群，两个平凡子群- 有限群，每个元素的阶都是群的阶的因子。- 每个素数阶的群都是循环群。- 四阶不同构的群只有两个，一个是四阶循环群，一个是Klein-4群。## 环

![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)是环要满足：

- ![](./XJTUSE-离散数学-代数系统.assets/image-020-fad5ac493c-02.png)是交换群- ![](./XJTUSE-离散数学-代数系统.assets/image-021-c07e0d9570.png)是半群- ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)对![](./XJTUSE-离散数学-代数系统.assets/image-023-9529f68e96-02.png)满足分配律。
整数环，矩阵环，整数模环，多项式环

交换环：![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)满足交换律

含幺环：![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)有幺元

### 基本性质

- ![](./XJTUSE-离散数学-代数系统.assets/image-023-9529f68e96-02.png)的幺元是![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)的零元- ![](./XJTUSE-离散数学-代数系统.assets/image-028-d38bec97f8.png)### 零因子

零因子 ： ![](./XJTUSE-离散数学-代数系统.assets/image-029-0759c8fa73.png),a为b的左零因子，b为a的右零因子。

无/含零因子环的充分必要条件 ： ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)满足/不满足消去律。

### 整环

![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)是环，若

- ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)满足交换律- ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)幺元- ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)无零因子(满足消去律)则![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)整环。

### 除环

![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)是环，若

- 关于![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)有幺元- ![](./XJTUSE-离散数学-代数系统.assets/image-038-2274fb8e2c.png)，a有逆元。则![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)除环。

若是除环 => 则为含幺的无零因子环。

![](./XJTUSE-离散数学-代数系统.assets/image-040-ea1838170f.png)

## 域

![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)可交换的除环，则称为![](./XJTUSE-离散数学-代数系统.assets/image-019-d7490de748-02.png)为域。

- ![](./XJTUSE-离散数学-代数系统.assets/image-020-fad5ac493c-02.png)是交换群- ![](./XJTUSE-离散数学-代数系统.assets/image-044-41a57fc9ab.png)是交换群，其中0是![](./XJTUSE-离散数学-代数系统.assets/image-023-9529f68e96-02.png)的幺元。- ![](./XJTUSE-离散数学-代数系统.assets/image-022-9d1212dcef-02.png)对![](./XJTUSE-离散数学-代数系统.assets/image-023-9529f68e96-02.png)满足分配律。
有理数域，实数域，复数域

### 一些定理

有限整环 => 域

![](./XJTUSE-离散数学-代数系统.assets/image-048-c2ae3aee15.png)
