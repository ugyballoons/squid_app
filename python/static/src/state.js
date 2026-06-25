/* App state: per-device session memory, undo/redo history, the live State
 * object, and the helpers that derive/maintain section bookkeeping. */
'use strict';

// ---- State -------------------------------------------------------------- //
// Lightweight per-device session memory: remembers the last view and set list
// across page refreshes via localStorage. Best-effort — never throws.
export const Session = {
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
export const History = {
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

export const State = {
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

// ---- Section bookkeeping ------------------------------------------------ //

// The ordered list of distinct section names in the current set list.
//
// Order is driven by the songs, but emptied/added sections are kept in place via
// State.emptySections — a per-setlist record of {name, after} where `after` is
// the section a kept-empty section should follow (null = goes first). This keeps
// an emptied section in its original slot instead of dropping to the bottom.
export function sectionNames() {
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
export function keepEmptySection(name) {
  // Find which section currently precedes `name` so we can re-insert it there.
  const order = sectionNames();
  const idx = order.indexOf(name);
  keepEmptySectionAt(name, idx > 0 ? order[idx - 1] : null);
}

// Same, but with the predecessor supplied explicitly (used by the drag commit,
// where State.current.songs is mid-update so sectionNames() would be stale).
export function keepEmptySectionAt(name, after) {
  const id = State.current.id;
  const list = State.emptySections[id] || (State.emptySections[id] = []);
  const existing = list.find(e => e.name === name);
  if (existing) existing.after = after; // refresh position if already tracked
  else list.push({ name, after });
}

// Drop kept-empty entries for sections that now hold songs (they'll render from
// the songs) or that no longer appear at all.
export function pruneEmptySections() {
  const id = State.current?.id;
  if (id == null || !State.emptySections[id]) return;
  const occupied = new Set(State.current.songs.map(s => s.section || 'Set 1'));
  State.emptySections[id] = State.emptySections[id].filter(e => !occupied.has(e.name));
}
