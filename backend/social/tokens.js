/**
 * FS AI — Social: token encryption at rest.
 *
 * Follows the existing secrets pattern (backend/security/crypto.js):
 * no secret is hard-coded; the key comes from the Worker environment
 * (SOCIAL_TOKEN_SECRET) and is never logged. Tokens are encrypted with
 * AES-256-GCM (WebCrypto — Workers-compatible, same as the rest of the
 * codebase) and stored as `v1:<iv-base64>:<ciphertext-base64>` in
 * social_accounts.access_token_enc / refresh_token_enc.
 *
 * Fail-closed: if SOCIAL_TOKEN_SECRET is not configured, encrypt and
 * decrypt both throw — an account can neither be stored nor used, and
 * the dispatcher reports "token storage not configured" instead of
 * ever writing a plain-text token to D1.
 */
const PREFIX = 'v1';

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64decode(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getKey(secret) {
  if (!secret) throw new Error('SOCIAL_TOKEN_SECRET is not configured — social tokens cannot be stored or read.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plainText, secret) {
  if (typeof plainText !== 'string' || !plainText) throw new Error('Cannot encrypt an empty token.');
  const key = await getKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainText));
  return `${PREFIX}:${b64encode(iv.buffer)}:${b64encode(cipher)}`;
}

export async function decryptToken(stored, secret) {
  if (typeof stored !== 'string' || !stored.startsWith(`${PREFIX}:`)) {
    throw new Error('Stored token is not in the expected encrypted format — refusing to use it.');
  }
  const [, ivB64, cipherB64] = stored.split(':');
  if (!ivB64 || !cipherB64) throw new Error('Stored token is malformed — refusing to use it.');
  const key = await getKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b64decode(ivB64)) },
    key,
    b64decode(cipherB64));
  return new TextDecoder().decode(plain);
}

/** True when the value looks like an encrypted token (never log the value itself). */
export function isEncryptedToken(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}
