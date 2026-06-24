---
title: "LeetCode Agent Lab - WebUI与可观测性"
date: 2025-06-22
order: 6
---

# LeetCode Agent Lab - WebUI 与可观测性

WebUI（`src/webui/`）和结构化日志（`src/activity_log/`）是项目的"人机交互"和"系统可观测"层。Streamlit 工作台提供了可视化的操作界面；EventLogger 提供了全链路的结构化日志。本文深入分析这两个模块的设计。

<!-- more -->

## 1. Streamlit Web 工作台

### 1.1 六页工作台

WebUI 基于 Streamlit 构建，提供 6 个功能页面：

| 页面 | 功能 |
|------|------|
| **Dashboard** | 健康检查和系统概览 |
| **Run** | 执行解题（ReactAgent / MultiAgent） |
| **LeetCode** | 拉取题目和在线提交 |
| **Benchmark** | Baseline vs Agent 对比实验 |
| **Records** | 运行历史和评分趋势 |
| **Config** | 配置查看器（脱敏显示） |

### 1.2 架构设计

```
┌─────────────────────────────────────────┐
│           Streamlit App                  │
│  ┌──────┬──────┬──────┬──────┬──────┐   │
│  │Dashboard│Run│LeetCode│Bench│Records│  │
│  └──┬───┴──┬──┴──┬───┴──┬──┴──┬───┘   │
│     └──────┴─────┴─────┴─────┘         │
│              ↓ 调用                      │
│  ┌─────────────────────────────────┐    │
│  │         Services Layer           │    │
│  │  services.py (multi_agent)       │    │
│  │  benchmark_services.py           │    │
│  │  react_agent_api/                │    │
│  └──────────────┬──────────────────┘    │
│                 ↓ 调用                    │
│  ┌─────────────────────────────────┐    │
│  │     multi_agent / react_agent    │    │
│  │     benchmark / core / ...       │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**设计要点：**
- 页面和业务逻辑分离——页面只负责 UI 渲染，业务逻辑在 Services 层
- Services 层封装了 multi_agent 和 react_agent 的调用接口
- Config 页面对敏感信息（API Key 等）做脱敏显示

### 1.3 组件复用

`components/` 目录包含可复用的 UI 组件：

| 组件 | 作用 |
|------|------|
| `forms/` | 表单组件（题目输入、配置选择） |
| `results/` | 结果展示组件（代码、测试结果、评分） |
| `console/` | 控制台输出组件（实时日志流） |

### 1.4 启动方式

```bash
# Streamlit UI
streamlit run src/webui/streamlit_app.py --server.port 17890

# Flask API（遗留，供程序化调用）
webui --host 127.0.0.1 --port 17890
```

## 2. 结构化日志系统

### 2.1 设计动机

调试 Agent 时，传统的断点调试效率极低——Agent 的执行涉及多轮 LLM 调用、工具执行、沙箱运行，每一步都可能出问题。结构化日志的作用是：**让每一步都可追踪、可回放**。

### 2.2 EventLogger 核心

`EventLogger` 是日志系统的核心类：

```python
class EventLogger:
    def __init__(
        self,
        sqlite_store: SQLiteEventStore | None = None,
        file_logger: logging.Logger | None = None,
        base_fields: dict[str, Any] | None = None,
    ):
        self.sqlite_store = sqlite_store
        self.file_logger = file_logger
        self.base_fields = dict(base_fields or {})
        self._log = structlog.get_logger("activity_log.event")
```

三个输出通道：
- **structlog**：控制台输出，开发时使用
- **file_logger**：JSONL 文件，持久化日志
- **SQLite**：结构化存储，支持查询和分析

### 2.3 上下文绑定

`bind()` 方法创建带上下文的子 Logger：

```python
def bind(self, **fields: Any) -> "EventLogger":
    merged = dict(self.base_fields)
    merged.update(strip_none(fields))
    return EventLogger(
        sqlite_store=self.sqlite_store,
        file_logger=self.file_logger,
        base_fields=merged,
    )
```

典型用法：

```python
# 创建 run 级别的 logger
run_logger = base_logger.bind(
    run_id="20250622_143012_two-sum",
    slug="two-sum",
    agent="react_agent",
)

