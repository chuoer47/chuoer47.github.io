<template><div><p>微服务一旦拆分，必然涉及到服务之间的相互调用，目前我们服务之间调用采用的都是基于OpenFeign的调用。这种调用中，调用者发起请求后需要<strong>等待</strong>服务提供者执行业务返回结果后，才能继续执行后面的业务。也就是说调用者在调用过程中处于阻塞状态，因此我们成这种调用方式为<strong>同步调用</strong>，也可以叫<strong>同步通讯</strong>。但在很多场景下，我们可能需要采用<strong>异步通讯</strong>的方式，为什么呢？</p>
<p>我们先来看看什么是同步通讯和异步通讯。如图：</p>
<p><img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1686983181054-f2bcce85-1fce-412f-95cd-1ae829f8406f.png#averageHue=%239dce6d&amp;clientId=uf9c47826-2719-4&amp;from=paste&amp;height=613&amp;id=u84c8f02e&amp;originHeight=760&amp;originWidth=1695&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=112976&amp;status=done&amp;style=none&amp;taskId=u779e4d59-c9a8-4b1f-a49f-59c578c4ccd&amp;title=&amp;width=1367.3949141495996" alt="image.png" loading="lazy">
解读：</p>
<ul>
<li>同步通讯：就如同打视频电话，双方的交互都是实时的。因此同一时刻你只能跟一个人打视频电话。</li>
<li>异步通讯：就如同发微信聊天，双方的交互不是实时的，你不需要立刻给对方回应。因此你可以多线操作，同时跟多人聊天。</li>
</ul>
<p>两种方式各有优劣，打电话可以立即得到响应，但是你却不能跟多个人同时通话。发微信可以同时与多个人收发微信，但是往往响应会有延迟。</p>
<p>所以，如果我们的业务需要实时得到服务提供方的响应，则应该选择同步通讯（同步调用）。而如果我们追求更高的效率，并且不需要实时响应，则应该选择异步通讯（异步调用）。</p>
<p>同步调用的方式我们已经学过了，之前的OpenFeign调用就是。但是：</p>
<ul>
<li>异步调用又该如何实现？</li>
<li>哪些业务适合用异步调用来实现呢？</li>
</ul>
<p>通过今天的学习你就能明白这些问题了。</p>
<h1 id="_1-初识mq" tabindex="-1"><a class="header-anchor" href="#_1-初识mq"><span>1.初识MQ</span></a></h1>
<h2 id="_1-1-同步调用" tabindex="-1"><a class="header-anchor" href="#_1-1-同步调用"><span>1.1.同步调用</span></a></h2>
<p>之前说过，我们现在基于OpenFeign的调用都属于是同步调用，那么这种方式存在哪些问题呢？
举个例子，我们以昨天留给大家作为作业的<strong>余额支付功能</strong>为例来分析，首先看下整个流程：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686989758652-29a64761-c029-4ec4-91aa-f1fc85de086c.jpeg" alt="" loading="lazy">
目前我们采用的是基于OpenFeign的同步调用，也就是说业务执行流程是这样的：</p>
<ul>
<li>支付服务需要先调用用户服务完成余额扣减</li>
<li>然后支付服务自己要更新支付流水单的状态</li>
<li>然后支付服务调用交易服务，更新业务订单状态为已支付</li>
</ul>
<p>三个步骤依次执行。
这其中就存在3个问题：
<strong>第一</strong>，<strong>拓展性差</strong>
我们目前的业务相对简单，但是随着业务规模扩大，产品的功能也在不断完善。
在大多数电商业务中，用户支付成功后都会以短信或者其它方式通知用户，告知支付成功。假如后期产品经理提出这样新的需求，你怎么办？是不是要在上述业务中再加入通知用户的业务？
某些电商项目中，还会有积分或金币的概念。假如产品经理提出需求，用户支付成功后，给用户以积分奖励或者返还金币，你怎么办？是不是要在上述业务中再加入积分业务、返还金币业务？
。。。
最终你的支付业务会越来越臃肿：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686984472076-c05b2155-3346-40f5-b85e-5961caa998ab.jpeg" alt="" loading="lazy">
也就是说每次有新的需求，现有支付逻辑都要跟着变化，代码经常变动，不符合开闭原则，拓展性不好。</p>
<p><strong>第二</strong>，<strong>性能下降</strong>
由于我们采用了同步调用，调用者需要等待服务提供者执行完返回结果后，才能继续向下执行，也就是说每次远程调用，调用者都是阻塞等待状态。最终整个业务的响应时长就是每次远程调用的执行时长之和：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686989760653-42e1ae3e-677b-4f27-b55a-eaa259f03ad3.jpeg" alt="" loading="lazy">
假如每个微服务的执行时长都是50ms，则最终整个业务的耗时可能高达300ms，性能太差了。</p>
<p><strong>第三，级联失败</strong>
由于我们是基于OpenFeign调用交易服务、通知服务。当交易服务、通知服务出现故障时，整个事务都会回滚，交易失败。
这其实就是同步调用的<strong>级联失败</strong>问题。</p>
<p>但是大家思考一下，我们假设用户余额充足，扣款已经成功，此时我们应该确保支付流水单更新为已支付，确保交易成功。毕竟收到手里的钱没道理再退回去吧<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1686986652875-9e2924a9-e0f3-4de2-ae41-8b39ef6345bc.png#averageHue=%23d2c088&amp;clientId=uf9c47826-2719-4&amp;from=paste&amp;height=22&amp;id=u1eecfdc1&amp;originHeight=143&amp;originWidth=150&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=42199&amp;status=done&amp;style=none&amp;taskId=u80811df5-062e-457a-a9a8-0173e00f6b1&amp;title=&amp;width=22.999998092651367" alt="image.png" loading="lazy">。</p>
<p>因此，这里不能因为短信通知、更新订单状态失败而回滚整个事务。</p>
<p>综上，同步调用的方式存在下列问题：</p>
<ul>
<li>拓展性差</li>
<li>性能下降</li>
<li>级联失败</li>
</ul>
<p>而要解决这些问题，我们就必须用<strong>异步调用</strong>的方式来代替<strong>同步调用</strong>。</p>
<h2 id="_1-2-异步调用" tabindex="-1"><a class="header-anchor" href="#_1-2-异步调用"><span>1.2.异步调用</span></a></h2>
<p>异步调用方式其实就是基于消息通知的方式，一般包含三个角色：</p>
<ul>
<li>消息发送者：投递消息的人，就是原来的调用方</li>
<li>消息Broker：管理、暂存、转发消息，你可以把它理解成微信服务器</li>
<li>消息接收者：接收和处理消息的人，就是原来的服务提供方</li>
</ul>
<figure><img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686990662733-65b0eac8-f65f-4024-a581-6d5761c4c5a4.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>在异步调用中，发送者不再直接同步调用接收者的业务接口，而是发送一条消息投递给消息Broker。然后接收者根据自己的需求从消息Broker那里订阅消息。每当发送方发送消息后，接受者都能获取消息并处理。
这样，发送消息的人和接收消息的人就完全解耦了。</p>
<p>还是以余额支付业务为例：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686990257816-4f0b5ddd-7618-4095-b797-25b92f0bf2a5.jpeg" alt="" loading="lazy">
除了扣减余额、更新支付流水单状态以外，其它调用逻辑全部取消。而是改为发送一条消息到Broker。而相关的微服务都可以订阅消息通知，一旦消息到达Broker，则会分发给每一个订阅了的微服务，处理各自的业务。</p>
<p>假如产品经理提出了新的需求，比如要在支付成功后更新用户积分。支付代码完全不用变更，而仅仅是让积分服务也订阅消息即可：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1686989956210-7c1f451c-0368-4602-b02e-a66f2c0f6deb.jpeg" alt="" loading="lazy">
不管后期增加了多少消息订阅者，作为支付服务来讲，执行问扣减余额、更新支付流水状态后，发送消息即可。业务耗时仅仅是这三部分业务耗时，仅仅100ms，大大提高了业务性能。</p>
<p>另外，不管是交易服务、通知服务，还是积分服务，他们的业务与支付关联度低。现在采用了异步调用，解除了耦合，他们即便执行过程中出现了故障，也不会影响到支付服务。</p>
<p>综上，异步调用的优势包括：</p>
<ul>
<li>耦合度更低</li>
<li>性能更好</li>
<li>业务拓展性强</li>
<li>故障隔离，避免级联失败</li>
</ul>
<p>当然，异步通信也并非完美无缺，它存在下列缺点：</p>
<ul>
<li>完全依赖于Broker的可靠性、安全性和性能</li>
<li>架构复杂，后期维护和调试麻烦</li>
</ul>
<h2 id="_1-3-技术选型" tabindex="-1"><a class="header-anchor" href="#_1-3-技术选型"><span>1.3.技术选型</span></a></h2>
<p>消息Broker，目前常见的实现方案就是消息队列（MessageQueue），简称为MQ.
目比较常见的MQ实现：</p>
<ul>
<li>ActiveMQ</li>
<li>RabbitMQ</li>
<li>RocketMQ</li>
<li>Kafka</li>
</ul>
<p>几种常见MQ的对比：</p>
<table>
<thead>
<tr>
<th></th>
<th><strong>RabbitMQ</strong></th>
<th><strong>ActiveMQ</strong></th>
<th><strong>RocketMQ</strong></th>
<th><strong>Kafka</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td>公司/社区</td>
<td>Rabbit</td>
<td>Apache</td>
<td>阿里</td>
<td>Apache</td>
</tr>
<tr>
<td>开发语言</td>
<td>Erlang</td>
<td>Java</td>
<td>Java</td>
<td>Scala&amp;Java</td>
</tr>
<tr>
<td>协议支持</td>
<td>AMQP，XMPP，SMTP，STOMP</td>
<td>OpenWire,STOMP，REST,XMPP,AMQP</td>
<td>自定义协议</td>
<td>自定义协议</td>
</tr>
<tr>
<td>可用性</td>
<td>高</td>
<td>一般</td>
<td>高</td>
<td>高</td>
</tr>
<tr>
<td>单机吞吐量</td>
<td>一般</td>
<td>差</td>
<td>高</td>
<td>非常高</td>
</tr>
<tr>
<td>消息延迟</td>
<td>微秒级</td>
<td>毫秒级</td>
<td>毫秒级</td>
<td>毫秒以内</td>
</tr>
<tr>
<td>消息可靠性</td>
<td>高</td>
<td>一般</td>
<td>高</td>
<td>一般</td>
</tr>
</tbody>
</table>
<p>追求可用性：Kafka、 RocketMQ 、RabbitMQ
追求可靠性：RabbitMQ、RocketMQ
追求吞吐能力：RocketMQ、Kafka
追求消息低延迟：RabbitMQ、Kafka</p>
<p>据统计，目前国内消息队列使用最多的还是RabbitMQ，再加上其各方面都比较均衡，稳定性也好，因此我们课堂上选择RabbitMQ来学习。</p>
<h1 id="_2-rabbitmq" tabindex="-1"><a class="header-anchor" href="#_2-rabbitmq"><span>2.RabbitMQ</span></a></h1>
<p>RabbitMQ是基于Erlang语言开发的开源消息通信中间件，官网地址：
<a href="https://www.rabbitmq.com/" target="_blank" rel="noopener noreferrer">Messaging that just works — RabbitMQ</a>
接下来，我们就学习它的基本概念和基础用法。</p>
<h2 id="_2-1-安装" tabindex="-1"><a class="header-anchor" href="#_2-1-安装"><span>2.1.安装</span></a></h2>
<p>我们同样基于Docker来安装RabbitMQ，使用下面的命令即可：</p>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code><span class="token function">docker</span> run <span class="token punctuation">\</span>
 <span class="token parameter variable">-e</span> <span class="token assign-left variable">RABBITMQ_DEFAULT_USER</span><span class="token operator">=</span>itheima <span class="token punctuation">\</span>
 <span class="token parameter variable">-e</span> <span class="token assign-left variable">RABBITMQ_DEFAULT_PASS</span><span class="token operator">=</span><span class="token number">123321</span> <span class="token punctuation">\</span>
 <span class="token parameter variable">-v</span> mq-plugins:/plugins <span class="token punctuation">\</span>
 <span class="token parameter variable">--name</span> mq <span class="token punctuation">\</span>
 <span class="token parameter variable">--hostname</span> mq <span class="token punctuation">\</span>
 <span class="token parameter variable">-p</span> <span class="token number">15672</span>:15672 <span class="token punctuation">\</span>
 <span class="token parameter variable">-p</span> <span class="token number">5672</span>:5672 <span class="token punctuation">\</span>
 <span class="token parameter variable">--network</span> hmall <span class="token punctuation">\</span>
 <span class="token parameter variable">-d</span> <span class="token punctuation">\</span>
 rabbitmq:3.8-management
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>如果拉取镜像困难的话，可以使用课前资料给大家准备的镜像，利用docker load命令加载：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689939432832-7ee45271-f96c-43fa-b0f5-8c01bcdf289f.png#averageHue=%23f8f2f2&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=169&amp;id=u6c039f48&amp;originHeight=188&amp;originWidth=747&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=15874&amp;status=done&amp;style=none&amp;taskId=ub0c7a06c-2f63-4bc5-98d6-da0bfc75c32&amp;title=&amp;width=669.5798176232812" alt="image.png" loading="lazy"></p>
<p>可以看到在安装命令中有两个映射的端口：</p>
<ul>
<li>15672：RabbitMQ提供的管理控制台的端口</li>
<li>5672：RabbitMQ的消息发送处理接口</li>
</ul>
<p>安装完成后，我们访问 http://192.168.150.101:15672即可看到管理控制台。首次访问需要登录，默认的用户名和密码在配置文件中已经指定了。
登录后即可看到管理控制台总览页面：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687137883587-56417f79-a649-43a5-be88-2ff777d3cd25.png#averageHue=%23f7f6f6&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=707&amp;id=u7d848ee1&amp;originHeight=876&amp;originWidth=1572&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=83168&amp;status=done&amp;style=none&amp;taskId=ub505f8cf-075f-462b-bce3-e0df935715d&amp;title=&amp;width=1268.168026574142" alt="image.png" loading="lazy"></p>
<p>RabbitMQ对应的架构如图：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687136827222-52374724-79c9-4738-b53f-653cc0805d22.png#averageHue=%23e8d7b3&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=495&amp;id=ub8dd8df6&amp;originHeight=614&amp;originWidth=1458&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=104273&amp;status=done&amp;style=none&amp;taskId=uc0c132a5-73a3-4024-819f-61241da2511&amp;title=&amp;width=1176.2016429676203" alt="image.png" loading="lazy">
其中包含几个概念：</p>
<ul>
<li><code v-pre>**publisher**</code>：生产者，也就是发送消息的一方</li>
<li><code v-pre>**consumer**</code>：消费者，也就是消费消息的一方</li>
<li><code v-pre>**queue**</code>：队列，存储消息。生产者投递的消息会暂存在消息队列中，等待消费者处理</li>
<li><code v-pre>**exchange**</code>：交换机，负责消息路由。生产者发送的消息由交换机决定投递到哪个队列。</li>
<li><code v-pre>**virtual host**</code>：虚拟主机，起到数据隔离的作用。每个虚拟主机相互独立，有各自的exchange、queue</li>
</ul>
<p>上述这些东西都可以在RabbitMQ的管理控制台来管理，下一节我们就一起来学习控制台的使用。</p>
<h2 id="_2-2-收发消息" tabindex="-1"><a class="header-anchor" href="#_2-2-收发消息"><span>2.2.收发消息</span></a></h2>
<h3 id="_2-2-1-交换机" tabindex="-1"><a class="header-anchor" href="#_2-2-1-交换机"><span>2.2.1.交换机</span></a></h3>
<p>我们打开Exchanges选项卡，可以看到已经存在很多交换机：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687137953880-08aa9694-6a1e-4337-8bde-5757ec3c33f8.png#averageHue=%23f7f6f6&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=605&amp;id=u413741e2&amp;originHeight=750&amp;originWidth=1264&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=60217&amp;status=done&amp;style=none&amp;taskId=u8611b86c-aa50-46d9-855f-8307a318079&amp;title=&amp;width=1019.6974463038903" alt="image.png" loading="lazy">
我们点击任意交换机，即可进入交换机详情页面。仍然会利用控制台中的publish message 发送一条消息：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687138031622-ccce4612-954f-42c0-9291-73cf19915e39.png#averageHue=%23f9f8f7&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=487&amp;id=u9d211d96&amp;originHeight=604&amp;originWidth=947&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=38263&amp;status=done&amp;style=none&amp;taskId=ue134ec0e-ad83-465f-a1b2-97cb7667d75&amp;title=&amp;width=763.9663620647026" alt="image.png" loading="lazy">
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687138163403-839087fe-66f7-4710-a866-210aa0282be8.png#averageHue=%23f9f6f6&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=616&amp;id=ubca84480&amp;originHeight=763&amp;originWidth=1092&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=46085&amp;status=done&amp;style=none&amp;taskId=u5f176fff-eda8-457c-94cd-bb7d6bbd997&amp;title=&amp;width=880.9411482308925" alt="image.png" loading="lazy">
这里是由控制台模拟了生产者发送的消息。由于没有消费者存在，最终消息丢失了，这样说明交换机没有存储消息的能力。</p>
<h3 id="_2-2-2-队列" tabindex="-1"><a class="header-anchor" href="#_2-2-2-队列"><span>2.2.2.队列</span></a></h3>
<p>我们打开<code v-pre>Queues</code>选项卡，新建一个队列：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687138308409-be6e1649-af03-4ee7-bee3-8518fd0dca03.png#averageHue=%23f9f8f7&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=417&amp;id=u398bfe43&amp;originHeight=517&amp;originWidth=1157&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=35084&amp;status=done&amp;style=none&amp;taskId=u3b2b568c-e113-4abf-971c-2aea7bfaa4b&amp;title=&amp;width=933.3781213398743" alt="image.png" loading="lazy">
命名为<code v-pre>hello.queue1</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255044231-4b0e0339-c1ab-468a-8a72-9ae1b184594c.png#averageHue=%23f9f6f6&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=548&amp;id=uf3cb4af4&amp;originHeight=679&amp;originWidth=1163&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=51428&amp;status=done&amp;style=none&amp;taskId=u71f9590b-0cc5-4727-bd4c-65b353c4df7&amp;title=&amp;width=938.2184573191648" alt="image.png" loading="lazy">
再以相同的方式，创建一个队列，密码为<code v-pre>hello.queue2</code>，最终队列列表如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255204405-523f8053-e414-45f3-99c3-b66de152f79e.png#averageHue=%23f6f5f4&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=359&amp;id=u956d1947&amp;originHeight=445&amp;originWidth=1074&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=39049&amp;status=done&amp;style=none&amp;taskId=u1eb8bf9f-f74b-4238-a33e-796c4280e78&amp;title=&amp;width=866.4201402930207" alt="image.png" loading="lazy">
此时，我们再次向<code v-pre>amq.fanout</code>交换机发送一条消息。会发现消息依然没有到达队列！！
怎么回事呢？
发送到交换机的消息，只会路由到与其绑定的队列，因此仅仅创建队列是不够的，我们还需要将其与交换机绑定。</p>
<h3 id="_2-2-3-绑定关系" tabindex="-1"><a class="header-anchor" href="#_2-2-3-绑定关系"><span>2.2.3.绑定关系</span></a></h3>
<p>点击<code v-pre>Exchanges</code>选项卡，点击<code v-pre>amq.fanout</code>交换机，进入交换机详情页，然后点击<code v-pre>Bindings</code>菜单，在表单中填写要绑定的队列名称：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255547460-d87943cd-4309-4778-8e9e-374167a97e45.png#averageHue=%23f9f7f7&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=481&amp;id=u04a61731&amp;originHeight=596&amp;originWidth=1022&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=34676&amp;status=done&amp;style=none&amp;taskId=u0ce69958-400b-4c37-89ea-adf0b369080&amp;title=&amp;width=824.4705618058354" alt="image.png" loading="lazy">
相同的方式，将hello.queue2也绑定到改交换机。
最终，绑定结果如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255624712-7bd850b1-95fd-4d98-8243-57d1779de935.png#averageHue=%23f7f4f4&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=385&amp;id=u82198db4&amp;originHeight=477&amp;originWidth=978&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=28098&amp;status=done&amp;style=none&amp;taskId=u1394f18f-c109-4688-9eb1-effec6a43fb&amp;title=&amp;width=788.9747646243708" alt="image.png" loading="lazy"></p>
<h3 id="_2-2-4-发送消息" tabindex="-1"><a class="header-anchor" href="#_2-2-4-发送消息"><span>2.2.4.发送消息</span></a></h3>
<p>再次回到exchange页面，找到刚刚绑定的<code v-pre>amq.fanout</code>，点击进入详情页，再次发送一条消息：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687138163403-839087fe-66f7-4710-a866-210aa0282be8.png#averageHue=%23f9f6f6&amp;clientId=u6a529863-cf4b-4&amp;from=paste&amp;height=616&amp;id=GyhjT&amp;originHeight=763&amp;originWidth=1092&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=46085&amp;status=done&amp;style=none&amp;taskId=u5f176fff-eda8-457c-94cd-bb7d6bbd997&amp;title=&amp;width=880.9411482308925" alt="image.png" loading="lazy">
回到<code v-pre>Queues</code>页面，可以发现<code v-pre>hello.queue</code>中已经有一条消息了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255725782-fd5e2550-3572-48c0-9ec0-60786e33a3b1.png#averageHue=%23f5f4f3&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=319&amp;id=u97a4707c&amp;originHeight=395&amp;originWidth=1051&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=38484&amp;status=done&amp;style=none&amp;taskId=u4d68c013-3032-4d2b-83a0-571c3335780&amp;title=&amp;width=847.8655190390733" alt="image.png" loading="lazy">
点击队列名称，进入详情页，查看队列详情，这次我们点击get message：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255765034-69e67460-1535-48b3-8537-da383c498141.png#averageHue=%23f8f7f7&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=473&amp;id=ua850c29b&amp;originHeight=586&amp;originWidth=974&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=35281&amp;status=done&amp;style=none&amp;taskId=u668d2c9f-54a9-4427-adc4-e121a960025&amp;title=&amp;width=785.7478739715103" alt="image.png" loading="lazy">
可以看到消息到达队列了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687255798153-dda9b729-a3a0-415c-9167-48c525c75800.png#averageHue=%23f9f7f7&amp;clientId=u1711eaf3-9387-4&amp;from=paste&amp;height=466&amp;id=u66fa5450&amp;originHeight=578&amp;originWidth=762&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=33500&amp;status=done&amp;style=none&amp;taskId=u665361c6-23b2-4fc4-b1a9-fdf6c880545&amp;title=&amp;width=614.7226693699085" alt="image.png" loading="lazy">
这个时候如果有消费者监听了MQ的<code v-pre>hello.queue1</code>或<code v-pre>hello.queue2</code>队列，自然就能接收到消息了。</p>
<h2 id="_2-3-数据隔离" tabindex="-1"><a class="header-anchor" href="#_2-3-数据隔离"><span>2.3.数据隔离</span></a></h2>
<h3 id="_2-3-1-用户管理" tabindex="-1"><a class="header-anchor" href="#_2-3-1-用户管理"><span>2.3.1.用户管理</span></a></h3>
<p>点击<code v-pre>Admin</code>选项卡，首先会看到RabbitMQ控制台的用户管理界面：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687151143347-f7e2aaff-0a14-4022-8d50-582ee75e2998.png#averageHue=%23f7f5f5&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=450&amp;id=u2a51a990&amp;originHeight=558&amp;originWidth=1580&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=55212&amp;status=done&amp;style=none&amp;taskId=u18a12c4e-be8d-4ccb-a14a-415a21db44a&amp;title=&amp;width=1274.621807879863" alt="image.png" loading="lazy">
这里的用户都是RabbitMQ的管理或运维人员。目前只有安装RabbitMQ时添加的<code v-pre>itheima</code>这个用户。仔细观察用户表格中的字段，如下：</p>
<ul>
<li><code v-pre>Name</code>：<code v-pre>itheima</code>，也就是用户名</li>
<li><code v-pre>Tags</code>：<code v-pre>administrator</code>，说明<code v-pre>itheima</code>用户是超级管理员，拥有所有权限</li>
<li><code v-pre>Can access virtual host</code>： <code v-pre>/</code>，可以访问的<code v-pre>virtual host</code>，这里的<code v-pre>/</code>是默认的<code v-pre>virtual host</code></li>
</ul>
<p>对于小型企业而言，出于成本考虑，我们通常只会搭建一套MQ集群，公司内的多个不同项目同时使用。这个时候为了避免互相干扰， 我们会利用<code v-pre>virtual host</code>的隔离特性，将不同项目隔离。一般会做两件事情：</p>
<ul>
<li>给每个项目创建独立的运维账号，将管理权限分离。</li>
<li>给每个项目创建不同的<code v-pre>virtual host</code>，将每个项目的数据隔离。</li>
</ul>
<p>比如，我们给黑马商城创建一个新的用户，命名为<code v-pre>hmall</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687151725993-05fe9bd1-8f8b-468d-8456-eac36278bea2.png#averageHue=%23f7f5f5&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=609&amp;id=ua32ca0ae&amp;originHeight=755&amp;originWidth=1569&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=70298&amp;status=done&amp;style=none&amp;taskId=u4f4ed00c-b8dd-4ffd-8a83-75d03c11fb5&amp;title=&amp;width=1265.7478585844967" alt="image.png" loading="lazy">
你会发现此时hmall用户没有任何<code v-pre>virtual host</code>的访问权限：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687151853554-e671a696-e9c0-4ff5-9caf-31b39e1a17f5.png#averageHue=%23f7f5f4&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=353&amp;id=ueeaf90c6&amp;originHeight=437&amp;originWidth=927&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=31497&amp;status=done&amp;style=none&amp;taskId=u74d79385-5602-447d-8beb-ed20ec36022&amp;title=&amp;width=747.8319088004005" alt="image.png" loading="lazy">
别急，接下来我们就来授权。</p>
<h3 id="_2-3-2-virtual-host" tabindex="-1"><a class="header-anchor" href="#_2-3-2-virtual-host"><span>2.3.2.virtual host</span></a></h3>
<p>我们先退出登录：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687152245922-8438490f-d094-4db1-88fa-a2d916d46a97.png#averageHue=%23f6f5f5&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=374&amp;id=u12c0492e&amp;originHeight=463&amp;originWidth=1571&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=50699&amp;status=done&amp;style=none&amp;taskId=u830f1745-a0ed-4202-9849-7653ebae4c2&amp;title=&amp;width=1267.3613039109268" alt="image.png" loading="lazy">
切换到刚刚创建的hmall用户登录，然后点击<code v-pre>Virtual Hosts</code>菜单，进入<code v-pre>virtual host</code>管理页：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687152310566-2531b1c8-b362-47c7-ba81-1b7c1880c18b.png#averageHue=%23f5f4f3&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=409&amp;id=uf51820c2&amp;originHeight=507&amp;originWidth=1565&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=60462&amp;status=done&amp;style=none&amp;taskId=ud7655191-c9d5-4801-9669-55b47348861&amp;title=&amp;width=1262.5209679316363" alt="image.png" loading="lazy">
可以看到目前只有一个默认的<code v-pre>virtual host</code>，名字为 <code v-pre>/</code>。
我们可以给黑马商城项目创建一个单独的<code v-pre>virtual host</code>，而不是使用默认的<code v-pre>/</code>。
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687152363999-edb47263-f303-4ee8-a80d-be55d6b0ed37.png#averageHue=%23f6f5f4&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=553&amp;id=ufc5bd4a7&amp;originHeight=685&amp;originWidth=1555&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=67199&amp;status=done&amp;style=none&amp;taskId=u38a5fe38-fcb5-4163-bee4-ddffaba416b&amp;title=&amp;width=1254.4537412994853" alt="image.png" loading="lazy">
创建完成后如图：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687152448758-d0a05827-10ac-459b-a92f-495304dddf89.png#averageHue=%23f5f5f4&amp;clientId=uc5430584-57f9-4&amp;from=paste&amp;height=232&amp;id=ue38b9ba4&amp;originHeight=287&amp;originWidth=990&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=24622&amp;status=done&amp;style=none&amp;taskId=ue5f326dc-340c-46e0-83d5-84a19fef1d9&amp;title=&amp;width=798.655436582952" alt="image.png" loading="lazy">
由于我们是登录<code v-pre>hmall</code>账户后创建的<code v-pre>virtual host</code>，因此回到<code v-pre>users</code>菜单，你会发现当前用户已经具备了对<code v-pre>/hmall</code>这个<code v-pre>virtual host</code>的访问权限了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687152695194-6c2dda94-43c4-4ee9-b95c-ca9d8504cd0c.png#averageHue=%23f7f4f4&amp;clientId=ud5bd9b1f-141b-4&amp;from=paste&amp;height=349&amp;id=u0cf22cf3&amp;originHeight=432&amp;originWidth=890&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=30925&amp;status=done&amp;style=none&amp;taskId=u1b04bdb9-ab59-41d9-b2bb-e5f5a0cca59&amp;title=&amp;width=717.9831702614417" alt="image.png" loading="lazy"></p>
<p>此时，点击页面右上角的<code v-pre>virtual host</code>下拉菜单，切换<code v-pre>virtual host</code>为 <code v-pre>/hmall</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687153236457-ca138f25-b351-4095-8855-aa0df42fae65.png#averageHue=%23f7f5f4&amp;clientId=ud5bd9b1f-141b-4&amp;from=paste&amp;height=223&amp;id=u0989d284&amp;originHeight=277&amp;originWidth=1448&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=35060&amp;status=done&amp;style=none&amp;taskId=u6ab4f38a-ad0d-48bd-ace7-7f0281755d1&amp;title=&amp;width=1168.1344163354693" alt="image.png" loading="lazy">
然后再次查看queues选项卡，会发现之前的队列已经看不到了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687153307085-0157ac47-2d89-4f32-ab9a-d513b0e19f25.png#averageHue=%23f9f6f6&amp;clientId=ud5bd9b1f-141b-4&amp;from=paste&amp;height=431&amp;id=u151b88b9&amp;originHeight=534&amp;originWidth=1443&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=48526&amp;status=done&amp;style=none&amp;taskId=u7ef6af14-7e3c-4988-8721-80965a310f6&amp;title=&amp;width=1164.1008030193937" alt="image.png" loading="lazy">
这就是基于<code v-pre>virtual host </code>的隔离效果。</p>
<h1 id="_3-springamqp" tabindex="-1"><a class="header-anchor" href="#_3-springamqp"><span>3.SpringAMQP</span></a></h1>
<p>将来我们开发业务功能的时候，肯定不会在控制台收发消息，而是应该基于编程的方式。由于<code v-pre>RabbitMQ</code>采用了AMQP协议，因此它具备跨语言的特性。任何语言只要遵循AMQP协议收发消息，都可以与<code v-pre>RabbitMQ</code>交互。并且<code v-pre>RabbitMQ</code>官方也提供了各种不同语言的客户端。
但是，RabbitMQ官方提供的Java客户端编码相对复杂，一般生产环境下我们更多会结合Spring来使用。而Spring的官方刚好基于RabbitMQ提供了这样一套消息收发的模板工具：SpringAMQP。并且还基于SpringBoot对其实现了自动装配，使用起来非常方便。</p>
<p>SpringAmqp的官方地址：
<a href="https://spring.io/projects/spring-amqp" target="_blank" rel="noopener noreferrer">Spring AMQP</a>
SpringAMQP提供了三个功能：</p>
<ul>
<li>自动声明队列、交换机及其绑定关系</li>
<li>基于注解的监听器模式，异步接收消息</li>
<li>封装了RabbitTemplate工具，用于发送消息</li>
</ul>
<p>这一章我们就一起学习一下，如何利用SpringAMQP实现对RabbitMQ的消息收发。</p>
<h2 id="_3-1-导入demo工程" tabindex="-1"><a class="header-anchor" href="#_3-1-导入demo工程"><span>3.1.导入Demo工程</span></a></h2>
<p>在课前资料给大家提供了一个Demo工程，方便我们学习SpringAMQP的使用：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689939402093-e0e0a3d4-84ed-40b5-bedc-0884fcb4ae64.png#averageHue=%23f9f9f8&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=169&amp;id=u1dad7a09&amp;originHeight=188&amp;originWidth=752&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=15464&amp;status=done&amp;style=none&amp;taskId=u1668b30b-b977-4fc3-89ba-6c2e029e374&amp;title=&amp;width=674.0616102445883" alt="image.png" loading="lazy">
将其复制到你的工作空间，然后用Idea打开，项目结构如图：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687156248415-3fe7ae5b-302b-4a35-a520-b2419e616862.png#averageHue=%23f9fbf8&amp;clientId=ud5bd9b1f-141b-4&amp;from=paste&amp;height=253&amp;id=u53ed8a5e&amp;originHeight=314&amp;originWidth=664&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=30988&amp;status=done&amp;style=none&amp;taskId=u5ab16e5b-840d-4511-b27b-07f42a60f4c&amp;title=&amp;width=535.6638483748284" alt="image.png" loading="lazy">
包括三部分：</p>
<ul>
<li>mq-demo：父工程，管理项目依赖</li>
<li>publisher：消息的发送者</li>
<li>consumer：消息的消费者</li>
</ul>
<p>在mq-demo这个父工程中，已经配置好了SpringAMQP相关的依赖：</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code><span class="token prolog">&lt;?xml version="1.0" encoding="UTF-8"?></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>project</span> <span class="token attr-name">xmlns</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>http://maven.apache.org/POM/4.0.0<span class="token punctuation">"</span></span>
         <span class="token attr-name"><span class="token namespace">xmlns:</span>xsi</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>http://www.w3.org/2001/XMLSchema-instance<span class="token punctuation">"</span></span>
         <span class="token attr-name"><span class="token namespace">xsi:</span>schemaLocation</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd<span class="token punctuation">"</span></span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>modelVersion</span><span class="token punctuation">></span></span>4.0.0<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>modelVersion</span><span class="token punctuation">></span></span>

    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>cn.itcast.demo<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>mq-demo<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>1.0-SNAPSHOT<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>modules</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>module</span><span class="token punctuation">></span></span>publisher<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>module</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>module</span><span class="token punctuation">></span></span>consumer<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>module</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>modules</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>packaging</span><span class="token punctuation">></span></span>pom<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>packaging</span><span class="token punctuation">></span></span>

    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>parent</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-parent<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>2.7.12<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>relativePath</span><span class="token punctuation">/></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>parent</span><span class="token punctuation">></span></span>

    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>properties</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>maven.compiler.source</span><span class="token punctuation">></span></span>8<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>maven.compiler.source</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>maven.compiler.target</span><span class="token punctuation">></span></span>8<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>maven.compiler.target</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>properties</span><span class="token punctuation">></span></span>

    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependencies</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.projectlombok<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>lombok<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
        <span class="token comment">&lt;!--AMQP依赖，包含RabbitMQ--></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-amqp<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
        <span class="token comment">&lt;!--单元测试--></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-test<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependencies</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>project</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>因此，子工程中就可以直接使用SpringAMQP了。</p>
