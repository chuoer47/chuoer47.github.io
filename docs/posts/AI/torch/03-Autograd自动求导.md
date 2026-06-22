---
title: "Autograd 自动求导"
date: 2026-06-22
tags: [PyTorch, Autograd, 反向传播, 深度学习]
category: AI
order: 3
---

# Autograd 自动求导

PyTorch 的 `autograd` 引擎是深度学习框架的核心，它自动计算张量操作的梯度，使得反向传播算法的实现变得极其简洁。理解 `autograd` 的工作原理对于调试模型、优化训练过程以及处理复杂网络结构至关重要。

## 一、自动求导机制概述

### 1、为什么需要自动求导

深度学习的本质是通过梯度下降优化损失函数。假设模型参数为 $\theta$，损失函数为 $L(\theta)$，我们需要计算 $\nabla_\theta L$ 来更新参数。手动推导和编码梯度在复杂网络中几乎不可行——自动求导（Automatic Differentiation）应运而生。

自动求导不同于数值微分（有限差分）和符号微分：

| 方法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 数值微分 | $f'(x) \approx \frac{f(x+h) - f(x)}{h}$ | 实现简单 | 精度低、计算量大 |
| 符号微分 | 对表达式进行符号变换 | 精确 | 表达式膨胀、不适用于程序 |
| 自动求导 | 链式法则 + 计算图 | 精确、高效 | 需要追踪计算过程 |

### 2、前向模式 vs 反向模式

自动求导有两种模式：

- **前向模式（Forward Mode）**：从输入到输出，沿着计算图正向传播导数。适合输入少、输出多的情况。
- **反向模式（Reverse Mode）**：从输出到输入，沿着计算图反向传播梯度。适合输入多（参数多）、输出少（损失函数是标量）的情况。

深度学习中模型参数动辄数百万甚至数十亿，但损失函数通常是一个标量，因此 **反向模式** 是深度学习的天然选择——这就是反向传播（Backpropagation）算法。

```python
import torch

# 前向模式示例（使用 dual tensor，PyTorch 1.11+）
# 计算 f(x) = x^2 + 3x 在 x=2 处的导数
x = torch.tensor(2.0)
# 反向模式：PyTorch 默认使用反向模式
y = x ** 2 + 3 * x  # y = 4 + 6 = 10
y.backward()
print(x.grad)  # tensor(7.)  即 2*2 + 3 = 7
```

## 二、计算图概念

### 1、动态计算图 vs 静态计算图

| 特性 | 动态计算图（PyTorch） | 静态计算图（TensorFlow 1.x） |
|------|----------------------|------------------------------|
| 图构建时机 | 运行时动态构建 | 先定义图，再执行 |
| 调试难度 | 容易，可用标准 Python 调试器 | 较难，需要特殊工具 |
| 控制流 | 原生支持 Python if/for | 需要 tf.cond/tf.while_loop |
| 灵活性 | 每次前向可不同 | 图一旦定义不可变 |
| 性能优化 | 运行时优化有限 | 可提前做全局优化 |

### 2、PyTorch 动态图的优势

每次前向传播时，PyTorch 会从头构建一个新的计算图，前向结束后图会被释放。这意味着：

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

# 第一次前向：y = x^2
y = x ** 2
y.backward()
print(x.grad)  # tensor(4.)

# 第二次前向：图已被释放，重新构建
# 注意：需要清零梯度，否则会累积
x.grad.zero_()
y = x ** 3  # 不同的计算图！
y.backward()
print(x.grad)  # tensor(12.)  即 3 * 2^2 = 12
```

```python
# 动态图支持数据相关的控制流
x = torch.tensor(2.0, requires_grad=True)

def dynamic_fn(x):
    if x > 0:
        return x ** 2
    else:
        return -x ** 3

y = dynamic_fn(x)
y.backward()
print(x.grad)  # tensor(4.)
```

::: tip torch.compile 与动态图
PyTorch 2.0 引入的 `torch.compile` 通过 TorchDynamo 在运行时捕获计算图片段并编译优化，兼顾了动态图的灵活性和静态图的性能优势。
:::

## 三、requires_grad 属性详解

### 1、基本用法

`requires_grad` 是张量的一个布尔属性，决定是否需要对该张量追踪计算操作以便后续求导。

```python
import torch

