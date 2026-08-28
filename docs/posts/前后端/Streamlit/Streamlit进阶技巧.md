---
order: 6
tags: [Python, Streamlit, 进阶]
category: 开发
---

# Streamlit 进阶技巧

## 1. 自定义 CSS 与主题

### 1.1 内联 CSS 注入

```python
import streamlit as st

st.markdown("""
<style>
    /* 全局字体 */
    html, body, [class*="css"] {
        font-family: "Microsoft YaHei", sans-serif;
    }

    /* 主标题样式 */
    h1 {
        color: #FF6B6B;
        text-align: center;
        padding: 10px;
        border-bottom: 2px solid #FF6B6B;
    }

    /* 按钮样式 */
    .stButton > button {
        background-color: #4ECDC4;
        color: white;
        border: none;
        border-radius: 20px;
        padding: 10px 24px;
        font-weight: bold;
        transition: all 0.3s ease;
    }
    .stButton > button:hover {
        background-color: #45B7D1;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(78, 205, 196, 0.4);
    }

    /* 指标卡片 */
    [data-testid="stMetric"] {
        background-color: #F8F9FA;
        padding: 15px;
        border-radius: 10px;
        border-left: 4px solid #4ECDC4;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    /* 侧边栏 */
    section[data-testid="stSidebar"] {
        background-color: #2C3E50;
    }
    section[data-testid="stSidebar"] .stRadio label,
    section[data-testid="stSidebar"] .stSelectbox label {
        color: white;
    }

    /* 输入框 */
    .stTextInput > div > div > input {
        border-radius: 10px;
        border: 2px solid #E0E0E0;
        padding: 10px;
    }
    .stTextInput > div > div > input:focus {
        border-color: #4ECDC4;
        box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
    }

    /* DataFrame 表格 */
    .stDataFrame {
        border-radius: 10px;
        overflow: hidden;
    }

    /* 标签页 */
    button[data-baseweb="tab"] {
        border-radius: 10px 10px 0 0;
    }

    /* 隐藏 Streamlit 默认元素 */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

st.title("自定义样式示例")
st.write("这个页面应用了自定义 CSS 样式")
```

### 1.2 外部 CSS 文件

```python
# app.py
import streamlit as st
from pathlib import Path

def load_css(file_path):
    with open(file_path) as f:
        return f"<style>{f.read()}</style>"

# 加载外部 CSS
css_path = Path("assets/style.css")
if css_path.exists():
    st.markdown(load_css(css_path), unsafe_allow_html=True)
```

```css
/* assets/style.css */
:root {
    --primary-color: #FF6B6B;
    --secondary-color: #4ECDC4;
    --background-color: #F8F9FA;
    --text-color: #2C3E50;
    --border-radius: 10px;
}

/* 卡片组件 */
.card {
    background: white;
    border-radius: var(--border-radius);
    padding: 20px;
    margin: 10px 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border-left: 4px solid var(--primary-color);
}

/* 自定义提示框 */
.custom-info {
    background: #E3F2FD;
    border-left: 4px solid #2196F3;
    padding: 15px;
    border-radius: 5px;
    margin: 10px 0;
}

.custom-success {
    background: #E8F5E9;
    border-left: 4px solid #4CAF50;
    padding: 15px;
    border-radius: 5px;
    margin: 10px 0;
}

/* 响应式布局 */
@media (max-width: 768px) {
    .stColumn {
        width: 100% !important;
    }
}
```

## 2. FastAPI 后端集成

### 2.1 项目结构

```
my_fullstack_app/
├── frontend/
│   ├── app.py            # Streamlit 前端
│   └── requirements.txt
├── backend/
│   ├── main.py           # FastAPI 后端
│   ├── models.py         # 数据模型
│   ├── services.py       # 业务逻辑
│   └── requirements.txt
├── docker-compose.yml
└── README.md
```

### 2.2 FastAPI 后端

