/**
 * Reactive data store for the TUI dashboard.
 *
 * All I/O is async (fs.promises, child_process.exec). Data changes emit events
 * so the UI only re-renders the affected panel. Heavy JSONL parsing is chunked
 * via setImmediate to yield the event loop between lines.
 */
import { EventEmitter } from 'node:events';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { AgentType } from './provider.js';
import type { Session, SessionReport, FileChange } from './session.js';

const SESSION_DIR = join(homedir(), '.copilot', 'session-state');
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// ── Async helpers ────────────────────────────────────────────────

function execAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf-8', maxBuffer: 512 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
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

// ── Chunked JSONL parser (yields event loop every 200 lines) ─────

async function parseJsonlChunked(
  content: string,
  handler: (event: Record<string, unknown>) => void,
): Promise<void> {
  const lines = content.trimEnd().split('\n');
  const CHUNK = 200;
  for (let i = 0; i < lines.length; i++) {
    try {
      handler(JSON.parse(lines[i]));
    } catch { /* skip malformed */ }
    // Yield every CHUNK lines so blessed can process key events
    if (i % CHUNK === 0 && i > 0) {
      await new Promise<void>(r => setImmediate(r));
    }
  }
}

// ── Async session listing ────────────────────────────────────────

async function readWorkspaceAsync(sid: string): Promise<Record<string, string>> {
  const wsPath = join(SESSION_DIR, sid, 'workspace.yaml');
  try {
    const content = await readFile(wsPath, 'utf-8');
    return parseSimpleYaml(content);
  } catch {
    return {};
  }
}

async function listCopilotSessionsAsync(limit: number): Promise<Session[]> {
  if (!existsSync(SESSION_DIR)) return [];
  try {
    const entries = await readdir(SESSION_DIR, { withFileTypes: true });
    const dirs: { id: string; dir: string; mtime: number }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(SESSION_DIR, entry.name);
      const eventsPath = join(dirPath, 'events.jsonl');
      if (!existsSync(eventsPath)) continue;
      try {
        const s = await stat(dirPath);
        dirs.push({ id: entry.name, dir: dirPath, mtime: s.mtimeMs });
      } catch { /* skip */ }
    }

    dirs.sort((a, b) => b.mtime - a.mtime);
    const top = dirs.slice(0, limit);

    return Promise.all(top.map(async (s) => {
      const ws = await readWorkspaceAsync(s.id);
      let premiumRequests = 0;
      let complete = false;
      let lastEvent = 'unknown';

      // Only read last 4KB of events.jsonl for metadata (fast!)
      try {
        const evPath = join(SESSION_DIR, s.id, 'events.jsonl');
        const fileStat = await stat(evPath);
        const fullContent = await readFile(evPath, 'utf-8');
        const lines = fullContent.trimEnd().split('\n');

        // Scan last few lines for shutdown/completion
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
          try {
            const ev = JSON.parse(lines[i]);
            if (i === lines.length - 1) lastEvent = ev.type ?? 'unknown';
            if (ev.type === 'session.shutdown' && ev.data?.totalPremiumRequests != null) {
              premiumRequests = ev.data.totalPremiumRequests;
            }
            if (ev.type === 'session.task_complete') complete = true;
          } catch { /* skip */ }
        }
        // Fast complete check if not found in tail
        if (!complete && fullContent.includes('"session.task_complete"')) complete = true;
      } catch { /* skip */ }

      return {
        id: s.id,
        dir: s.dir,
        mtime: s.mtime,
        lastEvent,
        premiumRequests,
        summary: ws.summary ?? '',
        cwd: ws.cwd ?? '',
        complete,
        agent: 'copilot' as AgentType,
      };
    }));
  } catch {
    return [];
  }
}

