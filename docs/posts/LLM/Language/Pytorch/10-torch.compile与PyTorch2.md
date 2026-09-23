---
title: "torch.compile 与 PyTorch 2"
date: 2026-06-22
tags: [PyTorch, torch.compile, PyTorch2, 深度学习]
category: AI
order: 10
---

# torch.compile 与 PyTorch 2

PyTorch 2.0 是 PyTorch 历史上最重要的版本升级之一，其核心特性 `torch.compile` 为模型训练和推理带来了显著的性能提升，同时保持了 PyTorch 一贯的易用性。本文将全面介绍 PyTorch 2.0 的核心变化、`torch.compile` 的使用与原理、`torch.export` 模型导出，以及 PyTorch 2.x 生态系统的其他新特性。

---

## PyTorch 2.0 核心变化概述

PyTorch 2.0 的核心目标是在不牺牲易用性和灵活性的前提下，大幅提升模型的执行效率。主要变化包括：

1. **torch.compile**：一键编译模型，通过捕获计算图并生成优化代码，实现 20%-200% 的训练和推理加速。
2. **编译栈重构**：引入 TorchDynamo、AOTAutograd、TorchInductor 三层编译架构，实现模块化和可扩展的编译流程。
3. **torch.export**：提供标准化的模型导出格式，替代和改进了 `torch.jit.trace`/`torch.jit.script`。
4. **函数式变换（torch.func）**：提供 `vmap`、`grad`、`jacrev` 等函数式编程工具。
5. **更好的分布式支持**：与 FSDP、DDP 的无缝集成。
6. **硬件后端扩展**：更好的支持 AMD GPU、Intel GPU、Apple MPS 等。

PyTorch 2.0 的设计哲学是「渐进式采用」——你可以将 `torch.compile` 视为一个可选的加速层，现有代码无需大幅修改即可使用。

---

## torch.compile 详解

### 基本用法与参数

`torch.compile` 接受一个 `nn.Module`（或其他可调用对象），返回一个编译后的版本。调用方式极其简单：

```python
import torch
import torch.nn as nn

# 定义模型
model = nn.Sequential(
    nn.Linear(784, 256),
    nn.ReLU(),
    nn.Linear(256, 10),
)

# 一行代码完成编译
compiled_model = torch.compile(model)

# 使用方式与原始模型完全相同
x = torch.randn(32, 784)
output = compiled_model(x)  # 首次调用会触发编译
```

`torch.compile` 的完整参数：

```python
compiled_model = torch.compile(
    model,                          # 要编译的模型或可调用对象
    fullgraph=False,                # 是否要求整个模型为一个完整计算图
    dynamic=None,                   # 是否使用动态 shape（None 为自动判断）
    backend="inductor",             # 编译后端，默认为 inductor
    mode="default",                 # 编译模式
    options=None,                   # 传递给后端的额外选项
    disable=False,                  # 是否禁用编译（用于调试）
)
```

### 编译模式

`torch.compile` 提供三种编译模式，针对不同的优化目标：

| 模式 | 优化目标 | 首次编译时间 | 运行速度 | 适用场景 |
|------|----------|-------------|---------|----------|
| `default` | 平衡编译时间和运行速度 | 中等 | 快 | 通用训练和推理 |
| `reduce-overhead` | 最小化框架开销 | 较快 | 较快 | 小模型、小 batch、推理延迟敏感 |
| `max-autotune` | 最大化运行速度 | 慢 | 最快 | 大模型、对吞吐量要求高 |

```python
# 默认模式
model_default = torch.compile(model, mode="default")

# 减少框架开销模式（使用 CUDA Graphs）
model_reduce = torch.compile(model, mode="reduce-overhead")

# 最大自动调优模式（搜索最优内核配置）
model_max = torch.compile(model, mode="max-autotune")
```

### 完整使用示例

