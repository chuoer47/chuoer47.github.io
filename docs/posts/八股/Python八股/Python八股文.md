---
title: "Python 八股文"
date: 2025-01-01
tags:
- Python
- 八股
- 面试
category:
- 八股
order: 1
---

# Python 八股文

本文整理 Python 面试高频八股知识点，涵盖基础语法、内存管理、面向对象、并发编程、函数式编程、解释器原理和常见手撕代码题。

---

## 一、Python 基础

### 1.1 数据类型总览

**不可变类型**：`int`, `float`, `str`, `tuple`, `frozenset`, `bytes`
- 创建后值不能修改，修改实际上是创建新对象
- 可作为 dict 的 key 和 set 的元素

**可变类型**：`list`, `dict`, `set`
- 原地修改，不创建新对象
- 不能作为 dict 的 key

```python
# 不可变示例
a = (1, 2, [3, 4])  # tuple 不可变，但包含可变的 list
a[2].append(5)       # 合法！tuple 中的 list 可以修改
print(a)             # (1, 2, [3, 4, 5])
```

### 1.2 is vs ==

- `is`：比较对象的内存地址（`id()`）
- `==`：比较对象的值（调用 `__eq__`）

```python
a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)   # True  — 值相同
print(a is b)   # False — 不同对象

# 小整数缓存池 [-5, 256]
a = 256
b = 256
print(a is b)   # True  — 缓存复用

a = 257
b = 257
print(a is b)   # False — 超出缓存范围（交互式环境）
```

### 1.3 GIL（全局解释器锁）

**核心要点**：
- GIL 是 CPython 解释器中的互斥锁，同一时刻只有一个线程执行 Python 字节码
- 保护引用计数内存管理机制的线程安全
- **CPU 密集型任务**用多进程，**IO 密集型任务**用多线程

```python
# GIL 导致多线程无法真正并行 CPU 密集型任务
import threading, time

def cpu_bound():
    total = 0
    for i in range(10**7):
        total += i

# 单线程
start = time.time()
cpu_bound()
cpu_bound()
print(f"单线程: {time.time() - start:.2f}s")

# 多线程（受 GIL 限制，不会更快）
start = time.time()
t1 = threading.Thread(target=cpu_bound)
t2 = threading.Thread(target=cpu_bound)
t1.start(); t2.start()
t1.join(); t2.join()
print(f"多线程: {time.time() - start:.2f}s")
```

**GIL 的释放时机**：
- IO 操作（文件读写、网络请求）
- `time.sleep()`
- 每执行一定数量的字节码指令（Python 3.2+ 改为基于时间的切换，默认 5ms）
- 运行 C 扩展时可手动释放

**PEP 703 — no-GIL**：
- Python 3.13 首次提供实验性 free-threaded 构建选项
- 核心技术：Biased Reference Counting（偏向引用计数）+ 细粒度锁替代 GIL
- `python3.13t`（带 `t` 后缀）为 free-threaded 版本
- 检查状态：`import sys; print(sys._is_gil_enabled())`

### 1.4 深拷贝 vs 浅拷贝

```python
import copy

a = [1, [2, 3]]
b = copy.copy(a)       # 浅拷贝：外层独立，内层共享引用
c = copy.deepcopy(a)   # 深拷贝：递归复制所有层级

a[1].append(4)
print(b)  # [1, [2, 3, 4]] — 浅拷贝受内层修改影响
print(c)  # [1, [2, 3]]     — 深拷贝完全独立
```

**浅拷贝的其他方式**：
- `list.copy()`、`dict.copy()`
- 切片：`a[:]`
- `list(a)`
- `{**d}`（字典浅拷贝）

**深拷贝的特殊情况**：
- 对象存在循环引用时，`deepcopy` 能正确处理
- `__copy__` 和 `__deepcopy__` 魔术方法可自定义拷贝行为

### 1.5 *args / **kwargs 底层机制

```python
def func(a, b, *args, **kwargs):
    print(f"a={a}, b={b}")
    print(f"args={args}")       # tuple
    print(f"kwargs={kwargs}")   # dict

func(1, 2, 3, 4, x=5, y=6)
# a=1, b=2
# args=(3, 4)
# kwargs={'x': 5, 'y': 6}
```

**底层原理**：
- `*args` 在函数签名中收集位置参数为 tuple
- `**kwargs` 收集关键字参数为 dict
- 反向使用时：`*list_of_args` 解包为位置参数，`**dict_of_kwargs` 解包为关键字参数

