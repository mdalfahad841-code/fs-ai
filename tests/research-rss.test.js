// FS AI — RSS research engine tests.
//
// The RSS/Atom parser, the fetch wrapper, D1-backed source storage and
// the division research-agent pause mapping, against a REAL SQLite
// database (schema + seed + migrations 005/006/008/009/010/011/012).
// No test here touches the network: fetch is always stubbed with canned
// XML. The 24 seeded sources themselves were verified live by curl on
// 2026-11-19 (see docs/AUTONOMY-MASTER-2026-11-19.md); these tests pin
// the code that reads them.
//
// Run: node --test tests/research-rss.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  parseFeedXml, isOutdated, normalizeTitle, fetchFeed,
} = require('../backend/rss/rss.js');
const {
  loadEnabledSources, loadAllSources, fetchSource, fetchAllEnabledSources,
} = require('../backend/rss/sources.js');
const {
  DIVISION_RESEARCH_REGISTRY, registryIdForTask,
} = require('../backend/agents/autonomy-runner.js');

const ROOT = path.join(__dirname, '..');

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>Test Feed Item Alpha One</title><link>https://example.com/alpha</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Alpha item summary text here.</description></item>
<item><title><![CDATA[Test Feed Item Beta &amp; Friends]]></title><link>https://example.com/beta</link><pubDate>Mon, 10 Nov 2026 08:00:00 GMT</pubDate><description>Beta tips to cut costs &amp; drive smarter.</description></item>
<item><title>Test Feed Item Gamma Old</title><link>https://example.com/gamma</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate><description>Stale item from 2020.</description></item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Test Atom Item Delta</title><link rel="alternate" href="https://example.com/delta"/><published>2026-11-18T09:00:00Z</published><summary>A new model does more with less.</summary></entry>
</feed>`;

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

function stubFetch(xml, { status = 200 } = {}) {
  return async () => new Response(xml, { status, headers: { 'content-type': 'application/rss+xml' } });
}

describe('RSS/Atom parsing', () => {
  it('parses RSS items with CDATA, entities, pubDate and summary', () => {
    const r = parseFeedXml(RSS_SAMPLE);
    assert.equal(r.feedType, 'rss');
    assert.equal(r.error, null);
    assert.equal(r.items.length, 3);
    assert.equal(r.items[0].title, 'Test Feed Item Alpha One');
    assert.equal(r.items[0].url, 'https://example.com/alpha');
    assert.equal(r.items[0].publishedAt, 'Wed, 19 Nov 2026 10:00:00 GMT');
    assert.match(r.items[0].summary, /Alpha item summary/);
    assert.equal(r.items[1].title, 'Test Feed Item Beta & Friends', 'CDATA + entity decoded');
    assert.match(r.items[1].summary, /cut costs & drive smarter/);
  });

  it('parses Atom entries with link href, published and summary', () => {
    const r = parseFeedXml(ATOM_SAMPLE);
    assert.equal(r.feedType, 'atom');
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].title, 'Test Atom Item Delta');
    assert.equal(r.items[0].url, 'https://example.com/delta');
    assert.equal(r.items[0].publishedAt, '2026-11-18T09:00:00Z');
  });

  it('rejects non-feed XML and empty input', () => {
    assert.equal(parseFeedXml('<html><body>not a feed</body></html>').error, 'not-a-feed');
    assert.equal(parseFeedXml('').error, 'not-a-feed');
    assert.equal(parseFeedXml(null).error, 'not-a-feed');
  });

  it('outdated detection: >1 year old is outdated, recent is not, garbage is not', () => {
    const now = new Date('2026-11-19T12:00:00Z').getTime();
    assert.equal(isOutdated('Wed, 01 Jan 2020 00:00:00 GMT', now), true);
    assert.equal(isOutdated('2026-11-18T09:00:00Z', now), false);
    assert.equal(isOutdated(null, now), false);
    assert.equal(isOutdated('not a date', now), false);
  });

  it('normalizeTitle lower-cases and strips punctuation for dedupe', () => {
    assert.equal(normalizeTitle('Hello, World!  Test'), 'hello world test');
    assert.equal(normalizeTitle('EV Charging at Home'), normalizeTitle('ev charging at home'));
  });
});

describe('fetchFeed (stubbed fetch)', () => {
  it('returns parsed items on HTTP 200', async () => {
    const r = await fetchFeed('https://example.com/feed.xml', { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.feedType, 'rss');
    assert.equal(r.items.length, 3);
  });

  it('reports http errors, non-https and invalid URLs honestly', async () => {
    const notFound = await fetchFeed('https://example.com/feed.xml', { fetchImpl: stubFetch('nope', { status: 404 }) });
    assert.equal(notFound.ok, false);
    assert.equal(notFound.error, 'http-404');
    const http = await fetchFeed('http://example.com/feed.xml', { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(http.error, 'not-https');
    const bad = await fetchFeed('not a url', { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(bad.error, 'invalid-url');
    const html = await fetchFeed('https://example.com/', { fetchImpl: stubFetch('<html>hi</html>') });
    assert.equal(html.error, 'not-a-feed');
  });

  it('reports timeouts and network failures distinctly', async () => {
    const timeoutErr = new Error('aborted');
    timeoutErr.name = 'AbortError';
    const timeout = await fetchFeed('https://example.com/feed.xml', { fetchImpl: async () => { throw timeoutErr; } });
    assert.equal(timeout.error, 'timeout');
    const network = await fetchFeed('https://example.com/feed.xml', { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.equal(network.error, 'network');
  });
});

describe('research sources in D1', () => {
  it('seeds 24 verified sources, 3 per division', async () => {
    const { env } = freshEnv();
    const all = await loadAllSources(env);
    assert.equal(all.length, 24);
    const perDivision = {};
    for (const s of all) perDivision[s.division] = (perDivision[s.division] || 0) + 1;
    assert.deepEqual(Object.keys(perDivision).sort(), [
      'ai-technology', 'automotive', 'digital-tools', 'education-learning',
      'finance-money', 'gadgets-electronics', 'health-wellness', 'travel-lifestyle',
    ]);
    for (const n of Object.values(perDivision)) assert.equal(n, 3);
    const auto = await loadEnabledSources(env, 'automotive');
    assert.equal(auto.length, 3);
    assert.ok(auto.every((s) => s.url.startsWith('https://')));
  });

  it('fetchSource stores new items, flags outdated, dedupes on re-fetch, updates health', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Test Feed', 'https://example.com/test-feed.xml', 'rss')").run();
    const source = db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = 'https://example.com/test-feed.xml'").get();
    const first = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(first.ok, true);
    assert.equal(first.fetched, 3);
    assert.equal(first.added, 3);
    assert.equal(first.duplicates, 0);
    assert.equal(first.outdated, 1, 'the 2020 item is flagged outdated');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_items WHERE is_outdated = 1").get().n, 1);
    const row = db.prepare("SELECT * FROM research_sources WHERE id = ?").get(source.id);
    assert.equal(row.last_status, 'ok');
    assert.equal(row.items_discovered, 3);
    assert.ok(row.last_fetched_at, 'last fetch recorded');

    const second = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(second.added, 0, 'nothing new on re-fetch');
    assert.equal(second.duplicates, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3, 'no duplicate rows stored');
  });

  it('fetchSource dedupes against existing article titles', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (1, 'Test Feed Item Alpha One', 'test-feed-item-alpha-one', 'x', 'Body text here for the test article.', 'FS AI', 'published', 0)").run();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Test Feed', 'https://example.com/test-feed.xml', 'rss')").run();
    const source = db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = 'https://example.com/test-feed.xml'").get();
    const r = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(r.added, 2, 'the item matching an existing article title is a duplicate');
    assert.equal(r.duplicates, 1);
  });

  it('fetchSource records a failed fetch on the source row and never throws', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Dead Feed', 'https://example.com/dead.xml', 'rss')").run();
    const source = db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = 'https://example.com/dead.xml'").get();
    const r = await fetchSource(env, source, { fetchImpl: stubFetch('nope', { status: 500 }) });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'http-500');
    const row = db.prepare("SELECT * FROM research_sources WHERE id = ?").get(source.id);
    assert.equal(row.last_status, 'error');
    assert.equal(row.last_error, 'http-500');
  });

  it('fetchAllEnabledSources never throws on a mixed good/bad set', async () => {
    const { db, env } = freshEnv();
    db.prepare("UPDATE research_sources SET is_active = 0").run();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Good', 'https://example.com/good.xml', 'rss'), (1, 'Bad', 'https://example.com/bad.xml', 'rss')").run();
    const impl = async (url) => (String(url).includes('/good.xml')
      ? new Response(RSS_SAMPLE, { status: 200 })
      : new Response('x', { status: 500 }));
    const { results, errors, sourcesChecked } = await fetchAllEnabledSources(env, { fetchImpl: impl });
    assert.equal(sourcesChecked, 2);
    assert.equal(results.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(results.find((x) => x.ok).added, 3);
  });
});

describe('division research-agent pause mapping', () => {
  it('maps all 8 research divisions, including digital-tools', () => {
    // Behaviour change 2026-11-20: digital-tools now has a registry
    // entry (its research is governed by the Tools agent), so pausing
    // that agent blocks digital-tools research tasks.
    assert.deepEqual(Object.keys(DIVISION_RESEARCH_REGISTRY).sort(), [
      'ai-technology', 'automotive', 'digital-tools', 'education-learning',
      'finance-money', 'gadgets-electronics', 'health-wellness', 'travel-lifestyle',
    ]);
    assert.equal(DIVISION_RESEARCH_REGISTRY.automotive, 'automotive-research');
    assert.equal(DIVISION_RESEARCH_REGISTRY['ai-technology'], 'technology-research');
    assert.equal(DIVISION_RESEARCH_REGISTRY['digital-tools'], 'digital-tools-agent');
  });

  it('registryIdForTask resolves research by division and other agents 1:1', () => {
    assert.equal(registryIdForTask({ agent: 'research', payload: { division: 'automotive' } }), 'automotive-research');
    assert.equal(registryIdForTask({ agent: 'research', payload: JSON.stringify({ division: 'finance-money' }) }), 'finance-research');
    assert.equal(registryIdForTask({ agent: 'research', payload: {} }), null, 'division-less research has no single governor');
    assert.equal(registryIdForTask({ agent: 'research', payload: { division: 'digital-tools' } }), 'digital-tools-agent');
    assert.equal(registryIdForTask({ agent: 'content-creation', payload: {} }), 'content-creation');
    assert.equal(registryIdForTask({ agent: 'security-monitoring', payload: {} }), 'security');
    assert.equal(registryIdForTask(null), null);
  });
});
