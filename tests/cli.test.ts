import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bunBin, runWork, runProcess, withTempRepo } from "./helpers.js";

const runnerSmokeBackends = new Set(
  (process.env.SUPERMISSION_RUNNER_SMOKE ?? "")
    .split(",")
    .map((backend) => backend.trim().toLowerCase())
    .filter(Boolean),
);

function shouldRunExternalSmoke(backend: "codex" | "claude"): boolean {
  return runnerSmokeBackends.has("all") || runnerSmokeBackends.has(backend);
}

describe("work CLI", () => {
  it("runs the V0 command flow as a black-box CLI", async () => {
    await withTempRepo(async (repo) => {
      const created = await runWork(repo, [
        "new",
        "Add login validation",
        "--id",
        "work-cli",
        "--acceptance",
        "Invalid login shows an error",
        "--validation",
        `${bunBin} --version`,
      ]);
      expect(created.exitCode).toBe(0);
      expect(created.stdout.trim()).toBe("work-cli");

      for (const args of [
        ["plan", "work-cli"],
        ["approve", "work-cli"],
        ["run", "work-cli", "--note", "external worker"],
        ["validate", "work-cli"],
        ["handoff", "work-cli"],
      ]) {
        const result = await runWork(repo, args);
        expect(result.exitCode).toBe(0);
      }

      const status = await runWork(repo, ["status", "work-cli"]);
      expect(status.stdout).toContain("work-cli completed");

      const trace = await runWork(repo, ["trace", "work-cli"]);
      expect(trace.stdout).toContain("validation.passed");

      const inspect = await runWork(repo, ["inspect", "work-cli", "events", "0"]);
      expect(inspect.stdout).toContain('"type": "work.created"');
      expect(inspect.stdout).toContain('"record_id": "event-000001"');

      const inspectById = await runWork(repo, ["inspect", "work-cli", "events", "event-000001"]);
      expect(inspectById.stdout).toContain('"type": "work.created"');

      const tasks = await runWork(repo, ["tasks", "work-cli"]);
      expect(tasks.stdout).toContain("task-001 ready worker-agent");
    });
  });

  it("executes the shell runner and records run evidence", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "new",
        "Shell runner work",
        "--id",
        "work-shell-runner",
        "--validation",
        `${bunBin} --version`,
      ]);
      await runWork(repo, ["plan", "work-shell-runner"]);
      await runWork(repo, ["approve", "work-shell-runner"]);

      const result = await runWork(repo, [
        "run",
        "work-shell-runner",
        "--backend",
        "shell",
        "--command",
        "printf 'shell-runner' > runner-output.txt",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(repo, "runner-output.txt"), "utf8")).toBe("shell-runner");

      const runLog = await readFile(
        join(repo, ".supermission", "work-shell-runner", "run.log"),
        "utf8",
      );
      expect(runLog).toContain("Backend: shell");
      expect(runLog).toContain("shell-runner");

      const status = await runWork(repo, ["status", "work-shell-runner"]);
      expect(status.stdout).toContain("needs_review");

      await runWork(repo, ["validate", "work-shell-runner"]);
      await runWork(repo, ["handoff", "work-shell-runner"]);
      const completed = await runWork(repo, ["status", "work-shell-runner"]);
      expect(completed.stdout).toContain("completed");
    });
  }, 120000);

  it("lists runner backend metadata", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["runner", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("record local");
      expect(result.stdout).toContain("shell local");
      expect(result.stdout).toContain("codex external profiles=cc-switch-or-native");
      expect(result.stdout).toContain("claude external profiles=native");
    });
  });

  it("hides terminal work from the default list", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Active draft", "--id", "active-draft"]);
      await runWork(repo, [
        "new",
        "Completed work",
        "--id",
        "completed-work",
        "--validation",
        `${bunBin} --version`,
      ]);
      await runWork(repo, ["new", "Failed work", "--id", "failed-work"]);
      await runWork(repo, ["new", "Cancelled work", "--id", "cancelled-work"]);
      await runWork(repo, ["new", "Aborted work", "--id", "aborted-work"]);
      await runWork(repo, ["plan", "completed-work"]);
      await runWork(repo, ["approve", "completed-work"]);
      await runWork(repo, ["run", "completed-work", "--note", "external worker"]);
      await runWork(repo, ["validate", "completed-work"]);
      await runWork(repo, ["handoff", "completed-work"]);
      await runWork(repo, ["validate", "failed-work", "--cmd", `${bunBin} -e "process.exit(7)"`]);
      for (const [id, status] of [
        ["cancelled-work", "cancelled"],
        ["aborted-work", "aborted"],
      ]) {
        const path = join(repo, ".supermission", id, "work.yaml");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace("status: draft", `status: ${status}`),
        );
      }

      const list = await runWork(repo, ["list"]);
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain("active-draft draft");
      expect(list.stdout).not.toContain("completed-work completed");
      expect(list.stdout).not.toContain("failed-work failed");
      expect(list.stdout).not.toContain("cancelled-work cancelled");
      expect(list.stdout).not.toContain("aborted-work aborted");

      const completed = await runWork(repo, ["list", "--status", "completed"]);
      expect(completed.exitCode).toBe(0);
      expect(completed.stdout).toContain("completed-work completed");

      const failed = await runWork(repo, ["list", "--status", "failed"]);
      expect(failed.exitCode).toBe(0);
      expect(failed.stdout).toContain("failed-work failed");

      const cancelled = await runWork(repo, ["list", "--status", "cancelled"]);
      expect(cancelled.exitCode).toBe(0);
      expect(cancelled.stdout).toContain("cancelled-work cancelled");

      const aborted = await runWork(repo, ["list", "--status", "aborted"]);
      expect(aborted.exitCode).toBe(0);
      expect(aborted.stdout).toContain("aborted-work aborted");
    });
  });

  it("uses project runner config when run options are omitted", async () => {
    await withTempRepo(async (repo) => {
      const init = await runWork(repo, [
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

      const show = await runWork(repo, ["runner", "config", "show"]);
      expect(show.stdout).toContain("configured-runner");

      await runWork(repo, ["new", "Configured runner work", "--id", "work-runner-config"]);
      await runWork(repo, ["plan", "work-runner-config"]);
      await runWork(repo, ["approve", "work-runner-config"]);

      const result = await runWork(repo, ["run", "work-runner-config"]);
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(repo, "runner-output.txt"), "utf8")).toBe("configured-runner");

      const runLog = await readFile(
        join(repo, ".supermission", "work-runner-config", "run.log"),
        "utf8",
      );
      expect(runLog).toContain("Backend: shell");
    });
  });

  it("runs a shell runner smoke test without creating a work", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
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

  it("retries runner smoke failures according to retry policy", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
        "runner",
        "smoke",
        "--backend",
        "shell",
        "--command",
        `${bunBin} -e "const fs = require('fs'); const file = 'retry-count.txt'; const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0; fs.writeFileSync(file, String(count + 1)); if (count === 0) process.exit(1); console.log('retry-ok');"`,
        "--retry-attempts",
        "2",
        "--retry-delay-ms",
        "0",
        "--retry-exit-code",
        "1",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("shell smoke exit 0");
      expect(result.stdout).toContain("retry-ok");
      expect(await readFile(join(repo, "retry-count.txt"), "utf8")).toBe("2");
    });
  });

  const codexSmoke = shouldRunExternalSmoke("codex") ? it : it.skip;
  codexSmoke(
    "smokes the codex runner backend",
    async () => {
      await withTempRepo(async (repo) => {
        await runWork(repo, ["new", "Codex runner work", "--id", "work-codex-runner"]);
        await runWork(repo, ["plan", "work-codex-runner"]);
        await runWork(repo, ["approve", "work-codex-runner"]);

        const args = [
          "run",
          "work-codex-runner",
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

        const result = await runWork(repo, args);
        const runLog = await readFile(
          join(repo, ".supermission", "work-codex-runner", "run.log"),
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
        await runWork(repo, ["new", "Claude runner work", "--id", "work-claude-runner"]);
        await runWork(repo, ["plan", "work-claude-runner"]);
        await runWork(repo, ["approve", "work-claude-runner"]);

        const args = [
          "run",
          "work-claude-runner",
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

        const result = await runWork(repo, args);
        const runLog = await readFile(
          join(repo, ".supermission", "work-claude-runner", "run.log"),
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
      await runWork(repo, ["new", "Inspect failure", "--id", "work-inspect"]);
      const result = await runWork(repo, ["inspect", "work-inspect", "events", "99"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("index out of range");
    });
  });

  it("rejects approving a draft work before planning", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Gate order CLI", "--id", "work-gate-cli"]);

      const result = await runWork(repo, ["approve", "work-gate-cli"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("approve_plan requires work status planned");

      const doctor = await runWork(repo, ["doctor", "work-gate-cli"]);
      expect(doctor.exitCode).toBe(1);
      expect(doctor.stdout).toContain("gate_waiting");
    });
  });

  it("supports controlled change proposal commands", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Change CLI", "--id", "work-change-cli"]);

      const proposed = await runWork(repo, [
        "change",
        "propose",
        "work-change-cli",
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

      const status = await runWork(repo, ["status", "work-change-cli"]);
      expect(status.stdout).toContain("needs_decision");

      const list = await runWork(repo, ["change", "list", "work-change-cli"]);
      expect(list.stdout).toContain("change-001 proposed workflow low");

      const show = await runWork(repo, ["change", "show", "work-change-cli", "change-001"]);
      expect(show.stdout).toContain("recommendation: update_acceptance");

      const approved = await runWork(repo, [
        "change",
        "approve",
        "work-change-cli",
        "change-001",
        "--reason",
        "Acceptable.",
      ]);
      expect(approved.exitCode).toBe(0);
      expect(approved.stdout).toContain("change-001 approved");

      const applied = await runWork(repo, [
        "change",
        "apply",
        "work-change-cli",
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

      const showApplied = await runWork(repo, ["change", "show", "work-change-cli", "change-001"]);
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
      await runWork(repo, ["new", "Checkpoint CLI", "--id", "work-checkpoint-cli"]);

      const diff = await runWork(repo, ["diff", "work-checkpoint-cli"]);
      expect(diff.exitCode).toBe(0);
      expect(diff.stdout).toContain("captured patch.diff");

      const created = await runWork(repo, [
        "checkpoint",
        "create",
        "work-checkpoint-cli",
        "--label",
        "before review",
      ]);
      expect(created.exitCode).toBe(0);
      expect(created.stdout).toContain("checkpoint-001");

      const list = await runWork(repo, ["checkpoint", "list", "work-checkpoint-cli"]);
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
      await runWork(repo, ["new", "Scoped Diff CLI", "--id", "work-scoped-diff-cli"]);
      await runWork(repo, [
        "task",
        "add",
        "work-scoped-diff-cli",
        "--title",
        "Source-only change",
        "--mutation-mode",
        "linear_write",
        "--scope-allow",
        "src/**",
      ]);
      await writeFile(join(repo, "src", "app.ts"), "after\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "after\n", "utf8");

      const diff = await runWork(repo, ["diff", "work-scoped-diff-cli", "--task", "task-002"]);
      expect(diff.exitCode).toBe(0);

      const doctor = await runWork(repo, ["doctor", "work-scoped-diff-cli"]);
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
      const worktreePath = join(repo, "..", "work-cli-worktree");

      try {
        await runWork(repo, ["new", "Isolation CLI", "--id", "work-isolation-cli"]);
        const branch = await runWork(repo, [
          "branch",
          "create",
          "work-isolation-cli",
          "--name",
          "work/cli-branch",
        ]);
        expect(branch.exitCode).toBe(0);
        expect(branch.stdout).toContain("work/cli-branch");

        const worktree = await runWork(repo, [
          "worktree",
          "create",
          "work-isolation-cli",
          "--path",
          worktreePath,
          "--branch",
          "work/cli-worktree",
        ]);
        expect(worktree.exitCode).toBe(0);
        expect(worktree.stdout).toContain(worktreePath);

        const rollback = await runWork(repo, ["rollback-plan", "work-isolation-cli"]);
        expect(rollback.exitCode).toBe(0);
        expect(rollback.stdout).toContain("rollback-plan.md written");

        await writeFile(join(repo, "app.txt"), "after\n", "utf8");
        await runWork(repo, [
          "checkpoint",
          "create",
          "work-isolation-cli",
          "--label",
          "before rollback check",
        ]);
        const rollbackCheck = await runWork(repo, ["rollback-check", "work-isolation-cli"]);
        expect(rollbackCheck.exitCode).toBe(0);
        expect(rollbackCheck.stdout).toContain("Rollback check passed");
      } finally {
        await runProcess("git", ["worktree", "remove", "--force", worktreePath], { cwd: repo });
        await rm(worktreePath, { recursive: true, force: true });
      }
    });
  });

  it("supports work doctor with blocking exit code", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Doctor CLI", "--id", "work-doctor-cli"]);
      const result = await runWork(repo, ["doctor", "work-doctor-cli"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("BLOCKING validation_missing");

      const json = await runWork(repo, ["doctor", "work-doctor-cli", "--json"]);
      expect(json.exitCode).toBe(1);
      expect(json.stdout).toContain('"code": "validation_missing"');
    });
  });

  it("supports project policy init and show commands", async () => {
    await withTempRepo(async (repo) => {
      const init = await runWork(repo, [
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

      const show = await runWork(repo, ["policy", "show"]);
      expect(show.stdout).toContain(`${bunBin} *`);
      expect(show.stdout).toContain("session-id=[A-Za-z0-9]+");

      await runWork(repo, [
        "new",
        "Policy CLI",
        "--id",
        "work-policy-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      const validation = await runWork(repo, ["validate", "work-policy-cli"]);
      expect(validation.exitCode).toBe(0);
    });
  });

  it("blocks risky validation commands from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "new",
        "Risky CLI",
        "--id",
        "work-risky-cli",
        "--validation",
        "rm -rf ./definitely-risky",
      ]);
      const result = await runWork(repo, ["validate", "work-risky-cli"]);
      expect(result.exitCode).toBe(3);

      const doctor = await runWork(repo, ["doctor", "work-risky-cli"]);
      expect(doctor.exitCode).toBe(1);
      expect(doctor.stdout).toContain("work_blocked");
    });
  });

  it("requires an approval gate before --allow-risky executes from the CLI", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "new",
        "Risky Gate CLI",
        "--id",
        "work-risky-gate-cli",
        "--validation",
        "rm -rf ./definitely-risky",
      ]);

      const missingGate = await runWork(repo, ["validate", "work-risky-gate-cli", "--allow-risky"]);
      expect(missingGate.exitCode).toBe(3);

      const approved = await runWork(repo, [
        "approve",
        "work-risky-gate-cli",
        "--gate",
        "approve_risky_command",
        "--reason",
        "Reviewed command in temp repo.",
      ]);
      expect(approved.exitCode).toBe(0);

      const allowed = await runWork(repo, ["validate", "work-risky-gate-cli", "--allow-risky"]);
      expect(allowed.exitCode).toBe(0);
    });
  });

  it("supports review artifact creation", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "new",
        "Review CLI",
        "--id",
        "work-review-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      await runWork(repo, ["validate", "work-review-cli"]);

      const review = await runWork(repo, ["review", "create", "work-review-cli"]);
      expect(review.exitCode).toBe(0);
      expect(review.stdout).toContain("review.md written");
    });
  });

  it("supports compact work summary", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "new",
        "Summary CLI",
        "--id",
        "work-summary-cli",
        "--validation",
        `${bunBin} --version`,
      ]);
      const summary = await runWork(repo, ["summary", "work-summary-cli"]);
      expect(summary.exitCode).toBe(0);
      expect(summary.stdout).toContain("work-summary-cli draft");
      expect(summary.stdout).toContain("Artifacts:");
    });
  });

  it("supports work monitor reports and supervisor inspection", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Monitor CLI", "--id", "work-monitor-cli"]);
      await runWork(repo, ["validate", "work-monitor-cli"]);

      const monitor = await runWork(repo, ["monitor", "work-monitor-cli"]);
      expect(monitor.exitCode).toBe(0);
      expect(monitor.stdout).toContain("Work: work-monitor-cli");
      expect(monitor.stdout).toContain("## Next Actions");

      const json = await runWork(repo, ["monitor", "work-monitor-cli", "--json"]);
      expect(json.exitCode).toBe(0);
      expect(json.stdout).toContain('"recent_signals"');

      const signal = await runWork(repo, ["inspect", "work-monitor-cli", "supervisor", "0"]);
      expect(signal.exitCode).toBe(0);
      expect(signal.stdout).toContain('"type": "validation_missing"');
    });
  });

  it("supports task ledger commands", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Task CLI", "--id", "work-task-cli"]);
      const added = await runWork(repo, [
        "task",
        "add",
        "work-task-cli",
        "--title",
        "Write test plan",
        "--actor-role",
        "tester-agent",
        "--mutation-mode",
        "sidecar_artifact",
        "--scope-allow",
        ".supermission/**",
      ]);
      expect(added.exitCode).toBe(0);
      expect(added.stdout).toContain("task-002 ready sidecar_artifact");

      const renamed = await runWork(repo, [
        "task",
        "rename",
        "work-task-cli",
        "task-002",
        "--title",
        "Review test plan",
      ]);
      expect(renamed.exitCode).toBe(0);
      expect(renamed.stdout).toContain("task-002 renamed - Review test plan");

      const status = await runWork(repo, [
        "task",
        "set-status",
        "work-task-cli",
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
      await runWork(repo, ["new", "Linear lock CLI", "--id", "work-linear-cli"]);
      await runWork(repo, [
        "task",
        "add",
        "work-linear-cli",
        "--title",
        "Second write",
        "--mutation-mode",
        "linear_write",
      ]);
      await runWork(repo, [
        "task",
        "add",
        "work-linear-cli",
        "--title",
        "Sidecar review",
        "--actor-role",
        "reviewer-agent",
        "--mutation-mode",
        "sidecar_artifact",
      ]);

      expect(
        (
          await runWork(repo, [
            "task",
            "set-status",
            "work-linear-cli",
            "task-001",
            "--status",
            "running",
          ])
        ).exitCode,
      ).toBe(0);

      const blocked = await runWork(repo, [
        "task",
        "set-status",
        "work-linear-cli",
        "task-002",
        "--status",
        "running",
      ]);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain("linear_write task task-001 is already running");

      const sidecar = await runWork(repo, [
        "task",
        "set-status",
        "work-linear-cli",
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
      await runWork(repo, ["new", "Scope CLI", "--id", "work-scope-cli"]);
      await runWork(repo, [
        "task",
        "add",
        "work-scope-cli",
        "--title",
        "Source-only change",
        "--mutation-mode",
        "linear_write",
        "--scope-allow",
        "src/**",
      ]);
      await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, "docs", "notes.md"), "outside\n", "utf8");

      const audit = await runWork(repo, ["task", "audit-scope", "work-scope-cli", "task-002"]);
      expect(audit.exitCode).toBe(0);
      expect(audit.stdout).toContain("1 violation");
      expect(audit.stdout).toContain("docs/notes.md");

      const doctor = await runWork(repo, ["doctor", "work-scope-cli"]);
      expect(doctor.stdout).toContain("scope_drift");
    });
  });
});
