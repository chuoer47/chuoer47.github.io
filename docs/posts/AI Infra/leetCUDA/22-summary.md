---
title: 系列总结 (Interview Notes)
order: 22
---

# LeetCUDA 系列总结

> 本人学习笔记，AI总结

21 篇走完：从第一个 elementwise kernel 到 FlashAttention-2 和 Triton。本篇不引入新代码——把全程的知识地图、性能数字总账、以及"如果重来一遍会怎么学"整理成一篇，也作为后面继续（wgmma/TMA on Hopper、 CUTLASS 深入）的路标。

## 性能数字总账（全部 4090 实测）

| kernel | 最优成绩 | 基线/对照 | 篇 |
|---|---|---|---|
| elementwise (f16x8pack) | ~峰值带宽级 | torch 版持平 | 02 |
| softmax (online) | 单遍扫描 | 两遍版 | 04 |
| layer-norm 融合 | **10x** | 拆开三算子 | 06 |
| rope | 复数 naive 版 **135x** | | 08 |
| mat-transpose (smem+bcf) | 0.0039ms | naive 的数倍 | 09 |
| histogram | torch.histc 25x | 手写全局原子 | 12 |
| sgemv | **快 torch 2.7x** | torch.matmul | 16 |
| sgemm (WMMA TF32) | 60.0 TFLOPS | cuBLAS 74.3 的 81% | 15 |
| hgemm (手写 MMA) | 155.9 TFLOPS | 峰值 94% | 17 |
| hgemm (CuTe) | **296.6 TFLOPS** | 峰值 90%，手写版 +92% | 19 |
| flash-attn (share-qkv) | **189.4 TFLOPS** | **SDPA 133 的 1.42x** | 20 |
| triton vector-add | 944 GB/s | 峰值 94% | 21 |

## 知识地图：一张依赖图

```
                    [02 elementwise] 索引/向量化/coalesced
                          │
              [03 reduce] shuffle/两阶段/atomic ←────┐
                    │         │                     │
        [04 softmax] online  [05 dot]   [12 histogram]
              │
   [06/07 norm] [08 rope]           瓶颈类型学(计算/访存/同步)
              │
   [09 transpose] smem/bank/padding  ←── 对齐铁律
              │
   [10 transpose-CuTe] Layout 代数
              │
   ┌──────────┴──────────┐
[15 sgemm]  [16 sgemv]        tiling/dbuf/WMMA/访存受限
   │
[17 hgemm-mma] [18 swizzle] [19 hgemm-cute]   ldmatrix/mma.sync/Swizzle代数化
   │
[20 flash-attn]  online softmax × mma × 流水线 = 大合体
   │
[21 triton]      从抽象层回望全部手艺
```

## 手写 vs 抽象：本系列最重要的元结论

三个数据点支撑的结论：

- **10 篇（转置）**：CuTe 持平手写——小问题抽象无增益
- **19 篇（HGEMM）**：CuTe +92%——大问题抽象的杠杆爆炸（敢开 BN=256 是因为布局复杂度被类型接管）
- **21 篇（Triton）**：向量化/流水线全自动化，性能不付税——**规则型 kernel 的手艺已经可以外包，但"判断它是不是规则型"本身需要手艺**

所以学习路径的建议是：**先手写到 FA2，再用抽象层**——不是效率考量，是判断力考量。没修过 04 篇对齐 bug 的人用 Triton 时不会知道 `tl.load` 在替你挡什么，遇到 Triton 搞不定的 kernel（对角调度、顺序依赖）也不知道为什么。