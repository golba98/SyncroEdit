-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  profilePicture TEXT DEFAULT '',
  accentColor TEXT DEFAULT '#8b5cf6',
  bio TEXT DEFAULT '',
  showOnlineStatus INTEGER DEFAULT 1,
  isEmailVerified INTEGER DEFAULT 0,
  verificationCode TEXT,
  verificationCodeExpires TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  passwordResetToken TEXT,
  passwordResetExpires TEXT,
  loginAttempts INTEGER DEFAULT 0,
  lockUntil TEXT,
  mfaEnabled INTEGER DEFAULT 0,
  mfaSecret TEXT
);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  userAgent TEXT,
  ipAddress TEXT,
  lastActive TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT 'Untitled document',
  owner TEXT NOT NULL,
  isPublic INTEGER DEFAULT 0,
  lastModified TEXT DEFAULT CURRENT_TIMESTAMP,
  lastModifiedBy TEXT,
  yjsState TEXT, -- Base64 encoded state update
  FOREIGN KEY (owner) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (lastModifiedBy) REFERENCES users (id) ON DELETE SET NULL
);

-- Create document_pages table (to represent pages array)
CREATE TABLE IF NOT EXISTS document_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documentId TEXT NOT NULL,
  pageIndex INTEGER NOT NULL,
  content TEXT DEFAULT '',
  FOREIGN KEY (documentId) REFERENCES documents (id) ON DELETE CASCADE
);

-- Create document_permissions table for sharedWith / viewers
CREATE TABLE IF NOT EXISTS document_permissions (
  documentId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL, -- 'editor' (sharedWith) or 'viewer' (viewers)
  PRIMARY KEY (documentId, userId),
  FOREIGN KEY (documentId) REFERENCES documents (id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

-- Create recent_documents table
CREATE TABLE IF NOT EXISTS recent_documents (
  userId TEXT NOT NULL,
  documentId TEXT NOT NULL,
  accessedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId, documentId),
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (documentId) REFERENCES documents (id) ON DELETE CASCADE
);

-- Create document_history table
CREATE TABLE IF NOT EXISTS document_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documentId TEXT NOT NULL,
  userId TEXT,
  username TEXT DEFAULT 'Anonymous',
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (documentId) REFERENCES documents (id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL
);
