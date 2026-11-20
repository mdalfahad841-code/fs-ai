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
 * recorded as an article_revisions row first.
 */
import { d1All, d1First, d1Run, nowIso, deriveSeoDescription } from '../../middleware/validation.js';

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

  // 6. Internal linking: body links to another real article, or suggestions exist.
  const siblings = await d1All(env,
    'SELECT id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 5',
    [article.division_id, 'published', article.id]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article?id=${s.id}`,
  }));
  const linksInternally = internalLinks.some((l) => body.includes(l.url) || body.includes(`id=${l.id}`) || body.includes(l.slug));
  push('internal-links', linksInternally, 'needs-review',
    linksInternally ? 'Body links to at least one other published article.' : `${siblings.length} related published article(s) available to link — none linked yet. Fix: add a link to one of them — the SEO repair appends a Related reading link to the newest published sibling in the same division.`);

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

  // 9. Duplicate detection vs other published articles (5-word shingles).
  const mine = shingles(plainBody);
  const others = await d1All(env, "SELECT id, body FROM articles WHERE status = 'published' AND id != ?", [article.id]) || [];
  let maxOverlap = 0;
  let closestId = null;
  for (const other of others) {
    const theirs = shingles(other.body || '');
    if (!mine.size || !theirs.size) continue;
    let common = 0;
    for (const s of mine) if (theirs.has(s)) common += 1;
    const overlap = common / mine.size;
    if (overlap > maxOverlap) { maxOverlap = overlap; closestId = other.id; }
  }
  push('duplicate', maxOverlap < 0.25, maxOverlap >= 0.5 ? 'failed' : 'needs-review',
    others.length
      ? `Highest 5-word shingle overlap with another published article: ${Math.round(maxOverlap * 100)}%${closestId ? ` (article ${closestId})` : ''}.`
      : 'No other published articles to compare against.');

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
  return { checks, verdict, failed: failed.map((c) => c.name), needsReview: needsReview.map((c) => c.name) };
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
 *   newest published sibling in the same division, when the body
 *   links none and one exists (a real link — never faked).
 * Published articles are NEVER modified (report only). Every repair
 * stores a pre-edit article_revisions row first. Returns
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
  // Internal link: append a Related reading line to a real sibling.
  const siblings = await d1All(env,
    'SELECT id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 5',
    [article.division_id, 'published', article.id]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article?id=${s.id}`,
  }));
  const linksInternally = internalLinks.some((l) => newBody.includes(l.url) || newBody.includes(`id=${l.id}`) || newBody.includes(l.slug));
  if (!linksInternally && internalLinks.length) {
    const target = internalLinks[0];
    newBody = `${newBody.replace(/\s+$/, '')}\n\nRelated reading: [${target.title}](${target.url})`;
    repairs.push(`added a Related reading link to published article #${target.id} ("${target.title}").`);
  }

  if (!repairs.length) return { repaired: false, repairs, repairedFields, article };
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
    [article.id, article.title, article.excerpt || null, body, article.status, 'seo-repair']);
  await d1Run(env, 'UPDATE articles SET body = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?',
    [newBody, newSeoTitle, newSeoDescription, nowIso(), article.id]);
  const fresh = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [article.id]);
  return { repaired: true, repairs, repairedFields, article: fresh || { ...article, body: newBody, seo_title: newSeoTitle, seo_description: newSeoDescription } };
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
  const insertedSeo = await d1Run(env, 'INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, ?, ?)',
    [articleId, suite.verdict, JSON.stringify(suite.checks)]);
  const seoCheckId = insertedSeo && insertedSeo.meta ? insertedSeo.meta.last_row_id : null;

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
    verdict: suite.verdict,
    checks: suite.checks,
    seoCheckId,
    note: repair.repaired
      ? `SEO repaired from the article's own content: ${repair.repairs.join(' ')}`
      : 'SEO fields already adequate — nothing repaired, nothing overwritten.',
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
  const inserted = await d1Run(env, 'INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, ?, ?)',
    [article.id, suite.verdict, JSON.stringify(suite.checks)]);
  const seoCheckId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  return {
    outcome: 'done',
    action: 'check',
    articleId: article.id,
    title: article.title,
    division: article.division,
    seoTitle: String(article.seo_title || ''),
    seoDescription: String(article.seo_description || ''),
    verdict: suite.verdict,
    checks: suite.checks,
    seoCheckId,
    note: 'Check-only: the article was not modified — no repair, no revision row.',
  };
}
