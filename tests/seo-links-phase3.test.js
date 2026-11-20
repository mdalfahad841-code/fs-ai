// FS AI — Phase 3 Guardian 406 link tests (Priority 4).
//
// Live finding: the Guardian answers HTTP 406 to plain HEAD requests,
// so every Guardian-sourced article failed the SEO broken-links check
// on a healthy link. A link is now CONFIRMED BROKEN only on 404/410
// (+400); 406 (and 401/403/429/5xx/timeout/unreachable) is
// UNVERIFIABLE with the exact reason, retried once with a legitimate
// browser-like User-Agent, and reported as needs-review — never a
// pass, never a confirmed-broken fail.
// Real SQLite database (schema + seed + migrations
// 005/006/008/009/010/011/012). Link checks use stubbed fetches —
// no network in these tests.
// Run: node --test tests/seo-links-phase3.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { classifyLinkStatus, runSeoCheckSuite } = require('../backend/agents/autonomy/seo.js');

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
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertArticle(db, { title, slug, body, divisionId = 1, seoTitle = null, seoDescription = null }) {
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, title, slug, 'Test excerpt for the SEO link checks article.', body, 'FS AI', 'draft', seoTitle, seoDescription);
  return Number(r.lastInsertRowid);
}

const GOOD_TITLE = "EV Charging at Home: A Complete Beginner's Guide";
const GOOD_DESC = 'Charging an electric car at home is usually the cheapest option. This guide covers charger types, costs and installation basics for beginners.';
const GOOD_BODY = [
  '## How home charging works',
  '',
  'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease.',
  '',
  '## Charger types and costs',
  '',
  'A complete beginner guide should explain the two main charger types. A slow charger uses a normal wall outlet and adds range slowly. A faster wall charger needs a dedicated circuit and an electrician to install it safely. The guide below links to a related article for more detail: https://fs-ai-5w5.pages.dev/pages/article?id=12',
  '',
  '## Installation basics',
  '',
  'Ask a qualified electrician to check the home wiring before installing a wall charger. The electrician confirms the circuit can handle the load and fits a safe breaker. Home charging is simple once the charger is installed.',
].join('\n');

const GUARDIAN_URL = 'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide';

describe('classifyLinkStatus', () => {
  it('2xx/3xx is ok; 404/410/400 is broken; everything else is unverifiable', () => {
    assert.equal(classifyLinkStatus(200).classification, 'ok');
    assert.equal(classifyLinkStatus(301).classification, 'ok');
    assert.equal(classifyLinkStatus(404).classification, 'broken');
    assert.equal(classifyLinkStatus(410).classification, 'broken');
    assert.equal(classifyLinkStatus(400).classification, 'broken');
    assert.equal(classifyLinkStatus(406).classification, 'unverifiable');
    assert.match(classifyLinkStatus(406).reason, /406/);
    assert.equal(classifyLinkStatus(401).classification, 'unverifiable');
    assert.equal(classifyLinkStatus(403).classification, 'unverifiable');
    assert.equal(classifyLinkStatus(429).classification, 'unverifiable');
    assert.equal(classifyLinkStatus(500).classification, 'unverifiable');
    assert.equal(classifyLinkStatus(503).classification, 'unverifiable');
    assert.equal(classifyLinkStatus(0, 'timeout').classification, 'unverifiable');
    assert.match(classifyLinkStatus(0, 'timeout').reason, /timed out/);
    assert.equal(classifyLinkStatus(0, 'unreachable').classification, 'unverifiable');
  });
});

describe('runSeoCheckSuite — Guardian 406', () => {
  it('a 406 Guardian link is needs-review, not a failed check (the live bug)', async () => {
    const { db, env } = freshEnv();
    const body = `${GOOD_BODY}\n\nSource: ${GUARDIAN_URL}`;
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-406-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const fetch406 = async (url) => new Response('', { status: String(url).includes('theguardian.com') ? 406 : 200 });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: fetch406 });
    const broken = r.checks.find((c) => c.name === 'broken-links');
    assert.equal(broken.ok, false, 'an unverifiable link is not ok');
    assert.equal(broken.level, 'needs-review', '…but it is needs-review, never a hard fail');
    assert.match(broken.detail, /406/);
    assert.match(broken.detail, /could not be verified/);
    assert.ok(!r.failed.includes('broken-links'), 'the suite verdict must not fail on a 406');
  });

  it('a 406 that answers 200 with a browser User-Agent passes (one retry)', async () => {
    const { db, env } = freshEnv();
    const body = `${GOOD_BODY}\n\nSource: ${GUARDIAN_URL}`;
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-406-retry-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const seen = [];
    const fetchRetry = async (url, opts) => {
      const ua = opts && opts.headers && opts.headers['User-Agent'];
      seen.push({ url, ua: Boolean(ua) });
      if (String(url).includes('theguardian.com') && !ua) return new Response('', { status: 406 });
      return new Response('', { status: 200 });
    };
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: fetchRetry });
    const broken = r.checks.find((c) => c.name === 'broken-links');
    assert.equal(broken.ok, true, 'the retry with a browser UA must clear the link');
    assert.ok(seen.some((s) => s.url.includes('theguardian.com') && !s.ua), 'the plain HEAD attempt must happen first');
    assert.ok(seen.some((s) => s.url.includes('theguardian.com') && s.ua), 'the browser-UA retry must happen');
  });

  it('a 404 is still confirmed broken and still fails the check', async () => {
    const { db, env } = freshEnv();
    const body = `${GOOD_BODY}\n\nSource: https://example.com/dead-link-here`;
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-404-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const deadFetch = async (url) => new Response('', { status: String(url).includes('dead') ? 404 : 200 });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: deadFetch });
    const broken = r.checks.find((c) => c.name === 'broken-links');
    assert.equal(broken.ok, false);
    assert.equal(broken.level, 'failed');
    assert.match(broken.detail, /confirmed broken/);
    assert.ok(r.failed.includes('broken-links'));
  });

  it('a timeout is unverifiable (needs-review), never confirmed broken', async () => {
    const { db, env } = freshEnv();
    const body = `${GOOD_BODY}\n\nSource: https://example.com/slow-link-here`;
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-timeout-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const timeoutFetch = async (url) => {
      if (String(url).includes('slow-link')) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Response('', { status: 200 });
    };
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: timeoutFetch });
    const broken = r.checks.find((c) => c.name === 'broken-links');
    assert.equal(broken.level, 'needs-review');
    assert.match(broken.detail, /timed out/);
    assert.ok(!r.failed.includes('broken-links'));
  });
});
