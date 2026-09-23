---
title: "PyTorch 基础与安装"
date: 2026-06-22
tags: [PyTorch, 深度学习, Python]
category: AI
order: 1
---

# PyTorch 基础与安装

## PyTorch 简介

### 什么是 PyTorch

PyTorch 是由 Meta AI（原 Facebook AI Research）开发的开源深度学习框架。它基于 Torch 库，使用 Python 作为主要编程语言，提供了灵活且高效的张量计算能力以及强大的自动求导系统（Autograd）。PyTorch 的核心设计理念是 **动态计算图（Dynamic Computational Graph）**，也称为 "define-by-run"，这意味着计算图在运行时动态构建，而非预先定义，使得模型的调试和开发更加直观和灵活。

PyTorch 的主要特性包括：

- **动态计算图**：支持在运行时动态构建计算图，方便调试和灵活控制流
- **强大的 GPU 加速**：通过 CUDA 和 cuDNN 提供高效的 GPU 计算支持
- **自动求导系统**：Autograd 引擎自动计算梯度，简化反向传播过程
- **丰富的生态系统**：TorchVision、TorchText、TorchAudio、TorchServe 等扩展库
- **Pythonic 风格**：与 Python 生态无缝集成，学习曲线平缓
- **生产部署**：通过 TorchScript、ONNX 导出等支持模型部署

### 发展历史

| 时间 | 里程碑事件 |
|------|-----------|
| 2002 | Torch 框架诞生（基于 Lua 语言） |
| 2016 | PyTorch 前身 Torch7 由 Meta 开发 |
| 2017 年 1 月 | PyTorch 0.1.0 首次发布（Alpha 版本） |
| 2018 年 4 月 | PyTorch 0.4.0 发布，合并 Tensor 和 Variable |
| 2018 年 10 月 | PyTorch 1.0 正式发布，引入 TorchScript |
| 2019 年 5 月 | PyTorch 1.1 发布，加入 TensorBoard 支持 |
| 2020 年 6 月 | PyTorch 1.5 发布，引入 RPC 分布式训练 |
| 2021 年 3 月 | PyTorch 1.8 发布，加入 functorch |
| 2022 年 3 月 | PyTorch 1.12 发布，改进 Meta 张量 |
| 2022 年 10 月 | PyTorch 2.0 发布，引入 torch.compile 编译模式 |
| 2023 年 6 月 | PyTorch 2.1 发布，改进 torch.compile 稳定性 |
| 2024 年 | PyTorch 2.x 持续迭代，支持 FP8、GQA 等特性 |

### 与其他框架对比

| 特性 | PyTorch | TensorFlow | JAX | PaddlePaddle |
|------|---------|-----------|-----|-------------|
| 计算图类型 | 动态图 | 静态图 + Eager | 函数式 | 动态图 + 静态图 |
| 学习曲线 | 平缓 | 中等 | 较陡 | 中等 |
| 调试便捷性 | 非常方便 | 中等 | 方便 | 方便 |
| 社区活跃度 | 非常高 | 高 | 高 | 中等 |
| 生产部署 | TorchScript / ONNX | TF Serving / TF Lite | 较弱 | Paddle Serving |
| 研究领域主导 | 是（学术界主流） | 工业界广泛应用 | Google 系研究 | 百度系生态 |
| 分布式训练 | FSDP / DDP | MirroredStrategy | pjit | Fleet |
| GPU 加速 | CUDA / ROCm | CUDA / TPU | CUDA / TPU | CUDA |

## 安装方式

### 环境要求

在安装 PyTorch 之前，请确认以下环境要求：

- Python 3.9 及以上版本（推荐 3.10 或 3.11）
- pip 或 conda 包管理器
- （可选）NVIDIA GPU 以及对应版本的 CUDA Toolkit

### 方式一：pip 安装（推荐）

