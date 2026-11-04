# 10b · Step7 StateUpdate 的 Cube 主循环（2094-2289）

> 本章是 `10-Output与StateUpdate的Cube融合.md` 的接续篇。!1135 的 1918-2410 这一段

## 0. 结论先行

锚点：chunk_gated_delta_rule.h:2094-2289（本章；2290-2410 见 10c 章）

1. **Step7 的 Cube 化只做了一半的乘法，另一半留给 Vector。** 唯一进 Cube 的是
   `(K·exp(g_last-g))^T @ v_new`（`:2230`、`:2245` 共 4 条 Mmad）；
   `exp(g_last)·state` 这一项**在 UB 上用一条 `Muls` 做掉**（`:2123`），
   因为它和 Cube 输出是相加关系，不需要也不应该进 L0C。
2. **`kTileM` 的分界是 96 而不是别的数**：`:2104` 写作
   `constexpr uint32_t kTileM = (kSpecializedDk <= 96) ? kSpecializedDk : 64;`，
   于是 `kMTileCount`（`:2106`）在 64/80/96 桶里都是 **1**，只有 128 桶是 **2**。
   可机械证明的必然而非作者断言：**融合版 NZ→ND 加法（`:2265-2271`）要求
   `kStateRows*16 == (kStateRows/16)*256`，即 L0C 落地缓冲必须正好容纳"一整列 fractal"**；
   一旦 M 被切成 64 行的 tile，每个 tile 的 NZ 只有 `curTileM/16` 段 fractal，
   `nBlock` 之间的步长从 `kStateRows*16` 变成 `curTileM*16`，融合 Add 的常量 `repStride` 就不成立，
   只能退回 `:2274-2286` 的逐行逐块分段加。
3. **K^T 的转置完全发生在 UB，不进 Cube。** `dav_m200` 的 Mmad 只接受 NZ 排布的 A/B，
   没有"转置位"可设；所以 `:2149-2166` 与 `:2177-2190` 用两轮
   `TransDataTo5HD`（16×16 fractal 转置指令）把 `[64, dk]` 的 K 摆成 `[dk, 64]` 再 DMA 到 GM slot，
   hi/lo 两份各转一次。
4. **标量 `gLastExp` 与 Cube 结果的先后是"先衰减、后累加"，且中间隔着两次全停。**
   `:2121-2123` 在 staging 之前就把 `exp(g_last)` 乘进 `stateInFp32`；
   Cube 结果直到 `:2258` 才落到 `cNz`、`:2269/:2283` 才加到 state 上。
   `:2193` 与 `:2259` 两道 `PipeBarrier<PIPE_ALL>()` 保证 V 侧衰减与 M 侧写回不交叠。
   反过来若把 `Muls` 挪到 `Add` 之后，Cube 项会被二次缩放，语义立即错。
5. **A 侧拆 hi/lo、B 侧只量化一次，是本章唯一的精度妥协点。**
   `:2147/:2171-2175` 走完整的"Cast→反向 Cast→Sub→再 Cast"补偿链，
   而 `:2192` 的 B（`v_new`）用的是只 Cast 的 `StageHalf`（`:1581-1589`）。
   `chunkVFp32` 里的 `v_new` 本身是 Step4 的 **FP32 Cube 结果**（`ComputeValueAndVNewCube` 的 L0C 读回），
   所以它进 Cube 前被量化了一次；全文件只有 `MatmulBlockFp32Compensated`（`:454/:471`）对 B 也拆 hi/lo。
   docs/PR-1135 §2.2 把这一处描述成"无损"，与快照不符。
6. 两条 GM 写回出口（FP32 workspace 与 FP16 `final_state` 转置）、`transposeCapacity` 的贴边算术、
   以及"一次算两条出口"的成本账，**全部在 10c 章（2290-2410）逐行展开**；
   本章只到 `ComputeStateUpdateCube` 的右括号 `:2289` 为止。

## 1. Dispatch：一个 `if constexpr` 就把整条 Cube 路径编进去

锚点：chunk_gated_delta_rule.h:2094-2099

```cpp
  // Fixed-shape state update:
  //   state = exp(g_last) * state + (K * exp(g_last - g))^T @ v_new.
  // The weighted K^T @ v_new product uses Cube. The 64/80/96 buckets convert the
  // complete NZ result to contiguous ND and use one wide Vector Add; the 128
  // bucket retains the segmented fallbac  
  __aicore__ inline void ComputeStateUpdateCubeDispatch(int32_t t_start, uint64_t qkHead) {
    if constexpr (kSpecializedDk != 0) {
      ComputeStateUpdateCube<kSpecializedDk, kSpecializedDk>(t_start, qkHead);
    }
  }

```

- `:2094` 签名只带 `t_start` 与 `qkHead`：Step7 需要的其余几何量
  （`chunkLen`、`avFp32`、`v_i`、`curV`）在快路径下全部退化为模板常量，**不需要传**。
- `:2095` `if constexpr (kSpecializedDk != 0)`：桶 0 是"未知形状/纯 Vector"实例，
  这一行的常量折叠让桶 0 里**整个 Cube 函数体都不生成代码**，
  这也是 `ComputeStateUpdateCube` 里敢用 `constexpr uint32_t` 数组尺寸的前提。
- `:2096` 模板实参 `kSpecializedDk, kSpecializedDk` 同时喂给 `kStateRows` 与 `kMatmulN`：
  即**"状态的行 = K 的列 = 输出矩阵的列 = 桶宽"**，这是整个 Step7 固定形状的根。
- `:2097-2098` 空 else（无 `else` 分支）与右括号；桶 0 直接掉回调用点的 Vector 分支。

## 2. 模板参数、M 拆分决策与 GM slot 预算

锚点：chunk_gated_delta_rule.h:2100-2119

