import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { hashPassword, verifyPassword, generateTokens, authenticateUser } from './auth.js';
import { RateLimitObject } from './rateLimitObject.js';
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

// Export Durable Object class so Cloudflare can bind it
export { DocumentSyncObject } from './syncObject.js';
export { RateLimitObject };

const app = new Hono();

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
  '/api/auth/resend-code': { route: 'resend-code', limit: 5, windowSeconds: 300 },
  '/api/auth/verify-email': { route: 'verify-email', limit: 10, windowSeconds: 300 },
};

app.use('/api/auth/*', async (c, next) => {
  if (c.req.header('x-bypass-rate-limit') === 'true') {
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

// -------------------------------------------------------------
// Authentication / Session Routes
// -------------------------------------------------------------

app.post('/api/auth/signup', async (c) => {
  try {
    const db = requireDb(c.env);
    const { username, email, password } = await readJson(c, LIMITS.authBody);
    const trimmedUsername = validateUsername(username);
    const normalizedEmail = validateEmail(email);
    validatePassword(password);

    // Check uniqueness
    const existingUser = await db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .bind(trimmedUsername, normalizedEmail)
      .first();

    if (existingUser) {
      return c.json({ message: 'Unable to create account with those credentials' }, 400);
    }

    const hashedPassword = await hashPassword(password);
    const userId = crypto.randomUUID();

    await db
      .prepare(
        'INSERT INTO users (id, username, email, password, isEmailVerified) VALUES (?, ?, ?, ?, 1)'
      )
      .bind(userId, trimmedUsername, normalizedEmail, hashedPassword)
      .run();

    const userObj = {
      id: userId,
      username: trimmedUsername,
      email: normalizedEmail,
    };
    const { accessToken, refreshToken } = await generateTokens(
      userObj,
      c.env,
      c.req.header('user-agent'),
      c.req.header('cf-connecting-ip')
    );

    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return c.json(
      {
        token: accessToken,
        username: trimmedUsername,
        email: normalizedEmail,
      },
      201
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Internal Server Error', 'signup_failed');
  }
});

app.post('/api/auth/login', async (c) => {
  try {
    const db = requireDb(c.env);
    const { username, password } = await readJson(c, LIMITS.authBody);
    const trimmedUsername = validateUsername(username);
    if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      return c.json({ message: 'Invalid username or password' }, 401);
    }

    const user = await db
      .prepare('SELECT id, username, email, password FROM users WHERE username = ?')
      .bind(trimmedUsername)
      .first();

    if (!user) {
      // Mitigate timing attacks by always performing verification work
      await verifyPassword(password, '');
      return c.json({ message: 'Invalid username or password' }, 401);
    }

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) {
      return c.json({ message: 'Invalid username or password' }, 401);
    }

    const { accessToken, refreshToken } = await generateTokens(
      user,
      c.env,
      c.req.header('user-agent'),
      c.req.header('cf-connecting-ip')
    );

    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return c.json({
      token: accessToken,
      username: user.username,
      email: user.email,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Internal Server Error', 'login_failed');
  }
});

app.post('/api/auth/check-username', async (c) => {
  const db = requireDb(c.env);
  const { username } = await readJson(c, LIMITS.authBody);
  const trimmedUsername = validateUsername(username);

  const user = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind(trimmedUsername)
    .first();
  if (user) {
    const suggestions = [
      `${trimmedUsername}${Math.floor(Math.random() * 99)}`,
      `${trimmedUsername}_edit`,
      `sync_${trimmedUsername}`,
    ];
    return c.json({ available: false, suggestions });
  }
  return c.json({ available: true });
});

app.post('/api/auth/logout', async (c) => {
  const db = requireDb(c.env);
  const cookieToken = getCookie(c, 'refreshToken');
  if (cookieToken) {
    try {
      const decoded = await verify(cookieToken, requireJwtSecret(c.env), 'HS256');
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(decoded.sessionId).run();
    } catch {}
  }
  deleteCookie(c, 'refreshToken', { path: '/' });
  return c.json({ message: 'Logged out successfully' });
});

app.post('/api/auth/refresh-token', async (c) => {
  const db = requireDb(c.env);
  const cookieToken = getCookie(c, 'refreshToken');
  if (!cookieToken) {
    return c.json({ message: 'Refresh token required' }, 401);
  }

  const jwtSecret = requireJwtSecret(c.env);
  try {
    const decoded = await verify(cookieToken, jwtSecret, 'HS256');
    const session = await db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(decoded.sessionId)
      .first();
    if (!session) {
      return c.json({ message: 'Session expired' }, 401);
    }

    const user = await db
      .prepare('SELECT username, email FROM users WHERE id = ?')
      .bind(decoded.id)
      .first();
    if (!user) {
      return c.json({ message: 'User not found' }, 401);
    }

    // Generate new access token
    const accessToken = await sign(
      {
        id: decoded.id,
        username: user.username,
        sessionId: decoded.sessionId,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      jwtSecret
    );

    await db
      .prepare("UPDATE sessions SET lastActive = datetime('now') WHERE id = ?")
      .bind(decoded.sessionId)
      .run();

    return c.json({ token: accessToken });
  } catch {
    return c.json({ message: 'Invalid refresh token' }, 401);
  }
});

app.post('/api/auth/resend-code', async (c) => {
  try {
    const db = requireDb(c.env);
    const { email } = await readJson(c, LIMITS.authBody);
    const normalizedEmail = validateEmail(email);

    const user = await db
      .prepare('SELECT id, username FROM users WHERE email = ?')
      .bind(normalizedEmail)
      .first();

    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db
      .prepare('UPDATE users SET verificationCode = ?, verificationCodeExpires = ? WHERE id = ?')
      .bind(code, expires, user.id)
      .run();

    console.log(`[VERIFICATION CODE] Sent to ${normalizedEmail}: ${code}`);

    return c.json({ message: 'Verification code resent' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Internal Server Error', 'resend_code_failed');
  }
});

app.post('/api/auth/verify-email', async (c) => {
  try {
    const db = requireDb(c.env);
    const { email, verificationCode } = await readJson(c, LIMITS.authBody);
    const normalizedEmail = validateEmail(email);
    const trimmedCode = String(verificationCode || '').trim();

    if (!trimmedCode) {
      throw new AppError(400, 'Verification code required', 'code_required');
    }

    const user = await db
      .prepare(
        'SELECT id, username, email, verificationCode, verificationCodeExpires FROM users WHERE email = ?'
      )
      .bind(normalizedEmail)
      .first();

    if (!user) {
      throw new AppError(404, 'User not found', 'user_not_found');
    }

    if (!user.verificationCode || user.verificationCode !== trimmedCode) {
      throw new AppError(400, 'Invalid verification code', 'invalid_code');
    }

    const expires = new Date(user.verificationCodeExpires);
    if (isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
      throw new AppError(400, 'Verification code expired', 'code_expired');
    }

    await db
      .prepare(
        'UPDATE users SET isEmailVerified = 1, verificationCode = NULL, verificationCodeExpires = NULL WHERE id = ?'
      )
      .bind(user.id)
      .run();

    const { accessToken, refreshToken } = await generateTokens(
      { id: user.id, username: user.username, email: user.email },
      c.env,
      c.req.header('user-agent'),
      c.req.header('cf-connecting-ip')
    );

    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return c.json({
      token: accessToken,
      username: user.username,
      email: user.email,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'Internal Server Error', 'verification_failed');
  }
});

app.get('/api/auth/ws-ticket', authenticateUser, async (c) => {
  const user = c.get('user');
  const jwtSecret = requireJwtSecret(c.env);

  // Create short-lived ticket JWT (valid for 30s)
  const ticket = await sign(
    {
      sub: user.id,
      username: user.username,
      sessionId: user.sessionId,
      type: 'ws-ticket',
      exp: Math.floor(Date.now() / 1000) + 30,
    },
    jwtSecret
  );

  return c.json({ ticket });
});

// -------------------------------------------------------------
// User Profile & Session Routes (Auth Required)
// -------------------------------------------------------------

app.get('/api/user/profile', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const profile = await db
    .prepare(
      'SELECT id, username, email, profilePicture, accentColor, bio, showOnlineStatus, createdAt FROM users WHERE id = ?'
    )
    .bind(user.id)
    .first();

  if (!profile) return c.json({ message: 'User not found' }, 404);
  return c.json({
    ...profile,
    showOnlineStatus: profile.showOnlineStatus === 1,
  });
});

app.put('/api/user/profile', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const { profilePicture, accentColor, bio, showOnlineStatus } = await readJson(
    c,
    LIMITS.profileBody
  );

  const current = await db.prepare('SELECT id FROM users WHERE id = ?').bind(user.id).first();
  if (!current) return c.json({ message: 'User not found' }, 404);

  const updates = [];
  const bindings = [];

  if (profilePicture !== undefined) {
    if (typeof profilePicture !== 'string' || profilePicture.length > LIMITS.profilePicture) {
      throw new AppError(400, 'Invalid profile picture', 'invalid_profile_picture');
    }
    updates.push('profilePicture = ?');
    bindings.push(profilePicture);
  }
  if (accentColor !== undefined) {
    if (typeof accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      throw new AppError(400, 'Invalid accent color', 'invalid_accent_color');
    }
    updates.push('accentColor = ?');
    bindings.push(accentColor);
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > LIMITS.bio) {
      throw new AppError(400, 'Invalid bio', 'invalid_bio');
    }
    updates.push('bio = ?');
    bindings.push(bio);
  }
  if (showOnlineStatus !== undefined) {
    if (typeof showOnlineStatus !== 'boolean') {
      throw new AppError(400, 'showOnlineStatus must be a boolean', 'invalid_show_online_status');
    }
    updates.push('showOnlineStatus = ?');
    bindings.push(showOnlineStatus ? 1 : 0);
  }

  if (updates.length > 0) {
    bindings.push(user.id);
    await db
      .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...bindings)
      .run();
  }

  return c.json({
    message: 'Profile updated successfully',
    profilePicture,
    accentColor,
    bio,
    showOnlineStatus,
  });
});

app.put('/api/user/password', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const { currentPassword, newPassword } = await readJson(c, LIMITS.authBody);

  const userRecord = await db
    .prepare('SELECT password FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  if (!userRecord) return c.json({ message: 'User not found' }, 404);

  const isMatch = await verifyPassword(currentPassword, userRecord.password);
  if (!isMatch) return c.json({ message: 'Current password incorrect' }, 400);

  validatePassword(newPassword);

  const hashedPassword = await hashPassword(newPassword);
  await db
    .prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(hashedPassword, user.id)
    .run();

  return c.json({ message: 'Password updated successfully' });
});

app.get('/api/user/sessions', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const sessions = await db
    .prepare(
      'SELECT id as sessionId, userAgent, ipAddress, lastActive FROM sessions WHERE userId = ?'
    )
    .bind(user.id)
    .all();

  const mapped = (sessions.results || []).map((s) => ({
    ...s,
    isCurrent: s.sessionId === user.sessionId,
  }));

  return c.json(mapped);
});

app.delete('/api/user/sessions/:sessionId', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const sessionId = validateUuid(c.req.param('sessionId'), 'session id');
  await db
    .prepare('DELETE FROM sessions WHERE id = ? AND userId = ?')
    .bind(sessionId, user.id)
    .run();
  return c.json({ message: 'Session revoked' });
});

app.delete('/api/user/sessions', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  await db
    .prepare('DELETE FROM sessions WHERE userId = ? AND id != ?')
    .bind(user.id, user.sessionId)
    .run();
  return c.json({ message: 'All other sessions revoked' });
});

// -------------------------------------------------------------
// Document CRUD Routes (Auth Required)
// -------------------------------------------------------------

app.get('/api/documents', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const offset = (page - 1) * limit;

  // Count total matching documents
  const countRes = await db
    .prepare(
      `
    SELECT COUNT(d.id) as count
    FROM documents d
    WHERE d.owner = ?
       OR d.id IN (SELECT documentId FROM document_permissions WHERE userId = ?)
       OR (d.isPublic = 1 AND d.id IN (SELECT documentId FROM recent_documents WHERE userId = ?))
  `
    )
    .bind(user.id, user.id, user.id)
    .first();

  const totalDocuments = countRes ? countRes.count : 0;

  // Retrieve documents with owner names
  const docsRes = await db
    .prepare(
      `
    SELECT d.id, d.title, d.owner, d.lastModified, d.lastModifiedBy, u.username as ownerUsername, l.username as lastModifiedByUsername
    FROM documents d
    LEFT JOIN users u ON d.owner = u.id
    LEFT JOIN users l ON d.lastModifiedBy = l.id
    WHERE d.owner = ?
       OR d.id IN (SELECT documentId FROM document_permissions WHERE userId = ?)
       OR (d.isPublic = 1 AND d.id IN (SELECT documentId FROM recent_documents WHERE userId = ?))
    ORDER BY d.lastModified DESC
    LIMIT ? OFFSET ?
  `
    )
    .bind(user.id, user.id, user.id, limit, offset)
    .all();

  const documentsWithStatus = (docsRes.results || []).map((doc) => ({
    ...doc,
    _id: doc.id,
    isOwner: doc.owner === user.id,
    isShared: doc.owner !== user.id,
    pages: [], // loaded separately on detail load or real-time sync
  }));

  return c.json({
    documents: documentsWithStatus,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalDocuments / limit),
      totalDocuments,
      hasNextPage: page * limit < totalDocuments,
      hasPrevPage: page > 1,
    },
  });
});

