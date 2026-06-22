export class MockD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.documents = [];
    this.document_pages = [];
    this.document_permissions = [];
    this.recent_documents = [];
    this.document_history = [];
    this.email_verification_codes = [];
  }

  prepare(sql) {
    const self = this;
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    return {
      bind(...args) {
        return {
          async first() {
            return self.execute(cleanSql, args, true);
          },
          async all() {
            const results = self.execute(cleanSql, args, false);
            return { results };
          },
          async run() {
            self.execute(cleanSql, args, false);
            return { success: true };
          },
        };
      },
      async first() {
        return self.execute(cleanSql, [], true);
      },
      async all() {
        const results = self.execute(cleanSql, [], false);
        return { results };
      },
      async run() {
        self.execute(cleanSql, [], false);
        return { success: true };
      },
    };
  }

  execute(sql, args, firstOnly) {
    // 1. SELECT id FROM users WHERE username = ? OR email = ?
    if (sql.includes('SELECT id FROM users WHERE username = ? OR email = ?')) {
      const [username, email] = args;
      const found = this.users.find((u) => u.username === username || u.email === email);
      return firstOnly ? found : found ? [found] : [];
    }

    // 2. INSERT INTO users
    if (
      sql.includes(
        'INSERT INTO users (id, username, email, password, isEmailVerified, email_verified_at) VALUES (?, ?, ?, ?, 0, NULL)'
      )
    ) {
      const [id, username, email, password] = args;
      const user = {
        id,
        username,
        email,
        password,
        isEmailVerified: 0,
        email_verified_at: null,
        profilePicture: '',
        accentColor: '#8b5cf6',
        bio: '',
        showOnlineStatus: 1,
        createdAt: new Date().toISOString(),
      };
      this.users.push(user);
      return user;
    }

    // 3. SELECT login user
    if (
      sql.includes(
        'SELECT id, username, email, password, email_verified_at FROM users WHERE username = ?'
      ) ||
      sql.includes('SELECT id, username, email, password FROM users WHERE username = ?')
    ) {
      const [username] = args;
      const found = this.users.find((u) => u.username === username);
      return firstOnly ? found : found ? [found] : [];
    }

    // 4. SELECT id FROM users WHERE username = ?
    if (sql.includes('SELECT id FROM users WHERE username = ?')) {
      const [username] = args;
      const found = this.users.find((u) => u.username === username);
      return firstOnly ? found : found ? [found] : [];
    }

    // 5. SELECT username, email, email_verified_at FROM users WHERE id = ?
    if (sql.includes('SELECT username, email, email_verified_at FROM users WHERE id = ?')) {
      const [id] = args;
      const found = this.users.find((u) => u.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    if (sql.includes('SELECT username, email FROM users WHERE id = ?')) {
      const [id] = args;
      const found = this.users.find((u) => u.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    if (sql.includes('SELECT id, username, email, email_verified_at FROM users WHERE id = ?')) {
      const [id] = args;
      const found = this.users.find((u) => u.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    // 6. SELECT id FROM sessions WHERE id = ?
    if (sql.includes('SELECT id FROM sessions WHERE id = ?')) {
      const [id] = args;
      const found = this.sessions.find((s) => s.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    // 7. INSERT INTO sessions (id, userId, refreshToken, userAgent, ipAddress, lastActive) VALUES (?, ?, ?, ?, ?, datetime('now'))
    if (
      sql.includes(
        'INSERT INTO sessions (id, userId, refreshToken, userAgent, ipAddress, lastActive)'
      )
    ) {
      const [id, userId, refreshToken, userAgent, ipAddress] = args;
      const session = {
        id,
        userId,
        refreshToken,
        userAgent,
        ipAddress,
        lastActive: new Date().toISOString(),
      };
      this.sessions.push(session);
      return session;
    }

    // 8. SELECT id FROM sessions WHERE userId = ?
    if (sql.includes('SELECT id FROM sessions WHERE userId = ? ORDER BY lastActive ASC')) {
      const [userId] = args;
      const filtered = this.sessions.filter((s) => s.userId === userId);
      return { results: filtered };
    }

    // 9. DELETE FROM sessions WHERE id = ?
    if (sql.includes('DELETE FROM sessions WHERE id = ?') && !sql.includes('userId')) {
      const [id] = args;
      this.sessions = this.sessions.filter((s) => s.id !== id);
      return { success: true };
    }

    if (sql.includes('SELECT password FROM users WHERE id = ?')) {
      const [id] = args;
      const found = this.users.find((u) => u.id === id);
      const result = found ? { password: found.password } : null;
      return firstOnly ? result : result ? [result] : [];
    }

    // 10. UPDATE sessions SET lastActive = datetime('now') WHERE id = ?
    if (sql.includes("UPDATE sessions SET lastActive = datetime('now') WHERE id = ?")) {
      const [id] = args;
      const sess = this.sessions.find((s) => s.id === id);
      if (sess) sess.lastActive = new Date().toISOString();
      return { success: true };
    }

    // 11. SELECT profile
    if (
      sql.includes('SELECT id, username, email, profilePicture, accentColor, bio, showOnlineStatus')
    ) {
      const [id] = args;
      const found = this.users.find((u) => u.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    if (
      sql.includes(
        'SELECT COUNT(*) as count FROM email_verification_codes WHERE email = ? AND purpose = ?'
      )
    ) {
      const [email, purpose, createdAfter] = args;
      const count = this.email_verification_codes.filter(
        (code) =>
          code.email === email &&
          code.purpose === purpose &&
          code.consumed_at === null &&
          code.created_at >= createdAfter
      ).length;
      return { count };
    }

    if (sql.includes('INSERT INTO email_verification_codes')) {
      const [id, email, code_hash, purpose, expires_at, created_at] = args;
      const row = {
        id,
        email,
        code_hash,
        purpose,
        attempts: 0,
        expires_at,
        consumed_at: null,
        created_at,
      };
      this.email_verification_codes.push(row);
      return row;
    }

    if (sql.includes('DELETE FROM email_verification_codes WHERE id = ? AND consumed_at IS NULL')) {
      const [id] = args;
      this.email_verification_codes = this.email_verification_codes.filter(
        (code) => code.id !== id || code.consumed_at !== null
      );
      return { success: true };
    }

    if (
      sql.includes('FROM email_verification_codes') &&
      sql.includes('ORDER BY created_at DESC') &&
      sql.includes('LIMIT 1')
    ) {
      const [email, purpose] = args;
      const rows = this.email_verification_codes
        .filter(
          (code) => code.email === email && code.purpose === purpose && code.consumed_at === null
        )
        .sort((a, b) => b.created_at - a.created_at);
      return firstOnly ? rows[0] || null : rows;
    }

    if (sql.includes('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?')) {
      const [id] = args;
      const row = this.email_verification_codes.find((code) => code.id === id);
      if (row) row.attempts += 1;
      return { success: true };
    }

    if (sql.includes('UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?')) {
      const [consumedAt, id] = args;
      const row = this.email_verification_codes.find((code) => code.id === id);
      if (row) row.consumed_at = consumedAt;
      return { success: true };
    }

    if (
      sql.includes('UPDATE users SET email_verified_at = ?, isEmailVerified = 1 WHERE email = ?')
    ) {
      const [verifiedAt, email] = args;
      const user = this.users.find((u) => u.email === email);
      if (user) {
        user.email_verified_at = verifiedAt;
        user.isEmailVerified = 1;
      }
      return { success: true };
    }

    // 12. UPDATE users SET ... WHERE id = ?
    if (sql.includes('UPDATE users SET')) {
      const id = args[args.length - 1];
      const user = this.users.find((u) => u.id === id);
      if (user) {
        // Mock update
        if (sql.includes('profilePicture = ?')) user.profilePicture = args[0];
        if (sql.includes('accentColor = ?')) user.accentColor = args[0];
        if (sql.includes('bio = ?')) user.bio = args[0];
        if (sql.includes('showOnlineStatus = ?')) user.showOnlineStatus = args[0];
        if (sql.includes('password = ?')) user.password = args[0];
        if (sql.includes('email_verified_at = ?')) {
          user.email_verified_at = args[0];
          user.isEmailVerified = 1;
        }
      }
      return { success: true };
    }

    // 13. SELECT id as sessionId, userAgent, ipAddress, lastActive FROM sessions WHERE userId = ?
    if (
      sql.includes(
        'SELECT id as sessionId, userAgent, ipAddress, lastActive FROM sessions WHERE userId = ?'
      )
    ) {
      const [userId] = args;
      const filtered = this.sessions
        .filter((s) => s.userId === userId)
        .map((s) => ({
          sessionId: s.id,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          lastActive: s.lastActive,
        }));
      return firstOnly ? filtered[0] : filtered;
    }

    // 14. DELETE FROM sessions WHERE id = ? AND userId = ?
    if (sql.includes('DELETE FROM sessions WHERE id = ? AND userId = ?')) {
      const [id, userId] = args;
      this.sessions = this.sessions.filter((s) => !(s.id === id && s.userId === userId));
      return { success: true };
    }

    // 15. DELETE FROM sessions WHERE userId = ? AND id != ?
    if (sql.includes('DELETE FROM sessions WHERE userId = ? AND id != ?')) {
      const [userId, sessionId] = args;
      this.sessions = this.sessions.filter((s) => s.userId !== userId || s.id === sessionId);
      return { success: true };
    }

    // 16. COUNT(d.id)
    if (sql.includes('SELECT COUNT(d.id) as count')) {
      const [userId] = args;
      // Filter count
      const count = this.documents.filter(
        (d) =>
          d.owner === userId ||
          this.document_permissions.some((p) => p.documentId === d.id && p.userId === userId)
      ).length;
      return { count };
    }

    // 17. SELECT d.id, d.title, d.owner, d.lastModified, d.lastModifiedBy
    if (
      sql.includes(
        'SELECT d.id, d.title, d.owner, d.lastModified, d.lastModifiedBy, u.username as ownerUsername'
      )
    ) {
      const [userId] = args;
      const docs = this.documents.filter(
        (d) =>
          d.owner === userId ||
          this.document_permissions.some((p) => p.documentId === d.id && p.userId === userId)
      );
      const results = docs.map((d) => {
        const ownerUser = this.users.find((u) => u.id === d.owner);
        const lmUser = this.users.find((u) => u.id === d.lastModifiedBy);
        return {
          id: d.id,
          title: d.title,
          owner: d.owner,
          lastModified: d.lastModified,
          lastModifiedBy: d.lastModifiedBy,
          ownerUsername: ownerUser ? ownerUser.username : 'Owner',
          lastModifiedByUsername: lmUser ? lmUser.username : 'User',
        };
      });
      return firstOnly ? results[0] : results;
    }

    // 18. INSERT INTO documents (id, title, owner, lastModifiedBy) VALUES (?, ?, ?, ?)
    if (
      sql.includes('INSERT INTO documents (id, title, owner, lastModifiedBy) VALUES (?, ?, ?, ?)')
    ) {
      const [id, title, owner, lastModifiedBy] = args;
      const doc = {
        id,
        title,
        owner,
        lastModifiedBy,
        isPublic: 0,
        lastModified: new Date().toISOString(),
        yjsState: '',
      };
      this.documents.push(doc);
      return doc;
    }

    // 19. INSERT INTO document_pages
    if (
      sql.includes('INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)')
    ) {
      const [documentId, content] = args;
      const page = { documentId, pageIndex: 0, content };
      this.document_pages.push(page);
      return page;
    }

    // 20. INSERT INTO recent_documents
    if (
      sql.includes('INSERT INTO recent_documents (userId, documentId)') ||
      sql.includes('INSERT OR REPLACE INTO recent_documents')
    ) {
      const [userId, documentId] = args;
      this.recent_documents = this.recent_documents.filter(
        (r) => !(r.userId === userId && r.documentId === documentId)
      );
      this.recent_documents.push({
        userId,
        documentId,
        accessedAt: new Date().toISOString(),
      });
      return { success: true };
    }

    // 21. SELECT owner, isPublic FROM documents WHERE id = ?
    if (
      sql.includes('SELECT owner, isPublic FROM documents WHERE id = ?') ||
      sql.includes('SELECT owner, title, isPublic FROM documents WHERE id = ?') ||
      sql.includes('SELECT owner FROM documents WHERE id = ?')
    ) {
      const [id] = args;
      const found = this.documents.find((d) => d.id === id);
      return firstOnly ? found : found ? [found] : [];
    }

    // 22. SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?
    if (sql.includes('SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?')) {
      const [documentId, userId] = args;
      const found = this.document_permissions.find(
        (p) => p.documentId === documentId && p.userId === userId
      );
      return firstOnly ? found : found ? [found] : [];
    }

    // 23. UPDATE documents SET isPublic = ? WHERE id = ?
    if (sql.includes('UPDATE documents SET isPublic = ? WHERE id = ?')) {
      const [isPublic, id] = args;
      const doc = this.documents.find((d) => d.id === id);
      if (doc) doc.isPublic = isPublic;
      return { success: true };
    }

    // 24. DELETE FROM documents WHERE id = ?
    if (sql.includes('DELETE FROM documents WHERE id = ?')) {
      const [id] = args;
      this.documents = this.documents.filter((d) => d.id !== id);
      return { success: true };
    }

    // 25. DELETE FROM document_pages WHERE documentId = ?
    if (sql.includes('DELETE FROM document_pages WHERE documentId = ?')) {
      const [documentId] = args;
      this.document_pages = this.document_pages.filter((p) => p.documentId !== documentId);
      return { success: true };
    }

    // 26. DELETE FROM document_permissions WHERE documentId = ?
    if (sql.includes('DELETE FROM document_permissions WHERE documentId = ?')) {
      const [documentId] = args;
      this.document_permissions = this.document_permissions.filter(
        (p) => p.documentId !== documentId
      );
      return { success: true };
    }

    // 27. DELETE FROM recent_documents WHERE documentId = ?
    if (sql.includes('DELETE FROM recent_documents WHERE documentId = ?')) {
      const [documentId] = args;
      this.recent_documents = this.recent_documents.filter((r) => r.documentId !== documentId);
      return { success: true };
    }

    // 28. DELETE FROM document_history WHERE documentId = ?
    if (sql.includes('DELETE FROM document_history WHERE documentId = ?')) {
      const [documentId] = args;
      this.document_history = this.document_history.filter((h) => h.documentId !== documentId);
      return { success: true };
    }

    // 29. UPDATE documents SET owner = ? WHERE id = ?
    if (sql.includes('UPDATE documents SET owner = ? WHERE id = ?')) {
      const [owner, id] = args;
      const doc = this.documents.find((d) => d.id === id);
      if (doc) doc.owner = owner;
      return { success: true };
    }

    // 30. INSERT OR REPLACE INTO document_permissions (documentId, userId, role) VALUES (?, ?, 'editor')
    if (sql.includes('INSERT OR REPLACE INTO document_permissions (documentId, userId, role)')) {
      const [documentId, userId, role] = args;
      this.document_permissions = this.document_permissions.filter(
        (p) => !(p.documentId === documentId && p.userId === userId)
      );
      this.document_permissions.push({
        documentId,
        userId,
        role: role || 'editor',
      });
      return { success: true };
    }

    // 31. DELETE FROM document_permissions WHERE documentId = ? AND userId = ?
    if (sql.includes('DELETE FROM document_permissions WHERE documentId = ? AND userId = ?')) {
      const [documentId, userId] = args;
      this.document_permissions = this.document_permissions.filter(
        (p) => !(p.documentId === documentId && p.userId === userId)
      );
      return { success: true };
    }

    // 32. SELECT id, documentId, userId, username, action, details, timestamp FROM document_history
    if (
      sql.includes(
        'SELECT id, documentId, userId, username, action, details, timestamp FROM document_history WHERE documentId = ?'
      )
    ) {
      const [documentId] = args;
      const filtered = this.document_history.filter((h) => h.documentId === documentId);
      return firstOnly ? filtered[0] : filtered;
    }

    // 33. INSERT INTO document_history (documentId, userId, username, action, details) VALUES (?, ?, ?, ?, ?)
    if (
      sql.includes('INSERT INTO document_history (documentId, userId, username, action, details)')
    ) {
      const [documentId, userId, username, action, details] = args;
      const entry = {
        id: Math.random(),
        documentId,
        userId,
        username,
        action,
        details,
        timestamp: new Date().toISOString(),
      };
      this.document_history.push(entry);
      return entry;
    }

    if (sql.includes('SELECT yjsState FROM documents WHERE id = ?')) {
      const [id] = args;
      const found = this.documents.find((d) => d.id === id);
      const result = found ? { yjsState: found.yjsState || '' } : null;
      return firstOnly ? result : result ? [result] : [];
    }

    if (sql.includes('UPDATE documents SET yjsState = ?, title = ?, lastModified = datetime')) {
      const [yjsState, title, id] = args;
      const doc = this.documents.find((d) => d.id === id);
      if (doc) {
        doc.yjsState = yjsState;
        doc.title = title;
        doc.lastModified = new Date().toISOString();
      }
      return { success: true };
    }

    if (sql.includes('UPDATE documents SET lastModified = datetime')) {
      const id = args[args.length - 1];
      const doc = this.documents.find((d) => d.id === id);
      if (doc) {
        doc.lastModified = new Date().toISOString();
        doc.lastModifiedBy = args[0];
        if (sql.includes('title = ?')) {
          doc.title = args[1];
        }
      }
      return { success: true };
    }

    if (sql.includes('DELETE FROM recent_documents WHERE userId = ? AND documentId = ?')) {
      const [userId, documentId] = args;
      this.recent_documents = this.recent_documents.filter(
        (r) => !(r.userId === userId && r.documentId === documentId)
      );
      return { success: true };
    }

    if (sql.includes('SELECT documentId FROM recent_documents WHERE userId = ?')) {
      const [userId] = args;
      const filtered = this.recent_documents.filter((r) => r.userId === userId);
      return firstOnly ? filtered[0] : filtered;
    }

    if (sql.includes('DELETE FROM recent_documents WHERE userId = ? AND accessedAt < ?')) {
      const [userId, accessedAt] = args;
      this.recent_documents = this.recent_documents.filter(
        (r) => r.userId !== userId || r.accessedAt >= accessedAt
      );
      return { success: true };
    }

    // Default fallback
    return firstOnly ? null : [];
  }
}
