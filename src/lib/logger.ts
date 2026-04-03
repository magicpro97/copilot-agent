import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { RED, GREEN, YELLOW, CYAN, DIM, RESET } from './colors.js';

let logFilePath: string | null = null;

const ANSI_RE =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function writeToFile(msg: string): void {
  if (!logFilePath) return;
  try {
    appendFileSync(logFilePath, stripAnsi(msg) + '\n');
  } catch { /* ignore file write errors */ }
}

export function setLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  logFilePath = path;
}

export function log(msg: string): void {
  console.log(msg);
  writeToFile(msg);
}

export function warn(msg: string): void {
  const out = `${YELLOW}⚠ ${msg}${RESET}`;
  console.log(out);
  writeToFile(`⚠ ${msg}`);
}

export function ok(msg: string): void {
  const out = `${GREEN}✔ ${msg}${RESET}`;
  console.log(out);
  writeToFile(`✔ ${msg}`);
}

export function fail(msg: string): void {
  const out = `${RED}✖ ${msg}${RESET}`;
  console.error(out);
  writeToFile(`✖ ${msg}`);
}

export function info(msg: string): void {
  const out = `${CYAN}ℹ ${msg}${RESET}`;
  console.log(out);
  writeToFile(`ℹ ${msg}`);
}

export function dim(msg: string): void {
  const out = `${DIM}${msg}${RESET}`;
  console.log(out);
  writeToFile(msg);
}

export function notify(message: string, title = 'copilot-agent'): void {
  try {
    if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
        { stdio: 'ignore' },
      );
    } else {
      try {
        execSync('which notify-send', { stdio: 'pipe' });
        execSync(
          `notify-send "${title}" "${message.replace(/"/g, '\\"')}"`,
          { stdio: 'ignore' },
        );
      } catch { /* notify-send not available */ }
    }
  } catch { /* notification not available */ }
}
