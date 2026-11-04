---
title: Mat Transpose (CuTe)
order: 10
---

# Mat Transpose CuTe 版代码学习

> 本人学习笔记，AI总结

[09 篇](./09-mat-transpose.md)用手写 CUDA 把转置的访存优化推到了 0.0039ms。本篇用 **CuTe**（CUTLASS 的 layout DSL）把同一堆 kernel 重写一遍——性能持平（最优 0.0041ms vs 手写 0.0039ms），但**表达方式完全不同**：09 里手调的下标体操（`(local_y%4)*4`、padding、float4 拆组）全部消失，取而代之的是几个 Layout 对象的组合。本篇回答一个问题：**CuTe 到底抽象掉了什么**。

先声明学习预期：CuTe 是"描述 layout 的代数系统"，抽象层次高、类型体操重，第一遍**看懂每一行类型不现实**。本篇抓主线：五个版本的递进（reg → smem → swizzle → 向量化 → 三段式），每个版本只抠"它比上一版多了哪个 layout 原语、对应 09 的哪个手工技巧"。

## CuTe 三要素（10 分钟速成）

CuTe 的世界观：**一切数据布局 = Layout（Shape + Stride）**，一切数据搬运 = 对 Tensor（指针 + Layout）的 `copy`。

```c++
// Shape: 每个维度多大;  Stride: 沿该维度走一步, 地址跳多少
make_layout(make_shape(1024, 1024), GenRowMajor{})
// = Shape<(1024,1024), Stride<(1,1024)>>
// 即: m(i, j) 的地址 = i*1 + j*1024
```

**一个必须先说的坑：CuTe 的维度顺序和 C 语言是反的。** C 里 `x[r][c]` 第一维是行号（stride 大），第二维是列（stride=1，行内连续）；CuTe 的 `m(i,j)` 里 **stride=1 的那一维排在第 0 位**——`m(i,j)` 的 i 是"行内偏移"、j 是"行号"。同样是 row-major 存储，C 是 `(行, 列)`，CuTe 是 `(行内位置, 行)`。本篇所有 `mA(i, j)` 都按 CuTe 的顺序理解；对应到 09 的手写记号 `x[row][col]` 时要转一下：`mA(col, row)`。

```c++
// 对照示例: 同一块内存的两种"读法"
make_layout(make_shape(M, N), GenRowMajor{})  // Stride<(1,N)>: 第0维连续(row-major)
make_layout(make_shape(M, N), GenColMajor{})  // Stride<(M,1)>: 第1维连续(col-major)
// GenRowMajor/GenColMajor 说的都是"第 0 维是不是 stride=1 那个维"
```

三个核心原语（本篇全部 kernel 只用这几个）。初学最大的障碍是"它们返回的东西到底是什么"——答案是：**全是视图，一层套一层**。用一组贯穿的数字走一遍：设矩阵 `x` 是 1024×1024，block 切 16×16 的 tile，当前 block 是 `(bx=3, by=5)`，当前线程编号 `tx=100`。

---

**原语 1：`make_tensor` —— 指针 + layout = 可索引的视图**

```c++
auto mA = make_tensor(make_gmem_ptr(pA),
                      make_layout(make_shape(M, N), GenRowMajor{}));
mA(i, j);   // 地址 = pA + i*1 + j*1024, 由 layout 算出
```

它**不搬任何数据**，只是造了一个"带形状的指针"。`mA(i,j)` 等价于手写 `pA[i + j*1024]`（注意 CuTe 维度顺序：i 是行内偏移、j 是行号）。到这里为止，它相比裸指针只多做了一件事：**把"这块内存长什么样"记在了类型里**。

---

**原语 2：`local_tile` —— 从大张量里切出"我这个 block 管的那一块"**

```c++
auto gA = local_tile(mA, make_shape(Int<16>{}, Int<16>{}), make_coord(bx, by));
```

三个参数：从 `mA` 切；切成 16×16 的块；取第 `(bx, by)` 块。还是**纯视图**，地址运算而已。关键是 `gA(i,j)` 的坐标含义变了——**从"全矩阵坐标"变成"tile 内坐标"**。算一下 `gA(i,j)` 实际指向哪：

```
mA 的第 (bx, by) 块 tile 覆盖全矩阵的:
  行内偏移: [bx*16, bx*16+16) = [48, 64)
  行号:     [by*16, by*16+16) = [80, 96)

所以:  gA(i, j)  (i,j ∈ [0,16))
    =  mA(bx*16 + i, by*16 + j)      ← tile 内坐标 + 块起点偏移
    =  pA[(bx*16 + i) + (by*16 + j)*1024]
```

对照 09 手写版的 `global_x = blockIdx.x * blockDim.x + threadIdx.x`——**local_tile 干的就是这个"block 起点偏移"**，只是它把结果做成一个新视图，后续代码直接用 tile 内坐标 (i,j)，不用再背着 block 偏移。

---

**原语 3：`local_partition` —— 把 tile 按线程再切，切出"我这个线程管的元素"**

```c++
auto tAgA = local_partition(gA, tA, tx);
```

