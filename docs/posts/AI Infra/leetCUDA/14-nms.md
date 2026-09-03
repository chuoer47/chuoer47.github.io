---
title: NMS
order: 14
---

# NMS CUDA代码学习

> 本人学习笔记，AI总结

NMS（Non-Maximum Suppression）是目标检测的收尾算子：按分数从高到低贪心保留框，删掉与已保留框重叠（IoU > 阈值）的框。它是本阶段唯一的**顺序敏感**算法——"分数高的先决定，分数低的看前面的脸色"——这种**串行依赖**撞上 GPU 的并行天性，会撞出真问题。本篇有一个比代码本身更重要的发现：**这个 kernel 存在数据竞争，实测 10 次运行结果不一样**（132/133/134 个保留框随机波动）。剖析一个"看起来能跑、实际不正确"的 kernel，是本篇的真正内容。

## 算法与数据流

```
输入: boxes (N,4) [x1,y1,x2,y2], scores (N,), iou_threshold
1. host: 按 score 降序排序 boxes          ← 在 CPU/GPU 上用 torch.sort 完成
2. kernel: 每个 box 一个线程:
     遍历所有排在自己前面的框 i (0..idx-1):
       若 i 被保留 且 IoU(自己, i) > 阈值 → 自己被抑制, keep[idx]=0, 提前退出
     遍历完没被抑制 → keep[idx]=1
3. host: 收集 keep==1 的索引返回
```

正确性依赖一个**隐含假设**：线程 idx 读 `keep[i]`（i < idx）时，线程 i 已经写完了 `keep[i]`。

## 完整代码

### `nms.cu`
<details>
<summary> nms.cu </summary>

```c++
#include <algorithm>
#include <cuda_fp16.h>
#include <cuda_runtime.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>

#define WARP_SIZE 32
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])

__global__ void nms_kernel(const float *boxes, const float *scores, int *keep,
                           int num_boxes, float iou_threshold) {
  const int threadsPerBlock = blockDim.x;
  const int threadId = threadIdx.x;
  const int blockId = blockIdx.x;
  const int idx = blockId * threadsPerBlock + threadId;

  if (idx >= num_boxes)
    return;

  float x1 = boxes[idx * 4 + 0];
  float y1 = boxes[idx * 4 + 1];
  float x2 = boxes[idx * 4 + 2];
  float y2 = boxes[idx * 4 + 3];
  int suppressed = 0;

  for (int i = 0; i < idx; ++i) {
    if (keep[i] == 0)
      continue;

    float x1_i = boxes[i * 4 + 0];
    float y1_i = boxes[i * 4 + 1];
    float x2_i = boxes[i * 4 + 2];
    float y2_i = boxes[i * 4 + 3];

    float inter_x1 = max(x1, x1_i);
    float inter_y1 = max(y1, y1_i);
    float inter_x2 = min(x2, x2_i);
    float inter_y2 = min(y2, y2_i);
    float inter_w = max(0.0f, inter_x2 - inter_x1);
    float inter_h = max(0.0f, inter_y2 - inter_y1);
    float inter_area = inter_w * inter_h;

    float area = (x2 - x1) * (y2 - y1);
    float area_i = (x2_i - x1_i) * (y2_i - y1_i);
    float iou = inter_area / (area + area_i - inter_area);

    if (iou > iou_threshold) {
      keep[idx] = 0;
      return;
    }
  }
  keep[idx] = 1;
  return;
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T) << std::endl;                           \
    throw std::runtime_error("values must be " #th_type);                      \
  }

torch::Tensor nms(torch::Tensor boxes, torch::Tensor scores,
                  float iou_threshold) {
  CHECK_TORCH_TENSOR_DTYPE(boxes, torch::kFloat32);
  CHECK_TORCH_TENSOR_DTYPE(scores, torch::kFloat32);
  const int num_boxes = boxes.size(0);
  auto toption =
      torch::TensorOptions().dtype(torch::kInt32).device(boxes.device());
  auto keep = torch::empty({boxes.size(0)}, toption);
  dim3 block(WARP_SIZE);
  dim3 grid((num_boxes + WARP_SIZE - 1) / WARP_SIZE);
  // sort boxes by scores
  auto order_t = std::get<1>(
      scores.sort(/*stable=*/true, /*dim=*/0, /* descending=*/true));
  auto boxes_sorted = boxes.index_select(0, order_t).contiguous();

  nms_kernel<<<grid, block>>>(
      reinterpret_cast<float *>(boxes_sorted.data_ptr()),
      reinterpret_cast<float *>(scores.data_ptr()),
      reinterpret_cast<int *>(keep.data_ptr()), num_boxes, iou_threshold);
  auto keep_cpu = keep.to(torch::kCPU);

  std::vector<int> keep_indices;
  auto keep_accessor = keep_cpu.accessor<int, 1>();
  for (int i = 0; i < num_boxes; ++i) {
    if (keep_accessor[i] == 1) {
      keep_indices.push_back(i);
    }
  }
  return torch::tensor(keep_indices,
                       torch::TensorOptions().dtype(torch::kInt32));
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) { TORCH_BINDING_COMMON_EXTENSION(nms) }
```

