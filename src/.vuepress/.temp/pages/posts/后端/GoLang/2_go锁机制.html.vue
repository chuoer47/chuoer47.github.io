<template><div><h1 id="golang锁机制" tabindex="-1"><a class="header-anchor" href="#golang锁机制"><span>GoLang锁机制</span></a></h1>
<p>虽然Golang Mutex只有短短的200多行，但是已经是一个极其丰富、精炼的组件，有极其复杂的状态控制.</p>
<h2 id="一、sync-mutex设计v1-v2版本" tabindex="-1"><a class="header-anchor" href="#一、sync-mutex设计v1-v2版本"><span>一、sync.Mutex设计v1/v2版本</span></a></h2>
<p>其实如果我们去追溯 Mutex 的演进历史，会发现，Mutex最开始是一个非常简单的实现，简单到难以置信的地步，是Go开发者们经过了好几轮的优化才变成了现在这么一个非常复杂的数据结构，这是一个逐步完善的过程.于是我想如果我们是设计者，我们会怎么去设计去优化一个锁的实现呢？</p>
<p>Mutex是Golang 中的锁，主要是控制并发访问资源，保护共享资源。</p>
<h3 id="_1、首先从最简单的锁开始设计" tabindex="-1"><a class="header-anchor" href="#_1、首先从最简单的锁开始设计"><span>1、首先从最简单的锁开始设计</span></a></h3>
<p>定义一个int变量，0代表没有加锁，1代表加锁了，初始状态为0。</p>
<p>然后使用一个For循环去尝试加锁，加锁时使用Atomic的CAS尝试将值从0改为1，如果成功了就获取锁，如果没有成功就继续For循环也就是自旋尝试获取锁，直到成功为止。</p>
<p>拿到锁的线程想解锁的话也是通过Atomic的CAS尝试将值从1改为0。</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	key  <span class="token builtin">int32</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">)</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">问题</p>
<p>性能会比较差，由于加锁是通过自旋实现的，如果有很多Goroutine在竞争锁的话，会导致CPU资源被打满，同时也是浪费资源</p>
</div>
<h3 id="_2、利用信号量去实现goroutine的睡眠和唤醒" tabindex="-1"><a class="header-anchor" href="#_2、利用信号量去实现goroutine的睡眠和唤醒"><span>2、利用信号量去实现Goroutine的睡眠和唤醒</span></a></h3>
<p>利用信号量去实现Goroutine的睡眠和唤醒，避免自旋浪费CPU</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	key  <span class="token builtin">int32</span>
	sema <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token operator">==</span>  <span class="token number">1</span> <span class="token punctuation">{</span>  <span class="token comment">//值从0变为1，则证明加锁成功</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>
	runtime<span class="token punctuation">.</span><span class="token function">Semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span> <span class="token comment">//等待信号量</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span> <span class="token comment">//值-1后，变为0证明没有协程等待锁了，可以直接返回</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>
	runtime<span class="token punctuation">.</span><span class="token function">Semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span> <span class="token comment">//唤起信号量上的协程</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>这版的实现解决了自旋的性能问题，其次由于信号量有一个先进先出的等待队列，所以也可以保证竞争锁的Goroutine是先到先得的，保证了公平。<strong>但是这样的公平其实在调度层面又是效率不高的</strong>。</p>
<p><strong>示例:</strong></p>
<p>假设有三个协程分别是G1，G2，G3。G1首先加锁成功了，然后执行业务逻辑。期间G2想加锁发现加不上，就进入了信号量的等待队列，这个时候G2可能已经被调度器从M上调走了。然后G1解锁，这个时候G3想加锁发现由于G2在他前面进行了等待，所以导致G3加不上。<strong>这种情况由于G2没有获得CPU时间片，但是G3已经获得了CPU时间片，所以直接把锁给G3从整体上来说，效率会更加高些</strong></p>
<p>本质是想给处于运行态的Goroutine 直接获得锁的机会，将上面的代码修改为：
这样新来的Goroutine可以有一次直接获取锁的机会</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	key  <span class="token builtin">int32</span>
	sema <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
		runtime<span class="token punctuation">.</span><span class="token function">Semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
		runtime<span class="token punctuation">.</span><span class="token function">Semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">问题</p>
<p><strong>惊群效应</strong></p>
<ul>
<li>假设先有三个协程G1，G2，G3。G1加锁成功，G2，G3进入了信号量的等待队列。然后G1解锁，G2被唤醒，这个时候来了个新协程G4，G2和G4一起竞争锁，G4竞争成功。然后G4很快执行完进行解锁，然后G3就被唤醒了，这个时候就存在G2，G3一起竞争锁的场景。如果在高并发场景，这样的唤醒竞争还会更加激烈。同时也违背了G2，G3在信号量上先来先得的设计。</li>
</ul>
</div>
<h3 id="_3、解决惊群效应" tabindex="-1"><a class="header-anchor" href="#_3、解决惊群效应"><span>3、解决惊群效应</span></a></h3>
<p>总结下我们的锁还需要以下额外能力：</p>
<ul>
<li>1、信号量：阻塞唤醒协程</li>
<li>2、知道当前有多少协程阻塞在信号量上</li>
<li>3、避免「惊群效应」</li>
</ul>
<p>按照一般的设计我们需要使用三个变量控制，类似下面这样</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	key  <span class="token builtin">int32</span>  <span class="token comment">//控制是否加锁成功，1：加锁 0：未加锁</span>
  woken <span class="token builtin">bool</span>  <span class="token comment">//是否已经有协程被唤醒了</span>
  waiter <span class="token builtin">int32</span> <span class="token comment">//记录当前有多少协程阻塞在信号量上</span>
	sema <span class="token builtin">uint32</span> <span class="token comment">//信号量</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>很多框架组件设计都会充分利用变量的高位低位，定义int32的变量state将其分为三部分：</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	state <span class="token builtin">int32</span>
	sema  <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><figure><img src="/image/go/go1.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>那么加锁的逻辑就变成了</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">const</span> <span class="token punctuation">(</span>
	mutexLocked      <span class="token operator">=</span> <span class="token number">1</span> <span class="token comment">// mutex is locked</span>
	mutexWoken       <span class="token operator">=</span> <span class="token number">2</span> 
	mutexWaiterShift <span class="token operator">=</span> <span class="token number">2</span>
<span class="token punctuation">)</span>

