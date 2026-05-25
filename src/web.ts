import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { WorkStore } from "./store.js";
import type { WorkSpec } from "./types.js";
import { readTeamRegistry } from "./identity.js";

export type ServeOptions = {
  port: number;
  repo: string;
  open?: boolean;
};

export async function startServer(options: ServeOptions): Promise<void> {
  const store = new WorkStore(options.repo);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

    try {
      if (url.pathname === "/api/works") {
        const works = await getWorks(store);
        json(res, works);
      } else if (url.pathname === "/api/team") {
        const registry = await readTeamRegistry(store.repo);
        json(res, registry ?? { identities: [] });
      } else if (url.pathname.startsWith("/api/work/")) {
        const workId = decodeURIComponent(url.pathname.slice("/api/work/".length));
        const detail = await getWorkDetail(store, workId);
        json(res, detail);
      } else if (url.pathname === "/api/config") {
        const config = await store.readRunnerConfig();
        json(res, config);
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml(options.port));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`\n  ⚡ Supermission Dashboard`);
    console.log(`  http://localhost:${options.port}\n`);
    console.log(`  Press Ctrl+C to stop.\n`);
    if (options.open) {
      exec(`open http://localhost:${options.port}`);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

async function getWorks(store: WorkStore): Promise<WorkSpec[]> {
  const ids = await store.listWorkIds();
  const works: WorkSpec[] = [];
  for (const id of ids) {
    works.push(await store.readWork(id));
  }
  return works;
}

async function getWorkDetail(store: WorkStore, workId: string) {
  const spec = await store.readWork(workId);
  const tasks = await store.listTasks(workId);
  const events = await store.readEvents(workId);
  const changes = await store.listChanges(workId);
  const paths = store.paths(workId);

  // Read artifacts
  let runLog = "";
  let validationLog = "";
  let plan = "";
  try { runLog = await readFile(paths.runLog, "utf8"); } catch { /* empty */ }
  try { validationLog = await readFile(paths.validationLog, "utf8"); } catch { /* empty */ }
  try { plan = await readFile(paths.plan, "utf8"); } catch { /* empty */ }

  return { spec, tasks, events, changes, runLog, validationLog, plan };
}

function dashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supermission Dashboard</title>
<style>
:root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; --accent: #58a6ff; --green: #3fb950; --orange: #ffa657; --red: #f85149; --purple: #d2a8ff; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 280px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
.sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
.sidebar-header h1 { font-size: 1rem; color: var(--accent); }
.sidebar-header .subtitle { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
.work-list { flex: 1; overflow-y: auto; }
.work-item { padding: 10px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
.work-item:hover { background: var(--bg); }
.work-item.active { background: var(--bg); border-left: 3px solid var(--accent); }
.work-item .id { font-size: 0.75rem; color: var(--muted); }
.work-item .goal { font-size: 0.85rem; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work-item .meta { font-size: 0.7rem; color: var(--muted); margin-top: 4px; display: flex; gap: 8px; }
.status-badge { font-size: 0.65rem; padding: 1px 6px; border-radius: 8px; font-weight: 500; }
.status-draft { background: #21262d; color: var(--muted); }
.status-planned { background: #2d1f4e; color: var(--purple); }
.status-approved { background: #0c2d6b; color: var(--accent); }
.status-running { background: #3d2200; color: var(--orange); }
.status-validated { background: #0f3d1a; color: var(--green); }
.status-completed { background: #0f3d1a; color: var(--green); }
.status-failed { background: #3d0f0f; color: var(--red); }
.status-needs_review { background: #3d2200; color: var(--orange); }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.main-header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.main-header h2 { font-size: 1.1rem; }
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
.tab { padding: 8px 16px; font-size: 0.8rem; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.content { flex: 1; overflow-y: auto; padding: 20px 24px; }
.detail-grid { display: grid; grid-template-columns: 100px 1fr; gap: 6px 16px; font-size: 0.85rem; margin-bottom: 20px; }
.detail-label { color: var(--muted); }
.log-box { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-family: 'SF Mono', Monaco, monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; line-height: 1.5; }
.event-line { padding: 3px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; font-size: 0.8rem; }
.event-time { color: var(--muted); min-width: 80px; font-family: monospace; font-size: 0.75rem; }
.event-type { color: var(--accent); min-width: 140px; }
.event-actor { color: var(--muted); }
.empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
.empty-state h3 { margin-bottom: 8px; color: var(--text); }
.empty-state code { background: var(--surface); padding: 2px 6px; border-radius: 3px; font-size: 0.85rem; }
.refresh-indicator { font-size: 0.7rem; color: var(--muted); }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">
    <h1>⚡ Supermission</h1>
    <div class="subtitle">Local-first AI work records</div>
  </div>
  <div class="work-list" id="workList"></div>
</div>
<div class="main">
  <div class="main-header">
    <h2 id="mainTitle">Dashboard</h2>
    <span class="refresh-indicator" id="refreshIndicator">auto-refresh: 3s</span>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="content" id="content"></div>
</div>

<script>
const API = 'http://localhost:${port}';
let selectedWork = null;
let currentTab = 'overview';

async function loadWorks() {
  const works = await fetch(API + '/api/works').then(r => r.json());
  renderWorkList(works);
  if (!selectedWork && works.length > 0) selectWork(works[0].id);
  else if (selectedWork) refreshDetail();
}

function renderWorkList(works) {
  const el = document.getElementById('workList');
  if (works.length === 0) {
    el.innerHTML = '<div class="empty-state"><h3>No works yet</h3><p>Run: <code>supermission new "Your task"</code></p></div>';
    return;
  }
  el.innerHTML = works.map(w => {
    const active = selectedWork === w.id ? ' active' : '';
    const assignee = w.assignee ? ' @' + w.assignee : '';
    return '<div class="work-item' + active + '" onclick="selectWork(\\'' + w.id + '\\')">'
      + '<div class="id">#' + w.id + assignee + ' <span class="status-badge status-' + w.status + '">' + w.status + '</span></div>'
      + '<div class="goal">' + esc(w.goal) + '</div>'
      + '<div class="meta"><span>' + w.priority + '</span><span>' + timeAgo(w.updated_at) + '</span></div>'
      + '</div>';
  }).join('');
}

async function selectWork(id) {
  selectedWork = id;
  currentTab = 'overview';
  await refreshDetail();
  loadWorks(); // re-render to highlight
}

async function refreshDetail() {
  if (!selectedWork) return;
  const data = await fetch(API + '/api/work/' + selectedWork).then(r => r.json());
  document.getElementById('mainTitle').textContent = '#' + data.spec.id + ' — ' + data.spec.goal;
  renderTabs();
  renderContent(data);
}

function renderTabs() {
  const tabs = ['overview', 'events', 'run log', 'validation', 'plan'];
  document.getElementById('tabs').innerHTML = tabs.map(t => {
    const active = currentTab === t ? ' active' : '';
    return '<div class="tab' + active + '" onclick="switchTab(\\'' + t + '\\')">' + t + '</div>';
  }).join('');
}

function switchTab(tab) {
  currentTab = tab;
  refreshDetail();
}

function renderContent(data) {
  const el = document.getElementById('content');
  const s = data.spec;

  if (currentTab === 'overview') {
    el.innerHTML = '<div class="detail-grid">'
      + row('Status', '<span class="status-badge status-' + s.status + '">' + s.status + '</span>')
      + row('Goal', esc(s.goal))
      + row('Owner', s.owner)
      + row('Assignee', s.assignee || '—')
      + row('Priority', s.priority || 'medium')
      + row('Team', s.team || '—')
      + row('Created', s.created_at)
      + row('Updated', s.updated_at)
      + row('Acceptance', s.acceptance.length > 0 ? s.acceptance.map(a => '• ' + esc(a)).join('<br>') : '—')
      + row('Validation', s.validation_commands.length > 0 ? s.validation_commands.map(c => '<code>' + esc(c) + '</code>').join('<br>') : '—')
      + row('Tasks', data.tasks.length + ' task(s)')
      + row('Events', data.events.length + ' event(s)')
      + row('Changes', data.changes.length + ' change(s)')
      + '</div>';
  } else if (currentTab === 'events') {
    if (data.events.length === 0) {
      el.innerHTML = '<div class="empty-state">No events yet</div>';
      return;
    }
    el.innerHTML = data.events.slice().reverse().map(e => {
      const time = e.time ? e.time.slice(11, 19) : '';
      return '<div class="event-line"><span class="event-time">' + time + '</span><span class="event-type">' + e.type + '</span><span class="event-actor">' + e.actor + '</span></div>';
    }).join('');
  } else if (currentTab === 'run log') {
    el.innerHTML = data.runLog ? '<div class="log-box">' + esc(data.runLog) + '</div>' : '<div class="empty-state">No run log yet</div>';
  } else if (currentTab === 'validation') {
    el.innerHTML = data.validationLog ? '<div class="log-box">' + esc(data.validationLog) + '</div>' : '<div class="empty-state">No validation log yet</div>';
  } else if (currentTab === 'plan') {
    el.innerHTML = data.plan ? '<div class="log-box">' + esc(data.plan) + '</div>' : '<div class="empty-state">No plan yet</div>';
  }
}

function row(label, value) {
  return '<div class="detail-label">' + label + '</div><div>' + value + '</div>';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadWorks();
setInterval(loadWorks, 3000);
</script>
</body>
</html>`;
}
