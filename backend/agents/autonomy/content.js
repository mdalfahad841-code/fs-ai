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
      factCheckFlags: [...scaffold.factCheckFlags, 'AI-generated draft — needs fact-checking before approval.'],
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
