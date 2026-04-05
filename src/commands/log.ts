import type { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { listAllSessions, getAgentSessionReport, type Session, type SessionReport } from '../lib/session.js';

export function registerLogCommand(program: Command): void {
  const cmd = program
    .command('log')
    .description('Search, browse, and export session history');

  cmd
    .command('search <query>')
    .description('Search across all sessions')
    .option('-a, --agent <type>', 'Filter: copilot | claude')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--after <date>', 'After date (YYYY-MM-DD)')
    .option('--before <date>', 'Before date (YYYY-MM-DD)')
    .action((query: string, opts) => {
      const limit = parseInt(opts.limit, 10);
      const sessions = listAllSessions(200);
      const q = query.toLowerCase();

      let filtered = sessions;
      if (opts.agent) filtered = filtered.filter(s => s.agent === opts.agent);
      if (opts.after) {
        const after = new Date(opts.after).getTime();
        filtered = filtered.filter(s => s.mtime >= after);
      }
      if (opts.before) {
        const before = new Date(opts.before).getTime();
        filtered = filtered.filter(s => s.mtime <= before);
      }

      // Search in summary, cwd, lastEvent and report details
      const matches = filtered.filter(s => {
        if (s.summary?.toLowerCase().includes(q)) return true;
        if (s.cwd?.toLowerCase().includes(q)) return true;
        if (s.lastEvent?.toLowerCase().includes(q)) return true;
        const report = getAgentSessionReport(s.id, s.agent);
        if (!report) return false;
        if (report.gitCommits.some(c => c.toLowerCase().includes(q))) return true;
        if (report.filesCreated.some(f => f.toLowerCase().includes(q))) return true;
        if (report.filesEdited.some(f => f.toLowerCase().includes(q))) return true;
        if (report.taskCompletions.some(t => t.toLowerCase().includes(q))) return true;
        return false;
      }).slice(0, limit);

      console.log(chalk.bold.cyan(`\n  🔍 Search: "${query}"`) + chalk.dim(` (${matches.length} results)\n`));

      if (matches.length === 0) {
        console.log(chalk.dim('  No matches found'));
        return;
      }

      for (const s of matches) {
        const agentTag = s.agent === 'claude' ? chalk.yellow('claude ') : chalk.cyan('copilot');
        const icon = s.complete ? chalk.green('✔') : chalk.yellow('⏳');
        const date = new Date(s.mtime).toLocaleDateString('en-CA');
        const time = new Date(s.mtime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const project = s.cwd?.split('/').pop() || '—';
        const summary = (s.summary || '—').slice(0, 50);
        console.log(`  ${icon} ${agentTag} ${chalk.dim(date + ' ' + time)}  ${chalk.bold(project.padEnd(16))} ${summary}`);
        console.log(chalk.dim(`    ${s.id}`));
      }
      console.log();
    });

  cmd
    .command('timeline [session-id]')
    .description('Show chronological timeline of a session')
    .option('-a, --agent <type>', 'Agent type')
    .action((sessionId: string | undefined, opts) => {
      if (!sessionId) {
        const sessions = listAllSessions(1);
        if (sessions.length === 0) { console.log(chalk.dim('  No sessions')); return; }
        sessionId = sessions[0].id;
        opts.agent = opts.agent || sessions[0].agent;
        console.log(chalk.dim(`  Using latest: ${sessionId.slice(0, 12)}…\n`));
      }

      const report = getAgentSessionReport(sessionId, opts.agent as any);
      if (!report) { console.log(chalk.red(`  ✗ Session not found`)); return; }

      const project = report.cwd?.split('/').pop() || 'unknown';
      const agentTag = report.agent === 'claude' ? chalk.yellow('[claude]') : chalk.cyan('[copilot]');
      console.log(chalk.bold.cyan(`  📅 Timeline — ${project}`) + ` ${agentTag}\n`);

      const entries: string[] = [];

      if (report.startTime) entries.push(`${chalk.dim(fmtTime(report.startTime))} ${chalk.green('▶')} Session started`);

      for (const f of report.filesCreated) entries.push(`${chalk.dim('       ')} ${chalk.green('+')} Created ${f}`);
      for (const f of report.filesEdited) entries.push(`${chalk.dim('       ')} ${chalk.yellow('~')} Edited ${f}`);
      for (const c of report.gitCommits) entries.push(`${chalk.dim('       ')} ${chalk.cyan('●')} Commit: ${c.split('\n')[0].slice(0, 60)}`);
      for (const t of report.taskCompletions) entries.push(`${chalk.dim('       ')} ${chalk.green('✔')} ${t.split('\n')[0].slice(0, 60)}`);
      for (const e of report.errors.slice(0, 5)) entries.push(`${chalk.dim('       ')} ${chalk.red('✗')} ${e.split('\n')[0].slice(0, 60)}`);

      const statusIcon = report.complete ? chalk.green('■') : chalk.yellow('⏸');
      if (report.endTime) entries.push(`${chalk.dim(fmtTime(report.endTime))} ${statusIcon} Session ${report.complete ? 'completed' : 'stopped'}`);

      for (const e of entries) console.log(`  ${e}`);

      console.log(chalk.dim(`\n  Duration: ${fmtDur(report.durationMs)} | Turns: ${report.assistantTurns} | Premium: ⬡${report.premiumRequests}\n`));
    });

  cmd
    .command('export')
    .description('Export session history')
    .option('-f, --format <fmt>', 'Format: json | csv', 'json')
    .option('-l, --limit <n>', 'Max sessions', '50')
    .option('-o, --output <file>', 'Output file')
    .action((opts) => {
      const sessions = listAllSessions(parseInt(opts.limit, 10));
      const data = sessions.map(s => {
        const r = getAgentSessionReport(s.id, s.agent);
        return {
          id: s.id,
          agent: s.agent,
          project: s.cwd?.split('/').pop() || '',
          complete: s.complete,
          premium: s.premiumRequests,
          tokens: r?.outputTokens || 0,
          turns: r?.assistantTurns || 0,
          commits: r?.gitCommits.length || 0,
          filesCreated: r?.filesCreated.length || 0,
          filesEdited: r?.filesEdited.length || 0,
          durationMs: r?.durationMs || 0,
          summary: s.summary || '',
          date: new Date(s.mtime).toISOString(),
        };
      });

      let output: string;
      if (opts.format === 'csv') {
        const headers = Object.keys(data[0] || {}).join(',');
        const rows = data.map(d => Object.values(d).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        output = [headers, ...rows].join('\n');
      } else {
        output = JSON.stringify(data, null, 2);
      }

      if (opts.output) {
        writeFileSync(opts.output, output, 'utf-8');
        console.log(chalk.green(`  ✔ Exported ${data.length} sessions to ${opts.output}`));
      } else {
        console.log(output);
      }
    });
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return '     '; }
}

function fmtDur(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}
