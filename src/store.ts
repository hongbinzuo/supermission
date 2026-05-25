import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { minimatch } from "minimatch";
import YAML from "yaml";
import { appendJsonl, readJsonl } from "./jsonl.js";
import { WORK_ROOT, workPaths } from "./paths.js";
import { redactSecrets } from "./redaction.js";
import {
  formatRunLog,
  RunnerConfigSchema,
  type RunnerConfig,
  type RunnerExecution,
} from "./runner.js";
import { slugify } from "./slug.js";
import { utcNow } from "./time.js";
import {
  type ChangeProposal,
  ChangeProposalSchema,
  type ChangeStatus,
  type ChangeType,
  type DoctorFinding,
  type EventRecord,
  type GitIsolation,
  GitIsolationSchema,
  type WorkCheckpoint,
  WorkCheckpointSchema,
  type WorkPolicy,
  WorkPolicySchema,
  type WorkSpec,
  WorkSpecSchema,
  type WorkStatus,
  type WorkTask,
  WorkTaskSchema,
  type RequirementFinding,
  RequirementFindingSchema,
  type SupervisorSignal,
  type TelemetryRecord,
  type ToolCallRecord,
} from "./types.js";

export type CreateWorkInput = {
  id?: string;
  goal: string;
  actor: string;
  acceptance: string[];
  validationCommands: string[];
  assignee?: string;
};

export type ValidationResult = {
  exitCode: number;
  durationMs: number;
};

export type ValidateOptions = {
  commands?: string[];
  allowRisky?: boolean;
};

export type ProposeChangeInput = {
  actor: string;
  sourceKind: ChangeProposal["source"]["kind"];
  type: ChangeType;
  risk: ChangeProposal["risk"];
  reason: string;
  affected: string[];
  options: string[];
  recommendation?: string;
  requiresGate?: string;
};

export type ApplyChangeInput = {
  actor: string;
  acceptance: string[];
  validationCommands: string[];
  workflowSteps: string[];
  planNotes: string[];
  note?: string;
};

export type AppliedChangeResult = {
  change: ChangeProposal;
  added: {
    acceptance: string[];
    validation_commands: string[];
    workflow: string[];
    plan_notes: string[];
  };
};

export type CreateBranchInput = {
  actor: string;
  branch?: string;
};

export type CreateWorktreeInput = {
  actor: string;
  path: string;
  branch?: string;
};

export type AddTaskInput = {
  actor: string;
  title: string;
  actorRole: string;
  mutationMode: WorkTask["mutation_mode"];
  dependsOn: string[];
  scopeAllow: string[];
  scopeDeny: string[];
  validation: string[];
};

export type WorkSummary = {
  id: string;
  goal: string;
  status: WorkStatus;
  validation_commands: number;
  tasks: number;
  changes: {
    total: number;
    pending: number;
  };
  checkpoints: number;
  findings: DoctorFinding[];
  artifacts: Record<string, string>;
};

export type SupervisorSignalRecord = SupervisorSignal & {
  record_id: string;
  time: string;
};

export type WorkMonitor = {
  id: string;
  status: WorkStatus;
  active_tasks: WorkTask[];
  ready_tasks: WorkTask[];
  blocked_tasks: WorkTask[];
  pending_changes: ChangeProposal[];
  findings: DoctorFinding[];
  recent_events: EventRecord[];
  recent_signals: SupervisorSignalRecord[];
  next_actions: string[];
};

export type ScopeAuditResult = {
  task: string;
  changed_files: string[];
  violations: Array<{
    file: string;
    reason: "not_allowed" | "denied";
  }>;
};

export type PatchCaptureOptions = {
  taskId?: string;
};

export type RollbackCheckResult = {
  checkpoint?: string;
  ok: boolean;
  message: string;
};

export type RequirementAnalysisResult = {
  work_id: string;
  findings: RequirementFinding[];
  artifact: string;
};

const DEFAULT_ACTORS = [
  "planner-agent",
  "worker-agent",
  "validator-agent",
  "reviewer-agent",
  "handoff-agent",
  "supervisor-agent",
];

const DEFAULT_WORKFLOW = ["research", "plan", "approve", "implement", "validate", "handoff"];
const STUCK_TASK_MS = 30 * 60 * 1000;

export class WorkStore {
  readonly repo: string;

  constructor(repo = process.cwd()) {
    this.repo = resolve(repo);
  }

  paths(workId: string) {
    return workPaths(this.repo, workId);
  }

