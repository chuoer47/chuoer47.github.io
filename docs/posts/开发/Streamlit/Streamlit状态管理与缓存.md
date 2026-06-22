---
order: 4
tags: [Python, Streamlit, 状态管理]
category: 开发
---

# Streamlit 状态管理与缓存

## 1. Session State 详解

### 1.1 什么是 Session State

Streamlit 的脚本式执行模型意味着每次交互都会从头到尾重新运行脚本。`st.session_state` 是在多次重运行之间持久化数据的机制。

```python
import streamlit as st

# 基本用法
if "counter" not in st.session_state:
    st.session_state.counter = 0

st.write(f"计数器: {st.session_state.counter}")

if st.button("增加"):
    st.session_state.counter += 1
    st.rerun()  # 触发重新运行
```

### 1.2 初始化 Session State

```python
import streamlit as st
import pandas as pd
import numpy as np

# 方式1：条件检查初始化
if "messages" not in st.session_state:
    st.session_state.messages = []

if "user_name" not in st.session_state:
    st.session_state.user_name = ""

# 方式2：使用字典批量初始化
def init_session_state():
    defaults = {
        "counter": 0,
        "messages": [],
        "settings": {
            "theme": "light",
            "language": "zh",
            "notifications": True
        },
        "data": None,
        "history": [],
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

init_session_state()

# 方式3：使用 st.session_state.update（推荐批量设置）
if "initialized" not in st.session_state:
    st.session_state.update({
        "counter": 0,
        "messages": [],
        "user": None,
        "preferences": {},
    })
    st.session_state.initialized = True
```

### 1.3 Session State 高级用法

```python
import streamlit as st
import pandas as pd
from datetime import datetime

# 多层嵌套字典
if "app_state" not in st.session_state:
    st.session_state.app_state = {
        "user": {
            "name": "张三",
            "role": "admin",
            "preferences": {
                "theme": "dark",
                "language": "zh"
            }
        },
        "data": {
            "current_page": "home",
            "filters": [],
            "sort_by": None
        }
    }

# 访问嵌套数据
st.write(f"用户名: {st.session_state.app_state['user']['name']}")
st.write(f"主题: {st.session_state.app_state['user']['preferences']['theme']}")

# 更新嵌套数据
if st.button("切换主题"):
    current = st.session_state.app_state["user"]["preferences"]["theme"]
    new_theme = "light" if current == "dark" else "dark"
    st.session_state.app_state["user"]["preferences"]["theme"] = new_theme
    st.rerun()

# 使用列表作为历史记录
if "search_history" not in st.session_state:
    st.session_state.search_history = []

search = st.text_input("搜索")
if search:
    st.session_state.search_history.append({
        "query": search,
        "time": datetime.now().isoformat()
    })

if st.session_state.search_history:
    st.write("搜索历史:")
    for item in reversed(st.session_state.search_history[-10:]):
        st.write(f"  - {item['query']} ({item['time'][:19]})")
```

## 2. 回调函数

### 2.1 on_click 与 on_change

```python
import streamlit as st

# 基本 on_click
if "count" not in st.session_state:
    st.session_state.count = 0

def increment():
    st.session_state.count += 1

def decrement():
    st.session_state.count -= 1

col1, col2, col3 = st.columns(3)
with col1:
    st.button("➕ 增加", on_click=increment)
with col2:
    st.write(f"当前值: {st.session_state.count}")
with col3:
    st.button("➖ 减少", on_click=decrement)

# on_change 回调
def on_name_change():
    st.toast(f"名字已更改为: {st.session_state.name_input}")

name = st.text_input(
    "输入名字",
    key="name_input",
    on_change=on_name_change
)

# selectbox 的 on_change
def on_option_change():
    st.toast(f"选择了: {st.session_state.option}")

option = st.selectbox(
    "选择选项",
    ["选项A", "选项B", "选项C"],
    key="option",
    on_change=on_option_change
)

# slider 的 on_change
def on_slider_change():
    st.session_state.slider_value = st.session_state.my_slider

slider_val = st.slider(
    "调节值",
    0, 100, 50,
    key="my_slider",
    on_change=on_slider_change
)
```

### 2.2 复杂回调模式

