---
title: NMS
order: 14
---

# NMS CUDA代码学习

> 本人学习笔记，AI总结

NMS（Non-Maximum Suppression）是目标检测的收尾算子：按分数从高到低贪心保留框，删掉与已保留框重叠（IoU > 阈值）的框。它是本阶段唯一的**顺序敏感**算法——"分数高的先决定，分数低的看前面的脸色"——这种串行依赖撞上 GPU 的并行天性，会撞出真问题。本篇记录了一个完整的"发现 bug → 诊断 → 修复 → 提 PR"过程（对应 [LeetCUDA issue #517](https://github.com/xlite-dev/LeetCUDA/issues/517) 与 [PR #519](https://github.com/xlite-dev/LeetCUDA/pull/519)）：原实现有**三重 bug**（未初始化读、跨 block 竞态、排序后索引未映射回），实测同输入跑 10 次，保留框数在 132/133/134 之间随机波动。把一个"看起来能跑、实际不正确"的 kernel 修到与 torchvision 逐元素一致、8192 框规模反超 1.69 倍——这是本篇的真正内容。

## 算法与数据流

```
输入: boxes (N,4) [x1,y1,x2,y2], scores (N,), iou_threshold
1. host: 按 score 降序排序 boxes（stable sort，同分保持输入顺序）
2. Phase 1 kernel: 每个 warp 负责一个框 i，32 个 lane 并行对 32 个候选框
   算 IoU，__ballot_sync 收 32 张"抑制票"为一个 32-bit 字，写入 suppression
   bitmask：mask[i*words + j/32] 的 bit (j%32) = 1  <=>  i 压住 j
3. Phase 2 kernel: 单 block 内，共享内存位图按分数从高到低顺序消解，
   __syncthreads 保证"前面的决定"对"后面的判断"可见
4. host: keep 位映射回原始输入索引返回
```

两个阶段的分工值得先想清楚：**Phase 1 把"两两比较"这个 O(N²) 的可并行部分吃满并行度**（每对框只算一次 IoU，32 次 IoU 换 1 次 32-bit 写）；**Phase 2 把"贪心顺序"这个不可并行的部分压缩到单个 block 内**，用共享内存位图做顺序消解。顺序敏感算法上 GPU 的标准姿势：不是消灭串行，而是缩小串行段、扩大并行段（09 篇分块转置、04 篇 online softmax 分块，本质是同一思想）。

## 三重 bug 诊断（修复前的原实现）

原版 kernel 的思路是"每线程一个框，回看所有前面的框"：线程 idx 遍历 i < idx，若 `keep[i]==1` 且 IoU > 阈值则把自己置 0。它同时踩了三个坑：

### bug 1：`torch::empty` 未初始化读

```c++
auto keep = torch::empty({num_boxes}, toption);   // 垃圾内存！
```

线程 idx 读 `keep[i]`（i < idx）时，若线程 i 还没跑，读到的是 `empty` 分配的**垃圾值**。垃圾恰好为 0 → 误判"i 已被抑制" → 跳过本该压住自己的框 → **多保留**；垃圾非 0 → 误判"i 被保留" → 可能错杀自己 → **少保留**。

**这是三重 bug 里最根本的一个：所有跨线程读共享状态的写法，状态必须先有定义。**

### bug 2：跨 block 竞态（就算换成 zeros 也治不了）

把 `empty` 换成 `zeros` 只解决"读到垃圾"，**解决不了顺序问题**：GPU 对 block 间的调度**没有任何顺序保证**，block 5 可以先于 block 0 执行。线程 idx 读 `keep[i]` 时，线程 i 的写入是否可见，完全看调度运气——这是一个真正的 data race，不是初始化问题。

`compute-sanitizer --tool racecheck` 只查共享内存竞争，global 内存的跨 block 顺序依赖它查不出来。能靠的检测手段是最低成本的一招：**同一输入重复跑 10 次**：

```
kept 数: [132, 134, 134, 133, 133, 133, 133, 133, 133, 133]
→ 结果不稳定，竞态实锤
```

竞态的破坏是**概率性**的：数据量大时被掩盖成"看起来对"，小规模时差 1~2 个——它不崩溃、不报错、大多数时候结果正确，这是并行 bug 最阴险的形态。

### bug 3：排序后索引没有映射回原始输入

```c++
// 旧版 host 代码
auto order_t = std::get<1>(scores.sort(...));   // 排序置换 order
auto boxes_sorted = boxes.index_select(0, order_t).contiguous();
nms_kernel<<<...>>>(boxes_sorted, ...);          // kernel 在"排序后的位置"上打 keep
...
keep_indices.push_back(i);                       // ← bug：返回的是排序后的位置 i！
```

kernel 在**排序后的数组**上工作，`keep[i]==1` 中的 i 是排序后的位置，正确返回应该是 `order_t[i]`（原索引）。旧版直接把排序后位置当结果返回—— torchvision 对拍时顺序全错。这是一个纯 host 侧逻辑 bug，却排在竞态之后才被发现，因为前两个 bug 让结果"随机错"，把这一个"固定错"也盖住了。

> 教学点：修并行 bug 要**一次只隔离一个变量**。先用固定小算例（6 个框）把三重 bug 各自钉死，再上随机对拍——直接上大规模随机数据，三个 bug 混在一起根本无法归因。

## 修复方案：两阶段 kernel

### Phase 1：warp-per-box 并行 IoU → suppression bitmask

启动布局：**一个 warp 负责一个框**。框已按分数降序排好，所以框 i 只可能压住 j > i 的框。warp i 的 32 个 lane 并行计算 IoU(i, j)，j 取 32 个连续值，`__ballot_sync` 把 32 个"是否抑制"的布尔投票收成一个 32-bit 整数：

```
warp i（框 i = box 5），候选框 j = 32, 33, 34, ..., 63（一个 32 框组）：

lane  0 → IoU(5, 32)  → 抑制? 是 → 票 1
lane  1 → IoU(5, 33)  → 抑制? 否 → 票 0
lane  2 → IoU(5, 34)  → 抑制? 是 → 票 1
  ...
lane 31 → IoU(5, 63)  → 抑制? 否 → 票 0

votes = __ballot_sync(FULL_MASK, suppress)
      = 0b...101 (bit0=1, bit2=1, 其余 0)
      → row[1] = votes   （word 1 管 box 32~63）
```

三个设计细节，每一个都对应一个开发中真实踩过的坑：

**① 为什么是 warp-per-box，而不是 thread-per-box？** 第一版修复想用 `__ballot_sync` 收票，但让"每个线程算完自己的 32 个 IoU 后再各自 ballot"在语义上就错了——ballot 收集的是**同一次 vote 表达式在一个 warp 内所有 lane 的值**，一个 lane 只有一个布尔值，根本没有 32 张票可收。语义正确的并行单元是 warp：32 个 lane 天然就是 32 张票。

**② bit 的全局对齐（最隐蔽的一个坑）。** 框 i 的候选从 j = i+1 开始，如果直接从 j=i+1 开始凑 32 个做 ballot，写入的 bit 位置和 Phase 2 读的 `word w bit k = box w*32+k` 全局布局就对不上（warp 0 从 j=1 开始，它写的 bit0 对应 box 1；warp 1 从 j=2 开始，它写的 bit0 对应 box 2——同一个 bit 在不同行代表不同的框！）。修复：**j_base 对齐到 32 的倍数起步**（`(i+1) & ~31`），保证"bit k 永远对应 box j_base+k"，首组里 j ≤ i 的 lane 投 0（一个框从不压住自己或更早的框）：

```
warp 3（框 3），j_base = (3+1) & ~31 = 0：
  lane 0..3 管 box 0..3 → j > 3 才有效 → 这 4 个 lane 投 0
  lane 4   管 box 4   → 正常算 IoU(3, 4)
  ...
这样 word 0 的 bit4 = "框 3 压住框 4"，与 Phase 2 的解读完全一致
```

**③ 写放大 reduction。** 每 warp 只写自己的 bitmask 行（`row[j_base/32] = votes`），行间零冲突、无需原子操作；32 次 IoU 换 1 次 32-bit 写，比"每对框一次 atomicOr"少 32 倍写流量。

### Phase 2：单 block 顺序消解（共享内存位图）

```c++
__shared__ unsigned int suppressed[];   // 位图：bit k = box k 是否已被压
for (int i = 0; i < num_boxes; ++i) {
  const bool suppressed_i = (suppressed[i/32] >> (i%32)) & 1u;
  if (!suppressed_i) {
    if (threadIdx.x == 0) keep[i] = 1;          // 框 i 幸存
    for (int w = threadIdx.x; w < mask_words; w += blockDim.x)
      suppressed[w] |= row_i[w];                // 全体线程并行 OR 上它的抑制行
  }
  __syncthreads();  // ← 每一步决策对下一步可见，竞态的根治点
}
```

贪心循环保留在 kernel 里，但**整个循环跑在一个 block 上**：`suppressed` 位图在共享内存里，`__syncthreads()` 保证第 i 步读到的位图包含前 i-1 步的全部决策——这正是 bug 2 里跨 block 访问永远给不了的 happens-before。决策之外的体力活（OR 掩码行）仍然全员并行。单 block 256 线程对这个"每步 O(N/32) 次 OR"的循环足够；Phase 1 才是需要吃满 GPU 的大并行段。

### host 侧：zeros、映射回原索引、返回类型

```c++
auto keep = torch::zeros({num_boxes}, toption);        // bug 1 的修复：定义状态
...
// bug 3 的修复：经排序置换映射回原始索引
auto keep_cpu = keep.to(torch::kCPU);
auto order_cpu = order_t.to(torch::kCPU);
auto keep_accessor = keep_cpu.accessor<int, 1>();
auto order_data = order_cpu.data_ptr<std::int64_t>();
std::vector<std::int64_t> keep_indices;
for (int i = 0; i < num_boxes; ++i)
  if (keep_accessor[i] == 1)
    keep_indices.push_back(order_data[i]);              // ← 原索引，不是 i
return torch::tensor(keep_indices, ...kInt64...);       // int64 + 同 device，对齐 torchvision
```

三个细节：`zeros` 而不是 `empty`（buffer 的每个字节都要有定义）；`order_data[i]` 把排序位置映射回原索引（bug 3 的修复）；返回 `kInt64` 且放在输入的 device 上，与 `torchvision.ops.nms` 的接口约定一致（原版还用了 `accessor<long>`，`long` 的宽度是平台相关的，`std::int64_t` 才是可移植写法）。

## 实测数据（4090）

正确性：固定 6 框算例（issue 最小复现）连跑 5 次全对；随机对拍 N∈{10,100,1024,4096,8192} × 3 seeds × 阈值 {0.5, 0.7}（分数带人工并列，专测 stable sort）共 30 组，与 `torchvision.ops.nms` **逐元素全等**。benchmark（每档 warmup 10 / iters 100）：

| nboxes | 修复版 nms | torchvision | 相对速度 |
|---|---|---|---|
| 1024 | 0.227 ms | 0.155 ms | 0.68x |
| 2048 | 0.338 ms | 0.280 ms | 0.83x |
| 4096 | 0.549 ms | 0.670 ms | 1.22x |
| 8192 | 0.927 ms | 1.565 ms | **1.69x** |

- 小规模输给 torchvision 是合理的：我们的 Phase 2 是单 block 顺序循环，启动两个 kernel 的固定开销在 N 小时占比大；torchvision 的分块 bitmask 实现在小 N 下更精简。
- **N=8192 反超 1.69 倍**：Phase 1 的 warp 级并行 IoU + 32 倍写放大 reduction 在大 N 下开始回报。
- 官方 [torchvision nms_kernel.cu](https://github.com/pytorch/vision/blob/main/torchvision/csrc/ops/cuda/nms_kernel.cu) 还有一招我们没用：分块共享 bitmask 把内存降到 O(N·blocks)——这是下一步优化方向。
- 附带一条环境坑：leetcuda env 的 torchvision 需与 torch 版本匹配（torch 2.5.1 配 torchvision 0.20.1，须 `--no-deps` 安装；错装新版会报 `operator torchvision::nms does not exist`）。

## 本篇小结

1. **顺序敏感算法 vs GPU 并行**：贪心依赖（前面的决定影响后面的判断）与 block 无序调度天然冲突。标准解法是两阶段：可并行的两两比较（O(N²)）交给全 GPU，不可并行的贪心消解压进单 block 顺序循环——缩小串行段、扩大并行段。
2. **跨线程读共享状态，状态必须先有定义**：`torch::empty` 的垃圾内存读是 bug 之母；但这只是必要条件，不是充分条件——竞态的根因是 happens-before 缺失，初始化治不了它。
3. **warp 语义工具要用对并行单元**：`__ballot_sync` 收的是"一个 warp 内 32 个 lane 对同一谓词的投票"，并行单元天然是 warp-per-data 而非 thread-per-data。
4. **bitmask 的位布局必须全局一致**：生产者（ballot 写）和消费者（位图读）对"bit k = 哪个框"的解读要对齐，j_base 对齐 32 边界 + 首组 lane 投 0 是最小改动方案。
5. **排序置换要映射回原索引**：kernel 在预处理后的数据上工作，返回前必须经 order 数组换回用户视角的索引；返回类型对齐参照实现（int64、同 device）。
6. **检测并行 bug 的最低成本手段**：同一输入重复跑 N 次。竞态不崩溃、概率性出错、大规模下被掩盖——重复运行是它唯一的破绽；修 bug 时用固定最小算例一次隔离一个变量，随机对拍放最后。
7. **先正确，再快**：修复后 8192 框 1.69 倍于 torchvision，但小规模仍落后——性能数字要和正确性（逐元素全等 30 组）一起报告，缺一不可。
