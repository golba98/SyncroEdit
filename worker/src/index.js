import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { securityHeaders } from './middleware/securityHeaders.js';
import { handleHealth } from './routes/health.js';
import { handleConfig } from './routes/config.js';
import { handleProxy } from './routes/proxy.js';
import { successResponse, notFoundResponse } from './utils/responses.js';

const app = new Hono();

app.use('*', securityHeaders);
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

app.get('/', (c) => {
  return successResponse(c, {
    message: 'SyncroEdit Cloudflare Worker is running',
    health: '/api/health',
  });
});

app.get('/api/health', handleHealth);
app.get('/api/config', handleConfig);
app.all('/api/node/*', handleProxy);

app.notFound((c) => {
  return notFoundResponse(c, 'Not Found');
});

export default app;
