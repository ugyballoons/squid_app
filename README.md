# Squid Set Lists

A small, mobile-first web app for harmonica players to keep a library of songs
and build printable set lists. For each song the app derives the **cross-harp
key** automatically (the perfect 4th of the song key — e.g. song in C → F harp,
A → D, Am → Dm).

## What it does

- **Song library** (SQLite, designed for a couple of hundred songs). The only
  required field is the title; key, artist, structure, tempo range, singer,
  approx length and notes are all optional.
- **Visual coding** on every song list (all songs *and* set order):
  - **Key** — a colour-coded chip; the card's left edge matches. Minor keys get
    an inset ring.
  - **Cross-harp key** — shown as a `harp X` badge.
  - **Structure** — a labelled badge (Twelve Bar, One Chord, …).
  - **Tempo range** — a pill with a coloured speed dot (blue slow → red v.fast).
  - **Singer** and **length** chips.
- **Filter** the song list by singer, key, structure and/or tempo band
  (combine freely; tap a chip again to clear it).
- **Who sings** — quick Ric / Eddy buttons, with a tucked-away “Other…” for the
  occasional extra singer name (those names then appear in the filter too).
- **Approx length** (whole minutes) — totals shown per section and for the
  whole set under the set-list plan (not on the printout).
- **Set lists** — create several named sets. Add songs with one tap, reorder by
  dragging the ⠿ grip or the ▲▼ buttons (touch-friendly), rename, **duplicate**
  (to base a new set on an existing one), and print.
- **Sections** — a set list can be split into named sections (e.g. *Set 1* /
  *Set 2*); each prints as its own separate list. Add a section and drag songs
  into it, rename it, or remove it (its songs fold back into another section).
- **Print** — a clean running order (number, song, key, cross-harp key) at
  `/print/<id>`, one table per section, with a Print button. Works from a phone.

No login: it's served on a shared URL for a small trusted group.

## Run it

```bash
pip install -r requirements.txt
python -m python.seed          # one-off: load python/seed.yaml into squid.db
python -m uvicorn python.main:app --reload
```

Then open http://127.0.0.1:8000 . In production the included `Procfile` runs it
under gunicorn/uvicorn workers.

## Layout

| File | Purpose |
|------|---------|
| `python/main.py`  | FastAPI app: JSON API + index + server-rendered print view |
| `python/harp.py`  | Cross-harp key derivation (4th up), major/minor aware |
| `python/db.py`    | SQLite schema and connection helper |
| `python/seed.py`  | Loads `seed.yaml` into the DB (only if empty) |
| `python/static/`  | `index.html`, `style.css`, `app.js` (the whole UI) |

The database lives at `python/squid.db` (git-ignored). Override the path with
the `SQUID_DB_PATH` env var.
