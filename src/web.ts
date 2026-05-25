import { createServer } from "node:http";
import { exec } from "node:child_process";
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

    try {
      if (url.pathname === "/api/works") {
        const works = await getWorks(store);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(works));
      } else if (url.pathname === "/api/team") {
        const registry = await readTeamRegistry(store.repo);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(registry ?? { identities: [] }));
      } else if (url.pathname.startsWith("/api/work/")) {
        const workId = url.pathname.slice("/api/work/".length);
        const detail = await getWorkDetail(store, workId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(detail));
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
    console.log(`Supermission dashboard: http://localhost:${options.port}`);
    if (options.open) {
      exec(`open http://localhost:${options.port}`);
    }
  });
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
  return { spec, tasks, events: events.slice(-20), changes };
}

function dashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supermission Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
h1 { font-size: 1.5rem; margin-bottom: 8px; color: #58a6ff; }
.subtitle { color: #8b949e; margin-bottom: 24px; font-size: 0.9rem; }
.board { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-bottom: 32px; }
.column { background: #161b22; border-radius: 8px; padding: 12px; border: 1px solid #30363d; }
.column-header { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 12px; display: flex; justify-content: space-between; }
.column-header .count { background: #21262d; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; }
.card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
.card:hover { border-color: #58a6ff; }
.card-title { font-size: 0.85rem; color: #c9d1d9; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-meta { font-size: 0.75rem; color: #8b949e; }
.card-assignee { color: #58a6ff; }
.status-draft { border-left: 3px solid #8b949e; }
.status-planned { border-left: 3px solid #d2a8ff; }
.status-approved { border-left: 3px solid #79c0ff; }
.status-running { border-left: 3px solid #ffa657; }
.status-needs_review { border-left: 3px solid #f0883e; }
.status-validated { border-left: 3px solid #56d364; }
.status-completed { border-left: 3px solid #3fb950; }
.status-failed { border-left: 3px solid #f85149; }
.status-blocked { border-left: 3px solid #f85149; }
.detail { display: none; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
.detail.active { display: block; }
.detail h2 { font-size: 1.1rem; color: #58a6ff; margin-bottom: 12px; }
.detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; font-size: 0.85rem; margin-bottom: 16px; }
.detail-label { color: #8b949e; }
.detail-value { color: #c9d1d9; }
.events { max-height: 200px; overflow-y: auto; font-size: 0.8rem; font-family: monospace; background: #0d1117; padding: 10px; border-radius: 4px; border: 1px solid #30363d; }
.event-line { padding: 2px 0; color: #8b949e; }
.event-type { color: #79c0ff; }
.team-section { margin-top: 24px; }
.team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.team-card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; }
.team-name { font-size: 0.85rem; color: #c9d1d9; }
.team-role { font-size: 0.75rem; color: #8b949e; }
.refresh-btn { position: fixed; top: 16px; right: 24px; background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
.refresh-btn:hover { border-color: #58a6ff; }
.empty { color: #8b949e; font-size: 0.85rem; text-align: center; padding: 40px; }
</style>
</head>
<body>
<button class="refresh-btn" onclick="loadData()">↻ Refresh</button>
<h1>⚡ Supermission</h1>
<p class="subtitle">Local-first work records for AI-assisted software delivery</p>

<div id="detail" class="detail"></div>
<div id="board" class="board"></div>
<div id="team" class="team-section"></div>

<script>
const API = 'http://localhost:${port}';
const COLUMNS = ['draft','planned','approved','running','needs_review','needs_decision','validated','completed','failed','blocked'];

async function loadData() {
  const [works, team] = await Promise.all([
    fetch(API + '/api/works').then(r => r.json()),
    fetch(API + '/api/team').then(r => r.json()),
  ]);
  renderBoard(works);
  renderTeam(team);
}

function renderBoard(works) {
  const board = document.getElementById('board');
  if (works.length === 0) {
    board.innerHTML = '<div class="empty">No work records yet. Run: supermission new "Your task"</div>';
    return;
  }
  const grouped = {};
  for (const w of works) {
    if (!grouped[w.status]) grouped[w.status] = [];
    grouped[w.status].push(w);
  }
  const activeColumns = COLUMNS.filter(s => grouped[s]?.length > 0);
  board.innerHTML = activeColumns.map(status => {
    const items = grouped[status] || [];
    return '<div class="column"><div class="column-header"><span>' + status.replace('_',' ') + '</span><span class="count">' + items.length + '</span></div>'
      + items.map(w => '<div class="card status-' + w.status + '" onclick="showDetail(\\'' + w.id + '\\')">'
        + '<div class="card-title">' + escHtml(w.goal) + '</div>'
        + '<div class="card-meta">' + w.id.slice(0,20) + (w.assignee ? ' <span class=card-assignee>@' + w.assignee + '</span>' : '') + '</div>'
        + '</div>').join('')
      + '</div>';
  }).join('');
}

async function showDetail(workId) {
  const data = await fetch(API + '/api/work/' + workId).then(r => r.json());
  const s = data.spec;
  const el = document.getElementById('detail');
  el.className = 'detail active';
  el.innerHTML = '<h2>' + escHtml(s.goal) + '</h2>'
    + '<div class="detail-grid">'
    + row('ID', s.id) + row('Status', s.status) + row('Owner', s.owner)
    + row('Assignee', s.assignee || '—') + row('Team', s.team || '—')
    + row('Created', s.created_at) + row('Updated', s.updated_at)
    + row('Acceptance', s.acceptance.length + ' criteria')
    + row('Validation', s.validation_commands.length + ' commands')
    + row('Tasks', data.tasks.length + ' task(s)')
    + '</div>'
    + '<h3 style="font-size:0.9rem;color:#8b949e;margin-bottom:8px">Recent Events</h3>'
    + '<div class="events">' + data.events.map(e =>
      '<div class="event-line"><span class="event-type">' + e.type + '</span> ' + e.actor + ' ' + e.time + '</div>'
    ).join('') + '</div>';
}

function row(label, value) {
  return '<div class="detail-label">' + label + '</div><div class="detail-value">' + escHtml(String(value)) + '</div>';
}

function renderTeam(team) {
  const el = document.getElementById('team');
  if (!team.identities || team.identities.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<h3 style="font-size:0.9rem;color:#8b949e;margin-bottom:12px">Team</h3>'
    + '<div class="team-grid">' + team.identities.map(i =>
      '<div class="team-card"><div class="team-name">' + escHtml(i.name) + '</div>'
      + '<div class="team-role">' + i.kind + ' · ' + i.role + (i.backend ? ' · ' + i.backend : '') + '</div></div>'
    ).join('') + '</div>';
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadData();
setInterval(loadData, 5000);
</script>
</body>
</html>`;
}
