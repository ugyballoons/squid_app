"""Data layer for the set-list app — SQLite locally, Postgres in production.

The schema is tiny (a couple of hundred songs at most), so instead of an ORM
there's a thin wrapper that lets the rest of the app keep writing plain SQL with
``?`` placeholders and dict-style rows, regardless of backend.

Backend selection:
  * If ``DATABASE_URL`` is set (Render injects this for its Postgres add-on),
    Postgres is used.
  * Otherwise a local SQLite file is used (``SQUID_DB_PATH`` or ``squid.db``).
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL")
USE_PG = bool(DATABASE_URL)

DB_PATH = os.environ.get(
    "SQUID_DB_PATH",
    os.path.join(os.path.dirname(__file__), "squid.db"),
)

if USE_PG:
    import psycopg
    from psycopg.rows import dict_row

    # Render gives a "postgres://" URL; psycopg wants "postgresql://".
    _PG_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


# --------------------------------------------------------------------------- #
# Schema (portable). Backend-specific tokens are substituted in build_schema().
# --------------------------------------------------------------------------- #
_AUTO_PK = "{PK}"      # auto-increment primary key
_NOW = "{NOW}"         # default current timestamp

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS songs (
    id          {_AUTO_PK},
    title       TEXT NOT NULL,
    artist      TEXT,
    key         TEXT,
    structure   TEXT,
    tempo_min   INTEGER,
    tempo_max   INTEGER,
    singer      TEXT,
    length_min  INTEGER,
    notes       TEXT,
    created_at  TEXT DEFAULT {_NOW}
);

CREATE TABLE IF NOT EXISTS setlists (
    id          {_AUTO_PK},
    name        TEXT NOT NULL,
    created_at  TEXT DEFAULT {_NOW}
);

-- A setlist item belongs to a named section (default "Set 1"). Sections print
-- as separate lists. `position` orders items globally within the setlist; the
-- section grouping and order are derived from that ordering.
CREATE TABLE IF NOT EXISTS setlist_items (
    id          {_AUTO_PK},
    setlist_id  INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    section     TEXT NOT NULL DEFAULT 'Set 1',
    position    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_setlist ON setlist_items(setlist_id, position);
"""

# Columns added after the first release. Each is applied with
# `ALTER TABLE ... ADD COLUMN ...` only if missing, so existing databases pick
# up new fields without losing data.
_MIGRATIONS = {
    "songs": {
        "singer": "TEXT",
        "length_min": "INTEGER",
    },
    "setlist_items": {
        "section": "TEXT NOT NULL DEFAULT 'Set 1'",
    },
}


def build_schema() -> str:
    if USE_PG:
        return SCHEMA.replace(_AUTO_PK, "SERIAL PRIMARY KEY").replace(_NOW, "now()")
    return SCHEMA.replace(_AUTO_PK, "INTEGER PRIMARY KEY AUTOINCREMENT").replace(
        _NOW, "(datetime('now'))"
    )


# --------------------------------------------------------------------------- #
# Connection wrapper: uniform `.execute()` / `.insert()` across both backends.
# --------------------------------------------------------------------------- #
class _Result:
    """Wraps a DB cursor so callers get dict rows and simple iteration."""

    def __init__(self, cursor):
        self._cur = cursor

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur.fetchall())


class Conn:
    """Backend-agnostic connection. Use ``?`` placeholders everywhere."""

    def __init__(self, raw, is_pg: bool):
        self._raw = raw
        self._pg = is_pg

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self._pg else sql

    def execute(self, sql: str, params: tuple = ()) -> _Result:
        cur = self._raw.cursor()
        cur.execute(self._sql(sql), params)
        return _Result(cur)

    def insert(self, sql: str, params: tuple = ()) -> int:
        """Run an INSERT and return the new row id, for both backends."""
        cur = self._raw.cursor()
        if self._pg:
            cur.execute(self._sql(sql) + " RETURNING id", params)
            return cur.fetchone()["id"]
        cur.execute(self._sql(sql), params)
        return cur.lastrowid

    def columns(self, table: str) -> set:
        """Existing column names for `table` (used by migrations)."""
        if self._pg:
            rows = self.execute(
                "SELECT column_name AS name FROM information_schema.columns "
                "WHERE table_name = ?",
                (table,),
            ).fetchall()
            return {r["name"] for r in rows}
        rows = self._raw.execute(f"PRAGMA table_info({table})").fetchall()
        return {r["name"] for r in rows}

    def executescript(self, script: str) -> None:
        if self._pg:
            self._raw.cursor().execute(script)
        else:
            self._raw.executescript(script)

    def commit(self):
        self._raw.commit()

    def close(self):
        self._raw.close()


def get_conn() -> Conn:
    if USE_PG:
        raw = psycopg.connect(_PG_URL, row_factory=dict_row, autocommit=False)
        return Conn(raw, is_pg=True)
    raw = sqlite3.connect(DB_PATH)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    return Conn(raw, is_pg=False)


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _migrate(conn: Conn) -> None:
    for table, cols in _MIGRATIONS.items():
        existing = conn.columns(table)
        for col, decl in cols.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init_db() -> None:
    with db() as conn:
        conn.executescript(build_schema())
        _migrate(conn)
