# Mission Control for AI Coding 精炼设计

日期：2026-05-10

## 1. 文档定位

这份文档是对 `Mission-Control-for-AI-Coding.pdf` 的产品设计精炼稿，目标读者是早期技术合伙人和早期同事。

它不是 pitch deck，也不是纯 PRD，而是一份内部战略与实施规格混合文档。它需要同时回答三个问题：

1. 为什么值得做。
2. 我们到底做什么。
3. 第一版如何收口并进入实现。

最终精炼版应从“愿景说明”升级为“战略判断 + 第一版规格”，让读者既能判断方向是否成立，也能判断 V0/V1 是否可以开工。

## 2. 核心定位

Mission Control 是 AI 协助软件开发的工程控制层。

它不是另一个 AI coding assistant，也不是某个 IDE 插件优先的产品。它的核心价值是把 AI coding 从聊天记录变成工程记录：

- 规格
- 计划
- 决策
- 事件
- 验证
- 评审
- 批准
- 交接
- 回退

一句话：

> Mission Control turns AI coding from conversation history into engineering records.

中文表达：

> Mission Control 把 AI coding 从聊天记录变成工程记录。

## 3. 核心论点

AI coding 的下一阶段，不是更聪明的聊天助手，而是可执行的软件工作系统。

当前 AI coding 的主要缺口不是模型不会写代码，而是 AI 参与的软件工程没有被充分规格化、过程化、验证化和记录化。

传统软件工程里不可替代的东西不会因为 AI 变强而消失，反而会更重要：

- 需求边界
- 验收标准
- 版本控制
- 代码审查
- 测试验证
- 变更记录
- 责任归属
- 发布和回滚路径

AI 可以加速实现，但不能替代这些工程约束。没有工程约束，AI coding 只是更快地产生不确定性。

## 4. 要解决的问题

重度 AI coding 用户已经能让 agent 写很多代码，但长任务仍然经常失控。

典型问题包括：

- 不确定性高：任务目标、完成标准和改动边界经常靠聊天临时补充。
- 难追溯：agent 做过什么、为什么这么做、哪些判断被批准过，很难从聊天记录中恢复。
- 难管理：长任务没有明确状态机，做到哪里、卡在哪里、下一步是什么不够清楚。
- 难可视化：chat 不能自然展示 mission 状态、milestone、validation 和 diff。
- 难回退：AI 可能改动范围过大，缺少和 mission 绑定的 branch、worktree、patch 和验证记录。
- 难交接：换人、换 agent 或隔天恢复时，需要重新解释上下文。
- 难复用：bugfix、refactor、test writing、review 等工作流每次都重新 prompt。
- 难监控：多个 agent、多个工具调用和长时间任务并行运行时，很难知道系统是否健康。
- 难调试：agent 为什么卡住、为什么改错文件、为什么验证失败，缺少可复现的调试证据。
- 难并行：20-30 个 agent 同时工作听起来很强，但没有任务颗粒度、隔离、调度、合并和监督机制就会迅速混乱。

Mission Control 的机会是把这些问题产品化，而不是继续堆叠更多 chat 能力。

## 5. 核心解法映射

| 问题         | 解法                                                          |
| ------------ | ------------------------------------------------------------- |
| 不确定性高   | Mission Spec、acceptance criteria、scope allow/deny           |
| 难追溯       | append-only events、decisions、artifacts                      |
| 难管理       | state machine、milestones、human gates                        |
| 难可视化     | Terminal TUI、mission board、dashboard from records           |
| 难回退       | git branch/worktree、patch snapshots、validation logs         |
| 难交接       | handoff.md、structured actor/event history                    |
| 难复用       | skills、workflow templates                                    |
| 难监控和调试 | supermission trace、tool call log、telemetry、debug artifacts |
| 难并行       | sub-missions、task ledger、worktree isolation、merge queue    |

早期产品的重点不是做复杂协作系统，而是先把 mission record 的结构设计对。

## 6. 目标用户

第一阶段目标用户：

- 重度 AI coding 用户
- 独立开发者
- 小团队技术负责人
- 经常在多个 agent、CLI、IDE 和代码库之间切换的人

这些用户已经在用 Cursor、Claude Code、Codex、Aider、Devin、Factory 或类似工具，但他们的核心痛点不是“没有 AI”，而是 AI 工作难以稳定交付。

## 7. 产品原则

### 7.1 Mission first, chat second

Chat 是入口，mission 才是工作单元。

一次 prompt 是临时对话；mission 是一段可持续推进、可恢复、可审计、可验证、可交付的工作。

### 7.2 Validation before completion

agent 不能仅靠解释宣称完成。完成必须绑定验收标准、验证命令、diff 和 handoff。

### 7.3 Local-first

V0/V1 默认本地执行，降低信任成本、实现复杂度和集成成本。

### 7.4 Git-backed records

V0/V1 的 source of truth 是 repo 内的 `.supermission/` 文件，而不是数据库。

Git 已经提供历史、回滚、分支、diff、协作和审计能力。数据库可以后续作为索引层引入，但不应成为早期核心依赖。

### 7.5 Engine first, adapters second

核心 mission engine 负责状态机、执行、验证、gate 和 artifacts。

CLI、Terminal TUI、Zed、Neovim、VS Code、Cursor、GitHub 都只是 adapter。

原则是：

```text
engine owns mission logic
adapters own interaction
```

### 7.6 Single-user first, multi-actor ready

V0/V1 是本地单人产品体验，但 mission record 从第一天保留 actor、event、review、approval 和 handoff 结构。

这让未来多人协作、review、贡献和审批可以自然接入，而不需要推翻底层模型。

## 8. 核心抽象

### 8.1 Mission

Mission 是最小工作单元。

它包含：

- goal
- context
- scope
- acceptance criteria
- workflow
- human gates
- validation commands
- status
- artifacts
- events

### 8.2 Skill

Skill 定义“怎么工作”。

示例：

- codebase-research
- mission-planning
- implementation
- validation
- code-review
- handoff

V0 不做复杂 skill marketplace。V0 只需要内置少量 workflow；V2 再开放 `skills/` 目录和 workflow templates。

### 8.3 Gate

Gate 是人必须介入的判断点。

V0/V1 的 gate 是本地单人检查点，不是多人审批流。

典型 gate：

- approve_plan
- approve_diff
- approve_risky_command
- approve_completion

### 8.4 Artifact

Artifact 是 mission 的可审计产物。

典型 artifact：

- work.yaml
- plan.md
- decisions.md
- events.jsonl
- validation.log
- review.md
- patch.diff
- handoff.md
- telemetry.jsonl
- tool-calls.jsonl
- debug.md

### 8.5 Actor

Actor 表示参与者，可以是人，也可以是 agent。

示例：

- human owner
- human reviewer
- human approver
- agent planner
- agent worker
- agent validator
- agent reviewer
- agent summarizer

V0 可以只有 `local-user` 和少量 agent role。未来多人系统只需要把 actor 扩展为真实身份。

### 8.6 Adapter

Adapter 是不同入口，不是核心逻辑。

示例：

- CLI
- Terminal TUI
- Zed adapter
- Neovim adapter
- VS Code / Cursor-compatible extension
- GitHub integration

## 9. Mission Record

V0/V1 应使用 Git 管理的文件作为 mission record。

建议结构：

```text
.supermission/
  mission-001/
    work.yaml
    events.jsonl
    decisions.md
    plan.md
    validation.log
    review.md
    monitor.md
    scope-audit.md
    patch.diff
    handoff.md
    telemetry.jsonl
    tool-calls.jsonl
    supervisor-signals.jsonl
    debug.md
```

其中：

- `work.yaml` 是当前 mission spec 和状态的主文件。
- `events.jsonl` 是 append-only event log。
- `decisions.md` 记录关键判断和取舍。
- `plan.md` 是执行计划。
- `validation.log` 保存验证命令输出。
- `review.md` 保存 review 记录。
- `monitor.md` 保存当前健康度、下一步、active tasks、pending changes 和 recent signals。
- `scope-audit.md` 保存 task scope allow/deny 与当前 git changes 的审计结果。
- `patch.diff` 保存当前 diff snapshot。
- `handoff.md` 支持换人、换 agent 和隔天恢复。
- `telemetry.jsonl` 保存 mission 运行指标。
- `tool-calls.jsonl` 保存 agent 工具调用记录。
- `supervisor-signals.jsonl` 保存监控规则发现的异常、阻塞和风险信号。
- `debug.md` 保存失败分析、上下文摘要和调试结论。

