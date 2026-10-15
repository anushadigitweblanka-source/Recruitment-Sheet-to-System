// Encryption of a company account's temporary password.
//
// AES-256-GCM, a fresh random 12-byte nonce for every value, the account id
// bound in as additional authenticated data so a ciphertext cannot be moved to
// another account. The key comes from the environment (COMPANY_SECRET_KEY, 32
// bytes, base64); it is never in code, in the database or in a log. Without a
// valid key nothing can be stored or revealed.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretKeyMissingError extends Error {
  constructor() {
    super('No valid company secret key is configured.');
    this.code = 'secret_key_missing';
  }
}

function readKey(config) {
  const raw = config?.companySecretKey;
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new SecretKeyMissingError();
  return key;
}

export function encryptSecret(config, accountId, plaintext) {
  const key = readKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(accountId)));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptSecret(config, accountId, { ciphertext, iv, authTag }) {
  const key = readKey(config);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(String(accountId)));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// A random temporary password for a Reset. Unambiguous characters only.
export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
