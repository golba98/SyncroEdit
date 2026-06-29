const { sign } = require('hono/jwt');
const app = require('../../src-worker/index.js').default;
const { SynchroDocumentObject } = require('../../src-worker/index.js');
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
    EMAIL_CODE_PEPPER: 'test-email-code-pepper-123',
    RESEND_API_KEY: 'test-resend-api-key',
    EMAIL_FROM: 'SyncroEdit <verify@example.com>',
    APP_NAME: 'SyncroEdit',
    RATE_LIMIT_OBJECT: rateLimitBinding(),
    DOCUMENT_SYNC_OBJECT: {
      idFromName: (name) => name,
      get: () => ({
        // Node.js Response rejects status 101 (only valid in CF runtime).
        // Return 200 in tests to prove the route reached the DO stub.
        fetch: async () => new Response('DO forwarded', { status: 200 }),
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

async function signupVerified(env, username, email) {
  const result = await signup(env, username, email);
  result.user.email_verified_at = Math.floor(Date.now() / 1000);
  result.user.isEmailVerified = 1;

  const login = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    },
    env
  );
  const data = await login.json();
  return { ...result, login, data };
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
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ id: 'email-id' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    const setup = await signup(env, 'alice', 'alice@example.com');
    setup.user.email_verified_at = Math.floor(Date.now() / 1000);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          password: PASSWORD,
        }),
      },
      {
        DB: env.DB,
        RATE_LIMIT_OBJECT: rateLimitBinding(),
        EMAIL_CODE_PEPPER: env.EMAIL_CODE_PEPPER,
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
        APP_NAME: env.APP_NAME,
      }
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe('missing_jwt_secret');
    expect(JSON.stringify(data)).not.toContain('stack');
  });

  it('logs the failing signup step when a database query throws', async () => {
    const failingDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                throw new Error(`db exploded for ${sql} with ${args.length} params`);
              },
            };
          },
        };
      },
    };
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-ray': 'test-ray-id' },
        body: JSON.stringify({
          username: 'alice',
          email: 'alice@example.com',
          password: PASSWORD,
        }),
      },
      {
        DB: failingDb,
        JWT_SECRET: env.JWT_SECRET,
        RATE_LIMIT_OBJECT: rateLimitBinding(),
      }
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe('signup_failed');
    expect(JSON.stringify(data)).not.toContain('stack');

    expect(logSpy).toHaveBeenCalledWith(
      'Signup route failed:',
      expect.objectContaining({
        route: '/api/auth/signup',
        requestId: 'test-ray-id',
        step: 'check_existing_user',
        errorName: 'Error',
        message: expect.stringContaining('db exploded'),
        stack: expect.stringContaining('db exploded'),
      })
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(PASSWORD);

    logSpy.mockRestore();
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

  it('signs up unverified, rejects vague login failures, and returns verified authenticated profile', async () => {
    const signupResult = await signup(env, 'alice', 'alice@example.com');
    expect(signupResult.res.status).toBe(201);
    expect(signupResult.data.token).toBeUndefined();
    expect(signupResult.data.emailVerified).toBe(false);
    expect(signupResult.data.isEmailVerified).toBe(false);
    expect(signupResult.data.verificationRequired).toBe(true);
    expect(signupResult.user.email_verified_at).toBeNull();
    expect(signupResult.user.isEmailVerified).toBe(0);

    const unverifiedLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: PASSWORD }),
      },
      env
    );
    expect(unverifiedLogin.status).toBe(403);
    await expect(unverifiedLogin.json()).resolves.toEqual({
      code: 'email_verification_required',
      email: 'alice@example.com',
      email_verified_at: null,
      emailVerified: false,
      isEmailVerified: false,
      message: 'Email verification required',
      verificationRequired: true,
    });

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

    signupResult.user.email_verified_at = Math.floor(Date.now() / 1000);
    signupResult.user.isEmailVerified = 1;
    const verifiedLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: PASSWORD }),
      },
      env
    );
    const verifiedLoginData = await verifiedLogin.json();
    expect(verifiedLogin.status).toBe(200);
    expect(verifiedLoginData.token).toBeDefined();
    expect(verifiedLoginData.emailVerified).toBe(true);
    expect(verifiedLoginData.isEmailVerified).toBe(true);

    const profile = await app.request(
      '/api/user/profile',
      { headers: { Authorization: `Bearer ${verifiedLoginData.token}` } },
      env
    );
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toEqual(
      expect.objectContaining({
        username: 'alice',
        emailVerified: true,
        isEmailVerified: true,
      })
    );
  });

  it('serializes profile verification from email_verified_at, not the legacy mirror', async () => {
    const verified = await signupVerified(env, 'profileuser', 'profile@example.com');
    verified.user.isEmailVerified = 0;

    const profile = await app.request(
      '/api/user/profile',
      { headers: { Authorization: `Bearer ${verified.data.token}` } },
      env
    );
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toEqual(
      expect.objectContaining({
        email_verified_at: verified.user.email_verified_at,
        emailVerified: true,
        isEmailVerified: true,
      })
    );
    expect(verified.user.isEmailVerified).toBe(1);
  });

  it('stores hashed verification codes, rejects wrong codes, and verifies email without exposing raw codes', async () => {
    const signupResult = await signup(env, 'verifyuser', 'verify@example.com');
    expect(signupResult.res.status).toBe(201);
    expect(env.DB.email_verification_codes).toHaveLength(1);
    const row = env.DB.email_verification_codes[0];
    expect(row.email).toBe('verify@example.com');
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toBe('123456');
    expect(signupResult.user.email_verified_at).toBeNull();

    const wrongRes = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'verify@example.com', code: '000000', purpose: 'signup' }),
      },
      env
    );

    expect(wrongRes.status).toBe(400);
    await expect(wrongRes.json()).resolves.toEqual({
      code: 'invalid_code',
      message: 'Invalid or expired verification code',
    });
    expect(signupResult.user.email_verified_at).toBeNull();
    expect(row.attempts).toBe(1);

    const emailBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const code = emailBody.html.match(/letter-spacing:6px[^>]*>(\d{6})/)[1];
    const res = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'verify@example.com', code, purpose: 'signup' }),
      },
      env
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      email_verified_at: expect.any(Number),
      emailVerified: true,
      isEmailVerified: true,
      message: 'Email verified.',
    });
    expect(row.consumed_at).toBeTruthy();
    expect(signupResult.user.email_verified_at).toBeTruthy();
    expect(signupResult.user.isEmailVerified).toBe(1);
  });

  it('persists verified state across login and refresh after correct verification', async () => {
    const signupResult = await signup(env, 'persistuser', 'persist@example.com');
    const emailBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const code = emailBody.html.match(/letter-spacing:6px[^>]*>(\d{6})/)[1];
    const verifyRes = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'persist@example.com', code, purpose: 'signup' }),
      },
      env
    );
    expect(verifyRes.status).toBe(200);
    expect(signupResult.user.email_verified_at).toBeTruthy();

    const loginRes = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'persistuser', password: PASSWORD }),
      },
      env
    );
    const loginData = await loginRes.json();
    expect(loginRes.status).toBe(200);
    expect(loginData.email_verified_at).toEqual(signupResult.user.email_verified_at);
    expect(loginData.emailVerified).toBe(true);
    expect(loginData.isEmailVerified).toBe(true);

    const cookie = loginRes.headers.get('set-cookie');
    expect(cookie).toContain('refreshToken=');

    const refreshRes = await app.request(
      '/api/auth/refresh-token',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
        },
      },
      env
    );
    expect(refreshRes.status).toBe(200);
    await expect(refreshRes.json()).resolves.toEqual(
      expect.objectContaining({
        token: expect.any(String),
        email_verified_at: signupResult.user.email_verified_at,
        emailVerified: true,
        isEmailVerified: true,
      })
    );
  });

  it('treats email_verified_at as verified and repairs a stale legacy mirror', async () => {
    const signupResult = await signup(env, 'mixeduser', 'mixed@example.com');
    signupResult.user.email_verified_at = Math.floor(Date.now() / 1000);
    signupResult.user.isEmailVerified = 0;

    const loginRes = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'mixeduser', password: PASSWORD }),
      },
      env
    );
    const loginData = await loginRes.json();
    expect(loginRes.status).toBe(200);
    expect(loginData).toEqual(
      expect.objectContaining({
        email: 'mixed@example.com',
        email_verified_at: signupResult.user.email_verified_at,
        emailVerified: true,
        isEmailVerified: true,
      })
    );
    expect(signupResult.user.isEmailVerified).toBe(1);

    signupResult.user.isEmailVerified = 0;
    const profileRes = await app.request(
      '/api/user/profile',
      { headers: { Authorization: `Bearer ${loginData.token}` } },
      env
    );
    const profileData = await profileRes.json();
    expect(profileRes.status).toBe(200);
    expect(profileData).toEqual(
      expect.objectContaining({
        email_verified_at: signupResult.user.email_verified_at,
        emailVerified: true,
        isEmailVerified: true,
      })
    );
    expect(signupResult.user.isEmailVerified).toBe(1);

    signupResult.user.isEmailVerified = 0;
    const cookie = loginRes.headers.get('set-cookie');
    const refreshRes = await app.request(
      '/api/auth/refresh-token',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
        },
      },
      env
    );
    const refreshData = await refreshRes.json();
    expect(refreshRes.status).toBe(200);
    expect(refreshData).toEqual(
      expect.objectContaining({
        email_verified_at: signupResult.user.email_verified_at,
        emailVerified: true,
        isEmailVerified: true,
      })
    );
    expect(signupResult.user.isEmailVerified).toBe(1);
  });

  it('does not treat the legacy isEmailVerified flag alone as verified', async () => {
    const signupResult = await signup(env, 'legacyuser', 'legacy@example.com');
    signupResult.user.isEmailVerified = 1;
    signupResult.user.email_verified_at = null;

    const loginRes = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'legacyuser', password: PASSWORD }),
      },
      env
    );
    expect(loginRes.status).toBe(403);
    await expect(loginRes.json()).resolves.toEqual({
      code: 'email_verification_required',
      email: 'legacy@example.com',
      email_verified_at: null,
      emailVerified: false,
      isEmailVerified: false,
      message: 'Email verification required',
      verificationRequired: true,
    });

    const forgedToken = await sign(
      {
        id: signupResult.user.id,
        username: 'legacyuser',
        sessionId: 'legacy-session',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      env.JWT_SECRET
    );
    env.DB.sessions.push({
      id: 'legacy-session',
      userId: signupResult.user.id,
      refreshToken: 'legacy-refresh',
      userAgent: 'jest',
      ipAddress: '127.0.0.1',
      lastActive: new Date().toISOString(),
    });

    const profileRes = await app.request(
      '/api/user/profile',
      {
        headers: {
          Authorization: `Bearer ${forgedToken}`,
        },
      },
      env
    );
    expect(profileRes.status).toBe(403);
    await expect(profileRes.json()).resolves.toEqual({
      code: 'email_verification_required',
      message: 'Email verification required',
    });
    expect(signupResult.user.isEmailVerified).toBe(0);
  });

  it('treats falsy canonical email_verified_at values as unverified', async () => {
    const signupResult = await signup(env, 'falsyuser', 'falsy@example.com');
    signupResult.user.isEmailVerified = 1;
    signupResult.user.email_verified_at = 0;

    const loginRes = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'falsyuser', password: PASSWORD }),
      },
      env
    );

    expect(loginRes.status).toBe(403);
    await expect(loginRes.json()).resolves.toEqual({
      code: 'email_verification_required',
      email: 'falsy@example.com',
      email_verified_at: 0,
      emailVerified: false,
      isEmailVerified: false,
      message: 'Email verification required',
      verificationRequired: true,
    });
    expect(signupResult.user.isEmailVerified).toBe(0);
  });

  it('signs up successfully even if email configuration is missing, returning EMAIL_NOT_CONFIGURED status', async () => {
    const badEnv = {
      ...env,
      EMAIL_CODE_PEPPER: '', // invalid / missing
    };
    const signupResult = await signup(badEnv, 'noconfiguser', 'noconfig@example.com');
    expect(signupResult.res.status).toBe(201);
    expect(signupResult.data.ok).toBe(true);
    expect(signupResult.data.verificationRequired).toBe(true);
    expect(signupResult.data.codeSent).toBe(false);
    expect(signupResult.data.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(signupResult.user.email_verified_at).toBeNull();
  });

  it('returns EMAIL_NOT_CONFIGURED from send-verification if email configuration is missing', async () => {
    const badEnv = {
      ...env,
      EMAIL_CODE_PEPPER: '', // invalid / missing
    };
    const res = await app.request(
      '/api/auth/send-verification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'noconfig@example.com', purpose: 'signup' }),
      },
      badEnv
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(data.error).toBe('Email verification is not configured for this environment.');
  });

  it('ignores extra request keys during verify-email, but fails if code is missing/legacy', async () => {
    const signupResult = await signup(env, 'extrakeysuser', 'extrakeys@example.com');
    const emailBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const code = emailBody.html.match(/letter-spacing:6px[^>]*>(\d{6})/)[1];

    // Verify with extra keys (should succeed)
    const extraKeysRes = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'extrakeys@example.com',
          code,
          purpose: 'signup',
          extra_param_to_ignore: 'value',
        }),
      },
      env
    );
    expect(extraKeysRes.status).toBe(200);
    expect(signupResult.user.email_verified_at).toBeTruthy();

    // Reset user verification state for checking legacy failure
    signupResult.user.email_verified_at = null;
    env.DB.email_verification_codes = [];
    await signup(env, 'extrakeysuser', 'extrakeys@example.com');
    const newEmailBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const newCode = newEmailBody.html.match(/letter-spacing:6px[^>]*>(\d{6})/)[1];

    // Try verifying with legacy verificationCode key instead of code
    const legacyRes = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'extrakeys@example.com',
          verificationCode: newCode,
          purpose: 'signup',
        }),
      },
      env
    );
    expect(legacyRes.status).toBe(400);
    const legacyData = await legacyRes.json();
    expect(legacyData.code).toBe('invalid_code');
  });

  it('returns 409 Conflict and ACCOUNT_EXISTS code if username or email already exists', async () => {
    // First signup succeeds
    await signup(env, 'duplicateuser', 'duplicate@example.com');

    // Second signup with same username/email fails with 409 Conflict
    const res = await app.request(
      '/api/auth/signup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'duplicateuser',
          email: 'duplicate@example.com',
          password: PASSWORD,
        }),
      },
      env
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('ACCOUNT_EXISTS');
    expect(data.error).toBe('Username or email already in use.');
  });

  it('succeeds signup even if a generic email delivery failure occurs, returning codeSent: false', async () => {
    // Temporarily mock global fetch to fail to simulate email delivery failure
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.resolve({}),
      })
    );

    try {
      const res = await app.request(
        '/api/auth/signup',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'sendfailuser',
            email: 'sendfail@example.com',
            password: PASSWORD,
          }),
        },
        env
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.verificationRequired).toBe(true);
      expect(data.codeSent).toBe(false);
      expect(data.code).toBe('email_send_failed');
    } finally {
      // Restore global fetch
      global.fetch = originalFetch;
    }
  });
  it('limits verification attempts and active sends', async () => {
    await signup(env, 'limiteduser', 'limited@example.com');
    let latest = env.DB.email_verification_codes[0];

    const wrong = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'limited@example.com', code: '000000', purpose: 'signup' }),
      },
      env
    );
    expect(wrong.status).toBe(400);
    expect(latest.attempts).toBe(1);

    for (let i = 0; i < 2; i++) {
      const res = await app.request(
        '/api/auth/send-verification',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'limited@example.com', purpose: 'signup' }),
        },
        env
      );
      expect(res.status).toBe(200);
    }

    const limited = await app.request(
      '/api/auth/send-verification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'limited@example.com', purpose: 'signup' }),
      },
      env
    );
    env.DB.email_verification_codes.forEach((row) => {
      row.attempts = 5;
    });

    expect(limited.status).toBe(429);

    const tooManyAttempts = await app.request(
      '/api/auth/verify-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'limited@example.com', code: '123456', purpose: 'signup' }),
      },
      env
    );
    expect(tooManyAttempts.status).toBe(400);
    expect((await tooManyAttempts.json()).code).toBe('too_many_attempts');
  });

  it('does not leave an active verification code when email delivery fails', async () => {
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    const res = await app.request(
      '/api/auth/send-verification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'delivery-fail@example.com', purpose: 'signup' }),
      },
      env
    );

    expect(res.status).toBe(502);
    expect(env.DB.email_verification_codes).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(
      'Verification email send failed:',
      expect.objectContaining({
        route: '/api/auth/send-verification',
        email: 'delivery-fail@example.com',
        purpose: 'signup',
        errorCode: 'email_send_failed',
        provider: 'resend',
        providerStatus: 503,
        providerResponse: 'service unavailable',
      })
    );
    logSpy.mockRestore();
  });

  it('prevents private document IDOR reads and enforces editor/viewer writes', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const bob = await signupVerified(env, 'bob', 'bob@example.com');
    const carol = await signupVerified(env, 'carol', 'carol@example.com');
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
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const bob = await signupVerified(env, 'bob', 'bob@example.com');
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

    const object = new SynchroDocumentObject({}, env);
    const res = await object.fetch(
      new Request(`https://example.com/ws/${doc.data.id}?ticket=${ticket}`)
    );
    expect(res.status).toBe(403);
  });

  it('rejects malformed realtime messages cleanly', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'Realtime Doc');
    const object = new SynchroDocumentObject({}, env);
    const socket = new FakeSocket();

    await object.handleConnection(socket, doc.data.id, alice.user.id, 'alice', false);
    await socket.listeners.message({ data: 'not-binary' });

    expect(socket.closed).toEqual({
      code: 1003,
      reason: 'Unsupported message type',
    });
  });

  // -------------------------------------------------------
  // WebSocket route tests
  // -------------------------------------------------------

  it('GET /ws/:documentId without Upgrade header returns 426', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'WS Test Doc');

    const res = await app.request(
      `/ws/${doc.data.id}?ticket=anything`,
      {
        // No Upgrade header — plain HTTP GET
        method: 'GET',
      },
      env
    );

    expect(res.status).toBe(426);
    const data = await res.json();
    expect(data.code).toBe('upgrade_required');
  });

  it('GET /ws/:documentId with missing ticket returns 401', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'WS Test Doc');

    const res = await app.request(
      `/ws/${doc.data.id}`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('ticket_required');
  });

  it('GET /ws/:documentId with invalid ticket returns 401', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'WS Test Doc');

    const res = await app.request(
      `/ws/${doc.data.id}?ticket=not.a.valid.jwt`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('invalid_ticket');
  });

  it('GET /ws/:documentId with wrong-type ticket returns 401', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'WS Test Doc');

    // Sign a valid JWT but with wrong type (access token, not ws-ticket)
    const wrongTicket = await sign(
      {
        sub: alice.user.id,
        username: 'alice',
        type: 'access', // not 'ws-ticket'
        exp: Math.floor(Date.now() / 1000) + 30,
      },
      env.JWT_SECRET
    );

    const res = await app.request(
      `/ws/${doc.data.id}?ticket=${wrongTicket}`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('invalid_ticket');
  });

  it('GET /ws/:documentId with unauthorized user ticket returns 403', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const bob = await signupVerified(env, 'bob', 'bob@example.com');
    const doc = await createDocument(env, alice.data.token, 'Private WS Doc');

    // Bob has a valid ticket but no access to Alice's document
    const ticket = await sign(
      {
        sub: bob.user.id,
        username: 'bob',
        type: 'ws-ticket',
        exp: Math.floor(Date.now() / 1000) + 30,
      },
      env.JWT_SECRET
    );

    const res = await app.request(
      `/ws/${doc.data.id}?ticket=${ticket}`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('access_denied');
  });

  it('GET /ws/:documentId with authorized ticket forwards to Durable Object (101)', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'Authorized WS Doc');

    const ticket = await sign(
      {
        sub: alice.user.id,
        username: 'alice',
        type: 'ws-ticket',
        exp: Math.floor(Date.now() / 1000) + 30,
      },
      env.JWT_SECRET
    );

    const res = await app.request(
      `/ws/${doc.data.id}?ticket=${ticket}`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    // In CF runtime the DO returns 101; in the Node test harness the mock returns 200
    // to work around Node's Response constructor rejecting status 101.
    // A 200 here proves the Worker route successfully passed through to the DO stub.
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------
  // Security header middleware guard tests
  // -------------------------------------------------------

  it('normal HTTP routes still receive security headers', async () => {
    const health = await app.request('/health', {}, env);
    expect(health.status).toBe(200);
    expect(health.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(health.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(health.headers.get('X-Frame-Options')).toBe('DENY');
    expect(health.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('/api/config still has security headers', async () => {
    const res = await app.request('/api/config', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
  });

  it('/ws/:documentId without Upgrade returns 426 JSON with security headers', async () => {
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'Header Guard Doc');

    const res = await app.request(`/ws/${doc.data.id}?ticket=anything`, { method: 'GET' }, env);

    expect(res.status).toBe(426);
    const data = await res.json();
    expect(data.code).toBe('upgrade_required');
    // Non-upgrade responses still get security headers
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('WebSocket upgrade route does not attempt to mutate response headers', async () => {
    // This test would throw "Can't modify immutable headers" in production if the
    // middleware guard is missing. In the test harness the mock DO returns 200 (not 101)
    // so we verify no exception is thrown and the DO response is passed through intact.
    const alice = await signupVerified(env, 'alice', 'alice@example.com');
    const doc = await createDocument(env, alice.data.token, 'Middleware Guard Doc');

    const ticket = await sign(
      {
        sub: alice.user.id,
        username: 'alice',
        type: 'ws-ticket',
        exp: Math.floor(Date.now() / 1000) + 30,
      },
      env.JWT_SECRET
    );

    // Should NOT throw — middleware must bail before mutating DO response headers.
    const res = await app.request(
      `/ws/${doc.data.id}?ticket=${ticket}`,
      {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      },
      env
    );

    // Mock DO returns 200; importantly no exception was thrown by the middleware.
    expect(res.status).toBe(200);
    // Security headers must NOT be present on a WS upgrade forwarded response.
    // (In production this would be a 101 with immutable headers.)
    expect(res.headers.get('X-Content-Type-Options')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });
});