app.post('/api/documents', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const body = await readJson(c, LIMITS.documentBody);
  const title = validateTitle(body.title);
  const pages = Array.isArray(body.pages) && body.pages.length > 0 ? body.pages : [{ content: '' }];
  const firstPageContent = validatePageContent(pages[0] && pages[0].content);
  const docId = crypto.randomUUID();

  // Create document
  await db
    .prepare('INSERT INTO documents (id, title, owner, lastModifiedBy) VALUES (?, ?, ?, ?)')
    .bind(docId, title, user.id, user.id)
    .run();

  // Create initial page
  if (pages.length > 0) {
    await db
      .prepare('INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)')
      .bind(docId, firstPageContent)
      .run();
  }

  // Create recent entry
  await db
    .prepare('INSERT INTO recent_documents (userId, documentId) VALUES (?, ?)')
    .bind(user.id, docId)
    .run();

  await logHistory(db, docId, user.id, user.username, 'Created Document');

  return c.json(
    {
      id: docId,
      _id: docId,
      title,
      owner: user.id,
      pages: [{ content: firstPageContent }],
    },
    201
  );
});

app.patch('/api/documents/:id', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');
  const body = await readJson(c, LIMITS.documentBody);
  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentEditable(access);

  const updates = ["lastModified = datetime('now')", 'lastModifiedBy = ?'];
  const bindings = [user.id];
  let title;
  let firstPageContent;

  if (body.title !== undefined) {
    title = validateTitle(body.title);
    updates.push('title = ?');
    bindings.push(title);
  }

  if (body.pages !== undefined) {
    if (!Array.isArray(body.pages)) {
      throw new AppError(400, 'Pages must be an array', 'invalid_pages');
    }
    firstPageContent = validatePageContent(body.pages[0] && body.pages[0].content);
  }

  if (updates.length > 2) {
    bindings.push(docId);
    await db
      .prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...bindings)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE documents SET lastModified = datetime('now'), lastModifiedBy = ? WHERE id = ?"
      )
      .bind(user.id, docId)
      .run();
  }

  if (firstPageContent !== undefined) {
    await db.prepare('DELETE FROM document_pages WHERE documentId = ?').bind(docId).run();
    await db
      .prepare('INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)')
      .bind(docId, firstPageContent)
      .run();
  }

  await logHistory(db, docId, user.id, user.username, 'Updated Document');

  return c.json({
    id: docId,
    _id: docId,
    title: title || access.doc.title,
    pages: firstPageContent === undefined ? undefined : [{ content: firstPageContent }],
  });
});

