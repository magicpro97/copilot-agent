import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Instruction content ──────────────────────────────────────────

function agentInstructions(): string {
  return `# copilot-agent — AI Agent Integration

You have access to \`copilot-agent\`, an autonomous AI agent manager CLI.
Use it to orchestrate tasks, verify quality, manage sessions, and automate workflows.

## Quick Reference

### Quality Gate (ALWAYS run after making changes)
\`\`\`bash
# Verify all quality checks pass (tests, lint, build, typecheck)
copilot-agent verify

# JSON output for programmatic use
copilot-agent verify --json
# Returns: { "passed": bool, "failedChecks": [...], "feedback": "..." }

# Only specific checks
copilot-agent verify --checks test,lint
\`\`\`

### Task Execution
\`\`\`bash
# Discover and run maintenance tasks with auto-verify
copilot-agent run --verify

# Run on specific directory
copilot-agent run ~/project --verify --agent copilot

# Preview tasks without executing
copilot-agent run --dry-run
\`\`\`

### Session Management
\`\`\`bash
# View active sessions
copilot-agent status --active

# Watch and auto-resume with quality verification
copilot-agent watch --verify

# Get session report (what was done, files changed, commits)
copilot-agent report

# Show git diff from a session
copilot-agent diff
\`\`\`

### Overnight / Long-running
\`\`\`bash
# Run tasks continuously until 7am
copilot-agent overnight ~/project --until 07

# Multi-project orchestration
copilot-agent multi run --parallel
\`\`\`

### Code Review & PR
\`\`\`bash
# AI-powered review of current changes
copilot-agent review diff

# Create PR from session changes
copilot-agent pr --draft
\`\`\`

### Context & Handoff
\`\`\`bash
# Generate context summary for handoff
copilot-agent compact --resume-prompt

# Search past sessions
copilot-agent log search "auth"
\`\`\`

### System
\`\`\`bash
# Health check
copilot-agent doctor

# Usage tracking
copilot-agent quota --days 7
\`\`\`

## Workflow: Task → Verify → Fix Loop

When working on a project, follow this pattern:

1. **Make changes** to accomplish the task
2. **Run \`copilot-agent verify\`** to check quality
3. If verify fails, **read the feedback** and fix the issues
4. Repeat until \`verify\` passes
5. **Run \`copilot-agent pr --draft\`** to create a PR

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success / all checks passed |
| 1 | Failure / check(s) failed |
| 2 | All checks skipped (no commands detected) |

## Key Rules

- ALWAYS run \`copilot-agent verify\` after making code changes
- Use \`--json\` flag when you need to parse output programmatically
- Use \`copilot-agent doctor\` to diagnose environment issues
- Use \`copilot-agent report\` to review what was accomplished
- Prefer \`copilot-agent run --verify\` for automated task execution
`;
}

// ── Copilot-specific format ──────────────────────────────────────

function copilotInstructions(): string {
  return `---
applyTo: "**"
---

${agentInstructions()}`;
}

// ── Claude-specific format ───────────────────────────────────────

function claudeInstructions(): string {
  return `${agentInstructions()}
## Claude Code Specific

- Use \`copilot-agent watch --verify --agent claude\` for auto-resume with quality checks
- Use \`copilot-agent compact --agent claude\` for session context
- Claude sessions are stored in \`~/.claude/projects/\`
`;
}

// ── Cursor-specific format ───────────────────────────────────────

function cursorRules(): string {
  return `${agentInstructions()}
## Cursor Specific

- Run \`copilot-agent verify\` in the integrated terminal after changes
- Use \`copilot-agent status\` to check active agent sessions
- Use \`copilot-agent diff\` to review changes before committing
`;
}

// ── File writing helpers ─────────────────────────────────────────

type Target = 'copilot' | 'claude' | 'cursor';

interface SetupFile {
  target: Target;
  path: string;
  content: string;
  description: string;
}

function getProjectFiles(dir: string): SetupFile[] {
  return [
    {
      target: 'copilot',
      path: join(dir, '.github', 'instructions', 'copilot-agent.instructions.md'),
      content: copilotInstructions(),
      description: 'Copilot instructions',
    },
    {
      target: 'claude',
      path: join(dir, 'CLAUDE.md'),
      content: claudeInstructions(),
      description: 'Claude Code instructions',
    },
    {
      target: 'cursor',
      path: join(dir, '.cursorrules'),
      content: cursorRules(),
      description: 'Cursor rules',
    },
  ];
}

