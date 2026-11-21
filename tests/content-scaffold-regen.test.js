// FS AI — scaffold-draft regeneration + daily-cap defense (W2, 2026-11-21).
//
// Live #29 is a SCAFFOLD shell (593 chars: "SCAFFOLD — full draft
// needed" + six empty "[Write this section — no content yet.]"
// sections). Its fact-checks fail CORRECTLY — there is no content to
// check — so the fix is regeneration, not re-checking: regenerate a
// real body from the article's own recorded evidence, in place
// (same article row, still a draft, never published, scaffold
// snapshotted first), then fact-check THAT.
//
// Also: the daily article cap, defense in depth — runContentCreation
// refuses generation when today's pipeline articles already reach
// maxArticlesPerDay (the queue drain is the primary layer; this is
// the second). Regeneration reuses an existing row, so the cap does
// NOT block it.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012 — same harness as the other autonomy tests). The LLM
// is stubbed through env.AI. Throwaway articles only; never
// #26/#27/#31 ids.
// Run: node --test tests/content-scaffold-regen.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  isScaffoldBody, scaffoldPlaceholderCount,
  regenerateScaffoldDraft, runScaffoldRegeneration, runContentCreation,
} = require('../backend/agents/autonomy/content.js');

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

function insertArticle(db, { title, slug, body, divisionId = 5, status = 'draft' }) {
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

function insertResearchItem(db, { title, summary, evidence, url, divisionId = 5, outdated = 0 }) {
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(divisionId, title, url, '2026-11-19T10:00:00Z', '2026-11-19T12:00:00Z', summary, evidence, outdated ? 1 : 0);
  return Number(r.lastInsertRowid);
}

function addArticleSource(db, articleId, url, researchItemId, title = 'Test source') {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, 'research', ?, '2026-11-19T12:00:00Z')",
  ).run(articleId, title, url, researchItemId);
}

/** Stub the Workers AI binding: every model call returns the same text. */
function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

// The #29 shape: marker + six empty placeholder sections.
function scaffoldBody(headings = ['Introduction', 'Getting there', 'Where to stay', 'What to see', 'Food and costs', 'Conclusion']) {
  return [
    'SCAFFOLD — full draft needed.',
    '',
    'This draft was created from an agent scaffold. No article body was fabricated: ' +
    'the owner (or an LLM) must write the full body, add sources and pass fact-checking before approval.',
    '',
    ...headings.map((h) => `## ${h}\n\n[Write this section — no content yet.]`),
    '',
    'Sources:',
    '- https://example.com/austin-guide',
  ].join('\n');
}

const AUSTIN_URL = 'https://example.com/austin-guide';
// Workstream A (2026-11-21): the evidence must clear the
// MIN_REGEN_EVIDENCE_CHARS (1000) floor — the old ~340-char fixture
// was below it and now correctly returns insufficient-evidence.
// This is realistic Austin guide material, >1000 chars of current
// evidence, so the happy-path regen tests exercise the LLM path.
const AUSTIN_EVIDENCE = 'Austin is the capital of Texas and is known for live music, food trucks and warm weather. Visitors can walk around the downtown area, swim at Barton Springs Pool and listen to bands on Sixth Street. A three-day visit works well with one day downtown, one day outdoors and one day for food and music. Barton Springs Pool is a spring-fed pool in Zilker Park, kept at about 20 degrees Celsius all year, and Zilker Park also holds the Zilker Botanical Garden and the hike-and-bike trail around Lady Bird Lake. The Texas State Capitol stands at the north end of Congress Avenue and offers free guided tours of the pink-granite building. In the evening, Mexican free-tailed bats emerge from under the Congress Avenue Bridge between March and October, a free spectacle best watched from the bridge or a boat on the lake. Food trucks cluster around South Congress and East Austin, serving tacos, barbecue brisket, breakfast tacos and vegetarian meals, while the South Congress strip has vintage shops, boots and murals. South by Southwest brings film, music and technology visitors every March, so hotels should be booked early in that month. Public buses cover the centre, but most visitors walk downtown and use a rideshare for the districts further out.';

// The live #29 evidence, mirrored: a single ~500-char fragment,
// truncated mid-sentence and outdated — below the regeneration
// floor and excluded entirely, so current evidence is 0 chars.
const THIN_OUTDATED_EVIDENCE = 'Austin is the capital of Texas, a city famous for live music, food trucks and warm weather. Visitors can walk downtown, swim at Barton Springs Pool and listen to bands on Sixth Street. A three-day visit works well with one day downtown, one day outdoors and one day for food. The city hosts the South by Southwest tech, film and music ';

const CANNED_BODY =
  '## Introduction\n\nAustin is the capital of Texas and is known for live music, food trucks and warm weather, which makes it a friendly city for a first visit.\n\n' +
  '## Getting there\n\nMost visitors arrive by plane or by car, and the downtown area is easy to walk once you have arrived in the city centre.\n\n' +
  '## Where to stay\n\nStaying downtown keeps the music venues, restaurants and the river walk within easy walking distance for most visitors.\n\n' +
  '## What to see\n\nVisitors can walk around the downtown area, swim at Barton Springs Pool and listen to bands on Sixth Street in the evening.\n\n' +
  '## Food and costs\n\nFood trucks serve tacos, barbecue and vegetarian meals at prices that suit a modest travel budget for most visitors.\n\n' +
  '## Conclusion\n\nA three-day visit works well with one day downtown, one day outdoors and one day for food and music in Austin.';

