---
title: "XJTUSE-编译原理-第七章-HOMEWORK"
date: 2024-06-20 :07
tags:
- 编译原理
category: 本科课程笔记
order: 97
---

# XJTUSE-编译原理-第七章-HOMEWORK

## 第一题

![](https://i-blog.csdnimg.cn/blog_migrate/2dfc2f1670f40388651284c99ea24c99.png)

### 第一问

由公式可知：

![](https://i-blog.csdnimg.cn/blog_migrate/b4f0d74c25b6fa11ad19c28ee17c0eef.png)

![](https://i-blog.csdnimg.cn/blog_migrate/59d1feb4b9c04acf40e0b116d0c62624.png)

其中![](https://i-blog.csdnimg.cn/blog_migrate/0c5525fbd6c86f3dd142d289b52dadec.png)表示为 i 的下界，![](https://i-blog.csdnimg.cn/blog_migrate/fa6a073144b3abd33db8c101e415d8d7.png)表示为 i 的可取值个数，w 表示数组元素宽度

得：

![](https://i-blog.csdnimg.cn/blog_migrate/5282e30f70c822a6fda89ec9e6624155.png)

![](https://i-blog.csdnimg.cn/blog_migrate/994f65630c9ee467d374e78ae021bea6.png)

### 第二问

下面是四元式序列：

100(*,j,20,T1)

101(+,T1,m,T1)

102(*,T1,22,T1)

103(+,T1,n,T1)

104(-,b,463,T2)

105(=[],T2[T1],-,T3)

106(*,i,96,T4)

107(+,T4,T3,T4)

108(-,a,97,T5)

109(*,u,v,)

110([]=,T6,-,T5[T4])

## 第二题

![](https://i-blog.csdnimg.cn/blog_migrate/cd82d590d1f36379bc31cabfe7f4f39c.png)

### 第一问

由公式可知：

![](https://i-blog.csdnimg.cn/blog_migrate/18c4e6841ac7639ac9b1252e856cdc9f.png)

![](https://i-blog.csdnimg.cn/blog_migrate/bc26d117b83d8501066a70ee3d9d9f63.png)

其中![](https://i-blog.csdnimg.cn/blog_migrate/33ed4ef71bd9353a0a705f7b385cf8cb.png)表示为 i 的下界，![](https://i-blog.csdnimg.cn/blog_migrate/205970779fe0c44342354621bc747cbd.png)表示为 i 的可取值个数，w 表示数组元素宽度

得：

![](https://i-blog.csdnimg.cn/blog_migrate/d4fb80f935b89dfa23da2271500b6b5c.png)

![](https://i-blog.csdnimg.cn/blog_migrate/e67bbe1ee9c15e9b9010f42fc74e8bbe.png)

### 第二问

下面是四元式序列：

100(*,i,22,T1)

101(+,T1,j,T1)

102(-,b,23,T2)

103(=[],T2[T1],-,T3)

104(+,m,n,T4)

105(*,T3,18,T5)

106(+,T5,T4,T5)

107(*,T5,96,T5)

108(+,T5,u,T5)

109(-,a,1825,T6)

110([]=,v,-,T6[T5])

## 第三题

![](https://i-blog.csdnimg.cn/blog_migrate/ac19874bfef0a614d61b66b408e258f2.png)

### 第一问

100(j≠,C,D,0->102)

101(j,-,-,0)

102(j=,E,F,0->104)

103(j,-,-,0->101)

104(j106)

105(j,-,-,0->100)

106(j>,I,J,0->108)

107(j,-,-,0->104)

108(E1 and M2 E2

有如下的 backpatch 和 merge 函数：

backpatch(E1.truelist,M2.quad)=backpatch(100,102)

E3.falselist:=merge(E1.falselist,E2.falselist):=merge(101,103)=103

S3

S3 -> while M4 E4 do M5 S2

有如下的 backpatch 函数：

backpatch(S2,nextlist,M4.quad)=backpatch(107,104)

backpatch(E4.truelist,M5.quad)=backpatch(104,106)

S2

S2 -> if E5 then M6 S1

有如下的 backpatch 和 merge 函数：

backpatch(E5.truelist,M6.quad)=backpatch(106,108)

S2.nextlist := merge(E5.falselist,S1.nextlist):=merge(107,0)=107

S4

S4 -> while M1 E3 do M3 S3

有如下的 backpatch 函数：

backpatch(S3.nextlist,M1.quad)=backpatch(105,100)

backpatch(E3.truelist,M3.quad)=backpatch(102,104)

### 第三问

不存在 S5，下面给出 S4.nextlist 所指的待回填的链构成：

![](https://i-blog.csdnimg.cn/blog_migrate/0f40b7763c33f51f644c0628cd348ccf.jpeg)

## 第四题

![](https://i-blog.csdnimg.cn/blog_migrate/9786a0f213c684a84513fecc468a2dc6.png)

### 第一问

100(j≠,C,D,0->104)

101(j,-,-,0->102)

102(j=,E,F,0->100->104)

103(j,-,-,0->110)

104(j106)

105(j,-,-0)

106(*,I,J,T1)

107(:=,T1,-,K)

108(j,-,-,104)

109(j,-,-,0->105)

110( E1 or M1 E2

有如下的 backpatch 和 merge 函数：

backpatch(E1.falselist,M1.quad)=backpatch(101,102)

E3.truelist:=merge(E1.truelist,E2.truelist):=merge(100,102)=102

S4

S4 -> if E3 then M2 S2 N else M5 S3

有如下的 backpatch 和 merge 函数：

backpatch(E3.truelist,M2.quad)=backpatch(102,104)

backpatch(E3.falselist,M5.quad)=backpatch(103,110)

S4.nextlist := merge(S2.nextlist,N.nextlist,S3.nextlist):=merge(105,109,0)=109

S2

S2 -> while M3 E4 do M4 S1

有如下的 backpatch 和 merge 函数：

backpatch(S1.nextlist,M3.quad)=backpatch(108,104)

backpatch(E4.truelist,M4.quad)=backpatch(104,106)

### 第三问

不存在 S5，下面给出 S4.nextlist 所指的待回填的链构成：

![](https://i-blog.csdnimg.cn/blog_migrate/588bc17ff74f1a1ea497d58ad2715d30.png)
