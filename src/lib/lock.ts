import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOCK_BASE = join(homedir(), '.copilot', 'locks');

function lockDir(name: string): string {
  return join(LOCK_BASE, `${name}.lock`);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(name: string, timeoutMs = 30_000): boolean {
  mkdirSync(LOCK_BASE, { recursive: true });
  const dir = lockDir(name);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      mkdirSync(dir);
      // Lock acquired — write metadata
      writeFileSync(join(dir, 'pid'), String(process.pid));
      writeFileSync(join(dir, 'acquired'), new Date().toISOString());
      return true;
    } catch {
      // Lock dir exists — check if holder is still alive
      try {
        const holderPid = parseInt(readFileSync(join(dir, 'pid'), 'utf-8').trim(), 10);
        if (!isPidAlive(holderPid)) {
          // Stale lock — break it
          rmSync(dir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Can't read pid file — try breaking
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      // Holder is alive — wait and retry
      const waitMs = Math.min(500, deadline - Date.now());
      if (waitMs > 0) {
        const start = Date.now();
        while (Date.now() - start < waitMs) { /* spin wait */ }
      }
    }
  }
  return false;
}

export function releaseLock(name: string): void {
  const dir = lockDir(name);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* already released */ }
}

export async function withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  if (!acquireLock(name)) {
    throw new Error(`Failed to acquire lock: ${name}`);
  }
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}
