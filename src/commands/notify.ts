import type { Command } from 'commander';
import chalk from 'chalk';
import { loadNotifyConfig, saveNotifyConfig, sendNotification, type NotifyProvider, type NotifyConfig } from '../lib/notify.js';

export function registerNotifyCommand(program: Command): void {
  const cmd = program
    .command('notify')
    .description('Configure notifications (OS, Telegram, Discord, Slack)');

  // ── notify status ────────────────────────────────────────────
  cmd
    .command('status')
    .description('Show notification configuration')
    .action(() => {
      const config = loadNotifyConfig();
      console.log(chalk.bold.cyan('\n  🔔 Notification Configuration\n'));

      const enabled = config.enabled ? chalk.green('ON') : chalk.red('OFF');
      console.log(`  Status: ${enabled}`);

      const providers = config.providers || [];
      if (providers.length === 0) {
        console.log(chalk.dim('\n  No providers configured'));
        console.log(chalk.dim('  Run: copilot-agent notify add <type>\n'));
        return;
      }

      console.log(`\n  ${chalk.bold('Providers:')}`);
      for (const p of providers) {
        const icon = p.enabled !== false ? chalk.green('●') : chalk.red('○');
        const name = p.name || p.type;
        let detail = '';
        if (p.type === 'telegram') detail = p.chatId ? chalk.dim(` → chat:${p.chatId}`) : chalk.yellow(' (not configured)');
        if (p.type === 'discord' || p.type === 'slack') detail = p.webhookUrl ? chalk.dim(' → webhook set') : chalk.yellow(' (no webhook)');
        if (p.type === 'os') detail = chalk.dim(' → native');
        console.log(`    ${icon} ${chalk.white(name)} ${chalk.dim(`[${p.type}]`)}${detail}`);
      }

      // Events
      const defaultEvents = { on_session_end: true, on_task_complete: true, on_error: true, on_overnight_done: true };
      const events = Object.entries({ ...defaultEvents, ...config.events });
      if (events.length > 0) {
        console.log(`\n  ${chalk.bold('Events:')}`);
        for (const [k, v] of events) {
          const icon = v ? chalk.green('✔') : chalk.red('✗');
          console.log(`    ${icon} ${k}`);
        }
      }
      console.log();
    });

  // ── notify enable / disable ──────────────────────────────────
  cmd
    .command('enable')
    .description('Enable notifications')
    .action(() => {
      const config = loadNotifyConfig();
      config.enabled = true;
      saveNotifyConfig(config);
      console.log(chalk.green('  ✔ Notifications enabled'));
    });

  cmd
    .command('disable')
    .description('Disable notifications')
    .action(() => {
      const config = loadNotifyConfig();
      config.enabled = false;
      saveNotifyConfig(config);
      console.log(chalk.yellow('  ○ Notifications disabled'));
    });

  // ── notify add <type> ────────────────────────────────────────
  cmd
    .command('add <type>')
    .description('Add a notification provider (os, telegram, discord, slack)')
    .option('--name <name>', 'Display name')
    .option('--bot-token <token>', 'Telegram bot token')
    .option('--chat-id <id>', 'Telegram chat ID')
    .option('--webhook <url>', 'Discord/Slack webhook URL')
    .action((type: string, opts: { name?: string; botToken?: string; chatId?: string; webhook?: string }) => {
      const validTypes = ['os', 'telegram', 'discord', 'slack'];
      if (!validTypes.includes(type)) {
        console.log(chalk.red(`  ✗ Invalid type: ${type}`));
        console.log(chalk.dim(`  Valid: ${validTypes.join(', ')}`));
        return;
      }

      const config = loadNotifyConfig();
      if (!config.providers) config.providers = [];
      if (!config.enabled) config.enabled = true;

      const provider: NotifyProvider = {
        type: type as NotifyProvider['type'],
        name: opts.name || type,
        enabled: true,
      };

      if (type === 'telegram') {
        if (!opts.botToken || !opts.chatId) {
          console.log(chalk.yellow('\n  Telegram requires --bot-token and --chat-id'));
          console.log(chalk.dim('  1. Message @BotFather on Telegram to create a bot'));
          console.log(chalk.dim('  2. Send /start to your bot, then get chat ID from:'));
          console.log(chalk.dim('     https://api.telegram.org/bot<TOKEN>/getUpdates\n'));
          console.log(chalk.dim('  Example:'));
          console.log(chalk.cyan('    copilot-agent notify add telegram --bot-token BOT_TOKEN --chat-id 123456789\n'));
          return;
        }
        provider.botToken = opts.botToken;
        provider.chatId = opts.chatId;
      }

      if ((type === 'discord' || type === 'slack') && !opts.webhook) {
        const service = type === 'discord' ? 'Discord' : 'Slack';
        console.log(chalk.yellow(`\n  ${service} requires --webhook <url>`));
        console.log(chalk.dim(`  Create an incoming webhook in ${service} settings.\n`));
        console.log(chalk.dim('  Example:'));
        console.log(chalk.cyan(`    copilot-agent notify add ${type} --webhook https://hooks.${type}.com/...\n`));
        return;
      }
      if (opts.webhook) provider.webhookUrl = opts.webhook;

      // Check if provider already exists
      const existing = config.providers.findIndex(p => p.type === type && (p.name || p.type) === (opts.name || type));
      if (existing >= 0) {
        config.providers[existing] = provider;
        console.log(chalk.green(`  ✔ Updated ${type} provider`));
      } else {
        config.providers.push(provider);
        console.log(chalk.green(`  ✔ Added ${type} provider`));
      }

      // Set default events if not set
      if (!config.events) {
        config.events = {
          on_session_end: true,
          on_task_complete: true,
          on_error: true,
          on_overnight_done: true,
        };
      }

      saveNotifyConfig(config);
      console.log(chalk.dim('  Run: copilot-agent notify test'));
    });

  // ── notify remove <name> ─────────────────────────────────────
  cmd
    .command('remove <name>')
    .description('Remove a notification provider by name/type')
    .action((name: string) => {
      const config = loadNotifyConfig();
      if (!config.providers) {
        console.log(chalk.dim('  No providers configured'));
        return;
      }
      const before = config.providers.length;
      config.providers = config.providers.filter(p => (p.name || p.type) !== name && p.type !== name);
      if (config.providers.length < before) {
        saveNotifyConfig(config);
        console.log(chalk.green(`  ✔ Removed provider: ${name}`));
      } else {
        console.log(chalk.yellow(`  ⚠ Provider not found: ${name}`));
      }
    });

  // ── notify test ──────────────────────────────────────────────
  cmd
    .command('test')
    .description('Send a test notification to all providers')
    .action(async () => {
      const config = loadNotifyConfig();
      if (!config.providers || config.providers.length === 0) {
        console.log(chalk.yellow('  No providers configured. Run: copilot-agent notify add <type>'));
        return;
      }

      // Temporarily enable for test
      const wasEnabled = config.enabled;
      config.enabled = true;
      saveNotifyConfig(config);

      console.log(chalk.cyan('\n  Sending test notification...\n'));

      const results = await sendNotification({
        title: '🔔 Test Notification',
        body: 'copilot-agent notifications are working!',
        event: 'test',
        urgency: 'normal',
      });

      for (const r of results) {
        const icon = r.success ? chalk.green('✔') : chalk.red('✗');
        console.log(`  ${icon} ${r.provider}${r.error ? chalk.red(` — ${r.error}`) : ''}`);
      }

      if (results.length === 0) {
        console.log(chalk.dim('  No providers enabled'));
      }

      // Restore
      if (!wasEnabled) {
        config.enabled = wasEnabled;
        saveNotifyConfig(config);
      }
      console.log();
    });

  // ── notify events ────────────────────────────────────────────
  cmd
    .command('events')
    .description('Configure which events trigger notifications')
    .option('--session-end <bool>', 'on_session_end')
    .option('--task-complete <bool>', 'on_task_complete')
    .option('--error <bool>', 'on_error')
    .option('--overnight-done <bool>', 'on_overnight_done')
    .action((opts: Record<string, string>) => {
      const config = loadNotifyConfig();
      if (!config.events) config.events = {};

      const mapping: Record<string, keyof NonNullable<NotifyConfig['events']>> = {
        sessionEnd: 'on_session_end',
        taskComplete: 'on_task_complete',
        error: 'on_error',
        overnightDone: 'on_overnight_done',
      };

      let changed = false;
      for (const [opt, key] of Object.entries(mapping)) {
        if (opts[opt] !== undefined) {
          (config.events as any)[key] = opts[opt] === 'true';
          changed = true;
        }
      }

      if (changed) {
        saveNotifyConfig(config);
        console.log(chalk.green('  ✔ Events updated'));
      }

      // Show current
      console.log(chalk.bold.cyan('\n  Event Configuration:\n'));
      const defaults = { on_session_end: true, on_task_complete: true, on_error: true, on_overnight_done: true };
      const events = { ...defaults, ...config.events };
      for (const [k, v] of Object.entries(events)) {
        const icon = v ? chalk.green('✔') : chalk.red('✗');
        console.log(`    ${icon} ${k}`);
      }
      console.log();
    });
}
