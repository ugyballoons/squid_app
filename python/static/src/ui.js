/* UI actions: the window.UI object wired to buttons + the inline onclick
 * handlers in the rendered markup. Orchestrates state changes, optimistic
 * rendering, and background persistence. */
'use strict';

import { State, Session, History, sectionNames, keepEmptySection } from './state.js';
import { $, toast } from './dom.js';
import { API } from './api.js';
import { persistOrder, applyOrderSnapshot, refreshUndoButtons } from './order.js';
import { renderSongs } from './views/songs.jsx';
import { renderSet } from './views/setlist.jsx';
import { songForm } from './views/songForm.jsx';
import { renumberPositions } from './drag.js';

export const UI = {
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
