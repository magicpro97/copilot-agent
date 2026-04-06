import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { execSync } from 'child_process';

// ── Types ────────────────────────────────────────────────────────

export interface NotifyConfig {
  enabled?: boolean;
  providers?: NotifyProvider[];
  events?: NotifyEventConfig;
}

export interface NotifyProvider {
  type: 'os' | 'telegram' | 'discord' | 'slack';
  name?: string;
  enabled?: boolean;
  // Telegram
  botToken?: string;
  chatId?: string;
  // Discord / Slack
  webhookUrl?: string;
}

export interface NotifyEventConfig {
  on_session_end?: boolean;
  on_task_complete?: boolean;
  on_error?: boolean;
  on_overnight_done?: boolean;
}

export interface NotifyMessage {
  title: string;
  body: string;
  event: string;
  urgency?: 'low' | 'normal' | 'critical';
}

export interface NotifyResult {
  provider: string;
  success: boolean;
  error?: string;
}

// ── Config ───────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.copilot-agent');
const NOTIFY_CONFIG = join(CONFIG_DIR, 'notify.yaml');

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadNotifyConfig(): NotifyConfig {
  if (!existsSync(NOTIFY_CONFIG)) return { enabled: false, providers: [], events: {} };
  try {
    return parseYaml(readFileSync(NOTIFY_CONFIG, 'utf-8')) || {};
  } catch {
    return { enabled: false };
  }
}

export function saveNotifyConfig(config: NotifyConfig): void {
  ensureDir();
  writeFileSync(NOTIFY_CONFIG, stringifyYaml(config), 'utf-8');
}

// ── OS Notification ──────────────────────────────────────────────

function sendOsNotification(msg: NotifyMessage): boolean {
  try {
    const os = platform();
    const title = msg.title.replace(/"/g, '\\"').replace(/'/g, "\\'");
    const body = msg.body.replace(/"/g, '\\"').replace(/'/g, "\\'");

    if (os === 'darwin') {
      execSync(`osascript -e 'display notification "${body}" with title "${title}"'`, { stdio: 'pipe', timeout: 5000 });
    } else if (os === 'win32') {
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; ` +
        `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
        `$n.Icon = [System.Drawing.SystemIcons]::Information; ` +
        `$n.Visible = $true; ` +
        `$n.ShowBalloonTip(5000, '${title}', '${body}', 'Info'); ` +
        `Start-Sleep -Seconds 1; $n.Dispose()`;
      execSync(`powershell -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 10000 });
    } else {
      // Linux — try notify-send
      execSync(`notify-send "${title}" "${body}"`, { stdio: 'pipe', timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

// ── Telegram ─────────────────────────────────────────────────────

async function sendTelegram(provider: NotifyProvider, msg: NotifyMessage): Promise<boolean> {
  if (!provider.botToken || !provider.chatId) return false;
  const text = `*${escapeMarkdown(msg.title)}*\n${escapeMarkdown(msg.body)}`;
  const url = `https://api.telegram.org/bot${provider.botToken}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: provider.chatId, text, parse_mode: 'MarkdownV2' }),
  });
  return res.ok;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ── Discord ──────────────────────────────────────────────────────

async function sendDiscord(provider: NotifyProvider, msg: NotifyMessage): Promise<boolean> {
  if (!provider.webhookUrl) return false;

  const color = msg.urgency === 'critical' ? 0xff4444 : msg.urgency === 'low' ? 0x888888 : 0x58a6ff;
  const res = await fetch(provider.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: msg.title,
        description: msg.body,
        color,
        footer: { text: `copilot-agent • ${msg.event}` },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
  return res.ok || res.status === 204;
}

// ── Slack ────────────────────────────────────────────────────────

async function sendSlack(provider: NotifyProvider, msg: NotifyMessage): Promise<boolean> {
  if (!provider.webhookUrl) return false;

  const emoji = msg.urgency === 'critical' ? '🚨' : msg.urgency === 'low' ? 'ℹ️' : '✅';
  const res = await fetch(provider.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `${emoji} ${msg.title}` } },
        { type: 'section', text: { type: 'mrkdwn', text: msg.body } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `copilot-agent • ${msg.event}` }] },
      ],
    }),
  });
  return res.ok;
}

// ── Main Dispatcher ──────────────────────────────────────────────

export async function sendNotification(msg: NotifyMessage): Promise<NotifyResult[]> {
  const config = loadNotifyConfig();
  if (!config.enabled) return [];

  // Check if this event type is enabled
  if (config.events) {
    const eventKey = msg.event.replace(/-/g, '_') as keyof NotifyEventConfig;
    if (config.events[eventKey] === false) return [];
  }

  const providers = config.providers || [];
  const results: NotifyResult[] = [];

  for (const provider of providers) {
    if (provider.enabled === false) continue;

    const name = provider.name || provider.type;
    try {
      let success = false;

      switch (provider.type) {
        case 'os':
          success = sendOsNotification(msg);
          break;
        case 'telegram':
          success = await sendTelegram(provider, msg);
          break;
        case 'discord':
          success = await sendDiscord(provider, msg);
          break;
        case 'slack':
          success = await sendSlack(provider, msg);
          break;
      }

      results.push({ provider: name, success });
    } catch (err: unknown) {
      results.push({ provider: name, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// ── Convenience helpers for common events ────────────────────────

export async function notifySessionEnd(sessionId: string, summary: string): Promise<void> {
  await sendNotification({
    title: '✅ Session Complete',
    body: `Session ${sessionId.slice(0, 12)}… finished.\n${summary.slice(0, 200)}`,
    event: 'on_session_end',
    urgency: 'normal',
  });
}

export async function notifyError(sessionId: string, error: string): Promise<void> {
  await sendNotification({
    title: '🚨 Agent Error',
    body: `Session ${sessionId.slice(0, 12)}…\n${error.slice(0, 200)}`,
    event: 'on_error',
    urgency: 'critical',
  });
}

export async function notifyOvernightDone(tasksCompleted: number, duration: string): Promise<void> {
  await sendNotification({
    title: '🌙 Overnight Run Complete',
    body: `Completed ${tasksCompleted} tasks in ${duration}`,
    event: 'on_overnight_done',
    urgency: 'normal',
  });
}

export async function notifyTaskComplete(task: string): Promise<void> {
  await sendNotification({
    title: '🎯 Task Complete',
    body: task.slice(0, 200),
    event: 'on_task_complete',
    urgency: 'low',
  });
}
