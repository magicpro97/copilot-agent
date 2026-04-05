import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface Session {
  id: string;
  dir: string;
  mtime: number;
  lastEvent: string;
  premiumRequests: number;
  summary: string;
  cwd: string;
  complete: boolean;
}

export interface SessionReport {
  id: string;
  cwd: string;
  summary: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  complete: boolean;
  userMessages: number;
  assistantTurns: number;
  outputTokens: number;
  premiumRequests: number;
  toolUsage: Record<string, number>;
  gitCommits: string[];
  filesCreated: string[];
  filesEdited: string[];
  errors: string[];
  taskCompletions: string[];
}

const SESSION_DIR = join(homedir(), '.copilot', 'session-state');

export function getSessionDir(): string {
  return SESSION_DIR;
}

export function validateSession(sid: string): boolean {
  const events = join(SESSION_DIR, sid, 'events.jsonl');
  try {
    return existsSync(events) && statSync(events).size > 0;
  } catch {
    return false;
  }
}

export function listSessions(limit = 20): Session[] {
  if (!existsSync(SESSION_DIR)) return [];

  const entries = readdirSync(SESSION_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  const dirs: { id: string; dir: string; mtime: number }[] = [];
  for (const entry of entries) {
    const dirPath = join(SESSION_DIR, entry.name);
    if (!existsSync(join(dirPath, 'events.jsonl'))) continue;
    try {
      const stat = statSync(dirPath);
      dirs.push({ id: entry.name, dir: dirPath, mtime: stat.mtimeMs });
    } catch { /* skip */ }
  }

  dirs.sort((a, b) => b.mtime - a.mtime);

  return dirs.slice(0, limit).map(s => ({
    id: s.id,
    dir: s.dir,
    mtime: s.mtime,
    lastEvent: getLastEvent(s.id),
    premiumRequests: getSessionPremium(s.id),
    summary: getSessionSummary(s.id),
    cwd: getSessionCwd(s.id),
    complete: hasTaskComplete(s.id),
  }));
}

export function getLatestSessionId(): string | null {
  if (!existsSync(SESSION_DIR)) return null;

  const entries = readdirSync(SESSION_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  let latest: { id: string; mtime: number } | null = null;
  for (const entry of entries) {
    try {
      const stat = statSync(join(SESSION_DIR, entry.name));
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { id: entry.name, mtime: stat.mtimeMs };
      }
    } catch { /* skip */ }
  }
  return latest?.id ?? null;
}

export function hasTaskComplete(sid: string): boolean {
  if (!validateSession(sid)) return false;
  try {
    const content = readFileSync(join(SESSION_DIR, sid, 'events.jsonl'), 'utf-8');
    return content.includes('"session.task_complete"');
  } catch {
    return false;
  }
}

export function getLastEvent(sid: string): string {
  if (!validateSession(sid)) return 'invalid';
  try {
    const lines = readFileSync(join(SESSION_DIR, sid, 'events.jsonl'), 'utf-8')
      .trimEnd()
      .split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    return last.type ?? 'unknown';
  } catch {
    return 'corrupted';
  }
}

export function getSessionPremium(sid: string): number {
  if (!validateSession(sid)) return 0;
  try {
    const content = readFileSync(join(SESSION_DIR, sid, 'events.jsonl'), 'utf-8');
    const lines = content.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (event.type === 'session.shutdown' && event.data?.totalPremiumRequests != null) {
          return event.data.totalPremiumRequests;
        }
      } catch { /* skip malformed line */ }
    }
    return 0;
  } catch {
    return 0;
  }
}

function parseSimpleYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    const key = line.substring(0, idx).trim();
    const value = line.substring(idx + 2).trim();
    if (key) result[key] = value;
  }
  return result;
}

function readWorkspace(sid: string): Record<string, string> {
  const wsPath = join(SESSION_DIR, sid, 'workspace.yaml');
  if (!existsSync(wsPath)) return {};
  try {
    return parseSimpleYaml(readFileSync(wsPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function getSessionSummary(sid: string): string {
  return readWorkspace(sid).summary ?? '';
}

export function getSessionCwd(sid: string): string {
  return readWorkspace(sid).cwd ?? '';
}

export function findSessionForProject(projectPath: string): string | null {
  const resolved = resolve(projectPath);
  const sessions = listSessions(50);
  for (const s of sessions) {
    if (s.cwd && resolve(s.cwd) === resolved) return s.id;
  }
  return null;
}

export function findLatestIncomplete(): string | null {
  const sessions = listSessions(50);
  for (const s of sessions) {
    if (!s.complete) return s.id;
  }
  return null;
}

export function getSessionReport(sid: string): SessionReport | null {
  if (!validateSession(sid)) return null;

  const ws = readWorkspace(sid);
  let lines: string[];
  try {
    lines = readFileSync(join(SESSION_DIR, sid, 'events.jsonl'), 'utf-8')
      .trimEnd()
      .split('\n');
  } catch {
    return null;
  }

  const report: SessionReport = {
    id: sid,
    cwd: ws.cwd ?? '',
    summary: ws.summary ?? '',
    startTime: '',
    endTime: '',
    durationMs: 0,
    complete: false,
    userMessages: 0,
    assistantTurns: 0,
    outputTokens: 0,
    premiumRequests: 0,
    toolUsage: {},
    gitCommits: [],
    filesCreated: [],
    filesEdited: [],
    errors: [],
    taskCompletions: [],
  };

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const type = event.type as string;
    const ts = event.timestamp as string | undefined;
    const data = (event.data ?? {}) as Record<string, unknown>;

    if (ts && !report.startTime) report.startTime = ts;
    if (ts) report.endTime = ts;

    switch (type) {
      case 'user.message':
        report.userMessages++;
        break;

      case 'assistant.message':
        report.assistantTurns++;
        report.outputTokens += (data.outputTokens as number) ?? 0;
        break;

      case 'tool.execution_start': {
        const toolName = data.toolName as string;
        if (toolName) {
          report.toolUsage[toolName] = (report.toolUsage[toolName] ?? 0) + 1;
        }
        // Track git commits
        if (toolName === 'bash') {
          const args = data.arguments as Record<string, string> | undefined;
          const cmd = args?.command ?? '';
          if (cmd.includes('git') && cmd.includes('commit') && cmd.includes('-m')) {
            const msgMatch = cmd.match(/-m\s+"([^"]{1,120})/);
            if (msgMatch) report.gitCommits.push(msgMatch[1]);
          }
        }
        // Track file creates/edits
        if (toolName === 'create') {
          const args = data.arguments as Record<string, string> | undefined;
          if (args?.path) report.filesCreated.push(args.path);
        }
        if (toolName === 'edit') {
          const args = data.arguments as Record<string, string> | undefined;
          if (args?.path && !report.filesEdited.includes(args.path)) {
            report.filesEdited.push(args.path);
          }
        }
        break;
      }

      case 'session.task_complete': {
        const summary = data.summary as string | undefined;
        report.taskCompletions.push(summary ?? '(task completed)');
        report.complete = true;
        break;
      }

      case 'session.error': {
        const msg = data.message as string | undefined;
        if (msg) report.errors.push(msg);
        break;
      }

      case 'session.shutdown': {
        const premium = data.totalPremiumRequests as number | undefined;
        if (premium != null) report.premiumRequests = premium;
        break;
      }
    }
  }

  if (report.startTime && report.endTime) {
    report.durationMs = new Date(report.endTime).getTime() - new Date(report.startTime).getTime();
  }

  return report;
}
