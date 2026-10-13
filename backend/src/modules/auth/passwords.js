import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

export const MIN_PASSWORD_LENGTH = 12;
// An upper limit stops someone making the server hash megabytes of text.
export const MAX_PASSWORD_LENGTH = 200;

// Argon2id with the settings OWASP recommends as a minimum (19 MiB, 2 passes).
// The salt is random per password and is stored inside the hash string.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`The password must be at most ${MAX_PASSWORD_LENGTH} characters long`);
  }
  return argon2.hash(password, HASH_OPTIONS);
}

// True only when the password matches the hash. Never throws.
export async function verifyPassword(hash, password) {
  if (typeof hash !== 'string' || typeof password !== 'string') return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let throwawayHash;

// Does the same amount of work as a real check, against a hash nobody knows
// the password for. Used when the email is unknown, so that a wrong email and
// a wrong password take the same time to answer.
export async function verifyAgainstNothing(password) {
  throwawayHash ??= argon2.hash(randomBytes(32).toString('hex'), HASH_OPTIONS);
  await verifyPassword(await throwawayHash, password);
  return false;
}
