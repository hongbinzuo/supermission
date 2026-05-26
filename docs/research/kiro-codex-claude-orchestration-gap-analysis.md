# Kiro, Codex, Claude, And Agent Orchestration Gap Analysis

Date: 2026-05-17

This note compares recent project/spec/goal management patterns in Kiro,
Codex, Claude Code, and adjacent agent orchestration systems against
Supermission's product goal.

Supermission's target is unchanged: an easy-to-use team software creation
collaboration tool. It should help a team turn intent into requirements,
design, tasks, execution evidence, validation, review, and handoff. It should
not become a feature pile or a specialist-only agent framework.

## High-Level Conclusion

Codex and Claude Code are becoming better interactive coding agents. Kiro is
becoming a stronger spec-driven development environment. LangGraph, AutoGen,
CrewAI, OpenHands, Ruflo, Gas Town, and Mission Control explore agent runtime,
dashboard, swarm, and distributed execution patterns.

Supermission should occupy the durable collaboration/control layer:

- repo-native work records
- requirements and design gates before code
- runner-neutral execution through Codex, Claude, Kiro, Kimi, shell, and future adapters
- footprint maps and evaluation evidence for every meaningful agent action
- validation and review before handoff
- fast team-readable status

The important gap is not "we need more agents." The gap is that Supermission
must make the work understandable, inspectable, verifiable, and reusable for a
team.

Multi-agent support should stay conservative and evidence-driven at first.
General orchestration is a real product category with many application
scenarios, but Supermission's first use of orchestration is software-delivery
collaboration. Factory's practice is the initial implementation boundary:
support explicit roles with strong handoffs and validation, then expand based on
feedback, evals, and real project pressure.

## Kiro Practice: What We Should Learn

Kiro's spec workflow is the closest signal for requirements quality. Its docs
describe specs as three structured artifacts: `requirements.md`, `design.md`,
and `tasks.md`. Requirements analysis can be run before design to find logical
inconsistencies, ambiguities, conflicting constraints, unstated assumptions,
and missing edge cases. Kiro also updates requirements through plain-language
questions and suggested fixes.

Kiro also runs tasks from a dependency graph in waves: independent tasks run
concurrently, while dependent waves wait for earlier waves to finish.

Supermission should adopt the practice, not copy the product shape:

- Add structured requirement IDs and acceptance criteria before design.
- Keep a requirements gate before plan approval.
- Record plain-language findings with proposed fixes.
- Make every finding traceable to requirements, tasks, validation commands, and
  later review evidence.
- Re-run requirements analysis after requirement changes.
- Treat solver-backed checks as a later stage, only after deterministic checks
  and local evals prove the supported formal model is sound enough.
- Use dependency waves only for sidecar/non-mutating work until worktree
  isolation, merge checks, rollback, and review gates are mature.

Near-term implementation path:

1. Requirements lint v1: ambiguity terms, missing acceptance, missing
   validation, missing edge cases, conflicting explicit constraints, undefined
   nouns, untestable outcomes.
2. Requirements fix flow: each issue produces a selectable
   `supermission change propose` option and a human-readable explanation.
3. Traceability map: requirement -> design note -> task -> validation command ->
   evidence artifact.
4. Eval set: include ambiguous, contradictory, incomplete, and well-formed
   requirement fixtures.
5. Formal reasoning experiment: small constraint families only, with local evals
   before roadmap promotion.

## Codex: Strengths And Difference

Codex CLI is a local coding agent that can inspect repositories, edit files, run
commands, and use project instructions. Official docs now emphasize AGENTS.md
instruction discovery, slash commands, subagents, web/search, streaming,
background mode, hooks, skills, and app/IDE/web surfaces.

Relevant capabilities:

- `AGENTS.md` layering gives project/team guidance to every run.
- `/plan` switches an interactive session into read-only planning before work.
- `/status`, `/ps`, `/stop`, `/review`, `/statusline`, and related commands
  improve active-session control and visibility.
- Subagents and skills help split exploration, review, and specialized work.
- `/goal` is documented as experimental and only available when
  `features.goals` is enabled; treat it as useful for interactive sessions but
  not yet a stable product contract.

Difference from Supermission:

- Codex is primarily a worker/client surface.
- Codex session state is not the team's canonical work record.
- Codex does not replace repo-native requirement/design/task/validation
  artifacts that survive across tools and people.

Supermission integration direction:

- Use Codex as a runner backend and optionally map a work record into a Codex
  `/goal` when the active profile supports it.
