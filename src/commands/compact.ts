import type { Command } from 'commander';
import chalk from 'chalk';
import { listAllSessions } from '../lib/session.js';
import { compactSession, saveCompact, buildResumePrompt } from '../lib/compact.js';

export function registerCompactCommand(program: Command): void {
  program
    .command('compact [session-id]')
    .description('Generate context summary from a session for handoff/resume')
    .option('--save', 'Save compact to ~/.copilot-agent/compacts/')
    .option('--resume-prompt', 'Output a resume prompt for the next session')
    .option('-a, --agent <type>', 'Agent type: copilot | claude')
    .action((sessionId: string | undefined, opts) => {
      try {
        showCompact(sessionId, opts);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`  ✗ ${msg}`));
      }
    });
}

function showCompact(sessionId: string | undefined, opts: { save?: boolean; resumePrompt?: boolean; agent?: string }): void {
  // Find session
  if (!sessionId) {
    const sessions = listAllSessions(10);
    if (sessions.length === 0) {
      console.log(chalk.dim('  No sessions found'));
      return;
    }
    sessionId = sessions[0].id;
    console.log(chalk.dim(`  Using latest session: ${sessionId.slice(0, 12)}…\n`));
  }

  const compact = compactSession(sessionId, opts.agent as any);
  if (!compact) {
    console.log(chalk.red(`  ✗ Session not found: ${sessionId}`));
    return;
  }

  // Show resume prompt mode
  if (opts.resumePrompt) {
    console.log(buildResumePrompt(compact));
    return;
  }

  // Display compact summary
  const agentTag = compact.agent === 'claude' ? chalk.yellow('[claude]') : chalk.cyan('[copilot]');
  console.log(chalk.bold.cyan(`  📋 Session Compact — ${compact.project}`) + ` ${agentTag}`);
  console.log(chalk.dim(`  ${compact.sessionId}`));
  console.log(chalk.dim(`  ${'─'.repeat(50)}`));
  console.log();

  // Stats
  console.log(`  ${chalk.bold('Duration')}  ${compact.stats.duration}    ${chalk.bold('Turns')}  ${compact.stats.turns}    ${chalk.bold('Tokens')}  ${compact.stats.tokens.toLocaleString()}    ${chalk.bold('Premium')}  ${chalk.yellow('⬡' + compact.stats.premium)}`);
  console.log();

  if (compact.summary) {
    console.log(chalk.bold('  Task:') + ` ${compact.summary}`);
    console.log();
  }

  // Done
  if (compact.done.length > 0) {
    console.log(chalk.bold.green('  ✅ Completed:'));
    for (const d of compact.done.slice(0, 15)) {
      console.log(chalk.green(`    ● ${d}`));
    }
    if (compact.done.length > 15) console.log(chalk.dim(`    ... +${compact.done.length - 15} more`));
    console.log();
  }

  // Remaining
  if (compact.remaining.length > 0) {
    console.log(chalk.bold.yellow('  ⏳ Remaining:'));
    for (const r of compact.remaining) {
      console.log(chalk.yellow(`    ○ ${r}`));
    }
    console.log();
  }

  // Commits
  if (compact.commits.length > 0) {
    console.log(chalk.bold.cyan('  Commits:'));
    for (const c of compact.commits.slice(0, 8)) {
      console.log(chalk.cyan(`    ● ${c}`));
    }
    console.log();
  }

  // Errors
  if (compact.errors.length > 0) {
    console.log(chalk.bold.red('  ⚠️ Errors:'));
    for (const e of compact.errors.slice(0, 5)) {
      console.log(chalk.red(`    ✗ ${e}`));
    }
    console.log();
  }

  // Save
  if (opts.save) {
    const path = saveCompact(compact);
    console.log(chalk.green(`  ✔ Saved to ${path}`));
    console.log();
  }
}