三个参数：切 `gA`；按**线程布局** `tA` 切；返回第 `tx` 号线程的那一份。先解释 `tA`——它本身也是一个 layout：

```c++
auto tA = make_layout(make_shape(Int<16>{}, Int<16>{}), GenColMajor{});
// 含义: 256 个线程摆成 16×16 的"线程方阵", 编号优先沿第 0 维排
```

`local_partition(gA, tA, tx)` 做的事：**把 gA 的 256 个元素按 tA 的摆法分配给 256 个线程，返回属于 tx 的那一两个元素的视图**。算一下 tx=100 分到哪个格子：

```
tA 是 ColMajor: tx = 100 → (i = 100 % 16, j = 100 / 16) = (4, 6)
即: 100 号线程站在"线程方阵"的第 (4, 6) 格
它分到 gA 的元素: tAgA() = gA(4, 6)
    = pA[48+4 + (80+6)*1024]        (接着上面 block(3,5) 的例子)
```

本篇的 kernel 里每线程只管 1 个元素，所以 `tAgA()` 是个**零维张量**（直接 `tAgA()` 取值，没有下标）；向量化版本每线程管 4 个，`tAgA(0..3)` 是一维的。

对照 09：`local_partition` 干的就是 `threadIdx.x/threadIdx.y → tile 内 (local_x, local_y)` 的换算——09 里 `local_y = tid / 16, local_x = tid % 16` 那一行，在这里是 tA 的 `GenColMajor` 一个词。

---

**三层视图叠起来的完整图景**：

```
mA  (全矩阵视图, 全矩阵坐标)
 └─ local_tile(mA, 16×16, (bx,by)) → gA   (block 的 tile 视图, tile 内坐标)
     └─ local_partition(gA, tA, tx) → tAgA (线程的元素视图, 直接取值)

手写版对应物:
  mA        ↔ 裸指针 pA + "形状是 M*N" 的心智模型
  gA        ↔ blockIdx*16 + threadIdx 的 block 偏移换算
  tAgA      ↔ threadIdx → (local_x, local_y) 的除法/取模
```

**手写版把这三层换算揉在同一个下标公式里**（`y[global_y*row + global_x]` 一行里同时有 block 偏移、线程坐标、地址乘加）；**CuTe 把它们拆成三层显式的视图**——每层做一件小事，最后 `copy_if(tApA, tAgA, tBgB)` 里源和目标已经是"本线程的源、本线程的目标"，copy 只剩纯搬运。**CuTe 抽象掉的不是计算，是"层次"**。

**和 09 手写的对照**：

```
手写:  y[global_y * row + global_x] = x[global_x * col + global_y]
        ↑ 下标公式手工推导, 编译器不知道结构

CuTe:  mA/mB 的 layout 描述了 x/y 的形状
       local_tile + local_partition 算出本线程的 gA/gB
       copy_if(...) 一行完成搬运
        ↑ 结构写在类型里, 编译器看得见, 能自动优化
```

**最大的区别**：手写版里 `global_x * col + global_y` 只是运行时的整数运算；CuTe 里 `Shape<16,16>, Stride<1,16>` 是**编译期类型**，编译器知道"这是一个 16×16 行主序 tile"的全部结构——所以它能自动判断对齐、自动选 copy 指令（`AutoVectorizingCopy`）、自动避开 bank conflict（swizzle）。**这就是 09 手工技巧能被抽象的根基：结构信息从"运行时数字"升级成"编译期类型"**。

## 完整代码

### `mat_transpose_cute.cu`
<details>
<summary> mat_transpose_cute.cu（前半：reg/smem/swizzle 版）</summary>

