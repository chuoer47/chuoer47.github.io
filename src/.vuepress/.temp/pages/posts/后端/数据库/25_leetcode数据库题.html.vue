<template><div><h1 id="leetcode数据库题目" tabindex="-1"><a class="header-anchor" href="#leetcode数据库题目"><span>Leetcode数据库题目</span></a></h1>
<p>刷Leetcode中数据库(MySQL)题目，整理写题过程中遇到的语法糖&amp;Tips&amp;踩坑经验。<strong>基础语法略过。</strong></p>
<h2 id="语法糖" tabindex="-1"><a class="header-anchor" href="#语法糖"><span>语法糖</span></a></h2>
<h3 id="日期函数" tabindex="-1"><a class="header-anchor" href="#日期函数"><span>日期函数</span></a></h3>
<p>在题目中经常需要在<code v-pre>where</code>语句中处理与日期相关的条件。更多信息查看<a href="https://dev.mysql.com/doc/" target="_blank" rel="noopener noreferrer">官方技术文档</a></p>
<ul>
<li>日期格式化<code v-pre>DATE_FORMAT(date, format)</code>。</li>
</ul>
<p>其中，%Y（4 位年份）、%m（月份，补零）、%d（日期，补零）、%H（24 小时制）、%i（分钟）、%s（秒）。</p>
<ul>
<li>提取日期部分
<code v-pre>YEAR(date) / MONTH(date) / DAY(date)</code></li>
</ul>
<p>使用场景：判断某产品在2025年2月一个月内的销售情况。</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">WHERE</span> <span class="token keyword">YEAR</span><span class="token punctuation">(</span>sell_date<span class="token punctuation">)</span> <span class="token operator">=</span> <span class="token number">2025</span> <span class="token operator">and</span> <span class="token keyword">MONTH</span><span class="token punctuation">(</span>sell_date<span class="token punctuation">)</span> <span class="token operator">=</span> <span class="token number">2</span> 
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><ul>
<li>日期计算</li>
</ul>
<p>增加：<code v-pre>DATE_ADD(date, INTERVAL expr unit)</code></p>
<p>删除：<code v-pre>DATE_SUB(date, INTERVAL expr unit)</code></p>
<p>计算天数：<code v-pre>DATEDIFF(date1, date2)</code></p>
<h3 id="条件选择" tabindex="-1"><a class="header-anchor" href="#条件选择"><span>条件选择</span></a></h3>
<p>题目需要条件查询，可根据情况使用</p>
<ul>
<li>IF：<code v-pre>IF(condition, value_if_true, value_if_false)</code></li>
<li>CASE</li>
</ul>
<p>CASE语句有两种常见的写法：</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">CASE</span> expression
    <span class="token keyword">WHEN</span> value1 <span class="token keyword">THEN</span> result1
    <span class="token keyword">WHEN</span> value2 <span class="token keyword">THEN</span> result2
    <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>
    <span class="token keyword">ELSE</span> default_result
<span class="token keyword">END</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>第一种常用于ENUM类型</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">CASE</span>
    <span class="token keyword">WHEN</span> condition1 <span class="token keyword">THEN</span> result1
    <span class="token keyword">WHEN</span> condition2 <span class="token keyword">THEN</span> result2
    <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>
    <span class="token keyword">ELSE</span> default_result
