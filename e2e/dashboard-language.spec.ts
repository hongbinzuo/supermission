import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { dashboardHtml } from "../src/web.js";

test("language menu rerenders the active right pane", async ({ page }) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/api/environment") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          clis: [{ name: "codex", version: "", installed: false }],
          plugins: { codex: [], claude: [] },
          config: { default_backend: "auto", fallback_order: ["codex"], routing: {} },
        }),
      );
      return;
    }

    if (url.pathname === "/api/works") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml(0).replace("const API = 'http://localhost:0';", "const API = '';"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");

  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.click("#nav-env");
    await expect(page.locator("#content")).toContainText("配置");

    await page.click("#btn-en");

    await expect(page.locator("#mainTitle")).toHaveText("Environment");
    await expect(page.locator("#content")).toContainText("Config");
    await expect(page.locator("#content")).toContainText("Default backend");
    await expect(page.locator("#content")).not.toContainText("配置");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
