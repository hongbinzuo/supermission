import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec, spawn } from "node:child_process";
import { readFile, appendFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { WorkStore } from "./store.js";
import type { WorkSpec } from "./types.js";
import { readTeamRegistry } from "./identity.js";

// Track running agent processes: workId → { pid, process }
const runningAgents: Map<string, { pid: number; kill: () => void }> = new Map();

export type ServeOptions = {
  port: number;
  repo: string;
  open?: boolean;
};

export function resolvePipelineSavePath(repo: string, name: string): string {
  const pipelineName = name.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(pipelineName)) {
    throw new Error("invalid pipeline name");
  }

  const dir = resolve(repo, ".supermission", "pipelines");
  const filePath = resolve(dir, `${pipelineName}.yaml`);
  if (basename(filePath) !== `${pipelineName}.yaml` || !filePath.startsWith(`${dir}/`)) {
    throw new Error("invalid pipeline name");
  }

  return filePath;
}

export async function startServer(options: ServeOptions): Promise<void> {
  const store = new WorkStore(options.repo);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

    try {
      if (url.pathname === "/api/works") {
        const works = await getWorks(store);
        json(res, works);
      } else if (url.pathname === "/api/team") {
        const registry = await readTeamRegistry(store.repo);
        json(res, registry ?? { identities: [] });
      } else if (url.pathname.startsWith("/api/work/")) {
        const workId = decodeURIComponent(url.pathname.slice("/api/work/".length));
        const detail = await getWorkDetail(store, workId);
        json(res, detail);
      } else if (url.pathname === "/api/config") {
        const config = await store.readRunnerConfig();
        json(res, config);
      } else if (url.pathname === "/api/pipelines") {
        const { listPipelines } = await import("./pipeline.js");
        const pipelines = await listPipelines(store.repo);
        json(res, pipelines);
      } else if (url.pathname === "/api/environment") {
        const env = await getEnvironment(store);
        json(res, env);
      } else if (url.pathname === "/api/pipeline/save" && req.method === "POST") {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
        const YAML = (await import("yaml")).default;
        const filePath = resolvePipelineSavePath(store.repo, String(data.name ?? ""));
        const dir = join(store.repo, ".supermission", "pipelines");
        await mkdirFs(dir, { recursive: true });
        await writeFileFs(filePath, YAML.stringify(data.pipeline), "utf8");
        json(res, { ok: true, name: data.name });
      } else if (url.pathname.startsWith("/api/close/")) {
        const workId = decodeURIComponent(url.pathname.slice("/api/close/".length));
        await store.updateStatus(workId, "completed", "dashboard-user", "Closed from dashboard");
        json(res, { ok: true, workId, status: "completed" });
      } else if (url.pathname.startsWith("/api/action/")) {
        const parts = url.pathname.slice("/api/action/".length).split("/");
        const action = parts[0];
        const workId = decodeURIComponent(parts.slice(1).join("/"));

        if (action === "start") {
          // Spawn agent in background
          const result = await startWorkAgent(store, workId);
          json(res, result);
        } else if (action === "pause" || action === "fail") {
          // Kill running agent
          const killed = stopWorkAgent(workId);
          const newStatus = action === "pause" ? "paused" : "failed";
          await store.updateStatus(
            workId,
            newStatus as import("./types.js").WorkStatus,
            "dashboard-user",
            `${action} from dashboard`,
          );
          json(res, { ok: true, workId, status: newStatus, killed });
        } else {
          const statusMap: Record<string, string> = {
            complete: "completed",
            reopen: "draft",
            archive: "completed",
          };
          const newStatus = statusMap[action];
          if (!newStatus) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "unknown action" }));
            return;
          }
          await store.updateStatus(
            workId,
            newStatus as import("./types.js").WorkStatus,
            "dashboard-user",
            `${action} from dashboard`,
          );
          json(res, { ok: true, workId, status: newStatus });
        }
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml(options.port));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`\n  ⚡ Supermission Dashboard`);
    console.log(`  http://localhost:${options.port}\n`);
    console.log(`  Press Ctrl+C to stop.\n`);
    if (options.open) {
      exec(`open http://localhost:${options.port}`);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

async function getWorks(store: WorkStore): Promise<WorkSpec[]> {
  const ids = await store.listWorkIds();
  const works: WorkSpec[] = [];
  for (const id of ids) {
    works.push(await store.readWork(id));
  }
  return works;
}

async function startWorkAgent(store: WorkStore, workId: string) {
  // Check if already running
  if (runningAgents.has(workId)) {
    return { ok: false, error: "Agent already running for this work" };
  }

  const spec = await store.readWork(workId);
  const config = await store.readRunnerConfig();

  // Resolve which backend to use
  const { resolveBackend } = await import("./runner.js");
  const backend = resolveBackend(config, { available: config.fallback_order });

  if (backend === "record") {
    return { ok: false, error: "No agent backend configured. Run: supermission init" };
  }

  // Update status to running
  await store.updateStatus(
    workId,
    "running",
    "dashboard-user",
    `Started ${backend} from dashboard`,
  );

  // Build the prompt
  const { buildWorkPrompt } = await import("./runner.js");
  const prompt = buildWorkPrompt({ repo: store.repo, work: spec, actor: "dashboard-user" });

  // Determine command and args based on backend
  let cmd: string;
  let args: string[];

  switch (backend) {
    case "claude":
      cmd = "claude";
      args = [
        "--print",
        "--no-session-persistence",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
        prompt,
      ];
      break;
    case "codex":
      cmd = "codex";
      args = [
        "exec",
        "-C",
        store.repo,
        "--ephemeral",
        "--dangerously-bypass-approvals-and-sandbox",
        prompt,
      ];
      break;
    case "gemini":
      cmd = "gemini";
      args = ["--prompt", prompt, "--sandbox", "false", "--yes"];
      break;
    default:
      cmd = backend;
      args = ["--prompt", prompt];
  }

  // Spawn in background, capture output to run.log
  const paths = store.paths(workId);
  const logPath = paths.runLog;

  const child = spawn(cmd, args, {
    cwd: store.repo,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stdout = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    appendFile(logPath, chunk).catch(() => {});
  });
  child.stderr.on("data", (chunk: string) => {
    appendFile(logPath, chunk).catch(() => {});
  });

  const pid = child.pid ?? 0;
  runningAgents.set(workId, { pid, kill: () => child.kill("SIGTERM") });

  child.on("close", async (code) => {
    runningAgents.delete(workId);
    const exitCode = code ?? 1;

    try {
      if (exitCode !== 0) {
        await store.updateStatus(
          workId,
          "failed",
          "dashboard-user",
          `${backend} exited ${exitCode}`,
        );
      } else if (spec.validation_commands.length > 0) {
        // Agent succeeded — run validation automatically
        const valResult = await store.validate(workId, "validator-agent", {});
        if (valResult.exitCode === 0) {
          // Validation passed — auto-complete if no acceptance criteria need human review
          if (spec.acceptance.length === 0) {
            await store.updateStatus(
              workId,
              "completed",
              "dashboard-user",
              "Auto-completed: agent + validation passed",
            );
          } else {
            await store.updateStatus(
              workId,
              "validated",
              "dashboard-user",
              "Agent + validation passed, review acceptance criteria",
            );
          }
        } else {
          await store.updateStatus(
            workId,
            "failed",
            "dashboard-user",
            "Validation failed after agent completed",
          );
        }
      } else if (spec.acceptance.length > 0) {
        // No validation commands but has acceptance criteria — needs human review
        await store.updateStatus(
          workId,
          "needs_review",
          "dashboard-user",
          `${backend} completed, review needed`,
        );
      } else {
        // No validation, no acceptance — auto-complete
        await store.updateStatus(workId, "completed", "dashboard-user", `${backend} completed`);
      }

      await store.appendEvent(workId, "runner.executed", "dashboard-user", {
        backend,
        exit_code: exitCode,
        stdout_chars: stdout.length,
      });
    } catch {
      /* ignore cleanup errors */
    }
  });

  child.on("error", async () => {
    runningAgents.delete(workId);
    try {
      await store.updateStatus(workId, "failed", "dashboard-user", `${backend} failed to start`);
    } catch {
      /* ignore */
    }
  });

  return { ok: true, workId, backend, pid, status: "running" };
}

function stopWorkAgent(workId: string): boolean {
  const agent = runningAgents.get(workId);
  if (!agent) return false;
  agent.kill();
  runningAgents.delete(workId);
  return true;
}

async function getEnvironment(store: WorkStore) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const execFileAsync = promisify(execFile);
  const home = (await import("node:os")).homedir();

  // Detect agent CLIs
  const agents = [
    { name: "claude", cmd: "claude", versionFlag: "--version" },
    { name: "codex", cmd: "codex", versionFlag: "--version" },
    { name: "gemini", cmd: "gemini", versionFlag: "--version" },
    { name: "aider", cmd: "aider", versionFlag: "--version" },
    { name: "opencode", cmd: "opencode", versionFlag: "--version" },
    { name: "copilot", cmd: "gh", versionFlag: "--version" },
    { name: "amazon-q", cmd: "q", versionFlag: "--version" },
    { name: "goose", cmd: "goose", versionFlag: "--version" },
  ];

  const clis: Array<{ name: string; version: string; installed: boolean }> = [];
  for (const agent of agents) {
    try {
      const { stdout } = await execFileAsync(agent.cmd, [agent.versionFlag], { timeout: 3000 });
      clis.push({ name: agent.name, version: stdout.trim().split("\n")[0], installed: true });
    } catch {
      clis.push({ name: agent.name, version: "", installed: false });
    }
  }

  // Detect Codex plugins
  const codexPlugins: string[] = [];
  try {
    const pluginDir = join(
      home,
      ".codex",
      ".tmp",
      "bundled-marketplaces",
      "openai-bundled",
      "plugins",
    );
    const entries = await readdir(pluginDir);
    for (const entry of entries) codexPlugins.push(entry);
  } catch {
    /* no plugins */
  }

  // Detect Claude plugins
  let claudePlugins: string[] = [];
  try {
    const pluginFile = join(home, ".claude", "plugins", "installed_plugins.json");
    const text = await (await import("node:fs/promises")).readFile(pluginFile, "utf8");
    const data = JSON.parse(text);
    if (data.plugins && typeof data.plugins === "object") {
      claudePlugins = Object.keys(data.plugins);
    }
  } catch {
    /* no plugins */
  }

  // Runner config
  const config = await store.readRunnerConfig();

  return {
    clis,
    plugins: { codex: codexPlugins, claude: claudePlugins },
    config: {
      default_backend: config.default_backend,
      fallback_order: config.fallback_order,
      routing: config.routing,
    },
  };
}

