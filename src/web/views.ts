import type { SessionReport } from '../lib/session.js';
import type { CopilotProcess } from '../lib/process.js';

// ─── Helpers ───────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtDur(ms: number): string {
  if (!ms) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function shortPath(p: string, proj: string): string {
  if (proj && p.includes(proj + '/')) return p.split(proj + '/').pop() ?? p;
  return p.split('/').slice(-3).join('/');
}

// ─── Stats Bar ─────────────────────────────────────────────
export function renderStats(sessions: SessionReport[]): string {
  const totalPremium = sessions.reduce((a, s) => a + (s.premiumRequests ?? 0), 0);
  const totalTokens = sessions.reduce((a, s) => a + (s.outputTokens ?? 0), 0);
  const totalCommits = sessions.reduce((a, s) => a + (s.gitCommits?.length ?? 0), 0);
  const totalTasks = sessions.reduce((a, s) => a + (s.taskCompletions?.length ?? 0), 0);
  const completed = sessions.filter(s => s.complete).length;

  const items = [
    { label: 'Sessions', value: String(sessions.length), cls: 'cyan' },
    { label: 'Completed', value: `${completed}/${sessions.length}`, cls: 'green' },
    { label: 'Premium', value: fmt(totalPremium), cls: 'yellow' },
    { label: 'Tokens', value: fmt(totalTokens), cls: 'purple' },
    { label: 'Commits', value: String(totalCommits), cls: 'green' },
    { label: 'Tasks Done', value: String(totalTasks), cls: 'cyan' },
  ];

  return items.map(i =>
    `<div class="stat"><div class="stat-label">${i.label}</div><div class="stat-value ${i.cls}">${i.value}</div></div>`
  ).join('');
}

// ─── Process List ──────────────────────────────────────────
export function renderProcesses(procs: CopilotProcess[]): string {
  if (procs.length === 0) return '<div class="empty">No active copilot processes</div>';
  return procs.map(p => {
    const sid = p.sessionId ? p.sessionId.slice(0, 8) + '…' : '—';
    return `<div class="proc">
      <div class="proc-dot"></div>
      <span class="proc-pid">PID ${p.pid}</span>
      <span class="proc-sid">${esc(sid)}</span>
      <span class="proc-cwd">${esc(p.cwd ?? '')}</span>
    </div>`;
  }).join('');
}

