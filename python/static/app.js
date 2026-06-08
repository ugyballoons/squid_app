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
const State = {
  tab: 'songs',
  songs: [],
  search: '',
  // Filters for the song list. Empty string = no filter.
  filter: { singer: '', key: '', structure: '', tempo: '' },
  filterOpen: false,
  singers: { primary: ['Ric', 'Eddy'], all: ['Ric', 'Eddy'] },
  setlists: [],
  currentSetlistId: null,
  // current.songs is the flat ordered list; each song carries a `.section`.
  current: null, // {id, name, songs:[], sections:[]}
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
    addBtn.onclick = () => UI.toggleInSet(s);
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
function sectionNames() {
  const names = [];
  for (const s of State.current.songs) {
    const n = s.section || 'Set 1';
    if (!names.includes(n)) names.push(n);
  }
  return names.length ? names : ['Set 1'];
}

// ---- View: Set list ----------------------------------------------------- //
function renderSet() {
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
        <button class="btn ghost" onclick="UI.renameSetlist()">✎ Rename</button>
        <button class="btn ghost" onclick="UI.duplicateSetlist()">⧉ Duplicate</button>
        <button class="btn ghost" onclick="UI.show('songs')">+ Songs</button>
        <a class="btn primary" href="/print/${State.current.id}" target="_blank" rel="noopener">🖨 Print</a>
      </div>
      <p class="count">${songs.length} song${songs.length === 1 ? '' : 's'} in ${names.length} section${names.length === 1 ? '' : 's'}${lenNote ? ' · ' + lenNote : ''}</p>
    </div>`));

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
        <div class="so-item" draggable="true" data-id="${s.id}" style="border-left-color:${keyColor(s.key)}">
          <div class="grip" title="Drag to reorder">⠿</div>
          <div class="pos">${localPos + 1}</div>
          <div class="main">
            <div class="title">${esc(s.title)}</div>
            <div class="meta">${s.singer ? esc(s.singer) + ' · ' : ''}${s.key ? 'Key ' + esc(s.key) + ' · ' : ''}harp <b>${esc(s.cross_harp || '—')}</b>${s.length_min != null ? ' · ' + s.length_min + 'm' : ''}${band ? ' · ' + band.label : ''}</div>
          </div>
          <div class="so-reorder">
            <button title="Up">▲</button>
            <button title="Down">▼</button>
          </div>
          <button class="iconbtn danger" title="Remove" style="color:var(--danger)">✕</button>
        </div>`);
      const [upBtn, downBtn] = item.querySelectorAll('.so-reorder button');
      upBtn.onclick = () => UI.moveInSection(name, localPos, -1);
      downBtn.onclick = () => UI.moveInSection(name, localPos, 1);
      item.querySelector('.iconbtn.danger').onclick = () => UI.removeFromSet(o.idx);
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
// Items can be dragged within a section or across sections; the dragged item
// takes on the section of whichever list it ends up in. After a drop we rebuild
// the flat ordered list (with per-song sections) from the DOM.
function attachDrag(item, wrap) {
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id);
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.dragover').forEach(n => n.classList.remove('dragover'));
    commitOrderFromDom();
  });
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.dragging');
    if (!dragging || dragging === item) return;
    const rect = item.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    item.parentNode.insertBefore(dragging, after ? item.nextSibling : item);
  });
  // Allow dropping into an empty area of a section list.
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.dragging');
    if (dragging && !wrap.querySelector('.so-item')) wrap.appendChild(dragging);
  });
}

