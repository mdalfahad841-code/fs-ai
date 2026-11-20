/**
 * FS AI — RSS/Atom fetch + parse for the research engine.
 *
 * Pure functions plus one small fetch wrapper. No D1 access here, so the
 * parser is unit-testable without a database. Only https feeds are
 * fetched; a feed that does not return valid RSS/Atom XML is reported
 * as an error, never treated as a source of topics.
 */

export const RSS_FETCH_TIMEOUT_MS = 5000;
export const RSS_MAX_ITEMS_PER_FEED = 50;
export const RSS_OUTDATED_DAYS = 365;

export function stripCdata(value) {
  return String(value || '').replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
}

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    })
    .trim();
}

export function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Normalised title used for dedupe: lower-case, collapsed whitespace, no punctuation. */
export function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function firstTag(body, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i');
    const m = re.exec(body);
    if (m) return stripCdata(m[1]);
  }
  return '';
}

function atomLink(body) {
  const links = [...String(body).matchAll(/<link[^>]*>/gi)].map((m) => m[0]);
  const pick = (re) => links.find((l) => re.test(l));
  const alternate = pick(/rel=["']alternate["']/i) || pick(/rel=["']self["']/i) || links[0];
  if (!alternate) return '';
  const href = /href=["']([^"']+)["']/i.exec(alternate);
  return href ? decodeEntities(href[1]) : '';
}

/**
 * Parse RSS 2.0 (<item>) or Atom (<entry>) XML.
 * Returns { feedType: 'rss'|'atom'|null, items: [{title, url, publishedAt, summary}], error: string|null }.
 * Items are capped at RSS_MAX_ITEMS_PER_FEED, in feed order.
 */
export function parseFeedXml(xml) {
  const text = String(xml || '');
  const isRss = /<(rss|rdf:RDF)[\s>]/.test(text);
  const isAtom = /<feed[\s>]/.test(text);
  if (!isRss && !isAtom) return { feedType: null, items: [], error: 'not-a-feed' };
  const feedType = isRss ? 'rss' : 'atom';
  const blockRe = feedType === 'rss' ? /<item[\s>]([\s\S]*?)<\/item>/gi : /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  const items = [];
  let m;
  while ((m = blockRe.exec(text)) !== null && items.length < RSS_MAX_ITEMS_PER_FEED) {
    const body = m[1];
    const title = stripTags(firstTag(body, ['title']));
    if (!title) continue;
    let url = '';
    let publishedAt = '';
    let summary = '';
    if (feedType === 'rss') {
      url = decodeEntities(firstTag(body, ['link'])) || atomLink(body);
      publishedAt = firstTag(body, ['pubDate', 'dc:date', 'date']);
      summary = stripTags(firstTag(body, ['description', 'content:encoded'])).slice(0, 500);
    } else {
      url = atomLink(body);
      publishedAt = firstTag(body, ['published', 'updated']);
      summary = stripTags(firstTag(body, ['summary', 'content'])).slice(0, 500);
    }
    items.push({ title, url: url || null, publishedAt: publishedAt || null, summary: summary || null });
  }
  return { feedType, items, error: null };
}

/** True when the item's publication date is older than RSS_OUTDATED_DAYS. Unparseable dates are not outdated. */
export function isOutdated(publishedAt, nowMs = Date.now()) {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) > RSS_OUTDATED_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Fetch one feed URL. Returns { ok, status, feedType, items, error, fetchedAt }.
 * error is one of: 'invalid-url', 'not-https', 'redirect-not-https',
 * 'timeout', 'network', 'http-<status>', 'not-a-feed'.
 * fetchImpl is injectable so tests never touch the network.
 */
export async function fetchFeed(url, { fetchImpl = fetch, timeoutMs = RSS_FETCH_TIMEOUT_MS } = {}) {
  const fetchedAt = new Date().toISOString();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, feedType: null, items: [], error: 'invalid-url', fetchedAt };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, status: 0, feedType: null, items: [], error: 'not-https', fetchedAt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(parsed.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'FS-AI-Research/1.0 (+https://fs-ai-5w5.pages.dev)',
      },
    });
  } catch (err) {
    return {
      ok: false, status: 0, feedType: null, items: [],
      error: err && err.name === 'AbortError' ? 'timeout' : 'network', fetchedAt,
    };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    return { ok: false, status: response.status, feedType: null, items: [], error: `http-${response.status}`, fetchedAt };
  }
  if (response.url && !String(response.url).startsWith('https://')) {
    return { ok: false, status: response.status, feedType: null, items: [], error: 'redirect-not-https', fetchedAt };
  }
  let xml;
  try {
    xml = await response.text();
  } catch {
    return { ok: false, status: response.status, feedType: null, items: [], error: 'network', fetchedAt };
  }
  const parsedFeed = parseFeedXml(xml);
  if (parsedFeed.error) {
    return { ok: false, status: response.status, feedType: null, items: [], error: parsedFeed.error, fetchedAt };
  }
  return { ok: true, status: response.status, feedType: parsedFeed.feedType, items: parsedFeed.items, error: null, fetchedAt };
}