<span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	state <span class="token builtin">int32</span>
	sema  <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">//给新来的协程直接加锁的机会</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> mutexLocked<span class="token punctuation">)</span> <span class="token punctuation">{</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>

	<span class="token comment">//上面没有加锁成功，尝试在接下来的唤醒中去竞争锁</span>
	awoke <span class="token operator">:=</span> <span class="token boolean">false</span> <span class="token comment">//表示当前协程是不是被唤醒的</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		old <span class="token operator">:=</span> m<span class="token punctuation">.</span>state
		<span class="token builtin">new</span> <span class="token operator">:=</span> old <span class="token operator">|</span> mutexLocked <span class="token comment">// 设置锁标志位为1</span>
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexLocked <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token builtin">new</span> <span class="token operator">=</span> old <span class="token operator">+</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift <span class="token comment">//锁没有释放，当前协程可能会阻塞在信号量上，先将waiter+1</span>
		<span class="token punctuation">}</span>
		<span class="token keyword">if</span> awoke <span class="token punctuation">{</span> <span class="token comment">//尝试清除唤醒标志</span>
			<span class="token builtin">new</span> <span class="token operator">&amp;^=</span> mutexWoken
		<span class="token punctuation">}</span>

		<span class="token comment">//这里尝试将state从old设置为new。如果代码能够执行到这步，代表了可能发生以下几种情况的一种或者多种</span>
		<span class="token comment">//1、当前协程尝试加锁</span>
		<span class="token comment">//2、waiter+1</span>
		<span class="token comment">//3、清除唤醒标志</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">if</span> old <span class="token operator">&amp;</span> mutexLocked <span class="token operator">==</span> <span class="token number">0</span><span class="token punctuation">{</span>
				<span class="token comment">//成功获取到锁了，返回</span>
				<span class="token keyword">break</span>
			<span class="token punctuation">}</span>
			
			<span class="token comment">//没有获取到锁，阻塞在信号量上</span>
			runtime<span class="token punctuation">.</span><span class="token function">Semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
			awoke <span class="token operator">=</span> <span class="token boolean">true</span> <span class="token comment">//执行到这步，证明是被信号量唤醒的，设置唤醒标志</span>
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>对上面的一些运算进行解释：</p>
<ul>
<li>1、new := old | mutexLocked 将state的最低位设置为1，即代表想加锁；</li>
<li>2、new = old + 1&lt;&lt;mutexWaiterShift，首先会执行1&lt;&lt;mutexWaiterShift，即将1左移两位，移位后的值在加上old。1左移两位即避开了mutexLocked和mutexWoken，然后再跟old相加，就可以实现waiter+1。</li>
<li>3、new &amp;^= mutexWoken，&amp;^ 是一个位清除运算符（bit clear operator，它的作用是将第一个操作数（左操作数）中的位与第二个操作数（右操作数）相对应的位进行比较。如果右操作数的位为 1，则将左操作数的相应位清零（设置为 0）。如果右操作数的位为 0，则左操作数的相应位保持不变。</li>
</ul>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token builtin">new</span> <span class="token operator">:=</span> atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token operator">-</span>mutexLocked<span class="token punctuation">)</span>
	<span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token builtin">new</span><span class="token operator">+</span>mutexLocked<span class="token punctuation">)</span><span class="token operator">&amp;</span>mutexLocked <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		<span class="token function">panic</span><span class="token punctuation">(</span><span class="token string">"sync: unlock of unlocked mutex"</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span>
	
	old <span class="token operator">:=</span> <span class="token builtin">new</span>
	<span class="token keyword">for</span><span class="token punctuation">{</span>
		<span class="token comment">//以下情况都直接结束，不继续往下：</span>
		<span class="token comment">//1、如果没有人阻塞在信号量上了</span>
		<span class="token comment">//2、其他人加锁了</span>
		<span class="token comment">//3、已经有人唤醒协程了</span>
		<span class="token keyword">if</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">||</span> old <span class="token operator">&amp;</span> <span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexWoken<span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">0</span><span class="token punctuation">{</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
		
		<span class="token builtin">new</span> <span class="token operator">=</span> <span class="token punctuation">(</span>old <span class="token operator">-</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift<span class="token punctuation">)</span> <span class="token operator">|</span> mutexWoken <span class="token comment">//waiter-1 并且将唤醒标志置为1</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span>old<span class="token punctuation">,</span><span class="token builtin">new</span><span class="token punctuation">)</span><span class="token punctuation">{</span>
			<span class="token comment">//如果cas执行成功就唤醒一个协程</span>
			runtime<span class="token punctuation">.</span><span class="token function">Semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
		old <span class="token operator">=</span> m<span class="token punctuation">.</span>state
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>这个设计就是 2011年 Russ Cox 的第二版的Mutex实现逻辑</strong></p>
<h3 id="_4、golang原版mutex" tabindex="-1"><a class="header-anchor" href="#_4、golang原版mutex"><span>4、golang原版Mutex</span></a></h3>
<p>V1版本极其简单：<a href="https://link.juejin.cn/?target=https%3A%2F%2Fgithub.com%2Fgolang%2Fgo%2Fblob%2Fbf3dd3f0efe5b45947a991e22660c62d4ce6b671%2Fsrc%2Flib%2Fsync%2Fmutex.go" target="_blank" rel="noopener noreferrer">github地址</a></p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token comment">// Copyright 2009 The Go Authors. All rights reserved.</span>
<span class="token comment">// Use of this source code is governed by a BSD-style</span>
<span class="token comment">// license that can be found in the LICENSE file.</span>

<span class="token keyword">package</span> sync

<span class="token keyword">package</span> <span class="token keyword">func</span> <span class="token function">cas</span><span class="token punctuation">(</span>val <span class="token operator">*</span><span class="token builtin">int32</span><span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span> <span class="token builtin">int32</span><span class="token punctuation">)</span> <span class="token builtin">bool</span>

export <span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	key <span class="token builtin">int32</span><span class="token punctuation">;</span>
	sema <span class="token builtin">int32</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token function">xadd</span><span class="token punctuation">(</span>val <span class="token operator">*</span><span class="token builtin">int32</span><span class="token punctuation">,</span> delta <span class="token builtin">int32</span><span class="token punctuation">)</span> <span class="token punctuation">(</span><span class="token builtin">new</span> <span class="token builtin">int32</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		v <span class="token operator">:=</span> <span class="token operator">*</span>val<span class="token punctuation">;</span>
		<span class="token keyword">if</span> <span class="token function">cas</span><span class="token punctuation">(</span>val<span class="token punctuation">,</span> v<span class="token punctuation">,</span> v<span class="token operator">+</span>delta<span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">return</span> v<span class="token operator">+</span>delta<span class="token punctuation">;</span>
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span>
	<span class="token function">panic</span><span class="token punctuation">(</span><span class="token string">"unreached"</span><span class="token punctuation">)</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> <span class="token function">xadd</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">1</span> <span class="token punctuation">{</span>
		<span class="token comment">// changed from 0 to 1; we hold lock</span>
		<span class="token keyword">return</span><span class="token punctuation">;</span>
	<span class="token punctuation">}</span>
	sys<span class="token punctuation">.</span><span class="token function">semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> <span class="token function">xadd</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>key<span class="token punctuation">,</span> <span class="token operator">-</span><span class="token number">1</span><span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		<span class="token comment">// changed from 1 to 0; no contention</span>
		<span class="token keyword">return</span><span class="token punctuation">;</span>
	<span class="token punctuation">}</span>
	sys<span class="token punctuation">.</span><span class="token function">semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>V2版本增加了点细节：<a href="https://link.juejin.cn/?target=https%3A%2F%2Fgithub.com%2Fgolang%2Fgo%2Fblob%2Frelease-branch.go1%2Fsrc%2Fpkg%2Fsync%2Fmutex.go" target="_blank" rel="noopener noreferrer">github地址</a></p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token comment">// Copyright 2009 The Go Authors. All rights reserved.</span>
<span class="token comment">// Use of this source code is governed by a BSD-style</span>
<span class="token comment">// license that can be found in the LICENSE file.</span>

<span class="token comment">// Package sync provides basic synchronization primitives such as mutual</span>
<span class="token comment">// exclusion locks.  Other than the Once and WaitGroup types, most are intended</span>
<span class="token comment">// for use by low-level library routines.  Higher-level synchronization is</span>
<span class="token comment">// better done via channels and communication.</span>
<span class="token comment">//</span>
<span class="token comment">// Values containing the types defined in this package should not be copied.</span>
<span class="token keyword">package</span> sync

<span class="token keyword">import</span> <span class="token string">"sync/atomic"</span>

<span class="token comment">// A Mutex is a mutual exclusion lock.</span>
<span class="token comment">// Mutexes can be created as part of other structures;</span>
<span class="token comment">// the zero value for a Mutex is an unlocked mutex.</span>
<span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	state <span class="token builtin">int32</span>
	sema  <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token comment">// A Locker represents an object that can be locked and unlocked.</span>
<span class="token keyword">type</span> Locker <span class="token keyword">interface</span> <span class="token punctuation">{</span>
	<span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
	<span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
<span class="token punctuation">}</span>

<span class="token keyword">const</span> <span class="token punctuation">(</span>
	mutexLocked <span class="token operator">=</span> <span class="token number">1</span> <span class="token operator">&lt;&lt;</span> <span class="token boolean">iota</span> <span class="token comment">// mutex is locked</span>
	mutexWoken
	mutexWaiterShift <span class="token operator">=</span> <span class="token boolean">iota</span>
<span class="token punctuation">)</span>

<span class="token comment">// Lock locks m.</span>
<span class="token comment">// If the lock is already in use, the calling goroutine</span>
<span class="token comment">// blocks until the mutex is available.</span>
<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">// Fast path: grab unlocked mutex.</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> mutexLocked<span class="token punctuation">)</span> <span class="token punctuation">{</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>

	awoke <span class="token operator">:=</span> <span class="token boolean">false</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		old <span class="token operator">:=</span> m<span class="token punctuation">.</span>state
		<span class="token builtin">new</span> <span class="token operator">:=</span> old <span class="token operator">|</span> mutexLocked
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexLocked <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token builtin">new</span> <span class="token operator">=</span> old <span class="token operator">+</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift
		<span class="token punctuation">}</span>
		<span class="token keyword">if</span> awoke <span class="token punctuation">{</span>
			<span class="token comment">// The goroutine has been woken from sleep,</span>
			<span class="token comment">// so we need to reset the flag in either case.</span>
			<span class="token builtin">new</span> <span class="token operator">&amp;^=</span> mutexWoken
		<span class="token punctuation">}</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexLocked <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				<span class="token keyword">break</span>
			<span class="token punctuation">}</span>
			<span class="token function">runtime_Semacquire</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
			awoke <span class="token operator">=</span> <span class="token boolean">true</span>
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