```python
# 反向解包
def add(a, b, c):
    return a + b + c

args = (1, 2, 3)
print(add(*args))       # 6 — 等价于 add(1, 2, 3)

kwargs = {'a': 1, 'b': 2, 'c': 3}
print(add(**kwargs))    # 6 — 等价于 add(a=1, b=2, c=3)
```

### 1.6 dict 底层实现

- 基于**哈希表**实现
- Python 3.7+ 保证插入顺序（通过维护插入序列表）
- 哈希冲突解决：**开放寻址法**（二次探测），非链表
- 负载因子达到 2/3 时自动扩容

```python
# dict 的哈希原理
d = {}
d["hello"] = 1   # hash("hello") → 定位存储位置
d["world"] = 2

# tuple 可以做 key（因为可哈希）
d[(1, 2)] = 3    # 合法

# list 不行（因为不可哈希）
# d[[1, 2]] = 3  # TypeError: unhashable type: 'list'
```

### 1.7 字符串驻留（String Interning）

Python 会自动对满足以下条件的字符串进行驻留（共享同一内存地址）：
- 只包含字母、数字和下划线的标识符字符串
- 编译期确定的常量字符串

```python
a = "hello"
b = "hello"
print(a is b)   # True — 自动驻留

a = "hello world"
b = "hello world"
print(a is b)   # False — 包含空格，不驻留

# 手动驻留
import sys
a = sys.intern("hello world")
b = sys.intern("hello world")
print(a is b)   # True
```

---

## 二、内存管理

### 2.1 引用计数

每个 Python 对象都有 `ob_refcnt` 字段，记录有多少个引用指向它。

```python
import sys

a = []
print(sys.getrefcount(a))  # 2（a + getrefcount 的临时参数）
b = a
print(sys.getrefcount(a))  # 3
del b
print(sys.getrefcount(a))  # 2
```

**引用计数增加**：赋值、传参、放入容器、`sys.getrefcount()` 临时引用
**引用计数减少**：`del`、重新赋值、离开作用域、从容器移除

**局限**：无法处理循环引用（A→B→A）

### 2.2 分代垃圾回收

Python 采用**三代分代回收**策略，解决循环引用问题：

| 代 | 存活时间 | 回收频率 | 默认阈值 |
|----|---------|---------|---------|
| Generation 0 | 新创建对象 | 最频繁 | 700 次分配触发 |
| Generation 1 | Gen0 中存活一次 | 中等 | 10 次 Gen0 回收触发 |
| Generation 2 | Gen1 中存活一次 | 最少 | 10 次 Gen1 回收触发 |

```python
import gc

print(gc.get_threshold())  # (700, 10, 10)
print(gc.get_count())      # 各代对象计数

gc.collect()               # 手动触发全量回收
gc.disable()               # 禁用自动 GC
gc.enable()                # 重新启用
```

**回收算法：标记-清除 (Mark-Sweep)**
1. 从 GC Roots（栈变量、全局变量等）遍历所有可达对象，标记为存活
2. 遍历所有对象，未标记的对象即为垃圾，回收内存

### 2.3 内存池（pymalloc）

Python 不直接使用 `malloc`，通过三层架构管理内存：

```
应用层 → Python 对象层 → pymalloc（<512B 小对象）→ pymem → 系统 malloc
```

**pymalloc 核心结构**：
- **Arena**（256KB）：向系统申请的大块内存，包含 64 个 Pool
- **Pool**（4KB）：管理特定大小类别的对象
- **Block**（8B~512B）：固定大小的内存块，分配时向上取整

**特殊内存优化**：
- 小整数缓存池：`[-5, 256]` 范围的整数被缓存复用
- 字符串驻留（String Interning）：符合标识符规则的短字符串自动驻留
- `__slots__`：避免 `__dict__`，节省 30%-40% 内存

### 2.4 __slots__ 详解

```python
# 不使用 __slots__（默认）
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

p = Point(1, 2)
print(p.__dict__)  # {'x': 1, 'y': 2} — 每个实例都有 __dict__

# 使用 __slots__
class PointOptimized:
    __slots__ = ('x', 'y')
    def __init__(self, x, y):
        self.x = x
        self.y = y

p = PointOptimized(1, 2)
# p.__dict__  # AttributeError — 没有 __dict__
print(p.x)    # 1

# 内存对比
import sys
p1 = Point(1, 2)
p2 = PointOptimized(1, 2)
print(sys.getsizeof(p1) + sys.getsizeof(p1.__dict__))  # 较大
print(sys.getsizeof(p2))                                 # 较小
```

