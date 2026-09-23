承接 03 篇（入口、协议镜像、构造与 GM 绑定），专讲**device 侧如何手工把 UB 切成 11 块**以及**变长批次如何按长度加权分到各核**；`IsCurrentBlock`（kernel.h:241 起）与 `ProcessHead` 之后的数值 phase 属下一篇。kernel.h:239 `ShouldSplitVTiles()` 严格说在本篇主区间之外，但 §2/§4/§5 三个调用点都离不开它，故在 §5 末以单行锚点有意重叠引用一次。

## 1. kernel.h:127-154 — InitLocalBuffers 上半：队列尺寸、布局注释与 off 游标

锚点：chunk_gated_delta_rule.h:127-154

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

- L127 签名：`void`，无参——所有输入都来自成员（`chunkSize_`/`alignK_`/`vStep_`/`restUbSize_`），这正是它必须晚于构造、并且只在 `Init` 里被调用一次的原因。
- L128-129 `cs`/`ak` 两个局部短名：下面 20 行里 `cs*ak`、`cs*cs`、`cs*avStepAligned` 反复出现，用全名会让每行都超出 120 列。它们与 host `ComputeTmpBuffBytes` 里的 `cs`（host tiling.cpp:131）同名同义，是两侧记账表能对上的一小处便利。
- L130 `avStepAligned = Ceil(vStep_, FP32_NUM_PER_BLOCK)*FP32_NUM_PER_BLOCK`：vStep 的 **FP32 块对齐**。`SolveVStep` 搜出来的 vStep 已经是 16 的倍数，所以这行恒等（host L130 同样恒等）；两边都写出来是"把不变量显式化"的同一手法。
- L131 `vStepAligned_ = avStepAligned;`：把局部量存成成员。这一步不是多余的：`WriteAttnTileToGm`（L407/427）、`stagingCapacity` 计算（L448/536）等十几处都要用它，而**它们运行在 `Process` 阶段、拿不到这里的局部变量**。同时它的存在意味着"device 侧对齐后的 V 行宽"只有一个真值来源，避免各处重新 `Ceil` 一次。
- L133 注释：出向队列取"state tile"与"紧凑 chunk 输出"两者的 max。
- L134 `stateTileBytes = stateStrideK_ * avStepAligned * sizeof(outType)`：注意用的是 **`stateStrideK_`（dk 的 FP32 对齐宽度）而不是 `alignK_`**——出向 state tile 的行数是 k 方向的 `stateStrideK_`，列宽是 `avStepAligned`，元素是 FP16（`outType`）。与 host `ComputeOutQueueBytes` 的 `stateBytes`（host tiling.cpp:154）**逐因子一致**。
- L135 `chunkOutBytes = cs * avStepAligned * sizeof(outType)`：注意力输出 tile `[chunkSize, vStep]`，同一个队列复用（两个消费点是 L347 与 L900）。也与 host 的 `chunkBytes`（host tiling.cpp:155）一致。
- L136-137 `outQueueBytes = max(...)`：写成"先赋后 `if` 比较"而不是三元表达式，且 `if` 体不带花括号——这是仓库风格允许的单语句形式（同一模式的压缩版见 host L145）。为什么取 max 合法：`BUFFER_NUM = 1`（03 篇 §13）意味着队列里同一时刻只有一块数据，两类出向数据从不同时在场。
- L138 `pipe_->InitBuffer(stateOutQueue_, BUFFER_NUM, outQueueBytes)`：向 TPipe 申请一段 VECOUT 队列。三参数分别是队列对象、缓冲块数、**每块字节数**。`QuePosition::VECOUT`（L929）决定这块 UB 归"Vector 算完 → MTE3 搬出"这条链路使用，队列自带 V↔MTE3 的同步语义；与之相对，`TBuf<TPosition::VECCALC>`（L930）是纯计算暂存区，**不参与任何流水同步**，跨流水使用必须手写 `PipeBarrier`——本文件里那几十处 `PipeBarrier<PIPE_V>()` 就是这个区别的代价。

