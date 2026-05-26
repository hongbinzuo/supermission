import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { WorkStore } from "./store.js";
import { resolveBackend } from "./runner.js";
import { runCli } from "./cli.js";
import type { WorkSpec } from "./types.js";

const DEFAULT_AGENT_LANGUAGE_INSTRUCTION =
  "Reply in the same language as the user's request unless the user explicitly asks for another language. " +
  "When the language is ambiguous, default to English.";

type PromptWorkContext = Pick<WorkSpec, "id" | "goal" | "acceptance" | "status">;

type SlashCommand = {
  name: string;
  completion: string;
  description: string;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", completion: "/help", description: "Show command help" },
  { name: "board", completion: "/board", description: "Board view" },
  { name: "list", completion: "/list", description: "List all work items" },
  { name: "use", completion: "/use ", description: "Switch to work item #id" },
  { name: "close", completion: "/close ", description: "Close the current or specified work item" },
  { name: "new", completion: "/new ", description: "Create a new work item" },
  { name: "status", completion: "/status ", description: "Show work status" },
  { name: "cost", completion: "/cost ", description: "Show token cost" },
  { name: "info", completion: "/info", description: "Show environment information" },
  { name: "pipeline", completion: "/pipeline", description: "Show pipelines" },
  { name: "clear", completion: "/clear", description: "Leave the current work item" },
  { name: "quit", completion: "/quit", description: "Exit superm" },
  { name: "tasks", completion: "/tasks", description: "Show task ledger" },
  { name: "trace", completion: "/trace", description: "Show trace evidence" },
  { name: "summary", completion: "/summary", description: "Show work summary" },
];

export function suggestSlashCommands(input: string): string[] {
  if (!input.startsWith("/")) return [];
  const normalized = input.trimEnd();
  return SLASH_COMMANDS.filter((command) =>
    command.completion.trimEnd().startsWith(normalized),
  ).map((command) => command.completion.trimEnd());
}

function formatSlashSuggestions(input: string): string {
  const suggestions = suggestSlashCommands(input);
  if (suggestions.length === 0) return "";
  return suggestions
    .map((suggestion) => {
      const command = SLASH_COMMANDS.find(
        (candidate) => candidate.completion.trimEnd() === suggestion,
      );
      return command ? `  ${suggestion.padEnd(12)} ${command.description}` : `  ${suggestion}`;
    })
    .join("\n");
}

export function formatHelpText(): string {
  return `
  /board              Board view
  /list               List all work items
  /use <id>           Switch to work item #id
  /close [id]         Close the current or specified work item
  /new "goal"         Create a new work item
  /status [id]        Show work status
  /cost [id]          Show token cost
  /info               Show environment information
  /pipeline           Show pipelines
  /clear              Leave the current work item
  /quit               Exit superm

  Type normal text -> enter an Agent interactive session
`;
}

export function buildAgentPrompt({
  input,
  work,
}: {
  input: string;
  work: PromptWorkContext;
}): string {
  const userRequest =
    work.status !== "draft"
      ? `[Work #${work.id}] Goal: ${work.goal}\n` +
        (work.acceptance.length > 0 ? `Acceptance: ${work.acceptance.join("; ")}\n` : "") +
        `Status: ${work.status}\n` +
        `\nUser request: ${input}`
      : input;

  return `${DEFAULT_AGENT_LANGUAGE_INSTRUCTION}\n\n${userRequest}`;
}