```python
import streamlit as st
import pandas as pd

# 待办事项应用
if "todos" not in st.session_state:
    st.session_state.todos = []

def add_todo():
    if st.session_state.new_todo.strip():
        st.session_state.todos.append({
            "text": st.session_state.new_todo.strip(),
            "done": False,
            "id": len(st.session_state.todos)
        })
        st.session_state.new_todo = ""

def remove_todo(index):
    st.session_state.todos.pop(index)

def toggle_todo(index):
    st.session_state.todos[index]["done"] = not st.session_state.todos[index]["done"]

def clear_completed():
    st.session_state.todos = [
        t for t in st.session_state.todos if not t["done"]
    ]

# 界面
st.title("待办事项")

with st.form("add_todo_form", clear_on_submit=True):
    new_todo = st.text_input("新任务", key="new_todo")
    submitted = st.form_submit_button("添加", on_click=add_todo)

# 显示待办
if st.session_state.todos:
    for i, todo in enumerate(st.session_state.todos):
        col1, col2, col3 = st.columns([0.5, 4, 0.5])
        with col1:
            st.checkbox(
                "",
                value=todo["done"],
                key=f"todo_{i}",
                on_change=toggle_todo,
                args=(i,)
            )
        with col2:
            text_style = "text-decoration: line-through; color: gray" if todo["done"] else ""
            st.markdown(f'<span style="{text_style}">{todo["text"]}</span>', unsafe_allow_html=True)
        with col3:
            st.button("🗑️", key=f"del_{i}", on_click=remove_todo, args=(i,))

    st.button("清除已完成", on_click=clear_completed)

    # 统计
    total = len(st.session_state.todos)
    done = sum(1 for t in st.session_state.todos if t["done"])
    st.progress(done / total if total > 0 else 0)
    st.write(f"完成 {done}/{total}")
else:
    st.info("暂无待办事项")
```

### 2.3 带参数的回调

```python
import streamlit as st

if "data" not in st.session_state:
    st.session_state.data = list(range(10))

def add_value(value):
    st.session_state.data.append(value)

def remove_value(index):
    st.session_state.data.pop(index)

# 批量添加按钮
for i in range(5):
    st.button(
        f"添加 {i}",
        key=f"add_{i}",
        on_click=add_value,
        args=(i,)
    )

# 显示数据
st.write("数据:", st.session_state.data)

# 删除按钮
for i, val in enumerate(st.session_state.data):
    st.button(
        f"删除 {val}",
        key=f"del_{i}",
        on_click=remove_value,
        args=(i,)
    )
```

## 3. Cache 缓存机制

### 3.1 cache_data vs cache_resource

```python
import streamlit as st
import pandas as pd
import numpy as np
from sqlalchemy import create_engine

# ========================
# st.cache_data - 缓存数据（推荐用于数据处理）
# ========================
# - 返回值会被深拷贝
# - 适用于返回 Pandas DataFrame、NumPy 数组、字典等可序列化数据
# - 每次调用返回独立副本，修改不会影响缓存

@st.cache_data
def load_data(file_path):
    """加载并处理数据（会被缓存）"""
    df = pd.read_csv(file_path)
    df["processed"] = df["value"] * 2
    return df

@st.cache_data(ttl=3600)  # 缓存1小时后过期
def fetch_api_data(url):
    """从 API 获取数据"""
    import requests
    response = requests.get(url)
    return pd.DataFrame(response.json())

@st.cache_data(show_spinner="正在加载数据...")
def expensive_computation(data):
    """耗时计算（会被缓存）"""
    result = data.groupby("category").agg({
        "value": ["mean", "sum", "count"]
    })
    return result

# ========================
# st.cache_resource - 缓存资源（推荐用于数据库连接等）
# ========================
# - 返回值不会被深拷贝
# - 适用于数据库连接、机器学习模型、文件句柄等不可序列化的对象
# - 全局共享，修改会影响所有用户

@st.cache_resource
def get_database_engine():
    """创建数据库连接（全局共享）"""
    return create_engine("sqlite:///mydb.db")

@st.cache_resource
def load_ml_model():
    """加载机器学习模型（全局共享）"""
    # import joblib
    # return joblib.load("model.pkl")
    return {"type": "model", "version": "1.0"}

# 使用
engine = get_database_engine()
model = load_ml_model()
```

### 3.2 缓存参数详解

