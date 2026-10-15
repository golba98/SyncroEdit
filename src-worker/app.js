import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  authenticateUser,
  requireVerifiedAuth,
  requireVerifiedUser,
} from './auth.js';
import {
  CODE_TTL_SECONDS,
  MAX_ACTIVE_CODES_PER_EMAIL,
  SEND_WINDOW_SECONDS,
  generateCode,
  hashCode,
  isValidEmail,
  normalizeEmail,
  requireEmailCodePepper,
  sendVerificationEmail,
} from './emailVerification.js';
import {
  AppError,
  LIMITS,
  assertDocumentEditable,
  assertDocumentOwner,
  assertDocumentReadable,
  getClientIp,
  getDocumentAccess,
  jsonError,
  readJson,
  requireDb,
  requireDurableObject,
  requireJwtSecret,
  securityHeaders,
  tightCors,
  validateBoolean,
  validateEmail,
  validatePageContent,
  validatePassword,
  validateTitle,
  validateUsername,
  validateUuid,
} from './security.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerUserRoutes } from './routes/user.js';
import { registerDocumentsRoutes } from './routes/documents.js';
import { registerRealtimeRoutes } from './routes/realtime.js';

// Export Durable Object classes so Cloudflare can bind them.
// These keep the historical "Synchro" spelling because they match the production class names
// already registered in Cloudflare's namespace (wrangler.toml bindings use these names).
// Renaming them requires a `renamed_classes` migration, not a find-and-replace.
export {
  SynchroDocumentObject,
  SynchroDocumentObject as DocumentSyncObject,
} from './syncObject.js';

export {
  SynchroRateLimitObject,
  SynchroRateLimitObject as RateLimitObject,
} from './rateLimitObject.js';

const app = new Hono();

function getRequestIdentifier(c) {
  return c.req.header('cf-ray') || crypto.randomUUID();
}

function logSignupFailure(c, step, err) {
  console.error('Signup route failed:', {
    route: '/api/auth/signup',
    requestId: getRequestIdentifier(c),
    step,
    errorName: err && err.name ? err.name : 'Error',
    message: err && err.message ? err.message : 'Unknown error',
    stack: err && err.stack ? err.stack : undefined,
  });
}

function logVerificationEmailFailure(c, route, email, purpose, err) {
  console.error('Verification email send failed:', {
    route,
    requestId: getRequestIdentifier(c),
    email,
    purpose,
    errorCode: err?.code || 'email_send_failed',
    provider: err?.provider || null,
    providerStatus: err?.providerStatus || null,
    providerResponse: err?.providerResponse || null,
  });
}

function getEmailVerificationState(user) {
  const verifiedAt = user?.email_verified_at ?? null;
  const verified = verifiedAt !== null && verifiedAt !== undefined;
  return {
    email_verified_at: verifiedAt,
    emailVerified: verified,
    isEmailVerified: verified,
  };
}

async function syncLegacyEmailVerificationMirror(db, user) {
  if (!user || !user.id || user.isEmailVerified === undefined) return;

  const canonicalMirror =
    user.email_verified_at !== null && user.email_verified_at !== undefined ? 1 : 0;
  if (Number(user.isEmailVerified) === canonicalMirror) return;

  await db
    .prepare('UPDATE users SET isEmailVerified = ? WHERE id = ?')
    .bind(canonicalMirror, user.id)
    .run();
  user.isEmailVerified = canonicalMirror;
}

app.onError((err, c) => {
  if (err instanceof AppError) {
    return jsonError(c, err.status, err.message, err.code);
  }

  console.error('Unhandled Worker error:', {
    message: err && err.message ? err.message : 'Unknown error',
  });
  return jsonError(c, 500, 'Internal Server Error', 'internal_error');
});

app.use('*', securityHeaders);
app.use('/api/*', tightCors);

app.use('/api/*', async (c, next) => {
  if (c.req.path !== '/api/config') {
    requireDb(c.env);
  }
  await next();
});

const AUTH_RATE_LIMITS = {
  '/api/auth/signup': { route: 'signup', limit: 8, windowSeconds: 300 },
  '/api/auth/login': { route: 'login', limit: 12, windowSeconds: 300 },
  '/api/auth/check-username': {
    route: 'check-username',
    limit: 30,
    windowSeconds: 300,
  },
  '/api/auth/refresh-token': {
    route: 'refresh-token',
    limit: 60,
    windowSeconds: 300,
  },
  '/api/auth/ws-ticket': { route: 'ws-ticket', limit: 120, windowSeconds: 300 },
  '/api/auth/send-verification': {
    route: 'send-verification',
    limit: 5,
    windowSeconds: 300,
  },
  '/api/auth/resend-code': { route: 'resend-code', limit: 5, windowSeconds: 300 },
  '/api/auth/verify-email': { route: 'verify-email', limit: 10, windowSeconds: 300 },
};