<h2 id="_3-2-快速入门" tabindex="-1"><a class="header-anchor" href="#_3-2-快速入门"><span>3.2.快速入门</span></a></h2>
<p>在之前的案例中，我们都是经过交换机发送消息到队列，不过有时候为了测试方便，我们也可以直接向队列发送消息，跳过交换机。
在入门案例中，我们就演示这样的简单模型，如图：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687261777988-23fff732-dcfa-499a-a8a1-a66328fe05e7.jpeg" alt="" loading="lazy">
也就是：</p>
<ul>
<li>publisher直接发送消息到队列</li>
<li>消费者监听并处理队列中的消息</li>
</ul>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p><strong>注意</strong>：这种模式一般测试使用，很少在生产中使用。</p>
</div>
<p>为了方便测试，我们现在控制台新建一个队列：simple.queue
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687171932026-33eace5d-c0f2-4070-8742-fe8b34c6c749.png#averageHue=%23f9f8f8&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=602&amp;id=uec08e673&amp;originHeight=746&amp;originWidth=1219&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=53932&amp;status=done&amp;style=none&amp;taskId=ubdce29f2-6d3c-45cc-8b7f-64627bcf68c&amp;title=&amp;width=983.3949264592106" alt="image.png" loading="lazy">
添加成功：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687172012283-e19d8da6-8944-4f51-a40b-a15f0814b015.png#averageHue=%23f7f6f6&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=405&amp;id=u61761e6f&amp;originHeight=502&amp;originWidth=1187&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=40787&amp;status=done&amp;style=none&amp;taskId=uaf3c44d8-727d-4f46-8ae6-46245932d99&amp;title=&amp;width=957.5798012363273" alt="image.png" loading="lazy">
接下来，我们就可以利用Java代码收发消息了。</p>
<h3 id="_3-1-1-消息发送" tabindex="-1"><a class="header-anchor" href="#_3-1-1-消息发送"><span>3.1.1.消息发送</span></a></h3>
<p>首先配置MQ地址，在<code v-pre>publisher</code>服务的<code v-pre>application.yml</code>中添加配置：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">host</span><span class="token punctuation">:</span> 192.168.150.101 <span class="token comment"># 你的虚拟机IP</span>
    <span class="token key atrule">port</span><span class="token punctuation">:</span> <span class="token number">5672</span> <span class="token comment"># 端口</span>
    <span class="token key atrule">virtual-host</span><span class="token punctuation">:</span> /hmall <span class="token comment"># 虚拟主机</span>
    <span class="token key atrule">username</span><span class="token punctuation">:</span> hmall <span class="token comment"># 用户名</span>
    <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">123</span> <span class="token comment"># 密码</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>然后在<code v-pre>publisher</code>服务中编写测试类<code v-pre>SpringAmqpTest</code>，并利用<code v-pre>RabbitTemplate</code>实现消息发送：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>publisher<span class="token punctuation">.</span>amqp</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>junit<span class="token punctuation">.</span>jupiter<span class="token punctuation">.</span>api<span class="token punctuation">.</span></span><span class="token class-name">Test</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">RabbitTemplate</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>beans<span class="token punctuation">.</span>factory<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Autowired</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>boot<span class="token punctuation">.</span>test<span class="token punctuation">.</span>context<span class="token punctuation">.</span></span><span class="token class-name">SpringBootTest</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@SpringBootTest</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">SpringAmqpTest</span> <span class="token punctuation">{</span>

    <span class="token annotation punctuation">@Autowired</span>
    <span class="token keyword">private</span> <span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">;</span>

    <span class="token annotation punctuation">@Test</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testSimpleQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 队列名称</span>
        <span class="token class-name">String</span> queueName <span class="token operator">=</span> <span class="token string">"simple.queue"</span><span class="token punctuation">;</span>
        <span class="token comment">// 消息</span>
        <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"hello, spring amqp!"</span><span class="token punctuation">;</span>
        <span class="token comment">// 发送消息</span>
        rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>queueName<span class="token punctuation">,</span> message<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>打开控制台，可以看到消息已经发送到队列中：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687173164620-51a78ccb-b2a1-474b-8147-076f4b8cee12.png#averageHue=%23f8f7f6&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=431&amp;id=u34a6c895&amp;originHeight=534&amp;originWidth=1267&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=43690&amp;status=done&amp;style=none&amp;taskId=u6fd3cf33-b6c0-42a6-91f3-e263e176174&amp;title=&amp;width=1022.1176142935356" alt="image.png" loading="lazy">
