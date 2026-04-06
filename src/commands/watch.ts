import type { Command } from 'commander';
import {
  validateSession,
  hasTaskComplete,
  getSessionSummary,
  getLastEvent,
  findLatestIncomplete,
  getSessionCwd,
  findLatestIncompleteForAgent,
} from '../lib/session.js';
import {
  findPidForSession,
  waitForExit,
  runAgentResume,
} from '../lib/process.js';
import { resolveAgent, assertAgent, type AgentType } from '../lib/provider.js';
import { log, ok, warn, fail, info, notify } from '../lib/logger.js';
import { CYAN, RESET } from '../lib/colors.js';
import { notifySessionEnd, notifyError } from '../lib/notify.js';

export function registerWatchCommand(program: Command): void {
  program
    .command('watch [session-id]')
    .description('Watch a session and auto-resume when it stops')
    .option('-s, --steps <n>', 'Max autopilot continues per resume', '30')
    .option('-r, --max-resumes <n>', 'Max number of resumes', '10')
    .option('-c, --cooldown <n>', 'Seconds between resumes', '10')
    .option('-m, --message <msg>', 'Message to send on resume')
    .option('-a, --agent <type>', 'Agent to use: copilot or claude')
    .action(async (sid: string | undefined, opts) => {
      try {
        await watchCommand(sid, {
          steps: parseInt(opts.steps, 10),
          maxResumes: parseInt(opts.maxResumes, 10),
          cooldown: parseInt(opts.cooldown, 10),
          message: opts.message,
          agent: resolveAgent(opts.agent),
        });
      } catch (err) {
        fail(`Watch error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

interface WatchOptions {
  steps: number;
  maxResumes: number;
  cooldown: number;
  message?: string;
  agent: AgentType;
}

async function watchCommand(sid: string | undefined, opts: WatchOptions): Promise<void> {
  assertAgent(opts.agent);

  if (!sid) {
    const result = findLatestIncompleteForAgent(opts.agent);
    sid = result?.id;
    if (!sid) {
      fail('No incomplete session found.');
      process.exit(1);
    }
    info(`Auto-detected incomplete ${opts.agent} session: ${CYAN}${sid}${RESET}`);
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
    const pid = findPidForSession(sid, opts.agent);

    if (pid) {
      info(`Watching PID ${pid} for ${opts.agent} session ${CYAN}${sid.slice(0, 8)}${RESET}…`);
      const exited = await waitForExit(pid);

      if (!exited) {
        warn('Timeout waiting for process exit.');
        break;
      }
    }

    // Small delay for events to flush
    await sleep(3000);

    if (hasTaskComplete(sid)) {
      ok(`Task complete! Summary: ${getSessionSummary(sid) || 'none'}`);
      notify('Task completed!', `Session ${sid.slice(0, 8)}`);
      await notifySessionEnd(sid, getSessionSummary(sid) || 'Task completed');
      return;
    }

    // Interrupted — resume
    resumes++;
    log(`Session interrupted (${getLastEvent(sid)}). Resume ${resumes}/${opts.maxResumes}…`);

    if (opts.cooldown > 0 && resumes > 1) {
      info(`Cooldown ${opts.cooldown}s...`);
      await sleep(opts.cooldown * 1000);
    }

    const cwd = getSessionCwd(sid) || undefined;
    const result = await runAgentResume(
      opts.agent,
      sid,
      opts.steps,
      opts.message ?? 'Continue remaining work. Pick up where you left off and complete the task.',
      cwd,
    );

    if (result.sessionId && result.sessionId !== sid) {
      info(`New session created: ${CYAN}${result.sessionId}${RESET}`);
      sid = result.sessionId;
    }
  }

  warn(`Max resumes (${opts.maxResumes}) reached.`);
  notify('Max resumes reached', `Session ${sid.slice(0, 8)}`);
  await notifyError(sid, `Max resumes (${opts.maxResumes}) reached — session may be stuck`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
