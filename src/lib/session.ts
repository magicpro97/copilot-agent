import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import type { SessionInfo } from "../types.js";

const SESSION_DIR = join(homedir(), ".copilot", "session-state");

export function getSessionDir(): string {
  return SESSION_DIR;
}

export function validateSession(sid: string): boolean {
  const events = join(SESSION_DIR, sid, "events.jsonl");
  return existsSync(events) && statSync(events).size > 0;
}

export function listSessions(limit = 20): SessionInfo[] {
  if (!existsSync(SESSION_DIR)) return [];
  return readdirSync(SESSION_DIR)
    .filter((d) => existsSync(join(SESSION_DIR, d, "events.jsonl")))
    .sort((a, b) => {
      const ma = statSync(join(SESSION_DIR, a)).mtimeMs;
      const mb = statSync(join(SESSION_DIR, b)).mtimeMs;
      return mb - ma;
    })
    .slice(0, limit)
    .map((id) => ({ id, ...readWorkspace(id) }));
}

export function getLatestSessionId(): string | null {
  const sessions = listSessions(1);
  return sessions[0]?.id ?? null;
}

export function hasTaskComplete(sid: string): boolean {
  if (!validateSession(sid)) return false;
  const content = readFileSync(join(SESSION_DIR, sid, "events.jsonl"), "utf-8");
  return content.includes('"session.task_complete"');
}

export function getLastEvent(sid: string): string {
  if (!validateSession(sid)) return "invalid";
  try {
    const lines = readFileSync(join(SESSION_DIR, sid, "events.jsonl"), "utf-8")
      .trimEnd()
      .split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    return last.type ?? "unknown";
  } catch {
    return "corrupted";
  }
}

export function getSessionPremium(sid: string): number {
  if (!validateSession(sid)) return 0;
  try {
    const content = readFileSync(
      join(SESSION_DIR, sid, "events.jsonl"),
      "utf-8",
    );
    const shutdownLines = content
      .split("\n")
      .filter((l) => l.includes('"session.shutdown"'));
    if (shutdownLines.length === 0) return 0;
    const last = JSON.parse(shutdownLines[shutdownLines.length - 1]);
    return last.data?.totalPremiumRequests ?? 0;
  } catch {
    return 0;
  }
}

export function getSessionSummary(sid: string): string {
  return readWorkspace(sid).summary ?? "";
}

export function getSessionCwd(sid: string): string {
  return readWorkspace(sid).cwd ?? "";
}

export function findSessionForProject(projectPath: string): string | null {
  const sessions = listSessions(50);
  for (const s of sessions) {
    if (s.cwd === projectPath) return s.id;
  }
  return null;
}

export function findLatestIncomplete(): string | null {
  const sessions = listSessions(50);
  for (const s of sessions) {
    if (!hasTaskComplete(s.id)) return s.id;
  }
  return null;
}

function readWorkspace(sid: string): Partial<SessionInfo> {
  const wsPath = join(SESSION_DIR, sid, "workspace.yaml");
  if (!existsSync(wsPath)) return {};
  try {
    const content = readFileSync(wsPath, "utf-8");
    const parsed = parseYaml(content);
    return {
      cwd: parsed?.cwd,
      gitRoot: parsed?.git_root,
      branch: parsed?.branch,
      summary: parsed?.summary,
      createdAt: parsed?.created_at,
      updatedAt: parsed?.updated_at,
    };
  } catch {
    return {};
  }
}
