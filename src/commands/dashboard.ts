import type { Command } from 'commander';
import { listAllSessions, getAgentSessionReport, type SessionReport, type Session } from '../lib/session.js';
import { findAgentProcesses } from '../lib/process.js';
import {
  agentLabel, statusIcon, fmtDuration, fmtTimeAgo, fmtNumber,
  textBar, sessionRow, processRow, detailContent, headerStats,
  toolBars,
  type ProcessInfo,
} from '../tui/widgets.js';

// ── blessed dynamic import (CJS module) ──────────────────────────
let blessed: any;
async function loadBlessed() {
  const mod = await import('blessed');
  blessed = mod.default || mod;
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('tui')
    .description('Real-time terminal dashboard for copilot sessions (htop-style)')
    .option('-r, --refresh <n>', 'Refresh interval in seconds', '5')
    .option('-l, --limit <n>', 'Number of sessions to show', '20')
    .action(async (opts) => {
      await loadBlessed();
      runBlessedDashboard(parseInt(opts.refresh, 10), parseInt(opts.limit, 10));
    });
}

// ══════════════════════════════════════════════════════════════════
// PERFORMANCE CACHE — avoid re-parsing files on every render
// ══════════════════════════════════════════════════════════════════

interface DataCache {
  sessions: Session[];
  sessionsTs: number;
  procs: ProcessInfo[];
  procsTs: number;
  details: Map<string, { report: SessionReport | null; ts: number }>;
}

function createCache(): DataCache {
  return { sessions: [], sessionsTs: 0, procs: [], procsTs: 0, details: new Map() };
}

/** Refresh session list (min 2s between refreshes) */
function cacheSessions(cache: DataCache, limit: number): Session[] {
  const now = Date.now();
  if (now - cache.sessionsTs > 2000) {
    try { cache.sessions = listAllSessions(limit); } catch { /* keep stale */ }
    cache.sessionsTs = now;
  }
  return cache.sessions;
}

/** Refresh process list (min 3s between refreshes — ps+lsof is expensive) */
function cacheProcs(cache: DataCache): ProcessInfo[] {
  const now = Date.now();
  if (now - cache.procsTs > 3000) {
    try { cache.procs = findAgentProcesses() as ProcessInfo[]; } catch { /* keep stale */ }
    cache.procsTs = now;
  }
  return cache.procs;
}

/** Get session detail report (cached 10s, only parsed on demand) */
function cacheDetail(cache: DataCache, s: Session): SessionReport | null {
  const entry = cache.details.get(s.id);
  if (entry && Date.now() - entry.ts < 10_000) return entry.report;
  let report: SessionReport | null = null;
  try { report = getAgentSessionReport(s.id, s.agent); } catch { /* null */ }
  cache.details.set(s.id, { report, ts: Date.now() });
  // Evict old entries
  if (cache.details.size > 15) {
    const oldest = [...cache.details.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) cache.details.delete(oldest[0]);
  }
  return report;
}

// ══════════════════════════════════════════════════════════════════
// BLESSED HTOP-STYLE DASHBOARD
// ══════════════════════════════════════════════════════════════════

