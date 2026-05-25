import { z } from "zod";

// --- Identity ---

export const IdentityKindSchema = z.enum(["human", "agent"]);
export type IdentityKind = z.infer<typeof IdentityKindSchema>;

export const IdentityRoleSchema = z.enum([
  "owner",
  "lead",
  "developer",
  "reviewer",
  "agent",
  "observer",
]);
export type IdentityRole = z.infer<typeof IdentityRoleSchema>;

export const NotifyChannelSchema = z.enum(["inbox", "webhook"]);
export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const IdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: IdentityKindSchema,
  role: IdentityRoleSchema,
  email: z.string().email().optional(),
  backend: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  notify: z.array(NotifyChannelSchema).default(["inbox"]),
});

export type Identity = z.infer<typeof IdentitySchema>;

// --- Team Registry (team.yaml) ---

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z
    .array(z.enum(["assigned", "needs_review", "blocking_signal", "completed", "conflict"]))
    .default([]),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export const TeamRegistrySchema = z.object({
  version: z.number().int().positive().default(1),
  identities: z.array(IdentitySchema).default([]),
  webhook: WebhookConfigSchema.optional(),
});

export type TeamRegistry = z.infer<typeof TeamRegistrySchema>;

// --- Lock (per work record) ---

export const LockSchema = z.object({
  holder: z.string().min(1),
  acquired_at: z.string().min(1),
  expected_duration_minutes: z.number().int().positive().default(60),
  reason: z.string().default(""),
});

export type Lock = z.infer<typeof LockSchema>;

// --- Sync Manifest ---

export const SyncEntrySchema = z.object({
  ref: z.string().min(1),
  time: z.string().min(1),
});

export type SyncEntry = z.infer<typeof SyncEntrySchema>;

export const SyncManifestSchema = z.object({
  version: z.number().int().positive().default(1),
  last_sync: z.record(z.string(), SyncEntrySchema).default({}),
});

export type SyncManifest = z.infer<typeof SyncManifestSchema>;

// --- Notifications ---

export const NotificationTypeSchema = z.enum([
  "assigned",
  "needs_review",
  "blocking_signal",
  "completed",
  "conflict",
  "dependency_resolved",
  "lock_stale",
  "reassigned",
]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z.object({
  id: z.string().min(1),
  time: z.string().min(1),
  type: NotificationTypeSchema,
  work_id: z.string().min(1),
  from: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;

// --- Work Dependencies ---

export const WorkDependencySchema = z.object({
  work_id: z.string().min(1),
  repo: z.string().optional(),
});

export type WorkDependency = z.infer<typeof WorkDependencySchema>;

// --- Workspace Configuration (workspace.yaml) ---

export const WorkspaceRepoSchema = z.object({
  url: z.string().min(1),
  path: z.string().optional(),
});

export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;

export const WorkspaceTeamSchema = z.object({
  name: z.string().min(1),
  lead: z.string().min(1),
  members: z.array(z.string().min(1)).default([]),
  repos: z.array(WorkspaceRepoSchema).default([]),
});

export type WorkspaceTeam = z.infer<typeof WorkspaceTeamSchema>;

export const IndexConfigSchema = z.object({
  url: z.string().url(),
  poll_interval_seconds: z.number().int().positive().default(60),
});

export type IndexConfig = z.infer<typeof IndexConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  name: z.string().min(1),
  teams: z.array(WorkspaceTeamSchema).default([]),
  index: IndexConfigSchema.optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// --- Collaboration Actions (for permission checks) ---

export type CollabAction = "assign" | "transition" | "approve" | "run" | "validate" | "handoff";

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string };