</details>

### `nms.py`
<details>
<summary> nms.py </summary>

```python
import time

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

lib = load(
    name="nms_lib",
    sources=["nms.cu"],
    extra_cuda_cflags=[
        "-O3",
        "--expt-relaxed-constexpr",
        "--expt-extended-lambda",
        "--use_fast_math",
    ],
    extra_cflags=["-std=c++17"],
)

# 官方 nms.py 用 torchvision.ops.nms 做对照; 本环境未装 torchvision,
# benchmark 对照改用"纯 PyTorch 贪心循环"实现 (见实测部分)

print("-" * 85)
for N in [1024, 2048, 4096]:
    print(" " * 40 + f"N={N}")
    boxes = torch.rand(N, 4).cuda().float() * 100
    boxes[:, 2:] += boxes[:, :2] + 1  # x2>x1, y2>y1
    scores = torch.rand(N).cuda().float()

    def run_cuda():
        keep = lib.nms(boxes, scores, 0.5)

    def run_torchvision():
        from torchvision.ops import nms
        nms(boxes, scores, 0.5)

    # benchmark 两个版本...
```

</details>

## 逐段代码剖析/学习

### 1. IoU 计算：全是向量化老朋友

kernel 内的 IoU 公式部分（相交矩形 max/min、面积、交并比）是纯标量数学，没有新东西。注意 `boxes[idx*4 + 0..3]` 的 SoA-in-AoD 布局（一个 box 的 4 个坐标连续）——同一线程读 4 个连续 float，一次 128bit load 能装下（编译器会合并），访存不是瓶颈。

### 2. 核心结构：O(N²) 的"每线程回看"

```c++
for (int i = 0; i < idx; ++i) {
  if (keep[i] == 0)       // ← 读别的线程写的 keep!
    continue;
  ... 算 IoU ...
  if (iou > iou_threshold) { keep[idx] = 0; return; }
}
keep[idx] = 1;
```

每个线程回看**所有排在自己前面**的框，问"我被任何一个保留框压住了吗"。这个结构的诱惑在于：它把 NMS 的 O(N²) 两两比较**并行化**了——第 idx 个线程独立完成自己的回看，看起来"每个线程互不干扰地写 keep[idx]"（写端确实无竞争，每线程只写自己的格子）。

**但读端有竞争**。GPU 的 block 调度**没有任何顺序保证**——block 5 可能先于 block 0 执行。当线程 idx 读 `keep[i]`（i < idx）时：

- 若线程 i **已经写完** `keep[i]`：读到正确值 ✓
- 若线程 i **还没跑**（还在排队）：`keep` 是 `torch::empty` 分配的**未初始化内存**——读到垃圾值！垃圾恰好是 0 → 误判"i 已被抑制"→ 跳过本该压住自己的框 → **多保留框**；垃圾非 0 → 误判"i 被保留"→ 可能错杀自己 → **少保留框**。

**实测证据**（N=200，同一输入跑 10 次）：

```
kept 数: [132, 134, 134, 133, 133, 133, 133, 133, 133, 133]
→ 结果不稳定, 数据竞争实锤
```

对照 N=4096 时与纯 PyTorch 贪心参考的 kept 数（1053 vs 1053）偶尔一致、小规模（N=200）稳定差 1~2 个——竞争的破坏是**概率性**的，数据量大时被掩盖成"看起来对"，这是数据竞争最阴险的地方：**它不是崩溃，是偶发的、随负载波动的错误结果**。

### 3. 为什么"看起来能跑"：竞争的隐蔽性

这个 kernel 的教学价值在于它**通过了表面验证**：

- 结果数量级正确（1024 框 keep ~444，与参考实现一致或差 1~2）
- 大多数时候结果甚至完全一致（N=4096 时 kept 数对上了）
- 没有 CUDA 错误、没有越界、没有 NaN

