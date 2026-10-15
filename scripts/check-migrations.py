"""Check fresh schema and upgrade preservation in disposable in-memory databases."""
from pathlib import Path
import sqlite3

migrations = sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql"))
assert migrations, "No migration files found"


def database():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


fresh = database()
for migration in migrations:
    fresh.executescript(migration.read_text())
    print(f"Migration OK: {migration.name}")
assert fresh.execute("PRAGMA foreign_key_check").fetchall() == []

upgrade = database()
assert migrations[0].name == "0001_schema.sql", "Review the upgrade fixture when changing the baseline"
upgrade.executescript(migrations[0].read_text())
for user_id, verified in [("verified-user", 1), ("unverified-user", 0)]:
    upgrade.execute(
        "INSERT INTO users (id, username, email, password, isEmailVerified) VALUES (?, ?, ?, ?, ?)",
        (user_id, user_id, f"{user_id}@example.com", "synthetic-test-password-hash", verified),
    )
upgrade.execute("INSERT INTO sessions (id, userId, refreshToken) VALUES ('session', 'verified-user', 'synthetic-test-refresh')")
upgrade.execute("INSERT INTO documents (id, title, owner, yjsState) VALUES ('document', 'Preserve me', 'verified-user', 'synthetic-state')")
upgrade.execute("INSERT INTO document_pages (documentId, pageIndex, content) VALUES ('document', 0, 'preserved content')")
upgrade.execute("INSERT INTO document_permissions (documentId, userId, role) VALUES ('document', 'unverified-user', 'viewer')")
upgrade.execute("INSERT INTO recent_documents (userId, documentId) VALUES ('verified-user', 'document')")
upgrade.execute("INSERT INTO document_history (documentId, userId, action) VALUES ('document', 'verified-user', 'created')")
tables = ["sessions", "documents", "document_pages", "document_permissions", "recent_documents", "document_history"]
original = {table: upgrade.execute(f"SELECT * FROM {table}").fetchall() for table in tables}
identities = upgrade.execute("SELECT id, username, email, password FROM users ORDER BY id").fetchall()
for migration in migrations[1:]:
    upgrade.executescript(migration.read_text())
    if migration.name == "0002_email_verification_codes.sql":
        assert upgrade.execute("SELECT email_verified_at FROM users WHERE id = 'verified-user'").fetchone()[0] is not None
        assert upgrade.execute("SELECT email_verified_at FROM users WHERE id = 'unverified-user'").fetchone()[0] is None
        # Exercise both directions of the mirror repair in migration 0003.
        upgrade.execute("UPDATE users SET isEmailVerified = 0 WHERE id = 'verified-user'")
        upgrade.execute("UPDATE users SET isEmailVerified = 1 WHERE id = 'unverified-user'")
    assert upgrade.execute("PRAGMA foreign_key_check").fetchall() == []
    assert upgrade.execute("SELECT id, username, email, password FROM users ORDER BY id").fetchall() == identities
    for table in tables:
        assert upgrade.execute(f"SELECT * FROM {table}").fetchall() == original[table], f"Upgrade changed existing {table} data"
    print(f"Upgrade preservation OK: {migration.name}")
assert upgrade.execute("SELECT isEmailVerified FROM users WHERE id = 'verified-user'").fetchone() == (1,)
assert upgrade.execute("SELECT isEmailVerified FROM users WHERE id = 'unverified-user'").fetchone() == (0,)
print("Upgrade verification backfill and existing collaboration/session data preserved")
