// FS AI — RSS fetch audit log tests (migration 014).
//
// One audit row per fetch execution per feed, true counts from the
// real insert/dedupe point, one execution id shared across the feeds
// of a run, overlap skipped-and-recorded, and a read-only dashboard
// endpoint whose totals reconcile with the research_sources counters.
// Against a REAL SQLite database (schema + seed + migrations
// 005/006/008/009/010/011/012/014). No test here touches the network:
// fetch is always stubbed with canned XML.
//
// Run: node --test tests/rss-audit.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  newExecutionId, RSS_AUDIT_TRIGGER_TYPES, RSS_AUDIT_STATUSES,
} = require('../backend/rss/rss.js');
const {
  fetchSource, fetchAllEnabledSources,
} = require('../backend/rss/sources.js');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');

const ROOT = path.join(__dirname, '..');

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>Test Feed Item Alpha One</title><link>https://example.com/alpha</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Alpha item summary text here.</description></item>
<item><title><![CDATA[Test Feed Item Beta &amp; Friends]]></title><link>https://example.com/beta</link><pubDate>Mon, 10 Nov 2026 08:00:00 GMT</pubDate><description>Beta tips to cut costs &amp; drive smarter.</description></item>
<item><title>Test Feed Item Gamma Old</title><link>https://example.com/gamma</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate><description>Stale item from 2020.</description></item>
</channel></rss>`;

const RSS_SAMPLE_2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Second Feed</title>
<item><title>Second Feed Item Alpha One</title><link>https://example.com/second-alpha</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Second alpha summary.</description></item>
<item><title>Second Feed Item Beta Two</title><link>https://example.com/second-beta</link><pubDate>Mon, 10 Nov 2026 08:00:00 GMT</pubDate><description>Second beta summary.</description></item>
<item><title>Second Feed Item Gamma Three</title><link>https://example.com/second-gamma</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate><description>Second stale item.</description></item>
</channel></rss>`;

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

const MIGRATIONS = [
  'database/schema.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
  'database/migrations/014_rss_fetch_audit.sql',
];

function freshEnv() {
  const db = buildDb(MIGRATIONS);
  return { db, env: { DB: makeRealD1(db) } };
}

function stubFetch(xml, { status = 200 } = {}) {
  return async () => new Response(xml, { status, headers: { 'content-type': 'application/rss+xml' } });
}

function insertTestSource(db, url = 'https://example.com/test-feed.xml') {
  db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Test Feed', ?, 'rss')").run(url);
  return db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = ?").get(url);
}

function auditRows(db, where = '', params = []) {
  return db.prepare(`SELECT * FROM rss_fetch_audit ${where} ORDER BY id ASC`).all(...params);
}

