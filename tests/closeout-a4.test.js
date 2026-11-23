// FS AI — Close-out A4 (CSP reporting) tests, 2026-11-23.
//
// Covers A4 against the SHIPPED files (real in-memory SQLite for the
// Worker route, source reads where the file itself is the contract):
//   A4.1 migration 030 — csp_reports table with EXACTLY the four
//         allowed columns (directive, blocked_uri, document_uri,
//         reported_at); no IP / user agent / raw body column; indexes
//   A4.2 POST /api/csp-report — CSP Level 2 object and Reporting API
//         array both accepted (204, empty body, one row stored with
//         the directive NAME only); wrong type 415; oversized 413;
//         bad JSON / no directive 400; no DB bound still 204
//   A4.3 GET /api/csp-report/stats — 7-day counts per directive
//         (8-day-old row excluded), total; no DB 503; owner-only
//         wiring lives in worker.js (source assertion)
//   A4.4 Pages CSP stays Report-Only and names the report-uri; the
//         dashboard shows the 7-day counts; the enforcement rule is
//         written down (14 clean days + owner approval + instant
//         revert); db:migrate carries migration 030
//
// Run: node --test tests/closeout-a4.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  handleCspReport,
  handleCspReportStats,
  parseCspReport,
  CSP_REPORT_MAX_BODY_BYTES,
} = require('../backend/routes/csp-report.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'https://fs-ai.mdalfahad841.workers.dev';
const REPORT_URI = WORKER_URL + '/api/csp-report';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* Same splitter as tests/article-fetch.test.js: ';' inside strings and
   full-line comments must not split statements. */
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
    'database/migrations/030_csp_reports.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function postReport(body, contentType) {
  return new Request(REPORT_URI, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/csp-report' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function sqliteDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function rowCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM csp_reports').get().n;
}

/* ------------------------------------------------------------------ */
/* A4.1 — migration 030.                                               */
/* ------------------------------------------------------------------ */
describe('A4.1 migration 030 creates csp_reports with only the allowed fields', () => {
  it('creates the table with exactly four stored columns', () => {
    const { db } = freshEnv();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'csp_reports'",
    ).get();
    assert.ok(table, 'csp_reports table must exist');
    const cols = db.prepare('PRAGMA table_info(csp_reports)').all().map((c) => c.name);
    assert.deepEqual(cols, ['id', 'directive', 'blocked_uri', 'document_uri', 'reported_at']);
  });

  it('stores no IP, user agent or raw body — no such column exists', () => {
    const { db } = freshEnv();
    const cols = db.prepare('PRAGMA table_info(csp_reports)').all().map((c) => c.name);
    for (const banned of ['ip', 'ip_address', 'user_agent', 'raw_body', 'body', 'cookie', 'session']) {
      assert.ok(!cols.includes(banned), 'must not store ' + banned);
    }
  });

  it('creates the directive + reported_at indexes', () => {
    const { db } = freshEnv();
    const idx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_csp_reports_%'",
    ).all().map((r) => r.name);
    assert.ok(idx.includes('idx_csp_reports_directive'), 'directive index');
    assert.ok(idx.includes('idx_csp_reports_reported'), 'reported_at index');
  });

  it('is additive: applying it twice does not fail', () => {
    const db = buildDb(['database/schema.sql', 'database/migrations/030_csp_reports.sql']);
    const text = read('database/migrations/030_csp_reports.sql');
    for (const stmt of splitSql(text)) db.exec(stmt);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM csp_reports').get().n, 0);
  });
});

