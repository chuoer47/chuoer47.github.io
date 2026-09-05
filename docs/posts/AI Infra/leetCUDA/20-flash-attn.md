---
title: FlashAttention 2 (MMA)
order: 20
---

# FlashAttention-2 MMA 代码学习

> 本人学习笔记，AI总结

本系列的总决赛。前面 20 篇的所有积木在这里合体：**04 的 online softmax**（FA 的数学核心）、**17/18 的 mma.sync + ldmatrix + cp.async**（计算引擎）、**15 的多级流水**（数据通路）、**09/18 的 bank conflict 治理**（smem 布局）。FA2 = online softmax × 分块 × Tensor Core——三个都是学过的，组合出魔法。

实测（RTX 4090，B=1, H=8, N=8192, D=64，warmup 5 / iters 20）：

| 版本 | 耗时 | TFLOPS | 说明 |
|---|---|---|---|
| torch unfused（QK^T → softmax → ×V 三步走） | 6.98ms | 20.1 | 显存带宽被 S 矩阵拖垮 |
| mma split-kv + stage1 | 1.459ms | 96.0 | FA 的分块思想入门 |
| mma split-kv + stage2 | 1.240ms | 113.0 | +流水线 |
| mma split-q + share-kv + stage1 | 0.850ms | 164.9 | **换分块方向** |
| + swizzle-q + stage2 | 0.803ms | 174.4 | |
| **mma split-q + share-qkv + stage2** | **0.740ms** | **189.3** | 本仓最优 |
| PyTorch SDPA（官方 flash attention） | 1.053ms | 133.0 | **手写快官方 42%** |

（D=64 小形状正好是本仓 README 声称的优势区间；D 大了以后官方 FA 的 TMA/WGMMA 路线会反超。）

## 第 0 步：为什么 unfused 慢 9.4 倍——S 矩阵的原罪

标准 attention：`O = softmax(QK^T / √d) · V`。逐步执行时中间量 S = QK^T 是 **N×N 矩阵**——8192² = 64M 元素/头，8 头 = **1GB（f16）**。三步走意味着 S 写一遍读一遍、softmax 后的 P 又写一遍读一遍：**O(N²) 的显存流量**，而计算量才 O(N²·d)。d=64 时每 byte 数据只摊 64 次乘加的两头——被显存带宽活活拖死（20 TFLOPS vs 峰值 330）。

FA 的釜底抽薪：**S 和 P 根本不落显存，在 smem/寄存器里分块算完就扔**。代价是 softmax 不能"整行一起算"了——分子分母都要跨块累积——这就是 04 篇 online softmax 的用武之地。

## 第 1 步：online softmax 复习（04 篇的 MD 结构在 FA 里的形态）

04 篇讲过单遍扫描 softmax：维护 `(m, l)`（当前 max 和 exp 和），来一块新数据就"合并"。FA2 的行级版本（每行一个 `(m, l)`，每 lane 持有该行的 D 维输出）：

```
来一个 KV 块 (Bc 列):
  ① 算 S 块 = Q·K^T, 求块内行 max: m_new_blk
  ② m = max(m_old, m_new_blk)                  ← 全局 max 在线逼近
  ③ P 块 = exp(S·scale - m)                    ← 用新 m 归一（不会溢出）
  ④ l = exp(m_old - m)·l_old + row_sum(P)      ← 和也要 rescale!
  ⑤ O = exp(m_old - m)·O_old + P·V             ← O 同样 rescale
```

③④⑤ 就是 04 篇 `warp_reduce_md_op`（MD 蝴蝶归约）的矩阵版。源码注释里还有个彩蛋（`flash_attn_mma_split_q.cu:583`）：**FA2 论文的 rescale 公式写错了**——O 的 rescale 因子是 `exp(m_old - m_new)`，论文里误写成取倒数（`1/(m_old-m_new)`），照抄会算出错误结果。学习论文也要带验证意识。

## 第 2 步：分块的两个方向——split-kv 为什么输给 split-q

第一个 FA kernel（split-kv）：**4 个 warp 沿 K/V（Bc 方向）切**，每个 warp 算部分 S/P/V，最后 warp 间归并（又是一次 MD 合并，跨 warp 的）。

```
split-kv:  warp 各管一段 KV 列          split-q:  warp 各管一段 Q 行
|  64x64   | w0 | w1 | w2 | w3 |        |  64x64   |      KV (全部 warp 共享) |
|   Q      |    |    |    |    |        | Q 行 w0  | w0 独立算完一行  |
                     ↓ 归并             | Q 行 w1  | w1 ...            |
              跨 warp MD 归并 ✗          | ...     | 互不干扰 ✓        |
```

split-q 的洞察：**Q 行之间本来就没有数据依赖**（softmax 是行独立的！）——沿 Q 切，每 warp 一条完整的 `(m,l,O)` 线，**零跨 warp 通信**；K/V 大家共享同一份 smem（每 warp 都要读全部 KV，但 smem 是 block 共享的，免费）。实测 96→165 TFLOPS，**+72% 纯粹来自切分方向的改变**——这个对比是 FA2 论文的核心贡献之一，也是"并行性设计 > 微调"的最佳教学案例。

## 第 3 步：MMA 视角——S 和 O 都是 mma.sync

QK^T 和 PV 都是矩阵乘，都喂给 17 篇的 `HMMA16816`。关键差异在 **P 的驻留**：

```
常规 GEMM:  A,B 从 smem 来, C 累加到寄存器, 最终写 gmem
FA:        S=QK^T 累加在寄存器 R_S (不落 gmem!)
           → 寄存器里就地 softmax (exp/rescale)  ← 17 篇说裸 MMA 才能干的事!
           → P (还是那个 R_S 寄存器!) 直接作为 mma 的 A 操作数喂给 PV
           → O 累加在 R_D
```

**softmax 发生在 mma 的操作数寄存器上**——WMMA 的黑盒 fragment 做不到（拿不到数据布局），这就是 17 篇"卸黑盒"的兑现时刻。源码里 P 的寄存器布局注释（`flash_attn_mma_split_q.cu:540` 附近）值得精读：m16n8k16 的 C 布局（每 lane 持 2×2）恰好**按行对齐**——同 lane 的 2 个 C 元素属于同一行，行 max/row_sum 的 lane 内归约天然免 shuffle，这是 MMA atom 布局和 softmax 行归约的**幸运对齐**（CUTLASS 挑 m16n8k16 不是随便挑的）。

## 第 4 步：share-qkv——smem 预算的极限压榨

split-q + share-kv 之后，下一个瓶颈是 **Q 的重复读**：每 block 处理 Br=64 行 Q，Q 块要从 gmem 反复进 smem。share-qkv 的方案：**Q 常驻 smem**（64×64×2B=8KB），K/V 分块流过——再加 stage2 流水线（cp.async 双缓冲，15/17 篇套路），实测 174→189。

至此 smem 的分配账（256KB 减去预算约束，4090 上限 100KB/block）：

```
Q 常驻:      64 × 64 × 2B  = 8KB
K 块 stage2: 2 × 64 × 64 × 2B = 16KB
V 块 stage2: 2 × 64 × 64 × 2B = 16KB
                                ──────
                                40KB   ← 还有富余, D=128 时翻倍仍可行
```

swizzle-q/swizzle-qk（对应 18 篇的 smem swizzle）在 Q/QK 布局上继续消 bank conflict——+2~4%，量级和 18 篇的结论一致（计算密集时 swizzle 收益有限）。

## 第 5 步：189 vs SDPA 133——为什么官方反而慢

小形状上手写版快 42%，因为：
1. **SDPA 要通用**：任意 B/H/N/D、causal mask、任意 dtype——每个自由度都是分支和检查；手写版按 D=64 特化，K/V 布局、寄存器分配全按最优排
2. **调度适配**：SDPA 的 kernel 选择逻辑（哪个后端、哪个 tile）要运行时决策