```cpp
  template <uint32_t kStateRows, uint32_t kMatmulN>
  __aicore__ inline void ComputeStateUpdateCube(int32_t t_start, uint64_t qkHead) {
    // The 64/80/96 buckets fit one complete M tile in L0C; the 128 bucket keeps
    // the conservative 64-row split.
    constexpr uint32_t kTileM = (kSpecializedDk <= 96) ? kSpecializedDk : 64;
    constexpr uint32_t kMatmulK = 64;
    constexpr uint32_t kMTileCount = (kStateRows + kTileM - 1) / kTileM;
    constexpr uint32_t kAElements = kStateRows * kMatmulK;
    constexpr uint32_t kATileElements = kTileM * kMatmulK;
    constexpr uint32_t kBElements = kMatmulK * kMatmulN;
    constexpr uint32_t kStateElements = kStateRows * kMatmulN;
    constexpr uint32_t kCTileElements = kTileM * kMatmulN;
    __gm__ uint8_t *stageBase = GetCubeStageBase(0);
    GlobalTensor<half> aStageGm;
    GlobalTensor<half> bStageGm;
    GlobalTensor<half> aResidualStageGm;
    aStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase), kAElements);
    bStageGm.SetGlobalBuffer(reinterpret_cast<__gm__ half *>(stageBase + kAElements * sizeof(half)), kBElements);
    aResidualStageGm.SetGlobalBuffer(
      reinterpret_cast<__gm__ half *>(stageBase + (kAElements + kBElements) * sizeof(half)), kAElements);
```

- `:2100-2101` `template <uint32_t kStateRows, uint32_t kMatmulN>`：名字与 10 章
  `ComputeOutputCube<kStateK, kMatmulN>`（`:1924`）不同，**因为这里 `kStateRows` 是 A 的行数（dk）
  而不是 K 的长度**；Step7 的 K 长度恒为 64（chunkSize）。
- `:2102-2103` 注释即 §0 第 2 条的原文依据：`The 64/80/96 buckets fit one complete M tile in L0C;
  the 128 bucket keeps the conservative 64-row split.`
  "conservative" 一词说明作者当时也没有把 128 拆开的硬件必然性写死，
  但 `:2265` 的 `kNzFractalElements = kStateRows * 16` 让这条注释成了**代码层面的约束**。
- `:2104` **本章最关键的一行**：`kTileM = (kSpecializedDk <= 96) ? kSpecializedDk : 64`。
  三桶取自身（64/80/96），128 桶取 64。64 是**唯一同时满足三条约束的常数**：
  L0A/L0B 的 fractal 行对齐（16 的倍数）、`TransDataTo5HDParams.repeatTimes` 为 `uint8_t`、
  以及 10 章已确立的"64 行 = 一个 chunk 的 token 数"。
- `:2105` `kMatmulK = 64`：乘法的 K 维是 chunkSize，**不是 dk**。
- `:2106` `kMTileCount = (kStateRows + kTileM - 1) / kTileM`：向上取整。四桶实测值：

  | -
`kSpecializedDk` | `kTileM` | `kMTileCount` | `kStateRows` 整除？ |
  | --- | --- | --- | --- |
  | 0（纯 Vector 桶） | — |  | 进此函数（`:2095` 常量折叠掉） |
  | 64 | 64 | 1 | 是 |
  | 80 | 80 | 1 | 是 |
  | 96 | 96 | 1 | 是 |
  | 128 | 64 | 2 | 是（128 = 2×64） |

  注意 80 桶 `kTileM = 80`：`80 + 79 = 159`，`159 / 80 = 1`。
  所以**只有 128 需要拆**，且拆完正好两刀，`:2217` 的 `curTileM` 永远取满 `kTileM`，
  不存在第三块残 tile——这也是 `:2250` 敢用 `kSpecializedDk <= 96` 而不是 `kMTileCount == 1` 的原因。
- `:2107-2111` 五个元素数常量，逐个含义：
  `kAElements = kStateRows*kMatmulK` = **整个** A 矩阵（dk×64）元素数；
  `kATileElements = kTileM*kMatmulK` = 单个 M-tile 的 A；
  `kBElements = kMatmulK*kMatmulN` = 64×dk 的 B（v_new）；
  `kStateElements = kStateRows*kMatmulN` = dk×dk 的 C/state，**FP32 元素数**；
  `kCTileElements = kTileM*kMatmulN` = 单 tile 的 L0C 占用。
- `:2112` `GetCubeStageBase(0)`：与 10 章同一 slot0（``:249-255``），即
  `workspace + stateWorkspace 字节数 + blockIdx*2*64KB`；**每个 kernel 内所有 Cube 函数共用 slot0，
  靠执行顺序串行复用**（详见 11 章风险清单）。
- `:2113-2119` 三段 FP16 板；`:2116` A 占 `kAElements`，`:2117` B 紧随其后偏移
  `kAElements*sizeof(half)`，`:2118-2119` A 残差再偏移 `(kAElements+kBElements)*sizeof(half)`。
  四桶的 slot 预算（`CUBE_STAGE_SLOT_BYTES = 64*1024`，`:39`）：

  | 桶 | A | B | A_lo | 合计 | 64 KB 余量 |
  | --- | --- | --- | --- | --- | --- |
  | 64 | 64·64·2 = 8192 | 64·64·2 = 8192 | 8192 | 24576 B | 40960 B |
  | 80 | 80·64·2 = 10240 | 64·80·2 = 10240 | 10240 | 30720 B | 34816 B |
  | 96 | 96·64·2 = 12288 | 64·96·2 = 12288 | 12288 | 36864 B | 28672 B |
  | 128 | 128·64·2 = 16384 | 64·128·2 = 16384 | 16384 | **49152 B** | 16384 B |

  与 10 章 `ComputeOutputCube` 的 128 桶合计 65536 B（贴死）不同，
  Step7 的 A 是 `dk×64` 而 Output 的 A 是 `64×dk`，B 却是同一个形状——
  **两者只是行列表述相反，字节数相同**，故 Output 侧 A/B/A_lo = 16384+32768+16384。

## 3. exp(g_last) 标量与衰减：先于任何 Cube 动作

锚点：chunk_gated_delta_rule.h:2120-2130

```cpp

    float gLast = gCumsumFp32.GetValue(kMatmulK - 1);
    float gLastExp = expGCumFp32.GetValue(kMatmulK - 1);
    Muls(stateInFp32, stateInFp32, gLastExp, kStateElements);
    Duplicate(deltaFp32, gLast, kMatmulK);
    PipeBarrier<PIPE_V>();
    Sub(deltaFp32, deltaFp32, gCumsumFp32, kMatmulK);
    PipeBarrier<PIPE_V>();
    Exp(deltaFp32, deltaFp32, kMatmulK);
    PipeBarrier<PIPE_V>();

```