/* ------------------------------------------------------------------ */
/* A4.2 — POST /api/csp-report.                                         */
/* ------------------------------------------------------------------ */
describe('A4.2 POST /api/csp-report stores only the four allowed fields', () => {
  it('accepts a CSP Level 2 report: 204, empty body, directive NAME only', async () => {
    const { db, env } = freshEnv();
    const res = await handleCspReport(postReport({
      'csp-report': {
        'document-uri': 'https://fs-ai-5w5.pages.dev/pages/article?id=1',
        'violated-directive': "script-src 'self'",
        'blocked-uri': 'https://evil.example.com/x.js',
        'original-policy': "default-src 'self'; script-src 'self'",
        'source-file': 'https://fs-ai-5w5.pages.dev/pages/article?id=1',
        'line-number': 12,
      },
    }), env);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
    assert.equal(rowCount(db), 1);
    const row = db.prepare('SELECT * FROM csp_reports').get();
    assert.equal(row.directive, 'script-src');
    assert.equal(row.blocked_uri, 'https://evil.example.com/x.js');
    assert.equal(row.document_uri, 'https://fs-ai-5w5.pages.dev/pages/article?id=1');
    assert.match(row.reported_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('accepts a Reporting API array: 204, camelCase fields stored', async () => {
    const { db, env } = freshEnv();
    const res = await handleCspReport(postReport([{
      type: 'csp-violation',
      body: {
        violatedDirective: 'img-src',
        blockedURL: 'https://tracker.example.com/p.png',
        documentURL: 'https://fs-ai-5w5.pages.dev/',
      },
    }], 'application/reports+json'), env);
    assert.equal(res.status, 204);
    assert.equal(rowCount(db), 1);
    const row = db.prepare('SELECT * FROM csp_reports').get();
    assert.equal(row.directive, 'img-src');
    assert.equal(row.blocked_uri, 'https://tracker.example.com/p.png');
    assert.equal(row.document_uri, 'https://fs-ai-5w5.pages.dev/');
  });

  it('accepts application/csp-report with a charset parameter', async () => {
    const { db, env } = freshEnv();
    const res = await handleCspReport(postReport({
      'csp-report': { 'violated-directive': 'style-src', 'blocked-uri': 'inline', 'document-uri': 'https://fs-ai-5w5.pages.dev/' },
    }, 'application/csp-report; charset=utf-8'), env);
    assert.equal(res.status, 204);
    assert.equal(rowCount(db), 1);
  });

  it('refuses a wrong content type with 415 and stores nothing', async () => {
    const { db, env } = freshEnv();
    const res = await handleCspReport(postReport({
      'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://x.example.com/', 'document-uri': 'https://fs-ai-5w5.pages.dev/' },
    }, 'text/plain'), env);
    assert.equal(res.status, 415);
    assert.equal(rowCount(db), 0);
  });

  it('refuses an oversized body with 413 and stores nothing', async () => {
    const { db, env } = freshEnv();
    const big = { 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://x.example.com/', 'document-uri': 'https://fs-ai-5w5.pages.dev/', padding: 'x'.repeat(CSP_REPORT_MAX_BODY_BYTES) } };
    const res = await handleCspReport(postReport(big), env);
    assert.equal(res.status, 413);
    assert.equal(rowCount(db), 0);
  });

  it('refuses invalid JSON with 400 and a report with no directive with 400', async () => {
    const { db, env } = freshEnv();
    const bad = await handleCspReport(postReport('{not json'), env);
    assert.equal(bad.status, 400);
    const noDirective = await handleCspReport(postReport({ 'csp-report': { 'blocked-uri': 'https://x.example.com/' } }), env);
    assert.equal(noDirective.status, 400);
    assert.equal(rowCount(db), 0);
  });

  it('truncates URIs longer than 2048 chars instead of refusing the report', async () => {
    const { db, env } = freshEnv();
    const long = 'https://x.example.com/' + 'a'.repeat(3000);
    const res = await handleCspReport(postReport({
      'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': long, 'document-uri': 'https://fs-ai-5w5.pages.dev/' },
    }), env);
    assert.equal(res.status, 204);
    const row = db.prepare('SELECT * FROM csp_reports').get();
    assert.equal(row.blocked_uri.length, 2048);
  });

  it('still answers 204 when no D1 is bound (fire-and-forget)', async () => {
    const res = await handleCspReport(postReport({
      'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://x.example.com/', 'document-uri': 'https://fs-ai-5w5.pages.dev/' },
    }), {});
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });

  it('parseCspReport never returns an IP, user agent or raw body', () => {
    const out = parseCspReport({
      'csp-report': {
        'violated-directive': 'font-src', 'blocked-uri': 'https://x.example.com/f.woff',
        'document-uri': 'https://fs-ai-5w5.pages.dev/', 'source-file': 'https://x.example.com/f.woff',
      },
    });
    assert.deepEqual(Object.keys(out).sort(), ['blockedUri', 'directive', 'documentUri']);
    assert.equal(out.directive, 'font-src');
  });
});

/* ------------------------------------------------------------------ */
/* A4.3 — GET /api/csp-report/stats.                                    */
/* ------------------------------------------------------------------ */
describe('A4.3 GET /api/csp-report/stats returns 7-day counts per directive', () => {
  it('groups by directive, excludes rows older than 7 days, totals correctly', async () => {
    const { db, env } = freshEnv();
    const ins = db.prepare(
      'INSERT INTO csp_reports (directive, blocked_uri, document_uri, reported_at) VALUES (?, ?, ?, ?)',
    );
    ins.run('script-src', 'https://a.example.com/1.js', 'https://fs-ai-5w5.pages.dev/', sqliteDaysAgo(0));
    ins.run('script-src', 'https://a.example.com/2.js', 'https://fs-ai-5w5.pages.dev/', sqliteDaysAgo(6));
    ins.run('img-src', 'https://b.example.com/p.png', 'https://fs-ai-5w5.pages.dev/', sqliteDaysAgo(1));
    ins.run('script-src', 'https://old.example.com/o.js', 'https://fs-ai-5w5.pages.dev/', sqliteDaysAgo(8));
    const res = await handleCspReportStats(new Request(REPORT_URI + '/stats'), env);
    assert.equal(res.status, 200);
    const data = JSON.parse(await res.text());
    assert.equal(data.ok, true);
    assert.equal(data.days, 7);
    assert.equal(data.total, 3);
    assert.deepEqual(data.by_directive, [
      { directive: 'script-src', count: 2 },
      { directive: 'img-src', count: 1 },
    ]);
  });

  it('returns an empty list (not an error) when nothing was reported', async () => {
    const { env } = freshEnv();
    const res = await handleCspReportStats(new Request(REPORT_URI + '/stats'), env);
    assert.equal(res.status, 200);
    const data = JSON.parse(await res.text());
    assert.deepEqual(data.by_directive, []);
    assert.equal(data.total, 0);
  });

  it('answers 503 when no D1 is bound', async () => {
    const res = await handleCspReportStats(new Request(REPORT_URI + '/stats'), {});
    assert.equal(res.status, 503);
  });

  it('the stats route is owner-only in worker.js', () => {
    const worker = read('backend/worker.js');
    assert.ok(worker.includes("handleCspReportStats"), 'worker imports the stats handler');
    assert.ok(worker.includes("path === '/api/csp-report/stats'"), 'stats route exists');
    const statsIdx = worker.indexOf("path === '/api/csp-report/stats'");
    const authIdx = worker.indexOf('requireOwner(request, env)', statsIdx);
    const handlerIdx = worker.indexOf('handleCspReportStats(request, env)', statsIdx);
    assert.ok(authIdx !== -1 && authIdx < handlerIdx, 'requireOwner runs before the stats handler');
  });
});

/* ------------------------------------------------------------------ */
/* A4.4 — wiring: Report-Only CSP + dashboard + enforcement rule.      */
/* ------------------------------------------------------------------ */
describe('A4.4 wiring: Report-Only CSP, dashboard counts, enforcement rule', () => {
  it('worker.js routes POST /api/csp-report to the handler', () => {
    const worker = read('backend/worker.js');
    assert.ok(worker.includes("handleCspReport"), 'worker imports the report handler');
    assert.ok(worker.includes("path === '/api/csp-report' && method === 'POST'"), 'POST route exists');
    assert.ok(worker.includes('handleCspReport(request, env)'), 'POST route calls the handler');
  });

  it('fetch() rate-limits before routing, so reports are capped at 30/min per IP', () => {
    const worker = read('backend/worker.js');
    const fetchIdx = worker.indexOf('async fetch(request, env, ctx)');
    const limitIdx = worker.indexOf('rateLimit(request, env', fetchIdx);
    const routeIdx = worker.indexOf('await route(request, env, ctx)', fetchIdx);
    assert.ok(limitIdx !== -1 && routeIdx !== -1 && limitIdx < routeIdx, 'rateLimit runs before route()');
  });

  it('Pages CSP stays Report-Only and names the report-uri', () => {
    const headers = read('frontend/_headers');
    const lines = headers.split('\n');
    assert.ok(!lines.some((l) => /^\s*Content-Security-Policy:/.test(l)), 'no enforced Content-Security-Policy header line');
    const reportOnly = lines.find((l) => l.includes('Content-Security-Policy-Report-Only:'));
    assert.ok(reportOnly, 'Report-Only header present');
    assert.ok(reportOnly.includes('report-uri ' + REPORT_URI), 'report-uri points at the Worker endpoint');
    assert.ok(reportOnly.includes("default-src 'self'"), 'policy itself unchanged');
  });

  it('the dashboard Security section shows the 7-day counts', () => {
    const html = read('frontend/pages/dashboard.html');
    const sec = html.slice(html.indexOf('id="section-security"'));
    assert.ok(sec.includes('id="cspReportList"'), 'CSP list element exists in the Security section');
    assert.ok(sec.includes('id="cspReportStatus"'), 'CSP status element exists in the Security section');
    const js = read('frontend/scripts/dashboard.js');
    assert.ok(js.includes("'/api/csp-report/stats'"), 'dashboard fetches the stats endpoint');
    assert.ok(js.includes('loadCspReports'), 'dashboard has a CSP loader');
    assert.ok(js.includes('No CSP violations reported in the last 7 days.'), 'empty state is honest');
    assert.ok(js.includes('CSP is Report-Only (nothing enforced)'), 'dashboard states Report-Only');
  });

  it('the enforcement rule is written down: 14 clean days + owner approval + instant revert', () => {
    const doc = read('docs/CLOSEOUT-A4-CSP-ENFORCEMENT-RULE-2026-11-23.md').replace(/\s+/g, ' ');
    assert.ok(doc.includes('14 consecutive clean days'), '14-day clean window');
    assert.ok(doc.includes('Owner approval'), 'owner approval required');
    assert.ok(doc.includes('revert to Report-Only immediately'), 'instant revert on breakage');
    assert.ok(doc.includes('Content-Security-Policy-Report-Only'), 'the switch is a header rename');
    assert.ok(doc.includes('zero reports can also mean the report-uri is broken'), 'silence is not proof of clean');
  });

  it('db:migrate carries migration 030 after 029', () => {
    const pkg = JSON.parse(read('package.json'));
    const migrate = pkg.scripts['db:migrate'];
    assert.ok(migrate.includes('database/migrations/030_csp_reports.sql'), '030 in the migrate chain');
    assert.ok(
      migrate.indexOf('029_article_fetch_runs.sql') < migrate.indexOf('030_csp_reports.sql'),
      '030 runs after 029',
    );
  });
});
