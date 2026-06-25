/* Tiny DOM helpers shared across views. */
'use strict';

export const $ = (sel, root = document) => root.querySelector(sel);

export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

export function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---- JSX runtime -------------------------------------------------------- //
// h() is the JSX factory (configured in vite.config.js). It builds and returns
// a *real* DOM node — there's no virtual DOM and no diffing — so the output
// drops straight into appendChild/innerHTML and the imperative drag code can
// keep measuring and moving the nodes it gets. Writing <div/> in a .jsx file
// compiles to h('div', props, ...children); <>…</> compiles to Fragment(...).
//
// Text children are added via textContent/createTextNode, so interpolations are
// auto-escaped — no esc() needed and no innerHTML XSS footgun. To inject raw,
// pre-built markup, pass nodes (e.g. an array from a helper) rather than a
// string.
export function h(tag, props, ...children) {
  // A function tag is a component: call it with its props (+ children).
  if (typeof tag === 'function') return tag({ ...props, children });

  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;        // skip absent/false attrs
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'ref' && typeof v === 'function') v(node);
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v); // onClick -> 'click'
    else if (k in node && k !== 'list') node[k] = v;      // value, disabled, selected…
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

// <>…</> — group siblings without a wrapper element.
export function Fragment(props) {
  const frag = document.createDocumentFragment();
  appendChildren(frag, props?.children || []);
  return frag;
}

// Append a (possibly nested) list of children, skipping null/false/undefined and
// turning primitives into (escaped) text nodes.
function appendChildren(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    parent.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
