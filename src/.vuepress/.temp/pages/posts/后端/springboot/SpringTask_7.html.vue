<template><div><!--more--->
<h1 id="springtask" tabindex="-1"><a class="header-anchor" href="#springtask"><span>SpringTask</span></a></h1>
<h2 id="一、介绍" tabindex="-1"><a class="header-anchor" href="#一、介绍"><span>一、介绍</span></a></h2>
<p>Spring Task 是Spring框架提供的任务调度工具，可以按照约定的时间自动执行某个代码逻辑</p>
<div class="hint-container tip">
<p class="hint-container-title">应用场景：</p>
<p>•信用卡每月还款提醒</p>
<p>•银行贷款每月还款提醒</p>
<p>•火车票售票系统处理未支付订单</p>
<p>•入职纪念日为用户发送通知</p>
<p><strong>只要是需要定时处理的场景都可以使用Spring Task</strong></p>
</div>
<h2 id="二、cron表达式" tabindex="-1"><a class="header-anchor" href="#二、cron表达式"><span>二、cron表达式</span></a></h2>
<p>cron表达式其实就是一个字符串，通过cron表达式可以<strong>定义任务触发的时间</strong></p>
<p>构成规则：分为6或7个域，由空格分隔开，每个域代表一个含义，每个域的含义分别为：秒、分钟、小时、日、月、周、年(可选)</p>
<figure><img src="/image\spring\spring2.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>2022年10月12日上午9点整 对应的cron表达式为：0 0 9 12 10 ? 2022</p>
<p>cron表达式在线生成器：<a href="https://cron.qqe2.com/" target="_blank" rel="noopener noreferrer">https://cron.qqe2.com/</a></p>
<h2 id="三、快速使用" tabindex="-1"><a class="header-anchor" href="#三、快速使用"><span>三、快速使用</span></a></h2>
<div class="hint-container info">
<p class="hint-container-title">Spring Task使用步骤：</p>
<p>①导入maven坐标 spring-context （已经包含，不需要单独导入）</p>
<p>②启动类添加注解 @EnableScheduling 开启任务调度</p>
<p>③自定义定时任务类</p>
</div>
<p><strong>1）开启任务调度</strong></p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@EnableScheduling</span>   <span class="token comment">//开启任务调度</span>
<span class="token annotation punctuation">@EnableCaching</span> <span class="token comment">//开启 springcache</span>
<span class="token annotation punctuation">@SpringBootApplication</span>
<span class="token annotation punctuation">@EnableTransactionManagement</span> <span class="token comment">//开启注解方式的事务管理</span>
<span class="token annotation punctuation">@Slf4j</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">SkyApplication</span> <span class="token punctuation">{</span>
    <span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token keyword">void</span> <span class="token function">main</span><span class="token punctuation">(</span><span class="token class-name">String</span><span class="token punctuation">[</span><span class="token punctuation">]</span> args<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token class-name">SpringApplication</span><span class="token punctuation">.</span><span class="token function">run</span><span class="token punctuation">(</span><span class="token class-name">SkyApplication</span><span class="token punctuation">.</span><span class="token keyword">class</span><span class="token punctuation">,</span> args<span class="token punctuation">)</span><span class="token punctuation">;</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"server started"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>2）创建定时任务类</strong></p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token doc-comment comment">/**
 * 自定义定时任务类，可以单独创建一个task包
 */</span>
<span class="token annotation punctuation">@Component</span>
<span class="token annotation punctuation">@Slf4j</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">MyTask</span> <span class="token punctuation">{</span>

    <span class="token annotation punctuation">@Scheduled</span><span class="token punctuation">(</span>cron <span class="token operator">=</span> <span class="token string">"0/5 * * * * ?"</span><span class="token punctuation">)</span> <span class="token comment">//第0秒开始每个五秒触发一次</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">executeTask</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"定时任务开始执行:{}"</span><span class="token punctuation">,</span> <span class="token keyword">new</span> <span class="token class-name">Date</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="四、多线程" tabindex="-1"><a class="header-anchor" href="#四、多线程"><span>四、多线程</span></a></h2>
<p>Spring Task定时器默认是单线程的，如果项目中使用多个定时器，使用一个线程会造成效率低下。</p>
<p>此时我们可以给SpringTask配置线程池。代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>example<span class="token punctuation">.</span>springboottaskdemo</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>scheduling<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">SchedulingConfigurer</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>scheduling<span class="token punctuation">.</span>config<span class="token punctuation">.</span></span><span class="token class-name">ScheduledTaskRegistrar</span></span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">java<span class="token punctuation">.</span>util<span class="token punctuation">.</span>concurrent<span class="token punctuation">.</span></span><span class="token class-name">Executors</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">SchedulingConfig</span> <span class="token keyword">implements</span> <span class="token class-name">SchedulingConfigurer</span> <span class="token punctuation">{</span>
    <span class="token annotation punctuation">@Override</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">configureTasks</span><span class="token punctuation">(</span><span class="token class-name">ScheduledTaskRegistrar</span> taskRegistrar<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 创建线程池，设置五个线程</span>
        taskRegistrar<span class="token punctuation">.</span><span class="token function">setScheduler</span><span class="token punctuation">(</span><span class="token class-name">Executors</span><span class="token punctuation">.</span><span class="token function">newScheduledThreadPool</span><span class="token punctuation">(</span><span class="token number">4</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这样就不会出现阻塞问题了,但是如果定时任务过多，超过了配置的线程池的线程数量还是会运行错乱。</p>
<h1 id="参考" tabindex="-1"><a class="header-anchor" href="#参考"><span>参考</span></a></h1>
<p>[1] <a href="https://cloud.tencent.com/developer/article/2355644" target="_blank" rel="noopener noreferrer">https://cloud.tencent.com/developer/article/2355644</a></p>
<p>[2] <a href="https://www.bilibili.com/video/BV1TP411v7v6?p=126&amp;spm_id_from=pageDriver&amp;vd_source=80162809c800d9d3f638b9ee4096e6d6" target="_blank" rel="noopener noreferrer">B站苍穹外卖</a></p>
</div></template>


