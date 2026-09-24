# 07b · K_cumdecay 的 Cube 化与读回

本篇是 `07-注意力与KCumdecay的Cube化.md` 的后半

本篇**不重讲**第 05 章的裸 Mmad 五件套原语（`MatmulBlockFp32Compensated` :449-508、`GetCubeStageBase` :249-255、`StageHalfWithResidual` :1556-1579、`StageHalf` :1581-1589）与 §5.6.5 的 NZ→ND 逐行参数推导；凡涉及一律按锚点引用，只讲本区间特有的部分。


## 7.7 chunk_gated_delta_rule.h:1160-1179 — CopyAttnCubeResult：全文件唯一的"定值 64×64"回读体
锚点：chunk_gated_delta_rule.h:1160-1179
```cpp

  __aicore__ inline void CopyAttnCubeResult(LocalTensor<float> &c1Local, LocalTensor<float> dst) {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kMatmulN = 64;
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LocalTensor<float> cNz = chunkVFp32;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();
    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(dst[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```
- :1160 空行。:1161 的签名是本区间三个函数里**唯一没有 `template<>` 头**的：`kMatmulM = 64`（:1162）与 `kMatmulN = 64`（:1163）被写死成两个 `constexpr` 局部量，而不是从外面传进来。这不是偷懒，是一条**省代码量的决策**：`ComputeAttnProductsCube<kMatmulK>` 的输出 C 恒为 64×64（M=N=64，只有 K 随分桶变），所以回读参数与分桶无关；写成非模板函数 → 全文件 4 个实例化（`chunk_gated_delta_rule.cpp:34/38/42/46` 的 64/80/96/128）共用 **1 份函数体**，若内联进调用方则要复制 **2 份**（:1114、:1143 各一），若模板化则要 4 份。实测 `grep -n "CopyAttnCubeResult"` 在 d0906c3e 里只有 3 行（1 定义 + 2 调用），而同一形状的另外 6 处 L0C 回读（:1285、:1721、:1810、:1896、:2045、:2258）全都是**就地展开**的，每处 8 行 → 48 行。本函数把这 8 行的两份压成 1 份，是全文唯一被这样处理过的回读点。
- **为什么恰恰是这一处被抽出来**：它是唯一"每 chunk 执行两次"的回读（:1114 取 scores、:1143 取 attn_i），也是唯一 `kMatmulM/kMatmulN` 双 64 的点。抽取的回报在 PR !1174 上兑现：修复只在 `src/048d0427/...:116-126` 新增一个 `CopyL0CToUb`，然后把 8 个回读点各改 1 行；本函数的 :1170→`:1183` 一行同时修掉**每 chunk 的两次**回读。详见 §7.12。
- :1164-:1165 `SetFlag/WaitFlag<HardEvent::M_MTE1>(0)`——这对栅栏回答了"谁执行 L0C→UB 这条 `DataCopy`"：**MTE1 队列**。M 管置标志、MTE1 等，槽号写死 `0`。注意它只覆盖"Mmad 写完才允许开始搬"这半边；搬完之后 V 管何时能读 `cNz`/`dst` 它管不着，:1171/:1178 的两道 `PIPE_ALL` 只是把它们粗暴地并进全局 drain。这正是 !1174 补 `M_V`/`V_M` 的位置（:1164-:1165 那两行在修复版里**原样保留**，见 `src/048d0427/...:1177-1178`）。
- :1166 `LocalTensor<float> cNz = chunkVFp32;`——落地缓冲是**借来的**，且这一行是整段最紧的一处别名：:1113 的 `StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, ...)` 刚刚把 `chunkVFp32` 当 hi/lo 分裂的 scratch 读完（§7.5 已把这处窗口登记为"只被 :1118 之后的 `MTE3_MTE2` 事件链保护，而 :1170 的写方在它之前"）。为什么必须借而不能直接写 `dst`：NZ→ND 是**读写地址区间重叠**的转换（一行 16 个 FP32 要从跨 4KB 的 4 个分形里 gather 出来），原地做会覆写下一行还没读的分形。需要一块 ≥ `kCElements = 4096` 个 FP32 = **16KB** 的连续 scratch；此刻 `chunkVFp32` 在整个 chunk 内已无读者（下一次使用要到 :1239 的 `StageHalfWithResidual`），是唯一活着的候选。
- :1167-:1170 的第一跳 L0C→UB 沿用第 05 章 §5.4 与第 09 章 §9.10 已定过两次的读法，此处只把数字换成 64×64：`cCopyParams{blockCount = kMatmulN/16 = 4, blockLen = kMatmulM/16 = 4, 0, 0}`，在 `BLOCK_MODE_MATRIX`（:1169）下单位从 32B 块升格为 **16×16 分形**（每块 FP32 = 256×4 = 1024B），故一次搬 `4 × 4 = 16` 个分形 = **16KB**，与 `kCElements × 4B` 吻合；两个 stride 为 0 → 完全线性，**刻意不转置**（310P 无 Fixpipe 可借）。注意 `blockCount` 用的是 `kMatmulN/16` 而 `blockLen` 用 `kMatmulM/16`：外层是 N 分形、内层连取 M 分形，这正是 L0C 的分形排布，也是下一步 `kNzSrcStride` 必须用 `kMatmulM` 来表达段间距的原因。
- :1171 `PipeBarrier<PIPE_ALL>()`：等 MTE1 的 16KB 搬完，才能开始 :1176 的逐行转换。
- :1172-:1174 的 NZ→ND 参数在全文复现 **7 次**（:502 用 `kBlock`，:1173、:1288、:1725、:1814、:1902、:2049 用 `kMatmulM`），本区间占两份。代入 `kMatmulM = 64`：
  - `kNdBlockLen = 16 * sizeof(float) / 32 = 2`（32B 单位）→ 每段 64B = **16 个 FP32**，正好一个分形行；
  - `kNzSrcStride = (64/16 * 16 * 16 - 16) * 4 / 32 = (1024 - 16) * 4 / 32 = ` **126 块 = 4032B**；
  - 段间前进 = `kNdBlockLen + kNzSrcStride = 128 块 = 4096B = 1024 个 FP32` = 恰好一个"N 分形列"的间距 ✓；
  - `nzToNdParams{blockCount = kMatmulN/16 = 4, blockLen = 2, srcStride = 126, dstStride = 0}`。因为式子里只有 `kMatmulM`，**四个分桶下 126 恒定**，逐桶只变 `blockCount`；本函数因写死 64 而恒为 4。
