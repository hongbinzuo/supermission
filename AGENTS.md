# Agent Operating Notes

These notes are for future AI agents working in this repository.

## Product Direction

Supermission is the open-source, local-first Mission Control for AI Coding.
The primary baseline is Factory Missions: collaborative planning first,
milestone/feature execution second, and validation evidence after each
meaningful milestone.

Do not turn the product into a feature pile copied from other orchestration
projects. Ruflo, Gas Town, Mission Control, LangGraph, and similar systems are
reference material for abstractions and tradeoffs only.

## Architecture Rules

- Keep the mission engine runner-neutral.
- Put model runtimes behind runner/adapters.
- Keep project runner defaults in `.missions/runners.yaml`; CLI flags should
  override project config.
- Prefer plugin/component boundaries for runners, validators, artifact writers,
  policies, workflow templates, and future UI adapters.
- `.missions/` remains the source of truth. A database may be added later as an
  index/cache, not as the primary mission record.
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
- `AGENTS.md`

When release packaging changes, update the Installation & Release Status
sections immediately. When milestones change, update the Product Roadmap in both
READMEs.

## Integration Rules

- Real integration tests are required for external runner backends when the
  required credentials/profile are explicitly configured.
- Use `mission runner smoke` for fast backend/profile checks before a full
  mission run when changing runner integration.
- Normal tests should not hit external model services by default. Use
  `SUPERMISSION_RUNNER_SMOKE=codex|claude|all` plus explicit profile/model env
  when a real backend should block the run.
- Codex `--profile <name>` may resolve through CC Switch codex providers. Never
  print `settings_config`, auth JSON, or API-key previews while debugging.
- Never print or commit API keys, provider secrets, or CC Switch profile secrets.
- Browser work should use Chrome when a browser is needed.
- If a backend credential is missing or invalid, fail clearly and keep the
  runner test opt-in rather than silently pretending the backend is verified.

## Quality Rules

Before a stable slice is committed, run the relevant gates:

```bash
bun run check
bun run lint
bun run format:check
bun run test
bun run build
```

If a full gate cannot be run, record what was skipped and why.

Follow the user's cadence preference when feasible:

- Commit and push stable slices periodically.
- Every longer work session should include self-review and issue repair.
- Do not revert user changes unless explicitly asked.
