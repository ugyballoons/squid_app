/* Squid Set Lists — client app.
 * Plain JS, no framework. Talks to the /api JSON endpoints in main.py.
 */
'use strict';

// ---- Visual encoding ---------------------------------------------------- //

// 12 pitch classes around the circle, each with a distinct hue. Index by the
// chromatic position (C=0 .. B=11). Chosen for good separation on a phone.
const KEY_COLORS = {
  'C':  '#ff6b6b', 'C#': '#ff9f43', 'D':  '#feca57', 'D#': '#c8e65c',
  'E':  '#1dd1a1', 'F':  '#2ed5d0', 'F#': '#54a0ff', 'G':  '#5f7bff',
  'G#': '#a55eea', 'A':  '#e26bd6', 'A#': '#ff7eb3', 'B':  '#ff8a8a',
};
// Flat spellings map onto the sharp swatch colours.
const FLAT_ALIAS = { 'DB':'C#','EB':'D#','GB':'F#','AB':'G#','BB':'A#' };

function pitchOf(key) {
  if (!key) return null;
  let k = key.trim();
  if (!k) return null;
  let m = k.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  let p = m[1].toUpperCase() + (m[2] === 'b' ? 'b' : m[2]);
  let up = p.toUpperCase();
  if (FLAT_ALIAS[up]) return FLAT_ALIAS[up];
  // normalise single letter / sharp
  return p.replace('b', '').toUpperCase() === up.replace('B','') ? p.toUpperCase() : p;
}

function keyColor(key) {
  const p = pitchOf(key);
  return (p && KEY_COLORS[p]) || '#6b7280';
}

// Tempo -> speed band. Uses the midpoint of the range.
function tempoBand(min, max) {
  const vals = [min, max].filter(v => v != null);
  if (!vals.length) return null;
  const bpm = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (bpm < 80)  return { cls: 'spd-slow',     label: 'Slow' };
  if (bpm < 110) return { cls: 'spd-medium',   label: 'Medium' };
  if (bpm < 140) return { cls: 'spd-fast',     label: 'Fast' };
  return { cls: 'spd-veryfast', label: 'V.Fast' };
}

function structLabel(s) {
  if (!s) return null;
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Total minutes -> "h:mm" or "m min" for display.
function fmtMinutes(total) {
  total = Math.round(total || 0);
  if (total <= 0) return '0 min';
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

const TEMPO_BANDS = [
  { value: 'spd-slow', label: 'Slow' },
  { value: 'spd-medium', label: 'Medium' },
  { value: 'spd-fast', label: 'Fast' },
  { value: 'spd-veryfast', label: 'V.Fast' },
];

// ---- API ---------------------------------------------------------------- //
const API = {
  async get(u) { const r = await fetch(u); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async send(method, u, body) {
    const r = await fetch(u, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.status === 204 ? null : r.json();
  },
  songs: () => API.get('/api/songs'),
  createSong: (s) => API.send('POST', '/api/songs', s),
  updateSong: (id, s) => API.send('PUT', `/api/songs/${id}`, s),
  deleteSong: (id) => API.send('DELETE', `/api/songs/${id}`),
  singers: () => API.get('/api/singers'),
  setlists: () => API.get('/api/setlists'),
  createSetlist: (name) => API.send('POST', '/api/setlists', { name }),
  getSetlist: (id) => API.get(`/api/setlists/${id}`),
  renameSetlist: (id, name) => API.send('PUT', `/api/setlists/${id}`, { name }),
  deleteSetlist: (id) => API.send('DELETE', `/api/setlists/${id}`),
  duplicateSetlist: (id) => API.send('POST', `/api/setlists/${id}/duplicate`),
  // items: [{song_id, section}]
  setItems: (id, items) => API.send('PUT', `/api/setlists/${id}/songs`, { items }),
};

// ---- State -------------------------------------------------------------- //
// Lightweight per-device session memory: remembers the last view and set list
// across page refreshes via localStorage. Best-effort — never throws.
const Session = {
  KEY: 'squid.session',
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  save(patch) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ ...this.load(), ...patch })); }
    catch { /* storage unavailable (private mode etc.) — ignore */ }
  },
};
const _session = Session.load();

// ---- Undo/redo for set-list ordering ------------------------------------ //
// History is per set list and lives only for the session (in memory). A
// snapshot is the ordered list of {song_id, section}; we compare/restore by
// that shape so it's independent of the live song objects.
const History = {
  setlistId: null,
  undo: [],
  redo: [],
  MAX: 50,

  // Point history at a set list, clearing any history from a different one.
  use(id) {
    if (this.setlistId !== id) { this.setlistId = id; this.undo = []; this.redo = []; }
  },
  // The current order as a comparable snapshot.
  snapshot() {
    return (State.current?.songs || []).map(s => ({ song_id: s.id, section: s.section || 'Set 1' }));
  },
  same(a, b) {
    return a.length === b.length &&
      a.every((x, i) => x.song_id === b[i].song_id && x.section === b[i].section);
  },
  // Record the order as it was *before* a change. Call right before mutating.
  push(prev) {
    prev = prev || this.snapshot();
    const top = this.undo[this.undo.length - 1];
    if (top && this.same(top, prev)) return; // no-op change, don't stack dupes
    this.undo.push(prev);
    if (this.undo.length > this.MAX) this.undo.shift();
    this.redo = []; // a new edit invalidates the redo branch
  },
  canUndo() { return this.undo.length > 0; },
  canRedo() { return this.redo.length > 0; },
  clear() { this.undo = []; this.redo = []; },
};

const State = {
  tab: _session.tab === 'set' ? 'set' : 'songs',
  songs: [],
  search: '',
  // Filters for the song list. Empty string = no filter.
  filter: { singer: '', key: '', structure: '', tempo: '' },
  filterOpen: false,
  singers: { primary: ['Ric', 'Eddy'], all: ['Ric', 'Eddy'] },
  setlists: [],
  currentSetlistId: Number.isInteger(_session.setlistId) ? _session.setlistId : null,
  // current.songs is the flat ordered list; each song carries a `.section`.
  current: null, // {id, name, songs:[], sections:[]}
  // Section names to keep visible even when they hold no songs (e.g. you dragged
  // the last song out, or just added a section). Sections aren't persisted on
  // the server — they're derived from items — so this lives for the session and
  // keeps an emptied section as a usable drop target. Map keyed by setlist id.
  emptySections: {},
};

