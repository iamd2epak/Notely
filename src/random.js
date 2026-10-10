import * as ExpoCrypto from 'expo-crypto';

// Cryptographically secure random bytes (Android SecureRandom via expo-crypto).
export const randomBytes = (n) => ExpoCrypto.getRandomBytes(n);
