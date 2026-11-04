---
title: "Streamlit 部署与实战项目"
date: 2025-01-01
tags: [Python, Streamlit, 部署]
category: 开发
order: 5
---

# Streamlit 部署与实战项目

Streamlit 应用开发完成后，需要将其部署到服务器上供用户访问。本章将介绍多种主流的 Streamlit 部署方案，并通过两个完整的实战项目展示 Streamlit 在真实场景中的应用。

## 1. Streamlit Community Cloud（推荐）

Streamlit Community Cloud 是官方提供的免费托管平台，是部署公开 Streamlit 应用最简单、最快捷的方式。无需服务器，无需 Docker，只需将代码推送到 GitHub 即可一键部署。

### 1.1 准备工作

在部署前，需要确保项目目录结构如下：

```
my-app/
├── app.py                  # 主应用文件
├── requirements.txt        # Python 依赖
├── .streamlit/
│   ├── config.toml         # Streamlit 配置
│   └── secrets.toml        # 本地密钥（不提交到 Git）
└── .gitignore              # Git 忽略文件
```

`requirements.txt` 示例：

```txt
streamlit>=1.37.0
pandas>=2.0.0
plotly>=5.18.0
numpy>=1.24.0
requests>=2.31.0
```

`.gitignore` 文件内容：

```
__pycache__/
*.pyc
*.pyo
.env
.venv/
venv/
*.egg-info/
dist/
build/
.streamlit/secrets.toml
```

`.streamlit/config.toml` 基础配置：

```toml
[theme]
base = "light"
primaryColor = "#FF6B6B"
backgroundColor = "#FFFFFF"
secondaryBackgroundColor = "#F0F2F6"
textColor = "#262730"
font = "sans serif"

[server]
headless = true
enableCORS = false
enableXsrfProtection = true

[browser]
gatherUsageStats = false
```

### 1.2 部署步骤

详细部署流程如下：

1. **将代码推送到 GitHub 公开仓库**

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Streamlit app"
   git remote add origin https://github.com/your-username/your-repo.git
   git branch -M main
   git push -u origin main
   ```

   注意：Community Cloud 目前仅支持公开仓库（Public Repository）。如果需要部署私有仓库，可以考虑使用 Streamlit 的付费方案或其他部署方式。

2. **访问 Streamlit Community Cloud**

   打开浏览器，访问 [share.streamlit.io](https://share.streamlit.io)，使用你的 GitHub 账号进行授权登录。

3. **创建新应用**

   登录后，点击页面右上角的 "New app" 按钮，在弹出的表单中填写以下信息：

   - **Repository**：选择你的 GitHub 仓库（格式为 `username/repo-name`）
   - **Branch**：选择部署的分支（通常为 `main`）
   - **Main file path**：主文件路径（通常为 `app.py` 或 `streamlit_app.py`）
   - **App URL**：自定义应用的访问地址（格式为 `your-app-name`）

4. **点击 "Deploy" 按钮**

   点击部署后，Community Cloud 会自动执行以下操作：
   - 克隆你的 GitHub 仓库
   - 安装 `requirements.txt` 中的所有依赖
   - 启动 Streamlit 服务
   - 生成一个公开的访问链接

   首次部署通常需要 2-5 分钟，后续每次推送到 GitHub 会自动触发重新部署。

5. **访问应用**

   部署完成后，你会获得一个类似 `https://your-app-name.streamlit.app` 的访问链接，分享给任何人即可使用。

### 1.3 管理密钥（Secrets）

在实际项目中，通常需要使用 API 密钥、数据库密码等敏感信息。Community Cloud 提供了安全管理这些信息的机制。

**在 Community Cloud 中设置密钥：**

1. 进入应用的管理页面（点击应用右上角的 "Manage app"）
2. 在左侧菜单中选择 "Secrets"
3. 以 TOML 格式添加你的密钥信息：

```toml
[database]
url = "postgresql://user:password@host:5432/dbname"
pool_size = 10

[api]
openai_key = "sk-xxxxx"
anthropic_key = "sk-ant-xxxxx"

[firebase]
project_id = "my-project-12345"
```

**在代码中访问密钥：**

```python
import streamlit as st

# 访问嵌套的密钥
db_url = st.secrets["database"]["url"]
openai_key = st.secrets["api"]["openai_key"]

# 也可以使用点号语法访问
db_url = st.secrets.database.url

# 在数据库连接中使用
import psycopg2
conn = psycopg2.connect(db_url)
```

**本地开发时的密钥管理：**

在本地开发时，创建 `.streamlit/secrets.toml` 文件（务必加入 `.gitignore`，不要提交到版本控制）：

```toml
# .streamlit/secrets.toml（本地开发用，不要提交到 Git）
[database]
url = "postgresql://localhost:5432/mydb"

[api]
openai_key = "sk-local-dev-key"
```

这样代码在本地和云端都可以通过 `st.secrets` 统一访问密钥，无需修改代码。

