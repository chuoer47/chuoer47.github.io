---
order: 2
tags: [Python, Streamlit, Web开发]
category: 开发
---

# Streamlit 核心组件

## 1. 文本组件

### 1.1 标题与文本

```python
import streamlit as st

# 标题
st.title("主标题")
st.header("一级标题")
st.subheader("二级标题")

# 普通文本
st.text("等宽字体文本，不会自动换行")

# Markdown 支持
st.markdown("**粗体** *斜体* `代码`")
st.markdown("## Markdown 标题")
st.markdown("- 列表项1\n- 列表项2\n- 列表项3")

# 带颜色的 Markdown
st.markdown(":red[红色文字] :blue[蓝色文字] :green[绿色文字]")

# LaTeX 公式
st.latex(r"E = mc^2")
st.latex(r"\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}")

# 代码块
st.code("""
def hello():
    print("Hello, Streamlit!")
""", language="python")

# 行内代码
st.markdown("使用 `pip install streamlit` 安装")

# 引用
st.markdown("> 这是一段引用文字")

# 分割线
st.divider()

# 注释
st.caption("这是一段小字说明")
```

### 1.2 状态提示

```python
import streamlit as st
import time

# 信息提示
st.info("这是一条信息提示")
st.success("操作成功！")
st.warning("注意：这是一个警告")
st.error("出错了！请检查输入")

# 特殊文本
st.title("标题", anchor="my-anchor")  # 带锚点
st.write("自动判断类型并渲染")
st.write(123)          # 数字
st.write([1, 2, 3])    # 列表
st.write({"a": 1})     # 字典
st.write(pd.DataFrame()) # DataFrame

# 使用 empty 占位符动态更新
placeholder = st.empty()
with placeholder.container():
    st.write("正在加载...")
    time.sleep(2)
    st.write("加载完成！")

# 可以清空
# placeholder.empty()
```

## 2. 输入组件

### 2.1 文本输入

```python
import streamlit as st

# 单行文本输入
name = st.text_input("姓名", placeholder="请输入你的名字")

# 多行文本输入
bio = st.text_area("个人简介", height=150, placeholder="介绍一下你自己...")

# 密码输入（隐藏输入内容）
password = st.text_input("密码", type="password")

# 带最大长度限制
limited = st.text_input("限长输入", max_chars=50)

# 带默认值
default_text = st.text_input("默认值", value="这是默认文本")

# 带标签帮助
help_text = st.text_input(
    "邮箱",
    help="请输入有效的邮箱地址",
    placeholder="example@mail.com"
)
```

### 2.2 数字输入

```python
import streamlit as st

# 基本数字输入
age = st.number_input("年龄", min_value=0, max_value=150, value=25)

# 浮点数
price = st.number_input("价格", min_value=0.0, max_value=1000.0,
                         value=9.99, step=0.01, format="%.2f")

# 步进值
count = st.number_input("数量", value=10, step=5)

# 带标签和帮助
score = st.number_input(
    "评分",
    min_value=0,
    max_value=100,
    value=60,
    help="请输入0-100之间的分数"
)
```

### 2.3 滑块

```python
import streamlit as st

# 基本滑块
age = st.slider("年龄", min_value=0, max_value=100, value=25)

# 带步进
score = st.slider("分数", 0, 100, 50, step=5)

# 浮点数滑块
temperature = st.slider("温度", 0.0, 40.0, 22.5, step=0.5)

# 范围选择
date_range = st.slider(
    "选择日期范围",
    value=(0, 100),
    help="选择一个范围"
)

# 带格式显示
weight = st.slider(
    "体重 (kg)",
    min_value=30.0,
    max_value=150.0,
    value=70.0,
    step=0.5,
    format="%.1f kg"
)

# 时间滑块
import datetime
time_val = st.slider(
    "选择时间",
    value=datetime.time(12, 0),
    format="HH:mm"
)
```

### 2.4 选择类组件

```python
import streamlit as st

# 下拉选择框
option = st.selectbox(
    "选择颜色",
    ["红色", "蓝色", "绿色", "黄色"],
    index=0  # 默认选中项
)

# 带索引的下拉
color = st.selectbox("颜色", ["红", "绿", "蓝"], index=1)

# 多选下拉
languages = st.multiselect(
    "选择编程语言",
    ["Python", "JavaScript", "Go", "Rust", "Java", "C++"],
    default=["Python"]
)

# 单选按钮
genre = st.radio(
    "选择音乐类型",
    ["流行", "摇滚", "爵士", "古典"],
    horizontal=True  # 水平排列
)

# 复选框
agree = st.checkbox("我同意服务条款")
enable_feature = st.checkbox("启用高级功能", value=True)

# 动态显示内容
if agree:
    st.success("感谢同意！")

if enable_feature:
    st.info("高级功能已启用")
```