```python
import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms
from torch.utils.data import DataLoader


class ResBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = torch.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        return torch.relu(out + residual)


class SmallResNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            ResBlock(32),
            nn.MaxPool2d(2),
            ResBlock(32),
            nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Linear(32, 10)

    def forward(self, x):
        x = self.features(x)
        x = x.view(x.size(0), -1)
        return self.classifier(x)


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # 数据
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,)),
    ])
    train_data = datasets.MNIST("./data", train=True, download=True,
                                 transform=transform)
    train_loader = DataLoader(train_data, batch_size=128, shuffle=True,
                              num_workers=4, pin_memory=True)

    # 模型
    model = SmallResNet().to(device)

    # ---- 编译模型 ----
    compiled_model = torch.compile(model, mode="default")

    # 优化器和损失函数
    optimizer = optim.Adam(compiled_model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    # 训练循环
    compiled_model.train()
    for epoch in range(5):
        total_loss = 0
        for data, target in train_loader:
            data, target = data.to(device), target.to(device)
            optimizer.zero_grad()
            output = compiled_model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        avg_loss = total_loss / len(train_loader)
        print(f"Epoch {epoch + 1}, Avg Loss: {avg_loss:.4f}")

    # 推理
    compiled_model.eval()
    with torch.no_grad():
        sample = torch.randn(1, 1, 28, 28, device=device)
        prediction = compiled_model(sample)
        print(f"预测类别: {prediction.argmax(dim=1).item()}")


if __name__ == "__main__":
    main()
```

### 性能对比数据

在不同模型和任务上，`torch.compile` 的典型加速效果：

| 模型 | 任务 | 原始速度 | 编译后速度 | 加速比 |
|------|------|---------|-----------|--------|
| ResNet-50 | 图像分类训练 | 基准 | 约 1.3x-1.5x | 30%-50% |
| BERT-base | 文本分类训练 | 基准 | 约 1.2x-1.4x | 20%-40% |
| ViT-B/16 | 图像分类推理 | 基准 | 约 1.5x-2.0x | 50%-100% |
| GPT-2 | 文本生成推理 | 基准 | 约 1.3x-1.8x | 30%-80% |
| 小型 CNN | 推理（小 batch） | 基准 | 约 1.5x-3.0x | 50%-200% |

```python
# 性能基准测试代码
import torch
import time

model = MyModel().cuda().eval()
compiled_model = torch.compile(model, mode="max-autotune")
x = torch.randn(64, 3, 224, 224, device="cuda")

# 预热（编译在此时发生）
for _ in range(3):
    _ = compiled_model(x)
torch.cuda.synchronize()

# 计时
def benchmark(model, input_tensor, num_runs=100):
    torch.cuda.synchronize()
    start = time.perf_counter()
    for _ in range(num_runs):
        _ = model(input_tensor)
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - start
    return elapsed / num_runs

original_time = benchmark(model, x)
compiled_time = benchmark(compiled_model, x)

print(f"原始模型: {original_time * 1000:.2f} ms/iter")
print(f"编译模型: {compiled_time * 1000:.2f} ms/iter")
print(f"加速比: {original_time / compiled_time:.2f}x")
```

---

## 编译栈原理

PyTorch 2.0 的编译栈由三个核心组件构成，它们协同工作将 Python 代码转换为高效的机器码。

### TorchDynamo：Python 字节码捕获

TorchDynamo 是编译栈的第一层，负责从 Python 代码中捕获计算图。它的核心创新在于：**无需修改 Python 运行时**，通过字节码分析（Bytecode Analysis）在运行时动态捕获 PyTorch 操作。

工作流程：

1. 在模型的 `forward` 方法被调用时，TorchDynamo 拦截 Python 字节码。
2. 遇到 PyTorch 操作（如 `torch.mm`、`F.relu`）时，记录到 FX Graph 中。
3. 遇到非 PyTorch 的 Python 代码时，判断是否可以内联处理。
4. 如果遇到无法处理的操作，产生 **Graph Break**，将图分为多个子图分别编译。

```python
import torch

# TorchDynamo 的核心接口（torch.compile 内部使用）
def my_function(x, w):
    return torch.relu(x @ w)

# 使用 torch.compile 等价于调用 TorchDynamo 捕获图
compiled_fn = torch.compile(my_function)

# 使用 TorchDynamo 的底层 API 查看捕获的图
from torch._dynamo import explain

explanation = explain(my_function)(
    torch.randn(10, 10), torch.randn(10, 10)
)
print(explanation)
# 输出会显示捕获的图数量、Graph Break 原因等信息
```

**Graph Break 概念：**

Graph Break 是指 TorchDynamo 在捕获计算图时遇到无法处理的代码，被迫将图分成多个片段的情况。

