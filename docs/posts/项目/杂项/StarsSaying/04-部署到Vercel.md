---
title: 部署到 Vercel
order: 3
---

# 部署到 Vercel

这个项目是标准的 Next.js 应用,Vercel 是官方推荐也是我实际使用的部署平台:免费额度足够个人项目,自动识别 Next.js,每次 push 自动构建发布。

## 本地跑起来

```bash
git clone https://github.com/chuoer47/stars-saying.git
cd stars-saying
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`。

**不配置任何密钥也能运行**:随机探索的人设生成和聊天会使用本地兜底回复。要让大模型生效,在 `.env` 里配上任一 provider 的 Key 即可(见下文环境变量表)。

发布前先做一次生产构建检查:

```bash
npm run build
npm run start
```

## GitHub + Vercel 部署流程

### 方式一:Dashboard 导入(推荐第一次用)

1. 把项目 push 到 GitHub
2. 打开 [vercel.com](https://vercel.com),用 GitHub 账号登录
3. 点 **Add New → Project**,选择 **Import Git Repository**,找到你的仓库
4. Framework Preset 会自动识别为 **Next.js**,保持默认(不用改 Build Command 和 Output Directory)
5. 展开 **Environment Variables**,把需要的变量填进去(见下一节)
6. 点 **Deploy**

之后每次 `git push`,Vercel 自动构建部署,PR 会得到独立的预览 URL。

### 方式二:Vercel CLI

如果服务器环境比较老(比如系统 Node 是 18,而新版 Vercel CLI 需要 Node 20),可以用 `npx` 临时拉起 Node 20 执行:

```bash
npx -y -p node@20 -p vercel@latest vercel login
npx -y -p node@20 -p vercel@latest vercel link --yes --project stars-saying
npx -y -p node@20 -p vercel@latest vercel --prod --yes
```

`-p node@20` 会临时安装 Node 20 运行环境,不污染系统;`vercel link` 把当前目录关联到远端项目;`vercel --prod` 直接部署到生产环境。CLI 方式适合不想开浏览器的服务器环境。

## 环境变量

在 Vercel 的 **Project Settings → Environment Variables** 中配置:

| 变量 | 必要性 | 说明 |
|------|--------|------|
| `KAFU_LLM_API_KEY` | 可选 | 阿里云 DashScope API Key(首选 provider) |
| `KAFU_LLM_BASE_URL` | 可选 | DashScope 兼容端点,默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `KAFU_CHAT_MODEL` | 可选 | 聊天模型,默认 `qwen3-max` |
| `OPENAI_API_KEY` | 可选 | OpenAI 兼容兜底 Key |
| `OPENAI_BASE_URL` | 可选 | 任意 OpenAI 兼容端点 |
| `OPENAI_MODEL` | 可选 | 默认 `gpt-4o-mini` |
| `NASA_API_KEY` | 可选 | NASA API Key,未配置时用 `DEMO_KEY`(限流较严,建议申请) |
| `SETTINGS_PASSWORD` | **强烈建议** | `/admin` 管理后台密码,不设则设置区无法解锁 |

provider 的选择是自动的:有 DashScope Key 用 DashScope,否则看 OpenAI,都没有则纯本地兜底运行。

## 部署后检查清单

- 依次访问 `/`、`/chat`、`/explore`、`/memory`、`/library`、`/classroom`、`/wish`、`/wish-wall`,确认路由正常
- `/admin` 应该要求输入密码后才显示内部页面
- 在 `/settings` 确认密钥只显示脱敏信息或状态(已配置/未配置),不出现明文
- 不配置模型 Key 时,确认探索和聊天走的是本地兜底内容而不是报错

## 安全注意

- **不要把 `.env` 提交进仓库**。如果不小心把密钥 push 到了公开位置,立即去平台轮换 Key
- 公开部署前**必须**设置非默认的 `SETTINGS_PASSWORD`
- 模型和 NASA API 调用保持在服务端,确认密钥不会出现在客户端 JavaScript bundle 里

## 停止服务

Vercel 部署不是常驻进程,不产生持续费用。要彻底下线,删除项目即可:

```bash
npx -y -p node@20 -p vercel@latest vercel project remove stars-saying
```

也可以在 Vercel Dashboard 的 Project Settings → General 里删除。
