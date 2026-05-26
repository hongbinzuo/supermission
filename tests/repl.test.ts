import { describe, expect, it, vi } from "vitest";
import {
  buildAgentPrompt,
  buildStandardTerminalLayoutCommands,
  closeWorks,
  formatHelpText,
  handleSlash,
  parseCloseIds,
  shouldAutoCreateTerminalLayout,
  suggestSlashCommands,
} from "../src/repl.js";
import type { WorkStore } from "../src/store.js";

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

  it("builds the standard tmux terminal layout for a new work item", () => {
    const commands = buildStandardTerminalLayoutCommands({
      repo: "/repo",
      workId: "3",
      supermissionBin: "supermission",
    });

    expect(commands).toEqual([
      [
        "split-window",
        "-h",
        "-c",
        "/repo",
        "-l",
        "40%",
        "printf '\\033]2;superm #3 right\\033\\\\'; supermission status 3; exec \"$SHELL\"",
      ],
      ["select-pane", "-L"],
      [
        "split-window",
        "-v",
        "-c",
        "/repo",
        "-l",
        "30%",
        "printf '\\033]2;superm #3 bottom\\033\\\\'; supermission monitor 3; exec \"$SHELL\"",
      ],
      ["select-pane", "-U"],
      ["select-pane", "-R"],
      [
        "split-window",
        "-v",
        "-c",
        "/repo",
        "-l",
        "30%",
        "printf '\\033]2;superm #3 bottom-right\\033\\\\'; supermission trace 3; exec \"$SHELL\"",
      ],
      ["select-pane", "-L"],
      ["select-pane", "-U"],
    ]);
  });

  it("only auto-creates the terminal layout inside tmux unless explicitly disabled", () => {
    expect(shouldAutoCreateTerminalLayout({ TMUX: "/tmp/tmux" })).toBe(true);
    expect(shouldAutoCreateTerminalLayout({})).toBe(false);
    expect(
      shouldAutoCreateTerminalLayout({ TMUX: "/tmp/tmux", SUPERMISSION_TERMINAL_LAYOUT: "0" }),
    ).toBe(false);
  });

  it("parses one or more ids for /close, falling back to the current work", () => {
    expect(parseCloseIds("", "current")).toEqual(["current"]);
    expect(parseCloseIds("", null)).toEqual([]);
    expect(parseCloseIds("1", null)).toEqual(["1"]);
    expect(parseCloseIds("1 2 3", null)).toEqual(["1", "2", "3"]);
    expect(parseCloseIds("  1   2  ", "current")).toEqual(["1", "2"]);
    expect(parseCloseIds("1 1 2", null)).toEqual(["1", "2"]);
  });

  it("closes multiple work ids, surfacing per-id outcomes", async () => {
    const calls: Array<[string, string, string, string | undefined]> = [];
    const fakeStore = {
      async updateStatus(workId: string, status: string, actor: string, reason?: string) {
        calls.push([workId, status, actor, reason]);
        if (workId === "missing") throw new Error("work not found: missing");
      },
    } as unknown as Pick<WorkStore, "updateStatus">;

    const result = await closeWorks(fakeStore, ["1", "missing", "2"], "Closed from REPL", "1");

    expect(calls).toEqual([
      ["1", "completed", "local-user", "Closed from REPL"],
      ["missing", "completed", "local-user", "Closed from REPL"],
      ["2", "completed", "local-user", "Closed from REPL"],
    ]);
    expect(result.lines).toEqual([
      "  [#1 closed]",
      "  [#missing error: work not found: missing]",
      "  [#2 closed]",
      "  [closed 2/3 work item(s)]",
    ]);
    expect(result.closedCurrent).toBe(true);
  });

  it("does not append a summary line when closing a single work item", async () => {
    const fakeStore = {
      async updateStatus() {},
    } as unknown as Pick<WorkStore, "updateStatus">;

    const result = await closeWorks(fakeStore, ["7"], "Closed from REPL", null);

    expect(result.lines).toEqual(["  [#7 closed]"]);
    expect(result.closedCurrent).toBe(false);
  });

  it("clears the current work when /close includes the active id", async () => {
    const fakeStore = {
      async updateStatus() {},
    } as unknown as WorkStore;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await handleSlash("/close 8 9", fakeStore, "/repo", "8");

      expect(result).toEqual({ newWorkId: null });
    } finally {
      log.mockRestore();
    }
  });
});
