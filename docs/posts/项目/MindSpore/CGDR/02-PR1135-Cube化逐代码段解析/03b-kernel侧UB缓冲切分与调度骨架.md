# 03b · kernel 侧 UB 手工切分与调度骨架：`InitLocalBuffers` / `ComputeAvgload` / `Process`

本章只做**偏移与长度的算术推导 + 生命周期窗口**。


## 0. 本章结论先行

1. **这 115 行是整个 PR 改动面积最小的一段：3 行新增，0 修改，0 删除。
2. **"零 diff"不等于"零变化"：这 112 行里每一个数都变了。** 局部变量 `ak = alignK_` 与 `stateStrideK_` 在
   构造函数里被换成桶宽（03 章 §9.3），于是 `cs * ak` 从"64 × Ceil(dk,16)·16"变成"64 × 桶宽"，tmpBuff 累加
3. **切分是"单游标前缀和"，全函数没有任何一次显式对齐操作**。
4. **173 行的 `if (vStep_ >= realV_ || ShouldSplitVTiles())` 在终态是恒真式**，于是 178-183 的 `else`
   （scores 与 state 分开摆）成为**不可达死代码**
5. **`betaFp32` 是这段唯一的实质变化，而它是"只加缓冲、不改记账"的加法**。
6. **`stateOutQueue_` 的容量公式（138-142）在 Cube 版里换了服务对象却没改公式**：它原本只承载 attnOut /
   finalState 的 FP16 落地，现在被 **6 处 Cube 代码 `AllocTensor<half>()` 借走当 FP16 staging 板**。公式恰好还够用，靠的是 `IsCubeFastPath` 里 `vStepAligned_ == kSpecializedDk` 把 `avStepAligned` 钉成桶宽，于是队列容量 = 桶宽²×2 字节 ≥ 任何一块 A/B 板的 64×桶宽×2 字节 ⟺
   **桶宽 ≥ 64**，恰好就是最小桶。这条不变式**没有任何 assert 表达**。
7. **调度骨架（205-244）与 !1108 逐字节相同，Cube 化没有改工作项模型**。

---

## 1. `InitLocalBuffers` 的骨架：一次队列、一次 TBuf、一个游标

锚点：chunk_gated_delta_rule.h:132-159

```cpp
  __aicore__ inline void InitLocalBuffers() {
    uint32_t cs = chunkSize_;
    uint32_t ak = alignK_;
    uint32_t avStepAligned = Ceil(vStep_, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK;
    vStepAligned_ = avStepAligned;

    // stateOutQueue: max of state tile [dk, vStep] and compact chunk output [cs, vStep].
    uint32_t stateTileBytes = stateStrideK_ * avStepAligned * sizeof(outType);
    uint32_t chunkOutBytes = cs * avStepAligned * sizeof(outType);
    uint32_t outQueueBytes = stateTileBytes;
    if (chunkOutBytes > outQueueBytes) outQueueBytes = chunkOutBytes;
    pipe_->InitBuffer(stateOutQueue_, BUFFER_NUM, outQueueBytes);

    // tmpBuff layout (all FP32):
    //   chunkKFp32:      cs * alignK
    //   kCumdecayFp32:   cs * alignK
    //   decayMaskFp32:   cs * cs
    //   chunkVFp32:      cs * avStepAligned
    //   chunkScoresFp32 / stateInFp32:
    //     single V tile: overlapped (state is loaded only after scores' last use)
    //     multiple tiles: separate (scores must remain live across every tile)
    //   chunkAttnOutFp32: cs * avStepAligned
    //   gCumsumFp32:     cs
    //   deltaFp32:       max(dkAlignedFp32, cs, vStepAligned)
    //   dotProductFp32:  max(dkAlignedFp32, cs)
    //   expGCumFp32:     cs  (precomputed exp(gCumsum))
    pipe_->InitBuffer(tmpBuff, restUbSize_);
    uint32_t off = 0;
```

- 132-136 是**整段唯一读成员变量的地方**：三个局部别名把后面 40 处算术的取值固定下来（`chunkSize_ → cs`、
  `alignK_ → ak`、`vStep_ → avStepAligned`）。`vStepAligned_ = avStepAligned;`（136）是**本函数唯一一次写成员**，
  全文件对该成员只有两处写入（构造函数 100 清零、本段 136），读者却遍布 20 多处（自 `IsCubeFastPath` 259 起）。
  所以"UB 切分"顺带完成了调度侧的一件事：**桶宽与 V-tile 宽是否相等这个 Cube 前提，是在这里第一次可判定的**。
