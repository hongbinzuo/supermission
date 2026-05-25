import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import YAML from "yaml";
import { utcNow } from "./time.js";

// --- Project Schemas ---

export const MilestoneStatusSchema = z.enum(["active", "completed", "cancelled"]);

export const MilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  target_date: z.string().optional(),
  status: MilestoneStatusSchema.default("active"),
  created_at: z.string().min(1),
});

export type Milestone = z.infer<typeof MilestoneSchema>;

export const CycleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  work_ids: z.array(z.string().min(1)).default([]),
});

export type Cycle = z.infer<typeof CycleSchema>;

export const IntegrationProviderSchema = z.enum(["linear", "github", "jira"]);

export const IntegrationSchema = z.object({
  provider: IntegrationProviderSchema,
  api_key: z.string().min(1).optional(),
  url: z.string().optional(),
  team: z.string().optional(),
  project: z.string().optional(),
  repo: z.string().optional(),
  status_mapping: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

export type Integration = z.infer<typeof IntegrationSchema>;

export const ProjectConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  name: z.string().min(1),
  description: z.string().default(""),
  labels: z.array(z.string().min(1)).default(["bug", "feature", "chore", "security", "performance"]),
  milestones: z.array(MilestoneSchema).default([]),
  cycles: z.array(CycleSchema).default([]),
  integrations: z.array(IntegrationSchema).default([]),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// --- Project Path ---

export function projectPath(repo: string): string {
  return `${repo}/.supermission/project.yaml`;
}

// --- Project Operations ---

export async function initProject(repo: string, name: string, description?: string): Promise<ProjectConfig> {
  const config: ProjectConfig = {
    version: 1,
    name,
    description: description ?? "",
    labels: ["bug", "feature", "chore", "security", "performance"],
    milestones: [],
    cycles: [],
    integrations: [],
  };
  const path = projectPath(repo);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, YAML.stringify(config), "utf8");
  return config;
}

export async function readProject(repo: string): Promise<ProjectConfig | null> {
  try {
    const text = await readFile(projectPath(repo), "utf8");
    return ProjectConfigSchema.parse(YAML.parse(text));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeProject(repo: string, config: ProjectConfig): Promise<void> {
  await writeFile(projectPath(repo), YAML.stringify(config), "utf8");
}

export async function addMilestone(
  repo: string,
  input: { title: string; description?: string; targetDate?: string },
): Promise<Milestone> {
  const config = await requireProject(repo);
  const id = `milestone-${String(config.milestones.length + 1).padStart(3, "0")}`;
  const milestone: Milestone = {
    id,
    title: input.title,
    description: input.description ?? "",
    target_date: input.targetDate,
    status: "active",
    created_at: utcNow(),
  };
  config.milestones.push(milestone);
  await writeProject(repo, config);
  return milestone;
}

export async function listMilestones(repo: string): Promise<Milestone[]> {
  const config = await requireProject(repo);
  return config.milestones;
}

export async function closeMilestone(repo: string, milestoneId: string): Promise<Milestone> {
  const config = await requireProject(repo);
  const milestone = config.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`unknown milestone: ${milestoneId}`);
  milestone.status = "completed";
  await writeProject(repo, config);
  return milestone;
}

export async function createCycle(
  repo: string,
  input: { title: string; startDate: string; endDate: string },
): Promise<Cycle> {
  const config = await requireProject(repo);
  const id = `cycle-${String(config.cycles.length + 1).padStart(3, "0")}`;
  const cycle: Cycle = {
    id,
    title: input.title,
    start_date: input.startDate,
    end_date: input.endDate,
    work_ids: [],
  };
  config.cycles.push(cycle);
  await writeProject(repo, config);
  return cycle;
}

export async function addWorkToCycle(repo: string, cycleId: string, workId: string): Promise<void> {
  const config = await requireProject(repo);
  const cycle = config.cycles.find((c) => c.id === cycleId);
  if (!cycle) throw new Error(`unknown cycle: ${cycleId}`);
  if (!cycle.work_ids.includes(workId)) {
    cycle.work_ids.push(workId);
    await writeProject(repo, config);
  }
}

export async function addIntegration(repo: string, integration: Integration): Promise<void> {
  const config = await requireProject(repo);
  const existing = config.integrations.findIndex((i) => i.provider === integration.provider);
  if (existing >= 0) {
    config.integrations[existing] = integration;
  } else {
    config.integrations.push(integration);
  }
  await writeProject(repo, config);
}

async function requireProject(repo: string): Promise<ProjectConfig> {
  const config = await readProject(repo);
  if (!config) {
    throw new Error("project not initialized. Run `supermission project init` first.");
  }
  return config;
}

// --- Import/Export ---

export type ImportRecord = {
  goal: string;
  acceptance?: string[];
  priority?: string;
  milestone?: string;
  labels?: string[];
  assignee?: string;
};

export function parseCSVImport(content: string): ImportRecord[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const goalIdx = headers.indexOf("goal");
  if (goalIdx === -1) throw new Error("CSV must have a 'goal' column");

  const priorityIdx = headers.indexOf("priority");
  const milestoneIdx = headers.indexOf("milestone");
  const labelsIdx = headers.indexOf("labels");
  const assigneeIdx = headers.indexOf("assignee");
  const acceptanceIdx = headers.indexOf("acceptance");

  return lines.slice(1).filter((line) => line.trim().length > 0).map((line) => {
    const cols = parseCSVLine(line);
    return {
      goal: cols[goalIdx] ?? "",
      acceptance: acceptanceIdx >= 0 && cols[acceptanceIdx] ? cols[acceptanceIdx].split(";").map((s) => s.trim()) : undefined,
      priority: priorityIdx >= 0 ? cols[priorityIdx] : undefined,
      milestone: milestoneIdx >= 0 ? cols[milestoneIdx] : undefined,
      labels: labelsIdx >= 0 && cols[labelsIdx] ? cols[labelsIdx].split(";").map((s) => s.trim()) : undefined,
      assignee: assigneeIdx >= 0 ? cols[assigneeIdx] : undefined,
    };
  }).filter((r) => r.goal.length > 0);
}

export function parseJSONImport(content: string): ImportRecord[] {
  const data = JSON.parse(content) as unknown;
  if (!Array.isArray(data)) throw new Error("JSON import must be an array");
  return (data as Record<string, unknown>[]).map((item) => ({
    goal: String(item.goal ?? item.title ?? item.summary ?? ""),
    acceptance: Array.isArray(item.acceptance) ? item.acceptance.map(String) : undefined,
    priority: item.priority ? String(item.priority) : undefined,
    milestone: item.milestone ? String(item.milestone) : undefined,
    labels: Array.isArray(item.labels) ? item.labels.map(String) : undefined,
    assignee: item.assignee ? String(item.assignee) : undefined,
  })).filter((r) => r.goal.length > 0);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function exportCSV(works: Array<{ id: string; goal: string; status: string; priority?: string; milestone?: string; assignee?: string; labels?: string[]; created_at: string; updated_at: string }>): string {
  const headers = "id,goal,status,priority,milestone,assignee,labels,created_at,updated_at";
  const rows = works.map((w) =>
    [w.id, csvEscape(w.goal), w.status, w.priority ?? "medium", w.milestone ?? "", w.assignee ?? "", (w.labels ?? []).join(";"), w.created_at, w.updated_at].join(",")
  );
  return [headers, ...rows].join("\n") + "\n";
}

export function exportMarkdown(works: Array<{ id: string; goal: string; status: string; priority?: string; milestone?: string; assignee?: string }>, projectName: string): string {
  const lines = [`# ${projectName} — Progress Report`, "", `Generated: ${utcNow()}`, ""];

  // Group by milestone
  const byMilestone: Record<string, typeof works> = { "(no milestone)": [] };
  for (const w of works) {
    const key = w.milestone ?? "(no milestone)";
    if (!byMilestone[key]) byMilestone[key] = [];
    byMilestone[key].push(w);
  }

  for (const [milestone, items] of Object.entries(byMilestone)) {
    if (items.length === 0) continue;
    lines.push(`## ${milestone}`, "");
    const completed = items.filter((w) => w.status === "completed").length;
    lines.push(`Progress: ${completed}/${items.length} (${Math.round((completed / items.length) * 100)}%)`, "");
    lines.push("| Status | Priority | Goal | Assignee |", "|--------|----------|------|----------|");
    for (const w of items) {
      lines.push(`| ${w.status} | ${w.priority ?? "medium"} | ${w.goal} | ${w.assignee ?? "—"} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
