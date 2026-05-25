import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import YAML from "yaml";
import { collaborationPaths } from "./paths.js";
import { TeamRegistrySchema, type Identity, type TeamRegistry } from "./collaboration-types.js";

export type ResolveOptions = {
  as?: string;
  repo?: string;
};

const SOLO_IDENTITY: Identity = {
  id: "local-user",
  name: "local-user",
  kind: "human",
  role: "owner",
  notify: ["inbox"],
};

/**
 * Resolve the current user's identity.
 *
 * Priority:
 * 1. --as flag (explicit identity id)
 * 2. SUPERMISSION_IDENTITY env var
 * 3. Match git user.name against team.yaml
 * 4. "local-user" fallback (solo mode)
 */
export async function resolveIdentity(options: ResolveOptions = {}): Promise<Identity> {
  const repo = options.repo ?? process.cwd();
  const registry = await readTeamRegistry(repo);

  // No team.yaml → solo mode
  if (!registry) {
    return SOLO_IDENTITY;
  }

  // 1. Explicit --as flag
  if (options.as) {
    const found = registry.identities.find((i) => i.id === options.as);
    if (!found) {
      throw new Error(`unknown identity: ${options.as}. Run \`supermission team list\``);
    }
    return found;
  }

  // 2. SUPERMISSION_IDENTITY env var
  const envIdentity = process.env.SUPERMISSION_IDENTITY;
  if (envIdentity) {
    const found = registry.identities.find((i) => i.id === envIdentity);
    if (!found) {
      throw new Error(
        `unknown identity from SUPERMISSION_IDENTITY: ${envIdentity}. Run \`supermission team list\``,
      );
    }
    return found;
  }

  // 3. Match git user.name
  const gitName = await getGitUserName(repo);
  if (gitName) {
    const found = registry.identities.find(
      (i) => i.id === gitName || i.name.toLowerCase() === gitName.toLowerCase(),
    );
    if (found) return found;
  }

  // 4. Fallback — if registry exists but no match, return solo identity with warning
  return SOLO_IDENTITY;
}

export async function readTeamRegistry(repo: string): Promise<TeamRegistry | null> {
  const paths = collaborationPaths(repo);
  try {
    const text = await readFile(paths.team, "utf8");
    return TeamRegistrySchema.parse(YAML.parse(text));
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

export function isSoloMode(registry: TeamRegistry | null): boolean {
  return registry === null;
}

async function getGitUserName(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["config", "user.name"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      resolve(code === 0 && stdout.trim().length > 0 ? stdout.trim() : null);
    });
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: string }).code === code;
}
