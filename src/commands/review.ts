import type { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { listAllSessions, getAgentSessionReport } from '../lib/session.js';
import { runAgentTask } from '../lib/process.js';
import { resolveAgent } from '../lib/provider.js';
import type { AgentType } from '../lib/provider.js';
import { log, ok, fail, info } from '../lib/logger.js';

const MAX_DIFF_LENGTH = 15_000;
const MAX_BUFFER = 1024 * 1024;

function getSessionDiff(sessionId: string): string {
  const report =
    getAgentSessionReport(sessionId, 'copilot') ??
    getAgentSessionReport(sessionId, 'claude');

  if (!report || report.gitCommits.length === 0) {
    return execSync('git --no-pager diff HEAD~3', {
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
    });
  }

  return execSync('git --no-pager diff HEAD~' + report.gitCommits.length, {
    encoding: 'utf-8',
    cwd: report.cwd || process.cwd(),
    maxBuffer: MAX_BUFFER,
  });
}

function getWorkingDiff(): string {
  const staged = execSync('git --no-pager diff --cached', {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });
  const unstaged = execSync('git --no-pager diff', {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });
  return staged + unstaged;
}

function getPrDiff(prNumber: string): string {
  return execSync(`gh pr diff ${prNumber} --color=never`, {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });
}

const focusInstructions: Record<string, string> = {
  all: 'Review for bugs, security issues, performance problems, and code quality.',
  security:
    'Focus exclusively on security vulnerabilities, injection risks, auth issues, and data exposure.',
  performance:
    'Focus exclusively on performance issues: N+1 queries, memory leaks, unnecessary allocations, slow algorithms.',
  bugs: 'Focus exclusively on logic bugs, edge cases, null/undefined issues, race conditions.',
  style: 'Focus exclusively on code style, naming, readability, and consistency.',
};

function buildReviewPrompt(diff: string, focus: string): string {
  const instruction = focusInstructions[focus] ?? focusInstructions.all;
  const truncatedDiff =
    diff.length > MAX_DIFF_LENGTH
      ? diff.slice(0, MAX_DIFF_LENGTH) + '\n... (truncated)'
      : diff;

  return `You are a senior code reviewer. ${instruction}

Review this diff and provide:
1. **Critical Issues** (bugs, security) — must fix
2. **Suggestions** — should fix for quality
3. **Positive Notes** — good patterns observed
4. **Summary** — one paragraph overall assessment

Be concise. Only flag real issues, not style nitpicks (unless focus is style).

\`\`\`diff
${truncatedDiff}
\`\`\``;
}

async function runReview(
  label: string,
  diff: string,
  agent: AgentType,
  focus: string,
  steps: number,
): Promise<void> {
  if (!diff.trim()) {
    fail('No changes found to review.');
    process.exit(1);
  }

  info(`Reviewing: ${chalk.cyan(label)}`);
  log(`Focus: ${chalk.yellow(focus)} | Agent: ${chalk.yellow(agent)} | Steps: ${steps}`);

  const prompt = buildReviewPrompt(diff, focus);
  const result = await runAgentTask(agent, prompt, steps, process.cwd());

  if (result.exitCode === 0) {
    ok('Review complete.');
  } else {
    fail(`Agent exited with code ${result.exitCode}`);
  }
}

export function registerReviewCommand(program: Command): void {
  const cmd = program
    .command('review [session-id]')
    .description('AI-powered code review of agent changes or git diffs')
    .option('-a, --agent <type>', 'Agent to use: copilot or claude', 'copilot')
    .option(
      '-f, --focus <area>',
      'Focus area: all, security, performance, bugs, style',
      'all',
    )
    .option('-s, --steps <n>', 'Max agent steps', '5')
    .action(async (sessionId: string | undefined, opts) => {
      try {
        const agent = resolveAgent(opts.agent);
        const steps = parseInt(opts.steps, 10);

        let sid = sessionId;
        if (!sid) {
          const sessions = listAllSessions(1);
          if (sessions.length === 0) {
            fail('No sessions found. Use "review diff" to review working tree changes.');
            process.exit(1);
          }
          sid = sessions[0].id;
          log(`Using latest session: ${chalk.dim(sid)}`);
        }

        const diff = getSessionDiff(sid);
        await runReview(`session ${sid.slice(0, 8)}…`, diff, agent, opts.focus, steps);
      } catch (err) {
        fail(`Review error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  cmd
    .command('diff')
    .description('Review current working tree changes')
    .option('-a, --agent <type>', 'Agent to use: copilot or claude', 'copilot')
    .option(
      '-f, --focus <area>',
      'Focus area: all, security, performance, bugs, style',
      'all',
    )
    .option('-s, --steps <n>', 'Max agent steps', '5')
    .action(async (opts) => {
      try {
        const agent = resolveAgent(opts.agent);
        const steps = parseInt(opts.steps, 10);
        const diff = getWorkingDiff();
        await runReview('working tree changes', diff, agent, opts.focus, steps);
      } catch (err) {
        fail(`Review error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  cmd
    .command('pr <number>')
    .description('Review a GitHub Pull Request')
    .option('-a, --agent <type>', 'Agent to use: copilot or claude', 'copilot')
    .option(
      '-f, --focus <area>',
      'Focus area: all, security, performance, bugs, style',
      'all',
    )
    .option('-s, --steps <n>', 'Max agent steps', '5')
    .action(async (number: string, opts) => {
      try {
        const agent = resolveAgent(opts.agent);
        const steps = parseInt(opts.steps, 10);
        const diff = getPrDiff(number);
        await runReview(`PR #${number}`, diff, agent, opts.focus, steps);
      } catch (err) {
        fail(`Review error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
