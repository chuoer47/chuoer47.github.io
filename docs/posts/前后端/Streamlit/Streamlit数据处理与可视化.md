---
order: 3
tags: [Python, Streamlit, 数据可视化]
category: 开发
---

# Streamlit 数据处理与可视化

## 1. 数据加载

### 1.1 从文件上传

```python
import streamlit as st
import pandas as pd
import json

st.title("数据加载")

uploaded_file = st.file_uploader(
    "上传数据文件",
    type=["csv", "xlsx", "json", "parquet"],
    help="支持 CSV、Excel、JSON、Parquet 格式"
)

if uploaded_file:
    file_type = uploaded_file.type

    if file_type == "text/csv":
        # 尝试不同编码
        try:
            df = pd.read_csv(uploaded_file, encoding="utf-8")
        except UnicodeDecodeError:
            uploaded_file.seek(0)
            df = pd.read_csv(uploaded_file, encoding="gbk")

    elif file_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        # Excel 文件，可以选择 sheet
        xls = pd.ExcelFile(uploaded_file)
        sheet_name = st.selectbox("选择工作表", xls.sheet_names)
        df = pd.read_excel(uploaded_file, sheet_name=sheet_name)

    elif file_type == "application/json":
        df = pd.read_json(uploaded_file)

    else:
        df = pd.read_parquet(uploaded_file)

    # 数据预览
    st.subheader("数据预览")
    tab1, tab2, tab3 = st.tabs(["数据", "统计", "信息"])

    with tab1:
        n_rows = st.slider("显示行数", 5, 100, 10)
        st.dataframe(df.head(n_rows), use_container_width=True)

    with tab2:
        st.dataframe(df.describe(), use_container_width=True)

    with tab3:
        st.write(f"行数: {df.shape[0]}")
        st.write(f"列数: {df.shape[1]}")
        st.write(f"数据类型:")
        st.dataframe(df.dtypes.to_frame("类型").T)

    # 下载处理后的数据
    csv = df.to_csv(index=False).encode("utf-8")
    st.download_button(
        "下载处理后的数据",
        csv,
        "processed_data.csv",
        "text/csv"
    )
```

### 1.2 从数据库加载

```python
import streamlit as st
import pandas as pd
from sqlalchemy import create_engine

# SQLite（简单示例）
@st.cache_resource
def get_sqlite_engine():
    return create_engine("sqlite:///data.db")

# PostgreSQL
@st.cache_resource
def get_postgres_engine():
    return create_engine(
        "postgresql://user:password@localhost:5432/mydb"
    )

# MySQL
@st.cache_resource
def get_mysql_engine():
    return create_engine(
        "mysql+pymysql://user:password@localhost:3306/mydb"
    )

# 使用
engine = get_sqlite_engine()

query = st.text_area("输入 SQL 查询", "SELECT * FROM my_table LIMIT 100")

if st.button("执行查询"):
    try:
        df = pd.read_sql(query, engine)
        st.dataframe(df, use_container_width=True)
    except Exception as e:
        st.error(f"查询失败: {e}")
```

### 1.3 从 URL 加载

```python
import streamlit as st
import pandas as pd

url = st.text_input(
    "输入数据URL",
    value="https://raw.githubusercontent.com/cs109/2014_data/master/countries.csv"
)

if st.button("加载数据"):
    try:
        df = pd.read_csv(url)
        st.dataframe(df.head(20), use_container_width=True)
        st.success(f"成功加载 {len(df)} 行数据")
    except Exception as e:
        st.error(f"加载失败: {e}")

# 使用内置示例数据集
st.subheader("内置示例数据集")
datasets = {
    "Iris": pd.read_csv("https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv"),
    "Tips": pd.read_csv("https://raw.githubusercontent.com/mwaskom/seaborn-data/master/tips.csv"),
    "Titanic": pd.read_csv("https://raw.githubusercontent.com/mwaskom/seaborn-data/master/titanic.csv"),
}

selected = st.selectbox("选择数据集", list(datasets.keys()))
if selected:
    df = datasets[selected]
    st.dataframe(df, use_container_width=True)
```

## 2. Pandas 集成与动态筛选

### 2.1 Column Config 列配置

