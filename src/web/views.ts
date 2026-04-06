import type { SessionReport, FileChange } from '../lib/session.js';
import type { CopilotProcess } from '../lib/process.js';
import { createPatch } from 'diff';

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
  if (procs.length === 0) return '<div class="empty">No active agent processes detected</div>';
  return procs.map(p => {
    const sid = p.sessionId ? p.sessionId.slice(0, 8) + '…' : '';
    const agentBadge = p.agent === 'claude'
      ? '<span class="badge badge-claude">claude</span>'
      : '<span class="badge badge-copilot">copilot</span>';
    const cwdShort = p.cwd ? p.cwd.split('/').pop() ?? p.cwd.split('\\').pop() ?? '' : '';
    return `<div class="proc">
      <div class="proc-dot"></div>
      ${agentBadge}
      <span class="proc-pid">PID ${p.pid}</span>
      ${sid ? `<span class="proc-sid">${esc(sid)}</span>` : ''}
      ${cwdShort ? `<span class="proc-cwd">${esc(cwdShort)}</span>` : ''}
      <span class="proc-cmd">${esc(p.command.slice(0, 60))}</span>
    </div>`;
  }).join('');
}

// ─── Session List ──────────────────────────────────────────
export function renderSessionList(sessions: SessionReport[], selectedId?: string): string {
  return sessions.map(s => {
    const proj = (s.cwd ?? '').split('/').pop() ?? '—';
    const isActive = s.id === selectedId;
    const agentBadge = s.agent === 'claude'
      ? '<span class="badge badge-claude">claude</span>'
      : '<span class="badge badge-copilot">copilot</span>';
    return `<div class="s-item${isActive ? ' active' : ''}"
      hx-get="/partial/detail/${s.id}" hx-target="#detail" hx-swap="innerHTML"
      onclick="document.querySelectorAll('.s-item').forEach(e=>e.classList.remove('active'));this.classList.add('active')">
      <div class="s-row">
        <span class="s-icon">${s.complete ? '✅' : '⏸️'}</span>
        <div class="s-info">
          <div class="s-title">${agentBadge} ${esc(proj)} — ${esc(s.summary || '(no summary)')}</div>
          <div class="s-meta">
            <span>${fmtDur(s.durationMs)}</span>
            <span>${s.agent === 'claude' ? '' : fmt(s.premiumRequests) + ' premium'}</span>
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

  const agentBadge = s.agent === 'claude'
    ? '<span class="badge badge-claude" style="margin-left:8px">claude</span>'
    : '<span class="badge badge-copilot" style="margin-left:8px">copilot</span>';

  // Header
  html += `<div class="detail-head">
    <div class="detail-title">${esc(proj)}${agentBadge}</div>
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
    const hasDiffs = s.fileChanges && s.fileChanges.length > 0;
    html += `<div class="sub"><div class="sub-title">📁 Files Changed <span class="count">${files.length}</span>`;
    if (hasDiffs) {
      html += ` <button class="diff-btn" hx-get="/partial/diff/${s.id}" hx-target="#detail" hx-swap="innerHTML">View Diff</button>`;
    }
    html += `</div><ul class="file-list">`;
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

// ─── Diff View (powered by diff + diff2html + highlight.js) ──

/** Use full file path in diff header so highlight.js auto-detects language from extension */
function changesToUnifiedDiff(changes: FileChange[], _proj: string): string {
  const patches: string[] = [];

  const byFile = new Map<string, FileChange[]>();
  for (const c of changes) {
    const arr = byFile.get(c.path) ?? [];
    arr.push(c);
    byFile.set(c.path, arr);
  }

  for (const [filePath, fileChanges] of byFile) {
    for (const change of fileChanges) {
      if (change.type === 'create') {
        const content = change.content ?? '';
        patches.push(createPatch(filePath, '', content, '', '', { context: 3 }));
      } else if (change.type === 'edit') {
        patches.push(createPatch(filePath, change.oldStr ?? '', change.newStr ?? '', '', '', { context: 3 }));
      }
    }
  }

  return patches.join('\n');
}

export function generateUnifiedDiff(s: SessionReport): string {
  const proj = (s.cwd ?? '').split('/').pop() ?? '';
  return changesToUnifiedDiff(s.fileChanges ?? [], proj);
}

export function renderDiffView(s: SessionReport, viewStyle: 'side' | 'line' = 'line'): string {
  const changes = s.fileChanges ?? [];

  if (changes.length === 0) {
    return `<div class="diff-empty">
      <div class="diff-empty-icon">📄</div>
      <div>No diff data available for this session</div>
      <button class="diff-btn" hx-get="/partial/detail/${s.id}" hx-target="#detail" hx-swap="innerHTML">← Back to Detail</button>
    </div>`;
  }

  const byFile = new Map<string, FileChange[]>();
  for (const c of changes) {
    const arr = byFile.get(c.path) ?? [];
    arr.push(c);
    byFile.set(c.path, arr);
  }

  const otherStyle = viewStyle === 'side' ? 'line' : 'side';
  const otherLabel = viewStyle === 'side' ? 'Unified' : 'Side-by-Side';
  const outputFormat = viewStyle === 'side' ? 'side-by-side' : 'line-by-line';

  // Client-side rendering with Diff2HtmlUI for syntax highlighting
  return `<div class="diff-view">
    <div class="diff-toolbar">
      <button class="diff-btn" hx-get="/partial/detail/${s.id}" hx-target="#detail" hx-swap="innerHTML">← Back</button>
      <span class="diff-summary">${changes.length} change${changes.length > 1 ? 's' : ''} across ${byFile.size} file${byFile.size > 1 ? 's' : ''}</span>
      <button class="diff-btn" hx-get="/partial/diff/${s.id}?style=${otherStyle}" hx-target="#detail" hx-swap="innerHTML">${otherLabel}</button>
    </div>
    <div id="diff-container" class="diff2html-wrapper"></div>
    <script>
    (function() {
      fetch('/api/diff/${s.id}')
        .then(r => r.json())
        .then(data => {
          var target = document.getElementById('diff-container');
          var ui = new Diff2HtmlUI(target, data.diff, {
            drawFileList: true,
            matching: 'lines',
            outputFormat: '${outputFormat}',
            highlight: true,
            colorScheme: 'dark',
            fileListToggle: true,
            fileContentToggle: true,
          });
          ui.draw();
          ui.highlightCode();
        })
        .catch(function() {
          document.getElementById('diff-container').innerHTML = '<div class="diff-more">Failed to load diff</div>';
        });
    })();
    </script>
  </div>`;
}
