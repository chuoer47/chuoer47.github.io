---
title: "ndarray 基础"
date: 2026-06-22
tags:
- NumPy
- Python
- AI
category:
- AI
order: 1
---

# ndarray 基础

`ndarray`（N-dimensional array）是 NumPy 的核心数据结构，它是一个高效的多维同构数组——所有元素必须是相同类型。相比 Python 原生列表，`ndarray` 在内存布局和计算效率上有巨大优势。

## 一、创建数组

### 1、从 Python 对象创建

```python
import numpy as np

# 从列表创建
a = np.array([1, 2, 3, 4, 5])
print(a)        # [1 2 3 4 5]
print(type(a))  # <class 'numpy.ndarray'>

# 从嵌套列表创建二维数组
b = np.array([[1, 2, 3],
              [4, 5, 6]])
print(b.shape)  # (2, 3)

# 指定数据类型
c = np.array([1, 2, 3], dtype=np.float64)
print(c.dtype)  # float64
```

### 2、内置创建函数

| 函数 | 说明 | 示例 |
|------|------|------|
| `np.zeros(shape)` | 全零数组 | `np.zeros((3, 4))` |
| `np.ones(shape)` | 全一数组 | `np.ones((2, 3))` |
| `np.full(shape, val)` | 指定值填充 | `np.full((2, 2), 7)` |
| `np.empty(shape)` | 未初始化（最快） | `np.empty((3, 3))` |
| `np.eye(N)` | 单位矩阵 | `np.eye(3)` |
| `np.identity(N)` | 单位矩阵（同 eye） | `np.identity(3)` |
| `np.diag(v)` | 对角矩阵 | `np.diag([1, 2, 3])` |
| `np.tri(N)` | 下三角矩阵 | `np.tri(3)` |

```python
# 全零数组
z = np.zeros((2, 3))
# [[0. 0. 0.]
#  [0. 0. 0.]]

# 单位矩阵
I = np.eye(3)
# [[1. 0. 0.]
#  [0. 1. 0.]
#  [0. 0. 1.]]

# 指定值填充
f = np.full((2, 2), 3.14)
# [[3.14 3.14]
#  [3.14 3.14]]
```

### 3、等差 / 等比序列

```python
# arange: 类似 range，返回一维数组
a = np.arange(0, 10, 2)    # [0 2 4 6 8]

# linspace: 等间隔取点（包含终点）
b = np.linspace(0, 1, 5)   # [0.   0.25 0.5  0.75 1.  ]

# logspace: 对数等间隔
c = np.logspace(0, 3, 4)   # [   1.   10.  100. 1000.]

# geomspace: 几何等间隔
d = np.geomspace(1, 1000, 4) # [   1.   10.  100. 1000.]
```

### 4、随机数组

```python
# [0, 1) 均匀分布
r1 = np.random.rand(3, 3)

# 标准正态分布
r2 = np.random.randn(3, 3)

# 指定范围的随机整数
r3 = np.random.randint(0, 100, size=(2, 5))

# 从正态分布 N(mean, std²) 采样
r4 = np.random.normal(loc=0, scale=1, size=(3, 3))

# 随机种子（保证可复现）
rng = np.random.default_rng(seed=42)
r5 = rng.standard_normal((3, 3))
```

::: tip 推荐使用新式随机 API
NumPy 1.17+ 推荐使用 `np.random.default_rng()` 创建独立的随机数生成器，替代全局 `np.random` 函数，可更好地控制随机状态。
:::

### 5、从已有数据创建

```python
# 从已有数组创建副本
a = np.array([1, 2, 3])
b = np.array(a)           # 深拷贝
c = a.copy()              # 深拷贝（更明确）

# 从已有数组创建视图（共享内存）
d = a.view()

# 从函数生成
e = np.fromfunction(lambda i, j: i + j, (3, 3), dtype=int)
# [[0 1 2]
#  [1 2 3]
#  [2 3 4]]

# 从字符串解析
f = np.fromstring("1 2 3 4", sep=" ", dtype=int)
```

## 二、数组属性

每个 `ndarray` 对象都有以下关键属性：

```python
a = np.array([[1, 2, 3],
              [4, 5, 6]], dtype=np.float32)

print(a.shape)      # (2, 3)       — 各维度大小
print(a.ndim)       # 2            — 维度数（秩）
print(a.size)       # 6            — 元素总数
print(a.dtype)      # float32      — 元素数据类型
print(a.itemsize)   # 4            — 每个元素字节数
print(a.nbytes)     # 24           — 总字节数 = size × itemsize
print(a.T.shape)    # (3, 2)       — 转置
print(a.strides)    # (12, 4)      — 各维度步长（字节）
```

### shape 与 strides 的关系

`strides` 描述了沿每个维度移动一个元素需要跳过的字节数。对于上面的 `(2, 3)` float32 数组：
- 沿行移动（axis=0）：跳过一整行 = 3 × 4 = **12 字节**
- 沿列移动（axis=1）：跳过一个元素 = **4 字节**