**__slots__ 注意事项**：
- 子类没有定义 `__slots__` 时，会继承父类的 `__dict__`
- `__slots__` 不支持多继承
- 无法动态添加属性（除非在 `__slots__` 中声明）

### 2.5 内存调试工具

```python
import tracemalloc
tracemalloc.start()
# ... 你的代码 ...
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:10]:
    print(stat)
```

---

## 三、面向对象

### 3.1 `__new__` vs `__init__`

- `__new__`：**创建实例**（静态方法），返回实例对象
- `__init__`：**初始化实例**（实例方法），无返回值

```python
class Singleton:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, value):
        self.value = value

a = Singleton(1)
b = Singleton(2)
print(a is b)      # True — 同一实例
print(a.value)     # 2   — init 被再次调用
```

**执行顺序**：`__new__` → `__init__`

### 3.2 MRO（方法解析顺序）

Python 3 使用 **C3 线性化算法**确定多继承中的方法查找顺序。

```python
class A:
    def greet(self): print("A")

class B(A):
    def greet(self): print("B")

class C(A):
    def greet(self): print("C")

class D(B, C):
    pass

print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)

d = D()
d.greet()  # B — 按 MRO 顺序查找
```

**C3 线性化规则**：
1. 子类优先于父类
2. 多个父类按声明顺序
3. 保持单调性

**经典钻石继承问题**：
```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass

# D → B → C → A → object
# C3 确保 A 只出现一次
```

### 3.3 元类（Metaclass）

元类是"创建类的类"，`type` 是默认的元类。

```python
# 使用 type 动态创建类
MyClass = type('MyClass', (object,), {'x': 1, 'greet': lambda self: 'hello'})
obj = MyClass()
print(obj.greet())  # hello

# 自定义元类
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Database(metaclass=SingletonMeta):
    def __init__(self):
        self.connection = "connected"

db1 = Database()
db2 = Database()
print(db1 is db2)  # True
```

**元类的执行顺序**：
1. Python 遇到 `class` 语句
2. 执行类体，收集属性和方法
3. 调用元类的 `__new__` 创建类对象
4. 调用元类的 `__init__` 初始化类对象

### 3.4 常用魔术方法

**对象创建与销毁**：
- `__new__`：创建实例
- `__init__`：初始化实例
- `__del__`：析构方法（不保证调用时机）

**字符串表示**：
- `__str__`：`str(obj)` 和 `print()` 调用
- `__repr__`：交互式环境和 `repr()` 调用

**运算符重载**：
- `__add__`、`__sub__`、`__mul__` 等算术运算
- `__eq__`、`__lt__`、`__le__` 等比较运算
- `__contains__`：`in` 运算符
- `__getitem__`、`__setitem__`：下标访问

**上下文管理器**：
- `__enter__`：进入 `with` 块
- `__exit__`：退出 `with` 块

**迭代器协议**：
- `__iter__`：返回迭代器自身
- `__next__`：返回下一个值

```python
class Vector:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)

    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

    def __abs__(self):
        return (self.x**2 + self.y**2)**0.5

v1 = Vector(1, 2)
v2 = Vector(3, 4)
print(v1 + v2)  # Vector(4, 6)
print(abs(v1))   # 2.236...
```

### 3.5 上下文管理器（with 语句）

```python
# 方式一：类实现
class Timer:
    def __enter__(self):
        import time
        self.start = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        import time
        print(f"耗时: {time.time() - self.start:.4f}s")
        return False  # 不抑制异常

with Timer():
    sum(range(10**6))

# 方式二：contextlib（更简洁）
from contextlib import contextmanager

@contextmanager
def timer():
    import time
    start = time.time()
    yield
    print(f"耗时: {time.time() - start:.4f}s")

with timer():
    sum(range(10**6))
```

---

## 四、并发编程

### 4.1 线程 vs 进程 vs 协程

| 特性 | 多线程 | 多进程 | 协程 |
|------|--------|--------|------|
| 内存共享 | 是 | 否（IPC） | 是 |
| 创建开销 | 小 | 大 | 极小 |
| GIL 限制 | 受限 | 不受 | 不受 |
| 适用场景 | IO 密集 | CPU 密集 | IO 密集（高并发） |
| 通信方式 | 共享变量 | Pipe/Queue | await |

