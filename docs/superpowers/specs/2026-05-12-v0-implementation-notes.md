# Mission Control V0 Implementation Notes

日期：2026-05-12

## 当前实现

V0 已实现为 Bun-first TypeScript CLI。

入口：

```text
bin/mission
bun run mission -- <command>
```

核心文件：

```text
src/
  cli.ts
  store.ts
  types.ts
  paths.ts
  jsonl.ts
  slug.ts
  time.ts
tests/
  cli.test.ts
  store.test.ts
  helpers.ts
```

## 已实现命令

```text
mission new
mission plan
mission approve
mission run
mission validate
mission status
mission tasks
mission trace
mission logs
mission debug
mission inspect
mission handoff
mission change propose
mission change list
mission change show
mission change approve
mission change apply
mission change reject
mission change defer
mission change split
mission diff
mission checkpoint create
mission checkpoint list
mission branch create
mission worktree create
mission rollback-plan
mission rollback-check
mission policy init
mission policy show
mission doctor
mission monitor
mission summary
mission review create
mission task add
mission task set-status
mission task audit-scope
```

## 已实现 Artifact

每个 mission 创建：

```text
.missions/<mission-id>/
  mission.yaml
  events.jsonl
  telemetry.jsonl
  tool-calls.jsonl
  supervisor-signals.jsonl
  tasks/
    task-001.yaml
  changes/
    change-001.yaml
  checkpoints/
    checkpoint-001.yaml
    checkpoint-001.patch
  isolation.yaml
  rollback-plan.md
  plan.md
  decisions.md
  validation.log
  review.md
  monitor.md
  scope-audit.md
  debug.md
  handoff.md
  patch.diff
```

## 当前设计取舍

- 主栈采用 Bun + TypeScript。
- `mission.yaml` 和 task ledger 使用 `yaml` 解析。
- `zod` 负责 mission spec 和 task schema 校验。
- `events.jsonl` 是工程事件 source of truth。
- `telemetry.jsonl`、`tool-calls.jsonl`、`supervisor-signals.jsonl` 是可观测性证据。
- task schema 已支持 `sidecar_readonly`、`sidecar_artifact`、`linear_write`，但 V0 默认只使用 `linear_write`。
- 旁路任务未来可以并行，代码/配置/schema/environment 变更保持线性。
- `mission run` 目前只是记录外部 agent 或人工实现动作，不调用真实模型。
- `mission validate` 会真实执行 shell 命令，并保存 stdout/stderr。
- 缺少 validation commands 时会写入 `validation_missing` supervisor signal。
- `mission inspect` 可以按 zero-based index 或稳定 record id 查看单条 `events`、`telemetry`、`tool-calls` 或 `supervisor` 记录。
- `mission handoff` 在 mission 已 `validated` 时会把状态推进到 `completed`。
- 核心 workflow gate 已做基础状态校验：`approve_plan` 必须在 `planned` 后执行，`run` 必须在 approved/review/recovery 状态执行，默认 completion handoff 必须在 `validated` 后执行。
- out-of-order workflow 操作会写入 `gate_waiting` supervisor signal 和 `workflow.blocked` event。
- `mission change propose` 会创建结构化 change proposal，并将 mission 状态推进到 `needs_decision`。
- `mission change approve/reject` 会写入 decision event，并恢复 proposal 前的 mission 状态。
- `mission change apply` 已支持在 change 批准后安全追加 acceptance、validation commands、workflow steps 到 `mission.yaml`，并可追加受控 plan notes 到 `plan.md`。
- apply 会记录 `change.applied` event、change application metadata 和 `decisions.md` 证据；更复杂的结构化 `plan.md` patch/apply 机制仍待后续实现。
- `mission diff` 会把当前 git diff 捕获到 `patch.diff`，默认排除 `.missions/**` 以避免 mission evidence 污染 patch snapshot。
- patch snapshot 会同时捕获 tracked changes 和 untracked files。
- `mission diff --task <task-id>` 会按 task scope 捕获 patch，同时对当前所有 git changes 执行 scope audit，越界时仍写入 `scope_drift` evidence。
- `mission checkpoint create/list` 支持非破坏性 checkpoint capture，默认排除 `.missions/**`；`checkpoint create --task <task-id>` 支持按 task scope 捕获 checkpoint patch；自动 rollback 仍是 TBD。
- `mission branch create` 会创建 mission branch，但不切换当前分支。
- `mission worktree create` 必须显式传入 `--path`，避免工具偷偷创建位置不明的工作区。
- `mission rollback-plan` 只生成人工可审查的回退计划，不执行回滚。
- `mission rollback-check` 会用 checkpoint patch 执行非破坏性的 reverse apply check，确认当前工作区是否能干净回退；失败时写入 `merge_conflict` supervisor signal。
- `mission doctor` 会诊断 mission 健康度，发现 blocking 问题时返回非零 exit code。
- `mission monitor` 会生成 `monitor.md`，并展示 active tasks、ready tasks、blocked tasks、pending changes、supervisor signals、recent events 和 next actions。
- validation command 多次重复失败时会写入 `repeated_failure` supervisor signal，并由 `mission doctor` / `mission monitor` 展示为 blocking finding。
- 长时间未更新的 running task 会被 `mission doctor` 诊断为 `stuck` warning。
- `mission summary` 会输出适合人类快速扫读的一屏摘要：状态、发现、任务数、变更数、checkpoint 和关键 artifact 路径。
- `mission review create` 会根据当前 evidence 生成 `review.md`，用于人工审核 intent、scope、validation、rollback、handoff。
- `mission task add/set-status` 支持登记旁路任务或线性写入任务，但不自动执行调度。
- task ledger 已支持基础依赖解锁：依赖任务全部 `done` 后，pending task 会自动切到 `ready`。
- task ledger 已支持线性写入保护：同一 mission 同一时间只允许一个 `linear_write` task 处于 `running`；`sidecar_readonly` 和 `sidecar_artifact` 可以并行记录。
- task ledger 已支持 scope audit：使用 `minimatch` 检查当前 git changes 是否违反 task `scope.allow` / `scope.deny`，并在越界时写入 `scope_drift` supervisor signal 和 `scope-audit.md`。
- `mission validate` 默认阻止明显危险命令，例如 `rm -rf`、`git reset --hard`、`sudo`、`docker system prune`、`kubectl delete` 等；必须先通过 `approve_risky_command` gate，并显式传 `--allow-risky` 才会执行。
- 可选 `.missions/policy.yaml` 支持 `validation_allowlist`；存在 allowlist 时，不匹配的 validation command 会被阻止并写入 `command_policy_blocked` supervisor signal。
- 可选 `.missions/policy.yaml` `redaction.patterns` 可为验证输出追加自定义正则脱敏规则。
- `mission policy init/show` 支持创建和查看项目 policy 文件。
- validation log 和 tool-call record 写入前会对常见 key/token/secret/password env var、JSON field、API-key header、Bearer token、OpenAI `sk-*`、GitHub 和 GitLab token 形态做基础脱敏。