async function listClaudeSessionsAsync(limit: number): Promise<Session[]> {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const sessions: Session[] = [];
  try {
    const projectDirs = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const projDir of projectDirs.filter(d => d.isDirectory())) {
      const projPath = join(CLAUDE_PROJECTS_DIR, projDir.name);
      const cwd = projDir.name.replace(/^-/, '/').replace(/-/g, '/');
      const files = (await readdir(projPath)).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = join(projPath, file);
        const sid = basename(file, '.jsonl');
        try {
          const s = await stat(filePath);
          sessions.push({
            id: sid, dir: projPath, mtime: s.mtimeMs,
            lastEvent: 'unknown', premiumRequests: 0,
            summary: '', cwd, complete: false, agent: 'claude',
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, limit);
}

// ── Async process listing ────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  command: string;
  sessionId?: string;
  cwd?: string;
  agent: AgentType;
}

async function findProcessesAsync(): Promise<ProcessInfo[]> {
  try {
    const isWin = process.platform === 'win32';
    let output: string;
    if (isWin) {
      // PowerShell: more reliable than wmic on modern Windows
      try {
        output = await execAsync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"');
      } catch {
        // Fallback: wmic (older Windows)
        output = await execAsync('wmic process get ProcessId,CommandLine /format:csv');
      }
    } else {
      output = await execAsync('ps -eo pid,command');
    }
    return parseProcessOutput(output, isWin);
  } catch {
    return [];
  }
}

function parseProcessOutput(output: string, isWin: boolean): ProcessInfo[] {
  const results: ProcessInfo[] = [];
  const myPid = process.pid;
  const parentPid = process.ppid;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let pid: number;
    let cmd: string;

    if (isWin) {
      // PowerShell CSV: "ProcessId","CommandLine" or wmic CSV: Node,CommandLine,ProcessId
      // Try PowerShell format first: "PID","cmd..."
      const psMatch = trimmed.match(/^"?(\d+)"?,"?(.+?)"?$/);
      if (psMatch) {
        pid = parseInt(psMatch[1], 10);
        cmd = psMatch[2].replace(/^"|"$/g, '');
      } else {
        // wmic fallback: Node,CommandLine,ProcessId
        const parts = trimmed.split(',');
        if (parts.length < 3) continue;
        const pidStr = parts[parts.length - 1].trim();
        pid = parseInt(pidStr, 10);
        if (isNaN(pid)) continue;
        cmd = parts.slice(1, -1).join(',').trim();
      }
    } else {
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      pid = parseInt(match[1], 10);
      cmd = match[2];
    }

    if (isNaN(pid) || pid === myPid || pid === parentPid) continue;

    const lower = cmd.toLowerCase();
    const isCopilot = (lower.includes('copilot') || lower.includes('@githubnext/copilot'))
      && !lower.includes('copilot-agent') && !lower.includes('copilot-api');
    const isClaude = lower.includes('claude') && !lower.includes('claude-code')
      && !lower.includes('copilot-agent');
    if (!isCopilot && !isClaude) continue;
    if (lower.includes('ps -eo') || lower.includes('grep') || lower.includes('wmic') || lower.includes('get-ciminstance')) continue;

    const agent: AgentType = isClaude ? 'claude' : 'copilot';
    const sidMatch = agent === 'copilot'
      ? cmd.match(/resume[= ]+([a-f0-9-]{36})/)
      : cmd.match(/(?:--resume|--session-id)[= ]+([a-f0-9-]{36})/);

    results.push({ pid, command: cmd, sessionId: sidMatch?.[1], agent });
  }
  return results;
}

// ── Async session report ─────────────────────────────────────────

async function loadReportAsync(sid: string, agent: AgentType): Promise<SessionReport | null> {
  if (agent === 'claude') return loadClaudeReportAsync(sid);
  return loadCopilotReportAsync(sid);
}

async function loadCopilotReportAsync(sid: string): Promise<SessionReport | null> {
  const eventsPath = join(SESSION_DIR, sid, 'events.jsonl');
  if (!existsSync(eventsPath)) return null;

  const ws = await readWorkspaceAsync(sid);
  let content: string;
  try { content = await readFile(eventsPath, 'utf-8'); } catch { return null; }

  const report: SessionReport = {
    id: sid, cwd: ws.cwd ?? '', summary: ws.summary ?? '',
    startTime: '', endTime: '', durationMs: 0, complete: false,
    userMessages: 0, assistantTurns: 0, outputTokens: 0, premiumRequests: 0,
    toolUsage: {}, gitCommits: [], filesCreated: [], filesEdited: [],
    fileChanges: [], errors: [], taskCompletions: [], agent: 'copilot',
  };

  await parseJsonlChunked(content, (event) => {
    const type = event.type as string;
    const ts = event.timestamp as string | undefined;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (ts && !report.startTime) report.startTime = ts;
    if (ts) report.endTime = ts;

    switch (type) {
      case 'user.message': report.userMessages++; break;
      case 'assistant.message':
        report.assistantTurns++;
        report.outputTokens += (data.outputTokens as number) ?? 0;
        break;
      case 'tool.execution_start': {
        const toolName = data.toolName as string;
        if (toolName) report.toolUsage[toolName] = (report.toolUsage[toolName] ?? 0) + 1;
        if (toolName === 'bash') {
          const args = data.arguments as Record<string, string> | undefined;
          const cmd = args?.command ?? '';
          if (cmd.includes('git') && cmd.includes('commit') && cmd.includes('-m')) {
            const msgMatch = cmd.match(/-m\s+"([^"]{1,120})/);
            if (msgMatch) report.gitCommits.push(msgMatch[1]);
          }
        }
        if (toolName === 'create') {
          const args = data.arguments as Record<string, string> | undefined;
          if (args?.path) {
            report.filesCreated.push(args.path);
            report.fileChanges.push({ path: args.path, type: 'create', content: args.file_text?.slice(0, 5000) });
          }
        }
        if (toolName === 'edit') {
          const args = data.arguments as Record<string, string> | undefined;
          if (args?.path) {
            if (!report.filesEdited.includes(args.path)) report.filesEdited.push(args.path);
            report.fileChanges.push({ path: args.path, type: 'edit', oldStr: args.old_str?.slice(0, 3000), newStr: args.new_str?.slice(0, 3000) });
          }
        }
        break;
      }
      case 'session.task_complete': {
        report.taskCompletions.push((data.summary as string) ?? '(task completed)');
        report.complete = true;
        break;
      }
      case 'session.error': {
        const msg = data.message as string;
        if (msg) report.errors.push(msg);
        break;
      }
      case 'session.shutdown': {
        const prem = data.totalPremiumRequests as number | undefined;
        if (prem != null) report.premiumRequests = prem;
        break;
      }
    }
  });

  if (report.startTime && report.endTime) {
    report.durationMs = new Date(report.endTime).getTime() - new Date(report.startTime).getTime();
  }
  return report;
}

