import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonl } from "../src/jsonl.js";
import { WorkStore } from "../src/store.js";
import { bunBin, runWork, withTempRepo } from "./helpers.js";

describe("performance and cost evidence", () => {
  it("records token usage and footprint fields from runner output", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Token evidence", "--id", "work-token-evidence"]);
      await runWork(repo, ["plan", "work-token-evidence"]);
      await runWork(repo, ["approve", "work-token-evidence"]);

      const result = await runWork(repo, [
        "run",
        "work-token-evidence",
        "--backend",
        "shell",
        "--command",
        "printf 'ok\\ntokens used\\n1,234\\n'",
      ]);
      expect(result.exitCode).toBe(0);

      const toolCalls = await readJsonl<Record<string, unknown>>(
        join(repo, ".supermission", "work-token-evidence", "tool-calls.jsonl"),
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
        join(repo, ".supermission", "work-token-evidence", "telemetry.jsonl"),
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

  it("keeps work summary reads under the local fixture budget", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-summary-performance",
        goal: "Summary performance",
        actor: "local-user",
        acceptance: ["Summary stays fast"],
        validationCommands: [`${bunBin} --version`],
      });
      for (let index = 0; index < 50; index += 1) {
        await store.addTask("work-summary-performance", {
          actor: "planner-agent",
          title: `Sidecar task ${index}`,
          actorRole: "worker-agent",
          mutationMode: "sidecar_artifact",
          dependsOn: [],
          scopeAllow: [".supermission/**"],
          scopeDeny: [],
          validation: [],
        });
      }

      const started = performance.now();
      const summary = await store.summarizeWork("work-summary-performance");
      const durationMs = performance.now() - started;

      expect(summary.tasks).toBe(51);
      expect(durationMs).toBeLessThan(250);
    });
  });

  it("runs a deterministic local cost fixture and writes report artifacts", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, "reports"), { recursive: true });
      await runWork(repo, ["new", "Cost fixture", "--id", "work-cost-fixture"]);
      await runWork(repo, ["plan", "work-cost-fixture"]);
      await runWork(repo, ["approve", "work-cost-fixture"]);

      const command =
        "printf 'fixture-ok\\ntokens used\\n2,468\\n' && printf '{\"tokens\":2468,\"latency_ms\":10}\\n' > reports/cost.json";
      const started = performance.now();
      const result = await runWork(repo, [
        "run",
        "work-cost-fixture",
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