- L140-152 **十三行布局注释**，是 `tmpBuff` 的"分区表"，也是本 kernel 内存布局的人类可读真值。逐条注意：
  - 标题写明 `(all FP32)`：这一段切片里所有元素都是 `float`，因此后面每处 `off` 推进都是 `* sizeof(float)`。
  - 注释给出的顺序 = 代码 `off` 推进的顺序（chunkK → kCumdecay → decayMask → chunkV → scores/state → chunkAttnOut → gCumsum → delta → dotProduct → expGCum），这与 host 求和式的书写顺序**不同**（host 把 `2*vTileBytes` 放在 decay 之后、gCum 在末尾之前，02 篇 §9 已对照）。总量相同即可，顺序无需一致——因为 host 只提供预算、不做切片。
  - `chunkScoresFp32 / stateInFp32` 那三行（L145-147）把"单 tile 重叠、多 tile 分开"的判定连同理由写进注释，这是全篇唯一在代码里解释生命周期复用为何合法的地方，与 §2 的分支一一对应。
  - `deltaFp32: max(dkAlignedFp32, cs, vStepAligned)` / `dotProductFp32: max(dkAlignedFp32, cs)`：注释里的 `dkAlignedFp32` 在代码里就是 `stateStrideK_`，命名不完全一致（注释写作"dk 的 FP32 对齐"，代码用变量名 `stateStrideK_` 表达同一件事），读时需要在心里做一次改名。
- L153 `pipe_->InitBuffer(tmpBuff, restUbSize_);`：**两参数**重载，把"UB 剩余全部"划成一块 VECCALC。`restUbSize_` 来自 host 的 `ubRestBytes = ubSize - outQueueMax`（02 篇 §11 L187）。注意"先 InitBuffer 队列、再 InitBuffer tmpBuff"的先后是**有意的顺序**：TPipe 按调用顺序从 UB 池里划地址，tmpBuff 拿后面的全部余量，于是两段内存天然不重叠；反过来的话 `restUbSize_` 就会盖住已划给队列的区域。
- L154 `uint32_t off = 0;`：**字节游标**，指向"下一个切片在 tmpBuff 里的起始字节"。它是后面 20 行的唯一状态，也是本函数唯一值得逐行核对的变量（§2-§3 会把它走完 214528 字节）。类型 `uint32_t` 够用：UB 只有百 KB 量级。
- L155（下一节首行）空行。

## 2. kernel.h:155-178 — tmpBuff 切片中段与 scores/state 重叠分支

锚点：chunk_gated_delta_rule.h:155-178

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