早期不引入数据库。

后续可以引入 SQLite，但它只做索引，不做 source of truth：

- 快速搜索 mission
- 筛选 blocked missions
- 统计 completion time
- 支撑 dashboard

## 10. Event Model

所有关键行为都应写入 `events.jsonl`。

示例：

```json
{"type":"mission.created","actor":"local-user","time":"2026-05-10T14:00:00Z"}
{"type":"plan.proposed","actor":"planner-agent","artifact":"plan.md"}
{"type":"gate.approved","gate":"approve_plan","actor":"local-user"}
{"type":"validation.failed","actor":"validator-agent","command":"npm test"}
{"type":"review.comment","actor":"human-reviewer","artifact":"patch.diff"}
{"type":"handoff.created","actor":"summarizer-agent","artifact":"handoff.md"}
```

这让 mission 不再依赖聊天历史，而是拥有可追踪的工程过程。

## 11. V0: Headless CLI Engine

V0 的目标是证明一个任务可以被 mission 化，并稳定走完整个闭环：

```text
idea -> work.yaml -> plan.md -> approve -> worktree -> implement -> validate -> diff -> handoff.md
```

V0 命令：

```text
supermission new
supermission plan
supermission approve
supermission run
supermission validate
supermission status
supermission doctor
supermission monitor
supermission trace
supermission logs
supermission debug
supermission handoff
```

V0 状态机：

```text
draft -> planned -> approved -> running -> needs_review -> validated -> completed
```

异常状态：

```text
blocked
failed
paused
```

V0 验收标准：

- 能从自然语言目标生成 `work.yaml`。
- 能生成可审核的 `plan.md`。
- 必须人工 approve 后才能改代码。
- 能创建隔离 branch 或 worktree。
- 能执行 validation commands。
- 能输出 diff 和 handoff。
- 失败时能保留 logs 和当前状态，支持 resume。

## 12. V0.5: Terminal TUI

Terminal TUI 是最快验证 Mission Control 体验的外壳，不是最终形态。

它作为 CLI 的交互模式存在：

```text
mission tui
```

它独立运行，但可以在任何终端中使用：

- macOS Terminal
- iTerm
- Ghostty
- Warp
- IDE terminal
- Neovim terminal

TUI 主要能力：

- 查看 supermission status。
- 查看 plan。
- 批准或拒绝 gate。
- 查看 validation result。
- 触发 validation。
- 打开 diff。
- 查看 handoff。

TUI 的价值：

- 比 IDE 插件更快实现。
- 不绑定任何 editor API。
- 可以先把 mission flow 跑顺。
- 后续 IDE adapter 可以复用同一个 engine。

## 13. V1: Fast Editor Adapters

V1 不应定义为 VS Code-first。

更准确的策略是：

```text
editor-agnostic core + fast editor adapter experiments
```

V1 优先探索 Zed 和 Neovim，但不把它们当作大众市场入口。

判断：

- Zed 用户规模还小，但适合验证 fast, local, agent-aware 的产品气质。
- Neovim 用户偏 power user，适合重度 terminal 和 AI coding 用户。
- VS Code / Cursor 覆盖面更大，但插件体验可能拖慢早期产品感受。

V1 adapter 不追求复杂 UI，只做轻集成：

- 创建 mission。
- 查看 supermission status。
- 打开 plan。
- 执行 approve。
- 触发 validation。
- 打开 artifacts。
- 跳转 diff。

## 14. V2: VS Code / Cursor-compatible Extension

VS Code / Cursor 不应作为第一体验目标，但应作为扩大覆盖的后续目标。

表达方式：

```text
VS Code-compatible extension, with Cursor compatibility as a validation target.
```

中文：

```text
第一阶段不做 VS Code-first。等 CLI/TUI 和核心 engine 稳定后，再做 VS Code-compatible extension，并把 Cursor 兼容性作为验收目标之一。
```

V2 重点不是重写 engine，而是调用本地 engine 并展示状态。

## 15. 系统架构

建议架构：

```text
CLI / Terminal TUI / Editor Adapters
        |
        v
Local Mission Engine
        |
        +-- Mission State Machine
        +-- Skill Workflow Runner
        +-- Agent Runner
        +-- Gate Manager
        +-- Validation Runner
        +-- Observability / Debug Trace
        +-- Git / Worktree Manager
        +-- Artifact Store
        |
        v
.supermission/
        |
        v
Repo / Tests / Git / PR
```

核心原则：

- engine 负责 mission logic。
- adapters 负责 interaction。
- `.supermission/` 是 source of truth。
- Git 负责历史、分支、diff 和回退。
- database 只在后续作为索引层出现。

## 16. Observability and Debuggability

监控和调试不能是后加的 dashboard，而应该是 mission record 的一部分。

Gas Town 和 Ruflo 都证明了一个趋势：当多个 agent、多个工具调用、多个工作目录同时运行时，用户真正关心的不只是“agent 说了什么”，而是：

- 任务现在处于什么状态。
- 哪个 actor 正在工作。
- agent 调用了什么工具。
- 哪些文件被修改。
- 验证为什么失败。
- 是否出现重复失败、卡住、越界修改。
- 下一步需要人做什么判断。
- 是否能回退或交接。

核心原则：

```text
AI coding observability is not chat replay. It is mission state, tool calls, validation evidence, and rollback path.
```

中文：

```text
AI coding 的可观测性不是回放聊天，而是任务状态、工具调用、验证证据和回退路径。
```

### 16.1 Mission-level Monitoring

Mission 级监控回答：

```text
这个任务现在健康吗？
```

V0/V1 至少记录：

- supermission status
- current actor
- current workflow step
- pending gate
- validation status
- latest failure
- files changed count
- diff size
- command runtime
- repeated failure count
- last event time
- handoff freshness

落盘位置：

```text
.supermission/mission-001/
  events.jsonl
  telemetry.jsonl
  monitor.md
  supervisor-signals.jsonl
  validation.log
  debug.md
```

`events.jsonl` 记录工程事实，`telemetry.jsonl` 记录运行指标。两者都 append-only，但职责不同：

- event 是“发生了什么”。
- telemetry 是“运行得怎么样”。

### 16.2 Agent-level Debugging

Agent 级调试回答：

```text
agent 为什么这么做，哪里错了？
```

不保存完整 chain-of-thought，但必须保存可调试证据：

- agent 输入摘要。
- 使用了哪些上下文文件。
- 检索命中了哪些 memory / RAG 结果。
- 调用了哪些工具。
- 工具调用参数和退出状态。
- stdout/stderr 摘要或完整日志。
- 修改了哪些文件。
- validation 为什么失败。
- 是否提出 change proposal。
- 人在哪里批准或拒绝。

落盘位置：

```text
.supermission/mission-001/
  tool-calls.jsonl
  debug.md
  validation.log
```

调试链路：

```text
agent run -> context used -> tool calls -> file changes -> validation -> decision
```

### 16.3 CLI Debug Commands

V0/V1 命令：

```text
supermission monitor
supermission trace
supermission logs
supermission debug
supermission inspect
```

含义：

- `supermission monitor`：展示当前健康度、active tasks、pending changes、supervisor signals 和下一步。
- `supermission trace`：按时间线展示关键事件。
- `supermission logs`：展示 validation 和 tool call log。
- `supermission debug`：生成或打开失败分析。
- `supermission inspect`：查看某个 event、tool call、change 或 validation failure。

V0/V0.1 已实现这些基础命令；后续重点是把同一数据结构接入 TUI 和 runner adapter。

### 16.4 TUI Debug Views

TUI 不应该只是 mission list。它至少需要这些 tab：

```text
Overview | Timeline | Plan | Diff | Validation | Tool Calls | Debug | Handoff
```

