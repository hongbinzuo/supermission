import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { WORK_ROOT } from "./paths.js";

const PID_FILE = "supermission.pid";
const CHILDREN_FILE = "children.pid";

/**
 * Process guard handles:
 * 1. Writing supermission's own PID so external tools can find it
 * 2. Tracking child process PIDs (agent CLIs)
 * 3. Cleaning up orphan children on startup
 * 4. Graceful shutdown of all children on exit
 */

export async function initProcessGuard(repo: string): Promise<ProcessGuard> {
  const guard = new ProcessGuard(repo);
  await guard.start();
  return guard;
}

export class ProcessGuard {
  private readonly repo: string;
  private readonly pidPath: string;
  private readonly childrenPath: string;
  private children: Set<number> = new Set();

  constructor(repo: string) {
    this.repo = repo;
    const root = join(repo, WORK_ROOT);
    this.pidPath = join(root, PID_FILE);
    this.childrenPath = join(root, CHILDREN_FILE);
  }

  async start(): Promise<void> {
    await mkdir(join(this.repo, WORK_ROOT), { recursive: true });

    // Check for orphans from previous crash
    await this.cleanupOrphans();

    // Write our PID
    await writeFile(this.pidPath, String(process.pid), "utf8");

    // Register shutdown handlers
    process.on("exit", () => this.shutdownSync());
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
    process.on("uncaughtException", (err) => {
      console.error(`supermission: uncaught exception: ${err.message}`);
      this.shutdown();
    });
  }

  /** Register a child process PID for tracking */
  async registerChild(pid: number): Promise<void> {
    this.children.add(pid);
    await this.writeChildren();
  }

  /** Unregister a child that exited normally */
  async unregisterChild(pid: number): Promise<void> {
    this.children.delete(pid);
    await this.writeChildren();
  }

  /** Kill all tracked children and clean up */
  private async shutdown(): Promise<void> {
    this.killAllChildren();
    await this.cleanup();
    process.exit(0);
  }

  /** Synchronous version for process 'exit' event */
  private shutdownSync(): void {
    this.killAllChildren();
    // Can't do async file ops in 'exit' handler, but children are already killed
  }

  /** Kill all tracked child processes */
  private killAllChildren(): void {
    for (const pid of this.children) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited — ignore
      }
    }
    this.children.clear();
  }

  /** Check for orphan processes from a previous crash */
  private async cleanupOrphans(): Promise<void> {
    try {
      const content = await readFile(this.childrenPath, "utf8");
      const pids = content
        .trim()
        .split("\n")
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0);

      let orphansKilled = 0;
      for (const pid of pids) {
        if (isProcessRunning(pid)) {
          try {
            process.kill(pid, "SIGTERM");
            orphansKilled++;
          } catch {
            // Can't kill — probably permission issue, ignore
          }
        }
      }

      if (orphansKilled > 0) {
        console.log(`supermission: cleaned up ${orphansKilled} orphan process(es) from previous session`);
      }
    } catch {
      // No children file — nothing to clean up
    }

    // Also check if previous supermission PID is still running (stale lock)
    try {
      const pidContent = await readFile(this.pidPath, "utf8");
      const oldPid = Number.parseInt(pidContent.trim(), 10);
      if (Number.isFinite(oldPid) && oldPid !== process.pid && isProcessRunning(oldPid)) {
        console.log(`supermission: another instance (PID ${oldPid}) may still be running`);
      }
    } catch {
      // No PID file — fresh start
    }
  }

  /** Write current children PIDs to file */
  private async writeChildren(): Promise<void> {
    if (this.children.size === 0) {
      try { await unlink(this.childrenPath); } catch { /* ignore */ }
      return;
    }
    await writeFile(this.childrenPath, [...this.children].join("\n") + "\n", "utf8");
  }

  /** Remove PID files on clean exit */
  private async cleanup(): Promise<void> {
    try { await unlink(this.pidPath); } catch { /* ignore */ }
    try { await unlink(this.childrenPath); } catch { /* ignore */ }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if process exists
    return true;
  } catch {
    return false;
  }
}