- `:2120` 空行（函数体第一段结束于 `:2119`）。
- `:2121` `gLast = gCumsumFp32.GetValue(kMatmulK - 1)`：快路径下 `chunkLen == 64`（`:259`），
  所以索引 63 就是本块最后一个 token 的 `g_cumsum`。**用 `kMatmulK-1` 而不是 `chunkLen-1`**，
  把运行期长度换成编译期常量，是桶化后的通用手法（对照 fallback `:2298` 仍用 `chunkLen - 1`）。
- `:2122` `gLastExp = expGCumFp32.GetValue(63)`：**不重算 exp**，直接取 Step2 预计算的表
  （`PrepareDecayAndExp:907` 写好的 `Exp(expGCumFp32, gCumsumFp32, chunkLen)`）。
- `:2123` `Muls(stateInFp32, stateInFp32, gLastExp, kStateElements)`：
  **一条 V 指令给整块 dk×dk 状态乘上衰减**，长度用 `kStateElements`（含 padding 列）。
  这里就是 §0 第 4 条说的"先衰减"。
  注意它是**原地**的：state 只有这一条退路，因为 `stateInFp32` 与 `chunkScoresFp32` 共用
  tmpBuff 同一基址（`:175-176`），但 scores 在 Step7 之前已死。
- `:2124` `Duplicate(deltaFp32, gLast, 64)`：把标量 `gLast` 广播成 64 个 float 的向量，
  **这就是"标量→向量"的标准落法**：不是把标量直接喂给 `Muls`，而是先在 V 上造一个等长向量。
- `:2125` `PipeBarrier<PIPE_V>()`：`:2123` 的 `Muls` 与 `:2124` 的 `Duplicate` 都写 UB，
  下一条 `Sub` 要读 `deltaFp32`，V 管内部必须收口。
- `:2126` `Sub(deltaFp32, deltaFp32, gCumsumFp32, 64)`：算 `g_last - g_i`（逐 token）。
- `:2127` 又一条 V 栅栏，`:2128` `Exp(deltaFp32, deltaFp32, 64)`：V 管的指数单元
  （硬件是查表+多项式拟合，与 `:364 ScalarExp` 的 8 项泰勒展开不同精度路径）。
- `:2129` `PipeBarrier<PIPE_V>()`；`:2130` 空行。
  **这三行 `Duplicate/Sub/Exp` 全部在 `deltaFp32` 上原地完成**，
  与 10 章 `ComputeAttnInter` 的 fallback（`:2307` 用 `ScalarExp` 逐 token 算）形成
  "一次批量 vs 64 次标量"的直接对照。

## 4. K 板：借用死掉的输出缓冲，逐行乘衰减系数

锚点：chunk_gated_delta_rule.h:2131-2146

```cpp
    // Load K in [64,128] ND order, apply one decay coefficient per row, then
    // transpose the FP16 high/low parts to the [128,64] A matrix.
    LocalTensor<inType> keyLocal = chunkKFp32.template ReinterpretCast<inType>();
    uint64_t keyOffset = (static_cast<uint64_t>(t_start) * NK_ + qkHead) * realK_;
    LoadPaddedRows(chunkAttnOutFp32, keyLocal, keyGm_, keyOffset, kMatmulK, NK_ * realK_);
    TQueSync<PIPE_V, PIPE_S> decaySync;
    decaySync.SetFlag(0);
    decaySync.WaitFlag(0);
    for (uint32_t row = 0; row < kMatmulK; ++row) {
      float rowScale = deltaFp32.GetValue(row);
      Muls(chunkAttnOutFp32[row * kStateRows], chunkAttnOutFp32[row * kStateRows], rowScale, kStateRows);
    }
    PipeBarrier<PIPE_V>();

    LocalTensor<half> stageLocal = stateOutQueue_.AllocTensor<half>();
    LocalTensor<half> transposedLocal = kCumdecayFp32.template ReinterpretCast<half>();
```

- `:2131-2132` 注释是本章的第二个"作者自述"：**先按 [64, dk] ND 载入 K、逐行乘一个衰减系数、
  再把 FP16 高低两份转置成 [dk, 64] 的 A**。三句话对应 §4/§5/§6 三个小节。
- `:2133` `keyLocal = chunkKFp32.ReinterpretCast<inType>()`：
  **借 `chunkKFp32` 当 FP16 staging**（`ReinterpretCast` 只改元素类型、不改地址）。
  此刻 `chunkKFp32` 的身份是 10 章 `:1946` 留下的"FP16 Q 板"，早已死。
  容量核算：写入 `rows*alignK_ = 64*128 = 8192` 个 half = 16384 B，
  `chunkKFp32` 容量 `cs*alignK = 8192` 个 float = 32768 B，**只用掉一半**（10 章 §4 同一结论）。
- `:2134` `keyOffset = (t_start*NK_ + qkHead)*realK_`：与 10 章 `:1947` 逐字符同构，只是 `keyGm_` 换 `queryGm_`。
- `:2135` `LoadPaddedRows(chunkAttnOutFp32, keyLocal, keyGm_, keyOffset, kMatmulK, NK_*realK_)`：
  **dst 是 `chunkAttnOutFp32`——刚被 `WriteAttnTileToGm`（`:1326`）写空的输出板**，
  现在当作 [64, dk] 的 FP32 K。顺序由 `ProcessOneVTile` 保证（`:1326` 在 `:1327` 之前）。
- `:2136-2138` `TQueSync<PIPE_V, PIPE_S> decaySync` + `SetFlag(0)/WaitFlag(0)`：
  **V 写 → S 读的跨管握手**。因为 `:2140` 要用标量管从 `deltaFp32` 里 `GetValue`。
  这个方向（V→S）在全文件 12 处 `PIPE_V,PIPE_S` 中一致：
  `:401/:528/:648/:896/:937/:1156/:1188/:1207/:1390/:1517/:2136/:2398` **全部紧接在标量读/写 UB 之前**；
  而 6 处 `PIPE_S,PIPE_V`（`:330/:535/:870/:1004/:1230/:1528`）**全部紧跟在标量 `SetValue` 之后**。
  10 章 §10.3 里被 !1135 删掉的 `TQueSync<PIPE_S,PIPE_V> coefficientSync` 属于"标量只读、向量消费寄存器值"，
  在这个不变式里**本来就不需要握手**——同文件 `:1185-1186`（`GetValue` 后立刻 `Muls`，无握手）是既存的旁证。