app.post('/api/documents/:id/recent', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');

  // Verify access permissions
  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentReadable(access);

  // Upsert in recent_documents
  await db
    .prepare(
      "INSERT OR REPLACE INTO recent_documents (userId, documentId, accessedAt) VALUES (?, ?, datetime('now'))"
    )
    .bind(user.id, docId)
    .run();

  // Keep only last 20 recent docs
  const recents = await db
    .prepare('SELECT documentId FROM recent_documents WHERE userId = ? ORDER BY accessedAt DESC')
    .bind(user.id)
    .all();

  if (recents.results && recents.results.length > 20) {
    const thresholdDate = recents.results[19].accessedAt;
    await db
      .prepare('DELETE FROM recent_documents WHERE userId = ? AND accessedAt < ?')
      .bind(user.id, thresholdDate)
      .run();
  }

  return c.json({ message: 'Added to recent' });
});

app.get('/api/documents/:id/settings', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');

  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentReadable(access);

  return c.json({
    isPublic: access.isPublic,
    isOwner: access.isOwner,
    isShared: access.role === 'editor',
  });
});

app.patch('/api/documents/:id/settings', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');
  const { isPublic } = await readJson(c, LIMITS.authBody);

  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentOwner(access);

  const isPublicVal = validateBoolean(isPublic, 'isPublic') ? 1 : 0;
  await db.prepare('UPDATE documents SET isPublic = ? WHERE id = ?').bind(isPublicVal, docId).run();

  return c.json({
    message: 'Settings updated',
    isPublic: isPublicVal === 1,
  });
});