```c++
#include <cuda_runtime.h>
#include <stdio.h>
#include <torch/extension.h>

#include <cute/layout.hpp>
#include <cute/tensor.hpp>
using namespace cute;

#define UNIT_BLK_SIZE 16

#define CUDA_CHECK(call)                                                       \
  do {                                                                         \
    cudaError_t err = call;                                                    \
    if (err != cudaSuccess) {                                                  \
      fprintf(stderr, "CUDA error at %s:%d: %s\n", __FILE__, __LINE__,         \
              cudaGetErrorString(err));                                         \
      exit(EXIT_FAILURE);                                                      \
    }                                                                          \
  } while (0)

template <typename T, int BLK_M, int BLK_N, typename ThreadLayoutA,
          typename ThreadLayoutB>
__global__ void mat_transpose_cute_reg_kernel(const T *pA, T *pB, int M, int N,
                                              ThreadLayoutA tA,
                                              ThreadLayoutB tB) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{})); // (M, N)
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{})); // (N, M)

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)
  auto cA = local_tile(make_identity_tensor(mA.shape()),
                       make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)

  Tensor tAgA = local_partition(gA, tA, tx);
  Tensor tBgB = local_partition(gB, tB, tx);
  Tensor tAcA = local_partition(cA, tA, tx);

  Tensor tApA = make_tensor<bool>(tAcA.shape(), tAcA.stride());
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tApA); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tApA); j++) {
      tApA(i, j) = get<0>(tAcA(i, j)) < M && get<1>(tAcA(i, j)) < N;
    }
  }
  copy_if(tApA, tAgA, tBgB);
}

void mat_transpose_cute_row2col_reg(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_reg_kernel<float, BM, BN, decltype(tA), decltype(tB)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB);
  CUDA_CHECK(cudaGetLastError());
}

void mat_transpose_cute_col2row_reg(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_reg_kernel<float, BM, BN, decltype(tA), decltype(tB)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB);
  CUDA_CHECK(cudaGetLastError());
}

template <typename T, int BLK_M, int BLK_N, typename ThreadLayoutA,
          typename ThreadLayoutB, typename SmemLayoutA, typename SmemLayoutB>
__global__ void
mat_transpose_cute_smem_kernel(const T *pA, T *pB, int M, int N,
                               ThreadLayoutA tA, ThreadLayoutB tB,
                               SmemLayoutA sA_layout, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{})); // (M, N)
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{})); // (N, M)

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)
  auto cA = local_tile(make_identity_tensor(mA.shape()),
                       make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto cB = local_tile(make_identity_tensor(mB.shape()),
                       make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)

  __shared__ T smem[BLK_M * BLK_N];
  auto sA = make_tensor(make_smem_ptr(smem), sA_layout); // (BM, BN)
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout); // (BN, BM)

  Tensor tAgA = local_partition(gA, tA, tx);
  Tensor tBgB = local_partition(gB, tB, tx);
  Tensor tAsA = local_partition(sA, tA, tx);
  Tensor tBsB = local_partition(sB, tB, tx);
  Tensor tAcA = local_partition(cA, tA, tx);
  Tensor tBcB = local_partition(cB, tB, tx);

  // 边界 mask: 用 identity tensor 算每个元素的全局坐标, 判断是否越界
  Tensor tApA = make_tensor<bool>(tAcA.shape(), tAcA.stride());
  Tensor tBpB = make_tensor<bool>(tBcB.shape(), tBcB.stride());
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tApA); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tApA); j++) {
      tApA(i, j) = get<0>(tAcA(i, j)) < M && get<1>(tAcA(i, j)) < N;
    }
  }
  CUTE_UNROLL
  for (int i = 0; i < size<0>(tBpB); i++) {
    CUTE_UNROLL
    for (int j = 0; j < size<1>(tBpB); j++) {
      tBpB(i, j) = get<0>(tBcB(i, j)) < N && get<1>(tBcB(i, j)) < M;
    }
  }
  copy_if(tApA, tAgA, tAsA);      // gmem -> smem (A 的布局)
  __syncthreads();
  copy_if(tBpB, tBsB, tBgB);      // smem (B 的布局) -> gmem
}

constexpr int log2(int x) {
  assert(x > 0);
  return (x & (x - 1)) == 0 ? __builtin_ctz(x)
                            : (throw "x is not a power of 2", 0);
}

void mat_transpose_cute_col_smem(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  auto sA_layout = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto sB_layout = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_kernel<float, BM, BN, decltype(tA), decltype(tB),
                                 decltype(sA_layout), decltype(sB_layout)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB,
                        sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}

// row_smem / col_smem_swizzled / row_smem_swizzled 同构, 详见仓库源文件

void mat_transpose_cute_col_smem_swizzled(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE;
  const int BN = UNIT_BLK_SIZE;
  const int M = x.size(0);
  const int N = x.size(1);
  auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
  auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
  const int S = log2(BM);
  auto swizzle_func = Swizzle<S, 0, S>{};                    // ★ swizzle
  auto sA_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{}));
  auto sB_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{}));
  static_assert(size(tA) == size(tB));
  dim3 block(size(tA));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_kernel<float, BM, BN, decltype(tA), decltype(tB),
                                 decltype(sA_layout), decltype(sB_layout)>
      <<<grid, block>>>(x.data_ptr<float>(), y.data_ptr<float>(), M, N, tA, tB,
                        sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}
```

</details>

<details>
<summary> mat_transpose_cute.cu（后半：向量化与 optimized 版，含关键 host 函数）</summary>