大形状反超的路径也是明牌（官方 FA2 的 Hopper 版）：WGMMA（异步 warp 级 MMA）、TMA（bulk 数据搬运）——都是 sm_90 硬件，4090 没有也编不了（学习路线里 `wgmma_tn_90` 的预警）。**手写版的天花板由指令集决定，特化版的优势随问题规模衰减**。

## FA2 与 04 篇的闭环

04 篇 online softmax 埋的问题"这个搞懂了，第三阶段 FA 就顺了"，现在可以完整回答：

| 04 篇（softmax 算子） | FA2 |
|---|---|
| 一个 block 一行 token | 一个 block Br 行 Q |
| 两遍/单遍扫描 K 维 | 跨 KV 块在线合并 `(m,l)` |
| `warp_reduce_md_op` 蝴蝶归约 | 行级 (m,l) 在 lane 内 + exp 缩放 O |
| 输出即最终 softmax | 输出 O 还要除 l（最后一步） |

加上 17 篇的 mma.sync、15 篇的多级流水、18 篇的 swizzle——**FA2 没有任何一块新积木，全是旧积木的新组合**。这就是"从 elementwise 到 FlashAttention"全程走一遍的意义。

## 编译与运行实录

- JIT 模式：`python flash_attn_mma.py --B 1 --H 8 --N 8192 --D 64 --sdpa --torch`（makefile 是上游占位空文件，别走 make 路线）
- 官方 `flash_attn` 包未装（可选依赖）：对照用 `--sdpa` 就够
- 首次 JIT 编 6 个 .cu 约 5 分钟
- 仓库 makefile/setup.py/tools 一批文件是 0 字节空占位（上游仓库如此，git 对象里就是空 blob）——提 PR 修复的话这又是一个素材

## 完整代码

### `flash_attn_mma_split_q.cu`（split-q 主力 kernel）
<details>
<summary> flash_attn_mma_split_q.cu </summary>

