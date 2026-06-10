const { sign } = require('hono/jwt');
const app = require('../../src-worker/index.js').default;
const { DocumentSyncObject } = require('../../src-worker/index.js');
const { MockD1 } = require('../mockD1.js');

const PASSWORD = 'Password123!';

function rateLimitBinding() {
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async () =>
        Response.json({
          allowed: true,
          limit: 1000,
          remaining: 999,
          retryAfter: 1,
        }),
    }),
  };
}

function baseEnv() {
  return {
    DB: new MockD1(),
    JWT_SECRET: 'test-secret-key-123',
    RATE_LIMIT_OBJECT: rateLimitBinding(),
    DOCUMENT_SYNC_OBJECT: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => new Response('DO upgraded', { status: 101 }),
      }),
    },
  };
}

async function signup(env, username, email) {
  const res = await app.request(
    '/api/auth/signup',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password: PASSWORD }),
    },
    env
  );
  const data = await res.json();
  return { res, data, user: env.DB.users.find((u) => u.username === username) };
}

async function createDocument(env, token, title = 'Document', content = 'Hello') {
  const res = await app.request(
    '/api/documents',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, pages: [{ content }] }),
    },
    env
  );
  return { res, data: await res.json() };
}

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.listeners = {};
    this.closed = null;
  }

  accept() {}

  send(message) {
    this.sent.push(message);
  }

  close(code, reason) {
    this.readyState = 3;
    this.closed = { code, reason };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

describe('SyncroEdit Cloudflare Worker API security', () => {
  let env;

  beforeEach(() => {
    env = baseEnv();
  });

  it('returns health, config, and security headers', async () => {
    const health = await app.request('/health', {}, env);
    expect(health.status).toBe(200);
    expect(health.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(health.headers.get('Content-Security-Policy')).toContain("default-src 'self'");

    const config = await app.request('/api/config', {}, env);
    expect(config.status).toBe(200);
    const data = await config.json();
    expect(data.realtimeBackend).toBe('durable-object');
    expect(data.authMode).toBe('bearer-access-token-refresh-cookie');
  });

  it('does not expose a mock CSRF endpoint', async () => {
    const res = await app.request('/api/auth/csrf-token', {}, env);
    expect(res.status).toBe(404);
  });

  it('returns a clean error when DB binding is missing', async () => {
    const res = await app.request(
      '/api/auth/check-username',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice' }),
      },
      { JWT_SECRET: env.JWT_SECRET, RATE_LIMIT_OBJECT: rateLimitBinding() }
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe('missing_db_binding');
    expect(JSON.stringify(data)).not.toContain('prepare');
  });

  it('returns a clean error when JWT secret is missing', async () => {
    const res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          email: 'alice@example.com',
          password: PASSWORD,
        }),
      },
      { DB: env.DB, RATE_LIMIT_OBJECT: rateLimitBinding() }
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe('missing_jwt_secret');
    expect(JSON.stringify(data)).not.toContain('stack');
  });

  it('validates signup input', async () => {
    const res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'al',
          email: 'not-email',
          password: 'weak',
        }),
      },
      env
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('invalid_username');
  });

  it('signs up, rejects vague login failures, and returns authenticated profile', async () => {
    const signupResult = await signup(env, 'alice', 'alice@example.com');
    expect(signupResult.res.status).toBe(201);
    expect(signupResult.data.token).toBeDefined();

    const failedLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'Wrong123!' }),
      },
      env
    );
    expect(failedLogin.status).toBe(401);
    expect(await failedLogin.json()).toEqual({
      message: 'Invalid username or password',
    });

    const unauthenticated = await app.request('/api/user/profile', {}, env);
    expect(unauthenticated.status).toBe(401);

    const profile = await app.request(
      '/api/user/profile',
      { headers: { Authorization: `Bearer ${signupResult.data.token}` } },
      env
    );
    expect(profile.status).toBe(200);
    expect((await profile.json()).username).toBe('alice');
  });

  it('prevents private document IDOR reads and enforces editor/viewer writes', async () => {
    const alice = await signup(env, 'alice', 'alice@example.com');
    const bob = await signup(env, 'bob', 'bob@example.com');
    const carol = await signup(env, 'carol', 'carol@example.com');
    const doc = await createDocument(env, alice.data.token, 'Private Doc');

    const deniedRead = await app.request(
      `/api/documents/${doc.data.id}/info`,
      { headers: { Authorization: `Bearer ${bob.data.token}` } },
      env
    );
    expect(deniedRead.status).toBe(403);

    env.DB.document_permissions.push({
      documentId: doc.data.id,
      userId: bob.user.id,
      role: 'viewer',
    });
    env.DB.document_permissions.push({
      documentId: doc.data.id,
      userId: carol.user.id,
      role: 'editor',
    });

    const viewerWrite = await app.request(
      `/api/documents/${doc.data.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bob.data.token}`,
        },
        body: JSON.stringify({ title: 'Viewer Edit' }),
      },
      env
    );
    expect(viewerWrite.status).toBe(403);

    const editorWrite = await app.request(
      `/api/documents/${doc.data.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${carol.data.token}`,
        },
        body: JSON.stringify({
          title: 'Editor Edit',
          pages: [{ content: 'Updated' }],
        }),
      },
      env
    );
    expect(editorWrite.status).toBe(200);
    expect(env.DB.documents.find((d) => d.id === doc.data.id).title).toBe('Editor Edit');

    const viewerDelete = await app.request(
      `/api/documents/${doc.data.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bob.data.token}` },
      },
      env
    );
    expect(viewerDelete.status).toBe(403);

    const ownerDelete = await app.request(
      `/api/documents/${doc.data.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${alice.data.token}` },
      },
      env
    );
    expect(ownerDelete.status).toBe(200);
    expect((await ownerDelete.json()).action).toBe('deleted');
  });

  it('rejects unauthorized realtime room access', async () => {
    const alice = await signup(env, 'alice', 'alice@example.com');
    const bob = await signup(env, 'bob', 'bob@example.com');
    const doc = await createDocument(env, alice.data.token, 'Realtime Private');
    const ticket = await sign(
      {
        sub: bob.user.id,
        username: 'bob',
        type: 'ws-ticket',
        exp: Math.floor(Date.now() / 1000) + 30,
      },
      env.JWT_SECRET
    );

    const object = new DocumentSyncObject({}, env);
    const res = await object.fetch(
      new Request(`https://example.com/ws/${doc.data.id}?ticket=${ticket}`)
    );
    expect(res.status).toBe(403);
  });

  it('rejects malformed realtime messages cleanly', async () => {
    const alice = await signup(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'Realtime Doc');
    const object = new DocumentSyncObject({}, env);
    const socket = new FakeSocket();

    await object.handleConnection(socket, doc.data.id, alice.user.id, 'alice', false);
    await socket.listeners.message({ data: 'not-binary' });

    expect(socket.closed).toEqual({
      code: 1003,
      reason: 'Unsupported message type',
    });
  });
});