- :1175-:1177 逐行 64 发 `DataCopy`：`dst[row * 64] ← cNz[row * 16]`。源侧的 `row * 16` 个 FP32 = `row*64` B 之所以正确，是因为 `row*16 = (row/16)*256 + (row%16)*16`——商给出分形行号（每跳一个分形 = 256 个 FP32 = 1024B），余数给出分形内行号（每跳一行 = 16 个 FP32 = 64B）。目标侧 `dst[row*64]` 即 ND 的行主序。**地址账不稀疏**：`cNz` 只有 16384B，4032B 的 stride 是在这 16KB 内部横穿到下一个 N 分形列——行 0 读字节 0/4096/8192/12288，行 15 读 960/5056/9152/13248，行 16 换到分形行 1 读 1024/5120/9216/13312，行 63（分形行 3 的第 15 行）读 4032/8128/12224/16320，末段结束于 **16384**——正好压满、不多一个字节 ✓。64 行 × 4 段 × 64B = **16384B**，即 16 个分形 × 16 行逐字节各访问一次，与第一跳搬下来的量严格相等、既不重叠也不浪费。每发输出 256B = 64 个 FP32 = 一条 ND 行。
- :1178 第二道 `PipeBarrier<PIPE_ALL>()`：:1176 的 64 发是 MTE1，而函数返回后 :1145 立刻在 V 管上 `Mul` 同一块 `chunkScoresFp32`——ALL 栅栏在这里是**必需的**，`PIPE_MTE1` 单独理论上也能满足，但**本区间 1021-1297 只用 `PIPE_ALL` 与 `PIPE_V` 两种栅栏**（实测：`PIPE_ALL` ×6 在 :1069/:1171/:1178/:1241/:1286/:1293，`PIPE_V` ×8 在 :1048/:1062/:1146/:1149/:1200/:1204/:1234/:1238，其它管为 0）。全文另有且仅有 2 处 `PipeBarrier<PIPE_MTE3>`（:56 `CopyToGm` 的逐行分支、:680 输出逐行写回），共性是"逐行往外发 DMA 时防队列溢出"，与 Cube 无关。**可下断言的约定**：所有涉及 M/MTE1/MTE2 的跨管定序一律靠硬事件对（`SetFlag`/`WaitFlag`），所有涉及 V 管同址读写的定序靠 `PIPE_V`，所有"整段收尾、下一次要换管角色"的地方靠 `PIPE_ALL`。

## 7.8 chunk_gated_delta_rule.h:1180-1210 — ComputeKCumdecay：公共前置 + 双臂派发 + !1108 基线的指令账
锚点：chunk_gated_delta_rule.h:1180-1210
```cpp

  // Phase 5: k_cumdecay = attn @ (k_beta * exp(g_cumsum)); result stored back into chunkKFp32.
  __aicore__ inline void ComputeKCumdecay(uint32_t chunkLen) {
    uint32_t cs = chunkSize_;
    for (uint32_t i = 0; i < chunkLen; i++) {
      float gExp = expGCumFp32.GetValue(i);
      Muls(kCumdecayFp32[i * alignK_], kCumdecayFp32[i * alignK_], gExp, realK_);
    }
    TQueSync<PIPE_V, PIPE_S> decaySync;
    decaySync.SetFlag(0);
    decaySync.WaitFlag(0);
    if constexpr (kSpecializedDk != 0) {
      if (likely(realK_ <= kSpecializedDk && chunkLen == 64 && vStepAligned_ >= kSpecializedDk)) {
        ComputeKCumdecayCube<kSpecializedDk>();
        return;
      }
    }
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkKFp32[i * alignK_];
      Duplicate(outRow, 0.0f, realK_);
      PipeBarrier<PIPE_V>();
      for (uint32_t k = 0; k <= i; k++) {
        float score = chunkScoresFp32.GetValue(i * cs + k);
        Axpy(outRow, kCumdecayFp32[k * alignK_], score, realK_);
        PipeBarrier<PIPE_V>();
      }
    }
    TQueSync<PIPE_V, PIPE_S> outputSync;
    outputSync.SetFlag(0);
    outputSync.WaitFlag(0);
  }
```
- :1181 是 Phase 5 的门牌注释，函数体从 :1182 起。整段的结构与 :965-:1014 的 `ComputeAttnMatrix` 同构：**先做与派发无关的公共前置（:1184-:1187），再 `if constexpr` + `likely` 派发（:1191-:1196），最后是 !1108 的原样兜底（:1197-:1206）**。本区间内没有任何一处 Cube 代码写在这个函数里——它只是派发器，这是它比 `ComputeAttnMatrix` 短一半的原因。
- :1183 `uint32_t cs = chunkSize_;` 只为 :1202 的标量取值服务（兜底臂专用）——快路径上 `cs` 是死变量，编译器会在 `if constexpr` 折叠掉兜底臂后一并删掉；这是"同一份源码在两条路径上指令数不同"的一个微例证。
- :1184-:1187 是**无条件执行**的行缩放：`kCumdecayFp32[i*alignK_] *= expGCumFp32.GetValue(i)`，`realK_` 个元素，共 64 发 `Muls`。两点值得记：
  - 它**不在** `if constexpr` 里，因为 Cube 版也需要它——:1240 的 `StageHalf(kCumdecayFp32, bStageGm, kBElements)` 直接把这块 FP32 截成 FP16 当 B 矩阵，`e^{g}` 必须已经乘好。
  - 内联自 :1185 的**标量读** `expGCumFp32.GetValue(i)`（S 管）到 :1186 的 `Muls`（V 管）之间**没有栅栏**——这在 !1108 里是每次都有的（见下方基线对照的 `expValueSync`）。敢删的依据是：`expGCumFp32` 由第 06 章的 `PrefixSumChunkG`/`PrepareDecayAndExp` 产出，其出口自带 `TQueSync`；本函数只是读者，S 管读一个早已定稿的 FP32 不需要 V 管配合。**净收益：每 chunk 少 128 条同步指令。**