```python
import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# 创建丰富的示例数据
np.random.seed(42)
n = 100

df = pd.DataFrame({
    "姓名": [f"用户{i+1}" for i in range(n)],
    "年龄": np.random.randint(18, 65, n),
    "收入": np.random.uniform(3000, 30000, n).round(2),
    "城市": np.random.choice(["北京", "上海", "广州", "深圳", "杭州", "成都"], n),
    "评分": np.random.uniform(1, 5, n).round(1),
    "是否活跃": np.random.choice([True, False], n),
    "注册日期": pd.date_range("2023-01-01", periods=n, freq="D"),
    "头像": [f"https://i.pravatar.cc/100?img={i%70+1}" for i in range(n)],
})

# 高级列配置
st.dataframe(
    df,
    column_config={
        "姓名": st.column_config.TextColumn("姓名", width="medium"),
        "年龄": st.column_config.NumberColumn("年龄", format="%d 岁"),
        "收入": st.column_config.NumberColumn(
            "月收入",
            format="¥%.2f",
            min_value=0,
        ),
        "城市": st.column_config.SelectboxColumn(
            "城市",
            options=["北京", "上海", "广州", "深圳", "杭州", "成都"],
        ),
        "评分": st.column_config.ProgressColumn(
            "评分",
            min_value=0,
            max_value=5,
            format="%.1f ⭐",
        ),
        "是否活跃": st.column_config.CheckboxColumn("是否活跃"),
        "注册日期": st.column_config.DatetimeColumn(
            "注册日期",
            format="YYYY-MM-DD",
        ),
        "头像": st.column_config.ImageColumn("头像", width="small"),
    },
    hide_index=True,
    use_container_width=True,
    num_rows="dynamic",  # 允许编辑行数
)
```

### 2.2 动态筛选器

```python
import streamlit as st
import pandas as pd
import numpy as np

# 加载数据
@st.cache_data
def load_data():
    np.random.seed(42)
    return pd.DataFrame({
        "产品": np.random.choice(["笔记本", "手机", "平板", "耳机", "键盘"], 200),
        "类别": np.random.choice(["电子", "配件", "外设"], 200),
        "价格": np.random.uniform(50, 5000, 200).round(2),
        "销量": np.random.randint(1, 100, 200),
        "评分": np.random.uniform(1, 5, 200).round(1),
        "日期": pd.date_range("2024-01-01", periods=200, freq="D"),
        "地区": np.random.choice(["华北", "华东", "华南", "西南", "西北"], 200),
    })

df = load_data()

st.title("产品销售数据分析")

# 侧边栏筛选器
with st.sidebar:
    st.header("筛选条件")

    # 产品多选
    products = st.multiselect(
        "产品",
        df["产品"].unique(),
        default=df["产品"].unique()
    )

    # 类别筛选
    categories = st.multiselect(
        "类别",
        df["类别"].unique(),
        default=df["类别"].unique()
    )

    # 价格范围
    price_range = st.slider(
        "价格范围",
        float(df["价格"].min()),
        float(df["价格"].max()),
        (float(df["价格"].min()), float(df["价格"].max()))
    )

    # 评分筛选
    min_rating = st.slider("最低评分", 0.0, 5.0, 0.0, 0.1)

    # 地区筛选
    regions = st.multiselect(
        "地区",
        df["地区"].unique(),
        default=df["地区"].unique()
    )

# 应用筛选
filtered_df = df[
    (df["产品"].isin(products)) &
    (df["类别"].isin(categories)) &
    (df["价格"] >= price_range[0]) &
    (df["价格"] <= price_range[1]) &
    (df["评分"] >= min_rating) &
    (df["地区"].isin(regions))
]

# 显示结果
col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric("总记录数", len(filtered_df))
with col2:
    st.metric("平均价格", f"¥{filtered_df['价格'].mean():.2f}")
with col3:
    st.metric("总销量", f"{filtered_df['销量'].sum():,}")
with col4:
    st.metric("平均评分", f"{filtered_df['评分'].mean():.1f}")

st.dataframe(filtered_df, use_container_width=True)
```

## 3. 原生图表

### 3.1 内置图表类型