- `:2139-2142` 逐行衰减：`rowScale = deltaFp32.GetValue(row)`（S 管），
  `Muls(chunkAttnOutFp32[row*kStateRows], ..., rowScale, kStateRows)`（V 管）。
  **64 次标量读 + 64 条宽 V 乘**，取代 fallback 里"每个 (i,d) 一次 `ScalarExp`"的 8192 次标量指数。
  行长写 `kStateRows`（= dk = alignK_）而不是 `realK_`：**padding 列也必须被乘**，
  虽然 0×系数仍是 0，但宽度对齐才能让 `:2141` 的地址步进与 `:2147` 的 `kAElements` 自洽。
- `:2143` `PipeBarrier<PIPE_V>()`；`:2144` 空行。
- `:2145` `stageLocal = stateOutQueue_.AllocTensor<half>()`：
  **`stateOutQueue_` 在 !1135 里已经不是"状态输出队列"了，而是全kernel通用的 FP16 单槽中转队列**
  （声明 `:2423`，`TQue<QuePosition::VECOUT, 1>`，BUFFER_NUM=1）。
  队列容量在 `:138-143` 取 `max(stateTileBytes, chunkOutBytes)`：
  128 桶 = `max(128*128*2, 64*128*2) = 32768 B = 16384 half ≥ kAElements=8192` ✓。
- `:2146` `transposedLocal = kCumdecayFp32.ReinterpretCast<half>()`：
  **借 kCumdecay 当转置落地点**（容量 `2*64*128 = 16384 half ≥ 8192` ✓）。
  此刻 `kCumdecayFp32` 的身份是 10 章 `:2041` 的 `cNz`（attn 的 NZ 落地板），已死。

## 5. 第一轮转置：hi 分量的 [64,dk] → [dk,64]

锚点：chunk_gated_delta_rule.h:2147-2166

```cpp
    Cast(stageLocal, chunkAttnOutFp32, RoundMode::CAST_NONE, kAElements);
    PipeBarrier<PIPE_V>();
    TransDataTo5HDParams transposeParams;
    transposeParams.repeatTimes = static_cast<uint8_t>(kStateRows / 16);
    transposeParams.srcRepStride = 1;
    transposeParams.dstRepStride = kMatmulK;
    for (uint32_t block = 0; block < kMatmulK / 16; ++block) {
      LocalTensor<half> srcRows[16];
      LocalTensor<half> dstRows[16];
      for (uint32_t row = 0; row < 16; ++row) {
        srcRows[row] = stageLocal[block * 16 * kStateRows + row * kStateRows];
        dstRows[row] = transposedLocal[block * 16 + row * kMatmulK];
      }
      TransDataTo5HD<half>(dstRows, srcRows, transposeParams);
    }
    PipeBarrier<PIPE_V>();
    event_t vectorToMte3 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE3));
    SetFlag<HardEvent::V_MTE3>(vectorToMte3);
    WaitFlag<HardEvent::V_MTE3>(vectorToMte3);
    DataCopy(aStageGm, transposedLocal, kAElements);
```

- `:2147` `Cast(stageLocal, chunkAttnOutFp32, RoundMode::CAST_NONE, kAElements)`：
  FP32→FP16，`CAST_NONE` = 工具链默认 RNE 舍入（本仓库从不指定舍入模式，
  与 `:1569/:1573` 的残差 Cast 同一用法）。
  `kAElements = dk*64 = 8192`，**注意元素数写的是转置后的形状**，与转置前字节数相同，所以可以直接搬。
- `:2148` V 栅栏；`:2149` `TransDataTo5HDParams transposeParams;`。
- `:2150` `repeatTimes = kStateRows/16`：**128 桶 = 8**，且该字段是 `uint8_t`
  （对照 `:1479` 的显式 `kBlockCount <= UINT8_MAX` 守卫），8 远未贴边。
- `:2151` `srcRepStride = 1`：源侧每多一个 repeat，指针前进 **1 个 32B 块 = 16 个 half**，
  即"同一行里的下一个 16 列"。
- `:2152` `dstRepStride = kMatmulK`：目的侧每多一个 repeat，前进 `kMatmulK` 个块
  = `64*32 B = 1024 half` = **正好一行 A（宽度 64）的 16 倍**，即"下一个 16 行"。
  这两个 stride 合起来就是"16×16 fractal 转置"的地址规则；
  `TransDataTo5HD` 的跨距单位在快照里没有注释，本节按 32B 块解释，
  依据是同文件 `CopyToGm(:49-50)`、`LoadPaddedRows(:289-291)` 对 `DataCopyParams` 的块单位用法。
- `:2153-2161` 外层 `block` 循环 = A 的**列块**（`kMatmulK/16 = 4` 次），
  每次准备 16 个源行指针 `srcRows[row] = stageLocal[block*16*kStateRows + row*kStateRows]`
  （A_hi 的第 row 行、第 block 组 16 列）与 16 个目的行指针
  `dstRows[row] = transposedLocal[block*16 + row*kMatmulK]`
  （转置矩阵的第 block 组 16 列、第 row 行）。
  `:2160` `TransDataTo5HD<half>(dstRows, srcRows, transposeParams)`：**一条指令摆 16 个 fractal**。
  写入上界：`(block=3)*16 + (repeat=7)*16*64 + row*64 + 16 = 48 + 7168 + 960 + 16 = 8192` ✓ 正好 `kAElements`。
- `:2162` `PipeBarrier<PIPE_V>()`：转置是 V 管，后面 MTE3 要读它。
- `:2163-2165` `V_MTE3` 事件 `SetFlag`+`WaitFlag` 成对：
  语义是"V 已写完 → 通知 MTE3 → 原地等 MTE3 接手完成"，
  与 `StageHalfWithResidual:1564-1568` 的 `MTE3_V` 惯用法互为镜像。
