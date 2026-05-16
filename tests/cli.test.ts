import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bunBin, runMission, runProcess, withTempRepo } from "./helpers.js";

const runnerSmokeBackends = new Set(
  (process.env.SUPERMISSION_RUNNER_SMOKE ?? "")
    .split(",")
    .map((backend) => backend.trim().toLowerCase())
    .filter(Boolean),
);

function shouldRunExternalSmoke(backend: "codex" | "claude"): boolean {
  return runnerSmokeBackends.has("all") || runnerSmokeBackends.has(backend);
}

describe("mission CLI", () => {
  it("runs the V0 command flow as a black-box CLI", async () => {
    await withTempRepo(async (repo) => {
      const created = await runMission(repo, [
        "new",
        "Add login validation",
        "--id",
        "mission-cli",
        "--acceptance",
        "Invalid login shows an error",
        "--validation",
        `${bunBin} --version`,
      ]);
      expect(created.exitCode).toBe(0);
      expect(created.stdout.trim()).toBe("mission-cli");

      for (const args of [
        ["plan", "mission-cli"],
        ["approve", "mission-cli"],
        ["run", "mission-cli", "--note", "external worker"],
        ["validate", "mission-cli"],
        ["handoff", "mission-cli"],
      ]) {
        const result = await runMission(repo, args);
        expect(result.exitCode).toBe(0);
      }

      const status = await runMission(repo, ["status", "mission-cli"]);
      expect(status.stdout).toContain("mission-cli completed");

      const trace = await runMission(repo, ["trace", "mission-cli"]);
      expect(trace.stdout).toContain("validation.passed");

      const inspect = await runMission(repo, ["inspect", "mission-cli", "events", "0"]);
      expect(inspect.stdout).toContain('"type": "mission.created"');
      expect(inspect.stdout).toContain('"record_id": "event-000001"');

      const inspectById = await runMission(repo, [
        "inspect",
        "mission-cli",
        "events",
        "event-000001",
      ]);
      expect(inspectById.stdout).toContain('"type": "mission.created"');

      const tasks = await runMission(repo, ["tasks", "mission-cli"]);
      expect(tasks.stdout).toContain("task-001 ready worker-agent");
    });
  });

  it("executes the shell runner and records run evidence", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, [
        "new",
        "Shell runner mission",
        "--id",
        "mission-shell-runner",
        "--validation",
        `${bunBin} --version`,
      ]);
      await runMission(repo, ["plan", "mission-shell-runner"]);
      await runMission(repo, ["approve", "mission-shell-runner"]);

      const result = await runMission(repo, [
        "run",
        "mission-shell-runner",
        "--backend",
        "shell",
        "--command",
        "printf 'shell-runner' > runner-output.txt",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(repo, "runner-output.txt"), "utf8")).toBe("shell-runner");

      const runLog = await readFile(
        join(repo, ".missions", "mission-shell-runner", "run.log"),
        "utf8",
      );
      expect(runLog).toContain("Backend: shell");
      expect(runLog).toContain("shell-runner");

      const status = await runMission(repo, ["status", "mission-shell-runner"]);
      expect(status.stdout).toContain("needs_review");

      await runMission(repo, ["validate", "mission-shell-runner"]);
      await runMission(repo, ["handoff", "mission-shell-runner"]);
      const completed = await runMission(repo, ["status", "mission-shell-runner"]);
      expect(completed.stdout).toContain("completed");
    });
  }, 120000);

  it("lists runner backend metadata", async () => {
    await withTempRepo(async (repo) => {
      const result = await runMission(repo, ["runner", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("record local");
      expect(result.stdout).toContain("shell local");
      expect(result.stdout).toContain("codex external profiles=cc-switch-or-native");
      expect(result.stdout).toContain("claude external profiles=native");
    });
  });

  it("uses project runner config when run options are omitted", async () => {
    await withTempRepo(async (repo) => {
      const init = await runMission(repo, [
        "runner",
        "config",
        "init",
        "--default-backend",
        "shell",
        "--command",
        "printf configured-runner > runner-output.txt",
        "--timeout-ms",
        "60000",
      ]);
      expect(init.exitCode).toBe(0);
      expect(init.stdout).toContain("default_backend: shell");

      const show = await runMission(repo, ["runner", "config", "show"]);
      expect(show.stdout).toContain("configured-runner");

      await runMission(repo, ["new", "Configured runner mission", "--id", "mission-runner-config"]);
      await runMission(repo, ["plan", "mission-runner-config"]);
      await runMission(repo, ["approve", "mission-runner-config"]);

      const result = await runMission(repo, ["run", "mission-runner-config"]);
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(repo, "runner-output.txt"), "utf8")).toBe("configured-runner");

      const runLog = await readFile(
        join(repo, ".missions", "mission-runner-config", "run.log"),
        "utf8",
      );
      expect(runLog).toContain("Backend: shell");
    });
  });

  it("runs a shell runner smoke test without creating a mission", async () => {
    await withTempRepo(async (repo) => {
      const result = await runMission(repo, [
        "runner",
        "smoke",
        "--backend",
        "shell",
        "--command",
        "printf runner-smoke-ok",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("shell smoke exit 0");
      expect(result.stdout).toContain("runner-smoke-ok");
    });
  });

  const codexSmoke = shouldRunExternalSmoke("codex") ? it : it.skip;
  codexSmoke(
    "smokes the codex runner backend",
    async () => {
      await withTempRepo(async (repo) => {
        await runMission(repo, ["new", "Codex runner mission", "--id", "mission-codex-runner"]);
        await runMission(repo, ["plan", "mission-codex-runner"]);
        await runMission(repo, ["approve", "mission-codex-runner"]);

        const args = [
          "run",
          "mission-codex-runner",
          "--backend",
          "codex",
          "--prompt",
          "Reply only with codex-smoke-ok.",
          "--timeout-ms",
          process.env.SUPERMISSION_RUNNER_TIMEOUT_MS ?? "60000",
        ];
        if (process.env.SUPERMISSION_CODEX_PROFILE) {
          args.push("--profile", process.env.SUPERMISSION_CODEX_PROFILE);
        }
        if (process.env.SUPERMISSION_CODEX_FALLBACK_PROFILE) {
          args.push("--fallback-profile", process.env.SUPERMISSION_CODEX_FALLBACK_PROFILE);
        }
        if (process.env.SUPERMISSION_CODEX_MODEL) {
          args.push("--model", process.env.SUPERMISSION_CODEX_MODEL);
        }

        const result = await runMission(repo, args);
        const runLog = await readFile(
          join(repo, ".missions", "mission-codex-runner", "run.log"),
          "utf8",
        );
        expect(result.exitCode, `${result.stderr}\n${result.stdout}\n${runLog}`).toBe(0);
        expect(runLog).toContain("Backend: codex");
        expect(runLog).toContain("codex-smoke-ok");
      });
    },
    120000,
  );

  const claudeSmoke = shouldRunExternalSmoke("claude") ? it : it.skip;
  claudeSmoke(
    "smokes the claude runner backend",
    async () => {
      await withTempRepo(async (repo) => {
        await runMission(repo, ["new", "Claude runner mission", "--id", "mission-claude-runner"]);
        await runMission(repo, ["plan", "mission-claude-runner"]);
        await runMission(repo, ["approve", "mission-claude-runner"]);

        const args = [
          "run",
          "mission-claude-runner",
          "--backend",
          "claude",
          "--prompt",
          "Reply only with claude-smoke-ok.",
          "--timeout-ms",
          process.env.SUPERMISSION_RUNNER_TIMEOUT_MS ?? "60000",
        ];
        if (process.env.SUPERMISSION_CLAUDE_MODEL) {
          args.push("--model", process.env.SUPERMISSION_CLAUDE_MODEL);
        }

        const result = await runMission(repo, args);
        const runLog = await readFile(
          join(repo, ".missions", "mission-claude-runner", "run.log"),
          "utf8",
        );
        expect(result.exitCode, `${result.stderr}\n${result.stdout}\n${runLog}`).toBe(0);
        expect(runLog).toContain("Backend: claude");
        expect(runLog).toContain("claude-smoke-ok");
      });
    },
    120000,
  );

  it("returns a useful error for invalid inspect index", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Inspect failure", "--id", "mission-inspect"]);
      const result = await runMission(repo, ["inspect", "mission-inspect", "events", "99"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("index out of range");
    });
  });

  it("rejects approving a draft mission before planning", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Gate order CLI", "--id", "mission-gate-cli"]);

      const result = await runMission(repo, ["approve", "mission-gate-cli"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("approve_plan requires mission status planned");

      const doctor = await runMission(repo, ["doctor", "mission-gate-cli"]);
      expect(doctor.exitCode).toBe(1);
      expect(doctor.stdout).toContain("gate_waiting");
    });
  });

  it("supports controlled change proposal commands", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Change CLI", "--id", "mission-change-cli"]);

      const proposed = await runMission(repo, [
        "change",
        "propose",
        "mission-change-cli",
        "--reason",
        "Need a clearer acceptance criterion",
        "--type",
        "workflow",
        "--risk",
        "low",
        "--affected",
        "acceptance",
        "--option",
        "update_acceptance",
        "--recommendation",
        "update_acceptance",
      ]);
      expect(proposed.exitCode).toBe(0);
      expect(proposed.stdout).toContain("change-001 proposed");

      const status = await runMission(repo, ["status", "mission-change-cli"]);
      expect(status.stdout).toContain("needs_decision");

      const list = await runMission(repo, ["change", "list", "mission-change-cli"]);
      expect(list.stdout).toContain("change-001 proposed workflow low");

      const show = await runMission(repo, ["change", "show", "mission-change-cli", "change-001"]);
      expect(show.stdout).toContain("recommendation: update_acceptance");

      const approved = await runMission(repo, [
        "change",
        "approve",
        "mission-change-cli",
        "change-001",
        "--reason",
        "Acceptable.",
      ]);
      expect(approved.exitCode).toBe(0);
      expect(approved.stdout).toContain("change-001 approved");

      const applied = await runMission(repo, [
        "change",
        "apply",
        "mission-change-cli",
        "change-001",
        "--acceptance",
        "Updated acceptance is recorded",
        "--validation",
        `${bunBin} --version`,
        "--workflow-step",
        "review",
        "--plan-note",
        "Update the generated plan with the acceptance change.",
      ]);
      expect(applied.exitCode).toBe(0);
      expect(applied.stdout).toContain("change-001 applied");
      expect(applied.stdout).toContain("plan +1");

      const showApplied = await runMission(repo, [
        "change",
        "show",
        "mission-change-cli",
        "change-001",
      ]);
      expect(showApplied.stdout).toContain("status: applied");
      expect(showApplied.stdout).toContain("Updated acceptance is recorded");
    });
  });

  it("supports diff and checkpoint commands", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(join(repo, "app.txt"), "before\n", "utf8");
      await runProcess("git", ["add", "app.txt"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      await writeFile(join(repo, "app.txt"), "after\n", "utf8");
      await runMission(repo, ["new", "Checkpoint CLI", "--id", "mission-checkpoint-cli"]);

      const diff = await runMission(repo, ["diff", "mission-checkpoint-cli"]);
      expect(diff.exitCode).toBe(0);
      expect(diff.stdout).toContain("captured patch.diff");

      const created = await runMission(repo, [
        "checkpoint",
        "create",
        "mission-checkpoint-cli",
        "--label",
        "before review",
      ]);
      expect(created.exitCode).toBe(0);
      expect(created.stdout).toContain("checkpoint-001");

      const list = await runMission(repo, ["checkpoint", "list", "mission-checkpoint-cli"]);
      expect(list.stdout).toContain("before review");
    });
  });

  it("supports task-scoped diff capture from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, "src", "app.ts"), "before\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "before\n", "utf8");
      await runProcess("git", ["add", "src/app.ts", "docs/notes.md"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      await runMission(repo, ["new", "Scoped Diff CLI", "--id", "mission-scoped-diff-cli"]);
      await runMission(repo, [
        "task",
        "add",
        "mission-scoped-diff-cli",
        "--title",
        "Source-only change",
        "--mutation-mode",
        "linear_write",
        "--scope-allow",
        "src/**",
      ]);
      await writeFile(join(repo, "src", "app.ts"), "after\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "after\n", "utf8");

      const diff = await runMission(repo, [
        "diff",
        "mission-scoped-diff-cli",
        "--task",
        "task-002",
      ]);
      expect(diff.exitCode).toBe(0);

      const doctor = await runMission(repo, ["doctor", "mission-scoped-diff-cli"]);
      expect(doctor.stdout).toContain("scope_drift");
    });
  });

  it("supports branch, worktree, and rollback-plan commands", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(join(repo, "app.txt"), "before\n", "utf8");
      await runProcess("git", ["add", "app.txt"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      const worktreePath = join(repo, "..", "mission-cli-worktree");

      try {
        await runMission(repo, ["new", "Isolation CLI", "--id", "mission-isolation-cli"]);
        const branch = await runMission(repo, [
          "branch",
          "create",
          "mission-isolation-cli",
          "--name",
          "mission/cli-branch",
        ]);
        expect(branch.exitCode).toBe(0);
        expect(branch.stdout).toContain("mission/cli-branch");

        const worktree = await runMission(repo, [
          "worktree",
          "create",
          "mission-isolation-cli",
          "--path",
          worktreePath,
          "--branch",
          "mission/cli-worktree",
        ]);
        expect(worktree.exitCode).toBe(0);
        expect(worktree.stdout).toContain(worktreePath);

        const rollback = await runMission(repo, ["rollback-plan", "mission-isolation-cli"]);
        expect(rollback.exitCode).toBe(0);
        expect(rollback.stdout).toContain("rollback-plan.md written");

        await writeFile(join(repo, "app.txt"), "after\n", "utf8");
        await runMission(repo, [
          "checkpoint",
          "create",
          "mission-isolation-cli",
          "--label",
          "before rollback check",
        ]);
        const rollbackCheck = await runMission(repo, ["rollback-check", "mission-isolation-cli"]);
        expect(rollbackCheck.exitCode).toBe(0);
        expect(rollbackCheck.stdout).toContain("Rollback check passed");
      } finally {
        await runProcess("git", ["worktree", "remove", "--force", worktreePath], { cwd: repo });
        await rm(worktreePath, { recursive: true, force: true });
      }
    });
  });

  it("supports mission doctor with blocking exit code", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Doctor CLI", "--id", "mission-doctor-cli"]);
      const result = await runMission(repo, ["doctor", "mission-doctor-cli"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("BLOCKING validation_missing");

      const json = await runMission(repo, ["doctor", "mission-doctor-cli", "--json"]);
      expect(json.exitCode).toBe(1);
      expect(json.stdout).toContain('"code": "validation_missing"');
    });
  });

  it("supports project policy init and show commands", async () => {
    await withTempRepo(async (repo) => {
      const init = await runMission(repo, [
        "policy",
        "init",
        "--validation-allow",
        `${bunBin} *`,
        "--redaction-pattern",
        "session-id=[A-Za-z0-9]+",
      ]);
      expect(init.exitCode).toBe(0);
      expect(init.stdout).toContain("validation_allowlist");
      expect(init.stdout).toContain("redaction");

      const show = await runMission(repo, ["policy", "show"]);
      expect(show.stdout).toContain(`${bunBin} *`);
      expect(show.stdout).toContain("session-id=[A-Za-z0-9]+");

      await runMission(repo, [
        "new",
        "Policy CLI",
        "--id",
        "mission-policy-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      const validation = await runMission(repo, ["validate", "mission-policy-cli"]);
      expect(validation.exitCode).toBe(0);
    });
  });

  it("blocks risky validation commands from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, [
        "new",
        "Risky CLI",
        "--id",
        "mission-risky-cli",
        "--validation",
        "rm -rf ./definitely-risky",
      ]);
      const result = await runMission(repo, ["validate", "mission-risky-cli"]);
      expect(result.exitCode).toBe(3);

      const doctor = await runMission(repo, ["doctor", "mission-risky-cli"]);
      expect(doctor.exitCode).toBe(1);
      expect(doctor.stdout).toContain("mission_blocked");
    });
  });

  it("requires an approval gate before --allow-risky executes from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, [
        "new",
        "Risky Gate CLI",
        "--id",
        "mission-risky-gate-cli",
        "--validation",
        "rm -rf ./definitely-risky",
      ]);

      const missingGate = await runMission(repo, [
        "validate",
        "mission-risky-gate-cli",
        "--allow-risky",
      ]);
      expect(missingGate.exitCode).toBe(3);

      const approved = await runMission(repo, [
        "approve",
        "mission-risky-gate-cli",
        "--gate",
        "approve_risky_command",
        "--reason",
        "Reviewed command in temp repo.",
      ]);
      expect(approved.exitCode).toBe(0);

      const allowed = await runMission(repo, [
        "validate",
        "mission-risky-gate-cli",
        "--allow-risky",
      ]);
      expect(allowed.exitCode).toBe(0);
    });
  });

  it("supports review artifact creation", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, [
        "new",
        "Review CLI",
        "--id",
        "mission-review-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      await runMission(repo, ["validate", "mission-review-cli"]);

      const review = await runMission(repo, ["review", "create", "mission-review-cli"]);
      expect(review.exitCode).toBe(0);
      expect(review.stdout).toContain("review.md written");
    });
  });

  it("supports compact mission summary", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, [
        "new",
        "Summary CLI",
        "--id",
        "mission-summary-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      const summary = await runMission(repo, ["summary", "mission-summary-cli"]);
      expect(summary.exitCode).toBe(0);
      expect(summary.stdout).toContain("mission-summary-cli draft");
      expect(summary.stdout).toContain("Artifacts:");
    });
  });

  it("supports mission monitor reports and supervisor inspection", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Monitor CLI", "--id", "mission-monitor-cli"]);
      await runMission(repo, ["validate", "mission-monitor-cli"]);

      const monitor = await runMission(repo, ["monitor", "mission-monitor-cli"]);
      expect(monitor.exitCode).toBe(0);
      expect(monitor.stdout).toContain("Mission: mission-monitor-cli");
      expect(monitor.stdout).toContain("## Next Actions");

      const json = await runMission(repo, ["monitor", "mission-monitor-cli", "--json"]);
      expect(json.exitCode).toBe(0);
      expect(json.stdout).toContain('"recent_signals"');

      const signal = await runMission(repo, ["inspect", "mission-monitor-cli", "supervisor", "0"]);
      expect(signal.exitCode).toBe(0);
      expect(signal.stdout).toContain('"type": "validation_missing"');
    });
  });

  it("supports task ledger commands", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Task CLI", "--id", "mission-task-cli"]);
      const added = await runMission(repo, [
        "task",
        "add",
        "mission-task-cli",
        "--title",
        "Write test plan",
        "--actor-role",
        "tester-agent",
        "--mutation-mode",
        "sidecar_artifact",
        "--scope-allow",
        ".missions/**",
      ]);
      expect(added.exitCode).toBe(0);
      expect(added.stdout).toContain("task-002 ready sidecar_artifact");

      const status = await runMission(repo, [
        "task",
        "set-status",
        "mission-task-cli",
        "task-002",
        "--status",
        "done",
      ]);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("task-002 done");
    });
  });

  it("enforces one running linear write task while allowing sidecar running tasks", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Linear lock CLI", "--id", "mission-linear-cli"]);
      await runMission(repo, [
        "task",
        "add",
        "mission-linear-cli",
        "--title",
        "Second write",
        "--mutation-mode",
        "linear_write",
      ]);
      await runMission(repo, [
        "task",
        "add",
        "mission-linear-cli",
        "--title",
        "Sidecar review",
        "--actor-role",
        "reviewer-agent",
        "--mutation-mode",
        "sidecar_artifact",
      ]);

      expect(
        (
          await runMission(repo, [
            "task",
            "set-status",
            "mission-linear-cli",
            "task-001",
            "--status",
            "running",
          ])
        ).exitCode,
      ).toBe(0);

      const blocked = await runMission(repo, [
        "task",
        "set-status",
        "mission-linear-cli",
        "task-002",
        "--status",
        "running",
      ]);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain("linear_write task task-001 is already running");

      const sidecar = await runMission(repo, [
        "task",
        "set-status",
        "mission-linear-cli",
        "task-003",
        "--status",
        "running",
      ]);
      expect(sidecar.exitCode).toBe(0);
      expect(sidecar.stdout).toContain("task-003 running");
    });
  });

  it("supports task scope audit from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Scope CLI", "--id", "mission-scope-cli"]);
      await runMission(repo, [
        "task",
        "add",
        "mission-scope-cli",
        "--title",
        "Source-only change",
        "--mutation-mode",
        "linear_write",
        "--scope-allow",
        "src/**",
      ]);
      await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, "docs", "notes.md"), "outside\n", "utf8");

      const audit = await runMission(repo, [
        "task",
        "audit-scope",
        "mission-scope-cli",
        "task-002",
      ]);
      expect(audit.exitCode).toBe(0);
      expect(audit.stdout).toContain("1 violation");
      expect(audit.stdout).toContain("docs/notes.md");

      const doctor = await runMission(repo, ["doctor", "mission-scope-cli"]);
      expect(doctor.stdout).toContain("scope_drift");
    });
  });
});