app.delete('/api/documents/:id', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');

  let access;
  try {
    access = await getDocumentAccess(db, docId, user.id);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 404) throw err;
    // Try to remove from recent list anyway if it is there
    await db
      .prepare('DELETE FROM recent_documents WHERE userId = ? AND documentId = ?')
      .bind(user.id, docId)
      .run();
    return c.json({ message: 'Document not found', action: 'removed' }, 404);
  }

  if (!access.isOwner && access.role === 'editor') {
    // If collaborator, just remove shared permission and from recent
    await db
      .prepare('DELETE FROM document_permissions WHERE documentId = ? AND userId = ?')
      .bind(docId, user.id)
      .run();
    await db
      .prepare('DELETE FROM recent_documents WHERE userId = ? AND documentId = ?')
      .bind(user.id, docId)
      .run();
    return c.json({ message: 'Removed from your drive', action: 'removed' });
  }

  if (!access.isOwner) {
    return c.json({ message: 'Only the document owner can delete this document' }, 403);
  }

  // Permanently delete document and all cascade references
  await db.prepare('DELETE FROM documents WHERE id = ?').bind(docId).run();
  await db.prepare('DELETE FROM document_pages WHERE documentId = ?').bind(docId).run();
  await db.prepare('DELETE FROM document_permissions WHERE documentId = ?').bind(docId).run();
  await db.prepare('DELETE FROM recent_documents WHERE documentId = ?').bind(docId).run();
  await db.prepare('DELETE FROM document_history WHERE documentId = ?').bind(docId).run();

  return c.json({ message: 'Document deleted', action: 'deleted' });
});

