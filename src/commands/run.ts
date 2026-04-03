import type { Command } from 'commander';
import { detectProjectType, detectProjectName, detectMainBranch } from '../lib/detect.js';
import { getTasksForProject } from '../lib/tasks.js';
import { runCopilotTask, assertCopilot } from '../lib/process.js';
import { withLock } from '../lib/lock.js';
import { isGitRepo, gitCurrentBranch, gitStatus, gitStash, gitCheckout, gitCreateBranch, gitCountCommits } from '../lib/git.js';
import { log, ok, warn, fail, info, notify } from '../lib/logger.js';
import { BOLD, CYAN, DIM, GREEN, RESET, YELLOW } from '../lib/colors.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run [dir]')
    .description('Discover and fix issues in a project')
    .option('-s, --steps <n>', 'Max autopilot continues per task', '30')
    .option('-t, --max-tasks <n>', 'Max number of tasks to run', '5')
    .option('-p, --max-premium <n>', 'Max total premium requests', '50')
    .option('--dry-run', 'Show tasks without executing')
    .action(async (dir: string | undefined, opts) => {
      try {
        await runCommand(dir ?? process.cwd(), {
          steps: parseInt(opts.steps, 10),
          maxTasks: parseInt(opts.maxTasks, 10),
          maxPremium: parseInt(opts.maxPremium, 10),
          dryRun: opts.dryRun ?? false,
        });
      } catch (err) {
        fail(`Run error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

interface RunOptions {
  steps: number;
  maxTasks: number;
  maxPremium: number;
  dryRun: boolean;
}

async function runCommand(dir: string, opts: RunOptions): Promise<void> {
  assertCopilot();

  const projectType = detectProjectType(dir);
  const name = detectProjectName(dir);
  const mainBranch = isGitRepo(dir) ? detectMainBranch(dir) : null;

  info(`Project: ${CYAN}${name}${RESET} (${projectType})`);
  if (mainBranch) info(`Main branch: ${mainBranch}`);

  const tasks = getTasksForProject(projectType).slice(0, opts.maxTasks);

  if (tasks.length === 0) {
    warn('No tasks found for this project type.');
    return;
  }

  log(`Found ${tasks.length} tasks:`);
  for (const t of tasks) {
    log(`  ${DIM}•${RESET} ${t.title}`);
  }

  if (opts.dryRun) {
    log(`${DIM}(dry-run — not executing)${RESET}`);
    return;
  }

  const originalBranch = isGitRepo(dir) ? gitCurrentBranch(dir) : null;
  let completed = 0;
  let premiumTotal = 0;

  for (const task of tasks) {
    if (premiumTotal >= opts.maxPremium) {
      warn(`Premium request limit reached (${premiumTotal}/${opts.maxPremium}).`);
      break;
    }

    log(`\n${'═'.repeat(60)}`);
    log(`${BOLD}${CYAN}Task: ${task.title}${RESET}`);
    log(`${'═'.repeat(60)}`);

    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    const branchName = `agent/fix-${completed + 1}-${timestamp}-${random}`;

    if (mainBranch && isGitRepo(dir)) {
      if (gitStatus(dir)) gitStash(dir);
      gitCheckout(dir, mainBranch);
      if (!gitCreateBranch(dir, branchName)) {
        warn(`Could not create branch ${branchName}, continuing on current.`);
      }
    }

    info(`Running: ${task.title}…`);

    const result = await withLock('copilot-run', () =>
      runCopilotTask(task.prompt, opts.steps, dir),
    );

    const commits = mainBranch ? gitCountCommits(dir, mainBranch, 'HEAD') : 0;
    premiumTotal += result.premium;
    completed++;
    ok(`${task.title} — ${commits} commit(s), ${result.premium} premium`);

    if (originalBranch && isGitRepo(dir)) {
      gitCheckout(dir, mainBranch ?? originalBranch);
    }
  }

  log(`\n${BOLD}═══ Run Summary ═══${RESET}`);
  log(`Completed ${completed}/${tasks.length} tasks. Total premium: ${premiumTotal}`);
  notify(`Completed ${completed} tasks`, name);
}
