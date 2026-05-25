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
      } else if (url.pathname === "/api/pipelines") {
        const { listPipelines } = await import("./pipeline.js");
        const pipelines = await listPipelines(store.repo);
        json(res, pipelines);
      } else if (url.pathname === "/api/environment") {
        const env = await getEnvironment(store);
        json(res, env);
      } else if (url.pathname.startsWith("/api/close/")) {
        const workId = decodeURIComponent(url.pathname.slice("/api/close/".length));
        await store.updateStatus(workId, "completed", "dashboard-user", "Closed from dashboard");
        json(res, { ok: true, workId, status: "completed" });
      } else if (url.pathname.startsWith("/api/action/")) {
        const parts = url.pathname.slice("/api/action/".length).split("/");
        const action = parts[0];
        const workId = decodeURIComponent(parts.slice(1).join("/"));
        const statusMap: Record<string, string> = {
          start: "running", pause: "paused", complete: "completed",
          fail: "failed", reopen: "draft", archive: "completed",
        };
        const newStatus = statusMap[action];
        if (!newStatus) { res.writeHead(400); res.end(JSON.stringify({ error: "unknown action" })); return; }
        await store.updateStatus(workId, newStatus as import("./types.js").WorkStatus, "dashboard-user", `${action} from dashboard`);
        json(res, { ok: true, workId, status: newStatus });
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

async function getEnvironment(store: WorkStore) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const execFileAsync = promisify(execFile);
  const home = (await import("node:os")).homedir();

  // Detect agent CLIs
  const agents = [
    { name: "claude", cmd: "claude", versionFlag: "--version" },
    { name: "codex", cmd: "codex", versionFlag: "--version" },
    { name: "gemini", cmd: "gemini", versionFlag: "--version" },
    { name: "aider", cmd: "aider", versionFlag: "--version" },
    { name: "opencode", cmd: "opencode", versionFlag: "--version" },
    { name: "copilot", cmd: "gh", versionFlag: "--version" },
    { name: "amazon-q", cmd: "q", versionFlag: "--version" },
    { name: "goose", cmd: "goose", versionFlag: "--version" },
  ];

  const clis: Array<{ name: string; version: string; installed: boolean }> = [];
  for (const agent of agents) {
    try {
      const { stdout } = await execFileAsync(agent.cmd, [agent.versionFlag], { timeout: 3000 });
      clis.push({ name: agent.name, version: stdout.trim().split("\n")[0], installed: true });
    } catch {
      clis.push({ name: agent.name, version: "", installed: false });
    }
  }

  // Detect Codex plugins
  const codexPlugins: string[] = [];
  try {
    const pluginDir = join(home, ".codex", ".tmp", "bundled-marketplaces", "openai-bundled", "plugins");
    const entries = await readdir(pluginDir);
    for (const entry of entries) codexPlugins.push(entry);
  } catch { /* no plugins */ }

  // Detect Claude plugins
  let claudePlugins: string[] = [];
  try {
    const pluginFile = join(home, ".claude", "plugins", "installed_plugins.json");
    const text = await (await import("node:fs/promises")).readFile(pluginFile, "utf8");
    const data = JSON.parse(text);
    if (data.plugins && typeof data.plugins === "object") {
      claudePlugins = Object.keys(data.plugins);
    }
  } catch { /* no plugins */ }

  // Runner config
  const config = await store.readRunnerConfig();

  return {
    clis,
    plugins: { codex: codexPlugins, claude: claudePlugins },
    config: { default_backend: config.default_backend, fallback_order: config.fallback_order, routing: config.routing },
  };
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
.nav-tabs { display: flex; border-bottom: 1px solid var(--border); }
.nav-tab { flex: 1; text-align: center; padding: 8px; font-size: 0.8rem; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.nav-tab:hover { color: var(--text); }
.nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.lang-btn { background: var(--bg); border: 1px solid var(--border); color: var(--muted); padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.7rem; }
.lang-btn.active { color: var(--accent); border-color: var(--accent); }
.pipeline-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
.pipeline-name { font-size: 0.9rem; color: var(--accent); margin-bottom: 4px; }
.pipeline-desc { font-size: 0.8rem; color: var(--muted); margin-bottom: 8px; }
.pipeline-stages { display: flex; gap: 4px; flex-wrap: wrap; }
.pipeline-stage { background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; color: var(--text); }
.env-section { margin-bottom: 16px; }
.env-title { font-size: 0.85rem; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
.env-item { font-size: 0.8rem; padding: 4px 0; display: flex; gap: 8px; }
.env-installed { color: var(--green); }
.env-missing { color: var(--muted); }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">
    <h1>⚡ Supermission</h1>
    <div class="subtitle" id="subtitle">本地优先 AI 工作记录</div>
    <div style="margin-top:8px;display:flex;gap:4px;">
      <button class="lang-btn" onclick="setLang('zh')" id="btn-zh">中</button>
      <button class="lang-btn" onclick="setLang('zh-TW')" id="btn-zh-TW">繁</button>
      <button class="lang-btn" onclick="setLang('en')" id="btn-en">EN</button>
    </div>
  </div>
  <div class="nav-tabs">
    <div class="nav-tab active" id="nav-kanban" onclick="switchView('kanban')"><span id="lbl-kanban">看板</span></div>
    <div class="nav-tab" id="nav-pipelines" onclick="switchView('pipelines')"><span id="lbl-pipelines">流水线</span></div>
    <div class="nav-tab" id="nav-env" onclick="switchView('env')"><span id="lbl-env">环境</span></div>
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
      + '</div>'
      + renderActions(s.id, s.status);
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

let currentView = 'kanban';
let currentLang = 'zh';

const i18n = {
  zh: { subtitle: '本地优先 AI 工作记录', kanban: '看板', pipelines: '流水线', env: '环境', overview: '概览', events: '事件', runlog: '运行日志', validation: '验证', plan: '计划', noWorks: '还没有任务', noEvents: '暂无事件', noRunLog: '暂无运行日志', noValidation: '暂无验证日志', noPlan: '暂无计划', total: '个任务', status: '状态', goal: '目标', owner: '负责人', assignee: '执行人', priority: '优先级', team: '团队', created: '创建时间', updated: '更新时间', acceptance: '验收标准', validationCmd: '验证命令', tasks: '子任务', changes: '变更', installed: '已安装', notInstalled: '未安装', plugins: '插件', config: '配置', defaultBackend: '默认后端', fallbackOrder: '降级顺序', routing: '路由' },
  'zh-TW': { subtitle: '本地優先 AI 工作記錄', kanban: '看板', pipelines: '流水線', env: '環境', overview: '概覽', events: '事件', runlog: '運行日誌', validation: '驗證', plan: '計劃', noWorks: '還沒有任務', noEvents: '暫無事件', noRunLog: '暫無運行日誌', noValidation: '暫無驗證日誌', noPlan: '暫無計劃', total: '個任務', status: '狀態', goal: '目標', owner: '負責人', assignee: '執行人', priority: '優先級', team: '團隊', created: '創建時間', updated: '更新時間', acceptance: '驗收標準', validationCmd: '驗證命令', tasks: '子任務', changes: '變更', installed: '已安裝', notInstalled: '未安裝', plugins: '插件', config: '配置', defaultBackend: '默認後端', fallbackOrder: '降級順序', routing: '路由' },
  en: { subtitle: 'Local-first AI work records', kanban: 'Kanban', pipelines: 'Pipelines', env: 'Environment', overview: 'Overview', events: 'Events', runlog: 'Run Log', validation: 'Validation', plan: 'Plan', noWorks: 'No works yet', noEvents: 'No events yet', noRunLog: 'No run log yet', noValidation: 'No validation log yet', noPlan: 'No plan yet', total: 'work(s)', status: 'Status', goal: 'Goal', owner: 'Owner', assignee: 'Assignee', priority: 'Priority', team: 'Team', created: 'Created', updated: 'Updated', acceptance: 'Acceptance', validationCmd: 'Validation', tasks: 'Tasks', changes: 'Changes', installed: 'installed', notInstalled: 'not installed', plugins: 'Plugins', config: 'Config', defaultBackend: 'Default backend', fallbackOrder: 'Fallback order', routing: 'Routing' },
};

function L(key) { return i18n[currentLang][key] || key; }

function setLang(lang) {
  currentLang = lang;
  document.getElementById('subtitle').textContent = L('subtitle');
  document.getElementById('lbl-kanban').textContent = L('kanban');
  document.getElementById('lbl-pipelines').textContent = L('pipelines');
  document.getElementById('lbl-env').textContent = L('env');
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + lang).classList.add('active');
  loadWorks();
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('nav-' + view).classList.add('active');
  if (view === 'kanban') { loadWorks(); }
  else if (view === 'pipelines') { loadPipelines(); }
  else if (view === 'env') { loadEnvironment(); }
}

async function loadPipelines() {
  const pipelines = await fetch(API + '/api/pipelines').then(r => r.json());
  const el = document.getElementById('workList');
  const content = document.getElementById('content');
  document.getElementById('mainTitle').textContent = L('pipelines');
  document.getElementById('tabs').innerHTML = '';
  el.innerHTML = '';
  if (pipelines.length === 0) {
    content.innerHTML = '<div class="empty-state"><h3>No pipelines</h3><p>Run: <code>supermission pipeline init</code></p></div>';
    return;
  }
  content.innerHTML = pipelines.map(p =>
    '<div class="pipeline-card"><div class="pipeline-name">' + esc(p.name) + '</div>'
    + '<div class="pipeline-desc">' + esc(p.description) + '</div>'
    + '<div class="pipeline-stages">' + p.stages.map(s =>
      '<span class="pipeline-stage">' + s.id + ' (' + s.role + ')' + (s.backend ? ' [' + s.backend + ']' : '') + '</span>'
    ).join(' → ') + '</div></div>'
  ).join('');
}

async function loadEnvironment() {
  const env = await fetch(API + '/api/environment').then(r => r.json());
  const el = document.getElementById('workList');
  const content = document.getElementById('content');
  document.getElementById('mainTitle').textContent = L('env');
  document.getElementById('tabs').innerHTML = '';
  el.innerHTML = '';
  let html = '<div class="env-section"><div class="env-title">Agent CLIs</div>';
  for (const cli of env.clis) {
    const cls = cli.installed ? 'env-installed' : 'env-missing';
    const icon = cli.installed ? '✓' : '✗';
    html += '<div class="env-item"><span class="' + cls + '">' + icon + '</span><span>' + cli.name + '</span><span class="' + cls + '">' + (cli.version || L('notInstalled')) + '</span></div>';
  }
  html += '</div>';
  html += '<div class="env-section"><div class="env-title">' + L('plugins') + '</div>';
  if (env.plugins.codex.length > 0) html += '<div class="env-item"><span>Codex:</span><span>' + env.plugins.codex.join(', ') + '</span></div>';
  if (env.plugins.claude.length > 0) html += '<div class="env-item"><span>Claude:</span><span>' + env.plugins.claude.join(', ') + '</span></div>';
  if (env.plugins.codex.length === 0 && env.plugins.claude.length === 0) html += '<div class="env-item" style="color:var(--muted)">No plugins detected</div>';
  html += '</div>';
  html += '<div class="env-section"><div class="env-title">' + L('config') + '</div>';
  html += '<div class="env-item"><span>' + L('defaultBackend') + ':</span><span>' + env.config.default_backend + '</span></div>';
  if (env.config.fallback_order.length > 0) html += '<div class="env-item"><span>' + L('fallbackOrder') + ':</span><span>' + env.config.fallback_order.join(' → ') + '</span></div>';
  if (Object.keys(env.config.routing).length > 0) {
    html += '<div class="env-item"><span>' + L('routing') + ':</span></div>';
    for (const [role, backend] of Object.entries(env.config.routing)) {
      html += '<div class="env-item" style="padding-left:16px"><span>' + role + ' →</span><span>' + backend + '</span></div>';
    }
  }
  html += '</div>';
  content.innerHTML = html;
}

async function closeWork(id) {
  await fetch(API + '/api/close/' + id, { method: 'POST' });
  await loadWorks();
  await refreshDetail();
}

function renderActions(id, status) {
  const btn = (label, action, color) => '<button style="background:var(--surface);border:1px solid var(--border);color:' + color + ';padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;margin-right:6px;" onclick="doAction(\\'' + action + '\\',\\'' + id + '\\')">' + label + '</button>';
  let html = '<div style="margin-top:12px">';
  if (['draft','planned','approved','paused'].includes(status)) html += btn('▶ Start', 'start', 'var(--orange)');
  if (status === 'running') html += btn('⏸ Pause', 'pause', 'var(--muted)');
  if (['running','validated','needs_review'].includes(status)) html += btn('✓ Complete', 'complete', 'var(--green)');
  if (status === 'running') html += btn('✗ Fail', 'fail', 'var(--red)');
  if (['completed','failed','paused'].includes(status)) html += btn('↺ Reopen', 'reopen', 'var(--accent)');
  if (status !== 'completed') html += btn('🗑 Archive', 'archive', 'var(--muted)');
  html += '</div>';
  return html;
}

async function doAction(action, id) {
  await fetch(API + '/api/action/' + action + '/' + id, { method: 'POST' });
  await loadWorks();
  await refreshDetail();
}

// Init language
setLang('zh');
</script>
</body>
</html>`;
}