- 135 的 `Ceil(vStep_, FP32_NUM_PER_BLOCK) * FP32_NUM_PER_BLOCK` 与 host 侧 `CeilAlign(vs, FP32_NUM_PER_BLOCK)`
  （`tiling.cpp:140`、`:163`）同式，但在当前取值域里是**恒等变换**：`SolveVStep` 只产出
  `preferredVStep = cubeDk ∈ {64,80,96,128}`（`:299`）或从 `CeilAlign(dv,16)` 以步长 16 下调（`:177、190`），
  **vStep 永远是 16 的倍数**，按 8 对齐不进位。这个 `Ceil` 挡的是将来某个非 16 倍数的 vStep，且它只保护
  tmpBuff 的 FP32 记账，**不保护** 143 行 FP16 队列的行块对齐（§3 末）。
- 143 与 158 是**本 kernel 全部的两次片上申请**：没有第三次。整个 kernel（2461 行）的所有中间量
  都活在这两块里，Cube 化一个新 buffer 都没申请。
- 158 的 `restUbSize_` 就是 tiling 的 `ubRestBytes`（构造函数 89），host 给它的值是 `ubSize − outQueueMax`
  （`tiling.cpp:205`）——**注意不是 `ubSize − tbufTotal`**，故 tmpBuff 的授权比实切大，差额
  `restUbSize_ − tbufTotal` 是一段"被占用但没有具名句柄"的 UB 尾部（§6.2）。
- 159 之后 `off` 是唯一游标且**单位是字节**，而 `GetWithOffset<float>`的第一个实参是**元素数**——两种单位混在一个调用里，是读这段最容易搞错的一点，也是 §6.1
  那条"32B 对齐自动成立"的原因。

---

## 2. `stateOutQueue_`：先扣掉的那一块 UB，被 Cube 借成通用 staging 板

锚点：chunk_gated_delta_rule.h:138-143

```cpp
    // stateOutQueue: max of state tile [dk, vStep] and compact chunk output [cs, vStep].
    uint32_t stateTileBytes = stateStrideK_ * avStepAligned * sizeof(outType);
    uint32_t chunkOutBytes = cs * avStepAligned * sizeof(outType);
    uint32_t outQueueBytes = stateTileBytes;
    if (chunkOutBytes > outQueueBytes) outQueueBytes = chunkOutBytes;
    pipe_->InitBuffer(stateOutQueue_, BUFFER_NUM, outQueueBytes);
```

`sizeof(outType) == sizeof(half) == 2` —— 队列走 **FP16 域**，tmpBuff 走 **FP32 域**，
139-140 与 145 之后是这两个域的分界线（host 侧对应 `tiling.cpp:164-165` 的两个 `sizeof(uint16_t)`）。

四桶的算术（取 `dv == 桶宽` 的单片情形，此时 `avStepAligned = 桶宽`）：

| 桶宽 = `alignK_` = `stateStrideK_` = `avStepAligned` | `stateTileBytes = ak·avStep·2` | `chunkOutBytes = 64·avStep·2` | `outQueueBytes` |
| --- | --- | --- | --- |
| 64 | 64·64·2 = **8192** | 64·64·2 = 8192 | **8192** |
| 80 | 80·80·2 = **12800** | 64·80·2 = 10240 | **12800** |
| 96 | 96·96·2 = **18432** | 64·96·2 = 12288 | **18432** |
| 128 | 128·128·2 = **32768** | 64·128·2 = 16384 | **32768** |

`stateTileBytes ≥ chunkOutBytes` ⟺ `stateStrideK_ ≥ cs` ⟺ `桶宽 ≥ 64` —— **又一次"最小桶兜住"**：四桶上取 max
的结果永远是 state 项，`chunkOutBytes` 只在 64 桶持平；141-142 那个 `if` 在当前配置下**从不改变结果**，它防的是 `cs > 桶宽`（例如将来 chunkSize 提到 128）。

**143 的 `BUFFER_NUM` 与队列深度不是一回事**：声明是 `TQue<QuePosition::VECOUT, 1> stateOutQueue_`（2423），
**深度那个 1 是字面量**，`BUFFER_NUM`（34）只是 `InitBuffer` 的"申请几块"实参；两者当前都是 1 但**独立书写**，
改 `BUFFER_NUM=2` 会让 `InitBuffer` 向深度 1 的队列要 2 块而模板参数不跟着变。03 章 §6 把 `BUFFER_NUM` 说成
"`TQue` 的双缓冲深度"，按声明看深度其实是 2423 的字面量 `1`——以代码为准（自查第 6 条③）。

**这块 FP16 队列在 Cube 版里的 6 个借用者**（`grep -n "stateOutQueue_.AllocTensor"` 的全部命中）：

