<template><div><!--more--->
<h1 id="elasticsearch基础" tabindex="-1"><a class="header-anchor" href="#elasticsearch基础"><span>ElasticSearch基础</span></a></h1>
<h2 id="一、安装" tabindex="-1"><a class="header-anchor" href="#一、安装"><span>一、安装</span></a></h2>
<h3 id="_1、安装elasticsearch" tabindex="-1"><a class="header-anchor" href="#_1、安装elasticsearch"><span>1、安装ElasticSearch</span></a></h3>
<p>通过下面的Docker命令即可安装单机版本的elasticsearch：</p>
<div class="language-Bash line-numbers-mode" data-ext="Bash" data-title="Bash"><pre v-pre class="language-Bash"><code>docker run -d \
  --name es \
  -e &quot;ES_JAVA_OPTS=-Xms512m -Xmx512m&quot; \
  -e &quot;discovery.type=single-node&quot; \
  -v es-data:/usr/share/elasticsearch/data \
  -v es-plugins:/usr/share/elasticsearch/plugins \
  --privileged \
  --network hm-net \
  -p 9200:9200 \
  -p 9300:9300 \
  elasticsearch:7.12.1
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意，这里我们采用的是elasticsearch的7.12.1版本，8以上版本的JavaAPI变化很大，在企业中应用并不广泛。</p>
<p>安装完成后，访问9200端口，即可看到响应的Elasticsearch服务的基本信息。</p>
<h3 id="_2、安装kibana" tabindex="-1"><a class="header-anchor" href="#_2、安装kibana"><span>2、安装Kibana</span></a></h3>
<p>通过下面的Docker命令，即可部署Kibana：</p>
<div class="language-Bash line-numbers-mode" data-ext="Bash" data-title="Bash"><pre v-pre class="language-Bash"><code>docker run -d \
--name kibana \
-e ELASTICSEARCH_HOSTS=http://es:9200 \
--network=hm-net \
-p 5601:5601  \
kibana:7.12.1
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>安装完成后，直接访问5601端口，即可看到控制台页面</p>
<figure><img src="/image/es/es2.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>选择<code v-pre>Explore on my own</code>之后，进入主页面,然后选中<code v-pre>Dev tools</code>，进入开发工具页面。</p>
<h2 id="二、倒排索引" tabindex="-1"><a class="header-anchor" href="#二、倒排索引"><span>二、倒排索引</span></a></h2>
<p>elasticsearch之所以有如此高性能的搜索表现，正是得益于底层的倒排索引技术。那么什么是倒排索引呢？</p>
<p><strong>倒排</strong>索引的概念是基于MySQL这样的<strong>正向</strong>索引而言的。</p>
<h3 id="_1、正向索引" tabindex="-1"><a class="header-anchor" href="#_1、正向索引"><span>1、正向索引</span></a></h3>
<p>我们先来回顾一下正向索引。</p>
<p>例如有一张名为<code v-pre>tb_goods</code>的表：</p>
<table>
<thead>
<tr>
<th style="text-align:left"><strong>id</strong></th>
<th style="text-align:left"><strong>title</strong></th>
<th style="text-align:left"><strong>price</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">1</td>
<td style="text-align:left">小米手机</td>
<td style="text-align:left">3499</td>
</tr>
<tr>
<td style="text-align:left">2</td>
<td style="text-align:left">华为手机</td>
<td style="text-align:left">4999</td>
</tr>
<tr>
<td style="text-align:left">3</td>
<td style="text-align:left">华为小米充电器</td>
<td style="text-align:left">49</td>
</tr>
<tr>
<td style="text-align:left">4</td>
<td style="text-align:left">小米手环</td>
<td style="text-align:left">49</td>
</tr>
<tr>
<td style="text-align:left">...</td>
<td style="text-align:left">...</td>
<td style="text-align:left">...</td>
</tr>
</tbody>
</table>
<p>其中的<code v-pre>id</code>字段已经创建了索引，由于索引底层采用了B+树结构，因此我们根据id搜索的速度会非常快。但是其他字段例如<code v-pre>title</code>，只在叶子节点上存在。</p>
<p>因此要根据<code v-pre>title</code>搜索的时候只能遍历树中的每一个叶子节点，判断title数据是否符合要求。</p>
<p>比如用户的SQL语句为：</p>
<div class="language-SQL line-numbers-mode" data-ext="SQL" data-title="SQL"><pre v-pre class="language-SQL"><code>select * from tb_goods where title like '%手机%';
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>搜索的大概流程如图：</p>
<figure><img src="/image/es/es3.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<div class="hint-container info">
<p class="hint-container-title">说明</p>
<ul>
<li>1）检查到搜索条件为<code v-pre>like '%手机%'</code>，需要找到<code v-pre>title</code>中包含<code v-pre>手机</code>的数据</li>
<li>2）逐条遍历每行数据（每个叶子节点），比如第1次拿到<code v-pre>id</code>为1的数据</li>
<li>3）判断数据中的<code v-pre>title</code>字段值是否符合条件</li>
<li>4）如果符合则放入结果集，不符合则丢弃</li>
<li>5）回到步骤1</li>
</ul>
</div>
<p>综上，根据id精确匹配时，可以走索引，查询效率较高。而当搜索条件为模糊匹配时，由于索引无法生效，导致从索引查询退化为全表扫描，效率很差。</p>
<p>因此，正向索引适合于根据索引字段的精确搜索，不适合基于部分词条的模糊匹配。而倒排索引恰好解决的就是根据部分词条模糊匹配的问题。</p>
<h3 id="_2、倒排索引" tabindex="-1"><a class="header-anchor" href="#_2、倒排索引"><span>2、倒排索引</span></a></h3>
<p>倒排索引中有两个非常重要的概念：</p>
<ul>
<li>文档（<code v-pre>Document</code>）：用来搜索的数据，其中的每一条数据就是一个文档。例如一个网页、一个商品信息</li>
<li>词条（<code v-pre>Term</code>）：对文档数据或用户搜索数据，利用某种算法分词，得到的具备含义的词语就是词条。例如：我是中国人，就可以分为：我、是、中国人、中国、国人这样的几个词条</li>
</ul>
<div class="hint-container info">
<p class="hint-container-title">创建倒排索引是对正向索引的一种特殊处理和应用，流程如下：</p>
<ul>
<li>将每一个文档的数据利用<strong>分词算法</strong>根据语义拆分，得到一个个词条</li>
<li>创建表，每行数据包括词条、词条所在文档id、位置等信息</li>
<li>因为词条唯一性，可以给词条创建<strong>正向</strong>索引</li>
</ul>
</div>
<p>此时形成的这张以词条为索引的表，就是倒排索引表，两者对比如下：</p>
<p><strong>正向索引</strong></p>
<table>
<thead>
<tr>
<th style="text-align:left"><strong>id（索引）</strong></th>
<th style="text-align:left"><strong>title</strong></th>
<th style="text-align:left"><strong>price</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">1</td>
<td style="text-align:left">小米手机</td>
<td style="text-align:left">3499</td>
</tr>
<tr>
<td style="text-align:left">2</td>
<td style="text-align:left">华为手机</td>
<td style="text-align:left">4999</td>
</tr>
<tr>
<td style="text-align:left">3</td>
<td style="text-align:left">华为小米充电器</td>
<td style="text-align:left">49</td>
</tr>
<tr>
<td style="text-align:left">4</td>
<td style="text-align:left">小米手环</td>
<td style="text-align:left">49</td>
</tr>
<tr>
<td style="text-align:left">...</td>
<td style="text-align:left">...</td>
<td style="text-align:left">...</td>
</tr>
</tbody>
</table>
<p><strong>倒排索引</strong></p>
<table>
<thead>
<tr>
<th style="text-align:left"><strong>词条（索引）</strong></th>
<th style="text-align:left"><strong>文档id</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">小米</td>
<td style="text-align:left">1，3，4</td>
</tr>
<tr>
<td style="text-align:left">手机</td>
<td style="text-align:left">1，2</td>
</tr>
<tr>
<td style="text-align:left">华为</td>
<td style="text-align:left">2，3</td>
</tr>
<tr>
<td style="text-align:left">充电器</td>
<td style="text-align:left">3</td>
</tr>
<tr>
<td style="text-align:left">手环</td>
<td style="text-align:left">4</td>
</tr>
</tbody>
</table>
<p>倒排索引的<strong>搜索流程</strong>如下（以搜索&quot;华为手机&quot;为例），如图：</p>
<figure><img src="/image/es/es4.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<div class="hint-container info">
<p class="hint-container-title">流程描述：</p>
<p>1）用户输入条件<code v-pre>&quot;华为手机&quot;</code>进行搜索。</p>
<p>2）对用户输入条件<strong>分词</strong>，得到词条：<code v-pre>华为</code>、<code v-pre>手机</code>。</p>
<p>3）拿着词条在倒排索引中查找（<strong>由于词条有索引，查询效率很高</strong>），即可得到包含词条的文档id：<code v-pre>1、2、3</code>。</p>
<p>4）拿着文档<code v-pre>id</code>到正向索引中查找具体文档即可（由于<code v-pre>id</code>也有索引，查询效率也很高）。</p>
</div>
<p>虽然要先查询倒排索引，再查询倒排索引，但是无论是词条、还是文档id都建立了索引，查询速度非常快！无需全表扫描。</p>
<h3 id="_3、正向和倒排" tabindex="-1"><a class="header-anchor" href="#_3、正向和倒排"><span>3、正向和倒排</span></a></h3>
<p>那么为什么一个叫做正向索引，一个叫做倒排索引呢？</p>
<ul>
<li><strong>正向索引</strong>是最传统的，根据id索引的方式。但根据词条查询时，必须先逐条获取每个文档，然后判断文档中是否包含所需要的词条，是<strong>根据文档找词条的过程</strong>。</li>
<li>而<strong>倒排索引</strong>则相反，是先找到用户要搜索的词条，根据词条得到保护词条的文档的id，然后根据id获取文档。是<strong>根据词条找文档的过程</strong>。</li>
</ul>
<p>那么两者方式的优缺点是什么呢？</p>
<div class="hint-container tip">
<p class="hint-container-title">正向索引：</p>
<ul>
<li>优点：
<ul>
<li>可以给多个字段创建索引</li>
<li>根据索引字段搜索、排序速度非常快</li>
</ul>
</li>
<li>缺点：
<ul>
<li>根据非索引字段，或者索引字段中的部分词条查找时，只能全表扫描。</li>
</ul>
</li>
</ul>
</div>
<div class="hint-container tip">
<p class="hint-container-title">倒排索引：</p>
<ul>
<li>优点：
<ul>
<li>根据词条搜索、模糊搜索时，速度非常快</li>
</ul>
</li>
<li>缺点：
<ul>
<li>只能给词条创建索引，而不是字段</li>
<li>无法根据字段做排序</li>
</ul>
</li>
</ul>
</div>
<h2 id="三、基础概念" tabindex="-1"><a class="header-anchor" href="#三、基础概念"><span>三、基础概念</span></a></h2>
<p>elasticsearch中有很多独有的概念，与mysql中略有差别，但也有相似之处。</p>
<h3 id="_1、文档和字段" tabindex="-1"><a class="header-anchor" href="#_1、文档和字段"><span>1、文档和字段</span></a></h3>
<p>elasticsearch是面向 <strong>文档（Document）</strong> 存储的，可以是数据库中的一条商品数据，一个订单信息。文档数据会被序列化为<code v-pre>json</code>格式后存储在<code v-pre>elasticsearch</code>中：</p>
<figure><img src="/image/es/es5.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>因此，原本数据库中的一行数据就是ES中的一个JSON文档；而数据库中每行数据都包含很多列，这些列就转换为JSON文档中的<strong>字段（Field）</strong>。</p>
<h3 id="_2、索引和映射" tabindex="-1"><a class="header-anchor" href="#_2、索引和映射"><span>2、索引和映射</span></a></h3>
<p>随着业务发展，需要在es中存储的文档也会越来越多，比如有商品的文档、用户的文档、订单文档等等</p>
<figure><img src="/image/es/es6.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>所有文档都散乱存放显然非常混乱，也不方便管理。</p>
<p>因此，我们要将类型相同的文档集中在一起管理，称为<strong>索引（Index）</strong>。例如：</p>
<figure><img src="/image/es/es7.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<ul>
<li>所有用户文档，就可以组织在一起，称为用户的索引；</li>
<li>所有商品的文档，可以组织在一起，称为商品的索引；</li>
<li>所有订单的文档，可以组织在一起，称为订单的索引；</li>
</ul>
<p>因此，我们可以把索引当做是数据库中的表。</p>
<p>数据库的表会有约束信息，用来定义表的结构、字段的名称、类型等信息。因此，索引库中就有<strong>映射（mapping）</strong>，是索引中文档的字段约束信息，类似表的结构约束。</p>
<h3 id="_3、mysql与elasticsearch" tabindex="-1"><a class="header-anchor" href="#_3、mysql与elasticsearch"><span>3、mysql与elasticsearch</span></a></h3>
<p>我们统一的把mysql与elasticsearch的概念做一下对比：</p>
<table>
<thead>
<tr>
<th style="text-align:left"><strong>MySQL</strong></th>
<th style="text-align:left"><strong>Elasticsearch</strong></th>
<th style="text-align:left"><strong>说明</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">Table</td>
<td style="text-align:left">Index</td>
<td style="text-align:left">索引(index)，就是文档的集合，类似数据库的表(table)</td>
</tr>
<tr>
<td style="text-align:left">Row</td>
<td style="text-align:left">Document</td>
<td style="text-align:left">文档（Document），就是一条条的数据，类似数据库中的行（Row），文档都是JSON格式</td>
</tr>
<tr>
<td style="text-align:left">Column</td>
<td style="text-align:left">Field</td>
<td style="text-align:left">字段（Field），就是JSON文档中的字段，类似数据库中的列（Column）</td>
</tr>
<tr>
<td style="text-align:left">Schema</td>
<td style="text-align:left">Mapping</td>
<td style="text-align:left">Mapping（映射）是索引中文档的约束，例如字段类型约束。类似数据库的表结构（Schema）</td>
</tr>
<tr>
<td style="text-align:left">SQL</td>
<td style="text-align:left">DSL</td>
<td style="text-align:left">DSL是elasticsearch提供的JSON风格的请求语句，用来操作elasticsearch，实现CRUD</td>
</tr>
</tbody>
</table>
<p>如图：</p>
<figure><img src="/image/es/es8.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>两者各自有自己的擅长之处：</p>
<ul>
<li>Mysql：擅长事务类型操作，可以确保数据的安全和一致性</li>
<li>Elasticsearch：擅长海量数据的搜索、分析、计算</li>
</ul>
<div class="hint-container tip">
<p class="hint-container-title">往往是两者结合使用：</p>
<ul>
<li>对安全性要求较高的写操作，使用mysql实现</li>
<li>对查询性能要求较高的搜索需求，使用elasticsearch实现</li>
<li>两者再基于某种方式，实现数据的同步，保证一致性</li>
</ul>
</div>
<figure><img src="/image/es/es9.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h2 id="四、ik分词器" tabindex="-1"><a class="header-anchor" href="#四、ik分词器"><span>四、IK分词器</span></a></h2>
<p>Elasticsearch的关键就是倒排索引，而倒排索引依赖于对文档内容的分词，而分词则需要高效、精准的分词算法，IK分词器就是这样一个中文分词算法。</p>
<h3 id="_1、安装ik分词器" tabindex="-1"><a class="header-anchor" href="#_1、安装ik分词器"><span>1、安装IK分词器</span></a></h3>
<p><strong>方案一</strong>：在线安装</p>
<p>运行一个命令即可：</p>
<div class="language-Shell line-numbers-mode" data-ext="Shell" data-title="Shell"><pre v-pre class="language-Shell"><code>docker exec -it es ./bin/elasticsearch-plugin  install https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v7.12.1/elasticsearch-analysis-ik-7.12.1.zip
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>然后重启es容器：</p>
<div class="language-Shell line-numbers-mode" data-ext="Shell" data-title="Shell"><pre v-pre class="language-Shell"><code>docker restart es
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p><strong>方案二</strong>：离线安装</p>
<p>如果网速较差，也可以选择离线安装。</p>
<p>首先，查看之前安装的Elasticsearch容器的plugins数据卷目录：</p>
<div class="language-Shell line-numbers-mode" data-ext="Shell" data-title="Shell"><pre v-pre class="language-Shell"><code>docker volume inspect es-plugins
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>结果如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>[
    {
        &quot;CreatedAt&quot;: &quot;2024-11-06T10:06:34+08:00&quot;,
        &quot;Driver&quot;: &quot;local&quot;,
        &quot;Labels&quot;: null,
        &quot;Mountpoint&quot;: &quot;/var/lib/docker/volumes/es-plugins/_data&quot;,
        &quot;Name&quot;: &quot;es-plugins&quot;,
        &quot;Options&quot;: null,
        &quot;Scope&quot;: &quot;local&quot;
    }
]
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>可以看到elasticsearch的插件挂载到了<code v-pre>/var/lib/docker/volumes/es-plugins/_data</code>这个目录。我们需要把IK分词器上传至这个目录。</p>
<h3 id="_2、使用ik分词器" tabindex="-1"><a class="header-anchor" href="#_2、使用ik分词器"><span>2、使用IK分词器</span></a></h3>
<p>IK分词器包含两种模式：</p>
<ul>
<li><code v-pre>ik_smart</code>：智能语义切分</li>
<li><code v-pre>ik_max_word</code>：最细粒度切分</li>
</ul>
<p>在Kibana的DevTools上来测试分词器，首先测试Elasticsearch官方提供的标准分词器：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /_analyze
{
  &quot;analyzer&quot;: &quot;standard&quot;,
  &quot;text&quot;: &quot;黑马程序员学习java太棒了&quot;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>再测试IK分词器：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /_analyze
{
  &quot;analyzer&quot;: &quot;ik_smart&quot;,
  &quot;text&quot;: &quot;黑马程序员学习java太棒了&quot;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、拓展词典" tabindex="-1"><a class="header-anchor" href="#_3、拓展词典"><span>3、拓展词典</span></a></h3>
<p>随着互联网的发展，“造词运动”也越发的频繁。出现了很多新的词语，在原有的词汇列表中并不存在。比如：“泰裤辣”，“传智播客” 等。</p>
<p>IK分词器无法对这些词汇分词，测试一下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /_analyze
{
  &quot;analyzer&quot;: &quot;ik_max_word&quot;,
  &quot;text&quot;: &quot;传智播客开设大学,真的泰裤辣！&quot;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>所以要想正确分词，IK分词器的词库也需要不断的更新，IK分词器提供了扩展词汇的功能。</p>
<p>1）打开IK分词器config目录</p>
<figure><img src="/image/es/es10.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<ul>
<li>注意，如果采用在线安装的通过，默认是没有config目录的</li>
</ul>
<p>2）在IKAnalyzer.cfg.xml配置文件内容添加：</p>
<div class="language-XML line-numbers-mode" data-ext="XML" data-title="XML"><pre v-pre class="language-XML"><code>&lt;?xml version=&quot;1.0&quot; encoding=&quot;UTF-8&quot;?&gt;
&lt;!DOCTYPE properties SYSTEM &quot;http://java.sun.com/dtd/properties.dtd&quot;&gt;
&lt;properties&gt;
        &lt;comment&gt;IK Analyzer 扩展配置&lt;/comment&gt;
        &lt;!--用户可以在这里配置自己的扩展字典 *** 添加扩展词典--&gt;
        &lt;entry key=&quot;ext_dict&quot;&gt;ext.dic&lt;/entry&gt;
&lt;/properties&gt;
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>3）在IK分词器的config目录新建一个 <code v-pre>ext.dic</code>，可以参考config目录下复制一个配置文件进行修改</p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>传智播客
泰裤辣
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>4）重启elasticsearch</p>
<div class="language-Shell line-numbers-mode" data-ext="Shell" data-title="Shell"><pre v-pre class="language-Shell"><code>docker restart es

# 查看 日志
docker logs -f elasticsearch
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>再次测试，可以发现<code v-pre>传智播客</code>和<code v-pre>泰裤辣</code>都正确分词了。</p>
<h3 id="_4、总结" tabindex="-1"><a class="header-anchor" href="#_4、总结"><span>4、总结</span></a></h3>
<p>分词器的作用是什么？</p>
<ul>
<li>创建倒排索引时，对文档分词</li>
<li>用户搜索时，对输入的内容分词</li>
</ul>
<p>IK分词器有几种模式？</p>
<ul>
<li><code v-pre>ik_smart</code>：智能切分，粗粒度</li>
<li><code v-pre>ik_max_word</code>：最细切分，细粒度</li>
</ul>
<p>IK分词器如何拓展词条？如何停用词条？</p>
<ul>
<li>利用config目录的<code v-pre>IkAnalyzer.cfg.xml</code>文件添加拓展词典和停用词典</li>
<li>在词典中添加拓展词条或者停用词条</li>
</ul>
<h2 id="五、索引库操作" tabindex="-1"><a class="header-anchor" href="#五、索引库操作"><span>五、索引库操作</span></a></h2>
<p>Index就类似数据库表，Mapping映射就类似表的结构。我们要向es中存储数据，必须先创建Index和Mapping</p>
<h3 id="_1、mapping映射属性" tabindex="-1"><a class="header-anchor" href="#_1、mapping映射属性"><span>1、Mapping映射属性</span></a></h3>
<p>Mapping是对索引库中文档的约束，常见的Mapping属性包括：</p>
<ul>
<li><code v-pre>type</code>：字段数据类型，常见的简单类型有：
<ul>
<li>字符串：<code v-pre>text</code>（可分词的文本）、<code v-pre>keyword</code>（精确值，例如：品牌、国家、ip地址）</li>
<li>数值：<code v-pre>long</code>、<code v-pre>integer</code>、<code v-pre>short</code>、<code v-pre>byte</code>、<code v-pre>double</code>、<code v-pre>float</code>、</li>
<li>布尔：<code v-pre>boolean</code></li>
<li>日期：<code v-pre>date</code></li>
<li>对象：<code v-pre>object</code></li>
</ul>
</li>
<li><code v-pre>index</code>：是否创建索引，默认为<code v-pre>true</code></li>
<li><code v-pre>analyzer</code>：使用哪种分词器</li>
<li><code v-pre>properties</code>：该字段的子字段</li>
</ul>
<p>例如下面的json文档：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>{
    &quot;age&quot;: 21,
    &quot;weight&quot;: 52.1,
    &quot;isMarried&quot;: false,
    &quot;info&quot;: &quot;黑马程序员Java讲师&quot;,
    &quot;email&quot;: &quot;zy@itcast.cn&quot;,
    &quot;score&quot;: [99.1, 99.5, 98.9],
    &quot;name&quot;: {
        &quot;firstName&quot;: &quot;云&quot;,
        &quot;lastName&quot;: &quot;赵&quot;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>对应的每个字段映射（Mapping）：</p>
<table>
<thead>
<tr>
<th style="text-align:left"><strong>字段名</strong></th>
<th style="text-align:left"><strong>字段类型</strong></th>
<th style="text-align:left"><strong>类型说明</strong></th>
<th style="text-align:left"><strong>是否参与搜索</strong></th>
<th style="text-align:left"><strong>是否参与分词</strong></th>
<th style="text-align:left"><strong>分词器</strong></th>
<th></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">age</td>
<td style="text-align:left"><code v-pre>integer</code></td>
<td style="text-align:left">整数</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">weight</td>
<td style="text-align:left"><code v-pre>float</code></td>
<td style="text-align:left">浮点数</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">isMarried</td>
<td style="text-align:left"><code v-pre>boolean</code></td>
<td style="text-align:left">布尔</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">info</td>
<td style="text-align:left"><code v-pre>text</code></td>
<td style="text-align:left">字符串，但需要分词</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">IK</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">email</td>
<td style="text-align:left"><code v-pre>keyword</code></td>
<td style="text-align:left">字符串，但是不分词</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">score</td>
<td style="text-align:left"><code v-pre>float</code></td>
<td style="text-align:left">只看数组中元素类型</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
<tr>
<td style="text-align:left">name</td>
<td style="text-align:left">firstName</td>
<td style="text-align:left"><code v-pre>keyword</code></td>
<td style="text-align:left">字符串，但是不分词</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td>——</td>
</tr>
<tr>
<td style="text-align:left">lastName</td>
<td style="text-align:left"><code v-pre>keyword</code></td>
<td style="text-align:left">字符串，但是不分词</td>
<td style="text-align:left"></td>
<td style="text-align:left"></td>
<td style="text-align:left">——</td>
<td></td>
</tr>
</tbody>
</table>
<h3 id="_2、索引库的crud" tabindex="-1"><a class="header-anchor" href="#_2、索引库的crud"><span>2、索引库的CRUD</span></a></h3>
<p>由于Elasticsearch采用的是Restful风格的API，因此其请求方式和路径相对都比较规范，而且请求参数也都采用JSON风格。我们直接基于Kibana的DevTools来编写请求做测试，由于有语法提示，会非常方便。</p>
<h4 id="_1-创建索引库和映射" tabindex="-1"><a class="header-anchor" href="#_1-创建索引库和映射"><span>1）创建索引库和映射</span></a></h4>
<p><strong>基本语法</strong>：</p>
<ul>
<li>请求方式：<code v-pre>PUT</code></li>
<li>请求路径：<code v-pre>/索引库名</code>，可以自定义</li>
<li>请求参数：<code v-pre>mapping</code>映射</li>
</ul>
<p><strong>格式</strong>：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /索引库名称
{
  &quot;mappings&quot;: {
    &quot;properties&quot;: {
      &quot;字段名&quot;:{
        &quot;type&quot;: &quot;text&quot;,
        &quot;analyzer&quot;: &quot;ik_smart&quot;
      },
      &quot;字段名2&quot;:{
        &quot;type&quot;: &quot;keyword&quot;,
        &quot;index&quot;: &quot;false&quot;
      },
      &quot;字段名3&quot;:{
        &quot;properties&quot;: {
          &quot;子字段&quot;: {
            &quot;type&quot;: &quot;keyword&quot;
          }
        }
      },
      // ...略
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>示例</strong>：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /heima
{
  &quot;mappings&quot;: {
    &quot;properties&quot;: {
      &quot;info&quot;:{
        &quot;type&quot;: &quot;text&quot;,
        &quot;analyzer&quot;: &quot;ik_smart&quot;
      },
      &quot;email&quot;:{
        &quot;type&quot;: &quot;keyword&quot;,
        &quot;index&quot;: &quot;false&quot;
      },
      &quot;name&quot;:{
        &quot;properties&quot;: {
          &quot;firstName&quot;: {
            &quot;type&quot;: &quot;keyword&quot;
          }
        }
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-查询索引库" tabindex="-1"><a class="header-anchor" href="#_2-查询索引库"><span>2）查询索引库</span></a></h4>
<p><strong>基本语法</strong>：</p>
<ul>
<li>请求方式：GET</li>
<li>请求路径：/索引库名</li>
<li>请求参数：无</li>
</ul>
<p><strong>格式</strong>：</p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>GET /索引库名
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p><strong>示例</strong>：</p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>GET /heima
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h4 id="_3-修改索引库" tabindex="-1"><a class="header-anchor" href="#_3-修改索引库"><span>3）修改索引库</span></a></h4>
<p>倒排索引结构虽然不复杂，但是一旦数据结构改变（比如改变了分词器），就需要重新创建倒排索引，这简直是灾难。因此索引库<strong>一旦创建，无法修改mapping</strong>。</p>
<p>虽然无法修改mapping中已有的字段，但是却允许添加新的字段到mapping中，因为不会对倒排索引产生影响。因此修改索引库能做的就是向索引库中添加新字段，或者更新索引库的基础属性。</p>
<p><strong>语法说明</strong>：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /索引库名/_mapping
{
  &quot;properties&quot;: {
    &quot;新字段名&quot;:{
      &quot;type&quot;: &quot;integer&quot;
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>示例</strong>：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /heima/_mapping
{
  &quot;properties&quot;: {
    &quot;age&quot;:{
      &quot;type&quot;: &quot;integer&quot;
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_4-删除索引库" tabindex="-1"><a class="header-anchor" href="#_4-删除索引库"><span>4）删除索引库</span></a></h4>
<p><strong>语法：</strong></p>
<ul>
<li>请求方式：DELETE</li>
<li>请求路径：/索引库名</li>
<li>请求参数：无</li>
</ul>
<p><strong>格式：</strong></p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>DELETE /索引库名
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>示例：</p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>DELETE /heima
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">总结</p>
<ul>
<li>创建索引库：PUT /索引库名</li>
<li>查询索引库：GET /索引库名</li>
<li>删除索引库：DELETE /索引库名</li>
<li>修改索引库，添加字段：PUT /索引库名/_mapping</li>
</ul>
</div>
<p>可以看到，对索引库的操作基本遵循的Restful的风格，因此API接口非常统一，方便记忆。</p>
<h2 id="六、文档操作" tabindex="-1"><a class="header-anchor" href="#六、文档操作"><span>六、文档操作</span></a></h2>
<p>有了索引库，接下来就可以向索引库中添加数据了。Elasticsearch中的数据其实就是JSON风格的文档。操作文档自然保护<code v-pre>增</code>、<code v-pre>删</code>、<code v-pre>改</code>、<code v-pre>查</code>等几种常见操作。</p>
<h3 id="_1、新增文档" tabindex="-1"><a class="header-anchor" href="#_1、新增文档"><span>1、新增文档</span></a></h3>
<p><strong>语法：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /索引库名/_doc/文档id
{
    &quot;字段1&quot;: &quot;值1&quot;,
    &quot;字段2&quot;: &quot;值2&quot;,
    &quot;字段3&quot;: {
        &quot;子属性1&quot;: &quot;值3&quot;,
        &quot;子属性2&quot;: &quot;值4&quot;
    },
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>示例：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /heima/_doc/1
{
    &quot;info&quot;: &quot;黑马程序员Java讲师&quot;,
    &quot;email&quot;: &quot;zy@itcast.cn&quot;,
    &quot;name&quot;: {
        &quot;firstName&quot;: &quot;云&quot;,
        &quot;lastName&quot;: &quot;赵&quot;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、查询文档" tabindex="-1"><a class="header-anchor" href="#_2、查询文档"><span>2、查询文档</span></a></h3>
<p>根据rest风格，新增是post，查询应该是get，不过查询一般都需要条件，这里我们把文档id带上。</p>
<p><strong>语法：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名称}/_doc/{id}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p><strong>示例：</strong></p>
<div class="language-JavaScript line-numbers-mode" data-ext="JavaScript" data-title="JavaScript"><pre v-pre class="language-JavaScript"><code>GET /heima/_doc/1
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_3、删除文档" tabindex="-1"><a class="header-anchor" href="#_3、删除文档"><span>3、删除文档</span></a></h3>
<p>删除使用DELETE请求，同样，需要根据id进行删除：</p>
<p><strong>语法：</strong></p>
<div class="language-JavaScript line-numbers-mode" data-ext="JavaScript" data-title="JavaScript"><pre v-pre class="language-JavaScript"><code>DELETE /{索引库名}/_doc/id值
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p><strong>示例：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>DELETE /heima/_doc/1
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_4、修改文档" tabindex="-1"><a class="header-anchor" href="#_4、修改文档"><span>4、修改文档</span></a></h3>
<div class="hint-container tip">
<p class="hint-container-title">修改有两种方式：</p>
<ul>
<li>全量修改：直接覆盖原来的文档</li>
<li>局部修改：修改文档中的部分字段</li>
</ul>
</div>
<h4 id="_1-全量修改" tabindex="-1"><a class="header-anchor" href="#_1-全量修改"><span>1）全量修改</span></a></h4>
<p>全量修改是覆盖原来的文档，其本质是两步操作：</p>
<ul>
<li>根据指定的id删除文档</li>
<li>新增一个相同id的文档</li>
</ul>
<p><strong>注意</strong>：如果根据id删除时，id不存在，第二步的新增也会执行，也就从修改变成了新增操作了。</p>
<p><strong>语法：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /{索引库名}/_doc/文档id
{
    &quot;字段1&quot;: &quot;值1&quot;,
    &quot;字段2&quot;: &quot;值2&quot;,
    // ... 略
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>示例：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>PUT /heima/_doc/1
{
    &quot;info&quot;: &quot;黑马程序员高级Java讲师&quot;,
    &quot;email&quot;: &quot;zy@itcast.cn&quot;,
    &quot;name&quot;: {
        &quot;firstName&quot;: &quot;云&quot;,
        &quot;lastName&quot;: &quot;赵&quot;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-局部修改" tabindex="-1"><a class="header-anchor" href="#_2-局部修改"><span>2）局部修改</span></a></h4>
<p>局部修改是只修改指定id匹配的文档中的部分字段。</p>
<p><strong>语法：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /{索引库名}/_update/文档id
{
    &quot;doc&quot;: {
         &quot;字段名&quot;: &quot;新的值&quot;,
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>示例：</strong></p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /heima/_update/1
{
  &quot;doc&quot;: {
    &quot;email&quot;: &quot;ZhaoYun@itcast.cn&quot;
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_5、批处理" tabindex="-1"><a class="header-anchor" href="#_5、批处理"><span>5、批处理</span></a></h3>
<p>批处理采用POST请求，基本语法如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>POST _bulk
{ &quot;index&quot; : { &quot;_index&quot; : &quot;test&quot;, &quot;_id&quot; : &quot;1&quot; } }
{ &quot;field1&quot; : &quot;value1&quot; }
{ &quot;delete&quot; : { &quot;_index&quot; : &quot;test&quot;, &quot;_id&quot; : &quot;2&quot; } }
{ &quot;create&quot; : { &quot;_index&quot; : &quot;test&quot;, &quot;_id&quot; : &quot;3&quot; } }
{ &quot;field1&quot; : &quot;value3&quot; }
{ &quot;update&quot; : {&quot;_id&quot; : &quot;1&quot;, &quot;_index&quot; : &quot;test&quot;} }
{ &quot;doc&quot; : {&quot;field2&quot; : &quot;value2&quot;} }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>其中：</p>
<ul>
<li><code v-pre>index</code>代表新增操作
<ul>
<li><code v-pre>_index</code>：指定索引库名</li>
<li><code v-pre>_id</code>指定要操作的文档id</li>
<li><code v-pre>{ &quot;field1&quot; : &quot;value1&quot; }</code>：则是要新增的文档内容</li>
</ul>
</li>
<li><code v-pre>delete</code>代表删除操作
<ul>
<li><code v-pre>_index</code>：指定索引库名</li>
<li><code v-pre>_id</code>指定要操作的文档id</li>
</ul>
</li>
<li><code v-pre>update</code>代表更新操作
<ul>
<li><code v-pre>_index</code>：指定索引库名</li>
<li><code v-pre>_id</code>指定要操作的文档id</li>
<li><code v-pre>{ &quot;doc&quot; : {&quot;field2&quot; : &quot;value2&quot;} }</code>：要更新的文档字段</li>
</ul>
</li>
</ul>
<p>示例，批量新增：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>POST /_bulk
{&quot;index&quot;: {&quot;_index&quot;:&quot;heima&quot;, &quot;_id&quot;: &quot;3&quot;}}
{&quot;info&quot;: &quot;黑马程序员C++讲师&quot;, &quot;email&quot;: &quot;ww@itcast.cn&quot;, &quot;name&quot;:{&quot;firstName&quot;: &quot;五&quot;, &quot;lastName&quot;:&quot;王&quot;}}
{&quot;index&quot;: {&quot;_index&quot;:&quot;heima&quot;, &quot;_id&quot;: &quot;4&quot;}}
{&quot;info&quot;: &quot;黑马程序员前端讲师&quot;, &quot;email&quot;: &quot;zhangsan@itcast.cn&quot;, &quot;name&quot;:{&quot;firstName&quot;: &quot;三&quot;, &quot;lastName&quot;:&quot;张&quot;}}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>批量删除：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>POST /_bulk
{&quot;delete&quot;:{&quot;_index&quot;:&quot;heima&quot;, &quot;_id&quot;: &quot;3&quot;}}
{&quot;delete&quot;:{&quot;_index&quot;:&quot;heima&quot;, &quot;_id&quot;: &quot;4&quot;}}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">文档操作</p>
<ul>
<li>创建文档：<code v-pre>POST /{索引库名}/_doc/文档id   { json文档 }</code></li>
<li>查询文档：<code v-pre>GET /{索引库名}/_doc/文档id</code></li>
<li>删除文档：<code v-pre>DELETE /{索引库名}/_doc/文档id</code></li>
<li>修改文档：
<ul>
<li>全量修改：<code v-pre>PUT /{索引库名}/_doc/文档id { json文档 }</code></li>
<li>局部修改：<code v-pre>POST /{索引库名}/_update/文档id { &quot;doc&quot;: {字段}}</code></li>
</ul>
</li>
</ul>
</div>
<h2 id="七、javarestclient" tabindex="-1"><a class="header-anchor" href="#七、javarestclient"><span>七、JavaRestClient</span></a></h2>
<h3 id="_1、初始化restclient" tabindex="-1"><a class="header-anchor" href="#_1、初始化restclient"><span>1、初始化RestClient</span></a></h3>
<p>在elasticsearch提供的API中，与elasticsearch一切交互都封装在一个名为<code v-pre>RestHighLevelClient</code>的类中，必须先完成这个对象的初始化，建立与elasticsearch的连接。</p>
<p>1）在<code v-pre>item-service</code>模块中引入<code v-pre>es</code>的<code v-pre>RestHighLevelClient</code>依赖：</p>
<div class="language-XML line-numbers-mode" data-ext="XML" data-title="XML"><pre v-pre class="language-XML"><code>&lt;dependency&gt;
    &lt;groupId&gt;org.elasticsearch.client&lt;/groupId&gt;
    &lt;artifactId&gt;elasticsearch-rest-high-level-client&lt;/artifactId&gt;
&lt;/dependency&gt;
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2）因为SpringBoot默认的ES版本是<code v-pre>7.17.10</code>，所以我们需要覆盖默认的ES版本：</p>
<div class="language-XML line-numbers-mode" data-ext="XML" data-title="XML"><pre v-pre class="language-XML"><code>  &lt;properties&gt;
      &lt;maven.compiler.source&gt;11&lt;/maven.compiler.source&gt;
      &lt;maven.compiler.target&gt;11&lt;/maven.compiler.target&gt;
      &lt;elasticsearch.version&gt;7.12.1&lt;/elasticsearch.version&gt;
  &lt;/properties&gt;
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>3）初始化RestHighLevelClient：</p>
<p>初始化的代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>RestHighLevelClient client = new RestHighLevelClient(RestClient.builder(
        HttpHost.create(&quot;http://192.168.150.101:9200&quot;)
));
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这里为了单元测试方便，我们创建一个测试类<code v-pre>IndexTest</code>，然后将初始化的代码编写在<code v-pre>@BeforeEach</code>方法中：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public class IndexTest {

    private RestHighLevelClient client;

    @BeforeEach
    void setUp() {
        this.client = new RestHighLevelClient(RestClient.builder(
                HttpHost.create(&quot;http://192.168.150.101:9200&quot;)
        ));
    }

    @Test
    void testConnect() {
        System.out.println(client);
    }

    @AfterEach
    void tearDown() throws IOException {
        this.client.close();
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、创建索引库" tabindex="-1"><a class="header-anchor" href="#_2、创建索引库"><span>2、创建索引库</span></a></h3>
<p>由于要实现对商品搜索，所以我们需要将商品添加到Elasticsearch中，不过需要根据搜索业务的需求来设定索引库结构，而不是一股脑的把MySQL数据写入Elasticsearch.</p>
<h4 id="_1-mapping-映射" tabindex="-1"><a class="header-anchor" href="#_1-mapping-映射"><span>1）Mapping 映射</span></a></h4>
<div class="language-json line-numbers-mode" data-ext="json" data-title="json"><pre v-pre class="language-json"><code>PUT /items
<span class="token punctuation">{</span>
  <span class="token property">"mappings"</span><span class="token operator">:</span> <span class="token punctuation">{</span>
    <span class="token property">"properties"</span><span class="token operator">:</span> <span class="token punctuation">{</span>
      <span class="token property">"id"</span><span class="token operator">:</span> <span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"keyword"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"name"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"text"</span><span class="token punctuation">,</span>
        <span class="token property">"analyzer"</span><span class="token operator">:</span> <span class="token string">"ik_max_word"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"price"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"integer"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"stock"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"integer"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"image"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"keyword"</span><span class="token punctuation">,</span>
        <span class="token property">"index"</span><span class="token operator">:</span> <span class="token boolean">false</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"category"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"keyword"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"brand"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"keyword"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"sold"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"integer"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"commentCount"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"integer"</span><span class="token punctuation">,</span>
        <span class="token property">"index"</span><span class="token operator">:</span> <span class="token boolean">false</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"isAD"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"boolean"</span>
      <span class="token punctuation">}</span><span class="token punctuation">,</span>
      <span class="token property">"updateTime"</span><span class="token operator">:</span><span class="token punctuation">{</span>
        <span class="token property">"type"</span><span class="token operator">:</span> <span class="token string">"date"</span>
      <span class="token punctuation">}</span>
    <span class="token punctuation">}</span>
  <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-创建索引" tabindex="-1"><a class="header-anchor" href="#_2-创建索引"><span>2）创建索引</span></a></h4>
<p>创建索引库的API如下</p>
<figure><img src="/image/es/es11.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<div class="hint-container info">
<p class="hint-container-title">代码分为三步：</p>
<ul>
<li>1）创建Request对象。
<ul>
<li>因为是创建索引库的操作，因此Request是<code v-pre>CreateIndexRequest</code>。</li>
</ul>
</li>
<li>2）添加请求参数
<ul>
<li>其实就是Json格式的Mapping映射参数。因为json字符串很长，这里是定义了静态字符串常量<code v-pre>MAPPING_TEMPLATE</code>，让代码看起来更加优雅。</li>
</ul>
</li>
<li>3）发送请求
<ul>
<li><code v-pre>client.``indices``()</code>方法的返回值是<code v-pre>IndicesClient</code>类型，封装了所有与索引库操作有关的方法。例如创建索引、删除索引、判断索引是否存在等</li>
</ul>
</li>
</ul>
</div>
<p>在<code v-pre>item-service</code>中的<code v-pre>IndexTest</code>测试类中，具体代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testCreateIndex() throws IOException {
    // 1.创建Request对象
    CreateIndexRequest request = new CreateIndexRequest(&quot;items&quot;);
    // 2.准备请求参数
    request.source(MAPPING_TEMPLATE, XContentType.JSON);
    // 3.发送请求
    client.indices().create(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、删除索引库" tabindex="-1"><a class="header-anchor" href="#_3、删除索引库"><span>3、删除索引库</span></a></h3>
<p>删除索引库的请求非常简单：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>DELETE /hotel
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>与创建索引库相比：</p>
<ul>
<li>请求方式从PUT变为DELTE</li>
<li>请求路径不变</li>
<li>无请求参数</li>
</ul>
<p>所以代码的差异，注意体现在Request对象上。流程如下：</p>
<ul>
<li>1）创建Request对象。这次是DeleteIndexRequest对象</li>
<li>2）准备参数。这里是无参，因此省略</li>
<li>3）发送请求。改用delete方法</li>
</ul>
<p>在<code v-pre>item-service</code>中的<code v-pre>IndexTest</code>测试类中，编写单元测试，实现删除索引：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testDeleteIndex() throws IOException {
    // 1.创建Request对象
    DeleteIndexRequest request = new DeleteIndexRequest(&quot;items&quot;);
    // 2.发送请求
    client.indices().delete(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、判断索引库是否存在" tabindex="-1"><a class="header-anchor" href="#_3、判断索引库是否存在"><span>3、判断索引库是否存在</span></a></h3>
<p>判断索引库是否存在，本质就是查询，对应的请求语句是：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /hotel
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>因此与删除的Java代码流程是类似的，流程如下：</p>
<ul>
<li>1）创建Request对象。这次是GetIndexRequest对象</li>
<li>2）准备参数。这里是无参，直接省略</li>
<li>3）发送请求。改用exists方法</li>
</ul>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testExistsIndex() throws IOException {
    // 1.创建Request对象
    GetIndexRequest request = new GetIndexRequest(&quot;items&quot;);
    // 2.发送请求
    boolean exists = client.indices().exists(request, RequestOptions.DEFAULT);
    // 3.输出
    System.err.println(exists ? &quot;索引库已经存在！&quot; : &quot;索引库不存在！&quot;);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">总结</p>
<p>JavaRestClient操作elasticsearch的流程基本类似。核心是<code v-pre>client.indices()</code>方法来获取索引库的操作对象。</p>
<p>索引库操作的基本步骤：</p>
<ul>
<li>初始化<code v-pre>RestHighLevelClient</code></li>
<li>创建XxxIndexRequest。XXX是<code v-pre>Create</code>、<code v-pre>Get</code>、<code v-pre>Delete</code></li>
<li>准备请求参数（ <code v-pre>Create</code>时需要，其它是无参，可以省略）</li>
<li>发送请求。调用<code v-pre>RestHighLevelClient#indices().xxx()</code>方法，xxx是<code v-pre>create</code>、<code v-pre>exists</code>、<code v-pre>delete</code></li>
</ul>
</div>
<h2 id="八、restclient操作文档" tabindex="-1"><a class="header-anchor" href="#八、restclient操作文档"><span>八、RestClient操作文档</span></a></h2>
<p>索引库准备好以后，就可以操作文档了。为了与索引库操作分离，我们再次创建一个测试类，做两件事情：</p>
<ul>
<li>初始化RestHighLevelClient</li>
<li>我们的商品数据在数据库，需要利用IHotelService去查询，所以注入这个接口</li>
</ul>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@SpringBootTest(properties = &quot;spring.profiles.active=local&quot;)
public class DocumentTest {

    private RestHighLevelClient client;
    @Autowired
    private IItemService itemService;

    @BeforeEach
    void setUp() {
        this.client = new RestHighLevelClient(RestClient.builder(
                HttpHost.create(&quot;http://192.168.150.101:9200&quot;)
        ));
    }
    
    @AfterEach
    void tearDown() throws IOException {
        this.client.close();
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_1、新增文档-1" tabindex="-1"><a class="header-anchor" href="#_1、新增文档-1"><span>1、新增文档</span></a></h3>
<p>我们需要将数据库中的商品信息导入elasticsearch中，而不是造假数据了。</p>
<h4 id="_1-实体类" tabindex="-1"><a class="header-anchor" href="#_1-实体类"><span>1）实体类</span></a></h4>
<p>索引库结构与数据库结构还存在一些差异，因此我们要定义一个索引库结构对应的实体。</p>
<p>在<code v-pre>hm-service</code>模块的<code v-pre>com.hmall.item.domain.dto</code>包中定义一个新的DTO：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.hmall.item.domain.po;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@ApiModel(description = &quot;索引库实体&quot;)
public class ItemDoc{

    @ApiModelProperty(&quot;商品id&quot;)
    private String id;

    @ApiModelProperty(&quot;商品名称&quot;)
    private String name;

    @ApiModelProperty(&quot;价格（分）&quot;)
    private Integer price;

    @ApiModelProperty(&quot;商品图片&quot;)
    private String image;

    @ApiModelProperty(&quot;类目名称&quot;)
    private String category;

    @ApiModelProperty(&quot;品牌名称&quot;)
    private String brand;

    @ApiModelProperty(&quot;销量&quot;)
    private Integer sold;

    @ApiModelProperty(&quot;评论数&quot;)
    private Integer commentCount;

    @ApiModelProperty(&quot;是否是推广广告，true/false&quot;)
    private Boolean isAD;

    @ApiModelProperty(&quot;更新时间&quot;)
    private LocalDateTime updateTime;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-api语法" tabindex="-1"><a class="header-anchor" href="#_2-api语法"><span>2）API语法</span></a></h4>
<p>新增文档的请求语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /{索引库名}/_doc/1
{
    &quot;name&quot;: &quot;Jack&quot;,
    &quot;age&quot;: 21
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>对应的JavaAPI如下：</p>
<figure><img src="/image/es/es12.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>可以看到与索引库操作的API非常类似，同样是三步走：</p>
<ul>
<li>1）创建Request对象，这里是<code v-pre>IndexRequest</code>，因为添加文档就是创建倒排索引的过程</li>
<li>2）准备请求参数，本例中就是Json文档</li>
<li>3）发送请求</li>
</ul>
<p>变化的地方在于，这里直接使用<code v-pre>client.xxx()</code>的API，不再需要<code v-pre>client.indices()</code>了。</p>
<h4 id="_3-完整代码" tabindex="-1"><a class="header-anchor" href="#_3-完整代码"><span>3）完整代码</span></a></h4>
<p>我们导入商品数据，除了参考API模板“三步走”以外，还需要做几点准备工作：</p>
<ul>
<li>商品数据来自于数据库，我们需要先查询出来，得到<code v-pre>Item</code>对象</li>
<li><code v-pre>Item</code>对象需要转为<code v-pre>ItemDoc</code>对象</li>
<li><code v-pre>ItemDTO</code>需要序列化为<code v-pre>json</code>格式</li>
</ul>
<p>因此，代码整体步骤如下：</p>
<ul>
<li>1）根据id查询商品数据<code v-pre>Item</code></li>
<li>2）将<code v-pre>Item</code>封装为<code v-pre>ItemDoc</code></li>
<li>3）将<code v-pre>ItemDoc</code>序列化为JSON</li>
<li>4）创建IndexRequest，指定索引库名和id</li>
<li>5）准备请求参数，也就是JSON文档</li>
<li>6）发送请求</li>
</ul>
<p>在<code v-pre>item-service</code>的<code v-pre>DocumentTest</code>测试类中，编写单元测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testAddDocument() throws IOException {
    // 1.根据id查询商品数据
    Item item = itemService.getById(100002644680L);
    // 2.转换为文档类型
    ItemDoc itemDoc = BeanUtil.copyProperties(item, ItemDoc.class);
    // 3.将ItemDTO转json
    String doc = JSONUtil.toJsonStr(itemDoc);

    // 1.准备Request对象
    IndexRequest request = new IndexRequest(&quot;items&quot;).id(itemDoc.getId());
    // 2.准备Json文档
    request.source(doc, XContentType.JSON);
    // 3.发送请求
    client.index(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、查询文档-1" tabindex="-1"><a class="header-anchor" href="#_2、查询文档-1"><span>2、查询文档</span></a></h3>
<p>我们以根据id查询文档为例</p>
<h4 id="_1-语法说明" tabindex="-1"><a class="header-anchor" href="#_1-语法说明"><span>1）语法说明</span></a></h4>
<p>查询的请求语句如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_doc/{id}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>与之前的流程类似，代码大概分2步：</p>
<ul>
<li>创建Request对象</li>
<li>准备请求参数，这里是无参，直接省略</li>
<li>发送请求</li>
</ul>
<p>不过查询的目的是得到结果，解析为ItemDTO，还要再加一步对结果的解析。响应结果是一个JSON，其中文档放在一个<code v-pre>_source</code>属性中，因此解析就是拿到<code v-pre>_source</code>，反序列化为Java对象即可。</p>
<p>其它代码与之前类似，流程如下：</p>
<ul>
<li>1）准备Request对象。这次是查询，所以是<code v-pre>GetRequest</code></li>
<li>2）发送请求，得到结果。因为是查询，这里调用<code v-pre>client.get()</code>方法</li>
<li>3）解析结果，就是对JSON做反序列化</li>
</ul>
<h4 id="_2-完整代码" tabindex="-1"><a class="header-anchor" href="#_2-完整代码"><span>2）完整代码</span></a></h4>
<p>在<code v-pre>item-service</code>的<code v-pre>DocumentTest</code>测试类中，编写单元测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testGetDocumentById() throws IOException {
    // 1.准备Request对象
    GetRequest request = new GetRequest(&quot;items&quot;).id(&quot;100002644680&quot;);
    // 2.发送请求
    GetResponse response = client.get(request, RequestOptions.DEFAULT);
    // 3.获取响应结果中的source
    String json = response.getSourceAsString();
    
    ItemDoc itemDoc = JSONUtil.toBean(json, ItemDoc.class);
    System.out.println(&quot;itemDoc= &quot; + ItemDoc);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、删除文档-1" tabindex="-1"><a class="header-anchor" href="#_3、删除文档-1"><span>3、删除文档</span></a></h3>
<p>删除的请求语句如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>DELETE /hotel/_doc/{id}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>与查询相比，仅仅是请求方式从<code v-pre>DELETE</code>变成<code v-pre>GET</code>，可以想象Java代码应该依然是2步走：</p>
<ul>
<li>1）准备Request对象，因为是删除，这次是<code v-pre>DeleteRequest</code>对象。要指定索引库名和id</li>
<li>2）准备参数，无参，直接省略</li>
<li>3）发送请求。因为是删除，所以是<code v-pre>client.delete()</code>方法</li>
</ul>
<p>在<code v-pre>item-service</code>的<code v-pre>DocumentTest</code>测试类中，编写单元测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testDeleteDocument() throws IOException {
    // 1.准备Request，两个参数，第一个是索引库名，第二个是文档id
    DeleteRequest request = new DeleteRequest(&quot;item&quot;, &quot;100002644680&quot;);
    // 2.发送请求
    client.delete(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、修改文档-1" tabindex="-1"><a class="header-anchor" href="#_4、修改文档-1"><span>4、修改文档</span></a></h3>
<p>修改我们讲过两种方式：</p>
<ul>
<li>全量修改：本质是先根据id删除，再新增</li>
<li>局部修改：修改文档中的指定字段值</li>
</ul>
<p>在RestClient的API中，全量修改与新增的API完全一致，判断依据是ID：</p>
<ul>
<li>如果新增时，ID已经存在，则修改</li>
<li>如果新增时，ID不存在，则新增</li>
</ul>
<p>局部修改的请求语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>POST /{索引库名}/_update/{id}
{
  &quot;doc&quot;: {
    &quot;字段名&quot;: &quot;字段值&quot;,
    &quot;字段名&quot;: &quot;字段值&quot;
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在<code v-pre>item-service</code>的<code v-pre>DocumentTest</code>测试类中，编写单元测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testUpdateDocument() throws IOException {
    // 1.准备Request
    UpdateRequest request = new UpdateRequest(&quot;items&quot;, &quot;100002644680&quot;);
    // 2.准备请求参数
    request.doc(
            &quot;price&quot;, 58800,
            &quot;commentCount&quot;, 1
    );
    // 3.发送请求
    client.update(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="九、批量导入文档" tabindex="-1"><a class="header-anchor" href="#九、批量导入文档"><span>九、批量导入文档</span></a></h2>
<p>在之前的案例中，我们都是操作单个文档。而数据库中的商品数据实际会达到数十万条，某些项目中可能达到数百万条。</p>
<p>我们如果要将这些数据导入索引库，肯定不能逐条导入，而是采用批处理方案。常见的方案有：</p>
<ul>
<li>利用Logstash批量导入
<ul>
<li>需要安装Logstash</li>
<li>对数据的再加工能力较弱</li>
<li>无需编码，但要学习编写Logstash导入配置</li>
</ul>
</li>
<li>利用JavaAPI批量导入
<ul>
<li>需要编码，但基于JavaAPI，学习成本低</li>
<li>更加灵活，可以任意对数据做再加工处理后写入索引库</li>
</ul>
</li>
</ul>
<p>接下来，我们利用JavaAPI实现批量文档导入。</p>
<h3 id="_1、语法说明" tabindex="-1"><a class="header-anchor" href="#_1、语法说明"><span>1、语法说明</span></a></h3>
<p>批处理与前面讲的文档的CRUD步骤基本一致：</p>
<ul>
<li>创建Request，但这次用的是<code v-pre>BulkRequest</code></li>
<li>准备请求参数</li>
<li>发送请求，这次要用到<code v-pre>client.bulk()</code>方法</li>
</ul>
<p><code v-pre>BulkRequest</code>本身其实并没有请求参数，其本质就是将多个普通的CRUD请求组合在一起发送。例如：</p>
<ul>
<li>批量新增文档，就是给每个文档创建一个<code v-pre>IndexRequest</code>请求，然后封装到<code v-pre>BulkRequest</code>中，一起发出。</li>
<li>批量删除，就是创建N个<code v-pre>DeleteRequest</code>请求，然后封装到<code v-pre>BulkRequest</code>，一起发出</li>
</ul>
<p>因此<code v-pre>BulkRequest</code>中提供了<code v-pre>add</code>方法，用以添加其它CRUD的请求</p>
<p>可以看到，能添加的请求有：</p>
<ul>
<li><code v-pre>IndexRequest</code>，也就是新增</li>
<li><code v-pre>UpdateRequest</code>，也就是修改</li>
<li><code v-pre>DeleteRequest</code>，也就是删除</li>
</ul>
<p>因此Bulk中添加了多个<code v-pre>IndexRequest</code>，就是批量新增功能了。示例：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testBulk() throws IOException {
    // 1.创建Request
    BulkRequest request = new BulkRequest();
    // 2.准备请求参数
    request.add(new IndexRequest(&quot;items&quot;).id(&quot;1&quot;).source(&quot;json doc1&quot;, XContentType.JSON));
    request.add(new IndexRequest(&quot;items&quot;).id(&quot;2&quot;).source(&quot;json doc2&quot;, XContentType.JSON));
    // 3.发送请求
    client.bulk(request, RequestOptions.DEFAULT);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、完整代码" tabindex="-1"><a class="header-anchor" href="#_2、完整代码"><span>2、完整代码</span></a></h3>
<p>当我们要导入商品数据时，由于商品数量达到数十万，因此不可能一次性全部导入。建议采用循环遍历方式，每次导入1000条左右的数据。</p>
<p><code v-pre>item-service</code>的<code v-pre>DocumentTest</code>测试类中，编写单元测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testLoadItemDocs() throws IOException {
    // 分页查询商品数据
    int pageNo = 1;
    int size = 1000;
    while (true) {
        Page&lt;Item&gt; page = itemService.lambdaQuery().eq(Item::getStatus, 1).page(new Page&lt;Item&gt;(pageNo, size));
        // 非空校验
        List&lt;Item&gt; items = page.getRecords();
        if (CollUtils.isEmpty(items)) {
            return;
        }
        log.info(&quot;加载第{}页数据，共{}条&quot;, pageNo, items.size());
        // 1.创建Request
        BulkRequest request = new BulkRequest(&quot;items&quot;);
        // 2.准备参数，添加多个新增的Request
        for (Item item : items) {
            // 2.1.转换为文档类型ItemDTO
            ItemDoc itemDoc = BeanUtil.copyProperties(item, ItemDoc.class);
            // 2.2.创建新增文档的Request对象
            request.add(new IndexRequest()
                            .id(itemDoc.getId())
                            .source(JSONUtil.toJsonStr(itemDoc), XContentType.JSON));
        }
        // 3.发送请求
        client.bulk(request, RequestOptions.DEFAULT);

        // 翻页
        pageNo++;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container important">
<p class="hint-container-title">小结</p>
<p>文档操作的基本步骤：</p>
<ul>
<li>初始化<code v-pre>RestHighLevelClient</code></li>
<li>创建XxxRequest。
<ul>
<li>XXX是<code v-pre>Index</code>、<code v-pre>Get</code>、<code v-pre>Update</code>、<code v-pre>Delete</code>、<code v-pre>Bulk</code></li>
</ul>
</li>
<li>准备参数（<code v-pre>Index</code>、<code v-pre>Update</code>、<code v-pre>Bulk</code>时需要）</li>
<li>发送请求。
<ul>
<li>调用<code v-pre>RestHighLevelClient#.xxx()</code>方法，xxx是<code v-pre>index</code>、<code v-pre>get</code>、<code v-pre>update</code>、<code v-pre>delete</code>、<code v-pre>bulk</code></li>
</ul>
</li>
<li>解析结果（<code v-pre>Get</code>时需要）</li>
</ul>
</div>
</div></template>


