// FS AI — full-article evidence fetching tests (migration 029).
//
// The fetcher retrieves ONE recorded source page for a draft article,
// extracts its readable text, and stores it as a research_items row
// for that URL, so regeneration (resolveEvidence) and fact-checking
// (loadEvidence) can finally judge against the whole article instead
// of an RSS fragment. Compliance is tested, not assumed: robots.txt
// allow/deny, publisher AI-use terms, paywall/block handling, SSRF
// rejection, size caps, truncation detection, provenance fields.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012/029). The network is stubbed through fetchImpl — no
// test touches the live web. The LLM is stubbed through env.AI where
// a regeneration needs it.
// Run: node --test tests/article-fetch.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  isSafeFetchUrl, parseRobotsTxt, isPathAllowedByRobots, robotsCrawlDelay,
  detectAiUseProhibition, extractArticleText, assessExtraction,
  fetchArticleEvidence, fetchPageText, MIN_EXTRACTION_CHARS,
} = require('../backend/services/article-fetch.js');
const { sha256Hex } = require('../backend/utils/bodyHash.js');
const { checkArticle } = require('../backend/agents/autonomy/factcheck.js');
const { regenerateScaffoldDraft } = require('../backend/agents/autonomy/content.js');
const { runAutonomyTask } = require('../backend/agents/autonomy-runner.js');

const ROOT = path.join(__dirname, '..');

function splitSql(text) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inComment) {
      if (ch === '\n') { inComment = false; cur += ch; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { stmts.push(cur + ch); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.filter((s) => s.trim());
}

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
  }
  return db;
}

function makeRealD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params) => ({
        all: () => Promise.resolve({ results: stmt.all(...params) }),
        first: () => Promise.resolve(stmt.get(...params) || null),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        first: () => bound([]).first(),
        run: () => bound([]).run(),
      };
    },
  };
}

function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
    'database/migrations/029_article_fetch_runs.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, { title, slug, body, divisionId = 8, status = 'draft' }) {
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(divisionId, title, slug, 'test', body, 'FS AI', status);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertResearchItem(db, { title, summary, evidence, url, divisionId = 8, outdated = 0, sourceKind = null, extractionStatus = null }) {
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated, source_kind, content_hash, extraction_status) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(divisionId, title, url, '2026-11-19T10:00:00Z', new Date().toISOString(), summary, evidence, outdated ? 1 : 0, sourceKind || 'rss', null, extractionStatus);
  return Number(r.lastInsertRowid);
}

function addArticleSource(db, articleId, url, researchItemId = null, title = 'Test source') {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, 'research', ?, '2026-11-19T12:00:00Z')",
  ).run(articleId, title, url, researchItemId);
}

/** Stub the Workers AI binding: every model call returns the same text. */
function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

// --- Fixtures ------------------------------------------------------------

// The Guardian's robots.txt header, as probed 2026-11-22: a terms
// statement, not a path rule. The * group does not block /travel/.
const GUARDIAN_ROBOTS = [
  '# Guardian content is made available under our terms and conditions of use.',
  '# Any other uses are not permitted, incl. but not limited to: for large language models (LLMs),',
  '# machine learning and/or artificial intelligence-related purposes; with any of the aforementioned',
  '# technologies; and/or for commercial purposes.',
  'User-agent: *',
  'Disallow: /search',
  'Disallow: /discussion/',
  'Disallow: /user/',
  'Allow: /',
  '',
].join('\n');

// Higher Ed Dive's robots.txt, as probed 2026-11-22: no AI-use
// prohibition, Crawl-delay 5, standard disallows; /news/ is allowed.
const HED_ROBOTS = [
  'User-agent: *',
  'Crawl-delay: 5',
  'Disallow: /admin/',
  'Disallow: /search/',
  'Allow: /',
  '',
].join('\n');

const HED_URL = 'https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/';
const GUARDIAN_AUSTIN_URL = 'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide/';

// Full-article evidence for the M State story (wording invented for
// this test; the facts — summer-2028 closure, ~111 students, board
// vote, November 2026 announcement — are the real ones from the
// Higher Ed Dive source). Long enough to clear the 1000-char
// regeneration floor.
const MSTATE_PARAGRAPHS = [
  'Minnesota State Community and Technical College announced in November 2026 that its Detroit Lakes campus will close in the summer of 2028 as part of a systemwide budget plan.',
  'About 111 students are enrolled at the Detroit Lakes campus, and the board voted to close the campus in the summer of 2028 after reviewing the systemwide budget.',
  'The campus closure was announced in November 2026, and the college said the decision followed a systemwide review of enrolment and costs across its campuses.',
  'Students at the Detroit Lakes campus will be offered help with transfers to other Minnesota State campuses when the campus closes in summer 2028.',
  'The Detroit Lakes campus is one of several Minnesota State campuses affected by the systemwide budget plan, and its closure is scheduled for the summer of 2028.',
  'College leaders said the Detroit Lakes campus, with about 111 students, could no longer be sustained under the current systemwide budget.',
  'The Detroit Lakes campus opened decades ago as a local technical college and later joined the Minnesota State system, serving students from the surrounding lakes region.',
];

