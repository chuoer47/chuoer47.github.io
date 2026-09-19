# Elementwise CUDA代码学习

> 本人学习笔记，非AI总结，可能存在理解错误

## 完整代码

### `elementwise.cu`
<details>
<summary> elemenwise.cu </summary>

```c++
#include <algorithm>
#include <cuda_bf16.h>
#include <cuda_fp16.h>
#include <cuda_fp8.h>
#include <cuda_runtime.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>

#define WARP_SIZE 32
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define BFLOAT2(value) (reinterpret_cast<__nv_bfloat162 *>(&(value))[0])
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])

// FP32
// ElementWise Add grid(N/256),
// block(256) a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f32_kernel(float *a, float *b, float *c,
                                           int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    c[idx] = a[idx] + b[idx];
}

// ElementWise Add + Vec4
// grid(N/256), block(256/4)
// a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f32x4_kernel(float *a, float *b, float *c,
                                             int N) {
  int idx = 4 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 3) < N) {
    float4 reg_a = FLOAT4(a[idx]);
    float4 reg_b = FLOAT4(b[idx]);
    float4 reg_c;
    reg_c.x = reg_a.x + reg_b.x;
    reg_c.y = reg_a.y + reg_b.y;
    reg_c.z = reg_a.z + reg_b.z;
    reg_c.w = reg_a.w + reg_b.w;
    FLOAT4(c[idx]) = reg_c;
  } else if (idx < N) {
    for (int i = 0; (idx + i) < N; i++) {
      c[idx + i] = a[idx + i] + b[idx + i];
    }
  }
}

// FP16
// ElementWise Add grid(N/256),
// block(256) a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f16_kernel(half *a, half *b, half *c, int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    c[idx] = __hadd(a[idx], b[idx]);
}

// a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f16x2_kernel(half *a, half *b, half *c, int N) {
  int idx = 2 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 1) < N) {
    half2 reg_a = HALF2(a[idx]);
    half2 reg_b = HALF2(b[idx]);
    half2 reg_c;
    reg_c.x = __hadd(reg_a.x, reg_b.x);
    reg_c.y = __hadd(reg_a.y, reg_b.y);
    HALF2(c[idx]) = reg_c;
  } else if (idx < N) {
    c[idx] = __hadd(a[idx], b[idx]);
  }
}

__global__ void elementwise_add_f16x8_kernel(half *a, half *b, half *c, int N) {
  int idx = 8 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 7) < N) {
    half2 reg_a_0 = HALF2(a[idx + 0]);
    half2 reg_a_1 = HALF2(a[idx + 2]);
    half2 reg_a_2 = HALF2(a[idx + 4]);
    half2 reg_a_3 = HALF2(a[idx + 6]);
    half2 reg_b_0 = HALF2(b[idx + 0]);
    half2 reg_b_1 = HALF2(b[idx + 2]);
    half2 reg_b_2 = HALF2(b[idx + 4]);
    half2 reg_b_3 = HALF2(b[idx + 6]);
    half2 reg_c_0, reg_c_1, reg_c_2, reg_c_3;
    reg_c_0.x = __hadd(reg_a_0.x, reg_b_0.x);
    reg_c_0.y = __hadd(reg_a_0.y, reg_b_0.y);
    reg_c_1.x = __hadd(reg_a_1.x, reg_b_1.x);
    reg_c_1.y = __hadd(reg_a_1.y, reg_b_1.y);
    reg_c_2.x = __hadd(reg_a_2.x, reg_b_2.x);
    reg_c_2.y = __hadd(reg_a_2.y, reg_b_2.y);
    reg_c_3.x = __hadd(reg_a_3.x, reg_b_3.x);
    reg_c_3.y = __hadd(reg_a_3.y, reg_b_3.y);
    HALF2(c[idx + 0]) = reg_c_0;
    HALF2(c[idx + 2]) = reg_c_1;
    HALF2(c[idx + 4]) = reg_c_2;
    HALF2(c[idx + 6]) = reg_c_3;
  } else if (idx < N) {
    for (int i = 0; (idx + i) < N; i++) {
      c[idx + i] = __hadd(a[idx + i], b[idx + i]);
    }
  }
}

__global__ void elementwise_add_f16x8_pack_kernel(half *a, half *b, half *c,
                                                  int N) {
  int idx = 8 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 7) < N) {
    // temporary register(memory), .local space in ptx, addressable
    half pack_a[8], pack_b[8], pack_c[8]; // 8x16 bits=128 bits.
    // reinterpret as float4 and load 128 bits in 1 memory issue.
    LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
    LDST128BITS(pack_b[0]) = LDST128BITS(b[idx]); // load 128 bits

#pragma unroll
    for (int i = 0; i < 8; i += 2) {
      // __hadd2 for half2 x 4
      HALF2(pack_c[i]) = __hadd2(HALF2(pack_a[i]), HALF2(pack_b[i]));
    }
    // reinterpret as float4 and store 128 bits in 1 memory issue.
    LDST128BITS(c[idx]) = LDST128BITS(pack_c[0]);
  } else if (idx < N) {
    for (int i = 0; (idx + i) < N; i++) {
      c[idx + i] = __hadd(a[idx + i], b[idx + i]);
    }
  }
}

#define STRINGFY(str) #str
#define TORCH_BINDING_COMMON_EXTENSION(func)                                   \
  m.def(STRINGFY(func), &func, STRINGFY(func));

#define CHECK_TORCH_TENSOR_DTYPE(T, th_type)                                   \
  if (((T).options().dtype() != (th_type))) {                                  \
    std::cout << "Tensor Info:" << (T).options() << std::endl;                 \
    throw std::runtime_error("values must be " #th_type);                      \
  }

#define TORCH_BINDING_ELEM_ADD(packed_type, th_type, element_type, n_elements) \
  void elementwise_add_##packed_type(torch::Tensor a, torch::Tensor b,         \
                                     torch::Tensor c) {                        \
    CHECK_TORCH_TENSOR_DTYPE(a, (th_type))                                     \
    CHECK_TORCH_TENSOR_DTYPE(b, (th_type))                                     \
    CHECK_TORCH_TENSOR_DTYPE(c, (th_type))                                     \
    const int ndim = a.dim();                                                  \
    if (ndim != 2) {                                                           \
      int N = 1;                                                               \
      for (int i = 0; i < ndim; ++i) {                                         \
        N *= a.size(i);                                                        \
      }                                                                        \
      dim3 block(256 / (n_elements));                                          \
      dim3 grid((N + 256 - 1) / 256);                                          \
      elementwise_add_##packed_type##_kernel<<<grid, block>>>(                 \
          reinterpret_cast<element_type *>(a.data_ptr()),                      \
          reinterpret_cast<element_type *>(b.data_ptr()),                      \
          reinterpret_cast<element_type *>(c.data_ptr()), N);                  \
    } else {                                                                   \
      const int S = a.size(0);                                                 \
      const int K = a.size(1);                                                 \
      const int N = S * K;                                                     \
      if ((K / (n_elements)) <= 1024) {                                        \
        dim3 block(K / (n_elements));                                          \
        dim3 grid(S);                                                          \
        elementwise_add_##packed_type##_kernel<<<grid, block>>>(               \
            reinterpret_cast<element_type *>(a.data_ptr()),                    \
            reinterpret_cast<element_type *>(b.data_ptr()),                    \
            reinterpret_cast<element_type *>(c.data_ptr()), N);                \
      } else {                                                                 \
        int N = 1;                                                             \
        for (int i = 0; i < ndim; ++i) {                                       \
          N *= a.size(i);                                                      \
        }                                                                      \
        dim3 block(256 / (n_elements));                                        \
        dim3 grid((N + 256 - 1) / 256);                                        \
        elementwise_add_##packed_type##_kernel<<<grid, block>>>(               \
            reinterpret_cast<element_type *>(a.data_ptr()),                    \
            reinterpret_cast<element_type *>(b.data_ptr()),                    \
            reinterpret_cast<element_type *>(c.data_ptr()), N);                \
      }                                                                        \
    }                                                                          \
  }

TORCH_BINDING_ELEM_ADD(f32, torch::kFloat32, float, 1)
TORCH_BINDING_ELEM_ADD(f32x4, torch::kFloat32, float, 4)
TORCH_BINDING_ELEM_ADD(f16, torch::kHalf, half, 1)
TORCH_BINDING_ELEM_ADD(f16x2, torch::kHalf, half, 2)
TORCH_BINDING_ELEM_ADD(f16x8, torch::kHalf, half, 8)
TORCH_BINDING_ELEM_ADD(f16x8_pack, torch::kHalf, half, 8)

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f32)
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f32x4)
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f16)
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f16x2)
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f16x8)
  TORCH_BINDING_COMMON_EXTENSION(elementwise_add_f16x8_pack)
}

```

