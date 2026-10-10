// Pure data helpers: note/topic shape, migration, ordering. No I/O here.
import { noteColors } from './theme';
import { ENCRYPTED_KIND, isVault } from './crypto';

export const SCHEMA = 2;
export const MAX_TOPICS = 6;
export const MAX_TOPIC_NAME = 18;

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v, d) => (Number.isFinite(v) ? v : d);

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Notes created before rich text only had plain text; convert one <div> per line.
export function textToHtml(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => (line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>'))
    .join('');
}

// Every note belongs to a topic; unknown/missing topics fall back to the default one.
export function sanitizeNote(n, topicIds, fallbackTopicId) {
  if (!n || typeof n !== 'object' || typeof n.id !== 'string') return null;
  const now = Date.now();
  // Locked notes keep only ciphertext; their title/content are never stored in plain text.
  const enc = n.enc && typeof n.enc.iv === 'string' && typeof n.enc.ct === 'string' ? { iv: n.enc.iv, ct: n.enc.ct } : null;
  if (n.locked && enc) {
    return {
      id: n.id,
      title: '',
      body: '',
      html: '',
      locked: true,
      enc,
      topicId: typeof n.topicId === 'string' && topicIds.has(n.topicId) ? n.topicId : fallbackTopicId,
      pinned: !!n.pinned,
      createdAt: num(n.createdAt, now),
      updatedAt: num(n.updatedAt, now),
    };
  }
  const body = str(n.body);
  return {
    id: n.id,
    title: str(n.title),
    body, // plain-text version, used for previews, search and word count
    html: typeof n.html === 'string' ? n.html : textToHtml(body),
    topicId: typeof n.topicId === 'string' && topicIds.has(n.topicId) ? n.topicId : fallbackTopicId,
    pinned: !!n.pinned,
    createdAt: num(n.createdAt, now),
    updatedAt: num(n.updatedAt, now),
  };
}

export function sanitizeTopic(t, usedColors) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string') return null;
  const name = str(t.name).trim().slice(0, MAX_TOPIC_NAME);
  if (!name) return null;
  let color = noteColors.some((c) => c.key === t.color) ? t.color : null;
  if (!color || usedColors.has(color)) color = noteColors.find((c) => !usedColors.has(c.key))?.key;
  if (!color) return null;
  usedColors.add(color);
  return { id: t.id, name, color, isDefault: t.isDefault === true };
}

// Exactly one topic is the default ("Personal"): it receives new notes and notes whose
// topic was deleted, and it can't be deleted itself.
export function ensureDefaultTopic(topics) {
  let def =
    topics.find((t) => t.isDefault) ?? topics.find((t) => t.name.trim().toLowerCase() === 'personal');
  let list = topics;
  if (!def) {
    const used = new Set(topics.map((t) => t.color));
    const color = noteColors.find((c) => !used.has(c.key))?.key;
    if (topics.length < MAX_TOPICS && color) {
      def = { id: newId() + 'p', name: 'Personal', color, isDefault: true };
      list = [def, ...topics];
    } else {
      def = topics[0];
    }
  }
  return list.map((t) => ({ ...t, isDefault: t.id === def.id }));
}

export const defaultTopicId = (topics) => (topics.find((t) => t.isDefault) ?? topics[0])?.id ?? null;

// Pinned notes always come first; otherwise the array order is the user's order.
export const pinnedFirst = (notes) => [...notes.filter((n) => n.pinned), ...notes.filter((n) => !n.pinned)];

export function normalize(raw) {
  const used = new Set();
  const topics = ensureDefaultTopic(
    (Array.isArray(raw?.topics) ? raw.topics : [])
      .map((t) => sanitizeTopic(t, used))
      .filter(Boolean)
      .slice(0, MAX_TOPICS)
  );
  const ids = new Set(topics.map((t) => t.id));
  const fallback = defaultTopicId(topics);
  const seen = new Set();
  const notes = (Array.isArray(raw?.notes) ? raw.notes : [])
    .map((n) => sanitizeNote(n, ids, fallback))
    .filter((n) => n && !seen.has(n.id) && seen.add(n.id));
  const prefs = normalizePrefs(raw?.prefs);
  const vault = isVault(raw?.vault) ? raw.vault : null;
  return { schema: SCHEMA, notes: pinnedFirst(notes), topics, prefs, vault };
}

