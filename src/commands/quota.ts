import type { Command } from 'commander';
import chalk from 'chalk';
import { buildUsageSummary, formatTokens, formatDurationShort } from '../lib/quota.js';

export function registerQuotaCommand(program: Command): void {
  program
    .command('quota')
    .description('Track premium requests, tokens, and usage over time')
    .option('-d, --days <n>', 'Number of days to show', '7')
    .option('--all', 'Show all-time usage')
    .action((opts) => {
      const days = opts.all ? undefined : parseInt(opts.days, 10);
      const label = days ? `Last ${days} days` : 'All time';
      const summary = buildUsageSummary(days);

      console.log();
      console.log(chalk.bold.cyan(`  ⬡ Usage Summary — ${label}`));
      console.log(chalk.dim(`  ${'─'.repeat(50)}`));
      console.log();

      // Total stats
      const t = summary.total;
      console.log(`  ${chalk.bold('Sessions')}     ${chalk.white(String(t.sessions))}`);
      console.log(`  ${chalk.bold('Premium')}      ${chalk.yellow('⬡ ' + String(t.premium))}`);
      console.log(`  ${chalk.bold('Tokens')}       ${chalk.green(formatTokens(t.tokens))}`);
      console.log(`  ${chalk.bold('Turns')}        ${chalk.white(String(t.turns))}`);
      console.log(`  ${chalk.bold('Total time')}   ${chalk.white(formatDurationShort(t.durationMs))}`);
      console.log();

      // Per-agent breakdown
      if (summary.copilot.sessions > 0 || summary.claude.sessions > 0) {
        console.log(chalk.bold.cyan('  Per Agent'));
        console.log(chalk.dim(`  ${'─'.repeat(50)}`));

        if (summary.copilot.sessions > 0) {
          const c = summary.copilot;
          console.log(`  ${chalk.cyan('copilot')}  ${String(c.sessions).padStart(4)} sessions  ${chalk.yellow('⬡' + String(c.premium).padStart(5))}  ${chalk.green(formatTokens(c.tokens).padStart(7))} tokens`);
        }
        if (summary.claude.sessions > 0) {
          const c = summary.claude;
          console.log(`  ${chalk.yellow('claude ')}  ${String(c.sessions).padStart(4)} sessions  ${chalk.yellow('⬡' + String(c.premium).padStart(5))}  ${chalk.green(formatTokens(c.tokens).padStart(7))} tokens`);
        }
        console.log();
      }

      // Daily chart
      const dayEntries = Object.entries(summary.byDay).sort((a, b) => a[0].localeCompare(b[0]));
      if (dayEntries.length > 0) {
        console.log(chalk.bold.cyan('  Daily Usage'));
        console.log(chalk.dim(`  ${'─'.repeat(50)}`));

        const maxPremium = Math.max(...dayEntries.map(([, d]) => d.premium), 1);
        const barWidth = 24;

        for (const [day, data] of dayEntries.slice(-14)) {
          const shortDay = day.slice(5);
          const filled = Math.round((data.premium / maxPremium) * barWidth);
          const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(barWidth - filled));
          console.log(`  ${chalk.dim(shortDay)} ${bar} ${chalk.yellow('⬡' + String(data.premium).padStart(4))}  ${chalk.dim(String(data.sessions) + ' sess')}`);
        }
        console.log();
      }
    });
}