对长任务和多 agent 任务，最重要的是 `Timeline`、`Tool Calls` 和 `Validation`。它们决定用户能不能理解 agent 的行为，而不是只能相信 agent 的总结。

### 16.5 UI / UX Review Gate

一旦进入 TUI、Web dashboard、VS Code/Cursor view 或任何前端界面，必须加入专业 UI/UX review gate。

前端体验不能只验收“功能能用”，还必须审核：

- 信息层级是否清楚。
- supermission status、pending gate、validation、diff、handoff 是否能快速扫读。
- 长任务和多 agent 状态是否可理解。
- loading、empty、failed、blocked、needs_decision 等状态是否完整。
- 是否有足够密度，但不拥挤。
- 是否能支持重复、高频、工程化使用。
- 是否通过截图或浏览器实际运行检查。

UI/UX 相关变更必须附带：

- screenshot 或 terminal capture。
- interaction path。
- responsive / small viewport 检查。
- error state 检查。
- reviewer note。

### 16.6 Failure Detection

V1 开始应支持基础异常检测：

- stuck：长时间没有新 event。
- repeated_failure：同一 validation command 多次失败。
- scope_drift：修改文件超出 scope allow。
- gate_waiting：等待人工批准。
- merge_conflict：并行 worker 产物无法合并。
- validation_missing：没有验证命令。
- handoff_stale：handoff 早于最近一次重要变更。

这些异常不一定自动修复，但必须可见，并进入 `debug.md` 或 `events.jsonl`。

### 16.7 TBD / Needs Review

- telemetry schema 是否需要 OpenTelemetry 兼容。
- tool call log 是否保存完整 stdout/stderr，还是只保存摘要并链接到 log artifact。
- 是否需要默认 redact secrets。
- agent context used 是否记录文件路径即可，还是要保存 content hash。
- 长期是否引入 SQLite 作为 trace index。
- UI/UX review gate 是否作为 `approve_ui_change`，还是并入 `approve_diff`。

## 17. Multi-Agent Orchestration

Gas Town 和 Ruflo 都说明多 agent 编排有真实需求，但 Mission Control 的策略不能从“大规模 swarm”开始。

多 agent 的问题不是能不能启动 20-30 个 agent，而是：

- 如何拆任务。
- 如何分配责任。
- 如何隔离工作目录。
- 如何共享状态。
- 如何合并结果。
- 如何监控卡住和失败。
- 如何回退。
- 如何让人审查关键判断。

Mission Control 应吸收多 agent 系统的设计经验，但第一性原理仍然是 mission record。

实现策略：

```text
orchestration-ready records, simple execution first
```

中文：

```text
记录结构先为编排做好准备，执行层先保持简单。
```

也就是说，V0 就应该有 actor、task、tool-call、trace、supervisor signal 这些字段和 artifact；但 V0 默认只跑顺序 workflow，不急着启动多个真实 agent 并行。

Factory 的经验也支持这个判断：早期最重要的是让变更线性、可审查、可验证。并行变更一旦过早打开，会让 scope、diff、validation 和 rollback 都变得难以控制。

因此 V0/V1 默认原则是：

```text
linear mutation first, parallelism later
```

中文：

```text
先做线性变更，再做并行能力。
```

多 agent 可以存在为 planner、worker、validator、reviewer、handoff 等角色，但同一时间只能有一个 active code mutation。并行可以用于旁路任务，例如只读 research、竞品调研、文档草稿、测试计划、review、risk analysis、log analysis、validation analysis。这些任务产出 artifact，再回到线性变更主线。

原则：

```text
parallel sidecars, linear mutations
```

中文：

```text
旁路任务可以并行，代码变更保持线性。
```

任何并行任务如果需要修改代码、schema、环境、依赖或 release 配置，必须先转成 change proposal，进入 gate，而不是继续旁路执行。

### 17.1 Gas Town 的启发

Gas Town 的关键启发：

- Mayor：需要一个 coordinator/supervisor 角色负责全局状态和任务分配。
- Worker agents：具体任务应由有限责任的 agent 执行。
- Hooks / worktrees：每个 worker 的工作状态需要隔离和持久化。
- Beads：任务应拆成可追踪、可依赖、可完成的颗粒。
- Convoys：大型任务需要聚合多个子任务。
- Witness / Deacon / Auditor：多 agent 系统需要监督、恢复和审计角色。
- Git-backed state：版本控制、回滚和共享状态是 AI 工程任务的天然基础设施。

对 Mission Control 的转化：

| Gas Town 概念   | Mission Control 借鉴               |
| --------------- | ---------------------------------- |
| Mayor           | supervisor-agent / coordinator     |
| Polecat workers | worker-agent with bounded scope    |
| Hooks           | branch/worktree isolation          |
| Beads           | sub-missions / tasks               |
| Convoys         | parent mission with child missions |
| Witness         | monitor / stuck detector           |
| Deacon          | recovery / retry coordinator       |
| Auditor         | reviewer / validator               |
| Git as database | Git-backed mission record          |

但 Mission Control 不直接复制 Gas Town。Gas Town 更偏多 agent 工作系统实验；Mission Control 要先定义可移植的工程控制记录层。

### 17.2 Ruflo 的启发

Ruflo 的关键启发：

- Claude Code / Codex 之上确实存在 agent 调度层需求。
- agent definitions、commands、hooks、MCP、memory 可以插件化。
- coding、testing、security、docs、review、architecture 是合理的 agent role。
- memory / RAG 对长期项目理解有价值。
- 高 Star 和能力声明不等于生产可信。

对 Mission Control 的转化：

| Ruflo 能力        | Mission Control 借鉴                         |
| ----------------- | -------------------------------------------- |
| Claude Code 集成  | Claude Code / Codex 作为 runner              |
| Agent definitions | 少量内置 actor roles                         |
| Slash commands    | `supermission new/plan/run/validate/handoff` |
| Hooks             | mission event hooks                          |
| Memory/RAG        | 先从 `.supermission/` 历史检索开始           |
| Swarm             | V1 只做小规模可调试 workflow                 |
| Plugins           | 先做 workflow modules                        |

核心判断：

```text
Ruflo proves that Claude Code needs orchestration. Mission Control should prove that AI coding needs engineering control.
```

中文：

```text
Ruflo 证明 Claude Code 需要调度层；Mission Control 要证明 AI coding 需要工程控制层。
```

### 17.3 V1 Agent Roles

V1 默认只内置少量角色：

- `planner-agent`
- `worker-agent`
- `validator-agent`
- `reviewer-agent`
- `handoff-agent`
- `supervisor-agent`

每个 agent 都必须有：

- actor id
- role
- allowed scope
- input artifact
- output artifact
- tool permissions
- validation responsibility

V1 不追求 20-30 个 agent 同时运行。默认流程：

```text
planner -> worker -> validator -> reviewer -> handoff
```

可选并行：

```text
worker-code + worker-tests -> validator -> reviewer
```

这个可选并行不进入 V1 默认路径，只作为后续实验。V0/V1 可以先把这些角色写入 `work.yaml` 和 `events.jsonl`，但实际执行仍由一个 CLI process 或外部 agent 按线性 workflow 完成。

### 17.4 Task Granularity

多 agent 并行的前提是任务颗粒度正确。

一个可并行 task 应满足：

- 有明确 goal。
- 有明确 acceptance。
- 有明确 affected scope。
- 有独立 validation。
- 与其他 task 的依赖关系清楚。
- 失败后可以重试或拆分。
- 输出可以合并或审核。

V1 可以使用：

```text
.supermission/mission-001/tasks/task-001.yaml
```

V0 可以先生成 `tasks/` 目录和默认 task ledger，但不做复杂调度。

任务应区分：

- `sidecar_readonly`：旁路只读任务，可以并行。
- `sidecar_artifact`：旁路产物任务，例如测试计划、研究总结、文档草稿，可以并行但只写 mission artifacts。
- `linear_write`：代码或配置变更任务，必须进入线性主线。

调度约束：