async function getWorkDetail(store: WorkStore, workId: string) {
  const spec = await store.readWork(workId);
  const tasks = await store.listTasks(workId);
  const events = await store.readEvents(workId);
  const changes = await store.listChanges(workId);
  const paths = store.paths(workId);

  // Read artifacts
  let runLog = "";
  let validationLog = "";
  let plan = "";
  try {
    runLog = await readFile(paths.runLog, "utf8");
  } catch {
    /* empty */
  }
  try {
    validationLog = await readFile(paths.validationLog, "utf8");
  } catch {
    /* empty */
  }
  try {
    plan = await readFile(paths.plan, "utf8");
  } catch {
    /* empty */
  }

  return { spec, tasks, events, changes, runLog, validationLog, plan };
}

export function dashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supermission Dashboard</title>
<style>
:root { --bg: #0a0e1a; --surface: rgba(22,27,45,0.8); --glass: rgba(255,255,255,0.03); --border: rgba(255,255,255,0.08); --text: #e2e8f0; --muted: #64748b; --accent: #6366f1; --accent-glow: rgba(99,102,241,0.3); --green: #10b981; --orange: #f59e0b; --red: #ef4444; --purple: #a78bfa; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); background-image: radial-gradient(ellipse at top left, rgba(99,102,241,0.08) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(16,185,129,0.05) 0%, transparent 50%); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 300px; background: var(--surface); backdrop-filter: blur(20px); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.sidebar-header { padding: 20px; border-bottom: 1px solid var(--border); }
.sidebar-header h1 { font-size: 1.2rem; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.sidebar-header .subtitle { font-size: 0.75rem; color: var(--muted); margin-top: 6px; }
.work-list { flex: 1; overflow-y: auto; padding: 8px; }
.work-item { padding: 12px 16px; border-radius: 10px; cursor: pointer; transition: all 0.2s ease; margin-bottom: 4px; border: 1px solid transparent; }
.work-item:hover { background: var(--glass); border-color: var(--border); transform: translateX(2px); }
.work-item.active { background: rgba(99,102,241,0.08); border-color: var(--accent); box-shadow: 0 0 20px var(--accent-glow); }
.work-item .id { font-size: 0.7rem; color: var(--muted); letter-spacing: 0.02em; }
.work-item .goal { font-size: 0.85rem; margin-top: 4px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work-item .meta { font-size: 0.7rem; color: var(--muted); margin-top: 6px; display: flex; gap: 8px; align-items: center; }
.status-badge { font-size: 0.6rem; padding: 2px 8px; border-radius: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.status-draft { background: rgba(100,116,139,0.15); color: var(--muted); }
.status-planned { background: rgba(167,139,250,0.15); color: var(--purple); }
.status-approved { background: rgba(99,102,241,0.15); color: var(--accent); }
.status-running { background: rgba(245,158,11,0.15); color: var(--orange); animation: pulse 2s infinite; }
.status-validated { background: rgba(16,185,129,0.15); color: var(--green); }
.status-completed { background: rgba(16,185,129,0.15); color: var(--green); }
.status-failed { background: rgba(239,68,68,0.15); color: var(--red); }
.status-needs_review { background: rgba(245,158,11,0.15); color: var(--orange); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.main-header { padding: 20px 28px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface); backdrop-filter: blur(20px); }
.main-header h2 { font-size: 1.1rem; font-weight: 600; }
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); background: var(--surface); }
.tab { padding: 10px 20px; font-size: 0.8rem; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; font-weight: 500; }
.tab:hover { color: var(--text); background: var(--glass); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.content { flex: 1; overflow-y: auto; padding: 24px 28px; }
.detail-grid { display: grid; grid-template-columns: 110px 1fr; gap: 8px 20px; font-size: 0.85rem; margin-bottom: 24px; padding: 20px; background: var(--glass); border: 1px solid var(--border); border-radius: 12px; }
.detail-label { color: var(--muted); font-weight: 500; }
.log-box { background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 10px; padding: 16px; font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; line-height: 1.6; }
.event-line { padding: 6px 0; border-bottom: 1px solid var(--border); display: flex; gap: 12px; font-size: 0.8rem; transition: background 0.15s; }
.event-line:hover { background: var(--glass); }
.event-time { color: var(--muted); min-width: 70px; font-family: monospace; font-size: 0.75rem; }
.event-type { color: var(--accent); min-width: 150px; font-weight: 500; }
.event-actor { color: var(--muted); }
.empty-state { text-align: center; padding: 80px 20px; color: var(--muted); }
.empty-state h3 { margin-bottom: 12px; color: var(--text); font-size: 1.1rem; }
.empty-state code { background: var(--glass); border: 1px solid var(--border); padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; }
.refresh-indicator { font-size: 0.7rem; color: var(--muted); opacity: 0.6; }
.nav-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
.nav-tab { flex: 1; text-align: center; padding: 10px; font-size: 0.8rem; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; font-weight: 500; }
.nav-tab:hover { color: var(--text); }
.nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); background: rgba(99,102,241,0.05); }
.lang-btn { background: var(--glass); border: 1px solid var(--border); color: var(--muted); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 0.7rem; transition: all 0.2s; }
.lang-btn:hover { border-color: var(--accent); }
.lang-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(99,102,241,0.1); }
.pipeline-card { background: var(--glass); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 10px; transition: all 0.2s; }
.pipeline-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
.pipeline-name { font-size: 0.95rem; color: var(--accent); margin-bottom: 6px; font-weight: 600; }
.pipeline-desc { font-size: 0.8rem; color: var(--muted); margin-bottom: 10px; }
.pipeline-stages { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pipeline-stage { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); padding: 3px 10px; border-radius: 14px; font-size: 0.7rem; color: var(--accent); font-weight: 500; }
.env-section { margin-bottom: 20px; padding: 16px; background: var(--glass); border: 1px solid var(--border); border-radius: 12px; }
.env-title { font-size: 0.75rem; color: var(--muted); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
.env-item { font-size: 0.8rem; padding: 6px 0; display: flex; gap: 10px; align-items: center; }
.env-installed { color: var(--green); }
.env-missing { color: var(--muted); opacity: 0.5; }
.builder-palette { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding: 16px; background: var(--glass); border-radius: 12px; border: 1px solid var(--border); }
.builder-palette-item { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); padding: 8px 14px; border-radius: 8px; cursor: grab; font-size: 0.8rem; color: var(--accent); user-select: none; font-weight: 500; transition: all 0.2s; }
.builder-palette-item:hover { background: rgba(99,102,241,0.15); transform: scale(1.05); }
.builder-canvas { min-height: 80px; padding: 16px; background: rgba(0,0,0,0.2); border: 2px dashed var(--border); border-radius: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; transition: all 0.2s; }
.builder-canvas.drag-over { border-color: var(--accent); background: rgba(99,102,241,0.05); }
.builder-stage { background: var(--glass); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; cursor: pointer; position: relative; min-width: 100px; transition: all 0.2s; }
.builder-stage:hover { border-color: var(--accent); }
.builder-stage.selected { border-color: var(--accent); box-shadow: 0 0 15px var(--accent-glow); }
.builder-stage .stage-name { font-size: 0.8rem; color: var(--accent); font-weight: 600; }
.builder-stage .stage-backend { font-size: 0.7rem; color: var(--muted); }
.builder-stage .stage-remove { position: absolute; top: -6px; right: -6px; background: var(--red); color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 0.65rem; cursor: pointer; display: none; line-height: 18px; text-align: center; transition: transform 0.15s; }
.builder-stage:hover .stage-remove { display: block; }
.builder-stage .stage-remove:hover { transform: scale(1.2); }
.builder-arrow { color: var(--muted); font-size: 1.2rem; }
.builder-config { background: var(--glass); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.builder-config label { display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; margin-top: 12px; font-weight: 500; }
.builder-config input, .builder-config select, .builder-config textarea { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--border); color: var(--text); padding: 8px 10px; border-radius: 6px; font-size: 0.8rem; transition: border-color 0.2s; }
.builder-config input:focus, .builder-config select:focus, .builder-config textarea:focus { border-color: var(--accent); outline: none; }
.builder-config textarea { min-height: 60px; resize: vertical; }
.builder-actions { display: flex; gap: 8px; margin-top: 16px; }
.builder-actions button { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); cursor: pointer; font-size: 0.8rem; font-weight: 500; transition: all 0.2s; }
.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
.btn-primary:hover { box-shadow: 0 0 20px var(--accent-glow); transform: translateY(-1px); }
.btn-secondary { background: var(--glass); color: var(--text); }
.btn-secondary:hover { border-color: var(--muted); }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">
    <h1>⚡ Supermission</h1>
    <div class="subtitle" id="subtitle">本地优先 AI 工作记录</div>
    <div style="margin-top:8px;display:flex;gap:4px;">
      <button class="lang-btn" onclick="setLang('zh')" id="btn-zh">中</button>
      <button class="lang-btn" onclick="setLang('zh-TW')" id="btn-zh-TW">繁</button>
      <button class="lang-btn" onclick="setLang('en')" id="btn-en">EN</button>
    </div>
  </div>
  <div class="nav-tabs">
    <div class="nav-tab active" id="nav-kanban" onclick="switchView('kanban')"><span id="lbl-kanban">看板</span></div>
    <div class="nav-tab" id="nav-pipelines" onclick="switchView('pipelines')"><span id="lbl-pipelines">流水线</span></div>
    <div class="nav-tab" id="nav-builder" onclick="switchView('builder')"><span id="lbl-builder">编排</span></div>
    <div class="nav-tab" id="nav-env" onclick="switchView('env')"><span id="lbl-env">环境</span></div>
  </div>
  <div class="work-list" id="workList"></div>
