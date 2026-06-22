---
title: "区间DP-算法日常练习记录"
date: 2024-05-10 :20
tags:
- 算法
category: 本科课程笔记
order: 80
---

# 区间DP-算法日常练习记录

## 1388. 游戏
[1388. 游戏 - AcWing题库](https://www.acwing.com/problem/content/1390/)

```
"""
https://www.acwing.com/problem/content/description/1390/
"""

# 录入数据
n = int(input())
lst = list(map(int, input().strip().split()))
while len(lst) < n:
    lst.extend(list(map(int, input().strip().split())))
# 初始化
dp = [[0] * (n + 10) for _ in range(n + 10)]
for length in range(1, n + 1):
    for i in range(n):
        if i + length - 1 < n:
            j = i + length - 1
            dp[i][j] = max(lst[i] - dp[i + 1][j],
                           lst[j] - dp[i][j - 1])
d = dp[0][n - 1]
# print(dp)
s = sum(lst)
print("{} {}".format((s + d) // 2, (s - d) // 2))

```
## #10147. 「一本通 5.1 例 1」石子合并
[#10147. 「一本通 5.1 例 1」石子合并 - 题目 - LibreOJ (loj.ac)](https://loj.ac/p/10147)

```
"""
https://loj.ac/p/10147
考虑按照圆形排列的情况!!!
"""
from math import inf

n = int(input().strip())
lst = list(map(int, input().strip().split(" ")))
# 直接简单粗暴的重复
n = 2 * n
lst = lst * 2
# 前缀和
sum_lst = lst.copy()
for i in range(1, n):
    sum_lst[i] = sum_lst[i] + sum_lst[i - 1]
# 初始化数组
dp_min = [[inf] * n for _ in range(n)]
dp_max = [[0] * n for _ in range(n)]
for i in range(n):
    dp_min[i][i] = 0
# 区间DP
for length in range(1, n):
    for i in range(n):
        j = min(i + length, n - 1)
        for k in range(i, j):
            # print(i, j, k)
            dp_max[i][j] = max(dp_max[i][j], dp_max[i][k] + dp_max[k + 1][j] + sum_lst[j] - sum_lst[i] + lst[i])
            dp_min[i][j] = min(dp_min[i][j], dp_min[i][k] + dp_min[k + 1][j] + sum_lst[j] - sum_lst[i] + lst[i])
res1 = inf
res2 = -inf
for i in range(n // 2):
    res1 = min(res1, dp_min[i][i + n // 2 - 1])
    res2 = max(res2, dp_max[i][i + n // 2 - 1])
print(res1)
print(res2)

```
## 1222. 密码脱落
[1222. 密码脱落 - AcWing题库](https://www.acwing.com/problem/content/1224/)

```
"""
https://www.acwing.com/problem/content/1224/
"""
from math import inf

# 录入数据
s = input()
n = len(s)
# 初始化
dp = [[inf] * n for _ in range(n)]
for i in range(n):
    dp[i][i] = 0
# dp
for length in range(2, n + 1):
    for i in range(n):
        if i + length - 1 < n:
            j = i + length - 1
            # print(i, j)
            if s[i] == s[j]:
                if j-i == 1: # 特判
                    dp[i][j] = 0
                dp[i][j] = min(dp[i + 1][j - 1], dp[i][j])
            else:
                dp[i][j] = min(dp[i + 1][j] + 1, dp[i][j - 1] + 1, dp[i][j], dp[i + 1][j - 1] + 2)
# print(dp)
print(dp[0][n - 1])

```
## 320. 能量项链
[320. 能量项链 - AcWing题库](https://www.acwing.com/problem/content/322/)

```
"""
https://www.acwing.com/problem/content/322/
"""

# 数据录入
n = int(input())
lst = list(map(int, input().strip().split(" ")))
w = []
for i in range(n):
    t = (lst[i], lst[(i + 1) % n])
    w.append(t)
# 处理环形
w = w * 2
n = n * 2
# dp初始化
dp = [[0] * n for _ in range(n)]
for length in range(2, n + 1):
    for i in range(n):
        if i + length - 1 < n:
            j = i + length - 1
            for k in range(i, j):
                dp[i][j] = max(dp[i][j],
                               dp[i][k] + dp[k + 1][j] + w[i][0] * w[k][1] * w[j][1])

# 比较出最大的结果
res = -1
for i in range(n // 2):
    res = max(res, dp[i][i + n // 2 - 1])
print(res)

```