```python
import streamlit as st
import pandas as pd
import numpy as np

np.random.seed(42)
dates = pd.date_range("2024-01-01", periods=365, freq="D")

data = pd.DataFrame({
    "日期": dates,
    "销售额": np.random.uniform(1000, 5000, 365).cumsum(),
    "访问量": np.random.randint(100, 1000, 365).cumsum(),
    "转化率": np.random.uniform(0.01, 0.1, 365),
})

st.subheader("折线图")
st.line_chart(data.set_index("日期")[["销售额", "访问量"]])

st.subheader("面积图")
st.area_chart(data.set_index("日期")[["销售额", "访问量"]])

st.subheader("柱状图")
monthly = data.set_index("日期").resample("M").sum()
st.bar_chart(monthly[["销售额"]])

st.subheader("散点图")
scatter_data = pd.DataFrame({
    "x": np.random.randn(200),
    "y": np.random.randn(200),
    "size": np.random.uniform(10, 100, 200),
})
st.scatter_chart(scatter_data)

st.subheader("地图")
map_data = pd.DataFrame(
    np.random.randn(500, 2) / [50, 50] + [37.76, -122.4],
    columns=["lat", "lon"]
)
st.map(map_data, color="#FF6B6B", size=20)
```

## 4. Plotly 可视化

### 4.1 Plotly Express 快速图表

```python
import streamlit as st
import plotly.express as px
import pandas as pd
import numpy as np

# 使用内置数据集
df = px.data.gapminder()

# 散点图
st.subheader("Plotly Express 散点图")
fig = px.scatter(
    df.query("year == 2007"),
    x="gdpPercap",
    y="lifeExp",
    size="pop",
    color="continent",
    hover_name="country",
    log_x=True,
    size_max=60,
    title="2007年 各国GDP与寿命关系"
)
st.plotly_chart(fig, use_container_width=True)

# 动画散点图
st.subheader("动态散点图 (带时间动画)")
fig_anim = px.scatter(
    df,
    x="gdpPercap",
    y="lifeExp",
    size="pop",
    color="continent",
    hover_name="country",
    animation_frame="year",
    animation_group="country",
    log_x=True,
    size_max=55,
    range_x=[100, 100000],
    range_y=[25, 90],
    title="各国发展进程 (1952-2007)"
)
st.plotly_chart(fig_anim, use_container_width=True)

# 折线图
st.subheader("折线图")
line_data = df[df["country"].isin(["China", "India", "United States"])]
fig_line = px.line(
    line_data,
    x="year",
    y="gdpPercap",
    color="country",
    title="中美印GDP变化趋势"
)
st.plotly_chart(fig_line, use_container_width=True)

# 柱状图
st.subheader("柱状图")
bar_data = df[df["year"] == 2007].nlargest(10, "pop")
fig_bar = px.bar(
    bar_data,
    x="country",
    y="pop",
    color="continent",
    title="2007年人口Top10国家"
)
st.plotly_chart(fig_bar, use_container_width=True)
```

### 4.2 Plotly Graph Objects 精细控制

```python
import streamlit as st
import plotly.graph_objects as go
import numpy as np
import pandas as np

# 创建子图
st.subheader("子图布局")

fig = go.Figure()

# 添加多条线
x = np.linspace(0, 10, 100)

fig.add_trace(go.Scatter(
    x=x, y=np.sin(x),
    mode="lines",
    name="sin(x)",
    line=dict(color="blue", width=2)
))

fig.add_trace(go.Scatter(
    x=x, y=np.cos(x),
    mode="lines+markers",
    name="cos(x)",
    line=dict(color="red", width=2, dash="dash"),
    marker=dict(size=4)
))

fig.update_layout(
    title="三角函数图",
    xaxis_title="X",
    yaxis_title="Y",
    template="plotly_white",
    hovermode="x unified"
)

st.plotly_chart(fig, use_container_width=True)

# 3D 散点图
st.subheader("3D 散点图")
np.random.seed(42)
n = 100
fig_3d = go.Figure(data=[go.Scatter3d(
    x=np.random.randn(n),
    y=np.random.randn(n),
    z=np.random.randn(n),
    mode="markers",
    marker=dict(
        size=5,
        color=np.random.randn(n),
        colorscale="Viridis",
        opacity=0.8
    )
)])
fig_3d.update_layout(
    title="3D 散点图",
    scene=dict(
        xaxis_title="X",
        yaxis_title="Y",
        zaxis_title="Z"
    )
)
st.plotly_chart(fig_3d, use_container_width=True)

# 热力图
st.subheader("热力图")
z = np.random.randn(10, 10)
fig_heat = go.Figure(data=go.Heatmap(
    z=z,
    colorscale="RdBu_r",
    colorbar=dict(title="值")
))
fig_heat.update_layout(title="相关性热力图")
st.plotly_chart(fig_heat, use_container_width=True)

# 饼图
st.subheader("饼图")
fig_pie = go.Figure(data=[go.Pie(
    labels=["电子产品", "服装配饰", "食品饮料", "家居用品", "图书文具"],
    values=[35, 25, 20, 12, 8],
    hole=0.3,  # 环形饼图
    textinfo="label+percent"
)])
fig_pie.update_layout(title="销售额占比")
st.plotly_chart(fig_pie, use_container_width=True)
```

