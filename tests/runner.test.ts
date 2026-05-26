import { describe, expect, it } from "vitest";
import { DEFAULT_RUNNER_PRIORITY, RUNNER_REGISTRY, RunnerConfigSchema } from "../src/runner.js";

describe("runner defaults", () => {
  it("prioritizes default agent detection as codex, claude, kiro, kimi first", () => {
    expect(DEFAULT_RUNNER_PRIORITY.slice(0, 4)).toEqual(["codex", "claude", "kiro", "kimi"]);
  });

  it("declares kimi as a supported runner backend", () => {
    expect(RUNNER_REGISTRY.map((runner) => runner.backend)).toContain("kimi");
    expect(() =>
      RunnerConfigSchema.parse({
        default_backend: "kimi",
        fallback_order: ["codex", "claude", "kiro", "kimi"],
      }),
    ).not.toThrow();
  });
});
