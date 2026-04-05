# copilot-agent

Autonomous AI agent manager — auto-resume sessions, discover tasks, run overnight. Supports **GitHub Copilot CLI** and **Claude Code**.

## Features

| Command | Description |
|---------|-------------|
| **`status`** | View sessions & active processes from both Copilot and Claude |
| **`watch`** | Monitor a session, auto-resume when it stops |
| **`run`** | Auto-discover and fix issues in any project |
| **`overnight`** | Run tasks continuously until a deadline (e.g. 07:00) |
| **`research`** | Architecture, security, and performance analysis |
| **`report`** | Session activity report — tools, commits, files, tokens |
| **`dashboard`** | Real-time TUI dashboard (pure terminal) |
| **`web`** | Web dashboard with live updates (Hono + htmx + SSE) |

All commands support `--agent copilot` or `--agent claude` (auto-detects if omitted).

## Install

```bash
npm install -g copilot-agent
```

### Prerequisites

At least one of:

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) — installed and authenticated
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — installed and authenticated

## Usage

### Show session status

```bash
# All sessions (copilot + claude merged)
copilot-agent status

# Active processes only
copilot-agent status --active

# Filter by agent
copilot-agent status --agent claude
copilot-agent status --agent copilot
```

### Watch & auto-resume

```bash
# Auto-detect latest incomplete session
copilot-agent watch

# Watch specific session with Claude
copilot-agent watch abc12345-... --agent claude

# Custom resume settings
copilot-agent watch --steps 100 --max-resumes 50
```

### Discover & fix issues

```bash
# Run with auto-detected agent
copilot-agent run

# Run on specific project with Claude Code
copilot-agent run ~/my-project --agent claude

# Preview tasks without executing
copilot-agent run --dry-run

# Use git worktree for parallel execution
copilot-agent run --worktree
```

### Overnight runner

```bash
# Run until 7am (default)
copilot-agent overnight ~/my-project

# Run with Claude Code
copilot-agent overnight --agent claude --until 07 --max-premium 200

# Use worktree for parallel tasks
copilot-agent overnight --worktree
```

### Session report

```bash
# Latest session
copilot-agent report

# Specific session
copilot-agent report abc12345-...

# Multiple recent sessions as JSON
copilot-agent report -l 5 --json

# Filter by project directory
copilot-agent report --project ~/my-project
```

### Research

```bash
# Analyze current project
copilot-agent research

# With Claude Code
copilot-agent research --agent claude
```

### Dashboards

```bash
# Terminal UI (pure ANSI, no deps)
copilot-agent dashboard

# Web UI (Hono + htmx, opens browser)
copilot-agent web
copilot-agent web --port 8080
```

## How it works

1. **Agent abstraction** — Unified interface for both Copilot CLI and Claude Code
2. **Session detection** — Reads Copilot (`~/.copilot/session-state/`) and Claude (`~/.claude/projects/`) session files
3. **Auto-resume** — Copilot: `--resume --autopilot`; Claude: `--resume --dangerously-skip-permissions`
4. **Task discovery** — Detects project type and generates relevant maintenance tasks
5. **Race prevention** — File locking + process tracking prevents concurrent agents in the same directory
6. **Worktree isolation** — Optional `--worktree` flag for parallel task execution via `git worktree`

## Supported project types

| Type | Detection | Specialized tasks |
|------|-----------|-------------------|
| KMP | `gradle.properties` + `composeApp/` | Compose optimization, expect/actual, Room migrations |
| TypeScript | `tsconfig.json` | Strict types, `any` removal |
| React | `vite.config.ts` | Performance, re-renders |
| Node | `package.json` | Error handling |
| Python | `pyproject.toml` | Type hints |
| + 7 more | Auto-detected | Common tasks (TODOs, deps, tests, lint, docs, security) |

## Requirements

- Node.js ≥ 18
- macOS or Linux
- At least one: GitHub Copilot CLI or Claude Code

## License

MIT