```c++
__host__ __device__ inline bool is_aligned_128(const void *ptr) {
  return (reinterpret_cast<uintptr_t>(ptr) & 0xF) == 0;
}

// 向量化版 kernel: 用 TiledCopy 描述"线程怎么合作拷 tile"
template <typename T, int BLK_M, int BLK_N, typename TiledCopyA,
          typename TiledCopyB, typename SmemLayoutA, typename SmemLayoutB>
__global__ void mat_transpose_cute_smem_vectorized_kernel(
    const T *pA, T *pB, int M, int N, TiledCopyA copy_a, TiledCopyB copy_b,
    SmemLayoutA sA_layout, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{}));
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{}));

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by)); // (BM, BN)
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx)); // (BN, BM)

  __shared__ T smem[BLK_M * BLK_N];
  auto sA = make_tensor(make_smem_ptr(smem), sA_layout);
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout);

  // TiledCopy: 一等公民的"拷贝计划" —— 线程怎么摆 + 每线程拷几个
  auto thr_copy_a = copy_a.get_slice(tx);
  Tensor tAgA = thr_copy_a.partition_S(gA);   // 本线程的源切片
  Tensor tAsA = thr_copy_a.partition_D(sA);   // 本线程的目标切片

  auto thr_copy_b = copy_b.get_slice(tx);
  Tensor tBsB = thr_copy_b.partition_S(sB);
  Tensor tBgB = thr_copy_b.partition_D(gB);

  copy(copy_a, tAgA, tAsA);       // AutoVectorizingCopy: 编译器自动发 float4!
  __syncthreads();
  copy(copy_b, tBsB, tBgB);
}

void mat_transpose_cute_row_cvectorized(torch::Tensor x, torch::Tensor y) {
  const int BM = UNIT_BLK_SIZE * 4;    // 64
  const int BN = UNIT_BLK_SIZE;        // 16
  auto ptr_A = x.data_ptr<float>();
  auto ptr_B = y.data_ptr<float>();
  const int M = x.size(0);
  const int N = x.size(1);

  // sanity checks: 向量化前提 = 形状 4 对齐 + 指针 16B 对齐 (04 的老朋友)
  assert(M % 4 == 0);
  assert(N % 4 == 0);
  assert(is_aligned_128(ptr_A));
  assert(is_aligned_128(ptr_B));

  // 线程摆 (BM/4, BN) 个位置, 每线程值布局 (4,1) —— 读端每线程连取 4 个
  auto tile_copy_a = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BM / 4>{}, Int<BN>{}), GenRowMajor{}),
      make_layout(make_shape(Int<4>{}, Int<1>{}), GenRowMajor{}));
  // 写端镜像: 线程摆 (BN, BM/4), 每线程值布局 (1,4) —— 写端连写 4 个
  auto tile_copy_b = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BN>{}, Int<BM / 4>{}), GenRowMajor{}),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));
  auto sA_layout = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
  auto sB_layout = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});

  static_assert(size(tile_copy_a) == size(tile_copy_b));
  dim3 block(size(tile_copy_a));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);
  mat_transpose_cute_smem_vectorized_kernel<
      float, BM, BN, decltype(tile_copy_a), decltype(tile_copy_b),
      decltype(sA_layout), decltype(sB_layout)><<<grid, block>>>(
      ptr_A, ptr_B, M, N, tile_copy_a, tile_copy_b, sA_layout, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}

// rvectorized / cvectorized_swizzled / rvectorized_swizzled 同构,
// 区别只在 tile_copy 的 shape 和 swizzle 与否, 详见仓库源文件

// 最终优化版: 三段式 (gmem->reg -> reg 重排 -> smem -> gmem), BM=8, BN=128
template <typename T, int BLK_M, int BLK_N, typename TiledCopyA,
          typename TiledCopyTrans, typename TiledCopyB, typename SmemLayoutB>
__global__ void mat_transpose_cute_smem_vectorized_optimized_kernel(
    const T *pA, T *pB, int M, int N, TiledCopyA copy_a,
    TiledCopyTrans copy_trans, TiledCopyB copy_b, SmemLayoutB sB_layout) {
  int tx = threadIdx.x;
  int bx = blockIdx.x, by = blockIdx.y;

  auto mA = make_tensor(make_gmem_ptr(pA),
                        make_layout(make_shape(M, N), GenRowMajor{}));
  auto mB = make_tensor(make_gmem_ptr(pB),
                        make_layout(make_shape(N, M), GenRowMajor{}));

  auto gA = local_tile(mA, make_shape(Int<BLK_M>{}, Int<BLK_N>{}),
                       make_coord(bx, by));
  auto gB = local_tile(mB, make_shape(Int<BLK_N>{}, Int<BLK_M>{}),
                       make_coord(by, bx));

  __shared__ T smem[BLK_M * BLK_N];
  auto sB = make_tensor(make_smem_ptr(smem), sB_layout);   // 只有 B 的布局

  // 第 1 段: gmem -> 寄存器 (走 A 的读布局, 连读)
  auto thr_copy_a = copy_a.get_slice(tx);
  Tensor tAgA = thr_copy_a.partition_S(gA);
  auto tAsA = make_tensor_like(tAgA);              // 寄存器张量!
  Tensor tAsA_view = thr_copy_a.retile_D(tAsA);
  copy(copy_a, tAgA, tAsA_view);

  // 第 2 段: 寄存器内重排 (转置发生在这里, 全在寄存器!)
  auto thr_copy_trans = copy_trans.get_slice(tx);
  auto tAsB = thr_copy_trans.retile_S(tAsA);
  auto tBsB_trans = thr_copy_trans.partition_D(sB);
  copy(copy_trans, tAsB, tBsB_trans);

  // 第 3 段: smem -> gmem (走 B 的写布局, 连写)
  auto thr_copy_b = copy_b.get_slice(tx);
  Tensor tBsB = thr_copy_b.partition_S(sB);
  Tensor tBgB = thr_copy_b.partition_D(gB);
  copy(copy_b, tBsB, tBgB);
}

void mat_transpose_cute_row_rvectorized_swizzled_optimized(torch::Tensor x,
                                                           torch::Tensor y) {
  const int BM = 8;
  const int BN = 16 * 8;    // 128
  auto ptr_A = x.data_ptr<float>();
  auto ptr_B = y.data_ptr<float>();
  const int M = x.size(0);
  const int N = x.size(1);

  assert(M % 4 == 0);
  assert(N % 4 == 0);
  assert(is_aligned_128(ptr_A));
  assert(is_aligned_128(ptr_B));

  // 一次性加载 8*16 大小的矩阵
  auto tile_copy_a = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BM>{}, make_shape(Int<4>{}, Int<BN / 16>{})),
                  make_stride(Int<4>{}, make_stride(Int<1>{}, Int<32>{}))),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));

  // 转换数据
  auto tile_copy_trans = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(make_shape(Int<4>{}, Int<BN / 16>{}), Int<BM>{}),
                  make_stride(make_stride(Int<1>{}, Int<32>{}), Int<4>{})),
      make_layout(make_shape(Int<4>{}, Int<1>{}), GenRowMajor{}));

  // 一次性存储 16*8 大小的矩阵
  auto tile_copy_b = make_tiled_copy(
      Copy_Atom<AutoVectorizingCopy, float>{},
      make_layout(make_shape(Int<BN>{}, Int<BM / 4>{}), GenRowMajor{}),
      make_layout(make_shape(Int<1>{}, Int<4>{}), GenRowMajor{}));

  auto swizzle_func = Swizzle<2, 3, 2>{};
  auto sB_layout =
      composition(swizzle_func,
                  make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{}));

  static_assert(size(tile_copy_a) == size(tile_copy_b));

  dim3 block(size(tile_copy_a));
  dim3 grid((M + BM - 1) / BM, (N + BN - 1) / BN);

  mat_transpose_cute_smem_vectorized_optimized_kernel<
      float, BM, BN, decltype(tile_copy_a), decltype(tile_copy_trans),
      decltype(tile_copy_b), decltype(sB_layout)><<<grid, block>>>(
      ptr_A, ptr_B, M, N, tile_copy_a, tile_copy_trans, tile_copy_b, sB_layout);
  CUDA_CHECK(cudaGetLastError());
}
```