# 之后所有事件自动携带 run_id 和 slug
run_logger.event("tool_call.start", tool_name="workspace_write_solution")
run_logger.event("tool_call.end", tool_name="workspace_write_solution", status="ok")
```

### 2.4 事件发射

`event()` 方法发射结构化事件：

```python
def event(self, event_name: str, level: str = "INFO", **fields: Any) -> dict[str, Any]:
    payload = {
        "schema_version": LOG_SCHEMA_VERSION,
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": normalize_log_level(level),
        "event": event_name,
        **strip_none(self.base_fields),
        **strip_none(fields),
    }
    payload = to_jsonable(payload)
    if self.sqlite_store:
        self.sqlite_store.write(payload)
    if self.file_logger:
        self.file_logger.log(level_no, event_name, extra={"_payload": payload})
    log_func = getattr(self._log, level.lower(), self._log.info)
    log_func(event_name, **extra)
    return payload
```

**设计要点：**
- 所有事件携带 `schema_version`，方便日志格式升级
- 时间戳使用 UTC ISO 格式
- `strip_none` 过滤 None 值，保持 payload 清洁
- `to_jsonable` 确保所有值可序列化

### 2.5 Span 上下文管理器

`span()` 是一个上下文管理器，自动记录操作的开始和结束，以及耗时：

```python
@contextmanager
def span(self, event_prefix: str, level: str = "INFO", **fields: Any) -> Iterator[None]:
    started = time.perf_counter()
    self.event(f"{event_prefix}.start", level=level, status="start", **fields)
    try:
        yield
    except Exception as exc:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        self.event(f"{event_prefix}.end", level="ERROR", status="error",
                   duration_ms=duration_ms, error_type=type(exc).__name__,
                   error_msg=str(exc), **fields)
        raise
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    self.event(f"{event_prefix}.end", level=level, status="ok",
               duration_ms=duration_ms, **fields)
```

使用示例：

```python
with run_logger.span("solver.solve", solver_profile="baseline"):
    result = solver.solve(problem)
# 自动记录：
# - solver.solve.start (status="start")
# - solver.solve.end   (status="ok", duration_ms=1234.56)
# 或
# - solver.solve.end   (status="error", error_type="LLMError", ...)
```

### 2.6 NOOP_EVENT_LOGGER

当不需要日志时，使用 `NOOP_EVENT_LOGGER` 单例：

```python
NOOP_EVENT_LOGGER = EventLogger()
```

它不会写入任何输出，但接口完全兼容，调用方不需要做 null 检查。

### 2.7 日志脱敏

`sanitize_text_snapshot()` 函数控制 prompt 和代码的日志记录级别：

| 模式 | 行为 |
|------|------|
| `off` | 不记录 |
| `hash` | 只记录哈希值 |
| `preview` | 记录前 N 个字符 |

这样可以在需要时查看 prompt 内容，又不会在生产环境中泄露敏感信息。

## 3. SQLite 事件存储

`SQLiteEventStore` 将事件持久化到 SQLite：

```python
class SQLiteEventStore:
    def write(self, payload: dict[str, Any]) -> None:
        # 将 payload 序列化为 JSON 写入 events 表
        ...
```

SQLite 存储的优势：
- 结构化查询：可以按 run_id、event_name、level 等维度查询
- 轻量级：不需要额外的数据库服务
- 可移植：数据库文件随项目迁移

## 4. 日志与调试工作流

典型的调试工作流：

```
1. 运行 Agent，生成 run_id
2. 查看 JSONL 文件，了解整体执行流程
3. 按 run_id 查询 SQLite，定位异常事件
4. 查看 span 耗时，找到性能瓶颈
5. 如果需要，查看 preview 模式的 prompt，分析 LLM 行为
```

## 5. 可观测性的三层架构

```
┌─────────────────────────────────────┐
│          应用层                       │
│  Agent / Orchestrator / Runner       │
│  通过 EventLogger 记录业务事件        │
├─────────────────────────────────────┤
│          传输层                       │
│  structlog + JSONL + SQLite          │
│  三通道并行写入                       │
├─────────────────────────────────────┤
│          存储层                       │
│  控制台（实时）+ 文件（持久）+ DB（查询）│
└─────────────────────────────────────┘
```

## 总结

| 知识点 | 要点 |
|--------|------|
| WebUI | Streamlit 6 页工作台，Services 层封装业务 |
| EventLogger | 三通道输出：structlog + JSONL + SQLite |
| bind() | 上下文绑定，自动携带 run_id / slug 等 |
| span() | 自动记录操作的开始、结束、耗时、异常 |
| NOOP | 空实现单例，接口兼容，无需 null 检查 |
| 脱敏 | off / hash / preview 三种模式 |
| 调试工作流 | JSONL → SQLite 查询 → span 耗时 → prompt 分析 |

*项目源码：[leetcode-coder-agent](https://github.com/chuoer47/leetcode-coder-agent)*