// ---------------------------------------------------------------------------
// RSS fetch audit (migration 014 — rss_fetch_audit).
//
// One row per fetch execution per feed, written from the real fetch path
// in backend/rss/sources.js (fetchSource), which is the only place that
// knows the true insert/dedupe counts. Every helper here degrades to a
// no-op (never throws) when the audit table does not exist yet, so
// fetching keeps working on a pre-014 database; the audit simply is not
// recorded there. All values recorded are real: nothing is synthesised
// or estimated.
//
//   items_discovered   feed items that passed dedupe in this fetch
//                      (genuinely new items identified for insert).
//   items_inserted     research_items rows actually written by this
//                      fetch. Normally equal to items_discovered; lower
//                      only when storing failed partway ('partial').
//   duplicates_skipped feed items skipped as duplicates in this fetch.
//
// Execution id: one id per trigger/run, generated once by the caller
// (fetchAllEnabledSources, or the manual route) and shared across the
// feeds of that run, so a run's rows can be grouped. A lone fetchSource
// call generates its own id.
//
// Uniqueness guard: UNIQUE (execution_id, source_id) in migration 014.
// Writers use INSERT OR IGNORE for the opening 'running' row; when the
// insert is ignored the row already exists for that execution+feed and
// the caller does NOT own it (owned: false) and must not finalise it.
//
// Overlap: a 'running' row whose started_at is older than
// RSS_AUDIT_STALE_RUNNING_MS is a crashed run, not a live one — it
// never blocks a later fetch and is never rewritten. The live guard is
// the in-memory set in sources.js plus this row, which is how a second
// Worker isolate sees the in-flight fetch.
// ---------------------------------------------------------------------------

/** Trigger types recorded on audit rows (CHECK in migration 014). */
export const RSS_AUDIT_TRIGGER_TYPES = ['manual', 'scheduled', 'daily-workflow'];

/** Audit row statuses (CHECK in migration 014). */
export const RSS_AUDIT_STATUSES = ['running', 'completed', 'failed', 'partial', 'skipped-overlap'];

/**
 * A 'running' row older than this is a crashed run, not a live fetch.
 * A real fetch (5 s HTTP timeout + at most 50 D1 inserts) never runs
 * this long; the bound only exists so one crashed run can never block
 * its feed forever.
 */
export const RSS_AUDIT_STALE_RUNNING_MS = 10 * 60 * 1000;

/** Per-run unique id, shared across the feeds of one run. */
export function newExecutionId() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto
      && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the fallback below.
  }
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function auditDb(env) {
  return env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
}

/**
 * Open an audit row for one fetch execution of one feed (status
 * 'running', ended_at NULL). Returns { owned, auditId, unavailable,
 * duplicate }. owned is false when INSERT OR IGNORE skipped the row
 * because (execution_id, source_id) already has one — the caller must
 * then not finalise it. Never throws: on a pre-014 DB it returns
 * unavailable: true and fetching proceeds without an audit row.
 */
