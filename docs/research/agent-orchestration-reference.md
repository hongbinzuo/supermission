# Agent Orchestration Reference Notes

Date: 2026-05-13

This document records what Supermission should learn from adjacent agent
orchestration projects. It is intentionally not a feature backlog. Any borrowed
idea must map to Supermission's current goals and milestones.

## Positioning

Supermission is the open-source, local-first Mission Control for AI Coding.

The primary baseline is Factory Missions:

- Plan collaboratively before execution.
- Execute by feature or milestone.
- Validate after each meaningful milestone.
- Keep work understandable to a human owner.

Supermission's concrete implementation differs by making repo-native
`.missions/` records the source of truth from the start.

## Main References

### 1. Factory Missions

Source: <https://docs.factory.ai/cli/features/missions>

Why it matters:

- Factory Missions is the closest product baseline.
- The useful abstraction is a mission as a planned, reviewable, milestone-based
  unit of work rather than an open-ended chat.
- The validation-after-milestone loop is directly aligned with Supermission.

What Supermission should copy conceptually:

- Collaborative planning before large execution.
- Feature/milestone decomposition.
- Explicit validation evidence.
- User-visible mission progress.

What Supermission should not copy blindly:

- Closed product assumptions.
- Cloud-first assumptions.
- Any workflow that makes local repo records secondary.

Roadmap mapping:

- V0: mission spec, plan, approve, run, validate, review, handoff.
- V0.5: runner backends that can execute the planned work.
- V0.7+: milestone/task queues with stronger Git/worktree isolation.

### 2. Builderz Labs Mission Control

Source: <https://github.com/builderz-labs/mission-control>

Why it matters:

- It represents the "control plane" framing for supervising multiple AI agents.
- It is useful as a UI/control-surface reference.

What Supermission should copy conceptually:

- A mission board/control-plane view over agent work.
- Agent status, task status, logs, and handoff as first-class review surfaces.
- Self-hostable/open tooling expectations.

What Supermission should not copy blindly:

- Dashboard-first architecture before the engine contract is stable.
- Any state model that bypasses Git-backed mission artifacts.
- A large monolithic app shape.

Roadmap mapping:

- V1 Terminal TUI should be the first richer control surface.
- Later web/editor surfaces should reuse the same engine and records.

### 3. Ruflo

Source: <https://github.com/ruvnet/ruflo>

Why it matters:

- Ruflo is an aggressive reference for Claude Code-oriented multi-agent
  orchestration, plugins, memory, and swarm-style execution.
- It shows where the market is going: agents need coordination, memory,
  observability, and policy boundaries.

What Supermission should copy conceptually:

- Pluginized capabilities instead of one huge application.
- Separate concerns for runners, memory/indexing, validation, docs, security,
  and observability.
- Native integration points for coding agents instead of forcing one runtime.

What Supermission should not copy blindly:

- A large list of agents/plugins before the mission engine is reliable.
- Swarm execution before scope, merge, rollback, and validation are strong.
- Marketing-driven capability claims without reproducible tests.

Roadmap mapping:

- V0.6: explicit component/plugin boundaries.
- V0.7+: multi-runner orchestration only after linear mutation safety is proven.
- V2: documented extension points.

### 4. Gas Town / Steve Yegge Concepts

Source notes:

- User-provided Gas Town summary in project conversation.
- Public discussion should be re-verified before quoting exact dates, star
  counts, or repository claims.

Why it matters:

- Gas Town is the clearest conceptual reference for many coding agents working
  concurrently with Git-backed work state.
- The useful concepts are not the names themselves, but the abstractions:
  coordinator, workers, persistent workspaces, work items, grouped work, and
  supervision.

Concept mapping:

| Gas Town concept  | Supermission-compatible abstraction                                      |
| ----------------- | ------------------------------------------------------------------------ |
| Mayor             | Mission supervisor / planner / coordinator                               |
| Worker agents     | Runner-backed actors                                                     |
| Hooks / worktrees | Isolated mission or task workspaces                                      |
| Beads             | Task ledger items with dependencies                                      |
| Convoys           | Milestone or grouped task execution                                      |
| MEOW              | Decompose work into explicit, reviewable units                           |
| GUPP              | Ready work should be discoverable and runnable                           |
| NDI               | Expect nondeterminism; rely on evidence, retry, validation, and recovery |

What Supermission should copy conceptually:

- Git-backed state and worktree isolation.
- Small task records with dependencies and readiness.
- Supervisor signals for stuck work, repeated failure, and scope drift.
- Recovery based on persisted evidence, not chat memory.

