# 03 · state 池寻址与 decode 语义

> 横切视角：本篇不换行域，只把 `02`/`02b` 已覆盖的代码按"状态池"这条线重排。
> **本篇不重复 `02`/`02b` 的整段引用块**，只引 1~3 行关键式子并标锚点。

## 1. 结论先行

1. `state` 不是"每序列一个状态"，而是**一个可随机寻址的状态池**：
   首维 `sBlockNum` 是槽位数，与 batch 数 `b` **无必然关系**
   （`tiling.cpp:167` 取 `sDims.GetDim(0)` 写入 `:277`）。
2. 池的寻址索引来自第三个 decode 专用输入 `ssm_state_indices`，
   它**按 token 索引**（长度与 `cu_seqlens` 同为 `b`，见 §5 的反例），
   于是"第 t 个 token 的状态落在哪个槽"完全由外部图决定，kernel 只做被动查表。
3. **读槽与写槽不同源**：读槽在 batch 头算一次并受 `num_accepted_tokens` 回退（`:296-303`），
   写槽在 token 循环里逐 token 算（`:570`）。这条不对称就是投机解码回退的全部实现。
4. 回退**只影响读**，因此在"读槽 == 上一个已接受 token 的槽"这一约定下，
   被拒绝草稿写入的槽**仍然会被覆写**——回退的语义是"从正确的起点重算"，
   不是"撤销写入"。§4 的表把这四种取值的落点全部列出。
5. `ssm_state_indices` 的 int32/int64 双绑定（`:205-206`、`:319-324`）**不是为了大索引**，
   而是为了接住上层图默认产出的 int64，省掉一个 cast 算子（§3）。

## 2. 池的线性地址式

全快照里出现状态池地址的地方只有三处，把它们的式子并排放（`02`/`02b` 已逐词照抄，此处只列式）：

| 用途 | 锚点 | 式子 |
|---|---|---|
| 读源（首片） | `:596` | `(stateOffset * NV_ + head_i) * realV_ * realK_` |
| 读源（后续片） | `:604` | 上式 `+ nextVOffset * realK_` |
| 写目标 | `:570` | `(GetSsmStateIndex(seq_i) * NV_ + head_i) * realK_ * realV_ + v_i * realK_` |

三点观察：

1. **三个式子同构**：`槽号 × (NV_ × realK_ × realV_) + head_i × (realK_ × realV_) + v × realK_`。
   即池的布局是 `[sBlockNum, NV, DV, DK]`（最内层 `DK` 连续）。
   这与 def 侧 `state` 的 4 维声明一致（`recurrent_gated_delta_rule_def.cpp:43`，
   `01` 篇 §2），也与 infershape 把 `stateOut` 逐维照抄 `state` 的做法一致
   （`…_infershape.cpp:47-50`，`01` 篇 §3）——**输出形状 = 输入形状 = 池形状**，
   所以 `state_out` 天然是"同池写回"，in-place 更新零成本。
2. **`:570` 把 `realK_ * realV_` 写成 `static_cast<uint64_t>(realK_) * realV_`，
   而 `:596` 写成 `static_cast<uint64_t>(realV_) * realK_`**——同一物理量、两种乘序、
   两种 `static_cast` 位置。乘序无差（都是 64 位乘），但两处**只有一个地方 cast 了 `realK_`**：
   `:596` 的 `* realK_` 尾巴是 32 位乘（`static_cast<uint64_t>(realV_) * realK_` 的结果已是
   `uint64_t`，所以实际上仍是 64 位）。逐字符核对后确认两者均不会溢出到 32 位截断，
   但**写法不一致会让后来人误以为其中一处不安全**从而"顺手统一"，反引入错误。
3. `:604` 的偏移是 `nextVOffset * realK_`（元素计），而 `PrefetchState` 的形参名拼作
   `stateOffest`（`:382`）——它是**元素偏移**而非字节偏移，
   因为最终落到 `initStateGm_[stateOffest]`（`:387`、`:392`），
   `GlobalTensor::operator[]` 按元素解释。命名丢掉 `Elem` 后缀是一处可读性缺陷。

## 3. `ssm_state_indices`：双 dtype 绑定的真实动机

