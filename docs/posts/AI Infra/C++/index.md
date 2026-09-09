---
title: C++
order: 6
---

# C++ 学习资源导航

面向 AI Infra 方向的 C++ 学习资源汇总：基础语法 → 现代特性 → 并发 → 高性能 → 面试八股 → 推理引擎源码。以中文资源为主，均经过可访问性验证。

> 收集于 2026-09，链接若失效可搜索标题。

## 一、入门：语法基础

- [菜鸟教程 C++](https://www.runoob.com/cplusplus/cpp-tutorial.html) — 快速过一遍基本语法的查询手册
- [learncpp.com](https://www.learncpp.com/) — 公认最好的免费英文入门教程，系统且持续更新，适合完整学一遍
- [C++ 学习路线 - 编程指北](https://csguide.cn/roadmap/cpp/how_to_learn_cpp.html) — 中文学习路线总览，先看这个建立全局感
- [cppreference.com](https://zh.cppreference.com/w/%E9%A6%96%E9%A1%B5) — 权威标准文档（有中文版），当字典用

## 二、现代 C++：C++11/14/17/20 新特性

- [现代 C++ 教程：高速上手 C++11/14/17/20](https://changkun.de/modern-cpp/zh-cn/00-preface/) — 免费开源在线书，讲清 C++11 起的关键特性，必读
- [0voice/cpp_new_features](https://github.com/0voice/cpp_new_features) — C++11~23 新特性资料合集仓库

## 三、进阶：对象模型、STL、并发

### 书籍（按阅读顺序）
- 《Effective C++》+《Effective Modern C++》— 编码规范与 C++11+ 最佳实践
- 《STL 源码剖析》（侯捷）— 容器/内存池/traits 底层实现，面试高频
- 《深度探索 C++ 对象模型》— 虚函数、多重继承的底层机制
- 《C++ Concurrency In Action》— 并发编程权威指南
- 《Linux 多线程服务端编程》（陈硕）— 多线程工程实践

### 在线资源
- [现代 C++ 对多线程/并发的支持（博客园系列）](https://www.cnblogs.com/tengzijian/p/a-tour-of-cpp-modern-cpp-concurrency-1.html) — 内存模型、原子操作、无锁编程

## 四、AI Infra 方向：高性能与 CUDA Host

- [CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/) — 官方指南，host 端资源管理/数据传输
- [CUDA C++ Best Practices Guide 中文版](https://www.aidoczh.com/cuda/cuda-c-best-practices-guide/index.html) — 官方最佳实践翻译，性能优化方法论
- [CUDA 性能指南（NVIDIA 中文博客）](https://developer.nvidia.cn/blog/cuda-performance-guide-cn/) — 并行度/内存吞吐/指令吞吐四大策略
- [CUDA 程序优化系列（博客园）](https://www.cnblogs.com/sunstrikes/p/18235920) — 来自异构训练框架实践的优化合集

## 五、面试八股

### 综合仓库
- [huihut/interview](https://github.com/huihut/interview)（[在线阅读版](https://interview.huihut.com)）— 最经典的 C/C++ 面试知识总结：语言/STL/数据结构/OS/网络/链接装载全覆盖，先刷这个
- [guaguaupup/cpp_interview](https://github.com/guaguaupup/cpp_interview) — C++ 后台开发面经，特点是有深度有发散（不just解释概念），含 [手撕代码](https://github.com/guaguaupup/cpp_interview/blob/main/%E6%89%8B%E6%92%95%E4%BB%A3%E7%A0%81.md)
- [youngyangyang04/TechCPP](https://github.com/youngyangyang04/TechCPP) — 代码随想录 C++ 面试指南，STL 算法库/allocator/RAII 等
- [卡码笔记 C++ 高频面试题](https://notes.kamacoder.com/cpp/) — 基础语法/面向对象/智能指针/并发，网页阅读体验好

### 高频手撕（Infra 岗常考）
- 线程池：任务队列 + 条件变量 + 互斥锁 + 优雅关闭 — [手撕线程池（牛客）](https://www.nowcoder.com/discuss/720368558441541632)
- shared_ptr：引用计数控制块 + 拷贝/赋值/析构 — [手写 shared_ptr（B站）](https://www.bilibili.com/video/BV1Zj411C7zy/)
- 内存池：参考 Nginx 池设计 — [池式编程：内存池（知乎）](https://zhuanlan.zhihu.com/p/544545794)
- [C++ 常见手撕题整理（掘金）](https://juejin.cn/post/7430183079758037029) — 力扣 Hot100 之外的设计题合集

## 六、AI Infra 实战：推理引擎源码

- [llama.cpp](https://github.com/ggml-org/llama.cpp) — 纯 C/C++ 推理引擎，C++ 源码学习首选：编译跑通 → 从 main() 自顶向下 → ggml 张量库 → 算子 SIMD/CUDA 实现
- [自顶向下了解 llama.cpp - ggml](https://www.haibinlaiblog.top/index.php/%E8%87%AA%E9%A1%B6%E5%90%91%E4%B8%8B%E4%BA%86%E8%A7%A3llama-cpp-ggml/) — 从 main() 入手的源码导读
- [llama.cpp 深度解析：从 GGML 到 GPU 推理的全链路优化（掘金）](https://juejin.cn/post/7642347004715778054) — 张量运算如何优化到 AVX-512
- [图解 vLLM 源码解析 1：整体架构（知乎）](https://zhuanlan.zhihu.com/p/691045737) — 经典系列，PagedAttention/Scheduler/连续批处理（主体 Python，C++ 内核在 csrc）
- [vLLM 推理引擎学习手册](https://github.com/jwzheng96/vllm-learning-book) — 46 章源码教程，每章锁定 commit
- [TensorRT-LLM 源码分析（知乎）](https://zhuanlan.zhihu.com/p/1938338553202480055) — Python 层 + C++ backend 结构
- [C++ 程序员转型 AI Infra 学习路线（CSDN）](https://blog.csdn.net/qq_29426201/article/details/161686282) — 职业方向参考

## 建议路线

1. **基础**：菜鸟教程/learncpp 过语法 → 现代C++教程补 C++11+ 特性
2. **进阶**：Effective 系列 + STL 源码剖析 + 并发编程
3. **八股**：huihut/interview 通读 → guaguaupup 深入 → 手撕线程池/shared_ptr/内存池
4. **Infra 实战**：CUDA host 编程 → 读 llama.cpp 源码 → vLLM/TensorRT-LLM 架构
