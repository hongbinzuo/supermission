import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import YAML from "yaml";
import { WORK_ROOT } from "./paths.js";
import { WorkStore } from "./store.js";
import { executeRunnerWithFallback, type RunnerBackend, RunnerBackendSchema } from "./runner.js";
import { utcNow } from "./time.js";

// --- Pipeline Schema ---

export const PipelineStageSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  backend: RunnerBackendSchema.optional(),
  prompt: z.string().optional(),
  command: z.string().optional(),
  validation: z.string().optional(),
  gate: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  skip_on_fail: z.boolean().default(false),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PipelineSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  stages: z.array(PipelineStageSchema).min(1),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

// --- Pipeline Paths ---

export function pipelinesDir(repo: string): string {
  return join(repo, WORK_ROOT, "pipelines");
}

// --- Pipeline Operations ---

export async function initPipelines(repo: string): Promise<void> {
  const dir = pipelinesDir(repo);
  await mkdir(dir, { recursive: true });

  // Create default feature pipeline
  const featurePipeline: Pipeline = {
    name: "feature",
    description: "Standard feature pipeline: plan → code → test → review",
    stages: [
      {
        id: "plan",
        role: "planner-agent",
        prompt: "Break down this feature into clear implementation steps. Output a numbered plan.",
        gate: "approve_plan",
        skip_on_fail: false,
      },
      {
        id: "code",
        role: "worker-agent",
        prompt:
          "Implement the feature according to the approved plan. Make minimal, focused changes.",
        skip_on_fail: false,
      },
      {
        id: "test",
        role: "tester-agent",
        prompt: "Write comprehensive tests for the implementation. Cover edge cases.",
        validation: "bun run test",
        skip_on_fail: false,
      },
      {
        id: "review",
        role: "reviewer-agent",
        prompt:
          "Review all code changes. Report any issues, security concerns, or improvements needed.",
        gate: "approve_review",
        skip_on_fail: false,
      },
    ],
  };

  const bugfixPipeline: Pipeline = {
    name: "bugfix",
    description: "Quick bugfix pipeline: reproduce → fix → test",
    stages: [
      {
        id: "reproduce",
        role: "tester-agent",
        prompt: "Write a failing test that reproduces this bug.",
        skip_on_fail: false,
      },
      {
        id: "fix",
        role: "worker-agent",
        prompt: "Fix the bug. The failing test should now pass.",
        skip_on_fail: false,
      },
      {
        id: "verify",
        role: "tester-agent",
        validation: "bun run test",
        prompt: "Run all tests and verify the fix doesn't break anything else.",
        skip_on_fail: false,
      },
    ],
  };

  const deployPipeline: Pipeline = {
    name: "deploy",
    description: "Full pipeline with deployment: plan → code → test → review → deploy",
    stages: [
      {
        id: "plan",
        role: "planner-agent",
        prompt: "Break down this work into implementation steps.",
        gate: "approve_plan",
        skip_on_fail: false,
      },
      {
        id: "code",
        role: "worker-agent",
        prompt: "Implement according to the plan.",
        skip_on_fail: false,
      },
      {
        id: "test",
        role: "tester-agent",
        prompt: "Write and run tests.",
        validation: "bun run test",
        skip_on_fail: false,
      },
      {
        id: "review",
        role: "reviewer-agent",
        prompt: "Review code changes for quality and security.",
        gate: "approve_review",
        skip_on_fail: false,
      },
      {
        id: "deploy",
        role: "deploy-agent",
        backend: "shell",
        command:
          "echo 'deploy step: configure your deploy command in .supermission/pipelines/deploy.yaml'",
        skip_on_fail: false,
      },
    ],
  };

  await writeFile(join(dir, "feature.yaml"), YAML.stringify(featurePipeline), "utf8");
  await writeFile(join(dir, "bugfix.yaml"), YAML.stringify(bugfixPipeline), "utf8");
  await writeFile(join(dir, "deploy.yaml"), YAML.stringify(deployPipeline), "utf8");
}