<span class="token comment">// Unlock unlocks m.</span>
<span class="token comment">// It is a run-time error if m is not locked on entry to Unlock.</span>
<span class="token comment">//</span>
<span class="token comment">// A locked Mutex is not associated with a particular goroutine.</span>
<span class="token comment">// It is allowed for one goroutine to lock a Mutex and then</span>
<span class="token comment">// arrange for another goroutine to unlock it.</span>
<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">// Fast path: drop lock bit.</span>
	<span class="token builtin">new</span> <span class="token operator">:=</span> atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token operator">-</span>mutexLocked<span class="token punctuation">)</span>
	<span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token builtin">new</span><span class="token operator">+</span>mutexLocked<span class="token punctuation">)</span><span class="token operator">&amp;</span>mutexLocked <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		<span class="token function">panic</span><span class="token punctuation">(</span><span class="token string">"sync: unlock of unlocked mutex"</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span>

	old <span class="token operator">:=</span> <span class="token builtin">new</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		<span class="token comment">// If there are no waiters or a goroutine has already</span>
		<span class="token comment">// been woken or grabbed the lock, no need to wake anyone.</span>
		<span class="token keyword">if</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">||</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexWoken<span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
		<span class="token comment">// Grab the right to wake someone.</span>
		<span class="token builtin">new</span> <span class="token operator">=</span> <span class="token punctuation">(</span>old <span class="token operator">-</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift<span class="token punctuation">)</span> <span class="token operator">|</span> mutexWoken
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token function">runtime_Semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">)</span>
			<span class="token keyword">return</span>
		<span class="token punctuation">}</span>
		old <span class="token operator">=</span> m<span class="token punctuation">.</span>state
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="二、sync-mutex设计v3-v4版本" tabindex="-1"><a class="header-anchor" href="#二、sync-mutex设计v3-v4版本"><span>二、sync.Mutex设计v3/v4版本</span></a></h2>
<p>v2版本存在的问题:</p>
<p>现在实现的锁的确给了新来的Goroutine直接获取锁的机会，但是还不够优雅。比如说，新Goroutine尝试获取锁失败的那一刻，锁就被释放了，但是新Goroutine需要等到下一次信号量唤醒加调度才有机会再次获取锁，这样其实浪费了新Goroutine的CPU时间</p>
<p>考虑到这种情况，可以尝试给新的Goroutine多次获取锁的机会，说白了就是允许自旋，但是需要给自旋加一些限制条件，避免最开始提到的性能问题</p>
<h3 id="_1、允许自旋" tabindex="-1"><a class="header-anchor" href="#_1、允许自旋"><span>1、允许自旋</span></a></h3>
<p>首先需要限制自旋的次数，其次操作系统的处理器个数和Golang 调度的P个数都必须大于1，否则就会是串行，自旋就没有意义了。</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">const</span> <span class="token punctuation">(</span>
	mutexLocked      <span class="token operator">=</span> <span class="token number">1</span> <span class="token comment">//    mutex    is    locked</span>
	mutexWoken       <span class="token operator">=</span> <span class="token number">2</span>
	mutexWaiterShift <span class="token operator">=</span> <span class="token number">2</span>
