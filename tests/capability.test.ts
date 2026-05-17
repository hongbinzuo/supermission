import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { readJsonl } from "../src/jsonl.js";
import { bunBin, runWork, withTempRepo } from "./helpers.js";

type CapabilityFixture = {
  id: string;
  goal: string;
  acceptance: string[];
  validation_commands: string[];
  runner: {
    backend: "shell";
    command: string;
  };
  budgets: {
    max_duration_ms: number;
    max_tokens_used: number;
  };
  required_artifacts: string[];
};

describe("Supermission capability baseline", () => {
  it("completes the local work workflow with evidence and budgets", async () => {
    const fixture = YAML.parse(
      await readFile(join(process.cwd(), "evals", "supermission-capability-baseline.yaml"), "utf8"),
    ) as CapabilityFixture;

    await withTempRepo(async (repo) => {
      const workId = "capability-baseline";
      const started = performance.now();
      const newArgs = [
        "new",
        fixture.goal,
        "--id",
        workId,
        "--validation",
        fixture.validation_commands[0]?.replace(/^bun\b/, bunBin) ?? `${bunBin} --version`,
      ];
      for (const item of fixture.acceptance) {
        newArgs.push("--acceptance", item);
      }

      await expectExitZero(repo, newArgs);
      await expectExitZero(repo, ["plan", workId, "--note", "Capability baseline plan"]);
      await expectExitZero(repo, ["requirements", "check", workId]);
      await expectExitZero(repo, ["approve", workId, "--reason", "Baseline plan approved"]);
      await expectExitZero(repo, [
        "run",
        workId,
        "--backend",
        fixture.runner.backend,
        "--command",
        fixture.runner.command,
      ]);
      await expectExitZero(repo, ["validate", workId]);
      await expectExitZero(repo, ["review", "create", workId]);
      await expectExitZero(repo, ["handoff", workId]);

      const durationMs = performance.now() - started;
      expect(durationMs).toBeLessThan(fixture.budgets.max_duration_ms);

      const status = await runWork(repo, ["status", workId]);
      expect(status.stdout).toContain(`${workId} completed`);

      const summary = await runWork(repo, ["summary", workId]);
      expect(summary.stdout).toContain("Validation commands: 1");
      expect(summary.stdout).toContain("Tasks: 1");

      const trace = await runWork(repo, ["trace", workId]);
      expect(trace.stdout).toContain("work.created");
      expect(trace.stdout).toContain("requirements.analysis.created");
      expect(trace.stdout).toContain("runner.executed");
      expect(trace.stdout).toContain("validation.passed");

      const workRoot = join(repo, ".supermission", workId);
      for (const artifact of fixture.required_artifacts) {
        await expect(readFile(join(workRoot, artifact), "utf8")).resolves.toBeDefined();
      }

      const runLog = await readFile(join(workRoot, "run.log"), "utf8");
      expect(runLog).toContain("Backend: shell");
      expect(runLog).toContain("capability-ok");

      const review = await readFile(join(workRoot, "review.md"), "utf8");
      expect(review).toContain("Review");

      const requirementsAnalysis = await readFile(
        join(workRoot, "requirements-analysis.md"),
        "utf8",
      );
      expect(requirementsAnalysis).toContain("Requirements Analysis");

      const handoff = await readFile(join(workRoot, "handoff.md"), "utf8");
      expect(handoff).toContain("Work: capability-baseline");
      expect(handoff).toContain("Evidence");

      const toolCalls = await readJsonl<Record<string, unknown>>(
        join(workRoot, "tool-calls.jsonl"),
      );
      expect(toolCalls).toContainEqual(
        expect.objectContaining({
          tool: "runner.shell",
          footprint_stage: "run",
          footprint_artifact: "run.log",
          evaluation_subject: "runner_execution",
          tokens_used: 321,
        }),
      );

      const telemetry = await readJsonl<Record<string, unknown>>(join(workRoot, "telemetry.jsonl"));
      expect(telemetry).toContainEqual(
        expect.objectContaining({
          metric: "runner.executed",
          backend: "shell",
          tokens_used: 321,
        }),
      );
      const tokenTelemetry = telemetry.find(
        (entry) => entry.metric === "runner.executed" && entry.backend === "shell",
      );
      expect(Number(tokenTelemetry?.tokens_used)).toBeLessThanOrEqual(
        fixture.budgets.max_tokens_used,
      );
    });
  });

  it("analyzes requirements quality before implementation", async () => {
    await withTempRepo(async (repo) => {
      await expectExitZero(repo, [
        "new",
        "Requirement analysis",
        "--id",
        "requirements-analysis",
        "--acceptance",
        "The system must allow export",
        "--acceptance",
        "The system must not allow export",
        "--acceptance",
        "The UI should be fast and intuitive",
      ]);

      const result = await runWork(repo, [
        "requirements",
        "check",
        "requirements-analysis",
        "--block-on-findings",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("requirements requirements-analysis");
      expect(result.stdout).toContain("blocking");

      const workRoot = join(repo, ".supermission", "requirements-analysis");
      const report = await readFile(join(workRoot, "requirements-analysis.md"), "utf8");
      expect(report).toContain("Requirements Analysis");
      expect(report).toContain("inconsistency");
      expect(report).toContain("ambiguity");
      expect(report).toContain("Option A");
      expect(report).toContain("Option B");

      const events = await readJsonl<Record<string, unknown>>(join(workRoot, "events.jsonl"));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "requirements.analysis.created",
          artifact: "requirements-analysis.md",
        }),
      );

      const telemetry = await readJsonl<Record<string, unknown>>(join(workRoot, "telemetry.jsonl"));
      expect(telemetry).toContainEqual(
        expect.objectContaining({
          metric: "requirements.analysis",
          blocking: 1,
        }),
      );

      const signals = await readJsonl<Record<string, unknown>>(
        join(workRoot, "supervisor-signals.jsonl"),
      );
      expect(signals).toContainEqual(
        expect.objectContaining({
          type: "requirements_quality",
          severity: "blocking",
        }),
      );
    });
  });
});

async function expectExitZero(repo: string, args: string[]) {
  const result = await runWork(repo, args);
  expect(result.exitCode, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`).toBe(0);
  return result;
}
