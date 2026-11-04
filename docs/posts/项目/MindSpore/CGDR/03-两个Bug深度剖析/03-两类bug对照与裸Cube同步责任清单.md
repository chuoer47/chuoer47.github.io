# 03 · 两类 bug 对照与裸 Cube 同步责任清单

结论先行：

1. **这两个 bug 不是"两个 bug"，是"上 Cube"这一个动作漏掉的两半。**
   !1158 修的是 V 管内部（UB 别名）的**空间**账 —— 谁在这刻占着这块地址；
   !1174 修的是 M↔V 之间的**时间**账 —— 谁先谁后、谁等到谁。
   两半都在快照 `src/d0906c3e` 里同时存在，也都同时存在于 !1135 的**初版** `src/a9c66ddb`
   （实测：`a9c66ddb:768/772/776/780` 与 d0906c3e 的 beta 结构逐字相同；`grep -c CopyL0CToUb` = 0，
   `grep -o 'HardEvent::M_V\>'` = 0）。所以它们是**同一次移植的两笔欠账**，不是两次独立事故。
2. **裸 Cube 的成本不在"会写 Mmad"，在"替框架把五条跨管边界全部具名"。**
   本仓库"五件套"骨架（`docs/PR-1135-d0906c3e/01-Cube化深度精读.md:175` 的定义：
   Nd2Nz → LoadData → Mmad → L0C→UB → NzToNd）跨 5 条管界，修复前只具名了 3 条
   （`MTE2_MTE1` 23 处、`MTE1_M` 22 处、`M_MTE1` 20 处 = 65 对，实测计数）；
   缺的正是 `M_V` / `V_M` 两条 —— 补齐这两条就是 !1174 的全部内容。
3. **可验收性完全不对称**：时序类 bug 的修复能用 3 条 `grep` 判据在源码层验收（本章 §4），
   空间类 bug 的修复只能靠数值参照。这决定了移植时**该先做哪一类检查表**：
   能用结构不变式表达的，绝不留给精度回归去兜。

本章事实基线（全部为本次实查，命令与结果见 §4）：

| 量 | 实测值 | 来源 |
|---|---|---|
| !1158 改动规模 | 1 hunk（`819c819,820`），删 1 增 2，净 +1 | `diff d0906c3e 88d8b965` |
| !1174 改动规模 | 17 hunk，删 40 增 52，共 92 行变化，净 +12 | `diff 88d8b965 048d0427` |
| 两 PR 的作用文件 | 各只有 `op_kernel/chunk_gated_delta_rule.h`（`diff -rq` 各 1 行） | 实测 |
| `CopyL0CToUb` | 定义 :116-127（048d0427），调用点 8 处 | `grep -n` |
| 修复后残留裸搬 | `DataCopy(.*c1Local` → 0 命中 | `grep -c` |
| L0C 分配器 | `LocalMemAllocator<AscendC::Hardware::L0C>` 8 处，与调用点 1:1 | `grep -n` |
| `M_V` / `V_M` 事件边 | d0906c3e / 88d8b965 / a9c66ddb 均 0/0；048d0427 为 3/3 | `grep -o ... \| wc -l` |
| `TQueSync` | 18 处，全部 `PIPE_S↔PIPE_V`（6 + 12），无一涉及 M 或 L0C | 实测 |
| `stateOutQueue_` | 唯一 TQue，`<QuePosition::VECOUT, 1>`，深 `BUFFER_NUM = 1`；6 取 7 还（分支多一条）| :2436、:155 |

---

## 1. 成对对照表

锚点：src/d0906c3e/op_kernel/chunk_gated_delta_rule.h:819、1887-1897；src/048d0427/op_kernel/chunk_gated_delta_rule.h:116-127、182、197、831-832；src/a9c66ddb/op_kernel/chunk_gated_delta_rule.h:765-782

