import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { listAllSessions, getAgentSessionReport } from './session.js';
import type { AgentType } from './provider.js';

const DATA_DIR = join(homedir(), '.copilot-agent');
const USAGE_FILE = join(DATA_DIR, 'usage.jsonl');

interface UsageEntry {
  timestamp: string;
  sessionId: string;
  agent: AgentType;
  premium: number;
  tokens: number;
  turns: number;
  duration: number;
  project: string;
}

interface UsageSummary {
  total: { sessions: number; premium: number; tokens: number; turns: number; durationMs: number };
  copilot: { sessions: number; premium: number; tokens: number };
  claude: { sessions: number; premium: number; tokens: number };
  byDay: Record<string, { premium: number; tokens: number; sessions: number }>;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function recordUsage(entry: UsageEntry): void {
  ensureDir();
  appendFileSync(USAGE_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

export function loadUsageHistory(): UsageEntry[] {
  if (!existsSync(USAGE_FILE)) return [];
  try {
    return readFileSync(USAGE_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export function buildUsageSummary(days?: number): UsageSummary {
  const sessions = listAllSessions(500);

  const cutoff = days ? Date.now() - days * 86_400_000 : 0;
  const filtered = sessions.filter(s => s.mtime >= cutoff);

  const summary: UsageSummary = {
    total: { sessions: 0, premium: 0, tokens: 0, turns: 0, durationMs: 0 },
    copilot: { sessions: 0, premium: 0, tokens: 0 },
    claude: { sessions: 0, premium: 0, tokens: 0 },
    byDay: {},
  };

  for (const s of filtered) {
    const report = getAgentSessionReport(s.id, s.agent);
    if (!report) continue;

    summary.total.sessions++;
    summary.total.premium += report.premiumRequests;
    summary.total.tokens += report.outputTokens;
    summary.total.turns += report.assistantTurns;
    summary.total.durationMs += report.durationMs;

    const bucket = s.agent === 'claude' ? summary.claude : summary.copilot;
    bucket.sessions++;
    bucket.premium += report.premiumRequests;
    bucket.tokens += report.outputTokens;

    const day = new Date(s.mtime).toISOString().slice(0, 10);
    if (!summary.byDay[day]) summary.byDay[day] = { premium: 0, tokens: 0, sessions: 0 };
    summary.byDay[day].premium += report.premiumRequests;
    summary.byDay[day].tokens += report.outputTokens;
    summary.byDay[day].sessions++;
  }

  return summary;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDurationShort(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
