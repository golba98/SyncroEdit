const app = require('../../src-worker/index.js').default;
const { MockD1 } = require('../mockD1.js');

function env() {
  return {
    DB: new MockD1(),
    JWT_SECRET: 'test-secret-key-123',
    RATE_LIMIT_OBJECT: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => Response.json({ allowed: true, limit: 100, remaining: 99 }),
      }),
    },
    DOCUMENT_SYNC_OBJECT: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => new Response('ok'),
      }),
    },
  };
}

describe('Worker integration security behavior', () => {
  it('uses tight CORS and never combines wildcard origin with credentials', async () => {
    const res = await app.request(
      '/api/config',
      { headers: { Origin: 'https://evil.example' } },
      env()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('rejects injection-style usernames before SQL execution', async () => {
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: "alice' OR 1=1 --",
          password: 'Password123!',
        }),
      },
      env()
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('invalid_username');
  });

  it('returns clean JSON for malformed request bodies', async () => {
    const res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
      },
      env()
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid JSON request body');
    expect(text).not.toContain('SyntaxError');
    expect(text).not.toContain('stack');
  });
});