```c++
#include "utils.h"

// Write FlashAttention-2 from scratch using Tensor Cores with MMA PTX
// instruction. The input is Q,K,V, 4D tensor with shape [batch_size, num_heads,
// seq_len, head_dim]. The output is O, a 4D tensor with shape [batch_size,
// num_heads, seq_len, head_dim].

// The FlashAttention-2 algorithm is described in the following paper:
// https://arxiv.org/pdf/2307.08691

// Q,K,V,O: [batch_size, num_heads, seq_len, head_dim], [B,H,N,d]
// each block processes Q_tile with shape [Br,d] and full K,V with shape [N,d]

// Split Q across MMA(Warps) and keep access KV for all MMA(Warps),
// in order to reduce the comm between warps via smem and warp shuffle.

// MMA = m16n8k16, Br=16x4=64, Bc=8x8=64, layout: 4 warps
// |   64x64   |      warp_KV 0       |
// | warp_QP 0 | MMA 0 ... MMA 0 (x8) |
// | warp_QP 1 | MMA 1 ... MMA 1 (x8) |
// | warp_QP 2 | MMA 2 ... MMA 2 (x8) |
// | warp_QP 3 | MMA 3 ... MMA 3 (x8) |

// MMA = m16n8k16, Br=16x8=128, Bc=8x16=128, layout: 8 warps
// |  128x128  |      warp_KV 0        |
// | warp_QP 0 | MMA 0 ... MMA 0 (x16) |
// | warp_QP 1 | MMA 1 ... MMA 1 (x16) |
// | warp_QP 2 | MMA 2 ... MMA 2 (x16) |
// | warp_QP 3 | MMA 3 ... MMA 3 (x16) |
// | warp_QP 4 | MMA 4 ... MMA 4 (x16) |
// | warp_QP 5 | MMA 5 ... MMA 5 (x16) |
// | warp_QP 6 | MMA 6 ... MMA 6 (x16) |
// | warp_QP 7 | MMA 7 ... MMA 7 (x16) |

template <
    const int kHeadDim,          // Headdim, 32,64,128
    const int kMmaAtomM,         // MMA Atom M, 16
    const int kMmaAtomN,         // MMA Atom N, 8
    const int kMmaAtomK,         // MMA Atom K, 16
    const int kMmaTileSeqLenQ,   // 4, more MMA(warp), M=16*4=64, Q@K^T=[Br(M),
                                 // d(K)]@[d(K),  Bc(N)]
    const int kMmaTileSeqLenK,   // 1, more MMA(warp), N=8*1 =8,  Q@K^T=[Br(M),
                                 // d(K)]@[d(K),  Bc(N)]
    const int kMmaTileSeqLenP,   // 4, more MMA(warp), M=16*4=64, P@V
                                 // =[Br(M),Bc(K)]@[Bc(K), d(N) ]
    const int kMmaTileHeadDimV,  // 1, more MMA(warp), N=8*1 =8,  P@V
                                 // =[Br(M),Bc(K)]@[Bc(K), d(N) ]
    const int kWarpTileSeqLenQ,  // 1, more values, M, Br=64*1=64, matmul M
    const int kWarpTileSeqLenK,  // 8, more values, N, Bc=8*8 =64, matmul N
    const int kWarpTileSeqLenP,  // 1, more values, M, Br=64*1=64, matmul M
    const int kWarpTileHeadDimV, // 8, more values, N,
                                 // d=8*(1|2|3|4|...)=8|...|32|64|96|128|...
    const int kStage, const int kPad>
__global__ void __launch_bounds__(WARP_SIZE *kMmaTileSeqLenQ *kMmaTileSeqLenK)
    flash_attn_mma_stages_split_q_kernel(half *Q, half *K, half *V, half *O,
                                         int QKV_seqlen, int QKV_head) {
  // Matmul Layout: Q[Br,d]@K^T[d,Bc] NT, P[Br,Bc]@V[Bc,d] NN.
  // NOTE: K[Bc,d] with row major means K^T[d,Bc] in col major.
  static_assert(kMmaAtomM == 16 && kMmaAtomN == 8 &&
                kMmaAtomK == 16);                                 // m16n8k16
  static_assert(kMmaTileSeqLenQ <= 8 && kMmaTileSeqLenK == 1);    // Q@K^T
  static_assert(kMmaTileSeqLenP <= 8 && kMmaTileHeadDimV == 1);   // P@V
  static_assert(kWarpTileSeqLenQ == 1 && kWarpTileSeqLenK <= 16); // Q@K^T
  // kWarpTileHeadDimV: d=8*(1|2|3|4|...) = 8|...|32|64|96|128|..., etc.
  // e.g, kWarpTileHeadDimV = 8 -> d = 8*8 = 64; 16 -> d = 8*16 = 128.
  static_assert(kWarpTileSeqLenP == 1 &&
                kWarpTileHeadDimV ==
                    (kHeadDim / (kMmaAtomN * kMmaTileHeadDimV))); // P@V
  static_assert(kStage > 0 && kStage < 3);                        // 1,2
  static_assert(kPad >= 0 && kPad % 8 == 0);                      // 0,8,16
  constexpr int Br =
      kMmaAtomM * kMmaTileSeqLenQ * kWarpTileSeqLenQ; // 16*4*1=64
  constexpr int Bc =
      kMmaAtomN * kMmaTileSeqLenK * kWarpTileSeqLenK; //  8*1*8=64
  constexpr int kNumThreads =
      WARP_SIZE * kMmaTileSeqLenQ * kMmaTileSeqLenK; // 32*4*1=128, num threads
  // Now, N must be mutliples of Bc(32/64) for KV tiling across seqlen.
  const int Tc = div_ceil(QKV_seqlen, Bc); // Tc K_tile[d,Bc]
  const float scale = 1.0f / sqrt((float)kHeadDim);

  // grid(div_ceil(QKV_seqlen, Br), QKV_batch * QKV_head), (x,y,z)
  const int QKV_batch_id = blockIdx.y / QKV_head; // Batch size
  const int QKV_head_id = blockIdx.y % QKV_head;  // Head num
  const int Q_tile_id = blockIdx.x;               // Q tile_id, range [0, Tr]
  const int O_tile_id = Q_tile_id;                // O tile_id, same as Q.
  const int tid = threadIdx.x;                    // within block
  const int warp_id = tid / WARP_SIZE;            // 0~7 warp_id within block
  const int lane_id = tid % WARP_SIZE;            // 0~31
  const int warp_QP = warp_id;                    // 0,1,2,3 or 0~7
  const int warp_KV = 0;                          // 0
  // MMA Layout [Br,Bc]=[64,64], MMA = m16n8k16, Br=16x4=64, Bc=8x8=64, layout:
  // 4 warps |   64x64   |      warp_KV 0       | | warp_QP 0 | MMA 0 ... MMA 0
  // (x8) | | warp_QP 1 | MMA 1 ... MMA 1 (x8) | | warp_QP 2 | MMA 2 ... MMA 2
  // (x8) | | warp_QP 3 | MMA 3 ... MMA 3 (x8) | MMA Layout [Br,Bc]=[128,128],
  // MMA = m16n8k16, Br=16x8=128, Bc=8x16=128, layout: 8 warps |  128x128  |
  // warp_KV 0        | | warp_QP 0 | MMA 0 ... MMA 0 (x16) | | warp_QP 1 | MMA
  // 1 ... MMA 1 (x16) | | warp_QP 2 | MMA 2 ... MMA 2 (x16) | | warp_QP 3 | MMA
  // 3 ... MMA 3 (x16) | | warp_QP 4 | MMA 4 ... MMA 4 (x16) | | warp_QP 5 | MMA
  // 5 ... MMA 5 (x16) | | warp_QP 6 | MMA 6 ... MMA 6 (x16) | | warp_QP 7 | MMA
  // 7 ... MMA 7 (x16) |
  const int Q_gmem_offset =
      ((QKV_batch_id * QKV_head * QKV_seqlen * kHeadDim) +
       (QKV_head_id * QKV_seqlen * kHeadDim)); // Q [seqlen,d]
  const int K_gmem_offset =
      ((QKV_batch_id * QKV_head * QKV_seqlen * kHeadDim) +
       (QKV_head_id * QKV_seqlen * kHeadDim)); // K [seqlen,d]
  const int V_gmem_offset = Q_gmem_offset;     // V [seqlen,d]
  const int O_gmem_offset = Q_gmem_offset;     // O [seqlen,d]

  // Mapping Q gmem -> tid -> smem, Q[Br,d]=[64,64 or 128], 128 threads.
  int load_smem_Q_Br = (tid / (kNumThreads / Br)); // Br 64, tid / 2, row 0~64
  int load_smem_Q_d =
      (tid % (kNumThreads / Br)) *
      (kHeadDim / (kNumThreads / Br)); // (tid % 2) * 32, 0,32,...
  // Mapping K gmem -> tid -> smem, K[Bc,d]=[64 or 128,64], 128 threads.
  int load_smem_K_Bc = (tid / (kNumThreads / Bc)); // Bc 64, tid / 2, row 0~64
  int load_smem_K_d =
      (tid % (kNumThreads / Bc)) *
      (kHeadDim / (kNumThreads / Bc)); // (tid % 2) * 32, 0,32,...
  // Mapping V gmem -> tid -> smem, V[Bc,d]=[64,64 or 128], 128 threads.
  int load_smem_V_Bc = (tid / (kNumThreads / Bc)); // Bc 64, tid / 2, row 0~64
  int load_smem_V_d =
      (tid % (kNumThreads / Bc)) *
      (kHeadDim / (kNumThreads / Bc)); // (tid % 2) * 32, 0,32,...
  // global Q row of current head for tile [Br,d] per block.
  int load_gmem_Q_Br = Q_tile_id * Br + load_smem_Q_Br;
  if (load_gmem_Q_Br >= QKV_seqlen)
    return;
  // KV tile gmem load index starts from 0 and increments with
  // each iteration as we loop over seqlen.
  int load_gmem_K_Bc_offset = 0;
  int load_gmem_V_Bc_offset = 0;

  // Shared memory for Q,K,V, we don not need additional smem for O
  // collective store which perform via registers reuse and warp shuffle.
  extern __shared__ half smem[];
  constexpr int Q_tile_size =
      Br * (kHeadDim + kPad); // 64*64=4096, ~8192 bytes=8M
  constexpr int KV_tile_size =
      Bc * (kHeadDim + kPad); // 64*64=4096, ~8192 bytes=8M
  // K multi-stages: currently, only apply multi stages for K across seq_len.
  half *Q_tile_smem = smem;                      // 8M/16M
  half *K_tile_smem = Q_tile_smem + Q_tile_size; // 8M/16M
  half *V_tile_smem = K_tile_smem + kStage * KV_tile_size;
  // TODO: KV may shared same smem to reduce smem usage for kStage 1
  // stage 2, no shared KV smem, Br=Bc=64,  d=64: 8M+(8M)*2+8M    =32M
  // stage 2, no shared KV smem, Br=Bc=64, d=128: 16M+(16M)*2+16M =64M
  // stage 2, no shared KV smem, Br=Bc=64, d=256: 32M+(32M)*2+32M =128M
  // stage 1, no shared KV smem, Br=Bc=64,  d=64: 8M+(8M)+8M      =24M
  // stage 1, no shared KV smem, Br=Bc=64, d=128: 16M+(16M)*1+16M =48M
  // stage 1, no shared KV smem, Br=Bc=32, d=256: 16M+(16M)*1+16M =48M

  uint32_t smem_Q_base_ptr = __cvta_generic_to_shared(Q_tile_smem);
  uint32_t smem_K_base_ptr = __cvta_generic_to_shared(K_tile_smem);
  uint32_t smem_V_base_ptr = __cvta_generic_to_shared(V_tile_smem);

  // Registers/SMEM for thread block
  // block m_old, l_old, store in lane, use float to
  // keep precision.
  float lane_block_row_max_old[kWarpTileSeqLenQ][2]; // [1][2]
  float lane_block_row_sum_old[kWarpTileSeqLenQ][2]; // [1][2]
  fill_2D_regs<float, kWarpTileSeqLenQ, 2>(lane_block_row_max_old, -INFINITY);
  fill_2D_regs<float, kWarpTileSeqLenQ, 2>(lane_block_row_sum_old, 0.0f);

  // Registers for S=Q@K^T/O=P@V
  // registers for QKV, S=Q[Br,d]@K[Bc,d]=[Br,Bc]
  // and O=P[Br,Bc]@V[Bc,d]=[Br,d].
  uint32_t R_Q[kWarpTileSeqLenQ][4];  // [1][4]
  uint32_t R_K[kWarpTileSeqLenK][2];  // [8][2]
  uint32_t R_V[kWarpTileHeadDimV][2]; // [8][2]
  // registers for current tile_K_seqlen within, [64,64] = S_tile[Br,Bc]
  // = Q_tile[Br,d] * K[Bc,d], each thread hold 2x32 bits regs.
  uint32_t R_S[kWarpTileSeqLenQ][kWarpTileSeqLenK][2]; // [1][8][2]
  // registers for tile_K_seqlen O=PV[Br,d]=P@V, [2][2/4][2], 8 or 16 regs.
  // TODO: may reuse R_D as R_O? kWarpTileSeqLenP=kWarpTileSeqLenQ.
  uint32_t R_O[kWarpTileSeqLenP][kWarpTileHeadDimV][2]; // [1][8][2]
  // registers final Output [D]=final rescale(R_O), [2][2/4][2], 8 or 16 regs.
  uint32_t R_D[kWarpTileSeqLenP][kWarpTileHeadDimV][2]; // [1][8][2]
  fill_3D_regs<uint32_t, kWarpTileSeqLenQ, kWarpTileSeqLenK, 2>(R_S, 0);
  fill_3D_regs<uint32_t, kWarpTileSeqLenP, kWarpTileHeadDimV, 2>(R_D, 0);
  fill_3D_regs<uint32_t, kWarpTileSeqLenP, kWarpTileHeadDimV, 2>(R_O, 0);

  // load Q from gmem -> smem, only load once.
  {
    int load_gmem_Q_d = load_smem_Q_d;
    int load_gmem_Q_addr =
        (Q_gmem_offset + load_gmem_Q_Br * kHeadDim + load_gmem_Q_d);
    uint32_t load_smem_Q_ptr =
        (smem_Q_base_ptr +
         (load_smem_Q_Br * (kHeadDim + kPad) + load_smem_Q_d) * sizeof(half));
#pragma unroll
    for (int i = 0; i < (kHeadDim / (kNumThreads / Br)); i += 8) {
      CP_ASYNC_CG(load_smem_Q_ptr + i * 2, &Q[load_gmem_Q_addr + i], 16);
    }
    CP_ASYNC_COMMIT_GROUP();
  }

  // load K from gmem -> smem, (kStage - 1) K^T tiles, [d,Bc]
  if constexpr (kStage > 1) {
#pragma unroll
    for (int stage = 0; stage < (kStage - 1); ++stage) {
      // update the offset of n according to stages
      load_gmem_K_Bc_offset = stage * Bc; // e.g (0~3)*64=(0,64,128,192,...)
      int load_gmem_K_Bc = load_gmem_K_Bc_offset + load_smem_K_Bc; // < seqlen
      int load_gmem_K_d = load_smem_K_d; // K [Bc,d] from [seqlen,d]
      int load_gmem_K_addr =
          (K_gmem_offset + load_gmem_K_Bc * kHeadDim + load_gmem_K_d);
      uint32_t load_smem_K_ptr =
          (smem_K_base_ptr +
           (stage * KV_tile_size + load_smem_K_Bc * (kHeadDim + kPad) +
            load_smem_K_d) *
               sizeof(half));
#pragma unroll
      for (int i = 0; i < (kHeadDim / (kNumThreads / Bc)); i += 8) {
        CP_ASYNC_CG(load_smem_K_ptr + i * 2, &K[load_gmem_K_addr + i], 16);
      }
      CP_ASYNC_COMMIT_GROUP();
    }
  }

  // wait Q and at least (kStage - 1) for K ready.
  if constexpr (kStage > 1) {
    CP_ASYNC_WAIT_GROUP(kStage - 2); // s2->0, s3->1, s4->2
    __syncthreads();
  }

// <loop over K seqlen>: for K^T[d,seqlen] with K^T_tile[d,Bc]
// tile_K_seqlen: compute S_tile[Br,Bc] = Q@K^T = Q_tile[Br,d] * K^T[d,Bc]
#pragma unroll 1
  for (int tile_K_seqlen = 0; tile_K_seqlen < Tc; ++tile_K_seqlen) {
    // TODO: process last tile_K_seqlen ? pad to multiple of 8.
    // s2 tn 0->0, 1->1, 2->0; s3 tn 0->0, 1->1, 2->2, 3->0;
    int smem_sel = (tile_K_seqlen) % kStage;
    // s2 tn 0->1, 1->0, 2->1; s3 tn 0->2, 1->0, 2->1, 3->2;
    int smem_sel_next = (tile_K_seqlen + (kStage - 1)) % kStage;

    // multi stages pipeling gmem -> smem
    // NOTE: kStage must be > 1 for pipeling. For s1, smem_sel
    // and smem_sel_next will always equal 0, thus, we can not
    // prefetch KV from gmem to smem before tile_K_seqlen MMA done.

    if constexpr (kStage > 1) {
      // First, prefetch curr V tile_K_seqlen [Bc,d] (no stages)
      {
        load_gmem_V_Bc_offset =
            tile_K_seqlen * Bc; // e.g (0~3)*64=(0,64,128,192,...)
        int load_gmem_V_Bc = load_gmem_V_Bc_offset + load_smem_V_Bc;
        int load_gmem_V_d = load_smem_V_d;
        int load_gmem_V_addr =
            (V_gmem_offset + load_gmem_V_Bc * kHeadDim + load_gmem_V_d);
        uint32_t load_smem_V_ptr =
            (smem_V_base_ptr +
             (load_smem_V_Bc * (kHeadDim + kPad) + load_smem_V_d) *
                 sizeof(half));
#pragma unroll
        for (int i = 0; i < (kHeadDim / (kNumThreads / Bc)); i += 8) {
          CP_ASYNC_CG(load_smem_V_ptr + i * 2, &V[load_gmem_V_addr + i], 16);
        }
        CP_ASYNC_COMMIT_GROUP();
      }

      // Then, prefetch next stage K (tile_K_seqlen + 1) [d,Bc]
      if ((tile_K_seqlen + 1) < Tc) {
        load_gmem_K_Bc_offset =
            (tile_K_seqlen + 1) * Bc; // e.g (0~3)*64=(0,64,128,192,...)
        int load_gmem_K_Bc = load_gmem_K_Bc_offset + load_smem_K_Bc; // < seqlen
        int load_gmem_K_d = load_smem_K_d; // K [Bc,d] from [seqlen,d]
        int load_gmem_K_addr =
            (K_gmem_offset + load_gmem_K_Bc * kHeadDim + load_gmem_K_d);
        uint32_t load_smem_K_ptr =
            (smem_K_base_ptr +
             (smem_sel_next * KV_tile_size +
              load_smem_K_Bc * (kHeadDim + kPad) + load_smem_K_d) *
                 sizeof(half));
#pragma unroll
        for (int i = 0; i < (kHeadDim / (kNumThreads / Bc)); i += 8) {
          CP_ASYNC_CG(load_smem_K_ptr + i * 2, &K[load_gmem_K_addr + i], 16);
        }
        CP_ASYNC_COMMIT_GROUP();
      }
    } else {
      // If no stages, kStage = 1, we have to load current K tile
      // from gmem to smem and have to wait it ready for Q@K^T MMA.

      // First, prefetch curr K tile_K_seqlen [d,Bc] (no stages)
      {
        load_gmem_K_Bc_offset =
            tile_K_seqlen * Bc; // e.g (0~3)*64=(0,64,128,192,...)
        int load_gmem_K_Bc = load_gmem_K_Bc_offset + load_smem_K_Bc; // < seqlen
        int load_gmem_K_d = load_smem_K_d; // K [Bc,d] from [seqlen,d]
        int load_gmem_K_addr =
            (K_gmem_offset + load_gmem_K_Bc * kHeadDim + load_gmem_K_d);
        uint32_t load_smem_K_ptr =
            (smem_K_base_ptr +
             (smem_sel * KV_tile_size + load_smem_K_Bc * (kHeadDim + kPad) +
              load_smem_K_d) *
                 sizeof(half));
#pragma unroll
        for (int i = 0; i < (kHeadDim / (kNumThreads / Bc)); i += 8) {
          CP_ASYNC_CG(load_smem_K_ptr + i * 2, &K[load_gmem_K_addr + i], 16);
        }

        CP_ASYNC_COMMIT_GROUP();
      }

      // Then, prefetch curr V tile_K_seqlen [d,Bc] (no stages)
      {
        load_gmem_V_Bc_offset =
            tile_K_seqlen * Bc; // e.g (0~3)*64=(0,64,128,192,...)
        int load_gmem_V_Bc = load_gmem_V_Bc_offset + load_smem_V_Bc;
        int load_gmem_V_d = load_smem_V_d;
        int load_gmem_V_addr =
            (V_gmem_offset + load_gmem_V_Bc * kHeadDim + load_gmem_V_d);
        uint32_t load_smem_V_ptr =
            (smem_V_base_ptr +
             (load_smem_V_Bc * (kHeadDim + kPad) + load_smem_V_d) *
                 sizeof(half));
#pragma unroll
        for (int i = 0; i < (kHeadDim / (kNumThreads / Bc)); i += 8) {
          CP_ASYNC_CG(load_smem_V_ptr + i * 2, &V[load_gmem_V_addr + i], 16);
        }
        CP_ASYNC_COMMIT_GROUP();
      }

      // Wait curr Q and K tile ready and let curr V tile copy async.
      CP_ASYNC_WAIT_GROUP(1);
      __syncthreads();
    }

    // <loop over K d>: tile_K_d, kMmaAtomK = 16, K_tile_d[kMmaAtomK,Bc]
    // Matmul with NT layout, Q row major, K^T col major.
    // NOTE: K[Bc,d] with row major means K^T[d,Bc] in col major.
    // S_tile[Br,Bc]=Q_tile[Br,d]@K[Bc,d]
    fill_3D_regs<uint32_t, kWarpTileSeqLenQ, kWarpTileSeqLenK, 2>(R_S, 0);
#pragma unroll
    for (int tile_K_d = 0; tile_K_d < (kHeadDim / kMmaAtomK); ++tile_K_d) {
// smem -> reg, load m16k16 smem Q, offset d according tile_K_d.
// ldmatrix.x4 for Q_tile_smem.
#pragma unroll
      for (int i = 0; i < kWarpTileSeqLenQ; ++i) { // Q[Br,d]=[M,K]
        int warp_smem_Q_Br =
            warp_QP * (kMmaAtomM * kWarpTileSeqLenQ) + i * kMmaAtomM;
        int lane_smem_Q_Br = warp_smem_Q_Br + lane_id % 16;            // 0~15
        int lane_smem_Q_d = tile_K_d * kMmaAtomK + (lane_id / 16) * 8; // 0,8
        uint32_t lane_smem_Q_ptr =
            (smem_Q_base_ptr +
             (lane_smem_Q_Br * (kHeadDim + kPad) + lane_smem_Q_d) *
                 sizeof(half));
        LDMATRIX_X4(R_Q[i][0], R_Q[i][1], R_Q[i][2], R_Q[i][3],
                    lane_smem_Q_ptr); // now, R_Q
      }

// smem -> reg, load k16n8 from smem K, offset d according tile_K_d.
// ldmatrix.x2 for K_tile_smem, [Bc,kMmaAtomK] from [Bc,d]=[K,N]
#pragma unroll
      for (int j = 0; j < kWarpTileSeqLenK; ++j) {
        // load k16n8 via ldmatrix.x2 from K_tile_smem[Bc,d].
        // K[Bc,d] with row major means K^T[d,Bc] in col major.
        int warp_smem_K_Bc =
            warp_KV * (kMmaAtomN * kWarpTileSeqLenK) + j * kMmaAtomN;
        int lane_smem_K_Bc = warp_smem_K_Bc + lane_id % 8; // 0~7
        int lane_smem_K_d =
            tile_K_d * kMmaAtomK + ((lane_id / 8) % 2) * 8; // 0,8
        uint32_t lane_smem_K_ptr =
            (smem_K_base_ptr +
             (smem_sel * KV_tile_size + lane_smem_K_Bc * (kHeadDim + kPad) +
              lane_smem_K_d) *
                 sizeof(half));
        LDMATRIX_X2(R_K[j][0], R_K[j][1], lane_smem_K_ptr); // R_K
      } // end for kWarpTileSeqLenK

// MMA compute
#pragma unroll
      for (int i = 0; i < kWarpTileSeqLenQ; ++i) {
#pragma unroll
        for (int j = 0; j < kWarpTileSeqLenK; ++j) {
          HMMA16816(R_S[i][j][0], R_S[i][j][1], R_Q[i][0], R_Q[i][1], R_Q[i][2],
                    R_Q[i][3], R_K[j][0], R_K[j][1], R_S[i][j][0],
                    R_S[i][j][1]);
        }
      }
    } // end loop over d, S=Q@K^T
    __syncthreads();

    // MMA = m16n8k16, Br=16x4=64, Bc=8x8=64, layout: 4 warps
    // |   64x64   |      warp_KV 0       |
    // | warp_QP 0 | MMA 0 ... MMA 0 (x8) |
    // | warp_QP 1 | MMA 1 ... MMA 1 (x8) |
    // | warp_QP 2 | MMA 2 ... MMA 2 (x8) |
    // | warp_QP 3 | MMA 3 ... MMA 3 (x8) |

    // Online safe softmax, warp/block reduce max/sum, row wise
    float lane_row_max_new[kWarpTileSeqLenQ][2]; // [1][2]
    float lane_row_sum_new[kWarpTileSeqLenQ][2]; // [1][2]
    fill_2D_regs<float, kWarpTileSeqLenQ, 2>(lane_row_max_new, -INFINITY);
    fill_2D_regs<float, kWarpTileSeqLenQ, 2>(lane_row_sum_new, 0.0f);

// Row max for [Br,Bc] tile, Thread -> Warp -> Block.
#pragma unroll
    for (int i = 0; i < kWarpTileSeqLenQ; ++i) {
// Thread level reduce max across kWarpTileSeqLenK dim, namely Bc.
#pragma unroll
      for (int j = 0; j < kWarpTileSeqLenK; ++j) {
        // reference:
        // https://docs.nvidia.com/cuda/parallel-thread-execution/index.html
        // #matrix-fragments-for-mma-m16n8k16-with-floating-point-type
        // The layout of the fragments held by different threads for C.
        // (m16n8k16) Row\Col  0    1    2    3    4    5    6    7 0        T0:
        // {c0, c1}  T1: {c0, c1}  T2: {c0, c1}  T3: {c0, c1} 1        T4: {c0,
        // c1}  T5: {c0, c1}  T6: {c0, c1}  T7: {c0, c1} 2        ...
        // ...
        // 7        T28: {c0, c1}  T29: {c0, c1}  T30: {c0, c1}  T31: {c0, c1}
        // 8        T0: {c2, c3}   T1: {c2, c3}   T2: {c2, c3}   T3: {c2, c3}
        // 9        T4: {c2, c3}   T5: {c2, c3}   T6: {c2, c3}   T7: {c2, c3}
        // 10       ...
        // ...
        // 15       T28: {c2, c3}  T29: {c2, c3}  T30: {c2, c3}  T31: {c2, c3}
        float2 t_reg_S_0 = __half22float2(HALF2(R_S[i][j][0])); // 0~7  {c0, c1}
        float2 t_reg_S_1 = __half22float2(HALF2(R_S[i][j][1])); // 8~15 {c2, c3}
        // This should be the row max after S = (Q @ K^T) / sqrt(d)
        float tmp_max_0 = max(t_reg_S_0.x, t_reg_S_0.y) * scale;
        float tmp_max_1 = max(t_reg_S_1.x, t_reg_S_1.y) * scale;
        lane_row_max_new[i][0] = max(lane_row_max_new[i][0], tmp_max_0);
        lane_row_max_new[i][1] = max(lane_row_max_new[i][1], tmp_max_1);
      } // end for kWarpTileSeqLenK

      // Warp level reduce max, warp_size = 4
      // Each thread contains the maximum of 2 rows of Br,
      // and only the values of T0, T4, ..., T28 are used.
      // Br, row_id = warp_QP<0~3> * 32 + i<0> * 16 + 0 * 8 + (lane / 4) <0~7>
      lane_row_max_new[i][0] =
          warp_reduce_max<float, 4>(lane_row_max_new[i][0]);
      // Br, row_id = warp_QP<0~3> * 32 + i<0> * 16 + 1 * 8 + (lane / 4) <8~15>
      lane_row_max_new[i][1] =
          warp_reduce_max<float, 4>(lane_row_max_new[i][1]);
    } // end for kWarpTileSeqLenQ
    __syncthreads();

// Exp sum and mul scale_factor for [Br,Bc] tile, Thread -> Warp -> Block.
#pragma unroll
    for (int i = 0; i < kWarpTileSeqLenQ; ++i) {
      // Use latest global row max without update.
      // Br 0, row_id, 0~7,  16~23, 32~39, 48~55;
      float block_row_max_new_0 = lane_row_max_new[i][0];
      // Br 1, row_id, 8~15, 24~31, 40~47, 56~63;
      float block_row_max_new_1 = lane_row_max_new[i][1];

      float block_row_max_old_0 = lane_block_row_max_old[i][0];
      float block_row_max_old_1 = lane_block_row_max_old[i][1];
      // Apply m_new = max(m_old, m_new) here.
      block_row_max_new_0 = max(block_row_max_old_0, block_row_max_new_0);
      block_row_max_new_1 = max(block_row_max_old_1, block_row_max_new_1);

#pragma unroll
      for (int j = 0; j < kWarpTileSeqLenK; ++j) {
        float2 t_reg_S_0 = __half22float2(HALF2(R_S[i][j][0])); // 0~7  {c0, c1}
        float2 t_reg_S_1 = __half22float2(HALF2(R_S[i][j][1])); // 8~15 {c2, c3}
        // P = Exp(S - m_new), fmaf(x, y, z) = x * y + z;
        t_reg_S_0.x =
            __expf(__fmaf_rn(t_reg_S_0.x, scale, -block_row_max_new_0));
        t_reg_S_0.y =
            __expf(__fmaf_rn(t_reg_S_0.y, scale, -block_row_max_new_0));
        t_reg_S_1.x =
            __expf(__fmaf_rn(t_reg_S_1.x, scale, -block_row_max_new_1));
        t_reg_S_1.y =
            __expf(__fmaf_rn(t_reg_S_1.y, scale, -block_row_max_new_1));
        lane_row_sum_new[i][0] += (t_reg_S_0.x + t_reg_S_0.y);
        lane_row_sum_new[i][1] += (t_reg_S_1.x + t_reg_S_1.y);
        // Update R_S for P[Br,Bc] = Exp(S-m), point wise.
        HALF2(R_S[i][j][0]) = __float22half2_rn(t_reg_S_0);
        HALF2(R_S[i][j][1]) = __float22half2_rn(t_reg_S_1);
      } // end for kWarpTileSeqLenK

      // Warp level reduce sum, warp_size = 4
      lane_row_sum_new[i][0] =
          warp_reduce_sum<float, 4>(lane_row_sum_new[i][0]);
      lane_row_sum_new[i][1] =
          warp_reduce_sum<float, 4>(lane_row_sum_new[i][1]);
    } // end for kWarpTileSeqLenQ
    __syncthreads();

    // Compute P[Br,Bc] @ V[Bc,d] = [Br,d] = [64, 64/128], partion Attention.
    // Here, we have to wait V ready before compute O = P @ V
    if constexpr (kStage > 1) {
      // NOTE: For kStage > 1, we have send V mem issues before K
      if ((tile_K_seqlen + 1) < Tc) {
        CP_ASYNC_WAIT_GROUP(1);
      } else {
        CP_ASYNC_WAIT_GROUP(0);
      }
    } else {
      CP_ASYNC_WAIT_GROUP(0);
    }
    __syncthreads();

    // <loop over V Bc>: P[Br,Bc]@V[Bc,d]=[Br,d]=[64,64/128], partion Attention.
    // Matmul with NN layout: P[Br,Bc] row major, V[Bc,d] row major.
    // Make sure to clear the states in R_O before MMA for P@V for each step.

    // NOTE: Values for P[Br,Bc] already in R_S registers, can we use these
    // registers for P(A) matrix directly ? How to do that ?
    // according to the A matrix layout for MMA m16n8k16 instruction.
    // reference:
    // https://docs.nvidia.com/cuda/parallel-thread-execution/index.html
    // #matrix-fragments-for-mma-m16n8k16-with-floating-point-type
    // The layout of the fragments held by different threads for A matrix with
    // .f16. R\C  0    1    2    3    4    5    6    7    8    9   10   11   12
    // 13   14   15 0    T0: {a0, a1}  T1: {a0, a1}  T2: {a0, a1}  T3: {a0, a1}
    // T0: {a4, a5}  T1: {a4, a5}  T2: {a4, a5}  T3: {a4, a5} 1    T4: {a0, a1}
    // T5: {a0, a1}  T6: {a0, a1}  T7: {a0, a1}  T4: {a4, a5}  T5: {a4, a5}  T6:
    // {a4, a5}  T7: {a4, a5} 2    (dashed arrow pointing right)
    // ...
    // 7    T28: {a0, a1}  T29: {a0, a1}  T30: {a0, a1}  T31: {a0, a1}  T28:
    // {a4, a5}  T29: {a4, a5}  T30: {a4, a5}  T31: {a4, a5} 8    T0: {a2, a3}
    // T1: {a2, a3}   T2: {a2, a3}   T3: {a2, a3}   T0: {a6, a7}   T1: {a6, a7}
    // T2: {a6, a7}   T3: {a6, a7} 9    T4: {a2, a3}   T5: {a2, a3}   T6: {a2,
    // a3}   T7: {a2, a3}   T4: {a6, a7}   T5: {a6, a7}   T6: {a6, a7}   T7:
    // {a6, a7} 10   (dashed arrow pointing right)
    // ...
    // 15   T28: {a2, a3}  T29: {a2, a3}  T30: {a2, a3}  T31: {a2, a3}  T28:
    // {a6, a7}  T29: {a6, a7}  T30: {a6, a7}  T31: {a6, a7}

    fill_3D_regs<uint32_t, kWarpTileSeqLenP, kWarpTileHeadDimV, 2>(R_O, 0);
#pragma unroll
    for (int tile_V_Bc = 0; tile_V_Bc < (Bc / kMmaAtomK); ++tile_V_Bc) {
// Load k16n8 V from smem -> regs, R_KV, ldmatrix.x2.trans.
#pragma unroll
      for (int j = 0; j < kWarpTileHeadDimV; ++j) {
        int warp_smem_V_d = warp_KV * (kMmaAtomN * kWarpTileHeadDimV) +
                            j * kMmaAtomN; // d, matmaul N
        int lane_smem_V_Bc =
            tile_V_Bc * kMmaAtomK + lane_id % 16; // 0~15; Bc, matmul K
        int lane_smem_V_d = warp_smem_V_d;        // 0
        uint32_t lane_smem_V_ptr =
            (smem_V_base_ptr +
             (lane_smem_V_Bc * (kHeadDim + kPad) + lane_smem_V_d) *
                 sizeof(half));
        LDMATRIX_X2_T(R_V[j][0], R_V[j][1], lane_smem_V_ptr); // R_V
      }

      // For R_S[1][8][2], mapping the layout below of P matrix.
      // MMA = m16n8k16, Br=16x4=64, Bc=8x8=64, layout: 4 warps
      // |   64x64   |      warp_KV 0       |
      // | warp_QP 0 | MMA 0 ... MMA 0 (x8) |
      // | warp_QP 1 | MMA 1 ... MMA 1 (x8) |
      // | warp_QP 2 | MMA 2 ... MMA 2 (x8) |
      // | warp_QP 3 | MMA 3 ... MMA 3 (x8) |
      // tile_V_Bc = 0, all curr MMAs(0~4) need slice P[:,  0:16], 0, 1; stored
      // in all MMAs. tile_V_Bc = 1, all curr MMAs(0~4) need slice P[:, 16:32],
      // 2, 3; stored in all MMAs. tile_V_Bc = 2, all curr MMAs(0~4) need slice
      // P[:, 32:48], 4, 5; stored in all MMAs. tile_V_Bc = 3, all curr
      // MMAs(0~4) need slice P[:, 48:64], 6, 7; stored in all MMAs.
      int w = tile_V_Bc * 2; // MMA(Warp) selected, 0, 2, 4, 6
#pragma unroll
      for (int i = 0; i < kWarpTileSeqLenP; ++i) { // 1
#pragma unroll
        for (int j = 0; j < kWarpTileHeadDimV; ++j) { // 8, 16, 32, ...
          HMMA16816(R_O[i][j][0], R_O[i][j][1], R_S[i][w][0], R_S[i][w][1],
                    R_S[i][w + 1][0], R_S[i][w + 1][1], R_V[j][0], R_V[j][1],
                    R_O[i][j][0], R_O[i][j][1]);
        }
      }
    } // end for V Bc.
    __syncthreads();

// Rescale O -> Update row sum Exp -> then, Update row max.
#pragma unroll
    for (int i = 0; i < kWarpTileSeqLenP;
         ++i) { // kWarpTileSeqLenQ=kWarpTileSeqLenP=1
      // m = max(m_old, m_new), l = exp(m_old - m) * l_old + l_new (FA2 paper)
      // Br 0, row_id, 0~7,  16~23, 32~39, 48~55; Br 1, row_id, 8~15, 24~31,
      // 40~47, 56~63
      float block_row_max_new_0 = lane_row_max_new[i][0];
      float block_row_max_new_1 = lane_row_max_new[i][1];
      float block_row_sum_new_0 = lane_row_sum_new[i][0];
      float block_row_sum_new_1 = lane_row_sum_new[i][1];

      float block_row_max_old_0 = lane_block_row_max_old[i][0];
      float block_row_max_old_1 = lane_block_row_max_old[i][1];
      // NOTE: max(-inf, val) = val.
      block_row_max_new_0 = max(block_row_max_old_0, block_row_max_new_0);
      block_row_max_new_1 = max(block_row_max_old_1, block_row_max_new_1);
      // Avoid inf value while using m_old for rescaling O.
      block_row_max_old_0 =
          (tile_K_seqlen > 0 ? block_row_max_old_0 : block_row_max_new_0);
      block_row_max_old_1 =
          (tile_K_seqlen > 0 ? block_row_max_old_1 : block_row_max_new_1);

      // rescale factor for O and l, exp(m_old - m)
      float rescale_o_factor_0 =
          __expf(block_row_max_old_0 - block_row_max_new_0);
      float rescale_o_factor_1 =
          __expf(block_row_max_old_1 - block_row_max_new_1);
// 0. Rescale O: Online rescaling O each tile_K_seqlen step, need m_new, m_old.
// m = max(m_old, m_new), O_new[Br,d] = exp(m_old - m) * O_old + P@V
#pragma unroll
      for (int j = 0; j < kWarpTileHeadDimV; ++j) { // 8, 16, 32, ...
        float2 t_reg_O_0 = __half22float2(HALF2(R_O[i][j][0])); // 0~7  {c0, c1}
        float2 t_reg_O_1 = __half22float2(HALF2(R_O[i][j][1])); // 8~15 {c2, c3}
        float2 t_reg_D_0 = __half22float2(HALF2(R_D[i][j][0])); // 0~7  {c0, c1}
        float2 t_reg_D_1 = __half22float2(HALF2(R_D[i][j][1])); // 8~15 {c2, c3}
        // Note that the formula in the FA2 paper is incorrect; here,
        // the inverse of the exp function should not be taken, as it
        // would result in an error during rescaling, namely, you have
        // use exp(m_old - m_new), not 1/(m_old - m_new).
        // O_new[Br,d] = exp(m_old - m_new) * O_old + P@V
        t_reg_D_0.x = __fmaf_rn(rescale_o_factor_0, t_reg_D_0.x, t_reg_O_0.x);
        t_reg_D_0.y = __fmaf_rn(rescale_o_factor_0, t_reg_D_0.y, t_reg_O_0.y);
        t_reg_D_1.x = __fmaf_rn(rescale_o_factor_1, t_reg_D_1.x, t_reg_O_1.x);
        t_reg_D_1.y = __fmaf_rn(rescale_o_factor_1, t_reg_D_1.y, t_reg_O_1.y);
        HALF2(R_D[i][j][0]) = __float22half2_rn(t_reg_D_0);
        HALF2(R_D[i][j][1]) = __float22half2_rn(t_reg_D_1);
      } // end for kWarpTileHeadDimV.

      // Now, we can update m, l after O has been scaled.
      // 1. First, update block row sum Exp for each lane which
      // need both m_new and m_old.
      float block_row_sum_old_0 = lane_block_row_sum_old[i][0];
      float block_row_sum_old_1 = lane_block_row_sum_old[i][1];
      // Update l = exp(m_old - m_new) * l_old + row_sum(P).
      lane_block_row_sum_old[i][0] = (__fmaf_rn(
          rescale_o_factor_0, block_row_sum_old_0, block_row_sum_new_0));
      lane_block_row_sum_old[i][1] = (__fmaf_rn(
          rescale_o_factor_1, block_row_sum_old_1, block_row_sum_new_1));
      // 2. Then, update block row max for each lane.
      lane_block_row_max_old[i][0] = block_row_max_new_0;
      lane_block_row_max_old[i][1] = block_row_max_new_1;
    }

    // NOTE: After compute P @ V, we have to wait next K tile ready in smem.
    // do not need to wait any things if kStage == 1.
    if constexpr (kStage > 1) {
      if ((tile_K_seqlen + 1) < Tc) {
        CP_ASYNC_WAIT_GROUP(0);
      }
      __syncthreads();
    }

  } // end loop over N
  __syncthreads();

// Finaly, we still have to rescale O once more.
// O_output(D) = ( 1/l_final ) * O_final (FA2 paper)
#pragma unroll
  for (int i = 0; i < kWarpTileSeqLenP; ++i) { // 1
    float rescale_factor_0 = __frcp_rn(lane_block_row_sum_old[i][0]);
    float rescale_factor_1 = __frcp_rn(lane_block_row_sum_old[i][1]);
#pragma unroll
    for (int j = 0; j < kWarpTileHeadDimV; ++j) {             // 8, 16, 32, ...
      float2 t_reg_D_0 = __half22float2(HALF2(R_D[i][j][0])); // 0~7  {c0, c1}
      float2 t_reg_D_1 = __half22float2(HALF2(R_D[i][j][1])); // 8~15 {c2, c3}
      t_reg_D_0.x = rescale_factor_0 * t_reg_D_0.x;
      t_reg_D_0.y = rescale_factor_0 * t_reg_D_0.y;
      t_reg_D_1.x = rescale_factor_1 * t_reg_D_1.x;
      t_reg_D_1.y = rescale_factor_1 * t_reg_D_1.y;
      HALF2(R_D[i][j][0]) = __float22half2_rn(t_reg_D_0);
      HALF2(R_D[i][j][1]) = __float22half2_rn(t_reg_D_1);
    }
  }

// Store O(D): Write O[Br,d] from regs -> gmem, collective store
// with reg reuse & warp shuffle. need R_Z[2][4].
#pragma unroll
  for (int i = 0; i < kWarpTileSeqLenP; ++i) { // 1
#pragma unroll
    for (int j = 0; j < kWarpTileHeadDimV; ++j) { // 8
      uint32_t R_Z[2][4];                         // [2][4]
      R_Z[0][0] = R_D[i][j][0];
      R_Z[1][0] = R_D[i][j][1]; // warp_size 4
      R_Z[0][1] = __shfl_sync((0xffffffff), R_D[i][j][0], lane_id + 1, 4);
      R_Z[0][2] = __shfl_sync((0xffffffff), R_D[i][j][0], lane_id + 2, 4);
      R_Z[0][3] = __shfl_sync((0xffffffff), R_D[i][j][0], lane_id + 3, 4);
      R_Z[1][1] = __shfl_sync((0xffffffff), R_D[i][j][1], lane_id + 1, 4);
      R_Z[1][2] = __shfl_sync((0xffffffff), R_D[i][j][1], lane_id + 2, 4);
      R_Z[1][3] = __shfl_sync((0xffffffff), R_D[i][j][1], lane_id + 3, 4);

      // st.global.v4 128 bits. [Br,d]
      if (lane_id % 4 == 0) {
        // (0/1)*32 + (0/1)*16=(0,16,32,48), + 0~7 -> 0~56
        int store_warp_regs_O_Br =
            warp_QP * (kMmaAtomM * kWarpTileSeqLenP) + i * kMmaAtomM;
        int store_lane_gmem_O_Br =
            O_tile_id * Br + store_warp_regs_O_Br + lane_id / 4; // 0~7
        // (0~3)*16 + (0/1)*8=(0,8,16,24,...,48,56)
        int store_warp_regs_O_d =
            warp_KV * (kMmaAtomN * kWarpTileHeadDimV) + j * kMmaAtomN;
        int store_lane_gmem_O_d = store_warp_regs_O_d; // (0~3)*16+(0/8)
        int store_gmem_O_addr_0 =
            (O_gmem_offset + (store_lane_gmem_O_Br + 0) * kHeadDim +
             store_lane_gmem_O_d);
        int store_gmem_O_addr_1 =
            (O_gmem_offset + (store_lane_gmem_O_Br + 8) * kHeadDim +
             store_lane_gmem_O_d);
        LDST128BITS(O[store_gmem_O_addr_0]) = LDST128BITS(R_Z[0][0]);
        LDST128BITS(O[store_gmem_O_addr_1]) = LDST128BITS(R_Z[1][0]);
      }
    } // end for kWarpTileHeadDimV
  } // end for kWarpTileSeqLenQ
}

template <const int kHeadDim, const int kStage>
void launch_flash_attn_mma_stages_split_q(torch::Tensor Q, torch::Tensor K,
                                          torch::Tensor V, torch::Tensor O) {
  // Now: fixed tile BrxBc=64x64 for d < 128, 64x16 for d >= 128
  // TODO: dynamic tile size for Br, Bc according to kHeadDim and shared memory
  // size.
  constexpr int kMmaAtomM = 16;
  constexpr int kMmaAtomN = 8;
  constexpr int kMmaAtomK = 16;
  constexpr int kMmaTileSeqLenQ = (kHeadDim < 128) ? 4 : 4;
  constexpr int kMmaTileSeqLenK = 1;
  constexpr int kMmaTileSeqLenP = (kHeadDim < 128) ? 4 : 4;
  constexpr int kMmaTileHeadDimV = 1;
  constexpr int kWarpTileSeqLenQ = 1;
  constexpr int kWarpTileSeqLenK = (kHeadDim < 128) ? 8 : 2;
  constexpr int kWarpTileSeqLenP = 1;
  constexpr int kWarpTileHeadDimV =
      (kHeadDim / (kMmaAtomN * kMmaTileHeadDimV)); // 8,16,32,....
  constexpr int Br =
      kMmaAtomM * kMmaTileSeqLenQ * kWarpTileSeqLenQ; // 16*4*1=64
  constexpr int Bc = kMmaAtomN * kMmaTileSeqLenK * kWarpTileSeqLenK; // 8*1*8=64
  constexpr int kNumThreads =
      WARP_SIZE * kMmaTileSeqLenQ * kMmaTileSeqLenK; // 32*4*1=128, num threads
  constexpr int kPad = 8;

  // static int kMaxSramPerBlock;
  // cudaDeviceGetAttribute(&kMaxSramPerBlock,
  // cudaDevAttrMaxSharedMemoryPerBlock, 0); Calculate SRAM size needed per
  // block, Q,K,V smem size
  const int smem_max_size =
      ((Br * (kHeadDim + kPad)) + (kStage * Bc * (kHeadDim + kPad)) +
       (Bc * (kHeadDim + kPad))) *
      sizeof(half);

  const int QKV_batch = Q.size(0);
  const int QKV_head = Q.size(1);
  const int QKV_seqlen = Q.size(2); // QKV_seqlen
  assert(QKV_seqlen % Bc == 0);     // multiple of Bc=64

  // TODO: How to apply block swizzle to improve L2 Cache hit rate?
  // NOTE: reorder (B,H,Tr) -> (Tr,B*H) seems can improve L2 Cache hit rate.
  // This might be because SM schedules blocks starting from the x-dimension.
  // Placing Tr at the forefront ensures that identical KV pairs are placed
  // in consecutive scheduling queues, thereby improving L2 Cache hit rates.
  // Tr(=N/Br), batch_size x num_heads
  dim3 grid(div_ceil(QKV_seqlen, Br), QKV_batch * QKV_head);
  dim3 block(kNumThreads); // 4/8 warps per block

  cudaFuncSetAttribute(
      flash_attn_mma_stages_split_q_kernel<
          kHeadDim, kMmaAtomM, kMmaAtomN, kMmaAtomK, kMmaTileSeqLenQ,
          kMmaTileSeqLenK, kMmaTileSeqLenP, kMmaTileHeadDimV, kWarpTileSeqLenQ,
          kWarpTileSeqLenK, kWarpTileSeqLenP, kWarpTileHeadDimV, kStage, kPad>,
      cudaFuncAttributeMaxDynamicSharedMemorySize,
      // kMaxSramPerBlock
      98304);

  flash_attn_mma_stages_split_q_kernel<
      kHeadDim, kMmaAtomM, kMmaAtomN, kMmaAtomK, kMmaTileSeqLenQ,
      kMmaTileSeqLenK, kMmaTileSeqLenP, kMmaTileHeadDimV, kWarpTileSeqLenQ,
      kWarpTileSeqLenK, kWarpTileSeqLenP, kWarpTileHeadDimV, kStage, kPad>
      <<<grid, block, smem_max_size>>>(reinterpret_cast<half *>(Q.data_ptr()),
                                       reinterpret_cast<half *>(K.data_ptr()),
                                       reinterpret_cast<half *>(V.data_ptr()),
                                       reinterpret_cast<half *>(O.data_ptr()),
                                       QKV_seqlen, QKV_head);
}

void flash_attn_mma_stages_split_q(torch::Tensor Q, torch::Tensor K,
                                   torch::Tensor V, torch::Tensor O,
                                   int stages) {
  CHECK_TORCH_TENSOR_DTYPE(Q, torch::kHalf) // Q [B,H,N,D]
  CHECK_TORCH_TENSOR_DTYPE(K, torch::kHalf) // K [B,H,N,D]
  CHECK_TORCH_TENSOR_DTYPE(V, torch::kHalf) // V [B,H,N,D]
  CHECK_TORCH_TENSOR_DTYPE(O, torch::kHalf) // O [B,H,N,D]
  const int d = Q.size(3);                  // B, H, N, d

  if (stages > 1) {
    switch (d) {
    case 32:
      launch_flash_attn_mma_stages_split_q<32, 2>(Q, K, V, O);
      break;
    case 64:
      launch_flash_attn_mma_stages_split_q<64, 2>(Q, K, V, O);
      break;
    case 96:
      launch_flash_attn_mma_stages_split_q<96, 2>(Q, K, V, O);
      break;
    case 128:
      launch_flash_attn_mma_stages_split_q<128, 2>(Q, K, V, O);
      break;
    default:
      throw std::runtime_error("headdim not support!");
      break;
    }
  } else {
    switch (d) {
    case 32:
      launch_flash_attn_mma_stages_split_q<32, 1>(Q, K, V, O);
      break;
    case 64:
      launch_flash_attn_mma_stages_split_q<64, 1>(Q, K, V, O);
      break;
    case 96:
      launch_flash_attn_mma_stages_split_q<96, 1>(Q, K, V, O);
      break;
    case 128:
      launch_flash_attn_mma_stages_split_q<128, 1>(Q, K, V, O);
      break;
    default:
      throw std::runtime_error("headdim not support!");
      break;
    }
  }
}
```

</details>

## 本篇小结

1. **unfused 慢 9.4 倍的根源**：N×N 的 S/P 矩阵 O(N²) 显存流量——FA 让它们只活在寄存器/smem，按块算完就扔
2. **online softmax 的矩阵版**：行级 (m,l) 跨块在线合并，O 也要 rescale——04 篇 MD 结构 × D 维输出；FA2 论文的 rescale 公式有笔误（源码注释修正），学习要带验证
3. **split-kv → split-q = +72%**：softmax 行独立 ⇒ 沿 Q 切分 warp 零通信；K/V 共享 smem 免费——**切分方向这种"零成本"设计决策的收益碾压一切微调**
4. **softmax 在 mma 操作数寄存器上就地发生**——裸 MMA 布局受控的兑现；m16n8k16 的 C 布局与行归约幸运对齐
5. **share-qkv**：Q 常驻 smem + KV 双缓冲流水，smem 预算账 40KB/64KB
6. **189 vs SDPA 133**：特化 vs 通用的经典权衡；大形状反超靠 sm_90 的 WGMMA/TMA（4090 编不了）