接下来，我们再来实现消息接收。</p>
<h3 id="_3-1-2-消息接收" tabindex="-1"><a class="header-anchor" href="#_3-1-2-消息接收"><span>3.1.2.消息接收</span></a></h3>
<p>首先配置MQ地址，在<code v-pre>consumer</code>服务的<code v-pre>application.yml</code>中添加配置：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">host</span><span class="token punctuation">:</span> 192.168.150.101 <span class="token comment"># 你的虚拟机IP</span>
    <span class="token key atrule">port</span><span class="token punctuation">:</span> <span class="token number">5672</span> <span class="token comment"># 端口</span>
    <span class="token key atrule">virtual-host</span><span class="token punctuation">:</span> /hmall <span class="token comment"># 虚拟主机</span>
    <span class="token key atrule">username</span><span class="token punctuation">:</span> hmall <span class="token comment"># 用户名</span>
    <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">123</span> <span class="token comment"># 密码</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>然后在<code v-pre>consumer</code>服务的<code v-pre>com.itheima.consumer.listener</code>包中新建一个类<code v-pre>SpringRabbitListener</code>，代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>listener</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">RabbitListener</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>stereotype<span class="token punctuation">.</span></span><span class="token class-name">Component</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Component</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">SpringRabbitListener</span> <span class="token punctuation">{</span>
	<span class="token comment">// 利用RabbitListener来声明要监听的队列信息</span>
    <span class="token comment">// 将来一旦监听的队列中有了消息，就会推送给当前服务，调用当前方法，处理消息。</span>
    <span class="token comment">// 可以看到方法体中接收的就是消息体的内容</span>
    <span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"simple.queue"</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenSimpleQueueMessage</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
        <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"spring 消费者接收到消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-1-3-测试" tabindex="-1"><a class="header-anchor" href="#_3-1-3-测试"><span>3.1.3.测试</span></a></h3>
