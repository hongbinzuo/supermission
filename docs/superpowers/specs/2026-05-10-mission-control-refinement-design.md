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

## 16. Controlled Change Loop

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

### 16.1 触发场景

以下情况都可以触发变更提案：

- 原 acceptance criteria 不完整。
- 原 scope 太窄或太宽。
- 用户补充了新细节。
- agent 发现实现路径需要调整。
- validation 失败揭示了原计划缺口。
- review comment 指出了新风险。
- 当前任务应该拆出子 mission。

### 16.2 状态机扩展

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

### 16.3 Change Proposal

变更提案应落盘为结构化文件：

```text
.missions/mission-001/changes/change-003.yaml
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

### 16.4 Change Gates

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

## 17. Change Entry Points

变更入口应该是多入口、同一管线。

聊天可以触发变更，但变更不能停留在聊天里。人类、当前 agent、另一个 agent、reviewer、validation runner 都可以提出变更，但最终都必须变成结构化 change proposal。

### 17.1 CLI 入口

给人和脚本使用：

```text
mission change propose
mission change list
mission change show change-003
mission change approve change-003
mission change reject change-003
mission change split change-003
```

也可以支持简写：

```text
mission amend
```

### 17.2 TUI 入口

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

### 17.3 Agent Tool 入口

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

### 17.4 Review 入口

reviewer 可以通过 `review.md` 或后续 GitHub PR comment 提出变更：

```text
@mission propose-change
reason: 这个 diff 改了错误提示，但没有覆盖 rate limit 失败场景
affects: acceptance, tests
recommendation: add acceptance criterion
```

GitHub integration 后续可以把 PR comment 转换成 `change.proposed`。

### 17.5 Validation 入口

validation runner 可以提出 `change.suggested`，但不能自动修改 spec：

```text
validation.failed -> change.suggested -> needs_decision
```

这适合处理测试失败揭示原验收标准不完整的情况。

### 17.6 Handoff / Resume 入口

换 agent 或隔天恢复时，新 agent 可以先做 mission review。如果发现上下文缺口，也可以提出 change proposal。

这让“接手时发现需求不清楚”变成正式流程，而不是重新开一段混乱聊天。

## 18. Traceability and Rollback

可追踪和可回退是 Mission Control 的核心用户价值。

### 18.1 可追踪如何实现

可追踪不是保存完整聊天，而是保存结构化工程事件。

每个 mission 都应至少包含：

```text
.missions/mission-001/
  mission.yaml
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
mission change show change-003
```

它应显示：

```text
Why:
  原 scope 没覆盖 tests/auth/**，但验收要求新增登录失败测试。

Changed:
  mission.yaml: scope.allow 增加 tests/auth/**
  plan.md: 增加测试步骤
  acceptance: 增加账号枚举保护验证

Approved by:
  hongbin at 10:45
```

### 18.2 代码回退

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

### 18.3 环境变更回退

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

### 18.4 数据库和 Schema 回退

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
  command: pg_dump --schema-only --file .missions/mission-001/backups/schema-before.sql
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

### 18.5 架构变更回退

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

### 18.6 高风险变更原则

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

## 19. Change Taxonomy and Profiles

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

### 19.1 V0 粗粒度类型

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

### 19.2 可选 subtype

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

### 19.3 Project Profiles

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

### 19.4 Profile Policy 示例

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

### 19.5 Taxonomy 的产品价值

分类不是为了分类，而是为了让系统知道：

- 还缺什么信息。
- 谁需要批准。
- 该跑什么验证。
- 怎么安全回退。
- 是否应该拆成独立 mission。

因此 V0 不暴露庞大的变更分类，只提供少量粗粒度类型；细分 taxonomy 通过项目 profile 和 policy 扩展。

## 20. Team Collaboration and Review Policy

Mission Control 应该是 team-ready，但不能 team-required。

也就是说，单人使用时产品必须成立；多人协作时，团队能力来自同一套 mission record、gate、review、handoff 和 policy，而不是一开始就做复杂团队系统。

### 20.1 有价值的 Review

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

### 20.2 协作关键节点

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

### 20.3 风险驱动 Review

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

### 20.4 Policy 层级

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

### 20.5 团队能力来自哪里

Mission Control 真正发挥团队能力的地方不是多人在线聊天，而是：

1. 让所有人看到同一份工程事实：`mission.yaml`、`events.jsonl`、`decisions.md`、`changes/`、`validation.log`、`handoff.md`。
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

## 21. Why Existing Tools Do Not Fully Solve This

现有工具证明了需求，但大多优化的是 agent 执行、IDE 体验、云端委派或底层编排框架。

Mission Control 不应该靠“更会写代码”竞争，而应该定义一个可移植的 AI 协助软件工程控制记录层：mission spec、状态机、gate、事件、artifact、验证、评审、交接和回退。

### 19.1 分类

| 类型 | 代表 | 已解决 | 没完全解决 |
| --- | --- | --- | --- |
| 终端/IDE coding agent | Claude Code, Codex, Aider, Cline, Roo Code | 读代码、改代码、跑命令、局部审批、生成 diff | mission 作为标准工程记录；跨 agent 交接；统一事件日志；任务状态机 |
| 后台 PR agent | GitHub Copilot coding agent, Cursor Background Agents | 后台执行、分支/PR、review 请求、云端环境 | 本地优先、repo-native mission spec、可移植 artifact、非平台绑定控制层 |
| 商业 AI 软件工程师 | Devin | 任务执行、PR、代码库索引、团队场景、review | 强 SaaS/平台化；mission record 不一定是用户 repo 内可迁移标准 |
| Mission/spec 产品 | Factory Missions, Kiro | 最接近：计划、milestones、spec、skills/hooks、orchestration | 仍绑定各自产品体验；不一定以 Git-backed open mission record 为核心抽象 |
| Agent 框架 | LangGraph, LangChain, CrewAI, AutoGen | durable execution、human-in-loop、多 agent 编排、状态持久化 | 是开发框架，不是面向软件工程交付的产品规范；不定义 mission record、review、handoff、git 回退 |
| 开源 agent 平台 | OpenHands, OpenClaw, Hermes-like agents | 自主执行、工具调用、浏览器/终端/文件操作、部分 memory/skills | 更偏 agent runtime 或个人自动化；不是专门的软件工程控制层 |

### 19.2 工具判断

**Claude Code / Codex**

它们是很强的 coding agent surface，适合读代码、修改代码、运行命令、解释 diff。

但它们本质仍是 agent 执行界面，不是标准化 mission record。Mission Control 可以把它们当 worker，而不是正面替代它们。

**Aider / Cline / Roo Code**

这些工具降低了本地 AI coding 的使用门槛，并支持真实代码修改和命令执行。

但它们通常围绕会话、任务或 IDE 操作展开，不把 `mission.yaml`、`events.jsonl`、`decisions.md`、`changes/`、`handoff.md` 作为可移植工程记录核心。

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

**LangGraph / LangChain / CrewAI / AutoGen**

这些是底层 agent 框架或编排框架。它们能提供 durable execution、human-in-loop、多 agent、状态持久化等能力。

但它们不会替产品定义软件开发里的 mission spec、gate、diff、validation、handoff、review、rollback。Mission Control 可以借鉴或使用这些框架，但产品核心不是框架能力本身。

**OpenHands / OpenClaw / Hermes-like agents**

开源 agent 平台证明了自主工具调用和软件开发 agent runtime 的需求。

但 Mission Control 关注的不是再造一个 runtime，而是定义 AI 协助软件开发时的工程控制记录层。

### 19.3 结论

现有工具分别解决了一部分问题：

- agent 如何执行。
- agent 如何在 IDE 中工作。
- agent 如何跑在云端。
- 多 agent 如何编排。
- spec 如何辅助开发。

Mission Control 要解决的是另一层问题：

```text
AI-assisted software work as controlled engineering records.
```

中文：

```text
把 AI 协助软件开发变成受控的工程记录。
```

这个定位允许 Mission Control 与现有 agent 和框架共存：Claude Code、Codex、Aider、Cline、LangGraph、OpenHands 都可以成为 engine 后面的 worker 或 runtime，而不是必须被替代。

## 22. 与 Superpowers 的关系

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

## 23. 非目标

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

## 24. 路线图

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

## 25. 指标

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

## 26. 护城河

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

长期看，最值钱的是一套 AI 协助软件开发的工程操作系统。

## 27. 近期决策清单

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

## 28. 最终判断

Mission Control 不应该从“做一个更强的 agent”开始。

它应该从定义 AI 参与软件开发时，工作如何被规格化、执行化、验证化、记录化、变更化、回退化和协作化开始。

第一步不是完整平台，而是一个可以自己高频使用的本地闭环：

```text
mission -> plan -> approve -> worktree -> implement -> validate -> diff -> handoff
```

如果这个闭环稳定，后续再加 TUI、fast editor adapters、VS Code/Cursor extension、GitHub、dashboard 和团队治理。