- Keep `.supermission/` as source of truth.
- Capture Codex output, token/runtime data, task status, and validation evidence
  into structured artifacts.
- Do not depend on Codex-only state for release-critical traceability.

## Claude Code: Strengths And Difference

Claude Code has strong interactive workflow controls: plan mode, project memory,
custom slash commands/skills, subagents, hooks, and rich event surfaces. Official
docs describe plan mode as read-only planning before disk edits, subagents for
specialized work, and hooks for events such as tool use, subagent start/stop,
task created/completed, worktree creation, compaction, and instruction loading.

Relevant capabilities:

- Plan mode is a good interaction pattern for safe exploration.
- `CLAUDE.md`, skills, and slash commands are strong project/team workflow
  handles.
- Subagents can keep exploration/review context out of the main conversation.
- Hooks can expose detailed lifecycle events and enforce policy.
- `/cost` and status surfaces help cost awareness.

Difference from Supermission:

- Claude Code is still a runner/client and session environment.
- Its memory and hook system are powerful, but they are not a neutral work
  record shared across Codex, shell, CI, future UI, and other runners.
- Agent-to-agent delegation is useful, but it must be measured against
  code-scheduled tasks with durable records.

Supermission integration direction:

- Provide Claude skills/commands that create, inspect, and update Supermission
  work records.
- Use hooks to mirror Claude task/subagent/tool lifecycle into footprints when
  available.
- Use Claude subagents first for sidecar tasks: research, plan review,
  validation analysis, documentation, and security review.
- Keep code mutation linear until isolation and merge gates are proven.

## Agent Orchestration Reference Systems

### Factory Missions

Still the main product baseline: collaborative planning first, milestone or
feature execution second, validation evidence after meaningful milestones.
Supermission should be the open-source local-first version of that pattern.

For multi-agent behavior, Factory is also the initial boundary. Coder and QA are
separate roles because they produce different evidence and incentives. Planner,
reviewer, documenter, and release/checklist roles are similarly useful when
their outputs are structured and auditable. This does not rule out broader
orchestration later; it means broader patterns must earn their place through
specific software-delivery use cases and eval evidence.

Factory's official Missions page gives several implementation constraints that
fit Supermission's direction: scoping is conversational and plan approval comes
before execution; an orchestrator decomposes large work into milestones and
features; every milestone ends with validation; feature workers get fresh
context; validation workers are distinct; browser/computer-use validation
augments test/lint/build rather than replacing it; and serial execution with
targeted parallelization has worked better than broad parallelism where
coordination overhead is high.

### LangGraph

LangGraph is a low-level orchestration runtime for long-running, stateful
agents. Its useful ideas are durable execution, streaming, human-in-the-loop,
memory, traces, and explicit state transitions.

Supermission should borrow the explicit state machine and resumability mindset,
but avoid coupling the product to a Python graph runtime. The local work record
is the product-level state.

### CrewAI

CrewAI separates Flows and Crews: Flows define state/control flow; Crews are
teams of role-based agents. The useful idea is the split between deterministic
process control and autonomous specialist work.

Supermission should copy that split conceptually: the engine controls state and
gates; runners/agents do bounded work.

### AutoGen

AutoGen's distributed runtime is useful for agent lifecycle and message delivery
across processes, but its distributed runtime is still experimental. This is a
reference for later process/machine coordination, not an MVP dependency.

### OpenHands

OpenHands is a full software-agent platform/SDK with tools, workspaces,
sandboxed execution, UI/CLI/cloud surfaces, and clear package boundaries. It is
valuable as an execution/sandbox architecture reference.

Supermission differs by focusing first on the team work record and validation
evidence rather than becoming a full autonomous developer platform.

### Builderz Mission Control

Mission Control is a dashboard-first self-hosted orchestration platform with
SQLite, task boards, agent fleets, cost tracking, quality gates, skills, and
multi-gateway integrations.

Useful ideas: dashboard, real-time status, cost visibility, quality gates,
agent/task operations, and self-hosted installation.

Risk for Supermission: a large dashboard/database app before the engine contract
is stable. `.supermission/` remains the source of truth; a DB can only be an
index/cache later.

### Ruflo

Ruflo is a Claude/Codex-oriented orchestration reference with plugins, swarms,
RAG/memory, and many advertised agents. The useful idea is pluginized
capabilities. The risk is adding many claimed capabilities without reproducible
local evals.

### Gas Town

