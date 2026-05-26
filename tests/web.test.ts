import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { dashboardHtml, resolvePipelineSavePath } from "../src/web.js";

describe("dashboard web helpers", () => {
  it("resolves pipeline saves inside the project pipeline directory", () => {
    const repo = "/tmp/supermission-repo";

    expect(resolvePipelineSavePath(repo, "feature")).toBe(
      join(repo, ".supermission", "pipelines", "feature.yaml"),
    );
  });

  it("rejects pipeline names that would escape the pipeline directory", () => {
    const repo = "/tmp/supermission-repo";

    expect(() => resolvePipelineSavePath(repo, "../evil")).toThrow("invalid pipeline name");
    expect(() => resolvePipelineSavePath(repo, "nested/evil")).toThrow("invalid pipeline name");
    expect(() => resolvePipelineSavePath(repo, "/tmp/evil")).toThrow("invalid pipeline name");
  });

  it("rerenders the active dashboard view after changing language", () => {
    const html = dashboardHtml(4000);

    expect(html).toContain("async function refreshCurrentView()");
    expect(html).toContain("await refreshCurrentView();");
    expect(html).toContain("else if (currentView === 'env') { await loadEnvironment(); }");
  });
});
