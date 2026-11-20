/**
 * FS AI — research source management (D1-backed).
 *
 * Loads the configured RSS/Atom sources from research_sources, fetches
 * them through backend/rss/rss.js, stores genuinely new items in
 * research_items, and records per-source health (last fetch, last
 * error, discovered/duplicates) so the dashboard can show real status.
 * A failed fetch never throws: it is recorded on the source row and
 * returned as a per-source error.
 */
import { d1All, d1First, slugify } from '../middleware/validation.js';
import { fetchFeed, normalizeTitle, isOutdated } from './rss.js';
import {
  newExecutionId, recordFetchAuditStart, recordFetchAuditFinish,
  recordFetchAuditSkipped, findRunningFetchAudit,
} from './rss.js';

/**
 * In-memory overlap guard (migration 014): source ids with a fetch in
 * flight in THIS Worker isolate. Claimed synchronously before the first
 * await in fetchSource, so two concurrent calls for the same feed can
 * never both pass it. The DB 'running' audit row is the second guard:
 * it is how another isolate sees the in-flight fetch. Both guards
 * agree — either one seeing a live fetch means "skip and record it".
 * The set is released in fetchSource's finally, so a finished or
 * failed fetch never blocks the next one.
 */
const runningFetches = new Set();

/** All enabled sources, optionally limited to one division slug. */
export async function loadEnabledSources(env, divisionSlug) {
  const rows = divisionSlug
    ? await d1All(env,
      'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
      's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
      'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
      'WHERE s.is_active = 1 AND d.slug = ? ORDER BY s.id ASC', [divisionSlug])
    : await d1All(env,
      'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
      's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
      'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
      'WHERE s.is_active = 1 ORDER BY s.division_id ASC, s.id ASC');
  return rows || [];
}

/** All sources (active and disabled) with division slugs, for the dashboard. */
export async function loadAllSources(env) {
  const rows = await d1All(env,
    'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
    's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
    'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
    'ORDER BY s.division_id ASC, s.id ASC');
  return rows || [];
}

export async function loadSource(env, id) {
  return d1First(env,
    'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
    's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
    'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.id = ?',
    [id]);
}

