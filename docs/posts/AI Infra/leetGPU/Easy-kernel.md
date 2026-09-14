# Vector Addition

[题目链接](https://leetgpu.com/challenges/vector-addition)

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

__global__ void vector_add(const float* A, const float* B, float* C, int N) 
{
    int bx = blockIdx.x;
    int tx = threadIdx.x;

    int nx = bx * blockDim.x + tx;
    if (nx < N){
        C[nx] = A[nx] + B[nx];
    }
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int N) {
    int threadsPerBlock = 256;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    vector_add<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, N);
    cudaDeviceSynchronize();
}
```

</details>

- 一个thread负责一个元素
- 检查下标即可

# Matrix Multiplication

[题目链接](https://leetgpu.com/challenges/matrix-multiplication)

基础解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

__global__ void matrix_multiplication_kernel(const float* A, const float* B, float* C, int M, int N,
                                             int K) 
{
    // 1个thread负责C矩阵的1个元素(row,col)
    // 矩阵乘法的性质要获取A[row][...]和B[...][col]，然后 dot
    // 但是效率较低，因为每次都要从 GM 搬运数据
    int k = blockDim.x * blockIdx.x + threadIdx.x;
    int m = blockDim.y * blockIdx.y + threadIdx.y;
    int idx = m*K + k;

    if ((k<K) && (m < M)){
        float sum = 0;
        for (int n = 0;n<N;n++){
            sum += A[m*N+n] * B[n*K+k];
        }
        C[idx] += sum;
    }
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int M, int N, int K) {
    dim3 threadsPerBlock(16, 16);
    dim3 blocksPerGrid((K + threadsPerBlock.x - 1) / threadsPerBlock.x,
                       (M + threadsPerBlock.y - 1) / threadsPerBlock.y);
    matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M, N, K);
    cudaDeviceSynchronize();
}
```

</details>

进阶解法（shared memory 分块）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define TILE 32

__global__ void matrix_multiplication_kernel(const float* A, const float* B, float* C, int M, int N,
                                             int K) 
{
    // 相较于基础解法，进阶解法按照TILE*TILE块先读取数据
    // 不需要每次都从 GM 里面读。重复利用 GPU 向量读取指令
    __shared__ float A_block[TILE][TILE];
    __shared__ float B_block[TILE][TILE];

    const int tix = threadIdx.x;
    const int tiy = threadIdx.y;
    const int bix = blockIdx.x;
    const int biy = blockIdx.y;

    const int row = biy * TILE + tiy;
    const int col = bix * TILE + tix;

    float sum = 0.0;

    for (int t = 0;t < (N + TILE - 1) / TILE;++t){ // 要滑动 ceil(N/TILE) 次
        A_block[tiy][tix] = (row < M && (t * TILE + tix) < N) ? A[t*TILE + tix + row * N]:0.0;
        B_block[tiy][tix] = (col < K && (t * TILE + tiy) < N) ? B[(t*TILE + tiy)*K + col]:0.0;

        // 必须要全部写完
        __syncthreads();

        for (int k=0;k<TILE;k++){
            sum += A_block[tiy][k] * B_block[k][tix];
        }
        // 如果这里不同步的话，可以会导致A_block/B_block被修改，导致累加出问题
        __syncthreads(); 

    }

    // 累加完成后写
    if (row < M && col < K){
        C[col + row * K] = sum;
    }
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int M, int N, int K) {
    dim3 threadsPerBlock(TILE, TILE);
    dim3 blocksPerGrid((K + threadsPerBlock.x - 1) / threadsPerBlock.x,
                       (M + threadsPerBlock.y - 1) / threadsPerBlock.y);

    matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M, N, K);
    cudaDeviceSynchronize();
}
```

</details>

# Color Inversion

[题目链接](https://leetgpu.com/challenges/color-inversion)

RGBA 图像反色：R/G/B 各自 `255 - x`，Alpha 保持不变。图像是 `width*height*4` 的一维 uchar 数组。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define NUM 4

__global__ void invert_kernel(unsigned char* image, int width, int height) 
{
    // 先按照给的grid，完成最简方案
    int idx = 4*(blockIdx.x * blockDim.x + threadIdx.x);
    // 当前线程处理四个元素，但实际上不需要处理第四个
    if (idx < 4*width*height){
        image[idx] = 255 - image[idx];
        image[idx + 1] = 255 - image[idx + 1];
        image[idx + 2] = 255 - image[idx + 2];
    }
}



// image_input, image_output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(unsigned char* image, int width, int height) {
    int threadsPerBlock = 256;
    int blocksPerGrid = (width * height + threadsPerBlock - 1) / threadsPerBlock;

    invert_kernel<<<blocksPerGrid, threadsPerBlock>>>(image, width, height);
    cudaDeviceSynchronize();
}
```

