import { Command } from 'commander';
import { registerStatusCommand } from './commands/status.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerRunCommand } from './commands/run.js';
import { registerOvernightCommand } from './commands/overnight.js';
import { registerResearchCommand } from './commands/research.js';
import { registerReportCommand } from './commands/report.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerWebCommand } from './commands/web.js';
import { registerConfigCommand } from './commands/config.js';
import { registerProxyCommand } from './commands/proxy.js';
import { registerDiffCommand } from './commands/diff.js';

const program = new Command();

program
  .name('copilot-agent')
  .version('0.9.0')
  .description('Autonomous AI agent manager — auto-resume, task discovery, overnight runs. Supports GitHub Copilot CLI + Claude Code.');

registerStatusCommand(program);
registerWatchCommand(program);
registerRunCommand(program);
registerOvernightCommand(program);
registerResearchCommand(program);
registerReportCommand(program);
registerDashboardCommand(program);
registerWebCommand(program);
registerConfigCommand(program);
registerProxyCommand(program);
registerDiffCommand(program);

program.parse();
