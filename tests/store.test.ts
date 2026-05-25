import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import YAML from "yaml";
import { readJsonl } from "../src/jsonl.js";
import { slugify } from "../src/slug.js";
import { WorkStore } from "../src/store.js";
import { WorkSpecSchema } from "../src/types.js";
import { utcNow } from "../src/time.js";
import { bunBin, runProcess, withTempRepo } from "./helpers.js";

function defaultRetry() {
  return { attempts: 1, delay_ms: 0, exit_codes: [1, 124] };
}

describe("slugify", () => {
  it("generates a non-empty safe slug for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const slug = slugify(value);
        expect(slug.length).toBeGreaterThan(0);
        expect(slug.length).toBeLessThanOrEqual(48);
        expect(slug).toMatch(/^[a-z0-9-]+$/);
      }),
    );
  });

  it("normalizes specific slug edge cases", () => {
    expect(slugify("  Hello, WORLD!! auth/login  ")).toBe("hello-world-auth-login");
    expect(slugify("  auth  ")).toBe("auth");
    expect(slugify("auth---")).toBe("auth");
    expect(slugify("---auth")).toBe("auth");
    expect(slugify("----")).toBe("work");
    expect(slugify("a".repeat(80))).toBe("a".repeat(48));
  });
});

describe("record helpers", () => {
  it("reads JSONL files with blank lines and returns an empty list for missing files", async () => {
    await withTempRepo(async (repo) => {
      const file = join(repo, "records.jsonl");
      await writeFile(file, '\n{"type":"one"}\n  \n{"type":"two"}\n', "utf8");

      expect(await readJsonl(file)).toEqual([{ type: "one" }, { type: "two" }]);
      expect(await readJsonl(join(repo, "missing.jsonl"))).toEqual([]);
    });
  });

  it("does not hide non-missing JSONL read errors", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, "records-dir"));

      await expect(readJsonl(join(repo, "records-dir"))).rejects.toThrow();
    });
  });

  it("emits UTC timestamps without millisecond precision", () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("WorkStore", () => {
  it("creates orchestration-ready work artifacts", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      const workId = await store.createWork({
        id: "work-test",
        goal: "Add login validation",
        actor: "local-user",
        acceptance: ["Invalid logins show an error"],
        validationCommands: [`${bunBin} --version`],
      });

      expect(workId).toBe("work-test");
      const spec = await store.readWork(workId);
      expect(spec.status).toBe("draft");
      expect(spec.actors).toEqual([
        "planner-agent",
        "worker-agent",
        "validator-agent",
        "reviewer-agent",
        "handoff-agent",
        "supervisor-agent",
      ]);
      expect(spec.workflow).toEqual([
        "research",
        "plan",
        "approve",
        "implement",
        "validate",
        "handoff",
      ]);

      const tasks = await store.listTasks(workId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.status).toBe("ready");
      expect(tasks[0]?.actor_role).toBe("worker-agent");
      expect(tasks[0]?.depends_on).toEqual([]);
      expect(tasks[0]?.scope).toEqual({ allow: [], deny: [] });

      const events = await store.readEvents(workId);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "work.created",
          actor: "local-user",
          goal: "Add login validation",
        }),
      );
      expect(events[0]).toMatchObject({ record_id: "event-000001" });
      expect(
        await readFile(join(repo, ".supermission", "work-test", "events.jsonl"), "utf8"),
      ).toContain('"record_id":"event-000001"');
      expect(await store.readTelemetry(workId)).toContainEqual(
        expect.objectContaining({ metric: "work.created", status: "draft" }),
      );
      await expect(
        readFile(join(repo, ".supermission", "work-test", "plan.md"), "utf8"),
      ).resolves.toContain("Run `supermission plan`");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "decisions.md"), "utf8"),
      ).resolves.toContain("Record decisions");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "scope-audit.md"), "utf8"),
      ).resolves.toContain("supermission task audit-scope");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "review.md"), "utf8"),
      ).resolves.toContain("Record review findings");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "monitor.md"), "utf8"),
      ).resolves.toContain("Run `supermission monitor`");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "debug.md"), "utf8"),
      ).resolves.toContain("No debug notes yet");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "handoff.md"), "utf8"),
      ).resolves.toContain("Run `supermission handoff`");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "validation.log"), "utf8"),
      ).resolves.toBe("");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "run.log"), "utf8"),
      ).resolves.toContain("TBD: Run the work with a runner.");
      await expect(
        readFile(join(repo, ".supermission", "work-test", "patch.diff"), "utf8"),
      ).resolves.toBe("");
    });
  });

  it("generates sequential numeric work ids when no explicit id is provided", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      const workId = await store.createWork({
        goal: "Ship Login Flow!",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      expect(workId).toBe("1");
      await expect(store.readWork(workId)).resolves.toMatchObject({
        id: workId,
        goal: "Ship Login Flow!",
      });

      const workId2 = await store.createWork({
        goal: "Second task",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      expect(workId2).toBe("2");
    });
  });

  it("rejects unknown work reads with a useful error", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);

      await expect(store.readWork("missing-work")).rejects.toThrow("unknown work: missing-work");
    });
  });

  it("rejects duplicate work ids", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-duplicate",
        goal: "Original",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      await expect(
        store.createWork({
          id: "work-duplicate",
          goal: "Duplicate",
          actor: "local-user",
          acceptance: [],
          validationCommands: [],
        }),
      ).rejects.toThrow("work already exists: work-duplicate");
    });
  });

  it("lists work ids sorted and ignores incomplete work directories", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-b",
        goal: "B",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await store.createWork({
        id: "work-a",
        goal: "A",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await mkdir(join(repo, ".supermission", "incomplete"), { recursive: true });

      expect(await store.listWorkIds()).toEqual(["work-a", "work-b"]);
    });
  });

  it("returns no works when work root is missing and rejects invalid roots", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      expect(await store.listWorkIds()).toEqual([]);

      await writeFile(join(repo, ".supermission"), "not a directory\n", "utf8");
      await expect(store.listWorkIds()).rejects.toThrow();
    });
  });

  it("writes and reads project validation policy", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await expect(store.readPolicy()).resolves.toEqual({
        validation_allowlist: [],
        redaction: { patterns: [] },
      });

      await store.writePolicy({
        validation_allowlist: ["bun run test", `${bunBin} *`],
        redaction: { patterns: ["session-id=[A-Za-z0-9]+"] },
      });

      expect(await store.readPolicy()).toEqual({
        validation_allowlist: ["bun run test", `${bunBin} *`],
        redaction: { patterns: ["session-id=[A-Za-z0-9]+"] },
      });
      expect(await readFile(join(repo, ".supermission", "policy.yaml"), "utf8")).toContain(
        "validation_allowlist",
      );
      expect(await readFile(join(repo, ".supermission", "policy.yaml"), "utf8")).toContain(
        "redaction",
      );
    });
  });

  it("writes and reads project runner config", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await expect(store.readRunnerConfig()).resolves.toEqual({
        default_backend: "auto",
        fallback_order: [],
        routing: {},
        backends: {
          record: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          shell: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          codex: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          claude: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          gemini: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          aider: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          opencode: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          copilot: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          "amazon-q": { fallback_profiles: [], tools: [], retry: defaultRetry() },
          goose: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          kiro: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          grok: { fallback_profiles: [], tools: [], retry: defaultRetry() },
        },
      });

      await store.writeRunnerConfig({
        default_backend: "shell",
        fallback_order: [],
        routing: {},
        backends: {
          record: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          shell: {
            command: "printf configured > runner-output.txt",
            fallback_profiles: [],
            tools: [],
            retry: defaultRetry(),
          },
          codex: {
            fallback_profiles: ["nf"],
            profile: "kktest",
            tools: [],
            timeout_ms: 60000,
            retry: { attempts: 2, delay_ms: 0, exit_codes: [1, 124] },
          },
          claude: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          gemini: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          aider: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          opencode: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          copilot: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          "amazon-q": { fallback_profiles: [], tools: [], retry: defaultRetry() },
          goose: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          kiro: { fallback_profiles: [], tools: [], retry: defaultRetry() },
          grok: { fallback_profiles: [], tools: [], retry: defaultRetry() },
        },
      });

      expect(await store.readRunnerConfig()).toMatchObject({
        default_backend: "shell",
        backends: {
          shell: { command: "printf configured > runner-output.txt" },
          codex: {
            profile: "kktest",
            fallback_profiles: ["nf"],
            timeout_ms: 60000,
            retry: { attempts: 2 },
          },
        },
      });
      expect((await store.readRunnerConfig()).backends.codex.retry).toEqual({
        attempts: 2,
        delay_ms: 0,
        exit_codes: [1, 124],
      });
      expect(await readFile(join(repo, ".supermission", "runners.yaml"), "utf8")).toContain(
        "default_backend: shell",
      );
    });
  });

  it("rejects invalid project policy files", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await mkdir(join(repo, ".supermission"), { recursive: true });
      await writeFile(
        join(repo, ".supermission", "policy.yaml"),
        YAML.stringify({ validation_allowlist: "bun run test" }),
        "utf8",
      );

      await expect(store.readPolicy()).rejects.toThrow();
    });
  });

  it("redacts custom policy patterns during validation", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-custom-redaction",
        goal: "Custom redaction",
        actor: "local-user",
        acceptance: [],
        validationCommands: [
          `${bunBin} -e "console.log('session-id=abc123'); console.log('VISIBLE=ok')"`,
        ],
      });
      await store.writePolicy({
        validation_allowlist: [`${bunBin} *`],
        redaction: { patterns: ["session-id=[A-Za-z0-9]+"] },
      });

      await store.validate("work-custom-redaction", "validator-agent");
      const validationLog = await readFile(
        join(repo, ".supermission", "work-custom-redaction", "validation.log"),
        "utf8",
      );

      expect(validationLog).toContain("[REDACTED]");
      expect(validationLog).toContain("VISIBLE=ok");
      expect(validationLog).not.toContain("session-id=abc123");
    });
  });

  it("preserves acceptance and validation commands through YAML roundtrip", async () => {
    await withTempRepo(async (repo) => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 60 }), { maxLength: 8 }),
          fc.array(fc.string({ minLength: 1, maxLength: 60 }), { maxLength: 8 }),
          async (acceptance, validationCommands) => {
            const store = new WorkStore(repo);
            const workId = `work-${randomUUID()}`;
            await store.createWork({
              id: workId,
              goal: "Roundtrip work",
              actor: "local-user",
              acceptance,
              validationCommands,
            });
            const spec = await store.readWork(workId);
            expect(spec.acceptance).toEqual(acceptance);
            expect(spec.validation_commands).toEqual(validationCommands);
          },
        ),
        { numRuns: 25 },
      );
    });
  });

  it("runs the happy path and writes validation evidence", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-flow",
        goal: "Complete a work",
        actor: "local-user",
        acceptance: ["Validation passes"],
        validationCommands: [`${bunBin} --version`],
      });

      await store.writePlan("work-flow", "planner-agent");
      await store.approve("work-flow", "local-user");
      await store.recordRun("work-flow", "worker-agent", "implemented externally");
      const result = await store.validate("work-flow", "validator-agent");
      await store.writeHandoff("work-flow", "handoff-agent");

      expect(result.exitCode).toBe(0);
      expect((await store.readWork("work-flow")).status).toBe("completed");
      expect(
        await readFile(join(repo, ".supermission", "work-flow", "validation.log"), "utf8"),
      ).toContain("Exit code: 0");

      const eventTypes = (await store.readEvents("work-flow")).map((event) => event.type);
      expect(eventTypes).toContain("plan.proposed");
      expect(eventTypes).toContain("validation.passed");
      expect(eventTypes).toContain("handoff.created");
    });
  });

  it("rejects out-of-order workflow gates with supervisor evidence", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-state-gates",
        goal: "Enforce workflow order",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });

      await expect(store.approve("work-state-gates", "local-user")).rejects.toThrow(
        "approve_plan requires work status planned",
      );
      await expect(store.recordRun("work-state-gates", "worker-agent")).rejects.toThrow(
        "run requires work status approved or needs_review or failed or blocked",
      );
      await expect(store.writeHandoff("work-state-gates", "handoff-agent")).rejects.toThrow(
        "handoff completion requires work status validated",
      );

      const signals = await store.readSupervisorSignals("work-state-gates");
      expect(signals).toContainEqual(
        expect.objectContaining({
          type: "gate_waiting",
          severity: "blocking",
          message: expect.stringContaining("approve_plan requires work status planned"),
        }),
      );
      expect((await store.readEvents("work-state-gates")).map((event) => event.type)).toContain(
        "workflow.blocked",
      );
    });
  });

  it("allows handoff drafts when completion is explicitly disabled", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-handoff-draft",
        goal: "Draft handoff",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      await expect(
        store.writeHandoff("work-handoff-draft", "handoff-agent", false),
      ).resolves.toBeUndefined();
      expect((await store.readWork("work-handoff-draft")).status).toBe("draft");
    });
  });

  it("records failure, debug notes, and failed status", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-fail",
        goal: "Fail validation",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} -e 'process.exit(7)'`],
      });

      const result = await store.validate("work-fail", "validator-agent");
      const debug = await readFile(join(repo, ".supermission", "work-fail", "debug.md"), "utf8");

      expect(result.exitCode).toBe(7);
      expect((await store.readWork("work-fail")).status).toBe("failed");
      expect(debug).toContain("Validation failed with exit code 7");
    });
  });

  it("redacts common secrets from validation logs and tool-call records", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-redaction",
        goal: "Redact validation output",
        actor: "local-user",
        acceptance: [],
        validationCommands: [
          `API_TOKEN=abc123secret ${bunBin} -e "console.log('OPENAI_API_KEY=sk-testsecret123456'); console.error('Authorization: Bearer bearer-secret-123')"`,
        ],
      });

      await store.validate("work-redaction", "validator-agent");
      const validationLog = await readFile(
        join(repo, ".supermission", "work-redaction", "validation.log"),
        "utf8",
      );
      const toolCalls = await readFile(
        join(repo, ".supermission", "work-redaction", "tool-calls.jsonl"),
        "utf8",
      );

      expect(validationLog).toContain("API_TOKEN=[REDACTED]");
      expect(validationLog).toContain("OPENAI_API_KEY=[REDACTED]");
      expect(validationLog).toContain("Authorization: Bearer [REDACTED]");
      expect(validationLog).not.toContain("abc123secret");
      expect(validationLog).not.toContain("sk-testsecret123456");
      expect(validationLog).not.toContain("bearer-secret-123");
      expect(toolCalls).not.toContain("abc123secret");
    });
  });

  it("redacts lowercase, header, JSON, and source-control token variants", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-redaction-variants",
        goal: "Redact variant secret shapes",
        actor: "local-user",
        acceptance: [],
        validationCommands: [
          `api_token=lowercase-secret ${bunBin} -e "console.log('x-api-key: header-secret-123'); console.log('{\\"password\\": \\"json-secret-123\\"}'); console.error('sk-abcdefghijklmnop ghp_abcdefghijklmnopqrstuvwxyz github_pat_abcdefghijklmnopqrstuvwxyz glpat-abcdefghijklmnopqrstuvwxyz')"`,
        ],
      });

      await store.validate("work-redaction-variants", "validator-agent");
      const validationLog = await readFile(
        join(repo, ".supermission", "work-redaction-variants", "validation.log"),
        "utf8",
      );
      const toolCalls = await readFile(
        join(repo, ".supermission", "work-redaction-variants", "tool-calls.jsonl"),
        "utf8",
      );

      expect(validationLog).toContain("api_token=[REDACTED]");
      expect(validationLog).toContain("x-api-key: [REDACTED]");
      expect(validationLog).toContain('"password": "[REDACTED]"');
      expect(validationLog).toContain("[REDACTED_SECRET]");
      expect(validationLog.match(/\[REDACTED_SECRET\]/g)).toHaveLength(8);
      expect(toolCalls.match(/\[REDACTED_SECRET\]/g)).toHaveLength(4);
      expect(validationLog).not.toContain("lowercase-secret");
      expect(validationLog).not.toContain("header-secret-123");
      expect(validationLog).not.toContain("json-secret-123");
      expect(validationLog).not.toContain("sk-abcdefghijklmnop");
      expect(validationLog).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
      expect(validationLog).not.toContain("github_pat_abcdefghijklmnopqrstuvwxyz");
      expect(validationLog).not.toContain("glpat-abcdefghijklmnopqrstuvwxyz");
      expect(toolCalls).not.toContain("lowercase-secret");
    });
  });

  it("blocks risky validation commands unless explicitly allowed", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-risky",
        goal: "Risky validation",
        actor: "local-user",
        acceptance: [],
        validationCommands: ["rm -rf ./definitely-risky"],
      });

      const blocked = await store.validate("work-risky", "validator-agent");
      expect(blocked.exitCode).toBe(3);
      expect((await store.readWork("work-risky")).status).toBe("blocked");
      expect(
        await readFile(join(repo, ".supermission", "work-risky", "validation.log"), "utf8"),
      ).toContain("Blocked Risky Command");

      const signals = await readJsonl(
        join(repo, ".supermission", "work-risky", "supervisor-signals.jsonl"),
      );
      expect(signals).toContainEqual(
        expect.objectContaining({ type: "risky_command_blocked", severity: "blocking" }),
      );
    });
  });

  it("requires an approved gate before allow-risky validation executes risky commands", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-risky-gate",
        goal: "Risky validation gate",
        actor: "local-user",
        acceptance: [],
        validationCommands: ["rm -rf ./definitely-risky"],
      });

      const missingGate = await store.validate("work-risky-gate", "validator-agent", {
        allowRisky: true,
      });
      expect(missingGate.exitCode).toBe(3);
      expect(await store.readSupervisorSignals("work-risky-gate")).toContainEqual(
        expect.objectContaining({
          type: "gate_waiting",
          severity: "blocking",
          message: "risky command requires approve_risky_command gate",
        }),
      );

      await store.approve("work-risky-gate", "local-user", "approve_risky_command");
      const approved = await store.validate("work-risky-gate", "validator-agent", {
        allowRisky: true,
      });

      expect(approved.exitCode).toBe(0);
      expect((await store.readWork("work-risky-gate")).status).toBe("validated");
    });
  });

  it("blocks validation commands outside a project allowlist policy", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      const command = `${bunBin} --version`;
      await store.createWork({
        id: "work-command-policy",
        goal: "Command policy",
        actor: "local-user",
        acceptance: [],
        validationCommands: [command],
      });
      await writeFile(
        join(repo, ".supermission", "policy.yaml"),
        YAML.stringify({ validation_allowlist: ["bun run test"] }),
        "utf8",
      );

      const blocked = await store.validate("work-command-policy", "validator-agent");
      expect(blocked.exitCode).toBe(4);
      expect(await store.diagnoseWork("work-command-policy")).toContainEqual(
        expect.objectContaining({ code: "command_policy_blocked", severity: "blocking" }),
      );

      await writeFile(
        join(repo, ".supermission", "policy.yaml"),
        YAML.stringify({ validation_allowlist: [`${bunBin} *`] }),
        "utf8",
      );
      const allowed = await store.validate("work-command-policy", "validator-agent");
      expect(allowed.exitCode).toBe(0);
    });
  });

  it("emits repeated failure signals when validation keeps failing the same command", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      const command = `${bunBin} -e "process.exit(5)"`;
      await store.createWork({
        id: "work-repeated-failure",
        goal: "Repeated validation failure",
        actor: "local-user",
        acceptance: [],
        validationCommands: [command],
      });

      await store.validate("work-repeated-failure", "validator-agent");
      await store.validate("work-repeated-failure", "validator-agent");

      const signals = await store.readSupervisorSignals("work-repeated-failure");
      expect(signals).toContainEqual(
        expect.objectContaining({
          type: "repeated_failure",
          severity: "blocking",
          message: expect.stringContaining("2 attempts"),
        }),
      );
      expect(await store.diagnoseWork("work-repeated-failure")).toContainEqual(
        expect.objectContaining({ code: "repeated_failure", severity: "blocking" }),
      );
    });
  });

  it("emits supervisor signal when validation commands are missing", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-blocked",
        goal: "Needs validation",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      const result = await store.validate("work-blocked", "validator-agent");
      const signals = await readJsonl(
        join(repo, ".supermission", "work-blocked", "supervisor-signals.jsonl"),
      );

      expect(result.exitCode).toBe(2);
      expect((await store.readWork("work-blocked")).status).toBe("blocked");
      expect(signals).toContainEqual(
        expect.objectContaining({ type: "validation_missing", severity: "blocking" }),
      );
    });
  });

  it("records controlled change proposals and restores previous status after approval", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-change",
        goal: "Controlled change",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await store.writePlan("work-change", "planner-agent");
      await store.approve("work-change", "local-user");

      const proposal = await store.proposeChange("work-change", {
        actor: "worker-agent",
        sourceKind: "agent",
        type: "api_contract",
        risk: "medium",
        reason: "Need to expose a typed error code for validation.",
        affected: ["acceptance", "src/api/**"],
        options: ["expand_scope", "split_work"],
        recommendation: "expand_scope",
      });

      expect(proposal.id).toBe("change-001");
      expect(proposal.requires_gate).toBe("approve_api_change");
      expect((await store.readWork("work-change")).status).toBe("needs_decision");

      const approved = await store.decideChange(
        "work-change",
        "change-001",
        "approved",
        "local-user",
        "Scope is acceptable.",
      );

      expect(approved.status).toBe("approved");
      expect((await store.readWork("work-change")).status).toBe("approved");

      const eventTypes = (await store.readEvents("work-change")).map((event) => event.type);
      expect(eventTypes).toContain("change.proposed");
      expect(eventTypes).toContain("change.approved");
      expect(eventTypes).toContain("gate.approved");
    });
  });

  it("applies approved change proposals to the work spec with evidence", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-change-apply",
        goal: "Apply controlled change",
        actor: "local-user",
        acceptance: ["Original acceptance"],
        validationCommands: [],
      });
      await store.proposeChange("work-change-apply", {
        actor: "worker-agent",
        sourceKind: "agent",
        type: "workflow",
        risk: "low",
        reason: "Need explicit evidence before completion.",
        affected: ["acceptance", "validation"],
        options: ["update_work_spec"],
        recommendation: "update_work_spec",
      });
      await store.decideChange(
        "work-change-apply",
        "change-001",
        "approved",
        "local-user",
        "Evidence update is in scope.",
      );

      const applied = await store.applyChange("work-change-apply", "change-001", {
        actor: "local-user",
        acceptance: ["Validation evidence is recorded"],
        validationCommands: [`${bunBin} --version`],
        workflowSteps: ["review"],
        planNotes: ["Review validation evidence before handoff."],
        note: "Applied after approval.",
      });

      const spec = await store.readWork("work-change-apply");
      expect(spec.acceptance).toEqual(["Original acceptance", "Validation evidence is recorded"]);
      expect(spec.validation_commands).toEqual([`${bunBin} --version`]);
      expect(spec.workflow).toContain("review");
      expect(applied.change.status).toBe("applied");
      expect(applied.change.application?.added.acceptance).toEqual([
        "Validation evidence is recorded",
      ]);
      expect(applied.change.application?.added.plan_notes).toEqual([
        "Review validation evidence before handoff.",
      ]);
      expect(
        await readFile(join(repo, ".supermission", "work-change-apply", "decisions.md"), "utf8"),
      ).toContain("change-001 Applied");
      expect(
        await readFile(join(repo, ".supermission", "work-change-apply", "plan.md"), "utf8"),
      ).toContain("Review validation evidence before handoff.");
      expect((await store.readEvents("work-change-apply")).map((event) => event.type)).toContain(
        "change.applied",
      );
    });
  });

  it("rejects applying changes before approval", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-change-apply-gate",
        goal: "Require approval before apply",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await store.proposeChange("work-change-apply-gate", {
        actor: "local-user",
        sourceKind: "human",
        type: "workflow",
        risk: "low",
        reason: "Try to skip approval.",
        affected: ["acceptance"],
        options: ["update_work_spec"],
      });

      await expect(
        store.applyChange("work-change-apply-gate", "change-001", {
          actor: "local-user",
          acceptance: ["New acceptance"],
          validationCommands: [],
          workflowSteps: [],
          planNotes: [],
        }),
      ).rejects.toThrow("change must be approved before apply");
    });
  });

  it("rejects an already decided change", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-change-reject",
        goal: "Reject duplicate decision",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await store.proposeChange("work-change-reject", {
        actor: "local-user",
        sourceKind: "human",
        type: "workflow",
        risk: "low",
        reason: "Try another plan.",
        affected: ["plan.md"],
        options: [],
      });
      await store.decideChange("work-change-reject", "change-001", "rejected", "local-user");

      await expect(
        store.decideChange("work-change-reject", "change-001", "approved", "local-user"),
      ).rejects.toThrow("already rejected");
    });
  });

  it("keeps generated work.yaml schema-valid", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-schema",
        goal: "Schema validation",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const yaml = await readFile(join(repo, ".supermission", "work-schema", "work.yaml"), "utf8");
      expect(() => WorkSpecSchema.parse(YAML.parse(yaml))).not.toThrow();
    });
  });

  it("captures git diff and non-destructive checkpoints", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, ".supermission", "tracked"), { recursive: true });
      await writeFile(join(repo, "app.txt"), "before\n", "utf8");
      await writeFile(
        join(repo, ".supermission", "tracked", "record.md"),
        "record before\n",
        "utf8",
      );
      await runProcess("git", ["add", "app.txt", ".supermission/tracked/record.md"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      await writeFile(join(repo, "app.txt"), "after\n", "utf8");
      await writeFile(
        join(repo, ".supermission", "tracked", "record.md"),
        "record after\n",
        "utf8",
      );
      await writeFile(join(repo, "new-file.txt"), "new file\n", "utf8");

      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-checkpoint",
        goal: "Checkpoint diff",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      const diff = await store.captureDiff("work-checkpoint", "local-user");
      const checkpoint = await store.createCheckpoint(
        "work-checkpoint",
        "local-user",
        "before review",
      );

      expect(diff).toContain("-before");
      expect(diff).toContain("+after");
      expect(diff).toContain("new-file.txt");
      expect(diff).not.toContain("record after");
      expect(checkpoint.id).toBe("checkpoint-001");
      const patch = await readFile(
        join(repo, ".supermission", "work-checkpoint", "checkpoints", "checkpoint-001.patch"),
        "utf8",
      );
      expect(patch).toContain("+after");
      expect(patch).toContain("new-file.txt");
      expect(patch).not.toContain("record after");
      expect(
        await readFile(join(repo, ".supermission", "work-checkpoint", "patch.diff"), "utf8"),
      ).toContain("+after");
      expect(await store.listCheckpoints("work-checkpoint")).toHaveLength(1);
    });
  });

  it("persists stable record ids for telemetry, tool calls, and supervisor signals", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-record-ids",
        goal: "Persist record ids",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      await store.appendTelemetry("work-record-ids", {
        metric: "custom.metric",
        status: "ok",
      });
      await store.appendToolCall("work-record-ids", {
        actor: "validator-agent",
        tool: "shell",
        command: `${bunBin} --version`,
        exit_code: 0,
      });
      await store.appendSupervisorSignal("work-record-ids", {
        type: "stuck",
        severity: "warning",
        message: "Task has not advanced.",
      });

      expect(
        (await store.readTelemetry("work-record-ids")).map((record) => record.record_id),
      ).toEqual(["telemetry-000001", "telemetry-000002"]);
      expect(await store.readToolCalls("work-record-ids")).toContainEqual(
        expect.objectContaining({ record_id: "tool-call-000001", tool: "shell" }),
      );
      expect(await store.readSupervisorSignals("work-record-ids")).toContainEqual(
        expect.objectContaining({ record_id: "signal-000001", type: "stuck" }),
      );
      expect(await store.readEvents("work-record-ids")).toContainEqual(
        expect.objectContaining({
          type: "supervisor.signal",
          actor: "supervisor-agent",
          signal_type: "stuck",
          severity: "warning",
        }),
      );
      expect(
        await readFile(join(repo, ".supermission", "work-record-ids", "tool-calls.jsonl"), "utf8"),
      ).toContain('"record_id":"tool-call-000001"');
      expect(
        await readFile(
          join(repo, ".supermission", "work-record-ids", "supervisor-signals.jsonl"),
          "utf8",
        ),
      ).toContain('"record_id":"signal-000001"');
    });
  });

  it("synthesizes typed fallback record ids for older JSONL records", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-legacy-records",
        goal: "Read old records",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const paths = store.paths("work-legacy-records");
      await writeFile(paths.events, '{"type":"legacy.event","actor":"legacy","time":"now"}\n');
      await writeFile(paths.telemetry, '{"metric":"legacy.metric","time":"now"}\n');
      await writeFile(
        paths.toolCalls,
        '{"actor":"legacy","tool":"shell","time":"now","command":"true"}\n',
      );
      await writeFile(
        paths.supervisor,
        '{"type":"stuck","severity":"warning","message":"legacy","time":"now"}\n',
      );

      expect((await store.readEvents("work-legacy-records"))[0]?.record_id).toBe("event-000001");
      expect((await store.readTelemetry("work-legacy-records"))[0]?.record_id).toBe(
        "telemetry-000001",
      );
      expect((await store.readToolCalls("work-legacy-records"))[0]?.record_id).toBe(
        "tool-call-000001",
      );
      expect((await store.readSupervisorSignals("work-legacy-records"))[0]?.record_id).toBe(
        "signal-000001",
      );
    });
  });

  it("does not append state change evidence when status is unchanged", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-idempotent-status",
        goal: "Avoid duplicate state events",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      await store.updateStatus(
        "work-idempotent-status",
        "planned",
        "planner-agent",
        "plan is ready",
      );
      const eventsBefore = await store.readEvents("work-idempotent-status");
      const telemetryBefore = await store.readTelemetry("work-idempotent-status");

      await store.updateStatus("work-idempotent-status", "planned", "planner-agent");

      const eventsAfter = await store.readEvents("work-idempotent-status");
      const telemetryAfter = await store.readTelemetry("work-idempotent-status");
      expect(eventsAfter).toHaveLength(eventsBefore.length);
      expect(telemetryAfter).toHaveLength(telemetryBefore.length);
      expect(eventsAfter.filter((event) => event.type === "work.state.changed")).toHaveLength(1);
      expect(eventsAfter).toContainEqual(
        expect.objectContaining({
          type: "work.state.changed",
          actor: "planner-agent",
          from: "draft",
          to: "planned",
          reason: "plan is ready",
        }),
      );
      expect(telemetryAfter).toContainEqual(
        expect.objectContaining({
          metric: "state.changed",
          from: "draft",
          to: "planned",
        }),
      );
    });
  });

  it("captures task-scoped diffs and checkpoints without hiding scope drift", async () => {
    await withTempRepo(async (repo) => {
      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, "src", "app.ts"), "export const value = 'before';\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "before\n", "utf8");
      await runProcess("git", ["add", "src/app.ts", "docs/notes.md"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      await writeFile(join(repo, "src", "app.ts"), "export const value = 'after';\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "after\n", "utf8");
      await writeFile(join(repo, "src", "new.ts"), "export const added = true;\n", "utf8");
      await writeFile(join(repo, "docs", "new.md"), "new docs\n", "utf8");

      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-scoped-patch",
        goal: "Scoped patch",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const task = await store.addTask("work-scoped-patch", {
        actor: "local-user",
        title: "Source-only change",
        actorRole: "worker-agent",
        mutationMode: "linear_write",
        dependsOn: [],
        scopeAllow: ["src/**"],
        scopeDeny: [],
        validation: [],
      });

      const diff = await store.captureDiff("work-scoped-patch", "local-user", {
        taskId: task.id,
      });
      const checkpoint = await store.createCheckpoint(
        "work-scoped-patch",
        "local-user",
        "source-only",
        { taskId: task.id },
      );

      expect(diff).toContain("src/app.ts");
      expect(diff).toContain("src/new.ts");
      expect(diff).toContain("after");
      expect(diff).not.toContain("docs/notes.md");
      expect(diff).not.toContain("docs/new.md");
      const checkpointPatch = await readFile(
        join(repo, ".supermission", "work-scoped-patch", "checkpoints", `${checkpoint.id}.patch`),
        "utf8",
      );
      expect(checkpointPatch).toContain("src/app.ts");
      expect(checkpointPatch).toContain("src/new.ts");
      expect(checkpointPatch).not.toContain("docs/notes.md");
      expect(checkpointPatch).not.toContain("docs/new.md");
      expect(await store.readSupervisorSignals("work-scoped-patch")).toContainEqual(
        expect.objectContaining({ type: "scope_drift", severity: "blocking" }),
      );
      expect((await store.readEvents("work-scoped-patch")).map((event) => event.type)).toContain(
        "scope.audit.created",
      );
    });
  });

  it("creates git isolation records and rollback plans without changing the active branch", async () => {
    await withTempRepo(async (repo) => {
      await writeFile(join(repo, "app.txt"), "before\n", "utf8");
      await runProcess("git", ["add", "app.txt"], { cwd: repo });
      await runProcess(
        "git",
        ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial"],
        { cwd: repo },
      );
      const branchBefore = (
        await runProcess("git", ["branch", "--show-current"], { cwd: repo })
      ).stdout.trim();
      const worktreePath = join(repo, "..", `work-wt-${randomUUID()}`);

      try {
        const store = new WorkStore(repo);
        await store.createWork({
          id: "work-isolation",
          goal: "Git isolation",
          actor: "local-user",
          acceptance: [],
          validationCommands: [],
        });
        const branch = await store.createBranch("work-isolation", {
          actor: "local-user",
          branch: "work/isolation-branch",
        });
        expect(branch.branch).toBe("work/isolation-branch");
        expect(
          (await runProcess("git", ["branch", "--show-current"], { cwd: repo })).stdout.trim(),
        ).toBe(branchBefore);

        const worktree = await store.createWorktree("work-isolation", {
          actor: "local-user",
          path: worktreePath,
          branch: "work/isolation-worktree",
        });
        expect(worktree.worktree_path).toBe(worktreePath);

        await writeFile(join(repo, "app.txt"), "after\n", "utf8");
        const checkpoint = await store.createCheckpoint(
          "work-isolation",
          "local-user",
          "before rollback plan",
        );
        const rollbackCheck = await store.checkRollback(
          "work-isolation",
          "local-user",
          checkpoint.id,
        );
        const plan = await store.writeRollbackPlan("work-isolation", "local-user", checkpoint.id);

        expect(rollbackCheck).toMatchObject({ ok: true, checkpoint: checkpoint.id });
        expect(plan).toContain("Automatic rollback is intentionally not enabled yet.");
        expect(plan).toContain(checkpoint.id);

        await writeFile(join(repo, "app.txt"), "conflicting\n", "utf8");
        const blockedRollback = await store.checkRollback(
          "work-isolation",
          "local-user",
          checkpoint.id,
        );
        expect(blockedRollback.ok).toBe(false);
        expect(await store.readSupervisorSignals("work-isolation")).toContainEqual(
          expect.objectContaining({ type: "merge_conflict", severity: "blocking" }),
        );
      } finally {
        await runProcess("git", ["worktree", "remove", "--force", worktreePath], { cwd: repo });
        await rm(worktreePath, { recursive: true, force: true });
      }
    });
  });

  it("diagnoses blocking and healthy work states", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-doctor",
        goal: "Doctor work",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      const blocked = await store.diagnoseWork("work-doctor");
      expect(blocked).toContainEqual(
        expect.objectContaining({ code: "validation_missing", severity: "blocking" }),
      );

      await store.proposeChange("work-doctor", {
        actor: "local-user",
        sourceKind: "human",
        type: "workflow",
        risk: "low",
        reason: "Manual validation for now.",
        affected: ["validation"],
        options: ["manual_validation"],
      });
      const withChange = await store.diagnoseWork("work-doctor");
      expect(withChange).toContainEqual(
        expect.objectContaining({ code: "pending_change", severity: "blocking" }),
      );

      await store.createWork({
        id: "work-doctor-healthy",
        goal: "Healthy work",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });
      expect(await store.diagnoseWork("work-doctor-healthy")).toContainEqual(
        expect.objectContaining({ code: "healthy", severity: "info" }),
      );
    });
  });

  it("diagnoses stale running tasks as stuck", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-stuck-task",
        goal: "Detect stale task",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });
      const taskPath = join(repo, ".supermission", "work-stuck-task", "tasks", "task-001.yaml");
      const task = YAML.parse(await readFile(taskPath, "utf8"));
      await writeFile(
        taskPath,
        YAML.stringify({ ...task, status: "running", updated_at: "2000-01-01T00:00:00Z" }),
        "utf8",
      );

      expect(await store.diagnoseWork("work-stuck-task")).toContainEqual(
        expect.objectContaining({ code: "stuck", severity: "warning" }),
      );
    });
  });

  it("does not diagnose recently updated running tasks as stuck", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-active-task",
        goal: "Do not flag active task",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });
      const taskPath = join(repo, ".supermission", "work-active-task", "tasks", "task-001.yaml");
      const task = YAML.parse(await readFile(taskPath, "utf8"));
      await writeFile(
        taskPath,
        YAML.stringify({ ...task, status: "running", updated_at: utcNow() }),
        "utf8",
      );

      expect(await store.diagnoseWork("work-active-task")).not.toContainEqual(
        expect.objectContaining({ code: "stuck" }),
      );
    });
  });

  it("does not mark handoff stale only because completion status was recorded", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-handoff-fresh",
        goal: "Fresh handoff",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });
      await store.validate("work-handoff-fresh", "validator-agent");
      await store.createCheckpoint("work-handoff-fresh", "local-user", "before handoff");
      await store.writeHandoff("work-handoff-fresh", "handoff-agent");

      expect(await store.diagnoseWork("work-handoff-fresh")).not.toContainEqual(
        expect.objectContaining({ code: "handoff_stale" }),
      );
    });
  });

  it("writes a review artifact from work evidence", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-review",
        goal: "Review artifact",
        actor: "local-user",
        acceptance: ["Review exists"],
        validationCommands: [`${bunBin} --version`],
      });
      await store.validate("work-review", "validator-agent");
      await store.createCheckpoint("work-review", "local-user", "before review");
      const review = await store.writeReview("work-review", "human-reviewer");

      expect(review).toContain("## Review Focus");
      expect(review).toContain("## Health Findings");
      expect(review).toContain("checkpoint-001");
      expect(
        await readFile(join(repo, ".supermission", "work-review", "review.md"), "utf8"),
      ).toContain("Reviewer: human-reviewer");
    });
  });

  it("summarizes work state for human review", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-summary",
        goal: "Summary work",
        actor: "local-user",
        acceptance: [],
        validationCommands: [`${bunBin} --version`],
      });
      const summary = await store.summarizeWork("work-summary");

      expect(summary.id).toBe("work-summary");
      expect(summary.tasks).toBe(1);
      expect(summary.validation_commands).toBe(1);
      expect(summary.artifacts).toHaveProperty("events");
    });
  });

  it("generates a monitor report with next actions and recent signals", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-monitor",
        goal: "Monitor work",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      await store.validate("work-monitor", "validator-agent");

      const monitor = await store.monitorWork("work-monitor");
      const report = await store.writeMonitor("work-monitor", "supervisor-agent");

      expect(monitor.status).toBe("blocked");
      expect(monitor.recent_signals).toContainEqual(
        expect.objectContaining({ type: "validation_missing" }),
      );
      expect(monitor.next_actions[0]).toContain("Add validation commands");
      expect(report).toContain("## Next Actions");
      expect(report).toContain("validation_missing");
      expect(
        await readFile(join(repo, ".supermission", "work-monitor", "monitor.md"), "utf8"),
      ).toContain("Work: work-monitor");
    });
  });

  it("adds sidecar tasks and records task status changes", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-task",
        goal: "Task ledger",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const task = await store.addTask("work-task", {
        actor: "local-user",
        title: "Research related tools",
        actorRole: "research-agent",
        mutationMode: "sidecar_artifact",
        dependsOn: [],
        scopeAllow: [".supermission/**"],
        scopeDeny: ["src/**"],
        validation: [],
      });
      expect(task.id).toBe("task-002");
      expect(task.status).toBe("ready");
      expect(task.mutation_mode).toBe("sidecar_artifact");

      const updated = await store.setTaskStatus("work-task", task.id, "done", "research-agent");
      expect(updated.status).toBe("done");
      const events = await store.readEvents("work-task");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "task.created",
          actor: "local-user",
          task: "task-002",
          mutation_mode: "sidecar_artifact",
          actor_role: "research-agent",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "task.status.changed",
          actor: "research-agent",
          task: "task-002",
          from: "ready",
          to: "done",
        }),
      );
    });
  });

  it("unblocks dependent tasks only after all dependencies are done", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-task-deps",
        goal: "Task dependencies",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const first = await store.addTask("work-task-deps", {
        actor: "local-user",
        title: "Prepare artifact",
        actorRole: "research-agent",
        mutationMode: "sidecar_artifact",
        dependsOn: [],
        scopeAllow: [".supermission/**"],
        scopeDeny: ["src/**"],
        validation: [],
      });
      const second = await store.addTask("work-task-deps", {
        actor: "local-user",
        title: "Review artifact",
        actorRole: "reviewer-agent",
        mutationMode: "sidecar_readonly",
        dependsOn: [first.id],
        scopeAllow: [".supermission/**"],
        scopeDeny: ["src/**"],
        validation: [],
      });
      const third = await store.addTask("work-task-deps", {
        actor: "local-user",
        title: "Publish after both prerequisites",
        actorRole: "handoff-agent",
        mutationMode: "sidecar_artifact",
        dependsOn: [first.id, second.id],
        scopeAllow: [".supermission/**"],
        scopeDeny: ["src/**"],
        validation: [],
      });

      expect(second.status).toBe("pending");
      expect(third.status).toBe("pending");
      await store.setTaskStatus("work-task-deps", first.id, "done", "research-agent");

      expect((await store.readTask("work-task-deps", second.id)).status).toBe("ready");
      expect((await store.readTask("work-task-deps", third.id)).status).toBe("pending");
      await store.setTaskStatus("work-task-deps", second.id, "done", "reviewer-agent");

      expect((await store.readTask("work-task-deps", third.id)).status).toBe("ready");
      expect((await store.readEvents("work-task-deps")).map((event) => event.type)).toContain(
        "task.unblocked",
      );
      expect(await store.readEvents("work-task-deps")).toContainEqual(
        expect.objectContaining({
          type: "task.unblocked",
          task: "task-004",
          dependencies: ["task-002", "task-003"],
        }),
      );
    });
  });

  it("rejects tasks that depend on unknown task ids", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-unknown-dep",
        goal: "Unknown dependency",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });

      await expect(
        store.addTask("work-unknown-dep", {
          actor: "local-user",
          title: "Blocked by missing task",
          actorRole: "worker-agent",
          mutationMode: "linear_write",
          dependsOn: ["task-404"],
          scopeAllow: [],
          scopeDeny: [],
          validation: [],
        }),
      ).rejects.toThrow("unknown task: task-404");
    });
  });

  it("allows parallel sidecar tasks but blocks concurrent linear writes", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-linear-lock",
        goal: "Linear mutation lock",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const linear = await store.addTask("work-linear-lock", {
        actor: "local-user",
        title: "Second linear mutation",
        actorRole: "worker-agent",
        mutationMode: "linear_write",
        dependsOn: [],
        scopeAllow: ["src/**"],
        scopeDeny: [],
        validation: [],
      });
      const sidecar = await store.addTask("work-linear-lock", {
        actor: "local-user",
        title: "Parallel test planning",
        actorRole: "tester-agent",
        mutationMode: "sidecar_artifact",
        dependsOn: [],
        scopeAllow: [".supermission/**"],
        scopeDeny: ["src/**"],
        validation: [],
      });

      await store.setTaskStatus("work-linear-lock", "task-001", "running", "worker-agent");
      await expect(
        store.setTaskStatus("work-linear-lock", linear.id, "running", "worker-agent"),
      ).rejects.toThrow("linear_write task task-001 is already running");
      await expect(
        store.setTaskStatus("work-linear-lock", sidecar.id, "running", "tester-agent"),
      ).resolves.toMatchObject({ status: "running" });
      await expect(
        store.setTaskStatus("work-linear-lock", linear.id, "blocked", "worker-agent"),
      ).resolves.toMatchObject({ status: "blocked" });

      const signals = await readJsonl(
        join(repo, ".supermission", "work-linear-lock", "supervisor-signals.jsonl"),
      );
      expect(signals).toContainEqual(
        expect.objectContaining({ type: "linear_mutation_conflict", severity: "blocking" }),
      );
    });
  });

  it("audits task scope drift from current git changes", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-scope",
        goal: "Scope audit",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      const task = await store.addTask("work-scope", {
        actor: "local-user",
        title: "Change source files",
        actorRole: "worker-agent",
        mutationMode: "linear_write",
        dependsOn: [],
        scopeAllow: ["src/**"],
        scopeDeny: ["src/secrets/**"],
        validation: [],
      });
      await mkdir(join(repo, "src", "secrets"), { recursive: true });
      await mkdir(join(repo, "docs"), { recursive: true });
      await writeFile(join(repo, "src", "app.ts"), "export const ok = true;\n", "utf8");
      await writeFile(join(repo, "src", "secrets", "key.ts"), "export const key = 'x';\n", "utf8");
      await writeFile(join(repo, "docs", "notes.md"), "outside\n", "utf8");

      const result = await store.auditTaskScope("work-scope", task.id, "supervisor-agent");

      expect(result.changed_files).toEqual(["docs/notes.md", "src/app.ts", "src/secrets/key.ts"]);
      expect(result.violations).toEqual([
        { file: "docs/notes.md", reason: "not_allowed" },
        { file: "src/secrets/key.ts", reason: "denied" },
      ]);
      expect(
        await readFile(join(repo, ".supermission", "work-scope", "scope-audit.md"), "utf8"),
      ).toContain("src/secrets/key.ts");
      expect(await store.diagnoseWork("work-scope")).toContainEqual(
        expect.objectContaining({ code: "scope_drift", severity: "blocking" }),
      );
    });
  });

  it("keeps trace fast enough for 1000 events", async () => {
    await withTempRepo(async (repo) => {
      const store = new WorkStore(repo);
      await store.createWork({
        id: "work-performance",
        goal: "Performance budget",
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      for (let index = 0; index < 1000; index += 1) {
        await store.appendEvent("work-performance", "test.event", "test-runner", { index });
      }

      const started = performance.now();
      const events = await store.readEvents("work-performance");
      const durationMs = performance.now() - started;

      expect(events).toHaveLength(1001);
      expect(durationMs).toBeLessThan(200);
    });
  });
});