# 创建时指定
a = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
print(a.requires_grad)  # True

# 后续设置
b = torch.tensor([4.0, 5.0, 6.0])
b.requires_grad_(True)  # 注意下划线后缀，原地修改
print(b.requires_grad)  # True

# 整数张量不支持梯度
c = torch.tensor([1, 2, 3], requires_grad=True)  # 报错！
```

::: warning 浮点类型要求
只有浮点类型的张量才能设置 `requires_grad=True`。整数和布尔类型张量不支持梯度计算。
:::

### 2、叶子节点与非叶子节点

在计算图中，节点分为两类：

- **叶子节点（Leaf Tensor）**：由用户直接创建的张量，不是通过其他张量运算得到的。
- **非叶子节点（Non-leaf Tensor）**：通过运算产生的中间结果张量。

```python
import torch

a = torch.tensor(2.0, requires_grad=True)
b = torch.tensor(3.0, requires_grad=True)

# a, b 是叶子节点
print(a.is_leaf)  # True
print(b.is_leaf)  # True

c = a + b          # c 不是叶子节点
print(c.is_leaf)   # False

d = c * a          # d 也不是叶子节点
print(d.is_leaf)   # False
```

::: info 为什么区分叶子节点和非叶子节点？
默认情况下，非叶子节点的梯度在反向传播后会被 **释放** 以节省内存。只有叶子节点的梯度会被保留（存储在 `.grad` 属性中）。如果需要保留非叶子节点的梯度，可以调用 `.retain_grad()`。
:::

```python
import torch

a = torch.tensor(2.0, requires_grad=True)
b = a ** 2 + 3 * a  # b 是非叶子节点

# 默认不保留非叶子节点梯度
b.backward()
print(a.grad)   # tensor(7.)
print(b.grad)   # None — 梯度已被释放

# 使用 retain_grad() 保留
a = torch.tensor(2.0, requires_grad=True)
b = a ** 2 + 3 * a
b.retain_grad()     # 显式保留
b.backward()
print(a.grad)   # tensor(7.)
print(b.grad)   # tensor(1.) — 对自身的梯度
```

## 四、grad_fn 与计算图追踪

每个通过运算产生的张量都有一个 `grad_fn` 属性，指向创建该张量的函数（即计算图中的一个节点）。

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

# 叶子节点的 grad_fn 为 None
print(x.grad_fn)  # None

y = x ** 2
print(y.grad_fn)  # <PowBackward0 object>

z = y + 3 * x
print(z.grad_fn)  # <AddBackward0 object>

# 查看完整的计算图链
print(z.grad_fn.next_functions)
# ((<PowBackward0>, 0), (<MulBackward0>, 0))
# 这表示 z 依赖于 y（由 Pow 产生）和 3*x（由 Mul 产生）
```

```python
# 追踪更复杂的计算图
x = torch.randn(3, requires_grad=True)
y = x * 2
while y.data.norm() < 1000:
    y = y * 2

print(y)
# 可以看到 grad_fn 形成了一条链
# <MulBackward0> -> <MulBackward0> -> ... -> <MulBackward0>
```

## 五、forward 过程与 backward() 原理

### 1、前向传播（Forward Pass）

前向传播过程中，PyTorch 做两件事：计算结果值，同时构建计算图。

```python
import torch

x = torch.tensor(1.0, requires_grad=True)
w = torch.tensor(2.0, requires_grad=True)
b = torch.tensor(3.0, requires_grad=True)

# 前向传播：逐层计算，同时记录操作
y = w * x + b          # 线性变换
loss = (y - 5) ** 2    # 均方误差

print(y)    # tensor(5., grad_fn=<AddBackward0>)
print(loss) # tensor(0., grad_fn=<PowBackward0>)
```

### 2、反向传播（Backward Pass）

调用 `backward()` 时，PyTorch 从调用的张量开始，沿计算图反向遍历，利用链式法则计算每个叶子节点的梯度。

