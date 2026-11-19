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
