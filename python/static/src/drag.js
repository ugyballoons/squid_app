/* Drag-and-drop reordering (section-aware).
 *
 * Pointer Events power this so it works identically with mouse, touch and pen
 * (HTML5 drag-and-drop never fires from touch, so dragging was dead on phones).
 * The drag is started only from the grip handle, which keeps the rest of the
 * row free for normal page scrolling on a touchscreen. While dragging we move
 * the row through the DOM live — within a section or across sections — and on
 * release rebuild the flat ordered list (with per-song sections) from the DOM. */
'use strict';

import { State, History, keepEmptySectionAt, pruneEmptySections } from './state.js';
import { refreshUndoButtons } from './order.js';
import { UI } from './ui.js';
import { renderSet } from './views/setlist.jsx';

export function attachDrag(item, wrap) {
  const grip = item.querySelector('.grip');
  if (!grip) return;
  grip.addEventListener('pointerdown', (e) => startPointerDrag(e, item));
}

// The row currently being dragged, plus a small autoscroll loop so you can drag
// past the top/bottom of a long set on a short screen.
let dragState = null;
// Set when a renderSet() is requested mid-drag; flushed when the drag ends.
let pendingRenderSet = false;

// Whether a drag is currently in flight — renderSet() checks this to defer
// rebuilding the list out from under an active drag.
export function isDragging() { return dragState != null; }
// Called by renderSet() when it bailed out mid-drag, so endPointerDrag can
// flush the deferred render.
export function requestRenderSet() { pendingRenderSet = true; }

