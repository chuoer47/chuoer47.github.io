<template><div><!--more--->
<h1 id="spring-aop详解" tabindex="-1"><a class="header-anchor" href="#spring-aop详解"><span>Spring AOP详解</span></a></h1>
<h2 id="一、什么是aop" tabindex="-1"><a class="header-anchor" href="#一、什么是aop"><span>一、什么是AOP</span></a></h2>
<div class="hint-container info">
<p class="hint-container-title">什么是AOP？</p>
<ul>
<li>Aspect Oriented Programming（面向切面编程、面向方面编程）</li>
<li>面向切面编程就是面向特定方法编程</li>
</ul>
</div>
<p> 就需要先理解什么是切面。用刀把一个西瓜分成两瓣，切开的切口就是切面；炒菜，锅与炉子共同来完成炒菜，锅与炉子就是切面。web层级设计中，web层-&gt;网关层-&gt;服务层-&gt;数据层，每一层之间也是一个切面。编程中，对象与对象之间，方法与方法之间，模块与模块之间都是一个个切面。</p>
<h2 id="二、aop相关概念" tabindex="-1"><a class="header-anchor" href="#二、aop相关概念"><span>二、AOP相关概念</span></a></h2>
<p>看过了上面的例子，我想大家脑中对AOP已经有了一个大致的雏形，但是又对上面提到的切面之类的术语有一些模糊的地方，接下来就来讲解一下AOP中的相关概念，了解了AOP中的概念，才能真正的掌握AOP的精髓。</p>
<p>这里还是先给出一个比较专业的概念定义：</p>
<ul>
<li><code v-pre>Aspect</code>（切面）： <code v-pre>Aspect</code> 声明类似于 Java 中的类声明，在 '<code v-pre>Aspect</code>' 中会包含着一些 <code v-pre>Pointcut</code> 以及相应的 <code v-pre>Advice</code>。</li>
<li><code v-pre>Joint point</code>（连接点）：表示在程序中明确定义的点，典型的包括方法调用，对类成员的访问以及异常处理程序块的执行等等，它自身还可以嵌套其它 <code v-pre>joint point</code>。</li>
<li><code v-pre>Pointcut</code>（切点）：表示一组 <code v-pre>joint point</code>，这些 <code v-pre>joint point</code> 或是通过逻辑关系组合起来，或是通过通配、正则表达式等方式集中起来，它定义了相应的 Advice 将要发生的地方。</li>
<li><code v-pre>Advice</code>（通知）：<code v-pre>Advice</code> 定义了在 Pointcut 里面定义的程序点具体要做的操作，它通过 <code v-pre>before</code>、<code v-pre>after</code> 和 <code v-pre>around</code> 来区别是在每个 <code v-pre>joint point</code> 之前、之后还是代替执行的代码。</li>
<li><code v-pre>Target</code>（目标对象）：织入 <code v-pre>Advice</code> 的目标对象.。</li>
<li><code v-pre>Weaving</code>（织入）：将 <code v-pre>Aspect</code> 和其他对象连接起来, 并创建 <code v-pre>Adviced object</code> 的过程</li>
</ul>
<p>下面我以一个简单的例子来比喻一下 AOP 中 <code v-pre>Aspect</code>, <code v-pre>Joint point</code>, <code v-pre>Pointcut</code> 与 <code v-pre>Advice</code>之间的关系.
 让我们来假设一下, 从前有一个叫爪哇的小县城, 在一个月黑风高的晚上, 这个县城中发生了命案. 作案的凶手十分狡猾, 现场没有留下什么有价值的线索. 不过万幸的是, 刚从隔壁回来的老王恰好在这时候无意中发现了凶手行凶的过程, 但是由于天色已晚, 加上凶手蒙着面, 老王并没有看清凶手的面目, 只知道凶手是个男性, 身高约七尺五寸. 爪哇县的县令根据老王的描述, 对守门的士兵下命令说: 凡是发现有身高七尺五寸的男性, 都要抓过来审问. 士兵当然不敢违背县令的命令, 只好把进出城的所有符合条件的人都抓了起来.</p>