```python
# ---- 会导致 Graph Break 的代码 ----
def problematic_fn(x):
    x = torch.relu(x)

    # Graph Break: Python print 语句
    print(f"中间结果形状: {x.shape}")

    x = x @ x.T
    return x

# ---- 不会导致 Graph Break 的修改 ----
def fixed_fn(x):
    x = torch.relu(x)
    # 使用 torch._dynamo.graph_break() 显式标记断点
    # 或者将 print 移到编译区域之外
    x = x @ x.T
    return x

# ---- 查看 Graph Break 详情 ----
import torch._dynamo as dynamo

@dynamo.explain
def fn_with_breaks(x):
    x = torch.relu(x)
    if x.sum() > 0:  # 数据依赖的控制流导致 Graph Break
        x = x * 2
    return x

explanation = fn_with_breaks(torch.randn(10, 10))
print(explanation)
```

### TorchInductor：代码生成与内核融合

TorchInductor 是默认的编译后端，负责将捕获的 FX Graph 转换为高效的机器码。

核心能力：

1. **内核融合（Kernel Fusion）**：将多个小操作合并为一个 GPU 内核，减少显存读写和内核启动开销。
2. **代码生成**：为 NVIDIA GPU 生成 Triton 代码，为 CPU 生成 C++/OpenMP 代码。
3. **自动调优**：在 `max-autotune` 模式下，搜索最优的内核配置。

```python
# 内核融合示例
# 以下操作在 eager 模式下需要多次显存读写
def unfused(x, w, b):
    y = x @ w        # 内核 1: 读 x,w -> 写 y
    y = y + b        # 内核 2: 读 y,b -> 写 y
    y = torch.relu(y) # 内核 3: 读 y -> 写 y
    return y          # 总计: 3 次内核启动，6 次显存访问

# TorchInductor 融合后
# y = relu(x @ w + b)  变成单个内核
# 总计: 1 次内核启动，2 次显存读 (x,w,b) + 1 次显存写 (y)

# 选择不同后端
compiled_default = torch.compile(model, backend="inductor")  # 默认
compiled_eager = torch.compile(model, backend="eager")       # 仅捕获图，不编译
```

### AOTAutograd：提前编译时的自动求导

AOTAutograd（Ahead-of-Time Autograd）负责在编译阶段自动生成反向传播图，使得编译器能够同时优化前向和反向传播。

传统方式中，反向传播在运行时通过 PyTorch 的动态图自动微分实现。AOTAutograd 将这一过程提前到编译阶段：

```python
# AOTAutograd 的工作原理（简化说明）
import torch
from functorch.compile import aot_module

def my_compiler(gm, example_inputs):
    """自定义编译器：接收 FX Graph 和示例输入"""
    print("前向图:")
    print(gm.graph)
    return gm.forward

def my_compiler_bwd(gm, example_inputs):
    """反向编译器"""
    print("反向图:")
    print(gm.graph)
    return gm.forward

# AOT 编译：同时捕获前向和反向图
# aot_module 会在编译阶段通过 tracing 推导出反向图
model = nn.Linear(10, 5)
compiled_model = aot_module(model, fw_compiler=my_compiler,
                             bw_compiler=my_compiler_bwd)
```

### 编译流程图解

`torch.compile` 的完整编译流程如下：

```
用户代码 (Python)
      |
      v
[TorchDynamo] ---- 字节码分析 ----> FX Graph (计算图)
      |                                    |
      | (遇到 Graph Break 时拆分)           |
      v                                    v
多个子图 (Sub-Graphs)              [AOTAutograd]
      |                            生成前向+反向图
      v                                    |
[TorchInductor]                            |
  - 内核融合                               |
  - 代码生成 (Triton/C++)                  |
  - 自动调优                               |
      |                                    |
      v                                    v
优化后的可执行代码 (Optimized Compiled Code)
      |
      v
高效执行 (训练/推理)
```

在编译过程中：

1. **首次调用**：触发完整编译流程，此步骤较慢（秒到分钟级别）。
2. **后续调用**：直接执行编译后的代码，速度显著提升。
3. **动态 shape 支持**：编译器会缓存不同 shape 的编译结果，避免重复编译。
4. **Graph Break 处理**：每个子图独立编译，在子图边界通过 Python 回调衔接。