| 行 | 借用者 | 用途 | 峰值写入量 |
| --- | --- | --- | --- |
| 659 | `AccumOutput` | attnOut 的 FP16 落地 | `Cast(…, alignedElem)`，`alignedElem = Ceil(chunkLen·avFp32, 8)·8` |
| 1045 | `ComputeAttnProductsCube` | K 的 FP16 转置板（`kAElements = 64·kMatmulK` 个 half，`kMatmulK` 在 970 行绑定为 `kSpecializedDk`） | `64·桶宽·2` |
| 1559 | `StageHalfWithResidual` | 高位 + 低位两块 FP16 出 GM | 实参 `elementCount`，调用处传 `kAElements`/`kBElements` |
| 1582 | `StageHalf` | 单块 FP16 出 GM | 同上量级 |
| 2145 | `ComputeStateUpdateCube` | attnOut→FP16 的 A 板（`kAElements = 桶宽·64`） | `64·桶宽·2` |
| 2351 | `UpdateAndWriteState` | finalState 的 FP16 落地（`alignedElem = stateStrideK_·vStepAligned_`） | `桶宽·avStep·2`，**正好等于 `outQueueBytes`** |

于是有一条可证的容量不变式：**最大需求者是 2351（写满整个 state 镜像），而它恰好等于 `stateTileBytes` 的定义**；
1045/2145 这类"64×桶宽"的 A 板要 `128·桶宽` 字节 ≤ `2·桶宽²` ⟺ 桶宽 ≥ 64。
**结论：143 的公式没为 Cube 改一个字，是因为 Cube 借用的形状被 `IsCubeFastPath`（259 的
`vStepAligned_ == kSpecializedDk`）压回了同一个公式的取值；而 143 / 259 / 各借用点的 `elementCount`
之间没有任何编译期或运行期校验。** 一旦某处 `elementCount` 超过 `outQueueBytes`，`AllocTensor` 返回的
仍只是那块 buffer，越界部分会踩进 UB 里的邻接区域，症状是"别的缓冲数据被改写"。

生命周期：`InitLocalBuffers` 出生 → 每个 chunk 的 `AccumOutput`/Cube staging 反复 Alloc/Free → kernel 结束。
它是全 kernel 唯一的 FP16 出口缓冲，`BUFFER_NUM=1` 意味着**同一条队列上不能有两个活的 `AllocTensor`**：
1045 与 1559 的借用必须串行（1067 的 `FreeTensor` 正好在 1068 的 `StageHalfWithResidual` 之前，顺序是硬要求）。

---

## 3. tmpBuff 的 12 个视图：逐块把 `off` 走完

锚点：chunk_gated_delta_rule.h:160-183

```cpp

    chunkKFp32 = tmpBuff.GetWithOffset<float>(cs * ak, off);
    off += cs * ak * sizeof(float);

    kCumdecayFp32 = tmpBuff.GetWithOffset<float>(cs * ak, off);
    off += cs * ak * sizeof(float);

    decayMaskFp32 = tmpBuff.GetWithOffset<float>(cs * cs, off);
    off += cs * cs * sizeof(float);

    chunkVFp32 = tmpBuff.GetWithOffset<float>(cs * avStepAligned, off);
    off += cs * avStepAligned * sizeof(float);

    if (vStep_ >= realV_ || ShouldSplitVTiles()) {
      uint32_t overlapSize = (cs * cs > stateStrideK_ * avStepAligned) ? cs * cs : stateStrideK_ * avStepAligned;
      chunkScoresFp32 = tmpBuff.GetWithOffset<float>(overlapSize, off);
      stateInFp32 = tmpBuff.GetWithOffset<float>(stateStrideK_ * avStepAligned, off);
      off += overlapSize * sizeof(float);
    } else {
      chunkScoresFp32 = tmpBuff.GetWithOffset<float>(cs * cs, off);
      off += cs * cs * sizeof(float);
      stateInFp32 = tmpBuff.GetWithOffset<float>(stateStrideK_ * avStepAligned, off);
      off += stateStrideK_ * avStepAligned * sizeof(float);
    }
```

### 3.1 K 侧三块（161-168）：`cs*ak` 是"桶宽"而不是"dk"

| 块 | 元素数公式 | 80 桶 | 128 桶 | `off` 变化（80 桶） |
| --- | --- | --- | --- | --- |
| `chunkKFp32` | `cs·ak` | 64·80 = 5120 elem / **20480 B** | 8192 / 32768 | 0 → 20480 |
| `kCumdecayFp32` | `cs·ak` | 5120 / **20480** | 8192 / 32768 | 20480 → 40960 |
| `decayMaskFp32` | `cs·cs` | 4096 / **16384** | 4096 / 16384 | 40960 → 57344 |

