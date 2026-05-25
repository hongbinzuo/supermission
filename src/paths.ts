import { join } from "node:path";

export const WORK_ROOT = ".supermission";

export type WorkPaths = ReturnType<typeof workPaths>;

export function workPaths(repo: string, workId: string) {
  const root = join(repo, WORK_ROOT, workId);
  return {
    policy: join(repo, WORK_ROOT, "policy.yaml"),
    runners: join(repo, WORK_ROOT, "runners.yaml"),
    root,
    tasks: join(root, "tasks"),
    changes: join(root, "changes"),
    checkpoints: join(root, "checkpoints"),
    work: join(root, "work.yaml"),
    lock: join(root, "lock.yaml"),
    events: join(root, "events.jsonl"),
    telemetry: join(root, "telemetry.jsonl"),
    toolCalls: join(root, "tool-calls.jsonl"),
    supervisor: join(root, "supervisor-signals.jsonl"),
    isolation: join(root, "isolation.yaml"),
    rollbackPlan: join(root, "rollback-plan.md"),
    scopeAudit: join(root, "scope-audit.md"),
    plan: join(root, "plan.md"),
    requirementsAnalysis: join(root, "requirements-analysis.md"),
    decisions: join(root, "decisions.md"),
    validationLog: join(root, "validation.log"),
    runLog: join(root, "run.log"),
    review: join(root, "review.md"),
    monitor: join(root, "monitor.md"),
    debug: join(root, "debug.md"),
    handoff: join(root, "handoff.md"),
    patch: join(root, "patch.diff"),
  };
}

export type CollaborationPaths = ReturnType<typeof collaborationPaths>;

export function collaborationPaths(repo: string) {
  const root = join(repo, WORK_ROOT);
  return {
    root,
    team: join(root, "team.yaml"),
    workspace: join(root, "workspace.yaml"),
    sync: join(root, "sync.yaml"),
    inbox: join(root, "inbox"),
    webhookQueue: join(root, "webhook-queue.jsonl"),
  };
}

export function inboxPath(repo: string, identityId: string): string {
  return join(repo, WORK_ROOT, "inbox", `${identityId}.jsonl`);
}