<p>来让我们看一下上面的一个小故事和 AOP 到底有什么对应关系.
 首先我们知道, 在 Spring AOP 中 <code v-pre>Joint point</code> 指代的是所有方法的执行点, 而 <code v-pre>point cut</code> 是一个描述信息, 它修饰的是 <code v-pre>Joint point</code>, 通过 <code v-pre>point cut</code>, 我们就可以确定哪些 <code v-pre>Joint point</code> 可以被织入 <code v-pre>Advice</code>. 对应到我们在上面举的例子, 我们可以做一个简单的类比, <code v-pre>Joint point</code> 就相当于 爪哇的小县城里的百姓,<code v-pre>pointcut</code> 就相当于 老王所做的指控, 即凶手是个男性, 身高约七尺五寸, 而 Advice 则是施加在符合老王所描述的嫌疑人的动作: 抓过来审问.
为什么可以这样类比呢?</p>
<ul>
<li>
<p><code v-pre>Joint point</code> ： 爪哇的小县城里的百姓: 因为根据定义, <code v-pre>Joint point</code> 是所有可能被织入 <code v-pre>Advice</code> 的候选的点, 在 Spring AOP中, 则可以认为所有方法执行点都是 <code v-pre>Joint point</code>. 而在我们上面的例子中, 命案发生在小县城中, 按理说在此县城中的所有人都有可能是嫌疑人.</p>
</li>
<li>
<p><code v-pre>Pointcut</code> ：男性, 身高约七尺五寸: 我们知道, 所有的方法(joint point) 都可以织入 <code v-pre>Advice</code>, 但是我们并不希望在所有方法上都织入 <code v-pre>Advice</code>, 而 <code v-pre>Pointcut</code> 的作用就是提供一组规则来匹配<code v-pre>joinpoint</code>, 给满足规则的 <code v-pre>joinpoint</code> 添加 Advice. 同理, 对于县令来说, 他再昏庸, 也知道不能把县城中的所有百姓都抓起来审问, 而是根据凶手是个男性, 身高约七尺五寸, 把符合条件的人抓起来. 在这里 凶手是个男性, 身高约七尺五寸 就是一个修饰谓语, 它限定了凶手的范围, 满足此修饰规则的百姓都是嫌疑人, 都需要抓起来审问.</p>
</li>
<li>
<p><code v-pre>Advice</code> ：抓过来审问, <code v-pre>Advice</code> 是一个动作, 即一段 Java 代码, 这段 Java 代码是作用于 <code v-pre>point cut</code> 所限定的那些 <code v-pre>Joint point</code> 上的. 同理, 对比到我们的例子中, 抓过来审问 这个动作就是对作用于那些满足 男性, 身高约七尺五寸 的爪哇的小县城里的百姓.</p>
</li>
<li>
<p><code v-pre>Aspect</code>:<code v-pre>Aspect</code> 是 <code v-pre>point cu</code>t 与 <code v-pre>Advice</code> 的组合, 因此在这里我们就可以类比: “根据老王的线索, 凡是发现有身高七尺五寸的男性, 都要抓过来审问” 这一整个动作可以被认为是一个 <code v-pre>Aspect</code>.</p>
</li>
</ul>
<p>其实，AOP面向切面编程和OOP面向对象编程一样，它们都仅仅是一种编程思想，而动态代理技术是这种思想最主流的实现方式。<br>
Spring的AOP是Spring框架的高级技术，旨在管理bean对象的过程中底层使用动态代理机制，对特定的方法进行编程(功能增强)。</p>
<div class="hint-container tip">
<p class="hint-container-title">AOP面向切面编程的一些优势</p>
<ul>
<li>代码无侵入：没有修改原始的业务方法，就已经对原始的业务方法进行了功能的增强或者是功能的改变</li>
<li>减少了重复代码</li>
<li>提高开发效率</li>
<li>维护方便</li>
</ul>
</div>
<h2 id="三、使用方法" tabindex="-1"><a class="header-anchor" href="#三、使用方法"><span>三、使用方法</span></a></h2>
<h3 id="_1、快速开始" tabindex="-1"><a class="header-anchor" href="#_1、快速开始"><span>1、快速开始</span></a></h3>
<p>在Spring中用<code v-pre>JoinPoint</code>抽象了连接点，用它可以获得方法执行时的相关信息，如目标类名、方法名、方法参数等。</p>
<ul>
<li>对于 <code v-pre>@Around</code> 通知，获取连接点信息只能使用<code v-pre>ProceedingJoinPoint</code></li>
<li>对于其他四种通知，获取连接点信息只能使用<code v-pre>JoinPoint</code>，它是 <code v-pre>ProceedingJoinPoint</code> 的父类型</li>
</ul>
<div class="hint-container tip">
<p class="hint-container-title">AOP通知类型：</p>
<ol>
<li>@Around:环绕通知，此注解标注的通知方法在目标方法前、后都被执行</li>
<li>@Before:前置通知，此注解标注的通知方法在目标方法前被执行</li>
<li>@After :后置通知，此注解标注的通知方法在目标方法后被执行，无论是否有异常都会执行</li>
<li>@AfterReturning:返回后通知，此注解标注的通知方法在目标方法后被执行，有异常不会执行</li>
<li>@AfterThrowing:异常后通知，此注解标注的通知方法发生异常后执行</li>
</ol>
</div>
<p><strong>依赖：</strong></p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-aop<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>AOP程序：TimeAspect</strong>:</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Order</span><span class="token punctuation">(</span><span class="token number">2</span><span class="token punctuation">)</span>  <span class="token comment">//越小优先级越高</span>
<span class="token annotation punctuation">@Slf4j</span>
<span class="token annotation punctuation">@Component</span>
<span class="token annotation punctuation">@Aspect</span>  <span class="token comment">//AOP</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">TimeAspect</span> <span class="token punctuation">{</span>

    <span class="token comment">//抽取切入点表达式</span>
