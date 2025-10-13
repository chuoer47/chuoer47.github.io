<template><div><h1 id="markdown" tabindex="-1"><a class="header-anchor" href="#markdown"><span>Markdown</span></a></h1>
<!-- more -->
<h2 id="一、markdown速查" tabindex="-1"><a class="header-anchor" href="#一、markdown速查"><span>一、markdown速查</span></a></h2>
<div class="hint-container tip">
<p class="hint-container-title">背景</p>
<p>Markdown 是一种轻量级标记语言，创始人为约翰·格鲁伯（John Gruber）和亚伦·斯沃茨（Aaron Swartz）。它允许人们 “ 使用易读易写的纯文本格式编写文档，然后转换成有效的XHTML（或者HTML）文档 ”</p>
<p><a href="https://markdown.com.cn/" target="_blank" rel="noopener noreferrer">Markdown 教程</a></p>
<p><a href="https://theme-hope.vuejs.press/zh/cookbook/markdown/demo.html" target="_blank" rel="noopener noreferrer">Markdown 示例</a></p>
<p><a href="https://theme-hope.vuejs.press/zh/guide/markdown/intro.html" target="_blank" rel="noopener noreferrer">Markdown 增强</a></p>
</div>
<h3 id="_1、基本语法" tabindex="-1"><a class="header-anchor" href="#_1、基本语法"><span>1、基本语法</span></a></h3>
<p>这些是 John Gruber 的原始设计文档中列出的元素。所有 Markdown 应用程序都支持这些元素</p>
<table>
<thead>
<tr>
<th style="text-align:left">元素</th>
<th style="text-align:left">Markdown 语法</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">标题（Heading）</td>
<td style="text-align:left"># H1 <br> ## H2 <br> ### H3</td>
</tr>
<tr>
<td style="text-align:left">粗体（Bold）</td>
<td style="text-align:left">**bold text**</td>
</tr>
<tr>
<td style="text-align:left">斜体（Italic）</td>
<td style="text-align:left">*italicized text*</td>
</tr>
<tr>
<td style="text-align:left">引用块（Blockquote）</td>
<td style="text-align:left">&gt; blockquote</td>
</tr>
<tr>
<td style="text-align:left">有序列表（Ordered List）</td>
<td style="text-align:left">1. First item <br>   2. Second item <br> 3. Third item</td>
</tr>
<tr>
<td style="text-align:left">无序列表（Unordered List）</td>
<td style="text-align:left">- First item <br> - Second item  <br> - Third item</td>
</tr>
<tr>
<td style="text-align:left">代码（Code）</td>
<td style="text-align:left">`code`</td>
</tr>
<tr>
<td style="text-align:left">分隔线（Horizontal Rule）</td>
<td style="text-align:left">---</td>
</tr>
<tr>
<td style="text-align:left">链接（Link）</td>
<td style="text-align:left">[title](https://www.example.com)</td>
</tr>
<tr>
<td style="text-align:left">图片（Image）</td>
<td style="text-align:left">![alt text](image.jpg)</td>
</tr>
</tbody>
</table>
<h3 id="_2、扩展语法" tabindex="-1"><a class="header-anchor" href="#_2、扩展语法"><span>2、扩展语法</span></a></h3>
<p>这些元素通过添加额外的功能扩展了基本语法。但是，并非所有 Markdown 应用程序都支持这些元素</p>
<table>
<thead>
<tr>
<th style="text-align:left">元素</th>
<th style="text-align:left">Markdown 语法</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:left">表格（Table）</td>
<td style="text-align:left">| Syntax | Description | <br> |  -----------  |  -----------  | <br> | Header      | Title       | <br> | Paragraph   | Text        |</td>
</tr>
<tr>
<td style="text-align:left">代码块（Fenced Code Block）</td>
<td style="text-align:left">```<br>    {<br>    &quot;firstName&quot;: &quot;John&quot;,<br>     &quot;lastName&quot;: &quot;Smith&quot;,  <br>    &quot;age&quot;: 25   <br>} <br>```</td>
</tr>
<tr>
<td style="text-align:left">脚注（Footnote）</td>
<td style="text-align:left">Here's a sentence with a footnote. [^1] <br>[^1]: This is the footnote.</td>
</tr>
<tr>
<td style="text-align:left">标题编号（Heading ID）</td>
<td style="text-align:left">### My Great Heading {#custom-id}</td>
</tr>
<tr>
<td style="text-align:left">定义列表（Definition List）</td>
<td style="text-align:left">term  : definition</td>
</tr>
<tr>
<td style="text-align:left">删除线（Strikethrough）</td>
<td style="text-align:left">~~The world is flat.~~</td>
</tr>
<tr>
<td style="text-align:left">任务列表（Task List）</td>
<td style="text-align:left">- [x] Write the press release <br>- [ ] Update the website <br> - [ ] Contact the media</td>
</tr>
</tbody>
</table>
<h2 id="二、markdown方言" tabindex="-1"><a class="header-anchor" href="#二、markdown方言"><span>二、Markdown方言</span></a></h2>
<h2 id="_1-、提示信息" tabindex="-1"><a class="header-anchor" href="#_1-、提示信息"><span>1 、提示信息</span></a></h2>
<div class="hint-container important">
<p class="hint-container-title">important</p>
</div>
<div class="hint-container info">
<p class="hint-container-title">info</p>
</div>
<div class="hint-container note">
<p class="hint-container-title">note</p>
</div>
<div class="hint-container tip">
<p class="hint-container-title">tip</p>
</div>
<div class="hint-container warning">
<p class="hint-container-title">warning</p>
</div>
<div class="hint-container caution">
<p class="hint-container-title">caution</p>
</div>
<details class="hint-container details"><summary>details</summary>
</details>
<Tabs id="217" :data='[{"id":"apple"},{"id":"banana"},{"id":"orange"}]'>
<template #title0="{ value, isActive }">apple</template>
<template #title1="{ value, isActive }">banana</template>
<template #title2="{ value, isActive }">orange</template>
<template #tab0="{ value, isActive }">
<p>Apple <a href="https://theme-hope.vuejs.press/zh/guide/markdown/content/tabs.html" target="_blank" rel="noopener noreferrer">选项卡</a></p>
</template>
<template #tab1="{ value, isActive }">
<p>Banana</p>
</template>
<template #tab2="{ value, isActive }">
<p>Orange</p>
</template>
</Tabs>
<h2 id="_2、-emoji表情" tabindex="-1"><a class="header-anchor" href="#_2、-emoji表情"><span>2、 <a href="https://www.webfx.com/tools/emoji-cheat-sheet/" target="_blank" rel="noopener noreferrer">Emoji表情</a></span></a></h2>
<div class="language-markdown line-numbers-mode" data-ext="md" data-title="md"><pre v-pre class="language-markdown"><code>经典: :wink: :cry: :laughing: :yum:

简写: 8-) :) :* :( :-) :-( ;)s
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>效果</strong>：</p>
<p>😉 😢 😆 😋<br>
😎 😃 😗 😦 😃 😦 😉</p>
<h2 id="_3、-字体颜色" tabindex="-1"><a class="header-anchor" href="#_3、-字体颜色"><span>3、 字体颜色</span></a></h2>
<h3 id="_3-1-徽章重要" tabindex="-1"><a class="header-anchor" href="#_3-1-徽章重要"><span>3.1 <a href="https://plugin-components.vuejs.press/zh/guide/utilities/badge.html" target="_blank" rel="noopener noreferrer">徽章</a><span class="vp-badge danger">重要</span></span></a></h3>
<p><span class="vp-badge info">class=&quot;vp-badge info&quot;</span><br>
<span class="vp-badge danger">class=&quot;vp-badge danger&quot;</span><br>
<span class="vp-badge note">class=&quot;vp-badge note&quot;</span><br>
<span class="vp-badge tip">class=&quot;vp-badge tip&quot;</span><br>
<span class="vp-badge warning">class=&quot;vp-badge warning&quot;</span></p>
<p>top<Badge text="构建中" type="warning" vertical = "top"/> middle<Badge text="新" type="tip"  vertical = "middle"/> baseline<Badge text="MrHope" type="info" vertical = "baseline"/> bottom<Badge text="MrHope" color="grey" vertical = "bottom"/></p>
<div class="language-markdown line-numbers-mode" data-ext="md" data-title="md"><pre v-pre class="language-markdown"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>span</span> <span class="token attr-name">class</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>vp-badge info<span class="token punctuation">"</span></span><span class="token punctuation">></span></span>支持页面配置<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>span</span><span class="token punctuation">></span></span>

