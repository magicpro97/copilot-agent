# copilot-agent

Autonomous GitHub Copilot CLI agent — auto-resume sessions, discover tasks, run overnight.

## Features

- **`status`** — View recent & active Copilot sessions with premium usage
- **`watch`** — Monitor a session, auto-resume when it stops
- **`run`** — Auto-discover and fix issues in any project
- **`overnight`** — Run tasks continuously until a deadline (e.g. 07:00)
- **`research`** — Research improvements, dependencies, architecture

## Install

```bash
npm install -g copilot-agent
```

Requires [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) installed and authenticated.

## Usage

### Show session status

```bash
# Recent sessions
copilot-agent status

# Active (running) sessions only
copilot-agent status --active
```

### Watch & auto-resume

```bash
# Auto-detect latest incomplete session
copilot-agent watch

# Watch specific session
copilot-agent watch abc12345-...

# Custom resume settings
copilot-agent watch --steps 100 --max-resumes 50
```

### Discover & fix issues

```bash
# Run on current directory
copilot-agent run

# Run on specific project
copilot-agent run ~/my-project

# Preview tasks without executing
copilot-agent run --dry-run
```

### Overnight runner

```bash
# Run until 7am (default)
copilot-agent overnight ~/my-project

# Custom deadline & budget
copilot-agent overnight --until 06:00 --max-premium 200

# Preview
copilot-agent overnight --dry-run
```

### Research

```bash
# Run all predefined research tasks
copilot-agent research

# Research a specific topic
copilot-agent research "migrate from Room to SQLDelight"
```

## How it works

1. **Session detection** — Reads `~/.copilot/session-state/*/events.jsonl` to detect task completion vs interruption
2. **Auto-resume** — Uses `copilot --resume=SESSION_ID --autopilot` to continue interrupted sessions
3. **Task discovery** — Detects project type (KMP, React, Python, etc.) and generates relevant maintenance tasks
4. **Race prevention** — File locking via `proper-lockfile` prevents concurrent copilot runs
5. **Process tracking** — Uses `ps-list` to find and wait for copilot processes by PID

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
- GitHub Copilot CLI installed & authenticated
- macOS or Linux

## License

MIT
