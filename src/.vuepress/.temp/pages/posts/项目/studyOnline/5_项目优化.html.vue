<template><div><!--more--->
<h1 id="缓存优化" tabindex="-1"><a class="header-anchor" href="#缓存优化"><span>缓存优化</span></a></h1>
<h2 id="一、redis缓存" tabindex="-1"><a class="header-anchor" href="#一、redis缓存"><span>一、Redis缓存</span></a></h2>
<p>课程发布信息的特点的是查询较多，修改很少，这里考虑将课程发布信息进行缓存。</p>
<p>课程信息缓存的流程如下：</p>
<figure><img src="/image/project/p10.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>在nacos配置redis-dev.yaml（group=xuecheng-plus-common）</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>spring: 
  redis:
    host: 192.168.101.65
    port: 6379
    password: redis
    database: 0
    lettuce:
      pool:
        max-active: 20
        max-idle: 10
        min-idle: 0
    timeout: 10000
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在content-api微服务加载redis-dev.yaml</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>shared-configs:
    - data-id: redis-${spring.profiles.active}.yaml
      group: xuecheng-plus-common
      refresh: true
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在content-service微服务中添加依赖</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.boot&lt;/groupId&gt;
    &lt;artifactId&gt;spring-boot-starter-data-redis&lt;/artifactId&gt;
&lt;/dependency&gt;
&lt;dependency&gt;
    &lt;groupId&gt;org.apache.commons&lt;/groupId&gt;
    &lt;artifactId&gt;commons-pool2&lt;/artifactId&gt;
    &lt;version&gt;2.6.2&lt;/version&gt;
&lt;/dependency&gt;
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>定义查询缓存接口：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>/**
 * @description 查询缓存中的课程信息
 * @param courseId 
 * @return com.xuecheng.content.model.po.CoursePublish
*/
public CoursePublish getCoursePublishCache(Long courseId);
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>接口实现如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public CoursePublish getCoursePublishCache(Long courseId){
    //查询缓存
   Object  jsonObj = redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
    if(jsonObj!=null){
    String jsonString = jsonObj.toString();
        System.out.println(&quot;=================从缓存查=================&quot;);
        CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
        return coursePublish;
    } else {
        System.out.println(&quot;从数据库查询...&quot;);
        //从数据库查询
        CoursePublish coursePublish = getCoursePublish(courseId);
        if(coursePublish!=null){
            redisTemplate.opsForValue().set(&quot;course:&quot; + courseId, JSON.toJSONString(coursePublish));
        }
        return coursePublish;
    }
}
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改controller接口调用代码</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@ApiOperation(&quot;获取课程发布信息&quot;)
    @ResponseBody
    @GetMapping(&quot;/course/whole/{courseId}&quot;)
    public CoursePreviewDto getCoursePublish(@PathVariable(&quot;courseId&quot;) Long courseId) {
        //查询课程发布信息
        CoursePublish coursePublish = coursePublishService.getCoursePublishCache(courseId);
//        CoursePublish coursePublish = coursePublishService.getCoursePublish(courseId);
        if(coursePublish==null){
            return new CoursePreviewDto();
        }

        //课程基本信息
        CourseBaseInfoDto courseBase = new CourseBaseInfoDto();
        BeanUtils.copyProperties(coursePublish, courseBase);
        //课程计划
        List&lt;TeachplanDto&gt; teachplans = JSON.parseArray(coursePublish.getTeachplan(), TeachplanDto.class);
        CoursePreviewDto coursePreviewInfo = new CoursePreviewDto();
        coursePreviewInfo.setCourseBase(courseBase);
        coursePreviewInfo.setTeachplans(teachplans);
        return coursePreviewInfo;
    }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="二、问题" tabindex="-1"><a class="header-anchor" href="#二、问题"><span>二、问题</span></a></h2>
