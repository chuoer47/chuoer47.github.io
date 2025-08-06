import{_ as a}from"./plugin-vue_export-helper-DlAUqK2U.js";import{c as e,a as s,b as n,o as l}from"./app-BBThAt0D.js";const i="/image/mysql/mysql1.png",t="/image/mysql/mysql2.png",r={},c=n('<h1 id="canal数据同步" tabindex="-1"><a class="header-anchor" href="#canal数据同步"><span>Canal数据同步</span></a></h1><h2 id="一、介绍" tabindex="-1"><a class="header-anchor" href="#一、介绍"><span>一、介绍</span></a></h2><img src="'+i+'" style="zoom:50%;"><p>canal，译意为水道/管道/沟渠，主要用途是基于 <strong>MySQL 数据库增量日志解析</strong>，提供<strong>增量数据订阅和消费</strong>。</p>',4),o=n(`<p>我们常常能遇到异构数据的同步问题，最典型的就是缓存一致性问题。之前我们需要在更新数据库后执行删除缓存操作，而这部分代码往往是高度耦合的。</p><p>canal是阿里巴巴开源的MySQL binlog 增量订阅&amp;消费组件。它的原理是伪装成MySQL的从库来监听主库的binlog。因此，我们可以使用canal+MQ的方式把更新数据库和删除缓存进行解耦，同时还可以使用这种方式进行MySQL主从复制以及ES和MySQL的数据同步。</p><h3 id="_1、工作原理" tabindex="-1"><a class="header-anchor" href="#_1、工作原理"><span>1、工作原理</span></a></h3><p><strong>MySQL主备复制原理</strong></p><ul><li>MySQL master 将数据变更写入二进制日志( binary log, 其中记录叫做二进制日志事件binary log events，可以通过 show binlog events 进行查看)</li><li>MySQL slave 将 master 的 binary log events 拷贝到它的中继日志(relay log)</li><li>MySQL slave 重放 relay log 中事件，将数据变更反映它自己的数据</li></ul><p><strong>canal 工作原理</strong></p><ul><li>canal 模拟 MySQL slave 的交互协议，伪装自己为 MySQL slave ，向 MySQL master 发送dump 协议</li><li>MySQL master 收到 dump 请求，开始推送 binary log 给 slave (即 canal )</li><li>canal 解析 binary log 对象(原始为 byte 流)</li></ul><h3 id="_2、canal能做什么" tabindex="-1"><a class="header-anchor" href="#_2、canal能做什么"><span>2、canal能做什么</span></a></h3><p>以下参考<a href="https://github.com/alibaba/canal" target="_blank" rel="noopener noreferrer">canal官网</a>。与其问canal能做什么，不如说数据同步有什么作用。</p><p>但是canal的数据同步<strong>不是全量的，而是增量</strong>，基于binary log增量订阅和消费。</p><div class="hint-container tip"><p class="hint-container-title">canal可以做：</p><ul><li>数据库镜像</li><li>数据库实时备份</li><li>索引构建和实时维护</li><li>业务cache(缓存)刷新</li><li>带业务逻辑的增量数据处理</li></ul></div><h2 id="二、环境搭建" tabindex="-1"><a class="header-anchor" href="#二、环境搭建"><span>二、环境搭建</span></a></h2><h3 id="_1、mysql" tabindex="-1"><a class="header-anchor" href="#_1、mysql"><span>1、MySQL</span></a></h3><p>canal的原理是基于mysql binlog技术，所以这里一定需要开启mysql的binlog写入功能。</p><h4 id="_1-检查binlog写入功能是否开启" tabindex="-1"><a class="header-anchor" href="#_1-检查binlog写入功能是否开启"><span>1）检查binlog写入功能是否开启</span></a></h4><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code>mysql<span class="token operator">&gt;</span> show variables like <span class="token string">&#39;log_bin&#39;</span><span class="token punctuation">;</span>
+---------------+-------+
<span class="token operator">|</span> Variable_name <span class="token operator">|</span> Value <span class="token operator">|</span>
+---------------+-------+
<span class="token operator">|</span> log_bin       <span class="token operator">|</span> OFF    <span class="token operator">|</span>
+---------------+-------+
<span class="token number">1</span> row <span class="token keyword">in</span> <span class="token builtin class-name">set</span> <span class="token punctuation">(</span><span class="token number">0.00</span> sec<span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-如果log-bin为off-则表示未开启-开启binlog写入功能" tabindex="-1"><a class="header-anchor" href="#_2-如果log-bin为off-则表示未开启-开启binlog写入功能"><span>2）如果log_bin为OFF，则表示未开启，开启binlog写入功能</span></a></h4><ol><li>修改 mysql 的配置文件 my.cnf</li></ol><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">vi</span> /etc/my.cnf 
追加内容：
log-bin<span class="token operator">=</span>mysql-bin     <span class="token comment">#binlog文件名</span>
<span class="token assign-left variable">binlog_format</span><span class="token operator">=</span>ROW     <span class="token comment">#选择row模式</span>
<span class="token assign-left variable">server_id</span><span class="token operator">=</span><span class="token number">1</span>           <span class="token comment">#mysql实例id,不能和canal的slave Id重复</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ol start="2"><li>重启 mysql</li></ol><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">service</span> mysql restart	
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><ol start="3"><li>登录 mysql 客户端，查看 log_bin 变量</li></ol><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code>mysql<span class="token operator">&gt;</span> show variables like <span class="token string">&#39;log_bin&#39;</span><span class="token punctuation">;</span>
+---------------+-------+
<span class="token operator">|</span> Variable_name <span class="token operator">|</span> Value <span class="token operator">|</span>
+---------------+-------+
<span class="token operator">|</span> log_bin       <span class="token operator">|</span> ON<span class="token operator">|</span>
+---------------+-------+
<span class="token number">1</span> row <span class="token keyword">in</span> <span class="token builtin class-name">set</span> <span class="token punctuation">(</span><span class="token number">0.00</span> sec<span class="token punctuation">)</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>log_bin 为ON表示已开启。</p><h3 id="_2、canal" tabindex="-1"><a class="header-anchor" href="#_2、canal"><span>2、Canal</span></a></h3><p>我们使用docker来安装canal,首先拉取canal镜像，我们使用v1.1.5版本</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> pull canal/canal-server:v1.1.5
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>之后启动镜像，并将配置文件拷贝出来(先在root目录下创建canal文件夹)</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> run <span class="token parameter variable">--name</span> canal-server <span class="token parameter variable">-id</span> canal/canal-server:v1.1.5

<span class="token comment"># 复制配置文件</span>
<span class="token function">docker</span> <span class="token function">cp</span> canal-server:/home/admin/canal-server/conf/ /root/canal
<span class="token function">docker</span> <span class="token function">cp</span> canal-server:/home/admin/canal-server/logs/ /root/canal
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>删除刚刚启动的容器，修改配置文件</p><p>修改Server配置文件<code>root/canal/example/instance.properties</code>，主要修改以下几个地方</p><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code>## mysql serverId , v1.0.26+ will autoGen
canal.instance.mysql.slaveId= 20   #1、设置从库id,需要和刚刚mysql中设置的不同

# position info
canal.instance.master.address=mysql:3306   # 2、mysql地址，由于我的canal和mysql在一个网络下，因此直接使用mysql的容器名

#3、 username/password
canal.instance.dbUsername=canal
canal.instance.dbPassword=canal
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>之后启动canal容器</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> run <span class="token parameter variable">--name</span> canal <span class="token parameter variable">-p</span> <span class="token number">11111</span>:11111 <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/canal/conf/example/instance.properties:/home/admin/canal-server/conf/example/instance.properties <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/canal/conf/canal.properties:/home/admin/canal-server/conf/canal.properties <span class="token punctuation">\\</span>
<span class="token parameter variable">-v</span> /root/canal/logs/:/home/admin/canal-server/logs/ <span class="token punctuation">\\</span>
<span class="token parameter variable">--network</span> hm-net <span class="token parameter variable">-d</span> canal/canal-server:v1.1.5
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>验证是否启动成功</p><div class="language-bash line-numbers-mode" data-ext="sh" data-title="sh"><pre class="language-bash"><code><span class="token function">docker</span> <span class="token builtin class-name">exec</span> <span class="token parameter variable">-it</span> canal <span class="token function">bash</span>
<span class="token builtin class-name">cd</span> canal-server/logs/example/
<span class="token function">tail</span> <span class="token parameter variable">-100f</span> example.log  // 查看日志
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_3、tcp模式" tabindex="-1"><a class="header-anchor" href="#_3、tcp模式"><span>3、TCP模式</span></a></h3><p>从配置文件<code>canal/conf/canal.properties</code>中可以发现，canal默认模式为TCP模式，在TCP模式下可以使用客户端来接收</p><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code># tcp, kafka, rocketMQ, rabbitMQ
canal.serverMode = tcp
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>以Java客户端为例，首先需要引入依赖：</p><div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre class="language-xml"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">&gt;</span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">&gt;</span></span>com.alibaba.otter<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">&gt;</span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">&gt;</span></span>canal.client<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">&gt;</span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">&gt;</span></span>1.1.0<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">&gt;</span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">&gt;</span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>Client代码:</p><p>其中每次获取的entity的结构如图所示：</p><figure><img src="`+t+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>对数据的解析代码如下，还可以参考官网给出的一些开源解析工具</p><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code>public class CanalClient {
    //sql队列
    private Queue&lt;String&gt; SQL_QUEUE = new ConcurrentLinkedQueue&lt;&gt;();

    @Test
    public void run() throws InterruptedException, InvalidProtocolBufferException {
				//获取连接
        CanalConnector connector = CanalConnectors.newSingleConnector(new InetSocketAddress(&quot;192.168.175.129&quot;,
                11111), &quot;example&quot;, &quot;&quot;, &quot;&quot;);
        //每次抓取的数据量，不足的话也不会阻塞，有多少读多少
        int batchSize = 10;
        while(true){
            connector.connect();
            connector.subscribe(&quot;hm-item.*&quot;); // 订阅的数据库表
            Message message = connector.get(batchSize); //获取数据
            List&lt;Entry&gt; entries = message.getEntries();   //获取entity集合
            if(entries.size() &lt;= 0){ 
//                System.out.println(&quot;当次抓取没有数据&quot;);
                Thread.sleep(10000);
            }else {
                for (Entry entry : entries) {
                    //获取表名
                    String tableName = entry.getHeader().getTableName();
                    //获取类型
                    EntryType entryType = entry.getEntryType();
                    //获取序列化后的数据
                    ByteString storeValue = entry.getStoreValue();
                    //判断当前entryType是否为rawData
                    if(EntryType.ROWDATA.equals(entryType)){
                        RowChange rowChange = RowChange.parseFrom(storeValue);  //反序列化数据
                        EventType eventType = rowChange.getEventType(); //获取当前事件的操作类型
                        //获取数据集（一个SQL可能改变多行数据）
                        List&lt;RowData&gt; rowDatasList = rowChange.getRowDatasList(); 
                        for (RowData rowData : rowDatasList) {
                        		//获取改变前的数据以及改变后的数据
                            JSONObject beforeData = new JSONObject();
                            List&lt;Column&gt; beforeColumnsList = rowData.getBeforeColumnsList();
                            for (Column column : beforeColumnsList) {
                                beforeData.put(column.getName(), column.getValue());
                            }
                            JSONObject afterData = new JSONObject();
                            List&lt;Column&gt; afterColumnsList = rowData.getAfterColumnsList();
                            for (Column column : afterColumnsList) {
                                afterData.put(column.getName(), column.getValue());
                            }
														//打印数据
                            System.out.println(&quot;===============================&quot;);
                            System.out.println(&quot;table:&quot; + tableName+&quot;,eventType:&quot;+eventType);
                            System.out.println(&quot;beforeData:&quot;+beforeData);
                            System.out.println(&quot;afterData:&quot;+afterData);
                            System.out.println(&quot;================================&quot;);
                        }

                    }

                }
            }
        }
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>获取到数据后就可以进行下一步同步操作。</p><h3 id="_4、rabbitmq模式" tabindex="-1"><a class="header-anchor" href="#_4、rabbitmq模式"><span>4、RabbitMQ模式</span></a></h3><p>canal 作为 MySQL binlog 增量获取和解析工具，可将变更记录投递到 MQ 系统中，比如 Kafka/RocketMQ，可以借助于 MQ 的多语言能力。</p><p>1）修改配置文件<code>canal/conf/canal.properties</code></p><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code># tcp, kafka, rocketMQ, rabbitMQ
canal.serverMode = rabbitMQ //1、模式修改为rabbitMQ

// 2、修改rabbitmq配置信息
##################################################
######### 		    RabbitMQ	     #############
##################################################
rabbitmq.host = 192.168.175.129
rabbitmq.virtual.host = /hmall
rabbitmq.exchange = canal.direct
rabbitmq.username = hmall
rabbitmq.password = 123
rabbitmq.deliveryMode = 
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2）修改配置文件<code>canal/conf/example/instance.properties</code></p><div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre class="language-text"><code># table regex
canal.instance.filter.regex=hm-item\\\\..*  //1、修改过滤规则，只监听hm-item数据库

# mq config
canal.mq.topic=example  //2、设置mq的routing-key，必须和mq中设置的相同
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在mq中创建对应的交换机和队列，重新启动canal并测试发现mq成功收到更新信息，后续可以使用mq消费者进行同步操作。</p><h1 id="参考" tabindex="-1"><a class="header-anchor" href="#参考"><span>参考：</span></a></h1><p>[1] <a href="https://github.com/alibaba/canal" target="_blank" rel="noopener noreferrer">https://github.com/alibaba/canal</a></p><p>[2] <a href="https://blog.csdn.net/weixin_42194695/article/details/125935200?utm_source=miniapp_weixin" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/weixin_42194695/article/details/125935200?utm_source=miniapp_weixin</a></p><p>[3] <a href="https://blog.csdn.net/weixin_42763696/article/details/132188296" target="_blank" rel="noopener noreferrer">https://blog.csdn.net/weixin_42763696/article/details/132188296</a></p>`,58);function d(p,u){return l(),e("div",null,[c,s(" more "),o])}const b=a(r,[["render",d],["__file","4_canal.html.vue"]]),g=JSON.parse('{"path":"/posts/%E5%90%8E%E7%AB%AF/%E6%95%B0%E6%8D%AE%E5%BA%93/4_canal.html","title":"Canal数据同步","lang":"zh-CN","frontmatter":{"title":"Canal数据同步","date":"2024-07-07T16:24:22.000Z","tag":"mysql","category":["数据库","数据同步"],"icon":"/img/数据同步.svg","order":4,"description":"一、介绍 canal，译意为水道/管道/沟渠，主要用途是基于 MySQL 数据库增量日志解析，提供增量数据订阅和消费。","head":[["meta",{"property":"og:url","content":"https://mister-hope.github.io/posts/%E5%90%8E%E7%AB%AF/%E6%95%B0%E6%8D%AE%E5%BA%93/4_canal.html"}],["meta",{"property":"og:site_name","content":"chuoer47"}],["meta",{"property":"og:title","content":"Canal数据同步"}],["meta",{"property":"og:description","content":"一、介绍 canal，译意为水道/管道/沟渠，主要用途是基于 MySQL 数据库增量日志解析，提供增量数据订阅和消费。"}],["meta",{"property":"og:type","content":"article"}],["meta",{"property":"og:image","content":"https://mister-hope.github.io/image\\\\mysql\\\\mysql2.png"}],["meta",{"property":"og:locale","content":"zh-CN"}],["meta",{"property":"article:author","content":"chuoer47"}],["meta",{"property":"article:tag","content":"mysql"}],["meta",{"property":"article:published_time","content":"2024-07-07T16:24:22.000Z"}],["script",{"type":"application/ld+json"},"{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"Article\\",\\"headline\\":\\"Canal数据同步\\",\\"image\\":[\\"https://mister-hope.github.io/image\\\\\\\\mysql\\\\\\\\mysql2.png\\"],\\"datePublished\\":\\"2024-07-07T16:24:22.000Z\\",\\"dateModified\\":null,\\"author\\":[{\\"@type\\":\\"Person\\",\\"name\\":\\"chuoer47\\"}]}"]]},"headers":[{"level":2,"title":"一、介绍","slug":"一、介绍","link":"#一、介绍","children":[{"level":3,"title":"1、工作原理","slug":"_1、工作原理","link":"#_1、工作原理","children":[]},{"level":3,"title":"2、canal能做什么","slug":"_2、canal能做什么","link":"#_2、canal能做什么","children":[]}]},{"level":2,"title":"二、环境搭建","slug":"二、环境搭建","link":"#二、环境搭建","children":[{"level":3,"title":"1、MySQL","slug":"_1、mysql","link":"#_1、mysql","children":[]},{"level":3,"title":"2、Canal","slug":"_2、canal","link":"#_2、canal","children":[]},{"level":3,"title":"3、TCP模式","slug":"_3、tcp模式","link":"#_3、tcp模式","children":[]},{"level":3,"title":"4、RabbitMQ模式","slug":"_4、rabbitmq模式","link":"#_4、rabbitmq模式","children":[]}]}],"git":{},"readingTime":{"minutes":5.16,"words":1547},"filePathRelative":"posts/后端/数据库/4_canal.md","localizedDate":"2024年7月8日","excerpt":"\\n<h2>一、介绍</h2>\\n<img src=\\"/image\\\\mysql\\\\mysql1.png\\" style=\\"zoom:50%;\\">\\n<p>canal，译意为水道/管道/沟渠，主要用途是基于 <strong>MySQL 数据库增量日志解析</strong>，提供<strong>增量数据订阅和消费</strong>。</p>\\n","autoDesc":true}');export{b as comp,g as data};