</details>

## 逐版本剖析

五个版本是一条递进链，每个版本只引入一个新东西。三要素（make_tensor/local_tile/local_partition）上节已拆透，本节引用不重讲。

### 版本 1：reg 版 —— "选边"变成参数

kernel 体（`make_tensor → local_tile → local_partition → copy_if`）上节的三个原语就是照着它讲的，不重复。这里看**增量**——host 侧那两行 ThreadLayout：

```c++
// row2col 版的 host:
auto tA = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenColMajor{});
auto tB = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenRowMajor{});
// col2row 版的 host: tA 换 GenRowMajor, tB 换 GenColMajor —— 仅此而已
```

09 里 col2row/row2col 是**两个 kernel**（读写公式都不同）；这里是**同一个 kernel 传不同参数**。tA/tB 决定"同一个 tx 在读端 tile 和写端 tile 里各站哪格"。拿 tx=100（BM=BN=16）代入：

```
row2col:  tA ColMajor → 读端站 (100%16, 100/16) = (4, 6)
          tB RowMajor → 写端站 (100/16, 100%16) = (6, 4)   ← 互为转置!
col2row:  tA RowMajor → 读端站 (6, 4)
          tB ColMajor → 写端站 (4, 6)
```

**线程号在两端站的位置互为转置**——数据要转置，搬运它的"工人编制"也要转置。09 的"选哪边连续"在这里变成"GenRowMajor/GenColMajor 填在哪格"。

kernel 里还有一个前面没见过的东西——**越界 mask 的做法**：

```c++
auto cA = local_tile(make_identity_tensor(mA.shape()), ...);  // "坐标本身"的张量
Tensor tAcA = local_partition(cA, tA, tx);
Tensor tApA = make_tensor<bool>(tAcA.shape(), tAcA.stride()); // bool mask
CUTE_UNROLL
for (int i = 0; i < size<0>(tApA); i++)
  for (int j = 0; j < size<1>(tApA); j++)
    tApA(i, j) = get<0>(tAcA(i, j)) < M && get<1>(tAcA(i, j)) < N;
copy_if(tApA, tAgA, tBgB);
```

`make_identity_tensor` 造一个特殊的张量：**它的"值"就是坐标本身**（`cA(i,j)` 返回坐标对 `(i,j)`，不是内存里的数）。partition 之后，每个线程能拿到"我的元素的全局坐标"，于是 mask 判断 `坐标 < (M,N)` 就是越界检查——**替代手写的 `if (idx < N)`**。整段编译后等价于：每个元素先查坐标、合法才搬。这是 CuTe 处理非整除 tile 的标准姿势（09 手写版的边界 if，被统一成 mask 数组的构造）。

