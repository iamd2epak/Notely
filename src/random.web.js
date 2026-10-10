export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