- 同一 mission 同一时间只允许一个 `linear_write` task 处于 `running`。
- `sidecar_readonly` 和 `sidecar_artifact` 可以并行，但不能修改代码、schema、环境或 release 配置。
- pending task 只有在依赖任务全部 `done` 后才进入 `ready`。
- 如果 agent 需要扩大 scope 或从旁路任务转成写入任务，必须提出 change proposal。

示例：

```yaml
id: task-001
status: pending
actor_role: worker-agent
goal: "Add auth input validation tests"
depends_on:
  - task-000
scope:
  allow:
    - tests/auth/**
validation:
  - npm test -- auth
```

### 17.5 Scheduling and Merge Queue

并行 agent 不能直接把结果混在一起。

V1 应使用保守的调度和合并策略：

```text
ready task -> isolated worktree -> worker run -> validation -> merge queue -> review -> integrate
```

原则：

- 每个 worker 使用独立 branch 或 worktree。
- worker 只能修改自己的 scope。
- 产物进入 merge queue。
- merge 前必须有 validation evidence。
- merge conflict 进入 `needs_decision`。
- supervisor 负责检测卡住、重复失败和 scope drift。

在 merge queue 完成之前，不开放多个写入型 worker 同时修改代码。

### 17.6 Memory and Context

V0/V1 的 memory 不应先做黑盒向量库。

优先使用 repo-native artifacts：

- previous `work.yaml`
- `decisions.md`
- `events.jsonl`
- `validation.log`
- `review.md`
- `handoff.md`

后续再引入 SQLite 或 vector index，但 source of truth 仍然是文件。

### 17.7 TBD / Needs Review

- V1 task ledger 是否命名为 `tasks/`、`beads/` 还是 `submissions/`。
- supervisor-agent 是真实 agent，还是 engine 内置规则。
- 并行 worker 的默认上限：2、3 还是项目配置。
- 是否允许 agent 自动 spawn child mission。
- Claude Code / Codex runner 的权限边界如何统一。
- Git worktree 是否在 V1 默认开启。

## 18. Controlled Change Loop

Mission 不能假设初始 spec 永远正确。

真实软件开发里，任何需求、任务和计划即使前期想得再周到，中间也可能发生变化：

- 用户忘了给细节。
- 用户想错了细节。
- agent 发现原计划不可行。
- 实现中出现更好的设计。
- 测试暴露原假设错误。
- reviewer 发现风险比预期大。
- 做到一半才激发出新的产品判断。

因此 Mission Control 的原则是：

```text
Plans are hypotheses, not contracts.
```

中文：

```text
计划是假设，不是契约。
```

Mission Control 必须支持有纪律的变更，而不是假装需求从一开始就是固定的。

所有变更都应进入同一条结构化管线：

```text
change.proposed -> needs_decision -> approve/reject/defer/split -> spec/plan update -> resume
```

### 18.1 触发场景

以下情况都可以触发变更提案：

- 原 acceptance criteria 不完整。
- 原 scope 太窄或太宽。
- 用户补充了新细节。
- agent 发现实现路径需要调整。
- validation 失败揭示了原计划缺口。
- review comment 指出了新风险。
- 当前任务应该拆出子 mission。

### 18.2 状态机扩展

V0 状态机应加入 `needs_decision`：

```text
draft
planned
approved
running
needs_decision
needs_review
validated
completed

blocked
failed
paused
```

当变更被提出后，engine 应暂停当前执行：

```text
running -> needs_decision
```

除非变更只是低风险的记录性补充，否则 agent 不能继续静默扩大 scope 或改变 acceptance criteria。

### 18.3 Change Proposal

变更提案应落盘为结构化文件：

```text
.supermission/mission-001/changes/change-003.yaml
```

示例：

```yaml
id: change-003
status: proposed
source:
  actor: worker-agent
  type: agent
reason: "原 scope 没覆盖 tests/auth/login.spec.ts，但验收需要新增测试"
affected:
  - scope
  - plan.md
  - acceptance
options:
  - id: expand_scope
    description: "允许修改 tests/auth/**"
  - id: split_mission
    description: "把测试补充拆成新 mission"
recommendation: expand_scope
requires_gate: approve_scope_change
created_at: "2026-05-11T00:00:00Z"
```

同时写入 `events.jsonl`：

```json
{"type":"change.proposed","actor":"worker-agent","change":"change-003"}
{"type":"mission.state.changed","from":"running","to":"needs_decision"}
```

### 18.4 Change Gates

新增 gates：

- approve_scope_change
- approve_acceptance_change
- approve_plan_revision
- approve_split_mission
- approve_env_change
- approve_schema_change
- approve_architecture_change
- approve_destructive_change

这些 gates 的意义不是制造流程负担，而是防止 agent 在用户没有意识到的情况下改变任务本质。

## 19. Change Entry Points

变更入口应该是多入口、同一管线。

聊天可以触发变更，但变更不能停留在聊天里。人类、当前 agent、另一个 agent、reviewer、validation runner 都可以提出变更，但最终都必须变成结构化 change proposal。

### 19.1 CLI 入口

给人和脚本使用：

```text
supermission change propose
supermission change list
supermission change show change-003
supermission change approve change-003
supermission change reject change-003
supermission change split change-003
```

也可以支持简写：

```text
mission amend
```

### 19.2 TUI 入口

Terminal TUI 中应固定展示 `Changes` 区域：

```text
Mission: fix-login-error

Status: needs_decision

Pending Changes:
  change-003  Update acceptance criteria for account enumeration risk

Actions:
  [a] approve
  [r] reject
  [d] defer
  [s] split into new mission
  [e] edit proposal
```

这是最适合人的变更入口。

### 19.3 Agent Tool 入口

agent 不应靠聊天暗示变更，而应调用结构化工具：

```json
{
  "tool": "mission.change.propose",
  "reason": "原 scope 没覆盖 tests/auth/login.spec.ts，但验收需要新增测试",
  "affected": ["scope", "plan.md"],
  "options": ["expand_scope_to_tests_auth", "skip_test_change", "split_test_work"],
  "recommendation": "expand_scope_to_tests_auth",
  "risk": "不扩 scope 会导致 validation 缺少覆盖"
}
```

agent 一旦调用这个工具，engine 自动进入 `needs_decision`。

### 19.4 Review 入口

reviewer 可以通过 `review.md` 或后续 GitHub PR comment 提出变更：

```text
@mission propose-change
reason: 这个 diff 改了错误提示，但没有覆盖 rate limit 失败场景
affects: acceptance, tests
recommendation: add acceptance criterion
```

GitHub integration 后续可以把 PR comment 转换成 `change.proposed`。

### 19.5 Validation 入口

validation runner 可以提出 `change.suggested`，但不能自动修改 spec：

```text
validation.failed -> change.suggested -> needs_decision
```

这适合处理测试失败揭示原验收标准不完整的情况。

### 19.6 Handoff / Resume 入口

换 agent 或隔天恢复时，新 agent 可以先做 supermission review。如果发现上下文缺口，也可以提出 change proposal。

这让“接手时发现需求不清楚”变成正式流程，而不是重新开一段混乱聊天。

## 20. Traceability and Rollback

可追踪和可回退是 Mission Control 的核心用户价值。

### 20.1 可追踪如何实现

可追踪不是保存完整聊天，而是保存结构化工程事件。

每个 mission 都应至少包含：

```text
.supermission/mission-001/
  work.yaml
  events.jsonl
  decisions.md
  changes/
    change-003.yaml
  plan.md
  validation.log
  patch.diff
  handoff.md
```

用户通过 CLI 或 TUI 查看 timeline：

```text
mission timeline
```

示例输出：

```text
10:21 mission created
10:24 plan proposed
10:27 plan approved by hongbin
10:42 agent found missing auth test scope
10:43 change-003 proposed
10:45 change-003 approved
11:02 validation failed: npm test -- auth
11:10 implementation updated
11:14 validation passed
11:16 diff ready for review
```

用户查看某个变更：

```text
supermission change show change-003
```

它应显示：

```text
Why:
  原 scope 没覆盖 tests/auth/**，但验收要求新增登录失败测试。

Changed:
  work.yaml: scope.allow 增加 tests/auth/**
  plan.md: 增加测试步骤
  acceptance: 增加账号枚举保护验证

Approved by:
  hongbin at 10:45
```

