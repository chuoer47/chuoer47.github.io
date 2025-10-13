<template><div><p>在昨天的练习作业中，我们改造了余额支付功能，在支付成功后利用RabbitMQ通知交易服务，更新业务订单状态为已支付。
但是大家思考一下，如果这里MQ通知失败，支付服务中支付流水显示支付成功，而交易服务中的订单状态却显示未支付，数据出现了不一致。
此时前端发送请求查询支付状态时，肯定是查询交易服务状态，会发现业务订单未支付，而用户自己知道已经支付成功，这就导致用户体验不一致。</p>
<p>因此，这里我们必须尽可能确保MQ消息的可靠性，即：消息应该至少被消费者处理1次
那么问题来了：</p>
<ul>
<li><strong>我们该如何确保MQ消息的可靠性</strong>？</li>
<li><strong>如果真的发送失败，有没有其它的兜底方案？</strong></li>
</ul>
<p>这些问题，在今天的学习中都会找到答案。</p>
<h1 id="_1-发送者的可靠性" tabindex="-1"><a class="header-anchor" href="#_1-发送者的可靠性"><span>1.发送者的可靠性</span></a></h1>
<p>首先，我们一起分析一下消息丢失的可能性有哪些。
消息从发送者发送消息，到消费者处理消息，需要经过的流程是这样的：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687334552247-cab38ab5-ae63-4f06-9ece-e9f244e3c170.jpeg" alt="" loading="lazy">
消息从生产者到消费者的每一步都可能导致消息丢失：</p>
<ul>
<li>发送消息时丢失：
<ul>
<li>生产者发送消息时连接MQ失败</li>
<li>生产者发送消息到达MQ后未找到<code v-pre>Exchange</code></li>
<li>生产者发送消息到达MQ的<code v-pre>Exchange</code>后，未找到合适的<code v-pre>Queue</code></li>
<li>消息到达MQ后，处理消息的进程发生异常</li>
</ul>
</li>
<li>MQ导致消息丢失：
<ul>
<li>消息到达MQ，保存到队列后，尚未消费就突然宕机</li>
</ul>
</li>
<li>消费者处理消息时：
<ul>
<li>消息接收后尚未处理突然宕机</li>
<li>消息接收后处理过程中抛出异常</li>
</ul>
</li>
</ul>
<p>综上，我们要解决消息丢失问题，保证MQ的可靠性，就必须从3个方面入手：</p>
<ul>
<li>确保生产者一定把消息发送到MQ</li>
<li>确保MQ不会将消息弄丢</li>
<li>确保消费者一定要处理消息</li>
</ul>
<p>这一章我们先来看如何确保生产者一定能把消息发送到MQ。</p>
<h2 id="_1-1-生产者重试机制" tabindex="-1"><a class="header-anchor" href="#_1-1-生产者重试机制"><span>1.1.生产者重试机制</span></a></h2>
<p>首先第一种情况，就是生产者发送消息时，出现了网络故障，导致与MQ的连接中断。</p>
<p>为了解决这个问题，SpringAMQP提供的消息发送时的重试机制。即：当<code v-pre>RabbitTemplate</code>与MQ连接超时后，多次重试。</p>
<p>修改<code v-pre>publisher</code>模块的<code v-pre>application.yaml</code>文件，添加下面的内容：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">connection-timeout</span><span class="token punctuation">:</span> 1s <span class="token comment"># 设置MQ的连接超时时间</span>
    <span class="token key atrule">template</span><span class="token punctuation">:</span>
      <span class="token key atrule">retry</span><span class="token punctuation">:</span>
        <span class="token key atrule">enabled</span><span class="token punctuation">:</span> <span class="token boolean important">true</span> <span class="token comment"># 开启超时重试机制</span>
        <span class="token key atrule">initial-interval</span><span class="token punctuation">:</span> 1000ms <span class="token comment"># 失败后的初始等待时间</span>
        <span class="token key atrule">multiplier</span><span class="token punctuation">:</span> <span class="token number">1</span> <span class="token comment"># 失败后下次的等待时长倍数，下次等待时长 = initial-interval * multiplier</span>
        <span class="token key atrule">max-attempts</span><span class="token punctuation">:</span> <span class="token number">3</span> <span class="token comment"># 最大重试次数</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>我们利用命令停掉RabbitMQ服务：</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code><span class="token function">docker</span> stop mq
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>然后测试发送一条消息，会发现会每隔1秒重试1次，总共重试了3次。消息发送的超时重试机制配置成功了！</p>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意</strong>：当网络不稳定的时候，利用重试机制可以有效提高消息发送的成功率。不过SpringAMQP提供的重试机制是<strong>阻塞式</strong>的重试，也就是说多次重试等待的过程中，当前线程是被阻塞的。
如果对于业务性能有要求，建议禁用重试机制。如果一定要使用，请合理配置等待时长和重试次数，当然也可以考虑使用异步线程来执行发送消息的代码。</p>
</div>
<h2 id="_1-2-生产者确认机制" tabindex="-1"><a class="header-anchor" href="#_1-2-生产者确认机制"><span>1.2.生产者确认机制</span></a></h2>
<p>一般情况下，只要生产者与MQ之间的网路连接顺畅，基本不会出现发送消息丢失的情况，因此大多数情况下我们无需考虑这种问题。
不过，在少数情况下，也会出现消息发送到MQ之后丢失的现象，比如：</p>
<ul>
<li>MQ内部处理消息的进程发生了异常</li>
<li>生产者发送消息到达MQ后未找到<code v-pre>Exchange</code></li>
<li>生产者发送消息到达MQ的<code v-pre>Exchange</code>后，未找到合适的<code v-pre>Queue</code>，因此无法路由</li>
</ul>
<p>针对上述情况，RabbitMQ提供了生产者消息确认机制，包括<code v-pre>Publisher Confirm</code>和<code v-pre>Publisher Return</code>两种。在开启确认机制的情况下，当生产者发送消息给MQ后，MQ会根据消息处理的情况返回不同的<strong>回执</strong>。
具体如图所示：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1690366611659-d5c7f355-7ab1-4eb8-8488-13e1d98843ce.png#averageHue=%23faf7f7&amp;clientId=ucb403171-cc9e-4&amp;from=paste&amp;height=376&amp;id=ue3c6e070&amp;originHeight=466&amp;originWidth=1434&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=81765&amp;status=done&amp;style=none&amp;taskId=ue6af669a-1775-4a0f-ad77-cd9bc059880&amp;title=&amp;width=1156.8402990504578" alt="image.png" loading="lazy">
总结如下：</p>
<ul>
<li>当消息投递到MQ，但是路由失败时，通过<strong>Publisher Return</strong>返回异常信息，同时返回ack的确认信息，代表投递成功</li>
<li>临时消息投递到了MQ，并且入队成功，返回ACK，告知投递成功</li>
<li>持久消息投递到了MQ，并且入队完成持久化，返回ACK ，告知投递成功</li>
<li>其它情况都会返回NACK，告知投递失败</li>
</ul>
<p>其中<code v-pre>ack</code>和<code v-pre>nack</code>属于<strong>Publisher Confirm</strong>机制，<code v-pre>ack</code>是投递成功；<code v-pre>nack</code>是投递失败。而<code v-pre>return</code>则属于<strong>Publisher Return</strong>机制。
默认两种机制都是关闭状态，需要通过配置文件来开启。</p>
<h2 id="_1-3-实现生产者确认" tabindex="-1"><a class="header-anchor" href="#_1-3-实现生产者确认"><span>1.3.实现生产者确认</span></a></h2>
<h3 id="_1-3-1-开启生产者确认" tabindex="-1"><a class="header-anchor" href="#_1-3-1-开启生产者确认"><span>1.3.1.开启生产者确认</span></a></h3>
<p>在publisher模块的<code v-pre>application.yaml</code>中添加配置：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">publisher-confirm-type</span><span class="token punctuation">:</span> correlated <span class="token comment"># 开启publisher confirm机制，并设置confirm类型</span>
    <span class="token key atrule">publisher-returns</span><span class="token punctuation">:</span> <span class="token boolean important">true</span> <span class="token comment"># 开启publisher return机制</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这里<code v-pre>publisher-confirm-type</code>有三种模式可选：</p>
<ul>
<li><code v-pre>none</code>：关闭confirm机制</li>
<li><code v-pre>simple</code>：同步阻塞等待MQ的回执</li>
<li><code v-pre>correlated</code>：MQ异步回调返回回执</li>
</ul>
<p>一般我们推荐使用<code v-pre>correlated</code>，回调机制。</p>
<h3 id="_1-3-2-定义returncallback" tabindex="-1"><a class="header-anchor" href="#_1-3-2-定义returncallback"><span>1.3.2.定义ReturnCallback</span></a></h3>
<p>每个<code v-pre>RabbitTemplate</code>只能配置一个<code v-pre>ReturnCallback</code>，因此我们可以在配置类中统一设置。我们在publisher模块定义一个配置类：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687341529298-150b401d-67f9-4958-acdb-0d3147b0532b.png#averageHue=%23f9fbf8&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=278&amp;id=u6d09b8df&amp;originHeight=345&amp;originWidth=808&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=33987&amp;status=done&amp;style=none&amp;taskId=uf816a0ec-4ff4-4c09-bffc-766884fb5e7&amp;title=&amp;width=651.8319118778032" alt="image.png" loading="lazy">
内容如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>publisher<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span></span><span class="token class-name">AllArgsConstructor</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span>extern<span class="token punctuation">.</span>slf4j<span class="token punctuation">.</span></span><span class="token class-name">Slf4j</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">ReturnedMessage</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">RabbitTemplate</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">javax<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">PostConstruct</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Slf4j</span>
<span class="token annotation punctuation">@AllArgsConstructor</span>
<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">MqConfig</span> <span class="token punctuation">{</span>
    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">;</span>

    <span class="token annotation punctuation">@PostConstruct</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">init</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        rabbitTemplate<span class="token punctuation">.</span><span class="token function">setReturnsCallback</span><span class="token punctuation">(</span><span class="token keyword">new</span> <span class="token class-name">RabbitTemplate<span class="token punctuation">.</span>ReturnsCallback</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token annotation punctuation">@Override</span>
            <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">returnedMessage</span><span class="token punctuation">(</span><span class="token class-name">ReturnedMessage</span> returned<span class="token punctuation">)</span> <span class="token punctuation">{</span>
                log<span class="token punctuation">.</span><span class="token function">error</span><span class="token punctuation">(</span><span class="token string">"触发return callback,"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"exchange: {}"</span><span class="token punctuation">,</span> returned<span class="token punctuation">.</span><span class="token function">getExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"routingKey: {}"</span><span class="token punctuation">,</span> returned<span class="token punctuation">.</span><span class="token function">getRoutingKey</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"message: {}"</span><span class="token punctuation">,</span> returned<span class="token punctuation">.</span><span class="token function">getMessage</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"replyCode: {}"</span><span class="token punctuation">,</span> returned<span class="token punctuation">.</span><span class="token function">getReplyCode</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"replyText: {}"</span><span class="token punctuation">,</span> returned<span class="token punctuation">.</span><span class="token function">getReplyText</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span>
        <span class="token punctuation">}</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_1-3-3-定义confirmcallback" tabindex="-1"><a class="header-anchor" href="#_1-3-3-定义confirmcallback"><span>1.3.3.定义ConfirmCallback</span></a></h3>
