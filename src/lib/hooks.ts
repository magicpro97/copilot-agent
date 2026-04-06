import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import { findUpSync } from 'find-up';
import { execaCommand } from 'execa';

export type HookEvent = 'on_session_start' | 'on_task_complete' | 'on_session_end' | 'on_error' | 'on_resume' | 'on_pre_commit' | 'on_pre_push' | 'on_pre_pr';

export interface HookDef {
  command: string;
  name?: string;
  timeout?: number; // seconds, default 30
}

export interface HooksConfig {
  on_session_start?: HookDef[];
  on_task_complete?: HookDef[];
  on_session_end?: HookDef[];
  on_error?: HookDef[];
  on_resume?: HookDef[];
  on_pre_commit?: HookDef[];
  on_pre_push?: HookDef[];
  on_pre_pr?: HookDef[];
}

export interface HookResult {
  hook: HookDef;
  event: HookEvent;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

const GLOBAL_HOOKS = join(homedir(), '.copilot-agent', 'hooks.yaml');
const PROJECT_HOOKS = '.copilot-agent/hooks.yaml';

export function loadHooksConfig(cwd?: string): HooksConfig {
  const configs: HooksConfig[] = [];

  // Global hooks
  if (existsSync(GLOBAL_HOOKS)) {
    try {
      const parsed = parseYaml(readFileSync(GLOBAL_HOOKS, 'utf-8'));
      if (parsed) configs.push(parsed);
    } catch { /* ignore */ }
  }

  // Project hooks (find-up from cwd)
  const projectPath = findUpSync(PROJECT_HOOKS, { cwd: cwd || process.cwd(), type: 'file' });
  if (projectPath) {
    try {
      const parsed = parseYaml(readFileSync(projectPath, 'utf-8'));
      if (parsed) configs.push(parsed);
    } catch { /* ignore */ }
  }

  const ALL_EVENTS: HookEvent[] = ['on_session_start', 'on_task_complete', 'on_session_end', 'on_error', 'on_resume', 'on_pre_commit', 'on_pre_push', 'on_pre_pr'];

  // Merge: global first, then project
  const merged: HooksConfig = {};
  for (const cfg of configs) {
    for (const event of ALL_EVENTS) {
      const hooks = cfg[event];
      if (hooks && Array.isArray(hooks)) {
        if (!merged[event]) merged[event] = [];
        merged[event]!.push(...hooks);
      }
    }
  }
  return merged;
}

export async function runHooks(event: HookEvent, cwd?: string, env?: Record<string, string>): Promise<HookResult[]> {
  const config = loadHooksConfig(cwd);
  const hooks = config[event];
  if (!hooks || hooks.length === 0) return [];

  const results: HookResult[] = [];
  for (const hook of hooks) {
    const start = Date.now();
    try {
      const result = await execaCommand(hook.command, {
        cwd: cwd || process.cwd(),
        timeout: (hook.timeout || 30) * 1000,
        env: { ...process.env, ...env },
        reject: false,
      });
      results.push({
        hook,
        event,
        success: result.exitCode === 0,
        output: result.stdout?.slice(0, 500),
        error: result.exitCode !== 0 ? result.stderr?.slice(0, 500) : undefined,
        durationMs: Date.now() - start,
      });
    } catch (err: unknown) {
      results.push({
        hook,
        event,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
    }
  }
  return results;
}

export function getHooksSummary(config: HooksConfig): { event: string; count: number }[] {
  const events: HookEvent[] = ['on_session_start', 'on_task_complete', 'on_session_end', 'on_error', 'on_resume', 'on_pre_commit', 'on_pre_push', 'on_pre_pr'];
  return events
    .map(e => ({ event: e, count: config[e]?.length || 0 }))
    .filter(e => e.count > 0);
}