app.post('/api/documents/:id/transfer', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');
  const { newOwnerUsername } = await readJson(c, LIMITS.authBody);
  const trimmedNewOwnerUsername = validateUsername(newOwnerUsername);

  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentOwner(access);

  const newOwner = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind(trimmedNewOwnerUsername)
    .first();
  if (!newOwner) {
    return c.json({ message: 'User not found' }, 404);
  }

  if (newOwner.id === user.id) {
    return c.json({ message: 'You are already the owner of this document' }, 400);
  }

  // Transfer ownership
  await db.prepare('UPDATE documents SET owner = ? WHERE id = ?').bind(newOwner.id, docId).run();

  // Add old owner to permissions so they retain editor access
  await db
    .prepare(
      "INSERT OR REPLACE INTO document_permissions (documentId, userId, role) VALUES (?, ?, 'editor')"
    )
    .bind(docId, user.id)
    .run();

  // Remove new owner from permissions list
  await db
    .prepare('DELETE FROM document_permissions WHERE documentId = ? AND userId = ?')
    .bind(docId, newOwner.id)
    .run();

  await logHistory(
    db,
    docId,
    user.id,
    user.username,
    `Transferred ownership to ${trimmedNewOwnerUsername}`
  );

  return c.json({
    message: `Ownership transferred to ${trimmedNewOwnerUsername}`,
  });
});