// ─── Session List ──────────────────────────────────────────
export function renderSessionList(sessions: SessionReport[], selectedId?: string): string {
  return sessions.map(s => {
    const proj = (s.cwd ?? '').split('/').pop() ?? '—';
    const isActive = s.id === selectedId;
    return `<div class="s-item${isActive ? ' active' : ''}"
      hx-get="/partial/detail/${s.id}" hx-target="#detail" hx-swap="innerHTML"
      onclick="document.querySelectorAll('.s-item').forEach(e=>e.classList.remove('active'));this.classList.add('active')">
      <div class="s-row">
        <span class="s-icon">${s.complete ? '✅' : '⏸️'}</span>
        <div class="s-info">
          <div class="s-title">${esc(proj)} — ${esc(s.summary || '(no summary)')}</div>
          <div class="s-meta">
            <span>${fmtDur(s.durationMs)}</span>
            <span>${fmt(s.premiumRequests)} premium</span>
            <span>${fmtAgo(s.endTime)}</span>
            <span class="badge ${s.complete ? 'badge-done' : 'badge-stop'}">${s.complete ? 'done' : 'stopped'}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Session Detail ────────────────────────────────────────
export function renderDetail(s: SessionReport): string {
  const proj = (s.cwd ?? '').split('/').pop() ?? '—';
  const totalTools = Object.values(s.toolUsage ?? {}).reduce((a, b) => a + b, 0);
  const toolEntries = Object.entries(s.toolUsage ?? {}).sort((a, b) => b[1] - a[1]);
  const maxTool = toolEntries[0]?.[1] ?? 1;

  let html = '';

  // Header
  html += `<div class="detail-head">
    <div class="detail-title">${esc(proj)}</div>
    <div class="detail-id">${s.id}</div>
  </div>`;

  html += `<div class="detail-time">${fmtTime(s.startTime)} → ${fmtTime(s.endTime)}</div>`;

  // Stats grid
  html += `<div class="detail-stats">
    <div class="d-stat"><div class="d-stat-label">Duration</div><div class="d-stat-val">${fmtDur(s.durationMs)}</div></div>
    <div class="d-stat"><div class="d-stat-label">User Msgs</div><div class="d-stat-val">${s.userMessages}</div></div>
    <div class="d-stat"><div class="d-stat-label">Turns</div><div class="d-stat-val">${fmt(s.assistantTurns)}</div></div>
    <div class="d-stat"><div class="d-stat-label">Tokens</div><div class="d-stat-val">${fmt(s.outputTokens)}</div></div>
    <div class="d-stat"><div class="d-stat-label">Premium</div><div class="d-stat-val">${fmt(s.premiumRequests)}</div></div>
    <div class="d-stat"><div class="d-stat-label">Tool Calls</div><div class="d-stat-val">${fmt(totalTools)}</div></div>
  </div>`;

  // Tools chart
  if (toolEntries.length > 0) {
    html += `<div class="sub"><div class="sub-title">🔧 Tools Used</div>`;
    for (const [tool, count] of toolEntries.slice(0, 12)) {
      const pct = Math.round((count / maxTool) * 100);
      html += `<div class="tool-row">
        <span class="tool-name">${esc(tool)}</span>
        <div class="tool-bar-bg"><div class="tool-bar" style="width:${pct}%"></div></div>
        <span class="tool-count">${count}</span>
      </div>`;
    }
    if (toolEntries.length > 12) html += `<div class="more">… +${toolEntries.length - 12} more</div>`;
    html += `</div>`;
  }

  // Git commits
  if (s.gitCommits.length > 0) {
    html += `<div class="sub"><div class="sub-title">🔀 Git Commits <span class="count">${s.gitCommits.length}</span></div><ul class="commit-list">`;
    for (const msg of s.gitCommits.slice(0, 12)) {
      const first = msg.split('\n')[0].slice(0, 80);
      html += `<li><span class="c-dot">●</span><span>${esc(first)}</span></li>`;
    }
    if (s.gitCommits.length > 12) html += `<li class="more">… +${s.gitCommits.length - 12} more</li>`;
    html += `</ul></div>`;
  }

  // Files
  const files = [
    ...s.filesCreated.map(f => ({ path: f, type: 'created' as const })),
    ...s.filesEdited.map(f => ({ path: f, type: 'edited' as const })),
  ];
  if (files.length > 0) {
    html += `<div class="sub"><div class="sub-title">📁 Files Changed <span class="count">${files.length}</span></div><ul class="file-list">`;
    for (const f of files.slice(0, 25)) {
      const cls = f.type === 'created' ? 'file-created' : 'file-edited';
      const icon = f.type === 'created' ? '+' : '~';
      html += `<li><span class="${cls}">${icon}</span> ${esc(shortPath(f.path, proj))}</li>`;
    }
    if (files.length > 25) html += `<li class="more">… +${files.length - 25} more</li>`;
    html += `</ul></div>`;
  }

  // Task completions
  if (s.taskCompletions.length > 0) {
    html += `<div class="sub"><div class="sub-title">✅ Tasks Completed <span class="count">${s.taskCompletions.length}</span></div><ul class="task-list">`;
    for (const t of s.taskCompletions.slice(0, 10)) {
      const first = t.split('\n')[0].slice(0, 80);
      html += `<li><span class="t-check">✔</span><span>${esc(first)}</span></li>`;
    }
    if (s.taskCompletions.length > 10) html += `<li class="more">… +${s.taskCompletions.length - 10} more</li>`;
    html += `</ul></div>`;
  }

  // Errors
  if (s.errors.length > 0) {
    html += `<div class="sub"><div class="sub-title" style="color:var(--red)">⚠️ Errors <span class="count">${s.errors.length}</span></div><ul class="error-list">`;
    for (const e of s.errors.slice(0, 5)) {
      html += `<li>${esc(e.slice(0, 100))}</li>`;
    }
    if (s.errors.length > 5) html += `<li class="more">… +${s.errors.length - 5} more</li>`;
    html += `</ul></div>`;
  }

  return html;
}
