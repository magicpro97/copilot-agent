import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { detectProjectType, detectProjectName } from "../lib/detect.js";
import { getTasksForProject } from "../lib/tasks.js";
import { runCopilotTask, assertCopilot } from "../lib/process.js";
import { withLock } from "../lib/lock.js";
import { log, ok, warn, fail, notify, setLogFile } from "../lib/logger.js";

const PROJECTS_FILE = join(homedir(), ".copilot", "autonomous-projects.txt");
const LOG_DIR = join(homedir(), ".copilot", "auto-resume-logs");

export interface MultiOptions {
  mode: string;
  cooldown: number;
  steps: number;
  maxPremium: number;
  dryRun: boolean;
}

export async function multiCommand(
  action: string,
  args: string[],
  opts: MultiOptions,
): Promise<void> {
  ensureFiles();

  switch (action) {
    case "add":
      return addProject(args[0]);
    case "remove":
      return removeProject(args[0]);
    case "list":
      return listProjects();
    case "health":
    case "research":
      return runAll(action, opts);
    default:
      fail(`Unknown action: ${action}. Use: add, remove, list, health, research`);
      process.exit(1);
  }
}

function ensureFiles(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  if (!existsSync(PROJECTS_FILE)) writeFileSync(PROJECTS_FILE, "");
}

function readProjects(): string[] {
  return readFileSync(PROJECTS_FILE, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function writeProjects(projects: string[]): void {
  writeFileSync(PROJECTS_FILE, projects.join("\n") + "\n");
}

async function addProject(path: string | undefined): Promise<void> {
  if (!path) {
    fail("Usage: copilot-agent multi add <path>");
    process.exit(1);
  }

  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    fail(`Not found: ${resolved}`);
    process.exit(1);
  }

  await withLock("projects-file", async () => {
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
    fail("Usage: copilot-agent multi remove <path>");
    process.exit(1);
  }

  const resolved = resolve(path);

  await withLock("projects-file", async () => {
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
    log("No projects registered. Add: copilot-agent multi add <path>");
    return;
  }

  console.log(chalk.bold("\nRegistered projects:"));
  for (let i = 0; i < projects.length; i++) {
    const exists = existsSync(projects[i]);
    const icon = exists ? chalk.green("✅") : chalk.red("❌");
    const type = exists ? detectProjectType(projects[i]) : "?";
    console.log(`  ${i + 1}. ${icon} ${projects[i]} ${chalk.dim(`(${type})`)}`);
  }
  console.log();
}

async function runAll(mode: string, opts: MultiOptions): Promise<void> {
  assertCopilot();

  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  setLogFile(join(LOG_DIR, `multi-${mode}-${ts}.log`));

  const projects = readProjects();
  if (projects.length === 0) {
    fail("No projects registered. Add: copilot-agent multi add <path>");
    process.exit(1);
  }

  log(`🏭 Multi-project ${mode} — ${projects.length} projects`);

  if (opts.dryRun) {
    for (const p of projects) {
      const type = existsSync(p) ? detectProjectType(p) : "unknown";
      const tasks = getTasksForProject(type);
      console.log(`\n${chalk.bold(basename(p))} (${type})`);
      for (const t of tasks.slice(0, 3)) {
        console.log(`  ${chalk.dim("•")} ${t.title}`);
      }
    }
    log(chalk.dim("\n(dry-run — not executing)"));
    return;
  }

  let total = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const report: string[] = [];

  for (const project of projects) {
    total++;

    if (!existsSync(project)) {
      warn(`Skipping (not found): ${project}`);
      report.push(`⏭  ${basename(project)} (not found)`);
      skipped++;
      continue;
    }

    const name = detectProjectName(project);
    const type = detectProjectType(project);
    log(`\n${"═".repeat(50)}`);
    log(`${chalk.bold(name)} (${type}) — ${total}/${projects.length}`);
    log(`${"═".repeat(50)}`);

    const tasks = mode === "research"
      ? [{ title: "Research", prompt: "Research latest best practices, dependency updates, and architecture improvements. Create a report.", priority: 1 }]
      : getTasksForProject(type).slice(0, 3);

    let projectSuccess = true;

    for (const task of tasks) {
      try {
        const result = await withLock("copilot-multi", () =>
          runCopilotTask(
            `Project: ${project}\n\n${task.prompt}`,
            opts.steps,
          ),
        );
        ok(`${task.title} — exit ${result.exitCode}, premium: ${result.premium}`);
      } catch (err) {
        fail(`${task.title} failed: ${err}`);
        projectSuccess = false;
      }
    }

    if (projectSuccess) {
      success++;
      report.push(`✅ ${name}`);
    } else {
      failed++;
      report.push(`❌ ${name}`);
    }

    if (total < projects.length) {
      log(`Cooldown ${opts.cooldown}s…`);
      await new Promise((r) => setTimeout(r, opts.cooldown * 1000));
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  log(`📊 Summary: ${success}/${total} succeeded, ${failed} failed, ${skipped} skipped`);
  for (const line of report) console.log(`  ${line}`);
  console.log();

  notify(`Multi-${mode}: ${success}/${total} succeeded`, "copilot-agent");
}
