---
title: "GPU 训练与混合精度"
date: 2026-06-22
tags: [PyTorch, CUDA, 混合精度, 分布式训练, 深度学习]
category: AI
order: 9
---

# GPU 训练与混合精度

深度学习模型的训练通常需要大量计算资源。GPU（图形处理单元）凭借其大规模并行计算能力，已成为深度学习训练的核心硬件。本文将全面介绍如何在 PyTorch 中利用 GPU 进行高效训练，涵盖 CUDA 基础、混合精度训练、多 GPU 分布式训练以及显存优化技巧。

---

## CUDA 基础概念

### 什么是 CUDA

CUDA（Compute Unified Device Architecture）是 NVIDIA 推出的并行计算平台和编程模型。它允许开发者利用 NVIDIA GPU 的数千个核心进行通用计算（GPGPU），而不仅限于图形渲染。

在深度学习中，CUDA 的作用体现在：

- **矩阵运算加速**：神经网络的核心运算是矩阵乘法，GPU 的并行架构天然适合这类计算。
- **cuDNN 集成**：NVIDIA 提供的深度神经网络库（cuDNN），针对常见深度学习算子（卷积、池化、RNN 等）做了极致优化。
- **自动微分支持**：PyTorch 的自动微分引擎在 CUDA 后端上运行，梯度计算同样在 GPU 上并行执行。

### GPU 架构简述

NVIDIA GPU 采用层次化的并行架构：

| 层次 | 组成 | 说明 |
|------|------|------|
| GPU | 多个流式多处理器（SM） | 一个 GPU 芯片包含数十到上百个 SM |
| SM | 多个 CUDA 核心 + 共享内存 | 每个 SM 包含数十到上百个 FP32 核心 |
| Warp | 32 个线程 | GPU 调度的最小执行单位，同一线程束执行相同指令 |
| 线程 | 最小执行单元 | 每个线程执行一份 kernel 代码 |

关键硬件参数：

- **显存（VRAM）**：存储模型参数、梯度、优化器状态和输入数据。消费级 GPU 通常有 8-24 GB，数据中心 GPU 可达 40-80 GB。
- **显存带宽**：GPU 计算速度极快，但显存带宽往往成为瓶颈。HBM（高带宽显存）技术正是为了解决这一问题。
- **Tensor Core**：从 Volta 架构开始引入的专用计算单元，专门用于矩阵乘加运算（GEMM），是混合精度训练的硬件基础。

---

## 设备管理

### 检查 CUDA 可用性

在使用 GPU 之前，首先需要确认环境是否正确配置了 CUDA：

```python
import torch

# 检查 CUDA 是否可用
print(f"CUDA 可用: {torch.cuda.is_available()}")

# CUDA 版本
print(f"CUDA 版本: {torch.version.cuda}")

# cuDNN 版本
print(f"cuDNN 版本: {torch.backends.cudnn.version()}")

# 可用 GPU 数量
print(f"GPU 数量: {torch.cuda.device_count()}")

# 当前 GPU 名称
if torch.cuda.is_available():
    print(f"当前 GPU: {torch.cuda.get_device_name(0)}")

    # 显存信息
    total_mem = torch.cuda.get_device_properties(0).total_mem / 1024**3
    print(f"总显存: {total_mem:.1f} GB")
```

### torch.device 使用

`torch.device` 表示张量所在的计算设备，是设备管理的核心抽象：

```python
# 方式一：通过字符串创建设备
device_cpu = torch.device("cpu")
device_cuda = torch.device("cuda")          # 默认使用 GPU 0
device_cuda0 = torch.device("cuda:0")       # 显式指定 GPU 0
device_cuda1 = torch.device("cuda:1")       # 显式指定 GPU 1

# 方式二：动态选择设备（推荐）
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"使用设备: {device}")
```

### 将模型和数据移至 GPU

```python
import torch
import torch.nn as nn

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 模型移至 GPU
model = nn.Linear(10, 5)
model = model.to(device)

# 张量移至 GPU
x = torch.randn(32, 10)
x = x.to(device)

# 直接在 GPU 上创建张量
y = torch.randn(32, 5, device=device)

# 前向传播（模型和输入必须在同一设备）
output = model(x)
print(f"输出设备: {output.device}")

# 取回 CPU（用于指标计算、保存等）
output_cpu = output.cpu()
# 或
output_cpu = output.to("cpu")
```

