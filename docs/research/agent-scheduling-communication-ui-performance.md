# Agent Scheduling, Communication, And UI Performance

Date: 2026-05-17

This document captures current product/architecture assumptions that need to be
validated rather than treated as facts.

## Working Hypothesis

Code-scheduled agents are likely more reliable than free-form agent-to-agent
chat for software engineering work.

Supermission should start with explicit scheduling:

- mission state machine
- task ledger
- runner registry
- worktree/scope isolation
- event/tool/telemetry records
- review and validation gates

Agent-to-agent communication should be tested as an optional layer, not as the
source of truth.

## Communication Model Options

### 1. Record-Based Coordination

Agents communicate through `.missions/` artifacts:

- `mission.yaml`
- `tasks/*.yaml`
- `events.jsonl`
- `tool-calls.jsonl`
- `telemetry.jsonl`
- `supervisor-signals.jsonl`
- `plan.md`, `review.md`, `handoff.md`, `run.log`

Pros:

- Git-backed, reviewable, recoverable.
- Easy to replay and audit.
- Works across processes and machines.
- Good fit for footprint maps and eval datasets.

Cons:

- Higher latency than direct IPC.
- Needs careful append-only discipline.

Default choice for V0/V1.

### 2. Process IPC

Agents communicate through child process stdio, sockets, or local RPC.

Pros:

- Lower latency.
- Useful for streaming progress and cancellation.
- Natural fit for runner supervisors.

Cons:

- Harder to replay.
- More failure modes.
- Must not become source of truth.

Use only for runner lifecycle, streaming status, and cancellation. Persist
important outputs back into `.missions/`.

### 3. Message Bus / Queue

Agents communicate through a local queue or broker.

Pros:

- Better concurrency and backpressure.
- Natural retry/dead-letter semantics.

Cons:

- More infrastructure.
- Easy to overbuild before engine contracts are stable.

Defer until task queues and worktree isolation are mature.

## Experiments To Run

1. Code scheduler baseline: one coordinator process reads ready tasks and starts
   runner executions according to task scope and mutation mode.
2. Record-only handoff: one agent writes task output and another agent continues
   from artifacts only.
3. IPC streaming: runner streams progress to a monitor while final state remains
   in `.missions/`.
4. Agent chat comparison: allow two agents to exchange summaries, then compare
   quality, cost, latency, and debuggability against record-only handoff.

The winning approach should be chosen by eval results, not preference.

## Frontend Performance Requirements

Future UI/TUI/web surfaces must feel fast even when missions have large logs.

Principles:

- First screen should render mission status, active task, latest blocker, and
  next action without loading every artifact.
- Use incremental reads for JSONL records.
- Paginate or virtualize tool calls, logs, and diffs.
- Stream runner progress separately from durable mission state.
- Cache derived summaries, but keep `.missions/` as source of truth.
- Avoid re-rendering full mission timelines on every event.

Initial UI budgets to validate:

- Mission list under 100 ms for 100 local missions.
- Mission summary under 250 ms for a 50-task fixture.
- Initial TUI/web detail view under 500 ms for a large mission.
- Log viewer remains responsive with 10k JSONL records through virtualization or
  pagination.

## Product Decision For Now

Supermission should prioritize code scheduling over agent-to-agent chat.

The durable communication layer is structured records. IPC is an execution
transport. UI surfaces are projections over records and should be optimized with
incremental loading, cached summaries, and bounded rendering.
