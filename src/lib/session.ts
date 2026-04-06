import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import type { AgentType } from './provider.js';

export interface Session {
  id: string;
  dir: string;
  mtime: number;
  lastEvent: string;
  premiumRequests: number;
  summary: string;
  cwd: string;
  complete: boolean;
  agent: AgentType;
}

export interface FileChange {
  path: string;
  type: 'create' | 'edit';
  oldStr?: string;
  newStr?: string;
  content?: string;  // full content for creates
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
  fileChanges: FileChange[];
  errors: string[];
  taskCompletions: string[];
  agent: AgentType;
}

const SESSION_DIR = join(homedir(), '.copilot', 'session-state');
const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

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
    agent: 'copilot' as AgentType,
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
    fileChanges: [],
    errors: [],
    taskCompletions: [],
    agent: 'copilot',
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
          if (args?.path) {
            report.filesCreated.push(args.path);
            report.fileChanges.push({
              path: args.path, type: 'create',
              content: args.file_text?.slice(0, 5000),
            });
          }
        }
        if (toolName === 'edit') {
          const args = data.arguments as Record<string, string> | undefined;
          if (args?.path) {
            if (!report.filesEdited.includes(args.path)) report.filesEdited.push(args.path);
            report.fileChanges.push({
              path: args.path, type: 'edit',
              oldStr: args.old_str?.slice(0, 3000),
              newStr: args.new_str?.slice(0, 3000),
            });
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

// ─── Claude Code session support ───

/**
 * Decode Claude's encoded project path back to filesystem path.
 * Claude encodes `/Users/foo/project` as `-Users-foo-project`.
 */
function decodeClaudePath(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

function encodeClaudePath(fsPath: string): string {
  return fsPath.replace(/\//g, '-');
}

/**
 * List all Claude Code sessions across all projects.
 */
export function listClaudeSessions(limit = 20): Session[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];

  const sessions: Session[] = [];
  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const projDir of projectDirs) {
      const projPath = join(CLAUDE_PROJECTS_DIR, projDir.name);
      const cwd = decodeClaudePath(projDir.name);

      const files = readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = join(projPath, file);
        const sid = basename(file, '.jsonl');
        try {
          const stat = statSync(filePath);
          const { lastEvent, complete, summary } = parseClaudeSessionMeta(filePath);
          sessions.push({
            id: sid,
            dir: projPath,
            mtime: stat.mtimeMs,
            lastEvent,
            premiumRequests: 0,
            summary,
            cwd,
            complete,
            agent: 'claude',
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, limit);
}

function parseClaudeSessionMeta(filePath: string): { lastEvent: string; complete: boolean; summary: string } {
  try {
    const content = readFileSync(filePath, 'utf-8').trimEnd();
    const lines = content.split('\n');
    let lastEvent = 'unknown';
    let complete = false;
    let summary = '';

    // Read last few lines for metadata
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (i === lines.length - 1) {
          lastEvent = event.type ?? event.role ?? 'unknown';
        }
        // Claude marks completion with result type or specific message patterns
        if (event.type === 'result' || (event.type === 'assistant' && event.stop_reason === 'end_turn')) {
          complete = true;
        }
      } catch { /* skip */ }
    }

    // Get summary from first assistant message
    for (const line of lines.slice(0, 10)) {
      try {
        const event = JSON.parse(line);
        if ((event.type === 'human' || event.role === 'human') && event.message) {
          summary = typeof event.message === 'string'
            ? event.message.slice(0, 100)
            : JSON.stringify(event.message).slice(0, 100);
          break;
        }
      } catch { /* skip */ }
    }

    return { lastEvent, complete, summary };
  } catch {
    return { lastEvent: 'error', complete: false, summary: '' };
  }
}

export function getLatestClaudeSessionId(projectDir?: string): string | null {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;

  let searchDirs: string[];
  if (projectDir) {
    const encoded = encodeClaudePath(resolve(projectDir));
    const projPath = join(CLAUDE_PROJECTS_DIR, encoded);
    searchDirs = existsSync(projPath) ? [projPath] : [];
  } else {
    try {
      searchDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => join(CLAUDE_PROJECTS_DIR, d.name));
    } catch {
      return null;
    }
  }

  let latest: { id: string; mtime: number } | null = null;
  for (const dir of searchDirs) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const stat = statSync(join(dir, file));
        if (!latest || stat.mtimeMs > latest.mtime) {
          latest = { id: basename(file, '.jsonl'), mtime: stat.mtimeMs };
        }
      }
    } catch { /* skip */ }
  }
  return latest?.id ?? null;
}

export function getClaudeSessionCwd(sid: string): string {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return '';
  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const projDir of projectDirs) {
      const filePath = join(CLAUDE_PROJECTS_DIR, projDir.name, `${sid}.jsonl`);
      if (existsSync(filePath)) {
        return decodeClaudePath(projDir.name);
      }
    }
  } catch { /* skip */ }
  return '';
}

