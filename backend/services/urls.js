/**
 * FS AI — URL normalisation (Phase 3, Priority 1).
 *
 * Phase 2 showed that the same source URL can fail to match because of
 * a trailing slash, http/https, www, a fragment or a default port
 * (content.js matched research_items.url by EXACT string, so the
 * #29 generation failed on one trailing slash). This module is the
 * single place where URLs are compared: every source lookup goes
 * through urlsMatch(), never a raw string comparison.
 *
 * Rules (safe canonical comparison):
 *  - The scheme is unified to https (public news/guide sites serve
 *    the same resource over http and https; http redirects to https).
 *    Host is lower-cased; a leading "www." is dropped.
 *  - Default ports are dropped (:80 for http, :443 for https).
 *  - The fragment (#...) is dropped — it never identifies a resource.
 *  - A trailing slash is dropped except for the root path ("/").
 *  - Query parameters are PRESERVED (they can identify a different
 *    article) but sorted, so ?b=2&a=1 and ?a=1&b=2 compare equal.
 *  - Duplicate slashes in the path are collapsed ("/a//b" -> "/a/b").
 *  - The ORIGINAL submitted URL is never rewritten in place: callers
 *    keep it for display/audit and store the canonical form alongside
 *    it (see resolveEvidence in content.js).
 *
 * Two URLs are the same source only when their canonical forms are
 * identical — a different path or a different query value is a
 * different resource, never the same source.
 */

export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // Canonical scheme is always https: the same public resource is
  // served over both, and http redirects to https in practice.
  const scheme = 'https:';
  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  const isDefaultPort = (u.protocol === 'http:' && u.port === '80')
    || (u.protocol === 'https:' && u.port === '443');
  const port = (!u.port || isDefaultPort) ? '' : `:${u.port}`;
  // Path: collapse duplicate slashes, drop a trailing slash except root.
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // Query: preserve every parameter (they can identify a different
  // article), sorted so parameter order never matters. Repeated keys
  // keep their values in order.
  const params = [...u.searchParams.entries()]
    .sort(([aKey, aVal], [bKey, bVal]) => (aKey < bKey ? -1 : aKey > bKey ? 1 : (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : '';
  return `${scheme}//${host}${port}${path}${query}`;
}

/** Canonical form of a URL for storage/comparison, or null when invalid. */
export function canonicalUrl(raw) {
  return normalizeUrl(raw);
}

/**
 * True when two URLs identify the same resource after normalisation.
 * Invalid URLs never match anything (not even each other).
 */
export function urlsMatch(a, b) {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * The matching decision for a supplied URL against a stored URL:
 * 'exact' when the raw strings are identical, 'normalized' when they
 * differ only by a safe normalisation, 'no-match' otherwise. Callers
 * record this alongside the canonical URL (see content.js).
 */
export function matchDecision(supplied, stored) {
  if (typeof supplied !== 'string' || typeof stored !== 'string') return 'no-match';
  // Invalid URLs never match, not even each other.
  if (!normalizeUrl(supplied) || !normalizeUrl(stored)) return 'no-match';
  if (supplied.trim() === stored.trim()) return 'exact';
  return urlsMatch(supplied, stored) ? 'normalized' : 'no-match';
}