</div>
<div class="main">
  <div class="main-header">
    <h2 id="mainTitle">Dashboard</h2>
    <span class="refresh-indicator" id="refreshIndicator">auto-refresh: 3s</span>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="content" id="content"></div>
</div>

<script>
const API = 'http://localhost:${port}';
let selectedWork = null;
let currentTab = 'overview';

async function loadWorks() {
  if (currentView !== 'kanban') return;
  const works = await fetch(API + '/api/works').then(r => r.json());
  renderWorkList(works);
  document.getElementById('mainTitle').textContent = L('kanban');
  if (!selectedWork && works.length > 0) selectWork(works[0].id);
  else if (selectedWork) refreshDetail();
  else { document.getElementById('content').innerHTML = '<div class="empty-state"><h3>' + L('noWorks') + '</h3><p>superm> /new "your task"</p></div>'; document.getElementById('tabs').innerHTML = ''; }
}

function renderWorkList(works) {
  const el = document.getElementById('workList');
  if (works.length === 0) {
    el.innerHTML = '<div class="empty-state"><h3>No works yet</h3><p>Run: <code>supermission new "Your task"</code></p></div>';
    return;
  }
  el.innerHTML = works.map(w => {
    const active = selectedWork === w.id ? ' active' : '';
    const assignee = w.assignee ? ' @' + w.assignee : '';
    return '<div class="work-item' + active + '" onclick="selectWork(\\'' + w.id + '\\')">'
      + '<div class="id">#' + w.id + assignee + ' <span class="status-badge status-' + w.status + '">' + w.status + '</span></div>'
      + '<div class="goal">' + esc(w.goal) + '</div>'
      + '<div class="meta"><span>' + w.priority + '</span><span>' + timeAgo(w.updated_at) + '</span></div>'
      + '</div>';
  }).join('');
}

