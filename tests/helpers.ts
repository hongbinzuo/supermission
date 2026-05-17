import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const bunBin = process.env.BUN_BIN ?? resolveBunBin();

function resolveBunBin(): string {
  const homeBun = join(homedir(), ".bun", "bin", "bun");
  return existsSync(homeBun) ? homeBun : "bun";
}

export async function withTempRepo<T>(fn: (repo: string) => Promise<T>): Promise<T> {
  const repo = await mkdtemp(join(tmpdir(), "supermission-"));
  try {
    await execFileAsync("git", ["init"], { cwd: repo });
    return await fn(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

export async function runWork(repo: string, args: string[]) {
  return runProcess(bunBin, [join(process.cwd(), "src/cli.ts"), "--repo", repo, ...args], {
    cwd: process.cwd(),
  });
}

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd: options.cwd }, (error, stdout, stderr) => {
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : 0;
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin?.end();
  });
}