<span class="token punctuation">)</span>

<span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	state <span class="token builtin">int32</span>
	sema  <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">// 给新来的协程直接加锁的机会</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> mutexLocked<span class="token punctuation">)</span> <span class="token punctuation">{</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>

	<span class="token comment">// 上面没有加锁成功，尝试在接下来的唤醒中去竞争锁</span>
	awoke <span class="token operator">:=</span> <span class="token boolean">false</span> <span class="token comment">//表示当前协程是不是被唤醒的</span>
	iter <span class="token operator">:=</span> <span class="token number">0</span>      <span class="token comment">//记录当前自旋的次数</span>
	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		old <span class="token operator">:=</span> m<span class="token punctuation">.</span>state
		<span class="token builtin">new</span> <span class="token operator">:=</span> old <span class="token operator">|</span> mutexLocked <span class="token comment">//    设置锁标志位为1</span>
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexLocked <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token comment">// 判断是否满足自旋条件</span>
			<span class="token keyword">if</span> <span class="token function">runtime_canSpin</span><span class="token punctuation">(</span>iter<span class="token punctuation">)</span> <span class="token punctuation">{</span>
				<span class="token keyword">if</span> <span class="token operator">!</span>awoke <span class="token operator">&amp;&amp;</span> old<span class="token operator">&amp;</span>mutexWoken <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">&amp;&amp;</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">!=</span> <span class="token number">0</span> <span class="token operator">&amp;&amp;</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> old<span class="token operator">|</span>mutexWoken<span class="token punctuation">)</span> <span class="token punctuation">{</span>
					awoke <span class="token operator">=</span> <span class="token boolean">true</span>
				<span class="token punctuation">}</span>

				<span class="token comment">// 内部调用procyield函数，该函数也是汇编语言实现。</span>
				<span class="token comment">// 函数内部循环调用PAUSE指令。减少cpu的消耗，节省电量。</span>
				<span class="token comment">// 指令的本质功能：让加锁失败时cpu睡眠30个（about）clock，从而使得读操作的频率低很多。流水线重排的代价也会小很多。</span>
				<span class="token function">runtime_doSpin</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
				iter<span class="token operator">++</span>
				<span class="token keyword">continue</span>
			<span class="token punctuation">}</span>

			<span class="token builtin">new</span> <span class="token operator">=</span> old <span class="token operator">+</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift <span class="token comment">//锁没有释放，当前协程可能会阻塞在信号量上，先将waiter+1</span>
		<span class="token punctuation">}</span>
		··· <span class="token comment">//剩下的不变</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>判断是否可以自旋</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token comment">//判断是否可以自旋，同时满足以下4个条件才能自旋：</span>
