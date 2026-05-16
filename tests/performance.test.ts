import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonl } from "../src/jsonl.js";
import { MissionStore } from "../src/store.js";
import { bunBin, runMission, withTempRepo } from "./helpers.js";

describe("performance and cost evidence", () => {
  it("records token usage and footprint fields from runner output", async () => {
    await withTempRepo(async (repo) => {
      await runMission(repo, ["new", "Token evidence", "--id", "mission-token-evidence"]);
      await runMission(repo, ["plan", "mission-token-evidence"]);
      await runMission(repo, ["approve", "mission-token-evidence"]);

      const result = await runMission(repo, [
        "run",
        "mission-token-evidence",
        "--backend",
        "shell",
        "--command",
        "printf 'ok\\ntokens used\\n1,234\\n'",
      ]);
      expect(result.exitCode).toBe(0);

      const toolCalls = await readJsonl<Record<string, unknown>>(
        join(repo, ".missions", "mission-token-evidence", "tool-calls.jsonl"),
      );
      expect(toolCalls).toContainEqual(
        expect.objectContaining({
          tool: "runner.shell",
          footprint_stage: "run",
          footprint_artifact: "run.log",
          evaluation_subject: "runner_execution",
          tokens_used: 1234,
        }),
      );

      const telemetry = await readJsonl<Record<string, unknown>>(
        join(repo, ".missions", "mission-token-evidence", "telemetry.jsonl"),
      );
      expect(telemetry).toContainEqual(
        expect.objectContaining({
          metric: "runner.executed",
          backend: "shell",
          tokens_used: 1234,
        }),
      );
    });
  });

  it("keeps mission summary reads under the local fixture budget", async () => {
    await withTempRepo(async (repo) => {
      const store = new MissionStore(repo);
      await store.createMission({
        id: "mission-summary-performance",
        goal: "Summary performance",
        actor: "local-user",
        acceptance: ["Summary stays fast"],
        validationCommands: [`${bunBin} --version`],
      });
      for (let index = 0; index < 50; index += 1) {
        await store.addTask("mission-summary-performance", {
          actor: "planner-agent",
          title: `Sidecar task ${index}`,
          actorRole: "worker-agent",
          mutationMode: "sidecar_artifact",
          dependsOn: [],
          scopeAllow: [".missions/**"],
          scopeDeny: [],
          validation: [],
        });
      }

      const started = performance.now();
      const summary = await store.summarizeMission("mission-summary-performance");
      const durationMs = performance.now() - started;

      expect(summary.tasks).toBe(51);
      expect(durationMs).toBeLessThan(250);
    });
  });

  it("runs a deterministic local cost fixture and writes report artifacts", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, "reports"), { recursive: true });
      await runMission(repo, ["new", "Cost fixture", "--id", "mission-cost-fixture"]);
      await runMission(repo, ["plan", "mission-cost-fixture"]);
      await runMission(repo, ["approve", "mission-cost-fixture"]);

      const command =
        "printf 'fixture-ok\\ntokens used\\n2,468\\n' && printf '{\"tokens\":2468,\"latency_ms\":10}\\n' > reports/cost.json";
      const started = performance.now();
      const result = await runMission(repo, [
        "run",
        "mission-cost-fixture",
        "--backend",
        "shell",
        "--command",
        command,
      ]);
      const durationMs = Math.round(performance.now() - started);

      expect(result.exitCode).toBe(0);
      const cost = JSON.parse(await readFile(join(repo, "reports", "cost.json"), "utf8")) as {
        tokens: number;
        latency_ms: number;
      };
      expect(cost.tokens).toBe(2468);
      expect(durationMs).toBeLessThan(2000);
    });
  });
});