### 4.2 多线程编程

```python
import threading
import time

def worker(n):
    print(f"Thread {n} starting")
    time.sleep(1)
    print(f"Thread {n} done")

threads = [threading.Thread(target=worker, args=(i,)) for i in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()  # 等待所有线程完成
```

**线程安全**：
```python
import threading

counter = 0
lock = threading.Lock()

def increment():
    global counter
    with lock:  # 加锁保证原子操作
        counter += 1

# 其他同步原语
# threading.RLock()    — 可重入锁
# threading.Event()    — 事件
# threading.Condition() — 条件变量
# threading.Semaphore() — 信号量
# threading.Barrier()   — 屏障
```

### 4.3 多进程编程

```python
from multiprocessing import Process, Queue, Pool

def cpu_task(n):
    return sum(i*i for i in range(n))

# 方式一：Process
p = Process(target=cpu_task, args=(10**6,))
p.start()
p.join()

# 方式二：Pool 进程池
with Pool(4) as pool:
    results = pool.map(cpu_task, [10**6] * 4)
```

**进程间通信（IPC）**：
- `multiprocessing.Queue`：基于管道 + 锁
- `multiprocessing.Pipe`：双向管道
- `multiprocessing.Manager`：共享内存对象（dict, list 等）
- `multiprocessing.Array` / `Value`：共享内存数组/值

### 4.4 协程与 asyncio

```python
import asyncio

async def fetch_data(url):
    print(f"Fetching {url}")
    await asyncio.sleep(1)  # 模拟 IO 操作
    return f"Data from {url}"

async def main():
    # 并发执行多个协程
    tasks = [fetch_data(f"http://api.example.com/{i}") for i in range(3)]
    results = await asyncio.gather(*tasks)
    print(results)

asyncio.run(main())
```

**asyncio 核心概念**：
- **事件循环（Event Loop）**：调度和执行协程
- **协程（Coroutine）**：`async def` 定义的函数
- **Task**：对协程的封装，可并发执行
- **Future**：代表异步操作的最终结果

**Python 3.11+ TaskGroup**（推荐）：
```python
async def main():
    async with asyncio.TaskGroup() as tg:
        task1 = tg.create_task(fetch_data("url1"))
        task2 = tg.create_task(fetch_data("url2"))
    # 退出 with 块时，所有任务已完成
    print(task1.result(), task2.result())
```

### 4.5 yield from 与 async/await 的关系

`yield from`（PEP 380）是 `async/await` 的前身：

```python
# yield from — 生成器委派
def averager():
    total = 0.0
    count = 0
    while True:
        term = yield
        if term is None:
            break
        total += term
        count += 1
    return total / count

def grouper():
    while True:
        result = yield from averager()  # 委派给子生成器
        print(f'Average: {result}')

# yield from 的核心机制：
# 1. 自动透传 send()、throw()、close() 给子生成器
# 2. 自动捕获 StopIteration，子生成器的返回值成为 yield from 表达式的值
```

**等价伪代码**：
```python
# yield from sub_gen 的简化等价实现
_I = iter(sub_gen)
_Y = next(_I)          # 启动子生成器
try:
    while True:
        try:
            _S = yield _Y
        except GeneratorExit:
            _I.close()
            raise
        except BaseException as _e:
            _I.throw(type(_e), _e)
        else:
            try:
                _Y = _I.send(_S) if _S else next(_I)
            except StopIteration as _e:
                _R = _e.value  # 返回值在这里
                break
finally:
    _I.close()
return _R
```

**演进关系**：

| PEP | 语法 | 用途 |
|-----|------|------|
| PEP 380 | `yield from` | 生成器委派（旧式） |
| PEP 492 | `async def` / `await` | 原生协程（推荐） |
| PEP 525 | `async yield` | 异步生成器 |

---

## 五、函数式编程

### 5.1 装饰器

**基础装饰器**：
```python
from functools import wraps

def my_decorator(func):
    @wraps(func)  # 保留原函数的 __name__, __doc__ 等元信息
    def wrapper(*args, **kwargs):
        print("before")
        result = func(*args, **kwargs)
        print("after")
        return result
    return wrapper

@my_decorator
def say_hello():
    """Say hello"""
    print("Hello!")

say_hello()
# before
# Hello!
# after
```

