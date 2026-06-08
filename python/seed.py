"""Load python/seed.yaml into the SQLite database (idempotent-ish: only seeds
when the songs table is empty so it won't duplicate on every run).

Run from the project root:  python -m python.seed
"""

from __future__ import annotations

import os

import yaml

from .db import db, init_db


def seed() -> None:
    init_db()
    path = os.path.join(os.path.dirname(__file__), "seed.yaml")
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    songs = data.get("songs", [])

    with db() as conn:
        existing = conn.execute("SELECT COUNT(*) AS n FROM songs").fetchone()["n"]
        if existing:
            print(f"Songs table already has {existing} rows; skipping seed.")
            return
        for s in songs:
            tempo = s.get("tempo_range") or [None, None]
            tmin = tempo[0] if len(tempo) > 0 else None
            tmax = tempo[1] if len(tempo) > 1 else None
            conn.execute(
                """INSERT INTO songs (title, artist, key, structure, tempo_min, tempo_max)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (s.get("title"), s.get("artist"), s.get("key"),
                 s.get("structure"), tmin, tmax),
            )
        print(f"Seeded {len(songs)} songs.")


if __name__ == "__main__":
    seed()
