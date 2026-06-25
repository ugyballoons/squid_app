/* Boot: load data from the API and route to the saved view. */
'use strict';

import { State, Session } from './state.js';
import { API } from './api.js';
import { UI } from './ui.js';

export async function refreshAll() {
  [State.songs, State.setlists, State.singers] =
    await Promise.all([API.songs(), API.setlists(), API.singers()]);
  // Restore the last-viewed set list if it still exists; otherwise clear it.
  if (State.currentSetlistId && State.setlists.some(s => s.id === State.currentSetlistId)) {
    State.current = await API.getSetlist(State.currentSetlistId);
  } else {
    State.currentSetlistId = null; State.current = null;
    Session.save({ setlistId: null });
  }
  // Route through show() so the restored tab also highlights the right button.
  UI.show(State.tab);
}