</details>

### `elementwise.py`
<details>
<summary> elementwise.py </summary>

```python
import time
from functools import partial
from typing import Optional

import torch
from torch.utils.cpp_extension import load

torch.set_grad_enabled(False)

# Load the CUDA kernel as a python module
lib = load(
    name="elementwise_lib",
    sources=["elementwise.cu"],
    extra_cuda_cflags=[
        "-O3",
        "-U__CUDA_NO_HALF_OPERATORS__",
        "-U__CUDA_NO_HALF_CONVERSIONS__",
        "-U__CUDA_NO_HALF2_OPERATORS__",
        "-U__CUDA_NO_BFLOAT16_CONVERSIONS__",
        "--expt-relaxed-constexpr",
        "--expt-extended-lambda",
        "--use_fast_math",
    ],
    extra_cflags=["-std=c++17"],
)


def run_benchmark(
    perf_func: callable,
    a: torch.Tensor,
    b: torch.Tensor,
    tag: str,
    out: Optional[torch.Tensor] = None,
    warmup: int = 10,
    iters: int = 1000,
    show_all: bool = False,
):
    # torch.dot vs custom dot_prod kernel
    if out is not None:
        out.fill_(0)
    # warmup
    if out is not None:
        for i in range(warmup):
            perf_func(a, b, out)
    else:
        for i in range(warmup):
            _ = perf_func(a, b)
    torch.cuda.synchronize()
    start = time.time()
    # iters
    if out is not None:
        for i in range(iters):
            perf_func(a, b, out)
    else:
        for i in range(iters):
            out = perf_func(a, b)
    torch.cuda.synchronize()
    end = time.time()
    total_time = (end - start) * 1000  # ms
    mean_time = total_time / iters
    out_info = f"out_{tag}"
    out_val = out.flatten().detach().cpu().numpy().tolist()[:2]
    out_val = [round(v, 8) for v in out_val]
    print(f"{out_info:>18}: {out_val}, time:{mean_time:.8f}ms")
    if show_all:
        print(out)
    return out, mean_time


Ss = [1024, 2048, 4096]
Ks = [1024, 2048, 4096]
SKs = [(S, K) for S in Ss for K in Ks]

for S, K in SKs:
    print("-" * 85)
    print(" " * 40 + f"S={S}, K={K}")
    a = torch.randn((S, K)).cuda().float().contiguous()
    b = torch.randn((S, K)).cuda().float().contiguous()
    c = torch.zeros_like(a).cuda().float().contiguous()
    run_benchmark(lib.elementwise_add_f32, a, b, "f32", c)
    run_benchmark(lib.elementwise_add_f32x4, a, b, "f32x4", c)
    run_benchmark(partial(torch.add, out=c), a, b, "f32_th")

    print("-" * 85)
    a_f16 = a.half().contiguous()
    b_f16 = b.half().contiguous()
    c_f16 = c.half().contiguous()
    run_benchmark(lib.elementwise_add_f16, a_f16, b_f16, "f16", c_f16)
    run_benchmark(lib.elementwise_add_f16x2, a_f16, b_f16, "f16x2", c_f16)
    run_benchmark(lib.elementwise_add_f16x8, a_f16, b_f16, "f16x8", c_f16)
    run_benchmark(
        lib.elementwise_add_f16x8_pack, a_f16, b_f16, "f16x8pack", c_f16
    )
    run_benchmark(partial(torch.add, out=c_f16), a_f16, b_f16, "f16_th")
    print("-" * 85)

```

