// Per-user SIP credential helpers: AES-256-GCM encryption at rest + random
// password generation.
//
// The app is the source of truth for each business's browser SIP password; the
// database stores only ciphertext (browser_sip_endpoints.sip_password_enc). The
// matching credential is delivered to Asterisk out-of-band — see
// docs/ASTERISK_REALTIME_PROVISIONING.md.
//
// Server-only. Never import into client components.

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

/**
 * Returns the 32-byte key from SIP_CRED_ENC_KEY (64-char hex OR base64), or null
 * if unset/invalid. The presence of a valid key is the switch that enables the
 * per-user SIP path; set it only once Asterisk per-user endpoints are provisioned.
 */
function getKey(): Buffer | null {
  const raw = process.env.SIP_CRED_ENC_KEY?.trim();
  if (!raw) return null;
  try {
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** True when per-user SIP provisioning is enabled (a valid 32-byte key is set). */
export function isSipProvisioningEnabled(): boolean {
  return getKey() !== null;
}

/** Generates a SIP-safe random password (24 chars, no ambiguous glyphs). */
export function generateSipPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(24);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Encrypts plaintext → "v1:<iv_b64>:<tag_b64>:<ct_b64>". Throws if no key. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error('SIP_CRED_ENC_KEY not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypts "v1:iv:tag:ct" → plaintext, or null on any failure (key rotated, tampered, etc.). */
export function decryptSecret(payload: string): string | null {
  const key = getKey();
  if (!key) return null;
  try {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}
