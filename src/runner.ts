import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { z } from "zod";
import type { WorkSpec } from "./types.js";

export type RunnerBackend =
  | "record"
  | "shell"
  | "codex"
  | "claude"
  | "gemini"
  | "aider"
  | "opencode"
  | "copilot"
  | "amazon-q"
  | "goose"
  | "kiro"
  | "grok";

export const RunnerBackendSchema = z.enum([
  "record",
  "shell",
  "codex",
  "claude",
  "gemini",
  "aider",
  "opencode",
  "copilot",
  "amazon-q",
  "goose",
  "kiro",
  "grok",
]);

export type RunnerDescriptor = {
  backend: RunnerBackend;
  label: string;
  kind: "local" | "external";
  profileSource?: "cc-switch-or-native" | "native";
};

export type RunnerProfile = {
  backend: "codex" | "claude";
  id: string;
  name: string;
  current: boolean;
  source: "cc-switch";
};

export const RUNNER_REGISTRY: RunnerDescriptor[] = [
  { backend: "record", label: "Record an external/manual run", kind: "local" },
  { backend: "shell", label: "Execute a local shell command", kind: "local" },
  {
    backend: "codex",
    label: "OpenAI Codex CLI agent",
    kind: "external",
    profileSource: "cc-switch-or-native",
  },
  {
    backend: "claude",
    label: "Anthropic Claude Code CLI agent",
    kind: "external",
    profileSource: "native",
  },
  {
    backend: "gemini",
    label: "Google Gemini CLI agent",
    kind: "external",
  },
  {
    backend: "aider",
    label: "Aider AI pair programming CLI",
    kind: "external",
  },
  {
    backend: "opencode",
    label: "OpenCode terminal AI agent",
    kind: "external",
  },
  {
    backend: "copilot",
    label: "GitHub Copilot CLI agent",
    kind: "external",
  },
  {
    backend: "amazon-q",
    label: "Amazon Q Developer CLI agent",
    kind: "external",
  },
  {
    backend: "goose",
    label: "Block Goose autonomous coding agent",
    kind: "external",
  },
  {
    backend: "kiro",
    label: "AWS Kiro CLI agent",
    kind: "external",
  },
  {
    backend: "grok",
    label: "xAI Grok CLI agent",
    kind: "external",
  },
];

export type RunnerContext = {
  repo: string;
  work: WorkSpec;
  actor: string;
  note?: string;
};

export type RunnerOptions = {
  command?: string;
  prompt?: string;
  model?: string;
  profile?: string;
  fallbackProfiles?: string[];
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  tools?: string[];
  timeoutMs?: number;
  retry?: RunnerRetryOptions;
  stream?: boolean;
  interactive?: boolean;
};

export type RunnerRetryOptions = {
  attempts: number;
  delayMs: number;
  exitCodes: number[];
};

const DEFAULT_RETRY_CONFIG = { attempts: 1, delay_ms: 0, exit_codes: [1, 124] };
const DEFAULT_BACKEND_CONFIG = {
  fallback_profiles: [],
  tools: [],
  retry: DEFAULT_RETRY_CONFIG,
};

const RunnerBackendConfigSchema = z.object({
  command: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  fallback_profiles: z.array(z.string().min(1)).default([]),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  permission_mode: z
    .enum(["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"])
    .optional(),
  tools: z.array(z.string().min(1)).default([]),
  timeout_ms: z.number().int().positive().optional(),
  retry: z
    .object({
      attempts: z.number().int().positive().default(1),
      delay_ms: z.number().int().nonnegative().default(0),
      exit_codes: z.array(z.number().int()).default([1, 124]),
    })
    .default({ attempts: 1, delay_ms: 0, exit_codes: [1, 124] }),
});

