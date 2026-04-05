import type { Command } from 'commander';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { listSessions, getSessionReport } from '../lib/session.js';
import { findCopilotProcesses } from '../lib/process.js';
import { ok, info, fail } from '../lib/logger.js';
import { layoutHead, layoutFoot } from '../web/layout.js';
import { renderStats, renderProcesses, renderSessionList, renderDetail } from '../web/views.js';

export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('Launch web dashboard in browser')
    .option('-p, --port <n>', 'Port number', '3847')
    .option('--no-open', 'Do not auto-open browser')
    .action((opts) => {
      startWebServer(parseInt(opts.port, 10), opts.open !== false);
    });
}

function getData() {
  const sessions = listSessions(20);
  const reports = sessions.map(s => getSessionReport(s.id)).filter(r => r !== null);
  const processes = findCopilotProcesses();
  return { sessions: reports, processes };
}

function startWebServer(port: number, autoOpen: boolean): void {
  const app = new Hono();

  // ─── JSON API ────────────────────────────────────────
  app.get('/api/sessions', (c) => c.json(getData()));

  app.get('/api/session/:id', (c) => {
    const report = getSessionReport(c.req.param('id'));
    if (!report) return c.json({ error: 'Not found' }, 404);
    return c.json(report);
  });

  // ─── SSE for live updates ────────────────────────────
  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      while (true) {
        const { sessions, processes } = getData();
        // Push partial HTML fragments for htmx to swap
        await stream.writeSSE({
          event: 'stats',
          data: renderStats(sessions),
        });
        await stream.writeSSE({
          event: 'procs',
          data: renderProcesses(processes),
        });
        await stream.writeSSE({
          event: 'proc-count',
          data: String(processes.length),
        });
        await stream.sleep(5000);
      }
    });
  });

  // ─── htmx Partials ──────────────────────────────────
  app.get('/partial/detail/:id', (c) => {
    const report = getSessionReport(c.req.param('id'));
    if (!report) return c.html('<div class="empty-detail">Session not found</div>');
    return c.html(renderDetail(report));
  });

  // ─── Main page ──────────────────────────────────────
  app.get('/', (c) => {
    const { sessions, processes } = getData();
    const firstId = sessions[0]?.id;

    return c.html(`${layoutHead}
<body>
  <div class="header">
    <div class="header-left">
      <h1>🤖 <span>Copilot Agent</span></h1>
      <div class="live-badge"><div class="live-dot"></div> Live</div>
    </div>
    <div class="clock" id="clock"></div>
  </div>

  <div class="container"
    hx-ext="sse"
    sse-connect="/events">

    <div class="stats"
      sse-swap="stats"
      hx-swap="innerHTML">
      ${renderStats(sessions)}
    </div>

    <div class="procs">
      <div class="procs-header">
        ⬤ Active Processes <span class="count" sse-swap="proc-count" hx-swap="innerHTML">${processes.length}</span>
      </div>
      <div class="procs-body"
        sse-swap="procs"
        hx-swap="innerHTML">
        ${renderProcesses(processes)}
      </div>
    </div>

    <div class="main">
      <div class="sidebar">
        <div class="sidebar-header">
          📋 Sessions <span class="count">${sessions.length}</span>
        </div>
        ${renderSessionList(sessions, firstId)}
      </div>
      <div class="detail" id="detail">
        ${firstId ? renderDetail(sessions[0]) : '<div class="empty-detail">No sessions</div>'}
      </div>
    </div>
  </div>

  <script>
    setInterval(() => {
      document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB');
    }, 1000);
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB');
  </script>
</body>
${layoutFoot}`);
  });

  // ─── Start server ───────────────────────────────────
  try {
    serve({ fetch: app.fetch, port }, () => {
      const url = `http://localhost:${port}`;
      ok(`Web dashboard → ${url}`);
      info('Press Ctrl+C to stop');
      if (autoOpen) {
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      }
    });
  } catch (err) {
    fail(`Server error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