### 20.2 代码回退

代码回退依赖 Git 隔离分支、checkpoint 和 patch snapshot。

每个 mission 开始时创建隔离 branch 或 worktree：

```text
main
  |
  +-- mission/fix-login-error
```

关键节点创建 checkpoint：

```text
before_plan_approval
before_scope_change
before_agent_run
before_validation
before_review
```

用户查看：

```text
mission checkpoints
```

示例：

```text
checkpoint-001  before agent run
checkpoint-002  before scope change change-003
checkpoint-003  before validation
checkpoint-004  before review
```

用户回退：

```text
mission rollback checkpoint-002
```

系统应执行：

1. 保存当前 diff 为 rollback-before-current.patch。
2. 恢复到目标 checkpoint。
3. 写入 rollback event。
4. 将 mission 状态设为 `needs_decision` 或 `running`。

### 20.3 环境变更回退

环境变更包括：

- 安装依赖。
- 修改 `.env`。
- 启动或删除服务。
- 修改 Docker Compose。
- 切换 runtime。

这类动作必须登记为 environment mutation，并在执行前提供 restore plan：

```yaml
type: env.change
action: add_service
target: docker-compose.yml
rollback:
  command: docker compose down postgres
  files:
    restore:
      - docker-compose.yml
      - .env.example
requires_gate: approve_env_change
```

用户在 TUI 中看到：

```text
Change type: Environment change
Action: Add PostgreSQL service
Rollback:
  - restore docker-compose.yml
  - restore .env.example
  - stop postgres container

[Approve] [Reject] [Edit rollback plan]
```

### 20.4 数据库和 Schema 回退

数据库/schema 变更必须比普通代码更严格。

任何 migration 都应带：

- forward migration
- rollback migration
- data risk
- backup/checkpoint strategy

示例：

```yaml
type: schema.change
target: db/migrations/20260511_add_missions_table.sql
forward:
  command: pnpm db:migrate
rollback:
  command: pnpm db:rollback 20260511_add_missions_table
backup:
  command: pg_dump --schema-only --file .supermission/mission-001/backups/schema-before.sql
risk:
  data_loss: false
  destructive: false
requires_gate: approve_schema_change
```

删除表、删除列、重写数据等 destructive change 必须使用更高等级 gate：

```text
approve_destructive_change
```

V0/V1 默认不允许 agent 自动执行 destructive schema change。agent 可以生成计划和 rollback strategy，但最终执行必须由人确认。

### 20.5 架构变更回退

删除框架组件、替换 ORM、重构 routing、移除大型依赖，都应登记为 architecture change。

示例：

```yaml
type: architecture.change
reason: "移除旧 routing wrapper"
affected:
  - src/router/**
  - package.json
  - tests/routing/**
rollback:
  strategy: restore_checkpoint
  checkpoint: checkpoint-before-architecture-change
validation:
  - npm test -- routing
  - npm run build
requires_gate: approve_architecture_change
```

执行前必须：

1. 创建 checkpoint。
2. 记录 affected files。
3. 写 rollback strategy。
4. 明确 validation commands。

### 20.6 高风险变更原则

任何非代码变更，在执行前必须有回退计划：

```text
Every non-code mutation needs a rollback plan before execution.
```

中文：

```text
任何非代码变更，在执行前必须有回退计划。
```

对于无法安全回退的变更，Mission Control 应明确显示：

```text
This change has no safe automatic rollback.
```

并要求人工确认或拆成独立 mission。

## 21. Change Taxonomy and Profiles

变更分类有价值，但不能在 V0 做成庞大流程。

小应用不需要面对几十种 change type；规模化 Web 应用、操作系统、嵌入式、CAD、数据平台、金融、医疗等复杂领域又确实需要更细的变更 policy。

因此设计原则是：

```text
Simple by default, extensible by profile.
```

中文：

```text
默认简单，通过 profile 扩展。
```

### 21.1 V0 粗粒度类型

V0 只内置少量粗粒度类型：

```text
product
business
ui_ux
api_contract
data_schema
architecture
security
environment
workflow
```

每个 change proposal 只要求选一个大类：

```yaml
id: change-008
type: api_contract
risk: medium
reason: "前端需要区分 invalid_password 和 account_locked"
affected:
  - src/api/auth/**
  - src/types/auth.ts
  - tests/contracts/auth.test.ts
requires_gate: approve_api_change
validation:
  - npm run test:contract
  - npm run typecheck
```

系统根据大类给默认提醒：

- 还缺什么上下文。
- 需要哪个 gate。
- 建议跑什么 validation。
- 是否需要 rollback plan。

### 21.2 可选 subtype

更细分类只作为可选字段：

```yaml
type: security
subtype: privacy_compliance
```

或：

```yaml
type: environment
subtype: release_pipeline
```

这样 V0 不强迫用户理解复杂 taxonomy，但复杂项目可以逐步增加细分。

### 21.3 Project Profiles

专业领域的差异应通过 profile 扩展，而不是硬编码进 engine。

示例：

```text
profiles/
  web-saas.yaml
  mobile-app.yaml
  embedded.yaml
  operating-system.yaml
  cad-software.yaml
  data-platform.yaml
  ml-platform.yaml
  fintech.yaml
  healthcare.yaml
```

不同 profile 可以定义不同的 taxonomy、gate、validation 和 rollback policy。

Web SaaS 可能关注：

- API compatibility
- schema migration
- auth/security
- feature flags
- observability
- release pipeline

Embedded 可能关注：

- hardware interface
- real-time constraints
- firmware flashing
- power usage
- safety certification

CAD 软件可能关注：

- geometry kernel
- file format compatibility
- rendering accuracy
- plugin API
- performance regression

### 21.4 Profile Policy 示例

```yaml
change_taxonomy:
  default_types:
    - product
    - api_contract
    - data_schema
    - architecture
    - security
    - environment

policies:
  data_schema:
    requires_gate: approve_schema_change
    requires_rollback_plan: true
    suggested_validation:
      - migration test
      - backup check

  security:
    requires_gate: approve_security_change
    requires_review: true
    suggested_validation:
      - security test
      - dependency audit

  environment:
    requires_gate: approve_env_change
    requires_rollback_plan: true
    suggested_validation:
      - preflight
      - deploy dry-run
```

### 21.5 Taxonomy 的产品价值

分类不是为了分类，而是为了让系统知道：

- 还缺什么信息。
- 谁需要批准。
- 该跑什么验证。
- 怎么安全回退。
- 是否应该拆成独立 mission。

因此 V0 不暴露庞大的变更分类，只提供少量粗粒度类型；细分 taxonomy 通过项目 profile 和 policy 扩展。

## 22. Team Collaboration and Review Policy

Mission Control 应该是 team-ready，但不能 team-required。

也就是说，单人使用时产品必须成立；多人协作时，团队能力来自同一套 mission record、gate、review、handoff 和 policy，而不是一开始就做复杂团队系统。

### 22.1 有价值的 Review

有价值的 review 不是“有人点 approve”，而是审查 AI 容易搞错、人类必须承担判断责任的地方。

典型有价值 review：

- Intent review：这个任务是不是做对了问题，而不是只做对了字面需求。
- Scope review：改动范围有没有扩大、遗漏或越界。
- Acceptance review：验收标准是否真实覆盖用户目标。
- Architecture review：是否破坏边界、引入长期复杂度。
- API / Data review：接口、schema、数据迁移是否兼容、可回退。
- Security / Privacy review：权限、输入、密钥、PII、审计是否安全。
- Release risk review：是否影响部署、灰度、回滚、线上稳定性。
- Handoff review：下一个人或 agent 能不能接手。

不太有价值的 review：

- 对每个小 diff 都强制人工批准。
- 已经能被 test、lint、typecheck 覆盖的机械检查。
- 没有上下文的橡皮图章 approve。
- agent 自己写完再自己宣布没问题。
- 流程上看似严格，但没有记录“为什么批准”。

### 22.2 协作关键节点

团队协作不应该围绕 chat，而应该围绕 judgment points。

关键节点：

