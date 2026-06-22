---
title: "XJTUSE-数学建模-homework2"
date: 2024-06-19 :27
tags:
- 数学建模
category: 本科课程笔记
order: 52
---

# XJTUSE-数学建模-homework2

## 题目1

题目1：取   A= ![](https://latex.csdn.net/eq?%5Cbegin%7Bbmatrix%7D%201%20%262%20%5C%5C%200%20%26%205%20%5Cend%7Bbmatrix%7D)，用A加密meet，再求其逆矩阵，并对其解密。

1.1   加密：

步骤1：对字符串“meet”转换为(13 5 5 20)，两个元素为一组，并转化为向量B= ![](https://latex.csdn.net/eq?%5Cbegin%7Bbmatrix%7D%2013%20%26%205%5C%5C%205%20%26%2020%20%5Cend%7Bbmatrix%7D)

步骤2：用矩阵A左乘B，为了保障数字在0-25，对所求矩阵模上26，得到C= ![](https://latex.csdn.net/eq?%5Cbegin%7Bbmatrix%7D%2023%20%26%2019%5C%5C%2025%20%26%2022%20%5Cend%7Bbmatrix%7D)

步骤3：对步骤2所得矩阵转化为字符串，加密结果为：“wysv”。

1.2   解密：

步骤1：对A求逆矩阵，detA=5, ![](https://latex.csdn.net/eq?det%5E%7B-1%7D%28A%29%20%3D%2021)，A*= ![](https://latex.csdn.net/eq?%5Cbegin%7Bbmatrix%7D%205%20%26%20-2%5C%5C%200%20%26%201%20%5Cend%7Bbmatrix%7D)，得到![](https://i-blog.csdnimg.cn/blog_migrate/667bca303e5b34a42ec3bb6901d1d098.png)

步骤2：用所求的逆矩阵左乘加密矩阵，即![](https://i-blog.csdnimg.cn/blog_migrate/d5ab47349003ee3486f027ab3fbff40e.png)，解密结果就为原来的“meet”。

1.3    结果：

       加密结果为：“wysv”。

       解密结果为：“meet”。

       表明加密过程可逆，信息无损失。

下面是代码：

`import numpy as np

def str2num(s):
    return ord(s) - ord('a') + 1

def num2str(n):
    return chr(n + ord('a') - 1)

def inv(x):
    """
    :param x: 特征值
    :return: 特征值的逆
    """
    x = int(x + 0.5)  # 浮点数和整数的精度问题
    for i in range(1, 26):
        if (i * x) % 26 == 1:
            return i
    return 0

print("输入你需要加密的信息：")
# s = input().strip()
s = "meet"
if len(s) % 2 == 1:
    s += "a"  # 自动补全一下,方便后续操作，自己理解的时候，注意一下即可
A = np.array([[1, 2],
              [0, 5]], dtype=np.int32)
B = np.array([str2num(i) for i in s]).reshape(2, len(s) // 2)
C = A.dot(B) % 26  # 加密

output = [num2str(i) for i in np.nditer(C)]
print("加密后的数据为：", *output)

# 下面给一个简单的模26矩阵的变换操作求逆矩阵:
AI = (inv(np.linalg.det(A)) * (np.linalg.inv(A) * np.linalg.det(A))) % 26  # 得到逆矩阵
RA = AI.dot(C) % 26
origin = [num2str(int(i + 0.5)) for i in np.nditer(RA)]
print("解密后的数据为：", *origin)
`

## 题目2

题目2：有密文如下:goqbxcbuglosnfal;根据英文的行文习惯以及获取密码的途径和背景，猜测是两个字母为一组的希尔密码，前四个明文字母是dear，试破译这段秘文。

![](https://i-blog.csdnimg.cn/blog_migrate/1b7bdb32d772ca70a460c146768eb3ff.png)

2.2   结果

       通过局部信息可以对全局进行破译，得到的破译结果为：”dearmacgodforbid”。说明希尔算法在知道部分结果和加密矩阵的基本构造后能够轻易破译，安全程度有待提升！

`import numpy as np

def f(x):
    for i in range(1, 26):
        if (i * x) % 26 == 1:
            return i

A = np.array([[4, 1], [5, 18]])
B = np.array([[7, 17], [15, 2]])
B_I = (f(7 * 2 - 15 * 17) * np.array([[2, -17], [-15, 7]])) % 26
C = (A.dot(B_I)) % 26  # 获得破译矩阵

# 下面为破译所有信息操作：
s = "goqbxcbuglosnfal"
s = np.array([(ord(i) - ord('a') + 1) % 26 for i in s]).reshape(8, 2).T
S = (C.dot(s)) % 26

# 直接转化为列表操作,复原字符串
S_lst = S.T.reshape(1, 16).tolist()[0]
res = ""
for i in S_lst:
    res += chr(i + ord('a') - 1)
print(res)
`

## 题目3

题目3：假设某地人口总数保持不变，每年有A%的农村人口流入城镇，有B%的城镇人口流入农村，但人口的流动性始终保持在5%以下，并且农村人口流入城镇比例大于城镇流入农村人口，即(B<A<5)。试讨论至少四组不同的A、B值，得到该地的城镇人口与农村人口的分布的最终状态。

1. 建立第1年城镇人口以及农村人口之间的关系．

2. 利用所建模型，计算第i年人口的关系式．

3.  研究本问题中当时间无限长时农村人口以及城镇人口的极限状况．

4.  分析当A、B取不同取值对最终结果的影响．

3.1   问题分析：

这是有关人口迁徙的问题，是一个线性问题。

3.2   符号假设：

			U0

			初始农村人数

			Ui

			第i年农村人数

			C0

			初始城市人数

			Ci

			第i年城市人数

![](https://i-blog.csdnimg.cn/blog_migrate/8c6979a2f02b4807484572ddfb93eb41.png)

3.4   问题求解：

        问题1：由于A,B为给定值，只需要将i=1带入式子求出即可。

        问题2：根据模型可知，第i年的人口表达式为αi= βi*α0

        问题3：由线性代数可知，极限状态为矩阵βi不再变化。

        问题4：模拟不同的A,B值给出结果即可。

下面是几组不同A,B值，农村、城市人口变化的表格。

![](https://i-blog.csdnimg.cn/blog_migrate/f1dfb370ba84e570e4da09f8578ce9a0.png)

注：数据存在部分误差，这是由于小数转化为整数丢失导致的。

3.5  初步结论

       1.城市人口不断增加，农村人口不断减少，符合题目假设。

       2.A,B差值越大，极限情况的差值就越大，这与常识符合。

       3.模型对于初值的敏感度不高，只要A,B相同，最后的极限值基本相似，不过收敛到极限的速度有所差异。

代码：

暴力写法如下：

`import numpy
import numpy as np

a = np.matrix([700, 300]).T
print("请输入A：")
A = float(input())
print("请输入B：")
B = float(input())
b = np.matrix(numpy.array([[1 - A, B], [A, 1 - B]]))
while True:
    a = b * a
    print(a)
`

稍微写好一点如下：

由线性代数知识可以知道，对于本题目的二阶转移矩阵，稳定时候，n不会很大。

`import numpy
import numpy as np

a = np.array([700, 300]).T
print("请输入A：")
A = float(input())
print("请输入B：")
B = float(input())
b = np.array(numpy.array([[1 - A, B],
                          [A, 1 - B]]))
while True:
    t = b.dot(a)
    if ((t - a) <= 1e-5).all():
        break
    a = t
    print(a)
`