function commitOrderFromDom() {
  const byId = new Map(State.current.songs.map(s => [s.id, s]));
  const rebuilt = [];
  document.querySelectorAll('.sortable').forEach(wrap => {
    const section = wrap.dataset.section || 'Set 1';
    wrap.querySelectorAll('.so-item').forEach(n => {
      const s = byId.get(+n.dataset.id);
      if (s) { s.section = section; rebuilt.push(s); }
    });
  });
  if (!rebuilt.length) return;
  const cur = State.current.songs;
  const unchanged = rebuilt.length === cur.length &&
    rebuilt.every((s, i) => s === cur[i] && s.section === (cur[i].section || 'Set 1'));
  State.current.songs = rebuilt;
  if (unchanged) return;
  UI.saveOrder();
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
    $('#tab-songs').classList.toggle('active', tab === 'songs');
    $('#tab-set').classList.toggle('active', tab === 'set');
    tab === 'songs' ? renderSongs() : renderSet();
  },
  songForm(song) { songForm(song); },

  async toggleInSet(song) {
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
    if (idx >= 0) {
      songs.splice(idx, 1);
    } else {
      // Add to the last section in use (so new picks land in the section the
      // user is currently building).
      const names = sectionNames();
      songs.push({ ...song, section: names[names.length - 1] });
    }
    State.current = await persistOrder();
    toast(idx >= 0 ? 'Removed from set' : `Added to “${State.current.name}”`);
    renderSongs();
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

  async selectSetlist(id, stayOnSongs) {
    State.currentSetlistId = id;
    State.current = id ? await API.getSetlist(id) : null;
    if (!stayOnSongs) renderSet(); else renderSongs();
  },

  async saveOrder() {
    State.current = await persistOrder();
    renderSet();
  },

  // Move a song up/down within its own section (delta -1 or +1).
  moveInSection(section, localPos, delta) {
    const songs = State.current.songs;
    const idxs = songs.map((s, i) => i).filter(i => (songs[i].section || 'Set 1') === section);
    const target = localPos + delta;
    if (target < 0 || target >= idxs.length) return;
    const a = idxs[localPos], b = idxs[target];
    [songs[a], songs[b]] = [songs[b], songs[a]];
    UI.saveOrder();
  },

  async removeFromSet(idx) {
    State.current.songs.splice(idx, 1);
    await UI.saveOrder();
  },

  addSection() {
    const name = prompt('New section name:', `Set ${sectionNames().length + 1}`);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (sectionNames().includes(trimmed)) { toast('Section already exists'); return; }
    // An empty section has no rows to persist yet, so show it transiently; it
    // becomes permanent as soon as a song is dragged (or added) into it.
    renderSetWithPending(trimmed);
    toast(`Drag songs into “${trimmed}”`);
  },

  renameSection(oldName) {
    const name = prompt('Rename section:', oldName);
    if (!name || !name.trim() || name.trim() === oldName) return;
    const trimmed = name.trim();
    State.current.songs.forEach(s => { if ((s.section || 'Set 1') === oldName) s.section = trimmed; });
    UI.saveOrder();
  },

  removeSection(name) {
    // "Remove section" merges its songs into the first remaining section.
    const names = sectionNames();
    const fallback = names.find(n => n !== name) || 'Set 1';
    if (!confirm(`Remove section “${name}”? Its songs move into “${fallback}”.`)) return;
    State.current.songs.forEach(s => { if ((s.section || 'Set 1') === name) s.section = fallback; });
    UI.saveOrder();
  },
};
window.UI = UI;

// Persist the current flat ordered list (with sections) and return the fresh
// server view.
async function persistOrder() {
  const items = State.current.songs.map(s => ({ song_id: s.id, section: s.section || 'Set 1' }));
  return API.setItems(State.current.id, items);
}

// Re-render the set with an extra, currently-empty section shown at the end so
// the user can drag songs into it.
function renderSetWithPending(pendingName) {
  renderSet();
  const body = $('#set-body');
  if (!body) return;
  const head = el(`
    <div class="sec-head pending">
      <span class="sec-name">${esc(pendingName)}</span>
      <span class="sec-meta">new · drag songs here</span>
    </div>`);
  const wrap = el(`<div class="list sortable" data-section="${esc(pendingName)}"></div>`);
  wrap.appendChild(el(`<div class="empty small"><p>Drag songs here, or add from the Songs tab.</p></div>`));
  // attach a drop target
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.dragging');
    if (dragging && !wrap.querySelector('.so-item')) wrap.appendChild(dragging);
  });
  // insert before the "+ Add section" button if present
  const addBtn = body.querySelector('.addsec');
  body.insertBefore(head, addBtn);
  body.insertBefore(wrap, addBtn);
}

// ---- Boot --------------------------------------------------------------- //
async function refreshAll() {
  [State.songs, State.setlists, State.singers] =
    await Promise.all([API.songs(), API.setlists(), API.singers()]);
  if (State.currentSetlistId && State.setlists.some(s => s.id === State.currentSetlistId)) {
    State.current = await API.getSetlist(State.currentSetlistId);
  } else if (!State.setlists.some(s => s.id === State.currentSetlistId)) {
    State.currentSetlistId = null; State.current = null;
  }
  State.tab === 'songs' ? renderSongs() : renderSet();
}

refreshAll().catch(err => {
  $('#view').innerHTML = `<div class="empty"><p>Couldn't load.</p><p>${esc(err.message)}</p></div>`;
});