- `:2166` `DataCopy(aStageGm, transposedLocal, kAElements)`：MTE3 出站，
  把转置好的 A_hi 写进 GM slot0 第一段。
  **为什么要绕 GM 一圈？** `dav_m200` 上 L1 的 NZ 装载只有 `DataCopy(LocalTensor<L1>, GlobalTensor, Nd2NzParams)` 这一条入口
  （见 05 章五件套），UB→L1 没有直接通路，所以 Cube 化的每个操作数都要"UB→GM→L1"。

## 6. 第二轮转置：lo 残差分量与 B 板（v_new）

锚点：chunk_gated_delta_rule.h:2167-2193

```cpp

    event_t mte3ToVector = static_cast<event_t>(pipe_->FetchEventID(HardEvent::MTE3_V));
    SetFlag<HardEvent::MTE3_V>(mte3ToVector);
    WaitFlag<HardEvent::MTE3_V>(mte3ToVector);
    Cast(chunkKFp32, stageLocal, RoundMode::CAST_NONE, kAElements);
    PipeBarrier<PIPE_V>();
    Sub(chunkKFp32, chunkAttnOutFp32, chunkKFp32, kAElements);
    PipeBarrier<PIPE_V>();
    Cast(stageLocal, chunkKFp32, RoundMode::CAST_NONE, kAElements);
    PipeBarrier<PIPE_V>();
    for (uint32_t block = 0; block < kMatmulK / 16; ++block) {
      LocalTensor<half> srcRows[16];
      LocalTensor<half> dstRows[16];
      for (uint32_t row = 0; row < 16; ++row) {
        srcRows[row] = stageLocal[block * 16 * kStateRows + row * kStateRows];
        dstRows[row] = transposedLocal[block * 16 + row * kMatmulK];
      }
      TransDataTo5HD<half>(dstRows, srcRows, transposeParams);
    }
    PipeBarrier<PIPE_V>();
    vectorToMte3 = static_cast<event_t>(pipe_->FetchEventID(HardEvent::V_MTE3));
    SetFlag<HardEvent::V_MTE3>(vectorToMte3);
    WaitFlag<HardEvent::V_MTE3>(vectorToMte3);
    DataCopy(aResidualStageGm, transposedLocal, kAElements);
    stateOutQueue_.FreeTensor(stageLocal);
    StageHalf(chunkVFp32, bStageGm, kBElements);
    PipeBarrier<PIPE_ALL>();
```

- `:2168-2170` `MTE3_V` 成对事件：**等 MTE3 把上一块 UB 读空**。
  严格讲 `:2171` 写的是 `chunkKFp32`、`:2166` 读的是 `kCumdecayFp32`，二者不重叠，
  但同一函数里 `:2184` 马上要覆写 `transposedLocal`（= kCumdecayFp32），
  作者把栅栏放在这里是一次**保守的全停**，与 `:1566-1568` 的写法逐字对应。
- `:2171` `Cast(chunkKFp32, stageLocal, CAST_NONE, kAElements)`：FP16→FP32 **反向 Cast**，
  写回 `chunkKFp32`（容量 `8192 float` = 32768 B，正好）。
  这一步是"hi 分量还原成 FP32"，为下一步求残差做准备。
- `:2172` V 栅栏；`:2173` `Sub(chunkKFp32, chunkAttnOutFp32, chunkKFp32, kAElements)`：
  `lo_fp32 = fp32 - fp32(hi)`，**补偿法的残差定义**。
- `:2174-2175` 再栅栏 + `Cast(stageLocal, chunkKFp32, CAST_NONE, kAElements)`：残差量化成 FP16 放回队列。
- `:2176-2186` **与 §5 的 `:2148-2162` 完全同构的转置循环**（`block` 4 次 × 16 行 × `repeatTimes` 8），
  唯一区别是源是残差版 `stageLocal`、目的仍是 `transposedLocal`（覆写 A_hi 的 UB 副本，
  A_hi 已在 GM 里）。
- `:2187-2190` `V_MTE3` 成对 + `DataCopy(aResidualStageGm, transposedLocal, kAElements)`：
  A_lo 落到 slot0 第三段。
- `:2191` `stateOutQueue_.FreeTensor(stageLocal)`：**单槽队列必须显式归还**，
  否则 `:2192` 的 `StageHalf` 里 `AllocTensor` 拿不到槽。
- `:2192` `StageHalf(chunkVFp32, bStageGm, kBElements)`：
  B 板 = `v_new`（10 章离开时的身份），走 `:1581-1589` 的**只量化一次**版本。
  **这里有一个必须点明的精度事实**：`chunkVFp32` 里的 `v_new` 是 Step4 的 **FP32 Cube 结果**
  （`ComputeValueAndVNewCube` 的 L0C 读回），`StageHalf` 内部 `Cast` 成 FP16 后**不做 hi/lo 拆分**，
  所以 Step7 的第二个操作数被量化了一次。
  六条主循环 Cube 函数里只有 `MatmulBlockFp32Compensated`（`:454/:471`）对 B 也拆 hi/lo。
  docs/PR-1135 §2.2 称 StageHalf 的 B 侧 Cast 为"无损"，在本文件语境下不准确（见返回说明）。
- `:2193` `PipeBarrier<PIPE_ALL>()`：V/MTE3 全部收尾，下面进 Cube。

## 7. 四级分配器与"常驻 B"

锚点：chunk_gated_delta_rule.h:2194-2214

```cpp

    LocalMemAllocator<Hardware::L1> l1Allocator;
    LocalMemAllocator<Hardware::L0A> l0aAllocator;
    LocalMemAllocator<Hardware::L0B> l0bAllocator;
    LocalMemAllocator<Hardware::L0C> l0cAllocator;
    LocalTensor<half> a1Local = l1Allocator.Alloc<TPosition::A1, half>(kATileElements);
    LocalTensor<half> b1Local = l1Allocator.Alloc<TPosition::B1, half>(kBElements);
    LocalTensor<half> a2Local = l0aAllocator.Alloc<TPosition::A2, half>(kATileElements);
    LocalTensor<half> b2Local = l0bAllocator.Alloc<TPosition::B2, half>(kBElements);
    LocalTensor<float> c1Local = l0cAllocator.Alloc<TPosition::CO1, float>(kCTileElements);

    // B is shared by both 64-row M tiles and remains resident in L0B.
    DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t kBlock = 0; kBlock < kMatmulK / 16; ++kBlock) {
      LoadData(b2Local[kBlock * kMatmulN * 16], b1Local[kBlock * 512 / sizeof(half)],
               LoadData2DParams{0, kMatmulN / 16, kMatmulK / 16, 0, 0, true, 0});
    }
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
```