| 维度 | !1158：beta 缓冲重叠 | !1174：L0C 缺 M↔V 栅栏 |
|---|---|---|
| **缺陷所在的物理面** | UB 内部。`betaLocal` 与 `Cast` 目的 `chunkVFp32` 同基址（`ReinterpretCast` 不改地址只改元素类型） | L0C 数据通路。VEC 读 L0C 与 CUBE 写 L0C 落在同一地址 |
| **管别** | 单管：全在 PIPE_V / MTE2 内部，不涉及 M 管 | 跨管：M（Cube）↔ V/MTE 之间，且是**双向**缺两条边 |
| **错的性质** | 空间：地址重叠，后写覆盖未读 | 时间：顺序无保证，读写可同时发生 |
| **症状** | **静默算错**。数值仍在合理区间，只有误差指标越阈（`cos=0.9996` 过、`nrmse=0.0269 > 0.02` 不过，出处 `PLAN.md:93`，时点 2026-09-08） | **间歇崩溃**。`error code = 0x100000000020000` / `L0C read/write conflict`、runtime `507015`、aicore exception（`docs/PR-1135-d0906c3e/10-Commit演进史.md:347-352`） |
| **能否产出"错但能跑完"的中间态** | 能，且只有这一种 | 不能。硬件把同址读写判为异常，直接杀核 |
| **触发条件偏向** | **shape 相关**：`canUseBetaDma` 走不走 DMA 快路径、`chunkLen × NV_` 的平铺跨度 | **负载相关**：Cube 流水是否排满、迭代次数是否够多把时序裕量耗尽 |
| **确定性** | 完全确定：同 shape 同输入必然同一结果，因为它只是"少读了几个元素" | 不确定：同一二进制多次运行可崩可不崩（`PLAN.md:142` 记 a9c66ddb/69300ffc "首跑崩、复跑过"；`docs/PR-1135/02` 侧记 ~1/3 概率，均二手） |
| **单测能否稳定复现** | 只能"抓到当前用例碰到的那一片"，取决于有没有覆盖到 `head ≥ 8` 列 | 不能稳定复现，8 处里测试最多逼出 1~2 处；`docs/PR-1174-048d0427/02-实验复现.md:46` 自己也要求"修复前复现、修复后确认消失，两头都要做" |
| **profiling 能否看见** | 能（数值比对即可） | **不能**：`docs/PR-1135-d0906c3e/11-流水线剖析msprof实战.md:144-150` 实测 `ResourceConflictRatio`/`MemoryL0` 在 310P 不出 `op_summary`，唯一替代是崩出来的报错串 |
| **修复的物理动作** | 换借用目标：`chunkVFp32` → `chunkAttnOutFp32`（88d8b965:819-820，含 1 行说明注释） | 新增 12 行封装 + 8 处把裸 `DataCopy` 换成 `CopyL0CToUb` |
| **修复是否改语义** | **是**（结果由错变对） | **否**（搬的数据、地址、参数一字不差，只加时序约束） |
| **修复是否可能引入新错** | 可能 —— 换缓冲要重算容量与生命周期（此处恰好容量同为 `cs * avStepAligned`，:182 与 :197，所以不需要重算） | 不可能改数值；风险只在"漏一处"和"事件 ID 撞号" |
| **修复是否可结构验收** | 否，只能跑数值 | **是**，3 条 `grep` 判据（§4） |
| **防范手段** | 缓冲生命周期表：写借用表之前先答"最后读者是谁、下一写者是谁" | 跨管成对栅栏：按"每个 L0C 出口两侧各一对具名事件"这一**不变式**批量改，不按崩的那一处改 |
| **潜伏期** | 随 !1135 首个 Cube 提交进入（a9c66ddb:768），修于 !1158（PR 序号相隔 23） | 同源同批（a9c66ddb 无 `M_V`），修于 !1174（相隔 39） |
| **跨越的重构次数** | !1135 分支共 7 个 commit（`docs/PR-1135-d0906c3e/00-PR总览与实验复现.md:13`），本仓库只有首末两个快照（`a9c66ddb`、`d0906c3e`）；beta 块 `a9c66ddb:765-782` 与 `d0906c3e:816-833` 经 `diff` 证明**逐字节相同** → 从首个 Cube 提交到该 PR 终态，这段代码一直没被后续重构碰过 | 同样只可实测首末：`M_V`/`V_M` 计数在 a9c66ddb、d0906c3e、88d8b965 三个快照均为 0，直到 048d0427 才变 3/3 |
| **谁在高层 API 下替你做了** | `Cast`/`Gather` 都是 V 管原语，框架不管 UB 语义 —— **没人做**，这是纯程序员的账 | 高层 `Matmul`/`MatmulSoftmax` 类 API 在 L0C→UB 时内部就发 `M_V`/`V_M`；**换成裸 `Mmad` 后这份责任整体落到写核的人身上** |

一句话对照：**!1158 是"忘了画地址归属图"，!1174 是"忘了画事件依赖图"。前者的解药在读代码阶段，后者的解药在写代码阶段。**

---

## 2. 共同根因：一次"能力升级"带来的两笔欠账

锚点：src/d0906c3e/op_kernel/chunk_gated_delta_rule.h:819、1887-1897；src/048d0427/op_kernel/chunk_gated_delta_rule.cpp:28

两笔欠账有同一个来源 —— **!1135 把一段"纯 Vector 的递推"改写成"AIC 上跑 Cube + AIV 上跑 Vector 的融合核"**，
而融合核的两条新自由度同时被忽视了：

- 新自由度 A：**UB 不再够用**。`chunkKFp32 / kCumdecayFp32 / decayMaskFp32 / chunkVFp32 / chunkScoresFp32 /
  stateInFp32 / chunkAttnOutFp32` 全部从同一块 `tmpBuff` 里按字节偏移切开
  （048d0427:170-214，`pipe_->InitBuffer(tmpBuff, restUbSize_)`），
  于是"借一块已死的缓冲"成为常态 —— 048d0427 里 `ReinterpretCast` 借法就有
  `:827`（系数偏移）、`:832`（beta 源）、`:1059`（转置输出）等多处。
  常态 + 没有生命周期表 = !1158。
- 新自由度 B：**多了一条 M 管**。`KERNEL_TASK_TYPE_DEFAULT(KERNEL_TYPE_AIC_ONLY)`
  （cpp:28）意味着 Cube 与 Vector 的指令由同一条流下发、在各管上独立退休。
  于是每处 L0C 出口新增两条必须具名的边。具名了一半 = !1174。