function seedAustinEvidence(db, articleId) {
  const itemId = insertResearchItem(db, {
    title: 'Austin travel guide', summary: AUSTIN_EVIDENCE, evidence: AUSTIN_EVIDENCE, url: AUSTIN_URL,
  });
  addArticleSource(db, articleId, AUSTIN_URL, itemId, 'Austin travel guide');
  return itemId;
}

describe('isScaffoldBody — scaffold detection', () => {
  it('detects the SCAFFOLD marker and placeholder sections', () => {
    assert.equal(isScaffoldBody(scaffoldBody()), true);
    assert.equal(scaffoldPlaceholderCount(scaffoldBody()), 6);
    assert.equal(isScaffoldBody('## Introduction\n\n[Write this section — no content yet.]'), true);
    assert.equal(scaffoldPlaceholderCount('## Introduction\n\n[Write this section — no content yet.]'), 1);
  });

  it('does not flag a real body, an empty body, or an AI-DRAFT body', () => {
    assert.equal(isScaffoldBody(CANNED_BODY), false);
    assert.equal(isScaffoldBody(''), false);
    assert.equal(isScaffoldBody('AI-DRAFT — needs fact-check + owner approval.\n\n' + CANNED_BODY), false);
  });
});

describe('regenerateScaffoldDraft — the #29 fix, in place', () => {
  it('regenerates the scaffold in place: same row, still a draft, scaffold snapshotted, no duplicate', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days', body: scaffold });
    seedAustinEvidence(db, id);
    const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'done', JSON.stringify(r));
    assert.equal(r.articleId, id);
    assert.equal(r.regenerated, true);
    assert.equal(r.previousBodyLength, scaffold.length);
    assert.ok(r.newBodyLength > scaffold.length);
    assert.equal(r.sourcesUsed, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, beforeCount, 'no duplicate article row');
    const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    assert.equal(row.slug, 'austin-in-three-days', 'same slug, same row');
    assert.equal(row.title, 'Austin in Three Days');
    assert.equal(row.status, 'draft', 'still a draft — never published');
    assert.equal(row.fact_checked, 0, 'fact_checked stays 0 — the new body still needs fact-checking');
    assert.ok(row.body.startsWith('AI-DRAFT'), 'new body carries the AI-DRAFT banner');
    assert.ok(row.body.includes('Barton Springs Pool'), 'new body is the generated content, not a placeholder');
    assert.ok(!row.body.includes('SCAFFOLD — full draft needed'), 'scaffold marker gone');
    assert.ok(!row.body.includes('[Write this section'), 'no placeholder sections left');
    const revisions = db.prepare('SELECT * FROM article_revisions WHERE article_id = ?').all(id);
    assert.equal(revisions.length, 1, 'the scaffold is snapshotted first');
    assert.equal(revisions[0].revised_by, 'scaffold-regen');
    assert.equal(revisions[0].body, scaffold, 'the snapshot stores the scaffold shell');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?').get(id).n, 1, 'sources not re-recorded');
  });

  it('is callable as a task handler (payload article_id) and refuses a bad id', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-task', body: scaffoldBody() });
    seedAustinEvidence(db, id);
    stubAi(env, CANNED_BODY);
    const r = await runScaffoldRegeneration({ kind: 'scaffold-regeneration', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    assert.equal(r.articleId, id);
    const bad = await runScaffoldRegeneration({ kind: 'scaffold-regeneration', payload: { article_id: 99999 } }, env);
    assert.equal(bad.outcome, 'failed');
    assert.match(bad.error, /not found/);
  });

  it('no usable evidence → no-op, scaffold untouched', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-noev', body: scaffold });
    // A source URL with no stored research behind it.
    db.prepare(
      "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Austin guide', ?, 'other', '2026-11-19T12:00:00Z')",
    ).run(id, AUSTIN_URL);
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /insufficient-evidence/);
    assert.ok(r.recoveryReport, 'a recovery report names the cause');
    assert.equal(r.recoveryReport.retryable, false);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold, 'scaffold untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('thin + outdated evidence (the live #29 shape) → insufficient-evidence, scaffold untouched, no LLM call', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-thin', body: scaffold });
    // Mirror live #29 exactly: one source, one research item, a
    // ~500-char fragment truncated mid-sentence, is_outdated = 1.
    const itemId = insertResearchItem(db, {
      title: 'Austin travel guide', summary: THIN_OUTDATED_EVIDENCE, evidence: THIN_OUTDATED_EVIDENCE, url: AUSTIN_URL, outdated: 1,
    });
    addArticleSource(db, id, AUSTIN_URL, itemId, 'Austin travel guide');
    assert.ok(THIN_OUTDATED_EVIDENCE.length < 1000, `fixture fragment is ${THIN_OUTDATED_EVIDENCE.length} chars`);
    // The stub would return a complete body if called — a 'done'
    // outcome would prove the guard did NOT stop the LLM call.
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'no-op', JSON.stringify(r));
    assert.match(r.reason, /insufficient-evidence/);
    assert.match(r.reason, /current \(non-outdated\) evidence/);
    assert.equal(r.currentEvidenceChars, 0, 'outdated evidence counts as zero usable evidence');
    assert.ok(r.outdatedChars > 0);
    assert.ok(r.recoveryReport, 'a recovery report names the cause');
    assert.equal(r.recoveryReport.retryable, false, 'thin evidence is not fixed by retrying — re-fetch first');
    assert.match(r.recoveryReport.ownerAction, /re-fetch|Fetch/i);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold, 'scaffold untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0, 'no revision written');
  });

  it('not a scaffold → no-op, body untouched', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-real', body: CANNED_BODY });
    seedAustinEvidence(db, id);
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /not a scaffold/);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, CANNED_BODY);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('LLM unavailable → no-op, scaffold untouched', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-nollm', body: scaffold });
    seedAustinEvidence(db, id);
    // No env.AI: every free provider is unavailable.
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'no-op');
    assert.match(r.reason, /All free LLM providers unavailable/);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold);
  });

  it('truncated generation (too short / cut off mid-sentence) → failed, retryable, nothing saved', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-trunc', body: scaffold });
    seedAustinEvidence(db, id);
    stubAi(env, 'Austin is a nice city to visit for a weekend trip.');
    const short = await regenerateScaffoldDraft(env, id);
    assert.equal(short.outcome, 'failed', 'a too-short body must not be saved as complete');
    assert.ok(short.recoveryReport, 'recovery report required');
    assert.equal(short.recoveryReport.retryable, true, 'a truncated LLM output is temporary — retryable');
    assert.equal(short.recoveryReport.status, 'RETRYING');
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold);

    stubAi(env, CANNED_BODY.replace(/\.$/, '')); // same body, final period removed: ends mid-sentence
    const cut = await regenerateScaffoldDraft(env, id);
    assert.equal(cut.outcome, 'failed');
    assert.ok(cut.reasons.some((x) => /mid-sentence/.test(x)), `got: ${cut.reasons.join(' | ')}`);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('a published scaffold is refused — regeneration never touches published articles', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-pub', body: scaffold, status: 'published' });
    seedAustinEvidence(db, id);
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'failed');
    assert.match(r.error, /published/);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold);
  });
});