## 测试与质量

当前测试使用：

```text
Vitest
fast-check
```

覆盖：

- black-box CLI flow: `new -> plan -> approve -> run -> validate -> handoff -> trace -> inspect`
- property-based slug generation
- property-based YAML roundtrip for acceptance / validation commands
- schema validation
- validation failure branch
- missing validation supervisor signal
- controlled change proposal lifecycle
- approved change apply lifecycle
- mission monitor report and supervisor signal inspection
- repeated validation failure supervisor signal
- stale running task stuck diagnosis
- workflow state gate enforcement
- git diff and checkpoint capture
- task-scoped diff and checkpoint capture
- git branch/worktree isolation
- non-destructive rollback plan
- non-destructive rollback check
- mission doctor health checks
- compact human summary
- review artifact generation
- sidecar task ledger commands
- task dependency unblocking
- concurrent linear mutation blocking with sidecar parallelism allowed
- task scope drift audit
- risky validation command blocking
- risky validation approval gate
- project validation command allowlist
- policy init/show CLI
- validation secret redaction
- broader secret redaction variants
- task ledger generation
- trace performance budget for 1000 events

当前 quality gates：

```text
bun run check
bun run lint
bun run format:check
BUN_BIN="$HOME/.bun/bin/bun" bun run test
bun run build
```

## TBD / Needs Review

- state transition 已对核心 workflow gate 做基础校验；后续是否扩展到 validate/review/change 仍待确认。
- `mission run` 后当前进入 `needs_review`。
- 没有 validation commands 时当前进入 `blocked`，需要确认是否更适合 `needs_decision`。
- validation command 的基础 risky gate、项目级 allowlist 和可配置 redaction patterns 已落地；后续仍需更完整 profile/policy。
- patch snapshot 已默认排除 `.missions/**`，已覆盖 tracked/untracked files，并支持按 task scope 捕获；后续可按更完整 mission scope 捕获。
- 新写入的 JSONL records 会物化 `record_id`；旧 records 仍可在读取时合成兼容 id。
- approved change 已可安全 append 到 mission spec 和 plan notes；下一步是结构化 patch `plan.md` / scope / task ledger。
- destructive checkpoint rollback 何时开放，以及是否必须要求 explicit destructive gate；非破坏性 rollback check 已落地。
- Stryker mutation testing 配置已加入，但还没有作为必跑 gate。
- 最新普通测试数：62 个 Vitest 测试。
- Playwright 配置已加入，等 TUI/Web/IDE view 出现后启用。
