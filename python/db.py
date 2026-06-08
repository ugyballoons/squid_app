"""SQLite data layer for the set-list app.

Single-file database, no ORM — at ~200 songs the schema is tiny and a few
hand-written queries are clearer than a dependency. Connections are opened per
request (SQLite is happy with that) with foreign keys and row dicts enabled.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "SQUID_DB_PATH",
    os.path.join(os.path.dirname(__file__), "squid.db"),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    artist      TEXT,
    key         TEXT,
    structure   TEXT,
    tempo_min   INTEGER,
    tempo_max   INTEGER,
    singer      TEXT,
    length_min  INTEGER,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- A setlist item belongs to a named section (default "Set 1"). Sections print
-- as separate lists. `position` orders items globally within the setlist; the
-- section grouping and order are derived from that ordering.
CREATE TABLE IF NOT EXISTS setlist_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    setlist_id  INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    section     TEXT NOT NULL DEFAULT 'Set 1',
    position    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_setlist ON setlist_items(setlist_id, position);
"""

# Columns added after the first release. Each entry is run as
# `ALTER TABLE ... ADD COLUMN ...` only if the column is missing, so existing
# databases pick up new fields without losing data.
_MIGRATIONS = {
    "songs": {
        "singer": "TEXT",
        "length_min": "INTEGER",
    },
    "setlist_items": {
        "section": "TEXT NOT NULL DEFAULT 'Set 1'",
    },
}


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _migrate(conn) -> None:
    for table, cols in _MIGRATIONS.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