- `cs·ak` 的两块**同尺寸**，这正是 `tiling.cpp:37 kPairedTileCount = 2` 的 device 侧对应物；
  142-143 的注释 "chunkKFp32: cs * alignK" 里的 `alignK` 如今读作"桶宽"。
- **这就是 Cube 化对 UB 的第一笔实际开销**：!1108 里 dk=80 → `ak=80` 与终态同值（80 本就是 16 的倍数），
  但 dk=100 时 !1108 的 `alignK_ = Ceil(dk,16)·16 = 112`（`00e39ab5:88`）、终态落 128 桶 → `ak=128`，
  `cs·ak·4 = 28672 → 32768` 字节，单块 +4096、`chunkKFp32` 与 `kCumdecayFp32` **合计 +8192 B**。
  桶越宽，**每一行 K 的空白列越多**，这些空白列正是 `LoadPaddedRows`（272-341）要显式清零的对象。
- 生命周期：`chunkKFp32` 由 `LoadChunkKey`（759）写入原始 K，`ComputeKBeta` 读它、`ComputeAttnProductsCube`
  把它 Cast 成 FP16 读（1047），随后**在 1181/1198/1291 被 k_cumdecay 就地覆盖**，之后在 1946/2133/2171/2249
  依次变成 Q 板、K 板、FP32 残差板、L0C 落地板（完整链见 11 章 §5.2）。`decayMaskFp32` 只在
  `PrepareDecayAndExp` 写、attn 组装时读，**是唯一一块"整块用完才复用"的**：1181 之后 K 侧三块连成的
  `2·cs·ak·4 + cs·cs·4` 连续区域被 2253 行整体借走（§5 末）。

### 3.2 V 侧与 scores/state 重叠区（170-183）：唯一一对静态别名

| 块 | 元素数 | 80 桶字节 | 128 桶字节 | 说明 |
| --- | --- | --- | --- | --- |
| `chunkVFp32` | `cs·avStep` | 5120 / 20480 | 8192 / 32768 | 出生即"最抢手的一块板" |
| `chunkScoresFp32` | 句柄按 `overlapSize` 申请 | 6400 / 25600 | 16384 / 65536 | 逻辑只用 `cs·cs`=4096 |
| `stateInFp32` | `stateStrideK_·avStep` | 6400 / 25600 | 16384 / 65536 | 与上同基址 |

- `overlapSize = max(cs·cs, stateStrideK_·avStepAligned)`：80 桶 `max(4096, 6400) = 6400`、
  128 桶 `max(4096, 16384) = 16384`、**64 桶是 `max(4096, 4096) = 4096` 的平手**（三目取前者，值相同）。
  两个句柄都从**未自增的同一个 `off`** 出发，只有重叠区末尾之后 `off` 才推进 `overlapSize`。
- **为什么 `stateStrideK_·avStep` 在 Cube 版里变成了主导项**：!1108 的 `stateStrideK_ = Ceil(dk,8)·8`
  与 `cs·cs = 4096` 相比，dk=64 时也是 4096、dk≥64 才更大；终态把 `stateStrideK_` 抬到桶宽后，
  除 64 桶平手外重叠区一律由 state 决定。**tmpBuff 里最大的一块从"scores×state 之和"变成"state 本身"**，
  这就是重叠能省下多少的度量：不重叠时 80 桶要 `16384+25600 = 41984`，重叠后 `25600`，**省 16384 B（约 13% 的 tbuf）**。
- `chunkScoresFp32` 的句柄被申请成 `overlapSize`（6400/16384）而逻辑长度只有 `cs·cs`（4096）：
  这是**故意的**——句柄必须能装下与它同址的 state，否则 `stateInFp32` 越出的部分不受管辖。
  代价是 `scores[i*cs+j]` 之类的下标算术不能再靠句柄长度做边界检查。
- 生命周期（重叠合法性的全部证据）：scores 在 Phase 4 的 `ComputeAttnMatrix`（971/984 递归式、1114
  `CopyAttnCubeResult`、1145-1151 Cube 版）写入；Phase 5 的 1202（`ComputeKCumdecay`）与 1233
  （`ComputeKCumdecayCube`）会读它，而 Phase 5 整体早于 Phase 6（1296 注释起）。Phase 6 内：慢路径
  `ComputeValueNew`（1316 调用）末次读在 1422，**先于 1317 的 `LoadStateTile`**；快路径在同一个
  `ComputeValueAndVNewCube` 里先于 1679 的 `LoadStateTile` 执行 1626 的
  `Muls(kCumdecayFp32, chunkScoresFp32, 1.0f, kAAttnElements)` **把 scores 复制到别的板**（1755 的同一写法在
  `ComputeValueNewCube` 内）。这条顺序就写在 1429：
  `// Step 3: load state tile into stateInFp32 (overlaps chunkScoresFp32 — must run after Step 2).`
  下一个 chunk 会重写 scores，**所以这对别名按 chunk 循环复用，不是一次性的**。