async function selectWork(id) {
  selectedWork = id;
  currentTab = 'overview';
  await refreshDetail();
  loadWorks(); // re-render to highlight
}

async function refreshDetail() {
  if (!selectedWork) return;
  const data = await fetch(API + '/api/work/' + selectedWork).then(r => r.json());
  document.getElementById('mainTitle').textContent = '#' + data.spec.id + ' — ' + data.spec.goal;
  renderTabs();
  renderContent(data);
}

function renderTabs() {
  const tabs = [
    { key: 'overview', label: L('overview') },
    { key: 'events', label: L('events') },
    { key: 'run log', label: L('runlog') },
    { key: 'validation', label: L('validation') },
    { key: 'plan', label: L('plan') },
  ];
  document.getElementById('tabs').innerHTML = tabs.map(t => {
    const active = currentTab === t.key ? ' active' : '';
    return '<div class="tab' + active + '" onclick="switchTab(\\'' + t.key + '\\')">' + t.label + '</div>';
  }).join('');
}

function switchTab(tab) {
  currentTab = tab;
  refreshDetail();
}

function renderContent(data) {
  const el = document.getElementById('content');
  const s = data.spec;

  if (currentTab === 'overview') {
    el.innerHTML = '<div class="detail-grid">'
      + row(L('status'), '<span class="status-badge status-' + s.status + '">' + s.status + '</span>')
      + row(L('goal'), esc(s.goal))
      + row(L('owner'), s.owner)
      + row(L('assignee'), s.assignee || '—')
      + row(L('priority'), s.priority || 'medium')
      + row(L('team'), s.team || '—')
      + row(L('created'), s.created_at)
      + row(L('updated'), s.updated_at)
      + row(L('acceptance'), s.acceptance.length > 0 ? s.acceptance.map(a => '• ' + esc(a)).join('<br>') : '—')
      + row(L('validationCmd'), s.validation_commands.length > 0 ? s.validation_commands.map(c => '<code>' + esc(c) + '</code>').join('<br>') : '—')
      + row(L('tasks'), data.tasks.length + '')
      + row(L('events'), data.events.length + '')
      + row(L('changes'), data.changes.length + '')
      + '</div>'
      + renderActions(s.id, s.status);
  } else if (currentTab === 'events') {
    if (data.events.length === 0) {
      el.innerHTML = '<div class="empty-state">' + L('noEvents') + '</div>';
      return;
    }
    el.innerHTML = data.events.slice().reverse().map(e => {
      const time = e.time ? e.time.slice(11, 19) : '';
      return '<div class="event-line"><span class="event-time">' + time + '</span><span class="event-type">' + e.type + '</span><span class="event-actor">' + e.actor + '</span></div>';
    }).join('');
  } else if (currentTab === 'run log') {
    el.innerHTML = data.runLog && data.runLog.trim() ? '<div class="log-box">' + esc(data.runLog) + '</div>' : '<div class="empty-state">' + L('noRunLog') + '</div>';
  } else if (currentTab === 'validation') {
    el.innerHTML = data.validationLog && data.validationLog.trim() ? '<div class="log-box">' + esc(data.validationLog) + '</div>' : '<div class="empty-state">' + L('noValidation') + '</div>';
  } else if (currentTab === 'plan') {
    el.innerHTML = data.plan && data.plan.trim() ? '<div class="log-box">' + esc(data.plan) + '</div>' : '<div class="empty-state">' + L('noPlan') + '</div>';
  }
}

