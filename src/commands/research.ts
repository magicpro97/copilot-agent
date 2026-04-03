import chalk from "chalk";
import { runCopilotTask, assertCopilot } from "../lib/process.js";
import { withLock } from "../lib/lock.js";
import { log, ok, fail, notify } from "../lib/logger.js";

export interface ResearchOptions {
  steps: number;
}

const RESEARCH_PROMPTS = [
  {
    title: "Dependency updates",
    prompt:
      "Research the latest versions of all dependencies. Check changelogs for breaking changes. Create a summary of what can be safely updated.",
  },
  {
    title: "Performance review",
    prompt:
      "Profile the application for performance bottlenecks. Check startup time, memory usage, and hot paths. Suggest optimizations with benchmarks.",
  },
  {
    title: "Architecture review",
    prompt:
      "Review the project architecture. Check for code smells, circular dependencies, and coupling issues. Suggest improvements following clean architecture.",
  },
  {
    title: "Accessibility audit",
    prompt:
      "Audit the UI for accessibility issues. Check color contrast, screen reader support, and keyboard navigation. Create a report.",
  },
  {
    title: "Best practices",
    prompt:
      "Compare the codebase against current best practices for this framework/language. Identify gaps and suggest improvements.",
  },
];

export async function researchCommand(
  topic: string | undefined,
  opts: ResearchOptions,
): Promise<void> {
  assertCopilot();

  if (topic) {
    log(`Research topic: ${chalk.cyan(topic)}`);
    const result = await withLock("copilot-research", () =>
      runCopilotTask(
        `Research the following topic and create a detailed report: ${topic}`,
        opts.steps,
      ),
    );
    ok(`Research complete — premium: ${result.premium}`);
    notify("Research complete", topic.slice(0, 30));
    return;
  }

  log("Running predefined research tasks…");
  for (const r of RESEARCH_PROMPTS) {
    log(`\n${chalk.bold(r.title)}`);
    try {
      const result = await withLock("copilot-research", () =>
        runCopilotTask(r.prompt, opts.steps),
      );
      ok(`${r.title} — premium: ${result.premium}`);
    } catch (err) {
      fail(`${r.title} failed: ${err}`);
    }
  }
  notify("All research tasks complete");
}
