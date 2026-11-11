/**
 * FS AI — Crypto module (WebCrypto, Workers-compatible).
 * PBKDF2 password hashing, hashed session tokens, CSRF tokens and
 * HTML escaping. No secrets are hard-coded; salts and secrets come from
 * environment variables or per-call random values.
 */
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'SHA-256';
const KEY_LENGTH_BITS = 256;

function bufToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer;
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bufToHex(arr.buffer);
}

async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    baseKey,
    KEY_LENGTH_BITS
  );
  return bufToHex(bits);
}

export async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await deriveKey(password, salt);
  // Format: pbkdf2$iterations$saltHex$hashHex — the salt is stored with the hash.
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufToHex(salt.buffer)}$${hash}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = hexToBuf(parts[2]);
    const expected = parts[3];
    const actual = await deriveKey(password, salt, iterations);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

export async function hashSessionToken(token, secret) {
  const enc = new TextEncoder();
  const data = await crypto.subtle.digest('SHA-256', enc.encode(`${secret}:${token}`));
  return bufToHex(data);
}

export async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return bufToHex(data);
}

export function generateCsrfToken() {
  return randomToken(32);
}

export async function createCsrfToken(secret) {
  const token = randomToken(32);
  const signature = await hashSessionToken(token, secret);
  return `${token}.${signature.slice(0, 32)}`;
}

export async function verifyCsrfToken(value, secret) {
  try {
    const [token, signature] = String(value).split('.');
    if (!token || !signature) return false;
    const expected = (await hashSessionToken(token, secret)).slice(0, 32);
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