```python
# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np

app = FastAPI(title="数据处理 API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据模型
class DataRequest(BaseModel):
    data: List[dict]
    operation: str

class AnalysisResult(BaseModel):
    summary: dict
    chart_data: List[dict]

# 内存数据存储
data_store = {}

@app.get("/")
def root():
    return {"message": "API 服务运行中"}

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

@app.post("/api/upload")
def upload_data(data: List[dict]):
    """接收并存储数据"""
    df = pd.DataFrame(data)
    data_id = str(len(data_store))
    data_store[data_id] = df
    return {
        "id": data_id,
        "rows": len(df),
        "columns": list(df.columns)
    }

@app.get("/api/data/{data_id}")
def get_data(data_id: str):
    """获取数据"""
    if data_id not in data_store:
        raise HTTPException(status_code=404, detail="数据不存在")
    df = data_store[data_id]
    return {
        "data": df.to_dict(orient="records"),
        "shape": list(df.shape)
    }

@app.post("/api/analyze")
def analyze_data(request: DataRequest):
    """数据分析"""
    df = pd.DataFrame(request.data)

    summary = {
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "null_counts": df.isnull().sum().to_dict(),
    }

    # 添加统计信息
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        summary["statistics"] = df[numeric_cols].describe().to_dict()

    return AnalysisResult(
        summary=summary,
        chart_data=df[numeric_cols].head(100).to_dict(orient="records") if len(numeric_cols) > 0 else []
    )

@app.post("/api/model/predict")
def predict(data: dict):
    """模型预测（示例）"""
    # 模拟预测
    features = data.get("features", {})
    prediction = np.random.uniform(0, 1)
    return {
        "prediction": round(prediction, 4),
        "confidence": round(np.random.uniform(0.7, 0.99), 4)
    }
```

### 2.3 Streamlit 前端调用 API

```python
# frontend/app.py
import streamlit as st
import requests
import pandas as pd

# API 配置
API_BASE_URL = "http://localhost:8000"

st.title("全栈应用 - Streamlit + FastAPI")

# 检查 API 连接
try:
    health = requests.get(f"{API_BASE_URL}/api/health", timeout=5)
    st.success("API 连接正常")
except:
    st.error("无法连接到 API 服务")
    st.stop()

# 上传数据到后端
st.subheader("上传数据")
uploaded_file = st.file_uploader("上传 CSV", type=["csv"])

if uploaded_file:
    df = pd.read_csv(uploaded_file)
    st.dataframe(df.head())

    if st.button("上传到后端"):
        with st.spinner("上传中..."):
            response = requests.post(
                f"{API_BASE_URL}/api/upload",
                json=df.to_dict(orient="records")
            )
            if response.status_code == 200:
                result = response.json()
                st.success(f"上传成功！ID: {result['id']}, 行数: {result['rows']}")
                st.session_state.data_id = result["id"]
            else:
                st.error("上传失败")

# 分析数据
if "data_id" in st.session_state:
    st.subheader("数据分析")

    if st.button("执行分析"):
        with st.spinner("分析中..."):
            # 获取数据
            data_response = requests.get(
                f"{API_BASE_URL}/api/data/{st.session_state.data_id}"
            )
            data = data_response.json()

            # 请求分析
            analysis_response = requests.post(
                f"{API_BASE_URL}/api/analyze",
                json={"data": data["data"], "operation": "describe"}
            )

            if analysis_response.status_code == 200:
                result = analysis_response.json()
                st.json(result["summary"])

                if result["chart_data"]:
                    chart_df = pd.DataFrame(result["chart_data"])
                    st.line_chart(chart_df)

# 模型预测
st.subheader("模型预测")
if st.button("执行预测"):
    response = requests.post(
        f"{API_BASE_URL}/api/model/predict",
        json={"features": {"x1": 1.0, "x2": 2.0}}
    )
    if response.status_code == 200:
        result = response.json()
        st.metric("预测值", result["prediction"])
        st.metric("置信度", f"{result['confidence']:.2%}")
```

## 3. WebSocket 实时通信

### 3.1 基于 FastAPI 的 WebSocket

```python
# backend/ws_server.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # 处理接收到的消息
            response = json.dumps({
                "type": "echo",
                "data": data,
                "timestamp": time.time()
            })
            await manager.broadcast(response)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 定时推送（模拟实时数据）
@app.on_event("startup")
async def startup_event():
    async def push_data():
        while True:
            import random
            data = json.dumps({
                "type": "sensor",
                "temperature": round(random.uniform(20, 35), 1),
                "humidity": round(random.uniform(30, 80), 1),
                "timestamp": time.time()
            })
            await manager.broadcast(data)
            await asyncio.sleep(2)

    asyncio.create_task(push_data())
```

