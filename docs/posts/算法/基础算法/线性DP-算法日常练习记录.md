---
title: "线性DP-算法日常练习记录"
date: 2024-05-05 :11
tags:
- 算法
category: 算法
order: 21
---

# 线性DP-算法日常练习记录

## 312. 乌龟棋
[312. 乌龟棋 - AcWing题库](https://www.acwing.com/problem/content/314/)

```
"""
https://www.acwing.com/problem/content/description/314/
"""

def cal_step(a, b, c, d):
    return a + 2 * b + 3 * c + 4 * d

# 数据录入
n, m = map(int, input().split(" "))
w = list(map(int, input().split(" ")))
step = list(map(int, input().split(" ")))
# 处理数据
num = [0] * 5
for s in step:
    num[s] += 1
# print(num)
# 创建dp数组
dp = [[[[0] * 41
        for _ in range(41)]
       for _ in range(41)]
      for _ in range(41)]
dp[0][0][0][0] = w[0]
for a in range(num[1] + 1):
    for b in range(num[2] + 1):
        for c in range(num[3] + 1):
            for d in range(num[4] + 1):
                step = cal_step(a, b, c, d)
                if a:
                    dp[a][b][c][d] = max(dp[a][b][c][d], dp[a - 1][b][c][d] + w[step])
                if b:
                    dp[a][b][c][d] = max(dp[a][b][c][d], dp[a][b - 1][c][d] + w[step])
                if c:
                    dp[a][b][c][d] = max(dp[a][b][c][d], dp[a][b][c - 1][d] + w[step])
                if d:
                    # print(a,b,c,d,step)
                    dp[a][b][c][d] = max(dp[a][b][c][d], dp[a][b][c][d - 1] + w[step])

print(dp[num[1]][num[2]][num[3]][num[4]])

```
[zz. - 力扣(LeetCode)](https://leetcode.cn/problems/qJnOS7/)

## 最长公共子序列
[. - 力扣(LeetCode)](https://leetcode.cn/problems/qJnOS7/)

```
"""
https://leetcode.cn/problems/qJnOS7/
"""

def longestCommonSubsequence(text1: str, text2: str) -> int:
    n1 = len(text1)
    n2 = len(text2)
    dp = [[0] * n2 for _ in range(n1)]
    # 初始化第一行和第一列,写的稍微复杂了点
    flag = 0
    for i in range(n1):
        j = 0
        if text1[i] == text2[j]:
            flag = 1
        dp[i][j] = flag
    flag = 0
    for j in range(n2):
        i = 0
        if text1[i] == text2[j]:
            flag = 1
        dp[i][j] = flag
    for i in range(1, n1):
        for j in range(1, n2):
            if text1[i] == text2[j]:
                dp[i][j] = max(dp[i][j], dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + 1)
            else:
                dp[i][j] = max(dp[i][j], dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[-1][-1]

text1 = "abcde"
text2 = "ace"
res = longestCommonSubsequence(text1=text1, text2=text2)
print(res)

```
## 5406. 松散子序列
[5406. 松散子序列 - AcWing题库](https://www.acwing.com/problem/content/5409/)

```
"""
https://www.acwing.com/problem/content/5409/
"""

# 录入数据
s = input()
# 初始化w数组
w = [ord(i) - ord('a') + 1 for i in s]
n = len(s)
# 特判
if n <= 2:
    print(max(w))
    exit()
dp = [0] * n
dp[0], dp[1] = w[0], max(w[0], w[1])  # 这里一开始没想到，浪费了贼多时间
for i in range(2, n):
    dp[i] = max(dp[i - 1], dp[i - 2] + w[i])
print(dp[-1])

```
