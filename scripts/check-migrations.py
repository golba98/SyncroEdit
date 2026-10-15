"""Validate the real migration SQL against a fresh, in-memory SQLite database."""
from pathlib import Path
import sqlite3

database = sqlite3.connect(":memory:")
database.execute("PRAGMA foreign_keys = ON")
for migration in sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql")):
    database.executescript(migration.read_text())
    print(f"Migration OK: {migration.name}")
assert database.execute("PRAGMA foreign_key_check").fetchall() == []