<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>Badge</span> <span class="token attr-name">text</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>构建中<span class="token punctuation">"</span></span> <span class="token attr-name">type</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>warning<span class="token punctuation">"</span></span> <span class="token attr-name">vertical</span> <span class="token attr-value"><span class="token punctuation attr-equals">=</span> <span class="token punctuation">"</span>top<span class="token punctuation">"</span></span><span class="token punctuation">/></span></span> 
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>Badge</span> <span class="token attr-name">text</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>新<span class="token punctuation">"</span></span> <span class="token attr-name">type</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>tip<span class="token punctuation">"</span></span>  <span class="token attr-name">vertical</span> <span class="token attr-value"><span class="token punctuation attr-equals">=</span> <span class="token punctuation">"</span>middle<span class="token punctuation">"</span></span><span class="token punctuation">/></span></span> 
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>Badge</span> <span class="token attr-name">text</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>MrHope<span class="token punctuation">"</span></span> <span class="token attr-name">type</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>info<span class="token punctuation">"</span></span> <span class="token attr-name">vertical</span> <span class="token attr-value"><span class="token punctuation attr-equals">=</span> <span class="token punctuation">"</span>baseline<span class="token punctuation">"</span></span><span class="token punctuation">/></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>Badge</span> <span class="token attr-name">text</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>MrHope<span class="token punctuation">"</span></span> <span class="token attr-name">color</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>grey<span class="token punctuation">"</span></span> <span class="token attr-name">vertical</span> <span class="token attr-value"><span class="token punctuation attr-equals">=</span> <span class="token punctuation">"</span>bottom<span class="token punctuation">"</span></span><span class="token punctuation">/></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3-2-更改字体、大小、颜色" tabindex="-1"><a class="header-anchor" href="#_3-2-更改字体、大小、颜色"><span>3.2 更改字体、大小、颜色</span></a></h3>
<div class="language-html line-numbers-mode" data-ext="html" data-title="html"><pre v-pre class="language-html"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">face</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>黑体<span class="token punctuation">"</span></span><span class="token punctuation">></span></span>我是黑体字<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">face</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>微软雅黑<span class="token punctuation">"</span></span><span class="token punctuation">></span></span>我是微软雅黑<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">face</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>STCAIYUN<span class="token punctuation">"</span></span><span class="token punctuation">></span></span>我是华文彩云<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">color</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>red</span><span class="token punctuation">></span></span>我是红色<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">color</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>#008000</span><span class="token punctuation">></span></span>我是绿色<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">color</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>Blue</span><span class="token punctuation">></span></span>我是蓝色<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">size</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>5</span><span class="token punctuation">></span></span>我是尺寸<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>font</span> <span class="token attr-name">face</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span><span class="token punctuation">"</span>黑体<span class="token punctuation">"</span></span> <span class="token attr-name">color</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>green</span> <span class="token attr-name">size</span><span class="token attr-value"><span class="token punctuation attr-equals">=</span>5</span><span class="token punctuation">></span></span>我是黑体，绿色，尺寸为5<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>font</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>效果</p>
<figure><img src="https://simeis147-github-io.oss-cn-shenzhen.aliyuncs.com/BackEnd/SpringCloud/20230719202045.png" alt=" " tabindex="0" loading="lazy"><figcaption> </figcaption></figure>
<h2 id="三、component" tabindex="-1"><a class="header-anchor" href="#三、component"><span>三、<a href="https://theme-hope.vuejs.press/zh/guide/component/grammar.html" target="_blank" rel="noopener noreferrer">Component</a></span></a></h2>
<p>Markdown 中通过 component 代码块快速添加组件。</p>
<p><strong>配置</strong></p>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>import { hopeTheme } from "vuepress-theme-hope";

export default {
  theme: hopeTheme({
    plugins: {
      mdEnhance: {
        components: true,
      },
    },
  }),
};
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>使用</strong></p>
<VPCard
  title="Mr.Hope"
  desc="Where there is light, there is hope"
  logo="https://mister-hope.com/logo.svg"
  link="https://mister-hope.com"
  background="rgba(253, 230, 138, 0.15)"
/>
<p>这里的 <code v-pre>&lt;VPCard&gt;</code> 是已经全局注册的卡片组件。</p>
<p>上方的代码块和下方等价:</p>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>&lt;VPCard
  title="Mr.Hope"
  desc="Where there is light, there is hope"
  logo="https://mister-hope.com/logo.svg"
  link="https://mister-hope.com"
  background="rgba(253, 230, 138, 0.15)"
/>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


