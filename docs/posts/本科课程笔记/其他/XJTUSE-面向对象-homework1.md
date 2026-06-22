---
title: "XJTUSE-面向对象-homework1"
date: 2024-06-26 :23
tags:
- 其他
category: 本科课程笔记
order: 26
---

# XJTUSE-面向对象-homework1

21级的作业了

大二上写的作业了，质量挺低的。

不过原老师每年作业也不一样，感觉没啥用。大家伙可以看看有没有一样的题目，或者思路hhhhh

(我当时写报告写的质量也是挺拉跨的，真是感慨啊)

## 题目1：UPC 码

题目：UPC码是美国统一代码委员会制定的一种商品用条码，主要用于美国和加拿大地区，我们在美国进口的商品上可以看到。UPC码(Universal Product Code)是最早大规模应用的条码，其特性是一种长度固定、连续性的条码，主要在美国和加拿大使用，由于其应用范围广泛，故又被称万用条码。

UPC码仅可用来表示数字，故其字码集为数字0~9。UPC码由12个数字构成，其中最右侧的数字是校验位，我们用d1表示，那么UPC码经过下面的公式计算之后必须是10的倍数比如，0-48500-00102的校验位就是8，因为经过上面的公式计算之后，只有数字8才可以得到10的倍数值50。

编写一个程序，通过命令行参数方式输入1个11位的数字，输出一个完整的12位的UPC码。

注意：

1.11位数字可以包含前导零；

2.11位数字的大小已经使得数字的表示范围超过了int类型能够表示的大小了。

3.如果不要求用户严格的输入11位的数字，那么就需要在真正执行计算之前对用户输入的数合法性进行考虑，请问你能列举出有多少种不合法的输入出现呢？如果程序的健壮性足够好，那就必须能处理这些意外的输入，请尝试做这件事。(此项要求并不是必须要完成)。

数据设计：

1.ErrorJudge类中的数据说明：

“private String name;”中name变量表示输入的字符串

2. QuestionOne类中的数据说明：

       “Scanner in = new Scanner(System.in);”中in为Scanner实例，用来读取数据

       “String str = in.nextLine();”中str为读取到的字符串；

       “ErrorJudge errorjudge = new ErrorJudge(str);”中errorjudge为ErrorJudge的实例，用来对输入的格式进行校验；

“long num1 = Long.parseLong(str);”中num1为将满足格式的字符串转化为long整形，为接下来的计算做准备；

       “int d = Integer.valueOf(0); ”中d用来取num1中的每一位数字，进行计算；

       “int flag = Integer.valueOf(2);”中flag判断num1的奇偶位数；

       “int verify = Integer.valueOf(-1);”中verify为校验码；

算法设计：

1.先用ErrorJudge类进行输入格式的校验，若校验不成功，返回上一步；成功则进行下一步；

2.进行计算校验码；

3.输出结果；

主干代码说明：

1.