### 3.2 Streamlit WebSocket 客户端

```python
# frontend/ws_client.py
import streamlit as st
import websocket
import threading
import json
import time
from datetime import datetime

st.title("WebSocket 实时监控")

# WebSocket 连接
WS_URL = "ws://localhost:8000/ws"

# 初始化数据存储
if "ws_data" not in st.session_state:
    st.session_state.ws_data = []
    st.session_state.ws_connected = False

def on_message(ws, message):
    """收到消息时的回调"""
    data = json.loads(message)
    st.session_state.ws_data.append(data)
    # 保留最近100条数据
    if len(st.session_state.ws_data) > 100:
        st.session_state.ws_data = st.session_state.ws_data[-100:]

def on_error(ws, error):
    st.error(f"WebSocket 错误: {error}")

def on_close(ws, close_status_code, close_msg):
    st.session_state.ws_connected = False

def on_open(ws):
    st.session_state.ws_connected = True

# 连接控制
col1, col2 = st.columns(2)

with col1:
    if st.button("连接 WebSocket"):
        if not st.session_state.ws_connected:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )
            thread = threading.Thread(target=ws.run_forever)
            thread.daemon = True
            thread.start()
            st.success("连接中...")

with col2:
    if st.button("断开连接"):
        if st.session_state.ws_connected:
            st.session_state.ws_connected = False
            st.success("已断开")

# 状态显示
status = "已连接" if st.session_state.ws_connected else "未连接"
st.write(f"连接状态: {status}")

# 实时数据展示
if st.session_state.ws_data:
    latest = st.session_state.ws_data[-1]

    if latest.get("type") == "sensor":
        col1, col2, col3 = st.columns(3)
        col1.metric("温度", f"{latest['temperature']}°C")
        col2.metric("湿度", f"{latest['humidity']}%")
        col3.metric("时间", datetime.fromtimestamp(latest['timestamp']).strftime("%H:%M:%S"))

        # 历史趋势
        if len(st.session_state.ws_data) > 1:
            import pandas as pd
            sensor_data = [
                d for d in st.session_state.ws_data if d.get("type") == "sensor"
            ]
            if sensor_data:
                df = pd.DataFrame(sensor_data)
                df["time"] = pd.to_datetime(df["timestamp"], unit="s")
                st.line_chart(df.set_index("time")[["temperature", "humidity"]])

# 发送消息
msg = st.text_input("发送消息")
if st.button("发送") and msg and st.session_state.ws_connected:
    # 通过 HTTP 发送（简化示例）
    st.write(f"发送: {msg}")
```

## 4. 自定义组件

### 4.1 使用 HTML/JavaScript 嵌入

```python
import streamlit as st

# 自定义 HTML 组件
def custom_metric(label, value, delta=None, color="#4ECDC4"):
    """自定义指标卡片组件"""
    delta_html = ""
    if delta:
        delta_color = "#4CAF50" if delta.startswith("+") or delta.startswith("-") == False else "#F44336"
        delta_html = f'<span style="color: {delta_color}; font-size: 0.9em;">{delta}</span>'

    html = f"""
    <div style="
        background: linear-gradient(135deg, {color}22, {color}11);
        border-left: 4px solid {color};
        border-radius: 10px;
        padding: 20px;
        margin: 5px 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    ">
        <div style="color: #666; font-size: 0.9em; margin-bottom: 5px;">{label}</div>
        <div style="font-size: 2em; font-weight: bold; color: {color};">{value}</div>
        <div>{delta_html}</div>
    </div>
    """
    st.markdown(html, unsafe_allow_html=True)

# 使用
col1, col2, col3 = st.columns(3)
with col1:
    custom_metric("总用户", "12,345", "+5.2%", "#4ECDC4")
with col2:
    custom_metric("活跃用户", "8,901", "+3.1%", "#FF6B6B")
with col3:
    custom_metric("转化率", "3.2%", "-0.5%", "#45B7D1")

# 自定义进度条
def custom_progress(label, progress, color="#4ECDC4"):
    html = f"""
    <div style="margin: 10px 0;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>{label}</span>
            <span>{progress}%</span>
        </div>
        <div style="background: #E0E0E0; border-radius: 10px; height: 20px;">
            <div style="
                background: linear-gradient(90deg, {color}, {color}CC);
                height: 100%;
                width: {progress}%;
                border-radius: 10px;
                transition: width 0.3s ease;
            "></div>
        </div>
    </div>
    """
    st.markdown(html, unsafe_allow_html=True)

custom_progress("项目进度", 75)
custom_progress("学习进度", 45, "#FF6B6B")
```

