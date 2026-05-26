import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const taskResolutionPhrases = [
  "TASKS.md",
  ".supermission/<id>",
  "continue 3",
  "continue x",
  "work.yaml",
  "plan.md",
  "monitor.md",
  "tasks/*.yaml",
];

describe("agent instruction contracts", () => {
  it("documents shorthand task resolution for common agent CLIs", async () => {
    for (const path of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
      const text = await readFile(path, "utf8");
      for (const phrase of taskResolutionPhrases) {
        expect(text, `${path} should mention ${phrase}`).toContain(phrase);
      }
    }
  });

  it("keeps a repo-root task index for short task handles", async () => {
    const text = await readFile("TASKS.md", "utf8");

    expect(text).toContain("Short Task Handles");
    expect(text).toContain("| Handle");
    expect(text).toContain("Work record");
    expect(text).toContain("`.supermission/3`");
    expect(text).toContain("When the user says `continue 3`");
  });
});
