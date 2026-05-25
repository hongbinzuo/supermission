#!/usr/bin/env bun
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  detectAvailableBackends,
  executeRunner,
  executeRunnerWithFallback,
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
    .option("--assign <identity>", "Assign to a team member or agent")
    .action(async (goalParts: string[], options: NewOptions) => {
      const store = storeFrom(program);
      const workId = await store.createWork({
        id: options.id,
        goal: goalParts.join(" "),
        actor: options.actor,
        acceptance: options.acceptance,
        validationCommands: options.validation,
        assignee: options.assign,
      });
      console.log(workId);
    });

  program
    .command("init")
    .description("Initialize supermission in this project — detect runners and set defaults")
    .option("--default-backend <backend>", "Override auto-detected default backend")
    .option("--force", "Overwrite existing runners.yaml")
    .action(async (options: { defaultBackend?: string; force?: boolean }) => {
      const store = storeFrom(program);
      const existingConfig = await store.readRunnerConfig();
      const hasExisting =
        existingConfig.default_backend !== "auto" || existingConfig.fallback_order.length > 0;
      if (hasExisting && !options.force) {
        console.log("runners.yaml already configured. Use --force to overwrite.");
        return;
      }

      console.log("Detecting available agent CLIs...");
      const available = await detectAvailableBackends();

      if (available.length === 0) {
        console.log("\nNo agent CLIs found on PATH.");
        console.log("Install one of: claude, codex, gemini, aider, opencode, goose, grok");
        console.log("\nUsing shell runner as default.");
        await store.writeRunnerConfig({
          ...existingConfig,
          default_backend: "shell",
          fallback_order: [],
          routing: {},
        });
        console.log("\nDone. Try: supermission quick \"Your task\" --command \"echo done\"");
        return;
      }

      console.log(`\nFound ${available.length} agent CLI(s):`);
      for (const backend of available) {
        const desc = RUNNER_REGISTRY.find((r) => r.backend === backend);
        console.log(`  ✓ ${backend} — ${desc?.label ?? ""}`);
      }

      const defaultBackend = options.defaultBackend
        ? parseRunnerBackend(options.defaultBackend)
        : available[0];

      await store.writeRunnerConfig({
        ...existingConfig,
        default_backend: available.length > 1 ? "auto" : defaultBackend,
        fallback_order: available,
        routing: {},
      });

      console.log(`\nDefault: ${available.length > 1 ? "auto (smart selection)" : defaultBackend}`);
      console.log(`Fallback order: ${available.join(" → ")}`);
      console.log("\nDone. Try: supermission quick \"Describe your task here\"");
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
      const resolvedBackend = options.backend ?? (runnerConfig.default_backend === "auto" ? "shell" : runnerConfig.default_backend);
      const mergedOptions = mergeRunnerOptions(runnerConfig, resolvedBackend, options);
      if (resolvedBackend === "shell" && !mergedOptions.command) {
        throw new Error("shell runner requires --command");
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const execution = await executeRunner(
        resolvedBackend,
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
            depends_on: [],
            priority: "medium",
            labels: [],
          },
        },
        mergedOptions,
      );
      const policy = await store.readPolicy();
      console.log(`${resolvedBackend} smoke exit ${execution.exitCode} (${execution.durationMs}ms)`);
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
        const backend: RunnerBackend = options.backend ?? (runnerConfig.default_backend === "auto" ? "record" : runnerConfig.default_backend);
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
    .command("list")
    .description("List all work records with status")
    .option("--status <status>", "Filter by status")
    .option("--json", "Print JSON")
    .action(async (options: { status?: string; json?: boolean }) => {
      const store = storeFrom(program);
      const ids = await store.listWorkIds();
      if (ids.length === 0) {
        console.log("No works found.");
        return;
      }
      const works = [];
      for (const id of ids) {
        const spec = await store.readWork(id);
        if (options.status && spec.status !== options.status) continue;
        works.push(spec);
      }
      if (options.json) {
        console.log(
          JSON.stringify(
            works.map((w) => ({ id: w.id, status: w.status, goal: w.goal, updated_at: w.updated_at })),
            null,
            2,
          ),
        );
        return;
      }
      if (works.length === 0) {
        console.log("No works match the filter.");
        return;
      }
      for (const spec of works) {
        console.log(`${spec.id} ${spec.status} - ${spec.goal}`);
      }
      console.log(`\n${works.length} work(s)`);
    });

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
    .command("board")
    .description("Show a kanban-style board of all work records")
    .option("--mine", "Show only work assigned to current identity")
    .option("--team <team>", "Filter by team")
    .option("--json", "Print JSON")
    .action(async (options: { mine?: boolean; team?: string; json?: boolean }) => {
      const store = storeFrom(program);
      const ids = await store.listWorkIds();
      if (ids.length === 0) {
        console.log("No works found.");
        return;
      }

      const works = [];
      for (const id of ids) {
        works.push(await store.readWork(id));
      }

      // Filter by assignee if --mine
      let filtered = works;
      if (options.mine) {
        const { resolveIdentity } = await import("./identity.js");
        const identity = await resolveIdentity({ repo: store.repo });
        filtered = works.filter((w) => w.assignee === identity.id);
      }
      if (options.team) {
        filtered = filtered.filter((w) => w.team === options.team);
      }

      if (options.json) {
        console.log(JSON.stringify(filtered.map((w) => ({
          id: w.id, status: w.status, goal: w.goal, assignee: w.assignee ?? "-", team: w.team ?? "-",
        })), null, 2));
        return;
      }

      // Group by status
      const columns: Record<string, typeof filtered> = {
        draft: [], planned: [], approved: [], running: [],
        needs_review: [], validated: [], completed: [], other: [],
      };
      for (const w of filtered) {
        const col = columns[w.status] ?? columns.other;
        col.push(w);
      }

      // Print board
      const activeColumns = Object.entries(columns).filter(([, items]) => items.length > 0);
      if (activeColumns.length === 0) {
        console.log("No works match the filter.");
        return;
      }

      for (const [status, items] of activeColumns) {
        console.log(`\n── ${status.toUpperCase()} (${items.length}) ──`);
        for (const w of items) {
          const assignee = w.assignee ? ` @${w.assignee}` : "";
          const goal = w.goal.length > 50 ? w.goal.slice(0, 47) + "..." : w.goal;
          console.log(`  ${w.id}${assignee}`);
          console.log(`    ${goal}`);
        }
      }
      console.log(`\n${filtered.length} work(s) total`);
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

  // --- Team collaboration commands ---

  const team = program.command("team").description("Manage team identities for collaboration");

  team
    .command("init")
    .description("Initialize team.yaml for collaboration")
    .action(async () => {
      const { initTeamRegistry } = await import("./team.js");
      const store = storeFrom(program);
      await initTeamRegistry(store.repo);
      console.log("team.yaml initialized");
    });

  team
    .command("add")
    .description("Register a team member or agent")
    .requiredOption("--name <name>", "Display name")
    .option("--id <id>", "Identity id (defaults to lowercase name)")
    .option("--kind <kind>", "human | agent", "human")
    .option("--role <role>", "owner | lead | developer | reviewer | agent | observer", "developer")
    .option("--email <email>", "Email address")
    .option("--backend <backend>", "Runner backend (required for agents)")
    .option("--profile <profile>", "Runner profile (for agents)")
    .action(
      async (options: {
        name: string;
        id?: string;
        kind: string;
        role: string;
        email?: string;
        backend?: string;
        profile?: string;
      }) => {
        const { addIdentity } = await import("./team.js");
        const store = storeFrom(program);
        const id = options.id ?? options.name.toLowerCase().replace(/\s+/g, "-");
        const identity = await addIdentity(store.repo, {
          id,
          name: options.name,
          kind: options.kind as "human" | "agent",
          role: options.role as "owner" | "lead" | "developer" | "reviewer" | "agent" | "observer",
          email: options.email,
          backend: options.backend,
          profile: options.profile,
        });
        console.log(`${identity.id} ${identity.kind} ${identity.role} - ${identity.name}`);
      },
    );

  team
    .command("remove")
    .description("Remove a team member")
    .argument("<identity-id>")
    .action(async (id: string) => {
      const { removeIdentity } = await import("./team.js");
      const store = storeFrom(program);
      await removeIdentity(store.repo, id);
      console.log(`removed ${id}`);
    });

  team
    .command("list")
    .description("List registered team members")
    .action(async () => {
      const { listIdentities } = await import("./team.js");
      const store = storeFrom(program);
      const identities = await listIdentities(store.repo);
      if (identities.length === 0) {
        console.log("No team members registered.");
        return;
      }
      for (const identity of identities) {
        const extra = identity.backend ? ` backend=${identity.backend}` : "";
        console.log(`${identity.id} ${identity.kind} ${identity.role}${extra} - ${identity.name}`);
      }
    });

  program
    .command("assign")
    .description("Assign or reassign a work record to a team member")
    .argument("<work-id>")
    .requiredOption("--to <identity>", "Identity to assign to")
    .option("--actor <actor>", "Actor performing the assignment", "local-user")
    .action(async (workId: string, options: { to: string; actor: string }) => {
      const { readTeamRegistry } = await import("./identity.js");
      const store = storeFrom(program);
      const registry = await readTeamRegistry(store.repo);
      if (registry && !registry.identities.some((i) => i.id === options.to)) {
        throw new Error(`unknown identity: ${options.to}. Run \`supermission team list\``);
      }
      const spec = await store.readWork(workId);
      const previous = spec.assignee;
      await store.writeWork({ ...spec, assignee: options.to });
      if (previous) {
        await store.appendEvent(workId, "work.reassigned", options.actor, {
          from: previous,
          to: options.to,
        });
        console.log(`reassigned ${workId}: ${previous} → ${options.to}`);
      } else {
        await store.appendEvent(workId, "work.assigned", options.actor, {
          assignee: options.to,
        });
        console.log(`assigned ${workId} to ${options.to}`);
      }
    });

  program
    .command("release")
    .description("Release assignment from a work record")
    .argument("<work-id>")
    .option("--actor <actor>", "Actor performing the release", "local-user")
    .action(async (workId: string, options: { actor: string }) => {
      const store = storeFrom(program);
      const spec = await store.readWork(workId);
      if (!spec.assignee) {
        console.log(`${workId} has no assignee`);
        return;
      }
      const previous = spec.assignee;
      await store.writeWork({ ...spec, assignee: undefined });
      await store.appendEvent(workId, "work.released", options.actor, {
        previous_assignee: previous,
      });
      console.log(`released ${workId} (was: ${previous})`);
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

  program
    .command("quick")
    .description("Fast-path: create, plan, approve, run, and validate in one command")
    .argument("<goal...>", "Work goal")
    .option("--id <id>", "Explicit work id")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--acceptance <item>", "Acceptance criterion", collect, [])
    .option("--validation <command>", "Validation command", collect, [])
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
    .option("--skip-validate", "Skip validation step")
    .option("--skip-handoff", "Skip handoff step")
    .action(
      async (
        goalParts: string[],
        options: {
          id?: string;
          actor: string;
          acceptance: string[];
          validation: string[];
          backend?: RunnerBackend;
          command?: string;
          prompt?: string;
          model?: string;
          profile?: string;
          fallbackProfile: string[];
          sandbox?: "read-only" | "workspace-write" | "danger-full-access";
          permissionMode?:
            | "acceptEdits"
            | "auto"
            | "bypassPermissions"
            | "default"
            | "dontAsk"
            | "plan";
          tool: string[];
          timeoutMs?: number;
          skipValidate?: boolean;
          skipHandoff?: boolean;
        },
      ) => {
        const store = storeFrom(program);
        const goal = goalParts.join(" ");

        // 1. Create
        const workId = await store.createWork({
          id: options.id,
          goal,
          actor: options.actor,
          acceptance: options.acceptance,
          validationCommands: options.validation,
        });
        console.log(`created ${workId}`);

        // 2. Plan
        await store.writePlan(workId, "planner-agent");
        console.log(`planned ${workId}`);

        // 3. Approve
        await store.approve(workId, options.actor, "approve_plan", "Quick-path auto-approve");
        console.log(`approved ${workId}`);

        // 4. Run
        const runnerConfig = await store.readRunnerConfig();
        const spec = await store.beginRun(workId, options.actor);

        if (options.backend === "record" || (!options.backend && runnerConfig.default_backend === "record" && runnerConfig.fallback_order.length === 0)) {
          await store.recordRun(workId, options.actor, options.prompt);
          console.log(`recorded run for ${workId}`);
        } else {
          // Use smart selection with fallback chain
          const execution = await executeRunnerWithFallback(
            runnerConfig,
            { repo: store.repo, work: spec, actor: options.actor },
            {
              explicit: options.backend,
              command: options.command,
              prompt: options.prompt ?? goal,
              model: options.model,
              profile: options.profile,
              fallbackProfiles: options.fallbackProfile,
              sandbox: options.sandbox,
              permissionMode: options.permissionMode,
              tools: options.tool,
              timeoutMs: options.timeoutMs,
            },
          );
          await store.recordRunnerExecution(workId, options.actor, execution);
          console.log(
            `${execution.backend} runner ${workId} exit ${execution.exitCode} (${execution.durationMs}ms)`,
          );
          if (execution.exitCode !== 0) {
            process.exitCode = execution.exitCode;
            return;
          }
        }

        // 5. Validate (optional)
        if (!options.skipValidate && options.validation.length > 0) {
          const result = await store.validate(workId, "validator-agent", {});
          if (result.exitCode !== 0) {
            console.log(`validation failed (exit ${result.exitCode})`);
            process.exitCode = result.exitCode;
            return;
          }
          console.log(`validated ${workId}`);
        } else if (!options.skipValidate && options.validation.length === 0) {
          // No validation commands — skip silently
          console.log(`no validation commands, skipping validate`);
        }

        // 6. Handoff (optional)
        if (!options.skipHandoff) {
          try {
            await store.writeHandoff(workId, "handoff-agent", true);
            console.log(`handoff written for ${workId}`);
          } catch {
            // Handoff may fail if not validated — that's ok in quick mode
            console.log(`skipped handoff (work not in validated state)`);
          }
        }

        console.log(`\ndone: ${workId}`);
      },
    );

  // --- Pipeline commands ---

  const pipelineCmd = program.command("pipeline").description("Manage and run multi-agent pipelines");

  pipelineCmd
    .command("init")
    .description("Create default pipeline templates in .supermission/pipelines/")
    .action(async () => {
      const { initPipelines } = await import("./pipeline.js");
      const store = storeFrom(program);
      await initPipelines(store.repo);
      console.log("Created pipeline templates:");
      console.log("  .supermission/pipelines/feature.yaml  — plan → code → test → review");
      console.log("  .supermission/pipelines/bugfix.yaml   — reproduce → fix → verify");
      console.log("  .supermission/pipelines/deploy.yaml   — plan → code → test → review → deploy");
      console.log("\nCustomize these or create your own YAML pipeline files.");
    });

  pipelineCmd
    .command("list")
    .description("List available pipelines")
    .action(async () => {
      const { listPipelines } = await import("./pipeline.js");
      const store = storeFrom(program);
      const pipelines = await listPipelines(store.repo);
      if (pipelines.length === 0) {
        console.log("No pipelines found. Run `supermission pipeline init` to create defaults.");
        return;
      }
      for (const p of pipelines) {
        const stages = p.stages.map((s) => s.id).join(" → ");
        console.log(`${p.name} — ${p.description}`);
        console.log(`  stages: ${stages}`);
      }
    });

  pipelineCmd
    .command("show")
    .description("Show pipeline details")
    .argument("<name>")
    .action(async (name: string) => {
      const { readPipeline } = await import("./pipeline.js");
      const store = storeFrom(program);
      const pipeline = await readPipeline(store.repo, name);
      console.log(`Pipeline: ${pipeline.name}`);
      console.log(`Description: ${pipeline.description}`);
      console.log(`\nStages:`);
      for (const stage of pipeline.stages) {
        const backend = stage.backend ? ` [${stage.backend}]` : "";
        const gate = stage.gate ? ` (gate: ${stage.gate})` : "";
        const validation = stage.validation ? ` (validates: ${stage.validation})` : "";
        console.log(`  ${stage.id} — ${stage.role}${backend}${gate}${validation}`);
        if (stage.prompt) console.log(`    prompt: ${stage.prompt.slice(0, 60)}...`);
      }
    });

  pipelineCmd
    .command("run")
    .description("Run a pipeline for a goal")
    .argument("<pipeline-name>")
    .argument("<goal...>")
    .option("--id <id>", "Explicit work id")
    .option("--actor <actor>", "Actor id", "local-user")
    .option("--skip-stage <stage>", "Skip a stage", collect, [])
    .option("--acceptance <item>", "Acceptance criterion", collect, [])
    .option("--validation <command>", "Validation command", collect, [])
    .action(
      async (
        pipelineName: string,
        goalParts: string[],
        options: {
          id?: string;
          actor: string;
          skipStage: string[];
          acceptance: string[];
          validation: string[];
        },
      ) => {
        const { readPipeline, runPipeline } = await import("./pipeline.js");
        const store = storeFrom(program);
        const pipeline = await readPipeline(store.repo, pipelineName);
        const result = await runPipeline(store, pipeline, {
          goal: goalParts.join(" "),
          workId: options.id,
          skipStages: options.skipStage,
          actor: options.actor,
          acceptance: options.acceptance,
          validation: options.validation,
        });

        console.log(`\n━━━ Pipeline Result ━━━`);
        console.log(`Work: ${result.workId}`);
        console.log(`Pipeline: ${result.pipeline}`);
        console.log(`Status: ${result.status}`);
        for (const stage of result.stages) {
          const icon = stage.status === "completed" ? "✓" : stage.status === "skipped" ? "○" : stage.status === "gate_waiting" ? "⏸" : "✗";
          console.log(`  ${icon} ${stage.id} — ${stage.status} (${stage.durationMs}ms)${stage.backend ? ` [${stage.backend}]` : ""}`);
        }

        if (result.status === "failed") process.exitCode = 1;
      },
    );

  pipelineCmd
    .command("batch")
    .description("Run a pipeline for multiple goals (sequential)")
    .argument("<pipeline-name>")
    .argument("<goals...>")
    .option("--actor <actor>", "Actor id", "local-user")
    .action(async (pipelineName: string, goals: string[], options: { actor: string }) => {
      const { readPipeline, runPipeline } = await import("./pipeline.js");
      const store = storeFrom(program);
      const pipeline = await readPipeline(store.repo, pipelineName);

      const results = [];
      for (const goal of goals) {
        console.log(`\n━━━ Starting: ${goal} ━━━`);
        const result = await runPipeline(store, pipeline, { goal, actor: options.actor });
        results.push(result);
        if (result.status === "failed") {
          console.log(`\nBatch stopped: "${goal}" failed.`);
          process.exitCode = 1;
          break;
        }
      }

      console.log(`\n━━━ Batch Summary ━━━`);
      for (const r of results) {
        const icon = r.status === "completed" ? "✓" : r.status === "gate_waiting" ? "⏸" : "✗";
        console.log(`  ${icon} ${r.workId} — ${r.status}`);
      }
    });

  // --- Cost and footprint commands ---

  program
    .command("cost")
    .description("Show token usage and cost estimate for a work record")
    .argument("<work-id>")
    .option("--json", "Print JSON")
    .action(async (workId: string, options: { json?: boolean }) => {
      const store = storeFrom(program);
      const telemetry = await store.readTelemetry(workId);
      const toolCalls = await store.readToolCalls(workId);

      let totalTokens = 0;
      let totalDurationMs = 0;
      let runnerCalls = 0;
      const byBackend: Record<string, { tokens: number; calls: number; durationMs: number }> = {};

      for (const entry of telemetry) {
        if (entry.metric === "runner.executed") {
          const tokens = Number(entry.tokens_used) || 0;
          const duration = Number(entry.duration_ms) || 0;
          const backend = String(entry.backend ?? "unknown");
          totalTokens += tokens;
          totalDurationMs += duration;
          runnerCalls++;
          if (!byBackend[backend]) byBackend[backend] = { tokens: 0, calls: 0, durationMs: 0 };
          byBackend[backend].tokens += tokens;
          byBackend[backend].calls++;
          byBackend[backend].durationMs += duration;
        }
      }

      // Rough cost estimate (input+output blended)
      const costPerMToken: Record<string, number> = {
        claude: 9.0,    // ~$3 input + $15 output blended
        codex: 5.0,     // ~$2 input + $8 output blended
        gemini: 1.25,   // ~$0.5 input + $2 output blended
        aider: 5.0,     // depends on model
        opencode: 5.0,
        copilot: 4.0,
        "amazon-q": 0,  // included in AWS
        goose: 5.0,
        kiro: 5.0,
        grok: 3.0,
        shell: 0,
        record: 0,
      };

      let estimatedCost = 0;
      for (const [backend, data] of Object.entries(byBackend)) {
        const rate = costPerMToken[backend] ?? 5.0;
        estimatedCost += (data.tokens / 1_000_000) * rate;
      }

      if (options.json) {
        console.log(JSON.stringify({ totalTokens, totalDurationMs, runnerCalls, estimatedCost, byBackend }, null, 2));
        return;
      }

      console.log(`Cost report: ${workId}`);
      console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
      console.log(`  Total runtime: ${(totalDurationMs / 1000).toFixed(1)}s`);
      console.log(`  Runner calls: ${runnerCalls}`);
      console.log(`  Estimated cost: $${estimatedCost.toFixed(4)}`);
      if (Object.keys(byBackend).length > 0) {
        console.log(`\n  By backend:`);
        for (const [backend, data] of Object.entries(byBackend)) {
          const rate = costPerMToken[backend] ?? 5.0;
          const cost = (data.tokens / 1_000_000) * rate;
          console.log(`    ${backend}: ${data.tokens.toLocaleString()} tokens, ${data.calls} call(s), ${(data.durationMs / 1000).toFixed(1)}s, ~$${cost.toFixed(4)}`);
        }
      }

      // Footprint summary from tool calls
      const stages = new Set<string>();
      const artifacts = new Set<string>();
      for (const tc of toolCalls) {
        if (tc.footprint_stage) stages.add(String(tc.footprint_stage));
        if (tc.footprint_artifact) artifacts.add(String(tc.footprint_artifact));
      }
      if (stages.size > 0) {
        console.log(`\n  Footprint stages: ${[...stages].join(", ")}`);
        console.log(`  Artifacts produced: ${[...artifacts].join(", ")}`);
      }
    });

  program
    .command("serve")
    .description("Start local web dashboard")
    .option("--port <port>", "Server port", "4000")
    .option("--open", "Open browser automatically")
    .action(async (options: { port: string; open?: boolean }) => {
      const { startServer } = await import("./web.js");
      const store = storeFrom(program);
      await startServer({
        port: Number.parseInt(options.port, 10),
        repo: store.repo,
        open: options.open,
      });
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
  assign?: string;
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
    fallback_order: [],
    routing: {},
    backends: {
      record: defaultBackendConfig,
      shell: defaultBackendConfig,
      codex: defaultBackendConfig,
      claude: defaultBackendConfig,
      gemini: defaultBackendConfig,
      aider: defaultBackendConfig,
      opencode: defaultBackendConfig,
      copilot: defaultBackendConfig,
      "amazon-q": defaultBackendConfig,
      goose: defaultBackendConfig,
      kiro: defaultBackendConfig,
      grok: defaultBackendConfig,
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
