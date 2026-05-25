import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import YAML from "yaml";
import { collaborationPaths } from "./paths.js";
import {
  IdentityKindSchema,
  IdentityRoleSchema,
  TeamRegistrySchema,
  type Identity,
  type IdentityKind,
  type IdentityRole,
  type TeamRegistry,
} from "./collaboration-types.js";

export type AddIdentityInput = {
  id: string;
  name: string;
  kind: IdentityKind;
  role: IdentityRole;
  email?: string;
  backend?: string;
  profile?: string;
};

export async function initTeamRegistry(repo: string): Promise<TeamRegistry> {
  const paths = collaborationPaths(repo);
  const registry: TeamRegistry = {
    version: 1,
    identities: [],
  };
  await mkdir(dirname(paths.team), { recursive: true });
  await writeFile(paths.team, YAML.stringify(registry), "utf8");
  return registry;
}

export async function addIdentity(repo: string, input: AddIdentityInput): Promise<Identity> {
  // Validate inputs
  IdentityKindSchema.parse(input.kind);
  IdentityRoleSchema.parse(input.role);

  if (input.kind === "agent" && !input.backend) {
    throw new Error("agent identity requires --backend");
  }

  const registry = await readRegistry(repo);

  // Check for duplicate id
  if (registry.identities.some((i) => i.id === input.id)) {
    throw new Error(`identity already exists: ${input.id}`);
  }

  // Check for duplicate name
  if (registry.identities.some((i) => i.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error(`identity name already taken: ${input.name}`);
  }

  const identity: Identity = {
    id: input.id,
    name: input.name,
    kind: input.kind,
    role: input.role,
    ...(input.email ? { email: input.email } : {}),
    ...(input.backend ? { backend: input.backend } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    notify: ["inbox"],
  };

  registry.identities.push(identity);
  await writeRegistry(repo, registry);
  return identity;
}

export async function removeIdentity(repo: string, id: string): Promise<void> {
  const registry = await readRegistry(repo);
  const index = registry.identities.findIndex((i) => i.id === id);
  if (index === -1) {
    throw new Error(`unknown identity: ${id}`);
  }
  registry.identities.splice(index, 1);
  await writeRegistry(repo, registry);
}

export async function listIdentities(repo: string): Promise<Identity[]> {
  const registry = await readRegistry(repo);
  return registry.identities;
}

async function readRegistry(repo: string): Promise<TeamRegistry> {
  const paths = collaborationPaths(repo);
  try {
    const text = await readFile(paths.team, "utf8");
    return TeamRegistrySchema.parse(YAML.parse(text));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      throw new Error("team not initialized. Run `supermission team init` first.");
    }
    throw error;
  }
}

async function writeRegistry(repo: string, registry: TeamRegistry): Promise<void> {
  const paths = collaborationPaths(repo);
  await writeFile(paths.team, YAML.stringify(registry), "utf8");
}
