/**
 * FS AI — Autonomy: claim-level fact-checking + auto-correction.
 *
 * Genuine checking, not a rubber stamp. Claims are extracted from the
 * article body sentence by sentence, then each one is matched against
 * the fetched source material for the article's division
 * (research_items evidence text + article_sources rows). Verdicts:
 * VERIFIED / INCORRECT / UNSUPPORTED / OUTDATED / CONFLICTING /
 * UNVERIFIABLE. A claim is VERIFIED only when real evidence text
 * supports it — a model's own unsupported answer is never evidence.
 * An LLM may judge claim-vs-evidence entailment ONLY when the evidence
 * text is supplied and cited (borderline matches); when no provider is
 * available the deterministic verdict stands.
 *
 * Correction (kind 'correct'): for each failed claim, find better
 * evidence, rewrite the statement from that evidence (LLM) or remove
 * the unsupported sentence when no evidence exists; record original vs
 * corrected text, store the pre-edit body as a revision, and re-check
 * the modified claim. Max 3 attempts per claim; a claim that still
 * fails stays unpublished. Never auto-approves and never sets
 * fact_checked — the publish gate reads fact_checks and sets
 * fact_checked=1 only when it publishes.
 */
import { d1All, d1First, d1Run, DISCLAIMER_DIVISIONS } from '../../middleware/validation.js';
import { generateText } from '../../llm/index.js';

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

