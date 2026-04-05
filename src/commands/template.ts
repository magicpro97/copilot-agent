import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

interface Template {
  name: string;
  prompt: string;
  priority?: number;
}

const CONFIG_DIR = join(homedir(), '.copilot-agent');
const TEMPLATES_FILE = join(CONFIG_DIR, 'templates.yaml');

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadTemplates(): Template[] {
  if (!existsSync(TEMPLATES_FILE)) return [];
  try {
    const data = parseYaml(readFileSync(TEMPLATES_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: Template[]): void {
  ensureDir();
  writeFileSync(TEMPLATES_FILE, stringifyYaml(templates), 'utf-8');
}

export function registerTemplateCommand(program: Command): void {
  const cmd = program
    .command('template')
    .description('Manage custom task templates');

  cmd
    .command('list')
    .description('Show all custom templates')
    .action(() => {
      const templates = loadTemplates();
      console.log(chalk.bold.cyan('\n  📋 Task Templates') + chalk.dim(` (${templates.length})\n`));

      if (templates.length === 0) {
        console.log(chalk.dim('  No custom templates'));
        console.log(chalk.dim('\n  Add one: copilot-agent template add <name> --prompt "..."'));
        console.log();
        return;
      }

      for (const t of templates) {
        const prio = t.priority !== undefined ? chalk.dim(` [priority: ${t.priority}]`) : '';
        console.log(`  ${chalk.green('●')} ${chalk.bold(t.name)}${prio}`);
        console.log(chalk.dim(`    ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '…' : ''}`));
      }
      console.log();
    });

  cmd
    .command('add <name>')
    .description('Add a custom template')
    .requiredOption('-p, --prompt <text>', 'Task prompt')
    .option('--priority <n>', 'Priority (lower = higher priority)')
    .action((name: string, opts) => {
      const templates = loadTemplates();
      const existing = templates.findIndex(t => t.name === name);
      const entry: Template = {
        name,
        prompt: opts.prompt,
        priority: opts.priority ? parseInt(opts.priority, 10) : undefined,
      };

      if (existing >= 0) {
        templates[existing] = entry;
        console.log(chalk.yellow(`  ✔ Updated template: ${chalk.bold(name)}`));
      } else {
        templates.push(entry);
        console.log(chalk.green(`  ✔ Added template: ${chalk.bold(name)}`));
      }
      saveTemplates(templates);
    });

  cmd
    .command('remove <name>')
    .description('Remove a custom template')
    .action((name: string) => {
      const templates = loadTemplates();
      const idx = templates.findIndex(t => t.name === name);
      if (idx < 0) {
        console.log(chalk.red(`  ✗ Template not found: ${name}`));
        return;
      }
      templates.splice(idx, 1);
      saveTemplates(templates);
      console.log(chalk.green(`  ✔ Removed template: ${chalk.bold(name)}`));
    });

  cmd
    .command('export')
    .description('Export templates to stdout (YAML)')
    .action(() => {
      const templates = loadTemplates();
      if (templates.length === 0) {
        console.log(chalk.dim('  No templates to export'));
        return;
      }
      console.log(stringifyYaml(templates));
    });

  cmd
    .command('import <file>')
    .description('Import templates from a YAML file')
    .action((file: string) => {
      try {
        const data = parseYaml(readFileSync(file, 'utf-8'));
        if (!Array.isArray(data)) {
          console.log(chalk.red('  ✗ Invalid format: expected YAML array'));
          return;
        }
        const current = loadTemplates();
        let added = 0;
        for (const entry of data) {
          if (!entry.name || !entry.prompt) continue;
          const idx = current.findIndex(t => t.name === entry.name);
          if (idx >= 0) {
            current[idx] = entry;
          } else {
            current.push(entry);
            added++;
          }
        }
        saveTemplates(current);
        console.log(chalk.green(`  ✔ Imported ${added} new templates (${data.length} total processed)`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  ✗ ${msg}`));
      }
    });
}