### 2.5 按钮与文件上传

```python
import streamlit as st

# 普通按钮
if st.button("点击我"):
    st.balloons()
    st.toast("🎉 按钮被点击了！")

# 带类型的按钮
st.button("主要按钮", type="primary")
st.button("次要按钮", type="secondary")

# 带图标的按钮
st.button("🚀 发送", type="primary")
st.button("🔄 刷新")

# 文件上传
uploaded_file = st.file_uploader(
    "上传文件",
    type=["csv", "xlsx", "json", "txt", "png", "jpg"],
    accept_multiple_files=True,
    help="支持 CSV, Excel, JSON, TXT, 图片"
)

if uploaded_file:
    if isinstance(uploaded_file, list):
        for f in uploaded_file:
            st.write(f"文件名: {f.name}, 大小: {f.size} bytes")
    else:
        st.write(f"文件名: {uploaded_file.name}")
        st.write(f"文件类型: {uploaded_file.type}")
        st.write(f"文件大小: {uploaded_file.size} bytes")

# 下载按钮
st.download_button(
    label="📥 下载报告",
    data="这是报告内容",
    file_name="report.txt",
    mime="text/plain"
)

# 下载按钮（下载 DataFrame）
import pandas as pd
import io

df = pd.DataFrame({"A": [1, 2, 3], "B": [4, 5, 6]})
csv_buffer = io.StringIO()
df.to_csv(csv_buffer, index=False)

st.download_button(
    label="📥 下载CSV",
    data=csv_buffer.getvalue(),
    file_name="data.csv",
    mime="text/csv"
)
```

## 3. 数据展示组件

### 3.1 DataFrame 与 Table

```python
import streamlit as st
import pandas as pd
import numpy as np

# 创建示例数据
df = pd.DataFrame({
    "姓名": ["张三", "李四", "王五", "赵六", "钱七"],
    "年龄": [25, 30, 35, 28, 42],
    "城市": ["北京", "上海", "广州", "深圳", "杭州"],
    "分数": [85.5, 92.3, 78.9, 95.1, 88.7]
})

# 交互式 DataFrame（支持排序、筛选）
st.dataframe(df, use_container_width=True)

# 静态表格
st.table(df)

# 带列配置的 DataFrame
st.dataframe(
    df,
    column_config={
        "分数": st.column_config.NumberColumn(
            "分数",
            help="满分100",
            format="%.1f",
            min_value=0,
            max_value=100,
        ),
        "年龄": st.column_config.NumberColumn(
            "年龄",
            format="%d 岁",
        ),
    },
    hide_index=True,
    use_container_width=True
)
```

### 3.2 Metric 指标卡片

```python
import streamlit as st

# 单个指标
st.metric(label="当前用户数", value="1,234", delta="12.5%")

# 带方向的指标
col1, col2, col3 = st.columns(3)

with col1:
    st.metric("总收入", "¥1.2M", delta="5.2%")
with col2:
    st.metric("新用户", "1,023", delta="-3.1%")
with col3:
    st.metric("转化率", "3.2%", delta="0.5%")

# 多行指标
st.metric(
    label="日活跃用户",
    value="2,456",
    delta="123",
    delta_color="inverse"  # 反色（减少显示绿色）
)

# 指标卡片网格
metrics = [
    ("销售量", "1,234", "8.2%"),
    ("访问量", "5,678", "-2.1%"),
    ("转化率", "3.5%", "0.3%"),
    ("客单价", "¥299", "12.5%"),
]

cols = st.columns(4)
for i, (label, value, delta) in enumerate(metrics):
    with cols[i]:
        st.metric(label, value, delta=delta)
```

### 3.3 进度条与状态

