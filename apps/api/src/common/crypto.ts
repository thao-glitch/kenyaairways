import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for identity documents (Kenya DPA 2019:
 * appropriate technical & organisational measures for sensitive data).
 *
 * - AES-256-GCM, random 12-byte IV, key from ENCRYPTION_KEY (32 bytes).
 * - Blind index (HMAC-SHA256 keyed with the same secret) so documents can be
 *   looked up without decrypting the table.
 * - Payload format: `v1.<ivB64>.<tagB64>.<cipherB64>` (versioned for rotation).
 */

const VERSION = 'v1';

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptField(plaintext: string, base64Key: string): string {
  const key = keyFrom(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptField(payload: string, base64Key: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unsupported ciphertext payload');
  }
  const key = keyFrom(base64Key);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Keyed blind index — never store raw document numbers for lookups. */
export function blindIndex(value: string, base64Key: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  return createHmac('sha256', keyFrom(base64Key)).update(normalized).digest('hex');
}

/** Irreversible token hash (refresh tokens, OTPs, callback audit refs). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