export const THEMES = ['system', 'light', 'dark'];
export const normalizePrefs = (p) => ({
  view: p?.view === 'list' ? 'list' : 'grid',
  theme: THEMES.includes(p?.theme) ? p.theme : 'system',
});

export const defaultTopics = () => [
  { id: newId() + 'a', name: 'Personal', color: 'lavender', isDefault: true },
  { id: newId() + 'b', name: 'Work', color: 'sky' },
  { id: newId() + 'c', name: 'Ideas', color: 'peach' },
];

// v1 stored a bare array of notes, ordered by date and coloured individually.
export function migrateV1(oldNotes) {
  const topics = defaultTopics();
  const byColor = Object.fromEntries(topics.map((t) => [t.color, t.id]));
  const notes = (Array.isArray(oldNotes) ? oldNotes : [])
    .filter((n) => n && typeof n.id === 'string')
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((n) => ({ ...n, topicId: byColor[n.color] ?? null }));
  return normalize({ notes, topics });
}

export function initialData() {
  const topics = defaultTopics();
  const [personal, , ideas] = topics;
  const now = Date.now();
  const note = (title, html, body, topicId, pinned, t) => ({
    id: newId() + t, title, html, body, topicId, pinned, createdAt: now - t, updatedAt: now - t,
  });
  return normalize({
    topics,
    notes: [
      note(
        'Welcome to Notely ✨',
        '<div>Tap <b>+</b> to write a note. Everything is <span style="background-color: rgb(255, 241, 168);">saved automatically</span> on your device.</div>',
        'Tap + to write a note. Everything is saved automatically on your device.',
        personal.id, true, 0
      ),
      note(
        'Quick tips',
        '<ul class="checklist"><li data-checked="true">Hold a note and drag it to reorder</li><li data-checked="false">Tap ⋯ on a note to pin, move or delete</li><li data-checked="false">Hold a topic to rename or recolour it</li></ul><div>Use the toolbar above the keyboard for <b>bold</b>, <i>italic</i>, headings, lists and colours.</div>',
        '☑ Hold a note and drag it to reorder\n☐ Tap ⋯ on a note to pin, move or delete\n☐ Hold a topic to rename or recolour it\nUse the toolbar above the keyboard for bold, italic, headings, lists and colours.',
        ideas.id, false, 1
      ),
    ],
  });
}

// Move a note within the visible (filtered) list and write the result back into the full list.
// Dropping a note among pinned notes pins it; dropping it below them unpins it.
// Works on ids so a stale `visibleIds` can never duplicate or drop notes.
export function applyReorder(allNotes, visibleIds, from, to) {
  const n = visibleIds.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
  const byId = new Map(allNotes.map((x) => [x.id, x]));
  const visibleSet = new Set(visibleIds);
  if (visibleSet.size !== n || !visibleIds.every((id) => byId.has(id))) return null;

  const ids = visibleIds.slice();
  const [movedId] = ids.splice(from, 1);
  const pinnedOthers = ids.filter((id) => byId.get(id).pinned).length;
  ids.splice(to, 0, movedId);
  const moved = byId.get(movedId);
  const pinned = to < pinnedOthers ? true : to > pinnedOthers ? false : moved.pinned;
  if (pinned !== moved.pinned) byId.set(movedId, { ...moved, pinned });

  let k = 0;
  const merged = allNotes.map((x) => (visibleSet.has(x.id) ? byId.get(ids[k++]) : x));
  return pinnedFirst(merged);
}

// Insert or replace a note, keeping pinned notes first. New notes go to the top of their section.
export function upsertNote(list, note) {
  const i = list.findIndex((n) => n.id === note.id);
  if (i !== -1 && list[i].pinned === note.pinned) {
    const copy = list.slice();
    copy[i] = note;
    return copy;
  }
  const others = i === -1 ? list : list.filter((n) => n.id !== note.id);
  const at = note.pinned ? 0 : others.filter((n) => n.pinned).length;
  return [...others.slice(0, at), note, ...others.slice(at)];
}