</details>

- 一个线程管一个像素：`idx = 4 * tid` 跳到该像素 RGBA 的起点，只反前 3 个通道
- 线程总数按像素数（width*height）开，不是按字节数开——除以 4 的关系容易写错
- Alpha 通道天然跳过，不需要额外分支
- 细节坑：`255 - image[idx]` 里 image 是 uchar，运算会整型提升到 int 再隐式截断回来，这里刚好正确（值域 0~255）；如果以后遇到带符号的类型要小心

# Matrix Addition

[题目链接](https://leetgpu.com/challenges/matrix-addition)

N×N 两个矩阵逐元素相加（实测 N=4096，即 16M 元素）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define TILE 256

__global__ void matrix_add(const float* A, const float* B, float* C, int N) 
{
    __shared__ float A_[TILE];
    __shared__ float B_[TILE];
    int idx = blockIdx.x * TILE + threadIdx.x;
    int tix = threadIdx.x;
    A_[tix] = (idx < N*N) ? A[idx] :0.0;
    B_[tix] = (idx < N*N) ? B[idx] :0.0;
    __syncthreads();
    A_[tix] += B_[tix];
    if (idx < N*N)
        C[idx] =  A_[tix];
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* C, int N) {
    int threadsPerBlock = TILE;
    int blocksPerGrid = (N * N + threadsPerBlock - 1) / threadsPerBlock;

    matrix_add<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, N);
    cudaDeviceSynchronize();
}
```

</details>

- 纯 elementwise，一个 thread 算一个元素，直接 `C = A + B` 就是正确答案
- 这里走了 shared memory staging（A_、B_ 各 256 float）：读进 smem、加完再写回。对这种一行扫过的 elementwise 算子其实没有必要——没有数据复用，smem 只多了两次搬运，LeetCUDA 02 篇的结论是直读直写就是峰值带宽
- 唯一能说的点：加法和写回之间隔了 `__syncthreads()`，属于"练手 smem 流水线"的写法

# 1D Convolution

[题目链接](https://leetgpu.com/challenges/1d-convolution)

1D "valid" 卷积：`output[i] = Σ_j input[i+j] * kernel[j]`，output 长度 = input_size - kernel_size + 1（实测 input 150 万、kernel 2047）。

解法（kernel 常驻 shared memory）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define TILE 256
#define MAXK 2048

__global__ void convolution_1d_kernel(const float* input, const float* kernel, float* output,
                                      int input_size, int kernel_size) {
    const int output_size = input_size - kernel_size + 1;
    __shared__ float K_[MAXK];
    int tix = threadIdx.x;
    int loop_ = (kernel_size + TILE - 1) / TILE;
    for (int i=0;i<loop_;++i){
        if (tix + i*TILE < kernel_size){
            K_[tix + i*TILE] = kernel[tix + i*TILE];
        }
    }
    __syncthreads();
    float sum = 0.0;
    int idx = blockIdx.x * blockDim.x + tix;

    if (idx >= output_size) return;

    for (int i=0;i<kernel_size;i++){       
        sum += K_[i] * input[idx + i];
    }
    output[idx] = sum;


}

// input, kernel, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* input, const float* kernel, float* output, int input_size,
                      int kernel_size) {
    int output_size = input_size - kernel_size + 1;
    int threadsPerBlock = TILE;
    int blocksPerGrid = (output_size + threadsPerBlock - 1) / threadsPerBlock;

    convolution_1d_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, kernel, output, input_size,
                                                              kernel_size);
    cudaDeviceSynchronize();
}
```