**带参数的装饰器**：
```python
from functools import wraps

def repeat(times):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = None
            for _ in range(times):
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator

@repeat(times=3)
def greet(name):
    print(f"Hello, {name}!")

# 原理：greet = repeat(times=3)(greet)
```

**类装饰器**：
```python
# 方式一：类实现 __call__（装饰函数）
import time
from functools import wraps

class Timer:
    def __init__(self, func):
        wraps(func)(self)
        self.func = func

    def __call__(self, *args, **kwargs):
        start = time.time()
        result = self.func(*args, **kwargs)
        print(f"{self.func.__name__} 耗时: {time.time()-start:.4f}s")
        return result

@Timer
def slow():
    time.sleep(1)

# 方式二：函数装饰类
def add_repr(cls):
    def __repr__(self):
        attrs = ', '.join(f'{k}={v!r}' for k, v in self.__dict__.items())
        return f'{cls.__name__}({attrs})'
    cls.__repr__ = __repr__
    return cls

@add_repr
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y

print(Point(1, 2))  # Point(x=1, y=2)
```

**多个装饰器叠加**：
```python
def bold(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return f"<b>{func(*args, **kwargs)}</b>"
    return wrapper

def italic(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return f"<i>{func(*args, **kwargs)}</i>"
    return wrapper

@bold
@italic
def greet(name):
    return f"Hello, {name}"

# 执行顺序：italic 先执行，再 bold
# greet = bold(italic(greet))
print(greet("World"))  # <b><i>Hello, World</i></b>
```

**functools 常用工具**：
- `@wraps(func)`：保留原函数元信息
- `@lru_cache(maxsize=128)`：函数结果缓存（LRU）
- `@total_ordering`：自动补全比较方法
- `@singledispatch`：泛型函数（按参数类型分发）

### 5.2 闭包

闭包 = 内部函数 + 引用的外部变量 + 外部函数已返回

```python
def make_multiplier(n):
    def multiplier(x):
        return x * n  # n 是自由变量，来自外部函数
    return multiplier

double = make_multiplier(2)
triple = make_multiplier(3)

print(double(5))   # 10
print(triple(5))   # 15

# 查看闭包变量
print(double.__closure__[0].cell_contents)  # 2
```

**闭包与可变对象的陷阱**：
```python
# 错误示例
def counter_wrong():
    count = 0
    def increment():
        count += 1  # UnboundLocalError!
        return count
    return increment

# 正确示例（使用 nonlocal）
def counter():
    count = 0
    def increment():
        nonlocal count  # 声明为外层变量
        count += 1
        return count
    return increment
```

### 5.3 生成器

```python
# 生成器函数
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

# 生成器表达式
squares = (x*x for x in range(10))  # 惰性求值，节省内存

# 使用
for i, val in enumerate(fibonacci()):
    if i >= 10:
        break
    print(val, end=' ')
# 0 1 1 2 3 5 8 13 21 34
```

**yield from 的委派模式**：
```python
def averager():
    total = 0.0
    count = 0
    average = None
    while True:
        term = yield
        if term is None:
            break
        total += term
        count += 1
    return total / count  # 子生成器的返回值

def grouper():
    while True:
        result = yield from averager()  # 委派 + 自动获取返回值
        print(f'Average: {result}')

g = grouper()
next(g)
g.send(10)
g.send(20)
g.send(None)  # 触发 StopIteration，返回值 15.0
```

### 5.4 迭代器 vs 生成器

| 特性 | 迭代器 | 生成器 |
|------|--------|--------|
| 定义方式 | 类实现 `__iter__` + `__next__` | 函数中使用 `yield` |
| 状态保持 | 需要手动管理 | 自动保存 |
| 内存效率 | 一般 | 惰性求值，高效 |
| 适用场景 | 自定义复杂迭代逻辑 | 简单的序列生成 |

```python
# 迭代器
class Countdown:
    def __init__(self, start):
        self.start = start

    def __iter__(self):
        return self

    def __next__(self):
        if self.start <= 0:
            raise StopIteration
        self.start -= 1
        return self.start + 1

# 生成器（等价实现）
def countdown(start):
    while start > 0:
        yield start
        start -= 1
```

---

## 六、Python 解释器

### 6.1 CPython

