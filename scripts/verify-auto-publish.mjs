#!/usr/bin/env node
/**
 * FS AI — First-real-auto-publish proof (close-out A6, 2026-11-23).
 *
 * DO NOT RUN until the first real auto-publish has happened. No real
 * auto-published article exists yet (#34 is a draft; the first real
 * auto-publish has not happened). See
 * docs/CLOSEOUT-A6-AUTO-PUBLISH-PROOF-2026-11-23.md for the run
 * procedure, the expected output, and the SQL step.
 *
 * Usage: node scripts/verify-auto-publish.mjs <article-id>
 *
 * Verifies ONE newly auto-published article against the LIVE site,
 * using ONLY public read-only endpoints (the Pages site + the public
 * GET /api/articles API). It has no credentials, writes nothing to D1,
 * and never publishes, edits or touches any article — it only GETs.
 * On all-PASS it prints the exact SQL for the PARENT to run via the
 * D1 API; the script itself cannot write to D1.
 *
 * Checks (each prints PASS / FAIL / WAIT with raw evidence):
 *   1. page — the article page answers 200, and the public API serves
 *      the article with a non-empty title + body (the page itself is
 *      JS-rendered, so the title/body are NOT in the raw HTML — the
 *      API is what proves it renders).
 *   2. division-home — the article appears in its division's public
 *      list AND is the first entry of the date-desc public list (the
 *      home "Latest guide").
 *   3. sitemap — the article is in /sitemap.xml. If it is not there
 *      yet the check is WAIT, not FAIL: the sitemap refreshes hourly
 *      (top of the hour) and the script tells the operator to wait
 *      for the next refresh and re-run — it never claims the sitemap
 *      updates instantly.
 *   4. meta — the per-article canonical / title / og values exist in
 *      the API record, and the served article.html contains the
 *      setMeta calls that apply them (JS-set). Stated plainly: a
 *      no-JS crawler still sees the generic fallback (the raw page
 *      HTML shows "Loading article…") per the A3 crawler report —
 *      the script checks the served JS, not a rendered head.
 *   5. counts — the live published total moved by exactly +1 against
 *      the recorded baseline (25 -> 26). The draft side (-1) is NOT
 *      verifiable from any public endpoint (drafts are never served
 *      publicly), so the script prints the expected draft total and
 *      the exact dashboard path — the operator MUST confirm drafts
 *      7 -> 6 on the dashboard before the parent records the proof.
 *      The script never claims the draft move itself.
 *
 * Exit code: 0 only when every check is PASS. Any FAIL or WAIT exits
 * non-zero and no proof SQL is printed.
 *
 * Refuses protected / legacy article ids outright (26, 27, 28, 29,
 * 30, 31, 33): the first auto-publish is always a NEW article, never
 * one of those.
 */
'use strict';

const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';
const WORKER_API = 'https://fs-ai.mdalfahad841.workers.dev';
const FETCH_TIMEOUT_MS = 10 * 1000;

// Baseline recorded 2026-11-23 (live D1, parent-verified): 25 published
// articles, 7 drafts (#26, #27, #28, #29, #30, #31, #33). If the
// dashboard shows different totals on the morning of the first
// auto-publish, update these two numbers before running — the script
// refuses to guess a baseline.
const PUBLISHED_BEFORE = 25;
const DRAFTS_BEFORE = 7;

const PROTECTED_IDS = new Set([26, 27, 28, 29, 30, 31, 33]);

const results = [];

function record(name, status, evidence) {
  results.push({ name, status, evidence });
  console.log(`[${status}] ${name} — ${evidence}`);
}

async function fetchText(url, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const { status, text } = await fetchText(url, { headers: { Accept: 'application/json' } });
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status, data, text };
}

function fail(name, evidence) {
  record(name, 'FAIL', evidence);
}

function pass(name, evidence) {
  record(name, 'PASS', evidence);
}

