import type { Command } from 'commander';
import { listAllSessions, getAgentSessionReport, type SessionReport, type Session } from '../lib/session.js';
import { findAgentProcesses, type CopilotProcess } from '../lib/process.js';
import { BOLD, CYAN, DIM, GREEN, YELLOW, RED, RESET } from '../lib/colors.js';
import {
  agentLabel, statusIcon, fmtDuration, fmtTimeAgo, fmtNumber,
  textBar, sessionRow, processRow, detailContent, headerStats,
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
    .option('--simple', 'Use simple ANSI dashboard (no blessed)')
    .action(async (opts) => {
      if (opts.simple) {
        runSimpleDashboard(parseInt(opts.refresh, 10), parseInt(opts.limit, 10));
      } else {
        await loadBlessed();
        runBlessedDashboard(parseInt(opts.refresh, 10), parseInt(opts.limit, 10));
      }
    });
}

// ══════════════════════════════════════════════════════════════════
// BLESSED HTOP-STYLE DASHBOARD
// ══════════════════════════════════════════════════════════════════

function runBlessedDashboard(refreshSec: number, limit: number): void {
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

  // ── Data refresh ───────────────────────────────────────────────
  function refreshData(): void {
    try {
      procs = findAgentProcesses() as ProcessInfo[];
      sessions = listAllSessions(limit);
    } catch {
      // ignore errors during refresh
    }
  }

  // ── Render header ──────────────────────────────────────────────
  function renderHeader(): void {
    const time = new Date().toLocaleTimeString('en-GB');
    const totalPremium = sessions.reduce((s, x) => s + x.premiumRequests, 0);
    const completedCount = sessions.filter(s => s.complete).length;
    const stats = headerStats(procs.length, sessions.length, totalPremium, completedCount);
    headerBox.setContent(` {bold}{cyan-fg}⚡ copilot-agent{/}  ${stats}  {gray-fg}${time}{/}`);
  }

  // ── Render processes ───────────────────────────────────────────
  function renderProcesses(): void {
    if (procs.length === 0) {
      processBox.setContent(' {gray-fg}No agent processes running{/}');
      return;
    }
    const header = ` ${'PID'.padEnd(7)} ${'Agent'.padEnd(10)} ${'Session'.padEnd(20)} ${'Directory'.padEnd(30)} Status`;
    const rows = procs.map(p => processRow(p));
    processBox.setContent(`{gray-fg}${header}{/}\n${rows.join('\n')}`);
  }

  // ── Render session list ────────────────────────────────────────
  function renderSessions(): void {
    const items = sessions.map(s => sessionRow(s));
    sessionList.setItems(items);
    if (selectedIdx >= 0 && selectedIdx < items.length) {
      sessionList.select(selectedIdx);
    }
    sessionList.setLabel(` {cyan-fg}{bold}Sessions (${sessions.length}){/} `);
  }

  // ── Render detail panel ────────────────────────────────────────
  function renderDetail(): void {
    if (sessions.length === 0 || selectedIdx < 0 || selectedIdx >= sessions.length) {
      detailBox.setContent('{gray-fg}No session selected{/}');
      return;
    }
    const s = sessions[selectedIdx];
    try {
      const report = getAgentSessionReport(s.id, s.agent);
      if (report) {
        detailBox.setContent(detailContent(report));
        detailBox.setLabel(` {cyan-fg}{bold}Detail — ${s.id.slice(0, 12)}…{/} `);
      } else {
        detailBox.setContent(`{gray-fg}Could not load report for ${s.id.slice(0, 8)}…{/}`);
      }
    } catch {
      detailBox.setContent('{red-fg}Error loading session detail{/}');
    }
  }

  // ── Full render ────────────────────────────────────────────────
  function render(): void {
    refreshData();
    renderHeader();
    renderProcesses();
    renderSessions();
    renderDetail();
    screen.render();
  }

  // ── Keyboard ───────────────────────────────────────────────────
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.key(['r'], () => render());

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
    renderDetail();
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

// ══════════════════════════════════════════════════════════════════
// SIMPLE ANSI DASHBOARD (fallback with --simple)
// ══════════════════════════════════════════════════════════════════

const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

function runSimpleDashboard(refreshSec: number, limit: number): void {
  process.stdout.write(HIDE_CURSOR);

  const cleanup = () => {
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write(CLEAR);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const render = () => {
    try {
      const output = buildSimpleScreen(limit);
      process.stdout.write(CLEAR + output);
    } catch {
      // ignore render errors
    }
  };

  render();
  setInterval(render, refreshSec * 1000);

  process.stdout.on('resize', render);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    const key = data.toString();
    if (key === 'q' || key === '\x03') cleanup();
    if (key === 'r') render();
  });
}