还有一个更隐蔽的共同点：**两处都发生在"看起来已经做对了"的代码上**。

- `LoadChunkCoefficients` 的 beta 快路径有 `V_MTE2`、`MTE2_V` 两对事件（048d0427:833-839），
  跨管同步比周围代码还讲究，唯一漏的是"目的地址就是源地址"这一条**空间**事实。
- `ComputeVNewCube` 五件套的三条 M 侧事件边一处不缺，
  甚至 Mmad 与 L0C 复制之间还夹了一对 `M_MTE1`（d0906c3e:1887-1888），
  看着最像"已经同步过了"，而那一对的语义是 Cube↔L1，与"VEC 能不能读 L0C"无关。

**教训**：在跨管代码里，"这里有 SetFlag/WaitFlag"不是安全证明，
"这里具名的是哪一条边"才是。评审时只数栅栏个数会被这类代码骗过去。

---

## 3. 裸 Cube 移植清单

下面每一项按同一格式写：**高层 API 替你做什么 / 裸 Mmad 要你自己做什么 / 本仓库的可复核证据 / 自检动作**。

### 3.1 L0C 读写同步：每个出口两侧各一对具名事件

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:116-127、507-519、1179-1191；src/d0906c3e/op_kernel/chunk_gated_delta_rule.h:1885-1897

- 高层 API：`Matmul` 系列在 `GetResult` / 结果落到 UB 时内部插 `M_V`、`V_M`，用户无感。
- 裸 Mmad：每一次"把 `TPosition::CO1` 的内容搬到 UB"（本仓库是
  `DataCopy(cNz, c1Local, params, enhanced{blockMode = BLOCK_MODE_MATRIX})`）都要
  **前置 `M_V`、后置 `V_M`**，两条方向不可互相代用。
- 可复核证据：
  - 修复体（048d0427:116-127）就 12 行，`FetchEventID` 取号 + 两对 `SetFlag/WaitFlag` 夹一条 `DataCopy`。
  - 修复前（d0906c3e:1885-1897）同一位置只有一对 `M_MTE1` 与复制**之后**的 `PipeBarrier<PIPE_ALL>`，
    复制**之前**没有任何 M→V 语义。
  - 8 处调用点：`:511、1183、1298、1734、1823、1909、2058、2271`，
    对应 8 个 `LocalMemAllocator<AscendC::Hardware::L0C>`（:489、1087、1259、1652、1781、1862、1973、2211）。
- 一个必须知道的作用域边界：封装里的 `V_M` 是在 `DataCopy(L0C→UB)` **之后**、
  控制流回到调用方之前下发的（`SetFlag<HardEvent::V_M>` 在 :124，紧随 `DataCopy(dst, src, ...)` 的 :123），
  所以它保证的是"L0C 读完了，下一发 Mmad 可以写 L0C"，**不**覆盖"NZ→ND 读完 `cNz` 这块 UB"
  —— 那个循环在调用方，例如 `CopyAttnCubeResult` 的 :1189。
  后一半靠紧随的 `PipeBarrier<PIPE_ALL>()`（:1184、:1191）与"每处 `cNz` 只被一个调用占"的结构。
  移植时若把 NZ→ND 循环拆到封装外异步执行，这条栅栏不够。
- 自检动作：对目标 kernel 跑
  `grep -n 'c1Local\|Hardware::L0C'`，把 L0C 的"写入口 = Mmad 目的"与"读出口 = DataCopy 源"配成清单，
  逐个读出口检查其上一行是否有 `M_V`、下一行是否有 `V_M`。

### 3.2 L1 / L0 装载完成事件：五件套的三条 M 侧边，全部用字面量 ID 0

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:427-459、496-505、1094-1111

- 高层 API：`Matmul::Iterate` 内部按 k 轮转管理 L1→L0A/L0B 的装载与覆盖，事件对用户不可见。
- 裸 Mmad：GM→L1（MTE2）、L1→L0（MTE1）、L0→Cube（M）三段各有"对端还没用完，我不许覆写"的约束，
  必须自己写成三对事件：

```
    DataCopy(a1Local, src, Nd2NzParams{1, kBlock, kBlock, 0, kBlock, kBlock, 1, 0});
    SetFlag<HardEvent::MTE2_MTE1>(0);
    WaitFlag<HardEvent::MTE2_MTE1>(0);
    for (uint32_t blockIdx = 0; blockIdx < kBlock / 16; ++blockIdx) {
      LoadData(a2Local[blockIdx * kBlock * 16], a1Local[blockIdx * 512 / sizeof(half)],
               LoadData2DParams{0, kBlock / 16, kBlock / 16, 0, 0, false, 0});
    }
  ...
    SetFlag<HardEvent::MTE1_M>(0);
    WaitFlag<HardEvent::MTE1_M>(0);
    Mmad(c1Local, a2Local, b2Local, MmadParams{kBlock, kBlock, kBlock, 0, false, init});
    SetFlag<HardEvent::M_MTE1>(0);
    WaitFlag<HardEvent::M_MTE1>(0);
```
  （逐字：`src/048d0427/op_kernel/chunk_gated_delta_rule.h:430-436` 与 `:454-458`）