<span class="token comment">//    @Pointcut("execution(* com.ruyiwei.service.*.*(..))")</span>
    <span class="token annotation punctuation">@Pointcut</span><span class="token punctuation">(</span><span class="token string">"@annotation(com.ruyiwei.anno.MyLog)"</span><span class="token punctuation">)</span>  <span class="token comment">//匹配方法上加有MyLog注解的</span>
    <span class="token keyword">private</span> <span class="token keyword">void</span> <span class="token function">pt</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span><span class="token punctuation">}</span>
    <span class="token comment">/*
    * 切入点表达式
    * 形式：
    *   1、execution(访问修饰符? 返回值 包名.类名.?方法名(方法参数) throws 异常?)    ?表示可以省略   包名.类名可省略   访问修饰符(public,protected)
    *       *  :单个独立的任意符号，可以通配任意返回值、包名、类名、方法名、任意类型的一个参数，也可以通配包、类、方法名的一部分
    *       .. :多个连续的任意符号，可以通配任意层级的包，或任意类型、任意个数的参数
    *       多个表达式可以用 || 隔开
    *   2、@annotation 切入点表达式，用于匹配标识有特定注解的方法
    *            @annotation(com.ruyiwei.anno.MyLog)
    *            @Before(@annotation(com.ruyiwei.anno.MyLog))
    * */</span>

    <span class="token comment">/*
    * 通知类型：
    *   @Around:环绕通知，此注解标注的通知方法在目标方法前、后都被执行
    *   @Before:前置通知，此注解标注的通知方法在目标方法前被执行
    *   @After :后置通知，此注解标注的通知方法在目标方法后被执行，无论是否有异常都会执行
    *   @AfterReturning:返回后通知，此注解标注的通知方法在目标方法后被执行，有异常不会执行
    *   @AfterThrowing:异常后通知，此注解标注的通知方法发生异常后执行
    *
    * */</span>
    <span class="token comment">/*
    *   通知执行顺序
    *
    * */</span>
    <span class="token annotation punctuation">@Around</span><span class="token punctuation">(</span><span class="token string">"pt()"</span><span class="token punctuation">)</span> <span class="token comment">//切入点表达式</span>
    <span class="token keyword">public</span> <span class="token class-name">Object</span> <span class="token function">reportTime</span><span class="token punctuation">(</span><span class="token class-name">ProceedingJoinPoint</span> joinPoint<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">Throwable</span> <span class="token punctuation">{</span>
        <span class="token comment">//记录开始时间</span>
        <span class="token keyword">long</span> begin <span class="token operator">=</span> <span class="token class-name">System</span><span class="token punctuation">.</span><span class="token function">currentTimeMillis</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"---before round---"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//调用原始方法</span>
        <span class="token class-name">Object</span> result <span class="token operator">=</span> joinPoint<span class="token punctuation">.</span><span class="token function">proceed</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>  <span class="token comment">//result:原始方法返回值</span>

        <span class="token comment">//记录结束时间</span>
        <span class="token keyword">long</span> end <span class="token operator">=</span> <span class="token class-name">System</span><span class="token punctuation">.</span><span class="token function">currentTimeMillis</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span>joinPoint<span class="token punctuation">.</span><span class="token function">getSignature</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">+</span> <span class="token string">"方法执行耗时:{}ms"</span><span class="token punctuation">,</span>end<span class="token operator">-</span>begin<span class="token punctuation">)</span><span class="token punctuation">;</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"---after round---"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token keyword">return</span> result<span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token annotation punctuation">@Before</span><span class="token punctuation">(</span><span class="token string">"pt()"</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">before</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"----------before----------"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

    <span class="token punctuation">}</span>

    <span class="token annotation punctuation">@After</span><span class="token punctuation">(</span><span class="token string">"pt()"</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">after</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"----after----"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、切入点表达式" tabindex="-1"><a class="header-anchor" href="#_2、切入点表达式"><span>2、切入点表达式</span></a></h3>
<p><strong>形式：</strong></p>
<p>1、<code v-pre>execution(访问修饰符? 返回值 包名.类名.?方法名(方法参数) throws 异常?)</code>    ?表示可以省略   包名.类名可省略   访问修饰符(public,protected)</p>
<ul>
<li>
<p>​	<code v-pre>*</code> 单个独立的任意符号，可以通配任意返回值、包名、类名、方法名、任意类型的一个参数，也可以通配包、类、方法名的一部分</p>
</li>
<li>
<p>​	<code v-pre>..</code> :多个连续的任意符号，可以通配任意层级的包，或任意类型、任意个数的参数</p>
</li>
</ul>
<p>多个表达式可以用 <code v-pre>||</code> 隔开</p>
<p>2、<code v-pre>@annotation</code> 切入点表达式，用于匹配标识有特定注解的方法  --&gt;自己定义一个MyLog标注</p>
<p><code v-pre>@annotation(com.ruyiwei.anno.MyLog)</code></p>
<p>示例：<code v-pre>@Before(@annotation(com.ruyiwei.anno.MyLog))</code></p>
<h3 id="_3、执行顺序" tabindex="-1"><a class="header-anchor" href="#_3、执行顺序"><span>3、执行顺序</span></a></h3>
<p>当定义了多个多个切面类的时候，会按照文件名来执行，或者使用 <code v-pre>@Order(2)</code>来确定执行顺序，数字越小优先级越高</p>
<h2 id="参考" tabindex="-1"><a class="header-anchor" href="#参考"><span>参考</span></a></h2>
<p>[1] <a href="https://blog.csdn.net/q982151756/article/details/80513340?spm=1001.2014.3001.5506" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/q982151756/article/details/80513340?spm=1001.2014.3001.5506</a></p>
</div></template>


