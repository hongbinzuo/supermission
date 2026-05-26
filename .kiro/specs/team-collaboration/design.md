# Design Document: Team Collaboration

## Overview

This design describes how Supermission scales from a single-user CLI tool to a
team collaboration system without abandoning its local-first, git-backed
philosophy. The key insight: **git is the database for small teams, and an
optional Coordination Index server is the read-only cache for organizations**.

No team member ever _needs_ a server to collaborate. The server exists only to
provide cross-repo aggregation and faster queries at organizational scale.

---

## Architecture

### Layered Collaboration Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: Organization (Optional)                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Coordination Index Server                                     │  │
│  │  - Embedded SQLite/DuckDB (rebuildable cache)                 │  │
│  │  - Read-only HTTP API for cross-repo queries                  │  │
│  │  - Git poller or webhook receiver                             │  │
│  │  - Zero writes to any repository                              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│         ▲ polls/webhooks                                            │
├─────────┼───────────────────────────────────────────────────────────┤
│  Layer 1: Small Team (Git-Native)                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Shared Git Repository                                         │  │
│  │  .supermission/                                                │  │
│  │  ├── team.yaml          (identity registry)                   │  │
│  │  ├── workspace.yaml     (team/workspace config)               │  │
│  │  ├── sync.yaml          (last-known refs per identity)        │  │
│  │  ├── inbox/             (per-identity notification queues)    │  │
│  │  ├── policy.yaml                                              │  │
│  │  ├── runners.yaml                                             │  │
│  │  └── <work-id>/         (work records with assignee + lock)   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│         ▲ git push/pull                                             │
├─────────┼───────────────────────────────────────────────────────────┤
│  Layer 0: Solo (Current, Unchanged)                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Local .supermission/ with no team.yaml                        │  │
│  │  All existing commands work identically                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Status Propagation Without a Central Database

**The core question: how do team members know each other's status without a DB?**

Answer: **Git IS the distributed database.** Each push is a "write", each pull
is a "read". The `.supermission/` directory is the schema.

```
     Alice                    Git Remote                    Bob
  ┌──────────┐            ┌──────────────┐            ┌──────────┐
  │ writes   │──push────> │  shared      │ <──pull────│ reads    │
  │ work.yaml│            │  .supermission│            │ work.yaml│
  │ inbox/bob│            │  files       │            │ inbox/bob│
  └──────────┘            └──────────────┘            └──────────┘
```

For real-time awareness (without polling git), webhooks fire to Slack/Discord
on key events. The webhook is a notification shortcut — the source of truth
remains in the files.

### Coordination Index Architecture

For organizations needing cross-repo visibility:

```
┌────────────────────────────────────────────────────────────────┐
│                    Coordination Index Server                     │
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  HTTP API   │    │  Embedded    │    │  Git Poller /    │  │
│  │  (read-only │    │  SQLite      │    │  Webhook         │  │
│  │   queries)  │    │  (index)     │    │  Receiver        │  │
│  └──────┬──────┘    └──────┬───────┘    └────────┬─────────┘  │
│         │                  │                      │            │
│         └──────────────────┴──────────────────────┘            │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │ git clone/pull (periodic, default 60s)
                              │ or webhook on push
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
    │ Repo A  │         │ Repo B  │         │ Repo C  │
    │ (team1) │         │ (team2) │         │ (team3) │
    └─────────┘         └─────────┘         └─────────┘
```

**What the Coordination Index does:**

1. Periodically clones/pulls all registered repos (or receives webhooks on push)
2. Reads `.supermission/` directories from each repo
3. Builds a queryable index in embedded SQLite
4. Exposes a read-only HTTP API for aggregated queries

**What it does NOT do:**

- Does not write to any repository
- Does not own any state — can be rebuilt from scratch at any time
- Does not replace local `.supermission/` files as source of truth
- Does not require always-on connectivity

**Key principle:** You can `rm -rf` the index, restart it, and it rebuilds
from the git repos. Zero data loss. The files ARE the system.

---

## Components and Interfaces

### 1. Identity Resolver

Determines the current user's identity for all collaboration operations.

```typescript
interface IdentityResolver {
  resolve(options?: { as?: string }): Promise<Identity>;
}

interface Identity {
  id: string;
  name: string;
  kind: "human" | "agent";
  role: "owner" | "lead" | "developer" | "reviewer" | "agent" | "observer";
  email?: string;
  backend?: RunnerBackend; // for agents
  profile?: string; // for agents
}
```