function row(label, value) {
  return '<div class="detail-label">' + label + '</div><div>' + value + '</div>';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadWorks();
setInterval(() => { if (currentView === 'kanban') loadWorks(); }, 3000);

let currentView = 'kanban';
let currentLang = 'zh';

const i18n = {
  zh: { subtitle: '本地优先 AI 工作记录', kanban: '看板', pipelines: '流水线', builder: '编排', env: '环境', overview: '概览', events: '事件', runlog: '运行日志', validation: '验证', plan: '计划', noWorks: '还没有任务', noEvents: '暂无事件', noRunLog: '暂无运行日志', noValidation: '暂无验证日志', noPlan: '暂无计划', total: '个任务', status: '状态', goal: '目标', owner: '负责人', assignee: '执行人', priority: '优先级', team: '团队', created: '创建时间', updated: '更新时间', acceptance: '验收标准', validationCmd: '验证命令', tasks: '子任务', changes: '变更', installed: '已安装', notInstalled: '未安装', plugins: '插件', config: '配置', defaultBackend: '默认后端', fallbackOrder: '降级顺序', routing: '路由' },
  'zh-TW': { subtitle: '本地優先 AI 工作記錄', kanban: '看板', pipelines: '流水線', builder: '編排', env: '環境', overview: '概覽', events: '事件', runlog: '運行日誌', validation: '驗證', plan: '計劃', noWorks: '還沒有任務', noEvents: '暫無事件', noRunLog: '暫無運行日誌', noValidation: '暫無驗證日誌', noPlan: '暫無計劃', total: '個任務', status: '狀態', goal: '目標', owner: '負責人', assignee: '執行人', priority: '優先級', team: '團隊', created: '創建時間', updated: '更新時間', acceptance: '驗收標準', validationCmd: '驗證命令', tasks: '子任務', changes: '變更', installed: '已安裝', notInstalled: '未安裝', plugins: '插件', config: '配置', defaultBackend: '默認後端', fallbackOrder: '降級順序', routing: '路由' },
  en: { subtitle: 'Local-first AI work records', kanban: 'Kanban', pipelines: 'Pipelines', builder: 'Builder', env: 'Environment', overview: 'Overview', events: 'Events', runlog: 'Run Log', validation: 'Validation', plan: 'Plan', noWorks: 'No works yet', noEvents: 'No events yet', noRunLog: 'No run log yet', noValidation: 'No validation log yet', noPlan: 'No plan yet', total: 'work(s)', status: 'Status', goal: 'Goal', owner: 'Owner', assignee: 'Assignee', priority: 'Priority', team: 'Team', created: 'Created', updated: 'Updated', acceptance: 'Acceptance', validationCmd: 'Validation', tasks: 'Tasks', changes: 'Changes', installed: 'installed', notInstalled: 'not installed', plugins: 'Plugins', config: 'Config', defaultBackend: 'Default backend', fallbackOrder: 'Fallback order', routing: 'Routing' },
};

function L(key) { return i18n[currentLang][key] || key; }

async function setLang(lang) {
  currentLang = lang;
  document.getElementById('subtitle').textContent = L('subtitle');
  document.getElementById('lbl-kanban').textContent = L('kanban');
  document.getElementById('lbl-pipelines').textContent = L('pipelines');
  document.getElementById('lbl-builder').textContent = L('builder');
  document.getElementById('lbl-env').textContent = L('env');
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + lang).classList.add('active');
  await refreshCurrentView();
}

