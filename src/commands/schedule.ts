import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runAgentTask } from '../lib/process.js';
import { resolveAgent, assertAgent, type AgentType } from '../lib/provider.js';
import { log, ok, warn, fail, info } from '../lib/logger.js';
import { BOLD, CYAN, DIM, RESET, YELLOW, GREEN } from '../lib/colors.js';

// ─── Types ───

interface Schedule {
  name: string;
  cron: string;
  prompt: string;
  project: string;
  agent: AgentType;
  enabled: boolean;
  maxSteps?: number;
}

// ─── Paths ───

const CONFIG_DIR = join(homedir(), '.copilot-agent');
const SCHEDULES_FILE = join(CONFIG_DIR, 'schedules.yaml');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

// ─── Schedule persistence ───

function loadSchedules(): Schedule[] {
  if (!existsSync(SCHEDULES_FILE)) return [];
  try {
    const raw = parseYaml(readFileSync(SCHEDULES_FILE, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveSchedules(schedules: Schedule[]): void {
  ensureConfigDir();
  writeFileSync(SCHEDULES_FILE, stringifyYaml(schedules), 'utf-8');
}

// ─── Cron matching ───

export function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minPart, hourPart, , , dowPart] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dow = date.getDay(); // 0=Sun

  if (!matchField(minPart, minute)) return false;
  if (!matchField(hourPart, hour)) return false;
  if (!matchField(dowPart, dow)) return false;

  return true;
}

function matchField(pattern: string, value: number): boolean {
  if (pattern === '*') return true;

  // */N — every N
  const stepMatch = pattern.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    return step > 0 && value % step === 0;
  }

  // Exact number
  const num = parseInt(pattern, 10);
  if (!isNaN(num)) return value === num;

  return false;
}

// ─── Next run calculation ───

function nextRunTime(cron: string): Date | null {
  const now = new Date();
  // Check each minute in the next 7 days
  const limit = 7 * 24 * 60;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  for (let i = 1; i <= limit; i++) {
    candidate.setMinutes(candidate.getMinutes() + 1);
    if (matchesCron(cron, candidate)) return new Date(candidate);
  }
  return null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(date: Date): string {
  const day = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} ${formatTime(date)}`;
}

function timestamp(): string {
  return `${DIM}[${formatTime(new Date())}]${RESET}`;
}

// ─── Commands ───

function listCommand(): void {
  const schedules = loadSchedules();
  if (schedules.length === 0) {
    info('No schedules configured.');
    info(`Add one with: ${CYAN}copilot-agent schedule add <name> --cron "..." --prompt "..."${RESET}`);
    return;
  }

  log(`\n${BOLD}Schedules${RESET} ${DIM}(${SCHEDULES_FILE})${RESET}\n`);

  for (const s of schedules) {
    const status = s.enabled ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    const next = s.enabled ? nextRunTime(s.cron) : null;
    const nextStr = next ? `${DIM}next: ${formatDateTime(next)}${RESET}` : '';
    log(`  ${status} ${BOLD}${s.name}${RESET}  ${DIM}${s.cron}${RESET}  ${nextStr}`);
    log(`    ${DIM}prompt:${RESET}  ${s.prompt.length > 60 ? s.prompt.slice(0, 57) + '...' : s.prompt}`);
    log(`    ${DIM}project:${RESET} ${s.project}  ${DIM}agent:${RESET} ${s.agent}  ${DIM}steps:${RESET} ${s.maxSteps ?? 30}`);
    log('');
  }
}

interface AddOptions {
  cron: string;
  prompt: string;
  project: string;
  agent?: string;
  steps: string;
  disabled: boolean;
}

function addCommand(name: string, opts: AddOptions): void {
  const schedules = loadSchedules();

  if (schedules.some(s => s.name === name)) {
    fail(`Schedule "${name}" already exists. Remove it first or use a different name.`);
    process.exit(1);
  }

  // Validate cron by testing it
  if (!opts.cron || opts.cron.trim().split(/\s+/).length !== 5) {
    fail('Invalid cron expression. Expected 5 fields: minute hour day month weekday');
    process.exit(1);
  }

  const schedule: Schedule = {
    name,
    cron: opts.cron,
    prompt: opts.prompt,
    project: opts.project || process.cwd(),
    agent: resolveAgent(opts.agent),
    enabled: !opts.disabled,
    maxSteps: parseInt(opts.steps, 10) || 30,
  };

  schedules.push(schedule);
  saveSchedules(schedules);

  ok(`Added schedule "${name}"`);
  const next = nextRunTime(schedule.cron);
  if (next) {
    info(`Next run: ${formatDateTime(next)}`);
  }
}

function removeCommand(name: string): void {
  const schedules = loadSchedules();
  const idx = schedules.findIndex(s => s.name === name);

  if (idx === -1) {
    fail(`Schedule "${name}" not found.`);
    process.exit(1);
  }

  schedules.splice(idx, 1);
  saveSchedules(schedules);
  ok(`Removed schedule "${name}"`);
}

function dryRunCommand(): void {
  const schedules = loadSchedules().filter(s => s.enabled);

  if (schedules.length === 0) {
    info('No enabled schedules.');
    return;
  }

  log(`\n${BOLD}Dry run — what would run next${RESET}\n`);

  for (const s of schedules) {
    const next = nextRunTime(s.cron);
    if (next) {
      log(`  ${CYAN}${s.name}${RESET}  →  ${formatDateTime(next)}`);
      log(`    ${DIM}${s.agent}${RESET} in ${s.project}`);
      log(`    ${DIM}prompt:${RESET} ${s.prompt.length > 70 ? s.prompt.slice(0, 67) + '...' : s.prompt}`);
      log('');
    }
  }
}

async function runDaemon(): Promise<void> {
  const schedules = loadSchedules();
  const enabled = schedules.filter(s => s.enabled);

  if (enabled.length === 0) {
    fail('No enabled schedules. Add one first.');
    process.exit(1);
  }

  for (const s of enabled) {
    assertAgent(s.agent);
  }

  log(`\n${BOLD}${CYAN}Scheduler daemon started${RESET}`);
  info(`${enabled.length} schedule(s) active. Press Ctrl+C to stop.\n`);

  const lastRun = new Map<string, number>();

  const showStatus = () => {
    const now = new Date();
    let soonestName = '';
    let soonestTime: Date | null = null;

    for (const s of enabled) {
      const next = nextRunTime(s.cron);
      if (next && (!soonestTime || next < soonestTime)) {
        soonestTime = next;
        soonestName = s.name;
      }
    }

    const nextStr = soonestTime
      ? `next: ${CYAN}${soonestName}${RESET} at ${formatTime(soonestTime)}`
      : 'no upcoming runs';
    log(`${timestamp()} ${DIM}Scheduler running — ${enabled.length} schedules, ${nextStr}${RESET}`);
  };

  showStatus();

  const check = async () => {
    const now = new Date();
    // Normalize to the start of the current minute
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

    for (const s of enabled) {
      if (!matchesCron(s.cron, now)) continue;

      const runKey = `${s.name}:${minuteKey}`;
      if (lastRun.has(runKey)) continue;
      lastRun.set(runKey, Date.now());

      // Prune old entries
      const cutoff = Date.now() - 2 * 60 * 1000;
      for (const [k, v] of lastRun) {
        if (v < cutoff) lastRun.delete(k);
      }

      log(`\n${timestamp()} ${BOLD}${YELLOW}▶ Running: ${s.name}${RESET}`);
      log(`  ${DIM}cron:${RESET} ${s.cron}  ${DIM}agent:${RESET} ${s.agent}  ${DIM}project:${RESET} ${s.project}`);
      log(`  ${DIM}prompt:${RESET} ${s.prompt}`);

      try {
        const result = await runAgentTask(
          s.agent,
          s.prompt,
          s.maxSteps ?? 30,
          s.project,
        );
        if (result.exitCode === 0) {
          ok(`${timestamp()} ✓ ${s.name} completed (session: ${result.sessionId?.slice(0, 8) ?? 'n/a'})`);
        } else {
          warn(`${timestamp()} ${s.name} exited with code ${result.exitCode}`);
        }
      } catch (err) {
        fail(`${timestamp()} ${s.name} failed: ${err instanceof Error ? err.message : err}`);
      }

      showStatus();
    }
  };

  // Initial check
  await check();

  // Check every 60 seconds
  const interval = setInterval(() => {
    check().catch(err => {
      fail(`Scheduler error: ${err instanceof Error ? err.message : err}`);
    });
  }, 60_000);

  // Graceful shutdown
  const shutdown = () => {
    log(`\n${timestamp()} ${DIM}Scheduler stopped.${RESET}`);
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {});
}

// ─── Registration ───

export function registerScheduleCommand(program: Command): void {
  const cmd = program
    .command('schedule')
    .description('Cron-like recurring task scheduler');

  cmd
    .command('list')
    .description('Show all configured schedules')
    .action(() => {
      listCommand();
    });

  cmd
    .command('add <name>')
    .description('Add a recurring schedule')
    .requiredOption('--cron <expression>', 'Cron expression (e.g. "0 */6 * * *")')
    .requiredOption('--prompt <text>', 'Agent prompt to execute')
    .option('--project <path>', 'Project directory', process.cwd())
    .option('-a, --agent <type>', 'Agent: copilot or claude')
    .option('-s, --steps <n>', 'Max autopilot steps', '30')
    .option('--disabled', 'Add as disabled')
    .action((name: string, opts: AddOptions) => {
      addCommand(name, opts);
    });

  cmd
    .command('remove <name>')
    .description('Remove a schedule')
    .action((name: string) => {
      removeCommand(name);
    });

  cmd
    .command('run')
    .description('Start the scheduler daemon (foreground)')
    .action(async () => {
      try {
        await runDaemon();
      } catch (err) {
        fail(`Scheduler error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  cmd
    .command('dry-run')
    .description('Show what would run next for each schedule')
    .action(() => {
      dryRunCommand();
    });
}
