import type { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectProjectType, detectProjectName, detectMainBranch } from '../lib/detect.js';
import { getTasksForProject } from '../lib/tasks.js';
import { runCopilotTask, assertCopilot, findPidForSession, waitForExit, runCopilotResume } from '../lib/process.js';
import { withLock } from '../lib/lock.js';
import { isGitRepo, gitCurrentBranch, gitStash, gitCheckout, gitCreateBranch, gitCountCommits } from '../lib/git.js';
import { findLatestIncomplete, validateSession, hasTaskComplete, getSessionCwd } from '../lib/session.js';
import { log, ok, warn, fail, info, setLogFile, notify } from '../lib/logger.js';
import { BOLD, CYAN, DIM, RESET } from '../lib/colors.js';

export function registerOvernightCommand(program: Command): void {
  program
    .command('overnight [dir]')
    .description('Run tasks continuously until a deadline')
    .option('-u, --until <HH>', 'Stop at this hour (24h format)', '07')
    .option('-s, --steps <n>', 'Max autopilot continues per task', '50')
    .option('-c, --cooldown <n>', 'Seconds between tasks', '15')
    .option('-p, --max-premium <n>', 'Max premium requests budget', '300')
    .option('--dry-run', 'Show plan without executing')
    .action(async (dir: string | undefined, opts) => {
      try {
        await overnightCommand(dir ?? process.cwd(), {
          until: parseInt(opts.until, 10),
          steps: parseInt(opts.steps, 10),
          cooldown: parseInt(opts.cooldown, 10),
          maxPremium: parseInt(opts.maxPremium, 10),
          dryRun: opts.dryRun ?? false,
        });
      } catch (err) {
        fail(`Overnight error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

interface OvernightOptions {
  until: number;
  steps: number;
  cooldown: number;
  maxPremium: number;
  dryRun: boolean;
}

function isPastDeadline(untilHour: number): boolean {
  const hour = new Date().getHours();
  return hour >= untilHour && hour < 20;
}

async function overnightCommand(dir: string, opts: OvernightOptions): Promise<void> {
  assertCopilot();

  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = join(homedir(), '.copilot', 'auto-resume-logs', `overnight-${ts}.log`);
  setLogFile(logPath);

  const name = detectProjectName(dir);
  const projectType = detectProjectType(dir);
  const mainBranch = isGitRepo(dir) ? detectMainBranch(dir) : null;

  info(`Overnight runner for ${CYAN}${name}${RESET} (${projectType})`);
  info(`Deadline: ${String(opts.until).padStart(2, '0')}:00`);
  info(`Max premium: ${opts.maxPremium}, Steps: ${opts.steps}`);
  info(`Log: ${logPath}`);

  const tasks = getTasksForProject(projectType);

  if (opts.dryRun) {
    log(`\nWould run ${tasks.length} tasks:`);
    for (const t of tasks) log(`  ${DIM}•${RESET} ${t.title}`);
    return;
  }

  // Phase 1: Resume existing incomplete session
  const existingSession = findLatestIncomplete();
  if (existingSession && validateSession(existingSession)) {
    info(`Found incomplete session: ${existingSession}`);
    const pid = findPidForSession(existingSession);
    if (pid) {
      info(`Waiting for running copilot (PID ${pid})...`);
      await waitForExit(pid);
    }

    if (!hasTaskComplete(existingSession) && !isPastDeadline(opts.until)) {
      info('Resuming incomplete session...');
      const cwd = getSessionCwd(existingSession) || dir;
      await runCopilotResume(
        existingSession,
        opts.steps,
        'Continue remaining work. Complete the task.',
        cwd,
      );
    }
  }

  // Phase 2: Loop tasks until deadline
  const originalBranch = isGitRepo(dir) ? gitCurrentBranch(dir) : null;
  let taskIdx = 0;
  let totalPremium = 0;
  let totalCommits = 0;

  while (!isPastDeadline(opts.until) && taskIdx < tasks.length) {
    if (totalPremium >= opts.maxPremium) {
      warn(`Premium budget exhausted: ${totalPremium}/${opts.maxPremium}`);
      break;
    }

    const task = tasks[taskIdx % tasks.length];
    taskIdx++;

    log(`\n${'═'.repeat(60)}`);
    log(`${BOLD}${CYAN}[${new Date().toLocaleTimeString()}] Task ${taskIdx}: ${task.title}${RESET}`);
    log(`${DIM}Premium: ${totalPremium}/${opts.maxPremium}${RESET}`);
    log(`${'═'.repeat(60)}`);

    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    const branchName = `agent/overnight-${taskIdx}-${timestamp}-${random}`;

    if (mainBranch && isGitRepo(dir)) {
      gitStash(dir);
      gitCheckout(dir, mainBranch);
      gitCreateBranch(dir, branchName);
    }

    info(`Running: ${task.title}…`);

    try {
      const result = await withLock('copilot-overnight', () =>
        runCopilotTask(task.prompt, opts.steps, dir),
      );

      const commits = mainBranch ? gitCountCommits(dir, mainBranch, 'HEAD') : 0;
      totalPremium += result.premium;
      totalCommits += commits;

      if (commits > 0) {
        ok(`${commits} commit(s) on ${branchName}`);
      } else {
        log(`${DIM}No commits on ${branchName}${RESET}`);
      }
    } catch (err) {
      fail(`Task failed: ${err}`);
    }

    if (mainBranch && isGitRepo(dir)) {
      gitCheckout(dir, mainBranch);
    }

    if (!isPastDeadline(opts.until)) {
      info(`Cooldown ${opts.cooldown}s…`);
      await sleep(opts.cooldown * 1000);
    }
  }

  if (originalBranch && isGitRepo(dir)) {
    gitCheckout(dir, originalBranch);
  }

  const summary = `Overnight done — ${taskIdx} tasks, ${totalCommits} commits, ${totalPremium} premium.`;
  ok(summary);
  notify(summary, name);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