<h3 id="_1、缓存穿透" tabindex="-1"><a class="header-anchor" href="#_1、缓存穿透"><span>1、缓存穿透</span></a></h3>
<h4 id="_1-什么是缓存穿透" tabindex="-1"><a class="header-anchor" href="#_1-什么是缓存穿透"><span>1）什么是缓存穿透</span></a></h4>
<p>使用缓存后代码的性能有了很大的提高，虽然性能有很大的提升但是控制台打出了很多“从数据库查询”的日志，明明判断了如果缓存存在课程信息则从缓存查询，为什么要有这么多从数据库查询的请求的？</p>
<p><strong>这是因为并发数高，很多线程会同时到达查询数据库代码处去执行。</strong></p>
<p>如果存在恶意攻击的可能，如果有大量并发去查询一个不存在的课程信息会出现什么问题呢？</p>
<p>比如去请求/content/course/whole/181，查询181号课程，该课程并不在课程发布表中。</p>
<p>进行压力测试发现会去请求数据库。<strong>大量并发去访问一个数据库不存在的数据，由于缓存中没有该数据导致大量并发查询数据库，这个现象要缓存穿透。</strong></p>
<figure><img src="/image/project/p11.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<div class="hint-container warning">
<p class="hint-container-title">注意</p>
<p>缓存穿透可以造成数据库瞬间压力过大，连接数等资源用完，最终数据库拒绝连接不可用。</p>
</div>
<h4 id="_2-解决缓存穿透" tabindex="-1"><a class="header-anchor" href="#_2-解决缓存穿透"><span>2）解决缓存穿透</span></a></h4>
<p><strong>1.对请求增加校验机制</strong></p>
<p>比如：课程Id是长整型，如果发来的不是长整型则直接返回。</p>
<p><strong>2.使用布隆过滤器</strong></p>
<div class="hint-container tip">
<p class="hint-container-title">什么是布隆过滤器，以下摘自百度百科：</p>
<p>布隆过滤器可以用于检索一个元素是否在一个集合中。如果想要判断一个元素是不是在一个集合里，一般想到的是将所有元素保存起来，然后通过比较确定。<a href="https://baike.baidu.com/item/%E9%93%BE%E8%A1%A8/9794473?fromModule=lemma_inlink" target="_blank" rel="noopener noreferrer">链表</a>，树等等数据结构都是这种思路. 但是随着集合中元素的增加，我们需要的存储空间越来越大，<a href="https://baike.baidu.com/item/%E6%A3%80%E7%B4%A2%E9%80%9F%E5%BA%A6/20807841?fromModule=lemma_inlink" target="_blank" rel="noopener noreferrer">检索速度</a>也越来越慢(O(n),O(logn))。不过世界上还有一种叫作散列表（又叫<a href="https://baike.baidu.com/item/%E5%93%88%E5%B8%8C%E8%A1%A8/5981869?fromModule=lemma_inlink" target="_blank" rel="noopener noreferrer">哈希表</a>，Hash table）的数据结构。它可以通过一个Hash函数将一个元素映射成一个位阵列（Bit array）中的一个点。这样一来，我们只要看看这个点是不是1就可以知道集合中有没有它了。这就是布隆过滤器的基本思想。</p>
</div>
<ul>
<li>布隆过滤器的特点是:高效地插入和查询，占用空间少；<strong>查询结果有不确定性，如果查询结果是存在则元素不一定存在，如果不存在则一定不存在；另外它只能添加元素不能删除元素，因为删除元素会增加误判率。</strong>
<ul>
<li>比如：将商品id写入布隆过滤器，如果分3次hash此时在布隆过滤器有3个点，当从布隆过滤器查询该商品id，通过hash找到了该商品id在过滤器中的点，此时返回1，如果找不到一定会返回0。</li>
</ul>
</li>
</ul>
<p>所以，为了避免缓存穿透我们需要缓存预热将要查询的课程或商品信息的id提前存入布隆过滤器，添加数据时将信息的id也存入过滤器，当去查询一个数据时先在布隆过滤器中找一下如果没有到到就说明不存在，此时直接返回。</p>
<p>实现方法有：Google工具包Guava实现。Redisson 。</p>
<p><strong>3.缓存空值或特殊值</strong></p>
<p>请求通过了第一步的校验，查询数据库得到的数据不存在，此时我们仍然去缓存数据，缓存一个空值或一个特殊值的数据。</p>
<p>但是要注意：如果缓存了空值或特殊值要<strong>设置一个短暂的过期时间</strong>。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public CoursePublish getCoursePublishCache(Long courseId) {

    //查询缓存
   Object  jsonObj = redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
    if(jsonObj!=null){
    String jsonString = jsonObj.toString();
        if(jsonString.equals(&quot;null&quot;))
            return null;
        CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
        return coursePublish;
    } else {
        //从数据库查询
        System.out.println(&quot;从数据库查询数据...&quot;);
        CoursePublish coursePublish = getCoursePublish(courseId);
        //设置过期时间300秒
        redisTemplate.opsForValue().set(&quot;course:&quot; + courseId, JSON.toJSONString(coursePublish),30, TimeUnit.SECONDS);
        return coursePublish;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>再测试，虽然还存在个别请求去查询数据库，但不是所有请求都去查询数据库，基本上都命中缓存。</p>
<h3 id="_2、缓存雪崩" tabindex="-1"><a class="header-anchor" href="#_2、缓存雪崩"><span>2、缓存雪崩</span></a></h3>
<h4 id="_1-什么是缓存雪崩" tabindex="-1"><a class="header-anchor" href="#_1-什么是缓存雪崩"><span>1）什么是缓存雪崩</span></a></h4>
<p><strong>缓存雪崩是缓存中大量key失效后当高并发到来时导致大量请求到数据库，瞬间耗尽数据库资源，导致数据库无法使用。</strong></p>
<p>造成缓存雪崩问题的原因是是<strong>大量key拥有了相同的过期时间</strong>，比如对课程信息设置缓存过期时间为10分钟，在大量请求同时查询大量的课程信息时，此时就会有大量的课程存在相同的过期时间，一旦失效将同时失效，造成雪崩问题。</p>
<h4 id="_2-解决缓存雪崩" tabindex="-1"><a class="header-anchor" href="#_2-解决缓存雪崩"><span>2）解决缓存雪崩</span></a></h4>
<p><strong>1.使用同步锁控制查询数据库的线程</strong></p>
<p>使用同步锁控制查询数据库的线程，只允许有一个线程去查询数据库，查询得到数据后存入缓存。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>synchronized(obj){
  //查询数据库
  //存入缓存
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>2.对同一类型信息的key设置不同的过期时间</strong></p>
<p>通常对一类信息的key设置的过期时间是相同的，这里可以在原有固定时间的基础上加上一个随机时间使它们的过期时间都不相同。</p>
<p>示例代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>   //设置过期时间300秒
  redisTemplate.opsForValue().set(&quot;course:&quot; + courseId, JSON.toJSONString(coursePublish),300+new Random().nextInt(100), TimeUnit.SECONDS);
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>3.缓存预热</strong></p>
<p>不用等到请求到来再去查询数据库存入缓存，可以提前将数据存入缓存。使用缓存预热机制通常有专门的后台程序去将数据库的数据同步到缓存。</p>
<h3 id="_3、缓存击穿" tabindex="-1"><a class="header-anchor" href="#_3、缓存击穿"><span>3、缓存击穿</span></a></h3>
<h4 id="_1-什么是缓存击穿" tabindex="-1"><a class="header-anchor" href="#_1-什么是缓存击穿"><span>1）什么是缓存击穿</span></a></h4>
<p><strong>缓存击穿是指大量并发访问同一个热点数据，当热点数据失效后同时去请求数据库，瞬间耗尽数据库资源，导致数据库无法使用。</strong></p>
<p>比如某手机新品发布，当缓存失效时有大量并发到来导致同时去访问数据库。</p>
<figure><img src="/image/project/p12.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h4 id="_2-解决缓存击穿" tabindex="-1"><a class="header-anchor" href="#_2-解决缓存击穿"><span>2）解决缓存击穿</span></a></h4>
<p><strong>1.使用同步锁控制查询数据库的线程</strong></p>
<p>使用同步锁控制查询数据库的代码，只允许有一个线程去查询数据库，查询得到数据库存入缓存。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>synchronized(obj){
  //查询数据库
  //存入缓存
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>2.热点数据不过期</strong></p>
<p>可以由后台程序提前将热点数据加入缓存，缓存过期时间不过期，由后台程序做好缓存同步。</p>
<p>下边使用synchronized对代码加锁,对查询缓存的代码不用synchronized加锁控制，只对查询数据库进行加锁，如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public  CoursePublish getCoursePublishCache(Long courseId){

        //查询缓存
         Object  jsonObj = redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
         if(jsonObj!=null){
            String jsonString = jsonObj.toString();
            CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
            return coursePublish;
        }else{
            synchronized(this){
                Object  jsonObj = redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
                if(jsonObj!=null){
                   String jsonString = jsonObj.toString();
                    CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
                    return coursePublish;
                }
                 System.out.println(&quot;=========从数据库查询==========&quot;);
                //从数据库查询
                CoursePublish coursePublish = getCoursePublish(courseId);
              //设置过期时间300秒
                redisTemplate.opsForValue().set(&quot;course:&quot; + courseId, JSON.toJSONString(coursePublish),300, TimeUnit.SECONDS);
                return coursePublish;
            }
        }


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、小结" tabindex="-1"><a class="header-anchor" href="#_4、小结"><span>4、小结</span></a></h3>
<p><strong>1）缓存穿透：</strong></p>
<p>去访问一个数据库不存在的数据无法将数据进行缓存，导致查询数据库，当并发较大就会对数据库造成压力。缓存穿透可以造成数据库瞬间压力过大，连接数等资源用完，最终数据库拒绝连接不可用。</p>
<p><strong>解决的方法：</strong></p>
<ul>
<li>
<p>缓存一个null值。</p>
</li>
<li>
<p>使用布隆过滤器。</p>
</li>
</ul>
<p><strong>2）缓存雪崩：</strong></p>
<p>缓存中大量key失效后当高并发到来时导致大量请求到数据库，瞬间耗尽数据库资源，导致数据库无法使用。</p>
<p>造成缓存雪崩问题的原因是是大量key拥有了相同的过期时间。</p>
<p><strong>解决办法：</strong></p>
<ul>
<li>
<p>使用同步锁控制</p>
</li>
<li>
<p>对同一类型信息的key设置不同的过期时间，比如：使用固定数+随机数作为过期时间。</p>
</li>
</ul>
<p><strong>3）缓存击穿</strong></p>
<p>大量并发访问同一个热点数据，当热点数据失效后同时去请求数据库，瞬间耗尽数据库资源，导致数据库无法使用。</p>
<p><strong>解决办法：</strong></p>
<ul>
<li>
<p>使用同步锁控制</p>
</li>
<li>
<p>设置key永不过期</p>
</li>
</ul>
<h2 id="三、分布式锁" tabindex="-1"><a class="header-anchor" href="#三、分布式锁"><span>三、分布式锁</span></a></h2>
<h3 id="_1、本地锁的问题" tabindex="-1"><a class="header-anchor" href="#_1、本地锁的问题"><span>1、本地锁的问题</span></a></h3>
<p>上边的程序使用了同步锁解决了缓存击穿、缓存雪崩的问题，保证同一个key过期后只会查询一次数据库。如果将同步锁的程序分布式部署在多个虚拟机上则无法保证同一个key只会查询一次数据库，如下图：</p>
<figure><img src="/image/project/p13.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>一个同步锁程序只能保证同一个虚拟机中多个线程只有一个线程去数据库，如果高并发通过网关负载均衡转发给各个虚拟机，此时就会存在多个线程去查询数据库情况，因为虚拟机中的锁只能保证该虚拟机自己的线程去同步执行，无法跨虚拟机保证同步执行。</p>
<p>我们将虚拟机内部的锁叫本地锁，本地锁只能保证所在虚拟机的线程同步执行。</p>
<h3 id="_2、什么是分布锁" tabindex="-1"><a class="header-anchor" href="#_2、什么是分布锁"><span>2、什么是分布锁</span></a></h3>
<p>本地锁只能控制所在虚拟机中的线程同步执行，现在要实现分布式环境下所有虚拟机中的线程去同步执行就需要让多个虚拟机去共用一个锁，虚拟机可以分布式部署，锁也可以分布式部署，如下图：</p>
<figure><img src="/image/project/p14.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h3 id="_3、分布式锁的实现方案" tabindex="-1"><a class="header-anchor" href="#_3、分布式锁的实现方案"><span>3、分布式锁的实现方案</span></a></h3>
<p>实现分布式锁的方案有很多，常用的如下：</p>
<ul>
<li><strong>1、基于数据库实现分布锁</strong></li>
</ul>
<p>利用数据库主键唯一性的特点，或利用数据库唯一索引的特点，多个线程同时去插入相同的记录，谁插入成功谁就抢到锁。</p>
<ul>
<li><strong>2、基于redis实现锁</strong></li>
</ul>
<p>redis提供了分布式锁的实现方案，比如：SETNX、set nx、redisson等。</p>
<p>拿SETNX举例说明，SETNX命令的工作过程是去set一个不存在的key，多个线程去设置同一个key只会有一个线程设置成功，设置成功的的线程拿到锁。</p>
<ul>
<li><strong>3、使用zookeeper实现</strong></li>
</ul>
<p>zookeeper是一个分布式协调服务，主要解决分布式程序之间的同步的问题。zookeeper的结构类似的文件目录，多线程向zookeeper创建一个子目录(节点)只会有一个创建成功，利用此特点可以实现分布式锁，谁创建该结点成功谁就获得锁。</p>
<h3 id="_4、redis-nx实现分布式锁" tabindex="-1"><a class="header-anchor" href="#_4、redis-nx实现分布式锁"><span>4、Redis NX实现分布式锁</span></a></h3>
<p>redis实现分布式锁的方案可以在redis.cn网站查阅，<a href="http://www.redis.cn/commands/set.html" target="_blank" rel="noopener noreferrer">地址</a></p>
<p>使用命令： <code v-pre>SET resource-name anystring NX EX max-lock-time</code> 即可实现。</p>
<ul>
<li>
<p>NX：表示key不存在才设置成功。</p>
</li>
<li>
<p>EX：设置过期时间</p>
</li>
</ul>
<p><strong>如何在代码中使用Set nx去实现分布锁呢？</strong></p>
<p>使用spring-boot-starter-data-redis 提供的api即可实现set nx。</p>
<p>添加依赖：</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.springframework.boot<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>spring-boot-starter-data-redis<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.apache.commons<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>commons-pool2<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>2.6.2<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>添加依赖后，在bean中注入restTemplate。</p>
<p>我们先分析一段伪代码如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>if(缓存中有){

  返回缓存中的数据
}else{

  获取分布式锁
  if(获取锁成功）{
       try{
         查询数据库
      }finally{
         释放锁
      }
  }
 
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><ul>
<li>1、获取分布式锁</li>
</ul>
<p>使用redisTemplate.opsForValue().setIfAbsent(key,vaue)获取锁，这里考虑一个问题，当set nx一个key/value成功1后，这个key(就是锁)需要设置过期时间吗？</p>
<p>如果不设置过期时间当获取到了锁却没有执行finally这个锁将会一直存在，其它线程无法获取这个锁。所以执行set nx时要指定过期时间，即使用如下的命令</p>
<div class="language-text line-numbers-mode" data-ext="text" data-title="text"><pre v-pre class="language-text"><code>SET resource-name anystring NX EX max-lock-time
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>具体调用的方法是：<code v-pre>redisTemplate.opsForValue().setIfAbsent(K var1, V var2, long var3, TimeUnit var5)</code></p>
<ul>
<li>2、如何释放锁</li>
</ul>
<p>释放锁分为两种情况：key到期自动释放，手动删除。</p>
<p>​	1）key到期自动释放的方法</p>
<p>因为锁设置了过期时间，key到期会自动释放，但是会存在一个问题就是 查询数据库等操作还没有执行完时key到期了，此时其它线程就抢到锁了，最终重复查询数据库执行了重复的业务操作。</p>
<p><strong>怎么解决这个问题？</strong></p>
<p>可以将key的到期时间设置的长一些，足以执行完成查询数据库并设置缓存等相关操作。如果这样效率会低一些，另外这个时间值也不好把控。</p>
<p>2）手动删除锁</p>
<p>如果是采用手动删除锁可能和key到期自动删除有所冲突，造成删除了别人的锁。</p>
<p>比如：当查询数据库等业务还没有执行完时key过期了，此时其它线程占用了锁，当上一个线程执行查询数据库等业务操作完成后手动删除锁就把其它线程的锁给删除了。</p>
<p>要解决这个问题可以采用删除锁之前判断是不是自己设置的锁，伪代码如下：</p>
<div class="language-JavaScript line-numbers-mode" data-ext="JavaScript" data-title="JavaScript"><pre v-pre class="language-JavaScript"><code>if(缓存中有){

  返回缓存中的数据
}else{

  获取分布式锁: set lock 01 NX
  if(获取锁成功）{
       try{
         查询数据库
      }finally{
         if(redis.call(&quot;get&quot;,&quot;lock&quot;)==&quot;01&quot;){
            释放锁: redis.call(&quot;del&quot;,&quot;lock&quot;)
         }
         
      }
  }
 
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>以上代码第11行到13行非原子性，也会导致删除其它线程的锁。<strong>可以使用lua脚本来解决</strong>。</p>
<h3 id="_5、redisson实现分布式锁" tabindex="-1"><a class="header-anchor" href="#_5、redisson实现分布式锁"><span>5、Redisson实现分布式锁</span></a></h3>
<h4 id="_1-什么是redisson" tabindex="-1"><a class="header-anchor" href="#_1-什么是redisson"><span>1）什么是Redisson</span></a></h4>
<p>Redisson的<a href="https://github.com/redisson/redisson/wiki/Table-of-Content" target="_blank" rel="noopener noreferrer">文档地址</a></p>
<p>我们选用<a href="https://github.com/redisson/redisson" target="_blank" rel="noopener noreferrer">Java的实现方案</a></p>
<p>Redisson底层采用的是<a href="http://netty.io/" target="_blank" rel="noopener noreferrer">Netty</a> 框架。支持<a href="http://redis.cn/" target="_blank" rel="noopener noreferrer">Redis</a> 2.8以上版本，支持Java1.6+以上版本。Redisson是一个在Redis的基础上实现的Java驻内存数据网格（In-Memory Data Grid）。它不仅提供了一系列的分布式的Java常用对象，还提供了许多分布式服务。其中包括(<code v-pre>BitSet</code>, <code v-pre>Set</code>, <code v-pre>Multimap</code>, <code v-pre>SortedSet</code>, <code v-pre>Map</code>, <code v-pre>List</code>, <code v-pre>Queue</code>, <code v-pre>BlockingQueue</code>, <code v-pre>Deque</code>, <code v-pre>BlockingDeque</code>, <code v-pre>Semaphore</code>, <code v-pre>Lock</code>, <code v-pre>AtomicLong</code>, <code v-pre>CountDownLatch</code>, <code v-pre>Publish / Subscribe</code>, <code v-pre>Bloom filter</code>, <code v-pre>Remote service</code>, <code v-pre>Spring cache</code>, <code v-pre>Executor service</code>, <code v-pre>Live Object service</code>, <code v-pre>Scheduler service</code>) 。</p>
<figure><img src="/image/project/p15.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<ul>
<li>
<p>使用Redisson可以非常方便将Java本地内存中的常用数据结构的对象搬到分布式缓存redis中。</p>
</li>
<li>
<p>也可以将常用的并发编程工具如：AtomicLong、CountDownLatch、Semaphore等支持分布式。</p>
</li>
<li>
<p>使用RScheduledExecutorService 实现分布式调度服务。</p>
</li>
<li>
<p>支持数据分片，将数据分片存储到不同的redis实例中。</p>
</li>
<li>
<p>支持分布式锁，基于Java的Lock接口实现分布式锁，方便开发。</p>
</li>
</ul>
<p>下边使用Redisson将Queue队列的数据存入Redis，实现一个排队及出队的接口。</p>
<figure><img src="/image/project/p16.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h4 id="_2-redisson使用" tabindex="-1"><a class="header-anchor" href="#_2-redisson使用"><span>2）Redisson使用</span></a></h4>
<p>添加redisson的依赖</p>
<div class="language-xml line-numbers-mode" data-ext="xml" data-title="xml"><pre v-pre class="language-xml"><code><span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>dependency</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>groupId</span><span class="token punctuation">></span></span>org.redisson<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>groupId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>artifactId</span><span class="token punctuation">></span></span>redisson-spring-boot-starter<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>artifactId</span><span class="token punctuation">></span></span>
    <span class="token tag"><span class="token tag"><span class="token punctuation">&lt;</span>version</span><span class="token punctuation">></span></span>3.11.2<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>version</span><span class="token punctuation">></span></span>
<span class="token tag"><span class="token tag"><span class="token punctuation">&lt;/</span>dependency</span><span class="token punctuation">></span></span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在静态文件中添加<code v-pre>singleServerConfig.yaml</code>配置文件</p>
<div class="language-yaml line-numbers-mode" data-ext="yml" data-title="yml"><pre v-pre class="language-yaml"><code><span class="token punctuation">---</span>
<span class="token key atrule">singleServerConfig</span><span class="token punctuation">:</span>
  <span class="token comment">#如果当前连接池里的连接数量超过了最小空闲连接数，而同时有连接空闲时间超过了该数值，</span>
  <span class="token comment">#那么这些连接将会自动被关闭，并从连接池里去掉。时间单位是毫秒。</span>
  <span class="token comment">#默认值：10000</span>
  <span class="token key atrule">idleConnectionTimeout</span><span class="token punctuation">:</span> <span class="token number">10000</span>
  <span class="token key atrule">pingTimeout</span><span class="token punctuation">:</span> <span class="token number">1000</span>
  <span class="token comment">#同任何节点建立连接时的等待超时。时间单位是毫秒。</span>
  <span class="token comment">#默认值：10000</span>
  <span class="token key atrule">connectTimeout</span><span class="token punctuation">:</span> <span class="token number">10000</span>
  <span class="token comment">#等待节点回复命令的时间。该时间从命令发送成功时开始计时。</span>
  <span class="token comment">#默认值：3000</span>
  <span class="token key atrule">timeout</span><span class="token punctuation">:</span> <span class="token number">3000</span>
  <span class="token comment">#如果尝试达到 retryAttempts（命令失败重试次数）</span>
  <span class="token comment">#仍然不能将命令发送至某个指定的节点时，将抛出错误。如果尝试在此限制之内发送成功，</span>
  <span class="token comment">#则开始启用 timeout（命令等待超时） 计时。</span>
  <span class="token comment">#默认值：3</span>
  <span class="token key atrule">retryAttempts</span><span class="token punctuation">:</span> <span class="token number">3</span>
  <span class="token comment">#在某个节点执行相同或不同命令时，连续失败failedAttempts（执行失败最大次数）时，</span>
  <span class="token comment">#该节点将被从可用节点列表里清除，直到 reconnectionTimeout（重新连接时间间隔） 超时以后再次尝试。</span>
  <span class="token comment">#默认值：1500</span>
  <span class="token key atrule">retryInterval</span><span class="token punctuation">:</span> <span class="token number">1500</span>
  <span class="token comment">#重新连接时间间隔</span>
  <span class="token key atrule">reconnectionTimeout</span><span class="token punctuation">:</span> <span class="token number">3000</span>
  <span class="token comment">#执行失败最大次数</span>
  <span class="token key atrule">failedAttempts</span><span class="token punctuation">:</span> <span class="token number">3</span>
  <span class="token comment">#密码</span>
  <span class="token key atrule">password</span><span class="token punctuation">:</span> <span class="token number">123456</span>
  <span class="token comment">#数据库选择 select 4</span>
  <span class="token key atrule">database</span><span class="token punctuation">:</span> <span class="token number">0</span>
  <span class="token comment">#每个连接的最大订阅数量。</span>
  <span class="token comment">#默认值：5</span>
  <span class="token key atrule">subscriptionsPerConnection</span><span class="token punctuation">:</span> <span class="token number">5</span>
  <span class="token comment">#在Redis节点里显示的客户端名称。</span>
  <span class="token key atrule">clientName</span><span class="token punctuation">:</span> <span class="token null important">null</span>
  <span class="token comment">#在Redis节点</span>
  <span class="token key atrule">address</span><span class="token punctuation">:</span> <span class="token string">"redis://127.0.0.1:6379"</span>
  <span class="token comment">#从节点发布和订阅连接的最小空闲连接数</span>
  <span class="token comment">#默认值：1</span>
  <span class="token key atrule">subscriptionConnectionMinimumIdleSize</span><span class="token punctuation">:</span> <span class="token number">1</span>
  <span class="token comment">#用于发布和订阅连接的连接池最大容量。连接池的连接数量自动弹性伸缩。</span>
  <span class="token comment">#默认值：50</span>
  <span class="token key atrule">subscriptionConnectionPoolSize</span><span class="token punctuation">:</span> <span class="token number">50</span>
  <span class="token comment">#节点最小空闲连接数</span>
  <span class="token comment">#默认值：32</span>
  <span class="token key atrule">connectionMinimumIdleSize</span><span class="token punctuation">:</span> <span class="token number">32</span>
  <span class="token comment">#节点连接池大小</span>
  <span class="token comment">#默认值：64</span>
  <span class="token key atrule">connectionPoolSize</span><span class="token punctuation">:</span> <span class="token number">64</span>
<span class="token comment">#这个线程池数量被所有RTopic对象监听器，RRemoteService调用者和RExecutorService任务共同共享。</span>
<span class="token comment">#默认值: 当前处理核数量 * 2</span>
<span class="token key atrule">threads</span><span class="token punctuation">:</span> <span class="token number">8</span>
<span class="token comment">#这个线程池数量是在一个Redisson实例内，被其创建的所有分布式数据类型和服务，</span>
<span class="token comment">#以及底层客户端所一同共享的线程池里保存的线程数量。</span>
<span class="token comment">#默认值: 当前处理核数量 * 2</span>
<span class="token key atrule">nettyThreads</span><span class="token punctuation">:</span> <span class="token number">8</span>
<span class="token comment">#Redisson的对象编码类是用于将对象进行序列化和反序列化，以实现对该对象在Redis里的读取和存储。</span>
<span class="token comment">#默认值: org.redisson.codec.JsonJacksonCodec</span>
<span class="token key atrule">codec</span><span class="token punctuation">:</span> <span class="token tag">!&lt;org.redisson.codec.JsonJacksonCodec></span> <span class="token punctuation">{</span><span class="token punctuation">}</span>
<span class="token comment">#传输模式</span>
<span class="token comment">#默认值：TransportMode.NIO</span>
<span class="token key atrule">transportMode</span><span class="token punctuation">:</span> <span class="token string">"NIO"</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>在redis配置文件中添加：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>spring:
  redis:
    redisson:
      #配置文件目录
      config: classpath:singleServerConfig.yaml
      #config: classpath:clusterServersConfig.yaml
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>Redisson相比set nx实现分布式锁要简单的多，工作原理如下：</p>
<figure><img src="/image/project/p17.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<ul>
<li>
<p><strong>加锁机制</strong></p>
<ul>
<li>线程去获取锁，获取成功: 执行lua脚本，保存数据到redis数据库。</li>
<li>线程去获取锁，获取失败: 一直通过while循环尝试获取锁，获取成功后，执行lua脚本，保存数据到redis</li>
</ul>
</li>
<li>
<p><strong>WatchDog自动延期看门狗机制</strong></p>
<ul>
<li>第一种情况：在一个分布式环境下，假如一个线程获得锁后，突然服务器宕机了，那么这个时候在一定时间后这个锁会自动释放，你也可以设置锁的有效时间(当不设置默认30秒时），这样的目的主要是防止死锁的发生</li>
<li>第二种情况：线程A业务还没有执行完，时间就过了，线程A 还想持有锁的话，就会启动一个watch dog后台线程，不断的延长锁key的生存时间。</li>
</ul>
</li>
<li>
<p><strong>lua脚本-保证原子性操作</strong></p>
<ul>
<li>主要是如果你的业务逻辑复杂的话，通过封装在lua脚本中发送给redis，而且redis是单线程的，这样就保证这段复杂业务逻辑执行的原子性</li>
</ul>
</li>
</ul>
<p>具体使用RLock操作分布锁，RLock继承JDK的Lock接口，所以他有Lock接口的所有特性，比如lock、unlock、trylock等特性,同时它还有很多新特性：强制锁释放，带有效期的锁,。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public interface RRLock {
    
   //----------------------Lock接口方法-----------------------
    /**
     * 加锁 锁的有效期默认30秒
     */
    void lock();
    
     /**
     * 加锁 可以手动设置锁的有效时间
     *
     * @param leaseTime 锁有效时间
     * @param unit      时间单位 小时、分、秒、毫秒等
     */
    void lock(long leaseTime, TimeUnit unit);
    
    /**
     * tryLock()方法是有返回值的，用来尝试获取锁，
     * 如果获取成功，则返回true，如果获取失败（即锁已被其他线程获取），则返回false .
     */
    boolean tryLock();
    
    /**
     * tryLock(long time, TimeUnit unit)方法和tryLock()方法是类似的，
     * 只不过区别在于这个方法在拿不到锁时会等待一定的时间，
     * 在时间期限之内如果还拿不到锁，就返回false。如果如果一开始拿到锁或者在等待期间内拿到了锁，则返回true。
     *
     * @param time 等待时间
     * @param unit 时间单位 小时、分、秒、毫秒等
     */
    boolean tryLock(long time, TimeUnit unit) throws InterruptedException;
    
    /**
     * 比上面多一个参数，多添加一个锁的有效时间
     *
     * @param waitTime  等待时间
     * @param leaseTime 锁有效时间
     * @param unit      时间单位 小时、分、秒、毫秒等
     * waitTime 大于 leaseTime
     */
    boolean tryLock(long waitTime, long leaseTime, TimeUnit unit) throws InterruptedException;
    
    /**
     * 解锁
     */
    void unlock();
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>lock()</strong>：</p>
<ul>
<li>此方法为加锁，但是锁的有效期采用<strong>默认30秒</strong></li>
<li>如果主线程未释放，且当前锁未调用unlock方法，则进入到<strong>watchDog机制</strong></li>
<li>如果主线程未释放，且当前锁调用unlock方法，则直接释放锁</li>
</ul>
<h4 id="_3-分布式锁避免缓存击穿" tabindex="-1"><a class="header-anchor" href="#_3-分布式锁避免缓存击穿"><span>3）分布式锁避免缓存击穿</span></a></h4>
<p>下边使用分布式锁修改查询课程信息的接口。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>//Redisson分布式锁
public  CoursePublish getCoursePublishCache(Long courseId){
        //查询缓存
        String jsonString = (String) redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
        if(StringUtils.isNotEmpty(jsonString)){
            if(jsonString.equals(&quot;null&quot;)){
                return null;
            }
            CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
            return coursePublish;
        }else{
            //每门课程设置一个锁
            RLock lock = redissonClient.getLock(&quot;coursequerylock:&quot;+courseId);
            //获取锁
            lock.lock();
            try {
                jsonString = (String) redisTemplate.opsForValue().get(&quot;course:&quot; + courseId);
                if(StringUtils.isNotEmpty(jsonString)){
                    CoursePublish coursePublish = JSON.parseObject(jsonString, CoursePublish.class);
                    return coursePublish;
                }
                System.out.println(&quot;=========从数据库查询==========&quot;);
                //从数据库查询
                CoursePublish coursePublish = getCoursePublish(courseId);
                redisTemplate.opsForValue().set(&quot;course:&quot; + courseId, JSON.toJSONString(coursePublish),1,TimeUnit.DAYS);
                return coursePublish;
            }finally {
                //释放锁
                lock.unlock();
            }
        }


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>启动多个内容管理服务实例，使用JMeter压力测试，只有一个实例查询一次数据库。</p>
<p>测试Redisson自动续期功能。</p>
<p>在查询数据库处添加休眠，观察锁是否会自动续期。</p>
<div class="language-JavaScript line-numbers-mode" data-ext="JavaScript" data-title="JavaScript"><pre v-pre class="language-JavaScript"><code>try {
    Thread.sleep(60000);
} catch (InterruptedException e) {
    throw new RuntimeException(e);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


