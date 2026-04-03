#!/usr/bin/env node
import { Command } from "commander";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { runCommand } from "./commands/run.js";
import { overnightCommand } from "./commands/overnight.js";
import { researchCommand } from "./commands/research.js";
import { daemonCommand, daemonLoop } from "./commands/daemon.js";
import { multiCommand } from "./commands/multi.js";

const program = new Command();

program
  .name("copilot-agent")
  .description("Autonomous GitHub Copilot CLI agent — auto-resume, task discovery, overnight runner")
  .version("0.2.0");

program
  .command("status")
  .description("Show copilot session status")
  .option("-l, --limit <n>", "Number of sessions to show", "10")
  .option("-a, --active", "Show only active (running) sessions")
  .action(async (opts) => {
    await statusCommand({
      limit: parseInt(opts.limit),
      active: opts.active ?? false,
    });
  });

program
  .command("watch [session-id]")
  .description("Watch a session and auto-resume when it stops")
  .option("-s, --steps <n>", "Max autopilot continues per resume", "50")
  .option("-r, --max-resumes <n>", "Max number of resumes", "20")
  .option("-m, --message <msg>", "Message to send on resume")
  .action(async (sid, opts) => {
    await watchCommand(sid, {
      steps: parseInt(opts.steps),
      maxResumes: parseInt(opts.maxResumes),
      message: opts.message,
    });
  });

program
  .command("run [dir]")
  .description("Discover and fix issues in a project")
  .option("-s, --steps <n>", "Max autopilot continues per task", "30")
  .option("-t, --max-tasks <n>", "Max number of tasks to run", "5")
  .option("--dry-run", "Show tasks without executing")
  .action(async (dir, opts) => {
    await runCommand(dir ?? process.cwd(), {
      steps: parseInt(opts.steps),
      maxTasks: parseInt(opts.maxTasks),
      dryRun: opts.dryRun ?? false,
    });
  });

program
  .command("overnight [dir]")
  .description("Run tasks continuously until a deadline")
  .option("-u, --until <HH:MM>", "Deadline time (24h format)", "07:00")
  .option("-s, --steps <n>", "Max autopilot continues per task", "50")
  .option("-p, --max-premium <n>", "Max premium requests budget", "300")
  .option("--dry-run", "Show plan without executing")
  .action(async (dir, opts) => {
    await overnightCommand(dir ?? process.cwd(), {
      until: opts.until,
      steps: parseInt(opts.steps),
      maxPremium: parseInt(opts.maxPremium),
      dryRun: opts.dryRun ?? false,
    });
  });

program
  .command("research [topic]")
  .description("Research improvements or a specific topic")
  .option("-s, --steps <n>", "Max autopilot continues", "30")
  .action(async (topic, opts) => {
    await researchCommand(topic, {
      steps: parseInt(opts.steps),
    });
  });

const daemon = program
  .command("daemon <action>")
  .description("Background watchdog daemon (start, stop, status, logs)")
  .option("--poll <n>", "Poll interval in seconds", "20")
  .option("--idle <n>", "Minutes before considering session idle", "5")
  .option("--resume", "Auto-resume interrupted sessions")
  .option("-s, --steps <n>", "Max autopilot continues per resume", "50")
  .action(async (action, opts) => {
    const parsed = {
      poll: parseInt(opts.poll),
      idle: parseInt(opts.idle),
      resume: opts.resume ?? false,
      steps: parseInt(opts.steps),
    };
    // Internal: _loop is called by spawned daemon child
    if (action === "_loop") {
      await daemonLoop(parsed);
    } else {
      await daemonCommand(action, parsed);
    }
  });

const multi = program
  .command("multi <action> [args...]")
  .description("Multi-project orchestrator (add, remove, list, health, research)")
  .option("-s, --steps <n>", "Max autopilot continues per task", "30")
  .option("-c, --cooldown <n>", "Seconds between projects", "60")
  .option("-p, --max-premium <n>", "Max premium per project", "30")
  .option("--dry-run", "Show plan without executing")
  .action(async (action, args, opts) => {
    await multiCommand(action, args, {
      mode: action,
      cooldown: parseInt(opts.cooldown),
      steps: parseInt(opts.steps),
      maxPremium: parseInt(opts.maxPremium),
      dryRun: opts.dryRun ?? false,
    });
  });

program.parse();