`02` 篇 §10 给出绑定点（`:205-206`），本篇给出为什么。

`GetSsmStateIndex`（`:319-324`，全录见 `02a` 篇 §3）把 int64 路径的结果
`static_cast<int32_t>` 截断。截断安全的前提是"槽位数 < 2³¹"，
而 `sBlockNum × NV × DK × DV × 2 字节` 早在远小于 2³¹ 时就把池撑爆物理内存，
所以**int64 分支在实践里永远不会给出需要 64 位的值**。它存在的唯一理由是：

- def 侧把 `ssm_state_indices` 注册为**双 dtype**（`recurrent_gated_delta_rule_def.cpp:53` 起的
  dtype 列表含 `INT32` 与 `INT64`，`01` 篇 §2）；
- mindspore-lite 的图里，索引类张量常由 `arange`/`gather` 产出而默认 int64；
- 若 kernel 只绑 int32，runtime 会插一个 cast 算子，decode 每步多一次全量搬运。

dtype 的判定发生在 host 的 `GetIndexTypes`（`tiling.cpp:209-220`，`01b` 篇 §4.3），
写进 `ssmStateIndicesIsInt64`（`tiling.cpp:289`，`01b` 篇 §7），kernel 在 `:171` 读回。
`01b` 篇 §4.3 已记：那里用 `GetInputTensor(...)->GetDataType()` 而非 `GetInputShape`，
因为要的是 dtype 不是形状。**这条 host→kernel 的 dtype 通道是 RGDR 与 CGDR 的一个显著差异**：
CGDR 的索引类型固定，
RGDR 因为要接住 speculative decode 的槽位索引才引入双绑。

## 4. 读槽 / 写槽 / 回退：四行代码的全部语义

`Process` 里的读槽计算（`02` 篇 §13.3 全录 `:287-306`，此处只截 4 行）：

```cpp
          int32_t stateTokenIdx = seq0;
          if (hasAcceptedTokens_) {
            int32_t acceptedTokenNum = numAcceptedTokensGm_.GetValue(batch_i);
            if (acceptedTokenNum > 0 && acceptedTokenNum <= seqLen) {
```

写槽计算（`02b` §6.1 全录 `:564-571`，此处只截 1 行）：

```cpp
        (static_cast<uint64_t>(GetSsmStateIndex(seq_i)) * NV_ + head_i) * static_cast<uint64_t>(realK_) * realV_ +
```

`num_accepted_tokens` 的四种取值，在 `seqLen = 4`（草稿 4 个 token）下的行为：

| `acceptedTokenNum` | `:299` 条件 | `stateTokenIdx` | 读槽来源 | 语义 | 本步写入的槽 |
|---|---|---|---|---|---|
| 未提供（`hasAcceptedTokens_==false`） | 不进入 | `seq0` | `GetSsmStateIndex(seq0)` | 普通 decode | `idx[seq0] … idx[seq0+3]` |
| `0` | `> 0` 假 | `seq0` | 同上 | **全部草稿被拒**，从上一状态重算 | 同上（覆写 4 个槽） |
| `1` | 真 | `seq0 + 0` | 同 `seq0` | 只接受第 1 个草稿 | 同上 |
| `4`（`= seqLen`） | 真 | `seq0 + 3` | `GetSsmStateIndex(seq0+3)` | 全部草稿已在上一步落库 | 同上 |
| `5`（`> seqLen`） | `<= seqLen` 假 | `seq0` | 同 `seq0` | 越界输入被**静默降级**为"全拒" | 同上 |

关键结论，逐条：

1. **`stateTokenIdx` 只在 `copyFlag == 1` 分支里算一次**（`:295`），
   即**每核每 batch 一次**，与 head 无关。这是正确的：`ssm_state_indices` 按 token 索引，
   不含 head 维。但也因此，如果某个核分到的 head 里没有 `stateTokenIdx` 需要的那个 token
   （例如分片错位），它仍然读同一个 `stateOffset` —— **读槽是 batch 级共享量**。