- `:2194` 空行。`:2195-2198` 四个 `LocalMemAllocator`：`Hardware::L1 / L0A / L0B / L0C`
  是**片上存储层级**的分配器类型；`:2199-2203` 的 `Alloc<TPosition::..., T>(n)` 才是取指针。
- `:2199` `TPosition::A1`（L1 的 A 区）、`:2200` `B1`、`:2201` `A2`（L0A）、`:2202` `B2`（L0B）、
  `:2203` `CO1`（L0C，FP32）。语义：GM --MTE2/Nd2Nz--> L1 --LoadData--> L0A/L0B --Mmad--> L0C。
- `:2199/:2201` 用 `kATileElements`（**单 tile**，128 桶 4096 half）而不是 `kAElements`：
  **L0A 只需装得下一个 M-tile，这正是 `kTileM` 拆分的第二重收益**；
  `:2200/:2202` 用 `kBElements`（整个 B，128 桶 8192 half）；
  `:2203` 用 `kCTileElements`。
- `:2205` 注释 `B is shared by both 64-row M tiles and remains resident in L0B.`：
  **B 只搬一次、只装载进 L0B 一次，两个 M-tile 复用**——
  这是"K^T@v_new"这类"同一 B 乘多个 A tile"的标准省流量写法。
- `:2206` `DataCopy(b1Local, bStageGm, Nd2NzParams{1, kMatmulK, kMatmulN, 0, kMatmulN, kMatmulK, 1, 0})`：
  八字段依次为 `{repeatTimes, srcBlockLen, srcStride(块), srcStep, dstStride(块), dstBlockLen, ... , }`，
  与本函数 A 侧 `:2219-2221` 的写法对照可读性最好：A 用 `{1, curTileM, kMatmulK, 0, kMatmulK, curTileM, 1, 0}`，
  即"ND 源每重复一次跳 `kMatmulK` 个 32B 块、NZ 目的每 fractal 写 `curTileM/16` 段"。
  B 的 ND 是 `[64, dk]`（K 维 64、N 维 dk），NZ 目的按 fractal 铺。
- `:2207-2208` `MTE2_MTE1` 成对：等 L1 写完再让 MTE1（L1→L0 的搬运管）读。
- `:2209-2212` `for kBlock < kMatmulK/16` 的 `LoadData`：
  `LoadData(b2Local[kBlock*kMatmulN*16], b1Local[kBlock*512/sizeof(half)], LoadData2DParams{0, kMatmulN/16, kMatmulK/16, 0, 0, true, 0})`。
  `512/sizeof(half)` = **256 个 half = 一个 fractal**，`b1Local[kBlock*256]` 是第 kBlock 个 fractal 起点；
  `LoadData2DParams` 末位之前的 `true` 是 B 侧的转置/连续标志（A 侧 `:2226` 同位置为 `false`），
  这正是"L0B 里 B 以列主序驻留"的硬件表达。
- `:2213-2214` `MTE1_M` 成对：L0B 就绪，允许 M 管开算。
  **注意 `:2199` 的 A 板此时还是空的**——A 在循环里逐 tile 搬。

## 8. M-tile 主循环与两次 Mmad（hi、lo 累加进同一个 L0C）

锚点：chunk_gated_delta_rule.h:2215-2248

```cpp

    for (uint32_t mTile = 0; mTile < kMTileCount; ++mTile) {
      uint32_t curTileM = (mTile + 1) * kTileM <= kStateRows ? kTileM : kStateRows - mTile * kTileM;
      uint32_t aOffset = mTile * kATileElements;
      DataCopy(
        a1Local, aStageGm[aOffset],
        Nd2NzParams{1, static_cast<uint16_t>(curTileM), kMatmulK, 0, kMatmulK, static_cast<uint16_t>(curTileM), 1, 0});
      SetFlag<HardEvent::MTE2_MTE1>(0);
      WaitFlag<HardEvent::MTE2_MTE1>(0);
      for (uint32_t mBlock = 0; mBlock < curTileM / 16; ++mBlock) {
        LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
                 LoadData2DParams{0, kMatmulK / 16, static_cast<uint16_t>(curTileM / 16), 0, 0, false, 0});
      }
      SetFlag<HardEvent::MTE1_M>(0);
      WaitFlag<HardEvent::MTE1_M>(0);
      Mmad(c1Local, a2Local, b2Local, MmadParams{static_cast<uint16_t>(curTileM), kMatmulN, kMatmulK, 0, false, true});

      SetFlag<HardEvent::M_MTE1>(0);
      WaitFlag<HardEvent::M_MTE1>(0);
      DataCopy(
        a1Local, aResidualStageGm[aOffset],
        Nd2NzParams{1, static_cast<uint16_t>(curTileM), kMatmulK, 0, kMatmulK, static_cast<uint16_t>(curTileM), 1, 0});
      SetFlag<HardEvent::MTE2_MTE1>(0);
      WaitFlag<HardEvent::MTE2_MTE1>(0);
      for (uint32_t mBlock = 0; mBlock < curTileM / 16; ++mBlock) {
        LoadData(a2Local[mBlock * kMatmulK * 16], a1Local[mBlock * 512 / sizeof(half)],
                 LoadData2DParams{0, kMatmulK / 16, static_cast<uint16_t>(curTileM / 16), 0, 0, false, 0});
      }
      SetFlag<HardEvent::MTE1_M>(0);
      WaitFlag<HardEvent::MTE1_M>(0);
      Mmad(c1Local, a2Local, b2Local, MmadParams{static_cast<uint16_t>(curTileM), kMatmulN, kMatmulK, 0, false, false});

      SetFlag<HardEvent::M_MTE1>(0);
      WaitFlag<HardEvent::M_MTE1>(0);
```

- `:2215` 空行；`:2216` `for (mTile = 0; mTile < kMTileCount; ++mTile)`：128 桶跑 2 轮，其余 1 轮。
- `:2217` `curTileM = (mTile+1)*kTileM <= kStateRows ? kTileM : kStateRows - mTile*kTileM`：
  通用残 tile 处理，**但在四个桶里恒等于 `kTileM`**（§2 表已证 128=2×64、80/96 整除）。
  保留这行的意义在于：一旦将来加 112 这类桶，代码不用改。