function articleHtml({ title, publishedAt, paragraphs, extra = '' }) {
  return '<!doctype html><html><head><title>' + title + '</title>'
    + '<meta property="og:title" content="' + title + '">'
    + (publishedAt ? '<meta property="article:published_time" content="' + publishedAt + '">' : '')
    + '</head><body>'
    + '<header><nav><a href="/">Home</a> <a href="/news">News</a></nav></header>'
    + '<script>var x = 1;</script>'
    + '<aside><p>Advertisement: buy now, limited offer, subscribe today.</p></aside>'
    + '<article class="brief"><h1>' + title + '</h1>'
    + paragraphs.map((p) => '<p>' + p + '</p>').join('')
    + extra
    + '</article>'
    + '<footer><p>Copyright 2026 Example News. All rights reserved.</p></footer>'
    + '</body></html>';
}

const MSTATE_HTML = articleHtml({
  title: 'M State\u2019s Detroit Lakes campus to close amid systemwide budget woes',
  publishedAt: '2026-11-19T17:56:00Z',
  paragraphs: MSTATE_PARAGRAPHS,
});

/** Response-like stub. `routes` is [{ match(url), status, body, location, stream }]. */
function makeFetchImpl(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const r of routes) {
      if (r.match(String(url))) {
        const status = r.status || 200;
        const headers = { get: (name) => (String(name).toLowerCase() === 'location' ? (r.location || null) : null) };
        if (r.stream) {
          const data = new TextEncoder().encode(r.body || '');
          const body = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } });
          return { status, ok: status >= 200 && status < 300, headers, body, text: async () => r.body || '' };
        }
        return { status, ok: status >= 200 && status < 300, headers, body: null, text: async () => r.body || '' };
      }
    }
    return { status: 404, ok: false, headers: { get: () => null }, body: null, text: async () => '' };
  };
  impl.calls = calls;
  return impl;
}

const robotsRoute = (body) => ({ match: (u) => u.endsWith('/robots.txt'), body });
const pageRoute = (url, body, extra = {}) => ({ match: (u) => u === url, body, ...extra });

// --- Pure functions ------------------------------------------------------

describe('isSafeFetchUrl — SSRF protection', () => {
  it('allows a plain https article URL', () => {
    assert.deepEqual(isSafeFetchUrl(HED_URL), { ok: true });
  });

  it('rejects non-https schemes, credentials, and private targets', () => {
    assert.equal(isSafeFetchUrl('http://example.com/page').ok, false);
    assert.equal(isSafeFetchUrl('http://example.com/page').reason, 'not-https');
    assert.equal(isSafeFetchUrl('ftp://example.com/page').ok, false);
    assert.equal(isSafeFetchUrl('file:///etc/passwd').ok, false);
    assert.equal(isSafeFetchUrl('https://user:pass@example.com/page').reason, 'credentials-in-url');
    assert.equal(isSafeFetchUrl('https://localhost/page').reason, 'blocked-host');
    assert.equal(isSafeFetchUrl('https://127.0.0.1/page').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://10.0.0.5/page').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://192.168.1.1/page').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://172.16.0.9/page').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://169.254.169.254/latest/meta-data/').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://[::1]/page').reason, 'private-ip');
    assert.equal(isSafeFetchUrl('https://metadata.google.internal/').reason, 'blocked-host');
    assert.equal(isSafeFetchUrl('https://intranet.local/page').reason, 'blocked-host');
    assert.equal(isSafeFetchUrl('not a url').reason, 'invalid-url');
  });
});

describe('robots.txt — parse, allow/deny, crawl-delay', () => {
  it('allows the Guardian travel path, blocks /search and /discussion/', () => {
    const robots = parseRobotsTxt(GUARDIAN_ROBOTS);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/travel/2024/apr/26/austin-texas-three-day-travel-guide/'), true);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/search?q=austin'), false);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/discussion/p/abc'), false);
    assert.equal(robotsCrawlDelay(robots, 'FS-AI-Research/1.0'), null);
  });

  it('reads Higher Ed Dive crawl-delay 5 and allows /news/, blocks /admin/', () => {
    const robots = parseRobotsTxt(HED_ROBOTS);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/'), true);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/admin/login'), false);
    assert.equal(robotsCrawlDelay(robots, 'FS-AI-Research/1.0'), 5);
  });

  it('honours wildcards, $ anchors, and Allow-beats-Disallow on ties', () => {
    const robots = parseRobotsTxt([
      'User-agent: *',
      'Disallow: /private/*',
      'Allow: /private/public$',
      'Disallow: /tmp$',
    ].join('\n'));
    assert.equal(isPathAllowedByRobots(robots, 'x', '/private/public'), true);
    assert.equal(isPathAllowedByRobots(robots, 'x', '/private/secret'), false);
    assert.equal(isPathAllowedByRobots(robots, 'x', '/tmp'), false);
    assert.equal(isPathAllowedByRobots(robots, 'x', '/tmp/x'), true);
  });

  it('prefers an exact user-agent group over the * group', () => {
    const robots = parseRobotsTxt([
      'User-agent: *',
      'Disallow: /',
      'User-agent: FS-AI-Research',
      'Allow: /news/',
      'Disallow: /admin/',
    ].join('\n'));
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/news/x'), true);
    assert.equal(isPathAllowedByRobots(robots, 'FS-AI-Research/1.0', '/admin/x'), false);
    assert.equal(isPathAllowedByRobots(robots, 'OtherBot/1.0', '/news/x'), false);
  });
});