2. **写槽永远从 `idx[seq0]` 起逐 token 递增**（`:570` 用 `seq_i`，`seq_i` 从 `seq0` 到 `seq1-1`）。
   看 `acceptedTokenNum == 4` 这一行：读槽 = `idx[seq0+3]`（第 4 个草稿的状态），
   写槽 = `idx[seq0] … idx[seq0+3]`。**`idx[seq0+3]` 既是读源又被本步覆写**。
   如果全部草稿已被接受，本步其实只需处理第 5 个（新）token，但接口上没有"跳过前 4 个"的机制
   （`seqLen` 仍为 4，`:281-283` 只看 `seqLen`），所以会**把已接受的前 3 个 token 重算一遍并覆写它们的槽**。
   重算的结果与已存的一致（同输入同状态转移），**数值上不产生错误**，
   但前提是 `state` 里前 3 个槽的值恰好是上一步写入的同一结果。
   **这构成一处隐式契约：`ssm_state_indices` 必须与本步 token 一一对应，且前缀部分重复写入幂等。**
   快照内没有任何注释说明这一点，`docs/PR-1140-96ea3f55/` 的接口叙述亦未展开（本报告的判断）。
3. **`acceptedTokenNum > seqLen` 被静默降级**（`:299` 的 `<= seqLen`）。
   没有 `return`、没有错误码，直接按"全拒"处理。
   与 `:281-283`（`seqLen > MAX_MTP` 时 `return`）形成对比：
   **越界的 seqLen 会让整个 block 静默罢工，越界的 acceptedTokenNum 只被钳制。**
   两种"防御"风格不一致，说明 `:299` 是刻意宽容（宁可用错值也别整体崩）。
4. **`numAcceptedTokensGm_` 恒 int32**（`:207`、`:625`，`02` 篇 §10），无双绑。
   它的 def 注册在 `recurrent_gated_delta_rule_def.cpp:68`（`01` 篇 §2），
   形状 `[b]`。`GetValue(batch_i)`（`:298`）是**按 batch 索引的标量读**，
   所以这个输入不占用 UB、不进任何队列，是纯粹的"控制流输入"。

## 5. `cu_seqlens` 与 `ssm_state_indices` 的耦合：一个未澄清点

`GetShapeDims`（`tiling.cpp:161-174`，`01b` 篇 §4.1）把 `b` 定义为 **`cu_seqlens` 的元素个数**：

```cpp
  dims.b = cDims.GetDim(0);
  if (dims.b == 0) {
    dims.b = 1;
  }
```

而 kernel 里 `GetSsmStateIndex(stateTokenIdx)`（`:303`）与
`GetSsmStateIndex(seq_i)`（`:570`）的入参是**全局 token 序号**（`seq0 … seq1-1`，
`seq0` 由 `:271-276` 累加得到，可远大于 `b`）。
所以：

- **`ssm_state_indices` 的长度必须 ≥ `T_`（总 token 数），而不是 `b`**；
- 但 host 侧 `GetOptionalInputs`/`GetShapeDims` 都**不读它的长度**
  （`tiling.cpp:187-207` 只用元素数判 `gk` 的标量/向量，`:209-220` 只读 dtype），
  即**没有任何一处校验 `len(ssm_state_indices) ≥ T_`**。

结论：`ssm_state_indices` 与 `cu_seqlens` 的长度语义在快照内是**不对称且未校验**的——
`cu_seqlens` 长 `b`、`ssm_state_indices` 长 `T`，而 `b` 恰恰是从 `cu_seqlens` 的长度推出来的。
`:284-286` 的守卫保证了 `seq1 ≤ T_`，但没有保证 `idx` 数组够长。
越界读 GM 是这里唯一的失效模式，且 `GetValue`（`:323`）不会检查。

这条与 `02` 篇 §5.4 的"尾部多写"同类：**只能证到"代码内不自证安全"，
真机验证记入 `00` 篇「未做」**。它在 decode 常态（`b == T`，每样本 1 token，
或 MTP 下 `T = b × seqLen`）下是否触发，取决于上层是否按 `T` 长度给 `ssm_state_indices`。

## 6. `sBlockNum`：写了但没人读

