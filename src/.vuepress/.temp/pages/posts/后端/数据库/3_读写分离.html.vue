<template><div><!--more--->
<h1 id="mysql读写分离" tabindex="-1"><a class="header-anchor" href="#mysql读写分离"><span>MySQL读写分离</span></a></h1>
<h2 id="一、主从库配置" tabindex="-1"><a class="header-anchor" href="#一、主从库配置"><span>一、主从库配置</span></a></h2>
<ol>
<li>
<p>ubuntu上安装Mysql</p>
</li>
<li>
<p>修改主库环境配置</p>
</li>
</ol>
<div class="hint-container info">
<p class="hint-container-title">相关信息</p>
<p>进入 mysql 环境配置 mysql.cnf</p>
<p>vim /etc/mysql/mysql.conf.d/mysql.cnf</p>
</div>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code># 添加以下环境配置
[mysqld]
 
#[必须]主服务器唯一ID
server-id=1
 
#[必须]启用二进制日志,无后缀的文件名。也可以是本地的路径/log/bin-log
log-bin=bin-log
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改主库远程操作配置</p>
<div class="hint-container info">
<p class="hint-container-title">相关信息</p>
<p>进入数据库环境配置 mysqld.cnf</p>
<p>vim /etc/mysql/mysql.conf.d/mysqld.cnf</p>
<p>bind-address = 127.0.0.1    // 这里表示只能本机操作</p>
<p>bind-address = 0.0.0.0        // 这里表示所有IP地址都可以操作</p>
</div>
<p>重启数据库</p>
<p><code v-pre>systemctl restart mysql.service</code></p>
<ol start="3">
<li>创建从库帐号密码</li>
</ol>
<div class="hint-container info">
<p class="hint-container-title">步骤</p>
<p>（1）进入 mysql 命令行界面</p>
<p><code v-pre>mysql -u账号 -p密码</code></p>
<p>（2）创建 从库 操作账号密码 slave2</p>
<p><code v-pre>create user 'slave2'@'%' identified by '111111';</code></p>
<p><code v-pre>flush privileges;</code></p>
<p>​		PS: host 为 'localhost' 和 '127.0.0.1' 时，只允许本机登录，而 host 为 '%' 或 'IP地址' 则允许远程账号登录</p>
<p>（3）修改 host 命令</p>
<p><code v-pre>use mysql</code></p>
<p><code v-pre>update user set host='localhost' where user = 'slave2';</code></p>
<p><code v-pre>flush privileges;</code></p>
<p>（4）给 slave1 账号 授予权限</p>
<p><code v-pre>grant replication slave on master_db.* to 'slave2'@'%';</code></p>
<p><code v-pre>flush privileges;</code></p>
</div>
<p>查看帐号授权情况</p>
<p><code v-pre>show grants for 'slave2'@'%';</code></p>
<ol start="4">
<li>查看主库状态</li>
</ol>
<p><code v-pre>show master status;</code></p>
<ol start="5">
<li>从库配置</li>
</ol>
<p>首先设置id,和主库一样的操作</p>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p>如果从库是直接将主库虚拟机复制来的，需要修改从库的mysql的uuid</p>
<p>/var/lib/mysql/auto.cnf</p>
</div>
<ul>
<li>创建复制命令配置</li>
</ul>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code>change master <span class="token keyword">to</span> 
master_host <span class="token operator">=</span> <span class="token string">'主库IP地址'</span><span class="token punctuation">,</span>
master_port <span class="token operator">=</span> 主库端口<span class="token punctuation">,</span>
master_user <span class="token operator">=</span> <span class="token string">'slave2'</span><span class="token punctuation">,</span>
master_password <span class="token operator">=</span> <span class="token string">'111111'</span><span class="token punctuation">,</span>
master_log_file <span class="token operator">=</span> <span class="token string">'bin-log.000005'</span><span class="token punctuation">,</span> <span class="token comment">#File</span>
master_log_pos <span class="token operator">=</span> <span class="token number">997</span><span class="token punctuation">;</span>  <span class="token comment">#Position</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>命令</li>
</ul>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">start</span> slave    <span class="token comment">// 启动从库复制命令</span>

stop slave    <span class="token comment">// 停止从库复制命令</span>

