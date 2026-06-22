---
title: "BFS-算法练习日常练习"
date: 2024-04-16 :51
tags:
- 算法
category: 算法
order: 9
---

# BFS-算法练习日常练习

## 1355. 母亲的牛奶
[1355. 母亲的牛奶 - AcWing题库](https://www.acwing.com/problem/content/1357/)

```
"""
https://www.acwing.com/problem/content/description/1357/
"""

def bfs(lst):
    a, b, c = lst
    if lst in use:
        return
    use.add((a, b, c))
    ra = A - a
    rb = B - b
    rc = C - c
    if a != 0:
        state.append((a - min(a, rb), b + min(a, rb), c))
        state.append((a - min(a, rc), b, c + min(a, rc)))
    if b != 0:
        state.append((a + min(b, ra), b - min(b, ra), c))
        state.append((a, b - min(b, rc), c + min(b, rc)))
    if c != 0:
        state.append((a + min(c, ra), b, c - min(c, ra)))
        state.append((a, b + min(c, rb), c - min(c, rb)))

A, B, C = map(int, input().split(" "))
use = set()
state = [(0, 0, C)]
while state:
    lst = state.pop()
    # print(lst)
    bfs(lst)
# print(use)
res = []
for a, b, c in use:
    if a == 0:
        res.append(c)
res.sort()
res = set(res)
print(*res)

```
## 1233. 全球变暖
[1233. 全球变暖 - AcWing题库](https://www.acwing.com/problem/content/1235/)

```
"""
https://www.acwing.com/problem/content/1235/
"""
options = [(1, 0), (-1, 0), (0, 1), (0, -1)]

def bfs():
    global flag
    while st:
        x, y = st.pop()  # 获取坐标
        ff = False  # 表示是否被淹没
        for option in options:
            l, r = option
            xx, yy = x + l, y + r  # 新的坐标
            if (xx,yy) in verify:  # 存在岛屿
                if (xx, yy) in island_set:
                    island_set.remove((xx, yy))
                    st.append((xx, yy))
            else:
                ff = True  # 被淹没了
        if not ff:
            flag = True  # 存在该岛屿

n = int(input())
island_set = set()  # 使用set来存储岛屿坐标
verify = set()
for i in range(n):
    t = list(input())
    for j in range(n):
        if t[j] == "#":
            verify.add((i,j))
            island_set.add((i, j))  # 将岛屿坐标添加到set中
res = 0

while island_set:  # 使用set的布尔值来判断是否为空
    # print(island_set)
    flag = False
    st = [island_set.pop()]  # 从set中弹出一个元素
    bfs()
    if not flag:  # 完全被淹没
        res += 1
print(res)
```
## 179. 八数码
[179. 八数码 - AcWing题库](https://www.acwing.com/problem/content/181/)

```
"""
https://www.acwing.com/problem/content/181/
"""
import queue

OK = "#12345678x"

def lst2str(lst):
    res = ""
    for i in lst:
        res += i
    return "#" + res

def chess2str(chess):
    lst = chess[1][] + chess[2][] + chess[3][]
    return lst2str(lst)

def check(s):
    return s == OK

name = ["l", "r", "u", "d"]
options = [(0, -1), (0, 1), (-1, 0), (1, 0)]
s = input().split(" ")
# 下面判断是否无解：
solve = s.copy()
solve.remove("x")
# 计算逆序对
ni = 0
for i in range(8):
    for j in range(i + 1, 8):
        if solve[i] > solve[j]:
            ni += 1
# 逆序对为奇数则无解
if ni % 2 == 1:
    print("unsolvable")
    exit(0)  # TODO：这里简单写了，提交到算法网站要改一下，不然会报错
s = lst2str(s)
state = set()  # 记录状态
state.add(s)
stack = queue.Queue()  # 使用队列
stack.put((s, ""))
res = ""
# BFS
while stack:
    # print(stack)
    s, op = stack.get()
    if check(s):
        res = op
        break
    chess = [[0] * 5 for _ in range(5)]
    # 棋盘初始化
    chess[1][] = s[]
    chess[2][] = s[]
    chess[3][] = s[7:]
    for i in range(1, 4):
        for j in range(1, 4):
            if chess[i][j] == "x":
                x, y = i, j
    for pivot, option in enumerate(options):
        l, r = option
        xx, yy = x + l, y + r
        if chess[xx][yy] == 0:  # 没法交换
            continue
        else:  # 交换
            chess[x][y], chess[xx][yy] = chess[xx][yy], chess[x][y]
            ss = chess2str(chess)
            if ss not in state:  # 检查是否存在该状态
                state.add(ss)
                stack.put((ss, op + name[pivot]))
            chess[x][y], chess[xx][yy] = chess[xx][yy], chess[x][y]
print(res)

```
