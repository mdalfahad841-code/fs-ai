/**
 * FS AI — Full-article evidence fetching (2026-11-22).
 *
 * The research engine could only learn from RSS summaries, so articles
 * whose sources left the feed (#29 Austin, #30 NYC) could never be
 * regenerated or properly fact-checked. This service fetches ONE
 * article page, extracts its readable text (readability-style: main
 * content only, no nav/ads/comments), and stores it as a research_items
 * row for THAT URL, so the existing evidence flows use it unchanged:
 * resolveEvidence() (content.js) finds it by URL for regeneration,
 * and loadEvidence() (factcheck.js) finds it for fact-checking and
 * correction. No other code path changes.
 *
 * COPYRIGHT BOUNDARY — fetched text is evidence for internal
 * verification only (fact-checking). It is NEVER republished
 * verbatim: generated article bodies must not reproduce source text
 * beyond short quotes, and the publish gate still requires owner
 * approval. Fetching a page does not transfer any right in it.
 *
 * COMPLIANCE (all mandatory, all enforced here — never worked around):
 * - robots.txt is fetched first and obeyed for the article path; a
 *   robots fetch failure (other than 404 = no file) fails closed.
 * - Publisher terms are respected: if a site's robots.txt states
 *   that its content may not be used for LLM / machine-learning /
 *   AI purposes, the fetch is refused (terms-prohibit-ai-use) and
 *   recorded — never attempted anyway. (The Guardian states exactly
 *   this; its articles therefore cannot be fetched by this feature.
 *   The licensed route for Guardian content is the Guardian Open
 *   Platform API, which needs an owner-registered key and a separate
 *   follow-up — not a workaround.)
 * - Never bypass paywalls, CAPTCHA, authentication or anti-bot
 *   protections: a 401/403/429/paywall response is recorded as a
 *   failed/blocked fetch, never retried around.
 * - Free services and publicly accessible content only; one fetch
 *   per task; per-host throttle (minimum interval, honouring the
 *   robots Crawl-delay when larger); bounded retries (transient
 *   errors only).
 * - SSRF protection: https only; no private/loopback/link-local/
 *   metadata IPs, no localhost hostnames, no credentials in the URL,
 *   at most 3 redirects, every hop re-validated. PLUS an allowlist:
 *   the URL must already be a recorded article_sources URL for the
 *   article being fetched — the feature never fetches an arbitrary
 *   URL from the open web.
 * - Size caps: page 2 MB, stored evidence 100,000 chars.
 * - Incomplete/truncated extraction is marked incomplete and is NOT
 *   stored as evidence (only the run is logged); only 'ok'
 *   extractions become research_items rows.
 * - Provenance is stored on every run (article_fetch_runs, migration
 *   029): source URL, final URL, HTTP status, robots verdict,
 *   extraction status + reason, extracted chars, content hash,
 *   retrieval time, publication date when the page carries one.
 *
 * FRESHNESS — a fetched item is current by retrieval (is_outdated 0):
 * the fetch is a fresh, complete retrieval of the source as it stands
 * now, unlike an RSS fragment that goes stale when the feed moves on.
 * published_at is still stored for provenance. (This is what lets the
 * regeneration floor count the evidence: the floor counts current
 * evidence only, and a 2024 travel guide fetched in full today is
 * current evidence about that guide — the alternative would make the
 * feature useless for exactly the articles it was built for.)
 *
 * fetchImpl is injectable so tests never touch the network (same
 * pattern as backend/rss/rss.js). `now` is injectable for the same
 * reason (throttle / already-current windows).
 */
import { d1All, d1First, d1Run } from '../middleware/validation.js';
import { normalizeUrl } from './urls.js';
import { sha256Hex } from '../utils/bodyHash.js';

export const FETCH_USER_AGENT = 'FS-AI-Research/1.0 (+https://fs-ai-5w5.pages.dev)';
export const ROBOTS_TIMEOUT_MS = 5000;
export const PAGE_TIMEOUT_MS = 15000;
export const MAX_PAGE_BYTES = 2_000_000;
export const MAX_EVIDENCE_CHARS = 100_000;
export const MIN_EXTRACTION_CHARS = 200;
export const MAX_REDIRECTS = 3;
export const MAX_ATTEMPTS = 2;
export const MIN_HOST_INTERVAL_MS = 10_000;
export const ALREADY_CURRENT_DAYS = 7;

// ---------------------------------------------------------------------------
// SSRF validation
// ---------------------------------------------------------------------------

const PRIVATE_IPV4 = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
];
const RESERVED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata']);
const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.invalid'];