export async function listPipelines(repo: string): Promise<Pipeline[]> {
  const dir = pipelinesDir(repo);
  try {
    const files = await readdir(dir);
    const pipelines: Pipeline[] = [];
    for (const file of files.filter((f) => f.endsWith(".yaml")).sort()) {
      const text = await readFile(join(dir, file), "utf8");
      pipelines.push(PipelineSchema.parse(YAML.parse(text)));
    }
    return pipelines;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

export async function readPipeline(repo: string, name: string): Promise<Pipeline> {
  const dir = pipelinesDir(repo);
  const path = join(dir, `${name}.yaml`);
  try {
    const text = await readFile(path, "utf8");
    return PipelineSchema.parse(YAML.parse(text));
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      throw new Error(`unknown pipeline: ${name}. Run \`supermission pipeline list\``);
    }
    throw error;
  }
}

// --- Pipeline Execution ---

export type PipelineRunOptions = {
  goal: string;
  workId?: string;
  skipStages?: string[];
  actor?: string;
  acceptance?: string[];
  validation?: string[];
};

export type PipelineRunResult = {
  workId: string;
  pipeline: string;
  stages: StageResult[];
  status: "completed" | "failed" | "gate_waiting";
};

export type StageResult = {
  id: string;
  status: "completed" | "failed" | "skipped" | "gate_waiting";
  durationMs: number;
  backend?: string;
  exitCode?: number;
  message?: string;
};

export async function runPipeline(
  store: WorkStore,
  pipeline: Pipeline,
  options: PipelineRunOptions,
): Promise<PipelineRunResult> {
  const actor = options.actor ?? "local-user";

  // 1. Create work record
  const workId = await store.createWork({
    id: options.workId,
    goal: options.goal,
    actor,
    acceptance: options.acceptance ?? [],
    validationCommands: options.validation ?? [],
  });

  console.log(`pipeline:${pipeline.name} created ${workId}`);

  // 2. Plan (auto)
  await store.writePlan(workId, "planner-agent", `Pipeline: ${pipeline.name}`);
  console.log(`pipeline:${pipeline.name} planned ${workId}`);

  // 3. Approve plan (auto for pipeline)
  await store.approve(workId, actor, "approve_plan", "Pipeline auto-approve");
  console.log(`pipeline:${pipeline.name} approved ${workId}`);

  // 4. Execute stages
  const runnerConfig = await store.readRunnerConfig();
  const spec = await store.beginRun(workId, actor);
  const stageResults: StageResult[] = [];

  for (const stage of pipeline.stages) {
    // Skip if requested
    if (options.skipStages?.includes(stage.id)) {
      stageResults.push({
        id: stage.id,
        status: "skipped",
        durationMs: 0,
        message: "skipped by user",
      });
      console.log(`pipeline:${pipeline.name} [${stage.id}] skipped`);
      continue;
    }

    // Check for gate (requires human approval)
    if (stage.gate && stage.gate !== "approve_plan") {
      console.log(`pipeline:${pipeline.name} [${stage.id}] waiting for gate: ${stage.gate}`);
      console.log(`  Run: supermission approve ${workId} --gate ${stage.gate}`);
      stageResults.push({
        id: stage.id,
        status: "gate_waiting",
        durationMs: 0,
        message: `waiting: ${stage.gate}`,
      });

      // Record partial progress
      await store.appendEvent(workId, "pipeline.gate.waiting", actor, {
        pipeline: pipeline.name,
        stage: stage.id,
        gate: stage.gate,
      });

      return { workId, pipeline: pipeline.name, stages: stageResults, status: "gate_waiting" };
    }

    // Execute stage
    const started = performance.now();
    const stagePrompt = buildStagePrompt(stage, options.goal, spec.acceptance);

    try {
      if (stage.backend === "shell" || stage.command) {
        // Shell execution
        const { executeRunner } = await import("./runner.js");
        const execution = await executeRunner(
          "shell",
          {
            repo: store.repo,
            work: spec,
            actor: stage.role,
          },
          {
            command: stage.command ?? "echo 'no command configured'",
            timeoutMs: stage.timeout_ms,
          },
        );

        const durationMs = Math.round(performance.now() - started);
        if (execution.exitCode !== 0 && !stage.skip_on_fail) {
          stageResults.push({
            id: stage.id,
            status: "failed",
            durationMs,
            backend: "shell",
            exitCode: execution.exitCode,
          });
          console.log(
            `pipeline:${pipeline.name} [${stage.id}] FAILED (exit ${execution.exitCode})`,
          );
          await store.updateStatus(workId, "failed", actor, `stage ${stage.id} failed`);
          return { workId, pipeline: pipeline.name, stages: stageResults, status: "failed" };
        }
        stageResults.push({
          id: stage.id,
          status: "completed",
          durationMs,
          backend: "shell",
          exitCode: execution.exitCode,
        });
      } else {
        // Agent execution via smart selection
        const execution = await executeRunnerWithFallback(
          runnerConfig,
          { repo: store.repo, work: spec, actor: stage.role },
          {
            actorRole: stage.role,
            explicit: stage.backend as RunnerBackend | undefined,
            prompt: stagePrompt,
            timeoutMs: stage.timeout_ms,
          },
        );

        const durationMs = Math.round(performance.now() - started);
        if (execution.exitCode !== 0 && !stage.skip_on_fail) {
          stageResults.push({
            id: stage.id,
            status: "failed",
            durationMs,
            backend: execution.backend,
            exitCode: execution.exitCode,
          });
          console.log(
            `pipeline:${pipeline.name} [${stage.id}] FAILED (${execution.backend} exit ${execution.exitCode})`,
          );
          await store.updateStatus(workId, "failed", actor, `stage ${stage.id} failed`);
          return { workId, pipeline: pipeline.name, stages: stageResults, status: "failed" };
        }
        stageResults.push({
          id: stage.id,
          status: "completed",
          durationMs,
          backend: execution.backend,
          exitCode: execution.exitCode,
        });
      }

      console.log(
        `pipeline:${pipeline.name} [${stage.id}] ✓ (${stageResults[stageResults.length - 1].durationMs}ms)`,
      );

      // Run validation if configured
      if (stage.validation) {
        console.log(`pipeline:${pipeline.name} [${stage.id}] validating...`);
        const valResult = await store.validate(workId, "validator-agent", {
          commands: [stage.validation],
        });
        if (valResult.exitCode !== 0) {
          stageResults.push({
            id: `${stage.id}:validate`,
            status: "failed",
            durationMs: valResult.durationMs,
            exitCode: valResult.exitCode,
          });
          console.log(`pipeline:${pipeline.name} [${stage.id}] validation FAILED`);
          if (!stage.skip_on_fail) {
            await store.updateStatus(
              workId,
              "failed",
              actor,
              `stage ${stage.id} validation failed`,
            );
            return { workId, pipeline: pipeline.name, stages: stageResults, status: "failed" };
          }
        }
      }

      // Record stage completion event
      await store.appendEvent(workId, "pipeline.stage.completed", actor, {
        pipeline: pipeline.name,
        stage: stage.id,
        backend: stageResults[stageResults.length - 1].backend,
        duration_ms: stageResults[stageResults.length - 1].durationMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Math.round(performance.now() - started);
      stageResults.push({ id: stage.id, status: "failed", durationMs, message });
      console.log(`pipeline:${pipeline.name} [${stage.id}] ERROR: ${message}`);
      if (!stage.skip_on_fail) {
        await store.updateStatus(workId, "failed", actor, message);
        return { workId, pipeline: pipeline.name, stages: stageResults, status: "failed" };
      }
    }
  }

  // All stages completed — mark as needs_review then validated
  await store.recordRunnerExecution(workId, actor, {
    backend: "record",
    started_at: utcNow(),
    finished_at: utcNow(),
    exitCode: 0,
    durationMs: stageResults.reduce((sum, s) => sum + s.durationMs, 0),
    stdout: `Pipeline ${pipeline.name} completed all stages`,
    stderr: "",
    prompt: options.goal,
    response: `Completed ${stageResults.filter((s) => s.status === "completed").length}/${pipeline.stages.length} stages`,
  });

  console.log(`\npipeline:${pipeline.name} ✓ all stages completed for ${workId}`);
  return { workId, pipeline: pipeline.name, stages: stageResults, status: "completed" };
}

function buildStagePrompt(stage: PipelineStage, goal: string, acceptance: string[]): string {
  const lines = [`Stage: ${stage.id}`, `Role: ${stage.role}`, `Goal: ${goal}`, ""];
  if (acceptance.length > 0) {
    lines.push("Acceptance criteria:");
    for (const item of acceptance) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  if (stage.prompt) {
    lines.push("Instructions:", stage.prompt, "");
  }
  lines.push("Return a concise summary of what you did.");
  return lines.join("\n");
}
