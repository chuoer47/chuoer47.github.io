---
title: 补充阅读：Tokenizer（分词器）
order: 0
---

# 补充阅读：Tokenizer（分词器）

## 概述

本文是 Qwen3.5 架构详解教程的补充阅读材料，聚焦于大语言模型中一个常被忽略但至关重要的组件——**Tokenizer（分词器）**。

在前面的章节中，我们详细介绍了 Transformer 的各个核心组件（MLP、归一化层、位置编码、注意力机制等），并在第 6 章将它们组装成了 MiniQwen 模型。但有一个关键问题始终没有回答：

> **模型的输入 `input_ids` 从哪来？**

答案就是 Tokenizer。它是连接**人类文本**和**模型数字世界**的桥梁：

```
人类文本: "你好世界"
    │
    │ ---Tokenizer
    │
    ▼ 
token_ids: [87654, 12345, ...]  ← 模型看到的输入
    │
    │ ---Embedding
    │
    ▼ 
隐藏表示: [[0.12, -0.34, ...], [0.56, 0.78, ...]] (token_ids[i]=>256/512/1024维度)
    │
    │ ---Transformer + 其他组件
    │
    ▼ 
输出 logits
    │
    │ ---Tokenizer
    │
    ▼ 
人类文本: "你好世界"
```

本篇将基于个人学习 CS336（Stanford）的 BPE 作业（第一次作业）实现，讲解 Tokenizer 的核心原理和工程实现。

