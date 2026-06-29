-- Keep the legacy boolean mirror aligned with the canonical timestamp state.
UPDATE users
SET isEmailVerified = 1
WHERE email_verified_at IS NOT NULL;

UPDATE users
SET isEmailVerified = 0
WHERE email_verified_at IS NULL;