- :1188-:1190 `TQueSync<PIPE_V, PIPE_S> decaySync`：V→S 出口，保证上面 64 发 `Muls` 在 :1202 的标量 `GetValue(chunkScoresFp32...)`（兜底臂）之前完成。注意它的方向是 **V→S**，而 :1230-:1232 的 `recursiveToVector` 是 **S→V**；两者不互为对偶，因为中间隔着标量读区。
- :1191 `if constexpr (kSpecializedDk != 0)` 编译期分桶，:1192 `if (likely(...))` 运行期守卫，守卫三条件与 :967-:969 的注意力快路径**逐字同前三个条件**，只是少了 `CanCacheAttnQuery(chunkLen)`。这里可以下一个强结论：**两个守卫选出的是同一批 chunk**。推导只用三行代码：
  - `:967` 已含 `chunkLen == 64`；`CanCacheAttnQuery(64)`（:942-:947）要求 `64 <= UINT16_MAX`（恒真）、`64*alignK_ <= 2*64*vStepAligned_` 与 `64*alignK_ <= 64*vStepAligned_`；
  - 由 :90 `alignK_ = (kSpecializedDk != 0 && realK_ <= kSpecializedDk) ? kSpecializedDk : naturalAlignK`，在 `:1192` 的第一条件成立时 `alignK_ == kSpecializedDk`；
  - 代入：后两条化简为 `kSpecializedDk <= 2*vStepAligned_` 与 `kSpecializedDk <= vStepAligned_`，前者被后者蕴含 → `CanCacheAttnQuery(64) ⟺ vStepAligned_ >= kSpecializedDk`，恰是 :1192 的第三条件。**所以 `ComputeKCumdecayCube` 运行 ⟺ `ComputeAttnProductsCube` 运行**，二者不可能一个走 Cube 一个走兜底。这条等价性不是巧合而是必然：`vStepAligned_ >= kSpecializedDk` 的真实含义就是"`chunkVFp32`（容量 `cs*avStepAligned`，:170）装得下 64×dk 的 NZ 落地区 `cNz`（:1281）与 `chunkAttnOutFp32`（容量同为 `cs*avStepAligned`，:185）装得下 64×64 的 A 副本（:1233，`kAElements` 个 FP32）"——同一个容量条件被两处复用，所以两处守卫必然同真同假。
- :1193-:1194 `ComputeKCumdecayCube<kSpecializedDk>(); return;`。**这个 `return` 使 :1207-:1209 的 `outputSync` 在 Cube 快路径上不可达**（不是死代码，是兜底臂专用；`if constexpr` 折叠后 :1197-:1209 整块仍在，因为兜底臂要它）。它同时意味着：Cube 路径**不经过** :1197-:1206 的任何一条指令。
- :1197-:1206 兜底臂即 !1108 的下三角 Axpy 嵌套，逐字节搬过来的（只少了两个 `TQueSync`）。**每 chunk 最坏指令数**（`chunkLen=64, realK_=dk`）：
  - :1199 `Duplicate` × 64（每次 `realK_` 个元素）
  - :1200 `PipeBarrier<PIPE_V>` × 64
  - :1201-:1205 内层 `for (k = 0; k <= i)`，共 `Σ_{i=0}^{63}(i+1) = 2080` 次：每次 1 标量 `GetValue`（:1202）+ 1 `Axpy`（:1203）+ 1 `PipeBarrier<PIPE_V>`（:1204）= 2080 + 2080 + 2080
  - 合计 **2144 条向量指令 + 2144 道 V 栅栏 + 2080 条标量取数**，`dk=128` 时元素访问量 `2144 × 128 ≈ 27.4 万`
- :1207-:1209 兜底专用的 V→S 出口（保证 :1203 写完后调用方能看到）。**兜底臂总共只有 2 对 `TQueSync`（4 条同步指令）+ 2144 道 `PIPE_V`**，而 !1108 基线是 4292 条同步指令——差别见下。