- `:2218` `aOffset = mTile*kATileElements`：GM 上 A 板按 tile 切。
- `:2219-2221` A_hi：`DataCopy(a1Local, aStageGm[aOffset], Nd2NzParams{1, curTileM, kMatmulK, 0, kMatmulK, curTileM, 1, 0})`。
- `:2222-2223` `MTE2_MTE1`；`:2224-2227` `LoadData` 把 A 的 `curTileM/16` 个 fractal 列送进 L0A，
  `a2Local[mBlock*kMatmulK*16]` 对应 A^T 的第 mBlock 组 16 行。
- `:2228-2229` `MTE1_M`；`:2230`
  `Mmad(c1Local, a2Local, b2Local, MmadParams{curTileM, kMatmulN, kMatmulK, 0, false, true})`：
  `{m, n, k, ?, 保留位, init}`。**末位 `init=true` = C 清零重写**，即本轮 tile 的第一笔。
- `:2232-2233` `M_MTE1`：**M 管读完了 L0A/L0B 才允许 MTE1 覆写**——L0A 是 `a1Local→a2Local` 的目的地，
  紧接着 `:2234` 就要把 A_lo 写进同一个 `a1Local`。
- `:2234-2245` 与 `:2219-2230` 逐行同构，只有两处不同：
  源换成 `aResidualStageGm[aOffset]`（`:2235`），
  以及 `:2245` 的 **`init=false`** —— 同一 `c1Local` 上继续累加。
  **`hi/lo 补偿`与"Cube 融合"在硬件上是同一件事**：都只是一串 `init=true,false,...` 的 Mmad 打在同一块 L0C。
- `:2247-2248` `M_MTE1` 成对：本轮 Mmad 对 L0A 的读结束（**注意：这里不是 `M_V_MTE3`，
  也没有任何"等 L0C 写完"的事件**——`dav_m200` 上 L0C 的读回只能靠后面的 `PipeBarrier<PIPE_ALL>` 收口，
  这正是 !1174 要修的 "vec read & cube write same address" 的根，见 docs/PR-1174 §1）。

## 9. L0C 落地与两条 NZ→ND 归并：融合 vs 分段

锚点：chunk_gated_delta_rule.h:2249-2289

```cpp
      LocalTensor<float> cNz = chunkKFp32;
      if constexpr (kSpecializedDk <= 96) {
        // chunkK/kCumdecay/decayMask are dead after staging A. Their combined
        // contiguous UB region holds the complete 64/80/96-bucket NZ result.
        cNz = tmpBuff.GetWithOffset<float>(kStateElements, 0);
      }
      DataCopyParams cCopyParams{static_cast<uint16_t>(kMatmulN / 16), static_cast<uint16_t>(curTileM / 16), 0, 0};
      DataCopyEnhancedParams cCopyEnhanced;
      cCopyEnhanced.blockMode = BlockMode::BLOCK_MODE_MATRIX;
      DataCopy(cNz, c1Local, cCopyParams, cCopyEnhanced);
      PipeBarrier<PIPE_ALL>();

      constexpr uint16_t kNdBlockLen = 16 * sizeof(float) / BLOCK_BYTES;
      if constexpr (kSpecializedDk <= 96) {
        // Fuse NZ->ND addressing with state accumulation. One repeat-stride
        // Add handles every row of a 16-column NZ fractal.
        constexpr uint32_t kNzFractalElements = kStateRows * 16;
        constexpr uint8_t kNdDstRepStride = kMatmulN * sizeof(float) / BLOCK_BYTES;
        constexpr uint8_t kNzSrcRepStride = 16 * sizeof(float) / BLOCK_BYTES;
        for (uint32_t nBlock = 0; nBlock < kMatmulN / 16; ++nBlock) {
          Add(stateInFp32[nBlock * 16], stateInFp32[nBlock * 16], cNz[nBlock * kNzFractalElements], 16,
              static_cast<uint8_t>(kStateRows),
              BinaryRepeatParams{1, 1, 1, kNdDstRepStride, kNdDstRepStride, kNzSrcRepStride});
        }
        PipeBarrier<PIPE_V>();
      } else {
        uint16_t nzSrcStride = static_cast<uint16_t>((curTileM / 16 * 16 * 16 - 16) * sizeof(float) / BLOCK_BYTES);
        DataCopyParams nzToNdParams{static_cast<uint16_t>(kMatmulN / 16), kNdBlockLen, nzSrcStride, 0};
        uint32_t nzFractalStride = (curTileM / 16) * 16 * 16;
        for (uint32_t row = 0; row < curTileM; ++row) {
          uint32_t stateRow = mTile * kTileM + row;
          for (uint32_t nBlock = 0; nBlock < kMatmulN / 16; ++nBlock) {
            uint32_t ndOffset = stateRow * kMatmulN + nBlock * 16;
            uint32_t nzOffset = row * 16 + nBlock * nzFractalStride;
            Add(stateInFp32[ndOffset], stateInFp32[ndOffset], cNz[nzOffset], 16);
          }
        }
      }
      PipeBarrier<PIPE_V>();
    }
  }
```

- `:2249` `LocalTensor<float> cNz = chunkKFp32;`：**默认借 chunkKFp32**（128 桶走这条）。
  容量：`curTileM*kMatmulN = 64*128 = 8192 float = 32768 B` = `chunkKFp32` 全容量，**贴边**。
  与 10 章 `:2041` 的 `cNz = kCumdecayFp32` **不同**：Output 侧 kCumdecay 是 attn 落地板、chunkK 空闲，
  Step7 侧刚好相反（chunkK 刚被 `:2173` 的残差用完，kCumdecay 是转置板但也要留到 `:2190` 之后）。
  **同一批 UB 在不同函数里身份互换，是 11 章风险清单的主体。**
