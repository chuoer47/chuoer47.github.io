---
title: Python 新特性
tags: [Python, 八股]
category: 八股
order: 7
---

# Python 新特性

## 1. match/case 语法 (Python 3.10+)

结构化模式匹配，类似 Rust/Swift 的 match：

```python
# 基本值匹配
def describe_status(code):
    match code:
        case 200:
            return 'OK'
        case 404:
            return 'Not Found'
        case 500:
            return 'Server Error'
        case _:
            return f'Unknown: {code}'

print(describe_status(200))  # OK

# 序列匹配
def process_command(command):
    match command.split():
        case ['quit']:
            print('Quitting')
        case ['load', filename]:
            print(f'Loading {filename}')
        case ['move', direction, steps] if int(steps) > 10:
            print(f'Long move: {direction} {steps} steps')
        case ['move', direction, *steps]:
            print(f'Move {direction} by {len(steps)} steps')

# 类匹配 (requires __match_args__)
class Point:
    __match_args__ = ('x', 'y')
    def __init__(self, x, y):
        self.x = x
        self.y = y

def describe_point(p):
    match p:
        case Point(0, 0):
            return 'Origin'
        case Point(x, 0):
            return f'On X axis at {x}'
        case Point(0, y):
            return f'On Y axis at {y}'
        case Point(x, y):
            return f'Point at ({x}, {y})'

# 字典匹配
def handle_event(event):
    match event:
        case {'type': 'click', 'x': x, 'y': y}:
            print(f'Click at ({x}, {y})')
        case {'type': 'keypress', 'key': key}:
            print(f'Key pressed: {key}')
        case {'type': 'scroll', 'delta': d} if d > 0:
            print('Scroll up')
```

---

## 2. Union 类型 | 替代 (Python 3.10+)

```python
# 旧版
from typing import Union, Optional

def process(value: Union[int, str]) -> Optional[int]:
    if isinstance(value, int):
        return value
    return int(value)

# 新版 (Python 3.10+)
def process(value: int | str) -> int | None:
    if isinstance(value, int):
        return value
    return int(value)

# 类型检查更严格
# Union[int, str] | None  vs  Optional[Union[int, str]]
# 两者等价，但 | 语法更简洁

# 联合类型用于运行时检查
def greet(name: str | None):
    match name:
        case str():
            print(f'Hello, {name}!')
        case None:
            print('Hello, stranger!')

# isinstance 也支持联合类型
x = 5
print(isinstance(x, int | str))  # True
```

---

## 3. TypeVar / ParamSpec / TypeGuard (Python 3.12+)

```python
from typing import TypeVar, ParamSpec, TypeGuard, Callable

# TypeVar — 泛型变量
T = TypeVar('T')
T_co = TypeVar('T_co', covariant=True)       # 协变
T_contra = TypeVar('T_contra', contravariant=True)  # 逆变

def first(lst: list[T]) -> T:
    return lst[0]

print(first([1, 2, 3]))     # int
print(first(['a', 'b']))    # str

# TypeVar 约束
Numeric = TypeVar('Numeric', int, float)

def add(a: Numeric, b: Numeric) -> Numeric:
    return a + b

# ParamSpec — 参数规格 (Python 3.10+)
P = ParamSpec('P')

def decorator(func: Callable[P, T]) -> Callable[P, T]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        print('Before')
        result = func(*args, **kwargs)
        print('After')
        return result
    return wrapper

@decorator
def greet(name: str, greeting: str = 'Hello') -> str:
    return f'{greeting}, {name}!'

# TypeGuard — 类型守卫 (Python 3.10+)
def is_string_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)

def process(data: list[object]):
    if is_string_list(data):
        # data 被窄化为 list[str]
        print(' '.join(data))  # 类型检查器知道这是合法的
    else:
        print('Not all strings')
```

