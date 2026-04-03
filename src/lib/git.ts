import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function gitExec(dir: string, cmd: string): string | null {
  try {
    return execSync(cmd, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

export function gitCurrentBranch(dir: string): string | null {
  return gitExec(dir, 'git branch --show-current');
}

export function gitStash(dir: string): boolean {
  return gitExec(dir, 'git stash -q') !== null;
}

export function gitStashPop(dir: string): boolean {
  return gitExec(dir, 'git stash pop -q') !== null;
}

export function gitCheckout(dir: string, branch: string): boolean {
  return gitExec(dir, `git checkout ${branch} -q`) !== null;
}

export function gitCreateBranch(dir: string, branch: string): boolean {
  return gitExec(dir, `git checkout -b ${branch}`) !== null;
}

export function gitCountCommits(dir: string, from: string, to: string): number {
  const result = gitExec(dir, `git log ${from}..${to} --oneline`);
  if (!result) return 0;
  return result.split('\n').filter(l => l.trim()).length;
}

export function gitStatus(dir: string): string {
  return gitExec(dir, 'git status --porcelain') ?? '';
}