### 最佳实践：设备无关的代码编写

```python
def get_device() -> torch.device:
    """自动选择最优计算设备"""
    if torch.cuda.is_available():
        return torch.device("cuda")
    # Apple Silicon GPU 支持（PyTorch 1.12+）
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    else:
        return torch.device("cpu")

device = get_device()

# 所有模型和数据统一通过 device 变量管理
model = MyModel().to(device)
for epoch in range(num_epochs):
    for data, target in dataloader:
        data, target = data.to(device), target.to(device)
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
```

---

## 多 GPU 设备指定与可见性

### CUDA_VISIBLE_DEVICES 环境变量

`CUDA_VISIBLE_DEVICES` 是控制 GPU 可见性的最常用方式，它在操作系统层面限制程序只能看到指定的 GPU。

```bash
# 只使用 GPU 0
CUDA_VISIBLE_DEVICES=0 python train.py

# 使用 GPU 0 和 GPU 1
CUDA_VISIBLE_DEVICES=0,1 python train.py

# 使用 GPU 2 和 GPU 3
CUDA_VISIBLE_DEVICES=2,3 python train.py

# 禁用所有 GPU（强制使用 CPU）
CUDA_VISIBLE_DEVICES="" python train.py
```

```python
import os
# 也可以在 Python 代码中设置（必须在 import torch 之前）
os.environ["CUDA_VISIBLE_DEVICES"] = "0,1"

import torch
# 此时 torch.cuda.device_count() 返回 2
# 原始的 GPU 2 和 GPU 3 在程序中被映射为 cuda:0 和 cuda:1
```

### 代码中动态选择设备

```python
import torch

def setup_device(gpu_id: int = 0) -> torch.device:
    """指定使用特定 GPU"""
    if torch.cuda.is_available():
        if gpu_id >= torch.cuda.device_count():
            print(f"警告: GPU {gpu_id} 不存在，使用 GPU 0")
            gpu_id = 0
        device = torch.device(f"cuda:{gpu_id}")
        torch.cuda.set_device(device)
        print(f"使用 GPU {gpu_id}: {torch.cuda.get_device_name(gpu_id)}")
    else:
        device = torch.device("cpu")
        print("CUDA 不可用，使用 CPU")
    return device

# 使用 GPU 1
device = setup_device(gpu_id=1)
```

### 显存管理

```python
import torch

# 查看当前显存使用情况
print(f"已分配显存: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
print(f"缓存显存: {torch.cuda.memory_reserved() / 1024**2:.1f} MB")

# 手动清空显存缓存
torch.cuda.empty_cache()

# 显存统计摘要
print(torch.cuda.memory_summary())

# 使用上下文管理器限制显存分配
# 注意：不会限制 PyTorch 的显存使用，只是触发 OOM 前的预警
with torch.cuda.device(0):
    x = torch.randn(1000, 1000, device="cuda")
```

---

## 混合精度训练

### 什么是混合精度

混合精度训练（Mixed Precision Training）是指在模型训练过程中同时使用单精度（FP32）和半精度浮点数（FP16/BF16），以减少显存占用并加速计算。

三种常见浮点格式对比：

| 格式 | 位数 | 符号位 | 指数位 | 尾数位 | 数值范围 | 精度 |
|------|------|--------|--------|--------|----------|------|
| FP32 | 32 | 1 | 8 | 23 | 约 +-3.4e38 | 高 |
| FP16 | 16 | 1 | 5 | 10 | 约 +-6.5e4 | 低 |
| BF16 | 16 | 1 | 8 | 7 | 约 +-3.4e38 | 中 |

混合精度训练的核心优势：

1. **显存减半**：FP16/BF16 张量占用的显存是 FP32 的一半。
2. **计算加速**：Tensor Core 对 FP16/BF16 运算有 2-8 倍的加速。
3. **通信加速**：分布式训练中，梯度通信量减半。

混合精度训练的关键挑战：

- **数值溢出**：FP16 的数值范围较小，梯度可能上溢或下溢。
- **精度损失**：小梯度值可能因精度不足而被舍入为零。