- 每次切片的写法都是一个模板：`GetWithOffset<float>(元素数, off)` 取一张从 `off` 起、容量 `元素数 × 4` 字节的 `LocalTensor<float>`，紧接着 `off += 元素数 * sizeof(float)` 把游标推到下一块起点。`GetWithOffset` 第一个实参是**元素个数**、第二个（引用传入的）`off` 是**字节偏移**，"元素 vs 字节"两套单位在同一段代码里紧挨着出现，是本函数最经典的一处踩坑面；本文件里 `off` 必须由调用方手动推进（同一种写法亦见 !1140 的 RGDR，`src/96ea3f55/op_kernel/recurrent_gated_delta_rule.h:229-236`），若某版 CANN 头让 `off` 自动前移，这里会推进两倍、`expGCumFp32` 直接越过 `restUbSize_` 尾界——升级 CANN 时这一片是必检项。`GetWithOffset` **不做越界检查**，写超只会在运行期以数据错乱或 DMA 异常的形式暴露。
- L156-157 `chunkKFp32`：`cs * ak`（64×128 = 8192 元素 = 32768 字节），装原始 K。
- L159-160 `kCumdecayFp32`：**同尺寸的第二块**（32768 字节），装 `k_beta → k_cumdecay`。两块同尺寸正是 host 侧 `kPairedTileCount = 2` 的物理来源（02 篇 §3），而"为什么要两块而不是原地覆盖"：K 的原值在整个 chunk 的多个 phase 里被反复读（算 scores、算 delta 修正），而 k_cumdecay 只在 attn 修正阶段用，两者生命周期重叠，不能原地。
- L162-163 `decayMaskFp32`：`cs*cs`（64×64 = 4096 元素 = 16384 字节），chunk 内下三角累积衰减掩码。按满矩形而不是三角形计费，因为它是被 `Muls`/`Duplicate` 整块向量化的，矩形布局才有对齐语义。
- L165-166 `chunkVFp32`：`cs * avStepAligned`（64×128 = 32768 字节），V 的原值，之后被就地改写成 v_new。
- L168 **分支条件 `vStep_ >= realV_ || ShouldSplitVTiles()`**：device 侧的"能否重叠"判定，与 host 的两处判据（`overlapScoresState = vs >= dv || allowScoresStateOverlap`，host tiling.cpp:144；`allowScoresStateOverlap = dims.hv < aivNum`，host tiling.cpp:254）**同形**，区别只在第二个取定理由：device 用 `GetBlockNum() > NV_`（L239）而不是"头数小于核数"。两侧等价性的完整证明见 02 篇 §9.2；这里只补一条本地事实：**这个分支决定 `off` 走哪条路**，一旦与 host 的预算判断不一致，就会发生"host 按重叠预算、device 按不重叠花销"（→越界）或反向（→浪费 UB 让 vStep 被无谓压小）。这是全套双份记账里最脆弱的一根针。
- L169 `overlapSize = max(cs*cs, stateStrideK_*avStepAligned)`：**以字节前单位（元素数）取 max**，等价于 host L145 的 `max(tScores, tState)`。为什么必须取 max 而不是 scores 的尺寸：两块逻辑缓冲共用起点，预留区必须容得下较大者，否则下一块（`chunkAttnOutFp32`）会盖进较大者的尾部。
- L170-171 **同一个 `off` 连用两次、只推进一次**——这两行就是"生命周期复用"的字面编码：`chunkScoresFp32` 与 `stateInFp32` 是**同一段内存的两个名字**。风险被 L145-147 那三行注释给出的条件锁住：scores 的最后一处读（`ComputeValueNew` 阶段）必须早于 state 的第一次写（`LoadStateTile`），否则 scores 会静默变成 state 的前缀字节。
- L172 `off += overlapSize * sizeof(float)`：本分支只推进一次。
- L173-178 else 分支：scores 与 state 各占独立区、`off` 推进两次（16384 + 65536 = 81920 字节）。注意两个分支里 `stateInFp32` 的**元素数都是 `stateStrideK_*avStepAligned`**（不是 overlapSize），即重叠分支下它的"容量"小于所占用预留区的前段；这是安全的（尾部空着没人写），但也说明 overlap 区的大小语义是"预留"，不是"两个张量各自的逻辑尺寸"。
- 小结（数值，取 B=1,H=16,T=128,dk=dv=128,cs=64,vStep=128 → ak=128,avStepAligned=128,stateStrideK_=128）：`off` 到这里为 32768+32768+16384+32768+65536 = **180224**（重叠）或 **196608**（分开）。

## 3. kernel.h:179-195 — tmpBuff 切片尾段与游标收尾

锚点：chunk_gated_delta_rule.h:179-195

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
  }