function isPrivateIpLiteral(host) {
  if (PRIVATE_IPV4.some((re) => re.test(host))) return true;
  if (host === '::1' || host === '[::1]') return true;
  if (/^(fe80|fc00|fd00|ff00)[:]/i.test(host)) return true; // link-local / ULA / multicast
  if (/^::ffff:(10|127|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\./i.test(host)) return true; // IPv4-mapped
  return false;
}

/**
 * isSafeFetchUrl(url) -> { ok: true } or { ok: false, reason }.
 * https only (same rule as the RSS fetcher), no credentials, no
 * private/loopback/link-local/metadata target. Hostname checks only —
 * the Worker runtime does DNS at fetch time, so an attacker-controlled
 * hostname resolving to a private IP is out of scope here; the
 * allowlist (recorded article_sources URLs only) is the second layer.
 */
export function isSafeFetchUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (u.username || u.password) return { ok: false, reason: 'credentials-in-url' };
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'invalid-url' };
  if (RESERVED_HOSTS.has(host)) return { ok: false, reason: 'blocked-host' };
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'blocked-host' };
  if (isPrivateIpLiteral(host)) return { ok: false, reason: 'private-ip' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/**
 * Parse a robots.txt into groups: [{ agents: ['*', ...], allow: [],
 * disallow: [], crawlDelay: seconds|null }]. Comments (#) and blank
 * lines are ignored; multiple User-agent lines belong to one group;
 * a new User-agent line after rules starts a new group. Matching is
 * case-insensitive on the agent token, per the spec.
 */
export function parseRobotsTxt(text) {
  const groups = [];
  let current = null;
  const flush = () => {
    if (current && (current.agents.length || current.allow.length || current.disallow.length || current.crawlDelay != null)) {
      groups.push(current);
    }
    current = null;
  };
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (current && (current.allow.length || current.disallow.length || current.crawlDelay != null)) flush();
      if (!current) current = { agents: [], allow: [], disallow: [], crawlDelay: null };
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) current = { agents: [], allow: [], disallow: [], crawlDelay: null };
      if (value) current[field].push(value);
    } else if (field === 'crawl-delay') {
      if (!current) current = { agents: [], allow: [], disallow: [], crawlDelay: null };
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
    // Sitemap: and anything else are ignored.
  }
  flush();
  return { groups };
}

function robotsPatternToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped;
  return new RegExp('^' + anchored);
}

function applicableGroups(robots, userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  const token = ua.split('/')[0].split(' ')[0];
  const exact = (robots.groups || []).filter((g) => g.agents.some((a) => a === token || a === ua));
  if (exact.length) return exact;
  return (robots.groups || []).filter((g) => g.agents.includes('*'));
}

/**
 * Longest-matching-rule wins; on a tie Allow beats Disallow (Google's
 * rule). No matching rule -> allowed.
 */
export function isPathAllowedByRobots(robots, userAgent, path) {
  const p = String(path || '/');
  const groups = applicableGroups(robots, userAgent);
  let bestLen = -1;
  let bestAllow = true;
  for (const g of groups) {
    for (const rule of g.allow || []) {
      if (robotsPatternToRegExp(rule).test(p) && rule.length >= bestLen) {
        bestLen = rule.length;
        bestAllow = true;
      }
    }
    for (const rule of g.disallow || []) {
      if (robotsPatternToRegExp(rule).test(p) && rule.length > bestLen) {
        bestLen = rule.length;
        bestAllow = false;
      }
    }
  }
  return bestAllow;
}

export function robotsCrawlDelay(robots, userAgent) {
  const groups = applicableGroups(robots, userAgent);
  for (const g of groups) {
    if (g.crawlDelay != null) return g.crawlDelay;
  }
  return null;
}

/**
 * Detect an explicit publisher-terms prohibition on LLM / ML / AI use
 * in a robots.txt (usually a comment at the top, as the Guardian
 * states it: "Any other uses are not permitted, incl. but not limited
 * to: for large language models (LLMs), machine learning and/or
 * artificial intelligence-related purposes"). A path-level Disallow
 * is NOT what this checks — it is the terms statement. Kept narrow
 * (prohibition language AND an AI/ML/LLM term) so ordinary robots
 * files never match.
 */
