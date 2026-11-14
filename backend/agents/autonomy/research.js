/**
 * FS AI — Autonomy: research agent handler.
 *
 * Real work only. With public RSS sources configured it fetches them
 * (5s timeout, https only), parses item titles/links with plain
 * string/regex parsing, dedupes against existing D1 article titles/slugs
 * and returns candidate topics. Without sources it computes the division
 * content gap from D1 and returns a no-op — it never invents topics.
 */
import { d1All, d1First } from '../../middleware/validation.js';
import { slugify } from '../../middleware/validation.js';

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

function stripCdata(value) {
  return String(value || '').replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 50) {
    const body = m[1];
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(body);
    const title = decodeEntities(stripCdata(titleMatch ? titleMatch[1] : ''));
    let link = decodeEntities(stripCdata(linkMatch ? linkMatch[1] : ''));
    if (!link) {
      const hrefMatch = /<link[^>]*href=["']([^"']+)["']/i.exec(body);
      if (hrefMatch) link = hrefMatch[1];
    }
    if (title) items.push({ title, link: link || null });
  }
  return items;
}

export async function runResearch(task, env) {
  const payload = parsePayload(task);
  const divisionSlug = typeof payload.division === 'string' ? payload.division : null;
  const sources = Array.isArray(payload.sources) ? payload.sources.filter((s) => typeof s === 'string') : [];

  // Division content gap from real D1 counts — reported in both paths.
  let gap = [];
  let division = null;
  try {
    const rows = await d1All(env,
      'SELECT d.id, d.slug AS division, d.name, COUNT(a.id) AS total, ' +
      "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
      'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id ' +
      'GROUP BY d.id, d.slug, d.name ORDER BY published ASC, total ASC');
    gap = (rows || []).map((r) => ({
      division: r.division, name: r.name, total: Number(r.total || 0), published: Number(r.published || 0),
    }));
    if (divisionSlug) division = gap.find((g) => g.division === divisionSlug) || null;
  } catch (err) {
    return { outcome: 'failed', error: `Could not read divisions from D1: ${String(err && err.message ? err.message : err).slice(0, 200)}` };
  }

  if (!sources.length) {
    return {
      outcome: 'no-op',
      reason: 'No RSS source configured for this division — add a public RSS URL to enable research',
      division: divisionSlug,
      divisionGap: gap,
    };
  }

  // Existing titles/slugs for dedupe.
  const existing = await d1All(env, 'SELECT title, slug FROM articles') || [];
  const existingTitles = new Set(existing.map((r) => String(r.title || '').toLowerCase().trim()));
  const existingSlugs = new Set(existing.map((r) => String(r.slug || '').toLowerCase().trim()));

  const candidates = [];
  const fetchErrors = [];
  const seen = new Set();
  for (const source of sources) {
    let url;
    try {
      url = new URL(source);
    } catch {
      fetchErrors.push({ source, error: 'Not a valid URL.' });
      continue;
    }
    if (url.protocol !== 'https:') {
      fetchErrors.push({ source, error: 'Only https sources are fetched.' });
      continue;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        fetchErrors.push({ source, error: `HTTP ${response.status}.` });
        continue;
      }
      // Never follow a redirect to a non-https destination.
      if (response.url && !String(response.url).startsWith('https://')) {
        fetchErrors.push({ source, error: 'Redirected to a non-https URL — not followed.' });
        continue;
      }
      const xml = await response.text();
      for (const item of parseRssItems(xml)) {
        const key = item.title.toLowerCase();
        if (seen.has(key) || existingTitles.has(key) || existingSlugs.has(slugify(item.title))) continue;
        seen.add(key);
        candidates.push({ title: item.title, link: item.link, source });
      }
    } catch (err) {
      fetchErrors.push({ source, error: String(err && err.name === 'AbortError' ? 'Fetch timed out after 5s.' : (err && err.message ? err.message : err)).slice(0, 200) });
    }
  }

  if (!candidates.length) {
    return {
      outcome: 'no-op',
      reason: fetchErrors.length && sources.length === fetchErrors.length
        ? 'All RSS sources failed to fetch — no candidates.'
        : 'No new candidate topics found (all fetched items already exist as articles).',
      division: divisionSlug,
      divisionGap: gap,
      fetchErrors,
      candidates: [],
    };
  }
  return { outcome: 'done', division: divisionSlug, divisionGap: gap, candidates, fetchErrors };
}
