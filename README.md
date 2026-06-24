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

Then open http://127.0.0.1:8000 .

## Deploy on cPanel shared hosting (Python App / Passenger)

This app runs on cPanel's **Setup Python App** (Phusion Passenger) with a MySQL
database — no Node, no separate server process.

1. **Create the MySQL database** in cPanel → *MySQL Databases*: a database, a
   user, and grant the user all privileges on it. Note the full names (cPanel
   prefixes them, e.g. `acct_squid` / `acct_dbuser`).
2. **Setup Python App** → create an app: pick a Python 3.x version, set the
   application root to this project, application URL to where it should serve,
   and startup file `passenger_wsgi.py` with application object `application`.
3. In that screen add an **environment variable** `DATABASE_URL` =
   `mysql://<dbuser>:<password>@localhost/<dbname>` (URL-encode any odd
   characters in the password). Setting it switches the app to MySQL; leaving it
   unset uses local SQLite.
4. Enter the app's virtualenv (the screen shows the `source …/bin/activate`
   command) and run `pip install -r requirements.txt`, then
   `python -m python.seed` once to load the starter songs. **Restart** the app.

In production the `passenger_wsgi.py` entry point wraps the FastAPI app for
Passenger's WSGI interface (`python/db.py` talks to MySQL via PyMySQL).

## Layout

| File | Purpose |
|------|---------|
| `python/main.py`  | FastAPI app: JSON API + index + server-rendered print view |
| `python/harp.py`  | Cross-harp key derivation (4th up), major/minor aware |
| `python/db.py`    | DB layer: SQLite locally, MySQL in production (PyMySQL) |
| `passenger_wsgi.py` | cPanel/Passenger WSGI entry point (wraps the ASGI app) |
| `python/seed.py`  | Loads `seed.yaml` into the DB (only if empty) |
| `python/static/`  | `index.html`, `style.css`, `app.js` (the whole UI) |

The database lives at `python/squid.db` (git-ignored). Override the path with
the `SQUID_DB_PATH` env var.