<p>启动consumer服务，然后在publisher服务中运行测试代码，发送MQ消息。最终consumer收到消息：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687173574481-792b9a3c-bcab-4f96-9d09-206cccdd1456.png#averageHue=%23f7f9f5&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=405&amp;id=ua133b5cf&amp;originHeight=502&amp;originWidth=1805&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=226083&amp;status=done&amp;style=none&amp;taskId=u72073b8f-ef3f-4ec4-af3e-4187138ca2a&amp;title=&amp;width=1456.134407103261" alt="image.png" loading="lazy"></p>
<h2 id="_3-3-workqueues模型" tabindex="-1"><a class="header-anchor" href="#_3-3-workqueues模型"><span>3.3.WorkQueues模型</span></a></h2>
<p>Work queues，任务模型。简单来说就是<strong>让多个消费者绑定到一个队列，共同消费队列中的消息</strong>。
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687261956699-4b3c9999-ee86-4dda-a795-1ea5f4f9eef3.jpeg" alt="" loading="lazy"></p>
<p>当消息处理比较耗时的时候，可能生产消息的速度会远远大于消息的消费速度。长此以往，消息就会堆积越来越多，无法及时处理。
此时就可以使用work 模型，<strong>多个消费者共同处理消息处理，消息处理的速度就能大大提高</strong>了。</p>
<p>接下来，我们就来模拟这样的场景。
首先，我们在控制台创建一个新的队列，命名为<code v-pre>work.queue</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687179664222-3e226588-63e3-4275-a9e2-cce5c8e93d4c.png#averageHue=%23f5f2f1&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=321&amp;id=u96998af1&amp;originHeight=398&amp;originWidth=1180&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=41883&amp;status=done&amp;style=none&amp;taskId=ubcca08d6-3211-435a-ae7c-10fcf4daafe&amp;title=&amp;width=951.9327425938216" alt="image.png" loading="lazy"></p>
<h3 id="_3-3-1-消息发送" tabindex="-1"><a class="header-anchor" href="#_3-3-1-消息发送"><span>3.3.1.消息发送</span></a></h3>
<p>这次我们循环发送，模拟大量消息堆积现象。
在publisher服务中的SpringAmqpTest类中添加一个测试方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token doc-comment comment">/**
     * workQueue
     * 向队列中不停发送消息，模拟消息堆积。
     */</span>
<span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testWorkQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    <span class="token comment">// 队列名称</span>
    <span class="token class-name">String</span> queueName <span class="token operator">=</span> <span class="token string">"simple.queue"</span><span class="token punctuation">;</span>
    <span class="token comment">// 消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"hello, message_"</span><span class="token punctuation">;</span>
    <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span> i <span class="token operator">&lt;</span> <span class="token number">50</span><span class="token punctuation">;</span> i<span class="token operator">++</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 发送消息，每20毫秒发送一次，相当于每秒发送50条消息</span>
        rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>queueName<span class="token punctuation">,</span> message <span class="token operator">+</span> i<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token class-name">Thread</span><span class="token punctuation">.</span><span class="token function">sleep</span><span class="token punctuation">(</span><span class="token number">20</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-3-2-消息接收" tabindex="-1"><a class="header-anchor" href="#_3-3-2-消息接收"><span>3.3.2.消息接收</span></a></h3>