</details>

- kernel（卷积核）只有 2047 个数、被所有输出复用，一次搬进 shared memory（`K_[MAXK]`，上限正好是题面 kernel_size 的最大值 2047），之后每线程循环里读的都是 smem
- 装载 kernel 时 256 线程不够一次装 2047 个，用 `loop_` 分批搬（ Cooperation load），搬完 `__syncthreads()` 再开算
- input 侧没有做 halo 分块（每个线程自己 `input[idx+i]` 全局读），相邻线程的窗口重叠 kernel_size-1 个元素，全局读有大量重复——但 L2/L1 会兜住大部分；要做真正的 smem halo 分块见 LeetCUDA 09/12 篇的套路
- 越界线程早退（`idx >= output_size` return），注意早退要放在 smem 装载之后，否则可能卡死在 `__syncthreads()`（本题装载在前面所以安全）

# Reverse Array

[题目链接](https://leetgpu.com/challenges/reverse-array)

原地反转 float 数组（实测 N=2500 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define TILE 256

__global__ void reverse_array(float* input, int N) {
    // 按照块进行反转，不要 block 间的通信
    // 一次加载 256*2*32bit = 2048B
    __shared__ float A[TILE];
    __shared__ float B[TILE];
    int tix = threadIdx.x;
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N / 2){
        A[tix] = input[idx];
        B[tix] = input[N - 1 - idx];
    }
    __syncthreads();
    if (idx < N / 2){
        input[idx] = B[tix];
        input[N - 1 - idx] = A[tix];
    }

}

// input is device pointer
extern "C" void solve(float* input, int N) {
    int threadsPerBlock = TILE;
    int blocksPerGrid = (N/2 + threadsPerBlock - 1) / threadsPerBlock;

    reverse_array<<<blocksPerGrid, threadsPerBlock>>>(input, N);
    cudaDeviceSynchronize();
}
```

</details>

- 关键观察：反转 = 前 N/2 个元素与后 N/2 个元素镜像交换。只启 N/2 个线程，每个线程负责一对 (i, N-1-i) 的双向交换
- 交换两头数据没有竞争：线程 i 只碰位置 i 和 N-1-i，不同线程的触及集合不相交，天然并行安全
- smem 里 A/B 各存一半再换回，纯粹是"读一对→写一对"的 staging；直接寄存器对换 `tmp` 也可以（`tmp=in[i]; in[i]=in[N-1-i]; in[N-1-i]=tmp;`），效果等价
- 奇数 N 时中间元素不用动，N/2 向下取整刚好跳过它

# ReLU

[题目链接](https://leetgpu.com/challenges/relu)

逐元素 `ReLU(x) = max(0, x)`（实测 N=2500 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define TILE 256

__global__ void relu_kernel(const float* input, float* output, int N) {
    __shared__ float R[TILE];
    int tix = threadIdx.x;
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N){
        R[tix] = max(0.0,input[idx]);
    }
    __syncthreads();
    if (idx < N)
        output[idx] = R[tix];


}

// input, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* input, float* output, int N) {
    int threadsPerBlock = TILE;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    relu_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, N);
    cudaDeviceSynchronize();
}
```

</details>

- elementwise 一行 solution 就是 `output[idx] = fmaxf(0.f, input[idx]);`，这里又走了 smem staging 练手
- 注意 `max(0.0, x)` 是 double 版本会引发隐式转换；用 `fmaxf(0.0f, x)` 更干净
- 越界线程不进第一个 if，R[tix] 是垃圾值，但第二个 if 也拦住了，不会写脏数据

# Leaky ReLU

[题目链接](https://leetgpu.com/challenges/leaky-relu)

逐元素 leaky ReLU，负半轴乘 α=0.01（实测 N=5000 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#define TILE 256

__global__ void leaky_relu_kernel(const float* input, float* output, int N) {
    __shared__ float R[TILE];
    int tix = threadIdx.x;
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N){
        R[tix] = input[idx];
        if (R[tix] <= 0){
            R[tix] *= 0.01;
        } 
    }
    __syncthreads();
    if (idx < N)
        output[idx] = R[tix];
}

