import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Envelope encryption for values at rest (OAuth refresh tokens, client secret).
 *
 * Format: v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 * The version prefix lets us rotate the algorithm later without a data migration.
 */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'bulk-email-sender::kdf::v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(config.encryptionKey, SALT, 32);
  }
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  if (plaintext === '') return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decrypt(payload: string | null | undefined): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Cannot decrypt value: unrecognised payload format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** Decrypts without throwing — returns '' when the key changed or the value is corrupt. */
export function tryDecrypt(payload: string | null | undefined): string {
  try {
    return decrypt(payload);
  } catch {
    return '';
  }
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Masks a secret for display: keeps a short prefix/suffix so users can recognise it. */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
