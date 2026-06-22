---
title: "Flood Fill-算法日常练习记录"
date: 2024-04-18 :50
tags:
- 算法
category: 算法
order: 11
---

# Flood Fill-算法日常练习记录

## 687. 扫雷
[687. 扫雷 - AcWing题库](https://www.acwing.com/problem/content/689/)

```
"""
https://www.acwing.com/problem/content/689/
"""
import queue
from math import inf

options = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]

def bfs(x, y):
    # print(x, y)
    q = queue.Queue()
    q.put((x, y))
    while not q.empty():
        i, j = q.get()
        if st[i][j] > 0 or st[i][j] == -1:
            st[i][j] = -1
            continue
        st[i][j] = -1
        for l, r in options:
            ii, jj = i + l, j + r
            if ii < 0 or ii >= n or jj < 0 or jj >= n:
                continue
            else:
                if st[ii][jj] != -1:
                    q.put((ii, jj))
    # print(st)

cycle = int(input())
F = []
for _ in range(cycle):
    n = int(input())
    lst = []
    for _ in range(n):
        lst.append(input())
    st = [[-1] * n for i in range(n)]
    for i in range(n):
        for j in range(n):
            if lst[i][j] == "*":
                st[i][j] = -1
                continue
            if lst[i][j] == ".":
                mine = 0
                for l, r in options:
                    ii, jj = i + l, j + r
                    if ii < 0 or ii >= n or jj < 0 or jj >= n:
                        continue
                    else:
                        if lst[ii][jj] == "*":
                            mine += 1
                st[i][j] = mine
    res = 0
    for i in range(n):
        for j in range(n):
            if st[i][j] == 0:
                bfs(i, j)
                res += 1
    for i in range(n):
        for j in range(n):
            if st[i][j] != -1:
                res += 1
    F.append(res)
for p, i in enumerate(F):
    print("Case #{}: {}".format(p + 1, i))

```
## 643. 动态网格
[643. 动态网格 - AcWing题库](https://www.acwing.com/problem/content/645/)

```
"""
https://www.acwing.com/problem/content/645/
朴素写法，每次都要进行判断，所以超时了
"""

import queue

options = [(1, 0), (-1, 0), (0, 1), (0, -1)]
flag = []

def bfs(x, y):
    q = queue.Queue()
    q.put((x, y))
    while not q.empty():
        i, j = q.get()
        for l, r in options:
            ii, jj = i + l, j + r
            if ii < 0 or ii >= R or jj < 0 or jj >= C:  # 越界
                continue
            else:
                if lst[ii][jj] == 1 and flag[ii][jj] == 0:
                    flag[ii][jj] = 1
                    q.put((ii, jj))

def solve():
    global flag
    flag = [[0] * C for _ in range(R)]
    res = 0
    for i in range(R):
        for j in range(C):
            if lst[i][j] == 1 and flag[i][j] == 0:
                res += 1
                bfs(i, j)
    return res

T = int(input())
for case in range(T):
    R, C = map(int, input().split(" "))
    output = []  # 输出队列
    t = [input() for _ in range(R)]
    lst = [[0] * C for _ in range(R)]
    for i in range(R):
        for j in range(C):
            if t[i][j] == "1":
                lst[i][j] = 1
    N = int(input())
    operate = [list(input().split(" ")) for _ in range(N)]
    for op in operate:
        if op[0] == "Q":
            res = solve()  # 广搜
            last = res
            output.append(res)
        else:
            x, y, z = map(int, op[1:])
            lst[x][y] = z
    print("Case #{}:".format(case + 1))
    for out in output:
        print(out)

```
## 3224. 画图
```
"""
https://www.acwing.com/problem/content/3227/
"""
import queue

options = [(1, 0), (-1, 0), (0, 1), (0, -1)]

def flood_fill(lst):
    x, y, char = lst
    x, y = int(x), int(y)
    q = queue.Queue()
    q.put((n - 1 - y, x))
    flag = set()
    while not q.empty():
        xx, yy = q.get()
        draw[xx][yy] = char
        for dx, dy in options:
            x, y = xx + dx, yy + dy
            if x < 0 or x >= n or y < 0 or y >= m:
                continue
            if draw[x][y] != "-" and draw[x][y] != "+" and draw[x][y] != "|" and (x,y) not in flag:
                flag.add((x,y))
                q.put((x, y))

def draw_line(lst):
    x1, y1, x2, y2 = map(int, lst)
    # 分类讨论得了，懒得动大脑了
    if x1 == x2:
        char = "|"
        y1, y2 = n - 1 - min(y1, y2), n - 1 - max(y1, y2),
        for y in range(y2, y1 + 1):
            if draw[y][x1] == "-" or draw[y][x1]=="+":
                draw[y][x1] = "+"
            else:
                draw[y][x1] = char
    if y1 == y2:
        char = "-"
        x1, x2 = min(x1, x2), max(x1, x2)
        y = n - 1 - y1
        for x in range(x1, x2 + 1):
            if draw[y][x] == "|" or draw[y][x]=="+":
                draw[y][x] = "+"
            else:
                draw[y][x] = char

m, n, q = map(int, input().split(" "))
operate = [list(input().split(" ")) for _ in range(q)]
draw = [["."] * m for _ in range(n)]
for op in operate:
    if op[0] == "1":
        flood_fill(op[1:])
    else:
        draw_line(op[1:])
for i in range(n):
    s = ""
    for j in range(m):
        s += draw[i][j]
    print(s)

```