// input, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* input, float* output, int N) {
    int threadsPerBlock = TILE;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    leaky_relu_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, N);
    cudaDeviceSynchronize();
}
```

</details>

- 和 ReLU 同款骨架，多一个负数分支：`x <= 0` 时乘 0.01
- `x <= 0`（含 0）和题面定义对齐：`f(x) = x if x > 0 else αx`
- 无分支写法 `x > 0.f ? x : 0.01f * x` 编译成 select 指令，同样无 divergence，二选一即可

# Rainbow Table

[题目链接](https://leetgpu.com/challenges/rainbow-table)

对 int 数组每个元素做 R 轮 FNV-1a 哈希（R ≤ 100，实测 N=500 万）。哈希函数题目直接给了。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#define TILE 256

__device__ unsigned int fnv1a_hash(unsigned int input) {
    const unsigned int FNV_PRIME = 16777619;
    const unsigned int OFFSET_BASIS = 2166136261;

    unsigned int hash = OFFSET_BASIS;

    for (int byte_pos = 0; byte_pos < 4; byte_pos++) {
        unsigned char byte = (input >> (byte_pos * 8)) & 0xFFu;
        hash = (hash ^ byte) * FNV_PRIME;
    }

    return hash;
}

__global__ void fnv1a_hash_kernel(const int* input, unsigned int* output, int N, int R){
    // 可以简单操作，先存下来，然后循环哈希，再存回去
    int tix = threadIdx.x;
    int idx = threadIdx.x + blockIdx.x * blockDim.x;
    if (idx < N){
        unsigned int v = static_cast<unsigned int>(input[idx]);
        for (int i = 0;i<R;++i){
            v = fnv1a_hash(v);
        }
        output[idx] = v;
    }
}

// input, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const int* input, unsigned int* output, int N, int R) {
    int threadsPerBlock = TILE;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    fnv1a_hash_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, N, R);
    cudaDeviceSynchronize();
}
```

</details>

- 元素之间完全独立，一个线程包揽一个元素的 R 轮哈希，没有任何同步
- 哈希函数标 `__device__`，host 端复用不了但 GPU 端内联调用零开销
- `static_cast<unsigned int>` 负数输入回绕成无符号，与题面的 reference 行为一致
- 计算密集型小题：乘法/异或链没有访存瓶颈，GPU 随便吃

# Matrix Copy

[题目链接](https://leetgpu.com/challenges/matrix-copy)

把 N×N 矩阵从 A 原样拷到 B（实测 N=4096）。

解法（float4 向量化 + 尾部 scalar 兜底）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#include <algorithm>
#define TILE 256

__global__ void copy_matrix_kernel_vec4(const float4* __restrict__ A,
 float4* __restrict__ B,
  int total4) {
    int stride = gridDim.x * blockDim.x; // 计算有多少个线程，然后按照线程数跨度进行。
    for (int idx = blockIdx.x * blockDim.x + threadIdx.x;
    idx < total4;
    idx += stride){
        B[idx] = A[idx];
    }

}

__global__ void copy_matrix_kernel_scalar(const float* __restrict__ A,
 float* __restrict__ B,
  int start,
  int total) {
    int idx = start + blockDim.x * blockIdx.x + threadIdx.x;
    if (idx < total){
        B[idx] = A[idx];
    }

}

// A, B are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, float* B, int N) {
    int total = N * N;
    int total4 = total / 4;
    int remainer = total % 4;

    if (total4 > 0){
        const float4* A4 = reinterpret_cast<const float4*>(A);
        float4* B4 = reinterpret_cast<float4*>(B);
        int threadsPerBlock = TILE;
        int blocksPerGrid = (total4 + threadsPerBlock - 1) / threadsPerBlock;
        blocksPerGrid = std::min(blocksPerGrid,65535); // 可动态调整
        copy_matrix_kernel_vec4<<<blocksPerGrid, threadsPerBlock>>>(A4, B4, total4);
    }
    if (remainer > 0){
        int start = total4 * 4;
        int threadsPerBlock = TILE;
        int blocksPerGrid = (remainer + threadsPerBlock - 1) / threadsPerBlock;
        copy_matrix_kernel_scalar<<<blocksPerGrid,threadsPerBlock>>>(A,B,start,total);
    }


    cudaDeviceSynchronize();
}
```

</details>

- 主力 kernel 用 `float4`：一条指令搬 16B，拷贝是纯带宽题，向量化直接把访存指令数砍到 1/4
- grid 上限 65535（x 方向硬件限制），超出就靠 grid-stride loop 兜底：`idx += stride` 循环处理，这也是 CUDA 官方推荐的"弹性 kernel"写法，block 数可固定不随规模爆
- N=4096 时 total=16M，能被 4 整除，scalar 尾巴 kernel 不会触发；但尾处理写全了，任意 N 都对
- 两个 kernel 之间天然串行（同一个 stream），最后统一 `cudaDeviceSynchronize`

# Simple Inference

[题目链接](https://leetgpu.com/challenges/simple-inference)

这题不是写 CUDA，而是 PyTorch：给定 input 和一个 `nn.Linear` model，把 `output = input @ W^T + b` 的结果写进 output。

解法：

<details>
<summary>查看代码</summary>

```python
import torch
import torch.nn as nn