```python
import streamlit as st
import pandas as pd
import time

# ttl：缓存过期时间（秒）
@st.cache_data(ttl=300)  # 5分钟过期
def get_fresh_data():
    return pd.DataFrame({"time": [time.time()]})

# max_entries：最大缓存条目数
@st.cache_data(max_entries=10)
def process_data(step):
    time.sleep(1)  # 模拟耗时操作
    return pd.DataFrame({"step": [step], "value": [step * 10]})

# show_spinner：加载提示
@st.cache_data(show_spinner="🔄 正在计算，请稍候...")
def slow_computation(n):
    time.sleep(2)
    return sum(i ** 2 for i in range(n))

# 实验性参数（Streamlit 1.37+）
@st.cache_data(
    ttl=3600,
    max_entries=100,
    show_spinner="加载中...",
    experimental_allow_widgets=True  # 允许缓存中包含 widget 值
)
def advanced_cache():
    return pd.DataFrame({"a": [1, 2, 3]})

# 使用示例
st.subheader("缓存演示")

if st.button("加载数据"):
    df = get_fresh_data()
    st.dataframe(df)

step = st.number_input("步骤", 1, 10, 1)
if st.button("处理"):
    result = process_data(step)
    st.dataframe(result)

n = st.number_input("计算 N", 1000, 1000000, 100000)
if st.button("计算"):
    result = slow_computation(n)
    st.write(f"结果: {result}")
```

### 3.3 缓存失效与清理

```python
import streamlit as st
import pandas as pd

# 缓存数据
@st.cache_data(ttl=3600)
def get_data():
    return pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})

df = get_data()
st.dataframe(df)

# 清除特定函数的缓存
if st.button("清除数据缓存"):
    get_data.clear()  # 清除 get_data 的所有缓存
    st.success("缓存已清除！")
    st.rerun()

# 清除所有缓存
if st.button("清除所有缓存"):
    st.cache_data.clear()  # 清除所有 cache_data 缓存
    st.cache_resource.clear()  # 清除所有 cache_resource 缓存
    st.success("所有缓存已清除！")

# 也可以通过命令行清除
# streamlit cache clear
```

## 4. 多页面状态管理

### 4.1 跨页面共享数据

```python
# utils/state_manager.py
"""跨页面状态管理工具"""
import streamlit as st

def init_global_state():
    """初始化全局状态"""
    defaults = {
        "user": {
            "name": "",
            "logged_in": False,
            "role": "guest"
        },
        "app": {
            "current_page": "home",
            "theme": "light",
            "language": "zh"
        },
        "data": {
            "uploaded_files": [],
            "current_dataset": None,
            "filters": {}
        }
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

def login_user(name, role="user"):
    """登录用户"""
    st.session_state.user.update({
        "name": name,
        "logged_in": True,
        "role": role
    })

def logout_user():
    """登出用户"""
    st.session_state.user.update({
        "name": "",
        "logged_in": False,
        "role": "guest"
    })

def get_current_user():
    """获取当前用户"""
    return st.session_state.get("user", {})

def is_logged_in():
    """检查是否已登录"""
    return st.session_state.get("user", {}).get("logged_in", False)
```

```python
# app.py
import streamlit as st
from utils.state_manager import init_global_state, is_logged_in, get_current_user

st.set_page_config(page_title="多页面应用", layout="wide")
init_global_state()

# 导航
st.sidebar.title("导航")

if is_logged_in():
    user = get_current_user()
    st.sidebar.success(f"欢迎, {user['name']}!")
    if st.sidebar.button("登出"):
        from utils.state_manager import logout_user
        logout_user()
        st.rerun()
else:
    st.sidebar.info("请登录")
```

### 4.2 页面间数据传递

```python
# pages/1_数据上传.py
import streamlit as st
import pandas as pd

st.title("数据上传")

uploaded = st.file_uploader("上传CSV", type=["csv"])
if uploaded:
    df = pd.read_csv(uploaded)
    st.session_state.data = df
    st.session_state.data_info = {
        "filename": uploaded.name,
        "rows": len(df),
        "columns": list(df.columns)
    }
    st.success(f"已上传: {uploaded.name}")

# pages/2_数据分析.py
import streamlit as st

st.title("数据分析")

if "data" not in st.session_state or st.session_state.data is None:
    st.warning("请先在'数据上传'页面上传数据")
    st.stop()

df = st.session_state.data
info = st.session_state.get("data_info", {})

st.write(f"文件: {info.get('filename', '未知')}")
st.write(f"行数: {info.get('rows', 0)}")

st.dataframe(df.describe(), use_container_width=True)

# pages/3_数据可视化.py
import streamlit as st

st.title("数据可视化")

if "data" not in st.session_state or st.session_state.data is None:
    st.warning("请先在'数据上传'页面上传数据")
    st.stop()

df = st.session_state.data

numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
if numeric_cols:
    selected = st.selectbox("选择列", numeric_cols)
    st.line_chart(df[selected])
else:
    st.info("没有数值列可供可视化")
```

## 5. Fragment 局部刷新

### 5.1 基本 Fragment

