import { z } from "zod";
import { isValidRedactionPattern } from "./redaction.js";

export const MissionStatusSchema = z.enum([
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

export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionSpecSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  status: MissionStatusSchema,
  owner: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  acceptance: z.array(z.string()).default([]),
  validation_commands: z.array(z.string()).default([]),
  workflow: z.array(z.string()).default([]),
  actors: z.array(z.string()).default([]),
});

export type MissionSpec = z.infer<typeof MissionSpecSchema>;

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

export const MissionPolicySchema = z.object({
  validation_allowlist: z.array(z.string()).default([]),
  redaction: z
    .object({
      patterns: z.array(RedactionPatternSchema).default([]),
    })
    .default({ patterns: [] }),
});

export type MissionPolicy = z.infer<typeof MissionPolicySchema>;

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

export const MissionTaskSchema = z.object({
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

export type MissionTask = z.infer<typeof MissionTaskSchema>;

export type SupervisorSignal = {
  type:
    | "stuck"
    | "repeated_failure"
    | "scope_drift"
    | "gate_waiting"
    | "merge_conflict"
    | "validation_missing"
    | "handoff_stale"
    | "risky_command_blocked"
    | "command_policy_blocked"
    | "linear_mutation_conflict";
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
  previous_status: MissionStatusSchema,
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

export const MissionCheckpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  actor: z.string().min(1),
  base_ref: z.string().default("unknown"),
  patch: z.string().min(1),
  created_at: z.string().min(1),
});

export type MissionCheckpoint = z.infer<typeof MissionCheckpointSchema>;

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
