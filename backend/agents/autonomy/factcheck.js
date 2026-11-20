/**
 * FS AI — Autonomy: claim-level fact-checking + auto-correction.
 *
 * Genuine checking, not a rubber stamp. Claims are extracted from the
 * article body sentence by sentence, then each one is matched against
 * THE ARTICLE'S OWN recorded sources only (article_sources rows,
 * each resolved to its stored research_items row). Verdicts:
 * VERIFIED / INCORRECT / UNSUPPORTED / OUTDATED / CONFLICTING /
 * UNVERIFIABLE. A claim is VERIFIED only when real evidence text
 * supports it — a model's own unsupported answer is never evidence.
 * An LLM may judge claim-vs-evidence entailment ONLY when the evidence
 * text is supplied and cited (borderline matches); when no provider is
 * available the deterministic verdict stands.
 *
 * Correction (kind 'correct'): for each failed claim, find better
 * evidence FROM THE SAME article-specific pool, rewrite the statement
 * from that evidence (LLM) or remove the unsupported sentence when no
 * evidence exists; record original vs corrected text + the evidence
 * URL that supported the change, store the pre-edit body as a
 * revision, and re-check the modified claim. Max 3 attempts per claim;
 * a claim that still fails stays unpublished. Never auto-approves and
 * never sets fact_checked — the publish gate reads fact_checks and sets
 * fact_checked=1 only when it publishes.
 *
 * ISOLATION (fixed 2026-11-20): the evidence pool used to be ALL
 * research_items of the division (up to 200 rows), so article #27's
 * correction imported a motorcycle statistic from an unrelated
 * Electrek article. The pool is now article-specific only; an article
 * with no recorded sources gets an EMPTY pool, and correction then
 * marks claims for human review instead of reaching for unrelated
 * sources.
 *
 * CORRECTION QUALITY + CITATION-AWARE EXTRACTION (Fixes 2+3,
 * 2026-11-20): a rewrite must be one whole evidence-backed sentence
 * (cleanCandidate + isValidReplacementSentence); replaceSentence uses a
 * literal replacement and a citation-tolerant matcher; removal is
 * allowed only when it preserves context; and validateCorrectedBody
 * rejects any corrected body with fragments, splices, repeats,
 * incomplete paragraphs or evidence-ungrounded new sentences — on
 * rejection nothing is saved. extractClaims excludes citation/source
 * lines and bibliography sections but keeps factual claims that carry
 * a trailing citation URL (citation stripped, claim kept).
 */
import { d1All, d1First, d1Run, DISCLAIMER_DIVISIONS, isMissingColumnError } from '../../middleware/validation.js';
import { generateText } from '../../llm/index.js';
import { bodyHash, sha256Hex } from '../../utils/bodyHash.js';

export const MAX_CLAIMS_PER_ARTICLE = 20;
export const MAX_CORRECTION_ATTEMPTS = 3;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'has', 'have', 'can', 'will', 'you', 'your', 'when', 'what', 'how', 'why',
  'not', 'but', 'also', 'more', 'than', 'then', 'them', 'they', 'its', 'into',
  'about', 'after', 'before', 'over', 'under', 'between', 'while', 'which',
  'there', 'here', 'should', 'would', 'could', 'much', 'many', 'most', 'some',
]);

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

const ASSERTION_VERB_RE = /\b(is|are|was|were|has|have|can|will|uses|provides|offers|means|includes|requires|takes|costs|lasts|covers|helps|gives|makes)\b/i;
const CITATION_SECTION_RE = /^\s*(sources?|references?|related reading|further reading)\s*:/i;

/**
 * Citation-aware claim extraction (Fix 3, 2026-11-20).
 *
 * The old extractor split the body into sentences with no citation
 * awareness, so a source-reference line such as
 * "(https://…/sila-panasonic-battery-deal/) - **MIT Technology Review**
 * – "What a..." became a permanently CONFLICTING claim on article #28:
 * it can never verify, so the gate could never pass. These helpers
 * exclude citation material while preserving real factual statements:
 *
 * EXCLUDED (never a claim):
 *  - "Sources:" / "References:" / "Related reading:" / "Further
 *    reading:" section headers, and every line after one until the next
 *    markdown heading or the end of the body (these sections are
 *    terminal in generated bodies — content.js appends "Sources:" last
 *    and seo.js appends "Related reading:" last).
 *  - Standalone URLs, including parenthesised "(https://…)" lines.
 *  - Bibliography entries: bullet/numbered items that are a bare link,
 *    a bold source label + dash + URL/quote ("- **MIT Technology
 *    Review** – "What a..."), or a list item with no assertion verb
 *    outside quotes that looks like a source attribution (quoted title,
 *    publication-style name + comma/dash, "press release", "retrieved").
 *  - A line that is only one quoted fragment/title, with no attribution
 *    after the closing quote (a pulled headline, not a statement).
 *  - "Source:" lines.
 *
 * PRESERVED (still extracted, citation part stripped):
 *  - A sentence with a factual assertion + a trailing citation URL —
 *    the parenthesised URL or " - <url>" tail is stripped, the claim is
 *    kept. A bare mid-sentence URL is left verbatim (the claim still
 *    states a fact); the tolerant matcher in replaceSentence finds the
 *    claim in the body even after its citation part was stripped.
 *  - Real claims that merely sit near citations, and list items that
 *    DO assert something ("- **Fast charging** is available …" stays).
 */
/**
 * Strip a leading bracketed citation label ("[The Guardian] ",
 * "[BBC] ", "[Source] ") from a claim. The citation itself is NOT
 * lost: claim_checks rows keep evidence_url, so the source linkage
 * survives separately. (Phase 3, Priority 3 — the live #30 fact-check
 * carried the label into 5 claim texts.)
 */
export function stripCitationPrefix(text) {
  return String(text || '').replace(/^\s*\[[^\]\n]{1,60}\]\s*/, '');
}

/**
 * Stable identity for a claim across fact-check runs: citation
 * prefix stripped, lower-cased, whitespace collapsed. Two fact-check
 * runs generate different claim_check ids for the same claim text, so
 * identity must be the TEXT, never the id.
 * (Phase 3, Priority 5 — the duplicate-correction root cause.)
 *
 * claimKey() is the 200-char truncated form, kept for the correction
 * flow (article_corrections.claim_key, backfilled by migration 017)
 * and for the gate's open-correction grouping. It is LOSSY: two
 * different long claims can share a 200-char prefix. Verdict
 * carry-forward must therefore NEVER match on claimKey — it matches
 * on claimHash(), the full SHA-256 of the normalised claim text.
 */
function normaliseClaimText(text) {
  return stripCitationPrefix(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function claimKey(text) {
  return normaliseClaimText(text).slice(0, 200);
}

/** Full identity hash of a claim's normalised text (no truncation). */
export async function claimHash(text) {
  return sha256Hex(normaliseClaimText(text));
}

/**
 * Lines that are publishing/meta scaffolding, never factual claims:
 * the AI-DRAFT banner (ALL its lines — Phase 2's strip removed only
 * line 1, so #30's claims 1–2 were the banner's 2nd/3rd lines),
 * the SCAFFOLD marker, and bracketed editorial instructions such as
 * "[Write this section — no content yet.]".
 */
const BANNER_LINE_RE = /^\s*(AI-DRAFT\b.*|This draft was written by\b.*|It has NOT been fact-checked\b.*|SCAFFOLD\b.*)$/i;
const EDITORIAL_LINE_RE = /^\s*\[[^\]\n]*(write|todo|placeholder|no content yet)[^\]\n]*\]\s*$/i;

export function isBannerOrMetaLine(line) {
  return BANNER_LINE_RE.test(line) || EDITORIAL_LINE_RE.test(line);
}

function stripLeadingCitationPrefix(line) {
  // A line that opens with a parenthesised citation URL: drop the URL
  // (and a following dash) and keep whatever statement follows it.
  return String(line || '').replace(/^\s*\(https?:\/\/[^)]*\)\s*[–—-]?\s*/, '');
}