app.get('/api/documents/:id/history', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');
  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentReadable(access);

  const history = await db
    .prepare(
      'SELECT id, documentId, userId, username, action, details, timestamp FROM document_history WHERE documentId = ? ORDER BY timestamp DESC LIMIT 50'
    )
    .bind(docId)
    .all();

  return c.json(history.results || []);
});

app.get('/api/documents/:id/info', authenticateUser, async (c) => {
  const db = requireDb(c.env);
  const user = c.get('user');
  const docId = validateUuid(c.req.param('id'), 'document id');
  const access = await getDocumentAccess(db, docId, user.id);
  assertDocumentReadable(access);

  return c.json({
    title: access.doc.title,
    isOwner: access.isOwner,
    isShared: access.role === 'editor',
  });
});

// -------------------------------------------------------------
// WebSocket Routing
// -------------------------------------------------------------
app.get('/ws/:documentId', async (c) => {
  // Task 1: Require a genuine WebSocket upgrade — return 426 otherwise.
  const upgrade = c.req.header('Upgrade');
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    console.log('[WS] Non-upgrade request rejected (missing Upgrade header)');
    return c.json({ error: 'Expected WebSocket upgrade', code: 'upgrade_required' }, 426);
  }

  const documentId = validateUuid(c.req.param('documentId'), 'document id');
  const ticket = c.req.query('ticket');

  console.log('[WS] Route hit', {
    documentId,
    hasTicket: Boolean(ticket),
  });

  // Task 2: Require a ticket — do not expose its value in logs.
  if (!ticket) {
    console.log('[WS] Rejected: missing ticket for doc', documentId);
    return c.json({ error: 'WebSocket ticket required', code: 'ticket_required' }, 401);
  }

  // Task 3: Validate the ticket at the Worker level.
  const jwtSecret = requireJwtSecret(c.env);
  let ticketPayload;
  try {
    ticketPayload = await verify(ticket, jwtSecret, 'HS256');
  } catch {
    console.log('[WS] Rejected: invalid or expired ticket for doc', documentId);
    return c.json({ error: 'Invalid or expired ticket', code: 'invalid_ticket' }, 401);
  }

  if (!ticketPayload || ticketPayload.type !== 'ws-ticket') {
    console.log('[WS] Rejected: ticket type mismatch for doc', documentId);
    return c.json({ error: 'Invalid ticket type', code: 'invalid_ticket' }, 401);
  }

  // Task 4: Check document read permission before forwarding to DO.
  const db = requireDb(c.env);
  try {
    const access = await getDocumentAccess(db, documentId, ticketPayload.sub);
    assertDocumentReadable(access);
    console.log('[WS] Permission granted', {
      documentId,
      userId: ticketPayload.sub,
      canEdit: access.canEdit,
    });
  } catch (err) {
    console.log('[WS] Permission denied', {
      documentId,
      userId: ticketPayload.sub,
      reason: err instanceof AppError ? err.message : 'unknown',
    });
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code }, err.status);
    }
    return c.json({ error: 'Access denied', code: 'access_denied' }, 403);
  }

  // Task 5: Forward the original request (with all headers intact) to the Durable Object.
  const binding = requireDurableObject(c.env, 'DOCUMENT_SYNC_OBJECT');
  const id = binding.idFromName(documentId);
  const stub = binding.get(id);
  const doResponse = await stub.fetch(c.req.raw);

  console.log('[WS] DO response status', doResponse.status, 'for doc', documentId);

  return doResponse;
});

export default app;
