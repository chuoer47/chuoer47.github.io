---
title: "蓝桥杯 路径 - Dij 算法"
date: 2023-03-14
tags:
- 算法
- 图论
- Python
category:
- 蓝桥杯
order: 10
---

# 蓝桥杯 路径 - Dij 算法

题目来源：[P1553 - 路径](http://oj.ecustacm.cn/problem.php?id=1553)

经过两天的学习总算搞定了 python 的 Dij 算法，不得不说 python 的库函数太强大了，还有最小堆。

## Python heapq 库

可以参考：[python - 堆](https://blog.csdn.net/weixin_42038527/article/details/119257198)

首先是引入库函数

```python
import heapq
```

主要的类方法有：

```python
heap = []
heapq.heappush(heap,item)
heapq.heappop(heap)
heapq.heapify(heap)
```

- `heapq.heappush` 为向堆加入一个对象
- `heapq.heappop` 为堆推出一个对象
- `heapq.heapify` 为建立最小堆

## Dij 最小堆算法

有了上述工具就可以完成距离矩阵的 Dij 最小堆算法了

```python
import heapq
max_dis = 9999999999 # 根据题目意思取一个最大值作为断路
def Dij(dis:list[list[int]],start:int)->list:
    res = [max_dis] * len(dis)
    visit = [0] * len(dis) # 是否访问记录数组
    res[start] = 0
    visit[start] = 1
    heap = []
    for pivot,d in enumerate(dis[start]): # 利用枚举
        if d != max_dis:
            res[pivot] = d
            heapq.heappush(heap,(d,pivot)) # 初步更新res
    while heap:
        pre_d,pre_pivot = heapq.heappop(heap)
        if visit[pre_pivot]:
            continue
        visit[pre_pivot] = 1
        for pivot,d in enumerate(dis[pre_pivot]):
            if res[pivot]>pre_d+d: # 松弛
                res[pivot] = res[pre_pivot]+d
                heapq.heappush(heap,(res[pivot],pivot))
    return res
```

剩下的工作就是按照题目要求，把距离矩阵搞出来就好了

时间复杂度 O(nlogn)，对于题目的 2021*2021 的数据量，简简单单的。

## 完整代码

```python
def f(x,y):
    if x==y:#当到自身是路径为0
        return 0
    x,y = max(x,y),min(x,y)
    add = x
    while True:
        if x%y==0:
            return x
        else:
            x += add

arr = []
for i in range(1,2022):
    tem = []
    if i>=2000:
        for j in range(i-21,2022):
            tem.append(f(j,i))
        tem = [9999999999]*(2021-len(tem)) + tem
    else:
        for j in range(i-21,i+22):
            tem.append(f(j,i))
        tem = [9999999999]*(i-22) + tem + [9999999999]*(2021-i-21)
    arr.append(tem)
print("over!arr")
print(len(arr))
res = Dij(arr,0)
print(res[2020])
```

搞定！！

答案为：10266837
