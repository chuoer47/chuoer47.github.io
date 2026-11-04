---
title: "XJTUSE-编译原理实验-语法分析"
date: 2024-08-24 :36
tags:
- 编译原理
category: 本科课程笔记
order: 7
---

# XJTUSE-编译原理实验-语法分析

## 实验要求

	构造“某程序设计语言子集”的语法分析器。

	语法分析方法：自选(自上而下语法分析或自下而上语法分析)。

	语言成分：算术表达式、赋值语句、分支语句(if-then，if-then-else)、循环语句(while-do)。其中，分支语句、循环语句的条件式只需要布尔型变量或常量；分支语句、循环语句不必嵌套(例如，if 语句中不嵌套 if 语句)。

	输入方式：文本文件(如：。 txt) .

	输出内容及输出方式：如果输入串是句子，输出是“什么”句子；若有语法错误，指出错误位置及错误原因。可以直接在监视器上显示结果，也可以将结果输出到文件中。

	语法分析中，调用词法分析(第 1 次集中上机的任务所对应的程序)的结果，以获取每一个单词。

	测试程序样例：

			序号

			输入程序

			输出结果

			1

			j:=k+j*m;

			赋值语句

			2

			if x then j:=j+1;

			if-then 分支语句，嵌套赋值语句

			3

			if x then j:=j+1 else j:=j+2;

			if-then-else 分支语句，嵌套赋值语句

			4

			while x do j:=j+2;

			while-do 循环语句，嵌套赋值语句

			5

			j:=i*+1;

			语法错误，位置…

			6

			if x then;

			语法错误，位置…

提交结果：

实验报告(电子版，在思源空间提交)

包括：该程序设计语言文法的语法分析程序、关键算法的文字解释、与词法分析程序的衔接、测试样例(输入/输出)、实验总结。

## 前期工作

该 part 为语法分析前的必备工作阐述，包括第一次实验的词法分析改造，于词法分析程序的衔接

在第一个实验中，我们完成了一个词法分析器，我们简单阐述其作用：

当我们给定字符串时，会返回一个列表，列表的元素为 Token 对象，包括符号 ，识别符 ，识别码。

因此，为了后面的语法分析，即 LL(1)文法分析，我们需要把列表修改为栈。这样就可以保证获取到每一个列表对象，然后可以用来分析，下面是关键衔接代码

`def getNextToken(self):
    if self.index < len(self.tokens):
        token = self.tokens[self.index]
        self.index += 1
        return token
    else:
        return Token('', 'FILE-END', 0)

def getNowToken(self):
    if self.index < len(self.tokens):
        token = self.tokens[self.index]
        return token
    else:
        return Token('', 'FILE-END', 0)`

这就将列表改为了栈，需要注意一点：当遍历完数组时，我们需要返回一个`Token('', 'FILE-END', 0)`对象，来保证栈可以正常分析！

## LL(1)文法分析

### 原理

LL(1)文法是一种特殊的上下文无关文法，它满足以下两个条件：

	左递归(Left Recursive)的消除：该文法中不存在任何形如 A->Aα的产生式，即文法不存在左递归。

	预测性(Predictive)分析：对于文法中任何一个非终结符 A 和终结符 a，当 A 推导出 a 时，都能够在查看下一个输入符号 a 的情况下唯一确定应该使用哪一个产生式。

满足这两个条件的上下文无关文法就是 LL(1)文法。

LL(1)文法具有以下特点：

	可以通过预测性分析算法构造出相应的 LL(1)分析器。

	分析过程从左到右扫描输入串，同时从左到右推导。

	每一步仅需查看当前输入符号就可以确定下一步使用哪个产生式。

### 构造

LL(1)文法分析表是实现 LL(1)分析器的核心数据结构。它是一个二维表，行对应非终结符，列对应终结符。

构造 LL(1)分析表的步骤如下：

	计算每个非终结符的 first 集合和 follow 集合。

		first(A) 是从 A 出发能推导出的所有终结符的集合。

		follow(A) 是可能出现在 A 后面的所有终结符的集合。

	根据文法的产生式，填写分析表的内容：

		如果 A → a 是一个产生式，且 a 在 first(A) 中，则在 M[A， a] 中放置 A → a。

		如果 ε 在 first(A) 中，则对于所有 b 在 follow(A) 中， M[A， b] 中放置 A → ε。

		如果存在某个终结符 a，使得 A → a 和 B → a 都在文法中，则该文法不是 LL(1) 文法。