describe('daily article cap — defense in depth in runContentCreation', () => {
  it('refuses generation when today already reached maxArticlesPerDay (default 1)', async () => {
    const { db, env } = freshEnv();
    // One pipeline article already created today (a draft; the 25
    // seed rows are published on an earlier date and do not count).
    // Its body is deliberately DIFFERENT from the canned LLM output:
    // an identical body would be refused as a duplicate (Workstream A
    // task B), and this test is about the cap, not duplicates.
    insertArticle(db, { title: 'Existing Draft Article Today', slug: 'existing-draft-article-today', body: '## Introduction\n\nThis is an unrelated draft about travelling by train through the Scottish Highlands, with notes on rail passes, hostels and walking routes.\n\n## Conclusion\n\nThe Highlands reward slow travel and an early booking.' });
    const itemId = insertResearchItem(db, {
      title: 'Austin travel guide', summary: AUSTIN_EVIDENCE, evidence: AUSTIN_EVIDENCE, url: AUSTIN_URL,
    });
    assert.ok(itemId, 'evidence seeded');
    stubAi(env, CANNED_BODY);
    const capped = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'A Brand New Travel Guide Topic', division: 'travel-lifestyle', sources: [AUSTIN_URL] },
    }, env);
    assert.equal(capped.outcome, 'no-op', JSON.stringify(capped));
    assert.match(capped.reason, /daily-cap-reached/);
    assert.equal(capped.dailyCap, 1, 'default limit is 1 per day');
    assert.equal(capped.createdToday, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE title = 'A Brand New Travel Guide Topic'").get().n, 0, 'nothing generated past the cap');

    // Raise the cap: the same generation now proceeds.
    db.prepare("UPDATE autonomy_settings SET value = '2' WHERE key = 'max_articles_per_day'").run();
    const allowed = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'A Brand New Travel Guide Topic', division: 'travel-lifestyle', sources: [AUSTIN_URL] },
    }, env);
    assert.equal(allowed.outcome, 'done', JSON.stringify(allowed));
    assert.equal(allowed.draft.llmGenerated, true);
  });

  it('regeneration is NOT blocked by the cap (it creates no new article)', async () => {
    const { db, env } = freshEnv();
    // The scaffold itself is the one pipeline article created today,
    // so the cap is already reached — regeneration must still run.
    const id = insertArticle(db, { title: 'Austin in Three Days', slug: 'austin-in-three-days-cap', body: scaffoldBody() });
    seedAustinEvidence(db, id);
    stubAi(env, CANNED_BODY);
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'done', 'regeneration reuses a row — the cap guards new articles only');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 26, 'still 25 seed + 1 regenerated row');
  });
});