**对照材料（非本快照，不计入覆盖区间）**：!1108 纯 Vector 版 `src/00e39ab5/op_kernel/chunk_gated_delta_rule.h:616-645`，取法 `sed -n '616,645p' src/00e39ab5/op_kernel/chunk_gated_delta_rule.h`：
```cpp
  // Phase 5: k_cumdecay = attn @ (k_beta * exp(g_cumsum)); result stored back into chunkKFp32.
  __aicore__ inline void ComputeKCumdecay(uint32_t chunkLen) {
    uint32_t cs = chunkSize_;
    TQueSync<PIPE_S, PIPE_V> expValueSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      float gExp = expGCumFp32.GetValue(i);
      expValueSync.SetFlag(0);
      expValueSync.WaitFlag(0);
      Muls(kCumdecayFp32[i * alignK_], kCumdecayFp32[i * alignK_], gExp, realK_);
    }
    TQueSync<PIPE_V, PIPE_S> decaySync;
    decaySync.SetFlag(0);
    decaySync.WaitFlag(0);
    TQueSync<PIPE_S, PIPE_V> coefficientSync;
    for (uint32_t i = 0; i < chunkLen; i++) {
      LocalTensor<float> outRow = chunkKFp32[i * alignK_];
      Duplicate(outRow, 0.0f, realK_);
      PipeBarrier<PIPE_V>();
      for (uint32_t k = 0; k <= i; k++) {
        float score = chunkScoresFp32.GetValue(i * cs + k);
        coefficientSync.SetFlag(0);
        coefficientSync.WaitFlag(0);
        Axpy(outRow, kCumdecayFp32[k * alignK_], score, realK_);
        PipeBarrier<PIPE_V>();
      }
    }
    TQueSync<PIPE_V, PIPE_S> outputSync;
    outputSync.SetFlag(0);
    outputSync.WaitFlag(0);
  }
```
逐项差异（这就是 d0906c3e 在 Phase 5 上的"减法式改动"清单，也是 !1135 之所以能让兜底臂变快的原因）：

| 项 | !1108（00e39ab5:617-645） | d0906c3e 兜底臂（:1197-1206） | d0906c3e Cube 路径（:1193 + :1215-1294） |
|---|---|---|---|
| 外层行缩放栅栏 | `expValueSync` Set/Wait **每行一次** = 128 条 | **删除** | 删除 |
| 内层系数栅栏 | `coefficientSync` Set/Wait **每个 (i,k) 一次** = 4160 条 | **删除** | 不存在 |
| 同步指令总数 | **4292** | **4** | **28** |
| `Duplicate` / `Axpy` | 64 / 2080 | 64 / 2080 | 63（仅清上三角）+ 0 |
| `PipeBarrier<PIPE_V>` | 2144 | 2144 | **7**（本函数 :1234/:1238 + 内联的 `StageHalfWithResidual` :1561/:1570/:1572/:1574 + `StageHalf` :1584） |
| 标量 `GetValue` | 2080 | 2080 | **0** |
| Mmad | **0** | **0** | **2**（:1266 `initC=true` + :1278 `initC=false`） |
| 向量元素访问量（dk=128） | ≈28.3 万 | ≈27.4 万 | ≈4.1 万（68 发：`Muls`4096 + `Duplicate`2016 + 4 趟整块 4096/8192） |

- 表中 **"28"** 的逐项来源（可用 `sed -n '1215,1294p' … | grep -c "SetFlag\|WaitFlag\|PipeBarrier"` 复核，得 19，再加两个被内联展开的 Stage 函数与 `decaySync`）：`decaySync` Set/Wait 2（:1189-:1190）+ `recursiveToVector` Set/Wait 2（:1231-:1232）+ `PIPE_V` 2（:1234/:1238）+ `PIPE_ALL` 3（:1241/:1286/:1293）+ 硬事件 6 对 12（`MTE2_MTE1` :1254/:1270、`MTE1_M` :1264/:1276、`M_MTE1` :1267/:1279）+ `StageHalfWithResidual` 展开的 `PIPE_V` 4 与 `MTE3_V` 1 对 2 = 6 + `StageHalf` 展开的 `PIPE_V` 1 = **28**。相对 !1108 的 4292 是 **1/153**。
- 一句话结论：**兜底臂相对 !1108 快了 4288 条同步指令（99.9%），Cube 路径再快 2144 条向量指令 + 2080 条标量取数**；docs §3.3 写的"2048 条向量指令 → 2 次 Mmad"两个数都偏小，实测是 **2144 条向量指令（2080 Axpy + 64 Duplicate）+ 2144 道 V 栅栏 → 2 次 Mmad**，且它把最大的那块（!1108 的 4292 条同步）漏了——那部分其实由 !1135 的兜底臂自己就修掉了，与 Cube 无关。
- :1201 的 `k <= i`（含等号）与 Cube 版 :1235-:1236 的"从 `row+1` 起清、对角不清"**必须一致**：A 是含对角的单位下三角（对角由 :972-:974 显式写成 1.0f），Cube 稠密乘要的是同一个 A。docs §3.3 说"清上三角"是对的，但它给的动机"Cube 不支持三角乘"只讲了一半——另一半是**对角必须留**，因为 :1108 与兜底臂的 `k <= i` 都把对角项算进结果。