**模板签名的一个细节**：`ThreadLayoutA tA` 是 kernel 参数，但 layout 的 Shape/Stride 信息在**类型**里，所以模板参数必须写 `typename ThreadLayoutA`——`make_layout` 返回什么类型，kernel 就实例化什么类型。layout 对象本身是空壳（零运行时开销），**信息全在类型、实例只为让编译器推导**。这是 CuTe 的固定模式：layout 既能当"值"构造（host 侧），又能当"类型"传递（模板参数）。

实测 row2col_reg = 0.0043ms，col2row_reg = 0.0110ms——**row2col 快一倍**，09 的"保写端"法则原样复现（法则由访存物理决定，跟表达方式无关）。

### 版本 2：smem 版 —— 同一块内存的两个视图

对照 reg 版，kernel 只多了一块 smem 和两行视图；讲增量：**同一块物理内存，两个 layout 看**。

```c++
__shared__ T smem[BLK_M * BLK_N];          // 256 个 float, 裸内存
auto sA = make_tensor(make_smem_ptr(smem), sA_layout);   // 看成 (BM,BN)
auto sB = make_tensor(make_smem_ptr(smem), sB_layout);   // 看成 (BN,BM)
// host 侧:
auto sA_layout = make_layout(make_shape(Int<BM>{}, Int<BN>{}), GenRowMajor{});
auto sB_layout = make_layout(make_shape(Int<BN>{}, Int<BM>{}), GenColMajor{});
```

**用数字证明这两个视图真的指向同一块内存**（BM=BN=16）：

```
sA 是 (16,16) RowMajor → Stride<(1,16)>
    sA(i, j) 的物理位置 = i*1 + j*16
sB 是 (16,16) ColMajor → Stride<(16,1)>
    sB(i, j) 的物理位置 = i*16 + j*1

线程 P 存: sA(3, 5) → 位置 3 + 5*16 = 83
线程 Q 取: sB(5, 3) → 位置 5*16 + 3 = 83   ← 同一个格子!
```

**(3,5) 存进去、(5,3) 取出来——转置就是这两个 layout 的 stride 差**。09 手写版"存 tile[r][c]、取 tile[c][r]"的两套下标，在这里是两个 view 的 Stride<(1,16)> vs Stride<(16,1)>，编译器算地址、下标体操零行。

两次搬运和栅栏（栅栏时序 03/09 讲过，这里只看布局流向）：

```c++
copy_if(tApA, tAgA, tAsA);   // ① gmem → smem, 走 A 视角 (存)
__syncthreads();
copy_if(tBpB, tBsB, tBgB);   // ② smem → gmem, 走 B 视角 (取)
```

注意 ① 的目标是 `tAsA`（A 视角的切片）、② 的源是 `tBsB`（B 视角的切片）——**同一个 tA/tB 的 partition 切的是不同的 view**，存取两端各用各的。mask 也从一份变两份（cA/cB 各自判断越界），因为存取两端的 tile 边界可能落在不同的非整除格子上。

实测 col_smem = 0.0064ms、row_smem = 0.0043ms。

### 版本 3：swizzle 版 —— padding 的优雅替代

09 的 padding（行宽 64→65）消 bank conflict 但破坏 16B 对齐。CuTe 用 `composition` 复合一个 swizzle 函数：

```c++
const int S = log2(BM);               // BM=16 → S=4
auto swizzle_func = Swizzle<S, 0, S>{};
auto sA_layout = composition(swizzle_func, make_layout(...));
```

**`composition(f, layout)` 是函数复合**：先按 layout 算出"逻辑地址"，再过一遍 f 的比特重排得到"物理地址"。**逻辑坐标完全不变**——你写的还是 `sA(i,j)`，只是它背后落在 smem 的哪个格子被换过了。

`Swizzle<B, M, S>` 的语义：把地址的第 `[M+S, M+S+B)` 位与第 `[M, M+B)` 位**异或**。本例 `Swizzle<4,0,4>`：低 8 位里的高 4 位（行号）异或进低 4 位——**效果 = 物理列 ^= 行号**。代入（tile 16×16，逻辑地址 = r*16+c）：

```
行 0: 物理 = r*16 + (c ^ 0) = 不动
行 1: 物理 = 16 + (c ^ 1)   → 列 0↔1 交换, 2↔3 交换, ...
行 2: 物理 = 32 + (c ^ 2)   → 列 0↔2, 1↔3 交换, ...
行 3: 物理 = 48 + (c ^ 3)   → 列 0↔3, 1↔2 交换, ...
```

按列取（版本 2 的取法 `sB(c, r)`：同一逻辑列 c、扫 r=0..15）时，各行走的是物理列 `c^r`——r 不同则物理列不同，**bank 错开**（bank 机制 09 第 7 步讲透，不重复）。swizzle 与 padding 的对比：

| | padding (+1) | swizzle (c^r) |
|---|---|---|
| 消 bank conflict | ✓（行间 bank 错 1） | ✓（行间取交错列） |
| 保持 16B 对齐 | ✗（行宽 65，FLOAT4 崩） | ✓（只换位置不减宽度） |
| 代价 | 向量化退化成标量写 | 逻辑坐标 ≠ 物理位置，人脑不可追踪 |

