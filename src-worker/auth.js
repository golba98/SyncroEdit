import { sign, verify } from 'hono/jwt';

// Web Crypto PBKDF2 Password Hashing
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 10000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  const hashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2:10000:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('pbkdf2:10000:')) {
    // Prevent timing attacks
    await hashPassword('dummy-password-hash');
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const hashHex = parts[3];

  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  const currentHashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(hashHex, currentHashHex);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Generate new access and refresh tokens, storing session in D1
export async function generateTokens(user, env, userAgent = '', ipAddress = '') {
  const sessionId = crypto.randomUUID();
  const jwtSecret = env.JWT_SECRET || 'dev-secret-key';

  const accessToken = await sign(
    {
      id: user.id,
      username: user.username,
      sessionId: sessionId,
      exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 mins
    },
    jwtSecret
  );

  const refreshToken = await sign(
    {
      id: user.id,
      sessionId: sessionId,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
    },
    jwtSecret
  );

  // Store session in database (keeping at most 5 sessions per user)
  const existingSessions = await env.DB.prepare(
    'SELECT id FROM sessions WHERE userId = ? ORDER BY lastActive ASC'
  )
    .bind(user.id)
    .all();

  if (existingSessions.results && existingSessions.results.length >= 5) {
    const sessionsToRemove = existingSessions.results.length - 4;
    for (let i = 0; i < sessionsToRemove; i++) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
        .bind(existingSessions.results[i].id)
        .run();
    }
  }

  await env.DB.prepare(
    "INSERT INTO sessions (id, userId, refreshToken, userAgent, ipAddress, lastActive) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  )
    .bind(sessionId, user.id, refreshToken, userAgent, ipAddress)
    .run();

  return { accessToken, refreshToken, sessionId };
}

// Authentication Middleware
export async function authenticateUser(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: 'Authentication required' }, 401);
  }
  const token = authHeader.substring(7);
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-key';
  try {
    const decoded = await verify(token, jwtSecret, 'HS256');

    // Check if session still exists in D1
    const session = await c.env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(decoded.sessionId)
      .first();
    if (!session) {
      return c.json({ message: 'Session revoked or expired' }, 401);
    }

    c.set('user', decoded);
    await next();
  } catch {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }
}
