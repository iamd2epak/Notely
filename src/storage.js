import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SCHEMA, initialData, migrateV1, normalize } from './data';

const LEGACY_KEY = '@notes/v1';
const mainFile = () => new File(Paths.document, 'notely-data.json');
const tmpFile = () => new File(Paths.document, 'notely-data.tmp.json');

function readJson(file) {
  if (!file.exists) return null;
  const raw = file.textSync();
  return raw ? JSON.parse(raw) : null;
}

// Returns { notes, topics }. Throws if existing data can't be read, so the caller
// never overwrites a user's notes with defaults by mistake.
export async function loadData() {
  let raw = null;
  try {
    raw = readJson(mainFile());
  } catch (e) {
    // Main file is damaged; a completed temp write is the next best copy.
    raw = readJson(tmpFile());
    if (!raw) throw e;
  }
  if (!raw) raw = readJson(tmpFile()); // crash between write and rename
  if (raw) return normalize(raw);

  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const data = migrateV1(JSON.parse(legacy));
    saveData(data);
    AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
    return data;
  }
  return initialData();
}

// Write to a temp file then rename over the real one, so a crash mid-write can't corrupt notes.
export function saveData({ notes, topics, prefs, vault }) {
  try {
    const json = JSON.stringify({ schema: SCHEMA, notes, topics, prefs, vault: vault ?? null });
    const tmp = tmpFile();
    tmp.write(json);
    tmp.moveSync(mainFile(), { overwrite: true });
    return true;
  } catch (e) {
    console.warn('Saving notes failed', e);
    return false;
  }
}