### 1.4 常见问题与注意事项

| 问题 | 解决方案 |
|------|---------|
| 应用部署后显示空白页面 | 检查 `app.py` 是否有语法错误，查看应用日志 |
| 依赖安装失败 | 确保 `requirements.txt` 中的包名和版本号正确 |
| 应用运行缓慢 | 使用 `@st.cache_data` 缓存数据加载和计算 |
| 密钥无法访问 | 确认在 Community Cloud 的 Secrets 中正确配置了 TOML 格式的密钥 |
| 自定义域名 | Community Cloud 暂不支持自定义域名，可考虑使用 Docker 部署配合 Nginx |
| 内存超限 | 免费版限制为 1GB 内存，优化数据处理或考虑付费方案 |

## 2. Docker 部署

Docker 部署适合需要完全控制部署环境、或需要部署到自有服务器的场景。通过 Docker，可以确保应用在任何环境中都能以一致的方式运行。

### 2.1 Dockerfile 编写

创建一个优化的 `Dockerfile`：

```dockerfile
# 使用 Python 3.11 slim 镜像作为基础
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV STREAMLIT_SERVER_PORT=8501
ENV STREAMLIT_SERVER_ADDRESS=0.0.0.0
ENV STREAMLIT_BROWSER_GATHER_USAGE_STATS=false

# 安装系统依赖（如果需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（利用 Docker 缓存层）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建非 root 用户（安全最佳实践）
RUN adduser --disabled-password --gecos '' appuser
USER appuser

# 暴露 Streamlit 默认端口
EXPOSE 8501

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl --fail http://localhost:8501/_stcore/health || exit 1

# 启动命令
ENTRYPOINT ["streamlit", "run", "app.py"]
CMD ["--server.port=8501", "--server.address=0.0.0.0", "--browser.gatherUsageStats=false", "--server.headless=true"]
```

**Dockerfile 关键说明：**

- `PYTHONDONTWRITEBYTECODE=1`：不生成 `.pyc` 文件，减小镜像体积
- `PYTHONUNBUFFERED=1`：确保 Python 输出直接打印到终端，便于日志查看
- 使用 `--no-cache-dir` 安装 pip 包，避免缓存占用空间
- 创建非 root 用户运行应用，提高安全性
- 健康检查用于容器编排系统（如 Docker Compose、Kubernetes）自动检测应用状态

### 2.2 构建与运行

```bash
# 构建 Docker 镜像
docker build -t my-streamlit-app .

# 查看构建的镜像
docker images | grep streamlit

# 运行容器（简单模式）
docker run -d \
  --name streamlit-app \
  -p 8501:8501 \
  my-streamlit-app

# 运行容器（带数据卷挂载和环境变量）
docker run -d \
  --name streamlit-app \
  -p 8501:8501 \
  -v $(pwd)/data:/app/data \
  -e STREAMLIT_SERVER_HEADLESS=true \
  --restart unless-stopped \
  my-streamlit-app

# 查看容器日志
docker logs -f streamlit-app

# 进入容器调试
docker exec -it streamlit-app /bin/bash

# 停止并删除容器
docker stop streamlit-app && docker rm streamlit-app
```

### 2.3 docker-compose.yml

使用 Docker Compose 可以更方便地管理多个服务：

```yaml
version: '3.8'

services:
  streamlit:
    build: .
    container_name: streamlit-app
    ports:
      - "8501:8501"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - STREAMLIT_SERVER_PORT=8501
      - STREAMLIT_SERVER_ADDRESS=0.0.0.0
      - STREAMLIT_SERVER_HEADLESS=true
      - STREAMLIT_BROWSER_GATHER_USAGE_STATS=false
    restart: unless-stopped
    networks:
      - streamlit-network

networks:
  streamlit-network:
    driver: bridge
```

启动和管理：

```bash
# 构建并启动所有服务
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f streamlit

# 停止所有服务
docker-compose down

# 重新构建并启动（代码更新后）
docker-compose up -d --build
```

### 2.4 带 Nginx 反向代理的部署

在生产环境中，通常需要使用 Nginx 作为反向代理，提供 HTTPS 支持、负载均衡和静态文件缓存等功能：

```yaml
services:
  streamlit:
    build: .
    expose:
      - "8501"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    networks:
      - streamlit-network

  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
      - ./nginx-logs:/var/log/nginx
    depends_on:
      - streamlit
    restart: unless-stopped
    networks:
      - streamlit-network

networks:
  streamlit-network:
    driver: bridge
```

`nginx.conf` 配置文件：