![](https://i-blog.csdnimg.cn/blog_migrate/cf142d8227e9b33d829c0e8a8046168c.png)

判断输入格式是否正确

![](https://i-blog.csdnimg.cn/blog_migrate/0654a4928b329467879c89e9654e2c9e.png)

2.

计算校验码

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/2f19d1a3d79b1d9440b721e8c8681d33.png)

代码如下：

`//理论来讲不用引入这些类，不过为了说明我作业中使用了什么类
import java.util.Scanner;
import java.lang.System;
import java.lang.Integer;
import java.lang.String;

class ErrorJudge{
//    这个类是用来判断错误的
    private String name;
    public ErrorJudge(String name){
        this.name = name;
    }
    public void getStr(String name){
        this.name = name;
    }
//    长度格式判断
    private boolean lenError(String name){
        return (name.length() != 11)?false:true;
    }
//    输入数字判断
    private boolean typeError(String name){
        for (int i = 0;i<11;i++){
            if (!Character.isDigit(name.charAt(i))){
                return false;
            }
        }
        return true;
    }
//    输入格式判断
    public boolean judge(){
        if (!lenError(name)){
            System.out.print("长度异常，请重新输入：");
            return false;
        }
        if (!typeError(name)){
            System.out.print("输入的不是数字，请重新输入：");
            return false;
        }
        return true;
    }
//    类方法e
    public static boolean verifyJudge(int verify){
        return (verify<0)?false:true;
    }
}

public class QuestionOne {
    public static void main(String[] args) {
        System.out.printf("请输入11位数字：");
//        创建Scanner对象
        Scanner in = new Scanner(System.in);
//        读入一行
        String str = in.nextLine();
        ErrorJudge errorjudge = new ErrorJudge(str);
//        做输入校验，直至输入格式正确
        while (!errorjudge.judge()){
            str = in.nextLine();
            errorjudge.getStr(str);
        }
        long num1 = Long.parseLong(str);
        int d = Integer.valueOf(0);
        int flag = Integer.valueOf(2);
        while (num1 != 0){
            d += ((flag%2)==0?)*(num1%10);
            flag += 1;
            num1 = (long) Math.floor((double)num1/10);
        }
//        计算校验码
        int verify = Integer.valueOf(-1);
        for (int i=0;i<9;i++){
            if ((i+d)%10 == 0){
                verify = i;
                break;
            }
        }
//        理论上来讲输入格式正确，校验码一定能算出，不过为了保险起见加了一个判断
        if (ErrorJudge.verifyJudge(verify)){
            System.out.printf("12位UPC码：%s%d",str,verify);
        }
        else{
            System.out.printf("没有找到在0-9的验证码");
        }

    }
}
`

## 题目 2：数字转英语

题目：编写一个程序，从命令行参数中读取一个范围为[-999999999,999999999]的整数，输出为这个整数转换成英语表示的等价形式。下面列出程序中可能需要用到的所有数字表示的英文单词

negative,zero,one,two,three,four,five,six,seven,eight,nine,ten,eleven,twelve,thirteen,fourteen,fifteen,sixteen,seventeen,eighteen,nineteen,twenty,thirty,forty,fifty,sixty,seventy,eighty,ninety,hundred,thousand,million。

注意：在转换过程中，尽可能使用更大的数字单位。

比如1500这个数字应该的表示为one thousand five hundred，而不应该是fifteen hundred。举例：数字123419转换成的英语表示为：one hundred twenty three thousand four hundred nineteen

数据说明：

1.ErrorSolve类：

“public int sign = 0;”中sign判断+-号；

“private String num;”中num为输入的字符串；

2. Convert类：

       “private String num;”中num为输入的字符串；

       “private int len;”中len为字符串长度；

       “String[] dic_1，dic_2， dic_3”中dic_1，dic_2， dic_3为英语数字字典，方便后面转化使用。

       “int x = Integer.parseInt(num);”中x为字符串转化的整数；

       “String res”中res为转化完的结果字符串；

3. QuestionTwo类：

       “Scanner in = new Scanner(System.in);”中in用来读取数据；

       “ErrorSolve errorSolve = new ErrorSolve(str);”中errorSolve用来判断输入的格式；

     “Convert convert = new Convert(str.substring(0+ errorSolve.sign,str.length()));”转化对象；

算法说明：

1.第一步，使用ErrorSolve 判断输入的格式是否标准；

2.第二步，使用Convert 类转化成字符串；

3.第三步，在QuestionTwo类中进行+-号的细节操作。

主干代码说明：

![](https://i-blog.csdnimg.cn/blog_migrate/60b2fc0f5e3666aead876186f6993f79.png)

1.

这是处理三字符时候的代码，主要是分类讨论。以20，100和长度2为讨论要素开展。

![](https://i-blog.csdnimg.cn/blog_migrate/1287418e58c1c19a3b680c901e881fd9.png)

2.

录入数据的代码，judge判断格式，sign判断+-，若录入失败则初始化，成功跳出循环。

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/1d59162bf14bd28def7324f2132808d2.png)

![](https://i-blog.csdnimg.cn/blog_migrate/7af2aa7b37d6b274925421fc37461e5f.png)

代码如下：

`import java.util.Scanner;
class ErrorSolve{
//    输入格式检验类
//    sign检验‘-’号
    public int sign = 0;
    private String num;
    public ErrorSolve(String num){
        this.num = num;
    }
    public void getNum(String num){
        this.num = num;
    }
//    判断输入的数字是否在[-999999999, 999999999]
    private boolean scopeError(String num){
        if (num.length()>9+sign){
            return false;
        }
        else {
            return true;
        }
    }
//    判断输入的是否为数字
    private boolean typeError(String num){
        if (num.charAt(0)=='-'){
            sign = 1;
        }
        for (int i =0+sign;i<num.length();i++){
            if (!Character.isDigit(num.charAt(i))){
                return false;
            }
        }
        return true;
    }
    public boolean judge(){
        if (!typeError(num)){
            System.out.print("输入的不是整数,请重新输入:");
            return false;
        }
        if (!scopeError(num)){
            System.out.print("输入范围有误，重新输入：");
            return false;
        }
        return true;
    }

}
class Convert{
//    转化类
    private String num;
    private int len;
//    建立英语数字字典
    String[] dic_1 = {
            "", "one ", "two ", "three ", "four ", "five ", "six ", "seven ", "eight ", "nine ", "ten ","eleven ","twelve ", "thirteen ", "fourteen ", "fifteen ", "sixteen ", "seventeen ", "eighteen ", "nineteen ","twenty "
    };
    String[] dic_2 = {
            "","","twenty ","thirty ","forty ", "fifty ", "sixty ", "seventy ", "eighty ", "ninety "
    };
    String[] dic_3 = {
            "hundred ","thousand ", "million "
    };
    public Convert(String num){
        this.num = num;
        this.len = num.length();
    }
//    三个字符处理函数
    private String threeConvert(String num){
        String res = null;
        int len = num.length();
        int x = Integer.parseInt(num);
//        分类讨论，不断试错，真的难
        if (x<=20){
            res = dic_1[x];
        }
        if (x>20){
            int x1 = Character.getNumericValue(num.charAt(0));
            int x2 = Character.getNumericValue(num.charAt(1));
            if (x<100 && len==2){
                res = dic_2[x1] + dic_1[x2];
            }
            if (len == 3){
                int x3 = Character.getNumericValue(num.charAt(2));
                if (x<100){
                    res = dic_2[x2] + dic_1[x3];
                }
                else{
                    res = dic_1[x1] + dic_3[0] + dic_2[x2] + dic_1[x3];
                }
            }
        }
        return res;
    }
//    全部字符转换函数
    private String allConvert(){
        String res = null;
//        0是特殊情况
        if (Long.parseLong(num) == 0){
            res = "zero";
            return res;
        }
//        按照3字符分类
        if (len<=3){
            res = threeConvert(num);
        }
        if (len>3 && len<=6){
            res = threeConvert(num.substring(0,len-3))+ dic_3[1]+ threeConvert(num.substring(len-3,len));
        }
        if (len>6 && len<=9){
            res = threeConvert(num.substring(0,len-6))+ dic_3[2]+ threeConvert(num.substring(len-6,len-3))+ dic_3[1] + " "+threeConvert(num.substring(len-3,len));
        }
        return res;
    }
    public String putString(){
        return allConvert();
    }
}
public class QuestionTwo {
    public static void main(String[] args) {
        System.out.print("输入一个范围在为[-999999999, 999999999]的整数：");
        Scanner in = new Scanner(System.in);
        String str = in.nextLine();
        ErrorSolve errorSolve = new ErrorSolve(str);
        while (!errorSolve.judge()) {
            str = in.nextLine();
            errorSolve.sign = 0;
            errorSolve.getNum(str);
        }
        Convert convert = new Convert(str.substring(0+ errorSolve.sign,str.length()));
//        最后输出的时候考虑负数问题
        System.out.printf("数字转化为英文为：%s%s",(errorSolve.sign==1)?"negative ":"",convert.putString());
    }
}
`

## 题目 3：长度 n 的子序列最大乘积

题目：从文件中输入一个数字序列字符串，计算给定的长度n的子序列中的最大乘积值。例如：如果输入“1027839564”，指定长度为3的最大子序列乘积值为270(9*5*6)；指定长度为5的最大子序列乘积值为7560(7*8*3*9*5)。

备注：

1.数字序列字符串的最大长度maxLength的范围为：[1..1000]；

2.n的取值范围为[1..maxLength-1]；

3.程序要注意处理边界情况；

4.程序的输入数据必须从文件中读取。

下图为一个长度为1000的字符串数字序列，在这个序列中，长度为4的最大子序列乘积为5832(9*9*8*9)

数据设计：

1.QuestionThree类：

       “Scanner in = new Scanner(new File("src/in.txt"));”中in为文件读取；

       “String str = in.next();”中str为读取的字符串；

       “Scanner in2 = new Scanner(System.in); “中in2为键盘读取数据；

       “int n = in2.nextInt();”中n为读取的子字符串的长度；

       “int len = str.length(); “中len为str的长度；

       “int res = 0; “中res为子字符串的乘积最大值；

算法设计：

1.in读取文件中所有的字符串，拼接在一起；

2.从键盘读取字符串长度n；

3.计算最大乘积，然后输出；

主干代码：

![](https://i-blog.csdnimg.cn/blog_migrate/f500061c718da173b103c511b3cd848e.png)

1.

从0开始计算到len-n，遍历字符串，计算出最大的子字符串乘积。

运行结果(测试数据在附录三)：

测试数据：

`73167176531330624919225119674426574742355349194934
96983520312774506326239578318016984801869478851843
85861560789112949495459501737958331952853208805511
12540698747158523863050715693290963295227443043557
66896648950445244523161731856403098711121722383113
62229893423380308135336276614282806444486645238749
30358907296290491560440772390713810515859307960866
70172427121883998797908792274921901699720888093776
65727333001053367881220235421809751254540594752243
52584907711670556013604839586446706324415722155397
53697817977846174064955149290862569321978468622482
83972241375657056057490261407972968652414535100474
82166370484403199890008895243450658541227588666881
16427171479924442928230863465674813919123162824586
17866458359124566529476545682848912883142607690042
24219022671055626321111109370544217506941658960408
07198403850962455444362981230987879927244284909188
84580156166097919133875499200524063689912560717606
05886116467109405077541002256983155200055935729725
71636269561882670428252483600823257530420752963450
`

![](https://i-blog.csdnimg.cn/blog_migrate/2c5f281d8806ce85ffcb65dae1b1b8ca.png)

![](https://i-blog.csdnimg.cn/blog_migrate/efcb89c047276bc086e8160b1a4e6b1d.png)

代码如下：

`import java.io.File;
import java.io.FileNotFoundException;
import java.util.Scanner;

public class QuestionThree {
    public static void main(String[] args) throws FileNotFoundException {
        Scanner in = new Scanner(new File("src/in.txt"));
        String str = in.next();
        while (in.hasNext()){
            str = str + in.next();
        }
        System.out.print("请输入子序列的长度：");
//        输入n：子符串长度
        Scanner in2 = new Scanner(System.in);
        int n = in2.nextInt();
        int len = str.length();
        int res = 0;
        int[] arr = new int[len-n];
        for (int i=0;i<len-n;i++) {
            arr[i] = Character.getNumericValue(str.charAt(i));
            for (int j = 1; j < n; j++) {
                arr[i] *= Character.getNumericValue(str.charAt(i+j));
            }
            res = Math.max(arr[i],res);
        }
        System.out.printf("子序列中的最大乘积值为：%d",res);
    }
}
`

## 题目 4：模式化打印图形

题目：编写一个程序，通过命令行参数的方式，接收两个参数，参数1指定打印的图形模式(分别为下图中的a\b\c\d\e)，参数2指定打印的图形的大小(一个非负整数)。下面的模式图以大小8为例进行展示

![](https://i-blog.csdnimg.cn/blog_migrate/8f4e979d17259ff701ce7ece788e7729.png)

数据设计：

- PrintPic类：“private String mode; “中mode为打印类型；

“private int size; “中size为打印规模；

“private String[][] pattern; “为打印矩阵；

- QuestionFour类：“Scanner in = new Scanner(System.in); “键盘录入数据；

“String mode = in.next(); “为打印类型；

“int size = in.nextInt(); “为打印规模；

算法设计：

- 第一步，录入打印类型和打印规模；- 第二步，在PrintPic类中完成对打印矩阵的初始化，判断类型后对打印矩阵进行变化，最后输出。

主干代码：

![](https://i-blog.csdnimg.cn/blog_migrate/e3100e3fce7b0d841724777956db4024.png)

1.

初始化，判断类型后对打印矩阵进行相应操作；

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/b1d053973b31f0b99528755dd8a95a68.png)

代码如下：

`import java.util.Scanner;

class PrintPic{
    private String mode;
    private int size;
    private String[][] pattern;
    public PrintPic(String mode,int size){
        this.mode = mode;
        this.size = size-1;
        pattern = new String[size][size];
    }
//    初始化
    private void begin(){
        for (int i=0;i<size;i++){
            for (int j=0;j<size;j++){
                pattern[i][j] = " ";
            }
        }
    }
//    统一操作
    private void printAll(){
        for (int i=0;i<size;i++){
            pattern[0][i] = "#";
            pattern[size-1][i] = "#";
        }
    }
//    判断格式
    private void printA(){
        for (int i=0;i<size;i++){
            pattern[i][0] = "#";
            pattern[i][size-1] = "#";
        }
    }
    private void printB(){
        for (int i=0;i<size;i++){
            pattern[i][i] = "#";
        }
    }
    private void printC(){
        for (int i=0;i<size;i++){
            pattern[i][size-i-1] = "#";
        }
    }
    private void printD(){
        printB();
        printC();
    }
    private void printE(){
        printD();
        printA();
    }
//    统一变化
    private void modePrint(){
        begin();
        printAll();
        char s = mode.charAt(0);
        if (s == 'a'){
            printA();
        }
        if (s == 'b'){
            printB();
        }
        if (s == 'c'){
            printC();
        }
        if (s == 'd'){
            printD();
        }
        if (s == 'e'){
            printE();
        }
    }
//    输出
    public void printPattern(){
        modePrint();
        for (int i=0;i<size;i++){
            for (int j=0;j<size;j++){
                System.out.print(pattern[i][j]);
            }
            System.out.print("\n");
        }
    }
}

public class QuestionFour {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        System.out.print("输入第一个参数(a/b/c/d/e)：");
        String mode = in.next();
        System.out.print("输入第二个参数(int)：");
        int size = in.nextInt();
        PrintPic printPic = new PrintPic(mode,size);
        printPic.printPattern();
    }
}
`

## 题目5——直方统计图

编写一个程序，从文件中读入不定个数的数据，每个数据都已空格或者回车分割，每个数的

![](https://i-blog.csdnimg.cn/blog_migrate/73dff90d30f73f878c1acb84587bd739.png)

大小都在[0..100]之间，统计 10 个区间的数据的个数，并以两种方式将统计结果进行展示：水平直方图和垂直直方图。示例图如下：

(测试数据自行准备)

数据设计：

- Histogram类：“int[] count = new int[10]; “中count为统计每个范围内的出现次数；

“String[] name name2“中name name2 为输出字典；

- QuestionFive类：“Scanner in = new Scanner(new File("src/questionfive.txt")); “为文件读入数据；

“int x; “文件读入的单个数据；

算法设计：

- 录入文件，调取histogram.countAdd()方法循环至没有数字；- 在histogram中生成输出图形，输出两种类型的图形即可。

主干代码：

![](https://i-blog.csdnimg.cn/blog_migrate/024450f6d85aca63441dd472b07a886c.png)

1.

不断录入数据并且调用histogram.countAdd()方法，直到没有数据为止

![](https://i-blog.csdnimg.cn/blog_migrate/7c75063cf70958e3b9ea344779e51723.png)

2.

生成垂直直方图的函数。先判断最多出现次数。

第一个循环根据最多次数来执行，第二个循环判断是否达到，达到输出“*“，否则输出” “。

最后一个循环输出范围文字。

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/12dfe2c2de8962fa7b6ef7662b85b29e.png)

代码如下：

`import java.io.File;
import java.io.FileNotFoundException;
import java.util.Scanner;
class Histogram{
    int[] count = new int[10];
//    输出字典
    String[] name = {"0  -  9:","10 - 19:","20 - 29:","30 - 39:","40 - 49:","50 - 59:","60 - 69:","70 - 79:","80 - 89:","90 -100:"};
    String[] name2 = {"0-9 ","10-19 ","20-29 ","30-39 ","40-49 ","50-59 ","60-69 ","70-79 ","80-89 ","90-100 "};
//    添加函数
    public void countAdd(int x){
        if (x==100){
            count[9]+=1;
            return;
        }
        count[x/10] += 1;
    }
//    竖直输出函数
    public void horizontalHistogram(){
        for (int i=0;i<10;i++){
            System.out.print(name[i]);
            for (int j=0;j<count[i];j++){
                System.out.print("*");
            }
            System.out.print("\n");
        }
    }
//    水平输出函数
    public void veriticalHistogram(){
        int max = 0;
        for (int i=0;i<10;i++){
            max = Math.max(max,count[i]);
        }
        for (int i=max;i>0;i--){
            for (int j=0;j<10;j++){
                if (count[j]>=i){
                    System.out.print("*");
                }
                else {
                    System.out.print(" ");
                }
                System.out.print("     ");
            }
            System.out.print("\n");
        }
        for (int i=0;i<10;i++){
            System.out.print(name2[i]);
        }
    }
}

public class QuestionFive {
    public static void main(String[] args) throws FileNotFoundException {
        Scanner in = new Scanner(new File("src/questionfive.txt"));
        Histogram histogram = new Histogram();
        int x;
//        录入
        while (in.hasNext()){
            x = in.nextInt();
            histogram.countAdd(x);
        }
        histogram.horizontalHistogram();
        histogram.veriticalHistogram();
    }
}
`

## 题目6——蒙特·卡洛方法模拟

题目：蒙特·卡罗方法(Monte Carlo method)，也称统计模拟方法，是二十世纪四十年代中期由 于科学技术的发展和电子计算机的发明，而被提出的一种以概率统计理论为指导的一类非常重 要的数值计算方法。是指使用随机数(或更常见的伪随机数)来解决很多计算问题的方法。与 它对应的是确定性算法。蒙特·卡罗方法在金融工程学，宏观经济学，计算物理学(如粒子输 运计算、量子热力学计算、空气动力学计算)等领域应用广泛。编写一个程序来模拟蒙特卡罗 方法。具体的过程可以按照下面的方式来模拟：如下图所示(a)中的正方形，假设向正方形 所代表的区域投掷飞镖，如果投掷 100000 次，那么飞镖落在奇数数字所对应区域的概率是多 少呢？

![](https://i-blog.csdnimg.cn/blog_migrate/32c7c8f3e4eea44b8e9f5d0ed51591fa.png)

提示：可以将(a)图放到如(b)所展示的坐标系中，程序随机的在整个区域中生成点， 这样模拟投掷飞镖的行为

数据设计：

- QuestionSix类：“int num = 0; “总次数；

“int odd = 0; “到达奇数数字区域的次数；

“double x;  double y; “x为横坐标，y为纵坐标；

算法设计：

- 通过Math.random()随机数，模拟飞镖；- 判断(x,y)位置判断是否在奇数区域，统计次数；- 计算概率，输出结果

主干代码：

1.

![](https://i-blog.csdnimg.cn/blog_migrate/2d1acf49b64f9f8e43a77585b1162d72.png)

While循环使得投掷次数达到10000次。x,y通过随机数的线性四则运算得出，不失随机性。两个if语句判断是否命中奇数区域。

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/3210f6d1db81878ab864db1b64873989.png)

代码如下：

`public class QuestionSix {
    public static void main(String[] args) {
        int num = 0;
        int odd = 0;
        double x;
        double y;
        while (num<10000){
            x = Math.random()*2-1;
            y = Math.random()*2-1;
            if (x<0){
                odd += 1;
            }
            if (x>0&&y>0&&y+x-1<0){
                odd += 1;
            }
            num+=1;
        }
        System.out.printf("一共投掷10000次，落入奇数范围内的飞镖有%d,概率为%f",odd,(double)odd/(double)num);
    }
}
`