- 可复核证据：65 对字面量 ID 的 `SetFlag/WaitFlag`，恰好只分布在这三条边上
  —— `MTE2_MTE1` 23、`MTE1_M` 22、`M_MTE1` 20，合计 65；`WaitFlag<...>(0)` 也是 65，配对无缺。
  另外 25 处 `FetchEventID` 分布在别的 7 条边（`V_MTE2` 6、`MTE2_V` 6、`V_MTE3` 5、
  `MTE3_MTE2` 2、`MTE3_V` 2、`MTE2_S` 1、`S_MTE2` 1）以及新增的 `M_V`/`V_M` 各 1。
- 为什么这三条敢用字面量 `0`、其余必须 `FetchEventID`：**事件寄存器数量有限**。
  同一时刻只需一条在飞的边可以复用固定号；一旦一条边可能被"多处、嵌套"同时使用，
  就必须向框架领号。本仓库的规律是可复核的：
  三条 M 侧边全用 `0`（因为它们总是"夹一条指令"的紧邻对，取号即用完），
  而 `M_V`/`V_M` 用的是 `FetchEventID`（:119-120）。
  移植时的安全做法是新边一律 `FetchEventID`；只有确认同一条边不存在嵌套时才降为字面量。
- 自检动作：`grep -o 'SetFlag<HardEvent::[A-Z0-9_]*>(0)' | sort | uniq -c`，
  确认字面量 ID 只出现在"紧邻单条指令"的边上；出现别的边就说明在赌寄存器不冲突。

### 3.3 NZ→ND 转换期间的缓冲独占

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:157-214、507、1179、1294、1730、1819、1903、2054、2262-2266

`BLOCK_MODE_MATRIX` 的 L0C→UB 落点是 **NZ 序**，必须再用一次逐行/逐分形转换才是 ND。
这段期间那块 UB（本仓库叫 `cNz`）处于"被 DMA 写、又被 V 读"的独占状态，
而且它是**借来的** —— 8 处借用对象实测：

| # | 调用点 | `cNz` 借自 | 最终 ND 落点 | 借用是否显然安全 |
|---|---|---|---|---|
| 1 | :511 | `residualA`（形参，:507） | `dst[row*kBlock]`（:517） | 需证明：残差在 :482-483 `StageHalfWithResidual` 后已无读者 |
| 2 | :1183 | `chunkVFp32`（:1179） | `dst` = `chunkScoresFp32`（:1127）/ `chunkAttnOutFp32`（:1156） | 同函数被调 2 次，两次同一块 `cNz`，靠 :1184/:1191 栅栏串行 |
| 3 | :1298 | `chunkVFp32`（:1294） | `chunkKFp32`（:1304） | src/dst 互斥 ✓ |
| 4 | :1734 | `chunkKFp32`（:1730） | `chunkVFp32`（:1741） | 与 #3 正好互换 ✓ |
| 5 | :1823 | `kCumdecayFp32`（:1819） | `chunkAttnOutFp32`（:1830） | src/dst 互斥 ✓ |
| 6 | :1909 | `chunkKFp32`（:1903） | `chunkVFp32`（:1918） | src/dst 互斥 ✓ |
| 7 | :2058 | `kCumdecayFp32`（:2054） | `chunkAttnOutFp32`（:2065） | 与 #5 同形 ✓ |
| 8 | :2271 | `chunkKFp32`，`if constexpr (kSpecializedDk <= 96)` 时改借 `tmpBuff` 前缀区（:2262-2266） | 直接融进 `Add(stateInFp32, ...)`（:2282 / :2296） | 有注释证明，见下 |

- 高层 API：`Matmul` 的 `GetResult` 内部自带 NZ→ND（或走 Fixpipe），转换缓冲由框架的 workspace 划。
  本仓库注释点名了为什么不能走那条路：`// On dav_m200, raw Mmad writes L0C in NZ order and Fixpipe is unavailable.`
  （d0906c3e:1891，该行逐字；048d0427 同句在 :1904）—— **Fixpipe 不可用 = 转换必须手做 = 独占责任也手做**。
- 裸 Mmad 要做两件事：(a) 给转换找一块"此刻无人写"的 UB；(b) 转换期间不许任何人改写它，
  转换结束后立刻失效（不要把 `cNz` 传出函数）。
- 可复核证据里最值得抄的是 #8 的写法（逐字 `048d0427/op_kernel/chunk_gated_delta_rule.h:2263-2267`）：

```
      if constexpr (kSpecializedDk <= 96) {
        // chunkK/kCumdecay/decayMask are dead after staging A. Their combined
        // contiguous UB region holds the complete 64/80/96-bucket NZ result.
        cNz = tmpBuff.GetWithOffset<float>(kStateElements, 0);
      }
```

  借用被写成"编译期分支 + 三行生命周期注释 + 容量说明"，128 桶因为放不下就老老实实退回 `chunkKFp32`。
  同一种借法，#1~#7 只在注释里隐含、#8 明确写了；而 !1158 那处（beta）恰好是**没写**的那一类出了事。
  → 移植规范建议升硬：**借用他队缓冲必须在代码里写"最后读者 / 下一写者 / 容量等式"三件事**，
  缺一律视为未评审。
