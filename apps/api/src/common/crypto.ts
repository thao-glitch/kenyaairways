import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env';

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

// ── payment-method secret storage ───────────────────────────────────────────
// PaymentMethodConfig.secretsEnc: the admin console stores provider
// credentials as one encrypted JSON map per method, reusing the same
// ENCRYPTION_KEY envelope as identity documents.

/** True when the env holds a usable 32-byte key (always, post env-validation). */
export function encryptionKeyConfigured(): boolean {
  try {
    return keyFrom(getEnv().ENCRYPTION_KEY).length === 32;
  } catch {
    return false;
  }
}

/** Seal a string map (empty → null: nothing to protect). */
export function sealSecrets(secrets: Record<string, string>): string | null {
  const entries = Object.entries(secrets).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return null;
  return encryptField(JSON.stringify(Object.fromEntries(entries)), getEnv().ENCRYPTION_KEY);
}

/** Open an envelope back into a map; corrupt/foreign input yields {} (fail-soft). */
export function openSecrets(envelope: string | null | undefined): Record<string, string> {
  if (!envelope) return {};
  try {
    const parsed: unknown = JSON.parse(decryptField(envelope, getEnv().ENCRYPTION_KEY));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {}; // wrong key or tampered payload — never surface raw failures
  }
}

/** Masked view of a secret for the admin UI: never the value, only its shape. */
export function maskSecret(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `••••••••${value.slice(-4)}`;
}