只有**重复运行同一输入**才暴露问题。这是并行 bug 的典型形态——记住检测手段：

```
1. 同一输入跑 10 次, 结果不一致 → 竞争铁证
2. compute-sanitizer --tool racecheck 可以静态检测 smem 竞争
   (本例是 global 内存竞争, racecheck 不覆盖, 靠方法论)
3. 问自己: 我的每个读, 写它的那个线程保证先执行了吗?
   GPU 只保证同 block 内 (靠 __syncthreads) 和同 warp 内的顺序
```

### 4. 怎么修：三种正确路线

**路线 A：多轮迭代法**（把串行依赖改成迭代收敛）

NMS 的依赖本质是"分数高的决定传给分数低的"。多轮法把一轮 kernel 改成多轮：每轮每个线程只回看"已被确认保留"的框，被抑制的框的 keep 值随轮次传播。轮数最坏 N（每轮只确定一个框），平均 log 级——把串行度藏在轮数里。

**路线 B：分块 + 轮内并行**（工业界的做法，CUDA 官方 sample 就是这个）

```
把 N 个框按 64 个一组分块:
for each 块 m (串行, 一次一个块):
  块 m 内: 用 64 线程并行算块内两两 IoU + 与已保留框的比较
  块间依赖用 "前缀块的决定已全部落盘" 保证
```

串行的粒度从"每框"降到"每块"，块内 64 路并行——**把不可消除的串行性压到最小，把可并行的部分撑满**。这就是"顺序敏感算法上 GPU"的标准姿势：**不是消灭串行，而是缩小串行段、扩大并行段**（第三阶段 FA 的 online softmax 分块结构，本质是同一思想在数值算法上的应用）。

**路线 C：算法替换**。Soft-NMS 等变体把硬抑制改成衰减分数，天然无序——但语义变了，不算修复。

### 5. host 侧细节：sort 在 kernel 外

```c++
auto order_t = std::get<1>(scores.sort(/*stable=*/true, /*dim=*/0, /*descending=*/true));
auto boxes_sorted = boxes.index_select(0, order_t).contiguous();
```

排序用 torch.sort 完成（`stable=true` 保证同分框顺序确定——**排序不稳定本身就是一种"合法的随机性"**，这里防的是另一层不确定性），kernel 只做抑制判定。这是"复杂前处理交给框架、kernel 只做热路径"的合理分工；返回的索引是排序后的序号，严格实现应再 `order_t[keep]` 映射回原索引（本实现直接返回排序后位置，调用方需注意）。

## 实测数据（4090）

| N | CUDA kernel | 纯 PyTorch 贪心循环 | 加速 |
|---|---|---|---|
| 1024 | 0.165ms | 98.0ms | 594x |
| 4096 | 0.428ms | 241.3ms | 564x |
| 16384 | 1.336ms | 639.2ms | 478x |

- 即便带着竞争 bug，CUDA 版也比"逐框贪心 + 每步一个 torch 算子"的参考实现快 **~500 倍**——参考实现的 639ms 几乎全是 Python 循环 + 算子启动开销（每步同步一次）。
- 但要记住：**快 500 倍的答案本身不可靠**（kept 数会波动）——性能数字不能掩盖正确性缺陷，这个反差正是本篇要传达的：**先正确，再快**。

## 本篇小结

1. **顺序敏感算法 vs GPU 并行**：NMS 的贪心依赖（前面的决定影响后面的判断）与 block 无序调度天然冲突——不是所有算法都能"每线程独立"地并行化。
2. **global 内存数据竞争**：写端无竞争（每线程写自己的 keep[idx]）不等于安全——读端 `keep[i]` 依赖其他线程先完成，GPU 不保证 block 间顺序，未初始化内存的垃圾值导致概率性错误。
3. **竞争的隐蔽性**：不崩溃、大多数时候结果正确、只有重复运行才暴露——"同输入跑 10 次结果不一致"是检测竞争的最低成本手段。
4. **正确路线：分块 + 轮内并行**（CUDA 官方 sample 的做法）——缩小串行段、扩大并行段；这一思想与 FA 的 online softmax 分块同构。
5. **性能与正确性的优先级**：500 倍加速建立在错误结果上毫无意义——先正确，再快。这也是为什么 cuBLAS/cuDNN 的函数文档都要花大篇幅写"确定性保证"。