---

## torch.export 介绍

### 与 torch.jit.trace/script 的区别

`torch.export` 是 PyTorch 2.0 引入的新模型导出机制，旨在替代和改进 `torch.jit.trace` 和 `torch.jit.script`。

| 特性 | torch.jit.trace | torch.jit.script | torch.export |
|------|-----------------|------------------|-------------|
| 捕获方式 | 运行一次追踪 | 解析 Python 源码 | 基于 TorchDynamo |
| 数据依赖控制流 | 不支持 | 支持 | 支持 |
| 动态 shape | 不支持 | 有限支持 | 原生支持 |
| Python 特性支持 | 有限 | 受限 | 更广泛 |
| 输出格式 | TorchScript IR | TorchScript IR | FX Graph + 标准化格式 |
| 与编译栈集成 | 无 | 无 | 深度集成 |
| 调试难度 | 低 | 高 | 中等 |

### 导出模型与运行

```python
import torch
import torch.nn as nn

# 定义模型
class MyModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 5)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.linear(x))

model = MyModel()
model.eval()

# ---- 导出模型 ----
# 示例输入（用于追踪计算图）
example_input = torch.randn(1, 10)

# 使用 torch.export 导出
exported_program = torch.export.export(model, (example_input,))
print(type(exported_program))  # <class 'torch.export.ExportedProgram'>

# 查看导出的计算图
print(exported_program.graph)

# ---- 运行导出的模型 ----
# 与原始模型使用方式相同
x = torch.randn(4, 10)
output = exported_program.module()(x)
print(output.shape)  # torch.Size([4, 5])

# 也可以直接调用
output = exported_program(x)
```

### ExportedProgram 概念

`ExportedProgram` 是 `torch.export` 的输出对象，它包含：

1. **计算图（Graph）**：标准化的 FX Graph，描述模型的前向计算逻辑。
2. **参数字典（State Dict）**：模型的权重参数。
3. **元数据（Metadata）**：输入 shape 约束、动态维度标记等。
4. **图签名（Graph Signature）**：输入输出的规范定义。

```python
import torch

model = MyModel().eval()
example_input = torch.randn(1, 10)

exported = torch.export.export(model, (example_input,))

# 访问计算图
for node in exported.graph.nodes:
    print(f"节点: {node.name}, 操作: {node.op}, 目标: {node.target}")

# 访问参数
for name, param in exported.state_dict.items():
    print(f"参数: {name}, 形状: {param.shape}")

# 动态 shape 导出
batch_size = torch.export.Dim("batch_size", min=1, max=64)
exported_dynamic = torch.export.export(
    model,
    (example_input,),
    dynamic_shapes={"x": {0: batch_size}},
)

# 导出后保存到文件
import os
torch.export.save(exported, "model_exported.pt2")

# 加载导出的模型
loaded_model = torch.export.load("model_exported.pt2")
```

### torch.export 的限制

```python
# torch.export 要求模型是可完整追踪的

# ---- 不支持的情况 ----
# 1. 数据依赖的 Python 控制流
class UnsupportedModel(nn.Module):
    def forward(self, x):
        if x.sum() > 0:  # 数据依赖的条件判断
            return x * 2
        return x * 3

# 解决方案：使用 torch.cond（PyTorch 2.1+）
from torch.export import Dim

class SupportedModel(nn.Module):
    def forward(self, x):
        return torch.cond(
            x.sum() > 0,
            lambda x: x * 2,
            lambda x: x * 3,
            (x,),
        )

# 2. 不支持的 Python 特性
# - 动态类型转换
# - 外部库调用（如 numpy）
# - 某些原地操作

# 使用 strict=False 模式（更宽松的追踪）
exported = torch.export.export(
    model, (example_input,), strict=False
)
```

---

## torch.compile 常见问题与兼容性

### 不支持的 Python 特性

TorchDynamo 无法捕获以下类型的代码，会导致 Graph Break：

