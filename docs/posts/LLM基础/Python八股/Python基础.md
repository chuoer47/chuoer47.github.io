---
title: Python 基础
tags: [Python, 八股]
category: 八股
order: 1
---

# Python 基础

## 1. int 对象的变长实现

Python 3 中 `int` 是任意精度整数，底层使用**变长数组**存储，而非固定 64 位。

```c
// CPython 源码 Include/longintrepr.h (简化)
struct _longobject {
    PyObject_VAR_HEAD
    digit ob_digit[1];  // 柔性数组，实际大小按需分配
};
```

- 每个 `digit` 存储 30 位（64 位平台）或 15 位（32 位平台）
- `ob_size` 的绝对值表示使用的 digit 数量，符号表示正负
- 加法/乘法通过逐位运算完成，时间复杂度随位数增长

```python
import sys

a = 1
print(sys.getsizeof(a))  # 28 (64-bit CPython)

b = 2**1000
print(sys.getsizeof(b))  # 随位数线性增长
print(type(b))            # <class 'int'>
```

**面试要点**：Python 的 int 不存在溢出问题，但大数运算性能远低于 C 的原生整数。

---

## 2. str 与 PEP 393

Python 3.3+ 采用 PEP 393（灵活字符串表示），根据字符范围自动选择内部编码：

| 表示 | 每字符大小 | 适用范围 |
|------|-----------|---------|
| Latin-1 | 1 字节 | U+0000 - U+00FF |
| UCS-2 | 2 字节 | U+0100 - U+FFFF |
| UCS-4 | 4 字节 | U+10000+ |

```python
import sys

s1 = 'hello'
s2 = '你好'        # 包含 BMP 内中文字符
s3 = '😀'          # emoji, 超出 BMP

print(sys.getsizeof(s1))  # 54  (Latin-1)
print(sys.getsizeof(s2))  # 75  (UCS-2)
print(sys.getsizeof(s3))  # 80  (UCS-4)

# 旧版 Python 2 中所有字符串都是 UCS-4，内存浪费严重
```

**优势**：Latin-1 字符串只占 1 字节/字符，相比 Python 2 的 UCS-4（4 字节）节省 75% 内存。

---

## 3. tuple 的不可变性

```python
t = (1, 2, [3, 4])
t[2].append(5)
print(t)  # (1, 2, [3, 4, 5]) — 不报错！

# tuple 的"不可变"指的是元素引用不变，而非对象本身不可变
t[2] = [6, 7]  # TypeError: 'tuple' object does not support item assignment
```

**本质**：tuple 存储的是指向各元素的**指针数组**，指针一旦分配不可修改。但指针指向的对象本身如果可变，其状态仍可改变。

**为什么 tuple 可哈希而 list 不行？**
- hash 要求对象在生命周期内值不变
- tuple 的结构（指针数组）在创建后不变
- 但如果 tuple 包含可变元素，hash 会在运行时抛出 `TypeError`

```python
hash((1, 2, 3))       # OK
hash((1, 2, [3, 4]))  # TypeError: unhashable type: 'list'
```

---

## 4. list 的动态数组

list 底层是 **PyObject* 指针数组**，采用预分配策略：

```c
// CPython 源码 listobject.c (简化)
typedef struct {
    PyObject_VAR_HEAD
    PyObject **ob_item;   // 指向指针数组
    Py_ssize_t allocated; // 已分配的空间
} PyListObject;
```

**扩容策略**（Python 3.x）：
- 当空间不足时，新容量 = `old_capacity + (old_capacity >> 3) + 6`
- 额外预留 `alloc` 个位置（`PyMem_Realloc` 的分配策略）
- 这意味着 `append` 操作的**均摊时间复杂度**为 O(1)

```python
import sys

lst = []
prev_size = sys.getsizeof(lst)

for i in range(100):
    lst.append(i)
    new_size = sys.getsizeof(lst)
    if new_size != prev_size:
        print(f'len={len(lst):3d}, size={new_size:4d}, delta={new_size - prev_size}')
        prev_size = new_size
# 可以观察到 size 增长不是每次 +8，而是跳跃式增长
```

**面试要点**：
- `list.pop()` 从末尾弹出是 O(1)，从中间弹出是 O(n)（需要移动元素）
- `[x for x in range(1000000)]` 比循环 `append` 更快，因为预计算了大小

---

## 5. dict 的哈希表与紧凑实现

Python 3.6+ 对 dict 进行了重大优化，采用**两数组紧凑实现**：

```c
// CPython 源码 dictobject.c (简化)
// 伪结构：实际分为 dk_entries 和 dk_indices
struct {
    // dk_entries: 只存实际使用的键值对，保持插入顺序
    PyDictKeyEntry entries[];
    // dk_indices: 稀疏数组，用哈希值索引 entries
    int8_t indices[];
};
```

