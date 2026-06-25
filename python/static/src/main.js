/* Squid Set Lists — client app entry point.
 *
 * Plain JS, no framework. Talks to the /api JSON endpoints in main.py. The app
 * is split into ES modules under src/; Vite bundles them into build/app.js,
 * which index.html loads. See vite.config.js for the build wiring.
 *
 * Module map:
 *   encoding.js   key colours, tempo bands, label/format helpers (pure)
 *   dom.js        $, el, esc, toast
 *   api.js        the /api JSON client
 *   state.js      Session, History, State + section bookkeeping
 *   order.js      persist/snapshot/undo-button helpers
 *   drag.js       pointer-driven, section-aware drag reordering + FLIP
 *   views/        songs, setlist, songForm renderers
 *   ui.js         the window.UI action object
 *   boot.js       initial data load + routing
 */
'use strict';

import { State } from './state.js';
import { $, esc } from './dom.js';
import { UI } from './ui.js';
import { refreshAll } from './boot.js';

// The rendered markup uses inline onclick="UI.…" handlers, so UI must be global.
window.UI = UI;

// Keyboard shortcuts for undo/redo while viewing a set list (desktop).
document.addEventListener('keydown', (e) => {
  if (State.tab !== 'set' || !State.current) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.key.toLowerCase() !== 'z') return;
  // Don't hijack undo while typing in an input/textarea.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  if (e.shiftKey) UI.redo(); else UI.undo();
});

refreshAll().catch(err => {
  $('#view').innerHTML = `<div class="empty"><p>Couldn't load.</p><p>${esc(err.message)}</p></div>`;
});