</details>

## 逐段代码剖析/学习

```c++
#include <algorithm>
#include <cuda_bf16.h>
#include <cuda_fp16.h>
#include <cuda_fp8.h>
#include <cuda_runtime.h>
#include <float.h>
#include <stdio.h>
#include <stdlib.h>
#include <torch/extension.h>
#include <torch/types.h>
#include <vector>
```

C++ 引包操作

---

```c++
#define WARP_SIZE 32
#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])
#define FLOAT4(value) (reinterpret_cast<float4 *>(&(value))[0])
#define HALF2(value) (reinterpret_cast<half2 *>(&(value))[0])
#define BFLOAT2(value) (reinterpret_cast<__nv_bfloat162 *>(&(value))[0])
#define LDST128BITS(value) (reinterpret_cast<float4 *>(&(value))[0])
```

- `define`宏定义
- `WARP_SIZE`为32

`#define INT4(value) (reinterpret_cast<int4 *>(&(value))[0])`

作用：将任意变量 value 所在内存地址的起始 16 个字节，强制重新解释为一个 CUDA 内置向量类型 int4（包含 x, y, z, w 四个 int 成员）。
- int4：CUDA结构体
- reinterpret_cast：强制类型转换操作符
- `[0]`：不知道为什么要写，可能是编写风格