```text
mission.created
plan.proposed
plan.approved
change.proposed
change.approved / rejected / split
risky_mutation.requested
validation.failed / passed
diff.ready
review.requested
handoff.created
mission.completed
```

这些节点天然适合协作，因为它们需要判断，而不只是执行。

### 22.3 风险驱动 Review

Review 应该由风险触发，而不是由仪式触发：

```text
Review should be risk-based, not ceremony-based.
```

中文：

```text
Review 应该由风险触发，而不是由仪式触发。
```

工具不应写死“所有任务必须三人审批”。它应提供默认 policy，并允许项目和团队调整。

示例：

```yaml
review_policy:
  default:
    plan_review: required
    diff_review: optional

  api_contract:
    review: required
    reviewers:
      - api-owner
    required_evidence:
      - contract_tests

  data_schema:
    review: required
    gate: approve_schema_change
    rollback_plan: required

  security:
    review: required
    reviewers:
      - security-owner
    required_evidence:
      - security_risk_note

  ui_ux:
    review: optional
    evidence:
      - screenshot
      - manual_check
```

### 22.4 Policy 层级

协作流程应分三层：

```text
1. Defaults
2. Project Profile
3. Team Policy
```

Defaults 面向个人和小项目，少量 gate 即可。

Project Profile 面向不同工程领域，定义自己的 change taxonomy、validation policy 和 rollback policy。

Team Policy 面向团队，定义哪些 gate 是 blocking，哪些只是 advisory。

示例：

```yaml
gates:
  approve_plan:
    mode: blocking

  approve_ui_change:
    mode: advisory

  approve_schema_change:
    mode: blocking

  approve_destructive_change:
    mode: blocking
    requires_reason: true
```

### 22.5 团队能力来自哪里

Mission Control 真正发挥团队能力的地方不是多人在线聊天，而是：

1. 让所有人看到同一份工程事实：`work.yaml`、`events.jsonl`、`decisions.md`、`changes/`、`validation.log`、`handoff.md`。
2. 让关键判断被结构化记录：谁批准了什么，为什么批准，有什么风险。
3. 让 reviewer 不再从零读上下文：reviewer 直接看 mission summary、change reason、diff、validation、rollback plan。
4. 让换人和换 agent 成本变低：handoff 是标准产物，不是临时总结。
5. 让团队流程可配置：不同项目、不同风险等级、不同领域使用不同 policy。

核心结论：

```text
Mission Control should not hardcode a collaboration process. It should provide shared engineering records, risk-based gates, configurable review policies, and handoff artifacts.
```

中文：

```text
Mission Control 不应该写死某一种协作流程。它应该提供共享工程记录、基于风险的 gate、可配置 review policy 和标准化 handoff 产物。
```

## 23. Why Existing Tools Do Not Fully Solve This

现有工具证明了需求，但大多优化的是 agent 执行、IDE 体验、云端委派或底层编排框架。

Mission Control 不应该靠“更会写代码”竞争，而应该定义一个可移植的 AI 协助软件工程控制记录层：mission spec、状态机、gate、事件、artifact、验证、评审、交接和回退。

### 23.1 分类

| 类型                  | 代表                                                  | 已解决                                                             | 没完全解决                                                                                   |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 终端/IDE coding agent | Claude Code, Codex, Aider, Cline, Roo Code            | 读代码、改代码、跑命令、局部审批、生成 diff                        | mission 作为标准工程记录；跨 agent 交接；统一事件日志；任务状态机                            |
| 后台 PR agent         | GitHub Copilot coding agent, Cursor Background Agents | 后台执行、分支/PR、review 请求、云端环境                           | 本地优先、repo-native mission spec、可移植 artifact、非平台绑定控制层                        |
| 商业 AI 软件工程师    | Devin                                                 | 任务执行、PR、代码库索引、团队场景、review                         | 强 SaaS/平台化；mission record 不一定是用户 repo 内可迁移标准                                |
| Mission/spec 产品     | Factory Missions, Kiro                                | 最接近：计划、milestones、spec、skills/hooks、orchestration        | 仍绑定各自产品体验；不一定以 Git-backed open mission record 为核心抽象                       |
| 多 agent 编排系统     | Gas Town, Ruflo / Claude Flow                         | 任务拆解、agent 调度、worktree/hooks、memory、swarm、多 agent 协同 | 工程记录、验证证据、变更审批、调试链路、回退策略往往不是统一产品核心                         |
| Agent 框架            | LangGraph, LangChain, CrewAI, AutoGen                 | durable execution、human-in-loop、多 agent 编排、状态持久化        | 是开发框架，不是面向软件工程交付的产品规范；不定义 mission record、review、handoff、git 回退 |
| 开源 agent 平台       | OpenHands, OpenClaw, Hermes-like agents               | 自主执行、工具调用、浏览器/终端/文件操作、部分 memory/skills       | 更偏 agent runtime 或个人自动化；不是专门的软件工程控制层                                    |

### 23.2 工具判断

**Claude Code / Codex**

它们是很强的 coding agent surface，适合读代码、修改代码、运行命令、解释 diff。

但它们本质仍是 agent 执行界面，不是标准化 mission record。Mission Control 可以把它们当 worker，而不是正面替代它们。

**Aider / Cline / Roo Code**

这些工具降低了本地 AI coding 的使用门槛，并支持真实代码修改和命令执行。

但它们通常围绕会话、任务或 IDE 操作展开，不把 `work.yaml`、`events.jsonl`、`decisions.md`、`changes/`、`handoff.md` 作为可移植工程记录核心。

**GitHub Copilot coding agent / Cursor Background Agents**

它们已经把 AI coding 推向后台执行、分支、PR 和 review 请求。

但它们更接近平台内能力，优势是覆盖面和托管体验。Mission Control 的差异应是 local-first、Git-backed、adapter-agnostic 和可被不同 agent 使用。

**Devin**

Devin 更接近商业化的 AI 软件工程师，证明“任务委派给 agent 并产出 PR”是有市场的。

Mission Control 不应该和 Devin 拼云端自动干活，而应强调用户 repo 内可审计、可迁移、可回退的 mission record。

**Factory Missions**

Factory Missions 是最接近的直接验证。它证明 mission、plan、milestone、skills 和 orchestration 是真实需求。

Mission Control 的差异应是：local-first、Git-backed、open mission record、adapter-agnostic，并优先服务个人和小团队的本地工程控制层。

**Kiro**

Kiro 的 specs、steering、hooks 证明了 spec-driven development 和 agentic IDE 结合的价值。

Mission Control 的差异应是 engine-first，而不是 IDE-first；它不把 spec 关在某个 IDE 里，而把 mission record 放进 repo。

**Gas Town**

Gas Town 是 Steve Yegge 提出的多 agent 编排系统实验，核心启发是用 coordinator、worker、worktree/hook、task ledger、supervisor 和 Git-backed state 来支撑多个 Claude Code 实例并行工作。

它证明“大型 AI coding 任务需要任务颗粒度、持久化状态、隔离工作区和监督机制”。但 Mission Control 不应从 20-30 个 agent 并行开始，而应先把 mission record、trace、validation、rollback 和 handoff 做成稳定基础。Gas Town 的 Mayor、Hooks、Beads、Witness、Deacon、Auditor 等概念可以转化为 Mission Control 的 supervisor、worktree isolation、sub-missions/tasks、monitor、recovery 和 reviewer。

**Ruflo / Claude Flow**

Ruflo 代表 Claude Code 生态里的 agent orchestration 热点。它强调 agents、swarm、memory、RAG、MCP、plugins 和 Claude Code / Codex integration，说明开发者已经在寻找 coding agent 之上的调度层。

Mission Control 可以借鉴 Ruflo 的 role library、slash commands、hooks、memory 和 runner adapter 思路，但不应复制“100+ agents”的叙事。Ruflo 管 agent 怎么协作；Mission Control 管 AI 软件任务怎么被规格化、批准、验证、记录、调试、回退和交付。

**LangGraph / LangChain / CrewAI / AutoGen**

这些是底层 agent 框架或编排框架。它们能提供 durable execution、human-in-loop、多 agent、状态持久化等能力。