**查找过程**：
1. 计算 key 的 `hash()`
2. 在 `indices` 数组中定位槽位（开放寻址）
3. 通过 `indices[i]` 找到 `entries` 中的索引
4. 比较 key 是否相等（处理哈希冲突）

```python
# Python 3.7+ dict 保持插入顺序（实现细节，非语言规范保证）
d = {}
d['c'] = 3
d['a'] = 1
d['b'] = 2
print(list(d.keys()))  # ['c', 'a', 'b']

# 哈希冲突示例
class BadHash:
    def __init__(self, val):
        self.val = val
    def __hash__(self):
        return 42  # 所有实例哈希相同
    def __eq__(self, other):
        return self.val == other.val

d = {BadHash(1): 'a', BadHash(2): 'b', BadHash(3): 'c'}
print(len(d))  # 3, 但查找性能退化
```

**面试要点**：
- dict 的空间利用率约 2/3 时触发扩容
- 键必须是**可哈希**的（实现了 `__hash__` 和 `__eq__`）
- `dict` 是 Python 中使用最频繁的数据结构，解释器本身大量使用

---

## 6. 可变 vs 不可变对象

```python
# 不可变：int, float, str, tuple, frozenset, bytes
a = 1
b = a
a = a + 1
print(b)  # 1, b 不受影响

# 可变：list, dict, set, bytearray
x = [1, 2]
y = x
x.append(3)
print(y)  # [1, 2, 3], y 也被修改！

# 函数参数传递：传递的是对象的引用（不是值拷贝）
def modify(val):
    val.append(4)

lst = [1, 2, 3]
modify(lst)
print(lst)  # [1, 2, 3, 4]
```

**面试要点**：Python 的参数传递是"传对象引用"（pass by object reference），既不是传值也不是传引用（按 C 语言语义）。

---

## 7. is 与 == 的区别

```python
# == 调用 __eq__()，比较值
# is 比较对象的 id()（内存地址），即是否为同一个对象

a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)   # True, 值相等
print(a is b)   # False, 不是同一对象

c = a
print(a is c)   # True, 同一对象

# 字符串驻留的特殊情况
s1 = 'hello'
s2 = 'hello'
print(s1 is s2)  # True, 因为字符串驻留

# 整数小池
x = 256
y = 256
print(x is y)    # True

x = 257
y = 257
print(x is y)    # False (CPython 实现细节，不应依赖)
```

**最佳实践**：比较值用 `==`，判断是否为 `None` 用 `is None`。

---

## 8. GIL 历史与 PEP 703

### GIL 是什么

GIL（Global Interpreter Lock）是 CPython 的全局锁，同一时刻只允许一个线程执行 Python 字节码。

```python
import threading, time

counter = 0

def increment():
    global counter
    for _ in range(1000000):
        counter += 1  # 即使有 GIL，这也不是原子操作！

t1 = threading.Thread(target=increment)
t2 = threading.Thread(target=increment)
t1.start(); t2.start()
t1.join(); t2.join()

print(counter)  # 可能小于 2000000（字节码层面不是原子的）
```

### GIL 的历史

| 版本 | 变化 |
|------|------|
| Python 1.x | 基于 opcode 切换（100 条字节码切一次） |
| Python 2.0 | 引入检查间隔（check interval） |
| Python 3.2+ | 基于时间切片（默认 5ms，`sys.getswitchinterval()`） |
| Python 3.12 | 移除 GIL 的实验性构建（PEP 703） |

### PEP 703 — Making the Global Interpreter Lock Optional

```python
# Python 3.13+ 可选构建（free-threaded / no-GIL）
# 编译时：./configure --disable-gil
# 运行时：python3.13t (t 表示 free-threaded)

import sys
print(hasattr(sys, '_is_gil_enabled'))  # True if free-threaded build available

# PEP 703 的核心改动：
# 1. 每个对象的引用计数变为原子操作
# 2. 引入"延迟引用计数"（deferred reference counting）
# 3. per-object locks 替代全局 GIL
```

**面试要点**：GIL 使得 CPython 的多线程无法利用多核 CPU 进行 CPU 密集型任务的并行计算，但 I/O 密集型任务仍可从多线程中获益。

---

## 9. 深拷贝与浅拷贝

```python
import copy

original = [[1, 2], [3, 4]]

# 浅拷贝：只拷贝第一层
shallow = copy.copy(original)
shallow[0].append(99)
print(original)  # [[1, 2, 99], [3, 4]] — 内层 list 被共享！

# 深拷贝：递归拷贝所有层
deep = copy.deepcopy(original)
deep[0].append(100)
print(original)  # [[1, 2, 99], [3, 4]] — 不受影响
```

