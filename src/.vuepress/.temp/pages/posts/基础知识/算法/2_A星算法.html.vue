<template><div><!--more--->
<h1 id="a星算法" tabindex="-1"><a class="header-anchor" href="#a星算法"><span>A星算法</span></a></h1>
<p>A*（A-Star)算法是一种静态路网中求解最短路最有效的方法。公式表示为：f(n)=g(n)+h(n)，其中f(n)是节点n从初始点到目标点的估价函数，g(n)是在状态空间中从初始节点到n节点的实际代价，h(n)是从n到目标节点最佳路径的估计代价。</p>
<h2 id="一、算法比较" tabindex="-1"><a class="header-anchor" href="#一、算法比较"><span>一、算法比较</span></a></h2>
<h3 id="_1、dijkstra算法" tabindex="-1"><a class="header-anchor" href="#_1、dijkstra算法"><span>1、Dijkstra算法</span></a></h3>
<p>Dijkstra算法从物体所在的初始点开始，访问图中的结点。它迭代检查待检查结点集中的结点，并把和该结点最靠近的尚未检查的结点加入待检查结点集。该结点集从初始结点向外扩展，直到到达目标结点。Dijkstra算法保证能找到一条从初始点到目标点的最短路径，只要所有的边都有一个非负的代价值。（我说“最短路径”是因为经常会出现许多差不多短的路径。）在下图中，粉红色的结点是初始结点，蓝色的是目标点，而类菱形的有色区域（注：原文是teal areas）则是Dijkstra算法扫描过的区域。颜色最淡的区域是那些离初始点最远的，因而形成探测过程（exploration）的边境（frontier）：</p>
<center><img src="/image/algorithm/a22.png" alt="QQ_1733724341228" style="zoom:50%;" /></center>
<p>对于有障碍物的情况下，Dijkstra算法运行得较慢，但确实能保证找到一条最短路径：</p>
<center><img src="/image/algorithm/a23.png" /></center>
<h3 id="_2、最佳优先搜索-bfs" tabindex="-1"><a class="header-anchor" href="#_2、最佳优先搜索-bfs"><span>2、最佳优先搜索（BFS）</span></a></h3>
<p>最佳优先搜索（BFS算法按照类似的流程运行，不同的是它能够评估（称为启发式的）任意结点到目标点的代价。与选择离初始结点最近的结点不同的是，它选择离目标最近的结点。BFS不能保证找到一条最短路径。然而，它比Dijkstra算法快的多，因为它用了一个启发式函数（heuristic function）快速地导向目标结点。例如，如果目标位于出发点的南方，BFS将趋向于导向南方的路径。在下面的图中，越黄的结点代表越高的启发式值（移动到目标的代价高），而越黑的结点代表越低的启发式值（移动到目标的代价低）。这表明了与Dijkstra 算法相比，BFS运行得更快。</p>
<center><img src="/image/algorithm/a24.png"  /></center>
<p>对于有障碍物的情况，BFS运行得较快，但是它找到的路径明显不是一条好的路径：</p>
<center><img src="/image/algorithm/a25.png"  /></center>
<h2 id="二、a-star算法" tabindex="-1"><a class="header-anchor" href="#二、a-star算法"><span>二、A star算法</span></a></h2>
<p>1968年发明的A star算法就是把启发式方法（heuristic approaches）如BFS，和常规方法如Dijsktra算法结合在一起的算法。有点不同的是，类似BFS的启发式方法经常给出一个近似解而不是保证最佳解。然而，尽管A star基于无法保证最佳解的启发式方法，A star却能保证找到一条最短路径。</p>
<p>在简单的情况中，它和BFS一样快,在凹型障碍物的例子中，A*找到一条和Dijkstra算法一样好的路径.</p>
<p>A star把Dijkstra算法（靠近初始点的结点）和BFS算法（靠近目标点的结点）的信息块结合起来。在讨论A star的标准术语中，g(n)表示从初始结点到任意结点n的代价，h(n)表示从结点n到目标点的启发式评估代价（heuristic estimated cost）。在上图中，yellow(h)表示远离目标的结点而teal(g)表示远离初始点的结点。当从初始点向目标点移动时，A star权衡这两者。每次进行主循环时，它检查f(n)最小的结点n，其中f(n) = g(n) + h(n)。</p>
<h3 id="_1、启发函数" tabindex="-1"><a class="header-anchor" href="#_1、启发函数"><span>1、启发函数</span></a></h3>
<p>启发式函数h(n)告诉A*从任意结点n到目标结点的最小代价评估值。选择一个好的启发式函数是重要的。</p>
<blockquote>
<ul>
<li>一种极端情况，如果h(n)是0，则只有g(n)起作用，此时A<em>演变成Dijkstra算法，这保证能找到最短路径。</em></li>
<li>如果h(n)经常都比从n移动到目标的实际代价小（或者相等），则A<em>保证能找到一条最短路径。h(n)越小，A</em>扩展的结点越多，运行就得越慢。</li>
<li>如果h(n)精确地等于从n移动到目标的代价，则A star将会仅仅寻找最佳路径而不扩展别的任何结点，这会运行得非常快。尽管这不可能在所有情况下发生，你仍可以在一些特殊情况下让它们精确地相等（译者：指让h(n)精确地等于实际值）。只要提供完美的信息，A star会运行得很完美，认识这一点很好。</li>
<li>如果h(n)有时比从n移动到目标的实际代价高，则A star不能保证找到一条最短路径，但它运行得更快。</li>
<li>另一种极端情况，如果h(n)比g(n)大很多，则只有h(n)起作用，A star演变成BFS算法。</li>
</ul>
</blockquote>
<h3 id="_2、算法流程" tabindex="-1"><a class="header-anchor" href="#_2、算法流程"><span>2、算法流程</span></a></h3>
<div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre v-pre class="language-bash"><code>OPEN <span class="token operator">=</span> priority queue containing START
CLOSED <span class="token operator">=</span> empty <span class="token builtin class-name">set</span>
<span class="token keyword">while</span> lowest rank <span class="token keyword">in</span> OPEN is not the GOAL:
  current <span class="token operator">=</span> remove lowest rank item from OPEN
  <span class="token function">add</span> current to CLOSED
  <span class="token keyword">for</span> neighbors of current:
    cost <span class="token operator">=</span> g<span class="token punctuation">(</span>current<span class="token punctuation">)</span> + movementcost<span class="token punctuation">(</span>current, neighbor<span class="token punctuation">)</span>
    <span class="token keyword">if</span> neighbor <span class="token keyword">in</span> OPEN and cost <span class="token function">less</span> than g<span class="token punctuation">(</span>neighbor<span class="token punctuation">)</span>:
      remove neighbor from OPEN, because new path is better
    <span class="token keyword">if</span> neighbor <span class="token keyword">in</span> CLOSED and cost <span class="token function">less</span> than g<span class="token punctuation">(</span>neighbor<span class="token punctuation">)</span>: ⁽²⁾
      remove neighbor from CLOSED
    <span class="token keyword">if</span> neighbor not <span class="token keyword">in</span> OPEN and neighbor not <span class="token keyword">in</span> CLOSED:
      <span class="token builtin class-name">set</span> g<span class="token punctuation">(</span>neighbor<span class="token punctuation">)</span> to cost
      <span class="token function">add</span> neighbor to OPEN
      <span class="token builtin class-name">set</span> priority queue rank to g<span class="token punctuation">(</span>neighbor<span class="token punctuation">)</span> + h<span class="token punctuation">(</span>neighbor<span class="token punctuation">)</span>
      <span class="token builtin class-name">set</span> neighbor's parent to current

