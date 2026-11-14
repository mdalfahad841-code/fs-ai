/**
 * FS AI — Autonomy: fact-checking agent handler.
 *
 * Loads the article + its article_sources rows and reports checks/flags.
 * Never auto-approves and never sets fact_checked — the verdict is only
 * 'pass' or 'needs-review' for the owner to act on.
 */
import { d1All, d1First, DISCLAIMER_DIVISIONS } from '../../middleware/validation.js';

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
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
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC', [articleId]) || [];

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

  // Numbers in the body with no source to back them: flag, never verify.
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

  const verdict = flags.length ? 'needs-review' : 'pass';
  return {
    outcome: 'done',
    articleId,
    title: article.title,
    division: article.division,
    status: article.status,
    verdict,
    checks,
    flags,
    note: 'Advisory only — fact_checked was not set and nothing was approved.',
  };
}
