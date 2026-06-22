---
title: "状压DP-算法日常练习记录"
date: 2024-05-03 :24
tags:
- 算法
category: 本科课程笔记
order: 90
---

# 状压DP-算法日常练习记录

## 731. 毕业旅行问题
[731. 毕业旅行问题 - AcWing题库](https://www.acwing.com/problem/content/733/)

```
"""
https://www.acwing.com/problem/content/733/
"""
from math import inf

# 数据录入
n = int(input())
w = [list(map(int, input().strip().split(" "))) for i in range(n)]

# 初始化
N = 20
f = [[inf] * n for _ in range(1 << n)]
f[1][0] = 0  # 开始出发为0

# 状压DP
for st in range(1, 1 << n, 2):  # 优化常数，因为必须要经过第一个城市
    for j in range(0, n):
        if (1 << j) > st:
            break
        if not ((st >> j) & 1):
            continue
        for k in range(0, n):
            if (st >> k) & 1 and k!=j:  # k存在
                f[st][j] = min(f[st - (1 << j)][k] + w[k][j], f[st][j])

# 求解答案
res = inf
st = ((1 << n) - 1)
for i in range(0, n):
    res = min(f[st][i] + w[i][0], res)

print(res)

```
## 291. 蒙德里安的梦想
[291. 蒙德里安的梦想 - AcWing题库](https://www.acwing.com/problem/content/293/)

```
"""
https://www.acwing.com/problem/content/293/
整体思路：
1.进行状态预处理，保证时间复杂度
2.进行DP
"""

while True:
    n, m = map(int, input().split(" "))
    if n == 0 and m == 0:
        break
    st = [True] * (1 << n)
    # 状态预处理
    for i in range(len(st)):
        st[i] = True  # 假设成立
        cnt = 0
        for j in range(n):
            if (i >> j) & 1:  # 第 j 位为1
                if cnt % 2 == 1:  # cnt是奇数
                    st[i] = False
                    break
            else:
                cnt += 1
        if cnt % 2 == 1:  # 特判
            st[i] = False
    f = [[0] * (1 << n) for _ in range(m + 1)]  # (m+1)保证答案f[m+1][0],f[i][j]表示前i-1列排列完毕，第j种排列状态的组合数
    f[0][0] = 1  # 初始化
    # 状压DP
    for i in range(1, m + 1):
        for j in range(1 << n):
            for k in range(1 << n):
                if j & k == 0 and st[j | k]:  # 满足布满i列
                    f[i][j] += f[i - 1][k]
    # 输出答案
    print(f[-1][0])

```
## 91. 最短Hamilton路径
[91. 最短Hamilton路径 - AcWing题库](https://www.acwing.com/problem/content/93/)

```
"""
https://www.acwing.com/problem/content/93/
"""
from math import inf

n = int(input())
w = [list(map(int, input().split(" "))) for _ in range(n)]
f = [[inf] * n for _ in range(1 << n)]
f[1][0] = 0  # 初始化
# DP
for i in range(1, 1 << n, 2):
    for j in range(n):
        if (1 << j) - 1 > i:  # 剪枝
            break
        if not ((i >> j) & 1):  # 第j位不为1
            continue
        for k in range(n):
            if ((i - (1 << j)) >> k) & 1:  # 第k位不重，而且存在
                f[i][j] = min(f[i - (1 << j)][k] + w[k][j], f[i][j])
print(f[-1][-1])

```
## 3494. 国际象棋
[3494. 国际象棋 - AcWing题库](https://www.acwing.com/problem/content/3497/)

```
"""
https://www.acwing.com/problem/content/3497/
"""

def count_one(x):
    cnt = 0
    while x:
        cnt += 1
        x -= x & -x
    return cnt

n, m, k = map(int, input().strip().split(" "))
MOD = int(1e9 + 7)
# 建立DP数组
f = [[[[0] * (k + 1)
       for _ in range(1 << n)]
      for _ in range(1 << n)]
     for _ in range(m + 3)]
f[0][0][0][0] = 1  # 初始化
cnt_pre = [count_one(i) for i in range(1 << n)]  # 预处理数组，加快速度

# 开始dp
for i in range(1, m + 3):
    for a in range(1 << n):
        for b in range(1 << n):
            if (a & (b << 2)) or (b & (a << 2)):  # 冲突了
                continue
            for c in range(1 << n):
                if (c & (a << 2)) or (a & (c << 2)) or (c & (b << 1)) or (b & (c << 1)):
                    continue
                cnt = cnt_pre[b]
                for j in range(cnt, k + 1):
                    f[i][a][b][j] = (f[i][a][b][j] + f[i - 1][c][a][j - cnt]) % MOD

# 完成DP，输出结果
print(f[m + 2][0][0][k])

```
## 4957. 飞机降落
[4957. 飞机降落 - AcWing题库](https://www.acwing.com/problem/content/4960/)

```
"""
https://www.acwing.com/problem/content/4960/
"""
from math import inf

cycle = int(input())
for _ in range(cycle):
    n = int(input())
    lst = [list(map(int, input().split(" "))) for _ in range(n)]
    f = [inf] * (1 << n)
    f[0] = 0
    for i in range(1 << n):
        for j in range(n):
            if i >> j & 1:
                t, d, l = lst[j]
                pre = i - (1 << j)
                if t >= f[pre]:
                    f[i] = min(f[i], t + l)
                else:
                    if t + d >= f[pre]:
                        f[i] = min(f[i], f[pre] + l)
    if f[-1] != inf:
        print("YES")
    else:
        print("NO")

```