但它们不会替产品定义软件开发里的 mission spec、gate、diff、validation、handoff、review、rollback。Mission Control 可以借鉴或使用这些框架，但产品核心不是框架能力本身。

**OpenHands / OpenClaw / Hermes-like agents**

开源 agent 平台证明了自主工具调用和软件开发 agent runtime 的需求。

但 Mission Control 关注的不是再造一个 runtime，而是定义 AI 协助软件开发时的工程控制记录层。

### 23.3 结论

现有工具分别解决了一部分问题：

- agent 如何执行。
- agent 如何在 IDE 中工作。
- agent 如何跑在云端。
- 多 agent 如何编排。
- spec 如何辅助开发。
- agent 如何保存 memory 和调用 tools。

Mission Control 要解决的是另一层问题：

```text
AI-assisted software work as controlled engineering records.
```

中文：

```text
把 AI 协助软件开发变成受控的工程记录。
```

这个定位允许 Mission Control 与现有 agent 和框架共存：Claude Code、Codex、Aider、Cline、LangGraph、OpenHands 都可以成为 engine 后面的 worker 或 runtime，而不是必须被替代。

## 24. 与 Superpowers 的关系

Mission Control 和 Superpowers 相似，但不是同一层产品。

Superpowers 关注：

- brainstorming
- planning
- TDD
- debugging
- verification
- code review

也就是：

```text
Superpowers = 方法论层
```

Mission Control 关注：

- mission spec
- state machine
- gates
- artifacts
- event log
- validation loop
- handoff

也就是：

```text
Mission Control = 工作执行与记录层
```

最好的关系不是竞争，而是吸收：

```text
Mission Control can use Superpowers-style skills as workflow modules.
```

中文：

```text
Mission Control 可以把 Superpowers 式 skills 作为 workflow 模块，但产品核心是 mission record 和 execution loop。
```

## 25. 非目标

V0/V1 明确不做：

- 多用户系统
- 云端执行
- 团队 dashboard
- RBAC
- 企业权限
- 自动 merge
- 复杂 agent 并行
- skill marketplace
- Cursor 专用扩展
- 完整审计合规系统

这些能力只有在 mission engine、record 和 validation loop 成立后才有价值。

## 26. 路线图

路线图应从“证明工程闭环”开始，而不是从“堆多 agent 能力”开始。

Gas Town 和 Ruflo 给出的共同信号是：AI coding 正在从单 agent 走向调度、记忆、并行和监督。但它们也提醒我们，V0 如果直接追求 20-30 个 agent、swarm、federation、plugin marketplace，会过早进入复杂度陷阱。

Mission Control 的路线图应采用渐进式展开：

```text
V0: Git-backed mission record + headless CLI
V0.1: Observability and debugging primitives
V0.2: Controlled change loop
V0.3: Worktree isolation and rollback checkpoints
V0.4: Task ledger and linear scheduler
V0.5: Terminal TUI
V1: Small multi-agent workflow
V1.5: Adapter experiments for Claude Code / Codex / Zed / Neovim
V2: VS Code / Cursor-compatible extension
V3: GitHub / PR integration and review workflow
V4: Team dashboard and policy layer
V5: Enterprise governance
```

### 26.1 V0: Git-backed Mission Record + Headless CLI

目标：证明一个任务可以被规格化、记录化、验证化和交接。

范围：

- `supermission new`
- `supermission plan`
- `supermission approve`
- `supermission run`
- `supermission validate`
- `supermission status`
- `supermission trace`
- `supermission logs`
- `supermission debug`
- `supermission handoff`

验收标准：

- 能生成 `.supermission/<mission-id>/work.yaml`。
- 能写入 `events.jsonl`。
- 能生成 `plan.md`、`validation.log`、`handoff.md`。
- 能展示 mission 当前状态。
- 能输出从创建到当前的 timeline。
- 能输出当前 mission 的监控摘要和下一步。
- 验证失败时保留 stdout/stderr 和失败状态。

明确不做：

- 不接真实模型。
- 不做 TUI。
- 不做多 agent 并行。
- 不做复杂 YAML schema。
- 不做 worktree 自动管理。

### 26.2 V0.1: Observability and Debugging Primitives

目标：让 AI coding 任务可以被监控和调试。

新增能力：

- `telemetry.jsonl`：记录耗时、状态变化、验证结果、diff size。
- `tool-calls.jsonl`：记录命令、工具调用、输入摘要、输出摘要。
- `monitor.md`：记录当前健康度、下一步、任务状态、待处理变更、最近事件和 supervisor signals。
- `supervisor-signals.jsonl`：记录 stuck、blocked、risky command、linear mutation conflict 等异常信号。
- `debug.md`：记录失败原因、上下文来源、下一步建议。
- `supermission inspect`：查看某个 event、tool call 或 validation failure。

核心判断：

```text
AI coding observability is not chat replay. It is mission state, tool calls, validation evidence, and rollback path.
```

中文：

```text
AI coding 的可观测性不是回放聊天，而是任务状态、工具调用、验证证据和回退路径。
```

### 26.3 V0.2: Controlled Change Loop

目标：把“做到一半发现需求要变”产品化。

新增能力：

- `supermission change propose`
- `supermission change list`
- `supermission change approve`
- `supermission change reject`
- `supermission change split`

验收标准：

- scope、acceptance、plan 的实质变更必须落到 `changes/change-xxx.yaml`。
- 变更触发后 mission 进入 `needs_decision`。
- approve/reject 后写入 `events.jsonl`。
- 被批准的变更必须更新 `work.yaml` 或 `plan.md`。

### 26.4 V0.3: Worktree Isolation and Rollback Checkpoints

目标：让 agent 改代码可以安全隔离、可回退。

新增能力：

- `supermission branch`
- `supermission worktree`
- `supermission checkpoint`
- `mission checkpoints`
- `supermission rollback-plan`
- `mission rollback`
- `supermission diff`

验收标准：

- 每个 mission 可以创建独立 branch 或 worktree。
- 关键状态前创建 checkpoint。
- rollback 前保存当前 patch snapshot。
- rollback event 写入 `events.jsonl`。
- V0.3 只生成 rollback plan，不执行自动 rollback；真正回滚进入更高风险 gate。

### 26.5 V0.4: Task Ledger and Linear Scheduler

目标：在不打开复杂并行变更的前提下，为后续多 agent 编排建立任务颗粒度和调度约束。

新增能力：

- `supermission tasks`
- `supermission task add`
- `supermission task set-status`
- `supermission task audit-scope`
- validation secret redaction
- task dependencies
- automatic pending -> ready unblocking
- one-running-`linear_write` guard
- scope drift audit

验收标准：

- sidecar 任务可以并行记录和推进。
- 代码、配置、schema、环境和 release 相关写入任务保持线性。
- 同一 mission 不能同时有多个 `linear_write` task 处于 running。
- 当前 git changes 可以按 task scope 执行 allow/deny 审计；越界修改写入 `scope_drift` supervisor signal。
- task ledger 的事件必须进入 `events.jsonl`，冲突必须进入 `supervisor-signals.jsonl`。

### 26.6 V0.5: Terminal TUI

目标：让本地 mission flow 可以被人高频使用。

TUI 第一版只展示：

- mission list
- current status
- pending gates
- plan
- validation result
- trace
- tool calls
- handoff

不做复杂 dashboard，不做团队协作。

### 26.7 V1: Small Multi-Agent Workflow

目标：吸收 Gas Town / Ruflo 的 agent 编排启发，但只做小规模、可调试、可验证的多 agent。

V1 默认 agent roles：

- `planner-agent`
- `worker-agent`
- `validator-agent`
- `reviewer-agent`
- `handoff-agent`
- `supervisor-agent`

V1 不追求 20-30 个 agent 同时跑。默认只允许 2-3 个 agent 协作：

```text
planner -> worker -> validator -> reviewer -> handoff
```

可选并行：

```text
worker-code + worker-tests -> validator -> reviewer
```

验收标准：

- 每个 agent 都有独立 actor id。
- 每个 agent 的输入摘要、输出摘要、工具调用和状态变化都进入 mission record。
- supervisor 能检测 stuck、repeated failure、scope drift。
- 并行任务必须通过 merge queue 汇合，不允许静默覆盖。

