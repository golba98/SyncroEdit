import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { hashPassword, verifyPassword, generateTokens, authenticateUser } from './auth.js';

// Export Durable Object class so Cloudflare can bind it
export { DocumentSyncObject } from './syncObject.js';

const app = new Hono();

// Enable CORS for development
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

// Password Policy Regex
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])(?=.{8,})/;

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
  });
});

app.get('/api/debug/bindings', (c) => {
  return c.json({
    hasDB: c.env.DB !== undefined,
    hasDocumentSyncObject: c.env.DOCUMENT_SYNC_OBJECT !== undefined,
  });
});

// Provide a mock CSRF token route for compatibility.
// Bearer-token authentication is stateless and header-based, so CSRF is not required.
app.get('/api/auth/csrf-token', (c) => {
  return c.json({
    csrfToken: 'cf-csrf-compatible-token-static-12345678',
  });
});

// -------------------------------------------------------------
// Authentication / Session Routes
// -------------------------------------------------------------

app.post('/api/auth/signup', async (c) => {
  try {
    const { username, email, password } = await c.req.json();
    if (!username || !email || !password) {
      return c.json({ message: 'Username, email, and password are required' }, 400);
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return c.json({ message: 'Username must be at least 3 characters long' }, 400);
    }

    if (!PASSWORD_REGEX.test(password)) {
      return c.json(
        {
          message:
            'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one symbol (!@#$%^&*).',
        },
        400
      );
    }

    // Check uniqueness
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ? OR email = ?'
    )
      .bind(trimmedUsername, email.toLowerCase().trim())
      .first();

    if (existingUser) {
      return c.json({ message: 'Username or email already exists' }, 400);
    }

    const hashedPassword = await hashPassword(password);
    const userId = crypto.randomUUID();

    await c.env.DB.prepare(
      'INSERT INTO users (id, username, email, password, isEmailVerified) VALUES (?, ?, ?, ?, 1)'
    )
      .bind(userId, trimmedUsername, email.toLowerCase().trim(), hashedPassword)
      .run();

    const userObj = { id: userId, username: trimmedUsername, email };
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
        email: email.toLowerCase().trim(),
      },
      201
    );
  } catch (err) {
    return c.json({ message: err.message || 'Internal Server Error' }, 500);
  }
});

app.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return c.json({ message: 'Username and password are required' }, 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, username, email, password FROM users WHERE username = ?'
    )
      .bind(username.trim())
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
    return c.json({ message: err.message || 'Internal Server Error' }, 500);
  }
});

app.post('/api/auth/check-username', async (c) => {
  const { username } = await c.req.json();
  if (!username) return c.json({ message: 'Username is required' }, 400);

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username.trim())
    .first();
  if (user) {
    const suggestions = [
      `${username}${Math.floor(Math.random() * 99)}`,
      `${username}_edit`,
      `sync_${username}`,
    ];
    return c.json({ available: false, suggestions });
  }
  return c.json({ available: true });
});

app.post('/api/auth/logout', async (c) => {
  const cookieToken = getCookie(c, 'refreshToken');
  if (cookieToken) {
    try {
      const decoded = await verify(cookieToken, c.env.JWT_SECRET || 'dev-secret-key', 'HS256');
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(decoded.sessionId).run();
    } catch {}
  }
  deleteCookie(c, 'refreshToken', { path: '/' });
  return c.json({ message: 'Logged out successfully' });
});

app.post('/api/auth/refresh-token', async (c) => {
  const cookieToken = getCookie(c, 'refreshToken');
  if (!cookieToken) {
    return c.json({ message: 'Refresh token required' }, 401);
  }

  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-key';
  try {
    const decoded = await verify(cookieToken, jwtSecret, 'HS256');
    const session = await c.env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(decoded.sessionId)
      .first();
    if (!session) {
      return c.json({ message: 'Session expired' }, 401);
    }

    const user = await c.env.DB.prepare('SELECT username, email FROM users WHERE id = ?')
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

    await c.env.DB.prepare("UPDATE sessions SET lastActive = datetime('now') WHERE id = ?")
      .bind(decoded.sessionId)
      .run();

    return c.json({ token: accessToken });
  } catch {
    return c.json({ message: 'Invalid refresh token' }, 401);
  }
});

