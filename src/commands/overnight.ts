import chalk from "chalk";
import ora from "ora";
import { detectProjectType, detectProjectName } from "../lib/detect.js";
import { getTasksForProject } from "../lib/tasks.js";
import { runCopilotTask, assertCopilot } from "../lib/process.js";
import { withLock } from "../lib/lock.js";
import { log, ok, warn, fail, setLogFile, notify } from "../lib/logger.js";
import { join } from "node:path";
import { homedir } from "node:os";

export interface OvernightOptions {
  until: string; // HH:MM
  steps: number;
  maxPremium: number;
  dryRun: boolean;
}

export async function overnightCommand(
  dir: string,
  opts: OvernightOptions,
): Promise<void> {
  assertCopilot();

  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const logPath = join(
    homedir(),
    ".copilot",
    "auto-resume-logs",
    `overnight-${ts}.log`,
  );
  setLogFile(logPath);

  const deadline = parseDeadline(opts.until);
  const name = detectProjectName(dir);
  const projectType = detectProjectType(dir);

  log(`Overnight runner for ${chalk.cyan(name)} (${projectType})`);
  log(`Deadline: ${opts.until} (${msToHuman(deadline - Date.now())} from now)`);
  log(`Max premium: ${opts.maxPremium}, Steps: ${opts.steps}`);
  log(`Log: ${logPath}`);

  if (opts.dryRun) {
    const tasks = getTasksForProject(projectType);
    log(`\nWould run ${tasks.length} tasks:`);
    for (const t of tasks) console.log(`  ${chalk.dim("•")} ${t.title}`);
    return;
  }

  const tasks = getTasksForProject(projectType);
  let taskIdx = 0;
  let totalPremium = 0;
  let completedTasks = 0;
  let cycle = 0;

  while (Date.now() < deadline) {
    if (totalPremium >= opts.maxPremium) {
      warn(`Premium budget exhausted: ${totalPremium}/${opts.maxPremium}`);
      break;
    }

    const task = tasks[taskIdx % tasks.length];
    cycle++;
    taskIdx++;

    log(`\n${"═".repeat(60)}`);
    log(
      `Cycle ${cycle} | Task: ${chalk.bold(task.title)} | Premium: ${totalPremium}/${opts.maxPremium}`,
    );
    log(`Time remaining: ${msToHuman(deadline - Date.now())}`);
    log(`${"═".repeat(60)}`);

    const spinner = ora(`Running: ${task.title}…`).start();

    try {
      const result = await withLock("copilot-overnight", () =>
        runCopilotTask(task.prompt, opts.steps),
      );
      spinner.stop();

      totalPremium += result.premium;
      completedTasks++;
      ok(
        `${task.title} — exit ${result.exitCode}, premium: ${result.premium}`,
      );
    } catch (err) {
      spinner.stop();
      fail(`Task failed: ${err}`);
    }

    // Cooldown between tasks
    if (Date.now() < deadline) {
      log("Cooldown 30s…");
      await sleep(30_000);
    }
  }

  const summary = `Overnight done. ${completedTasks} tasks, ${totalPremium} premium.`;
  log(summary);
  notify(summary, name);
}

function parseDeadline(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function msToHuman(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