## 7.9 chunk_gated_delta_rule.h:1211-1241 — ComputeKCumdecayCube 的定形常量、slot0 三段与 A 侧准备
锚点：chunk_gated_delta_rule.h:1211-1241
```cpp
  // Fixed-shape k_cumdecay = attn @ (k_beta * exp(g)) as one
  // 64x64x128 Cube product, replacing the lower-triangle Axpy nest.
  template <uint32_t kMatmulN>
  __aicore__ inline void ComputeKCumdecayCube() {
    constexpr uint32_t kMatmulM = 64;
    constexpr uint32_t kMatmulK = 64;
    constexpr uint32_t kAElements = kMatmulM * kMatmulK;
    constexpr uint32_t kBElements = kMatmulK * kMatmulN;
    constexpr uint32_t kCElements = kMatmulM * kMatmulN;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);
    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAElements * sizeof(half)), kBElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAElements + kBElements) * sizeof(half)), kAElements);

    TQueSync<PIPE_S, PIPE_V> recursiveToVector;
    recursiveToVector.SetFlag(0);
    recursiveToVector.WaitFlag(0);
    Muls(chunkAttnOutFp32, chunkScoresFp32, 1.0f, kAElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t row = 0; row + 1 < kMatmulM; ++row) {
      Duplicate(chunkAttnOutFp32[row * kMatmulK + row + 1], 0.0f, kMatmulK - row - 1);
    }
    PipeBarrier<PIPE_V>();
    StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, aStageGm, aResidualStageGm, kAElements);
    StageHalf(kCumdecayFp32, bStageGm, kBElements);
    PipeBarrier<PIPE_ALL>();
```
- :1211 空行；:1212-:1213 的注释说 "one **64x64x128** Cube product"——这个 128 只对 `kSpecializedDk = 128` 的分桶成立。按 :1216-:1217 的真实取值，形状是 **M=64、K=64、N=kMatmulN**，`kMatmulN` 才是分桶宽度（64/80/96/128）。也就是说**注释把模板参数写成了字面量**，与 :1020 的"fixed 64x128 path"是同一种以 128 桶为例的写法；对照 `MmadParams{kMatmulM, kMatmulN, kMatmulK, …}`（:1266）的实参顺序是 M、N、K = 64、dk、64。
- :1214 `template <uint32_t kMatmulN>`——**这是本区间三个模板参数里唯一命名 N 的**：`ComputeAttnProductsCube` 模板化的是 K（:1021 `kMatmulK`），因为它两个乘积的输出恒为 64×64，只有收缩维随 `realK_` 变；本函数正相反，收缩维恒为 64（chunkLen），变的是**输出列数**（dk）。同一个"定形"手法在两个函数里作用在不同的轴上，读代码时容易混。
- :1215 的签名不带任何入参：所有数据都靠成员缓冲的固定名字（`chunkScoresFp32` / `chunkAttnOutFp32` / `kCumdecayFp32` / `chunkVFp32` / `chunkKFp32`）+ 编译期常量定位。这是"定形函数"的第二个含义：**接口为空，契约写在缓冲名里**。
- :1216-:1220 五个常量：`kMatmulM=64`、`kMatmulK=64`、`kAElements=4096`、`kBElements=64*kMatmulN`、`kCElements=4096*kMatmulN/64`。分桶值：

| 桶 `kMatmulN` | `kBElements` | `kCElements` | C 落地字节 | B 出 GM 字节（fp16） | slot0 内最大偏移 |
|---|---|---|---|---|---|
| 64 | 4096 | 4096 | 16KB | 8KB | 8192+8192+8192 = 24KB（占 64KB 槽 37.5%） |
| 80 | 5120 | 5120 | 20KB | 10KB | 28KB（43.8%） |
| 96 | 6144 | 6144 | 24KB | 12KB | 32KB（50.0%） |
| 128 | 8192 | 8192 | 32KB | 16KB | 40KB（62.5%） |

  与 §7.1 的注意力函数对比：本函数只用 **slot0**（:1221 `GetCubeStageBase(0)`），三段 `A_hi | B | A_lo`；注意力函数用 slot0 + slot1 共六段。**本函数是三区间里唯一"单槽、单乘积、无预取"的**，所以它也是六段布局里最短的一段——这正是 docs §3.3 说它"最纯、建议作为第一个精读的 Cube 函数"的代码依据。
