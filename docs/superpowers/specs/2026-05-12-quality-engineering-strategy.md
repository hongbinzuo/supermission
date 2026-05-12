# Mission Control Quality Engineering Strategy

日期：2026-05-12

## 1. 测试目标

Mission Control 的测试不能停留在普通单元测试。

它要验证三类质量：

1. 功能正确性：命令、状态、artifact、日志、验证、handoff 是否正确。
2. 性能与稳定性：长任务、多 mission、大日志、频繁 event 写入是否可接受。
3. 逻辑合理性：状态机、gate、change proposal、rollback、agent scope 是否符合工程常识。

核心原则：

```text
Every AI coding action must leave testable engineering evidence.
```

中文：

```text
每个 AI coding 动作都必须留下可测试的工程证据。
```

## 2. 测试分层

### 2.1 Unit Tests

工具：Vitest。

覆盖：

- mission id / slug 生成。
- YAML schema parse / serialize。
- event append。
- status update。
- path resolution。
- validation result parsing。

### 2.2 Property-based Tests

工具：fast-check。

用于测试多假设分支和输入空间：

- 任意 goal 都能生成合法 mission id。
- 任意 acceptance / validation list roundtrip 后不丢失。
- 任意 event payload append 后仍是合法 JSONL。
- 状态转换不会生成未知状态。

### 2.3 CLI Integration Tests

工具：Vitest + Bun subprocess。

覆盖完整命令流：

```text
new -> plan -> approve -> run -> validate -> handoff -> trace -> inspect
```

异常分支：

- unknown mission。
- duplicate mission id。
- missing validation commands。
- validation command failed。
- invalid inspect index。
- malformed mission.yaml。
- task scope drift。
- concurrent linear mutation conflict。

### 2.4 Fixture / Golden Tests

用固定 fixture 验证 artifact 输出：

- `mission.yaml`
- `events.jsonl`
- `plan.md`
- `validation.log`
- `debug.md`
- `handoff.md`

Golden tests 不要求每个 timestamp 完全一致，应 normalize dynamic fields。

### 2.5 State Machine Tests

验证逻辑合理性：

- plan 前不能 approve completion。
- approve_plan 后进入 approved。
- validation passed 后进入 validated。
- handoff 后才 completed。
- change proposed 后进入 needs_decision。
- blocked / failed 必须有 reason。

V0 可以宽松，但测试应标注哪些是当前行为，哪些是目标行为。

### 2.6 Performance Tests

性能测试不是等到后期再做。

V0/V1 需要预算：

- 创建 mission < 100ms。
- append event < 20ms。
- trace 1000 events < 200ms。
- inspect single event < 50ms。
- status list 100 missions < 300ms。

测试方式：

- 使用临时目录生成大量 mission/event。
- 用 `performance.now()` 测量。
- 默认阈值先宽松，CI 中可逐步收紧。

### 2.7 Concurrency / File Safety Tests

Mission Control 是文件系统产品，必须测试并发边界：

- 多次 append JSONL 不破坏行结构。
- 并行 mission 创建不会冲突。
- 失败写入不会产生半个 YAML。
- 后续需要 atomic write 和 lockfile。

V0 暂不承诺强并发安全，但要把风险测试标出来。

### 2.8 Security / Command Boundary Tests

`mission validate` 会执行 shell 命令，因此需要安全测试：

- 命令必须被记录到 `tool-calls.jsonl`。
- stdout/stderr 必须落盘。
- exit code 必须影响状态。
- 后续 risky command 需要 gate。
- secret redaction 必须覆盖 validation log 和 tool-call record 的常见 key/token/secret 形态。

### 2.9 UI / UX E2E Tests

一旦出现 TUI/Web/VS Code view：

工具：Playwright。

覆盖：

- desktop / mobile viewport。
- loading / empty / failed / blocked / needs_decision。
- mission list 到 mission detail 的完整路径。
- visual screenshot review。
- no overlap / no clipped text。
- dark/light mode TBD。

### 2.10 Mutation Testing

工具：StrykerJS。

目标不是追求 100%，而是发现测试是否只是覆盖代码却没有验证行为。

优先 mutation 范围：

- state machine。
- schema validation。
- event writing。
- validation result handling。
- change proposal policy。

## 3. 质量 Gates

V0 本地 gate：

```text
bun run check
bun run lint
bun run test
bun run build
```

V0.1 增加：

```text
bun run test:mutation
```

当前 `test:mutation` 先作为报告型 gate，不作为 blocking gate。首次 baseline 为 32.09%，说明测试策略方向正确但行为约束还需要继续加强。

前端出现后增加：

```text
bun run test:e2e
```

## 4. TBD / Needs Review

- 是否引入 benchmark 专用工具，如 `tinybench`。
- mutation threshold 初始值是否过高。
- performance tests 是否默认在 CI 跑，还是 nightly 跑。
- command execution 是否默认启用项目级 allowlist/profile；基础 risky command gate 和可选 validation allowlist 已落地。
- secret redaction 当前是基础规则，后续是否引入可配置 redaction policy。
- scope audit 是否需要支持更完整的 git porcelain v2 / rename 语义；patch capture 已覆盖 tracked/untracked files。
