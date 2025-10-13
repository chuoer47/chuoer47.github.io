<template><div><!--more--->
<h1 id="短链接系统" tabindex="-1"><a class="header-anchor" href="#短链接系统"><span>短链接系统</span></a></h1>
<p>用户可以将长 URL 转换为短链接，并能够根据短链接快速跳转到原始 URL,<a href="">仓库地址</a></p>
<h2 id="技术栈" tabindex="-1"><a class="header-anchor" href="#技术栈"><span>技术栈</span></a></h2>
<p>Go, Gin, Redis, MySQL, TDDL, 布隆过滤器</p>
<h2 id="项目亮点" tabindex="-1"><a class="header-anchor" href="#项目亮点"><span>项目亮点</span></a></h2>
<ul>
<li>使用TDDL序列实现分布式唯一 ID 生成器,能在满足高并发的同时保证ID的唯一性</li>
<li>使用 Redis 缓存短链接映射数据，减少数据库查询次数，提升系统性能</li>
<li>引入布隆过滤器来防止缓存穿透，减少不必要的数据库访问</li>
<li>使用令牌桶算法限流，对短链接的生成与访问进行限流,防止恶意刷短链接，保证服务的稳定性</li>
</ul>
<h2 id="时序流程" tabindex="-1"><a class="header-anchor" href="#时序流程"><span>时序流程</span></a></h2>
<p>短链接服务的写数据时序流程如下：</p>
<ol>
<li>用户发起创建短链接请求，服务端接收到请求，将会生成一个唯一的短链接，并尝试将短链接-长链接映射关系写入数据库中；</li>
<li>数据存储端需要保证短链接-长链接映射关系的一致性，即使多次为同一个长链接生成短链接，也能保证生成的短链接是唯一的，因此可以在数据库中为 original URL 设置唯一索引；</li>
<li>当插入的长链接已经存在时，可以直接返回已经存在的短链接，无需再次生成短链接；</li>
<li>当插入的长链接不存在时，需要生成一个唯一的短链接，可以使用分布式 ID 生成器生成唯一的短链接 ID，然后将短链接 ID 转换为 Base62 编码，即可生成短链接；</li>
<li>长链接写入数据库成功后，服务端将短链接-长链接映射关系写入分布式缓存与本地缓存中，以提高访问性能；</li>
</ol>
<p>短链接服务的读数据时序流程如下：</p>
<ol>
<li>用户访问短链接时，服务端接收到请求，将会有限从本地缓存中获取短链接-长链接映射关系，如果本地缓存中不存在，则从分布式缓存中获取，如果分布式缓存中不存在，则从数据库中获取；</li>
<li>如果本地缓存不存在，分布式缓存中存在，则将接映射关系写入本地缓存中，以提高访问性能；如果缓存中不存在，数据库中存在，则将映射关系写入缓存中；</li>
<li>如果数据库中也不存在，则返回 404 错误，表示短链接不存在，同时可以设置黑名单，对恶意访问进行限制；</li>
<li>如果获取短链接成功，通过 302 临时重定向的方式，将用户重定向到原始的长链接；</li>
<li>访问短链接成功后，可以统计短链接的访问次数，以便后续分析短链接的访问情况；</li>
</ol>
<h2 id="模块设计" tabindex="-1"><a class="header-anchor" href="#模块设计"><span>模块设计</span></a></h2>
<p>短链接服务涉及 分布书 ID 生成器、数据库存储、缓存系统、访问限流等模块，下面将会对这些模块进行详细设计。</p>
<h4 id="_1、分布式-id-生成器" tabindex="-1"><a class="header-anchor" href="#_1、分布式-id-生成器"><span>1、分布式 ID 生成器</span></a></h4>
<p>短链接发号器需要保证生成的短链接是唯一的，可以使用分布式 ID 生成器，如 Twitter 的 Snowflake 算法，或者使用数据库自增 ID 生成器等等，下面将描述不同方案的优缺点：</p>
<h5 id="_1-数据库自增-id" tabindex="-1"><a class="header-anchor" href="#_1-数据库自增-id"><span>1)数据库自增 ID</span></a></h5>
<p>数据库的主键是唯一且自增的，可以保证生成的 ID 是唯一的。将数据库自增 ID 作为短链接 ID，然后将 UID 转换为 Base58 编码，即可生成短链接。</p>
<p>优点：简单易用，生成的 ID 是唯一的； 缺点：依赖于数据库，数据库的性能将成为瓶颈，不适合高并发场景，如果采用数据库集群，需要避免 ID 重复；并且数据库自增 ID 是有序的，可能会暴露业务规模；</p>
<h5 id="_2-redis-自增序列" tabindex="-1"><a class="header-anchor" href="#_2-redis-自增序列"><span>2)Redis 自增序列</span></a></h5>
<p>Redis 的自增序列可以使用 INCR 命令，每次调用 INCR 命令，Redis 会将自增序列加 1，并返回自增后的值。因此可以将 Redis 的自增序列作为短链接 ID，然后将 UID 转换为 Base58 编码，即可生成短链接。</p>
<p>优点：高性能，生成的 ID 是唯一的； 缺点：Redis 是基于内存的，如果 Redis 宕机，可能会导致 ID 重复，需要保证 Redis 的高可用；ID 自增是有序的，可能会暴露业务规模；</p>
<h5 id="_3-uuid" tabindex="-1"><a class="header-anchor" href="#_3-uuid"><span>3)UUID</span></a></h5>
<p>UUID 是由一组 16 个字节（128 位）组成的标识符，可以用于唯一标识信息。UUID 的生成方式有多种，其中最为常用的是基于算法的 UUID 生成方式和基于硬件的 UUID 生成方式。 基于时间戳的 UUID 生成方式，可以保证生成的 UUID 是唯一的，并且是有序的，但是如果多台机器的时钟存在差异，或时钟回拨或闰秒，可能会导致 ID 重复。基于硬件的 UUID 生成方式，可以保证生成的 UUID 是唯一的，且随机性更强。但是 UUID 是 128 位的，转换为 Base58 编码后，短链接长度过长，不适合短链接服务；且 UUID 是无序的，插入数据时可能会导致数据库的性能问题；</p>
<p>优点：生成的 ID 是唯一的，不依赖于数据库； 缺点：UUID 是 128 位的，转换为 Base58 编码后，短链接长度过长，不适合短链接服务；且 UUID 是无序的，插入数据时可能会导致数据库的性能问题；</p>
<h5 id="_2-snowflake-算法" tabindex="-1"><a class="header-anchor" href="#_2-snowflake-算法"><span>2)Snowflake 算法</span></a></h5>
<p>雪花算法（Snowflake）是 Twitter 开源的分布式 ID 生成算法，可以生成 64 位的唯一 ID，结构如下：</p>
<ul>
<li>1 位符号位，始终为 0；</li>
<li>41 位时间戳，精确到毫秒级，可以使用 69 年；</li>
<li>10 位机器 ID，可以部署 1024 台机器；</li>
<li>12 位序列号，每毫秒可以生成 4096 个 ID。</li>
</ul>
<p>Snowflake 算法生成的 ID 是有序的，可以保证 ID 的唯一性，但是需要依赖于时钟，时钟回拨会导致 ID 重复，需要保证时钟的稳定性。同时，Snowflake 算法存在较大的序列号浪费问题，因为每毫秒只能生成 4096 个 ID，即使不使用完，也会浪费掉。</p>
<p>优点：高性能，高可用，生成的 ID 是唯一的； 缺点：需要依赖于时钟，时钟回拨或闰秒调整会导致 ID 重复，需要保证时钟的稳定性；存在较大的序列号浪费。</p>
<p>目前也出现了一些基于雪花算法的改进版本，其中时间戳不依赖于系统时钟，而是使用逻辑时钟，服务启动后，每次生成 ID 时，都会从逻辑时钟中获取时间戳，这样可以避免时钟回拨导致 ID 重复的问题，但仍然无法避免较大的序列号浪费问题。</p>
<h5 id="_4-tddl-序列" tabindex="-1"><a class="header-anchor" href="#_4-tddl-序列"><span>4)TDDL 序列</span></a></h5>
<p>TDDL 序列是指在数据库中创建一个序列表，用于存储序列的当前值，然后通过数据库的 CAS 原子操作来获取下一个序列区间，然后在内存中递增序列值，当序列值用尽时，再次获取下一个序列区间。</p>
<ul>
<li>优点：生成的 ID 是唯一的，避免了数据库自增 ID 的性能瓶颈；同时减小了序列号浪费；</li>
<li>缺点：具有一定的维护成本；</li>
</ul>
<h5 id="_5-表结构" tabindex="-1"><a class="header-anchor" href="#_5-表结构"><span>5)表结构</span></a></h5>
<p>综上所述，我们可以选择 TDDL 序列算法作为短链接发号器，保证生成的短链接是唯一的，同时 TDDL 序列算法也便于根据 short ID 进行分库分表，适合高并发场景。</p>
<p>可以选择关系型数据库、NoSQL 数据库等维护 TDDL 的序列表，Tiny-URL 首要支持 MySQL 等关系型数据库，未来考虑支持 MongoDB 等 NoSQL 数据库。</p>
<p>MySQL 数据库表结构可参考</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">create</span> <span class="token keyword">table</span> sequence
<span class="token punctuation">(</span>
    id            <span class="token keyword">bigint</span> <span class="token keyword">auto_increment</span><span class="token punctuation">,</span>
    name          <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">500</span><span class="token punctuation">)</span> <span class="token operator">not</span> <span class="token boolean">null</span><span class="token punctuation">,</span>
    current_value <span class="token keyword">bigint</span>       <span class="token operator">not</span> <span class="token boolean">null</span><span class="token punctuation">,</span>
    increment     <span class="token keyword">bigint</span>       <span class="token boolean">null</span><span class="token punctuation">,</span>
    create_time   <span class="token keyword">datetime</span><span class="token punctuation">(</span><span class="token number">3</span><span class="token punctuation">)</span>  <span class="token boolean">null</span><span class="token punctuation">,</span>
    update_time   <span class="token keyword">datetime</span><span class="token punctuation">(</span><span class="token number">3</span><span class="token punctuation">)</span>  <span class="token boolean">null</span><span class="token punctuation">,</span>
    deleted_time  <span class="token keyword">datetime</span><span class="token punctuation">(</span><span class="token number">3</span><span class="token punctuation">)</span>  <span class="token boolean">null</span><span class="token punctuation">,</span>
    <span class="token keyword">constraint</span> sequence_pk
        <span class="token keyword">unique</span> <span class="token punctuation">(</span>id<span class="token punctuation">)</span>
<span class="token punctuation">)</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2、数据库存储" tabindex="-1"><a class="header-anchor" href="#_2、数据库存储"><span>2、数据库存储</span></a></h4>
<p>短链接服务需要存储短链接-长链接映射关系，可以使用关系型数据库、NoSQL 数据库等存储短链接-长链接映射关系，下面将介绍使用 MySQL 数据库存储短链接-长链接映射关系的设计。</p>
<p>tiny_urls 表的几个关键字段：</p>
<ul>
<li>id：数据库自增 ID，作为主键，保证新插入的 record 是顺序写入的；</li>
<li>long_url：原始的长链接，作为唯一索引，保证长链接是唯一的；</li>
<li>short：短链接 ID，作为唯一索引，保证短链接是唯一的；</li>
<li>delete_time：删除时间，用于标记短链接是否删除；</li>
</ul>
<p>对应表结构如下：</p>
<p>在表结构中，我们对长链接与短链接分别建立了唯一索引，保证了长链接与短链接的唯一性。但我们并没有将 short ID 作为主键，因为 short ID 具有一定的离散性，将其作为主键会影响写入性能。</p>
<h4 id="_3、分布式缓存" tabindex="-1"><a class="header-anchor" href="#_3、分布式缓存"><span>3、分布式缓存</span></a></h4>
<p>短链接服务具有明显的热点数据特征，因此需要使用缓存来提高访问性能，我们可以使用 Redis、Memcached 等缓存服务器，将热点数据缓存到缓存服务器中，以提高访问性能。</p>
<p>分布式缓存需要考虑缓存的一致性、缓存的命中率、缓存的淘汰策略、缓存的预热、缓存的雪崩、缓存的击穿等问题。</p>
<ul>
<li>缓存命中率：缓存命中率是衡量缓存性能的重要指标，可以通过缓存命中率来评估缓存的有效性，缓存命中率越高，说明缓存的有效性越好，缓存的性能越高。</li>
<li>缓存淘汰策略：缓存淘汰策略是指当缓存空间不足时，如何选择淘汰哪些缓存数据，常见的缓存淘汰策略有：FIFO（先进先出）、LRU（最近最少使用）、LFU（最少使用频率）等。</li>
<li>缓存预热：缓存预热是指在系统启动时，将热点数据加载到缓存中，以提高系统的访问性能，缓存预热可以通过定时任务、异步加载等方式来实现。</li>
<li>缓存雪崩：缓存雪崩是指缓存中的大量数据同时失效，导致大量请求直接访问数据库，从而导致数据库的性能问题，为了避免缓存雪崩，可以采用多级缓存、缓存预热、缓存失效时间随机等方式来避免。</li>
<li>缓存击穿：缓存击穿是指缓存中的某个数据失效，导致大量请求直接访问数据库，从而导致数据库的性能问题，为了避免缓存击穿，可以采用分布式锁、热点数据永不过期等方式来避免。</li>
</ul>
<p>Tiny URL 使用 Redis 作为缓存服务器，将热点数据缓存到 Redis 中，以提高访问性能。同时将淘汰策略设置为<code v-pre>volatile-lfu</code>，根据短链接的访问频率来淘汰缓存数据，以提高缓存的命中率。 缓存更新与访问流程如下：</p>
<ol>
<li>用户发起创建短链接请求，服务端在数据库中成功插入短链接-长链接映射关系；</li>
<li>服务端将短链接-长链接映射关系写入 Redis 缓存中，假设配置的过期时间为 t，服务端会生成 [t,2t] 时间内的随机值，作为缓存的过期时间；</li>
<li>用户访问短链接时，服务端会先从 Redis 缓存中获取短链接-长链接映射关系，如果缓存中不存在，则从数据库中获取，并写入 Redis 缓存中，同时更新缓存的过期时间；</li>
</ol>
<h4 id="_4、访问限流" tabindex="-1"><a class="header-anchor" href="#_4、访问限流"><span>4、访问限流</span></a></h4>
<p>短链接服务需要对短链接的生成与访问进行限流，防止恶意刷短链接，保证服务的稳定性。可以使用令牌桶算法、漏桶算法等限流算法，对短链接的生成与访问进行限流。</p>
<p>令牌桶算法是一种固定容量的令牌桶，按照固定速率往桶中放入令牌，如果桶中令牌已满，则不再放入令牌，当请求到来时，如果桶中有令牌，则允许通过，否则拒绝请求。令牌桶算法能够对单位时间内的请求进行限流，保证服务的稳定性，同时又可以平滑处理突发流量，保证服务的稳定性。</p>
<p>Tiny-URL 采用了单机令牌桶实现，对短链接的生成与访问进行全局限流。</p>
<h4 id="小结" tabindex="-1"><a class="header-anchor" href="#小结"><span>小结</span></a></h4>
<p>本章节介绍了 Tiny URL 主要模块的设计思路与技术选型，包括分布式 ID 生成器、数据库存储、缓存系统、访问限流等模块，以及实现这些模块的接口定义与实现。在编码过程中，我们要尽可能将模块的能力抽象出来，定义统一的接口，然后提供多种具体的实现，以便在不同的场景下选择更合适的实现。</p>
</div></template>


