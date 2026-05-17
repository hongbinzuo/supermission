# Mission Control Mutation Testing Baseline

日期：2026-05-12

## Baseline Result

StrykerJS mutation testing 已跑通，并作为报告型高级测试 gate 保留。

最新结果：

```text
Mutation score: 41.59%
Covered score: 47.67%
Killed: 694
Timeout: 11
Survived: 774
No coverage: 216
Errors: 506
```

报告位置：

```text
reports/mutation/mutation.html
```

## 判断

当前单元、集成、property-based 和 CLI 测试已经能保证主要 happy path、失败分支和 artifact 生成。新增 monitor、scope audit、linear mutation guard、secret redaction、policy allowlist、scoped patch capture、rollback check 和 workflow gates 后，mutation score 已从 31.89% 提升到 37.66%，再提升到 39.32% 和 41.59%，但仍显示测试对细粒度行为约束还不够强。

这不阻塞 V0 人工试用，但必须作为质量改进基线。

## 当前策略

`test:mutation` 暂时作为报告型 gate，不作为 blocking gate。

原因：

- V0 仍在快速补核心能力。
- mutation 测试耗时约 7-8 分钟。
- 当前大量 survived mutants 来自文案、默认字段、schema 默认值、辅助函数和未细化的 edge cases。

## 下一步补测重点

优先补：

- `slugify` 对大小写、长度、连续分隔符、空字符串的更严格断言。
- duplicate mission id。
- unknown mission / unknown task / unknown change。
- default actors 和 default workflow 必须完整。
- `listMissionIds` 排序和忽略不完整目录。
- risky command policy 覆盖每个高风险模式。
- redaction policy 覆盖更多 token/key/header 变体。
- scope audit 覆盖 allow/deny、untracked、tracked、rename、`.supermission/` 忽略语义。
- `readJsonl` 对空行、空白行、missing file 的行为。
- `doctor` 对 stale handoff、checkpoint missing、pending change 的组合情况。
- `summarizeMission` artifact path 和 finding count。

目标：

```text
V0.1: mutation score >= 45%
V0.2: mutation score >= 60%
V1: mutation score >= 70%
```
