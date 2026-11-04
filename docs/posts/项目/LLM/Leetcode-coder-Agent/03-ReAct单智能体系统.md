---
title: "LeetCode Agent Lab - ReAct单智能体系统"
date: 2025-06-22
order: 3
---

# LeetCode Agent Lab - ReAct 单智能体系统

单 ReAct Agent（`src/react_agent/`）是项目的另一条技术路线。与多 Agent 协作不同，ReAct Agent 用一个循环完成所有工作：思考 → 调用工具 → 观察结果 → 继续思考。本文深入分析其架构演进、核心循环、风险追踪等设计。

<!-- more -->

## 1. 架构演进：三个版本

ReAct Agent 经历了三次架构迭代：

```
V1: Planner + ReAct     →  Planner 规划步骤，ReAct 执行
V2: 六状态机             →  6 个显式状态，状态间转移
V3: 单 ReAct 循环 (最终) →  一个循环搞定一切
```

**为什么最终选择了单 ReAct 循环？**

V1 的 Planner + ReAct 看起来很合理，但实际跑起来发现：Planner 的规划质量很差，经常规划出不合理的步骤，反而干扰了 ReAct 的执行。V2 的六状态机太复杂，状态转移逻辑难以维护。

最终的 V3 单 ReAct 循环反而效果最好：让模型自己决定下一步做什么，不需要外部的状态机约束。这和行业内"简单的 Agent 架构往往效果更好"的经验一致。

## 2. ReAct 循环核心

### 2.1 循环流程

```
构建 prompt → 列出可用工具 → 模型输出决策
    ↓
tool_call? → 执行工具 → 返回观测 → 继续循环
final_answer? → 本地测试验证 → 可选在线提交 → 结束
超时/超预算? → 强制结束
```

### 2.2 ReActLoopAgent — 决策核心

`ReActLoopAgent` 是循环的决策引擎，每次调用返回一个 `ActionDecision`：

```python
class ReActLoopAgent:
    def decide(
        self,
        *,
        problem: dict[str, Any],
        retrieved_memories: list[dict[str, Any]],
        trace_tail: list[ReactTraceEntry],   # 最近 K 步的执行轨迹
        turn_index: int,
        policy: SingleAgentPolicy,
        available_tools: list[dict[str, Any]],
        working_state: dict[str, Any],        # 当前工作状态
        loop_metrics: dict[str, Any],          # 循环指标（已用步数等）
    ) -> ActionDecision:
        response = self.backend.chat_json(
            system_prompt=build_react_loop_system_prompt(
                available_tools=available_tools,
                profile=self.prompt_profile,
            ),
            user_prompt=build_react_loop_user_prompt(
                problem=problem,
                retrieved_memories=retrieved_memories,
                trace_tail=trace_tail,
                turn_index=turn_index,
                policy=policy,
                working_state=working_state,
                loop_metrics=loop_metrics,
            ),
            temperature=self.temperature,
        )
        return parse_action_response(response)
```

**设计要点：**
- `trace_tail` 只传最近 K 步，避免上下文无限膨胀
- `working_state` 传递当前工作状态（已写入的代码、已运行的测试等）
- `available_tools` 动态传入，支持运行时启用/禁用工具
- JSON 解析失败时抛出 `ProtocolParseError`，让运行时按 protocol_error 重试，而不是整次中断

### 2.3 ReactAgentRunner — 运行器

`ReactAgentRunner`（约 700 行）是完整的运行器，管理整个 ReAct 循环的生命周期：

```python
class ReactAgentRunner:
    """约束：
    - 不做外部编排（无状态机）。
    - 只负责：构建上下文 → 请求模型 → 执行工具 → 追加观测 → 继续循环 → 预算控制。
    """
```

运行器维护一个 `_LoopState` 可变状态对象：

```python
class _LoopState:
    def __init__(self, working_state: dict[str, Any] | None = None) -> None:
        self.trace: list[ReactTraceEntry] = []      # 完整执行轨迹
        self.working_state: dict[str, Any] = ...     # 工作状态
        self.tool_calls: int = 0                      # 工具调用次数
        self.tool_errors: int = 0                     # 工具错误次数
        self.stopped_reason: str = "max_steps_reached"  # 停止原因
        self.final_code: str = ""                     # 最终代码
        self.risk_metrics: RiskTracker = RiskTracker()  # 风险追踪
```

## 3. 工具调用与权限控制

### 3.1 工具白名单

ReAct Agent 不是所有工具都能用。通过 `tool_catalog` 模块管理工具白名单：