- 与 host 侧预算的耦合：kernel 里能借多少由 `restUbSize_ = tilingData->ubRestBytes`（:89）决定，
  而这个值是 host 侧 `FillTilingData` 写进 tiling 的（`op_host/chunk_gated_delta_rule_tiling.cpp:234`）。
  实测：两个修复 PR 的 `op_host/` **零改动**，即 !1158 的换缓冲之所以免费，是因为
  `chunkVFp32`（:182）与 `chunkAttnOutFp32`（:197）的元素数同为 `cs * avStepAligned`；
  若目标缓冲更大，就得回去改 tiling —— 这是"改一行 kernel"变成"改 host+kernel"的分界。

### 3.4 workspace slot 的双缓冲交替

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:34、38-39、261-267、1041-1054、1123-1133；src/d0906c3e/op_kernel/chunk_gated_delta_rule.h:1829-1831

- 高层 API：`Matmul` 的 workspace 轮转（`SetWorkspace` + 内部 GM 暂存槽位）由框架分配与回收。
- 裸 Mmad：GM 侧的 A_hi/A_lo/B_hi 暂存槽要自己划、自己交替，且"下一个消费者不许读到半写的槽"
  要自己堵。本仓库的实现（逐字 `048d0427/op_kernel/chunk_gated_delta_rule.h:261-267`）：

```cpp
  __aicore__ inline __gm__ uint8_t *GetCubeStageBase(uint32_t slot) {
    uint64_t stateWorkspaceElements = static_cast<uint64_t>(B_) * NV_ * realK_ * stateWorkspaceStrideV_;
    uint64_t stageByteOffset =
      stateWorkspaceElements * sizeof(float) +
      (static_cast<uint64_t>(blockIdx_) * CUBE_STAGE_SLOT_COUNT + slot) * CUBE_STAGE_SLOT_BYTES;
    return workspaceAddr_ + stageByteOffset;
  }
```

  `CUBE_STAGE_SLOT_BYTES = 64 * 1024`、`CUBE_STAGE_SLOT_COUNT = 2`（:38-39），
  基址先跳过 final-state 区、再按 `blockIdx_ × 2 + slot` 定位 —— **每核两槽，槽大小固定 64KB**。
- 实测的双缓冲只用了 1 处：`GetCubeStageBase(1)` 仅出现在 `:1045`（`nextStageBase`），
  其余 8 处全是 `GetCubeStageBase(0)`（:470、1041、1234、1626、1756、1845、1946、2125）。
  用法是"当前算第一发补偿乘积时，把下一发的 Q 预写进另一槽"（逐字 `048d0427/op_kernel/chunk_gated_delta_rule.h:1123-1127`）：

```cpp
    // Stage Q into a disjoint GM slot while the first compensated product is
    // executing. The MTE3->MTE2 dependency below prevents the next consumer
    // from observing a partially written slot.
    StageHalfWithResidual(chunkAttnOutFp32, chunkVFp32, nextAStageGm, nextAResidualStageGm, kAElements);
    CopyAttnCubeResult(c1Local, chunkScoresFp32);
```
  紧跟着就是那条唯一由 `FetchEventID(HardEvent::MTE3_MTE2)` 取号、用来堵"半写槽被读"的边（:1131-1133）。
  **双缓冲不是性能花架子，它必然新造一条跨管边**；写"预取到另一槽"的代码时必须同时回答
  "谁保证槽写完才被读"。本仓库答了（MTE3_MTE2），这一处是全文件唯一手写答案的槽位切换。
- 另一处证据是"槽内容语义"必须写清：d0906c3e:1829-1831 的注释
  `// The workspace stages A_hi, A_lo and B_hi. kAElements equals kCElements // for this fixed fast path,
  but spelling out the actual contents avoids confusing the A residual buffer with an output-C buffer.`
  —— 作者明确记录"这个槽里没有 C"。移植时若不写这句，下一个把 `kAElements == kCElements`
  当成巧合的人就会把输出写进 A 的残差槽。
- 自检动作：`grep -n 'GetCubeStageBase\|SLOT_COUNT\|slot'`，把"写 slot X"与"读 slot X"配对，
  每个"读"往上找它依赖的完成边；数不出来的就是靠流水巧合活着。

### 3.5 TQueSync 与事件 ID 的选择：谁覆盖哪条边

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:342、413-415、540、547、660、883、909、950、1017、1169-1171、1201、1220、1243、1403、1530、1541、2149、2411；src/048d0427/op_kernel/chunk_gated_delta_rule.h:2436、155

本仓库三套同步手段并存，实测边界很清楚：