app.get('/api/auth/ws-ticket', authenticateUser, async (c) => {
  const user = c.get('user');
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-key';

  // Create short-lived ticket JWT (valid for 30s)
  const ticket = await sign(
    {
      sub: user.id,
      username: user.username,
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
  const user = c.get('user');
  const profile = await c.env.DB.prepare(
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
  const user = c.get('user');
  const { profilePicture, accentColor, bio, showOnlineStatus } = await c.req.json();

  const current = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user.id).first();
  if (!current) return c.json({ message: 'User not found' }, 404);

  const updates = [];
  const bindings = [];

  if (profilePicture !== undefined) {
    updates.push('profilePicture = ?');
    bindings.push(profilePicture);
  }
  if (accentColor !== undefined) {
    updates.push('accentColor = ?');
    bindings.push(accentColor);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    bindings.push(bio);
  }
  if (showOnlineStatus !== undefined) {
    updates.push('showOnlineStatus = ?');
    bindings.push(showOnlineStatus ? 1 : 0);
  }

  if (updates.length > 0) {
    bindings.push(user.id);
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
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
  const user = c.get('user');
  const { currentPassword, newPassword } = await c.req.json();

  const userRecord = await c.env.DB.prepare('SELECT password FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  if (!userRecord) return c.json({ message: 'User not found' }, 404);

  const isMatch = await verifyPassword(currentPassword, userRecord.password);
  if (!isMatch) return c.json({ message: 'Current password incorrect' }, 400);

  if (!PASSWORD_REGEX.test(newPassword)) {
    return c.json({ message: 'Password complexity requirements not met' }, 400);
  }

  const hashedPassword = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(hashedPassword, user.id)
    .run();

  return c.json({ message: 'Password updated successfully' });
});

app.get('/api/user/sessions', authenticateUser, async (c) => {
  const user = c.get('user');
  const sessions = await c.env.DB.prepare(
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
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND userId = ?')
    .bind(sessionId, user.id)
    .run();
  return c.json({ message: 'Session revoked' });
});

app.delete('/api/user/sessions', authenticateUser, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?')
    .bind(user.id, user.sessionId)
    .run();
  return c.json({ message: 'All other sessions revoked' });
});

// -------------------------------------------------------------
// Document CRUD Routes (Auth Required)
// -------------------------------------------------------------

app.get('/api/documents', authenticateUser, async (c) => {
  const user = c.get('user');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = (page - 1) * limit;

  // Count total matching documents
  const countRes = await c.env.DB.prepare(
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
  const docsRes = await c.env.DB.prepare(
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
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const title = body.title || 'Untitled document';
  const pages = body.pages || [{ content: '' }];
  const docId = crypto.randomUUID();

  // Create document
  await c.env.DB.prepare(
    'INSERT INTO documents (id, title, owner, lastModifiedBy) VALUES (?, ?, ?, ?)'
  )
    .bind(docId, title, user.id, user.id)
    .run();

  // Create initial page
  if (pages.length > 0) {
    await c.env.DB.prepare(
      'INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)'
    )
      .bind(docId, pages[0].content || '')
      .run();
  }

  // Create recent entry
  await c.env.DB.prepare('INSERT INTO recent_documents (userId, documentId) VALUES (?, ?)')
    .bind(user.id, docId)
    .run();

  await logHistory(c.env.DB, docId, user.id, user.username, 'Created Document');

  return c.json(
    {
      id: docId,
      _id: docId,
      title,
      owner: user.id,
      pages,
    },
    201
  );
});

app.post('/api/documents/:id/recent', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');

  // Verify access permissions
  const doc = await c.env.DB.prepare('SELECT owner, isPublic FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  const isOwner = doc.owner === user.id;
  const permission = await c.env.DB.prepare(
    'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
  )
    .bind(docId, user.id)
    .first();

  if (!isOwner && !permission && doc.isPublic !== 1) {
    return c.json({ message: 'Access denied' }, 403);
  }

  // Upsert in recent_documents
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO recent_documents (userId, documentId, accessedAt) VALUES (?, ?, datetime('now'))"
  )
    .bind(user.id, docId)
    .run();

  // Keep only last 20 recent docs
  const recents = await c.env.DB.prepare(
    'SELECT documentId FROM recent_documents WHERE userId = ? ORDER BY accessedAt DESC'
  )
    .bind(user.id)
    .all();

  if (recents.results && recents.results.length > 20) {
    const thresholdDate = recents.results[19].accessedAt;
    await c.env.DB.prepare('DELETE FROM recent_documents WHERE userId = ? AND accessedAt < ?')
      .bind(user.id, thresholdDate)
      .run();
  }

  return c.json({ message: 'Added to recent' });
});

app.get('/api/documents/:id/settings', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');

  const doc = await c.env.DB.prepare('SELECT owner, isPublic FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  const isOwner = doc.owner === user.id;
  const permission = await c.env.DB.prepare(
    'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
  )
    .bind(docId, user.id)
    .first();

  if (!isOwner && !permission && doc.isPublic !== 1) {
    return c.json({ message: 'Access denied' }, 403);
  }

  return c.json({
    isPublic: doc.isPublic === 1,
    isOwner,
    isShared: permission && permission.role === 'editor',
  });
});

app.patch('/api/documents/:id/settings', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');
  const { isPublic } = await c.req.json();

  const doc = await c.env.DB.prepare('SELECT owner FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  if (doc.owner !== user.id) {
    return c.json({ message: 'Access denied. Only owner can change settings.' }, 403);
  }

  const isPublicVal = isPublic === true || isPublic === 'true' ? 1 : 0;
  await c.env.DB.prepare('UPDATE documents SET isPublic = ? WHERE id = ?')
    .bind(isPublicVal, docId)
    .run();

  return c.json({
    message: 'Settings updated',
    isPublic: isPublicVal === 1,
  });
});

app.delete('/api/documents/:id', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');

  const doc = await c.env.DB.prepare('SELECT owner FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) {
    // Try to remove from recent list anyway if it is there
    await c.env.DB.prepare('DELETE FROM recent_documents WHERE userId = ? AND documentId = ?')
      .bind(user.id, docId)
      .run();
    return c.json({ message: 'Document not found', action: 'removed' }, 404);
  }

  const isOwner = doc.owner === user.id;
  const permission = await c.env.DB.prepare(
    'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
  )
    .bind(docId, user.id)
    .first();

  if (!isOwner && permission && permission.role === 'editor') {
    // If collaborator, just remove shared permission and from recent
    await c.env.DB.prepare('DELETE FROM document_permissions WHERE documentId = ? AND userId = ?')
      .bind(docId, user.id)
      .run();
    await c.env.DB.prepare('DELETE FROM recent_documents WHERE userId = ? AND documentId = ?')
      .bind(user.id, docId)
      .run();
    return c.json({ message: 'Removed from your drive', action: 'removed' });
  }

  if (!isOwner) {
    return c.json({ message: 'Only the document owner can delete this document' }, 403);
  }

  // Permanently delete document and all cascade references
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(docId).run();
  await c.env.DB.prepare('DELETE FROM document_pages WHERE documentId = ?').bind(docId).run();
  await c.env.DB.prepare('DELETE FROM document_permissions WHERE documentId = ?').bind(docId).run();
  await c.env.DB.prepare('DELETE FROM recent_documents WHERE documentId = ?').bind(docId).run();
  await c.env.DB.prepare('DELETE FROM document_history WHERE documentId = ?').bind(docId).run();

  return c.json({ message: 'Document deleted', action: 'deleted' });
});

app.post('/api/documents/:id/transfer', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');
  const { newOwnerUsername } = await c.req.json();

  if (!newOwnerUsername) {
    return c.json({ message: 'New owner username is required' }, 400);
  }

  const doc = await c.env.DB.prepare('SELECT owner FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  if (doc.owner !== user.id) {
    return c.json({ message: 'Access denied. Only the owner can transfer ownership.' }, 403);
  }

  const newOwner = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(newOwnerUsername.trim())
    .first();
  if (!newOwner) {
    return c.json({ message: 'User not found' }, 404);
  }

  if (newOwner.id === user.id) {
    return c.json({ message: 'You are already the owner of this document' }, 400);
  }

  // Transfer ownership
  await c.env.DB.prepare('UPDATE documents SET owner = ? WHERE id = ?')
    .bind(newOwner.id, docId)
    .run();

  // Add old owner to permissions so they retain editor access
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO document_permissions (documentId, userId, role) VALUES (?, ?, 'editor')"
  )
    .bind(docId, user.id)
    .run();

  // Remove new owner from permissions list
  await c.env.DB.prepare('DELETE FROM document_permissions WHERE documentId = ? AND userId = ?')
    .bind(docId, newOwner.id)
    .run();

  await logHistory(
    c.env.DB,
    docId,
    user.id,
    user.username,
    `Transferred ownership to ${newOwnerUsername}`
  );

  return c.json({ message: `Ownership transferred to ${newOwnerUsername}` });
});

app.get('/api/documents/:id/history', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');

  const doc = await c.env.DB.prepare('SELECT owner, isPublic FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  const isOwner = doc.owner === user.id;
  const permission = await c.env.DB.prepare(
    'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
  )
    .bind(docId, user.id)
    .first();

  if (!isOwner && !permission && doc.isPublic !== 1) {
    return c.json({ message: 'Access denied' }, 403);
  }

  const history = await c.env.DB.prepare(
    'SELECT id, documentId, userId, username, action, details, timestamp FROM document_history WHERE documentId = ? ORDER BY timestamp DESC LIMIT 50'
  )
    .bind(docId)
    .all();

  return c.json(history.results || []);
});

app.get('/api/documents/:id/info', authenticateUser, async (c) => {
  const user = c.get('user');
  const docId = c.req.param('id');

  const doc = await c.env.DB.prepare('SELECT owner, title, isPublic FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) return c.json({ message: 'Document not found' }, 404);

  const isOwner = doc.owner === user.id;
  const permission = await c.env.DB.prepare(
    'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
  )
    .bind(docId, user.id)
    .first();

  if (!isOwner && !permission && doc.isPublic !== 1) {
    return c.json({ message: 'Access denied' }, 403);
  }

  return c.json({
    title: doc.title,
    isOwner,
    isShared: permission && permission.role === 'editor',
  });
});

// -------------------------------------------------------------
// WebSocket Routing
// -------------------------------------------------------------
app.get('/ws/:id', (c) => {
  const docId = c.req.param('id');
  const id = c.env.DOCUMENT_SYNC_OBJECT.idFromName(docId);
  const stub = c.env.DOCUMENT_SYNC_OBJECT.get(id);
  return stub.fetch(c.req.raw);
});

export default app;
