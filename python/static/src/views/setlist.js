/* View: Set list — section blocks, the sortable rows, and the toolbar. */
'use strict';

import { State, History, sectionNames } from '../state.js';
import { $, el, esc } from '../dom.js';
import { UI } from '../ui.js';
import { refreshUndoButtons } from '../order.js';
import { attachDrag, isDragging, requestRenderSet } from '../drag.js';
import { keyColor, tempoBand, fmtMinutes } from '../encoding.js';

export function renderSet() {
  // Never rebuild the list while a drag is active: it would replace the rows
  // out from under the in-flight drag, and a pointermove landing afterwards
  // could re-attach the now-orphaned dragged row into the fresh list (the
  // momentary "third song"). Defer until the drag ends.
  if (isDragging()) { requestRenderSet(); return; }
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