export const RunnerConfigSchema = z.object({
  default_backend: RunnerBackendSchema.or(z.literal("auto")).default("auto"),
  fallback_order: z.array(RunnerBackendSchema).default([]),
  routing: z.record(z.string(), RunnerBackendSchema).default({}),
  backends: z
    .object({
      record: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      shell: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      codex: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      claude: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      gemini: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      aider: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      opencode: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      copilot: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      "amazon-q": RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      goose: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      kiro: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
      grok: RunnerBackendConfigSchema.default(DEFAULT_BACKEND_CONFIG),
    })
    .default({
      record: DEFAULT_BACKEND_CONFIG,
      shell: DEFAULT_BACKEND_CONFIG,
      codex: DEFAULT_BACKEND_CONFIG,
      claude: DEFAULT_BACKEND_CONFIG,
      gemini: DEFAULT_BACKEND_CONFIG,
      aider: DEFAULT_BACKEND_CONFIG,
      opencode: DEFAULT_BACKEND_CONFIG,
      copilot: DEFAULT_BACKEND_CONFIG,
      "amazon-q": DEFAULT_BACKEND_CONFIG,
      goose: DEFAULT_BACKEND_CONFIG,
      kiro: DEFAULT_BACKEND_CONFIG,
      grok: DEFAULT_BACKEND_CONFIG,
    }),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
export type RunnerBackendConfig = z.infer<typeof RunnerBackendConfigSchema>;

export type RunnerExecution = {
  backend: RunnerBackend;
  command?: string;
  prompt?: string;
  response?: string;
  started_at: string;
  finished_at: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  tokensUsed?: number;
};

// --- Smart Runner Selection ---

const DETECTABLE_BACKENDS: Array<{ backend: RunnerBackend; binary: string }> = [
  { backend: "claude", binary: "claude" },
  { backend: "codex", binary: "codex" },
  { backend: "gemini", binary: "gemini" },
  { backend: "aider", binary: "aider" },
  { backend: "opencode", binary: "opencode" },
  { backend: "copilot", binary: "gh" },
  { backend: "amazon-q", binary: "q" },
  { backend: "goose", binary: "goose" },
  { backend: "kiro", binary: "kiro" },
  { backend: "grok", binary: "grok" },
];

export async function detectAvailableBackends(): Promise<RunnerBackend[]> {
  const available: RunnerBackend[] = [];
  for (const { backend, binary } of DETECTABLE_BACKENDS) {
    if (await isBinaryOnPath(binary)) {
      available.push(backend);
    }
  }
  return available;
}

async function isBinaryOnPath(binary: string): Promise<boolean> {
  const result = await spawnCaptured("which", [binary], process.cwd(), false, undefined, {
    timeoutMs: 3000,
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function resolveBackend(
  config: RunnerConfig,
  options: { explicit?: RunnerBackend; actorRole?: string; available?: RunnerBackend[] },
): RunnerBackend {
  // 1. Explicit CLI flag always wins
  if (options.explicit) return options.explicit;

  // 2. Role-based routing from config
  if (options.actorRole && config.routing[options.actorRole]) {
    return config.routing[options.actorRole];
  }

  // 3. If default is a specific backend, use it
  if (config.default_backend !== "auto") {
    return config.default_backend as RunnerBackend;
  }

  // 4. Auto mode: use fallback_order filtered by available, or first available
  const available = options.available ?? [];
  if (config.fallback_order.length > 0) {
    const match = config.fallback_order.find(
      (b) => available.length === 0 || available.includes(b),
    );
    if (match) return match;
  }

  // 5. First available backend
  if (available.length > 0) return available[0];

  // 6. Ultimate fallback
  return "record";
}

export async function executeRunnerWithFallback(
  config: RunnerConfig,
  context: RunnerContext,
  options: RunnerOptions & { explicit?: RunnerBackend; actorRole?: string },
): Promise<RunnerExecution> {
  const available = await detectAvailableBackends();

  // If explicit backend specified, just run it (no fallback chain)
  if (options.explicit) {
    return executeRunner(options.explicit, context, options);
  }

  // Build the chain: role-routing → fallback_order → default
  const chain: RunnerBackend[] = [];

  // Role routing first
  if (options.actorRole && config.routing[options.actorRole]) {
    chain.push(config.routing[options.actorRole]);
  }

  // Then fallback_order
  for (const backend of config.fallback_order) {
    if (!chain.includes(backend)) chain.push(backend);
  }

  // Then default_backend
  if (config.default_backend !== "auto" && !chain.includes(config.default_backend as RunnerBackend)) {
    chain.push(config.default_backend as RunnerBackend);
  }

  // If chain is empty (pure auto mode), use available backends
  if (chain.length === 0) {
    if (available.length > 0) {
      chain.push(...available);
    } else {
      return executeRunner("record", context, options);
    }
  }

  // Try each backend in the chain
  const failedAttempts: RunnerExecution[] = [];
  for (const backend of chain) {
    const execution = await executeRunner(backend, context, options);
    if (execution.exitCode === 0) {
      return failedAttempts.length > 0
        ? { ...execution, stderr: formatFallbackAttempts(failedAttempts) + execution.stderr }
        : execution;
    }
    // Exit 127 = command not found — skip to next in chain
    // Other failures might be real errors — still try next
    failedAttempts.push(execution);
  }

  // All failed — return last attempt with full history
  const last = failedAttempts[failedAttempts.length - 1];
  if (!last) return executeRunner("record", context, options);
  return { ...last, stderr: formatFallbackAttempts(failedAttempts.slice(0, -1)) + last.stderr };
}

function formatFallbackAttempts(attempts: RunnerExecution[]): string {
  if (attempts.length === 0) return "";
  return (
    attempts
      .map((a) => `fallback: ${a.backend} failed (exit ${a.exitCode})`)
      .join("\n") + "\n"
  );
}

// --- End Smart Runner Selection ---

export function buildWorkPrompt(context: RunnerContext): string {
  const lines = [
    `Work ID: ${context.work.id}`,
    `Goal: ${context.work.goal}`,
    `Actor: ${context.actor}`,
    "",
    "Acceptance criteria:",
    ...(context.work.acceptance.length > 0
      ? context.work.acceptance.map((item) => `- ${item}`)
      : ["- TBD"]),
    "",
    "Validation commands:",
    ...(context.work.validation_commands.length > 0
      ? context.work.validation_commands.map((command) => `- ${command}`)
      : ["- TBD"]),
    "",
    "Task:",
    context.note ?? "Implement the work and return a concise completion summary.",
    "",
    "Return only the completion summary unless the backend requires another format.",
  ];
  return lines.join("\n");
}

export function formatRunLog(input: {
  workId: string;
  goal: string;
  actor: string;
  execution: RunnerExecution;
}): string {
  const { workId, goal, actor, execution } = input;
  const lines = [
    "# Run",
    "",
    `Work: ${workId}`,
    `Goal: ${goal}`,
    `Actor: ${actor}`,
    `Backend: ${execution.backend}`,
    `Started: ${execution.started_at}`,
    `Finished: ${execution.finished_at}`,
    `Exit code: ${execution.exitCode}`,
    `Duration: ${execution.durationMs}ms`,
    "",
  ];

  if (execution.prompt && execution.prompt.trim().length > 0) {
    lines.push("## Prompt", "", "```text", execution.prompt.trimEnd(), "```", "");
  }
  if (execution.command && execution.command.trim().length > 0) {
    lines.push("## Command", "", "```text", execution.command.trimEnd(), "```", "");
  }
  if (execution.response && execution.response.trim().length > 0) {
    lines.push("## Response", "", "```text", execution.response.trimEnd(), "```", "");
  }

  lines.push(
    "## stdout",
    "",
    "```text",
    execution.stdout.trimEnd(),
    "```",
    "",
    "## stderr",
    "",
    "```text",
    execution.stderr.trimEnd(),
    "```",
    "",
  );

  return `${lines.join("\n")}\n`;
}

export async function executeRunner(
  backend: RunnerBackend,
  context: RunnerContext,
  options: RunnerOptions = {},
): Promise<RunnerExecution> {
  const retry = options.retry ?? { attempts: 1, delayMs: 0, exitCodes: [1, 124] };
  const attempts = Math.max(1, retry.attempts);
  const failedAttempts: RunnerExecution[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const execution = await executeRunnerOnce(backend, context, options);
    if (execution.exitCode === 0) {
      return withRetryAttemptStderr(execution, failedAttempts);
    }
    if (attempt >= attempts || !retry.exitCodes.includes(execution.exitCode)) {
      return withRetryAttemptStderr(execution, failedAttempts);
    }
    failedAttempts.push(execution);
    if (retry.delayMs > 0) {
      await sleep(retry.delayMs);
    }
  }
  return executeRunnerOnce(backend, context, options);
}

async function executeRunnerOnce(
  backend: RunnerBackend,
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  switch (backend) {
    case "record":
      return executeRecordRunner(context);
    case "shell":
      return executeShellRunner(context, options);
    case "codex":
      return executeCodexRunner(context, options);
    case "claude":
      return executeClaudeRunner(context, options);
    case "gemini":
      return executeGeminiRunner(context, options);
    case "aider":
      return executeAiderRunner(context, options);
    case "opencode":
      return executeOpencodeRunner(context, options);
    case "copilot":
      return executeCopilotRunner(context, options);
    case "amazon-q":
      return executeAmazonQRunner(context, options);
    case "goose":
      return executeGooseRunner(context, options);
    case "kiro":
      return executeKiroRunner(context, options);
    case "grok":
      return executeGrokRunner(context, options);
  }
}

function withRetryAttemptStderr(
  execution: RunnerExecution,
  failedAttempts: RunnerExecution[],
): RunnerExecution {
  if (failedAttempts.length === 0) return execution;
  const summaries = failedAttempts
    .map(
      (attempt, index) =>
        `retry attempt ${index + 1} failed: exit ${attempt.exitCode}, command: ${
          attempt.command ?? "unknown"
        }`,
    )
    .join("\n");
  return {
    ...execution,
    stderr: `${summaries}\n${execution.stderr}`,
  };
}

export async function listCcSwitchRunnerProfiles(
  backend?: "codex" | "claude",
): Promise<RunnerProfile[]> {
  const dbPath = join(homedir(), ".cc-switch", "cc-switch.db");
  const where = backend ? `WHERE app_type = '${backend}'` : "WHERE app_type IN ('codex', 'claude')";
  const result = await spawnCaptured(
    "sqlite3",
    [
      "-json",
      dbPath,
      `SELECT id, app_type, name, is_current FROM providers ${where} ORDER BY app_type, is_current DESC, name`,
    ],
    process.cwd(),
  );
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return [];
  }
  return parseJsonArray<{
    id?: string;
    app_type?: string;
    name?: string;
    is_current?: number;
  }>(result.stdout)
    .filter(
      (profile) =>
        (profile.app_type === "codex" || profile.app_type === "claude") &&
        profile.id &&
        profile.name,
    )
    .map((profile) => ({
      backend: profile.app_type as "codex" | "claude",
      id: profile.id ?? "",
      name: profile.name ?? "",
      current: profile.is_current === 1,
      source: "cc-switch",
    }));
}

async function executeRecordRunner(context: RunnerContext): Promise<RunnerExecution> {
  const now = isoNow();
  return {
    backend: "record",
    command: "supermission run --backend record",
    prompt: context.note ?? "V0 sequential workflow placeholder.",
    response: context.note ?? "Implementation recorded externally.",
    started_at: now,
    finished_at: now,
    exitCode: 0,
    durationMs: 0,
    stdout: "",
    stderr: "",
  };
}

async function executeShellRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  if (!options.command) {
    throw new Error("shell runner requires --command");
  }
  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured(options.command, [], context.repo, true, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "shell",
    command: options.command,
    prompt: options.prompt ?? context.note,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeCodexRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const profiles = [options.profile, ...(options.fallbackProfiles ?? [])].filter(
    (profile): profile is string => Boolean(profile),
  );
  if (profiles.length === 0) {
    return executeCodexRunnerAttempt(context, options);
  }

  const failedAttempts: RunnerExecution[] = [];
  for (const profile of profiles) {
    const execution = await executeCodexRunnerAttempt(context, options, profile);
    if (execution.exitCode === 0) {
      return failedAttempts.length === 0
        ? execution
        : withPriorAttemptStderr(execution, failedAttempts);
    }
    failedAttempts.push(execution);
  }

  const finalAttempt = failedAttempts[failedAttempts.length - 1];
  if (!finalAttempt) return executeCodexRunnerAttempt(context, options);
  return withPriorAttemptStderr(finalAttempt, failedAttempts.slice(0, -1));
}

async function executeCodexRunnerAttempt(
  context: RunnerContext,
  options: RunnerOptions,
  profile?: string,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const tempDir = await mkdtemp(join(tmpdir(), "supermission-codex-"));
  const outputPath = join(tempDir, "last-message.txt");
  const ccSwitchProfile = profile ? await createCcSwitchCodexHome(profile, tempDir) : undefined;
  const args = [
    "exec",
    "-C",
    context.repo,
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-last-message",
    outputPath,
  ];
  if (options.model) args.push("-m", options.model);
  if (profile && !ccSwitchProfile) args.push("-p", profile);
  if (options.sandbox) args.push("-s", options.sandbox);
  if (options.tools && options.tools.length > 0) {
    args.push("--tools", options.tools.join(" "));
  }
  args.push(prompt);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured(
    "codex",
    args,
    context.repo,
    false,
    ccSwitchProfile ? { CODEX_HOME: ccSwitchProfile.codexHome } : undefined,
    { timeoutMs: options.timeoutMs },
  );
  const response = await readText(outputPath);
  await rm(tempDir, { recursive: true, force: true });
  return {
    backend: "codex",
    command: ccSwitchProfile
      ? `${formatCommandLine("codex", args, prompt)} # cc-switch:${ccSwitchProfile.name}`
      : formatCommandLine("codex", args, prompt),
    prompt,
    response: response.trim().length > 0 ? response.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

function withPriorAttemptStderr(
  execution: RunnerExecution,
  failedAttempts: RunnerExecution[],
): RunnerExecution {
  if (failedAttempts.length === 0) return execution;
  const summaries = failedAttempts
    .map(
      (attempt) =>
        `prior ${attempt.backend} attempt failed: exit ${attempt.exitCode}, command: ${
          attempt.command ?? "unknown"
        }`,
    )
    .join("\n");
  return {
    ...execution,
    stderr: `${summaries}\n${execution.stderr}`,
  };
}

async function executeClaudeRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);

  // Interactive mode: launch claude without --print, let user interact
  if (options.interactive) {
    const args = ["--no-session-persistence"];
    if (options.model) args.push("--model", options.model);
    if (options.tools && options.tools.length > 0) {
      args.push("--allowed-tools", options.tools.join(" "));
    }
    args.push("-p", prompt);

    const startedAt = isoNow();
    const started = performance.now();
    const result = await spawnCaptured("claude", args, context.repo, false, undefined, {
      interactive: true,
    });
    return {
      backend: "claude",
      command: formatCommandLine("claude", args, prompt),
      prompt,
      response: "(interactive session)",
      started_at: startedAt,
      finished_at: isoNow(),
      exitCode: result.exitCode,
      durationMs: Math.round(performance.now() - started),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "text",
    "--dangerously-skip-permissions",
    "--permission-mode",
    options.permissionMode ?? "bypassPermissions",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.tools && options.tools.length > 0) {
    args.push("--allowed-tools", options.tools.join(" "));
  }
  args.push(prompt);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("claude", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
    stream: options.stream,
  });
  return {
    backend: "claude",
    command: formatCommandLine("claude", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeGeminiRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "--prompt",
    prompt,
    "--sandbox",
    "false",
    "--yes",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("gemini", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "gemini",
    command: formatCommandLine("gemini", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeAiderRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "--message",
    prompt,
    "--yes-always",
    "--no-auto-commits",
    "--no-git",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("aider", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "aider",
    command: formatCommandLine("aider", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeOpencodeRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "run",
    "--prompt",
    prompt,
    "--non-interactive",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("opencode", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "opencode",
    command: formatCommandLine("opencode", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeCopilotRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "agent",
    "--message",
    prompt,
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("gh", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "copilot",
    command: formatCommandLine("gh", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeAmazonQRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "dev",
    "--prompt",
    prompt,
    "--non-interactive",
  ];

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("q", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "amazon-q",
    command: formatCommandLine("q", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeGooseRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "run",
    "--text",
    prompt,
    "--no-session",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("goose", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "goose",
    command: formatCommandLine("goose", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeKiroRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "run",
    "--prompt",
    prompt,
    "--non-interactive",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("kiro", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "kiro",
    command: formatCommandLine("kiro", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function executeGrokRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildWorkPrompt(context);
  const args = [
    "run",
    "--prompt",
    prompt,
    "--non-interactive",
  ];
  if (options.model) args.push("--model", options.model);

  const startedAt = isoNow();
  const started = performance.now();
  const result = await spawnCaptured("grok", args, context.repo, false, undefined, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backend: "grok",
    command: formatCommandLine("grok", args, prompt),
    prompt,
    response: result.stdout.trim().length > 0 ? result.stdout.trim() : undefined,
    started_at: startedAt,
    finished_at: isoNow(),
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout,
    stderr: result.stderr,
    tokensUsed: extractTokensUsed(result.stdout, result.stderr),
  };
}

async function spawnCaptured(
  command: string,
  args: string[],
  cwd: string,
  shell = false,
  env?: Record<string, string>,
  options: { timeoutMs?: number; stream?: boolean; interactive?: boolean } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Interactive mode: inherit stdio, let user interact directly
  if (options.interactive) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        shell,
        stdio: "inherit",
      });
      child.on("error", (error: Error) => {
        resolve({ exitCode: 127, stdout: "", stderr: error.message });
      });
      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout: "(interactive session)", stderr: "" });
      });
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGTERM");
            resolve({
              exitCode: 124,
              stdout,
              stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}process timed out after ${
                options.timeoutMs
              }ms`,
            });
          }, options.timeoutMs)
        : undefined;
    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}${stderr.length > 0 ? "\n" : ""}${error.message}`,
      });
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (options.stream) process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function createCcSwitchCodexHome(
  profile: string,
  tempDir: string,
): Promise<{ codexHome: string; name: string } | undefined> {
  const dbPath = join(homedir(), ".cc-switch", "cc-switch.db");
  const providersResult = await spawnCaptured(
    "sqlite3",
    [
      "-json",
      dbPath,
      "SELECT id, name, is_current, settings_config FROM providers WHERE app_type = 'codex'",
    ],
    process.cwd(),
  );
  if (providersResult.exitCode !== 0 || providersResult.stdout.trim().length === 0) {
    return undefined;
  }

  const providers = parseJsonArray<{
    id?: string;
    name?: string;
    is_current?: number;
    settings_config?: string;
  }>(providersResult.stdout);
  const normalizedProfile = profile.toLowerCase();
  const selected = providers.find(
    (provider) =>
      (normalizedProfile === "current" && provider.is_current === 1) ||
      provider.name?.toLowerCase() === normalizedProfile ||
      provider.id?.toLowerCase() === normalizedProfile,
  );
  if (!selected?.settings_config) return undefined;

  const settings = parseJsonObject<{
    auth?: Record<string, string>;
    config?: string;
  }>(selected.settings_config);
  if (!settings.auth || !settings.config) return undefined;

  const codexHome = join(tempDir, "codex-home");
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, "auth.json"), `${JSON.stringify(settings.auth)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(join(codexHome, "config.toml"), `${settings.config.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return { codexHome, name: selected.name ?? profile };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T extends object>(value: string): T {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function formatCommandLine(executable: string, args: string[], prompt: string): string {
  const visibleArgs = args.map((arg, index) => {
    if (index === args.length - 1 && arg === prompt) return "[prompt]";
    return quoteArg(arg);
  });
  return [executable, ...visibleArgs].join(" ");
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTokensUsed(stdout: string, stderr: string): number | undefined {
  const text = `${stdout}\n${stderr}`;
  const match = /tokens used\s*\n\s*([0-9][0-9,]*)/i.exec(text);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