describe('detectAiUseProhibition — publisher AI-use terms', () => {
  it('flags the Guardian terms statement', () => {
    assert.equal(detectAiUseProhibition(GUARDIAN_ROBOTS), true);
  });

  it('does not flag Higher Ed Dive or a plain robots file', () => {
    assert.equal(detectAiUseProhibition(HED_ROBOTS), false);
    assert.equal(detectAiUseProhibition('User-agent: *\nDisallow: /admin/\n'), false);
    assert.equal(detectAiUseProhibition(''), false);
  });
});

describe('extractArticleText + assessExtraction', () => {
  it('extracts the article body only — no nav, aside, script, or footer', () => {
    const out = extractArticleText(MSTATE_HTML, HED_URL);
    assert.equal(out.title, 'M State\u2019s Detroit Lakes campus to close amid systemwide budget woes');
    assert.equal(out.publishedAt, '2026-11-19T17:56:00.000Z');
    assert.equal(out.paragraphs, MSTATE_PARAGRAPHS.length);
    for (const p of MSTATE_PARAGRAPHS) assert.ok(out.text.includes(p.slice(0, 60)), 'paragraph kept');
    assert.equal(out.text.includes('Advertisement'), false);
    assert.equal(out.text.includes('Copyright 2026'), false);
    assert.equal(out.text.includes('var x = 1'), false);
    assert.ok(out.text.length > 1000, 'evidence clears the 1000-char floor');
    assert.deepEqual(assessExtraction({ title: out.title, text: out.text, html: MSTATE_HTML }), { status: 'ok', reasons: [] });
  });

  it('decodes entities and reads published_at from JSON-LD', () => {
    const html = '<html><head><title>Fish &amp; Chips</title>'
      + '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-11-19T17:56:00"}</script>'
      + '</head><body><article><h1>Fish &amp; Chips</h1>'
      + '<p>' + 'A'.repeat(120) + ' &amp; more text here for the test fixture.</p>'
      + '<p>' + 'B'.repeat(120) + ' continues with enough words to pass.</p>'
      + '</article></body></html>';
    const out = extractArticleText(html, 'https://example.com/x');
    assert.equal(out.title, 'Fish & Chips');
    assert.equal(out.publishedAt, '2026-11-19T17:56:00.000Z');
    assert.ok(out.text.includes('Fish & Chips') === false, 'title is not duplicated into the body');
    assert.ok(out.text.includes('& more text'), 'entity decoded');
  });

  it('flags too-short, missing-title, mid-sentence and paywall text as incomplete', () => {
    const long = 'x'.repeat(300);
    assert.deepEqual(assessExtraction({ title: 'T', text: 'Short.', html: '' }).status, 'incomplete');
    assert.deepEqual(assessExtraction({ title: null, text: long + '.', html: '' }).reasons, ['missing-title']);
    assert.deepEqual(assessExtraction({ title: 'T', text: long + ' and then', html: '' }).reasons, ['ends-mid-sentence']);
    assert.deepEqual(assessExtraction({ title: 'T', text: long + ' Subscribe to continue reading the full story.', html: '' }).reasons, ['paywall-markers']);
    assert.deepEqual(assessExtraction({ title: 'T', text: long + '…', html: '' }).reasons, ['ends-mid-sentence']);
    assert.deepEqual(assessExtraction({ title: 'T', text: '', html: '' }).reasons, ['empty-body']);
  });

  it('prefers the <article> container over <body> — related stories and promos outside it are excluded', () => {
    const bodyParas = [
      'Minnesota State Community and Technical College announced in November 2026 that its Detroit Lakes campus will close in the summer of 2028 as part of a systemwide budget plan.',
      'About 111 students are enrolled at the Detroit Lakes campus, and the board voted to close the campus in the summer of 2028 after reviewing the systemwide budget.',
      'The campus closure was announced in November 2026, and the college said the decision followed a systemwide review of enrolment and costs across its campuses.',
      'Students at the Detroit Lakes campus will be offered help with transfers to other Minnesota State campuses when the campus closes in summer 2028.',
      'The Detroit Lakes campus is one of several Minnesota State campuses affected by the systemwide budget plan, and its closure is scheduled for the summer of 2028.',
      'College leaders said the Detroit Lakes campus, with about 111 students, could no longer be sustained under the current systemwide budget.',
    ];
    const html = '<html><head><title>M State Detroit Lakes closure</title></head><body>'
      + '<article class="brief"><h1>M State Detroit Lakes closure</h1>'
      + bodyParas.map((p) => '<p>' + p + '</p>').join('')
      + '</article>'
      + '<div class="related"><h2>Editors\' picks</h2>'
      + '<p>Senate appropriations committee proposes $15B in additional Pell Grant funding By Laura Spitalniak</p>'
      + '<p>PASSHE moves to close Commonwealth University\u2019s Mansfield campus By Ben Unglesbee</p></div>'
      + '<div class="newsletter"><p>Higher Ed Dive news delivered to your inbox</p><p>Get the free daily newsletter read by industry experts</p></div>'
      + '</body></html>';
    const out = extractArticleText(html, HED_URL);
    assert.equal(out.paragraphs, bodyParas.length);
    for (const p of bodyParas) assert.ok(out.text.includes(p.slice(0, 50)));
    assert.equal(out.text.includes('Senate appropriations committee'), false, 'related-story teaser excluded');
    assert.equal(out.text.includes('PASSHE moves to close'), false, 'related-story teaser excluded');
    assert.equal(out.text.includes('delivered to your inbox'), false, 'newsletter promo excluded');
    assert.equal(out.text.includes('Editors\' picks'), false, 'section label outside the article excluded');
    assert.ok(out.text.endsWith('.'), 'extracted text ends with terminal punctuation');
    assert.deepEqual(assessExtraction({ title: out.title, text: out.text, html }), { status: 'ok', reasons: [] });
  });

  it('drops byline teasers even when they sit inside the <article> element', () => {
    const html = '<html><head><title>Test article</title></head><body><article>'
      + '<p>' + 'A'.repeat(150) + ' first body paragraph with enough words to pass the checks.</p>'
      + '<p>' + 'B'.repeat(150) + ' second body paragraph with enough words to pass the checks.</p>'
      + '<p>' + 'C'.repeat(150) + ' third body paragraph with enough words to pass the checks.</p>'
      + '<p>Some other story headline worth reading By Jane Smith</p>'
      + '<p>By Jane Smith \u2022 Sept. 25, 2026</p>'
      + '</article></body></html>';
    const out = extractArticleText(html, 'https://example.com/x');
    assert.equal(out.paragraphs, 3);
    assert.equal(out.text.includes('By Jane Smith'), false);
  });

  it('reports a JS-rendered page (almost no <p> text) as incomplete, not faked', () => {
    const dcr = '<html><head><title>Austin guide</title></head><body>'
      + '<div id="app"><script>window.__DCR__ = {"blocks":[]};</script></div>'
      + '<p>Barton Springs</p><p>Food trucks</p>'
      + '</body></html>';
    const out = extractArticleText(dcr, GUARDIAN_AUSTIN_URL);
    const a = assessExtraction({ title: out.title, text: out.text, html: dcr });
    assert.equal(a.status, 'incomplete', 'a JS-rendered page extracts almost nothing');
    assert.ok(out.text.length < MIN_EXTRACTION_CHARS);
    assert.ok(a.reasons.includes('empty-body') || a.reasons.some((r) => r.startsWith('too-short')));
  });
});

