# Branch Protection Setup

Go to: https://github.com/hongbinzuo/supermission/settings/branches

## Main Branch Protection Rules

1. Click "Add branch protection rule"
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require a pull request before merging
     - Required approvals: 0 (or 1 if you have collaborators)
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require status checks to pass before merging
     - ✅ Require branches to be up to date before merging
     - Status checks: `quality` (from CI workflow)
   - ✅ Do not allow bypassing the above settings
4. Click "Create"

## After Setup

- Direct pushes to `main` are blocked
- All changes must go through a PR
- CI must pass before merge
- Workflow: `git checkout -b feat/my-feature` → commit → push → PR → merge

## Quick Reference

```bash
# Create feature branch
git checkout -b feat/my-feature

# Work, commit, push
git add .
git commit -m "feat: description"
git push -u origin feat/my-feature

# Create PR
gh pr create --title "feat: description" --body "What changed"

# After CI passes, merge
gh pr merge --squash
```
