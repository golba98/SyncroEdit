import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.get('/', (c) => {
  return c.json({
    ok: true,
    message: 'SyncroEdit Cloudflare Worker is running',
    health: '/api/health'
  });
});

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    service: 'syncroedit-worker',
    runtime: 'cloudflare-workers'
  });
});

export default app;