// --- Full flow -----------------------------------------------------------

describe('fetchArticleEvidence — happy path (Higher Ed Dive)', () => {
  it('stores the full text as a current research item and re-points the source', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([
      robotsRoute(HED_ROBOTS),
      pageRoute(HED_URL, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'done');
    assert.equal(r.articleId, id);
    assert.ok(r.researchItemId, 'research item id returned');
    assert.ok(r.extractedChars > 1000, 'extracted chars clear the floor');
    assert.equal(r.robotsAllowed, true);
    assert.equal(r.crawlDelay, 5);
    assert.equal(r.publishedAt, '2026-11-19T17:56:00.000Z');
    assert.equal(r.httpStatus, 200);
    const item = db.prepare('SELECT * FROM research_items WHERE id = ?').get(r.researchItemId);
    assert.equal(item.url, HED_URL);
    assert.equal(item.source_kind, 'article-fetch');
    assert.equal(item.extraction_status, 'ok');
    assert.equal(item.is_outdated, 0);
    assert.equal(item.content_hash, await sha256Hex(item.evidence_text));
    assert.equal(item.evidence_text.length, r.extractedChars);
    assert.ok(item.evidence_text.includes('About 111 students are enrolled at the Detroit Lakes campus'));
    assert.equal(item.published_at, '2026-11-19T17:56:00.000Z');
    const src = db.prepare('SELECT research_item_id FROM article_sources WHERE article_id = ?').get(id);
    assert.equal(src.research_item_id, r.researchItemId, 'source row re-pointed at the fetched item');
    const run = db.prepare('SELECT * FROM article_fetch_runs WHERE article_id = ?').get(id);
    assert.equal(run.extraction_status, 'ok');
    assert.equal(run.http_status, 200);
    assert.equal(run.robots_allowed, 1);
    assert.equal(run.robots_crawl_delay_seconds, 5);
    assert.equal(run.extracted_chars, r.extractedChars);
    assert.equal(run.content_hash, r.contentHash);
    assert.equal(run.research_item_id, r.researchItemId);
    assert.ok(run.fetched_at, 'retrieval time recorded');
  });

  it('defaults to the article first recorded source when no URL is given', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const r = await fetchArticleEvidence(env, { articleId: id, fetchImpl });
    assert.equal(r.outcome, 'done');
    assert.equal(r.url, HED_URL);
  });

  it('follows a redirect and records the final URL, keeping the recorded URL as the evidence key', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const finalUrl = 'https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/?utm=1';
    const fetchImpl = makeFetchImpl([
      robotsRoute(HED_ROBOTS),
      { match: (u) => u === HED_URL, status: 301, location: finalUrl, body: '' },
      pageRoute(finalUrl, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'done');
    assert.equal(r.url, HED_URL, 'evidence key stays the recorded URL');
    assert.equal(r.finalUrl, finalUrl);
  });
});

describe('fetchArticleEvidence — refusals (no fetch, no evidence stored)', () => {
  it('refuses a Guardian URL on the publisher AI-use terms — robots only, never the page', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Austin three-day guide', slug: 'austin-three-day-guide', body: 'SCAFFOLD — full draft needed.' });
    addArticleSource(db, id, GUARDIAN_AUSTIN_URL, null, 'The Guardian');
    const fetchImpl = makeFetchImpl([
      robotsRoute(GUARDIAN_ROBOTS),
      pageRoute(GUARDIAN_AUSTIN_URL, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url: GUARDIAN_AUSTIN_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /terms-prohibit-ai-use/);
    assert.deepEqual(fetchImpl.calls, ['https://www.theguardian.com/robots.txt'], 'the article page was never requested');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 0);
    const run = db.prepare('SELECT * FROM article_fetch_runs WHERE article_id = ?').get(id);
    assert.equal(run.extraction_status, 'failed');
    assert.match(run.extraction_reason, /terms-prohibit-ai-use/);
    assert.equal(run.research_item_id, null);
  });

  it('refuses a robots-disallowed path without fetching the page', async () => {
    const { db, env } = freshEnv();
    const url = 'https://example.com/admin/secret-guide';
    const id = insertArticle(db, { title: 'Secret guide', slug: 'secret-guide', body: 'x'.repeat(50) });
    addArticleSource(db, id, url, null, 'Example');
    const fetchImpl = makeFetchImpl([
      robotsRoute('User-agent: *\nDisallow: /admin/\nAllow: /\n'),
      pageRoute(url, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /robots-denied/);
    assert.equal(fetchImpl.calls.some((c) => c === url), false);
  });

  it('fails closed when robots.txt cannot be fetched', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([
      { match: (u) => u.endsWith('/robots.txt'), status: 500, body: '' },
      pageRoute(HED_URL, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'failed');
    assert.match(r.error, /robots\.txt could not be fetched/);
    assert.equal(fetchImpl.calls.some((c) => c === HED_URL), false, 'never fetched blind');
  });

  it('allows a fetch when robots.txt is missing (404 = no file)', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([
      { match: (u) => u.endsWith('/robots.txt'), status: 404, body: '' },
      pageRoute(HED_URL, MSTATE_HTML),
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'done');
  });

  it('refuses a URL that is not a recorded source for the article', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute('https://example.com/evil', MSTATE_HTML)]);
    const r = await fetchArticleEvidence(env, { url: 'https://example.com/evil', articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /not a recorded source/);
    assert.equal(fetchImpl.calls.length, 0, 'no network at all');
  });

  it('refuses a recorded source that fails SSRF validation — never fetched', async () => {
    const { db, env } = freshEnv();
    const bad = 'https://127.0.0.1/secret-guide';
    const id = insertArticle(db, { title: 'Bad source', slug: 'bad-source', body: 'x'.repeat(50) });
    addArticleSource(db, id, bad, null, 'Bad');
    const fetchImpl = makeFetchImpl([robotsRoute('User-agent: *\nAllow: /\n'), pageRoute(bad, MSTATE_HTML)]);
    const r = await fetchArticleEvidence(env, { url: bad, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /private-ip/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('refuses a published article — evidence is only fetched for drafts', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Published', slug: 'published', body: 'x'.repeat(50), status: 'published' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /only fetched for drafts/);
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe('fetchArticleEvidence — HTTP and extraction failures', () => {
  it('records a paywall page as incomplete and stores no evidence', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const paywallHtml = articleHtml({
      title: 'M State\u2019s Detroit Lakes campus to close amid systemwide budget woes',
      publishedAt: '2026-11-19T17:56:00Z',
      paragraphs: ['Minnesota State Community and Technical College announced that its Detroit Lakes campus will close. Subscribe to continue reading the full story and get unlimited access to our reporting.'],
    });
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, paywallHtml)]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /extraction-incomplete/);
    assert.match(r.reason, /paywall-markers/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 0, 'no evidence row for a paywall page');
    const run = db.prepare('SELECT * FROM article_fetch_runs WHERE article_id = ?').get(id);
    assert.equal(run.extraction_status, 'incomplete');
  });

  it('records a truncated page as incomplete and stores no evidence', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const thinHtml = articleHtml({
      title: 'M State\u2019s Detroit Lakes campus to close amid systemwide budget woes',
      publishedAt: '2026-11-19T17:56:00Z',
      paragraphs: ['M State\u2019s Detroit Lakes campus to close amid systemwide budget woes'],
    });
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, thinHtml)]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /too-short/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 0);
  });

  it('returns no-op for 404 — not retried, never worked around', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetch404 = makeFetchImpl([robotsRoute(HED_ROBOTS), { match: (u) => u === HED_URL, status: 404, body: '' }]);
    const r404 = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl: fetch404 });
    assert.equal(r404.outcome, 'no-op');
    assert.match(r404.reason, /http-404/);
    assert.equal(fetch404.calls.filter((c) => c === HED_URL).length, 1, '404 is not retried');
  });

  it('returns no-op for a 403 block — treated as paywall/block, not retried', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetch403 = makeFetchImpl([robotsRoute(HED_ROBOTS), { match: (u) => u === HED_URL, status: 403, body: '' }]);
    const r403 = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl: fetch403 });
    assert.equal(r403.outcome, 'no-op');
    assert.match(r403.reason, /paywall-or-blocked/);
    assert.equal(fetch403.calls.filter((c) => c === HED_URL).length, 1, '403 is not retried');
  });

  it('retries a transient 500 once, then succeeds; a persistent 500 fails', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    let hits = 0;
    const flaky = makeFetchImpl([
      robotsRoute(HED_ROBOTS),
      {
        match: (u) => u === HED_URL,
        status: 200,
        body: MSTATE_HTML,
      },
    ]);
    const flakyImpl = async (url) => {
      if (String(url) === HED_URL) {
        hits += 1;
        if (hits === 1) return { status: 500, ok: false, headers: { get: () => null }, body: null, text: async () => '' };
      }
      return flaky(url);
    };
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl: flakyImpl });
    assert.equal(r.outcome, 'done');
    assert.equal(r.attempts, 2);
    assert.equal(hits, 2);
    const always500 = makeFetchImpl([
      robotsRoute('User-agent: *\nAllow: /\n'),
      { match: (u) => u === 'https://example.com/guide-2', status: 500, body: '' },
    ]);
    const id2 = insertArticle(db, { title: 'Second', slug: 'second', body: 'x'.repeat(50) });
    addArticleSource(db, id2, 'https://example.com/guide-2', null, 'Example');
    const r2 = await fetchArticleEvidence(env, { url: 'https://example.com/guide-2', articleId: id2, fetchImpl: always500 });
    assert.equal(r2.outcome, 'failed');
    assert.match(r2.error, /http-500/);
    assert.equal(always500.calls.filter((c) => c === 'https://example.com/guide-2').length, 2, 'bounded retries: 2 attempts, no more');
  });

  it('enforces the 2 MB page cap on a streamed body', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Big page', slug: 'big-page', body: 'x'.repeat(50) });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const huge = 'x'.repeat(2_100_000);
    const fetchImpl = makeFetchImpl([
      robotsRoute(HED_ROBOTS),
      { match: (u) => u === HED_URL, status: 200, body: huge, stream: true },
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'failed');
    assert.match(r.error, /exceeds the 2000000-byte fetch cap/);
  });

  it('enforces the redirect limit', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Loop', slug: 'loop', body: 'x'.repeat(50) });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const loop = makeFetchImpl([
      robotsRoute(HED_ROBOTS),
      { match: () => true, status: 301, location: HED_URL, body: '' },
    ]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl: loop });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /too-many-redirects/);
  });

  it('throttles a second fetch to the same host inside the minimum interval', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const first = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(first.outcome, 'done');
    const id2 = insertArticle(db, { title: 'Second', slug: 'second', body: 'x'.repeat(50) });
    addArticleSource(db, id2, HED_URL, null, 'Higher Ed Dive');
    const second = await fetchArticleEvidence(env, { url: HED_URL, articleId: id2, fetchImpl });
    assert.equal(second.outcome, 'no-op');
    assert.match(second.reason, /rate-limited/);
  });

  it('skips a re-fetch when a complete fetch for the URL already exists', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    insertResearchItem(db, {
      title: 'M State Detroit Lakes campus to close',
      summary: MSTATE_PARAGRAPHS[0].slice(0, 200),
      evidence: MSTATE_PARAGRAPHS.join('\n\n'),
      url: HED_URL, sourceKind: 'article-fetch', extractionStatus: 'ok',
    });
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const r = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /already-current/);
    assert.equal(fetchImpl.calls.some((c) => c === HED_URL), false, 'the page was not re-fetched');
  });
});

