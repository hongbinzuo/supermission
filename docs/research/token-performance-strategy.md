# Token And Runtime Performance Strategy

Date: 2026-05-17

This document tracks how Supermission should measure and reduce agent cost and
runtime latency. It complements the agent footprint and evaluation-set work.

## Goals

- Attribute token and runtime cost to mission, actor, backend, task, and artifact.
- Detect expensive or slow agent behavior early.
- Build eval sets that include quality, token cost, latency, retries, and
  validation success.
- Include requirements-analysis quality because unclear requirements waste
  runner tokens and create expensive rework.
- Keep optimization evidence in `.missions/` instead of relying on chat history.

## Initial Implementation

Current runner records should capture:

- `duration_ms`
- `tokens_used` when the backend exposes it in CLI output
- `stdout_chars`, `stderr_chars`, and `response_chars`
- retry attempt summaries
- backend/profile identity without secrets
- footprint/evaluation fields that link tool calls to `run.log`

The first implementation extracts Codex-style `tokens used` totals from runner
output and records them in `tool-calls.jsonl`, `telemetry.jsonl`, and
`events.jsonl`.

## Metrics To Add Next

- Prompt character count and response character count.
- Token estimate fallback when exact token usage is missing.
- Per-attempt retry timing and token usage.
- Validation runtime and failure frequency by command.
- Mission-level totals: total tokens, total runner time, total validation time,
  retries, failed attempts, and cost estimate.
- Cost policy thresholds: warn/block when a mission exceeds configured budget.

## Optimization Tactics

- Prefer scoped task prompts over full-repo prompts.
- Use mission artifacts as compact context instead of replaying chat.
- Cache stable repo summaries and validation results.
- Keep runner prompts deterministic and short for smoke/eval cases.
- Use cheaper/faster backends for planning, docs, and smoke checks when quality
  requirements allow it.
- Use stronger models only at high-risk gates: architecture, security, review,
  and merge decisions.
- Fail fast on missing profile, invalid config, scope drift, and validation
  policy violations.

## Evaluation Set Design

Each eval case should include:

- mission goal
- initial repo fixture or patch
- allowed scope
- acceptance criteria
- expected artifacts
- validation commands
- review rubric
- expected footprint properties
- expected max runtime/token budget when applicable

Scores should include:

- task completion
- validation pass/fail
- scope discipline
- evidence completeness
- review quality
- handoff quality
- token/runtime efficiency

## References To Track

- LangGraph: durable execution, long-running agent workflows, checkpoints.
- OpenTelemetry: trace/span concepts for attributing work across tools.
- SWE-bench: software engineering task evaluation dataset pattern.
- AgentBench: multi-domain agent evaluation framing.
- RAGAS: evaluation patterns for retrieval-augmented systems.
- Phoenix / Arize, LangSmith, Helicone, LiteLLM: observability and LLM usage
  tracking patterns.

These references should guide abstractions, not force dependencies.
