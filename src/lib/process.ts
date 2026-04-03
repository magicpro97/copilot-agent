import { execSync, spawn } from "node:child_process";
import psList from "ps-list";
import {
  getLatestSessionId,
  hasTaskComplete,
  getSessionPremium,
} from "./session.js";
import { log, fail, setLogFile } from "./logger.js";
import type { CopilotProcess } from "../types.js";

export function isCopilotInstalled(): boolean {
  try {
    execSync("which copilot", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function assertCopilot(): void {
  if (!isCopilotInstalled()) {
    fail("copilot CLI not found. Install: brew install --cask copilot-cli");
    process.exit(1);
  }
}

export async function findCopilotProcesses(): Promise<CopilotProcess[]> {
  const all = await psList();
  return all
    .filter(
      (p) =>
        p.cmd?.includes("copilot") &&
        !p.cmd?.includes("copilot-agent") &&
        !p.cmd?.includes("tee ") &&
        !p.cmd?.includes("grep"),
    )
    .map((p) => {
      const sidMatch = p.cmd?.match(
        /resume[= ]+([a-f0-9-]{36})/,
      );
      return {
        pid: p.pid,
        elapsed: "",
        tty: "",
        command: p.cmd ?? "",
        sessionId: sidMatch?.[1],
      };
    });
}

export async function findPidForSession(
  sid: string,
): Promise<number | null> {
  const procs = await findCopilotProcesses();
  const matching = procs
    .filter((p) => p.command.includes(sid))
    .sort((a, b) => b.pid - a.pid);
  return matching[0]?.pid ?? null;
}

export async function waitForExit(
  pid: number,
  timeoutMs = 14_400_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await sleep(5000);
    } catch {
      return true; // process exited
    }
  }
  return false; // timeout
}

export interface CopilotResult {
  exitCode: number;
  sessionId: string | null;
  premium: number;
}

export function runCopilot(
  args: string[],
  logFile?: string,
): Promise<CopilotResult> {
  return new Promise((resolve) => {
    const child = spawn("copilot", args, {
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env },
    });

    child.on("close", async (code) => {
      await sleep(3000); // let events flush
      const sid = getLatestSessionId();
      const premium = sid ? getSessionPremium(sid) : 0;
      resolve({
        exitCode: code ?? 1,
        sessionId: sid,
        premium,
      });
    });

    child.on("error", () => {
      resolve({ exitCode: 1, sessionId: null, premium: 0 });
    });
  });
}

export function runCopilotResume(
  sid: string,
  steps: number,
  message?: string,
): Promise<CopilotResult> {
  const args = [
    `--resume=${sid}`,
    "--autopilot",
    "--allow-all",
    `--max-autopilot-continues`,
    String(steps),
    "--no-ask-user",
  ];
  if (message) args.push("-p", message);
  return runCopilot(args);
}

export function runCopilotTask(
  prompt: string,
  steps: number,
): Promise<CopilotResult> {
  return runCopilot([
    "-p",
    prompt,
    "--autopilot",
    "--allow-all",
    "--max-autopilot-continues",
    String(steps),
    "--no-ask-user",
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