async function main() {
  const arg = process.argv[2];
  const articleId = Number(arg);
  if (!arg || !Number.isInteger(articleId) || articleId <= 0) {
    console.error('Usage: node scripts/verify-auto-publish.mjs <article-id>');
    console.error('Example: node scripts/verify-auto-publish.mjs 34');
    process.exitCode = 2;
    return;
  }
  if (PROTECTED_IDS.has(articleId)) {
    console.error(`Refusing article #${articleId}: protected / legacy article — this script is only for a newly auto-published article.`);
    process.exitCode = 2;
    return;
  }
  console.log(`Verifying newly auto-published article #${articleId} against the live site.`);
  console.log(`Baseline (recorded 2026-11-23): ${PUBLISHED_BEFORE} published, ${DRAFTS_BEFORE} drafts.`);

  // --- 1. page: 200 + renders via the public API --------------------
  let article = null;
  try {
    const page = await fetchText(`${PAGES_BASE}/pages/article?id=${articleId}`);
    if (page.status !== 200) {
      fail('1. page', `article page answered HTTP ${page.status}, expected 200.`);
    } else {
      const list = await fetchJson(`${WORKER_API}/api/articles?limit=100`);
      const found = list.status === 200 && list.data && Array.isArray(list.data.articles)
        ? list.data.articles.find((a) => Number(a.id) === articleId)
        : null;
      if (!found) {
        fail('1. page', `article page is 200, but /api/articles (HTTP ${list.status}) does not list article #${articleId} — it is not publicly published.`);
      } else {
        const single = await fetchJson(`${WORKER_API}/api/articles/${encodeURIComponent(found.slug)}`);
        const singleArticle = single.status === 200 && single.data ? single.data.article : null;
        const title = singleArticle && typeof singleArticle.title === 'string' ? singleArticle.title : '';
        const body = singleArticle && typeof singleArticle.body === 'string' ? singleArticle.body : '';
        if (!title.trim() || !body.trim()) {
          fail('1. page', `API serves article #${articleId} but title/body are empty (title ${title.length} chars, body ${body.length} chars). Raw evidence: ${JSON.stringify({ status: single.status, keys: singleArticle ? Object.keys(singleArticle) : null }).slice(0, 300)}`);
        } else {
          article = { ...found, title, body, excerpt: singleArticle.excerpt || found.excerpt || '' };
          pass('1. page', `article page 200; API serves "#${articleId} ${title}" (slug ${found.slug}, body ${body.length} chars). Note: the raw page HTML is JS-rendered — the title/body are proven via the API, not the fetched HTML.`);
        }
      }
    }
  } catch (err) {
    fail('1. page', `fetch failed: ${err && err.name === 'AbortError' ? 'timed out after 10 s' : String((err && err.message) || err).slice(0, 200)}`);
  }
  if (!article) {
    // Without the article record the remaining checks cannot run.
    record('2. division-home', 'FAIL', 'skipped — article record not established by check 1.');
    record('3. sitemap', 'FAIL', 'skipped — article record not established by check 1.');
    record('4. meta', 'FAIL', 'skipped — article record not established by check 1.');
    record('5. counts', 'FAIL', 'skipped — article record not established by check 1.');
    return finish(articleId, null);
  }

  // --- 2. division page + home Latest list --------------------------
  try {
    const divisionList = await fetchJson(`${WORKER_API}/api/articles?division=${encodeURIComponent(article.division)}&limit=100`);
    const inDivision = divisionList.status === 200 && divisionList.data && Array.isArray(divisionList.data.articles)
      && divisionList.data.articles.some((a) => Number(a.id) === articleId);
    const allList = await fetchJson(`${WORKER_API}/api/articles?limit=100`);
    const all = allList.status === 200 && allList.data && Array.isArray(allList.data.articles) ? allList.data.articles : [];
    const position = all.findIndex((a) => Number(a.id) === articleId);
    if (!inDivision) {
      fail('2. division-home', `/api/articles?division=${article.division} (HTTP ${divisionList.status}) does not list article #${articleId} — it would not appear on its division page.`);
    } else if (position !== 0) {
      fail('2. division-home', `article #${articleId} is in its division list, but is position ${position + 1} of ${all.length} in the date-desc public list (expected 1st — the home Latest guide). First entry is #${all[0] ? all[0].id : 'none'}.`);
    } else {
      pass('2. division-home', `in division "${article.division}" list; 1st of ${all.length} in the date-desc public list — the home Latest guide. (Division + home pages render from this same public API.)`);
    }
  } catch (err) {
    fail('2. division-home', `fetch failed: ${err && err.name === 'AbortError' ? 'timed out after 10 s' : String((err && err.message) || err).slice(0, 200)}`);
  }

  // --- 3. sitemap (after the next hourly refresh) --------------------
  try {
    const sitemap = await fetchText(`${PAGES_BASE}/sitemap.xml`);
    if (sitemap.status !== 200) {
      fail('3. sitemap', `/sitemap.xml answered HTTP ${sitemap.status}, expected 200.`);
    } else if (sitemap.text.includes(`/pages/article?id=${articleId}`)) {
      const urlCount = (sitemap.text.match(/<loc>/g) || []).length;
      pass('3. sitemap', `/sitemap.xml (HTTP 200, ${urlCount} URLs) contains /pages/article?id=${articleId}.`);
    } else {
      record('3. sitemap', 'WAIT', `/sitemap.xml (HTTP 200) does not contain /pages/article?id=${articleId} yet. The sitemap refreshes HOURLY (top of the hour, sitemap-refresh workflow) — wait for the next refresh and re-run this script. Do not record the proof until this check passes.`);
    }
  } catch (err) {
    fail('3. sitemap', `fetch failed: ${err && err.name === 'AbortError' ? 'timed out after 10 s' : String((err && err.message) || err).slice(0, 200)}`);
  }

  // --- 4. canonical / title / og (JS-set) ----------------------------
  try {
    const expectedCanonical = `${PAGES_BASE}/pages/article?id=${articleId}`;
    const expectedOgTitle = `${article.title} — FS AI`;
    const pageHtml = await fetchText(`${PAGES_BASE}/pages/article?id=${articleId}`);
    const articleHtml = await fetchText(`${PAGES_BASE}/pages/article.html`);
    const needs = ["setMeta('og:title'", "setMeta('og:description'", "setMeta('og:url'", "setMeta('twitter:title'"];
    const missingJs = articleHtml.status === 200
      ? needs.filter((s) => !articleHtml.text.includes(s))
      : needs;
    const noJsFallback = pageHtml.status === 200 && pageHtml.text.includes('Loading article');
    if (!article.title.trim() || !article.excerpt || !article.excerpt.trim()) {
      fail('4. meta', `API record lacks per-article values (title ${article.title.length} chars, excerpt ${(article.excerpt || '').length} chars).`);
    } else if (articleHtml.status !== 200) {
      fail('4. meta', `served article.html answered HTTP ${articleHtml.status} — cannot verify the JS that applies the per-article meta.`);
    } else if (missingJs.length > 0) {
      fail('4. meta', `served article.html is missing the JS that applies per-article meta: ${missingJs.join(', ')}.`);
    } else {
      pass('4. meta', `API record carries title "${article.title}" + excerpt (${article.excerpt.length} chars); expected canonical ${expectedCanonical}, og:title "${expectedOgTitle}"; served article.html contains the setMeta calls for og:title / og:description / og:url / twitter:title. No-JS note: the raw page HTML ${noJsFallback ? 'still shows the generic fallback ("Loading article…")' : 'did not show the expected fallback text'} — a no-JS crawler sees generic title/canonical, per the A3 crawler report; the per-article values are applied by JS after load.`);
    }
  } catch (err) {
    fail('4. meta', `fetch failed: ${err && err.name === 'AbortError' ? 'timed out after 10 s' : String((err && err.message) || err).slice(0, 200)}`);
  }

  // --- 5. counts: published +1 (drafts: dashboard confirmation) -----
  try {
    const allList = await fetchJson(`${WORKER_API}/api/articles?limit=100`);
    const all = allList.status === 200 && allList.data && Array.isArray(allList.data.articles) ? allList.data.articles : [];
    const publishedAfter = all.length;
    const occurrences = all.filter((a) => Number(a.id) === articleId).length;
    if (allList.status !== 200) {
      fail('5. counts', `/api/articles answered HTTP ${allList.status} — cannot count published articles.`);
    } else if (publishedAfter !== PUBLISHED_BEFORE + 1) {
      fail('5. counts', `live published total is ${publishedAfter}, expected ${PUBLISHED_BEFORE} + 1 = ${PUBLISHED_BEFORE + 1}.`);
    } else if (occurrences !== 1) {
      fail('5. counts', `article #${articleId} appears ${occurrences} times in the published list (expected exactly 1).`);
    } else {
      pass('5. counts', `live published total ${publishedAfter} = baseline ${PUBLISHED_BEFORE} + 1; article #${articleId} appears exactly once. MANUAL (required before recording the proof): confirm on the dashboard (Content Management → Articles, filter Draft) that drafts went ${DRAFTS_BEFORE} -> ${DRAFTS_BEFORE - 1}. Drafts are never served publicly, so no script can verify that move — if the dashboard draft count did not move by exactly -1, STOP and do not record the proof.`);
    }
    return finish(articleId, publishedAfter);
  } catch (err) {
    fail('5. counts', `fetch failed: ${err && err.name === 'AbortError' ? 'timed out after 10 s' : String((err && err.message) || err).slice(0, 200)}`);
    return finish(articleId, null);
  }
}

