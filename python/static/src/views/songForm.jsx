/* Song add/edit modal — JSX (compiled to h()/Fragment, no React). */
/** @jsx h */
'use strict';

import { State } from '../state.js';
import { h, Fragment, $, toast } from '../dom.js';
import { API } from '../api.js';
import { KEY_COLORS, PITCHES, STRUCTURES, pitchOf, structLabel } from '../encoding.js';
import { refreshAll } from '../boot.js';

export function songForm(song) {
  const editing = !!song;
  song = song || {};

  // Local UI state for the bits that update in place (key picker / singer chips).
  // We keep the original imperative "refresh a sub-region" approach rather than a
  // reactive rewrite, so behaviour is identical — JSX just builds the nodes.
  let selectedPitch = pitchOf(song.key) || null;
  let minor = !!song.is_minor;
  let selectedSinger = song.singer || '';

  // Refs captured during render, so the refresh helpers can re-fill regions
  // without querySelector. (ref={node => …} runs as h() builds each element.)
  let gridEl, singerEl, majBtn, minBtn, form;

  // ---- Key picker ------------------------------------------------------- //
  const keySwatches = () => PITCHES.map(p =>
    <button type="button" data-p={p} style={{ background: KEY_COLORS[p] }}
            class={p === selectedPitch ? 'sel' : ''}
            onClick={() => { selectedPitch = selectedPitch === p ? null : p; refreshKey(); }}>
      {p}
    </button>);

  function refreshKey() {
    gridEl.replaceChildren(...keySwatches());
    majBtn.classList.toggle('active', !minor);
    minBtn.classList.toggle('active', minor);
  }

  // ---- Singer picker ---------------------------------------------------- //
  // Ric / Eddy chips + a tucked-away "Other…" that reveals a free-text input.
  function singerChips() {
    const primary = State.singers.primary; // ['Ric','Eddy']
    const isOther = selectedSinger && !primary.includes(selectedSinger);
    return (
      <Fragment>
        {primary.map(n =>
          <button type="button" class={`schip ${selectedSinger === n ? 'on' : ''}`}
                  onClick={() => { selectedSinger = selectedSinger === n ? '' : n; refreshSinger(); }}>
            {n}
          </button>)}
        <button type="button" class={`schip ${isOther ? 'on' : ''}`}
                onClick={() => {
                  selectedSinger = isOther ? '' : ' '; // sentinel so the input shows
                  refreshSinger();
                  const inp = singerEl.querySelector('.otherinput');
                  if (inp) { inp.value = ''; inp.focus(); }
                }}>
          Other…
        </button>
        {isOther &&
          <input type="text" class="otherinput" value={selectedSinger} placeholder="Singer name"
                 onInput={(e) => { selectedSinger = e.target.value; }} />}
      </Fragment>
    );
  }
  function refreshSinger() { singerEl.replaceChildren(singerChips()); }

  // ---- Submit / delete -------------------------------------------------- //
  async function onSubmit(e) {
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
  }

  async function onDelete() {
    if (!confirm(`Delete “${song.title}”? This also removes it from any set lists.`)) return;
    await API.deleteSong(song.id); closeModal(); toast('Song deleted'); await refreshAll();
  }

  // ---- Render ----------------------------------------------------------- //
  const tree = (
    <div class="modal-bg"
         onClick={(e) => { if (e.target.classList.contains('modal-bg')) closeModal(); }}>
      <form class="modal" ref={n => form = n} onSubmit={onSubmit}>
        <h2>{editing ? 'Edit song' : 'Add song'}</h2>

        <div class="field">
          <label>Title <span class="req">* required</span></label>
          <input name="title" required value={song.title || ''} placeholder="Song title" autocomplete="off" />
        </div>

        <div class="field">
          <label>Artist</label>
          <input name="artist" value={song.artist || ''} placeholder="Optional" autocomplete="off" />
        </div>

        <div class="field">
          <label>Key <span style={{ color: 'var(--muted)' }}>(tap to pick)</span></label>
          <div class="keygrid" ref={n => gridEl = n}>{keySwatches()}</div>
          <div class="keytoggle">
            <button type="button" ref={n => majBtn = n} class={minor ? '' : 'active'}
                    onClick={() => { minor = false; refreshKey(); }}>Major</button>
            <button type="button" ref={n => minBtn = n} class={minor ? 'active' : ''}
                    onClick={() => { minor = true; refreshKey(); }}>Minor</button>
            <button type="button" onClick={() => { selectedPitch = null; refreshKey(); }}>Clear</button>
          </div>
        </div>

        <div class="field">
          <label>Structure</label>
          <select name="structure">
            <option value="">—</option>
            {STRUCTURES.map(v =>
              <option value={v} selected={song.structure === v}>{structLabel(v)}</option>)}
          </select>
        </div>

        <div class="row2">
          <div class="field">
            <label>Tempo min (BPM)</label>
            <input name="tempo_min" type="number" inputmode="numeric" min="20" max="320" value={song.tempo_min ?? ''} />
          </div>
          <div class="field">
            <label>Tempo max (BPM)</label>
            <input name="tempo_max" type="number" inputmode="numeric" min="20" max="320" value={song.tempo_max ?? ''} />
          </div>
        </div>

        <div class="row2">
          <div class="field">
            <label>Who sings</label>
            <div class="singerpick" ref={n => singerEl = n}>{singerChips()}</div>
          </div>
          <div class="field" style={{ flex: '0 0 8rem' }}>
            <label>Length (min)</label>
            <input name="length_min" type="number" inputmode="numeric" min="1" max="60"
                   value={song.length_min ?? ''} placeholder="approx" />
          </div>
        </div>

        <div class="field">
          <label>Notes</label>
          <textarea name="notes" placeholder="Optional">{song.notes || ''}</textarea>
        </div>

        <div class="modal-actions">
          {editing && <button type="button" class="btn danger" onClick={onDelete}>Delete</button>}
          <button type="button" class="btn ghost" onClick={closeModal}>Cancel</button>
          <button type="submit" class="btn primary">{editing ? 'Save' : 'Add song'}</button>
        </div>
      </form>
    </div>
  );

  const root = $('#modal-root');
  root.replaceChildren(tree);
  form.querySelector('input[name=title]').focus();
}

export function closeModal() { $('#modal-root').replaceChildren(); }
