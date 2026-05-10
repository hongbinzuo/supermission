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

Mission Control 的机会是把这些问题产品化，而不是继续堆叠更多 chat 能力。

## 5. 核心解法映射

| 问题 | 解法 |
| --- | --- |
| 不确定性高 | Mission Spec、acceptance criteria、scope allow/deny |
| 难追溯 | append-only events、decisions、artifacts |
| 难管理 | state machine、milestones、human gates |
| 难可视化 | Terminal TUI、mission board、dashboard from records |
| 难回退 | git branch/worktree、patch snapshots、validation logs |
| 难交接 | handoff.md、structured actor/event history |
| 难复用 | skills、workflow templates |

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

V0/V1 的 source of truth 是 repo 内的 `.missions/` 文件，而不是数据库。

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

- mission.yaml
- plan.md
- decisions.md
- events.jsonl
- validation.log
- review.md
- patch.diff
- handoff.md

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
.missions/
  mission-001/
    mission.yaml
    events.jsonl
    decisions.md
    plan.md
    validation.log
    review.md
    patch.diff
    handoff.md
```

其中：

- `mission.yaml` 是当前 mission spec 和状态的主文件。
- `events.jsonl` 是 append-only event log。
- `decisions.md` 记录关键判断和取舍。
- `plan.md` 是执行计划。
- `validation.log` 保存验证命令输出。
- `review.md` 保存 review 记录。
- `patch.diff` 保存当前 diff snapshot。
- `handoff.md` 支持换人、换 agent 和隔天恢复。

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
idea -> mission.yaml -> plan.md -> approve -> worktree -> implement -> validate -> diff -> handoff.md
```

V0 命令：

```text
mission new
mission plan
mission approve
mission run
mission validate
mission status
mission handoff
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

- 能从自然语言目标生成 `mission.yaml`。
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

- 查看 mission status。
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
- 查看 mission status。
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
        +-- Git / Worktree Manager
        +-- Artifact Store
        |
        v
.missions/
        |
        v
Repo / Tests / Git / PR
```

核心原则：

- engine 负责 mission logic。
- adapters 负责 interaction。
- `.missions/` 是 source of truth。
- Git 负责历史、分支、diff 和回退。
- database 只在后续作为索引层出现。

## 16. 与 Superpowers 的关系

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

## 17. 非目标

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

## 18. 路线图

建议路线：

```text
V0: headless CLI engine
V0.5: Terminal TUI
V1: fast editor adapters, Zed / Neovim experiments
V2: VS Code / Cursor-compatible extension for reach
V3: GitHub / PR integration
V4: team dashboard
V5: enterprise governance
```

阶段目标：

- V0 证明 mission 闭环。
- V0.5 证明本地交互体验。
- V1 证明 fast editor integration。
- V2 扩大 IDE 覆盖。
- V3 进入真实交付流。
- V4 支持小团队可视化。
- V5 支持组织治理。

## 19. 指标

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

真正有价值的不是 AI 写了多少代码，而是多少任务被稳定推进到了可接受的交付状态。

## 20. 护城河

护城河不是模型。

护城河不是 IDE 插件。

护城河也不是多 agent。

真正护城河是：

1. Mission Spec：把软件工作标准化成可执行任务规格。
2. Mission Record：把 AI coding 从聊天记录变成工程记录。
3. Skills Workflow：把优秀工程师的方法沉淀成可组合流程。
4. Validation Loop：把 AI 输出变成可信交付。
5. Git-backed Execution：让历史、回退、协作和审计天然接入开发流程。

长期看，最值钱的是一套 AI 协助软件开发的工程操作系统。

## 21. 近期决策清单

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

## 22. 最终判断

Mission Control 不应该从“做一个更强的 agent”开始。

它应该从定义 AI 参与软件开发时，工作如何被规格化、执行化、验证化、记录化和协作化开始。

第一步不是完整平台，而是一个可以自己高频使用的本地闭环：

```text
mission -> plan -> approve -> worktree -> implement -> validate -> diff -> handoff
```

如果这个闭环稳定，后续再加 TUI、fast editor adapters、VS Code/Cursor extension、GitHub、dashboard 和团队治理。