### 4.3 Plotly 动画

```python
import streamlit as st
import plotly.express as px
import pandas as pd
import numpy as np

# 创建动画数据
np.random.seed(42)
frames_data = []
for year in range(2000, 2024):
    df_year = pd.DataFrame({
        "x": np.random.randn(50) * (1 + year/100),
        "y": np.random.randn(50) * (1 + year/100),
        "size": np.random.uniform(10, 100, 50),
        "category": np.random.choice(["A", "B", "C"], 50),
        "year": year
    })
    frames_data.append(df_year)

df_anim = pd.concat(frames_data)

# 动画散点图
fig = px.scatter(
    df_anim,
    x="x",
    y="y",
    size="size",
    color="category",
    animation_frame="year",
    range_x=[-10, 10],
    range_y=[-10, 10],
    title="数据分布随时间变化"
)
st.plotly_chart(fig, use_container_width=True)

# 控制播放速度
st.subheader("动画控制")
speed = st.slider("动画速度", 50, 2000, 500)
fig.layout.updatemenus[0].buttons[0].args[1]["frame"]["duration"] = speed
st.plotly_chart(fig, use_container_width=True)
```

## 5. Altair 可视化

```python
import streamlit as st
import altair as alt
import pandas as pd
import numpy as np

# 示例数据
np.random.seed(42)
df = pd.DataFrame({
    "x": np.random.randn(200),
    "y": np.random.randn(200),
    "category": np.random.choice(["A", "B", "C"], 200),
    "size": np.random.uniform(10, 100, 200),
    "date": pd.date_range("2024-01-01", periods=200, freq="D")
})

# 基本散点图
st.subheader("Altair 散点图")
chart = alt.Chart(df).mark_circle(size=60).encode(
    x="x:Q",
    y="y:Q",
    color="category:N",
    tooltip=["x", "y", "category"]
).interactive()

st.altair_chart(chart, use_container_width=True)

# 带交互的柱状图
st.subheader("交互式柱状图")
bar_chart = alt.Chart(df).mark_bar().encode(
    x="category:N",
    y="count():Q",
    color="category:N",
    tooltip=["category", "count()"]
).interactive()

st.altair_chart(bar_chart, use_container_width=True)

# 时间序列图
st.subheader("时间序列")
time_df = df.set_index("date").resample("W").size().reset_index(name="count")
line_chart = alt.Chart(time_df).mark_line(
    color="steelblue",
    strokeWidth=2
).encode(
    x="date:T",
    y="count:Q",
    tooltip=["date", "count"]
).interactive()

st.altair_chart(line_chart, use_container_width=True)

# 热力图
st.subheader("Altair 热力图")
heatmap_data = pd.DataFrame({
    "x": list(range(10)) * 10,
    "y": [i for i in range(10)] * 10,
    "value": np.random.randn(100)
})

heatmap = alt.Chart(heatmap_data).mark_rect().encode(
    x="x:O",
    y="y:O",
    color="value:Q",
    tooltip=["x", "y", "value"]
).properties(width=400, height=400)

st.altair_chart(heatmap, use_container_width=True)
```

## 6. Matplotlib 可视化

