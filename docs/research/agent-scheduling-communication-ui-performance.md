# Agent Scheduling, Communication, And UI Performance

Date: 2026-05-17

This document captures current product/architecture assumptions that need to be
validated rather than treated as facts.

## Working Hypothesis

Code-scheduled agents are likely more reliable than free-form agent-to-agent
chat for software engineering work.

Supermission should be conservative and evidence-driven about multi-agent
features. General orchestration has many valid application scenarios, but
Supermission uses orchestration for software-delivery collaboration first. The
Factory practice is the initial implementation boundary: support explicit roles
where the value is clear, such as planner, coder, QA, reviewer, documentation,
and release checklist work. Larger orchestration patterns can be reference
material and later experiments, but they should not become the default product
shape until feedback and evals show value.

Supermission should start with explicit scheduling:

- work state machine
- task ledger
- runner registry
- worktree/scope isolation
- event/tool/telemetry records
- review and validation gates

Agent-to-agent communication should be avoided when artifacts are enough. If
collaboration is needed, use durable role handoffs first. If direct
communication is unavoidable, test the lowest-cost verifiable channel and keep
the resulting decisions in `.supermission/`.

## Role Collaboration Boundary

Allowed near-term collaboration patterns:

- Planner -> coder: plan, scope, risks, and acceptance criteria are handed off
  through `plan.md`, tasks, and requirements analysis.
- Coder -> QA: changed files, run evidence, and validation targets are handed
  off through events, tool calls, telemetry, `run.log`, and task artifacts.
- QA -> reviewer: validation results, screenshots/traces, failed assertions, and
  gaps are handed off through `validation.log`, review notes, and evidence.
- Reviewer -> owner: final diff, risks, unresolved questions, and next actions
  are handed off through `review.md` and `handoff.md`.

Factory-aligned scheduling defaults:

- Prefer serial milestone progression with targeted parallelism.
- Allow parallel work where coordination overhead is low, such as independent
  research, test planning, documentation, review, and validation analysis.
- Keep implementation and QA as separate roles when possible, because they
  produce different evidence and catch different failures.
- Treat browser/computer-use validation as additional user-flow evidence
  alongside test/lint/build, not as a replacement.
- Keep model/runtime choice per role behind runner adapters.

Deferred or experiment-only patterns:

- arbitrary agent-to-agent chat
- open-ended swarms
- multi-agent code mutation without isolation and merge gates
- framework-driven orchestration where the work record becomes secondary

These patterns are not rejected forever. They need a concrete software-delivery
use case, an eval design, token/runtime accounting, and a clear reason why
structured role handoffs are insufficient.

## Communication Model Options

### 1. Record-Based Coordination

Agents communicate through `.supermission/` artifacts:

- `work.yaml`
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
important outputs back into `.supermission/`.

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
   in `.supermission/`.
4. Minimal communication comparison: allow two role agents to exchange a small
   structured handoff only when record-only handoff is insufficient, then compare
   quality, cost, latency, and debuggability against record-only handoff.

The winning approach should be chosen by eval results, not preference.

## Frontend Performance Requirements

Future UI/TUI/web surfaces must feel fast even when works have large logs.

Principles:

- First screen should render supermission status, active task, latest blocker, and
  next action without loading every artifact.
- Use incremental reads for JSONL records.
- Paginate or virtualize tool calls, logs, and diffs.
- Stream runner progress separately from durable work state.
- Cache derived summaries, but keep `.supermission/` as source of truth.
- Avoid re-rendering full work timelines on every event.

Initial UI budgets to validate:

- Work list under 100 ms for 100 local works.
- Work summary under 250 ms for a 50-task fixture.
- Initial TUI/web detail view under 500 ms for a large work record.
- Log viewer remains responsive with 10k JSONL records through virtualization or
  pagination.

## Responsiveness Direction

The product should optimize for perceived and actual responsiveness:

- Fast first paint: show status, current phase, latest blocker, and next action
  before reading large logs.
- Streaming runner progress: long Codex/Claude/shell runs should show elapsed
  time, backend, profile, retry attempt, latest output, and cancellation options.
- Recoverable waits: every long wait should have a durable record, so closing
  the terminal or switching tools does not lose context.
- Incremental rendering: never re-render a full timeline or full log on each new
  event.
- Background projections: a later daemon can cache summaries and stream changes,
  but `.supermission/` remains the source of truth.

Implementation language is secondary. A Rust app can feel slow if it blocks on
long-running model calls, delays first render, or lacks streaming state. A JS/TS
app can feel fast if it uses incremental IO, bounded rendering, cancellation,
and cached projections.

## Web Validation Direction

For web projects, deterministic browser validation should start with Playwright:

- repeatable tests and assertions
- screenshots, traces, and videos as evidence
- stable CI behavior
- direct Chrome support
- clear failure output for `validation.log`

Codex computer use, browser-use agents, and similar exploratory browser drivers
are useful later as optional validators for UX exploration and human-like smoke
flows. They should be plugins or runner adapters, not the primary verification
path, until eval data shows they are stable enough to block a mission.

## Product Decision For Now

Supermission should prioritize code scheduling and role-separated durable
handoffs over agent-to-agent chat.

The durable communication layer is structured records. IPC is an execution
transport. UI surfaces are projections over records and should be optimized with
incremental loading, cached summaries, and bounded rendering.
