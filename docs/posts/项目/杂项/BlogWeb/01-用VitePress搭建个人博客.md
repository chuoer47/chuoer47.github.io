---
title: 用 VitePress 搭建个人博客
order: 1
---

# 用 VitePress 搭建个人博客

这个博客(chuoer47.github.io)是用 **VitePress + GitHub Pages + GitHub Actions** 搭的。本文复盘完整的搭建过程:从零初始化、目录组织、自动侧边栏、CI 自动部署,到日常怎么加一篇新文章。

**为什么选 VitePress**:

- 静态站点,构建产物是纯 HTML,免费托管在 GitHub Pages 上,没有服务器、没有数据库、没有安全问题
- Markdown 原生,Vue 团队出品,代码高亮、行号、目录大纲都是内置的
- 写技术博客最需要的"贴代码"体验开箱即用
- 写文章只需要丢一个 `.md` 文件进目录,侧边栏、路由全自动生成

整体架构一句话:**本地写 Markdown → push 到 GitHub → Actions 构建并发布到 Pages**。全流程 Git 仓库即博客。

## 一、初始化项目

```bash
mkdir my-blog && cd my-blog
npm init -y
npm install -D vitepress vue
```

`package.json` 中的 scripts:

```json
{
  "name": "my-blog",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "vitepress": "^1.6.4",
    "vue": "^3.4.27"
  }
}
```

三个命令分别对应:本地开发(热更新)、构建产物到 `docs/.vitepress/dist/`、本地预览构建结果。

然后建立目录骨架:

```
my-blog/
├── docs/
│   ├── index.md          # 首页
│   ├── posts/            # 所有博客文章放这里
│   │   └── 分类名/
│   │       └── 文章.md
│   └── .vitepress/
│       ├── config.ts     # 站点与主题配置
│       └── theme/        # 主题定制(可选)
│       └── cache/ dist/  # 构建缓存与产物,gitignore
├── .github/workflows/pages.yml
├── package.json
└── .gitignore
```

`.gitignore` 至少要排除:

```
node_modules
docs/.vitepress/cache
docs/.vitepress/dist
```

## 二、首页

VitePress 提供 `home` 布局,`docs/index.md`:

```yaml
---
layout: home

hero:
  name: "YourName"
  text: "个人技术博客"
  tagline: 你的签名
  actions:
    - theme: brand
      text: 开始阅读
      link: /posts/
    - theme: alt
      text: GitHub
      link: https://github.com/yourname

features:
  - title: 分类一
    details: 一句话描述
    link: /posts/分类一/
  - title: 分类二
    details: 一句话描述
    link: /posts/分类二/
---
```

`features` 会在首页渲染成一排卡片,每张卡片直接链接到对应分类目录。

## 三、文章与 frontmatter 约定

每篇文章就是 `docs/posts/` 下的一个 Markdown 文件,头部用 YAML frontmatter 声明元信息:

```yaml
---
title: Flash Attention
order: 9
---

# Flash Attention

正文……
```

- `title`:侧边栏和浏览器标签页显示的标题(不写则用文件名)
- `order`:同目录下的排序序号(不写则排到最后)

这套约定配合下一节的自动扫描,是"零配置写作"的关键:**建目录、写文件、给 `order`,侧边栏就自动生成,不需要在任何地方注册新文章**。

目录按分类组织,想开新分类就建新目录:

```
docs/posts/
├── 课程笔记/
├── 算法/
├── 前后端/
├── 项目/
└── ...
```

每个分类目录放一个 `index.md`(同样带 frontmatter)作为分类的落地页,可以写一段简介加目录链接。

## 四、自动侧边栏(核心配置)

VitePress 的 `sidebar` 默认要手写,每加一篇文章都要改配置——这对博客不可接受。解决办法是在 `docs/.vitepress/config.ts` 里用 Node API 递归扫描 `docs/posts/`,运行时生成侧边栏:

```ts
import { defineConfig } from "vitepress";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, "..");
const postsRoot = path.resolve(docsRoot, "posts");

type SidebarItem = {
  text: string;
  link?: string;
  collapsed?: boolean;
  items?: SidebarItem[];
};

// 读单个 md 的 order
function getOrder(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^---\s*\n[\s\S]*?^order:\s*(\d+)/m);
    return match ? parseInt(match[1], 10) : Infinity;
  } catch {
    return Infinity;
  }
}

// 读单个 md 的 title
function getTitle(filePath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(
      /^---\s*\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m
    );
    return match ? match[1].trim() : fallback;
  } catch {
    return fallback;
  }
}

// md 路径 → 站点路由
function toLink(filePath: string): string {
  const relPath = path.relative(docsRoot, filePath).replace(/\\/g, "/");
  return `/${relPath}`
    .replace(/(^|\/)(index|README)\.md$/, "$1")
    .replace(/\.md$/, "");
}

function scanDir(dir: string): SidebarItem[] {
  if (!fs.existsSync(dir)) return [];
  const items: SidebarItem[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((file) => !file.startsWith(".") && !file.endsWith(".disabled"));

  // 排序规则:先按 order,目录排在文件前,再按文件名
  files.sort((a, b) => {
    const aOrder = getEntryOrder(dir, a);
    const bOrder = getEntryOrder(dir, b);
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aIsDir = fs.statSync(path.join(dir, a)).isDirectory();
    const bIsDir = fs.statSync(path.join(dir, b)).isDirectory();
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b, "zh-CN");
  });

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // 目录:有 index.md 则以它为标题和链接
      const indexFile = path.join(filePath, "index.md");
      const children = scanDir(filePath);
      if (!children.length && !fs.existsSync(indexFile)) continue;
      items.push({
        text: fs.existsSync(indexFile)
          ? getTitle(indexFile, file)
          : file,
        link: fs.existsSync(indexFile) ? toLink(indexFile) : undefined,
        items: children,
      });
    } else if (file.endsWith(".md") && file !== "index.md" && file !== "README.md") {
      // 普通文章
      items.push({ text: getTitle(filePath, file), link: toLink(filePath) });
    }
  }
  return items;
}

export default defineConfig({
  title: "YourName's Blog",
  description: "个人技术博客",
  ignoreDeadLinks: true,

  markdown: {
    lineNumbers: true,
  },

  themeConfig: {
    outline: { level: [2, 3] },

    nav: [
      { text: "首页", link: "/" },
      { text: "算法", link: "/posts/算法/" },
      // …按你的分类补全
    ],

    // 关键:sidebar 由扫描生成,而不是手写
    sidebar: {
      "/posts/": scanDir(postsRoot),
    },
  },
});
```

