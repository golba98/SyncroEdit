import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { securityHeaders } from './middleware/securityHeaders.js';
import { handleHealth } from './routes/health.js';
import { handleConfig } from './routes/config.js';
import { handleProxy } from './routes/proxy.js';
import { handleRealtime } from './routes/realtime.js';
import { DocumentSyncObject } from './durableObjects/DocumentSyncObject.js';
import { edgeRateLimit } from './middleware/rateLimit.js';
import { successResponse, notFoundResponse } from './utils/responses.js';

export { DocumentSyncObject };

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
app.use('/api/node/*', edgeRateLimit);
app.all('/api/node/*', handleProxy);
app.get('/ws/:documentId', handleRealtime);
app.get('/api/realtime/:documentId', handleRealtime);

app.notFound((c) => {
  return notFoundResponse(c, 'Not Found');
});

export default app;
