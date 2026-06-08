"""Squid — a small set-list app for harmonica players.

Pick songs, order them into named set lists, and print the running order with
the cross-harp key worked out automatically. Private use, mobile-first.

The backend is a thin JSON API over SQLite; the frontend is a single static
page (static/index.html) that does all the interaction. A separate /print
route renders a clean printable running order server-side.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from .db import db, init_db
from .harp import cross_harp_key, is_minor

HERE = os.path.dirname(__file__)
STATIC_DIR = os.path.join(HERE, "static")

app = FastAPI(title="Squid Set Lists")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    # On a fresh deploy the persistent disk is empty; load the starter songs so
    # the app isn't blank on first visit. seed() is a no-op once songs exist.
    try:
        from .seed import seed
        seed()
    except Exception as exc:  # never let seeding block startup
        print(f"[startup] seed skipped: {exc}")


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class SongIn(BaseModel):
    title: str
    artist: Optional[str] = None
    key: Optional[str] = None
    structure: Optional[str] = None
    tempo_min: Optional[int] = None
    tempo_max: Optional[int] = None
    singer: Optional[str] = None
    length_min: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("title")
    @classmethod
    def title_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Title is required")
        return v


class SetlistIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v


class OrderItem(BaseModel):
    song_id: int
    section: str = "Set 1"


class OrderIn(BaseModel):
    # Ordered items, each tagged with the section it belongs to. Sections print
    # as separate lists; their order follows first appearance in this list.
    items: list[OrderItem]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _song_dict(row) -> dict:
    d = dict(row)
    d["cross_harp"] = cross_harp_key(d.get("key"))
    d["is_minor"] = is_minor(d.get("key"))
    return d


# --------------------------------------------------------------------------- #
# Song endpoints
# --------------------------------------------------------------------------- #
@app.get("/api/songs")
def list_songs():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM songs ORDER BY title COLLATE NOCASE"
        ).fetchall()
    return [_song_dict(r) for r in rows]


@app.post("/api/songs", status_code=201)
def create_song(song: SongIn):
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO songs (title, artist, key, structure, tempo_min, tempo_max,
                                  singer, length_min, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (song.title, song.artist, song.key, song.structure,
             song.tempo_min, song.tempo_max, song.singer, song.length_min, song.notes),
        )
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _song_dict(row)


@app.put("/api/songs/{song_id}")
def update_song(song_id: int, song: SongIn):
    with db() as conn:
        exists = conn.execute("SELECT id FROM songs WHERE id = ?", (song_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Song not found")
        conn.execute(
            """UPDATE songs SET title=?, artist=?, key=?, structure=?,
               tempo_min=?, tempo_max=?, singer=?, length_min=?, notes=? WHERE id=?""",
            (song.title, song.artist, song.key, song.structure,
             song.tempo_min, song.tempo_max, song.singer, song.length_min,
             song.notes, song_id),
        )
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    return _song_dict(row)


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: int):
    with db() as conn:
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
    return None


@app.get("/api/singers")
def list_singers():
    """Distinct singer names already in use, for the filter and the (mostly
    hidden) custom-singer picker. Ric and Eddy are always offered first."""
    with db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT singer FROM songs WHERE singer IS NOT NULL AND singer != ''"
        ).fetchall()
    used = sorted({r["singer"] for r in rows}, key=str.lower)
    primary = ["Ric", "Eddy"]
    extra = [s for s in used if s not in primary]
    return {"primary": primary, "all": primary + extra}


# --------------------------------------------------------------------------- #
# Set list endpoints
# --------------------------------------------------------------------------- #
@app.get("/api/setlists")
def list_setlists():
    with db() as conn:
        rows = conn.execute(
            """SELECT s.*, COUNT(i.id) AS song_count
               FROM setlists s
               LEFT JOIN setlist_items i ON i.setlist_id = s.id
               GROUP BY s.id
               ORDER BY s.created_at DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/setlists", status_code=201)