<span class="token keyword">END</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>第二种使用范围广</p>
<h3 id="小数四舍五入" tabindex="-1"><a class="header-anchor" href="#小数四舍五入"><span>小数四舍五入</span></a></h3>
<p><code v-pre>ROUND(number, decimal_places)</code></p>
<h3 id="group-concat" tabindex="-1"><a class="header-anchor" href="#group-concat"><span>GROUP_CONCAT()</span></a></h3>
<p>题目：<a href="https://leetcode.cn/problems/group-sold-products-by-the-date/" target="_blank" rel="noopener noreferrer">1484. 按日期分组销售产品</a></p>
<p>在 MySQL 中，GROUP_CONCAT() 是一个聚合函数，用于将分组后的多个行数据按照指定格式拼接成一个字符串，常用于将同一分组中的多个值合并展示。</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code>GROUP_CONCAT<span class="token punctuation">(</span><span class="token punctuation">[</span><span class="token keyword">DISTINCT</span><span class="token punctuation">]</span> 要拼接的字段 <span class="token punctuation">[</span><span class="token keyword">ORDER</span> <span class="token keyword">BY</span> 排序字段 <span class="token keyword">ASC</span><span class="token operator">/</span><span class="token keyword">DESC</span><span class="token punctuation">]</span> <span class="token punctuation">[</span>SEPARATOR <span class="token string">'分隔符'</span><span class="token punctuation">]</span><span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="regexp-like" tabindex="-1"><a class="header-anchor" href="#regexp-like"><span>regexp_like</span></a></h3>
<p>regexp_like是MySQL的正则表达式</p>
<p>题目: <a href="https://leetcode.cn/problems/find-users-with-valid-e-mails/description/" target="_blank" rel="noopener noreferrer">1517. 查找拥有有效邮箱的用户</a></p>
<p>题目答案：</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">select</span> <span class="token operator">*</span>
<span class="token keyword">from</span> users
<span class="token keyword">where</span> regexp_like<span class="token punctuation">(</span>mail<span class="token punctuation">,</span><span class="token string">'^[a-zA-Z][a-zA-Z0-9._-]*@leetcode\\.com$'</span><span class="token punctuation">,</span><span class="token string">'c'</span><span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>注意的点：</p>
<ul>
<li>^ 和 $：分别表示字符串的开始和结束，确保整个 mail 字段严格匹配模- 式，而非包含匹配子串。</li>
<li>[a-zA-Z]：字符集简写，匹配任意大小写字母（等价于 [A-Za-z]），第一个字符限制为字母。</li>
<li>\.：由于 . 在正则中是特殊字符（匹配任意字符），这里用 \ 转义为普通点号（MySQL 中需双重转义，其他数据库可能只需单转义 .）。</li>
<li>第三个参数 'c'：表示 “区分大小写”（case-sensitive），是正则匹配模式的简化标识，无需在正则本身中添加修饰符，属于函数特有的语法糖。</li>
</ul>
<h3 id="共用表达式-cte" tabindex="-1"><a class="header-anchor" href="#共用表达式-cte"><span>共用表达式（CTE）</span></a></h3>
<p>WITH AS 语句用于创建公用表表达式（CTE，Common Table Expression），可以将一个查询结果临时命名为一个表，供后续查询引用。它的主要作用是简化复杂查询，提高代码可读性和可维护性。</p>
<p>语法：</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">WITH</span> 临时表名<span class="token number">1</span> <span class="token keyword">AS</span> <span class="token punctuation">(</span>
  <span class="token keyword">SELECT</span> <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>  <span class="token comment">-- 子查询1</span>
<span class="token punctuation">)</span><span class="token punctuation">,</span>
临时表名<span class="token number">2</span> <span class="token keyword">AS</span> <span class="token punctuation">(</span>
  <span class="token keyword">SELECT</span> <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>  <span class="token comment">-- 子查询2，可引用临时表名1</span>
<span class="token punctuation">)</span>
<span class="token comment">-- 主查询，可引用上面定义的所有临时表</span>
<span class="token keyword">SELECT</span> <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span> <span class="token keyword">FROM</span> 临时表名<span class="token number">1</span> <span class="token keyword">JOIN</span> 临时表名<span class="token number">2</span> <span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="窗口函数" tabindex="-1"><a class="header-anchor" href="#窗口函数"><span>窗口函数</span></a></h3>
<p>基本语法</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code>函数名<span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token keyword">OVER</span> <span class="token punctuation">(</span>
  <span class="token keyword">PARTITION</span> <span class="token keyword">BY</span> 分组字段  <span class="token comment">-- 可选，按指定字段分组后再排名</span>
  <span class="token keyword">ORDER</span> <span class="token keyword">BY</span> 排序字段 <span class="token punctuation">[</span><span class="token keyword">ASC</span><span class="token operator">/</span><span class="token keyword">DESC</span><span class="token punctuation">]</span>  <span class="token comment">-- 必须，指定排序规则</span>
<span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><code v-pre>PARTITION BY</code>：将数据按指定字段分成多个组，每组内独立排名（不指定则对整个结果集排名）。</p>
<p><code v-pre>ORDER BY</code>：指定排序依据（升序 / 降序），决定排名顺序。</p>
<h4 id="窗口函数之排名" tabindex="-1"><a class="header-anchor" href="#窗口函数之排名"><span>窗口函数之排名</span></a></h4>
<p>在 MySQL 中，排名类窗口函数用于对一组数据进行排序并生成排名序号，常用的有 <code v-pre>RANK()</code>、<code v-pre>DENSE_RANK()</code> 和 <code v-pre>ROW_NUMBER()</code>。它们的核心区别在于处理 “并列排名” 的方式不同。</p>
<ol>
<li><code v-pre>RANK()</code>：并列数据占用相同排名，后续排名会 “跳号”。</li>
<li><code v-pre>DENSE_RANK()</code>：并列数据占用相同排名，后续排名 “不跳号”（连续排名）。</li>
<li><code v-pre>ROW_NUMBER()</code>：不考虑并列，按顺序依次生成唯一序号（即使数据相同，排名也不同）。</li>
</ol>
<h4 id="窗口函数之sum" tabindex="-1"><a class="header-anchor" href="#窗口函数之sum"><span>窗口函数之SUM</span></a></h4>
<p>在 SQL 中，SUM()作为窗口函数使用时，能够对一组行（窗口）中的数值值进行求和计算，并且可以保留每一行的详细信息，而不像普通聚合函数那样会将多行数据合并为一行结果。</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token function">SUM</span><span class="token punctuation">(</span>列名<span class="token punctuation">)</span> <span class="token keyword">OVER</span> <span class="token punctuation">(</span>
    <span class="token punctuation">[</span><span class="token keyword">PARTITION</span> <span class="token keyword">BY</span> 分区列<span class="token punctuation">]</span> 
    <span class="token punctuation">[</span><span class="token keyword">ORDER</span> <span class="token keyword">BY</span> 排序列 <span class="token punctuation">[</span><span class="token keyword">ASC</span><span class="token operator">|</span><span class="token keyword">DESC</span><span class="token punctuation">]</span><span class="token punctuation">]</span>
    <span class="token punctuation">[</span><span class="token keyword">ROWS</span><span class="token operator">|</span>RANGE 窗口框架<span class="token punctuation">]</span>
<span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>具体用处：</p>
<ol>
<li>实现前缀和功能</li>
<li>一组行（窗口）中的数值值进行求和计算</li>
</ol>
<h4 id="窗口函数之first-value" tabindex="-1"><a class="header-anchor" href="#窗口函数之first-value"><span>窗口函数之FIRST_VALUE</span></a></h4>
<p>在 SQL 中，FIRST_VALUE()是一个窗口函数，用于返回窗口框架内的第一行数据的指定列值。它可以结合分区、排序和窗口框架定义，灵活地获取不同范围内的首行数据，且不会像聚合函数那样合并 rows，而是为每一行返回对应的首行参考值。</p>
<h2 id="tips" tabindex="-1"><a class="header-anchor" href="#tips"><span>Tips</span></a></h2>
<h3 id="group-by-多字段" tabindex="-1"><a class="header-anchor" href="#group-by-多字段"><span>GROUP BY 多字段</span></a></h3>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">SELECT</span> 字段<span class="token number">1</span><span class="token punctuation">,</span> 字段<span class="token number">2</span><span class="token punctuation">,</span> 聚合函数<span class="token punctuation">(</span>字段<span class="token punctuation">)</span>
<span class="token keyword">FROM</span> 表名
<span class="token keyword">GROUP</span> <span class="token keyword">BY</span> 字段<span class="token number">1</span><span class="token punctuation">,</span> 字段<span class="token number">2</span> <span class="token punctuation">[</span><span class="token punctuation">,</span> 更多字段<span class="token punctuation">]</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>可与窗口函数结合使用完成多种常见场景使用。</p>
<h3 id="经典处理连续出现的数字问题" tabindex="-1"><a class="header-anchor" href="#经典处理连续出现的数字问题"><span>经典处理连续出现的数字问题</span></a></h3>
<p>题目：<a href="https://leetcode.cn/problems/consecutive-numbers/description/" target="_blank" rel="noopener noreferrer">180. 连续出现的数字</a></p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">with</span>
    aux_list <span class="token keyword">as</span> <span class="token punctuation">(</span>
        <span class="token keyword">select</span> num<span class="token punctuation">,</span>id<span class="token operator">-</span>cast<span class="token punctuation">(</span>row_number<span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token keyword">over</span><span class="token punctuation">(</span><span class="token keyword">partition</span> <span class="token keyword">by</span> num <span class="token keyword">order</span> <span class="token keyword">by</span> id<span class="token punctuation">)</span> <span class="token keyword">as</span> signed<span class="token punctuation">)</span> aux
        <span class="token keyword">from</span> Logs
    <span class="token punctuation">)</span><span class="token punctuation">,</span>
    cnt_list <span class="token keyword">as</span><span class="token punctuation">(</span>
        <span class="token keyword">select</span> num<span class="token punctuation">,</span><span class="token function">count</span><span class="token punctuation">(</span><span class="token operator">*</span><span class="token punctuation">)</span> cnt
        <span class="token keyword">from</span> aux_list
        <span class="token keyword">group</span> <span class="token keyword">by</span> num<span class="token punctuation">,</span>aux
    <span class="token punctuation">)</span>
<span class="token keyword">select</span> <span class="token keyword">distinct</span> num <span class="token keyword">as</span> ConsecutiveNums 
<span class="token keyword">from</span> cnt_list
<span class="token keyword">group</span> <span class="token keyword">by</span> num
<span class="token keyword">having</span> <span class="token function">max</span><span class="token punctuation">(</span>cnt<span class="token punctuation">)</span> <span class="token operator">>=</span> <span class="token number">3</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="ifnull" tabindex="-1"><a class="header-anchor" href="#ifnull"><span>IFNULL</span></a></h3>
<p>MySQL独有的函数。</p>
<p>表达式<code v-pre>IFNULL(expr1, expr2)</code>，如果 expr1 不是 NULL，返回 expr1；如果 expr1 是 NULL，返回 expr2</p>
<h2 id="踩坑" tabindex="-1"><a class="header-anchor" href="#踩坑"><span>踩坑</span></a></h2>
<h3 id="in中嵌套的子sql语句无法使用limit" tabindex="-1"><a class="header-anchor" href="#in中嵌套的子sql语句无法使用limit"><span>in中嵌套的子SQL语句无法使用limit</span></a></h3>
<p>问题描述：MySQL 对 IN 子句中嵌套的子查询使用 LIMIT 存在限制，直接使用可能会报错。这是因为数据库引擎在解析 IN 子句时，对内部子查询的语法支持有特殊要求。</p>
<p>案例：限定前10个用户。</p>
<p>错误代码：</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">SELECT</span> <span class="token operator">*</span> <span class="token keyword">FROM</span> orders 
<span class="token keyword">WHERE</span> user_id <span class="token operator">IN</span> <span class="token punctuation">(</span>
  <span class="token keyword">SELECT</span> user_id <span class="token keyword">FROM</span> users 
  <span class="token keyword">ORDER</span> <span class="token keyword">BY</span> active_score <span class="token keyword">DESC</span> 
  <span class="token keyword">LIMIT</span> <span class="token number">10</span>  <span class="token comment">-- 此处 LIMIT 可能导致错误</span>
<span class="token punctuation">)</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>解决办法：</p>
<ol>
<li>通过将带 LIMIT 的子查询包装成一个派生表（Derived Table），可以绕过这个限制。</li>
</ol>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">SELECT</span> <span class="token operator">*</span> <span class="token keyword">FROM</span> orders 
<span class="token keyword">WHERE</span> user_id <span class="token operator">IN</span> <span class="token punctuation">(</span>
  <span class="token keyword">SELECT</span> user_id <span class="token keyword">FROM</span> <span class="token punctuation">(</span>
    <span class="token comment">-- 内层子查询带 LIMIT</span>
    <span class="token keyword">SELECT</span> user_id <span class="token keyword">FROM</span> users 
    <span class="token keyword">ORDER</span> <span class="token keyword">BY</span> active_score <span class="token keyword">DESC</span> 
    <span class="token keyword">LIMIT</span> <span class="token number">10</span>
  <span class="token punctuation">)</span> <span class="token keyword">AS</span> sub_query  <span class="token comment">-- 必须为派生表指定别名</span>
<span class="token punctuation">)</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2.JOIN 替代 IN（优先使用）</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">SELECT</span> o<span class="token punctuation">.</span><span class="token operator">*</span> <span class="token keyword">FROM</span> orders o
<span class="token keyword">JOIN</span> <span class="token punctuation">(</span>
  <span class="token keyword">SELECT</span> user_id <span class="token keyword">FROM</span> users 
  <span class="token keyword">ORDER</span> <span class="token keyword">BY</span> active_score <span class="token keyword">DESC</span> 
  <span class="token keyword">LIMIT</span> <span class="token number">10</span>
<span class="token punctuation">)</span> <span class="token keyword">AS</span> top_users 
<span class="token keyword">ON</span> o<span class="token punctuation">.</span>user_id <span class="token operator">=</span> top_users<span class="token punctuation">.</span>user_id<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="无查询结果默认返回null问题" tabindex="-1"><a class="header-anchor" href="#无查询结果默认返回null问题"><span>无查询结果默认返回NULL问题</span></a></h3>
<p>踩坑题目: <a href="https://leetcode.cn/problems/biggest-single-number/description/" target="_blank" rel="noopener noreferrer">619. 只出现一次的最大数字</a></p>
<p>问题描述：
在 SQL 中，当查询没有匹配结果时，默认不会返回任何行。如果希望在这种情况下显式返回 NULL（或其他默认值）</p>
<p>解决办法：</p>
<ol>
<li>使用子查询 + LEFT JOIN</li>
</ol>
<p>将原查询作为子查询，与一个 “虚拟表”（含一行数据）进行左连接，确保至少返回一行结果。</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token comment">-- 若原查询无结果，返回 NULL</span>
<span class="token keyword">SELECT</span> t<span class="token punctuation">.</span>result
<span class="token keyword">FROM</span> <span class="token punctuation">(</span><span class="token keyword">SELECT</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token keyword">AS</span> <span class="token keyword">dummy</span>  <span class="token comment">-- 虚拟表，确保有一行</span>
<span class="token keyword">LEFT</span> <span class="token keyword">JOIN</span> <span class="token punctuation">(</span>
  <span class="token comment">-- 你的原查询（例如：查询 ID=100 的用户姓名）</span>
  <span class="token keyword">SELECT</span> name <span class="token keyword">AS</span> result <span class="token keyword">FROM</span> users <span class="token keyword">WHERE</span> id <span class="token operator">=</span> <span class="token number">100</span>
<span class="token punctuation">)</span> <span class="token keyword">AS</span> t <span class="token keyword">ON</span> <span class="token number">1</span><span class="token operator">=</span><span class="token number">1</span><span class="token punctuation">;</span>  <span class="token comment">-- 恒真条件，确保左连接生效</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2.使用聚合函数（<strong>优先使用</strong>）</p>
<p>聚合函数（如 MAX()、MIN()、SUM()）在无匹配行时会返回 NULL，而非空集。</p>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">SELECT</span> <span class="token function">MAX</span><span class="token punctuation">(</span>name<span class="token punctuation">)</span> <span class="token keyword">AS</span> result  <span class="token comment">-- 用 MAX() 包裹查询字段</span>
<span class="token keyword">FROM</span> users 
<span class="token keyword">WHERE</span> id <span class="token operator">=</span> <span class="token number">100</span><span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="union与union-all的区别" tabindex="-1"><a class="header-anchor" href="#union与union-all的区别"><span>UNION与UNION ALL的区别</span></a></h3>
<p>踩坑题目：<a href="https://leetcode.cn/problems/employees-with-missing-information/" target="_blank" rel="noopener noreferrer">1965. 丢失信息的雇员</a></p>
<p>问题描述：</p>
<ul>
<li>UNION：会对合并后的结果集自动去除重复行，只保留唯一记录。即，合并后会执行类似 DISTINCT 的去重操作。</li>
<li>UNION ALL：保留所有结果行，包括重复数据（即直接拼接多个结果集，不做去重处理）。</li>
</ul>
<h3 id="in-与-null的坑" tabindex="-1"><a class="header-anchor" href="#in-与-null的坑"><span>IN 与 NULL的坑</span></a></h3>
<p>A not in B的原理是拿A表值与B表值做是否不等的比较, 也就是a != b. 在sql中, null是缺失未知值而不是空值(详情请见<a href="https://dev.mysql.com/doc/refman/8.0/en/working-with-null.html" target="_blank" rel="noopener noreferrer">MySQL reference</a>).</p>
<p>当你判断任意值a != null时, 官方说, &quot;You cannot use arithmetic comparison operators such as =, &lt;, or &lt;&gt; to test for NULL&quot;, 任何与null值的对比都将返回null。这点可以用代码 select if(1 = null, 'true', 'false')证实。</p>
<p><strong>从上述原理可见, 当询问 id not in (select * from XXX)时, 如果XXX中存在null值, 返回结果全为false</strong>。</p>
</div></template>


