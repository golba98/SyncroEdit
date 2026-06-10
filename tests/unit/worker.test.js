const app = require('../../src-worker/index.js').default;
const { MockD1 } = require('../mockD1.js');

describe('SyncroEdit Cloudflare Worker API', () => {
  let env;

  beforeEach(() => {
    env = {
      DB: new MockD1(),
      JWT_SECRET: 'test-secret-key-123',
      DOCUMENT_SYNC_OBJECT: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => new Response('DO upgraded', { status: 101 }),
        }),
      },
    };
  });

  it('should return health status', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
  });

  it('should return public config', async () => {
    const res = await app.request('/api/config', {}, env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.realtimeBackend).toBe('durable-object');
  });

  it('should return mock CSRF token', async () => {
    const res = await app.request('/api/auth/csrf-token', {}, env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.csrfToken).toBeDefined();
  });

  it('should check username availability', async () => {
    // Available
    let res = await app.request(
      '/api/auth/check-username',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob' }),
      },
      env
    );
    expect(res.status).toBe(200);
    let data = await res.json();
    expect(data.available).toBe(true);

    // Seed Bob
    await env.DB.prepare(
      'INSERT INTO users (id, username, email, password, isEmailVerified) VALUES (?, ?, ?, ?, 1)'
    )
      .bind('user-1', 'bob', 'bob@example.com', 'hashed')
      .run();

    // Now unavailable
    res = await app.request(
      '/api/auth/check-username',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob' }),
      },
      env
    );
    expect(res.status).toBe(200);
    data = await res.json();
    expect(data.available).toBe(false);
    expect(data.suggestions).toBeDefined();
  });

  it('should sign up and login a user', async () => {
    // 1. Signup
    let res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password123!',
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    let data = await res.json();
    expect(data.username).toBe('alice');
    expect(data.token).toBeDefined();

    const token = data.token;

    // 2. Login
    res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          password: 'Password123!',
        }),
      },
      env
    );
    expect(res.status).toBe(200);
    data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.username).toBe('alice');

    // 3. Profile (requires auth)
    res = await app.request(
      '/api/user/profile',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      env
    );
    expect(res.status).toBe(200);
    data = await res.json();
    expect(data.username).toBe('alice');
  });

  it('should perform document CRUD operations', async () => {
    // Signup Alice
    let res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          email: 'alice@example.com',
          password: 'Password123!',
        }),
      },
      env
    );
    const aliceData = await res.json();
    const token = aliceData.token;

    // 1. Create document
    res = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'Alice Doc',
          pages: [{ content: 'Hello World' }],
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const docData = await res.json();
    expect(docData.title).toBe('Alice Doc');
    const docId = docData.id;

    // 2. List documents
    res = await app.request(
      '/api/documents',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const listData = await res.json();
    expect(listData.documents.length).toBe(1);
    expect(listData.documents[0].title).toBe('Alice Doc');

    // 3. Settings settings
    res = await app.request(
      `/api/documents/${docId}/settings`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const settings = await res.json();
    expect(settings.isPublic).toBe(false);

    // 4. Update settings (make public)
    res = await app.request(
      `/api/documents/${docId}/settings`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPublic: true }),
      },
      env
    );
    expect(res.status).toBe(200);
    const updatedSettings = await res.json();
    expect(updatedSettings.isPublic).toBe(true);

    // 5. Delete document
    res = await app.request(
      `/api/documents/${docId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      env
    );
    expect(res.status).toBe(200);
    const delRes = await res.json();
    expect(delRes.action).toBe('deleted');
  });
});