### 3.3 输出与标量族（185-202）：五块小板 + 一处不记账

锚点：chunk_gated_delta_rule.h:184-204

```cpp

    chunkAttnOutFp32 = tmpBuff.GetWithOffset<float>(cs * avStepAligned, off);
    off += cs * avStepAligned * sizeof(float);

    gCumsumFp32 = tmpBuff.GetWithOffset<float>(cs, off);
    off += cs * sizeof(float);

    uint32_t dotProductSize = (stateStrideK_ > cs) ? stateStrideK_ : cs;
    uint32_t deltaSize = (dotProductSize > avStepAligned) ? dotProductSize : avStepAligned;
    deltaFp32 = tmpBuff.GetWithOffset<float>(deltaSize, off);
    off += deltaSize * sizeof(float);

    dotProductFp32 = tmpBuff.GetWithOffset<float>(dotProductSize, off);
    off += dotProductSize * sizeof(float);

    expGCumFp32 = tmpBuff.GetWithOffset<float>(cs, off);
    off += cs * sizeof(float);

    betaFp32 = tmpBuff.GetWithOffset<float>(cs, off);
  }

```

| 块 | 元素数公式 | 80 桶 | 128 桶 | 80 桶 `off` 终值 | 生命周期要点 |
| --- | --- | --- | --- | --- | --- |
| `chunkAttnOutFp32` | `cs·avStep` | 5120 / 20480 | 8192 / 32768 | 123904 | 与 `chunkVFp32` 同尺寸；Cube 版被 7 种身份借用（11 章 §5.2），2351 的 FP16 落地是最后一次 |
| `gCumsumFp32` | `cs` | 64 / 256 | 64 / 256 | 124160 | `PrefixSumChunkG`（790）写、`PrepareDecayAndExp` 读，**每 chunk 重刷** |
| `deltaFp32` | `max(max(ak,cs), avStep)` | 80 / 320 | 128 / 512 | 124480 | 三目式实际是 `max(ak, cs, avStep)`；64/80/96/128 四桶下 `ak == avStep` 时退化为 `ak` |
| `dotProductFp32` | `max(ak, cs)` | 80 / 320 | 128 / 512 | 124800 | 点积 scratch + 被 `ReinterpretCast<uint32_t>` 当 Gather 偏移表（815） |
| `expGCumFp32` | `cs` | 64 / 256 | 64 / 256 | 125056 | 907 一次 `Exp` 写；1185/1950/2065/2122/2298 读。**它是 Cube 化的配套改动**：把逐标量 `ScalarExp` 吸收成一次高维 `Exp` |
| `betaFp32` | `cs` | 64 / 256 | 64 / 256 | **不推进（仍 125056）** | 见下 |

- **`deltaSize` 与 `dotProductSize` 的推导链是两段三目、不是一个 `max3`**：191 先算
  `dotProductSize = max(stateStrideK_, cs)`，192 再算 `deltaSize = max(dotProductSize, avStepAligned)`。
  四桶（`ak == avStep`）下两者都等于桶宽；`ak > avStep`（例如 128 桶 + `dv=64` → `avStep=64`）时
  `deltaSize = 128`、`dotProductSize = 128`；`avStep > ak` 只有兜底路径（`ak = Ceil(dk,16)·16`）
  且 host 选了大 vStep 才出现，此时 `deltaSize = avStep`。**注释 155-156 写的正是这个语义**，只是名字旧了。
- **`betaFp32` 是本次 PR 在本段的唯一新增**，它是"beta 装载向量化"的落点：
  快路径 `Gather(betaFp32, chunkVFp32, coefficientOffsets, head_i·4, chunkLen)`（831）
  从一次 DMA 进来的 `[chunkLen, Hv]` slab 里按 head 抽列，慢路径逐行 `LoadBeta` 标量写（835）；
  读者是 876/1376 的 `Brcb`（广播成 decay 的行）与 1401 的标量回读。
  !1108 没有这块板——它每行直接 `betaGm_.GetValue`（`LoadBeta`），**一个标量读换来 256 字节 UB**，
  省掉的是每 chunk 64 次 GM 标量访问。
- **`off` 在 202 之后不再自增**，函数结束时的 `off` 是 `expGCumFp32` 的**起点**，不是 tmpBuff 的终点。
  对 80 桶：`off_final = 125056`，真实占用末地址 `125312`。这是"最后一块不记账"的写法，
  单独看无害（没有读者），但它在两个方向上都是坑：
  ①任何人接第 13 块就会与 `expGCumFp32` 同址；②**若有人想加 `assert(off <= restUbSize_)` 自检，
  必须写成 `off + cs*sizeof(float) <= restUbSize_`**。

