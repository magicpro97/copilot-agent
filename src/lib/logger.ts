import chalk from "chalk";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

let logFilePath: string | null = null;

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const ANSI_RE =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function emit(level: string, msg: string): void {
  const line = `${chalk.blue(`[${ts()}]`)} [${level}] ${msg}`;
  console.log(line);
  if (logFilePath) {
    appendFileSync(logFilePath, line.replace(ANSI_RE, "") + "\n");
  }
}

export function setLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  logFilePath = path;
}

export const log = (msg: string) => emit("INFO", msg);
export const warn = (msg: string) => emit("WARN", chalk.yellow(`⚠️  ${msg}`));
export const ok = (msg: string) => emit("OK", chalk.green(`✅ ${msg}`));
export const fail = (msg: string) => emit("ERROR", chalk.red(`❌ ${msg}`));

export function notify(message: string, title = "copilot-agent"): void {
  try {
    if (process.platform === "darwin") {
      execSync(
        `osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`,
        { stdio: "ignore" },
      );
    } else {
      execSync(`notify-send "${title}" "${message}"`, { stdio: "ignore" });
    }
  } catch {
    /* best-effort */
  }
}