### 4.2 可复用组件封装

```python
# components/data_card.py
"""可复用的数据卡片组件"""
import streamlit as st
from typing import Any, Optional

def data_card(
    title: str,
    value: Any,
    description: Optional[str] = None,
    icon: str = "📊",
    color: str = "#4ECDC4"
):
    """通用数据卡片"""
    desc_html = f'<div style="color: #888; font-size: 0.85em; margin-top: 5px;">{description}</div>' if description else ""

    html = f"""
    <div style="
        background: white;
        border-radius: 12px;
        padding: 20px;
        border-left: 5px solid {color};
        box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        transition: transform 0.2s;
    ">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
            <span style="font-size: 1.5em;">{icon}</span>
            <span style="color: #666; font-size: 0.95em;">{title}</span>
        </div>
        <div style="font-size: 2.2em; font-weight: bold; color: {color};">
            {value}
        </div>
        {desc_html}
    </div>
    """
    st.markdown(html, unsafe_allow_html=True)


def status_badge(text: str, status: str = "success"):
    """状态标签"""
    colors = {
        "success": "#4CAF50",
        "warning": "#FF9800",
        "error": "#F44336",
        "info": "#2196F3"
    }
    color = colors.get(status, "#999")

    html = f"""
    <span style="
        display: inline-block;
        padding: 4px 12px;
        border-radius: 20px;
        background-color: {color}22;
        color: {color};
        font-size: 0.85em;
        font-weight: 600;
        border: 1px solid {color}44;
    ">{text}</span>
    """
    st.markdown(html, unsafe_allow_html=True)


def progress_ring(percentage: float, size: int = 100, color: str = "#4ECDC4"):
    """环形进度条"""
    html = f"""
    <div style="position: relative; width: {size}px; height: {size}px;">
        <svg width="{size}" height="{size}" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#E0E0E0" stroke-width="8"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="{color}" stroke-width="8"
                    stroke-dasharray="{percentage * 2.51} {251 - percentage * 2.51}"
                    stroke-linecap="round"
                    transform="rotate(-90 50 50)"/>
        </svg>
        <div style="
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            font-size: 1.2em;
            font-weight: bold;
            color: {color};
        ">{percentage:.0f}%</div>
    </div>
    """
    st.markdown(html, unsafe_allow_html=True)

# 使用示例
st.title("自定义组件示例")

col1, col2, col3, col4 = st.columns(4)
with col1:
    data_card("总用户", "12,345", "+5.2% vs 上月", "👥", "#4ECDC4")
with col2:
    data_card("收入", "¥89.5K", "+12.3% vs 上月", "💰", "#FF6B6B")
with col3:
    data_card("订单", "2,456", "+8.7% vs 上月", "📦", "#45B7D1")
with col4:
    data_card("满意度", "4.8/5.0", "+0.2 vs 上月", "⭐", "#96CEB4")

st.divider()

col1, col2 = st.columns(2)
with col1:
    st.write("状态标签:")
    status_badge("在线", "success")
    status_badge("离线", "error")
    status_badge("处理中", "warning")
    status_badge("信息", "info")

with col2:
    st.write("环形进度:")
    col_a, col_b, col_c = st.columns(3)
    with col_a:
        progress_ring(75)
    with col_b:
        progress_ring(45, 100, "#FF6B6B")
    with col_c:
        progress_ring(90, 100, "#45B7D1")
```

## 5. Flask 集成

```python
# Flask 后端
# backend/app.py
from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np

app = Flask(__name__)
CORS(app)

@app.route("/api/data")
def get_data():
    df = pd.DataFrame({
        "x": np.random.randn(100),
        "y": np.random.randn(100)
    })
    return jsonify(df.to_dict(orient="records"))

@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.json
    df = pd.DataFrame(data)
    return jsonify({
        "mean": df.mean().to_dict(),
        "std": df.std().to_dict()
    })

if __name__ == "__main__":
    app.run(port=5000, debug=True)
```

