import type { Command } from 'commander';
import chalk from 'chalk';
import { loadGlobalConfig, setConfigValue, deleteConfigValue, resetConfig, resolveConfig } from '../lib/config.js';

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .description('Manage persistent configuration defaults');

  cmd
    .command('list')
    .description('Show all configuration values')
    .action(() => {
      const global = loadGlobalConfig();
      const resolved = resolveConfig();
      console.log(chalk.bold.cyan('\n  Global Config') + chalk.dim(' (~/.copilot-agent/config.yaml)\n'));
      const entries = Object.entries(global);
      if (entries.length === 0) {
        console.log(chalk.dim('  (empty — using defaults)\n'));
      } else {
        for (const [k, v] of entries) {
          console.log(`  ${chalk.bold(k.padEnd(16))} ${chalk.green(String(v))}`);
        }
        console.log();
      }
      console.log(chalk.bold.cyan('  Resolved Config') + chalk.dim(' (defaults + global + project)\n'));
      for (const [k, v] of Object.entries(resolved)) {
        if (v !== undefined) {
          const isOverride = (global as any)[k] !== undefined;
          const marker = isOverride ? chalk.yellow('●') : chalk.dim('○');
          console.log(`  ${marker} ${chalk.bold(k.padEnd(16))} ${String(v)}`);
        }
      }
      console.log();
    });

  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      setConfigValue(key, value);
      console.log(chalk.green(`  ✔ Set ${chalk.bold(key)} = ${value}`));
    });

  cmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const resolved = resolveConfig();
      const val = (resolved as any)[key];
      if (val !== undefined) {
        console.log(`  ${chalk.bold(key)} = ${chalk.green(String(val))}`);
      } else {
        console.log(chalk.dim(`  ${key} is not set`));
      }
    });

  cmd
    .command('unset <key>')
    .description('Remove a configuration value')
    .action((key: string) => {
      deleteConfigValue(key);
      console.log(chalk.yellow(`  ✔ Removed ${chalk.bold(key)}`));
    });

  cmd
    .command('reset')
    .description('Reset all configuration to defaults')
    .action(() => {
      resetConfig();
      console.log(chalk.yellow('  ✔ Configuration reset to defaults'));
    });
}
