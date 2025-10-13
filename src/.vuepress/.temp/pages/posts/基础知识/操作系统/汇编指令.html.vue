<template><div><h1 id="汇编指令" tabindex="-1"><a class="header-anchor" href="#汇编指令"><span>汇编指令</span></a></h1>
<h2 id="基础" tabindex="-1"><a class="header-anchor" href="#基础"><span>基础</span></a></h2>
<p><strong>80386有如下通用寄存器:</strong></p>
<ul>
<li>AX,BX,CX,DX;SI,DI;SP,BP;(16位)</li>
<li>AH,AL ; BH,BL; CH,CL; DH,DL( 8位)</li>
<li>EAX,EBX,ECX,EDX: ESI,EDI: ESP,EBP(32位)</li>
</ul>
<p><strong>段寄存器</strong>:DS，ES，SS</p>
<!-- more -->
<figure><img src="/image/base/hiubian1.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h2 id="指令格式" tabindex="-1"><a class="header-anchor" href="#指令格式"><span>指令格式</span></a></h2>
<p><code v-pre>指令  源操作数, 目的操作数</code></p>
<div class="hint-container info">
<p class="hint-container-title">操作数</p>
<ul>
<li>
<p>立即数</p>
</li>
<li>
<p>寄存器</p>
</li>
<li>
<p>存储器</p>
</li>
</ul>
</div>
<p><strong>数据传送</strong>：</p>
<p><code v-pre>movl</code>:用于传送<strong>32</strong>位的长字值</p>
<p><code v-pre>movw</code>:用于传送<strong>16</strong>位的长字值</p>
<p><code v-pre>movb</code>:用于传送<strong>8</strong>位的长字值</p>
<div class="hint-container tip">
<p class="hint-container-title">寻址方式</p>
<ol>
<li>立即数寻址   <code v-pre>movl $1, %eax</code></li>
<li>寄存器寻址  <code v-pre>movl %ebx, %eax</code></li>
<li>绝对寻址 <code v-pre>movl 0x08048054, %eax</code></li>
<li>简介寻址 <code v-pre>movl (%ebx), %eax</code></li>
<li>比例变址寻址 <code v-pre>movl  Imm(Eb, Ei, s)</code>    M[Imm+R[Eb]+R[Ei]*s]</li>
</ol>
</div>
<p><strong>获得变量在内存中地址并传送给寄存器</strong></p>
<p><code v-pre>lea value1, %edi</code></p>
<p><code v-pre>movl $value1, %</code></p>
<p>lea寻址： <code v-pre>leal Src, Dest</code></p>
<p>​	Src:地址计算表达式   --&gt; Src的结果保存在Dest中</p>
<p>​	用途：计算内存地址本身（不计算内存里的值）</p>
<h2 id="栈操作" tabindex="-1"><a class="header-anchor" href="#栈操作"><span>栈操作</span></a></h2>
<div class="hint-container tip">
<p class="hint-container-title">栈操作</p>
<p>栈顶指针：保存在<code v-pre>%esp</code>寄存器</p>
<p>栈底指针：保存在<code v-pre>%ebp</code>寄存器</p>
<p>压栈： <code v-pre>push</code></p>
<p>出栈：<code v-pre>pop</code></p>
<p>注意：栈顶事朝向低地址方向的</p>
</div>
<h2 id="算数逻辑操作" tabindex="-1"><a class="header-anchor" href="#算数逻辑操作"><span>算数逻辑操作</span></a></h2>
<p><code v-pre>incl</code>:加1操作</p>
<p><code v-pre>decl</code>:减1操作</p>
<p><code v-pre>negl</code>：取负</p>
<p><code v-pre>addl S</code>：加法</p>
<p><code v-pre>subl</code>：减法</p>
<p><code v-pre>imull S</code>：有符号乘法，将S与<code v-pre>%eax</code>中的值相乘，64位结果高32位放<code v-pre>%ex</code>,低32位放<code v-pre>%eax</code></p>
<p><code v-pre>mull</code>:无符号乘法</p>
<p><code v-pre>orl S</code>：或</p>
<p><code v-pre>anl S</code>：与</p>
<p><code v-pre>xorl S</code>：异或</p>
<p><code v-pre>notl</code>：取反</p>
<p><code v-pre>SHR</code>：逻辑右移</p>
<p><code v-pre>SHL</code>：逻辑左移</p>
<p><code v-pre>SAR</code>：算数右移</p>
<p><code v-pre>SAL</code>：算数左移</p>
<h2 id="跳转指令" tabindex="-1"><a class="header-anchor" href="#跳转指令"><span>跳转指令</span></a></h2>
<p>无符号数： above, below</p>
<p>有符号数：great, less</p>
<p>N: 不   E:等于</p>
<p>进行组合，例如：</p>
<p><code v-pre>jne</code>：不等于</p>
<p><code v-pre>jae</code>：大于等于</p>
<p><code v-pre>jg</code>：大于</p>
<h2 id="有条件传送" tabindex="-1"><a class="header-anchor" href="#有条件传送"><span>有条件传送</span></a></h2>
<p><code v-pre>cmove</code>：相等</p>
<p><code v-pre>cmovs</code>：负数</p>
<p><code v-pre>cmovg</code>：大于</p>
<p><code v-pre>cmovl</code>：小于</p>
<p><code v-pre>cmp</code>：对两个数做减法，但是不保留结果，仅保留标志位</p>
<p><code v-pre>test</code>：对两个操作数进行逻辑与运算，但是不保留结果</p>
</div></template>


