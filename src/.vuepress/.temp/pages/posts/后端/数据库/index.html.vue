<template><div><!--more--->
<h1 id="sql语句" tabindex="-1"><a class="header-anchor" href="#sql语句"><span>SQL语句</span></a></h1>
<h2 id="_1、数据库操作" tabindex="-1"><a class="header-anchor" href="#_1、数据库操作"><span>1、数据库操作</span></a></h2>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment"># 查询所有数据库</span>
<span class="token keyword">show</span> <span class="token keyword">databases</span><span class="token punctuation">;</span>

<span class="token comment"># 创建数据库</span>
<span class="token keyword">create</span> <span class="token keyword">database</span> db02<span class="token punctuation">;</span>

<span class="token comment"># 删除数据库</span>
<span class="token keyword">drop</span> <span class="token keyword">database</span> db02<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_2、表操作" tabindex="-1"><a class="header-anchor" href="#_2、表操作"><span>2、表操作</span></a></h2>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment"># DDL：表结构</span>

<span class="token comment"># 创建</span>
<span class="token keyword">create</span> <span class="token keyword">table</span> tb_user
<span class="token punctuation">(</span>
    id <span class="token keyword">int</span> <span class="token keyword">primary</span> <span class="token keyword">key</span> <span class="token keyword">auto_increment</span> <span class="token keyword">comment</span> <span class="token string">'ID，唯一标识'</span><span class="token punctuation">,</span>
    username <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">20</span><span class="token punctuation">)</span> <span class="token operator">not</span> <span class="token boolean">null</span> <span class="token keyword">unique</span> <span class="token keyword">comment</span> <span class="token string">'用户名'</span><span class="token punctuation">,</span>
    name <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">10</span><span class="token punctuation">)</span> <span class="token operator">not</span> <span class="token boolean">null</span> <span class="token keyword">comment</span> <span class="token string">'姓名'</span><span class="token punctuation">,</span>
    age <span class="token keyword">int</span> <span class="token keyword">comment</span> <span class="token string">'年龄'</span><span class="token punctuation">,</span>
    gender <span class="token keyword">char</span><span class="token punctuation">(</span><span class="token number">1</span><span class="token punctuation">)</span> <span class="token keyword">default</span> <span class="token string">'男'</span> <span class="token keyword">comment</span> <span class="token string">'性别'</span>

<span class="token punctuation">)</span> <span class="token keyword">comment</span> <span class="token string">'用户表'</span><span class="token punctuation">;</span>

<span class="token comment"># 查看当前数据库下的表</span>
<span class="token keyword">show</span> <span class="token keyword">tables</span><span class="token punctuation">;</span>

<span class="token comment"># 查看指定表结构</span>
<span class="token keyword">desc</span> tb_user<span class="token punctuation">;</span>

<span class="token comment"># 查看数据库建表语句</span>
<span class="token keyword">show</span> <span class="token keyword">create</span> <span class="token keyword">table</span> tb_emp<span class="token punctuation">;</span>



<span class="token comment"># 修改表结构</span>
<span class="token comment"># 添加字段</span>
<span class="token keyword">alter</span> <span class="token keyword">table</span> tb_user <span class="token keyword">add</span> qq <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">11</span><span class="token punctuation">)</span> <span class="token keyword">comment</span> <span class="token string">'QQ'</span><span class="token punctuation">;</span>

<span class="token comment"># 修改字段类型</span>
<span class="token keyword">alter</span> <span class="token keyword">table</span> tb_user <span class="token keyword">modify</span> qq <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">13</span><span class="token punctuation">)</span> <span class="token keyword">comment</span> <span class="token string">'QQ'</span><span class="token punctuation">;</span>

<span class="token comment"># 修改字段名</span>
<span class="token keyword">alter</span> <span class="token keyword">table</span> tb_user change qq qq_num <span class="token keyword">varchar</span><span class="token punctuation">(</span><span class="token number">13</span><span class="token punctuation">)</span> <span class="token keyword">comment</span> <span class="token string">'QQ'</span><span class="token punctuation">;</span>

<span class="token comment">#删除字段</span>
<span class="token keyword">alter</span> <span class="token keyword">table</span> tb_user <span class="token keyword">drop</span> <span class="token keyword">column</span> qq_num<span class="token punctuation">;</span>