function runBlessedDashboard(refreshSec: number, limit: number): void {
  const cache = createCache();

  const screen = blessed.screen({
    smartCSR: true,
    title: 'copilot-agent dashboard',
    fullUnicode: true,
  });

  // ── Color constants ────────────────────────────────────────────
  const BG = '#0d1117';
  const FG = '#e6edf3';
  const BORDER_COLOR = '#30363d';
  const ACCENT = '#58a6ff';
  const MUTED = '#8b949e';

  // ── Header bar ─────────────────────────────────────────────────
  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: { fg: FG, bg: '#161b22', border: { fg: BORDER_COLOR } },
    border: { type: 'line' },
    content: '',
  });

  // ── Process panel (top) ────────────────────────────────────────
  const processBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: 7,
    tags: true,
    label: ' {cyan-fg}{bold}Active Processes{/} ',
    scrollable: true,
    style: { fg: FG, bg: BG, border: { fg: BORDER_COLOR }, label: { fg: ACCENT } },
    border: { type: 'line' },
    content: '',
  });

  // ── Session list (left panel) ──────────────────────────────────
  const sessionList = blessed.list({
    parent: screen,
    top: 10,
    left: 0,
    width: '45%',
    bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Sessions{/} ',
    scrollable: true,
    keys: true,
    vi: true,
    mouse: true,
    style: {
      fg: FG,
      bg: BG,
      border: { fg: BORDER_COLOR },
      label: { fg: ACCENT },
      selected: { fg: '#ffffff', bg: '#1f6feb', bold: true },
      item: { fg: FG },
    },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
  });

  // ── Detail panel (right) ───────────────────────────────────────
  const detailBox = blessed.box({
    parent: screen,
    top: 10,
    left: '45%',
    width: '55%',
    bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Detail{/} ',
    scrollable: true,
    keys: true,
    vi: true,
    mouse: true,
    style: { fg: FG, bg: BG, border: { fg: BORDER_COLOR }, label: { fg: ACCENT } },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
    content: '{gray-fg}Select a session with ↑↓ keys{/}',
  });

  // ── Footer ─────────────────────────────────────────────────────
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: { fg: MUTED, bg: '#161b22', border: { fg: BORDER_COLOR } },
    border: { type: 'line' },
    content: ' {bold}↑↓{/} Navigate  {bold}Enter{/} Detail  {bold}Tab{/} Switch panel  {bold}r{/} Refresh  {bold}q{/} Quit',
  });

  // ── State ──────────────────────────────────────────────────────
  let sessions: Session[] = [];
  let procs: ProcessInfo[] = [];
  let selectedIdx = 0;
  let focusedPanel: 'sessions' | 'detail' = 'sessions';
  let lastDetailId = '';

  // ── Render header (cheap — only string formatting) ─────────────
  function renderHeader(): void {
    const time = new Date().toLocaleTimeString('en-GB');
    const totalPremium = sessions.reduce((s, x) => s + x.premiumRequests, 0);
    const completedCount = sessions.filter(s => s.complete).length;
    const stats = headerStats(procs.length, sessions.length, totalPremium, completedCount);
    headerBox.setContent(` {bold}{cyan-fg}⚡ copilot-agent{/}  ${stats}  {gray-fg}${time}{/}`);
  }

  // ── Render processes (cheap — just formatting cached data) ─────
  function renderProcesses(): void {
    if (procs.length === 0) {
      processBox.setContent(' {gray-fg}No agent processes running{/}');
      return;
    }
    const header = ` ${'PID'.padEnd(7)} ${'Agent'.padEnd(10)} ${'Session'.padEnd(20)} ${'Directory'.padEnd(30)} Status`;
    const rows = procs.map(p => processRow(p));
    processBox.setContent(`{gray-fg}${header}{/}\n${rows.join('\n')}`);
  }

  // ── Render session list (cheap — just formatting cached data) ──
  function renderSessions(): void {
    const items = sessions.map(s => sessionRow(s));
    sessionList.setItems(items);
    if (selectedIdx >= 0 && selectedIdx < items.length) {
      sessionList.select(selectedIdx);
    }
    sessionList.setLabel(` {cyan-fg}{bold}Sessions (${sessions.length}){/} `);
  }

  // ── Render detail (LAZY — only re-parse when selection changes) ─
  function renderDetail(force = false): void {
    if (sessions.length === 0 || selectedIdx < 0 || selectedIdx >= sessions.length) {
      detailBox.setContent('{gray-fg}No session selected{/}');
      lastDetailId = '';
      return;
    }
    const s = sessions[selectedIdx];
    // Skip if same session and not forced
    if (!force && s.id === lastDetailId) return;
    lastDetailId = s.id;

    const report = cacheDetail(cache, s);
    if (report) {
      detailBox.setContent(detailContent(report));
      detailBox.setLabel(` {cyan-fg}{bold}Detail — ${s.id.slice(0, 12)}…{/} `);
    } else {
      detailBox.setContent(`{gray-fg}Could not load report for ${s.id.slice(0, 8)}…{/}`);
    }
  }

  // ── Full render (uses cache — fast!) ───────────────────────────
  function render(): void {
    sessions = cacheSessions(cache, limit);
    procs = cacheProcs(cache);
    renderHeader();
    renderProcesses();
    renderSessions();
    renderDetail();
    screen.render();
  }

  // ── Force refresh (invalidate cache) ───────────────────────────
  function forceRefresh(): void {
    cache.sessionsTs = 0;
    cache.procsTs = 0;
    cache.details.clear();
    lastDetailId = '';
    render();
  }

  // ── Keyboard ───────────────────────────────────────────────────
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], () => forceRefresh());

  screen.key(['tab'], () => {
    if (focusedPanel === 'sessions') {
      focusedPanel = 'detail';
      detailBox.focus();
      sessionList.style.border.fg = BORDER_COLOR;
      detailBox.style.border.fg = ACCENT;
    } else {
      focusedPanel = 'sessions';
      sessionList.focus();
      sessionList.style.border.fg = ACCENT;
      detailBox.style.border.fg = BORDER_COLOR;
    }
    screen.render();
  });

  sessionList.on('select item', (_item: any, index: number) => {
    selectedIdx = index;
    renderDetail();
    screen.render();
  });

  sessionList.key(['up', 'k'], () => {
    if (selectedIdx > 0) {
      selectedIdx--;
      sessionList.select(selectedIdx);
      renderDetail();
      screen.render();
    }
  });

  sessionList.key(['down', 'j'], () => {
    if (selectedIdx < sessions.length - 1) {
      selectedIdx++;
      sessionList.select(selectedIdx);
      renderDetail();
      screen.render();
    }
  });

  sessionList.key(['enter'], () => {
    renderDetail(true); // force re-parse for fresh data
    focusedPanel = 'detail';
    detailBox.focus();
    sessionList.style.border.fg = BORDER_COLOR;
    detailBox.style.border.fg = ACCENT;
    screen.render();
  });

  // ── Start ──────────────────────────────────────────────────────
  sessionList.focus();
  sessionList.style.border.fg = ACCENT;
  render();

  // Auto-refresh timer
  const timer = setInterval(render, refreshSec * 1000);
  screen.on('destroy', () => clearInterval(timer));
}