---

## 4. 第 173 行是恒真式：`else` 分支不可达

锚点：chunk_gated_delta_rule.h:173-183

```cpp
    if (vStep_ >= realV_ || ShouldSplitVTiles()) {
      uint32_t overlapSize = (cs * cs > stateStrideK_ * avStepAligned) ? cs * cs : stateStrideK_ * avStepAligned;
      chunkScoresFp32 = tmpBuff.GetWithOffset<float>(overlapSize, off);
      stateInFp32 = tmpBuff.GetWithOffset<float>(stateStrideK_ * avStepAligned, off);
      off += overlapSize * sizeof(float);
    } else {
      chunkScoresFp32 = tmpBuff.GetWithOffset<float>(cs * cs, off);
      off += cs * cs * sizeof(float);
      stateInFp32 = tmpBuff.GetWithOffset<float>(stateStrideK_ * avStepAligned, off);
      off += stateStrideK_ * avStepAligned * sizeof(float);
    }
```

- 展开：`ShouldSplitVTiles()` = `realV_ > vStep_`（247，见 04 章 §4.3），故 173 行是
  `vStep_ >= realV_ || realV_ > vStep_`；两个 `uint32_t` 操作数**对任意取值必有一真** ⟹ **恒真** ⟹
  178-183 的 `else`（scores 与 state 分开摆、tmpBuff 多花 `cs·cs·4 = 16384` 字节）**永远不会执行**。
- **host 侧同向**：`allowScoresStateOverlap` 在 `tiling.cpp:295` 被写成常量 `true`，于是 `:155` 的
  `overlapScoresState = vs >= dv || allowScoresStateOverlap` 同样恒真、`:156` 得
  `tScoresState = max(tScores, tState)`。**两侧恒真且同值，账不会错**；即使 host 哪天传 `false`，
  `tScores + tState > max(...)` 只会**多算预算**、device 少用，误差方向是安全的。
- **为什么这不叫 bug 而叫代价**：!1108 的 `else` 可达（`realV_ > vStep_` 且 `GetBlockNum() <= NV_`，
  即"核不够、V 又不止一片"），那时一个核要在 `ProcessVTiles` 循环里连做多片 V-tile，scores 必须跨片存活。
  04 章已说明工作项展平成 (batch, head, vTile) 后 `GetBlockNum() > NV_` 必须删——**删掉它的同时 `else`
  就失去了唯一进入路径**，而作者没在 `InitLocalBuffers` 里同步删这 6 行，于是留下"死分支 + 过时注释（150-152）"。
- **不变式链条（重叠安全靠它，而不是靠分支）**：`ProcessVTiles`（1298-1306）的
  `for (v_i = 0; v_i < realV_; v_i += vStep_)` 只被 `ProcessChunk`（732）调用，而后者只在
  `ShouldSplitVTiles() == false` 分支里被 `Process`（239）调用；该分支 ⟺ `realV_ <= vStep_` ⟺
  **循环恰好一次**（`v_i = vStep_ >= realV_` 即退出）。切分分支走 `ProcessChunkVTile`（735-756），
  由 `v_i = vTileIdx * vStep_`（752）保证一次调用只做一片，**根本不进 `ProcessVTiles`**，
  故"scores 跨片存活"在终态不可能发生，重叠无条件成立。

---

## 5. 四桶总账：tmpBuff 随桶宽的成长是二次的

把 §3 三张子表按 `off` 顺序累加（单位字节，取 `dv = 桶宽` 的单片配置，故 `ak = stateStrideK_ = avStepAligned = 桶宽`）：

| 累加项 | 公式 | 64 桶 | 80 桶 | 96 桶 | 128 桶 |
| --- | --- | --- | --- | --- | --- |
| `chunkKFp32` + `kCumdecayFp32` | `2·cs·ak·4` | 32768 | 40960 | 49152 | 65536 |
| `decayMaskFp32` | `cs·cs·4` | 16384 | 16384 | 16384 | 16384 |
| `chunkVFp32` + `chunkAttnOutFp32` | `2·cs·avStep·4` | 32768 | 40960 | 49152 | 65536 |
| scores/state 重叠区 | `max(cs·cs, ak·avStep)·4` | 16384 | 25600 | 36864 | 65536 |
| `gCumsumFp32` | `cs·4` | 256 | 256 | 256 | 256 |
| `deltaFp32` | `max(max(ak,cs),avStep)·4` | 256 | 320 | 384 | 512 |
| `dotProductFp32` | `max(ak,cs)·4` | 256 | 320 | 384 | 512 |
| `expGCumFp32` | `cs·4` | 256 | 256 | 256 | 256 |
| `betaFp32` | `cs·4` | 256 | 256 | 256 | 256 |
| **tmpBuff 实占** | — | **99584** | **125312** | **153088** | **214784** |
| `stateOutQueue_`（§2） | `max(ak,cs)·avStep·2` | 8192 | 12800 | 18432 | 32768 |
| **UB 硬需求下界** | 两者之和 | **107776** | **138112** | **171520** | **247552** |