```python
import torch

x = torch.tensor(1.0, requires_grad=True)
w = torch.tensor(2.0, requires_grad=True)
b = torch.tensor(3.0, requires_grad=True)

y = w * x + b           # y = 2*1 + 3 = 5
loss = (y - 5) ** 2     # loss = 0

loss.backward()

# 链式法则：
# dloss/dy = 2*(y-5) = 0
# dy/dw = x = 1,  dy/db = 1,  dy/dx = w = 2
# dloss/dw = dloss/dy * dy/dw = 0 * 1 = 0
# dloss/db = dloss/dy * dy/db = 0 * 1 = 0
# dloss/dx = dloss/dy * dy/dx = 0 * 2 = 0

print(w.grad)  # tensor(0.)
print(b.grad)  # tensor(0.)
print(x.grad)  # tensor(0.)
```

```python
# 一个梯度非零的例子
x = torch.tensor(2.0, requires_grad=True)
w = torch.tensor(3.0, requires_grad=True)
b = torch.tensor(1.0, requires_grad=True)

y = w * x + b        # y = 3*2 + 1 = 7
loss = y ** 2        # loss = 49

loss.backward()

# dloss/dy = 2*y = 14
# dy/dw = x = 2,  dy/db = 1,  dy/dx = w = 3
# dloss/dw = 14 * 2 = 28
# dloss/db = 14 * 1 = 14
# dloss/dx = 14 * 3 = 42

print(w.grad)  # tensor(28.)
print(b.grad)  # tensor(14.)
print(x.grad)  # tensor(42.)
```

## 六、标量反向与非标量反向

### 1、标量反向（常见情况）

当目标张量是标量（0 维）时，可以直接调用 `backward()`。

```python
import torch

x = torch.randn(3, requires_grad=True)
y = x.sum()  # 标量
y.backward()
print(x.grad)  # tensor([1., 1., 1.])
```

### 2、非标量反向（gradient 参数）

当目标张量不是标量时，必须提供一个与目标张量同形的 `gradient` 参数，它本质上是"外部梯度"。

```python
import torch

x = torch.randn(3, requires_grad=True)
y = x * 2  # y 是向量，不是标量

# 直接调用 y.backward() 会报错：
# RuntimeError: grad can be implicitly created only for scalar outputs

# 方法一：提供 gradient 参数
gradient = torch.tensor([1.0, 1.0, 1.0])
y.backward(gradient=gradient)
print(x.grad)  # tensor([2., 2., 2.])  即 dy/dx = 2

# 方法二：先转为标量再反向
x.grad.zero_()
y = x * 2
loss = y.sum()
loss.backward()
print(x.grad)  # tensor([2., 2., 2.])
```

```python
# gradient 参数的物理含义
# 它是外部损失对 y 的偏导数 ∂L/∂y
x = torch.randn(3, requires_grad=True)
y = x ** 2  # y = [x1^2, x2^2, x3^2]

# 假设外部梯度为 [1, 2, 3]
external_grad = torch.tensor([1.0, 2.0, 3.0])
y.backward(gradient=external_grad)

# ∂L/∂xi = external_grad[i] * 2*xi
print(x.grad)
```

## 七、梯度累积机制

### 1、为什么默认累积

PyTorch 默认 **累积** 梯度（而非覆盖），这是为了支持以下场景：

- **梯度累积**：当显存不足以容纳大 batch 时，将多个小 batch 的梯度累加后再更新，等效于大 batch 训练。
- **多损失函数**：来自不同损失的梯度需要叠加。

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

# 第一次反向
y1 = x ** 2
y1.backward()
print(x.grad)  # tensor(4.)   即 2*2

# 第二次反向 —— 梯度累积！
y2 = x ** 3
y2.backward()
print(x.grad)  # tensor(16.)  即 4 + 3*4 = 4 + 12 = 16（累积了！）
```

### 2、zero_grad 的使用

在每次参数更新前，必须手动清零梯度。

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

for epoch in range(3):
    # 必须在每次反向前清零
    if x.grad is not None:
        x.grad.zero_()

    y = x ** 2
    y.backward()
    print(f"Epoch {epoch}: grad = {x.grad}")
# Epoch 0: grad = 4.
# Epoch 1: grad = 4.
# Epoch 2: grad = 4.
```

