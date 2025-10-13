import comp from "F:/code_lib/BlogWeb/chuoer47.github.io/src/.vuepress/.temp/pages/posts/项目/skytakeout/index.html.vue"
const data = JSON.parse("{\"path\":\"/posts/%E9%A1%B9%E7%9B%AE/skytakeout/\",\"title\":\"苍穹外卖\",\"lang\":\"zh-CN\",\"frontmatter\":{\"title\":\"苍穹外卖\",\"date\":\"2024-06-05T16:24:22.000Z\",\"tags\":\"项目\",\"category\":\"苍穹外卖\",\"icon\":\"/img/外卖.svg\",\"description\":\"苍穹外卖 本项目是使用 Spring Boot 框架开发的一个在线外卖订购系统。 技术栈 SpringBoot+MyBatis+MySQL+Redis+JWT 实现功能 管理端实现员工，菜品，订单管理，来单提醒以及数据统计等功能； 用户端实现购物车，订单下单与催单等功能。 实现优惠券秒杀功能（待完成） 项目亮点 使用JWT令牌技术并自定义拦截器完成用户...\",\"gitInclude\":[],\"head\":[[\"meta\",{\"property\":\"og:url\",\"content\":\"https://mister-hope.github.io/posts/%E9%A1%B9%E7%9B%AE/skytakeout/\"}],[\"meta\",{\"property\":\"og:site_name\",\"content\":\"chuoer47\"}],[\"meta\",{\"property\":\"og:title\",\"content\":\"苍穹外卖\"}],[\"meta\",{\"property\":\"og:description\",\"content\":\"苍穹外卖 本项目是使用 Spring Boot 框架开发的一个在线外卖订购系统。 技术栈 SpringBoot+MyBatis+MySQL+Redis+JWT 实现功能 管理端实现员工，菜品，订单管理，来单提醒以及数据统计等功能； 用户端实现购物车，订单下单与催单等功能。 实现优惠券秒杀功能（待完成） 项目亮点 使用JWT令牌技术并自定义拦截器完成用户...\"}],[\"meta\",{\"property\":\"og:type\",\"content\":\"article\"}],[\"meta\",{\"property\":\"og:locale\",\"content\":\"zh-CN\"}],[\"meta\",{\"property\":\"article:author\",\"content\":\"chuoer47\"}],[\"meta\",{\"property\":\"article:published_time\",\"content\":\"2024-06-05T16:24:22.000Z\"}],[\"script\",{\"type\":\"application/ld+json\"},\"{\\\"@context\\\":\\\"https://schema.org\\\",\\\"@type\\\":\\\"Article\\\",\\\"headline\\\":\\\"苍穹外卖\\\",\\\"image\\\":[\\\"\\\"],\\\"datePublished\\\":\\\"2024-06-05T16:24:22.000Z\\\",\\\"dateModified\\\":null,\\\"author\\\":[{\\\"@type\\\":\\\"Person\\\",\\\"name\\\":\\\"chuoer47\\\"}]}\"]]},\"headers\":[{\"level\":2,\"title\":\"技术栈\",\"slug\":\"技术栈\",\"link\":\"#技术栈\",\"children\":[]},{\"level\":2,\"title\":\"实现功能\",\"slug\":\"实现功能\",\"link\":\"#实现功能\",\"children\":[]},{\"level\":2,\"title\":\"项目亮点\",\"slug\":\"项目亮点\",\"link\":\"#项目亮点\",\"children\":[]}],\"readingTime\":{\"minutes\":0.96,\"words\":288},\"filePathRelative\":\"posts/项目/skytakeout/README.md\",\"localizedDate\":\"2024年6月6日\",\"excerpt\":\"<!--more--->\\n<h1>苍穹外卖</h1>\\n<p>本项目是使用 Spring Boot 框架开发的一个在线外卖订购系统。</p>\\n<h2>技术栈</h2>\\n<p>SpringBoot+MyBatis+MySQL+Redis+JWT</p>\\n<h2>实现功能</h2>\\n<p>管理端实现员工，菜品，订单管理，来单提醒以及数据统计等功能；</p>\\n<p>用户端实现购物车，订单下单与催单等功能。</p>\\n<p>实现优惠券秒杀功能（待完成）</p>\\n<h2>项目亮点</h2>\\n<ul>\\n<li>使用JWT令牌技术并自定义拦截器完成用户认证，并使用ThreadLocal配合拦截器进行Token的校验。</li>\\n<li>使用SpringCache+Redis缓存菜品与套餐数据，增加查询效率并保持数据一致性，将响应时间从140ms降低至30ms。</li>\\n<li>使用SpringTask实现订单状态定时处理，超时订单自动取消。</li>\\n<li>基于WebSocket与前端通信实现来单提醒以及催单功能。</li>\\n<li>基于AOP实现公共字段(例如更新时间)的自动填充，减少代码降低耦合。</li>\\n<li>使用Nginx作为HTTP服务器，部署反向代理以及负载均衡。</li>\\n</ul>\",\"autoDesc\":true}")
export { comp, data }

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
  if (__VUE_HMR_RUNTIME__.updatePageData) {
    __VUE_HMR_RUNTIME__.updatePageData(data)
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(({ data }) => {
    __VUE_HMR_RUNTIME__.updatePageData(data)
  })
}
