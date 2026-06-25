/* View: Set list — section blocks, the sortable rows, and the toolbar.
 *
 * JSX (compiled to h()/Fragment, no React) builds the static chrome: the
 * set-list picker and the toolbar. The sortable rows are deliberately left as
 * imperative DOM built with el(): they're the nodes the drag code measures and
 * moves (attachDrag / FLIP / commitOrderFromDom), so JSX stays out of that
 * island. This file shows the two coexisting in one view. */
/** @jsx h */
'use strict';

import { State, History, sectionNames } from '../state.js';
import { h, $ } from '../dom.js';
import { UI } from '../ui.js';
import { refreshUndoButtons } from '../order.js';
import { attachDrag, isDragging, requestRenderSet } from '../drag.js';
import { keyColor, tempoBand, fmtMinutes } from '../encoding.js';

// The set-list picker + New button (static chrome).
function SetlistHead() {
  return (
    <div class="setlist-head">
      <select onChange={(e) => UI.selectSetlist(e.target.value ? +e.target.value : null)}>
        <option value="">— choose a set list —</option>
        {State.setlists.map(s =>
          <option value={s.id} selected={s.id === State.currentSetlistId}>
            {`${s.name} (${s.song_count})`}
          </option>)}
      </select>
      <button class="btn" title="New set list" onClick={() => UI.newSetlist()}>+ New</button>
    </div>
  );
}

// The set-list toolbar: undo/redo + the set-level actions. Undo/Redo keep their
// ids so refreshUndoButtons() can enable/disable them by id from elsewhere.
function SetlistToolbar({ current, countText }) {
  return (
    <div>
      <div class="toolbar">
        <button class="btn ghost" id="undoBtn" title="Undo (⌘Z)" aria-label="Undo"
                onClick={() => UI.undo()}>↶ Undo</button>
        <button class="btn ghost" id="redoBtn" title="Redo (⌘⇧Z)" aria-label="Redo"
                onClick={() => UI.redo()}>↷ Redo</button>
        <button class="btn ghost" onClick={() => UI.renameSetlist()}>✎ Rename</button>
        <button class="btn ghost" onClick={() => UI.duplicateSetlist()}>⧉ Duplicate</button>
        <button class="btn danger" onClick={() => UI.deleteSetlist()}>🗑 Delete</button>
        <a class="btn primary" href={`/print/${current.id}`} target="_blank" rel="noopener">🖨 Print</a>
      </div>
      <p class="count">{countText}</p>
    </div>
  );
}

export function renderSet() {
  // Never rebuild the list while a drag is active: it would replace the rows
  // out from under the in-flight drag, and a pointermove landing afterwards
  // could re-attach the now-orphaned dragged row into the fresh list (the
  // momentary "third song"). Defer until the drag ends.
  if (isDragging()) { requestRenderSet(); return; }
  const view = $('#view');

  // Chrome: the picker, plus an empty #set-body the rest fills imperatively.
  view.replaceChildren(
    <div>
      <SetlistHead />
      <div id="set-body"></div>
    </div>
  );

  const body = $('#set-body');
  if (!State.current) {
    body.append(
      <div class="empty">
        <p>{State.setlists.length ? 'Choose a set list above,' : 'No set lists yet.'}</p>
        <p>or tap <b>+ New</b> to create one.</p>
      </div>
    );
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
  const countText =
    `${songs.length} song${songs.length === 1 ? '' : 's'} in ${names.length} section${names.length === 1 ? '' : 's'}`
    + (lenNote ? ' · ' + lenNote : '');

  body.append(<SetlistToolbar current={State.current} countText={countText} />);
  refreshUndoButtons();

  if (!songs.length) {
    body.append(
      <div class="empty"><p>This set is empty.</p><p>Tap <b>+ Songs</b> to fill it.</p></div>
    );
  }

  // ---- Imperative drag island ------------------------------------------- //
  // The section wraps and .so-item rows below are built with el() and left as
  // plain DOM on purpose: attachDrag/FLIP/commitOrderFromDom read and move
  // these exact nodes (data-id, .pos, .sortable). JSX deliberately stops here.
  for (const name of (songs.length ? names : [])) {
    const inSec = songs.map((s, idx) => ({ s, idx })).filter(o => (o.s.section || 'Set 1') === name);
    const secMin = inSec.reduce((sum, o) => sum + (o.s.length_min || 0), 0);

    const head = (
      <div class="sec-head">
        <span class="sec-name">{name}</span>
        <span class="sec-meta">
          {`${inSec.length} song${inSec.length === 1 ? '' : 's'}${secMin ? ' · ~' + fmtMinutes(secMin) : ''}`}
        </span>
        <span class="sec-tools">
          <button class="linkbtn" onClick={() => UI.renameSection(name)}>rename</button>
          {multi && <button class="linkbtn danger" onClick={() => UI.removeSection(name)}>remove section</button>}
        </span>
      </div>
    );
    body.appendChild(head);

    const wrap = <div class="list sortable" data-section={name}></div>;
    inSec.forEach((o, localPos) => {
      const s = o.s, band = tempoBand(s.tempo_min, s.tempo_max);
      const meta = `${s.singer ? s.singer + ' · ' : ''}${s.key ? 'Key ' + s.key + ' · ' : ''}`;
      // Row built with JSX, but it's still a real node the drag code can move.
      const item = (
        <div class="so-item" data-id={s.id} style={{ borderLeftColor: keyColor(s.key) }}>
          <div class="grip" title="Drag to reorder">⠿</div>
          <div class="pos">{localPos + 1}</div>
          <div class="main">
            <div class="title">{s.title}</div>
            <div class="meta">
              {meta}harp <b>{s.cross_harp || '—'}</b>{s.length_min != null ? ' · ' + s.length_min + 'm' : ''}{band ? ' · ' + band.label : ''}
            </div>
          </div>
          <button class="iconbtn danger" title="Remove" style={{ color: 'var(--danger)' }}
                  onClick={() => UI.removeFromSet(s.id, item)}>✕</button>
        </div>
      );
      attachDrag(item, wrap);
      wrap.appendChild(item);
    });
    if (!inSec.length) {
      wrap.appendChild(<div class="empty small"><p>Empty section.</p></div>);
    }
    body.appendChild(wrap);
  }

  // Footer: add a new section.
  if (songs.length) {
    body.append(<button class="btn ghost addsec" onClick={() => UI.addSection()}>+ Add section</button>);
  }
}
