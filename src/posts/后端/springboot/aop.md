---
title: AOP
date: 2024-05-24 16:24:22
tags: Spring
category: Spring
description: spring
order: 2
icon: "/img/spring.svg"
---

<!--more--->

# Spring AOP详解

## 一、什么是AOP

:::info 什么是AOP？

- Aspect Oriented Programming（面向切面编程、面向方面编程）
- 面向切面编程就是面向特定方法编程

:::

&emsp;就需要先理解什么是切面。用刀把一个西瓜分成两瓣，切开的切口就是切面；炒菜，锅与炉子共同来完成炒菜，锅与炉子就是切面。web层级设计中，web层->网关层->服务层->数据层，每一层之间也是一个切面。编程中，对象与对象之间，方法与方法之间，模块与模块之间都是一个个切面。


## 二、AOP相关概念

看过了上面的例子，我想大家脑中对AOP已经有了一个大致的雏形，但是又对上面提到的切面之类的术语有一些模糊的地方，接下来就来讲解一下AOP中的相关概念，了解了AOP中的概念，才能真正的掌握AOP的精髓。

这里还是先给出一个比较专业的概念定义：

- `Aspect`（切面）： `Aspect` 声明类似于 Java 中的类声明，在 '`Aspect`' 中会包含着一些 `Pointcut` 以及相应的 `Advice`。
- `Joint point`（连接点）：表示在程序中明确定义的点，典型的包括方法调用，对类成员的访问以及异常处理程序块的执行等等，它自身还可以嵌套其它 `joint point`。
- `Pointcut`（切点）：表示一组 `joint point`，这些 `joint point` 或是通过逻辑关系组合起来，或是通过通配、正则表达式等方式集中起来，它定义了相应的 Advice 将要发生的地方。
- `Advice`（通知）：`Advice` 定义了在 Pointcut 里面定义的程序点具体要做的操作，它通过 `before`、`after` 和 `around` 来区别是在每个 `joint point` 之前、之后还是代替执行的代码。
- `Target`（目标对象）：织入 `Advice` 的目标对象.。
- `Weaving`（织入）：将 `Aspect` 和其他对象连接起来, 并创建 `Adviced object` 的过程

下面我以一个简单的例子来比喻一下 AOP 中 `Aspect`, `Joint point`, `Pointcut` 与 `Advice`之间的关系.
&emsp;让我们来假设一下, 从前有一个叫爪哇的小县城, 在一个月黑风高的晚上, 这个县城中发生了命案. 作案的凶手十分狡猾, 现场没有留下什么有价值的线索. 不过万幸的是, 刚从隔壁回来的老王恰好在这时候无意中发现了凶手行凶的过程, 但是由于天色已晚, 加上凶手蒙着面, 老王并没有看清凶手的面目, 只知道凶手是个男性, 身高约七尺五寸. 爪哇县的县令根据老王的描述, 对守门的士兵下命令说: 凡是发现有身高七尺五寸的男性, 都要抓过来审问. 士兵当然不敢违背县令的命令, 只好把进出城的所有符合条件的人都抓了起来.

来让我们看一下上面的一个小故事和 AOP 到底有什么对应关系.
&emsp;首先我们知道, 在 Spring AOP 中 `Joint point` 指代的是所有方法的执行点, 而 `point cut` 是一个描述信息, 它修饰的是 `Joint point`, 通过 `point cut`, 我们就可以确定哪些 `Joint point` 可以被织入 `Advice`. 对应到我们在上面举的例子, 我们可以做一个简单的类比, `Joint point` 就相当于 爪哇的小县城里的百姓,`pointcut` 就相当于 老王所做的指控, 即凶手是个男性, 身高约七尺五寸, 而 Advice 则是施加在符合老王所描述的嫌疑人的动作: 抓过来审问.
为什么可以这样类比呢?

- `Joint point` ： 爪哇的小县城里的百姓: 因为根据定义, `Joint point` 是所有可能被织入 `Advice` 的候选的点, 在 Spring AOP中, 则可以认为所有方法执行点都是 `Joint point`. 而在我们上面的例子中, 命案发生在小县城中, 按理说在此县城中的所有人都有可能是嫌疑人.

- `Pointcut` ：男性, 身高约七尺五寸: 我们知道, 所有的方法(joint point) 都可以织入 `Advice`, 但是我们并不希望在所有方法上都织入 `Advice`, 而 `Pointcut` 的作用就是提供一组规则来匹配`joinpoint`, 给满足规则的 `joinpoint` 添加 Advice. 同理, 对于县令来说, 他再昏庸, 也知道不能把县城中的所有百姓都抓起来审问, 而是根据凶手是个男性, 身高约七尺五寸, 把符合条件的人抓起来. 在这里 凶手是个男性, 身高约七尺五寸 就是一个修饰谓语, 它限定了凶手的范围, 满足此修饰规则的百姓都是嫌疑人, 都需要抓起来审问.

- `Advice` ：抓过来审问, `Advice` 是一个动作, 即一段 Java 代码, 这段 Java 代码是作用于 `point cut` 所限定的那些 `Joint point` 上的. 同理, 对比到我们的例子中, 抓过来审问 这个动作就是对作用于那些满足 男性, 身高约七尺五寸 的爪哇的小县城里的百姓.

