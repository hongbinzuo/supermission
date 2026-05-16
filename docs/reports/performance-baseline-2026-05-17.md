# Performance Baseline

Date: 2026-05-17

This baseline documents the first local performance/cost evidence suite. It is
intentionally deterministic and does not call external model services by default.

## Scope

- Runner token extraction from CLI output.
- Runner footprint/evaluation fields in `tool-calls.jsonl`.
- Runner telemetry fields in `telemetry.jsonl`.
- Mission summary read performance over a 51-task local fixture.
- Deterministic local cost fixture with a synthetic token count.

## Current Results

Latest local run:

```bash
BUN_BIN="$HOME/.bun/bin/bun" bun run test -- tests/performance.test.ts
```

Result:

- Test files: 1 passed.
- Tests: 3 passed.
- Duration: 748 ms.
- Token extraction fixture recorded `tokens_used = 1234`.
- Local cost fixture recorded `tokens = 2468`.
- Mission summary fixture stayed under 250 ms.
- Local cost fixture stayed under 2000 ms.

Budgets:

- Token extraction fixture records `tokens_used = 1234`.
- Local cost fixture records `tokens = 2468`.
- Mission summary fixture remains under 250 ms.
- Local cost fixture remains under 2000 ms.

## External Cost Tests

External Codex/Claude cost tests must stay opt-in:

```bash
SUPERMISSION_RUNNER_SMOKE=codex SUPERMISSION_CODEX_PROFILE=current bun run test -- -t "codex runner"
SUPERMISSION_RUNNER_SMOKE=claude SUPERMISSION_CLAUDE_MODEL=deepseek-chat bun run test -- -t "claude runner"
```

External runs should be summarized here with backend, profile/model, token usage
when available, latency, retry count, and pass/fail status.