最后一行的"代价"在 CuTe 里恰好被消化：**访问全由 copy 生成，人不需要知道物理位置**——这正是 09 说的"swizzle 手写不了、DSL 才能用"的原因：手工维护 `c^r` 的地址映射必然出错，编译器维护则免费。**swizzle 是 GEMM/FA 的 smem 标准姿势**，记住形状 `composition(Swizzle, layout)`、"物理列 ^= 行"。

实测 col_smem_swizzled = 0.0056ms（vs 无 swizzle 0.0064ms，快 12%，免费白拿）。row_smem_swizzled = 0.0042ms。

### 版本 4：向量化版 —— make_tiled_copy 三参数

前三个版本的"每线程管几个元素"都由 `local_partition` + 线程 layout 隐式决定（reg 版每线程 1 个）。向量化版引入一个**新原语**把这件事显式化：

```c++
auto tile_copy_a = make_tiled_copy(
    Copy_Atom<AutoVectorizingCopy, float>{},     // ① 搬运指令的"原子单位"
    make_layout(make_shape(Int<BM/4>{}, Int<BN>{}), GenRowMajor{}),  // ② 线程怎么摆
    make_layout(make_shape(Int<4>{}, Int<1>{}), GenRowMajor{}));     // ③ 每线程连取几个
```

三个参数各司其职：

- **② 线程 layout**：`(BM/4, BN)` = (16,16) = 256 线程摆满 tile——和版本 1 的 tA 同概念。
- **③ 值 layout**：`(4,1)`——**每个线程名下沿第 0 维连着 4 个元素**。这是"向量化发生的位置"：单线程的 4 个元素连续，才有机会合并成一条 128bit 指令。
- **① Copy_Atom**：搬运指令的选择器。`AutoVectorizingCopy` 的语义："**编译器看了源和目标的 stride/对齐后，能向量化就自动发向量指令，不能就退化成标量**"——04 讲过的"对齐才准向量化"的判断，在这里被自动化（host 侧的 `assert(is_aligned_128)` 是同样前提的人工兜底，04/13 的老知识）。

**② × ③ 合起来才是完整的分工**：16×16 的线程阵 × 每线程 4 连格 = 覆盖 64×16 的 tile。kernel 里用它的方式（对象方法链）：

```c++
auto thr_copy_a = copy_a.get_slice(tx);      // "tx 号线程的切片器"
Tensor tAgA = thr_copy_a.partition_S(gA);    // Source: 本线程的源切片
Tensor tAsA = thr_copy_a.partition_D(sA);    // Dest:   本线程的目标切片
copy(copy_a, tAgA, tAsA);                    // 按计划搬运 (源切片 → 目标切片)
```

`make_tiled_copy` 造出的是一个**拷贝计划对象**（TiledCopy）：它记住"线程怎么摆、每人搬几个、用什么指令"，但不绑定具体数据。`get_slice(tx)` 从计划里抽出本线程的那份，`partition_S/partition_D` 分别切源张量和目标张量（S/D = Source/Dest）。最后 `copy(copy_a, src, dst)` 把三者合起来执行——**计划（tiled_copy）+ 视图（partition）+ 执行（copy）三步分离**，比版本 1 的 local_partition 更进一步：连"怎么搬"都对象化了。

**"c/r 两个方向"与 09 的向量化选端**。两个变体参数对照：

```
cvectorized: BM=64, BN=16 (读端大边)
             copy_a: 线程(16,16) 值(4,1) → 读端每线程连取 4
             copy_b: 线程(16,16) 值(1,4) → 写端每线程连写 4
rvectorized: BM=16, BN=64 (写端大边)
             copy_a: 线程(16,16) 值(1,4) → 读端每线程连取 4 (沿第1维)
             copy_b: 线程(16,16) 值(4,1) → 写端每线程连写 4
```

实测 rvectorized 0.0041ms 最快，**cvectorized 0.0055ms 比不向量化的 0.0043ms 还慢**——为什么？拿真实地址模式算（cvectorized，warp 内 tx=0..31，tile 64×16 行主序 addr = i + j*64）：

```
读端 (值(4,1) 沿第0维连取):  tx=0 → [0,1,2,3]   tx=1 → [4,5,6,7]  ...
                             tx=15 → [60..63]    tx=16 → [64..67]  ...
                             → warp 32 线程覆盖 [0..127] 连续 128 float ✓ 4 条 line 打满

写端 (值(1,4) 沿第1维连写):  tx=0 → [0,16,32,48]  tx=1 → [1,17,33,49] ...
                             → 每线程的 4 个值散在 4 条 line (stride=16)
                             → warp 32 线程 × 4 值 = 128 个写地址,
                               横跨 128 条不同 line, 每条只写 4 字节 ✗✗
```

**cvectorized 把值布局 (4,1) 给了读端——而读端本来就有 thread layout 保证的连续，向量化白给；写端 (1,4) 反而让每个 warp 的写地址变成 stride=16 的梳子**——32 路散写，每条 line 的利用率 4/32。这就是 09 第 5 步"向量化错端"的 CuTe 复现，且机理更清晰：**值布局必须配合数据的连续方向，(4,1) 和 (1,4) 填错位置就是把梳子访存亲手写进计划里**。

