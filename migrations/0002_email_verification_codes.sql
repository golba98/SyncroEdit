-- Add timestamp-based email verification state.
-- D1's SQLite runtime does not support ADD COLUMN IF NOT EXISTS. This migration
-- is safe for a fresh database and for normal D1 migration history. If a target
-- database was manually patched with this column before the migration runs,
-- mark this migration as applied or remove only this ALTER in that target.
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

-- Preserve access for accounts already verified by the legacy boolean column.
UPDATE users
SET email_verified_at = unixepoch()
WHERE email_verified_at IS NULL
  AND isEmailVerified = 1;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signup',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email
ON email_verification_codes(email);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires
ON email_verification_codes(expires_at);
