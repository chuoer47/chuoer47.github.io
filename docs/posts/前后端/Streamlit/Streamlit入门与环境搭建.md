---
order: 1
tags: [Python, Streamlit, Web开发]
category: 开发
---

# Streamlit 入门与环境搭建

## 1. Streamlit 简介

Streamlit 是一个面向数据科学家和机器学习工程师的开源 Python Web 框架。它让你无需编写 HTML、CSS、JavaScript，就能快速构建交互式数据应用。

### 核心特点

- **纯 Python**：不需要任何前端知识，全部用 Python 编写
- **即时热重载**：保存文件后自动刷新浏览器，开发体验极佳
- **声明式 API**：自上而下执行脚本，所见即所得
- **丰富的内置组件**：文本、图表、表格、输入控件一应俱全
- **与数据科学生态无缝集成**：Pandas、NumPy、Matplotlib、Plotly 等开箱即用

### 与传统 Web 框架对比

| 特性 | Streamlit | Flask/Django | Dash |
|------|-----------|-------------|------|
| 前端知识要求 | 无 | 需要 HTML/CSS/JS | 需要基础前端 |
| 开发速度 | 极快 | 中等 | 较快 |
| 热重载 | 自动 | 手动配置 | 支持 |
| 适合场景 | 数据展示/原型 | 完整Web应用 | 数据仪表盘 |
| 学习曲线 | 平缓 | 中等 | 中等 |
| 交互能力 | 中等 | 完全自由 | 强 |
| 部署难度 | 简单 | 中等 | 中等 |

## 2. 安装

### 2.1 环境准备

推荐使用虚拟环境隔离依赖：

```bash
# 使用 venv
python -m venv streamlit-env
source streamlit-env/bin/activate  # Linux/macOS
# streamlit-env\Scripts\activate   # Windows

# 或使用 conda
conda create -n streamlit-env python=3.11
conda activate streamlit-env
```

### 2.2 安装 Streamlit

```bash
# 基础安装
pip install streamlit

# 验证安装
streamlit version

# 推荐同时安装常用数据科学库
pip install streamlit pandas numpy matplotlib plotly openpyxl
```

### 2.3 创建第一个项目

```bash
# 创建项目目录
mkdir my_streamlit_app
cd my_streamlit_app

# 创建主文件
touch app.py
```

## 3. Hello World

编写最简单的 Streamlit 应用：

```python
# app.py
import streamlit as st

st.title("Hello Streamlit!")

st.write("这是我的第一个 Streamlit 应用。")

name = st.text_input("请输入你的名字：")
if name:
    st.write(f"你好, {name}! 欢迎使用 Streamlit。")
```

运行应用：

```bash
streamlit run app.py
```

浏览器会自动打开 `http://localhost:8501`，你就能看到应用了。

### 3.1 脚本式执行机制

Streamlit 的核心运行原理：**每次用户交互都会从头到尾重新执行整个脚本**。

```python
import streamlit as st
import pandas as pd
import numpy as np

# 这行每次交互都会执行
st.write("页面加载时间:", pd.Timestamp.now())

# 用户交互
user_input = st.text_input("输入一些内容")

# 根据输入显示不同内容
if user_input:
    st.write(f"你输入了: {user_input}")
    # 每次重新执行时，这里都会重新计算
    data = pd.DataFrame(
        np.random.randn(10, 2),
        columns=["A", "B"]
    )
    st.dataframe(data)
```

> **关键理解**：Streamlit 不是事件驱动的，而是脚本式的。每次交互都会从上到下重新运行整个脚本。

## 4. 项目结构

### 4.1 简单项目结构

```
my_app/
├── app.py              # 主入口文件
├── pages/              # 多页面目录（可选）
│   ├── 1_数据探索.py
│   └── 2_关于.py
├── requirements.txt    # 依赖文件
└── .streamlit/
    └── config.toml     # 配置文件
```

### 4.2 多页面项目

Streamlit 支持自动多页面，只需在 `pages/` 目录下创建 Python 文件：

```
my_app/
├── app.py              # 首页
├── pages/
│   ├── 1_📊_数据分析.py    # 第一个子页面
│   ├── 2_📈_可视化.py      # 第二个子页面
│   └── 3_⚙️_设置.py        # 第三个子页面
└── requirements.txt
```

页面文件示例：

```python
# pages/1_📊_数据分析.py
import streamlit as st
import pandas as pd

st.title("数据分析")

uploaded_file = st.file_uploader("上传CSV文件", type=["csv"])

if uploaded_file:
    df = pd.read_csv(uploaded_file)
    st.write("数据概览：")
    st.dataframe(df.describe())
else:
    st.info("请上传一个CSV文件开始分析。")
```

### 4.3 推荐的大型项目结构

