import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runWork, withTempRepo } from "./helpers.js";

describe("supermission init", () => {
  it("detects available backends and writes runners.yaml", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["init", "--force"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Detecting available agent CLIs");
      expect(result.stdout).toContain("Done");

      // runners.yaml should exist
      const runnersYaml = await readFile(join(repo, ".supermission", "runners.yaml"), "utf8");
      const config = YAML.parse(runnersYaml);
      expect(config.fallback_order).toBeDefined();
      expect(Array.isArray(config.fallback_order)).toBe(true);
    });
  });

  it("does not overwrite existing config without --force", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["init", "--force"]);
      const result = await runWork(repo, ["init"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("already configured");
    });
  });
});

describe("supermission quick", () => {
  it("runs end-to-end with shell backend", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
        "quick",
        "Quick test task",
        "--id",
        "quick-001",
        "--backend",
        "shell",
        "--command",
        "echo quick-done",
        "--validation",
        "echo pass",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("created quick-001");
      expect(result.stdout).toContain("planned quick-001");
      expect(result.stdout).toContain("approved quick-001");
      expect(result.stdout).toContain("shell runner quick-001 exit 0");
      expect(result.stdout).toContain("validated quick-001");
      expect(result.stdout).toContain("done: quick-001");

      // Verify work record exists and is completed/validated
      const workYaml = await readFile(
        join(repo, ".supermission", "quick-001", "work.yaml"),
        "utf8",
      );
      const work = YAML.parse(workYaml);
      expect(work.status).toBe("completed");
    });
  });

  it("skips validation when no commands provided", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
        "quick",
        "No validation task",
        "--id",
        "quick-noval",
        "--backend",
        "shell",
        "--command",
        "echo done",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("no validation commands");
    });
  });

  it("reports failure when runner fails", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
        "quick",
        "Failing task",
        "--id",
        "quick-fail",
        "--backend",
        "shell",
        "--command",
        "exit 1",
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain("exit 1");
    });
  });

  it("supports Chinese content in goal", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, [
        "quick",
        "修复登录验证",
        "--id",
        "quick-cn",
        "--backend",
        "shell",
        "--command",
        "echo 完成",
        "--validation",
        "echo 通过",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("created quick-cn");

      const workYaml = await readFile(join(repo, ".supermission", "quick-cn", "work.yaml"), "utf8");
      const work = YAML.parse(workYaml);
      expect(work.goal).toBe("修复登录验证");
    });
  });
});

describe("supermission list", () => {
  it("lists works with status filter", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Task A", "--id", "list-a"]);
      await runWork(repo, ["new", "Task B", "--id", "list-b"]);
      await runWork(repo, ["plan", "list-a"]);

      const allResult = await runWork(repo, ["list"]);
      expect(allResult.exitCode).toBe(0);
      expect(allResult.stdout).toContain("list-a");
      expect(allResult.stdout).toContain("list-b");
      expect(allResult.stdout).toContain("2 work(s)");

      const draftResult = await runWork(repo, ["list", "--status", "draft"]);
      expect(draftResult.stdout).toContain("list-b");
      expect(draftResult.stdout).not.toContain("list-a");

      const plannedResult = await runWork(repo, ["list", "--status", "planned"]);
      expect(plannedResult.stdout).toContain("list-a");
      expect(plannedResult.stdout).not.toContain("list-b");
    });
  });

  it("supports --json output", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "JSON task", "--id", "list-json"]);
      const result = await runWork(repo, ["list", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("list-json");
    });
  });
});

describe("supermission cost", () => {
  it("shows cost report for a work record", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "quick",
        "Cost test",
        "--id",
        "cost-test",
        "--backend",
        "shell",
        "--command",
        "echo done",
        "--skip-handoff",
      ]);

      const result = await runWork(repo, ["cost", "cost-test"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Cost report: cost-test");
      expect(result.stdout).toContain("Total tokens:");
      expect(result.stdout).toContain("Runner calls: 1");
      expect(result.stdout).toContain("shell:");
    });
  });

  it("supports --json output", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, [
        "quick",
        "Cost JSON",
        "--id",
        "cost-json",
        "--backend",
        "shell",
        "--command",
        "echo done",
        "--skip-handoff",
      ]);

      const result = await runWork(repo, ["cost", "cost-json", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.runnerCalls).toBe(1);
      expect(data.byBackend.shell).toBeDefined();
    });
  });
});
