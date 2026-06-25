/* Song add/edit modal. */
'use strict';

import { State } from '../state.js';
import { $, esc, toast } from '../dom.js';
import { API } from '../api.js';
import { KEY_COLORS, PITCHES, STRUCTURES, pitchOf, structLabel } from '../encoding.js';
import { refreshAll } from '../boot.js';

export function songForm(song) {
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
            ${STRUCTURES
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
      selectedSinger = isOther ? '' : ' '; // sentinel so the input shows
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

export function closeModal() { $('#modal-root').innerHTML = ''; }
