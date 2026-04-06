import type { Command } from 'commander';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { listAllSessions, getAgentSessionReport } from '../lib/session.js';
import { findAgentProcesses } from '../lib/process.js';
import { ok, info, fail } from '../lib/logger.js';
import { layoutHead, layoutFoot } from '../web/layout.js';
import { renderStats, renderProcesses, renderSessionList, renderDetail, renderDiffView, generateUnifiedDiff } from '../web/views.js';

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
  const sessions = listAllSessions(20);
  const reports = sessions.map(s => getAgentSessionReport(s.id, s.agent)).filter(r => r !== null);
  const processes = findAgentProcesses();
  return { sessions: reports, processes };
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function startWebServer(port: number, autoOpen: boolean): void {
  const app = new Hono();

  // ─── JSON API ────────────────────────────────────────
  app.get('/api/sessions', (c) => c.json(getData()));

  app.get('/api/session/:id', (c) => {
    const report = getAgentSessionReport(c.req.param('id'));
    if (!report) return c.json({ error: 'Not found' }, 404);
    return c.json(report);
  });

  app.get('/partial/diff/:id', (c) => {
    const report = getAgentSessionReport(c.req.param('id'));
    if (!report) return c.html('<div class="empty-detail">Session not found</div>');
    const style = (c.req.query('style') === 'side' ? 'side' : 'line') as 'side' | 'line';
    return c.html(renderDiffView(report, style));
  });

  app.get('/api/diff/:id', (c) => {
    const report = getAgentSessionReport(c.req.param('id'));
    if (!report) return c.json({ error: 'Not found' }, 404);
    return c.json({ diff: generateUnifiedDiff(report) });
  });

  // ─── SSE for live updates (only push when data changes) ──
  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      let prevStatsHash = '';
      let prevProcsHash = '';

      while (true) {
        const { sessions, processes } = getData();

        const statsHtml = renderStats(sessions);
        const procsHtml = renderProcesses(processes);
        const statsHash = simpleHash(statsHtml);
        const procsHash = simpleHash(procsHtml);

        if (statsHash !== prevStatsHash) {
          await stream.writeSSE({ event: 'stats', data: statsHtml });
          prevStatsHash = statsHash;
        }
        if (procsHash !== prevProcsHash) {
          await stream.writeSSE({ event: 'procs', data: procsHtml });
          await stream.writeSSE({ event: 'proc-count', data: String(processes.length) });
          prevProcsHash = procsHash;
        }

        await stream.sleep(5000);
      }
    });
  });

  // ─── htmx Partials ──────────────────────────────────
  app.get('/partial/detail/:id', (c) => {
    const report = getAgentSessionReport(c.req.param('id'));
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
      hx-swap="innerHTML settle:0s swap:0s">
      ${renderStats(sessions)}
    </div>

    <div class="procs">
      <div class="procs-header">
        ⬤ Active Processes <span class="count" sse-swap="proc-count" hx-swap="innerHTML settle:0s swap:0s">${processes.length}</span>
      </div>
      <div class="procs-body"
        sse-swap="procs"
        hx-swap="innerHTML settle:0s swap:0s">
        ${renderProcesses(processes)}
      </div>
    </div>

    <div class="main" id="main-grid">
      <div class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <span>📋 Sessions <span class="count">${sessions.length}</span></span>
          <button class="sidebar-toggle" id="sidebar-toggle" title="Collapse sidebar">◀</button>
        </div>
        ${renderSessionList(sessions, firstId)}
      </div>
      <button class="sidebar-expand" id="sidebar-expand" title="Expand sidebar" style="display:none">▶</button>
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

    (function() {
      var collapseBtn = document.getElementById('sidebar-toggle');
      var expandBtn = document.getElementById('sidebar-expand');
      var grid = document.getElementById('main-grid');
      var sb = document.getElementById('sidebar');

      function collapse() {
        grid.classList.add('sidebar-collapsed');
        sb.classList.add('collapsed');
        collapseBtn.style.display = 'none';
        expandBtn.style.display = '';
      }
      function expand() {
        grid.classList.remove('sidebar-collapsed');
        sb.classList.remove('collapsed');
        collapseBtn.style.display = '';
        expandBtn.style.display = 'none';
      }

      collapseBtn.addEventListener('click', collapse);
      expandBtn.addEventListener('click', expand);
    })();
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
        const plat = process.platform;
        const cmd = plat === 'win32' ? 'cmd' : plat === 'darwin' ? 'open' : 'xdg-open';
        const args = plat === 'win32' ? ['/c', 'start', url] : [url];
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      }
    });
  } catch (err) {
    fail(`Server error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