```python
import streamlit as st
import time

# 基本进度条
progress = st.progress(0, text="加载中...")
for i in range(100):
    time.sleep(0.01)
    progress.progress(i + 1, text=f"进度: {i+1}%")
progress.empty()  # 完成后清除

# Spinner（加载动画）
with st.spinner("正在处理数据..."):
    time.sleep(2)
    st.success("处理完成！")

# 状态指示
status = st.status("正在运行...", expanded=True)
status.write("步骤 1: 加载数据")
time.sleep(1)
status.write("步骤 2: 处理数据")
time.sleep(1)
status.write("步骤 3: 生成报告")
time.sleep(1)
status.update(label="完成！", state="complete", expanded=False)
```

## 4. 布局组件

### 4.1 Sidebar 侧边栏

```python
import streamlit as st

# 侧边栏标题
st.sidebar.title("导航")

# 侧边栏选择
page = st.sidebar.radio(
    "选择页面",
    ["首页", "数据分析", "设置"]
)

# 侧边栏输入
username = st.sidebar.text_input("用户名")
password = st.sidebar.text_input("密码", type="password")

# 侧边栏按钮
if st.sidebar.button("登录"):
    if username and password:
        st.sidebar.success("登录成功！")
    else:
        st.sidebar.error("请输入用户名和密码")

# 侧边栏分隔线
st.sidebar.divider()

# 侧边栏信息
st.sidebar.markdown("### 关于")
st.sidebar.info("这是一个 Streamlit 示例应用")
st.sidebar.caption("版本 1.0.0")
```

### 4.2 Columns 列布局

```python
import streamlit as st

# 基本列布局
col1, col2, col3 = st.columns(3)

with col1:
    st.write("第一列")
    st.button("按钮1")

with col2:
    st.write("第二列")
    st.button("按钮2")

with col3:
    st.write("第三列")
    st.button("按钮3")

# 不等宽列
col1, col2, col3 = st.columns([2, 3, 1])  # 比例

with col1:
    st.write("窄列 (2)")

with col2:
    st.write("宽列 (3)")

with col3:
    st.write("最窄列 (1)")

# 嵌套列
outer_col1, outer_col2 = st.columns(2)

with outer_col1:
    st.write("外部左列")
    inner_col1, inner_col2 = st.columns(2)
    with inner_col1:
        st.write("内部左列")
    with inner_col2:
        st.write("内部右列")

with outer_col2:
    st.write("外部右列")
```

### 4.3 Tabs 标签页

```python
import streamlit as st
import pandas as pd
import numpy as np

# 基本标签页
tab1, tab2, tab3 = st.tabs(["📊 数据", "📈 图表", "⚙️ 设置"])

with tab1:
    st.header("数据视图")
    df = pd.DataFrame(
        np.random.randn(10, 3),
        columns=["A", "B", "C"]
    )
    st.dataframe(df)

with tab2:
    st.header("图表视图")
    st.line_chart(df)

with tab3:
    st.header("设置")
    option = st.selectbox("选择模式", ["标准", "高级"])
    st.write(f"当前模式: {option}")

# 动态标签页
tab_names = ["标签1", "标签2", "标签3"]
tabs = st.tabs(tab_names)

for i, tab in enumerate(tabs):
    with tab:
        st.write(f"这是第 {i+1} 个标签的内容")
```

### 4.4 Expander 折叠面板

```python
import streamlit as st

# 基本折叠面板
with st.expander("点击展开详情"):
    st.write("这里是详细信息...")
    st.write("更多内容...")

# 默认展开
with st.expander("默认展开", expanded=True):
    st.write("默认就是展开状态")

# 多层嵌套
with st.expander("外层"):
    st.write("外层内容")
    with st.expander("内层"):
        st.write("内层内容")
```

### 4.5 Container 容器

```python
import streamlit as st

# 容器可以包含任意组件
with st.container():
    st.write("这是容器1的内容")
    st.button("按钮1")

# 带边框的容器（Streamlit 1.28+）
with st.container(border=True):
    st.write("这是带边框的容器")
    st.button("按钮2")

# 高度限制的容器
with st.container(height=300):
    st.write("固定高度的容器")
    for i in range(20):
        st.write(f"第 {i} 行")
```

### 4.6 Form 表单

