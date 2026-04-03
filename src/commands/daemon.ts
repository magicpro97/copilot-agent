import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import chalk from "chalk";
import {
  getLatestSessionId,
  validateSession,
  hasTaskComplete,
  getLastEvent,
  getSessionSummary,
} from "../lib/session.js";
import {
  findPidForSession,
  waitForExit,
  runCopilotResume,
  assertCopilot,
} from "../lib/process.js";
import { withLock } from "../lib/lock.js";
import { log, ok, warn, fail, notify, setLogFile } from "../lib/logger.js";

const PID_FILE = join(homedir(), ".copilot", "watchdog.pid");
const LOG_FILE = join(homedir(), ".copilot", "auto-resume-logs", "watchdog.log");
const SESSION_DIR = join(homedir(), ".copilot", "session-state");

export interface DaemonOptions {
  poll: number;
  idle: number;
  resume: boolean;
  steps: number;
}

export async function daemonCommand(
  action: string,
  opts: DaemonOptions,
): Promise<void> {
  switch (action) {
    case "start":
      return startDaemon(opts);
    case "stop":
      return stopDaemon();
    case "status":
      return statusDaemon();
    case "logs":
      return showLogs();
    default:
      fail(`Unknown action: ${action}. Use: start, stop, status, logs`);
      process.exit(1);
  }
}

function isDaemonRunning(): { running: boolean; pid?: number } {
  if (!existsSync(PID_FILE)) return { running: false };
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, 0); // test if alive
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}

async function startDaemon(opts: DaemonOptions): Promise<void> {
  assertCopilot();

  const { running, pid } = isDaemonRunning();
  if (running) {
    fail(`Watchdog already running (PID: ${pid}). Use 'copilot-agent daemon stop' first.`);
    process.exit(1);
  }

  // Clean stale PID file
  if (existsSync(PID_FILE)) {
    
    unlinkSync(PID_FILE);
  }

  log(`🐕 Starting watchdog daemon (poll: ${opts.poll}s, auto-resume: ${opts.resume})`);
  log(`   Log: ${LOG_FILE}`);

  // Spawn detached child running this same CLI in _daemon-loop mode
  const child = spawn(
    process.execPath,
    [
      process.argv[1],
      "daemon",
      "_loop",
      "--poll",
      String(opts.poll),
      "--idle",
      String(opts.idle),
      "--steps",
      String(opts.steps),
      ...(opts.resume ? ["--resume"] : []),
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
    ok(`Watchdog started (PID: ${child.pid})`);
  } else {
    fail("Failed to start watchdog");
  }
}

async function stopDaemon(): Promise<void> {
  const { running, pid } = isDaemonRunning();
  if (!running) {
    warn("Watchdog is not running.");
    return;
  }
  try {
    process.kill(pid!, "SIGTERM");
    ok(`Watchdog stopped (PID: ${pid})`);
  } catch {
    fail(`Could not stop PID ${pid}`);
  }
  try {
    
    unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

async function statusDaemon(): Promise<void> {
  const { running, pid } = isDaemonRunning();
  if (running) {
    ok(`Watchdog running (PID: ${pid})`);
    if (existsSync(LOG_FILE)) {
      const stat = statSync(LOG_FILE);
      log(`Log: ${LOG_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);
    }
  } else {
    log("Watchdog is not running.");
  }
}

async function showLogs(): Promise<void> {
  if (!existsSync(LOG_FILE)) {
    log("No log file found.");
    return;
  }
  const lines = readFileSync(LOG_FILE, "utf-8").trimEnd().split("\n");
  const tail = lines.slice(-30);
  for (const line of tail) console.log(line);
}

// Internal: the actual daemon loop (called by spawned child)
export async function daemonLoop(opts: DaemonOptions): Promise<void> {
  setLogFile(LOG_FILE);
  log(`🐕 Watchdog daemon loop started (PID: ${process.pid})`);

  let lastAlertedSid = "";

  const shutdown = () => {
    log("Watchdog shutting down");
    try {
      
      unlinkSync(PID_FILE);
    } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (true) {
    await sleep(opts.poll * 1000);

    try {
      const sid = getLatestSessionId();
      if (!sid || !validateSession(sid)) continue;

      // Already handled this session
      if (sid === lastAlertedSid && hasTaskComplete(sid)) continue;

      // Check if copilot is actively running for this session
      const pid = await findPidForSession(sid);
      if (pid) continue; // still running, nothing to do

      // Session has no running process
      if (hasTaskComplete(sid)) {
        if (sid !== lastAlertedSid) {
          log(`✅ Session ${sid.slice(0, 8)} completed: ${getSessionSummary(sid).slice(0, 60)}`);
          notify("Task completed", `Session ${sid.slice(0, 8)}`);
          lastAlertedSid = sid;
        }
        continue;
      }

      // Session interrupted — check idle time
      const eventsPath = join(SESSION_DIR, sid, "events.jsonl");
      const mtime = statSync(eventsPath).mtimeMs;
      const idleMinutes = (Date.now() - mtime) / 60_000;

      if (idleMinutes < opts.idle) continue;

      log(`⏸️  Session ${sid.slice(0, 8)} idle ${idleMinutes.toFixed(0)}m (last: ${getLastEvent(sid)})`);

      if (opts.resume) {
        log(`🔄 Auto-resuming session ${sid.slice(0, 8)}…`);
        lastAlertedSid = sid;

        try {
          await withLock("watchdog-resume", async () => {
            const result = await runCopilotResume(sid, opts.steps);
            ok(`Resume done — exit ${result.exitCode}, premium: ${result.premium}`);
          });
        } catch (err) {
          fail(`Resume failed: ${err}`);
        }
      } else {
        if (sid !== lastAlertedSid) {
          warn(`Session ${sid.slice(0, 8)} needs attention (idle ${idleMinutes.toFixed(0)}m)`);
          notify("Session interrupted", `${sid.slice(0, 8)} idle ${idleMinutes.toFixed(0)}m`);
          lastAlertedSid = sid;
        }
      }
    } catch (err) {
      fail(`Watchdog error: ${err}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
