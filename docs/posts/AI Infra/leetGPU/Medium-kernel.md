# Reduction

[题目链接](https://leetgpu.com/challenges/reduction)

对长度 N（最大 1e8）的 float 数组求和，结果写回 `output` 标量。

解法（warp shuffle 两阶段 + atomicAdd 收尾）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define FLOAT4(X) *(float4*)(&(x))

#define BLOCK_SIZE 256
#define WARP_SIZE 32

__global__ void reduce_kernel(
    const float* __restrict__ input,
    float* __restrict__ output,
    int N
){
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    float sum = 0.0f;
    if (idx < N) sum = input[idx];

    const int WARP_NUM = BLOCK_SIZE / WARP_SIZE;
    int warpId = threadIdx.x / WARP_SIZE;
    int laneId = threadIdx.x % WARP_SIZE;
    __shared__ float sum_s[WARP_NUM];

#pragma unroll
    for (int s=WARP_SIZE >> 1;s > 0;s >>= 1)
        sum += __shfl_down_sync(0xffffffff,sum,s);
    
    if (laneId == 0)
        sum_s[warpId] = sum;
    
    __syncthreads();

    if (threadIdx.x < WARP_SIZE){
        sum = (threadIdx.x < WARP_NUM)?sum_s[threadIdx.x]:0.0f;
#pragma unroll
        for (int s=WARP_NUM >> 1;s>0;s>>=1)
            sum += __shfl_down_sync(0xffffffff,sum,s);
        if (threadIdx.x == 0)
            atomicAdd(output,sum);
    }

}

// input, output are device pointers
extern "C" void solve(const float* input, float* output, int N) {
    cudaMemset(output,0,sizeof(float));
    int threadsPerBlock = BLOCK_SIZE;
    int blocksPerGrid = (N + BLOCK_SIZE - 1) / BLOCK_SIZE;
    reduce_kernel<<<blocksPerGrid,threadsPerBlock>>>(input,output,N);
}
```

</details>

- 两阶段归约的标准套路：warp 内 `__shfl_down_sync` 蝶式累加 → 每 warp 的 lane0 写 shared → 前 32 线程再对 8 个 warp 部分和做一次 shuffle 归约
- block 结果用 `atomicAdd` 直接累到全局 output 上，省掉第二次 kernel launch（题面保证和不会溢出 float）
- `solve` 里先 `cudaMemset(output,0,...)` 清零，否则 atomicAdd 会在垃圾值上累加
- 边界处理：越界线程 `sum = 0.0f`，加进归约不影响结果
- 对比 LeetCUDA 03 篇：那边的两阶段是 block 部分和写回全局数组再 launch 一次归约 kernel；这里 N 大、block 数多，atomicAdd 的竞争成本可接受，代码更短

# Softmax

[题目链接](https://leetgpu.com/challenges/softmax)

对长度 N（最大 5e5）的 float 数组做 safe softmax，要求用 max trick 防 overflow。

解法一（online softmax 单遍，warp/block 归约）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#include <math_constants.h>

#include <cstdio>
#include <cstdlib>

#define WARP_SIZE 32

struct __align__(8) MD {
    float m;
    float d;
};

#define CUDA_CHECK(expr)                                                     \
    do {                                                                     \
        cudaError_t error = (expr);                                          \
        if (error != cudaSuccess) {                                          \
            std::fprintf(stderr, "CUDA error at %s:%d: %s\n",                \
                         __FILE__, __LINE__, cudaGetErrorString(error));      \
            std::abort();                                                    \
        }                                                                    \
    } while (0)

__device__ __forceinline__ MD md_identity()
{
    return MD{-CUDART_INF_F, 0.0f};
}

__device__ __forceinline__ MD combine_md(MD a, MD b)
{
    // d == 0 表示归约单位元，避免 -inf - (-inf)。
    if (a.d == 0.0f) {
        return b;
    }
    if (b.d == 0.0f) {
        return a;
    }

    // 也能处理两个相同的正负无穷值。
    if (a.m == b.m) {
        return MD{a.m, a.d + b.d};
    }

    if (a.m > b.m) {
        return MD{
            a.m,
            a.d + b.d * __expf(b.m - a.m)
        };
    }

    return MD{
        b.m,
        b.d + a.d * __expf(a.m - b.m)
    };
}

__device__ __forceinline__ MD warp_reduce_md(MD value)
{
    constexpr unsigned mask = 0xffffffffu;

#pragma unroll
    for (int offset = WARP_SIZE / 2; offset > 0; offset >>= 1) {
        MD other;
        other.m = __shfl_down_sync(mask, value.m, offset);
        other.d = __shfl_down_sync(mask, value.d, offset);
        value = combine_md(value, other);
    }

    return value;
}

template<int BLOCK_THREADS>
__device__ __forceinline__ MD block_reduce_md(MD value)
{
    static_assert(BLOCK_THREADS >= WARP_SIZE);
    static_assert(BLOCK_THREADS <= 1024);
    static_assert(BLOCK_THREADS % WARP_SIZE == 0);

    constexpr int WARP_COUNT = BLOCK_THREADS / WARP_SIZE;

    __shared__ MD warp_results[WARP_COUNT];

    const int lane_id = threadIdx.x % WARP_SIZE;
    const int warp_id = threadIdx.x / WARP_SIZE;

    value = warp_reduce_md(value);

    if (lane_id == 0) {
        warp_results[warp_id] = value;
    }

    __syncthreads();

    MD block_value = md_identity();

    if (warp_id == 0) {
        if (lane_id < WARP_COUNT) {
            block_value = warp_results[lane_id];
        }

        // 剩余 lane 持有单位元，因此可以直接归约完整 warp。
        block_value = warp_reduce_md(block_value);
    }

    return block_value;
}

// 第一层：float 输入转换为 MD，并进行 block 级归约。
template<int BLOCK_THREADS>
__global__ void softmax_input_reduce_kernel(
    const float* input,
    MD* block_output,
    int count)
{
    const size_t index =
        static_cast<size_t>(blockIdx.x) * BLOCK_THREADS + threadIdx.x;

    MD value = md_identity();

    if (index < static_cast<size_t>(count)) {
        value.m = input[index];
        value.d = 1.0f;
    }

    MD block_value = block_reduce_md<BLOCK_THREADS>(value);

    if (threadIdx.x == 0) {
        block_output[blockIdx.x] = block_value;
    }
}

// 后续层：MD 数组归约成更小的 MD 数组。
template<int BLOCK_THREADS>
__global__ void softmax_md_reduce_kernel(
    const MD* input,
    MD* block_output,
    int count)
{
    const size_t index =
        static_cast<size_t>(blockIdx.x) * BLOCK_THREADS + threadIdx.x;

    MD value = md_identity();

    if (index < static_cast<size_t>(count)) {
        value = input[index];
    }

    MD block_value = block_reduce_md<BLOCK_THREADS>(value);

    if (threadIdx.x == 0) {
        block_output[blockIdx.x] = block_value;
    }
}

template<int BLOCK_THREADS>
__global__ void softmax_normalize_kernel(
    const float* input,
    float* output,
    const MD* global_md,
    int count)
{
    const size_t index =
        static_cast<size_t>(blockIdx.x) * BLOCK_THREADS + threadIdx.x;

    if (index >= static_cast<size_t>(count)) {
        return;
    }

    const MD global = *global_md;
    const float x = input[index];
    const float inv_d = __fdividef(1.0f, global.d);

    // 对包含 +/- infinity 的输入提供定义明确的结果：
    // 最大值为 infinity 时，在所有相同 infinity 元素之间均分。
    if (isinf(global.m)) {
        output[index] = (x == global.m) ? inv_d : 0.0f;
    } else {
        output[index] = __expf(x - global.m) * inv_d;
    }
}

extern "C" void solve(const float* input, float* output, int N)
{
    constexpr int THREADS = 256;

    if (N <= 0) {
        return;
    }

    const int first_block_count = static_cast<int>(
        (static_cast<long long>(N) + THREADS - 1) / THREADS);

    MD* buffer_a = nullptr;
    MD* buffer_b = nullptr;

    CUDA_CHECK(cudaMalloc(
        reinterpret_cast<void**>(&buffer_a),
        static_cast<size_t>(first_block_count) * sizeof(MD)));

    if (first_block_count > 1) {
        const int second_buffer_capacity =
            (first_block_count + THREADS - 1) / THREADS;

        CUDA_CHECK(cudaMalloc(
            reinterpret_cast<void**>(&buffer_b),
            static_cast<size_t>(second_buffer_capacity) * sizeof(MD)));
    }

    // Level 0: N 个 float -> first_block_count 个 MD。
    softmax_input_reduce_kernel<THREADS>
        <<<first_block_count, THREADS>>>(
            input,
            buffer_a,
            N);

    CUDA_CHECK(cudaGetLastError());

    MD* current_input = buffer_a;
    MD* current_output = buffer_b;
    int current_count = first_block_count;

    // 递归归约：
    // first_block_count -> ceil(first_block_count / 256) -> ... -> 1
    while (current_count > 1) {
        const int next_count =
            (current_count + THREADS - 1) / THREADS;

        softmax_md_reduce_kernel<THREADS>
            <<<next_count, THREADS>>>(
                current_input,
                current_output,
                current_count);

        CUDA_CHECK(cudaGetLastError());

        MD* temporary = current_input;
        current_input = current_output;
        current_output = temporary;
        current_count = next_count;
    }

    // current_input 现在指向唯一的全局 MD。
    softmax_normalize_kernel<THREADS>
        <<<first_block_count, THREADS>>>(
            input,
            output,
            current_input,
            N);

    CUDA_CHECK(cudaGetLastError());
    CUDA_CHECK(cudaDeviceSynchronize());

    CUDA_CHECK(cudaFree(buffer_a));

    if (buffer_b != nullptr) {
        CUDA_CHECK(cudaFree(buffer_b));
    }
}
```

</details>

- (m, d) 对做可结合归约：m 是 max，d 是 rescaled 的 exp 和。`combine_md` 就是 online softmax 的合并公式，d==0 当作单位元跳过，避免 `-inf - (-inf) = NaN`
- 真正的多层金字塔归约：N=5e5 时 block 数 ~1954，一层归不完，所以 while 循环层层归约直到 1，双 buffer 乒乓
- 连 `isinf` 的边界都处理了（max 是 +inf 时在相同元素间均分 1/d），测试点抠得很细
- `cudaMalloc` 的 buffer 理论上泄漏不了多少（每题一次），但更工程化的写法是预分配或复用 workspace

对比一个翻车旧版（per-block 独立 softmax）：

<details>
<summary>查看代码（旧版思路，错误原因见下）</summary>

```c++
// 旧版照搬 LeetCUDA 04 篇的 online_safe_softmax per-token kernel：
// 每 block 256 线程，block 内 warp+block 归约出 (m, d) 后，
// 直接在本 block 内做 __expf(x - m) * (1/d) 归一化。
// solve 里 blocksPerGrid = (N + 255) / 256 开了多个 block。
```

</details>

要点：
- online softmax 的核心是 (max, sum) 打包成一个可结合的归约算子，一遍扫完 max 和分母，不用先求 max 再求 exp 两遍
- **旧版错在哪**：per-token 版的"token"是一个完整 softmax 行（比如 attention 的一个 query 行），行内归一化没问题；但本题的 softmax 是**整条数组一个分布**，分母必须覆盖全部 N 个元素。每个 block 各自归一化 = 每个 256 元素的子区间各自和为 1，结果直接错
- 多层归约时单位元设计（d=0）是正确性关键，省去大量边界 if
- 5e5 规模金字塔归约只多 2 层 launch（1954 → 8 → 1），开销可忽略

# Softmax Attention

[题目链接](https://leetgpu.com/challenges/softmax-attention)

计算 `Attention(Q,K,V) = softmax(QK^T/√d)V`，Q 是 M×d，K/V 是 N×d，d ≤ 128，M,N ≤ 1e5（实测 M=512, N=256）。

解法（一行一 warp + online softmax，FlashAttention 风格的非 MMA 朴素版）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#include <math_constants.h>

// 定义常量
#define WARP_SIZE 32
#define WARPS_PER_BLOCK 8
#define BM WARPS_PER_BLOCK
#define BN 32
#define MAX_D 128
#define MAX_D_PER_LANE (MAX_D / WARP_SIZE)

// WARP内归约sum
__device__ __forceinline__ float warp_reduce_sum(float v){
#pragma unroll
    for (int offset = WARP_SIZE >> 1; offset >= 1;offset >>= 1){
        v += __shfl_down_sync(0xffffffff,v,offset);
    }
    return v;
}

__global__ void fused_attention_kernel(
    const float* __restrict__ Q,
    const float* __restrict__ K,
    const float* __restrict__ V,
    float* __restrict__ O,
    int M, int N, int d,
    float inv_sqrt_d
){
    __shared__ float Ks[BN][MAX_D];
    __shared__ float Vs[BN][MAX_D];

    const int warp = threadIdx.x / WARP_SIZE;
    const int lane = threadIdx.x % WARP_SIZE;

    const int q_raw = blockIdx.x * BM + warp;
    const bool valid = q_raw < M;
    const int q = valid ? q_raw : (M - 1); // 加载最后一行，但是不参与后续计算

    float q_reg[MAX_D_PER_LANE];
    float acc[MAX_D_PER_LANE];

#pragma unroll
    for (int k = 0;k < MAX_D_PER_LANE; ++k){
        q_reg[k] = 0.f;
        acc[k] = 0.f;
    }

    // 每个线程只加载至多 MAX_D_PER_LANE 元素
    int kk = 0;
    for (int j = lane;j < d;j+=WARP_SIZE,++kk){
        q_reg[kk] = Q[(size_t)q*d + j];
    }

    float m = -CUDART_INF_F; // 当前见过的最大 score
    float l = 0.f; // 当前 softmax 分母

    for (int n0 = 0;n0 < N;n0 += BN){ // 切割 Ktile，Vtile，按照BN进行

        // 所有线程都去搬运，搬运Ks[BN][MAX_D]、Vs[BN][MAX_D]
        for (int idx = threadIdx.x;idx < BN * d;idx += blockDim.x){
            int r = idx / d;
            int c = idx % d;
            int n = n0 + r;

            float kv = (n < N)?K[(size_t)n*d + c]:0.0f;
            float vv = (n < N)?V[(size_t)n*d + c]:0.0f;

            Ks[r][c] = kv;
            Vs[r][c] = vv;
        }
        __syncthreads();

        int tile_n = min(BN,N - n0);
        for (int r = 0;r < tile_n;++r){ // 处理 Ktile/Vtile 一行，行为 r
            float partial = 0.f;
            int k = 0;
            // 一个线程只处理点积的一部分，然后再归约
            for (int j = lane;j < d;j += WARP_SIZE,++k){
                partial += q_reg[k] * Ks[r][j];
            }
            partial = warp_reduce_sum(partial);
            float score = __shfl_sync(0xffffffff,partial,0) * inv_sqrt_d; // 广播 partial

            // online 的精华代码，边遍历边更新
            // WARP 里面的 0线程 负责更新
            float alpha = 0.f;
            float beta = 0.f;
            if (lane == 0){
                float m_new = fmaxf(m,score);
                alpha = __expf(m - m_new);
                beta = __expf(score - m_new);
                l = l * alpha + beta;
                m = m_new;
            }
            alpha = __shfl_sync(0xffffffff,alpha,0);
            beta = __shfl_sync(0xffffffff,beta,0);

            // acc 只负责 MAX_D_PER_LANE 个
            k = 0;
            for (int j = lane;j < d;j += WARP_SIZE,++k){
                acc[k] = acc[k] * alpha + beta * Vs[r][j];
            }
        }
        __syncthreads();
    }
    if (!valid) return;
    float inv_l = 0.f;
    if (lane == 0) inv_l = 1.0f/l;
    inv_l = __shfl_sync(0xffffffff,inv_l,0);

    float* o_ptr = O + (size_t)q * d;
    int k = 0;
    for (int j = lane;j < d;j+=WARP_SIZE,++k){
        o_ptr[j] = acc[k] * inv_l;
    }
}



// Q, K, V, output are device pointers
extern "C" void solve(
    const float* Q,
    const float* K,
    const float* V,
    float* output,
    int M,
    int N,
    int d) {
        float inv_sqrt_d = 1.0f / sqrtf((float)d);
        // 一个 block 负责 BM 行
        // block WARP_SIZE * WARPS_PER_BLOCK 个线程，一共有 WARPS_PER_BLOCK 个 WARP
        // 每个 WARP 负责一行，一行有 WARP_SIZE 个线程
        dim3 block(WARP_SIZE * WARPS_PER_BLOCK);
        dim3 grid((M + BM - 1) / BM);
        fused_attention_kernel<<<grid,block>>>(Q,K,V,output,M,N,d,inv_sqrt_d);
}
```

</details>

- 一行 Q 配一个 warp：Q 行按 lane 切成 `d/32` 份存寄存器（`q_reg`），输出 acc 同样按 lane 切分，全程不落 shared
- K/V 按 BN=32 行一块搬进 shared（Ks/Vs），warp 内逐行算 `q·k` 点积：每线程算 `d/32` 个乘加，`warp_reduce_sum` 归约后 lane0 广播
- online softmax 精华就在中间那几行：lane0 更新 `m_new = max(m, score)`，算出 rescale 因子 alpha（旧 acc/分母缩放）和 beta（新 score 的 exp），shuffle 广播后所有 lane 同步缩放自己的 acc 分片
- 无效 warp（`q_raw >= M`）伪装成最后一行 Q 参与计算但不写回，避免了 warp divergence 又不用单独分支跳过 shared 搬运
- 和 LeetCUDA 20 篇 FlashAttention-2 的关系：这里是没有 Tensor Core/MMA 的"教学版" FA——同样的 online softmax 数据流，用纯 CUDA C 手撕一遍更能看清 alpha/beta 缩放的时序
