/* View: All Songs — search, filters, and the song cards. */
'use strict';

import { State } from '../state.js';
import { $, el, esc } from '../dom.js';
import { UI } from '../ui.js';
import {
  KEY_COLORS, PITCHES, TEMPO_BANDS, STRUCTURES,
  keyColor, pitchOf, tempoBand, structLabel,
} from '../encoding.js';

// ---- Rendering: badges -------------------------------------------------- //
export function badgesHtml(song) {
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
export function filteredSongs() {
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

export function activeFilterCount() {
  return Object.values(State.filter).filter(Boolean).length;
}

// Build the collapsible filter panel (singer / key / structure / tempo).
export function renderFilterPanel(panel) {
  const f = State.filter;
  const pill = (label, active) =>
    `<button type="button" class="fpill ${active ? 'on' : ''}">${esc(label)}</button>`;

  const singerPills = State.singers.all
    .map(name => pill(name, f.singer === name)).join('');
  const keyPills = PITCHES
    .map(p => `<button type="button" class="fpill key ${f.key === p ? 'on' : ''}" data-k="${p}"
                 style="${f.key === p ? `background:${KEY_COLORS[p]};color:#0a0a0a;border-color:${KEY_COLORS[p]}` : ''}">${p}</button>`)
    .join('');
  const structPills = STRUCTURES
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
  wire('#f-struct', STRUCTURES, 'structure');
  wire('#f-tempo', TEMPO_BANDS.map(b => b.value), 'tempo');
  $('#f-clear').onclick = () => { State.filter = { singer: '', key: '', structure: '', tempo: '' }; renderSongs(); };
}

// ---- View: Songs -------------------------------------------------------- //
export function renderSongs() {
  const view = $('#view');
  const inSet = new Set((State.current?.songs || []).map(s => s.id));
  const filtered = filteredSongs();
  const fcount = activeFilterCount();
  const q = State.search;

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