在实际训练中，通常对优化器调用 `zero_grad()`：

```python
import torch
import torch.nn as nn

model = nn.Linear(10, 1)
optimizer = torch.optim.SGD(model.parameters(), lr=0.01)

for epoch in range(10):
    # 1. 清零梯度
    optimizer.zero_grad()

    # 2. 前向传播
    x = torch.randn(32, 10)
    y_pred = model(x)
    loss = y_pred.sum()

    # 3. 反向传播
    loss.backward()

    # 4. 参数更新
    optimizer.step()
```

::: tip 梯度累积技巧
当显存不够时，可以累积多个 batch 的梯度再更新：

```python
accumulation_steps = 4
for i, (inputs, targets) in enumerate(dataloader):
    loss = model(inputs).sum() / accumulation_steps
    loss.backward()  # 梯度累积
    if (i + 1) % accumulation_steps == 0:
        optimizer.step()
        optimizer.zero_grad()
```
:::

## 八、torch.no_grad() vs torch.inference_mode()

### 1、torch.no_grad()

禁用梯度计算的上下文管理器。所有在其中的操作不会被追踪。

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

with torch.no_grad():
    y = x * 2
    print(y.requires_grad)  # False — 不追踪

# 离开上下文后恢复
y = x * 2
print(y.requires_grad)  # True — 恢复追踪
```

### 2、torch.inference_mode()

PyTorch 1.9 引入，是 `no_grad()` 的增强版本。除了禁用梯度追踪，还关闭了版本计数（version counter），使得张量更轻量。

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

with torch.inference_mode():
    y = x * 2
    print(y.requires_grad)  # False

# inference_mode 下的张量是 "inference tensor"
# 不能用于需要 autograd 的操作
```

### 3、两者对比

| 特性 | `torch.no_grad()` | `torch.inference_mode()` |
|------|-------------------|--------------------------|
| 禁用梯度追踪 | 是 | 是 |
| 关闭版本计数 | 否 | 是（更快） |
| 性能 | 好 | 更好（推荐） |
| 与旧版 API 兼容 | 是 | 是 |
| 推荐场景 | 需要手动启用梯度时 | 推理阶段（默认选择） |

```python
import torch
import torch.nn as nn

model = nn.Linear(10, 1)
x = torch.randn(5, 10)

# 训练时
model.train()
y_train = model(x)

# 推理时（推荐使用 inference_mode）
model.eval()
with torch.inference_mode():
    y_eval = model(x)
```

::: warning 注意事项
在 `inference_mode` 下创建的张量不能在之后用于需要 `requires_grad` 的操作。如果推理后还需要微调（如对抗样本生成），应使用 `torch.no_grad()`。
:::

## 九、高阶导数（create_graph=True）

默认情况下，`backward()` 不会为反向操作构建计算图，因此无法对梯度再次求导。设置 `create_graph=True` 可以保留计算图，实现高阶导数。

```python
import torch

x = torch.tensor(3.0, requires_grad=True)

# 一阶导数
y = x ** 3
y.backward(create_graph=True)
print(x.grad)  # tensor(27.)  即 3*3^2 = 27

# 二阶导数
x.grad.backward()
print(x.grad)  # tensor(54.)  即 d/dx(3x^2)|_{x=3} = 6*3 = 18
# 注意：这里 x.grad 已经被覆盖了，实际值是累积的

# 更规范的写法：使用 torch.autograd.grad
x = torch.tensor(3.0, requires_grad=True)
y = x ** 3

# 一阶导数
grad1 = torch.autograd.grad(y, x, create_graph=True)
print(grad1)  # (tensor(27., grad_fn=<MulBackward0>),)

# 二阶导数
grad2 = torch.autograd.grad(grad1[0], x)
print(grad2)  # (tensor(54.),)  即 d²y/dx² = 6x = 18... 累积值
```

