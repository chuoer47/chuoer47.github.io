---
title: Python 解释器
tags: [Python, 八股]
category: 八股
order: 6
---

# Python 解释器

## 1. CPython 执行流程 — 6 阶段

CPython 执行 Python 代码的完整流程分为 6 个阶段：

```
源代码 (.py)
    ↓
1. 词法分析 (Lexical Analysis)
    ↓
Token 流
    ↓
2. 语法分析 (Parsing)
    ↓
抽象语法树 (AST)
    ↓
3. 编译 (Compilation)
    ↓
代码对象 (Code Object)
    ↓
4. 字节码生成 (Bytecode Generation)
    ↓
字节码 (.pyc)
    ↓
5. 虚拟机执行 (Virtual Machine Execution)
    ↓
执行结果
```

### 阶段详解

```python
# 1. 词法分析：将源代码拆分为 Token
# 'def foo(x):' → NAME('def') NAME('foo') OP('(') NAME('x') OP(')') OP(':')

# 2. 语法分析：构建 AST
import ast
code = 'x = 1 + 2'
tree = ast.parse(code)
print(ast.dump(tree, indent=2))
# Module(
#   body=[
#     Assign(
#       targets=[Name(id='x', ctx=Store())],
#       value=BinOp(
#         left=Constant(value=1),
#         op=Add(),
#         right=Constant(value=2)
#       )
#     )
#   ]
# )

# 3. 编译 + 4. 字节码生成
code_obj = compile(tree, '<test>', 'exec')
print(code_obj.co_consts)    # (None, 1, 2)
print(code_obj.co_varnames)  # ('x',)

# 5. 虚拟机执行
exec(code_obj)
```

---

## 2. dis — 字节码反汇编

```python
import dis

# 查看函数的字节码
def add(a, b):
    return a + b

print(dis.dis(add))
#  2           0 LOAD_FAST                0 (a)
#              2 LOAD_FAST                1 (b)
#              4 BINARY_ADD
#              6 RETURN_VALUE

# 更详细的分析
print(dis.Bytecode(add))
for instr in dis.get_instructions(add):
    print(f'{instr.offset:4d} {instr.opname:25s} {instr.argval}')

# 分析循环
def loop_example():
    total = 0
    for i in range(10):
        total += i
    return total

dis.dis(loop_example)
# 可以看到 FOR_ITER, JUMP_ABSOLUTE 等指令
```

**常见字节码指令**：

| 指令 | 说明 |
|------|------|
| `LOAD_FAST` | 加载局部变量 |
| `STORE_FAST` | 存储局部变量 |
| `LOAD_GLOBAL` | 加载全局变量 |
| `CALL_FUNCTION` | 调用函数 |
| `BINARY_ADD` | 二元加法 |
| `RETURN_VALUE` | 返回值 |
| `JUMP_ABSOLUTE` | 无条件跳转 |
| `FOR_ITER` | 迭代器的 for 循环 |

---

## 3. PEP 659 — 特化解释器 (Specializing Adaptive Interpreter)

Python 3.11+ 引入的**自适应特化**机制：

```
通用字节码 (Generic)
    ↓ 运行时 profiling
特化字节码 (Specialized)
    ↓ 如果假设失败
去特化 (Deoptimize) → 回到通用字节码
```

```python
# PEP 659 优化示例
def add_numbers(a, b):
    return a + b

# 首次调用：使用通用 BINARY_ADD
# 如果检测到参数都是 int → 特化为 BINARY_ADD_INT
# 如果检测到参数都是 float → 特化为 BINARY_ADD_FLOAT
# 字符串拼接 → BINARY_ADD_UNICODE

# 查看特化统计 (Python 3.11+)
import sys
if sys.version_info >= (3, 11):
    # 运行前
    # 运行后
    # sys._stats_list 查看特化统计
    pass
```

**特化的类型**：
- `BINARY_ADD` → `BINARY_ADD_INT` / `BINARY_ADD_FLOAT` / `BINARY_ADD_UNICODE`
- `LOAD_ATTR` → `LOAD_ATTR_INSTANCE_VALUE` / `LOAD_ATTR_MODULE` 等
- `COMPARE_OP` → `COMPARE_OP_INT` / `COMPARE_OP_FLOAT`

---

## 4. Python 3.13 JIT — Copy-and-Patch

Python 3.13 引入的实验性 JIT 编译器：

```
字节码
    ↓ 模板匹配
预编译的机器码模板 (Stencils)
    ↓ Copy-and-Patch
特化的机器码
    ↓
CPU 直接执行
```