Resolution order:

1. `--as <identity>` CLI flag
2. `SUPERMISSION_IDENTITY` environment variable
3. Match git config `user.name` against team.yaml identities
4. If no team.yaml exists → "local-user" (solo mode, no collaboration checks)

### 2. Collaboration Guard

Middleware that enforces permissions before any mutation.

```typescript
interface CollaborationGuard {
  checkPermission(identity: Identity, work: WorkSpec, action: CollabAction): PermissionResult;
  checkLock(identity: Identity, workId: string): LockCheckResult;
}

type CollabAction = "assign" | "transition" | "approve" | "run" | "validate" | "handoff";

type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string; signal: SupervisorSignal };
```

Rules:

- Solo mode (no team.yaml): all actions allowed, guard is a no-op
- Owner/lead: can do anything
- Developer: can mutate assigned work only
- Agent: can mutate assigned work, auto-routes to reviewer on completion
- Observer: read-only, all mutations rejected
- Reviewer: can approve/reject, cannot run

### 3. Notification Writer

Appends notifications to identity inbox files and optionally fires webhooks.

```typescript
interface NotificationWriter {
  notify(target: Identity, notification: Notification): Promise<void>;
  notifyTeam(team: string, notification: Notification): Promise<void>;
  notifyWebhook(notification: Notification): Promise<void>;
}

interface Notification {
  id: string;
  time: string;
  type:
    | "assigned"
    | "needs_review"
    | "blocking_signal"
    | "completed"
    | "conflict"
    | "dependency_resolved"
    | "lock_stale";
  work_id: string;
  from: string;
  message: string;
  metadata?: Record<string, unknown>;
}
```

### 4. Conflict Detector (enhanced)

Identifies concurrent mutations and stale state.

```typescript
interface ConflictDetector {
  checkSyncState(workId: string, identity: Identity): SyncCheckResult;
  checkScopeOverlap(workId: string): ScopeOverlapResult[];
  checkStaleLocks(): StaleLockResult[];
}

interface SyncCheckResult {
  stale: boolean;
  lastKnownRef: string;
  currentRef: string;
  modifiedBy: string;
  guidance: string;
}
```

### 5. Lock Manager

Manages exclusive mutation locks on work records.

```typescript
interface LockManager {
  acquire(workId: string, identity: Identity, reason: string): Promise<Lock>;
  release(workId: string, identity: Identity): Promise<void>;
  forceRelease(workId: string, owner: Identity, reason: string): Promise<void>;
  check(workId: string): Promise<Lock | null>;
}

interface Lock {
  holder: string;
  acquired_at: string;
  expected_duration_minutes: number;
  reason: string;
}
```

### 6. Coordination Index Server

Optional separate process for cross-repo aggregation.

```typescript
interface CoordinationIndex {
  // Ingestion
  registerRepo(url: string, team: string): Promise<void>;
  pollRepos(): Promise<void>;
  handleWebhook(payload: PushEvent): Promise<void>;

  // Queries (HTTP API)
  listWorks(filter: WorkFilter): Promise<WorkSummary[]>;
  getDependencyGraph(workId: string, repo: string): Promise<DepGraph>;
  getBoard(workspace: string): Promise<BoardView>;
}

interface WorkFilter {
  workspace?: string;
  team?: string;
  assignee?: string;
  status?: WorkStatus;
  repo?: string;
}
```

---

## Data Models

### team.yaml (new)

```yaml
version: 1
identities:
  - id: alice
    name: Alice Chen
    kind: human
    role: lead
    email: alice@acme.com
    notify: [inbox, webhook]
  - id: bob
    name: Bob Park
    kind: human
    role: developer
    email: bob@acme.com
    notify: [inbox]
  - id: codex-worker
    name: Codex Worker
    kind: agent
    role: agent
    backend: codex
    profile: default
    notify: [inbox]

webhook:
  url: https://hooks.slack.com/services/T.../B.../xxx
  events: [assigned, needs_review, blocking_signal, completed]
```

### work.yaml (extended fields)

```yaml
# Existing fields unchanged...
id: work-001
goal: Fix login validation
status: running
owner: alice

# NEW collaboration fields:
assignee: bob # Who is responsible
team: backend # Owning team
depends_on: # Cross-work dependencies
  - work_id: work-payment-api
    repo: acme/api # Optional: cross-repo reference
```

### lock.yaml (new, per work record)

