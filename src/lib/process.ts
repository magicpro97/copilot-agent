import { execSync, spawn } from 'node:child_process';
import { getLatestSessionId, getSessionPremium } from './session.js';
import { log, warn, fail } from './logger.js';

export interface CopilotProcess {
  pid: number;
  command: string;
  sessionId?: string;
}

export interface CopilotResult {
  exitCode: number;
  sessionId: string | null;
  premium: number;
}

export function isCopilotInstalled(): boolean {
  try {
    execSync('which copilot', { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function assertCopilot(): void {
  if (!isCopilotInstalled()) {
    fail('copilot CLI not found. Install with: npm i -g @githubnext/copilot');
    process.exit(1);
  }
}

export function findCopilotProcesses(): CopilotProcess[] {
  try {
    const output = execSync('ps -eo pid,command', { encoding: 'utf-8' });
    const results: CopilotProcess[] = [];
    const myPid = process.pid;
    const parentPid = process.ppid;
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (
        (trimmed.includes('copilot') || trimmed.includes('@githubnext/copilot')) &&
        !trimmed.includes('ps -eo') &&
        !trimmed.includes('copilot-agent') &&
        !trimmed.includes('grep')
      ) {
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          // Exclude our own process tree
          if (pid === myPid || pid === parentPid) continue;
          const cmd = match[2];
          const sidMatch = cmd.match(/resume[= ]+([a-f0-9-]{36})/);
          results.push({
            pid,
            command: cmd,
            sessionId: sidMatch?.[1],
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function findPidForSession(sid: string): number | null {
  const procs = findCopilotProcesses();
  const matching = procs
    .filter(p => p.command.includes(sid))
    .sort((a, b) => b.pid - a.pid);
  return matching[0]?.pid ?? null;
}

/**
 * SAFETY: Wait until no other copilot processes are running.
 * Prevents race conditions from concurrent copilot instances.
 */
export async function waitForAllCopilotToFinish(
  timeoutMs = 14_400_000,
  pollMs = 10_000,
): Promise<void> {
  const start = Date.now();
  let warned = false;
  while (Date.now() - start < timeoutMs) {
    const procs = findCopilotProcesses();
    if (procs.length === 0) return;
    if (!warned) {
      warn(`Waiting for ${procs.length} copilot process(es) to finish before starting...`);
      for (const p of procs) {
        log(`  PID ${p.pid}: ${p.command.slice(0, 80)}`);
      }
      warned = true;
    }
    await sleep(pollMs);
  }
  warn('Timeout waiting for copilot processes to finish');
}

/**
 * SAFETY: Check if a session already has a running copilot process.
 * If so, refuse to spawn another one to prevent corruption.
 */
export function assertSessionNotRunning(sid: string): void {
  const pid = findPidForSession(sid);
  if (pid) {
    fail(`Session ${sid.slice(0, 8)}… already has copilot running (PID ${pid}). Cannot resume — would corrupt the session.`);
    process.exit(1);
  }
}

export async function waitForExit(pid: number, timeoutMs = 14_400_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await sleep(5000);
    } catch {
      return true; // process exited
    }
  }
  return false; // timeout
}

export async function runCopilot(
  args: string[],
  options?: { cwd?: string },
): Promise<CopilotResult> {
  // SAFETY: Wait for all existing copilot processes to finish first
  await waitForAllCopilotToFinish();

  return new Promise((resolve) => {
    const child = spawn('copilot', args, {
      cwd: options?.cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', async (code) => {
      await sleep(3000); // let events flush
      const sid = getLatestSessionId();
      const premium = sid ? getSessionPremium(sid) : 0;
      resolve({
        exitCode: code ?? 1,
        sessionId: sid,
        premium,
      });
    });

    child.on('error', () => {
      resolve({ exitCode: 1, sessionId: null, premium: 0 });
    });
  });
}

export function runCopilotResume(
  sid: string,
  steps: number,
  message?: string,
  cwd?: string,
): Promise<CopilotResult> {
  // SAFETY: Refuse if session already running
  assertSessionNotRunning(sid);

  const args = [
    `--resume=${sid}`,
    '--autopilot',
    '--allow-all',
    '--max-autopilot-continues',
    String(steps),
    '--no-ask-user',
  ];
  if (message) args.push('-p', message);
  return runCopilot(args, { cwd });
}

export function runCopilotTask(
  prompt: string,
  steps: number,
  cwd?: string,
): Promise<CopilotResult> {
  return runCopilot([
    '-p', prompt,
    '--autopilot',
    '--allow-all',
    '--max-autopilot-continues', String(steps),
    '--no-ask-user',
  ], { cwd });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