解决方案是 **损失缩放（Loss Scaling）**：将损失值乘以一个较大的缩放因子，使梯度值落在 FP16 的有效范围内，再在优化器更新前将梯度除以相同的缩放因子。

### torch.cuda.amp.autocast 详解

`torch.cuda.amp.autocast` 是 PyTorch 提供的自动混合精度上下文管理器。在该上下文中，PyTorch 会自动将适合的操作转换为 FP16/BF16 执行，而对数值敏感的操作保持 FP32。

```python
import torch

# 基本用法
model = MyModel().cuda()
x = torch.randn(32, 3, 224, 224, device="cuda")

with torch.cuda.amp.autocast():
    output = model(x)
    loss = criterion(output, target)

print(f"输出 dtype: {output.dtype}")  # torch.float16
```

autocast 的类型转换策略：

| 操作类型 | 转换行为 | 示例 |
|----------|----------|------|
| 矩阵乘法（GEMM） | 转为 FP16/BF16 | nn.Linear, nn.Conv2d |
| 矩阵-向量乘法 | 转为 FP16/BF16 | torch.mm, torch.mv |
| 批归一化 | 保持 FP32 | nn.BatchNorm2d |
| 层归一化 | 保持 FP32 | nn.LayerNorm |
| Softmax | 保持 FP32 | torch.softmax |
| 损失函数 | 保持 FP32 | nn.CrossEntropyLoss |
| 嵌入层 | 转为 FP16/BF16 | nn.Embedding |

```python
# 指定数据类型（默认为 float16）
with torch.cuda.amp.autocast(dtype=torch.float16):
    output = model(x)

# 使用 BFloat16（需要 Ampere 或更新架构的 GPU）
with torch.cuda.amp.autocast(dtype=torch.bfloat16):
    output = model(x)

# 嵌套使用：部分操作退出 autocast
with torch.cuda.amp.autocast():
    # 这些操作在混合精度下执行
    out1 = layer1(x)
    with torch.cuda.amp.autocast(enabled=False):
        # 这些操作强制使用 FP32
        out2 = special_fp32_operation(out1.float())
    out3 = layer2(out2)
```

### GradScaler 原理与使用

`GradScaler` 用于解决 FP16 训练中的梯度下溢问题。其工作流程：

1. **缩放损失**：将损失乘以一个较大的缩放因子（默认初始值为 2^16）。
2. **反向传播**：缩放后的损失产生缩放后的梯度，使小梯度值能够被 FP16 表示。
3. **梯度更新前反缩放**：在 `optimizer.step()` 之前，将梯度除以缩放因子恢复原始值。
4. **动态调整缩放因子**：如果检测到梯度中出现 inf 或 NaN，跳过本步更新并减小缩放因子；如果连续多步没有出现溢出，则增大缩放因子。

```python
import torch
from torch.cuda.amp import autocast, GradScaler

model = MyModel().cuda()
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
criterion = nn.CrossEntropyLoss()

# 创建 GradScaler
scaler = GradScaler()

for epoch in range(num_epochs):
    for data, target in dataloader:
        data, target = data.cuda(), target.cuda()
        optimizer.zero_grad()

        # 前向传播在 autocast 上下文中
        with autocast():
            output = model(data)
            loss = criterion(output, target)

        # 反向传播：使用 scaler 缩放损失并反向传播
        scaler.scale(loss).backward()

        # 梯度裁剪（如果需要）：必须在 unscale 之前或之后
        # 推荐在 unscale 之后进行裁剪
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)

        # 更新参数
        scaler.step(optimizer)

        # 更新缩放因子
        scaler.update()
```

GradScaler 的关键参数：

```python
scaler = torch.cuda.amp.GradScaler(
    init_scale=65536.0,         # 初始缩放因子（2^16）
    growth_factor=2.0,          # 缩放因子增长倍数
    backoff_factor=0.5,         # 缩放因子缩小倍数
    growth_interval=2000,       # 每多少步尝试增大缩放因子
    enabled=True,               # 是否启用
)
```

### 完整混合精度训练代码示例