export function detectAiUseProhibition(robotsText) {
  const text = String(robotsText || '');
  if (!text) return false;
  const hasProhibition = /not permitted|prohibited|must not be used|may not be used|do not use/i.test(text);
  const hasAiTerm = /large language model|machine learning|artificial intelligence|AI training|AI-related/i.test(text);
  if (hasProhibition && hasAiTerm) return true;
  if (/prohibit\w*\s+(the\s+)?use[^.]{0,160}(large language model|machine learning|artificial intelligence|AI training)/i.test(text)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Fetching (timeout + manual redirects + size cap)
// ---------------------------------------------------------------------------

async function fetchOnce(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'User-Agent': FETCH_USER_AGENT,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyCapped(response, capBytes) {
  // Streamed read when the runtime exposes a reader (Workers + Node);
  // falls back to text() for stubbed responses in tests.
  const body = response && response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > capBytes) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { text: null, tooLarge: true, bytes: total };
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return { text: new TextDecoder('utf-8').decode(buf), tooLarge: false, bytes: total };
  }
  const text = await response.text();
  const bytes = new TextEncoder().encode(text).length;
  return { text, tooLarge: bytes > capBytes, bytes };
}

/**
 * Fetch a URL as text with manual redirect following (max
 * MAX_REDIRECTS hops, every hop re-validated), a timeout, and a size
 * cap. Returns { ok, status, finalUrl, text, error } where error is
 * one of 'invalid-url' | 'not-https' | 'blocked-host' | 'private-ip' |
 * 'credentials-in-url' | 'timeout' | 'network' | 'too-many-redirects' |
 * 'redirect-not-https' | 'too-large' | 'http-<status>'.
 */
export async function fetchPageText(url, { fetchImpl = fetch, timeoutMs = PAGE_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS, maxBytes = MAX_PAGE_BYTES } = {}) {
  let current = String(url || '').trim();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safe = isSafeFetchUrl(current);
    if (!safe.ok) return { ok: false, status: 0, finalUrl: current, text: null, error: safe.reason };
    let response;
    try {
      response = await fetchOnce(fetchImpl, current, timeoutMs);
    } catch (err) {
      return { ok: false, status: 0, finalUrl: current, text: null, error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
    }
    const status = response.status;
    if (status >= 300 && status < 400) {
      const loc = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('location') || response.headers.get('Location')
        : null;
      if (!loc) return { ok: false, status, finalUrl: current, text: null, error: `http-${status}` };
      if (hop === maxRedirects) return { ok: false, status, finalUrl: current, text: null, error: 'too-many-redirects' };
      try {
        current = new URL(loc, current).toString();
      } catch {
        return { ok: false, status, finalUrl: current, text: null, error: 'invalid-url' };
      }
      continue;
    }
    if (!response.ok) {
      return { ok: false, status, finalUrl: current, text: null, error: `http-${status}` };
    }
    const read = await readBodyCapped(response, maxBytes);
    if (read.tooLarge) return { ok: false, status, finalUrl: current, text: null, error: 'too-large' };
    return { ok: true, status, finalUrl: current, text: read.text, error: null };
  }
  return { ok: false, status: 0, finalUrl: current, text: null, error: 'too-many-redirects' };
}

// ---------------------------------------------------------------------------
// Extraction (readability-style, dependency-free)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : ''; })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { const c = Number.parseInt(n, 16); return Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : ''; });
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function removeBlocks(html, tag) {
  return String(html || '').replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
}

function extractMeta(html, attr, value) {
  const re = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m1 = String(html || '').match(re);
  if (m1) return m1[1].trim();
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["']`, 'i');
  const m2 = String(html || '').match(re2);
  return m2 ? m2[1].trim() : null;
}

function extractPublishedAt(html) {
  return parsePublishedAt(extractMeta(html, 'property', 'article:published_time')
    || extractMeta(html, 'name', 'article:published_time')
    || extractMeta(html, 'property', 'datePublished'))
    || parsePublishedAt((String(html || '').match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1])
    || parsePublishedAt((String(html || '').match(/<time[^>]*datetime=["']([^"']+)["']/i) || [])[1]);
}

// A publisher date with no timezone designator (e.g. JSON-LD
// "2026-11-19T17:56:00") is UTC, not the server's local time: `new Date`
// parses a timezone-less ISO string as local time, so the stored value
// would shift with the runtime timezone (a +06 runtime read it as 11:56Z).
// Appending 'Z' makes the result identical in every timezone, including
// the Worker (which runs in UTC).
function parsePublishedAt(value) {
  const v = String(value || '').trim();
  if (!v || Number.isNaN(Date.parse(v))) return null;
  const tzLess = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(v);
  return new Date(tzLess ? v + 'Z' : v).toISOString();
}

const BOILERPLATE_START = /^(advertisement|sponsored|read more|related:|share this|sign up|newsletter|cookie|privacy policy|terms of (use|service)|follow us|subscribe|get the free (daily )?newsletter)/i;
const CAPTION_START = /^(photograph|photo|image|illustration|credit):/i;
// Related-story teasers: a headline ending in a byline ("... By Jane
// Smith") or a standalone byline line ("By Jane Smith • Sept. 25,
// 2026"). Body paragraphs never look like this.
const BYLINE_TAIL = /\bBy [A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/;
const BYLINE_LINE = /^By [A-Z][a-z]+/;
const NEWSLETTER_PROMO = /delivered to your inbox/i;

function containerCandidates(html) {
  const out = [];
  const take = (kind, re) => {
    let m;
    while ((m = re.exec(html)) !== null) out.push({ kind, html: m[1] });
  };
  take('article', /<article\b[^>]*>([\s\S]*?)<\/article>/gi);
  take('main', /<main\b[^>]*>([\s\S]*?)<\/main>/gi);
  take('role-main', /<div\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/gi);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  out.push({ kind: 'body', html: body ? body[1] : html });
  return out;
}

function paragraphsFrom(container) {
  const frags = [];
  const re = /<(p|h[2-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(container)) !== null) {
    const text = stripTags(m[2]);
    if (!text) continue;
    if (text.length < 25 && !/^h[2-6]$/i.test(m[1])) continue;
    if (BOILERPLATE_START.test(text)) continue;
    if (CAPTION_START.test(text)) continue;
    if (NEWSLETTER_PROMO.test(text)) continue;
    if (text.length < 200 && BYLINE_TAIL.test(text)) continue;
    if (text.length < 80 && BYLINE_LINE.test(text)) continue;
    frags.push(text);
  }
  return frags;
}

/**
 * Extract the readable article from raw HTML. Returns
 * { title, publishedAt, text, paragraphs }. The extractor handles
 * server-rendered article HTML; pages whose body is rendered
 * client-side from embedded JSON (e.g. Guardian DCR pages) yield
 * little or no text and are reported incomplete, not faked.
 */
export function extractArticleText(html, url) {
  const source = String(html || '');
  const title = extractMeta(source, 'property', 'og:title')
    || (() => { const t = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return t ? stripTags(t[1]) : null; })()
    || (() => { const h = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i); return h ? stripTags(h[1]) : null; })();
  const publishedAt = extractPublishedAt(source);
  let cleaned = source.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template']) cleaned = removeBlocks(cleaned, tag);
  for (const tag of ['nav', 'header', 'footer', 'aside', 'form']) cleaned = removeBlocks(cleaned, tag);
  cleaned = cleaned.replace(/<[^>]*role=["'](navigation|banner|contentinfo|complementary)["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ');
  let best = null;
  let bestArticle = null;
  for (const candidate of containerCandidates(cleaned)) {
    const frags = paragraphsFrom(candidate.html);
    const chars = frags.join(' ').length;
    const scored = { frags: frags.length, chars, text: frags, kind: candidate.kind };
    if (candidate.kind === 'article' && (!bestArticle || frags.length > bestArticle.frags || (frags.length === bestArticle.frags && chars > bestArticle.chars))) {
      bestArticle = scored;
    }
    if (!best || frags.length > best.frags || (frags.length === best.frags && chars > best.chars)) {
      best = scored;
    }
  }
  // Prefer the semantic <article> container when it holds the article
  // (≥3 paragraphs, ≥200 chars). A wider container (<body>) wins on
  // raw fragment count but drags in related stories, newsletter
  // promos and other chrome that is not the article — that is what
  // made a complete Higher Ed Dive page read as "ends mid-sentence".
  if (bestArticle && bestArticle.frags >= 3 && bestArticle.chars >= MIN_EXTRACTION_CHARS) best = bestArticle;
  const text = (best && best.text ? best.text : []).join('\n\n');
  return { title: title || null, publishedAt, text, paragraphs: (best && best.text ? best.text : []).length, url: url || null };
}

// ---------------------------------------------------------------------------
// Completeness assessment
// ---------------------------------------------------------------------------

const PAYWALL_MARKERS = [
  /subscribe to (continue )?read/i,
  /sign ?in to continue/i,
  /register to continue/i,
  /to continue reading,?\s+(please\s+)?(subscribe|sign in)/i,
  /you('ve| have) reached (your )?(free )?(article )?limit/i,
  /this article is (only )?(available )?for subscribers/i,
  /metered paywall/i,
  /\bpaywall\b/i,
];

const TERMINAL_PUNCT = /[.!?"”')\]]$/;

/**
 * assessExtraction({ title, text, html }) -> { status, reasons }.
 * status 'ok' means the extraction is complete enough to store as
 * evidence. Anything else is 'incomplete' with the reasons listed —
 * the text is never stored as good evidence.
 */
export function assessExtraction({ title, text, html }) {
  const reasons = [];
  const body = String(text || '');
  if (!title) reasons.push('missing-title');
  if (!body.trim()) reasons.push('empty-body');
  else if (body.length < MIN_EXTRACTION_CHARS) reasons.push(`too-short (${body.length} chars, need ${MIN_EXTRACTION_CHARS})`);
  if (body.trim() && !TERMINAL_PUNCT.test(body.trim()) && !/\u2026$/.test(body.trim())) reasons.push('ends-mid-sentence');
  if (/\u2026$/.test(body.trim())) reasons.push('ends-mid-sentence');
  if (PAYWALL_MARKERS.some((re) => re.test(body))) reasons.push('paywall-markers');
  if (!reasons.includes('paywall-markers') && body.length < 1000 && /class=["'][^"']*(paywall|metered|regwall|subscribe-modal)[^"']*["']/i.test(String(html || ''))) {
    reasons.push('paywall-markers');
  }
  return { status: reasons.length ? 'incomplete' : 'ok', reasons };
}

// ---------------------------------------------------------------------------
// Storage (migration 029; degrades gracefully pre-029)
// ---------------------------------------------------------------------------

function isMissingSchemaError(err) {
  const msg = String(err && err.message ? err.message : err);
  return /no such (table|column)/i.test(msg);
}

async function logFetchRun(env, run) {
  try {
    // fetched_at is stored as an explicit ISO timestamp (not the
    // column default) so the per-host throttle and the
    // already-current window compare unambiguous UTC times.
    await d1Run(env,
      'INSERT INTO article_fetch_runs (article_id, url, host, http_status, final_url, robots_allowed, robots_crawl_delay_seconds, extraction_status, extraction_reason, extracted_chars, content_hash, research_item_id, fetched_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [run.articleId ?? null, run.url, run.host, run.httpStatus ?? null, run.finalUrl ?? null,
        run.robotsAllowed == null ? null : (run.robotsAllowed ? 1 : 0),
        run.crawlDelay ?? null, run.extractionStatus, run.extractionReason || null,
        run.extractedChars || 0, run.contentHash || null, run.researchItemId ?? null,
        run.fetchedAt || new Date().toISOString()]);
    return true;
  } catch (err) {
    if (isMissingSchemaError(err)) return false; // pre-029 DB: audit unavailable, fetch still works
    throw err;
  }
}

async function insertResearchItem(env, { divisionId, title, url, publishedAt, summary, evidenceText, contentHash }) {
  const full = 'INSERT INTO research_items (source_id, division_id, title, url, published_at, summary, evidence_text, is_outdated, source_kind, content_hash, extraction_status) '
    + 'VALUES (NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)';
  try {
    const res = await d1Run(env, full, [divisionId, title, url, publishedAt, summary, evidenceText, 'article-fetch', contentHash, 'ok']);
    return res && res.meta ? res.meta.last_row_id : null;
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    // Pre-029 DB: the new columns do not exist yet — store the
    // evidence with the legacy column set instead of failing.
    const legacy = await d1Run(env,
      'INSERT INTO research_items (source_id, division_id, title, url, published_at, summary, evidence_text, is_outdated) '
      + 'VALUES (NULL, ?, ?, ?, ?, ?, ?, 0)',
      [divisionId, title, url, publishedAt, summary, evidenceText]);
    return legacy && legacy.meta ? legacy.meta.last_row_id : null;
  }
}

async function lastHostFetchAt(env, host) {
  try {
    const row = await d1First(env,
      'SELECT fetched_at FROM article_fetch_runs WHERE host = ? ORDER BY fetched_at DESC LIMIT 1', [host]);
    return row ? row.fetched_at : null;
  } catch (err) {
    if (isMissingSchemaError(err)) return null; // pre-029 DB: throttle unavailable
    throw err;
  }
}

async function latestFetchedItem(env, url) {
  try {
    return await d1First(env,
      "SELECT id, fetched_at FROM research_items WHERE url = ? AND source_kind = 'article-fetch' AND extraction_status = 'ok' ORDER BY fetched_at DESC LIMIT 1",
      [url]);
  } catch (err) {
    if (isMissingSchemaError(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

function parseTaskPayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

/**
 * fetchArticleEvidence(env, { url, articleId, fetchImpl, now }) — the
 * full flow. Returns one of:
 * - { outcome: 'done', articleId, url, finalUrl, researchItemId,
 *     extractedChars, contentHash, title, publishedAt, robotsAllowed,
 *     crawlDelay, attempts }
 * - { outcome: 'no-op', articleId, url, reason, ... } for permanent
 *   non-storable outcomes (robots-denied, terms-prohibited,
 *   paywall/blocked, 404, extraction-incomplete, rate-limited,
 *   already-current, url-not-a-recorded-source, article-published).
 * - { outcome: 'failed', articleId, url, error, attempts } for
 *   transient errors (timeout, network, 5xx after retries,
 *   robots-unavailable, storage errors). Retryable.
 *
 * Every attempt is logged to article_fetch_runs (when migration 029
 * is applied); the log is the audit trail, never the evidence.
 */
export async function fetchArticleEvidence(env, { url, articleId, fetchImpl = fetch, now = () => new Date() } = {}) {
  const fetchedAt = now();
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) {
    return { outcome: 'failed', articleId: articleId ?? null, url: url || null, error: 'Article fetch needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.id, a.division_id, a.status, a.title FROM articles a WHERE a.id = ? LIMIT 1', [id]);
  if (!article) {
    return { outcome: 'failed', articleId: id, url: url || null, error: `Article ${id} not found.` };
  }
  if (String(article.status || '') !== 'draft') {
    return { outcome: 'no-op', articleId: id, url: url || null, reason: `Article ${id} has status '${article.status}' — full-article evidence is only fetched for drafts.` };
  }
  const sourceRows = await d1All(env, 'SELECT source_url FROM article_sources WHERE article_id = ? ORDER BY id ASC', [id]) || [];
  const recorded = sourceRows.map((r) => r.source_url).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (!recorded.length) {
    return { outcome: 'no-op', articleId: id, url: url || null, reason: `Article ${id} has no recorded sources — nothing to fetch.` };
  }
  // Allowlist: the URL must be one of this article's recorded sources
  // (canonical comparison, so a trailing slash / www difference is
  // not an escape hatch and not a false refusal either).
  let target = typeof url === 'string' && url.trim() ? url.trim() : recorded[0];
  const targetCanon = normalizeUrl(target);
  const allowed = recorded.some((u) => normalizeUrl(u) === targetCanon || u === target);
  if (!allowed) {
    return { outcome: 'no-op', articleId: id, url: target, reason: 'URL is not a recorded source for this article — the fetcher only follows recorded article_sources URLs.' };
  }
  // Use the recorded URL spelling (exact match keeps resolveEvidence
  // and the fact-checker URL lookup working without normalisation).
  const recordedMatch = recorded.find((u) => normalizeUrl(u) === targetCanon) || recorded[0];
  target = recordedMatch;
  const host = (() => { try { return new URL(target).hostname.toLowerCase(); } catch { return ''; } })();

  const runLog = {
    articleId: id, url: target, host, httpStatus: null, finalUrl: null,
    robotsAllowed: null, crawlDelay: null, extractionStatus: 'failed',
    extractionReason: null, extractedChars: 0, contentHash: null, researchItemId: null,
    fetchedAt: fetchedAt.toISOString(),
  };
  const finish = async (result) => {
    runLog.extractionStatus = result.outcome === 'done' ? 'ok'
      : (result.reason && /extraction-incomplete|too-short|empty-body|ends-mid-sentence|paywall-markers|missing-title/i.test(result.reason) ? 'incomplete' : 'failed');
    runLog.extractionReason = result.reason || result.error || null;
    runLog.extractedChars = result.extractedChars || 0;
    runLog.contentHash = result.contentHash || null;
    runLog.researchItemId = result.researchItemId || null;
    runLog.httpStatus = result.httpStatus ?? runLog.httpStatus;
    runLog.finalUrl = result.finalUrl || runLog.finalUrl;
    await logFetchRun(env, runLog).catch(() => {});
    return result;
  };

  // SSRF check on the target itself, before any network: a recorded
  // source that is not a safe fetch target (private IP, localhost,
  // credentials, non-https) is refused outright — a permanent
  // condition, so it is a 'no-op', not a retryable failure.
  const safeTarget = isSafeFetchUrl(target);
  if (!safeTarget.ok) {
    return finish({ outcome: 'no-op', articleId: id, url: target, reason: `fetch refused: ${safeTarget.reason} — the recorded source URL is not a safe fetch target.` });
  }

  // 1. robots.txt first — fetched, parsed, obeyed; terms checked.
  let robotsText = null;
  let robots = { groups: [] };
  try {
    const robotsUrl = `https://${host}/robots.txt`;
    const robotsRes = await fetchPageText(robotsUrl, { fetchImpl, timeoutMs: ROBOTS_TIMEOUT_MS, maxRedirects: 2, maxBytes: 100_000 });
    if (robotsRes.ok) {
      robotsText = robotsRes.text;
      robots = parseRobotsTxt(robotsText);
    } else if (robotsRes.status === 404 || robotsRes.error === 'http-404') {
      robotsText = ''; // No robots file: nothing disallowed.
    } else {
      return finish({ outcome: 'failed', articleId: id, url: target, error: `robots.txt could not be fetched (${robotsRes.error || 'http-' + robotsRes.status}) — failing closed, not fetching blind.` });
    }
  } catch (err) {
    return finish({ outcome: 'failed', articleId: id, url: target, error: `robots.txt fetch failed: ${String(err && err.message ? err.message : err).slice(0, 200)}` });
  }
  runLog.crawlDelay = robotsCrawlDelay(robots, FETCH_USER_AGENT);
  if (detectAiUseProhibition(robotsText)) {
    return finish({ outcome: 'no-op', articleId: id, url: target, reason: 'terms-prohibit-ai-use: this site states its content may not be used for LLM / machine-learning / AI purposes — the fetch is refused on the publisher\u2019s own terms, not attempted.' });
  }
  let articlePath = '/';
  try { articlePath = new URL(target).pathname + new URL(target).search; } catch { /* keep '/' */ }
  runLog.robotsAllowed = isPathAllowedByRobots(robots, FETCH_USER_AGENT, articlePath);
  if (!runLog.robotsAllowed) {
    return finish({ outcome: 'no-op', articleId: id, url: target, reason: `robots-denied: robots.txt disallows this path for this user-agent (${articlePath}).` });
  }

  // 2. Per-host throttle — minimum interval, honouring Crawl-delay.
  const minIntervalMs = Math.max(MIN_HOST_INTERVAL_MS, (runLog.crawlDelay || 0) * 1000);
  try {
    const lastAt = await lastHostFetchAt(env, host);
    if (lastAt) {
      const gap = fetchedAt.getTime() - Date.parse(lastAt);
      if (Number.isFinite(gap) && gap >= 0 && gap < minIntervalMs) {
        return finish({ outcome: 'no-op', articleId: id, url: target, reason: `rate-limited: last fetch to ${host} was ${Math.round(gap / 1000)}s ago (minimum interval ${Math.round(minIntervalMs / 1000)}s).` });
      }
    }
  } catch (err) {
    return finish({ outcome: 'failed', articleId: id, url: target, error: `Throttle check failed: ${String(err && err.message ? err.message : err).slice(0, 200)}` });
  }

  // 3. Already-current — a fresh 'ok' fetch for this URL needs no re-fetch.
  try {
    const existing = await latestFetchedItem(env, target);
    if (existing && existing.fetched_at) {
      const ageDays = (fetchedAt.getTime() - Date.parse(existing.fetched_at)) / (24 * 3600 * 1000);
      if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays < ALREADY_CURRENT_DAYS) {
        return finish({ outcome: 'no-op', articleId: id, url: target, reason: `already-current: a complete fetch for this URL exists (research item #${existing.id}, ${existing.fetched_at}).`, researchItemId: existing.id });
      }
    }
  } catch (err) {
    return finish({ outcome: 'failed', articleId: id, url: target, error: `Dedupe check failed: ${String(err && err.message ? err.message : err).slice(0, 200)}` });
  }

  // 4. Fetch the page — bounded retries on transient errors only.
  let page = null;
  let attempts = 0;
  let lastError = null;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    page = await fetchPageText(target, { fetchImpl, timeoutMs: PAGE_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS, maxBytes: MAX_PAGE_BYTES });
    if (page.ok) break;
    lastError = page.error;
    const transient = page.error === 'timeout' || page.error === 'network'
      || /^http-5/.test(page.error || '');
    if (!transient || attempts >= MAX_ATTEMPTS) break;
  }
  if (!page.ok) {
    runLog.httpStatus = page.status || null;
    runLog.finalUrl = page.finalUrl || null;
    const err = page.error || 'fetch-failed';
    if (err === 'http-404') return finish({ outcome: 'no-op', articleId: id, url: target, reason: 'http-404: the article page no longer exists at this URL.', httpStatus: 404, finalUrl: page.finalUrl });
    if (err === 'http-401' || err === 'http-403' || err === 'http-429') {
      return finish({ outcome: 'no-op', articleId: id, url: target, reason: `paywall-or-blocked: the site answered ${err} — treated as a block/paywall, never worked around.`, httpStatus: page.status, finalUrl: page.finalUrl });
    }
    if (/^http-4/.test(err)) return finish({ outcome: 'no-op', articleId: id, url: target, reason: `fetch refused by the site (${err}) — not retried.`, httpStatus: page.status, finalUrl: page.finalUrl });
    if (err === 'too-large') return finish({ outcome: 'failed', articleId: id, url: target, error: `Page exceeds the ${MAX_PAGE_BYTES}-byte fetch cap.`, httpStatus: page.status, finalUrl: page.finalUrl });
    if (err === 'too-many-redirects' || err === 'redirect-not-https' || err === 'invalid-url' || err === 'not-https' || err === 'blocked-host' || err === 'private-ip' || err === 'credentials-in-url') {
      return finish({ outcome: 'no-op', articleId: id, url: target, reason: `fetch refused: ${err}.`, httpStatus: page.status || null, finalUrl: page.finalUrl });
    }
    return finish({ outcome: 'failed', articleId: id, url: target, error: `Page fetch failed (${err}) after ${attempts} attempt(s).`, httpStatus: page.status || null, finalUrl: page.finalUrl });
  }
  runLog.httpStatus = page.status;
  runLog.finalUrl = page.finalUrl;

  // 5. Extract + assess. Incomplete text is never stored as evidence.
  const extracted = extractArticleText(page.text, page.finalUrl);
  const assessment = assessExtraction({ title: extracted.title, text: extracted.text, html: page.text });
  if (assessment.status !== 'ok') {
    return finish({
      outcome: 'no-op', articleId: id, url: target,
      reason: `extraction-incomplete: ${assessment.reasons.join('; ')} — the text was not stored as evidence.`,
      extractedChars: extracted.text.length, httpStatus: page.status, finalUrl: page.finalUrl,
    });
  }
  const evidenceText = extracted.text.length > MAX_EVIDENCE_CHARS
    ? extracted.text.slice(0, MAX_EVIDENCE_CHARS)
    : extracted.text;
  const wasTruncatedToCap = extracted.text.length > MAX_EVIDENCE_CHARS;
  if (wasTruncatedToCap) {
    // Storing a cut-off article as 'ok' would be dishonest: the
    // extraction is complete only if the whole article fits the cap.
    return finish({
      outcome: 'no-op', articleId: id, url: target,
      reason: `extraction-incomplete: extracted text (${extracted.text.length} chars) exceeds the ${MAX_EVIDENCE_CHARS}-char evidence cap — not stored as complete evidence.`,
      extractedChars: extracted.text.length, httpStatus: page.status, finalUrl: page.finalUrl,
    });
  }
  const contentHash = await sha256Hex(evidenceText);
  const summary = evidenceText.slice(0, 500);

  // 6. Store as a research_items row for THIS URL, and re-point this
  // article's source rows at it (the fact-checker loads evidence by
  // research_item_id first — without the re-point, #30/#33 would keep
  // judging against their old fragments).
  let researchItemId = null;
  try {
    researchItemId = await insertResearchItem(env, {
      divisionId: article.division_id, title: extracted.title, url: target,
      publishedAt: extracted.publishedAt, summary, evidenceText, contentHash,
    });
    await d1Run(env,
      'UPDATE article_sources SET research_item_id = ? WHERE article_id = ? AND source_url = ?',
      [researchItemId, id, target]);
  } catch (err) {
    return finish({ outcome: 'failed', articleId: id, url: target, error: `Storing the fetched evidence failed: ${String(err && err.message ? err.message : err).slice(0, 300)}`, httpStatus: page.status, finalUrl: page.finalUrl });
  }

  return finish({
    outcome: 'done', articleId: id, url: target, finalUrl: page.finalUrl,
    researchItemId, extractedChars: evidenceText.length, contentHash,
    title: extracted.title, publishedAt: extracted.publishedAt,
    robotsAllowed: true, crawlDelay: runLog.crawlDelay, attempts,
    httpStatus: page.status,
  });
}

/**
 * runArticleFetch(task, env) — task handler for agent 'research',
 * kind 'article-fetch'. Payload: { article_id, url? }. The URL
 * defaults to the article's first recorded source. Dispatched in
 * backend/agents/autonomy-runner.js (kind-level, like
 * scaffold-regeneration). Never creates or publishes an article.
 */
export async function runArticleFetch(task, env) {
  const payload = parseTaskPayload(task);
  const articleId = Number(payload.article_id);
  const url = typeof payload.url === 'string' ? payload.url : null;
  try {
    const result = await fetchArticleEvidence(env, { url, articleId });
    return { ...result, agent: 'research' };
  } catch (err) {
    return { outcome: 'failed', agent: 'research', error: String(err && err.message ? err.message : err).slice(0, 300) };
  }
}
