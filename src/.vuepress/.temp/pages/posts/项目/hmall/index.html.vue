<template><div><!--more--->
<h1 id="黑马商城" tabindex="-1"><a class="header-anchor" href="#黑马商城"><span>黑马商城</span></a></h1>
<p>基于SSM框架的B2C电商平台项目。</p>
<h2 id="技术栈" tabindex="-1"><a class="header-anchor" href="#技术栈"><span>技术栈</span></a></h2>
<p>SpringBoot+SpringCloud+MyBatisPlus+MySQL+Redis+Nacos+RabbitMQ+Sentinel+Seata+ElasticSearch</p>
<h2 id="实现功能" tabindex="-1"><a class="header-anchor" href="#实现功能"><span>实现功能</span></a></h2>
<ul>
<li>包括商品管理、用户模块、搜索、购物车、订单、支付及物流等核心功能。</li>
</ul>
<h2 id="项目亮点" tabindex="-1"><a class="header-anchor" href="#项目亮点"><span>项目亮点</span></a></h2>
<ul>
<li>基于 ELK技术栈，实现商品的搜索，提升搜索速度，并且实现竞价排名;</li>
<li>基于 Redis 构建高速缓存组件，如:用户 Session、页面导航缓存、活动广告、排行热点、比赛动态数据更新进行实现:</li>
<li>使用 RabbitMQ 作为项目消息中间件进行异步通讯，实现库存的扣除，以及超时取消订单等任务，提高系统可用性。</li>
<li>使用Sentinel对服务进行保护，实现线程隔离和服务熔断，提高了业务健壮性，降低级联失败问题的出现。</li>
<li>使用Seata实现分布式事务，保证了数据的一致性。</li>
</ul>
</div></template>


