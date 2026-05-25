import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runWork, withTempRepo } from "./helpers.js";

describe("Team collaboration", () => {
  it("initializes team.yaml", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["team", "init"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("team.yaml initialized");

      const teamYaml = await readFile(join(repo, ".supermission", "team.yaml"), "utf8");
      const team = YAML.parse(teamYaml);
      expect(team.version).toBe(1);
      expect(team.identities).toEqual([]);
    });
  });

  it("adds human team members", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      const result = await runWork(repo, [
        "team",
        "add",
        "--name",
        "Alice",
        "--role",
        "lead",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alice human lead - Alice");

      const teamYaml = await readFile(join(repo, ".supermission", "team.yaml"), "utf8");
      const team = YAML.parse(teamYaml);
      expect(team.identities).toHaveLength(1);
      expect(team.identities[0].id).toBe("alice");
      expect(team.identities[0].role).toBe("lead");
    });
  });

  it("adds agent team members with backend", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      const result = await runWork(repo, [
        "team",
        "add",
        "--name",
        "Claude Worker",
        "--kind",
        "agent",
        "--role",
        "agent",
        "--backend",
        "claude",
        "--profile",
        "default",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("claude-worker agent agent");
    });
  });

  it("rejects duplicate identity names", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Alice", "--role", "lead"]);
      const result = await runWork(repo, ["team", "add", "--name", "Alice", "--role", "developer"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already");
    });
  });

  it("rejects agent without backend", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      const result = await runWork(repo, [
        "team",
        "add",
        "--name",
        "Bad Agent",
        "--kind",
        "agent",
        "--role",
        "agent",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("backend");
    });
  });

  it("removes team members", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Alice", "--role", "lead"]);
      await runWork(repo, ["team", "add", "--name", "Bob", "--role", "developer"]);

      const result = await runWork(repo, ["team", "remove", "alice"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("removed alice");

      const list = await runWork(repo, ["team", "list"]);
      expect(list.stdout).not.toContain("Alice");
      expect(list.stdout).toContain("Bob");
    });
  });

  it("lists team members", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Alice", "--role", "lead"]);
      await runWork(repo, ["team", "add", "--name", "Bob", "--role", "developer"]);

      const result = await runWork(repo, ["team", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("alice human lead");
      expect(result.stdout).toContain("bob human developer");
    });
  });

  it("fails gracefully without team init", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["team", "add", "--name", "Alice", "--role", "lead"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("team not initialized");
    });
  });
});

describe("Work assignment", () => {
  it("assigns work on creation with --assign", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Bob", "--role", "developer"]);

      const result = await runWork(repo, [
        "new",
        "Fix login bug",
        "--id",
        "assign-test",
        "--assign",
        "bob",
      ]);
      expect(result.exitCode).toBe(0);

      const workYaml = await readFile(
        join(repo, ".supermission", "assign-test", "work.yaml"),
        "utf8",
      );
      const work = YAML.parse(workYaml);
      expect(work.assignee).toBe("bob");
    });
  });

  it("reassigns work with supermission assign", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Alice", "--role", "lead"]);
      await runWork(repo, ["team", "add", "--name", "Bob", "--role", "developer"]);
      await runWork(repo, ["new", "Task", "--id", "reassign-test", "--assign", "bob"]);

      const result = await runWork(repo, ["assign", "reassign-test", "--to", "alice"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("reassign-test");
      expect(result.stdout).toContain("alice");

      const workYaml = await readFile(
        join(repo, ".supermission", "reassign-test", "work.yaml"),
        "utf8",
      );
      const work = YAML.parse(workYaml);
      expect(work.assignee).toBe("alice");
    });
  });

  it("releases assignment", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["team", "add", "--name", "Bob", "--role", "developer"]);
      await runWork(repo, ["new", "Task", "--id", "release-test", "--assign", "bob"]);

      const result = await runWork(repo, ["release", "release-test"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("released");
      expect(result.stdout).toContain("bob");

      const workYaml = await readFile(
        join(repo, ".supermission", "release-test", "work.yaml"),
        "utf8",
      );
      const work = YAML.parse(workYaml);
      expect(work.assignee).toBeUndefined();
    });
  });

  it("rejects assignment to unknown identity", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["team", "init"]);
      await runWork(repo, ["new", "Task", "--id", "bad-assign"]);

      const result = await runWork(repo, ["assign", "bad-assign", "--to", "nobody"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown identity");
    });
  });
});

describe("Board command", () => {
  it("shows kanban board with work records", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Task A", "--id", "board-a"]);
      await runWork(repo, ["new", "Task B", "--id", "board-b"]);

      const result = await runWork(repo, ["board"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DRAFT");
      expect(result.stdout).toContain("Task A");
      expect(result.stdout).toContain("Task B");
      expect(result.stdout).toContain("2 work(s) total");
    });
  });

  it("shows empty board message", async () => {
    await withTempRepo(async (repo) => {
      const result = await runWork(repo, ["board"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No works found");
    });
  });

  it("supports --json output", async () => {
    await withTempRepo(async (repo) => {
      await runWork(repo, ["new", "Task A", "--id", "json-board"]);
      const result = await runWork(repo, ["board", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("json-board");
      expect(data[0].status).toBe("draft");
    });
  });
});
