import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { findUpSync } from 'find-up';

export interface AgentConfig {
  agent?: 'copilot' | 'claude';
  steps?: number;
  worktree?: boolean;
  cooldown?: number;
  maxPremium?: number;
  maxTasks?: number;
  autopr?: boolean;
  until?: string;
  refreshInterval?: number;
}

const CONFIG_DIR = join(homedir(), '.copilot-agent');
const GLOBAL_CONFIG = join(CONFIG_DIR, 'config.yaml');
const PROJECT_CONFIG_NAME = '.copilot-agent.yaml';

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadGlobalConfig(): AgentConfig {
  if (!existsSync(GLOBAL_CONFIG)) return {};
  try {
    return parseYaml(readFileSync(GLOBAL_CONFIG, 'utf-8')) || {};
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: AgentConfig): void {
  ensureConfigDir();
  writeFileSync(GLOBAL_CONFIG, stringifyYaml(config), 'utf-8');
}

export function loadProjectConfig(cwd?: string): AgentConfig {
  const configPath = findUpSync(PROJECT_CONFIG_NAME, { cwd: cwd || process.cwd() });
  if (!configPath) return {};
  try {
    return parseYaml(readFileSync(configPath, 'utf-8')) || {};
  } catch {
    return {};
  }
}

export function resolveConfig(cliOpts: Partial<AgentConfig> = {}, cwd?: string): AgentConfig {
  const defaults: AgentConfig = { steps: 30, cooldown: 10, maxPremium: 50, maxTasks: 5, refreshInterval: 5 };
  const global = loadGlobalConfig();
  const project = loadProjectConfig(cwd);
  // Merge: defaults → global → project → CLI (later wins, undefined skipped)
  const merged = { ...defaults };
  for (const src of [global, project, cliOpts]) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined) (merged as any)[k] = v;
    }
  }
  return merged;
}

export function getConfigValue(key: string): unknown {
  const config = loadGlobalConfig();
  return (config as any)[key];
}

export function setConfigValue(key: string, value: string): void {
  const config = loadGlobalConfig();
  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
  (config as any)[key] = parsed;
  saveGlobalConfig(config);
}

export function deleteConfigValue(key: string): void {
  const config = loadGlobalConfig();
  delete (config as any)[key];
  saveGlobalConfig(config);
}

export function resetConfig(): void {
  if (existsSync(GLOBAL_CONFIG)) {
    writeFileSync(GLOBAL_CONFIG, '', 'utf-8');
  }
}
