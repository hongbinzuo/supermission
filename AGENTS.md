# Agent Operating Notes

These notes are for future AI agents working in this repository.

## Product Direction

Supermission is the open-source, local-first work record system for AI-assisted
software delivery.
The primary baseline is Factory Missions: collaborative planning first,
milestone/feature execution second, and validation evidence after each
meaningful milestone.
The user-facing product goal is a team software creation collaboration tool
that normal team members can use easily, not a specialist-only agent framework.

Do not turn the product into a feature pile copied from other orchestration
projects. Ruflo, Gas Town, Mission Control, LangGraph, and similar systems are
reference material for abstractions and tradeoffs only.

Factory practice is the initial implementation boundary for multi-agent
behavior: support clear, useful software-delivery roles such as planner, coder,
QA, reviewer, documenter, and release/checklist operator. General orchestration
has many valid application scenarios, and Supermission should keep learning from
orchestration products and frameworks. For this product, add orchestration
carefully: start from limited, verifiable role collaboration, measure results,
then expand based on feedback and eval evidence. If collaboration is needed,
prefer role-separated tasks, durable artifacts, and validation evidence. Add
direct communication only when artifacts are insufficient, and use the
lowest-cost verifiable channel.

Final product shape: standalone local engine first, fast CLI/TUI surfaces over
that engine, and optional Codex/Claude/IDE adapters or plugins. Supermission
should cooperate with existing coding agents, not force users to abandon them.
UX responsiveness is a core requirement: long waits need streaming progress,
cancel/recover paths, and durable evidence.

## Architecture Rules

- Keep the work engine runner-neutral.
- Put model runtimes behind runner/adapters.
- Keep project runner defaults in `.supermission/runners.yaml`; CLI flags should
  override project config.
- Prefer plugin/component boundaries for runners, validators, artifact writers,
  policies, workflow templates, and future UI adapters.
- Requirements analysis is a mainline product capability. Start with
  deterministic requirement checks; use LLM rewriting and SMT/logic solvers only
  where evaluation proves the representation is sound enough.
- Web project validation should default to Playwright and deterministic
  assertions. Browser/computer-use agents are optional exploratory validators,
  not the first blocking gate.
- `.supermission/` remains the source of truth. A database may be added later as an
  index/cache, not as the primary work record.
- Every agent-facing feature should preserve enough structured evidence to build
  a footprint map and evaluate the agent's result later.
- Runner and agent changes should record token/runtime evidence when available
  and avoid designs that make cost attribution impossible.
- Prefer code scheduling plus durable work records over free-form
  agent-to-agent chat until eval results prove otherwise.
- Code mutations stay linear until worktree isolation, merge checks, rollback,
  and review gates are mature.
- Sidecar work may become parallel when it does not mutate shared code.

## Documentation Rules

Update documentation in the same change as implementation when behavior,
commands, workflows, roadmap, installation, or release status changes.

At minimum, keep these files aligned:

- `README.md`
- `README.zh-CN.md`
- `docs/research/agent-orchestration-reference.md`
- `docs/research/kiro-codex-claude-orchestration-gap-analysis.md`
- `AGENTS.md`

When release packaging changes, update the Installation & Release Status
sections immediately. When milestones change, update the Product Roadmap in both
READMEs.

## Integration Rules

- Real integration tests are required for external runner backends when the
  required credentials/profile are explicitly configured.
- Use `supermission runner smoke` for fast backend/profile checks before a full
  supermission run when changing runner integration.
- Normal tests should not hit external model services by default. Use
  `SUPERMISSION_RUNNER_SMOKE=codex|claude|all` plus explicit profile/model env
  when a real backend should block the run.
- Codex `--profile <name>` may resolve through CC Switch codex providers. Never
  print `settings_config`, auth JSON, or API-key previews while debugging.
- Never print or commit API keys, provider secrets, or CC Switch profile secrets.
- Browser work should use Chrome when a browser is needed.
- If a backend credential is missing or invalid, fail clearly and keep the
  runner test opt-in rather than silently pretending the backend is verified.

## Release And Data Decisions

- License is Apache-2.0.
- Public release path should be scoped npm package `@hongbinzuo/supermission`
  first, GitHub Releases second, Homebrew/Docker later. Keep the binary command
  as `supermission`.
- Do not remove `"private": true` until release gates, package contents, README
  install docs, and secret checks are ready.
- Database/search/vector stores may be added only as rebuildable indexes or
  caches derived from `.supermission/`.

## Quality Rules

Supermission capability work should be evaluated while it is being built, not
only after a large feature is finished. Use
`docs/evaluations/supermission-capability-evaluation.md` and `evals/` fixtures as
the product's own regression baseline. Public references from GitHub, papers,
product docs, and benchmarks should become capability hypotheses with local
evals or opt-in real runner smoke evidence before they become roadmap items.

Before a stable slice is committed, run the relevant gates:

```bash
bun run check
bun run lint
bun run format:check
bun run test:capability
bun run test
bun run build
```

If a full gate cannot be run, record what was skipped and why.

Follow the user's cadence preference when feasible:

- Commit and push stable slices periodically.
- Every longer work session should include self-review and issue repair.
- Do not revert user changes unless explicitly asked.
