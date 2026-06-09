import app from '../../../worker/src/index.js';
import { filterRequestHeaders, filterResponseHeaders } from '../../../worker/src/utils/proxy.js';

describe('Worker proxy', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters hop-by-hop request headers while preserving auth and cookies', () => {
    const headers = new Headers({
      Authorization: 'Bearer token',
      Connection: 'keep-alive',
      Cookie: 'refreshToken=value',
      Host: 'worker.example.com',
      'X-CSRF-Token': 'csrf',
    });

    const filtered = filterRequestHeaders(headers);

    expect(filtered.get('authorization')).toBe('Bearer token');
    expect(filtered.get('cookie')).toBe('refreshToken=value');
    expect(filtered.get('x-csrf-token')).toBe('csrf');
    expect(filtered.has('connection')).toBe(false);
    expect(filtered.has('host')).toBe(false);
  });

  it('filters hop-by-hop response headers while preserving Set-Cookie', () => {
    const headers = new Headers({
      Connection: 'close',
      'Set-Cookie': 'refreshToken=value; HttpOnly',
      'X-Test': 'ok',
    });

    const filtered = filterResponseHeaders(headers);

    expect(filtered.get('x-test')).toBe('ok');
    expect(filtered.get('set-cookie')).toBe('refreshToken=value; HttpOnly');
    expect(filtered.has('connection')).toBe(false);
  });

  it('proxies /api/node routes to the configured Node backend', async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ csrfToken: 'token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await app.request(
      '/api/node/auth/csrf-token?x=1',
      {},
      {
        BACKEND_ORIGIN: 'https://node.example.com',
        ENVIRONMENT: 'production',
      }
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://node.example.com/api/auth/csrf-token?x=1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('does not proxy production-like requests without backend origin', async () => {
    const response = await app.request('/api/node/user/profile', {}, { ENVIRONMENT: 'production' });

    expect(response.status).toBe(500);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps realtime Durable Object route disabled by default', async () => {
    const response = await app.request('/ws/test-document', {}, { ENVIRONMENT: 'development' });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Durable Object realtime route disabled');
  });
});
