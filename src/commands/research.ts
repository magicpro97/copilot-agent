import type { Command } from 'commander';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { detectProjectType, detectProjectName } from '../lib/detect.js';
import { runAgentTask } from '../lib/process.js';
import { resolveAgent, assertAgent } from '../lib/provider.js';
import { withLock } from '../lib/lock.js';
import { log, ok, warn, fail, info, notify } from '../lib/logger.js';
import { CYAN, RESET } from '../lib/colors.js';

export function registerResearchCommand(program: Command): void {
  program
    .command('research [project]')
    .description('Research improvements or a specific topic')
    .option('-s, --steps <n>', 'Max autopilot continues', '50')
    .option('-a, --agent <type>', 'Agent to use: copilot or claude')
    .action(async (project: string | undefined, opts) => {
      try {
        const agent = resolveAgent(opts.agent);
        await researchCommand(project ?? process.cwd(), {
          steps: parseInt(opts.steps, 10),
          agent,
        });
      } catch (err) {
        fail(`Research error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

interface ResearchOptions {
  steps: number;
  agent: ReturnType<typeof resolveAgent>;
}

function buildResearchPrompt(projectType: string, projectName: string): string {
  return `You are a senior software architect. Analyze this ${projectType} project "${projectName}" thoroughly.

Research and produce a file called RESEARCH-PROPOSALS.md with:

1. **Architecture Assessment** — Current architecture, patterns used, strengths and weaknesses
2. **Code Quality Report** — Common issues, anti-patterns, technical debt areas
3. **Security Audit** — Potential vulnerabilities, dependency risks, configuration issues
4. **Performance Analysis** — Bottlenecks, optimization opportunities, resource usage
5. **Testing Gap Analysis** — Untested areas, test quality, coverage recommendations
6. **Improvement Proposals** — Prioritized list of actionable improvements with effort estimates

For each proposal, include:
- Priority (P0/P1/P2)
- Estimated effort (hours)
- Impact description
- Suggested implementation approach

Write RESEARCH-PROPOSALS.md in the project root.`;
}

async function researchCommand(dir: string, opts: ResearchOptions): Promise<void> {
  assertAgent(opts.agent);

  const projectDir = resolve(dir);
  const projectType = detectProjectType(projectDir);
  const projectName = detectProjectName(projectDir);

  info(`Researching: ${CYAN}${projectName}${RESET} (${projectType}) — agent: ${opts.agent}`);

  const prompt = buildResearchPrompt(projectType, projectName);

  const result = await withLock('copilot-research', () =>
    runAgentTask(opts.agent, prompt, opts.steps, projectDir),
  );

  log(`Copilot exited with code ${result.exitCode}`);

  // Check for output file
  const proposalsFile = join(projectDir, 'RESEARCH-PROPOSALS.md');
  if (existsSync(proposalsFile)) {
    ok('RESEARCH-PROPOSALS.md generated.');

    // Backup to ~/.copilot/research-reports/
    const backupDir = join(homedir(), '.copilot', 'research-reports');
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join(backupDir, `${projectName}-${timestamp}.md`);
    copyFileSync(proposalsFile, backupFile);
    ok(`Backup saved: ${backupFile}`);
  } else {
    warn('RESEARCH-PROPOSALS.md was not generated. Check copilot output.');
  }

  notify('Research complete', projectName);
}
