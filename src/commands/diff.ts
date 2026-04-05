import type { Command } from 'commander';
import chalk from 'chalk';
import { execaCommandSync } from 'execa';
import { listAllSessions, getAgentSessionReport } from '../lib/session.js';
import type { AgentType } from '../lib/provider.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [session-id]')
    .description('Show git changes made by an agent session')
    .option('--stat', 'Show diffstat summary only')
    .option('-n, --num-commits <n>', 'Number of recent commits to diff', '0')
    .option('--project <dir>', 'Filter sessions by project directory')
    .action((sessionId: string | undefined, opts) => {
      try {
        showDiff(sessionId, opts);
      } catch (err: any) {
        console.error(chalk.red(`  ✗ ${err.message}`));
      }
    });
}

function showDiff(sessionId: string | undefined, opts: { stat?: boolean; numCommits?: string; project?: string }): void {
  let sessions = listAllSessions(50);
  if (opts.project) {
    sessions = sessions.filter(s => s.cwd.includes(opts.project!));
  }

  let targetId = sessionId;
  let targetAgent: AgentType | undefined;

  if (!targetId) {
    if (sessions.length === 0) {
      console.log(chalk.dim('  No sessions found'));
      return;
    }
    targetId = sessions[0].id;
    targetAgent = sessions[0].agent;
    console.log(chalk.dim(`  Using latest session: ${targetId.slice(0, 8)}…\n`));
  } else {
    const match = sessions.find(s => s.id.startsWith(targetId!));
    if (match) targetAgent = match.agent;
  }

  const report = getAgentSessionReport(targetId, targetAgent);
  if (!report) {
    console.log(chalk.red(`  ✗ Session not found: ${targetId}`));
    return;
  }

  // Header
  const project = report.cwd?.split('/').pop() || 'unknown';
  const agentTag = report.agent === 'claude' ? chalk.yellow('[claude]') : chalk.cyan('[copilot]');
  console.log(chalk.bold(`  ${agentTag} ${project}`) + chalk.dim(` — ${report.id.slice(0, 8)}…`));
  console.log(chalk.dim(`  ${report.summary || 'No summary'}`));
  console.log();

  // Created files
  if (report.filesCreated.length > 0) {
    console.log(chalk.bold.green('  Created files:'));
    for (const f of report.filesCreated) {
      console.log(chalk.green(`    + ${f}`));
    }
    console.log();
  }

  // Edited files
  if (report.filesEdited.length > 0) {
    console.log(chalk.bold.yellow('  Edited files:'));
    for (const f of report.filesEdited) {
      console.log(chalk.yellow(`    ~ ${f}`));
    }
    console.log();
  }

  // Commits
  if (report.gitCommits.length > 0) {
    console.log(chalk.bold.cyan('  Commits:'));
    for (const c of report.gitCommits) {
      const first = c.split('\n')[0];
      console.log(chalk.cyan(`    ● ${first}`));
    }
    console.log();
  }

  // Git diff
  if (report.cwd) {
    const numCommits = parseInt(opts.numCommits || '0', 10);
    if (numCommits > 0) {
      try {
        const diffArgs = opts.stat
          ? ['git', '--no-pager', 'diff', '--stat', `HEAD~${numCommits}`]
          : ['git', '--no-pager', 'diff', '--color=always', `HEAD~${numCommits}`];

        const result = execaCommandSync(diffArgs.join(' '), { cwd: report.cwd });
        if (result.stdout) {
          console.log(chalk.bold('  Git Diff:\n'));
          console.log(result.stdout);
        } else {
          console.log(chalk.dim('  No diff (working tree clean)'));
        }
      } catch (err: any) {
        console.log(chalk.dim(`  Could not run git diff: ${err.message}`));
      }
    } else if (report.gitCommits.length > 0) {
      try {
        const n = report.gitCommits.length;
        const result = execaCommandSync(`git --no-pager diff --stat HEAD~${n}`, { cwd: report.cwd });
        if (result.stdout) {
          console.log(chalk.bold('  Diffstat:\n'));
          console.log(result.stdout);
        }
      } catch {
        // Silently ignore — commits may be on different branch
      }
    }
  }

  // Summary stats
  console.log();
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(`  ${chalk.bold('Files:')} ${chalk.green(`+${report.filesCreated.length}`)} created, ${chalk.yellow(`~${report.filesEdited.length}`)} edited`);
  console.log(`  ${chalk.bold('Commits:')} ${report.gitCommits.length}`);
  console.log(`  ${chalk.bold('Premium:')} ${chalk.yellow(`⬡${report.premiumRequests}`)}`);
  console.log();
}
