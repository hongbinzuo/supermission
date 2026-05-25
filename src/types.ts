import { z } from "zod";
import { isValidRedactionPattern } from "./redaction.js";

export const WorkStatusSchema = z.enum([
  "draft",
  "planned",
  "approved",
  "running",
  "needs_decision",
  "needs_review",
  "validated",
  "completed",
  "blocked",
  "failed",
  "paused",
]);

export type WorkStatus = z.infer<typeof WorkStatusSchema>;

export const WorkSpecSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  status: WorkStatusSchema,
  owner: z.string().min(1),
  assignee: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "backlog"]).default("medium"),
  milestone: z.string().min(1).optional(),
  labels: z.array(z.string().min(1)).default([]),
  cycle: z.string().min(1).optional(),
  depends_on: z
    .array(
      z.object({
        work_id: z.string().min(1),
        repo: z.string().optional(),
      }),
    )
    .default([]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  acceptance: z.array(z.string()).default([]),
  validation_commands: z.array(z.string()).default([]),
  workflow: z.array(z.string()).default([]),
  actors: z.array(z.string()).default([]),
});

export type WorkSpec = z.infer<typeof WorkSpecSchema>;

export type EventRecord = {
  type: string;
  actor: string;
  time: string;
  [key: string]: unknown;
};

export type TelemetryRecord = {
  time: string;
  metric: string;
  [key: string]: unknown;
};

export type ToolCallRecord = {
  time: string;
  actor: string;
  tool: string;
  [key: string]: unknown;
};

const RedactionPatternSchema = z.string().min(1).refine(isValidRedactionPattern, {
  message: "invalid regular expression",
});

export const WorkPolicySchema = z.object({
  validation_allowlist: z.array(z.string()).default([]),
  redaction: z
    .object({
      patterns: z.array(RedactionPatternSchema).default([]),
    })
    .default({ patterns: [] }),
});

export type WorkPolicy = z.infer<typeof WorkPolicySchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "needs_review",
  "done",
  "blocked",
  "failed",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const WorkTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatusSchema,
  actor_role: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  scope: z
    .object({
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .default({ allow: [], deny: [] }),
  validation: z.array(z.string()).default([]),
  mutation_mode: z
    .enum(["sidecar_readonly", "sidecar_artifact", "linear_write"])
    .default("linear_write"),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type WorkTask = z.infer<typeof WorkTaskSchema>;

export type SupervisorSignal = {
  type:
    | "stuck"
    | "repeated_failure"
    | "scope_drift"
    | "scope_overlap"
    | "gate_waiting"
    | "merge_conflict"
    | "stale_state"
    | "stale_lock"
    | "validation_missing"
    | "handoff_stale"
    | "risky_command_blocked"
    | "command_policy_blocked"
    | "requirements_quality"
    | "linear_mutation_conflict"
    | "access_denied"
    | "blocked_by_dependency";
  severity: "info" | "warning" | "blocking";
  message: string;
};

export const ChangeStatusSchema = z.enum([
  "proposed",
  "approved",
  "applied",
  "rejected",
  "deferred",
  "split",
]);

export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;

export const ChangeTypeSchema = z.enum([
  "product",
  "business",
  "ui_ux",
  "api_contract",
  "data_schema",
  "architecture",
  "security",
  "environment",
  "workflow",
]);

export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangeProposalSchema = z.object({
  id: z.string().min(1),
  status: ChangeStatusSchema,
  type: ChangeTypeSchema,
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  reason: z.string().min(1),
  source: z.object({
    actor: z.string().min(1),
    kind: z.enum(["human", "agent", "validation", "review", "system"]).default("human"),
  }),
  previous_status: WorkStatusSchema,
  affected: z.array(z.string()).default([]),
  options: z.array(z.string()).default([]),
  recommendation: z.string().optional(),
  requires_gate: z.string().default("approve_plan_revision"),
  decision: z
    .object({
      actor: z.string(),
      decided_at: z.string(),
      reason: z.string().optional(),
    })
    .optional(),
  application: z
    .object({
      actor: z.string(),
      applied_at: z.string(),
      note: z.string().optional(),
      added: z.object({
        acceptance: z.array(z.string()).default([]),
        validation_commands: z.array(z.string()).default([]),
        workflow: z.array(z.string()).default([]),
        plan_notes: z.array(z.string()).default([]),
      }),
    })
    .optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const WorkCheckpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  actor: z.string().min(1),
  base_ref: z.string().default("unknown"),
  patch: z.string().min(1),
  created_at: z.string().min(1),
});

export type WorkCheckpoint = z.infer<typeof WorkCheckpointSchema>;

export const GitIsolationSchema = z.object({
  branch: z.string().optional(),
  worktree_path: z.string().optional(),
  created_by: z.string().min(1),
  created_at: z.string().min(1),
});

export type GitIsolation = z.infer<typeof GitIsolationSchema>;

export type DoctorFinding = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  next: string;
};

export const RequirementFindingSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "wrong_level_of_detail",
    "ambiguity",
    "implementation_leak",
    "inconsistency",
    "incompleteness",
  ]),
  severity: z.enum(["info", "warning", "blocking"]),
  requirement: z.string().optional(),
  message: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(2),
});

export type RequirementFinding = z.infer<typeof RequirementFindingSchema>;