**Python 3.12+ 泛型语法简化**：
```python
# 旧版
from typing import TypeVar, Generic
T = TypeVar('T')
class Stack(Generic[T]):
    def __init__(self) -> None:
        self.items: list[T] = []
    def push(self, item: T) -> None:
        self.items.append(item)

# Python 3.12+ 新语法
class Stack[T]:
    def __init__(self) -> None:
        self.items: list[T] = []
    def push(self, item: T) -> None:
        self.items.append(item)

# 函数泛型
def first[T](lst: list[T]) -> T:
    return lst[0]
```

---

## 4. Walrus Operator := (Python 3.8+)

```python
# 赋值表达式（海象运算符）—— 在表达式中赋值

# 经典用法：while 循环
data = [1, 2, 3, 4, 5]
while (n := len(data)) > 0:
    print(f'Processing, {n} items remaining')
    data.pop()

# 经典用法：列表推导中避免重复计算
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9]
filtered = [y for x in numbers if (y := x ** 2) > 20]
print(filtered)  # [25, 36, 49, 64, 81]

# 经典用法：if 条件中使用计算结果
import re
line = 'User: alice@example.com'
if (m := re.match(r'User: (\w+)', line)):
    print(m.group(1))  # alice

# 经典用法：复杂表达式避免重复
cache = {}
def expensive(x):
    if x not in cache:
        cache[x] = x ** 2 + x ** 3
    result = cache[x]
    return result

# 使用 walrus 简化
def expensive_v2(x):
    return cache[x] if x in cache else (cache[x] := x ** 2 + x ** 3)
```

---

## 5. ExceptionGroup / TaskGroup (Python 3.11+)

```python
import asyncio

# ExceptionGroup — 同时处理多个异常
try:
    raise ExceptionGroup("multiple errors", [
        ValueError("invalid value"),
        TypeError("wrong type"),
        RuntimeError("runtime issue"),
    ])
except* ValueError as eg:
    print(f'ValueErrors: {eg.exceptions}')
except* (TypeError, RuntimeError) as eg:
    print(f'Type/Runtime errors: {len(eg.exceptions)}')

# TaskGroup — 结构化并发
async def fetch(url: str) -> str:
    await asyncio.sleep(0.1)
    if 'bad' in url:
        raise ValueError(f'Failed to fetch {url}')
    return f'data from {url}'

async def main():
    async with asyncio.TaskGroup() as tg:
        task1 = tg.create_task(fetch('url1'))
        task2 = tg.create_task(fetch('url2'))
        # 所有任务完成后才退出 with 块

    print(task1.result())
    print(task2.result())

asyncio.run(main())

# TaskGroup 异常处理
async def main_with_errors():
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(fetch('bad-url'))
            tg.create_task(fetch('good-url'))
    except* ValueError as eg:
        for exc in eg.exceptions:
            print(f'Handled: {exc}')

asyncio.run(main_with_errors())
```

---

## 6. f-string 改进 (Python 3.12+)

```python
# Python 3.12: f-string 中可以使用引号
name = "World"
print(f"Hello {"World"}")  # 旧版 SyntaxError, 3.12 OK

# 嵌套 f-string
data = {'name': 'Alice', 'age': 30}
print(f"{'Name: ' + f'{data["name"]}' + ', Age: ' + f'{data["age"]}'}")

# 多行 f-string（Python 3.12 允许嵌套引号）
msg = f"""
This is a long message:
  - Name: {data["name"]}
  - Age: {data["age"]}
"""

# 调试模式 (Python 3.8+)
x = 42
print(f'{x=}')  # x=42
print(f'{x + 1=}')  # x + 1=43

# 格式化规范
pi = 3.14159265
print(f'{pi:.2f}')      # 3.14
print(f'{pi:10.2f}')    # '      3.14'
print(f'{1000000:,}')    # 1,000,000
print(f'{0.25:%}')       # 25.0000%
print(f'{255:#010x}')   # 0x000000ff
```

---

## 7. type 语句 (Python 3.12+)

