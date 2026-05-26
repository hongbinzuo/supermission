# Release And Data Decisions

Date: 2026-05-17

These decisions resolve the current release, license, integration, and storage
open questions.

## License

Recommendation: Apache-2.0.

Rationale:

- permissive for open-source and enterprise adoption
- explicit patent grant
- compatible with most tooling and plugin ecosystems
- common for infrastructure and developer tooling

The repository now includes `LICENSE`. Package metadata should use
`"license": "Apache-2.0"` before public publishing.

Package name decision: use `@hongbinzuo/supermission` for npm because the
unscoped `supermission` package name is already occupied by another project.
Keep the binary command as `supermission`.

## Public Release Path

Recommended order:

1. Keep local development as the only install path until CLI contracts are
   stable enough for early adopters.
2. Publish an npm package first because the project is already Bun/Node based
   and exposes a `supermission` binary.
3. Add GitHub Releases with checksums and changelog after npm packaging works.
4. Add Homebrew and Docker only after the CLI, file layout, and runner
   configuration are stable.

Do not remove `"private": true` until:

- `LICENSE` is present
- package name, binary name, and version policy are confirmed
- README installation instructions include npm usage and local development
- release gates pass locally and in CI
- no secrets or ignored runtime files are included in package output
- `npm pack --dry-run` shows only intended files

## Real Runner Smoke Tests

Recommendation: keep real external runner tests explicit and blocking only when
requested.

Rules:

- Default unit tests must not call external model services.
- Use `supermission runner smoke` for direct backend checks.
- Use `SUPERMISSION_RUNNER_SMOKE=codex|claude|all` for opt-in integration tests.
- Require explicit profile/model env or CLI flags for real backends.
- Fail clearly when credentials or profiles are missing.
- Never print or commit API keys, auth JSON, CC Switch `settings_config`, or
  provider secret previews.

## Database And Indexing

Recommendation: `.supermission/` remains the source of truth.

Future SQLite/vector/search indexes may be added only as derived caches:

- rebuildable from `.supermission/`
- disposable without data loss
- never the only copy of work state
- never required to review or recover a mission
- schema migrations must include rollback and rebuild plans

This keeps Supermission local-first, Git-reviewable, and easy to recover.
