---
title: "DFS-算法日常练习记录"
date: 2024-04-11 :38
tags:
- 算法
category: 本科课程笔记
order: 66
---

# DFS-算法日常练习记录

## 2060. 奶牛选美
[2060. 奶牛选美 - AcWing题库](https://www.acwing.com/problem/content/2062/)

```
"""
https://www.acwing.com/problem/content/2062/
题目思路：
1. 先通过深搜将两个斑点找到
2. 在通过找到的两类，进行dfs。在dfs的过程中剪枝
"""
from math import inf
import sys

sys.setrecursionlimit(100000)  # 例如这里设置为十万

choose = [[1, 0], [-1, 0], [0, 1], [0, -1]]  # 方向选择
dis = inf

def judgeEdge(x, y):
    # 判断是否超出边界
    return x < 1 or x > n or y < 1 or y > m

def find(x, y):
    if judgeEdge(x, y) or (x, y) not in first:
        return
    first.remove((x, y))  # 移除
    second.append((x, y))  # 移入
    for l, r in choose:
        xx, yy = x + l, y + r
        if lst[xx][yy]:
            find(xx, yy)

def distance(x, y, ndis):
    """
    DFS广搜，找到最近的距离
    """
    dis = inf
    deque = [(x, y, ndis)]
    visit = [[0] * (m + 10) for i in range(n + 10)]
    visit[x][y] = 1
    while deque:
        x, y, ndis = deque.pop(0)
        if judgeEdge(x, y):
            continue
        for l, r in choose:
            xx, yy = x + l, y + r
            if lst[xx][yy]:  # 识别到1
                if (xx, yy) in second:  # 达到最近的第二类
                    dis = ndis
                    deque = []  # 清空列表
                    break
            else:
                if not visit[xx][yy]:  # 还有路走
                    visit[xx][yy] = 1
                    deque.append((xx, yy, ndis + 1))
    return dis

n, m = map(int, input().split(" "))
lst = [[0] * (m + 10) for i in range(n + 10)]
s = []
for i in range(n):
    s.append(input().strip())
first = []
second = []
# 获得矩阵
for i in range(n):
    ss = s[i]
    for ii in range(m):
        if ss[ii] == 'X':
            lst[i + 1][ii + 1] = 1
            first.append((i + 1, ii + 1))  # 保存斑点位置

x, y = first[0]
# find为找到两个斑点，然后再开始广搜
find(x, y)

dis = m * n
for x, y in first:
    dis = min(dis, distance(x, y, 0))
print(dis)

```
## 1207. 大臣的旅费
[1207. 大臣的旅费 - AcWing题库](https://www.acwing.com/problem/content/1209/)

```
"""
https://www.acwing.com/problem/content/1209/
这道题目可以直接使用求树的直径，但是题目特殊性保证了直径一定会经过首都，因此可以只用一次DFS
"""
import sys

sys.setrecursionlimit(1000000)

def dfs(p, father):
    if not dis[p]:  # 没有路了
        return 0
    one, two = 0, 0
    for np, value in dis[p]:
        tem = 0
        if np != father:
            tem = dfs(np, p) + value
        if tem > one:
            one, two = tem, one
        elif tem > two:
            two = tem
        global ans
        ans = max(ans, one + two)
    return one

n = int(input())
dis = [[] for _ in range(n + 10)]
for _ in range(n - 1):
    p, q, d = map(int, input().split(" "))
    dis[p].append((q, d))
    dis[q].append((p, d))
ans = 0
dfs(1, -1)
# print(dis)
ans = ans*10 + ans*(1+ans)//2
print(ans)

```
## 389. 直径
[389. 直径 - AcWing题库](https://www.acwing.com/file_system/file/content/whole/index/content/3940/)

 这道题目求最长公共路径我不太会，hhhh

 只求的出来直径的长度和记录路径

```
"""
https://www.acwing.com/file_system/file/content/whole/index/content/3940/
做不出来
"""
import sys

sys.setrecursionlimit(100000)

def dfs_node(node, father):
    """
    找到从node出发的价值最大的叶子节点和其路径
    :param node:
    :param father:
    :return:
    """
    if not dis[node]:
        return node, 0
    button_node, max_v, edge = node, 0, 0
    for next, value in dis[node]:
        if next != father:
            tem_node, tem_v = dfs_node(next, node)
            tem_v += value
            if tem_v > max_v:
                max_v = max(tem_v, max_v)
                button_node = tem_node
    return button_node, max_v

def dfs_num(node, father):
    """
    找到从node出发的价值最大的叶子节点和其路径
    :param node:
    :param father:
    :return:
    """
    global max_value
    if not dis[node]:
        return
    if max_value == 0:
        lst.append(seq.copy())  # 找到了一条序列
        return
    for next, value in dis[node]:
        if next != father:
            max_value -= value
            seq.append(next)
            dfs_num(next, node)
            seq.pop()
            max_value += value

n = int(input())
dis = [[] for i in range(n + 10)]
for i in range(n - 1):
    a, b, c = map(int, input().split(" "))
    dis[a].append((b, c))
    dis[b].append((a, c))
# print(dis)
first, first_value = dfs_node(1, -1)  # 找到直径的一端
second, max_value = dfs_node(first, -1)  # 找到直径的最大值
lst = []
seq = [first]
dfs_num(first, -1)
print(max_value)
print(lst)

```
## 4407. 扫雷
[4407. 扫雷 - AcWing题库](https://www.acwing.com/problem/content/4410/)

 没有AC，只会简单思路

```
"""
https://www.acwing.com/problem/content/4410/
"""

def find(): # 找到同一地点的多枚炸弹
    res = 0
    for i in has_mine:
        for j in mine:
            if j == i:
                res += 1
    return res

def dfs(x, y, r):
    for i in mine:
        if i not in has_mine:
            xx, yy, rr = i
            if (xx - x) ** 2 + (yy - y) ** 2 <= r ** 2:
                has_mine.append([xx, yy, rr])
                # 递归炸弹
                dfs(xx, yy, rr)

n, m = map(int, input().split(" "))
mine = [list(map(int, input().split(" "))) for _ in range(n)]
mineFire = [list(map(int, input().split(" "))) for _ in range(m)]
has_mine = []
# print(mine, has_mine)
for i in mineFire:
    # 开炸
    x, y, r = i
    dfs(x, y, r)
res = find()
print(res)

```
