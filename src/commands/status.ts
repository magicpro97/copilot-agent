import type { Command } from 'commander';
import {
  listAllSessions,
} from '../lib/session.js';
import { findAgentProcesses } from '../lib/process.js';
import { resolveAgent, type AgentType } from '../lib/provider.js';
import { log } from '../lib/logger.js';
import { BOLD, CYAN, DIM, GREEN, YELLOW, RESET } from '../lib/colors.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show agent session status (copilot + claude)')
    .option('-l, --limit <n>', 'Number of sessions to show', '10')
    .option('-a, --active', 'Show only active (running) processes')
    .option('-i, --incomplete', 'Only show incomplete sessions')
    .option('--agent <type>', 'Filter by agent: copilot or claude')
    .action((opts) => {
      const agentFilter = opts.agent as AgentType | undefined;
      if (opts.active) {
        showActive(agentFilter);
      } else {
        showRecent(parseInt(opts.limit, 10), opts.incomplete ?? false, agentFilter);
      }
    });
}

function showActive(agentFilter?: AgentType): void {
  const procs = findAgentProcesses(agentFilter);
  if (procs.length === 0) {
    log(`${DIM}No active agent processes.${RESET}`);
    return;
  }

  log(`\n${BOLD}${'Agent'.padEnd(9)} ${'PID'.padEnd(8)} ${'Session'.padEnd(40)} Command${RESET}`);
  log('─'.repeat(118));

  for (const p of procs) {
    const agentLabel = p.agent === 'claude' ? `${CYAN}claude${RESET} ` : `${GREEN}copilot${RESET}`;
    log(
      `${agentLabel.padEnd(9 + 9)} ${String(p.pid).padEnd(8)} ${(p.sessionId ?? '—').padEnd(40)} ${truncate(p.command, 50)}`,
    );
  }
  log('');
}

function showRecent(limit: number, incompleteOnly: boolean, agentFilter?: AgentType): void {
  let sessions = listAllSessions(limit, agentFilter);
  if (incompleteOnly) {
    sessions = sessions.filter(s => !s.complete);
  }

  if (sessions.length === 0) {
    log(`${DIM}No sessions found.${RESET}`);
    return;
  }

  log(
    `\n${BOLD}${'Agent'.padEnd(9)} ${'Status'.padEnd(10)} ${'Premium'.padEnd(10)} ${'Last Event'.padEnd(22)} ${'Summary'.padEnd(35)} ID${RESET}`,
  );
  log('─'.repeat(130));

  for (const s of sessions) {
    const agentLabel = s.agent === 'claude' ? `${CYAN}claude${RESET} ` : `${GREEN}copilot${RESET}`;
    const status = s.complete
      ? `${GREEN}✔ done${RESET}`
      : `${YELLOW}⏸ stop${RESET}`;
    const premium = s.agent === 'claude' ? '—' : String(s.premiumRequests);
    const summary = truncate(s.summary || '—', 33);

    log(
      `${agentLabel.padEnd(9 + 9)} ${status.padEnd(10 + 9)} ${premium.padEnd(10)} ${s.lastEvent.padEnd(22)} ${summary.padEnd(35)} ${DIM}${s.id.slice(0, 12)}…${RESET}`,
    );
  }
  log(`\n${DIM}Total: ${sessions.length} session(s)${RESET}`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + '…';
}
