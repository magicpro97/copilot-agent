import type { Command } from 'commander';
import chalk from 'chalk';
import { loadHooksConfig, runHooks, getHooksSummary, type HookEvent } from '../lib/hooks.js';

export function registerHooksCommand(program: Command): void {
  const cmd = program
    .command('hooks')
    .description('Manage event-driven automation hooks');

  cmd
    .command('list')
    .description('Show all configured hooks')
    .action(() => {
      const config = loadHooksConfig();
      const summary = getHooksSummary(config);

      console.log(chalk.bold.cyan('\n  ⚡ Hooks Configuration\n'));

      if (summary.length === 0) {
        console.log(chalk.dim('  No hooks configured'));
        console.log(chalk.dim('\n  Create ~/.copilot-agent/hooks.yaml or .copilot-agent/hooks.yaml:'));
        console.log(chalk.dim('  on_task_complete:'));
        console.log(chalk.dim('    - command: "npm test"'));
        console.log(chalk.dim('      name: "Run tests"'));
        console.log();
        return;
      }

      const events: HookEvent[] = ['on_session_start', 'on_task_complete', 'on_session_end', 'on_error', 'on_resume'];
      for (const event of events) {
        const hooks = config[event];
        if (!hooks || hooks.length === 0) continue;

        console.log(chalk.bold(`  ${event}`) + chalk.dim(` (${hooks.length})`));
        for (const h of hooks) {
          const name = h.name ? chalk.white(h.name) : chalk.dim('unnamed');
          const timeout = h.timeout ? chalk.dim(` (${h.timeout}s)`) : '';
          console.log(`    ${chalk.green('●')} ${name}: ${chalk.cyan(h.command)}${timeout}`);
        }
        console.log();
      }
    });

  cmd
    .command('test <event>')
    .description('Test-run hooks for a specific event')
    .action(async (event: string) => {
      const validEvents: HookEvent[] = ['on_session_start', 'on_task_complete', 'on_session_end', 'on_error', 'on_resume'];
      if (!validEvents.includes(event as HookEvent)) {
        console.log(chalk.red(`  ✗ Invalid event: ${event}`));
        console.log(chalk.dim(`  Valid events: ${validEvents.join(', ')}`));
        return;
      }

      console.log(chalk.cyan(`\n  Running hooks for ${chalk.bold(event)}...\n`));

      const results = await runHooks(event as HookEvent);

      if (results.length === 0) {
        console.log(chalk.dim(`  No hooks configured for ${event}`));
        return;
      }

      for (const r of results) {
        const icon = r.success ? chalk.green('✔') : chalk.red('✗');
        const name = r.hook.name || r.hook.command;
        const time = chalk.dim(`${r.durationMs}ms`);
        console.log(`  ${icon} ${name} ${time}`);
        if (r.output) console.log(chalk.dim(`    ${r.output.split('\n')[0]}`));
        if (r.error) console.log(chalk.red(`    ${r.error.split('\n')[0]}`));
      }
      console.log();
    });
}