```nginx
events {
    worker_connections 1024;
}

http {
    upstream streamlit {
        server streamlit:8501;
    }

    # HTTP → HTTPS 重定向
    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS 配置
    server {
        listen 443 ssl;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        # SSL 安全配置
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://streamlit;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket 支持（Streamlit 需要）
            proxy_read_timeout 86400;
        }

        # 静态文件缓存
        location /static {
            proxy_pass http://streamlit;
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

**Nginx 配置要点：**

- Streamlit 使用 WebSocket 进行实时通信，必须配置 `proxy_set_header Upgrade` 和 `proxy_set_header Connection "upgrade"`
- `proxy_read_timeout` 设置为 86400（24 小时），防止长连接被 Nginx 断开
- 使用 Let's Encrypt 等证书颁发机构获取免费的 SSL 证书

### 2.5 Docker 部署最佳实践

1. **使用多阶段构建**减小镜像体积：

```dockerfile
# 构建阶段
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# 运行阶段
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
EXPOSE 8501
CMD ["streamlit", "run", "app.py"]
```

2. **使用 `.dockerignore`** 排除不需要的文件：

```
.git
.gitignore
__pycache__
*.pyc
.venv
venv
.env
.streamlit/secrets.toml
*.md
tests/
```

3. **合理设置资源限制**：

```bash
docker run -d \
  --name streamlit-app \
  --memory=512m \
  --cpus=1.0 \
  -p 8501:8501 \
  my-streamlit-app
```

## 3. Railway 部署

Railway 是一个现代化的云平台，支持从 GitHub 自动部署，提供免费额度，操作简单。

### 3.1 通过 Railway CLI 部署

```bash
# 1. 安装 Railway CLI
npm i -g @railway/cli

# 2. 登录 Railway
railway login

# 3. 在项目目录中初始化
railway init

# 4. 添加环境变量（可选）
railway variables set DATABASE_URL="postgresql://..." API_KEY="sk-xxx"

# 5. 部署
railway up

# 6. 查看部署日志
railway logs
```

### 3.2 通过 GitHub 连接部署

1. 访问 [railway.app](https://railway.app) 并使用 GitHub 账号登录
2. 点击 "New Project" → "Deploy from GitHub repo"
3. 选择你的仓库
4. Railway 会自动检测 Streamlit 项目并进行部署
5. 在 "Settings" 中配置环境变量和自定义域名

**Railway 部署注意事项：**

- Railway 需要一个启动命令，确保项目根目录有 `Procfile` 或在 Railway 设置中配置启动命令
- 免费额度有限（每月 $5 的使用额度），超出后会暂停服务
- 支持自动 SSL 和自定义域名

`Procfile`（用于 Railway）：

```
web: streamlit run app.py --server.port=$PORT --server.address=0.0.0.0 --server.headless=true
```

## 4. Heroku 部署

Heroku 是老牌的 PaaS 平台，虽然免费额度已取消，但仍然是一个可靠的部署选择。

### 4.1 部署步骤

1. **安装 Heroku CLI 并登录**

   ```bash
   # macOS
   brew tap heroku/brew && brew install heroku

   # 登录
   heroku login
   ```

2. **创建 Heroku 应用**

   ```bash
   heroku create my-streamlit-app
   ```

3. **创建 `Procfile`**

   ```
   web: streamlit run app.py --server.port=$PORT --server.address=0.0.0.0 --server.headless=true
   ```

4. **创建 `runtime.txt`** 指定 Python 版本

   ```
   python-3.11.8
   ```

5. **设置环境变量**

   ```bash
   heroku config:set STREAMLIT_SERVER_HEADLESS=true
   heroku config:set DATABASE_URL="postgresql://..."
   ```

6. **部署**

   ```bash
   git push heroku main
   ```

7. **查看日志**

   ```bash
   heroku logs --tail
   ```

### 4.2 Heroku 注意事项

- Heroku 自动分配 `$PORT` 环境变量，启动命令中必须使用 `$PORT`
- 免费版 dyno 会在 30 分钟无活动后休眠，需要 keep-alive 机制或使用付费版
- 通过 `heroku addons` 可以添加 PostgreSQL、Redis 等附加服务

## 5. 其他部署方案

### 5.1 Streamlit 部署方案对比

| 部署方案 | 费用 | 难度 | 适用场景 | 自动扩展 |
|---------|------|------|---------|---------|
| Community Cloud | 公费 | 简单 | 公开项目、原型演示 | 是 |
| Docker | 取决于服务器 | 中等 | 生产环境、自定义需求 | 需配置 |
| Railway | 有免费额度 | 简单 | 小型项目、快速部署 | 是 |
| Heroku | 付费 | 简单 | 传统 Web 应用 | 是 |
| Vercel | 有免费额度 | 中等 | 前端为主的项目 | 是 |
| AWS/GCP/Azure | 按需付费 | 较难 | 大规模企业应用 | 是 |

### 5.2 Streamlit 应用性能优化

无论使用哪种部署方案，以下优化技巧都能帮助提升应用性能：

1. **使用缓存**：对数据加载和计算密集型操作使用 `@st.cache_data` 或 `@st.cache_resource`

```python
@st.cache_data(ttl=3600)  # 缓存 1 小时
def load_large_dataset():
    # 耗时的数据加载操作
    return pd.read_csv("large_file.csv")