async function refreshCurrentView() {
  if (currentView === 'kanban') { await loadWorks(); }
  else if (currentView === 'pipelines') { await loadPipelines(); }
  else if (currentView === 'builder') { await loadBuilder(); }
  else if (currentView === 'env') { await loadEnvironment(); }
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('nav-' + view).classList.add('active');
  // Clear both panels before loading new view
  document.getElementById('workList').innerHTML = '';
  document.getElementById('content').innerHTML = '';
  document.getElementById('tabs').innerHTML = '';
  document.getElementById('mainTitle').textContent = '';
  selectedWork = null;
  if (view === 'kanban') { loadWorks(); }
  else if (view === 'pipelines') { loadPipelines(); }
  else if (view === 'builder') { loadBuilder(); }
  else if (view === 'env') { loadEnvironment(); }
}

async function loadPipelines() {
  const pipelines = await fetch(API + '/api/pipelines').then(r => r.json());
  const el = document.getElementById('workList');
  const content = document.getElementById('content');
  document.getElementById('mainTitle').textContent = L('pipelines');
  document.getElementById('tabs').innerHTML = '';
  el.innerHTML = '';
  if (pipelines.length === 0) {
    content.innerHTML = '<div class="empty-state"><h3>No pipelines</h3><p>Run: <code>supermission pipeline init</code></p></div>';
    return;
  }
  content.innerHTML = pipelines.map(p =>
    '<div class="pipeline-card"><div class="pipeline-name">' + esc(p.name) + '</div>'
    + '<div class="pipeline-desc">' + esc(p.description) + '</div>'
    + '<div class="pipeline-stages">' + p.stages.map(s =>
      '<span class="pipeline-stage">' + s.id + ' (' + s.role + ')' + (s.backend ? ' [' + s.backend + ']' : '') + '</span>'
    ).join(' → ') + '</div></div>'
  ).join('');
}

