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
| **`dashboard`** | htop-style TUI dashboard with blessed (scrollable, keyboard nav) |
| **`web`** | Web dashboard with live updates (Hono + htmx + SSE) |
| **`config`** | Persistent configuration defaults (global + per-project) |
| **`proxy`** | Manage copilot-api proxy for Claude Code via Copilot |
| **`diff`** | Show git changes made by an agent session |
| **`quota`** | Track premium requests, tokens, and usage over time |
| **`compact`** | Generate context summary for session handoff/resume |
| **`hooks`** | Event-driven automation (on_task_complete, on_error, etc.) |
| **`pr`** | Auto-create GitHub Pull Request from session changes |
| **`log`** | Search, timeline, and export session history |
| **`template`** | Manage custom task templates (add/list/remove/import/export) |

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
```

### Session report & diff

```bash
# Latest session report
copilot-agent report

# Show git changes from latest session
copilot-agent diff

# Show changes from specific session with diffstat
copilot-agent diff abc12345-... --stat
```

### Dashboards

```bash
# htop-style TUI (blessed — scrollable, keyboard nav, cached rendering)
copilot-agent dashboard

# Custom refresh interval
copilot-agent dashboard --refresh 3

# Web UI (Hono + htmx, opens browser)
copilot-agent web
```

### Configuration

```bash
# Set persistent defaults
copilot-agent config set agent claude
copilot-agent config set steps 50
copilot-agent config set worktree true

# View all config (defaults + global + project)
copilot-agent config list

# Per-project config: create .copilot-agent.yaml in project root
```

### Proxy management (Claude Code via Copilot)

```bash
# Start copilot-api proxy (auto-detects Copilot OAuth token)
copilot-agent proxy start

# Check status (PID, port, token, model count)
copilot-agent proxy status
```

### Usage tracking

```bash
# Show last 7 days of premium/token usage
copilot-agent quota

# All-time usage
copilot-agent quota --all

# Last 30 days
copilot-agent quota --days 30
```

### Context handoff (compact)

```bash
# Generate context summary from latest session
copilot-agent compact

# Save compact to file
copilot-agent compact --save

# Get a resume prompt to continue the work
copilot-agent compact --resume-prompt
```

### Hooks (event-driven automation)

```bash
# Show configured hooks
copilot-agent hooks list

# Test-run hooks for an event
copilot-agent hooks test on_task_complete
```

Create `~/.copilot-agent/hooks.yaml` or `.copilot-agent/hooks.yaml`:

```yaml
on_task_complete:
  - command: "npm test"
    name: "Run tests"
on_session_end:
  - command: "git push origin HEAD"
    name: "Auto-push"
on_error:
  - command: "curl -X POST $SLACK_WEBHOOK -d '{\"text\":\"Agent error!\"}'"
    name: "Notify Slack"
```

### Auto-create Pull Request

```bash
# Create PR from latest session
copilot-agent pr

# Dry-run (preview without creating)
copilot-agent pr --dry-run

# Create ready (non-draft) PR
copilot-agent pr --no-draft
```

### Session log (search & export)

```bash
# Search sessions by keyword
copilot-agent log search "auth" --limit 10

# View session timeline
copilot-agent log timeline <session-id>

# Export history as JSON or CSV
copilot-agent log export --format json --output sessions.json
copilot-agent log export --format csv --limit 50
```

### Task templates

```bash
# List custom templates
copilot-agent template list

# Add a reusable task template
copilot-agent template add security-audit --prompt "Run a full security audit"

# Remove a template
copilot-agent template remove security-audit

# Export/import templates (YAML)
copilot-agent template export > my-templates.yaml
copilot-agent template import team-templates.yaml
```

## How it works

1. **Agent abstraction** — Unified interface for both Copilot CLI and Claude Code
2. **Session detection** — Reads Copilot (`~/.copilot/session-state/`) and Claude (`~/.claude/projects/`) session files
3. **Auto-resume** — Copilot: `--resume --autopilot`; Claude: `--resume --dangerously-skip-permissions`
4. **Task discovery** — Detects project type and generates relevant maintenance tasks
5. **Race prevention** — File locking + process tracking prevents concurrent agents in the same directory
6. **Worktree isolation** — Optional `--worktree` flag for parallel task execution via `git worktree`
7. **Config layering** — Defaults → `~/.copilot-agent/config.yaml` → `.copilot-agent.yaml` → CLI flags

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
