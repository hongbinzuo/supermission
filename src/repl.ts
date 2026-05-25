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
  console.log(`  Talk to the agent directly. Use /commands for superm features.`);
  console.log(`  /help for commands, /quit to exit.\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `superm> `,
    completer: (line: string) => {
      const slashCommands = ["/help", "/board", "/list", "/use ", "/close", "/new ", "/status ", "/cost ", "/info", "/pipeline", "/clear", "/quit"];
      if (line.startsWith("/")) {
        const hits = slashCommands.filter((c) => c.startsWith(line));
        return [hits.length ? hits : slashCommands, line];
      }
      return [[], line];
    },
  });

  let currentWorkId: string | null = null;

  function updatePrompt(): void {
    rl.setPrompt(currentWorkId ? `superm #${currentWorkId}> ` : `superm> `);
  }

  updatePrompt();
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Slash commands — superm features
    if (input.startsWith("/")) {
      const result = await handleSlashCommand(input, store, repo, currentWorkId, rl);
      if (result.workId !== undefined) {
        currentWorkId = result.workId;
        updatePrompt();
      }
      return;
    }

    // Everything else goes to the agent as a conversation

    // Create a work record if no active work
    if (!currentWorkId) {
      const goal = input.length > 60 ? input.slice(0, 57) + "..." : input;
      currentWorkId = await store.createWork({
        goal,
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      updatePrompt();
      console.log(`  [work #${currentWorkId} created]\n`);
    }

    // Send to agent interactively
    await runAgent(backend, input, repo, rl);
  });

  rl.on("close", () => {
    console.log("\nBye!");
    process.exit(0);
  });
}

type SlashResult = { workId?: string | null };

async function handleSlashCommand(
  input: string,
  store: WorkStore,
  repo: string,
  currentWorkId: string | null,
  rl: ReturnType<typeof createInterface>,
): Promise<SlashResult> {
  const parts = input.slice(1).split(" ");
  const cmd = parts[0];
  const arg = parts[1];

  switch (cmd) {
    case "":
    case "help":
      console.log(`
  Available commands (Tab to autocomplete):
    /board              Show kanban board
    /list               List all works
    /use <id>           Switch to work #id (continue working on it)
    /close [id]         Close current or specified work
    /new "goal"         Create a new work record
    /status [id]        Show work status
    /cost [id]          Show token cost
    /info               Show environment
    /pipeline           List pipelines
    /clear              Start new conversation (detach from current work)
    /quit               Exit superm

  Everything else is sent directly to the agent.
`);
      break;
    case "quit":
    case "exit":
    case "q":
      console.log("Bye!");
      rl.close();
      process.exit(0);
      break;
    case "use": {
      if (!arg) {
        console.log("  Usage: /use <id>");
        break;
      }
      try {
        const spec = await store.readWork(arg);
        console.log(`  [switched to #${spec.id}: ${spec.goal}]\n`);
        rl.prompt();
        return { workId: arg };
      } catch {
        console.log(`  [work #${arg} not found]`);
      }
      break;
    }
    case "close": {
      const id = arg ?? currentWorkId;
      if (!id) {
        console.log("  No active work. Usage: /close <id>");
        break;
      }
      try {
        await store.updateStatus(id, "completed", "local-user", "Closed from REPL");
        console.log(`  [#${id} closed]`);
        if (id === currentWorkId) {
          rl.prompt();
          return { workId: null };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  [error: ${msg}]`);
      }
      break;
    }
    case "clear":
      console.log("  [Detached from current work. Start a new conversation.]\n");
      rl.prompt();
      return { workId: null };
    case "new": {
      const goal = parts.slice(1).join(" ").replace(/^["']|["']$/g, "");
      if (!goal) {
        console.log('  Usage: /new "goal description"');
        break;
      }
      const newId = await store.createWork({
        goal,
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
      console.log(`  [work #${newId} created: ${goal}]\n`);
      rl.prompt();
      return { workId: newId };
    }
    default:
      // Pass to superm CLI
      try {
        await runCli([...parts, "--repo", repo]);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  error: ${msg}`);
      }
      console.log("");
      break;
  }
  rl.prompt();
  return {};
}

async function runAgent(
  backend: string,
  prompt: string,
  cwd: string,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  let cmd: string;
  let args: string[];

  switch (backend) {
    case "claude":
      cmd = "claude";
      args = ["--print", "--no-session-persistence", "--dangerously-skip-permissions", prompt];
      break;
    case "codex":
      cmd = "codex";
      args = ["exec", "-C", cwd, "--ephemeral", "--dangerously-bypass-approvals-and-sandbox", prompt];
      break;
    case "gemini":
      cmd = "gemini";
      args = ["--prompt", prompt, "--sandbox", "false", "--yes"];
      break;
    default:
      cmd = backend;
      args = [prompt];
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(chunk);
    });

    child.on("error", (err) => {
      console.error(`  [agent error: ${err.message}]`);
      resolve();
      rl.prompt();
    });

    child.on("close", () => {
      console.log("");
      resolve();
      rl.prompt();
    });
  });
}