- `:2250-2254` `if constexpr (kSpecializedDk <= 96)` →
  `:2253` `cNz = tmpBuff.GetWithOffset<float>(kStateElements, 0)`：
  **直接从 tmpBuff 偏移 0 取一整块**，等价于把 `chunkKFp32 | kCumdecayFp32 | decayMaskFp32`
  三块连续区拼成一个大板（`InitLocalBuffers:161-168` 保证它们首尾相接）。
  `:2251-2252` 的注释就是这个意思：三者在 staging A 之后全死。
  容量核对（`kStateElements` 个 FP32 vs 三块之和）：

  | 桶 | 需要 `kStateElements*4` | 三块连续区字节数 | 判定 |
  | --- | --- | --- | --- |
  | 64 | 4096·4 = 16384 | 16384+16384+16384 = 49152 | 宽松 |
  | 80 | 6400·4 = 25600 | 20480+20480+16384 = 57344 | 宽松 |
  | 96 | 9216·4 = 36864 | 24576+24576+16384 = 65536 | 宽松 |
  | 128 | 16384·4 = 65536 | 32768+32768+16384 = 81920 | **不合并**（`:2250` 排除），改用单块 chunkK |

  128 桶被排除的真正原因不是放不下，而是**放不下"一个 tile"以外还需要跨 tile 连续性**：
  融合分支下面会用到 `kStateRows*16` 这个常量步长。
- `:2255-2258` L0C→UB 矩阵模式搬运：
  `DataCopyParams{repeatTimes = kMatmulN/16, blockLen = curTileM/16, 0, 0}` +
  `blockMode = BLOCK_MODE_MATRIX`。
  矩阵模式下两字段被重新解释为"**N/16 个 fractal 列 × curTileM/16 个 cube 块**"，
  总量 `(kMatmulN/16)*(curTileM/16)*256` 个 FP32 = `kCTileElements` ✓（128 桶 8×4×256 = 8192 = 32768 B）。
- `:2259` `PipeBarrier<PIPE_ALL>()`：**本函数里唯一一次跨全管收口**，
  作用是"M 管的 L0C 写与 MTE2 的 L0C→UB 读都完成，V 管才能把它当普通 UB 读"。
  没有比这更细的原语可用（无 Fixpipe、无 `M_V` 事件对 L0C 的直接支持），
  代价是整条流水在这一行停顿。
- `:2261` `kNdBlockLen = 16*sizeof(float)/BLOCK_BYTES = 2`（块）：一条 ND 段 = 16 个 FP32 = 64 B。
- `:2262-2273` **融合分支（64/80/96）**：
  `:2265` `constexpr uint32_t kNzFractalElements = kStateRows * 16;`
  `:2266` `kNdDstRepStride = kMatmulN*4/32`（128→16 块，96→12 块，80→10 块）
  `:2267` `kNzSrcRepStride = 16*4/32 = 2` 块
  `:2268` `for nBlock < kMatmulN/16` → **只有 `dk/16` 条 V 指令**（64/80/96 桶分别 4/5/6 条）。
  `:2269-2271`：
  `Add(dst=stateInFp32[nBlock*16], src0=同一个, src1=cNz[nBlock*kNzFractalElements],
  16, kStateRows, BinaryRepeatParams{1,1,1, kNdDstRepStride, kNdDstRepStride, kNzSrcRepStride})`
  读法：每个 repeat 处理 16 个元素；dst/src0 每次前进一整行 ND（`kMatmulN` 个 float = `kNdDstRepStride` 块），
  src1 每次前进 16 个 float（`kNzSrcRepStride` = 2 块）；共 `kStateRows` 个 repeat。
  **为什么 src1 的常量步长能走完整块 NZ？**
  元素 `(m,n)` 在 L0C 的 NZ 布局里位于 `fractal(n/16, m/16)` 内偏移 `(m%16)*16 + (n%16)`，
  即地址 `= (n/16)*numMBlocks*256 + (m/16)*256 + (m%16)*16`。
  本分支 `numMBlocks = kStateRows/16`，故
  `numMBlocks*256 = (kStateRows/16)*256 = kStateRows*16` —— **正是 `kNzFractalElements`**；
  而 `(m/16)*256 + (m%16)*16 = m*16` —— **正是"每 repeat 前进 16 个 float"**。
  两个等式同时成立的条件就是"一个 tile 覆盖全部 `kStateRows` 行"，
  于是 §0 第 2 条的必然性闭环：**128 桶切成 64 行 tile 后 `numMBlocks` 变成 `curTileM/16`，
  与外层 `nBlock` 的基址 `kStateRows*16` 不一致，融合写法失效**，只能走分段。
- `:2273` 融合分支的 `PipeBarrier<PIPE_V>()`。
- `:2274-2286` **分段分支（128 桶）**：
  `:2275` `nzSrcStride = (curTileM/16*16*16 - 16)*4/32 = (4*256-16)/8 = 126` 块，
  与 10 章 `:2049` 的 `kNzSrcStride` 同值（那里 `kMatmulM` 恒为 64）。
  含义：一次读 2 块（16 个 float = 一个 fractal 行），再跳 126 块 = 净进 128 块 = 1024 float
  = 4 个 fractal = **下一个 `nBlock`** ✓。
  `:2276` `DataCopyParams nzToNdParams{kMatmulN/16, kNdBlockLen, nzSrcStride, 0}`，
  `:2277` `nzFractalStride = (curTileM/16)*16*16 = 1024`，
  `:2278-2285` 双层循环 `curTileM × kMatmulN/16 = 64×8 = 512` 条 `Add(..., 16)`（每个 tile 512 条，两 tile 1024 条）。
  与融合分支对比：**指令条数从 8 条涨到 1024 条**，但省掉了 L0C→UB→ND 的二次搬运。
  注意 `:2279` `stateRow = mTile*kTileM + row`：**分段分支必须显式补偿 M-tile 偏移**，
  融合分支因为覆盖全 M 而无需此项。
  这里 `Add` 的 src1 已经**不再**是纯 NZ（`:2283` 读的是 `cNz[nzOffset]`，`nzOffset = row*16 + nBlock*1024`
  ——直接用地址算式，不再依赖 fractal 常量步长），`:2275-2276` 的 `nzToNdParams` 实际上定义了同一套地址，
  但本分支用 Add 而非 DataCopy 落位，**因为要"加"而不是"搬"**。
- `:2287` `PipeBarrier<PIPE_V>()`；`:2288` 循环右括号；`:2289` 函数右括号。