```python
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.cuda.amp import autocast, GradScaler
from torchvision import datasets, transforms


def train_with_mixed_precision():
    """完整的混合精度训练流程"""

    # ---- 配置 ----
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    num_epochs = 10
    batch_size = 128
    learning_rate = 1e-3

    # ---- 数据 ----
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,)),
    ])
    train_dataset = datasets.MNIST("./data", train=True, download=True, transform=transform)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True,
                              num_workers=4, pin_memory=True)

    # ---- 模型 ----
    model = nn.Sequential(
        nn.Flatten(),
        nn.Linear(784, 512),
        nn.ReLU(),
        nn.Linear(512, 256),
        nn.ReLU(),
        nn.Linear(256, 10),
    ).to(device)

    # ---- 优化器与损失函数 ----
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    criterion = nn.CrossEntropyLoss()
    scaler = GradScaler()

    # ---- 训练循环 ----
    for epoch in range(num_epochs):
        model.train()
        total_loss = 0.0
        correct = 0
        total = 0

        for batch_idx, (data, target) in enumerate(train_loader):
            data, target = data.to(device), target.to(device)
            optimizer.zero_grad()

            # 混合精度前向传播
            with autocast():
                output = model(data)
                loss = criterion(output, target)

            # 混合精度反向传播
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

            # 统计（在 FP32 下计算）
            total_loss += loss.item()
            pred = output.argmax(dim=1)
            correct += pred.eq(target).sum().item()
            total += target.size(0)

            if batch_idx % 100 == 0:
                print(f"Epoch [{epoch+1}/{num_epochs}], "
                      f"Step [{batch_idx}/{len(train_loader)}], "
                      f"Loss: {loss.item():.4f}")

        accuracy = 100.0 * correct / total
        avg_loss = total_loss / len(train_loader)
        print(f"Epoch [{epoch+1}/{num_epochs}] - "
              f"Avg Loss: {avg_loss:.4f}, Accuracy: {accuracy:.2f}%")

        # 查看当前缩放因子
        print(f"GradScaler scale: {scaler.get_scale():.0f}")

    # 保存模型
    torch.save(model.state_dict(), "model_amp.pth")
    print("训练完成，模型已保存")


if __name__ == "__main__":
    train_with_mixed_precision()
```

### BFloat16 优势与适用场景

BFloat16（Brain Floating Point 16）是 Google 提出的 16 位浮点格式，近年来在深度学习领域受到广泛关注。

**BF16 vs FP16 对比：**

| 特性 | FP16 | BF16 |
|------|------|------|
| 指数位 | 5 位 | 8 位 |
| 尾数位 | 10 位 | 7 位 |
| 数值范围 | +-65504 | 与 FP32 相同 |
| 精度 | 较高 | 较低 |
| 是否需要 Loss Scaling | 是 | 通常不需要 |
| 硬件支持 | Pascal+ GPU | Ampere+ GPU, TPU |

BF16 的核心优势：

1. **与 FP32 相同的数值范围**：几乎不会出现溢出问题，因此通常不需要 GradScaler。
2. **简化训练流程**：无需 GradScaler，代码更简洁。
3. **更好的数值稳定性**：在大模型训练中表现更稳定。

```python
import torch
from torch.cuda.amp import autocast

model = MyModel().cuda()
optimizer = torch.optim.Adam(model.parameters())

# BF16 训练：无需 GradScaler
for data, target in train_loader:
    data, target = data.cuda(), target.cuda()
    optimizer.zero_grad()

    with autocast(dtype=torch.bfloat16):
        output = model(data)
        loss = criterion(output, target)

    loss.backward()  # 直接反向传播，无需 scaler
    optimizer.step()

# 检查 GPU 是否支持 BF16
if torch.cuda.is_available():
    capability = torch.cuda.get_device_capability()
    # Ampere (SM 8.0+) 原生支持 BF16
    supports_bf16 = capability[0] >= 8
    print(f"GPU 架构: SM {capability[0]}.{capability[1]}")
    print(f"BF16 原生支持: {supports_bf16}")
```

---

## 多 GPU 训练

### DataParallel (DP) 原理、使用与局限

`DataParallel`（DP）是 PyTorch 最简单的多 GPU 并行方案。其工作原理：

1. 将一个 mini-batch 拆分到多个 GPU 上。
2. 在每个 GPU 上独立进行前向传播。
3. 将各 GPU 的输出汇总到主 GPU（默认 cuda:0）。
4. 在主 GPU 上计算损失和梯度。
5. 将梯度广播回各 GPU 更新模型。