function buildSimpleScreen(limit: number): string {
  const cols = process.stdout.columns || 80;
  const lines: string[] = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB');

  lines.push('');
  lines.push(`  ${BOLD}${CYAN}┌${'─'.repeat(cols - 6)}┐${RESET}`);
  lines.push(`  ${BOLD}${CYAN}│${RESET}  ⚡ ${BOLD}Copilot Agent Dashboard${RESET}${' '.repeat(Math.max(0, cols - 37 - timeStr.length))}${DIM}${timeStr}${RESET}  ${BOLD}${CYAN}│${RESET}`);
  lines.push(`  ${BOLD}${CYAN}└${'─'.repeat(cols - 6)}┘${RESET}`);
  lines.push('');

  const procs = findAgentProcesses();
  lines.push(`  ${BOLD}${GREEN}● Active Processes (${procs.length})${RESET}`);
  lines.push(`  ${'─'.repeat(Math.min(cols - 4, 70))}`);

  if (procs.length === 0) {
    lines.push(`  ${DIM}No agent processes running${RESET}`);
  } else {
    for (const p of procs) {
      const agentTag = p.agent === 'claude' ? `${YELLOW}[claude]${RESET}` : `${CYAN}[copilot]${RESET}`;
      const sid = p.sessionId ? p.sessionId.slice(0, 8) + '…' : '—';
      const cwdShort = p.cwd ? '~/' + p.cwd.split('/').slice(-2).join('/') : '—';
      lines.push(`  ${GREEN}⬤${RESET} ${agentTag} PID ${BOLD}${p.pid}${RESET}  ${CYAN}${sid}${RESET}  ${DIM}${cwdShort}${RESET}`);
    }
  }
  lines.push('');

  const sessions = listAllSessions(limit);
  lines.push(`  ${BOLD}${CYAN}● Recent Sessions (${sessions.length})${RESET}`);
  lines.push(`  ${'─'.repeat(Math.min(cols - 4, 70))}`);

  const hdr = [pad('Status', 10), pad('Agent', 8), pad('Premium', 8), pad('Project', 18), pad('Last Activity', 14)];
  lines.push(`  ${DIM}${hdr.join(' ')}${RESET}`);

  for (const s of sessions) {
    const icon = s.complete ? `${GREEN}✔ done  ${RESET}` : `${YELLOW}⏸ stop  ${RESET}`;
    const agent = s.agent === 'claude' ? `${YELLOW}claude ${RESET}` : `${CYAN}copilot${RESET}`;
    const prem = pad(String(s.premiumRequests), 8);
    const proj = pad(s.cwd.split('/').pop() ?? '—', 18);
    const ago = pad(fmtTimeAgo(s.mtime), 14);
    lines.push(`  ${icon}${agent} ${prem}${proj}${ago}`);
  }
  lines.push('');
  lines.push(`  ${DIM}Press ${BOLD}q${RESET}${DIM} to quit, ${BOLD}r${RESET}${DIM} to refresh${RESET}`);

  return lines.join('\n');
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}
