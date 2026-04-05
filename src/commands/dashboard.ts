import type { Command } from 'commander';
import type { Session, SessionReport } from '../lib/session.js';
import { DashboardStore, type ProcessInfo } from '../lib/reactive.js';
import {
  agentLabel, statusIcon, fmtDuration, fmtTimeAgo, fmtNumber,
  textBar, sessionRow, processRow, detailContent, headerStats,
  toolBars,
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
    .option('-r, --refresh <n>', 'Session refresh interval in seconds', '2')
    .option('-l, --limit <n>', 'Number of sessions to show', '20')
    .action(async (opts) => {
      await loadBlessed();
      runReactiveDashboard(parseInt(opts.refresh, 10), parseInt(opts.limit, 10));
    });
}

// ══════════════════════════════════════════════════════════════════
// REACTIVE BLESSED DASHBOARD
// ══════════════════════════════════════════════════════════════════

function runReactiveDashboard(refreshSec: number, limit: number): void {
  // ── Reactive data store (all I/O is async) ─────────────────────
  const store = new DashboardStore(limit);

  // Workaround: blessed can't parse Setulc capability in xterm-256color terminfo.
  const origTerm = process.env.TERM;
  if (origTerm?.includes('256color')) {
    process.env.TERM = 'xterm';
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: 'copilot-agent dashboard',
    fullUnicode: true,
  });

  if (origTerm) process.env.TERM = origTerm;

  // ── Color constants ────────────────────────────────────────────
  const BG = '#0d1117';
  const FG = '#e6edf3';
  const BORDER_COLOR = '#30363d';
  const ACCENT = '#58a6ff';
  const MUTED = '#8b949e';

  // ── Header bar ─────────────────────────────────────────────────
  const headerBox = blessed.box({
    parent: screen,
    top: 0, left: 0, width: '100%', height: 3,
    tags: true,
    style: { fg: FG, bg: '#161b22', border: { fg: BORDER_COLOR } },
    border: { type: 'line' },
  });

  // ── Process panel ──────────────────────────────────────────────
  const processBox = blessed.box({
    parent: screen,
    top: 3, left: 0, width: '100%', height: 7,
    tags: true,
    label: ' {cyan-fg}{bold}Active Processes{/} ',
    scrollable: true,
    style: { fg: FG, bg: BG, border: { fg: BORDER_COLOR }, label: { fg: ACCENT } },
    border: { type: 'line' },
  });

  // ── Session list (left) ────────────────────────────────────────
  const sessionList = blessed.list({
    parent: screen,
    top: 10, left: 0, width: '45%', bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Sessions{/} ',
    scrollable: true, keys: true, vi: true, mouse: true,
    style: {
      fg: FG, bg: BG,
      border: { fg: BORDER_COLOR }, label: { fg: ACCENT },
      selected: { fg: '#ffffff', bg: '#1f6feb', bold: true },
      item: { fg: FG },
    },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
  });

  // ── Detail panel (right) ───────────────────────────────────────
  const detailBox = blessed.box({
    parent: screen,
    top: 10, left: '45%', width: '55%', bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Detail{/} ',
    scrollable: true, keys: true, vi: true, mouse: true,
    style: { fg: FG, bg: BG, border: { fg: BORDER_COLOR }, label: { fg: ACCENT } },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
    content: '{gray-fg}Select a session with ↑↓ keys{/}',
  });

  // ── Footer ─────────────────────────────────────────────────────
  blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: '100%', height: 3,
    tags: true,
    style: { fg: MUTED, bg: '#161b22', border: { fg: BORDER_COLOR } },
    border: { type: 'line' },
    content: ' {bold}↑↓{/} Navigate  {bold}Enter{/} Detail  {bold}Tab{/} Switch panel  {bold}r{/} Refresh  {bold}q{/} Quit',
  });

  // ── UI State ───────────────────────────────────────────────────
  let selectedIdx = 0;
  let focusedPanel: 'sessions' | 'detail' = 'sessions';

  // ── Render helpers (pure formatting, no I/O) ───────────────────

  function renderHeader(): void {
    const time = new Date().toLocaleTimeString('en-GB');
    const sessions = store.sessions;
    const totalPremium = sessions.reduce((s, x) => s + x.premiumRequests, 0);
    const completedCount = sessions.filter(s => s.complete).length;
    const stats = headerStats(store.processes.length, sessions.length, totalPremium, completedCount);
    headerBox.setContent(` {bold}{cyan-fg}⚡ copilot-agent{/}  ${stats}  {gray-fg}${time}{/}`);
  }

  function renderProcesses(): void {
    const procs = store.processes;
    if (procs.length === 0) {
      processBox.setContent(' {gray-fg}No agent processes running{/}');
      return;
    }
    const header = ` ${'PID'.padEnd(7)} ${'Agent'.padEnd(10)} ${'Session'.padEnd(20)} ${'Directory'.padEnd(30)} Status`;
    const rows = procs.map(p => processRow(p as any));
    processBox.setContent(`{gray-fg}${header}{/}\n${rows.join('\n')}`);
  }

  function renderSessions(): void {
    const items = store.sessions.map(s => sessionRow(s));
    sessionList.setItems(items);
    if (selectedIdx >= 0 && selectedIdx < items.length) {
      sessionList.select(selectedIdx);
    }
    sessionList.setLabel(` {cyan-fg}{bold}Sessions (${store.sessions.length}){/} `);
  }

  function showQuickPreview(s: Session): void {
    const project = s.cwd?.split('/').pop() || s.id.slice(0, 12);
    const agent = s.agent === 'claude' ? '{yellow-fg}claude{/}' : '{cyan-fg}copilot{/}';
    const status = s.complete ? '{green-fg}✔ complete{/}' : '{yellow-fg}⏳ incomplete{/}';
    detailBox.setContent([
      `{bold}${project}{/}  ${agent}`,
      `{gray-fg}${s.id}{/}`,
      '',
      ` Status     ${status}`,
      ` Premium    {yellow-fg}${s.premiumRequests}{/}`,
      ` Activity   ${fmtTimeAgo(s.mtime)}`,
      ` Directory  {gray-fg}${s.cwd || '—'}{/}`,
      '',
      '{gray-fg}Loading…{/}',
    ].join('\n'));
    detailBox.setLabel(` {cyan-fg}{bold}Detail — ${s.id.slice(0, 12)}…{/} `);
  }

  // ── Subscribe to store events (reactive rendering) ─────────────

  store.on('sessions', () => {
    renderHeader();
    renderSessions();
    // Request detail for currently selected session
    const s = store.sessions[selectedIdx];
    if (s) store.requestDetail(s.id, s.agent);
    screen.render();
  });

  store.on('processes', () => {
    renderHeader();
    renderProcesses();
    screen.render();
  });

  store.on('detail', (sessionId: string) => {
    // Only update detail panel if it's still the selected session
    const currentSession = store.sessions[selectedIdx];
    if (!currentSession || currentSession.id !== sessionId) return;
    const report = store.details.get(sessionId);
    if (report) {
      detailBox.setContent(detailContent(report));
      detailBox.setLabel(` {cyan-fg}{bold}Detail — ${sessionId.slice(0, 12)}…{/} `);
    } else {
      detailBox.setContent(`{gray-fg}No report data for ${sessionId.slice(0, 8)}…{/}`);
    }
    screen.render();
  });

  // Clock update (header only — very cheap)
  const clockTimer = setInterval(() => {
    renderHeader();
    screen.render();
  }, 5000);

  // ── Keyboard (only UI state changes, no I/O) ──────────────────

  screen.key(['q', 'C-c'], () => {
    store.stop();
    clearInterval(clockTimer);
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], () => store.forceRefresh());

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

  // Arrow keys: instant list update + async detail request
  function onNavigate(): void {
    sessionList.select(selectedIdx);
    const s = store.sessions[selectedIdx];
    if (s) {
      // Show cached report instantly, or quick preview + async load
      const cached = store.details.get(s.id);
      if (cached) {
        detailBox.setContent(detailContent(cached));
        detailBox.setLabel(` {cyan-fg}{bold}Detail — ${s.id.slice(0, 12)}…{/} `);
      } else {
        showQuickPreview(s);
      }
      store.requestDetail(s.id, s.agent);
    }
    screen.render();
  }

  sessionList.on('select item', (_item: any, index: number) => {
    selectedIdx = index;
    onNavigate();
  });

  sessionList.key(['up', 'k'], () => {
    if (selectedIdx > 0) { selectedIdx--; onNavigate(); }
  });

  sessionList.key(['down', 'j'], () => {
    if (selectedIdx < store.sessions.length - 1) { selectedIdx++; onNavigate(); }
  });

  sessionList.key(['enter'], () => {
    const s = store.sessions[selectedIdx];
    if (s) store.requestDetailNow(s.id, s.agent);
    focusedPanel = 'detail';
    detailBox.focus();
    sessionList.style.border.fg = BORDER_COLOR;
    detailBox.style.border.fg = ACCENT;
    screen.render();
  });

  // ── Start reactive data loops ──────────────────────────────────
  sessionList.focus();
  sessionList.style.border.fg = ACCENT;
  store.start(refreshSec * 1000, 3000);
}
