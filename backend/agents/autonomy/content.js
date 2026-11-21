/**
 * FS AI — Autonomy: content-creation agent handler.
 *
 * Tries the free LLM layer (backend/llm/) first. On success it returns
 * an AI-DRAFT: a real article body marked llmGenerated, still needing
 * fact-checking AND owner approval — it is never auto-published (the
 * scheduler only publishes owner-approved articles, and convert stores
 * it as a 'draft' with fact_checked = 0). When every free LLM provider
 * is unavailable or capped, it returns the scaffold only with outcome
 * 'no-op' — no article body is fabricated. No article row is inserted
 * here; the orchestrator converts a scaffold/draft into a CMS draft
 * via convertScaffoldToDraft.
 *
 * EVIDENCE (fixed 2026-11-20): generation is evidence-grounded. The
 * LLM receives the actual stored research (title, summary/evidence
 * text, source URL, publication date) for each source URL that resolves
 * to a research_items row — never a bare URL it cannot open (article
 * #27's first draft was a refusal for exactly that reason). When no
 * supplied source resolves to stored research, generation returns
 * outcome 'no-op' with reason 'insufficient-evidence' instead of
 * writing a sourceless draft. Resolved source IDs travel with the
 * scaffold so convertScaffoldToDraft can persist article_sources rows
 * (with research_item_id) for fact-checking and the publish gate.
 */
import {
  d1All, d1First, d1Run, nowIso, slugify, sanitiseText, isValidSlug,
  disclaimerForDivision, deriveSeoDescription,
} from '../../middleware/validation.js';
import { generateText } from '../../llm/index.js';
import { normalizeUrl } from '../../services/urls.js';
import { checkCrossDraftDuplicates } from './seo.js';
import { isTruncatedDraftBody } from './factcheck.js';

// Workstream A (2026-11-21): a scaffold regeneration must not invent
// facts from thin evidence. A 600–900-word article cannot honestly be
// built from a few hundred characters of source text — the LLM would
// have to fill the rest from its own weights. Live #29 proves the
// point: its only evidence is a single 500-char truncated, outdated
// Guardian fragment (research item 381). Regeneration therefore
// requires at least this many characters of CURRENT (not outdated)
// usable evidence, summed across the article's resolved sources.
// Below the floor it returns no-op 'insufficient-evidence' and
// touches nothing (no LLM call, no revision, no body change).
export const MIN_REGEN_EVIDENCE_CHARS = 1000;

/**
 * Find one stored research item by URL — exact match first, then a
 * safe normalised match (Phase 3, Priority 1). Returns
 * { item, matchMethod, matchedStoredUrl } or null. The normalised
 * fallback fetches the (id, url, fetched_at) list once and compares
 * canonical forms in JS, so a trailing slash / www / http-vs-https /
 * fragment / default-port variation still resolves to the stored
 * research instead of silently failing generation. The full row is
 * fetched by id only for the match actually used.
 */
const RESEARCH_ITEM_COLS = 'id, source_id, title, url, published_at, summary, evidence_text, is_outdated';