reconstruct reverse path from goal to start
by following parent pointers
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、图解算法" tabindex="-1"><a class="header-anchor" href="#_3、图解算法"><span>3、图解算法</span></a></h3>
<p>下面通过图解的方式解释A star 算法的工作流程。</p>
<center><img src="/image/algorithm/a26.jpg"  /></center>
<p>如图所示，绿色点为start设为A，红色点为goal设为B，蓝色点为不可通过的障碍物，黑色点为自由区域。目标是规划从A到B的路径。</p>
<h4 id="开始" tabindex="-1"><a class="header-anchor" href="#开始"><span>开始</span></a></h4>
<ol>
<li>搜索的从A点开始，首先将A点加入开启列表，此时取开启列表中的最小值，初始阶段开启列表中只有A一个节点，因此将A点从开启列表中取出，将A点加入关闭列表。</li>
<li>取出A点的相邻点，将相邻点加入开启列表。如图所示，此时A点即为相邻点的父节点。图中箭头指向父节点。将相邻点与A点加入追溯表中。</li>
</ol>
<center><img src="/image/algorithm/a27.jpg" /></center>
<h4 id="计算评分" tabindex="-1"><a class="header-anchor" href="#计算评分"><span>计算评分</span></a></h4>
<p>对相邻点，一次计算每一点的g，h，最后得到f = g + h。如图，节点的右下角为g值，左下角为h值，右上角为f。</p>
<center><img src="/image/algorithm/a28.jpg"  /></center>
<h4 id="选最小值-再次搜索" tabindex="-1"><a class="header-anchor" href="#选最小值-再次搜索"><span>选最小值，再次搜索</span></a></h4>
<ol>
<li>选出开启列表中的F值最小的节点，将此节点设为当前节点，移出开启列表，同时加入关闭列表。如图所示。</li>
<li>取出当前点的相邻点，当相邻点为关闭点或者墙时，不操作。此外，查看相邻点是否在开启列表中，如不在开启列表中将相邻点加入开启列表。如相邻点已经在开启列表中，则需要进行G值判定</li>
</ol>
<center><img src="/image/algorithm/a29.jpg"  /></center>
<h4 id="g值判定" tabindex="-1"><a class="header-anchor" href="#g值判定"><span>G值判定</span></a></h4>
<p>对于相邻点在开启列表中的，计算相邻点的G值，计算按照当前路径的G值与原开启列表中的G值大小。如果当前路径G值小于原开启列表G值，则相邻点以当前点为父节点，将相邻点与当前点加入追溯表中。同时更新此相邻点的H值。如果当前路径G值大于等于原开启列表G值，则相邻点按照原开启列表中的节点关系，H值不变。因为图示中，当前点G值比原开启列表G值大，因此节点关系按照原父子关系和F值。</p>
<h4 id="计算耗费评分-选最小值" tabindex="-1"><a class="header-anchor" href="#计算耗费评分-选最小值"><span>计算耗费评分，选最小值</span></a></h4>
<p>此时计算开启列表中F值最小的点，将此节点设为当前节点，并列最小F值的按添加开启列表顺序，以最新添加为佳。</p>
<center><img src="/image/algorithm/a30.jpg"  /></center>
<h4 id="重复搜索判定工作" tabindex="-1"><a class="header-anchor" href="#重复搜索判定工作"><span>重复搜索判定工作</span></a></h4>
<p>直到当goal点B加入开启列表中，则搜索完成。此时事实上生成的路径并一定是最佳路径，而是最快计算出的路径。若判定标准改为当goal点B加入关闭列表中搜索完成，则得出路径是最佳路径，但此时计算量较前者大。</p>
<p>当没有找到goal点，同时开启列表已空，则搜索不到路径。结束搜索。</p>
<center><img src="/image/algorithm/a31.jpg"  /></center>
<h4 id="生产路径" tabindex="-1"><a class="header-anchor" href="#生产路径"><span>生产路径</span></a></h4>
<p>由goal点B向上逐级追溯父节点，追溯至起点A，此时各节点组成的路径即使A*算法生成的最优路径。</p>
<center><img src="/image/algorithm/a32.jpg"  /></center>
<h2 id="三、java实现" tabindex="-1"><a class="header-anchor" href="#三、java实现"><span>三、Java实现</span></a></h2>
<p>需要一个Node类记录经过的每一个结点的信息，Node类的信息如下：</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token comment">//结点的属性</span>
<span class="token comment">//因为每个结点都需要存放在优先队列中，所以需要实现Comparable接口</span>
<span class="token keyword">class</span> <span class="token class-name">Node</span> <span class="token keyword">implements</span> <span class="token class-name">Comparable</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> <span class="token punctuation">{</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> x<span class="token punctuation">;</span>  <span class="token comment">//x坐标</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> y<span class="token punctuation">;</span>  <span class="token comment">//y坐标</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> <span class="token class-name">F</span><span class="token punctuation">;</span>  <span class="token comment">//F属性</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> <span class="token class-name">G</span><span class="token punctuation">;</span>  <span class="token comment">//G属性</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> <span class="token class-name">H</span><span class="token punctuation">;</span>  <span class="token comment">//H属性</span>
   <span class="token keyword">public</span> <span class="token class-name">Node</span> <span class="token class-name">Father</span><span class="token punctuation">;</span>    <span class="token comment">//此结点的上一个结点</span>
   <span class="token comment">//构造函数</span>
   <span class="token keyword">public</span> <span class="token class-name">Node</span><span class="token punctuation">(</span><span class="token keyword">int</span> x<span class="token punctuation">,</span> <span class="token keyword">int</span> y<span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token keyword">this</span><span class="token punctuation">.</span>x <span class="token operator">=</span> x<span class="token punctuation">;</span>
       <span class="token keyword">this</span><span class="token punctuation">.</span>y <span class="token operator">=</span> y<span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token comment">//通过结点的坐标和目标结点的坐标可以计算出F， G， H三个属性</span>
   <span class="token comment">//需要传入这个节点的上一个节点和最终的结点</span>
   <span class="token keyword">public</span> <span class="token keyword">void</span> <span class="token function">init_node</span><span class="token punctuation">(</span><span class="token class-name">Node</span> father<span class="token punctuation">,</span> <span class="token class-name">Node</span> end<span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>Father</span> <span class="token operator">=</span> father<span class="token punctuation">;</span>
       <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>Father</span> <span class="token operator">!=</span> <span class="token keyword">null</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
           <span class="token comment">//走过的步数等于父节点走过的步数加一</span>
           <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>G</span> <span class="token operator">=</span> <span class="token class-name"><span class="token namespace">father<span class="token punctuation">.</span></span>G</span> <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">;</span>
       <span class="token punctuation">}</span> <span class="token keyword">else</span> <span class="token punctuation">{</span> <span class="token comment">//父节点为空代表它是第一个结点</span>
           <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>G</span> <span class="token operator">=</span> <span class="token number">0</span><span class="token punctuation">;</span>
       <span class="token punctuation">}</span>
       <span class="token comment">//计算通过现在的结点的位置和最终结点的位置计算H值</span>
       <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>H</span> <span class="token operator">=</span> <span class="token class-name">Math</span><span class="token punctuation">.</span><span class="token function">abs</span><span class="token punctuation">(</span><span class="token keyword">this</span><span class="token punctuation">.</span>x <span class="token operator">-</span> end<span class="token punctuation">.</span>x<span class="token punctuation">)</span> <span class="token operator">+</span> <span class="token class-name">Math</span><span class="token punctuation">.</span><span class="token function">abs</span><span class="token punctuation">(</span><span class="token keyword">this</span><span class="token punctuation">.</span>y <span class="token operator">-</span> end<span class="token punctuation">.</span>y<span class="token punctuation">)</span><span class="token punctuation">;</span>
       <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>F</span> <span class="token operator">=</span> <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>G</span> <span class="token operator">+</span> <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>H</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token comment">// 用来进行和其他的Node类进行比较重写的方法</span>
   <span class="token annotation punctuation">@Override</span>
   <span class="token keyword">public</span> <span class="token keyword">int</span> <span class="token function">compareTo</span><span class="token punctuation">(</span><span class="token class-name">Node</span> o<span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token keyword">return</span> <span class="token class-name">Integer</span><span class="token punctuation">.</span><span class="token function">compare</span><span class="token punctuation">(</span><span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>F</span><span class="token punctuation">,</span> <span class="token class-name"><span class="token namespace">o<span class="token punctuation">.</span></span>F</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>接下来是Solution方法，所有的算法和数据结构都存放在这个方法中</p>
<ul>
<li>首先需要一个地图：</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token comment">// -1 -> 墙壁， 1 -> 起点  2 -> 终点</span>
<span class="token keyword">public</span> <span class="token keyword">int</span><span class="token punctuation">[</span><span class="token punctuation">]</span><span class="token punctuation">[</span><span class="token punctuation">]</span> map <span class="token operator">=</span> <span class="token punctuation">{</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">2</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span>  <span class="token number">0</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span><span class="token punctuation">,</span>
           <span class="token punctuation">{</span><span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">}</span>
           <span class="token punctuation">}</span><span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><blockquote>
<p>这个map就是上面的地图，由于判断地图是否越界过于麻烦，添加了辅助区域，让我们对【当前结点】进行扩展操作的时候判断扩展是否越界变得简单直观，只要不等于<code v-pre>-1</code>就代表没有越界，而不必判断<code v-pre>x</code>坐标和<code v-pre>y</code>坐标的范围。</p>
</blockquote>
<ul>
<li>
<p>有了地图之后我们还需要【Open表】，【Close表】</p>
</li>
<li>
<p>对结点进行扩展添加的时候除了需要判断结点是否合法，还需要判断结点是否在【Open表】和【Close表】中出现过</p>
</li>
<li>
<p>但是由于【Open表】不是可以遍历的数据结构，为了方便使用【Exist表】来记录当前结点是否出现在【Open表】中和【Close表】中</p>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token comment">//Open表用来存放能够到达的结点</span>
<span class="token comment">//Open表会自动把F值最小的结点放在队首</span>
<span class="token keyword">public</span> <span class="token class-name">PriorityQueue</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> <span class="token class-name">Open</span> <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">PriorityQueue</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token comment">//Close表用来存放已经到达的结点</span>
<span class="token keyword">public</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> <span class="token class-name">Close</span> <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token comment">//Exist表用来存放两张表出现过的结点</span>
<span class="token keyword">public</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> <span class="token class-name">Exist</span> <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></li>
<li>
<p>判断一个结点是否出现过（is_exist方法）</p>
</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">boolean</span> <span class="token function">is_exist</span><span class="token punctuation">(</span><span class="token class-name">Node</span> node<span class="token punctuation">)</span>
<span class="token punctuation">{</span>
   <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token class-name">Node</span> exist_node <span class="token operator">:</span> <span class="token class-name">Exist</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token comment">//如果这个结点在Exist中出现过，返回true</span>
       <span class="token keyword">if</span> <span class="token punctuation">(</span>node<span class="token punctuation">.</span>x <span class="token operator">==</span> exist_node<span class="token punctuation">.</span>x <span class="token operator">&amp;&amp;</span> node<span class="token punctuation">.</span>y <span class="token operator">==</span> exist_node<span class="token punctuation">.</span>y<span class="token punctuation">)</span> <span class="token punctuation">{</span>
           <span class="token keyword">return</span> <span class="token boolean">true</span><span class="token punctuation">;</span>
       <span class="token punctuation">}</span>
   <span class="token punctuation">}</span>
   <span class="token comment">//没有出现返回false</span>
   <span class="token keyword">return</span> <span class="token boolean">false</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>怎么判断一个结点是否合法（is_valid方法）</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token keyword">boolean</span> <span class="token function">is_valid</span><span class="token punctuation">(</span><span class="token keyword">int</span> x<span class="token punctuation">,</span> <span class="token keyword">int</span> y<span class="token punctuation">)</span> <span class="token punctuation">{</span>
   <span class="token comment">// 如果结点的位置在地图上是-1，则不合法</span>
   <span class="token keyword">if</span> <span class="token punctuation">(</span>map<span class="token punctuation">[</span>x<span class="token punctuation">]</span><span class="token punctuation">[</span>y<span class="token punctuation">]</span> <span class="token operator">==</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">)</span> <span class="token keyword">return</span> <span class="token boolean">false</span><span class="token punctuation">;</span>
   <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token class-name">Node</span> node <span class="token operator">:</span> <span class="token class-name">Exist</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token comment">//如果结点出现过，不合法</span>
       <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">is_exist</span><span class="token punctuation">(</span><span class="token keyword">new</span> <span class="token class-name">Node</span><span class="token punctuation">(</span>x<span class="token punctuation">,</span> y<span class="token punctuation">)</span><span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
               <span class="token keyword">return</span> <span class="token boolean">false</span><span class="token punctuation">;</span>
       <span class="token punctuation">}</span>
   <span class="token punctuation">}</span>
   <span class="token comment">//以上情况都没有则合法</span>
   <span class="token keyword">return</span> <span class="token boolean">true</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>怎么扩展【当前结点】的【上】【下】【左】【右】四个方向的结点(extend_current_node方法)</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> <span class="token function">extend_current_node</span><span class="token punctuation">(</span><span class="token class-name">Node</span> current_node<span class="token punctuation">)</span> <span class="token punctuation">{</span>
   <span class="token comment">//获取当前结点的x, y</span>
   <span class="token keyword">int</span> x <span class="token operator">=</span> current_node<span class="token punctuation">.</span>x<span class="token punctuation">;</span>
   <span class="token keyword">int</span> y <span class="token operator">=</span> current_node<span class="token punctuation">.</span>y<span class="token punctuation">;</span>
   <span class="token comment">//如果当前结点的邻结点合法，就加入到neighbour_node</span>
   <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> neighbour_node <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">is_valid</span><span class="token punctuation">(</span>x <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">,</span> y<span class="token punctuation">)</span><span class="token punctuation">)</span>
   <span class="token punctuation">{</span>
       <span class="token class-name">Node</span> node <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Node</span><span class="token punctuation">(</span>x <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">,</span> y<span class="token punctuation">)</span><span class="token punctuation">;</span>
       neighbour_node<span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">is_valid</span><span class="token punctuation">(</span>x <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">,</span> y<span class="token punctuation">)</span><span class="token punctuation">)</span>
   <span class="token punctuation">{</span>
       <span class="token class-name">Node</span> node <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Node</span><span class="token punctuation">(</span>x <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">,</span> y<span class="token punctuation">)</span><span class="token punctuation">;</span>
       neighbour_node<span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">is_valid</span><span class="token punctuation">(</span>x<span class="token punctuation">,</span> y <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
   <span class="token punctuation">{</span>
       <span class="token class-name">Node</span> node <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Node</span><span class="token punctuation">(</span>x<span class="token punctuation">,</span> y <span class="token operator">+</span> <span class="token number">1</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
       neighbour_node<span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token function">is_valid</span><span class="token punctuation">(</span>x<span class="token punctuation">,</span> y <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">)</span><span class="token punctuation">)</span>
   <span class="token punctuation">{</span>
       <span class="token class-name">Node</span> node <span class="token operator">=</span> <span class="token keyword">new</span> <span class="token class-name">Node</span><span class="token punctuation">(</span>x<span class="token punctuation">,</span> y <span class="token operator">-</span> <span class="token number">1</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
       neighbour_node<span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token punctuation">}</span>
   <span class="token comment">//返回合法的邻结点们</span>
   <span class="token keyword">return</span> neighbour_node<span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>Astar寻路算法具体实现(astarSearch方法)</li>
</ul>
<div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre v-pre class="language-java"><code><span class="token keyword">public</span> <span class="token class-name">Node</span> <span class="token function">astarSearch</span><span class="token punctuation">(</span><span class="token class-name">Node</span> start<span class="token punctuation">,</span> <span class="token class-name">Node</span> end<span class="token punctuation">)</span> <span class="token punctuation">{</span>
   <span class="token comment">//把第一个开始的结点加入到Open表中</span>
   <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>Open</span><span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>start<span class="token punctuation">)</span><span class="token punctuation">;</span>
   <span class="token class-name"><span class="token namespace">this<span class="token punctuation">.</span></span>Exist</span><span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>start<span class="token punctuation">)</span><span class="token punctuation">;</span>
   
   <span class="token comment">//主循环</span>
   <span class="token keyword">while</span> <span class="token punctuation">(</span><span class="token class-name">Open</span><span class="token punctuation">.</span><span class="token function">size</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">></span> <span class="token number">0</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
       <span class="token comment">//取优先队列顶部元素并且把这个元素从Open表中删除</span>
       <span class="token class-name">Node</span> current_node <span class="token operator">=</span> <span class="token class-name">Open</span><span class="token punctuation">.</span><span class="token function">poll</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
       
       <span class="token comment">//将这个结点加入到Close表中</span>
       <span class="token class-name">Close</span><span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>current_node<span class="token punctuation">)</span><span class="token punctuation">;</span>
       <span class="token comment">//对【当前结点】进行扩展，得到一个邻居结点数组</span>
       <span class="token class-name">ArrayList</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">Node</span><span class="token punctuation">></span></span> neighbour_node <span class="token operator">=</span> <span class="token function">extend_current_node</span><span class="token punctuation">(</span>current_node<span class="token punctuation">)</span><span class="token punctuation">;</span>
       <span class="token comment">//对这个邻居数组遍历，看是否有目标结点出现</span>
       <span class="token keyword">for</span> <span class="token punctuation">(</span><span class="token class-name">Node</span> node <span class="token operator">:</span> neighbour_node<span class="token punctuation">)</span> <span class="token punctuation">{</span>
           <span class="token keyword">if</span> <span class="token punctuation">(</span>node<span class="token punctuation">.</span>x <span class="token operator">==</span> end<span class="token punctuation">.</span>x <span class="token operator">&amp;&amp;</span> node<span class="token punctuation">.</span>y <span class="token operator">==</span> end<span class="token punctuation">.</span>y<span class="token punctuation">)</span> <span class="token punctuation">{</span><span class="token comment">//找到目标结点就返回</span>
               <span class="token comment">//init_node操作把这个邻居结点的父节点设置为当前结点</span>
               <span class="token comment">//并且计算出G， F， H等值</span>
               node<span class="token punctuation">.</span><span class="token function">init_node</span><span class="token punctuation">(</span>current_node<span class="token punctuation">,</span>end<span class="token punctuation">)</span><span class="token punctuation">;</span>
               <span class="token keyword">return</span> node<span class="token punctuation">;</span>
           <span class="token punctuation">}</span>
           <span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token operator">!</span><span class="token function">is_exist</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>  
               <span class="token comment">//没出现过的结点加入到Open表中并且设置父节点</span>
               <span class="token comment">//进行计算对G, F, H 等值</span>
               node<span class="token punctuation">.</span><span class="token function">init_node</span><span class="token punctuation">(</span>current_node<span class="token punctuation">,</span> end<span class="token punctuation">)</span><span class="token punctuation">;</span>
               <span class="token class-name">Open</span><span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
               <span class="token class-name">Exist</span><span class="token punctuation">.</span><span class="token function">add</span><span class="token punctuation">(</span>node<span class="token punctuation">)</span><span class="token punctuation">;</span>
           <span class="token punctuation">}</span>
       <span class="token punctuation">}</span>
   <span class="token punctuation">}</span>
   <span class="token comment">//如果遍历完所有出现的结点都没有找到最终的结点，返回null</span>
   <span class="token keyword">return</span> <span class="token keyword">null</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