这段代码做了几件事:

1. **递归扫描** `docs/posts/` 全部子目录和 md 文件,目录名/文件名完全自由(支持中文)
2. **读取每篇的 frontmatter**,取 `title` 显示、按 `order` 排序
3. **目录自动聚合**:子目录有 `index.md` 就作为分组的落地页,目录天然成为侧边栏的可折叠分组
4. 生成的 sidebar 挂在 `/posts/` 前缀下,首页不显示侧边栏

效果:**磁盘上的目录结构 = 侧边栏结构**。建一个文件夹就是加一个分类,扔一个 md 进去就是加一篇文章,构建时自动全部生效。

## 五、部署:GitHub Pages + Actions

### 仓库与分支

GitHub Pages 用户站点要求仓库名为 `yourname.github.io`。本仓库用两个分支:

| 分支 | 内容 |
|------|------|
| `source` | 源码(默认分支,Markdown + 配置) |
| `gh-pages` | (不需要)Actions 直接部署产物,不占分支 |

平时只在 `source` 上工作,push 即触发部署。

### CI 工作流

`.github/workflows/pages.yml`,push 到 `source` 时自动构建并发布:

```yaml
name: Deploy VitePress Site

on:
  push:
    branches:
      - source
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: npm ci

      - name: Build site
        run: npm run docs:build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

要点:

- 两个 job:`build` 产出 artifact,`deploy` 通过官方 `deploy-pages` action 发布
- `concurrency` 保证同一时刻只有一次部署,重复 push 会取消旧任务

### GitHub 仓库设置

在仓库 **Settings → Pages** 里,Source 选 **GitHub Actions**(而不是 "Deploy from a branch")。这是官方 Actions 部署方式,不用手动管 `gh-pages` 分支。

配置完成后,**每次 push 到 `source`,约一两分钟后线上就是新版**。

## 六、日常写作:加一篇新博客

搭好之后,写博客的完整流程只有四步。

### 1. 建文件

在对应分类目录下新建 md,文件名即路由 slug(建议英文/拼音+连字符):

```bash
# 例:在 AI Infra 下加一个新专题目录,里面放第一章
mkdir -p "docs/posts/AI Infra/my-topic"
```

`docs/posts/AI Infra/my-topic/01-intro.md`:

```markdown
---
title: 简介
order: 1
---

# 简介

正文……
```

新专题目录建议再补一个 `index.md`(`title` + `order` + 简介和目录链接),作为该专题的落地页。如果想在首页 features 或顶部 nav 挂上新分类,改 `docs/index.md` 和 `config.ts` 的 `nav` 即可——这是唯一需要动配置的场景。

### 2. 本地预览

```bash
npm run docs:dev
```

浏览器打开提示的地址(默认 http://localhost:5173),保存即热更新。确认侧边栏出现新文章、排序正确、内部链接可点。

### 3. 提交前构建验证

```bash
npm run docs:build
```

dev 模式对某些问题不敏感(死链、被 Vue 模板引擎误解析的特殊字符等),**push 前跑一次 build 是最可靠的验收**。构建通过再提交。

### 4. 提交并发布

```bash
git add -A
git commit -m "docs(分类名): 新增 xxx"
git push origin clean-source:source
```

push 到 `source` 分支,Actions 自动构建部署,一两分钟后打开 https://yourname.github.io 就是新版。

## 小结

| 需求 | 做法 |
|------|------|
| 加一篇文章 | 分类目录丢一个带 frontmatter 的 md |
| 开一个新分类 | `docs/posts/` 下建目录 + `index.md` |
| 调整排序 | 改 frontmatter 的 `order` |
| 首页/导航入口 | 改 `docs/index.md` 和 `config.ts` |
| 发布 | push 到 `source`,CI 全自动 |

整个系统的核心思路:**让仓库的文件系统成为唯一事实来源**——目录即分类、文件即文章、frontmatter 即元数据,配置文件只负责扫描和呈现,写作时零心智负担。
