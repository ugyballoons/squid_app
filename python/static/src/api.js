/* JSON API client for the /api endpoints in main.py. */
'use strict';

export const API = {
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