Gas Town's useful concepts are coordinator/worker separation, persistent
workspaces, Git-backed work state, task ledgers, grouped work, readiness, and
supervision. The risk is copying high-concurrency code mutation before merge
safety exists.

Supermission should keep record-backed coordination now and add role
collaboration only where evals show it improves throughput or quality without
harming correctness.

## Current Supermission Gaps

1. Requirements analysis is too shallow.
   The current deterministic stage is a good start, but it does not yet provide
   Kiro-style cross-requirement reasoning, selectable fixes, design/task
   traceability, or a strong eval set.

2. Team UX is still mostly CLI.
   A team-friendly tool needs fast status, a readable work board, clear next
   actions, blocked reasons, validation state, and handoff summaries. The CLI
   must stay fast, but a TUI or lightweight UI is needed after MVP.

3. Footprint and evaluation are incomplete.
   Events, telemetry, tool calls, and logs exist, but we still need generated
   footprint maps, scoring rubrics, datasets, and regression reports that prove
   agent output quality.

4. Runner integration needs stronger lifecycle controls.
   Codex/Claude backends need better streaming progress, cancel/recover paths,
   profile health checks, retry/fallback visibility, real smoke matrices, and
   secret-safe debugging.

5. Multi-agent collaboration needs a staged boundary.
   Clear roles such as planner, coder, QA, reviewer, documenter, and
   release/checklist operator are useful now. Arbitrary agent graphs, swarms,
   and chat-heavy collaboration should remain reference/experiment scope until
   they have a measured software-delivery use case.

6. Parallel execution is not ready for code mutation.
   Supermission has task dependency and mutation-mode concepts, but worktree
   isolation, merge queues, conflict checks, rollback drills, and review gates
   need to be stronger before multiple agents edit code concurrently.

7. Cost and performance evidence is early.
   Token/runtime recording exists, but we need work-level cost summaries,
   latency budgets, large-record benchmarks, runner throughput samples, and UI
   responsiveness tests.

8. Plugin boundaries are not yet a stable public contract.
   Runners, validators, artifact writers, policies, workflow templates, and UI
   adapters should become plugin-shaped, but MVP should expose only the contract
   we can test.

9. Release polish is still pending.
   Package contents, install smoke, docs, license, and local release pipeline are
   close, but public release should wait for the rename cleanup, full gates, and
   at least one clean installed-package smoke.

## Recommended Product Decisions

MVP should converge on the team collaboration workflow:

- create work
- analyze requirements
- plan
- approve
- run through shell/Codex/Claude runner
- validate
- generate review and handoff
- show status/summary/trace quickly
- package/install cleanly

After MVP, improve in this order:

1. Kiro-inspired requirements analysis and traceability.
2. Footprint maps, evaluation sets, and cost/performance reports.
3. Runner lifecycle UX: streaming, cancel, resume, retries, fallback profiles.
4. TUI or lightweight local UI for team status.
5. Conservative role collaboration: planner, coder, QA, reviewer, documenter,
   release/checklist.
6. Plugin API and optional integrations with Codex/Claude hooks/skills.
7. Worktree isolation and sidecar parallelism.
8. Solver-backed requirement checks and deeper multi-agent experiments.

The product should keep using other systems as reference material, but every
borrowed idea needs a Supermission capability hypothesis and a local eval before
it becomes roadmap scope.

## Sources Checked

- Kiro specs and Analyze Requirements:
  <https://kiro.dev/docs/specs/>,
  <https://kiro.dev/docs/specs/analyze-requirements/>
- Codex CLI, slash commands, and AGENTS.md:
  <https://developers.openai.com/codex/cli>,
  <https://developers.openai.com/codex/cli/slash-commands>,
  <https://developers.openai.com/codex/guides/agents-md>,
  <https://github.com/openai/codex/issues/20536>
- Claude Code plan mode, subagents, hooks, slash commands:
  <https://code.claude.com/docs/en/common-workflows>,
  <https://code.claude.com/docs/en/sub-agents>,
  <https://code.claude.com/docs/en/hooks>,
  <https://code.claude.com/docs/en/slash-commands>
- LangGraph:
  <https://docs.langchain.com/oss/python/langgraph/overview>
- CrewAI:
  <https://docs.crewai.com/en/introduction>
- AutoGen:
  <https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/distributed-agent-runtime.html>
- OpenHands:
  <https://docs.openhands.dev/sdk/arch/overview>
- Builderz Mission Control:
  <https://github.com/builderz-labs/mission-control>
- Ruflo:
  <https://github.com/ruvnet/ruflo>
