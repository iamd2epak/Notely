// In-memory session for locked notes. The master key lives only in this module's
// memory: it is never written to disk and is wiped when the app is locked or backgrounded.
import { WrongPasswordError, unlockVault } from './crypto';

let masterKey = null;
let failures = 0;
let blockedUntil = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const getKey = () => masterKey;
export const isUnlocked = () => !!masterKey;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setKey(key) {
  masterKey = key;
  emit();
}

export function lock() {
  if (masterKey) masterKey.fill(0);
  masterKey = null;
  emit();
}

// Seconds to wait before the next attempt (after 5 wrong passwords: 30 s, then doubling).
export const retryWaitSeconds = () => Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));

export async function unlock(vault, password) {
  const wait = retryWaitSeconds();
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${wait} s.`);
  try {
    const key = await unlockVault(vault, password);
    failures = 0;
    blockedUntil = 0;
    setKey(key);
    return key;
  } catch (e) {
    if (e instanceof WrongPasswordError) {
      failures++;
      if (failures >= 5) blockedUntil = Date.now() + Math.min(600, 30 * 2 ** (failures - 5)) * 1000;
    }
    throw e;
  }
}