| 手段 | 实测用量 | 覆盖的边 | 覆盖不到的 |
|---|---|---|---|
| `TQue` + `TQueSync<PIPE_S,PIPE_V>` / `<PIPE_V,PIPE_S>` | 1 个队列（`<QuePosition::VECOUT, 1>`，深 `BUFFER_NUM = 1`，:2436 与 :155）；18 处 `TQueSync`（S→V 6、V→S 12） | 队列张量在 V 与 S 之间的取用/归还，含 6 次 `AllocTensor` / 7 次 `FreeTensor`（:671、1058、1572、1595、2158、2364 / :695、1080、1591、1601、2204、2407、2420） | **M 管与 L0C 完全不在 TQue 的语义域内**（18 处无一涉及 M） |
| `SetFlag/WaitFlag` 字面量 ID | 65 对，全在 `MTE2_MTE1`/`MTE1_M`/`M_MTE1` | Cube 数据通路的三段 | 需要多实例并发的边 |
| `SetFlag/WaitFlag` + `FetchEventID` | 25 处（9 种边：7 原有 + 新增 `M_V`/`V_M`） | V↔MTE2/MTE3、MTE3↔MTE2、S↔MTE2，以及修复后的 M↔V | —— |
| `PipeBarrier<PIPE_ALL>` / `<PIPE_V>` | 29 处 / 92 处 | 本流前后指令的对齐 | 不携带源→宿方向的完成语义（见报告 02 §4.1） |

- 选择规则（可直接当移植准则）：
  1. **数据在队列里走 → 用 TQue/TBuf 的 SetFlag/WaitFlag**（如 `:413-415` 的 `mulSync`、
     `:1169-1171` 的 `attentionSync`），别自己领事件号，队列语义更严。
  2. **数据不经过队列、直接从 GM/L1/L0 走 → 必须具名事件边**，且方向写全。
  3. **一条边可能嵌套或被两处并发使用 → `FetchEventID` 领号**，不写 `0`。
  4. **`PipeBarrier` 只作收尾与对齐，不作依赖证明**。
     评审时"这里加了 `PipeBarrier<PIPE_ALL>`"不算答案，
     "这条依赖是哪两个管、事件名叫什么"才算。
  5. 队列深度为 1 时（本仓库 `BUFFER_NUM = 1`，:34），`AllocTensor`/`FreeTensor` 本身即串行点，
     任何"复用同一队列张量做双缓冲"的改动都要先改深度，否则同步会假成功。
- 一个只属于 `LocalMemAllocator` 的责任：32 个分配器对象（每个 Cube 函数 4 个 × 8）共发出
  40 次 `Alloc<TPosition::...>`（每函数 5 次：`A1/B1/A2/B2/CO1`，其中 `CO1` 即 L0C 共 8 次），
  **没有任何显式 `Free`** —— 释放靠分配器离开函数作用域。
  所以"L0C 独占"的实际保证是"函数作用域"，一旦把 L0C 张量传出函数（返回 `LocalTensor`），
  独占性立刻失效，栅栏再多也救不了。

### 3.6 第 6 项责任：这一代芯片到底支持你调的那个 API

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:280-284、292-300；PLAN.md:141

上面 5 项都是"框架不替你做了"，还有第六类更坑的：**你以为框架会做、其实那颗芯片根本不做**。
本仓库有一条实测记录（`PLAN.md:141`，2026-09-14 真机）：
`725cf45d` 的 `LoadPaddedRows` 初版用 `DataCopyPad`，"dav_m200 MTE2 静默不写数据 → 输出全零
（11/13 fail，cosine=0），但 isfinite 冒烟测试防不住"，`69300ffc` 重写装载才修复。
终态代码把这件事写进了注释与实现：048d0427:280-281 明确 "using dav-2002 **supported** primitives"，
并且只用三种原语拼装载（`:286` `Duplicate` 补零、`:296-300` 一组对齐判据后走 strided `DataCopy`、
非对齐行走 32 字节整块 + Scalar 补尾）。

- 与两类 bug 的关系：`DataCopyPad` 事故的症状与 !1158 同一族（**静默错值**，且错到全零），
  而它的成因完全不在同步、而在**代际可用性**。
- 移植准则：把"用到的原语清单"当作交付物的一部分去实测，而不是照文档写。
  本文件的 !1174 案例同理 —— `M_V`/`V_M` 这类边在高层 API 下看不见，
  在裸 Mmad 下必须知道**本代芯片是否会替你兜住**（答案是不会，见 §5.2）。
- 自检动作：对 kernel 里每个 AscendC 原语调用做一次"代际白名单"核对；
  名单外的原语一律要求"非零输出 + 数值参照"双条件通过，才算可用。

---

## 4. 一页移植检查表（可直接执行）

锚点：src/048d0427/op_kernel/chunk_gated_delta_rule.h:116-127、489、2262-2266；src/88d8b965/op_kernel/chunk_gated_delta_rule.h:819-820

以下 10 条，前 5 条来自 !1174 的不变式（可机器验收），后 5 条来自 !1158 的不变式（需人工推演）。
"判据"列里凡给命令的，本章都已实跑。