```python
import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime

st.title("Fragment 局部刷新示例")

# 全局数据（不会因 fragment 刷新而丢失）
if "global_counter" not in st.session_state:
    st.session_state.global_counter = 0

# Fragment 1：实时指标
@st.fragment(run_every="2s")
def live_metrics():
    st.subheader("实时指标")
    cols = st.columns(4)
    cols[0].metric("CPU", f"{np.random.randint(20, 80)}%")
    cols[1].metric("内存", f"{np.random.randint(40, 90)}%")
    cols[2].metric("磁盘", f"{np.random.randint(30, 70)}%")
    cols[3].metric("网络", f"{np.random.randint(100, 500)} Mbps")
    st.caption(f"更新时间: {datetime.now().strftime('%H:%M:%S')}")

# Fragment 2：带交互的图表
@st.fragment
def interactive_chart():
    st.subheader("交互式图表")
    chart_type = st.selectbox("图表类型", ["line", "bar", "area"], key="chart_type")
    data = pd.DataFrame({
        "x": range(20),
        "y": np.random.randn(20).cumsum()
    })

    if chart_type == "line":
        st.line_chart(data.set_index("x"))
    elif chart_type == "bar":
        st.bar_chart(data.set_index("x"))
    else:
        st.area_chart(data.set_index("x"))

# Fragment 3：局部表单
@st.fragment
def data_filter():
    st.subheader("数据筛选")
    min_val = st.slider("最小值", 0, 100, 0)
    max_val = st.slider("最大值", 0, 100, 100)

    # 返回筛选结果给主脚本
    return min_val, max_val

# 渲染
live_metrics()
st.divider()
interactive_chart()
st.divider()
min_val, max_val = data_filter()
st.write(f"筛选范围: {min_val} - {max_val}")

# 主脚本中的全局计数器（不受 fragment 影响）
if st.button("全局计数器 +1"):
    st.session_state.global_counter += 1
st.write(f"全局计数器: {st.session_state.global_counter}")
```

### 5.2 Fragment 间通信

```python
import streamlit as st
import pandas as pd
import numpy as np

st.title("Fragment 间通信")

if "shared_data" not in st.session_state:
    st.session_state.shared_data = pd.DataFrame({
        "category": ["A", "B", "C", "D"],
        "value": [10, 20, 15, 25]
    })

# Fragment A：数据编辑
@st.fragment
def data_editor():
    st.subheader("编辑数据")
    edited = st.data_editor(
        st.session_state.shared_data,
        num_rows="dynamic",
        use_container_width=True,
        key="editor"
    )
    if st.button("保存修改", key="save"):
        st.session_state.shared_data = edited
        st.success("已保存！")

# Fragment B：数据可视化
@st.fragment
def data_visualizer():
    st.subheader("数据可视化")
    if not st.session_state.shared_data.empty:
        st.bar_chart(st.session_state.shared_data.set_index("category"))
    else:
        st.info("暂无数据")

# Fragment C：统计信息
@st.fragment
def data_stats():
    st.subheader("统计信息")
    df = st.session_state.shared_data
    if not df.empty:
        st.metric("总和", df["value"].sum())
        st.metric("平均值", f"{df['value'].mean():.2f}")
        st.metric("最大值", df["value"].max())
    else:
        st.info("暂无数据")

# 渲染
col1, col2 = st.columns(2)
with col1:
    data_editor()
    data_stats()
with col2:
    data_visualizer()
```

## 6. 性能优化

### 6.1 缓存最佳实践

```python
import streamlit as st
import pandas as pd
import numpy as np
import time

# ✅ 正确：缓存数据加载
@st.cache_data
def load_large_dataset():
    """加载大数据集 - 只在首次执行"""
    time.sleep(3)  # 模拟耗时加载
    return pd.DataFrame(
        np.random.randn(100000, 10),
        columns=[f"col_{i}" for i in range(10)]
    )

# ✅ 正确：缓存数据处理
@st.cache_data
def process_data(df, column, operation):
    """处理数据 - 根据参数缓存不同结果"""
    if operation == "mean":
        return df.groupby(column).mean() if column else df.mean()
    elif operation == "sum":
        return df.groupby(column).sum() if column else df.sum()
    elif operation == "count":
        return df.groupby(column).count() if column else df.count()

# ✅ 正确：缓存 ML 模型（全局共享）
@st.cache_resource
def load_model(model_name):
    """加载模型 - 全局共享，不会深拷贝"""
    time.sleep(2)  # 模拟模型加载
    return {"name": model_name, "version": "1.0"}

# ❌ 错误：不要在缓存函数中使用 st 组件
# @st.cache_data
# def bad_function():
#     st.write("这会报错")  # 不要在缓存函数中使用 st 组件
#     return data

# ✅ 正确：使用 show_spinner 提供用户反馈
@st.cache_data(show_spinner="正在加载数据，请稍候...")
def load_with_spinner():
    time.sleep(2)
    return pd.DataFrame({"a": [1, 2, 3]})

# 使用
df = load_large_dataset()
st.dataframe(df.head())
```