- Python 的官方参考实现
- 源代码 → AST → 编译为字节码（`.pyc`） → 基于栈的虚拟机逐条执行
- Python 3.11+ 引入 **Specializing Adaptive Interpreter (PEP 659)**：对热点字节码进行特化优化
- Python 3.13 引入实验性 **copy-and-patch JIT**

```python
import dis

def add(a, b):
    return a + b

dis.dis(add)
# 查看字节码指令
#  LOAD_FAST    a
#  LOAD_FAST    b
#  BINARY_ADD
#  RETURN_VALUE
```

### 6.2 PyPy

- 使用 **JIT（Just-In-Time）追踪编译**
- 核心技术：RPython + Tracing JIT
- 工作流程：解释执行 → 热点检测 → 追踪编译 → 生成优化机器码
- 计算密集型任务通常比 CPython 快 **4-10 倍**

### 6.3 对比

| 特性 | CPython | PyPy |
|------|---------|------|
| JIT 编译 | 实验性（3.13） | 成熟的追踪式 JIT |
| C 扩展兼容 | 完全兼容 | 部分兼容 |
| 内存使用 | 较高 | 较低 |
| 启动速度 | 快 | 慢（需预热 JIT） |
| 长时间运行 | 一般 | 显著更快 |

### 6.4 字节码与 `.pyc`

```python
import py_compile
py_compile.compile('example.py')  # 生成 __pycache__/example.cpython-3xx.pyc

import importlib
# .pyc 包含：magic number、flags、源文件时间戳、代码对象
```

---

## 七、常见面试手撕代码题

### 7.1 LRU Cache

```python
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity: int):
        self.cache = OrderedDict()
        self.capacity = capacity

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        self.cache.move_to_end(key)
        return self.cache[key]

    def put(self, key: int, value: int) -> None:
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)  # 移除最老的

# 测试
cache = LRUCache(2)
cache.put(1, 1)
cache.put(2, 2)
print(cache.get(1))    # 1
cache.put(3, 3)        # 淘汰 key=2
print(cache.get(2))    # -1
```

**手撕要点**：`OrderedDict` 的 `move_to_end` 和 `popitem(last=False)` 是关键。

### 7.2 单例模式（三种方式）

```python
# 方式一：__new__
class Singleton:
    _instance = None
    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

# 方式二：装饰器
def singleton(cls):
    instances = {}
    def get_instance(*args, **kwargs):
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]
    return get_instance

@singleton
class MyClass:
    pass

# 方式三：元类
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class MyClass(metaclass=SingletonMeta):
    pass
```

### 7.3 生产者消费者模型

```python
import threading
import queue
import time
import random

_SENTINEL = None  # 哨兵值，通知消费者退出

def producer(q, n):
    for i in range(n):
        item = f"任务-{i}"
        q.put(item)
        print(f"[Producer] 生产: {item}")
        time.sleep(random.uniform(0.1, 0.3))
    q.put(_SENTINEL)

def consumer(q):
    while True:
        item = q.get()
        if item is _SENTINEL:
            q.task_done()
            break
        print(f"[Consumer] 消费: {item}")
        time.sleep(random.uniform(0.2, 0.5))
        q.task_done()

q = queue.Queue(maxsize=5)  # maxsize 实现背压
producers = [threading.Thread(target=producer, args=(q, 3)) for _ in range(2)]
consumers = [threading.Thread(target=consumer, args=(q,), daemon=True) for _ in range(3)]

for t in producers + consumers:
    t.start()
for t in producers:
    t.join()
q.join()  # 等待所有任务完成
print("所有任务完成")
```

**关键点**：`queue.Queue` 内部用 `threading.Condition` 实现线程安全，`list` 不是线程安全的。

### 7.4 手写深拷贝

```python
import copy

def deep_copy(obj, memo=None):
    if memo is None:
        memo = {}

    obj_id = id(obj)
    if obj_id in memo:
        return memo[obj_id]

    if isinstance(obj, (int, float, str, bool, type(None))):
        return obj

    if isinstance(obj, dict):
        result = {}
        memo[obj_id] = result
        for k, v in obj.items():
            result[deep_copy(k, memo)] = deep_copy(v, memo)
        return result

    if isinstance(obj, (list, tuple)):
        result = [deep_copy(item, memo) for item in obj]
        if isinstance(obj, tuple):
            result = tuple(result)
        memo[obj_id] = result
        return result

    # 对于自定义对象，复制 __dict__
    result = obj.__class__.__new__(obj.__class__)
    memo[obj_id] = result
    for k, v in obj.__dict__.items():
        setattr(result, k, deep_copy(v, memo))
    return result
```