最简单的安装方式是使用 pip。访问 [PyTorch 官网](https://pytorch.org/get-started/locally/) 获取适合你系统的命令。

**仅 CPU 版本：**

```bash
pip install torch torchvision torchaudio
```

**CUDA 11.8 版本：**

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

**CUDA 12.1 版本：**

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

**安装特定版本：**

```bash
pip install torch==2.3.0 torchvision==0.18.0 torchaudio==2.3.0 --index-url https://download.pytorch.org/whl/cu121
```

### 方式二：conda 安装

conda 会自动处理 CUDA 依赖，适合不想手动配置 CUDA 的用户。

**CPU 版本：**

```bash
conda install pytorch torchvision torchaudio cpuonly -c pytorch
```

**GPU 版本（CUDA 11.8）：**

```bash
conda install pytorch torchvision torchaudio pytorch-cuda=11.8 -c pytorch -c nvidia
```

**GPU 版本（CUDA 12.1）：**

```bash
conda install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
```

**使用 mamba 加速安装：**

```bash
# mamba 是 conda 的高速替代品
mamba install pytorch torchvision torchaudio pytorch-cuda=12.1 -c pytorch -c nvidia
```

### 方式三：源码编译

源码编译适用于需要自定义编译选项、修改源码或获取最新开发版功能的场景。

```bash
# 1. 克隆仓库
git clone --recursive https://github.com/pytorch/pytorch
cd pytorch

# 2. 切换到指定版本（可选）
git checkout v2.3.0
git submodule sync
git submodule update --init --recursive

# 3. 安装依赖
conda install cmake ninja
pip install -r requirements.txt

# 4. 设置编译参数
export CMAKE_PREFIX_PATH=${CONDA_PREFIX:-"$(dirname $(which conda))/../"}
export USE_CUDA=1        # 启用 CUDA 支持
export USE_CUDNN=1       # 启用 cuDNN 支持
export MAX_JOBS=8        # 并行编译作业数

# 5. 编译安装
python setup.py install
```

### 方式四：Docker 安装

使用官方 Docker 镜像可以快速获得配置好的环境。

```bash
# 拉取官方镜像
docker pull pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

# 运行容器
docker run --gpus all -it --rm \
  -v $(pwd):/workspace \
  pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime \
  bash

# 在容器内验证
python -c "import torch; print(torch.__version__)"
```

**使用自定义 Dockerfile：**

```dockerfile
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# 安装额外依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "train.py"]
```

## 验证安装

安装完成后，通过以下代码验证 PyTorch 是否正确安装。

### 基础验证

```python
import torch

# 查看 PyTorch 版本
print(f"PyTorch 版本: {torch.__version__}")

# 查看是否支持 CUDA
print(f"CUDA 是否可用: {torch.cuda.is_available()}")

# 查看 CUDA 版本
if torch.cuda.is_available():
    print(f"CUDA 版本: {torch.version.cuda}")
    print(f"cuDNN 版本: {torch.backends.cudnn.version()}")
    print(f"GPU 数量: {torch.cuda.device_count()}")
    for i in range(torch.cuda.device_count()):
        print(f"  GPU {i}: {torch.cuda.get_device_name(i)}")
```

### GPU 功能验证

```python
import torch

# 创建张量并移动到 GPU
if torch.cuda.is_available():
    # 在 GPU 上创建张量
    x = torch.randn(3, 3, device="cuda")
    print(f"张量设备: {x.device}")
    print(f"张量内容:\n{x}")

    # GPU 上的矩阵运算
    y = torch.randn(3, 3, device="cuda")
    z = x @ y  # 矩阵乘法
    print(f"矩阵乘法结果:\n{z}")

    # 测试自动求导
    a = torch.randn(3, 3, device="cuda", requires_grad=True)
    b = a * 2
    c = b.sum()
    c.backward()
    print(f"梯度:\n{a.grad}")
else:
    print("CUDA 不可用，将使用 CPU 进行计算")
    x = torch.randn(3, 3)
    print(f"张量设备: {x.device}")
```

### 性能基准测试

```python
import torch
import time

def benchmark(device, size=4096, iterations=100):
    """基准测试：矩阵乘法性能"""
    a = torch.randn(size, size, device=device)
    b = torch.randn(size, size, device=device)

    # 预热
    for _ in range(10):
        _ = a @ b

    if device.type == "cuda":
        torch.cuda.synchronize()

    start = time.time()
    for _ in range(iterations):
        _ = a @ b

    if device.type == "cuda":
        torch.cuda.synchronize()

    elapsed = time.time() - start
    print(f"设备: {device}, 矩阵大小: {size}x{size}")
    print(f"  {iterations} 次迭代耗时: {elapsed:.4f} 秒")
    print(f"  每次迭代平均: {elapsed / iterations * 1000:.2f} 毫秒")

# CPU 基准测试
benchmark(torch.device("cpu"))

# GPU 基准测试（如果有 GPU）
if torch.cuda.is_available():
    benchmark(torch.device("cuda"))
```

## 张量（Tensor）基础概念

### 什么是张量

张量（Tensor）是 PyTorch 中最基本的数据结构，本质上是一个多维数组。它可以看作是 NumPy ndarray 的增强版本，额外支持 GPU 加速和自动求导。在深度学习中，所有的输入数据、模型参数、中间计算结果都以张量的形式存在。

张量的核心特征：

- **多维数组**：可以表示任意维度的数据
- **同质数据类型**：同一张量中的所有元素必须是相同的数据类型
- **设备感知**：可以存在于 CPU 或 GPU 上
- **自动求导支持**：可以追踪计算历史，自动计算梯度

### 标量、向量、矩阵与张量

在数学和深度学习中，数据按维度层次组织：

| 术语 | 维度数 | 形状示例 | PyTorch 示例 | 实际用途 |
|------|--------|---------|-------------|---------|
| 标量（Scalar） | 0 | `()` | 损失值、学习率 | 单个数值 |
| 向量（Vector） | 1 | `(n,)` | 偏置项、词向量 | 一维数据 |
| 矩阵（Matrix） | 2 | `(m, n)` | 批量输入、权重矩阵 | 二维数据 |
| 3D 张量 | 3 | `(b, m, n)` | 彩色图像批量 | 三维数据 |
| 4D 张量 | 4 | `(b, c, h, w)` | 图像批量（含通道） | 卷积网络输入 |
| 5D 张量 | 5 | `(b, t, c, h, w)` | 视频数据批量 | 时序图像数据 |

```python
import torch

# 标量（0 维张量）
scalar = torch.tensor(3.14)
print(f"标量: {scalar}, 形状: {scalar.shape}, 维度: {scalar.ndim}")
# 输出: 标量: tensor(3.1400), 形状: torch.Size([]), 维度: 0

# 向量（1 维张量）
vector = torch.tensor([1.0, 2.0, 3.0, 4.0])
print(f"向量: {vector}, 形状: {vector.shape}, 维度: {vector.ndim}")
# 输出: 向量: tensor([1., 2., 3., 4.]), 形状: torch.Size([4]), 维度: 1

# 矩阵（2 维张量）
matrix = torch.tensor([[1, 2, 3],
                        [4, 5, 6],
                        [7, 8, 9]])
print(f"矩阵形状: {matrix.shape}, 维度: {matrix.ndim}")
# 输出: 矩阵形状: torch.Size([3, 3]), 维度: 2

# 3D 张量
tensor_3d = torch.randn(2, 3, 4)
print(f"3D 张量形状: {tensor_3d.shape}, 维度: {tensor_3d.ndim}")
# 输出: 3D 张量形状: torch.Size([2, 3, 4]), 维度: 3

# 4D 张量（常见于图像处理）
# 形状: (batch_size, channels, height, width)
tensor_4d = torch.randn(32, 3, 224, 224)
print(f"4D 张量形状: {tensor_4d.shape}, 维度: {tensor_4d.ndim}")
# 输出: 4D 张量形状: torch.Size([32, 3, 224, 224]), 维度: 4
```

## 张量创建方式

### 从 Python 数据创建

```python
import torch

# torch.tensor: 从 Python 列表或嵌套列表创建（最常用）
a = torch.tensor([1, 2, 3])
print(f"torch.tensor: {a}, dtype: {a.dtype}")

# 指定数据类型
b = torch.tensor([1, 2, 3], dtype=torch.float32)
print(f"指定 dtype: {b}, dtype: {b.dtype}")

# 从嵌套列表创建 2D 张量
c = torch.tensor([[1, 2], [3, 4], [5, 6]])
print(f"2D 张量:\n{c}")

# torch.Tensor: 创建一个空的浮点张量（注意大小写区别）
# torch.Tensor(2, 3) 会创建一个未初始化的 2x3 张量
d = torch.Tensor(2, 3)
print(f"torch.Tensor(2,3): {d}")

# torch.Tensor 也可以从列表创建，但始终返回 float32
e = torch.Tensor([1, 2, 3])
print(f"torch.Tensor([1,2,3]): {e}, dtype: {e.dtype}")
```

> **注意**: `torch.tensor()` 是一个工厂函数，会根据输入推断数据类型；`torch.Tensor` 是 `torch.FloatTensor` 的别名，始终创建 float32 类型的张量。推荐使用小写的 `torch.tensor()`。

### 全零和全一张量

```python
import torch

# 创建全零张量
zeros = torch.zeros(3, 4)
print(f"全零张量:\n{zeros}")

# 创建与已有张量形状相同的全零张量
x = torch.randn(2, 3)
zeros_like = torch.zeros_like(x)
print(f"与 x 形状相同的全零张量:\n{zeros_like}")

# 创建全一张量
ones = torch.ones(3, 4)
print(f"全一张量:\n{ones}")

# 创建与已有张量形状相同的全一张量
ones_like = torch.ones_like(x)
print(f"与 x 形状相同的全一张量:\n{ones_like}")
```

### 数值序列张量

```python
import torch

# torch.arange: 创建等差序列（不包含终点）
a = torch.arange(0, 10, 2)  # 起点, 终点, 步长
print(f"arange(0, 10, 2): {a}")
# 输出: tensor([0, 2, 4, 6, 8])

# torch.linspace: 创建等间距序列（包含终点）
b = torch.linspace(0, 1, 5)  # 起点, 终点, 个数
print(f"linspace(0, 1, 5): {b}")
# 输出: tensor([0.0000, 0.2500, 0.5000, 0.7500, 1.0000])

# torch.logspace: 创建对数间隔序列
c = torch.logspace(0, 3, 4)  # 10^0 到 10^3，4 个数
print(f"logspace(0, 3, 4): {c}")
# 输出: tensor([   1.,   10.,  100., 1000.])
```

### 随机张量

```python
import torch

# 标准正态分布（均值 0，标准差 1）
randn = torch.randn(2, 3)
print(f"标准正态分布:\n{randn}")

# 均匀分布 [0, 1)
rand = torch.rand(2, 3)
print(f"均匀分布 [0, 1):\n{rand}")

# 随机整数张量
randint = torch.randint(0, 10, (3, 4))  # 低值, 高值, 形状
print(f"随机整数 [0, 10):\n{randint}")

# 指定均值和标准差的正态分布
normal = torch.normal(mean=0, std=1, size=(2, 3))
print(f"自定义正态分布:\n{normal}")

# 使用生成器控制随机种子（可复现）
g = torch.Generator().manual_seed(42)
rand_seeded = torch.rand(2, 3, generator=g)
print(f"固定种子的随机张量:\n{rand_seeded}")

# 设置全局随机种子
torch.manual_seed(42)
a = torch.rand(3)
torch.manual_seed(42)
b = torch.rand(3)
print(f"两次生成相同: {torch.equal(a, b)}")  # True
```

### 其他创建方式

```python
import torch

# torch.empty: 创建未初始化的张量（值不确定）
empty = torch.empty(2, 3)
print(f"未初始化张量:\n{empty}")

# torch.full: 创建指定值填充的张量
full = torch.full((3, 4), 3.14)
print(f"填充 3.14 的张量:\n{full}")

# torch.eye: 创建单位矩阵
eye = torch.eye(4)
print(f"4x4 单位矩阵:\n{eye}")

# 非方阵单位矩阵
eye_rect = torch.eye(3, 5)
print(f"3x5 单位矩阵:\n{eye_rect}")

# torch.zeros_like / torch.ones_like / torch.full_like
# 根据已有张量的形状和属性创建新张量
x = torch.randn(2, 3, dtype=torch.float64, device="cpu")
zeros_like = torch.zeros_like(x)
full_like = torch.full_like(x, 7.0)
print(f"zeros_like dtype: {zeros_like.dtype}")  # float64
print(f"full_like:\n{full_like}")
```

## 张量属性

每个张量都携带描述其自身特征的属性，理解这些属性对正确使用 PyTorch 至关重要。

```python
import torch

x = torch.randn(3, 4, dtype=torch.float32)

# shape / size(): 获取张量的形状
print(f"shape: {x.shape}")           # torch.Size([3, 4])
print(f"size(): {x.size()}")         # torch.Size([3, 4])
print(f"size(0): {x.size(0)}")       # 3（第 0 维的大小）
print(f"size(1): {x.size(1)}")       # 4（第 1 维的大小）
print(f"shape[0]: {x.shape[0]}")     # 3

# dtype: 数据类型
print(f"dtype: {x.dtype}")           # torch.float32

# device: 设备信息
print(f"device: {x.device}")         # cpu

# requires_grad: 是否需要计算梯度
print(f"requires_grad: {x.requires_grad}")  # False

# 设置 requires_grad
y = torch.randn(3, 4, requires_grad=True)
print(f"requires_grad: {y.requires_grad}")  # True

# ndim: 维度数量
print(f"ndim: {x.ndim}")             # 2

# numel(): 元素总数
print(f"元素总数: {x.numel()}")       # 12

# is_contiguous(): 是否在内存中连续存储
print(f"是否连续: {x.is_contiguous()}")  # True

# grad_fn: 梯度函数（用于自动求导）
z = x * 2
print(f"grad_fn: {z.grad_fn}")       # MulBackward0
```

### 属性总结表

| 属性/方法 | 返回类型 | 说明 |
|----------|---------|------|
| `shape` | `torch.Size` | 张量形状 |
| `size()` | `torch.Size` | 同 shape |
| `size(dim)` | `int` | 指定维度的大小 |
| `dtype` | `torch.dtype` | 数据类型 |
| `device` | `torch.device` | 张量所在设备 |
| `requires_grad` | `bool` | 是否追踪梯度 |
| `ndim` | `int` | 维度数量（等同于 `len(x.shape)`） |
| `numel()` | `int` | 元素总数 |
| `grad_fn` | `Function` 或 `None` | 梯度函数 |
| `is_contiguous()` | `bool` | 内存是否连续 |
| `layout` | `torch.layout` | 内存布局（默认 `torch.strided`） |

## 数据类型详解

### 常用数据类型

PyTorch 支持多种数据类型，选择合适的数据类型对内存效率和计算精度至关重要。

| 数据类型 | dtype | 位数 | 说明 | 常用场景 |
|---------|-------|------|------|---------|
| 16 位浮点 | `torch.float16` | 16 | 半精度浮点 | 混合精度训练、推理加速 |
| 16 位脑浮点 | `torch.bfloat16` | 16 | Brain Floating Point | 混合精度训练（A100 等） |
| 32 位浮点 | `torch.float32` | 32 | 单精度浮点 | **默认类型**，训练常用 |
| 64 位浮点 | `torch.float64` | 64 | 双精度浮点 | 科学计算、高精度场景 |
| 8 位整数 | `torch.int8` | 8 | 有符号 8 位整数 | 量化模型 |
| 16 位整数 | `torch.int16` | 16 | 有符号 16 位整数 | 特殊场景 |
| 32 位整数 | `torch.int32` | 32 | 有符号 32 位整数 | 索引、标签 |
| 64 位整数 | `torch.int64` | 64 | 有符号 64 位整数 | **索引默认类型** |
| 布尔类型 | `torch.bool` | 8 | 布尔值 | 掩码、条件选择 |
| 复数 64 位 | `torch.complex64` | 64 | 复数（两个 float32） | 信号处理 |
| 复数 128 位 | `torch.complex128` | 128 | 复数（两个 float64） | 高精度复数计算 |

### 类型转换

```python
import torch

x = torch.tensor([1, 2, 3], dtype=torch.float32)

# 方法一: .to() 方法（最灵活）
y = x.to(torch.int64)
print(f"float32 -> int64: {y}, dtype: {y.dtype}")

# 方法二: .type() 方法
z = x.type(torch.float64)
print(f"float32 -> float64: {z}, dtype: {z.dtype}")

# 方法三: 具体类型方法
a = x.float()       # 转为 float32
b = x.double()      # 转为 float64
c = x.half()        # 转为 float16
d = x.bfloat16()    # 转为 bfloat16
e = x.int()         # 转为 int32
f = x.long()        # 转为 int64
g = x.bool()        # 转为 bool

# 方法四: 类型构造函数
i = torch.float16(x)
print(f"float32 -> float16: {i}, dtype: {i.dtype}")

# 创建时指定类型
j = torch.tensor([1, 2, 3], dtype=torch.int64)
print(f"创建时指定 int64: {j}, dtype: {j.dtype}")

# 查看默认浮点类型
print(f"默认浮点类型: {torch.get_default_dtype()}")  # torch.float32

# 修改默认浮点类型
torch.set_default_dtype(torch.float64)
k = torch.tensor([1.0, 2.0])  # 现在默认是 float64
print(f"修改后默认类型: {k.dtype}")
# 恢复默认
torch.set_default_dtype(torch.float32)
```

## CPU/GPU 设备切换

### 设备管理

```python
import torch

# 获取设备信息
print(f"CUDA 可用: {torch.cuda.is_available()}")
print(f"CUDA 设备数: {torch.cuda.device_count()}")

# 创建设备对象
cpu_device = torch.device("cpu")
gpu_device = torch.device("cuda")          # 默认 GPU
gpu_device_0 = torch.device("cuda:0")      # 第一个 GPU
gpu_device_1 = torch.device("cuda:1")      # 第二个 GPU（如果有）

# 在指定设备上创建张量
x_cpu = torch.randn(3, 3, device="cpu")
if torch.cuda.is_available():
    x_gpu = torch.randn(3, 3, device="cuda")
    x_gpu0 = torch.randn(3, 3, device="cuda:0")
```

### 设备间移动

```python
import torch

x = torch.randn(3, 3)  # 默认在 CPU 上

if torch.cuda.is_available():
    # 方法一: .to() 方法（推荐，最灵活）
    x_gpu = x.to("cuda")
    x_gpu = x.to(torch.device("cuda"))
    x_gpu = x.to("cuda:0")

    # .to() 还可以同时转换数据类型
    x_gpu_half = x.to("cuda", dtype=torch.float16)

    # 方法二: .cuda() 方法
    x_gpu = x.cuda()
    x_gpu = x.cuda(0)  # 指定 GPU 编号

    # 从 GPU 移动到 CPU
    x_cpu = x_gpu.cpu()

    # 方法三: .to() 移回 CPU
    x_cpu = x_gpu.to("cpu")

    # 检查设备
    print(f"GPU 张量设备: {x_gpu.device}")
    print(f"CPU 张量设备: {x_cpu.device}")
```

### 多 GPU 设备管理

```python
import torch

def get_device():
    """智能选择设备"""
    if torch.cuda.is_available():
        # 如果有多个 GPU，选择显存空闲最多的
        if torch.cuda.device_count() > 1:
            # 查看每个 GPU 的显存使用
            for i in range(torch.cuda.device_count()):
                mem_allocated = torch.cuda.memory_allocated(i) / 1024**2
                mem_reserved = torch.cuda.memory_reserved(i) / 1024**2
                print(f"GPU {i}: 已分配 {mem_allocated:.0f}MB, "
                      f"已预留 {mem_reserved:.0f}MB")
        return torch.device("cuda")
    return torch.device("cpu")

device = get_device()

# 模型和数据应在同一设备上
model = torch.nn.Linear(10, 5).to(device)
data = torch.randn(32, 10).to(device)
output = model(data)
```

## 与 NumPy 互转

PyTorch 张量与 NumPy 数组之间的转换非常高效，因为它们可以共享底层内存（CPU 张量情况下）。

### NumPy 转 PyTorch

```python
import torch
import numpy as np

# NumPy 数组 -> PyTorch 张量
np_array = np.array([1.0, 2.0, 3.0, 4.0])

# 方法一: torch.from_numpy（共享内存，修改会互相影响）
tensor_from_numpy = torch.from_numpy(np_array)
print(f"from_numpy: {tensor_from_numpy}, dtype: {tensor_from_numpy.dtype}")
# 注意: numpy 默认 float64，转换后也是 float64

# 方法二: torch.tensor（复制数据，互不影响）
tensor_copy = torch.tensor(np_array)
print(f"torch.tensor: {tensor_copy}, dtype: {tensor_copy.dtype}")

# 方法三: torch.as_tensor（尽量共享内存，支持更多输入源）
tensor_as = torch.as_tensor(np_array)
print(f"torch.as_tensor: {tensor_as}")

# 共享内存示例
np_arr = np.array([1, 2, 3], dtype=np.float32)
tensor = torch.from_numpy(np_arr)
np_arr[0] = 999
print(f"修改 numpy 后，tensor 也变了: {tensor}")  # tensor([999., 2., 3.])
```

### PyTorch 转 NumPy

```python
import torch
import numpy as np

# PyTorch 张量 -> NumPy 数组
tensor = torch.tensor([1.0, 2.0, 3.0])

# 方法一: .numpy()（共享内存）
np_array = tensor.numpy()
print(f"numpy(): {np_array}, type: {type(np_array)}")

# 方法二: .numpy() 在 detach 后（常用于需要梯度的张量）
tensor_grad = torch.randn(3, requires_grad=True)
# tensor_grad.numpy() 会报错，因为需要先 detach
np_from_grad = tensor_grad.detach().numpy()
print(f"detach().numpy(): {np_from_grad}")

# 方法三: np.array()（会复制数据）
np_copy = np.array(tensor)
print(f"np.array(): {np_copy}")

# 共享内存示例
t = torch.tensor([1.0, 2.0, 3.0])
n = t.numpy()
t[0] = 999
print(f"修改 tensor 后，numpy 也变了: {n}")  # [999. 2. 3.]
```

### GPU 张量的转换

```python
import torch
import numpy as np

if torch.cuda.is_available():
    # GPU 张量不能直接转换为 NumPy，需要先移到 CPU
    gpu_tensor = torch.randn(3, 3, device="cuda")

    # 方法一: 先 .cpu() 再 .numpy()
    np_array = gpu_tensor.cpu().numpy()

    # 方法二: 使用 .to()
    np_array = gpu_tensor.to("cpu").numpy()

    # NumPy 到 GPU 张量
    np_arr = np.array([1, 2, 3], dtype=np.float32)
    gpu_tensor = torch.from_numpy(np_arr).to("cuda")
    # 或
    gpu_tensor = torch.tensor(np_arr, device="cuda")

    print(f"GPU 张量转 NumPy: {np_array.shape}")
    print(f"NumPy 转 GPU 张量: {gpu_tensor.device}")
```

### 转换速查表

| 转换方向 | 方法 | 共享内存 | 说明 |
|---------|------|---------|------|
| NumPy -> CPU Tensor | `torch.from_numpy(arr)` | 是 | 要求 numpy 数组支持 |
| NumPy -> CPU Tensor | `torch.tensor(arr)` | 否 | 数据复制 |
| NumPy -> CPU Tensor | `torch.as_tensor(arr)` | 尽量是 | 智能选择 |
| NumPy -> GPU Tensor | `torch.tensor(arr).to("cuda")` | 否 | 必须经过 CPU |
| CPU Tensor -> NumPy | `tensor.numpy()` | 是 | 仅 CPU 张量 |
| CPU Tensor -> NumPy | `np.array(tensor)` | 否 | 数据复制 |
| GPU Tensor -> NumPy | `tensor.cpu().numpy()` | 否 | 必须先移到 CPU |
| Tensor (with grad) -> NumPy | `tensor.detach().cpu().numpy()` | 否 | 需要 detach |

## 参考资料

- [PyTorch 官方文档](https://pytorch.org/docs/stable/)
- [PyTorch 教程](https://pytorch.org/tutorials/)
- [Tensor API](https://pytorch.org/docs/stable/tensors.html)