async function loadBuilder() {
  const el = document.getElementById('workList');
  const content = document.getElementById('content');
  document.getElementById('mainTitle').textContent = L('builder');
  document.getElementById('tabs').innerHTML = '';
  el.innerHTML = '';

  const backends = ['claude','codex','gemini','aider','opencode','copilot','amazon-q','goose','kiro','grok','shell'];
  const templates = [
    { id: 'plan', role: 'planner-agent', prompt: 'Break down this into implementation steps' },
    { id: 'code', role: 'worker-agent', prompt: 'Implement according to the plan' },
    { id: 'test', role: 'tester-agent', prompt: 'Write and run tests' },
    { id: 'review', role: 'reviewer-agent', prompt: 'Review code changes for quality and security' },
    { id: 'deploy', role: 'deploy-agent', prompt: 'Deploy the changes' },
    { id: 'custom', role: 'worker-agent', prompt: '' },
  ];

  let stages = [];
  let selectedIdx = -1;

  function render() {
    let html = '<div style="margin-bottom:12px"><label style="font-size:0.8rem;color:var(--muted)">Pipeline name:</label> <input id="pipe-name" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;width:200px;font-size:0.8rem" value="my-pipeline"></div>';
    html += '<div class="builder-palette">';
    for (const t of templates) {
      html += '<div class="builder-palette-item" onclick="addStage(\\'' + t.id + '\\',\\'' + t.role + '\\',\\'' + t.prompt.replace(/'/g,'') + '\\')">' + t.id + '</div>';
    }
    html += '</div>';
    html += '<div class="builder-canvas" id="builder-canvas">';
    if (stages.length === 0) {
      html += '<span style="color:var(--muted);font-size:0.8rem">Click stages above to add them here</span>';
    } else {
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i];
        const sel = i === selectedIdx ? ' selected' : '';
        html += '<div class="builder-stage' + sel + '" onclick="selectStage(' + i + ')"><div class="stage-name">' + s.id + '</div><div class="stage-backend">' + (s.backend || 'auto') + '</div><button class="stage-remove" onclick="event.stopPropagation();removeStage(' + i + ')">×</button></div>';
        if (i < stages.length - 1) html += '<span class="builder-arrow">→</span>';
      }
    }
    html += '</div>';
    if (selectedIdx >= 0 && stages[selectedIdx]) {
      const s = stages[selectedIdx];
      html += '<div class="builder-config">';
      html += '<label>Stage ID</label><input value="' + esc(s.id) + '" onchange="updateStage(\\'id\\',this.value)">';
      html += '<label>Role</label><input value="' + esc(s.role) + '" onchange="updateStage(\\'role\\',this.value)">';
      html += '<label>Backend</label><select onchange="updateStage(\\'backend\\',this.value)"><option value="">auto</option>' + backends.map(b => '<option value="' + b + '"' + (s.backend === b ? ' selected' : '') + '>' + b + '</option>').join('') + '</select>';
      html += '<label>Prompt</label><textarea onchange="updateStage(\\'prompt\\',this.value)">' + esc(s.prompt || '') + '</textarea>';
      html += '<label>Validation command (optional)</label><input value="' + esc(s.validation || '') + '" onchange="updateStage(\\'validation\\',this.value)" placeholder="e.g. bun run test">';
      html += '<label><input type="checkbox" ' + (s.gate ? 'checked' : '') + ' onchange="updateStage(\\'gate\\',this.checked ? \\'approve_\\' + stages[' + selectedIdx + '].id : \\'\\')"> Require approval gate</label>';
      html += '</div>';
    }
    html += '<div class="builder-actions"><button class="btn-primary" onclick="savePipeline()">Save Pipeline</button><button class="btn-secondary" onclick="stages=[];selectedIdx=-1;render()">Clear</button></div>';
    content.innerHTML = html;
  }

  window.addStage = function(id, role, prompt) {
    stages.push({ id: id + (stages.filter(s=>s.id.startsWith(id)).length || ''), role, prompt, backend: '', validation: '', gate: '', skip_on_fail: false });
    selectedIdx = stages.length - 1;
    render();
  };
  window.removeStage = function(i) { stages.splice(i, 1); if (selectedIdx >= stages.length) selectedIdx = stages.length - 1; render(); };
  window.selectStage = function(i) { selectedIdx = i; render(); };
  window.updateStage = function(key, val) { if (selectedIdx >= 0) { stages[selectedIdx][key] = val; render(); } };
  window.savePipeline = async function() {
    const name = document.getElementById('pipe-name').value.trim() || 'my-pipeline';
    const pipeline = { name, description: 'Created from dashboard builder', stages: stages.map(s => { const o = { id: s.id, role: s.role, skip_on_fail: false }; if (s.backend) o.backend = s.backend; if (s.prompt) o.prompt = s.prompt; if (s.validation) o.validation = s.validation; if (s.gate) o.gate = s.gate; return o; }) };
    await fetch(API + '/api/pipeline/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, pipeline }) });
    alert('Pipeline "' + name + '" saved!');
  };

  render();
}