<span class="token comment">//1、自旋次数小于4次</span>
<span class="token comment">//2、cpu核数大于1</span>
<span class="token comment">//3、GOMAXPROCS>1</span>
<span class="token comment">//4、running P > 1 并且 P队列为空</span>
<span class="token keyword">func</span> <span class="token function">sync_runtime_canSpin</span><span class="token punctuation">(</span>i <span class="token builtin">int</span><span class="token punctuation">)</span> <span class="token builtin">bool</span> <span class="token punctuation">{</span>
   <span class="token keyword">if</span> i <span class="token operator">>=</span> active_spin <span class="token operator">||</span> ncpu <span class="token operator">&lt;=</span> <span class="token number">1</span> <span class="token operator">||</span> gomaxprocs <span class="token operator">&lt;=</span> <span class="token function">int32</span><span class="token punctuation">(</span>sched<span class="token punctuation">.</span>npidle<span class="token operator">+</span>sched<span class="token punctuation">.</span>nmspinning<span class="token punctuation">)</span><span class="token operator">+</span><span class="token number">1</span> <span class="token punctuation">{</span>
    	<span class="token keyword">return</span> <span class="token boolean">false</span>
   <span class="token punctuation">}</span>
   <span class="token keyword">if</span> p <span class="token operator">:=</span> <span class="token function">getg</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">.</span>m<span class="token punctuation">.</span>p<span class="token punctuation">;</span> p<span class="token punctuation">.</span>runqhead <span class="token operator">!=</span> p<span class="token punctuation">.</span>runqtail <span class="token punctuation">{</span>
    	<span class="token keyword">return</span> <span class="token boolean">false</span>
   <span class="token punctuation">}</span>
   <span class="token keyword">return</span> <span class="token boolean">true</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>解锁部分没有变化</p>
<p>通过自旋，对于临界区代码执行非常短的场景来说，这是一个非常好的优化。因为临界区的代码耗时很短，锁很快就能释放，而抢夺锁的 goroutine不用通过休眠唤醒方式等待调度，直接自旋几次，可能就获得了锁</p>
<div class="hint-container tip">
<p class="hint-container-title">问题</p>
<p>因为新来的 goroutine 也参与竞争，有可能每次都会被新来的 goroutine 抢到获取锁的机会，在极端情况下，等待中的goroutine可能会一直获取不到锁，就会导致【饥饿】</p>
</div>
<h3 id="_2、解决饥饿问题" tabindex="-1"><a class="header-anchor" href="#_2、解决饥饿问题"><span>2、解决饥饿问题</span></a></h3>
<p>可以考虑给锁加一个标识，比如我们可以检测当一个老goroutine超过一定时间都没有获取到锁，那么他就给锁打上一个【饥饿】的标识，新来的goroutine发现存在该标识就不再通过自旋抢锁，而是直接进入信号量的等待队列的队尾。同时把老goroutine移动到信号量等待队列的队头，这样老goroutine下次就可以直接获取到锁了。</p>
<figure><img src="/image/go/go2.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p><strong>加锁部分</strong></p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">type</span> Mutex <span class="token keyword">struct</span> <span class="token punctuation">{</span>
	state <span class="token builtin">int32</span>
	sema  <span class="token builtin">uint32</span>
<span class="token punctuation">}</span>

