# Supermission

[![项目阶段](https://img.shields.io/badge/stage-v0%20local--first-blue)](#v0-范围)
[![包状态](https://img.shields.io/badge/package-private-lightgrey)](#安装与发布状态)
[![运行时](https://img.shields.io/badge/runtime-Bun%20%3E%3D%201.3-000000)](#工具链)
[![Node](https://img.shields.io/badge/node-%3E%3D%2022-339933)](#工具链)
[![测试](https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright%20%2B%20Stryker-6E9F18)](#验证)
[![许可证](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

[English README](./README.md)

Supermission 是一个早期的开源 Mission Control for AI Coding 实现。

产品方向是把 AI coding 从聊天记录变成工程记录：任务规格、计划、执行、
验证、评审、交接、回退和可观测证据都沉淀到仓库里。当前实现保持克制：
Bun-first TypeScript、本地优先、Git-backed `.missions/` 记录、线性代码变更、
强测试和可扩展 runner 层。

## V0 范围

- Git-backed `.missions/<mission-id>/` 任务记录。
- `mission.yaml` 作为 mission 规格和状态文件。
- `requirements-analysis.md` 用于实现前的需求质量检查。
- Append-only `events.jsonl`、`telemetry.jsonl`、`tool-calls.jsonl`、
  `supervisor-signals.jsonl`。
- `tasks/` 任务台账，保留 actor role、依赖和 mutation mode。
- `plan.md`、`run.log`、`validation.log`、`debug.md`、`handoff.md`、
  `decisions.md`、`review.md`、`monitor.md`、`patch.diff` 等工程产物。
- Headless CLI：创建、规划、批准、执行、验证、追踪、检查、监控、调试和交接。
- 受控变更流程：`mission change ...`。
- 线性代码变更保护：sidecar 任务后续可并行，但 `linear_write` 同时只能有一个。
- 统一 runner 层：`record`、`shell`、`codex`、`claude` 通过同一 mission run 接口接入。

核心 engine 保持 runner-neutral。模型运行时放在 runner/adapter 层，按 mission 可选启用。

## 安装与发布状态

当前还没有正式安装包或发布渠道。

- `package.json` 目前是 `"private": true`。
- 还没有 npm、Homebrew、Docker 或二进制发布。
- 当前使用方式是从仓库本地开发运行。
- 推荐的第一条公开发布路径是 npm package，然后 GitHub Releases。Homebrew 和 Docker
  等 CLI 合约、文件布局和 runner 配置稳定后再做。
- 发布和数据决策见
  [`docs/architecture/release-and-data-decisions.md`](./docs/architecture/release-and-data-decisions.md)。

本地开发：

```bash
bun install
bun run build
bin/mission --help
```

## 工具链

- Bun
- TypeScript
- commander
- zod
- yaml
- minimatch
- Vitest
- fast-check
- Playwright
- StrykerJS
- tsup
- ESLint
- Prettier

## 执行模型

V0 已为编排做准备，但代码变更仍然保持线性。

- 以后可以并行的 sidecar 任务：调研、测试计划、文档、评审、日志分析、验证分析。
- 代码、配置、schema、环境变更继续线性执行，直到 merge queue、回退检查点、
  review gate 和冲突处理成熟。

```mermaid
flowchart LR
  User[Human owner] --> Spec[mission.yaml]
  Spec --> Plan[plan.md]
  Plan --> Gate{approve_plan}
  Gate --> Run[runner backend]
  Run --> Evidence[events / tool calls / telemetry / run.log]
  Evidence --> Validate[validation.log]
  Validate --> Review[review.md + patch.diff]
  Review --> Handoff[handoff.md]
```

```mermaid
flowchart TB
  CLI[CLI / future TUI / editor adapters]
  Engine[Local Mission Engine]
  Store[Git-backed .missions records]
  Runners[Runner adapters]
  Tools[Shell / Codex / Claude Code / future plugins]

  CLI --> Engine
  Engine --> Store
  Engine --> Runners
  Runners --> Tools
  Tools --> Store
```

## 快速开始

```bash
bun install
bun run build

bin/mission new "Add login validation" \
  --acceptance "Invalid logins show an error" \
  --validation "bun run test"

bin/mission plan <mission-id>
bin/mission requirements check <mission-id>
bin/mission approve <mission-id>
bin/mission run <mission-id> \
  --backend shell \
  --command "printf 'implemented' > runner-output.txt"
bin/mission run <mission-id> \
  --backend codex \
  --profile your-profile \
  --fallback-profile another-profile \
  --prompt "Reply only with codex-smoke-ok." \
  --timeout-ms 60000
bin/mission run <mission-id> \
  --backend claude \
  --prompt "Reply only with claude-smoke-ok." \
  --timeout-ms 60000
bin/mission validate <mission-id>
bin/mission review create <mission-id>
bin/mission handoff <mission-id>
```

## 命令索引

核心流程：

- `mission new`
- `mission plan`
- `mission requirements check`
- `mission approve`
- `mission run`
- `mission validate`
- `mission handoff`

人类评审和可观测性：

- `mission status`
- `mission summary`
- `mission monitor`
- `mission doctor`
- `mission trace`
- `mission logs`
- `mission debug`
- `mission inspect`
- `mission review create`
- `mission policy init`
- `mission policy show`

受控变更：

- `mission change propose`
- `mission change list`
- `mission change show`
- `mission change approve`
- `mission change apply`
- `mission change reject`
- `mission change defer`
- `mission change split`

任务台账：

- `mission tasks`
- `mission task add`
- `mission task set-status`
- `mission task audit-scope`

Runner 诊断：

- `mission runner list`
- `mission runner profiles`
- `mission runner config init`
- `mission runner config show`
- `mission runner smoke`

Git 证据和隔离：

- `mission diff`
- `mission checkpoint create`
- `mission checkpoint list`
- `mission branch create`
- `mission worktree create`
- `mission rollback-plan`
- `mission rollback-check`

## 产品路线图

路线图按 milestone 维护，必须随实现变化更新。未来 agent 的维护规则见
[`AGENTS.md`](./AGENTS.md)。

| 里程碑 | 重点                                                                                                  | 当前状态 |
| ------ | ----------------------------------------------------------------------------------------------------- | -------- |
| V0     | 本地 mission records、CLI 状态机、artifacts、验证、评审、交接、回退计划                               | 进行中   |
| V0.5   | 统一 runner 层，接入 record、shell、Codex、Claude Code；补真实集成 smoke tests                        | 进行中   |
| V0.6   | 需求分析、本地能力测评、runner、validator、artifact writer、policy、workflow template 的插件/组件边界 | 进行中   |
| V0.7   | Agent 足迹图、结果测评记录、可复用 eval set、Git/worktree 隔离、任务队列                              | 计划中   |
| V1     | Terminal TUI 复用同一个 engine，不复制 mission logic                                                  | 计划中   |
| V1.5   | CLI/TUI 合约稳定后做 editor adapters                                                                  | 计划中   |
| V2     | 开源扩展点、安装发布流水线、兼容性目标文档                                                            | 计划中   |

主要对标基线是 Factory Missions 的协作规划、按 milestone 执行和验证闭环。
Supermission 的定位是这个方向的开源、本地优先版本，`.missions/` 是 source of truth。

参考项目调研见
[`docs/research/agent-orchestration-reference.md`](./docs/research/agent-orchestration-reference.md)。
这些项目用于抽象方法参考，不作为功能堆叠清单。
Token 和运行性能策略见
[`docs/research/token-performance-strategy.md`](./docs/research/token-performance-strategy.md)。
Agent 调度、通信和前端性能取舍见
[`docs/research/agent-scheduling-communication-ui-performance.md`](./docs/research/agent-scheduling-communication-ui-performance.md)。
Supermission 自身产品能力测评循环见
[`docs/evaluations/supermission-capability-evaluation.md`](./docs/evaluations/supermission-capability-evaluation.md)。
当前本地确定性 baseline fixture 是
[`evals/supermission-capability-baseline.yaml`](./evals/supermission-capability-baseline.yaml)。
Web 项目验证默认走 Playwright 这种确定性路径；computer/browser-use agent 后续可以
作为探索式 validator 插件，但不能替代可重复断言、截图和 trace 证据。

## 验证

```bash
bun run check
bun run lint
bun run format:check
BUN_BIN="$HOME/.bun/bin/bun" bun run test:capability
BUN_BIN="$HOME/.bun/bin/bun" bun run test
bun run build
```

真实外部 runner smoke test 是显式开启的，避免普通单元测试被本地 profile
缺失影响。需要让真实后端失败阻断时，明确打开：

```bash
SUPERMISSION_RUNNER_SMOKE=codex SUPERMISSION_CODEX_PROFILE=your-profile bun run test
SUPERMISSION_RUNNER_SMOKE=claude bun run test
SUPERMISSION_RUNNER_SMOKE=all SUPERMISSION_CODEX_PROFILE=your-profile bun run test
```

Codex backend 的 `--profile <name>` 会先按名称或 id 匹配 CC Switch 的 codex
provider。匹配成功时，Supermission 会为子进程创建临时 `CODEX_HOME`，不会把
provider secret 写进仓库或 run log。匹配不到时，这个值会继续作为 Codex 原生
`-p/--profile` 传入。

使用 `--profile current` 可以跟随 CC Switch 当前选中的 Codex provider。

需要自动换 profile 时，可以重复传入 `--fallback-profile`；前一个 profile 失败后，
runner 会继续尝试后面的 profile，全部失败才让 mission run 失败。

项目级默认 runner 配置保存在 `.missions/runners.yaml`。使用
`mission runner config init/show` 管理第一版配置；显式传给 `mission run` 的参数
优先级高于项目配置。

测试覆盖黑盒 CLI 集成、property-based tests、schema validation、失败分支、
supervisor signals 和基础 trace 性能预算。`bun run test:capability` 会运行当前
Supermission 产品能力 baseline，不调用外部模型服务。当前完整测试数量以
`bun run test` 输出为准。

## 决策与剩余工作

- License: Apache-2.0。
- 公开发布路径：先 npm package，再 GitHub Releases；Homebrew/Docker 后置。
- Codex/Claude Code 等真实后端 smoke test 保持显式 opt-in；缺 profile 或凭证要清晰失败，不能泄露密钥。
- 数据库后续只能作为可重建索引/cache，不能取代 `.missions/` 的 source of truth。
- validation command 为空时到底应标记 `blocked` 还是 `needs_decision`，仍需结合真实使用继续评估。