```python
import torch
import torch.nn as nn

model = MyModel()

# 方式一：直接包装
if torch.cuda.device_count() > 1:
    print(f"使用 {torch.cuda.device_count()} 个 GPU 进行训练")
    model = nn.DataParallel(model)

model = model.cuda()

# 方式二：指定使用的 GPU
model = nn.DataParallel(model, device_ids=[0, 1, 2])

# 方式三：指定输出 GPU
model = nn.DataParallel(model, device_ids=[0, 1], output_device=1)

# 训练流程不变
for data, target in train_loader:
    data, target = data.cuda(), target.cuda()
    output = model(data)  # 自动在多 GPU 上并行
    loss = criterion(output, target)
    loss.backward()
    optimizer.step()
    optimizer.zero_grad()
```

**DP 的局限性：**

| 问题 | 说明 |
|------|------|
| GIL 瓶颈 | 受 Python 全局解释器锁限制，多线程并行效率低 |
| 主 GPU 负载不均 | 梯度汇总和参数更新在主 GPU 上进行，导致显存不均衡 |
| 通信效率低 | 使用多线程而非多进程，无法充分利用 PCIe/NVLink 带宽 |
| 不支持多机 | 仅限单机多卡场景 |
| 速度上限 | 实际加速比通常不超过 2-3 倍，即使有 8 张 GPU |

### DistributedDataParallel (DDP) 原理与使用

`DistributedDataParallel`（DDP）是 PyTorch 推荐的多 GPU 训练方案。其核心改进：

1. **多进程**：每个 GPU 对应一个独立进程，绕过 GIL 限制。
2. **AllReduce 通信**：使用高效的集合通信原语（AllReduce）同步梯度，而非将梯度汇总到主 GPU。
3. **计算与通信重叠**：DDP 在反向传播过程中，对已完成计算的梯度层立即开始 AllReduce，实现计算与通信流水线化。
4. **负载均衡**：每个进程独立维护完整的模型副本，显存使用均衡。

```python
import os
import torch
import torch.nn as nn
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler


def setup(rank: int, world_size: int):
    """初始化分布式进程组"""
    os.environ["MASTER_ADDR"] = "localhost"
    os.environ["MASTER_PORT"] = "12355"
    dist.init_process_group("nccl", rank=rank, world_size=world_size)
    torch.cuda.set_device(rank)


def cleanup():
    """销毁进程组"""
    dist.destroy_process_group()


def train(rank: int, world_size: int):
    """DDP 训练函数（每个进程执行一份）"""
    setup(rank, world_size)

    # 创建模型并移至当前 GPU
    model = MyModel().to(rank)
    model = DDP(model, device_ids=[rank])

    # 分布式采样器：确保每个进程处理不同的数据子集
    dataset = MyDataset()
    sampler = DistributedSampler(dataset, num_replicas=world_size,
                                  rank=rank, shuffle=True)
    dataloader = DataLoader(dataset, batch_size=64, sampler=sampler,
                            num_workers=4, pin_memory=True)

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    for epoch in range(10):
        sampler.set_epoch(epoch)  # 重要：确保每个 epoch 的数据顺序不同
        model.train()

        for data, target in dataloader:
            data, target = data.to(rank), target.to(rank)
            optimizer.zero_grad()
            output = model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()

        # 仅在 rank 0 上打印和保存
        if rank == 0:
            print(f"Epoch {epoch} 完成")

    # 保存模型（仅保存模型参数，不保存 DDP 包装器）
    if rank == 0:
        torch.save(model.module.state_dict(), "ddp_model.pth")

    cleanup()


if __name__ == "__main__":
    world_size = torch.cuda.device_count()
    torch.multiprocessing.spawn(train, args=(world_size,), nprocs=world_size)
```

### DP vs DDP 对比

| 特性 | DataParallel (DP) | DistributedDataParallel (DDP) |
|------|-------------------|-------------------------------|
| 并行方式 | 多线程 | 多进程 |
| GIL 限制 | 受限 | 不受限 |
| 通信方式 | 主 GPU 收集梯度 | AllReduce 梯度同步 |
| 负载均衡 | 主 GPU 负载重 | 各 GPU 负载均衡 |
| 加速效率 | 低（2-3 倍） | 高（接近线性） |
| 多机支持 | 不支持 | 支持 |
| 代码修改 | 几乎无需修改 | 需要修改（Sampler、进程初始化等） |
| 推荐场景 | 快速原型验证 | 生产训练 |

