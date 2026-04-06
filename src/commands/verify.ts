import type { Command } from 'commander';
import chalk from 'chalk';
import { runVerify, type VerifyResult } from '../lib/verify.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify [dir]')
    .description('Run quality gates — tests, lint, build, typecheck')
    .option('--json', 'Output structured JSON (for AI agents)')
    .option('--checks <list>', 'Comma-separated: test,lint,build,typecheck', 'test,lint,build,typecheck')
    .option('--timeout <n>', 'Per-check timeout in seconds', '120')
    .option('--feedback', 'Print agent-friendly feedback on failure')
    .action((dir: string | undefined, opts) => {
      const checks = opts.checks.split(',').map((s: string) => s.trim()).filter(Boolean);
      const result = runVerify({
        dir: dir ?? process.cwd(),
        checks,
        timeout: parseInt(opts.timeout, 10),
      });

      if (opts.json) {
        // Structured JSON for AI agents — clean, parseable
        console.log(JSON.stringify(result, null, 2));
      } else {
        printHuman(result);
      }

      if (opts.feedback && !result.passed) {
        console.log('\n' + result.feedback);
      }

      // Meaningful exit codes: 0=pass, 1=failed, 2=all skipped
      if (!result.passed) process.exit(1);
      if (result.summary.skipped === result.summary.total) process.exit(2);
    });
}

function printHuman(result: VerifyResult): void {
  console.log(chalk.bold.cyan(`\n  🔍 Quality Gate — ${result.project} (${result.projectType})\n`));

  for (const c of result.checks) {
    let icon: string;
    let detail: string;

    if (c.skipped) {
      icon = chalk.dim('○');
      detail = chalk.dim(c.skipReason || 'skipped');
    } else if (c.passed) {
      icon = chalk.green('✔');
      detail = chalk.dim(`${c.durationMs}ms`);
    } else {
      icon = chalk.red('✗');
      detail = chalk.red(`exit ${c.exitCode}`) + chalk.dim(` ${c.durationMs}ms`);
    }

    console.log(`  ${icon} ${chalk.bold(c.name.padEnd(14))} ${detail}`);

    // Show last few lines of error output
    if (!c.passed && !c.skipped) {
      const output = (c.stderr || c.stdout).trim().split('\n').slice(-5);
      for (const line of output) {
        console.log(chalk.dim(`    ${line}`));
      }
    }
  }

  // Summary
  const { passed, failed, skipped, total } = result.summary;
  console.log();
  if (result.passed) {
    console.log(chalk.green(`  ✔ All checks passed (${passed}/${total})`) + chalk.dim(` in ${result.durationMs}ms`));
  } else {
    console.log(chalk.red(`  ✗ ${failed} check(s) failed`) + chalk.dim(` (${passed} passed, ${skipped} skipped) in ${result.durationMs}ms`));
    console.log(chalk.dim(`  Failed: ${result.failedChecks.join(', ')}`));
  }
  console.log();
}