```python
# Streamlit 前端调用 Flask
# frontend.py
import streamlit as st
import requests
import pandas as pd

FLASK_URL = "http://localhost:5000"

st.title("Flask + Streamlit 集成")

if st.button("获取数据"):
    response = requests.get(f"{FLASK_URL}/api/data")
    data = response.json()
    df = pd.DataFrame(data)
    st.scatter_chart(df)

if st.button("分析数据"):
    sample_data = [{"x": 1, "y": 2}, {"x": 3, "y": 4}]
    response = requests.post(f"{FLASK_URL}/api/analyze", json=sample_data)
    st.json(response.json())
```

## 6. 常见坑与解决方案

### 6.1 脚本重运行导致的状态丢失

```python
# ❌ 错误：每次重运行都会重新初始化
counter = 0
counter += 1
st.write(counter)  # 永远显示 1

# ✅ 正确：使用 session_state
if "counter" not in st.session_state:
    st.session_state.counter = 0
st.session_state.counter += 1
st.write(st.session_state.counter)
```

### 6.2 Widget Key 冲突

```python
# ❌ 错误：动态生成的 key 可能冲突
for i in range(5):
    st.text_input("输入", key="input")  # 所有 key 相同！

# ✅ 正确：使用唯一的 key
for i in range(5):
    st.text_input("输入", key=f"input_{i}")
```

### 6.3 在循环中使用 st.write

```python
# ❌ 错误：循环中使用 st.write 不会按预期工作
for i in range(5):
    st.write(f"项目 {i}")  # 不会显示在预期位置

# ✅ 正确：使用 container 或 columns
for i in range(5):
    with st.container():
        st.write(f"项目 {i}")
```

### 6.4 缓存函数中使用 st 组件

```python
# ❌ 错误：缓存函数中不能使用 st 组件
@st.cache_data
def bad_function():
    st.write("报错！")  # 不允许
    return data

# ✅ 正确：只在缓存函数中返回数据
@st.cache_data
def good_function():
    return data  # 只返回数据

# 在外部使用 st 组件显示
data = good_function()
st.write(data)
```

### 6.5 文件上传后重新运行丢失

```python
# ❌ 错误：文件上传后重新运行会丢失
uploaded = st.file_uploader("上传文件")
if uploaded:
    df = pd.read_csv(uploaded)
    st.dataframe(df)  # 重新运行后 uploaded 变为 None

# ✅ 正确：将数据保存到 session_state
uploaded = st.file_uploader("上传文件")
if uploaded:
    st.session_state.df = pd.read_csv(uploaded)

if "df" in st.session_state:
    st.dataframe(st.session_state.df)
```

### 6.6 多页面应用中的导入问题

```python
# ❌ 错误：在 pages/ 中使用相对导入
# pages/1_分析.py
from ..utils import helper  # 可能报错

# ✅ 正确：将项目根目录加入 path
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils import helper
```

## 7. 最佳实践总结

### 7.1 项目结构

```
my_app/
├── app.py                    # 主入口
├── pages/                    # 多页面
│   ├── 1_数据分析.py
│   └── 2_设置.py
├── components/               # 可复用组件
│   ├── __init__.py
│   ├── charts.py
│   └── forms.py
├── utils/                    # 工具函数
│   ├── __init__.py
│   ├── data_loader.py
│   └── helpers.py
├── assets/                   # 静态资源
│   ├── style.css
│   └── images/
├── .streamlit/
│   └── config.toml
├── requirements.txt
├── Dockerfile
└── README.md
```

### 7.2 性能优化清单

- 使用 `@st.cache_data` 缓存数据加载和处理
- 使用 `@st.cache_resource` 缓存数据库连接和模型
- 使用 `@st.fragment` 实现局部刷新
- 大数据集使用虚拟滚动或分页
- 避免在循环中使用 `st.write`
- 使用 `st.empty()` 做局部更新而非 `st.rerun()`
- 合理设置 `ttl` 过期时间

### 7.3 代码质量

- 将业务逻辑与 UI 分离
- 使用类型注解
- 编写文档字符串
- 处理异常情况
- 使用 `st.error()`、`st.warning()` 提供用户反馈
- 保持页面布局一致
