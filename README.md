# chuoer47.github.io

<p align="center">
  <strong>一个基于 VuePress Theme Hope 的个人博客源码仓库</strong>
</p>

<p align="center">
  <a href="https://chuoer47.github.io">在线访问</a>
  ·
  <a href="https://github.com/chuoer47/chuoer47.github.io">GitHub 仓库</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VuePress-2.0.0--rc.9-3eaf7c?style=for-the-badge" alt="VuePress">
  <img src="https://img.shields.io/badge/Theme-Hope-1f6feb?style=for-the-badge" alt="Theme Hope">
  <img src="https://img.shields.io/badge/Package%20Manager-pnpm%209-f69220?style=for-the-badge" alt="pnpm">
  <img src="https://img.shields.io/badge/Deploy-GitHub%20Pages-222222?style=for-the-badge" alt="GitHub Pages">
</p>

---

## 项目简介

这个仓库是博客的**源码仓库**，不是静态产物仓库。

当前站点采用：

- `VuePress 2` 作为文档与博客框架
- `vuepress-theme-hope` 作为主题
- `GitHub Actions + GitHub Pages` 自动构建与发布
- `source` 作为唯一维护分支

---

## 仓库结构

```text
.
├─ .github/workflows/pages.yml     # GitHub Pages 自动发布工作流
├─ deploy.sh                       # 本地构建辅助脚本（macOS / Linux）
├─ deploy.bat                      # 本地构建辅助脚本（Windows）
├─ package.json                    # 项目脚本与依赖
└─ src
   ├─ README.md                    # 站点首页
   ├─ .vuepress
   │  ├─ config.ts                 # VuePress 站点基础配置
   │  ├─ theme.ts                  # 主题、仓库信息、评论、插件配置
   │  ├─ navbar.ts                 # 顶部导航栏
   │  ├─ sidebar.ts                # 侧边栏
   │  └─ public                    # 静态资源
   │     ├─ img                    # 图标、首页素材
   │     └─ image                  # 文章配图
   └─ posts                        # 博客正文
```

---

## 技术与发布方式

| 项目 | 说明 |
| --- | --- |
| 开发框架 | VuePress 2 |
| 主题 | `vuepress-theme-hope` |
| 文章目录 | `src/posts` |
| 首页入口 | `src/README.md` |
| 导航配置 | `src/.vuepress/navbar.ts` |
| 侧边栏配置 | `src/.vuepress/sidebar.ts` |
| 静态资源 | `src/.vuepress/public` |
| 发布分支 | `source` |
| 自动部署 | 推送到 `source` 后由 GitHub Actions 自动发布 |

当前自动发布逻辑：

1. 推送代码到 `source`
2. GitHub Actions 执行 [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)
3. Actions 安装依赖并运行 `pnpm run docs:build`
4. 构建产物从 `src/.vuepress/dist` 发布到 GitHub Pages

---

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 本地启动

```bash
pnpm run docs:dev
```

如需清理缓存后再启动：

```bash
pnpm run docs:clean-dev
```

### 3. 本地构建

```bash
pnpm run docs:build
```

也可以使用辅助脚本：

```bash
sh ./deploy.sh
```

Windows:

```bat
deploy.bat
```

---

## 后续发布流程

以后更新博客，建议固定走下面这套流程：

### 日常发布步骤

```bash
git switch source
git pull --ff-only origin source
pnpm install
pnpm run docs:dev
```

本地确认无误后：

```bash
pnpm run docs:build
git add .
git commit -m "docs: update blog content"
git push origin source
```

推送后无需手工上传静态文件，GitHub 会自动发布。

### 推荐习惯

- 所有源码只维护在 `source`
- 不要手工提交 `node_modules`
- 不要手工提交 `src/.vuepress/dist`
- 发布前至少跑一次 `pnpm run docs:build`
- 改导航、侧边栏、首页时，最好本地预览一遍

---

## 如何添加博客文章

### 场景一：往已有栏目里新增文章

比如你要新增一篇 Java 文章，可以放到：

```text
src/posts/后端/Java/你的文章名.md
```

建议文章头部写 Frontmatter：

```md
---
title: Redis 分布式锁
date: 2026-03-27 10:00:00
tags:
  - Redis
  - Java
category:
  - 后端
icon: /img/lock.svg
order: 1
---

# Redis 分布式锁

正文开始。
```

说明：

- `title`：页面标题
- `date`：文章时间
- `tags`：标签
- `category`：分类
- `icon`：文章图标，引用 `public/img` 下资源
- `order`：同目录文章排序，数字越小越靠前