# input, model, and output are on the GPU
def solve(input: torch.Tensor, model: nn.Module, output: torch.Tensor):
    model.eval()
    with torch.no_grad():
        output.copy_(model(input))
```

</details>

- 平台这题考的是"会用框架"：`model(input)` 一行就是前向
- `torch.no_grad()` 关掉 autograd，省显存省时间；`model.eval()` 是习惯动作（Linear 虽无 dropout/BN，但保持规范）
- `output.copy_(...)` 就地写入给定的 output tensor（题面要求结果必须落在 output 里，不能直接 return）

# Sigmoid Linear Unit (SiLU)

[题目链接](https://leetgpu.com/challenges/sigmoid-linear-unit)

逐元素 `SiLU(x) = x * σ(x) = x / (1 + e^{-x})`（实测 N=5 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

__global__ void silu_kernel(const float* input, float* output, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N){
        float x = input[idx];
        output[idx] = x / (1 + expf(-x)); 
    }
}

// input, output are device pointers
extern "C" void solve(const float* input, float* output, int N) {
    int threadsPerBlock = 256;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    silu_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, N);
    cudaDeviceSynchronize();
}
```

</details>

- 公式直接翻译，一个 `expf` 一个除法
- 早期版本把 `float x` 误写成 `int x`，除法变整除导致 test-case-failed——激活函数题里类型声明抄错一行就能挂，AC 历史里这种低级坑占一半

# Swish-Gated Linear Unit (SwiGLU)

[题目链接](https://leetgpu.com/challenges/swish-gated-linear-unit)

输入长度 N（偶数）分两半：`SwiGLU(x1, x2) = SiLU(x1) * x2`，输出长度 N/2（实测 N=10 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

__global__ void swiglu_kernel(const float* input, float* output, int halfN) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < halfN){
        float x1 = input[idx];
        float x2 = input[halfN + idx];
        output[idx] = x1 /(1 + expf(-x1)) * x2;
    }
}