- :1222-:1228 三个 `GlobalTensor<half>` 与它们的偏移：`aStageGm` 在槽首、`bStageGm` 在 `+kAElements*sizeof(half)` = +8192B、`aResidualStageGm` 在 `+(kAElements+kBElements)*sizeof(half)`。**注意 `SetGlobalBuffer` 的第二参数是元素数**（容量提示），所以 `bStageGm` 声明的元素数是 `kBElements`（dk 相关）而另两个是 `kAElements`（恒定 4096）。全函数**没有 `bResidualStageGm`**——B 侧不做补偿，这是"只补 A 不补 B"姿态在第 3 个定形函数上的再次确认（另两次：:1029-:1034、:1613 附近）。
- :1230-:1232 `TQueSync<PIPE_S, PIPE_V> recursiveToVector`：**S→V 方向**的入口栅栏，与 §7.6 结尾 :1156-:1158 的 `attentionSync`（V→S）配成一对括号，括号中间夹的是调用方 :971-:974 里那段**纯标量**的 `ComputeRecursiveAttn` + 对角写 1。这个 S→V 栅栏保证：标量管对 `chunkScoresFp32` 的 64 次 `SetValue(i*cs+i, 1.0f)` 全部落地之后，:1233 的 V 管 `Muls` 才能读它。**这是本区间唯一一处"为别人的标量写而设"的栅栏**，删掉它就会读到递归修正前的旧 A——而且它读到的不是随机值而是**上一步 :1176 刚写回的稠密积**，误差会以 `(I−A)⁻¹` 的几何级数放大，属于最难查的那类静默错误。
- :1233 `Muls(chunkAttnOutFp32, chunkScoresFp32, 1.0f, kAElements)`：**乘 1.0 是一次伪装的整块拷贝**。为什么不写 `Copy`/`Add(...,0)` 而用 `Muls(×1.0)`：AscendC 的 V 管没有 UB→UB 的整块搬指令（`DataCopy` 走 MTE1 且要求 32B 对齐的 ND 布局，`LocalTensor` 间拷贝只有逐元素 `Copy`），而 `Muls` 是单条一维向量指令、4096 元素一发完成。**为什么不直接以 `chunkScoresFp32` 为 A 源**：`chunkScoresFp32` 后面还要被读三次（:1422 的标量兜底、:1626 与 :1755 分别是两个融合 Cube 函数里同样手法的"再搬一次 A"），而 :1235-:1236 的上三角清零是**破坏性**的；`chunkAttnOutFp32` 则刚刚腾空——它的最后一个读者是 :1148 的 `Mul(decayMaskFp32, chunkAttnOutFp32, decayMaskFp32, …)`，那一条把 attn_i 转存进 `decayMaskFp32` 之后就再没人看它了（下一句对它动手的正是本行）。所以这条 `×1.0` 同时干了两件事：搬家 + 顺带把 FP32 值"刷新"成 V 管已知状态。§7.6 里 :1148 那次"同一个 `decayMaskFp32` 在 4 行内从输入变输出"的紧交接，到这里闭合为"两块 64×64 缓冲互相换手"。
- :1234 `PipeBarrier<PIPE_V>()`：隔开 :1233 的整块 `Muls` 与 :1236 的 63 次行内 `Duplicate`——它们写的是同一块 `chunkAttnOutFp32` 的重叠地址（RAW）。**同管也需栅栏**，因为 V 管指令虽按序发射但 `Muls`/`Duplicate` 的 `elementCount` 不同、内部会分多批微指令落写。这条与 §7.6 的 :1146/:1149 是同一类。
- :1235-:1237 清上三角：`for (row = 0; row + 1 < 64; ++row) Duplicate(chunkAttnOutFp32[row*kMatmulK + row + 1], 0.0f, kMatmulK - row - 1)`。三个细节：
  - 步长用 `kMatmulK`（=64）而不是 `kMatmulN`——A 矩阵是 64×64，行距 64 ✓；此时 `chunkAttnOutFp32` 的"逻辑行距"与 `chunkScoresFp32` 的 `chunkSize_`（=64）恰好相等，所以 :1233 的一次性整块 `Muls` 才不需要重排。若 `chunkLen ≠ 64` 这个等式就破了，这也是 :1192 必须守 `chunkLen == 64` 的第二个理由（第一个是 §7.8 的缓冲容量）。
  - 起点 `row+1`（**不含对角**）→ 清 63+62+…+0 = **2016** 个元素，保留 `A[i][i] = 1.0f`。全文三处上三角清零中本区间占两处：§7.6 的 :1151（scores，**含**对角，2080 个）与 :1153（decay 乘积，不含对角，2016 个），本处与 :1153 **数字相同但语义不同**——:1153 保对角是因为 attn_i 的对角 `q_i·k_i` 要被 :2006-:2007 消费，本处保对角是因为 `(I−A)⁻¹` 本身是对角为 1 的单位下三角、那 1 就是"自己这一行的直接贡献"。各自的下游契约不同，只是恰好都落在 2016。本处的下游是兜底臂的 `k <= i`（:1201）。
  - 循环条件写成 `row + 1 < kMatmulM` 而不是 `row < kMatmulM - 1`：前者在最后一步 `row = 63` 时 `Duplicate(..., 0)` 会被条件挡掉；这与 :1152 用显式 `if` 是**同一目的的两种写法**，本函数选了更省一行的那种。
- :1238 `PipeBarrier<PIPE_V>()`：等 63 次 `Duplicate` 落地，才能进 :1239 的 `StageHalfWithResidual`（它内部第一句就是 `Cast`，同一块地址的 RAW）。
- :1239 `StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, aStageGm, aResidualStageGm, kAElements)`：A 侧的 hi/lo 分裂（第 08 章 §7/§8 已详解，此处不重复），4096 元素，hi 出 :1225 的段、lo 出 :1227-:1228 的段。注意 **scratch 用的是 `chunkVFp32`**——与 :1113 同一块，且此刻 :1170/:1176 借用的 `cNz` 已经交还（:1178 的 `PIPE_ALL` 之后没人再读它），生命周期不冲突。
- :1240 `StageHalf(kCumdecayFp32, bStageGm, kBElements)`：**B 侧裸截断**，`kBElements = 64*dk` 个元素一次出 GM。这里是本区间最值得记的一条精度不对称：`kCumdecayFp32` 装的是 `K·β·e^{g}`（:1186 刚乘完 `gExp`），**它是一个真正的 FP32 中间量，截断就是有损**；而同一个量在注意力函数里作为 **A** 出现时（:1068）走的是 `StageHalfWithResidual`。换句话说，"只补 A 不补 B"的姿态让 `K_β·e^g` 在作为左操作数时被补偿、在作为右操作数时不被补偿。docs §2.2 为 `StageHalf` 给出的理由是"该操作数原生就是 FP16，截断无损"——这条理由对注意力函数里以 `StageHalf`/裸 `Cast` 出 GM 的那块 B（:1066 的 `DataCopy(bStageGm, keyTransposed, kBElements)`，即 K^T；:1043-:1044 注释明写 "K originated as FP16, so this conversion is exact"，:1047 的 `Cast(CAST_NONE)` 是一次 FP16→FP32→FP16 的原样往返）**成立**，**对本行的 B 不成立**。实测影响面：这个乘积的对角块参与 `(I−A)⁻¹` 之后的 `k_cumdecay`，其相对误差量级即 FP16 的 ~5e-4，被后面的 state 更新再吸收一次；是否可接受属于精度报告（第 04 篇）的判断，本篇只登记"文档的理由与代码的选择在此行不符"。
- :1241 `PipeBarrier<PIPE_ALL>()`：把 :1239-:1240 里 MTE3 出的两/三段 GM 写"排干"，才允许 :1252-:1253 用 MTE2 从同址读回。**这里没有用 `MTE3_MTE2` 事件对**，而 §7.4 的 :1118 用了——两种写法在全文并存（实测：`MTE3_MTE2` 仅出现在 :1118 一处，`PIPE_ALL` 出现在所有 Stage→Nd2Nz 交界处）。差别在于 :1118 之后紧接的只是一条 `DataCopy`（MTE2 队列），可以用事件对精准定序并**继续让 M 管跑 :1108 的 Mmad**；而本处 `PIPE_ALL` 之后要立刻做 L1 分配（:1243-:1246 的 `LocalMemAllocator` 是 S 管行为），需要 S 与 MTE1 都静默，用 ALL 更省事。**代价是把 M 管也排空了**——但此刻 M 管确实无活可干（乘积①的 Mmad 已在 :1142 收工），所以不亏。

