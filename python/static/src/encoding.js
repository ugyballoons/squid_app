/* Visual encoding: keys -> colours, tempo -> bands, label/format helpers.
 * Pure functions and constants, no DOM. */
'use strict';

// 12 pitch classes around the circle, each with a distinct hue. Index by the
// chromatic position (C=0 .. B=11). Chosen for good separation on a phone.
export const KEY_COLORS = {
  'C':  '#ff6b6b', 'C#': '#ff9f43', 'D':  '#feca57', 'D#': '#c8e65c',
  'E':  '#1dd1a1', 'F':  '#2ed5d0', 'F#': '#54a0ff', 'G':  '#5f7bff',
  'G#': '#a55eea', 'A':  '#e26bd6', 'A#': '#ff7eb3', 'B':  '#ff8a8a',
};
// Flat spellings map onto the sharp swatch colours.
const FLAT_ALIAS = { 'DB':'C#','EB':'D#','GB':'F#','AB':'G#','BB':'A#' };

export const PITCHES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function pitchOf(key) {
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

export function keyColor(key) {
  const p = pitchOf(key);
  return (p && KEY_COLORS[p]) || '#6b7280';
}

// Tempo -> speed band. Uses the midpoint of the range.
export function tempoBand(min, max) {
  const vals = [min, max].filter(v => v != null);
  if (!vals.length) return null;
  const bpm = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (bpm < 80)  return { cls: 'spd-slow',     label: 'Slow' };
  if (bpm < 110) return { cls: 'spd-medium',   label: 'Medium' };
  if (bpm < 140) return { cls: 'spd-fast',     label: 'Fast' };
  return { cls: 'spd-veryfast', label: 'V.Fast' };
}

export function structLabel(s) {
  if (!s) return null;
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Total minutes -> "h:mm" or "m min" for display.
export function fmtMinutes(total) {
  total = Math.round(total || 0);
  if (total <= 0) return '0 min';
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

export const TEMPO_BANDS = [
  { value: 'spd-slow', label: 'Slow' },
  { value: 'spd-medium', label: 'Medium' },
  { value: 'spd-fast', label: 'Fast' },
  { value: 'spd-veryfast', label: 'V.Fast' },
];

// Structure option values, shared by the filter panel and the song form.
export const STRUCTURES = ['twelve_bar','eight_bar','sixteen_bar','one_chord','two_chord','jam','other'];
