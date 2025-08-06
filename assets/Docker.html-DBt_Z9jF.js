import{_ as n}from"./plugin-vue_export-helper-DlAUqK2U.js";import{c as s,a,b as e,o as i}from"./app-BBThAt0D.js";const t="/image/docker4.png",l="/image/docker1.png",c="/image/docker2.png",o="/image/docker3.png",p={},d=e('<h1 id="docker" tabindex="-1"><a class="header-anchor" href="#docker"><span>Docker</span></a></h1><h2 id="一、dcoker介绍" tabindex="-1"><a class="header-anchor" href="#一、dcoker介绍"><span>一、Dcoker介绍</span></a></h2><p>Docker是基于Go语言开发的开源应用容器引擎，遵从Apache Licence 2.0协议，可以让开发者打包应用以及应用的依赖包到一个可移植的容器中，然后发布到各种发行版本的Linux系统上。</p><p>​ 软件开发中最为麻烦的事情可能就是配置环境了。由于用户使用的操作系统具有多样性，即便使用跨平台的开发语言（如Java和Python）都不能保证代码能够在各种平台下都可以正常的运转，而且在不同的环境下我们安装的软件需要依赖的软件包也是不一样的。</p><p>那么问题来了，我们安装软件的时候可不可以把软件运行的环境一并安装？我们是不是可以把原始环境一模一样地复制过来呢？</p><ul><li><p>虚拟机（virtual machine）就是带环境安装的一种解决方案，它可以在一种操作系统里面运行另一种操作系统，比如在Windows系统里面运行Linux系统，在macOS上运行Windows，而应用程序对此毫无感知。使用过虚拟机的人都知道，虚拟机用起来跟真实系统一模一样，而对于虚拟机的宿主系统来说，虚拟机就是一个普通文件，不需要了就删掉，对宿主系统或者其他的程序并没有影响。但是虚拟机通常会占用较多的系统资源，启动和关闭也非常的缓慢，总之用户体验并没有想象中的那么好。</p></li><li><p>Docker属于对Linux容器技术（LXC）的一种封装（利用了Linux的namespace和cgroup技术），它提供了简单易用的容器使用接口，是目前最流行的 Linux 容器解决方案。Docker将应用程序与该程序的依赖打包在一个文件里面，运行这个文件，就会生成一个虚拟容器。程序在这个虚拟容器里运行，就好像在真实的物理机上运行一样。下图是虚拟机和容器的对比，左边是传统的虚拟机，右边是Docker。</p></li></ul><figure><img src="'+t+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><div class="hint-container info"><p class="hint-container-title">Docker主要用于几下几个方面</p><ol><li>提供一次性的环境。</li><li>提供弹性的云服务（利用Docker很容易实现扩容和收缩）。</li><li>实践微服务架构（隔离真实环境在容器中运行多个服务）。</li></ol></div><h2 id="二、docker安装" tabindex="-1"><a class="header-anchor" href="#二、docker安装"><span>二、Docker安装</span></a></h2><h3 id="_1、卸载老版本" tabindex="-1"><a class="header-anchor" href="#_1、卸载老版本"><span>1、卸载老版本</span></a></h3><p>ubuntu下自带了docker的库，不需要添加新的源。但是ubuntu自带的docker版本太低，需要先卸载旧的再安装新的。</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">apt-get</span> remove <span class="token function">docker</span> docker-engine docker.io containerd runc
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_2、更新软件包" tabindex="-1"><a class="header-anchor" href="#_2、更新软件包"><span>2、更新软件包</span></a></h3><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> <span class="token function">apt</span> update
<span class="token function">sudo</span> <span class="token function">apt</span> upgrade
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、安装docker依赖" tabindex="-1"><a class="header-anchor" href="#_3、安装docker依赖"><span>3、安装docker依赖</span></a></h3><p>安装工具：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">apt-get</span> <span class="token parameter variable">-y</span> <span class="token function">install</span> apt-transport-https ca-certificates <span class="token function">curl</span> software-properties-common
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">apt-get</span> <span class="token function">install</span> ca-certificates <span class="token function">curl</span> gnupg lsb-release
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_4、添加docker官方gpg密钥" tabindex="-1"><a class="header-anchor" href="#_4、添加docker官方gpg密钥"><span>4、添加Docker官方GPG密钥</span></a></h3><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">curl</span> <span class="token parameter variable">-fsSL</span> http://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg <span class="token operator">|</span> <span class="token function">sudo</span> apt-key <span class="token function">add</span> -
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_5、添加docker软件源" tabindex="-1"><a class="header-anchor" href="#_5、添加docker软件源"><span>5、添加docker软件源</span></a></h3><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> add-apt-repository <span class="token string">&quot;deb [arch=amd64] http://mirrors.aliyun.com/docker-ce/linux/ubuntu <span class="token variable"><span class="token variable">$(</span>lsb_release <span class="token parameter variable">-cs</span><span class="token variable">)</span></span> stable&quot;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_6、安装docker" tabindex="-1"><a class="header-anchor" href="#_6、安装docker"><span>6、安装docker</span></a></h3><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">apt-get</span> <span class="token function">install</span> docker-ce docker-ce-cli containerd.io
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_7、配置用户组-可选" tabindex="-1"><a class="header-anchor" href="#_7、配置用户组-可选"><span>7、配置用户组（可选）</span></a></h3><p>默认情况下，只有root用户和docker组的用户才能运行Docker命令。我们可以将当前用户添加到docker组，以避免每次使用Docker时都需要使用sudo</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> <span class="token function">usermod</span> <span class="token parameter variable">-aG</span> <span class="token function">docker</span> <span class="token environment constant">$USER</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>注意：重新登录才能使更改生效。</p><h3 id="_8、启动" tabindex="-1"><a class="header-anchor" href="#_8、启动"><span>8、启动</span></a></h3><div class="hint-container info"><p class="hint-container-title">运行docker</p><div class="language-Bash line-numbers-mode" data-ext="Bash" data-title="Bash"><pre class="language-Bash"><code># 启动Docker
systemctl start docker

# 停止Docker
systemctl stop docker

# 重启
systemctl restart docker

# 设置开机自启
systemctl enable docker

# 执行docker ps命令，如果不报错，说明安装启动成功
docker ps
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div><p>验证是否成功:</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> <span class="token function">docker</span> run hello-world
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>查看版本:</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> <span class="token function">docker</span> version
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>查看镜像:</p><p>上面我们拉取了hello-world的镜像，现在我们可以通过命令来查看镜像，命令如下：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">sudo</span> <span class="token function">docker</span> images
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h3 id="_9、配置镜像加速" tabindex="-1"><a class="header-anchor" href="#_9、配置镜像加速"><span>9、配置镜像加速</span></a></h3><p>打开阿里云-&gt;产品-&gt;容器-&gt;容器镜像服务ACR-&gt;镜像工具下的配置镜像加速</p><h2 id="三、docker基础" tabindex="-1"><a class="header-anchor" href="#三、docker基础"><span>三、docker基础</span></a></h2><h3 id="_1、快速入门" tabindex="-1"><a class="header-anchor" href="#_1、快速入门"><span>1、快速入门</span></a></h3><p>docker安装mysql</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> run <span class="token parameter variable">-d</span> <span class="token punctuation">\\</span>
 <span class="token parameter variable">--name</span> mysql <span class="token punctuation">\\</span>
 <span class="token parameter variable">-p</span> <span class="token number">3306</span>:3306 <span class="token punctuation">\\</span>
 <span class="token parameter variable">-e</span> <span class="token assign-left variable">TZ</span><span class="token operator">=</span>Asia/Shanghai <span class="token punctuation">\\</span>
 <span class="token parameter variable">-e</span> <span class="token assign-left variable">MYSQL_ROOT_PASSWORD</span><span class="token operator">=</span><span class="token number">12345678</span> <span class="token punctuation">\\</span>
 mysql
 
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>解释：</strong></p><ul><li><code>docker run</code>: 创建并运行一个容器， <code>-d</code>是让容器在后台运行</li><li><code>--name mysql</code>:给容器起名字，必须唯一</li><li><code>-p 3306:3306</code>设置端口映射 -&gt; 将宿主机器的3306端口和容器内3306端口进行映射</li><li><code>-e KEY=VALUE</code>:环境变量设置</li><li><code>mysql</code>：指定运行的镜像的名字 <ul><li>镜像名称：[repository]:[tag] <ul><li>repository:镜像名</li><li>tag:镜像的版本</li></ul></li><li>没有指定tag时，默认是latest，代表最新版本的镜像</li></ul></li></ul><h3 id="_2、常见命令" tabindex="-1"><a class="header-anchor" href="#_2、常见命令"><span>2、常见命令</span></a></h3><figure><img src="`+l+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><h4 id="_1-容器操作" tabindex="-1"><a class="header-anchor" href="#_1-容器操作"><span>1）容器操作</span></a></h4><p>docker container基本命令</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 创建docker容器</span>
<span class="token function">docker</span> container run ubuntu

<span class="token comment"># 关闭容器</span>
<span class="token function">docker</span> container stop <span class="token number">94</span><span class="token punctuation">..</span>.<span class="token punctuation">(</span>编号<span class="token punctuation">)</span>

<span class="token comment"># 查看所有容器</span>
<span class="token function">docker</span> container ps/ls <span class="token parameter variable">-a</span>
	<span class="token comment"># 新版本推荐ls,不加-a只显示已开启的镜像</span>
	
<span class="token comment"># 删除容器</span>
<span class="token function">docker</span> container <span class="token function">rm</span> <span class="token number">94</span><span class="token punctuation">..</span><span class="token punctuation">..</span>
<span class="token function">docker</span> <span class="token function">rm</span> <span class="token number">94</span>

<span class="token comment">#进入容器</span>
<span class="token function">docker</span> <span class="token builtin class-name">exec</span> <span class="token parameter variable">-it</span> 容器名 <span class="token function">bash</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>多容器操作</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 关闭多个容器（笨方法）</span>
<span class="token function">docker</span> container stop <span class="token number">36</span> <span class="token number">94</span> 5d

<span class="token comment"># 显示所有容器id</span>
<span class="token function">docker</span> container <span class="token function">ps</span> <span class="token parameter variable">-aq</span>

<span class="token comment"># 关闭所有容器</span>
<span class="token function">docker</span> container stop <span class="token variable"><span class="token variable">$(</span><span class="token function">docker</span> container <span class="token function">ps</span> <span class="token parameter variable">-aq</span><span class="token variable">)</span></span>

<span class="token comment"># 删除所有容器，正在使用的也删除</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> <span class="token function">rm</span> <span class="token variable"><span class="token variable">$(</span><span class="token function">docker</span> container <span class="token function">ps</span> <span class="token parameter variable">-aq</span><span class="token variable">)</span></span>
<span class="token comment"># 不停止直接删除会报错,需要在后面加上-f</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> <span class="token function">rm</span> <span class="token number">94</span> <span class="token parameter variable">-f</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>端口映射</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 端口映射         服务器端口:容器端口</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> run <span class="token parameter variable">-p</span> <span class="token number">80</span>:80 nginx    <span class="token comment"># 前台运行模式</span>
	<span class="token comment">#访问 127.0.0.1</span>

<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> run <span class="token parameter variable">-d</span> <span class="token parameter variable">-p</span> <span class="token number">90</span>:80 nginx	<span class="token comment"># 后台运行模式</span>
	<span class="token comment"># 127.0.0.1:90</span>

<span class="token comment"># 将后台运行模式转变成前台运行模式</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> attach <span class="token number">54</span><span class="token punctuation">(</span>id<span class="token punctuation">)</span> 
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>后台模式下操作</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 查看日志</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> logs <span class="token number">43</span>

<span class="token comment"># 跟踪日志</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>container<span class="token punctuation">]</span> logs <span class="token parameter variable">-f</span> <span class="token number">43</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-镜像操作" tabindex="-1"><a class="header-anchor" href="#_2-镜像操作"><span>2）镜像操作</span></a></h4><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 拉取镜像,不同版本有区别,后面可以加版本号</span>
<span class="token function">docker</span> pull wordpress
<span class="token function">docker</span> image pull wordpress

<span class="token comment"># 查看镜像详细信息</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>image<span class="token punctuation">]</span> inspect b94

<span class="token comment">#删除镜像</span>
<span class="token function">docker</span> image <span class="token function">rm</span> b94
<span class="token function">docker</span> rmi b94
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>镜像导入导出</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment">#导出镜像,先进入要导出到的目录</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>image<span class="token punctuation">]</span> save wordpress:latest <span class="token parameter variable">-o</span> mywordpress.image

<span class="token comment">#导入镜像</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>image<span class="token punctuation">]</span> load <span class="token parameter variable">-i</span> .<span class="token punctuation">\\</span>mywordpress.image
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、数据卷" tabindex="-1"><a class="header-anchor" href="#_3、数据卷"><span>3、数据卷</span></a></h3><p>数据卷（volume）是一个虚拟目录，是容器内目录与宿主机目录之间映射的桥梁</p><figure><img src="`+c+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>数据卷命令</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> volume create <span class="token comment">#创建数据卷</span>

<span class="token function">docker</span> volume <span class="token function">ls</span> <span class="token comment">#查看所有数据卷</span>

<span class="token function">docker</span> volume <span class="token function">rm</span> <span class="token comment">#删除指定数据卷</span>

<span class="token function">docker</span> volume inspec <span class="token comment">#查看某个数据卷详情</span>

<span class="token function">docker</span> volume prune <span class="token comment">#清除数据卷</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container warning"><p class="hint-container-title">注意</p><ul><li>只有在容器创建的时候才可以挂载，使用<code>-v 数据卷:容器内目录</code></li><li>当创建容器时，如果挂载了数据卷且数据卷不存在，会自动创建数据卷</li></ul></div><div class="hint-container tip"><p class="hint-container-title">本地目录与容器内目录的挂载</p><ul><li>在执行<code>docker run</code>命令时，使用 <code>-v 本地目录:容器内目录</code> 可以完成本地目录挂载</li><li>本地目录必须以“/”或&quot;./”开头，如果直接以名称开头，会被识别为数据卷而非本地目录 <ul><li><code>-v mysql:/var/lib/mysq</code>l 会被识别为一个数据卷叫mysql</li><li><code>-v ./mysql:/var/lib/mysql</code> 会被识别为当前目录下的mysql目录</li></ul></li></ul></div><h3 id="_4、自定义镜像" tabindex="-1"><a class="header-anchor" href="#_4、自定义镜像"><span>4、自定义镜像</span></a></h3><p>镜像就是包含了应用程序、程序运行的系统函数库、运行配置等文件的文件包。构建镜像的过程其实就是把上述文件打包的过程。</p><h4 id="_1-dockerfile常见指令" tabindex="-1"><a class="header-anchor" href="#_1-dockerfile常见指令"><span>1）Dockerfile常见指令</span></a></h4><table><thead><tr><th>指令</th><th>说明</th><th>示例</th></tr></thead><tbody><tr><td>FROM</td><td>指定基础镜像</td><td>FROM centos:6</td></tr><tr><td>ENV</td><td>设置环境变量</td><td>ENV key value</td></tr><tr><td>COPY</td><td>拷贝本地文件到镜像的指定目录</td><td>COPY ./jrell.tar.gz /tmp</td></tr><tr><td>RUN</td><td>执行Linux的shell命令，一般是安装过程的命令</td><td>RUN tar -zxvf /tmp/jrell.tar.gz &amp;&amp; EXPORTS path=/tmp/jrell:$path</td></tr><tr><td>EXPOSE</td><td>指定容器运行时监听的端口，给镜像使用者看的</td><td>EXPOSE 8080</td></tr><tr><td>ENTRYPOINT</td><td>镜像中应用的启动命令，容器运行时调用</td><td>ENTRYPOINT java -jar xx.jar</td></tr></tbody></table><p>更多详细说明，请参看官网文档：<a href="https://docs.docker.com/engine/reference/builder" target="_blank" rel="noopener noreferrer">https://docs.docker.com/engine/reference/builder</a></p><h4 id="_2-利用dockerfile构建镜像" tabindex="-1"><a class="header-anchor" href="#_2-利用dockerfile构建镜像"><span>2）利用Dockerfile构建镜像</span></a></h4><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 从Dockerfile构建镜像</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>image<span class="token punctuation">]</span> build <span class="token parameter variable">-t</span> myImage:1.0 <span class="token builtin class-name">.</span>
<span class="token function">docker</span> <span class="token punctuation">[</span>image<span class="token punctuation">]</span> build <span class="token parameter variable">-f</span> Dockerfile <span class="token parameter variable">-t</span> <span class="token builtin class-name">test</span> <span class="token builtin class-name">.</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip"><p class="hint-container-title">提示</p><ul><li><code>-t</code>是给镜像起名，格式依然是repository:tag的格式，不指定tag时默认为latest</li><li><code>.</code>指定Dockerfile所在目录，如果就在当前目录，则指定为&quot;.&quot;</li></ul></div><p>镜像上传：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 修改镜像名字,上传到dockerhub上要遵守命名规范</span>
<span class="token function">docker</span> image tag <span class="token builtin class-name">test</span> ruyiwei/test

<span class="token comment"># 上传到dockerhub</span>
<span class="token function">docker</span> login  <span class="token comment"># 登录</span>
<span class="token function">docker</span> image push ruyiwei/test	<span class="token comment"># 上传</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_3-示例" tabindex="-1"><a class="header-anchor" href="#_3-示例"><span>3）示例</span></a></h4><p>基于docker部署web应用：</p><p>Dockerfile:</p><div class="language-docker line-numbers-mode" data-ext="docker" data-title="docker"><pre class="language-docker"><code><span class="token comment"># 基础镜像</span>
<span class="token instruction"><span class="token keyword">FROM</span> openjdk:11.0-jre-buster</span>
<span class="token comment"># 设定时区</span>
<span class="token instruction"><span class="token keyword">ENV</span> TZ=Asia/Shanghai</span>
<span class="token instruction"><span class="token keyword">RUN</span> ln -snf /usr/share/zoneinfo/<span class="token variable">$TZ</span> /etc/localtime &amp;&amp; echo <span class="token variable">$TZ</span> &gt; /etc/timezone</span>
<span class="token comment"># 拷贝jar包</span>
<span class="token instruction"><span class="token keyword">COPY</span> docker-demo.jar /app.jar</span>
<span class="token comment"># 入口</span>
<span class="token instruction"><span class="token keyword">ENTRYPOINT</span> [<span class="token string">&quot;java&quot;</span>, <span class="token string">&quot;-jar&quot;</span>, <span class="token string">&quot;/app.jar&quot;</span>]</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>进入镜像目录，构建镜像:</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> build <span class="token parameter variable">-t</span> docker-demo:1.0 <span class="token builtin class-name">.</span>

<span class="token comment"># 直接指定Dockerfile目录</span>
<span class="token function">docker</span> build <span class="token parameter variable">-t</span> docker-demo:1.0 /root/demo
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>最后运行该镜像</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 创建并运行容器</span>
<span class="token function">docker</span> run <span class="token parameter variable">-d</span> <span class="token parameter variable">--name</span> <span class="token function">dd</span> <span class="token parameter variable">-p</span> <span class="token number">8080</span>:8080 docker-demo:1.0
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_5、容器网络互联" tabindex="-1"><a class="header-anchor" href="#_5、容器网络互联"><span>5、容器网络互联</span></a></h3><p>加入自定义网络的容器才可以通过容器名互相访问，Docker的网络操作命令如下:</p><table><thead><tr><th>命令</th><th>说明</th></tr></thead><tbody><tr><td>docker network create</td><td>创建一个网络</td></tr><tr><td>docker network ls</td><td>查看所有网络</td></tr><tr><td>docker network rm</td><td>删除指定网络</td></tr><tr><td>docker network prune</td><td>清除未使用的网络</td></tr><tr><td>docker network connect</td><td>使指定容器加入某网络</td></tr><tr><td>docker network disconnect</td><td>使指定容器离开某网络</td></tr><tr><td>docker network inspect</td><td>查看网络详细信息</td></tr></tbody></table><p>示例：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 1.首先通过命令创建一个网络</span>
<span class="token function">docker</span> network create hmall

<span class="token comment"># 2.然后查看网络</span>
<span class="token function">docker</span> network <span class="token function">ls</span>
<span class="token comment"># 结果：</span>
NETWORK ID     NAME      DRIVER    SCOPE
639bc44d0a87   bridge    bridge    <span class="token builtin class-name">local</span>
403f16ec62a2   hmall     bridge    <span class="token builtin class-name">local</span>
0dc0f72a0fbb   <span class="token function">host</span>      <span class="token function">host</span>      <span class="token builtin class-name">local</span>
cd8d3e8df47b   none      null      <span class="token builtin class-name">local</span>
<span class="token comment"># 其中，除了hmall以外，其它都是默认的网络</span>

<span class="token comment"># 3.让dd和mysql都加入该网络，注意，在加入网络时可以通过--alias给容器起别名</span>
<span class="token comment"># 这样该网络内的其它容器可以用别名互相访问！</span>
<span class="token comment"># 3.1.mysql容器，指定别名为db，另外每一个容器都有一个别名是容器名</span>
<span class="token function">docker</span> network connect hmall mysql <span class="token parameter variable">--alias</span> db
<span class="token comment"># 3.2.db容器，也就是我们的java项目</span>
<span class="token function">docker</span> network connect hmall <span class="token function">dd</span>

<span class="token comment"># 4.进入dd容器，尝试利用别名访问db</span>
<span class="token comment"># 4.1.进入容器</span>
<span class="token function">docker</span> <span class="token builtin class-name">exec</span> <span class="token parameter variable">-it</span> <span class="token function">dd</span> <span class="token function">bash</span>
<span class="token comment"># 4.2.用db别名访问</span>
<span class="token function">ping</span> db
<span class="token comment"># 结果</span>
PING db <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span> <span class="token number">56</span><span class="token punctuation">(</span><span class="token number">84</span><span class="token punctuation">)</span> bytes of data.
<span class="token number">64</span> bytes from mysql.hmall <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span>: <span class="token assign-left variable">icmp_seq</span><span class="token operator">=</span><span class="token number">1</span> <span class="token assign-left variable">ttl</span><span class="token operator">=</span><span class="token number">64</span> <span class="token assign-left variable">time</span><span class="token operator">=</span><span class="token number">0.070</span> ms
<span class="token number">64</span> bytes from mysql.hmall <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span>: <span class="token assign-left variable">icmp_seq</span><span class="token operator">=</span><span class="token number">2</span> <span class="token assign-left variable">ttl</span><span class="token operator">=</span><span class="token number">64</span> <span class="token assign-left variable">time</span><span class="token operator">=</span><span class="token number">0.056</span> ms
<span class="token comment"># 4.3.用容器名访问</span>
<span class="token function">ping</span> mysql
<span class="token comment"># 结果：</span>
PING mysql <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span> <span class="token number">56</span><span class="token punctuation">(</span><span class="token number">84</span><span class="token punctuation">)</span> bytes of data.
<span class="token number">64</span> bytes from mysql.hmall <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span>: <span class="token assign-left variable">icmp_seq</span><span class="token operator">=</span><span class="token number">1</span> <span class="token assign-left variable">ttl</span><span class="token operator">=</span><span class="token number">64</span> <span class="token assign-left variable">time</span><span class="token operator">=</span><span class="token number">0.044</span> ms
<span class="token number">64</span> bytes from mysql.hmall <span class="token punctuation">(</span><span class="token number">172.18</span>.0.2<span class="token punctuation">)</span>: <span class="token assign-left variable">icmp_seq</span><span class="token operator">=</span><span class="token number">2</span> <span class="token assign-left variable">ttl</span><span class="token operator">=</span><span class="token number">64</span> <span class="token assign-left variable">time</span><span class="token operator">=</span><span class="token number">0.054</span> ms
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container tip"><p class="hint-container-title">总结：</p><ul><li>在自定义网络中，可以给容器起多个别名，默认的别名是容器名本身</li><li>在同一个自定义网络中的容器，可以通过别名互相访问</li></ul></div><h3 id="_6、dockercompose" tabindex="-1"><a class="header-anchor" href="#_6、dockercompose"><span>6、DockerCompose</span></a></h3><p>Docker Compose通过一个单独的docker-compose.ymL模板文件(YAML格式)来定义一组相关联的应用容器，帮助我们实现<strong>多个相互关联的Docker容器的快速部署。</strong></p><figure><img src="`+o+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>示例：</p><div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre class="language-yaml"><code><span class="token key atrule">version</span><span class="token punctuation">:</span> <span class="token string">&quot;3.8&quot;</span>

<span class="token key atrule">services</span><span class="token punctuation">:</span>
  <span class="token key atrule">mysql</span><span class="token punctuation">:</span>
    <span class="token key atrule">image</span><span class="token punctuation">:</span> mysql
    <span class="token key atrule">container_name</span><span class="token punctuation">:</span> mysql
    <span class="token key atrule">ports</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;3306:3306&quot;</span>
    <span class="token key atrule">environment</span><span class="token punctuation">:</span>
      <span class="token key atrule">TZ</span><span class="token punctuation">:</span> Asia/Shanghai
      <span class="token key atrule">MYSQL_ROOT_PASSWORD</span><span class="token punctuation">:</span> <span class="token number">123</span>
    <span class="token key atrule">volumes</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;./mysql/conf:/etc/mysql/conf.d&quot;</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;./mysql/data:/var/lib/mysql&quot;</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;./mysql/init:/docker-entrypoint-initdb.d&quot;</span>
    <span class="token key atrule">networks</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> hm<span class="token punctuation">-</span>net
  <span class="token key atrule">hmall</span><span class="token punctuation">:</span>
    <span class="token key atrule">build</span><span class="token punctuation">:</span> 
      <span class="token key atrule">context</span><span class="token punctuation">:</span> .
      <span class="token key atrule">dockerfile</span><span class="token punctuation">:</span> Dockerfile
    <span class="token key atrule">container_name</span><span class="token punctuation">:</span> hmall
    <span class="token key atrule">ports</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;8080:8080&quot;</span>
    <span class="token key atrule">networks</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> hm<span class="token punctuation">-</span>net
    <span class="token key atrule">depends_on</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> mysql
  <span class="token key atrule">nginx</span><span class="token punctuation">:</span>
    <span class="token key atrule">image</span><span class="token punctuation">:</span> nginx
    <span class="token key atrule">container_name</span><span class="token punctuation">:</span> nginx
    <span class="token key atrule">ports</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;18080:18080&quot;</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;18081:18081&quot;</span>
    <span class="token key atrule">volumes</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;./nginx/nginx.conf:/etc/nginx/nginx.conf&quot;</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;./nginx/html:/usr/share/nginx/html&quot;</span>
    <span class="token key atrule">depends_on</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> hmall
    <span class="token key atrule">networks</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> hm<span class="token punctuation">-</span>net
<span class="token key atrule">networks</span><span class="token punctuation">:</span>
  <span class="token key atrule">hm-net</span><span class="token punctuation">:</span>
    <span class="token key atrule">name</span><span class="token punctuation">:</span> hmall
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>docker compose 命令格式：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> compose <span class="token punctuation">[</span>OPTIONS<span class="token punctuation">]</span> <span class="token punctuation">[</span>COMMAND<span class="token punctuation">]</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><ul><li><p><code>Options</code></p><ul><li><code>-f</code>指定compose文件的路径和名称</li><li><code>-p</code>指定project名称</li></ul></li><li><p><code>Commands</code></p><ul><li><code>up</code> 创建并启动所有service容器</li><li><code>down</code>停止并移除所有容器，网络</li><li><code>ps</code>列出所有启动的容器</li><li><code>logs</code>查看指定容器的日志</li><li><code>stop</code>停止容器</li><li><code>start</code>启动容器</li><li><code>restart</code> 重启容器</li><li><code>top</code>查看运行的进程</li><li><code>exec</code>在指定的运行中容器中执行命令</li></ul></li></ul><p><strong>示例：</strong> 使用DockerCompose部署minio</p><p>docker-compose.yml文件</p><div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre class="language-yaml"><code><span class="token key atrule">version</span><span class="token punctuation">:</span> <span class="token string">&#39;3&#39;</span>
<span class="token key atrule">services</span><span class="token punctuation">:</span>
  <span class="token key atrule">minio</span><span class="token punctuation">:</span>
    <span class="token key atrule">image</span><span class="token punctuation">:</span> minio/minio
    <span class="token key atrule">container_name</span><span class="token punctuation">:</span> minio
    <span class="token key atrule">volumes</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> /root/minio/data1<span class="token punctuation">:</span>/data1
      <span class="token punctuation">-</span> /root/minio/data2<span class="token punctuation">:</span>/data2
      <span class="token punctuation">-</span> /root/minio/data3<span class="token punctuation">:</span>/data3
    <span class="token key atrule">command</span><span class="token punctuation">:</span> server <span class="token punctuation">-</span><span class="token punctuation">-</span>console<span class="token punctuation">-</span>address &quot;<span class="token punctuation">:</span>9001&quot; /data1 /data2 /data3
    <span class="token key atrule">ports</span><span class="token punctuation">:</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;9000:9000&quot;</span>
      <span class="token punctuation">-</span> <span class="token string">&quot;9001:9001&quot;</span>
    <span class="token key atrule">environment</span><span class="token punctuation">:</span>
      <span class="token key atrule">MINIO_ACCESS_KEY</span><span class="token punctuation">:</span> minio
      <span class="token key atrule">MINIO_SECRET_KEY</span><span class="token punctuation">:</span> minio
    <span class="token key atrule">networks</span><span class="token punctuation">:</span>
       <span class="token punctuation">-</span> hm<span class="token punctuation">-</span>net
<span class="token key atrule">networks</span><span class="token punctuation">:</span>
  <span class="token key atrule">hm-net</span><span class="token punctuation">:</span>
    <span class="token key atrule">external</span><span class="token punctuation">:</span> <span class="token boolean important">true</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>启动：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> compose up <span class="token parameter variable">-d</span>  <span class="token comment">#-d是后台启动</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>其他命令：</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token comment"># 查看镜像</span>
<span class="token function">docker</span> compose images
<span class="token comment">#查看配置: </span>
<span class="token function">docker-compose</span> config
<span class="token comment"># 后台启动: </span>
<span class="token function">docker-compose</span> up <span class="token parameter variable">-d</span>
<span class="token comment"># 构建镜像: </span>
<span class="token function">docker-compose</span> build
<span class="token comment"># 下载镜像: </span>
<span class="token function">docker-compose</span> pull
<span class="token comment"># 查看正在运行: </span>
<span class="token function">docker-compose</span> <span class="token function">ps</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="四、案例" tabindex="-1"><a class="header-anchor" href="#四、案例"><span>四、案例</span></a></h2><h3 id="_1、部署mysql" tabindex="-1"><a class="header-anchor" href="#_1、部署mysql"><span>1、部署mysql</span></a></h3><p>首先启动一个mysql并复制配置文件到宿主机器</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> <span class="token function">cp</span> mysql:/var/lib/mysql /root/mysql/data
<span class="token function">docker</span> <span class="token function">cp</span> mysql:/etc/mysql/conf.d /root/mysql/conf
<span class="token function">docker</span> <span class="token function">cp</span> mysql:/docker-entrypoint-initdb.d /root/mysql/init
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>之后删除之前的容器，并重新按以下命令启动</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> run <span class="token parameter variable">-d</span> <span class="token punctuation">\\</span>
  <span class="token parameter variable">--name</span> mysql <span class="token punctuation">\\</span>
  <span class="token parameter variable">-p</span> <span class="token number">3306</span>:3306 <span class="token punctuation">\\</span>
  <span class="token parameter variable">-e</span> <span class="token assign-left variable">TZ</span><span class="token operator">=</span>Asia/Shanghai <span class="token punctuation">\\</span>
  <span class="token parameter variable">-e</span> <span class="token assign-left variable">MYSQL_ROOT_PASSWORD</span><span class="token operator">=</span><span class="token number">123</span> <span class="token punctuation">\\</span>
  <span class="token parameter variable">-v</span> /root/mysql/data:/var/lib/mysql <span class="token punctuation">\\</span>
  <span class="token parameter variable">-v</span> /root/mysql/conf:/etc/mysql/conf.d <span class="token punctuation">\\</span>
  <span class="token parameter variable">-v</span> /root/mysql/init:/docker-entrypoint-initdb.d <span class="token punctuation">\\</span>
  <span class="token parameter variable">--network</span> hm-net<span class="token punctuation">\\</span>
  mysql
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、nginx" tabindex="-1"><a class="header-anchor" href="#_2、nginx"><span>2、nginx</span></a></h3><p>拷贝要挂载的文件</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> <span class="token function">cp</span> nginx:/etc/nginx /root/nginx_blog/conf
<span class="token function">docker</span> <span class="token function">cp</span> nginx:/usr/share/nginx/html /root/nginx_blog/html
<span class="token function">docker</span> <span class="token function">cp</span> nginx:/var/log/nginx /root/nginx_blog/logs
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>启动</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> run <span class="token parameter variable">-d</span> <span class="token punctuation">\\</span>
<span class="token parameter variable">-p</span> <span class="token number">80</span>:80 <span class="token punctuation">\\</span>
<span class="token parameter variable">--name</span> nginx_blog <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/nginx_blog/html:/usr/share/nginx/html <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/nginx_blog/logs:/var/log/nginx <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/nginx_blog/conf:/etc/nginx <span class="token punctuation">\\</span>
nginx
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、seata" tabindex="-1"><a class="header-anchor" href="#_3、seata"><span>3、seata</span></a></h3><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code>docker run --name seata \\
-p 8099:8099 \\
-p 7099:7099 \\
-e SEATA_IP=ipaddr \\
-v ./seata:/seata-server/resources \\
--privileged=true \\
--network hm-net \\
-d \\
seataio/seata-server:1.5.2
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、nacos" tabindex="-1"><a class="header-anchor" href="#_4、nacos"><span>4、nacos</span></a></h3><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code>docker run -d \\
--name nacos \\
--env-file ./nacos/custom.env \\
-p 8848:8848 \\
-p 9848:9848 \\
-p 9849:9849 \\
--restart=always \\
--network hm-net\\
nacos/nacos-server:v2.1.0-slim
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_5、sentinel" tabindex="-1"><a class="header-anchor" href="#_5、sentinel"><span>5、sentinel</span></a></h3><p>dockerfile:</p><div class="language-docker line-numbers-mode" data-ext="docker" data-title="docker"><pre class="language-docker"><code><span class="token comment"># 基础镜像</span>
<span class="token instruction"><span class="token keyword">FROM</span> openjdk:11.0-jre-buster</span>
<span class="token comment"># 设定时区</span>
<span class="token instruction"><span class="token keyword">ENV</span> TZ=Asia/Shanghai</span>
<span class="token instruction"><span class="token keyword">RUN</span> ln -snf /usr/share/zoneinfo/<span class="token variable">$TZ</span> /etc/localtime &amp;&amp; echo <span class="token variable">$TZ</span> &gt; /etc/timezone</span>
<span class="token comment"># 拷贝jar包</span>
<span class="token instruction"><span class="token keyword">COPY</span> sentinel-dashboard.jar /app.jar</span>
<span class="token comment"># COPY run.sh /run.sh</span>
<span class="token comment"># 入口</span>
<span class="token comment"># ENTRYPOINT [&quot;sh&quot;,  &quot;/run.sh&quot;]</span>
<span class="token instruction"><span class="token keyword">ENTRYPOINT</span> [<span class="token string">&quot;java&quot;</span>, <span class="token string">&quot;-Dserver.port=8090&quot;</span>, <span class="token string">&quot;-Dcsp.sentinel.dashboard.server=localhost:8090&quot;</span>, <span class="token string">&quot;-Dproject.name=sentinel-dashboard&quot;</span>, <span class="token string">&quot;-jar&quot;</span>, <span class="token string">&quot;/app.jar&quot;</span>]</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_6、xxl-job" tabindex="-1"><a class="header-anchor" href="#_6、xxl-job"><span>6、xxl-job</span></a></h3><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code> <span class="token function">docker</span> run <span class="token parameter variable">-d</span> <span class="token punctuation">\\</span>
 <span class="token parameter variable">-e</span> <span class="token assign-left variable">PARAMS</span><span class="token operator">=</span><span class="token string">&quot;--spring.datasource.url=jdbc:mysql://mysql:3306/xxl_job?Unicode=true&amp;characterEncoding=UTF-8 --spring.datasource.username=root --spring.datasource.password=123&quot;</span> <span class="token punctuation">\\</span>
 <span class="token parameter variable">-p</span> <span class="token number">8088</span>:8080 <span class="token punctuation">\\</span>
 <span class="token parameter variable">-v</span> /root/xxl-job:/data/applogs <span class="token punctuation">\\</span>
 <span class="token parameter variable">--name</span> xxl-job <span class="token punctuation">\\</span>
 <span class="token parameter variable">--privileged</span><span class="token operator">=</span>true <span class="token punctuation">\\</span>
 <span class="token parameter variable">--network</span> hm-net <span class="token punctuation">\\</span>
 xuxueli/xxl-job-admin:2.3.1
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div>`,126);function r(u,m){return i(),s("div",null,[a("more-"),d])}const b=n(p,[["render",r],["__file","Docker.html.vue"]]),h=JSON.parse('{"path":"/posts/%E5%B7%A5%E5%85%B7/Docker.html","title":"Docker","lang":"zh-CN","frontmatter":{"title":"Docker","date":"2024-06-18T00:00:00.000Z","tags":"code","category":"工具","description":"Docker的使用指南","head":[["meta",{"property":"og:url","content":"https://mister-hope.github.io/posts/%E5%B7%A5%E5%85%B7/Docker.html"}],["meta",{"property":"og:site_name","content":"chuoer47"}],["meta",{"property":"og:title","content":"Docker"}],["meta",{"property":"og:description","content":"Docker的使用指南"}],["meta",{"property":"og:type","content":"article"}],["meta",{"property":"og:image","content":"https://mister-hope.github.io/image\\\\docker4.png"}],["meta",{"property":"og:locale","content":"zh-CN"}],["meta",{"property":"article:author","content":"chuoer47"}],["meta",{"property":"article:published_time","content":"2024-06-18T00:00:00.000Z"}],["script",{"type":"application/ld+json"},"{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"Article\\",\\"headline\\":\\"Docker\\",\\"image\\":[\\"https://mister-hope.github.io/image\\\\\\\\docker4.png\\",\\"https://mister-hope.github.io/image\\\\\\\\docker1.png\\",\\"https://mister-hope.github.io/image\\\\\\\\docker2.png\\",\\"https://mister-hope.github.io/image\\\\\\\\docker3.png\\"],\\"datePublished\\":\\"2024-06-18T00:00:00.000Z\\",\\"dateModified\\":null,\\"author\\":[{\\"@type\\":\\"Person\\",\\"name\\":\\"chuoer47\\"}]}"]]},"headers":[{"level":2,"title":"一、Dcoker介绍","slug":"一、dcoker介绍","link":"#一、dcoker介绍","children":[]},{"level":2,"title":"二、Docker安装","slug":"二、docker安装","link":"#二、docker安装","children":[{"level":3,"title":"1、卸载老版本","slug":"_1、卸载老版本","link":"#_1、卸载老版本","children":[]},{"level":3,"title":"2、更新软件包","slug":"_2、更新软件包","link":"#_2、更新软件包","children":[]},{"level":3,"title":"3、安装docker依赖","slug":"_3、安装docker依赖","link":"#_3、安装docker依赖","children":[]},{"level":3,"title":"4、添加Docker官方GPG密钥","slug":"_4、添加docker官方gpg密钥","link":"#_4、添加docker官方gpg密钥","children":[]},{"level":3,"title":"5、添加docker软件源","slug":"_5、添加docker软件源","link":"#_5、添加docker软件源","children":[]},{"level":3,"title":"6、安装docker","slug":"_6、安装docker","link":"#_6、安装docker","children":[]},{"level":3,"title":"7、配置用户组（可选）","slug":"_7、配置用户组-可选","link":"#_7、配置用户组-可选","children":[]},{"level":3,"title":"8、启动","slug":"_8、启动","link":"#_8、启动","children":[]},{"level":3,"title":"9、配置镜像加速","slug":"_9、配置镜像加速","link":"#_9、配置镜像加速","children":[]}]},{"level":2,"title":"三、docker基础","slug":"三、docker基础","link":"#三、docker基础","children":[{"level":3,"title":"1、快速入门","slug":"_1、快速入门","link":"#_1、快速入门","children":[]},{"level":3,"title":"2、常见命令","slug":"_2、常见命令","link":"#_2、常见命令","children":[]},{"level":3,"title":"3、数据卷","slug":"_3、数据卷","link":"#_3、数据卷","children":[]},{"level":3,"title":"4、自定义镜像","slug":"_4、自定义镜像","link":"#_4、自定义镜像","children":[]},{"level":3,"title":"5、容器网络互联","slug":"_5、容器网络互联","link":"#_5、容器网络互联","children":[]},{"level":3,"title":"6、DockerCompose","slug":"_6、dockercompose","link":"#_6、dockercompose","children":[]}]},{"level":2,"title":"四、案例","slug":"四、案例","link":"#四、案例","children":[{"level":3,"title":"1、部署mysql","slug":"_1、部署mysql","link":"#_1、部署mysql","children":[]},{"level":3,"title":"2、nginx","slug":"_2、nginx","link":"#_2、nginx","children":[]},{"level":3,"title":"3、seata","slug":"_3、seata","link":"#_3、seata","children":[]},{"level":3,"title":"4、nacos","slug":"_4、nacos","link":"#_4、nacos","children":[]},{"level":3,"title":"5、sentinel","slug":"_5、sentinel","link":"#_5、sentinel","children":[]},{"level":3,"title":"6、xxl-job","slug":"_6、xxl-job","link":"#_6、xxl-job","children":[]}]}],"git":{},"readingTime":{"minutes":11.15,"words":3344},"filePathRelative":"posts/工具/Docker.md","localizedDate":"2024年6月18日","excerpt":"<!--more--->\\n<h1>Docker</h1>\\n<h2>一、Dcoker介绍</h2>\\n<p>Docker是基于Go语言开发的开源应用容器引擎，遵从Apache Licence 2.0协议，可以让开发者打包应用以及应用的依赖包到一个可移植的容器中，然后发布到各种发行版本的Linux系统上。</p>\\n<p>​\\t\\t软件开发中最为麻烦的事情可能就是配置环境了。由于用户使用的操作系统具有多样性，即便使用跨平台的开发语言（如Java和Python）都不能保证代码能够在各种平台下都可以正常的运转，而且在不同的环境下我们安装的软件需要依赖的软件包也是不一样的。</p>\\n<p>那么问题来了，我们安装软件的时候可不可以把软件运行的环境一并安装？我们是不是可以把原始环境一模一样地复制过来呢？</p>"}');export{b as comp,h as data};