至此，我们学习完毕了 LL(1)文法的原理以及文法分析表的构造，下面我们将阐述本次实验的 LL(1)文法

### 算术表达式 LL(1)文法

通过编译原理的课程学习，我们可以得到如下 LL(1)文法进行算术表达式：

`E->TE'
E'->+TE'|-TE'|$$\varepsilon$$
T->FT'
T'->*FT'|/FT'|$$\varepsilon$$
F->(E)|d`

我们不难验证，该文法即为包含加减乘除和括号运算的算术表达式 LL(1)文法。

不难求得该文法的文法分析表：

CSDN公式显示有点小问题，不做优化了

			+

			*

			/

			d

			(

			)

			#

			E

			E->TE'

			E->TE'

			E'

			E'->+TE'

			E'->-TE'

			E'->$$\varepsilon$$

			E'->$$\varepsilon$$

			T

			T->FT'

			T->FT'

			T'

			T'->$$\varepsilon$$

			T'->$$\varepsilon$$

			T'->*FT'

			T'->/FT'

			T'->$$\varepsilon$$

			F

			F->d

			F->(E)

举个例子，当分析器处理到 `(d+d)` 这个输入串时，它的分析过程如下：

	首先处理 `(`，查找分析表中 F 行 `(` 列的产生式 `F->(E)`，于是将 `(E)` 压入栈。

	然后处理 `d`，查找分析表中 F 行 `d` 列的产生式 `F->d`，于是将 `d` 压入栈。

	接着处理 `+`，查找分析表中 E' 行 `+` 列的产生式 `E'->+TE'`，于是将 `+TE'` 压入栈。

	再处理 `d`，查找分析表中 F 行 `d` 列的产生式 `F->d`，于是将 `d` 压入栈。

	最后处理 `)`，查找分析表中 F 行 `)` 列的产生式 `F->)`，于是将 `)` 弹出栈。

### 代码实现

为了语法分析的方便，我创建了一个父类：

`class BaseParser:
    """
    基础语法分析器类
    """
    flag: bool
    token: Token
    end : int

    def __init__(self, tokenStream, end=-1):
        self.tokenStream = tokenStream
        self.end = end
        self.get_next_token()

    def get_next_token(self):
        """
        获取下一个token
        """
        if self.end > 0:
            if self.tokenStream.index == self.end:
                self.token = Token('', 'FILE-END', 0)
                return
        self.token = self.tokenStream.getNextToken()

    def handle_syntax_error(self):
        """
        处理语法错误
        """
        self.flag = False
        print(f"第{self.tokenStream.index-1}个词附近出现错误；")
        print(f"详细情况: 符号为{self.tokenStream.tokens[self.tokenStream.index-1].lexeme} "
              f"类型为{self.tokenStream.tokens[self.tokenStream.index-1].type}")
        self.get_next_token()

    def find(self, args):
        for i in range(self.tokenStream.index, len(self.tokenStream.tokens)):
            if self.tokenStream.tokens[i].code in args:
                return i
        return -1`

该类的好处减少了一些函数的重复编写，其作用会在后面的说明和步骤中逐步体现！

	处理错误的语法可以直接在控制台展示错误

	`get_next_token`通过类变量`end`和调用`tokenStream.getNextToken()`保证栈的次序！其中 end 变量用来标识需要识别的片段末尾，保证不会超出识别范围导致的错误！

下面给出算术表达式的分析：

`class CAL_S(BaseParser):
    """
    算术表达式语法类
    算术表达式的语法如下:
    E->TE'
    E'->+TE'|-TE'|e
    T->FT'
    T'->*FT'|/FT'|e
    F->(E)|d
    """

    def start(self):
        """
        开始分析表达式
        """
        self.flag = True
        self.__E()
        return self.flag

    def __E(self):
        """
        处理E->TE'
        """
        self.__T()
        self.__E1()

    def __E1(self):
        """
        处理E'->+TE'|-TE'|e
        """
        if self.token.code in (PLUS, MINUS):
            self.get_next_token()
            self.__T()
            self.__E1()
        elif self.token.code not in (RPAREN, 0):
            self.handle_syntax_error()

    def __T(self):
        """
        处理T->FT'
        """
        self.__F()
        self.__T1()

    def __T1(self):
        """
        处理T'->*FT'|/FT'|e
        """
        if self.token.code in (MULTIPLY, DIVIDE):
            self.get_next_token()
            self.__F()
            self.__T1()
        elif self.token.code not in (MINUS, PLUS, RPAREN, 0):
            self.handle_syntax_error()

    def __F(self):
        """
        处理F->(E)|d
        """
        if self.token.code in (IDENTIFIER, CONSTANT):
            self.get_next_token()
        elif self.token.code == LPAREN:
            self.get_next_token()
            self.__E()
            if self.token.code == RPAREN:
                self.get_next_token()
            else:
                self.handle_syntax_error()
        else:
            self.handle_syntax_error()`

本人代码结构清楚，变量规范，可以直接查看无需注释和代码段，无需再阐述过多！

### 代码实现结果

目前，我们还没有添加文件功能，可以先写一个简单的测试段，控制台输入输出查看代码结果：

`if __name__ == '__main__':
    while True:
        content = input()
        ts = TokenStream(content)
        print(ts)
        cal = CAL_S(ts)
        if cal.start():
            print("是算术表达式")
        else:
            print("不是算术表达式")`

下面是部分实验(更多可以见附录)

`样例1：
输入：y+x*7+o
输出：
(y        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(x        ,IDENTIFIER        ,1)
(*        ,MULTIPLY        ,16)
(7        ,CONSTANT        ,2)
(+        ,PLUS        ,14)
(o        ,IDENTIFIER        ,1)
是算术表达式

样例2：
输入：66+*9
输出：
(66        ,CONSTANT        ,2)
(+        ,PLUS        ,14)
(*        ,MULTIPLY        ,16)
(9        ,CONSTANT        ,2)

第2个词附近出现错误；
详细情况: 符号为* 类型为MULTIPLY
第3个词附近出现错误；
详细情况: 符号为9 类型为CONSTANT
不是算术表达式

样例3：
输入：(j+i)*k+((1+1)+2)
输出：
((        ,LPAREN        ,18)
(j        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(i        ,IDENTIFIER        ,1)
()        ,RPAREN        ,19)
(*        ,MULTIPLY        ,16)
(k        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
((        ,LPAREN        ,18)
((        ,LPAREN        ,18)
(1        ,CONSTANT        ,2)
(+        ,PLUS        ,14)
(1        ,CONSTANT        ,2)
()        ,RPAREN        ,19)
(+        ,PLUS        ,14)
(2        ,CONSTANT        ,2)
()        ,RPAREN        ,19)

是算术表达式`

可以看到，在输入样例的算术表达式判断中，该代码表现良好，可以识别出错误所在！

## 赋值语句

### 文法重构

前面，我们已经实现了算术表达式的文法，由于本次实验要求特殊，因此，我们可以不用再构造新的文法来表达赋值语句，而在原有的基础上进行改造即可！

在原有的文法上加上如下一句文法，即可标识赋值语句

S->d := E

E->TE'

.....

不再给出构造表了，感兴趣可以自行推导，在代码中已经蕴含了其构造思路！

### 代码实现

`class ASSIGN_S(BaseParser):
    """
    赋值语句表达类
    表达式如下形式
    IDENTIFIER ASSIGN 算术表达式
    """

    def start(self):
        self.flag = True
        # 先判断IDENTIFIER
        if self.token.code in (IDENTIFIER,):
            self.get_next_token()
        else:
            self.handle_syntax_error()
            return self.flag
        # 在判断ASSIGN
        if self.token.code in (ASSIGN,):
            cal = CAL_S(self.tokenStream, end=self.end)
            flag = cal.start()
            if flag:
                return flag
        else:
            self.handle_syntax_error()
            return self.flag
        return self.flag`

### 测试结果

可以和算术表达式的验证代码类似编写，不再给出，可见附录

`样例1：
输入：y:=x+10
输出：
(y        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(x        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(10        ,CONSTANT        ,2)

赋值语句

样例2：
输入：yy+1 := 9
输出：
(yy        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(1        ,CONSTANT        ,2)
(:=        ,ASSIGN        ,26)
(9        ,CONSTANT        ,2)

第1个词附近出现错误；
详细情况: 符号为+ 类型为PLUS
不是赋值语句`

至此，完成了赋值语句的编写！

## IF 语句

### 文法重构

前面，我们已经实现了赋值表达式的文法，由于本次实验要求特殊，因此，我们可以不用再构造新的文法来表达赋值语句，而在原有的基础上进行改造即可！

在原有的文法上加上如下语句，即可标识 IF 控制语句

S->IF_S|ASSIGN_S

IF_S->if E then ASSIGN_S IF_M

IF_M->; | else ASSIGN_S;

ASSIGN_S->d := E

E->TE'

.....

但是，需要注意的是，该方法不再满足 LL(1)文法，感兴趣可以自行推导，不过由于实验要求简单，本人采取了展望的策略，完成了类 LL(1)文法的实现，代码实现如下！

### 代码实现

`class IF_S(BaseParser):
    """
    IF语句表达类
    按照实验报告的要求IF语句满足以下条件：
    1.无嵌套
    2.if 算术表达式 then 赋值语句 ;
    3.if 算术表达式 then 赋值语句 else 赋值语句;

    关键技术：
    我们使用了向前展望的方式来判断该文法是否满足条件，以此来进行判断，这不是一个很好的方法，
    但对于该特殊条件而言，该方法是有效而且快速的
    """

    def start(self):
        self.flag = True
        # 判断if
        if self.token.code != IF:
            self.handle_syntax_error()
            return self.flag

        # 判断算术表达式
        # 1.先找到THEN
        then_pivot = self.find((THEN,))
        # 2.然后判断算术表达式
        cal = CAL_S(self.tokenStream, then_pivot)
        flag = cal.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断then
        if self.token.code != THEN:
            self.handle_syntax_error()
            return self.flag

        # 判断赋值语句
        # 1.先找到ELSE 或 ;
        pivot = self.find((ELSE, SEMICOLON))
        # 2.进行赋值表达式的判定
        assign = ASSIGN_S(self.tokenStream, pivot)
        flag = assign.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断是否有else语句
        if self.token.code == ELSE:
            # 判断赋值语句
            # 1.先找到 ;
            pivot = self.find((SEMICOLON,))
            assign = ASSIGN_S(self.tokenStream, pivot)
            flag = assign.start()
            if not flag:
                return False
            self.get_next_token()

        # 判断结束
        if self.token.code != SEMICOLON:
            self.handle_syntax_error()
            return self.flag
        return self.flag`

需要注意的是，虽然我们是在 LL(1)文法的基础上进行改进，但是，当遇到控制语句，LL(1)文法不再奏效，但是由于实验要求：其中，分支语句、循环语句的条件式只需要布尔型变量或常量；分支语句、循环语句不必嵌套(例如，if 语句中不嵌套 if 语句)。因此，我采用了展望的方式，具体而言如下：

	找到 if 语句中的 THEN 进行定位

	找到 if 语句中的 ELSE 或 ；进行定位

然后，根据定位结果可以提前判断对错，也可以进行构造。虽然时间复杂度上升了，但是由于实验要求简单，而且展望信息一般相邻较近，其速度和准确性依旧有保证！

### 测试结果

`样例1：
输入：if x then y:=99+2;
输出：
(if        ,IF        ,8)
(x        ,IDENTIFIER        ,1)
(then        ,THEN        ,9)
(y        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(99        ,CONSTANT        ,2)
(+        ,PLUS        ,14)
(2        ,CONSTANT        ,2)
(;        ,SEMICOLON        ,23)

IF语句

样例2：
输入：if y+88 then x:=9292 else y:=(x+1023)*9;
输出：
(if        ,IF        ,8)
(y        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(88        ,CONSTANT        ,2)
(then        ,THEN        ,9)
(x        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(9292        ,CONSTANT        ,2)
(else        ,ELSE        ,10)
(y        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
((        ,LPAREN        ,18)
(x        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(1023        ,CONSTANT        ,2)
()        ,RPAREN        ,19)
(*        ,MULTIPLY        ,16)
(9        ,CONSTANT        ,2)
(;        ,SEMICOLON        ,23)

IF语句

样例3：
输入：if x:=2 then y:=3
输入：
(if        ,IF        ,8)
(x        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(2        ,CONSTANT        ,2)
(then        ,THEN        ,9)
(y        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(3        ,CONSTANT        ,2)

第2个词附近出现错误；
详细情况: 符号为:= 类型为ASSIGN
第3个词附近出现错误；
详细情况: 符号为2 类型为CONSTANT
不是IF语句`

至此，完成了控制语句IF的编写

## 循环语句

### 文法重构

重构的文法如下：

在原有的文法上加上如下语句，即可标识 WHILE 控制语句

S->IF_S|ASSIGN_S|WHILE_S

WHILE_S->while E do ASSIGN_S;

.....

### 代码实现

`class WHILE_S(BaseParser):
    """
    WHILE语句表达类
    按照实验报告的要求IF语句满足以下条件：
    1.无嵌套
    2.while 算术表达式 DO 赋值语句 ;
    """

    def start(self):
        self.flag = True
        # 判断if
        if self.token.code != WHILE:
            self.handle_syntax_error()
            return self.flag

        # 判断算术表达式
        # 1.先找到DO
        then_pivot = self.find((DO,))
        # 2.然后判断算术表达式
        cal = CAL_S(self.tokenStream, then_pivot)
        flag = cal.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断赋值语句
        # 1.先找到 ;
        pivot = self.find((SEMICOLON,))
        # 2.进行赋值表达式的判定
        assign = ASSIGN_S(self.tokenStream, pivot)
        flag = assign.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断结束
        if self.token.code != SEMICOLON:
            self.handle_syntax_error()
            return self.flag
        return self.flag`

### 测试结果

`样例1：
输入：while x do j:=j+2;
输出:
(while        ,WHILE        ,12)
(x        ,IDENTIFIER        ,1)
(do        ,DO        ,11)
(j        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(j        ,IDENTIFIER        ,1)
(+        ,PLUS        ,14)
(2        ,CONSTANT        ,2)
(;        ,SEMICOLON        ,23)

WHILE语句

样例2：
输入：while 22 yy:=2
输出：
(while        ,WHILE        ,12)
(22        ,CONSTANT        ,2)
(yy        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(2        ,CONSTANT        ,2)

第2个词附近出现错误；
详细情况: 符号为yy 类型为IDENTIFIER
第3个词附近出现错误；
详细情况: 符号为:= 类型为ASSIGN
不是WHILE语句

样例3：
输入：while x0 do y:=8
输出：
(while        ,WHILE        ,12)
(x0        ,IDENTIFIER        ,1)
(do        ,DO        ,11)
(y        ,IDENTIFIER        ,1)
(:=        ,ASSIGN        ,26)
(8        ,CONSTANT        ,2)

第5个词附近出现错误；
详细情况: 符号为8 类型为CONSTANT
不是WHILE语句`

## 文件输入输出

下面实现文件输入输出

### 代码实现

在LAB1中我们已经实现了文件的输入输出，为了不再占用篇幅，可以在附录代码中查看！

测试代码如下：

`if __name__ == '__main__':
    fw = fileWriter("../fileSet/output/lab2.txt")
    cnt = 1
    with open('../fileSet/input/lab2.txt', 'r') as file:
        for content in file:
            ts = TokenStream(content)
            fw.write(f"第{cnt}行")
            fw.write(f"输入：{content.strip()}")
            fw.write(f"输出：")
            fw.write(str(ts).strip())
            parse = BEGIN(ts)
            fw.write(parse.start())
            fw.write("-----------------------------------------")
            cnt += 1`

### 展示结果

输入文档：

`j:=k+j*m
if x then j:=j+1;
if x then j:=j+1 else j:=j+2;
while x do j:=j+2;
j:=i*+1
if x then;`

输出文档：

`第1行
输入：j:=k+j*m
输出：
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(k  ,IDENTIFIER    ,1)
(+  ,PLUS  ,14)
(j  ,IDENTIFIER    ,1)
(*  ,MULTIPLY  ,16)
(m  ,IDENTIFIER    ,1)
赋值语句
-----------------------------------------
第2行
输入：if x then j:=j+1;
输出：
(if ,IF    ,8)
(x  ,IDENTIFIER    ,1)
(then   ,THEN  ,9)
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(j  ,IDENTIFIER    ,1)
(+  ,PLUS  ,14)
(1  ,CONSTANT  ,2)
(;  ,SEMICOLON ,23)
IF分支语句，嵌套赋值语句
-----------------------------------------
第3行
输入：if x then j:=j+1 else j:=j+2;
输出：
(if ,IF    ,8)
(x  ,IDENTIFIER    ,1)
(then   ,THEN  ,9)
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(j  ,IDENTIFIER    ,1)
(+  ,PLUS  ,14)
(1  ,CONSTANT  ,2)
(else   ,ELSE  ,10)
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(j  ,IDENTIFIER    ,1)
(+  ,PLUS  ,14)
(2  ,CONSTANT  ,2)
(;  ,SEMICOLON ,23)
IF分支语句，嵌套赋值语句
-----------------------------------------
第4行
输入：while x do j:=j+2;
输出：
(while  ,WHILE ,12)
(x  ,IDENTIFIER    ,1)
(do ,DO    ,11)
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(j  ,IDENTIFIER    ,1)
(+  ,PLUS  ,14)
(2  ,CONSTANT  ,2)
(;  ,SEMICOLON ,23)
WHILE-DO循环语句，嵌套赋值语句
-----------------------------------------
第5行
输入：j:=i*+1
输出：
(j  ,IDENTIFIER    ,1)
(:= ,ASSIGN    ,26)
(i  ,IDENTIFIER    ,1)
(*  ,MULTIPLY  ,16)
(+  ,PLUS  ,14)
(1  ,CONSTANT  ,2)
语法错误:第5个词附近出现错误；
详细情况: 符号为1类型为CONSTANT
-----------------------------------------
第6行
输入：if x then;
输出：
(if ,IF    ,8)
(x  ,IDENTIFIER    ,1)
(then   ,THEN  ,9)
(;  ,SEMICOLON ,23)
语法错误:第2个词附近出现错误；
详细情况: 符号为then类型为THEN
-----------------------------------------`

至此，全部任务完美完成！

## 实验总结

### 实验心得

首先,在学习LL(1)文法的相关知识时,我发现它具有诸多优点,如分析过程直观、分析效率高、错误诊断容易等。这使得它成为编译原理课程中广泛使用的一种文法形式。在实际编写语法分析程序的过程中,我也亲身体会到了这些优势。

在编写程序的过程中,最大的收获就是加深了对first集和follow集概念的理解。这两个集合的计算方法是构建预测分析表的关键,正确掌握它们对于实现递归下降分析算法至关重要。通过反复练习,我逐渐熟练掌握了计算first集和follow集的技巧,这也为后续的程序实现奠定了坚实的基础。

另外,在处理文法的左递归和空产生式问题时,我也学到了很多宝贵的经验。左递归会导致递归下降分析器陷入无限循环,因此需要特殊处理。而空产生式则可能会导致分析过程出现歧义,需要仔细分析文法的结构。通过解决这些问题,我不仅提高了编程能力,也加深了对编译原理知识的理解。

总的来说,这个实验是一次非常宝贵的实践机会。通过亲自动手编写LL(1)语法分析程序,我不仅掌握了相关的理论知识,也积累了丰富的实践经验。

### 实验改进

在完成了使用LL(1)文法进行基本语法分析程序编写的实验之后,我对未来的改进展望有以下几点思考:

	扩展文法类型和分析方法的探索

		目前的实验主要集中在LL(1)文法上,未来可以尝试使用其他类型的文法,如LR(1)文法,并编写相应的语法分析程序。这可以加深对不同文法及其分析方法的理解。

	语义分析和中间代码生成的实现

		语法分析只是编译过程的一部分,未来可以在此基础上,实现语义分析和中间代码生成的功能。这将使编译器的功能更加完整。

	错误处理和报告的改进

		当前的错误处理和报告功能较为简单,未来可以进一步完善,提供更加友好和详细的错误信息,帮助使用者快速定位和解决问题。

	性能优化和可扩展性的提升

		对于大型程序的编译,性能优化也是一个重要的考量因素。未来可以研究一些性能优化的技术,如使用更高效的数据结构和算法。

		同时还可以增强程序的可扩展性,使其能够处理更复杂的语言特性和语法结构。

## 附录

### 赋值语句测试代码

`if __name__ == '__main__':
    content = input()
    ts = TokenStream(content)
    print(ts)
    ass = ASSIGN_S(ts)
    if ass.start():
        print("赋值语句")
    else:
        print("不是赋值语句")`

### 控制IF语句测试代码

`if __name__ == '__main__':
    content = input()
    ts = TokenStream(content)
    print(ts)
    ifs = IF_S(ts)
    if ifs.start():
        print("IF语句")
    else:
        print("不是IF语句")`

### 控制语句WHILE测试代码

`if __name__ == '__main__':
    content = input()
    ts = TokenStream(content)
    print(ts)
    ws = WHILE_S(ts)
    if ws.start():
        print("WHILE语句")
    else:
        print("不是WHILE语句")`

### 文件输入输出代码

`class fileWriter:
    """封装文件输出类"""

    def __init__(self, filename):
        self.filename = filename
        # 初始化+清空+创建文件
        self.fw = open(self.filename, 'w', encoding="utf-8")
        self.fw.write(str(datetime.now()) + '\n')
        self.fw.close()

    def write(self, msg):
        # 追加模式
        self.fw = open(self.filename, 'a', encoding='utf-8')
        self.fw.write(msg + "\n")
        self.fw.close()`

### 错误查找模块

`def getErrorInfo(tokenStream:TokenStream):
    err = (f"第{tokenStream.index - 1}个词附近出现错误；" + "\n"
           + f"详细情况: 符号为{tokenStream.tokens[tokenStream.index - 1].lexeme}"
           + f"类型为{tokenStream.tokens[tokenStream.index - 1].type}")
    return err`

### 完整代码

`from config import *
from lab1.lab1 import TokenStream, Token, fileWriter

class BaseParser:
    """
    基础语法分析器类
    """
    flag: bool
    token: Token
    end: int

    def __init__(self, tokenStream, end=-1):
        self.tokenStream = tokenStream
        self.end = end
        self.get_next_token()
        self.err = ""

    def get_next_token(self):
        """
        获取下一个token
        """
        if self.end > 0:
            if self.tokenStream.index == self.end:
                self.token = Token('', 'FILE-END', 0)
                return
        self.token = self.tokenStream.getNextToken()

    def handle_syntax_error(self):
        """
        处理语法错误
        """
        self.flag = False
        print(f"第{self.tokenStream.index - 1}个词附近出现错误；")
        print(f"详细情况: 符号为{self.tokenStream.tokens[self.tokenStream.index - 1].lexeme} "
              f"类型为{self.tokenStream.tokens[self.tokenStream.index - 1].type}")
        self.get_next_token()

    def find(self, args):
        for i in range(self.tokenStream.index, len(self.tokenStream.tokens)):
            if self.tokenStream.tokens[i].code in args:
                return i
        return -1

class CAL_S(BaseParser):
    """
    算术表达式语法类
    算术表达式的语法如下:
    E->TE'
    E'->+TE'|-TE'|e
    T->FT'
    T'->*FT'|/FT'|e
    F->(E)|d
    """

    def start(self):
        """
        开始分析表达式
        """
        self.flag = True
        self.__E()
        return self.flag

    def __E(self):
        """
        处理E->TE'
        """
        self.__T()
        self.__E1()

    def __E1(self):
        """
        处理E'->+TE'|-TE'|e
        """
        if self.token.code in (PLUS, MINUS):
            self.get_next_token()
            self.__T()
            self.__E1()
        elif self.token.code not in (RPAREN, 0):
            self.handle_syntax_error()

    def __T(self):
        """
        处理T->FT'
        """
        self.__F()
        self.__T1()

    def __T1(self):
        """
        处理T'->*FT'|/FT'|e
        """
        if self.token.code in (MULTIPLY, DIVIDE):
            self.get_next_token()
            self.__F()
            self.__T1()
        elif self.token.code not in (MINUS, PLUS, RPAREN, 0):
            self.handle_syntax_error()

    def __F(self):
        """
        处理F->(E)|d
        """
        if self.token.code in (IDENTIFIER, CONSTANT):
            self.get_next_token()
        elif self.token.code == LPAREN:
            self.get_next_token()
            self.__E()
            if self.token.code == RPAREN:
                self.get_next_token()
            else:
                self.handle_syntax_error()
        else:
            self.handle_syntax_error()

class ASSIGN_S(BaseParser):
    """
    赋值语句表达类
    表达式如下形式
    IDENTIFIER ASSIGN 算术表达式
    """

    def start(self):
        self.flag = True

        # Check IDENTIFIER
        if self.token.code == IDENTIFIER:
            self.get_next_token()
        else:
            self.handle_syntax_error()
            return self.flag

        # Check ASSIGN
        if self.token.code == ASSIGN:
            cal = CAL_S(self.tokenStream, end=self.end)
            if not cal.start():
                self.handle_syntax_error()
                return self.flag
        else:
            self.handle_syntax_error()
            return self.flag

        return self.flag

class IF_S(BaseParser):
    """
    IF语句表达类
    按照实验报告的要求IF语句满足以下条件：
    1.无嵌套
    2.if 算术表达式 then 赋值语句 ;
    3.if 算术表达式 then 赋值语句 else 赋值语句;

    关键技术：
    我们使用了向前展望的方式来判断该文法是否满足条件，以此来进行判断，这不是一个很好的方法，
    但对于该特殊条件而言，该方法是有效而且快速的
    """

    def start(self):
        self.flag = True
        # 判断if
        if self.token.code != IF:
            self.handle_syntax_error()
            return self.flag

        # 判断算术表达式
        # 1.先找到THEN
        then_pivot = self.find((THEN,))
        # 2.然后判断算术表达式
        cal = CAL_S(self.tokenStream, then_pivot)
        flag = cal.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断then
        if self.token.code != THEN:
            self.handle_syntax_error()
            return self.flag

        # 判断赋值语句
        # 1.先找到ELSE 或 ;
        pivot = self.find((ELSE, SEMICOLON))
        # 2.进行赋值表达式的判定
        assign = ASSIGN_S(self.tokenStream, pivot)
        flag = assign.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断是否有else语句
        if self.token.code == ELSE:
            # 判断赋值语句
            # 1.先找到 ;
            pivot = self.find((SEMICOLON,))
            assign = ASSIGN_S(self.tokenStream, pivot)
            flag = assign.start()
            if not flag:
                return False
            self.get_next_token()

        # 判断结束
        if self.token.code != SEMICOLON:
            self.handle_syntax_error()
            return self.flag
        return self.flag

class WHILE_S(BaseParser):
    """
    WHILE语句表达类
    按照实验报告的要求IF语句满足以下条件：
    1.无嵌套
    2.while 算术表达式 DO 赋值语句 ;
    """

    def start(self):
        self.flag = True
        # 判断if
        if self.token.code != WHILE:
            self.handle_syntax_error()
            return self.flag

        # 判断算术表达式
        # 1.先找到DO
        then_pivot = self.find((DO,))
        # 2.然后判断算术表达式
        cal = CAL_S(self.tokenStream, then_pivot)
        flag = cal.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断赋值语句
        # 1.先找到 ;
        pivot = self.find((SEMICOLON,))
        # 2.进行赋值表达式的判定
        assign = ASSIGN_S(self.tokenStream, pivot)
        flag = assign.start()
        if not flag:
            return False
        self.get_next_token()

        # 判断结束
        if self.token.code != SEMICOLON:
            self.handle_syntax_error()
            return self.flag
        return self.flag

class BEGIN:
    def __init__(self, tokenStream: TokenStream):
        self.ts = tokenStream

    def start(self):
        token = self.ts.getNowToken()

        if token.code == IF:
            ifs = IF_S(self.ts)
            return "IF分支语句，嵌套赋值语句" if ifs.start() else "语法错误:" + getErrorInfo(self.ts)

        if token.code == WHILE:
            ws = WHILE_S(self.ts)
            return "WHILE-DO循环语句，嵌套赋值语句" if ws.start() else "语法错误:" + getErrorInfo(self.ts)

        ass = ASSIGN_S(self.ts)
        return "赋值语句" if ass.start() else "语法错误:" + getErrorInfo(self.ts)

def getErrorInfo(tokenStream:TokenStream):
    err = (f"第{tokenStream.index - 1}个词附近出现错误；" + "\n"
           + f"详细情况: 符号为{tokenStream.tokens[tokenStream.index - 1].lexeme}"
           + f"类型为{tokenStream.tokens[tokenStream.index - 1].type}")
    return err

if __name__ == '__main__':
    fw = fileWriter("../fileSet/output/lab2.txt")
    cnt = 1
    with open('../fileSet/input/lab2.txt', 'r') as file:
        for content in file:
            ts = TokenStream(content)
            fw.write(f"第{cnt}行")
            fw.write(f"输入：{content.strip()}")
            fw.write(f"输出：")
            fw.write(str(ts).strip())
            parse = BEGIN(ts)
            fw.write(parse.start())
            fw.write("-----------------------------------------")
            cnt += 1
    print("完成！")
`