export async function recordFetchAuditStart(env, { sourceId, feedUrl, executionId, triggerType, startedAt }) {
  const db = auditDb(env);
  if (!db) return { owned: false, auditId: null, unavailable: true };
  const started = startedAt || new Date().toISOString();
  try {
    const res = await db.prepare(
      "INSERT OR IGNORE INTO rss_fetch_audit (source_id, feed_url, started_at, execution_id, trigger_type, status) "
      + "VALUES (?, ?, ?, ?, ?, 'running')",
    ).bind(sourceId, String(feedUrl || ''), started, String(executionId || ''), String(triggerType || '')).run();
    const changes = res && res.meta ? Number(res.meta.changes || 0) : 0;
    if (changes === 1) return { owned: true, auditId: res.meta.last_row_id, unavailable: false };
    return { owned: false, auditId: null, unavailable: false, duplicate: true };
  } catch {
    return { owned: false, auditId: null, unavailable: true };
  }
}

/**
 * The fresh 'running' audit row for a feed, if one is in flight, else
 * null. Rows older than staleAfterMs are stale (crashed run) and are
 * NOT returned, so they never block a later fetch. Never throws.
 */
export async function findRunningFetchAudit(env, sourceId, { nowMs = Date.now(), staleAfterMs = RSS_AUDIT_STALE_RUNNING_MS } = {}) {
  const db = auditDb(env);
  if (!db) return null;
  try {
    const cutoff = new Date(nowMs - staleAfterMs).toISOString();
    const row = await db.prepare(
      "SELECT * FROM rss_fetch_audit WHERE source_id = ? AND status = 'running' AND started_at >= ? "
      + 'ORDER BY started_at DESC, id DESC LIMIT 1',
    ).bind(sourceId, cutoff).first();
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Finalise an owned 'running' row with its terminal status and true
 * counts. The WHERE status = 'running' guard means a row is finalised
 * at most once. Returns true only when exactly one row was updated.
 * auditId null/undefined (row not owned) is a silent no-op. Never
 * throws.
 */
export async function recordFetchAuditFinish(env, { auditId, status, itemsDiscovered = 0, itemsInserted = 0, duplicatesSkipped = 0, errors = '', endedAt }) {
  const db = auditDb(env);
  if (!db || auditId === null || auditId === undefined) return false;
  try {
    const res = await db.prepare(
      'UPDATE rss_fetch_audit SET ended_at = ?, status = ?, items_discovered = ?, items_inserted = ?, '
      + "duplicates_skipped = ?, errors = ? WHERE id = ? AND status = 'running'",
    ).bind(
      endedAt || new Date().toISOString(), String(status),
      Number(itemsDiscovered) || 0, Number(itemsInserted) || 0, Number(duplicatesSkipped) || 0,
      String(errors || '').slice(0, 500), auditId,
    ).run();
    return Boolean(res && res.meta && Number(res.meta.changes || 0) === 1);
  } catch {
    return false;
  }
}

/**
 * Record that a fetch was NOT run because one for the same feed was
 * already in flight. A standalone row (status 'skipped-overlap',
 * started_at = ended_at = now, zero counts) under the skipped
 * caller's own execution_id, so the overlap itself is auditable.
 * Returns the new row id, or null when the row could not be written
 * (duplicate execution+feed, or a pre-014 DB). Never throws.
 */
export async function recordFetchAuditSkipped(env, { sourceId, feedUrl, executionId, triggerType, reason = '' }) {
  const db = auditDb(env);
  if (!db) return null;
  const now = new Date().toISOString();
  try {
    const res = await db.prepare(
      'INSERT OR IGNORE INTO rss_fetch_audit (source_id, feed_url, started_at, ended_at, execution_id, '
      + "trigger_type, items_discovered, items_inserted, duplicates_skipped, errors, status) "
      + "VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'skipped-overlap')",
    ).bind(
      sourceId, String(feedUrl || ''), now, now,
      String(executionId || ''), String(triggerType || ''),
      String(reason || 'overlap-skipped').slice(0, 500),
    ).run();
    const changes = res && res.meta ? Number(res.meta.changes || 0) : 0;
    return changes === 1 ? res.meta.last_row_id : null;
  } catch {
    return null;
  }
}
