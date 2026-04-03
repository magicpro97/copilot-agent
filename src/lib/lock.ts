import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";

const LOCK_DIR = join(homedir(), ".copilot", "locks");

function lockPath(name: string): string {
  const p = join(LOCK_DIR, `${name}.lock`);
  if (!existsSync(LOCK_DIR)) {
    mkdirSync(LOCK_DIR, { recursive: true });
  }
  if (!existsSync(p)) writeFileSync(p, "");
  return p;
}

export async function acquireLock(
  name: string,
  opts?: { retries?: number; stale?: number },
): Promise<() => Promise<void>> {
  const p = lockPath(name);
  return lockfile.lock(p, {
    retries: {
      retries: opts?.retries ?? 10,
      minTimeout: 1000,
      maxTimeout: 3000,
    },
    stale: opts?.stale ?? 30_000,
  });
}

export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireLock(name);
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function isLocked(name: string): boolean {
  const p = join(LOCK_DIR, `${name}.lock`);
  if (!existsSync(p)) return false;
  return lockfile.checkSync(p);
}