// ---- Helpers ------------------------------------------------------------ //
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---- Rendering: badges -------------------------------------------------- //
function badgesHtml(song) {
  const out = [];
  if (song.key) {
    out.push(`<span class="chip key ${song.is_minor ? 'minor' : ''}" style="background:${keyColor(song.key)}">${esc(song.key)}</span>`);
  }
  if (song.cross_harp) {
    out.push(`<span class="chip harp" title="Cross-harp key">harp <b>${esc(song.cross_harp)}</b></span>`);
  }
  if (song.structure) {
    out.push(`<span class="chip struct">${esc(structLabel(song.structure))}</span>`);
  }
  const band = tempoBand(song.tempo_min, song.tempo_max);
  if (band) {
    const range = (song.tempo_min != null && song.tempo_max != null && song.tempo_min !== song.tempo_max)
      ? `${song.tempo_min}–${song.tempo_max}` : (song.tempo_min ?? song.tempo_max);
    out.push(`<span class="chip tempo"><span class="dot ${band.cls}"></span>${esc(range)}</span>`);
  }
  if (song.singer) {
    out.push(`<span class="chip singer">${esc(song.singer)}</span>`);
  }
  if (song.length_min != null) {
    out.push(`<span class="chip len">${esc(song.length_min)}m</span>`);
  }
  return out.join('');
}

// Apply the active song-list filters (singer/key/structure/tempo) + search.
function filteredSongs() {
  const q = State.search.toLowerCase();
  const f = State.filter;
  return State.songs.filter(s => {
    if (q && !((s.title || '').toLowerCase().includes(q) ||
               (s.artist || '').toLowerCase().includes(q))) return false;
    if (f.singer && (s.singer || '') !== f.singer) return false;
    if (f.key && pitchOf(s.key) !== f.key) return false;
    if (f.structure && (s.structure || '') !== f.structure) return false;
    if (f.tempo) {
      const band = tempoBand(s.tempo_min, s.tempo_max);
      if (!band || band.cls !== f.tempo) return false;
    }
    return true;
  });
}

function activeFilterCount() {
  return Object.values(State.filter).filter(Boolean).length;
}