---

```c++
// FP32
// ElementWise Add grid(N/256),
// block(256) a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f32_kernel(float *a, float *b, float *c,
                                           int N) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < N)
    c[idx] = a[idx] + b[idx];
}
```

- `__global__`：CPU（Host）调用GPU（Device）的标识符。
- idx计算是 根据当前BLOCK * 每个Block多少个线程 + 在当前BLOCK的线程编号
- `if (idx < N)` 存在Warp Divergence，实际上编译器会通过mask实现，SIMT保证所有thread都执行相同指令，只是mask部分不写回Register

---

```c++
// ElementWise Add + Vec4
// grid(N/256), block(256/4)
// a: Nx1, b: Nx1, c: Nx1, c = elementwise_add(a, b)
__global__ void elementwise_add_f32x4_kernel(float *a, float *b, float *c,
                                             int N) {
  int idx = 4 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 3) < N) {
    float4 reg_a = FLOAT4(a[idx]);
    float4 reg_b = FLOAT4(b[idx]);
    float4 reg_c;
    reg_c.x = reg_a.x + reg_b.x;
    reg_c.y = reg_a.y + reg_b.y;
    reg_c.z = reg_a.z + reg_b.z;
    reg_c.w = reg_a.w + reg_b.w;
    FLOAT4(c[idx]) = reg_c;
  } else if (idx < N) {
    for (int i = 0; (idx + i) < N; i++) {
      c[idx + i] = a[idx + i] + b[idx + i];
    }
  }
}
```

- 用 1 个线程干 4 个线程的活，把 4 次 32 位内存请求合并成 1 次 128 位内存请求，从而压榨显存带宽极限。
- 尾部循环处理

---

