import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { getLatestSessionId, getSessionPremium, getSessionCwd } from './session.js';
import { log, warn, fail } from './logger.js';

export interface CopilotProcess {
  pid: number;
  command: string;
  sessionId?: string;
  cwd?: string;
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
          // Try to get cwd of the process
          let cwd: string | undefined;
          try {
            cwd = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim().slice(1) || undefined;
          } catch { /* best effort */ }
          // Fallback: get cwd from session if we know the session
          const sid = sidMatch?.[1];
          if (!cwd && sid) {
            cwd = getSessionCwd(sid) || undefined;
          }
          results.push({ pid, command: cmd, sessionId: sid, cwd });
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
 * SAFETY: Wait until no copilot is running in the SAME directory.
 * Copilot in different directories/worktrees can run in parallel.
 */
export async function waitForCopilotInDir(
  dir: string,
  timeoutMs = 14_400_000,
  pollMs = 10_000,
): Promise<void> {
  const targetDir = resolve(dir);
  const start = Date.now();
  let warned = false;
  while (Date.now() - start < timeoutMs) {
    const procs = findCopilotProcesses();
    const conflicting = procs.filter(p => {
      if (!p.cwd) return false;
      return resolve(p.cwd) === targetDir;
    });
    if (conflicting.length === 0) return;
    if (!warned) {
      warn(`Waiting for copilot in ${targetDir} to finish...`);
      for (const p of conflicting) {
        log(`  PID ${p.pid}: ${p.command.slice(0, 80)}`);
      }
      warned = true;
    }
    await sleep(pollMs);
  }
  warn('Timeout waiting for copilot to finish in directory');
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
  // SAFETY: Wait for copilot in same directory only (parallel in different dirs is OK)
  const dir = options?.cwd ?? process.cwd();
  await waitForCopilotInDir(dir);

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
