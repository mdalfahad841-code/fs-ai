/**
 * FS AI — Social: media validation (pure functions, no I/O).
 *
 * Every platform that needs media gets the bytes (or URL) checked
 * BEFORE any platform call, so a bad image fails as VALIDATION with
 * zero network traffic instead of a half-created post. Format and
 * dimensions are read from the file headers themselves (PNG IHDR,
 * JPEG SOF markers) — no decoder, no dependency, Workers-compatible.
 * Size and aspect limits are the platform numbers from
 * docs/SOCIAL-PLATFORMS-2026-11-21.md (framework uses the lowest
 * published figure where sources disagree).
 */
import { platformDef } from './platforms.js';

export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** 'png' | 'jpeg' | null, from the magic bytes. */
export function detectImageFormat(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (PNG_MAGIC.every((v, i) => b[i] === v)) return 'png';
  if (JPEG_MAGIC.every((v, i) => b[i] === v)) return 'jpeg';
  return null;
}

function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { format: 'png', width, height } : null;
}

function jpegDimensions(bytes) {
  // Walk JPEG markers to the first SOF0/SOF1/SOF2 (baseline/extended).
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { format: 'jpeg', width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** { format, width, height } or null when the bytes are not a readable PNG/JPEG. */
export function imageDimensions(bytes) {
  if (!bytes) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = detectImageFormat(b);
  if (format === 'png') return pngDimensions(b);
  if (format === 'jpeg') return jpegDimensions(b);
  return null;
}

/**
 * Validate image bytes for a platform. Returns string[] of problems
 * (empty = valid). Checks: non-empty, PNG/JPEG, byte size, and —
 * for Instagram — JPEG-only and the 4:5–1.91:1 aspect window.
 */
export function validateMediaBytes(bytes, platform) {
  const def = platformDef(platform);
  const problems = [];
  if (!def) return [`Unknown platform: ${platform}`];
  if (!bytes || bytes.length === 0) return [`${def.label}: no media bytes supplied.`];
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = detectImageFormat(b);
  if (!format) return [`${def.label}: media is not a PNG or JPEG image.`];
  const maxBytes = def.limits.imageMaxBytes;
  if (maxBytes && b.length > maxBytes) {
    problems.push(`${def.label}: image is ${(b.length / 1024 / 1024).toFixed(1)} MB, over the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`);
  }
  if (platform === 'instagram' && format !== 'jpeg') {
    problems.push('Instagram requires a JPEG image (the API takes a public HTTPS URL to a JPEG).');
  }
  const dims = imageDimensions(b);
  if (!dims) {
    problems.push(`${def.label}: image dimensions could not be read from the file headers.`);
    return problems;
  }
  if (platform === 'instagram') {
    const ratio = dims.width / dims.height;
    if (ratio < 0.8 || ratio > 1.91) {
      problems.push(`Instagram image aspect ${ratio.toFixed(2)}:1 is outside the allowed 4:5–1.91:1 window.`);
    }
  }
  if (platform === 'pinterest' && dims.width < 600) {
    problems.push('Pinterest image is narrower than 600 px — use the 1000x1500 card.');
  }
  return problems;
}

/** Validate a media URL for a platform (Instagram: public HTTPS only). Returns string[] of problems. */
export function validateMediaUrl(url, platform) {
  const def = platformDef(platform);
  const problems = [];
  if (!def) return [`Unknown platform: ${platform}`];
  if (!url || typeof url !== 'string') return [`${def.label}: no media URL supplied.`];
  if (!/^https:\/\//.test(url)) problems.push(`${def.label}: media must be a public HTTPS URL.`);
  if (/\s/.test(url)) problems.push(`${def.label}: media URL contains whitespace.`);
  return problems;
}