### DDP 启动方式

**方式一：torchrun（推荐，PyTorch 1.10+）**

```bash
# 单机 4 卡
torchrun --nproc_per_node=4 train.py

# 指定 GPU
CUDA_VISIBLE_DEVICES=0,1,2,3 torchrun --nproc_per_node=4 train.py

# 多机多卡
# 机器 1（master）
torchrun --nproc_per_node=4 --nnodes=2 --node_rank=0 \
    --master_addr="192.168.1.1" --master_port=29500 train.py
# 机器 2
torchrun --nproc_per_node=4 --nnodes=2 --node_rank=1 \
    --master_addr="192.168.1.1" --master_port=29500 train.py
```

```python
# train.py 中获取分布式环境变量（由 torchrun 自动设置）
import os

local_rank = int(os.environ["LOCAL_RANK"])
world_size = int(os.environ["WORLD_SIZE"])
rank = int(os.environ["RANK"])

import torch
import torch.distributed as dist

dist.init_process_group("nccl")
torch.cuda.set_device(local_rank)

model = MyModel().to(local_rank)
model = DDP(model, device_ids=[local_rank])
```

**方式二：torch.distributed.launch（旧版，已不推荐）**

```bash
# 已弃用，建议使用 torchrun
python -m torch.distributed.launch --nproc_per_node=4 train.py
```

### 进程组初始化与通信原语

```python
import torch
import torch.distributed as dist

# 初始化进程组
dist.init_process_group(
    backend="nccl",    # GPU 训练推荐 nccl，CPU 训练使用 gloo
    init_method="env://",  # 从环境变量读取 MASTER_ADDR 等
    world_size=4,      # 总进程数
    rank=0,            # 当前进程编号
)

# ---- 常用通信原语 ----

# Broadcast: 将一个进程的数据广播到所有进程
tensor = torch.zeros(4).cuda()
if dist.get_rank() == 0:
    tensor = torch.arange(4, dtype=torch.float32).cuda()
dist.broadcast(tensor, src=0)

# AllReduce: 所有进程的张量做规约运算，结果分发给所有进程
tensor = torch.ones(4).cuda() * (dist.get_rank() + 1)
dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
# 假设 world_size=4: tensor 结果为 [10, 10, 10, 10]

# Reduce: 所有进程的张量做规约运算，结果仅发送到目标进程
tensor = torch.ones(4).cuda() * (dist.get_rank() + 1)
dist.reduce(tensor, dst=0, op=dist.ReduceOp.SUM)

# AllGather: 收集所有进程的数据到所有进程
tensor_list = [torch.zeros(4).cuda() for _ in range(dist.get_world_size())]
tensor = torch.ones(4).cuda() * (dist.get_rank() + 1)
dist.all_gather(tensor_list, tensor)

# Scatter: 将一个进程的数据分发到所有进程
tensor = torch.zeros(4).cuda()
if dist.get_rank() == 0:
    scatter_list = [torch.ones(4).cuda() * i for i in range(dist.get_world_size())]
else:
    scatter_list = None
dist.scatter(tensor, scatter_list, src=0)

# Barrier: 同步屏障，所有进程到达后才继续
dist.barrier()

# 销毁进程组
dist.destroy_process_group()
```

---

## FSDP（Fully Sharded Data Parallel）简介

FSDP 是 PyTorch 提供的更高级分布式训练方案，核心思想是将模型参数、梯度和优化器状态分片（Shard）存储到各个 GPU 上，而非每个 GPU 维护完整的模型副本。

DDP vs FSDP：

| 特性 | DDP | FSDP |
|------|-----|------|
| 模型存储 | 每个 GPU 一份完整副本 | 参数分片存储 |
| 显存占用 | 高 | 低（约 1/N） |
| 通信量 | AllReduce 梯度 | AllGather 参数 + ReduceScatter 梯度 |
| 适用模型 | 中小模型 | 大模型（数十亿参数） |