<p>由于每个消息发送时的处理逻辑不一定相同，因此ConfirmCallback需要在每次发消息时定义。具体来说，是在调用RabbitTemplate中的convertAndSend方法时，多传递一个参数：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687348187394-21a3698a-277a-478b-8cb8-2ee5bc79207f.png#averageHue=%23f1efed&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=167&amp;id=ubbb0d508&amp;originHeight=207&amp;originWidth=939&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=26725&amp;status=done&amp;style=none&amp;taskId=u0ffba104-eb55-4f79-be54-f249333680d&amp;title=&amp;width=757.5125807589818" alt="image.png" loading="lazy">
这里的CorrelationData中包含两个核心的东西：</p>
<ul>
<li><code v-pre>id</code>：消息的唯一标示，MQ对不同的消息的回执以此做判断，避免混淆</li>
<li><code v-pre>SettableListenableFuture</code>：回执结果的Future对象</li>
</ul>
<p>将来MQ的回执就会通过这个<code v-pre>Future</code>来返回，我们可以提前给<code v-pre>CorrelationData</code>中的<code v-pre>Future</code>添加回调函数来处理消息回执：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687348449866-dee08277-6bc9-4463-9cb8-95013e05a6a2.png#averageHue=%23f3f2f0&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=194&amp;id=u536cb2c1&amp;originHeight=241&amp;originWidth=940&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=26129&amp;status=done&amp;style=none&amp;taskId=u1d347aea-f7e9-43e2-875e-773b69e1bdf&amp;title=&amp;width=758.3193034221969" alt="image.png" loading="lazy"></p>
<p>我们新建一个测试，向系统自带的交换机发送消息，并且添加<code v-pre>ConfirmCallback</code>：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">void</span> <span class="token function">testPublisherConfirm</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 1.创建CorrelationData</span>
    <span class="token class-name">CorrelationData</span> cd <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">CorrelationData</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 2.给Future添加ConfirmCallback</span>
    cd<span class="token punctuation">.</span><span class="token function">getFuture</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">addCallback</span><span class="token punctuation">(</span><span class="token keyword">new</span> <span class="token class-name">ListenableFutureCallback</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">CorrelationData<span class="token punctuation">.</span>Confirm</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token annotation punctuation">@Override</span>
        <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">onFailure</span><span class="token punctuation">(</span><span class="token class-name">Throwable</span> ex<span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 2.1.Future发生异常时的处理逻辑，基本不会触发</span>
            log<span class="token punctuation">.</span><span class="token function">error</span><span class="token punctuation">(</span><span class="token string">"send message fail"</span><span class="token punctuation">,</span> ex<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token annotation punctuation">@Override</span>
        <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">onSuccess</span><span class="token punctuation">(</span><span class="token class-name">CorrelationData<span class="token punctuation">.</span>Confirm</span> result<span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 2.2.Future接收到回执的处理逻辑，参数中的result就是回执内容</span>
            <span class="token keyword">if</span><span class="token punctuation">(</span>result<span class="token punctuation">.</span><span class="token function">isAck</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">{</span> <span class="token comment">// result.isAck()，boolean类型，true代表ack回执，false 代表 nack回执</span>
                log<span class="token punctuation">.</span><span class="token function">debug</span><span class="token punctuation">(</span><span class="token string">"发送消息成功，收到 ack!"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span><span class="token keyword">else</span><span class="token punctuation">{</span> <span class="token comment">// result.getReason()，String类型，返回nack时的异常描述</span>
                log<span class="token punctuation">.</span><span class="token function">error</span><span class="token punctuation">(</span><span class="token string">"发送消息失败，收到 nack, reason : {}"</span><span class="token punctuation">,</span> result<span class="token punctuation">.</span><span class="token function">getReason</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span>
        <span class="token punctuation">}</span>
    <span class="token punctuation">}</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 3.发送消息</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span><span class="token string">"hmall.direct"</span><span class="token punctuation">,</span> <span class="token string">"q"</span><span class="token punctuation">,</span> <span class="token string">"hello"</span><span class="token punctuation">,</span> cd<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>执行结果如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687351726363-c27337c1-cd6e-497e-96ad-ac55fe4cb9e4.png#averageHue=%23f9f6df&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=321&amp;id=u37548b33&amp;originHeight=398&amp;originWidth=1657&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=224878&amp;status=done&amp;style=none&amp;taskId=u5b86f40b-a7f8-4c5f-8fae-4edb9ab2cee&amp;title=&amp;width=1336.7394529474257" alt="image.png" loading="lazy">
可以看到，由于传递的<code v-pre>RoutingKey</code>是错误的，路由失败后，触发了<code v-pre>return callback</code>，同时也收到了ack。
当我们修改为正确的<code v-pre>RoutingKey</code>以后，就不会触发<code v-pre>return callback</code>了，只收到ack。
而如果连交换机都是错误的，则只会收到nack。</p>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意</strong>：
开启生产者确认比较消耗MQ性能，一般不建议开启。而且大家思考一下触发确认的几种情况：</p>
<ul>
<li>路由失败：一般是因为RoutingKey错误导致，往往是编程导致</li>
<li>交换机名称错误：同样是编程错误导致</li>
<li>MQ内部故障：这种需要处理，但概率往往较低。因此只有对消息可靠性要求非常高的业务才需要开启，而且仅仅需要开启ConfirmCallback处理nack就可以了。</li>
</ul>
</div>
<h1 id="_2-mq的可靠性" tabindex="-1"><a class="header-anchor" href="#_2-mq的可靠性"><span>2.MQ的可靠性</span></a></h1>
<p>消息到达MQ以后，如果MQ不能及时保存，也会导致消息丢失，所以MQ的可靠性也非常重要。</p>
<h2 id="_2-1-数据持久化" tabindex="-1"><a class="header-anchor" href="#_2-1-数据持久化"><span>2.1.数据持久化</span></a></h2>
<p>为了提升性能，默认情况下MQ的数据都是在内存存储的临时数据，重启后就会消失。为了保证数据的可靠性，必须配置数据持久化，包括：</p>
<ul>
<li>交换机持久化</li>
<li>队列持久化</li>
<li>消息持久化</li>
</ul>
<p>我们以控制台界面为例来说明。</p>
<h3 id="_2-1-1-交换机持久化" tabindex="-1"><a class="header-anchor" href="#_2-1-1-交换机持久化"><span>2.1.1.交换机持久化</span></a></h3>
<p>在控制台的<code v-pre>Exchanges</code>页面，添加交换机时可以配置交换机的<code v-pre>Durability</code>参数：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687353601905-9b09c0df-1b03-49e1-95c8-437ef9f3cd81.png#averageHue=%23f9f8f8&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=281&amp;id=Kve5K&amp;originHeight=348&amp;originWidth=922&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=22552&amp;status=done&amp;style=none&amp;taskId=u9ff1f541-056b-4c91-a4e3-ce6890f4d00&amp;title=&amp;width=743.798295484325" alt="image.png" loading="lazy">
设置为<code v-pre>Durable</code>就是持久化模式，<code v-pre>Transient</code>就是临时模式。</p>
<h3 id="_2-1-2-队列持久化" tabindex="-1"><a class="header-anchor" href="#_2-1-2-队列持久化"><span>2.1.2.队列持久化</span></a></h3>
<p>在控制台的Queues页面，添加队列时，同样可以配置队列的<code v-pre>Durability</code>参数：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687353771968-5c560b86-a1ae-4649-8597-c7ebfeffa9a5.png#averageHue=%23f8f7f6&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=295&amp;id=I03Rh&amp;originHeight=366&amp;originWidth=1130&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=30872&amp;status=done&amp;style=none&amp;taskId=u7425f64c-6c68-4b86-a558-9c10f825f3f&amp;title=&amp;width=911.5966094330664" alt="image.png" loading="lazy">
除了持久化以外，你可以看到队列还有很多其它参数，有一些我们会在后期学习。</p>
<h3 id="_2-1-3-消息持久化" tabindex="-1"><a class="header-anchor" href="#_2-1-3-消息持久化"><span>2.1.3.消息持久化</span></a></h3>
<p>在控制台发送消息的时候，可以添加很多参数，而消息的持久化是要配置一个<code v-pre>properties</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687354083723-84971642-712d-42bc-ba65-6e3b3b33758c.png#averageHue=%23faf8f8&amp;clientId=ue4302575-73b6-4&amp;from=paste&amp;height=423&amp;id=T4xqJ&amp;originHeight=524&amp;originWidth=995&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=17663&amp;status=done&amp;style=none&amp;taskId=u75d6c2e2-1770-43f8-9a9f-9bc5f480099&amp;title=&amp;width=802.6890498990275" alt="image.png" loading="lazy"></p>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>说明</strong>：在开启持久化机制以后，如果同时还开启了生产者确认，那么MQ会在消息持久化以后才发送ACK回执，进一步确保消息的可靠性。
不过出于性能考虑，为了减少IO次数，发送到MQ的消息并不是逐条持久化到数据库的，而是每隔一段时间批量持久化。一般间隔在100毫秒左右，这就会导致ACK有一定的延迟，因此建议生产者确认全部采用异步方式。</p>
</div>
<h2 id="_2-2-lazyqueue" tabindex="-1"><a class="header-anchor" href="#_2-2-lazyqueue"><span>2.2.LazyQueue</span></a></h2>
<p>在默认情况下，RabbitMQ会将接收到的信息保存在内存中以降低消息收发的延迟。但在某些特殊情况下，这会导致消息积压，比如：</p>
<ul>
<li>消费者宕机或出现网络故障</li>
<li>消息发送量激增，超过了消费者处理速度</li>
<li>消费者处理业务发生阻塞</li>
</ul>
<p>一旦出现消息堆积问题，RabbitMQ的内存占用就会越来越高，直到触发内存预警上限。此时RabbitMQ会将内存消息刷到磁盘上，这个行为成为<code v-pre>PageOut</code>. <code v-pre>PageOut</code>会耗费一段时间，并且会阻塞队列进程。因此在这个过程中RabbitMQ不会再处理新的消息，生产者的所有请求都会被阻塞。</p>
<p>为了解决这个问题，从RabbitMQ的3.6.0版本开始，就增加了Lazy Queues的模式，也就是惰性队列。惰性队列的特征如下：</p>
<ul>
<li>接收到消息后直接存入磁盘而非内存</li>
<li>消费者要消费消息时才会从磁盘中读取并加载到内存（也就是懒加载）</li>
<li>支持数百万条的消息存储</li>
</ul>
<p>而在3.12版本之后，LazyQueue已经成为所有队列的默认格式。因此官方推荐升级MQ为3.12版本或者所有队列都设置为LazyQueue模式。</p>
<h3 id="_2-2-1-控制台配置lazy模式" tabindex="-1"><a class="header-anchor" href="#_2-2-1-控制台配置lazy模式"><span>2.2.1.控制台配置Lazy模式</span></a></h3>
<p>在添加队列的时候，添加<code v-pre>x-queue-mod=lazy</code>参数即可设置队列为Lazy模式：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687421366634-1dfca4a6-2407-43c2-8e65-fd7ba9e660dc.png#averageHue=%23f8f6f5&amp;clientId=ud69cf815-2833-4&amp;from=paste&amp;height=361&amp;id=auTfj&amp;originHeight=447&amp;originWidth=1127&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=34943&amp;status=done&amp;style=none&amp;taskId=ue22630f9-97c2-47c9-989b-e1963580eb6&amp;title=&amp;width=909.1764414434211" alt="image.png" loading="lazy"></p>
<h3 id="_2-2-2-代码配置lazy模式" tabindex="-1"><a class="header-anchor" href="#_2-2-2-代码配置lazy模式"><span>2.2.2.代码配置Lazy模式</span></a></h3>
<p>在利用SpringAMQP声明队列的时候，添加<code v-pre>x-queue-mod=lazy</code>参数也可设置队列为Lazy模式：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">lazyQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token keyword">return</span> <span class="token class-name">QueueBuilder</span>
            <span class="token punctuation">.</span><span class="token function">durable</span><span class="token punctuation">(</span><span class="token string">"lazy.queue"</span><span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">lazy</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token comment">// 开启Lazy模式</span>
            <span class="token punctuation">.</span><span class="token function">build</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这里是通过<code v-pre>QueueBuilder</code>的<code v-pre>lazy()</code>函数配置Lazy模式，底层源码如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687421880071-2a21369f-00b3-481d-a9bb-ce69a346ccc3.png#averageHue=%23f4f6ed&amp;clientId=ud69cf815-2833-4&amp;from=paste&amp;height=192&amp;id=dCe61&amp;originHeight=238&amp;originWidth=908&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=32577&amp;status=done&amp;style=none&amp;taskId=u17fb9e40-01c9-4605-bc5a-eb906237b36&amp;title=&amp;width=732.5041781993135" alt="image.png" loading="lazy"></p>
<p>当然，我们也可以基于注解来声明队列并设置为Lazy模式：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queuesToDeclare <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>
        name <span class="token operator">=</span> <span class="token string">"lazy.queue"</span><span class="token punctuation">,</span>
        durable <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">,</span>
        arguments <span class="token operator">=</span> <span class="token annotation punctuation">@Argument</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"x-queue-mode"</span><span class="token punctuation">,</span> value <span class="token operator">=</span> <span class="token string">"lazy"</span><span class="token punctuation">)</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenLazyQueue</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"接收到 lazy.queue的消息：{}"</span><span class="token punctuation">,</span> msg<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2-2-3-更新已有队列为lazy模式" tabindex="-1"><a class="header-anchor" href="#_2-2-3-更新已有队列为lazy模式"><span>2.2.3.更新已有队列为lazy模式</span></a></h3>
<p>对于已经存在的队列，也可以配置为lazy模式，但是要通过设置policy实现。
可以基于命令行设置policy：</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code>rabbitmqctl set_policy Lazy <span class="token string">"^lazy-queue$"</span> <span class="token string">'{"queue-mode":"lazy"}'</span> --apply-to queues  
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>命令解读：</p>
<ul>
<li><code v-pre>rabbitmqctl</code> ：RabbitMQ的命令行工具</li>
<li><code v-pre>set_policy</code> ：添加一个策略</li>
<li><code v-pre>Lazy</code> ：策略名称，可以自定义</li>
<li><code v-pre>&quot;^lazy-queue$&quot;</code> ：用正则表达式匹配队列的名字</li>
<li><code v-pre>'{&quot;queue-mode&quot;:&quot;lazy&quot;}'</code> ：设置队列模式为lazy模式</li>
<li><code v-pre>--apply-to queues</code>：策略的作用对象，是所有的队列</li>
</ul>
<p>当然，也可以在控制台配置policy，进入在控制台的<code v-pre>Admin</code>页面，点击<code v-pre>Policies</code>，即可添加配置：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687422619364-b0e414b9-55fc-49f2-b7b5-de52b72a9f56.png#averageHue=%23f7f6f5&amp;clientId=ud69cf815-2833-4&amp;from=paste&amp;height=682&amp;id=pcraA&amp;originHeight=846&amp;originWidth=1365&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=83823&amp;status=done&amp;style=none&amp;taskId=u10b50f65-9311-4fb6-9f0b-ac0bbe2c3c9&amp;title=&amp;width=1101.1764352886157" alt="image.png" loading="lazy"></p>
<h1 id="_3-消费者的可靠性" tabindex="-1"><a class="header-anchor" href="#_3-消费者的可靠性"><span>3.消费者的可靠性</span></a></h1>
<p>当RabbitMQ向消费者投递消息以后，需要知道消费者的处理状态如何。因为消息投递给消费者并不代表就一定被正确消费了，可能出现的故障有很多，比如：</p>
<ul>
<li>消息投递的过程中出现了网络故障</li>
<li>消费者接收到消息后突然宕机</li>
<li>消费者接收到消息后，因处理不当导致异常</li>
<li>...</li>
</ul>
<p>一旦发生上述情况，消息也会丢失。因此，RabbitMQ必须知道消费者的处理状态，一旦消息处理失败才能重新投递消息。
但问题来了：RabbitMQ如何得知消费者的处理状态呢？</p>
<p>本章我们就一起研究一下消费者处理消息时的可靠性解决方案。</p>
<h2 id="_2-1-消费者确认机制" tabindex="-1"><a class="header-anchor" href="#_2-1-消费者确认机制"><span>2.1.消费者确认机制</span></a></h2>
<p>为了确认消费者是否成功处理消息，RabbitMQ提供了消费者确认机制（<strong>Consumer Acknowledgement</strong>）。即：当消费者处理消息结束后，应该向RabbitMQ发送一个回执，告知RabbitMQ自己消息处理状态。回执有三种可选值：</p>
<ul>
<li>ack：成功处理消息，RabbitMQ从队列中删除该消息</li>
<li>nack：消息处理失败，RabbitMQ需要再次投递消息</li>
<li>reject：消息处理失败并拒绝该消息，RabbitMQ从队列中删除该消息</li>
</ul>
<p>一般reject方式用的较少，除非是消息格式有问题，那就是开发问题了。因此大多数情况下我们需要将消息处理的代码通过<code v-pre>try catch</code>机制捕获，消息处理成功时返回ack，处理失败时返回nack.</p>
<p>由于消息回执的处理代码比较统一，因此SpringAMQP帮我们实现了消息确认。并允许我们通过配置文件设置ACK处理方式，有三种模式：</p>
<ul>
<li><code v-pre>**none**</code>：不处理。即消息投递给消费者后立刻ack，消息会立刻从MQ删除。非常不安全，不建议使用</li>
<li><code v-pre>**manual**</code>：手动模式。需要自己在业务代码中调用api，发送<code v-pre>ack</code>或<code v-pre>reject</code>，存在业务入侵，但更灵活</li>
<li><code v-pre>**auto**</code>：自动模式。SpringAMQP利用AOP对我们的消息处理逻辑做了环绕增强，当业务正常执行时则自动返回<code v-pre>ack</code>.  当业务出现异常时，根据异常判断返回不同结果：
<ul>
<li>如果是<strong>业务异常</strong>，会自动返回<code v-pre>nack</code>；</li>
<li>如果是<strong>消息处理或校验异常</strong>，自动返回<code v-pre>reject</code>;</li>
</ul>
</li>
</ul>
<p>返回Reject的常见异常有：</p>
<blockquote>
<p>Starting with version 1.3.2, the default ErrorHandler is now a ConditionalRejectingErrorHandler that rejects (and does not requeue) messages that fail with an irrecoverable error. Specifically, it rejects messages that fail with the following errors:</p>
<ul>
<li>o.s.amqp…MessageConversionException: Can be thrown when converting the incoming message payload using a MessageConverter.</li>
<li>o.s.messaging…MessageConversionException: Can be thrown by the conversion service if additional conversion is required when mapping to a @RabbitListener method.</li>
<li>o.s.messaging…MethodArgumentNotValidException: Can be thrown if validation (for example, @Valid) is used in the listener and the validation fails.</li>
<li>o.s.messaging…MethodArgumentTypeMismatchException: Can be thrown if the inbound message was converted to a type that is not correct for the target method. For example, the parameter is declared as Message but Message is received.</li>
<li>java.lang.NoSuchMethodException: Added in version 1.6.3.</li>
<li>java.lang.ClassCastException: Added in version 1.6.3.</li>
</ul>
</blockquote>
<p>通过下面的配置可以修改SpringAMQP的ACK处理方式：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">listener</span><span class="token punctuation">:</span>
      <span class="token key atrule">simple</span><span class="token punctuation">:</span>
        <span class="token key atrule">acknowledge-mode</span><span class="token punctuation">:</span> none <span class="token comment"># 不做处理</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改consumer服务的SpringRabbitListener类中的方法，模拟一个消息处理的异常：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"simple.queue"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenSimpleQueueMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"spring 消费者接收到消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token boolean">true</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">throw</span> <span class="token keyword">new</span> <span class="token class-name">MessageConversionException</span><span class="token punctuation">(</span><span class="token string">"故意的"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"消息处理完成"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>测试可以发现：当消息处理发生异常时，消息依然被RabbitMQ删除了。</p>
<p>我们再次把确认机制修改为auto：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">listener</span><span class="token punctuation">:</span>
      <span class="token key atrule">simple</span><span class="token punctuation">:</span>
        <span class="token key atrule">acknowledge-mode</span><span class="token punctuation">:</span> auto <span class="token comment"># 自动ack</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在异常位置打断点，再次发送消息，程序卡在断点时，可以发现此时消息状态为<code v-pre>unacked</code>（未确定状态）：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687489262801-36725872-cc98-470a-ab6b-85cfd9c1b0ce.png#averageHue=%23f5f3f3&amp;clientId=uaa251f98-ecdc-4&amp;from=paste&amp;height=194&amp;id=u0edc5b71&amp;originHeight=241&amp;originWidth=1100&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=24869&amp;status=done&amp;style=none&amp;taskId=ufc5a8f88-61f6-4518-ad83-77d7037cd6b&amp;title=&amp;width=887.3949295366134" alt="image.png" loading="lazy">
放行以后，由于抛出的是<strong>消息转换异常</strong>，因此Spring会自动返回<code v-pre>reject</code>，所以消息依然会被删除：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687490335196-66d14c99-45c2-4113-8a36-94e33c3ce7d5.png#averageHue=%23f3f3f2&amp;clientId=uaa251f98-ecdc-4&amp;from=paste&amp;height=231&amp;id=u0977f925&amp;originHeight=286&amp;originWidth=1099&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=28753&amp;status=done&amp;style=none&amp;taskId=u60974200-bef2-4eca-a9e8-1b91ce70eb9&amp;title=&amp;width=886.5882068733982" alt="image.png" loading="lazy"></p>
<p>我们将异常改为RuntimeException类型：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"simple.queue"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenSimpleQueueMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"spring 消费者接收到消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token boolean">true</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">throw</span> <span class="token keyword">new</span> <span class="token class-name">RuntimeException</span><span class="token punctuation">(</span><span class="token string">"故意的"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"消息处理完成"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在异常位置打断点，然后再次发送消息测试，程序卡在断点时，可以发现此时消息状态为<code v-pre>unacked</code>（未确定状态）：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687489262801-36725872-cc98-470a-ab6b-85cfd9c1b0ce.png#averageHue=%23f5f3f3&amp;clientId=uaa251f98-ecdc-4&amp;from=paste&amp;height=194&amp;id=WusVn&amp;originHeight=241&amp;originWidth=1100&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=24869&amp;status=done&amp;style=none&amp;taskId=ufc5a8f88-61f6-4518-ad83-77d7037cd6b&amp;title=&amp;width=887.3949295366134" alt="image.png" loading="lazy">放行以后，由于抛出的是业务异常，所以Spring返回<code v-pre>ack</code>，最终消息恢复至<code v-pre>Ready</code>状态，并且没有被RabbitMQ删除：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687490819965-f638194b-f956-4ad3-8cd4-2e03f5e43674.png#averageHue=%23f4f3f2&amp;clientId=uaa251f98-ecdc-4&amp;from=paste&amp;height=237&amp;id=u0f1b8e0c&amp;originHeight=294&amp;originWidth=1110&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=29088&amp;status=done&amp;style=none&amp;taskId=ue0e6353b-c435-43f2-9520-32a58e71098&amp;title=&amp;width=895.4621561687644" alt="image.png" loading="lazy">
当我们把配置改为<code v-pre>auto</code>时，消息处理失败后，会回到RabbitMQ，并重新投递到消费者。</p>
<h2 id="_2-2-失败重试机制" tabindex="-1"><a class="header-anchor" href="#_2-2-失败重试机制"><span>2.2.失败重试机制</span></a></h2>
<p>当消费者出现异常后，消息会不断requeue（重入队）到队列，再重新发送给消费者。如果消费者再次执行依然出错，消息会再次requeue到队列，再次投递，直到消息处理成功为止。
极端情况就是消费者一直无法执行成功，那么消息requeue就会无限循环，导致mq的消息处理飙升，带来不必要的压力：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687490923673-6eca30c4-4cd0-4a92-b6d4-2766c0ad1746.png#averageHue=%23f2f1f1&amp;clientId=uaa251f98-ecdc-4&amp;from=paste&amp;height=131&amp;id=ue26e64ed&amp;originHeight=162&amp;originWidth=988&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=56569&amp;status=done&amp;style=none&amp;taskId=u63e3277a-cb8f-4fd8-bdff-fc1dcc685e9&amp;title=&amp;width=797.0419912565218" alt="image.png" loading="lazy"></p>
<p>当然，上述极端情况发生的概率还是非常低的，不过不怕一万就怕万一。为了应对上述情况Spring又提供了消费者失败重试机制：在消费者出现异常时利用本地重试，而不是无限制的requeue到mq队列。</p>
<p>修改consumer服务的application.yml文件，添加内容：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">listener</span><span class="token punctuation">:</span>
      <span class="token key atrule">simple</span><span class="token punctuation">:</span>
        <span class="token key atrule">retry</span><span class="token punctuation">:</span>
          <span class="token key atrule">enabled</span><span class="token punctuation">:</span> <span class="token boolean important">true</span> <span class="token comment"># 开启消费者失败重试</span>
          <span class="token key atrule">initial-interval</span><span class="token punctuation">:</span> 1000ms <span class="token comment"># 初识的失败等待时长为1秒</span>
          <span class="token key atrule">multiplier</span><span class="token punctuation">:</span> <span class="token number">1</span> <span class="token comment"># 失败的等待时长倍数，下次等待时长 = multiplier * last-interval</span>
          <span class="token key atrule">max-attempts</span><span class="token punctuation">:</span> <span class="token number">3</span> <span class="token comment"># 最大重试次数</span>
          <span class="token key atrule">stateless</span><span class="token punctuation">:</span> <span class="token boolean important">true</span> <span class="token comment"># true无状态；false有状态。如果业务中包含事务，这里改为false</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>重启consumer服务，重复之前的测试。可以发现：</p>
<ul>
<li>消费者在失败后消息没有重新回到MQ无限重新投递，而是在本地重试了3次</li>
<li>本地重试3次以后，抛出了<code v-pre>AmqpRejectAndDontRequeueException</code>异常。查看RabbitMQ控制台，发现消息被删除了，说明最后SpringAMQP返回的是<code v-pre>reject</code></li>
</ul>
<p>结论：</p>
<ul>
<li>开启本地重试时，消息处理过程中抛出异常，不会requeue到队列，而是在消费者本地重试</li>
<li>重试达到最大次数后，Spring会返回reject，消息会被丢弃</li>
</ul>
<h2 id="_2-3-失败处理策略" tabindex="-1"><a class="header-anchor" href="#_2-3-失败处理策略"><span>2.3.失败处理策略</span></a></h2>
<p>在之前的测试中，本地测试达到最大重试次数后，消息会被丢弃。这在某些对于消息可靠性要求较高的业务场景下，显然不太合适了。
因此Spring允许我们自定义重试次数耗尽后的消息处理策略，这个策略是由<code v-pre>MessageRecovery</code>接口来定义的，它有3个不同实现：</p>
<ul>
<li><code v-pre>RejectAndDontRequeueRecoverer</code>：重试耗尽后，直接<code v-pre>reject</code>，丢弃消息。默认就是这种方式</li>
<li><code v-pre>ImmediateRequeueMessageRecoverer</code>：重试耗尽后，返回<code v-pre>nack</code>，消息重新入队</li>
<li><code v-pre>RepublishMessageRecoverer</code>：重试耗尽后，将失败消息投递到指定的交换机</li>
</ul>
<p>比较优雅的一种处理方案是<code v-pre>RepublishMessageRecoverer</code>，失败后将消息投递到一个指定的，专门存放异常消息的队列，后续由人工集中处理。</p>
<p>1）在consumer服务中定义处理失败消息的交换机和队列</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">DirectExchange</span> <span class="token function">errorMessageExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">DirectExchange</span><span class="token punctuation">(</span><span class="token string">"error.direct"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
<span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">errorQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"error.queue"</span><span class="token punctuation">,</span> <span class="token boolean">true</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
<span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">errorBinding</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> errorQueue<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> errorMessageExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>errorQueue<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>errorMessageExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"error"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2）定义一个RepublishMessageRecoverer，关联队列和交换机</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">MessageRecoverer</span> <span class="token function">republishMessageRecoverer</span><span class="token punctuation">(</span><span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">RepublishMessageRecoverer</span><span class="token punctuation">(</span>rabbitTemplate<span class="token punctuation">,</span> <span class="token string">"error.direct"</span><span class="token punctuation">,</span> <span class="token string">"error"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>完整代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">Binding</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">BindingBuilder</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">DirectExchange</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">Queue</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">RabbitTemplate</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>retry<span class="token punctuation">.</span></span><span class="token class-name">MessageRecoverer</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>retry<span class="token punctuation">.</span></span><span class="token class-name">RepublishMessageRecoverer</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Bean</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Configuration</span>
<span class="token annotation punctuation">@ConditionalOnProperty</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"spring.rabbitmq.listener.simple.retry.enabled"</span><span class="token punctuation">,</span> havingValue <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">ErrorMessageConfig</span> <span class="token punctuation">{</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">DirectExchange</span> <span class="token function">errorMessageExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">DirectExchange</span><span class="token punctuation">(</span><span class="token string">"error.direct"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">errorQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"error.queue"</span><span class="token punctuation">,</span> <span class="token boolean">true</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">errorBinding</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> errorQueue<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> errorMessageExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>errorQueue<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>errorMessageExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"error"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">MessageRecoverer</span> <span class="token function">republishMessageRecoverer</span><span class="token punctuation">(</span><span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">RepublishMessageRecoverer</span><span class="token punctuation">(</span>rabbitTemplate<span class="token punctuation">,</span> <span class="token string">"error.direct"</span><span class="token punctuation">,</span> <span class="token string">"error"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_2-4-业务幂等性" tabindex="-1"><a class="header-anchor" href="#_2-4-业务幂等性"><span>2.4.业务幂等性</span></a></h2>
<p>何为幂等性？
<strong>幂等</strong>是一个数学概念，用函数表达式来描述是这样的：<code v-pre>f(x) = f(f(x))</code>，例如求绝对值函数。
在程序开发中，则是指同一个业务，执行一次或多次对业务状态的影响是一致的。例如：</p>
<ul>
<li>根据id删除数据</li>
<li>查询数据</li>
<li>新增数据</li>
</ul>
<p>但数据的更新往往不是幂等的，如果重复执行可能造成不一样的后果。比如：</p>
<ul>
<li>取消订单，恢复库存的业务。如果多次恢复就会出现库存重复增加的情况</li>
<li>退款业务。重复退款对商家而言会有经济损失。</li>
</ul>
<p>所以，我们要尽可能避免业务被重复执行。
然而在实际业务场景中，由于意外经常会出现业务被重复执行的情况，例如：</p>
<ul>
<li>页面卡顿时频繁刷新导致表单重复提交</li>
<li>服务间调用的重试</li>
<li>MQ消息的重复投递</li>
</ul>
<p>我们在用户支付成功后会发送MQ消息到交易服务，修改订单状态为已支付，就可能出现消息重复投递的情况。如果消费者不做判断，很有可能导致消息被消费多次，出现业务故障。
举例：</p>
<ol>
<li>假如用户刚刚支付完成，并且投递消息到交易服务，交易服务更改订单为<strong>已支付</strong>状态。</li>
<li>由于某种原因，例如网络故障导致生产者没有得到确认，隔了一段时间后<strong>重新投递</strong>给交易服务。</li>
<li>但是，在新投递的消息被消费之前，用户选择了退款，将订单状态改为了<strong>已退款</strong>状态。</li>
<li>退款完成后，新投递的消息才被消费，那么订单状态会被再次改为<strong>已支付</strong>。业务异常。</li>
</ol>
<p>因此，我们必须想办法保证消息处理的幂等性。这里给出两种方案：</p>
<ul>
<li>唯一消息ID</li>
<li>业务状态判断</li>
</ul>
<h3 id="_2-4-1-唯一消息id" tabindex="-1"><a class="header-anchor" href="#_2-4-1-唯一消息id"><span>2.4.1.唯一消息ID</span></a></h3>
<p>这个思路非常简单：</p>
<ol>
<li>每一条消息都生成一个唯一的id，与消息一起投递给消费者。</li>
<li>消费者接收到消息后处理自己的业务，业务处理成功后将消息ID保存到数据库</li>
<li>如果下次又收到相同消息，去数据库查询判断是否存在，存在则为重复消息放弃处理。</li>
</ol>
<p>我们该如何给消息添加唯一ID呢？
其实很简单，SpringAMQP的MessageConverter自带了MessageID的功能，我们只要开启这个功能即可。
以Jackson的消息转换器为例：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">MessageConverter</span> <span class="token function">messageConverter</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token comment">// 1.定义消息转换器</span>
    <span class="token class-name">Jackson2JsonMessageConverter</span> jjmc <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Jackson2JsonMessageConverter</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 2.配置自动创建消息id，用于识别不同消息，也可以在业务中基于ID判断是否是重复消息</span>
    jjmc<span class="token punctuation">.</span><span class="token function">setCreateMessageIds</span><span class="token punctuation">(</span><span class="token boolean">true</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">return</span> jjmc<span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2-4-2-业务判断" tabindex="-1"><a class="header-anchor" href="#_2-4-2-业务判断"><span>2.4.2.业务判断</span></a></h3>
<p>业务判断就是基于业务本身的逻辑或状态来判断是否是重复的请求或消息，不同的业务场景判断的思路也不一样。
例如我们当前案例中，处理消息的业务逻辑是把订单状态从未支付修改为已支付。因此我们就可以在执行业务时判断订单状态是否是未支付，如果不是则证明订单已经被处理过，无需重复处理。</p>
<p>相比较而言，消息ID的方案需要改造原有的数据库，所以我更推荐使用业务判断的方案。</p>
<p>以支付修改订单的业务为例，我们需要修改<code v-pre>OrderServiceImpl</code>中的<code v-pre>markOrderPaySuccess</code>方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code>    <span class="token annotation punctuation">@Override</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">markOrderPaySuccess</span><span class="token punctuation">(</span><span class="token class-name">Long</span> orderId<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 1.查询订单</span>
        <span class="token class-name">Order</span> old <span class="token operator">=</span> <span class="token function">getById</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token comment">// 2.判断订单状态</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>old <span class="token operator">==</span> <span class="token keyword">null</span> <span class="token operator">||</span> old<span class="token punctuation">.</span><span class="token function">getStatus</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 订单不存在或者订单状态不是1，放弃处理</span>
            <span class="token keyword">return</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token comment">// 3.尝试更新订单</span>
        <span class="token class-name">Order</span> order <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Order</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        order<span class="token punctuation">.</span><span class="token function">setId</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
        order<span class="token punctuation">.</span><span class="token function">setStatus</span><span class="token punctuation">(</span><span class="token number">2</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        order<span class="token punctuation">.</span><span class="token function">setPayTime</span><span class="token punctuation">(</span><span class="token class-name">LocalDateTime</span><span class="token punctuation">.</span><span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token function">updateById</span><span class="token punctuation">(</span>order<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>上述代码逻辑上符合了幂等判断的需求，但是由于判断和更新是两步动作，因此在极小概率下可能存在线程安全问题。</p>
<p>我们可以合并上述操作为这样：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Override</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">markOrderPaySuccess</span><span class="token punctuation">(</span><span class="token class-name">Long</span> orderId<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// UPDATE `order` SET status = ? , pay_time = ? WHERE id = ? AND status = 1</span>
    <span class="token function">lambdaUpdate</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">set</span><span class="token punctuation">(</span><span class="token class-name">Order</span><span class="token operator">::</span><span class="token function">getStatus</span><span class="token punctuation">,</span> <span class="token number">2</span><span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">set</span><span class="token punctuation">(</span><span class="token class-name">Order</span><span class="token operator">::</span><span class="token function">getPayTime</span><span class="token punctuation">,</span> <span class="token class-name">LocalDateTime</span><span class="token punctuation">.</span><span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">eq</span><span class="token punctuation">(</span><span class="token class-name">Order</span><span class="token operator">::</span><span class="token function">getId</span><span class="token punctuation">,</span> orderId<span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">eq</span><span class="token punctuation">(</span><span class="token class-name">Order</span><span class="token operator">::</span><span class="token function">getStatus</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span>
            <span class="token punctuation">.</span><span class="token function">update</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意看，上述代码等同于这样的SQL语句：</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">UPDATE</span> <span class="token identifier"><span class="token punctuation">`</span>order<span class="token punctuation">`</span></span> <span class="token keyword">SET</span> <span class="token keyword">status</span> <span class="token operator">=</span> ? <span class="token punctuation">,</span> pay_time <span class="token operator">=</span> ? <span class="token keyword">WHERE</span> id <span class="token operator">=</span> ? <span class="token operator">AND</span> <span class="token keyword">status</span> <span class="token operator">=</span> <span class="token number">1</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>我们在where条件中除了判断id以外，还加上了status必须为1的条件。如果条件不符（说明订单已支付），则SQL匹配不到数据，根本不会执行。</p>
<h2 id="_2-5-兜底方案" tabindex="-1"><a class="header-anchor" href="#_2-5-兜底方案"><span>2.5.兜底方案</span></a></h2>
<p>虽然我们利用各种机制尽可能增加了消息的可靠性，但也不好说能保证消息100%的可靠。万一真的MQ通知失败该怎么办呢？
有没有其它兜底方案，能够确保订单的支付状态一致呢？</p>
<p>其实思想很简单：既然MQ通知不一定发送到交易服务，那么交易服务就必须自己<strong>主动去查询</strong>支付状态。这样即便支付服务的MQ通知失败，我们依然能通过主动查询来保证订单状态的一致。
流程如下：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687521150465-25b54b36-b64a-4b2d-90b7-8dff12fb075b.jpeg" alt="" loading="lazy"></p>
<p>图中黄色线圈起来的部分就是MQ通知失败后的兜底处理方案，由交易服务自己主动去查询支付状态。</p>
<p>不过需要注意的是，交易服务并不知道用户会在什么时候支付，如果查询的时机不正确（比如查询的时候用户正在支付中），可能查询到的支付状态也不正确。
那么问题来了，我们到底该在什么时间主动查询支付状态呢？</p>
<p>这个时间是无法确定的，因此，通常我们采取的措施就是利用<strong>定时任务</strong>定期查询，例如每隔20秒就查询一次，并判断支付状态。如果发现订单已经支付，则立刻更新订单状态为已支付即可。
定时任务大家之前学习过，具体的实现这里就不再赘述了。</p>
<p>至此，消息可靠性的问题已经解决了。</p>
<p>综上，支付服务与交易服务之间的订单状态一致性是如何保证的？</p>
<ul>
<li>首先，支付服务会正在用户支付成功以后利用MQ消息通知交易服务，完成订单状态同步。</li>
<li>其次，为了保证MQ消息的可靠性，我们采用了生产者确认机制、消费者确认、消费者失败重试等策略，确保消息投递的可靠性</li>
<li>最后，我们还在交易服务设置了定时任务，定期查询订单支付状态。这样即便MQ通知失败，还可以利用定时任务作为兜底方案，确保订单支付状态的最终一致性。</li>
</ul>
<h1 id="_4-延迟消息" tabindex="-1"><a class="header-anchor" href="#_4-延迟消息"><span>4.延迟消息</span></a></h1>
<p>在电商的支付业务中，对于一些库存有限的商品，为了更好的用户体验，通常都会在用户下单时立刻扣减商品库存。例如电影院购票、高铁购票，下单后就会锁定座位资源，其他人无法重复购买。</p>
<p>但是这样就存在一个问题，假如用户下单后一直不付款，就会一直占有库存资源，导致其他客户无法正常交易，最终导致商户利益受损！</p>
<p>因此，电商中通常的做法就是：<strong>对于超过一定时间未支付的订单，应该立刻取消订单并释放占用的库存</strong>。</p>
<p>例如，订单支付超时时间为30分钟，则我们应该在用户下单后的第30分钟检查订单支付状态，如果发现未支付，应该立刻取消订单，释放库存。</p>
<p>但问题来了：如何才能准确的实现在下单后第30分钟去检查支付状态呢？</p>
<p>像这种在一段时间以后才执行的任务，我们称之为<strong>延迟任务</strong>，而要实现延迟任务，最简单的方案就是利用MQ的延迟消息了。</p>
<p>在RabbitMQ中实现延迟消息也有两种方案：</p>
<ul>
<li>死信交换机+TTL</li>
<li>延迟消息插件</li>
</ul>
<p>这一章我们就一起研究下这两种方案的实现方式，以及优缺点。</p>
<h2 id="_4-1-死信交换机和延迟消息" tabindex="-1"><a class="header-anchor" href="#_4-1-死信交换机和延迟消息"><span>4.1.死信交换机和延迟消息</span></a></h2>
<p>首先我们来学习一下基于死信交换机的延迟消息方案。</p>
<h3 id="_4-1-1-死信交换机" tabindex="-1"><a class="header-anchor" href="#_4-1-1-死信交换机"><span>4.1.1.死信交换机</span></a></h3>
<p>什么是死信？</p>
<p>当一个队列中的消息满足下列情况之一时，可以成为死信（dead letter）：</p>
<ul>
<li>消费者使用<code v-pre>basic.reject</code>或 <code v-pre>basic.nack</code>声明消费失败，并且消息的<code v-pre>requeue</code>参数设置为false</li>
<li>消息是一个过期消息，超时无人消费</li>
<li>要投递的队列消息满了，无法投递</li>
</ul>
<p>如果一个队列中的消息已经成为死信，并且这个队列通过<code v-pre>**dead-letter-exchange**</code>属性指定了一个交换机，那么队列中的死信就会投递到这个交换机中，而这个交换机就称为<strong>死信交换机</strong>（Dead Letter Exchange）。而此时加入有队列与死信交换机绑定，则最终死信就会被投递到这个队列中。</p>
<p>死信交换机有什么作用呢？</p>
<ol>
<li>收集那些因处理失败而被拒绝的消息</li>
<li>收集那些因队列满了而被拒绝的消息</li>
<li>收集因TTL（有效期）到期的消息</li>
</ol>
<h3 id="_4-1-2-延迟消息" tabindex="-1"><a class="header-anchor" href="#_4-1-2-延迟消息"><span>4.1.2.延迟消息</span></a></h3>
<p>前面两种作用场景可以看做是把死信交换机当做一种消息处理的最终兜底方案，与消费者重试时讲的<code v-pre>RepublishMessageRecoverer</code>作用类似。</p>
<p>而最后一种场景，大家设想一下这样的场景：
如图，有一组绑定的交换机（<code v-pre>ttl.fanout</code>）和队列（<code v-pre>ttl.queue</code>）。但是<code v-pre>ttl.queue</code>没有消费者监听，而是设定了死信交换机<code v-pre>hmall.direct</code>，而队列<code v-pre>direct.queue1</code>则与死信交换机绑定，RoutingKey是blue：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687573175803-41a1c870-93bc-4307-974f-891de1b5a42d.png#averageHue=%23faf3f2&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=340&amp;id=u380f1403&amp;originHeight=422&amp;originWidth=1301&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=59423&amp;status=done&amp;style=none&amp;taskId=ucbcde27e-d210-43e8-8e35-7557d121729&amp;title=&amp;width=1049.546184842849" alt="image.png" loading="lazy"></p>
<p>假如我们现在发送一条消息到<code v-pre>ttl.fanout</code>，RoutingKey为blue，并设置消息的<strong>有效期</strong>为5000毫秒：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687573506181-f0af9da1-0b0b-4cfb-afca-f5febb306cdf.png#averageHue=%23faf4f4&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=349&amp;id=u9604efe2&amp;originHeight=432&amp;originWidth=1421&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=60694&amp;status=done&amp;style=none&amp;taskId=u7e667f84-8779-47db-af73-7598ea5759e&amp;title=&amp;width=1146.3529044286615" alt="image.png" loading="lazy"></p>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意</strong>：尽管这里的<code v-pre>ttl.fanout</code>不需要RoutingKey，但是当消息变为死信并投递到死信交换机时，会沿用之前的RoutingKey，这样<code v-pre>hmall.direct</code>才能正确路由消息。</p>
</div>
<p>消息肯定会被投递到<code v-pre>ttl.queue</code>之后，由于没有消费者，因此消息无人消费。5秒之后，消息的有效期到期，成为死信：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687573747592-4d95dbb1-3f4d-4174-af24-124cb1346a81.png#averageHue=%23faf4f4&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=341&amp;id=u616ad2d4&amp;originHeight=423&amp;originWidth=1502&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=71956&amp;status=done&amp;style=none&amp;taskId=uf4c990b8-e00b-42c0-842d-efdd5485d43&amp;title=&amp;width=1211.6974401490847" alt="image.png" loading="lazy">
死信被再次投递到死信交换机<code v-pre>hmall.direct</code>，并沿用之前的RoutingKey，也就是<code v-pre>blue</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687573874094-ebf781c1-6273-474b-b0ed-17243d8370ae.png#averageHue=%23faf4f4&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=348&amp;id=u53622578&amp;originHeight=431&amp;originWidth=1421&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=63699&amp;status=done&amp;style=none&amp;taskId=u610a5adf-e615-4fa5-9c50-597a1be139a&amp;title=&amp;width=1146.3529044286615" alt="image.png" loading="lazy">
由于<code v-pre>direct.queue1</code>与<code v-pre>hmall.direct</code>绑定的key是blue，因此最终消息被成功路由到<code v-pre>direct.queue1</code>，如果此时有消费者与<code v-pre>direct.queue1</code>绑定， 也就能成功消费消息了。但此时已经是5秒钟以后了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687574086294-106fe14b-6652-4783-a6c3-3d722d1f5232.png#averageHue=%23fbf5f5&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=373&amp;id=ub429262c&amp;originHeight=462&amp;originWidth=1633&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=81718&amp;status=done&amp;style=none&amp;taskId=u244f2a30-7d51-48a2-969b-b880a7f2442&amp;title=&amp;width=1317.3781090302632" alt="image.png" loading="lazy">
也就是说，publisher发送了一条消息，但最终consumer在5秒后才收到消息。我们成功实现了<strong>延迟消息</strong>。</p>
<h3 id="_4-1-3-总结" tabindex="-1"><a class="header-anchor" href="#_4-1-3-总结"><span>4.1.3.总结</span></a></h3>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意：</strong>
RabbitMQ的消息过期是基于追溯方式来实现的，也就是说当一个消息的TTL到期以后不一定会被移除或投递到死信交换机，而是在消息恰好处于队首时才会被处理。
当队列中消息堆积很多的时候，过期消息可能不会被按时处理，因此你设置的TTL时间不一定准确。</p>
</div>
<h2 id="_4-2-delayexchange插件" tabindex="-1"><a class="header-anchor" href="#_4-2-delayexchange插件"><span>4.2.DelayExchange插件</span></a></h2>
<p>基于死信队列虽然可以实现延迟消息，但是太麻烦了。因此RabbitMQ社区提供了一个延迟消息插件来实现相同的效果。
官方文档说明：
<a href="https://blog.rabbitmq.com/posts/2015/04/scheduling-messages-with-rabbitmq" target="_blank" rel="noopener noreferrer">Scheduling Messages with RabbitMQ | RabbitMQ - Blog</a></p>
<h3 id="_4-2-1-下载" tabindex="-1"><a class="header-anchor" href="#_4-2-1-下载"><span>4.2.1.下载</span></a></h3>
<p>插件下载地址：
<a href="https://github.com/rabbitmq/rabbitmq-delayed-message-exchange" target="_blank" rel="noopener noreferrer">GitHub - rabbitmq/rabbitmq-delayed-message-exchange: Delayed Messaging for RabbitMQ</a>
由于我们安装的MQ是<code v-pre>3.8</code>版本，因此这里下载<code v-pre>3.8.17</code>版本：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687576610561-71355772-460c-4b7a-bf71-904b40bccdf9.png#averageHue=%23fdfdfd&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=722&amp;id=u54276885&amp;originHeight=895&amp;originWidth=1183&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=88481&amp;status=done&amp;style=none&amp;taskId=u3b769aca-ef34-4a2c-be13-6729ea0e832&amp;title=&amp;width=954.352910583467" alt="image.png" loading="lazy">
当然，也可以直接使用课前资料提供好的插件：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687611117405-f30b7216-cbef-44fc-a8a9-b62c50ef2a06.png#averageHue=%23f8f8f7&amp;clientId=ua8cb106d-b05e-4&amp;from=paste&amp;height=131&amp;id=u601c044f&amp;originHeight=163&amp;originWidth=855&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=15305&amp;status=done&amp;style=none&amp;taskId=uaae26ad5-bd00-4347-bc5c-5a16a006ef3&amp;title=&amp;width=689.7478770489131" alt="image.png" loading="lazy"></p>
<h3 id="_4-2-2-安装" tabindex="-1"><a class="header-anchor" href="#_4-2-2-安装"><span>4.2.2.安装</span></a></h3>
<p>因为我们是基于Docker安装，所以需要先查看RabbitMQ的插件目录对应的数据卷。</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code><span class="token function">docker</span> volume inspect mq-plugins
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>结果如下：</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code><span class="token punctuation">[</span>
    <span class="token punctuation">{</span>
        <span class="token string">"CreatedAt"</span><span class="token builtin class-name">:</span> <span class="token string">"2024-06-19T09:22:59+08:00"</span>,
        <span class="token string">"Driver"</span><span class="token builtin class-name">:</span> <span class="token string">"local"</span>,
        <span class="token string">"Labels"</span><span class="token builtin class-name">:</span> null,
        <span class="token string">"Mountpoint"</span><span class="token builtin class-name">:</span> <span class="token string">"/var/lib/docker/volumes/mq-plugins/_data"</span>,
        <span class="token string">"Name"</span><span class="token builtin class-name">:</span> <span class="token string">"mq-plugins"</span>,
        <span class="token string">"Options"</span><span class="token builtin class-name">:</span> null,
        <span class="token string">"Scope"</span><span class="token builtin class-name">:</span> <span class="token string">"local"</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">]</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>插件目录被挂载到了<code v-pre>/var/lib/docker/volumes/mq-plugins/_data</code>这个目录，我们上传插件到该目录下。</p>
<p>接下来执行命令，安装插件：</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code><span class="token function">docker</span> <span class="token builtin class-name">exec</span> <span class="token parameter variable">-it</span> mq rabbitmq-plugins <span class="token builtin class-name">enable</span> rabbitmq_delayed_message_exchange
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>运行结果如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687576988700-43b5d4ad-a77c-4463-bea4-4f3c0888ebe5.png#averageHue=%23031f33&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=428&amp;id=u46bbc0d8&amp;originHeight=530&amp;originWidth=1456&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=64423&amp;status=done&amp;style=none&amp;taskId=uecc0751f-db71-4d55-86a5-c859569b939&amp;title=&amp;width=1174.58819764119" alt="image.png" loading="lazy"></p>
<h3 id="_4-2-3-声明延迟交换机" tabindex="-1"><a class="header-anchor" href="#_4-2-3-声明延迟交换机"><span>4.2.3.声明延迟交换机</span></a></h3>
<p>基于注解方式：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
        value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"delay.queue"</span><span class="token punctuation">,</span> durable <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
        exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"delay.direct"</span><span class="token punctuation">,</span> delayed <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
        key <span class="token operator">=</span> <span class="token string">"delay"</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenDelayMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"接收到delay.queue的延迟消息：{}"</span><span class="token punctuation">,</span> msg<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>基于<code v-pre>@Bean</code>的方式：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span>extern<span class="token punctuation">.</span>slf4j<span class="token punctuation">.</span></span><span class="token class-name">Slf4j</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token operator">*</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Bean</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Slf4j</span>
<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">DelayExchangeConfig</span> <span class="token punctuation">{</span>

    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">DirectExchange</span> <span class="token function">delayExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">ExchangeBuilder</span>
                <span class="token punctuation">.</span><span class="token function">directExchange</span><span class="token punctuation">(</span><span class="token string">"delay.direct"</span><span class="token punctuation">)</span> <span class="token comment">// 指定交换机类型和名称</span>
                <span class="token punctuation">.</span><span class="token function">delayed</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token comment">// 设置delay的属性为true</span>
                <span class="token punctuation">.</span><span class="token function">durable</span><span class="token punctuation">(</span><span class="token boolean">true</span><span class="token punctuation">)</span> <span class="token comment">// 持久化</span>
                <span class="token punctuation">.</span><span class="token function">build</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">delayedQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"delay.queue"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">delayQueueBinding</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span><span class="token function">delayedQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span><span class="token function">delayExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"delay"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4-2-4-发送延迟消息" tabindex="-1"><a class="header-anchor" href="#_4-2-4-发送延迟消息"><span>4.2.4.发送延迟消息</span></a></h3>
<p>发送消息时，必须通过x-delay属性设定延迟时间：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">void</span> <span class="token function">testPublisherDelayMessage</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 1.创建消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"hello, delayed message"</span><span class="token punctuation">;</span>
    <span class="token comment">// 2.发送消息，利用消息后置处理器添加消息头</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span><span class="token string">"delay.direct"</span><span class="token punctuation">,</span> <span class="token string">"delay"</span><span class="token punctuation">,</span> message<span class="token punctuation">,</span> <span class="token keyword">new</span> <span class="token class-name">MessagePostProcessor</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token annotation punctuation">@Override</span>
        <span class="token keyword">public</span> <span class="token class-name">Message</span> <span class="token function">postProcessMessage</span><span class="token punctuation">(</span><span class="token class-name">Message</span> message<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">AmqpException</span> <span class="token punctuation">{</span>
            <span class="token comment">// 添加延迟消息属性</span>
            message<span class="token punctuation">.</span><span class="token function">getMessageProperties</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">setDelay</span><span class="token punctuation">(</span><span class="token number">5000</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token keyword">return</span> message<span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
    <span class="token punctuation">}</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意：</strong>
延迟消息插件内部会维护一个本地数据库表，同时使用Elang Timers功能实现计时。如果消息的延迟时间设置较长，可能会导致堆积的延迟消息非常多，会带来较大的CPU开销，同时延迟消息的时间会存在误差。
因此，<strong>不建议设置延迟时间过长的延迟消息</strong>。</p>
</div>
<h2 id="_4-5-订单状态同步问题" tabindex="-1"><a class="header-anchor" href="#_4-5-订单状态同步问题"><span>4.5.订单状态同步问题</span></a></h2>
<p>接下来，我们就在交易服务中利用延迟消息实现订单支付状态的同步。其大概思路如下：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1690343275577-b0f99b4a-40e2-40cf-8da2-11f0dfbd7d7c.jpeg" alt="" loading="lazy"></p>
<p>假如订单超时支付时间为30分钟，理论上说我们应该在下单时发送一条延迟消息，延迟时间为30分钟。这样就可以在接收到消息时检验订单支付状态，关闭未支付订单。
但是大多数情况下用户支付都会在1分钟内完成，我们发送的消息却要在MQ中停留30分钟，额外消耗了MQ的资源。因此，我们最好多检测几次订单支付状态，而不是在最后第30分钟才检测。
例如：我们在用户下单后的第10秒、20秒、30秒、45秒、60秒、1分30秒、2分、...30分分别设置延迟消息，如果提前发现订单已经支付，则后续的检测取消即可。
这样就可以有效避免对MQ资源的浪费了。</p>
<p>优化后的实现思路如下：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687593452790-58e296b7-0761-40f6-b4be-9c19bff9cd3e.jpeg" alt="" loading="lazy"></p>
<p>由于我们要多次发送延迟消息，因此需要先定义一个记录消息延迟时间的消息体，处于通用性考虑，我们将其定义到<code v-pre>hm-common</code>模块下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687593306116-2a41b7c0-064c-463f-b109-fa05db8609e8.png#averageHue=%23f9fbf8&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=402&amp;id=ueaa6d986&amp;originHeight=498&amp;originWidth=944&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=48824&amp;status=done&amp;style=none&amp;taskId=u025bcf5a-23cc-4146-8ecc-1f6a7126c60&amp;title=&amp;width=761.5461940750573" alt="image.png" loading="lazy">
代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>common<span class="token punctuation">.</span>domain</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>common<span class="token punctuation">.</span>utils<span class="token punctuation">.</span></span><span class="token class-name">CollUtils</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span></span><span class="token class-name">Data</span></span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">java<span class="token punctuation">.</span>util<span class="token punctuation">.</span></span><span class="token class-name">List</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Data</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">MultiDelayMessage</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">T</span><span class="token punctuation">></span></span> <span class="token punctuation">{</span>
    <span class="token doc-comment comment">/**
     * 消息体
     */</span>
    <span class="token keyword">private</span> <span class="token class-name">T</span> data<span class="token punctuation">;</span>
    <span class="token doc-comment comment">/**
     * 记录延迟时间的集合
     */</span>
    <span class="token keyword">private</span> <span class="token class-name">List</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Long</span><span class="token punctuation">></span></span> delayMillis<span class="token punctuation">;</span>

    <span class="token keyword">public</span> <span class="token class-name">MultiDelayMessage</span><span class="token punctuation">(</span><span class="token class-name">T</span> data<span class="token punctuation">,</span> <span class="token class-name">List</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Long</span><span class="token punctuation">></span></span> delayMillis<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">this</span><span class="token punctuation">.</span>data <span class="token operator">=</span> data<span class="token punctuation">;</span>
        <span class="token keyword">this</span><span class="token punctuation">.</span>delayMillis <span class="token operator">=</span> delayMillis<span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">T</span><span class="token punctuation">></span></span> <span class="token class-name">MultiDelayMessage</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">T</span><span class="token punctuation">></span></span> <span class="token function">of</span><span class="token punctuation">(</span><span class="token class-name">T</span> data<span class="token punctuation">,</span> <span class="token class-name">Long</span> <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span> delayMillis<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">MultiDelayMessage</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token punctuation">></span></span><span class="token punctuation">(</span>data<span class="token punctuation">,</span> <span class="token class-name">CollUtils</span><span class="token punctuation">.</span><span class="token function">newArrayList</span><span class="token punctuation">(</span>delayMillis<span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 获取并移除下一个延迟时间
     * <span class="token keyword">@return</span> 队列中的第一个延迟时间
     */</span>
    <span class="token keyword">public</span> <span class="token class-name">Long</span> <span class="token function">removeNextDelay</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> delayMillis<span class="token punctuation">.</span><span class="token function">remove</span><span class="token punctuation">(</span><span class="token number">0</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 是否还有下一个延迟时间
     */</span>
    <span class="token keyword">public</span> <span class="token keyword">boolean</span> <span class="token function">hasNextDelay</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token operator">!</span>delayMillis<span class="token punctuation">.</span><span class="token function">isEmpty</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4-5-1-定义常量" tabindex="-1"><a class="header-anchor" href="#_4-5-1-定义常量"><span>4.5.1.定义常量</span></a></h3>
<p>无论是消息发送还是接收都是在交易服务完成，因此我们在<code v-pre>trade-service</code>中定义一个常量类，用于记录交换机、队列、RoutingKey等常量：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687593919687-52eb9aa6-6f80-4b49-ba32-bb608018e333.png#averageHue=%23f9fbf8&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=328&amp;id=ufb3e5a13&amp;originHeight=406&amp;originWidth=913&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=38538&amp;status=done&amp;style=none&amp;taskId=u54275307-b948-433e-b531-bdf3fc84fac&amp;title=&amp;width=736.5377915153891" alt="image.png" loading="lazy">
内容如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>constants</span><span class="token punctuation">;</span>

<span class="token keyword">public</span> <span class="token keyword">interface</span> <span class="token class-name">MqConstants</span> <span class="token punctuation">{</span>
    <span class="token class-name">String</span> <span class="token constant">DELAY_EXCHANGE</span> <span class="token operator">=</span> <span class="token string">"trade.delay.topic"</span><span class="token punctuation">;</span>
    <span class="token class-name">String</span> <span class="token constant">DELAY_ORDER_QUEUE</span> <span class="token operator">=</span> <span class="token string">"trade.order.delay.queue"</span><span class="token punctuation">;</span>
    <span class="token class-name">String</span> <span class="token constant">DELAY_ORDER_ROUTING_KEY</span> <span class="token operator">=</span> <span class="token string">"order.query"</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4-5-2-抽取共享mq配置" tabindex="-1"><a class="header-anchor" href="#_4-5-2-抽取共享mq配置"><span>4.5.2.抽取共享mq配置</span></a></h3>
<p>我们将mq的配置抽取到nacos中，方便各个微服务共享配置。
在nacos中定义一个名为<code v-pre>shared-mq.xml</code>的配置文件，内容如下：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">host</span><span class="token punctuation">:</span> $<span class="token punctuation">{</span>hm.mq.host<span class="token punctuation">:</span>192.168.150.101<span class="token punctuation">}</span> <span class="token comment"># 主机名</span>
    <span class="token key atrule">port</span><span class="token punctuation">:</span> $<span class="token punctuation">{</span>hm.mq.port<span class="token punctuation">:</span><span class="token number">5672</span><span class="token punctuation">}</span> <span class="token comment"># 端口</span>
    <span class="token key atrule">virtual-host</span><span class="token punctuation">:</span> $<span class="token punctuation">{</span>hm.mq.vhost<span class="token punctuation">:</span>/hmall<span class="token punctuation">}</span> <span class="token comment"># 虚拟主机</span>
    <span class="token key atrule">username</span><span class="token punctuation">:</span> $<span class="token punctuation">{</span>hm.mq.un<span class="token punctuation">:</span>hmall<span class="token punctuation">}</span> <span class="token comment"># 用户名</span>
    <span class="token key atrule">password</span><span class="token punctuation">:</span> $<span class="token punctuation">{</span>hm.mq.pw<span class="token punctuation">:</span><span class="token number">123</span><span class="token punctuation">}</span> <span class="token comment"># 密码</span>
    <span class="token key atrule">listener</span><span class="token punctuation">:</span>
      <span class="token key atrule">simple</span><span class="token punctuation">:</span>
        <span class="token key atrule">prefetch</span><span class="token punctuation">:</span> <span class="token number">1</span> <span class="token comment"># 每次只能获取一条消息，处理完成才能获取下一个消息</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这里只添加一些基础配置，至于生产者确认，消费者确认配置则由微服务根据业务自己决定。</p>
<p>在<code v-pre>trade-service</code>模块添加共享配置：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687595291593-378450c1-ef00-4cbf-9be8-235d1eea8e7c.png#averageHue=%23f6f9f5&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=515&amp;id=uc4ebf7e5&amp;originHeight=638&amp;originWidth=952&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=129257&amp;status=done&amp;style=none&amp;taskId=uc6221e28-aa92-49da-bc73-1ff8258fda5&amp;title=&amp;width=767.9999753807781" alt="image.png" loading="lazy"></p>
<h3 id="_4-5-3-改造下单业务" tabindex="-1"><a class="header-anchor" href="#_4-5-3-改造下单业务"><span>4.5.3.改造下单业务</span></a></h3>
<p>接下来，我们改造下单业务，在下单完成后，发送延迟消息，查询支付状态。</p>
<p>1）引入依赖
在<code v-pre>trade-service</code>模块的<code v-pre>pom.xml</code>中引入amqp的依赖：</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code>  <span class="token comment">&lt;!--amqp--></span>
  <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
      <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
      <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-amqp<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
  <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2）改造下单业务
修改<code v-pre>trade-service</code>模块的<code v-pre>com.hmall.trade.service.impl.OrderServiceImpl</code>类的<code v-pre>createOrder</code>方法，添加消息发送的代码：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687595921876-005c46d9-4278-411b-bfc1-c5e545949cd5.png#averageHue=%23f6f8f4&amp;clientId=u76b62a19-f8dc-4&amp;from=paste&amp;height=496&amp;id=u29260a5b&amp;originHeight=615&amp;originWidth=1668&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=182037&amp;status=done&amp;style=none&amp;taskId=udb3ccb23-163c-406d-9d8c-bc7087da8f1&amp;title=&amp;width=1345.6134022427918" alt="image.png" loading="lazy"></p>
<h3 id="_4-5-4-编写查询支付状态接口" tabindex="-1"><a class="header-anchor" href="#_4-5-4-编写查询支付状态接口"><span>4.5.4.编写查询支付状态接口</span></a></h3>
<p>由于MQ消息处理时需要查询支付状态，因此我们要在pay-service模块定义一个这样的接口，并提供对应的FeignClient.
首先，在hm-api模块定义三个类：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1690352506454-23b445b7-3a34-458e-bba2-47528a06ea65.png#averageHue=%23f9fbf7&amp;clientId=u835b609d-4d58-4&amp;from=paste&amp;height=562&amp;id=ud6c48d2c&amp;originHeight=627&amp;originWidth=875&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=63061&amp;status=done&amp;style=none&amp;taskId=u8487842b-c38a-48a4-9a27-3ed9692d7d8&amp;title=&amp;width=784.3137087287431" alt="image.png" loading="lazy">
说明：</p>
<ul>
<li>PayOrderDTO：支付单的数据传输实体</li>
<li>PayClient：支付系统的Feign客户端</li>
<li>PayClientFallback：支付系统的fallback逻辑</li>
</ul>
<p>PayOrderDTO代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>dto</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">io<span class="token punctuation">.</span>swagger<span class="token punctuation">.</span>annotations<span class="token punctuation">.</span></span><span class="token class-name">ApiModel</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">io<span class="token punctuation">.</span>swagger<span class="token punctuation">.</span>annotations<span class="token punctuation">.</span></span><span class="token class-name">ApiModelProperty</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span></span><span class="token class-name">Data</span></span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">java<span class="token punctuation">.</span>time<span class="token punctuation">.</span></span><span class="token class-name">LocalDateTime</span></span><span class="token punctuation">;</span>

<span class="token doc-comment comment">/**
 * <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>p</span><span class="token punctuation">></span></span>
 * 支付订单
 * <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>p</span><span class="token punctuation">></span></span>
 */</span>
<span class="token annotation punctuation">@Data</span>
<span class="token annotation punctuation">@ApiModel</span><span class="token punctuation">(</span>description <span class="token operator">=</span> <span class="token string">"支付单数据传输实体"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">PayOrderDTO</span> <span class="token punctuation">{</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"id"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Long</span> id<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"业务订单号"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Long</span> bizOrderNo<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付单号"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Long</span> payOrderNo<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付用户id"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Long</span> bizUserId<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付渠道编码"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">String</span> payChannelCode<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付金额，单位分"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Integer</span> amount<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"付类型，1：h5,2:小程序，3：公众号，4：扫码，5：余额支付"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Integer</span> payType<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"付状态，0：待提交，1:待支付，2：支付超时或取消，3：支付成功"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">Integer</span> status<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"拓展字段，用于传递不同渠道单独处理的字段"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">String</span> expandJson<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"第三方返回业务码"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">String</span> resultCode<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"第三方返回提示信息"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">String</span> resultMsg<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付成功时间"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">LocalDateTime</span> paySuccessTime<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付超时时间"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">LocalDateTime</span> payOverTime<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"支付二维码链接"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">String</span> qrCodeUrl<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"创建时间"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">LocalDateTime</span> createTime<span class="token punctuation">;</span>
    <span class="token annotation punctuation">@ApiModelProperty</span><span class="token punctuation">(</span><span class="token string">"更新时间"</span><span class="token punctuation">)</span>
    <span class="token keyword">private</span> <span class="token class-name">LocalDateTime</span> updateTime<span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>PayClient代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>client</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>client<span class="token punctuation">.</span>fallback<span class="token punctuation">.</span></span><span class="token class-name">PayClientFallback</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>dto<span class="token punctuation">.</span></span><span class="token class-name">PayOrderDTO</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>cloud<span class="token punctuation">.</span>openfeign<span class="token punctuation">.</span></span><span class="token class-name">FeignClient</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>web<span class="token punctuation">.</span>bind<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">GetMapping</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>web<span class="token punctuation">.</span>bind<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">PathVariable</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@FeignClient</span><span class="token punctuation">(</span>value <span class="token operator">=</span> <span class="token string">"pay-service"</span><span class="token punctuation">,</span> fallbackFactory <span class="token operator">=</span> <span class="token class-name">PayClientFallback</span><span class="token punctuation">.</span><span class="token keyword">class</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">interface</span> <span class="token class-name">PayClient</span> <span class="token punctuation">{</span>
    <span class="token doc-comment comment">/**
     * 根据交易订单id查询支付单
     * <span class="token keyword">@param</span> <span class="token parameter">id</span> 业务订单id
     * <span class="token keyword">@return</span> 支付单信息
     */</span>
    <span class="token annotation punctuation">@GetMapping</span><span class="token punctuation">(</span><span class="token string">"/pay-orders/biz/{id}"</span><span class="token punctuation">)</span>
    <span class="token class-name">PayOrderDTO</span> <span class="token function">queryPayOrderByBizOrderNo</span><span class="token punctuation">(</span><span class="token annotation punctuation">@PathVariable</span><span class="token punctuation">(</span><span class="token string">"id"</span><span class="token punctuation">)</span> <span class="token class-name">Long</span> id<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>PayClientFallback代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>client<span class="token punctuation">.</span>fallback</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>client<span class="token punctuation">.</span></span><span class="token class-name">PayClient</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>dto<span class="token punctuation">.</span></span><span class="token class-name">PayOrderDTO</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span>extern<span class="token punctuation">.</span>slf4j<span class="token punctuation">.</span></span><span class="token class-name">Slf4j</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>cloud<span class="token punctuation">.</span>openfeign<span class="token punctuation">.</span></span><span class="token class-name">FallbackFactory</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Slf4j</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">PayClientFallback</span> <span class="token keyword">implements</span> <span class="token class-name">FallbackFactory</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">PayClient</span><span class="token punctuation">></span></span> <span class="token punctuation">{</span>
    <span class="token annotation punctuation">@Override</span>
    <span class="token keyword">public</span> <span class="token class-name">PayClient</span> <span class="token function">create</span><span class="token punctuation">(</span><span class="token class-name">Throwable</span> cause<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">PayClient</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token annotation punctuation">@Override</span>
            <span class="token keyword">public</span> <span class="token class-name">PayOrderDTO</span> <span class="token function">queryPayOrderByBizOrderNo</span><span class="token punctuation">(</span><span class="token class-name">Long</span> id<span class="token punctuation">)</span> <span class="token punctuation">{</span>
                <span class="token keyword">return</span> <span class="token keyword">null</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span>
        <span class="token punctuation">}</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>最后，在pay-service模块的PayController中实现该接口：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@ApiOperation</span><span class="token punctuation">(</span><span class="token string">"根据id查询支付单"</span><span class="token punctuation">)</span>
<span class="token annotation punctuation">@GetMapping</span><span class="token punctuation">(</span><span class="token string">"/biz/{id}"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token class-name">PayOrderDTO</span> <span class="token function">queryPayOrderByBizOrderNo</span><span class="token punctuation">(</span><span class="token annotation punctuation">@PathVariable</span><span class="token punctuation">(</span><span class="token string">"id"</span><span class="token punctuation">)</span> <span class="token class-name">Long</span> id<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">PayOrder</span> payOrder <span class="token operator">=</span> payOrderService<span class="token punctuation">.</span><span class="token function">lambdaQuery</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">eq</span><span class="token punctuation">(</span><span class="token class-name">PayOrder</span><span class="token operator">::</span><span class="token function">getBizOrderNo</span><span class="token punctuation">,</span> id<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">one</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">return</span> <span class="token class-name">BeanUtils</span><span class="token punctuation">.</span><span class="token function">copyBean</span><span class="token punctuation">(</span>payOrder<span class="token punctuation">,</span> <span class="token class-name">PayOrderDTO</span><span class="token punctuation">.</span><span class="token keyword">class</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4-5-5-消息监听" tabindex="-1"><a class="header-anchor" href="#_4-5-5-消息监听"><span>4.5.5.消息监听</span></a></h3>
<p>接下来，我们在trader-service编写一个监听器，监听延迟消息，查询订单支付状态：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1690343618777-60200e66-3734-439b-91fe-db8ea3eba148.png#averageHue=%23f9fbf8&amp;clientId=u8e4bad19-60cd-4&amp;from=paste&amp;height=473&amp;id=u1b34de9f&amp;originHeight=528&amp;originWidth=775&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=50673&amp;status=done&amp;style=none&amp;taskId=u3f7707e8-1cb4-4f00-9175-570265974eb&amp;title=&amp;width=694.677856302601" alt="image.png" loading="lazy">
代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>listener</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>client<span class="token punctuation">.</span></span><span class="token class-name">PayClient</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>api<span class="token punctuation">.</span>dto<span class="token punctuation">.</span></span><span class="token class-name">PayOrderDTO</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>common<span class="token punctuation">.</span>domain<span class="token punctuation">.</span></span><span class="token class-name">MultiDelayMessage</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>constants<span class="token punctuation">.</span></span><span class="token class-name">MqConstants</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>domain<span class="token punctuation">.</span>po<span class="token punctuation">.</span></span><span class="token class-name">Order</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>service<span class="token punctuation">.</span></span><span class="token class-name">IOrderService</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span></span><span class="token class-name">RequiredArgsConstructor</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span>extern<span class="token punctuation">.</span>slf4j<span class="token punctuation">.</span></span><span class="token class-name">Slf4j</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">ExchangeTypes</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Exchange</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Queue</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">QueueBinding</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">RabbitListener</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">RabbitTemplate</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>stereotype<span class="token punctuation">.</span></span><span class="token class-name">Component</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Slf4j</span>
<span class="token annotation punctuation">@Component</span>
<span class="token annotation punctuation">@RequiredArgsConstructor</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">OrderStatusListener</span> <span class="token punctuation">{</span>

    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">IOrderService</span> orderService<span class="token punctuation">;</span>

    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">PayClient</span> payClient<span class="token punctuation">;</span>

    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">;</span>

    <span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
            value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token class-name">MqConstants</span><span class="token punctuation">.</span><span class="token constant">DELAY_ORDER_QUEUE</span><span class="token punctuation">,</span> durable <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
            exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token class-name">MqConstants</span><span class="token punctuation">.</span><span class="token constant">DELAY_EXCHANGE</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">TOPIC</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
            key <span class="token operator">=</span> <span class="token class-name">MqConstants</span><span class="token punctuation">.</span><span class="token constant">DELAY_ORDER_ROUTING_KEY</span>
    <span class="token punctuation">)</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenOrderCheckDelayMessage</span><span class="token punctuation">(</span><span class="token class-name">MultiDelayMessage</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Long</span><span class="token punctuation">></span></span> msg<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 1.获取消息中的订单id</span>
        <span class="token class-name">Long</span> orderId <span class="token operator">=</span> msg<span class="token punctuation">.</span><span class="token function">getData</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token comment">// 2.查询订单，判断状态：1是未支付，大于1则是已支付或已关闭</span>
        <span class="token class-name">Order</span> order <span class="token operator">=</span> orderService<span class="token punctuation">.</span><span class="token function">getById</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>order <span class="token operator">==</span> <span class="token keyword">null</span> <span class="token operator">||</span> order<span class="token punctuation">.</span><span class="token function">getStatus</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">></span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 订单不存在或交易已经结束，放弃处理</span>
            <span class="token keyword">return</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token comment">// 3.可能是未支付，查询支付服务</span>
        <span class="token class-name">PayOrderDTO</span> payOrder <span class="token operator">=</span> payClient<span class="token punctuation">.</span><span class="token function">queryPayOrderByBizOrderNo</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>payOrder <span class="token operator">!=</span> <span class="token keyword">null</span> <span class="token operator">&amp;&amp;</span> payOrder<span class="token punctuation">.</span><span class="token function">getStatus</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">3</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 支付成功，更新订单状态</span>
            orderService<span class="token punctuation">.</span><span class="token function">markOrderPaySuccess</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token keyword">return</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token comment">// 4.确定未支付，判断是否还有剩余延迟时间</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>msg<span class="token punctuation">.</span><span class="token function">hasNextDelay</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 4.1.有延迟时间，需要重发延迟消息，先获取延迟时间的int值</span>
            <span class="token keyword">int</span> delayVal <span class="token operator">=</span> msg<span class="token punctuation">.</span><span class="token function">removeNextDelay</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">intValue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token comment">// 4.2.发送延迟消息</span>
            rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span><span class="token class-name">MqConstants</span><span class="token punctuation">.</span><span class="token constant">DELAY_EXCHANGE</span><span class="token punctuation">,</span> <span class="token class-name">MqConstants</span><span class="token punctuation">.</span><span class="token constant">DELAY_ORDER_ROUTING_KEY</span><span class="token punctuation">,</span> msg<span class="token punctuation">,</span>
                    message <span class="token operator">-></span> <span class="token punctuation">{</span>
                        message<span class="token punctuation">.</span><span class="token function">getMessageProperties</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">setDelay</span><span class="token punctuation">(</span>delayVal<span class="token punctuation">)</span><span class="token punctuation">;</span>
                        <span class="token keyword">return</span> message<span class="token punctuation">;</span>
                    <span class="token punctuation">}</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token keyword">return</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token comment">// 5.没有剩余延迟时间了，说明订单超时未支付，需要取消订单</span>
        orderService<span class="token punctuation">.</span><span class="token function">cancelOrder</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意，这里要在OrderServiceImpl中实现cancelOrder方法，留作作业大家自行实现。</p>
<h1 id="_5-作业" tabindex="-1"><a class="header-anchor" href="#_5-作业"><span>5.作业</span></a></h1>
<h2 id="_5-1-取消订单" tabindex="-1"><a class="header-anchor" href="#_5-1-取消订单"><span>5.1.取消订单</span></a></h2>
<p>在处理超时未支付订单时，如果发现订单确实超时未支付，最终需要关闭该订单。
关闭订单需要完成两件事情：</p>
<ul>
<li>将订单状态修改为已关闭</li>
<li>恢复订单中已经扣除的库存</li>
</ul>
<p>这部分功能尚未实现。
大家要在<code v-pre>IOrderService</code>接口中定义<code v-pre>cancelOrder</code>方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">void</span> <span class="token function">cancelOrder</span><span class="token punctuation">(</span><span class="token class-name">Long</span> orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>并且在<code v-pre>OrderServiceImpl</code>中实现该方法。实现过程中要注意业务幂等性判断。</p>
<h2 id="_5-2-抽取mq工具" tabindex="-1"><a class="header-anchor" href="#_5-2-抽取mq工具"><span>5.2.抽取MQ工具</span></a></h2>
<p>MQ在企业开发中的常见应用我们就学习完毕了，除了收发消息以外，消息可靠性的处理、生产者确认、消费者确认、延迟消息等等编码还是相对比较复杂的。
因此，我们需要将这些常用的操作封装为工具，方便在项目中使用。要求如下：</p>
<ul>
<li>在<code v-pre>hm-commom</code>模块下编写发送消息的工具类<code v-pre>RabbitMqHelper</code></li>
<li>定义一个自动配置类<code v-pre>MqConsumeErrorAutoConfiguration</code>，内容包括：
<ul>
<li>声明一个交换机，名为<code v-pre>error.direct</code>，类型为<code v-pre>direct</code></li>
<li>声明一个队列，名为：<code v-pre>微服务名 + error.queue</code>，也就是说要动态获取</li>
<li>将队列与交换机绑定，绑定时的<code v-pre>RoutingKey</code>就是<code v-pre>微服务名</code></li>
<li>声明<code v-pre>RepublishMessageRecoverer</code>，消费失败消息投递到上述交换机</li>
<li>给配置类添加条件，当<code v-pre>spring.rabbitmq.listener.simple.retry.enabled</code>为<code v-pre>true</code>时触发</li>
</ul>
</li>
</ul>
<p>RabbitMqHelper的结构如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">RabbitMqHelper</span> <span class="token punctuation">{</span>

    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">;</span>

    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">sendMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> exchange<span class="token punctuation">,</span> <span class="token class-name">String</span> routingKey<span class="token punctuation">,</span> <span class="token class-name">Object</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>

    <span class="token punctuation">}</span>

    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">sendDelayMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> exchange<span class="token punctuation">,</span> <span class="token class-name">String</span> routingKey<span class="token punctuation">,</span> <span class="token class-name">Object</span> msg<span class="token punctuation">,</span> <span class="token keyword">int</span> delay<span class="token punctuation">)</span><span class="token punctuation">{</span>

    <span class="token punctuation">}</span>

    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">sendMessageWithConfirm</span><span class="token punctuation">(</span><span class="token class-name">String</span> exchange<span class="token punctuation">,</span> <span class="token class-name">String</span> routingKey<span class="token punctuation">,</span> <span class="token class-name">Object</span> msg<span class="token punctuation">,</span> <span class="token keyword">int</span> maxRetries<span class="token punctuation">)</span><span class="token punctuation">{</span>
        
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_5-3-改造业务" tabindex="-1"><a class="header-anchor" href="#_5-3-改造业务"><span>5.3.改造业务</span></a></h2>
<p>利用你编写的工具，改造支付服务、购物车服务、交易服务中消息发送功能，并且添加消息确认或消费者重试机制，确保消息的可靠性。</p>
</div></template>