// input, output are device pointers
extern "C" void solve(const float* input, float* output, int N) {
    int halfN = N / 2;
    int threadsPerBlock = 256;
    int blocksPerGrid = (halfN + threadsPerBlock - 1) / threadsPerBlock;

    swiglu_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, halfN);
    cudaDeviceSynchronize();
}
```

</details>

- 布局约定：前半段 [0, halfN) 是 x1，后半段 [halfN, N) 是 x2，同下标配对
- 一个线程读前后各一个元素、算 SiLU 再乘，写一个输出——三次访存一次 exp
- 这是 LLM FFN 里的标配门控结构（LLaMA 的 SwiGLU MLP 就这一行公式的矩阵版）

# Value Clipping

[题目链接](https://leetgpu.com/challenges/value-clipping)

逐元素裁剪到 [lo, hi] 区间（实测 N=10 万）。

解法（float4 向量化 + scalar 尾巴）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#include <algorithm>

#define TILE 256

__global__ void clip_kernel_vec4(const float4* __restrict__ input,
    float4* __restrict__ output,
    float lo,
    float hi,
    int total4) {
        int idx = blockDim.x * blockIdx.x + threadIdx.x;
        if (idx < total4){
            float4 v = input[idx];
            v.x = fmaxf(lo, fminf(v.x, hi));
            v.y = fmaxf(lo, fminf(v.y, hi));
            v.z = fmaxf(lo, fminf(v.z, hi));
            v.w = fmaxf(lo, fminf(v.w, hi));
            output[idx] = v;
        }
    }

__global__ void clip_kernel_scalar(const float* input,
    float* output,
    int start,
    float lo,
    float hi,
    int total) {
        int idx = start + blockIdx.x * blockDim.x + threadIdx.x;
        if (idx < total){
            output[idx] = fmaxf(lo, fminf(input[idx], hi));
        }
}


// input, output are device pointers
extern "C" void solve(const float* input, float* output, float lo, float hi, int N) {
    int total = N;
    int total4 = total / 4;
    int remainer = total % 4;

    if (total4 > 0){
        const float4* input4 = reinterpret_cast<const float4*>(input);
        float4* output4 = reinterpret_cast<float4*>(output);
        int threadsPerBlock = TILE;
        int blocksPerGrid = (total4 + threadsPerBlock - 1) / threadsPerBlock;
        blocksPerGrid = std::min(blocksPerGrid,65535); // 可动态调整
        clip_kernel_vec4<<<blocksPerGrid, threadsPerBlock>>>(input4, output4,lo,hi, total4);
    }
    if (remainer > 0){
        int start = total4 * 4;
        int threadsPerBlock = TILE;
        int blocksPerGrid = (remainer + threadsPerBlock - 1) / threadsPerBlock;
        clip_kernel_scalar<<<blocksPerGrid,threadsPerBlock>>>(input,output,start,lo,hi,total);
    }

}
```

</details>

- `clip(x) = fmaxf(lo, fminf(x, hi))`——min 套 max 的固定顺序，lo ≤ hi 时结果一致
- float4 主力 + scalar 兜尾，和 Matrix Copy 同一个"主_vec4 + 尾_scalar"模板；本题 N=10 万能被 4 整除，尾巴 kernel 不触发
- 注意这个 solve 里**没有** `cudaDeviceSynchronize`，两个 kernel 是同一 stream 自动按序执行的，平台判题时会自己同步——但风格上还是补上更稳

# Interleave Arrays

[题目链接](https://leetgpu.com/challenges/interleave-arrays)

两个长度 N 的数交织成一个长度 2N 的数组：`[A0, B0, A1, B1, ...]`（实测 N=2500 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

__global__ void interleave_kernel(const float* A, const float* B, float* output, int N) {
    // 其实可以float4加载，不过不写了，熟悉一下就行
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int tix = threadIdx.x;
    if (idx < N){
        output[2*idx] = A[idx];
        output[2*idx + 1] = B[idx]; 
    }

}

// A, B, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* A, const float* B, float* output, int N) {
    int threadsPerBlock = 256;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    interleave_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, output, N);
    cudaDeviceSynchronize();
}
```

</details>

- 读 A/B 都是 coalesced，写 output 每线程写相邻两个——一个 warp 写 64 个连续 float，相当于两段 128B 事务，写侧也基本合并
- 注释里自己点了：可以 float4 加载（每线程搬 4 对），跨步写会变 8 个 float 的间隙模式，收益有限没做
- `tix` 变量其实没用上，小瑕疵

# Gaussian Error Gated Linear Unit (GEGLU)

[题目链接](https://leetgpu.com/challenges/gaussian-error-gated-linear-unit)

与 SwiGLU 同布局，门控换成 GELU：`GEGLU(x1, x2) = x1 * GELU(x2)`，其中 `GELU(x) = 0.5x(1 + erf(x/√2))`。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>

#define rsqrt2 0.7071067811865475

__global__ void geglu_kernel(const float* input, float* output, int halfN) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < halfN){
        float x1 = input[idx];
        float x2 = input[halfN + idx];
        output[idx] = x1 *(0.5*x2*(1 + erff(x2*rsqrt2)));
    }
}

// input, output are device pointers
extern "C" void solve(const float* input, float* output, int N) {
    int halfN = N / 2;
    int threadsPerBlock = 256;
    int blocksPerGrid = (halfN + threadsPerBlock - 1) / threadsPerBlock;

    geglu_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, halfN);
    cudaDeviceSynchronize();
}
```