| # | 检查项 | 判据（命令或问答） | 本仓库实测 |
|---|---|---|---|
| 1 | 每处 L0C→UB 都有前 `M_V` 后 `V_M` | `grep -n 'DataCopy(.*c1Local'` 应为 0（除封装体内部） | 048d0427：0 命中 ✓ |
| 2 | L0C 出口数 = 封装调用数 | `grep -n 'Hardware::L0C>'` 的行号集 与 `grep -n 'CopyL0CToUb'` 的调用行集 一一对应 | 8 ↔ 8 ✓ |
| 3 | 新增事件边真的存在 | `grep -o 'HardEvent::M_V\>' \| wc -l`（**必须带词边界**，否则 `V_MTE2`/`V_MTE3` 会污染计数，裸 `grep -c 'HardEvent::V_M'` 实测虚报 33） | 0 → 3（全在封装内）；`V_M` 同 |
| 4 | 没有把 Cube 张量传出作用域 | `LocalTensor<float>` 是否被 `return`；`l0cAllocator` 是否在函数内 | 8 处均为函数局部，0 显式 Free ✓ |
| 5 | 双缓冲槽的读侧有完成边 | 每个 `GetCubeStageBase(1)` 之后紧跟的读，往上找 `MTE3_MTE2` | 1 处，有（:1131-1133）✓ |
| 6 | 每次 `ReinterpretCast` 借用：最后读者是谁 | 人问 | 借用点 048d0427:832 借的是 `chunkAttnOutFp32`；末次读 = 上一 chunk 的 `WriteAttnTileToGm`（88d8b965:660 的 `Cast(outLocal, chunkAttnOutFp32, ...)`），推演全文见报告 01 §5 |
| 7 | 同一次借用：下一写者是谁、何时开始写 | 人问；**特别检查"目的 == 源"的原地扩位 `Cast`** | !1158 的成因就是 `Cast(chunkVFp32, betaLocal, ...)` 原地写 |
| 8 | 借用容量等式写在代码里 | 借用的字节数 ≤ 被借者的 `InitBuffer` 容量，且等式可见 | `chunkVFp32`/`chunkAttnOutFp32` 同为 `cs * avStepAligned`（:182、:197）✓；#8 有注释（:2264-2265）✓ |
| 9 | 快路径判据是否"几乎恒真" | 把 `likely()` 分支的进入条件按默认 tiling 展开 | `canUseBetaDma` 在 `chunkSize = 64` 下极易满足 → 影响面比看起来大（报告 01 §3.4/§8） |
| 10 | 数值类缺陷有没有至少一条能覆盖到"受影响列"的用例 | 对照测试矩阵的 head/列维 | 快照内**无测试文件**（各快照恰好 7 个文件，全在 `op_host/`+`op_kernel/`），无法核 |

三条"修复类 PR 该长什么样"的正例（同一份 diff 里可直接模仿）：
- **批量而非点补**：!1174 把 8 处一次改完，而不是只改崩的那处；测试只能逼出其中 1~2 处。
- **改动零语义**：92 行变化里没有任何参数、地址、长度被改；纯约束增量，因此可推断"不影响性能与数值"。
- **正交拆分**：!1158 只动 :819-820，!1174 只动 M↔V 边，两 PR 作用行区间不相交，谁先合都不会让对方失效。

---

## 5. 两个修复 PR 合起来教给后来者什么

锚点：src/88d8b965/op_kernel/chunk_gated_delta_rule.h:819-820；src/048d0427/op_kernel/chunk_gated_delta_rule.h:116-127

1. **移植的验收单位是"不变式"，不是"用例"。**
   8 处 L0C 出口里只有 1~2 处测得出来；能一次改对的是因为改的是"每个出口两侧各一对事件"这条规则。
   对应动作：任何跨管改写，先写出不变式，再用命令证明不变式成立（§4 第 1~3 条）。
2. **"框架帮我做了"清单必须显式列出来，否则它会变成沉默的期望。**
   本章 §3 那 5 项（L0C 同步 / L1-L0 装载边 / NZ→ND 独占 / 槽位轮转 / 队列与事件号选择），
   在高层 `Matmul` API 下都是自动的；换成裸 `Mmad` 后没有一项会自己发生。
   最危险的是"看起来已存在"的那一项：五件套的 5 条管界里 3 条已经写了，
   人容易因为"这段代码同步做得挺细"而放过剩下的 2 条。
3. **静默错和崩溃这两类症状的排查手段完全不同，混用会两边都失败。**
   崩溃类：抓硬件报错串定位到"哪个物理通路"，然后**全量**改不变式；
   静默类：从误差指标反推"哪个维度错了"，然后**逐个**做生命周期推演。
   用崩溃的思路查静默 bug 会得到"加个 barrier 试试"，用静默的思路查崩溃会得到"再跑一遍看概率"。
   本案两条各自都恰好被对方那种错误思路拖延过（`PLAN.md:93` 把唯一一个精度 fail
   同时归给 !1158 与 !1174，就是把两类症状混在一起处理留下的痕迹）。
4. **在蓝区 310P 这类受限环境里，"可观测性"本身是移植的前置交付物。**
   `docs/PR-1135-d0906c3e/11-流水线剖析msprof实战.md:144-150` 实测：L0C 冲突相关指标不出 `op_summary`，
   唯一信号是崩出来的 `L0C read/write conflict`。既然工具不给，就只能把保证做成代码结构：
   封装函数（让栅栏不可能漏）、编译期分支（让容量错不过编译）、生命周期注释（让下一个读者不必重推）。