function finish(articleId, publishedAfter) {
  const failed = results.filter((r) => r.status === 'FAIL');
  const waiting = results.filter((r) => r.status === 'WAIT');
  console.log('');
  if (failed.length > 0) {
    console.log(`RESULT: FAIL — ${failed.length} check(s) failed. Do not record any proof.`);
    process.exitCode = 1;
    return;
  }
  if (waiting.length > 0) {
    console.log(`RESULT: WAIT — ${waiting.length} check(s) waiting (${waiting.map((r) => r.name).join(', ')}). Re-run after the next hourly sitemap refresh. Do not record any proof yet.`);
    process.exitCode = 1;
    return;
  }
  // All PASS: print the exact SQL for the PARENT to run via the D1 API.
  // This script has no credentials and cannot write to D1 itself.
  const verifiedAt = new Date().toISOString();
  const proof = {
    articleId,
    verifiedAt,
    verdict: 'pass',
    checks: {
      page: 'pass',
      divisionHome: 'pass',
      sitemap: 'pass',
      meta: 'pass',
      // counts = published +1 verified live by this script; the draft
      // -1 is confirmed on the dashboard by the operator before the
      // parent runs the SQL below (see the doc procedure).
      counts: 'pass',
    },
    counts: { publishedBefore: PUBLISHED_BEFORE, publishedAfter: publishedAfter ?? PUBLISHED_BEFORE + 1 },
  };
  const proofJson = JSON.stringify(proof);
  const sqlValue = proofJson.replace(/'/g, "''");
  console.log('RESULT: PASS — all 5 checks passed.');
  console.log('');
  console.log('MANUAL STEP FIRST: confirm on the dashboard (Content Management → Articles, filter Draft)');
  console.log(`that drafts went ${DRAFTS_BEFORE} -> ${DRAFTS_BEFORE - 1}. Only then run this SQL via the D1 API:`);
  console.log('');
  console.log(`INSERT OR REPLACE INTO autonomy_settings (key, value, updated_at) VALUES ('auto_publish_proof', '${sqlValue}', '${verifiedAt}');`);
  console.log('');
  console.log('After the SQL runs, the next daily health report will show autoPublishProof: OK for this article.');
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`Unexpected error: ${String((err && err.message) || err).slice(0, 300)}`);
  process.exitCode = 1;
});
