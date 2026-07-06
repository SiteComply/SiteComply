import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Authenticated encryption for secrets stored at rest (e.g. SMS provider API
 * credentials in SmsConfig). AES-256-GCM with a per-value random IV; the key is
 * derived from SESSION_SECRET via HKDF so no new secret has to be provisioned.
 *
 * Ciphertext format: "v1:" + base64(iv[12] | tag[16] | ciphertext). The prefix
 * lets us recognise (and migrate) formats later.
 */

const PREFIX = 'v1:';

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secretbox-key';
  // HKDF-SHA256 → 32-byte key, domain-separated by an info label.
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret), Buffer.from('sitecomply-secretbox'), Buffer.from('sms-config'), 32),
  );
}

/** Encrypt a plaintext secret. Returns a self-describing "v1:" token. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a token produced by encryptSecret. Throws if tampered/invalid. */
export function decryptSecret(token: string): string {
  if (!isEncrypted(token)) {
    throw new Error('Value is not an encrypted secret token.');
  }
  const raw = Buffer.from(token.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
