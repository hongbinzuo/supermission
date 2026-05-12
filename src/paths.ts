import { join } from "node:path";

export const MISSION_ROOT = ".missions";

export type MissionPaths = ReturnType<typeof missionPaths>;

export function missionPaths(repo: string, missionId: string) {
  const root = join(repo, MISSION_ROOT, missionId);
  return {
    policy: join(repo, MISSION_ROOT, "policy.yaml"),
    root,
    tasks: join(root, "tasks"),
    changes: join(root, "changes"),
    checkpoints: join(root, "checkpoints"),
    mission: join(root, "mission.yaml"),
    events: join(root, "events.jsonl"),
    telemetry: join(root, "telemetry.jsonl"),
    toolCalls: join(root, "tool-calls.jsonl"),
    supervisor: join(root, "supervisor-signals.jsonl"),
    isolation: join(root, "isolation.yaml"),
    rollbackPlan: join(root, "rollback-plan.md"),
    scopeAudit: join(root, "scope-audit.md"),
    plan: join(root, "plan.md"),
    decisions: join(root, "decisions.md"),
    validationLog: join(root, "validation.log"),
    review: join(root, "review.md"),
    monitor: join(root, "monitor.md"),
    debug: join(root, "debug.md"),
    handoff: join(root, "handoff.md"),
    patch: join(root, "patch.diff"),
  };
}