### 版本 5：optimized 版 —— 转置搬进寄存器

最终版换了架构：**smem 降级为"写端暂存"，转置本身在寄存器完成**。三段数据流：

```
① gmem → 寄存器     (copy_a: 读布局, 连读 8×16 块)
② 寄存器 → 寄存器重排 (copy_trans: 转置发生在这里, 不经过 smem!)
③ 寄存器 → smem     (swizzle 布局) → gmem  (copy_b: 写布局, 连写)
```

代码里的新面孔只有两个：

```c++
auto tAsA = make_tensor_like(tAgA);              // 寄存器张量: 形状同 tAgA,
                                                // 但后端是本地寄存器数组
copy(copy_a, tAgA, tAsA_view);                   // ① 落脚点不是 smem, 是寄存器

auto tAsB = thr_copy_trans.retile_S(tAsA);       // ② 同一块寄存器, 按 B 的
                                                //    视角重新切片 (retile)
copy(copy_trans, tAsB, tBsB_trans);              //    重排即转置
```

`make_tensor_like(x)`：造一个和 x 同形状的**寄存器张量**（数据在本线程的寄存器/本地存储，不占 smem、不占 gmem）。`retile_S`：把这块寄存器**换个切法看**——版本 2 的"同一块内存两个视图"（smem 版）在寄存器上重演：A 视角存、B 视角取，夹角即转置。**转置从"过一遍 smem"变成"寄存器数组换个下标"**，省掉一次 smem 往返。

形状选择也值得看一眼：`BM=8, BN=128`——读端 8 行短块（8 行连续一次性进寄存器，寄存器装得下），写端 128 宽长条（一次铺满 4 条 line）。tile 形状随"寄存器容量 / line 宽度"调，不是拍脑袋。

`Swizzle<2,3,2>` 与版本 3 的 `<4,0,4>` 参数不同（B/M/S 按 tile 形状和访问模式调，无万能值）——CUTLASS 代码里满屏 `Swizzle<3,4,3>` 的来源。host 侧那两个嵌套 shape（`make_shape(Int<BM>, make_shape(Int<4>, Int<BN/16>))`）是 CuTe 的分层 layout 语法（把值组织成 (4, BN/16) 子结构以匹配 swizzle 粒度），本篇不深入——知道"形状分层、匹配 swizzle"即可。

实测 **0.0041ms**，CuTe 全家最优（与 rvectorized 持平，但架构上多走了寄存器这条路，为 GEMM 的多级流水打样）。

## 实测数据（4090, M=N=1024，与 09 手写对照）

| kernel | 时间 | 对应 09 手写 |
|---|---|---|
| cute col2row_reg | 0.0110ms | f32_col2row 0.0318ms |
| cute row2col_reg | 0.0043ms | f32_row2col(2d) 0.0047ms |
| cute col_smem | 0.0064ms | — |
| cute row_smem | 0.0043ms | — |
| cute col_smem_swizzled | 0.0056ms | — |
| cute row_smem_swizzled | 0.0042ms | — |
| cute row_cvectorized | 0.0055ms | f32x4_col2row（向量化错端的坑）|
| cute row_rvectorized | 0.0041ms | f32x4_row2col(2d) 0.0039ms |
| cute **rvectorized_swizzled_optimized** | **0.0041ms** | 手写最优 0.0039ms |

- CuTe 最优 ≈ 手写最优（0.0041 vs 0.0039ms，差 5%）——**DSL 不改变性能天花板**。
- 09 的所有经验法则在 CuTe 数据里全部复现：保写端（row 系快）、向量化选对端（rvec 快 cvec 慢）、swizzle 免费。**物理规律与表达方式无关，CuTe 只是让你写得更省、错得更少**。

## 本篇小结

1. **CuTe 三要素**：`make_tensor`（指针+布局=视图）、`local_tile`（切 block）、`local_partition`（切线程）；搬运 = `copy/copy_if` 一行。
2. **结构与类型**：手写下标是运行时数字，CuTe layout 是编译期类型——编译器因此能自动向量化（AutoVectorizingCopy）、自动生成 swizzle 访问。
3. **转置 = 同一块内存的两个正交视图**：smem 版用 sA/sB 两个 layout 看同一块 smem，"横进竖出"变成视图差异，下标体操消失。
4. **Swizzle**：`c ^= r` 式比特交错替代 padding——消 bank conflict 且**保 16B 对齐**（padding 的痛点），GEMM/FA 的标准姿势；参数 (B,M,S) 按 tile 形状调。
5. **寄存器转置**（optimized 版）：`make_tensor_like` + `retile` 让转置发生在寄存器里，smem 只做写端暂存。
6. **DSL 不救物理**：向量化错端照样慢（cvectorized 实证）、保写端照样赢——CuTe 的价值是表达力（col2row/row2col = 换 layout 参数）和防错，不是新性能。

下一篇回到纯手写：激活函数（relu/gelu）——elementwise 的收官练习。