> [CS336链接](https://cs336.stanford.edu/)

### 为什么需要单独讲 Tokenizer？

| 视角 | 说明 |
|------|------|
| **架构完整性** | MiniQwen 的 `vocab_size=248320` 直接由 tokenizer 的词表大小决定 |
| **性能影响** | Tokenizer 的好坏直接影响模型的训练效率和推理质量 |
| **工程复杂度** | "文本分词"看似简单，实际涉及编码理论、高效算法、并行计算等多个工程问题 |
| **面试高频** | BPE 算法、tokenizer 设计是 NLP 岗位的常见面试题 |

---

## 1. 分词器的演进

### 核心问题：如何把文本变成数字？

模型只能处理数字，所以第一步是把文本转为整数序列。最直观的方案有三种：

1. 词级分词（Word-level）

最简单的方式——按空格/标点切分，每个词一个 ID：

```
"I love natural language processing"
→ [45, 102, 7891, 234, 5678]
```

**优点**：语义完整，每个 token 都有明确含义。

**致命缺陷**：

```
词表大小 = 所有出现过的词数量
  - 英文: 约 50 万词（含变形: run, runs, running, ran...）
  - 中文: 无天然分词边界，"南京市长江大桥" 如何切？
  - OOV 问题: 遇到词表外的词怎么办？"COVID-19" 在 2019 年前不存在
```

2. 字符级分词（Char-level）

退一步，按单个字符切分：

```
"hello"
→ ['h', 'e', 'l', 'l', 'o']
→ [8, 5, 12, 12, 15]
```

**优点**：词表极小（英文仅 ~256 个字符），零 OOV。

**致命缺陷**：

```
序列长度爆炸:
  "I love NLP" → 10 个字符 token
  "I love natural language processing" → 35 个字符 token

  → 注意力计算量 O(n²) 暴涨
  → 长距离依赖更难捕获
  → 训练效率极低
```

3. 子词级分词（Subword）—— 当前主流

**核心思想**：介于词级和字符级之间。常见词保持完整（如 "the"），罕见词拆成子词（如 "unhappiness" → "un" + "happi" + "ness"）。

```
"I love tokenization"
→ ["I", "Ġlove", "token", "ization"]   ← 常见词完整保留，长词拆分
```

### 子词级分词的**主要算法**：

| 算法 | 核心思想 | 代表模型 |
|------|---------|---------|
| **BPE** (Byte Pair Encoding) | 贪心合并最高频相邻对 | GPT-2, GPT-3, **Qwen3.5** |
| **WordPiece** |最大化语言模型似然 | BERT, DistilBERT |
| **Unigram** |  从大词表开始剪枝 | T5, mBART |
| **SentencePiece** |  无预分词，直接在原始文本上操作 | LLaMA, Alpaca |

- **BPE 的核心思想是“高频片段应该变成一个整体”。**
它一开始把文本拆成很小的单位，比如字符或字节。然后统计哪些相邻单位最常一起出现，例如 l 和 o 经常相邻，就把它们合并成 lo；之后继续统计，可能再把 lo 和 w 合并成 low。这个过程不断重复，直到词表达到指定大小。BPE 的优点是简单、稳定、确定性强，也能很好处理未登录词，因为生僻词可以退化成更小的字符或字节片段。

- **WordPiece 更关注“这个子词是否能提升整体建模效果”。**
它和 BPE 很像，也会从小单位逐步构造子词词表，但它不是单纯合并出现次数最高的 pair，而是选择对语料概率提升更大的子词。比如一个 pair 虽然频率高，但如果两个部分本身也非常常见，那么合并它们未必有很大价值；WordPiece 更倾向于选择具有较强结合关系的片段。BERT 中常见的 ##ing、##ly 就表示这些 token 不是词首，而是接在前面词片段之后。

- **Unigram 的思路和 BPE/WordPiece 是反过来的。**
BPE 和 WordPiece 是“从小词表逐渐变大”，而 Unigram 是“先有一个很大的候选词表，再逐渐剪枝”。它会给每个子词一个概率，然后认为一个词可以有多种可能切分方式。例如 unhappy 可以切成 un + happy，也可以切成 un + happ + y。训练时，算法会估计哪些切分更可能出现，再删除那些对整体语料概率贡献较小的子词。它的优势是概率化建模更自然，也支持分词采样，可以增强模型对不同切分方式的鲁棒性。

- **SentencePiece 不是单一算法，而是一套“不依赖预分词”的子词分词框架。**
传统英文分词往往先按空格切词，再在词内部做 BPE 或 WordPiece。但这对中文、日文、泰文等没有显式空格边界的语言并不自然。SentencePiece 直接在原始文本上训练，把空格也视为一种普通符号，比如用 ▁ 表示空格位置。例如 Hello world 可能被处理成 ▁Hello ▁world。这样模型不需要外部 tokenizer 或语言特定的分词器，跨语言更统一。SentencePiece 内部通常实现两类算法：BPE 和 Unigram。

> **本教程聚焦 BPE**，因为它是广泛使用的方案。

---

## 2. BPE 算法详解

### 核心思想

**一句话概括**：反复合并语料中出现频率最高的相邻字节对，直到达到目标词表大小。

### 训练过程

#### 示例

假设语料中出现了以下词频统计（以空格标记词尾）：

```
"low"    出现 5 次  → 初始: ['l', 'o', 'w', ' ']
"lower"  出现 2 次  → 初始: ['l', 'o', 'w', 'e', 'r', ' ']
"newest" 出现 6 次  → 初始: ['n', 'e', 'w', 'e', 's', 't', ' ']
"widest" 出现 3 次  → 初始: ['w', 'i', 'd', 'e', 's', 't', ' ']
```

初始词表 = 所有单字符：`{l, o, w, e, r, n, s, t, i, d, _}`

**第 1 轮合并**：统计所有相邻对频次

| 相邻对 | 频次 | 来源 |
|--------|------|------|
| `(e, s)` | 9 | newest ×6 + widest ×3 |
| `(l, o)` | 7 | low ×5 + lower ×2 |
| `(o, w)` | 7 | low ×5 + lower ×2 |
| `(e, r)` | 2 | lower ×2 |
| `(n, e)` | 6 | newest ×6 |
| `(w, e)` | 6 | newest ×6 |
| `(s, t)` | 9 | newest ×6 + widest ×3 |

最高频对 `(e, s)` 和 `(s, t)` 都是 9 次，任选其一（假设选 `(e, s)`）→ 合并为新 token `es`

**第 2 轮后**：`(es, t)` 频次 9，合并为 `est`

```
第2轮后:
  l o w _        → 不变
  l o w e r _    → 不变
  n ew est _     → (e,s) + (es,t) 合并
  w i d est _    → 同上
```

如此反复，直到词表达到目标大小。

#### 伪代码描述

```
输入: 语料库 C，目标词表大小 V
输出: 合并规则列表 M，词表 Σ

1. 初始化: Σ = 语料中所有单字符（或单字节）
2. 将语料中的每个词拆分为字符序列
3. while |Σ| < V:
4.     统计所有相邻字符对的频次
5.     找到最高频对 (a, b)
6.     在所有词的序列中合并 (a, b) → ab
7.     将 ab 加入 Σ
8.     记录合并规则 M.append((a, b))
9. return Σ, M
```

**关键性质**：
- **贪心**：每轮选频次最高的对，不保证全局最优
- **有序**：合并规则的顺序很重要（先合并的优先级更高）
- **增量**：每轮只新增 1 个 token，共需 V-256 轮合并

### 编码过程

训练完成后，得到合并规则列表 M。编码新文本时：

```
输入: "lowest"
初始: ['l', 'o', 'w', 'e', 's', 't']

按 M 中的顺序逐个尝试合并:
  如果 (l, o) 在 M 中且优先级最高 → ['lo', 'w', 'e', 's', 't']
  如果 (lo, w) 在 M 中 → ['low', 'e', 's', 't']
  如果 (e, s) 在 M 中 → ['low', 'es', 't']
  如果 (es, t) 在 M 中 → ['low', 'est']

输出: ['low', 'est']  → 对应的 token_ids
```

**注意**：编码时的合并顺序必须与训练时完全一致，否则分词结果不一致。

### "字节级" BPE

GPT-2 的一个重要创新：不以 Unicode 字符为基本单位，而是以 **UTF-8 字节**为基本单位。

| 方案 | 基本单位 | 基础词表大小 | OOV 风险 |
|------|---------|-------------|---------|
| 字符级 BPE | Unicode 字符 | 数万 | 极低（但词表大） |
| **字节级 BPE** | UTF-8 字节 | **256** | **零** |

**优势**：
1. 基础词表只有 256 个字节，极小
2. 任何语言、任何字符都能表示（UTF-8 是万能编码）
3. 不需要预定义字符集
4. 零 OOV：最坏情况退化为单字节序列

**代价**：一个中文字 = 3 个 UTF-8 字节 = 初始 3 个 token，但通过 BPE 合并后通常只需 1-2 个 token。

---

## 3. 个人代码实现细节

下面结合个人CS336 HW1 的代码讲解。

<details>
<summary>完整代码</summary>

```python

import os
import heapq
import regex
import time
import random
import multiprocessing
from functools import partial
from tqdm import tqdm
from pathlib import Path
from typing import List, Tuple, Dict, DefaultDict, Any, Union
import mmap
import re
from collections import defaultdict

# GPT-2预分词模式
GPT2_SPLIT_PATTERN = r"""'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""


def load_and_sample_data(file_path: str, sample_size: int = 22000, special_token: str = "<|endoftext|>") -> str:
    """内存映射方式加载并采样文档"""
    try:
        with open(file_path, "r+", encoding='utf-8', errors='ignore') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                documents = []
                start = 0
                while start < len(mm):
                    end = mm.find(special_token.encode('utf-8'), start)
                    if end == -1:
                        doc = mm[start:].decode('utf-8', errors='replace').strip()
                        if doc:
                            documents.append(doc)
                        break

                    doc = mm[start:end].decode('utf-8', errors='replace').strip()
                    if doc:
                        documents.append(doc)
                    start = end + len(special_token)

                if len(documents) > sample_size:
                    documents = random.sample(documents, sample_size)

                return special_token.join(documents)
    except Exception as e:
        raise IOError(f"加载数据集失败: {e}")


def gpt2_bytes_to_unicode_local() -> Dict[int, str]:
    """字节到Unicode映射"""
    bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {b: chr(c) for b, c in zip(bs, cs)}


def pre_tokenize_document(doc: str, bytes_to_unicode_map: Dict[int, str]) -> List[List[str]]:
    """预分词处理单个文档"""
    tokens = regex.findall(GPT2_SPLIT_PATTERN, doc, flags=regex.UNICODE)
    sequences = []
    for token in tokens:
        token_unicode = ''.join(bytes_to_unicode_map[b] for b in token.encode('utf-8'))
        sequences.append(list(token_unicode))
    return sequences


def parallel_pre_tokenize(documents: List[str], num_processes: int, bytes_to_unicode_map: Dict[int, str]) -> List[
    List[str]]:
    """并行预分词优化"""
    if num_processes <= 1:
        return [seq for doc in documents for seq in pre_tokenize_document(doc, bytes_to_unicode_map)]

    with multiprocessing.Pool(
            num_processes,
            initializer=init_worker,
            initargs=(bytes_to_unicode_map,)
    ) as pool:
        results = list(tqdm(
            pool.imap(pre_tokenize_worker, documents, chunksize=50),
            total=len(documents),
            desc="预分词",
            mininterval=1
        ))
    return [seq for doc_sequences in results for seq in doc_sequences]


# 全局变量用于多进程
global_worker_byte_map = None


def init_worker(byte_map: Dict[int, str]):
    global global_worker_byte_map
    global_worker_byte_map = byte_map


def pre_tokenize_worker(doc: str) -> List[List[str]]:
    return pre_tokenize_document(doc, global_worker_byte_map)


class BPEIndex:
    """高效索引结构用于BPE合并"""

    def __init__(self, sequences: List[List[str]]):
        self.sequences = sequences  # 存储所有文本序列
        self.pair_counts: DefaultDict[Tuple[str, str], int] = defaultdict(int)  # 统计字节对频率
        self.pair_positions: DefaultDict[Tuple[str, str], List[Tuple[int, int]]] = defaultdict(list)  # 记录字节对位置
        self.heap = []  # 最大堆（存最高频字节对）
        self.heap_entries: Dict[Tuple[str, str], Any] = {}  # 堆条目快速访问

        # 初始化索引 一次性统计所有相邻字节对的出现位置和频率——将不可行的O(N²)问题转化为可处理的O(N log N)
        for seq_idx, seq in enumerate(sequences):
            for pos in range(len(seq) - 1):
                pair = (seq[pos], seq[pos + 1])
                self.pair_counts[pair] += 1
                self.pair_positions[pair].append((seq_idx, pos))

        # 构建堆 将高频字节对（>1次）加入最大堆，让 get_most_frequent() 能 O(1) 获取最高频对。
        for pair, count in self.pair_counts.items():
            if count > 1:  # 只添加计数大于1的pair
                entry = [-count, pair]
                heapq.heappush(self.heap, entry)
                self.heap_entries[pair] = entry

    def get_most_frequent(self) -> Tuple[str, str]:
        """快速返回当前最高频字节对（跳过已被合并的无效条目）"""
        while self.heap:
            neg_count, pair = self.heap[0]
            # 检查pair是否仍然有效
            if pair not in self.heap_entries:
                heapq.heappop(self.heap)
                continue

            current_count = self.pair_counts.get(pair, 0)

            # 检查计数是否匹配且大于1
            if -neg_count == current_count and current_count > 1:
                return pair
            # 否则移除无效条目
            heapq.heappop(self.heap)
            if pair in self.heap_entries:  # 确保条目存在
                del self.heap_entries[pair]
        return None

    def merge_pair(self, pair: Tuple[str, str], new_token: str) -> int:
        """合并字符对并更新索引"""
        if pair not in self.pair_positions or not self.pair_positions[pair]:
            return 0

        # 按序列和位置分组
        positions_by_seq = defaultdict(list)
        for seq_idx, pos in self.pair_positions[pair]:
            positions_by_seq[seq_idx].append(pos)

        merge_count = 0
        for seq_idx, positions in positions_by_seq.items():
            seq = self.sequences[seq_idx]
            # 按位置倒序排序
            positions.sort(reverse=True)
            last_merged_pos = -2

            for pos in positions:
                # 检查是否已被前面的合并影响
                if pos >= len(seq) - 1 or pos <= last_merged_pos:
                    continue
                if seq[pos] != pair[0] or seq[pos + 1] != pair[1]:
                    continue

                # 执行合并
                seq[pos] = new_token
                del seq[pos + 1]
                merge_count += 1
                last_merged_pos = pos

                # 更新左侧pair
                if pos > 0:
                    left_pair = (seq[pos - 1], pair[0])
                    self._update_pair_count(left_pair, -1)

                    new_left_pair = (seq[pos - 1], new_token)
                    self._update_pair_count(new_left_pair, 1)
                    self._add_position(new_left_pair, seq_idx, pos - 1)

                # 更新右侧pair
                if pos < len(seq) - 1:
                    right_pair = (pair[1], seq[pos + 1])
                    self._update_pair_count(right_pair, -1)

                    new_right_pair = (new_token, seq[pos + 1])
                    self._update_pair_count(new_right_pair, 1)
                    self._add_position(new_right_pair, seq_idx, pos)

        # 清理已合并的pair
        if pair in self.pair_counts:
            del self.pair_counts[pair]
        if pair in self.pair_positions:
            del self.pair_positions[pair]
        if pair in self.heap_entries:
            # 标记为无效，稍后清理
            self.heap_entries[pair] = None

        return merge_count

    def _update_pair_count(self, pair: Tuple[str, str], delta: int):
        """更新字符对计数"""
        if delta == 0:
            return

        # 确保pair存在于字典中
        if pair not in self.pair_counts:
            self.pair_counts[pair] = 0

        new_count = self.pair_counts[pair] + delta
        self.pair_counts[pair] = new_count

        # 确保计数不为负
        if new_count < 0:
            new_count = 0
            self.pair_counts[pair] = 0

        if pair in self.heap_entries and self.heap_entries[pair] is not None:
            # 更新堆条目
            self.heap_entries[pair][0] = -new_count
            heapq.heapify(self.heap)
        elif new_count > 1:  # 只添加计数大于1的pair
            # 新建堆条目
            entry = [-new_count, pair]
            heapq.heappush(self.heap, entry)
            self.heap_entries[pair] = entry

    def _add_position(self, pair: Tuple[str, str], seq_idx: int, pos: int):
        """添加新位置到索引"""
        self.pair_positions[pair].append((seq_idx, pos))


def run_train_bpe(
        input_path: Union[str, os.PathLike],
        vocab_size: int,
        special_tokens: List[str] = ["<|endoftext|>"],
        num_processes: int = 8,
        sample_size: int = 22000,
        **kwargs,
) -> Tuple[Dict[int, bytes], List[Tuple[bytes, bytes]]]:
    # 参数验证
    base_vocab_size = 256 + len(special_tokens)
    if vocab_size < base_vocab_size:
        raise ValueError(f"vocab_size至少需{base_vocab_size}")

    # 1. 字节到Unicode映射
    bytes_to_unicode_map = gpt2_bytes_to_unicode_local()
    unicode_to_bytes_map = {v: bytes([k]) for k, v in bytes_to_unicode_map.items()}

    # 2. 初始化词汇表
    vocab = {i: bytes([i]) for i in range(256)}
    next_token_id = 256
    existing_bytes = set(vocab.values())

    # 3. 添加特殊token
    for st in special_tokens:
        st_bytes = st.encode("utf-8")
        if st_bytes not in existing_bytes and len(vocab) < vocab_size:
            vocab[next_token_id] = st_bytes
            existing_bytes.add(st_bytes)
            next_token_id += 1

    # 4. 加载并采样数据
    print(f"📖 从 {input_path} 加载并采样 {sample_size} 个文档...")
    text = load_and_sample_data(input_path, sample_size, special_tokens[0])

    # 5. 分割文档
    escaped_tokens = [re.escape(st) for st in special_tokens]  ## 返回 "<\|endoftext\|>"
    split_pattern = "|".join(escaped_tokens)
    documents = [part for part in re.split(split_pattern, text) if part]

    # 6. 并行预分词
    sequences = parallel_pre_tokenize(documents, num_processes, bytes_to_unicode_map)
    print(f"✅ 预分词完成，得到 {len(sequences):,} 个token序列")

    # 7. 初始化索引结构
    print("🔧 构建BPE索引...")
    bpe_index = BPEIndex(sequences)
    merges = []
    vocab_progress = len(vocab)
    total_merges = vocab_size - vocab_progress

    # 8. BPE训练主循环
    print(f"🔄 开始BPE训练，目标合并数: {total_merges:,}")
    progress_bar = tqdm(total=total_merges, desc="训练BPE", unit="合并", mininterval=0.5)

    while vocab_progress < vocab_size:
        best_pair = bpe_index.get_most_frequent()
        if best_pair is None:
            print("\n⚠️ 没有更多有效的字符对可供合并，提前结束训练")
            break

        # 创建新token
        new_token_str = best_pair[0] + best_pair[1]
        p1_bytes = unicode_to_bytes_map[best_pair[0]]
        p2_bytes = unicode_to_bytes_map[best_pair[1]]
        new_token_bytes = p1_bytes + p2_bytes

        # 执行合并
        merge_count = bpe_index.merge_pair(best_pair, new_token_str)
        if merge_count == 0:
            continue

        # 更新词汇表
        if new_token_bytes not in existing_bytes:
            vocab[next_token_id] = new_token_bytes
            existing_bytes.add(new_token_bytes)
            merges.append((p1_bytes, p2_bytes))
            next_token_id += 1
            vocab_progress += 1
            progress_bar.update(1)

        # 更新映射表
        unicode_to_bytes_map[new_token_str] = new_token_bytes

    progress_bar.close()
    return vocab, merges


def evaluate_tokenizer(vocab: Dict[int, bytes], merges: List[Tuple[bytes, bytes]], test_text: str):
    """简单评估分词器效果"""
    print("\n🔍 分词器评估")
    sample_text = test_text[:200] + "..." if len(test_text) > 200 else test_text
    print(f"样例文本: {sample_text}")

    # 简单统计
    unique_tokens = set(vocab.values())
    print(f"词汇表大小: {len(vocab):,}")
    print(f"唯一token数: {len(unique_tokens):,}")
    print(f"合并操作数: {len(merges):,}")


if __name__ == "__main__":
    # 配置参数
    config = {
        "vocab_size": 10000,
        "special_tokens": ["<|endoftext|>", "<pad>", "<unk>"],
        "num_processes": 8,
        "sample_size": 22000,  # 初始采样22,000文档
    }

    # 数据集路径
    train_path = "F:/dataset/CS336/HW1/TinyStoriesV2-GPT4-train.txt"
    valid_path = "F:/dataset/CS336/HW1/TinyStoriesV2-GPT4-valid.txt"

    # 检查文件是否存在
    if not Path(train_path).exists():
        raise FileNotFoundError(f"训练集文件 {train_path} 不存在")
    if not Path(valid_path).exists():
        raise FileNotFoundError(f"验证集文件 {valid_path} 不存在")

    # 训练模型
    print("🚀 开始训练")
    start_time = time.time()

    train_vocab, train_merges = run_train_bpe(train_path, **config)

    print(f"\n✅ 训练完成! 耗时: {time.time() - start_time:.2f}秒")

    # 小规模验证 (使用验证集的10%)
    print("\n🔬 小规模验证")
    valid_config = config.copy()
    valid_config["sample_size"] = int(2)  # 验证集使用500文档 (10%)

    valid_vocab, valid_merges = run_train_bpe(valid_path, **valid_config)

    # 分析结果
    print("\n📊 训练结果")
    print(f"训练词汇表大小: {len(train_vocab):,}")
    print(f"训练合并操作数: {len(train_merges):,}")
    print(f"验证词汇表大小: {len(valid_vocab):,}")
    print(f"验证合并操作数: {len(valid_merges):,}")

    # 比较词汇表重叠率
    train_tokens = set(train_vocab.values())
    valid_tokens = set(valid_vocab.values())
    overlap = train_tokens & valid_tokens
    print(f"\n📈 词汇表重叠率: {len(overlap) / len(train_tokens):.1%}")

    # 加载验证集样例进行评估
    with open(valid_path, "r", encoding="utf-8") as f:
        valid_text = f.read(1000)  # 读取前1000字符用于评估
    evaluate_tokenizer(train_vocab, train_merges, valid_text)

    import json  # 需要导入json模块


    # 在main函数末尾添加以下代码（在内存分析之前）
    def save_vocab_and_merges(vocab: Dict[int, bytes], merges: List[Tuple[bytes, bytes]], vocab_path: str,
                              merges_path: str):
        """保存词汇表和合并列表到文件"""
        # 1. 保存词汇表 (JSON格式)
        vocab_str = {idx: token.decode('utf-8', errors='replace') for idx, token in vocab.items()}
        with open(vocab_path, 'w', encoding='utf-8') as f:
            json.dump(vocab_str, f, ensure_ascii=False, indent=2)

        # 2. 保存合并列表 (文本格式)
        with open(merges_path, 'w', encoding='utf-8') as f:
            for merge in merges:
                part1 = merge[0].decode('utf-8', errors='replace')
                part2 = merge[1].decode('utf-8', errors='replace')
                f.write(f"{part1} {part2}\n")


    # 在main函数中调用保存功能（在训练完成后）
    output_dir = "./"  # 修改为您的输出目录
    os.makedirs(output_dir, exist_ok=True)

    vocab_path = os.path.join(output_dir, "gpt2_vocab.json")
    merges_path = os.path.join(output_dir, "gpt2_merges.txt")

    save_vocab_and_merges(train_vocab, train_merges, vocab_path, merges_path)
    print(f"✅ 词汇表已保存至: {vocab_path}")
    print(f"✅ 合并列表已保存至: {merges_path}")

    # 内存分析
    import psutil

    process = psutil.Process()
    mem_usage = process.memory_info().rss / (1024 ** 3)  # GB
    print(f"💾 峰值内存使用: {mem_usage:.2f} GB")
```

</details>




### Byte-to-Unicode 映射

UTF-8 字节范围是 0-255，其中很多字节（如 0x00, 0xFF）是不可打印的控制字符。直接用它们构建词表会导致存储和显示时出现乱码，无法用文本文件保存词表。

**解决方案**：将 256 个字节**可逆地**映射到 Unicode 可打印字符。

```python
def gpt2_bytes_to_unicode_local() -> Dict[int, str]:
    # 可直通的字节：ASCII 可打印区 + Latin-1 扩展区
    bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    cs = bs[:]  # 对应的 Unicode 码点（直通）
    n = 0
    for b in range(256):
        if b not in bs:           # 不可直通的字节
            bs.append(b)
            cs.append(256 + n)    # 映射到 Unicode 私有区 U+0100, U+0101, ...
            n += 1
    return {b: chr(c) for b, c in zip(bs, cs)}
```

**映射规则**：

| 字节范围 | 处理方式 | 示例 |
|---------|---------|------|
| 33-126 | 直通（ASCII 可打印） | 0x41 → `'A'` |
| 161-172 | 直通（Latin-1 扩展） | 0xA1 → `'¡'` |
| 174-255 | 直通（Latin-1 扩展） | 0xAE → `'®'` |
| 0-32, 127-160, 173 | 映射到 U+0100+ | 0x00 → `Ā`, 0x20(space) → `Ġ` |

**重要细节**：空格（0x20）映射为 `Ġ`（U+0120），这就是为什么 GPT-2 分词结果中常见 `Ġ` 前缀——它代表单词前面的空格。

```
"hello world" 的字节:
  'h'=0x68, 'e'=0x65, 'l'=0x6C, 'l'=0x6C, 'o'=0x6F
  ' '=0x20 → Ġ
  'w'=0x77, 'o'=0x6F, 'r'=0x72, 'l'=0x6C, 'd'=0x64

Unicode 表示: "helloĠworld"
→ 如果 BPE 合并了 "Ġworld" → token "Ġworld" 代表 " world"（带前导空格）
```

### 预分词（Pre-tokenization）

直接对整篇文本做 BPE 会出问题：
1. 不同语言、标点、数字会混在一起合并（如 `"3.14"` 被拆成 `"3"` + `"."` + `"14"`）
2. 空格位置不固定，导致同一个词在不同上下文中被不同地分词

**解决方案**：先用正则表达式将文本切分成"预分词单元"，再对每个单元独立做 BPE。

预分词正则表达式：

```python
GPT2_SPLIT_PATTERN = r"""'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""
```

拆解这个正则：

| 模式 | 匹配内容 | 示例 |
|------|---------|------|
| `'(?:sdmt\|ll\|ve\|re)` | 英文缩写 | `'s`, `'t`, `'ll`, `'ve`, `'re` |
| ` ?\p{L}+` | 字母词（可选前导空格） | `hello`, ` world` |
| ` ?\p{N}+` | 数字 | `123`, ` 42` |
| ` ?[^\s\p{L}\p{N}]+` | 其他非空白字符 | `!`, `...`, `@#$` |
| `\s+(?!\S)` | 行末空白 |  |
| `\s+` | 其他空白 | ` ` |

```
"Hello, I'm 25 years old!"
→ ["Hello", ",", " I", "'m", " 25", " years", " old", "!"]
→ 每个单元独立做 BPE
```

**代码实现**：

```python
def pre_tokenize_document(doc: str, bytes_to_unicode_map: Dict[int, str]) -> List[List[str]]:
    tokens = regex.findall(GPT2_SPLIT_PATTERN, doc, flags=regex.UNICODE)
    sequences = []
    for token in tokens:
        # 将 token 的 UTF-8 字节转为 Unicode 映射字符
        token_unicode = ''.join(bytes_to_unicode_map[b] for b in token.encode('utf-8'))
        sequences.append(list(token_unicode))  # 拆成单字符列表
    return sequences
```

**流程**：

```
"Hello"
  → encode('utf-8'): b'Hello' = [0x48, 0x65, 0x6C, 0x6C, 0x6F]
  → bytes_to_unicode: ['H', 'e', 'l', 'l', 'o']  （ASCII 直通）
  → 作为 BPE 合并的初始序列

"你好"
  → encode('utf-8'): b'\xe4\xbd\xa0\xe5\xa5\xbd'
  → bytes_to_unicode: ['ä½', ' ', 'å½']  （映射后的 Unicode 字符）
  → BPE 合并: 最终可能合并为单个 token
```

### 3.3 高效 BPE 索引

**暴力方案的问题**：

朴素 BPE 训练每一轮需要：
1. 扫描所有序列的所有位置，统计相邻对频次 → O(N)
2. 找到最高频对 → O(M)（M = 不同对的数量）
3. 遍历所有位置执行合并 → O(N)
4. 重复以上步骤，共 V-256 轮

总复杂度：**O(V × (N + M))**，其中 N 是语料总 token 数。当 N = 数百万、V = 数万时，非常慢。

> 在讲解后续设计前，可以先自己想一下如何优化算法？
> tips：从算法优化角度进行思考，V的复杂度无法进行减轻。只能从N/M的复杂度下手，最耗时的就是顺序扫描的操作。

#### BPEIndex 的优化设计

```python
class BPEIndex:
    def __init__(self, sequences: List[List[str]]):
        self.sequences = sequences
        self.pair_counts = defaultdict(int)        # 字符对频次
        self.pair_positions = defaultdict(list)    # 字符对位置索引（倒排索引）
        self.heap = []                             # 最大堆（取最高频对）
        self.heap_entries = {}                     # 堆条目快速定位
```

**核心数据结构**：

| 数据结构 | 作用 | 类比 |
|---------|------|------|
| `pair_counts` | 每个字符对的当前频次 | 频率字典 |
| `pair_positions` | 每个字符对出现的所有 (序列号, 位置) | 倒排索引 |
| `heap` | 按频次排序的最大堆 | 优先队列 |
| `heap_entries` | 快速查找堆中的条目 | O(1) 定位 |

**关键优化**：

**1. 增量更新**：合并一个对后，只更新受影响的左右邻居对的计数，而非重新扫描全部

```
合并位置 pos 处的 (A, B) → AB:
  - 删除 (A, B) 的计数
  - 更新左侧: (prev, A) 计数 -1, (prev, AB) 计数 +1
  - 更新右侧: (B, next) 计数 -1, (AB, next) 计数 +1
```

**2. 惰性堆（懒删除堆）**：堆中可能有已过时的条目（频次已变化），`get_most_frequent()` 检查顶部条目是否有效，无效则弹出并跳过。均摊时间`O(logn)`

```python
def get_most_frequent(self) -> Tuple[str, str]:
    while self.heap:
        neg_count, pair = self.heap[0]
        if pair not in self.heap_entries:
            heapq.heappop(self.heap)  # 已被清理
            continue
        current_count = self.pair_counts.get(pair, 0)
        if -neg_count == current_count and current_count > 1:
            return pair  # 有效！返回
        heapq.heappop(self.heap)  # 过时，跳过
    return None
```

**3. 位置索引**：`pair_positions` 记录每个对在哪些序列的哪些位置出现，合并时直接跳到这些位置。

注意：倒排索引是因为要从后往前更新，避免前面的改动带来后面的下标变换。

### 3.4 并行化

预分词是**独立任务**（每个文档互不影响），天然适合并行：

```python
def parallel_pre_tokenize(documents, num_processes, bytes_to_unicode_map):
    with multiprocessing.Pool(
        num_processes,
        initializer=init_worker,
        initargs=(bytes_to_unicode_map,)
    ) as pool:
        results = list(tqdm(
            pool.imap(pre_tokenize_worker, documents, chunksize=50),
            total=len(documents), desc="预分词"
        ))
    return [seq for doc_sequences in results for seq in doc_sequences]
```

**注意**：`bytes_to_unicode_map` 通过 `initializer` 传给每个 worker 进程（避免 pickle 大对象），使用全局变量存储。

### 3.5 完整训练流程

将以上组件串联，`run_train_bpe()` 的完整流程：

```
输入: 语料文件路径, 目标词表大小 V

1. 字节到 Unicode 映射          ← gpt2_bytes_to_unicode_local()
2. 初始化词表: 256 个字节 + 特殊 token
3. 加载并采样语料               ← load_and_sample_data() (mmap 内存映射)
4. 按特殊 token 分割文档        ← re.split()
5. 并行预分词                    ← parallel_pre_tokenize()
6. 构建 BPE 索引                 ← BPEIndex(sequences)
7. BPE 训练主循环:
   while |词表| < V:
       pair = 索引.get_most_frequent()    # O(log N)
       if pair is None: break
       new_token = pair[0] + pair[1]
       索引.merge_pair(pair, new_token)    # 增量更新
       词表[new_id] = new_token_bytes
       merges.append(pair)
8. 保存词表和合并规则

输出: vocab (Dict[int, bytes]), merges (List[Tuple[bytes, bytes]])
```

---

## 4. 特殊 Token

特殊 Token 是 tokenizer 中具有特殊语义的标记，它们不对应任何自然语言文本，而是用于控制模型的结构化行为。可以类比为编程语言中的"关键字"——它们不是数据，而是控制流。

### 常见特殊 Token 类型

| Token | 作用 | 使用场景 | 代表模型 |
|-------|------|---------|---------|
| `<\|endoftext\|>` | 文档分隔符 | 预训练时分隔不同文档 | GPT-2/3/4 |
| `<\|im_start\|>` / `<\|im_end\|>` | 对话角色边界 | SFT 时标记 user/assistant/system | **Qwen3.5**, ChatGPT |
| `<pad>` | 填充 | 训练时对齐 batch 内序列长度 | 几乎所有模型 |
| `<unk>` | 未知 token | OOV 回退（字节级 BPE 中极少触发） | 传统模型 |
| `<bos>` / `<eos>` | 序列起始 / 结束 | 生成时标记边界 | LLaMA, T5 |

#### 特殊 Token 解析

1.  `<|endoftext|>`
```
文档1: "今天天气真好"  ->  文档2: "深度学习很有趣"
解析：模型可能学到 "好深度" 这样的虚假搭配
```


加上 `endoftext` 后:

```
文档1: 今天天气真好  +  <|endoftext|> +  文档2: 深度学习很有趣
解析：模型知道这是两个独立文档，不会跨文档学习虚假关联
```

2.  `<unk>` 

`unk`：在字节级 BPE 中，理论上不会触发（256 字节覆盖所有可能的输入）。但如果词表文件损坏或 token_id 无效，`unk` 作为安全回退。

3. `<pad>`

`pad`：训练时 batch 内序列长度不同，短序列需要填充到统一长度。pad token 不参与 loss 计算（通过 label masking 实现）。

```python
# 填充示例
batch = [
    [101, 2003, 1037, 3231, 102],       # 长度 5
    [101, 2023, 2003, 102],              # 长度 4
    [101, 7592, 102],                    # 长度 3
]
# 填充后:
batch = [
    [101, 2003, 1037, 3231, 102],
    [101, 2023, 2003, 102,    0],        # 0 = pad
    [101, 7592, 102,    0,    0],
]
```

### 特殊 token 在 BPE 中的处理

HW1 的训练代码中，特殊 token 的处理分两步：

**步骤 1**：加载语料时，用特殊 token 作为文档分隔符切分

```python
# train_bpe.py - 加载并分割文档
text = load_and_sample_data(input_path, sample_size, special_token="endoftext")
# 特殊 token 被用作分隔符，不会出现在文档文本中
escaped_tokens = [re.escape(st) for st in special_tokens]
split_pattern = "\|".join(escaped_tokens)
documents = [part for part in re.split(split_pattern, text) if part]
```

**步骤 2**：预分词时，只对文档文本做分词，特殊 token 已被移除

**步骤 3**：特殊 token 直接加入词表，不经过 BPE 合并

```python
# 初始化词表
vocab = {i: bytes([i]) for i in range(256)}  # 256 个字节
next_token_id = 256
# 特殊 token 直接加入词表
for st in special_tokens:
    st_bytes = st.encode("utf-8")
    if st_bytes not in existing_bytes and len(vocab) < vocab_size:
        vocab[next_token_id] = st_bytes
        next_token_id += 1
```

### 编码阶段

编码时，特殊 token 需要**优先识别**，再对普通文本做 BPE：

```python
# BPETokenizer.encode()
sorted_special_tokens = sorted(self.special_tokens, key=len, reverse=True)
special_token_pattern = '|'.join(map(regex.escape, sorted_special_tokens))
# 按特殊 token 切分文本，保留特殊 token 本身
chunks = regex.split(f'({special_token_pattern})', text)
```

**为什么按长度降序排序？** 避免短 token 误匹配长 token 的前缀。例如如果同时有 &lt;pad> 和 &lt;pad_token>，先匹配长的。

### 与 Qwen3.5 的关系

Qwen3.5 使用 ChatML 格式，通过特殊 token 标记对话结构：

```
<|im_start|>system
You are a helpful assistant.
<|im_end|>
<|im_start|>user
你好，请介绍一下你自己。
<|im_end|>
<|im_start|>assistant
你好！我是 Qwen3.5，一个大语言模型。
<|im_end|>
```

在预训练阶段，&lt;|endoftext|> 作为文档分隔符；在 SFT 阶段，&lt;|im_start|> 和 &lt;|im_end|> 标记角色边界。模型通过这些特殊 token 学会什么时候该说话、什么时候该停止。

---

## 5. BPETokenizer：编码与解码详解

HW1 实现了一个完整的 BPE Tokenizer 类。下面逐步解析其核心方法。

### 初始化：加载词表和合并规则

```python
class BPETokenizer:
    def __init__(self, vocab_path: str, merges_path: str):
        self.vocab = self._load_vocab(vocab_path)      # Dict[int, bytes]
        self.merges = self._load_merges(merges_path)   # List[Tuple[bytes, bytes]]
        self.bytes_to_id = {bytes_val: idx for idx, bytes_val in self.vocab.items()}
        self.special_to_id = dict()  # 特殊 token -> ID
        # 合并优先级：merges 列表的索引越小，优先级越高
        self.merge_priority_map = {pair: i for i, pair in enumerate(self.merges)}
```

### BPE 合并：_get_bpe_merges()

这是 Tokenizer 最核心的方法——将一个字节序列通过 BPE 合并规则拆分成 token：

```python
def _get_bpe_merges(self, piece: bytes) -> List[bytes]:
    # 1. 字节序列 -> Unicode 字符序列
    unicode_str = self._bytes_to_unicode_str(piece)
    parts = [bytes([self.unicode_to_bytes[c]]) for c in unicode_str]

    # 2. 迭代合并
    while len(parts) > 1:
        # 找出当前序列中所有在 merges 中的相邻对
        pairs = set()
        for i in range(len(parts) - 1):
            pair = (parts[i], parts[i + 1])
            if pair in self.merge_priority_map:
                pairs.add(pair)
        if not pairs:
            break  # 没有可合并的对了

        # 选择优先级最高的对（merges 列表中索引最小）
        best_pair = min(pairs, key=lambda p: self.merge_priority_map[p])

        # 执行合并
        new_parts = []
        i = 0
        while i < len(parts):
            if i < len(parts)-1 and (parts[i], parts[i+1]) == best_pair:
                new_parts.append(parts[i] + parts[i+1])  # 合并
                i += 2
            else:
                new_parts.append(parts[i])  # 保持不变
                i += 1
        parts = new_parts
    return parts
```

### 编码：encode()

完整编码流程：文本 -> token_ids

```python
def encode(self, text: str) -> List[int]:
    if not text: return []

    # 步骤 1: 按特殊 token 切分
    chunks = regex.split(f'({special_token_pattern})', text)

    token_ids = []
    for chunk in chunks:
        if chunk in self.special_tokens:
            # 步骤 2a: 特殊 token 直接查表
            token_ids.append(self.special_to_id[chunk])
        else:
            # 步骤 2b: 普通文本走 BPE 流程
            words = regex.findall(GPT2_SPLIT_PATTERN, chunk)
            for word in words:
                word_bytes = word.encode('utf-8')
                pieces = self._get_bpe_merges(word_bytes)
                for piece in pieces:
                    token_ids.append(self.bytes_to_id[piece])
    return token_ids
```

### 解码：decode()

解码是编码的逆过程，更简单：

```python
def decode(self, token_ids: List[int]) -> str:
    byte_sequence = b''
    for token_id in token_ids:
        if token_id in self.vocab:
            byte_sequence += self.vocab[token_id]  # 查表得字节
        else:
            # OOV 回退到 <unk>
            byte_sequence += self.vocab[self.special_to_id['<unk>']]
    return byte_sequence.decode('utf-8', errors='replace')
```

**关键洞察**：vocab 的 value 是 **bytes** 类型而非 string。这意味着 Tokenizer 的本质是**字节到 ID 的映射**，而非字符到 ID。这也是字节级 BPE 能处理任意编码文本的原因。

### tokenize()：可视化分词结果

tokenize() 方法将文本拆分为可读的 token 列表，方便调试：

```python
def tokenize(self, text: str) -> List[str]:
    token_ids = self.encode(text)
    tokens = []
    for token_id in token_ids:
        if token_id in self.vocab:
            tokens.append(self.vocab[token_id].decode('utf-8'))
        else:
            tokens.append('<INVALID_TOKEN>')
    return tokens
```

**实际运行示例**（HW1 output.txt）：

```
文本: Wow, that is great
编码 (10 tokens): [1585, 44, 32, 303, 302, 32, 293, 32, 3819, 302]
解码: Wow, that is great
Token示例: ['Wow', ',', ' ', 'th', 'at', ' ', 'is', ' ', 'gre', 'at']
```

### 往返一致性（Round-trip Consistency）

一个好的 tokenizer 应满足：编码后解码和最开始的保持一致。

HW1 的测试结果验证了这一点：

```
文本: you can eat
编码 (6 tokens): [9396, 32, 4111, 32, 367, 116]
解码: you can eat
往返一致: YES
```


---

## 6. 总结

### Tokenizer 与各组件/阶段的关联

| 组件/阶段 | 与 Tokenizer 的关系 |
|------|-------------------|
| **MLP** | Embedding 层的参数矩阵大小 = vocab_size x hidden_size，直接由 Tokenizer 决定 |
| **位置编码** | RoPE 编码的位置范围 = 序列长度，而序列长度 = Tokenizer 分词后的 token 数 |
| **注意力机制** | 注意力矩阵大小 = seq_len x seq_len，Tokenizer 影响 seq_len |
| **线性注意力** | 同上，线性注意力的递归状态也依赖 token 序列 |
| **预训练** | 语料需要先被 Tokenizer 编码为 token_ids，**打包成固定长度序列** |
| **SFT** | SFT 数据的 conversations 需要 Tokenizer 编码，特殊 token 标记角色边界 |

### 关键要点

1. **BPE 是贪心算法**：每轮合并最高频对，不保证全局最优，但实践效果好
2. **字节级 BPE 零 OOV**：256 字节为基础词表，任何文本都能编码
3. **预分词是必要的**：正则切分保证一致的分词边界，避免跨词合并
4. **高效实现很关键**：堆+倒排索引+增量更新，将训练从 O(VN) 优化到可接受范围
5. **Tokenizer 决定模型的输入空间**：词表大小直接影响 embedding 参数量和序列长度
6. **特殊 token 控制模型行为**：文档分隔、对话角色标记、填充对齐
7. **encode/decode 的往返一致性**：是 tokenizer 正确性的基本检验

### 性能数据参考（个人HW1 实际运行）

| 指标 | 数值 |
|------|------|
| 训练语料 | TinyStoriesV2-GPT4-train.txt |
| 采样文档数 | 22,000 |
| 目标词表大小 | 10,000 |
| 预分词后 token 序列数 | 4,274,123 |
| BPE 合并数 | 9,741 |
| 训练耗时 | ~42 分钟 |
| 峰值内存 | 1.50 GB |

---
