import { makeBackup, readBackupFile } from './data';

const pad = (n) => String(n).padStart(2, '0');
export function backupFileName(encrypted, date = new Date()) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
  return `notely-backup-${stamp}${encrypted ? '-encrypted' : ''}.json`;
}

function download(json, encrypted) {
  const name = backupFileName(encrypted);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export const saveBackupToDevice = async (json, encrypted) => download(json, encrypted);
export const shareBackup = async (json, encrypted) => download(json, encrypted);

export function pickBackup() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(readBackupFile(await file.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export function keepSafetyCopy(data, appVersion) {
  try {
    localStorage.setItem('notely-before-restore', JSON.stringify(makeBackup(data, appVersion)));
  } catch {}
}

export function deleteSafetyCopy() {
  try {
    localStorage.removeItem('notely-before-restore');
  } catch {}
}
