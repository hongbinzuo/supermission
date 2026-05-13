import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { MissionSpec } from "./types.js";

export type RunnerBackend = "record" | "shell" | "codex" | "claude";

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
    label: "Execute Codex CLI through the shared runner interface",
    kind: "external",
    profileSource: "cc-switch-or-native",
  },
  {
    backend: "claude",
    label: "Execute Claude Code CLI through the shared runner interface",
    kind: "external",
    profileSource: "native",
  },
];

export type RunnerContext = {
  repo: string;
  mission: MissionSpec;
  actor: string;
  note?: string;
};

export type RunnerOptions = {
  command?: string;
  prompt?: string;
  model?: string;
  profile?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  tools?: string[];
  timeoutMs?: number;
};

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
};

export function buildMissionPrompt(context: RunnerContext): string {
  const lines = [
    `Mission ID: ${context.mission.id}`,
    `Goal: ${context.mission.goal}`,
    `Actor: ${context.actor}`,
    "",
    "Acceptance criteria:",
    ...(context.mission.acceptance.length > 0
      ? context.mission.acceptance.map((item) => `- ${item}`)
      : ["- TBD"]),
    "",
    "Validation commands:",
    ...(context.mission.validation_commands.length > 0
      ? context.mission.validation_commands.map((command) => `- ${command}`)
      : ["- TBD"]),
    "",
    "Task:",
    context.note ?? "Implement the mission and return a concise completion summary.",
    "",
    "Return only the completion summary unless the backend requires another format.",
  ];
  return lines.join("\n");
}

export function formatRunLog(input: {
  missionId: string;
  goal: string;
  actor: string;
  execution: RunnerExecution;
}): string {
  const { missionId, goal, actor, execution } = input;
  const lines = [
    "# Run",
    "",
    `Mission: ${missionId}`,
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
  switch (backend) {
    case "record":
      return executeRecordRunner(context);
    case "shell":
      return executeShellRunner(context, options);
    case "codex":
      return executeCodexRunner(context, options);
    case "claude":
      return executeClaudeRunner(context, options);
  }
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
    command: "mission run --backend record",
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
  };
}

async function executeCodexRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildMissionPrompt(context);
  const tempDir = await mkdtemp(join(tmpdir(), "supermission-codex-"));
  const outputPath = join(tempDir, "last-message.txt");
  const ccSwitchProfile = options.profile
    ? await createCcSwitchCodexHome(options.profile, tempDir)
    : undefined;
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
  if (options.profile && !ccSwitchProfile) args.push("-p", options.profile);
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
  };
}

async function executeClaudeRunner(
  context: RunnerContext,
  options: RunnerOptions,
): Promise<RunnerExecution> {
  const prompt = options.prompt ?? buildMissionPrompt(context);
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
  };
}

async function spawnCaptured(
  command: string,
  args: string[],
  cwd: string,
  shell = false,
  env?: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
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
    ["-json", dbPath, "SELECT id, name, settings_config FROM providers WHERE app_type = 'codex'"],
    process.cwd(),
  );
  if (providersResult.exitCode !== 0 || providersResult.stdout.trim().length === 0) {
    return undefined;
  }

  const providers = parseJsonArray<{
    id?: string;
    name?: string;
    settings_config?: string;
  }>(providersResult.stdout);
  const selected = providers.find(
    (provider) =>
      provider.name?.toLowerCase() === profile.toLowerCase() ||
      provider.id?.toLowerCase() === profile.toLowerCase(),
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
