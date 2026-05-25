import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { WorkStore } from "./store.js";
import { resolveBackend } from "./runner.js";
import { runCli } from "./cli.js";

export async function startRepl(repo: string): Promise<void> {
  const { basename } = await import("node:path");
  const { detectAvailableBackends } = await import("./runner.js");

  const projectName = basename(repo);
  const store = new WorkStore(repo);
  const config = await store.readRunnerConfig();
  const available = await detectAvailableBackends();
  const backend = resolveBackend(config, { available });

  console.log(`  ⚡ Supermission — ${projectName}`);
  console.log(`  Agent: ${backend}`);
  console.log(`  Dashboard: http://localhost:4000`);
  console.log(`  Type a task to start an agent session. /commands for superm.`);
  console.log(`  /help for commands, exit to quit.\n`);

  let currentWorkId: string | null = null;

  const prompt = () => currentWorkId ? `superm #${currentWorkId}> ` : `superm> `;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: prompt(),
    completer: (line: string) => {
      const cmds = ["/help", "/board", "/list", "/use ", "/close ", "/new ", "/status ", "/cost ", "/info", "/pipeline", "/clear", "/quit"];
      if (line.startsWith("/")) {
        const hits = cmds.filter((c) => c.startsWith(line));
        return [hits.length ? hits : cmds, line];
      }
      return [[], line];
    },
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Exit without slash
    if (input === "exit" || input === "quit" || input === "q") {
      console.log("Bye!");
      process.exit(0);
    }

    // Slash commands
    if (input.startsWith("/")) {
      const result = await handleSlash(input, store, repo, currentWorkId);
      if (result.newWorkId !== undefined) {
        currentWorkId = result.newWorkId;
        rl.setPrompt(prompt());
      }
      rl.prompt();
      return;
    }

    // --- Agent session ---
    // Create work record if needed
    if (!currentWorkId) {
      const goal = input.length > 60 ? input.slice(0, 57) + "..." : input;
      currentWorkId = await store.createWork({
        goal,
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      rl.setPrompt(prompt());
      console.log(`  [work #${currentWorkId} created]`);
    }

    // Launch agent in full interactive mode (Option A)
    console.log(`  [entering ${backend} session — Ctrl+D or /exit to return]\n`);
    rl.pause();

    const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const started = performance.now();
    const exitCode = await launchAgentSession(backend, input, repo);
    const durationMs = Math.round(performance.now() - started);
    const finishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    console.log(`\n  [${backend} session ended (exit ${exitCode}, ${(durationMs / 1000).toFixed(1)}s)]`);

    // Record evidence
    await store.appendEvent(currentWorkId, "agent.session", "local-user", {
      backend,
      exit_code: exitCode,
      duration_ms: durationMs,
      initial_prompt: input,
    });

    // Write run log
    const { writeFile } = await import("node:fs/promises");
    const runLogPath = store.paths(currentWorkId).runLog;
    const runLog = [
      "# Run",
      "",
      `Work: ${currentWorkId}`,
      `Actor: local-user`,
      `Backend: ${backend}`,
      `Mode: interactive session`,
      `Started: ${startedAt}`,
      `Finished: ${finishedAt}`,
      `Exit code: ${exitCode}`,
      `Duration: ${durationMs}ms`,
      "",
      "## Initial Prompt",
      "",
      "```text",
      input,
      "```",
      "",
      "## Note",
      "",
      "This was an interactive session (stdio:inherit).",
      "Full conversation happened in the terminal.",
      "Agent had full control of stdin/stdout.",
      "",
    ].join("\n");
    await writeFile(runLogPath, runLog, "utf8");

    rl.resume();
    rl.setPrompt(prompt());
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nBye!");
    process.exit(0);
  });
}

// --- Slash command handler ---

type SlashResult = { newWorkId?: string | null };

async function handleSlash(
  input: string,
  store: WorkStore,
  repo: string,
  currentWorkId: string | null,
): Promise<SlashResult> {
  const parts = input.slice(1).split(" ");
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "":
    case "help":
      console.log(`
  /board              看板视图
  /list               列出所有任务
  /use <id>           切换到任务 #id
  /close [id]         关闭当前或指定任务
  /new "goal"         创建新任务
  /status [id]        查看任务状态
  /cost [id]          查看 Token 成本
  /info               查看环境信息
  /pipeline           查看流水线
  /clear              脱离当前任务
  /quit               退出 superm

  直接输入文字 → 进入 Agent 交互会话
`);
      return {};

    case "quit":
    case "exit":
      console.log("Bye!");
      process.exit(0);
      break; // eslint: no-fallthrough

    case "use":
      if (!arg) { console.log("  用法: /use <id>"); return {}; }
      try {
        const spec = await store.readWork(arg);
        console.log(`  [切换到 #${spec.id}: ${spec.goal}]`);
        return { newWorkId: arg };
      } catch { console.log(`  [任务 #${arg} 不存在]`); }
      return {};

    case "close": {
      const id = arg || currentWorkId;
      if (!id) { console.log("  用法: /close <id>"); return {}; }
      try {
        await store.updateStatus(id, "completed", "local-user", "Closed from REPL");
        console.log(`  [#${id} 已关闭]`);
        if (id === currentWorkId) return { newWorkId: null };
      } catch (e) { console.log(`  [错误: ${e instanceof Error ? e.message : e}]`); }
      return {};
    }

    case "new": {
      const goal = arg.replace(/^["']|["']$/g, "");
      if (!goal) { console.log('  用法: /new "目标描述"'); return {}; }
      const id = await store.createWork({ goal, actor: "local-user", acceptance: [], validationCommands: [] });
      console.log(`  [任务 #${id} 已创建: ${goal}]`);
      return { newWorkId: id };
    }

    case "clear":
      console.log("  [已脱离当前任务]");
      return { newWorkId: null };

    default: {
      const known = ["board", "list", "status", "cost", "info", "pipeline", "tasks", "trace", "summary"];
      if (known.includes(cmd)) {
        try { await runCli([...parts, "--repo", repo]); }
        catch (e) { console.error(`  错误: ${e instanceof Error ? e.message : e}`); }
      } else {
        console.log(`  未知命令: /${cmd}。输入 / 查看可用命令。`);
      }
      return {};
    }
  }
}

// --- Launch agent in full interactive mode ---

function launchAgentSession(backend: string, initialPrompt: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    switch (backend) {
      case "claude":
        // Launch claude interactively with initial prompt as positional arg
        cmd = "claude";
        args = [initialPrompt];
        break;
      case "codex":
        cmd = "codex";
        args = ["-C", cwd, initialPrompt];
        break;
      case "gemini":
        cmd = "gemini";
        args = [initialPrompt];
        break;
      case "aider":
        cmd = "aider";
        args = ["--message", initialPrompt];
        break;
      default:
        cmd = backend;
        args = [initialPrompt];
    }

    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit", // Full interactive — agent owns the terminal
    });

    child.on("error", (err) => {
      console.error(`  [无法启动 ${backend}: ${err.message}]`);
      resolve(127);
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}
