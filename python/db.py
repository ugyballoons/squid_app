"""Data layer for the set-list app — SQLite locally, MySQL in production.

The schema is tiny (a couple of hundred songs at most), so instead of an ORM
there's a thin wrapper that lets the rest of the app keep writing plain SQL with
``?`` placeholders and dict-style rows, regardless of backend.

Backend selection:
  * If ``DATABASE_URL`` is set, MySQL is used. The URL may be a SQLAlchemy-style
    DSN (``mysql://user:pass@host[:port]/dbname``) — the scheme is ignored, only
    the credentials matter. On shared cPanel hosts you typically build this from
    the database name/user/password shown in the MySQL Databases panel.
  * Otherwise a local SQLite file is used (``SQUID_DB_PATH`` or ``squid.db``).

The MySQL driver is PyMySQL — pure Python, so it installs without a compiler on
shared hosting.
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from urllib.parse import unquote, urlparse

# Matches the `key` column as a standalone identifier (not already backticked,
# not part of a longer word). Used to quote it for MySQL where KEY is reserved.
_KEY_WORD = re.compile(r"(?<![`\w])key(?![`\w])", re.IGNORECASE)

DATABASE_URL = os.environ.get("DATABASE_URL")
USE_MYSQL = bool(DATABASE_URL)

DB_PATH = os.environ.get(
    "SQUID_DB_PATH",
    os.path.join(os.path.dirname(__file__), "squid.db"),
)

if USE_MYSQL:
    import pymysql
    from pymysql.cursors import DictCursor

    def _parse_mysql_url(url: str) -> dict:
        """Turn a ``mysql://user:pass@host:port/dbname`` URL into connect kwargs.

        The scheme is ignored, so ``mysql://``, ``mysql+pymysql://`` and even a
        bare ``//user:...`` all work. Credentials are URL-decoded so passwords
        with special characters survive.
        """
        p = urlparse(url)
        return {
            "host": p.hostname or "localhost",
            "port": p.port or 3306,
            "user": unquote(p.username) if p.username else None,
            "password": unquote(p.password) if p.password else "",
            "database": p.path.lstrip("/") or None,
        }

    _MYSQL_KWARGS = _parse_mysql_url(DATABASE_URL)


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

# MySQL needs its own schema rather than token substitution: inline column-level
# REFERENCES are silently ignored (so FKs/cascades wouldn't work), TEXT columns
# can't take a CURRENT_TIMESTAMP default, and older MySQL/MariaDB (common on
# shared hosts) rejects `CREATE INDEX ... IF NOT EXISTS`. The index is therefore
# declared inline in the table, and the cascade FKs are table-level so the app's
# reliance on ON DELETE CASCADE (deleting a song/setlist clears setlist_items)
# actually holds.
SCHEMA_MYSQL = """
CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    artist      TEXT,
    `key`       TEXT,
    structure   TEXT,
    tempo_min   INTEGER,
    tempo_max   INTEGER,
    singer      TEXT,
    length_min  INTEGER,
    notes       TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS setlists (
    id          INTEGER AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS setlist_items (
    id          INTEGER AUTO_INCREMENT PRIMARY KEY,
    setlist_id  INTEGER NOT NULL,
    song_id     INTEGER NOT NULL,
    section     VARCHAR(255) NOT NULL DEFAULT 'Set 1',
    position    INTEGER NOT NULL,
    INDEX idx_items_setlist (setlist_id, position),
    CONSTRAINT fk_items_setlist FOREIGN KEY (setlist_id)
        REFERENCES setlists(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_song FOREIGN KEY (song_id)
        REFERENCES songs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
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
    if USE_MYSQL:
        return SCHEMA_MYSQL
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

    def __init__(self, raw, is_mysql: bool):
        self._raw = raw
        self._mysql = is_mysql

    def _sql(self, sql: str) -> str:
        if not self._mysql:
            return sql
        # MySQL: `?` placeholders -> `%s`, and the `key` column is a reserved
        # word so it must be backtick-quoted wherever the app references it
        # bare (it never appears as a substring of another identifier here).
        return _KEY_WORD.sub("`key`", sql).replace("?", "%s")

    def execute(self, sql: str, params: tuple = ()) -> _Result:
        cur = self._raw.cursor()
        cur.execute(self._sql(sql), params)
        return _Result(cur)

    def insert(self, sql: str, params: tuple = ()) -> int:
        """Run an INSERT and return the new row id, for both backends."""
        cur = self._raw.cursor()
        cur.execute(self._sql(sql), params)
        return cur.lastrowid

    def columns(self, table: str) -> set:
        """Existing column names for `table` (used by migrations)."""
        if self._mysql:
            rows = self.execute(
                "SELECT column_name AS name FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = ?",
                (table,),
            ).fetchall()
            return {r["name"] for r in rows}
        rows = self._raw.execute(f"PRAGMA table_info({table})").fetchall()
        return {r["name"] for r in rows}

    def executescript(self, script: str) -> None:
        if self._mysql:
            # PyMySQL runs one statement per execute(); split the schema on ';'.
            cur = self._raw.cursor()
            for stmt in script.split(";"):
                if stmt.strip():
                    cur.execute(stmt)
        else:
            self._raw.executescript(script)

    def commit(self):
        self._raw.commit()

    def close(self):
        self._raw.close()


def get_conn() -> Conn:
    if USE_MYSQL:
        raw = pymysql.connect(
            cursorclass=DictCursor,
            autocommit=False,
            charset="utf8mb4",
            **_MYSQL_KWARGS,
        )
        return Conn(raw, is_mysql=True)
    raw = sqlite3.connect(DB_PATH)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    return Conn(raw, is_mysql=False)


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