## 7.10 chunk_gated_delta_rule.h:1242-1278 — 片上四级分配与两连发 Mmad

锚点：chunk_gated_delta_rule.h:1242-1278

```cpp
    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kAElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kAElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCElements);
    DataCopy(a1Local, aStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    for (uint32_t kBlock = 0; kBlock < kMatmulK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kMatmulK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true});
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    DataCopy(a1Local, aResidualStageGm, Nd2NzParams{1, kMatmulM, kMatmulK, 0, kMatmulK, kMatmulM, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t mBlock = 0; mBlock < kMatmulM / 16; ++mBlock) {
      LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulK / 16, kMatmulM / 16, 0, 0, false, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, false});
```

- :1243-:1246 四个 `LocalMemAllocator`（:1242 是空行），模板实参 `Hardware::L1 / L0A / L0B / L0C`。**这四个名字在 d0906c3e 里是 `Hardware::` 裸前缀，到 048d0427 全部变成 `AscendC::Hardware::`**——!1174 的 diff 里第 17 个 hunk 之外的第三类改动（报告 3 §3.4 实查：8 个四行 hunk，本处 :1243-:1246 是其中之一）。
- :1247-:1251 五级缓冲按 `TPosition::A1/B1/A2/B2/CO1` 申请。`c1Local` 用 `CO1`（FP32 输出，偏移模式），元素数 `kCElements = 64 × kMatmulN`。
- :1252-:1253 GM→L1 的 ND→NZ 转换，用 `Nd2NzParams` 八字段结构体一次完成。参数 `{1, M, K, 0, K, M, 1, 0}` / `{1, K, N, 0, N, K, 1, 0}`——**A 侧与 B 侧的第 2/3 与 5/6 字段互换**，这正是"B 转置"的表达方式：A 是 `kMatmulM × kMatmulK` 行主序，B 在 GM 里已按 `kMatmulK × kMatmulN` 摆好（`kCumdecayFp32` 的行距 `alignK_ ≥ kMatmulN`，由守卫 :1192 的 `vStepAligned_ >= kSpecializedDk` 保证）。字段逐位语义在第 05 章 §5.6.3 拆过，此处不重抄。
- :1254-:1255 `MTE2_MTE1`：GM→L1 由 MTE2 发起，L1→L0A/L0B 的 `LoadData` 由 MTE1 执行，方向正确。
- :1256-:1263 两个 `LoadData` 循环：A 侧 `kMatmulM/16 = 4` 发、B 侧 `kMatmulK/16 = 4` 发，共 8 发。
  - `a1Local[mBlock * 512 / sizeof(half)]` = `a1Local[mBlock * 256]`，单位是 half 元素，256 half = 512 B = 一个 16×16 分形的字节数？——不：512 B = 256 half，而 16×16 half = 256 half ✓。所以第 `mBlock` 个 M 分形起始偏移 256 half，说明 **L1 里 A 按 M 分形外层层叠**，每层 `kMatmulK/16` 个分形。`LoadData2DParams{0, kMatmulK/16, kMatmulM/16, 0, 0, false, 0}`：`repeatLength = kMatmulK/16`（一次搬 K/16 个分形）、`srcStride = 0`、`kLoopSize = kMatmulM/16`、第 6 字段 `false` = 不做转置。
  - B 侧 `LoadData2DParams{0, kMatmulN/16, kMatmulK/16, 0, 0, true, 0}`：末位之前的布尔是 **`true` = 转置装载**。B 在 GM 里是 `K×N` 行主序，Mmad 要 `K` 外层的 NZ，故 B 必须转置进 L0B。逐桶发数：`kMatmulN` 为 64/80/96/128 时 `kMatmulN/16` = 4/5/6/8，两个循环总发数 = `4 + 4 = 8`（A 侧恒 4，因 `kMatmulK=64` 写死），**只有 B 侧随桶增长**：128 桶时 `4 + 4 = 8` 发不变但每发 `repeatLength` 从 4 升到 8。
  - 注意 :1260 循环上界是 `kMatmulK/16 = 4`（K=64 写死），与 :1256 的 `kMatmulM/16 = 4` 数值相同。**这是"两个乘积共用 64 这一维"造成的巧合**，读代码时容易误以为 A、B 都随桶变化。