// ---- Backup & restore ---------------------------------------------------------

export const BACKUP_KIND = 'notely-backup';

export function makeBackup({ notes, topics, prefs, vault }, appVersion) {
  return {
    kind: BACKUP_KIND,
    backupVersion: 1,
    schema: SCHEMA,
    appVersion,
    exportedAt: new Date().toISOString(),
    notes,
    topics,
    prefs,
    vault: vault ?? null, // locked notes stay encrypted; this lets the lock password open them
  };
}

export const isEncryptedBackup = (raw) => !!raw && raw.kind === ENCRYPTED_KIND;
export const lockedCount = (notes) => notes.filter((n) => n.locked).length;

// Reads a backup file's text. Accepts Notely backups (and the app's own data file).
// Throws an Error with a user-friendly message if the file can't be used.
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t a valid Notely backup.');
  }
  return parseBackupObject(raw);
}

export function readBackupFile(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('This file isn’t a valid Notely backup.');
  }
}

export function parseBackupObject(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) {
    throw new Error('This file isn’t a valid Notely backup.');
  }
  if (raw.kind && raw.kind !== BACKUP_KIND) throw new Error('This file isn’t a Notely backup.');
  if (Number.isFinite(raw.schema) && raw.schema > SCHEMA) {
    throw new Error('This backup was made by a newer version of Notely. Please update the app.');
  }
  return normalize(raw);
}

// Adds a backup's notes to the current ones. Topics are matched by name; new topics are
// added while there's room, otherwise their notes go to the default topic. Notes already
// present (same id and content) are skipped; same id with different content is kept as a copy.
// Locked notes go through `transformLocked(note, finalId)`, which re-encrypts them for this
// device's lock password (or returns null to skip them, e.g. if the password isn't known).
export function mergeData(current, incoming, { transformLocked } = {}) {
  const topics = current.topics.slice();
  const usedColors = new Set(topics.map((t) => t.color));
  const byName = new Map(topics.map((t) => [t.name.toLowerCase(), t.id]));
  const fallback = defaultTopicId(topics);
  const topicMap = new Map();
  for (const t of incoming.topics) {
    const existing = byName.get(t.name.toLowerCase());
    if (existing) {
      topicMap.set(t.id, existing);
      continue;
    }
    const color = usedColors.has(t.color) ? noteColors.find((c) => !usedColors.has(c.key))?.key : t.color;
    if (topics.length < MAX_TOPICS && color) {
      const added = { id: newId() + 't', name: t.name, color, isDefault: false };
      topics.push(added);
      usedColors.add(color);
      byName.set(t.name.toLowerCase(), added.id);
      topicMap.set(t.id, added.id);
    } else {
      topicMap.set(t.id, fallback);
    }
  }
  const currentById = new Map(current.notes.map((n) => [n.id, n]));
  const added = [];
  let skipped = 0;
  let lockedSkipped = 0;
  for (const n of incoming.notes) {
    let note = { ...n, topicId: topicMap.get(n.topicId) ?? fallback };
    const same = currentById.get(n.id);
    if (same) {
      const identical = n.locked
        ? same.locked && same.enc?.ct === n.enc?.ct
        : !same.locked && same.title === n.title && same.html === n.html && same.updatedAt === n.updatedAt;
      if (identical) {
        skipped++;
        continue;
      }
      note.id = newId() + 'i';
    }
    if (note.locked) {
      let out = null;
      try {
        out = transformLocked ? transformLocked(note, note.id, n.id) : null;
      } catch {
        out = null;
      }
      if (!out) {
        lockedSkipped++;
        continue;
      }
      note = out;
    }
    added.push(note);
  }
  return {
    notes: pinnedFirst([...current.notes, ...added]),
    topics,
    added: added.length,
    skipped,
    lockedSkipped,
  };
}
