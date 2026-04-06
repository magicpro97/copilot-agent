import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { getLatestSessionId, getSessionPremium, getSessionCwd, getLatestClaudeSessionId, getClaudeSessionCwd } from './session.js';
import { log, warn, fail } from './logger.js';
import type { AgentType, AgentProcess, AgentResult } from './provider.js';

// Re-export for backward compatibility
export type CopilotProcess = AgentProcess;
export type CopilotResult = AgentResult;

export function isCopilotInstalled(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where copilot' : 'which copilot';
    execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' });
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

/**
 * Find running agent processes (copilot, claude, or both).
 */
export function findAgentProcesses(agentFilter?: AgentType): AgentProcess[] {
  try {
    const isWin = process.platform === 'win32';
    let output: string;
    if (isWin) {
      try {
        output = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        output = execSync('wmic process get ProcessId,CommandLine /format:csv', { encoding: 'utf-8' });
      }
    } else {
      output = execSync('ps -eo pid,command', { encoding: 'utf-8' });
    }
    const results: AgentProcess[] = [];
    const myPid = process.pid;
    const parentPid = process.ppid;

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let pid: number;
      let cmdStr: string;

      if (isWin) {
        const psMatch = trimmed.match(/^"?(\d+)"?,"?(.+?)"?$/);
        if (psMatch) {
          pid = parseInt(psMatch[1], 10);
          cmdStr = psMatch[2].replace(/^"|"$/g, '');
        } else {
          const parts = trimmed.split(',');
          if (parts.length < 3) continue;
          const pidStr = parts[parts.length - 1].trim();
          pid = parseInt(pidStr, 10);
          if (isNaN(pid)) continue;
          cmdStr = parts.slice(1, -1).join(',').trim();
        }
      } else {
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (!match) continue;
        pid = parseInt(match[1], 10);
        cmdStr = match[2];
      }

      if (isNaN(pid) || pid === myPid || pid === parentPid) continue;

      const lower = cmdStr.toLowerCase();
      const isCopilot = (lower.includes('copilot') || lower.includes('@githubnext/copilot'))
        && !lower.includes('copilot-agent') && !lower.includes('copilot-api');
      const isClaude = lower.includes('claude') && !lower.includes('claude-code')
        && !lower.includes('copilot-agent');

      if (!isCopilot && !isClaude) continue;
      if (lower.includes('ps -eo') || lower.includes('grep') || lower.includes('wmic') || lower.includes('get-ciminstance')) continue;

      const agent: AgentType = isClaude ? 'claude' : 'copilot';
      if (agentFilter && agent !== agentFilter) continue;

      const sidMatch = agent === 'copilot'
        ? cmdStr.match(/resume[= ]+([a-f0-9-]{36})/)
        : cmdStr.match(/(?:--resume|--session-id)[= ]+([a-f0-9-]{36})/);

      let cwd: string | undefined;
      if (!isWin) {
        try {
          cwd = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | head -1`, {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
          }).trim().slice(1) || undefined;
        } catch { /* best effort */ }
      }

      const sid = sidMatch?.[1];
      if (!cwd && sid) {
        cwd = (agent === 'copilot' ? getSessionCwd(sid) : getClaudeSessionCwd(sid)) || undefined;
      }

      results.push({ pid, command: cmdStr, sessionId: sid, cwd, agent });
    }
    return results;
  } catch {
    return [];
  }
}

/** @deprecated Use findAgentProcesses('copilot') */
export function findCopilotProcesses(): AgentProcess[] {
  return findAgentProcesses('copilot');
}

export function findPidForSession(sid: string, agent?: AgentType): number | null {
  const procs = findAgentProcesses(agent);
  const matching = procs
    .filter(p => p.command.includes(sid))
    .sort((a, b) => b.pid - a.pid);
  return matching[0]?.pid ?? null;
}

/**
 * SAFETY: Wait until no agent is running in the SAME directory.
 */
export async function waitForAgentInDir(
  dir: string,
  agent?: AgentType,
  timeoutMs = 14_400_000,
  pollMs = 10_000,
): Promise<void> {
  const targetDir = resolve(dir);
  const start = Date.now();
  let warned = false;
  const label = agent ?? 'agent';
  while (Date.now() - start < timeoutMs) {
    const procs = findAgentProcesses(agent);
    const conflicting = procs.filter(p => {
      if (!p.cwd) return false;
      return resolve(p.cwd) === targetDir;
    });
    if (conflicting.length === 0) return;
    if (!warned) {
      warn(`Waiting for ${label} in ${targetDir} to finish...`);
      for (const p of conflicting) {
        log(`  PID ${p.pid}: ${p.command.slice(0, 80)}`);
      }
      warned = true;
    }
    await sleep(pollMs);
  }
  warn(`Timeout waiting for ${label} to finish in directory`);
}

/** @deprecated Use waitForAgentInDir */
export function waitForCopilotInDir(dir: string, timeoutMs?: number, pollMs?: number) {
  return waitForAgentInDir(dir, 'copilot', timeoutMs, pollMs);
}

export function assertSessionNotRunning(sid: string, agent?: AgentType): void {
  const pid = findPidForSession(sid, agent);
  if (pid) {
    const label = agent ?? 'agent';
    fail(`Session ${sid.slice(0, 8)}… already has ${label} running (PID ${pid}). Cannot resume.`);
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
      return true;
    }
  }
  return false;
}

// ─── Copilot-specific runners ───

export async function runCopilot(
  args: string[],
  options?: { cwd?: string; useWorktree?: boolean },
): Promise<AgentResult> {
  const dir = options?.cwd ?? process.cwd();

  if (!options?.useWorktree) {
    await waitForAgentInDir(dir, 'copilot');
  }

  return new Promise((resolve) => {
    const child = spawn('copilot', args, {
      cwd: options?.cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', async (code) => {
      await sleep(3000);
      const sid = getLatestSessionId();
      const premium = sid ? getSessionPremium(sid) : 0;
      resolve({ exitCode: code ?? 1, sessionId: sid, premium });
    });

    child.on('error', () => {
      resolve({ exitCode: 1, sessionId: null, premium: 0 });
    });
  });
}

export function runCopilotResume(
  sid: string, steps: number, message?: string, cwd?: string,
): Promise<AgentResult> {
  assertSessionNotRunning(sid, 'copilot');
  const args = [
    `--resume=${sid}`, '--autopilot', '--allow-all',
    '--max-autopilot-continues', String(steps), '--no-ask-user',
  ];
  if (message) args.push('-p', message);
  return runCopilot(args, { cwd });
}

export function runCopilotTask(
  prompt: string, steps: number, cwd?: string, useWorktree?: boolean,
): Promise<AgentResult> {
  return runCopilot([
    '-p', prompt, '--autopilot', '--allow-all',
    '--max-autopilot-continues', String(steps), '--no-ask-user',
  ], { cwd, useWorktree });
}

// ─── Claude Code runners ───

export async function runClaude(
  args: string[],
  options?: { cwd?: string; useWorktree?: boolean },
): Promise<AgentResult> {
  const dir = options?.cwd ?? process.cwd();

  if (!options?.useWorktree) {
    await waitForAgentInDir(dir, 'claude');
  }

  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      cwd: options?.cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', async (code) => {
      await sleep(2000);
      const sid = getLatestClaudeSessionId(options?.cwd);
      resolve({ exitCode: code ?? 1, sessionId: sid, premium: 0 });
    });

    child.on('error', () => {
      resolve({ exitCode: 1, sessionId: null, premium: 0 });
    });
  });
}

export function runClaudeResume(
  sid: string, _steps: number, message?: string, cwd?: string,
): Promise<AgentResult> {
  assertSessionNotRunning(sid, 'claude');
  const args = ['--resume', sid, '--dangerously-skip-permissions'];
  if (message) args.push(message);
  return runClaude(args, { cwd });
}

export function runClaudeTask(
  prompt: string, _steps: number, cwd?: string, useWorktree?: boolean,
): Promise<AgentResult> {
  return runClaude([
    '--print', '--dangerously-skip-permissions',
    '--output-format', 'text',
    prompt,
  ], { cwd, useWorktree });
}

// ─── Unified runners ───

export function runAgentTask(
  agent: AgentType, prompt: string, steps: number, cwd?: string, useWorktree?: boolean,
): Promise<AgentResult> {
  return agent === 'claude'
    ? runClaudeTask(prompt, steps, cwd, useWorktree)
    : runCopilotTask(prompt, steps, cwd, useWorktree);
}

export function runAgentResume(
  agent: AgentType, sid: string, steps: number, message?: string, cwd?: string,
): Promise<AgentResult> {
  return agent === 'claude'
    ? runClaudeResume(sid, steps, message, cwd)
    : runCopilotResume(sid, steps, message, cwd);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