- :1264-:1265 `MTE1_M`：L0 装载完才允许 Mmad。
- :1266 `Mmad(c1Local, a2Local, b2Local, MmadParams{kMatmulM, kMatmulN, kMatmulK, 0, false, true})`——**最后一个 `true` = `isAicubeMode`/累加清零位（本发从头写 L0C，不做累加）**。MmadParams 八字段口径与第 05 章 §5.6.4 一致，不重述。
- :1267-:1268 `M_MTE1`：等 Mmad 释放 L0A/L0B 之后才能覆写 L1 的 A 半区（与 :1164 同族，方向正确）。
- :1269 `DataCopy(a1Local, aResidualStageGm, Nd2NzParams{...同 :1252...})`：**把 A 的 lo 半区装进同一个 L1 A1 槽**（此刻 :1268 已保证旧 A_hi 被 Mmad 读完）。
- :1270-:1277 重复 `MTE2_MTE1` → 4 发 A 侧 `LoadData` → `MTE1_M`。**B 不重载**：L0B 里还是 :1261 装的同一个 B，这正是"只补 A 不补 B"能只花 4 发 LoadData 的原因。
- :1278 第二发 `Mmad(..., false, false)`——末位 `false` = **累加模式**，把 `A_lo·B` 加到 :1266 的 `A_hi·B` 上，L0C 全程 FP32。§7.0 第 2 条的"每乘积 2 发"到此闭合，本函数共 2 发 Mmad。

## 7.11 chunk_gated_delta_rule.h:1279-1297 — 读回落 `chunkKFp32`：就地覆写 K 与本章的边界

锚点：chunk_gated_delta_rule.h:1279-1297（下方引用块止于 :1294 的右花括号，:1295-:1297 在末条说明）

```cpp
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
    LocalTensor<float> cNz = chunkVFp32;
    DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(kMatmulM / 16), 0, 0};
    DataCopyEnhancedParams cCopyEnhanced;
    cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
    DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
    PipeBarrier<PIPE_ALL>();
    constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / 32;
    constexpr uint16_t kNzSrcStride = (kMatmulM / 16 * 16 * 16 - 16) * sizeof(float) / 32;
    DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, kNzSrcStride, 0};
    for (uint32_t row = 0; row < kMatmulM; ++row) {
      DataCopy(chunkKFp32[row * kMatmulN], cNz[row * 16], nzToNdParams);
    }
    PipeBarrier<PIPE_ALL>();
  }
```

- :1279-:1280 与 :1164-:1165 同族的 `M_MTE1`，等待第二发 Mmad 结束。
- :1281-:1285 **本函数没有调 `CopyAttnCubeResult`，而是把那 19 行内联抄了一遍。不复用的理由是硬性的**：`CopyAttnCubeResult` 内部把 `kMatmulN` 写死成 64（:1163），于是 :1173 的 `nzToNdParams` 首字段 `kMatmulN/16 = 4`，每行只读回 4 个分形 = 64 列；而本函数的输出行宽是**模板参数** `kMatmulN`（:1219/:1220 的 `kBElements/kCElements` 随桶为 5120/6144/8192），128 桶下每行必须读回 8 个分形。直接复用会把 k_cumdecay 每行截断到 64 列。要复用就得把 `CopyAttnCubeResult` 一起模板化，作者在 d0906c3e 里选择内联——这条"若模板化 `CopyAttnCubeResult` 可消掉 19 行重复"的收尾未做，登记在 `00-总览与章节地图.md` 的开放问题里。
- :1291 `chunkKFp32[row * kMatmulN]` 与兜底臂 :1198 的 `chunkKFp32[i * alignK_]` **表面上行距不同（`kMatmulN` vs `alignK_`），在 Cube 路径上可证恒等**，推导三步、每步带实测行号：
  1. Cube 臂可达的前提是 `kSpecializedDk != 0`（:1191）且 `realK_ <= kSpecializedDk`（:1192）。
  2. `chunk_gated_delta_rule.h:81` 是 `realK_ = tilingData->dk;`，故第 1 步的条件 2 就是 `tilingData->dk <= kSpecializedDk`。
  3. `chunk_gated_delta_rule.h:91` 的 `alignK_ = (kSpecializedDk != 0 && tilingData->dk <= kSpecializedDk) ? kSpecializedDk : naturalAlignK;`，其三目条件与 1、2 **逐字同形**，于是在 Cube 路径上 `alignK_ == kSpecializedDk`；而 :1193 的实参恰是 `ComputeKCumdecayCube<kSpecializedDk>()`，所以模板体内 `kMatmulN == kSpecializedDk == alignK_`。
  ⇒ `row * kMatmulN ≡ row * alignK_`：**两臂写回 `chunkKFp32` 的缓冲布局逐字节一致**，:1291 既不是笔误也不是隐患。这条恒等同时解释了为什么 :1219 的 `kBElements = kMatmulK * kMatmulN` 能对齐 `kCumdecayFp32` 声明的 `cs * alignK`（:2427）前 64 行容量。
  **反面约束**：恒等完全依赖 :91 与 :1192 两处条件写得一模一样。若守卫被改成不与三目同形的判据（例如按 `naturalAlignK` 比较），三目会走 `naturalAlignK` 分支，:1291 的行距立刻与 `alignK_` 脱钩且**不会有编译错误**。这与 :1162-:1163 双写 64 属同一类"两处独立常量/条件必须人工同步"的隐性耦合。本节初稿曾把它记作未闭环空洞，现按上述链条结案，过程见 `reports/_journal.md`。
- :1286 / :1293 两道 `PipeBarrier<PIPE_ALL>`，与 :1171/:1178 同构。
- :1294 右花括号。
- :1295-:1297 本章的收尾：:1295 空行、:1296 是 Phase 6 的门牌注释 `// ---- Phase 6: per v-tile processing (attn matrix and state tile overlap) ----`、:1297 空行。**Phase 6 门牌归本章覆盖（它是区间末行），其函数体 :1298 起归第 08 章**，与台账里 `07` 与 `08` 的分界一致。