```python
import streamlit as st
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体
plt.rcParams["font.sans-serif"] = ["SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

st.subheader("Matplotlib 图表")

# 基本图表
fig, axes = plt.subplots(2, 2, figsize=(12, 8))

# 折线图
x = np.linspace(0, 10, 100)
axes[0, 0].plot(x, np.sin(x), label="sin(x)")
axes[0, 0].plot(x, np.cos(x), label="cos(x)")
axes[0, 0].set_title("三角函数")
axes[0, 0].legend()

# 柱状图
categories = ["A", "B", "C", "D"]
values = [23, 45, 56, 78]
axes[0, 1].bar(categories, values, color=["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4"])
axes[0, 1].set_title("柱状图")

# 散点图
x = np.random.randn(50)
y = np.random.randn(50)
axes[1, 0].scatter(x, y, c=np.random.rand(50), cmap="viridis", s=100)
axes[1, 0].set_title("散点图")

# 饼图
sizes = [35, 25, 20, 15, 5]
labels = ["电子", "服装", "食品", "家居", "其他"]
axes[1, 1].pie(sizes, labels=labels, autopct="%1.1f%%")
axes[1, 1].set_title("销售占比")

plt.tight_layout()
st.pyplot(fig)

# 3D 图形
st.subheader("Matplotlib 3D 图形")
fig_3d = plt.figure(figsize=(10, 6))
ax = fig_3d.add_subplot(111, projection="3d")

x = np.random.randn(100)
y = np.random.randn(100)
z = np.random.randn(100)
ax.scatter(x, y, z, c=z, cmap="viridis", s=50)
ax.set_xlabel("X")
ax.set_ylabel("Y")
ax.set_zlabel("Z")
ax.set_title("3D 散点图")

st.pyplot(fig_3d)

# 动态图表（使用缓存）
st.subheader("动态图表")
if st.button("生成新数据"):
    fig_dynamic, ax = plt.subplots()
    x = np.linspace(0, 10, 100)
    ax.plot(x, np.random.randn(100).cumsum())
    ax.set_title("随机行走")
    st.pyplot(fig_dynamic)
```

## 7. PyDeck 地图可视化

```python
import streamlit as st
import pydeck as pdk
import pandas as pd
import numpy as np

# 生成示例数据
np.random.seed(42)
n = 500
map_df = pd.DataFrame({
    "lat": np.random.uniform(30, 40, n),
    "lon": np.random.uniform(115, 125, n),
    "value": np.random.uniform(0, 100, n),
    "name": [f"地点{i+1}" for i in range(n)]
})

# 基本散点图层
st.subheader("散点图层")
layer = pdk.Layer(
    "ScatterplotLayer",
    data=map_df,
    get_position=["lon", "lat"],
    get_radius=500,
    get_fill_color="[255, 107, 107, 160]",
    pickable=True,
    auto_highlight=True,
)

view = pdk.ViewState(
    latitude=35,
    longitude=120,
    zoom=5,
    pitch=0
)

map1 = pdk.Deck(
    layers=[layer],
    initial_view_state=view,
    tooltip={"text": "{name}\n数值: {value:.2f}"}
)
st.pydeck_chart(map1)

# 热力图层
st.subheader("热力图层")
heatmap_layer = pdk.Layer(
    "HeatmapLayer",
    data=map_df,
    get_position=["lon", "lat"],
    get_weight="value",
    radiusPixels=30,
    intensity=1,
    threshold=0.05,
)

map2 = pdk.Deck(
    layers=[heatmap_layer],
    initial_view_state=view,
)
st.pydeck_chart(map2)

# 可视化柱状图层（3D 柱状图）
st.subheader("3D 柱状图")
bar_df = map_df.head(50).copy()
bar_df["height"] = bar_df["value"] * 100

bar_layer = pdk.Layer(
    "ColumnLayer",
    data=bar_df,
    get_position=["lon", "lat"],
    get_elevation="height",
    elevation_scale=50,
    radius=200,
    get_fill_color=["255", "107", "107", "160"],
    pickable=True,
    auto_highlight=True,
)

view_3d = pdk.ViewState(
    latitude=35,
    longitude=120,
    zoom=5,
    pitch=45
)

map3 = pdk.Deck(
    layers=[bar_layer],
    initial_view_state=view_3d,
    tooltip={"text": "{name}\n数值: {value:.2f}\n高度: {height:.0f}"}
)
st.pydeck_chart(map3)

# 路径图层
st.subheader("路径图层")
path_df = pd.DataFrame({
    "path": [
        [[116.4, 39.9], [121.5, 31.2]],
        [[116.4, 39.9], [113.3, 23.1]],
        [[116.4, 39.9], [104.1, 30.6]],
    ],
    "name": ["北京-上海", "北京-广州", "北京-成都"],
    "color": [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
})

path_layer = pdk.Layer(
    "PathLayer",
    data=path_df,
    get_path="path",
    get_color="color",
    width_min_pixels=3,
    get_width=5,
)

map4 = pdk.Deck(
    layers=[path_layer],
    initial_view_state=view,
)
st.pydeck_chart(map4)
```