</details>

- 和 SwiGLU 只差门控函数：`erff` 硬件近似实现，`rsqrt2 = 1/√2` 提前算成常量
- 踩坑实录：第一版把 `erff(x2*rsqrt2)` 写成 `erff(x1*rsqrt2)`，样例 `[1.0, 1.0]` 两个值一样看不出来，第二个样例才暴露——错误只在非线性那半边时，对称样例测不出来，构造非对称测试输入很重要
- GELU 用 erf 精确版而非 tanh 近似版（LeetCUDA 11 篇对比过两者），题目 reference 是 erf 版必须对齐

# RGB to Grayscale

[题目链接](https://leetgpu.com/challenges/rgb-to-grayscale)

`gray = 0.299R + 0.587G + 0.114B`，输入 RGB 打平的一维数组，输出 width×height。

解法（block 级共享 RGB 读入）：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#define TILE 256

__global__ void rgb_to_grayscale_kernel(const float* input, float* output, int width, int height) {
    int idx = blockIdx.x * blockDim.x;
    int start = 3*idx;
    int tix = threadIdx.x;
    int N = width * height;
    __shared__ float A[TILE*3];
    // 需要取 [start,start + 3*TILE] 的数字
    // 为了保证少取，同时让每个线程都取
    for (int i=tix; start + i< 3*N && i < 3*TILE ;i+=TILE){
        A[i] = input[start + i];
    }
    __syncthreads();
    if (idx + tix < N){
        output[idx + tix] = 0.299 * A[3*tix] + 0.587 * A[3*tix + 1] + 0.114 * A[3*tix + 2];
    }

}

// input, output are device pointers
extern "C" void solve(const float* input, float* output, int width, int height) {
    int total_pixels = width * height;
    int threadsPerBlock = TILE;
    int blocksPerGrid = (total_pixels + threadsPerBlock - 1) / threadsPerBlock;

    rgb_to_grayscale_kernel<<<blocksPerGrid, threadsPerBlock>>>(input, output, width, height);
    cudaDeviceSynchronize();
}
```

</details>

- RGB 交错存储意味着像素 i 的三个分量在 `3i, 3i+1, 3i+2`——直接每线程读 3 个全局也行，这里把整个 block 需要的 3*TILE 个数合作搬进 smem（`A[TILE*3]`），读侧完全 coalesced
- 写 `A[i]` 的循环步长 TILE：线程 t 负责 `t, t+256, t+512`（最多 3 轮），装满 768 个 float
- 加权系数 0.299/0.587/0.114 是 ITU-R BT.601 的亮度权重，double 字面量直接乘 float 会提升精度算——判题容差内没问题
- 最朴素写法（不 share）实测也是带宽封顶，smem 版的价值在于练"合作装载"的模式

# Sigmoid Activation

[题目链接](https://leetgpu.com/challenges/sigmoid-activation)

逐元素 `sigmoid(x) = 1 / (1 + exp(-x))`（实测 N=5000 万）。

解法：

<details>
<summary>查看代码</summary>

```c++
#include <cuda_runtime.h>
#include <math.h>

__global__ void sigmoid_kernel(const float* X, float* Y, int N) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    if (idx < N)
        Y[idx] = 1 / (1 + expf(-X[idx]));
}

// X, Y are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float* X, float* Y, int N) {
    int threadsPerBlock = 256;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;

    sigmoid_kernel<<<blocksPerGrid, threadsPerBlock>>>(X, Y, N);
    cudaDeviceSynchronize();
}
```

</details>

- 最裸的 elementwise：一个线程一个元素，`expf` 是 SFU 硬件指令
- 纯带宽题，5000 万元素 = 200MB 读 + 200MB 写，kernel 形态和 ReLU 没区别
- LeetCUDA 23 篇实测过：这类带 exp 的激活在大 shape 下和纯拷贝一个速度，都被带宽压死，`expf` 不是瓶颈