5. **最小的 diff 不等于最小的风险，最大的 diff 也不等于最大的改动。**
   !1158 净 +1 行却改变数值结果；!1174 92 行变化却逐位不改。
   评审强度应该按"是否改了语义"分级，而不是按行数。

---

## 6. 与既有文档的差异（以实查为准）

锚点：docs/PR-1174-048d0427/01-L0C同步与裸Cube编程.md:9-17、72-87；docs/PR-1135-d0906c3e/01-Cube化深度精读.md:175；docs/PR-1135-d0906c3e/00-PR总览与实验复现.md:13；docs/PR-1174-048d0427/02-实验复现.md:46；PLAN.md:33、93、106、129-142

| # | 既有说法（出处） | 实查结果 | 判定 |
|---|---|---|---|
| 1 | "五件套骨架……事件链 MTE2_MTE1 / MTE1_M / M_MTE1"（docs/PR-1135-d0906c3e/01-Cube化深度精读.md:175） | 骨架定义本身正确，但把"事件链"写成 3 条容易读成"齐了"；实际 5 条管界，缺 `M_V`/`V_M` | 本文 §3 把五件套重述为"5 条管界"，并标明只有 3 条被具名过 |
| 2 | 两篇修复文档各自只讲自己的 bug（docs/PR-1158/01 全篇、docs/PR-1174/01 全篇） | 两缺陷在 !1135 **初版** `a9c66ddb` 中同源共存：`a9c66ddb:768/772/776/780` 与 d0906c3e 结构逐字相同，且 `grep -c CopyL0CToUb` = 0、`M_V` = 0 | 本文 §2 补"共同根因"，并给出跨 4 个快照的实测证据 |
| 3 | `PLAN.md:33`（2026-09-08 交付小结）："src/ 下 5 个 commit 快照"、"docs 12 篇" | 实测 `src/` 现有 **7** 个快照（`a9c66ddb`、`f3f5e676` 为 2026-09-14 补导，见 `PLAN.md:145`），`docs/` 现有 **23** 个 `.md` | 数字过期，属正常增补；引用 PLAN 的规模类数字须带时点 |
| 4 | `docs/PR-1174-048d0427/02-实验复现.md:46`"修复前复现崩溃、修复后确认消失，两头都要做" | 与本文 §5.1 一致，且是"测试只能覆盖 8 处中 1~2 处"的最强旁证 | 一致 ✓ |
| 5 | 症状概率 "~1/3"（docs/PR-1174/01:44、PLAN.md:106）；"首跑崩、复跑过"（PLAN.md:142） | 两者均为真机记录，快照层无法复核；两组记录并不矛盾（后者是对前者的具体表现描述） | 二手，本文一律带出处+时点，不当结论用 |
| 6 | `PLAN.md:93` 把 d0906c3e 唯一 fail 归为"正是 !1158/!1174 修复的精度问题" | !1174 的 92 行变化不含任何数值语义改动（搬的地址、长度、参数逐字未变），**不可能**改变输出数值；该 fail 至多由 !1158 一类成因贡献 | 归因偏差：见报告 01 §8 第 7 行、报告 02 §9 末段 |
| 7 | "8 处位置表"（docs/PR-1174/01:76-85） | 表内函数归属正确，行号系统性 **+3**（那是 diff hunk 头起始行，含 3 行上文）；真实调用行为 :511、1183、1298、1734、1823、1909、2058、2271 | 已在报告 02 §3.1 更正，本文 §3.3 表沿用更正值 |
| 8 | 双缓冲"在 CGDR 里靠 slot 轮转"（一般性表述，未见于 docs 明写） | 实测 `GetCubeStageBase(1)` 全文件仅 **1** 处（:1045），其余 8 处均为 slot 0 | 本文只报实测：**双缓冲在本 kernel 里是局部技巧，不是全局约定** |
| 9 | `PLAN.md:131` 分支各 commit 正确性：a9c66ddb **13P/0F/13S**、d0906c3e 12P/**1F**/13S（同 26 条） | 两处 beta 代码经 `diff` 证明逐字节相同（`a9c66ddb:765-782` ↔ `d0906c3e:816-833`），即 beta 重叠在"全绿"的那个 commit 里同样存在 | **对 §6 第 6 行的补强**：该 fail 更可能由 725cf45d/69300ffc 之间的其它改动触发，把 !1158 说成"修掉了那个 fail"缺少证据链；两篇 bug 文档均未注意这组对照 |
| 10 | 事件 ID 用法未在任何文档中归纳（docs/PR-1135/01:175、docs/PR-1158/00、docs/PR-1174/01 全文） | 实测存在清晰分工：65 对字面量 `0` 全部落在 `MTE2_MTE1`/`MTE1_M`/`M_MTE1`；25 处 `FetchEventID` 覆盖 9 条边（7 条原有 + 新增 `M_V`/`V_M`） | 本文 §3.2 补齐为可执行准则（新边一律领号） |