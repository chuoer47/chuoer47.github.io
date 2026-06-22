---
title: "【蓝桥杯 路径 python】Dij算法"
date: 2023-03-14 :08
tags:
- 算法
category: 本科课程笔记
order: 76
---

# 【蓝桥杯 路径 python】Dij算法

题目来源：

[P1553 - [蓝桥杯2021初赛] 路径 - New Online Judge (ecustacm.cn)](http://oj.ecustacm.cn/problem.php?id=1553)

经过两天的学习总算搞定了python的Dij算法，不得不说python的库函数太强大了，还有最小堆。

先简单介绍一下python里面的heapq库函数

可以参考：[(79条消息) python-堆_python 堆_QFIUNE的博客-CSDN博客](https://blog.csdn.net/weixin_42038527/article/details/119257198?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522167876962816800226528134%2522%252C%2522scm%2522%253A%252220140713.130102334..%2522%257D&request_id=167876962816800226528134&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~top_click~default-2-119257198-null-null.142%5Ev73%5Ewechat,201%5Ev4%5Eadd_ask,239%5Ev2%5Einsert_chatgpt&utm_term=python%20%E5%A0%86&spm=1018.2226.3001.4187)

首先是引入库函数

```
import heapq
```
 主要的类方法有：

```
heap = []
heapq.heappush(heap,item)
heapq.heappop(heap)
heapq.heapify(heap)
```
heapq.heappush为向堆加入一个对象

heapq.heappop为堆推出一个对象

heapq/heapify为建立最小堆

有了上述工具就可以完成距离矩阵的Dij最小堆算法了

```
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

时间复杂度O(nlogn)，对于题目的2021*2021的数据量，简简单单的。

 余下代码：

```
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
    if i<=22:
        for j in range(1,i+22):
            tem.append(f(j,i))
        tem = tem + [9999999999]*(2021-len(tem))
    elif i>=2000:
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

答案为：

 10266837
