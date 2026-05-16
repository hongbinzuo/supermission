#!/usr/bin/env bun
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  executeRunner,
  listCcSwitchRunnerProfiles,
  RUNNER_REGISTRY,
  RunnerBackendSchema,
  type RunnerBackend,
  type RunnerBackendConfig,
  type RunnerConfig,
  type RunnerOptions,
} from "./runner.js";
import { redactSecrets } from "./redaction.js";
import { MissionStore } from "./store.js";
import { ChangeTypeSchema, TaskStatusSchema } from "./types.js";

type GlobalOptions = {
  repo: string;
};

type RunnerCliOptions = {
  backend?: RunnerBackend;
  command?: string;
  prompt?: string;
  model?: string;
  profile?: string;
  fallbackProfile: string[];
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  tool: string[];
  timeoutMs?: number;
};

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const program = new Command();
  program
    .name("mission")
    .description("Mission Control for AI Coding")
    .option("--repo <path>", "Repository root", ".")
    .showHelpAfterError();

  program
    .command("new")
    .description("Create a mission record")
    .argument("<goal...>", "Mission goal")
    .option("--id <id>", "Explicit mission id")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--acceptance <item>", "Acceptance criterion", collect, [])
    .option("--validation <command>", "Validation command", collect, [])
    .action(async (goalParts: string[], options: NewOptions) => {
      const store = storeFrom(program);
      const missionId = await store.createMission({
        id: options.id,
        goal: goalParts.join(" "),
        actor: options.actor,
        acceptance: options.acceptance,
        validationCommands: options.validation,
      });
      console.log(missionId);
    });

  program
    .command("plan")
    .description("Generate an initial plan artifact")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "planner-agent")
    .option("--note <note>", "Planning note")
    .action(async (missionId: string, options: { actor: string; note?: string }) => {
      await storeFrom(program).writePlan(missionId, options.actor, options.note);
      console.log(`planned ${missionId}`);
    });

  program
    .command("approve")
    .description("Approve a gate")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--gate <gate>", "Gate id", "approve_plan")
    .option("--reason <reason>", "Approval reason")
    .action(
      async (missionId: string, options: { actor: string; gate: string; reason?: string }) => {
        await storeFrom(program).approve(missionId, options.actor, options.gate, options.reason);
        console.log(`approved ${options.gate} for ${missionId}`);
      },
    );

  const runnerCommand = program.command("runner").description("Inspect runner backends");
  runnerCommand
    .command("list")
    .description("List available runner backends")
    .action(() => {
      for (const runner of RUNNER_REGISTRY) {
        const profile =
          runner.profileSource === "cc-switch-or-native"
            ? " profiles=cc-switch-or-native"
            : runner.profileSource
              ? ` profiles=${runner.profileSource}`
              : "";
        console.log(`${runner.backend} ${runner.kind}${profile} - ${runner.label}`);
      }
    });

  runnerCommand
    .command("profiles")
    .description("List configured runner profiles without printing secrets")
    .option("--backend <backend>", "codex | claude")
    .action(async (options: { backend?: string }) => {
      const backend = parseProfileBackend(options.backend);
      const profiles = await listCcSwitchRunnerProfiles(backend);
      if (profiles.length === 0) {
        console.log("no cc-switch profiles found");
        return;
      }
      for (const profile of profiles) {
        const current = profile.current ? " current" : "";
        console.log(`${profile.backend} ${profile.name}${current} source=${profile.source}`);
      }
    });

  const runnerConfigCommand = runnerCommand.command("config").description("Manage runner config");
  runnerConfigCommand
    .command("show")
    .description("Show .missions/runners.yaml or the default runner config")
    .action(async () => {
      console.log(YAML.stringify(await storeFrom(program).readRunnerConfig()).trimEnd());
    });

  runnerConfigCommand
    .command("init")
    .description("Write .missions/runners.yaml")
    .option("--default-backend <backend>", "Default backend", parseRunnerBackend, "record")
    .option("--command <command>", "Default shell command for the selected backend")
    .option("--prompt <prompt>", "Default prompt for the selected backend")
    .option("--model <model>", "Default model for the selected backend")
    .option("--profile <profile>", "Default profile for the selected backend")
    .option(
      "--fallback-profile <profile>",
      "Fallback profile for the selected backend",
      collect,
      [],
    )
    .option("--sandbox <mode>", "Default Codex sandbox mode")
    .option("--permission-mode <mode>", "Default Claude permission mode")
    .option("--tool <tool>", "Default allowed tool for model runners", collect, [])
    .option("--timeout-ms <ms>", "Default runner timeout in milliseconds", parseInteger)
    .action(
      async (options: {
        defaultBackend: RunnerBackend;
        command?: string;
        prompt?: string;
        model?: string;
        profile?: string;
        fallbackProfile: string[];
        sandbox?: string;
        permissionMode?: string;
        tool: string[];
        timeoutMs?: number;
      }) => {
        const backendConfig: RunnerBackendConfig = {
          ...(options.command ? { command: options.command } : {}),
          ...(options.prompt ? { prompt: options.prompt } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.profile ? { profile: options.profile } : {}),
          fallback_profiles: options.fallbackProfile,
          ...(options.sandbox ? { sandbox: parseSandbox(options.sandbox) } : {}),
          ...(options.permissionMode
            ? { permission_mode: parsePermissionMode(options.permissionMode) }
            : {}),
          tools: options.tool,
          ...(options.timeoutMs ? { timeout_ms: options.timeoutMs } : {}),
        };
        const config = defaultRunnerConfig(options.defaultBackend);
        config.backends[options.defaultBackend] = backendConfig;
        const written = await storeFrom(program).writeRunnerConfig(config);
        console.log(YAML.stringify(written).trimEnd());
      },
    );

  runnerCommand
    .command("smoke")
    .description("Run a backend smoke test without creating a mission")
    .option("--backend <backend>", "record | shell | codex | claude", parseRunnerBackend)
    .option("--command <command>", "Shell command for shell runner")
    .option("--prompt <prompt>", "Smoke prompt", "Reply only with runner-smoke-ok.")
    .option("--model <model>", "Runner model override")
    .option("--profile <profile>", "Runner profile override")
    .option(
      "--fallback-profile <profile>",
      "Additional profile to try if the first profile fails",
      collect,
      [],
    )
    .option("--sandbox <mode>", "Codex sandbox mode", parseSandbox)
    .option("--permission-mode <mode>", "Claude permission mode", parsePermissionMode)
    .option("--tool <tool>", "Allowed tool for model runners", collect, [])
    .option("--timeout-ms <ms>", "Runner process timeout in milliseconds", parseInteger)
    .action(async (options: RunnerCliOptions) => {
      const store = storeFrom(program);
      const runnerConfig = await store.readRunnerConfig();
      const backend = options.backend ?? runnerConfig.default_backend;
      const mergedOptions = mergeRunnerOptions(runnerConfig, backend, options);
      if (backend === "shell" && !mergedOptions.command) {
        throw new Error("shell runner requires --command");
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const execution = await executeRunner(
        backend,
        {
          repo: store.repo,
          actor: "runner-smoke",
          mission: {
            id: "runner-smoke",
            goal: "Runner smoke test",
            status: "approved",
            owner: "local-user",
            created_at: now,
            updated_at: now,
            acceptance: ["Runner returns a successful response"],
            validation_commands: [],
            workflow: ["run"],
            actors: ["runner-smoke"],
          },
        },
        mergedOptions,
      );
      const policy = await store.readPolicy();
      console.log(`${backend} smoke exit ${execution.exitCode} (${execution.durationMs}ms)`);
      if (execution.response) {
        console.log(redactSecrets(execution.response, policy.redaction.patterns).trimEnd());
      }
      if (execution.exitCode !== 0 && execution.stderr.trim().length > 0) {
        console.error(redactSecrets(execution.stderr, policy.redaction.patterns).trimEnd());
      }
      process.exitCode = execution.exitCode === 0 ? 0 : execution.exitCode;
    });

  program
    .command("run")
    .description("Record a V0 sequential implementation run")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "worker-agent")
    .option("--note <note>", "Run note")
    .option("--backend <backend>", "record | shell | codex | claude", parseRunnerBackend)
    .option("--command <command>", "Shell command for shell runner")
    .option("--prompt <prompt>", "Prompt for runner backends")
    .option("--model <model>", "Runner model override")
    .option("--profile <profile>", "Runner profile override")
    .option(
      "--fallback-profile <profile>",
      "Additional profile to try if the first profile fails",
      collect,
      [],
    )
    .option("--sandbox <mode>", "Codex sandbox mode", parseSandbox)
    .option("--permission-mode <mode>", "Claude permission mode", parsePermissionMode)
    .option("--tool <tool>", "Allowed tool for model runners", collect, [])
    .option("--timeout-ms <ms>", "Runner process timeout in milliseconds", parseInteger)
    .action(
      async (
        missionId: string,
        options: RunnerCliOptions & {
          actor: string;
          note?: string;
        },
      ) => {
        const store = storeFrom(program);
        const runnerConfig = await store.readRunnerConfig();
        const backend = options.backend ?? runnerConfig.default_backend;
        const mergedOptions = mergeRunnerOptions(runnerConfig, backend, options);

        if (backend === "record") {
          await store.recordRun(missionId, options.actor, options.note);
          console.log(`recorded run for ${missionId}`);
          return;
        }

        let startedRun = false;
        try {
          if (backend === "shell" && !mergedOptions.command) {
            throw new Error("shell runner requires --command");
          }
          const spec = await store.beginRun(missionId, options.actor);
          startedRun = true;
          const execution = await executeRunner(
            backend,
            {
              repo: store.repo,
              mission: spec,
              actor: options.actor,
              note: options.note,
            },
            mergedOptions,
          );
          await store.recordRunnerExecution(missionId, options.actor, execution);
          console.log(
            `${backend} runner ${missionId} exit ${execution.exitCode} (${execution.durationMs}ms)`,
          );
          process.exitCode = execution.exitCode === 0 ? 0 : execution.exitCode;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (startedRun) {
            try {
              await store.updateStatus(missionId, "failed", options.actor, message);
              await store.writeDebug(missionId, options.actor, message);
            } catch {
              // Ignore secondary cleanup errors.
            }
          }
          console.error(message);
          process.exitCode = 1;
        }
      },
    );

  program
    .command("validate")
    .description("Run validation commands")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "validator-agent")
    .option("--cmd <command>", "Override validation command", collect, [])
    .option("--allow-risky", "Allow validation commands flagged by the risky command policy")
    .action(
      async (
        missionId: string,
        options: { actor: string; cmd: string[]; allowRisky?: boolean },
      ) => {
        const result = await storeFrom(program).validate(missionId, options.actor, {
          commands: options.cmd,
          allowRisky: options.allowRisky,
        });
        process.exitCode = result.exitCode === 0 ? 0 : result.exitCode;
      },
    );

  program
    .command("status")
    .description("Show mission status or list missions")
    .argument("[mission-id]")
    .action(async (missionId?: string) => {
      const store = storeFrom(program);
      if (missionId) {
        const spec = await store.readMission(missionId);
        console.log(`${spec.id} ${spec.status} - ${spec.goal}`);
        return;
      }
      const ids = await store.listMissionIds();
      if (ids.length === 0) {
        console.log("No missions found.");
        return;
      }
      for (const id of ids) {
        const spec = await store.readMission(id);
        console.log(`${spec.id} ${spec.status} - ${spec.goal}`);
      }
    });

  program
    .command("summary")
    .description("Show a compact mission summary for human review")
    .argument("<mission-id>")
    .option("--json", "Print JSON")
    .action(async (missionId: string, options: { json?: boolean }) => {
      const summary = await storeFrom(program).summarizeMission(missionId);
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      console.log(`${summary.id} ${summary.status}`);
      console.log(summary.goal);
      console.log("");
      console.log(`Validation commands: ${summary.validation_commands}`);
      console.log(`Tasks: ${summary.tasks}`);
      console.log(`Changes: ${summary.changes.total} total, ${summary.changes.pending} pending`);
      console.log(`Checkpoints: ${summary.checkpoints}`);
      console.log("");
      console.log("Findings:");
      for (const finding of summary.findings) {
        console.log(`- ${finding.severity} ${finding.code}: ${finding.message}`);
      }
      console.log("");
      console.log("Artifacts:");
      for (const [name, path] of Object.entries(summary.artifacts)) {
        console.log(`- ${name}: ${path}`);
      }
    });

  program
    .command("doctor")
    .description("Diagnose mission health and next actions")
    .argument("<mission-id>")
    .option("--json", "Print JSON")
    .action(async (missionId: string, options: { json?: boolean }) => {
      const findings = await storeFrom(program).diagnoseMission(missionId);
      const hasBlocking = findings.some((finding) => finding.severity === "blocking");
      if (options.json) {
        console.log(JSON.stringify(findings, null, 2));
        if (hasBlocking) process.exitCode = 1;
        return;
      }
      for (const finding of findings) {
        console.log(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
        console.log(`Next: ${finding.next}`);
      }
      if (hasBlocking) {
        process.exitCode = 1;
      }
    });

  const policy = program.command("policy").description("Manage project mission policy");

  policy
    .command("show")
    .description("Show .missions/policy.yaml or the default policy")
    .action(async () => {
      console.log(YAML.stringify(await storeFrom(program).readPolicy()).trimEnd());
    });

  policy
    .command("init")
    .description("Write .missions/policy.yaml")
    .option("--validation-allow <pattern>", "Allowed validation command pattern", collect, [])
    .option(
      "--redaction-pattern <pattern>",
      "Regex pattern to redact from validation output",
      collect,
      [],
    )
    .action(async (options: { validationAllow: string[]; redactionPattern: string[] }) => {
      const written = await storeFrom(program).writePolicy({
        validation_allowlist: options.validationAllow,
        redaction: { patterns: options.redactionPattern },
      });
      console.log(YAML.stringify(written).trimEnd());
    });

  program
    .command("monitor")
    .description("Generate a mission monitoring report")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "supervisor-agent")
    .option("--json", "Print JSON without writing monitor.md")
    .action(async (missionId: string, options: { actor: string; json?: boolean }) => {
      const store = storeFrom(program);
      if (options.json) {
        console.log(JSON.stringify(await store.monitorMission(missionId), null, 2));
        return;
      }
      console.log((await store.writeMonitor(missionId, options.actor)).trimEnd());
    });

  program
    .command("tasks")
    .description("List mission tasks")
    .argument("<mission-id>")
    .action(async (missionId: string) => {
      const tasks = await storeFrom(program).listTasks(missionId);
      for (const task of tasks) {
        console.log(`${task.id} ${task.status} ${task.actor_role} - ${task.title}`);
      }
    });

  const task = program.command("task").description("Manage mission task ledger");

  task
    .command("add")
    .description("Add a task to the mission ledger without executing it")
    .argument("<mission-id>")
    .requiredOption("--title <title>", "Task title")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--actor-role <role>", "Responsible actor role", "worker-agent")
    .option(
      "--mutation-mode <mode>",
      "sidecar_readonly | sidecar_artifact | linear_write",
      "sidecar_artifact",
    )
    .option("--depends-on <task-id>", "Task dependency", collect, [])
    .option("--scope-allow <pattern>", "Allowed scope pattern", collect, [])
    .option("--scope-deny <pattern>", "Denied scope pattern", collect, [])
    .option("--validation <command>", "Validation command", collect, [])
    .action(async (missionId: string, options: TaskAddOptions) => {
      const mutationMode = parseMutationMode(options.mutationMode);
      const created = await storeFrom(program).addTask(missionId, {
        actor: options.actor,
        title: options.title,
        actorRole: options.actorRole,
        mutationMode,
        dependsOn: options.dependsOn,
        scopeAllow: options.scopeAllow,
        scopeDeny: options.scopeDeny,
        validation: options.validation,
      });
      console.log(`${created.id} ${created.status} ${created.mutation_mode} - ${created.title}`);
    });

  task
    .command("set-status")
    .description("Set task status")
    .argument("<mission-id>")
    .argument("<task-id>")
    .requiredOption(
      "--status <status>",
      "pending | ready | running | needs_review | done | blocked | failed",
    )
    .option("--actor <actor>", "Actor id", "local-user")
    .action(async (missionId: string, taskId: string, options: TaskSetStatusOptions) => {
      const status = TaskStatusSchema.parse(options.status);
      const updated = await storeFrom(program).setTaskStatus(
        missionId,
        taskId,
        status,
        options.actor,
      );
      console.log(`${updated.id} ${updated.status}`);
    });

  task
    .command("audit-scope")
    .description("Audit current git changes against one task scope")
    .argument("<mission-id>")
    .argument("<task-id>")
    .option("--actor <actor>", "Actor id", "supervisor-agent")
    .option("--json", "Print JSON")
    .action(
      async (missionId: string, taskId: string, options: { actor: string; json?: boolean }) => {
        const result = await storeFrom(program).auditTaskScope(missionId, taskId, options.actor);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          `scope audit ${result.task}: ${result.changed_files.length} changed, ${result.violations.length} violation(s)`,
        );
        if (result.violations.length > 0) {
          for (const violation of result.violations) {
            console.log(`- ${violation.reason}: ${violation.file}`);
          }
        }
      },
    );

  program
    .command("diff")
    .description("Capture current git diff into patch.diff")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--task <task-id>", "Capture only the patch inside one task scope")
    .action(async (missionId: string, options: { actor: string; task?: string }) => {
      const diff = await storeFrom(program).captureDiff(missionId, options.actor, {
        taskId: options.task,
      });
      console.log(`captured patch.diff (${Buffer.byteLength(diff)} bytes)`);
    });

  const checkpoint = program
    .command("checkpoint")
    .description("Manage non-destructive checkpoints");

  checkpoint
    .command("create")
    .description("Capture current git diff as a checkpoint")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--label <label>", "Checkpoint label", "manual checkpoint")
    .option("--task <task-id>", "Capture only the patch inside one task scope")
    .action(async (missionId: string, options: { actor: string; label: string; task?: string }) => {
      const created = await storeFrom(program).createCheckpoint(
        missionId,
        options.actor,
        options.label,
        { taskId: options.task },
      );
      console.log(`${created.id} ${created.base_ref} - ${created.label}`);
    });

  checkpoint
    .command("list")
    .description("List mission checkpoints")
    .argument("<mission-id>")
    .action(async (missionId: string) => {
      const checkpoints = await storeFrom(program).listCheckpoints(missionId);
      for (const checkpoint of checkpoints) {
        console.log(
          `${checkpoint.id} ${checkpoint.base_ref} ${checkpoint.created_at} - ${checkpoint.label}`,
        );
      }
    });

  const branch = program.command("branch").description("Manage mission git branches");

  branch
    .command("create")
    .description("Create a mission branch without checking it out")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--name <branch>", "Branch name override")
    .action(async (missionId: string, options: { actor: string; name?: string }) => {
      const isolation = await storeFrom(program).createBranch(missionId, {
        actor: options.actor,
        branch: options.name,
      });
      console.log(`branch ${isolation.branch}`);
    });

  const worktree = program.command("worktree").description("Manage mission git worktrees");

  worktree
    .command("create")
    .description("Create a mission worktree at an explicit path")
    .argument("<mission-id>")
    .requiredOption("--path <path>", "Worktree path")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--branch <branch>", "Branch name override")
    .action(
      async (missionId: string, options: { path: string; actor: string; branch?: string }) => {
        const isolation = await storeFrom(program).createWorktree(missionId, {
          actor: options.actor,
          path: options.path,
          branch: options.branch,
        });
        console.log(`worktree ${isolation.branch} ${isolation.worktree_path}`);
      },
    );

  program
    .command("rollback-plan")
    .description("Generate a non-destructive rollback plan")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--checkpoint <checkpoint-id>", "Checkpoint id")
    .action(async (missionId: string, options: { actor: string; checkpoint?: string }) => {
      await storeFrom(program).writeRollbackPlan(missionId, options.actor, options.checkpoint);
      console.log(`rollback-plan.md written for ${missionId}`);
    });

  program
    .command("rollback-check")
    .description("Check whether a checkpoint patch can be reversed cleanly")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--checkpoint <checkpoint-id>", "Checkpoint id")
    .action(async (missionId: string, options: { actor: string; checkpoint?: string }) => {
      const result = await storeFrom(program).checkRollback(
        missionId,
        options.actor,
        options.checkpoint,
      );
      console.log(result.message);
      if (!result.ok) process.exitCode = 1;
    });

  const change = program.command("change").description("Manage controlled change proposals");

  change
    .command("propose")
    .description("Propose a controlled mission change")
    .argument("<mission-id>")
    .requiredOption("--reason <reason>", "Reason for the change")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--source <kind>", "human | agent | validation | review | system", "human")
    .option("--type <type>", "Change type", "workflow")
    .option("--risk <risk>", "low | medium | high", "medium")
    .option("--affected <item>", "Affected artifact, scope, or area", collect, [])
    .option("--option <option>", "Decision option", collect, [])
    .option("--recommendation <recommendation>", "Recommended option")
    .option("--gate <gate>", "Required gate override")
    .action(async (missionId: string, options: ChangeProposeOptions) => {
      const type = ChangeTypeSchema.parse(options.type);
      const risk = parseRisk(options.risk);
      const sourceKind = parseSourceKind(options.source);
      const proposal = await storeFrom(program).proposeChange(missionId, {
        actor: options.actor,
        sourceKind,
        type,
        risk,
        reason: options.reason,
        affected: options.affected,
        options: options.option,
        recommendation: options.recommendation,
        requiresGate: options.gate,
      });
      console.log(`${proposal.id} proposed (${proposal.type}, ${proposal.risk})`);
    });

  change
    .command("list")
    .description("List mission change proposals")
    .argument("<mission-id>")
    .action(async (missionId: string) => {
      const changes = await storeFrom(program).listChanges(missionId);
      for (const proposal of changes) {
        console.log(
          `${proposal.id} ${proposal.status} ${proposal.type} ${proposal.risk} - ${proposal.reason}`,
        );
      }
    });

  change
    .command("show")
    .description("Show one change proposal")
    .argument("<mission-id>")
    .argument("<change-id>")
    .action(async (missionId: string, changeId: string) => {
      const proposal = await storeFrom(program).readChange(missionId, changeId);
      console.log(YAML.stringify(proposal).trimEnd());
    });

  change
    .command("apply")
    .description("Apply an approved change to mission.yaml")
    .argument("<mission-id>")
    .argument("<change-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--acceptance <item>", "Append acceptance criterion", collect, [])
    .option("--validation <command>", "Append validation command", collect, [])
    .option("--workflow-step <step>", "Append workflow step", collect, [])
    .option("--plan-note <note>", "Append controlled note to plan.md", collect, [])
    .option("--note <note>", "Application note")
    .action(async (missionId: string, changeId: string, options: ChangeApplyOptions) => {
      const result = await storeFrom(program).applyChange(missionId, changeId, {
        actor: options.actor,
        acceptance: options.acceptance,
        validationCommands: options.validation,
        workflowSteps: options.workflowStep,
        planNotes: options.planNote,
        note: options.note,
      });
      console.log(
        `${result.change.id} applied (acceptance +${result.added.acceptance.length}, validation +${result.added.validation_commands.length}, workflow +${result.added.workflow.length}, plan +${result.added.plan_notes.length})`,
      );
    });

  for (const status of ["approve", "reject", "defer", "split"] as const) {
    const storedStatus =
      status === "approve"
        ? "approved"
        : status === "reject"
          ? "rejected"
          : status === "defer"
            ? "deferred"
            : status;
    change
      .command(status)
      .description(`${status} a change proposal`)
      .argument("<mission-id>")
      .argument("<change-id>")
      .option("--actor <actor>", "Actor id", "local-user")
      .option("--reason <reason>", "Decision reason")
      .action(async (missionId: string, changeId: string, options: ChangeDecisionOptions) => {
        const proposal = await storeFrom(program).decideChange(
          missionId,
          changeId,
          storedStatus,
          options.actor,
          options.reason,
        );
        console.log(`${proposal.id} ${proposal.status}`);
      });
  }

  program
    .command("trace")
    .description("Show mission event timeline")
    .argument("<mission-id>")
    .action(async (missionId: string) => {
      const events = await storeFrom(program).readEvents(missionId);
      for (const event of events) {
        const details = ["from", "to", "gate", "artifact", "reason", "exit_code"]
          .filter((key) => event[key] !== undefined && event[key] !== "")
          .map((key) => `${key}=${String(event[key])}`)
          .join(" ");
        console.log(
          `${event.time} ${event.type} actor=${event.actor}${details ? ` ${details}` : ""}`,
        );
      }
    });

  program
    .command("logs")
    .description("Show validation and tool-call logs")
    .argument("<mission-id>")
    .action(async (missionId: string) => {
      const paths = storeFrom(program).paths(missionId);
      console.log(await readFile(paths.validationLog, "utf8").catch(() => ""));
      const toolCalls = await readFile(paths.toolCalls, "utf8").catch(() => "");
      if (toolCalls.trim().length > 0) {
        console.log("# Tool Calls\n");
        console.log(toolCalls.trimEnd());
      }
    });

  program
    .command("debug")
    .description("Generate and show debug artifact")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--reason <reason>", "Debug reason")
    .action(async (missionId: string, options: { actor: string; reason?: string }) => {
      const store = storeFrom(program);
      await store.writeDebug(missionId, options.actor, options.reason);
      console.log((await readFile(store.paths(missionId).debug, "utf8")).trimEnd());
    });

  const review = program.command("review").description("Manage review artifacts");

  review
    .command("create")
    .description("Create a review artifact from current mission evidence")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "reviewer-agent")
    .action(async (missionId: string, options: { actor: string }) => {
      await storeFrom(program).writeReview(missionId, options.actor);
      console.log(`review.md written for ${missionId}`);
    });

  program
    .command("inspect")
    .description("Inspect one JSONL record")
    .argument("<mission-id>")
    .argument("<stream>", "events | telemetry | tool-calls | supervisor")
    .argument("<selector>", "Zero-based record index or stable record id")
    .action(async (missionId: string, stream: string, selector: string) => {
      const store = storeFrom(program);
      const records: Array<Record<string, unknown>> | undefined =
        stream === "events"
          ? await store.readEvents(missionId)
          : stream === "telemetry"
            ? await store.readTelemetry(missionId)
            : stream === "tool-calls"
              ? await store.readToolCalls(missionId)
              : stream === "supervisor"
                ? await store.readSupervisorSignals(missionId)
                : undefined;
      if (!records) throw new Error(`unknown inspect stream: ${stream}`);
      const byId = records.find((record) => record.record_id === selector);
      if (byId) {
        console.log(JSON.stringify(byId, null, 2));
        return;
      }

      const parsedIndex = Number.parseInt(selector, 10);
      if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= records.length) {
        if (Number.isNaN(parsedIndex)) {
          throw new Error(`${stream} record id not found: ${selector}`);
        }
        throw new Error(`${stream} index out of range: ${selector}`);
      }
      console.log(JSON.stringify(records[parsedIndex], null, 2));
    });

  program
    .command("handoff")
    .description("Generate handoff artifact")
    .argument("<mission-id>")
    .option("--actor <actor>", "Actor id", "handoff-agent")
    .option("--no-complete", "Do not complete validated mission")
    .action(async (missionId: string, options: { actor: string; complete?: boolean }) => {
      await storeFrom(program).writeHandoff(missionId, options.actor, options.complete !== false);
      console.log(`handoff written for ${missionId}`);
    });

  await program.parseAsync(argv, { from: "user" });
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function storeFrom(program: Command): MissionStore {
  const options = program.opts<GlobalOptions>();
  return new MissionStore(options.repo);
}