async function loadClaudeReportAsync(sid: string): Promise<SessionReport | null> {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;
  let filePath: string | null = null;
  let cwd = '';
  try {
    const projectDirs = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const projDir of projectDirs.filter(d => d.isDirectory())) {
      const candidate = join(CLAUDE_PROJECTS_DIR, projDir.name, `${sid}.jsonl`);
      if (existsSync(candidate)) {
        filePath = candidate;
        cwd = projDir.name.replace(/^-/, '/').replace(/-/g, '/');
        break;
      }
    }
  } catch { /* skip */ }
  if (!filePath) return null;

  let content: string;
  try { content = await readFile(filePath, 'utf-8'); } catch { return null; }

  const report: SessionReport = {
    id: sid, cwd, summary: '', startTime: '', endTime: '',
    durationMs: 0, complete: false, userMessages: 0, assistantTurns: 0,
    outputTokens: 0, premiumRequests: 0, toolUsage: {}, gitCommits: [],
    filesCreated: [], filesEdited: [], fileChanges: [], errors: [], taskCompletions: [],
    agent: 'claude',
  };

  await parseJsonlChunked(content, (event) => {
    const type = (event.type ?? event.role ?? '') as string;
    const ts = event.timestamp as string | undefined;
    if (ts && !report.startTime) report.startTime = ts;
    if (ts) report.endTime = ts;
    if (type === 'human' || type === 'user') report.userMessages++;
    if (type === 'assistant') {
      report.assistantTurns++;
      if (event.stop_reason === 'end_turn') report.complete = true;
    }
    if (type === 'result') report.complete = true;
    if (type === 'tool_use' || type === 'tool_result') {
      const name = (event.name ?? 'tool') as string;
      report.toolUsage[name] = (report.toolUsage[name] ?? 0) + 1;
      if (type === 'tool_use') {
        const inp = event.input as Record<string, string> | undefined;
        if (name === 'Write' || name === 'Create') {
          const path = inp?.file_path ?? inp?.path;
          if (path) {
            report.filesCreated.push(path);
            report.fileChanges.push({ path, type: 'create', content: (inp?.content ?? inp?.file_text)?.slice(0, 5000) });
          }
        }
        if (name === 'Edit') {
          const path = inp?.file_path ?? inp?.path;
          if (path) {
            if (!report.filesEdited.includes(path)) report.filesEdited.push(path);
            report.fileChanges.push({ path, type: 'edit', oldStr: inp?.old_str?.slice(0, 3000), newStr: inp?.new_str?.slice(0, 3000) });
          }
        }
      }
    }
  });

  if (report.startTime && report.endTime) {
    report.durationMs = new Date(report.endTime).getTime() - new Date(report.startTime).getTime();
  }
  return report;
}

// ══════════════════════════════════════════════════════════════════
// REACTIVE DATA STORE
// ══════════════════════════════════════════════════════════════════

