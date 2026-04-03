import chalk from "chalk";
import ora from "ora";
import {
  validateSession,
  hasTaskComplete,
  getSessionSummary,
  getLastEvent,
  findLatestIncomplete,
} from "../lib/session.js";
import {
  findPidForSession,
  waitForExit,
  runCopilotResume,
  assertCopilot,
} from "../lib/process.js";
import { log, ok, warn, fail, notify } from "../lib/logger.js";

export interface WatchOptions {
  steps: number;
  maxResumes: number;
  message?: string;
}

export async function watchCommand(
  sid: string | undefined,
  opts: WatchOptions,
): Promise<void> {
  assertCopilot();

  if (!sid) {
    sid = findLatestIncomplete() ?? undefined;
    if (!sid) {
      fail("No incomplete session found.");
      process.exit(1);
    }
    log(`Auto-detected incomplete session: ${chalk.cyan(sid)}`);
  }

  if (!validateSession(sid)) {
    fail(`Invalid session: ${sid}`);
    process.exit(1);
  }

  if (hasTaskComplete(sid)) {
    ok(`Session ${sid} already completed.`);
    return;
  }

  let resumes = 0;

  while (resumes < opts.maxResumes) {
    const pid = await findPidForSession(sid);

    if (pid) {
      const spinner = ora(
        `Watching PID ${pid} for session ${chalk.cyan(sid.slice(0, 8))}…`,
      ).start();
      const exited = await waitForExit(pid);
      spinner.stop();

      if (!exited) {
        warn("Timeout waiting for process exit.");
        break;
      }
    }

    // Small delay for events to flush
    await sleep(3000);

    if (hasTaskComplete(sid)) {
      ok(
        `Task complete! Summary: ${getSessionSummary(sid) || "none"}`,
      );
      notify("Task completed!", `Session ${sid.slice(0, 8)}`);
      return;
    }

    // Interrupted — resume
    resumes++;
    log(
      `Session interrupted (${getLastEvent(sid)}). Resume ${resumes}/${opts.maxResumes}…`,
    );

    const result = await runCopilotResume(sid, opts.steps, opts.message);
    if (result.sessionId && result.sessionId !== sid) {
      log(`New session created: ${chalk.cyan(result.sessionId)}`);
      sid = result.sessionId;
    }
  }

  warn(`Max resumes (${opts.maxResumes}) reached.`);
  notify("Max resumes reached", `Session ${sid.slice(0, 8)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