三点校验：

1. **80 桶 125312 与真机日志逐位一致**：记 `d0906c3e: dk=80, vStep=80, tbuf=125312`。这是 device 侧游标推导与 host 侧
   `ComputeTmpBuffBytes` 同构的直接证据。
2. **96 桶 153088 同样命中日志**： 记 `725cf45d: dk=80, vStep=96, tbuf=153088`
   ——那个 commit 还没有 80 桶，dk=80 落进 96 桶，`ak/stateStrideK_/vStep` 全部变 96。
   两行日志之差 `153088 − 125312 = 27776` **与 02 篇独立算出的 27776 完全相同**，
   其中重叠区一项就占 `36864 − 25600 = 11264`（41%）——**桶宽对 UB 的第二大开销不是 K/V tile，
   而是 scores/state 重叠区被 state 尺寸 `ak·avStep` 二次放大。**
3. **`SolveVStep` 的接受条件因此是本段的运行期上界**：只有
   `tbuf(vs) + outQueue(vs) ≤ ubSize` 成立 host 才会下发该 tiling（`tiling.cpp:185/194`），
   否则把 `vs` 以 16 为步长下调。**所以"UB 硬需求下界"这一行同时是"该桶在该平台能不能被选中"的判据**：
   128 桶 + `dv=128` 需要 ≥ 247552 B，若某代产品单核 UB 小于此，`SolveVStep` 会退到更小的 `vStep`，
   而 `IsCubeFastPath` 的 `vStepAligned_ == kSpecializedDk`（259）随即为假 → **Cube 整体静默关闭、
   退回 !1108 的 Vector 路径**。这条"UB 不够 ⟹ 桶自动降级为不用"的因果链，起点就在本段的 143 与 158。

**tmpBuff 的头部还有一笔"计划外复用"**（属于 10b 章，但只有本段能解释它从哪来）：

锚点：chunk_gated_delta_rule.h:2249-2253（区间外引用，非本章覆盖）

```cpp
      LocalTensor<float> cNz = chunkKFp32;
      if constexpr (kSpecializedDk <= 96) {
        // chunkK/kCumdecay/decayMask are dead after staging A. Their combined
        // contiguous UB region holds the complete 64/80/96-bucket NZ result.
        cNz = tmpBuff.GetWithOffset<float>(kStateElements, 0);
```

2250-2253 在 `if constexpr (kSpecializedDk <= 96)` 下把 NZ 落地板从 `chunkKFp32` 换成
`tmpBuff.GetWithOffset<float>(kStateElements, 0)`。逐项核对（模板实参 `kStateRows = kMatmulN = kSpecializedDk`
见 2096 行，`kStateElements = kStateRows·kMatmulN` 见 2110 行）：需要 `ak²·4` = 16384 / 25600 / 36864 / 65536
字节，可借的连续区 `2·cs·ak·4 + cs·cs·4` = 49152 / 57344 / 65536 / 81920 字节——**四个桶其实都装得下**
（96 桶余 28672）。

真正决定 `<= 96` 的不是 UB 容量而是 2104 行的 `kTileM = (kSpecializedDk <= 96) ?
kSpecializedDk : 64`：≤96 桶一次 `Mmad` 产出**整个** state，需要比 `chunkKFp32`（16384/20480/24576 B）更大的
落地板；128 桶按 64 行分片，每片 `kTileM·kMatmulN·4 = 32768` B 恰等于 `chunkKFp32`，于是走 2249 行的默认值。
**这是本段偏移算术被下游反向利用的唯一实例，也是"注释与代码顺序一致"救了一次场的地方。**

---
---

## 6. `ComputeAvgload`：负载度量与调度骨架的两处一致性要求

锚点：chunk_gated_delta_rule.h:205-215

```cpp
  __aicore__ inline void ComputeAvgload() {
    uint64_t realT = 0;
    for (uint64_t batch_i = 0; batch_i < B_; batch_i++) {
      int32_t seqLen = actualSeqLengthsGm_.GetValue(batch_i);
      if (seqLen > 0) {
        realT += static_cast<uint64_t>(seqLen);
      }
    }
    uint64_t workItemsPerHead = ShouldSplitVTiles() ? Ceil(realV_, vStep_) : 1;
    avgload_ = Ceil(realT * NV_ * workItemsPerHead, GetBlockNum());
  }
```

