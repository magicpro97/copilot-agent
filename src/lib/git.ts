import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

export function gitRoot(dir: string): string | null {
  return gitExec(dir, 'git rev-parse --show-toplevel');
}

// ── Worktree support ──

export function listWorktrees(dir: string): { path: string; branch: string; bare: boolean }[] {
  const raw = gitExec(dir, 'git worktree list --porcelain');
  if (!raw) return [];
  const trees: { path: string; branch: string; bare: boolean }[] = [];
  let current: { path: string; branch: string; bare: boolean } = { path: '', branch: '', bare: false };
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) trees.push(current);
      current = { path: line.slice(9), branch: '', bare: false };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  if (current.path) trees.push(current);
  return trees;
}

/**
 * Create a git worktree for parallel copilot work.
 * Returns the worktree path or null on failure.
 */
export function createWorktree(repoDir: string, branch: string): string | null {
  const safeBranch = branch.replace(/[^a-zA-Z0-9._/-]/g, '-');
  const worktreePath = resolve(repoDir, '..', `${resolve(repoDir).split('/').pop()}-wt-${safeBranch}`);

  if (existsSync(worktreePath)) {
    return worktreePath; // already exists
  }

  // Create branch if it doesn't exist, then add worktree
  const branchExists = gitExec(repoDir, `git rev-parse --verify ${safeBranch}`) !== null;
  const cmd = branchExists
    ? `git worktree add "${worktreePath}" ${safeBranch}`
    : `git worktree add -b ${safeBranch} "${worktreePath}"`;

  if (gitExec(repoDir, cmd) !== null) {
    return worktreePath;
  }
  return null;
}

/**
 * Remove a worktree (prune).
 */
export function removeWorktree(repoDir: string, worktreePath: string): boolean {
  const result = gitExec(repoDir, `git worktree remove "${worktreePath}" --force`);
  return result !== null;
}

/**
 * Clean up all copilot-agent worktrees.
 */
export function cleanupWorktrees(repoDir: string): number {
  const trees = listWorktrees(repoDir);
  let cleaned = 0;
  for (const t of trees) {
    if (t.path.includes('-wt-')) {
      if (removeWorktree(repoDir, t.path)) cleaned++;
    }
  }
  gitExec(repoDir, 'git worktree prune');
  return cleaned;
}
