import type { Command } from 'commander';
import type { Session, SessionReport, FileChange } from '../lib/session.js';
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
    scrollable: true, keys: false, vi: false, mouse: true,
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
  const footerBox = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: '100%', height: 3,
    tags: true,
    style: { fg: MUTED, bg: '#161b22', border: { fg: BORDER_COLOR } },
    border: { type: 'line' },
    content: ' {bold}↑↓{/} Navigate  {bold}Enter{/} Detail  {bold}d{/} Diff  {bold}Tab{/} Switch  {bold}r{/} Refresh  {bold}q{/} Quit',
  });

  // ── Diff overlay panels (hidden by default) ────────────────────
  const diffFileList = blessed.list({
    parent: screen,
    top: 3, left: 0, width: '35%', bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Files Changed{/} ',
    scrollable: true, keys: false, vi: false, mouse: true,
    hidden: true,
    style: {
      fg: FG, bg: BG,
      border: { fg: BORDER_COLOR }, label: { fg: ACCENT },
      selected: { fg: '#ffffff', bg: '#1f6feb', bold: true },
      item: { fg: FG },
    },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
  });

  const diffContent = blessed.box({
    parent: screen,
    top: 3, left: '35%', width: '65%', bottom: 3,
    tags: true,
    label: ' {cyan-fg}{bold}Diff{/} ',
    scrollable: true, keys: true, vi: true, mouse: true,
    hidden: true,
    style: { fg: FG, bg: BG, border: { fg: BORDER_COLOR }, label: { fg: ACCENT } },
    border: { type: 'line' },
    scrollbar: { ch: '│', style: { fg: ACCENT } },
    content: '{gray-fg}Select a file to view diff{/}',
  });

  // ── UI State ───────────────────────────────────────────────────
  let selectedIdx = 0;
  let focusedPanel: 'sessions' | 'detail' = 'sessions';
  let diffMode = false;
  let diffChanges: FileChange[] = [];
  let diffFileIdx = 0;
  let diffFocused: 'files' | 'diff' = 'files';

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
    if (s) {
      // Show loading feedback immediately
      detailBox.setContent('{cyan-fg}Refreshing report…{/}');
      store.requestDetailNow(s.id, s.agent);
    }
    focusedPanel = 'detail';
    detailBox.focus();
    sessionList.style.border.fg = BORDER_COLOR;
    detailBox.style.border.fg = ACCENT;
    screen.render();
  });

  // ── Diff mode helpers ──────────────────────────────────────────

  function formatDiffContent(change: FileChange): string {
    const lines: string[] = [];
    const shortPath = change.path.split('/').slice(-3).join('/');
    const typeLabel = change.type === 'create'
      ? '{green-fg}{bold}NEW FILE{/}' : '{yellow-fg}{bold}EDITED{/}';
    lines.push(`${typeLabel}  {gray-fg}${shortPath}{/}`);
    lines.push('{gray-fg}' + '─'.repeat(60) + '{/}');
    lines.push('');

    if (change.type === 'create' && change.content) {
      for (const line of change.content.split('\n').slice(0, 200)) {
        lines.push(`{green-fg}+{/} ${line}`);
      }
      if (change.content.split('\n').length > 200) {
        lines.push('{gray-fg}… truncated{/}');
      }
    } else if (change.type === 'edit') {
      if (change.oldStr) {
        for (const line of change.oldStr.split('\n').slice(0, 100)) {
          lines.push(`{red-fg}-{/} {red-fg}${line}{/}`);
        }
      }
      if (change.oldStr && change.newStr) {
        lines.push('{gray-fg}' + '┄'.repeat(40) + '{/}');
      }
      if (change.newStr) {
        for (const line of change.newStr.split('\n').slice(0, 100)) {
          lines.push(`{green-fg}+{/} {green-fg}${line}{/}`);
        }
      }
      if (!change.oldStr && !change.newStr) {
        lines.push('{gray-fg}(no diff data){/}');
      }
    }
    return lines.join('\n');
  }

  function enterDiffMode(): void {
    const s = store.sessions[selectedIdx];
    if (!s) return;
    const report = store.details.get(s.id);
    if (!report || !report.fileChanges || report.fileChanges.length === 0) {
      detailBox.setContent('{yellow-fg}No file changes in this session{/}');
      screen.render();
      return;
    }

    diffMode = true;
    diffChanges = report.fileChanges;
    diffFileIdx = 0;
    diffFocused = 'files';

    // Hide main panels, show diff panels
    headerBox.hide();
    processBox.hide();
    sessionList.hide();
    detailBox.hide();
    diffFileList.show();
    diffContent.show();

    // Populate file list
    const items = diffChanges.map((c, i) => {
      const icon = c.type === 'create' ? '{green-fg}+{/}' : '{yellow-fg}~{/}';
      const short = c.path.split('/').slice(-2).join('/');
      return ` ${icon} ${short}`;
    });
    diffFileList.setItems(items);
    diffFileList.select(0);
    diffFileList.setLabel(` {cyan-fg}{bold}Files (${diffChanges.length}){/} `);
    diffFileList.style.border.fg = ACCENT;
    diffContent.style.border.fg = BORDER_COLOR;

    // Show first file diff
    diffContent.setContent(formatDiffContent(diffChanges[0]));
    diffContent.setLabel(` {cyan-fg}{bold}Diff{/} `);
    diffContent.setScrollPerc(0);

    footerBox.setContent(' {bold}↑↓{/} Select file  {bold}Tab{/} Switch  {bold}Esc{/} Back  {bold}q{/} Quit');

    diffFileList.focus();
    screen.render();
  }

  function exitDiffMode(): void {
    diffMode = false;
    diffChanges = [];

    diffFileList.hide();
    diffContent.hide();
    headerBox.show();
    processBox.show();
    sessionList.show();
    detailBox.show();

    footerBox.setContent(' {bold}↑↓{/} Navigate  {bold}Enter{/} Detail  {bold}d{/} Diff  {bold}Tab{/} Switch  {bold}r{/} Refresh  {bold}q{/} Quit');

    focusedPanel = 'sessions';
    sessionList.focus();
    sessionList.style.border.fg = ACCENT;
    detailBox.style.border.fg = BORDER_COLOR;
    screen.render();
  }

  function diffNavigate(): void {
    diffFileList.select(diffFileIdx);
    if (diffChanges[diffFileIdx]) {
      diffContent.setContent(formatDiffContent(diffChanges[diffFileIdx]));
      diffContent.setScrollPerc(0);
    }
    screen.render();
  }

  // ── Diff mode keyboard ─────────────────────────────────────────

  screen.key(['d'], () => {
    if (!diffMode) enterDiffMode();
  });

  screen.key(['escape'], () => {
    if (diffMode) exitDiffMode();
  });

  diffFileList.key(['up', 'k'], () => {
    if (diffFileIdx > 0) { diffFileIdx--; diffNavigate(); }
  });

  diffFileList.key(['down', 'j'], () => {
    if (diffFileIdx < diffChanges.length - 1) { diffFileIdx++; diffNavigate(); }
  });

  diffFileList.key(['tab'], () => {
    diffFocused = 'diff';
    diffContent.focus();
    diffFileList.style.border.fg = BORDER_COLOR;
    diffContent.style.border.fg = ACCENT;
    screen.render();
  });

  diffContent.key(['tab'], () => {
    diffFocused = 'files';
    diffFileList.focus();
    diffFileList.style.border.fg = ACCENT;
    diffContent.style.border.fg = BORDER_COLOR;
    screen.render();
  });

  diffFileList.on('select item', (_item: any, index: number) => {
    diffFileIdx = index;
    diffNavigate();
  });

  // ── Start reactive data loops ──────────────────────────────────
  sessionList.focus();
  sessionList.style.border.fg = ACCENT;
  store.start(refreshSec * 1000, 3000);
}
