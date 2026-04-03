import { execSync } from "node:child_process";

export function gitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export function gitStatus(cwd: string): string {
  try {
    return execSync("git status --porcelain", {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

export function gitStash(cwd: string): void {
  execSync("git stash push -m 'copilot-agent auto-stash'", {
    cwd,
    stdio: "ignore",
  });
}

export function gitCheckout(cwd: string, branch: string): void {
  execSync(`git checkout -B ${branch}`, { cwd, stdio: "ignore" });
}

export function gitIsRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