function req(method, path, body) {
  return new Request(`https://fs-ai.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env, method, path, body) {
  const res = await handleAutonomy(req(method, path, body), env, {}, { owner: true });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let realFetch = null;
function stubGlobalFetchOk() {
  if (realFetch === null) realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(RSS_SAMPLE, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
}
afterEach(() => {
  if (realFetch !== null) { globalThis.fetch = realFetch; realFetch = null; }
});

describe('migration 014 schema', () => {
  it('creates rss_fetch_audit with the specified columns, indexes and unique guard', () => {
    const { db } = freshEnv();
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rss_fetch_audit'").get();
    assert.ok(table, 'table exists');
    for (const col of ['id', 'source_id', 'feed_url', 'started_at', 'ended_at', 'execution_id',
      'trigger_type', 'items_discovered', 'items_inserted', 'duplicates_skipped', 'errors', 'status']) {
      assert.match(table.sql, new RegExp(`\\b${col}\\b`), `column ${col} exists`);
    }
    assert.match(table.sql, /UNIQUE \(execution_id, source_id\)/);
    assert.match(table.sql, /trigger_type IN \('manual', 'scheduled', 'daily-workflow'\)/);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rss_fetch_audit'").all().map((r) => r.name);
    assert.ok(indexes.includes('idx_rss_fetch_audit_source_started'), 'index on (source_id, started_at)');
    assert.ok(indexes.includes('idx_rss_fetch_audit_execution'), 'index on execution_id');
    // The uniqueness guard rejects a duplicate raw INSERT.
    db.prepare("INSERT INTO rss_fetch_audit (source_id, feed_url, started_at, execution_id, trigger_type, status) VALUES (1, 'https://example.com/x', '2026-11-20T00:00:00.000Z', 'exec-dup', 'manual', 'completed')").run();
    assert.throws(() => {
      db.prepare("INSERT INTO rss_fetch_audit (source_id, feed_url, started_at, execution_id, trigger_type, status) VALUES (1, 'https://example.com/x', '2026-11-20T00:01:00.000Z', 'exec-dup', 'manual', 'completed')").run();
    }, /UNIQUE constraint failed/);
    // The CHECKs reject an unknown trigger type and status.
    assert.throws(() => {
      db.prepare("INSERT INTO rss_fetch_audit (source_id, feed_url, started_at, execution_id, trigger_type, status) VALUES (1, 'https://example.com/x', '2026-11-20T00:00:00.000Z', 'exec-bad', 'hourly', 'completed')").run();
    }, /CHECK constraint failed/);
  });

  it('newExecutionId is unique per call; trigger/status vocabularies are as specified', () => {
    assert.notEqual(newExecutionId(), newExecutionId());
    assert.equal(typeof newExecutionId(), 'string');
    assert.deepEqual([...RSS_AUDIT_TRIGGER_TYPES].sort(), ['daily-workflow', 'manual', 'scheduled']);
    assert.ok(RSS_AUDIT_STATUSES.includes('completed'));
    assert.ok(RSS_AUDIT_STATUSES.includes('failed'));
    assert.ok(RSS_AUDIT_STATUSES.includes('partial'));
    assert.ok(RSS_AUDIT_STATUSES.includes('running'), 'running is needed for the overlap guard');
    assert.ok(RSS_AUDIT_STATUSES.includes('skipped-overlap'), 'skipped-overlap is the recorded overlap outcome');
  });
});

describe('fetchSource audit rows', () => {
  it('one fetch writes exactly one audit row with the true counts', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    const r = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(r.ok, true);
    assert.equal(r.added, 3);
    assert.equal(r.duplicates, 0);
    const rows = auditRows(db);
    assert.equal(rows.length, 1, 'exactly one audit row');
    const row = rows[0];
    assert.equal(row.source_id, source.id);
    assert.equal(row.feed_url, source.url);
    assert.equal(row.status, 'completed');
    assert.equal(row.items_discovered, 3, 'discovered = new items that passed dedupe');
    assert.equal(row.items_inserted, 3, 'inserted = rows actually written');
    assert.equal(row.duplicates_skipped, 0);
    assert.equal(row.errors, '');
    assert.equal(row.trigger_type, 'manual', 'a lone fetchSource call defaults to manual');
    assert.ok(row.execution_id, 'execution id recorded');
    assert.ok(row.started_at, 'started_at recorded');
    assert.ok(row.ended_at, 'ended_at recorded');
    assert.ok(new Date(row.ended_at).getTime() >= new Date(row.started_at).getTime(), 'end is not before start');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3);
  });

  it('a second fetch of the same feed writes a second row with a different execution_id', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    const first = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-first' });
    const second = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-second' });
    assert.equal(first.added, 3);
    assert.equal(second.added, 0);
    assert.equal(second.duplicates, 3);
    const rows = auditRows(db);
    assert.equal(rows.length, 2, 'one row per fetch execution');
    assert.equal(rows[0].execution_id, 'exec-first');
    assert.equal(rows[1].execution_id, 'exec-second');
    assert.notEqual(rows[0].execution_id, rows[1].execution_id);
    assert.equal(rows[1].status, 'completed');
    assert.equal(rows[1].items_discovered, 0);
    assert.equal(rows[1].items_inserted, 0);
    assert.equal(rows[1].duplicates_skipped, 3, 'the re-fetch skipped all 3 as duplicates');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3, 'no duplicate rows stored');
  });

  it('duplicate audit rows for one execution are impossible (INSERT OR IGNORE + UNIQUE)', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-reused' });
    // Same execution id, same feed, second fetch: the fetch still runs
    // (its counts reach the source counters) but it must NOT write a
    // second audit row for that execution+feed.
    const second = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-reused' });
    assert.equal(second.duplicates, 3, 'the second fetch still ran and deduped');
    const rows = auditRows(db, 'WHERE execution_id = ?', ['exec-reused']);
    assert.equal(rows.length, 1, 'one audit row per execution+feed, never two');
    assert.equal(rows[0].status, 'completed', 'the existing row was not overwritten by the second call');
    assert.equal(rows[0].items_discovered, 3, 'the first call’s counts stand');
  });

  it('a failed fetch writes one failed audit row with the real error and zero counts', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db, 'https://example.com/dead.xml');
    const r = await fetchSource(env, source, { fetchImpl: stubFetch('nope', { status: 500 }), executionId: 'exec-fail' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'http-500');
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'failed');
    assert.equal(rows[0].errors, 'http-500');
    assert.equal(rows[0].items_discovered, 0);
    assert.equal(rows[0].items_inserted, 0);
    assert.equal(rows[0].duplicates_skipped, 0);
    assert.ok(rows[0].ended_at, 'a failed fetch still closes its row');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 0);
  });

  it('an overlapping fetch is skipped and recorded, never double-fetched', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const deferredFetch = async () => {
      await gate;
      return new Response(RSS_SAMPLE, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    };
    const firstP = fetchSource(env, source, { fetchImpl: deferredFetch, executionId: 'exec-overlap-1' });
    const second = await fetchSource(env, source, { fetchImpl: deferredFetch, executionId: 'exec-overlap-2' });
    assert.equal(second.ok, false);
    assert.equal(second.skippedOverlap, true);
    assert.equal(second.error, 'overlap-skipped');
    assert.equal(second.added, 0, 'the skipped fetch stored nothing');
    release();
    const first = await firstP;
    assert.equal(first.ok, true);
    assert.equal(first.added, 3);
    const rows = auditRows(db);
    assert.equal(rows.length, 2, 'one completed row + one skipped-overlap row');
    const completed = rows.filter((r) => r.status === 'completed');
    const skipped = rows.filter((r) => r.status === 'skipped-overlap');
    assert.equal(completed.length, 1, 'never two completed rows for one in-flight fetch');
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].execution_id, 'exec-overlap-2', 'the overlap is recorded under the skipped caller’s execution');
    assert.equal(completed[0].execution_id, 'exec-overlap-1');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3, 'items stored exactly once');
    const health = db.prepare('SELECT last_status, items_discovered FROM research_sources WHERE id = ?').get(source.id);
    assert.equal(health.last_status, 'ok', 'the skipped fetch did not mark the source as an error');
    assert.equal(health.items_discovered, 3);
    // The guard is released: a later fetch runs normally.
    const third = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-overlap-3' });
    assert.equal(third.ok, true);
    assert.equal(third.duplicates, 3);
    assert.equal(auditRows(db).length, 3);
  });
});

describe('run-level execution ids and trigger types', () => {
  it('manual vs scheduled trigger types are recorded distinctly; one run shares one execution id', async () => {
    const { db, env } = freshEnv();
    db.prepare('UPDATE research_sources SET is_active = 0').run();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Good One', 'https://example.com/good1.xml', 'rss'), (1, 'Good Two', 'https://example.com/good2.xml', 'rss')").run();
    // Distinct feed content per source: dedupe is division-wide, so
    // two feeds with identical titles would make the second feed's
    // items duplicates of the first feed's stored items.
    const impl = async (url) => new Response(
      String(url).includes('good2.xml') ? RSS_SAMPLE_2 : RSS_SAMPLE, { status: 200 });
    const scheduled = await fetchAllEnabledSources(env, { fetchImpl: impl, triggerType: 'scheduled' });
    assert.equal(scheduled.results.length, 2);
    assert.equal(scheduled.errors.length, 0);
    const schedRows = auditRows(db, "WHERE trigger_type = 'scheduled'");
    assert.equal(schedRows.length, 2, 'one audit row per feed of the run');
    assert.equal(new Set(schedRows.map((r) => r.execution_id)).size, 1, 'both feeds share the run’s execution id');
    assert.equal(schedRows[0].execution_id, scheduled.executionId, 'the returned id is the recorded id');
    for (const row of schedRows) assert.equal(row.items_inserted, 3);

    // Default trigger for a run is daily-workflow, with a fresh id.
    const daily = await fetchAllEnabledSources(env, { fetchImpl: impl });
    assert.equal(daily.triggerType, 'daily-workflow');
    assert.notEqual(daily.executionId, scheduled.executionId);
    const dailyRows = auditRows(db, "WHERE trigger_type = 'daily-workflow'");
    assert.equal(dailyRows.length, 2);
    assert.equal(new Set(dailyRows.map((r) => r.execution_id)).size, 1);
    assert.equal(dailyRows[0].execution_id, daily.executionId);

    // Manual: a lone fetchSource call records 'manual'.
    const source = db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = 'https://example.com/good1.xml'").get();
    await fetchSource(env, source, { fetchImpl: impl });
    const manualRows = auditRows(db, "WHERE trigger_type = 'manual'");
    assert.equal(manualRows.length, 1);
  });
});

describe('GET /api/autonomy/rss-audit', () => {
  it('returns audit rows newest-first with limit, and per-source totals that reconcile', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-ep-1' });
    await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-ep-2' });

    const first = await call(env, 'GET', '/api/autonomy/rss-audit?limit=10');
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.source, 'd1');
    assert.equal(first.json.total, 2);
    assert.equal(first.json.audits.length, 2);
    assert.equal(first.json.audits[0].execution_id, 'exec-ep-2', 'newest first');
    assert.equal(first.json.audits[1].execution_id, 'exec-ep-1');
    assert.equal(first.json.audits[0].duplicates_skipped, 3);
    assert.equal(first.json.audits[1].items_inserted, 3);

    const mine = first.json.perSource.find((p) => p.sourceId === source.id);
    assert.ok(mine, 'per-source totals include the fetched source');
    assert.equal(mine.auditInserted, 3, 'audit inserted sum');
    assert.equal(mine.auditDiscovered, 3);
    assert.equal(mine.auditDuplicates, 3);
    assert.equal(mine.auditFetches, 2);
    assert.equal(mine.researchItemsCount, 3, 'live research_items count for the source');
    assert.equal(mine.sourceItemsDiscovered, 3, 'research_sources counter');
    assert.equal(mine.reconciled, true, 'audit sum == research_items count == source counter');
    assert.equal(first.json.totals.auditInserted, 3);
    assert.equal(first.json.totals.researchItemsTotal, 3);

    // A reload must not alter historical counts: the endpoint reads
    // only, so a second identical call returns identical numbers.
    const second = await call(env, 'GET', '/api/autonomy/rss-audit?limit=10');
    assert.deepEqual(second.json.audits, first.json.audits);
    assert.deepEqual(second.json.totals, first.json.totals);
    assert.deepEqual(second.json.perSource, first.json.perSource);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rss_fetch_audit').get().n, 2, 'no rows added by reading');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 3);
  });

  it('limit caps the rows but not the total; source_id filters rows and totals', async () => {
    const { db, env } = freshEnv();
    const source = insertTestSource(db);
    await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-ep-1' });
    await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE), executionId: 'exec-ep-2' });
    const limited = await call(env, 'GET', '/api/autonomy/rss-audit?limit=1');
    assert.equal(limited.json.audits.length, 1);
    assert.equal(limited.json.total, 2);
    assert.equal(limited.json.limit, 1);
    const filtered = await call(env, 'GET', `/api/autonomy/rss-audit?source_id=${source.id}`);
    assert.equal(filtered.json.audits.length, 2);
    assert.equal(filtered.json.perSource.length, 1);
    assert.equal(filtered.json.perSource[0].sourceId, source.id);
    assert.equal(filtered.json.perSource[0].reconciled, true);
    const bad = await call(env, 'GET', '/api/autonomy/rss-audit?source_id=abc');
    assert.equal(bad.status, 400);
  });

  it('manual dashboard fetch records trigger manual (POST /api/autonomy/sources/:id/fetch)', async () => {
    const { db, env } = freshEnv();
    stubGlobalFetchOk();
    const created = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Test Feed', url: 'https://example.com/test-feed.xml',
    });
    assert.equal(created.status, 201);
    const id = created.json.source.id;
    const fetched = await call(env, 'POST', `/api/autonomy/sources/${id}/fetch`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.source.ok, true);
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].trigger_type, 'manual');
    assert.ok(rows[0].execution_id, 'the manual route generates an execution id');
    assert.equal(rows[0].status, 'completed');
  });

  it('returns 503 on a database without the audit table (pre-014)', async () => {
    const { db, env } = freshEnv();
    db.exec('DROP TABLE rss_fetch_audit');
    const res = await call(env, 'GET', '/api/autonomy/rss-audit');
    assert.equal(res.status, 503);
    assert.match(res.json.error, /migration 014/);
  });
});
