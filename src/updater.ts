import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const INSTALL_DIR = process.env.SUPERMISSION_INSTALL_DIR ?? join(homedir(), ".supermission-cli");
const STATE_FILE = join(homedir(), ".supermission-cli", ".update-state.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Check once per day

type UpdateState = {
  lastCheck: number;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
};

export async function checkForUpdates(silent = true): Promise<void> {
  const state = await readState();
  const now = Date.now();

  // Skip if checked recently
  if (silent && state.lastCheck && now - state.lastCheck < CHECK_INTERVAL_MS) {
    if (state.updateAvailable) {
      console.log(`\n  Update available: ${state.currentVersion} → ${state.latestVersion}`);
      console.log(`  Run: supermission update\n`);
    }
    return;
  }

  try {
    // Check latest version from git
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", "--tags", "--sort=-v:refname", "https://github.com/hongbinzuo/supermission.git"],
      { timeout: 5000 },
    );

    const tags = stdout
      .trim()
      .split("\n")
      .map((line) => line.replace(/.*refs\/tags\//, "").replace(/\^{}$/, ""))
      .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));

    const latest = tags[0] ?? state.currentVersion;
    const current = state.currentVersion;
    const updateAvailable = latest !== current && latest > current;

    await writeState({ lastCheck: now, currentVersion: current, latestVersion: latest, updateAvailable });

    if (updateAvailable && !silent) {
      console.log(`\n  Update available: ${current} → ${latest}`);
      console.log(`  Run: supermission update\n`);
    } else if (updateAvailable && silent) {
      console.log(`\n  Update available: ${current} → ${latest}. Run: supermission update\n`);
    }
  } catch {
    // Network error — skip silently
  }
}

export async function performUpdate(): Promise<void> {
  console.log("Updating supermission...\n");

  try {
    // Pull latest (reset to origin if diverged)
    console.log("  Pulling latest...");
    try {
      await execFileAsync("git", ["fetch", "origin"], { cwd: INSTALL_DIR, timeout: 15000 });
      await execFileAsync("git", ["reset", "--hard", "origin/main"], { cwd: INSTALL_DIR, timeout: 5000 });
    } catch {
      // If fetch fails, try simple pull
      await execFileAsync("git", ["pull", "--ff-only"], { cwd: INSTALL_DIR, timeout: 30000 });
    }

    // Install deps
    console.log("  Installing dependencies...");
    const hasBun = await commandExists("bun");
    if (hasBun) {
      await execFileAsync("bun", ["install"], { cwd: INSTALL_DIR, timeout: 60000 });
    } else {
      await execFileAsync("npm", ["install"], { cwd: INSTALL_DIR, timeout: 60000 });
    }

    // Build
    console.log("  Building...");
    if (hasBun) {
      await execFileAsync("bun", ["run", "build"], { cwd: INSTALL_DIR, timeout: 30000 });
    } else {
      await execFileAsync("npx", ["tsup", "src/cli.ts", "--format", "esm", "--dts", "--clean", "--out-dir", "dist"], { cwd: INSTALL_DIR, timeout: 30000 });
    }

    // Read new version
    const pkg = JSON.parse(await readFile(join(INSTALL_DIR, "package.json"), "utf8"));
    const newVersion = `v${pkg.version}`;

    await writeState({ lastCheck: Date.now(), currentVersion: newVersion, updateAvailable: false });

    console.log(`\n  ✓ Updated to ${newVersion}\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ Update failed: ${msg}`);
    console.error(`  Try manually: cd ${INSTALL_DIR} && git pull && bun run build`);
    process.exitCode = 1;
  }
}

async function readState(): Promise<UpdateState> {
  try {
    const text = await readFile(STATE_FILE, "utf8");
    return JSON.parse(text) as UpdateState;
  } catch {
    // Read current version from package.json
    let currentVersion = "v0.6.0";
    try {
      const pkg = JSON.parse(await readFile(join(INSTALL_DIR, "package.json"), "utf8"));
      currentVersion = `v${pkg.version}`;
    } catch { /* use default */ }
    return { lastCheck: 0, currentVersion };
  }
}

async function writeState(state: UpdateState): Promise<void> {
  try {
    await mkdir(join(homedir(), ".supermission-cli"), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state), "utf8");
  } catch { /* ignore */ }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
