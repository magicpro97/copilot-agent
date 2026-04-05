import type { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectProjectType, detectProjectName } from '../lib/detect.js';
import { getTasksForProject } from '../lib/tasks.js';
import { runAgentTask, findAgentProcesses } from '../lib/process.js';
import { resolveAgent, assertAgent, type AgentType } from '../lib/provider.js';
import { withLock } from '../lib/lock.js';
import { log, ok, warn, fail, notify, setLogFile } from '../lib/logger.js';

const CONFIG_DIR = join(homedir(), '.copilot-agent');
const PROJECTS_FILE = join(CONFIG_DIR, 'multi-projects.txt');
const STATUS_FILE = join(CONFIG_DIR, 'multi-status.yaml');
const LOG_DIR = join(CONFIG_DIR, 'multi-logs');

const MAX_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultiOptions {
  agent: AgentType;
  parallel: boolean;
  cooldown: number;
  steps: number;
  maxPremium: number;
  dryRun: boolean;
}

interface ProjectStatus {
  project: string;
  lastRun: string;
  status: 'success' | 'failed' | 'running';
  agent: AgentType;
  tasks: number;
  duration: string;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMultiCommand(program: Command): void {
  program
    .command('multi <action> [args...]')
    .description('Multi-project orchestration — add/remove/list/run/status/research')
    .option('-a, --agent <type>', 'Agent to use (copilot or claude)', 'copilot')
    .option('--parallel', 'Run projects in parallel (max 3 concurrent)')
    .option('--cooldown <n>', 'Cooldown between projects in seconds', '30')
    .option('-s, --steps <n>', 'Max steps per task', '10')
    .option('--max-premium <n>', 'Premium budget per project', '50')
    .option('--dry-run', 'Preview without executing')
    .action(async (action: string, args: string[], opts) => {
      try {
        await multiCommand(action, args, {
          agent: resolveAgent(opts.agent),
          parallel: opts.parallel ?? false,
          cooldown: parseInt(opts.cooldown, 10),
          steps: parseInt(opts.steps, 10),
          maxPremium: parseInt(opts.maxPremium, 10),
          dryRun: opts.dryRun ?? false,
        });
      } catch (err) {
        fail(`Multi error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function multiCommand(
  action: string,
  args: string[],
  opts: MultiOptions,
): Promise<void> {
  ensureFiles();

  switch (action) {
    case 'add':
      return addProject(args[0]);
    case 'remove':
      return removeProject(args[0]);
    case 'list':
      return listProjects();
    case 'status':
      return showStatus();
    case 'run':
    case 'health':
      return runAll('health', opts);
    case 'research':
      return runAll('research', opts);
    default:
      fail(`Unknown action: ${action}. Use: add, remove, list, run, status, research`);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureFiles(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PROJECTS_FILE)) writeFileSync(PROJECTS_FILE, '');
}

function readProjects(): string[] {
  return readFileSync(PROJECTS_FILE, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function writeProjects(projects: string[]): void {
  writeFileSync(PROJECTS_FILE, projects.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Status persistence
// ---------------------------------------------------------------------------

function readStatusFile(): ProjectStatus[] {
  if (!existsSync(STATUS_FILE)) return [];
  try {
    const raw = readFileSync(STATUS_FILE, 'utf-8');
    const parsed: unknown = parseYaml(raw);
    return Array.isArray(parsed) ? (parsed as ProjectStatus[]) : [];
  } catch {
    return [];
  }
}

function writeStatusFile(statuses: ProjectStatus[]): void {
  writeFileSync(STATUS_FILE, stringifyYaml(statuses));
}

function upsertStatus(entry: ProjectStatus): void {
  const statuses = readStatusFile();
  const idx = statuses.findIndex((s) => s.project === entry.project);
  if (idx >= 0) {
    statuses[idx] = entry;
  } else {
    statuses.push(entry);
  }
  writeStatusFile(statuses);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

// ---------------------------------------------------------------------------
// Actions: add / remove / list / status
// ---------------------------------------------------------------------------

async function addProject(path: string | undefined): Promise<void> {
  if (!path) {
    fail('Usage: copilot-agent multi add <path>');
    process.exit(1);
  }

  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    fail(`Not found: ${resolved}`);
    process.exit(1);
  }

  await withLock('projects-file', async () => {
    const projects = readProjects();
    if (projects.includes(resolved)) {
      warn(`Already registered: ${resolved}`);
      return;
    }
    projects.push(resolved);
    writeProjects(projects);
    ok(`Added: ${resolved}`);
  });
}

async function removeProject(path: string | undefined): Promise<void> {
  if (!path) {
    fail('Usage: copilot-agent multi remove <path>');
    process.exit(1);
  }

  const resolved = resolve(path);

  await withLock('projects-file', async () => {
    const projects = readProjects();
    const filtered = projects.filter((p) => p !== resolved);
    if (filtered.length === projects.length) {
      warn(`Not registered: ${resolved}`);
      return;
    }
    writeProjects(filtered);
    ok(`Removed: ${resolved}`);
  });
}

function listProjects(): void {
  const projects = readProjects();
  if (projects.length === 0) {
    log('No projects registered. Add: copilot-agent multi add <path>');
    return;
  }

  const statuses = readStatusFile();

  console.log(chalk.bold('\nRegistered projects:'));
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const exists = existsSync(p);
    const icon = exists ? chalk.green('✅') : chalk.red('❌');
    const type = exists ? detectProjectType(p) : '?';
    const st = statuses.find((s) => s.project === p);
    const statusTag = st
      ? chalk.dim(` [${st.status} — ${st.agent} — ${st.duration}]`)
      : '';
    console.log(`  ${i + 1}. ${icon} ${p} ${chalk.dim(`(${type})`)}${statusTag}`);
  }
  console.log();
}

function showStatus(): void {
  const statuses = readStatusFile();
  if (statuses.length === 0) {
    log('No run history. Execute: copilot-agent multi run');
    return;
  }

  console.log(chalk.bold('\nMulti-project status:'));
  for (const s of statuses) {
    const icon =
      s.status === 'success' ? chalk.green('✅') :
      s.status === 'failed'  ? chalk.red('❌') :
      chalk.yellow('🔄');
    console.log(
      `  ${icon} ${chalk.bold(basename(s.project))} — ${s.agent} — ${s.tasks} tasks — ${s.duration} — ${chalk.dim(s.lastRun)}`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Parallel concurrency limiter
// ---------------------------------------------------------------------------

function createSemaphore(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (running < max) {
      running++;
      return;
    }
    return new Promise<void>((resolve) => {
      queue.push(() => { running++; resolve(); });
    });
  }

  function release(): void {
    running--;
    const next = queue.shift();
    if (next) next();
  }

  return { acquire, release };
}

// ---------------------------------------------------------------------------
// Core: run all projects
// ---------------------------------------------------------------------------

async function runAll(mode: string, opts: MultiOptions): Promise<void> {
  assertAgent(opts.agent);

  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  setLogFile(join(LOG_DIR, `multi-${mode}-${ts}.log`));

  const projects = readProjects();
  if (projects.length === 0) {
    fail('No projects registered. Add: copilot-agent multi add <path>');
    process.exit(1);
  }

  log(`🏭 Multi-project ${mode} — ${projects.length} projects — agent: ${opts.agent}${opts.parallel ? ' (parallel)' : ''}`);

  if (opts.dryRun) {
    for (const p of projects) {
      const type = existsSync(p) ? detectProjectType(p) : 'unknown';
      const tasks = getTasksForProject(type);
      console.log(`\n${chalk.bold(basename(p))} (${type})`);
      for (const t of tasks.slice(0, 3)) {
        console.log(`  ${chalk.dim('•')} ${t.title}`);
      }
    }
    log(chalk.dim('\n(dry-run — not executing)'));
    return;
  }

  const results: Array<{ name: string; success: boolean; skipped: boolean }> = [];

  if (opts.parallel) {
    const sem = createSemaphore(MAX_CONCURRENCY);
    const promises = projects.map(async (project) => {
      await sem.acquire();
      try {
        const res = await runSingleProject(project, mode, opts);
        results.push(res);
      } finally {
        sem.release();
      }
    });
    await Promise.all(promises);
  } else {
    for (let i = 0; i < projects.length; i++) {
      const res = await runSingleProject(projects[i], mode, opts);
      results.push(res);

      if (i < projects.length - 1 && !res.skipped) {
        log(`Cooldown ${opts.cooldown}s…`);
        await new Promise((r) => setTimeout(r, opts.cooldown * 1000));
      }
    }
  }

  const success = results.filter((r) => r.success && !r.skipped).length;
  const failed = results.filter((r) => !r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = results.length;

  console.log(`\n${'═'.repeat(50)}`);
  log(`📊 Summary: ${success}/${total} succeeded, ${failed} failed, ${skipped} skipped`);
  for (const r of results) {
    const icon = r.skipped ? '⏭ ' : r.success ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
  }
  console.log();

  notify(`Multi-${mode}: ${success}/${total} succeeded`, 'copilot-agent');
}

async function runSingleProject(
  project: string,
  mode: string,
  opts: MultiOptions,
): Promise<{ name: string; success: boolean; skipped: boolean }> {
  const name = existsSync(project) ? detectProjectName(project) : basename(project);

  if (!existsSync(project)) {
    warn(`Skipping (not found): ${project}`);
    return { name, success: false, skipped: true };
  }

  const type = detectProjectType(project);
  log(`\n${'═'.repeat(50)}`);
  log(`${chalk.bold(name)} (${type}) — agent: ${opts.agent}`);
  log(`${'═'.repeat(50)}`);

  const tasks =
    mode === 'research'
      ? [{ title: 'Research', prompt: 'Research latest best practices, dependency updates, and architecture improvements. Create a report.', priority: 1 }]
      : getTasksForProject(type).slice(0, 3);

  const startTime = Date.now();
  let projectSuccess = true;

  upsertStatus({
    project,
    lastRun: new Date().toISOString(),
    status: 'running',
    agent: opts.agent,
    tasks: tasks.length,
    duration: '—',
  });

  for (const task of tasks) {
    try {
      const result = await withLock('agent-multi', () =>
        runAgentTask(opts.agent, `Project: ${project}\n\n${task.prompt}`, opts.steps, project),
      );
      ok(`${task.title} — exit ${result.exitCode}, premium: ${result.premium}`);
    } catch (err) {
      fail(`${task.title} failed: ${err}`);
      projectSuccess = false;
    }
  }

  const duration = formatDuration(Date.now() - startTime);

  upsertStatus({
    project,
    lastRun: new Date().toISOString(),
    status: projectSuccess ? 'success' : 'failed',
    agent: opts.agent,
    tasks: tasks.length,
    duration,
  });

  return { name, success: projectSuccess, skipped: false };
}