```python
# 实际应用：梯度惩罚（如 WGAN-GP）
import torch

def gradient_penalty(discriminator, real_data, fake_data):
    batch_size = real_data.size(0)
    alpha = torch.rand(batch_size, 1, 1, 1, device=real_data.device)
    alpha = alpha.expand_as(real_data)

    interpolated = alpha * real_data + (1 - alpha) * fake_data
    interpolated.requires_grad_(True)

    d_interpolated = discriminator(interpolated)

    gradients = torch.autograd.grad(
        outputs=d_interpolated,
        inputs=interpolated,
        grad_outputs=torch.ones_like(d_interpolated),
        create_graph=True,       # 需要二阶导数时必须 True
        retain_graph=True
    )[0]

    gradients = gradients.view(batch_size, -1)
    penalty = ((gradients.norm(2, dim=1) - 1) ** 2).mean()
    return penalty
```

## 十、钩子函数

钩子（Hook）允许你在不修改模型代码的情况下，在前向或反向传播过程中插入自定义逻辑。

### 1、register_hook（张量级）

对某个张量注册反向传播钩子。

```python
import torch

x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
y = x ** 2

# 对 y 注册钩子：打印反向传播时的梯度
def print_grad(grad):
    print(f"Gradient of y: {grad}")

y.register_hook(print_grad)

z = y.sum()
z.backward()
# 输出：Gradient of y: tensor([1., 1., 1.])

# 钩子还可以修改梯度
x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
y = x ** 2

def scale_grad(grad):
    return grad * 0.5  # 将梯度缩放一半

y.register_hook(scale_grad)

z = y.sum()
z.backward()
print(x.grad)  # tensor([1., 2., 3.])  即 0.5 * 2 * x
```

### 2、register_full_backward_hook（模块级）

在 `nn.Module` 上注册反向传播钩子，可以监控每一层的梯度。

```python
import torch
import torch.nn as nn

model = nn.Sequential(
    nn.Linear(10, 20),
    nn.ReLU(),
    nn.Linear(20, 1)
)

# 为每一层注册钩子
for name, layer in model.named_modules():
    if isinstance(layer, nn.Linear):
        def make_hook(name):
            def hook_fn(module, grad_input, grad_output):
                print(f"[{name}] grad_input shapes: "
                      f"{[g.shape if g is not None else None for g in grad_input]}")
                print(f"[{name}] grad_output shapes: "
                      f"{[g.shape for g in grad_output]}")
            return hook_fn
        layer.register_full_backward_hook(make_hook(name))

x = torch.randn(5, 10)
y = model(x)
loss = y.sum()
loss.backward()
```

### 3、register_forward_hook（前向钩子）

用于在前向传播时提取中间特征。

```python
import torch
import torch.nn as nn

model = nn.Sequential(
    nn.Linear(10, 20),
    nn.ReLU(),
    nn.Linear(20, 1)
)

# 提取中间层输出
features = {}
def save_features(name):
    def hook_fn(module, input, output):
        features[name] = output.detach()
    return hook_fn

model[0].register_forward_hook(save_features("linear1"))
model[1].register_forward_hook(save_features("relu"))

x = torch.randn(5, 10)
y = model(x)

print(features["linear1"].shape)  # torch.Size([5, 20])
print(features["relu"].shape)     # torch.Size([5, 20])
```

## 十一、梯度裁剪实战

梯度裁剪（Gradient Clipping）用于防止梯度爆炸问题，在 RNN 和 Transformer 训练中尤为重要。

### 1、按范数裁剪（最常用）

```python
import torch
import torch.nn as nn

model = nn.Linear(10, 1)
optimizer = torch.optim.SGD(model.parameters(), lr=0.01)

x = torch.randn(32, 10)
loss = model(x).sum()
loss.backward()

# 裁剪：如果梯度的 L2 范数超过 max_norm，则等比缩放
total_norm = torch.nn.utils.clip_grad_norm_(
    model.parameters(), max_norm=1.0
)
print(f"裁剪前梯度范数: {total_norm:.4f}")

optimizer.step()
```

### 2、按值裁剪

```python
import torch
import torch.nn as nn

model = nn.Linear(10, 1)
optimizer = torch.optim.Adam(model.parameters())

loss = model(torch.randn(32, 10)).sum()
loss.backward()

# 将每个参数的梯度限制在 [-0.5, 0.5] 范围内
torch.nn.utils.clip_grad_value_(model.parameters(), clip_value=0.5)

optimizer.step()
```

### 3、训练循环中的完整用法