```python
import streamlit as st

# 表单：将多个输入组件打包，点击提交按钮后统一处理
with st.form("my_form"):
    st.write("注册表单")
    name = st.text_input("姓名")
    email = st.text_input("邮箱")
    age = st.number_input("年龄", min_value=0, max_value=150)
    gender = st.radio("性别", ["男", "女", "其他"], horizontal=True)
    agree = st.checkbox("同意条款")

    submitted = st.form_submit_button("提交", type="primary")

if submitted:
    if not name or not email:
        st.error("请填写姓名和邮箱！")
    elif not agree:
        st.warning("请同意条款！")
    else:
        st.success(f"注册成功！姓名: {name}, 邮箱: {email}")
        st.write(f"年龄: {age}, 性别: {gender}")

# 带边框的表单
with st.form("form_with_border", clear_on_submit=True):
    st.text_input("搜索关键词")
    submitted = st.form_submit_button("搜索")
    if submitted:
        st.write("搜索中...")
```

## 5. 媒体组件

```python
import streamlit as st

# 图片
st.image("https://picsum.photos/400/300", caption="随机图片")
st.image("logo.png", width=200)

# 音频
audio_file = open("audio.mp3", "rb")
st.audio(audio_file.read(), format="audio/mp3")

# 或从文件上传
uploaded_audio = st.file_uploader("上传音频", type=["mp3", "wav"])
if uploaded_audio:
    st.audio(uploaded_audio.read(), format=uploaded_audio.type)

# 视频
video_file = open("video.mp4", "rb")
st.video(video_file.read(), format="video/mp4")
```

## 6. 图表组件

```python
import streamlit as st
import pandas as pd
import numpy as np

# 创建示例数据
chart_data = pd.DataFrame(
    np.random.randn(20, 3),
    columns=["A", "B", "C"]
)

# 内置图表（基于 Altair）
st.line_chart(chart_data["A"])
st.area_chart(chart_data[["A", "B"]])
st.bar_chart(chart_data)

# 散点图
scatter_data = pd.DataFrame({
    "x": np.random.randn(100),
    "y": np.random.randn(100)
})
st.scatter_chart(scatter_data)

# 地图
map_data = pd.DataFrame(
    np.random.randn(100, 2) / [50, 50] + [37.76, -122.4],
    columns=["lat", "lon"]
)
st.map(map_data)
```

## 7. 组件速查表

| 类别 | 组件 | 用途 |
|------|------|------|
| 文本 | `st.title` | 页面大标题 |
| 文本 | `st.header` | 一级标题 |
| 文本 | `st.subheader` | 二级标题 |
| 文本 | `st.markdown` | Markdown渲染 |
| 文本 | `st.write` | 通用写入 |
| 文本 | `st.code` | 代码块 |
| 文本 | `st.latex` | LaTeX公式 |
| 输入 | `st.text_input` | 单行文本 |
| 输入 | `st.text_area` | 多行文本 |
| 输入 | `st.number_input` | 数字输入 |
| 输入 | `st.slider` | 滑块 |
| 输入 | `st.selectbox` | 下拉选择 |
| 输入 | `st.multiselect` | 多选下拉 |
| 输入 | `st.radio` | 单选按钮 |
| 输入 | `st.checkbox` | 复选框 |
| 输入 | `st.button` | 按钮 |
| 输入 | `st.file_uploader` | 文件上传 |
| 输入 | `st.download_button` | 下载按钮 |
| 展示 | `st.dataframe` | 交互式表格 |
| 展示 | `st.table` | 静态表格 |
| 展示 | `st.metric` | 指标卡片 |
| 展示 | `st.progress` | 进度条 |
| 展示 | `st.spinner` | 加载动画 |
| 展示 | `st.status` | 状态指示 |
| 布局 | `st.sidebar` | 侧边栏 |
| 布局 | `st.columns` | 列布局 |
| 布局 | `st.tabs` | 标签页 |
| 布局 | `st.expander` | 折叠面板 |
| 布局 | `st.container` | 容器 |
| 布局 | `st.form` | 表单 |
| 图表 | `st.line_chart` | 折线图 |
| 图表 | `st.bar_chart` | 柱状图 |
| 图表 | `st.area_chart` | 面积图 |
| 图表 | `st.scatter_chart` | 散点图 |
| 图表 | `st.map` | 地图 |
| 媒体 | `st.image` | 图片 |
| 媒体 | `st.audio` | 音频 |
| 媒体 | `st.video` | 视频 |
| 状态 | `st.success` | 成功提示 |
| 状态 | `st.info` | 信息提示 |
| 状态 | `st.warning` | 警告提示 |
| 状态 | `st.error` | 错误提示 |
| 状态 | `st.toast` | 临时通知 |
| 其他 | `st.divider` | 分割线 |
| 其他 | `st.empty` | 空占位符 |
| 其他 | `st.caption` | 小字说明 |
