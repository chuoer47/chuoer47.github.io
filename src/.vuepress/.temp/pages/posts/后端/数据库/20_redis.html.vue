<template><div><!--more--->
<h1 id="redis" tabindex="-1"><a class="header-anchor" href="#redis"><span>Redis</span></a></h1>
<h2 id="一、redis基础" tabindex="-1"><a class="header-anchor" href="#一、redis基础"><span>一、Redis基础</span></a></h2>
<p><strong>Redis五大数据类型</strong>：String(字符串)、Hash(哈希)、List(列表)、Set(集合) 和 zset(sorted set:有序集合)</p>
<h3 id="_1、字符串操作指令" tabindex="-1"><a class="header-anchor" href="#_1、字符串操作指令"><span>1、字符串操作指令</span></a></h3>
<div class="hint-container tip">
<p class="hint-container-title">提示</p>
<ul>
<li>
<p>String是redis最基本的操作，一个key对应一个value str1 := &quot;hello&quot;</p>
</li>
<li>
<p>String类型是二进制安全的。除普通的字符串外，也可以存放图片等数据</p>
</li>
<li>
<p>redis中字符串value最大是512M</p>
</li>
</ul>
</div>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>SET key value    	设置指定key的值
GET key				获取指定key的值
SETEX key seconds value		设置指定key的值，并将key的过期时间设为seconds秒
SETNX key value				只有在key不存在时设置key 的值
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、哈希操作命令" tabindex="-1"><a class="header-anchor" href="#_2、哈希操作命令"><span>2、哈希操作命令</span></a></h3>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>HSET key field value  			将哈希表key 中的字段field 的值设为value
HGET key field					获取存储在哈希表中指定字段的值
HDEL key field					删除存储在哈希表中的指定字段
HKEYS key						获取哈希表中所有字段
HVALS key						获取哈希表中所有值
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>使用<code v-pre>hmset</code>和<code v-pre>hmget</code>可以一次性设置多个 field的值和返回多个field的值</p>
<h3 id="_3、列表操作命令" tabindex="-1"><a class="header-anchor" href="#_3、列表操作命令"><span>3、列表操作命令</span></a></h3>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>LPUSH key value1 [value2]		将一个或多个值插入到列表头部
LRANGE key start stop			获取列表指定范围内的元素
RPOP key						移除并获取列表最后一个元素
LLEN key						获取列表长度
//L和R代表左右
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>List 数据，可以从左或者右插入添加 如果值全移除，对应的键也就消失了</p>
<h3 id="_4、集合操作命令" tabindex="-1"><a class="header-anchor" href="#_4、集合操作命令"><span>4、集合操作命令</span></a></h3>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>SADD key member1 [member2]		向集合添加一个或多个成员心
SMEMBERS key					返回集合中的所有成员
SCARD key						获取集合的成员数
SINTER key1 [key2]				返回给定所有集合的交集
SUNION key1[key2]				返回所有给定集合的并集
SREM key member1 [member2]		删除集合中一个或多个成员
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_5、有序集合操作命令" tabindex="-1"><a class="header-anchor" href="#_5、有序集合操作命令"><span>5、有序集合操作命令</span></a></h3>
<p>Redis有序集合是string类型元素的集合，且不允许有重复成员。每个元素都会关联一个double类型的分数。</p>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>ZADD key score1 member1 [score2 member2]	向有序集合添加一个或多个成员
ZRANGE key start stop [WITHSCORES]			通过索引区间返回有序集合中指定区间内的成员
ZINCRBY key increment member				有序集合中对指定成员的分数加上增量increment
ZREM key member [member ...]				移除有序集合中的一个或多个成员
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_6、通用命令" tabindex="-1"><a class="header-anchor" href="#_6、通用命令"><span>6、通用命令</span></a></h3>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>KEYS pattern		查找所有符合给定模式(pattern)的 key
EXISTS key			检查给定key是否存在
TYPE key			返回key所储存的值的类型
DEL key				该命令用于在key存在是删除 key
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="二、java操作redis-spring-data-redis" tabindex="-1"><a class="header-anchor" href="#二、java操作redis-spring-data-redis"><span>二、Java操作Redis（Spring Data Redis）</span></a></h2>
<div class="hint-container info">
<p class="hint-container-title">Redis的Java客户端：</p>
<ul>
<li>
<p>Jeids</p>
</li>
<li>
<p>Lettuce</p>
</li>
<li>
<p>Spring Data Redis</p>
</li>
</ul>
</div>
<p><code v-pre>Spring Data Redis</code>是 Spring的一部分，对 Redis底层开发包进行了高度封装。在Spring项目中，可以使用spring Data Redis来简化操作。</p>
<h3 id="_1、maven坐标" tabindex="-1"><a class="header-anchor" href="#_1、maven坐标"><span>1、maven坐标</span></a></h3>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code>		<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-data-redis<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、配置redis数据源" tabindex="-1"><a class="header-anchor" href="#_2、配置redis数据源"><span>2、配置Redis数据源</span></a></h3>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">redis</span><span class="token punctuation">:</span>
    <span class="token key atrule">host</span><span class="token punctuation">:</span> localhost
    <span class="token key atrule">port</span><span class="token punctuation">:</span> <span class="token number">6379</span>
    <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">123456</span>
    <span class="token key atrule">database</span><span class="token punctuation">:</span> <span class="token number">0</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、编写配置类-创建redistemplate对象" tabindex="-1"><a class="header-anchor" href="#_3、编写配置类-创建redistemplate对象"><span>3、编写配置类，创建RedisTemplate对象</span></a></h3>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token annotation punctuation">@Slf4j</span>
