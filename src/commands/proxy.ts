import type { Command } from 'commander';
import chalk from 'chalk';
import { execa } from 'execa';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PID_FILE = join(homedir(), '.copilot-agent', 'proxy.pid');
const DEFAULT_PORT = 4141;

function ensureDir(): void {
  const dir = join(homedir(), '.copilot-agent');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function findCopilotToken(): string | null {
  const appsPath = join(homedir(), '.config', 'github-copilot', 'apps.json');
  if (!existsSync(appsPath)) return null;
  try {
    const apps = JSON.parse(readFileSync(appsPath, 'utf-8'));
    for (const key of Object.keys(apps)) {
      const token = apps[key]?.oauth_token;
      if (token && token.startsWith('ghu_')) return token;
    }
    return null;
  } catch {
    return null;
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/v1/models`);
    return resp.ok;
  } catch {
    return false;
  }
}

export function registerProxyCommand(program: Command): void {
  const cmd = program
    .command('proxy')
    .description('Manage copilot-api proxy for Claude Code');

  cmd
    .command('start')
    .description('Start copilot-api proxy')
    .option('-p, --port <n>', 'Port number', String(DEFAULT_PORT))
    .option('--rate-limit <n>', 'Rate limit in seconds', '30')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      const rateLimit = parseInt(opts.rateLimit, 10);

      // Check if already running
      const existingPid = readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        const open = await isPortOpen(port);
        if (open) {
          console.log(chalk.yellow(`  ⚠ Proxy already running (PID ${existingPid}) on port ${port}`));
          return;
        }
      }

      // Find token
      const token = findCopilotToken();
      if (!token) {
        console.log(chalk.red('  ✗ No Copilot token found'));
        console.log(chalk.dim('    Expected: ~/.config/github-copilot/apps.json with ghu_* token'));
        console.log(chalk.dim('    Run: copilot-api auth   to authenticate'));
        return;
      }

      console.log(chalk.cyan('  Starting copilot-api proxy...'));
      console.log(chalk.dim(`  Token: ${token.slice(0, 8)}...${token.slice(-4)}`));
      console.log(chalk.dim(`  Port: ${port} | Rate limit: ${rateLimit}s`));

      try {
        const child = execa('copilot-api', [
          'start',
          '--github-token', token,
          '--rate-limit', String(rateLimit),
          '--wait',
          '--port', String(port),
        ], {
          detached: true,
          stdio: 'ignore',
        });

        if (child.pid) {
          child.unref();
          ensureDir();
          writeFileSync(PID_FILE, String(child.pid), 'utf-8');

          // Wait a moment for startup
          await new Promise(r => setTimeout(r, 2000));

          const open = await isPortOpen(port);
          if (open) {
            console.log(chalk.green(`  ✔ Proxy started (PID ${child.pid}) on http://localhost:${port}`));
          } else {
            console.log(chalk.yellow(`  ⚠ Proxy started (PID ${child.pid}) but port not yet responsive`));
            console.log(chalk.dim('    It may take a few seconds to initialize'));
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  ✗ Failed to start proxy: ${message}`));
        console.log(chalk.dim('    Make sure copilot-api is installed: npm install -g copilot-api'));
      }
    });

  cmd
    .command('stop')
    .description('Stop copilot-api proxy')
    .action(() => {
      const pid = readPid();
      if (!pid) {
        console.log(chalk.dim('  No proxy PID found'));
        return;
      }
      if (!isProcessRunning(pid)) {
        console.log(chalk.dim(`  Proxy (PID ${pid}) is not running`));
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
        console.log(chalk.green(`  ✔ Proxy stopped (PID ${pid})`));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  ✗ Failed to stop: ${message}`));
      }
    });

  cmd
    .command('status')
    .description('Check proxy status')
    .option('-p, --port <n>', 'Port number', String(DEFAULT_PORT))
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      const pid = readPid();
      const running = pid ? isProcessRunning(pid) : false;
      const open = await isPortOpen(port);

      console.log(chalk.bold.cyan('\n  Copilot API Proxy Status\n'));
      console.log(`  PID:      ${running ? chalk.green(String(pid)) : chalk.dim('not running')}`);
      console.log(`  Port:     ${open ? chalk.green(`localhost:${port} ✔`) : chalk.red(`localhost:${port} ✗`)}`);

      const token = findCopilotToken();
      console.log(`  Token:    ${token ? chalk.green(token.slice(0, 8) + '...' + token.slice(-4)) : chalk.red('not found')}`);

      if (open) {
        try {
          const resp = await fetch(`http://localhost:${port}/v1/models`);
          const data = await resp.json() as { data?: unknown[] };
          const modelCount = data?.data?.length || 0;
          console.log(`  Models:   ${chalk.green(String(modelCount) + ' available')}`);
        } catch {
          console.log(`  Models:   ${chalk.dim('unknown')}`);
        }
      }
      console.log();
    });
}
