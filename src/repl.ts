import { createInterface } from "node:readline";
import { runCli } from "./cli.js";

export async function startRepl(repo: string): Promise<void> {
  const { basename } = await import("node:path");
  const projectName = basename(repo);

  console.log(`  ⚡ Supermission — ${projectName}`);
  console.log(`  Dashboard: http://localhost:4000`);
  console.log(`  Type commands without "superm" prefix. Type "help" or "quit".\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `superm> `,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "quit" || input === "exit" || input === "q") {
      console.log("Bye!");
      rl.close();
      process.exit(0);
    }

    if (input === "help") {
      printHelp();
      rl.prompt();
      return;
    }

    // Parse the input as CLI args
    const argv = parseArgs(input);

    // Inject --repo so all commands target the right project
    argv.push("--repo", repo);

    try {
      await runCli(argv);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`error: ${msg}`);
    }

    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

function printHelp(): void {
  console.log(`
  Commands (type without "superm" prefix):

    new "goal"                    Create a work record
    quick "goal"                  One-shot: create → run → validate
    run <id>                      Run a work (interactive with agent)
    board                         Kanban view
    list                          List all works
    status <id>                   Show work status
    pipeline run feature "goal"   Multi-agent pipeline
    pipeline list                 List pipelines
    cost <id>                     Token/cost report
    info                          Show environment
    team list                     Show team members
    serve                         Start dashboard (if not running)

    quit / exit / q               Exit superm
`);
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const char of input) {
    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = "";
    } else if (!inQuotes && char === " ") {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) args.push(current);
  return args;
}
