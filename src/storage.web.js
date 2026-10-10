import { SCHEMA, initialData, normalize } from './data';

const KEY = 'notely-data';

export async function loadData() {
  const raw = window.localStorage.getItem(KEY);
  return raw ? normalize(JSON.parse(raw)) : initialData();
}

export function saveData({ notes, topics, prefs, vault }) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, notes, topics, prefs, vault: vault ?? null }));
    return true;
  } catch (e) {
    console.warn('Saving notes failed', e);
    return false;
  }
}
