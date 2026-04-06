import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ── Instruction content ──────────────────────────────────────────

function agentInstructions(): string {
  return `# copilot-agent — AI Agent Integration

<!-- copilot-agent:start -->

You have access to \`copilot-agent\`, an autonomous AI agent manager CLI.
Use it to orchestrate tasks, verify quality, manage sessions, and automate workflows.

## ⚠️ MANDATORY RULES — READ FIRST

1. **NEVER commit directly to main/master.** Always create a feature branch first.
2. **ALWAYS run \`copilot-agent verify\` before committing.** Do not commit broken code.
3. **Do NOT modify** these protected paths without explicit permission:
   - \`.env*\`, \`*.secret\`, \`*.key\`, \`*.pem\` — secrets
   - \`**/production/**\`, \`**/prod/**\` — production configs
   - \`.github/workflows/**\` — CI/CD pipelines
   - \`Podfile.lock\`, \`package-lock.json\`, \`yarn.lock\`, \`gradle.lockfile\` — lockfiles (modify only via package manager)
4. **Commit frequently** with descriptive messages. Small, focused commits.
5. **Run tests** before AND after changes. If tests fail, fix them before moving on.
6. **Do not delete or rename** files without clear justification.

## Git Branch Workflow

\`\`\`bash
# ALWAYS start work on a new branch
git checkout -b agent/<task-name> main

# After completing work
git add -A
git commit -m "feat: description of changes"

# Push and create PR (never push to main directly)
git push origin HEAD
copilot-agent pr --draft
\`\`\`

## Testing Strategy

- **Before changes**: Run existing tests to establish baseline (\`copilot-agent verify --checks test\`)
- **During changes**: Write/update tests for any new or modified public functions
- **After changes**: Run full verify to ensure nothing is broken
- **Coverage**: Aim for ≥80% coverage on changed files. Do not reduce overall coverage.
- **Test types**: Unit tests first, integration tests for cross-module behavior
- **Never skip failing tests.** Fix the code or the test, never disable.

## Rollback Procedures

If your changes break things:

1. **Don't panic.** Run \`git stash push -m "broken: description"\` to save work
2. **Check baseline**: \`git stash && copilot-agent verify\` — does the original code pass?
3. **If original passes**: Your changes caused the issue. \`git stash pop\` and fix incrementally.
4. **If original fails**: Pre-existing issue. Document it and work around it.
5. **Nuclear option**: \`git checkout -- .\` to discard all changes and start fresh.

## Communication Protocols

- **ASK before**: changing architecture, adding dependencies, modifying CI/CD, or deleting files
- **PROCEED without asking**: fixing bugs, adding tests, refactoring within scope, updating docs
- **STOP and report**: if tests fail and you can't fix in 3 attempts, if you find security issues, if scope is unclear

## Pre-PR Checklist

Before creating a PR, ensure ALL of the following:

1. ✅ \`copilot-agent verify\` passes (test + lint + build + typecheck)
2. ✅ Changes are on a feature branch (NOT main/master)
3. ✅ All commits have descriptive messages
4. ✅ No secrets, credentials, or API keys in the code
5. ✅ No unrelated changes included (keep PRs focused)
6. ✅ README/docs updated if public API changed
7. ✅ \`copilot-agent diff\` reviewed — no accidental deletions or regressions

## Breaking Change Detection

A change is **breaking** if it:
- Removes or renames public API, functions, classes, or types
- Changes function signatures (parameters, return types)
- Modifies database schemas without migration
- Changes configuration file formats
- Removes features users depend on

If you detect a breaking change: **STOP and ask** for confirmation before proceeding.

## Quick Reference

### Quality Gate (ALWAYS run after making changes)
\`\`\`bash
copilot-agent verify                    # Run all checks
copilot-agent verify --json             # JSON output
copilot-agent verify --checks test,lint # Specific checks only
\`\`\`

### Task Execution
\`\`\`bash
copilot-agent run --verify              # Discover & run tasks with auto-verify
copilot-agent run ~/project --verify    # Run on specific directory
copilot-agent run --dry-run             # Preview tasks
\`\`\`

### Session Management
\`\`\`bash
copilot-agent status --active           # View active sessions
copilot-agent watch --verify            # Watch & auto-resume with verify
copilot-agent report                    # What was done, files changed, commits
copilot-agent diff                      # Show git diff from session
\`\`\`

### Overnight / Long-running
\`\`\`bash
copilot-agent overnight ~/project --until 07  # Run until 7am
copilot-agent multi run --parallel             # Multi-project
\`\`\`

### Code Review & PR
\`\`\`bash
copilot-agent review diff               # AI-powered review
copilot-agent pr --draft                # Create PR
\`\`\`

### Context & System
\`\`\`bash
copilot-agent compact --resume-prompt   # Context summary
copilot-agent log search "auth"         # Search past sessions
copilot-agent doctor                    # Health check
copilot-agent quota --days 7            # Usage tracking
\`\`\`

## Workflow: Task → Verify → Fix Loop

1. **Create a feature branch** (\`git checkout -b agent/<task-name>\`)
2. **Make changes** to accomplish the task
3. **Run \`copilot-agent verify\`** to check quality
4. If verify fails, **read the feedback** and fix the issues
5. Repeat until \`verify\` passes
6. **Review with \`copilot-agent diff\`** — check for regressions
7. **Commit** with a descriptive message
8. **Run \`copilot-agent pr --draft\`** to create a PR

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success / all checks passed |
| 1 | Failure / check(s) failed |
| 2 | All checks skipped (no commands detected) |

<!-- copilot-agent:end -->
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

// ── Hooks YAML ───────────────────────────────────────────────────

function hooksYaml(): string {
  return `# copilot-agent hooks — quality gates for AI agents
# Automatically runs after agent events to prevent broken code.
# Commands use cross-platform syntax (git commands + copilot-agent CLI).

on_session_start:
  # Ensure agent is NOT on main/master before starting work
  - command: "node -e \\"const b=require('child_process').execSync('git rev-parse --abbrev-ref HEAD',{encoding:'utf8'}).trim(); if(b==='main'||b==='master'){console.error('ERROR: Create a feature branch first! Do not work on '+b+'.'); process.exit(1)}\\" "
    name: "Branch guard"
    timeout: 5

on_task_complete:
  # Verify quality after every completed task
  - command: "copilot-agent verify --checks test,lint,build,typecheck"
    name: "Quality gate"
    timeout: 180

on_pre_commit:
  # Run verify before each commit
  - command: "copilot-agent verify --checks build,typecheck"
    name: "Pre-commit verify"
    timeout: 120

on_session_end:
  # Final verification when session ends
  - command: "copilot-agent verify"
    name: "Final quality check"
    timeout: 180
  # Auto-push feature branch (uncomment to enable):
  # - command: "node -e \\"const b=require('child_process').execSync('git rev-parse --abbrev-ref HEAD',{encoding:'utf8'}).trim(); if(b!=='main'&&b!=='master'){require('child_process').execSync('git push origin HEAD',{stdio:'inherit'})}\\" "
  #   name: "Auto-push feature branch"
  #   timeout: 30

on_error:
  # Stash broken changes so the repo stays clean
  - command: "git stash push -m \\"copilot-agent: stash on error\\""
    name: "Stash broken changes"
    timeout: 10

on_resume:
  # Ensure clean state before agent resumes
  - command: "copilot-agent verify --checks build,typecheck"
    name: "Pre-resume build check"
    timeout: 120

# ── Uncomment hooks below as needed ──

# on_pre_push:
#   - command: "copilot-agent verify"
#     name: "Pre-push full verify"
#     timeout: 180

# on_pre_pr:
#   - command: "copilot-agent verify && copilot-agent diff"
#     name: "Pre-PR review"
#     timeout: 180
`;
}

// ── File writing helpers ─────────────────────────────────────────

type Target = 'copilot' | 'claude' | 'cursor' | 'hooks';

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
    {
      target: 'hooks',
      path: join(dir, '.copilot-agent', 'hooks.yaml'),
      content: hooksYaml(),
      description: 'Quality gate hooks',
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
    {
      target: 'hooks',
      path: join(home, '.copilot-agent', 'hooks.yaml'),
      content: hooksYaml(),
      description: 'Global quality gate hooks',
    },
  ];
}

const SECTION_START = '<!-- copilot-agent:start -->';
const SECTION_END = '<!-- copilot-agent:end -->';

function writeFile(file: SetupFile, opts: { force: boolean; append: boolean }): 'created' | 'updated' | 'appended' | 'skipped' {
  const dir = dirname(file.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(file.path)) {
    const existing = readFileSync(file.path, 'utf-8');

    // Smart section replace: if file has copilot-agent markers, replace that section
    const hasMarkers = existing.includes(SECTION_START) && existing.includes(SECTION_END);
    const hasCopilotAgent = existing.includes('copilot-agent');

    if (hasMarkers) {
      const before = existing.substring(0, existing.indexOf(SECTION_START));
      const after = existing.substring(existing.indexOf(SECTION_END) + SECTION_END.length);
      writeFileSync(file.path, before + file.content.trim() + after, 'utf-8');
      return 'updated';
    }

    if (hasCopilotAgent) {
      if (!opts.force) return 'skipped';
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
    .option('--target <agents>', 'Comma-separated: copilot,claude,cursor,hooks (default: all)')
    .option('--force', 'Overwrite existing files')
    .option('--append', 'Append to existing files instead of skipping')
    .option('--dry-run', 'Show what would be written without writing')
    .option('--list', 'List file paths that would be created')
    .action((dir: string | undefined, opts) => {
      const targetDir = dir ?? process.cwd();

      // Validate directory exists (unless --global)
      if (!opts.global && dir && !existsSync(targetDir)) {
        console.log(chalk.red(`\n  ✗ Directory does not exist: ${targetDir}`));
        console.log(chalk.dim('  Provide a valid project directory or omit to use current directory.\n'));
        process.exit(1);
      }

      const validTargets: Target[] = ['copilot', 'claude', 'cursor', 'hooks'];
      const requestedTargets: string[] = opts.target
        ? opts.target.split(',').map((s: string) => s.trim())
        : [...validTargets];

      // Validate target names
      const invalid = requestedTargets.filter(t => !validTargets.includes(t as Target));
      if (invalid.length > 0) {
        console.log(chalk.yellow(`\n  ⚠ Unknown targets: ${invalid.join(', ')}`));
        console.log(chalk.dim(`  Valid targets: ${validTargets.join(', ')}`));
      }
      const targets = requestedTargets.filter(t => validTargets.includes(t as Target)) as Target[];

      const files = opts.global
        ? getGlobalFiles().filter(f => targets.includes(f.target))
        : getProjectFiles(targetDir).filter(f => targets.includes(f.target));

      if (files.length === 0) {
        console.log(chalk.yellow('\n  No valid targets matched.'));
        console.log(chalk.dim(`  Valid targets: ${validTargets.join(', ')}\n`));
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