```python
# 1. Python 原生 I/O 操作
def fn_with_io(x):
    print(x)              # 会导致 Graph Break
    return x + 1

# 2. 异常处理中的复杂逻辑
def fn_with_exception(x):
    try:
        return x / 0
    except ZeroDivisionError:
        return x           # 可能导致 Graph Break

# 3. 外部库调用（如 numpy）
import numpy as np
def fn_with_numpy(x):
    np_x = x.numpy()       # 会导致 Graph Break
    return torch.from_numpy(np_x)

# 4. 动态属性访问
def fn_with_dynamic_attr(x, model):
    weight = getattr(model, "weight")  # 可能导致 Graph Break
    return x @ weight

# 5. 复杂的 Python 数据结构操作
def fn_with_complex_data(x, my_dict):
    return x + my_dict["key"]  # 字典访问可能触发 Graph Break
```

### Graph Break 处理

```python
import torch

# ---- 方法一：使用 torch._dynamo.explain 诊断 ----
@torch.compile
def my_model(x):
    x = torch.relu(x)
    print("debug:", x.shape)  # Graph Break
    return x @ x.T

# 运行一次后查看解释
from torch._dynamo import explain
explanation = explain(my_model)(torch.randn(10, 10))
# 输出会告诉你哪些地方产生了 Graph Break

# ---- 方法二：使用 allow_in_graph 标记已知安全的函数 ----
@torch.compiler.allow_in_graph
def my_custom_op(x, w):
    # 这个函数会被直接加入计算图，不产生 Graph Break
    return torch.relu(x @ w)

# ---- 方法三：使用 torch._dynamo.disable 禁用特定函数的编译 ----
@torch.compiler.disable
def debug_print(x):
    print(f"Shape: {x.shape}")
    return x

def my_model(x):
    x = torch.relu(x)
    x = debug_print(x)  # 此函数不会被编译，但不会导致整个图断裂
    return x @ x.T

# ---- 方法四：使用 fullgraph 强制要求完整图 ----
try:
    compiled_model = torch.compile(model, fullgraph=True)
    # 如果有 Graph Break，会抛出异常而非静默回退
except torch._dynamo.exc.Unsupported as e:
    print(f"模型无法完整编译: {e}")
```

### 调试方法（TORCH_LOGS 环境变量）

PyTorch 2.0 提供了丰富的日志系统用于调试编译问题：

```bash
# 查看 Dynamo 的日志
TORCH_LOGS="+dynamo" python train.py

# 查看 Inductor 的日志
TORCH_LOGS="+inductor" python train.py

# 查看所有编译相关日志
TORCH_LOGS="+dynamo,+inductor,aot" python train.py

# 查看 Graph Break 信息
TORCH_LOGS="graph_breaks" python train.py

# 查看输出代码
TORCH_LOGS="output_code" python train.py

# 在 Python 代码中设置
import torch._logging
torch._logging.set_logs(dynamo=True, inductor=True)
```

```python
# ---- 使用 torch._dynamo 诊断工具 ----
import torch
import torch._dynamo as dynamo

# 1. 重置编译缓存（当遇到奇怪问题时尝试）
dynamo.reset()

# 2. 统计 Graph Break 数量
@dynamo.explain
def my_fn(x):
    x = torch.relu(x)
    if x.sum() > 0:
        x = x * 2
    return x

explanation = my_fn(torch.randn(10, 10))
print(f"Graph 数量: {len(explanation.graphs)}")
print(f"Graph Break 原因: {explanation.break_reasons}")

# 3. 单步调试：使用 eager 后端只捕获图不编译
model_eager = torch.compile(model, backend="eager")

# 4. 计时标记
import time

# 标记编译完成
torch.compiler.cudagraph_mark_step_begin()

# 5. 查看编译后的代码
import torch._inductor.config
torch._inductor.config.debug = True  # 输出生成的 Triton/C++ 代码
```

---

## PyTorch 2.x 其他新特性

### torch.func：函数式变换

`torch.func`（前身是 `functorch`）提供了一套函数式编程工具，与 `torch.compile` 深度集成。

**vmap（向量化映射）**：自动将函数向量化，替代手动编写 batch 维度的逻辑。

```python
import torch
from torch.func import vmap

# 单样本处理函数
def predict_single(model, x):
    """处理单个样本"""
    return model(x.unsqueeze(0)).squeeze(0)

# 使用 vmap 自动批量化
predict_batch = vmap(predict_single, in_dims=(None, 0))

model = nn.Linear(10, 5)
batch = torch.randn(32, 10)

# 自动将 predict_single 应用于 batch 中的每个样本
output = predict_batch(model, batch)
print(output.shape)  # torch.Size([32, 5])
```