### 6.2 避免不必要的重运行

```python
import streamlit as st
import pandas as st
import time

# ❌ 错误：按钮点击后重运行整个脚本
# if st.button("加载数据"):
#     df = expensive_load()  # 每次点击都会重新执行

# ✅ 正确：使用 callback + session_state
if "data_loaded" not in st.session_state:
    st.session_state.data_loaded = False
    st.session_state.df = None

def load_data():
    time.sleep(2)  # 模拟耗时操作
    st.session_state.df = pd.DataFrame({"a": [1, 2, 3]})
    st.session_state.data_loaded = True

if st.button("加载数据", on_click=load_data):
    pass  # 实际工作在 callback 中

if st.session_state.data_loaded:
    st.dataframe(st.session_state.df)

# ✅ 正确：使用 st.empty 做局部更新
placeholder = st.empty()

if st.button("更新显示"):
    with placeholder.container():
        st.write("加载中...")
        time.sleep(1)
        st.write(f"更新完成: {time.time():.2f}")

# ✅ 正确：使用 fragment 做独立刷新
@st.fragment(run_every="5s")
def auto_refresh_section():
    st.write(f"自动刷新: {time.time():.2f}")
```

### 6.3 大数据集处理优化

```python
import streamlit as st
import pandas as pd
import numpy as np

@st.cache_data
def generate_large_data(n_rows):
    return pd.DataFrame({
        "id": range(n_rows),
        "value_a": np.random.randn(n_rows),
        "value_b": np.random.randn(n_rows),
        "category": np.random.choice(["A", "B", "C", "D"], n_rows),
    })

# 1. 分页显示
st.subheader("分页显示大数据集")
page_size = 100
total_rows = 10000

df = generate_large_data(total_rows)

page = st.number_input("页码", 1, total_rows // page_size, 1)
start = (page - 1) * page_size
end = start + page_size

st.dataframe(df.iloc[start:end], use_container_width=True)
st.write(f"显示第 {start+1}-{end} 行，共 {total_rows} 行")

# 2. 虚拟滚动（使用 st.dataframe 的 num_rows 参数）
st.subheader("虚拟滚动")
st.dataframe(df, height=400)  # 固定高度启用虚拟滚动

# 3. 采样显示
st.subheader("采样显示")
sample_size = st.slider("采样数量", 100, 5000, 1000)
sampled_df = df.sample(n=min(sample_size, len(df)), random_state=42)
st.dataframe(sampled_df, use_container_width=True)
```

### 6.4 内存优化

```python
import streamlit as st
import pandas as pd
import numpy as np

# 优化数据类型
@st.cache_data
def load_optimized_data():
    df = pd.DataFrame({
        "id": np.arange(1000000, dtype=np.int32),  # 使用 int32 而不是 int64
        "value": np.random.randn(1000000).astype(np.float32),  # 使用 float32
        "category": pd.Categorical(  # 使用 categorical 类型
            np.random.choice(["A", "B", "C", "D"], 1000000)
        ),
        "flag": np.random.choice([True, False], 1000000),  # bool 类型
    })
    return df

df = load_optimized_data()

# 显示内存使用
st.write(f"内存使用: {df.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB")
st.write(f"数据类型:\n{df.dtypes}")

# 只加载需要的列
st.subheader("选择列")
columns = st.multiselect("选择要显示的列", df.columns.tolist(), default=df.columns[:3].tolist())
if columns:
    st.dataframe(df[columns].head(100))
```

### 6.5 性能监控

```python
import streamlit as st
import time
import psutil
import os

def get_memory_usage():
    """获取当前进程内存使用"""
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024  # MB

# 性能监控面板
@st.fragment(run_every="3s")
def performance_monitor():
    st.subheader("性能监控")
    col1, col2, col3 = st.columns(3)
    col1.metric("内存使用", f"{get_memory_usage():.1f} MB")
    col2.metric("CPU使用", f"{psutil.cpu_percent()}%")
    col3.metric("进程数", len(psutil.pids()))

performance_monitor()
```