```python
# 工具白名单配置
base_allowed_tools = load_tool_allowlist(profile="default")

# 动态调整
allowed_tools = select_allowed_tool_names(
    base_allowed_tools=base_allowed_tools,
    enable_duel=policy.enable_duel,                # 是否启用对拍工具
    enable_memory_retrieval=policy.enable_memory_retrieval,  # 是否启用记忆检索
)
```

当模型调用不在白名单中的工具时：

```python
if base_tool_name not in allowed_tool_names:
    state.tool_errors += 1
    state.risk_metrics.inc("tool_not_allowed")
    state.trace.append(ReactTraceEntry(
        observation_summary=f"工具未允许: {base_tool_name}",
        status="error",
    ))
    return
```

### 3.2 工具参数归一化

模型输出的工具参数可能有各种问题（类型错误、缺少字段等）。`normalize_tool_arguments` 在执行前做统一归一化：

```python
normalized_arguments = self._normalize_tool_arguments(
    tool_name=base_tool_name,
    arguments=normalized_arguments,
    problem=problem,
    working_state=state.working_state,
)
```

### 3.3 工具网关（ToolGateway）

`ToolGateway` 是 react_agent 对 tool_executor 的薄封装，提供 4 个核心方法：

| 方法 | 作用 |
|------|------|
| `load_problem` | 加载题目 |
| `retrieve_memories` | 检索记忆 |
| `run_solution` | 执行代码测试 |
| `call` | 通用工具调用 |

## 4. 风险追踪（RiskTracker）

`RiskTracker` 追踪运行过程中的风险指标：

| 指标 | 含义 |
|------|------|
| `submission_attempts` | 在线提交次数 |
| `sandbox_degrade_events` | 沙箱降级事件 |
| `tool_not_allowed` | 工具未允许调用次数 |
| `protocol_errors` | 协议解析错误次数 |
| `tool_normalize_errors` | 工具参数归一化错误次数 |

这些指标可以用来：
- 调试 Agent 行为（为什么 Agent 反复调用不允许的工具？）
- 评估 Agent 的稳定性
- 触发告警（沙箱降级事件过多说明环境有问题）

## 5. 工作状态管理

### 5.1 Working State

Working State 是 ReAct 循环中的"共享记忆"，记录当前已经做了什么：

```python
working_state = {
    "approach": "",                    # 解题思路
    "time_complexity": "",             # 时间复杂度
    "space_complexity": "",            # 空间复杂度
    "output_dir": "...",               # 输出目录
    "workspace": {
        "solution_written": False,     # 是否已写入解答
        "oracle_written": False,       # 是否已写入参考解
        "cases_generated": False,      # 是否已生成测试用例
        "patches_applied": 0,          # 已应用的补丁数
    },
    "duel_cases_count": 0,             # 对拍用例数
    "template_codes": [],              # 模板代码
    "base_run_summary": {},            # 基础测试摘要
    "online_submission_summary": {},   # 在线提交摘要
}
```

### 5.2 状态更新

每当工具执行成功，`on_tool_success` 会更新 working_state：

```python
def on_tool_success(tool_name, output, working_state):
    if tool_name == "workspace_write_solution":
        working_state["workspace"]["solution_written"] = True
    elif tool_name == "workspace_write_oracle":
        working_state["workspace"]["oracle_written"] = True
    elif tool_name == "workspace_generate_duel_dataset":
        working_state["duel_cases_count"] = output.get("case_count", 0)
    # ...
```

这样 Agent 在下一步决策时，就知道"我已经写过代码了"或"测试已经跑过了"，避免重复操作。

## 6. 与多 Agent 系统的对比

| 维度 | 多 Agent | 单 ReAct |
|------|---------|---------|
| 架构 | 5 个专业化 Agent | 1 个 Agent + 工具循环 |
| 编排 | Orchestrator 显式编排 | 模型自主决策 |
| Token 开销 | 高（多轮 Agent 调用） | 中（单循环） |
| 可控性 | 高（每步可干预） | 中（依赖模型决策） |
| 灵活性 | 低（流程固定） | 高（模型自适应） |
| 调试难度 | 中（每步可追踪） | 较高（需要分析 trace） |

## 总结

| 知识点 | 要点 |
|--------|------|
| 架构演进 | Planner+ReAct → 六状态机 → 单 ReAct（最终） |
| 核心循环 | 构思 → 工具调用 → 观察 → 继续 → 预算控制 |
| 决策引擎 | ReActLoopAgent，每次返回 ActionDecision |
| 工具控制 | 白名单机制，动态启用/禁用 |
| 风险追踪 | RiskTracker 记录 5 类风险指标 |
| 工作状态 | WorkingState 记录已完成的操作，避免重复 |

*项目源码：[leetcode-coder-agent](https://github.com/chuoer47/leetcode-coder-agent)*