async function markSourceError(env, source, error) {
  await env.DB.prepare(
    "UPDATE research_sources SET last_fetched_at = datetime('now'), last_status = 'error', last_error = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(String(error).slice(0, 200), source.id).run();
}

async function markSourceOk(env, source, added, duplicates) {
  await env.DB.prepare(
    "UPDATE research_sources SET last_fetched_at = datetime('now'), last_status = 'ok', last_error = NULL, " +
    'items_discovered = items_discovered + ?, duplicates_found = duplicates_found + ?, updated_at = datetime(\'now\') WHERE id = ?',
  ).bind(added, duplicates, source.id).run();
}

/**
 * Fetch one configured source, store new items, update its health row,
 * and write exactly one audit row for this execution of this feed
 * (migration 014, backend/rss/rss.js recordFetchAudit*).
 * Returns { sourceId, division, ok, fetched, added, duplicates, outdated, error, items }.
 * `items` are the newly stored items only. fetchImpl is injectable for tests.
 * Options: { fetchImpl, executionId, triggerType } — executionId is one
 * id per trigger/run, shared across the feeds of that run (generated
 * here when the caller does not supply one); triggerType is 'manual'
 * for a single dashboard fetch, 'daily-workflow' for the daily research
 * step, 'scheduled' for a direct scheduled fetch trigger.
 * Counts are taken at the real insert/dedupe point below: discovered =
 * feed items that passed dedupe (new items identified for insert),
 * added = rows actually written (equal to discovered unless storing
 * threw partway, when the audit row is 'partial' and the error is
 * rethrown so the caller keeps its existing behaviour).
 * Overlap: when a fetch for this feed is already running, this call
 * does NOT fetch — it records a 'skipped-overlap' audit row under its
 * own execution_id and returns ok:false with skippedOverlap:true and
 * zero counts. The source health row is left untouched (no error is
 * recorded for a fetch that never ran).
 */
export async function fetchSource(env, source, { fetchImpl = fetch, executionId = newExecutionId(), triggerType = 'manual' } = {}) {
  // Overlap guard 1 (this isolate): claimed synchronously, before any
  // await, so two concurrent calls for the same feed cannot both pass.
  if (runningFetches.has(source.id)) {
    await recordFetchAuditSkipped(env, {
      sourceId: source.id, feedUrl: source.url, executionId, triggerType,
      reason: 'overlap-skipped: a fetch for this feed is already running in this isolate',
    });
    return {
      sourceId: source.id, division: source.division || null, ok: false,
      fetched: 0, added: 0, duplicates: 0, outdated: 0, error: 'overlap-skipped', skippedOverlap: true, items: [],
    };
  }
  runningFetches.add(source.id);
  const startedAt = new Date().toISOString();
  try {
    // Overlap guard 2 (other isolates): a fresh 'running' audit row
    // for this feed. A stale one (>10 min) is a crashed run and does
    // not block; it is left untouched as evidence.
    const runningRow = await findRunningFetchAudit(env, source.id);
    if (runningRow) {
      await recordFetchAuditSkipped(env, {
        sourceId: source.id, feedUrl: source.url, executionId, triggerType,
        reason: `overlap-skipped: fetch for this feed already running (audit row ${runningRow.id}, execution ${runningRow.execution_id})`,
      });
      return {
        sourceId: source.id, division: source.division || null, ok: false,
        fetched: 0, added: 0, duplicates: 0, outdated: 0, error: 'overlap-skipped', skippedOverlap: true, items: [],
      };
    }
    // Open the audit row (INSERT OR IGNORE on UNIQUE(execution_id,
    // source_id)). When it is ignored the row already exists for this
    // execution+feed and this call does not own it, so the finish
    // calls below become no-ops and the existing row is never
    // overwritten.
    const audit = await recordFetchAuditStart(env, {
      sourceId: source.id, feedUrl: source.url, executionId, triggerType, startedAt,
    });
    const result = await fetchFeed(source.url, { fetchImpl });
    if (!result.ok) {
      await recordFetchAuditFinish(env, {
        auditId: audit.auditId, status: 'failed', itemsDiscovered: 0, itemsInserted: 0,
        duplicatesSkipped: 0, errors: result.error, endedAt: new Date().toISOString(),
      });
      await markSourceError(env, source, result.error);
      return {
        sourceId: source.id, division: source.division || null, ok: false,
        fetched: 0, added: 0, duplicates: 0, outdated: 0, error: result.error, items: [],
      };
    }

    // Existing article titles/slugs (never propose a topic we already cover)
    // and existing research-item titles for this division (dedupe).
    const articles = await d1All(env, 'SELECT title, slug FROM articles') || [];
    const existingTitles = new Set(articles.map((r) => normalizeTitle(r.title)));
    const existingSlugs = new Set(articles.map((r) => String(r.slug || '').toLowerCase().trim()));
    const stored = await d1All(env, 'SELECT title, url FROM research_items WHERE division_id = ?', [source.division_id]) || [];
    const storedTitles = new Set(stored.map((r) => normalizeTitle(r.title)));
    const storedUrls = new Set(stored.map((r) => String(r.url || '')).filter(Boolean));

    let discovered = 0;
    let added = 0;
    let duplicates = 0;
    let outdated = 0;
    const newItems = [];
    const seen = new Set();
    try {
      for (const item of result.items) {
        const key = normalizeTitle(item.title);
        const isDup = seen.has(key) || existingTitles.has(key) || existingSlugs.has(slugify(item.title))
          || storedTitles.has(key) || (item.url && storedUrls.has(item.url));
        if (isDup) { duplicates += 1; continue; }
        seen.add(key);
        discovered += 1;
        const outdatedFlag = isOutdated(item.publishedAt) ? 1 : 0;
        if (outdatedFlag) outdated += 1;
        const evidence = item.summary || item.title;
        await env.DB.prepare(
          'INSERT INTO research_items (source_id, division_id, title, url, published_at, summary, evidence_text, is_outdated) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(source.id, source.division_id, item.title, item.url, item.publishedAt, item.summary, evidence, outdatedFlag).run();
        added += 1;
        newItems.push({ title: item.title, url: item.url, publishedAt: item.publishedAt, isOutdated: Boolean(outdatedFlag) });
      }
    } catch (err) {
      // Storing threw partway: record the true partial counts, then
      // rethrow so the caller keeps its existing behaviour (source
      // marked error, run continues with the next feed).
      await recordFetchAuditFinish(env, {
        auditId: audit.auditId, status: 'partial', itemsDiscovered: discovered, itemsInserted: added,
        duplicatesSkipped: duplicates,
        errors: String(err && err.message ? err.message : err).slice(0, 500),
        endedAt: new Date().toISOString(),
      });
      throw err;
    }
    await recordFetchAuditFinish(env, {
      auditId: audit.auditId, status: 'completed', itemsDiscovered: discovered, itemsInserted: added,
      duplicatesSkipped: duplicates, errors: '', endedAt: new Date().toISOString(),
    });
    await markSourceOk(env, source, added, duplicates);
    return {
      sourceId: source.id, division: source.division || null, ok: true,
      fetched: result.items.length, added, duplicates, outdated, error: null, items: newItems,
    };
  } finally {
    runningFetches.delete(source.id);
  }
}

/**
 * Fetch every enabled source (optionally one division). Never throws:
 * per-source failures are collected in `errors` and recorded on the row.
 * Returns { results, errors, sourcesChecked, executionId, triggerType }.
 * One executionId is generated per call and shared across the feeds of
 * the run, so the run's audit rows group together (migration 014).
 * Default triggerType is 'daily-workflow': the only production caller
 * is the daily-workflow research step (backend/agents/autonomy/
 * research.js); the manual dashboard route passes 'manual' itself.
 * A skipped-overlap result is not an error: the fetch never ran, so
 * it is recorded in the audit log only and does not touch the source
 * health row or the errors list.
 */
export async function fetchAllEnabledSources(env, { divisionSlug, fetchImpl = fetch, executionId = newExecutionId(), triggerType = 'daily-workflow' } = {}) {
  const sources = await loadEnabledSources(env, divisionSlug);
  const results = [];
  const errors = [];
  for (const source of sources) {
    try {
      const r = await fetchSource(env, source, { fetchImpl, executionId, triggerType });
      results.push(r);
      if (!r.ok && !r.skippedOverlap) errors.push({ source: source.url, error: r.error });
    } catch (err) {
      const message = String(err && err.message ? err.message : err).slice(0, 200);
      await markSourceError(env, source, message);
      results.push({
        sourceId: source.id, division: source.division || null, ok: false,
        fetched: 0, added: 0, duplicates: 0, outdated: 0, error: message, items: [],
      });
      errors.push({ source: source.url, error: message });
    }
  }
  return { results, errors, sourcesChecked: sources.length, executionId, triggerType };
}
