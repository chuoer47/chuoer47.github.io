<template><div><!--more--->
<h1 id="苍穹外卖" tabindex="-1"><a class="header-anchor" href="#苍穹外卖"><span>苍穹外卖</span></a></h1>
<p>本项目是使用 Spring Boot 框架开发的一个在线外卖订购系统。</p>
<h2 id="技术栈" tabindex="-1"><a class="header-anchor" href="#技术栈"><span>技术栈</span></a></h2>
<p>SpringBoot+MyBatis+MySQL+Redis+JWT</p>
<h2 id="实现功能" tabindex="-1"><a class="header-anchor" href="#实现功能"><span>实现功能</span></a></h2>
<p>管理端实现员工，菜品，订单管理，来单提醒以及数据统计等功能；</p>
<p>用户端实现购物车，订单下单与催单等功能。</p>
<p>实现优惠券秒杀功能（待完成）</p>
<h2 id="项目亮点" tabindex="-1"><a class="header-anchor" href="#项目亮点"><span>项目亮点</span></a></h2>
<ul>
<li>使用JWT令牌技术并自定义拦截器完成用户认证，并使用ThreadLocal配合拦截器进行Token的校验。</li>
<li>使用SpringCache+Redis缓存菜品与套餐数据，增加查询效率并保持数据一致性，将响应时间从140ms降低至30ms。</li>
<li>使用SpringTask实现订单状态定时处理，超时订单自动取消。</li>
<li>基于WebSocket与前端通信实现来单提醒以及催单功能。</li>
<li>基于AOP实现公共字段(例如更新时间)的自动填充，减少代码降低耦合。</li>
<li>使用Nginx作为HTTP服务器，部署反向代理以及负载均衡。</li>
</ul>
</div></template>