function getGlobalFiles(): SetupFile[] {
  const home = homedir();
  return [
    {
      target: 'copilot',
      path: join(home, '.github', 'copilot-instructions.md'),
      content: agentInstructions(),
      description: 'Global Copilot instructions',
    },
    {
      target: 'claude',
      path: join(home, '.claude', 'CLAUDE.md'),
      content: claudeInstructions(),
      description: 'Global Claude instructions',
    },
  ];
}

function writeFile(file: SetupFile, opts: { force: boolean; append: boolean }): 'created' | 'updated' | 'appended' | 'skipped' {
  const dir = file.path.substring(0, file.path.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(file.path)) {
    const existing = readFileSync(file.path, 'utf-8');
    if (existing.includes('copilot-agent')) {
      if (!opts.force) return 'skipped';
      // Replace the copilot-agent section
      writeFileSync(file.path, file.content, 'utf-8');
      return 'updated';
    }
    if (opts.append) {
      writeFileSync(file.path, existing + '\n\n' + file.content, 'utf-8');
      return 'appended';
    }
    if (!opts.force) return 'skipped';
  }

  writeFileSync(file.path, file.content, 'utf-8');
  return 'created';
}

// ── Command ──────────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  const cmd = program
    .command('setup [dir]')
    .description('Install AI agent instructions (Copilot, Claude, Cursor)')
    .option('--global', 'Install globally (~/.github, ~/.claude)')
    .option('--target <agents>', 'Comma-separated: copilot,claude,cursor (default: all)')
    .option('--force', 'Overwrite existing files')
    .option('--append', 'Append to existing files instead of skipping')
    .option('--dry-run', 'Show what would be written without writing')
    .option('--list', 'List file paths that would be created')
    .action((dir: string | undefined, opts) => {
      const targetDir = dir ?? process.cwd();
      const targets: Target[] = opts.target
        ? opts.target.split(',').map((s: string) => s.trim())
        : ['copilot', 'claude', 'cursor'];

      const files = opts.global
        ? getGlobalFiles().filter(f => targets.includes(f.target))
        : getProjectFiles(targetDir).filter(f => targets.includes(f.target));

      if (files.length === 0) {
        console.log(chalk.yellow('  No targets matched'));
        return;
      }

      console.log(chalk.bold.cyan('\n  🔧 copilot-agent setup\n'));

      if (opts.list) {
        for (const f of files) {
          const exists = existsSync(f.path);
          const icon = exists ? chalk.yellow('⚠') : chalk.green('+');
          console.log(`  ${icon} ${chalk.dim(f.description)}`);
          console.log(`    ${f.path}`);
        }
        console.log();
        return;
      }

      if (opts.dryRun) {
        for (const f of files) {
          const exists = existsSync(f.path);
          console.log(`  ${chalk.dim(f.description)} → ${f.path}`);
          console.log(`    Would ${exists ? (opts.force ? 'overwrite' : 'skip (exists)') : 'create'}`);
          console.log(chalk.dim(`    ${f.content.split('\n').length} lines\n`));
        }
        return;
      }

      // Write files
      for (const f of files) {
        const result = writeFile(f, { force: opts.force ?? false, append: opts.append ?? false });
        let icon: string;
        let label: string;
        switch (result) {
          case 'created': icon = chalk.green('✔'); label = 'Created'; break;
          case 'updated': icon = chalk.yellow('✔'); label = 'Updated'; break;
          case 'appended': icon = chalk.blue('✔'); label = 'Appended'; break;
          case 'skipped': icon = chalk.dim('○'); label = 'Skipped (exists, use --force)'; break;
        }
        console.log(`  ${icon} ${chalk.bold(f.description)} ${chalk.dim(`— ${label}`)}`);
        console.log(`    ${chalk.dim(f.path)}`);
      }

      console.log(chalk.dim('\n  AI agents will now know how to use copilot-agent in this project.'));
      console.log();
    });
}