// Build the collapsible filter panel (singer / key / structure / tempo).
function renderFilterPanel(panel) {
  const f = State.filter;
  const pill = (label, active) =>
    `<button type="button" class="fpill ${active ? 'on' : ''}">${esc(label)}</button>`;

  const singerPills = State.singers.all
    .map(name => pill(name, f.singer === name)).join('');
  const keyPills = PITCHES
    .map(p => `<button type="button" class="fpill key ${f.key === p ? 'on' : ''}" data-k="${p}"
                 style="${f.key === p ? `background:${KEY_COLORS[p]};color:#0a0a0a;border-color:${KEY_COLORS[p]}` : ''}">${p}</button>`)
    .join('');
  const structPills = ['twelve_bar','eight_bar','sixteen_bar','one_chord','two_chord','jam','other']
    .map(v => pill(structLabel(v), f.structure === v)).join('');
  const tempoPills = TEMPO_BANDS
    .map(b => pill(b.label, f.tempo === b.value)).join('');

  panel.innerHTML = `
    <div class="filters">
      <div class="frow"><span class="flabel">Singer</span><div class="fpills" id="f-singer">${singerPills}</div></div>
      <div class="frow"><span class="flabel">Key</span><div class="fpills" id="f-key">${keyPills}</div></div>
      <div class="frow"><span class="flabel">Structure</span><div class="fpills" id="f-struct">${structPills}</div></div>
      <div class="frow"><span class="flabel">Tempo</span><div class="fpills" id="f-tempo">${tempoPills}</div></div>
      <button type="button" class="btn ghost" id="f-clear">Clear filters</button>
    </div>`;

  // Toggle helper: clicking an active value clears it.
  const wire = (sel, values, field) => {
    const btns = panel.querySelectorAll(sel + ' .fpill');
    btns.forEach((b, i) => b.onclick = () => {
      f[field] = (f[field] === values[i]) ? '' : values[i];
      renderSongs();
    });
  };
  wire('#f-singer', State.singers.all, 'singer');
  wire('#f-key', PITCHES, 'key');
  wire('#f-struct', ['twelve_bar','eight_bar','sixteen_bar','one_chord','two_chord','jam','other'], 'structure');
  wire('#f-tempo', TEMPO_BANDS.map(b => b.value), 'tempo');
  $('#f-clear').onclick = () => { State.filter = { singer: '', key: '', structure: '', tempo: '' }; renderSongs(); };
}

// ---- View: Songs -------------------------------------------------------- //
function renderSongs() {
  const view = $('#view');
  const inSet = new Set((State.current?.songs || []).map(s => s.id));
  const filtered = filteredSongs();
  const fcount = activeFilterCount();

  view.innerHTML = `
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search songs…" value="${esc(State.search)}">
      <button class="btn ${fcount ? 'primary' : ''}" id="filterToggle">⚲ Filter${fcount ? ' ·' + fcount : ''}</button>
      <button class="btn primary" onclick="UI.songForm()">+ Add</button>
    </div>
    <div id="filterPanel"></div>
    <p class="count">${filtered.length} song${filtered.length === 1 ? '' : 's'}${State.current ? ` · adding to “${esc(State.current.name)}”` : ''}</p>
    <div class="list" id="songlist"></div>`;

  $('#filterToggle').onclick = () => { State.filterOpen = !State.filterOpen; renderSongs(); };
  if (State.filterOpen) renderFilterPanel($('#filterPanel'));

  const list = $('#songlist');
  if (!filtered.length) {
    list.appendChild(el(`<div class="empty"><p>No songs${q ? ' match your search' : ' yet'}.</p>
      <p>${q ? '' : 'Tap <b>+ Add</b> to add your first song.'}</p></div>`));
  }
  for (const s of filtered) {
    const isIn = inSet.has(s.id);
    const card = el(`
      <div class="song" style="border-left-color:${keyColor(s.key)}">
        <div class="main">
          <div class="title">${esc(s.title)}</div>
          ${s.artist ? `<div class="artist">${esc(s.artist)}</div>` : ''}
          <div class="badges">${badgesHtml(s)}</div>
        </div>
        <div class="right">
          <button class="iconbtn ${isIn ? 'in' : 'add'}" title="${isIn ? 'In set' : 'Add to set'}">${isIn ? '✓' : '+'}</button>
          <button class="iconbtn" title="Edit">✎</button>
        </div>
      </div>`);
    const [addBtn, editBtn] = card.querySelectorAll('.iconbtn');
    addBtn.onclick = () => UI.toggleInSet(s, addBtn);
    editBtn.onclick = () => UI.songForm(s);
    list.appendChild(card);
  }

  const search = $('#search');
  search.oninput = (e) => { State.search = e.target.value; renderSongs(); };
  // keep focus & caret after re-render
  if (document.activeElement?.id !== 'search' && State.search) {
    search.focus(); search.setSelectionRange(search.value.length, search.value.length);
  }
}

// The ordered list of distinct section names in the current set list.
//
// Order is driven by the songs, but emptied/added sections are kept in place via
// State.emptySections — a per-setlist record of {name, after} where `after` is
// the section a kept-empty section should follow (null = goes first). This keeps
// an emptied section in its original slot instead of dropping to the bottom.
function sectionNames() {
  const fromSongs = [];
  for (const s of State.current.songs) {
    const n = s.section || 'Set 1';
    if (!fromSongs.includes(n)) fromSongs.push(n);
  }
  const kept = State.emptySections[State.current.id] || [];
  if (!kept.length) return fromSongs.length ? fromSongs : ['Set 1'];

  // Splice each kept-empty section in just after its recorded predecessor.
  const names = [...fromSongs];
  for (const { name, after } of kept) {
    if (names.includes(name)) continue;
    if (after == null) { names.unshift(name); continue; }
    const i = names.indexOf(after);
    if (i === -1) names.push(name);          // predecessor gone — append
    else names.splice(i + 1, 0, name);
  }
  return names.length ? names : ['Set 1'];
}

// Mark a section as one to keep showing even when it has no songs, remembering
// the section it currently follows so it holds its position after a re-render.
function keepEmptySection(name) {
  // Find which section currently precedes `name` so we can re-insert it there.
  const order = sectionNames();
  const idx = order.indexOf(name);
  keepEmptySectionAt(name, idx > 0 ? order[idx - 1] : null);
}

// Same, but with the predecessor supplied explicitly (used by the drag commit,
// where State.current.songs is mid-update so sectionNames() would be stale).
function keepEmptySectionAt(name, after) {
  const id = State.current.id;
  const list = State.emptySections[id] || (State.emptySections[id] = []);
  const existing = list.find(e => e.name === name);
  if (existing) existing.after = after; // refresh position if already tracked
  else list.push({ name, after });
}

// Drop kept-empty entries for sections that now hold songs (they'll render from
// the songs) or that no longer appear at all.
function pruneEmptySections() {
  const id = State.current?.id;
  if (id == null || !State.emptySections[id]) return;
  const occupied = new Set(State.current.songs.map(s => s.section || 'Set 1'));
  State.emptySections[id] = State.emptySections[id].filter(e => !occupied.has(e.name));
}

// ---- View: Set list ----------------------------------------------------- //
function renderSet() {
  // Never rebuild the list while a drag is active: it would replace the rows
  // out from under the in-flight drag, and a pointermove landing afterwards
  // could re-attach the now-orphaned dragged row into the fresh list (the
  // momentary "third song"). Defer until the drag ends.
  if (dragState) { pendingRenderSet = true; return; }
  const view = $('#view');
  const opts = State.setlists.map(s =>
    `<option value="${s.id}" ${s.id === State.currentSetlistId ? 'selected' : ''}>${esc(s.name)} (${s.song_count})</option>`).join('');

  view.innerHTML = `
    <div class="setlist-head">
      <select id="sl-select">
        <option value="">— choose a set list —</option>
        ${opts}
      </select>
      <button class="btn" onclick="UI.newSetlist()" title="New set list">+ New</button>
    </div>
    <div id="set-body"></div>`;

  $('#sl-select').onchange = (e) => UI.selectSetlist(e.target.value ? +e.target.value : null);

  const body = $('#set-body');
  if (!State.current) {
    body.appendChild(el(`<div class="empty">
      <p>${State.setlists.length ? 'Choose a set list above,' : 'No set lists yet.'}</p>
      <p>or tap <b>+ New</b> to create one.</p></div>`));
    return;
  }

  // Scope undo history to the set list being shown.
  History.use(State.current.id);

  const songs = State.current.songs;
  const names = sectionNames();
  const multi = names.length > 1;

  // Total length across the whole set (set-plan only — not printed).
  const totalMin = songs.reduce((sum, s) => sum + (s.length_min || 0), 0);
  const withLen = songs.filter(s => s.length_min != null).length;
  const lenNote = songs.length
    ? `~${fmtMinutes(totalMin)} total` + (withLen < songs.length ? ` (${songs.length - withLen} without length)` : '')
    : '';

  body.appendChild(el(`
    <div>
      <div class="toolbar">
        <button class="btn ghost" id="undoBtn" onclick="UI.undo()" title="Undo (⌘Z)" aria-label="Undo">↶ Undo</button>
        <button class="btn ghost" id="redoBtn" onclick="UI.redo()" title="Redo (⌘⇧Z)" aria-label="Redo">↷ Redo</button>
        <button class="btn ghost" onclick="UI.renameSetlist()">✎ Rename</button>
        <button class="btn ghost" onclick="UI.duplicateSetlist()">⧉ Duplicate</button>
        <button class="btn danger" onclick="UI.deleteSetlist()">🗑 Delete</button>
        <a class="btn primary" href="/print/${State.current.id}" target="_blank" rel="noopener">🖨 Print</a>
      </div>
      <p class="count">${songs.length} song${songs.length === 1 ? '' : 's'} in ${names.length} section${names.length === 1 ? '' : 's'}${lenNote ? ' · ' + lenNote : ''}</p>
    </div>`));
  refreshUndoButtons();

  if (!songs.length) {
    body.appendChild(el(`<div class="empty"><p>This set is empty.</p>
      <p>Tap <b>+ Songs</b> to fill it.</p></div>`));
  }

  // Render each section as its own sortable block.
  for (const name of (songs.length ? names : [])) {
    const inSec = songs.map((s, idx) => ({ s, idx })).filter(o => (o.s.section || 'Set 1') === name);
    const secMin = inSec.reduce((sum, o) => sum + (o.s.length_min || 0), 0);

    const head = el(`
      <div class="sec-head">
        <span class="sec-name">${esc(name)}</span>
        <span class="sec-meta">${inSec.length} song${inSec.length === 1 ? '' : 's'}${secMin ? ' · ~' + fmtMinutes(secMin) : ''}</span>
        <span class="sec-tools">
          <button class="linkbtn" data-act="rename">rename</button>
          ${multi ? '<button class="linkbtn danger" data-act="merge">remove section</button>' : ''}
        </span>
      </div>`);
    head.querySelector('[data-act="rename"]').onclick = () => UI.renameSection(name);
    const mergeBtn = head.querySelector('[data-act="merge"]');
    if (mergeBtn) mergeBtn.onclick = () => UI.removeSection(name);
    body.appendChild(head);

    const wrap = el(`<div class="list sortable" data-section="${esc(name)}"></div>`);
    inSec.forEach((o, localPos) => {
      const s = o.s, band = tempoBand(s.tempo_min, s.tempo_max);
      const item = el(`
        <div class="so-item" data-id="${s.id}" style="border-left-color:${keyColor(s.key)}">
          <div class="grip" title="Drag to reorder">⠿</div>
          <div class="pos">${localPos + 1}</div>
          <div class="main">
            <div class="title">${esc(s.title)}</div>
            <div class="meta">${s.singer ? esc(s.singer) + ' · ' : ''}${s.key ? 'Key ' + esc(s.key) + ' · ' : ''}harp <b>${esc(s.cross_harp || '—')}</b>${s.length_min != null ? ' · ' + s.length_min + 'm' : ''}${band ? ' · ' + band.label : ''}</div>
          </div>
          <button class="iconbtn danger" title="Remove" style="color:var(--danger)">✕</button>
        </div>`);
      item.querySelector('.iconbtn.danger').onclick = () => UI.removeFromSet(s.id, item);
      attachDrag(item, wrap);
      wrap.appendChild(item);
    });
    if (!inSec.length) {
      wrap.appendChild(el(`<div class="empty small"><p>Empty section.</p></div>`));
    }
    body.appendChild(wrap);
  }

  // Footer: add a new section.
  if (songs.length) {
    const foot = el(`<button class="btn ghost addsec">+ Add section</button>`);
    foot.onclick = () => UI.addSection();
    body.appendChild(foot);
  }
}

// ---- Drag-and-drop reordering (section-aware) --------------------------- //
// Pointer Events power this so it works identically with mouse, touch and pen
// (HTML5 drag-and-drop never fires from touch, so dragging was dead on phones).
// The drag is started only from the grip handle, which keeps the rest of the
// row free for normal page scrolling on a touchscreen. While dragging we move
// the row through the DOM live — within a section or across sections — and on
// release rebuild the flat ordered list (with per-song sections) from the DOM.
function attachDrag(item, wrap) {
  const grip = item.querySelector('.grip');
  if (!grip) return;
  grip.addEventListener('pointerdown', (e) => startPointerDrag(e, item));
}

// The row currently being dragged, plus a small autoscroll loop so you can drag
// past the top/bottom of a long set on a short screen.
let dragState = null;
// Set when a renderSet() is requested mid-drag; flushed when the drag ends.
let pendingRenderSet = false;

function startPointerDrag(e, item) {
  // Only the primary button / single touch starts a drag.
  if (e.button != null && e.button !== 0) return;
  // Ignore a second pointer starting a drag while one is already in progress —
  // two concurrent drags fight over the same rows and can flash a stray row.
  if (dragState) return;
  e.preventDefault();
  item.classList.add('dragging');
  // Capture so we keep getting moves even if the finger drifts off the grip.
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  // grabDy: where within the row the finger landed, so the row tracks the
  // finger from that point rather than snapping its top to the cursor.
  const rect = item.getBoundingClientRect();
  dragState = {
    item, pointerId: e.pointerId, target: e.target, scrollTimer: null,
    grabDy: e.clientY - rect.top, lastY: e.clientY,
    // Snapshot the order before the drag so it can be pushed to undo history
    // when (and only when) the drag actually changes something.
    before: History.snapshot(),
  };

  const onMove = (ev) => onPointerDragMove(ev);
  const onUp = (ev) => {
    if (ev.pointerId !== dragState.pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    endPointerDrag();
  };
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function onPointerDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  e.preventDefault(); // stop the page scrolling under the finger while dragging
  const item = dragState.item;
  const y = e.clientY;

  // Which section list is the finger over? Reparent the row into it so songs
  // can be moved between sections, then position within that list.
  const wraps = [...document.querySelectorAll('.sortable')];
  const overWrap = wraps.find(w => {
    const r = w.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });
  if (overWrap) {
    const siblings = [...overWrap.querySelectorAll('.so-item')].filter(n => n !== item);
    const after = siblings.find(n => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    // Only touch the DOM (and run the slide animation) when the order changes.
    const willChange = after ? item.nextSibling !== after : overWrap.lastElementChild !== item;
    if (willChange) {
      flipReorder(() => {
        if (after) overWrap.insertBefore(item, after);
        else overWrap.appendChild(item);
      });
      renumberPositions();
    }
  }

  dragState.lastY = y;
  followFinger(y);
  // Autoscroll when near the top/bottom edge of the viewport.
  autoscrollNearEdge(y);
}

// Glue the dragged row to the finger: offset it so the point the user grabbed
// stays under the pointer. Measured against the row's *resting* layout position
// (transform cleared first) so reorders underneath don't make it jump.
function followFinger(y) {
  const item = dragState.item;
  item.style.transition = 'none';
  item.style.transform = '';
  const rect = item.getBoundingClientRect();
  const restTop = rect.top;
  let offset = y - dragState.grabDy - restTop;
  // Clamp travel to the set-list area so a fast drag can't fling the row up
  // over the toolbar/selector (where it looked like a stray extra song) or
  // below the last section. Bounds = top of the first list .. bottom of last.
  const lists = [...document.querySelectorAll('.sortable')];
  if (lists.length) {
    const top = lists[0].getBoundingClientRect().top;
    const bottom = lists[lists.length - 1].getBoundingClientRect().bottom;
    const minOffset = top - restTop;                 // row top can't go above list top
    const maxOffset = bottom - rect.height - restTop; // row bottom can't go below list bottom
    offset = Math.max(minOffset, Math.min(maxOffset, offset));
  }
  item.style.transform = `translateY(${offset}px)`;
}

// FLIP: animate the rows that shift when the dragged row is reinserted, so they
// visibly slide into place instead of jumping. The dragged row itself is left
// alone — it's tracking the finger and should not be transitioned.
function flipReorder(mutate) {
  const rows = [...document.querySelectorAll('.so-item')].filter(n => n !== dragState.item);
  // Snap any rows still mid-animation to their resting position before we
  // measure, so deltas are computed from real layout, not a tweened transform.
  rows.forEach(n => { n.style.transition = 'none'; n.style.transform = ''; });
  const first = new Map(rows.map(n => [n, n.getBoundingClientRect().top]));
  mutate();
  for (const n of rows) {
    const delta = first.get(n) - n.getBoundingClientRect().top;
    if (!delta) continue;
    n.style.transition = 'none';
    n.style.transform = `translateY(${delta}px)`;
    // Next frame: clear the offset and let the transition animate to zero.
    requestAnimationFrame(() => {
      n.style.transition = 'transform .18s ease';
      n.style.transform = '';
    });
  }
}

function autoscrollNearEdge(y) {
  const margin = 60, speed = 12;
  let dy = 0;
  if (y < margin) dy = -speed;
  else if (y > window.innerHeight - margin) dy = speed;
  dragState.scrollDy = dy;
  if (dy && dragState.scrollTimer == null) {
    dragState.scrollTimer = setInterval(() => {
      window.scrollBy(0, dragState.scrollDy || 0);
      // Keep the row pinned under the finger as the page scrolls beneath it.
      followFinger(dragState.lastY);
    }, 16);
  } else if (!dy && dragState.scrollTimer != null) {
    clearInterval(dragState.scrollTimer);
    dragState.scrollTimer = null;
  }
}

function endPointerDrag() {
  if (!dragState) return;
  if (dragState.scrollTimer != null) clearInterval(dragState.scrollTimer);
  try { dragState.target.releasePointerCapture(dragState.pointerId); } catch {}
  const item = dragState.item;
  item.classList.remove('dragging');
  // Settle: let the dragged row slide from where the finger left it back into
  // its resting slot, instead of snapping. Other rows already sit at rest.
  document.querySelectorAll('.so-item').forEach(n => {
    if (n !== item) { n.style.transition = ''; n.style.transform = ''; }
  });
  item.style.transition = 'transform .15s ease';
  item.style.transform = '';
  const done = () => { item.style.transition = ''; item.removeEventListener('transitionend', done); };
  item.addEventListener('transitionend', done);
  const before = dragState.before;
  dragState = null;
  commitOrderFromDom(before);
  // Flush any render that was deferred because it arrived mid-drag.
  if (pendingRenderSet) { pendingRenderSet = false; renderSet(); }
}

// Renumber the .pos labels live from the current DOM order, per section, so the
// numbers track the drag instead of waiting for the post-save re-render.
function renumberPositions() {
  document.querySelectorAll('.sortable').forEach(wrap => {
    wrap.querySelectorAll('.so-item').forEach((n, i) => {
      const pos = n.querySelector('.pos');
      if (pos) pos.textContent = i + 1;
    });
  });
}

function commitOrderFromDom(before) {
  const cur = State.current.songs;
  const byId = new Map(cur.map(s => [s.id, s]));
  // Snapshot current sections *before* the rebuild mutates them, so the
  // change-detection below can see a section-only move (same song order, new
  // section) — otherwise mutating s.section in place defeats the comparison.
  const prevSection = new Map(cur.map(s => [s.id, s.section || 'Set 1']));

  const rebuilt = [];
  const seen = new Set();
  // Section names present as wraps in the DOM (in order) and which of them the
  // drag left without any songs.
  const domSections = [];
  const emptiedNow = [];
  document.querySelectorAll('.sortable').forEach(wrap => {
    const section = wrap.dataset.section || 'Set 1';
    domSections.push(section);
    const items = wrap.querySelectorAll('.so-item');
    if (!items.length) emptiedNow.push(section);
    items.forEach(n => {
      const id = +n.dataset.id;
      // A song appears at most once per set (the All Songs toggle enforces this).
      // Guard here too so a stray duplicate row can never be committed twice —
      // which previously surfaced as a song appearing at both ends after a drag.
      if (seen.has(id)) return;
      const s = byId.get(id);
      if (s) { s.section = section; rebuilt.push(s); seen.add(id); }
    });
  });
  if (!rebuilt.length) return;
  const unchanged = rebuilt.length === cur.length &&
    rebuilt.every((s, i) => s === cur[i] && (s.section || 'Set 1') === prevSection.get(s.id));
  if (unchanged) return;

  // Did the set of occupied sections change? If so the headers/placeholders are
  // now stale and we must re-render (the drag has ended by the time we commit).
  const beforeSecs = new Set(prevSection.values());
  if (before) History.push(before); // record the pre-drag order for undo
  State.current.songs = rebuilt;

  // Keep any section the drag emptied visible (as a drop target), positioned
  // after its DOM predecessor; drop kept-empty entries that regained songs.
  emptiedNow.forEach(name => {
    const i = domSections.indexOf(name);
    keepEmptySectionAt(name, i > 0 ? domSections[i - 1] : null);
  });
  pruneEmptySections();

  const afterSecs = new Set(rebuilt.map(s => s.section || 'Set 1'));
  const sectionsChanged = beforeSecs.size !== afterSecs.size ||
    [...beforeSecs].some(s => !afterSecs.has(s));

  // rerender when membership changed so stale placeholders/headers are rebuilt.
  UI.saveOrder({ rerender: sectionsChanged, optimistic: sectionsChanged });
  refreshUndoButtons();
}

// ---- Song add/edit modal ------------------------------------------------ //
const PITCHES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function songForm(song) {
  const editing = !!song;
  song = song || {};
  let selectedPitch = pitchOf(song.key) || null;
  let minor = !!song.is_minor;

  const swatches = PITCHES.map(p =>
    `<button type="button" data-p="${p}" style="background:${KEY_COLORS[p]}" class="${p === selectedPitch ? 'sel' : ''}">${p}</button>`).join('');

  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-bg">
      <form class="modal" id="songform">
        <h2>${editing ? 'Edit song' : 'Add song'}</h2>
        <div class="field">
          <label>Title <span class="req">* required</span></label>
          <input name="title" required value="${esc(song.title || '')}" placeholder="Song title" autocomplete="off">
        </div>
        <div class="field">
          <label>Artist</label>
          <input name="artist" value="${esc(song.artist || '')}" placeholder="Optional" autocomplete="off">
        </div>
        <div class="field">
          <label>Key <span style="color:var(--muted)">(tap to pick)</span></label>
          <div class="keygrid" id="keygrid">${swatches}</div>
          <div class="keytoggle">
            <button type="button" id="maj" class="${minor ? '' : 'active'}">Major</button>
            <button type="button" id="min" class="${minor ? 'active' : ''}">Minor</button>
            <button type="button" id="keyclear">Clear</button>
          </div>
        </div>
        <div class="field">
          <label>Structure</label>
          <select name="structure">
            <option value="">—</option>
            ${['twelve_bar','eight_bar','sixteen_bar','one_chord','two_chord','jam','other']
              .map(v => `<option value="${v}" ${song.structure === v ? 'selected' : ''}>${structLabel(v)}</option>`).join('')}
          </select>
        </div>
        <div class="row2">
          <div class="field">
            <label>Tempo min (BPM)</label>
            <input name="tempo_min" type="number" inputmode="numeric" min="20" max="320" value="${song.tempo_min ?? ''}">
          </div>
          <div class="field">
            <label>Tempo max (BPM)</label>
            <input name="tempo_max" type="number" inputmode="numeric" min="20" max="320" value="${song.tempo_max ?? ''}">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Who sings</label>
            <div class="singerpick" id="singerpick"></div>
          </div>
          <div class="field" style="flex:0 0 8rem">
            <label>Length (min)</label>
            <input name="length_min" type="number" inputmode="numeric" min="1" max="60" value="${song.length_min ?? ''}" placeholder="approx">
          </div>
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" placeholder="Optional">${esc(song.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          ${editing ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}
          <button type="button" class="btn ghost" id="cancel">Cancel</button>
          <button type="submit" class="btn primary">${editing ? 'Save' : 'Add song'}</button>
        </div>
      </form>
    </div>`;

  const form = $('#songform');

  // Singer picker: Ric / Eddy as primary chips, plus a mostly-hidden "Other…"
  // that reveals a text input (so extra singer names are possible but tucked
  // away). `selectedSinger` holds the current value (or '').
  let selectedSinger = song.singer || '';
  const singerPick = $('#singerpick');
  function refreshSinger() {
    const primary = State.singers.primary; // ['Ric','Eddy']
    const isOther = selectedSinger && !primary.includes(selectedSinger);
    const chips = primary.map(n =>
      `<button type="button" class="schip ${selectedSinger === n ? 'on' : ''}" data-s="${esc(n)}">${esc(n)}</button>`).join('');
    singerPick.innerHTML = chips +
      `<button type="button" class="schip ${isOther ? 'on' : ''}" data-other="1">Other…</button>` +
      (isOther ? `<input type="text" class="otherinput" id="othersinger" value="${esc(selectedSinger)}" placeholder="Singer name">` : '');
    singerPick.querySelectorAll('.schip[data-s]').forEach(b => b.onclick = () => {
      selectedSinger = (selectedSinger === b.dataset.s) ? '' : b.dataset.s; refreshSinger();
    });
    singerPick.querySelector('[data-other]').onclick = () => {
      selectedSinger = isOther ? '' : ' '; // sentinel so the input shows
      refreshSinger();
      const inp = $('#othersinger'); if (inp) { inp.value = ''; inp.focus(); }
    };
    const other = $('#othersinger');
    if (other) other.oninput = () => { selectedSinger = other.value; };
  }
  refreshSinger();

  const grid = $('#keygrid');
  function refreshKey() {
    grid.querySelectorAll('button').forEach(b =>
      b.classList.toggle('sel', b.dataset.p === selectedPitch));
    $('#maj').classList.toggle('active', !minor);
    $('#min').classList.toggle('active', minor);
  }
  grid.querySelectorAll('button').forEach(b => b.onclick = () => {
    selectedPitch = (selectedPitch === b.dataset.p) ? null : b.dataset.p; refreshKey();
  });
  $('#maj').onclick = () => { minor = false; refreshKey(); };
  $('#min').onclick = () => { minor = true; refreshKey(); };
  $('#keyclear').onclick = () => { selectedPitch = null; refreshKey(); };

  $('#cancel').onclick = closeModal;
  $('.modal-bg').onclick = (e) => { if (e.target.classList.contains('modal-bg')) closeModal(); };
  if (editing) $('#del').onclick = async () => {
    if (!confirm(`Delete “${song.title}”? This also removes it from any set lists.`)) return;
    await API.deleteSong(song.id); closeModal(); toast('Song deleted'); await refreshAll();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = (fd.get('title') || '').trim();
    if (!title) { toast('Title is required'); return; }
    const key = selectedPitch ? selectedPitch + (minor ? 'm' : '') : null;
    const num = (v) => { v = (v || '').toString().trim(); return v === '' ? null : parseInt(v, 10); };
    const payload = {
      title,
      artist: (fd.get('artist') || '').trim() || null,
      key,
      structure: fd.get('structure') || null,
      tempo_min: num(fd.get('tempo_min')),
      tempo_max: num(fd.get('tempo_max')),
      singer: (selectedSinger || '').trim() || null,
      length_min: num(fd.get('length_min')),
      notes: (fd.get('notes') || '').trim() || null,
    };
    try {
      if (editing) await API.updateSong(song.id, payload);
      else await API.createSong(payload);
      closeModal(); toast(editing ? 'Saved' : 'Song added'); await refreshAll();
    } catch (err) { toast('Error: ' + err.message); }
  };

  $('input[name=title]').focus();
}

function closeModal() { $('#modal-root').innerHTML = ''; }

// ---- UI actions --------------------------------------------------------- //
const UI = {
  show(tab) {
    State.tab = tab;
    Session.save({ tab });
    $('#tab-songs').classList.toggle('active', tab === 'songs');
    $('#tab-set').classList.toggle('active', tab === 'set');
    tab === 'songs' ? renderSongs() : renderSet();
  },
  songForm(song) { songForm(song); },

  async toggleInSet(song, btn) {
    if (!State.current) {
      // No active set list — help the user pick or make one.
      if (!State.setlists.length) {
        const name = prompt('Name your first set list:', 'New Set');
        if (!name) return;
        const sl = await API.createSetlist(name.trim());
        State.setlists = await API.setlists();
        await UI.selectSetlist(sl.id, true);
      } else {
        toast('Open the Set List tab and choose a set first');
        return;
      }
    }
    const songs = State.current.songs;
    const idx = songs.findIndex(s => s.id === song.id);
    const adding = idx < 0;
    if (adding) {
      // Add to the last section in use (so new picks land in the section the
      // user is currently building).
      const names = sectionNames();
      songs.push({ ...song, section: names[names.length - 1] });
    } else {
      songs.splice(idx, 1);
    }

    // Respond instantly: flip the button and pop it, then persist in the
    // background instead of waiting on the network before showing the change.
    if (btn) {
      btn.classList.toggle('in', adding);
      btn.classList.toggle('add', !adding);
      btn.textContent = adding ? '✓' : '+';
      btn.title = adding ? 'In set' : 'Add to set';
      btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    }
    toast(adding ? `Added to “${State.current.name}”` : 'Removed from set');

    try { State.current = await persistOrder(); }
    catch { renderSongs(); } // reconcile UI if the save failed
  },

  async newSetlist() {
    const name = prompt('Set list name:', '');
    if (!name || !name.trim()) return;
    const sl = await API.createSetlist(name.trim());
    State.setlists = await API.setlists();
    await UI.selectSetlist(sl.id);
  },

  async renameSetlist() {
    if (!State.current) return;
    const name = prompt('Rename set list:', State.current.name);
    if (!name || !name.trim()) return;
    await API.renameSetlist(State.current.id, name.trim());
    State.current.name = name.trim();
    State.setlists = await API.setlists();
    renderSet();
  },

  async duplicateSetlist() {
    if (!State.current) return;
    const copy = await API.duplicateSetlist(State.current.id);
    State.setlists = await API.setlists();
    await UI.selectSetlist(copy.id);
    toast(`Copied to “${copy.name}”`);
  },

  async deleteSetlist() {
    if (!State.current) return;
    const name = State.current.name;
    const n = State.current.songs.length;
    const detail = n ? ` and its ${n} song${n === 1 ? '' : 's'}` : '';
    if (!confirm(`Delete set list “${name}”${detail}? This can't be undone.`)) return;
    const deletedId = State.current.id;
    await API.deleteSetlist(deletedId);
    History.clear();
    State.setlists = await API.setlists();
    // Fall back to another set list if one remains, otherwise show none.
    const next = State.setlists[0]?.id ?? null;
    await UI.selectSetlist(next);
    toast(`Deleted “${name}”`);
  },

  async selectSetlist(id, stayOnSongs) {
    State.currentSetlistId = id;
    Session.save({ setlistId: id });
    History.use(id); // scope (or clear) undo history to the chosen set list
    State.current = id ? await API.getSetlist(id) : null;
    if (!stayOnSongs) renderSet(); else renderSongs();
  },

  // Persist the current order.
  //  - rerender:false  → caller already updated the DOM (e.g. a drag); just save.
  //  - optimistic:true → render the new state from State.current *now*, then
  //                      save in the background so the UI never waits on the
  //                      network. On failure we reload the server's truth.
  async saveOrder({ rerender = true, optimistic = false } = {}) {
    if (optimistic) {
      if (rerender) renderSet();
      persistOrder()
        .then(cur => { State.current = cur; })
        .catch(() => { toast('Save failed — reloading'); UI.selectSetlist(State.currentSetlistId); });
      return;
    }
    State.current = await persistOrder();
    // After a drag the live DOM already reflects the new order, so re-rendering
    // is both redundant and harmful: if the user has begun another drag while
    // the save is in flight, renderSet() rebuilds the rows out from under that
    // drag and a row can momentarily appear duplicated. Skip it in that case.
    if (rerender) renderSet();
  },

  // Remove a song from the set. Responds instantly: the row collapses/fades out
  // while the order is persisted in the background (no full re-render, so the
  // remaining rows don't flash). The numbers renumber live as it leaves.
  removeFromSet(id, item) {
    const songs = State.current.songs;
    const idx = songs.findIndex(s => s.id === id);
    if (idx === -1) return;
    History.push();            // record order before the removal for undo
    songs.splice(idx, 1);
    refreshUndoButtons();

    // Persist quietly in the background; re-render only once both the save and
    // the exit animation are done, so nothing flashes mid-animation.
    let animDone = false, saved = false;
    const settle = () => { if (animDone && saved) renderSet(); };
    persistOrder()
      .then(cur => { State.current = cur; saved = true; settle(); })
      .catch(() => UI.saveOrder());

    if (item) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        item.removeEventListener('transitionend', finish);
        item.remove();
        renumberPositions();
        animDone = true;
        settle();
      };

      const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        finish(); // honour the OS "Reduce Motion" setting — remove immediately
      } else {
        // Pin the current height as an explicit start value (height:auto can't
        // be transitioned). .removing only supplies the transition timing; we
        // drive the from/to values here so there's a real start state.
        item.style.height = item.offsetHeight + 'px';
        item.classList.add('removing');
        // Two rAFs (not one): mobile Safari can coalesce a single rAF style
        // change into the same recalc as the class add, so the start state
        // never paints and the row jumps. A second frame guarantees the
        // browser commits the start state before we flip to the end state.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          item.style.height = '0px';
          item.style.opacity = '0';
          item.style.transform = 'translateX(110%)';
          item.style.paddingTop = '0';
          item.style.paddingBottom = '0';
          item.style.borderTopWidth = '0';
          item.style.borderBottomWidth = '0';
          item.style.marginBottom = '-.55rem'; // absorb the flex gap as it collapses
        }));
        item.addEventListener('transitionend', finish);
        setTimeout(finish, 500); // safety net if transitionend never fires
      }
    } else {
      animDone = true;
    }
  },

  addSection() {
    const name = prompt('New section name:', `Set ${sectionNames().length + 1}`);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (sectionNames().includes(trimmed)) { toast('Section already exists'); return; }
    // Keep the (empty) section visible so songs can be dragged into it. It
    // becomes a normal, persisted section as soon as a song lands in it.
    keepEmptySection(trimmed);
    renderSet();
    toast(`Drag songs into “${trimmed}”`);
  },

  renameSection(oldName) {
    const name = prompt('Rename section:', oldName);
    if (!name || !name.trim() || name.trim() === oldName) return;
    const trimmed = name.trim();
    History.push();
    State.current.songs.forEach(s => { if ((s.section || 'Set 1') === oldName) s.section = trimmed; });
    // Carry the rename across to the kept-empty bookkeeping (both the section's
    // own entry and any other entry positioned after it).
    const kept = State.emptySections[State.current.id];
    if (kept) kept.forEach(e => {
      if (e.name === oldName) e.name = trimmed;
      if (e.after === oldName) e.after = trimmed;
    });
    UI.saveOrder({ optimistic: true });
    refreshUndoButtons();
  },

  removeSection(name) {
    // "Remove section" merges its songs into the first remaining section.
    const names = sectionNames();
    const fallback = names.find(n => n !== name) || 'Set 1';
    if (!confirm(`Remove section “${name}”? Its songs move into “${fallback}”.`)) return;
    History.push();
    State.current.songs.forEach(s => { if ((s.section || 'Set 1') === name) s.section = fallback; });
    // Drop it from the kept-empty list so it doesn't linger as an empty target,
    // and repoint anything that followed it to its predecessor instead.
    const kept = State.emptySections[State.current.id];
    if (kept) State.emptySections[State.current.id] =
      kept.filter(e => e.name !== name).map(e => (e.after === name ? { ...e, after: null } : e));
    UI.saveOrder({ optimistic: true });
    refreshUndoButtons();
  },

  // Undo/redo the set-list ordering. Each swaps the current order with the
  // adjacent history entry, updating the DOM immediately and saving in the
  // background (no waiting on the network).
  undo() {
    if (!History.canUndo() || !State.current) return;
    History.redo.push(History.snapshot());
    applyOrderSnapshot(History.undo.pop());
    UI.saveOrder({ optimistic: true });
    refreshUndoButtons();
  },
  redo() {
    if (!History.canRedo() || !State.current) return;
    History.undo.push(History.snapshot());
    applyOrderSnapshot(History.redo.pop());
    UI.saveOrder({ optimistic: true });
    refreshUndoButtons();
  },
};
window.UI = UI;

