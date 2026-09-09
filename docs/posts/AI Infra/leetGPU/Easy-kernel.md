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