<span class="token annotation punctuation">@Configuration</span>
<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">RedisConfiguration</span> <span class="token punctuation">{</span>

    <span class="token annotation punctuation">@Bean</span>
    <span class="token keyword">public</span> <span class="token class-name">RedisTemplate</span> <span class="token function">redisTemplate</span><span class="token punctuation">(</span><span class="token class-name">RedisConnectionFactory</span> redisConnectionFactory<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        log<span class="token punctuation">.</span><span class="token function">info</span><span class="token punctuation">(</span><span class="token string">"开始创建redisTemplate"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token class-name">RedisTemplate</span> redisTemplate <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">RedisTemplate</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token comment">//设置Redis连接工厂对象</span>
        redisTemplate<span class="token punctuation">.</span><span class="token function">setConnectionFactory</span><span class="token punctuation">(</span>redisConnectionFactory<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token comment">//设置redis key的序列化器</span>
        redisTemplate<span class="token punctuation">.</span><span class="token function">setKeySerializer</span><span class="token punctuation">(</span><span class="token keyword">new</span> <span class="token class-name">StringRedisSerializer</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">return</span> redisTemplate<span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、使用redistemplate对象" tabindex="-1"><a class="header-anchor" href="#_4、使用redistemplate对象"><span>4、使用redisTemplate对象</span></a></h3>
<p><strong>String:</strong></p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code> 	<span class="token annotation punctuation">@Test</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testString</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token class-name">ValueOperations</span> valueOperations <span class="token operator">=</span> redisTemplate<span class="token punctuation">.</span><span class="token function">opsForValue</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token comment">//set</span>
        valueOperations<span class="token punctuation">.</span><span class="token function">set</span><span class="token punctuation">(</span><span class="token string">"city"</span><span class="token punctuation">,</span><span class="token string">"Changsha"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//get</span>
        <span class="token class-name">String</span> city <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token class-name">String</span><span class="token punctuation">)</span> valueOperations<span class="token punctuation">.</span><span class="token function">get</span><span class="token punctuation">(</span><span class="token string">"city"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span>city<span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//setex</span>
        valueOperations<span class="token punctuation">.</span><span class="token function">set</span><span class="token punctuation">(</span><span class="token string">"code"</span><span class="token punctuation">,</span><span class="token string">"1234"</span><span class="token punctuation">,</span> <span class="token number">3</span><span class="token punctuation">,</span> <span class="token class-name">TimeUnit</span><span class="token punctuation">.</span><span class="token constant">MINUTES</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//setnx</span>
        valueOperations<span class="token punctuation">.</span><span class="token function">setIfAbsent</span><span class="token punctuation">(</span><span class="token string">"name"</span><span class="token punctuation">,</span><span class="token string">"ruyi"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        valueOperations<span class="token punctuation">.</span><span class="token function">setIfAbsent</span><span class="token punctuation">(</span><span class="token string">"name"</span><span class="token punctuation">,</span><span class="token string">"ruyi_wei"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>Hash:</strong></p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code>   <span class="token annotation punctuation">@Test</span>
    <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">testHash</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
        <span class="token class-name">HashOperations</span> hashOperations <span class="token operator">=</span> redisTemplate<span class="token punctuation">.</span><span class="token function">opsForHash</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//hset</span>
        hashOperations<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token string">"Tom"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        hashOperations<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">,</span> <span class="token string">"age"</span><span class="token punctuation">,</span> <span class="token string">"10"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        hashOperations<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">,</span> <span class="token string">"age2"</span><span class="token punctuation">,</span> <span class="token string">"10"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//hget</span>
        <span class="token class-name">String</span> name <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token class-name">String</span><span class="token punctuation">)</span> hashOperations<span class="token punctuation">.</span><span class="token function">get</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span>name<span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//hkeys</span>
        <span class="token class-name">Set</span> keys <span class="token operator">=</span> hashOperations<span class="token punctuation">.</span><span class="token function">keys</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span>keys<span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//hvals</span>
        <span class="token class-name">List</span> values <span class="token operator">=</span> hashOperations<span class="token punctuation">.</span><span class="token function">values</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span>values<span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">//hdel</span>
        hashOperations<span class="token punctuation">.</span><span class="token function">delete</span><span class="token punctuation">(</span><span class="token string">"100"</span><span class="token punctuation">,</span> <span class="token string">"age2"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        
    <span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>......其余类型以此类推</strong></p>
<h2 id="三、golang连接redis" tabindex="-1"><a class="header-anchor" href="#三、golang连接redis"><span>三、GoLang连接redis</span></a></h2>
<h3 id="_1、安装第三方开源redis库" tabindex="-1"><a class="header-anchor" href="#_1、安装第三方开源redis库"><span>1、安装第三方开源redis库</span></a></h3>
<ol>
<li>使用第三方开源的redis库：github.com/grayburd/redigo/redis</li>
<li>在使用redis前，先安装第三方redis库，在GOPATH路径下执行安装指令</li>
</ol>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code>go get github.com/grayburd/redigo/redis
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_2、set-get-接口" tabindex="-1"><a class="header-anchor" href="#_2、set-get-接口"><span>2、Set/Get 接口</span></a></h3>
<p>通过Golang添加和获取key-value</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">package</span> main

<span class="token keyword">import</span> <span class="token punctuation">(</span>
	<span class="token string">"fmt"</span>
	<span class="token string">"github.com/garyburd/redigo/redis"</span>
<span class="token punctuation">)</span>
<span class="token keyword">func</span> <span class="token function">main</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">//连接到redis</span>
	c<span class="token punctuation">,</span> err <span class="token operator">:=</span> redis<span class="token punctuation">.</span><span class="token function">Dial</span><span class="token punctuation">(</span><span class="token string">"tcp"</span><span class="token punctuation">,</span> <span class="token string">"localhost:6379"</span><span class="token punctuation">)</span>
    <span class="token keyword">if</span> err <span class="token operator">!=</span> <span class="token boolean">nil</span> <span class="token punctuation">{</span>
    	fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span><span class="token string">"conn redis failed,err="</span><span class="token punctuation">,</span> err<span class="token punctuation">)</span>
    	<span class="token keyword">return</span>
    <span class="token punctuation">}</span>
    <span class="token keyword">defer</span> c<span class="token punctuation">.</span><span class="token function">Close</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
    <span class="token comment">//向redis写入数据</span>
    <span class="token boolean">_</span><span class="token punctuation">,</span> err <span class="token operator">=</span> c<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"Set"</span><span class="token punctuation">,</span> <span class="token string">"key1"</span><span class="token punctuation">,</span> <span class="token number">998</span><span class="token punctuation">)</span>
    <span class="token keyword">if</span> err <span class="token operator">!=</span> <span class="token boolean">nil</span> <span class="token punctuation">{</span>
    	fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span>err<span class="token punctuation">)</span>
    	<span class="token keyword">return</span>
    <span class="token punctuation">}</span>
    <span class="token comment">//从redis中读取数据</span>
    <span class="token comment">// r, err := c.Do("Get", "key1")</span>
    <span class="token comment">//因为返回的 r是 interface{}</span>
    <span class="token comment">//key1对应的是int,所以需要转换</span>
    r<span class="token punctuation">,</span> err <span class="token operator">:=</span> redis<span class="token punctuation">.</span><span class="token function">Int</span><span class="token punctuation">(</span>c<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"Get"</span><span class="token punctuation">,</span> <span class="token string">"key1"</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
    <span class="token keyword">if</span> err <span class="token operator">!=</span> <span class="token boolean">nil</span> <span class="token punctuation">{</span>
    	fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span><span class="token string">"get key1 failed, err="</span><span class="token punctuation">,</span> err<span class="token punctuation">)</span>
    	<span class="token keyword">return</span>
    <span class="token punctuation">}</span>
    fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span>r<span class="token punctuation">)</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>批量Set/Get数据：</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token boolean">_</span><span class="token punctuation">,</span> err <span class="token operator">:=</span> c<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"MSet"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token string">"harden"</span><span class="token punctuation">,</span> <span class="token string">"age"</span><span class="token punctuation">,</span> <span class="token string">"77"</span><span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code>r<span class="token punctuation">,</span> err <span class="token operator">:=</span> redis<span class="token punctuation">.</span><span class="token function">Strings</span><span class="token punctuation">(</span>c<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"MGet"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token string">"age"</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
<span class="token comment">//strings</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>设置有效时间</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token boolean">_</span><span class="token punctuation">,</span> err <span class="token operator">:=</span> c<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"expire"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token number">10</span><span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_3、redis连接池" tabindex="-1"><a class="header-anchor" href="#_3、redis连接池"><span>3、redis连接池</span></a></h3>
<div class="hint-container info">
<p class="hint-container-title">redis链接池，流程如下</p>
<ol>
<li>事先初始化一定数量的链接，放入到链接池</li>
<li>当go需要操作redis时，直接从redis连接池取出链接即可</li>
<li>这样可以节省临时获取redis链接的时间，从而提高效率</li>
</ol>
</div>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">var</span> pool <span class="token operator">*</span>redis<span class="token punctuation">.</span>Pool
pool <span class="token operator">=</span> <span class="token operator">&amp;</span>redis<span class="token punctuation">.</span>Pool<span class="token punctuation">{</span>
	MaxIdle <span class="token punctuation">:</span> <span class="token number">8</span><span class="token punctuation">,</span> <span class="token comment">//最大空闲链接数</span>
	MaxActive <span class="token punctuation">:</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token comment">//表示和数据库的最大链接数，0表示没有限制</span>
	IdleTimeout <span class="token punctuation">:</span> <span class="token number">100</span><span class="token punctuation">,</span> <span class="token comment">//最大空闲时间</span>
	Dial <span class="token punctuation">:</span> <span class="token keyword">func</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">(</span>redis<span class="token punctuation">.</span>Conn<span class="token punctuation">,</span> <span class="token builtin">error</span><span class="token punctuation">)</span><span class="token punctuation">{</span> <span class="token comment">//初始化链接的代码</span>
		<span class="token keyword">return</span> redis<span class="token punctuation">.</span><span class="token function">Dial</span><span class="token punctuation">(</span><span class="token string">"tcp"</span><span class="token punctuation">,</span> <span class="token string">"localhost:6379"</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span><span class="token punctuation">,</span>
<span class="token punctuation">}</span>

c <span class="token operator">:=</span> pool<span class="token punctuation">.</span><span class="token function">Get</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token comment">//从连接池中取出一个连接</span>
pool<span class="token punctuation">.</span><span class="token function">Close</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token comment">//关闭连接池，一旦关闭就不能从连接池再取出连接了</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>示例：</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">package</span> main

<span class="token keyword">import</span> <span class="token punctuation">(</span>
	<span class="token string">"fmt"</span>
	<span class="token string">"github.com/garyburd/redigo/redis"</span>
<span class="token punctuation">)</span>

<span class="token comment">//定义一个全局的pool</span>
<span class="token keyword">var</span> pool <span class="token operator">*</span>redis<span class="token punctuation">.</span>Pool

<span class="token comment">//当启动程序时，就初始化连接池</span>
<span class="token keyword">func</span> <span class="token function">init</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	pool <span class="token operator">=</span> <span class="token operator">&amp;</span>redis<span class="token punctuation">.</span>Pool<span class="token punctuation">{</span>
	MaxIdle <span class="token punctuation">:</span> <span class="token number">8</span><span class="token punctuation">,</span> <span class="token comment">//最大空闲链接数</span>
	MaxActive <span class="token punctuation">:</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token comment">//表示和数据库的最大链接数，0表示没有限制</span>
	IdleTimeout <span class="token punctuation">:</span> <span class="token number">100</span><span class="token punctuation">,</span> <span class="token comment">//最大空闲时间</span>
	Dial <span class="token punctuation">:</span> <span class="token keyword">func</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">(</span>redis<span class="token punctuation">.</span>Conn<span class="token punctuation">,</span> <span class="token builtin">error</span><span class="token punctuation">)</span><span class="token punctuation">{</span> <span class="token comment">//初始化链接的代码</span>
			<span class="token keyword">return</span> redis<span class="token punctuation">.</span><span class="token function">Dial</span><span class="token punctuation">(</span><span class="token string">"tcp"</span><span class="token punctuation">,</span> <span class="token string">"localhost:6379"</span><span class="token punctuation">)</span>
		<span class="token punctuation">}</span><span class="token punctuation">,</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token function">main</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">//先从pool 取出一个链接</span>
	conn <span class="token operator">:=</span> pool<span class="token punctuation">.</span><span class="token function">Get</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
	<span class="token keyword">defer</span> conn<span class="token punctuation">.</span><span class="token function">Close</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
    
	<span class="token boolean">_</span><span class="token punctuation">,</span> err <span class="token operator">:=</span> conn<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"Set"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">,</span> <span class="token string">"tom~"</span><span class="token punctuation">)</span>
	<span class="token keyword">if</span> err <span class="token operator">!=</span> <span class="token boolean">nil</span> <span class="token punctuation">{</span>
		fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span><span class="token string">"conn.Do err="</span><span class="token punctuation">,</span> err<span class="token punctuation">)</span>
		<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
    
	<span class="token comment">//取出</span>
	r<span class="token punctuation">,</span> err <span class="token operator">:=</span> redis<span class="token punctuation">.</span><span class="token function">String</span><span class="token punctuation">(</span>conn<span class="token punctuation">.</span><span class="token function">Do</span><span class="token punctuation">(</span><span class="token string">"Get"</span><span class="token punctuation">,</span> <span class="token string">"name"</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
	<span class="token keyword">if</span> err <span class="token operator">!=</span> <span class="token boolean">nil</span> <span class="token punctuation">{</span>
		fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span>err<span class="token punctuation">)</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>
	fmt<span class="token punctuation">.</span><span class="token function">Println</span><span class="token punctuation">(</span><span class="token string">"r="</span><span class="token punctuation">,</span>r<span class="token punctuation">)</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