/** Split a body into checkable claim sentences (headings + the AI-DRAFT marker excluded). */
export function extractClaims(body, { maxClaims = MAX_CLAIMS_PER_ARTICLE } = {}) {
  const text = String(body || '')
    .replace(/^AI-DRAFT[^\n]*\n?/im, '')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/\n+/g, ' ');
  const raw = text.split(/(?<=[.!?])\s+/);
  const claims = [];
  for (const sentence of raw) {
    const s = sentence.trim().replace(/\s+/g, ' ');
    if (s.length < 40 || s.length > 500) continue;
    if (!/[a-zA-Z]/.test(s)) continue;
    const hasNumber = /\d/.test(s);
    const hasAssertion = /\b(is|are|was|were|has|have|can|will|uses|provides|offers|means|includes|requires|takes|costs|lasts|covers|helps|gives|makes)\b/i.test(s);
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
      ? { verdict: 'UNVERIFIABLE', explanation: 'No source material was fetched for this division, so the claim cannot be checked.' }
      : { verdict: 'UNSUPPORTED', explanation: 'No fetched source supports this claim.' };
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

async function loadEvidence(env, article) {
  const items = await d1All(env,
    'SELECT id, source_id, title, url, published_at, summary, evidence_text, is_outdated FROM research_items ' +
    'WHERE division_id = ? ORDER BY fetched_at DESC LIMIT 200', [article.division_id]) || [];
  const sources = await d1All(env, 'SELECT source_title, source_url FROM article_sources WHERE article_id = ?', [article.id]) || [];
  const pool = items.map((it) => ({
    url: it.url, title: it.title, isOutdated: it.is_outdated === 1,
    text: [it.title, it.summary, it.evidence_text].filter(Boolean).join(' '),
  }));
  for (const s of sources) {
    if (s.source_url && !pool.some((p) => p.url === s.source_url)) {
      pool.push({ url: s.source_url, title: s.source_title || '', text: s.source_title || '', isOutdated: false });
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

export async function checkArticle(env, article) {
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC', [article.id]) || [];
  const { checks, flags } = structuralChecks(article, sources);
  const claims = extractClaims(article.body);
  const pool = await loadEvidence(env, article);
  const poolEmpty = pool.length === 0;
  const claimResults = [];
  for (const claim of claims) {
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
      claim, verdict: judged.verdict, evidenceUrl: evidence ? evidence.url : null,
      evidenceQuote: evidence ? evidence.quote : null, explanation: judged.explanation,
    });
  }

  const verified = claimResults.filter((c) => c.verdict === 'VERIFIED').length;
  const failed = claimResults.filter((c) => ['INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE'].includes(c.verdict)).length;
  let verdict = 'pass';
  if (/SCAFFOLD — full draft needed/.test(String(article.body || ''))) verdict = 'failed';
  else if (claims.length === 0) { verdict = 'needs-review'; flags.push('No checkable claims could be extracted from the body.'); }
  else if (claimResults.some((c) => c.verdict === 'INCORRECT')) verdict = 'failed';
  else if (failed > 0 || flags.length > 0) verdict = 'needs-review';

  const inserted = await d1Run(env,
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (?, ?, ?, ?, ?)',
    [article.id, verdict, claimResults.length, verified, failed]);
  const factCheckId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  if (factCheckId) {
    for (const c of claimResults) {
      await d1Run(env,
        'INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, ?, ?, ?, ?, ?)',
        [factCheckId, c.claim, c.verdict, c.evidenceUrl, c.evidenceQuote, c.explanation]);
    }
  }
  return {
    factCheckId, articleId: article.id, title: article.title, division: article.division,
    status: article.status, verdict, claims: claimResults,
    claimsTotal: claimResults.length, claimsVerified: verified, claimsFailed: failed,
    checks, flags,
  };
}

function replaceSentence(body, sentence, replacement) {
  const text = String(body || '');
  const idx = text.indexOf(sentence);
  if (idx >= 0) return text.slice(0, idx) + replacement + text.slice(idx + sentence.length);
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(escaped);
  if (!re.test(text)) return null;
  return text.replace(re, replacement);
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
  let body = String(article.body || '');
  const originalBody = body;
  let corrected = 0;
  let removed = 0;
  let skipped = 0;
  const results = [];
  for (const failed of failedClaims) {
    const attemptsRow = await d1First(env, 'SELECT COUNT(*) AS n FROM article_corrections WHERE claim_check_id = ?', [failed.id]);
    const attempts = Number(attemptsRow ? attemptsRow.n : 0);
    if (attempts >= MAX_CORRECTION_ATTEMPTS) {
      skipped += 1;
      results.push({ claim: failed.claim_text, action: 'skipped', reason: `Already tried ${attempts} time(s) — max ${MAX_CORRECTION_ATTEMPTS} reached.` });
      continue;
    }
    const evidence = findEvidence(failed.claim_text, pool, { minScore: 0.3 });
    let action = null;
    let correctedText = null;
    // A rewrite is attempted whenever usable evidence exists — INCLUDING
    // conflicting evidence, because that is exactly the case where the
    // evidence holds the right number and the claim holds the wrong one.
    // (Fixed 2026-11-19: the old `!evidence.conflicting` guard sent every
    // wrong-number claim straight to removal instead of correcting it.)
    // The candidate validation below still rejects any rewrite that
    // re-introduces a number the evidence does not contain.
    if (evidence && evidence.score >= 0.3) {
      // Try an LLM rewrite grounded in the evidence quote.
      const rewrite = await generateText({
        prompt: `Original statement (failed fact-check): "${failed.claim_text}"\nEvidence: "${evidence.quote}" (source: ${evidence.url || 'unknown'})\nRewrite the statement so it is exactly supported by the evidence, keeping the same topic and plain tone. Reply with only the corrected sentence, nothing else.`,
        system: 'You correct a factual statement using only the supplied evidence. Never invent numbers or facts that are not in the evidence.',
        maxTokens: 200,
        purpose: 'fact-check-correct',
      }, env);
      const candidate = rewrite && rewrite.ok ? String(rewrite.text || '').trim().replace(/\s+/g, ' ') : '';
      // A rewrite is usable only if it is a real sentence, different from
      // the original, and does not re-introduce a number the evidence
      // does not contain. Dropping the disputed number entirely is a
      // legitimate correction (the re-check then judges the weaker claim).
      // EVERY number in the candidate must appear in the evidence — one
      // shared number (e.g. the year) must not launder an invented one.
      // (Fixed 2026-11-19: `some` let "77 million ... in 2023" through
      // because "2023" matched.)
      const candidateNumbers = claimNumbers(candidate);
      const evidenceNumbers = claimNumbers(evidence.quote || '');
      const candidateOk = candidate.length >= 20 && candidate !== failed.claim_text
        && !/as an ai|i (do not|don't) know/i.test(candidate)
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
      }
    }
    if (!action) {
      // No usable evidence or no valid rewrite: remove the unsupported sentence.
      const removedBody = replaceSentence(body, failed.claim_text, '');
      if (removedBody !== null) {
        body = removedBody.replace(/[ \t]{2,}/g, ' ');
        action = 'removed';
        removed += 1;
      } else {
        action = 'failed';
      }
    }
    const recheck = correctedText
      ? judgeClaimDeterministic(correctedText, findEvidence(correctedText, pool), pool.length === 0)
      : null;
    await d1Run(env,
      'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [article.id, failed.id, failed.claim_text, correctedText, attempts + 1, action === 'corrected' ? 'applied' : action, recheck ? recheck.verdict : null]);
    results.push({ claim: failed.claim_text, action, correctedText, recheckVerdict: recheck ? recheck.verdict : null });
  }

  if (body !== originalBody) {
    await d1Run(env,
      'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
      [article.id, article.title, article.excerpt || null, originalBody, article.status, 'fact-checking']);
    await d1Run(env, 'UPDATE articles SET body = ?, updated_at = ? WHERE id = ?',
      [body, new Date().toISOString(), article.id]);
  }
  const updated = { ...article, body };
  const recheck = await checkArticle(env, updated);
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
  if (task && task.kind === 'correct') {
    return runCorrection(env, article);
  }
  const result = await checkArticle(env, article);
  return {
    outcome: 'done',
    ...result,
    note: 'Advisory only — fact_checked was not set and nothing was approved.',
  };
}