export function getClaudeSessionReport(sid: string): SessionReport | null {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;

  // Find session file
  let filePath: string | null = null;
  let cwd = '';
  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const projDir of projectDirs) {
      const candidate = join(CLAUDE_PROJECTS_DIR, projDir.name, `${sid}.jsonl`);
      if (existsSync(candidate)) {
        filePath = candidate;
        cwd = decodeClaudePath(projDir.name);
        break;
      }
    }
  } catch { /* skip */ }

  if (!filePath) return null;

  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf-8').trimEnd().split('\n');
  } catch {
    return null;
  }

  const report: SessionReport = {
    id: sid, cwd, summary: '', startTime: '', endTime: '',
    durationMs: 0, complete: false, userMessages: 0, assistantTurns: 0,
    outputTokens: 0, premiumRequests: 0, toolUsage: {}, gitCommits: [],
    filesCreated: [], filesEdited: [], fileChanges: [], errors: [], taskCompletions: [],
    agent: 'claude',
  };

  for (const line of lines) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }

    const type = (event.type ?? event.role ?? '') as string;
    const ts = event.timestamp as string | undefined;

    if (ts && !report.startTime) report.startTime = ts;
    if (ts) report.endTime = ts;

    // Claude JSONL uses 'human'/'assistant'/'tool_use'/'tool_result' types
    if (type === 'human' || type === 'user') {
      report.userMessages++;
      if (!report.summary) {
        const msg = event.message ?? event.content;
        report.summary = (typeof msg === 'string' ? msg : JSON.stringify(msg ?? '')).slice(0, 100);
      }
    }

    if (type === 'assistant') {
      report.assistantTurns++;
      const usage = event.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) report.outputTokens += usage.output_tokens;
      if (event.stop_reason === 'end_turn') report.complete = true;
    }

    if (type === 'tool_use') {
      const toolName = (event.name ?? event.tool ?? 'unknown') as string;
      report.toolUsage[toolName] = (report.toolUsage[toolName] ?? 0) + 1;

      // Track git commits from Bash tool
      if (toolName === 'Bash' || toolName === 'bash') {
        const input = (event.input ?? '') as string;
        const cmd = typeof input === 'string' ? input : (input as Record<string, string>)?.command ?? '';
        if (cmd.includes('git') && cmd.includes('commit') && cmd.includes('-m')) {
          const msgMatch = cmd.match(/-m\s+"([^"]{1,120})/);
          if (msgMatch) report.gitCommits.push(msgMatch[1]);
        }
      }
      // Track file operations
      if (toolName === 'Write' || toolName === 'Create') {
        const inp = event.input as Record<string, string> | undefined;
        const path = inp?.file_path ?? inp?.path;
        if (path) {
          report.filesCreated.push(path);
          report.fileChanges.push({
            path, type: 'create',
            content: (inp?.content ?? inp?.file_text)?.slice(0, 5000),
          });
        }
      }
      if (toolName === 'Edit') {
        const inp = event.input as Record<string, string> | undefined;
        const path = inp?.file_path ?? inp?.path;
        if (path) {
          if (!report.filesEdited.includes(path)) report.filesEdited.push(path);
          report.fileChanges.push({
            path, type: 'edit',
            oldStr: inp?.old_str?.slice(0, 3000),
            newStr: inp?.new_str?.slice(0, 3000),
          });
        }
      }
    }

    if (type === 'result') {
      report.complete = true;
      const result = (event.result ?? event.content ?? '') as string;
      if (result) report.taskCompletions.push(typeof result === 'string' ? result.slice(0, 200) : '(completed)');
    }

    if (type === 'error') {
      const msg = (event.error ?? event.message ?? 'unknown error') as string;
      report.errors.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  if (report.startTime && report.endTime) {
    report.durationMs = new Date(report.endTime).getTime() - new Date(report.startTime).getTime();
  }

  return report;
}

// ─── Unified session functions ───

/**
 * List sessions from both Copilot and Claude Code, merged and sorted by time.
 */
export function listAllSessions(limit = 20, agentFilter?: AgentType): Session[] {
  const copilot = agentFilter === 'claude' ? [] : listSessions(limit);
  const claude = agentFilter === 'copilot' ? [] : listClaudeSessions(limit);
  const all = [...copilot, ...claude];
  all.sort((a, b) => b.mtime - a.mtime);
  return all.slice(0, limit);
}

export function getAgentSessionReport(sid: string, agent?: AgentType): SessionReport | null {
  if (agent === 'claude') return getClaudeSessionReport(sid);
  if (agent === 'copilot') return getSessionReport(sid);
  // Auto-detect: try copilot first, then claude
  return getSessionReport(sid) ?? getClaudeSessionReport(sid);
}

export function findLatestIncompleteForAgent(agent?: AgentType): { id: string; agent: AgentType } | null {
  const sessions = listAllSessions(50, agent);
  for (const s of sessions) {
    if (!s.complete) return { id: s.id, agent: s.agent };
  }
  return null;
}