<span class="token keyword">const</span> <span class="token punctuation">(</span>
	mutexLocked      <span class="token operator">=</span> <span class="token number">1</span> <span class="token comment">//  mutex  is  locked</span>
	mutexWoken       <span class="token operator">=</span> <span class="token number">2</span>
	mutexWaiterShift <span class="token operator">=</span> <span class="token number">3</span>
	mutexStarving    <span class="token operator">=</span> <span class="token number">4</span> <span class="token comment">//新增字段，标识</span>
<span class="token punctuation">)</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Lock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token comment">// 给新来的协程直接加锁的机会</span>
	<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> mutexLocked<span class="token punctuation">)</span> <span class="token punctuation">{</span>
		<span class="token keyword">return</span>
	<span class="token punctuation">}</span>

	m<span class="token punctuation">.</span><span class="token function">lockSlow</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">lockSlow</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">var</span> waitStartTime <span class="token builtin">int64</span> <span class="token comment">//表示等待了多久还没获取到锁</span>
	starving <span class="token operator">:=</span> <span class="token boolean">false</span>       <span class="token comment">//表示当前锁是否处于饥饿状态</span>
	awoke <span class="token operator">:=</span> <span class="token boolean">false</span>          <span class="token comment">//表示当前协程是不是被唤醒的</span>
	iter <span class="token operator">:=</span> <span class="token number">0</span>               <span class="token comment">//自旋次数</span>
	old <span class="token operator">:=</span> m<span class="token punctuation">.</span>state

	<span class="token keyword">for</span> <span class="token punctuation">{</span>
		<span class="token comment">// 满足以下条件才能进入自旋：</span>
		<span class="token comment">// 1、锁不是饥饿状态，并且没有获取到锁</span>
		<span class="token comment">// 2、满足自旋条件runtime_canSpin</span>
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexStarving<span class="token punctuation">)</span> <span class="token operator">==</span> mutexLocked <span class="token operator">&amp;&amp;</span> <span class="token function">runtime_canSpin</span><span class="token punctuation">(</span>iter<span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">if</span> <span class="token operator">!</span>awoke <span class="token operator">&amp;&amp;</span> old<span class="token operator">&amp;</span>mutexWoken <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">&amp;&amp;</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">!=</span> <span class="token number">0</span> <span class="token operator">&amp;&amp;</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> old<span class="token operator">|</span>mutexWoken<span class="token punctuation">)</span> <span class="token punctuation">{</span>
				awoke <span class="token operator">=</span> <span class="token boolean">true</span>
			<span class="token punctuation">}</span>

			<span class="token comment">// 内部调用procyield函数，该函数也是汇编语言实现。</span>
			<span class="token comment">// 函数内部循环调用PAUSE指令。减少cpu的消耗，节省电量。</span>
			<span class="token comment">// 指令的本质功能：让加锁失败时cpu睡眠30个（about）clock，从而使得读操作的频率低很多。流水线重排的代价也会小很多。</span>
			<span class="token function">runtime_doSpin</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
			iter<span class="token operator">++</span>
			old <span class="token operator">=</span> m<span class="token punctuation">.</span>state
			<span class="token keyword">continue</span>
		<span class="token punctuation">}</span>

		<span class="token builtin">new</span> <span class="token operator">:=</span> old

		<span class="token comment">// 如果当前锁不是饥饿状态，尝试将加锁标志置为1</span>
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexStarving <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token builtin">new</span> <span class="token operator">|=</span> mutexLocked
		<span class="token punctuation">}</span>

		<span class="token comment">// 锁没有释放，或者是饥饿模式，当前协程会阻塞在信号量上，将waiter+1</span>
		<span class="token keyword">if</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexStarving<span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token builtin">new</span> <span class="token operator">=</span> old <span class="token operator">+</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift
		<span class="token punctuation">}</span>

		<span class="token comment">// 已经等待超过了1ms，且锁被其他协程占用，则进入饥饿模式</span>
		<span class="token keyword">if</span> starving <span class="token operator">&amp;&amp;</span> old<span class="token operator">&amp;</span>mutexLocked <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
			<span class="token builtin">new</span> <span class="token operator">|=</span> mutexStarving
		<span class="token punctuation">}</span>

		<span class="token keyword">if</span> awoke <span class="token punctuation">{</span> <span class="token comment">//尝试清除唤醒标志</span>
			<span class="token keyword">if</span> <span class="token builtin">new</span><span class="token operator">&amp;</span>mutexWoken <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				<span class="token function">throw</span><span class="token punctuation">(</span><span class="token string">"sync:  inconsistent  mutex  state"</span><span class="token punctuation">)</span>
			<span class="token punctuation">}</span>
			<span class="token builtin">new</span> <span class="token operator">&amp;^=</span> mutexWoken
		<span class="token punctuation">}</span>

		<span class="token comment">// 这里尝试将state从old设置为new。如果代码能够执行到这步，代表了可能发生以下几种情况的一种或者多种</span>
		<span class="token comment">// 1、当前协程尝试加锁</span>
		<span class="token comment">// 2、waiter+1</span>
		<span class="token comment">// 3、清除唤醒标志</span>
		<span class="token comment">// 4、想将锁设置为饥饿模式</span>
		<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
			<span class="token keyword">if</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexStarving<span class="token punctuation">)</span> <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				<span class="token comment">// 不是饥饿状态，并且成功获取到锁了，返回</span>
				<span class="token keyword">break</span>
			<span class="token punctuation">}</span>

			<span class="token comment">// 是否已经等待过了</span>
			queueLifo <span class="token operator">:=</span> waitStartTime <span class="token operator">!=</span> <span class="token number">0</span>
			<span class="token keyword">if</span> waitStartTime <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				waitStartTime <span class="token operator">=</span> <span class="token function">runtime_nanotime</span><span class="token punctuation">(</span><span class="token punctuation">)</span>
			<span class="token punctuation">}</span>

			<span class="token comment">//	阻塞等待</span>
			<span class="token comment">// queueLifo 为 true，表示加入到队列头。否则，加入到队列尾。</span>
			<span class="token comment">//	(首次加入队列加入到队尾，不是首次加入则加入队头，这样等待最久的 goroutine 优先能够获取到锁。)</span>
			<span class="token function">runtime_SemacquireMutex</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">,</span> queueLifo<span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span>

			<span class="token comment">// 从等待队列中唤醒，根据等待时间，判断锁是否应该进入饥饿模式。</span>
			starving <span class="token operator">=</span> starving <span class="token operator">||</span> <span class="token function">runtime_nanotime</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token operator">-</span>waitStartTime <span class="token operator">></span> starvationThresholdNs

			<span class="token comment">// 如果锁已经是饥饿状态了，直接抢锁返回</span>
			<span class="token keyword">if</span> old<span class="token operator">&amp;</span>mutexStarving <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				<span class="token keyword">if</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexWoken<span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">0</span> <span class="token operator">||</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
					<span class="token function">throw</span><span class="token punctuation">(</span><span class="token string">"sync:  inconsistent  mutex  state"</span><span class="token punctuation">)</span>
				<span class="token punctuation">}</span>

				<span class="token comment">// 加锁并且等待者数量减一</span>
				delta <span class="token operator">:=</span> <span class="token function">int32</span><span class="token punctuation">(</span>mutexLocked <span class="token operator">-</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift<span class="token punctuation">)</span>

				<span class="token comment">//	清除饥饿状态的两种情况：</span>
				<span class="token comment">//</span>
				<span class="token comment">// .  如果不需要进入饥饿模式（当前被唤醒的  goroutine  的等待时间小于  1ms）</span>
				<span class="token comment">// . 原来的等待者数量为 1，说明是最后一个被唤醒的 goroutine。</span>
				<span class="token keyword">if</span> <span class="token operator">!</span>starving <span class="token operator">||</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">==</span> <span class="token number">1</span> <span class="token punctuation">{</span>
					<span class="token comment">// 清除饥饿状态</span>
					delta <span class="token operator">-=</span> mutexStarving
				<span class="token punctuation">}</span>

				<span class="token comment">// 设置状态，加锁</span>
				atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> delta<span class="token punctuation">)</span>
				<span class="token keyword">break</span>
			<span class="token punctuation">}</span>
			<span class="token comment">// 设置唤醒标记，重新抢占锁（会与那些运行中的  goroutine  一起竞争锁）</span>
			awoke <span class="token operator">=</span> <span class="token boolean">true</span>
			iter <span class="token operator">=</span> <span class="token number">0</span>
		<span class="token punctuation">}</span> <span class="token keyword">else</span> <span class="token punctuation">{</span>
			old <span class="token operator">=</span> m<span class="token punctuation">.</span>state
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span> <span class="token comment">//for</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>解锁部分</strong></p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">Unlock</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token builtin">new</span> <span class="token operator">:=</span> atomic<span class="token punctuation">.</span><span class="token function">AddInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> <span class="token operator">-</span>mutexLocked<span class="token punctuation">)</span>
	<span class="token comment">// 还有人阻塞在信号量上，需要进行唤醒</span>
	<span class="token keyword">if</span> <span class="token builtin">new</span> <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		m<span class="token punctuation">.</span><span class="token function">unlockSlow</span><span class="token punctuation">(</span><span class="token builtin">new</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span>

<span class="token keyword">func</span> <span class="token punctuation">(</span>m <span class="token operator">*</span>Mutex<span class="token punctuation">)</span> <span class="token function">unlockSlow</span><span class="token punctuation">(</span><span class="token builtin">new</span> <span class="token builtin">int32</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
	<span class="token keyword">if</span> <span class="token punctuation">(</span><span class="token builtin">new</span><span class="token operator">+</span>mutexLocked<span class="token punctuation">)</span><span class="token operator">&amp;</span>mutexLocked <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		<span class="token function">fatal</span><span class="token punctuation">(</span><span class="token string">"sync:   unlock   of   unlocked   mutex"</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span>

	<span class="token comment">// 非饥饿模式</span>
	<span class="token keyword">if</span> <span class="token builtin">new</span><span class="token operator">&amp;</span>mutexStarving <span class="token operator">==</span> <span class="token number">0</span> <span class="token punctuation">{</span>
		old <span class="token operator">:=</span> <span class="token builtin">new</span>
		<span class="token keyword">for</span> <span class="token punctuation">{</span>
			<span class="token comment">// 以下情况都直接结束，不继续往下：</span>
			<span class="token comment">// 1、如果没有人阻塞在信号量上了</span>
			<span class="token comment">// 2、其他人加锁了</span>
			<span class="token comment">// 3、已经有人唤醒协程了</span>
			<span class="token comment">// 4、锁又切换成饥饿模式了</span>
			<span class="token keyword">if</span> old<span class="token operator">>></span>mutexWaiterShift <span class="token operator">==</span> <span class="token number">0</span> <span class="token operator">||</span> old<span class="token operator">&amp;</span><span class="token punctuation">(</span>mutexLocked<span class="token operator">|</span>mutexWoken<span class="token operator">|</span>mutexStarving<span class="token punctuation">)</span> <span class="token operator">!=</span> <span class="token number">0</span> <span class="token punctuation">{</span>
				<span class="token keyword">return</span>
			<span class="token punctuation">}</span>

			<span class="token comment">// waiter-1   并且将唤醒标志置为1</span>
			<span class="token builtin">new</span> <span class="token operator">=</span> <span class="token punctuation">(</span>old <span class="token operator">-</span> <span class="token number">1</span><span class="token operator">&lt;&lt;</span>mutexWaiterShift<span class="token punctuation">)</span> <span class="token operator">|</span> mutexWoken
			<span class="token keyword">if</span> atomic<span class="token punctuation">.</span><span class="token function">CompareAndSwapInt32</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>state<span class="token punctuation">,</span> old<span class="token punctuation">,</span> <span class="token builtin">new</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
				<span class="token comment">// 如果cas执行成功就唤醒队头协程</span>
				<span class="token function">runtime_Semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">,</span> <span class="token boolean">false</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span>
				<span class="token keyword">return</span>
			<span class="token punctuation">}</span>
			old <span class="token operator">=</span> m<span class="token punctuation">.</span>state
		<span class="token punctuation">}</span>
	<span class="token punctuation">}</span> <span class="token keyword">else</span> <span class="token punctuation">{</span>
		<span class="token comment">// 饥饿模式下直接唤醒队头，这里分为两种情况：</span>
		<span class="token comment">// 1、如果“mutexLocked”未设置，等待者在唤醒后会获取到锁。</span>
		<span class="token comment">// 2、如果只设置了“mutexStarving”，则仍然认为互斥锁已被锁定，因此新到来的goroutine不会获取它，唤醒的协程会获取到锁。</span>
		<span class="token function">runtime_Semrelease</span><span class="token punctuation">(</span><span class="token operator">&amp;</span>m<span class="token punctuation">.</span>sema<span class="token punctuation">,</span> <span class="token boolean">true</span><span class="token punctuation">,</span> <span class="token number">1</span><span class="token punctuation">)</span>
	<span class="token punctuation">}</span>
<span class="token punctuation">}</span> <span class="token comment">//func</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>关于信号量相关接口：</p>
<div class="language-go line-numbers-mode" data-ext="go" data-title="go"><pre v-pre class="language-go"><code><span class="token comment">//lifo:true 加入等待队列的队头，否则加入队尾</span>
<span class="token keyword">func</span> <span class="token function">runtime_SemacquireMutex</span><span class="token punctuation">(</span>s <span class="token operator">*</span><span class="token builtin">uint32</span><span class="token punctuation">,</span> lifo <span class="token builtin">bool</span><span class="token punctuation">,</span> skipframes <span class="token builtin">int</span><span class="token punctuation">)</span>

<span class="token comment">//handoff=true：将当前G直接放到runq，调度器可以立即该G，并且会继承上一个G的时间片，</span>
<span class="token comment">//这样的目的是为了使当前G可以得到更快的调度。</span>
<span class="token keyword">func</span> <span class="token function">runtime_Semrelease</span><span class="token punctuation">(</span>s <span class="token operator">*</span><span class="token builtin">uint32</span><span class="token punctuation">,</span> handoff <span class="token builtin">bool</span><span class="token punctuation">,</span> skipframes <span class="token builtin">int</span><span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="三、总结" tabindex="-1"><a class="header-anchor" href="#三、总结"><span>三、总结</span></a></h2>
<ul>
<li>
<p>1、互斥锁是一种常见的控制并发读写资源的手段，go 中的互斥锁实现是 sync.Mutex。</p>
</li>
<li>
<p>2、Mutex 的对外的接口：</p>
<ul>
<li>
<p>Lock：同一时刻只能有一个 goroutine 可以获取到锁，其他goroutine会先通过自旋抢占锁，抢不到则阻塞等待。</p>
</li>
<li>
<p>Unlock：释放锁，释放锁之后，会唤醒等待队列中的下一个 goroutine。</p>
</li>
</ul>
</li>
<li>
<p>3、使用 Mutex 需要注意以下几点：</p>
<ul>
<li>
<p>Lock与Unlock需要成对出现，在 Unlock 之前，必须已经调用了 Lock，否则会 panic。</p>
</li>
<li>
<p>不要将 Mutex 作为函数或方法的参数传递。</p>
</li>
<li>
<p>不要在锁内部执行阻塞或耗时操作。</p>
</li>
<li>
<p>可以通过 vet 这个命令行来检查上面的锁 copy 的问题。</p>
</li>
</ul>
</li>
<li>
<p>4、go 的 Mutex 基于以下技术实现：</p>
<ul>
<li>
<p>信号量：操作系统层面的同步机制。</p>
</li>
<li>
<p>队列：在协程抢锁失败后，会将这些协程放入一个 FIFO 队列中，下次唤醒会唤醒队列头的协程。</p>
</li>
<li>
<p>原子操作：通过cas操作状态字段state，可以保证数据的完整性。</p>
</li>
</ul>
</li>
<li>
<p>5、go Mutex 的两种模式：</p>
<ul>
<li>
<p>正常模式：运行中的 goroutine 有一定机会比等待队列中的 goroutine 先获取到锁，这种模式有更好的性能。</p>
</li>
<li>
<p>饥饿模式：所有后来的 goroutine 都直接进入等待队列，会依次从等待队列头唤醒 goroutine。可以有效避免【饥饿】。等待队列中的 goroutine 超过了 1ms 还没有获取到锁，那么会进入饥饿模式</p>
</li>
</ul>
</li>
</ul>
</div></template>