理解 `strides` 是理解 NumPy 视图（view）和内存共享的关键。

## 三、数据类型（dtype）

### 1、常用数据类型

| dtype | 字节数 | 范围 / 精度 |
|-------|--------|------------|
| `np.bool_` | 1 | True / False |
| `np.int8` | 1 | -128 ~ 127 |
| `np.int16` | 2 | -32768 ~ 32767 |
| `np.int32` | 4 | ±2.1 × 10⁹ |
| `np.int64` | 8 | ±9.2 × 10¹⁸ |
| `np.uint8` | 1 | 0 ~ 255 |
| `np.float16` | 2 | 半精度浮点 |
| `np.float32` | 4 | 单精度（~7 位有效数字） |
| `np.float64` | 8 | 双精度（~15 位有效数字） |
| `np.complex64` | 8 | 复数（两个 float32） |
| `np.complex128` | 16 | 复数（两个 float64） |
| `np.str_` | 变长 | Unicode 字符串 |
| `np.object_` | 变长 | Python 对象 |
| `np.datetime64` | 8 | 日期时间 |

### 2、类型转换

```python
a = np.array([1, 2, 3])

# 方法一：astype（推荐，创建副本）
b = a.astype(np.float64)

# 方法二：创建时指定
c = np.array([1, 2, 3], dtype=np.float32)

# 字符串转数值
d = np.array(["1.5", "2.7", "3.14"]).astype(float)

# 查看类型
print(a.dtype)        # int64
print(a.dtype.name)   # int64
```

::: warning astype 总是创建副本
`astype()` 返回一个新数组，不修改原数组。如果需要原地修改，需赋值回去：`a = a.astype(np.float32)`。
:::

### 3、结构化 dtype

当需要在一个数组中存储不同类型的数据时，可以使用结构化 dtype：

```python
# 定义结构化类型
dt = np.dtype([
    ("name", "U10"),      # Unicode 字符串，最长 10 字符
    ("age", "i4"),         # 32 位整数
    ("score", "f8")        # 64 位浮点
])

# 创建结构化数组
students = np.array([
    ("Alice", 20, 95.5),
    ("Bob",   22, 87.0),
    ("Carol", 21, 92.3)
], dtype=dt)

# 按字段访问
print(students["name"])    # ['Alice' 'Bob' 'Carol']
print(students["score"])   # [95.5 87.  92.3]
```

## 四、视图与副本

理解视图（view）和副本（copy）的区别是避免隐蔽 Bug 的关键。

### 1、视图（共享内存）

```python
a = np.array([1, 2, 3, 4, 5])
b = a[1:4]          # 切片返回视图
b[0] = 99
print(a)            # [ 1 99  3  4  5]  ← 原数组被修改！

print(b.base is a)  # True  ← b 是 a 的视图
```

### 2、副本（独立内存）

```python
a = np.array([1, 2, 3, 4, 5])
c = a[1:4].copy()   # 显式创建副本
c[0] = 99
print(a)            # [1 2 3 4 5]  ← 原数组不变
```

### 3、哪些操作返回视图，哪些返回副本？

| 操作 | 返回 |
|------|------|
| 基础切片 `a[1:4]`, `a[:, 0]` | 视图 |
| `a.view()` | 视图 |
| `a.astype()` | 副本 |
| `a.copy()` | 副本 |
| 花式索引 `a[[0, 2, 4]]` | 副本 |
| 布尔索引 `a[a > 3]` | 副本 |
| `np.reshape()` (连续内存时) | 视图 |
| `np.ravel()` (连续内存时) | 视图 |
| `np.concatenate()` | 副本 |

::: info 判断方法
- `np.shares_memory(a, b)` — 判断两个数组是否共享内存区域
- `b.base is a` — 判断 b 是否是 a 的视图
:::

## 五、数组的内存布局

### 1、C-order vs Fortran-order

```python
# C-order（行优先，默认）：最后一维在内存中连续
a = np.array([[1, 2, 3],
              [4, 5, 6]], order='C')

# Fortran-order（列优先）：第一维在内存中连续
b = np.array([[1, 2, 3],
              [4, 5, 6]], order='F')

print(a.strides)  # (24, 8)  — 每行 3×8=24 字节
print(b.strides)  # (8, 16)  — 每列 2×8=16 字节
```

### 2、检查内存布局

```python
a = np.zeros((3, 4))

print(a.flags.c_contiguous)   # True  — C 连续
print(a.flags.f_contiguous)   # False — 非 Fortran 连续

# 转换布局
b = np.asfortranarray(a)
print(b.flags.f_contiguous)   # True
```

---

> 📖 **官方文档**
> - [NumPy 快速入门](https://numpy.org/doc/stable/user/quickstart.html)
> - [ndarray 对象](https://numpy.org/doc/stable/reference/arrays.ndarray.html)
> - [数据类型](https://numpy.org/doc/stable/reference/arrays.dtypes.html)
> - [数组创建](https://numpy.org/doc/stable/reference/routines.array-creation.html)