```yaml
holder: bob
acquired_at: "2026-05-25T14:30:00Z"
expected_duration_minutes: 60
reason: "Running implementation via codex"
```

### sync.yaml (new)

```yaml
version: 1
last_sync:
  alice:
    ref: "abc123f"
    time: "2026-05-25T14:00:00Z"
  bob:
    ref: "def456a"
    time: "2026-05-25T14:30:00Z"
```

### inbox/\<identity\>.jsonl (new directory)

```jsonl
{"id":"notif-001","time":"2026-05-25T10:00:00Z","type":"assigned","work_id":"work-001","from":"alice","message":"Alice assigned work-001 to you"}
{"id":"notif-002","time":"2026-05-25T14:30:00Z","type":"needs_review","work_id":"work-001","from":"bob","message":"work-001 is ready for review"}
```

### workspace.yaml (new, for multi-repo orgs)

```yaml
version: 1
name: acme-corp
teams:
  - name: backend
    lead: alice
    members: [alice, bob, codex-worker]
    repos:
      - url: git@github.com:acme/api.git
        path: /home/alice/code/api
  - name: frontend
    lead: carol
    members: [carol, dave]
    repos:
      - url: git@github.com:acme/web.git
        path: /home/carol/code/web

index:
  url: http://localhost:7890
  poll_interval_seconds: 60
```

---

## How End Users Actually Use Supermission

### Solo Developer (unchanged)

```bash
supermission new "Add payment validation" --validation "bun run test"
supermission plan work-001
supermission approve work-001
supermission run work-001 --backend shell --command "bun run implement"
supermission validate work-001
supermission handoff work-001
```

No team.yaml, no identity, no server. Works exactly as today.

### Small Team (2-5 people, same repo)

```bash
# Team lead sets up collaboration once
supermission team init
supermission team add --name "alice" --kind human --role lead
supermission team add --name "bob" --kind human --role developer
supermission team add --name "codex-worker" --kind agent --role agent \
  --backend codex --profile default

# Alice creates work and assigns to Bob
supermission new "Fix login bug" --assign bob --validation "bun run test"
git add .supermission/ && git commit -m "assign login fix to bob" && git push

# Bob pulls, sees his assignment
git pull
supermission inbox                    # Shows: "work-001 assigned to you by alice"
supermission list --mine              # Shows only Bob's assigned work

# Bob works on it
supermission plan work-001
supermission approve work-001
supermission run work-001 --backend shell --command "./fix-login.sh"
supermission validate work-001
git add . && git commit -m "work-001 validated" && git push

# Alice gets notified on next pull (or via webhook → Slack)
git pull
supermission inbox                    # Shows: "work-001 needs_review"
supermission review create work-001
supermission handoff work-001
```

### Small Team with AI Agents

```bash
# Assign work to an agent
supermission new "Write unit tests for auth module" \
  --assign codex-worker \
  --validation "bun run test" \
  --acceptance "All auth functions have >80% coverage"

# Agent picks up work (via CI trigger or daemon polling inbox)
supermission run work-002 --backend codex --profile default

# On completion, auto-routes to human reviewer (team lead)
# Alice's inbox: "work-002 needs_review (agent: codex-worker)"
supermission inbox
supermission summary work-002
supermission review create work-002
supermission approve work-002 --gate approve_agent_output
supermission handoff work-002
```

### Multi-Team Organization

```bash
# Org admin configures workspace
supermission workspace init --name "acme-corp"
supermission workspace add-team --name "backend" --lead alice
supermission workspace add-team --name "frontend" --lead carol

# Start coordination index for cross-repo visibility
supermission index start --port 7890

# Carol declares dependency on backend work
supermission new "Implement checkout UI" \
  --assign carol \
  --depends-on "acme/api:work-payment-api"

# Engineering manager queries across all repos
supermission board --workspace acme-corp
supermission board --team backend --status running
```

---

## Correctness Properties

### Property 1: Source of Truth Invariant

`.supermission/` files in git are always authoritative. The Coordination Index can be destroyed and rebuilt without data loss. No external system ever writes to the repository.

**Validates: Requirements 8.3, 13.4**

### Property 2: Solo Mode Invariant

Absence of `team.yaml` means zero collaboration overhead — no permission checks, no identity resolution beyond "local-user", no lock files. All existing tests pass unchanged.

**Validates: Requirements 13.1, 13.2**

### Property 3: Append-Only Merge Safety

