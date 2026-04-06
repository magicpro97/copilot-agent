import type { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform, release, arch, cpus, totalmem } from 'os';
import { detectAvailableAgents } from '../lib/provider.js';
import { loadNotifyConfig } from '../lib/notify.js';
import { loadGlobalConfig } from '../lib/config.js';
import { loadHooksConfig, getHooksSummary } from '../lib/hooks.js';

interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
}

function check(label: string, fn: () => { status: CheckResult['status']; detail: string }): CheckResult {
  try {
    const { status, detail } = fn();
    return { label, status, detail };
  } catch (err: unknown) {
    return { label, status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

function getVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe', timeout: 5000 }).toString().trim().split('\n')[0];
  } catch { return null; }
}

function dirSize(dir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        files++;
        try { bytes += statSync(join(dir, e.name)).size; } catch { /* skip */ }
      } else if (e.isDirectory()) {
        const sub = dirSize(join(dir, e.name));
        files += sub.files;
        bytes += sub.bytes;
      }
    }
  } catch { /* skip */ }
  return { files, bytes };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system health and configuration')
    .option('--fix', 'Attempt to fix common issues')
    .action(async (opts: { fix?: boolean }) => {
      console.log(chalk.bold.cyan('\n  🩺 copilot-agent doctor\n'));

      const results: CheckResult[] = [];

      // ── System Info ───────────────────────────────────────────
      results.push(check('System', () => ({
        status: 'info',
        detail: `${platform()} ${release()} ${arch()} • ${cpus().length} cores • ${fmtBytes(totalmem())} RAM`,
      })));

      // ── Node.js ───────────────────────────────────────────────
      results.push(check('Node.js', () => {
        const ver = process.version;
        const major = parseInt(ver.slice(1));
        if (major < 18) return { status: 'error', detail: `${ver} — requires ≥18` };
        if (major < 20) return { status: 'warn', detail: `${ver} — recommend ≥20` };
        return { status: 'ok', detail: ver };
      }));

      // ── npm ───────────────────────────────────────────────────
      results.push(check('npm', () => {
        const ver = getVersion('npm --version');
        return ver ? { status: 'ok', detail: `v${ver}` } : { status: 'warn', detail: 'not found' };
      }));

      // ── Git ───────────────────────────────────────────────────
      results.push(check('Git', () => {
        const ver = getVersion('git --version');
        return ver ? { status: 'ok', detail: ver.replace('git version ', 'v') } : { status: 'error', detail: 'not found — required for many features' };
      }));

      // ── GitHub CLI ────────────────────────────────────────────
      results.push(check('GitHub CLI (gh)', () => {
        const ver = getVersion('gh --version');
        if (!ver) return { status: 'warn', detail: 'not found — needed for PR creation' };
        const firstLine = ver.split('\n')[0];
        return { status: 'ok', detail: firstLine };
      }));

      // ── Agent CLIs ────────────────────────────────────────────
      const agents = detectAvailableAgents();

      results.push(check('Copilot CLI', () => {
        if (!agents.includes('copilot')) return { status: 'warn', detail: 'not found — install: npm i -g @githubnext/copilot' };
        const ver = getVersion('copilot --version');
        return { status: 'ok', detail: ver || 'installed' };
      }));

      results.push(check('Claude Code', () => {
        if (!agents.includes('claude')) return { status: 'warn', detail: 'not found — install: npm i -g @anthropic-ai/claude-code' };
        const ver = getVersion('claude --version');
        return { status: 'ok', detail: ver || 'installed' };
      }));

      // ── Config directory ──────────────────────────────────────
      const configDir = join(homedir(), '.copilot-agent');
      results.push(check('Config directory', () => {
        if (!existsSync(configDir)) return { status: 'warn', detail: `${configDir} — not created yet (run any command to create)` };
        return { status: 'ok', detail: configDir };
      }));

      // ── Global config ─────────────────────────────────────────
      results.push(check('Global config', () => {
        const config = loadGlobalConfig();
        const keys = Object.keys(config).filter(k => (config as any)[k] !== undefined);
        if (keys.length === 0) return { status: 'info', detail: 'using defaults' };
        return { status: 'ok', detail: `${keys.length} settings: ${keys.join(', ')}` };
      }));

      // ── Session directories ───────────────────────────────────
      const copilotDir = join(homedir(), '.copilot');
      results.push(check('Copilot sessions', () => {
        if (!existsSync(copilotDir)) return { status: 'info', detail: 'no sessions yet' };
        const { files, bytes } = dirSize(copilotDir);
        return { status: 'ok', detail: `${files} files, ${fmtBytes(bytes)}` };
      }));

      const claudeDir = join(homedir(), '.claude', 'projects');
      results.push(check('Claude sessions', () => {
        if (!existsSync(claudeDir)) return { status: 'info', detail: 'no sessions yet' };
        const { files, bytes } = dirSize(claudeDir);
        return { status: 'ok', detail: `${files} files, ${fmtBytes(bytes)}` };
      }));

      // ── Hooks ─────────────────────────────────────────────────
      results.push(check('Hooks', () => {
        const config = loadHooksConfig();
        const summary = getHooksSummary(config);
        if (summary.length === 0) return { status: 'info', detail: 'none configured' };
        const total = summary.reduce((a, b) => a + b.count, 0);
        return { status: 'ok', detail: `${total} hooks across ${summary.length} events` };
      }));

      // ── Notifications ─────────────────────────────────────────
      results.push(check('Notifications', () => {
        const config = loadNotifyConfig();
        if (!config.enabled) return { status: 'info', detail: 'disabled — run: copilot-agent notify enable' };
        const providers = (config.providers || []).filter(p => p.enabled !== false);
        if (providers.length === 0) return { status: 'warn', detail: 'enabled but no providers — run: copilot-agent notify add <type>' };
        return { status: 'ok', detail: `${providers.length} provider(s): ${providers.map(p => p.name || p.type).join(', ')}` };
      }));

      // ── Proxy ─────────────────────────────────────────────────
      results.push(check('Copilot proxy', () => {
        try {
          const which = platform() === 'win32' ? 'where' : 'which';
          execSync(`${which} copilot-api`, { stdio: 'pipe' });
          return { status: 'ok', detail: 'copilot-api binary found' };
        } catch {
          return { status: 'info', detail: 'not installed (optional, for Claude via Copilot)' };
        }
      }));

      // ── Display results ───────────────────────────────────────
      let errors = 0, warnings = 0;
      for (const r of results) {
        let icon: string;
        switch (r.status) {
          case 'ok': icon = chalk.green('✔'); break;
          case 'warn': icon = chalk.yellow('⚠'); warnings++; break;
          case 'error': icon = chalk.red('✗'); errors++; break;
          case 'info': icon = chalk.blue('ℹ'); break;
        }
        console.log(`  ${icon} ${chalk.bold(r.label.padEnd(20))} ${chalk.dim(r.detail)}`);
      }

      // Summary
      console.log();
      if (errors > 0) {
        console.log(chalk.red(`  ${errors} error(s) found — some features may not work`));
      }
      if (warnings > 0) {
        console.log(chalk.yellow(`  ${warnings} warning(s) — optional improvements available`));
      }
      if (errors === 0 && warnings === 0) {
        console.log(chalk.green('  ✔ All checks passed — system is healthy!'));
      }
      console.log();
    });
}
