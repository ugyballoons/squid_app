/* Low-level set-list order persistence and snapshot helpers. */
'use strict';

import { API } from './api.js';
import { State, History } from './state.js';
import { $ } from './dom.js';

// Persist the current flat ordered list (with sections) and return the fresh
// server view.
export async function persistOrder() {
  const items = State.current.songs.map(s => ({ song_id: s.id, section: s.section || 'Set 1' }));
  return API.setItems(State.current.id, items);
}

// Rebuild State.current.songs to match a {song_id, section} snapshot, reusing
// the existing song objects. Songs missing from the snapshot are dropped; any
// not in the snapshot are appended (defensive — shouldn't normally happen).
export function applyOrderSnapshot(snap) {
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
export function refreshUndoButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = !History.canUndo();
  if (r) r.disabled = !History.canRedo();
}