// Persist the current flat ordered list (with sections) and return the fresh
// server view.
async function persistOrder() {
  const items = State.current.songs.map(s => ({ song_id: s.id, section: s.section || 'Set 1' }));
  return API.setItems(State.current.id, items);
}

// Rebuild State.current.songs to match a {song_id, section} snapshot, reusing
// the existing song objects. Songs missing from the snapshot are dropped; any
// not in the snapshot are appended (defensive — shouldn't normally happen).
function applyOrderSnapshot(snap) {
  const byId = new Map(State.current.songs.map(s => [s.id, s]));
  const used = new Set();
  const next = [];
  for (const { song_id, section } of snap) {
    const s = byId.get(song_id);
    if (s && !used.has(song_id)) { s.section = section; next.push(s); used.add(song_id); }
  }
  for (const s of State.current.songs) if (!used.has(s.id)) next.push(s);
  State.current.songs = next;
}

// Enable/disable the Undo/Redo buttons to match the current history state.
function refreshUndoButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = !History.canUndo();
  if (r) r.disabled = !History.canRedo();
}

// ---- Boot --------------------------------------------------------------- //
async function refreshAll() {
  [State.songs, State.setlists, State.singers] =
    await Promise.all([API.songs(), API.setlists(), API.singers()]);
  // Restore the last-viewed set list if it still exists; otherwise clear it.
  if (State.currentSetlistId && State.setlists.some(s => s.id === State.currentSetlistId)) {
    State.current = await API.getSetlist(State.currentSetlistId);
  } else {
    State.currentSetlistId = null; State.current = null;
    Session.save({ setlistId: null });
  }
  // Route through show() so the restored tab also highlights the right button.
  UI.show(State.tab);
}

// Keyboard shortcuts for undo/redo while viewing a set list (desktop).
document.addEventListener('keydown', (e) => {
  if (State.tab !== 'set' || !State.current) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.key.toLowerCase() !== 'z') return;
  // Don't hijack undo while typing in an input/textarea.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  if (e.shiftKey) UI.redo(); else UI.undo();
});

refreshAll().catch(err => {
  $('#view').innerHTML = `<div class="empty"><p>Couldn't load.</p><p>${esc(err.message)}</p></div>`;
});