reset slave   <span class="token comment">// 重置从库复制命令</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>查看从库状态</li>
</ul>
<div class="language-sql line-numbers-mode" data-ext="sql" data-title="sql"><pre v-pre class="language-sql"><code><span class="token keyword">show</span> slave <span class="token keyword">status</span>\G<span class="token punctuation">;</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><div class="hint-container tip">
<p class="hint-container-title">提示</p>
<p>如果已经启动复制命令成功了，那么 <strong>slave_io_running</strong> 和 <strong>slave_sql_running</strong> 都是 <strong>yes</strong></p>
<p>如果失败，可以看<code v-pre>Slave soL Running state</code></p>
</div>
<h2 id="二、springboot实现读写分离" tabindex="-1"><a class="header-anchor" href="#二、springboot实现读写分离"><span>二、SpringBoot实现读写分离</span></a></h2>
<h3 id="_1、导入依赖" tabindex="-1"><a class="header-anchor" href="#_1、导入依赖"><span>1、导入依赖</span></a></h3>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code>		<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.apache.shardingsphere<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>sharding-jdbc-spring-boot-starter<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
            <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>4.0.0-RC1<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
        <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、修改配置文件" tabindex="-1"><a class="header-anchor" href="#_2、修改配置文件"><span>2、修改配置文件</span></a></h3>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token key atrule">spring</span><span class="token punctuation">:</span>
  <span class="token key atrule">profiles</span><span class="token punctuation">:</span>
    <span class="token key atrule">active</span><span class="token punctuation">:</span> dev
  <span class="token key atrule">main</span><span class="token punctuation">:</span>
    <span class="token key atrule">allow-circular-references</span><span class="token punctuation">:</span> <span class="token boolean important">true</span>
    <span class="token key atrule">allow-bean-definition-overriding</span><span class="token punctuation">:</span> <span class="token boolean important">true</span>
  <span class="token key atrule">shardingsphere</span><span class="token punctuation">:</span>
    <span class="token key atrule">datasource</span><span class="token punctuation">:</span>
      <span class="token key atrule">names</span><span class="token punctuation">:</span>
        master<span class="token punctuation">,</span>slave
      <span class="token comment"># 主数据源</span>
      <span class="token key atrule">master</span><span class="token punctuation">:</span>
        <span class="token key atrule">type</span><span class="token punctuation">:</span> com.alibaba.druid.pool.DruidDataSource
        <span class="token key atrule">driver-class-name</span><span class="token punctuation">:</span> com.mysql.cj.jdbc.Driver
        <span class="token key atrule">url</span><span class="token punctuation">:</span> jdbc<span class="token punctuation">:</span>mysql<span class="token punctuation">:</span>//192.168.175.129<span class="token punctuation">:</span>3306/sky_take_out<span class="token punctuation">?</span>characterEncoding=utf<span class="token punctuation">-</span><span class="token number">8</span>
        <span class="token key atrule">username</span><span class="token punctuation">:</span> root
        <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">12345678</span>
      <span class="token comment"># 从数据源</span>
      <span class="token key atrule">slave</span><span class="token punctuation">:</span>
        <span class="token key atrule">type</span><span class="token punctuation">:</span> com.alibaba.druid.pool.DruidDataSource
        <span class="token key atrule">driver-class-name</span><span class="token punctuation">:</span> com.mysql.cj.jdbc.Driver
        <span class="token key atrule">url</span><span class="token punctuation">:</span> jdbc<span class="token punctuation">:</span>mysql<span class="token punctuation">:</span>//192.168.175.130<span class="token punctuation">:</span>3306/sky_take_out<span class="token punctuation">?</span>characterEncoding=utf<span class="token punctuation">-</span><span class="token number">8</span>
        <span class="token key atrule">username</span><span class="token punctuation">:</span> root
        <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">12345678</span>
    <span class="token key atrule">masterslave</span><span class="token punctuation">:</span>
      <span class="token comment"># 读写分离配置</span>
      <span class="token key atrule">load-balance-algorithm-type</span><span class="token punctuation">:</span> round_robin
      <span class="token comment"># 最终的数据源名称</span>
      <span class="token key atrule">name</span><span class="token punctuation">:</span> dataSource
      <span class="token comment"># 主库数据源名称</span>
      <span class="token key atrule">master-data-source-name</span><span class="token punctuation">:</span> master
      <span class="token comment"># 从库数据源名称列表，多个逗号分隔</span>
      <span class="token key atrule">slave-data-source-names</span><span class="token punctuation">:</span> slave
    <span class="token key atrule">props</span><span class="token punctuation">:</span>
      <span class="token key atrule">sql</span><span class="token punctuation">:</span>
        <span class="token key atrule">show</span><span class="token punctuation">:</span> <span class="token boolean important">true</span> <span class="token comment">#开启SQL显示，默认false</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