def create_setlist(sl: SetlistIn):
    with db() as conn:
        cur = conn.execute("INSERT INTO setlists (name) VALUES (?)", (sl.name,))
        row = conn.execute("SELECT * FROM setlists WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


@app.get("/api/setlists/{setlist_id}")
def get_setlist(setlist_id: int):
    with db() as conn:
        sl = conn.execute("SELECT * FROM setlists WHERE id = ?", (setlist_id,)).fetchone()
        if not sl:
            raise HTTPException(404, "Set list not found")
        rows = conn.execute(
            """SELECT songs.*, setlist_items.position AS position,
                      setlist_items.section AS section
               FROM setlist_items
               JOIN songs ON songs.id = setlist_items.song_id
               WHERE setlist_items.setlist_id = ?
               ORDER BY setlist_items.position""",
            (setlist_id,),
        ).fetchall()

    songs = [_song_dict(r) for r in rows]
    # Group into sections, preserving first-appearance order.
    sections: list[dict] = []
    by_name: dict[str, dict] = {}
    for s in songs:
        name = s.get("section") or "Set 1"
        sec = by_name.get(name)
        if sec is None:
            sec = {"name": name, "songs": []}
            by_name[name] = sec
            sections.append(sec)
        sec["songs"].append(s)
    if not sections:
        sections = [{"name": "Set 1", "songs": []}]

    return {"id": sl["id"], "name": sl["name"], "songs": songs, "sections": sections}


@app.put("/api/setlists/{setlist_id}")
def rename_setlist(setlist_id: int, sl: SetlistIn):
    with db() as conn:
        conn.execute("UPDATE setlists SET name = ? WHERE id = ?", (sl.name, setlist_id))
        row = conn.execute("SELECT * FROM setlists WHERE id = ?", (setlist_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Set list not found")
    return dict(row)


@app.delete("/api/setlists/{setlist_id}", status_code=204)
def delete_setlist(setlist_id: int):
    with db() as conn:
        conn.execute("DELETE FROM setlists WHERE id = ?", (setlist_id,))
    return None


@app.put("/api/setlists/{setlist_id}/songs")
def set_setlist_songs(setlist_id: int, order: OrderIn):
    """Replace the set list's contents with the given ordered, sectioned items.

    The frontend always sends the full ordered list (after add/remove/reorder/
    re-section), so we just rebuild the rows. Simple and race-free for a tiny app.
    """
    with db() as conn:
        sl = conn.execute("SELECT id FROM setlists WHERE id = ?", (setlist_id,)).fetchone()
        if not sl:
            raise HTTPException(404, "Set list not found")
        conn.execute("DELETE FROM setlist_items WHERE setlist_id = ?", (setlist_id,))
        for pos, item in enumerate(order.items):
            conn.execute(
                """INSERT INTO setlist_items (setlist_id, song_id, section, position)
                   VALUES (?, ?, ?, ?)""",
                (setlist_id, item.song_id, item.section or "Set 1", pos),
            )
    return get_setlist(setlist_id)


@app.post("/api/setlists/{setlist_id}/duplicate", status_code=201)
def duplicate_setlist(setlist_id: int):
    """Copy a set list (name + all sectioned items) into a brand-new one."""
    with db() as conn:
        src = conn.execute("SELECT * FROM setlists WHERE id = ?", (setlist_id,)).fetchone()
        if not src:
            raise HTTPException(404, "Set list not found")
        cur = conn.execute(
            "INSERT INTO setlists (name) VALUES (?)", (f"{src['name']} (copy)",)
        )
        new_id = cur.lastrowid
        conn.execute(
            """INSERT INTO setlist_items (setlist_id, song_id, section, position)
               SELECT ?, song_id, section, position
               FROM setlist_items WHERE setlist_id = ?
               ORDER BY position""",
            (new_id, setlist_id),
        )
        row = conn.execute("SELECT * FROM setlists WHERE id = ?", (new_id,)).fetchone()
    return dict(row)


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/print/{setlist_id}", response_class=HTMLResponse)
def print_setlist(setlist_id: int):
    data = get_setlist(setlist_id)
    sections = [sec for sec in data["sections"] if sec["songs"]] or data["sections"]
    multi = len(sections) > 1

    blocks = []
    for sec in sections:
        rows = []
        for i, s in enumerate(sec["songs"], 1):
            harp = s["cross_harp"] or "—"
            key = s["key"] or "—"
            rows.append(
                f"<tr><td class='n'>{i}</td>"
                f"<td class='t'>{_esc(s['title'])}"
                + (f"<span class='ar'>{_esc(s['artist'])}</span>" if s.get('artist') else "")
                + f"</td><td class='k'>{_esc(key)}</td>"
                f"<td class='h'>{_esc(harp)}</td></tr>"
            )
        body = "\n".join(rows) or "<tr><td colspan='4' class='empty'>No songs in this section.</td></tr>"
        heading = f"<h2 class='section'>{_esc(sec['name'])}</h2>" if multi else ""
        blocks.append(
            heading
            + "<table><thead><tr><th>#</th><th>Song</th><th>Key</th><th>Harp</th></tr></thead>"
            + f"<tbody>{body}</tbody></table>"
        )

    return HTMLResponse(_PRINT_TEMPLATE.format(
        name=_esc(data["name"]), blocks="\n".join(blocks)))


def _esc(s) -> str:
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


_PRINT_TEMPLATE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{name} — Set List</title>
<style>
  body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; color:#111; margin:2rem; }}
  h1 {{ font-size:1.6rem; margin:0 0 .25rem; }}
  .sub {{ color:#666; margin:0 0 1.25rem; font-size:.9rem; }}
  table {{ width:100%; border-collapse:collapse; }}
  th {{ text-align:left; font-size:.75rem; text-transform:uppercase; letter-spacing:.05em;
        color:#888; border-bottom:2px solid #111; padding:.4rem .5rem; }}
  td {{ padding:.55rem .5rem; border-bottom:1px solid #ddd; vertical-align:baseline; }}
  td.n {{ width:2rem; color:#999; font-variant-numeric:tabular-nums; }}
  td.t {{ font-weight:600; }}
  td.t .ar {{ display:block; font-weight:400; color:#777; font-size:.85rem; }}
  td.k, td.h {{ width:5rem; font-variant-numeric:tabular-nums; }}
  td.h {{ font-weight:700; }}
  td.empty {{ color:#999; font-style:italic; }}
  h2.section {{ font-size:1.05rem; margin:1.5rem 0 .3rem; padding-top:.6rem;
        text-transform:uppercase; letter-spacing:.04em; color:#111;
        border-top:1px solid #ccc; }}
  table + h2.section {{ break-before:auto; }}
  .print-btn {{ margin-bottom:1rem; padding:.6rem 1rem; font-size:1rem; border:1px solid #111;
        background:#111; color:#fff; border-radius:8px; cursor:pointer; }}
  @media print {{ .print-btn {{ display:none; }} body {{ margin:0; }} }}
</style></head>
<body>
  <button class="print-btn" onclick="window.print()">Print</button>
  <h1>{name}</h1>
  <p class="sub">Harp column = cross-harp key (the 4th of the song key).</p>
  {blocks}
</body></html>"""


# Mount static assets last so API routes take precedence.
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
