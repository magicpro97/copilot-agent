import type { AgentType } from '../lib/provider.js';
import type { Session, SessionReport } from '../lib/session.js';

// ── Color Theme (matches web dashboard) ──────────────────────────
export const THEME = {
  bg: '#0d1117',
  fg: '#e6edf3',
  border: '#30363d',
  borderFocus: '#58a6ff',
  muted: '#8b949e',
  accent: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
  cyan: '#58a6ff',
  claude: '#f59e0b',
  copilot: '#58a6ff',
} as const;

export function agentColor(agent: AgentType): string {
  return agent === 'claude' ? THEME.claude : THEME.copilot;
}

export function agentLabel(agent: AgentType): string {
  return agent === 'claude' ? '{yellow-fg}claude{/}' : '{cyan-fg}copilot{/}';
}

export function statusIcon(complete: boolean): string {
  return complete ? '{green-fg}✔{/}' : '{yellow-fg}⏳{/}';
}

// ── Duration formatting ──────────────────────────────────────────
export function fmtDuration(ms: number): string {
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTimeAgo(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Bar chart (text-based) ───────────────────────────────────────
export function textBar(value: number, max: number, width: number): string {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

// ── Build session list rows for blessed list ─────────────────────
export function sessionRow(s: Session): string {
  const icon = statusIcon(s.complete);
  const agent = agentLabel(s.agent);
  const name = (s.cwd?.split('/').pop() || s.id.slice(0, 8)).slice(0, 16).padEnd(16);
  const summary = (s.summary || '—').slice(0, 30).padEnd(30);
  const time = fmtTimeAgo(s.mtime).padStart(8);
  const prem = s.premiumRequests > 0 ? `{yellow-fg}⬡${s.premiumRequests}{/}` : '';
  return ` ${icon} ${agent} ${name} ${summary} ${time} ${prem}`;
}

// ── Build tool usage bars for detail panel ───────────────────────
export function toolBars(toolUsage: Record<string, number>, maxWidth: number = 20): string[] {
  const entries = Object.entries(toolUsage).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return [' {gray-fg}No tools used{/}'];
  const maxVal = entries[0][1];
  return entries.map(([name, count]) => {
    const label = name.slice(0, 12).padEnd(12);
    const bar = textBar(count, maxVal, maxWidth);
    return ` ${label} {cyan-fg}${bar}{/} ${count}`;
  });
}

// ── Process table rows ───────────────────────────────────────────
export interface ProcessInfo {
  pid: number;
  command: string;
  sessionId?: string;
  cwd?: string;
  agent: AgentType;
}

export function processRow(p: ProcessInfo): string {
  const pid = String(p.pid).padEnd(7);
  const agent = agentLabel(p.agent);
  const sid = (p.sessionId || '—').slice(0, 20).padEnd(20);
  const cwd = (p.cwd || '—').replace(/^\/Users\/\w+/, '~').slice(0, 30).padEnd(30);
  return ` ${pid} ${agent}  ${sid} ${cwd} {green-fg}running{/}`;
}

// ── Detail panel content ─────────────────────────────────────────
export function detailContent(r: SessionReport): string {
  const lines: string[] = [];

  // Header
  const project = r.cwd?.split('/').pop() || 'unknown';
  lines.push(`{bold}${project}{/} ${agentLabel(r.agent)}`);
  lines.push(`{gray-fg}${r.id}{/}`);
  lines.push('');

  // Stats
  lines.push('{bold}─── Stats ──────────────────────{/}');
  lines.push(` Duration   ${fmtDuration(r.durationMs)}`);
  lines.push(` Messages   ${r.userMessages}`);
  lines.push(` Turns      ${r.assistantTurns}`);
  lines.push(` Tokens     ${fmtNumber(r.outputTokens)}`);
  lines.push(` Premium    {yellow-fg}${r.premiumRequests}{/}`);
  lines.push(` Status     ${r.complete ? '{green-fg}complete{/}' : '{yellow-fg}incomplete{/}'}`);
  lines.push('');

  // Tools
  if (Object.keys(r.toolUsage).length > 0) {
    lines.push('{bold}─── Tools ──────────────────────{/}');
    lines.push(...toolBars(r.toolUsage, 16));
    lines.push('');
  }

  // Commits
  if (r.gitCommits.length > 0) {
    lines.push('{bold}─── Commits ────────────────────{/}');
    for (const c of r.gitCommits.slice(0, 8)) {
      lines.push(` {green-fg}●{/} ${c.slice(0, 50)}`);
    }
    if (r.gitCommits.length > 8) lines.push(`   {gray-fg}... +${r.gitCommits.length - 8} more{/}`);
    lines.push('');
  }

  // Files
  const allFiles = [...r.filesCreated.map(f => `{green-fg}+{/} ${f}`), ...r.filesEdited.map(f => `{yellow-fg}~{/} ${f}`)];
  if (allFiles.length > 0) {
    lines.push('{bold}─── Files ──────────────────────{/}');
    for (const f of allFiles.slice(0, 10)) {
      lines.push(` ${f.length > 50 ? f.slice(0, 50) + '…' : f}`);
    }
    if (allFiles.length > 10) lines.push(`   {gray-fg}... +${allFiles.length - 10} more{/}`);
    lines.push('');
  }

  // Tasks
  if (r.taskCompletions.length > 0) {
    lines.push('{bold}─── Tasks ──────────────────────{/}');
    for (const t of r.taskCompletions.slice(0, 5)) {
      lines.push(` {green-fg}✔{/} ${t.slice(0, 50)}`);
    }
    lines.push('');
  }

  // Errors
  if (r.errors.length > 0) {
    lines.push('{bold}{red-fg}─── Errors ─────────────────────{/}');
    for (const e of r.errors.slice(0, 3)) {
      lines.push(` {red-fg}✗{/} ${e.slice(0, 60)}`);
    }
  }

  return lines.join('\n');
}

// ── Header stats line ────────────────────────────────────────────
export function headerStats(processCount: number, sessionCount: number, totalPremium: number, completedCount: number): string {
  return ` {bold}Processes:{/} {green-fg}${processCount}{/}  {bold}Sessions:{/} ${sessionCount}  {bold}Premium:{/} {yellow-fg}⬡${totalPremium}{/}  {bold}Done:{/} {green-fg}${completedCount}{/}/${sessionCount}`;
}