```python
import torch
import torch.nn as nn

model = nn.TransformerEncoderLayer(d_model=512, nhead=8)
optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)

for epoch in range(10):
    optimizer.zero_grad()

    x = torch.randn(10, 32, 512)  # (seq_len, batch, d_model)
    output = model(x)
    loss = output.sum()

    loss.backward()

    # 梯度裁剪（Transformer 训练标配）
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)

    optimizer.step()
```

## 十二、常见陷阱与最佳实践

### 陷阱 1：忘记调用 zero_grad()

```python
# 错误示范
for data, target in dataloader:
    output = model(data)
    loss = loss_fn(output, target)
    loss.backward()
    optimizer.step()
    # 梯度在不断累积，训练会不稳定！

# 正确做法
for data, target in dataloader:
    optimizer.zero_grad()       # 1. 清零
    output = model(data)
    loss = loss_fn(output, target)
    loss.backward()             # 2. 反向
    optimizer.step()            # 3. 更新
```

### 陷阱 2：对不需要梯度的操作设置了 requires_grad

```python
import torch

# 在推理时不需要梯度追踪
model.eval()
with torch.inference_mode():
    output = model(test_input)  # 更高效
```

### 陷阱 3：在 .detach() 后继续反向传播

```python
import torch

x = torch.tensor(2.0, requires_grad=True)
y = x ** 2
z = y.detach() * 3  # z 与 x 的计算图断开了

# z.backward() 不会计算 x 的梯度！
# print(x.grad)  # None
```

### 陷阱 4：in-place 操作破坏计算图

```python
import torch

x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
y = x ** 2

# 错误：in-place 操作可能破坏计算图
# y += 1          # 可能报错或产生错误结果

# 正确：使用新变量
y = y + 1         # 创建新节点
z = y.sum()
z.backward()
print(x.grad)     # tensor([2., 4., 6.])
```

### 陷阱 5：叶节点的 grad 在 backward 后被累积

```python
import torch

x = torch.tensor(2.0, requires_grad=True)

for _ in range(5):
    y = x ** 2
    y.backward()
    print(x.grad)  # 4., 8., 12., 16., 20. —— 不断累积！

# 正确做法
x = torch.tensor(2.0, requires_grad=True)
for _ in range(5):
    if x.grad is not None:
        x.grad.zero_()
    y = x ** 2
    y.backward()
    print(x.grad)  # 始终是 4.
```

### 最佳实践总结

| 场景 | 建议 |
|------|------|
| 训练阶段 | 使用标准的 `zero_grad → forward → backward → step` 流程 |
| 推理阶段 | 使用 `torch.inference_mode()` 上下文 |
| 梯度监控 | 使用 `register_hook` 或 `tensorboard` 记录梯度 |
| 梯度爆炸 | 使用 `clip_grad_norm_` 裁剪梯度 |
| 显存不足 | 使用梯度累积或 `gradient_checkpointing` |
| 梯度调试 | 使用 `torch.autograd.set_detect_anomaly(True)` 检测异常 |

```python
# 开启异常检测（调试用，会降低性能）
torch.autograd.set_detect_anomaly(True)

x = torch.tensor(0.0, requires_grad=True)
y = x ** 2
z = torch.sqrt(y)  # sqrt(0) 的梯度是 NaN
z.backward()  # 会抛出详细的错误信息
```

---

> **参考资料**
> - [Autograd Mechanics — PyTorch 官方文档](https://pytorch.org/docs/stable/autograd.html)
> - [Automatic Differentiation — torch.autograd](https://pytorch.org/tutorials/beginner/blitz/autograd_tutorial.html)
> - [torch.autograd.Function — 自定义 autograd 函数](https://pytorch.org/docs/stable/autograd.html#function)
> - [Gradient Clipping — torch.nn.utils.clip_grad_norm_](https://pytorch.org/docs/stable/generated/torch.nn.utils.clip_grad_norm_.html)
> - [Inference Mode — torch.inference_mode](https://pytorch.org/docs/stable/generated/torch.inference_mode.html)
> - [Hooks — torch.Tensor.register_hook](https://pytorch.org/docs/stable/generated/torch.Tensor.register_hook.html)