export type StoreEvent =
  | 'sessions'    // session list updated
  | 'processes'   // process list updated
  | 'detail';     // detail report ready for a session

export class DashboardStore extends EventEmitter {
  sessions: Session[] = [];
  processes: ProcessInfo[] = [];
  details = new Map<string, SessionReport | null>();

  private limit: number;
  private sessionsTimer: ReturnType<typeof setInterval> | null = null;
  private procsTimer: ReturnType<typeof setInterval> | null = null;
  private detailPending: string | null = null;
  private detailDebounce: ReturnType<typeof setTimeout> | null = null;
  private refreshing = { sessions: false, procs: false, detail: false };

  constructor(limit = 20) {
    super();
    this.limit = limit;
  }

  // ── Start auto-refresh loops ───────────────────────────────────
  start(sessionIntervalMs = 2000, procsIntervalMs = 3000): void {
    // Initial fetch
    this.refreshSessions();
    this.refreshProcesses();

    this.sessionsTimer = setInterval(() => this.refreshSessions(), sessionIntervalMs);
    this.procsTimer = setInterval(() => this.refreshProcesses(), procsIntervalMs);
  }

  stop(): void {
    if (this.sessionsTimer) clearInterval(this.sessionsTimer);
    if (this.procsTimer) clearInterval(this.procsTimer);
    if (this.detailDebounce) clearTimeout(this.detailDebounce);
  }

  // ── Async session refresh (non-blocking) ───────────────────────
  private async refreshSessions(): Promise<void> {
    if (this.refreshing.sessions) return; // skip if previous still running
    this.refreshing.sessions = true;
    try {
      const [copilot, claude] = await Promise.all([
        listCopilotSessionsAsync(this.limit),
        listClaudeSessionsAsync(this.limit),
      ]);
      const merged = [...copilot, ...claude]
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, this.limit);
      this.sessions = merged;
      this.emit('sessions');
    } catch { /* keep stale */ }
    this.refreshing.sessions = false;
  }

  // ── Async process refresh (non-blocking) ───────────────────────
  private async refreshProcesses(): Promise<void> {
    if (this.refreshing.procs) return;
    this.refreshing.procs = true;
    try {
      this.processes = await findProcessesAsync();
      this.emit('processes');
    } catch { /* keep stale */ }
    this.refreshing.procs = false;
  }

  // ── Request detail for a session (debounced 150ms) ─────────────
  requestDetail(sessionId: string, agent: AgentType, force = false): void {
    // If cached and not forced, emit immediately
    if (!force && this.details.has(sessionId)) {
      this.emit('detail', sessionId);
      return;
    }

    this.detailPending = sessionId;
    if (this.detailDebounce) clearTimeout(this.detailDebounce);
    this.detailDebounce = setTimeout(() => {
      this.detailDebounce = null;
      // Check if still the same request (user might have moved)
      if (this.detailPending !== sessionId) return;
      this.loadDetail(sessionId, agent);
    }, 150);
  }

  // ── Force-load detail immediately (Enter key) ──────────────────
  requestDetailNow(sessionId: string, agent: AgentType): void {
    if (this.detailDebounce) clearTimeout(this.detailDebounce);
    this.detailPending = sessionId;
    // Delete cache so it always re-parses fresh
    this.details.delete(sessionId);
    // Don't check refreshing.detail — force a new load
    this.loadDetailForce(sessionId, agent);
  }

  // ── Async detail loading (non-blocking JSONL parse) ────────────
  private async loadDetail(sessionId: string, agent: AgentType): Promise<void> {
    if (this.refreshing.detail) return;
    this.refreshing.detail = true;
    try {
      const report = await loadReportAsync(sessionId, agent);
      this.details.set(sessionId, report);
      if (this.details.size > 15) {
        const first = this.details.keys().next().value;
        if (first && first !== sessionId) this.details.delete(first);
      }
      this.emit('detail', sessionId);
    } catch { /* skip */ }
    this.refreshing.detail = false;
  }

  // ── Force load (bypasses refreshing guard) ─────────────────────
  private async loadDetailForce(sessionId: string, agent: AgentType): Promise<void> {
    this.refreshing.detail = true;
    try {
      const report = await loadReportAsync(sessionId, agent);
      this.details.set(sessionId, report);
      this.emit('detail', sessionId);
    } catch { /* skip */ }
    this.refreshing.detail = false;
  }

  // ── Force full refresh (r key) ─────────────────────────────────
  forceRefresh(): void {
    this.details.clear();
    this.refreshSessions();
    this.refreshProcesses();
  }
}