- **这是一次"运行期数据相关的 tiling"**：`actualSeqLengths` 是变长 batch 的真值，host 侧 `ParseShapeDims`
  只能拿到 `[T,H,D]` 的静态形状，**工作总量只能在 device 读 GM 才知道**。代价是 `blockDim` 个核各自做一遍
  `B_` 次 `GetValue`（每次一个 int32 标量 GM 读，无 `DataCopy`、走 `__gm__` 直接访存）：`B_=1` 时可忽略，
  `B_=64` 时每核 64 次标量读，且**所有核读的是同一段（≤256 B）地址**，实际会命中同一缓存行。
- 213-214 两行是**整个负载均衡的唯一"度量定义"**：分子 `realT * NV_ * workItemsPerHead` 必须与 `Process`
  里 `IsCurrentBlock` 累加的东西**逐项相等**，否则 `usedblk_` 会漂。三项核对：
  - 非切分分支（237-240）：每 batch 调 `NV_` 次、每次 `load_ += seqLen` ⟹ 总累加 `realT·NV_`；
    `workItemsPerHead = 1`（`ShouldSplitVTiles()` 与 213 是同一个纯函数、`realV_/vStep_` 内核内不可变）✔
  - 切分分支（230-235）：每 batch 调 `NV_ × vTileCount` 次，`vTileCount = Ceil(realV_, vStep_)` 与 213
    的表达式**逐字符相同** ✔
  - `seqLen <= 0` 的 batch：`Process` 在 223-226 提前 `continue`（不调 `IsCurrentBlock`）、`ComputeAvgload`
    在 209-211 跳过 ⟹ 两侧同时不计数 ✔
- **232 行 `IsCurrentBlock(seqLen)` 是有副作用的谓词**（342-350：`load_ += seqlen`、可能 `usedblk_++`），
  它必须**恰好被调用一次、且顺序与 `avgload_` 的推导同序**。这里写成放在两层循环最内层的
  `if (!IsCurrentBlock(seqLen)) continue;`，是"用 continue 保证单次调用"的紧凑写法；**任何人在这个循环里
  再读一次 `IsCurrentBlock` 都会破坏分派**。
- `avgload_` 是 `uint32_t`（2456）而右侧是 `uint64_t` 表达式，**存在一次隐式收窄**。溢出需要
  `realT·NV_·tiles > 2^32`；以 `NV_ ≤ 128`、`tiles ≤ 24` 计 `realT` 要超过 1.4M token，当前测试集最大 T 是
  几千量级——**不是现实风险，但这是一个没有注释的 64→32 截断**。
- `GetBlockNum()` 与 host 的 `SetBlockDim(min(workItems, aivNum))`（`tiling.cpp:318-322`）配对：若
  `workItems < aivNum` 则 `blockDim = workItems`，`avgload_ ≈ realT·NV_·tiles/blockDim` 让每核摊到 1 个工作项；
  **若某 batch 的 token 数恰好是 `avgload_` 的整数倍，边界工作项会被"挤"到下一个 `usedblk_`**
  （`load_ >= avgload_` 的 `>=` 判定）——这类"按累计量切段"分派的固有抖动，最多让一个核少/多拿 1 项。

---

## 8. `Process`：工作项模型一行没改

锚点：chunk_gated_delta_rule.h:216-246

```cpp
  __aicore__ inline void Process() {
    ComputeAvgload();
    int32_t seq0 = 0;
    for (uint64_t batch_i = 0; batch_i < B_; batch_i++) {
      int32_t seqLen = actualSeqLengthsGm_.GetValue(batch_i);
      int32_t seq1 = seq0 + seqLen;
      if (seqLen <= 0) {
        seq0 = seq1;
        continue;
      }

      if (ShouldSplitVTiles()) {
        uint32_t vTileCount = Ceil(realV_, vStep_);
        for (uint64_t head_i = 0; head_i < NV_; head_i++) {
          for (uint32_t vTileIdx = 0; vTileIdx < vTileCount; vTileIdx++) {
            if (!IsCurrentBlock(seqLen)) continue;
            ProcessHeadVTile(seq0, seq1, head_i, batch_i, vTileIdx);
          }
        }
      } else {
        for (uint64_t head_i = 0; head_i < NV_; head_i++) {
          if (!IsCurrentBlock(seqLen)) continue;
          ProcessHead(seq0, seq1, head_i, batch_i);
        }
      }
      seq0 = seq1;
    }
  }

 private:
```
