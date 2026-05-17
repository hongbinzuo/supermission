# Supermission Capability Evaluation

Date: 2026-05-17

This document defines how Supermission evaluates its own product capability.
It is not a user-facing experiment feature. It is the engineering loop for
deciding whether Supermission is becoming a better coding and project
management tool.

## Product Capability Target

Supermission should optimize for a refined, usable, stable coding and project
management workflow:

- collaborative planning before large implementation
- requirements analysis before implementation
- runner-neutral execution through local, Codex, and Claude adapters
- evidence after every meaningful milestone
- validation and review before handoff
- clear project status and next actions
- bounded token/runtime cost and responsive local commands
- configuration and extension boundaries that avoid a monolithic app

External projects and papers are reference inputs. They do not define the
feature list. Factory Missions remains the primary product baseline; Mission
Control, Ruflo, Gas Town, LangGraph, SWE-bench, OpenTelemetry, Phoenix, and
similar systems inform abstractions and tradeoffs.

## Evaluation Loop

Every meaningful product change should follow this loop:

1. Identify the capability being improved.
2. Add or update a local eval case before broad implementation when practical.
3. Run the narrow eval while developing.
4. Run the relevant quality gate before commit.
5. Run opt-in real runner smoke when runner behavior changed.
6. Record the result in documentation or a report when it changes direction.
7. Decide whether to keep, revise, or roll back the approach.

This loop is for Supermission itself. It should make the product more reliable
without adding unrelated user-visible surface area.

## Current Capability Baseline

The first baseline is intentionally local and deterministic. It verifies that a
small work record can move through the core project-management workflow with
evidence:

- create work
- analyze requirements
- plan
- approve
- execute with shell runner
- record token/runtime evidence
- validate
- create review
- create handoff
- inspect status, summary, trace, and artifacts

The fixture lives at:

- `evals/supermission-capability-baseline.yaml`

The executable regression test lives at:

- `tests/capability.test.ts`

Run it directly:

```bash
bun run test:capability
```

It should stay fast, deterministic, and free of external model calls.

## Score Dimensions

Each capability eval should score or assert at least these dimensions when
relevant:

- Workflow completion: the work reaches the expected state.
- Evidence completeness: required artifacts and JSONL records exist.
- Validation strength: validation commands execute and failures are visible.
- Review readiness: diff/review/handoff artifacts are present.
- Runner portability: the same work path can use different backends.
- Footprint quality: actor, backend, artifact, retry, token, and runtime fields
  are reconstructable.
- Cost/performance: local commands stay below a documented latency budget;
  model runners record token usage when exposed.
- Configuration safety: project defaults and CLI overrides work without
  leaking secrets.

## Public Reference Intake

Use public references as inputs to evaluation design:

- Factory Droid CLI Missions: product baseline for mission-style planning,
  execution, and automation.
- Kiro deep spec / requirements analysis: spec-driven development pattern that
  combines LLM rewriting with automated reasoning before code generation.
- SWE-bench and SWE-bench Verified: execution-based coding-agent evaluation
  pattern based on real repository issues.
- OpenTelemetry GenAI semantic conventions: trace/span/metric vocabulary for
  model, agent, tool, token, and error attribution.
- Arize Phoenix: open-source tracing, datasets, and eval workflow patterns for
  LLM applications.
- LangGraph: durable execution, checkpoints, and stateful long-running agent
  workflow ideas.
- local-first work record system, Ruflo, Gas Town: orchestration vocabulary and tradeoffs,
  especially coordinator/worker separation, durable state, and validation
  gates.

Reference intake rule: translate the reference into a Supermission capability
hypothesis, then prove it with a local eval or real integration smoke before
making it part of the roadmap.

## Requirements Analysis Track

Kiro's requirements-analysis direction is highly relevant to Supermission's
mainline. The lesson is not "more agents"; it is "make requirements precise
before code exists."

Supermission's staged path:

1. Deterministic requirements lint: missing acceptance criteria, missing
   validation commands, ambiguity, implementation-detail leakage, observable
   outcome checks, and simple explicit conflicts.
2. LLM rewrite pass: convert vague acceptance criteria into precise, testable
   candidate criteria with human choices.
3. Constraint representation: map supported requirement families into a small
   formal model.
4. Solver-backed checks: use SMT/model-checking where the formal model is
   sound enough to prove contradiction or missing cases.
5. Evidence integration: write findings to `.supermission/<id>/requirements-analysis.md`,
   events, telemetry, and supervisor signals.

The current implementation covers stage 1.

## Near-Term Eval Work

- Add `footprint.md` generation from existing events, tool calls, telemetry,
  patch, validation, review, and handoff artifacts.
- Use Playwright as the default web-project validation path because it is
  deterministic, assertion-friendly, screenshot/trace-capable, and CI-friendly.
  Browser/computer-use agents can be optional exploratory validators later, but
  should not replace deterministic validation evidence.
- Add reusable work fixtures that cover failed validation, scope drift,
  runner retries, and profile fallback.
- Add cost/performance reports that aggregate work-level tokens, duration,
  retries, validation time, and response size.
- Add real runner eval profiles that remain opt-in and fail clearly when
  credentials are missing.
- Add UI/TUI responsiveness budgets before building larger interactive surfaces.