async function findResearchItemByUrl(env, suppliedUrl, urlIndexCache) {
  const text = String(suppliedUrl || '').trim();
  if (!text || !/^https?:\/\//i.test(text)) return null;
  try {
    const exact = await d1First(env,
      `SELECT ${RESEARCH_ITEM_COLS} FROM research_items WHERE url = ? ORDER BY fetched_at DESC LIMIT 1`, [text]);
    if (exact) return { item: exact, matchMethod: 'exact', matchedStoredUrl: text };
  } catch { /* fall through to the normalised match */ }
  const canonical = normalizeUrl(text);
  if (!canonical) return null;
  try {
    let index = urlIndexCache && urlIndexCache.list;
    if (!index) {
      const rows = await d1All(env,
        'SELECT id, url, fetched_at FROM research_items WHERE url IS NOT NULL ORDER BY fetched_at DESC') || [];
      index = [];
      for (const r of rows) {
        const c = normalizeUrl(r.url);
        if (c) index.push({ id: r.id, url: r.url, canonical: c });
      }
      if (urlIndexCache) urlIndexCache.list = index;
    }
    // Index is fetched_at DESC, so the first canonical match is the latest fetch.
    const hit = index.find((c) => c.canonical === canonical);
    if (!hit) return null;
    const full = await d1First(env,
      `SELECT ${RESEARCH_ITEM_COLS} FROM research_items WHERE id = ? LIMIT 1`, [hit.id]);
    if (!full) return null;
    return { item: full, matchMethod: 'normalized', matchedStoredUrl: hit.url };
  } catch {
    return null;
  }
}

const LLM_SYSTEM_PROMPT =
  'You write plain-language educational articles for a general audience. ' +
  'Write 600-900 words in clear, simple English. Use only facts from the ' +
  'research evidence given in the user message. Do not invent statistics, dates, ' +
  'prices, names or claims, and do not cite any source that was not given. ' +
  'Structure the article with the outline headings given, using ## (H2) ' +
  'markdown headings for each outline section — never # or ### for section headings.';

function buildLlmPrompt({ title, divisionName, outline, sources, evidence }) {
  const lines = [
    `Write an article titled "${title}" for the ${divisionName} division.`,
    '',
    'Outline:',
    ...outline.map((h) => `- ${h}`),
    '',
  ];
  if (evidence && evidence.length) {
    lines.push('Research evidence — use ONLY the facts below, and cite the source URL where you use a fact:');
    for (const e of evidence.slice(0, 5)) {
      lines.push(`- [${e.sourceName || 'Source'}] ${e.title}${e.publishedAt ? ` (${e.publishedAt})` : ''} — ${e.url}`);
      lines.push(`  Summary: ${String(e.evidenceText || e.summary || e.title || '').slice(0, 1200)}`);
    }
    lines.push('');
  }
  if (sources.length) {
    lines.push('Sources (cite only these, by name or URL, where you use them):');
    lines.push(...sources.map((s) => `- ${s}`));
  }
  return lines.join('\n');
}

/**
 * Resolve each supplied source URL against the stored research items.
 * Returns { resolved: [{ url, title, summary, evidenceText,
 * publishedAt, researchItemId, sourceId, sourceName, isOutdated,
 * canonicalUrl, matchMethod, matchedStoredUrl }],
 * unresolved: [url, ...] }. Only stored research counts as evidence:
 * a URL the system never fetched has no usable content (the LLM cannot
 * open links), so it is reported unresolved — never passed off as
 * research. Deduplicated by canonical URL; at most one row per URL
 * (latest fetch). `url` is ALWAYS the original supplied URL (display
 * and audit); `canonicalUrl` is the normalised form and `matchMethod`
 * is 'exact' or 'normalized' (see backend/services/urls.js) — the
 * matching decision is recorded on every resolved item.
 */
export async function resolveEvidence(env, sources) {
  const resolved = [];
  const unresolved = [];
  const seenUrls = new Set();
  const urlIndexCache = {};
  for (const s of sources || []) {
    const text = String(s || '').trim();
    if (!text) continue;
    if (!/^https?:\/\//i.test(text)) { unresolved.push(text); continue; }
    const dedupeKey = normalizeUrl(text) || text;
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);
    const found = await findResearchItemByUrl(env, text, urlIndexCache);
    if (found) {
      const it = found.item;
      resolved.push({
        url: text, title: it.title, summary: it.summary || '',
        evidenceText: it.evidence_text || it.summary || it.title,
        publishedAt: it.published_at || null, researchItemId: it.id,
        sourceId: it.source_id, sourceName: null,
        isOutdated: it.is_outdated === 1,
        canonicalUrl: normalizeUrl(text),
        matchMethod: found.matchMethod,
        matchedStoredUrl: found.matchedStoredUrl,
      });
      // Source name comes from research_sources; resolved lazily so a
      // missing sources row never breaks resolution.
      try {
        const src = await d1First(env, 'SELECT name FROM research_sources WHERE id = ? LIMIT 1', [it.source_id]);
        if (src) resolved[resolved.length - 1].sourceName = src.name;
      } catch { /* name stays null */ }
    } else {
      unresolved.push(text);
    }
  }
  return { resolved, unresolved };
}

/**
 * Daily article cap — DEFENSE IN DEPTH (W2 fix, 2026-11-21). The
 * queue drain in the daily workflow (scheduler.js) is the primary
 * layer: it enqueues at most maxArticlesPerDay content tasks. This
 * is the second layer, inside the content handler itself, so a
 * manually-run or duplicate task can never generate past the cap.
 * Reads autonomy_settings.max_articles_per_day (default 1, same as
 * the scheduler) and counts pipeline articles created today (UTC).
 *
 * COUNTING RULE — an article counts when it was created today AND
 * was not already published on an earlier date
 * (`published_at IS NULL OR date(published_at) = date('now')`).
 * Published history does not consume today's generation budget: the
 * seed load carries 25 published rows whose created_at defaults to
 * the load date, and counting those would refuse every generation on
 * any day the seed was loaded. A same-day publish still counts
 * (published_at = today), so publish-then-generate-again cannot slip
 * past the cap. Regeneration (regenerateScaffoldDraft) reuses an
 * existing row and is NOT counted and NOT blocked by this check —
 * fixing a scaffold creates no new article.
 * On any lookup error the check reports unavailable and generation
 * proceeds (fail-open, but VISIBLE: the result carries
 * dailyCapCheck: 'unavailable') — the primary queue-drain layer
 * still enforces the cap, and blocking all generation on a counting
 * error would be worse than a visible gap.
 */
export async function maxArticlesPerDay(env) {
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', ['max_articles_per_day']);
    const n = Number.parseInt(row && row.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  } catch {
    return 1;
  }
}

export async function articlesCreatedToday(env) {
  const row = await d1First(env,
    "SELECT COUNT(*) AS n FROM articles WHERE date(created_at) = date('now') AND (published_at IS NULL OR date(published_at) = date('now'))");
  return row ? Number(row.n || 0) : 0;
}

export async function checkDailyArticleCap(env) {
  try {
    const limit = await maxArticlesPerDay(env);
    const created = await articlesCreatedToday(env);
    return { limit, created, reached: created >= limit };
  } catch {
    return { limit: null, created: null, reached: false, unavailable: true };
  }
}

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

function headingsFromTitle(title, sources) {
  const headings = ['Introduction'];
  const words = String(title || '').toLowerCase();
  if (/how|guide|steps|tips/.test(words)) headings.push('How it works', 'Step-by-step');
  if (/best|top|review|compare/.test(words)) headings.push('What to look for', 'Comparison');
  if (/cost|price|budget|save|money/.test(words)) headings.push('Costs and budgeting');
  if (Array.isArray(sources) && sources.length) headings.push('Sources and further reading');
  headings.push('Conclusion', 'Key takeaways');
  return [...new Set(headings)];
}

export async function runContentCreation(task, env) {
  const payload = parsePayload(task);
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const division = typeof payload.division === 'string' ? payload.division.trim() : '';
  const sources = Array.isArray(payload.sources)
    ? payload.sources.filter((s) => typeof s === 'string').slice(0, 10)
    : [];
  if (title.length < 5) {
    return { outcome: 'failed', error: 'Content scaffold needs a title of at least 5 characters.' };
  }
  if (!division || !isValidSlug(division)) {
    return { outcome: 'failed', error: 'Content scaffold needs a valid division slug.' };
  }
  // Division must really exist — never scaffold for an unknown division.
  const row = await d1First(env, 'SELECT id, slug, name FROM business_divisions WHERE slug = ? LIMIT 1', [division]);
  if (!row) {
    return { outcome: 'failed', error: `Unknown division slug: ${division}.` };
  }
  // Duplicate avoidance: never generate a second article on a topic we
  // already cover (same slug or same title, case-insensitive).
  const dup = await d1First(env,
    'SELECT id, title, slug, status FROM articles WHERE slug = ? OR lower(title) = lower(?) LIMIT 1',
    [slugify(title), title]);
  if (dup) {
    return {
      outcome: 'no-op',
      reason: `An article already covers this topic: "${dup.title}" (id ${dup.id}, status ${dup.status}) — generation skipped to avoid a duplicate.`,
      duplicateArticleId: dup.id,
    };
  }
  const outline = Array.isArray(payload.outline) && payload.outline.length
    ? payload.outline.filter((h) => typeof h === 'string').slice(0, 12)
    : headingsFromTitle(title, sources);
  const seoTitle = title.slice(0, 60);
  // The meta description is derived from the generated body below (the
  // old title-only text was 77 chars and could never pass the 120-160
  // SEO check). Until the body exists, keep the title text as a
  // placeholder — the SEO repair step fixes it from real content.
  const seoDescription = `A plain-language guide: ${title}`.slice(0, 160);
  const scaffold = {
    title,
    division,
    divisionId: row.id,
    outline,
    seoTitle,
    seoDescription,
    sources,
    factCheckFlags: sources.length === 0
      ? ['No sources supplied — every factual claim will need a source before approval.']
      : [],
    note: 'SCAFFOLD — full article body needs an LLM or the owner; no body was fabricated',
  };

  // Daily cap, defense in depth (W2 fix, 2026-11-21): refuse
  // generation when today's pipeline articles already reach
  // maxArticlesPerDay. Checked BEFORE any evidence resolution or LLM
  // call, so a capped run spends no Neurons. See checkDailyArticleCap
  // for the counting rule and the fail-open-on-error behaviour.
  const cap = await checkDailyArticleCap(env);
  if (cap.unavailable) {
    // Visible, not silent: the caller can see the cap was not checked.
    scaffold.factCheckFlags = [...scaffold.factCheckFlags,
      'Daily-cap check unavailable (settings/count lookup failed) — generation proceeded; the queue drain remains the enforcing layer.'];
  } else if (cap.reached) {
    return {
      outcome: 'no-op',
      scaffold,
      reason: `daily-cap-reached: ${cap.created} article(s) already created today (limit ${cap.limit} per day) — generation paused until tomorrow.`,
      dailyCap: cap.limit,
      createdToday: cap.created,
    };
  }

  // EVIDENCE FIRST (fixed 2026-11-20): resolve every supplied source
  // URL against the stored research items. The LLM gets the actual
  // stored research text — never a bare URL it cannot open. When no
  // source resolves, do NOT call the LLM and do NOT write a sourceless
  // draft: return no-op 'insufficient-evidence' so the owner/dashboard
  // can see exactly which URLs had no stored research behind them.
  const { resolved: evidence, unresolved } = await resolveEvidence(env, sources);
  if (evidence.length === 0) {
    return {
      outcome: 'no-op',
      scaffold: {
        ...scaffold,
        factCheckFlags: [
          'No usable research evidence: none of the supplied sources resolves to a stored research item.',
          ...(unresolved.length ? [`Unresolved source(s): ${unresolved.join(', ')}`] : ['No sources were supplied.']),
          'Fetch the source through the research engine first, then generate.',
        ],
      },
      reason: 'insufficient-evidence: no supplied source resolves to stored research — generation paused, no sourceless draft written.',
      unresolved,
    };
  }

  // First try the free LLM layer. Any failure is honest: fall back to
  // the scaffold with outcome 'no-op' — never fabricate a body.
  const disclaimer = disclaimerForDivision(division);
  const system = LLM_SYSTEM_PROMPT + (disclaimer
    ? ` End with this exact disclaimer sentence: "${disclaimer}"`
    : '');
  const llm = await generateText({
    prompt: buildLlmPrompt({ title, divisionName: row.name, outline, sources, evidence }),
    system,
    maxTokens: 1500,
    purpose: 'content-creation',
  }, env);
  if (llm.ok && llm.text) {
    const body = sanitiseText(llm.text, 20000);
    // Truncation guard (Workstream A, task D): a generated body cut
    // off mid-sentence / mid-markup is a failed LLM output, never a
    // draft. Required headings are enforced ONLY when the outline was
    // explicitly supplied (payload.outline): the title-derived fallback
    // outline is a suggestion, not a promise the LLM must fulfil, so
    // a body that organises itself differently must not be called
    // truncated for missing a generic heading.
    const explicitOutline = Array.isArray(payload.outline) && payload.outline.length;
    const truncated = isTruncatedDraftBody(body, { requiredHeadings: explicitOutline ? outline : [] });
    if (truncated) {
      return {
        outcome: 'no-op',
        scaffold,
        reason: `truncated-generation: the generated body is incomplete (${truncated.reasons.join('; ')}) — generation paused, no draft written. Re-run: a fresh LLM call may complete.`,
        truncationReasons: truncated.reasons,
      };
    }
    // Cross-draft duplicate guard (Workstream A, task B): refuse to
    // return a body that duplicates an existing article (draft or
    // published). A near-duplicate is allowed but flagged, so the
    // fact-checker and the owner can see the overlap before approval.
    const dup = await checkCrossDraftDuplicates(env, { title, body });
    if (dup.isDuplicate) {
      return {
        outcome: 'no-op',
        scaffold,
        reason: `duplicate-content: the generated body duplicates article #${dup.closest.id} (${dup.closest.status}, ${Math.round(dup.closest.overlap * 100)}% shingle overlap, Jaccard ${Math.round(dup.closest.jaccard * 100)}%) — generation skipped to avoid a duplicate draft.`,
        duplicateArticleId: dup.closest.id,
        duplicateOverlap: Math.round(dup.closest.overlap * 100),
      };
    }
    // Meta description from the real body text (120-160 chars); falls
    // back to the title text when the body is too short to fill it —
    // the SEO repair step then fixes it from real content.
    const bodyDescription = deriveSeoDescription(body);
    const finalSeoDescription = bodyDescription || seoDescription;
    const sourceIds = evidence.map((e) => e.researchItemId);
    const draft = {
      title,
      division,
      divisionId: row.id,
      body,
      outline,
      seoTitle,
      seoDescription: finalSeoDescription,
      sources,
      evidence,
      sourceIds,
      llmGenerated: true,
      provider: llm.provider,
      model: llm.model,
      needsFactCheck: true,
      factCheckFlags: [
        ...scaffold.factCheckFlags,
        'AI-generated draft — needs fact-checking before approval.',
        ...(dup.isNearDuplicate
          ? [`Near-duplicate of article #${dup.closest.id} (${dup.closest.status}, ${Math.round(dup.closest.overlap * 100)}% shingle overlap) — review before approval; do not publish both.`]
          : []),
      ],
      note: 'AI-DRAFT — needs fact-check + owner approval; never auto-publish.',
    };
    return {
      outcome: 'done',
      draft,
      // The scaffold carries the LLM body too, so the existing
      // convert endpoint (which reads detail.scaffold) stores the
      // real draft body instead of a placeholder.
      scaffold: { ...scaffold, body, seoDescription: finalSeoDescription, evidence, sourceIds, llmGenerated: true, provider: llm.provider, model: llm.model, needsFactCheck: true },
    };
  }
  return {
    outcome: 'no-op',
    scaffold,
    reason: 'All free LLM providers unavailable — generation paused',
    providerStatuses: llm.providerStatuses || [],
  };
}

/**
 * Convert a scaffold (as stored in an agent_runs.detail) into a CMS draft.
 * Same validation as the admin article create: title >= 5 chars, valid
 * division slug, unique slug (409 on clash). A plain scaffold gets a
 * body clearly marked SCAFFOLD; a scaffold carrying an LLM body
 * (llmGenerated) stores that body under a clear 'AI-DRAFT — needs
 * fact-check + owner approval' marker. Status is always 'draft' with
 * fact_checked = 0 — never published, never fact-checked.
 */
export async function convertScaffoldToDraft(env, scaffold) {
  if (!scaffold || typeof scaffold !== 'object') return { ok: false, status: 400, error: 'No scaffold found in this run.' };
  const title = typeof scaffold.title === 'string' ? scaffold.title.trim() : '';
  const division = typeof scaffold.division === 'string' ? scaffold.division.trim() : '';
  if (title.length < 5) return { ok: false, status: 400, error: 'Scaffold title is required (at least 5 characters).' };
  if (!division || !isValidSlug(division)) return { ok: false, status: 400, error: 'Scaffold division must be a valid slug.' };
  const row = await d1First(env, 'SELECT id, slug FROM business_divisions WHERE slug = ? LIMIT 1', [division]);
  if (!row) return { ok: false, status: 400, error: `Unknown division slug: ${division}.` };
  const slug = slugify(title);
  if (!slug) return { ok: false, status: 400, error: 'Could not derive a slug from the title.' };
  const clash = await d1First(env, 'SELECT id FROM articles WHERE slug = ? LIMIT 1', [slug]);
  if (clash) return { ok: false, status: 409, error: 'An article with this slug already exists.' };

  // Cross-draft duplicate guard, race layer (Workstream A, task B):
  // runContentCreation already refuses a duplicate body, but two
  // concurrent generations of the same topic both pass that check
  // (neither draft exists yet when the other generates). The convert
  // step is the serialisation point — the first INSERT wins, the
  // second is refused 409 here. Plain scaffolds (placeholder bodies)
  // are NOT checked: their placeholder text is identical by design
  // and the slug clash above already guards topic duplication.
  const llmBodyForCheck = scaffold.llmGenerated && typeof scaffold.body === 'string' && scaffold.body.trim()
    ? sanitiseText(scaffold.body, 20000) : '';
  if (llmBodyForCheck) {
    const dup = await checkCrossDraftDuplicates(env, { title, body: llmBodyForCheck });
    if (dup.isDuplicate) {
      return {
        ok: false, status: 409, duplicateArticleId: dup.closest.id,
        error: `Duplicate content: this draft duplicates article #${dup.closest.id} (${dup.closest.status}, ${Math.round(dup.closest.overlap * 100)}% shingle overlap) — not stored.`,
      };
    }
  }

  const outline = Array.isArray(scaffold.outline) ? scaffold.outline : [];
  const sources = Array.isArray(scaffold.sources) ? scaffold.sources : [];
  // An LLM draft stores its real body (marked AI-DRAFT); a plain
  // scaffold stores a placeholder outline instead. Either way the
  // article is a 'draft' with fact_checked = 0 — never published.
  const llmBody = scaffold.llmGenerated && typeof scaffold.body === 'string' && scaffold.body.trim()
    ? sanitiseText(scaffold.body, 20000) : '';
  const bodyLines = llmBody ? [
    'AI-DRAFT — needs fact-check + owner approval.',
    '',
    `This draft was written by ${scaffold.provider || 'an LLM'}${scaffold.model ? ` (${scaffold.model})` : ''}. ` +
    'It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.',
    '',
    llmBody,
    '',
    'Sources:',
    ...(sources.length ? sources.map((s) => `- ${s}`) : ['- None supplied — add sources before approval.']),
  ] : [
    'SCAFFOLD — full draft needed.',
    '',
    'This draft was created from an agent scaffold. No article body was fabricated: ' +
    'the owner (or an LLM) must write the full body, add sources and pass fact-checking before approval.',
    '',
    ...outline.map((h) => `## ${h}\n\n[Write this section — no content yet.]`),
    '',
    'Sources:',
    ...(sources.length ? sources.map((s) => `- ${s}`) : ['- None supplied — add sources before approval.']),
  ];
  const now = nowIso();
  const result = await d1Run(env,
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.id,
      sanitiseText(title, 200),
      slug,
      sanitiseText(typeof scaffold.seoDescription === 'string' ? scaffold.seoDescription : '', 500),
      bodyLines.join('\n'),
      'FS AI',
      'draft',
      0,
      sanitiseText(typeof scaffold.seoTitle === 'string' ? scaffold.seoTitle : '', 200),
      sanitiseText(typeof scaffold.seoDescription === 'string' ? scaffold.seoDescription : '', 300),
      null, null, null, null, now, now,
    ]);
  const id = result && result.meta ? result.meta.last_row_id : null;
  if (!id) return { ok: false, status: 500, error: 'Article was not stored.' };
  // Record the cited sources as article_sources rows so the fact-checker
  // and the publish gate can verify them (the body text alone is not
  // enough). source_type MUST use the values the table's CHECK allows
  // ('official', 'news', 'research', 'manufacturer', 'other') — the old
  // code wrote 'rss'/'web', which the CHECK rejects on real SQLite/D1,
  // and the failure was silently swallowed (.catch(() => {})), so every
  // generated draft recorded 0 sources (article #27, 2026-11-19).
  // Fixed 2026-11-20: RSS research items -> 'research', other URLs ->
  // 'other'; the research_items id is stored in research_item_id when
  // known (from the scaffold's resolved evidence or a URL lookup).
  // Inserts are idempotent (an existing row for the same article+URL is
  // skipped) and failures are REPORTED, never swallowed.
  const evidenceByUrl = new Map();
  for (const e of Array.isArray(scaffold.evidence) ? scaffold.evidence : []) {
    if (e && typeof e.url === 'string' && e.researchItemId) evidenceByUrl.set(e.url, e.researchItemId);
  }
  let sourcesRecorded = 0;
  let sourcesDeduped = 0;
  const sourceErrors = [];
  const urlIndexCache = {};
  for (const s of sources) {
    const text = String(s || '').trim();
    if (!text) continue;
    const isUrl = /^https?:\/\//i.test(text);
    let researchItemId = evidenceByUrl.get(text) || null;
    let sourceType = isUrl ? 'other' : 'other';
    if (isUrl && !researchItemId) {
      // Exact match first, then the safe normalised match (Phase 3,
      // Priority 1): a supplied URL with a trailing slash / www /
      // http-vs-https variation still links to the stored research.
      const found = await findResearchItemByUrl(env, text, urlIndexCache);
      if (found) { researchItemId = found.item.id; sourceType = 'research'; }
    } else if (researchItemId) {
      sourceType = 'research';
    }
    try {
      // Idempotent: skip when the same article+URL (or, for non-URL
      // sources, the same article+title) is already recorded. (NULL
      // source_url never equals NULL in SQL, so title is the key there.)
      const existing = isUrl
        ? await d1First(env, 'SELECT id FROM article_sources WHERE article_id = ? AND source_url = ? LIMIT 1', [id, text])
        : await d1First(env, 'SELECT id FROM article_sources WHERE article_id = ? AND source_title = ? AND source_url IS NULL LIMIT 1', [id, text]);
      if (existing) { sourcesDeduped += 1; continue; }
      await d1Run(env,
        'INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, text, isUrl ? text : null, sourceType, researchItemId, now]);
      sourcesRecorded += 1;
    } catch (err) {
      sourceErrors.push(`${text}: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
    }
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division, d.name AS division_name FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1', [id]);
  return {
    ok: true, article, sourcesRecorded, sourcesDeduped, sourceErrors,
    ...(sources.length > 0 && sourcesRecorded === 0
      ? { warning: `Article stored but none of its ${sources.length} source(s) could be recorded — the publish gate will treat it as unsourced. Errors: ${sourceErrors.join('; ') || 'unknown'}` }
      : {}),
  };
}

/**
 * Scaffold-draft regeneration (W2 fix, 2026-11-21).
 *
 * Live #29 is a SCAFFOLD shell (593 chars: "SCAFFOLD — full draft
 * needed" + six empty "[Write this section — no content yet.]"
 * sections). Its fact-checks fail CORRECTLY — the article has no
 * content to check — so no amount of re-checking or correcting can
 * fix it. The real fix is to regenerate a real body from the
 * article's own recorded evidence and then fact-check THAT.
 *
 * Detection: isScaffoldBody() — the SCAFFOLD marker line, or any
 * "[Write this section — no content yet.]" placeholder section.
 * (A body with the marker is a scaffold even if an owner added a
 * paragraph beside it: the marker means "no full draft exists".)
 *
 * regenerateScaffoldDraft(env, articleId) — the safe re-generation
 * path. It NEVER creates a duplicate article: it reuses the article
 * row in place (same id, same slug, same title). It NEVER publishes:
 * the row stays 'draft' with fact_checked = 0, and the new body
 * carries the AI-DRAFT banner. It writes an article_revisions
 * snapshot of the scaffold FIRST (revised_by 'scaffold-regen'), so
 * the empty shell is recoverable. Evidence comes only from the
 * article's own recorded sources (article_sources -> research_items,
 * via resolveEvidence — the same evidence-grounding as
 * runContentCreation); with no usable evidence it returns no-op
 * 'insufficient-evidence' and touches nothing, exactly like
 * generation. A generated body that is too short, still a scaffold,
 * or cut off mid-sentence is a FAILED (retryable, temporary) LLM
 * output — never saved as if complete. The daily article cap does
 * NOT apply here: regeneration creates no new article.
 *
 * WIRING: exposed as a function plus the runScaffoldRegeneration(task,
 * env) task handler (payload { article_id }), dispatched in
 * backend/agents/autonomy-runner.js for agent 'content-creation' +
 * kind 'scaffold-regeneration'. It is NOT wired into the scheduled
 * daily run — the coordinator / parent decides when to run it for #29
 * (manual / dashboard trigger). See the W2 report for the exact
 * orchestrator snippet.
 */
export function isScaffoldBody(body) {
  const text = String(body || '');
  if (/SCAFFOLD — full draft needed/.test(text)) return true;
  if (/\[Write this section — no content yet\.\]/.test(text)) return true;
  return false;
}

export function scaffoldPlaceholderCount(body) {
  return (String(body || '').match(/\[Write this section — no content yet\.\]/g) || []).length;
}

function scaffoldRegenRecovery({ articleId, title, rootCause, reasons, retryable }) {
  return {
    taskId: null,
    articleId: articleId ?? null,
    title: title ?? null,
    component: 'content-creation/scaffold-regeneration',
    rootCause,
    reasons: [...reasons],
    attempted: { corrected: 0, removed: 0, skipped: 0 },
    timestamp: new Date().toISOString(),
    retryable: Boolean(retryable),
    status: retryable ? 'RETRYING' : 'BLOCKED_WITH_REASON',
    ownerAction: retryable
      ? 'Re-run the regeneration: a truncated or unavailable LLM output is temporary and a fresh run may complete.'
      : 'Human review: the scaffold needs usable research evidence (fetch its sources first) or an owner-written body.',
    nextStep: retryable
      ? 'Re-run regenerateScaffoldDraft for this article id.'
      : 'Fetch the article’s sources through the research engine (or add sources), then re-run the regeneration.',
  };
}

export async function regenerateScaffoldDraft(env, articleId) {
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) {
    return { outcome: 'failed', error: 'Scaffold regeneration needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division, d.name AS division_name FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [id]);
  if (!article) return { outcome: 'failed', error: `Article ${id} not found.` };
  if (String(article.status || '') === 'published') {
    return { outcome: 'failed', error: `Article ${id} is published — a scaffold regeneration never touches a published article.`, articleId: id };
  }
  if (String(article.status || '') !== 'draft') {
    return { outcome: 'failed', error: `Article ${id} has status '${article.status}' — only a draft scaffold can be regenerated.`, articleId: id };
  }
  const originalBody = String(article.body || '');
  if (!isScaffoldBody(originalBody)) {
    return { outcome: 'no-op', articleId: id, reason: 'Article body is not a scaffold — nothing to regenerate.', isScaffold: false };
  }
  const placeholders = scaffoldPlaceholderCount(originalBody);
  // Evidence: the article's OWN recorded sources only. The sources
  // are already on the row (regeneration must not re-record them and
  // must not reach for unrelated research).
  const sourceRows = await d1All(env, 'SELECT source_url FROM article_sources WHERE article_id = ? ORDER BY id ASC', [id]) || [];
  const sourceUrls = sourceRows.map((r) => r.source_url).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  const { resolved: evidence, unresolved } = await resolveEvidence(env, sourceUrls);
  if (evidence.length === 0) {
    return {
      outcome: 'no-op', articleId: id, title: article.title, isScaffold: true, placeholders,
      reason: 'insufficient-evidence: none of the article’s recorded sources resolves to stored research — regeneration paused, scaffold untouched. Fetch the sources first, then re-run.',
      unresolved,
      recoveryReport: scaffoldRegenRecovery({
        articleId: id, title: article.title,
        rootCause: 'No usable research evidence: none of the article’s recorded sources resolves to a stored research item.',
        reasons: unresolved.length ? [`Unresolved source(s): ${unresolved.join(', ')}`] : ['No sources were recorded for this article.'],
        retryable: false,
      }),
    };
  }
  // Evidence-SUFFICIENCY guard (Workstream A, task E, 2026-11-21):
  // resolving is not enough — the evidence must be enough to write
  // from. Outdated items are excluded (stale facts are not usable
  // evidence), and the floor is MIN_REGEN_EVIDENCE_CHARS of current
  // evidence text. Live #29 fails this exactly: its only evidence is
  // a single 500-char truncated, outdated Guardian fragment, so a
  // 600–900-word regeneration would have to invent most of its facts.
  // Below the floor: no-op, nothing touched, no LLM call (no Neurons
  // spent), and the recovery report names the re-fetch as the fix.
  const currentEvidenceChars = evidence
    .filter((e) => !e.isOutdated)
    .reduce((sum, e) => sum + String(e.evidenceText || '').length, 0);
  const outdatedChars = evidence
    .filter((e) => e.isOutdated)
    .reduce((sum, e) => sum + String(e.evidenceText || '').length, 0);
  if (currentEvidenceChars < MIN_REGEN_EVIDENCE_CHARS) {
    const reasons = [
      `Only ${currentEvidenceChars} characters of current (non-outdated) evidence from ${evidence.length} resolved source(s) — a complete article needs at least ${MIN_REGEN_EVIDENCE_CHARS}.`,
      ...(outdatedChars ? [`${outdatedChars} characters of evidence are outdated and excluded.`] : []),
    ];
    return {
      outcome: 'no-op', articleId: id, title: article.title, isScaffold: true, placeholders,
      reason: `insufficient-evidence: ${reasons.join(' ')} Regeneration paused, scaffold untouched — re-fetch the sources through the research engine first, then re-run.`,
      unresolved,
      currentEvidenceChars,
      outdatedChars,
      recoveryReport: scaffoldRegenRecovery({
        articleId: id, title: article.title,
        rootCause: 'Evidence too thin to regenerate honestly: the resolved research is shorter than the minimum for a complete article, or outdated.',
        reasons,
        retryable: false,
      }),
    };
  }
  // Outline: the scaffold's own section headings (its shape is the
  // owner's outline); fall back to title-derived headings.
  const outline = originalBody.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^##\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  const finalOutline = outline.length ? outline : headingsFromTitle(article.title, sourceUrls);
  const disclaimer = disclaimerForDivision(article.division);
  const system = LLM_SYSTEM_PROMPT + (disclaimer
    ? ` End with this exact disclaimer sentence: "${disclaimer}"`
    : '');
  const llm = await generateText({
    prompt: buildLlmPrompt({ title: article.title, divisionName: article.division_name, outline: finalOutline, sources: sourceUrls, evidence }),
    system,
    maxTokens: 1500,
    purpose: 'scaffold-regeneration',
  }, env);
  if (!llm.ok || !llm.text) {
    return {
      outcome: 'no-op', articleId: id, title: article.title, isScaffold: true, placeholders,
      reason: 'All free LLM providers unavailable — regeneration paused, scaffold untouched.',
      providerStatuses: llm.providerStatuses || [],
    };
  }
  const generated = sanitiseText(llm.text, 20000);
  // A generated body that is too short, still a scaffold, or cut off
  // mid-sentence is a failed LLM output — never saved as complete.
  // The ad-hoc checks below are kept (the 500-char floor is a
  // regeneration-specific bar), and the shared truncation guard
  // (Workstream A, task D) adds the structural signals — unclosed
  // HTML/Markdown, ends-on-a-function-word, missing outline sections
  // (a body that drops its Conclusion) — merged into one reason list.
  const truncationReasons = [];
  if (generated.length < 500) truncationReasons.push(`generated body is only ${generated.length} characters (a real draft needs at least 500)`);
  if (isScaffoldBody(generated)) truncationReasons.push('generated body is still a scaffold (marker/placeholder sections present)');
  if (generated && !/[.!?]["”')]?$/.test(generated.trim())) truncationReasons.push(`generated body ends mid-sentence: "...${generated.trim().slice(-80)}"`);
  const structuralTruncation = isTruncatedDraftBody(generated, {
    // Required headings are enforced only when the scaffold carried
    // its own ## headings (its outline is the owner's shape); the
    // title-derived fallback outline is a suggestion, not a promise.
    requiredHeadings: outline.length ? finalOutline : [],
    minWords: 0,
  });
  if (structuralTruncation) {
    for (const r of structuralTruncation.reasons) {
      if (!truncationReasons.some((x) => x.includes(r.slice(0, 40)))) truncationReasons.push(r);
    }
  }
  if (truncationReasons.length) {
    return {
      outcome: 'failed', articleId: id, title: article.title, isScaffold: true, placeholders,
      error: 'Generated body failed the completeness check — nothing was saved.',
      reasons: truncationReasons,
      recoveryReport: scaffoldRegenRecovery({
        articleId: id, title: article.title,
        rootCause: 'Generated body incomplete (too short, still a scaffold, or cut off mid-sentence).',
        reasons: truncationReasons,
        retryable: true,
      }),
    };
  }
  const bodyDescription = deriveSeoDescription(generated);
  const finalBody = [
    'AI-DRAFT — needs fact-check + owner approval.',
    '',
    `This draft was written by ${llm.provider || 'an LLM'}${llm.model ? ` (${llm.model})` : ''}. ` +
    'It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.',
    '',
    generated,
    '',
    'Sources:',
    ...(sourceUrls.length ? sourceUrls.map((s) => `- ${s}`) : ['- None supplied — add sources before approval.']),
  ].join('\n');
  const now = nowIso();
  // Snapshot the scaffold FIRST (rollback), then replace the body in
  // place. Same row, same slug, same title — never a duplicate, never
  // published, fact_checked stays 0.
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, article.title, article.excerpt || null, originalBody, article.status, 'scaffold-regen']);
  await d1Run(env,
    'UPDATE articles SET body = ?, seo_description = ?, updated_at = ? WHERE id = ?',
    [finalBody, bodyDescription || article.seo_description || null, now, id]);
  return {
    outcome: 'done',
    articleId: id,
    title: article.title,
    division: article.division,
    regenerated: true,
    isScaffold: true,
    placeholders,
    previousBodyLength: originalBody.length,
    newBodyLength: finalBody.length,
    provider: llm.provider,
    model: llm.model,
    sourcesUsed: evidence.length,
    evidence,
    note: 'Scaffold regenerated in place (same article row, still a draft, fact_checked 0) — run a fact-check on the new body before any approval.',
  };
}

/**
 * Task-handler shape for regenerateScaffoldDraft, so the dashboard /
 * orchestrator can invoke it as a manual step (payload { article_id }).
 * NOT wired into the scheduled daily run — the coordinator decides
 * when to run it. Returns regenerateScaffoldDraft's result verbatim.
 */
export async function runScaffoldRegeneration(task, env) {
  const payload = parsePayload(task);
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { outcome: 'failed', error: 'Scaffold regeneration needs a valid article_id.' };
  }
  return regenerateScaffoldDraft(env, articleId);
}