- `Aspect`:`Aspect` 是 `point cu`t 与 `Advice` 的组合, 因此在这里我们就可以类比: “根据老王的线索, 凡是发现有身高七尺五寸的男性, 都要抓过来审问” 这一整个动作可以被认为是一个 `Aspect`.

其实，AOP面向切面编程和OOP面向对象编程一样，它们都仅仅是一种编程思想，而动态代理技术是这种思想最主流的实现方式。<br>
Spring的AOP是Spring框架的高级技术，旨在管理bean对象的过程中底层使用动态代理机制，对特定的方法进行编程(功能增强)。

:::tip  AOP面向切面编程的一些优势

- 代码无侵入：没有修改原始的业务方法，就已经对原始的业务方法进行了功能的增强或者是功能的改变
- 减少了重复代码
- 提高开发效率
- 维护方便

:::

## 三、使用方法

### 1、快速开始

在Spring中用`JoinPoint`抽象了连接点，用它可以获得方法执行时的相关信息，如目标类名、方法名、方法参数等。

- 对于 `@Around` 通知，获取连接点信息只能使用`ProceedingJoinPoint`
- 对于其他四种通知，获取连接点信息只能使用`JoinPoint`，它是 `ProceedingJoinPoint` 的父类型

:::tip AOP通知类型：
1. @Around:环绕通知，此注解标注的通知方法在目标方法前、后都被执行
2. @Before:前置通知，此注解标注的通知方法在目标方法前被执行
3. @After :后置通知，此注解标注的通知方法在目标方法后被执行，无论是否有异常都会执行
4. @AfterReturning:返回后通知，此注解标注的通知方法在目标方法后被执行，有异常不会执行
5. @AfterThrowing:异常后通知，此注解标注的通知方法发生异常后执行

:::

**依赖：**

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>

```

**AOP程序：TimeAspect**:

```java
@Order(2)  //越小优先级越高
@Slf4j
@Component
@Aspect  //AOP
public class TimeAspect {

    //抽取切入点表达式
//    @Pointcut("execution(* com.ruyiwei.service.*.*(..))")
    @Pointcut("@annotation(com.ruyiwei.anno.MyLog)")  //匹配方法上加有MyLog注解的
    private void pt(){}
    /*
    * 切入点表达式
    * 形式：
    *   1、execution(访问修饰符? 返回值 包名.类名.?方法名(方法参数) throws 异常?)    ?表示可以省略   包名.类名可省略   访问修饰符(public,protected)
    *       *  :单个独立的任意符号，可以通配任意返回值、包名、类名、方法名、任意类型的一个参数，也可以通配包、类、方法名的一部分
    *       .. :多个连续的任意符号，可以通配任意层级的包，或任意类型、任意个数的参数
    *       多个表达式可以用 || 隔开
    *   2、@annotation 切入点表达式，用于匹配标识有特定注解的方法
    *            @annotation(com.ruyiwei.anno.MyLog)
    *            @Before(@annotation(com.ruyiwei.anno.MyLog))
    * */

    /*
    * 通知类型：
    *   @Around:环绕通知，此注解标注的通知方法在目标方法前、后都被执行
    *   @Before:前置通知，此注解标注的通知方法在目标方法前被执行
    *   @After :后置通知，此注解标注的通知方法在目标方法后被执行，无论是否有异常都会执行
    *   @AfterReturning:返回后通知，此注解标注的通知方法在目标方法后被执行，有异常不会执行
    *   @AfterThrowing:异常后通知，此注解标注的通知方法发生异常后执行
    *
    * */
    /*
    *   通知执行顺序
    *
    * */
    @Around("pt()") //切入点表达式
    public Object reportTime(ProceedingJoinPoint joinPoint) throws Throwable {
        //记录开始时间
        long begin = System.currentTimeMillis();
        log.info("---before round---");

        //调用原始方法
        Object result = joinPoint.proceed();  //result:原始方法返回值

        //记录结束时间
        long end = System.currentTimeMillis();

        log.info(joinPoint.getSignature() + "方法执行耗时:{}ms",end-begin);
        log.info("---after round---");

        return result;
    }

    @Before("pt()")
    public void before(){
        log.info("----------before----------");

    }

    @After("pt()")
    public void after(){
        log.info("----after----");
    }
}
```

### 2、切入点表达式

**形式：**

1、`execution(访问修饰符? 返回值 包名.类名.?方法名(方法参数) throws 异常?)`    ?表示可以省略   包名.类名可省略   访问修饰符(public,protected)

- ​	`*` 单个独立的任意符号，可以通配任意返回值、包名、类名、方法名、任意类型的一个参数，也可以通配包、类、方法名的一部分

- ​	`..` :多个连续的任意符号，可以通配任意层级的包，或任意类型、任意个数的参数

多个表达式可以用 `||` 隔开

2、`@annotation` 切入点表达式，用于匹配标识有特定注解的方法  -->自己定义一个MyLog标注

`@annotation(com.ruyiwei.anno.MyLog)`

示例：`@Before(@annotation(com.ruyiwei.anno.MyLog))`

### 3、执行顺序

当定义了多个多个切面类的时候，会按照文件名来执行，或者使用 `@Order(2)`来确定执行顺序，数字越小优先级越高



## 参考

[1] [https://blog.csdn.net/q982151756/article/details/80513340?spm=1001.2014.3001.5506](https://blog.csdn.net/q982151756/article/details/80513340?spm=1001.2014.3001.5506)