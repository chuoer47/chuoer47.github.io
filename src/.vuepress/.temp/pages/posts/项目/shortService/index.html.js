import comp from "F:/code_lib/BlogWeb/weiruyi.github.io-main/src/.vuepress/.temp/pages/posts/项目/shortService/index.html.vue"
const data = JSON.parse("{\"path\":\"/posts/%E9%A1%B9%E7%9B%AE/shortService/\",\"title\":\"短链接系统\",\"lang\":\"zh-CN\",\"frontmatter\":{\"title\":\"短链接系统\",\"date\":\"2024-12-24T16:24:22.000Z\",\"tags\":\"项目\",\"category\":\"短链接系统\",\"icon\":\"/img/link.svg\",\"description\":\"短链接系统 用户可以将长 URL 转换为短链接，并能够根据短链接快速跳转到原始 URL,仓库地址 技术栈 Go, Gin, Redis, MySQL, TDDL, 布隆过滤器 项目亮点 使用TDDL序列实现分布式唯一 ID 生成器,能在满足高并发的同时保证ID的唯一性 使用 Redis 缓存短链接映射数据，减少数据库查询次数，提升系统性能 引入布隆过滤...\",\"gitInclude\":[]},\"headers\":[{\"level\":2,\"title\":\"技术栈\",\"slug\":\"技术栈\",\"link\":\"#技术栈\",\"children\":[]},{\"level\":2,\"title\":\"项目亮点\",\"slug\":\"项目亮点\",\"link\":\"#项目亮点\",\"children\":[]},{\"level\":2,\"title\":\"时序流程\",\"slug\":\"时序流程\",\"link\":\"#时序流程\",\"children\":[]},{\"level\":2,\"title\":\"模块设计\",\"slug\":\"模块设计\",\"link\":\"#模块设计\",\"children\":[]}],\"readingTime\":{\"minutes\":11.17,\"words\":3351},\"filePathRelative\":\"posts/项目/shortService/README.md\",\"localizedDate\":\"2024年12月25日\",\"excerpt\":\"<!--more--->\\n<h1>短链接系统</h1>\\n<p>用户可以将长 URL 转换为短链接，并能够根据短链接快速跳转到原始 URL,<a href=\\\"\\\">仓库地址</a></p>\\n<h2>技术栈</h2>\\n<p>Go, Gin, Redis, MySQL, TDDL, 布隆过滤器</p>\\n<h2>项目亮点</h2>\\n<ul>\\n<li>使用TDDL序列实现分布式唯一 ID 生成器,能在满足高并发的同时保证ID的唯一性</li>\\n<li>使用 Redis 缓存短链接映射数据，减少数据库查询次数，提升系统性能</li>\\n<li>引入布隆过滤器来防止缓存穿透，减少不必要的数据库访问</li>\\n<li>使用令牌桶算法限流，对短链接的生成与访问进行限流,防止恶意刷短链接，保证服务的稳定性</li>\\n</ul>\",\"autoDesc\":true}")
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
