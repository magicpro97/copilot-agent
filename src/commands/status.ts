import type { Command } from 'commander';
import {
  listSessions,
  hasTaskComplete,
  getLastEvent,
  getSessionPremium,
} from '../lib/session.js';
import { findCopilotProcesses } from '../lib/process.js';
import { log } from '../lib/logger.js';
import { BOLD, CYAN, DIM, GREEN, YELLOW, RESET } from '../lib/colors.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show copilot session status')
    .option('-l, --limit <n>', 'Number of sessions to show', '10')
    .option('-a, --active', 'Show only active (running) processes')
    .option('-i, --incomplete', 'Only show incomplete sessions')
    .action((opts) => {
      if (opts.active) {
        showActive();
      } else {
        showRecent(parseInt(opts.limit, 10), opts.incomplete ?? false);
      }
    });
}

function showActive(): void {
  const procs = findCopilotProcesses();
  if (procs.length === 0) {
    log(`${DIM}No active copilot processes.${RESET}`);
    return;
  }

  log(`\n${BOLD}${'PID'.padEnd(8)} ${'Session'.padEnd(40)} Command${RESET}`);
  log('─'.repeat(108));

  for (const p of procs) {
    log(
      `${CYAN}${String(p.pid).padEnd(8)}${RESET} ${(p.sessionId ?? '—').padEnd(40)} ${truncate(p.command, 58)}`,
    );
  }
  log('');
}

function showRecent(limit: number, incompleteOnly: boolean): void {
  let sessions = listSessions(limit);
  if (incompleteOnly) {
    sessions = sessions.filter(s => !s.complete);
  }

  if (sessions.length === 0) {
    log(`${DIM}No sessions found.${RESET}`);
    return;
  }

  log(
    `\n${BOLD}${'Status'.padEnd(10)} ${'Premium'.padEnd(10)} ${'Last Event'.padEnd(25)} ${'Summary'.padEnd(40)} ID${RESET}`,
  );
  log('─'.repeat(120));

  for (const s of sessions) {
    const status = s.complete
      ? `${GREEN}✔ done${RESET}`
      : `${YELLOW}⏸ stop${RESET}`;
    const premium = String(s.premiumRequests);
    const summary = truncate(s.summary || '—', 38);

    log(
      `${status.padEnd(10 + 9)} ${premium.padEnd(10)} ${s.lastEvent.padEnd(25)} ${summary.padEnd(40)} ${DIM}${s.id}${RESET}`,
    );
  }
  log(`\n${DIM}Total: ${sessions.length} session(s)${RESET}`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + '…';
}