```python
# Python 3.12: 类型别名语法
# 旧版
from typing import TypeAlias
Vector: TypeAlias = list[float]

# 新版
type Vector = list[float]
type Matrix = list[Vector]
type Point = tuple[float, float]

# 参数化类型别名
type JSON = str | int | float | bool | None | list['JSON'] | dict[str, 'JSON']

def process(data: JSON) -> None:
    match data:
        case list():
            for item in data:
                process(item)
        case dict():
            for value in data.values():
                process(value)
        case _:
            print(data)

# 泛型类型别名
type Result[T] = tuple[bool, T | None, str | None]

def divide(a: float, b: float) -> Result[float]:
    if b == 0:
        return (False, None, 'Division by zero')
    return (True, a / b, None)

success, value, error = divide(10, 3)
print(f'{success}, {value}, {error}')  # True, 3.333..., None
```

---

## 8. @override 装饰器 (Python 3.12+)

```python
from typing import override

class Base:
    def get_color(self) -> str:
        return 'blue'

    def get_name(self) -> str:
        return 'Base'

class Child(Base):
    @override
    def get_color(self) -> str:  # 正确重写
        return 'red'

    # @override
    # def get_nme(self) -> str:  # 拼写错误，类型检查器会报错!
    #     return 'Child'

    # @override
    # def unused_method(self) -> str:  # 父类没有此方法，类型检查器报错!
    #     pass
```

**`@override` 的作用**：
- 明确表示这是一个重写方法
- 类型检查器（mypy, pyright）会验证父类确实有此方法
- 防止拼写错误导致的静默 bug
- 运行时是 no-op（不产生任何运行时开销）

---

## 9. No-GIL — PEP 703 (Python 3.13+)

```python
import sys

# PEP 703: Making the Global Interpreter Lock Optional

# 编译 Python 时启用 no-GIL
# ./configure --disable-gil
# 运行：python3.13t (t 后缀表示 free-threaded build)

# 检查是否为 free-threaded build
if hasattr(sys, '_is_gil_enabled'):
    print(f'GIL enabled: {sys._is_gil_enabled()}')
else:
    print('Free-threaded build not available')

# 禁用/启用 GIL
import sys
if hasattr(sys, '_disable_gil'):
    sys._disable_gil()  # 禁用 GIL
    # 从此刻起，多线程可以真正并行执行 CPU 密集型任务
    sys._enable_gil()   # 重新启用

# PEP 703 的核心改动：
# 1. 每个对象的引用计数使用原子操作（原子增减）
# 2. 引入 "deferred reference counting" — 某些对象不立即释放
# 3. per-object locks — 每个对象有自己的锁
# 4. biirectional GC — 改进的垃圾回收器

# 对比 GIL vs No-GIL
# GIL 模式（传统）：
# - 同一时刻只有一个线程执行字节码
# - 简单的引用计数（非原子）
# - 低锁开销

# No-GIL 模式：
# - 多个线程可以并行执行字节码
# - 原子引用计数（略有性能开销）
# - 每个对象有自己的锁
# - 真正的多核并行
```

**迁移注意事项**：
```python
# 1. 检查代码中的线程安全问题
import threading

class Counter:
    def __init__(self):
        self.value = 0  # 在 no-GIL 模式下需要原子操作

    # GIL 模式下看似安全，但 no-GIL 下不安全
    def increment_bad(self):
        self.value += 1  # 非原子操作!

    # no-GIL 安全的方式
    def __init__(self):
        self._lock = threading.Lock()
        self.value = 0

    def increment_safe(self):
        with self._lock:
            self.value += 1

# 2. 使用 concurrent.futures.ProcessPoolExecutor 替代 ThreadPoolExecutor 的场景
# 现在可以直接用 ThreadPoolExecutor，性能接近 ProcessPoolExecutor
from concurrent.futures import ThreadPoolExecutor
import time

def cpu_bound(n):
    return sum(range(n))

with ThreadPoolExecutor(max_workers=4) as executor:
    futures = [executor.submit(cpu_bound, 10_000_000) for _ in range(4)]
    results = [f.result() for f in futures]
```

**面试要点**：PEP 703 是 Python 历史上最重大的架构变更之一。虽然目前仍是实验性的，但它将从根本上改变 Python 处理多线程的方式，使 CPU 密集型多线程程序真正受益于多核 CPU。