// --- Integration with the existing pipeline -------------------------------

describe('fetchArticleEvidence -> regeneration (the #29 fix, end to end)', () => {
  it('fetched evidence clears the 1000-char floor and the scaffold regenerates', async () => {
    const { db, env } = freshEnv();
    const scaffold = [
      'SCAFFOLD — full draft needed.',
      '',
      'This draft was created from an agent scaffold. No article body was fabricated: the owner (or an LLM) must write the full body.',
      '',
      '## Introduction\n\n[Write this section — no content yet.]',
      '## Getting there\n\n[Write this section — no content yet.]',
      '## What to see\n\n[Write this section — no content yet.]',
      '## Food and costs\n\n[Write this section — no content yet.]',
      '## Conclusion\n\n[Write this section — no content yet.]',
      '',
      'Sources:',
      '- ' + HED_URL,
    ].join('\n');
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: scaffold });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    // Before the fetch, the scaffold cannot regenerate: no evidence.
    const before = await regenerateScaffoldDraft(env, id);
    assert.notEqual(before.outcome, 'done');
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const fetched = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(fetched.outcome, 'done');
    assert.ok(fetched.extractedChars >= 1000);
    const canned = '## Introduction\n\nMinnesota State Community and Technical College announced in November 2026 that its Detroit Lakes campus will close in the summer of 2028.\n\n## Getting there\n\nThe Detroit Lakes campus serves students from the surrounding lakes region.\n\n## What to see\n\nAbout 111 students are enrolled at the Detroit Lakes campus.\n\n## Food and costs\n\nThe closure follows a systemwide review of enrolment and costs.\n\n## Conclusion\n\nStudents will be offered help with transfers to other Minnesota State campuses.';
    stubAi(env, canned);
    const regen = await regenerateScaffoldDraft(env, id);
    assert.equal(regen.outcome, 'done');
    const after = loadArticle(db, id);
    // The handler wraps the LLM body with the AI-DRAFT header and a
    // Sources section — assert the scaffold is gone and the LLM body
    // is in place, not byte-equality with the stub.
    assert.equal(after.body.includes('SCAFFOLD'), false, 'scaffold marker gone');
    assert.ok(after.body.includes('Minnesota State Community and Technical College announced in November 2026'));
    assert.ok(after.body.includes('About 111 students are enrolled at the Detroit Lakes campus'));
    assert.ok(after.body.includes(HED_URL), 'sources section kept');
    assert.equal(after.status, 'draft');
  });

  it('an incomplete fetch leaves the scaffold blocked — no fabricated regeneration', async () => {
    const { db, env } = freshEnv();
    const scaffold = 'SCAFFOLD — full draft needed.\n\n## Introduction\n\n[Write this section — no content yet.]';
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: scaffold });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    const thinHtml = articleHtml({
      title: 'M State\u2019s Detroit Lakes campus to close amid systemwide budget woes',
      publishedAt: '2026-11-19T17:56:00Z',
      paragraphs: ['M State\u2019s Detroit Lakes campus to close amid systemwide budget woes'],
    });
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, thinHtml)]);
    const fetched = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(fetched.outcome, 'no-op');
    stubAi(env, '## Introduction\n\nInvented body that must never be used.');
    const regen = await regenerateScaffoldDraft(env, id);
    assert.notEqual(regen.outcome, 'done');
    assert.equal(loadArticle(db, id).body, scaffold, 'scaffold untouched');
  });

  it('the dashboard task shape (research / article-fetch) dispatches through the runner', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body: 'M State will close its Detroit Lakes campus in summer 2028.' });
    addArticleSource(db, id, HED_URL, null, 'Higher Ed Dive');
    // The runner uses the global fetch — stub it for this test only.
    const realFetch = globalThis.fetch;
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    globalThis.fetch = fetchImpl;
    try {
      const r = await runAutonomyTask({ agent: 'research', kind: 'article-fetch', payload: { article_id: id } }, env);
      assert.equal(r.outcome, 'done');
      assert.equal(r.agent, 'research');
      assert.ok(r.researchItemId);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('fetchArticleEvidence -> fact-check (a claim flips UNSUPPORTED to VERIFIED)', () => {
  it('the fetched item enters the evidence pool and the re-check verifies the claims', async () => {
    const { db, env } = freshEnv();
    const body = [
      'M State will close its Detroit Lakes campus in summer 2028, affecting about 111 students enrolled at the campus, after the board reviewed enrolment and costs across the Minnesota State system.',
      'The board voted to close the campus as part of a systemwide budget plan.',
      'The campus closure was announced in November 2026, after a systemwide review of enrolment and costs across its campuses, and students will be offered help with transfers to other Minnesota State campuses.',
      'The Detroit Lakes campus is one of several Minnesota State campuses affected by the systemwide budget plan, and its closure is scheduled for the summer of 2028.',
    ].join(' ');
    const id = insertArticle(db, { title: 'M State Detroit Lakes closure', slug: 'm-state-detroit-lakes-closure', body });
    // The old evidence: a single short fragment that supports none of
    // the three claims (the live #33 shape before this feature).
    const fragmentId = insertResearchItem(db, {
      title: 'M State Detroit Lakes campus to close',
      summary: 'The system faces budget challenges.',
      evidence: 'The system faces budget challenges.',
      url: HED_URL,
    });
    addArticleSource(db, id, HED_URL, fragmentId, 'Higher Ed Dive');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.claimsVerified, 0, 'no claim is verifiable on the fragment');
    assert.equal(first.verdict, 'needs-review');
    // Fetch the full article, then re-check: the same claims, now
    // judged against the complete text. (extractClaims does not
    // extract every sentence as a claim; the flip is judged on the
    // claims it does extract.)
    const fetchImpl = makeFetchImpl([robotsRoute(HED_ROBOTS), pageRoute(HED_URL, MSTATE_HTML)]);
    const fetched = await fetchArticleEvidence(env, { url: HED_URL, articleId: id, fetchImpl });
    assert.equal(fetched.outcome, 'done');
    const second = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.ok(second.claimsTotal >= 2, 'claims were extracted');
    assert.equal(second.claimsVerified, second.claimsTotal, 'every extracted claim verifies against the fetched evidence');
    assert.equal(second.verdict, 'pass');
    const detroit = db.prepare(
      "SELECT verdict FROM claim_checks WHERE fact_check_id = ? AND claim_text LIKE '%Detroit Lakes%'",
    ).get(second.factCheckId || second.id);
    if (detroit) assert.equal(detroit.verdict, 'VERIFIED');
  });
});