### 7.5 手写斐波那契（多种方式）

```python
# 递归（慢，有重复计算）
def fib_recursive(n):
    if n <= 1:
        return n
    return fib_recursive(n-1) + fib_recursive(n-2)

# 迭代（推荐）
def fib_iterative(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

# 生成器
def fib_generator():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

# 带缓存的递归
from functools import lru_cache

@lru_cache(maxsize=None)
def fib_cached(n):
    if n <= 1:
        return n
    return fib_cached(n-1) + fib_cached(n-2)
```

### 7.6 Python 3.10+ match/case

```python
def http_status(status):
    match status:
        case 200:
            return "OK"
        case 404:
            return "Not Found"
        case 418:
            return "I'm a teapot"
        case _:
            return "Unknown status"

# 解构模式
def process_point(point):
    match point:
        case (0, 0):
            return "Origin"
        case (x, 0):
            return f"X-axis at {x}"
        case (0, y):
            return f"Y-axis at {y}"
        case (x, y):
            return f"Point at ({x}, {y})"

# 守卫条件
match command:
    case ["quit"]:
        return "exit"
    case ["go", direction] if direction in ("north", "south", "east", "west"):
        return f"Going {direction}"
    case _:
        return "Unknown command"
```

### 7.7 其他高频手撕题

**快速排序**：
```python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)
```

**归并排序**：
```python
def mergesort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = mergesort(arr[:mid])
    right = mergesort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result
```

**二叉树遍历**：
```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def preorder(root):    # 前序：根-左-右
    return [root.val] + preorder(root.left) + preorder(root.right) if root else []

def inorder(root):     # 中序：左-根-右
    return inorder(root.left) + [root.val] + inorder(root.right) if root else []

def postorder(root):   # 后序：左-右-根
    return postorder(root.left) + postorder(root.right) + [root.val] if root else []

def levelorder(root):  # 层序（BFS）
    if not root: return []
    from collections import deque
    result, queue = [], deque([root])
    while queue:
        level = []
        for _ in range(len(queue)):
            node = queue.popleft()
            level.append(node.val)
            if node.left: queue.append(node.left)
            if node.right: queue.append(node.right)
        result.append(level)
    return result
```

---

## 八、Python 3.10+ 新特性

### 8.1 结构化模式匹配（match/case）

```python
# 基本匹配
def http_status(status):
    match status:
        case 200:
            return "OK"
        case 404:
            return "Not Found"
        case _:
            return "Unknown"

# 解构匹配
def process_data(data):
    match data:
        case {"type": "user", "name": str(name), "age": int(age)}:
            return f"User {name}, age {age}"
        case {"type": "product", "name": str(name), "price": float(price)}:
            return f"Product {name}: ${price}"
        case _:
            return "Unknown data type"
```

### 8.2 类型提示增强

```python
# Python 3.10+ 可以直接用 | 替代 Union
def greet(name: str | None) -> str:
    if name is None:
        return "Hello, World!"
    return f"Hello, {name}!"

# 内置类型可以直接用于类型提示
def process(items: list[int]) -> dict[str, int]:
    return {str(i): i for i in items}
```

### 8.3 其他新特性

- `@cache` 装饰器（Python 3.9+）：简化的 `lru_cache`
- `walrus operator :=`（Python 3.8+）：赋值表达式
- `f-string` 调试格式（Python 3.8+）：`f"{x=}"`
- `asyncio.TaskGroup`（Python 3.11+）：更好的并发任务管理
- `tomllib`（Python 3.11+）：内置 TOML 解析

---

## 参考资源

- [PEP 703 — Making the Global Interpreter Lock Optional](https://peps.python.org/pep-0703/)
- [Python 3.13 What's New](https://docs.python.org/3.13/whatsnew/3.13.html)
- [Python 3.10 What's New (match/case)](https://docs.python.org/3.10/whatsnew/3.10.html)
- [Python 3.12 What's New](https://docs.python.org/3.12/whatsnew/3.12.html)
- [Real Python — Decorators](https://realpython.com/primer-on-python-decorators/)
- [Python Cookbook](https://python-cookbook.readthedocs.io/)
