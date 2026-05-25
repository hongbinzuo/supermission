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
    prompt: `> `,
  });

  const conversationHistory: string[] = [];
  let currentWorkId: string | null = null;

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Slash commands — superm features
    if (input.startsWith("/")) {
      await handleSlashCommand(input, store, repo, rl);
      return;
    }

    // Everything else goes to the agent as a conversation
    conversationHistory.push(input);

    // Create a work record if first message
    if (!currentWorkId) {
      const goal = input.length > 60 ? input.slice(0, 57) + "..." : input;
      currentWorkId = await store.createWork({
        goal,
        actor: "local-user",
        acceptance: [],
        validationCommands: [],
      });
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

async function handleSlashCommand(
  input: string,
  store: WorkStore,
  repo: string,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  const parts = input.slice(1).split(" ");
  const cmd = parts[0];

  switch (cmd) {
    case "help":
      console.log(`
  Slash commands:
    /board          Show kanban board
    /list           List all works
    /status <id>    Show work status
    /new "goal"     Create a new work record
    /cost <id>      Show token cost
    /info           Show environment
    /pipeline       List pipelines
    /quit           Exit superm
    /clear          Start new conversation

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
    case "clear":
      console.log("  [New conversation started]\n");
      break;
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
}

async function runAgent(
  backend: string,
  prompt: string,
  cwd: string,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  // Determine command based on backend
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