<p>要模拟多个消费者绑定同一个队列，我们在consumer服务的SpringRabbitListener中添加2个新的方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"work.queue"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenWorkQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span> <span class="token operator">+</span> <span class="token class-name">LocalTime</span><span class="token punctuation">.</span><span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token class-name">Thread</span><span class="token punctuation">.</span><span class="token function">sleep</span><span class="token punctuation">(</span><span class="token number">20</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"work.queue"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenWorkQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>err<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2........接收到消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span> <span class="token operator">+</span> <span class="token class-name">LocalTime</span><span class="token punctuation">.</span><span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token class-name">Thread</span><span class="token punctuation">.</span><span class="token function">sleep</span><span class="token punctuation">(</span><span class="token number">200</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意到这两消费者，都设置了<code v-pre>Thead.sleep</code>，模拟任务耗时：</p>
<ul>
<li>消费者1 sleep了20毫秒，相当于每秒钟处理50个消息</li>
<li>消费者2 sleep了200毫秒，相当于每秒处理5个消息</li>
</ul>
<h3 id="_3-3-3-测试" tabindex="-1"><a class="header-anchor" href="#_3-3-3-测试"><span>3.3.3.测试</span></a></h3>
<p>启动ConsumerApplication后，在执行publisher服务中刚刚编写的发送测试方法testWorkQueue。
最终结果如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code>消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_0】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">00.869555300</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_1】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">00.884518</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_2】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">00.907454400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_4】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">00.953332100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_6】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">00.997867300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_8】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.042178700</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_3】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.086478800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_10】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.087476600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_12】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.132578300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_14】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.175851200</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_16】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.218533400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_18】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.261322900</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_5】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.287003700</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_20】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.304412400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_22】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.349950100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_24】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.394533900</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_26】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.439876500</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_28】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.482937800</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_7】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.488977100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_30】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.526409300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_32】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.572148</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_34】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.618264800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_36】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.660780600</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_9】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.689189300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_38】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.705261</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_40】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.746927300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_42】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.789835</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_44】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.834393100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_46】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.875312100</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_11】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.889969500</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_48】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">01.920702500</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_13】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">02.090725900</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_15】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">02.293060600</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_17】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">02.493748</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_19】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">02.696635100</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_21】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">02.896809700</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_23】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">03.099533400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_25】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">03.301446400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_27】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">03.504999100</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_29】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">03.705702500</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_31】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">03.906601200</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_33】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">04.108118500</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_35】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">04.308945400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_37】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">04.511547700</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_39】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">04.714038400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_41】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">04.916192700</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_43】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">05.116286400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_45】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">05.318055100</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_47】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">05.520656400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_49】<span class="token number">21</span><span class="token operator">:</span><span class="token number">06</span><span class="token operator">:</span><span class="token number">05.723106700</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>可以看到消费者1和消费者2竟然每人消费了25条消息：</p>
<ul>
<li>消费者1很快完成了自己的25条消息</li>
<li>消费者2却在缓慢的处理自己的25条消息。</li>
</ul>
<p>也就是说消息是平均分配给每个消费者，并没有考虑到消费者的处理能力。导致1个消费者空闲，另一个消费者忙的不可开交。没有充分利用每一个消费者的能力，最终消息处理的耗时远远超过了1秒。这样显然是有问题的。</p>
<h3 id="_3-3-4-能者多劳" tabindex="-1"><a class="header-anchor" href="#_3-3-4-能者多劳"><span>3.3.4.能者多劳</span></a></h3>
<p>在spring中有一个简单的配置，可以解决这个问题。我们修改consumer服务的application.yml文件，添加配置：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">listener</span><span class="token punctuation">:</span>
      <span class="token key atrule">simple</span><span class="token punctuation">:</span>
        <span class="token key atrule">prefetch</span><span class="token punctuation">:</span> <span class="token number">1</span> <span class="token comment"># 每次只能获取一条消息，处理完成才能获取下一个消息</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>再次测试，发现结果如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code>消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_0】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.659664200</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_1】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.680610</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_2】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.703625</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_3】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.724330100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_4】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.746651100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_5】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.768401400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_6】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.790511400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_7】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.812559800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_8】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.834500600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_9】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.857438800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_10】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.880379600</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_11】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.899327100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_12】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.922828400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_13】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.945617400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_14】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.968942500</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_15】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">51.992215400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_16】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.013325600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_17】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.035687100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_18】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.058188</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_19】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.081208400</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_20】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.103406200</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_21】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.123827300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_22】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.146165100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_23】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.168828300</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_24】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.191769500</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_25】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.214839100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_26】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.238998700</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_27】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.259772600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_28】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.284131800</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_29】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.306190600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_30】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.325315800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_31】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.347012500</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_32】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.368508600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_33】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.391785100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_34】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.416383800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_35】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.439019</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_36】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.461733900</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_37】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.485990</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_38】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.509219900</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_39】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.523683400</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_40】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.547412100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_41】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.571191800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_42】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.593024600</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_43】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.616731800</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_44】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.640317</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_45】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.663111100</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_46】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.686727</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_47】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.709266500</span>
消费者<span class="token number">2.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>接收到消息：【hello<span class="token punctuation">,</span> message_48】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.725884900</span>
消费者<span class="token number">1</span>接收到消息：【hello<span class="token punctuation">,</span> message_49】<span class="token number">21</span><span class="token operator">:</span><span class="token number">12</span><span class="token operator">:</span><span class="token number">52.746299900</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>可以发现，由于消费者1处理速度较快，所以处理了更多的消息；消费者2处理速度较慢，只处理了6条消息。而最终总的执行耗时也在1秒左右，大大提升。
正所谓能者多劳，这样充分利用了每一个消费者的处理能力，可以有效避免消息积压问题。</p>
<h3 id="_3-3-5-总结" tabindex="-1"><a class="header-anchor" href="#_3-3-5-总结"><span>3.3.5.总结</span></a></h3>
<p>Work模型的使用：</p>
<ul>
<li>多个消费者绑定到一个队列，同一条消息只会被一个消费者处理</li>
<li>通过设置prefetch来控制消费者预取的消息数量</li>
</ul>
<h2 id="_3-4-交换机类型" tabindex="-1"><a class="header-anchor" href="#_3-4-交换机类型"><span>3.4.交换机类型</span></a></h2>
<p>在之前的两个测试案例中，都没有交换机，生产者直接发送消息到队列。而一旦引入交换机，消息发送的模式会有很大变化：
<img src="https://cdn.nlark.com/yuque/0/2023/jpeg/27967491/1687264784359-de7cbc4a-ec60-461d-a6a4-3474ba52e0d0.jpeg" alt="" loading="lazy">
可以看到，在订阅模型中，多了一个exchange角色，而且过程略有变化：</p>
<ul>
<li><strong>Publisher</strong>：生产者，不再发送消息到队列中，而是发给交换机</li>
<li><strong>Exchange</strong>：交换机，一方面，接收生产者发送的消息。另一方面，知道如何处理消息，例如递交给某个特别队列、递交给所有队列、或是将消息丢弃。到底如何操作，取决于Exchange的类型。</li>
<li><strong>Queue</strong>：消息队列也与以前一样，接收消息、缓存消息。不过队列一定要与交换机绑定。</li>
<li><strong>Consumer</strong>：消费者，与以前一样，订阅队列，没有变化</li>
</ul>
<p><strong>Exchange（交换机）只负责转发消息，不具备存储消息的能力</strong>，因此如果没有任何队列与Exchange绑定，或者没有符合路由规则的队列，那么消息会丢失！</p>
<p>交换机的类型有四种：</p>
<ul>
<li><strong>Fanout</strong>：广播，将消息交给所有绑定到交换机的队列。我们最早在控制台使用的正是Fanout交换机</li>
<li><strong>Direct</strong>：订阅，基于RoutingKey（路由key）发送给订阅了消息的队列</li>
<li><strong>Topic</strong>：通配符订阅，与Direct类似，只不过RoutingKey可以使用通配符</li>
<li><strong>Headers</strong>：头匹配，基于MQ的消息头匹配，用的较少。</li>
</ul>
<p>课堂中，我们讲解前面的三种交换机模式。</p>
<h2 id="_3-5-fanout交换机" tabindex="-1"><a class="header-anchor" href="#_3-5-fanout交换机"><span>3.5.Fanout交换机</span></a></h2>
<p>Fanout，英文翻译是扇出，我觉得在MQ中叫广播更合适。
在广播模式下，消息发送流程是这样的：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687181415478-ea4bb17b-48bf-4303-9242-27703efb39d8.png#averageHue=%23fbf6f6&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=389&amp;id=u41b3ec34&amp;originHeight=482&amp;originWidth=1598&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=84491&amp;status=done&amp;style=none&amp;taskId=u0db849d5-c734-41f3-87c2-d1fe9ec7575&amp;title=&amp;width=1289.1428158177346" alt="image.png" loading="lazy"></p>
<ul>
<li>1）  可以有多个队列</li>
<li>2）  每个队列都要绑定到Exchange（交换机）</li>
<li>3）  生产者发送的消息，只能发送到交换机</li>
<li>4）  交换机把消息发送给绑定过的所有队列</li>
<li>5）  订阅队列的消费者都能拿到消息</li>
</ul>
<p>我们的计划是这样的：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687182474076-2b479229-56a6-4163-93c4-a6a7187f3dbe.png#averageHue=%23f9f4f4&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=248&amp;id=ue59e0d8c&amp;originHeight=308&amp;originWidth=1314&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=48827&amp;status=done&amp;style=none&amp;taskId=u7d52896e-f59b-494d-bb25-b376c96414e&amp;title=&amp;width=1060.0335794646453" alt="image.png" loading="lazy"></p>
<ul>
<li>创建一个名为<code v-pre> hmall.fanout</code>的交换机，类型是<code v-pre>Fanout</code></li>
<li>创建两个队列<code v-pre>fanout.queue1</code>和<code v-pre>fanout.queue2</code>，绑定到交换机<code v-pre>hmall.fanout</code></li>
</ul>
<h3 id="_3-5-1-声明队列和交换机" tabindex="-1"><a class="header-anchor" href="#_3-5-1-声明队列和交换机"><span>3.5.1.声明队列和交换机</span></a></h3>
<p>在控制台创建队列<code v-pre>fanout.queue1</code>:
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689946886137-0bcb8641-faf1-4bea-b553-4b3bb96d224c.png#averageHue=%23f8f7f7&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=380&amp;id=ub435a220&amp;originHeight=424&amp;originWidth=1117&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=31069&amp;status=done&amp;style=none&amp;taskId=uf02d05dd-b916-4d37-b2f4-dba06eff8a9&amp;title=&amp;width=1001.2324716000069" alt="image.png" loading="lazy">
在创建一个队列<code v-pre>fanout.queue2</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689946949922-c4e442c3-568b-4164-a327-74e30aa9b9d0.png#averageHue=%23f8f6f5&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=380&amp;id=u452ddf31&amp;originHeight=424&amp;originWidth=916&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=29357&amp;status=done&amp;style=none&amp;taskId=u657c70e9-017c-4339-98e0-2d408950262&amp;title=&amp;width=821.0644082234613" alt="image.png" loading="lazy">
然后再创建一个交换机：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948003779-ea99bac6-6b84-48f3-9760-a719ba5f0c2e.png#averageHue=%23f8f6f6&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=359&amp;id=ud456637e&amp;originHeight=401&amp;originWidth=886&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=22862&amp;status=done&amp;style=none&amp;taskId=uba3f2a17-5520-43f0-abd4-2eec22a7c3a&amp;title=&amp;width=794.1736524956187" alt="image.png" loading="lazy">
然后绑定两个队列到交换机：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689947064113-23e123ec-a601-4af4-a44f-70f7b4ef4063.png#averageHue=%23f8f7f7&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=527&amp;id=u2d63999d&amp;originHeight=588&amp;originWidth=978&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=34267&amp;status=done&amp;style=none&amp;taskId=uc512438d-9693-44f1-9c35-33917ddbced&amp;title=&amp;width=876.6386367276695" alt="image.png" loading="lazy">
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689947695506-5346b816-61c7-4bfe-a28d-db261b3598c5.png#averageHue=%23f8f7f7&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=537&amp;id=u17bcbe41&amp;originHeight=599&amp;originWidth=985&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=34532&amp;status=done&amp;style=none&amp;taskId=u17b49cc4-004f-4e31-bd46-bdef7fe19a1&amp;title=&amp;width=882.9131463974993" alt="image.png" loading="lazy"></p>
<h3 id="_3-5-2-消息发送" tabindex="-1"><a class="header-anchor" href="#_3-5-2-消息发送"><span>3.5.2.消息发送</span></a></h3>
<p>在publisher服务的SpringAmqpTest类中添加测试方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testFanoutExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 交换机名称</span>
    <span class="token class-name">String</span> exchangeName <span class="token operator">=</span> <span class="token string">"hmall.fanout"</span><span class="token punctuation">;</span>
    <span class="token comment">// 消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"hello, everyone!"</span><span class="token punctuation">;</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>exchangeName<span class="token punctuation">,</span> <span class="token string">""</span><span class="token punctuation">,</span> message<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-5-3-消息接收" tabindex="-1"><a class="header-anchor" href="#_3-5-3-消息接收"><span>3.5.3.消息接收</span></a></h3>
<p>在consumer服务的SpringRabbitListener中添加两个方法，作为消费者：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"fanout.queue1"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenFanoutQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到Fanout消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"fanout.queue2"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenFanoutQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2接收到Fanout消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-5-4-总结" tabindex="-1"><a class="header-anchor" href="#_3-5-4-总结"><span>3.5.4.总结</span></a></h3>
<p>交换机的作用是什么？</p>
<ul>
<li>接收publisher发送的消息</li>
<li>将消息按照规则路由到与之绑定的队列</li>
<li>不能缓存消息，路由失败，消息丢失</li>
<li>FanoutExchange的会将消息路由到每个绑定的队列</li>
</ul>
<h2 id="_3-6-direct交换机" tabindex="-1"><a class="header-anchor" href="#_3-6-direct交换机"><span>3.6.Direct交换机</span></a></h2>
<p>在Fanout模式中，一条消息，会被所有订阅的队列都消费。但是，在某些场景下，我们希望不同的消息被不同的队列消费。这时就要用到Direct类型的Exchange。
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687182404437-027a5191-b037-4033-baab-6bafd998161d.png#averageHue=%23fbf5f5&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=430&amp;id=uf5b6a678&amp;originHeight=533&amp;originWidth=1686&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=93278&amp;status=done&amp;style=none&amp;taskId=ud6ffb209-4207-40a6-a7ab-4977cab3b5d&amp;title=&amp;width=1360.1344101806637" alt="image.png" loading="lazy">
在Direct模型下：</p>
<ul>
<li>队列与交换机的绑定，不能是任意绑定了，而是要指定一个<code v-pre>RoutingKey</code>（路由key）</li>
<li>消息的发送方在 向 Exchange发送消息时，也必须指定消息的 <code v-pre>RoutingKey</code>。</li>
<li>Exchange不再把消息交给每一个绑定的队列，而是根据消息的<code v-pre>Routing Key</code>进行判断，只有队列的<code v-pre>Routingkey</code>与消息的 <code v-pre>Routing key</code>完全一致，才会接收到消息</li>
</ul>
<p><strong>案例需求如图</strong>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687182519270-885589ec-7f4a-492a-ab78-cddf109121cc.png#averageHue=%23fbf6f6&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=430&amp;id=u4dde4f59&amp;originHeight=533&amp;originWidth=1362&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=64401&amp;status=done&amp;style=none&amp;taskId=u62c673b4-a71b-40bf-af49-a8c1a4df0de&amp;title=&amp;width=1098.7562672989704" alt="image.png" loading="lazy"></p>
<ol>
<li>声明一个名为<code v-pre>hmall.direct</code>的交换机</li>
<li>声明队列<code v-pre>direct.queue1</code>，绑定<code v-pre>hmall.direct</code>，<code v-pre>bindingKey</code>为<code v-pre>blud</code>和<code v-pre>red</code></li>
<li>声明队列<code v-pre>direct.queue2</code>，绑定<code v-pre>hmall.direct</code>，<code v-pre>bindingKey</code>为<code v-pre>yellow</code>和<code v-pre>red</code></li>
<li>在<code v-pre>consumer</code>服务中，编写两个消费者方法，分别监听direct.queue1和direct.queue2</li>
<li>在publisher中编写测试方法，向<code v-pre>hmall.direct</code>发送消息</li>
</ol>
<h3 id="_3-6-1-声明队列和交换机" tabindex="-1"><a class="header-anchor" href="#_3-6-1-声明队列和交换机"><span>3.6.1.声明队列和交换机</span></a></h3>
<p>首先在控制台声明两个队列<code v-pre>direct.queue1</code>和<code v-pre>direct.queue2</code>，这里不再展示过程：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689947864231-5ace5d74-fdac-4a2a-9f92-180df06fe4ad.png#averageHue=%23f2f0ef&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=403&amp;id=u292b8851&amp;originHeight=450&amp;originWidth=1157&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=56948&amp;status=done&amp;style=none&amp;taskId=uf110e543-1005-4b1a-b23e-d8529df3c0c&amp;title=&amp;width=1037.0868125704637" alt="image.png" loading="lazy">
然后声明一个direct类型的交换机，命名为<code v-pre>hmall.direct</code>:
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948033525-e6ea1134-c2ef-4b80-86b2-b364c1301335.png#averageHue=%23f8f6f6&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=367&amp;id=u0964090b&amp;originHeight=409&amp;originWidth=871&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=22938&amp;status=done&amp;style=none&amp;taskId=u127085fa-3898-488f-afef-52a7cbf9e2d&amp;title=&amp;width=780.7282746316974" alt="image.png" loading="lazy">
然后使用<code v-pre>red</code>和<code v-pre>blue</code>作为key，绑定<code v-pre>direct.queue1</code>到<code v-pre>hmall.direct</code>：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948151280-bed1019d-7d60-455b-95b8-754e266edf50.png#averageHue=%23f8f6f6&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=523&amp;id=uf5aa7079&amp;originHeight=583&amp;originWidth=942&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=35339&amp;status=done&amp;style=none&amp;taskId=u31d3c033-0a9a-446f-9ebc-a90405ba47d&amp;title=&amp;width=844.3697298542583" alt="image.png" loading="lazy">
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948181033-6b1e6556-0110-4ed8-a2cb-8bc2dd388903.png#averageHue=%23f8f6f6&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=522&amp;id=u4e6a2147&amp;originHeight=582&amp;originWidth=874&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=34608&amp;status=done&amp;style=none&amp;taskId=u274e41ea-73f2-4da5-bc23-fed091d234d&amp;title=&amp;width=783.4173502044816" alt="image.png" loading="lazy"></p>
<p>同理，使用<code v-pre>red</code>和<code v-pre>yellow</code>作为key，绑定<code v-pre>direct.queue2</code>到<code v-pre>hmall.direct</code>，步骤略，最终结果：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948243879-c97a0e6f-807a-4bc3-ad53-032c378008f3.png#averageHue=%23f4f4f3&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=515&amp;id=ufb0f0d5d&amp;originHeight=575&amp;originWidth=834&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=37957&amp;status=done&amp;style=none&amp;taskId=uaae894e6-bc07-4e01-bf1f-53561ffd05a&amp;title=&amp;width=747.5630092340249" alt="image.png" loading="lazy"></p>
<h3 id="_3-6-2-消息接收" tabindex="-1"><a class="header-anchor" href="#_3-6-2-消息接收"><span>3.6.2.消息接收</span></a></h3>
<p>在consumer服务的SpringRabbitListener中添加方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"direct.queue1"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenDirectQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到direct.queue1的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"direct.queue2"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenDirectQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2接收到direct.queue2的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-6-3-消息发送" tabindex="-1"><a class="header-anchor" href="#_3-6-3-消息发送"><span>3.6.3.消息发送</span></a></h3>
<p>在publisher服务的SpringAmqpTest类中添加测试方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testSendDirectExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 交换机名称</span>
    <span class="token class-name">String</span> exchangeName <span class="token operator">=</span> <span class="token string">"hmall.direct"</span><span class="token punctuation">;</span>
    <span class="token comment">// 消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"红色警报！日本乱排核废水，导致海洋生物变异，惊现哥斯拉！"</span><span class="token punctuation">;</span>
    <span class="token comment">// 发送消息</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>exchangeName<span class="token punctuation">,</span> <span class="token string">"red"</span><span class="token punctuation">,</span> message<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>由于使用的red这个key，所以两个消费者都收到了消息：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687182883516-906024ce-6ade-4dcd-8b4e-2b0cfc1bd03a.png#averageHue=%23f7f9f3&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=136&amp;id=uc0e2efee&amp;originHeight=168&amp;originWidth=1410&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=85796&amp;status=done&amp;style=none&amp;taskId=u4ab862c3-bb61-4a97-87d8-ac463218ab2&amp;title=&amp;width=1137.4789551332954" alt="image.png" loading="lazy">
我们再切换为blue这个key：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testSendDirectExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 交换机名称</span>
    <span class="token class-name">String</span> exchangeName <span class="token operator">=</span> <span class="token string">"hmall.direct"</span><span class="token punctuation">;</span>
    <span class="token comment">// 消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"最新报道，哥斯拉是居民自治巨型气球，虚惊一场！"</span><span class="token punctuation">;</span>
    <span class="token comment">// 发送消息</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>exchangeName<span class="token punctuation">,</span> <span class="token string">"blue"</span><span class="token punctuation">,</span> message<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>你会发现，只有消费者1收到了消息：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687182898732-afba28a8-c57e-4ccb-a330-9e3315879b31.png#averageHue=%23f7f9f4&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=175&amp;id=udcac360f&amp;originHeight=217&amp;originWidth=1237&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=99781&amp;status=done&amp;style=none&amp;taskId=ua85a2eca-9806-4a15-997d-ee3c73528b6&amp;title=&amp;width=997.9159343970824" alt="image.png" loading="lazy"></p>
<h3 id="_3-6-4-总结" tabindex="-1"><a class="header-anchor" href="#_3-6-4-总结"><span>3.6.4.总结</span></a></h3>
<p>描述下Direct交换机与Fanout交换机的差异？</p>
<ul>
<li>Fanout交换机将消息路由给每一个与之绑定的队列</li>
<li>Direct交换机根据RoutingKey判断路由给哪个队列</li>
<li>如果多个队列具有相同的RoutingKey，则与Fanout功能类似</li>
</ul>
<h2 id="_3-7-topic交换机" tabindex="-1"><a class="header-anchor" href="#_3-7-topic交换机"><span>3.7.Topic交换机</span></a></h2>
<h3 id="_3-7-1-说明" tabindex="-1"><a class="header-anchor" href="#_3-7-1-说明"><span>3.7.1.说明</span></a></h3>
<p><code v-pre>Topic</code>类型的<code v-pre>Exchange</code>与<code v-pre>Direct</code>相比，都是可以根据<code v-pre>RoutingKey</code>把消息路由到不同的队列。
只不过<code v-pre>Topic</code>类型<code v-pre>Exchange</code>可以让队列在绑定<code v-pre>BindingKey</code> 的时候使用通配符！</p>
<p><code v-pre>BindingKey</code> 一般都是有一个或多个单词组成，多个单词之间以<code v-pre>.</code>分割，例如： <code v-pre>item.insert</code></p>
<p>通配符规则：</p>
<ul>
<li><code v-pre>#</code>：匹配一个或多个词</li>
<li><code v-pre>*</code>：匹配不多不少恰好1个词</li>
</ul>
<p>举例：</p>
<ul>
<li><code v-pre>item.#</code>：能够匹配<code v-pre>item.spu.insert</code> 或者 <code v-pre>item.spu</code></li>
<li><code v-pre>item.*</code>：只能匹配<code v-pre>item.spu</code></li>
</ul>
<p>图示：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687183148068-ad50ba76-0024-460b-9b24-3cf7a0fe172e.png#averageHue=%23f9f4f3&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=305&amp;id=u74a65bd0&amp;originHeight=378&amp;originWidth=1337&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=57084&amp;status=done&amp;style=none&amp;taskId=u90f6bfb4-4f10-4ebe-8edb-70856565f27&amp;title=&amp;width=1078.5882007185928" alt="image.png" loading="lazy">
假如此时publisher发送的消息使用的<code v-pre>RoutingKey</code>共有四种：</p>
<ul>
<li><code v-pre>china.news </code>代表有中国的新闻消息；</li>
<li><code v-pre>china.weather</code> 代表中国的天气消息；</li>
<li><code v-pre>japan.news</code> 则代表日本新闻</li>
<li><code v-pre>japan.weather</code> 代表日本的天气消息；</li>
</ul>
<p>解释：</p>
<ul>
<li><code v-pre>topic.queue1</code>：绑定的是<code v-pre>china.#</code> ，凡是以 <code v-pre>china.</code>开头的<code v-pre>routing key</code> 都会被匹配到，包括：
<ul>
<li><code v-pre>china.news</code></li>
<li><code v-pre>china.weather</code></li>
</ul>
</li>
<li><code v-pre>topic.queue2</code>：绑定的是<code v-pre>#.news</code> ，凡是以 <code v-pre>.news</code>结尾的 <code v-pre>routing key</code> 都会被匹配。包括:
<ul>
<li><code v-pre>china.news</code></li>
<li><code v-pre>japan.news</code></li>
</ul>
</li>
</ul>
<p>接下来，我们就按照上图所示，来演示一下Topic交换机的用法。
首先，在控制台按照图示例子创建队列、交换机，并利用通配符绑定队列和交换机。此处步骤略。最终结果如下：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689948475987-05bab459-43b6-47ad-bbfc-faf9f50d776e.png#averageHue=%23f5f5f4&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=419&amp;id=u3d545ee6&amp;originHeight=468&amp;originWidth=879&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=32637&amp;status=done&amp;style=none&amp;taskId=u1bf5deb0-6b33-48e6-9d9d-d273a1be805&amp;title=&amp;width=787.8991428257888" alt="image.png" loading="lazy"></p>
<h3 id="_3-7-2-消息发送" tabindex="-1"><a class="header-anchor" href="#_3-7-2-消息发送"><span>3.7.2.消息发送</span></a></h3>
<p>在publisher服务的SpringAmqpTest类中添加测试方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token doc-comment comment">/**
 * topicExchange
 */</span>
<span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testSendTopicExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 交换机名称</span>
    <span class="token class-name">String</span> exchangeName <span class="token operator">=</span> <span class="token string">"hmall.topic"</span><span class="token punctuation">;</span>
    <span class="token comment">// 消息</span>
    <span class="token class-name">String</span> message <span class="token operator">=</span> <span class="token string">"喜报！孙悟空大战哥斯拉，胜!"</span><span class="token punctuation">;</span>
    <span class="token comment">// 发送消息</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span>exchangeName<span class="token punctuation">,</span> <span class="token string">"china.news"</span><span class="token punctuation">,</span> message<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-7-3-消息接收" tabindex="-1"><a class="header-anchor" href="#_3-7-3-消息接收"><span>3.7.3.消息接收</span></a></h3>
<p>在consumer服务的SpringRabbitListener中添加方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"topic.queue1"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenTopicQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到topic.queue1的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"topic.queue2"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenTopicQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2接收到topic.queue2的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-7-4-总结" tabindex="-1"><a class="header-anchor" href="#_3-7-4-总结"><span>3.7.4.总结</span></a></h3>
<p>描述下Direct交换机与Topic交换机的差异？</p>
<ul>
<li>Topic交换机接收的消息RoutingKey必须是多个单词，以 <code v-pre>**.**</code> 分割</li>
<li>Topic交换机与队列绑定时的bindingKey可以指定通配符</li>
<li><code v-pre>#</code>：代表0个或多个词</li>
<li><code v-pre>*</code>：代表1个词</li>
</ul>
<h2 id="_3-8-声明队列和交换机" tabindex="-1"><a class="header-anchor" href="#_3-8-声明队列和交换机"><span>3.8.声明队列和交换机</span></a></h2>
<p>在之前我们都是基于RabbitMQ控制台来创建队列、交换机。但是在实际开发时，队列和交换机是程序员定义的，将来项目上线，又要交给运维去创建。那么程序员就需要把程序中运行的所有队列和交换机都写下来，交给运维。在这个过程中是很容易出现错误的。
因此推荐的做法是由程序启动时检查队列和交换机是否存在，如果不存在自动创建。</p>
<h3 id="_3-8-1-基本api" tabindex="-1"><a class="header-anchor" href="#_3-8-1-基本api"><span>3.8.1.基本API</span></a></h3>
<p>SpringAMQP提供了一个Queue类，用来创建队列：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689945200636-5f4a823f-6f36-4088-9b67-7b9b3ae48079.png#averageHue=%23f9fcf7&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=241&amp;id=u2a7bba30&amp;originHeight=269&amp;originWidth=930&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=42392&amp;status=done&amp;style=none&amp;taskId=uf1b5d62e-4e09-4ba8-a011-f8345dac005&amp;title=&amp;width=833.6134275631213" alt="image.png" loading="lazy"></p>
<p>SpringAMQP还提供了一个Exchange接口，来表示所有不同类型的交换机：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687181804385-c500bc13-9f81-4071-ad8a-598fa5f57d97.png#averageHue=%23f8f8f7&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=379&amp;id=Qewqz&amp;originHeight=470&amp;originWidth=1469&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=23466&amp;status=done&amp;style=none&amp;taskId=u357861af-c5aa-43c4-aafd-97dadaf8714&amp;title=&amp;width=1185.0755922629864" alt="image.png" loading="lazy">
我们可以自己创建队列和交换机，不过SpringAMQP还提供了ExchangeBuilder来简化这个过程：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689945421476-fe44bf9a-d6eb-4f51-af02-374359c8e70b.png#averageHue=%23f8f7f5&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=278&amp;id=uae4334fe&amp;originHeight=310&amp;originWidth=781&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=34426&amp;status=done&amp;style=none&amp;taskId=uc1b7bc5b-68b9-4ce9-afe5-9eb733e8f4b&amp;title=&amp;width=700.0560074481696" alt="image.png" loading="lazy">
而在绑定队列和交换机时，则需要使用BindingBuilder来创建Binding对象：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1689945503733-13d2179c-f586-4de5-b18c-d3b5749f1f96.png#averageHue=%23dcab6a&amp;clientId=uf6195e90-5366-4&amp;from=paste&amp;height=145&amp;id=u91096ccd&amp;originHeight=162&amp;originWidth=659&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=16128&amp;status=done&amp;style=none&amp;taskId=u1da153f0-6e86-45b2-900b-8f83e489358&amp;title=&amp;width=590.7002674882763" alt="image.png" loading="lazy"></p>
<h3 id="_3-8-2-fanout示例" tabindex="-1"><a class="header-anchor" href="#_3-8-2-fanout示例"><span>3.8.2.fanout示例</span></a></h3>
<p>在consumer中创建一个类，声明队列和交换机：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">Binding</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">BindingBuilder</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">FanoutExchange</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">Queue</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Bean</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">FanoutConfig</span> <span class="token punctuation">{</span>
    <span class="token doc-comment comment">/**
     * 声明交换机
     * <span class="token keyword">@return</span> Fanout类型交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">FanoutExchange</span> <span class="token function">fanoutExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">FanoutExchange</span><span class="token punctuation">(</span><span class="token string">"hmall.fanout"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 第1个队列
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">fanoutQueue1</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"fanout.queue1"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue1</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> fanoutQueue1<span class="token punctuation">,</span> <span class="token class-name">FanoutExchange</span> fanoutExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>fanoutQueue1<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>fanoutExchange<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 第2个队列
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">fanoutQueue2</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"fanout.queue2"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue2</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> fanoutQueue2<span class="token punctuation">,</span> <span class="token class-name">FanoutExchange</span> fanoutExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>fanoutQueue2<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>fanoutExchange<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-8-2-direct示例" tabindex="-1"><a class="header-anchor" href="#_3-8-2-direct示例"><span>3.8.2.direct示例</span></a></h3>
<p>direct模式由于要绑定多个KEY，会非常麻烦，每一个Key都要编写一个binding：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token operator">*</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Bean</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">DirectConfig</span> <span class="token punctuation">{</span>

    <span class="token doc-comment comment">/**
     * 声明交换机
     * <span class="token keyword">@return</span> Direct类型交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">DirectExchange</span> <span class="token function">directExchange</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">ExchangeBuilder</span><span class="token punctuation">.</span><span class="token function">directExchange</span><span class="token punctuation">(</span><span class="token string">"hmall.direct"</span><span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token function">build</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 第1个队列
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">directQueue1</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"direct.queue1"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue1WithRed</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> directQueue1<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> directExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>directQueue1<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>directExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"red"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue1WithBlue</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> directQueue1<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> directExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>directQueue1<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>directExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"blue"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 第2个队列
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">directQueue2</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"direct.queue2"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue2WithRed</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> directQueue2<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> directExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>directQueue2<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>directExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"red"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token doc-comment comment">/**
     * 绑定队列和交换机
     */</span>
    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Binding</span> <span class="token function">bindingQueue2WithYellow</span><span class="token punctuation">(</span><span class="token class-name">Queue</span> directQueue2<span class="token punctuation">,</span> <span class="token class-name">DirectExchange</span> directExchange<span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token class-name">BindingBuilder</span><span class="token punctuation">.</span><span class="token function">bind</span><span class="token punctuation">(</span>directQueue2<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">to</span><span class="token punctuation">(</span>directExchange<span class="token punctuation">)</span><span class="token punctuation">.</span><span class="token keyword">with</span><span class="token punctuation">(</span><span class="token string">"yellow"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-8-4-基于注解声明" tabindex="-1"><a class="header-anchor" href="#_3-8-4-基于注解声明"><span>3.8.4.基于注解声明</span></a></h3>
<p>基于@Bean的方式声明队列和交换机比较麻烦，Spring还提供了基于注解方式来声明。</p>
<p>例如，我们同样声明Direct模式的交换机和队列：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
    value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"direct.queue1"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"hmall.direct"</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">DIRECT</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    key <span class="token operator">=</span> <span class="token punctuation">{</span><span class="token string">"red"</span><span class="token punctuation">,</span> <span class="token string">"blue"</span><span class="token punctuation">}</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenDirectQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到direct.queue1的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
    value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"direct.queue2"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"hmall.direct"</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">DIRECT</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    key <span class="token operator">=</span> <span class="token punctuation">{</span><span class="token string">"red"</span><span class="token punctuation">,</span> <span class="token string">"yellow"</span><span class="token punctuation">}</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenDirectQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2接收到direct.queue2的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>是不是简单多了。
再试试Topic模式：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
    value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"topic.queue1"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"hmall.topic"</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">TOPIC</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    key <span class="token operator">=</span> <span class="token string">"china.#"</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenTopicQueue1</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者1接收到topic.queue1的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
    value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"topic.queue2"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"hmall.topic"</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">TOPIC</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    key <span class="token operator">=</span> <span class="token string">"#.news"</span>
<span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenTopicQueue2</span><span class="token punctuation">(</span><span class="token class-name">String</span> msg<span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者2接收到topic.queue2的消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_3-9-消息转换器" tabindex="-1"><a class="header-anchor" href="#_3-9-消息转换器"><span>3.9.消息转换器</span></a></h2>
<p>Spring的消息发送代码接收的消息体是一个Object：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687183652317-82b0319b-03aa-46ed-afbc-373e7a6fa0f1.png#averageHue=%23f6f9f5&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=394&amp;id=u2c63fbb1&amp;originHeight=488&amp;originWidth=1448&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=122291&amp;status=done&amp;style=none&amp;taskId=u0da81780-720e-4c27-9c2f-c24d7dc0123&amp;title=&amp;width=1168.1344163354693" alt="image.png" loading="lazy">
而在数据传输时，它会把你发送的消息序列化为字节发送给MQ，接收消息的时候，还会把字节反序列化为Java对象。
只不过，默认情况下Spring采用的序列化方式是JDK序列化。众所周知，JDK序列化存在下列问题：</p>
<ul>
<li>数据体积过大</li>
<li>有安全漏洞</li>
<li>可读性差</li>
</ul>
<p>我们来测试一下。</p>
<h3 id="_3-9-1-测试默认转换器" tabindex="-1"><a class="header-anchor" href="#_3-9-1-测试默认转换器"><span>3.9.1.测试默认转换器</span></a></h3>
<p>1）创建测试队列
首先，我们在consumer服务中声明一个新的配置类：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687183868403-242aa812-a07f-4748-8863-dc5d1e161dc1.png#averageHue=%23f9fbf8&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=351&amp;id=u77b665f4&amp;originHeight=435&amp;originWidth=1053&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=48481&amp;status=done&amp;style=none&amp;taskId=uf6d36991-ec76-497c-93d3-3e96d9d6590&amp;title=&amp;width=849.4789643655035" alt="image.png" loading="lazy">
利用@Bean的方式创建一个队列，具体代码：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>itheima<span class="token punctuation">.</span>consumer<span class="token punctuation">.</span>config</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">Queue</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Bean</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>context<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Configuration</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">MessageConfig</span> <span class="token punctuation">{</span>

    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">Queue</span> <span class="token function">objectQueue</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token keyword">new</span> <span class="token class-name">Queue</span><span class="token punctuation">(</span><span class="token string">"object.queue"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意，这里我们先不要给这个队列添加消费者，我们要查看消息体的格式。</p>
<p>重启consumer服务以后，该队列就会被自动创建出来了：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687184033157-c4c8e59e-a2b3-4b2b-9c20-ca3c597e556c.png#averageHue=%23f3f0ef&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=456&amp;id=u7c3fdb16&amp;originHeight=565&amp;originWidth=1196&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=72445&amp;status=done&amp;style=none&amp;taskId=u03cddb0f-41a3-483d-83c7-d53a5ecb269&amp;title=&amp;width=964.8403052052632" alt="image.png" loading="lazy"></p>
<p>2）发送消息
我们在publisher模块的SpringAmqpTest中新增一个消息发送的代码，发送一个Map对象：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Test</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testSendMap</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    <span class="token comment">// 准备消息</span>
    <span class="token class-name">Map</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">String</span><span class="token punctuation">,</span><span class="token class-name">Object</span><span class="token punctuation">></span></span> msg <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">HashMap</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    msg<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token string">"柳岩"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    msg<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"age"</span><span class="token punctuation">,</span> <span class="token number">21</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 发送消息</span>
    rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span><span class="token string">"object.queue"</span><span class="token punctuation">,</span> msg<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>发送消息后查看控制台：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687184206574-69117533-5b4e-4172-b254-23130023f711.png#averageHue=%23f9f7f7&amp;clientId=u0fe93ba5-a0ba-4&amp;from=paste&amp;height=528&amp;id=u038b25c3&amp;originHeight=654&amp;originWidth=1244&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=46749&amp;status=done&amp;style=none&amp;taskId=u8bea522c-fa98-48f1-bd84-1acfb50fff8&amp;title=&amp;width=1003.5629930395882" alt="image.png" loading="lazy">
可以看到消息格式非常不友好。</p>
<h3 id="_3-9-2-配置json转换器" tabindex="-1"><a class="header-anchor" href="#_3-9-2-配置json转换器"><span>3.9.2.配置JSON转换器</span></a></h3>
<p>显然，JDK序列化方式并不合适。我们希望消息体的体积更小、可读性更高，因此可以使用JSON方式来做序列化和反序列化。</p>
<p>在<code v-pre>publisher</code>和<code v-pre>consumer</code>两个服务中都引入依赖：</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>com.fasterxml.jackson.dataformat<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>jackson-dataformat-xml<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>2.9.10<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意，如果项目中引入了<code v-pre>spring-boot-starter-web</code>依赖，则无需再次引入<code v-pre>Jackson</code>依赖。</p>
<p>配置消息转换器，在<code v-pre>publisher</code>和<code v-pre>consumer</code>两个服务的启动类中添加一个Bean即可：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Bean</span>
<span class="token keyword">public</span> <span class="token class-name">MessageConverter</span> <span class="token function">messageConverter</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
    <span class="token comment">// 1.定义消息转换器</span>
    <span class="token class-name">Jackson2JsonMessageConverter</span> jackson2JsonMessageConverter <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Jackson2JsonMessageConverter</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 2.配置自动创建消息id，用于识别不同消息，也可以在业务中基于ID判断是否是重复消息</span>
    jackson2JsonMessageConverter<span class="token punctuation">.</span><span class="token function">setCreateMessageIds</span><span class="token punctuation">(</span><span class="token boolean">true</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">return</span> jackson2JsonMessageConverter<span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>消息转换器中添加的messageId可以便于我们将来做幂等性判断。</p>
<p>此时，我们到MQ控制台<strong>删除</strong><code v-pre>object.queue</code>中的旧的消息。然后再次执行刚才的消息发送的代码，到MQ的控制台查看消息结构：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1687245684217-8b401cc5-29e6-4d08-9a9b-4fbe0dffd486.png#averageHue=%23f9f7f7&amp;clientId=ucdd993b6-34bc-4&amp;from=paste&amp;height=432&amp;id=ue5acc96b&amp;originHeight=535&amp;originWidth=990&amp;originalType=binary&amp;ratio=1.2395833730697632&amp;rotation=0&amp;showTitle=false&amp;size=41352&amp;status=done&amp;style=none&amp;taskId=u158a691b-c3b3-4103-993a-3064dc7139b&amp;title=&amp;width=798.655436582952" alt="image.png" loading="lazy"></p>
<h3 id="_3-9-3-消费者接收object" tabindex="-1"><a class="header-anchor" href="#_3-9-3-消费者接收object"><span>3.9.3.消费者接收Object</span></a></h3>
<p>我们在consumer服务中定义一个新的消费者，publisher是用Map发送，那么消费者也一定要用Map接收，格式如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>queues <span class="token operator">=</span> <span class="token string">"object.queue"</span><span class="token punctuation">)</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenSimpleQueueMessage</span><span class="token punctuation">(</span><span class="token class-name">Map</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">String</span><span class="token punctuation">,</span> <span class="token class-name">Object</span><span class="token punctuation">></span></span> msg<span class="token punctuation">)</span> <span class="token keyword">throws</span> <span class="token class-name">InterruptedException</span> <span class="token punctuation">{</span>
    <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"消费者接收到object.queue消息：【"</span> <span class="token operator">+</span> msg <span class="token operator">+</span> <span class="token string">"】"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h1 id="_4-业务改造" tabindex="-1"><a class="header-anchor" href="#_4-业务改造"><span>4.业务改造</span></a></h1>
<p>案例需求：改造余额支付功能，将支付成功后基于OpenFeign的交易服务的更新订单状态接口的同步调用，改为基于RabbitMQ的异步通知。
如图：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1690336853591-c874697b-688c-464e-8797-8162a02701e8.png#averageHue=%23faf3f3&amp;clientId=u2c434c61-ffda-4&amp;from=paste&amp;height=396&amp;id=ud83a0c53&amp;originHeight=442&amp;originWidth=1282&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=66835&amp;status=done&amp;style=none&amp;taskId=uac12f07b-6953-4628-933f-82655332fb7&amp;title=&amp;width=1149.1316281031413" alt="image.png" loading="lazy">
说明，我们只关注交易服务，步骤如下：</p>
<ul>
<li>定义topic类型交换机，命名为<code v-pre>pay.topic</code></li>
<li>定义消息队列，命名为<code v-pre>mark.order.pay.queue</code></li>
<li>将<code v-pre>mark.order.pay.queue</code>与<code v-pre>pay.topic</code>绑定，<code v-pre>BindingKey</code>为<code v-pre>pay.success</code></li>
<li>支付成功时不再调用交易服务更新订单状态的接口，而是发送一条消息到<code v-pre>pay.topic</code>，发送消息的<code v-pre>RoutingKey</code>  为<code v-pre>pay.success</code>，消息内容是订单id</li>
<li>交易服务监听<code v-pre>mark.order.pay.queue</code>队列，接收到消息后更新订单状态为已支付</li>
</ul>
<h2 id="_4-1-配置mq" tabindex="-1"><a class="header-anchor" href="#_4-1-配置mq"><span>4.1.配置MQ</span></a></h2>
<p>不管是生产者还是消费者，都需要配置MQ的基本信息。分为两步：
1）添加依赖：</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code>  <span class="token comment">&lt;!--消息发送--></span>
  <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
      <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
      <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-amqp<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
  <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2）配置MQ地址：</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">rabbitmq</span><span class="token punctuation">:</span>
    <span class="token key atrule">host</span><span class="token punctuation">:</span> 192.168.150.101 <span class="token comment"># 你的虚拟机IP</span>
    <span class="token key atrule">port</span><span class="token punctuation">:</span> <span class="token number">5672</span> <span class="token comment"># 端口</span>
    <span class="token key atrule">virtual-host</span><span class="token punctuation">:</span> /hmall <span class="token comment"># 虚拟主机</span>
    <span class="token key atrule">username</span><span class="token punctuation">:</span> hmall <span class="token comment"># 用户名</span>
    <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">123</span> <span class="token comment"># 密码</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_4-1-接收消息" tabindex="-1"><a class="header-anchor" href="#_4-1-接收消息"><span>4.1.接收消息</span></a></h2>
<p>在trade-service服务中定义一个消息监听类：
<img src="https://cdn.nlark.com/yuque/0/2023/png/27967491/1690339169409-cf6a9ad7-c364-4a26-992d-dd678f53e910.png#averageHue=%23f9fbf8&amp;clientId=u2c434c61-ffda-4&amp;from=paste&amp;height=362&amp;id=uc197e23b&amp;originHeight=404&amp;originWidth=899&amp;originalType=binary&amp;ratio=1.115625023841858&amp;rotation=0&amp;showTitle=false&amp;size=38311&amp;status=done&amp;style=none&amp;taskId=u11e78c89-237d-4689-a03a-1caed96b8fe&amp;title=&amp;width=805.8263133110172" alt="image.png" loading="lazy">
其代码如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">package</span> <span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>listener</span><span class="token punctuation">;</span>

<span class="token keyword">import</span> <span class="token import"><span class="token namespace">com<span class="token punctuation">.</span>hmall<span class="token punctuation">.</span>trade<span class="token punctuation">.</span>service<span class="token punctuation">.</span></span><span class="token class-name">IOrderService</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">lombok<span class="token punctuation">.</span></span><span class="token class-name">RequiredArgsConstructor</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>core<span class="token punctuation">.</span></span><span class="token class-name">ExchangeTypes</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Exchange</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">Queue</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">QueueBinding</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>amqp<span class="token punctuation">.</span>rabbit<span class="token punctuation">.</span>annotation<span class="token punctuation">.</span></span><span class="token class-name">RabbitListener</span></span><span class="token punctuation">;</span>
<span class="token keyword">import</span> <span class="token import"><span class="token namespace">org<span class="token punctuation">.</span>springframework<span class="token punctuation">.</span>stereotype<span class="token punctuation">.</span></span><span class="token class-name">Component</span></span><span class="token punctuation">;</span>

<span class="token annotation punctuation">@Component</span>
<span class="token annotation punctuation">@RequiredArgsConstructor</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">PayStatusListener</span> <span class="token punctuation">{</span>

    <span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">IOrderService</span> orderService<span class="token punctuation">;</span>

    <span class="token annotation punctuation">@RabbitListener</span><span class="token punctuation">(</span>bindings <span class="token operator">=</span> <span class="token annotation punctuation">@QueueBinding</span><span class="token punctuation">(</span>
            value <span class="token operator">=</span> <span class="token annotation punctuation">@Queue</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"mark.order.pay.queue"</span><span class="token punctuation">,</span> durable <span class="token operator">=</span> <span class="token string">"true"</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
            exchange <span class="token operator">=</span> <span class="token annotation punctuation">@Exchange</span><span class="token punctuation">(</span>name <span class="token operator">=</span> <span class="token string">"pay.topic"</span><span class="token punctuation">,</span> type <span class="token operator">=</span> <span class="token class-name">ExchangeTypes</span><span class="token punctuation">.</span><span class="token constant">TOPIC</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
            key <span class="token operator">=</span> <span class="token string">"pay.success"</span>
    <span class="token punctuation">)</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">listenPaySuccess</span><span class="token punctuation">(</span><span class="token class-name">Long</span> orderId<span class="token punctuation">)</span><span class="token punctuation">{</span>
        orderService<span class="token punctuation">.</span><span class="token function">markOrderPaySuccess</span><span class="token punctuation">(</span>orderId<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_4-2-发送消息" tabindex="-1"><a class="header-anchor" href="#_4-2-发送消息"><span>4.2.发送消息</span></a></h2>
<p>修改<code v-pre>pay-service</code>服务下的<code v-pre>com.hmall.pay.service.impl.PayOrderServiceImpl</code>类中的<code v-pre>tryPayOrderByBalance</code>方法：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">private</span> <span class="token keyword">final</span> <span class="token class-name">RabbitTemplate</span> rabbitTemplate<span class="token punctuation">;</span>

<span class="token annotation punctuation">@Override</span>
<span class="token annotation punctuation">@Transactional</span>
<span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">tryPayOrderByBalance</span><span class="token punctuation">(</span><span class="token class-name">PayOrderDTO</span> payOrderDTO<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 1.查询支付单</span>
    <span class="token class-name">PayOrder</span> po <span class="token operator">=</span> <span class="token function">getById</span><span class="token punctuation">(</span>payOrderDTO<span class="token punctuation">.</span><span class="token function">getId</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 2.判断状态</span>
    <span class="token keyword">if</span><span class="token punctuation">(</span><span class="token operator">!</span><span class="token class-name">PayStatus</span><span class="token punctuation">.</span><span class="token constant">WAIT_BUYER_PAY</span><span class="token punctuation">.</span><span class="token function">equalsValue</span><span class="token punctuation">(</span>po<span class="token punctuation">.</span><span class="token function">getStatus</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token comment">// 订单不是未支付，状态异常</span>
        <span class="token keyword">throw</span> <span class="token keyword">new</span> <span class="token class-name">BizIllegalException</span><span class="token punctuation">(</span><span class="token string">"交易已支付或关闭！"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token comment">// 3.尝试扣减余额</span>
    userClient<span class="token punctuation">.</span><span class="token function">deductMoney</span><span class="token punctuation">(</span>payOrderDTO<span class="token punctuation">.</span><span class="token function">getPw</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> po<span class="token punctuation">.</span><span class="token function">getAmount</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token comment">// 4.修改支付单状态</span>
    <span class="token keyword">boolean</span> success <span class="token operator">=</span> <span class="token function">markPayOrderSuccess</span><span class="token punctuation">(</span>payOrderDTO<span class="token punctuation">.</span><span class="token function">getId</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token class-name">LocalDateTime</span><span class="token punctuation">.</span><span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token operator">!</span>success<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">throw</span> <span class="token keyword">new</span> <span class="token class-name">BizIllegalException</span><span class="token punctuation">(</span><span class="token string">"交易已支付或关闭！"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token comment">// 5.修改订单状态</span>
    <span class="token comment">// tradeClient.markOrderPaySuccess(po.getBizOrderNo());</span>
    <span class="token keyword">try</span> <span class="token punctuation">{</span>
        rabbitTemplate<span class="token punctuation">.</span><span class="token function">convertAndSend</span><span class="token punctuation">(</span><span class="token string">"pay.topic"</span><span class="token punctuation">,</span> <span class="token string">"pay.success"</span><span class="token punctuation">,</span> po<span class="token punctuation">.</span><span class="token function">getBizOrderNo</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span> <span class="token keyword">catch</span> <span class="token punctuation">(</span><span class="token class-name">Exception</span> e<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        log<span class="token punctuation">.</span><span class="token function">error</span><span class="token punctuation">(</span><span class="token string">"支付成功的消息发送失败，支付单id：{}， 交易单id：{}"</span><span class="token punctuation">,</span> po<span class="token punctuation">.</span><span class="token function">getId</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> po<span class="token punctuation">.</span><span class="token function">getBizOrderNo</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> e<span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h1 id="_5-练习" tabindex="-1"><a class="header-anchor" href="#_5-练习"><span>5.练习</span></a></h1>
<h2 id="_5-1-抽取共享的mq配置" tabindex="-1"><a class="header-anchor" href="#_5-1-抽取共享的mq配置"><span>5.1.抽取共享的MQ配置</span></a></h2>
<p>将MQ配置抽取到Nacos中管理，微服务中直接使用共享配置。</p>
<h2 id="_5-2-改造下单功能" tabindex="-1"><a class="header-anchor" href="#_5-2-改造下单功能"><span>5.2.改造下单功能</span></a></h2>
<p>改造下单功能，将基于OpenFeign的清理购物车同步调用，改为基于RabbitMQ的异步通知：</p>
<ul>
<li>定义topic类型交换机，命名为<code v-pre>trade.topic</code></li>
<li>定义消息队列，命名为<code v-pre>cart.clear.queue</code></li>
<li>将<code v-pre>cart.clear.queue</code>与<code v-pre>trade.topic</code>绑定，<code v-pre>BindingKey</code>为<code v-pre>order.create</code></li>
<li>下单成功时不再调用清理购物车接口，而是发送一条消息到<code v-pre>trade.topic</code>，发送消息的<code v-pre>RoutingKey</code>  为<code v-pre>order.create</code>，消息内容是下单的具体商品、当前登录用户信息</li>
<li>购物车服务监听<code v-pre>cart.clear.queue</code>队列，接收到消息后清理指定用户的购物车中的指定商品</li>
</ul>
<h2 id="_5-3-登录信息传递优化" tabindex="-1"><a class="header-anchor" href="#_5-3-登录信息传递优化"><span>5.3.登录信息传递优化</span></a></h2>
<p>某些业务中，需要根据登录用户信息处理业务，而基于MQ的异步调用并不会传递登录用户信息。前面我们的做法比较麻烦，至少要做两件事：</p>
<ul>
<li>消息发送者在消息体中传递登录用户</li>
<li>消费者获取消息体中的登录用户，处理业务</li>
</ul>
<p>这样做不仅麻烦，而且编程体验也不统一，毕竟我们之前都是使用UserContext来获取用户。</p>
<p>大家思考一下：有没有更优雅的办法传输登录用户信息，让使用MQ的人无感知，依然采用UserContext来随时获取用户。</p>
<p>参考资料：
<a href="https://docs.spring.io/spring-amqp/docs/2.4.14/reference/html/#post-processing" target="_blank" rel="noopener noreferrer">Spring AMQP</a></p>
<h2 id="_5-4-改造项目一" tabindex="-1"><a class="header-anchor" href="#_5-4-改造项目一"><span>5.4.改造项目一</span></a></h2>
<p>思考一下，项目一中的哪些业务可以由同步方式改为异步方式调用？试着改造一下。
举例：短信发送</p>
</div></template>