  async listWorkIds(): Promise<string[]> {
    const root = join(this.repo, WORK_ROOT);
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const ids: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const workFile = join(root, entry.name, "work.yaml");
        try {
          await stat(workFile);
          ids.push(entry.name);
        } catch {
          // Ignore incomplete directories.
        }
      }
      return ids.sort();
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
  }

  async createWork(input: CreateWorkInput): Promise<string> {
    const now = utcNow();
    const stamp = now.replace(/[-:TZ]/g, "").slice(0, 14);
    const workId = input.id ? sanitizeId(input.id) : `${stamp}-${slugify(input.goal)}`;
    const paths = this.paths(workId);

    if (await exists(paths.root)) {
      throw new Error(`work already exists: ${workId}`);
    }

    await mkdir(paths.root, { recursive: true });
    await mkdir(paths.tasks, { recursive: true });
    await mkdir(paths.changes, { recursive: true });
    await mkdir(paths.checkpoints, { recursive: true });

    const spec: WorkSpec = {
      id: workId,
      goal: input.goal,
      status: "draft",
      owner: input.actor,
      assignee: input.assignee,
      created_at: now,
      updated_at: now,
      acceptance: input.acceptance,
      validation_commands: input.validationCommands,
      workflow: DEFAULT_WORKFLOW,
      actors: DEFAULT_ACTORS,
      depends_on: [],
      priority: "medium",
      labels: [],
    };

    await this.writeWork(spec);
    await writeFile(paths.plan, "# Plan\n\nTBD: Run `supermission plan`.\n", "utf8");
    await writeFile(
      paths.requirementsAnalysis,
      "# Requirements Analysis\n\nTBD: Run `supermission requirements check`.\n",
      "utf8",
    );
    await writeFile(paths.decisions, "# Decisions\n\nTBD: Record decisions here.\n", "utf8");
    await writeFile(paths.validationLog, "", "utf8");
    await writeFile(paths.runLog, "# Run\n\nTBD: Run the work with a runner.\n", "utf8");
    await writeFile(paths.review, "# Review\n\nTBD: Record review findings here.\n", "utf8");
    await writeFile(paths.monitor, "# Monitor\n\nTBD: Run `supermission monitor`.\n", "utf8");
    await writeFile(
      paths.scopeAudit,
      "# Scope Audit\n\nTBD: Run `supermission task audit-scope`.\n",
      "utf8",
    );
    await writeFile(paths.debug, "# Debug\n\nNo debug notes yet.\n", "utf8");
    await writeFile(paths.handoff, "# Handoff\n\nTBD: Run `supermission handoff`.\n", "utf8");
    await writeFile(paths.patch, "", "utf8");

    await this.writeTask(workId, {
      id: "task-001",
      title: "Implement work workflow",
      status: "ready",
      actor_role: "worker-agent",
      depends_on: [],
      scope: { allow: [], deny: [] },
      validation: input.validationCommands,
      mutation_mode: "linear_write",
      created_at: now,
      updated_at: now,
    });

    await this.appendEvent(workId, "work.created", input.actor, { goal: input.goal });
    await this.appendTelemetry(workId, { metric: "work.created", status: "draft" });
    return workId;
  }

  async readWork(workId: string): Promise<WorkSpec> {
    const paths = this.paths(workId);
    const text = await readFile(paths.work, "utf8").catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) throw new Error(`unknown work: ${workId}`);
      throw error;
    });
    return WorkSpecSchema.parse(YAML.parse(text));
  }

  async readPolicy(): Promise<WorkPolicy> {
    try {
      const text = await readFile(this.paths("policy").policy, "utf8");
      return WorkPolicySchema.parse(YAML.parse(text));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return WorkPolicySchema.parse({ validation_allowlist: [] });
      }
      throw error;
    }
  }

  async writePolicy(policy: WorkPolicy): Promise<WorkPolicy> {
    const parsed = WorkPolicySchema.parse(policy);
    await mkdir(join(this.repo, WORK_ROOT), { recursive: true });
    await writeFile(this.paths("policy").policy, YAML.stringify(parsed), "utf8");
    return parsed;
  }

  async readRunnerConfig(): Promise<RunnerConfig> {
    try {
      const text = await readFile(this.paths("runners").runners, "utf8");
      return RunnerConfigSchema.parse(YAML.parse(text));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return RunnerConfigSchema.parse({});
      }
      throw error;
    }
  }

  async writeRunnerConfig(config: RunnerConfig): Promise<RunnerConfig> {
    const parsed = RunnerConfigSchema.parse(config);
    await mkdir(join(this.repo, WORK_ROOT), { recursive: true });
    await writeFile(this.paths("runners").runners, YAML.stringify(parsed), "utf8");
    return parsed;
  }

  async writeWork(spec: WorkSpec): Promise<void> {
    const parsed = WorkSpecSchema.parse({ ...spec, updated_at: utcNow() });
    await writeFile(this.paths(parsed.id).work, YAML.stringify(parsed), "utf8");
  }

  async updateStatus(
    workId: string,
    status: WorkStatus,
    actor: string,
    reason?: string,
  ): Promise<void> {
    const spec = await this.readWork(workId);
    if (spec.status === status) return;
    const previous = spec.status;
    await this.writeWork({ ...spec, status });
    await this.appendEvent(workId, "work.state.changed", actor, {
      from: previous,
      to: status,
      ...(reason ? { reason } : {}),
    });
    await this.appendTelemetry(workId, {
      metric: "state.changed",
      from: previous,
      to: status,
    });
  }

  async appendEvent(
    workId: string,
    type: string,
    actor: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const path = this.paths(workId).events;
    await appendJsonl(path, {
      record_id: await nextRecordId(path, "event"),
      type,
      actor,
      time: utcNow(),
      ...payload,
    });
  }

  async appendTelemetry(workId: string, payload: Omit<TelemetryRecord, "time">): Promise<void> {
    const path = this.paths(workId).telemetry;
    await appendJsonl(path, {
      record_id: await nextRecordId(path, "telemetry"),
      time: utcNow(),
      ...payload,
    });
  }

  async appendToolCall(workId: string, payload: Omit<ToolCallRecord, "time">): Promise<void> {
    const path = this.paths(workId).toolCalls;
    await appendJsonl(path, {
      record_id: await nextRecordId(path, "tool-call"),
      time: utcNow(),
      ...payload,
    });
  }

  async appendSupervisorSignal(workId: string, signal: SupervisorSignal): Promise<void> {
    const path = this.paths(workId).supervisor;
    await appendJsonl(path, {
      record_id: await nextRecordId(path, "signal"),
      time: utcNow(),
      ...signal,
    });
    await this.appendEvent(workId, "supervisor.signal", "supervisor-agent", {
      signal_type: signal.type,
      severity: signal.severity,
      message: signal.message,
    });
  }

  async readEvents(workId: string): Promise<EventRecord[]> {
    return withRecordIds(await readJsonl<EventRecord>(this.paths(workId).events), "event");
  }

  async readTelemetry(workId: string): Promise<TelemetryRecord[]> {
    return withRecordIds(
      await readJsonl<TelemetryRecord>(this.paths(workId).telemetry),
      "telemetry",
    );
  }

  async analyzeRequirements(workId: string, actor: string): Promise<RequirementAnalysisResult> {
    const work = await this.readWork(workId);
    const findings = RequirementFindingSchema.array().parse(
      findRequirementIssues(work.acceptance, work.validation_commands),
    );
    const text = formatRequirementsAnalysis(work, actor, findings);
    await writeFile(this.paths(workId).requirementsAnalysis, text, "utf8");
    await this.appendEvent(workId, "requirements.analysis.created", actor, {
      artifact: "requirements-analysis.md",
      findings: findings.length,
      blocking: findings.filter((finding) => finding.severity === "blocking").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
    });
    await this.appendTelemetry(workId, {
      metric: "requirements.analysis",
      findings: findings.length,
      blocking: findings.filter((finding) => finding.severity === "blocking").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
    });
    if (findings.length > 0) {
      await this.appendSupervisorSignal(workId, {
        type: "requirements_quality",
        severity: findings.some((finding) => finding.severity === "blocking")
          ? "blocking"
          : "warning",
        message: `${findings.length} requirement quality finding(s) need clarification before implementation.`,
      });
    }
    return { work_id: workId, findings, artifact: "requirements-analysis.md" };
  }

  async readToolCalls(workId: string): Promise<ToolCallRecord[]> {
    return withRecordIds(
      await readJsonl<ToolCallRecord>(this.paths(workId).toolCalls),
      "tool-call",
    );
  }

  async readSupervisorSignals(workId: string): Promise<SupervisorSignalRecord[]> {
    return withRecordIds(
      await readJsonl<SupervisorSignalRecord>(this.paths(workId).supervisor),
      "signal",
    );
  }

  async writeTask(workId: string, task: WorkTask): Promise<void> {
    const parsed = WorkTaskSchema.parse({ ...task, updated_at: utcNow() });
    await mkdir(this.paths(workId).tasks, { recursive: true });
    await writeFile(
      join(this.paths(workId).tasks, `${parsed.id}.yaml`),
      YAML.stringify(parsed),
      "utf8",
    );
  }

  async addTask(workId: string, input: AddTaskInput): Promise<WorkTask> {
    await this.readWork(workId);
    for (const dependency of input.dependsOn) {
      await this.readTask(workId, dependency);
    }
    const now = utcNow();
    const task: WorkTask = {
      id: await this.nextTaskId(workId),
      title: input.title,
      status: input.dependsOn.length > 0 ? "pending" : "ready",
      actor_role: input.actorRole,
      depends_on: input.dependsOn,
      scope: {
        allow: input.scopeAllow,
        deny: input.scopeDeny,
      },
      validation: input.validation,
      mutation_mode: input.mutationMode,
      created_at: now,
      updated_at: now,
    };
    await this.writeTask(workId, task);
    await this.appendEvent(workId, "task.created", input.actor, {
      task: task.id,
      mutation_mode: task.mutation_mode,
      actor_role: task.actor_role,
    });
    return task;
  }

  async readTask(workId: string, taskId: string): Promise<WorkTask> {
    const path = join(this.paths(workId).tasks, `${taskId}.yaml`);
    const text = await readFile(path, "utf8").catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) throw new Error(`unknown task: ${taskId}`);
      throw error;
    });
    return WorkTaskSchema.parse(YAML.parse(text));
  }

  async setTaskStatus(
    workId: string,
    taskId: string,
    status: WorkTask["status"],
    actor: string,
  ): Promise<WorkTask> {
    const task = await this.readTask(workId, taskId);
    if (status === "running") {
      await this.ensureTaskCanRun(workId, task);
    }
    const updated: WorkTask = { ...task, status, updated_at: utcNow() };
    await this.writeTask(workId, updated);
    await this.appendEvent(workId, "task.status.changed", actor, {
      task: taskId,
      from: task.status,
      to: status,
    });
    if (status === "done") {
      await this.refreshReadyTasks(workId, actor);
    }
    return updated;
  }

  async ensureTaskCanRun(workId: string, task: WorkTask): Promise<void> {
    if (task.mutation_mode !== "linear_write") return;
    const tasks = await this.listTasks(workId);
    const runningLinear = tasks.find(
      (candidate) =>
        candidate.id !== task.id &&
        candidate.status === "running" &&
        candidate.mutation_mode === "linear_write",
    );
    if (!runningLinear) return;

    const message = `linear_write task ${runningLinear.id} is already running`;
    await this.appendSupervisorSignal(workId, {
      type: "linear_mutation_conflict",
      severity: "blocking",
      message,
    });
    throw new Error(message);
  }

  async refreshReadyTasks(workId: string, actor: string): Promise<WorkTask[]> {
    const tasks = await this.listTasks(workId);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const updated: WorkTask[] = [];

    for (const task of tasks) {
      if (task.status !== "pending" || task.depends_on.length === 0) continue;
      const dependenciesDone = task.depends_on.every((dependency) => {
        return byId.get(dependency)?.status === "done";
      });
      if (!dependenciesDone) continue;

      const ready: WorkTask = { ...task, status: "ready", updated_at: utcNow() };
      await this.writeTask(workId, ready);
      await this.appendEvent(workId, "task.unblocked", actor, {
        task: task.id,
        dependencies: task.depends_on,
      });
      updated.push(ready);
    }

    return updated;
  }

  async auditTaskScope(workId: string, taskId: string, actor: string): Promise<ScopeAuditResult> {
    const task = await this.readTask(workId, taskId);
    const changedFiles = await changedGitFiles(this.repo);
    const violations: ScopeAuditResult["violations"] = [];
    for (const file of changedFiles) {
      const denied = task.scope.deny.some((pattern) => matchesScope(file, pattern));
      if (denied) {
        violations.push({ file, reason: "denied" });
        continue;
      }
      const allowed =
        task.scope.allow.length === 0 ||
        task.scope.allow.some((pattern) => matchesScope(file, pattern));
      if (!allowed) {
        violations.push({ file, reason: "not_allowed" });
      }
    }
    const result: ScopeAuditResult = {
      task: task.id,
      changed_files: changedFiles,
      violations,
    };
    await this.writeScopeAudit(workId, actor, result);
    if (violations.length > 0) {
      await this.appendSupervisorSignal(workId, {
        type: "scope_drift",
        severity: "blocking",
        message: `${violations.length} changed file(s) are outside task ${task.id} scope.`,
      });
    }
    return result;
  }

  async writeScopeAudit(workId: string, actor: string, result: ScopeAuditResult): Promise<string> {
    const lines = [
      "# Scope Audit",
      "",
      `Work: ${workId}`,
      `Task: ${result.task}`,
      `Auditor: ${actor}`,
      `Created at: ${utcNow()}`,
      "",
      "## Changed Files",
      "",
      ...(result.changed_files.length > 0
        ? result.changed_files.map((file) => `- ${file}`)
        : ["- None"]),
      "",
      "## Violations",
      "",
      ...(result.violations.length > 0
        ? result.violations.map((violation) => `- ${violation.reason}: ${violation.file}`)
        : ["- None"]),
    ];
    const text = `${lines.join("\n")}\n`;
    await writeFile(this.paths(workId).scopeAudit, text, "utf8");
    await this.appendEvent(workId, "scope.audit.created", actor, {
      artifact: "scope-audit.md",
      task: result.task,
      violations: result.violations.length,
    });
    return text;
  }

  async nextTaskId(workId: string): Promise<string> {
    const tasks = await this.listTasks(workId);
    const nextNumber =
      tasks.reduce((max, task) => {
        const match = /^task-(\d+)$/.exec(task.id);
        return match ? Math.max(max, Number.parseInt(match[1] ?? "0", 10)) : max;
      }, 0) + 1;
    return `task-${String(nextNumber).padStart(3, "0")}`;
  }

  async listTasks(workId: string): Promise<WorkTask[]> {
    const paths = this.paths(workId);
    try {
      const files = await readdir(paths.tasks);
      const tasks = await Promise.all(
        files
          .filter((file) => file.endsWith(".yaml"))
          .sort()
          .map(async (file) => {
            const text = await readFile(join(paths.tasks, file), "utf8");
            return WorkTaskSchema.parse(YAML.parse(text));
          }),
      );
      return tasks;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
  }

  async proposeChange(workId: string, input: ProposeChangeInput): Promise<ChangeProposal> {
    const spec = await this.readWork(workId);
    const now = utcNow();
    const id = await this.nextChangeId(workId);
    const proposal: ChangeProposal = {
      id,
      status: "proposed",
      type: input.type,
      risk: input.risk,
      reason: input.reason,
      source: {
        actor: input.actor,
        kind: input.sourceKind,
      },
      previous_status: spec.status,
      affected: input.affected,
      options: input.options,
      recommendation: input.recommendation,
      requires_gate: input.requiresGate ?? defaultGateForChange(input.type),
      created_at: now,
      updated_at: now,
    };

    await this.writeChange(workId, proposal);
    await this.appendEvent(workId, "change.proposed", input.actor, {
      change: id,
      change_type: proposal.type,
      risk: proposal.risk,
      requires_gate: proposal.requires_gate,
    });
    await this.updateStatus(workId, "needs_decision", input.actor, `change proposed: ${id}`);
    return proposal;
  }

  async listChanges(workId: string): Promise<ChangeProposal[]> {
    const paths = this.paths(workId);
    try {
      const files = await readdir(paths.changes);
      const changes = await Promise.all(
        files
          .filter((file) => file.endsWith(".yaml"))
          .sort()
          .map(async (file) => this.readChange(workId, file.replace(/\.yaml$/, ""))),
      );
      return changes;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
  }

  async nextChangeId(workId: string): Promise<string> {
    const changes = await this.listChanges(workId);
    const nextNumber =
      changes.reduce((max, change) => {
        const match = /^change-(\d+)$/.exec(change.id);
        return match ? Math.max(max, Number.parseInt(match[1] ?? "0", 10)) : max;
      }, 0) + 1;
    return `change-${String(nextNumber).padStart(3, "0")}`;
  }

  async readChange(workId: string, changeId: string): Promise<ChangeProposal> {
    const path = join(this.paths(workId).changes, `${changeId}.yaml`);
    const text = await readFile(path, "utf8").catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`unknown change: ${changeId}`);
      }
      throw error;
    });
    return ChangeProposalSchema.parse(YAML.parse(text));
  }

  async decideChange(
    workId: string,
    changeId: string,
    status: Extract<ChangeStatus, "approved" | "rejected" | "deferred" | "split">,
    actor: string,
    reason?: string,
  ): Promise<ChangeProposal> {
    const change = await this.readChange(workId, changeId);
    if (change.status !== "proposed") {
      throw new Error(`change is already ${change.status}: ${changeId}`);
    }

    const decided: ChangeProposal = {
      ...change,
      status,
      decision: {
        actor,
        decided_at: utcNow(),
        ...(reason ? { reason } : {}),
      },
      updated_at: utcNow(),
    };
    await this.writeChange(workId, decided);
    await this.appendEvent(workId, `change.${status}`, actor, {
      change: changeId,
      reason: reason ?? "",
    });

    if (status === "approved") {
      await this.appendEvent(workId, "gate.approved", actor, {
        gate: change.requires_gate,
        change: changeId,
        reason: reason ?? "",
      });
      await this.updateStatus(
        workId,
        change.previous_status,
        actor,
        `change approved: ${changeId}`,
      );
    } else if (status === "rejected") {
      await this.updateStatus(
        workId,
        change.previous_status,
        actor,
        `change rejected: ${changeId}`,
      );
    }

    return decided;
  }

  async applyChange(
    workId: string,
    changeId: string,
    input: ApplyChangeInput,
  ): Promise<AppliedChangeResult> {
    const change = await this.readChange(workId, changeId);
    if (change.status !== "approved") {
      throw new Error(`change must be approved before apply: ${changeId}`);
    }

    if (
      input.acceptance.length === 0 &&
      input.validationCommands.length === 0 &&
      input.workflowSteps.length === 0 &&
      input.planNotes.length === 0
    ) {
      throw new Error("change apply requires at least one work or plan update");
    }

    const spec = await this.readWork(workId);
    const acceptance = appendUnique(spec.acceptance, input.acceptance);
    const validationCommands = appendUnique(spec.validation_commands, input.validationCommands);
    const workflow = appendUnique(spec.workflow, input.workflowSteps);
    const added = {
      acceptance: acceptance.added,
      validation_commands: validationCommands.added,
      workflow: workflow.added,
      plan_notes: input.planNotes,
    };

    if (
      added.acceptance.length === 0 &&
      added.validation_commands.length === 0 &&
      added.workflow.length === 0 &&
      added.plan_notes.length === 0
    ) {
      throw new Error("change apply did not add any new work or plan entries");
    }

    if (
      added.acceptance.length > 0 ||
      added.validation_commands.length > 0 ||
      added.workflow.length > 0
    ) {
      await this.writeWork({
        ...spec,
        acceptance: acceptance.values,
        validation_commands: validationCommands.values,
        workflow: workflow.values,
      });
    }

    if (added.plan_notes.length > 0) {
      await this.appendPlanNotes(workId, changeId, input.actor, added.plan_notes);
    }

    const applied: ChangeProposal = {
      ...change,
      status: "applied",
      application: {
        actor: input.actor,
        applied_at: utcNow(),
        ...(input.note ? { note: input.note } : {}),
        added,
      },
      updated_at: utcNow(),
    };
    await this.writeChange(workId, applied);
    await this.appendDecision(workId, changeId, input.actor, added, input.note);
    await this.appendEvent(workId, "change.applied", input.actor, {
      change: changeId,
      acceptance_added: added.acceptance.length,
      validation_commands_added: added.validation_commands.length,
      workflow_steps_added: added.workflow.length,
      plan_notes_added: added.plan_notes.length,
    });
    return { change: applied, added };
  }

  async writeChange(workId: string, change: ChangeProposal): Promise<void> {
    const parsed = ChangeProposalSchema.parse({ ...change, updated_at: utcNow() });
    await mkdir(this.paths(workId).changes, { recursive: true });
    await writeFile(
      join(this.paths(workId).changes, `${parsed.id}.yaml`),
      YAML.stringify(parsed),
      "utf8",
    );
  }

  async appendDecision(
    workId: string,
    changeId: string,
    actor: string,
    added: AppliedChangeResult["added"],
    note?: string,
  ): Promise<void> {
    const lines = [
      "",
      `## ${changeId} Applied`,
      "",
      `Actor: ${actor}`,
      `Applied at: ${utcNow()}`,
      ...(note ? [`Note: ${note}`] : []),
      "",
      "### Work Spec Updates",
      "",
      ...formatAddedList("Acceptance", added.acceptance),
      ...formatAddedList("Validation commands", added.validation_commands),
      ...formatAddedList("Workflow steps", added.workflow),
      ...formatAddedList("Plan notes", added.plan_notes),
    ];
    await appendFile(this.paths(workId).decisions, `${lines.join("\n")}\n`, "utf8");
  }

  async appendPlanNotes(
    workId: string,
    changeId: string,
    actor: string,
    notes: string[],
  ): Promise<void> {
    const lines = [
      "",
      `## Applied Change ${changeId}`,
      "",
      `Actor: ${actor}`,
      `Applied at: ${utcNow()}`,
      "",
      ...notes.map((note) => `- ${note}`),
    ];
    await appendFile(this.paths(workId).plan, `${lines.join("\n")}\n`, "utf8");
  }

  async writePlan(workId: string, actor: string, note?: string): Promise<void> {
    const spec = await this.readWork(workId);
    const lines = [
      "# Plan",
      "",
      `Goal: ${spec.goal}`,
      "",
      "## Steps",
      "",
      "1. Review goal, acceptance criteria, work scope, and existing repo context.",
      "2. Use the default task ledger to keep implementation work bounded.",
      "3. Implement the smallest change that satisfies acceptance criteria.",
      "4. Run validation and record stdout/stderr.",
      "5. Prepare review notes, diff evidence, and handoff.",
      "",
      "## Acceptance",
      "",
      ...(spec.acceptance.length > 0 ? spec.acceptance.map((item) => `- ${item}`) : ["- TBD"]),
      "",
      "## Validation",
      "",
      ...(spec.validation_commands.length > 0
        ? spec.validation_commands.map((command) => `- \`${command}\``)
        : ["- TBD"]),
      ...(note ? ["", "## Planning Note", "", note] : []),
    ];
    await writeFile(this.paths(workId).plan, `${lines.join("\n")}\n`, "utf8");
    await this.appendEvent(workId, "plan.proposed", actor, { artifact: "plan.md" });
    await this.updateStatus(workId, "planned", actor);
  }

  async approve(
    workId: string,
    actor: string,
    gate = "approve_plan",
    reason?: string,
  ): Promise<void> {
    if (gate === "approve_plan") {
      await this.requireWorkStatus(workId, actor, "approve_plan", ["planned"]);
    }
    await this.appendEvent(workId, "gate.approved", actor, { gate, reason: reason ?? "" });
    if (gate === "approve_plan") {
      await this.updateStatus(workId, "approved", actor);
    }
  }

  async beginRun(workId: string, actor: string): Promise<WorkSpec> {
    const spec = await this.requireWorkStatus(workId, actor, "run", [
      "approved",
      "needs_review",
      "failed",
      "blocked",
    ]);
    await this.updateStatus(workId, "running", actor);
    return spec;
  }

  async recordRun(workId: string, actor: string, note?: string): Promise<void> {
    await this.beginRun(workId, actor);
    const now = utcNow();
    await this.writeRunLog(workId, actor, {
      backend: "record",
      command: "supermission run --backend record",
      prompt: note ?? "V0 sequential workflow placeholder.",
      response: note ?? "Implementation recorded externally.",
      started_at: now,
      finished_at: now,
      exitCode: 0,
      durationMs: 0,
      stdout: "",
      stderr: "",
    });
    await this.appendToolCall(workId, {
      actor,
      tool: "work.run",
      input_summary: note ?? "V0 sequential workflow placeholder.",
      status: "recorded",
    });
    await this.appendEvent(workId, "agent.run.recorded", actor, { note: note ?? "" });
    await this.updateStatus(workId, "needs_review", actor);
  }

  async recordRunnerExecution(
    workId: string,
    actor: string,
    execution: RunnerExecution,
  ): Promise<void> {
    await this.requireWorkStatus(workId, actor, "run", [
      "running",
      "needs_review",
      "failed",
      "blocked",
    ]);
    await this.writeRunLog(workId, actor, execution);
    await this.appendToolCall(workId, {
      actor,
      tool: `runner.${execution.backend}`,
      footprint_stage: "run",
      footprint_artifact: "run.log",
      evaluation_subject: "runner_execution",
      input_summary: execution.prompt ?? execution.command ?? "Runner execution.",
      command: execution.command ?? "",
      exit_code: execution.exitCode,
      duration_ms: execution.durationMs,
      stdout_chars: execution.stdout.length,
      stderr_chars: execution.stderr.length,
      response_chars: execution.response?.length ?? 0,
      tokens_used: execution.tokensUsed ?? null,
      status: execution.exitCode === 0 ? "completed" : "failed",
    });
    await this.appendTelemetry(workId, {
      metric: "runner.executed",
      backend: execution.backend,
      exit_code: execution.exitCode,
      duration_ms: execution.durationMs,
      tokens_used: execution.tokensUsed ?? null,
      stdout_chars: execution.stdout.length,
      stderr_chars: execution.stderr.length,
      response_chars: execution.response?.length ?? 0,
    });
    await this.appendEvent(workId, "runner.executed", actor, {
      backend: execution.backend,
      command: execution.command ?? "",
      artifact: "run.log",
      footprint_artifact: "run.log",
      evaluation_subject: "runner_execution",
      exit_code: execution.exitCode,
      duration_ms: execution.durationMs,
      tokens_used: execution.tokensUsed ?? null,
    });
    if (execution.exitCode === 0) {
      await this.updateStatus(workId, "needs_review", actor);
    } else {
      await this.updateStatus(workId, "failed", actor, "runner execution failed");
      await this.writeDebug(
        workId,
        actor,
        `Runner ${execution.backend} failed with exit code ${execution.exitCode}.`,
      );
    }
  }

  async writeRunLog(workId: string, actor: string, execution: RunnerExecution): Promise<string> {
    const spec = await this.readWork(workId);
    const policy = await this.readPolicy();
    const redactedExecution = {
      ...execution,
      command: execution.command
        ? redactSecrets(execution.command, policy.redaction.patterns)
        : undefined,
      prompt: execution.prompt
        ? redactSecrets(execution.prompt, policy.redaction.patterns)
        : undefined,
      response: execution.response
        ? redactSecrets(execution.response, policy.redaction.patterns)
        : undefined,
      stdout: redactSecrets(execution.stdout, policy.redaction.patterns),
      stderr: redactSecrets(execution.stderr, policy.redaction.patterns),
    };
    const text = formatRunLog({
      workId: spec.id,
      goal: spec.goal,
      actor,
      execution: redactedExecution,
    });
    await writeFile(this.paths(workId).runLog, text, "utf8");
    return text;
  }

  async validate(
    workId: string,
    actor: string,
    options: ValidateOptions = {},
  ): Promise<ValidationResult> {
    const spec = await this.readWork(workId);
    const policy = await this.readPolicy();
    const validationCommands =
      options.commands && options.commands.length > 0 ? options.commands : spec.validation_commands;
    const started = performance.now();
    const log: string[] = ["# Validation Log", "", `Started: ${utcNow()}`, ""];

    if (validationCommands.length === 0) {
      log.push("No validation commands configured.");
      await writeFile(this.paths(workId).validationLog, `${log.join("\n")}\n`, "utf8");
      await this.appendSupervisorSignal(workId, {
        type: "validation_missing",
        severity: "blocking",
        message: "No validation commands configured.",
      });
      await this.appendEvent(workId, "validation.blocked", actor, {
        reason: "no validation commands",
      });
      await this.updateStatus(workId, "blocked", actor, "no validation commands");
      return { exitCode: 2, durationMs: Math.round(performance.now() - started) };
    }

    let exitCode = 0;
    for (const command of validationCommands) {
      if (!validationCommandAllowed(command, policy.validation_allowlist)) {
        const reason = "validation command is not in project allowlist";
        log.push(
          "## Blocked By Command Policy",
          "",
          `\`${redactSecrets(command, policy.redaction.patterns)}\``,
          "",
          `Reason: ${reason}`,
          "",
        );
        await this.appendToolCall(workId, {
          actor,
          tool: "shell",
          command: redactSecrets(command, policy.redaction.patterns),
          status: "blocked",
          reason,
        });
        await this.appendSupervisorSignal(workId, {
          type: "command_policy_blocked",
          severity: "blocking",
          message: reason,
        });
        exitCode = 4;
        continue;
      }

      const risk = classifyCommandRisk(command);
      const riskyCommandApproved =
        risk.risky && options.allowRisky
          ? await this.hasApprovedGate(workId, "approve_risky_command")
          : false;
      if (risk.risky && (!options.allowRisky || !riskyCommandApproved)) {
        const blockReason = options.allowRisky
          ? "risky command requires approve_risky_command gate"
          : risk.reason;
        log.push(
          "## Blocked Risky Command",
          "",
          `\`${redactSecrets(command, policy.redaction.patterns)}\``,
          "",
          `Reason: ${blockReason}`,
          "",
          "Use `supermission approve --gate approve_risky_command` before `supermission validate --allow-risky`.",
          "",
        );
        await this.appendToolCall(workId, {
          actor,
          tool: "shell",
          command: redactSecrets(command, policy.redaction.patterns),
          status: "blocked",
          reason: blockReason,
        });
        if (options.allowRisky) {
          await this.appendSupervisorSignal(workId, {
            type: "gate_waiting",
            severity: "blocking",
            message: blockReason,
          });
        } else {
          await this.appendSupervisorSignal(workId, {
            type: "risky_command_blocked",
            severity: "blocking",
            message: risk.reason,
          });
        }
        exitCode = 3;
        continue;
      }

      const commandStarted = performance.now();
      const result = await runShell(command, this.repo);
      const durationMs = Math.round(performance.now() - commandStarted);
      if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode;
      const redactedCommand = redactSecrets(command, policy.redaction.patterns);
      const redactedStdout = redactSecrets(result.stdout, policy.redaction.patterns);
      const redactedStderr = redactSecrets(result.stderr, policy.redaction.patterns);
      const previousToolCalls = await this.readToolCalls(workId);

      await this.appendToolCall(workId, {
        actor,
        tool: "shell",
        command: redactedCommand,
        exit_code: result.exitCode,
        duration_ms: durationMs,
        stdout_chars: redactedStdout.length,
        stderr_chars: redactedStderr.length,
      });
      if (result.exitCode !== 0) {
        await this.recordRepeatedFailureSignal(
          workId,
          redactedCommand,
          result.exitCode,
          previousToolCalls,
        );
      }

      log.push(
        "## Command",
        "",
        `\`${redactedCommand}\``,
        "",
        `Exit code: ${result.exitCode}`,
        `Duration: ${durationMs}ms`,
        "",
        "### stdout",
        "",
        "```text",
        redactedStdout.trimEnd(),
        "```",
        "",
        "### stderr",
        "",
        "```text",
        redactedStderr.trimEnd(),
        "```",
        "",
      );
    }

    const durationMs = Math.round(performance.now() - started);
    log.push(`Finished: ${utcNow()}`, `Total duration: ${durationMs}ms`, "");
    await writeFile(this.paths(workId).validationLog, log.join("\n"), "utf8");
    await this.appendTelemetry(workId, {
      metric: "validation.completed",
      exit_code: exitCode,
      duration_ms: durationMs,
    });

    if (exitCode === 0) {
      await this.appendEvent(workId, "validation.passed", actor, { artifact: "validation.log" });
      await this.updateStatus(workId, "validated", actor);
    } else if (exitCode === 3 || exitCode === 4) {
      await this.appendEvent(workId, "validation.blocked", actor, {
        artifact: "validation.log",
        reason: exitCode === 3 ? "risky command blocked" : "command policy blocked",
      });
      await this.updateStatus(
        workId,
        "blocked",
        actor,
        exitCode === 3 ? "risky command blocked" : "command policy blocked",
      );
      await this.writeDebug(
        workId,
        actor,
        exitCode === 3
          ? "Validation blocked by risky command policy."
          : "Validation blocked by project command policy.",
      );
    } else {
      await this.appendEvent(workId, "validation.failed", actor, {
        artifact: "validation.log",
        exit_code: exitCode,
      });
      await this.updateStatus(workId, "failed", actor, "validation failed");
      await this.writeDebug(workId, actor, `Validation failed with exit code ${exitCode}.`);
    }

    return { exitCode, durationMs };
  }

  async recordRepeatedFailureSignal(
    workId: string,
    command: string,
    exitCode: number,
    previousToolCalls: ToolCallRecord[],
  ): Promise<void> {
    const previousFailures = previousToolCalls.filter((call) => {
      return call.tool === "shell" && call.command === command && failedExitCode(call.exit_code);
    });
    if (previousFailures.length === 0) return;

    const signals = await this.readSupervisorSignals(workId);
    const alreadyRecorded = signals.some((signal) => {
      return signal.type === "repeated_failure" && signal.message.includes(command);
    });
    if (alreadyRecorded) return;

    await this.appendSupervisorSignal(workId, {
      type: "repeated_failure",
      severity: "blocking",
      message: `Validation command failed repeatedly (${previousFailures.length + 1} attempts, latest exit ${exitCode}): ${command}`,
    });
  }

  async writeDebug(workId: string, actor: string, reason?: string): Promise<void> {
    const spec = await this.readWork(workId);
    const recent = (await this.readEvents(workId)).slice(-8);
    const lines = [
      "# Debug",
      "",
      `Work: ${workId}`,
      `Status: ${spec.status}`,
      `Reason: ${reason ?? "No failure reason recorded."}`,
      "",
      "## Recent Events",
      "",
      ...recent.map((event) => `- ${event.time} ${event.type} actor=${event.actor}`),
      "",
      "## TBD / Needs Review",
      "",
      "- Decide whether this failure is implementation, environment, or acceptance related.",
      "- Decide whether this should become a change proposal.",
    ];
    await writeFile(this.paths(workId).debug, `${lines.join("\n")}\n`, "utf8");
    await this.appendEvent(workId, "debug.updated", actor, { artifact: "debug.md" });
  }

  async hasApprovedGate(workId: string, gate: string): Promise<boolean> {
    const events = await this.readEvents(workId);
    return events.some((event) => event.type === "gate.approved" && event.gate === gate);
  }

  async requireWorkStatus(
    workId: string,
    actor: string,
    action: string,
    allowed: WorkStatus[],
  ): Promise<WorkSpec> {
    const spec = await this.readWork(workId);
    if (allowed.includes(spec.status)) return spec;

    const message = `${action} requires work status ${formatAllowedStatuses(allowed)}; current status is ${spec.status}`;
    await this.appendSupervisorSignal(workId, {
      type: "gate_waiting",
      severity: "blocking",
      message,
    });
    await this.appendEvent(workId, "workflow.blocked", actor, {
      action,
      status: spec.status,
      allowed,
    });
    throw new Error(message);
  }

  async monitorWork(workId: string): Promise<WorkMonitor> {
    const spec = await this.readWork(workId);
    const tasks = await this.listTasks(workId);
    const changes = await this.listChanges(workId);
    const findings = await this.diagnoseWork(workId);
    const events = await this.readEvents(workId);
    const signals = await this.readSupervisorSignals(workId);
    return {
      id: spec.id,
      status: spec.status,
      active_tasks: tasks.filter((task) => task.status === "running"),
      ready_tasks: tasks.filter((task) => task.status === "ready"),
      blocked_tasks: tasks.filter((task) => task.status === "blocked" || task.status === "failed"),
      pending_changes: changes.filter((change) => change.status === "proposed"),
      findings,
      recent_events: events.slice(-8),
      recent_signals: signals.slice(-8),
      next_actions: nextActionsForMonitor(spec, tasks, changes, findings),
    };
  }

  async writeMonitor(workId: string, actor: string): Promise<string> {
    const monitor = await this.monitorWork(workId);
    const lines = [
      "# Monitor",
      "",
      `Work: ${monitor.id}`,
      `Status: ${monitor.status}`,
      `Generated by: ${actor}`,
      `Generated at: ${utcNow()}`,
      "",
      "## Next Actions",
      "",
      ...monitor.next_actions.map((action) => `- ${action}`),
      "",
      "## Active Tasks",
      "",
      ...formatTasks(monitor.active_tasks),
      "",
      "## Ready Tasks",
      "",
      ...formatTasks(monitor.ready_tasks),
      "",
      "## Blocked Tasks",
      "",
      ...formatTasks(monitor.blocked_tasks),
      "",
      "## Pending Changes",
      "",
      ...(monitor.pending_changes.length > 0
        ? monitor.pending_changes.map(
            (change) => `- ${change.id} ${change.type} ${change.risk}: ${change.reason}`,
          )
        : ["- None"]),
      "",
      "## Findings",
      "",
      ...monitor.findings.map(
        (finding) => `- ${finding.severity} ${finding.code}: ${finding.next}`,
      ),
      "",
      "## Recent Supervisor Signals",
      "",
      ...(monitor.recent_signals.length > 0
        ? monitor.recent_signals.map(
            (signal) => `- ${signal.time} ${signal.severity} ${signal.type}: ${signal.message}`,
          )
        : ["- None"]),
      "",
      "## Recent Events",
      "",
      ...monitor.recent_events.map((event) => `- ${event.time} ${event.type} actor=${event.actor}`),
    ];
    const text = `${lines.join("\n")}\n`;
    await writeFile(this.paths(workId).monitor, text, "utf8");
    await this.appendEvent(workId, "monitor.updated", actor, { artifact: "monitor.md" });
    return text;
  }

  async writeHandoff(workId: string, actor: string, complete = true): Promise<void> {
    const spec = await this.readWork(workId);
    if (complete && spec.status !== "validated" && spec.status !== "completed") {
      const message = `handoff completion requires work status validated; current status is ${spec.status}`;
      await this.appendSupervisorSignal(workId, {
        type: "gate_waiting",
        severity: "blocking",
        message,
      });
      await this.appendEvent(workId, "workflow.blocked", actor, {
        action: "handoff",
        status: spec.status,
        allowed: ["validated"],
      });
      throw new Error(message);
    }
    const events = await this.readEvents(workId);
    const lines = [
      "# Handoff",
      "",
      `Work: ${workId}`,
      `Goal: ${spec.goal}`,
      `Status: ${spec.status}`,
      "",
      "## Summary",
      "",
      "TBD: Replace with a human or agent-authored implementation summary.",
      "",
      "## Evidence",
      "",
      "- Plan: `plan.md`",
      "- Run: `run.log`",
      "- Events: `events.jsonl`",
      "- Tool calls: `tool-calls.jsonl`",
      "- Validation: `validation.log`",
      "- Debug: `debug.md`",
      "",
      "## Timeline",
      "",
      ...events.map((event) => `- ${event.time} ${event.type} actor=${event.actor}`),
    ];
    await writeFile(this.paths(workId).handoff, `${lines.join("\n")}\n`, "utf8");
    await this.appendEvent(workId, "handoff.created", actor, { artifact: "handoff.md" });
    if (complete && spec.status === "validated") {
      await this.updateStatus(workId, "completed", actor);
    }
  }

  async writeReview(workId: string, actor: string): Promise<string> {
    const spec = await this.readWork(workId);
    const findings = await this.diagnoseWork(workId);
    const checkpoints = await this.listCheckpoints(workId);
    const changes = await this.listChanges(workId);
    const lines = [
      "# Review",
      "",
      `Work: ${workId}`,
      `Goal: ${spec.goal}`,
      `Status: ${spec.status}`,
      `Reviewer: ${actor}`,
      `Created at: ${utcNow()}`,
      "",
      "## Review Focus",
      "",
      "- Intent: Did the work solve the right problem?",
      "- Scope: Did changes stay within expected boundaries?",
      "- Acceptance: Are acceptance criteria complete and satisfied?",
      "- Validation: Is evidence sufficient?",
      "- Rollback: Is there a clear recovery path?",
      "- Handoff: Can another person or agent continue from the artifacts?",
      "",
      "## Health Findings",
      "",
      ...findings.map((finding) => `- ${finding.severity} ${finding.code}: ${finding.message}`),
      "",
      "## Changes",
      "",
      ...(changes.length > 0
        ? changes.map(
            (change) => `- ${change.id} ${change.status} ${change.type}: ${change.reason}`,
          )
        : ["- No change proposals recorded."]),
      "",
      "## Checkpoints",
      "",
      ...(checkpoints.length > 0
        ? checkpoints.map(
            (checkpoint) => `- ${checkpoint.id}: ${checkpoint.label} (${checkpoint.patch})`,
          )
        : ["- No checkpoints recorded."]),
      "",
      "## Decision",
      "",
      "- [ ] Approve",
      "- [ ] Request changes",
      "- [ ] Split work",
      "- [ ] Block completion",
      "",
      "## Notes",
      "",
      "TBD: Add human review notes.",
    ];
    const text = `${lines.join("\n")}\n`;
    await writeFile(this.paths(workId).review, text, "utf8");
    await this.appendEvent(workId, "review.created", actor, { artifact: "review.md" });
    return text;
  }

  async captureDiff(
    workId: string,
    actor: string,
    options: PatchCaptureOptions = {},
  ): Promise<string> {
    const scoped = await this.capturePatchText(workId, actor, options);
    await writeFile(this.paths(workId).patch, scoped.diff, "utf8");
    await this.appendEvent(workId, "diff.captured", actor, {
      artifact: "patch.diff",
      bytes: Buffer.byteLength(scoped.diff),
      ...(scoped.taskId ? { task: scoped.taskId } : {}),
      ...(scoped.taskId ? { scoped_files: scoped.files.length } : {}),
      ...(scoped.taskId ? { scope_violations: scoped.violations } : {}),
    });
    await this.appendTelemetry(workId, {
      metric: "diff.captured",
      bytes: Buffer.byteLength(scoped.diff),
      ...(scoped.taskId ? { task: scoped.taskId } : {}),
      ...(scoped.taskId ? { scoped_files: scoped.files.length } : {}),
      ...(scoped.taskId ? { scope_violations: scoped.violations } : {}),
    });
    return scoped.diff;
  }

  async createCheckpoint(
    workId: string,
    actor: string,
    label: string,
    options: PatchCaptureOptions = {},
  ): Promise<WorkCheckpoint> {
    const now = utcNow();
    const id = await this.nextCheckpointId(workId);
    const patchFile = `${id}.patch`;
    const scoped = await this.capturePatchText(workId, actor, options);
    const baseRef = await gitOutput(this.repo, ["rev-parse", "--short", "HEAD"]).catch(
      () => "unknown",
    );
    const checkpoint: WorkCheckpoint = {
      id,
      label,
      actor,
      base_ref: baseRef.trim() || "unknown",
      patch: patchFile,
      created_at: now,
    };
    const paths = this.paths(workId);
    await mkdir(paths.checkpoints, { recursive: true });
    await writeFile(join(paths.checkpoints, patchFile), scoped.diff, "utf8");
    await writeFile(
      join(paths.checkpoints, `${id}.yaml`),
      YAML.stringify(WorkCheckpointSchema.parse(checkpoint)),
      "utf8",
    );
    await this.appendEvent(workId, "checkpoint.created", actor, {
      checkpoint: id,
      label,
      patch: `checkpoints/${patchFile}`,
      bytes: Buffer.byteLength(scoped.diff),
      ...(scoped.taskId ? { task: scoped.taskId } : {}),
      ...(scoped.taskId ? { scoped_files: scoped.files.length } : {}),
      ...(scoped.taskId ? { scope_violations: scoped.violations } : {}),
    });
    return checkpoint;
  }

  async capturePatchText(
    workId: string,
    actor: string,
    options: PatchCaptureOptions,
  ): Promise<{ diff: string; taskId?: string; files: string[]; violations: number }> {
    if (!options.taskId) {
      return { diff: await captureWorkspaceDiff(this.repo), files: [], violations: 0 };
    }

    const audit = await this.auditTaskScope(workId, options.taskId, actor);
    const violatingFiles = new Set(audit.violations.map((violation) => violation.file));
    const scopedFiles = audit.changed_files.filter((file) => !violatingFiles.has(file));
    const diff = scopedFiles.length > 0 ? await captureFilesDiff(this.repo, scopedFiles) : "";
    return {
      diff,
      taskId: options.taskId,
      files: scopedFiles,
      violations: audit.violations.length,
    };
  }

  async listCheckpoints(workId: string): Promise<WorkCheckpoint[]> {
    const paths = this.paths(workId);
    try {
      const files = await readdir(paths.checkpoints);
      const checkpoints = await Promise.all(
        files
          .filter((file) => file.endsWith(".yaml"))
          .sort()
          .map(async (file) => {
            const text = await readFile(join(paths.checkpoints, file), "utf8");
            return WorkCheckpointSchema.parse(YAML.parse(text));
          }),
      );
      return checkpoints;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
  }

  async nextCheckpointId(workId: string): Promise<string> {
    const checkpoints = await this.listCheckpoints(workId);
    const nextNumber =
      checkpoints.reduce((max, checkpoint) => {
        const match = /^checkpoint-(\d+)$/.exec(checkpoint.id);
        return match ? Math.max(max, Number.parseInt(match[1] ?? "0", 10)) : max;
      }, 0) + 1;
    return `checkpoint-${String(nextNumber).padStart(3, "0")}`;
  }

  async createBranch(workId: string, input: CreateBranchInput): Promise<GitIsolation> {
    await this.readWork(workId);
    const branch = input.branch ?? `work/${workId}`;
    await gitOutput(this.repo, ["branch", branch]);
    const isolation = await this.mergeIsolation(workId, {
      branch,
      created_by: input.actor,
      created_at: utcNow(),
    });
    await this.appendEvent(workId, "git.branch.created", input.actor, { branch });
    return isolation;
  }

  async createWorktree(workId: string, input: CreateWorktreeInput): Promise<GitIsolation> {
    await this.readWork(workId);
    const branch = input.branch ?? `work/${workId}`;
    const worktreePath = resolve(input.path);
    await gitOutput(this.repo, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
    const isolation = await this.mergeIsolation(workId, {
      branch,
      worktree_path: worktreePath,
      created_by: input.actor,
      created_at: utcNow(),
    });
    await this.appendEvent(workId, "git.worktree.created", input.actor, {
      branch,
      path: worktreePath,
    });
    return isolation;
  }

  async readIsolation(workId: string): Promise<GitIsolation | undefined> {
    try {
      const text = await readFile(this.paths(workId).isolation, "utf8");
      return GitIsolationSchema.parse(YAML.parse(text));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async mergeIsolation(workId: string, patch: Partial<GitIsolation>): Promise<GitIsolation> {
    const previous = (await this.readIsolation(workId)) ?? {
      created_by: patch.created_by ?? "unknown",
      created_at: patch.created_at ?? utcNow(),
    };
    const merged = GitIsolationSchema.parse({ ...previous, ...patch });
    await writeFile(this.paths(workId).isolation, YAML.stringify(merged), "utf8");
    return merged;
  }

  async writeRollbackPlan(workId: string, actor: string, checkpointId?: string): Promise<string> {
    await this.readWork(workId);
    const checkpoints = await this.listCheckpoints(workId);
    const checkpoint =
      checkpointId === undefined
        ? checkpoints.at(-1)
        : checkpoints.find((candidate) => candidate.id === checkpointId);
    const isolation = await this.readIsolation(workId);
    const lines = [
      "# Rollback Plan",
      "",
      `Work: ${workId}`,
      `Created by: ${actor}`,
      `Created at: ${utcNow()}`,
      "",
      "## Selected Checkpoint",
      "",
      checkpoint
        ? `- ${checkpoint.id}: ${checkpoint.label} (${checkpoint.patch})`
        : "- No checkpoint selected. Create one with `supermission checkpoint create` before relying on rollback.",
      "",
      "## Git Isolation",
      "",
      `- Branch: ${isolation?.branch ?? "TBD"}`,
      `- Worktree: ${isolation?.worktree_path ?? "TBD"}`,
      "",
      "## Manual Recovery Steps",
      "",
      "1. Stop active agents or runners for this work.",
      '2. Save the current diff with `supermission checkpoint create <work-id> --label "before rollback"`.',
      "3. Review the selected checkpoint patch.",
      "4. Apply or reverse patches manually from the work worktree.",
      "5. Run validation commands.",
      "6. Record the decision and result in `events.jsonl`.",
      "",
      "## TBD / Needs Review",
      "",
      "- Automatic rollback is intentionally not enabled yet.",
      "- Destructive rollback must require an explicit gate.",
      "- Schema/environment rollback needs a dedicated restore plan.",
    ];
    const text = `${lines.join("\n")}\n`;
    await writeFile(this.paths(workId).rollbackPlan, text, "utf8");
    await this.appendEvent(workId, "rollback.plan.created", actor, {
      artifact: "rollback-plan.md",
      checkpoint: checkpoint?.id ?? "",
    });
    return text;
  }

  async checkRollback(
    workId: string,
    actor: string,
    checkpointId?: string,
  ): Promise<RollbackCheckResult> {
    await this.readWork(workId);
    const checkpoints = await this.listCheckpoints(workId);
    const checkpoint =
      checkpointId === undefined
        ? checkpoints.at(-1)
        : checkpoints.find((candidate) => candidate.id === checkpointId);
    if (!checkpoint) {
      const message = checkpointId
        ? `unknown checkpoint: ${checkpointId}`
        : "no checkpoint available for rollback check";
      await this.appendEvent(workId, "rollback.check.failed", actor, { reason: message });
      return { ok: false, message };
    }

    const patchPath = join(this.paths(workId).checkpoints, checkpoint.patch);
    try {
      await gitOutput(this.repo, ["apply", "--reverse", "--check", patchPath]);
      const message = `Rollback check passed for ${checkpoint.id}.`;
      await this.appendEvent(workId, "rollback.check.passed", actor, {
        checkpoint: checkpoint.id,
      });
      return { checkpoint: checkpoint.id, ok: true, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "rollback check failed";
      await this.appendSupervisorSignal(workId, {
        type: "merge_conflict",
        severity: "blocking",
        message: `Rollback check failed for ${checkpoint.id}: ${message}`,
      });
      await this.appendEvent(workId, "rollback.check.failed", actor, {
        checkpoint: checkpoint.id,
        reason: message,
      });
      return { checkpoint: checkpoint.id, ok: false, message };
    }
  }

  async diagnoseWork(workId: string): Promise<DoctorFinding[]> {
    const spec = await this.readWork(workId);
    const changes = await this.listChanges(workId);
    const checkpoints = await this.listCheckpoints(workId);
    const events = await this.readEvents(workId);
    const signals = await this.readSupervisorSignals(workId);
    const tasks = await this.listTasks(workId);
    const findings: DoctorFinding[] = [];

    if (spec.validation_commands.length === 0) {
      findings.push({
        code: "validation_missing",
        severity: "blocking",
        message: "No validation commands are configured.",
        next: "Add validation commands or propose a change explaining why validation is manual.",
      });
    }

    const pendingChanges = changes.filter((change) => change.status === "proposed");
    if (pendingChanges.length > 0) {
      findings.push({
        code: "pending_change",
        severity: "blocking",
        message: `${pendingChanges.length} change proposal(s) need a decision.`,
        next: `Run supermission change show ${workId} ${pendingChanges[0]?.id} and approve/reject/defer/split it.`,
      });
    }

    const runningLinearTasks = tasks.filter(
      (task) => task.status === "running" && task.mutation_mode === "linear_write",
    );
    if (runningLinearTasks.length > 1) {
      findings.push({
        code: "linear_mutation_conflict",
        severity: "blocking",
        message: `${runningLinearTasks.length} linear_write tasks are running at the same time.`,
        next: "Stop all but one linear_write task; use sidecar_artifact for parallel non-mutating work.",
      });
    }

    if (spec.status === "failed" || spec.status === "blocked") {
      findings.push({
        code: `work_${spec.status}`,
        severity: "blocking",
        message: `Work is ${spec.status}.`,
        next: "Run supermission debug and inspect validation/tool-call evidence.",
      });
    }

    const scopeDrift = signals.find(
      (signal) => signal.type === "scope_drift" && signal.severity === "blocking",
    );
    if (scopeDrift) {
      findings.push({
        code: "scope_drift",
        severity: "blocking",
        message: scopeDrift.message,
        next: "Review scope-audit.md and propose a scope change or revert the out-of-scope files.",
      });
    }

    for (const finding of findingsForSupervisorSignals(signals)) {
      if (!findings.some((candidate) => candidate.code === finding.code)) {
        findings.push(finding);
      }
    }

    const stuckTasks = tasks.filter((task) => {
      return task.status === "running" && isOlderThan(task.updated_at, STUCK_TASK_MS);
    });
    if (stuckTasks.length > 0 && !findings.some((finding) => finding.code === "stuck")) {
      findings.push({
        code: "stuck",
        severity: "warning",
        message: `${stuckTasks.length} running task(s) have not been updated recently.`,
        next: `Inspect ${stuckTasks[0]?.id}, record progress, or mark the task blocked/failed.`,
      });
    }

    if (
      (spec.status === "needs_review" || spec.status === "validated") &&
      checkpoints.length === 0
    ) {
      findings.push({
        code: "checkpoint_missing",
        severity: "warning",
        message: "Work is near review/completion but has no checkpoint.",
        next: "Run supermission checkpoint create before review or handoff.",
      });
    }

    const handoffIndex = events.findLastIndex((event) => event.type === "handoff.created");
    const stalingEvents =
      handoffIndex >= 0 ? events.slice(handoffIndex + 1).filter(isHandoffStalingEvent) : [];
    if (stalingEvents.length > 0) {
      findings.push({
        code: "handoff_stale",
        severity: "warning",
        message: "Handoff was created before the latest work events.",
        next: "Regenerate handoff before completion.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        code: "healthy",
        severity: "info",
        message: "No blocking work health issues found.",
        next: "Continue the current workflow.",
      });
    }

    return findings;
  }

  async summarizeWork(workId: string): Promise<WorkSummary> {
    const spec = await this.readWork(workId);
    const tasks = await this.listTasks(workId);
    const changes = await this.listChanges(workId);
    const checkpoints = await this.listCheckpoints(workId);
    const findings = await this.diagnoseWork(workId);
    return {
      id: spec.id,
      goal: spec.goal,
      status: spec.status,
      validation_commands: spec.validation_commands.length,
      tasks: tasks.length,
      changes: {
        total: changes.length,
        pending: changes.filter((change) => change.status === "proposed").length,
      },
      checkpoints: checkpoints.length,
      findings,
      artifacts: {
        work: this.paths(workId).work,
        events: this.paths(workId).events,
        monitor: this.paths(workId).monitor,
        scope_audit: this.paths(workId).scopeAudit,
        plan: this.paths(workId).plan,
        run: this.paths(workId).runLog,
        validation: this.paths(workId).validationLog,
        review: this.paths(workId).review,
        handoff: this.paths(workId).handoff,
      },
    };
  }
}

function isHandoffStalingEvent(event: EventRecord): boolean {
  if (event.type === "work.state.changed" && event.to === "completed") return false;
  return event.type !== "handoff.created";
}

function formatTasks(tasks: WorkTask[]): string[] {
  if (tasks.length === 0) return ["- None"];
  return tasks.map((task) => {
    return `- ${task.id} ${task.status} ${task.mutation_mode} ${task.actor_role}: ${task.title}`;
  });
}

function formatAllowedStatuses(statuses: WorkStatus[]): string {
  if (statuses.length === 1) return statuses[0] ?? "unknown";
  return statuses.join(" or ");
}

function findingsForSupervisorSignals(signals: SupervisorSignalRecord[]): DoctorFinding[] {
  const latestByType = new Map<SupervisorSignalRecord["type"], SupervisorSignalRecord>();
  for (const signal of signals) {
    latestByType.set(signal.type, signal);
  }

  const findings: DoctorFinding[] = [];
  for (const signal of latestByType.values()) {
    const finding = findingForSupervisorSignal(signal);
    if (finding) findings.push(finding);
  }
  return findings;
}

function findingForSupervisorSignal(signal: SupervisorSignalRecord): DoctorFinding | undefined {
  switch (signal.type) {
    case "repeated_failure":
      return {
        code: "repeated_failure",
        severity: signal.severity,
        message: signal.message,
        next: "Inspect validation.log and tool-calls.jsonl, then fix the recurring failure or propose a change.",
      };
    case "risky_command_blocked":
      return {
        code: "risky_command_blocked",
        severity: signal.severity,
        message: signal.message,
        next: "Review the command and rerun validation with --allow-risky only after explicit approval.",
      };
    case "command_policy_blocked":
      return {
        code: "command_policy_blocked",
        severity: signal.severity,
        message: signal.message,
        next: "Update .supermission/policy.yaml validation_allowlist or change the validation command.",
      };
    case "linear_mutation_conflict":
      return {
        code: "linear_mutation_conflict",
        severity: signal.severity,
        message: signal.message,
        next: "Stop all but one linear_write task before continuing mutation work.",
      };
    case "stuck":
      return {
        code: "stuck",
        severity: signal.severity,
        message: signal.message,
        next: "Inspect the active task or runner, then record progress or mark it blocked.",
      };
    case "gate_waiting":
      return {
        code: "gate_waiting",
        severity: signal.severity,
        message: signal.message,
        next: "Resolve the pending gate before continuing implementation.",
      };
    case "merge_conflict":
      return {
        code: "merge_conflict",
        severity: signal.severity,
        message: signal.message,
        next: "Review the conflicting changes and route them through a controlled merge decision.",
      };
    default:
      return undefined;
  }
}

function failedExitCode(value: unknown): boolean {
  return typeof value === "number" && value !== 0;
}

function isOlderThan(value: string, durationMs: number): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time > durationMs;
}

function withRecordIds<T extends object>(
  records: T[],
  prefix: string,
): Array<T & { record_id: string }> {
  return records.map((record, index) => {
    const existing = "record_id" in record ? record.record_id : undefined;
    if (typeof existing === "string" && existing.length > 0) {
      return record as T & { record_id: string };
    }
    return { ...record, record_id: `${prefix}-${String(index + 1).padStart(6, "0")}` };
  });
}

function nextActionsForMonitor(
  spec: WorkSpec,
  tasks: WorkTask[],
  changes: ChangeProposal[],
  findings: DoctorFinding[],
): string[] {
  const pendingChange = changes.find((change) => change.status === "proposed");
  if (pendingChange) {
    return [`Decide pending change ${pendingChange.id} before continuing implementation.`];
  }

  const blocking = findings.find((finding) => finding.severity === "blocking");
  if (blocking) {
    return [blocking.next];
  }

  const runningTask = tasks.find((task) => task.status === "running");
  if (runningTask) {
    return [`Continue or inspect running task ${runningTask.id}; keep code mutations linear.`];
  }

  const readyLinear = tasks.find(
    (task) => task.status === "ready" && task.mutation_mode === "linear_write",
  );
  if (readyLinear) {
    return [`Start one linear_write task: ${readyLinear.id}.`];
  }

  const readySidecar = tasks.find(
    (task) => task.status === "ready" && task.mutation_mode !== "linear_write",
  );
  if (readySidecar) {
    return [`Run or assign sidecar task ${readySidecar.id}; it should not mutate code.`];
  }

  if (spec.status === "draft") return ["Run supermission plan and review the generated plan."];
  if (spec.status === "planned") return ["Approve or revise the plan before implementation."];
  if (spec.status === "validated") return ["Create review evidence, checkpoint, and handoff."];
  if (spec.status === "completed") return ["Archive or inspect work records as needed."];
  return ["Continue the current work workflow."];
}

function matchesScope(file: string, pattern: string): boolean {
  return minimatch(file, pattern, { dot: true });
}

function appendUnique(existing: string[], next: string[]): { values: string[]; added: string[] } {
  const values = [...existing];
  const seen = new Set(existing);
  const added: string[] = [];

  for (const value of next) {
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    added.push(value);
  }

  return { values, added };
}

function formatAddedList(label: string, values: string[]): string[] {
  return [
    `${label}:`,
    ...(values.length > 0 ? values.map((value) => `- ${value}`) : ["- None"]),
    "",
  ];
}

function findRequirementIssues(
  acceptance: string[],
  validationCommands: string[],
): RequirementFinding[] {
  const findings: RequirementFinding[] = [];
  const normalized = acceptance.map((item) => item.trim()).filter(Boolean);
  if (normalized.length === 0) {
    findings.push({
      id: nextRequirementFindingId(findings),
      type: "incompleteness",
      severity: "blocking",
      message: "No acceptance criteria are defined.",
      question: "Should the work be blocked until testable acceptance criteria are added?",
      options: ["Add acceptance criteria before planning", "Proceed with explicit human approval"],
    });
  }

  for (const requirement of normalized) {
    const lower = requirement.toLowerCase();
    if (/\b(fast|quick|easy|nice|simple|robust|secure|intuitive|good|better)\b/i.test(lower)) {
      findings.push({
        id: nextRequirementFindingId(findings),
        type: "ambiguity",
        severity: "warning",
        requirement,
        message: "The requirement uses qualitative language without a measurable threshold.",
        question: "Which clarification should be made before implementation?",
        options: ["Add a measurable threshold", "Keep as product guidance only"],
      });
    }
    if (
      /\b(use|implement with|built with|using)\s+(react|sqlite|postgres|redis|zod|yaml|json|langgraph|playwright|bun|node)\b/i.test(
        lower,
      )
    ) {
      findings.push({
        id: nextRequirementFindingId(findings),
        type: "implementation_leak",
        severity: "info",
        requirement,
        message: "The requirement includes implementation detail that may belong in design.",
        question: "Should this be treated as a hard constraint?",
        options: ["Move it to design constraints", "Keep it as acceptance criteria"],
      });
    }
    if (!hasObservableOutcome(requirement)) {
      findings.push({
        id: nextRequirementFindingId(findings),
        type: "wrong_level_of_detail",
        severity: "warning",
        requirement,
        message: "The requirement does not clearly name an observable outcome.",
        question: "How should this be made testable?",
        options: ["Rewrite as observable user/system behavior", "Attach a manual review rubric"],
      });
    }
  }

  for (let index = 0; index < normalized.length; index += 1) {
    for (let other = index + 1; other < normalized.length; other += 1) {
      const first = normalized[index] ?? "";
      const second = normalized[other] ?? "";
      if (requirementsConflict(first, second)) {
        findings.push({
          id: nextRequirementFindingId(findings),
          type: "inconsistency",
          severity: "blocking",
          requirement: `${first} / ${second}`,
          message: "Two acceptance criteria appear to conflict.",
          question: "Which behavior should be authoritative?",
          options: ["Keep the first behavior", "Keep the second behavior"],
        });
      }
    }
  }

  if (validationCommands.length === 0) {
    findings.push({
      id: nextRequirementFindingId(findings),
      type: "incompleteness",
      severity: "warning",
      message: "No validation command is configured for this work.",
      question: "How should completion be verified?",
      options: ["Add an automated validation command", "Require manual review evidence"],
    });
  }

  return findings;
}

function hasObservableOutcome(requirement: string): boolean {
  return /\b(show|display|return|write|record|create|update|delete|reject|allow|block|fail|pass|validate|emit|log|open|close|complete|finish|生成|显示|记录|创建|更新|删除|拒绝|允许|阻断|验证|通过|失败)\b/i.test(
    requirement,
  );
}

function requirementsConflict(first: string, second: string): boolean {
  const firstLower = first.toLowerCase();
  const secondLower = second.toLowerCase();
  return (
    (/\bmust\b|\brequire|required|always/.test(firstLower) &&
      /\bmust not\b|\bnever\b|\bforbid|禁止|不能|不允许/.test(secondLower) &&
      shareSignificantTerm(firstLower, secondLower)) ||
    (/\bmust\b|\brequire|required|always/.test(secondLower) &&
      /\bmust not\b|\bnever\b|\bforbid|禁止|不能|不允许/.test(firstLower) &&
      shareSignificantTerm(firstLower, secondLower))
  );
}

function shareSignificantTerm(first: string, second: string): boolean {
  const stop = new Set([
    "the",
    "and",
    "or",
    "a",
    "an",
    "to",
    "of",
    "in",
    "for",
    "with",
    "must",
    "not",
    "never",
    "always",
    "should",
    "shall",
    "user",
    "system",
  ]);
  const firstTerms = new Set(
    first.split(/[^a-z0-9_-]+/).filter((term) => term.length >= 4 && !stop.has(term)),
  );
  return second
    .split(/[^a-z0-9_-]+/)
    .some((term) => term.length >= 4 && !stop.has(term) && firstTerms.has(term));
}

function nextRequirementFindingId(findings: RequirementFinding[]): string {
  return `req-${String(findings.length + 1).padStart(3, "0")}`;
}

function formatRequirementsAnalysis(
  work: WorkSpec,
  actor: string,
  findings: RequirementFinding[],
): string {
  const lines = [
    "# Requirements Analysis",
    "",
    `Work: ${work.id}`,
    `Goal: ${work.goal}`,
    `Analyst: ${actor}`,
    `Created at: ${utcNow()}`,
    "",
    "## Summary",
    "",
    `- Acceptance criteria: ${work.acceptance.length}`,
    `- Validation commands: ${work.validation_commands.length}`,
    `- Findings: ${findings.length}`,
    `- Blocking: ${findings.filter((finding) => finding.severity === "blocking").length}`,
    `- Warning: ${findings.filter((finding) => finding.severity === "warning").length}`,
    "",
    "## Findings",
    "",
  ];

  if (findings.length === 0) {
    lines.push("- None");
  } else {
    for (const finding of findings) {
      lines.push(
        `### ${finding.id} ${finding.severity.toUpperCase()} ${finding.type}`,
        "",
        finding.requirement ? `Requirement: ${finding.requirement}` : "Requirement: work-level",
        "",
        finding.message,
        "",
        `Question: ${finding.question}`,
        "",
        `- Option A: ${finding.options[0]}`,
        `- Option B: ${finding.options[1]}`,
        "",
      );
    }
  }

  lines.push(
    "",
    "## Method",
    "",
    "This first pass is deterministic. It checks for missing acceptance criteria,",
    "missing validation commands, qualitative wording, implementation-detail leakage,",
    "non-observable outcomes, and simple explicit conflicts. Future versions may add",
    "LLM rewriting plus SMT/formal checks for stronger requirement proofs.",
  );

  return `${lines.join("\n")}\n`;
}

async function changedGitFiles(repo: string): Promise<string[]> {
  const output = await gitOutput(repo, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const files = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(parsePorcelainPath)
    .filter((file) => file.length > 0 && !file.startsWith(`${WORK_ROOT}/`));
  return [...new Set(files)].sort();
}

function parsePorcelainPath(line: string): string {
  const raw = line.slice(3);
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  return stripPorcelainQuotes(renamed ?? raw);
}

function stripPorcelainQuotes(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\"/g, '"');
  }
  return path;
}

async function captureWorkspaceDiff(repo: string): Promise<string> {
  const tracked = await gitOutput(repo, [
    "diff",
    "--binary",
    "--",
    ".",
    `:(exclude)${WORK_ROOT}/**`,
  ]);
  const untracked = await captureUntrackedFilesDiff(repo, await untrackedGitFiles(repo));
  return joinDiffParts([tracked, untracked]);
}

async function captureFilesDiff(repo: string, files: string[]): Promise<string> {
  const tracked = await gitOutput(repo, ["diff", "--binary", "--", ...files]);
  const untracked = new Set(await untrackedGitFiles(repo));
  const scopedUntracked = files.filter((file) => untracked.has(file));
  const untrackedDiff = await captureUntrackedFilesDiff(repo, scopedUntracked);
  return joinDiffParts([tracked, untrackedDiff]);
}

async function nextRecordId(path: string, prefix: string): Promise<string> {
  const records = await readJsonl<Record<string, unknown>>(path);
  return `${prefix}-${String(records.length + 1).padStart(6, "0")}`;
}

function defaultGateForChange(type: ChangeType): string {
  switch (type) {
    case "api_contract":
      return "approve_api_change";
    case "data_schema":
      return "approve_schema_change";
    case "architecture":
      return "approve_architecture_change";
    case "security":
      return "approve_security_change";
    case "environment":
      return "approve_env_change";
    case "ui_ux":
      return "approve_ui_change";
    default:
      return "approve_plan_revision";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function classifyCommandRisk(command: string): { risky: boolean; reason: string } {
  const patterns: Array<[RegExp, string]> = [
    [/\brm\s+(-[^\s]*r|-[^\s]*f|-[^\s]*rf|-[^\s]*fr)\b/, "recursive or force remove command"],
    [/\bgit\s+reset\s+--hard\b/, "hard git reset"],
    [/\bgit\s+clean\b.*\s-[^\s]*f/, "force git clean"],
    [/\bsudo\b/, "sudo command"],
    [/\bdd\s+.*\bof=/, "dd writes raw output"],
    [/\bmkfs(\.| |$)/, "filesystem formatting command"],
    [/\bdrop\s+database\b/i, "database drop command"],
    [/\btruncate\s+table\b/i, "table truncate command"],
    [/\bdocker\s+system\s+prune\b/, "docker system prune"],
    [/\bkubectl\s+delete\b/, "kubernetes delete command"],
  ];
  for (const [pattern, reason] of patterns) {
    if (pattern.test(command)) return { risky: true, reason };
  }
  return { risky: false, reason: "" };
}

function validationCommandAllowed(command: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.some((pattern) => {
    return command.startsWith(pattern) || minimatch(command, pattern, { dot: true });
  });
}

async function runShell(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function untrackedGitFiles(repo: string): Promise<string[]> {
  const output = await gitOutput(repo, ["ls-files", "--others", "--exclude-standard"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(`${WORK_ROOT}/`))
    .sort();
}

async function captureUntrackedFilesDiff(repo: string, files: string[]): Promise<string> {
  const diffs: string[] = [];
  for (const file of files) {
    diffs.push(
      await gitOutput(repo, ["diff", "--no-index", "--binary", "--", "/dev/null", file], [0, 1]),
    );
  }
  return joinDiffParts(diffs);
}

function joinDiffParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(parts.length > 1 ? "\n" : "");
}

async function gitOutput(repo: string, args: string[], allowedExitCodes = [0]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (allowedExitCodes.includes(code ?? 1)) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

function sanitizeId(id: string): string {
  // Prevent path traversal: strip .., /, \, and null bytes
  const sanitized = id
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "-")
    .replace(/\0/g, "")
    .replace(/^-+|-+$/g, "")
    .trim();
  if (sanitized.length === 0) {
    throw new Error("invalid work id: must contain at least one valid character");
  }
  if (sanitized.length > 128) {
    throw new Error("invalid work id: must be 128 characters or fewer");
  }
  return sanitized;
}