```python
# Copy-and-Patch JIT 的工作原理：
# 1. 预编译：为每个字节码指令生成机器码模板（stencil）
# 2. 运行时：检测热点代码
# 3. 复制：复制模板到内存
# 4. 补丁：用实际值替换模板中的占位符
# 5. 执行：直接执行机器码

# 开启 JIT（实验性）
# Python 3.13 编译时：./configure --enable-experimental-jit
# 运行时：PYTHON_JIT=1 python3.13 script.py

import sys
print(sys.version_info >= (3, 13))  # True if 3.13+
```

**Copy-and-Patch vs 传统 JIT**：
- 不需要中间表示（IR），直接从字节码到机器码
- 编译速度极快（微秒级）
- 编译质量较低（但足够快）
- 适合 Python 这种高度动态的语言

---

## 5. PyPy — Tracing JIT

PyPy 使用**跟踪 JIT** 编译器，与 CPython 的解释执行不同：

```
Python 代码
    ↓
解释执行（JIT 未介入）
    ↓ 检测热点循环
跟踪循环执行路径
    ↓
生成优化的机器码
    ↓ 缓存执行 trace
重复执行（高速）
```

```python
# PyPy 特点：
# 1. 无 GIL（使用 STM，Software Transactional Memory）
# 2. 高度优化的垃圾回收器
# 3. 与 CPython 80% 兼容
# 4. 适合计算密集型循环代码

# PyPy vs CPython 性能对比（示例）
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# CPython: fibonacci(35) ≈ 4-5 秒
# PyPy:    fibonacci(35) ≈ 0.5-1 秒

# PyPy 不适合：
# - 大量使用 C 扩展的代码（需要 cpyext 兼容层）
# - 启动时间敏感的脚本（JIT 预热需要时间）
# - 内存受限环境（JIT 缓存占用额外内存）
```

---

## 6. pyc 文件格式

```python
import py_compile, dis, struct

# 生成 .pyc 文件
py_compile.compile('example.py', cfile='example.pyc')

# .pyc 文件结构（简化）：
# Magic Number (4 bytes)    — Python 版本标识
# Flags (4 bytes)           — 标志位
# Source Size (8 bytes)     — 源文件大小（可选）
# Source Hash (8 bytes)     — 源文件哈希（可选）
# Timestamp (4 bytes)       — 源文件修改时间
# Code Object               — 编译后的代码对象

# 查看 magic number
import importlib.util
print(f'Magic: {importlib.util.MAGIC_NUMBER.hex()}')  # 例如: 610d0d0a

# .pyc 失效条件：
# 1. Python 版本变化（magic number 改变）
# 2. 源文件修改时间变化
# 3. 源文件大小变化（flags 中包含源文件大小时）
# 4. 源文件内容哈希变化（flags 中包含哈希时）

# __pycache__ 目录
# 3.8+: example.cpython-38.pyc
# __pycache__/example.cpython-311.pyc
```

```python
# 手动查看 code object 属性
def example(x, y):
    z = x + y
    return z * 2

code = example.__code__
print(f'co_varnames: {code.co_varnames}')    # ('x', 'y', 'z')
print(f'co_consts: {code.co_consts}')        # (None, 2)
print(f'co_code: {code.co_code.hex()}')      # 字节码的十六进制
print(f'co_stacksize: {code.co_stacksize}')  # 栈深度
print(f'co_flags: {code.co_flags:#x}')       # 标志位
```

---

## 7. importlib 机制

```python
import importlib
import importlib.util
import sys

# 标准 import 流程
import os
# 实际执行：
# 1. 在 sys.modules 中查找 'os'
# 2. 如果找不到，创建 ModuleSpec
# 3. 根据 ModuleSpec 找到模块文件
# 4. 编译 .pyc（如果需要）
# 5. 创建模块对象
# 6. 执行模块代码
# 7. 将模块存入 sys.modules

# 手动导入
spec = importlib.util.spec_from_file_location('mymodule', '/path/to/mymodule.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(module)

# 动态导入
def dynamic_import(module_name):
    if module_name in sys.modules:
        return sys.modules[module_name]
    try:
        return importlib.import_module(module_name)
    except ImportError as e:
        print(f'Failed to import {module_name}: {e}')
        return None

# 查看导入路径
print(sys.path)            # 模块搜索路径
print(sys.meta_path)       # 导入钩子列表
print(sys.path_hooks)      # 路径钩子列表

# 自定义导入钩子
class Finder:
    def find_module(self, fullname, path=None):
        if fullname == 'custom_module':
            return self
        return None

    def load_module(self, fullname):
        if fullname in sys.modules:
            return sys.modules[fullname]
        # 创建并缓存模块
        module = type(sys)('custom_module')
        module.custom_value = 42
        sys.modules[fullname] = module
        return module

# sys.meta_path.insert(0, Finder())
# import custom_module  # 使用自定义查找器
```

**面试要点**：`importlib` 允许动态加载模块，是插件系统和延迟加载的基础。`sys.modules` 缓存确保每个模块只执行一次。