```python
import torch
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
from torch.distributed.fsdp import MixedPrecision
import torch.distributed as dist

# 初始化进程组
dist.init_process_group("nccl")

# 创建模型
model = MyLargeModel()

# 配置混合精度策略
mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,     # 参数使用 BF16
    reduce_dtype=torch.bfloat16,    # 通信使用 BF16
    buffer_dtype=torch.bfloat16,    # 缓冲区使用 BF16
)

# 包装为 FSDP
model = FSDP(
    model,
    mixed_precision=mp_policy,
    use_orig_params=True,  # PyTorch 2.0+ 推荐开启
)

# 训练流程与常规训练相同
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
for data, target in dataloader:
    data, target = data.cuda(), target.cuda()
    output = model(data)
    loss = criterion(output, target)
    loss.backward()
    optimizer.step()
    optimizer.zero_grad()
```

---

## 显存优化技巧

### 梯度累积（Gradient Accumulation）

当显存不足以容纳较大的 batch size 时，可以通过梯度累积模拟大 batch 训练。原理是：在多个小 batch 上分别计算梯度并累加，每隔 N 步才执行一次参数更新。

```python
import torch

model = MyModel().cuda()
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
criterion = nn.CrossEntropyLoss()

accumulation_steps = 4  # 累积 4 步 = 等效 batch_size * 4
scaler = torch.cuda.amp.GradScaler()

for epoch in range(num_epochs):
    for batch_idx, (data, target) in enumerate(train_loader):
        data, target = data.cuda(), target.cuda()

        with torch.cuda.amp.autocast():
            output = model(data)
            # 注意：损失要除以累积步数，保证梯度平均值正确
            loss = criterion(output, target) / accumulation_steps

        scaler.scale(loss).backward()

        # 每 accumulation_steps 步更新一次
        if (batch_idx + 1) % accumulation_steps == 0:
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad()
```

### 梯度检查点（Gradient Checkpointing）

梯度检查点（也叫激活检查点，Activation Checkpointing）是一种用计算时间换取显存的技术。原理是：在前向传播时不保存中间激活值，而在反向传播需要时重新计算。

通常可以节省约 60-70% 的激活显存，代价是增加约 30% 的计算时间。

```python
import torch
from torch.utils.checkpoint import checkpoint, checkpoint_sequential

# ---- 方式一：对单个模块使用 checkpoint ----
class MyModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.block1 = HeavyBlock(256, 256)
        self.block2 = HeavyBlock(256, 256)
        self.block3 = HeavyBlock(256, 256)
        self.block4 = HeavyBlock(256, 256)

    def forward(self, x):
        # 对每个 block 使用 checkpoint
        # 前向传播时不保存激活值，反向传播时重新计算
        x = checkpoint(self.block1, x, use_reentrant=False)
        x = checkpoint(self.block2, x, use_reentrant=False)
        x = checkpoint(self.block3, x, use_reentrant=False)
        x = checkpoint(self.block4, x, use_reentrant=False)
        return x


# ---- 方式二：对连续模块使用 checkpoint_sequential ----
class SequentialModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(512, 512), nn.ReLU(),
            nn.Linear(512, 512), nn.ReLU(),
            nn.Linear(512, 512), nn.ReLU(),
            nn.Linear(512, 512), nn.ReLU(),
        )

    def forward(self, x):
        # segments=2 表示将序列分为 2 段，每段边界处设置检查点
        return checkpoint_sequential(self.layers, segments=2,
                                      input=x, use_reentrant=False)
```

### 梯度缓存清除

```python
# 及时释放不需要的张量
del intermediate_output, intermediate_loss

# 清空 GPU 缓存（不会释放正在使用的显存）
torch.cuda.empty_cache()

# 使用 torch.no_grad() 避免构建不必要的计算图
with torch.no_grad():
    predictions = model(validation_data)

# 对于评估阶段，使用 model.eval() 关闭 dropout 和 batchnorm 的梯度计算
model.eval()
with torch.no_grad():
    for data, target in val_loader:
        data, target = data.cuda(), target.cuda()
        output = model(data)
```

### 梯度检查点使用注意事项

