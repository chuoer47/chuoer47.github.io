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

## 五条贯穿系列的铁律

1. **优化手段必须打在瓶颈上**（11/12 立法，18 再验证）：访存瓶颈→向量化/staging；计算瓶颈→换算法/降精度；同步瓶颈→摊薄原子。瓶颈判错，全盘白干
2. **对齐是行属性不是线程属性**（04/09）：128bit 访存要求基地址 16B 对齐，行基址 = 行号×行宽——形状不对齐时任何线程层面的努力都救不了，要么 padding 要么双路径
3. **先下载后动手**：服务器上的最新代码永远是事实源——本地草案覆盖服务器改动 = 事故（workflow 层面的铁律）
4. **机理必须实测**：cvectorized 为什么慢（09）、NMS 结果漂移（14）、swizzle 大形状负收益（18）——想当然的解释错得多，算一遍地址/跑一遍对照再落笔
5. **每层存储都在换一种"贵"**：寄存器贵在数量、smem 贵在容量和 bank、L2 贵在容量、gmem 贵在延迟——所有优化都是把数据放到"恰好够用的最便宜一层"（02 的寄存器→09 的 smem→15 的多级流水→20 的全链路驻留）

## 手写 vs 抽象：本系列最重要的元结论

三个数据点支撑的结论：

- **10 篇（转置）**：CuTe 持平手写——小问题抽象无增益
- **19 篇（HGEMM）**：CuTe +92%——大问题抽象的杠杆爆炸（敢开 BN=256 是因为布局复杂度被类型接管）
- **21 篇（Triton）**：向量化/流水线全自动化，性能不付税——**规则型 kernel 的手艺已经可以外包，但"判断它是不是规则型"本身需要手艺**

所以学习路径的建议是：**先手写到 FA2，再用抽象层**——不是效率考量，是判断力考量。没修过 04 篇对齐 bug 的人用 Triton 时不会知道 `tl.load` 在替你挡什么，遇到 Triton 搞不定的 kernel（对角调度、顺序依赖）也不知道为什么。

## 走过的坑（环境篇，给复现者）

conda 环境 + makefile 型项目的完整踩坑清单（17 篇详述）：nvcc 不在 nohup PATH / cublas 头在 pip 包 / 系统 gcc14 要 -ccbin / conda 无静态 cudart 要 `--cudart shared` / fmaxf 要 -lm——**最终形态是 nvcc wrapper 脚本**，比改 makefile 干净。加上：github 直连断流走 ghproxy 镜像、torch props 缺属性按 sm_89 硬编码、pycuda 装不上用 torch API 替代。LeetCUDA 上游还有两个 bug 素材（sgemm.cu 的 diff 残留、flash-attn 的空 makefile/占位文件）——都是潜在 PR。

## 没跑的部分（诚实清单）

- **wgmma / TMA / FA3**：sm_90a Hopper 专属，4090（sm_89）编不了——下一台机器的事
- **interview 的 notes-v2 综合对比**：build.sh 硬编码 /usr/local/cuda + 依赖 cudnn，没在 conda 环境重演；其内容（HGEMM/FA 对比）已被 17~20 篇的实测覆盖
- **triton layer-norm 前后向**：脚本用了旧版 triton API（装的 3.1.0），没跑通，未编造数据
- **cutlass DSL / ws-hgemm**：选学未启动

## 下一步路标

1. **softmax PR 收尾**：修好的非 8 对齐 kernel 提交（分支已就绪）
2. **rms-norm PR**：同类非对齐问题（已勘明）
3. **Hopper 时代**：wgmma（warp 级异步 MMA）、TMA（bulk 搬运）——20 篇结尾官方 FA 反超的悬念在那里解
4. **NCU 深度**：本系列性能解释都靠推理+对照实验，nsight compute 的 per-kernel metrics 是下一层验证工具（仓库 `kernels/nvidia-nsight/` 有现成教材）
5. **真实工程**：拿 SVDQuant 量化（另一条工作线）或 vLLM kernel 阅读检验全套功力

## 本篇小结

1. 21 篇 = 一条从"每线程标量故事"到"全链路布局工程"的完整学习曲线，性能数字总账见上表
2. 五条铁律（瓶颈/对齐/下载/实测/存储层级）——比任何单个 kernel 都值钱，是可迁移的
3. 手写→抽象的判断力序列：转置持平、GEMM +92%、Triton 免税——**先手写后抽象**不是情怀是判断力投资
4. 诚实清单：没跑的（Hopper/interview/triton-layernorm）明说不编造
5. 路标：PR 收尾 → rms-norm → Hopper → NCU → 真实工程