<span class="token comment"># 修改表名</span>
<span class="token keyword">rename</span> <span class="token keyword">table</span> tb_user <span class="token keyword">to</span> <span class="token keyword">user</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_3、数据操作" tabindex="-1"><a class="header-anchor" href="#_3、数据操作"><span>3、数据操作</span></a></h2>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment">#DML 数据操作</span>

<span class="token comment">/*
    1、插入语句 insert
*/</span>

<span class="token comment">#     为 tb_emp 表的username name gender插入数据</span>
<span class="token keyword">insert</span> <span class="token keyword">into</span> tb_emp<span class="token punctuation">(</span>username<span class="token punctuation">,</span> name<span class="token punctuation">,</span> gender<span class="token punctuation">,</span> create_time<span class="token punctuation">,</span> update_time<span class="token punctuation">)</span> <span class="token keyword">values</span> <span class="token punctuation">(</span><span class="token string">'wuji'</span><span class="token punctuation">,</span> <span class="token string">'张无忌'</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment">#     为 tb_emp 表的所有字段插入值</span>
<span class="token keyword">insert</span> <span class="token keyword">into</span> tb_emp<span class="token punctuation">(</span>id<span class="token punctuation">,</span> username<span class="token punctuation">,</span> password<span class="token punctuation">,</span> name<span class="token punctuation">,</span> gender<span class="token punctuation">,</span> image<span class="token punctuation">,</span> job<span class="token punctuation">,</span> entrydate<span class="token punctuation">,</span> create_time<span class="token punctuation">,</span> update_time<span class="token punctuation">)</span>
                <span class="token keyword">VALUES</span><span class="token punctuation">(</span><span class="token boolean">null</span><span class="token punctuation">,</span> <span class="token string">'weiruyi'</span><span class="token punctuation">,</span><span class="token string">'123'</span><span class="token punctuation">,</span> <span class="token string">'魏儒艺'</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token string">'1.jpg'</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token string">'2024-05-09'</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token keyword">insert</span> <span class="token keyword">into</span> tb_emp
                <span class="token keyword">VALUES</span><span class="token punctuation">(</span><span class="token boolean">null</span><span class="token punctuation">,</span> <span class="token string">'weiruyi2'</span><span class="token punctuation">,</span><span class="token string">'123'</span><span class="token punctuation">,</span> <span class="token string">'魏儒艺'</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token string">'1.jpg'</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token string">'2024-05-09'</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment">#     批量为tb_user表的username, name, gender添加数据</span>
<span class="token keyword">insert</span> <span class="token keyword">into</span> tb_emp<span class="token punctuation">(</span>username<span class="token punctuation">,</span> name<span class="token punctuation">,</span> gender<span class="token punctuation">,</span> create_time<span class="token punctuation">,</span> update_time<span class="token punctuation">)</span> <span class="token keyword">values</span>
                                                                            <span class="token punctuation">(</span><span class="token string">'yuqi'</span><span class="token punctuation">,</span> <span class="token string">'雨琦'</span><span class="token punctuation">,</span> <span class="token number">2</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
                                                                            <span class="token punctuation">(</span><span class="token string">'77qi'</span><span class="token punctuation">,</span> <span class="token string">'七七'</span><span class="token punctuation">,</span> <span class="token number">2</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>




<span class="token comment">/*
    2、更新数据 update
*/</span>

<span class="token comment">#     将 tb_emp 表的ID为1 的员工姓名更改为‘张三’</span>
<span class="token keyword">update</span> tb_emp <span class="token keyword">set</span> name <span class="token operator">=</span> <span class="token string">'张三'</span><span class="token punctuation">,</span> update_time <span class="token operator">=</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token keyword">where</span> id <span class="token operator">=</span> <span class="token number">1</span><span class="token punctuation">;</span>

<span class="token comment">#     将所有员工入职日期更改为2010-01-01</span>
<span class="token keyword">update</span> tb_emp <span class="token keyword">set</span> entrydate <span class="token operator">=</span> <span class="token string">'2010-01-01'</span><span class="token punctuation">,</span> update_time <span class="token operator">=</span> <span class="token function">now</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>



<span class="token comment">/*
    3、删除操作 delete
*/</span>
<span class="token comment">#     删除tb_emp中id=1的员工</span>
<span class="token keyword">delete</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> id <span class="token operator">=</span> <span class="token number">1</span><span class="token punctuation">;</span>

<span class="token comment">#     删除所有数据</span>
<span class="token keyword">delete</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_4、单表查询" tabindex="-1"><a class="header-anchor" href="#_4、单表查询"><span>4、单表查询</span></a></h2>
<pre><code>select
    字段列表
from
    表名列表         基本查询
where
    条件列表        条件查询
group by
    分组字段列表
having
    分组后条件列表     分组查询
order by
    排序字段列表      排序查询
limit
    分页参数        分页查询
</code></pre>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment">/*
    数据查询语句
    ----------单表查询
*/</span>

<span class="token comment"># ------------------------------------1、基础查询------------------------------------------</span>
<span class="token comment"># 1、基础查询</span>

<span class="token comment"># 查询多个字段</span>
<span class="token keyword">select</span> username<span class="token punctuation">,</span> password<span class="token punctuation">,</span> name <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> id <span class="token operator">&lt;</span> <span class="token number">5</span><span class="token punctuation">;</span>

<span class="token comment"># 查询所有字段</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span> <span class="token comment"># 不推荐   不直观，性能低</span>
<span class="token keyword">select</span> id<span class="token punctuation">,</span> username<span class="token punctuation">,</span> password<span class="token punctuation">,</span> name<span class="token punctuation">,</span> gender<span class="token punctuation">,</span> image<span class="token punctuation">,</span> job<span class="token punctuation">,</span> entrydate<span class="token punctuation">,</span> create_time<span class="token punctuation">,</span> update_time <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span> <span class="token comment"># 推荐</span>

<span class="token comment"># 设置别名</span>
<span class="token keyword">select</span> username 姓名<span class="token punctuation">,</span> password <span class="token keyword">as</span> <span class="token string">'密 码'</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> id <span class="token operator">&lt;</span> <span class="token number">5</span><span class="token punctuation">;</span>

<span class="token comment">#查询已有员工关联了哪几种职位</span>
<span class="token comment"># distinct 去重</span>
<span class="token keyword">select</span> <span class="token keyword">distinct</span>  job <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>




<span class="token comment"># -------------------------------------2、条件查询---------------------------------------------</span>
<span class="token comment"># 2、条件查询</span>

<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'张无忌'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> id <span class="token operator">&lt;</span> <span class="token number">5</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> job <span class="token operator">is</span> <span class="token boolean">null</span> <span class="token punctuation">;</span>

<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> password <span class="token operator">!=</span> <span class="token string">'123456'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> password <span class="token operator">&lt;></span> <span class="token string">'123456'</span><span class="token punctuation">;</span>

<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> entrydate <span class="token operator">>=</span> <span class="token string">'2000-01-01'</span> <span class="token operator">and</span> entrydate <span class="token operator">&lt;=</span> <span class="token string">'2010-01-01'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> entrydate <span class="token operator">between</span> <span class="token string">'2000-01-01'</span> <span class="token operator">and</span> <span class="token string">'2010-01-01'</span><span class="token punctuation">;</span>

<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> entrydate <span class="token operator">between</span> <span class="token string">'2000-01-01'</span> <span class="token operator">and</span> <span class="token string">'2010-01-01'</span> <span class="token operator">&amp;&amp;</span> gender <span class="token operator">=</span> <span class="token number">2</span><span class="token punctuation">;</span>

<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> job <span class="token operator">=</span> <span class="token number">2</span> <span class="token operator">||</span> job <span class="token operator">=</span> <span class="token number">4</span><span class="token punctuation">;</span>
<span class="token keyword">select</span>  <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> job <span class="token operator">in</span> <span class="token punctuation">(</span><span class="token number">2</span><span class="token punctuation">,</span> <span class="token number">4</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment"># _单个任意字符  %任意多个字符</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">like</span> <span class="token string">'__'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">like</span> <span class="token string">'张%'</span><span class="token punctuation">;</span>




<span class="token comment"># -------------------------------3、分组查询-------------------------------------</span>
<span class="token comment"># 3、分组查询</span>

<span class="token comment">#========== A、聚合函数 (不对null进行运算)==========</span>

<span class="token comment"># a、count</span>
<span class="token comment"># count(字段)</span>
<span class="token keyword">select</span> <span class="token function">count</span><span class="token punctuation">(</span>id<span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>
<span class="token comment"># count(常量）</span>
<span class="token keyword">select</span> <span class="token function">count</span><span class="token punctuation">(</span><span class="token number">0</span><span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>
<span class="token comment"># count(*)   推荐，底层进行过优化</span>
<span class="token keyword">select</span> <span class="token function">count</span><span class="token punctuation">(</span><span class="token operator">*</span><span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># b、min</span>
<span class="token keyword">select</span> <span class="token function">min</span><span class="token punctuation">(</span>entrydate<span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># c、max</span>
<span class="token keyword">select</span> <span class="token function">max</span><span class="token punctuation">(</span>entrydate<span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># d、avg</span>
<span class="token keyword">select</span> <span class="token function">avg</span><span class="token punctuation">(</span>id<span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># e、sum</span>
<span class="token keyword">select</span> <span class="token function">sum</span><span class="token punctuation">(</span>id<span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># ===========B、分组查询===========</span>
<span class="token comment"># 返回值  1、分组字段  2、聚合函数</span>
<span class="token keyword">select</span> gender<span class="token punctuation">,</span><span class="token function">count</span><span class="token punctuation">(</span><span class="token operator">*</span><span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">group</span> <span class="token keyword">by</span> gender<span class="token punctuation">;</span>

<span class="token comment"># having 分组后的过滤条件，可以对聚合函数进行判断</span>
<span class="token comment"># where 分组前过滤，不能对聚合函数进行判断</span>
<span class="token keyword">select</span> job<span class="token punctuation">,</span> <span class="token function">count</span><span class="token punctuation">(</span><span class="token operator">*</span><span class="token punctuation">)</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> entrydate <span class="token operator">&lt;=</span> <span class="token string">'2015-01-01'</span> <span class="token keyword">group</span> <span class="token keyword">by</span> job <span class="token keyword">having</span> <span class="token function">count</span><span class="token punctuation">(</span><span class="token operator">*</span><span class="token punctuation">)</span> <span class="token operator">>=</span> <span class="token number">2</span><span class="token punctuation">;</span>



<span class="token comment"># --------------------------------4、排序查询------------------------------------</span>
<span class="token comment"># 4、排序查询</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">order</span> <span class="token keyword">by</span> entrydate <span class="token keyword">DESC</span> <span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">order</span> <span class="token keyword">by</span> entrydate <span class="token keyword">ASC</span> <span class="token punctuation">,</span> update_time <span class="token keyword">DESC</span> <span class="token punctuation">;</span>


<span class="token comment"># -------------------------------5、分页查询-------------------------------------</span>
<span class="token comment"># 5、分页查询</span>
<span class="token comment"># limit 起始索引,查询记录数</span>

<span class="token comment"># 1)从起始索引0开始，每页展示5条</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">limit</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">5</span><span class="token punctuation">;</span>
<span class="token comment"># 2)查询第一页员工数据，每页展示5条</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">limit</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">5</span><span class="token punctuation">;</span>
<span class="token comment"># 3)查询第二页员工数据，每页展示5条</span>
<span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">limit</span> <span class="token number">5</span><span class="token punctuation">,</span> <span class="token number">5</span><span class="token punctuation">;</span>

<span class="token comment"># 起始索引 = （页码 - 1）* 每页展示记录数</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_5、多表查询" tabindex="-1"><a class="header-anchor" href="#_5、多表查询"><span>5、多表查询</span></a></h2>
<p><strong>连接查询</strong>
<code v-pre>内连接</code>：相当于查询A,B交集的部分数据
<code v-pre>外连接</code>：
左外连接：查询左表的所有数据（包括两张表的交集部分）
右外连接：查询右表的所有数据（包括两张表的交集部分）</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment">/*
    多表查询
*/</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp<span class="token punctuation">,</span>
     tb_dept
<span class="token keyword">where</span> tb_emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> tb_dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>

<span class="token comment">/*
  连接查询
    内连接：相当于查询A,B交集的部分数据
    外连接：
        左外连接：查询左表的所有数据（包括两张表的交集部分）
        右外连接：查询右表的所有数据（包括两张表的交集部分）
*/</span>

<span class="token comment"># 隐式内连接</span>
<span class="token keyword">select</span> tb_emp<span class="token punctuation">.</span>name<span class="token punctuation">,</span> tb_dept<span class="token punctuation">.</span>name
<span class="token keyword">from</span> tb_emp<span class="token punctuation">,</span>
     tb_dept
<span class="token keyword">where</span> tb_emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> tb_dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>
<span class="token comment"># 显示内连接</span>
<span class="token keyword">select</span> tb_emp<span class="token punctuation">.</span>name<span class="token punctuation">,</span> tb_dept<span class="token punctuation">.</span>name
<span class="token keyword">from</span> tb_emp
         <span class="token keyword">inner</span> <span class="token keyword">join</span> tb_dept <span class="token keyword">on</span> tb_emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> tb_dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>
<span class="token keyword">select</span> emp<span class="token punctuation">.</span>name name<span class="token punctuation">,</span> dept<span class="token punctuation">.</span>name dept
<span class="token keyword">from</span> tb_emp emp
         <span class="token keyword">inner</span> <span class="token keyword">join</span> tb_dept dept <span class="token keyword">on</span> emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>
<span class="token comment">#起别名</span>

<span class="token comment">#左外连接</span>
<span class="token keyword">select</span> tb_emp<span class="token punctuation">.</span>name<span class="token punctuation">,</span> tb_dept<span class="token punctuation">.</span>name
<span class="token keyword">from</span> tb_emp
         <span class="token keyword">left</span> <span class="token keyword">outer</span> <span class="token keyword">join</span> tb_dept <span class="token keyword">on</span> tb_emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> tb_dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>
<span class="token comment"># 右外连接</span>
<span class="token keyword">select</span> tb_dept<span class="token punctuation">.</span>name<span class="token punctuation">,</span> tb_emp<span class="token punctuation">.</span>name
<span class="token keyword">from</span> tb_emp
         <span class="token keyword">right</span> <span class="token keyword">join</span> tb_dept <span class="token keyword">on</span> tb_emp<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> tb_dept<span class="token punctuation">.</span>id<span class="token punctuation">;</span>



<span class="token comment">/*
    子查询
*/</span>
<span class="token comment"># 1)标量子查询-----子查询结果是单个值------------------------------------------------------</span>
<span class="token comment"># 查询教研部员工信息</span>
<span class="token keyword">select</span> id
<span class="token keyword">from</span> tb_dept
<span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'教研部'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> dept_id <span class="token operator">=</span> <span class="token number">2</span><span class="token punctuation">;</span>

<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> dept_id <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token keyword">select</span> id <span class="token keyword">from</span> tb_dept <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'教研部'</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment"># 查询“方东白”入职之后得员工信息</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> entrydate <span class="token operator">></span>
      <span class="token punctuation">(</span><span class="token keyword">select</span> entrydate <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'方东白'</span><span class="token punctuation">)</span><span class="token punctuation">;</span>



<span class="token comment"># 2)列子查询-----子查询结果是一列------------------------------------------------------</span>
<span class="token comment"># 查询教研部以及咨询部的员工信息</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> dept_id <span class="token operator">in</span>
      <span class="token punctuation">(</span><span class="token keyword">select</span> id <span class="token keyword">from</span> tb_dept <span class="token keyword">where</span> name <span class="token operator">in</span> <span class="token punctuation">(</span><span class="token string">'教研部'</span><span class="token punctuation">,</span> <span class="token string">'咨询部'</span><span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">;</span>


<span class="token comment"># 3)行子查询-----子查询结果是一行------------------------------------------------------</span>
<span class="token comment"># 查询与韦一笑入职日期和职位都相同的员工信息</span>
<span class="token comment"># 拆分</span>
<span class="token keyword">select</span> entrydate<span class="token punctuation">,</span> job
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'韦一笑'</span><span class="token punctuation">;</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> entrydate <span class="token operator">=</span> <span class="token string">'2007-01-01'</span>
  <span class="token operator">and</span> job <span class="token operator">=</span> <span class="token string">'2'</span><span class="token punctuation">;</span>
<span class="token comment"># 合并</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> entrydate <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token keyword">select</span> entrydate <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'韦一笑'</span><span class="token punctuation">)</span>
  <span class="token operator">and</span> job <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token keyword">select</span> job <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'韦一笑'</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token comment"># 优化</span>
<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> <span class="token punctuation">(</span>entrydate<span class="token punctuation">,</span> job<span class="token punctuation">)</span> <span class="token operator">=</span> <span class="token punctuation">(</span><span class="token keyword">select</span> entrydate<span class="token punctuation">,</span> job <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> name <span class="token operator">=</span> <span class="token string">'韦一笑'</span><span class="token punctuation">)</span><span class="token punctuation">;</span>


<span class="token comment"># 3)表子查询------------------------------子查询结果是多行多列-----------------------------</span>
<span class="token comment"># 查询入职日期是‘2006-01-01’之后得员工信息以及其部门信息</span>

<span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> tb_emp
<span class="token keyword">where</span> entrydate <span class="token operator">></span> <span class="token string">'2006-01-01'</span><span class="token punctuation">;</span>

<span class="token keyword">select</span> e<span class="token punctuation">.</span><span class="token operator">*</span><span class="token punctuation">,</span> d<span class="token punctuation">.</span>name
<span class="token keyword">from</span> <span class="token punctuation">(</span><span class="token keyword">select</span> <span class="token operator">*</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> entrydate <span class="token operator">></span> <span class="token string">'2006-01-01'</span><span class="token punctuation">)</span> e<span class="token punctuation">,</span>
     tb_dept d
<span class="token keyword">where</span> e<span class="token punctuation">.</span>dept_id <span class="token operator">=</span> d<span class="token punctuation">.</span>id<span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_6、事务" tabindex="-1"><a class="header-anchor" href="#_6、事务"><span>6、事务</span></a></h2>
<p>一组操作的集合。它是一个不可分割的工作单位，事务会把所有操作作为一个整体一起向系统提交，即这些操作要么同时成功要么同时失败</p>
<p><strong>事务控制：</strong>
开启事务： <code v-pre>start transaction;  / begin</code>
提交事务：<code v-pre>commit</code>
回滚事务：<code v-pre>rollback</code></p>
<p><strong>事务的四大特性：(ACID)</strong>
A-原子性：事务是不可分割的最小单元，要么全部成功，要么全部失败
C-一致性：事务完成时，必须使所有数据都保持一致性
I-隔离性：数据库系统提供的隔离机制，保证事务在不受外部并发操作影响的独立环境下运行
D-持久性：事务一旦提交或者回滚，他对数据库中的数据的改变就是永久的</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment">/*解散部门*/</span>
<span class="token comment"># 开启事务</span>
<span class="token keyword">start</span> <span class="token keyword">transaction</span> <span class="token punctuation">;</span>

<span class="token comment"># 删除部门</span>
<span class="token keyword">delete</span> <span class="token keyword">from</span> tb_dept <span class="token keyword">where</span> id <span class="token operator">=</span> <span class="token number">3</span><span class="token punctuation">;</span>
<span class="token comment"># 删除部门下的员工</span>
<span class="token keyword">delete</span> <span class="token keyword">from</span> tb_emp <span class="token keyword">where</span> dept_id <span class="token operator">=</span> <span class="token number">3</span><span class="token punctuation">;</span>

<span class="token comment"># 提交事务</span>
<span class="token keyword">commit</span><span class="token punctuation">;</span>
<span class="token comment"># 回滚事务</span>
<span class="token keyword">rollback</span> <span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="_7、索引" tabindex="-1"><a class="header-anchor" href="#_7、索引"><span>7、索引</span></a></h2>
<p>索引（index）帮助数据库高效获取数据的数据结构<br>
 没有索引查找：全表扫描<br>
 有索引查找：B+Tree索引，Hash索引，Full-Text索引<br>
 <code v-pre>优点</code>：提高查询效率，降低IO成本；通过索引对数据排序降低排序成本，降低cpu消耗<br>
  <code v-pre>缺点</code>：会降低增删改的效率；占用空间<br></p>
<div class="hint-container tip">
<p class="hint-container-title">提示</p>
<p><code v-pre>注意：</code>
主键字段建表时会自动创建索引
添加唯一约束实际上会添加唯一索引</p>
</div>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment"># 创建索引</span>
<span class="token keyword">create</span> <span class="token keyword">index</span> idx_emp_name <span class="token keyword">on</span> tb_emp<span class="token punctuation">(</span>name<span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment"># 查询索引</span>
<span class="token keyword">show</span> <span class="token keyword">index</span> <span class="token keyword">from</span> tb_emp<span class="token punctuation">;</span>

<span class="token comment"># 删除索引</span>
<span class="token keyword">drop</span> <span class="token keyword">index</span> idx_emp_name <span class="token keyword">on</span> tb_emp<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