```python
# use_reentrant 参数说明（PyTorch 2.0+）
# use_reentrant=False 是推荐设置，支持更广泛的用法（如与 DDP/FSDP 配合）
# use_reentrant=True 是旧版行为，某些场景下不兼容

# 在 HuggingFace Transformers 中使用梯度检查点
from transformers import AutoModel

model = AutoModel.from_pretrained("bert-base-uncased")
model.gradient_checkpointing_enable()

# PyTorch 原生模型中全局启用
# 注意：需要逐模块手动添加，或使用以下技巧
def enable_gradient_checkpointing(model: nn.Module):
    """为模型中的特定子模块启用梯度检查点"""
    for module in model.modules():
        if isinstance(module, nn.TransformerEncoderLayer):
            module.self_attn = checkpoint(
                module.self_attn, use_reentrant=False
            )
```

---

## 常见 CUDA 错误与排查

### 常见错误及解决方案

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `CUDA out of memory` | 显存不足 | 减小 batch size；使用梯度累积；启用梯度检查点；使用混合精度 |
| `CUDA error: device-side assert triggered` | 索引越界、数据类型不匹配 | 设置 `CUDA_LAUNCH_BLOCKING=1` 定位具体错误 |
| `NCCL error: unhandled system error` | NCCL 通信失败 | 检查网络连接；设置 `NCCL_DEBUG=INFO` 查看详细日志 |
| `RuntimeError: Expected all tensors to be on the same device` | 张量不在同一设备 | 确保所有输入、模型、中间张量在同一 GPU 上 |
| `UserWarning: CUDA initialization` | CUDA 驱动或运行时不匹配 | 检查 `nvidia-smi` 和 `nvcc --version` 是否一致 |
| `illegal memory access` | 内核越界访问 | 更新驱动；检查输入数据是否合法 |

### 调试技巧

```python
import os

# 1. 同步执行 CUDA 操作（牺牲性能换取准确的错误定位）
os.environ["CUDA_LAUNCH_BLOCKING"] = "1"

# 2. 启用异常检测（会对每个 CUDA 操作做同步检查，严重降低性能）
torch.autograd.set_detect_anomaly(True)

# 3. NCCL 调试信息
os.environ["NCCL_DEBUG"] = "INFO"

# 4. 查看具体的 CUDA 错误
try:
    output = model(data)
except RuntimeError as e:
    if "out of memory" in str(e):
        print("显存不足！尝试以下操作：")
        print("  - 减小 batch_size")
        print("  - 启用混合精度训练")
        print("  - 使用梯度检查点")
        torch.cuda.empty_cache()
    else:
        raise e

# 5. 监控显存使用
def print_gpu_memory():
    """打印当前 GPU 显存使用情况"""
    for i in range(torch.cuda.device_count()):
        allocated = torch.cuda.memory_allocated(i) / 1024**3
        reserved = torch.cuda.memory_reserved(i) / 1024**3
        total = torch.cuda.get_device_properties(i).total_mem / 1024**3
        print(f"GPU {i}: 已分配 {allocated:.2f} GB / "
              f"已保留 {reserved:.2f} GB / "
              f"总计 {total:.1f} GB")

# 在关键位置调用
print_gpu_memory()
```

---

## 参考资料

- [PyTorch CUDA Semantics](https://pytorch.org/docs/stable/notes/cuda.html)
- [torch.cuda - PyTorch Documentation](https://pytorch.org/docs/stable/cuda.html)
- [Automatic Mixed Precision - PyTorch Tutorial](https://pytorch.org/tutorials/recipes/recipes/amp_recipe.html)
- [torch.cuda.amp - PyTorch Documentation](https://pytorch.org/docs/stable/amp.html)
- [Getting Started with Distributed Data Parallel](https://pytorch.org/tutorials/intermediate/ddp_tutorial.html)
- [DistributedDataParallel - PyTorch Documentation](https://pytorch.org/docs/stable/generated/torch.nn.parallel.DistributedDataParallel.html)
- [Fully Sharded Data Parallel](https://pytorch.org/tutorials/intermediate/FSDP_tutorial.html)
- [Gradient Checkpointing - torch.utils.checkpoint](https://pytorch.org/docs/stable/checkpoint.html)
- [torch.distributed - PyTorch Documentation](https://pytorch.org/docs/stable/distributed.html)
