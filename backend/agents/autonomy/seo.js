/**
 * FS AI — Autonomy: SEO + quality agent handler.
 *
 * Computes SEO fields from the article's REAL text and runs a checks
 * suite: seo title, meta description, unique slug, H1/H2/H3 hierarchy,
 * keyword relevance + natural placement, internal linking, image alt
 * text when images exist, readability estimate, duplicate detection
 * (word-shingle overlap vs other published articles), broken-link
 * checking (live fetch, capped at 5 links), and structured-metadata
 * presence. Every run stores a seo_checks row; the publish gate reads
 * the latest verdict. SEO never overrides factual accuracy — the gate
 * requires a fact-check pass first.
 *
 * REPAIR (added 2026-11-20): runSeo() now REPAIRS inadequate fields
 * from the article's own content instead of filling blanks only — a
 * short meta description is regenerated from the body (120-160 chars),
 * H3 headings are promoted to H2 when the body has fewer than 2 H2s,
 * and a genuine internal link is appended when a real published sibling
 * exists. Nothing is invented: no heading or link is created from
 * nothing, and published articles are never modified. Every repair is
 * recorded as an article_revisions row AFTER all mutations, so the
 * revision reflects the final live body (W2 fix, 2026-11-21 — the old
 * pre-edit-only snapshot understated the live body after the
 * Related-reading append). Every SEO run stores a seo_checks row tied
 * to the body hash + length it checked (migration 023).
 */
import { d1All, d1First, d1Run, nowIso, deriveSeoDescription, isMissingColumnError } from '../../middleware/validation.js';
import { bodyHash } from '../../utils/bodyHash.js';
// Workstream A: relevance uses the SAME rule the auto-publish evaluator
// uses (backend/publishing/divisions.js isInternalLinkRelevant — same
// division AND topical title-keyword overlap, generic words excluded),
// so the SEO suite and the gate can never disagree about a link.
// The import is circular at module level (divisions.js imports
// titleKeywords from here) — ESM-legal: both modules only call each
// other's functions at runtime, after evaluation. Verified by the
// seo-relevance + autonomous-publishing test runs.
// Truncation uses the absolute-signal guard from factcheck.js (no
// cycle: factcheck.js does not import seo.js).
import { isInternalLinkRelevant, extractLinkedArticleIds } from '../../publishing/divisions.js';
import { isTruncatedDraftBody } from './factcheck.js';

/**
 * Store one SEO run's result, tied to the exact body it checked
 * (W2 fix, 2026-11-21 — migration 023, same style as fact_checks
 * body_hash in migration 019). A run that cannot record its body
 * hash (migration 023 not yet applied live) still writes its verdict
 * — but a hash-less row must be treated as stale by any reader, so
 * it can never pass anything as fresh.
 */
async function insertSeoCheck(env, articleId, verdict, checks) {
  const row = await d1First(env, 'SELECT body FROM articles WHERE id = ? LIMIT 1', [articleId]);
  const body = row ? String(row.body || '') : '';
  const hash = await bodyHash(body);
  const length = body.length;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO seo_checks (article_id, verdict, checks_json, body_hash, body_length) VALUES (?, ?, ?, ?, ?)',
      [articleId, verdict, JSON.stringify(checks), hash, length]);
    return { seoCheckId: inserted && inserted.meta ? inserted.meta.last_row_id : null, bodyHash: hash, bodyLength: length };
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    const inserted = await d1Run(env, 'INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, ?, ?)',
      [articleId, verdict, JSON.stringify(checks)]);
    return { seoCheckId: inserted && inserted.meta ? inserted.meta.last_row_id : null, bodyHash: null, bodyLength: length };
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

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'has', 'have', 'can', 'will', 'you', 'your', 'when', 'what', 'how', 'why',
  'not', 'but', 'also', 'more', 'than', 'then', 'them', 'they', 'its', 'into',
  'about', 'after', 'before', 'over', 'under', 'between', 'while', 'which',
  'there', 'here', 'should', 'would', 'could', 'much', 'many', 'most', 'some',
]);