```
my_large_app/
├── app.py                  # 主入口
├── pages/                  # 页面模块
│   ├── 1_首页.py
│   └── 2_分析.py
├── components/             # 自定义组件
│   ├── sidebar.py
│   └── charts.py
├── utils/                  # 工具函数
│   ├── data_loader.py
│   └── helpers.py
├── data/                   # 数据文件
│   └── sample.csv
├── assets/                 # 静态资源
│   └── style.css
├── requirements.txt
└── .streamlit/
    └── config.toml
```

## 5. 配置文件 config.toml

在项目根目录创建 `.streamlit/config.toml` 进行配置：

```toml
[theme]
# 主题设置
primaryColor = "#FF6B6B"
backgroundColor = "#FFFFFF"
secondaryBackgroundColor = "#F0F2F6"
textColor = "#262730"
font = "sans serif"

[server]
# 服务器设置
port = 8501
address = "localhost"
headless = true              # 无头模式（服务器部署时使用）
enableCORS = false
enableXsrfProtection = true

[browser]
# 浏览器设置
serverAddress = "localhost"
serverPort = 8501
gatherUsageStats = false     # 关闭使用统计

[runner]
# 运行器设置
magicEnabled = true          # 启用魔法命令
fastReruns = true            # 快速重运行
```

### 暗色主题

```toml
[theme]
primaryColor = "#FF4B4B"
backgroundColor = "#0E1117"
secondaryBackgroundColor = "#262730"
textColor = "#FAFAFA"
font = "sans serif"
```

### 全局配置文件

全局配置位于 `~/.streamlit/config.toml`，对所有项目生效。

## 6. 运行与调试

### 6.1 常用运行命令

```bash
# 基本运行
streamlit run app.py

# 指定端口
streamlit run app.py --server.port 8502

# 指定地址（局域网访问）
streamlit run app.py --server.address 0.0.0.0

# 禁止自动打开浏览器
streamlit run app.py --server.headless true

# 启用 CORS（调试时使用）
streamlit run app.py --server.enableCORS true
```

### 6.2 调试技巧

```python
import streamlit as st

# 使用 st.write 调试
st.write("调试信息:", variable)

# 使用 st.expander 查看详细信息
with st.expander("调试详情"):
    st.write(st.session_state)

# 条件调试
if st.checkbox("显示调试信息"):
    import sys
    st.write("Python版本:", sys.version)
    st.write("Streamlit版本:", st.__version__)
```

### 6.3 命令行帮助

```bash
# 查看所有可用命令
streamlit --help

# 查看运行状态
streamlit status

# 清除缓存
streamlit cache clear
```

## 7. 快速上手示例

### 示例 1：交互式计算器

```python
import streamlit as st

st.title("简单计算器")

col1, col2, col3 = st.columns(3)

with col1:
    num1 = st.number_input("第一个数", value=0.0)

with col2:
    operation = st.selectbox("运算", ["+", "-", "*", "/"])

with col3:
    num2 = st.number_input("第二个数", value=0.0)

if st.button("计算"):
    if operation == "+":
        result = num1 + num2
    elif operation == "-":
        result = num1 - num2
    elif operation == "*":
        result = num1 * num2
    elif operation == "/":
        result = num1 / num2 if num2 != 0 else "错误：除数不能为零"

    st.success(f"结果: {result}")
```

### 示例 2：随机数据生成器

```python
import streamlit as st
import pandas as pd
import numpy as np

st.title("随机数据生成器")

n_rows = st.slider("生成行数", 10, 1000, 100)
n_cols = st.slider("生成列数", 1, 20, 5)

if st.button("生成数据"):
    data = pd.DataFrame(
        np.random.randn(n_rows, n_cols),
        columns=[f"列_{i+1}" for i in range(n_cols)]
    )

    col1, col2 = st.columns(2)

    with col1:
        st.write("数据预览:")
        st.dataframe(data.head(20))

    with col2:
        st.write("统计摘要:")
        st.dataframe(data.describe())

    st.line_chart(data)
```

## 8. 常见问题

### Q1: 端口被占用

```bash
# 查找占用 8501 端口的进程
lsof -i :8501

# 杀掉进程
kill -9 <PID>

# 或使用其他端口
streamlit run app.py --server.port 8502
```

### Q2: 中文乱码

```python
# 在页面顶部设置
st.set_page_config(
    page_title="我的应用",
    page_icon="🌐",
    layout="wide",
    initial_sidebar_state="expanded"
)
```

### Q3: 文件编码问题

```python
# 读取 CSV 时指定编码
df = pd.read_csv("data.csv", encoding="utf-8-sig")
```

## 总结

| 知识点 | 要点 |
|--------|------|
| 安装 | `pip install streamlit` |
| 运行 | `streamlit run app.py` |
| 运行机制 | 脚本式执行，每次交互重新运行 |
| 多页面 | 在 `pages/` 目录创建文件 |
| 配置 | `.streamlit/config.toml` |
| 热重载 | 保存文件后自动刷新 |
