import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { detectProjectType, type ProjectType } from './detect.js';

// ── Types ────────────────────────────────────────────────────────

export interface VerifyCheck {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface VerifyResult {
  passed: boolean;
  project: string;
  projectType: ProjectType;
  checks: VerifyCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  timestamp: string;
  durationMs: number;
  failedChecks: string[];
  feedback: string; // human/agent-readable feedback for retry
}

export interface VerifyOptions {
  checks?: ('test' | 'lint' | 'build' | 'typecheck')[];
  timeout?: number; // per-check timeout in seconds
  dir: string;
}

// ── Auto-detect commands ─────────────────────────────────────────

interface DetectedCommands {
  test?: string;
  lint?: string;
  build?: string;
  typecheck?: string;
}

function detectCommands(dir: string, projectType: ProjectType): DetectedCommands {
  const cmds: DetectedCommands = {};

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};

      // Test: prefer test script
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        cmds.test = 'npm test';
      } else if (scripts['test:unit']) {
        cmds.test = 'npm run test:unit';
      } else if (scripts.vitest) {
        cmds.test = 'npm run vitest';
      }

      // Lint
      if (scripts.lint) cmds.lint = 'npm run lint';
      else if (scripts['lint:check']) cmds.lint = 'npm run lint:check';

      // Build
      if (scripts.build) cmds.build = 'npm run build';

      // Typecheck
      if (scripts.typecheck) cmds.typecheck = 'npm run typecheck';
      else if (scripts['type-check']) cmds.typecheck = 'npm run type-check';
      else if (existsSync(join(dir, 'tsconfig.json'))) {
        cmds.typecheck = 'npx tsc --noEmit';
      }
    } catch { /* ignore */ }
  }

  // Gradle-based projects
  if (['kmp', 'kotlin', 'java'].includes(projectType)) {
    const gradle = existsSync(join(dir, 'gradlew')) ? './gradlew' : 'gradle';
    cmds.test = cmds.test || `${gradle} test`;
    cmds.build = cmds.build || `${gradle} build -x test`;
    cmds.lint = cmds.lint || `${gradle} detekt 2>/dev/null || ${gradle} ktlintCheck 2>/dev/null || true`;
  }

  // Python
  if (projectType === 'python') {
    cmds.test = cmds.test || 'python -m pytest';
    cmds.lint = cmds.lint || 'python -m ruff check . 2>/dev/null || python -m flake8 . 2>/dev/null || true';
    cmds.typecheck = cmds.typecheck || 'python -m mypy . 2>/dev/null || true';
  }

  // Rust
  if (projectType === 'rust') {
    cmds.test = 'cargo test';
    cmds.build = 'cargo build';
    cmds.lint = 'cargo clippy -- -D warnings 2>/dev/null || true';
  }

  // Go
  if (projectType === 'go') {
    cmds.test = 'go test ./...';
    cmds.build = 'go build ./...';
    cmds.lint = 'golangci-lint run 2>/dev/null || go vet ./...';
  }

  // Flutter
  if (projectType === 'flutter') {
    cmds.test = 'flutter test';
    cmds.build = 'flutter build apk --debug 2>/dev/null || true';
    cmds.lint = 'dart analyze';
  }

  // Swift
  if (projectType === 'swift') {
    cmds.test = 'swift test';
    cmds.build = 'swift build';
  }

  return cmds;
}

// ── Run a single check ───────────────────────────────────────────

function runCheck(name: string, command: string, dir: string, timeoutSec: number): VerifyCheck {
  const start = Date.now();
  try {
    const result = execSync(command, {
      cwd: dir,
      timeout: timeoutSec * 1000,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    return {
      name, command, passed: true, exitCode: 0,
      stdout: (result || '').slice(-2000),
      stderr: '',
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      name, command, passed: false,
      exitCode: err.status ?? 1,
      stdout: (err.stdout || '').slice(-2000),
      stderr: (err.stderr || '').slice(-2000),
      durationMs: Date.now() - start,
    };
  }
}

// ── Main verify ──────────────────────────────────────────────────

export function runVerify(opts: VerifyOptions): VerifyResult {
  const start = Date.now();
  const projectType = detectProjectType(opts.dir);
  const detected = detectCommands(opts.dir, projectType);
  const timeout = opts.timeout || 120;

  const allChecks: { key: string; name: string; cmd?: string }[] = [
    { key: 'typecheck', name: 'Type Check', cmd: detected.typecheck },
    { key: 'lint', name: 'Lint', cmd: detected.lint },
    { key: 'build', name: 'Build', cmd: detected.build },
    { key: 'test', name: 'Tests', cmd: detected.test },
  ];

  // Filter to requested checks (or all)
  const requested = opts.checks || ['typecheck', 'lint', 'build', 'test'];

  const checks: VerifyCheck[] = [];
  for (const c of allChecks) {
    if (!requested.includes(c.key as any)) continue;

    if (!c.cmd) {
      checks.push({
        name: c.name, command: '', passed: true, exitCode: 0,
        stdout: '', stderr: '', durationMs: 0,
        skipped: true, skipReason: `No ${c.key} command detected`,
      });
      continue;
    }

    checks.push(runCheck(c.name, c.cmd, opts.dir, timeout));
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed && !c.skipped).length;
  const skipped = checks.filter(c => c.skipped).length;
  const failedChecks = checks.filter(c => !c.passed && !c.skipped).map(c => c.name);

  // Generate feedback for AI agent retry
  let feedback = '';
  if (failedChecks.length > 0) {
    const parts: string[] = [];
    for (const c of checks) {
      if (c.passed || c.skipped) continue;
      const output = (c.stderr || c.stdout).trim().split('\n').slice(-20).join('\n');
      parts.push(`## ${c.name} FAILED (exit ${c.exitCode})\nCommand: ${c.command}\n\n${output}`);
    }
    feedback = `Quality checks failed. Fix these issues:\n\n${parts.join('\n\n---\n\n')}`;
  } else {
    feedback = 'All quality checks passed.';
  }

  // Detect project name
  let projectName = '';
  try {
    const pkg = JSON.parse(readFileSync(join(opts.dir, 'package.json'), 'utf-8'));
    projectName = pkg.name || '';
  } catch { /* ignore */ }
  if (!projectName) {
    projectName = opts.dir.split('/').pop() || opts.dir;
  }

  return {
    passed: failedChecks.length === 0,
    project: projectName,
    projectType,
    checks,
    summary: { total: checks.length, passed, failed, skipped },
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
    failedChecks,
    feedback,
  };
}