export function titleKeywords(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function shingles(text, n = 5) {
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= words.length; i += 1) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Word-set Jaccard similarity (0..1) — the semantic half of
 * cross-draft duplicate detection. Shingle overlap catches copied
 * passages; Jaccard catches a body rewritten with the same vocabulary
 * (same facts, reworded sentences). Both are free, local, and need no
 * external service.
 */
export function wordJaccard(a, b) {
  const setA = new Set(String(a || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  const setB = new Set(String(b || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

/** Normalised content fingerprint: SHA-256 of the normalised body. */
export async function contentFingerprint(body) {
  return bodyHash(body);
}

/**
 * Cross-draft duplicate detection (Workstream A, task B).
 *
 * Compares the article against EVERY other non-archived article —
 * published AND draft — by 5-word shingle overlap (copied passages)
 * and word-set Jaccard (same vocabulary, reworded). Returns:
 *   { fingerprint, wordCount, shingleCount,
 *     closest: { id, status, overlap, jaccard } | null,
 *     isDuplicate, isNearDuplicate }
 * Thresholds (same as the SEO suite's duplicate check): duplicate at
 * shingle overlap >= 0.5 or Jaccard >= 0.9; near-duplicate at >= 0.25
 * or >= 0.7. An article with no other article to compare against has
 * closest null and is neither. The article itself is always excluded
 * (by id when stored; a not-yet-stored draft passes id null/-1 and
 * compares against everything).
 * Pure reads — never writes, never blocks unrelated articles (an
 * unrelated topic scores near 0 on both measures).
 */
export async function checkCrossDraftDuplicates(env, article) {
  const body = String((article && article.body) || '');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const fingerprint = await contentFingerprint(body);
  const mine = shingles(plainBody);
  const wordCount = plainBody.split(/\s+/).filter(Boolean).length;
  const result = {
    fingerprint, wordCount, shingleCount: mine.size,
    closest: null, isDuplicate: false, isNearDuplicate: false,
  };
  const selfId = article && Number.isInteger(Number(article.id)) ? Number(article.id) : -1;
  const others = await d1All(env,
    "SELECT id, status, body FROM articles WHERE id != ? AND status != 'archived'", [selfId]) || [];
  let best = null;
  for (const other of others) {
    const otherPlain = String(other.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const theirs = shingles(otherPlain);
    let overlap = 0;
    if (mine.size && theirs.size) {
      let common = 0;
      for (const s of mine) if (theirs.has(s)) common += 1;
      overlap = common / mine.size;
    } else if (!mine.size && !theirs.size) {
      overlap = 1; // two empty bodies are identical
    }
    const jaccard = wordJaccard(plainBody, otherPlain);
    const score = Math.max(overlap, jaccard);
    if (!best || score > best.score) {
      best = { id: other.id, status: other.status, overlap, jaccard, score };
    }
  }
  if (best) {
    result.closest = { id: best.id, status: best.status, overlap: best.overlap, jaccard: best.jaccard };
    result.isDuplicate = best.overlap >= 0.5 || best.jaccard >= 0.9;
    result.isNearDuplicate = !result.isDuplicate && (best.overlap >= 0.25 || best.jaccard >= 0.7);
  }
  return result;
}

/**
 * Persist one duplicate decision (migration 024). Best-effort and
 * silent on failure: a missing table (pre-024 database) skips the
 * write — the SEO verdict never depends on this table, and a missing
 * row reads as "not fingerprinted", never as "no duplicate".
 */
export async function storeArticleFingerprint(env, articleId, body, dup) {
  try {
    const decision = dup.isDuplicate ? 'duplicate' : (dup.isNearDuplicate ? 'near-duplicate' : 'ok');
    await d1Run(env,
      `INSERT INTO article_fingerprints
         (article_id, fingerprint, body_length, word_count, shingle_count,
          closest_article_id, closest_status, closest_overlap_pct, closest_jaccard_pct,
          decision, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(article_id) DO UPDATE SET
         fingerprint = excluded.fingerprint, body_length = excluded.body_length,
         word_count = excluded.word_count, shingle_count = excluded.shingle_count,
         closest_article_id = excluded.closest_article_id, closest_status = excluded.closest_status,
         closest_overlap_pct = excluded.closest_overlap_pct, closest_jaccard_pct = excluded.closest_jaccard_pct,
         decision = excluded.decision, checked_at = excluded.checked_at`,
      [
        articleId, dup.fingerprint, String(body || '').length, dup.wordCount, dup.shingleCount,
        dup.closest ? dup.closest.id : null, dup.closest ? dup.closest.status : null,
        dup.closest ? Math.round(dup.closest.overlap * 1000) / 10 : null,
        dup.closest ? Math.round(dup.closest.jaccard * 1000) / 10 : null,
        decision, nowIso(),
      ]);
    return { stored: true, decision };
  } catch {
    return { stored: false, decision: null };
  }
}

/**
 * Markdown anchor texts pointing at one article id, e.g. for
 * "[Title](https://fs-ai-5w5.pages.dev/pages/article?id=12)" the
 * anchor is "Title". A bare URL has no anchor (null) and is never
 * misleading on its own — the link target is judged separately.
 */
export function anchorTextsForArticle(body, targetId) {
  const anchors = [];
  const text = String(body || '');
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    const url = m[2] || '';
    const idMatch = url.match(/[?&]id=(\d+)/);
    if (idMatch && Number(idMatch[1]) === Number(targetId)) anchors.push(m[1].trim());
  }
  return anchors;
}

/**
 * True when an anchor text misleads about its target: it shares no
 * title keyword with the target title (stopwords filtered, same
 * titleKeywords the suite uses) and is not the title itself or part
 * of it. "Click here" / "this guide" / a wrong article's title all
 * fail; the real title, or a title fragment, passes. An empty anchor
 * is misleading (a link with no readable text).
 */
export function isMisleadingAnchor(anchor, targetTitle) {
  const a = String(anchor || '').trim();
  const t = String(targetTitle || '').trim();
  if (!a) return true;
  if (t && (t.toLowerCase() === a.toLowerCase() || t.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(t.toLowerCase()))) return false;
  const anchorKeywords = titleKeywords(a);
  const titleKeywordsSet = new Set(titleKeywords(t));
  return !anchorKeywords.some((k) => titleKeywordsSet.has(k));
}

/**
 * Truncation gate for a stored SEO result (Workstream A, task D).
 * The 11-check suite measures the body as it stands; a truncated
 * body can still score 11/11 on the other checks (its claims may be
 * fine — they are just incomplete), so the wrapper appends a 12th
 * entry and forces the verdict to 'failed' when the absolute-signal
 * guard (factcheck.js isTruncatedDraftBody) fires. The suite itself
 * stays 11 checks — this is the record-time enforcement the publish
 * gate reads (gate.js requires verdict 'pass' + all checks passing),
 * so a truncated article can never pass the gate through SEO.
 * Returns { checks, verdict } — the suite untouched when complete.
 */
export function applyTruncationGateToSeoResult(suite, body) {
  const truncation = isTruncatedDraftBody(body);
  if (!truncation) return { checks: suite.checks, verdict: suite.verdict };
  const entry = {
    name: 'truncation', ok: false, level: 'failed',
    detail: `Body looks truncated — it must not be published as complete: ${truncation.reasons.join('; ')} Fix: regenerate or correct the body so it ends completely, then re-run the SEO check.`,
  };
  const checks = [...suite.checks, entry];
  return { checks, verdict: 'failed' };
}

export function extractExternalLinks(body) {
  const urls = new Set();
  const text = String(body || '');
  for (const m of text.matchAll(/https?:\/\/[^\s)'"`<>]+/g)) urls.add(m[0].replace(/[.,;]+$/, ''));
  return [...urls].filter((u) => u.startsWith('https://')).slice(0, 5);
}

/**
 * Classify a link-fetch outcome (Phase 3, Priority 4).
 * A link is CONFIRMED BROKEN only on 404/410 (+400). HTTP 406 (and
 * 401/403/429/5xx, timeouts, unreachable hosts) means the checker
 * could not verify the link — it is UNVERIFIABLE, never confirmed
 * broken: the Guardian answers 406 to plain HEAD requests, so every
 * Guardian-sourced article used to fail SEO on a healthy link.
 * Never auto-pass an unverifiable link as healthy either: it is
 * reported as unverifiable with the exact reason.
 */
export function classifyLinkStatus(status, error) {
  if (error) {
    return { classification: 'unverifiable', reason: error === 'timeout' ? 'request timed out' : 'host unreachable' };
  }
  if (status >= 200 && status < 400) return { classification: 'ok', reason: `HTTP ${status}` };
  if (status === 404 || status === 410 || status === 400) return { classification: 'broken', reason: `HTTP ${status}` };
  if (status === 406) return { classification: 'unverifiable', reason: 'HTTP 406 — server refused the request format (common for HEAD requests; link not confirmed broken)' };
  if (status === 401 || status === 403) return { classification: 'unverifiable', reason: `HTTP ${status} — access restricted (auth/paywall); never bypassed` };
  if (status === 429) return { classification: 'unverifiable', reason: 'HTTP 429 — rate-limited' };
  if (status >= 500) return { classification: 'unverifiable', reason: `HTTP ${status} — server error` };
  return { classification: 'unverifiable', reason: `HTTP ${status}` };
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchLinkOnce(url, fetchImpl, { withBrowserUa = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = withBrowserUa ? { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' } : {};
    const res = await fetchImpl(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow', headers });
    return { status: res.status, error: null };
  } catch (err) {
    return { status: 0, error: err && err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

async function checkBrokenLinks(urls, fetchImpl) {
  const results = [];
  for (const url of urls) {
    // First try: plain HEAD. On an unverifiable outcome caused by the
    // request itself (406/403/429), retry ONCE with a legitimate
    // browser-like User-Agent — many publishers reject bare HEAD
    // requests but answer browsers. Never bypass auth/paywalls: a
    // 401/403 after the retry stays unverifiable, never "ok".
    let outcome = await fetchLinkOnce(url, fetchImpl);
    let retried = false;
    const first = classifyLinkStatus(outcome.status, outcome.error);
    if (first.classification === 'unverifiable' && (outcome.status === 406 || outcome.status === 403 || outcome.status === 429)) {
      retried = true;
      outcome = await fetchLinkOnce(url, fetchImpl, { withBrowserUa: true });
    }
    const final = classifyLinkStatus(outcome.status, outcome.error);
    results.push({
      url, status: outcome.status,
      ok: final.classification === 'ok',
      classification: final.classification,
      reason: final.reason,
      ...(retried ? { retriedWithBrowserUa: true } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  }
  return results;
}

export async function runSeoCheckSuite(env, article, { fetchImpl } = {}) {
  const body = String(article.body || '');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const checks = [];
  const push = (name, ok, level, detail) => checks.push({ name, ok, level, detail });

  // 1. SEO title 30-60 chars.
  const seoTitle = String(article.seo_title || '').trim();
  push('seo-title', seoTitle.length >= 30 && seoTitle.length <= 60, seoTitle ? 'needs-review' : 'failed',
    seoTitle
      ? `SEO title is ${seoTitle.length} characters (target 30-60). Fix: shorten it to 30-60 characters — the SEO repair truncates an over-long title at a word boundary.`
      : 'SEO title is missing. Fix: set it from the article title (30-60 characters).');

  // 2. Meta description 120-160 chars.
  const seoDescription = String(article.seo_description || '').trim();
  push('meta-description', seoDescription.length >= 120 && seoDescription.length <= 160, seoDescription ? 'needs-review' : 'failed',
    seoDescription
      ? `Meta description is ${seoDescription.length} characters (target 120-160). Fix: regenerate it from the article text to 120-160 characters — the SEO repair does this automatically.`
      : 'Meta description is missing. Fix: write one from the article text (120-160 characters).');

  // 3. Unique slug.
  const slugDupes = await d1All(env, 'SELECT id FROM articles WHERE slug = ? AND id != ?', [article.slug, article.id]) || [];
  push('slug-unique', slugDupes.length === 0, 'failed',
    slugDupes.length ? `Slug is used by ${slugDupes.length} other article(s).` : 'Slug is unique.');

  // 4. Heading hierarchy: title is the H1; body should have H2s, no H1 of its own.
  const h1Count = (body.match(/^#\s.+$/gm) || []).length + (body.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (body.match(/^##\s.+$/gm) || []).length + (body.match(/<h2[\s>]/gi) || []).length;
  const h3Count = (body.match(/^###\s.+$/gm) || []).length + (body.match(/<h3[\s>]/gi) || []).length;
  push('heading-hierarchy', h1Count === 0 && h2Count >= 2, 'needs-review',
    `Body headings: ${h1Count} H1, ${h2Count} H2, ${h3Count} H3. Title is the page H1; body needs at least 2 H2s and no H1 of its own. Fix: write section headings with ## (H2) — the SEO repair promotes H3s to H2s when at least 2 exist.`);

  // 5. Keyword relevance: title keywords present in the body.
  const keywords = titleKeywords(article.title);
  const bodyLower = plainBody.toLowerCase();
  const present = keywords.filter((k) => bodyLower.includes(k));
  const coverage = keywords.length ? present.length / keywords.length : 0;
  push('keyword-relevance', coverage >= 0.5, 'needs-review',
    keywords.length ? `${present.length}/${keywords.length} title keywords appear in the body (${Math.round(coverage * 100)}%).` : 'No keywords could be derived from the title.');

  // 6. Internal linking: the body must link a GENUINELY RELEVANT
  // published article — same division AND topical title-keyword
  // overlap, the same rule the auto-publish evaluator uses
  // (divisions.js isInternalLinkRelevant). The old check passed on
  // ANY same-division sibling, so the repair could append — and the
  // suite could bless — a link to an unrelated article (live #31 ->
  // #22: same division, zero topical overlap). That link is now
  // rejected: an unrelated same-division link, a self link, a draft
  // link, or a misleading anchor text all fail this check. A body
  // with no relevant article to link to fails honestly with "no
  // relevant article exists" — the repair must never fake a link to
  // satisfy the check. Valid existing links (relevant + honest anchor)
  // are preserved: they pass unchanged.
  // Sibling window is 25, not 5 (Workstream A): relevance must see
  // the WHOLE division, not just the newest 5 — the old LIMIT 5 hid
  // the most relevant sibling whenever it was not among the newest
  // (the EV-charging fixture's identical-title sibling #1 fell
  // outside the window). Divisions publish at most ~12 articles, so
  // 25 bounds the query while covering the division.
  const siblings = await d1All(env,
    'SELECT id, division_id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 25',
    [article.division_id, 'published', article.id]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, division_id: s.division_id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article?id=${s.id}`,
  }));
  const bodyLinks = (l) => body.includes(l.url) || body.includes(`id=${l.id}`) || body.includes(l.slug);
  const linkedSiblings = internalLinks.filter(bodyLinks);
  const linkedIds = new Set(extractLinkedArticleIds(body));
  const selfLinked = linkedIds.has(Number(article.id));
  const relevantLinked = linkedSiblings.filter((l) => isInternalLinkRelevant(article, l));
  const irrelevantLinked = linkedSiblings.filter((l) => !isInternalLinkRelevant(article, l));
  const misleadingLinked = relevantLinked.filter((l) => {
    const anchors = anchorTextsForArticle(body, l.id);
    return anchors.some((a) => isMisleadingAnchor(a, l.title));
  });
  const relevantUnlinked = internalLinks.filter((l) => !bodyLinks(l) && isInternalLinkRelevant(article, l));
  const internalOk = relevantLinked.length > 0 && irrelevantLinked.length === 0 && misleadingLinked.length === 0 && !selfLinked;
  let internalDetail;
  if (selfLinked) {
    internalDetail = 'Body links to itself — a self-link is not an internal link. Fix: link a different, genuinely relevant published article in the same division.';
  } else if (relevantLinked.length > 0 && irrelevantLinked.length === 0 && misleadingLinked.length === 0) {
    internalDetail = `Body links ${relevantLinked.length} genuinely relevant same-division article(s)${relevantLinked.map((l) => ` (#${l.id} "${l.title}")`).join('')}.`;
  } else if (linkedSiblings.length === 0) {
    internalDetail = relevantUnlinked.length
      ? `${relevantUnlinked.length} genuinely relevant published article(s) available to link — none linked yet${relevantUnlinked.map((l) => ` (#${l.id} "${l.title}")`).join('')}. Fix: add a link to one of them — the SEO repair appends a Related reading link to a genuinely relevant sibling, never an unrelated one.`
      : 'No genuinely relevant published article exists in this division to link to — no link will be faked to satisfy this check. The article stays blocked on internal-links until a relevant sibling is published.';
  } else {
    const parts = [];
    if (irrelevantLinked.length) parts.push(`linked article(s) not genuinely relevant (same division but no topical overlap — remove or replace the link): ${irrelevantLinked.map((l) => `#${l.id} "${l.title}"`).join(', ')}`);
    if (misleadingLinked.length) parts.push(`linked article(s) with misleading anchor text (the link text does not name the target): ${misleadingLinked.map((l) => `#${l.id} "${l.title}"`).join(', ')}`);
    if (relevantUnlinked.length) parts.push(`genuinely relevant article(s) available instead: ${relevantUnlinked.map((l) => `#${l.id} "${l.title}"`).join(', ')}`);
    internalDetail = `${parts.join(' ')} Fix: link a genuinely relevant same-division article with anchor text naming it — the SEO repair does exactly that and removes unrelated Related-reading lines.`;
  }
  push('internal-links', internalOk, 'needs-review', internalDetail);

  // 7. Image alt text when images exist.
  const imgs = [...body.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
  const mdImgs = [...body.matchAll(/!\[[^\]]*\]\([^)]+\)/g)].map((m) => m[0]);
  const missingAlt = imgs.filter((img) => !/alt=["'][^"']+["']/i.test(img)).length
    + mdImgs.filter((img) => /^!\[\s*\]/.test(img)).length;
  push('image-alt', missingAlt === 0, 'needs-review',
    imgs.length + mdImgs.length === 0
      ? 'No images in the body — nothing to check.'
      : `${imgs.length + mdImgs.length} image(s), ${missingAlt} missing alt text.`);

  // 8. Readability estimate (rough: average sentence length + word length).
  // A failure MUST carry an actionable Fix line (added 2026-11-20, Fix 6):
  // the old detail reported the numbers only, so the dashboard showed a
  // failing check with no guidance while passing checks showed "Fix:".
  const sentences = plainBody.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const words = plainBody.split(/\s+/).filter(Boolean);
  const avgSentence = sentences.length ? words.length / sentences.length : 0;
  const avgWord = words.length ? words.reduce((a, w) => a + w.length, 0) / words.length : 0;
  const readabilityOk = avgSentence >= 8 && avgSentence <= 25 && avgWord < 6.5;
  let readabilityDetail = `Estimate: ${words.length} words, ${sentences.length} sentences, avg sentence ${avgSentence.toFixed(1)} words, avg word ${avgWord.toFixed(1)} chars.`;
  if (!readabilityOk) {
    const fixes = [];
    if (avgSentence > 25) {
      fixes.push(`split long sentences — aim for 15-20 words per sentence (current average ${avgSentence.toFixed(1)} words)`);
    }
    if (avgSentence < 8) {
      fixes.push(`combine very short fragments into fuller sentences — aim for 8-25 words per sentence (current average ${avgSentence.toFixed(1)} words)`);
    }
    if (avgWord >= 6.5) {
      fixes.push(`use shorter, plainer words — aim for an average word under 6.5 characters (current ${avgWord.toFixed(1)} chars)`);
    }
    readabilityDetail += ` Fix: ${fixes.join('; ')}.`;
  }
  push('readability', readabilityOk, 'needs-review', readabilityDetail);

  // 9. Duplicate detection — CROSS-DRAFT (Workstream A, task B).
  // The old check compared only against PUBLISHED articles, so two
  // drafts with the same body could both pass and the second could
  // then publish a duplicate. This check now compares against every
  // other non-archived article, draft or published, by 5-word shingle
  // overlap (copied passages) and word-set Jaccard (same vocabulary,
  // reworded) — see checkCrossDraftDuplicates(). An unrelated article
  // scores near 0 on both and never blocks. The closest match is named
  // with its status so a draft collision reads differently from a
  // published duplicate. Thresholds unchanged from the old check:
  // overlap >= 50% (or Jaccard >= 90%) fails; >= 25% (or >= 70%) is
  // needs-review.
  const dup = await checkCrossDraftDuplicates(env, article);
  let dupOk = true;
  let dupLevel = 'needs-review';
  let dupDetail;
  if (!dup.closest) {
    // Keep the evaluator's exact phrase (gate.js duplicate-zero-overlap
    // treats "No other published articles to compare against" as 0%):
    // with no other article at all, there is also no other published one.
    dupDetail = 'No other published articles to compare against.';
  } else if (dup.isDuplicate) {
    dupOk = false;
    dupLevel = 'failed';
    dupDetail = `Duplicate content: highest 5-word shingle overlap ${Math.round(dup.closest.overlap * 100)}% (word Jaccard ${Math.round(dup.closest.jaccard * 100)}%) with ${dup.closest.status} article #${dup.closest.id}. Fix: rewrite the article in its own words from its own sources — do not publish a copy.`;
  } else if (dup.isNearDuplicate) {
    dupOk = false;
    dupDetail = `Near-duplicate content: highest 5-word shingle overlap ${Math.round(dup.closest.overlap * 100)}% (word Jaccard ${Math.round(dup.closest.jaccard * 100)}%) with ${dup.closest.status} article #${dup.closest.id}. Fix: rewrite the overlapping passages in the article's own words.`;
  } else {
    dupDetail = `Highest 5-word shingle overlap with another article: ${Math.round(dup.closest.overlap * 100)}% (word Jaccard ${Math.round(dup.closest.jaccard * 100)}%, ${dup.closest.status} article #${dup.closest.id}).`;
  }
  push('duplicate', dupOk, dupLevel, dupDetail);

  // 10. Broken-link check (live fetch, capped at 5 links).
  // Phase 3, Priority 4: confirmed-broken links fail the check;
  // UNVERIFIABLE links (406/403/429/5xx/timeout/unreachable) are
  // needs-review — never a pass, never a confirmed-broken fail.
  const externalLinks = extractExternalLinks(body);
  if (!externalLinks.length) {
    push('broken-links', true, 'needs-review', 'No external links in the body.');
  } else {
    const impl = fetchImpl || (env && env.__fetchImpl) || fetch;
    const linkResults = await checkBrokenLinks(externalLinks, impl);
    const broken = linkResults.filter((r) => r.classification === 'broken');
    const unverifiable = linkResults.filter((r) => r.classification === 'unverifiable');
    if (broken.length) {
      push('broken-links', false, 'failed',
        `${broken.length}/${linkResults.length} external link(s) confirmed broken: ${broken.map((b) => `${b.url} (${b.reason})`).join('; ')}${unverifiable.length ? ` ${unverifiable.length} link(s) could not be verified: ${unverifiable.map((u) => `${u.url} (${u.reason})`).join('; ')}` : ''}`);
    } else if (unverifiable.length) {
      push('broken-links', false, 'needs-review',
        `No link confirmed broken, but ${unverifiable.length}/${linkResults.length} external link(s) could not be verified: ${unverifiable.map((u) => `${u.url} (${u.reason})`).join('; ')} Fix: open the link in a browser to confirm it loads; a 406/403 from a publisher usually means the link is fine but the checker was blocked.`);
    } else {
      push('broken-links', true, 'needs-review', `All ${linkResults.length} external link(s) responded.`);
    }
  }

  // 11. Structured metadata presence.
  const metaOk = Boolean(article.title) && Boolean(article.excerpt) && Boolean(article.slug) && Boolean(article.division_id);
  push('structured-metadata', metaOk, 'needs-review',
    metaOk ? 'Title, excerpt, slug and division are set (per-article meta is JS-injected on the live site).' : 'Title, excerpt, slug or division is missing.');

  const failed = checks.filter((c) => !c.ok && c.level === 'failed');
  const needsReview = checks.filter((c) => !c.ok && c.level === 'needs-review');
  const verdict = failed.length ? 'failed' : (needsReview.length ? 'needs-review' : 'pass');
  // The cross-draft duplicate result rides along so callers (runSeo /
  // runSeoCheckOnly) can record the fingerprint decision without
  // re-scanning every article body a second time.
  return { checks, verdict, failed: failed.map((c) => c.name), needsReview: needsReview.map((c) => c.name), duplicate: dup };
}

/**
 * Repair inadequate SEO fields on a DRAFT article from its own real
 * content. (Added 2026-11-20 — the old code filled BLANK fields only,
 * so a 77-char meta description, 0 H2s and no internal link could
 * never pass the SEO checks.)
 * - meta description: regenerated from the body when missing or
 *   outside 120-160 chars (deriveSeoDescription — real text only).
 * - seo title: truncated at a word boundary when over 60 chars.
 * - headings: the first H3s are promoted to H2s when the body has
 *   fewer than 2 H2s but at least 2 H3s (formatting only — no content
 *   invented; a body with fewer than 2 headings total cannot be
 *   repaired and keeps failing with an actionable detail).
 * - internal link: a "Related reading" line is appended linking the
 *   NEWEST GENUINELY RELEVANT published sibling in the same division
 *   (same division AND topical title-keyword overlap — the
 *   auto-publish evaluator's rule, Workstream A 2026-11-21). When no
 *   relevant sibling exists, NO link is appended — never faked. A
 *   Related-reading line pointing at an unrelated sibling (the old
 *   repair's shape) is removed. Valid existing links are preserved.
 * Published articles are NEVER modified (report only). Every repair
 * stores an article_revisions row AFTER all mutations (W2 fix,
 * 2026-11-21 — the revision must reflect the final live body, not
 * the pre-edit body). Returns
 * { repaired, repairs: [human-readable strings],
 *   repairedFields: [field names changed, e.g. 'seo_description'],
 *   article (fresh row or the input) }.
 */
export async function repairSeoFields(env, article) {
  const repairs = [];
  const repairedFields = [];
  const isDraft = String(article.status || '') !== 'published';
  if (!isDraft) return { repaired: false, repairs, repairedFields, article };

  const body = String(article.body || '');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let newBody = body;
  let newSeoTitle = String(article.seo_title || '').trim();
  let newSeoDescription = String(article.seo_description || '').trim();

  // Meta description: regenerate from the body when missing or out of range.
  // Pass the RAW body (newlines intact) — deriveSeoDescription strips
  // heading lines, which only works before whitespace is collapsed.
  if (newSeoDescription.length < 120 || newSeoDescription.length > 160) {
    const derived = deriveSeoDescription(body);
    if (derived) {
      newSeoDescription = derived;
      repairedFields.push('seo_description');
      repairs.push(`meta-description regenerated from the article text (${derived.length} characters).`);
    }
  }
  // SEO title: fill a blank title from the article title; truncate an
  // over-long title at a word boundary (never lengthen a short one —
  // a short title cannot be fixed from nothing).
  if (!newSeoTitle && article.title) {
    newSeoTitle = String(article.title).slice(0, 60);
    repairedFields.push('seo_title');
    repairs.push('seo-title filled from the article title.');
  }
  // SEO title: truncate an over-long title at a word boundary (never
  // lengthen — a short title cannot be fixed from nothing).
  if (newSeoTitle.length > 60) {
    const cut = newSeoTitle.slice(0, 60);
    const lastSpace = cut.lastIndexOf(' ');
    newSeoTitle = lastSpace >= 30 ? cut.slice(0, lastSpace) : cut;
    repairedFields.push('seo_title');
    repairs.push(`seo-title truncated to ${newSeoTitle.length} characters.`);
  }
  // Headings: promote H3s to H2s when the body has <2 H2s but >=2 H3s.
  const h2Count = (newBody.match(/^##\s.+$/gm) || []).length + (newBody.match(/<h2[\s>]/gi) || []).length;
  const h3Count = (newBody.match(/^###\s.+$/gm) || []).length + (newBody.match(/<h3[\s>]/gi) || []).length;
  if (h2Count < 2 && h3Count >= 2) {
    let toPromote = 2 - h2Count;
    newBody = newBody.replace(/^###\s/gm, () => (toPromote-- > 0 ? '## ' : '### '));
    if (toPromote > 0) {
      // HTML headings: promote openings, then the same number of closings.
      let promotedHtml = 0;
      newBody = newBody.replace(/<h3([\s>])/gi, (m, g) => {
        if (toPromote > 0) { toPromote -= 1; promotedHtml += 1; return `<h2${g}`; }
        return m;
      });
      let closingLeft = promotedHtml;
      newBody = newBody.replace(/<\/h3>/gi, (m) => (closingLeft-- > 0 ? '</h2>' : m));
    }
    repairs.push(`promoted ${2 - h2Count} H3 heading(s) to H2 (formatting only — no content changed).`);
  }
  // Internal link: append a Related reading line to a GENUINELY
  // RELEVANT sibling — never the newest sibling regardless of topic
  // (Workstream A, task A). The old repair linked the newest
  // same-division sibling even when it was topically unrelated (live
  // #31 -> #22), creating the misleading link the gate then had to
  // reject. The target is now the newest RELEVANT sibling (same
  // division AND topical title-keyword overlap, the evaluator's rule).
  // When no relevant sibling exists, NO link is appended — never faked
  // to satisfy the SEO check; the article honestly stays blocked on
  // internal-links until a relevant sibling is published.
  // A Related-reading line the old repair appended to an UNRELATED
  // sibling is removed (only that exact appended shape is touched;
  // every other link in the body is preserved as-is).
  // Sibling window is 25 (see check 6): relevance must see the whole
  // division, not just the newest 5.
  const siblings = await d1All(env,
    'SELECT id, division_id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 25',
    [article.division_id, 'published', article.id]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, division_id: s.division_id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article?id=${s.id}`,
  }));
  const bodyLinks = (l) => newBody.includes(l.url) || newBody.includes(`id=${l.id}`) || newBody.includes(l.slug);
  const linkedSiblings = internalLinks.filter(bodyLinks);
  const irrelevantLinked = linkedSiblings.filter((l) => !isInternalLinkRelevant(article, l));
  // Remove unrelated Related-reading lines (the old repair's shape).
  const relatedReadingRe = /^Related reading: \[([^\]]*)\]\((https:\/\/fs-ai-5w5\.pages\.dev\/pages\/article\?id=(\d+))\)\s*$/gm;
  let removedIrrelevant = 0;
  newBody = newBody.replace(relatedReadingRe, (line, anchor, url, idStr) => {
    const target = internalLinks.find((l) => l.id === Number(idStr));
    const linked = target || { id: Number(idStr), title: '', division_id: article.division_id };
    const relevant = target ? isInternalLinkRelevant(article, target) : false;
    const anchorOk = target ? !isMisleadingAnchor(anchor, target.title) : false;
    if (!relevant || !anchorOk) {
      removedIrrelevant += 1;
      return '';
    }
    return line;
  });
  if (removedIrrelevant > 0) {
    newBody = newBody.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').trimEnd();
    repairs.push(`removed ${removedIrrelevant} unrelated/misleading Related reading link(s) (same-division but not genuinely relevant, or anchor text not naming the target).`);
  }
  const linksInternally = internalLinks.some(bodyLinks);
  let noRelevantLink = false;
  if (!linksInternally && internalLinks.length) {
    const target = internalLinks.find((l) => isInternalLinkRelevant(article, l));
    if (target) {
      newBody = `${newBody.replace(/\s+$/, '')}\n\nRelated reading: [${target.title}](${target.url})`;
      repairs.push(`added a Related reading link to genuinely relevant published article #${target.id} ("${target.title}").`);
    } else {
      // No relevant sibling exists: create NO link. The SEO check
      // stays honestly blocked on internal-links.
      noRelevantLink = true;
    }
  }

  if (!repairs.length) return { repaired: false, repairs, repairedFields, article, noRelevantLink };
  await d1Run(env, 'UPDATE articles SET body = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?',
    [newBody, newSeoTitle, newSeoDescription, nowIso(), article.id]);
  // SEO-REPAIR SNAPSHOT QUIRK (W2 fix, 2026-11-21): the old code wrote
  // the revision BEFORE the mutations, so after a repair appended the
  // Related-reading line the revision stored the OLD body (live #30:
  // revision 10 stored 4501 chars, live body 4615) — the revision
  // understated the live body, which made the body change look
  // untraceable and fed the fc-16 staleness finding. The snapshot is
  // now written AFTER all body mutations, so the revision reflects
  // the FINAL live body. TRADE-OFF, recorded deliberately: the
  // pre-edit body is no longer snapshotted by the SEO repair (there
  // is exactly one revision row per repair — an existing test pins
  // that count). The repair is additive/formatting-only (a regenerated
  // description, a truncated title, promoted headings, an appended
  // real link) and reproducible from the article's own content, so
  // the lost pre-edit snapshot costs less than a revision that lies
  // about the live body. If the coordinator wants BOTH rows, the
  // count assertion in tests/activation-repairs.test.js ("pre-edit
  // body stored as a revision first") must be updated first.
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
    [article.id, article.title, article.excerpt || null, newBody, article.status, 'seo-repair']);
  const fresh = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [article.id]);
  return { repaired: true, repairs, repairedFields, article: fresh || { ...article, body: newBody, seo_title: newSeoTitle, seo_description: newSeoDescription }, noRelevantLink };
}

export async function runSeo(task, env) {
  const payload = parsePayload(task);
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { outcome: 'failed', error: 'SEO pass needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [articleId]);
  if (!article) return { outcome: 'failed', error: `Article ${articleId} not found.` };

  // Repair first (drafts only — published articles are never modified),
  // then measure. The old code filled BLANK fields only; a short meta
  // description, H3-only headings or a missing internal link could
  // never pass. Repairs use the article's own real content only.
  const repair = await repairSeoFields(env, article);
  const fresh = repair.article;
  const body = String(fresh.body || '');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const seoTitle = String(fresh.seo_title || '');
  const seoDescription = String(fresh.seo_description || '');
  const markdownHeadings = (body.match(/^#{1,6}\s.+$/gm) || []).length;
  const htmlHeadings = (body.match(/<h[1-6][^>]*>/gi) || []).length;
  const headingCount = markdownHeadings + htmlHeadings;

  const suite = await runSeoCheckSuite(env, fresh);
  // Truncation gate (Workstream A, task D) + fingerprint record
  // (task B): a truncated body can score 11/11 on the suite yet be
  // incomplete, so the stored verdict is forced to 'failed' with a
  // 12th 'truncation' entry when the guard fires — the publish gate
  // reads the stored verdict, so a truncated article can never pass
  // it. The fingerprint row records the duplicate decision for audit.
  const gated = applyTruncationGateToSeoResult(suite, body);
  const dup = suite.duplicate || await checkCrossDraftDuplicates(env, fresh);
  const fingerprint = await storeArticleFingerprint(env, articleId, body, dup);
  // SEO result tied to the exact body checked (migration 023 — W2).
  const storedSeo = await insertSeoCheck(env, articleId, gated.verdict, gated.checks);
  const seoCheckId = storedSeo.seoCheckId;

  const siblings = await d1All(env,
    'SELECT id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 5',
    [article.division_id, 'published', articleId]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article?id=${s.id}`,
  }));

  return {
    outcome: 'done',
    action: 'optimize',
    articleId,
    title: fresh.title,
    division: fresh.division,
    seoTitle,
    seoDescription,
    headingCount,
    internalLinks,
    filled: repair.repairedFields,
    repairs: repair.repairs,
    verdict: gated.verdict,
    checks: gated.checks,
    seoCheckId,
    bodyHash: storedSeo.bodyHash,
    bodyLength: storedSeo.bodyLength,
    fingerprint: fingerprint.stored ? dup.fingerprint : null,
    duplicateDecision: fingerprint.decision,
    noRelevantLink: Boolean(repair.noRelevantLink),
    note: repair.repaired
      ? `SEO repaired from the article's own content: ${repair.repairs.join(' ')}`
      : (repair.noRelevantLink
        ? 'SEO fields already adequate — nothing repaired. No genuinely relevant published article exists in this division, so no Related reading link was created (never faked).'
        : 'SEO fields already adequate — nothing repaired, nothing overwritten.'),
  };
}

/**
 * CHECK-ONLY SEO run (added 2026-11-20, Fix 6). Runs the same 11-check
 * suite as runSeo but NEVER repairs: the article body, excerpt and SEO
 * fields are untouched and no article_revisions row is written. Only a
 * seo_checks row (the 11 results + verdict) is stored, so a protected
 * article may be check-only run — the check writes nothing to the
 * article itself. Returns the same shape as runSeo minus repairs, with
 * action 'check' so callers (and the owner) can distinguish Check from
 * Optimize in the response.
 */
export async function runSeoCheckOnly(env, article) {
  const suite = await runSeoCheckSuite(env, article);
  // Same truncation gate + fingerprint record as runSeo (check-only
  // still stores the verdict the gate reads, so a truncated body must
  // fail here too — the check writes nothing to the article itself).
  const gated = applyTruncationGateToSeoResult(suite, String(article.body || ''));
  const dup = suite.duplicate || await checkCrossDraftDuplicates(env, article);
  const fingerprint = await storeArticleFingerprint(env, article.id, String(article.body || ''), dup);
  // SEO result tied to the exact body checked (migration 023 — W2).
  const storedSeo = await insertSeoCheck(env, article.id, gated.verdict, gated.checks);
  const seoCheckId = storedSeo.seoCheckId;
  return {
    outcome: 'done',
    action: 'check',
    articleId: article.id,
    title: article.title,
    division: article.division,
    seoTitle: String(article.seo_title || ''),
    seoDescription: String(article.seo_description || ''),
    verdict: gated.verdict,
    checks: gated.checks,
    seoCheckId,
    bodyHash: storedSeo.bodyHash,
    bodyLength: storedSeo.bodyLength,
    fingerprint: fingerprint.stored ? dup.fingerprint : null,
    duplicateDecision: fingerprint.decision,
    note: 'Check-only: the article was not modified — no repair, no revision row.',
  };
}