describe('fetchPageText — redirects and caps', () => {
  it('refuses a redirect chain that exceeds the limit and a downgrade to http', async () => {
    const loop = makeFetchImpl([{ match: () => true, status: 301, location: HED_URL, body: '' }]);
    const r = await fetchPageText(HED_URL, { fetchImpl: loop });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'too-many-redirects');
    const downgrade = makeFetchImpl([
      { match: (u) => u === HED_URL, status: 301, location: 'http://example.com/page', body: '' },
    ]);
    const r2 = await fetchPageText(HED_URL, { fetchImpl: downgrade });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, 'not-https');
  });
});

describe('migration 029 — applies cleanly after 001–028', () => {
  it('the full migration chain builds and the new objects exist', () => {
    // Migrations only (no schema.sql): schema.sql is the current full
    // schema and already contains columns some early migrations add
    // (004 fails on publish_at after schema.sql) — the deploy chain
    // is the migration files in order, as the live D1 was built.
    const files = [];
    const migrationFiles = fs.readdirSync(path.join(ROOT, 'database/migrations'))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort()
      .map((f) => 'database/migrations/' + f);
    assert.equal(migrationFiles.length, 32, 'migrations 001–032 all present');
    files.push(...migrationFiles);
    const db = buildDb(files);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'article_fetch_runs'").get();
    assert.ok(table, 'article_fetch_runs exists after the full chain');
    const cols = db.prepare('PRAGMA table_info(research_items)').all().map((c) => c.name);
    assert.ok(cols.includes('source_kind'), 'research_items.source_kind exists');
    assert.ok(cols.includes('content_hash'), 'research_items.content_hash exists');
    assert.ok(cols.includes('extraction_status'), 'research_items.extraction_status exists');
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_fetch_runs_%'").all();
    assert.equal(idx.length, 3, 'three fetch-runs indexes');
  });
});
