import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { listSessions, getSessionReport } from '../lib/session.js';
import { findCopilotProcesses } from '../lib/process.js';

export function createApi() {
  const api = new Hono();

  api.get('/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const sessions = listSessions(limit);
    const reports = sessions.map(s => getSessionReport(s.id)).filter(Boolean);
    return c.json({ sessions: reports, processes: findCopilotProcesses() });
  });

  api.get('/session/:id', (c) => {
    const report = getSessionReport(c.req.param('id'));
    if (!report) return c.json({ error: 'Not found' }, 404);
    return c.json(report);
  });

  api.get('/processes', (c) => {
    return c.json(findCopilotProcesses());
  });

  api.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      while (true) {
        const sessions = listSessions(20);
        const reports = sessions.map(s => getSessionReport(s.id)).filter(Boolean);
        const data = { sessions: reports, processes: findCopilotProcesses() };

        await stream.writeSSE({ data: JSON.stringify(data), event: 'update' });
        await stream.sleep(5000);
      }
    });
  });

  return api;
}
