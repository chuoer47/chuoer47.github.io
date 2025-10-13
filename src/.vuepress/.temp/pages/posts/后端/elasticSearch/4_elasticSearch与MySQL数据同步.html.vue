<template><div><!--more--->
<h1 id="es与mysql数据同步" tabindex="-1"><a class="header-anchor" href="#es与mysql数据同步"><span>ES与MySQL数据同步</span></a></h1>
<p>在实际项目开发中，常用Mysql作为业务数据库，ElasticSearch作为查询库。ElasticSearch主要用来应对海量数据的复杂查询，提高查询效率和缓解Mysql数据库的压力。如何实现 MySQL 数据库和ElasticSearch之间的数据同步也是为非常关键的，下面介绍几种常见的数据同步方案方案。</p>
<h2 id="一、同步双写方案" tabindex="-1"><a class="header-anchor" href="#一、同步双写方案"><span>一、同步双写方案</span></a></h2>
<figure><img src="/image\es\es14.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>同步双写是指在Mysql上进行数据增删改操作时，同步将数据写入到ElasticSearch中，使用此方式保证Mysql与ElasticSearch中的数据一致性的优/缺点如下：</p>
<div class="hint-container tip">
<p class="hint-container-title">优点 :</p>
<ul>
<li>实现简单；</li>
<li>实时性高</li>
</ul>
</div>
<div class="hint-container warning">
<p class="hint-container-title">缺点:</p>
<ul>
<li>1、存在数据丢失风险；</li>
<li>2、性能不高；</li>
<li>3、和业务之间的耦合性强；</li>
<li>4、不方便做扩展</li>
</ul>
</div>
<h2 id="二、异步双写方案" tabindex="-1"><a class="header-anchor" href="#二、异步双写方案"><span>二、异步双写方案</span></a></h2>
<figure><img src="/image\es\es15.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>在Mysql上进行数据增删改操作时，通过MQ（如Kafka）异步将数据写入到ElasticSearch中。这种异步方式可以降低Mysql的写入延迟并有效的防止了ElasticSearch自身问题而影响到Mysql数据的写入，但是可能会出现存在Mysql和ElasticSearch数据长时间的不一致的现象。此方案的优缺点如下：</p>
<div class="hint-container tip">
<p class="hint-container-title">优点：</p>
<p>性能高；数据不易丢失；支持多数据源写入</p>
</div>
<div class="hint-container warning">
<p class="hint-container-title">缺点</p>
<p>1、增加了系统的复杂度，因为需要接入MQ；</p>
<p>2、数据之间的同步可能延迟高，MQ消费可能不及时；</p>
<p>3、发送消息需要硬编码到业务中；</p>
</div>
<h2 id="三、定时任务同步方案" tabindex="-1"><a class="header-anchor" href="#三、定时任务同步方案"><span>三、定时任务同步方案</span></a></h2>
<figure><img src="/image\es\es16.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>定时任务的方案就是设定一个频率去Mysql中拉取数据来同步到ElasticSearch中，但是这个频率如何选择要根据自身的业务特性来选取。当前，如果频率设置很高就给系统造成一定的压力（如CPU、内存使用率居高不下），频率设置很低数据的实时性比较差。此方案的优缺点如下</p>
<div class="hint-container tip">
<p class="hint-container-title">优点：</p>
<p>实现简单；无额外的代码的侵入业务中</p>
</div>
<div class="hint-container warning">
<p class="hint-container-title">缺点</p>
<p>1、实时性差，因为依赖定时任务的执行频率；</p>
<p>2、给数据库带来一定的压力，因为是不断的轮询数据库；</p>
</div>
<h2 id="四、使用logstash同步" tabindex="-1"><a class="header-anchor" href="#四、使用logstash同步"><span>四、使用Logstash同步</span></a></h2>
<figure><img src="/image\es\es17.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>此方案是针对定时任务同步的方案的一种改进，原理是Logstash提供了JDBC插件，它可以定期使用SQL查询数据库并且获取数据变化，然后通过配置来实现Mysql数据同步到ElasticSearch中。Logstash的配置:</p>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>
input {
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java-x.x.x-bin.jar"
    jdbc_driver_class => "com.mysql.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://192.168.202.12:3306/order"
    jdbc_user => "root"
    jdbc_password => "root123456"
    schedule => "* * * * *"
    statement => "SELECT * FROM order"
  }
}
 
filter {
  # 在此处添加任何特定的数据过滤器
  
}
 
output {
  elasticsearch {
    hosts => ["192.168.203.21:9200"]
    index => "order"
    document_id => "%{unique_id_field}"
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">优点：</p>
<p>实现简单；无额外的代码的侵入业务中</p>
</div>
<div class="hint-container warning">
<p class="hint-container-title">缺点</p>
<p>1、实时性差，因为Logstash是定期同步数据的；</p>
<p>2、需要中间件的支持；</p>
</div>
<h2 id="五、使用binlog同步——自建binlog服务中心" tabindex="-1"><a class="header-anchor" href="#五、使用binlog同步——自建binlog服务中心"><span>五、使用binlog同步——自建binlog服务中心</span></a></h2>
<figure><img src="/image\es\es18.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>此方案是先读取Mysql的binlog日志，然后将binlog日志交给binlog中心服务处理，然后把读取的binlog转化成MQ消息，通过消费MQ消息将Mysql中的数据同步到ElasticSearch中。此方案的优缺点如下：</p>
<div class="hint-container tip">
<p class="hint-container-title">优点：</p>
<p>性能高；业务解耦；无额外的代码的侵入业务中</p>
</div>
<div class="hint-container warning">
<p class="hint-container-title">缺点</p>
<p>1、构建binlog中心服务复杂；</p>
<p>2、采用MQ消费binlog也会存在延迟风险；</p>
</div>
<h2 id="六、使用binlog同步——开源中间件" tabindex="-1"><a class="header-anchor" href="#六、使用binlog同步——开源中间件"><span>六、使用binlog同步——开源中间件</span></a></h2>
<p>基于binlog同步的方式，目前有许多的优秀数据迁移工具可以实现，如canal，其实现的原理是binlog订阅的方式，模拟一个Mysql的Slave订阅 binlog日志，然后通过binlog将数据同步到监听者中。</p>
<figure><img src="/image\es\es19.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h1 id="参考" tabindex="-1"><a class="header-anchor" href="#参考"><span>参考</span></a></h1>
<p>[1] <a href="https://mp.weixin.qq.com/s/C7y1iPVV2atyPZc7HE2azA" target="_blank" rel="noopener noreferrer">https://mp.weixin.qq.com/s/C7y1iPVV2atyPZc7HE2azA</a></p>
</div></template>


