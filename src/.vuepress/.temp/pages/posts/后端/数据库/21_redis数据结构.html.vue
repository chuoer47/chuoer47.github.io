<template><div><!--more-->
<h1 id="redis数据结构" tabindex="-1"><a class="header-anchor" href="#redis数据结构"><span>Redis数据结构</span></a></h1>
<h2 id="一、简单动态字符串" tabindex="-1"><a class="header-anchor" href="#一、简单动态字符串"><span>一、简单动态字符串</span></a></h2>
<p>Redis中保存的Key是字符串，value往往是字符串或者字符串的集合。可见字符串是Redis中最常用的一种数据结构。不过Redis没有直接使用C语言中的字符串，而只会<strong>使用C字符串作为字面量</strong>,因为C语言字符串存在很多问题：</p>
<ul>
<li>获取字符串长度的需要通过运算</li>
<li>非二进制安全</li>
<li>不可修改</li>
</ul>
<p>Redis构建了一种新的字符串结构，称为<strong>简单动态字符串（Simple Dynamic String），简称SDS</strong>。</p>
<p>Redis是C语言实现的，其中SDS是一个结构体，源码如下：</p>
<div class="language-c line-numbers-mode" data-ext="c" data-title="c"><pre v-pre class="language-c"><code><span class="token keyword">struct</span> <span class="token class-name">sdshdr</span><span class="token punctuation">{</span>
  <span class="token comment">//记录buf数组中已使用的字节的数量</span>
  <span class="token comment">//等于SDS所保存字符串的长度</span>
  <span class="token keyword">int</span> len<span class="token punctuation">;</span>
  
  <span class="token comment">//记录buf数组中未使用的字节的数量</span>
  <span class="token keyword">int</span> free<span class="token punctuation">;</span>
  
  <span class="token comment">//字节数组,用于保存字符串</span>
  <span class="token keyword">char</span> buf<span class="token punctuation">[</span><span class="token punctuation">]</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><center><img src="/image/redis/redis1.png"  style="zoom:50%;" /></center>
<ul>
<li>len：记录buf数组中已使用字节数，等于SDS保存字符串的长度</li>
<li>free：记录buf数组中未使用字节数</li>
<li>buf：字节数组用于保存字符串</li>
</ul>
<div class="hint-container tip">
<p class="hint-container-title">SDS与C字符串的区别</p>
<ul>
<li>1、<strong>常数复杂度获取字符串长度</strong>: SDS额外记录了字符串长度，因此获取字符串长度的复杂度由O(n)缩小为O(1)</li>
<li>2、<strong>杜绝缓冲区溢出</strong>: 存储数据的buf数组实现了内存自动重分配，杜绝了缓冲区溢出</li>
<li>3、<strong>减少修改字符串时带来的内存重分配次数</strong>
<ul>
<li><strong>空间预分配</strong>：对SDS修改需要扩展空间时，Redis会为SDS分配额外空间
<ul>
<li>如果修改后len &lt; 1MB，则额外分配len长度的free空间，即len=free</li>
<li>如果修改后len &gt; 1MB，则额外分配1MB的free空间</li>
</ul>
</li>
<li><strong>惰性空间释放</strong>：SDS需要缩短字符串时，并不立即回收多余空间，而是先记录到free字段中，等有需要时再真正释放。减少了耗时的重分配操作</li>
</ul>
</li>
<li>4、<strong>二进制安全</strong>: Redis使用len标记字符串长度，而不是根据空字符，因此可以保存任意格式二进制数据</li>
<li>5、<strong>兼容部分C字符串</strong>: 在存储上仍然在字符末尾加上<code v-pre>\0</code>空字符，可以兼容部分C字符串函数</li>
</ul>
</div>
<h2 id="二、链表" tabindex="-1"><a class="header-anchor" href="#二、链表"><span>二、链表</span></a></h2>
<p>链表在Redis中使用非常广泛,比如列表键的底层实现之一就是链表,除此之外,发布与订阅,慢查询,监视器等功能也用到了链表,Redis服务器本身还使用链表来保存多个客户端的状态信息,以及使用链表来构建客户端输出缓冲区(output buffer).</p>
<p><strong>链表和链表节点的实现:</strong></p>
<div class="language-c line-numbers-mode" data-ext="c" data-title="c"><pre v-pre class="language-c"><code><span class="token comment">//链表节点</span>
<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">listNode</span><span class="token punctuation">{</span>
  <span class="token comment">//前置节点</span>
  <span class="token keyword">struct</span> <span class="token class-name">listNode</span> <span class="token operator">*</span>prev<span class="token punctuation">;</span>
  
  <span class="token comment">//后置节点</span>
  <span class="token keyword">struct</span> <span class="token class-name">listNode</span> <span class="token operator">*</span>next<span class="token punctuation">;</span>
  
  <span class="token comment">//节点的值</span>
  <span class="token keyword">void</span> <span class="token operator">*</span>value<span class="token punctuation">;</span>
<span class="token punctuation">}</span>listNode<span class="token punctuation">;</span>

<span class="token comment">//链表</span>
<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">list</span><span class="token punctuation">{</span>
  <span class="token comment">//表头节点</span>
  listNode <span class="token operator">*</span>head<span class="token punctuation">;</span>
  <span class="token comment">//末尾节点</span>
  listNode <span class="token operator">*</span>tail<span class="token punctuation">;</span>
  <span class="token comment">//链表所包含的节点数量</span>
  <span class="token keyword">unsigned</span> <span class="token keyword">long</span> len<span class="token punctuation">;</span>
  <span class="token comment">//节点值复制函数</span>
  <span class="token keyword">void</span> <span class="token operator">*</span><span class="token punctuation">(</span><span class="token operator">*</span>dup<span class="token punctuation">)</span><span class="token punctuation">(</span><span class="token keyword">void</span> <span class="token operator">*</span>ptr<span class="token punctuation">)</span><span class="token punctuation">;</span>
  <span class="token comment">//节点值释放函数</span>
  <span class="token keyword">void</span> <span class="token punctuation">(</span><span class="token operator">*</span>free<span class="token punctuation">)</span><span class="token punctuation">(</span><span class="token keyword">void</span> <span class="token operator">*</span>ptr<span class="token punctuation">)</span><span class="token punctuation">;</span>
  <span class="token comment">//节点值对比函数</span>
  <span class="token keyword">int</span> <span class="token punctuation">(</span><span class="token operator">*</span>match<span class="token punctuation">)</span><span class="token punctuation">(</span><span class="token keyword">void</span> <span class="token operator">*</span>ptr<span class="token punctuation">,</span> <span class="token keyword">void</span> <span class="token operator">*</span>key<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>list<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>dup、free 和 match 成员是用于实现多态链表所需的类型特定函数
<ul>
<li>dup 函数用于复制链表节点所保存的值</li>
<li>free 函数用于释放链表节点所保存的值</li>
<li>match 函数用于对比链表节点所保存的值和另一个输入值是否相等</li>
</ul>
</li>
</ul>
<p>下图是由一个list结构和三个listNode结构组成的链表</p>
<center><img src="/image/redis/redis2.png"  style="zoom:50%;" /></center>
<p><strong>特性:</strong></p>
<ul>
<li>双端、无环、带表头表尾指针、带长度计数器</li>
<li>支持多态，dup、free、match三个void*指针字段可以设置特殊类型函数，用于保存不同类型的值。</li>
</ul>
<h2 id="三、字典" tabindex="-1"><a class="header-anchor" href="#三、字典"><span>三、字典</span></a></h2>
<h3 id="_1、实现" tabindex="-1"><a class="header-anchor" href="#_1、实现"><span>1、实现</span></a></h3>
<p>Redis的字典使用哈希表作为底层实现,一个哈希表里面可以有多个哈希表节点,而每个哈希表节点就保存来字典中的一个键值对.</p>
<div class="language-c line-numbers-mode" data-ext="c" data-title="c"><pre v-pre class="language-c"><code><span class="token comment">//哈希表</span>
<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">dictht</span><span class="token punctuation">{</span>
  <span class="token comment">//哈希表数组</span>
  dictEntry <span class="token operator">*</span><span class="token operator">*</span>table<span class="token punctuation">;</span>
  <span class="token comment">//哈希表大小</span>
  <span class="token keyword">unsigned</span> <span class="token keyword">long</span> size<span class="token punctuation">;</span>
  <span class="token comment">//哈希表大小掩码,用于计算索引值</span>
  <span class="token comment">//总是等于size-1</span>
  <span class="token keyword">unsigned</span> <span class="token keyword">long</span> sizemask<span class="token punctuation">;</span>
  <span class="token comment">//该哈希表已有节点数量</span>
  <span class="token keyword">unsigned</span> <span class="token keyword">long</span> used<span class="token punctuation">;</span>
<span class="token punctuation">}</span>dictht<span class="token punctuation">;</span>

<span class="token comment">//哈希表节点</span>
<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">dictEntry</span><span class="token punctuation">{</span>
  <span class="token comment">//键</span>
  <span class="token keyword">void</span> <span class="token operator">*</span>key<span class="token punctuation">;</span>
  <span class="token comment">//值</span>
  <span class="token keyword">union</span><span class="token punctuation">{</span>
    <span class="token keyword">void</span> <span class="token operator">*</span>val<span class="token punctuation">;</span>
    <span class="token class-name">unint64_t</span> u64<span class="token punctuation">;</span>
    <span class="token class-name">int64_t</span> s64<span class="token punctuation">;</span>
  <span class="token punctuation">}</span>
  <span class="token comment">//指向下一个哈希表节点,形成链表</span>
  <span class="token keyword">struct</span> <span class="token class-name">dictEntry</span> <span class="token operator">*</span>next<span class="token punctuation">;</span>
<span class="token punctuation">}</span>dictEntry<span class="token punctuation">;</span>