```c++
__global__ void elementwise_add_f16x8_pack_kernel(half *a, half *b, half *c,
                                                  int N) {
  int idx = 8 * (blockIdx.x * blockDim.x + threadIdx.x);
  if ((idx + 7) < N) {
    // temporary register(memory), .local space in ptx, addressable
    half pack_a[8], pack_b[8], pack_c[8]; // 8x16 bits=128 bits.
    // reinterpret as float4 and load 128 bits in 1 memory issue.
    LDST128BITS(pack_a[0]) = LDST128BITS(a[idx]); // load 128 bits
    LDST128BITS(pack_b[0]) = LDST128BITS(b[idx]); // load 128 bits

#pragma unroll
    for (int i = 0; i < 8; i += 2) {
      // __hadd2 for half2 x 4
      HALF2(pack_c[i]) = __hadd2(HALF2(pack_a[i]), HALF2(pack_b[i]));
    }
    // reinterpret as float4 and store 128 bits in 1 memory issue.
    LDST128BITS(c[idx]) = LDST128BITS(pack_c[0]);
  } else if (idx < N) {
    for (int i = 0; (idx + i) < N; i++) {
      c[idx + i] = __hadd(a[idx + i], b[idx + i]);
    }
  }
}
```

- `#pragma unroll`：编译时循环展开（如果能确定）；但是一般适用小循环，成千上万的循环展开会导致性能下降。

---

```c++
if (ndim != 2) {                                                           \
      int N = 1;                                                               \
      for (int i = 0; i < ndim; ++i) {                                         \
        N *= a.size(i);                                                        \
      }                                                                        \
      dim3 block(256 / (n_elements));                                          \
      dim3 grid((N + 256 - 1) / 256);                                          \
      elementwise_add_##packed_type##_kernel<<<grid, block>>>(                 \
          reinterpret_cast<element_type *>(a.data_ptr()),                      \
          reinterpret_cast<element_type *>(b.data_ptr()),                      \
          reinterpret_cast<element_type *>(c.data_ptr()), N);                  \
    } else {                                                                   \
      const int S = a.size(0);                                                 \
      const int K = a.size(1);                                                 \
      const int N = S * K;                                                     \
      if ((K / (n_elements)) <= 1024) {                                        \
        dim3 block(K / (n_elements));                                          \
        dim3 grid(S);                                                          \
        elementwise_add_##packed_type##_kernel<<<grid, block>>>(               \
            reinterpret_cast<element_type *>(a.data_ptr()),                    \
            reinterpret_cast<element_type *>(b.data_ptr()),                    \
            reinterpret_cast<element_type *>(c.data_ptr()), N);                \
      } else {                                                                 \
        int N = 1;                                                             \
        for (int i = 0; i < ndim; ++i) {                                       \
          N *= a.size(i);                                                      \
        }                                                                      \
        dim3 block(256 / (n_elements));                                        \
        dim3 grid((N + 256 - 1) / 256);                                        \
        elementwise_add_##packed_type##_kernel<<<grid, block>>>(               \
            reinterpret_cast<element_type *>(a.data_ptr()),                    \
            reinterpret_cast<element_type *>(b.data_ptr()),                    \
            reinterpret_cast<element_type *>(c.data_ptr()), N);                \
      }                                                                        \
    }                                          
```
其他部分主要是宏定义和展开，不细究。但是上面的代码制定了如何切块。

整体逻辑：
- if (ndim != 2)（非矩阵，或维度不是恰好 2 维）：走“一维摊平”策略。不管你是 1 维、3 维还是 4 维张量，统统把数据拉成一根直线（总长度 N），用一维索引去算。
- else（ndim == 2，即二维矩阵）：走“矩阵专属”策略。根据列数（K）的多少，再分两种情况处理
    - 因为 GPU 一个 Block 最多支持 1024 个线程，如果每行的 float4 数量不超过 1024，那么代码让 “一行数据独占一个 Block”。
    - 超过1024，就和if (ndim != 2)类似处理流程。




