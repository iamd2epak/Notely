import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { makeBackup, readBackupFile } from './data';

const pad = (n) => String(n).padStart(2, '0');
export function backupFileName(encrypted, date = new Date()) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
  return `notely-backup-${stamp}${encrypted ? '-encrypted' : ''}.json`;
}

const isCancel = (e) => /cancel|abort|dismiss|no directory|no folder/i.test(String(e?.message || e));

// `json` is the finished file content (plain backup or encrypted blob).
// Lets the user pick a folder (Downloads, Documents, SD card…) and writes the file there.
// Returns the file name, or null if the user cancelled.
export async function saveBackupToDevice(json, encrypted) {
  let dir;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch (e) {
    if (isCancel(e)) return null;
    throw new Error('Couldn’t open the folder picker.');
  }
  if (!dir) return null;
  const name = backupFileName(encrypted);
  try {
    const file = dir.createFile(name, 'application/json');
    file.write(json);
    return name;
  } catch (e) {
    console.warn('Backup write failed', e);
    throw new Error('Couldn’t save the backup in that folder. Try another folder.');
  }
}

// Opens the Android share sheet (Drive, email, Files, …) with the backup file.
export async function shareBackup(json, encrypted) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  const name = backupFileName(encrypted);
  const file = new File(Paths.cache, name);
  try {
    if (file.exists) file.delete();
    file.write(json);
  } catch (e) {
    console.warn('Backup write failed', e);
    throw new Error('Couldn’t create the backup file.');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Notely backup', UTI: 'public.json' });
  return name;
}

// Lets the user pick a backup file; returns its parsed JSON (plain or encrypted), or null if cancelled.
export async function pickBackup() {
  const res = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream', '*/*'] });
  if (!res || res.canceled || !res.result) return null;
  let text;
  try {
    text = await res.result.text();
  } catch (e) {
    console.warn('Backup read failed', e);
    throw new Error('Couldn’t read that file.');
  }
  return readBackupFile(text);
}

const safetyFile = () => new File(Paths.document, 'notely-before-restore.json');

// Copy of the current notes kept inside the app before a restore replaces them.
// Locked notes stay encrypted inside it.
export function keepSafetyCopy(data, appVersion) {
  try {
    const file = safetyFile();
    if (file.exists) file.delete();
    file.write(JSON.stringify(makeBackup(data, appVersion)));
  } catch (e) {
    console.warn('Safety copy failed', e);
  }
}

// Removed when a note gets locked, since an older copy could still hold its plain text.
export function deleteSafetyCopy() {
  try {
    const file = safetyFile();
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Removing safety copy failed', e);
  }
}
