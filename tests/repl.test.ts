import { describe, expect, it } from "vitest";
import { buildAgentPrompt, formatHelpText, suggestSlashCommands } from "../src/repl.js";

describe("superm REPL", () => {
  it("shows command help in English by default", () => {
    const help = formatHelpText();

    expect(help).toContain("/board              Board view");
    expect(help).toContain('/new "goal"         Create a new work item');
    expect(help).toContain("Type normal text -> enter an Agent interactive session");
    expect(help).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("adds a same-language guard to spawned agent prompts", () => {
    const prompt = buildAgentPrompt({
      input: "这个 CLI 为什么变成中文了？",
      work: {
        id: "work-1",
        goal: "Investigate CLI language",
        acceptance: [],
        status: "draft",
      },
    });

    expect(prompt).toContain(
      "Reply in the same language as the user's request unless the user explicitly asks for another language.",
    );
    expect(prompt).toContain("When the language is ambiguous, default to English.");
    expect(prompt).toContain("这个 CLI 为什么变成中文了？");
  });

  it("suggests matching slash commands for a typed prefix", () => {
    expect(suggestSlashCommands("/u")).toEqual(["/use"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
  });
});