### 26.8 V1.5: Adapter Experiments

目标：让 Mission Control 可以调度已有 agent surface，而不是替代它们。

优先 adapter：

- Claude Code runner
- Codex runner
- shell runner
- Zed command adapter
- Neovim terminal adapter

判断：

- Claude Code / Codex 是 worker runtime。
- Mission Control 是 mission record 和 control plane。
- Ruflo / Gas Town 类系统未来也可以作为 runner backend。

### 26.9 V2: VS Code / Cursor-compatible Extension

目标：扩大使用面，但不重写核心 engine。

能力：

- 创建 mission。
- 查看状态。
- 审核 plan。
- 批准 gate。
- 查看 validation、trace、diff、handoff。
- 从 editor 跳转到 artifact。

### 26.10 V3: GitHub / PR Integration

目标：进入真实交付流程。

能力：

- mission -> branch -> PR
- PR comment -> review event
- GitHub check -> validation event
- review comment -> change proposal
- PR merge -> mission completed

### 26.11 V4: Team Dashboard and Policy Layer

目标：支持小团队围绕 mission record 协作。

能力：

- mission board
- blocked missions
- pending gates
- risk-based review policy
- reviewer assignment
- team metrics

### 26.12 V5: Enterprise Governance

目标：支持组织级治理。

能力：

- RBAC
- audit export
- policy enforcement
- secret redaction
- environment mutation controls
- compliance evidence package

### 26.13 当前实现状态

截至 2026-05-12：

- V0 headless CLI、基础 workflow state gates 和 Git-backed mission record 已落地。
- V0.1 的 telemetry、tool-calls、supervisor signals、trace、logs、debug、inspect、monitor、扩展 secret redaction、可配置 redaction patterns、repeated failure signal 和 stale running task diagnosis 已落地。
- V0.2 的 change proposal lifecycle 已落地；approved change 已可通过显式 `supermission change apply` 安全追加到 mission spec 和 plan notes，自动/结构化 plan patch 仍是 TBD。
- V0.3 的 branch、worktree、diff、task-scoped patch capture、checkpoint、rollback-plan、non-destructive rollback-check 已落地；自动 rollback 仍是 TBD。
- V0.4 的 task ledger、dependency unblocking、linear mutation guard、scope drift audit 已落地。
- 下一阶段应先补更完整的 project profile/policy、可配置 redaction policy、受控 plan patch、更完整的 state machine policy 和 TUI 设计验证，再进入真实 runner adapter；基础 policy init/show 已落地。

### 26.14 实现顺序

当前实现顺序：

1. 先实现 V0 CLI 骨架和 `.supermission/` record。
2. 补上 V0.1 的 trace/log/debug artifacts。
3. 实现 V0.2 change proposal。
4. 实现 V0.3 git branch/worktree/checkpoint。
5. 实现 V0.4 task ledger 和 linear scheduler。
6. 再做 TUI。
7. 最后引入小规模 multi-agent workflow。

## 27. 指标

第一阶段 North Star 不应是调用次数或生成代码行数。

建议北极星指标：

```text
Validated Missions Completed per Week
```

辅助指标：

- plan approval rate
- validation pass rate
- mission completion time
- human intervention count
- diff accepted rate
- rollback / failure rate
- handoff reuse rate
- trace completeness rate
- debug time after failure
- stuck mission count
- scope drift count
- agent/tool-call failure rate

真正有价值的不是 AI 写了多少代码，而是多少任务被稳定推进到了可接受的交付状态。

## 28. 护城河

护城河不是模型。

护城河不是 IDE 插件。

护城河也不是多 agent。

真正护城河是：

1. Mission Spec：把软件工作标准化成可执行任务规格。
2. Mission Record：把 AI coding 从聊天记录变成工程记录。
3. Skills Workflow：把优秀工程师的方法沉淀成可组合流程。
4. Validation Loop：把 AI 输出变成可信交付。
5. Controlled Change Loop：把边做边发现的需求变化变成可批准、可追踪的工程过程。
6. Change Taxonomy and Profiles：默认简单，同时允许不同工程领域定义自己的变更 policy。
7. Risk-based Review Policy：让团队协作围绕关键判断点，而不是围绕形式化审批。
8. Traceability and Rollback：让代码、环境、schema 和架构变更都具备记录、检查和回退路径。
9. Git-backed Execution：让历史、回退、协作和审计天然接入开发流程。
10. Agent Observability：让每次 agent 工作都有 trace、tool calls、validation evidence 和 debug path。
11. Bounded Multi-Agent Orchestration：从小规模、可验证、可合并的多 agent workflow 开始，而不是不可控 swarm。
12. Quality Engineering：用功能、性能、逻辑合理性、异常分支、mutation testing 和 E2E 测试保证系统可信。
13. Product Craft：参考 Linear、Raycast、GitHub、Lazygit、k9s、Sentry、Datadog、Temporal、Kubernetes 等标杆，持续打磨软件工程、人机交互和可观测性体验。

长期看，最值钱的是一套 AI 协助软件开发的工程操作系统。

## 29. 近期决策清单

建议默认决策：

- Mission spec 使用 YAML，便于人类审阅和手写修改。
- V0 优先支持 git branch，worktree 作为强隔离模式；如果实现复杂度可控，再把 worktree 设为默认。
- Gate approval 先写入 `events.jsonl`，不单独拆 `approvals.jsonl`；后续团队审批出现后再拆分索引。
- 第一批内置 workflow 只做 `research -> plan -> implement -> validate -> handoff`。
- Terminal TUI 作为 V0.5，技术栈优先选择能快速构建跨平台终端界面的现成库。
- Zed adapter 作为 V1 实验目标，但不承诺完整 UI，只做命令和 artifact 打开能力。
- Neovim adapter 先通过 CLI/TUI 嵌入验证，不急于写完整 Lua plugin。
- VS Code / Cursor-compatible extension 推迟到 V2，目标是覆盖面，不是早期产品手感。
- validation commands 失败后进入 `blocked` 或 `failed`，必须记录 stdout/stderr 和下一步建议。
- patch snapshot 在每次 `needs_review` 前生成，默认保留最新 snapshot 和最终 snapshot。
- V0 引入 `needs_decision` 状态，所有 scope、acceptance、plan 的实质变更都必须走 change proposal。
- 非代码变更必须先写 rollback plan，再进入 approval gate。
- V0 的 change taxonomy 只暴露粗粒度类型，细分类型通过 `subtype` 和 project profile 扩展。
- V0 的 review policy 默认轻量；高风险类型可以配置 blocking gate，低风险 review 默认 advisory 或 optional。
- V0.1 把 observability 作为 core，不作为后续 dashboard 附加功能。
- V1 多 agent 默认限制为 2-3 个 agent，必须有独立 actor、scope、tool-call log 和 validation evidence。
- Gas Town 的 Git-backed hooks/worktrees 值得借鉴，但 20-30 agent 并行不是早期目标。
- Ruflo 的 Claude Code / Codex integration 值得借鉴，但 Mission Control 应优先定义 runner-neutral mission record。
- 主实现语言改为 TypeScript，工具链采用 Bun-first。
- V0 先证明 `.supermission/` record 闭环；TUI、runner adapter、dashboard 后续再引入。
- 测试策略不只包含 unit tests，还必须包含 property-based、CLI integration、golden artifacts、state machine、performance、security boundary、mutation 和前端 E2E。
- 每个 CLI/TUI/Web/IDE 体验变更都需要 craft review，检查命令语义、输出审美、信息密度、错误态、空状态、长任务状态和标杆参考。

## 30. 最终判断

Mission Control 不应该从“做一个更强的 agent”开始。

它应该从定义 AI 参与软件开发时，工作如何被规格化、执行化、验证化、记录化、变更化、回退化和协作化开始。

第一步不是完整平台，而是一个可以自己高频使用的本地闭环：

```text
mission -> plan -> approve -> worktree -> implement -> validate -> diff -> handoff
```

如果这个闭环稳定，后续再加 TUI、fast editor adapters、VS Code/Cursor extension、GitHub、dashboard 和团队治理。