type NewOptions = {
  id?: string;
  actor: string;
  acceptance: string[];
  validation: string[];
};

type ChangeProposeOptions = {
  reason: string;
  actor: string;
  source: string;
  type: string;
  risk: string;
  affected: string[];
  option: string[];
  recommendation?: string;
  gate?: string;
};

type ChangeDecisionOptions = {
  actor: string;
  reason?: string;
};

type ChangeApplyOptions = {
  actor: string;
  acceptance: string[];
  validation: string[];
  workflowStep: string[];
  planNote: string[];
  note?: string;
};

type TaskAddOptions = {
  title: string;
  actor: string;
  actorRole: string;
  mutationMode: string;
  dependsOn: string[];
  scopeAllow: string[];
  scopeDeny: string[];
  validation: string[];
};

type TaskSetStatusOptions = {
  status: string;
  actor: string;
};

function parseMutationMode(
  value: string,
): "sidecar_readonly" | "sidecar_artifact" | "linear_write" {
  if (value === "sidecar_readonly" || value === "sidecar_artifact" || value === "linear_write") {
    return value;
  }
  throw new Error(`invalid mutation mode: ${value}`);
}

function parseRisk(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`invalid risk: ${value}`);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid positive integer: ${value}`);
  }
  return parsed;
}

function parseRunnerBackend(value: string): RunnerBackend {
  return RunnerBackendSchema.parse(value);
}

function parseProfileBackend(value?: string): "codex" | "claude" | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude") return value;
  throw new Error(`invalid profile backend: ${value}`);
}

function parseSandbox(value: string): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new Error(`invalid sandbox mode: ${value}`);
}

function parsePermissionMode(
  value: string,
): "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan" {
  if (
    value === "acceptEdits" ||
    value === "auto" ||
    value === "bypassPermissions" ||
    value === "default" ||
    value === "dontAsk" ||
    value === "plan"
  ) {
    return value;
  }
  throw new Error(`invalid permission mode: ${value}`);
}

function defaultRunnerConfig(defaultBackend: RunnerBackend): RunnerConfig {
  return {
    default_backend: defaultBackend,
    backends: {
      record: { fallback_profiles: [], tools: [] },
      shell: { fallback_profiles: [], tools: [] },
      codex: { fallback_profiles: [], tools: [] },
      claude: { fallback_profiles: [], tools: [] },
    },
  };
}

function mergeRunnerOptions(
  config: RunnerConfig,
  backend: RunnerBackend,
  options: {
    note?: string;
    command?: string;
    prompt?: string;
    model?: string;
    profile?: string;
    fallbackProfile: string[];
    sandbox?: "read-only" | "workspace-write" | "danger-full-access";
    permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
    tool: string[];
    timeoutMs?: number;
  },
): RunnerOptions {
  const backendConfig = config.backends[backend];
  return {
    command: options.command ?? backendConfig.command,
    prompt: options.prompt ?? backendConfig.prompt ?? options.note,
    model: options.model ?? backendConfig.model,
    profile: options.profile ?? backendConfig.profile,
    fallbackProfiles:
      options.fallbackProfile.length > 0
        ? options.fallbackProfile
        : backendConfig.fallback_profiles,
    sandbox: options.sandbox ?? backendConfig.sandbox ?? "danger-full-access",
    permissionMode: options.permissionMode ?? backendConfig.permission_mode ?? "bypassPermissions",
    tools: options.tool.length > 0 ? options.tool : backendConfig.tools,
    timeoutMs: options.timeoutMs ?? backendConfig.timeout_ms,
  };
}

function parseSourceKind(value: string): "human" | "agent" | "validation" | "review" | "system" {
  if (
    value === "human" ||
    value === "agent" ||
    value === "validation" ||
    value === "review" ||
    value === "system"
  ) {
    return value;
  }
  throw new Error(`invalid source kind: ${value}`);
}

if (import.meta.main) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`mission: ${message}`);
    process.exitCode = 1;
  });
}