function isReferenceListItem(line) {
  const m = String(line || '').match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
  if (!m) return false;
  const rest = m[2].trim();
  if (/https?:\/\//.test(rest)) return true;
  if (/^\*\*[^*]+\*\*\s*[–—-]/.test(rest)) return true;
  // A list item with no assertion verb outside quotes that looks like a
  // source attribution is a reference, not a claim. (A real claim in a
  // list — "- **Fast charging** is available …" — has an assertion verb
  // and is kept.)
  const outsideQuotes = rest.replace(/"[^"]*"/g, '').replace(/“[^”]*”/g, '');
  if (ASSERTION_VERB_RE.test(outsideQuotes)) return false;
  if (/["“]/.test(rest)) return true;
  if (/\b(retrieved|accessed|available at|press release)\b/i.test(rest)) return true;
  if (/^([A-Z][\w&.'-]+(\s+[A-Z][\w&.'-]+){0,4})\s*[,–—-]/.test(rest)) return true;
  return false;
}

function isCitationOnlyLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (CITATION_SECTION_RE.test(s)) return true;
  if (/^source\s*:/i.test(s)) return true;
  if (/^[\(\[]?https?:\/\/\S+[\)\]]?$/.test(s)) return true;
  if (/^\*\*[^*]+\*\*\s*[–—-]\s*(https?:|\(https?:|["“'])/.test(s)) return true;
  if (isReferenceListItem(s)) return true;
  // One standalone quoted fragment/title, nothing after the closing
  // quote (a pulled headline). A quoted statement WITH attribution
  // ("…," said the chief executive.) has text after the closing quote
  // and is kept.
  if (/^["“][^"”]*["”][.!?]?\s*$/.test(s)) return true;
  return false;
}

/** Remove citation-only lines from a body (shared by extractClaims and
 *  the corrected-body validator so both agree on what is a citation). */
function stripCitationLines(body) {
  const lines = String(body || '').split('\n');
  const kept = [];
  let inCitationSection = false;
  for (const line of lines) {
    // Publishing/meta scaffolding is never a claim (Phase 3, P3).
    if (isBannerOrMetaLine(line)) continue;
    if (/^\s*#{1,6}\s/.test(line)) { inCitationSection = false; kept.push(line); continue; }
    if (CITATION_SECTION_RE.test(line.trim())) { inCitationSection = true; continue; }
    if (inCitationSection) continue;
    const stripped = stripLeadingCitationPrefix(line);
    if (isCitationOnlyLine(stripped)) continue;
    kept.push(stripped);
  }
  return kept.join('\n');
}

/** Split a body into checkable claim sentences (headings + the AI-DRAFT marker excluded). */
export function extractClaims(body, { maxClaims = MAX_CLAIMS_PER_ARTICLE } = {}) {
  const text = stripCitationLines(String(body || ''))
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/\n+/g, ' ')
    // Strip citation material from inside sentences, keeping the claim:
    // a parenthesised URL, or a trailing " - <url>" tail (a trailing
    // period after the URL is preserved so the sentence still ends),
    // or a citation tail glued to the previous sentence ("…States. -
    // **MIT Technology Review** – "What a…""). A bold-label tail in the
    // MIDDLE of a sentence is left verbatim (it stays findable for
    // correction); only tails after a sentence boundary are stripped.
    .replace(/\s*\(https?:\/\/[^)]*\)/g, '')
    .replace(/\s*[–—-]\s*https?:\/\/\S+/g, (m) => (m.endsWith('.') ? '.' : ''))
    .replace(/([.!?]\s+)[–—-]\s*\*\*[^*]+\*\*\s*[–—-]\s*["“][^"”]*["”][.!?]?\s*/g, '$1');
  const raw = text.split(/(?<=[.!?])\s+/);
  const claims = [];
  for (const sentence of raw) {
    // Strip a leading "[The Guardian]"-style citation label BEFORE
    // the length/assertion checks (Phase 3, P3): the label is not
    // part of the claim, and the citation survives via evidence_url.
    const s = stripCitationPrefix(sentence.trim().replace(/\s+/g, ' '));
    if (s.length < 40 || s.length > 500) continue;
    if (!/[a-zA-Z]/.test(s)) continue;
    const hasNumber = /\d/.test(s);
    const hasAssertion = ASSERTION_VERB_RE.test(s);
    const words = s.split(/\s+/);
    const hasEntity = words.slice(1).some((w) => /^[A-Z][a-z]{2,}/.test(w));
    if (!hasNumber && !hasAssertion && !hasEntity) continue;
    if (!claims.includes(s)) claims.push(s);
    if (claims.length >= maxClaims) break;
  }
  return claims;
}

export function claimKeywords(claim) {
  return String(claim).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function claimNumbers(claim) {
  const nums = String(claim).match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return nums.map((n) => n.replace(/,/g, ''));
}

function bestQuote(text, keywords) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+/);
  let best = '';
  let bestScore = -1;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    const score = keywords.filter((k) => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = s.trim(); }
  }
  return best.slice(0, 300);
}

/**
 * Find the best supporting evidence for a claim in the evidence pool.
 * Pool items: { url, text, title, isOutdated }.
 * Returns null, or { url, quote, score, matchedKeywords, numbersMatch, conflicting, isOutdated }.
 * `numbersMatch` is false when the claim states a number the evidence does not contain.
 */
export function findEvidence(claim, evidencePool, { minScore = 0.3 } = {}) {
  const keywords = claimKeywords(claim);
  const numbers = claimNumbers(claim);
  if (!keywords.length && !numbers.length) return null;
  let best = null;
  for (const item of evidencePool || []) {
    const text = String(item.text || '');
    const lower = text.toLowerCase();
    const matched = keywords.filter((k) => lower.includes(k));
    const score = keywords.length ? matched.length / keywords.length : 0;
    if (score < minScore) continue;
    // Numbers must match as whole numbers, not substrings: "20" must not
    // match "2023". (Fixed 2026-11-19 — substring matching wrongly
    // VERIFIED a claim stating 20 million against evidence stating 2023.)
    const numbersMatch = numbers.length ? numbers.every((n) => {
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(lower);
    }) : true;
    // A different number in the same matched context = conflicting, not supporting.
    const conflicting = numbers.length && !numbersMatch && matched.length >= 2;
    const candidate = {
      url: item.url || null, quote: bestQuote(text, keywords) || String(item.title || '').slice(0, 300),
      score, matchedKeywords: matched, numbersMatch, conflicting,
      isOutdated: Boolean(item.isOutdated),
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

function isTimeSensitive(claim) {
  return /\b(20\d\d|currently|now|latest|new|today|this year)\b/i.test(claim);
}

/** Deterministic verdict from a matched evidence item (or its absence). */
export function judgeClaimDeterministic(claim, evidence, evidencePoolEmpty) {
  if (!evidence) {
    return evidencePoolEmpty
      ? { verdict: 'UNVERIFIABLE', explanation: 'No source material is recorded for this article, so the claim cannot be checked.' }
      : { verdict: 'UNSUPPORTED', explanation: 'No recorded source for this article supports this claim.' };
  }
  if (evidence.conflicting) {
    return { verdict: 'CONFLICTING', explanation: `Evidence mentions the topic but states a different number than the claim (${evidence.quote}).` };
  }
  if (evidence.score >= 0.5 && evidence.numbersMatch) {
    if (evidence.isOutdated && isTimeSensitive(claim)) {
      return { verdict: 'OUTDATED', explanation: 'The only supporting evidence is over a year old and the claim is time-sensitive.' };
    }
    return { verdict: 'VERIFIED', explanation: `Supported by fetched source material (${evidence.url || 'source on record'}).` };
  }
  return { verdict: 'UNSUPPORTED', explanation: 'Evidence mentions the topic but does not support the claim as written.' };
}

/** LLM entailment judge — only ever called with evidence text supplied and cited. Returns null when no provider is available. */
async function llmJudge(env, claim, evidence) {
  const res = await generateText({
    prompt: `Evidence: "${evidence.quote}" (source: ${evidence.url || 'unknown'})\nClaim: "${claim}"\nDoes the evidence support the claim as written? Answer with exactly one word on the first line: SUPPORTED or NOT_SUPPORTED. Then one sentence explaining why.`,
    system: 'You judge whether supplied evidence supports a factual claim. Never use outside knowledge — only the evidence text given.',
    maxTokens: 200,
    purpose: 'fact-check-judge',
  }, env);
  if (!res || !res.ok) return null;
  const lines = String(res.text || '').trim().split('\n');
  const first = (lines[0] || '').trim().toUpperCase();
  const supported = first.startsWith('SUPPORTED') && !first.startsWith('NOT_SUPPORTED');
  return { supported, reasoning: String(res.text || '').slice(0, 300) };
}

/**
 * Load the evidence pool for ONE article only: its own recorded
 * sources (article_sources), each resolved to the stored research_items
 * row it came from (by research_item_id, else by source_url).
 * (Fixed 2026-11-20 — the old pool was ALL research_items of the
 * division, up to 200 rows, so article #27's correction imported a
 * motorcycle statistic from an unrelated article. Unrelated evidence
 * can no longer enter a fact-check or a correction.)
 * Pool items: { url, title, text, isOutdated, researchItemId }. A
 * recorded source with no stored research row contributes its title
 * only (weak evidence, still article-specific). An article with no
 * sources at all gets an EMPTY pool: its claims are UNVERIFIABLE and
 * correction must mark them for review instead of borrowing evidence.
 */
async function loadEvidence(env, article) {
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC', [article.id]) || [];
  const pool = [];
  const seenItemIds = new Set();
  for (const s of sources) {
    let items = [];
    if (s.research_item_id) {
      const row = await d1First(env,
        'SELECT id, source_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated FROM research_items WHERE id = ? LIMIT 1',
        [s.research_item_id]);
      if (row) items = [row];
    }
    if (!items.length && s.source_url) {
      items = await d1All(env,
        'SELECT id, source_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated FROM research_items WHERE url = ? ORDER BY fetched_at DESC',
        [s.source_url]) || [];
    }
    for (const it of items) {
      if (seenItemIds.has(it.id)) continue;
      seenItemIds.add(it.id);
      pool.push({
        url: it.url, title: it.title, isOutdated: it.is_outdated === 1,
        text: [it.title, it.summary, it.evidence_text].filter(Boolean).join(' '),
        researchItemId: it.id, fetchedAt: it.fetched_at || null,
      });
    }
    if (!items.length) {
      // Recorded source, no stored research row: its title is the only
      // evidence text, and it is still article-specific.
      pool.push({ url: s.source_url || null, title: s.source_title || '', text: s.source_title || '', isOutdated: false, researchItemId: null, fetchedAt: null });
    }
  }
  return pool;
}

function structuralChecks(article, sources) {
  const checks = [];
  const flags = [];
  const body = String(article.body || '');
  const bodyLength = body.length;
  checks.push({ name: 'body-length', ok: bodyLength >= 500, detail: `Body is ${bodyLength} characters.` });
  if (bodyLength < 500) flags.push('Body is under 500 characters — too short to verify properly.');
  if (/SCAFFOLD — full draft needed/.test(body)) {
    flags.push('Article is a scaffold — no full body exists to fact-check.');
    checks.push({ name: 'scaffold', ok: false, detail: 'Body is marked SCAFFOLD — full draft needed.' });
  } else {
    checks.push({ name: 'scaffold', ok: true, detail: 'Not a scaffold.' });
  }
  checks.push({ name: 'sources-present', ok: sources.length > 0, detail: `${sources.length} source(s) recorded.` });
  if (sources.length === 0) flags.push('No sources recorded for this article.');
  const needsDisclaimer = DISCLAIMER_DIVISIONS.has(article.division);
  checks.push({
    name: 'disclaimer',
    ok: !needsDisclaimer || /General information only/i.test(body),
    detail: needsDisclaimer
      ? 'Health/finance division — general-information disclaimer required.'
      : 'No disclaimer required for this division.',
  });
  if (needsDisclaimer && !/General information only/i.test(body)) {
    flags.push(`Division ${article.division} requires the general-information disclaimer in the body.`);
  }
  const numbers = body.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent|dollars?|USD|tk|taka|years?|months?|days?)?\b/gi) || [];
  const numbersWithNoSource = sources.length === 0 ? numbers.length : 0;
  checks.push({
    name: 'numbers-sourced',
    ok: numbersWithNoSource === 0,
    detail: numbers.length
      ? `${numbers.length} number-like claim(s) found; ${numbersWithNoSource} without any source on record.`
      : 'No number-like claims found in the body.',
  });
  if (numbersWithNoSource > 0) {
    flags.push(`${numbersWithNoSource} number-like claim(s) in the body with no source recorded — each needs a cited source.`);
  }
  return { checks, flags };
}

/**
 * Fact-check one article against its OWN recorded sources only.
 *
 * Phase 3, Priority 6 (verdict consistency): every run records
 * check_kind ('initial' | 'recheck' | 'correction-recheck'), the
 * evidence signature, and the body hash (migration 019). A claim is
 * CARRIED FORWARD with its previous verdict ONLY when its FULL text
 * hash matches a claim in the previous check AND the evidence
 * signature is unchanged (the signature now covers evidence CONTENT,
 * not just ids + fetch times). The LLM entailment judge is
 * non-deterministic, and re-running it on unchanged text against
 * unchanged evidence can only flip a verdict for no reason (live
 * #30: claim 8 flipped UNSUPPORTED → VERIFIED with no correction
 * saved). A claim whose text changed, or whose evidence changed, is
 * evaluated fresh. previous_verdict is stored on every claim_checks
 * row so any flip is traceable. A correction attempt alone therefore
 * never flips a verdict: the corrected claim is new text and is
 * re-evaluated; unchanged claims keep theirs.
 *
 * The body hash is a SEPARATE guard, not a carry-forward condition:
 * it records which body a run judged, and the publish gate rejects
 * any run whose stored hash differs from the article's current body
 * (or is missing) as stale. Per-claim carry-forward is deliberately
 * NOT gated on the body hash: editing one claim must not force the
 * non-deterministic judge to re-run on the article's other,
 * unchanged claims (that would reintroduce the #30 flip). A changed
 * claim can never inherit an old verdict — its full text hash
 * differs — and a removed claim leaves no row in the new run, so
 * the active claim set is always the latest run's claims.
 * options: { checkKind }.
 */
export async function checkArticle(env, article, options = {}) {
  const checkKind = options.checkKind || 'initial';
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC', [article.id]) || [];
  const { checks, flags } = structuralChecks(article, sources);
  const claims = extractClaims(article.body);
  const pool = await loadEvidence(env, article);
  const poolEmpty = pool.length === 0;
  // Body hash: the identity of the body this run judges. A later edit
  // must invalidate this run — an old verdict must never make a new
  // or changed claim appear verified.
  const currentBodyHash = await bodyHash(article.body);
  // Evidence signature: which stored research rows (and which fetch
  // of each) this run judged against, AND WHAT EACH ROW SAID. The
  // content hash is load-bearing: editing an evidence item's text
  // (same id, same fetched_at) changes the signature and forces fresh
  // evaluation — a verdict must not survive its own evidence changing.
  const evidenceSignature = (await Promise.all(pool.map(async (p) => {
    const contentHash = (await sha256Hex(String(p.text || ''))).slice(0, 16);
    return `${p.researchItemId || 0}:${p.fetchedAt || ''}:${contentHash}`;
  }))).sort().join('|');
  // Previous check, for carry-forward + previous_verdict (P6).
  const previousCheck = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [article.id]);
  let previousByKey = new Map();
  let previousSignature = null;
  if (previousCheck) {
    previousSignature = previousCheck.evidence_signature || null;
    try {
      const prevClaims = await d1All(env,
        'SELECT claim_text, verdict, evidence_url, evidence_quote, explanation FROM claim_checks WHERE fact_check_id = ? ORDER BY id ASC',
        [previousCheck.id]) || [];
      for (const pc of prevClaims) {
        // Full-hash identity (claimHash), never the truncated claimKey:
        // two different long claims can share a 200-char prefix, and
        // a shared prefix must never carry a verdict across.
        previousByKey.set(await claimHash(pc.claim_text), {
          verdict: pc.verdict, explanation: pc.explanation || '',
          evidenceUrl: pc.evidence_url || null, evidenceQuote: pc.evidence_quote || null,
        });
      }
    } catch { previousByKey = new Map(); }
  }
  // Carry-forward is legitimate ONLY when the previous run recorded
  // an evidence signature AND it matches this run's (rows written
  // before migration 018 have no signature, so they never carry
  // forward). The body hash is deliberately NOT a condition here:
  // it guards the publish gate (a run is only valid for the body it
  // judged), while per-claim carry-forward is guarded by the claim's
  // full text hash + the evidence-content signature. Editing one
  // claim must not force the non-deterministic judge to re-run on
  // the article's other, unchanged claims.
  const signatureUnchanged = previousCheck !== null && previousSignature !== null && previousSignature === evidenceSignature;
  const claimResults = [];
  for (const claim of claims) {
    const key = await claimHash(claim);
    const prev = previousByKey.get(key) || null;
    const previousVerdict = prev ? prev.verdict : null;
    // Same claim text (full hash), same evidence, not changed by
    // the caller: keep the previous verdict. No LLM judge call, no
    // flip, no Neurons. (The body hash is deliberately NOT a
    // condition here — it guards the publish gate, not carry-forward;
    // see the signatureUnchanged comment above.)
    if (prev && signatureUnchanged) {
      claimResults.push({
        claim, verdict: prev.verdict, previousVerdict,
        evidenceUrl: prev.evidenceUrl, evidenceQuote: prev.evidenceQuote,
        explanation: `${prev.explanation} (Unchanged — verdict carried forward: same claim text, same evidence.)`,
        carriedForward: true,
      });
      continue;
    }
    const evidence = findEvidence(claim, pool);
    let judged = judgeClaimDeterministic(claim, evidence, poolEmpty);
    // Borderline match (some keywords, not enough to verify): ask the LLM
    // judge with the evidence text supplied. A SUPPORTED answer upgrades
    // to VERIFIED; anything else keeps the deterministic verdict.
    if (evidence && evidence.score >= 0.3 && evidence.score < 0.5 && !evidence.conflicting) {
      const llm = await llmJudge(env, claim, evidence);
      if (llm && llm.supported) {
        judged = { verdict: 'VERIFIED', explanation: `LLM entailment judge: evidence supports the claim. ${llm.reasoning}` };
      } else if (llm) {
        judged.explanation += ` LLM entailment judge: NOT_SUPPORTED. ${llm.reasoning}`;
      }
    }
    claimResults.push({
      claim, verdict: judged.verdict, previousVerdict,
      evidenceUrl: evidence ? evidence.url : null,
      evidenceQuote: evidence ? evidence.quote : null, explanation: judged.explanation,
      carriedForward: false,
    });
  }

  const verified = claimResults.filter((c) => c.verdict === 'VERIFIED').length;
  const failed = claimResults.filter((c) => ['INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE'].includes(c.verdict)).length;
  let verdict = 'pass';
  if (/SCAFFOLD — full draft needed/.test(String(article.body || ''))) verdict = 'failed';
  else if (claims.length === 0) { verdict = 'needs-review'; flags.push('No checkable claims could be extracted from the body.'); }
  else if (claimResults.some((c) => c.verdict === 'INCORRECT')) verdict = 'failed';
  else if (failed > 0 || flags.length > 0) verdict = 'needs-review';

  // fact_checks gains check_kind + evidence_signature (migration 018)
  // and body_hash (migration 019); fall back down the column lists
  // when a migration is not yet applied live (the parent applies
  // migrations after deploy). A run that cannot record its body hash
  // still writes its verdicts — but the gate treats a hash-less row
  // as stale, so it can never pass anything.
  let factCheckId = null;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, check_kind, evidence_signature, body_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [article.id, verdict, claimResults.length, verified, failed, checkKind, evidenceSignature, currentBodyHash]);
    factCheckId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    try {
      const inserted = await d1Run(env,
        'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, check_kind, evidence_signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [article.id, verdict, claimResults.length, verified, failed, checkKind, evidenceSignature]);
      factCheckId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
    } catch (e2) {
      if (!isMissingColumnError(e2)) throw e2;
      const inserted = await d1Run(env,
        'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (?, ?, ?, ?, ?)',
        [article.id, verdict, claimResults.length, verified, failed]);
      factCheckId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
    }
  }
  if (factCheckId) {
    for (const c of claimResults) {
      try {
        await d1Run(env,
          'INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation, previous_verdict) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [factCheckId, c.claim, c.verdict, c.evidenceUrl, c.evidenceQuote, c.explanation, c.previousVerdict]);
      } catch (e) {
        if (!isMissingColumnError(e)) throw e;
        await d1Run(env,
          'INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, ?, ?, ?, ?, ?)',
          [factCheckId, c.claim, c.verdict, c.evidenceUrl, c.evidenceQuote, c.explanation]);
      }
    }
  }
  return {
    factCheckId, articleId: article.id, title: article.title, division: article.division,
    status: article.status, verdict, claims: claimResults,
    claimsTotal: claimResults.length, claimsVerified: verified, claimsFailed: failed,
    checks, flags, checkKind, bodyHash: currentBodyHash,
    carriedForward: claimResults.filter((c) => c.carriedForward).length,
  };
}

/**
 * Build a tolerant search pattern for a claim sentence in the body.
 * A claim extracted by extractClaims may have had its citation part
 * stripped (a parenthesised URL, or a " - <url>" tail, or a leading
 * "[The Guardian]"-style label — Phase 3, Priority 3), so the body
 * can hold citation material where the claim has only whitespace, or
 * just before its final punctuation. The pattern allows exactly that
 * — an optional parenthesised URL or dash-URL — at each whitespace
 * run and before the closing punctuation, plus an optional bracketed
 * citation label before the sentence, and nothing else.
 */
function claimPattern(sentence) {
  const escaped = String(sentence).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const citationInsert = '(?:\\([^)]*https?:\\/\\/[^)]*\\)|[–—-]\\s*https?:\\/\\/\\S+)';
  let pattern = `(?:\\[[^\\]\\n]{1,60}\\]\\s*)?` + escaped.replace(/\s+/g, `\\s+(?:${citationInsert}\\s+)?`);
  pattern = pattern.replace(/\\([.!?])$/, `(?:\\s*${citationInsert})?\\$1`);
  return new RegExp(pattern);
}

function replaceSentence(body, sentence, replacement) {
  const text = String(body || '');
  const idx = text.indexOf(sentence);
  if (idx >= 0) return text.slice(0, idx) + replacement + text.slice(idx + sentence.length);
  const re = claimPattern(sentence);
  if (!re.test(text)) return null;
  // Replacement via a function: a literal `$&` / `$'` / "$`" in the
  // replacement would otherwise be interpreted by String.replace and
  // splice matched body text into the sentence (a second splice vector
  // next to the unvalidated LLM rewrite). A function return is literal.
  return text.replace(re, () => replacement);
}

/**
 * Correction quality (Fix 2, 2026-11-20).
 *
 * SPLICE CAUSE (article #28, live): the correction loop accepted any
 * LLM reply that was long enough, different from the original and free
 * of invented numbers, and inserted it VERBATIM with replaceSentence.
 * Nothing checked that the reply was a single complete sentence, so a
 * reply that ran a fragment and a second sentence together —
 * "a potential key to smaller The deal—worth more than a billion
 * dollars—aims to supply silicon-carbon anode material..." — was saved
 * as one "sentence". A second vector: replaceSentence passed the
 * candidate to String.replace as a raw replacement string, so any
 * `$&` / `$'` / "$`" in it would splice matched body text into the
 * sentence. Both are fixed here, and validateCorrectedBody below is
 * the backstop that rejects any corrected body that still garbles.
 */

function normaliseText(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function splitSentences(text) {
  return String(text || '')
    .replace(/^AI-DRAFT[^\n]*\n?/im, '')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** A sentence-start capitalised mid-sentence after a lowercase word,
 *  followed by a lowercase word: "…smaller The deal…" — the #28 splice
 *  signature. Genuine publication names ("according to The Verge") do
 *  NOT match: the word after "The" is capitalised there. */
const SPLICE_MARKER_RE = /\b[a-z]{2,}\s+(The|This|That|These|Those|It|They|We|He|She)\s+[a-z]/;
const DOUBLED_WORD_RE = /\b(the|a|an|and|to|of|is|was|were|in|on|for|with)\s+\1\b/i;

function startsWithLowercaseFragment(s) {
  const text = String(s || '').trim();
  if (/^["“'(\[]?\d/.test(text)) return false; // "14 million …" starts with a number, not a fragment
  if (/^(e\.g\.|i\.e\.)/i.test(text)) return false;
  const m = text.match(/[A-Za-z]/);
  return Boolean(m) && m[0] !== m[0].toUpperCase();
}

/** Strip an LLM reply down to its first complete sentence. A reply
 *  that runs two sentences (or a fragment + a sentence) together is
 *  never inserted whole — only its first sentence is even considered,
 *  and isValidReplacementSentence below must still accept it. A
 *  leading meta sentence ("Here is the corrected sentence.") is a
 *  reply wrapper, not the correction: it is dropped and the next
 *  sentence is used (Phase 3, Priority 2 — the old code took only
 *  parts[0], so a meta opener would be spliced in as the correction
 *  itself). */
function cleanCandidate(raw) {
  let text = String(raw || '').trim().replace(/\s+/g, ' ');
  text = text.replace(/^(corrected sentence|correction|rewritten sentence)\s*:\s*/i, '');
  text = text.replace(/^here is (the )?(corrected|rewritten)[^:]*:\s*/i, '');
  text = text.replace(/^["“']|["”']$/g, '').trim();
  const parts = text.split(/(?<=[.!?])\s+/);
  let first = (parts[0] || '').trim();
  if (/^(here is|here'?s) (the )?(corrected|rewritten|updated|fixed|new)\b/i.test(first) && parts.length > 1) {
    first = (parts[1] || '').trim();
  }
  return first.replace(/["”']$/, '').trim();
}

/** A reply that ends without terminal punctuation is incomplete:
 *  the model was cut off (token budget) or never finished the
 *  sentence. Such a reply must never be saved as a correction —
 *  the caller retries once with a shorter evidence quote, then
 *  marks the claim for human review. (Phase 3, Priority 2.) */
export function isTruncatedReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  return !/[.!?]["”')]?$/.test(text);
}

/** A rewrite is usable only as ONE whole evidence-backed sentence:
 *  single complete sentence, capitalised start, terminal punctuation,
 *  no splice marker, no raw URL, no first-person refusal/meta reply,
 *  no doubled word. Numbers are checked separately against the
 *  evidence quote by the caller (unchanged rule). */
function isValidReplacementSentence(candidate, original) {
  if (!candidate || candidate === original) return false;
  if (candidate.length < 20 || candidate.length > 500) return false;
  if (startsWithLowercaseFragment(candidate)) return false;
  if (!/[.!?]["”')]?$/.test(candidate)) return false;
  if (SPLICE_MARKER_RE.test(candidate)) return false;
  if (/[a-z][.!?][A-Z]/.test(candidate)) return false;
  if (/https?:\/\//.test(candidate)) return false;
  if (/\b(as an ai|i (do not|don't|can ?not|cannot) (know|verify|confirm)|i'?m sorry|unable to verify)\b/i.test(candidate)) return false;
  // A meta reply about the correction ("Here is the corrected
  // sentence.") is not the correction itself (Phase 3, Priority 2).
  if (/^(here is|here'?s) (the )?(corrected|rewritten|updated|fixed|new)\b/i.test(candidate)) return false;
  if (/^(the )?(corrected|rewritten) (sentence|claim|statement) (is|:)/i.test(candidate)) return false;
  if (DOUBLED_WORD_RE.test(candidate)) return false;
  if (!/[a-zA-Z]/.test(candidate)) return false;
  return true;
}

const BACK_REFERENCE_START_RE = /^(this|that|these|those|it|they|such|the above)\b/i;

/**
 * Removal preserves context only when no sentence left in the same
 * paragraph opens with a back-reference ("This deal …") that would
 * dangle without the removed sentence, and the removed sentence does
 * not hand off to what follows ("as follows", a trailing colon). A
 * whole paragraph disappearing is fine (blank lines are harmless);
 * cross-paragraph dangling references are NOT detected — see the
 * report's limits. When this returns false the claim is skipped for
 * human review instead of being removed.
 */
function removalPreservesContext(body, sentence) {
  const target = normaliseText(sentence);
  if (/\b(as follows|see below|listed below|following)\s*:?\s*$/.test(target) || /:\s*$/.test(target)) return false;
  const pattern = claimPattern(sentence);
  const paragraphs = String(body || '').split(/\n\s*\n/);
  for (const para of paragraphs) {
    const norm = normaliseText(para);
    if (!pattern.test(norm)) continue;
    const rest = norm.replace(pattern, '').replace(/\s+/g, ' ').trim();
    if (!rest) return true;
    const restSentences = rest.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (restSentences.some((s) => BACK_REFERENCE_START_RE.test(s))) return false;
    return true;
  }
  return false;
}

function wordSet(s) {
  return new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function hasWholeWord(text, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(String(text || '').toLowerCase());
}

/** Structural issues of one sentence: { type, reason }.
 *  Types: fragment | splice | missing-space | doubled-word | run-on |
 *  raw-url. */
function sentenceIssues(sentence) {
  const issues = [];
  const s = String(sentence || '').trim();
  if (!s) return issues;
  const excerpt = s.slice(0, 80);
  if (startsWithLowercaseFragment(s)) {
    issues.push({ type: 'fragment', reason: `broken sentence fragment (starts with a lowercase letter): "${excerpt}"` });
  }
  if (SPLICE_MARKER_RE.test(s)) {
    issues.push({ type: 'splice', reason: `spliced sentence (a second sentence-start appears mid-sentence): "${excerpt}"` });
  }
  if (/[a-z][.!?][A-Z]/.test(s)) {
    issues.push({ type: 'missing-space', reason: `fragment (missing space after a sentence boundary): "${excerpt}"` });
  }
  if (DOUBLED_WORD_RE.test(s)) {
    issues.push({ type: 'doubled-word', reason: `repeated word in sentence: "${excerpt}"` });
  }
  if (s.length > 500) {
    issues.push({ type: 'run-on', reason: `run-on sentence over 500 characters: "${excerpt}"` });
  }
  if (/https?:\/\//.test(s)) {
    issues.push({ type: 'raw-url', reason: `sentence contains a raw URL (citation not stripped): "${excerpt}"` });
  }
  return issues;
}

/** Repeated / near-duplicate sentences in a sentence list. Short stock
 *  sentences (< 6 words) may legitimately repeat and are ignored. */
function duplicateIssues(sentences) {
  const issues = [];
  const items = sentences.map((s) => ({
    s, norm: normaliseText(s).toLowerCase(), words: wordSet(s),
    wordCount: String(s).split(/\s+/).filter(Boolean).length,
  }));
  const seen = new Map();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.wordCount >= 6 && seen.has(item.norm)) {
      issues.push({ key: `dup:${item.norm}`, reason: `repeated sentence: "${item.s.slice(0, 80)}"` });
      continue;
    }
    seen.set(item.norm, i);
    if (item.wordCount < 8) continue;
    for (let j = 0; j < i; j++) {
      if (items[j].wordCount < 8) continue;
      if (jaccardSimilarity(items[j].words, item.words) >= 0.9) {
        const key = `dup:${[items[j].norm, item.norm].sort().join('|')}`;
        issues.push({ key, reason: `near-duplicate sentences: "${items[j].s.slice(0, 60)}" / "${item.s.slice(0, 60)}"` });
        break;
      }
    }
  }
  return issues;
}

/** Paragraphs (citation lines and headings removed) that do not end
 *  with terminal punctuation — an incomplete paragraph left behind by
 *  a removal or a truncated rewrite. */
function paragraphIssues(body) {
  const issues = [];
  const cleaned = stripCitationLines(String(body || ''));
  for (const para of cleaned.split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim())
      .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^AI-DRAFT\b/.test(l));
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/:\s*$/.test(text)) continue; // list intro, e.g. "Key points:"
    if (/^!?\[.*?\]\(https?:\/\/[^)]*\)$/.test(text)) continue; // link-only paragraph
    if (/[.!?]["”')\]]?\s*$/.test(text)) continue;
    issues.push({
      key: `para:${normaliseText(text).toLowerCase().slice(0, 120)}`,
      reason: `incomplete paragraph (no closing sentence punctuation): "${text.slice(0, 80)}"`,
    });
  }
  return issues;
}

function balanceIssues(body) {
  const issues = [];
  const text = String(body || '');
  const straightQuotes = (text.match(/"/g) || []).length;
  const openQuotes = (text.match(/“/g) || []).length;
  const closeQuotes = (text.match(/”/g) || []).length;
  if (straightQuotes % 2 !== 0 || openQuotes !== closeQuotes) {
    issues.push({ key: 'quotes', reason: 'unbalanced quotation marks in the corrected body' });
  }
  const openParens = (text.match(/\(/g) || []).length;
  const closeParens = (text.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    issues.push({ key: 'parens', reason: 'unbalanced parentheses in the corrected body' });
  }
  return issues;
}

/**
 * Evidence-grounding issues for sentences the correction ADDED (new
 * vs the original body): numbers and named entities must come from the
 * article's own evidence pool (or, for entities, from the original
 * body — a rewrite may reuse the article's own names), and a sentence
 * sharing no key word with either is unrelated content. A single
 * unsupported Titlecase entity is flagged; words after a colon, dash
 * or opening quote are sentence-medial headings, not entities.
 */
function evidenceIssues(newSentences, evidencePool, originalBody) {
  const issues = [];
  const poolText = (evidencePool || [])
    .map((p) => [p.title, p.text].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const poolWords = new Set(poolText.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3));
  const originalWords = wordSet(originalBody);
  const originalLower = String(originalBody || '').toLowerCase();
  for (const sentence of newSentences) {
    const key = normaliseText(sentence).toLowerCase();
    const excerpt = sentence.slice(0, 80);
    for (const n of claimNumbers(sentence)) {
      if (!hasWholeWord(poolText, n)) {
        issues.push({ key: `ev-num:${key}`, reason: `unsupported number ${n} in corrected sentence ("${excerpt}") — not in the article's evidence` });
        break;
      }
    }
    const tokens = sentence.split(/\s+/);
    const significant = tokens
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    if (significant.length >= 3 && !significant.some((w) => poolWords.has(w) || originalWords.has(w))) {
      issues.push({ key: `ev-unrelated:${key}`, reason: `unrelated content in corrected sentence ("${excerpt}") — none of its key words appear in the article's evidence` });
    }
    const unsupportedEntities = [];
    // Determiners/pronouns are never named entities, even capitalised
    // mid-sentence ("…smaller The deal…" is caught by the splice marker,
    // not here).
    const NON_ENTITY_WORDS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'they', 'we', 'he', 'she', 'his', 'her', 'their', 'our', 'your', 'its', 'i']);
    tokens.forEach((raw, idx) => {
      if (idx === 0) return;
      const prev = tokens[idx - 1] || '';
      if (/[:—–]$/.test(prev) || /^[“"'(]$/.test(prev) || /^["“'(]/.test(raw)) return;
      const w = raw.replace(/^[“"'(\[]+/, '').replace(/[.,;:!?)"”'\]]+$/, '');
      if (!/^[A-Z][a-z]{2,}$/.test(w)) return;
      const lower = w.toLowerCase();
      if (NON_ENTITY_WORDS.has(lower)) return;
      if (hasWholeWord(poolText, lower) || hasWholeWord(originalLower, lower)) return;
      unsupportedEntities.push(w);
    });
    if (unsupportedEntities.length > 0) {
      issues.push({ key: `ev-entity:${key}`, reason: `unsupported named ${unsupportedEntities.length === 1 ? 'entity' : 'entities'} ${unsupportedEntities.join(', ')} in corrected sentence ("${excerpt}") — not in the article's evidence or original body` });
    }
  }
  return issues;
}

/**
 * Deterministic validation of a corrected body (Fix 2). REJECTS a body
 * containing any of:
 *  - broken sentence fragments (lowercase start, missing space after a
 *    boundary, repeated word, run-on over 500 chars, raw URL),
 *  - repeated sentences (exact duplicates ≥ 6 words, or near-duplicates
 *    with word-set similarity ≥ 0.9),
 *  - incomplete paragraphs (no closing sentence punctuation),
 *  - unbalanced quotes / parentheses,
 *  - unrelated content (an added sentence sharing no key word with the
 *    article's evidence or original body),
 *  - unsupported facts (an added sentence with a number or a named
 *    entity not in the article's evidence pool — entities may also come
 *    from the original body),
 *  - incoherence (a sentence containing a second sentence-start spliced
 *    mid-sentence, detected by the SPLICE_MARKER_RE fragment marker).
 * Issues already present UNCHANGED in the original body are NOT counted
 * (the correction must not make the body worse; it is not punished for
 * pre-existing quirks). Returns { ok, reasons }.
 */
export function validateCorrectedBody(originalBody, correctedBody, evidencePool) {
  const reasons = [];
  const originalSentences = splitSentences(originalBody);
  const correctedSentences = splitSentences(correctedBody);
  if (correctedSentences.length === 0 && originalSentences.length > 0) {
    reasons.push('corrected body has no complete sentences left');
  }
  const issueKey = (sentence, type) => `${normaliseText(sentence).toLowerCase()}|${type}`;
  const originalKeys = new Set();
  for (const s of originalSentences) {
    for (const issue of sentenceIssues(s)) originalKeys.add(issueKey(s, issue.type));
  }
  for (const s of correctedSentences) {
    for (const issue of sentenceIssues(s)) {
      if (!originalKeys.has(issueKey(s, issue.type))) reasons.push(issue.reason);
    }
  }
  const originalDupKeys = new Set(duplicateIssues(originalSentences).map((i) => i.key));
  for (const issue of duplicateIssues(correctedSentences)) {
    if (!originalDupKeys.has(issue.key)) reasons.push(issue.reason);
  }
  const originalParaKeys = new Set(paragraphIssues(originalBody).map((i) => i.key));
  for (const issue of paragraphIssues(correctedBody)) {
    if (!originalParaKeys.has(issue.key)) reasons.push(issue.reason);
  }
  const originalBalanceKeys = new Set(balanceIssues(originalBody).map((i) => i.key));
  for (const issue of balanceIssues(correctedBody)) {
    if (!originalBalanceKeys.has(issue.key)) reasons.push(issue.reason);
  }
  const originalNorms = new Set(originalSentences.map((s) => normaliseText(s).toLowerCase()));
  const newSentences = correctedSentences.filter((s) => !originalNorms.has(normaliseText(s).toLowerCase()));
  for (const issue of evidenceIssues(newSentences, evidencePool, originalBody)) {
    reasons.push(issue.reason);
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * Record one correction attempt (Phase 3, Priority 5).
 * Identity is (article_id, claim_key) — never claim_check_id, which
 * changes on every fact-check (live #30: 11 rows / 6 claims).
 *  - Success (applied/removed): always INSERT a new row — it closes
 *    the claim, and the gate counts a key resolved when its LATEST
 *    row is applied/removed.
 *  - Failure: when an OPEN row (pending/failed) already exists for
 *    the claim key, UPDATE it in place (attempt + latest
 *    claim_check_id + failure reason) instead of inserting a second
 *    open row for the same claim. Otherwise INSERT.
 * claim_key + failure_reason are written when migration 017 is
 * applied; when the columns do not exist yet the write falls back to
 * the old column list (the parent applies migrations live after
 * deploy). History is never deleted. Returns the row id written.
 */
async function recordCorrection(env, articleId, p) {
  const key = p.key;
  const failureReason = p.failureReason || null;
  if (p.action === 'failed' && p.openRow) {
    try {
      await d1Run(env,
        'UPDATE article_corrections SET claim_check_id = ?, attempt = ?, corrected_text = ?, failure_reason = ?, evidence_url = ?, claim_key = ? WHERE id = ?',
        [p.failed.id, p.attempt, p.correctedText || null, failureReason, p.evidenceUrl || null, key, p.openRow.id]);
      return p.openRow.id;
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      await d1Run(env,
        'UPDATE article_corrections SET claim_check_id = ?, attempt = ?, corrected_text = ?, evidence_url = ? WHERE id = ?',
        [p.failed.id, p.attempt, p.correctedText || null, p.evidenceUrl || null, p.openRow.id]);
      return p.openRow.id;
    }
  }
  const status = p.action === 'corrected' ? 'applied' : p.action;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url, claim_key, failure_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [articleId, p.failed.id, p.failed.claim_text, p.correctedText || null, p.attempt, status, p.recheck ? p.recheck.verdict : null, p.evidenceUrl || null, key, failureReason]);
    return inserted && inserted.meta ? inserted.meta.last_row_id : null;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    const inserted = await d1Run(env,
      'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [articleId, p.failed.id, p.failed.claim_text, p.correctedText || null, p.attempt, status, p.recheck ? p.recheck.verdict : null, p.evidenceUrl || null]);
    return inserted && inserted.meta ? inserted.meta.last_row_id : null;
  }
}

export async function runCorrection(env, article) {
  const latest = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [article.id]);
  if (!latest) return { outcome: 'failed', error: 'No fact-check on record for this article — run a fact-check first.' };
  if (latest.verdict === 'pass') {
    return { outcome: 'no-op', reason: 'Latest fact-check already passes — nothing to correct.', articleId: article.id };
  }
  const failedClaims = await d1All(env,
    "SELECT * FROM claim_checks WHERE fact_check_id = ? AND verdict IN ('INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE') ORDER BY id ASC",
    [latest.id]) || [];
  if (!failedClaims.length) {
    return { outcome: 'no-op', reason: 'Latest fact-check has no failed claims to correct.', articleId: article.id };
  }
  const pool = await loadEvidence(env, article);
  // NO article-specific evidence at all: correction cannot rewrite
  // anything from evidence, and it must NOT reach for unrelated
  // sources (fixed 2026-11-20). Mark every failed claim for human
  // review and leave the body untouched. The re-check below still runs
  // so the review state is recorded as a fresh fact-check row.
  if (pool.length === 0) {
    const results = failedClaims.map((failed) => ({
      claim: failed.claim_text, action: 'skipped', evidenceUrl: null,
      reason: 'No article-specific evidence on record — needs human review.',
    }));
    const recheck = await checkArticle(env, article, { checkKind: 'correction-recheck' });
    return {
      outcome: 'done', articleId: article.id, title: article.title, division: article.division,
      corrected: 0, removed: 0, skipped: failedClaims.length, results,
      recheckVerdict: recheck.verdict, recheck,
      note: 'No article-specific evidence — nothing was corrected or removed; failed claims need human review.',
    };
  }
  let body = String(article.body || '');
  const originalBody = body;
  let corrected = 0;
  let removed = 0;
  let skipped = 0;
  const results = [];
  // Phase 3, Priority 5: correction identity is (article_id, claimKey).
  // The old attempts count used claim_check_id, which changes on every
  // fact-check — so a re-check reset the counter to 0 and a second run
  // wrote duplicate rows for the same claim (live #30: 11 rows / 6
  // claims). Attempts are now counted per claim key across runs, and
  // recordCorrection() below never inserts a second OPEN row for a
  // claim that already has one.
  const existingCorrections = await d1All(env,
    'SELECT * FROM article_corrections WHERE article_id = ? ORDER BY id ASC', [article.id]) || [];
  const attemptsByKey = new Map();
  const openRowByKey = new Map(); // key -> latest open (pending/failed) row
  for (const row of existingCorrections) {
    const key = row.claim_key || claimKey(row.original_text || '');
    attemptsByKey.set(key, (attemptsByKey.get(key) || 0) + 1);
    if (row.status === 'pending' || row.status === 'failed') openRowByKey.set(key, row);
  }
  // Phase 3, Priority 2: run-level circuit breaker. Two consecutive
  // truncated LLM replies mean the model is stuck cutting replies off
  // — stop spending Neurons on rewrites for the rest of this run and
  // send the remaining claims to removal-or-human-review instead.
  let consecutiveTruncations = 0;
  let rewriteCircuitOpen = false;
  // Correction rows are collected here and written only after the
  // whole-body validation gate below passes — a rejected correction
  // must never leave 'applied' rows behind for a body that was not saved.
  const pending = [];
  for (const failed of failedClaims) {
    const key = claimKey(failed.claim_text);
    const attempts = attemptsByKey.get(key) || 0;
    if (attempts >= MAX_CORRECTION_ATTEMPTS) {
      skipped += 1;
      results.push({ claim: failed.claim_text, action: 'skipped', reason: `Already tried ${attempts} time(s) — max ${MAX_CORRECTION_ATTEMPTS} reached.` });
      continue;
    }
    const evidence = findEvidence(failed.claim_text, pool, { minScore: 0.3 });
    let action = null;
    let correctedText = null;
    let actionReason = null;
    let failureReason = null;
    // A rewrite is attempted whenever usable evidence exists — INCLUDING
    // conflicting evidence, because that is exactly the case where the
    // evidence holds the right number and the claim holds the wrong one.
    // (Fixed 2026-11-19: the old `!evidence.conflicting` guard sent every
    // wrong-number claim straight to removal instead of correcting it.)
    // The candidate validation below still rejects any rewrite that
    // re-introduces a number the evidence does not contain.
    if (evidence && evidence.score >= 0.3) {
      // Phase 3, Priority 2: the old call used maxTokens 200 and took
      // the first reply at face value — #30 burned 10 calls / 98
      // Neurons on replies that were truncated mid-sentence or opened
      // with a meta sentence ("Here is the corrected sentence.").
      // Now: a 500-token budget, a prompt that forbids introductions,
      // explicit truncation detection with ONE retry on a shorter
      // evidence quote, and the run-level circuit breaker above.
      let candidate = '';
      if (!rewriteCircuitOpen) {
        for (let attemptNo = 0; attemptNo < 2; attemptNo++) {
          const quote = attemptNo === 0 ? evidence.quote : String(evidence.quote || '').slice(0, 150);
          const rewrite = await generateText({
            prompt: `Original statement (failed fact-check): "${failed.claim_text}"\nEvidence: "${quote}" (source: ${evidence.url || 'unknown'})\nRewrite the statement so it is exactly supported by the evidence, keeping the same topic and plain tone. Reply with ONLY the corrected sentence, under 40 words, ending with a period. No introduction, no explanation, no quotation marks.`,
            system: 'You correct a factual statement using only the supplied evidence. Never invent numbers or facts that are not in the evidence.',
            maxTokens: 500,
            purpose: 'fact-check-correct',
          }, env);
          const raw = rewrite && rewrite.ok ? String(rewrite.text || '') : '';
          if (!rewrite || !rewrite.ok) { failureReason = 'rewrite-error'; break; }
          if (isTruncatedReply(raw)) {
            consecutiveTruncations += 1;
            failureReason = 'truncated-reply';
            if (consecutiveTruncations >= 2) rewriteCircuitOpen = true;
            continue; // retry once with the shorter quote
          }
          consecutiveTruncations = 0;
          candidate = cleanCandidate(raw);
          break;
        }
      } else {
        failureReason = 'rewrite-circuit-open';
      }
      // Fix 2: the reply is reduced to its first complete sentence and
      // must pass isValidReplacementSentence — a multi-sentence or
      // fragment reply (the #28 splice shape) is never inserted whole.
      // A rewrite is usable only if it is a real single sentence,
      // different from the original, and does not re-introduce a number
      // the evidence does not contain. Dropping the disputed number
      // entirely is a legitimate correction (the re-check then judges
      // the weaker claim). EVERY number in the candidate must appear in
      // the evidence — one shared number (e.g. the year) must not
      // launder an invented one.
      // (Fixed 2026-11-19: `some` let "77 million ... in 2023" through
      // because "2023" matched.)
      const candidateNumbers = claimNumbers(candidate);
      const evidenceNumbers = claimNumbers(evidence.quote || '');
      const candidateOk = candidate && isValidReplacementSentence(candidate, failed.claim_text)
        && (candidateNumbers.length === 0 || evidenceNumbers.length === 0
          || candidateNumbers.every((n) => evidenceNumbers.includes(n)));
      if (candidateOk) {
        const replaced = replaceSentence(body, failed.claim_text, candidate);
        if (replaced !== null) {
          body = replaced;
          action = 'corrected';
          correctedText = candidate;
          corrected += 1;
        }
      } else if (candidate) {
        actionReason = `LLM rewrite rejected (not a single complete evidence-backed sentence): "${candidate.slice(0, 120)}"`;
        failureReason = failureReason || 'validation-rejected';
      } else if (!failureReason) {
        failureReason = 'rewrite-rejected';
      }
    }
    if (!action) {
      // No usable evidence or no valid rewrite: remove the unsupported
      // sentence ONLY when removal preserves context (Fix 2) — a
      // sentence a neighbour refers back to ("This deal …") is left for
      // a human instead of leaving a dangling reference behind.
      if (removalPreservesContext(body, failed.claim_text)) {
        const removedBody = replaceSentence(body, failed.claim_text, '');
        if (removedBody !== null) {
          body = removedBody.replace(/[ \t]{2,}/g, ' ');
          action = 'removed';
          removed += 1;
        } else {
          action = 'failed';
          actionReason = 'Could not locate the sentence in the body to remove it.';
          failureReason = failureReason || 'sentence-not-found';
        }
      } else {
        action = 'skipped';
        actionReason = 'Removing this sentence would leave a dangling reference — needs human review.';
        failureReason = failureReason || 'context-dangling';
        skipped += 1;
      }
    }
    const recheck = correctedText
      ? judgeClaimDeterministic(correctedText, findEvidence(correctedText, pool), pool.length === 0)
      : null;
    pending.push({
      failed, action, correctedText, recheck, attempt: attempts + 1,
      evidenceUrl: action === 'corrected' && evidence ? evidence.url : null,
      reason: actionReason, key,
      // The stored row records a failure reason only when the attempt
      // FAILED (a corrected/removed row is a success). The returned
      // results below keep it in all cases — it explains why the claim
      // was removed rather than corrected.
      failureReason: (action === 'corrected' || action === 'removed') ? null : failureReason,
      openRow: openRowByKey.get(key) || null,
    });
    results.push({
      claim: failed.claim_text, action, correctedText,
      evidenceUrl: action === 'corrected' && evidence ? evidence.url : null,
      recheckVerdict: recheck ? recheck.verdict : null,
      ...(actionReason ? { reason: actionReason } : {}),
      ...(failureReason ? { failureReason } : {}),
    });
  }

  // Whole-body validation gate (Fix 2): the corrected body must read
  // coherently before anything is saved. On rejection the body is NOT
  // saved (no revision row, no UPDATE — the pre-edit body is untouched),
  // every attempted correction is recorded as a 'failed' row, and the
  // article is left for human review (the re-check below runs on the
  // unchanged body, verdict needs-review; fact_checked is never set).
  // The failure reason is recorded in four places: this returned
  // result (the run/task log), each correction row's corrected_text
  // ("VALIDATION REJECTED — …"), the row's failure_reason column
  // ('validation-rejected', migration 017 — Phase 3, Priority 2),
  // and the results below. It is NOT in recheck_verdict: that column
  // has a CHECK constraint allowing only verdict words, so free text
  // would violate it.
  if (body !== originalBody) {
    const validation = validateCorrectedBody(originalBody, body, pool);
    if (!validation.ok) {
      // Every attempted correction is recorded as a 'failed' row with
      // failure_reason 'validation-rejected' (Phase 3, P2/P5) — via
      // recordCorrection(), so a claim that already has an open row is
      // updated in place instead of duplicated.
      const failedRowByKey = new Map();
      for (const p of pending) {
        if (p.action === 'skipped') continue; // 'skipped' is not a valid status value — no row
        if (p.action === 'failed' && failedRowByKey.has(p.key)) p.openRow = failedRowByKey.get(p.key);
        const rowId = await recordCorrection(env, article.id, {
          ...p, action: 'failed',
          correctedText: p.action === 'failed' ? null : `VALIDATION REJECTED — ${validation.reasons.join('; ')}`,
          failureReason: 'validation-rejected',
        });
        if (rowId) failedRowByKey.set(p.key, { id: rowId });
      }
      const recheck = await checkArticle(env, article, { checkKind: 'correction-recheck' });
      return {
        outcome: 'done', articleId: article.id, title: article.title, division: article.division,
        corrected: 0, removed: 0, skipped,
        validationRejected: true, validationReasons: validation.reasons,
        results: results.map((r) => (r.action === 'corrected' || r.action === 'removed'
          ? {
            ...r, action: 'failed', attemptedAction: r.action, correctedText: null,
            evidenceUrl: null, recheckVerdict: null, failureReason: 'validation-rejected',
            reason: `Validation rejected the corrected body: ${validation.reasons.join('; ')}`,
          }
          : r)),
        recheckVerdict: recheck.verdict, recheck,
        note: 'Corrected body failed validation (garbled, repeated, incomplete or unsupported content) — nothing was saved; the article needs human review.',
      };
    }
  }

  // Validation passed (or nothing changed): record the corrections.
  // 'skipped' has no row — the status CHECK allows only
  // pending/applied/failed/removed, and a skip is recorded in the
  // returned results instead. recordCorrection() (Phase 3, P5) never
  // inserts a second OPEN row for a claim that already has one.
  const failedRowByKey = new Map();
  for (const p of pending) {
    if (p.action === 'skipped') continue;
    if (p.action === 'failed' && failedRowByKey.has(p.key)) p.openRow = failedRowByKey.get(p.key);
    const rowId = await recordCorrection(env, article.id, p);
    if (p.action === 'failed' && rowId) failedRowByKey.set(p.key, { id: rowId });
  }

  if (body !== originalBody) {
    await d1Run(env,
      'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
      [article.id, article.title, article.excerpt || null, originalBody, article.status, 'fact-checking']);
    await d1Run(env, 'UPDATE articles SET body = ?, updated_at = ? WHERE id = ?',
      [body, new Date().toISOString(), article.id]);
  }
  const updated = { ...article, body };
  const recheck = await checkArticle(env, updated, { checkKind: 'correction-recheck' });
  return {
    outcome: 'done', articleId: article.id, title: article.title, division: article.division,
    corrected, removed, skipped, results, recheckVerdict: recheck.verdict, recheck,
    note: 'Corrections are grounded in fetched evidence or removals only — no fabricated replacement facts.',
  };
}

export async function runFactChecking(task, env) {
  const payload = parsePayload(task);
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { outcome: 'failed', error: 'Fact-check needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [articleId]);
  if (!article) return { outcome: 'failed', error: `Article ${articleId} not found.` };
  // A re-check payload (check_kind 'recheck') ALWAYS runs a real
  // fact-check, even when the task row it arrived on is kind
  // 'correct': the dashboard Correct button creates kind='correct'
  // rows, and the Re-check endpoint reuses the article's newest
  // fact-checking task whatever its kind — routing that row through
  // runCorrection made a re-check a no-op on a passing article (live
  // #31, runs #121/#122: no new fact_checks row, the old PASS was
  // returned as the "re-check" result). The handler also forces the
  // reused row's kind to 'fact-check'; this dispatch guard is the
  // second layer, so no caller can reach the correction no-op from a
  // re-check. Genuine corrections (kind 'correct', no recheck
  // payload) still route to runCorrection.
  if (task && task.kind === 'correct' && payload.check_kind !== 'recheck') {
    return runCorrection(env, article);
  }
  const result = await checkArticle(env, article, { checkKind: payload.check_kind || 'initial' });
  return {
    outcome: 'done',
    ...result,
    note: 'Advisory only — fact_checked was not set and nothing was approved.',
  };
}
