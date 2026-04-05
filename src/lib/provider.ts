import { execSync } from 'node:child_process';

export type AgentType = 'copilot' | 'claude';

export interface AgentProcess {
  pid: number;
  command: string;
  sessionId?: string;
  cwd?: string;
  agent: AgentType;
}

export interface AgentResult {
  exitCode: number;
  sessionId: string | null;
  premium: number;
}

/**
 * Detect which agent CLIs are available.
 */
export function detectAvailableAgents(): AgentType[] {
  const agents: AgentType[] = [];
  try {
    execSync('which copilot', { stdio: 'pipe' });
    agents.push('copilot');
  } catch { /* not installed */ }
  try {
    execSync('which claude', { stdio: 'pipe' });
    agents.push('claude');
  } catch { /* not installed */ }
  return agents;
}

/**
 * Resolve agent type: explicit choice > auto-detect (copilot first for backward compat).
 */
export function resolveAgent(explicit?: string): AgentType {
  if (explicit === 'copilot' || explicit === 'claude') return explicit;
  const available = detectAvailableAgents();
  if (available.includes('copilot')) return 'copilot';
  if (available.includes('claude')) return 'claude';
  return 'copilot'; // will fail with helpful message later
}

export function isAgentInstalled(agent: AgentType): boolean {
  try {
    execSync(`which ${agent}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function assertAgent(agent: AgentType): void {
  if (!isAgentInstalled(agent)) {
    const installHint = agent === 'copilot'
      ? 'npm i -g @githubnext/copilot'
      : 'npm i -g @anthropic-ai/claude-code';
    console.error(`✖ ${agent} CLI not found. Install with: ${installHint}`);
    process.exit(1);
  }
}
