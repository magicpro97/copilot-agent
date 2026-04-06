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
import { registerQuotaCommand } from './commands/quota.js';
import { registerCompactCommand } from './commands/compact.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerPrCommand } from './commands/pr.js';
import { registerTemplateCommand } from './commands/template.js';
import { registerLogCommand } from './commands/log.js';
import { registerMultiCommand } from './commands/multi.js';
import { registerReviewCommand } from './commands/review.js';
import { registerScheduleCommand } from './commands/schedule.js';

const program = new Command();

program
  .name('copilot-agent')
  .version('1.2.3')
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
registerQuotaCommand(program);
registerCompactCommand(program);
registerHooksCommand(program);
registerPrCommand(program);
registerLogCommand(program);
registerTemplateCommand(program);
registerMultiCommand(program);
registerReviewCommand(program);
registerScheduleCommand(program);

program.parse();
