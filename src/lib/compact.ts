import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getAgentSessionReport, type SessionReport } from './session.js';
import type { AgentType } from './provider.js';

const COMPACT_DIR = join(homedir(), '.copilot-agent', 'compacts');

function ensureDir(): void {
  if (!existsSync(COMPACT_DIR)) mkdirSync(COMPACT_DIR, { recursive: true });
}

export interface CompactSummary {
  sessionId: string;
  agent: AgentType;
  project: string;
  summary: string;
  done: string[];
  remaining: string[];
  filesChanged: string[];
  commits: string[];
  errors: string[];
  stats: {
    turns: number;
    tokens: number;
    premium: number;
    duration: string;
  };
  markdown: string;
}

export function compactSession(sessionId: string, agent?: AgentType): CompactSummary | null {
  const report = getAgentSessionReport(sessionId, agent);
  if (!report) return null;

  const project = report.cwd?.split('/').pop() || 'unknown';

  // Determine done items from task completions and commits
  const done: string[] = [];
  for (const task of report.taskCompletions) {
    done.push(task.split('\n')[0].slice(0, 100));
  }
  for (const file of report.filesCreated) {
    done.push(`Created ${file}`);
  }
  for (const file of report.filesEdited) {
    done.push(`Edited ${file}`);
  }

  // Determine remaining work from errors and incomplete status
  const remaining: string[] = [];
  if (!report.complete) {
    remaining.push('Session was interrupted before completion');
  }
  for (const err of report.errors) {
    remaining.push(`Fix: ${err.split('\n')[0].slice(0, 100)}`);
  }

  const filesChanged = [
    ...report.filesCreated.map(f => `+ ${f}`),
    ...report.filesEdited.map(f => `~ ${f}`),
  ];

  const commits = report.gitCommits.map(c => c.split('\n')[0].slice(0, 100));

  const durationMs = report.durationMs;
  const durationStr = durationMs < 60_000
    ? `${Math.round(durationMs / 1000)}s`
    : durationMs < 3_600_000
    ? `${Math.round(durationMs / 60_000)}m`
    : `${Math.floor(durationMs / 3_600_000)}h ${Math.round((durationMs % 3_600_000) / 60_000)}m`;

  // Build markdown
  const lines: string[] = [];
  lines.push(`## Session Context (auto-generated)`);
  lines.push(`**Project:** ${project} | **Agent:** ${report.agent} | **Duration:** ${durationStr}`);
  lines.push(`**Turns:** ${report.assistantTurns} | **Tokens:** ${report.outputTokens.toLocaleString()} | **Premium:** ${report.premiumRequests}`);
  lines.push('');

  if (report.summary) {
    lines.push(`**Task:** ${report.summary}`);
    lines.push('');
  }

  if (done.length > 0) {
    lines.push('### ✅ Completed');
    for (const d of done) lines.push(`- ${d}`);
    lines.push('');
  }

  if (remaining.length > 0) {
    lines.push('### ⏳ Remaining');
    for (const r of remaining) lines.push(`- ${r}`);
    lines.push('');
  }

  if (commits.length > 0) {
    lines.push('### Git Commits');
    for (const c of commits) lines.push(`- ${c}`);
    lines.push('');
  }

  if (filesChanged.length > 0) {
    lines.push('### Files Changed');
    for (const f of filesChanged) lines.push(`- ${f}`);
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push('### ⚠️ Errors Encountered');
    for (const e of report.errors.slice(0, 5)) lines.push(`- ${e.split('\n')[0]}`);
    lines.push('');
  }

  // Key tools used
  const topTools = Object.entries(report.toolUsage).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topTools.length > 0) {
    lines.push('### Tools Used');
    for (const [tool, count] of topTools) lines.push(`- ${tool}: ${count}x`);
    lines.push('');
  }

  const markdown = lines.join('\n');

  return {
    sessionId,
    agent: report.agent,
    project,
    summary: report.summary || '',
    done,
    remaining,
    filesChanged,
    commits,
    errors: report.errors.map(e => e.split('\n')[0]),
    stats: {
      turns: report.assistantTurns,
      tokens: report.outputTokens,
      premium: report.premiumRequests,
      duration: durationStr,
    },
    markdown,
  };
}

export function saveCompact(compact: CompactSummary): string {
  ensureDir();
  const filename = `${compact.sessionId.slice(0, 12)}.md`;
  const filepath = join(COMPACT_DIR, filename);
  writeFileSync(filepath, compact.markdown, 'utf-8');
  return filepath;
}

export function buildResumePrompt(compact: CompactSummary): string {
  const parts: string[] = [];
  parts.push('Continue the previous task. Here is the context from the interrupted session:');
  parts.push('');
  if (compact.summary) parts.push(`Task: ${compact.summary}`);
  if (compact.done.length > 0) {
    parts.push('Already completed:');
    for (const d of compact.done.slice(0, 10)) parts.push(`- ${d}`);
  }
  if (compact.remaining.length > 0) {
    parts.push('Still needs to be done:');
    for (const r of compact.remaining) parts.push(`- ${r}`);
  }
  if (compact.errors.length > 0) {
    parts.push('Errors to address:');
    for (const e of compact.errors.slice(0, 3)) parts.push(`- ${e}`);
  }
  parts.push('');
  parts.push('Please continue where the previous session left off.');
  return parts.join('\n');
}
