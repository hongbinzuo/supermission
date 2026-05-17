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
import { WorkStore } from "./store.js";
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
  retryAttempts?: number;
  retryDelayMs?: number;
  retryExitCode: number[];
};

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const program = new Command();
  program
    .name("supermission")
    .description("local-first work records for AI-assisted software delivery")
    .option("--repo <path>", "Repository root", ".")
    .showHelpAfterError();

  program
    .command("new")
    .description("Create a work record")
    .argument("<goal...>", "Work goal")
    .option("--id <id>", "Explicit work id")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--acceptance <item>", "Acceptance criterion", collect, [])
    .option("--validation <command>", "Validation command", collect, [])
    .action(async (goalParts: string[], options: NewOptions) => {
      const store = storeFrom(program);
      const workId = await store.createWork({
        id: options.id,
        goal: goalParts.join(" "),
        actor: options.actor,
        acceptance: options.acceptance,
        validationCommands: options.validation,
      });
      console.log(workId);
    });

  program
    .command("plan")
    .description("Generate an initial plan artifact")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "planner-agent")
    .option("--note <note>", "Planning note")
    .action(async (workId: string, options: { actor: string; note?: string }) => {
      await storeFrom(program).writePlan(workId, options.actor, options.note);
      console.log(`planned ${workId}`);
    });

  const requirements = program
    .command("requirements")
    .description("Analyze work requirements before implementation");

  requirements
    .command("check")
    .description("Create requirements-analysis.md and report requirement quality findings")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "requirements-analyst")
    .option("--json", "Print JSON")
    .option("--block-on-findings", "Exit non-zero when blocking findings are present")
    .action(
      async (
        workId: string,
        options: { actor: string; json?: boolean; blockOnFindings?: boolean },
      ) => {
        const result = await storeFrom(program).analyzeRequirements(workId, options.actor);
        const blocking = result.findings.filter((finding) => finding.severity === "blocking");
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(
            `requirements ${workId}: ${result.findings.length} finding(s), ${blocking.length} blocking`,
          );
          for (const finding of result.findings) {
            console.log(`${finding.id} ${finding.severity} ${finding.type}: ${finding.message}`);
          }
          console.log(result.artifact);
        }
        if (options.blockOnFindings && blocking.length > 0) {
          process.exitCode = 1;
        }
      },
    );

  program
    .command("approve")
    .description("Approve a gate")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--gate <gate>", "Gate id", "approve_plan")
    .option("--reason <reason>", "Approval reason")
    .action(async (workId: string, options: { actor: string; gate: string; reason?: string }) => {
      await storeFrom(program).approve(workId, options.actor, options.gate, options.reason);
      console.log(`approved ${options.gate} for ${workId}`);
    });

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
    .description("Show .supermission/runners.yaml or the default runner config")
    .action(async () => {
      console.log(YAML.stringify(await storeFrom(program).readRunnerConfig()).trimEnd());
    });

  runnerConfigCommand
    .command("init")
    .description("Write .supermission/runners.yaml")
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
    .option("--retry-attempts <count>", "Default runner attempts", parseInteger)
    .option("--retry-delay-ms <ms>", "Delay between retry attempts", parseNonNegativeInteger)
    .option("--retry-exit-code <code>", "Exit code that should be retried", collectInteger, [])
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
        retryAttempts?: number;
        retryDelayMs?: number;
        retryExitCode: number[];
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
          retry: {
            attempts: options.retryAttempts ?? 1,
            delay_ms: options.retryDelayMs ?? 0,
            exit_codes: options.retryExitCode.length > 0 ? options.retryExitCode : [1, 124],
          },
        };
        const config = defaultRunnerConfig(options.defaultBackend);
        config.backends[options.defaultBackend] = backendConfig;
        const written = await storeFrom(program).writeRunnerConfig(config);
        console.log(YAML.stringify(written).trimEnd());
      },
    );

  runnerCommand
    .command("smoke")
    .description("Run a backend smoke test without creating a work")
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
    .option("--retry-attempts <count>", "Runner attempts", parseInteger)
    .option("--retry-delay-ms <ms>", "Delay between retry attempts", parseNonNegativeInteger)
    .option("--retry-exit-code <code>", "Exit code that should be retried", collectInteger, [])
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
          work: {
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
    .argument("<work-id>")
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
    .option("--retry-attempts <count>", "Runner attempts", parseInteger)
    .option("--retry-delay-ms <ms>", "Delay between retry attempts", parseNonNegativeInteger)
    .option("--retry-exit-code <code>", "Exit code that should be retried", collectInteger, [])
    .action(
      async (
        workId: string,
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
          await store.recordRun(workId, options.actor, options.note);
          console.log(`recorded run for ${workId}`);
          return;
        }

        let startedRun = false;
        try {
          if (backend === "shell" && !mergedOptions.command) {
            throw new Error("shell runner requires --command");
          }
          const spec = await store.beginRun(workId, options.actor);
          startedRun = true;
          const execution = await executeRunner(
            backend,
            {
              repo: store.repo,
              work: spec,
              actor: options.actor,
              note: options.note,
            },
            mergedOptions,
          );
          await store.recordRunnerExecution(workId, options.actor, execution);
          console.log(
            `${backend} runner ${workId} exit ${execution.exitCode} (${execution.durationMs}ms)`,
          );
          process.exitCode = execution.exitCode === 0 ? 0 : execution.exitCode;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (startedRun) {
            try {
              await store.updateStatus(workId, "failed", options.actor, message);
              await store.writeDebug(workId, options.actor, message);
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
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "validator-agent")
    .option("--cmd <command>", "Override validation command", collect, [])
    .option("--allow-risky", "Allow validation commands flagged by the risky command policy")
    .action(
      async (workId: string, options: { actor: string; cmd: string[]; allowRisky?: boolean }) => {
        const result = await storeFrom(program).validate(workId, options.actor, {
          commands: options.cmd,
          allowRisky: options.allowRisky,
        });
        process.exitCode = result.exitCode === 0 ? 0 : result.exitCode;
      },
    );

  program
    .command("status")
    .description("Show work status or list works")
    .argument("[work-id]")
    .action(async (workId?: string) => {
      const store = storeFrom(program);
      if (workId) {
        const spec = await store.readWork(workId);
        console.log(`${spec.id} ${spec.status} - ${spec.goal}`);
        return;
      }
      const ids = await store.listWorkIds();
      if (ids.length === 0) {
        console.log("No works found.");
        return;
      }
      for (const id of ids) {
        const spec = await store.readWork(id);
        console.log(`${spec.id} ${spec.status} - ${spec.goal}`);
      }
    });

  program
    .command("summary")
    .description("Show a compact work summary for human review")
    .argument("<work-id>")
    .option("--json", "Print JSON")
    .action(async (workId: string, options: { json?: boolean }) => {
      const summary = await storeFrom(program).summarizeWork(workId);
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
    .description("Diagnose work health and next actions")
    .argument("<work-id>")
    .option("--json", "Print JSON")
    .action(async (workId: string, options: { json?: boolean }) => {
      const findings = await storeFrom(program).diagnoseWork(workId);
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

  const policy = program.command("policy").description("Manage project work policy");

  policy
    .command("show")
    .description("Show .supermission/policy.yaml or the default policy")
    .action(async () => {
      console.log(YAML.stringify(await storeFrom(program).readPolicy()).trimEnd());
    });

  policy
    .command("init")
    .description("Write .supermission/policy.yaml")
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
    .description("Generate a work monitoring report")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "supervisor-agent")
    .option("--json", "Print JSON without writing monitor.md")
    .action(async (workId: string, options: { actor: string; json?: boolean }) => {
      const store = storeFrom(program);
      if (options.json) {
        console.log(JSON.stringify(await store.monitorWork(workId), null, 2));
        return;
      }
      console.log((await store.writeMonitor(workId, options.actor)).trimEnd());
    });

  program
    .command("tasks")
    .description("List work tasks")
    .argument("<work-id>")
    .action(async (workId: string) => {
      const tasks = await storeFrom(program).listTasks(workId);
      for (const task of tasks) {
        console.log(`${task.id} ${task.status} ${task.actor_role} - ${task.title}`);
      }
    });

  const task = program.command("task").description("Manage work task ledger");

  task
    .command("add")
    .description("Add a task to the work ledger without executing it")
    .argument("<work-id>")
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
    .action(async (workId: string, options: TaskAddOptions) => {
      const mutationMode = parseMutationMode(options.mutationMode);
      const created = await storeFrom(program).addTask(workId, {
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
    .argument("<work-id>")
    .argument("<task-id>")
    .requiredOption(
      "--status <status>",
      "pending | ready | running | needs_review | done | blocked | failed",
    )
    .option("--actor <actor>", "Actor id", "local-user")
    .action(async (workId: string, taskId: string, options: TaskSetStatusOptions) => {
      const status = TaskStatusSchema.parse(options.status);
      const updated = await storeFrom(program).setTaskStatus(workId, taskId, status, options.actor);
      console.log(`${updated.id} ${updated.status}`);
    });

  task
    .command("audit-scope")
    .description("Audit current git changes against one task scope")
    .argument("<work-id>")
    .argument("<task-id>")
    .option("--actor <actor>", "Actor id", "supervisor-agent")
    .option("--json", "Print JSON")
    .action(async (workId: string, taskId: string, options: { actor: string; json?: boolean }) => {
      const result = await storeFrom(program).auditTaskScope(workId, taskId, options.actor);
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
    });

  program
    .command("diff")
    .description("Capture current git diff into patch.diff")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--task <task-id>", "Capture only the patch inside one task scope")
    .action(async (workId: string, options: { actor: string; task?: string }) => {
      const diff = await storeFrom(program).captureDiff(workId, options.actor, {
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
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--label <label>", "Checkpoint label", "manual checkpoint")
    .option("--task <task-id>", "Capture only the patch inside one task scope")
    .action(async (workId: string, options: { actor: string; label: string; task?: string }) => {
      const created = await storeFrom(program).createCheckpoint(
        workId,
        options.actor,
        options.label,
        { taskId: options.task },
      );
      console.log(`${created.id} ${created.base_ref} - ${created.label}`);
    });

  checkpoint
    .command("list")
    .description("List work checkpoints")
    .argument("<work-id>")
    .action(async (workId: string) => {
      const checkpoints = await storeFrom(program).listCheckpoints(workId);
      for (const checkpoint of checkpoints) {
        console.log(
          `${checkpoint.id} ${checkpoint.base_ref} ${checkpoint.created_at} - ${checkpoint.label}`,
        );
      }
    });

  const branch = program.command("branch").description("Manage work git branches");

  branch
    .command("create")
    .description("Create a work branch without checking it out")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--name <branch>", "Branch name override")
    .action(async (workId: string, options: { actor: string; name?: string }) => {
      const isolation = await storeFrom(program).createBranch(workId, {
        actor: options.actor,
        branch: options.name,
      });
      console.log(`branch ${isolation.branch}`);
    });

  const worktree = program.command("worktree").description("Manage work git worktrees");

  worktree
    .command("create")
    .description("Create a work worktree at an explicit path")
    .argument("<work-id>")
    .requiredOption("--path <path>", "Worktree path")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--branch <branch>", "Branch name override")
    .action(async (workId: string, options: { path: string; actor: string; branch?: string }) => {
      const isolation = await storeFrom(program).createWorktree(workId, {
        actor: options.actor,
        path: options.path,
        branch: options.branch,
      });
      console.log(`worktree ${isolation.branch} ${isolation.worktree_path}`);
    });

  program
    .command("rollback-plan")
    .description("Generate a non-destructive rollback plan")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--checkpoint <checkpoint-id>", "Checkpoint id")
    .action(async (workId: string, options: { actor: string; checkpoint?: string }) => {
      await storeFrom(program).writeRollbackPlan(workId, options.actor, options.checkpoint);
      console.log(`rollback-plan.md written for ${workId}`);
    });

  program
    .command("rollback-check")
    .description("Check whether a checkpoint patch can be reversed cleanly")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--checkpoint <checkpoint-id>", "Checkpoint id")
    .action(async (workId: string, options: { actor: string; checkpoint?: string }) => {
      const result = await storeFrom(program).checkRollback(
        workId,
        options.actor,
        options.checkpoint,
      );
      console.log(result.message);
      if (!result.ok) process.exitCode = 1;
    });

  const change = program.command("change").description("Manage controlled change proposals");

  change
    .command("propose")
    .description("Propose a controlled work change")
    .argument("<work-id>")
    .requiredOption("--reason <reason>", "Reason for the change")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--source <kind>", "human | agent | validation | review | system", "human")
    .option("--type <type>", "Change type", "workflow")
    .option("--risk <risk>", "low | medium | high", "medium")
    .option("--affected <item>", "Affected artifact, scope, or area", collect, [])
    .option("--option <option>", "Decision option", collect, [])
    .option("--recommendation <recommendation>", "Recommended option")
    .option("--gate <gate>", "Required gate override")
    .action(async (workId: string, options: ChangeProposeOptions) => {
      const type = ChangeTypeSchema.parse(options.type);
      const risk = parseRisk(options.risk);
      const sourceKind = parseSourceKind(options.source);
      const proposal = await storeFrom(program).proposeChange(workId, {
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
    .description("List work change proposals")
    .argument("<work-id>")
    .action(async (workId: string) => {
      const changes = await storeFrom(program).listChanges(workId);
      for (const proposal of changes) {
        console.log(
          `${proposal.id} ${proposal.status} ${proposal.type} ${proposal.risk} - ${proposal.reason}`,
        );
      }
    });

  change
    .command("show")
    .description("Show one change proposal")
    .argument("<work-id>")
    .argument("<change-id>")
    .action(async (workId: string, changeId: string) => {
      const proposal = await storeFrom(program).readChange(workId, changeId);
      console.log(YAML.stringify(proposal).trimEnd());
    });

  change
    .command("apply")
    .description("Apply an approved change to work.yaml")
    .argument("<work-id>")
    .argument("<change-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--acceptance <item>", "Append acceptance criterion", collect, [])
    .option("--validation <command>", "Append validation command", collect, [])
    .option("--workflow-step <step>", "Append workflow step", collect, [])
    .option("--plan-note <note>", "Append controlled note to plan.md", collect, [])
    .option("--note <note>", "Application note")
    .action(async (workId: string, changeId: string, options: ChangeApplyOptions) => {
      const result = await storeFrom(program).applyChange(workId, changeId, {
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
      .argument("<work-id>")
      .argument("<change-id>")
      .option("--actor <actor>", "Actor id", "local-user")
      .option("--reason <reason>", "Decision reason")
      .action(async (workId: string, changeId: string, options: ChangeDecisionOptions) => {
        const proposal = await storeFrom(program).decideChange(
          workId,
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
    .description("Show work event timeline")
    .argument("<work-id>")
    .action(async (workId: string) => {
      const events = await storeFrom(program).readEvents(workId);
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
    .argument("<work-id>")
    .action(async (workId: string) => {
      const paths = storeFrom(program).paths(workId);
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
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--reason <reason>", "Debug reason")
    .action(async (workId: string, options: { actor: string; reason?: string }) => {
      const store = storeFrom(program);
      await store.writeDebug(workId, options.actor, options.reason);
      console.log((await readFile(store.paths(workId).debug, "utf8")).trimEnd());
    });

  const review = program.command("review").description("Manage review artifacts");

  review
    .command("create")
    .description("Create a review artifact from current work evidence")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "reviewer-agent")
    .action(async (workId: string, options: { actor: string }) => {
      await storeFrom(program).writeReview(workId, options.actor);
      console.log(`review.md written for ${workId}`);
    });

  program
    .command("inspect")
    .description("Inspect one JSONL record")
    .argument("<work-id>")
    .argument("<stream>", "events | telemetry | tool-calls | supervisor")
    .argument("<selector>", "Zero-based record index or stable record id")
    .action(async (workId: string, stream: string, selector: string) => {
      const store = storeFrom(program);
      const records: Array<Record<string, unknown>> | undefined =
        stream === "events"
          ? await store.readEvents(workId)
          : stream === "telemetry"
            ? await store.readTelemetry(workId)
            : stream === "tool-calls"
              ? await store.readToolCalls(workId)
              : stream === "supervisor"
                ? await store.readSupervisorSignals(workId)
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
    .argument("<work-id>")
    .option("--actor <actor>", "Actor id", "handoff-agent")
    .option("--no-complete", "Do not complete validated work")
    .action(async (workId: string, options: { actor: string; complete?: boolean }) => {
      await storeFrom(program).writeHandoff(workId, options.actor, options.complete !== false);
      console.log(`handoff written for ${workId}`);
    });

  await program.parseAsync(argv, { from: "user" });
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function collectInteger(value: string, previous: number[]): number[] {
  previous.push(parseNonNegativeInteger(value));
  return previous;
}

function storeFrom(program: Command): WorkStore {
  const options = program.opts<GlobalOptions>();
  return new WorkStore(options.repo);
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

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid non-negative integer: ${value}`);
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
  const defaultBackendConfig = {
    fallback_profiles: [],
    tools: [],
    retry: { attempts: 1, delay_ms: 0, exit_codes: [1, 124] },
  };
  return {
    default_backend: defaultBackend,
    backends: {
      record: defaultBackendConfig,
      shell: defaultBackendConfig,
      codex: defaultBackendConfig,
      claude: defaultBackendConfig,
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
    retryAttempts?: number;
    retryDelayMs?: number;
    retryExitCode: number[];
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
    retry: {
      attempts: options.retryAttempts ?? backendConfig.retry.attempts,
      delayMs: options.retryDelayMs ?? backendConfig.retry.delay_ms,
      exitCodes:
        options.retryExitCode.length > 0 ? options.retryExitCode : backendConfig.retry.exit_codes,
    },
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
    console.error(`work: ${message}`);
    process.exitCode = 1;
  });
}