export async function startRepl(repo: string): Promise<void> {
  const { basename } = await import("node:path");
  const { detectAvailableBackends } = await import("./runner.js");

  const projectName = basename(repo);
  const store = new WorkStore(repo);
  const config = await store.readRunnerConfig();
  const available = await detectAvailableBackends();
  let backend = resolveBackend(config, { available });

  console.log(`  ⚡ Supermission — ${projectName}`);
  console.log(`  Agent: ${backend}`);
  console.log(`  Dashboard: http://localhost:4000`);
  console.log(`  Type a task to start an agent session. /commands for superm.`);
  console.log(`  /help for commands, exit to quit.\n`);

  let currentWorkId: string | null = null;

  const prompt = () => (currentWorkId ? `superm #${currentWorkId}> ` : `superm> `);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: prompt(),
    completer: (line: string) => {
      if (line.startsWith("/")) {
        const cmds = SLASH_COMMANDS.map((command) => command.completion);
        const hits = cmds.filter((c) => c.startsWith(line));
        return [hits.length ? hits : cmds, line];
      }
      return [[], line];
    },
  });

  // Show inline hint as user types slash commands
  if (process.stdin.isTTY) {
    const emitKeypressEvents = await import("node:readline").then((m) => m.emitKeypressEvents);
    emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", () => {
      const line = (rl as unknown as { line: string }).line;
      if (line && line.startsWith("/") && line.length > 1) {
        const suggestions = suggestSlashCommands(line);
        if (suggestions.length > 0 && suggestions[0] !== line.trimEnd()) {
          // Show ghost text (dimmed) after cursor
          const ghost = suggestions[0].slice(line.length);
          if (ghost) {
            process.stdout.write(`\x1b[2m${ghost}\x1b[0m`);
            // Move cursor back
            process.stdout.write(`\x1b[${ghost.length}D`);
          }
        }
      }
    });
  }

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
      // Handle /backend inline (needs to modify outer variable)
      if (input.startsWith("/backend ")) {
        const newBackend = input.slice("/backend ".length).trim();
        if (newBackend) {
          backend = newBackend as typeof backend;
          console.log(`  [Agent switched to: ${backend}]`);
        } else {
          console.log(`  Current Agent: ${backend}`);
        }
        rl.prompt();
        return;
      }
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

    // Build prompt with work context if resuming.
    const spec = await store.readWork(currentWorkId);
    const agentPrompt = buildAgentPrompt({ input, work: spec });

    // Launch agent in full interactive mode (Option A)
    console.log(`  [entering ${backend} session — Ctrl+D or /exit to return]\n`);
    rl.pause();

    const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const started = performance.now();
    const exitCode = await launchAgentSession(backend, agentPrompt, repo);
    const durationMs = Math.round(performance.now() - started);
    const finishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    console.log(
      `\n  [${backend} session ended (exit ${exitCode}, ${(durationMs / 1000).toFixed(1)}s)]`,
    );

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

    // Capture git diff as evidence of what the agent changed
    const { execFile: execFileNode } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFileNode);
    try {
      const { stdout: diffOutput } = await execFileAsync("git", ["diff", "--stat"], {
        cwd: repo,
        timeout: 5000,
      });
      const { stdout: diffFull } = await execFileAsync("git", ["diff"], {
        cwd: repo,
        timeout: 5000,
      });
      if (diffOutput.trim()) {
        console.log(`  [changes: ${diffOutput.trim().split("\n").length} file(s)]`);
        // Append diff summary to run log
        const diffSection =
          "\n## Changes After Session\n\n```\n" +
          diffOutput.trim() +
          "\n```\n\n## Diff\n\n```diff\n" +
          diffFull.slice(0, 5000) +
          (diffFull.length > 5000 ? "\n... (truncated)" : "") +
          "\n```\n";
        await writeFile(runLogPath, runLog + diffSection, "utf8");
        // Also save full patch
        const patchPath = store.paths(currentWorkId).patch;
        await writeFile(patchPath, diffFull, "utf8");
      }
    } catch {
      /* no git or no changes — skip */
    }

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
      console.log(formatHelpText());
      return {};

    case "quit":
    case "exit":
      console.log("Bye!");
      process.exit(0);
      break; // eslint: no-fallthrough

    case "use":
      if (!arg) {
        console.log("  Usage: /use <id>");
        return {};
      }
      try {
        const spec = await store.readWork(arg);
        console.log(`  [switched to #${spec.id}: ${spec.goal}]`);
        return { newWorkId: arg };
      } catch {
        console.log(`  [work #${arg} does not exist]`);
      }
      return {};

    case "close": {
      const id = arg || currentWorkId;
      if (!id) {
        console.log("  Usage: /close <id>");
        return {};
      }
      try {
        await store.updateStatus(id, "completed", "local-user", "Closed from REPL");
        console.log(`  [#${id} closed]`);
        if (id === currentWorkId) return { newWorkId: null };
      } catch (e) {
        console.log(`  [error: ${e instanceof Error ? e.message : e}]`);
      }
      return {};
    }

    case "new": {
      const goal = arg.replace(/^["']|["']$/g, "");
      if (!goal) {
        console.log('  Usage: /new "goal"');
        return {};
      }
      const id = await store.createWork({
        goal,
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      console.log(`  [work #${id} created: ${goal}]`);
      return { newWorkId: id };
    }

    case "clear":
      console.log("  [left current work item]");
      return { newWorkId: null };

    default: {
      const known = [
        "board",
        "list",
        "status",
        "cost",
        "info",
        "pipeline",
        "tasks",
        "trace",
        "summary",
      ];
      if (known.includes(cmd)) {
        try {
          await runCli([...parts, "--repo", repo]);
        } catch (e) {
          console.error(`  Error: ${e instanceof Error ? e.message : e}`);
        }
      } else {
        const suggestions = formatSlashSuggestions(input);
        if (suggestions) {
          console.log(`  Matching commands:\n${suggestions}`);
        } else {
          console.log(`  Unknown command: /${cmd}. Type / to see available commands.`);
        }
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
      console.error(`  [failed to start ${backend}: ${err.message}]`);
      resolve(127);
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}
