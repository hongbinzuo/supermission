# Implementation Plan: Team Collaboration

## Overview

This plan implements team collaboration for Supermission in 5 phases, progressing from identity/assignment (Phase 1) through notifications, access control, webhooks, and finally the optional Coordination Index server for multi-repo organizations.

## Tasks

- [ ] 1. Define collaboration type schemas — Create `src/collaboration-types.ts` with Zod schemas for Identity, TeamRegistry, Lock, SyncManifest, Notification, and WorkspaceConfig. Add `assignee`, `team`, and `depends_on` optional fields to WorkSpecSchema. Add lock/team/workspace/sync/inbox paths.
  - Requirements: 1, 2, 9, 13
  - Design: Data Models, Components and Interfaces

- [ ] 2. Implement Identity Resolver — Create `src/identity.ts` with resolution order: `--as` flag → SUPERMISSION_IDENTITY env → git config user.name match against team.yaml → "local-user" fallback. Return solo-mode identity when no team.yaml exists.
  - Requirements: 1, 13
  - Design: Components and Interfaces (Identity Resolver)

- [ ] 3. Implement Team Registry CLI commands — Add `supermission team init/add/remove/list` commands. Validate unique names, valid roles, require backend/profile for agent kind. Write to `.supermission/team.yaml`.
  - Requirements: 1
  - Design: Data Models (team.yaml)

- [ ] 4. Implement Work Assignment — Add `--assign` option to `supermission new`, add `supermission assign/release` commands. Validate assignee against team.yaml. Emit assignment events. Add `--mine` filter to `supermission list`.
  - Requirements: 2
  - Design: Components and Interfaces (Collaboration Guard), Data Models (work.yaml extended)

- [ ] 5. Backward compatibility verification — Run full existing test suite without team.yaml. Verify identity resolver returns "local-user". Verify no collaboration checks in solo mode. Add explicit backward-compat test.
  - Requirements: 13
  - Design: Correctness Properties (Property 2)

- [ ] 6. Implement Notification Writer — Create `src/notification.ts`. Append JSONL records to `.supermission/inbox/<identity>.jsonl`. Create inbox directory on first write. Generate unique notification IDs.
  - Requirements: 7
  - Design: Components and Interfaces (Notification Writer), Data Models (inbox)

- [ ] 7. Implement Inbox command — Add `supermission inbox` command with `--clear` and `--json` flags. Read current identity's inbox file, sort by time. Show notification count in status output.
  - Requirements: 7
  - Design: Components and Interfaces (Notification Writer)

- [ ] 8. Wire notifications to state transitions — On assignment notify assignee. On needs_review notify reviewers/leads. On blocking signal notify assignee + leads. On agent task completion notify reviewer.
  - Requirements: 7, 10
  - Design: Components and Interfaces (Notification Writer)

- [ ] 9. Implement Lock Manager — Create `src/lock.ts`. Implement acquire/release/forceRelease/check. Wire lock into beginRun() and status transitions. Implement stale lock detection (default 60min timeout).
  - Requirements: 6
  - Design: Components and Interfaces (Lock Manager), Data Models (lock.yaml)

- [ ] 10. Implement Conflict Detector enhancements — Create `src/conflict.ts`. Detect scope overlap between running tasks. Detect stale state via sync.yaml. Emit supervisor signals. Run checks during status/monitor.
  - Requirements: 5
  - Design: Components and Interfaces (Conflict Detector)

- [ ] 11. Implement Sync Manifest — Create/update sync.yaml with identity + git ref on each write operation. Read HEAD via git rev-parse. Update entry for current identity after state transitions.
  - Requirements: 4
  - Design: Data Models (sync.yaml)

- [ ] 12. Implement Collaboration Guard — Create `src/collaboration-guard.ts`. Enforce role-based permission matrix (owner/lead: all, developer: assigned only, agent: assigned + auto-route, reviewer: approve only, observer: read-only). Skip in solo mode.
  - Requirements: 3
  - Design: Components and Interfaces (Collaboration Guard)

- [ ] 13. Implement team-scoped visibility — Add `--team` and `--all` filters to list. Add `supermission board` command with tabular status view. Default list to current identity's team when team.yaml present.
  - Requirements: 3
  - Design: Components and Interfaces (Collaboration Guard)

- [ ] 14. Implement webhook delivery — Read webhook config from team.yaml. Fire-and-forget HTTP POST for configured events. Queue failures in webhook-queue.jsonl. Add `supermission webhook retry` command.
  - Requirements: 7
  - Design: Data Models (team.yaml webhook config)

- [ ] 15. Implement workspace configuration — Add `supermission workspace init/add-team/add-repo` commands. Create workspace.yaml. Validate schema on read.
  - Requirements: 9
  - Design: Data Models (workspace.yaml)

- [ ] 16. Implement cross-work dependencies — Add `--depends-on` to `supermission new`. Support `<repo>:<work-id>` syntax. Emit blocked_by_dependency signals. Add `supermission deps` command.
  - Requirements: 11
  - Design: Data Models (work.yaml depends_on)

- [ ] 17. Implement Coordination Index server — Create `src/index-server.ts` with HTTP server, git repo polling, SQLite storage, read-only API endpoints (works, deps, board, health). Add `supermission index start/status` commands.
  - Requirements: 8
  - Design: Architecture (Coordination Index), Components and Interfaces (Coordination Index Server)

- [ ] 18. Implement board with index integration — Add `supermission board --workspace` that queries Coordination Index API. Fall back to local-only when no index configured. Add team/status filters.
  - Requirements: 8, 11
  - Design: Components and Interfaces (Coordination Index Server)

- [ ] 19. Implement audit command — Add `supermission audit <work-id>` with `--identity`, `--action`, and `--since` filters. Format as timeline. Filter events.jsonl for collaboration actions.
  - Requirements: 12
  - Design: Components and Interfaces

- [ ] 20. Agent-to-human handoff enhancements — On agent task completion, auto-transition to needs_review and assign to team reviewer/lead. Include footprint summary in notification. Block further agent mutations until human approves.
  - Requirements: 10
  - Design: Components and Interfaces (Collaboration Guard)

## Task Dependency Graph

```json
{
  "waves": [
    {"wave": 1, "tasks": [1]},
    {"wave": 2, "tasks": [2, 6, 9]},
    {"wave": 3, "tasks": [3, 4, 5, 7, 10, 11]},
    {"wave": 4, "tasks": [8, 12, 15, 19]},
    {"wave": 5, "tasks": [13, 14, 16, 20]},
    {"wave": 6, "tasks": [17]},
    {"wave": 7, "tasks": [18]}
  ]
}
```

## Notes

- Phase 1 (Tasks 1-5) is the foundation — all other phases depend on it.
- Phase 2 (Tasks 6-11) and Phase 3 (Tasks 12-13) can be developed in parallel after Phase 1.
- Phase 4 (Task 14) requires Phase 2 notifications to be complete.
- Phase 5 (Tasks 15-18) is the most complex and should only start after Phases 1-3 are stable.
- Task 20 (agent handoff) can be done any time after Tasks 4, 6, and 12.
- All phases must maintain backward compatibility — existing tests must pass at every step.