**grad（自动微分）**：函数式风格的梯度计算。

```python
import torch
from torch.func import grad, grad_and_value

def loss_fn(params, x, y):
    """计算损失（使用函数式参数传递）"""
    # 使用 functional_call 将参数应用到模型
    from torch.func import functional_call
    model = MyModel()
    pred = functional_call(model, params, x)
    return torch.nn.functional.mse_loss(pred, y)

# 计算梯度
params = dict(model.named_parameters())
x = torch.randn(32, 10)
y = torch.randn(32, 5)

grad_fn = grad(loss_fn)
gradients = grad_fn(params, x, y)

# 同时获取梯度和损失值
grad_and_val_fn = grad_and_value(loss_fn)
gradients, loss_value = grad_and_val_fn(params, x, y)
```

**jacrev 和 jacfwd（雅可比矩阵）**：计算函数的雅可比矩阵。

```python
import torch
from torch.func import jacrev, jacfwd

def fn(x):
    return torch.stack([x.sum(), x.prod(), x.norm()])

x = torch.randn(4)

# 使用反向模式自动微分计算雅可比矩阵
jacobian = jacrev(fn)(x)
print(f"雅可比矩阵形状: {jacobian.shape}")  # torch.Size([3, 4])

# 使用前向模式（适合输出维度大于输入维度的场景）
jacobian_fwd = jacfwd(fn)(x)
print(f"前向雅可比形状: {jacobian_fwd.shape}")  # torch.Size([3, 4])

# 与 torch.compile 配合使用
compiled_jacrev = torch.compile(jacrev(fn))
```

### FP8 支持

FP8 是一种 8 位浮点格式，进一步降低了显存占用和计算需求。PyTorch 2.1+ 开始提供实验性 FP8 支持。

FP8 有两种变体：

| 格式 | 指数位 | 尾数位 | 适用场景 |
|------|--------|--------|----------|
| E4M3 | 4 | 3 | 前向传播（更高精度） |
| E5M2 | 5 | 2 | 反向传播（更大范围） |

```python
import torch

# 检查是否支持 FP8（需要 H100 或更新的 GPU）
if torch.cuda.is_available():
    capability = torch.cuda.get_device_capability()
    supports_fp8 = capability[0] >= 9  # Hopper 架构 (SM 9.0+)
    print(f"FP8 支持: {supports_fp8}")

# FP8 张量创建（实验性 API）
if supports_fp8:
    # E4M3 格式
    x_fp8 = torch.randn(16, 16, dtype=torch.float8_e4m3fn, device="cuda")

    # E5M2 格式
    x_fp8_e5m2 = torch.randn(16, 16, dtype=torch.float8_e5m2, device="cuda")

    # FP8 矩阵乘法（通过 Tensor Core 加速）
    w = torch.randn(16, 16, dtype=torch.float8_e4m3fn, device="cuda")
    # 注意：直接的 FP8 矩阵乘法需要特定的 API 支持
```

### ExecuTorch：移动端部署

ExecuTorch 是 PyTorch 团队推出的轻量级推理引擎，专为移动端和边缘设备设计。

```python
import torch

# 1. 使用 torch.export 导出模型
model = MyModel().eval()
example_input = torch.randn(1, 3, 224, 224)
exported = torch.export.export(model, (example_input,))

# 2. 使用 ExecuTorch 转换（需要安装 executorch 包）
# pip install executorch
# from executorch.exir import to_edge
# edge_program = to_edge(exported)
#
# 3. 针对目标平台优化
# from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner
# delegated = edge_program.to_backend(XnnpackPartitioner())
#
# 4. 导出为可在移动端运行的 .pte 文件
# with open("model.pte", "wb") as f:
#     f.write(delegated.buffer())
```

---

## PyTorch 生态系统概览

PyTorch 拥有丰富的生态系统，覆盖计算机视觉、自然语言处理、音频处理等多个领域。

### 主要官方库

| 库名 | 用途 | 关键功能 |
|------|------|----------|
| torchvision | 计算机视觉 | 预训练模型、数据增强、常用数据集 |
| torchaudio | 音频处理 | 音频加载/变换、语音识别模型 |
| torchtext | 文本处理 | 文本预处理、词汇表、常用数据集 |
| TorchServe | 模型服务 | 生产级模型推理服务、REST API |