app.use('/api/auth/*', async (c, next) => {
  if (c.env.NODE_ENV === 'test' && c.req.header('x-bypass-rate-limit') === 'true') {
    await next();
    return;
  }

  const config = AUTH_RATE_LIMITS[c.req.path];
  if (!config) {
    await next();
    return;
  }

  const binding = requireDurableObject(c.env, 'RATE_LIMIT_OBJECT');
  const key = getClientIp(c);
  const id = binding.idFromName(`${config.route}:${key}`);
  const stub = binding.get(id);
  const response = await stub.fetch('https://rate-limit.local/check', {
    method: 'POST',
    body: JSON.stringify({ ...config, key }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.allowed !== true) {
    const retryAfter = String(result && result.retryAfter ? result.retryAfter : 60);
    c.header('Retry-After', retryAfter);
    return jsonError(c, 429, 'Too many requests. Please try again later.', 'rate_limited');
  }

  c.header('X-RateLimit-Limit', String(result.limit));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  await next();
});

// Helper to log document audit/history events
async function logHistory(db, docId, userId, username, action, details = '') {
  try {
    await db
      .prepare(
        'INSERT INTO document_history (documentId, userId, username, action, details) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(docId, userId, username || 'Anonymous', action, details)
      .run();
  } catch (err) {
    console.error('Failed to log history event:', err);
  }
}

function validateVerificationPurpose(purpose) {
  const clean = typeof purpose === 'string' && purpose.trim() ? purpose.trim() : 'signup';
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(clean)) {
    throw new AppError(400, 'Invalid verification purpose', 'invalid_purpose');
  }
  return clean.toLowerCase();
}

function validateVerificationEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AppError(400, 'Invalid email address', 'invalid_email');
  }
  return normalizedEmail;
}

async function createAndSendVerificationCode(env, db, email, purpose = 'signup') {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - SEND_WINDOW_SECONDS;
  const active = await db
    .prepare(
      `
        SELECT COUNT(*) as count
        FROM email_verification_codes
        WHERE email = ?
          AND purpose = ?
          AND consumed_at IS NULL
          AND created_at >= ?
      `
    )
    .bind(email, purpose, windowStart)
    .first();

  if ((active && Number(active.count)) >= MAX_ACTIVE_CODES_PER_EMAIL) {
    throw new AppError(429, 'Too many verification codes requested', 'verification_rate_limited');
  }

  const code = env.NODE_ENV === 'test' ? '123456' : generateCode();
  const pepper = requireEmailCodePepper(env);
  const codeHash = await hashCode({ email, code, pepper });
  const expiresAt = now + CODE_TTL_SECONDS;
  const codeId = crypto.randomUUID();

  await db
    .prepare(
      `
        INSERT INTO email_verification_codes
          (id, email, code_hash, purpose, attempts, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, 0, ?, NULL, ?)
      `
    )
    .bind(codeId, email, codeHash, purpose, expiresAt, now)
    .run();

  try {
    await sendVerificationEmail(env, email, code);
  } catch (err) {
    await db
      .prepare('DELETE FROM email_verification_codes WHERE id = ? AND consumed_at IS NULL')
      .bind(codeId)
      .run();
    throw err;
  }
}

function verificationSentResponse(c) {
  return c.json({
    ok: true,
    message: 'If the email can receive verification codes, a code was sent.',
  });
}

async function getAuthenticatedRequestUser(c, db) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  try {
    const decoded = await verify(authHeader.substring(7), requireJwtSecret(c.env), 'HS256');
    const session = await db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(decoded.sessionId)
      .first();
    if (!session) return null;

    return db
      .prepare(
        'SELECT id, username, email, isEmailVerified, email_verified_at FROM users WHERE id = ?'
      )
      .bind(decoded.id)
      .first();
  } catch {
    return null;
  }
}

const routeDependencies = {
  AppError,
  LIMITS,
  assertDocumentEditable,
  assertDocumentOwner,
  assertDocumentReadable,
  authenticateUser,
  createAndSendVerificationCode,
  deleteCookie,
  getAuthenticatedRequestUser,
  getCookie,
  getDocumentAccess,
  getEmailVerificationState,
  generateTokens,
  hashCode,
  hashPassword,
  logHistory,
  logSignupFailure,
  logVerificationEmailFailure,
  readJson,
  requireEmailCodePepper,
  requireDb,
  requireDurableObject,
  requireJwtSecret,
  requireVerifiedAuth,
  requireVerifiedUser,
  setCookie,
  sign,
  syncLegacyEmailVerificationMirror,
  validateBoolean,
  validateEmail,
  validatePageContent,
  validatePassword,
  validateTitle,
  validateUsername,
  validateUuid,
  validateVerificationEmail,
  validateVerificationPurpose,
  verificationSentResponse,
  verify,
  verifyPassword,
};

// -------------------------------------------------------------
// Health and Config Routes (Public)
// -------------------------------------------------------------
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: 'production',
  });
});

app.get('/api/config', (c) => {
  return c.json({
    emailVerificationEnabled: false,
    realtimeBackend: 'durable-object',
    authMode: 'bearer-access-token-refresh-cookie',
  });
});

registerAuthRoutes(app, routeDependencies);
registerUserRoutes(app, routeDependencies);
registerDocumentsRoutes(app, routeDependencies);
registerRealtimeRoutes(app, routeDependencies);

export default app;