@st.cache_resource
def get_database_connection():
    # 数据库连接池（只需创建一次）
    return create_engine("postgresql://...")
```

2. **减少 rerun**：合理使用 `st.session_state`，避免不必要的页面重载

3. **分页加载**：大数据集使用分页或懒加载

4. **使用 columns 布局**：避免页面过长

5. **压缩数据**：在传输前对数据进行压缩和聚合

## 6. 实战项目：数据分析 Dashboard

本节将构建一个完整的销售数据分析 Dashboard，展示 Streamlit 在数据可视化领域的强大能力。

### 6.1 项目结构

```
sales-dashboard/
├── app.py              # 主应用入口
├── utils.py            # 工具函数
├── data/
│   └── sales.csv       # 销售数据（或生成示例数据）
├── requirements.txt    # 依赖列表
├── Dockerfile          # Docker 部署文件
├── .streamlit/
│   ├── config.toml     # Streamlit 配置
│   └── secrets.toml    # 本地密钥（不提交 Git）
└── .gitignore
```

### 6.2 工具函数模块

`utils.py`：

```python
"""数据处理和辅助函数模块"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta


def generate_sample_data(days: int = 365) -> pd.DataFrame:
    """生成模拟销售数据"""
    np.random.seed(42)
    dates = pd.date_range(end=datetime.now(), periods=days, freq="D")

    regions = ["华东", "华南", "华北", "西部", "海外"]
    products = ["A-基础版", "B-专业版", "C-企业版"]
    channels = ["线上", "线下", "合作伙伴"]

    n_records = days * 10  # 每天约 10 条记录

    return pd.DataFrame({
        "日期": np.random.choice(dates, n_records),
        "销售额": np.random.exponential(scale=5000, size=n_records).round(2),
        "订单数": np.random.poisson(lam=5, size=n_records) + 1,
        "地区": np.random.choice(regions, n_records, p=[0.3, 0.25, 0.2, 0.15, 0.1]),
        "产品线": np.random.choice(products, n_records, p=[0.5, 0.3, 0.2]),
        "渠道": np.random.choice(channels, n_records, p=[0.5, 0.3, 0.2]),
        "客户类型": np.random.choice(["新客户", "老客户"], n_records, p=[0.3, 0.7]),
    })


def calculate_kpis(df: pd.DataFrame, df_all: pd.DataFrame) -> dict:
    """计算 KPI 指标"""
    total_sales = df["销售额"].sum()
    total_orders = df["订单数"].sum()
    avg_order_value = total_sales / total_orders if total_orders > 0 else 0
    daily_avg = df.groupby("日期")["销售额"].sum().mean()

    # 对比全量数据计算增长率
    all_sales = df_all["销售额"].sum()
    growth_rate = ((total_sales / all_sales) - 1) * 100 if all_sales > 0 else 0

    return {
        "total_sales": total_sales,
        "total_orders": total_orders,
        "avg_order_value": avg_order_value,
        "daily_avg": daily_avg,
        "growth_rate": growth_rate,
    }


def format_currency(value: float) -> str:
    """格式化货币显示"""
    if value >= 10000:
        return f"¥{value / 10000:,.1f}万"
    return f"¥{value:,.0f}"


def format_number(value: int) -> str:
    """格式化数字显示"""
    if value >= 10000:
        return f"{value / 10000:,.1f}万"
    return f"{value:,}"
```

### 6.3 完整的应用代码

`app.py`：

```python
"""
销售数据分析 Dashboard
一个完整的 Streamlit 数据可视化应用示例
"""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from utils import generate_sample_data, calculate_kpis, format_currency, format_number

# ==================== 页面配置 ====================
st.set_page_config(
    page_title="销售数据分析 Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# 自定义 CSS 样式
st.markdown("""
<style>
    .main > div {
        padding-top: 1rem;
    }
    .stMetric {
        background-color: #f0f2f6;
        padding: 1rem;
        border-radius: 0.5rem;
        border-left: 4px solid #FF6B6B;
    }
    .stMetric label {
        font-size: 0.9rem !important;
        color: #666;
    }
    .stMetric [data-testid="stMetricValue"] {
        font-size: 1.5rem !important;
        font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# ==================== 数据加载 ====================
@st.cache_data(ttl=300)  # 缓存 5 分钟
def load_data():
    """加载销售数据"""
    return generate_sample_data(days=365)

df_all = load_data()

# ==================== 侧边栏筛选 ====================
with st.sidebar:
    st.header("🔍 筛选条件")
    st.divider()

    # 日期范围筛选
    date_range = st.date_input(
        "📅 日期范围",
        value=(df_all["日期"].min(), df_all["日期"].max()),
        min_value=df_all["日期"].min(),
        max_value=df_all["日期"].max(),
    )

    # 地区筛选
    regions = st.multiselect(
        "🗺️ 地区",
        options=df_all["地区"].unique(),
        default=df_all["地区"].unique(),
    )

    # 产品线筛选
    products = st.multiselect(
        "📦 产品线",
        options=df_all["产品线"].unique(),
        default=df_all["产品线"].unique(),
    )

    # 渠道筛选
    channels = st.multiselect(
        "🏪 渠道",
        options=df_all["渠道"].unique(),
        default=df_all["渠道"].unique(),
    )

    # 客户类型筛选
    customer_type = st.multiselect(
        "👤 客户类型",
        options=df_all["客户类型"].unique(),
        default=df_all["客户类型"].unique(),
    )

    st.divider()
    st.caption("💡 数据为模拟数据，仅供参考")

# 应用筛选条件
filtered = df_all[
    (df_all["日期"].between(pd.Timestamp(date_range[0]), pd.Timestamp(date_range[1])))
    & (df_all["地区"].isin(regions))
    & (df_all["产品线"].isin(products))
    & (df_all["渠道"].isin(channels))
    & (df_all["客户类型"].isin(customer_type))
]

# ==================== 主页面 ====================
st.title("📊 销售数据分析 Dashboard")

# KPI 指标卡片
kpis = calculate_kpis(filtered, df_all)

col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric(
        label="💰 总销售额",
        value=format_currency(kpis["total_sales"]),
        delta=f"{kpis['growth_rate']:+.1f}%",
    )
with col2:
    st.metric(
        label="📋 总订单数",
        value=format_number(kpis["total_orders"]),
    )
with col3:
    st.metric(
        label="📈 日均销售额",
        value=format_currency(kpis["daily_avg"]),
    )
with col4:
    st.metric(
        label="🎯 平均客单价",
        value=format_currency(kpis["avg_order_value"]),
    )

st.divider()

# ==================== 可视化图表 ====================
tab1, tab2, tab3, tab4 = st.tabs([
    "📈 趋势分析",
    "🗺️ 地区分析",
    "📦 产品分析",
    "🏪 渠道分析",
])

with tab1:
    st.subheader("销售趋势分析")

    # 按日期聚合
    daily = filtered.groupby("日期").agg({
        "销售额": "sum",
        "订单数": "sum"
    }).reset_index().sort_values("日期")

    # 计算 7 日移动平均
    daily["销售额_7日均线"] = daily["销售额"].rolling(window=7).mean()

    # 双轴图表：销售额（折线）+ 订单数（柱状）
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    fig.add_trace(
        go.Scatter(
            x=daily["日期"],
            y=daily["销售额"],
            name="日销售额",
            mode="lines",
            line=dict(color="#FF6B6B", width=1.5),
            opacity=0.7,
        ),
        secondary_y=False,
    )

    fig.add_trace(
        go.Scatter(
            x=daily["日期"],
            y=daily["销售额_7日均线"],
            name="7日移动均线",
            mode="lines",
            line=dict(color="#4ECDC4", width=2.5, dash="dash"),
        ),
        secondary_y=False,
    )

    fig.add_trace(
        go.Bar(
            x=daily["日期"],
            y=daily["订单数"],
            name="日订单数",
            marker_color="rgba(100, 149, 237, 0.3)",
        ),
        secondary_y=True,
    )

    fig.update_layout(
        title="销售趋势（日度）",
        xaxis_title="日期",
        legend=dict(x=0, y=1.12, orientation="h"),
        hovermode="x unified",
        height=500,
    )
    fig.update_yaxes(title_text="销售额（元）", secondary_y=False)
    fig.update_yaxes(title_text="订单数", secondary_y=True)

    st.plotly_chart(fig, use_container_width=True)

    # 月度汇总表格
    st.subheader("月度销售汇总")
    monthly = filtered.copy()
    monthly["月份"] = monthly["日期"].dt.to_period("M").astype(str)
    monthly_summary = monthly.groupby("月份").agg({
        "销售额": ["sum", "mean", "std"],
        "订单数": "sum",
    }).round(2)
    monthly_summary.columns = ["总销售额", "日均销售额", "标准差", "总订单数"]
    monthly_summary = monthly_summary.reset_index()

    st.dataframe(monthly_summary, use_container_width=True)

with tab2:
    st.subheader("地区销售分析")

    region_data = filtered.groupby("地区").agg({
        "销售额": "sum",
        "订单数": "sum",
    }).reset_index().sort_values("销售额", ascending=False)

    col1, col2 = st.columns(2)

    with col1:
        # 饼图：地区销售额占比
        fig_pie = px.pie(
            region_data,
            values="销售额",
            names="地区",
            title="地区销售额占比",
            hole=0.4,
            color_discrete_sequence=px.colors.qualitative.Set2,
        )
        fig_pie.update_traces(textposition="inside", textinfo="percent+label")
        st.plotly_chart(fig_pie, use_container_width=True)

    with col2:
        # 柱状图：地区销售额排名
        fig_bar = px.bar(
            region_data,
            x="销售额",
            y="地区",
            orientation="h",
            color="地区",
            title="地区销售额排名",
            color_discrete_sequence=px.colors.qualitative.Set2,
        )
        fig_bar.update_layout(showlegend=False)
        st.plotly_chart(fig_bar, use_container_width=True)

    # 地区趋势对比
    st.subheader("各地区月度趋势")
    region_monthly = filtered.copy()
    region_monthly["月份"] = region_monthly["日期"].dt.to_period("M").astype(str)
    region_trend = region_monthly.groupby(["月份", "地区"])["销售额"].sum().reset_index()

    fig_line = px.line(
        region_trend,
        x="月份",
        y="销售额",
        color="地区",
        title="各地区月度销售趋势",
        color_discrete_sequence=px.colors.qualitative.Set2,
    )
    st.plotly_chart(fig_line, use_container_width=True)

with tab3:
    st.subheader("产品线分析")

    product_data = filtered.groupby("产品线").agg({
        "销售额": "sum",
        "订单数": "mean",
    }).reset_index()

    col1, col2 = st.columns(2)

    with col1:
        # 产品线销售额
        fig_product = px.bar(
            product_data,
            x="产品线",
            y="销售额",
            color="产品线",
            title="各产品线销售额",
            text="销售额",
        )
        fig_product.update_traces(texttemplate="%{text:,.0f}", textposition="outside")
        st.plotly_chart(fig_product, use_container_width=True)

    with col2:
        # 产品线平均客单价
        product_data["平均客单价"] = product_data["销售额"] / product_data["订单数"]
        fig_aov = px.bar(
            product_data,
            x="产品线",
            y="平均客单价",
            color="产品线",
            title="各产品线平均客单价",
            text="平均客单价",
        )
        fig_aov.update_traces(texttemplate="¥%{text:,.0f}", textposition="outside")
        st.plotly_chart(fig_aov, use_container_width=True)

    # 产品线堆叠面积图
    st.subheader("产品线销售趋势")
    product_trend = filtered.copy()
    product_trend["月份"] = product_trend["日期"].dt.to_period("M").astype(str)
    product_trend = product_trend.groupby(["月份", "产品线"])["销售额"].sum().reset_index()

    fig_area = px.area(
        product_trend,
        x="月份",
        y="销售额",
        color="产品线",
        title="产品线月度销售趋势（堆叠面积图）",
    )
    st.plotly_chart(fig_area, use_container_width=True)

with tab4:
    st.subheader("渠道分析")

    channel_data = filtered.groupby("渠道").agg({
        "销售额": "sum",
        "订单数": "sum",
    }).reset_index()

    col1, col2 = st.columns(2)

    with col1:
        # 渠道占比（环形图）
        fig_channel_pie = px.pie(
            channel_data,
            values="销售额",
            names="渠道",
            title="渠道销售额占比",
            hole=0.5,
        )
        st.plotly_chart(fig_channel_pie, use_container_width=True)

    with col2:
        # 渠道-地区交叉分析
        cross_data = filtered.groupby(["渠道", "地区"])["销售额"].sum().reset_index()
        fig_heatmap = px.density_heatmap(
            cross_data,
            x="渠道",
            y="地区",
            z="销售额",
            title="渠道 × 地区 销售热力图",
            color_continuous_scale="YlOrRd",
        )
        st.plotly_chart(fig_heatmap, use_container_width=True)

# ==================== 数据明细 ====================
st.divider()
with st.expander("📋 查看原始数据明细", expanded=False):
    st.dataframe(
        filtered.sort_values("日期", ascending=False),
        use_container_width=True,
        height=400,
    )

    # 数据下载
    csv = filtered.to_csv(index=False).encode("utf-8-sig")
    st.download_button(
        label="📥 下载 CSV 文件",
        data=csv,
        file_name=f"sales_data_{pd.Timestamp.now().strftime('%Y%m%d')}.csv",
        mime="text/csv",
    )

# ==================== 页脚 ====================
st.divider()
st.caption("Built with Streamlit | Data is simulated for demonstration purposes")
```

### 6.4 运行与部署

```bash
# 安装依赖
pip install -r requirements.txt

# 本地运行
streamlit run app.py

# 使用 Docker 部署
docker build -t sales-dashboard .
docker run -d -p 8501:8501 sales-dashboard

# 部署到 Community Cloud
# 将代码推送到 GitHub 公开仓库，然后在 share.streamlit.io 部署
```

## 7. 实战项目：AI 聊天机器人界面

本节将构建一个聊天机器人界面，展示 Streamlit 在构建对话式 AI 应用方面的能力。

### 7.1 项目结构

```
chatbot-app/
├── app.py              # 主应用
├── ai_client.py        # AI API 调用封装
├── requirements.txt
├── .streamlit/
│   └── config.toml
└── .gitignore
```

### 7.2 AI 客户端模块

`ai_client.py`：

```python
"""AI API 调用封装模块"""

import time
from typing import Generator


def stream_chat_response(messages: list[dict], model: str = "gpt-3.5-turbo") -> Generator[str, None, None]:
    """
    模拟流式 AI 回复（实际项目中替换为真实的 API 调用）

    Args:
        messages: 对话历史消息列表
        model: 使用的模型名称

    Yields:
        str: 每次返回的文本片段
    """
    # 模拟回复内容
    last_user_msg = messages[-1]["content"] if messages else ""
    response = f"感谢你的提问！关于「{last_user_msg}」，以下是我的分析：\n\n"
    response += "这是一个模拟的回复。在实际项目中，这里会调用 OpenAI、Claude 或其他 AI 模型的 API。"
    response += "\n\n你可以通过修改 ai_client.py 中的函数来接入真实的 AI API。"

    # 模拟流式输出
    for char in response:
        yield char
        time.sleep(0.02)


def chat_response(messages: list[dict], model: str = "gpt-3.5-turbo") -> str:
    """
    获取完整的 AI 回复（非流式）

    Args:
        messages: 对话历史消息列表
        model: 使用的模型名称

    Returns:
        str: 完整的回复文本
    """
    return "".join(stream_chat_response(messages, model))
```

### 7.3 完整的应用代码

`app.py`：

```python
"""
AI 聊天机器人界面
展示 Streamlit 在构建对话式 AI 应用方面的能力
"""

import streamlit as st
import time
from datetime import datetime

from ai_client import stream_chat_response

# ==================== 页面配置 ====================
st.set_page_config(
    page_title="AI 聊天助手",
    page_icon="🤖",
    layout="centered",
)

# 自定义聊天界面样式
st.markdown("""
<style>
    .stChatMessage {
        border-radius: 1rem;
        padding: 0.5rem 1rem;
        margin-bottom: 0.5rem;
    }
    .stTextArea textarea {
        font-size: 1rem;
    }
</style>
""", unsafe_allow_html=True)

# ==================== 初始化会话状态 ====================
if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": "你好！我是 AI 助手，有什么可以帮你的？\n\n你可以问我任何问题，我会尽力为你解答。",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    ]

if "model" not in st.session_state:
    st.session_state.model = "gpt-3.5-turbo"

# ==================== 侧边栏 ====================
with st.sidebar:
    st.header("⚙️ 设置")
    st.divider()

    # 模型选择
    model = st.selectbox(
        "选择模型",
        ["gpt-3.5-turbo", "gpt-4", "claude-3-sonnet", "claude-3-opus"],
        index=0,
    )
    st.session_state.model = model

    # 温度参数
    temperature = st.slider(
        "创意度（Temperature）",
        min_value=0.0,
        max_value=2.0,
        value=0.7,
        step=0.1,
        help="值越高回复越有创意，值越低回复越确定",
    )

    st.divider()

    # 对话统计
    user_msgs = sum(1 for m in st.session_state.messages if m["role"] == "user")
    assistant_msgs = sum(1 for m in st.session_state.messages if m["role"] == "assistant")
    st.metric("用户消息", user_msgs)
    st.metric("AI 回复", assistant_msgs)

    st.divider()

    # 操作按钮
    if st.button("🗑️ 清空聊天记录", use_container_width=True):
        st.session_state.messages = [
            {
                "role": "assistant",
                "content": "聊天记录已清空。你好！我是 AI 助手，有什么可以帮你的？",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        ]
        st.rerun()

    if st.button("📥 导出聊天记录", use_container_width=True):
        chat_text = ""
        for msg in st.session_state.messages:
            role = "用户" if msg["role"] == "user" else "AI"
            chat_text += f"[{msg.get('timestamp', '')}] {role}:\n{msg['content']}\n\n"
        st.download_button(
            label="下载为 TXT 文件",
            data=chat_text,
            file_name=f"chat_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt",
            mime="text/plain",
        )

    st.divider()
    st.caption(f"当前模型: {model}")
    st.caption(f"温度: {temperature}")

# ==================== 主聊天界面 ====================
st.title("🤖 AI 聊天助手")

# 显示聊天历史
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if "timestamp" in msg:
            st.caption(f"🕐 {msg['timestamp']}")

# 用户输入
if prompt := st.chat_input("输入你的问题..."):
    # 添加用户消息到历史
    user_message = {
        "role": "user",
        "content": prompt,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    st.session_state.messages.append(user_message)

    # 显示用户消息
    with st.chat_message("user"):
        st.markdown(prompt)
        st.caption(f"🕐 {user_message['timestamp']}")

    # 生成 AI 回复
    with st.chat_message("assistant"):
        message_placeholder = st.empty()
        full_response = ""

        # 构建对话历史（仅发送最近的对话）
        api_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in st.session_state.messages[-10:]  # 保留最近 10 条消息
        ]

        # 流式输出
        try:
            for chunk in stream_chat_response(api_messages, model=st.session_state.model):
                full_response += chunk
                message_placeholder.markdown(full_response + "▌")
            message_placeholder.markdown(full_response)
        except Exception as e:
            full_response = f"抱歉，生成回复时出现错误：{str(e)}"
            message_placeholder.error(full_response)

    # 添加 AI 回复到历史
    assistant_message = {
        "role": "assistant",
        "content": full_response,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    st.session_state.messages.append(assistant_message)

# ==================== 快捷提问 ====================
st.divider()
st.subheader("💡 快捷提问")

col1, col2, col3 = st.columns(3)

quick_prompts = [
    ("解释 Python 装饰器", "什么是 Python 装饰器？请用简单的例子说明"),
    ("推荐学习资源", "我想学习机器学习，请推荐一些入门资源"),
    ("代码审查", "请帮我审查这段代码的最佳实践"),
]

for i, (label, prompt) in enumerate(quick_prompts):
    with [col1, col2, col3][i]:
        if st.button(label, use_container_width=True):
            # 模拟快速提问
            st.session_state.messages.append({
                "role": "user",
                "content": prompt,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
            st.rerun()
```

### 7.4 接入真实 AI API

在实际项目中，需要将 `ai_client.py` 中的模拟函数替换为真实的 API 调用。以下是接入 OpenAI API 的示例：

```python
"""ai_client.py - OpenAI API 真实调用"""

import os
from openai import OpenAI


def get_client() -> OpenAI:
    """获取 OpenAI 客户端"""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        import streamlit as st
        api_key = st.secrets.get("openai", {}).get("key", "")
    return OpenAI(api_key=api_key)


def stream_chat_response(messages: list[dict], model: str = "gpt-3.5-turbo"):
    """流式调用 OpenAI API"""
    client = get_client()

    # 添加系统提示
    system_message = {
        "role": "system",
        "content": "你是一个有帮助的 AI 助手。请用中文回答问题，回答要准确、清晰、有条理。",
    }
    api_messages = [system_message] + messages

    stream = client.chat.completions.create(
        model=model,
        messages=api_messages,
        stream=True,
        temperature=0.7,
        max_tokens=2000,
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

### 7.5 运行聊天机器人

```bash
# 安装依赖
pip install streamlit openai

# 设置 API 密钥
export OPENAI_API_KEY="sk-xxxxx"

# 运行应用
streamlit run app.py
```

## 8. 部署检查清单

在将 Streamlit 应用部署到生产环境之前，请确保完成以下检查：

### 8.1 代码质量

- [ ] 移除所有 `print()` 和 `st.write("调试信息")` 等调试代码
- [ ] 确保所有用户输入都有适当的验证和错误处理
- [ ] 使用 `@st.cache_data` 或 `@st.cache_resource` 缓存耗时操作
- [ ] 避免在循环中创建大量 Streamlit 组件
- [ ] 代码遵循 PEP 8 规范

### 8.2 安全性

- [ ] 敏感信息（API 密钥、数据库密码）使用 `st.secrets` 管理
- [ ] `.streamlit/secrets.toml` 已加入 `.gitignore`
- [ ] 输入数据经过验证和清理（防止注入攻击）
- [ ] 使用 HTTPS（通过 Nginx 或云平台自带的 SSL）
- [ ] 限制文件上传的大小和类型

### 8.3 性能

- [ ] 大数据集使用分页或懒加载
- [ ] 数据库查询有适当的索引
- [ ] 使用 `@st.cache_data(ttl=...)` 设置合理的缓存过期时间
- [ ] 图表数据经过聚合处理，避免传递过多数据点
- [ ] 容器设置了合理的内存和 CPU 限制

### 8.4 运维

- [ ] 配置了健康检查端点
- [ ] 设置了日志收集和监控
- [ ] 配置了自动重启策略（`restart: unless-stopped`）
- [ ] 定期备份重要数据
- [ ] 文档化部署流程和配置

## 9. 总结

本章详细介绍了 Streamlit 应用的多种部署方案，从最简单的 Community Cloud 到生产级的 Docker + Nginx 部署，以及 Railway、Heroku 等云平台方案。同时通过两个完整的实战项目——数据分析 Dashboard 和 AI 聊天机器人界面，展示了 Streamlit 在真实场景中的应用。

**核心要点回顾：**

1. **Community Cloud** 是最简单的部署方式，适合公开项目和原型演示
2. **Docker 部署**提供最大的灵活性和控制力，适合生产环境
3. **云平台（Railway、Heroku）**提供了折中方案，兼顾简单性和可控性
4. **性能优化**的关键是合理使用缓存和避免不必要的 rerun
5. **安全最佳实践**包括使用 `st.secrets` 管理敏感信息和输入验证

选择部署方案时，应根据项目需求、预算和团队技术栈来决定。对于大多数个人项目和原型，Community Cloud 就足够了；对于企业级应用，建议使用 Docker 部署配合 Nginx 反向代理。
