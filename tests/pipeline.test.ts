import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runWork, withTempRepo } from "./helpers.js";

describe("Pipeline system", () => {
  it("initializes default pipeline templates", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["pipeline", "init"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("feature.yaml");
      expect(result.stdout).toContain("bugfix.yaml");
      expect(result.stdout).toContain("deploy.yaml");

      // Verify files exist and are valid YAML
      const featureYaml = await readFile(
        join(repo, ".supermission", "pipelines", "feature.yaml"),
        "utf8",
      );
      const feature = YAML.parse(featureYaml);
      expect(feature.name).toBe("feature");
      expect(feature.stages).toHaveLength(4);
      expect(feature.stages.map((s: { id: string }) => s.id)).toEqual([
        "plan",
        "code",
        "test",
        "review",
      ]);
    });
  });

  it("lists available pipelines", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["pipeline", "init"]);
      const result = await runWork(repo, ["pipeline", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bugfix");
      expect(result.stdout).toContain("feature");
      expect(result.stdout).toContain("deploy");
      expect(result.stdout).toContain("reproduce → fix → verify");
    });
  });

  it("shows pipeline details", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["pipeline", "init"]);
      const result = await runWork(repo, ["pipeline", "show", "bugfix"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Pipeline: bugfix");
      expect(result.stdout).toContain("reproduce");
      expect(result.stdout).toContain("tester-agent");
    });
  });

  it("returns error for unknown pipeline", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["pipeline", "init"]);
      const result = await runWork(repo, ["pipeline", "show", "nonexistent"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown pipeline");
    });
  });

  it("lists no pipelines when not initialized", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["pipeline", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No pipelines found");
    });
  });
});
