<template><div><!--more--->
<h1 id="总结" tabindex="-1"><a class="header-anchor" href="#总结"><span>总结</span></a></h1>
<h1 id="_1-项目概况" tabindex="-1"><a class="header-anchor" href="#_1-项目概况"><span>1 项目概况</span></a></h1>
<h2 id="_1-1-项目介绍" tabindex="-1"><a class="header-anchor" href="#_1-1-项目介绍"><span>1.1 项目介绍</span></a></h2>
<p>从以下几个方面进行项目介绍：</p>
<p>1、项目的背景：做什么业务、服务的客户群是谁、谁去运营、自研还是外包等问题。</p>
<p>2、项目的业务流程：课程发布流程、断点续传流程、视频处理流程、认证授权流程、支付流程、CI/CD流程。</p>
<p>3、项目的功能模块：内容管理模块、媒资管理模块、认证授权模块、选课学习模块、订单支付模块。</p>
<p>4、项目的技术架构：Spring Cloud 、SpringBoot、MySQL、Elasticsearch、XXL-JOB、MinIO、Redis、Redisson、RabbitMQ。</p>
<p>5、个人工作职责</p>
<p>6、个人负责模块的详细说明，包括模块的设计，所用到的技术，技术的实现方案等。</p>
<p>功能模块：</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=MDUzZjgzMTMzNzhlNjZhYjhjNWFmZDdhOWU0YWJmZTZfcnJ1OEhhVUJoRW05VG5ndGNhM0xWaUZEc2Ztc3lFNzBfVG9rZW46REVRWGJBVG8xb2dNbzd4MHdvbmN3VE1LbmFkXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h2 id="_1-2-开发周期" tabindex="-1"><a class="header-anchor" href="#_1-2-开发周期"><span>1.2 开发周期</span></a></h2>
<p>项目周期8个月，其中开发4个月，测试4个月；人员共有15名。</p>
<p>Java开发共6名：3名初级程序员，2名中级程序员，1名高级程序员（兼架构师）。</p>
<p>初级程序员：负责编码、单元测试。</p>
<p>中级程序员：模块设计、核心代码编写、部分模块编码和单元测试</p>
<p>高级程序员：系统架构设计，核心代码编写</p>
<p>产品设计人员：1名</p>
<p>前端工程师：2名</p>
<p>UI设计：1名</p>
<p>测试人员：3名，其中2名功能测试，1名性能测试。</p>
<p>配置管理员：1名，作好项目代码、项目文档等资料的备份工作，负责统一分配git账号、权限。</p>
<p>项目经理：1名，负责制定项目计划、项目管理。</p>
<h1 id="_2-内容管理模块" tabindex="-1"><a class="header-anchor" href="#_2-内容管理模块"><span>2 内容管理模块</span></a></h1>
<h2 id="_2-1-内容管理模块功能开发" tabindex="-1"><a class="header-anchor" href="#_2-1-内容管理模块功能开发"><span>2.1 内容管理模块功能开发</span></a></h2>
<h3 id="问题1-内容管理模块是怎么做的" tabindex="-1"><a class="header-anchor" href="#问题1-内容管理模块是怎么做的"><span>问题1：内容管理模块是怎么做的？</span></a></h3>
<p>内容管理模块是对课程及相关信息进行维护，培训机构登录机构端，编辑课程相关的信息，包括：课程基本信息、课程营销、课程计划、课程关联的师资信息等，全部信息编写完毕提交审核，运营人员审核通过后由机构人员进行发布，课程发布后用户可以在平台上进行在线学习。</p>
<p>因为课程的相关信息比较多，用户编辑课程信息分为多个步骤进行，我们设计了课程基本信息表、营销表、课程师资表、课程计划表去分别存储这些信息。</p>
<p>课程发布时我们将课程的相关信息聚合到一张课程发布表，这里我们还需要将课程信息同步到elasticsearch、redis还有分布式文件系统中，这里存在分布式事务，我们基于本地消息表和任务调度的方式去控制分布式事务控制，实现数据的最终一致性。</p>
<h3 id="问题2-课程审核的流程是什么" tabindex="-1"><a class="header-anchor" href="#问题2-课程审核的流程是什么"><span>问题2： 课程审核的流程是什么？</span></a></h3>
<p>机构用户编辑完课程信息后将课程提交给运营人员进行审核，课程审核包括程序自动审核和人工审核，程序会校验信息的完整性，调用鉴黄接口，人工审核是48小时内完成，审核的意见及审核结果会写入课程审核表，用户通过查询审核意见得到审核的结果。</p>
<h3 id="问题3-课程发布的流程是什么" tabindex="-1"><a class="header-anchor" href="#问题3-课程发布的流程是什么"><span>问题3：课程发布的流程是什么？</span></a></h3>
<p>课程审核通过后由机构端用户进行课程发布，设计了课程预览功能，通过课程预览能够快速知道课程的哪些信息不全。课程发布后课程相关信息写入课程发布表，课程发布的状态为已发布，还有课程下架功能，下架的课程用户无法搜索到无法选课学习，下架课程的发布状态为下架，课程下架后可以重新发布。</p>
<h3 id="问题4-图片鉴黄是怎么做的" tabindex="-1"><a class="header-anchor" href="#问题4-图片鉴黄是怎么做的"><span>问题4：图片鉴黄是怎么做的？</span></a></h3>
<p>很多的云平台都提供图片鉴黄的API，比如：阿里云、腾讯云等，提供图片的url调用API就可以了，我们项目组封装了一个sdk，调用接口得到返回值，包括：黄、不黄、人工审核。</p>
<h2 id="_2-2-使用本地消息表加任务调度完成分布式事务控制" tabindex="-1"><a class="header-anchor" href="#_2-2-使用本地消息表加任务调度完成分布式事务控制"><span>2.2 使用本地消息表加任务调度完成分布式事务控制</span></a></h2>
<h3 id="问题1-什么是分布式事务" tabindex="-1"><a class="header-anchor" href="#问题1-什么是分布式事务"><span>问题1：什么是分布式事务？</span></a></h3>
<p>由多个服务通过网络完成一个事务叫分布式事务。</p>
<p>比如：课程发布操作不仅要在本地数据库插入课程信息，而且还要请求索引服务将课程信息添加到索引库，还要请求MinIO将课程静态化并上传静态页面，这里就存在分布式事务。</p>
<h3 id="问题2-分布式事务控制的方案有哪些" tabindex="-1"><a class="header-anchor" href="#问题2-分布式事务控制的方案有哪些"><span>问题2：分布式事务控制的方案有哪些？</span></a></h3>
<p>首先根据CAP原理决定我们的需求，是要实现CP、还是要实现AP。</p>
<p>实现CP就是要实现强一致性，可以使用Seata框架基于XA、AT模式去实现。</p>
<p>实现AP强调可用性实现最终一致性，可以使用MQ、任务调度的方式、TCC方式去实现。</p>
<p>我们项目中大部分实现的是AP，使用本地消息表加任务调度完成分布式事务最终数据一致性。</p>
<h3 id="问题3-如何使用本地消息表加任务调度完成分布式事务控制" tabindex="-1"><a class="header-anchor" href="#问题3-如何使用本地消息表加任务调度完成分布式事务控制"><span>问题3：如何使用本地消息表加任务调度完成分布式事务控制？</span></a></h3>
<p>以发布课程为例进行说明，发布课程需要在内容管理数据库中写课程发布表记录，同时将课程信息同步到redis、ES、MinIO，这里存在分布式事务。</p>
<p>1）点击发布课程使用本地事务向发布表写一个课程信息，同时向消息表写一个消息记录（标记了发布了哪门课程）</p>
<p>2）xxl-job的调度中心使用分片广播模式向执行器下发任务，开始扫描消息表，查询到了待处理的消息。</p>
<p>3）根据消息的内容将课程信息同步到Redis、ES、MinIO</p>
<ol start="4">
<li>任务完成后删除消息表记录。整个分布式事务完成，最终保证了数据的一致性。</li>
</ol>
<h2 id="_2-3-基于xxl-job实现任务调度" tabindex="-1"><a class="header-anchor" href="#_2-3-基于xxl-job实现任务调度"><span>2.3 基于xxl-job实现任务调度</span></a></h2>
<h3 id="问题1-xxl-job的工作原理是什么-xxl-job是什么怎么工作" tabindex="-1"><a class="header-anchor" href="#问题1-xxl-job的工作原理是什么-xxl-job是什么怎么工作"><span>问题1：xxl-job的工作原理是什么？xxl-job是什么怎么工作？</span></a></h3>
<p>XXL-JOB分布式任务调度服务由调用中心和执行器组成，调用中心负责按任务调度策略向执行器下发任务，执行器负责接收任务执行任务。</p>
<p>1）首先部署并启动xxl-job调度中心。(一个java工程)</p>
<p>2）首先在微服务添加xxl-job依赖，在微服务中配置执行器</p>
<p>3）启动微服务，执行器向调度中心上报自己。</p>
<p>4）在微服务中写一个任务方法并用xxl-job的注解去标记执行任务的名称。</p>
<ol start="5">
<li>在调度中心添加一个任务并配置调度策略，调度策略就是每隔多长时间执行还是在每天或每月的固定时间去执行，比如每天0点执行，或每隔1小时执行一次等。</li>
</ol>
<p>6）在调度中心启动任务。</p>
<p>7）调度中心根据任务调度策略，到达时间就开始下发任务给执行器。</p>
<p>8）执行器收到任务就开始执行任务。</p>
<h3 id="问题2-如何保证任务不重复执行" tabindex="-1"><a class="header-anchor" href="#问题2-如何保证任务不重复执行"><span>问题2：如何保证任务不重复执行?</span></a></h3>
<ol>
<li>调度中心按分片广播的方式去下发任务。</li>
</ol>
<p>2）执行器收到作业分片广播的参数：分片总数和分片序号，计算 任务id 除以 执行器总数得到一个余数，如果余数等于执行器序号这时就去执行这个任务，这里保证了不同的执行器执行不同的任务。</p>
<p>3）配置调度过期策略为“忽略”，避免同一个执行器多次重复执行同一个任务</p>
<p>4）配置任务阻塞处理策略为“丢弃后续调度”，丢弃后在下一次调度还可以执行。</p>
<p>5）另外还要保证任务处理的幂等性，执行过的任务可以打一个状态标记已完成，下次再调度执行该任务判断该任务已完成就不再执行。</p>
<p>6）通过分布式锁彻底避免任务多次处理，我们项目使用数据库的乐观锁实现分布式锁，在执行任务前去更新任务的状态为执行中，谁更新成功谁去执行任务。</p>
<p>7）为了避免程序挂掉任务永远是执行器，这里使用任务补偿机制，启动一个定时任务检测在规定的时间内任务还没有完成将任务状态更新 为处理失败。</p>
<h3 id="问题3-任务幂等性如何保证" tabindex="-1"><a class="header-anchor" href="#问题3-任务幂等性如何保证"><span>问题3：任务幂等性如何保证？</span></a></h3>
<p>幂等性是为了解决重复提交问题，比如：恶意刷单，重复支付等。</p>
<p>解决幂等性常用的方案：</p>
<p>1）数据库约束，比如：唯一索引，主键。同一个主键不可能两次都插入成功。</p>
<p>2）乐观锁，常用于数据库，更新数据时根据乐观锁状态去更新。</p>
<p>3）唯一序列号，请求前生成唯一的序列号，携带序列号去请求，执行时在redis记录该序列号表示以该序列号的请求执行过了，如果相同的序列号再次来执行说明是重复执行。</p>
<p>我们项目中在处理任务时为了避免任务重复处理通过任务状态以及数据库乐观锁去保证任务幂等性。</p>
<p>执行过的任务可以打一个状态标记已完成，下次再调度执行该任务判断该任务已完成就不再执行。</p>
<p>在执行任务前使用数据库的乐观锁去更新任务的状态为执行中，谁更新成功谁去执行任务。</p>
<h3 id="问题4-你们项目如何使用xxl-job进行任务调度" tabindex="-1"><a class="header-anchor" href="#问题4-你们项目如何使用xxl-job进行任务调度"><span>问题4：你们项目如何使用xxl-job进行任务调度?</span></a></h3>
<p>我们项目中在控制分布式事务时要保证最终数据一致性，是基于消息表的机制进行控制，这时就使用xxl-job去扫描消息表的记录，根据消息表内容去执行任务，最终保证了数据一致性。</p>
<p>具体xxl-job的使用方法参考上边问题1。</p>
<h3 id="问题5-任务处理达到最大失败次数怎么办" tabindex="-1"><a class="header-anchor" href="#问题5-任务处理达到最大失败次数怎么办"><span>问题5: 任务处理达到最大失败次数怎么办？</span></a></h3>
<p>当任务达到最大失败次数时一般就说明程序处理此视频存在问题，这种情况就需要人工处理，在页面上会提示失败的信息，人工可手动执行该视频进行处理，或通过其它转码工具进行视频转码，转码后直接上传mp4视频。</p>
<h3 id="问题6-如果任务一直没有完成怎么办" tabindex="-1"><a class="header-anchor" href="#问题6-如果任务一直没有完成怎么办"><span>问题6: 如果任务一直没有完成怎么办？</span></a></h3>
<p>如果有线程抢占了某个视频的处理任务，如果线程处理过程中挂掉了，该任务的状态将会一直是处理中，其它线程将无法处理，这个问题需要用补偿机制。</p>
<p>单独启动一个任务找到待处理任务表中超过执行期限但仍在处理中的任务，将任务的状态改为执行失败。</p>
<p>任务执行期限是处理一个处理的最大时长，比如视频处理任务的最大时长是30分钟，此时就查询大于30分钟还没有完成的任务，将任务状态改为执行失败。</p>
<h2 id="_2-4-基于freemarker实现页面静态" tabindex="-1"><a class="header-anchor" href="#_2-4-基于freemarker实现页面静态"><span>2.4 基于Freemarker实现页面静态</span></a></h2>
<h3 id="问题1-为什么要用freemarker静态化-如何做的" tabindex="-1"><a class="header-anchor" href="#问题1-为什么要用freemarker静态化-如何做的"><span>问题1: 为什么要用Freemarker静态化?如何做的？</span></a></h3>
<p>传统的方式是用户请求到Tomcat服务器通过服务端渲染生成页面返回给浏览器，这种方式不适合高并发访问的场景。</p>
<p>静态化是通过模板引擎技术将一个动态网页提前生成html页面，将html网页放在nginx、apache等高性能服务器中，适合高并发的场景。</p>
<p>使用静态化除了满足高并发的需求外还需要注意的是当页面变化频率非常高的时候不适合静态化，因为页面变化频率高静态化就频繁，这样就会生成很多的静态页面，太多的静态页面是不方便去管理的。</p>
<p>我们项目使用Freemarker实现课程详情页面的静态化，Freemarker是一个成熟的开源的模板引擎，简单易用，功能强大。</p>
<p>使用流程：</p>
<p>1）使用Freemarker的标签编写课程详情页面的模板</p>
<p>2）调用接口获取模板上需要的模型数据</p>
<p>3）调用Freemarker的API生成静态页面。</p>
<p>4）生成的静态页面最终会上传到文件系统方便访问。</p>
<h1 id="_3-媒资管理模块" tabindex="-1"><a class="header-anchor" href="#_3-媒资管理模块"><span>3 媒资管理模块</span></a></h1>
<h2 id="_3-1-媒资管理模块的开发。" tabindex="-1"><a class="header-anchor" href="#_3-1-媒资管理模块的开发。"><span>3.1 媒资管理模块的开发。</span></a></h2>
<h3 id="问题1-媒资管理包括哪些功能" tabindex="-1"><a class="header-anchor" href="#问题1-媒资管理包括哪些功能"><span>问题1：媒资管理包括哪些功能？</span></a></h3>
<p>媒资管理是对文档、视频等文件进行统一管理，包括：文件管理、视频上传、视频处理、文件审核、文件预览、文件分享、提供外部接口实现我的文件库功能。</p>
<p>对文件的管理我们是这么做的：</p>
<p>在数据库有一张文件表记录文件的信息，文件会存储到分布式文件系统MinIO中，提供普通文件上传和大文件上传的接口，普通文件上传接口主要是上传图片、pdf文件等文件，大文件上传接口主要是上传视频，上传视频我们使用断点续传的方式实现。</p>
<p>对视频进行转码处理，基于多线程加分布式任务调度的机制进行任务处理。</p>
<p>另外考虑媒资管理服务的通用性，提供统一的接口查询文件列表，实现了我的文件库功能，用户可以查询自己上传的文件的哪些，点击某个文件时请求分布式文件系统打开文件或下载文件。</p>
<h2 id="_2-4-基于minio分布式文件系统实现文件服务" tabindex="-1"><a class="header-anchor" href="#_2-4-基于minio分布式文件系统实现文件服务"><span>2.4 基于MinIO分布式文件系统实现文件服务</span></a></h2>
<h3 id="问题1-minio是什么-为什么用minio" tabindex="-1"><a class="header-anchor" href="#问题1-minio是什么-为什么用minio"><span>问题1：MinIO是什么？为什么用MinIO?</span></a></h3>
<p>MinIO一个轻量级的分布式文件系统</p>
<p>MinIO有什么优势？</p>
<ol>
<li>MinIO开源，使用简单，功能强大。</li>
</ol>
<p>2）MinIO使用纠删码算法，只要不超过一半的节点坏掉整个文件系统就可以使用。</p>
<p>3）如果将坏的节点重新启动，自动恢复没有上传成功的文件。</p>
<p>我们在生产环境使用的时候会部署多个MinIO节点，具体有运维人员负责。</p>
<h3 id="问题2-怎么样使用minio存储图片" tabindex="-1"><a class="header-anchor" href="#问题2-怎么样使用minio存储图片"><span>问题2：怎么样使用MinIO存储图片？</span></a></h3>
<p>1） app调用服务端接口上传图片，除了保存原图还自动生成缩略图（大、中、小）。</p>
<p>2）调用MinIO的接口将图片上传到MinIO。</p>
<p>3）如果要浏览图片会先请求到nginx，由nginx代理将请求转发到MinIO。</p>
<h3 id="问题3-怎么样构建这个独立的文件服务" tabindex="-1"><a class="header-anchor" href="#问题3-怎么样构建这个独立的文件服务"><span>问题3：怎么样构建这个独立的文件服务？</span></a></h3>
<p>1）我们项目中有很多要上传文件的地方，比如上传图片、上传文档、上传视频等，所以我们要构建一个独立的文件服务负责上传、下载等功能，负责对文件进行统一管理。</p>
<p>2）创建单独的文件服务，提供以下接口：</p>
<p>上传接口</p>
<p>下载接口</p>
<p>我的文件库接口</p>
<p>删除文件接口</p>
<p>3）文件的存储和下载使用MinIO实现。</p>
<p>MinIO是一个分布式的文件系统，性能高，扩展强。</p>
<p>4）使用Nginx+MinIO组成一个文件服务器</p>
<p>通过访问Nginx，由nginx代理将请求转发到MinIO去浏览、下载文件。</p>
<h2 id="_2-5-断点续传功能的开发" tabindex="-1"><a class="header-anchor" href="#_2-5-断点续传功能的开发"><span>2.5 断点续传功能的开发</span></a></h2>
<h3 id="问题1-这个断点续传是怎么做的" tabindex="-1"><a class="header-anchor" href="#问题1-这个断点续传是怎么做的"><span>问题1：这个断点续传是怎么做的？</span></a></h3>
<p>我们是基于分块上传的模式实现断点续传的需求，当文件上传一部分断网后前边已经上传过的不再上传。</p>
<p>1）前端对文件分块。</p>
<p>2）前端使用多线程一块一块上传，上传前给服务端发一个消息校验该分块是否上传，如果已上传则不再上传。</p>
<p>3）等所有分块上传完毕，服务端合并所有分块，校验文件的完整性。</p>
<p>因为分块全部上传到了服务器，服务器将所有分块按顺序进行合并，就是写每个分块文件内容按顺序依次写入一个文件中。使用字节流去读写文件。</p>
<p>4）前端给服务传了一个md5值，服务端合并文件后计算合并后文件的md5是否和前端传的一样，如果一样则说文件完整，如果不一样说明可能由于网络丢包导致文件不完整，这时上传失败需要重新上传。</p>
<h3 id="问题2-一个文件上传一半不传了怎么办" tabindex="-1"><a class="header-anchor" href="#问题2-一个文件上传一半不传了怎么办"><span>问题2：一个文件上传一半不传了怎么办？</span></a></h3>
<p>上传一个文件进行分块上传，上传一半不传了，之前上传到minio的分块要进行清理。</p>
<p>1、在数据库中有一张文件表记录minio中存储的文件信息。</p>
<p>2、文件开始上传时会写入文件表，状态为上传中，上传完成会更新状态为上传完成。</p>
<p>3、当一个文件传了一半不再上传了说明该文件没有上传完成，会有定时任务去查询文件表中的记录，如果文件未上传完成则删除minio中没有上传成功的文件目录。</p>
<h2 id="_2-6-使用任务调度加多线程处理视频" tabindex="-1"><a class="header-anchor" href="#_2-6-使用任务调度加多线程处理视频"><span>2.6 使用任务调度加多线程处理视频</span></a></h2>
<h3 id="问题1-具体是怎么做的" tabindex="-1"><a class="header-anchor" href="#问题1-具体是怎么做的"><span>问题1：具体是怎么做的？</span></a></h3>
<p>1、上传视频成功后在数据库表写一条视频处理任务。</p>
<p>2、使用 xxl-job任务调度每隔5分钟去扫描任务表中的任务</p>
<p>3、拿到了视频处理任务，这时根据CPU的核数去启动多线程开始处理视频。</p>
<p>比如：CPU是8核心就启动8个线程去同时处理，因为视频处理非常耗费CPU，启动的线程多也没有用。</p>
<p>4、处理视频是通过Java程序调用ffmpeg工具进行处理，具体是通过ProcessBuilder类去调用ffmpeg工具.</p>
<p>ffmpeg工具有很多参数这是由流媒体程序员给我们，我们直接写到程序员去调用。</p>
<p>5、任务处理完成后删除任务中的任务，将任务写到历史表进行备案。</p>
<p>6、我们在处理视频的过程中保证了任务不重复执行，实现了任务幂等性处理。</p>
<h1 id="_4-认证授权" tabindex="-1"><a class="header-anchor" href="#_4-认证授权"><span>4 认证授权</span></a></h1>
<h2 id="_4-1-使用oauth2-jwt实现单点登录。" tabindex="-1"><a class="header-anchor" href="#_4-1-使用oauth2-jwt实现单点登录。"><span>4.1 使用Oauth2+JWT实现单点登录。</span></a></h2>
<h3 id="问题1-如何使用oauth2-jwt实现单点登录" tabindex="-1"><a class="header-anchor" href="#问题1-如何使用oauth2-jwt实现单点登录"><span>问题1：如何使用Oauth2+JWT实现单点登录？</span></a></h3>
<p>1）系统是整合了Spring Security框架，同时整合了OAuth2协议以及JWT令牌。</p>
<p>2）所有用户从统一登录入口进行认证，使用的是OAuth2的密码模式进行认证，请求账号和密码到认证服务。</p>
<p>3）认证服务对账号和密码进行校验，校验成功颁发JWT令牌，响应给客户端。</p>
<p>4）客户端将JWT令牌存到客户端cookie.</p>
<p>5）客户端携带JWT令牌通过网关去访问各各微服务。</p>
<p>6）网关对JWT令牌的合法性进行校验，校验成功继续访问，否则拒绝。</p>
<p>7）请求到达了微服务，微服务根据jwt中的权限信息校验用户是否拥有某个接口的权限，如果有则继续访问，没有则拒绝。</p>
<h3 id="问题2-说说oauth2协议-oauth2协议是什么" tabindex="-1"><a class="header-anchor" href="#问题2-说说oauth2协议-oauth2协议是什么"><span>问题2：说说OAuth2协议？OAuth2协议是什么？</span></a></h3>
<p>OAuth2是一个开放的认证协议</p>
<p>OAuth2包括授权码模式、密码模式、简单模式、客户端模式。</p>
<p>以授权码模式为例说明：</p>
<p>1）首先由用户授权同意客户端访问资源服务。</p>
<p>2）认证服务向客户端下发授权码。</p>
<p>3）客户端携带授权码访问认证服务申请令牌。</p>
<p>4）认证服务下发令牌。</p>
<p>5）客户端携带令牌访问资源服务中的资源。</p>
<h3 id="问题3-jwt令牌是安全的吗" tabindex="-1"><a class="header-anchor" href="#问题3-jwt令牌是安全的吗"><span>问题3：JWT令牌是安全的吗？</span></a></h3>
<p>JWT令牌是安全的，它由三部分组成，第三部分对前两部分进行签名加密，如果别人修改了前两部分，再对前两部分进行加密得到的结果与原来第三部分的加密内容不一致从而判断出JWT被篡改。</p>
<p>JWT可以采用对称加密和非对称加密，对称加密是认证服务和资源服务使用相同的密钥，对称加密效率高，如果一旦密钥泄露可以伪造jwt令牌。</p>
<p>非对称加密是认证服务自己保留私钥，将公钥下发给受信任的客户端、资源服务，公钥和私钥是配对的，成对的公钥和私钥才可以正常加密和解密，非对称加密效率低但相比对称加密非对称加密更安全一些。</p>
<h3 id="问题4-jwt在客户端存储多长时间" tabindex="-1"><a class="header-anchor" href="#问题4-jwt在客户端存储多长时间"><span>问题4：jwt在客户端存储多长时间？</span></a></h3>
<p>根据用户选择，可以存储30天，也可以关闭浏览立即删除。</p>
<h3 id="问题5-jwt令牌过期了怎么办" tabindex="-1"><a class="header-anchor" href="#问题5-jwt令牌过期了怎么办"><span>问题5：jwt令牌过期了怎么办？</span></a></h3>
<p>两种方法：</p>
<p>第1：过期了肯定需要用户重新登录。</p>
<p>第2：如果要把用户体验作的更好那就需要对即将过期的令牌进行续期，续期的办法是：使用刷新令牌（下发jwt的同时也将刷新令牌下发了）请求认证服务重新生成一个新jwt令牌。</p>
<h3 id="问题6-如何集成微信扫码" tabindex="-1"><a class="header-anchor" href="#问题6-如何集成微信扫码"><span>问题6：如何集成微信扫码？</span></a></h3>
<p>1）我们的系统先在微信开放平台注册账号，添加应用，微信审核后发一个应用 id和应用密钥。</p>
<p>2）在前端页面调用微信js，传入应用 id和应用密钥等参数，生成了登录二维码。</p>
<p>3）用户扫码授权同意我们的系统请求微信查询当前用户自己的信息。</p>
<p>4）微信通过重定向将授权码返回给我们的系统。</p>
<p>5）我们的系统携带授权码申请令牌。</p>
<p>6）微信下发令牌。</p>
<p>7）我们的系统携带令牌请求微信获取用户信息。</p>
<p>8）拿到用户的信息存储到我们系统的数据库。</p>
<p>9）此时用户在我们的系统就存在了，调用我们系统的认证接口颁发jwt令牌，最后认证成功。</p>
<h3 id="问题7-如何集成springsecurity框架到你的系统" tabindex="-1"><a class="header-anchor" href="#问题7-如何集成springsecurity框架到你的系统"><span>问题7: 如何集成SpringSecurity框架到你的系统？</span></a></h3>
<p>1、创建独立的认证服务。</p>
<p>添加了两个依赖Spring Securityr和Oauth2</p>
<p>支持OAuth2协议认证，支持颁发JWT令牌。</p>
<p>2、重写了两个类</p>
<p>UserDetailsService、DaoAuthenticationProvider。</p>
<p>UserDetailsService：查询用户信息</p>
<p>DaoAuthenticationProvider： 判断用户是否存在，判断密码是否正确，</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=OTAyOTI2ODU0ZDg1NTk4NTc3MDA2NGI0NDc0ZjgzMzlfV3AyZE56M0x1UDczOThhNEhJT0RJcUlTWFVrN2dYWndfVG9rZW46SzVnZmJWckJFb3h4a3h4aHBBQmNIRTJQblVjXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>重写方法:</p>
<p>DaoAuthenticationProvider:  重写它的一个校验密码的方法，去掉的原因是因为项目的认证方式不仅有账号密码认证还有微信扫码认证、手机验证码认证，有些认证不需要校验密码，我们在统一的认证类中去写认证校验的逻辑。</p>
<p>UserDetailsService：自定义loadUserByUsername方法，在这个方法里边接收认证请求的参数（认证类型、账号、密码、验证码等信息）进行统一认证，认证异常就抛出异常，认证通过就生成用户的身份信息。</p>
<p>最后根据用户的身份信息生成jwt令牌，响应给客户端，客户端保存jwt令牌。</p>
<h3 id="问题8-如何实现同一个用户只能在一个客户端登录" tabindex="-1"><a class="header-anchor" href="#问题8-如何实现同一个用户只能在一个客户端登录"><span>问题8: 如何实现同一个用户只能在一个客户端登录?</span></a></h3>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=ZGJmMGEzZWQwZTA2ODRjNWJlNWU5ZGUwY2E2YzUzNDlfbVZjRHhYS0xrSkxEcUZ3OEhYQVhRWFNrU1JZd1YyS2xfVG9rZW46RFdudmJtMzM5b1Z3TFR4c0FTbGN1YTFibml6XzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>1、u001用户在pc登录成功，将u001和jwt令牌的唯一标识记录到redis，jwt令牌的唯一标识是用md5对jwt令牌计算出一个摘要字符串。</p>
<p>2、u001用户携带jwt令牌访问微服务，在网关处判断jwt的合法性，如果合法继续从redis查询该u001及u001对应的令牌唯一标识，如果存在且令牌和redis中的一样则继续访问。</p>
<p>3、u001用户在app登录，生成新的令牌，同第一步，将令牌标识记录到redis，<strong>注意</strong>此时在app登录的u001挤掉了在pc上登录的u001。</p>
<p>4、此时如果u001用户再使用原来的jwt令牌来访问网关发现u001对应的令牌和它的不一样，提示该账号在其它地方登录，是否重新登录。</p>
<h3 id="问题9-如何扩展springsecurity的用户身份信息" tabindex="-1"><a class="header-anchor" href="#问题9-如何扩展springsecurity的用户身份信息"><span>问题9: 如何扩展springSecurity的用户身份信息？</span></a></h3>
<p>SpringSecurity默认的用户身份信息实现了UserDetails接口，信息有限，我们项目中对存储在jwt令牌跌中的用户身份信息进行扩展，我们将用户的信息转成json格式存储在jwt中，比如有用户的昵称，头像等信息。</p>
<h1 id="_5-支付" tabindex="-1"><a class="header-anchor" href="#_5-支付"><span>5 支付</span></a></h1>
<h2 id="_5-1-对接微信和支付宝接口实现支付功能。" tabindex="-1"><a class="header-anchor" href="#_5-1-对接微信和支付宝接口实现支付功能。"><span>5.1 对接微信和支付宝接口实现支付功能。</span></a></h2>
<h3 id="问题1-如何对接微信和支付宝实现支付功能" tabindex="-1"><a class="header-anchor" href="#问题1-如何对接微信和支付宝实现支付功能"><span>问题1：如何对接微信和支付宝实现支付功能?</span></a></h3>
<p>1）生成支付二维码。同时在数据库插入一条支付记录。</p>
<p>2）用户扫码调用微信、支付宝的下单接口，同时传给支付宝或微信支付记录号。</p>
<p>3）支付完成，支付宝或微信将支付结果通知给我们的其它的系统。同时我们还会主动去查询支付结果。</p>
<h3 id="问题2-如何避免重复支付" tabindex="-1"><a class="header-anchor" href="#问题2-如何避免重复支付"><span>问题2：如何避免重复支付？</span></a></h3>
<p>我们在生成支付二维码时判断订单如果已支付将不再生成二维码。</p>
<p>用户在扫码支付时也会判断是否已支付，已支付将不再继续。</p>
<p>因为我们每次支付生成了一个支付记录号，将支付记录号传给第三方支付平台，为的是防止第三方支付平台的问题导致我们的订单无法支付，这样的话在技术上无法彻底避免重复支付。</p>
<p>除了上边的避免重复支付的方法外我们还有一个定时任务每天0点去查询上一天的支付记录，如果有重复的进行退款。</p>
<p>另外用户在生成二维码后提示用户不要重复支付。</p>
<h3 id="问题3-用户退款了怎么办" tabindex="-1"><a class="header-anchor" href="#问题3-用户退款了怎么办"><span>问题3：用户退款了怎么办？</span></a></h3>
<p>调用退款接口。</p>
<h2 id="_5-2-基于rabbitmq延迟队列处理未支付订单。" tabindex="-1"><a class="header-anchor" href="#_5-2-基于rabbitmq延迟队列处理未支付订单。"><span>5.2 基于RabbitMQ延迟队列处理未支付订单。</span></a></h2>
<p>订单创建成功如果订单未支付我们会在30分钟后进行删除。这里采用RabbitMQ延迟队列去处理。</p>
<h3 id="问题1-具体怎么做的" tabindex="-1"><a class="header-anchor" href="#问题1-具体怎么做的"><span>问题1：具体怎么做的？</span></a></h3>
<p>1）创建订单的同时向MQ发送一条消息给一个队列并设置消息的TTL（过期时间），比如：设置30分钟，由于该队列设置了死信交换机，30分钟后消息将投递到死信交换机。</p>
<p>2）当消息过期，消息发到了死信交换机，同时发给了死信队列（死信队列绑定了死信交换机）</p>
<p>3）程序监听了死信队列，收到了过期的订单。</p>
<p>4）程序收到消息判断如果订单未支付则取消订单。如果说已支付不用处理。</p>
<h3 id="问题3-如何保证rabbitmq的消息可靠性" tabindex="-1"><a class="header-anchor" href="#问题3-如何保证rabbitmq的消息可靠性"><span>问题3：如何保证RabbitMQ的消息可靠性?</span></a></h3>
<p>1、设置消息持久化</p>
<p>首先设置交换机支持持久化（定义交换机时设置持久化为true）</p>
<p>其次设置队列支持持久化（定义队列时设置持久化为true）</p>
<p>发送消息时设置消息要持久化</p>
<p>2、消费者收到消息处理完成要确认</p>
<p>设置 消费者确认模式为自动确认 acknowledge-mode=auto ，当程序处理正常没有异常会发送ack，抛出异常则发送nack</p>
<p>也可以设置为手动确认，在程序处理完成的代码处手动发送ack。</p>
<p>3、消费失败重试</p>
<p>消费失败后在消费者本地进行重试，达到最大重试次数会将失败消息投递到指定交换机，交换机绑定一个异常消息队列，程序监听这个队列收到异常消息后放在数据库中单独处理，或由人工处理。</p>
<h3 id="问题4-如何避免消息重复投递或重复消费" tabindex="-1"><a class="header-anchor" href="#问题4-如何避免消息重复投递或重复消费"><span>问题4：如何避免消息重复投递或重复消费？</span></a></h3>
<p>重复投递的原因：等待超时后，需要重试。</p>
<p>避免重复投递：消息生产时，生产者发送的消息携带一个<code v-pre>Message ID</code>（全局唯一ID），</p>
<p>作为去重和幂等的依据，避免重复的消息进入队列</p>
<p>重复消费的原因：消费者接收消息后，作好消息幂等性处理，根据消息的ID记录消息的处理状态，如果已处理则不再处理。</p>
<h2 id="_2-9-通过redis技术进行数据的缓存-提高访问速度" tabindex="-1"><a class="header-anchor" href="#_2-9-通过redis技术进行数据的缓存-提高访问速度"><span>2.9 通过Redis技术进行数据的缓存,提高访问速度</span></a></h2>
<h3 id="问题1-项目使用redis缓存了哪些数据" tabindex="-1"><a class="header-anchor" href="#问题1-项目使用redis缓存了哪些数据"><span>问题1：项目使用redis缓存了哪些数据?</span></a></h3>
<p>redis缓存的是白名单接口（无需认证即可访问）所需要的数据，缓存了普通用户所要查询的数据（我的订单、我的选课），缓存热点数据（最新发布的课程信息、推荐课程信息等）。</p>
<p>每类信息有不同的缓存过期时间，为了避免缓存雪崩缓存时间加了随机数。</p>
<p>验证码</p>
<p>30秒    字符串</p>
<p>课程发布信息</p>
<p>7天   hash</p>
<p>课程视频信息</p>
<p>7天   hash</p>
<p>我的课程</p>
<p>3分钟   hash</p>
<p>我的订单</p>
<p>3分钟   hash</p>
<h3 id="问题2-如何保证redis缓存一致性" tabindex="-1"><a class="header-anchor" href="#问题2-如何保证redis缓存一致性"><span>问题2：如何保证Redis缓存一致性？</span></a></h3>
<p>缓存一致性是数据库和缓存保持一致，当修改了数据库的信息也要同时更新缓存的数据和数据库保持一致。</p>
<p>去查询数据时先查询缓存，如果缓存有就返回，如果没有就查询数据库，如果查不到则缓存一个null字符串（过期时间设置的小一些），如果查询到了，缓存到redis具体的信息。</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=ODM3Y2JkZmFmZGFhOTRiZWYzNTRiOGM0ZjA4ZWFhYjZfTjZ6UVJBMmJtWkM3QWp1V1g4VW56cXpZczJ1NGd3Y0dfVG9rZW46RmNGYmJGWjFXb1FReFN4RTZ1R2NRRmVkbkVjXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>当修改数据时常用的方案是延迟双删除：</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=NWEzZmVmYWU5MmYwMjM2Y2FkNDY0OGI5NGQ0Y2Q2MGNfTXNvc0Z4dWRLOWs4ZmpjcFFRTWlRUG44S2U0MlU4VUNfVG9rZW46UDdWdGI3TmVib3JpU1d4TFdoVWM1WDczbnlnXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>1、先更新数据库，再删除缓存。</p>
<p>如果更新了数据库，删除缓存的操作失败了，此时查询数据的请求查到的数据仍然是旧数据。</p>
<p>2、先删除缓存，再更新数据库</p>
<p>如果删除了缓存更新在更新数据库的操作之前可能被其它线程写入旧数据，此时缓存中的数据仍然是旧数据。</p>
<p>3、延迟双删，先删除缓存、再更新数据库，再延迟一定的时间去删除缓存。</p>
<p>为什么要两次删除缓存，因为有可能第一次删除缓存后其它查询请求将旧数据存储到了缓存。</p>
<p>为什么要延迟一定的时间去删除缓存，为了给mysql主从同步的时间，如果立即删除缓存很可能其它请求读到的数据还是旧数据。</p>
<p>延迟的时间不好确定，延迟双删仍然可能导致脏数据。</p>
<p>结论：以上方案当存在高并发时都无法解决数据库和缓存强一致性的问题。</p>
<p><strong>如何做缓存一致性？</strong></p>
<p><strong>需要根据需求来定：</strong></p>
<p><strong>1、实现强一致性 需要使用分布式锁控制，修改数据和向缓存存储数据使用同一个分布式锁。</strong></p>
<p><strong>2、实现最终一致性，缓存数据要加过期时间，即使出现数据不致性当过期时间一到缓存失效又会从数据库查询最新的数据存入缓存。</strong></p>
<p><strong>3、对于实时性要求强的，要实现数据强一致性要尽量避免使用缓存，可以直接操作数据库。</strong></p>
<p><strong>使用工具对数据进行同步方案如下：</strong></p>
<p><strong>1、使用任务表加任务调度的方案进行同步。</strong></p>
<p><strong>2、使用Canal基于MySQL的binlog进行同步。</strong></p>
<h3 id="问题3-针对高并发是如何对缓存进行处理的" tabindex="-1"><a class="header-anchor" href="#问题3-针对高并发是如何对缓存进行处理的"><span>问题3：针对高并发是如何对缓存进行处理的？</span></a></h3>
<p>高并发可能导致缓存击穿，使用分布式锁进行控制避免缓存击穿，通过分布式锁控制只有一个线程去查询数据库，查完数据库后存入缓存。</p>
<p>我们项目使用redisson实现分布锁。</p>
<p>redisson实现Lock接口，基于此接口使用，具体方法是获取锁调用lock()方法，用完释放锁调用unlock()。</p>
<p>当线程还没有执行完时会有看门狗对锁进行续期，保证线程在执行过程中不会让锁过期。</p>
<p>针对高并发的还可以通过限流技术去避免高并发对系统造成压力。</p>
<h3 id="问题4-什么是缓存穿透、缓存雪崩、缓存击穿-怎么解决" tabindex="-1"><a class="header-anchor" href="#问题4-什么是缓存穿透、缓存雪崩、缓存击穿-怎么解决"><span>问题4：什么是缓存穿透、缓存雪崩、缓存击穿？怎么解决？</span></a></h3>
<p>1）缓存穿透：</p>
<p>去访问一个数据库不存在的数据无法将数据进行缓存，导致查询数据库，当并发较大就会对数据库造成压力。缓存穿透可以造成数据库瞬间压力过大，连接数等资源用完，最终数据库拒绝连接不可用。</p>
<p>解决的方法：</p>
<p>缓存一个null值。</p>
<p>使用布隆过滤器。</p>
<p>2）缓存雪崩：</p>
<p>缓存中大量key失效后当高并发到来时导致大量请求到数据库，瞬间耗尽数据库资源，导致数据库无法使用。</p>
<p>造成缓存雪崩问题的原因是是大量key拥有了相同的过期时间。</p>
<p>解决办法：</p>
<p>使用同步锁控制</p>
<p>对同一类型信息的key设置不同的过期时间，比如：使用固定数+随机数作为过期时间。</p>
<p>3）缓存击穿</p>
<p>大量并发访问同一个热点数据，当热点数据失效后同时去请求数据库，瞬间耗尽数据库资源，导致数据库无法使用。</p>
<p>解决办法：</p>
<p>使用同步锁控制</p>
<p>设置key永不过期</p>
<h1 id="_6-搜索" tabindex="-1"><a class="header-anchor" href="#_6-搜索"><span>6 搜索</span></a></h1>
<h2 id="_6-1-使用elasticsearch实现课程搜索功能。" tabindex="-1"><a class="header-anchor" href="#_6-1-使用elasticsearch实现课程搜索功能。"><span>6.1 使用Elasticsearch实现课程搜索功能。</span></a></h2>
<h3 id="问题1-你们数据量很大吗-为啥使用elasticsearch" tabindex="-1"><a class="header-anchor" href="#问题1-你们数据量很大吗-为啥使用elasticsearch"><span>问题1：你们数据量很大吗？为啥使用Elasticsearch？</span></a></h3>
<p>主要是考虑我们要实现全文检索的效果所以使用Elasticsearch，全文检索的方式去搜索数据性能很高，它基于倒排索引表。正排索引是从文章中找词，倒排索引是根据词找文章，性能高。词是在索引库存储的。输入一个关键字从索引库中找词，找到词之后就找到了文章，整体性能高。</p>
<p>我们网站的数据量不大，项目架构时架构师决定使用Elasticsearch。</p>
<h3 id="问题2-怎么使用elasticsearch开发搜索模块" tabindex="-1"><a class="header-anchor" href="#问题2-怎么使用elasticsearch开发搜索模块"><span>问题2：怎么使用Elasticsearch开发搜索模块？</span></a></h3>
<p>1）首先创建索引（相当于mysql的表），将课程信息添加到索引库，对课程信息进行分词，存储到索引库。</p>
<p>2）开发一个搜索服务，编写一个搜索接口，调用Elasticsearch的api根据关键字搜索。</p>
<h3 id="问题3-如何保证索引同步" tabindex="-1"><a class="header-anchor" href="#问题3-如何保证索引同步"><span>问题3：如何保证索引同步？</span></a></h3>
<p>我们项目是使用本地任务表加xxl-job任务调度进行索引同步，具体的作法如下：</p>
<p>1）添加或修改或删除课程的同时向任务表插入一条记录，这条记录就记录了是添加还是修改还是删除了哪个课程。</p>
<p>2）任务调度定时扫描任务表，根据任务表的内容对课程信息进行同步，如果添加了课程将课程添加到索引库，如果修改了课程就修改索引库的课程，如果是删除了课程将课程信息从索引库删除。</p>
<p>如果对于实时要求很高的场景可以使用Canal将MySQL的数据同步到索引 。</p>
<p>实时不高可以使用任务调度、Logstash、消息队列的方式。</p>
<p>详细如下：</p>
<p>MQ：向mysql写数据的时候向mq写入消息，搜索服务监听MQ，收到消息后写入索引。使用MQ的优势是代码解耦，但是需要处理消息可靠性的问题有一定的技术成本，做到消息可靠性需要做到生产者投递成功、消息持久化以及消费者消费成功三个方面，另外还要做好消息幂等性问题。</p>
<p>Logstash： 开源实时日志分析平台 ELK包括Elasticsearch、Kibana、Logstash，Logstash负责收集、解析和转换日志信息，可以实现MySQL与Elasticsearch之间的数据同步。也可以实现解耦合并且是官方推荐，但需要增加学习与维护成本。</p>
<p>任务调度：向mysql写数据的时候记录修改记录，开启一个定时任务根据修改记录将数据同步到Elasticsearch。</p>
<h1 id="_7-电商" tabindex="-1"><a class="header-anchor" href="#_7-电商"><span>7 电商</span></a></h1>
<h2 id="_2-1-商品管理" tabindex="-1"><a class="header-anchor" href="#_2-1-商品管理"><span>2.1 商品管理</span></a></h2>
<h3 id="问题1-spu与sku是什么" tabindex="-1"><a class="header-anchor" href="#问题1-spu与sku是什么"><span>问题1: <strong>SPU与SKU</strong>是什么</span></a></h3>
<p><strong>SPU = Standard Product Unit  （标准产品单位）</strong></p>
<ul>
<li>概念 : SPU 是商品信息聚合的最小单位，是一组可复用、易检索的标准化信息的集合，该集合描述了一个产品的特性。</li>
<li>通俗点讲，属性值、特性相同的货品就可以称为一个 SPU</li>
<li>例如：<strong>华为P30 就是一个 SPU</strong></li>
</ul>
<p><strong>SKU=stock keeping unit( 库存量单位)</strong></p>
<ul>
<li>SKU 即库存进出计量的单位， 可以是以件、盒、托盘等为单位。</li>
<li>SKU 是物理上不可分割的最小存货单元。在使用时要根据不同业态，不同管理模式来处理。</li>
<li>在服装、鞋类商品中使用最多最普遍。</li>
<li>例如：<strong>华为P30 红色 64G 就是一个 SKU</strong></li>
</ul>
<h3 id="问题2-最基础的表有哪些" tabindex="-1"><a class="header-anchor" href="#问题2-最基础的表有哪些"><span>问题2: 最基础的表有哪些</span></a></h3>
<p>tb_spu  表 （SPU表）</p>
<p>字段名称字段含义字段类型字段长度备注id主键VARCHARsn货号VARCHARnameSPU名VARCHARcaption副标题VARCHARbrand_id品牌IDINTcategory1_id一级分类INTcategory2_id二级分类INTcategory3_id三级分类INTtemplate_id模板IDINTfreight_id运费模板idINTimage图片VARCHARimages图片列表VARCHARsale_service售后服务VARCHARintroduction介绍TEXTspec_items规格列表VARCHARpara_items参数列表VARCHARsale_num销量INTcomment_num评论数INTis_marketable是否上架CHARis_enable_spec是否启用规格CHARis_delete是否删除CHARstatus审核状态CHAR</p>
<p>tb_sku  表（SKU商品表）</p>
<p>字段名称字段含义字段类型字段长度备注id商品idVARCHARsn商品条码VARCHARnameSKU名称VARCHARprice价格（分）INTnum库存数量INTalert_num库存预警数量INTimage商品图片VARCHARimages商品图片列表VARCHARweight重量（克）INTcreate_time创建时间DATETIMEupdate_time更新时间DATETIMEspu_idSPUIDBIGINTcategory_id类目IDINTcategory_name类目名称VARCHARbrand_name品牌名称VARCHARspec规格VARCHARsale_num销量INTcomment_num评论数INTstatus商品状态 1-正常，2-下架，3-删除CHAR</p>
<h2 id="_2-2-购物车" tabindex="-1"><a class="header-anchor" href="#_2-2-购物车"><span>2.2 购物车</span></a></h2>
<h3 id="问题1-购物车流程是什么" tabindex="-1"><a class="header-anchor" href="#问题1-购物车流程是什么"><span>问题1:购物车流程是什么?</span></a></h3>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=NTQ3NWJjZmZjOTc0YWUzZjBjMjM5NTZhYWU1NjAwMDRfOHBnVmk0QlRmWWhKVHphUXdDTjMwSjJiZHg2ekVqWERfVG9rZW46RWg1MWJtTWNKbzZWT0Z4SGZseGMyUnlnbmxkXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<h2 id="_2-3-订单" tabindex="-1"><a class="header-anchor" href="#_2-3-订单"><span>2.3  订单</span></a></h2>
<h3 id="问题1-订单号生成规则有哪些" tabindex="-1"><a class="header-anchor" href="#问题1-订单号生成规则有哪些"><span>问题1:订单号生成规则有哪些?</span></a></h3>
<p>订单号注意唯一性、安全性、尽量短等特点，生成方案常用的如下：</p>
<p>1、时间戳+随机数</p>
<p>年月日时分秒毫秒+随机数</p>
<p>2、高并发场景</p>
<p>年月日时分秒毫秒+随机数+redis自增序列</p>
<p>或</p>
<p>用户id+Redis的唯一数</p>
<p>为什么用redis自增序列?</p>
<p>redis是单线程的，可以使用incr命令，每次都加一，这样次取得数字就是唯一的</p>
<p>3、订单号中加上业务标识</p>
<p>订单号加上业务标识方便客服，比如：第10位是业务类型，第11位是用户类型等。</p>
<p>4、雪花算法</p>
<p>雪花算法是推特内部使用的分布式环境下的唯一ID生成算法，它基于时间戳生成，保证有序递增，加以入计算机硬件等元素，可以满足高并发环境下ID不重复。</p>
<h3 id="问题2-最基本的数据表有哪些" tabindex="-1"><a class="header-anchor" href="#问题2-最基本的数据表有哪些"><span>问题2:最基本的数据表有哪些？</span></a></h3>
<p>订单表</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=N2UzMDlhN2ZiMmI3M2ZjYzBjMjdmZTg1ZDFkZWEzYzdfSkdaSmUxVE1KVmxYUnh4OVBmSlVPWXBDeDRDN0lSTGFfVG9rZW46WnJJR2JMaVRnbzBEN0l4Y2NRYWNScnhVbnFnXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>订单商品表</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=Y2Q2YTU3YjZlMmYxMjBmZGU5YzI3OTMxNjQ0MDJiZjdfZ016Yzl4cW9SMzBKR2k1RzdsNTBJeTd3UVJNUmlCRjFfVG9rZW46S1pTQWJUc2VTb1hPM0t4a1B2a2M0S3BNbmxiXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>订单物流表</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=YTM0ODhkOTFhZWRjYjZmYjQ3OGViYTFkZDlkYWJkY2VfbzlJaXNYME0wYkNhV25uSUxhMmtxeDRrUzBBY1l4UGpfVG9rZW46SU1BQmJaSHk4b1ZEQkR4bzJ3bWNXVkIwbndkXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<h3 id="问题3-如何下单" tabindex="-1"><a class="header-anchor" href="#问题3-如何下单"><span>问题3: 如何下单？</span></a></h3>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=ODhlZjcwNTc3NWU3ZTc1MWJlMDM2YTk3ODQ2NmQwNjhfWk14M0RLTnlzdWZWYXFqVU1uVnhMTXM0YzdoWUw3aGlfVG9rZW46R1Jta2JUUFh6b3BXTjZ4U2Fid2NPZHlCblRYXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<p>先请求订单创建订单。</p>
<p>远程调用商品服务减库存</p>
<p>使用Seata控制分布式事务，实现强一致性或弱一致性处理</p>
<h3 id="问题4-如何取消订单" tabindex="-1"><a class="header-anchor" href="#问题4-如何取消订单"><span>问题4：如何取消订单?</span></a></h3>
<p>接上一个问题，程序收到延迟队列发的订单，如果订单未支付要取消订单，</p>
<p>取消订单需要在订单服务更新订单状态为取消，同时还要加回库存，这里存在分布式事务，因为加回库存与扣减库存不同，加回库存一定能成功，所以分布式事务采用最终一致性。</p>
<p>流程如下：</p>
<p>1、更新订单的状态为取消，同时向本地消息表写一条取消订单的记录。这里用本地事务控制。</p>
<p>2、使用任务调度扫描本地消息表，请求商品服务加回库存。</p>
<h3 id="问题5-防止超卖" tabindex="-1"><a class="header-anchor" href="#问题5-防止超卖"><span>问题5 防止超卖</span></a></h3>
<p>什么是超卖？假如只剩下一个库存，却被多个订单买到了，简单理解就是库存不够了还能正常下单。</p>
<p>方案1：</p>
<p>业务上使用预售防止超卖现象发生。</p>
<p>方案2：</p>
<p>使用数据库行级锁，更新数据库库存，谁更新成功谁拿到库存，同时只能有一个线程更新成功。</p>
<p>方案3：</p>
<p>使用分布式锁，同时只能有一个线程来下单。</p>
<p>分布式锁可以使用redisson实现</p>
<h1 id="_8-其它" tabindex="-1"><a class="header-anchor" href="#_8-其它"><span>8 其它</span></a></h1>
<h2 id="_8-1-项目管理相关" tabindex="-1"><a class="header-anchor" href="#_8-1-项目管理相关"><span>8.1 项目管理相关</span></a></h2>
<h3 id="问题1-项目开发过程是什么" tabindex="-1"><a class="header-anchor" href="#问题1-项目开发过程是什么"><span>问题1：项目开发过程是什么？</span></a></h3>
<p>启动阶段 项目的可行性分析、立项、招投标、合同签署。 计划阶段 范围定义、进度安排、资源计划、成本估计、质量保证计划、风险计划、实施计划等。 实施及控制阶段 项目实施、进度控制、费用控制、质量控制、变更控制等。 结束阶段 范围确认、质量验收、费用结算与审计、项目资料验收、项目交接与清算、项目审计与评估、项目总结等。</p>
<h3 id="问题2-bug处理流程是什么" tabindex="-1"><a class="header-anchor" href="#问题2-bug处理流程是什么"><span>问题2：bug处理流程是什么？</span></a></h3>
<p>开发结束由测试人员对软件进行测试，通常使用项目管理软件管理缺陷，流程如下：</p>
<figure><img src="https://mx67xggunk5.feishu.cn/space/api/box/stream/download/asynccode/?code=MmI3Zjk0YzUzMWZlYzgzZjQ3YTBkOTI0MDUwYzI4NTVfa0dNNmRMUXFnN2V3aU9vZXo1RFFXa0RYcHROdEsySDdfVG9rZW46R21wamJ6Qnk1b3AwdlR4OE1rUmNaN1hMbnFnXzE3MjU0MjcwODk6MTcyNTQzMDY4OV9WNA" alt="img" tabindex="0" loading="lazy"><figcaption>img</figcaption></figure>
<h3 id="问题3-前后端联调有bug怎么处理" tabindex="-1"><a class="header-anchor" href="#问题3-前后端联调有bug怎么处理"><span>问题3: 前后端联调有bug怎么处理？</span></a></h3>
<p>首先看接口文档，接口的url、请求及响应的数据格式，再进行接口bug重现对照接口文档看是哪的问题。</p>
<p>如果是后端的问题我就根据接口文档去修改代码，如果是前端的问题我会与前端工程师沟通确认。</p>
<h3 id="问题4-开发一个接口流程是什么" tabindex="-1"><a class="header-anchor" href="#问题4-开发一个接口流程是什么"><span>问题4: 开发一个接口流程是什么？</span></a></h3>
<p>在前后端分离开发中通常由后端程序员设计接口，完成后需要编写接口文档，最后将文档交给前端工程师，前端和后端工程师参考文档进行开发。</p>
<p>在测试接口时各自完成单元测试，约定开发一部分模块后进行前后端联调。</p>
<p>遇到接口问题先查接口文档，再对照bug，确定问题进行修复。</p>
<h3 id="问题5-如何设计一个接口" tabindex="-1"><a class="header-anchor" href="#问题5-如何设计一个接口"><span>问题5: 如何设计一个接口？</span></a></h3>
<p>根据产品原型中用户的操作去设计接口，比如：查询接口、新增接口，删除接口等。</p>
<p>首先确定接口协议：</p>
<p>通常协议采用HTTP，查询类接口通常为get或post，查询条件较少的使用get，较多的使用post。</p>
<p>还要确定content-type，参数以什么数据格式提交，结果以什么数据格式响应。</p>
<p>一般情况没有特殊情况结果以json 格式响应。</p>
<p>然后分析请求参数的格式，是key/value串还是json。</p>
<p>最后分析响应结果的格式，通过是json。</p>
<h2 id="_8-2-devops相关" tabindex="-1"><a class="header-anchor" href="#_8-2-devops相关"><span>8.2 DevOps相关</span></a></h2>
<h3 id="问题1-你部署过项目吗" tabindex="-1"><a class="header-anchor" href="#问题1-你部署过项目吗"><span>问题1:你部署过项目吗？</span></a></h3>
<p>在我们公司的开发环境有一套持续集成的环境 ，使用的是jenkins软件实现的，生产环境由公司的运维人员负责。</p>
<p>我自己也有手动将微服务部署到Centos上的经历，先将项目打包，在centos上创建docker镜像，启动容器。</p>
<h3 id="问题2-什么是devops-什么是ci-cd" tabindex="-1"><a class="header-anchor" href="#问题2-什么是devops-什么是ci-cd"><span>问题2:什么是DevOps? 什么是CI/CD?</span></a></h3>
<p>DevOps是开发和运维的组合，是一种思想理念，目标是提高软件开发、测试、运维、运营等各部门的沟通与协作质量。强调通过自动化的方法去管理软件变更、软件集成，使软件从构建到测试、发布更加快捷、可靠，最终按时交付软件。</p>
<p>CI/CD是一种DevOps的实现方案，含了一个 CI 和两个 CD，CI表示持续集成，CD包含持续交付和持续部署，三者具有前后依赖关系。</p>
<p>持续集成：是将开发分支合并到主分支，将所有模块的代码进行集成、编译、构建、自动化测试。</p>
<p>持续交付是将集成后的代码部署到类生产环境(预发布)，交付给测试、产品验收。</p>
<p>持续部署是在持续交付的基础上由开发人员或运维人员通过自动化的工具定期向生产环境部署稳定的构建版本。</p>
<h3 id="问题3-项目如何打包" tabindex="-1"><a class="header-anchor" href="#问题3-项目如何打包"><span>问题3:项目如何打包？</span></a></h3>
<p>我们的项目是SpringBoot的工程，添加一个SpringBoot的maven打包插件进行打包。</p>
<p>插件添加完成在父工程对模块进行聚合，运行mvn package即可打包。</p>
<h3 id="问题4-项目如何部署" tabindex="-1"><a class="header-anchor" href="#问题4-项目如何部署"><span>问题4:项目如何部署？</span></a></h3>
<p>我们公司是通过一套持续集成的环境的部署到测试以及生产环境的，使用的是jenkins和k8s。</p>
<p>自动化的环境是由jenkins自动从git拉取代码，进行编译、打包、创建镜像、上传到docker仓库，然后远程调用服务器进行容器部署。</p>
<p>我也有手动部署项目的经历，先将项目打包，在centos上创建docker镜像，启动容器。</p>
</div></template>


