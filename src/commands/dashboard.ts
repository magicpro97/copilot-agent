import type { Command } from 'commander';
import { listAllSessions, getAgentSessionReport, type SessionReport, type Session } from '../lib/session.js';
import { findAgentProcesses, type CopilotProcess } from '../lib/process.js';
import { BOLD, CYAN, DIM, GREEN, YELLOW, RED, RESET } from '../lib/colors.js';

const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('tui')
    .description('Real-time terminal dashboard for copilot sessions')
    .option('-r, --refresh <n>', 'Refresh interval in seconds', '5')
    .option('-l, --limit <n>', 'Number of sessions to show', '8')
    .action((opts) => {
      runDashboard(parseInt(opts.refresh, 10), parseInt(opts.limit, 10));
    });
}

function runDashboard(refreshSec: number, limit: number): void {
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
      const output = buildScreen(limit);
      process.stdout.write(CLEAR + output);
    } catch {
      // ignore render errors
    }
  };

  render();
  const timer = setInterval(render, refreshSec * 1000);

  // Handle terminal resize
  process.stdout.on('resize', render);

  // Keep alive
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    const key = data.toString();
    if (key === 'q' || key === '\x03') {
      clearInterval(timer);
      cleanup();
    }
    if (key === 'r') render();
  });
}

function buildScreen(limit: number): string {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 40;
  const lines: string[] = [];

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB');

  // Header
  lines.push('');
  lines.push(`  ${BOLD}${CYAN}┌${'─'.repeat(cols - 6)}┐${RESET}`);
  lines.push(`  ${BOLD}${CYAN}│${RESET}  🤖 ${BOLD}Copilot Agent Dashboard${RESET}${' '.repeat(Math.max(0, cols - 37 - timeStr.length))}${DIM}${timeStr}${RESET}  ${BOLD}${CYAN}│${RESET}`);
  lines.push(`  ${BOLD}${CYAN}└${'─'.repeat(cols - 6)}┘${RESET}`);
  lines.push('');

  // Active processes
  const procs = findAgentProcesses();
  lines.push(`  ${BOLD}${GREEN}● Active Processes (${procs.length})${RESET}`);
  lines.push(`  ${'─'.repeat(Math.min(cols - 4, 70))}`);

  if (procs.length === 0) {
    lines.push(`  ${DIM}No agent processes running${RESET}`);
  } else {
    for (const p of procs) {
      const agentTag = p.agent === 'claude' ? `${CYAN}[claude]${RESET}` : `${GREEN}[copilot]${RESET}`;
      const sid = p.sessionId ? p.sessionId.slice(0, 8) + '…' : '—';
      const cwdShort = p.cwd ? '~/' + p.cwd.split('/').slice(-2).join('/') : '—';
      lines.push(`  ${GREEN}⬤${RESET} ${agentTag} PID ${BOLD}${p.pid}${RESET}  ${CYAN}${sid}${RESET}  ${DIM}${cwdShort}${RESET}`);
    }
  }
  lines.push('');

  // Recent sessions
  const sessions = listAllSessions(limit);
  lines.push(`  ${BOLD}${CYAN}● Recent Sessions (${sessions.length})${RESET}`);
  lines.push(`  ${'─'.repeat(Math.min(cols - 4, 70))}`);

  // Table header
  const headerCols = [
    pad('Status', 10),
    pad('Premium', 8),
    pad('Duration', 10),
    pad('Project', 18),
    pad('Last Activity', 20),
  ];
  lines.push(`  ${DIM}${headerCols.join(' ')}${RESET}`);

  for (const s of sessions) {
    const report = getAgentSessionReport(s.id, s.agent);
    const statusIcon = s.complete
      ? `${GREEN}✔ done  ${RESET}`
      : `${YELLOW}⏸ stop  ${RESET}`;
    const premium = pad(String(s.premiumRequests), 8);
    const duration = report ? pad(formatDuration(report.durationMs), 10) : pad('—', 10);
    const project = pad(s.cwd.split('/').pop() ?? '—', 18);
    const lastAct = pad(formatTimeAgo(s.mtime), 20);

    lines.push(`  ${statusIcon}${premium}${duration}${project}${lastAct}`);
  }
  lines.push('');

  // Latest session detail panel
  if (sessions.length > 0) {
    const latest = getAgentSessionReport(sessions[0].id, sessions[0].agent);
    if (latest) {
      lines.push(`  ${BOLD}${CYAN}● Latest Session Detail${RESET}  ${DIM}${latest.id.slice(0, 8)}…${RESET}`);
      lines.push(`  ${'─'.repeat(Math.min(cols - 4, 70))}`);

      // Mini stats row
      lines.push(`  Turns: ${BOLD}${latest.assistantTurns}${RESET}  Tokens: ${BOLD}${latest.outputTokens.toLocaleString()}${RESET}  Premium: ${BOLD}${latest.premiumRequests}${RESET}  Commits: ${BOLD}${latest.gitCommits.length}${RESET}  Files: ${BOLD}${latest.filesEdited.length}${RESET} edited, ${BOLD}${latest.filesCreated.length}${RESET} created`);
      lines.push('');

      // Top tools mini chart
      const toolEntries = Object.entries(latest.toolUsage).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (toolEntries.length > 0) {
        const maxVal = toolEntries[0][1];
        const barW = Math.min(20, Math.floor((cols - 30) / 2));
        lines.push(`  ${DIM}Tools:${RESET}`);
        for (const [tool, count] of toolEntries) {
          const filled = Math.round((count / maxVal) * barW);
          const b = `${CYAN}${'█'.repeat(filled)}${DIM}${'░'.repeat(barW - filled)}${RESET}`;
          lines.push(`  ${b} ${String(count).padStart(4)} ${tool}`);
        }
        lines.push('');
      }

      // Recent commits
      if (latest.gitCommits.length > 0) {
        const maxCommits = Math.min(3, latest.gitCommits.length);
        lines.push(`  ${DIM}Recent commits:${RESET}`);
        for (let i = 0; i < maxCommits; i++) {
          const msg = latest.gitCommits[i].split('\n')[0].slice(0, cols - 10);
          lines.push(`  ${GREEN}●${RESET} ${msg}`);
        }
        if (latest.gitCommits.length > maxCommits) {
          lines.push(`  ${DIM}  … +${latest.gitCommits.length - maxCommits} more${RESET}`);
        }
        lines.push('');
      }

      // Recent task completions
      if (latest.taskCompletions.length > 0) {
        const maxTasks = Math.min(3, latest.taskCompletions.length);
        lines.push(`  ${DIM}Completed tasks:${RESET}`);
        for (let i = 0; i < maxTasks; i++) {
          const msg = latest.taskCompletions[i].split('\n')[0].slice(0, cols - 10);
          lines.push(`  ${GREEN}✔${RESET} ${msg}`);
        }
        if (latest.taskCompletions.length > maxTasks) {
          lines.push(`  ${DIM}  … +${latest.taskCompletions.length - maxTasks} more${RESET}`);
        }
      }
    }
  }

  // Footer
  lines.push('');
  lines.push(`  ${DIM}Press ${BOLD}q${RESET}${DIM} to quit, ${BOLD}r${RESET}${DIM} to refresh${RESET}`);

  return lines.join('\n');
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function formatTimeAgo(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
