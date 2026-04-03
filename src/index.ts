import { Command } from 'commander';
import { registerStatusCommand } from './commands/status.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerRunCommand } from './commands/run.js';
import { registerOvernightCommand } from './commands/overnight.js';
import { registerResearchCommand } from './commands/research.js';

const program = new Command();

program
  .name('copilot-agent')
  .version('0.5.0')
  .description('Autonomous GitHub Copilot CLI agent — auto-resume, task discovery, overnight runs');

registerStatusCommand(program);
registerWatchCommand(program);
registerRunCommand(program);
registerOvernightCommand(program);
registerResearchCommand(program);

program.parse();
