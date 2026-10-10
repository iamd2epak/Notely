// End-to-end encryption for locked notes and encrypted backups. Fully offline:
// AES-256-GCM (authenticated encryption) with keys derived from a password by scrypt.
// Nothing secret is ever stored: a wrong password simply fails GCM authentication.
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from './random';

// scrypt cost: ~16 MB of memory per guess; about 1–2 s on a phone (Hermes has no JIT).
// Parameters are stored with every vault/backup, so they can be raised later.
export const KDF = { N: 2 ** 14, r: 8, p: 1 };
export const MIN_PASSWORD = 6;

export class WrongPasswordError extends Error {
  constructor(message = 'Wrong password') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

// ---- bytes <-> text / base64 (no reliance on TextDecoder/atob in Hermes) ----
export function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes) {
  let s = '';
  const chunk = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c;
    if (b < 0x80) (c = b), (i += 1);
    else if (b < 0xe0) (c = ((b & 31) << 6) | (bytes[i + 1] & 63)), (i += 2);
    else if (b < 0xf0) (c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)), (i += 3);
    else {
      c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      i += 4;
    }
    if (c > 0xffff) {
      c -= 0x10000;
      chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else chunk.push(c);
    if (chunk.length > 8000) s += String.fromCharCode.apply(null, chunk.splice(0));
  }
  return s + String.fromCharCode.apply(null, chunk);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

export function toB64(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return s;
}

export function fromB64(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4) {
    throw new Error('Invalid encrypted data');
  }
  const clean = str.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_INDEX[clean[i]] << 18) |
      (B64_INDEX[clean[i + 1]] << 12) |
      ((B64_INDEX[clean[i + 2]] ?? 0) << 6) |
      (B64_INDEX[clean[i + 3]] ?? 0);
    out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---- primitives ----
const validKdf = (k) =>
  k && Number.isInteger(k.N) && k.N >= 2 ** 12 && k.N <= 2 ** 20 && (k.N & (k.N - 1)) === 0 &&
  Number.isInteger(k.r) && k.r >= 1 && k.r <= 16 && Number.isInteger(k.p) && k.p >= 1 && k.p <= 4 &&
  typeof k.salt === 'string';

export async function deriveKey(password, kdf) {
  if (!validKdf(kdf)) throw new Error('Invalid encryption settings');
  return scryptAsync(utf8Encode(password.normalize('NFKC')), fromB64(kdf.salt), {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    dkLen: 32,
    asyncTick: 15, // yield to the UI regularly while deriving
  });
}

export const newKdf = () => ({ ...KDF, salt: toB64(randomBytes(16)) });

function seal(key, plain, aad) {
  const iv = randomBytes(12);
  const ct = gcm(key, iv, aad).encrypt(plain);
  return { iv: toB64(iv), ct: toB64(ct) };
}

function open(key, box, aad) {
  try {
    return gcm(key, fromB64(box.iv), aad).decrypt(fromB64(box.ct));
  } catch {
    throw new WrongPasswordError();
  }
}

// ---- vault: one random master key, wrapped by the user's password ----
export async function createVault(password) {
  const kdf = newKdf();
  const kek = await deriveKey(password, kdf);
  const masterKey = randomBytes(32);
  return { vault: { v: 1, kdf, ...seal(kek, masterKey, utf8Encode('notely-vault')) }, masterKey };
}

export async function unlockVault(vault, password) {
  if (!isVault(vault)) throw new Error('No locked-notes password is set');
  const kek = await deriveKey(password, vault.kdf);
  const mk = open(kek, vault, utf8Encode('notely-vault'));
  if (mk.length !== 32) throw new WrongPasswordError();
  return mk;
}

// Change password: same master key, re-wrapped (notes don't need re-encrypting).
export async function rewrapVault(masterKey, newPassword) {
  const kdf = newKdf();
  const kek = await deriveKey(newPassword, kdf);
  return { v: 1, kdf, ...seal(kek, masterKey, utf8Encode('notely-vault')) };
}

export const isVault = (v) =>
  !!v && typeof v === 'object' && v.v === 1 && validKdf(v.kdf) && typeof v.iv === 'string' && typeof v.ct === 'string';

// ---- notes: title + content encrypted together, bound to the note id ----
export function encryptNote(masterKey, note) {
  const payload = utf8Encode(JSON.stringify({ title: note.title, html: note.html, body: note.body }));
  return {
    ...note,
    locked: true,
    title: '',
    html: '',
    body: '',
    enc: seal(masterKey, payload, utf8Encode('note:' + note.id)),
  };
}

export function decryptNote(masterKey, note) {
  const data = JSON.parse(utf8Decode(open(masterKey, note.enc, utf8Encode('note:' + note.id))));
  return {
    ...note,
    title: typeof data.title === 'string' ? data.title : '',
    html: typeof data.html === 'string' ? data.html : '',
    body: typeof data.body === 'string' ? data.body : '',
  };
}

// ---- password-encrypted blobs (backup files) ----
export const ENCRYPTED_KIND = 'notely-backup-encrypted';

export async function encryptBlob(password, obj) {
  const kdf = newKdf();
  const key = await deriveKey(password, kdf);
  return { kind: ENCRYPTED_KIND, v: 1, kdf, ...seal(key, utf8Encode(JSON.stringify(obj)), utf8Encode(ENCRYPTED_KIND)) };
}

export async function decryptBlob(password, blob) {
  if (!blob || blob.kind !== ENCRYPTED_KIND || blob.v !== 1) throw new Error('This isn’t an encrypted Notely backup.');
  const key = await deriveKey(password, blob.kdf);
  const plain = open(key, blob, utf8Encode(ENCRYPTED_KIND));
  return JSON.parse(utf8Decode(plain));
}