<span class="token comment">//字典</span>
<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">dict</span><span class="token punctuation">{</span>
  <span class="token comment">//类型特定函数</span>
  dictType <span class="token operator">*</span>type<span class="token punctuation">;</span>
  <span class="token comment">//私有数据</span>
  <span class="token keyword">void</span> <span class="token operator">*</span>privdata<span class="token punctuation">;</span>
  <span class="token comment">//哈希表</span>
  dictht ht<span class="token punctuation">[</span><span class="token number">2</span><span class="token punctuation">]</span><span class="token punctuation">;</span>
  <span class="token comment">//rehash索引</span>
  <span class="token comment">//当rehash不在进行时,值为-1</span>
  <span class="token keyword">int</span> trehashidx<span class="token punctuation">;</span>
<span class="token punctuation">}</span>dict<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><center><img src="/image/redis/redis3.png"  style="zoom:50%;" /></center>
<ul>
<li>哈希表结点 - dictEntry
<ul>
<li>key-value结构，其中value可以是指针、uint64_t、int64_t</li>
<li>next：指向同索引的下一个结点（链地址法解决哈希冲突）</li>
</ul>
</li>
<li>哈希表- dictht
<ul>
<li>table：数组，存储哈希表节点指针</li>
<li>size：记录表的大小</li>
<li>sizemask：用于和哈希值计算应该放置的索引</li>
<li>used：已有的结点数量</li>
</ul>
</li>
<li>字典 - dict
<ul>
<li>dictType：存储类型特定函数，用于实现多态</li>
<li>privdata：保存类型特定函数所需参数</li>
<li>ht：两个哈希表的数组，一般只使用ht[0]，ht[1]用于Rehash</li>
<li>rehashidx：是否在Rehash，不是则置-1</li>
</ul>
</li>
</ul>
<h3 id="_2、哈希算法" tabindex="-1"><a class="header-anchor" href="#_2、哈希算法"><span>2、哈希算法</span></a></h3>
<p>当要将一个新的键值对添加到字典里面时,程序需要先根据键值对的键计算出哈希值和索引值,然后根据索引值,将包含新键值对的哈希表节点放到哈希表数组的指定索引上面.</p>
<div class="language-c line-numbers-mode" data-ext="c" data-title="c"><pre v-pre class="language-c"><code><span class="token comment">// 使用字典设置的哈希函数,计算键key的哈希值</span>
hash <span class="token operator">=</span> dict<span class="token operator">-></span>type<span class="token operator">-></span><span class="token function">hashFunction</span><span class="token punctuation">(</span>key<span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token comment">//使用哈希表的sizemask属性和哈希值,计算出索引</span>
<span class="token comment">//根据情况不同,ht[x]可以是ht[0]或者ht[1]</span>
index <span class="token operator">=</span> hash <span class="token operator">&amp;</span> dict<span class="token operator">-></span>ht<span class="token punctuation">[</span>x<span class="token punctuation">]</span><span class="token punctuation">.</span>sizemask
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>Redis使用<code v-pre>MurmurHash2</code>算法，具有很好的随机分布性和计算速度</p>
<ul>
<li>链地址法解决哈希冲突，且新节点总是添加到链表的表头以加快速度</li>
<li>Rehash：哈希结点过多或过少时，需要调整哈希表的大小
<ul>
<li>调整条件：
<ul>
<li>扩展：服务器目前没有在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于1。</li>
<li>扩展：服务器目前正在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于5。</li>
<li>收缩：服务器目前正在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于5。</li>
</ul>
</li>
<li>调整大小：
<ul>
<li>如果是扩展，那么ht[1]的大小为第一个<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="23.19ex" height="2.262ex" role="img" focusable="false" viewBox="0 -750 10250.2 1000" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3E" d="M84 520Q84 528 88 533T96 539L99 540Q106 540 253 471T544 334L687 265Q694 260 694 250T687 235Q685 233 395 96L107 -40H101Q83 -38 83 -20Q83 -19 83 -17Q82 -10 98 -1Q117 9 248 71Q326 108 378 132L626 250L378 368Q90 504 86 509Q84 513 84 520Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mi" transform="translate(1833.8,0)"><path data-c="210E" d="M137 683Q138 683 209 688T282 694Q294 694 294 685Q294 674 258 534Q220 386 220 383Q220 381 227 388Q288 442 357 442Q411 442 444 415T478 336Q478 285 440 178T402 50Q403 36 407 31T422 26Q450 26 474 56T513 138Q516 149 519 151T535 153Q555 153 555 145Q555 144 551 130Q535 71 500 33Q466 -10 419 -10H414Q367 -10 346 17T325 74Q325 90 361 192T398 345Q398 404 354 404H349Q266 404 205 306L198 293L164 158Q132 28 127 16Q114 -11 83 -11Q69 -11 59 -2T48 16Q48 30 121 320L195 616Q195 629 188 632T149 637H128Q122 643 122 645T124 664Q129 683 137 683Z"></path></g><g data-mml-node="mi" transform="translate(2409.8,0)"><path data-c="1D461" d="M26 385Q19 392 19 395Q19 399 22 411T27 425Q29 430 36 430T87 431H140L159 511Q162 522 166 540T173 566T179 586T187 603T197 615T211 624T229 626Q247 625 254 615T261 596Q261 589 252 549T232 470L222 433Q222 431 272 431H323Q330 424 330 420Q330 398 317 385H210L174 240Q135 80 135 68Q135 26 162 26Q197 26 230 60T283 144Q285 150 288 151T303 153H307Q322 153 322 145Q322 142 319 133Q314 117 301 95T267 48T216 6T155 -11Q125 -11 98 4T59 56Q57 64 57 83V101L92 241Q127 382 128 383Q128 385 77 385H26Z"></path></g><g data-mml-node="mo" transform="translate(2770.8,0)"><path data-c="5B" d="M118 -250V750H255V710H158V-210H255V-250H118Z"></path></g><g data-mml-node="mn" transform="translate(3048.8,0)"><path data-c="30" d="M96 585Q152 666 249 666Q297 666 345 640T423 548Q460 465 460 320Q460 165 417 83Q397 41 362 16T301 -15T250 -22Q224 -22 198 -16T137 16T82 83Q39 165 39 320Q39 494 96 585ZM321 597Q291 629 250 629Q208 629 178 597Q153 571 145 525T137 333Q137 175 145 125T181 46Q209 16 250 16Q290 16 318 46Q347 76 354 130T362 333Q362 478 354 524T321 597Z"></path></g><g data-mml-node="mo" transform="translate(3548.8,0)"><path data-c="5D" d="M22 710V750H159V-250H22V-210H119V710H22Z"></path></g><g data-mml-node="mo" transform="translate(3826.8,0)"><path data-c="2E" d="M78 60Q78 84 95 102T138 120Q162 120 180 104T199 61Q199 36 182 18T139 0T96 17T78 60Z"></path></g><g data-mml-node="mi" transform="translate(4271.4,0)"><path data-c="1D462" d="M21 287Q21 295 30 318T55 370T99 420T158 442Q204 442 227 417T250 358Q250 340 216 246T182 105Q182 62 196 45T238 27T291 44T328 78L339 95Q341 99 377 247Q407 367 413 387T427 416Q444 431 463 431Q480 431 488 421T496 402L420 84Q419 79 419 68Q419 43 426 35T447 26Q469 29 482 57T512 145Q514 153 532 153Q551 153 551 144Q550 139 549 130T540 98T523 55T498 17T462 -8Q454 -10 438 -10Q372 -10 347 46Q345 45 336 36T318 21T296 6T267 -6T233 -11Q189 -11 155 7Q103 38 103 113Q103 170 138 262T173 379Q173 380 173 381Q173 390 173 393T169 400T158 404H154Q131 404 112 385T82 344T65 302T57 280Q55 278 41 278H27Q21 284 21 287Z"></path></g><g data-mml-node="mi" transform="translate(4843.4,0)"><path data-c="1D460" d="M131 289Q131 321 147 354T203 415T300 442Q362 442 390 415T419 355Q419 323 402 308T364 292Q351 292 340 300T328 326Q328 342 337 354T354 372T367 378Q368 378 368 379Q368 382 361 388T336 399T297 405Q249 405 227 379T204 326Q204 301 223 291T278 274T330 259Q396 230 396 163Q396 135 385 107T352 51T289 7T195 -10Q118 -10 86 19T53 87Q53 126 74 143T118 160Q133 160 146 151T160 120Q160 94 142 76T111 58Q109 57 108 57T107 55Q108 52 115 47T146 34T201 27Q237 27 263 38T301 66T318 97T323 122Q323 150 302 164T254 181T195 196T148 231Q131 256 131 289Z"></path></g><g data-mml-node="mi" transform="translate(5312.4,0)"><path data-c="1D452" d="M39 168Q39 225 58 272T107 350T174 402T244 433T307 442H310Q355 442 388 420T421 355Q421 265 310 237Q261 224 176 223Q139 223 138 221Q138 219 132 186T125 128Q125 81 146 54T209 26T302 45T394 111Q403 121 406 121Q410 121 419 112T429 98T420 82T390 55T344 24T281 -1T205 -11Q126 -11 83 42T39 168ZM373 353Q367 405 305 405Q272 405 244 391T199 357T170 316T154 280T149 261Q149 260 169 260Q282 260 327 284T373 353Z"></path></g><g data-mml-node="mi" transform="translate(5778.4,0)"><path data-c="1D451" d="M366 683Q367 683 438 688T511 694Q523 694 523 686Q523 679 450 384T375 83T374 68Q374 26 402 26Q411 27 422 35Q443 55 463 131Q469 151 473 152Q475 153 483 153H487H491Q506 153 506 145Q506 140 503 129Q490 79 473 48T445 8T417 -8Q409 -10 393 -10Q359 -10 336 5T306 36L300 51Q299 52 296 50Q294 48 292 46Q233 -10 172 -10Q117 -10 75 30T33 157Q33 205 53 255T101 341Q148 398 195 420T280 442Q336 442 364 400Q369 394 369 396Q370 400 396 505T424 616Q424 629 417 632T378 637H357Q351 643 351 645T353 664Q358 683 366 683ZM352 326Q329 405 277 405Q242 405 210 374T160 293Q131 214 119 129Q119 126 119 118T118 106Q118 61 136 44T179 26Q233 26 290 98L298 109L352 326Z"></path></g><g data-mml-node="mo" transform="translate(6520.7,0)"><path data-c="2217" d="M229 286Q216 420 216 436Q216 454 240 464Q241 464 245 464T251 465Q263 464 273 456T283 436Q283 419 277 356T270 286L328 328Q384 369 389 372T399 375Q412 375 423 365T435 338Q435 325 425 315Q420 312 357 282T289 250L355 219L425 184Q434 175 434 161Q434 146 425 136T401 125Q393 125 383 131T328 171L270 213Q283 79 283 63Q283 53 276 44T250 35Q231 35 224 44T216 63Q216 80 222 143T229 213L171 171Q115 130 110 127Q106 124 100 124Q87 124 76 134T64 161Q64 166 64 169T67 175T72 181T81 188T94 195T113 204T138 215T170 230T210 250L74 315Q65 324 65 338Q65 353 74 363T98 374Q106 374 116 368T171 328L229 286Z"></path></g><g data-mml-node="mn" transform="translate(7242.9,0)"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="mtext" transform="translate(7742.9,0)"><path data-c="A0" d=""></path></g><g data-mml-node="mtext" transform="translate(7992.9,0)"><text data-variant="normal" transform="scale(1,-1)" font-size="884px" font-family="serif">的</text></g><g data-mml-node="mtext" transform="translate(8992.9,0)"><path data-c="A0" d=""></path></g><g data-mml-node="msup" transform="translate(9242.9,0)"><g data-mml-node="mn"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="mi" transform="translate(533,363) scale(0.707)"><path data-c="1D45B" d="M21 287Q22 293 24 303T36 341T56 388T89 425T135 442Q171 442 195 424T225 390T231 369Q231 367 232 367L243 378Q304 442 382 442Q436 442 469 415T503 336T465 179T427 52Q427 26 444 26Q450 26 453 27Q482 32 505 65T540 145Q542 153 560 153Q580 153 580 145Q580 144 576 130Q568 101 554 73T508 17T439 -10Q392 -10 371 17T350 73Q350 92 386 193T423 345Q423 404 379 404H374Q288 404 229 303L222 291L189 157Q156 26 151 16Q138 -11 108 -11Q95 -11 87 -5T76 7T74 17Q74 30 112 180T152 343Q153 348 153 366Q153 405 129 405Q91 405 66 305Q60 285 60 284Q58 278 41 278H27Q21 284 21 287Z"></path></g></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&gt;=</mo><mi>h</mi><mi>t</mi><mo stretchy="false">[</mo><mn>0</mn><mo stretchy="false">]</mo><mo>.</mo><mi>u</mi><mi>s</mi><mi>e</mi><mi>d</mi><mo>∗</mo><mn>2</mn><mtext> </mtext><mtext>的</mtext><mtext> </mtext><msup><mn>2</mn><mi>n</mi></msup></math></mjx-assistive-mml></mjx-container></li>
<li>如果是收缩，那么ht[1]的大小为第一个<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="19.922ex" height="2.262ex" role="img" focusable="false" viewBox="0 -750 8805.7 1000" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3E" d="M84 520Q84 528 88 533T96 539L99 540Q106 540 253 471T544 334L687 265Q694 260 694 250T687 235Q685 233 395 96L107 -40H101Q83 -38 83 -20Q83 -19 83 -17Q82 -10 98 -1Q117 9 248 71Q326 108 378 132L626 250L378 368Q90 504 86 509Q84 513 84 520Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mi" transform="translate(1833.8,0)"><path data-c="210E" d="M137 683Q138 683 209 688T282 694Q294 694 294 685Q294 674 258 534Q220 386 220 383Q220 381 227 388Q288 442 357 442Q411 442 444 415T478 336Q478 285 440 178T402 50Q403 36 407 31T422 26Q450 26 474 56T513 138Q516 149 519 151T535 153Q555 153 555 145Q555 144 551 130Q535 71 500 33Q466 -10 419 -10H414Q367 -10 346 17T325 74Q325 90 361 192T398 345Q398 404 354 404H349Q266 404 205 306L198 293L164 158Q132 28 127 16Q114 -11 83 -11Q69 -11 59 -2T48 16Q48 30 121 320L195 616Q195 629 188 632T149 637H128Q122 643 122 645T124 664Q129 683 137 683Z"></path></g><g data-mml-node="mi" transform="translate(2409.8,0)"><path data-c="1D461" d="M26 385Q19 392 19 395Q19 399 22 411T27 425Q29 430 36 430T87 431H140L159 511Q162 522 166 540T173 566T179 586T187 603T197 615T211 624T229 626Q247 625 254 615T261 596Q261 589 252 549T232 470L222 433Q222 431 272 431H323Q330 424 330 420Q330 398 317 385H210L174 240Q135 80 135 68Q135 26 162 26Q197 26 230 60T283 144Q285 150 288 151T303 153H307Q322 153 322 145Q322 142 319 133Q314 117 301 95T267 48T216 6T155 -11Q125 -11 98 4T59 56Q57 64 57 83V101L92 241Q127 382 128 383Q128 385 77 385H26Z"></path></g><g data-mml-node="mo" transform="translate(2770.8,0)"><path data-c="5B" d="M118 -250V750H255V710H158V-210H255V-250H118Z"></path></g><g data-mml-node="mn" transform="translate(3048.8,0)"><path data-c="30" d="M96 585Q152 666 249 666Q297 666 345 640T423 548Q460 465 460 320Q460 165 417 83Q397 41 362 16T301 -15T250 -22Q224 -22 198 -16T137 16T82 83Q39 165 39 320Q39 494 96 585ZM321 597Q291 629 250 629Q208 629 178 597Q153 571 145 525T137 333Q137 175 145 125T181 46Q209 16 250 16Q290 16 318 46Q347 76 354 130T362 333Q362 478 354 524T321 597Z"></path></g><g data-mml-node="mo" transform="translate(3548.8,0)"><path data-c="5D" d="M22 710V750H159V-250H22V-210H119V710H22Z"></path></g><g data-mml-node="mo" transform="translate(3826.8,0)"><path data-c="2E" d="M78 60Q78 84 95 102T138 120Q162 120 180 104T199 61Q199 36 182 18T139 0T96 17T78 60Z"></path></g><g data-mml-node="mi" transform="translate(4271.4,0)"><path data-c="1D462" d="M21 287Q21 295 30 318T55 370T99 420T158 442Q204 442 227 417T250 358Q250 340 216 246T182 105Q182 62 196 45T238 27T291 44T328 78L339 95Q341 99 377 247Q407 367 413 387T427 416Q444 431 463 431Q480 431 488 421T496 402L420 84Q419 79 419 68Q419 43 426 35T447 26Q469 29 482 57T512 145Q514 153 532 153Q551 153 551 144Q550 139 549 130T540 98T523 55T498 17T462 -8Q454 -10 438 -10Q372 -10 347 46Q345 45 336 36T318 21T296 6T267 -6T233 -11Q189 -11 155 7Q103 38 103 113Q103 170 138 262T173 379Q173 380 173 381Q173 390 173 393T169 400T158 404H154Q131 404 112 385T82 344T65 302T57 280Q55 278 41 278H27Q21 284 21 287Z"></path></g><g data-mml-node="mi" transform="translate(4843.4,0)"><path data-c="1D460" d="M131 289Q131 321 147 354T203 415T300 442Q362 442 390 415T419 355Q419 323 402 308T364 292Q351 292 340 300T328 326Q328 342 337 354T354 372T367 378Q368 378 368 379Q368 382 361 388T336 399T297 405Q249 405 227 379T204 326Q204 301 223 291T278 274T330 259Q396 230 396 163Q396 135 385 107T352 51T289 7T195 -10Q118 -10 86 19T53 87Q53 126 74 143T118 160Q133 160 146 151T160 120Q160 94 142 76T111 58Q109 57 108 57T107 55Q108 52 115 47T146 34T201 27Q237 27 263 38T301 66T318 97T323 122Q323 150 302 164T254 181T195 196T148 231Q131 256 131 289Z"></path></g><g data-mml-node="mi" transform="translate(5312.4,0)"><path data-c="1D452" d="M39 168Q39 225 58 272T107 350T174 402T244 433T307 442H310Q355 442 388 420T421 355Q421 265 310 237Q261 224 176 223Q139 223 138 221Q138 219 132 186T125 128Q125 81 146 54T209 26T302 45T394 111Q403 121 406 121Q410 121 419 112T429 98T420 82T390 55T344 24T281 -1T205 -11Q126 -11 83 42T39 168ZM373 353Q367 405 305 405Q272 405 244 391T199 357T170 316T154 280T149 261Q149 260 169 260Q282 260 327 284T373 353Z"></path></g><g data-mml-node="mi" transform="translate(5778.4,0)"><path data-c="1D451" d="M366 683Q367 683 438 688T511 694Q523 694 523 686Q523 679 450 384T375 83T374 68Q374 26 402 26Q411 27 422 35Q443 55 463 131Q469 151 473 152Q475 153 483 153H487H491Q506 153 506 145Q506 140 503 129Q490 79 473 48T445 8T417 -8Q409 -10 393 -10Q359 -10 336 5T306 36L300 51Q299 52 296 50Q294 48 292 46Q233 -10 172 -10Q117 -10 75 30T33 157Q33 205 53 255T101 341Q148 398 195 420T280 442Q336 442 364 400Q369 394 369 396Q370 400 396 505T424 616Q424 629 417 632T378 637H357Q351 643 351 645T353 664Q358 683 366 683ZM352 326Q329 405 277 405Q242 405 210 374T160 293Q131 214 119 129Q119 126 119 118T118 106Q118 61 136 44T179 26Q233 26 290 98L298 109L352 326Z"></path></g><g data-mml-node="mtext" transform="translate(6298.4,0)"><path data-c="A0" d=""></path></g><g data-mml-node="mtext" transform="translate(6548.4,0)"><text data-variant="normal" transform="scale(1,-1)" font-size="884px" font-family="serif">的</text></g><g data-mml-node="mtext" transform="translate(7548.4,0)"><path data-c="A0" d=""></path></g><g data-mml-node="msup" transform="translate(7798.4,0)"><g data-mml-node="mn"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="mi" transform="translate(533,363) scale(0.707)"><path data-c="1D45B" d="M21 287Q22 293 24 303T36 341T56 388T89 425T135 442Q171 442 195 424T225 390T231 369Q231 367 232 367L243 378Q304 442 382 442Q436 442 469 415T503 336T465 179T427 52Q427 26 444 26Q450 26 453 27Q482 32 505 65T540 145Q542 153 560 153Q580 153 580 145Q580 144 576 130Q568 101 554 73T508 17T439 -10Q392 -10 371 17T350 73Q350 92 386 193T423 345Q423 404 379 404H374Q288 404 229 303L222 291L189 157Q156 26 151 16Q138 -11 108 -11Q95 -11 87 -5T76 7T74 17Q74 30 112 180T152 343Q153 348 153 366Q153 405 129 405Q91 405 66 305Q60 285 60 284Q58 278 41 278H27Q21 284 21 287Z"></path></g></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&gt;=</mo><mi>h</mi><mi>t</mi><mo stretchy="false">[</mo><mn>0</mn><mo stretchy="false">]</mo><mo>.</mo><mi>u</mi><mi>s</mi><mi>e</mi><mi>d</mi><mtext> </mtext><mtext>的</mtext><mtext> </mtext><msup><mn>2</mn><mi>n</mi></msup></math></mjx-assistive-mml></mjx-container></li>
</ul>
</li>
<li>调整步骤：
<ul>
<li>
<ol>
<li>为ht[1]分配空间，大小计算如上</li>
</ol>
</li>
<li>
<ol>
<li>将ht[0]中的所有键值对重新计算哈希值和索引值，放入ht[1]</li>
</ol>
</li>
<li>
<ol>
<li>迁移完成后，释放ht[0]，将ht[1]设置为ht[0]，并为ht[1]创建新的空白哈希表，为下一次rehash做准备</li>
</ol>
</li>
</ul>
</li>
</ul>
</li>
<li>渐进式Rehash：为了避免一次性大量rehash对服务器性能造成影响，需要分多次、渐进rehash。
<ul>
<li>渐进方式：
<ul>
<li>
<ol>
<li>为ht[1]分配空间，让字典同时持有ht[0]和ht[1]两个哈希表。</li>
</ol>
</li>
<li>
<ol>
<li>维护索引计数器变量<code v-pre>rehashidx</code>置0，表示rehash开始。</li>
</ol>
</li>
<li>
<ol>
<li>rehash开始后，每次对字典执行添加、删除、查找或更新操作时，程序除了执行指定操作外，还会顺带将ht[0]哈希表在rehashidx索引上的所有键值对rehash到ht[1]，完成后将rehashidx属性的值增一。</li>
</ol>
</li>
<li>
<ol>
<li>随着字典操作的不断执行，最终ht[0]的所有键值对都会被rehash至ht[1]，这时将rehashidx属性的值置-1，表示rehash操作完成。</li>
</ol>
</li>
</ul>
</li>
<li>rehash期间的查找需要先后在ht[0]、ht[1]中查找</li>
<li>rehash期间的添加一律保存至ht[1]，保证ht[0]键值对只减不增</li>
<li>渐进式采取分而治之的方式，将rehash键值对所需的计算工作均摊到对字典的每个添加、删除、查找和更新操作上，从而避免了集中式rehash而带来的庞大计算量。</li>
</ul>
</li>
</ul>
<h2 id="四、跳跃表" tabindex="-1"><a class="header-anchor" href="#四、跳跃表"><span>四、跳跃表</span></a></h2>
<h3 id="_1、概念" tabindex="-1"><a class="header-anchor" href="#_1、概念"><span>1、概念</span></a></h3>
<ul>
<li>跳表是一种有序数据结构，在每个节点中维持多个指向其它节点的指针，从而快速访问结点。</li>
<li>跳表效率与平衡树相当，且实现简单。</li>
<li>Redis中跳表的作用有两个，一是有序集合的底层实现之一，二是集群节点中用作内部数据结构。</li>
</ul>
<center><img src="/image/redis/redis4.png"  style="zoom:50%;" /></center>
<h3 id="_2、实现" tabindex="-1"><a class="header-anchor" href="#_2、实现"><span>2、实现</span></a></h3>
<center><img src="/image/redis/redis5.png"  style="zoom:50%;" /></center>
<ul>
<li>zskiplist：维护跳表相关信息，提高效率
<ul>
<li>header: 指向跳表表头结点</li>
<li>tail：指向跳表表尾结点</li>
<li>level：跳表结点的最大层数</li>
<li>length：跳表长度，即结点数量</li>
</ul>
</li>
<li>zskiplistNode：跳表结点
<ul>
<li>层：level类型数组，其中每个元素指向其它结点以加快访问。创建新结点时，根据幂次定律随机生成介于1~32之间的值作为结点层数。level类型有两个字段：
<ul>
<li>前进指针：指向下一个结点，可以一次跳过多个结点</li>
<li>跨度：记录两个结点的距离
<ul>
<li>结点跨度越大，逻辑上相距越远</li>
<li>指向NULL的前进指针跨度为0</li>
<li>用于计算排位</li>
</ul>
</li>
</ul>
</li>
<li>后退节点：指向前驱结点，每次只能后退一步</li>
<li>分值：double型浮点数，跳表中的结点按分值从小到大排序</li>
<li>成员：对象指针，指向一个SDS。成员在跳表中唯一，分值相同的结点按成员字典序排序</li>
</ul>
</li>
</ul>
<h2 id="五、整数集合" tabindex="-1"><a class="header-anchor" href="#五、整数集合"><span>五、整数集合</span></a></h2>
<p>整数集合<code v-pre>intset</code>是集合键的底层实现之一，有序且不重复。</p>
<h3 id="_1、实现-1" tabindex="-1"><a class="header-anchor" href="#_1、实现-1"><span>1、实现</span></a></h3>
<center><img src="/image/redis/redis6.png"  style="zoom:50%;" /></center>
<ul>
<li>encoding: 编码方式，包括 uint16_t / uint32_t / uint64_t 三种</li>
<li>length: 元素数量，即contents数组长度</li>
<li>contents：保存元素的数组
<ul>
<li>虽然声明是uint8_t，实际类型取决于encoding</li>
<li>所有元素类型保持一致</li>
<li>元素从小到大，无重复排序</li>
</ul>
</li>
</ul>
<h3 id="_2、升级" tabindex="-1"><a class="header-anchor" href="#_2、升级"><span>2、升级</span></a></h3>
<p>当添加一个新元素时，如果新元素类型比现有的所有元素类型都长，整数集合需要先升级。</p>
<ul>
<li>策略 - 复杂度O(n)：
<ul>
<li>
<ol>
<li>根据新元素类型，扩展整数集合底层数组的空间大小，并为新元素分配空间</li>
</ol>
</li>
<li>
<ol>
<li>将现有的所有元素都转换成与新元素相同的类型，并将类型转换后的元素放置到正确的位上，保持有序</li>
</ol>
</li>
<li>
<ol>
<li>将新元素添加到底层数组里面（新元素要么最大置数组头，要么最小置数组尾）</li>
</ol>
</li>
</ul>
</li>
<li>优点：提升了整数集合的灵活性，也节约了内存</li>
<li>整数集合不支持降级</li>
</ul>
<h2 id="六、压缩列表" tabindex="-1"><a class="header-anchor" href="#六、压缩列表"><span>六、压缩列表</span></a></h2>
<p>压缩列表是列表键和哈希键的底层实现之一.当一个列表键只包含少量列表项,并且每个列表项要么是小整数值,要么是长度比较短的字符串,那么Redis就会使用压缩列表来做列表键的底层实现.</p>
<h3 id="_1、实现-2" tabindex="-1"><a class="header-anchor" href="#_1、实现-2"><span>1、实现</span></a></h3>
<center><img src="/image/redis/redis7.png"  style="zoom:50%;" /></center>
<center><img src="/image/redis/redis8.png"  style="zoom:50%;" /></center>
<h3 id="_2、列表节点" tabindex="-1"><a class="header-anchor" href="#_2、列表节点"><span>2、列表节点</span></a></h3>
<center><img src="/image/redis/redis9.png"  style="zoom:50%;" /></center>
<ul>
<li>每个Entry保存一个字节数组或一个整数值，由previous_entry_length, encoding, content三部分组成
<ul>
<li>如果是字节数组，分三种：
<ul>
<li>长度<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="11.925ex" height="2.452ex" role="img" focusable="false" viewBox="0 -833.9 5270.8 1083.9" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3C" d="M694 -11T694 -19T688 -33T678 -40Q671 -40 524 29T234 166L90 235Q83 240 83 250Q83 261 91 266Q664 540 678 540Q681 540 687 534T694 519T687 505Q686 504 417 376L151 250L417 124Q686 -4 687 -5Q694 -11 694 -19Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mo" transform="translate(1833.8,0)"><path data-c="28" d="M94 250Q94 319 104 381T127 488T164 576T202 643T244 695T277 729T302 750H315H319Q333 750 333 741Q333 738 316 720T275 667T226 581T184 443T167 250T184 58T225 -81T274 -167T316 -220T333 -241Q333 -250 318 -250H315H302L274 -226Q180 -141 137 -14T94 250Z"></path></g><g data-mml-node="msup" transform="translate(2222.8,0)"><g data-mml-node="mn"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="mn" transform="translate(533,363) scale(0.707)"><path data-c="36" d="M42 313Q42 476 123 571T303 666Q372 666 402 630T432 550Q432 525 418 510T379 495Q356 495 341 509T326 548Q326 592 373 601Q351 623 311 626Q240 626 194 566Q147 500 147 364L148 360Q153 366 156 373Q197 433 263 433H267Q313 433 348 414Q372 400 396 374T435 317Q456 268 456 210V192Q456 169 451 149Q440 90 387 34T253 -22Q225 -22 199 -14T143 16T92 75T56 172T42 313ZM257 397Q227 397 205 380T171 335T154 278T148 216Q148 133 160 97T198 39Q222 21 251 21Q302 21 329 59Q342 77 347 104T352 209Q352 289 347 316T329 361Q302 397 257 397Z"></path></g></g><g data-mml-node="mo" transform="translate(3381.6,0)"><path data-c="2212" d="M84 237T84 250T98 270H679Q694 262 694 250T679 230H98Q84 237 84 250Z"></path></g><g data-mml-node="mn" transform="translate(4381.8,0)"><path data-c="31" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617T245 641T273 663Q275 666 285 666Q294 666 302 660V361L303 61Q310 54 315 52T339 48T401 46H427V0H416Q395 3 257 3Q121 3 100 0H88V46H114Q136 46 152 46T177 47T193 50T201 52T207 57T213 61V578Z"></path></g><g data-mml-node="mo" transform="translate(4881.8,0)"><path data-c="29" d="M60 749L64 750Q69 750 74 750H86L114 726Q208 641 251 514T294 250Q294 182 284 119T261 12T224 -76T186 -143T145 -194T113 -227T90 -246Q87 -249 86 -250H74Q66 -250 63 -250T58 -247T55 -238Q56 -237 66 -225Q221 -64 221 250T66 725Q56 737 55 738Q55 746 60 749Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&lt;=</mo><mo stretchy="false">(</mo><msup><mn>2</mn><mn>6</mn></msup><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></math></mjx-assistive-mml></mjx-container>的字节数组</li>
<li>长度<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="12.725ex" height="2.47ex" role="img" focusable="false" viewBox="0 -841.7 5624.3 1091.7" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3C" d="M694 -11T694 -19T688 -33T678 -40Q671 -40 524 29T234 166L90 235Q83 240 83 250Q83 261 91 266Q664 540 678 540Q681 540 687 534T694 519T687 505Q686 504 417 376L151 250L417 124Q686 -4 687 -5Q694 -11 694 -19Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mo" transform="translate(1833.8,0)"><path data-c="28" d="M94 250Q94 319 104 381T127 488T164 576T202 643T244 695T277 729T302 750H315H319Q333 750 333 741Q333 738 316 720T275 667T226 581T184 443T167 250T184 58T225 -81T274 -167T316 -220T333 -241Q333 -250 318 -250H315H302L274 -226Q180 -141 137 -14T94 250Z"></path></g><g data-mml-node="msup" transform="translate(2222.8,0)"><g data-mml-node="mn"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="TeXAtom" transform="translate(533,363) scale(0.707)" data-mjx-texclass="ORD"><g data-mml-node="mn"><path data-c="31" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617T245 641T273 663Q275 666 285 666Q294 666 302 660V361L303 61Q310 54 315 52T339 48T401 46H427V0H416Q395 3 257 3Q121 3 100 0H88V46H114Q136 46 152 46T177 47T193 50T201 52T207 57T213 61V578Z"></path><path data-c="34" d="M462 0Q444 3 333 3Q217 3 199 0H190V46H221Q241 46 248 46T265 48T279 53T286 61Q287 63 287 115V165H28V211L179 442Q332 674 334 675Q336 677 355 677H373L379 671V211H471V165H379V114Q379 73 379 66T385 54Q393 47 442 46H471V0H462ZM293 211V545L74 212L183 211H293Z" transform="translate(500,0)"></path></g></g></g><g data-mml-node="mo" transform="translate(3735.1,0)"><path data-c="2212" d="M84 237T84 250T98 270H679Q694 262 694 250T679 230H98Q84 237 84 250Z"></path></g><g data-mml-node="mn" transform="translate(4735.3,0)"><path data-c="31" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617T245 641T273 663Q275 666 285 666Q294 666 302 660V361L303 61Q310 54 315 52T339 48T401 46H427V0H416Q395 3 257 3Q121 3 100 0H88V46H114Q136 46 152 46T177 47T193 50T201 52T207 57T213 61V578Z"></path></g><g data-mml-node="mo" transform="translate(5235.3,0)"><path data-c="29" d="M60 749L64 750Q69 750 74 750H86L114 726Q208 641 251 514T294 250Q294 182 284 119T261 12T224 -76T186 -143T145 -194T113 -227T90 -246Q87 -249 86 -250H74Q66 -250 63 -250T58 -247T55 -238Q56 -237 66 -225Q221 -64 221 250T66 725Q56 737 55 738Q55 746 60 749Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&lt;=</mo><mo stretchy="false">(</mo><msup><mn>2</mn><mrow data-mjx-texclass="ORD"><mn>14</mn></mrow></msup><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></math></mjx-assistive-mml></mjx-container>的字节数组</li>
<li>长度<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="12.725ex" height="2.452ex" role="img" focusable="false" viewBox="0 -833.9 5624.3 1083.9" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3C" d="M694 -11T694 -19T688 -33T678 -40Q671 -40 524 29T234 166L90 235Q83 240 83 250Q83 261 91 266Q664 540 678 540Q681 540 687 534T694 519T687 505Q686 504 417 376L151 250L417 124Q686 -4 687 -5Q694 -11 694 -19Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mo" transform="translate(1833.8,0)"><path data-c="28" d="M94 250Q94 319 104 381T127 488T164 576T202 643T244 695T277 729T302 750H315H319Q333 750 333 741Q333 738 316 720T275 667T226 581T184 443T167 250T184 58T225 -81T274 -167T316 -220T333 -241Q333 -250 318 -250H315H302L274 -226Q180 -141 137 -14T94 250Z"></path></g><g data-mml-node="msup" transform="translate(2222.8,0)"><g data-mml-node="mn"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g><g data-mml-node="TeXAtom" transform="translate(533,363) scale(0.707)" data-mjx-texclass="ORD"><g data-mml-node="mn"><path data-c="33" d="M127 463Q100 463 85 480T69 524Q69 579 117 622T233 665Q268 665 277 664Q351 652 390 611T430 522Q430 470 396 421T302 350L299 348Q299 347 308 345T337 336T375 315Q457 262 457 175Q457 96 395 37T238 -22Q158 -22 100 21T42 130Q42 158 60 175T105 193Q133 193 151 175T169 130Q169 119 166 110T159 94T148 82T136 74T126 70T118 67L114 66Q165 21 238 21Q293 21 321 74Q338 107 338 175V195Q338 290 274 322Q259 328 213 329L171 330L168 332Q166 335 166 348Q166 366 174 366Q202 366 232 371Q266 376 294 413T322 525V533Q322 590 287 612Q265 626 240 626Q208 626 181 615T143 592T132 580H135Q138 579 143 578T153 573T165 566T175 555T183 540T186 520Q186 498 172 481T127 463Z"></path><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z" transform="translate(500,0)"></path></g></g></g><g data-mml-node="mo" transform="translate(3735.1,0)"><path data-c="2212" d="M84 237T84 250T98 270H679Q694 262 694 250T679 230H98Q84 237 84 250Z"></path></g><g data-mml-node="mn" transform="translate(4735.3,0)"><path data-c="31" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617T245 641T273 663Q275 666 285 666Q294 666 302 660V361L303 61Q310 54 315 52T339 48T401 46H427V0H416Q395 3 257 3Q121 3 100 0H88V46H114Q136 46 152 46T177 47T193 50T201 52T207 57T213 61V578Z"></path></g><g data-mml-node="mo" transform="translate(5235.3,0)"><path data-c="29" d="M60 749L64 750Q69 750 74 750H86L114 726Q208 641 251 514T294 250Q294 182 284 119T261 12T224 -76T186 -143T145 -194T113 -227T90 -246Q87 -249 86 -250H74Q66 -250 63 -250T58 -247T55 -238Q56 -237 66 -225Q221 -64 221 250T66 725Q56 737 55 738Q55 746 60 749Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&lt;=</mo><mo stretchy="false">(</mo><msup><mn>2</mn><mrow data-mjx-texclass="ORD"><mn>32</mn></mrow></msup><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></math></mjx-assistive-mml></mjx-container>的字节数组</li>
</ul>
</li>
<li>如果是整数值，分6种：
<ul>
<li>4位长，介于0~12的无符号整数</li>
<li>1字节长有符号整数</li>
<li>3字节长有符号整数</li>
<li>int16_t类型整数</li>
<li>int32_t类型整数</li>
<li>int64_t类型整数</li>
</ul>
</li>
</ul>
</li>
<li>previous_entry_length: 前一个结点的长度，占1字节/5字节。可以结合当前结点地址计算出前一节点的起始地址
<ul>
<li>如果前一节点长度小于254，则占1字节</li>
<li>如果前一节点长度大于等于254，则占5字节，其中第一个字节置为0xFE作为标记</li>
</ul>
</li>
<li>encoding：记录content属性的类型及长度
<ul>
<li>如果最高位为00/01/10，则占1/2/5字节，表示content存储字节数组，数组的长度由其余位记录</li>
<li>如果最高位为11，则占1字节，表示content存储整数值，类型和长度由其余位记录（值甚至可能直接保存在encoding中）</li>
</ul>
</li>
<li>content：保存节点值，可能是字节数组/整数值</li>
</ul>
<h3 id="_3、连锁更新" tabindex="-1"><a class="header-anchor" href="#_3、连锁更新"><span>3、连锁更新</span></a></h3>
<p>如果压缩列表里恰好有多个连续的，长度介于250-253字节的数组，在增删改时可能引发连锁更新，导致连续的空间重分配，最坏复杂度<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="6.606ex" height="2.452ex" role="img" focusable="false" viewBox="0 -833.9 2919.8 1083.9" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mi"><path data-c="1D442" d="M740 435Q740 320 676 213T511 42T304 -22Q207 -22 138 35T51 201Q50 209 50 244Q50 346 98 438T227 601Q351 704 476 704Q514 704 524 703Q621 689 680 617T740 435ZM637 476Q637 565 591 615T476 665Q396 665 322 605Q242 542 200 428T157 216Q157 126 200 73T314 19Q404 19 485 98T608 313Q637 408 637 476Z"></path></g><g data-mml-node="mo" transform="translate(763,0)"><path data-c="28" d="M94 250Q94 319 104 381T127 488T164 576T202 643T244 695T277 729T302 750H315H319Q333 750 333 741Q333 738 316 720T275 667T226 581T184 443T167 250T184 58T225 -81T274 -167T316 -220T333 -241Q333 -250 318 -250H315H302L274 -226Q180 -141 137 -14T94 250Z"></path></g><g data-mml-node="msup" transform="translate(1152,0)"><g data-mml-node="mi"><path data-c="1D441" d="M234 637Q231 637 226 637Q201 637 196 638T191 649Q191 676 202 682Q204 683 299 683Q376 683 387 683T401 677Q612 181 616 168L670 381Q723 592 723 606Q723 633 659 637Q635 637 635 648Q635 650 637 660Q641 676 643 679T653 683Q656 683 684 682T767 680Q817 680 843 681T873 682Q888 682 888 672Q888 650 880 642Q878 637 858 637Q787 633 769 597L620 7Q618 0 599 0Q585 0 582 2Q579 5 453 305L326 604L261 344Q196 88 196 79Q201 46 268 46H278Q284 41 284 38T282 19Q278 6 272 0H259Q228 2 151 2Q123 2 100 2T63 2T46 1Q31 1 31 10Q31 14 34 26T39 40Q41 46 62 46Q130 49 150 85Q154 91 221 362L289 634Q287 635 234 637Z"></path></g><g data-mml-node="mn" transform="translate(975.3,363) scale(0.707)"><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"></path></g></g><g data-mml-node="mo" transform="translate(2530.8,0)"><path data-c="29" d="M60 749L64 750Q69 750 74 750H86L114 726Q208 641 251 514T294 250Q294 182 284 119T261 12T224 -76T186 -143T145 -194T113 -227T90 -246Q87 -249 86 -250H74Q66 -250 63 -250T58 -247T55 -238Q56 -237 66 -225Q221 -64 221 250T66 725Q56 737 55 738Q55 746 60 749Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>O</mi><mo stretchy="false">(</mo><msup><mi>N</mi><mn>2</mn></msup><mo stretchy="false">)</mo></math></mjx-assistive-mml></mjx-container>。但实际情况下很少发生。</p>
<h2 id="七、对象" tabindex="-1"><a class="header-anchor" href="#七、对象"><span>七、对象</span></a></h2>
<h3 id="_1、对象类型和编码" tabindex="-1"><a class="header-anchor" href="#_1、对象类型和编码"><span>1、对象类型和编码</span></a></h3>
<ul>
<li>
<p>Redis使用对象来表示数据库中的键和值，包含字符串对象、列表对象、哈希对象、集合对象、有序集合对象五种类型</p>
</li>
<li>
<p>每种对象都使用了前述的至少一种数据结构（SDS，链表，字典，跳表，整数集合，压缩列表）</p>
</li>
<li>
<p>每个对象都由一个redisObject结构表示</p>
<ul>
<li>
<div class="language-c line-numbers-mode" data-ext="c" data-title="c"><pre v-pre class="language-c"><code>  <span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token class-name">redisObject</span><span class="token punctuation">{</span>
    <span class="token comment">//类型</span>
    <span class="token keyword">unsigned</span> type<span class="token operator">:</span><span class="token number">4</span><span class="token punctuation">;</span>
    <span class="token comment">//编码</span>
    <span class="token keyword">unsigned</span> encoding<span class="token operator">:</span><span class="token number">4</span><span class="token punctuation">;</span>
    <span class="token comment">//指向底层实现数据结构的指针</span>
    <span class="token keyword">void</span> <span class="token operator">*</span>ptr
    <span class="token comment">//...</span>
  <span class="token punctuation">}</span>robj<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></li>
<li>
<p>type：对象类型</p>
<ul>
<li>
<p>Redis中键总是一个字符串对象，而值可以是五种对象中任意一种</p>
</li>
<li>
<p>使用<code v-pre>type key</code>命令输出对象类型</p>
</li>
<li>
<center><img src="/image/redis/redis10.png"  style="zoom:50%;" /></center>
</li>
</ul>
</li>
<li>
<p>encoding：记录对象所使用的数据结构</p>
<ul>
<li>
<p>每种对象都至少使用了两种不同实现结构</p>
</li>
<li>
<p>Redis可以根据不同使用场景切换使用不同实现方式，提升了灵活性和效率</p>
</li>
<li>
<p>使用<code v-pre>object encoding key</code>命令输出对象编码</p>
</li>
</ul>
  <center><img src="/image/redis/redis11.png"  style="zoom:50%;" /></center>
</li>
<li>
<p>ptr：指向对象的底层实现数据结构</p>
</li>
</ul>
</li>
</ul>
<h3 id="_2、字符串对象" tabindex="-1"><a class="header-anchor" href="#_2、字符串对象"><span>2、字符串对象</span></a></h3>
<p>字符串对象是唯一一种会被其他四种类型嵌套的对象</p>
<ul>
<li>字符串对象的编码有三种：
<ul>
<li>int：可以用long类型保存的整数</li>
<li>embstr：长度 <mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.464ex;" xmlns="http://www.w3.org/2000/svg" width="12.169ex" height="2.009ex" role="img" focusable="false" viewBox="0 -683 5378.8 888" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><g data-mml-node="text"><path data-c="3C" d="M694 -11T694 -19T688 -33T678 -40Q671 -40 524 29T234 166L90 235Q83 240 83 250Q83 261 91 266Q664 540 678 540Q681 540 687 534T694 519T687 505Q686 504 417 376L151 250L417 124Q686 -4 687 -5Q694 -11 694 -19Z"></path></g><g data-mml-node="text" transform="translate(778,0)"><path data-c="3D" d="M56 347Q56 360 70 367H707Q722 359 722 347Q722 336 708 328L390 327H72Q56 332 56 347ZM56 153Q56 168 72 173H708Q722 163 722 153Q722 140 707 133H70Q56 140 56 153Z"></path></g></g><g data-mml-node="mn" transform="translate(1833.8,0)"><path data-c="33" d="M127 463Q100 463 85 480T69 524Q69 579 117 622T233 665Q268 665 277 664Q351 652 390 611T430 522Q430 470 396 421T302 350L299 348Q299 347 308 345T337 336T375 315Q457 262 457 175Q457 96 395 37T238 -22Q158 -22 100 21T42 130Q42 158 60 175T105 193Q133 193 151 175T169 130Q169 119 166 110T159 94T148 82T136 74T126 70T118 67L114 66Q165 21 238 21Q293 21 321 74Q338 107 338 175V195Q338 290 274 322Q259 328 213 329L171 330L168 332Q166 335 166 348Q166 366 174 366Q202 366 232 371Q266 376 294 413T322 525V533Q322 590 287 612Q265 626 240 626Q208 626 181 615T143 592T132 580H135Q138 579 143 578T153 573T165 566T175 555T183 540T186 520Q186 498 172 481T127 463Z"></path><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z" transform="translate(500,0)"></path></g><g data-mml-node="mi" transform="translate(2833.8,0)"><path data-c="1D435" d="M231 637Q204 637 199 638T194 649Q194 676 205 682Q206 683 335 683Q594 683 608 681Q671 671 713 636T756 544Q756 480 698 429T565 360L555 357Q619 348 660 311T702 219Q702 146 630 78T453 1Q446 0 242 0Q42 0 39 2Q35 5 35 10Q35 17 37 24Q42 43 47 45Q51 46 62 46H68Q95 46 128 49Q142 52 147 61Q150 65 219 339T288 628Q288 635 231 637ZM649 544Q649 574 634 600T585 634Q578 636 493 637Q473 637 451 637T416 636H403Q388 635 384 626Q382 622 352 506Q352 503 351 500L320 374H401Q482 374 494 376Q554 386 601 434T649 544ZM595 229Q595 273 572 302T512 336Q506 337 429 337Q311 337 310 336Q310 334 293 263T258 122L240 52Q240 48 252 48T333 46Q422 46 429 47Q491 54 543 105T595 229Z"></path></g><g data-mml-node="mi" transform="translate(3592.8,0)"><path data-c="1D466" d="M21 287Q21 301 36 335T84 406T158 442Q199 442 224 419T250 355Q248 336 247 334Q247 331 231 288T198 191T182 105Q182 62 196 45T238 27Q261 27 281 38T312 61T339 94Q339 95 344 114T358 173T377 247Q415 397 419 404Q432 431 462 431Q475 431 483 424T494 412T496 403Q496 390 447 193T391 -23Q363 -106 294 -155T156 -205Q111 -205 77 -183T43 -117Q43 -95 50 -80T69 -58T89 -48T106 -45Q150 -45 150 -87Q150 -107 138 -122T115 -142T102 -147L99 -148Q101 -153 118 -160T152 -167H160Q177 -167 186 -165Q219 -156 247 -127T290 -65T313 -9T321 21L315 17Q309 13 296 6T270 -6Q250 -11 231 -11Q185 -11 150 11T104 82Q103 89 103 113Q103 170 138 262T173 379Q173 380 173 381Q173 390 173 393T169 400T158 404H154Q131 404 112 385T82 344T65 302T57 280Q55 278 41 278H27Q21 284 21 287Z"></path></g><g data-mml-node="mi" transform="translate(4082.8,0)"><path data-c="1D461" d="M26 385Q19 392 19 395Q19 399 22 411T27 425Q29 430 36 430T87 431H140L159 511Q162 522 166 540T173 566T179 586T187 603T197 615T211 624T229 626Q247 625 254 615T261 596Q261 589 252 549T232 470L222 433Q222 431 272 431H323Q330 424 330 420Q330 398 317 385H210L174 240Q135 80 135 68Q135 26 162 26Q197 26 230 60T283 144Q285 150 288 151T303 153H307Q322 153 322 145Q322 142 319 133Q314 117 301 95T267 48T216 6T155 -11Q125 -11 98 4T59 56Q57 64 57 83V101L92 241Q127 382 128 383Q128 385 77 385H26Z"></path></g><g data-mml-node="mi" transform="translate(4443.8,0)"><path data-c="1D452" d="M39 168Q39 225 58 272T107 350T174 402T244 433T307 442H310Q355 442 388 420T421 355Q421 265 310 237Q261 224 176 223Q139 223 138 221Q138 219 132 186T125 128Q125 81 146 54T209 26T302 45T394 111Q403 121 406 121Q410 121 419 112T429 98T420 82T390 55T344 24T281 -1T205 -11Q126 -11 83 42T39 168ZM373 353Q367 405 305 405Q272 405 244 391T199 357T170 316T154 280T149 261Q149 260 169 260Q282 260 327 284T373 353Z"></path></g><g data-mml-node="mi" transform="translate(4909.8,0)"><path data-c="1D460" d="M131 289Q131 321 147 354T203 415T300 442Q362 442 390 415T419 355Q419 323 402 308T364 292Q351 292 340 300T328 326Q328 342 337 354T354 372T367 378Q368 378 368 379Q368 382 361 388T336 399T297 405Q249 405 227 379T204 326Q204 301 223 291T278 274T330 259Q396 230 396 163Q396 135 385 107T352 51T289 7T195 -10Q118 -10 86 19T53 87Q53 126 74 143T118 160Q133 160 146 151T160 120Q160 94 142 76T111 58Q109 57 108 57T107 55Q108 52 115 47T146 34T201 27Q237 27 263 38T301 66T318 97T323 122Q323 150 302 164T254 181T195 196T148 231Q131 256 131 289Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&lt;=</mo><mn>32</mn><mi>B</mi><mi>y</mi><mi>t</mi><mi>e</mi><mi>s</mi></math></mjx-assistive-mml></mjx-container> 的短字符串</li>
<li>raw：长度 <mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.464ex;" xmlns="http://www.w3.org/2000/svg" width="10.409ex" height="2.009ex" role="img" focusable="false" viewBox="0 -683 4600.8 888" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mo"><path data-c="3E" d="M84 520Q84 528 88 533T96 539L99 540Q106 540 253 471T544 334L687 265Q694 260 694 250T687 235Q685 233 395 96L107 -40H101Q83 -38 83 -20Q83 -19 83 -17Q82 -10 98 -1Q117 9 248 71Q326 108 378 132L626 250L378 368Q90 504 86 509Q84 513 84 520Z"></path></g><g data-mml-node="mn" transform="translate(1055.8,0)"><path data-c="33" d="M127 463Q100 463 85 480T69 524Q69 579 117 622T233 665Q268 665 277 664Q351 652 390 611T430 522Q430 470 396 421T302 350L299 348Q299 347 308 345T337 336T375 315Q457 262 457 175Q457 96 395 37T238 -22Q158 -22 100 21T42 130Q42 158 60 175T105 193Q133 193 151 175T169 130Q169 119 166 110T159 94T148 82T136 74T126 70T118 67L114 66Q165 21 238 21Q293 21 321 74Q338 107 338 175V195Q338 290 274 322Q259 328 213 329L171 330L168 332Q166 335 166 348Q166 366 174 366Q202 366 232 371Q266 376 294 413T322 525V533Q322 590 287 612Q265 626 240 626Q208 626 181 615T143 592T132 580H135Q138 579 143 578T153 573T165 566T175 555T183 540T186 520Q186 498 172 481T127 463Z"></path><path data-c="32" d="M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z" transform="translate(500,0)"></path></g><g data-mml-node="mi" transform="translate(2055.8,0)"><path data-c="1D435" d="M231 637Q204 637 199 638T194 649Q194 676 205 682Q206 683 335 683Q594 683 608 681Q671 671 713 636T756 544Q756 480 698 429T565 360L555 357Q619 348 660 311T702 219Q702 146 630 78T453 1Q446 0 242 0Q42 0 39 2Q35 5 35 10Q35 17 37 24Q42 43 47 45Q51 46 62 46H68Q95 46 128 49Q142 52 147 61Q150 65 219 339T288 628Q288 635 231 637ZM649 544Q649 574 634 600T585 634Q578 636 493 637Q473 637 451 637T416 636H403Q388 635 384 626Q382 622 352 506Q352 503 351 500L320 374H401Q482 374 494 376Q554 386 601 434T649 544ZM595 229Q595 273 572 302T512 336Q506 337 429 337Q311 337 310 336Q310 334 293 263T258 122L240 52Q240 48 252 48T333 46Q422 46 429 47Q491 54 543 105T595 229Z"></path></g><g data-mml-node="mi" transform="translate(2814.8,0)"><path data-c="1D466" d="M21 287Q21 301 36 335T84 406T158 442Q199 442 224 419T250 355Q248 336 247 334Q247 331 231 288T198 191T182 105Q182 62 196 45T238 27Q261 27 281 38T312 61T339 94Q339 95 344 114T358 173T377 247Q415 397 419 404Q432 431 462 431Q475 431 483 424T494 412T496 403Q496 390 447 193T391 -23Q363 -106 294 -155T156 -205Q111 -205 77 -183T43 -117Q43 -95 50 -80T69 -58T89 -48T106 -45Q150 -45 150 -87Q150 -107 138 -122T115 -142T102 -147L99 -148Q101 -153 118 -160T152 -167H160Q177 -167 186 -165Q219 -156 247 -127T290 -65T313 -9T321 21L315 17Q309 13 296 6T270 -6Q250 -11 231 -11Q185 -11 150 11T104 82Q103 89 103 113Q103 170 138 262T173 379Q173 380 173 381Q173 390 173 393T169 400T158 404H154Q131 404 112 385T82 344T65 302T57 280Q55 278 41 278H27Q21 284 21 287Z"></path></g><g data-mml-node="mi" transform="translate(3304.8,0)"><path data-c="1D461" d="M26 385Q19 392 19 395Q19 399 22 411T27 425Q29 430 36 430T87 431H140L159 511Q162 522 166 540T173 566T179 586T187 603T197 615T211 624T229 626Q247 625 254 615T261 596Q261 589 252 549T232 470L222 433Q222 431 272 431H323Q330 424 330 420Q330 398 317 385H210L174 240Q135 80 135 68Q135 26 162 26Q197 26 230 60T283 144Q285 150 288 151T303 153H307Q322 153 322 145Q322 142 319 133Q314 117 301 95T267 48T216 6T155 -11Q125 -11 98 4T59 56Q57 64 57 83V101L92 241Q127 382 128 383Q128 385 77 385H26Z"></path></g><g data-mml-node="mi" transform="translate(3665.8,0)"><path data-c="1D452" d="M39 168Q39 225 58 272T107 350T174 402T244 433T307 442H310Q355 442 388 420T421 355Q421 265 310 237Q261 224 176 223Q139 223 138 221Q138 219 132 186T125 128Q125 81 146 54T209 26T302 45T394 111Q403 121 406 121Q410 121 419 112T429 98T420 82T390 55T344 24T281 -1T205 -11Q126 -11 83 42T39 168ZM373 353Q367 405 305 405Q272 405 244 391T199 357T170 316T154 280T149 261Q149 260 169 260Q282 260 327 284T373 353Z"></path></g><g data-mml-node="mi" transform="translate(4131.8,0)"><path data-c="1D460" d="M131 289Q131 321 147 354T203 415T300 442Q362 442 390 415T419 355Q419 323 402 308T364 292Q351 292 340 300T328 326Q328 342 337 354T354 372T367 378Q368 378 368 379Q368 382 361 388T336 399T297 405Q249 405 227 379T204 326Q204 301 223 291T278 274T330 259Q396 230 396 163Q396 135 385 107T352 51T289 7T195 -10Q118 -10 86 19T53 87Q53 126 74 143T118 160Q133 160 146 151T160 120Q160 94 142 76T111 58Q109 57 108 57T107 55Q108 52 115 47T146 34T201 27Q237 27 263 38T301 66T318 97T323 122Q323 150 302 164T254 181T195 196T148 231Q131 256 131 289Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&gt;</mo><mn>32</mn><mi>B</mi><mi>y</mi><mi>t</mi><mi>e</mi><mi>s</mi></math></mjx-assistive-mml></mjx-container> 的长字符串，或无法用long保存的整数，或无法用long double保存的浮点数</li>
</ul>
</li>
</ul>
<center><img src="/image/redis/redis12.png"  style="zoom:50%;" /></center>
<ul>
<li>
<p>embstr与raw编码联系：</p>
<ul>
<li>两者都使用redisObject和sdshdr结构表示字符串编码</li>
<li>raw分两次内存分配给两个结构，而embstr一次性分配连续的内存空间给两个结构。相应的释放内存次数也不同</li>
<li>embstr连续存储能够更好的利用缓存带来的优势</li>
</ul>
</li>
<li>
<p>编码转换：int/embstr在某些条件下会自动转换为raw编码的字符串对象</p>
<ul>
<li>对于int，如果执行了一些操作，不再是整数或超出long范围，则会转换为raw</li>
<li>对于embstr，本身是只读对象，没有相应的操作。因此任何对embstr的修改操作，都会使其转换为raw</li>
</ul>
</li>
</ul>
<h3 id="_3、列表对象" tabindex="-1"><a class="header-anchor" href="#_3、列表对象"><span>3、列表对象</span></a></h3>
<p>列表对象的编码可以是<code v-pre>ziplist</code>和<code v-pre>linkedlist</code></p>
<ul>
<li><code v-pre>ziplist</code>:使用压缩列表实现，每个压缩列表结点保存一个列表元素</li>
</ul>
<center><img src="/image/redis/redis13.png"  style="zoom:50%;" /></center>
<ul>
<li><code v-pre>linkedlist</code>: 使用双端链表作为底层实现,每个双端链表节点(node)都保存来一个字符串对象,而每个字符串对象都保存来一个列表元素</li>
</ul>
<center><img src="/image/redis/redis14.png"  style="zoom:50%;" /></center>
<p><strong>编码转换</strong>：当列表对象同时满足以下两个条件时，使用 ziplist，否则 linkedlist（参数可调）</p>
<ul>
<li>列表对象保存的所有字符串元素的长度都小于64Byte</li>
<li>列表对象保存的元素数量小于512</li>
</ul>
<h3 id="_4、哈希对象" tabindex="-1"><a class="header-anchor" href="#_4、哈希对象"><span>4、哈希对象</span></a></h3>
<p>哈希对象的编码有两种：</p>
<ul>
<li>
<p>ziplist：使用压缩列表实现</p>
<ul>
<li>新加入的键和值分别保存在一个压缩列表结点中，推入列表表尾</li>
</ul>
  <center><img src="/image/redis/redis15.png"  style="zoom:50%;" /></center>
</li>
<li>
<p>hashtable：使用字典实现</p>
<ul>
<li>字典的每个键都是一个字符串对象，保存键</li>
<li>字典的每个值都是一个字符串对象，保存值</li>
</ul>
</li>
</ul>
<center><img src="/image/redis/redis16.png"  style="zoom:50%;" /></center>
<p><strong>编码转换</strong>：当哈希对象同时满足以下两个条件时，使用 ziplist，否则 hashtable（参数可调）</p>
<ul>
<li>哈希对象保存的所有键、值的字符串长度都小于64Byte</li>
<li>哈希对象保存的键值对数量小于512</li>
</ul>
<h3 id="_5、集合对象" tabindex="-1"><a class="header-anchor" href="#_5、集合对象"><span>5、集合对象</span></a></h3>
<p>集合对象的编码有两种：</p>
<ul>
<li>
<p>intset：使用整数集合实现</p>
<ul>
<li>所有元素保存在整数集合中</li>
</ul>
  <center><img src="/image/redis/redis17.png"  style="zoom:50%;" /></center>
</li>
<li>
<p>hashtable：使用字典实现</p>
<ul>
<li>字典的每个键都是一个字符串对象，保存一个集合元素</li>
<li>字典的每个值都是NULL</li>
</ul>
</li>
</ul>
<center><img src="/image/redis/redis18.png"  style="zoom:50%;" /></center>
<p><strong>编码转换</strong>：当集合对象同时满足以下两个条件时，使用 intset，否则 hashtable（参数可调）</p>
<ul>
<li>集合对象保存的所有元素都是整数值</li>
<li>集合对象保存的元素数量不超过512个</li>
</ul>
<h3 id="_6、有序集合对象" tabindex="-1"><a class="header-anchor" href="#_6、有序集合对象"><span>6、有序集合对象</span></a></h3>
<p>有序集合每个元素的成员都是一个字符串对象，而每个元素的分值都是一个double</p>
<p>有序集合对象的编码有两种：</p>
<ul>
<li>ziplist：使用压缩列表实现
<ul>
<li>每个元素使用两个紧挨在一起的压缩列表节点保存，第一个是元素成员，第二个是元素分值</li>
<li>压缩列表内的集合元素按分值从小到大排序</li>
</ul>
</li>
</ul>
<center><img src="/image/redis/redis19.png"  style="zoom:50%;" /></center>
<ul>
<li>
<p>skiplist：使用zset-跳表+字典实现</p>
<ul>
<li>
<p>跳表按分值从小到大保存所有集合元素</p>
</li>
<li>
<p>跳表的每个结点保存一个集合元素，object存储成员，score存储分值</p>
</li>
<li>
<p>跳表可以实现有序集合的范围型操作</p>
</li>
<li>
<p>字典创建了从成员到分值的映射</p>
</li>
<li>
<p>字典的每个键值对保存一个集合元素，键是成员，值是分值</p>
</li>
<li>
<p>字典可以实现<mjx-container v-pre class="MathJax" jax="SVG" style="position: relative;"><svg style="vertical-align: -0.566ex;" xmlns="http://www.w3.org/2000/svg" width="4.618ex" height="2.262ex" role="img" focusable="false" viewBox="0 -750 2041 1000" aria-hidden="true"><g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)"><g data-mml-node="math"><g data-mml-node="mi"><path data-c="1D442" d="M740 435Q740 320 676 213T511 42T304 -22Q207 -22 138 35T51 201Q50 209 50 244Q50 346 98 438T227 601Q351 704 476 704Q514 704 524 703Q621 689 680 617T740 435ZM637 476Q637 565 591 615T476 665Q396 665 322 605Q242 542 200 428T157 216Q157 126 200 73T314 19Q404 19 485 98T608 313Q637 408 637 476Z"></path></g><g data-mml-node="mo" transform="translate(763,0)"><path data-c="28" d="M94 250Q94 319 104 381T127 488T164 576T202 643T244 695T277 729T302 750H315H319Q333 750 333 741Q333 738 316 720T275 667T226 581T184 443T167 250T184 58T225 -81T274 -167T316 -220T333 -241Q333 -250 318 -250H315H302L274 -226Q180 -141 137 -14T94 250Z"></path></g><g data-mml-node="mn" transform="translate(1152,0)"><path data-c="31" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617T245 641T273 663Q275 666 285 666Q294 666 302 660V361L303 61Q310 54 315 52T339 48T401 46H427V0H416Q395 3 257 3Q121 3 100 0H88V46H114Q136 46 152 46T177 47T193 50T201 52T207 57T213 61V578Z"></path></g><g data-mml-node="mo" transform="translate(1652,0)"><path data-c="29" d="M60 749L64 750Q69 750 74 750H86L114 726Q208 641 251 514T294 250Q294 182 284 119T261 12T224 -76T186 -143T145 -194T113 -227T90 -246Q87 -249 86 -250H74Q66 -250 63 -250T58 -247T55 -238Q56 -237 66 -225Q221 -64 221 250T66 725Q56 737 55 738Q55 746 60 749Z"></path></g></g></g></svg><mjx-assistive-mml unselectable="on" display="inline"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>O</mi><mo stretchy="false">(</mo><mn>1</mn><mo stretchy="false">)</mo></math></mjx-assistive-mml></mjx-container>查找指定元素分值</p>
</li>
<li>
<p>尽管可以单独用跳表或字典实现有序集合，但不能同时满足范围型操作和查找操作的效率</p>
</li>
<li>
<p>跳表和字典通过指针共享相同的元素，不额外浪费内存</p>
</li>
</ul>
</li>
</ul>
<center><img src="/image/redis/redis20.png"  style="zoom:50%;" /></center>
<p>编码转换：当有序集合对象同时满足以下两个条件时，使用 ziplist，否则 skiplist（参数可调）</p>
<ul>
<li>有序集合保存的元素数量小于128个</li>
<li>有序集合保存的所有元素成员的长度都小于64字节</li>
</ul>
<h3 id="_7、对象其它属性" tabindex="-1"><a class="header-anchor" href="#_7、对象其它属性"><span>7、对象其它属性</span></a></h3>
<ul>
<li>类型检查：
<ul>
<li>Redis部分命令适用于任何类型键，如DEL, EXPIRE...；称基于类型的多态命令</li>
<li>另一部分只能用于特定类型，如HSET, SADD...；称基于编码的多态命令</li>
<li>服务器根据redisObject中的type属性检查操作是否适用</li>
<li>服务器根据redisObject中的encoding属性检查操作的具体实现</li>
</ul>
</li>
<li>RefCount：
<ul>
<li>对象周期分创建、操作、释放三个</li>
<li>Redis使用引用计数机制实现内存自动回收，由redisObject中的refCount记录引用数</li>
<li>基于refCount，相同整数值的字符串对象可以进行共享，节约内存</li>
<li>Redis自动对0-9999的整数值进行共享</li>
<li>考虑到值判等的开销，仅对包含整数值的字符串对象进行共享</li>
</ul>
</li>
<li>LRU：
<ul>
<li>redisObject中的lru属性记录对象最后一次被访问的时间，用于LRU内存回收策略</li>
<li>也用于idletime计算空转时间</li>
</ul>
</li>
</ul>
</div></template>