**各种浅拷贝方式**：
```python
lst = [1, [2, 3]]

copy1 = lst[:]           # 切片
copy2 = lst.copy()       # 方法
copy3 = list(lst)        # 构造函数
import copy
copy4 = copy.copy(lst)   # copy 模块

# 以上四种等价，都是浅拷贝
```

**面试要点**：`copy.deepcopy` 使用 memo 字典处理循环引用，避免无限递归。

---

## 10. *args 与 **kwargs

```python
def func(a, b, *args, **kwargs):
    print(f'a={a}, b={b}')
    print(f'args={args}')
    print(f'kwargs={kwargs}')

func(1, 2, 3, 4, x=5, y=6)
# a=1, b=2
# args=(3, 4)
# kwargs={'x': 5, 'y': 6}

# 仅限位置参数和仅限关键字参数 (Python 3)
def strict_func(a, b, /, c, d, *, e, f):
    print(a, b, c, d, e, f)

strict_func(1, 2, 3, d=4, e=5, f=6)  # OK
# strict_func(1, b=2, 3, 4, e=5, f=6)  # SyntaxError
```

**解包传递**：
```python
def add(a, b, c):
    return a + b + c

nums = [1, 2, 3]
print(add(*nums))       # 6

config = {'a': 1, 'b': 2, 'c': 3}
print(add(**config))    # 6
```

---

## 11. 字符串驻留（String Interning）

```python
# CPython 自动驻留的字符串：
# 1. 纯标识符（字母、数字、下划线）
# 2. 长度 <= 20 的字符串（编译时常量）
# 3. 数字字符串

a = 'hello_world'
b = 'hello_world'
print(a is b)  # True, 驻留

# 含空格的短字符串也会驻留
c = 'hello world'
d = 'hello world'
print(c is d)  # True (Python 3.7+)

# 手动驻留
import sys
e = sys.intern('complex string here')
f = sys.intern('complex string here')
print(e is f)  # True
```

**应用场景**：大量重复字符串（如列名、字段名）使用 `sys.intern()` 可显著减少内存。

---

## 12. 小整数池 [-5, 256]

```python
# CPython 预分配 [-5, 256] 范围的整数对象
a = 256
b = 256
print(a is b)  # True, 同一对象

a = 257
b = 257
print(a is b)  # False (交互式环境)

# 但在同一代码块中，编译器会优化
a = 257; b = 257
print(a is b)  # True! 编译期常量折叠

# 函数中则不同
def f():
    a = 257
    b = 257
    return a is b
print(f())  # True (同一 code object 的常量池)

def g():
    a = 257
    b = 257
    return a is b
def h():
    a = 257
    b = 257
    return a is b
print(g() is h())  # 不同 code object, 结果取决于实现
```

**面试要点**：小整数池是 CPython 的实现细节，不应在生产代码中依赖 `is` 比较整数。

---

## 13. str / bytes / bytearray 区别

```python
# str — Unicode 文本
s = '你好世界'
print(type(s))        # <class 'str'>
print(len(s))         # 4
print(s.encode('utf-8'))  # b'\xe4\xbd\xa0\xe5\xa5\xbd\xe4\xb8\x96\xe7\x95\x8c'

# bytes — 不可变字节序列
b = b'hello'
print(type(b))        # <class 'bytes'>
print(b[0])           # 104 (int)
# b[0] = 105          # TypeError

# bytearray — 可变字节序列
ba = bytearray(b'hello')
ba[0] = ord('H')      # bytearray(b'Hello')
ba.append(ord('!'))    # bytearray(b'Hello!')
print(ba)
```

| 特性 | str | bytes | bytearray |
|------|-----|-------|-----------|
| 可变性 | 不可变 | 不可变 | 可变 |
| 编码 | Unicode | 二进制 | 二进制 |
| 方法 | 文本方法 | 字节方法 | 字节方法 + 修改 |
| 哈希 | 可哈希 | 可哈希 | 不可哈希 |
| 用途 | 文本处理 | 网络/文件I/O | 需要修改的二进制数据 |

```python
# 常见编码转换
text = 'Hello, 世界'
utf8 = text.encode('utf-8')    # bytes
latin = text.encode('latin-1') # UnicodeEncodeError! 中文无法用 latin-1

# 解码
raw = b'\xe4\xbd\xa0\xe5\xa5\xbd'
print(raw.decode('utf-8'))     # '你好'
```

**面试要点**：`str` 与 `bytes` 之间必须通过 `encode()`/`decode()` 显式转换，Python 3 不会隐式转换。
