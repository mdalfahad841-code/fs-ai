/**
 * FS AI — Autonomy: research agent handler.
 *
 * Real work only. Research sources live in D1 (research_sources, seeded
 * by migration 008 with verified public RSS/Atom feeds, 3 per division).
 * The handler fetches the enabled sources for the division, stores
 * genuinely new items in research_items (dedupe vs existing articles
 * and vs stored items), and returns candidate topics. Outdated items
 * (>1 year old) are stored with is_outdated=1 but never proposed as
 * candidates. Without any source it computes the division content gap
 * from D1 and returns a no-op — it never invents topics.
 *
 * A task may still pass explicit `sources: [url, ...]` in its payload;
 * those ad-hoc URLs are fetched the same way but are not stored (they
 * have no research_sources row to attribute items to).
 */
import { d1All, slugify } from '../../middleware/validation.js';
import { fetchFeed, normalizeTitle } from '../../rss/rss.js';
import { fetchAllEnabledSources, loadEnabledSources } from '../../rss/sources.js';

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

async function divisionGap(env) {
  const rows = await d1All(env,
    'SELECT d.id, d.slug AS division, d.name, COUNT(a.id) AS total, ' +
    "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
    'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id ' +
    'GROUP BY d.id, d.slug, d.name ORDER BY published ASC, total ASC');
  return (rows || []).map((r) => ({
    division: r.division, name: r.name, total: Number(r.total || 0), published: Number(r.published || 0),
  }));
}

export async function runResearch(task, env) {
  const payload = parsePayload(task);
  const divisionSlug = typeof payload.division === 'string' ? payload.division : null;
  const adHocSources = Array.isArray(payload.sources) ? payload.sources.filter((s) => typeof s === 'string') : [];

  // Division content gap from real D1 counts — reported in both paths.
  let gap;
  try {
    gap = await divisionGap(env);
  } catch (err) {
    return { outcome: 'failed', error: `Could not read divisions from D1: ${String(err && err.message ? err.message : err).slice(0, 200)}` };
  }
  const division = divisionSlug ? (gap.find((g) => g.division === divisionSlug) || null) : null;

  // Ad-hoc URL path (explicit payload.sources): fetch, do not store.
  if (adHocSources.length) {
    const existing = await d1All(env, 'SELECT title, slug FROM articles') || [];
    const existingTitles = new Set(existing.map((r) => normalizeTitle(r.title)));
    const existingSlugs = new Set(existing.map((r) => String(r.slug || '').toLowerCase().trim()));
    const candidates = [];
    const fetchErrors = [];
    const seen = new Set();
    for (const source of adHocSources) {
      const result = await fetchFeed(source);
      if (!result.ok) { fetchErrors.push({ source, error: result.error }); continue; }
      for (const item of result.items) {
        const key = normalizeTitle(item.title);
        if (seen.has(key) || existingTitles.has(key) || existingSlugs.has(slugify(item.title))) continue;
        seen.add(key);
        candidates.push({ title: item.title, link: item.url, source });
      }
    }
    if (!candidates.length) {
      return {
        outcome: 'no-op',
        reason: fetchErrors.length && adHocSources.length === fetchErrors.length
          ? 'All RSS sources failed to fetch — no candidates.'
          : 'No new candidate topics found (all fetched items already exist as articles).',
        division: divisionSlug, divisionGap: gap, fetchErrors, candidates: [],
      };
    }
    return { outcome: 'done', division: divisionSlug, divisionGap: gap, candidates, fetchErrors };
  }

  // Configured-source path: enabled D1 sources for the division (all divisions when none given).
  const configured = await loadEnabledSources(env, divisionSlug);
  if (!configured.length) {
    return {
      outcome: 'no-op',
      reason: 'No RSS source configured for this division — add a public RSS URL to enable research',
      division: divisionSlug,
      divisionGap: gap,
    };
  }
  const { results, errors } = await fetchAllEnabledSources(env, { divisionSlug });
  const candidates = [];
  let itemsStored = 0;
  let outdatedSkipped = 0;
  for (const r of results) {
    itemsStored += r.added;
    for (const item of r.items) {
      if (item.isOutdated) { outdatedSkipped += 1; continue; }
      candidates.push({ title: item.title, link: item.url, source: r.sourceId, publishedAt: item.publishedAt });
    }
  }
  if (!candidates.length) {
    return {
      outcome: 'no-op',
      reason: errors.length && results.length === errors.length
        ? 'All RSS sources failed to fetch — no candidates.'
        : 'No new candidate topics found (all fetched items already exist as articles or are outdated).',
      division: divisionSlug, divisionGap: gap, fetchErrors: errors, candidates: [],
      sourcesChecked: results.length, itemsStored, outdatedSkipped,
    };
  }
  return {
    outcome: 'done', division: divisionSlug, divisionGap: gap, candidates, fetchErrors: errors,
    sourcesChecked: results.length, itemsStored, outdatedSkipped,
  };
}