`tiling.cpp:167` 取 `sDims.GetDim(0)` → `:277` 写进 tilingData。
kernel 侧 `RecurrentGatedDeltaRuleTilingData` 有该字段（`tiling_data.h`，`01` 篇 §4），
但 `RGDR` 的构造函数字段读取清单（`:158-175`，`02` 篇 §8）**不含它**——
全文件 `grep` 无 `sBlockNum` 消费点。

所以它是**纯透传字段**（host 算了、写进 tiling 结构体、kernel 不读）。
它进入 `sizeof(TilingData)` 因而占 tiling 空间（`01b` 篇 §8.5），
除此之外无功能。它的存在暗示曾计划用池容量做守卫（例如校验 `stateOffset < sBlockNum`），
而终态没做——这正是 §5 缺的那道检查。

**判定：`sBlockNum` 是"预留而未兑现的防线"**，与本篇 §5 的越界读风险成对阅读。

## 7. in-place 别名：`state` 与 `state_out` 可以是同一块

`SetGlobalTensors` 把 `initParams.initState` 绑到 `initStateGm_`（`:202`）、
`initParams.finalState` 绑到 `finalStateGm_`（`:208`），两者可以是同一 GM 地址
（infershape 逐维照抄，`:47-50`，正是为 in-place 准备的）。

**同一槽会不会"读之前先被写坏"？** 在本快照的调度下不会，理由链：

1. 读发生在 `PrefetchState`（`:387`/`:392`，MTE2 读 `initStateGm_`），
   写发生在 `CopyOutState`（`:488`，MTE3 写 `finalStateGm_`）。
2. 对**同一个 v 分片**：`ProcessSequenceChunk`（`:558-585`）内是
   token0 → token1 → … → token(seqLen-1) 顺序，读只在分片进入前做一次
   （`LoadPrefetchedState:397`），之后 `Compute` 全程操作 `stateInUb`（UB 副本）。
3. 因此**写入目标槽 `idx[seq_i]` 之前，源槽 `idx[stateTokenIdx]` 一定已经完整读进 UB**。
   唯一要防的是"写 `idx[seq0]` 与读 `idx[seq0+3]` 并发"——
   但读只发生一次且在 `:600` 就 `FreeTensor` 了源队列槽，`Compute` 不再碰 GM。
4. **跨 head 无冲突**：槽内布局 `[NV, DV, DK]`，写 `head_i` 只动自己那段。
5. **跨核无冲突**：分片键 `batch_i * NV_ + head_i`（`:290-292`）保证同一
   `(batch, head)` 只被一个核处理；而 `head_i` 段在槽内互不重叠。
   **但同一 batch 的 `idx[seq_i]` 槽会被 `NV_` 个不同核并行写不同段**——
   段不重叠，所以安全，前提是**核间写不共享 32 字节边界**。
   `head_i` 段的大小是 `realK_ * realV_ * 2` 字节；
   当 `realK_ * realV_` 为奇数且较小时（如 `dk=1, dv=1`）两个核的写会落在同一 32 字节内，
   这是 **false-write-share**，Ascend 上不保证结果。
   `dk=128` 时段大小 ≥ 32KB，不可能共享边界。测试用例的 `dk/dv` 全为大值（`05` 篇 §5），
   所以此风险**未被覆盖**。

结论：**in-place 在正常配置下安全，其依据是"UB 副本 + 段不重叠 + 分片不重叠"三重事实，
而代码里没有一行注释说明这个前提**。

## 8. 与 CGDR 的接口差异（一句话对照，细节在 `05` 篇）

CGDR（prefill）不需要 `ssm_state_indices`：它的状态是"每条序列算一次、输出到 `[b, NV, DK, DV]`"，
槽位由 batch 索引隐式确定。RGDR 因为要**跨步续写同一个池**才必须显式给索引。
所以三个 decode 专用输入（`ssm_state_indices`、`num_accepted_tokens`、`gk`）里，
**只有 `ssm_state_indices` 是为"池化续写"服务的**，
`num_accepted_tokens` 为"回退"服务，`gk` 为"逐维衰减表达力"服务——
三者互不相干，def 侧把它们都注册成可选（`01` 篇 §2），
可以任意组合，组合空间由 tiling 的 7 个 bool 覆盖（`01b` 篇 §7）。

