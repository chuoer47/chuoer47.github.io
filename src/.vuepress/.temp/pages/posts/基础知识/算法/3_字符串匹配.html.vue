<template><div><!--more--->
<h1 id="字符串匹配" tabindex="-1"><a class="header-anchor" href="#字符串匹配"><span>字符串匹配</span></a></h1>
<h2 id="一、kmp算法" tabindex="-1"><a class="header-anchor" href="#一、kmp算法"><span>一、KMP算法</span></a></h2>
<p>模式串与主串做匹配时，如果是暴力匹配，在主串某趟匹配失败后，模式串要移动第一位，而主串也有苦难需要回退。</p>
<p>在KMP算法中，如果在匹配过程中，主串不需要回退，当匹配失败后，会从当前位置开始继续匹配。而模式串会滑动到某一位开始比较，而不是没都回退到第一位开始比较。</p>
<h3 id="_1、前缀表" tabindex="-1"><a class="header-anchor" href="#_1、前缀表"><span>1、前缀表</span></a></h3>
<ul>
<li>
<p>前缀：除最后一个字符以外，字符串的所有头部子串。</p>
</li>
<li>
<p>后缀：除第一个字符以外，字符串的所有尾部子串。</p>
</li>
</ul>
<p>需要找的是每个子串前缀和后缀相等的最长的前缀和后缀的长度。</p>
<p><strong>求前缀表</strong></p>
<p>以 <code v-pre>abcac</code> 为例：</p>
<table>
<thead>
<tr>
<th>子串</th>
<th>前缀</th>
<th>后缀</th>
<th>最长相等前后缀长度</th>
</tr>
</thead>
<tbody>
<tr>
<td>a</td>
<td>-</td>
<td>-</td>
<td>0</td>
</tr>
<tr>
<td>ab</td>
<td>a</td>
<td>b</td>
<td>0</td>
</tr>
<tr>
<td>abc</td>
<td>ab、a</td>
<td>bc、c</td>
<td>0</td>
</tr>
<tr>
<td>abca</td>
<td>abc、ab、<strong>a</strong></td>
<td>bca、ca、<strong>a</strong></td>
<td>1</td>
</tr>
<tr>
<td>abcac</td>
<td>abca、abc、ab、a</td>
<td>bcba、cac、ac、c</td>
<td>0</td>
</tr>
</tbody>
</table>
<table>
<thead>
<tr>
<th>下标</th>
<th>0</th>
<th>1</th>
<th>2</th>
<th>3</th>
<th>4</th>
</tr>
</thead>
<tbody>
<tr>
<td>字符串</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>c</td>
</tr>
<tr>
<td>前缀表 prefix</td>
<td>0</td>
<td>0</td>
<td>0</td>
<td>1</td>
<td>0</td>
</tr>
</tbody>
</table>
<p>所以，字符串 <code v-pre>abcac</code> 的最长相等前后端长度是 <code v-pre>00010</code>，将这个长度写成数组形式，得到</p>
<p>对应的部分匹配值 <code v-pre>[0,0,0,1,0]</code> ，换成另一个名字是，前缀表 <code v-pre>prefix = [0,0,0,1,0]</code></p>
<p><strong>模拟匹配过程</strong></p>
<p>下面，将模式串 <code v-pre>abcac</code> 与 主串 <code v-pre>ababcabcacbab</code> 进行匹配</p>
<p><strong>第一趟：</strong></p>
<p>主串指针 <code v-pre>len = 2</code> ，模式串指针 <code v-pre>i = 2</code> 时，模式串的 <code v-pre>c</code> 和主串的 <code v-pre>a</code> 匹配失败。已经匹配的字符串是 <code v-pre>ab</code> ，查看前缀表，<code v-pre>prefix[1] = 0</code> ，说明 <code v-pre>ab</code> 前缀和后缀没有相等的，所以下一趟模式串要回退到第一个字符重新比较，也就是回退到模式串  <code v-pre>pattern</code>  的下标为 0 的位置。</p>
<table>
<thead>
<tr>
<th>下标</th>
<th>0</th>
<th>1</th>
<th>2</th>
<th>3</th>
<th>4</th>
<th>5</th>
<th>6</th>
<th>7</th>
<th>8</th>
<th>9</th>
<th>10</th>
<th>11</th>
<th>12</th>
</tr>
</thead>
<tbody>
<tr>
<td>主串 main</td>
<td>a</td>
<td>b</td>
<td><strong>a</strong></td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>c</td>
<td>b</td>
<td>a</td>
<td>b</td>
</tr>
<tr>
<td>模式串 pattern</td>
<td>a</td>
<td>b</td>
<td><strong>c</strong></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>
<p><strong>第二趟：</strong></p>
<p>主串指针 <code v-pre>len = 6</code> ，模式串指针 <code v-pre>i = 4</code> 时，模式串的 <code v-pre>c</code> 和主串的 <code v-pre>b</code> 匹配失败。已经匹配的字符串是 <code v-pre>abca</code> ，查看前缀表，<code v-pre>prefix[3] = 1</code> ，说明 <code v-pre>abca</code> 前缀和后缀有一个字符相等，所以下一趟模式串要回退到第二个字符开始重新比较，也就是回退到模式串  <code v-pre>pattern</code>  的下标为 1 的位置。</p>
<table>
<thead>
<tr>
<th>下标</th>
<th>0</th>
<th>1</th>
<th>2</th>
<th>3</th>
<th>4</th>
<th>5</th>
<th>6</th>
<th>7</th>
<th>8</th>
<th>9</th>
<th>10</th>
<th>11</th>
<th>12</th>
</tr>
</thead>
<tbody>
<tr>
<td>主串 main</td>
<td>a</td>
<td>b</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td><strong>b</strong></td>
<td>c</td>
<td>a</td>
<td>c</td>
<td>b</td>
<td>a</td>
<td>b</td>
</tr>
<tr>
<td>模式串 pattern</td>
<td></td>
<td></td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td><strong>c</strong></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>
<p><strong>第三趟：</strong></p>
<p>主串指针 <code v-pre>len = 6</code> ，模式串指针 <code v-pre>i = 0</code> 时，模式串的 <code v-pre>a</code> 和主串的 <code v-pre>b</code> 匹配失败。查看前缀表，<code v-pre>prefix[0] = 0</code> ，说明前缀和后缀没有相等的，因为当前与主串比较的就是模式串的第一个字符，所以，将主串移到下一个位置，与模式串的第一个字符比较。</p>
<table>
<thead>
<tr>
<th>下标</th>
<th>0</th>
<th>1</th>
<th>2</th>
<th>3</th>
<th>4</th>
<th>5</th>
<th>6</th>
<th>7</th>
<th>8</th>
<th>9</th>
<th>10</th>
<th>11</th>
<th>12</th>
</tr>
</thead>
<tbody>
<tr>
<td>主串 main</td>
<td>a</td>
<td>b</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>c</td>
<td>b</td>
<td>a</td>
<td>b</td>
</tr>
<tr>
<td>模式串 pattern</td>
<td></td>
<td></td>
<td></td>
<td></td>
<td></td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>c</td>
<td></td>
<td></td>
<td></td>
</tr>
</tbody>
</table>
<p>模式串全部比较完成，匹配成功。整个匹配过程中，主串始终没有回退，所以，KMP算法的时间复杂的是 <code v-pre>O（n+m）</code> 。</p>
<p>某趟发生匹配失败时，如果对应部分的前缀表是0，也就是说已匹配的相等序列中没有相等的前后缀，此时模式串移到第一个字符开始比较。</p>
<p>这个前缀表，似乎和写代码时用的next数组没有关系诶。</p>
<h3 id="_2、next数组" tabindex="-1"><a class="header-anchor" href="#_2、next数组"><span>2、next数组</span></a></h3>
<p><strong>以 <code v-pre>abcac</code> 为例：</strong></p>
<p>前缀表 <code v-pre>prefix = [0,0,0,1,0]</code> ，</p>
<p>用求next数组的方法求出来的数组是 <code v-pre>next = [0,1,1,1,2]</code> ，</p>
<p>这样看起来，<code v-pre>prefix</code> 和 <code v-pre>next</code> 的关系，好像并不明显，这么隐晦的吗？</p>
<p>next数组 还有一种表达方式 <code v-pre>next = [-1,0,0,0,1]</code> ，这样看来来，<code v-pre>prefix</code> 和 <code v-pre>next</code> 好像有点关系了。</p>
<p>将前缀表整体右移一位，然后将空出来的第一位用 <code v-pre>-1 </code> 填充，就得到了next 数组：</p>
<table>
<thead>
<tr>
<th>下标</th>
<th>0</th>
<th>1</th>
<th>2</th>
<th>3</th>
<th>4</th>
</tr>
</thead>
<tbody>
<tr>
<td>字符串</td>
<td>a</td>
<td>b</td>
<td>c</td>
<td>a</td>
<td>c</td>
</tr>
<tr>
<td>前缀表 prefix</td>
<td>0</td>
<td>0</td>
<td>0</td>
<td>1</td>
<td>0</td>
</tr>
<tr>
<td>next</td>
<td><strong>-1</strong></td>
<td>0</td>
<td>0</td>
<td>0</td>
<td>1</td>
</tr>
</tbody>
</table>
<p>这样，当模式串和主串匹配失败时，直接查看当前匹配失败的字符的前缀表就可以了，而不是查看匹配失败字符前一个字符的前缀表了。</p>
<p><strong>next数组计算规则:</strong></p>
<figure><img src="/image/algorithm/a33.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>代码里应该是先定义一个 next 数组 (和子串长度相等) ，然后写一个 getNext 方法得到 next 数组中的值，那么 getNext 方法的代码如何写呢, 马上来啦！</p>
<p>定义变量K</p>
<figure><img src="/image/algorithm/a34.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p><strong>注意：k 的值就是我们所说的, 子串匹配失败后 j 移动（回退）到的位置</strong> , 继续往下看</p>
<p>期望情况 : <strong>charAt( j-1 ) == charAt( k )</strong>✅</p>
<figure><img src="/image/algorithm/a35.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>非期望情况 : <strong>charAt( j-1 ) != charAt( k )</strong>❎</p>
<figure><img src="/image/algorithm/a36.jpeg" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>通过这两种情况的情况的对比分析可知</p>
<ul>
<li>第 1 种情况才是理想的, 我们希望发生的</li>
<li>如果发生第 2 种情况, 我们就想办法改变现状, 变成第 1 种情况, 就是<strong>让 k 一直回退, 每次回退之后就判断是否满足第 1 种情况</strong>, 直到满足第 1 种情况的条件为止</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token keyword">void</span> <span class="token function">getNext</span><span class="token punctuation">(</span><span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> next<span class="token punctuation">,</span> <span class="token class-name">String</span> sub<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    next<span class="token punctuation">[</span><span class="token number">0</span><span class="token punctuation">]</span> <span class="token operator">=</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
    <span class="token keyword">if</span><span class="token punctuation">(</span>sub<span class="token punctuation">.</span><span class="token function">length</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 当子串只有一个数据的时候，next数组的长度为1</span>
    	<span class="token keyword">return</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token comment">// 前提条件是数组长度大于1</span>
    next<span class="token punctuation">[</span><span class="token number">1</span><span class="token punctuation">]</span> <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span>
    <span class="token keyword">int</span> k <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span>
    <span class="token keyword">int</span> j <span class="token operator">=</span> <span class="token number">2</span><span class="token punctuation">;</span>

    <span class="token keyword">while</span><span class="token punctuation">(</span>j <span class="token operator">&lt;</span> sub<span class="token punctuation">.</span><span class="token function">length</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">if</span><span class="token punctuation">(</span>k <span class="token operator">==</span> <span class="token operator">-</span><span class="token number">1</span> <span class="token operator">||</span> sub<span class="token punctuation">.</span><span class="token function">charAt</span><span class="token punctuation">(</span>j <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token operator">==</span> sub<span class="token punctuation">.</span><span class="token function">charAt</span><span class="token punctuation">(</span>k<span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            next<span class="token punctuation">[</span>j<span class="token punctuation">]</span> <span class="token operator">=</span> k <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">;</span>
            j<span class="token operator">++</span><span class="token punctuation">;</span>
            k<span class="token operator">++</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span><span class="token keyword">else</span> <span class="token punctuation">{</span>
            k <span class="token operator">=</span> next<span class="token punctuation">[</span>k<span class="token punctuation">]</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、代码实现" tabindex="-1"><a class="header-anchor" href="#_3、代码实现"><span>3、代码实现</span></a></h3>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token keyword">int</span> <span class="token function">KMP</span><span class="token punctuation">(</span><span class="token class-name">String</span> str<span class="token punctuation">,</span> <span class="token class-name">String</span> sub<span class="token punctuation">,</span> <span class="token keyword">int</span> pos<span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token comment">// 判断两个串不能为空</span>
    <span class="token keyword">if</span><span class="token punctuation">(</span>str <span class="token operator">==</span> <span class="token keyword">null</span> <span class="token operator">||</span> sub <span class="token operator">==</span> <span class="token keyword">null</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
         <span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token keyword">int</span> i <span class="token operator">=</span> pos<span class="token punctuation">;</span><span class="token comment">// i遍历主串  从pos位置开始</span>
    <span class="token keyword">int</span> j <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span>  <span class="token comment">// j遍历字串  从0开始</span>
    <span class="token keyword">int</span> strLength <span class="token operator">=</span> str<span class="token punctuation">.</span><span class="token function">length</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    <span class="token keyword">int</span> subLength <span class="token operator">=</span> sub<span class="token punctuation">.</span><span class="token function">length</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        
    <span class="token keyword">if</span><span class="token punctuation">(</span>strLength <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">||</span> subLength <span class="token operator">==</span> <span class="token number">0</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
    <span class="token comment">// 判断pos位置合法性</span>
    <span class="token keyword">if</span><span class="token punctuation">(</span>pos <span class="token operator">&lt;</span> <span class="token number">0</span> <span class="token operator">||</span> pos <span class="token operator">></span> strLength<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token comment">//求字串的next数组</span>
    <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> next <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token keyword">int</span><span class="token punctuation">[</span>subLength<span class="token punctuation">]</span><span class="token punctuation">;</span>
    <span class="token function">getNext</span><span class="token punctuation">(</span>next<span class="token punctuation">,</span> sub<span class="token punctuation">)</span><span class="token punctuation">;</span>

    <span class="token keyword">while</span><span class="token punctuation">(</span>i <span class="token operator">&lt;</span> strLength <span class="token operator">&amp;&amp;</span> j <span class="token operator">&lt;</span> subLength<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">if</span><span class="token punctuation">(</span>j <span class="token operator">==</span> <span class="token operator">-</span><span class="token number">1</span> <span class="token operator">||</span> str<span class="token punctuation">.</span><span class="token function">charAt</span><span class="token punctuation">(</span>i<span class="token punctuation">)</span> <span class="token operator">==</span>  sub<span class="token punctuation">.</span><span class="token function">charAt</span><span class="token punctuation">(</span>j<span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            i<span class="token operator">++</span><span class="token punctuation">;</span>
            j<span class="token operator">++</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span><span class="token keyword">else</span> <span class="token punctuation">{</span>
            j <span class="token operator">=</span> next<span class="token punctuation">[</span>j<span class="token punctuation">]</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

    <span class="token punctuation">}</span><span class="token keyword">if</span><span class="token punctuation">(</span>j <span class="token operator">==</span> subLength<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token comment">// 字串遍历完之后 j应该等于sublength</span>
        <span class="token comment">// 找到返回字串在主串中的起始位置</span>
        <span class="token keyword">return</span> i <span class="token operator">-</span> j<span class="token punctuation">;</span>
    <span class="token punctuation">}</span><span class="token keyword">else</span> <span class="token punctuation">{</span>
        <span class="token comment">// 找不到返回-1</span>
		<span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
	<span class="token punctuation">}</span>

<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="二、bm算法" tabindex="-1"><a class="header-anchor" href="#二、bm算法"><span>二、BM算法</span></a></h2>
<p>BM 算法是一种高效的字符串匹配算法，名称由两个发明者姓名的首字母组成。该算法有两类规则：<strong>坏字符规则</strong>和<strong>好后缀规则</strong>，其中好后缀规则可以独立于坏字符规则使用，<strong>在内存要求比较严格时，可以只使用好后缀规则来实现</strong>。BM 算法的时间复杂度分析非常复杂，有数据表明，在实践中 BM 算法比 KMP 算法快 3-5 倍，且通常模式串越长，算法速度越快。</p>
<h3 id="_1、坏字符" tabindex="-1"><a class="header-anchor" href="#_1、坏字符"><span>1、坏字符</span></a></h3>
<figure><img src="/image/algorithm/a37.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>首先，主串和模式串头部对齐，从尾部开始比较。上图中 S 和 E 不匹配，我们就称 <strong>S 为坏字符，即不匹配的字符</strong>。此时 S 也不包含在模式串中，因此可以直接移动到 S 的后一位。如下图所示：</p>
<figure><img src="/image/algorithm/a38.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>依然从尾部开始比较，发现 P 与 E 不匹配，所以 P 是坏字符。但是 P 包含在模式串中，所以只能将模式串后移 2 位，两个 P 对齐。如下图所示：</p>
<figure><img src="/image/algorithm/a39.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>由此总结出<strong>坏字符规则：后移位数 = 坏字符在模式串中的位置 - 坏字符在模式串中的上一次出现位置</strong>。如果坏字符不包含在模式串中，则上一次出现位置为 -1。</p>
<blockquote>
<p>上一次出现位置：指最右出现的位置，即从模式串的当前位置开始，从右往左查找</p>
</blockquote>
<p>以 P 为例，它作为坏字符，出现在模式串的第 6 位（从0开始编号），在模式串中的上一次出现位置为 4，所以后移 6 - 4 = 2 位。再以 S 为例，它出现在模式串的第 6 位，上一次出现位置是 -1（即未出现），所以后移 6 - (-1) = 7位，刚好是模式串的长度。</p>
<h3 id="_2、好后缀" tabindex="-1"><a class="header-anchor" href="#_2、好后缀"><span>2、好后缀</span></a></h3>
<figure><img src="/image/algorithm/a40.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>依然从尾部开始比较，MPLE 与 MPLE 匹配。我们就称 MPLE、PLE、LE、E 为好后缀，即所有尾部匹配的字符串。继续比较前一位，发现 I 与 A 不匹配，所以 I 是坏字符，按照坏字符规则，应该将模式串后移 2 - (-1) = 3 位。但是，我们这里采用好后缀规则：后移位数 = 好后缀在模式串中的位置 - 好后缀在模式串中上一次出现的位置。如果好后缀在模式串中只出现一次，则上一次出现位置为 -1。</p>
<blockquote>
<p>上一次出现位置：指最左出现的位置，即从模式串的头部开始，从左往右查找</p>
</blockquote>
<p>BM 算法的基本思想是，每次后移这两个规则之中的较大值。更巧妙的是，这两个规则的移动位数，只与模式串有关，与主串无关。因此，可以预先计算生成《坏字符规则表》和《好后缀规则表》。使用时，只要查表比较一下就可以了。</p>
<p>此时，所有的好后缀之中，只有 E 还出现在 EXAMPLE 的头部，所以后移 6 - 0 = 6 (6 &gt; 3) 位。如下图所示：</p>
<figure><img src="/image/algorithm/a41.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>可以看到，&quot;坏字符规则&quot;只能移3位，&quot;好后缀规则&quot;可以移6位。所以，Boyer-Moore算法的基本思想是，每次后移这两个规则之中的较大值。</p>
<p><strong>这个规则有三个注意点</strong>：</p>
<ul>
<li>&quot;好后缀&quot;的位置以最后一个字符为准。假定&quot;ABCDEF&quot;的&quot;EF&quot;是好后缀，则它的位置以&quot;F&quot;为准，即5（从0开始计算）。</li>
<li>如果&quot;好后缀&quot;在搜索词中只出现一次，则它的上一次出现位置为 -1。比如，&quot;EF&quot;在&quot;ABCDEF&quot;之中只出现一次，则它的上一次出现位置为-1（即未出现）。</li>
<li>如果&quot;好后缀&quot;有多个，则除了最长的那个&quot;好后缀&quot;，其他&quot;好后缀&quot;的上一次出现位置必须在头部。比如，假定&quot;BABCDAB&quot;的&quot;好后缀&quot;是&quot;DAB&quot;、&quot;AB&quot;、&quot;B&quot;，请问这时&quot;好后缀&quot;的上一次出现位置是什么？回答是，此时采用的好后缀是&quot;B&quot;，它的上一次出现位置是头部，即第0位。这个规则也可以这样表达：如果最长的那个&quot;好后缀&quot;只出现一次，则可以把搜索词改写成如下形式进行位置计算&quot;(DA)BABCDAB&quot;，即虚拟加入最前面的&quot;DA&quot;。</li>
</ul>
<p>回到上文的这个例子。此时，所有的&quot;好后缀&quot;（MPLE、PLE、LE、E）之中，只有&quot;E&quot;在&quot;EXAMPLE&quot;还出现在头部，所以后移 6 - 0 = 6位。</p>
<h3 id="_3、代码实现-1" tabindex="-1"><a class="header-anchor" href="#_3、代码实现-1"><span>3、代码实现</span></a></h3>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">BM</span> <span class="token punctuation">{</span>
    <span class="token comment">// BM算法匹配字符串，匹配成功返回P在S中的首字符下标，匹配失败返回-1</span>
    <span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token keyword">int</span> <span class="token function">indexOf</span><span class="token punctuation">(</span><span class="token class-name">String</span> source<span class="token punctuation">,</span> <span class="token class-name">String</span> pattern<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> src <span class="token operator">=</span> source<span class="token punctuation">.</span><span class="token function">toCharArray</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> ptn <span class="token operator">=</span> pattern<span class="token punctuation">.</span><span class="token function">toCharArray</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">int</span> sLen <span class="token operator">=</span> src<span class="token punctuation">.</span>length<span class="token punctuation">;</span>
        <span class="token keyword">int</span> pLen <span class="token operator">=</span> ptn<span class="token punctuation">.</span>length<span class="token punctuation">;</span>

        <span class="token comment">// 模式串为空字符串，返回0</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>pLen <span class="token operator">==</span> <span class="token number">0</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">return</span> <span class="token number">0</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>
        <span class="token comment">// 主串长度小于模式串长度，返回-1</span>
        <span class="token keyword">if</span> <span class="token punctuation">(</span>sLen <span class="token operator">&lt;</span> pLen<span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token constant">BC</span> <span class="token operator">=</span> <span class="token function">buildBadCharacter</span><span class="token punctuation">(</span>ptn<span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token constant">GS</span> <span class="token operator">=</span> <span class="token function">buildGoodSuffix</span><span class="token punctuation">(</span>ptn<span class="token punctuation">)</span><span class="token punctuation">;</span>

        <span class="token comment">// 从尾部开始匹配，其中i指向主串，j指向模式串</span>
        <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span> i <span class="token operator">&lt;</span> sLen<span class="token punctuation">;</span> <span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">int</span> j <span class="token operator">=</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span>
            <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token punctuation">;</span> src<span class="token punctuation">[</span>i<span class="token punctuation">]</span> <span class="token operator">==</span> ptn<span class="token punctuation">[</span>j<span class="token punctuation">]</span><span class="token punctuation">;</span> i<span class="token operator">--</span><span class="token punctuation">,</span> j<span class="token operator">--</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
                <span class="token keyword">if</span> <span class="token punctuation">(</span>j <span class="token operator">==</span> <span class="token number">0</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>   <span class="token comment">// 匹配成功返回首字符下标</span>
                    <span class="token keyword">return</span> i<span class="token punctuation">;</span>
                <span class="token punctuation">}</span>
            <span class="token punctuation">}</span>

            <span class="token comment">// 每次后移“坏字符规则”和“好后缀规则”两者的较大值</span>
            <span class="token comment">// 注意此时i（坏字符）已经向前移动，所以并非真正意义上的规则</span>
            i <span class="token operator">+=</span> <span class="token class-name">Math</span><span class="token punctuation">.</span><span class="token function">max</span><span class="token punctuation">(</span><span class="token constant">BC</span><span class="token punctuation">[</span>src<span class="token punctuation">[</span>i<span class="token punctuation">]</span><span class="token punctuation">]</span><span class="token punctuation">,</span> <span class="token constant">GS</span><span class="token punctuation">[</span>pLen <span class="token operator">-</span> <span class="token number">1</span> <span class="token operator">-</span> j<span class="token punctuation">]</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">return</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token comment">// 坏字符规则表</span>
    <span class="token keyword">private</span> <span class="token keyword">static</span> <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token function">buildBadCharacter</span><span class="token punctuation">(</span><span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> pattern<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">int</span> pLen <span class="token operator">=</span> pattern<span class="token punctuation">.</span>length<span class="token punctuation">;</span>
        <span class="token keyword">final</span> <span class="token keyword">int</span> <span class="token constant">CHARACTER_SIZE</span> <span class="token operator">=</span> <span class="token number">256</span><span class="token punctuation">;</span> <span class="token comment">// 英文字符的种类，2^8</span>
        <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token constant">BC</span> <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token constant">CHARACTER_SIZE</span><span class="token punctuation">]</span><span class="token punctuation">;</span> <span class="token comment">// 记录坏字符出现时后移位数</span>

        <span class="token class-name">Arrays</span><span class="token punctuation">.</span><span class="token function">fill</span><span class="token punctuation">(</span><span class="token constant">BC</span><span class="token punctuation">,</span> pLen<span class="token punctuation">)</span><span class="token punctuation">;</span>  <span class="token comment">// 默认后移整个模式串长度</span>
        <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span> i <span class="token operator">&lt;</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span> i<span class="token operator">++</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">int</span> ascii <span class="token operator">=</span> pattern<span class="token punctuation">[</span>i<span class="token punctuation">]</span><span class="token punctuation">;</span>  <span class="token comment">// 当前字符对应的ASCII值</span>
            <span class="token constant">BC</span><span class="token punctuation">[</span>ascii<span class="token punctuation">]</span> <span class="token operator">=</span> pLen <span class="token operator">-</span> <span class="token number">1</span> <span class="token operator">-</span> i<span class="token punctuation">;</span>   <span class="token comment">// 对应的后移位数，若重复则以最右边为准</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">return</span> <span class="token constant">BC</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token comment">// 非真正意义上的好字符规则表，后移位数还加上了当前好后缀的最大长度</span>
    <span class="token keyword">private</span> <span class="token keyword">static</span> <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token function">buildGoodSuffix</span><span class="token punctuation">(</span><span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> pattern<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">int</span> pLen <span class="token operator">=</span> pattern<span class="token punctuation">.</span>length<span class="token punctuation">;</span>
        <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span> <span class="token constant">GS</span> <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token keyword">int</span><span class="token punctuation">[</span>pLen<span class="token punctuation">]</span><span class="token punctuation">;</span>   <span class="token comment">// 记录好后缀出现时后移位数</span>
        <span class="token keyword">int</span> lastPrefixPos <span class="token operator">=</span> pLen<span class="token punctuation">;</span>   <span class="token comment">// 好后缀的首字符位置</span>

        <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span> i <span class="token operator">>=</span> <span class="token number">0</span><span class="token punctuation">;</span> i<span class="token operator">--</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token comment">// 判断当前位置（不含）之后是否是好后缀，空字符也是好后缀</span>
            <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">isPrefix</span><span class="token punctuation">(</span>pattern<span class="token punctuation">,</span> i <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
                lastPrefixPos <span class="token operator">=</span> i <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span>
            <span class="token comment">// 如果是好后缀，则GS=pLen，否则依次为pLen+1、pLen+2、...</span>
            <span class="token constant">GS</span><span class="token punctuation">[</span>pLen <span class="token operator">-</span> <span class="token number">1</span> <span class="token operator">-</span> i<span class="token punctuation">]</span> <span class="token operator">=</span> lastPrefixPos <span class="token operator">-</span> i <span class="token operator">+</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

        <span class="token comment">// 上面在比较好后缀时，是从模式串的首字符开始的，但实际上好后缀可能出现在模式串中间。</span>
        <span class="token comment">// 比如模式串EXAMPXA，假设主串指针在比较P时发现是坏字符，那么XA就是好后缀，</span>
        <span class="token comment">// 虽然它的首字符X与模式串的首字符E并不相等。此时suffixLen=2表示将主串指针后移至模式串末尾，</span>
        <span class="token comment">// pLen-1-i=4表示真正的好字符规则，同样主串指针后移，使得模式串前面的XA对齐主串的XA</span>
        <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span> i <span class="token operator">&lt;</span> pLen <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span> i<span class="token operator">++</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">int</span> suffixLen <span class="token operator">=</span> <span class="token function">suffixLength</span><span class="token punctuation">(</span>pattern<span class="token punctuation">,</span> i<span class="token punctuation">)</span><span class="token punctuation">;</span>
            <span class="token constant">GS</span><span class="token punctuation">[</span>suffixLen<span class="token punctuation">]</span> <span class="token operator">=</span> pLen <span class="token operator">-</span> <span class="token number">1</span> <span class="token operator">-</span> i <span class="token operator">+</span> suffixLen<span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">return</span> <span class="token constant">GS</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token comment">// 判断是否是好后缀，即模式串begin（含）之后的子串是否匹配模式串的前缀</span>
    <span class="token keyword">private</span> <span class="token keyword">static</span> <span class="token keyword">boolean</span> <span class="token function">isPrefix</span><span class="token punctuation">(</span><span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> pattern<span class="token punctuation">,</span> <span class="token keyword">int</span> begin<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token keyword">int</span> i <span class="token operator">=</span> begin<span class="token punctuation">,</span> j <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span> i <span class="token operator">&lt;</span> pattern<span class="token punctuation">.</span>length<span class="token punctuation">;</span> i<span class="token operator">++</span><span class="token punctuation">,</span> j<span class="token operator">++</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            <span class="token keyword">if</span> <span class="token punctuation">(</span>pattern<span class="token punctuation">[</span>i<span class="token punctuation">]</span> <span class="token operator">!=</span> pattern<span class="token punctuation">[</span>j<span class="token punctuation">]</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
                <span class="token keyword">return</span> <span class="token boolean">false</span><span class="token punctuation">;</span>
            <span class="token punctuation">}</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">return</span> <span class="token boolean">true</span><span class="token punctuation">;</span>
    <span class="token punctuation">}</span>

    <span class="token comment">// 返回模式串中以pattern[begin]（含）结尾的后缀子串的最大长度</span>
    <span class="token keyword">private</span> <span class="token keyword">static</span> <span class="token keyword">int</span> <span class="token function">suffixLength</span><span class="token punctuation">(</span><span class="token keyword">char</span><span class="token punctuation">[</span><span class="token punctuation">]</span> pattern<span class="token punctuation">,</span> <span class="token keyword">int</span> begin<span class="token punctuation">)</span> <span class="token punctuation">{</span>
        <span class="token keyword">int</span> suffixLen <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span>

        <span class="token keyword">int</span> i <span class="token operator">=</span> begin<span class="token punctuation">;</span>
        <span class="token keyword">int</span> j <span class="token operator">=</span> pattern<span class="token punctuation">.</span>length <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">;</span>
        <span class="token keyword">while</span> <span class="token punctuation">(</span>i <span class="token operator">>=</span> <span class="token number">0</span> <span class="token operator">&amp;&amp;</span> pattern<span class="token punctuation">[</span>i<span class="token punctuation">]</span> <span class="token operator">==</span> pattern<span class="token punctuation">[</span>j<span class="token punctuation">]</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
            suffixLen<span class="token operator">++</span><span class="token punctuation">;</span>
            i<span class="token operator">--</span><span class="token punctuation">;</span>
            j<span class="token operator">--</span><span class="token punctuation">;</span>
        <span class="token punctuation">}</span>

        <span class="token keyword">return</span> suffixLen<span class="token punctuation">;</span>
    <span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="参考" tabindex="-1"><a class="header-anchor" href="#参考"><span>参考</span></a></h2>
<p>[1] <a href="https://blog.csdn.net/yzhcjl_/article/details/127728717" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/yzhcjl_/article/details/127728717</a></p>
<p>[2] <a href="https://blog.csdn.net/baidu_39502694/article/details/106475463" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/baidu_39502694/article/details/106475463</a></p>
<p>[3] <a href="https://blog.csdn.net/DBC_121/article/details/105569440" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/DBC_121/article/details/105569440</a></p>
<p>[4] <a href="https://www.ruanyifeng.com/blog/2013/05/boyer-moore_string_search_algorithm.html" target="_blank" rel="noopener noreferrer">https://www.ruanyifeng.com/blog/2013/05/boyer-moore_string_search_algorithm.html</a></p>
</div></template>


