import chalk from "chalk";
import ora from "ora";
import { detectProjectType, getProjectName } from "../lib/detect.js";
import { getTasksForProject } from "../lib/tasks.js";
import { runCopilotTask, assertCopilot } from "../lib/process.js";
import { withLock } from "../lib/lock.js";
import { gitBranch, gitStatus, gitStash, gitCheckout, gitIsRepo } from "../lib/git.js";
import { log, ok, warn, fail, notify } from "../lib/logger.js";

export interface RunOptions {
  steps: number;
  maxTasks: number;
  dryRun: boolean;
}

export async function runCommand(
  dir: string,
  opts: RunOptions,
): Promise<void> {
  assertCopilot();

  const projectType = await detectProjectType(dir);
  const name = getProjectName(dir);
  log(`Project: ${chalk.cyan(name)} (${projectType})`);

  const tasks = getTasksForProject(projectType).slice(0, opts.maxTasks);

  if (tasks.length === 0) {
    warn("No tasks found for this project type.");
    return;
  }

  log(`Found ${tasks.length} tasks:`);
  for (const t of tasks) {
    console.log(`  ${chalk.dim("•")} ${t.title}`);
  }

  if (opts.dryRun) {
    log(chalk.dim("(dry-run — not executing)"));
    return;
  }

  const originalBranch = gitIsRepo(dir) ? gitBranch(dir) : null;
  let completed = 0;
  let premiumTotal = 0;

  for (const task of tasks) {
    log(`\n${"═".repeat(60)}`);
    log(`Task: ${chalk.bold(task.title)}`);
    log(`${"═".repeat(60)}`);

    // Create a feature branch for safety
    if (originalBranch && gitIsRepo(dir)) {
      const branch = `copilot-agent/${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      try {
        if (gitStatus(dir)) gitStash(dir);
        gitCheckout(dir, branch);
      } catch (e) {
        warn(`Could not create branch ${branch}, continuing on current.`);
      }
    }

    const spinner = ora(`Running: ${task.title}…`).start();

    const result = await withLock("copilot-run", () =>
      runCopilotTask(task.prompt, opts.steps),
    );

    spinner.stop();

    premiumTotal += result.premium;
    completed++;
    ok(`${task.title} — exit ${result.exitCode}, premium: ${result.premium}`);

    if (originalBranch && gitIsRepo(dir)) {
      try {
        gitCheckout(dir, originalBranch);
      } catch {
        /* stay on feature branch */
      }
    }
  }

  log(`\nCompleted ${completed}/${tasks.length} tasks. Total premium: ${premiumTotal}`);
  notify(`Completed ${completed} tasks`, name);
}