async function loadEnvironment() {
  const env = await fetch(API + '/api/environment').then(r => r.json());
  const el = document.getElementById('workList');
  const content = document.getElementById('content');
  document.getElementById('mainTitle').textContent = L('env');
  document.getElementById('tabs').innerHTML = '';
  el.innerHTML = '';
  let html = '<div class="env-section"><div class="env-title">Agent CLIs</div>';
  for (const cli of env.clis) {
    const cls = cli.installed ? 'env-installed' : 'env-missing';
    const icon = cli.installed ? '✓' : '✗';
    html += '<div class="env-item"><span class="' + cls + '">' + icon + '</span><span>' + cli.name + '</span><span class="' + cls + '">' + (cli.version || L('notInstalled')) + '</span></div>';
  }
  html += '</div>';
  html += '<div class="env-section"><div class="env-title">' + L('plugins') + '</div>';
  if (env.plugins.codex.length > 0) html += '<div class="env-item"><span>Codex:</span><span>' + env.plugins.codex.join(', ') + '</span></div>';
  if (env.plugins.claude.length > 0) html += '<div class="env-item"><span>Claude:</span><span>' + env.plugins.claude.join(', ') + '</span></div>';
  if (env.plugins.codex.length === 0 && env.plugins.claude.length === 0) html += '<div class="env-item" style="color:var(--muted)">No plugins detected</div>';
  html += '</div>';
  html += '<div class="env-section"><div class="env-title">' + L('config') + '</div>';
  html += '<div class="env-item"><span>' + L('defaultBackend') + ':</span><span>' + env.config.default_backend + '</span></div>';
  if (env.config.fallback_order.length > 0) html += '<div class="env-item"><span>' + L('fallbackOrder') + ':</span><span>' + env.config.fallback_order.join(' → ') + '</span></div>';
  if (Object.keys(env.config.routing).length > 0) {
    html += '<div class="env-item"><span>' + L('routing') + ':</span></div>';
    for (const [role, backend] of Object.entries(env.config.routing)) {
      html += '<div class="env-item" style="padding-left:16px"><span>' + role + ' →</span><span>' + backend + '</span></div>';
    }
  }
  html += '</div>';
  content.innerHTML = html;
}

async function closeWork(id) {
  await fetch(API + '/api/close/' + id, { method: 'POST' });
  await loadWorks();
  await refreshDetail();
}

function renderActions(id, status) {
  const btn = (label, action, color) => '<button style="background:var(--surface);border:1px solid var(--border);color:' + color + ';padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;margin-right:6px;" onclick="doAction(\\'' + action + '\\',\\'' + id + '\\')">' + label + '</button>';
  let html = '<div style="margin-top:12px">';
  if (['draft','planned','approved','paused'].includes(status)) html += btn('▶ Start', 'start', 'var(--orange)');
  if (status === 'running') html += btn('⏸ Pause', 'pause', 'var(--muted)');
  if (['running','validated','needs_review'].includes(status)) html += btn('✓ Complete', 'complete', 'var(--green)');
  if (status === 'running') html += btn('✗ Fail', 'fail', 'var(--red)');
  if (['completed','failed','paused'].includes(status)) html += btn('↺ Reopen', 'reopen', 'var(--accent)');
  if (status !== 'completed') html += btn('🗑 Archive', 'archive', 'var(--muted)');
  html += '</div>';
  return html;
}

async function doAction(action, id) {
  await fetch(API + '/api/action/' + action + '/' + id, { method: 'POST' });
  await loadWorks();
  await refreshDetail();
}

// Init language
setLang('zh');
</script>
</body>
</html>`;
}