What Supermission should not copy blindly:

- 20-30 concurrent code-mutating agents before merge safety exists.
- Git-as-database everywhere. For Supermission, Git-backed files are the source
  of truth; later SQLite can be an index.
- Mascot/domain-specific terminology in user-facing product language.

Roadmap mapping:

- V0 already has `.missions/`, task ledger, events, telemetry, supervisor
  signals, checkpoints, and rollback checks.
- V0.7 should strengthen worktree isolation and task readiness.
- Parallel mutation should wait for merge queue and review gates.

## Adjacent References

### LangGraph

Source: <https://langchain-ai.github.io/langgraph/>

Useful ideas:

- Durable execution.
- Explicit state machines.
- Human-in-the-loop checkpoints.
- Long-running agent workflow patterns.

Supermission mapping:

- Keep the mission state machine explicit.
- Make gates and artifacts inspectable.
- Prefer resumable mission records over hidden runtime memory.

### AutoGPT-style autonomous agents

Useful ideas:

- Goal-driven decomposition.
- Tool-using loops.

Risks:

- Too much autonomy without review gates.
- High cost and weak determinism.
- Hard-to-debug execution traces.

Supermission mapping:

- Use autonomy only inside mission boundaries.
- Completion requires validation and evidence, not a model's claim.

### Claude Code, Codex, and other coding CLIs

Useful ideas:

- Runners should be adapters.
- The same mission should be executable through different backends.
- Backend-specific auth/profile/config must stay outside the mission engine.

Supermission mapping:

- `record`, `shell`, `codex`, and `claude` are early runner backends.
- Future backends should implement the same runner contract.

## Design Decisions For Now

1. Factory Missions is the main baseline.
2. Supermission remains open-source and local-first.
3. `.missions/` remains the source of truth.
4. Runner integration is plugin-shaped, but the V0 implementation can stay
   simple until the contract stabilizes.
5. Multi-agent execution must be evidence-driven, not chat-driven.
6. Parallel code mutation is deferred until isolation, merge, rollback, and
   review are strong.
7. Documentation must move with implementation.

## Immediate Product Implications

- Keep improving the unified runner layer.
- Add real integration smoke tests for external backends with explicit profiles.
- Treat `run.log`, `tool-calls.jsonl`, `telemetry.jsonl`, and
  `supervisor-signals.jsonl` as required evidence.
- Every place an agent appears needs a footprint map: actor, backend, prompt or
  command summary, tool calls, changed files, artifacts, validation evidence,
  review result, retry history, and handoff summary should be reconstructable
  without reading chat history.
- Agent results need an evaluation mechanism. The first evaluation set should be
  built from real missions: goal, acceptance criteria, baseline files, expected
  artifact evidence, validation commands, review rubric, and pass/fail labels.
- Design plugin boundaries before adding many plugins.
- Build TUI/control surfaces over existing records instead of inventing a second
  state store.
- Keep roadmap changes tied to concrete milestones.
- Add requirements analysis before implementation. Kiro's deep-spec direction is
  a mainline product reference: use LLMs for rewriting vague natural language
  into testable criteria, then use deterministic/logic-based checks where
  possible. Start with deterministic local checks and only add solver-backed
  proof for requirement families that can be represented soundly.

Scheduling and communication tradeoffs are tracked in
[`agent-scheduling-communication-ui-performance.md`](./agent-scheduling-communication-ui-performance.md).

## Agent Footprints And Evaluation Sets

Agent orchestration is not useful if the user cannot inspect where agents acted
or judge whether the result is good. Supermission should treat these as core
records:

- Footprint map: a mission-level graph from actor to task, runner backend, tool
  calls, files changed, artifacts produced, validation commands, review findings,
  retries, and handoff.
- Evaluation record: a structured assessment of agent output against acceptance
  criteria, validation evidence, scope discipline, review findings, and handoff
  quality.
- Evaluation set: reusable mission fixtures collected from real work and small
  synthetic cases. Each case should include goal, initial context, allowed scope,
  expected evidence, validation commands, review rubric, and labels.

Near-term implementation path:

1. Add footprint fields to runner/tool-call records.
2. Generate `footprint.md` from existing event/tool/telemetry/artifact records.
3. Add `evals/` fixtures that can replay small mission scenarios.
4. Add `mission eval run` to score a completed mission against a rubric.
5. Promote high-signal real missions into regression eval cases.
