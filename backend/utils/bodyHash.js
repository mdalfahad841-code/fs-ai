/**
 * FS AI — stable body/claim hashing for fact-check integrity.
 *
 * A fact-check run is only meaningful for the exact body it judged.
 * These helpers give every run a stable identity for the body it
 * checked, so the pipeline can tell a fresh result from a stale one:
 *
 * - normaliseBodyForHash(): formatting-only differences (whitespace,
 *   blank lines, markdown heading/list markers, link markup, inline
 *   code ticks, **bold** markers, letter case) normalise away; ANY
 *   wording change — a different word, number, or punctuation that
 *   changes a sentence — produces different output. When in doubt the
 *   normaliser does NOT strip something: an unrecognised change hashes
 *   as different, which only ever costs a fresh evaluation, never a
 *   wrong carry-forward.
 * - bodyHash(): SHA-256 of the normalised body, stored on every
 *   fact_checks row (migration 019). The gate compares it with the
 *   article's current body hash and rejects a mismatch as stale.
 * - sha256Hex(): raw SHA-256 hex (WebCrypto — available in Workers
 *   and in Node 20+; same pattern as backend/security/crypto.js).
 *
 * Single-asterisk/underscore emphasis (*word*) is deliberately NOT
 * stripped: a bare URL can contain _x_ patterns that look like
 * emphasis, and mangling a URL would conflate two different bodies.
 * An *emphasis* edit therefore hashes as different (fail-safe: fresh
 * evaluation) rather than as identical.
 */
export function normaliseBodyForHash(body) {
  return String(body || '')
    .split('\n')
    .map((line) => {
      let s = line.trim();
      s = s.replace(/^#{1,6}\s+/, ''); // ## Heading -> Heading
      s = s.replace(/^(?:[-*•]|\d+[.)])\s+/, ''); // - item / 1. item -> item
      s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // [text](url) -> text
      s = s.replace(/`([^`]*)`/g, '$1'); // `code` -> code
      // **bold** / __bold__ — only when the wrapped text has no URL
      // characters, so a bold-wrapped bare URL is never mangled.
      s = s.replace(/(\*\*|__)([^*_/:.]+?)\1/g, '$2');
      return s.trim();
    })
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function sha256Hex(text) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text ?? '')));
  return Array.from(new Uint8Array(data), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function bodyHash(body) {
  return sha256Hex(normaliseBodyForHash(body));
}