```

- L180-181 `chunkAttnOutFp32`：与 `chunkVFp32` 同尺寸的**第二块 V 侧 tile**（32768 字节），对应 host 的 `2 * vTileBytes`。为什么 V 侧也要两块：`chunkVFp32` 被就地演进成 v_new 并要跨 phase 存活，而 attn 输出必须另开一块避免覆盖输入。
- L183-184 `gCumsumFp32`：`cs`（64 元素 = 256 字节），chunk 内 g 的前缀和。它是标量路径的产物（每个位置一次 `ScalarExp` 相关运算），长度只有 64，因此是全片最小的两块之一。
- L186-187 两个尺寸的**就地重算**：`dotProductSize = max(stateStrideK_, cs)`、`deltaSize = max(dotProductSize, avStepAligned)`，与 host tiling.cpp:137-138 的两行 `?:` 逐项同构（连"手写 max 而不引 `<algorithm>`"的取舍都一样）。语义：`dotProductFp32` 是点积展开的乘积暂存，一次要装"state 的一整行"或"K 的一整行"，两者取大；`deltaFp32` 是更通用的单行 scratch，还要再盖住 V 侧行宽。
- L188-189 `deltaFp32`、L191-192 `dotProductFp32`：两个小片（本例各 512 字节），顺序是 delta 在前、dotProduct 在后。注意它们与 L183 的 `gCumsumFp32` 三块**逻辑上互不相干、只是同属"小尾巴"**，尺寸靠 max 而不是精确值，说明作者宁可多留一点，也不愿在这些行上再做一轮生命周期分析。
- L194 `expGCumFp32 = tmpBuff.GetWithOffset<float>(cs, off);`：**没有随后的 `off +=`**。今天无害（它是最后一块，`off` 之后不再被读），但它是一颗明确的种子：将来在 L195 之前追加任何一块新缓冲，新块会**静默与 `expGCumFp32` 重叠**（因为 `off` 还停在它的起点），而 host 侧的求和式里也得补一项，两侧各错一半、症状是 exp(g) 被踩。这类"最后一项省一步"的写法在评审里值得单拎出来。
- L195 `}`：`InitLocalBuffers` 结束。
- 全函数走完的总用量（重叠分支，本例）：`180224 + 32768 + 256 + 512 + 512 + 256 = ` **214528 字节**，与 host `ComputeTmpBuffBytes(128,128,64,128,128,true)` 的返回值 214528 **精确相等**（02 篇 §9.1 的同一组数）；不重叠分支 device 走 196608+33024 = 230912 = host 的 230912。**两侧记账在本 commit 完全闭合，且余量为 0**——因为 `restUbSize_ = ubSize - outQueueMax ≥ tbufTotal` 的等号在 vStep 取到"刚好放得下"的那一档时成立。这意味着 tmpBuff 的 `off` 一旦算错，越界就是越出 UB 边界本身，而不是踩到队列。

## 4. kernel.h:196-208 — ComputeAvgload：长度加权的工作配额

锚点：chunk_gated_delta_rule.h:196-208

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

- L196 空行。L197 签名：`void`、无参，唯一副作用是写 `avgload_`（L206）——它必须在 §5 的第一次 `IsCurrentBlock` 之前完成，所以 `Process` 的第一句就是它。
- L198 `uint64_t realT = 0;`：全 batch 的**真实** token 总数（不含 pad），选 `uint64_t` 是因为 `B_ × T` 在长序列下可以超过 `uint32_t`（虽然本 kernel 的 T 上限远不到），更重要的是 L206 的乘法 `realT * NV_ * workItemsPerHead` 要留在 64 位域里算。
- L199-204 逐 batch 累加：`actualSeqLengthsGm_.GetValue(batch_i)` 是**标量 GM 读**（`GlobalTensor::GetValue`，机器语义是直接一次访存，走的是 S 标量流水，不经 Vector DMA）。它的成本是每次一个 cache/内存往返，B 通常 ≤ 8，所以整段是"可忽略的标量前戏"。
- L201-203 `if (seqLen > 0)` 才累加，配合 `static_cast<uint64_t>(seqLen)`：先判正再转，避免负数被转成巨大无符号值污染 `realT`。同一判据在 §5 里也用来跳过空 batch（L215），两处一致。
- L205 `workItemsPerHead = ShouldSplitVTiles() ? Ceil(realV_, vStep_) : 1`：**每个 head 的 V-tile 数**，只在分核拆 V 时 >1。注意它用的是 `Ceil(realV_, vStep_)`（向上取整的商），也就是 §5 中内层 `vTileIdx` 循环的**上界**，两处必须同式（L221 又算了一次 `vTileCount = Ceil(realV_, vStep_)`）。同一表达式在三个函数里各写一遍（`ComputeAvgload`、`Process`、以及 host 的 `vTileCount`）——这是"没有共享 helper"带来的三份拷贝，改一处必须改三处。
- L206 `avgload_ = Ceil(realT * NV_ * workItemsPerHead, GetBlockNum())`：**每核应得的工作配额**，单位是"token×head×Vtile 计数的加权和"。分子是全局总工作量（长度加权：一条 seqLen 的 batch 贡献 `seqLen × NV_ × workItemsPerHead`），分母是实际核数。取 `Ceil` 保证配额偏大而非偏小——偏大意味着**尾部核拿不满**（少数核空闲，正确性无损），偏小则会导致后面的 batch 无核认领（直接算错）。这个方向的不对称正是选 `Ceil` 的理由。
- 一个可核对的一致性：`Process` 里 `IsCurrentBlock` 每个工作项调用一次、每次给 `load_` 加 `seqlen`（L242-244）。于是所有核上的总累加 = `Σ_batch seqLen × NV_ × (分 V 时的 tile 数)`，与 L206 的分子**逐项相同**。两种分支都成立：非分 V 时 `workItemsPerHead = 1` 且内层只循环 `NV_` 次；分 V 时它是 `vTileCount` 且内层循环 `NV_ × vTileCount` 次。配额与实际工作量同源，这是这套手写装箱能收敛的前提。
- 为什么这段逻辑在 device 而不在 host：`actual_seq_lengths` 是**运行期数据**，tiling 阶段读不到（def.cpp 里它是 REQUIRED 输入张量而非 attr，01 篇 §4）。这就是 `DynamicShapeSupportFlag(true)` + 变长支持的全部内容：结构参数（B/H/Dk/Dv/chunkSize/vStep）走 tiling 协议下发，长度分布走 GM 由每个核自己扫一遍再算配额。代价是每核多做一次 O(B) 的标量访存循环。
- L208 `}`。

## 5. kernel.h:209-238 — Process：变长批次的主循环与两个分派分支

锚点：chunk_gated_delta_rule.h:209-238

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

- L209 签名：无参、无返回；入口 L35 调它一次。
- L210 `ComputeAvgload();`：**必须是第一句**。`IsCurrentBlock` 依赖 `avgload_`（L244），若配额未算出来就进循环，比较会拿未定义值（虽然 §17 已把它清零，清零的后果是"第一条 seqLen 就把 `load_ >= 0` 判真、核 0 认领所有工作项"，静默变成单核串行）——先算配额这一点是"顺序即正确性"的例子。
- L211 `int32_t seq0 = 0;`：**打包式变长布局的游标**。本算子的 query/value 形状是 `[T, H, D]`，T 是**所有 batch 拼接后的总长**（01 篇 §9 的 `kDimT` 与 `dims.t` 同义），没有 batch 维 stride。于是"batch b 的序列在 GM 里占 `[seq0, seq1)` 行"，`seq0` 就是这段累加前缀和。用 `int32_t` 与 def 里 `actual_seq_lengths` 的 INT32 保持同一宽度，`seq1 = seq0 + seqLen` 也不会跨到无符号域。
- L212-213 外层 batch 循环 + 再读一次 `seqLen`。这里**重新读**而不是复用 §4 循环里的值，是因为 ComputeAvgload 的局部变量已出作用域；代价是每个 batch 多一次标量 GM 访存（同一个地址，几乎必然命中缓存），换来的是两个函数完全无共享状态。
- L214 `seq1 = seq0 + seqLen;`：区间右端。注意它**在 `seqLen <= 0` 判断之前**就算出来，所以下面跳过分支里的 `seq0 = seq1` 在 `seqLen == 0` 时是恒等赋值，而在 `seqLen < 0`（非法输入）时会让游标倒退——这是"把负长度当 0 处理"的宽松选择，不校验但也不崩。
- L215-218 空序列快跳：`continue` 前**必须**推进 `seq0`，否则后续 batch 的起点会错位（写成 `seq0 = seq1; continue;` 两行而不是 `continue;` 一行，正是这个不变量的显式表达）。空 batch 也**不消耗** `IsCurrentBlock` 计数——这是关键：装箱状态 `load_/usedblk_` 只在"确有工作项"时推进，与 §4 分子的 `seqLen > 0` 过滤严格对应，两侧同一条判据。

- L220 `if (ShouldSplitVTiles()) {`：两个分派分支的唯一开关（定义在 L239，见下方单行引用）。它在这里、在 L205、在 L168 各判一次，三次结果必然相同（`realV_`/`vStep_`/`GetBlockNum()`/`NV_` 全是构造期定下的常量），所以不是"竞态式的不一致"，只是三处重复。
- L221-227 **head × V-tile 二级循环**：外层 `head_i < NV_`（value 头）、内层 `vTileIdx < vTileCount`，工作项编号的全序是 `(batch, head, vTile)`。`ProcessHeadVTile(seq0, seq1, head_i, batch_i, vTileIdx)` 只处理该 head 在 V 方向第 `vTileIdx` 段的列：写 `attnOutGm_` 的列切片、读写 workspace 里对应的行段，因此**不同核写不同地址、不需要任何同步**（02 篇 §15 那句"these tiles write disjoint output/state ranges"就是这个意思）。
- L224 / L230 `if (!IsCurrentBlock(seqLen)) continue;`：**本章覆盖的终点，也是"调用点"**。要点只有三条，其余留给下一篇：
  1. `IsCurrentBlock` **有副作用**（推进 `load_`，必要时推进 `usedblk_` 并复位 `load_`），所以它"每个工作项恰好调用一次、且所有核上的调用次序全局一致"是装箱成立的充分必要条件。任何重构（把 `!IsCurrentBlock` 判断提到外层、把 `continue` 改成 `if (IsCurrentBlock(...))` 包裹、或者在分支前加早退）都必须保持"每个工作项一次"的形状——这行 `continue` 的写法看似朴素，其实是被这一约束锁死的。
  2. 传进去的是 `seqLen` 而不是 1：装箱按**长度加权**，一条 512 长的序列比 16 条 8 长的序列占更多配额，对应 §4 分子里的 `realT = Σ seqLen`。
  3. 判假时只是 `continue` 掉一个工作项，不改变 `seq0/seq1`——外层游标与工作项归属是两条独立的线。
- L228-233 非分 V 分支：只按 head 循环，调 `ProcessHead(seq0, seq1, head_i, batch_i)`——一个核拿到整个 head，内部自己按 V-tile 串行（对应 §2 else 分支里 scores 与 state 不重叠的布局）。两个分支的工作项数量之差（`NV_` vs `NV_*vTileCount`）已被 L205 的 `workItemsPerHead` 吸收。
- L234 `seq0 = seq1;`：batch 游标推进（正常路径）。L235 内层结束、L236 `}` 结束 `Process`。整个 `Process` 只做四件事：算配额、维护打包游标、按 (batch, head[, vTile]) 三重全序枚举工作项、问一句"这活归不归我"。真正的数值计算全在 `ProcessHead/ProcessHeadVTile` 及其下游的 phase 函数里，本篇到此为止。
- L237 空行。L238 ` private:`：**接口边界就落在这里**——`Process` 之上（L101 `Init`、L108 `SetGlobalTensors`、L127 `InitLocalBuffers`、L197 `ComputeAvgload`）都写成 `public`，实际被入口调用的只有 `Init` 与 `Process`，其余 public 方法是为了让单测/调试能单独驱动某一步；`private` 之后才是真正的实现细节（L239 起的 `ShouldSplitVTiles`、`LoadG`、`ScalarExp`、`DotFp32`、`ProcessHead` 等）。本篇区间恰好在 `private:` 之前结束，不是巧合而是"骨架 / 细节"的自然分界线。

单行引用（有意重叠，正式解析见下一篇）：

锚点：chunk_gated_delta_rule.h:239-239

```cpp
  __aicore__ inline bool ShouldSplitVTiles() { return realV_ > vStep_ && GetBlockNum() > NV_; }
```

- 这一行是本篇里三个调用点（L168、L205、L220）的共同开关：**V 维真的需要多 tile**（`realV_ > vStep_`）**且核比 head 多**（`GetBlockNum() > NV_`）才拆。它是 host `dims.hv < aivNum && vTileCount > 1`（host tiling.cpp:272）的 device 侧等价式，两个条件各挡一种无益拆分：前者挡"本来就一 tile 装下"，后者挡"拆了也没核去跑、反而拉长串行链"。
