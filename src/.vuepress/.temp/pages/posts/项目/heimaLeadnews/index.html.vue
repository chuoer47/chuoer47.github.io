<template><div><!--more--->
<h1 id="黑马头条" tabindex="-1"><a class="header-anchor" href="#黑马头条"><span>黑马头条</span></a></h1>
<p>主要着手于获取最新最热新闻资讯，内容以技术类文章为主，为终端学习用户提供精准的、 感兴趣的文章，通过大数据分析用户喜好精确推送资讯新闻,主要由JAVA语言开发，采用spirngBoot框架快速开发和springCloud微服务技术架构实现。</p>
<h2 id="技术栈" tabindex="-1"><a class="header-anchor" href="#技术栈"><span>技术栈</span></a></h2>
<p>SpringBoot、SpringCloud（Nacos、OpenFeign、Gateway）、Redis、MySQL、MyBatisPlus、XXL-Job、 ElasticSearch、Kafka、Seata</p>
<h2 id="实现功能" tabindex="-1"><a class="header-anchor" href="#实现功能"><span>实现功能</span></a></h2>
<p>以文章为主线的核心业务主要分为如下子模块（目前已经全部实现）：</p>
<ul>
<li>
<p>管理员模块：该模块主要负责管理员登录功能、审核所有可能成为“湖大校园头条”文章作者的实名认证功能、文章发布内容的人工审核功能、用户列表显示功能、文章列表显示功能、文章频道管理功能、敏感词管理等功能。</p>
</li>
<li>
<p>自媒体模块：自媒体用户创建功能、文章发布功能、素材管理功能等功能。</p>
</li>
<li>
<p>App端用户模块：登录功能、文章显示功能、热点文章推荐功能、热搜功能、点赞收藏功能。</p>
</li>
</ul>
<h2 id="项目亮点" tabindex="-1"><a class="header-anchor" href="#项目亮点"><span>项目亮点</span></a></h2>
<ul>
<li>针对文章的延时发布，使用Redis定时刷新的方式实现延时任务，并使用Redis实现分布式锁防止重复执行，同时对于延时时间比较久的任务存储在Mysql中从而减轻Redis的压力；</li>
<li>针对文章审核功能使用自建敏感词库，基于确定有穷自动机(DFA算法)实现敏感词过滤，图片审核使用阿里云API，审核失败的文章用户申诉后进行人工审核；</li>
<li>在用户搜索场景中，使用Elasticsearch实现检索服务设计，基于倒排索引和分词机制，更加精准、高效的实现查询，并使用MongoDB实现搜索记录的存储和搜索词联想;</li>
<li>为了应对海量点赞阅读等用户行为数据采集，使用Redis+Mysql进行存储，并使用kafka作为中间件进行缓冲，并使用KafkaStream实现用户行为数据批量写入数据库和热点文章的计算；</li>
<li>对于热点文章的计算采用定时计算与实时计算相结合，通过XXL-Job实现分布式任务调度进行定时计算，通过KafkaStream实现实时计算，并将热点文章数据存入Redis中降低对数据库的压力；</li>
<li>针对热点文章，使用Freemarker视图渲染模版引擎，实现页面静态化，将静态化资源上传到MinIO，降低对tomcat的压力；</li>
</ul>
</div></template>


