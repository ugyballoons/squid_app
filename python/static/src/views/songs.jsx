/* View: All Songs — search, filters, and the song cards. JSX (compiled to
 * h()/Fragment, no React); nothing here drags, so it's all components. */
/** @jsx h */
'use strict';

import { State } from '../state.js';
import { h, Fragment, $ } from '../dom.js';
import { UI } from '../ui.js';
import {
  KEY_COLORS, PITCHES, TEMPO_BANDS, STRUCTURES,
  keyColor, pitchOf, tempoBand, structLabel,
} from '../encoding.js';

// ---- Badges ------------------------------------------------------------- //
// Returns an array of chip nodes for a song (was an HTML string before JSX).
export function badges(song) {
  const out = [];
  if (song.key) {
    out.push(<span class={`chip key ${song.is_minor ? 'minor' : ''}`}
                   style={{ background: keyColor(song.key) }}>{song.key}</span>);
  }
  if (song.cross_harp) {
    out.push(<span class="chip harp" title="Cross-harp key">harp <b>{song.cross_harp}</b></span>);
  }
  if (song.structure) {
    out.push(<span class="chip struct">{structLabel(song.structure)}</span>);
  }
  const band = tempoBand(song.tempo_min, song.tempo_max);
  if (band) {
    const range = (song.tempo_min != null && song.tempo_max != null && song.tempo_min !== song.tempo_max)
      ? `${song.tempo_min}–${song.tempo_max}` : (song.tempo_min ?? song.tempo_max);
    out.push(<span class="chip tempo"><span class={`dot ${band.cls}`}></span>{range}</span>);
  }
  if (song.singer) {
    out.push(<span class="chip singer">{song.singer}</span>);
  }
  if (song.length_min != null) {
    out.push(<span class="chip len">{song.length_min}m</span>);
  }
  return out;
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

// ---- Filter panel ------------------------------------------------------- //
// Build the collapsible filter panel (singer / key / structure / tempo). A
// click sets the field (or clears it if already active) and re-renders.
export function renderFilterPanel(panel) {
  const f = State.filter;
  const set = (field, value) => {
    f[field] = (f[field] === value) ? '' : value;
    renderSongs();
  };
  const Pill = ({ label, active, onClick }) =>
    <button type="button" class={`fpill ${active ? 'on' : ''}`} onClick={onClick}>{label}</button>;

  const KeyPill = (p) =>
    <button type="button" class={`fpill key ${f.key === p ? 'on' : ''}`} data-k={p}
            style={f.key === p ? { background: KEY_COLORS[p], color: '#0a0a0a', borderColor: KEY_COLORS[p] } : {}}
            onClick={() => set('key', p)}>{p}</button>;

  panel.replaceChildren(
    <div class="filters">
      <div class="frow"><span class="flabel">Singer</span>
        <div class="fpills">{State.singers.all.map(n =>
          <Pill label={n} active={f.singer === n} onClick={() => set('singer', n)} />)}</div></div>
      <div class="frow"><span class="flabel">Key</span>
        <div class="fpills">{PITCHES.map(KeyPill)}</div></div>
      <div class="frow"><span class="flabel">Structure</span>
        <div class="fpills">{STRUCTURES.map(v =>
          <Pill label={structLabel(v)} active={f.structure === v} onClick={() => set('structure', v)} />)}</div></div>
      <div class="frow"><span class="flabel">Tempo</span>
        <div class="fpills">{TEMPO_BANDS.map(b =>
          <Pill label={b.label} active={f.tempo === b.value} onClick={() => set('tempo', b.value)} />)}</div></div>
      <button type="button" class="btn ghost"
              onClick={() => { State.filter = { singer: '', key: '', structure: '', tempo: '' }; renderSongs(); }}>
        Clear filters
      </button>
    </div>
  );
}

// ---- A single song card ------------------------------------------------- //
function SongCard({ song, isIn }) {
  // toggleInSet wants the add button (it gets the pop animation); capture it.
  let addBtn;
  return (
    <div class="song" style={{ borderLeftColor: keyColor(song.key) }}>
      <div class="main">
        <div class="title">{song.title}</div>
        {song.artist && <div class="artist">{song.artist}</div>}
        <div class="badges">{badges(song)}</div>
      </div>
      <div class="right">
        <button class={`iconbtn ${isIn ? 'in' : 'add'}`} title={isIn ? 'In set' : 'Add to set'}
                ref={n => addBtn = n} onClick={() => UI.toggleInSet(song, addBtn)}>
          {isIn ? '✓' : '+'}
        </button>
        <button class="iconbtn" title="Edit" onClick={() => UI.songForm(song)}>✎</button>
      </div>
    </div>
  );
}

// ---- View: Songs -------------------------------------------------------- //
export function renderSongs() {
  const view = $('#view');
  const inSet = new Set((State.current?.songs || []).map(s => s.id));
  const filtered = filteredSongs();
  const fcount = activeFilterCount();
  const q = State.search;

  const countText =
    `${filtered.length} song${filtered.length === 1 ? '' : 's'}`
    + (State.current ? ` · adding to “${State.current.name}”` : '');

  view.replaceChildren(
    <Fragment>
      <div class="toolbar">
        <input type="search" id="search" placeholder="Search songs…" value={State.search}
               onInput={(e) => { State.search = e.target.value; renderSongs(); }} />
        <button class={`btn ${fcount ? 'primary' : ''}`}
                onClick={() => { State.filterOpen = !State.filterOpen; renderSongs(); }}>
          ⚲ Filter{fcount ? ' ·' + fcount : ''}
        </button>
        <button class="btn primary" onClick={() => UI.songForm()}>+ Add</button>
      </div>
      <div id="filterPanel"></div>
      <p class="count">{countText}</p>
      <div class="list" id="songlist"></div>
    </Fragment>
  );

  if (State.filterOpen) renderFilterPanel($('#filterPanel'));

  const list = $('#songlist');
  if (!filtered.length) {
    list.append(
      <div class="empty">
        <p>No songs{q ? ' match your search' : ' yet'}.</p>
        <p>{q ? '' : <Fragment>Tap <b>+ Add</b> to add your first song.</Fragment>}</p>
      </div>
    );
  }
  for (const s of filtered) {
    list.append(<SongCard song={s} isIn={inSet.has(s.id)} />);
  }

  // keep focus & caret after re-render
  const search = $('#search');
  if (document.activeElement?.id !== 'search' && State.search) {
    search.focus(); search.setSelectionRange(search.value.length, search.value.length);
  }
}