## 8. 实时数据更新与 Fragment

### 8.1 使用 Fragment 局部刷新

```python
import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime

st.title("实时数据仪表盘")

# 使用 fragment 实现局部刷新（不刷新整个页面）
@st.fragment(run_every="2s")  # 每2秒自动刷新
def live_metrics():
    """实时指标 - 独立刷新"""
    st.subheader("实时指标")
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.metric("在线用户", np.random.randint(100, 200))
    with col2:
        st.metric("CPU使用率", f"{np.random.uniform(20, 80):.1f}%")
    with col3:
        st.metric("内存使用", f"{np.random.uniform(40, 90):.1f}%")
    with col4:
        st.metric("响应时间", f"{np.random.uniform(10, 100):.0f}ms")

    st.caption(f"最后更新: {datetime.now().strftime('%H:%M:%S')}")

# 使用缓存的 fragment
@st.fragment(run_every="5s")
def live_chart():
    """实时图表 - 独立刷新"""
    st.subheader("实时流量")
    data = pd.DataFrame({
        "时间": pd.date_range(end=datetime.now(), periods=30, freq="1min"),
        "请求数": np.random.randint(50, 200, 30),
        "响应时间": np.random.uniform(10, 100, 30),
    })
    st.line_chart(data.set_index("时间")[["请求数"]])

# 静态部分 - 不会被频繁刷新
st.subheader("历史数据")
static_data = pd.DataFrame({
    "日期": pd.date_range("2024-01-01", periods=30, freq="D"),
    "销售额": np.random.uniform(1000, 5000, 30),
})
st.bar_chart(static_data.set_index("日期"))

# 渲染 fragment
live_metrics()
live_chart()
```

### 8.2 手动刷新与定时更新

```python
import streamlit as st
import time
from datetime import datetime

st.title("数据更新示例")

# 方式1：按钮刷新
if st.button("🔄 立即刷新"):
    st.rerun()

# 方式2：自动刷新（使用 st.empty + 循环）
st.subheader("自动刷新（5秒间隔）")
placeholder = st.empty()

for i in range(5):  # 只刷新5次作为示例
    with placeholder.container():
        st.write(f"第 {i+1} 次刷新")
        st.write(f"当前时间: {datetime.now().strftime('%H:%M:%S')}")
        st.write(f"随机数: {np.random.randint(1, 100)}")
    time.sleep(5)

st.success("自动刷新完成")

# 方式3：使用 st.fragment（推荐）
@st.fragment(run_every="3s")
def auto_refresh():
    st.write(f"🔄 Fragment 自动刷新: {datetime.now().strftime('%H:%M:%S')}")

auto_refresh()
```

### 8.3 带回调的数据更新

```python
import streamlit as st
import pandas as pd
import numpy as np

st.title("回调式数据更新")

# 初始化 session state
if "data" not in st.session_state:
    st.session_state.data = pd.DataFrame({
        "x": range(10),
        "y": np.random.randn(10)
    })

# 更新回调
def update_data():
    new_row = pd.DataFrame({
        "x": [st.session_state.data["x"].max() + 1],
        "y": [np.random.randn()]
    })
    st.session_state.data = pd.concat(
        [st.session_state.data, new_row],
        ignore_index=True
    )

# 手动添加
col1, col2 = st.columns(2)
with col1:
    st.button("添加数据点", on_click=update_data)

with col2:
    if st.button("清空数据"):
        st.session_state.data = pd.DataFrame({"x": [], "y": []})

# 显示图表
st.line_chart(st.session_state.data.set_index("x"))
st.dataframe(st.session_state.data, use_container_width=True)
```
