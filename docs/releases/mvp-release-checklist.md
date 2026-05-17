# MVP Release Checklist

Date: 2026-05-17

Target package: `@hongbinzuo/supermission`

Binary command: `mission`

## Release Type

First public release should be an MVP developer preview:

- local-first CLI
- `.missions/` source of truth
- deterministic requirement checks
- record/shell/Codex/Claude runner adapters
- opt-in real runner smoke tests
- local capability eval baseline
- Apache-2.0 license

## Required Local Gates

Run these before tagging:

```bash
bun install
bun run check
bun run format:check
bun run lint
BUN_BIN="$HOME/.bun/bin/bun" bun run test:capability
BUN_BIN="$HOME/.bun/bin/bun" bun run test
bun run build
npm pack --dry-run
```

Package install smoke:

```bash
rm -f hongbinzuo-supermission-0.1.0.tgz
npm pack
tmp=$(mktemp -d)
repo=$(mktemp -d)
npm install --prefix "$tmp/pkg" -g "$(pwd)/hongbinzuo-supermission-0.1.0.tgz"
"$tmp/pkg/bin/mission" --help
git init "$repo"
"$tmp/pkg/bin/mission" --repo "$repo" new "Installed package smoke" \
  --id install-smoke \
  --acceptance "The installed CLI works" \
  --validation "node --version"
"$tmp/pkg/bin/mission" --repo "$repo" plan install-smoke
"$tmp/pkg/bin/mission" --repo "$repo" requirements check install-smoke
"$tmp/pkg/bin/mission" --repo "$repo" approve install-smoke
"$tmp/pkg/bin/mission" --repo "$repo" run install-smoke \
  --backend shell \
  --command "printf installed-ok"
"$tmp/pkg/bin/mission" --repo "$repo" validate install-smoke
"$tmp/pkg/bin/mission" --repo "$repo" status install-smoke
rm -rf "$tmp" "$repo" hongbinzuo-supermission-0.1.0.tgz
```

Optional real runner smoke:

```bash
bin/mission runner smoke \
  --backend codex \
  --profile current \
  --prompt "Reply only with runner-smoke-ok." \
  --timeout-ms 60000
```

## Package Checks

- Package name is scoped because `supermission` is already occupied on npm.
- Package should include `dist/`, `bin/mission`, README files, LICENSE, selected
  docs, and eval baseline.
- Package should not include source tests, ignored reports, `.missions/`, local
  profiles, auth files, or secrets.
- `private` must be removed only immediately before actual npm publication.

## Publish Steps

After all gates pass and npm authentication is ready:

```bash
npm login
npm publish --access public
git tag v0.1.0
git push origin v0.1.0
```

If package publication is delayed, share the repository install path first:

```bash
git clone git@github.com:hongbinzuo/supermission.git
cd supermission
bun install
bun run build
bin/mission --help
```