如果只是给已有栏目追加文章，且该栏目 `sidebar.ts` 使用的是 `children: "structure"`，通常**不需要手工一个个把文章写进侧边栏**，主题会按目录结构自动生成。

### 场景二：新增一个栏目目录

比如你想在 `工具` 下面新增一个 `Nginx` 专题：

1. 新建目录

```text
src/posts/工具/Nginx/
```

2. 新建该目录首页

```text
src/posts/工具/Nginx/README.md
```

3. 新建这个专题下的正文文章

```text
src/posts/工具/Nginx/01-反向代理.md
src/posts/工具/Nginx/02-负载均衡.md
```

4. 在 `navbar.ts` 中补入口
5. 在 `sidebar.ts` 中补侧边栏规则

---

## 如何修改首页

博客首页文件是：

- [`src/README.md`](./src/README.md)

这里通常维护：

- 站点标题
- Hero 文案
- 背景图
- 首页推荐项目卡片
- Footer 文案

如果你想改首页展示效果，重点看这些字段：

```yaml
home: true
layout: BlogHome
heroText: chuoer47
tagline: I am a slow walker,but I never walk backwards.
bgImage: /img/background.jpg
projects:
```

常见改法：

- 改标题：修改 `heroText`
- 改副标题：修改 `tagline`
- 改背景图：替换 `src/.vuepress/public/img/background.jpg`
- 改项目卡片：修改 `projects`

---

## 如何修改导航栏

顶部导航配置文件：

- [`src/.vuepress/navbar.ts`](./src/.vuepress/navbar.ts)

一个典型导航项长这样：

```ts
{
  text: "工具",
  icon: "/img/tool.svg",
  prefix: "/posts/工具/",
  children: [
    {
      text: "Git",
      icon: "/img/git.svg",
      link: "Git",
    },
  ],
}
```

字段含义：

- `text`：导航显示名称
- `icon`：图标路径
- `prefix`：该组导航统一前缀
- `children`：子菜单
- `link`：最终链接

如果你新增了一个专题目录，通常这里也要补一个入口，不然顶部导航里不会出现。

---

## 如何修改侧边栏

侧边栏配置文件：

- [`src/.vuepress/sidebar.ts`](./src/.vuepress/sidebar.ts)

当前很多目录使用的是：

```ts
{
  text: "Java",
  icon: "/img/java.svg",
  prefix: "Java",
  children: "structure",
}
```

这表示：

- 进入该目录后
- 侧边栏会按文件结构自动展开
- 你只要维护目录和文章文件名即可

如果新建专题，建议沿用同样的模式，维护成本最低。

---

## 如何添加图片、图标和静态资源

### 图标与首页素材

放到：

```text
src/.vuepress/public/img
```

引用方式：

```md
![logo](/img/logo.svg)
```

### 文章配图

放到：

```text
src/.vuepress/public/image
```

建议再按专题继续分目录，例如：

```text
src/.vuepress/public/image/redis/
src/.vuepress/public/image/spring/
src/.vuepress/public/image/project/
```

引用方式：

```md
![redis-lock](/image/redis/lock-flow.png)
```

建议：

- 图标统一放 `img`
- 正文插图统一放 `image`
- 路径统一使用 `/`，不要混用相对路径

---

## 关键配置文件说明

### 站点基础配置

- [`src/.vuepress/config.ts`](./src/.vuepress/config.ts)

这里主要控制：

- 站点标题
- 语言
- 描述
- favicon

### 主题配置

- [`src/.vuepress/theme.ts`](./src/.vuepress/theme.ts)

这里主要控制：

- 仓库地址
- `docsBranch: "source"`
- 博客信息
- 评论系统 Waline
- Markdown 增强能力

### 发布工作流

- [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)

这里定义了：

- 监听 `source` 分支推送
- Node.js 和 pnpm 环境
- 执行构建
- 自动部署到 GitHub Pages

---

## 常用命令速查

```bash
pnpm install
pnpm run docs:dev
pnpm run docs:clean-dev
pnpm run docs:build
pnpm run docs:pull
git push origin source
```

---

## 维护建议

- 优先保持目录结构清晰，不要把所有文章堆在同一层
- 新专题先建 `README.md`，再补正文
- `navbar.ts` 管顶部入口，`sidebar.ts` 管栏目内部导航
- 图片命名尽量语义化，方便后续维护
- 大改结构前先本地跑一遍 `pnpm run docs:build`
- 如果评论或 Pages 出问题，优先检查 `theme.ts` 和 Actions 日志

---