function startPointerDrag(e, item) {
  // Only the primary button / single touch starts a drag.
  if (e.button != null && e.button !== 0) return;
  // Ignore a second pointer starting a drag while one is already in progress —
  // two concurrent drags fight over the same rows and can flash a stray row.
  if (dragState) return;
  e.preventDefault();
  item.classList.add('dragging');
  // Capture so we keep getting moves even if the finger drifts off the grip.
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  // grabDy: where within the row the finger landed, so the row tracks the
  // finger from that point rather than snapping its top to the cursor.
  const rect = item.getBoundingClientRect();
  dragState = {
    item, pointerId: e.pointerId, target: e.target, scrollTimer: null,
    grabDy: e.clientY - rect.top, lastY: e.clientY,
    // Snapshot the order before the drag so it can be pushed to undo history
    // when (and only when) the drag actually changes something.
    before: History.snapshot(),
  };

  const onMove = (ev) => onPointerDragMove(ev);
  const onUp = (ev) => {
    if (ev.pointerId !== dragState.pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    endPointerDrag();
  };
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function onPointerDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  e.preventDefault(); // stop the page scrolling under the finger while dragging
  const item = dragState.item;
  const y = e.clientY;

  // Which section list is the finger over? Reparent the row into it so songs
  // can be moved between sections, then position within that list.
  const wraps = [...document.querySelectorAll('.sortable')];
  const overWrap = wraps.find(w => {
    const r = w.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });
  if (overWrap) {
    const siblings = [...overWrap.querySelectorAll('.so-item')].filter(n => n !== item);
    const after = siblings.find(n => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    // Only touch the DOM (and run the slide animation) when the order changes.
    const willChange = after ? item.nextSibling !== after : overWrap.lastElementChild !== item;
    if (willChange) {
      flipReorder(() => {
        if (after) overWrap.insertBefore(item, after);
        else overWrap.appendChild(item);
      });
      renumberPositions();
    }
  }

  dragState.lastY = y;
  followFinger(y);
  // Autoscroll when near the top/bottom edge of the viewport.
  autoscrollNearEdge(y);
}

// Glue the dragged row to the finger: offset it so the point the user grabbed
// stays under the pointer. Measured against the row's *resting* layout position
// (transform cleared first) so reorders underneath don't make it jump.
function followFinger(y) {
  const item = dragState.item;
  item.style.transition = 'none';
  item.style.transform = '';
  const rect = item.getBoundingClientRect();
  const restTop = rect.top;
  let offset = y - dragState.grabDy - restTop;
  // Clamp travel to the set-list area so a fast drag can't fling the row up
  // over the toolbar/selector (where it looked like a stray extra song) or
  // below the last section. Bounds = top of the first list .. bottom of last.
  const lists = [...document.querySelectorAll('.sortable')];
  if (lists.length) {
    const top = lists[0].getBoundingClientRect().top;
    const bottom = lists[lists.length - 1].getBoundingClientRect().bottom;
    const minOffset = top - restTop;                 // row top can't go above list top
    const maxOffset = bottom - rect.height - restTop; // row bottom can't go below list bottom
    offset = Math.max(minOffset, Math.min(maxOffset, offset));
  }
  item.style.transform = `translateY(${offset}px)`;
}

// FLIP: animate the rows that shift when the dragged row is reinserted, so they
// visibly slide into place instead of jumping. The dragged row itself is left
// alone — it's tracking the finger and should not be transitioned.
function flipReorder(mutate) {
  const rows = [...document.querySelectorAll('.so-item')].filter(n => n !== dragState.item);
  // Snap any rows still mid-animation to their resting position before we
  // measure, so deltas are computed from real layout, not a tweened transform.
  rows.forEach(n => { n.style.transition = 'none'; n.style.transform = ''; });
  const first = new Map(rows.map(n => [n, n.getBoundingClientRect().top]));
  mutate();
  for (const n of rows) {
    const delta = first.get(n) - n.getBoundingClientRect().top;
    if (!delta) continue;
    n.style.transition = 'none';
    n.style.transform = `translateY(${delta}px)`;
    // Next frame: clear the offset and let the transition animate to zero.
    requestAnimationFrame(() => {
      n.style.transition = 'transform .18s ease';
      n.style.transform = '';
    });
  }
}

function autoscrollNearEdge(y) {
  const margin = 60, speed = 12;
  let dy = 0;
  if (y < margin) dy = -speed;
  else if (y > window.innerHeight - margin) dy = speed;
  dragState.scrollDy = dy;
  if (dy && dragState.scrollTimer == null) {
    dragState.scrollTimer = setInterval(() => {
      window.scrollBy(0, dragState.scrollDy || 0);
      // Keep the row pinned under the finger as the page scrolls beneath it.
      followFinger(dragState.lastY);
    }, 16);
  } else if (!dy && dragState.scrollTimer != null) {
    clearInterval(dragState.scrollTimer);
    dragState.scrollTimer = null;
  }
}

function endPointerDrag() {
  if (!dragState) return;
  if (dragState.scrollTimer != null) clearInterval(dragState.scrollTimer);
  try { dragState.target.releasePointerCapture(dragState.pointerId); } catch {}
  const item = dragState.item;
  item.classList.remove('dragging');
  // Settle: let the dragged row slide from where the finger left it back into
  // its resting slot, instead of snapping. Other rows already sit at rest.
  document.querySelectorAll('.so-item').forEach(n => {
    if (n !== item) { n.style.transition = ''; n.style.transform = ''; }
  });
  item.style.transition = 'transform .15s ease';
  item.style.transform = '';
  const done = () => { item.style.transition = ''; item.removeEventListener('transitionend', done); };
  item.addEventListener('transitionend', done);
  const before = dragState.before;
  dragState = null;
  commitOrderFromDom(before);
  // Flush any render that was deferred because it arrived mid-drag.
  if (pendingRenderSet) { pendingRenderSet = false; renderSet(); }
}

// Renumber the .pos labels live from the current DOM order, per section, so the
// numbers track the drag instead of waiting for the post-save re-render.
export function renumberPositions() {
  document.querySelectorAll('.sortable').forEach(wrap => {
    wrap.querySelectorAll('.so-item').forEach((n, i) => {
      const pos = n.querySelector('.pos');
      if (pos) pos.textContent = i + 1;
    });
  });
}

function commitOrderFromDom(before) {
  const cur = State.current.songs;
  const byId = new Map(cur.map(s => [s.id, s]));
  // Snapshot current sections *before* the rebuild mutates them, so the
  // change-detection below can see a section-only move (same song order, new
  // section) — otherwise mutating s.section in place defeats the comparison.
  const prevSection = new Map(cur.map(s => [s.id, s.section || 'Set 1']));

  const rebuilt = [];
  const seen = new Set();
  // Section names present as wraps in the DOM (in order) and which of them the
  // drag left without any songs.
  const domSections = [];
  const emptiedNow = [];
  document.querySelectorAll('.sortable').forEach(wrap => {
    const section = wrap.dataset.section || 'Set 1';
    domSections.push(section);
    const items = wrap.querySelectorAll('.so-item');
    if (!items.length) emptiedNow.push(section);
    items.forEach(n => {
      const id = +n.dataset.id;
      // A song appears at most once per set (the All Songs toggle enforces this).
      // Guard here too so a stray duplicate row can never be committed twice —
      // which previously surfaced as a song appearing at both ends after a drag.
      if (seen.has(id)) return;
      const s = byId.get(id);
      if (s) { s.section = section; rebuilt.push(s); seen.add(id); }
    });
  });
  if (!rebuilt.length) return;
  const unchanged = rebuilt.length === cur.length &&
    rebuilt.every((s, i) => s === cur[i] && (s.section || 'Set 1') === prevSection.get(s.id));
  if (unchanged) return;

  // Did the set of occupied sections change? If so the headers/placeholders are
  // now stale and we must re-render (the drag has ended by the time we commit).
  const beforeSecs = new Set(prevSection.values());
  if (before) History.push(before); // record the pre-drag order for undo
  State.current.songs = rebuilt;

  // Keep any section the drag emptied visible (as a drop target), positioned
  // after its DOM predecessor; drop kept-empty entries that regained songs.
  emptiedNow.forEach(name => {
    const i = domSections.indexOf(name);
    keepEmptySectionAt(name, i > 0 ? domSections[i - 1] : null);
  });
  pruneEmptySections();

  const afterSecs = new Set(rebuilt.map(s => s.section || 'Set 1'));
  const sectionsChanged = beforeSecs.size !== afterSecs.size ||
    [...beforeSecs].some(s => !afterSecs.has(s));

  // rerender when membership changed so stale placeholders/headers are rebuilt.
  UI.saveOrder({ rerender: sectionsChanged, optimistic: sectionsChanged });
  refreshUndoButtons();
}