All JSONL files (events, telemetry, inbox) use append-only writes. Concurrent appends from different collaborators produce valid merged files after git pull (different lines, no conflicts).

**Validates: Requirements 4.4, 12.5**

### Property 4: Lock Exclusivity

At most one Identity holds a lock on a given work record at any time. Lock is represented by file presence — atomic at the filesystem level. A lock can only be released by the holder or force-released by an owner.

**Validates: Requirements 6.1, 6.2, 6.5**

### Property 5: Eventually Consistent

Team members see each other's state after git pull. The system never requires real-time consistency for correctness — only for convenience (webhooks). No operation blocks waiting for another collaborator's state.

**Validates: Requirements 4.1, 4.5**

### Property 6: Graceful Degradation

If the Coordination Index is down, all local operations continue normally. Index updates queue locally and retry. No single point of failure exists for core workflow operations.

**Validates: Requirements 8.4, 13.4**

---

## Error Handling

| Error Condition                        | Behavior                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| team.yaml missing                      | Solo mode — all collaboration features disabled, no errors      |
| Unknown assignee                       | Reject with "unknown identity: X. Run `supermission team list`" |
| Permission denied                      | Reject with reason, emit access_denied supervisor signal        |
| Lock conflict                          | Reject with lock holder info and acquisition time               |
| Stale lock (>timeout)                  | Emit stale_lock signal, allow owner to force-release            |
| Git merge conflict in work.yaml        | Emit merge_conflict signal with resolution guidance             |
| Webhook delivery failure               | Log warning, queue for retry in webhook-queue.jsonl             |
| Coordination Index unreachable         | Continue locally, queue index updates for retry                 |
| Cross-repo dependency target not found | Emit warning signal, do not block local operations              |
| Identity resolution failure            | Fall back to "local-user" with warning                          |

---

## Testing Strategy

### Unit Tests

- Identity resolver: test all resolution paths (flag, env, git config, fallback)
- Collaboration guard: test permission matrix (role × action × ownership)
- Lock manager: acquire, release, force-release, stale detection
- Notification writer: inbox append, webhook payload format
- Conflict detector: stale state, scope overlap, concurrent linear_write

### Integration Tests

- Full team workflow: init → add members → assign → run → review → handoff
- Conflict scenario: two identities modifying same work record
- Lock scenario: acquire → reject second → release → acquire succeeds
- Solo mode: all existing tests pass without team.yaml present
- Agent handoff: agent completes → auto-routes to reviewer

### Property-Based Tests

- JSONL append-only files: concurrent appends always produce valid merged output
- Identity uniqueness: no two identities share the same id in team.yaml
- Lock invariant: at most one lock holder per work record at any time

### E2E Tests

- Two git clones simulating two team members collaborating
- Coordination Index: start server, register repo, query aggregated state
- Webhook: mock HTTP server receives expected notification payloads

---

## Implementation Phases

| Phase | Scope                              | Dependencies              |
| ----- | ---------------------------------- | ------------------------- |
| 1     | Identity + Assignment              | None (Layer 1 foundation) |
| 2     | Notifications + Conflict Detection | Phase 1                   |
| 3     | Visibility + Access Control        | Phase 1                   |
| 4     | Webhook Integration                | Phase 2                   |
| 5     | Cross-Repo + Coordination Index    | Phase 1-4                 |

---

## Comparison with Multica and Slock.ai

| Capability           | Multica                | Slock.ai               | Supermission (this design)          |
| -------------------- | ---------------------- | ---------------------- | ----------------------------------- |
| Sync mechanism       | PostgreSQL + WebSocket | Server + WebSocket     | Git push/pull + optional index      |
| Real-time            | Yes (WebSocket)        | Yes (WebSocket)        | Eventual (git) + webhook for alerts |
| Server required      | Yes (Go backend)       | Yes (cloud)            | No (optional for cross-repo only)   |
| Agent execution      | Daemon on user machine | Daemon on user machine | CLI runner (daemon planned V1)      |
| Task assignment      | Web UI board           | Chat-based             | CLI + file-based                    |
| Team structure       | Workspaces             | Channels               | team.yaml + workspace.yaml          |
| Persistence          | PostgreSQL             | Server DB              | Git-backed files                    |
| Offline capable      | No                     | No                     | Yes (full functionality offline)    |
| Rebuild from scratch | No (DB is truth)       | No                     | Yes (files are truth)               |
| Chat/messaging       | Issue comments         | Channels/DMs/threads   | Not included (artifacts + inbox)    |
