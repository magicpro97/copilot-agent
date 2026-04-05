import type { Command } from 'commander';
import { resolve } from 'node:path';
import {
  listAllSessions,
  getAgentSessionReport,
  type SessionReport,
} from '../lib/session.js';
import { log, warn, fail } from '../lib/logger.js';
import { BOLD, CYAN, DIM, GREEN, YELLOW, RED, RESET } from '../lib/colors.js';

export function registerReportCommand(program: Command): void {
  program
    .command('report [session-id]')
    .description('Show what an agent did — timeline, tools, commits, files changed')
    .option('-l, --limit <n>', 'Number of recent sessions to report (when no ID given)', '1')
    .option('--project <dir>', 'Filter sessions by project directory')
    .option('--json', 'Output raw JSON')
    .option('-a, --agent <type>', 'Filter by agent: copilot or claude')
    .action((sessionId: string | undefined, opts) => {
      try {
        if (sessionId) {
          reportSingle(sessionId, opts.json ?? false, opts.agent);
        } else {
          reportRecent(parseInt(opts.limit, 10), opts.project, opts.json ?? false, opts.agent);
        }
      } catch (err) {
        fail(`Report error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

function reportRecent(limit: number, projectDir?: string, json = false, agentFilter?: string): void {
  let sessions = listAllSessions(limit * 3, agentFilter as any);
  if (projectDir) {
    const target = resolve(projectDir);
    sessions = sessions.filter(s => s.cwd && resolve(s.cwd) === target);
  }
  sessions = sessions.slice(0, limit);

  if (sessions.length === 0) {
    warn('No sessions found.');
    return;
  }

  for (const s of sessions) {
    reportSingle(s.id, json, s.agent);
  }
}

function reportSingle(sid: string, json = false, agent?: string): void {
  const report = getAgentSessionReport(sid, agent as any);
  if (!report) {
    warn(`Session ${sid} not found or invalid.`);
    return;
  }

  if (json) {
    log(JSON.stringify(report, null, 2));
    return;
  }

  renderReport(report);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((value / Math.max(max, 1)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function renderReport(r: SessionReport): void {
  const status = r.complete
    ? `${GREEN}✔ Completed${RESET}`
    : `${YELLOW}⏸ Interrupted${RESET}`;

  const projectName = r.cwd.split('/').pop() ?? r.cwd;

  log('');
  log(`${BOLD}╔${'═'.repeat(62)}╗${RESET}`);
  log(`${BOLD}║${RESET}  📋 Session Report: ${CYAN}${r.id.slice(0, 8)}…${RESET} (${r.agent})${' '.repeat(Math.max(0, 62 - 32 - r.id.slice(0, 8).length - r.agent.length))}${BOLD}║${RESET}`);
  log(`${BOLD}╚${'═'.repeat(62)}╝${RESET}`);

  // Overview
  log('');
  log(`${BOLD}  Overview${RESET}`);
  log(`  ${'─'.repeat(58)}`);
  log(`  Project:   ${CYAN}${projectName}${RESET}  ${DIM}${r.cwd}${RESET}`);
  log(`  Status:    ${status}`);
  log(`  Duration:  ${BOLD}${formatDuration(r.durationMs)}${RESET}  ${DIM}(${formatTime(r.startTime)} → ${formatTime(r.endTime)})${RESET}`);
  log(`  Summary:   ${r.summary || DIM + '(none)' + RESET}`);

  // Stats
  log('');
  log(`${BOLD}  Activity${RESET}`);
  log(`  ${'─'.repeat(58)}`);
  log(`  User messages:    ${BOLD}${r.userMessages}${RESET}`);
  log(`  Assistant turns:  ${BOLD}${r.assistantTurns}${RESET}`);
  log(`  Output tokens:    ${BOLD}${r.outputTokens.toLocaleString()}${RESET}`);
  log(`  Premium requests: ${BOLD}${r.premiumRequests}${RESET}`);
  log(`  Tool calls:       ${BOLD}${Object.values(r.toolUsage).reduce((a, b) => a + b, 0)}${RESET}`);

  // Tools breakdown
  const toolEntries = Object.entries(r.toolUsage).sort((a, b) => b[1] - a[1]);
  if (toolEntries.length > 0) {
    const maxCount = toolEntries[0][1];
    log('');
    log(`${BOLD}  Tools Used${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const [tool, count] of toolEntries.slice(0, 10)) {
      const barStr = bar(count, maxCount, 15);
      log(`  ${DIM}${barStr}${RESET} ${String(count).padStart(5)} ${tool}`);
    }
    if (toolEntries.length > 10) {
      log(`  ${DIM}  … and ${toolEntries.length - 10} more tools${RESET}`);
    }
  }

  // Git commits
  if (r.gitCommits.length > 0) {
    log('');
    log(`${BOLD}  Git Commits (${r.gitCommits.length})${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const msg of r.gitCommits) {
      log(`  ${GREEN}●${RESET} ${msg.slice(0, 70)}${msg.length > 70 ? '…' : ''}`);
    }
  }

  // Files created
  if (r.filesCreated.length > 0) {
    log('');
    log(`${BOLD}  Files Created (${r.filesCreated.length})${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const f of r.filesCreated.slice(0, 15)) {
      const short = f.includes(projectName) ? f.split(projectName + '/')[1] ?? f : f;
      log(`  ${GREEN}+${RESET} ${short}`);
    }
    if (r.filesCreated.length > 15) {
      log(`  ${DIM}  … and ${r.filesCreated.length - 15} more${RESET}`);
    }
  }

  // Files edited
  if (r.filesEdited.length > 0) {
    log('');
    log(`${BOLD}  Files Edited (${r.filesEdited.length})${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const f of r.filesEdited.slice(0, 15)) {
      const short = f.includes(projectName) ? f.split(projectName + '/')[1] ?? f : f;
      log(`  ${YELLOW}~${RESET} ${short}`);
    }
    if (r.filesEdited.length > 15) {
      log(`  ${DIM}  … and ${r.filesEdited.length - 15} more${RESET}`);
    }
  }

  // Task completions
  if (r.taskCompletions.length > 0) {
    log('');
    log(`${BOLD}  Tasks Completed (${r.taskCompletions.length})${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const t of r.taskCompletions) {
      const lines = t.split('\n');
      const first = lines[0].slice(0, 70);
      log(`  ${GREEN}✔${RESET} ${first}${first.length < lines[0].length ? '…' : ''}`);
    }
  }

  // Errors
  if (r.errors.length > 0) {
    log('');
    log(`${BOLD}  Errors (${r.errors.length})${RESET}`);
    log(`  ${'─'.repeat(58)}`);
    for (const e of r.errors.slice(0, 5)) {
      log(`  ${RED}✖${RESET} ${e.slice(0, 70)}`);
    }
    if (r.errors.length > 5) {
      log(`  ${DIM}  … and ${r.errors.length - 5} more${RESET}`);
    }
  }

  log('');
}
