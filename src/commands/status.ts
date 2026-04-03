import chalk from "chalk";
import {
  listSessions,
  hasTaskComplete,
  getLastEvent,
  getSessionPremium,
} from "../lib/session.js";
import { findCopilotProcesses } from "../lib/process.js";
import { log } from "../lib/logger.js";

export interface StatusOptions {
  limit: number;
  active: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  if (opts.active) {
    return showActive();
  }
  showRecent(opts.limit);
}

async function showActive(): Promise<void> {
  const procs = await findCopilotProcesses();
  if (procs.length === 0) {
    log("No active copilot processes.");
    return;
  }

  console.log(
    chalk.bold(
      `\n${"PID".padEnd(8)} ${"Session".padEnd(40)} ${"Command".slice(0, 60)}`,
    ),
  );
  console.log("─".repeat(108));

  for (const p of procs) {
    console.log(
      `${String(p.pid).padEnd(8)} ${(p.sessionId ?? "—").padEnd(40)} ${(p.command ?? "").slice(0, 60)}`,
    );
  }
  console.log();
}

function showRecent(limit: number): void {
  const sessions = listSessions(limit);
  if (sessions.length === 0) {
    log("No sessions found.");
    return;
  }

  console.log(
    chalk.bold(
      `\n${"Status".padEnd(10)} ${"Premium".padEnd(10)} ${"Last Event".padEnd(25)} ${"Summary".padEnd(40)} ${"ID"}`,
    ),
  );
  console.log("─".repeat(120));

  for (const s of sessions) {
    const done = hasTaskComplete(s.id);
    const status = done
      ? chalk.green("✅ done")
      : chalk.yellow("⏸️  stopped");
    const premium = String(getSessionPremium(s.id));
    const lastEvt = getLastEvent(s.id);
    const summary = (s.summary ?? "—").slice(0, 38);

    console.log(
      `${status.padEnd(20)} ${premium.padEnd(10)} ${lastEvt.padEnd(25)} ${summary.padEnd(40)} ${chalk.dim(s.id)}`,
    );
  }
  console.log();
}
