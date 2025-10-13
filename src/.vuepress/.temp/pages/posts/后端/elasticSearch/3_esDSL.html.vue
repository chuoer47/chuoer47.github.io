<template><div><!--more--->
<h1 id="elasticsearch-dsl" tabindex="-1"><a class="header-anchor" href="#elasticsearch-dsl"><span>ElasticSearch DSL</span></a></h1>
<h2 id="一、dsl查询" tabindex="-1"><a class="header-anchor" href="#一、dsl查询"><span>一、DSL查询</span></a></h2>
<p>Elasticsearch提供了基于JSON的DSL（<a href="https://www.elastic.co/guide/en/elasticsearch/reference/7.12/query-dsl.html" target="_blank" rel="noopener noreferrer">Domain Specific Language</a>）语句来定义查询条件，其JavaAPI就是在组织DSL条件。</p>
<div class="hint-container info">
<p class="hint-container-title">Elasticsearch的查询可以分为两大类：</p>
<ul>
<li><strong>叶子查询（Leaf</strong> <strong>query</strong> <strong>clauses）</strong>：一般是在特定的字段里查询特定值，属于简单查询，很少单独使用。</li>
<li><strong>复合查询（Compound</strong> <strong>query</strong> <strong>clauses）</strong>：以逻辑方式组合多个叶子查询或者更改叶子查询的行为方式。</li>
</ul>
</div>
<h3 id="_1、叶子查询" tabindex="-1"><a class="header-anchor" href="#_1、叶子查询"><span>1、叶子查询</span></a></h3>
<p>叶子查询的类型也可以做进一步细分，详情大家可以查看<a href="https://www.elastic.co/guide/en/elasticsearch/reference/7.12/query-dsl.html" target="_blank" rel="noopener noreferrer">官方文档</a></p>
<p>这里列举一些常见的，例如：</p>
<ul>
<li>
<p><strong>全文检索查询（Full Text Queries）</strong>：利用分词器对用户输入搜索条件先分词，得到词条，然后再利用倒排索引搜索词条。例如：</p>
<ul>
<li><code v-pre>match</code>：</li>
<li><code v-pre>multi_match</code></li>
</ul>
</li>
<li>
<p><strong>精确查询（Term-level queries）</strong>：不对用户输入搜索条件分词，根据字段内容精确值匹配。但只能查找keyword、数值、日期、boolean类型的字段。例如：</p>
<ul>
<li><code v-pre>ids</code></li>
<li><code v-pre>term</code></li>
<li><code v-pre>range</code></li>
</ul>
</li>
<li>
<p><strong>地理坐标查询：</strong> 用于搜索地理位置，搜索方式很多，例如：</p>
<ul>
<li><code v-pre>geo_bounding_box</code>：按矩形搜索</li>
<li><code v-pre>geo_distance</code>：按点和半径搜索</li>
</ul>
</li>
</ul>
<h4 id="_1-全文检索查询" tabindex="-1"><a class="header-anchor" href="#_1-全文检索查询"><span>1）全文检索查询</span></a></h4>
<p>全文检索的种类也很多，详情可以参考<a href="https://www.elastic.co/guide/en/elasticsearch/reference/7.12/full-text-queries.html" target="_blank" rel="noopener noreferrer">官方文档</a></p>
<p>以全文检索中的<code v-pre>match</code>为例，语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_search
{
  &quot;query&quot;: {
    &quot;match&quot;: {
      &quot;字段名&quot;: &quot;搜索条件&quot;
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>与<code v-pre>match</code>类似的还有<code v-pre>multi_match</code>，区别在于可以同时对多个字段搜索，而且多个字段都要满足，语法示例：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_search
{
  &quot;query&quot;: {
    &quot;multi_match&quot;: {
      &quot;query&quot;: &quot;搜索条件&quot;,
      &quot;fields&quot;: [&quot;字段1&quot;, &quot;字段2&quot;]
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-精确查询" tabindex="-1"><a class="header-anchor" href="#_2-精确查询"><span>2）精确查询</span></a></h4>
<p>精确查询，英文是<code v-pre>Term-level query</code>，顾名思义，词条级别的查询。也就是说不会对用户输入的搜索条件再分词，而是作为一个词条，与搜索的字段内容精确值匹配。因此推荐查找<code v-pre>keyword</code>、数值、日期、<code v-pre>boolean</code>类型的字段。例如：id，price，城市，地名，人名，等等，作为一个整体才有含义的字段。</p>
<p>以<code v-pre>term</code>查询为例，其语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_search
{
  &quot;query&quot;: {
    &quot;term&quot;: {
      &quot;字段名&quot;: {
        &quot;value&quot;: &quot;搜索条件&quot;
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_3-range查询" tabindex="-1"><a class="header-anchor" href="#_3-range查询"><span>3）<code v-pre>range</code>查询</span></a></h4>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_search
{
  &quot;query&quot;: {
    &quot;range&quot;: {
      &quot;字段名&quot;: {
        &quot;gte&quot;: {最小值},
        &quot;lte&quot;: {最大值}
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><code v-pre>range</code>是范围查询，对于范围筛选的关键字有：</p>
<ul>
<li><code v-pre>gte</code>：大于等于</li>
<li><code v-pre>gt</code>：大于</li>
<li><code v-pre>lte</code>：小于等于</li>
<li><code v-pre>lt</code>：小于</li>
</ul>
<h3 id="_2、复合查询" tabindex="-1"><a class="header-anchor" href="#_2、复合查询"><span>2、复合查询</span></a></h3>
<div class="hint-container info">
<p class="hint-container-title">复合查询大致可以分为两类：</p>
<ul>
<li>第一类：基于逻辑运算组合叶子查询，实现组合条件，例如
<ul>
<li>bool</li>
</ul>
</li>
<li>第二类：基于某种算法修改查询时的文档相关性算分，从而改变文档排名。例如：
<ul>
<li>function_score</li>
<li>dis_max</li>
</ul>
</li>
</ul>
</div>
<h4 id="_1-算分函数查询" tabindex="-1"><a class="header-anchor" href="#_1-算分函数查询"><span>1）算分函数查询</span></a></h4>
<p>当我们利用match查询时，文档结果会根据与搜索词条的<strong>关联度打分</strong>（<strong>_score</strong>），返回结果时按照分值降序排列。</p>
<p>要想认为控制相关性算分，就需要利用elasticsearch中的function score 查询了。</p>
<p><strong>基本语法</strong>：</p>
<p>function score 查询中包含四部分内容：</p>
<ul>
<li><strong>原始查询</strong>条件：query部分，基于这个条件搜索文档，并且基于BM25算法给文档打分，<strong>原始算分</strong>（query score)</li>
<li><strong>过滤条件</strong>：filter部分，符合该条件的文档才会重新算分</li>
<li><strong>算分函数</strong>：符合filter条件的文档要根据这个函数做运算，得到的<strong>函数算分</strong>（function score），有四种函数
<ul>
<li>weight：函数结果是常量</li>
<li>field_value_factor：以文档中的某个字段值作为函数结果</li>
<li>random_score：以随机数作为函数结果</li>
<li>script_score：自定义算分函数算法</li>
</ul>
</li>
<li><strong>运算模式</strong>：算分函数的结果、原始查询的相关性算分，两者之间的运算方式，包括：
<ul>
<li>multiply：相乘</li>
<li>replace：用function score替换query score</li>
<li>其它，例如：sum、avg、max、min</li>
</ul>
</li>
</ul>
<div class="hint-container info">
<p class="hint-container-title">function score的运行流程如下：</p>
<ul>
<li>1）根据<strong>原始条件</strong>查询搜索文档，并且计算相关性算分，称为<strong>原始算分</strong>（query score）</li>
<li>2）根据<strong>过滤条件</strong>，过滤文档</li>
<li>3）符合<strong>过滤条件</strong>的文档，基于<strong>算分函数</strong>运算，得到<strong>函数算分</strong>（function score）</li>
<li>4）将<strong>原始算分</strong>（query score）和<strong>函数算分</strong>（function score）基于<strong>运算模式</strong>做运算，得到最终结果，作为相关性算分。</li>
</ul>
</div>
<div class="hint-container important">
<p class="hint-container-title">其中的关键点是：</p>
<ul>
<li>过滤条件：决定哪些文档的算分被修改</li>
<li>算分函数：决定函数算分的算法</li>
<li>运算模式：决定最终算分结果</li>
</ul>
</div>
<p><strong>示例：</strong> 给IPhone这个品牌的手机算分提高十倍，分析如下：</p>
<ul>
<li>过滤条件：品牌必须为IPhone</li>
<li>算分函数：常量weight，值为10</li>
<li>算分模式：相乘multiply</li>
</ul>
<p>对应代码如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /hotel/_search
{
  &quot;query&quot;: {
    &quot;function_score&quot;: {
      &quot;query&quot;: {  .... }, // 原始查询，可以是任意条件
      &quot;functions&quot;: [ // 算分函数
        {
          &quot;filter&quot;: { // 满足的条件，品牌必须是Iphone
            &quot;term&quot;: {
              &quot;brand&quot;: &quot;Iphone&quot;
            }
          },
          &quot;weight&quot;: 10 // 算分权重为2
        }
      ],
      &quot;boost_mode&quot;: &quot;multipy&quot; // 加权模式，求乘积
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-bool查询" tabindex="-1"><a class="header-anchor" href="#_2-bool查询"><span>2）bool查询</span></a></h4>
<p>bool查询，即布尔查询。就是利用逻辑运算来组合一个或多个查询子句的组合。</p>
<div class="hint-container tip">
<p class="hint-container-title">bool查询支持的逻辑运算有：</p>
<ul>
<li>must：必须匹配每个子查询，类似“与”</li>
<li>should：选择性匹配子查询，类似“或”</li>
<li>must_not：必须不匹配，<strong>不参与算分</strong>，类似“非”</li>
<li>filter：必须匹配，<strong>不参与算分</strong></li>
</ul>
</div>
<p>bool查询的语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;query&quot;: {
    &quot;bool&quot;: {
      &quot;must&quot;: [
        {&quot;match&quot;: {&quot;name&quot;: &quot;手机&quot;}}
      ],
      &quot;should&quot;: [
        {&quot;term&quot;: {&quot;brand&quot;: { &quot;value&quot;: &quot;vivo&quot; }}},
        {&quot;term&quot;: {&quot;brand&quot;: { &quot;value&quot;: &quot;小米&quot; }}}
      ],
      &quot;must_not&quot;: [
        {&quot;range&quot;: {&quot;price&quot;: {&quot;gte&quot;: 2500}}}
      ],
      &quot;filter&quot;: [
        {&quot;range&quot;: {&quot;price&quot;: {&quot;lte&quot;: 1000}}}
      ]
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p>出于性能考虑，与搜索关键字无关的查询尽量采用must_not或filter逻辑运算，避免参与相关性算分。</p>
</div>
<h3 id="_3、排序" tabindex="-1"><a class="header-anchor" href="#_3、排序"><span>3、排序</span></a></h3>
<p>elasticsearch默认是根据相关度算分（<code v-pre>_score</code>）来排序，但是也支持自定义方式对搜索结果排序。不过分词字段无法排序，能参与排序字段类型有：<code v-pre>keyword</code>类型、数值类型、地理坐标类型、日期类型等。</p>
<p>语法说明：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /indexName/_search
{
  &quot;query&quot;: {
    &quot;match_all&quot;: {}
  },
  &quot;sort&quot;: [
    {
      &quot;排序字段&quot;: {
        &quot;order&quot;: &quot;排序方式asc和desc&quot;
      }
    }
  ]
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>示例，我们按照商品价格排序：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;query&quot;: {
    &quot;match_all&quot;: {}
  },
  &quot;sort&quot;: [
    {
      &quot;price&quot;: {
        &quot;order&quot;: &quot;desc&quot;
      }
    }
  ]
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、分页" tabindex="-1"><a class="header-anchor" href="#_4、分页"><span>4、分页</span></a></h3>
<p>elasticsearch 默认情况下只返回top10的数据。而如果要查询更多数据就需要修改分页参数了。</p>
<h4 id="_1-基础分页" tabindex="-1"><a class="header-anchor" href="#_1-基础分页"><span>1）基础分页</span></a></h4>
<p>elasticsearch中通过修改<code v-pre>from</code>、<code v-pre>size</code>参数来控制要返回的分页结果：</p>
<ul>
<li><code v-pre>from</code>：从第几个文档开始</li>
<li><code v-pre>size</code>：总共查询几个文档</li>
</ul>
<p>类似于mysql中的<code v-pre>limit ?, ?</code></p>
<p>语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;query&quot;: {
    &quot;match_all&quot;: {}
  },
  &quot;from&quot;: 0, // 分页开始的位置，默认为0
  &quot;size&quot;: 10,  // 每页文档数量，默认10
  &quot;sort&quot;: [
    {
      &quot;price&quot;: {
        &quot;order&quot;: &quot;desc&quot;
      }
    }
  ]
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-深度分页" tabindex="-1"><a class="header-anchor" href="#_2-深度分页"><span>2）深度分页</span></a></h4>
<p>elasticsearch的数据一般会采用分片存储，也就是把一个索引中的数据分成N份，存储到不同节点上。这种存储方式比较有利于数据扩展，但给分页带来了一些麻烦。</p>
<p>比如一个索引库中有100000条数据，分别存储到4个分片，每个分片25000条数据。现在每页查询10条，查询第99页。那么分页查询的条件如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;from&quot;: 990, // 从第990条开始查询
  &quot;size&quot;: 10, // 每页查询10条
  &quot;sort&quot;: [
    {
      &quot;price&quot;: &quot;asc&quot;
    }
  ]
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>从语句来分析，要查询第990~1000名的数据。</p>
<p>从实现思路来分析，肯定是将所有数据排序，找出前1000名，截取其中的990~1000的部分。但问题来了，我们如何才能找到所有数据中的前1000名呢？</p>
<p>要知道每一片的数据都不一样，第1片上的第900~1000，在另1个节点上并不一定依然是900~1000名。所以我们只能在每一个分片上都找出排名前1000的数据，然后汇总到一起，重新排序，才能找出整个索引库中真正的前1000名，此时截取990~1000的数据即可。</p>
<p>如图：</p>
<figure><img src="/image/es/es13.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>试想一下，假如我们现在要查询的是第999页数据呢，是不是要找第9990~10000的数据，那岂不是需要把每个分片中的前10000名数据都查询出来，汇总在一起，在内存中排序？如果查询的分页深度更深呢，需要一次检索的数据岂不是更多？</p>
<p>由此可知，当查询分页深度较大时，汇总数据过多，对内存和CPU会产生非常大的压力。<strong>因此elasticsearch会禁止<code v-pre>from+ size </code>超过10000的请求。</strong></p>
<div class="hint-container important">
<p class="hint-container-title">针对深度分页，elasticsearch提供了两种解决方案：</p>
<ul>
<li><code v-pre>search after</code>：分页时需要排序，原理是从上一次的排序值开始，查询下一页数据。官方推荐使用的方式。</li>
<li><code v-pre>scroll</code>：原理将排序后的文档id形成快照，保存下来，基于快照做分页。官方已经不推荐使用。</li>
</ul>
</div>
<div class="hint-container tip">
<p class="hint-container-title">总结：</p>
<p>大多数情况下，我们采用普通分页就可以了。查看百度、京东等网站，会发现其分页都有限制。例如百度最多支持77页，每页不足20条。京东最多100页，每页最多60条。</p>
<p><strong>因此，一般我们采用限制分页深度的方式即可，无需实现深度分页。</strong></p>
</div>
<h3 id="_5、高亮" tabindex="-1"><a class="header-anchor" href="#_5、高亮"><span>5、高亮</span></a></h3>
<h4 id="_1-高亮原理" tabindex="-1"><a class="header-anchor" href="#_1-高亮原理"><span>1）高亮原理</span></a></h4>
<p>什么是高亮显示呢？我们在百度，京东搜索时，关键字会变成红色，比较醒目，这叫高亮显示。</p>
<div class="hint-container tip">
<p class="hint-container-title">观察页面源码，你会发现两件事情：</p>
<ul>
<li>高亮词条都被加了<code v-pre>&lt;em&gt;</code>标签</li>
<li><code v-pre>&lt;em&gt;</code>标签都添加了红色样式</li>
</ul>
</div>
<p>词条的<strong>高亮标签肯定是由服务端提供数据的时候已经加上的</strong>。</p>
<p>因此实现高亮的思路就是：</p>
<ul>
<li>用户输入搜索关键字搜索数据</li>
<li>服务端根据搜索关键字到elasticsearch搜索，并给搜索结果中的关键字词条添加<code v-pre>html</code>标签</li>
<li>前端提前给约定好的<code v-pre>html</code>标签添加<code v-pre>CSS</code>样式</li>
</ul>
<h4 id="_2-实现高亮" tabindex="-1"><a class="header-anchor" href="#_2-实现高亮"><span>2）实现高亮</span></a></h4>
<p>事实上elasticsearch已经提供了给搜索关键字加标签的语法，无需我们自己编码。</p>
<p>基本语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /{索引库名}/_search
{
  &quot;query&quot;: {
    &quot;match&quot;: {
      &quot;搜索字段&quot;: &quot;搜索关键字&quot;
    }
  },
  &quot;highlight&quot;: {
    &quot;fields&quot;: {
      &quot;高亮字段名称&quot;: {
        &quot;pre_tags&quot;: &quot;&lt;em&gt;&quot;,
        &quot;post_tags&quot;: &quot;&lt;/em&gt;&quot;
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container warning">
<p class="hint-container-title">注意 ：</p>
<ul>
<li>搜索必须有查询条件，而且是全文检索类型的查询条件，例如<code v-pre>match</code></li>
<li>参与高亮的字段必须是<code v-pre>text</code>类型的字段</li>
<li>默认情况下参与高亮的字段要与搜索字段一致，除非添加：<code v-pre>required_field_match=false</code></li>
</ul>
</div>
<div class="hint-container important">
<p class="hint-container-title">总结：</p>
<p>查询的DSL是一个大的JSON对象，包含下列属性：</p>
<ul>
<li><code v-pre>query</code>：查询条件</li>
<li><code v-pre>from</code>和<code v-pre>size</code>：分页条件</li>
<li><code v-pre>sort</code>：排序条件</li>
<li><code v-pre>highlight</code>：高亮条件</li>
</ul>
</div>
<h2 id="二、restclient查询" tabindex="-1"><a class="header-anchor" href="#二、restclient查询"><span>二、RestClient查询</span></a></h2>
<p>文档的查询依然使用昨天学习的 <code v-pre>RestHighLevelClient</code>对象，查询的基本步骤如下：</p>
<ul>
<li>1）创建<code v-pre>request</code>对象，这次是搜索，所以是<code v-pre>SearchRequest</code></li>
<li>2）准备请求参数，也就是查询DSL对应的JSON参数</li>
<li>3）发起请求</li>
<li>4）解析响应，响应结果相对复杂，需要逐层解析</li>
</ul>
<h3 id="_1、快速入门" tabindex="-1"><a class="header-anchor" href="#_1、快速入门"><span>1、快速入门</span></a></h3>
<p>文档搜索的基本步骤是：</p>
<ol>
<li>创建<code v-pre>SearchRequest</code>对象</li>
<li>准备<code v-pre>request.source()</code>，也就是DSL。
<ol>
<li><code v-pre>QueryBuilders</code>来构建查询条件</li>
<li>传入<code v-pre>request.source()</code> 的<code v-pre>query()</code>方法</li>
</ol>
</li>
<li>发送请求，得到结果</li>
<li>解析结果（参考JSON结果，从外到内，逐层解析）</li>
</ol>
<p>完整代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testMatchAll() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    request.source().query(QueryBuilders.matchAllQuery());
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}

private void handleResponse(SearchResponse response) {
    SearchHits searchHits = response.getHits();
    // 1.获取总条数
    long total = searchHits.getTotalHits().value;
    System.out.println(&quot;共搜索到&quot; + total + &quot;条数据&quot;);
    // 2.遍历结果数组
    SearchHit[] hits = searchHits.getHits();
    for (SearchHit hit : hits) {
        // 3.得到_source，也就是原始json文档
        String source = hit.getSourceAsString();
        // 4.反序列化并打印
        ItemDoc item = JSONUtil.toBean(source, ItemDoc.class);
        System.out.println(item);
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、叶子查询" tabindex="-1"><a class="header-anchor" href="#_2、叶子查询"><span>2、叶子查询</span></a></h3>
<p>所有的查询条件都是由QueryBuilders来构建的，叶子查询也不例外。因此整套代码中变化的部分仅仅是query条件构造的方式，其它不动。</p>
<p>例如<code v-pre>match</code>查询：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testMatch() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    request.source().query(QueryBuilders.matchQuery(&quot;name&quot;, &quot;脱脂牛奶&quot;));
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>再比如<code v-pre>multi_match</code>查询：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testMultiMatch() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    request.source().query(QueryBuilders.multiMatchQuery(&quot;脱脂牛奶&quot;, &quot;name&quot;, &quot;category&quot;));
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>还有<code v-pre>range</code>查询：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testRange() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    request.source().query(QueryBuilders.rangeQuery(&quot;price&quot;).gte(10000).lte(30000));
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>还有<code v-pre>term</code>查询：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testTerm() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    request.source().query(QueryBuilders.termQuery(&quot;brand&quot;, &quot;华为&quot;));
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、复合查询" tabindex="-1"><a class="header-anchor" href="#_3、复合查询"><span>3、复合查询</span></a></h3>
<p>复合查询也是由<code v-pre>QueryBuilders</code>来构建</p>
<p>完整代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testBool() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    // 2.1.准备bool查询
    BoolQueryBuilder bool = QueryBuilders.boolQuery();
    // 2.2.关键字搜索
    bool.must(QueryBuilders.matchQuery(&quot;name&quot;, &quot;脱脂牛奶&quot;));
    // 2.3.品牌过滤
    bool.filter(QueryBuilders.termQuery(&quot;brand&quot;, &quot;德亚&quot;));
    // 2.4.价格过滤
    bool.filter(QueryBuilders.rangeQuery(&quot;price&quot;).lte(30000));
    request.source().query(bool);
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、排序和分页" tabindex="-1"><a class="header-anchor" href="#_4、排序和分页"><span>4、排序和分页</span></a></h3>
<p><code v-pre>requeset.source()</code>就是整个请求JSON参数，所以排序、分页都是基于这个来设置</p>
<p>完整示例代码：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testPageAndSort() throws IOException {
    int pageNo = 1, pageSize = 5;

    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    // 2.1.搜索条件参数
    request.source().query(QueryBuilders.matchQuery(&quot;name&quot;, &quot;脱脂牛奶&quot;));
    // 2.2.排序参数
    request.source().sort(&quot;price&quot;, SortOrder.ASC);
    // 2.3.分页参数
    request.source().from((pageNo - 1) * pageSize).size(pageSize);
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_5、高亮-1" tabindex="-1"><a class="header-anchor" href="#_5、高亮-1"><span>5、高亮</span></a></h3>
<p>高亮查询与前面的查询有两点不同：</p>
<ul>
<li>条件同样是在<code v-pre>request.source()</code>中指定，只不过高亮条件要基于<code v-pre>HighlightBuilder</code>来构造</li>
<li>高亮响应结果与搜索的文档结果不在一起，需要单独解析</li>
</ul>
<p>示例代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testHighlight() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.组织请求参数
    // 2.1.query条件
    request.source().query(QueryBuilders.matchQuery(&quot;name&quot;, &quot;脱脂牛奶&quot;));
    // 2.2.高亮条件
    request.source().highlighter(
            SearchSourceBuilder.highlight()
                    .field(&quot;name&quot;)
                    .preTags(&quot;&lt;em&gt;&quot;)
                    .postTags(&quot;&lt;/em&gt;&quot;)
    );
    // 3.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 4.解析响应
    handleResponse(response);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>代码解读：</p>
<ul>
<li>第<code v-pre>3、4</code>步：从结果中获取<code v-pre>_source</code>。<code v-pre>hit.getSourceAsString()</code>，这部分是非高亮结果，json字符串。还需要反序列为<code v-pre>ItemDoc</code>对象</li>
<li>第<code v-pre>5</code>步：获取高亮结果。<code v-pre>hit.getHighlightFields()</code>，返回值是一个<code v-pre>Map</code>，key是高亮字段名称，值是<code v-pre>HighlightField</code>对象，代表高亮值</li>
<li>第<code v-pre>5.1</code>步：从<code v-pre>Map</code>中根据高亮字段名称，获取高亮字段值对象<code v-pre>HighlightField</code></li>
<li>第<code v-pre>5.2</code>步：从<code v-pre>HighlightField</code>中获取<code v-pre>Fragments</code>，并且转为字符串。这部分就是真正的高亮字符串了</li>
<li>最后：用高亮的结果替换<code v-pre>ItemDoc</code>中的非高亮结果</li>
</ul>
<p>完整代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>private void handleResponse(SearchResponse response) {
    SearchHits searchHits = response.getHits();
    // 1.获取总条数
    long total = searchHits.getTotalHits().value;
    System.out.println(&quot;共搜索到&quot; + total + &quot;条数据&quot;);
    // 2.遍历结果数组
    SearchHit[] hits = searchHits.getHits();
    for (SearchHit hit : hits) {
        // 3.得到_source，也就是原始json文档
        String source = hit.getSourceAsString();
        // 4.反序列化
        ItemDoc item = JSONUtil.toBean(source, ItemDoc.class);
        // 5.获取高亮结果
        Map&lt;String, HighlightField&gt; hfs = hit.getHighlightFields();
        if (CollUtils.isNotEmpty(hfs)) {
            // 5.1.有高亮结果，获取name的高亮结果
            HighlightField hf = hfs.get(&quot;name&quot;);
            if (hf != null) {
                // 5.2.获取第一个高亮结果片段，就是商品名称的高亮值
                String hfName = hf.getFragments()[0].string();
                item.setName(hfName);
            }
        }
        System.out.println(item);
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="三、数据聚合" tabindex="-1"><a class="header-anchor" href="#三、数据聚合"><span>三、数据聚合</span></a></h2>
<p>聚合（<code v-pre>aggregations</code>）可以让我们极其方便的实现对数据的统计、分析、运算。例如：</p>
<ul>
<li>什么品牌的手机最受欢迎？</li>
<li>这些手机的平均价格、最高价格、最低价格？</li>
<li>这些手机每月的销售情况如何？</li>
</ul>
<p>实现这些统计功能的比数据库的sql要方便的多，而且查询速度非常快，可以实现近实时搜索效果。</p>
<p><strong>聚合常见的有三类：</strong></p>
<ul>
<li>**桶（<strong><strong><code v-pre>Bucket</code></strong></strong>）**聚合：用来对文档做分组</li>
<li><code v-pre>TermAggregation</code>：按照文档字段值分组，例如按照品牌值分组、按照国家分组</li>
<li><code v-pre>Date Histogram</code>：按照日期阶梯分组，例如一周为一组，或者一月为一组</li>
<li>**度量（<strong><strong><code v-pre>Metric</code></strong></strong>）**聚合：用以计算一些值，比如：最大值、最小值、平均值等</li>
<li><code v-pre>Avg</code>：求平均值</li>
<li><code v-pre>Max</code>：求最大值</li>
<li><code v-pre>Min</code>：求最小值</li>
<li><code v-pre>Stats</code>：同时求<code v-pre>max</code>、<code v-pre>min</code>、<code v-pre>avg</code>、<code v-pre>sum</code>等</li>
<li>**管道（<strong><strong><code v-pre>pipeline</code></strong></strong>）**聚合：其它聚合的结果为基础做进一步运算</li>
</ul>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p>参加聚合的字段必须是keyword、日期、数值、布尔类型</p>
</div>
<h3 id="_1、dsl实现" tabindex="-1"><a class="header-anchor" href="#_1、dsl实现"><span>1、DSL实现</span></a></h3>
<h4 id="_1-bucket聚合" tabindex="-1"><a class="header-anchor" href="#_1-bucket聚合"><span>1）Bucket聚合</span></a></h4>
<p>例如我们要统计所有商品中共有哪些商品分类，其实就是以分类（category）字段对数据分组。category值一样的放在同一组，属于<code v-pre>Bucket</code>聚合中的<code v-pre>Term</code>聚合。</p>
<p>基本语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;size&quot;: 0, 
  &quot;aggs&quot;: {
    &quot;category_agg&quot;: {
      &quot;terms&quot;: {
        &quot;field&quot;: &quot;category&quot;,
        &quot;size&quot;: 20
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>语法说明：</p>
<ul>
<li><code v-pre>size</code>：设置<code v-pre>size</code>为0，就是每页查0条，则结果中就不包含文档，只包含聚合</li>
<li><code v-pre>aggs</code>：定义聚合
<ul>
<li><code v-pre>category_agg</code>：聚合名称，自定义，但不能重复
<ul>
<li><code v-pre>terms</code>：聚合的类型，按分类聚合，所以用<code v-pre>term</code>
<ul>
<li><code v-pre>field</code>：参与聚合的字段名称</li>
<li><code v-pre>size</code>：希望返回的聚合结果的最大数量</li>
</ul>
</li>
</ul>
</li>
</ul>
</li>
</ul>
<h4 id="_2-带条件聚合" tabindex="-1"><a class="header-anchor" href="#_2-带条件聚合"><span>2）带条件聚合</span></a></h4>
<p>语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;query&quot;: {
    &quot;bool&quot;: {
      &quot;filter&quot;: [
        {
          &quot;term&quot;: {
            &quot;category&quot;: &quot;手机&quot;
          }
        },
        {
          &quot;range&quot;: {
            &quot;price&quot;: {
              &quot;gte&quot;: 300000
            }
          }
        }
      ]
    }
  }, 
  &quot;size&quot;: 0, 
  &quot;aggs&quot;: {
    &quot;brand_agg&quot;: {
      &quot;terms&quot;: {
        &quot;field&quot;: &quot;brand&quot;,
        &quot;size&quot;: 20
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_3-metric聚合" tabindex="-1"><a class="header-anchor" href="#_3-metric聚合"><span>3）Metric聚合</span></a></h4>
<p>现在我们需要对桶内的商品做运算，获取每个品牌价格的最小值、最大值、平均值。这就要用到<code v-pre>Metric</code>聚合了，例如<code v-pre>stat</code>聚合，就可以同时获取<code v-pre>min</code>、<code v-pre>max</code>、<code v-pre>avg</code>等结果。</p>
<p>语法如下：</p>
<div class="language-JSON line-numbers-mode" data-ext="JSON" data-title="JSON"><pre v-pre class="language-JSON"><code>GET /items/_search
{
  &quot;query&quot;: {
    &quot;bool&quot;: {
      &quot;filter&quot;: [
        {
          &quot;term&quot;: {
            &quot;category&quot;: &quot;手机&quot;
          }
        }
      ]
    }
  }, 
  &quot;size&quot;: 0, 
  &quot;aggs&quot;: {
    &quot;brand_agg&quot;: {
      &quot;terms&quot;: {
        &quot;field&quot;: &quot;brand&quot;,
        &quot;size&quot;: 20
      },
      &quot;aggs&quot;: {
        &quot;stats_meric&quot;: {
          &quot;stats&quot;: {
            &quot;field&quot;: &quot;price&quot;
          }
        }
      }
    }
  }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><code v-pre>query</code>部分就不说了，我们重点解读聚合部分语法。</p>
<p>可以看到我们在<code v-pre>brand_agg</code>聚合的内部，我们新加了一个<code v-pre>aggs</code>参数。这个聚合就是<code v-pre>brand_agg</code>的子聚合，会对<code v-pre>brand_agg</code>形成的每个桶中的文档分别统计。</p>
<ul>
<li><code v-pre>stats_meric</code>：聚合名称
<ul>
<li><code v-pre>stats</code>：聚合类型，stats是<code v-pre>metric</code>聚合的一种
<ul>
<li><code v-pre>field</code>：聚合字段，这里选择<code v-pre>price</code>，统计价格</li>
</ul>
</li>
</ul>
</li>
</ul>
<p>由于stats是对brand_agg形成的每个品牌桶内文档分别做统计，因此每个品牌都会统计出自己的价格最小、最大、平均值。</p>
<h3 id="_2、restclient实现聚合" tabindex="-1"><a class="header-anchor" href="#_2、restclient实现聚合"><span>2、RestClient实现聚合</span></a></h3>
<p>可以看到在DSL中，<code v-pre>aggs</code>聚合条件与<code v-pre>query</code>条件是同一级别，都属于查询JSON参数。因此依然是利用<code v-pre>request.source()</code>方法来设置。不过聚合条件的要利用<code v-pre>AggregationBuilders</code>这个工具类来构造。聚合结果与搜索文档同一级别，因此需要单独获取和解析。</p>
<p>完整代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Test
void testAgg() throws IOException {
    // 1.创建Request
    SearchRequest request = new SearchRequest(&quot;items&quot;);
    // 2.准备请求参数
    BoolQueryBuilder bool = QueryBuilders.boolQuery()
            .filter(QueryBuilders.termQuery(&quot;category&quot;, &quot;手机&quot;))
            .filter(QueryBuilders.rangeQuery(&quot;price&quot;).gte(300000));
    request.source().query(bool).size(0);
    // 3.聚合参数
    request.source().aggregation(
            AggregationBuilders.terms(&quot;brand_agg&quot;).field(&quot;brand&quot;).size(5)
    );
    // 4.发送请求
    SearchResponse response = client.search(request, RequestOptions.DEFAULT);
    // 5.解析聚合结果
    Aggregations aggregations = response.getAggregations();
    // 5.1.获取品牌聚合
    Terms brandTerms = aggregations.get(&quot;brand_agg&quot;);
    // 5.2.获取聚合中的桶
    List&lt;? extends Terms.Bucket&gt; buckets = brandTerms.getBuckets();
    // 5.3.遍历桶内数据
    for (Terms.Bucket bucket : buckets) {
        // 5.4.获取桶内key
        String brand = bucket.getKeyAsString();
        System.out.print(&quot;brand = &quot; + brand);
        long count = bucket.getDocCount();
        System.out.println(&quot;; count = &quot; + count);
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