```python
# ---- torchvision 示例 ----
from torchvision import models, transforms

# 预训练模型
model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
model = torch.compile(model)  # 与 torch.compile 配合使用

# 数据增强
transform = transforms.Compose([
    transforms.RandomResizedCrop(224),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
])

# ---- torchaudio 示例 ----
import torchaudio

# 加载音频
waveform, sample_rate = torchaudio.load("audio.wav")

# 梅尔频谱变换
mel_transform = torchaudio.transforms.MelSpectrogram(
    sample_rate=sample_rate,
    n_mels=128,
)
mel_spec = mel_transform(waveform)

# ---- torchtext 示例 ----
from torchtext.data.utils import get_tokenizer

# 分词器
tokenizer = get_tokenizer("basic_english")
tokens = tokenizer("Hello, PyTorch 2.0 is amazing!")
print(tokens)  # ['hello', ',', 'pytorch', '2.0', 'is', 'amazing', '!']
```

### TorchServe 模型部署

```bash
# 安装 TorchServe
pip install torchserve torch-model-archiver torch-workflow-archiver

# 1. 将模型打包为 MAR 文件
torch-model-archiver --model-name my_model \
    --version 1.0 \
    --model-file model.py \
    --serialized-file model.pth \
    --handler image_classifier \
    --export-path model_store

# 2. 启动 TorchServe
torchserve --start --model-store model_store --models my_model=my_model.mar

# 3. 发送推理请求
curl http://localhost:8080/predictions/my_model -T test_image.jpg
```

```python
# 自定义 Handler
# handler.py
from ts.torch_handler.base_handler import BaseHandler

class MyHandler(BaseHandler):
    def preprocess(self, data):
        # 预处理逻辑
        image = data[0].get("data") or data[0].get("body")
        # ... 图像预处理
        return tensor

    def inference(self, data):
        # 推理逻辑
        with torch.no_grad():
            return self.model(data)

    def postprocess(self, data):
        # 后处理逻辑
        return [{"prediction": data.argmax(dim=1).item()}]
```

### 与 torch.compile 的生态集成

```python
# HuggingFace Transformers 集成
from transformers import AutoModelForSequenceClassification, AutoTokenizer

model = AutoModelForSequenceClassification.from_pretrained("bert-base-uncased")
tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

# 直接编译 HuggingFace 模型
compiled_model = torch.compile(model, mode="reduce-overhead")

inputs = tokenizer("Hello world", return_tensors="pt")
with torch.no_grad():
    outputs = compiled_model(**inputs)

# TorchVision 集成
from torchvision.models import efficientnet_v2_s

model = efficientnet_v2_s(weights="IMAGENET1K_V1").eval()
compiled_model = torch.compile(model, mode="max-autotune")

x = torch.randn(1, 3, 384, 384)
with torch.no_grad():
    output = compiled_model(x)
```

---

## 参考资料

- [torch.compile Tutorial - PyTorch](https://pytorch.org/tutorials/intermediate/torch_compile_tutorial.html)
- [torch.compile - PyTorch Documentation](https://pytorch.org/docs/stable/torch.compiler.html)
- [TorchDynamo Deep Dive - PyTorch Blog](https://pytorch.org/blog/pytorch-2-0/)
- [torch.export - PyTorch Documentation](https://pytorch.org/docs/stable/export.html)
- [torch.export Tutorial](https://pytorch.org/tutorials/intermediate/torch_export_tutorial.html)
- [torch.func (functorch) - PyTorch Documentation](https://pytorch.org/docs/stable/func.html)
- [TorchInductor: A Compiler Backend for PyTorch](https://pytorch.org/tutorials/intermediate/torch_compile_tutorial.html)
- [PyTorch 2.0 Release Notes](https://github.com/pytorch/pytorch/releases/tag/v2.0.0)
- [ExecuTorch Documentation](https://pytorch.org/executorch/)
- [torchvision - PyTorch Documentation](https://pytorch.org/vision/stable/)
- [torchaudio - PyTorch Documentation](https://pytorch.org/audio/stable/)
- [TorchServe Documentation](https://pytorch.org/serve/)
