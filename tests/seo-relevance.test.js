// FS AI — SEO Related-reading relevance (Workstream A, task A, 2026-11-21).
//
// seo.js must NEVER link an unrelated same-division sibling: the live
// #31 -> #22 link (same division, no topical overlap) is the bug this
// file pins. Relevance is the auto evaluator's own rule (divisions.js
// isInternalLinkRelevant: same division AND topical title-keyword
// overlap, generic words excluded). A relevant link passes; an
// irrelevant / self / draft link fails; a misleading anchor fails; and
// when no relevant sibling exists, repair appends NO link — never a
// fake one to satisfy the SEO check.
//
// Real SQLite database (tests/phase2-harness.js). The seed's article
// #1 ("EV Charging at Home") is the relevant sibling for EV titles;
// fixture bodies are distinct prose so the duplicate check stays out
// of the way. The broken-link check's fetch is stubbed to 200.
// Run: node --test tests/seo-relevance.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { freshEnv, loadArticle } = require('./phase2-harness.js');
const { runSeoCheckSuite, repairSeoFields } = require('../backend/agents/autonomy/seo.js');

function stubFetch(env) {
  env.__fetchImpl = async () => new Response('', { status: 200 });
}

const EV_TITLE = 'EV Charging at Home: A Complete Beginner Guide';
const EV_SEO_TITLE = EV_TITLE;
const EV_SEO_DESC = 'Everything a first-time EV owner needs to know about charging at home, from wall-box costs to overnight charging times and safety checks.';

const EV_BODY = [
  '## Charging at home',
  '',
  'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep.',
  '',
  '## Costs and equipment',
  '',
  'A wall box costs more up front than a three-pin plug, but it charges faster and is safer for daily use. Most drivers find that home charging covers daily driving with ease and saves money every month.',
  '',
  '## Conclusion',
  '',
  'Home charging is the simplest way to keep an electric car ready every morning.',
].join('\n');

function check(suite, name) {
  const c = suite.checks.find((x) => x.name === name);
  assert.ok(c, `check ${name} present`);
  return c;
}

function insertTitledArticle(db, { id, title, body, status = 'published', divisionId = 1, publishedAt = '2026-11-19T00:00:00.000Z' }) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const r = db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
  ).run(id, divisionId, title, slug, 'test excerpt', body, 'FS AI', status, title.slice(0, 60), EV_SEO_DESC, publishedAt);
  return Number(r.lastInsertRowid);
}

describe('SEO Related-reading relevance (task A)', () => {
  it('a link to a genuinely relevant sibling passes internal-links', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    // Seed #1 is "EV Charging at Home: A Complete Beginner's Guide" —
    // same division, topical overlap (charging, home).
    const body = EV_BODY + '\n\nRelated reading: [EV Charging at Home: A Complete Beginner\'s Guide](https://fs-ai-5w5.pages.dev/pages/article?id=1)';
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body, status: 'draft', publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, true, internal.detail);
  });

  it('a link to an unrelated same-division sibling fails, naming the link', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const body = EV_BODY + '\n\nRelated reading: [Best Family Cars Compared: Space, Safety and Running Costs](https://fs-ai-5w5.pages.dev/pages/article?id=12)';
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body, status: 'draft', publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, false, 'an unrelated sibling link must not pass');
    assert.match(internal.detail, /12/, 'the detail names the irrelevant article');
  });

  it('no relevant sibling exists → fails honestly, and repair appends NO link', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    // A division-8 (Education) article: no seed sibling shares its
    // topic, and the seed has no division-8 articles at all.
    const title = 'How to Teach a Parrot to Count to Ten';
    const body = [
      '## Introduction', '',
      'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions.',
      '',
      '## Step by step', '',
      'Start with one object and one word, reward every attempt, and add a second object only when the first is solid.',
      '',
      '## Conclusion', '',
      'Most parrots learn the first three numbers within a few weeks of daily practice.',
    ].join('\n');
    const id = insertTitledArticle(db, { id: 101, title, body, status: 'draft', divisionId: 8, publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, false, 'no relevant sibling — the check must not pass on a fake link');
    assert.match(internal.detail, /no (genuinely )?relevant/i, `got: ${internal.detail}`);
    const repaired = await repairSeoFields(env, loadArticle(db, id));
    assert.equal(repaired.noRelevantLink, true, 'repair reports that no relevant link exists');
    assert.ok(!repaired.article.body.includes('Related reading:'), 'repair appends NO link when none is relevant');
  });

  it('repair picks the relevant sibling over a newer irrelevant one', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    // A NEWER irrelevant published sibling (id 102, later published_at).
    insertTitledArticle(db, {
      id: 102, title: 'Best Family Cars Compared: Space, Safety and Running Costs',
      body: 'A comparison of family cars covering boot space, safety ratings and running costs across three price bands.',
      publishedAt: '2026-11-20T00:00:00.000Z',
    });
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body: EV_BODY, status: 'draft', publishedAt: null });
    const repaired = await repairSeoFields(env, loadArticle(db, id));
    assert.ok(repaired.article.body.includes('article?id=1'), `repair must link the relevant #1, got: ${repaired.article.body.slice(-200)}`);
    assert.ok(!repaired.article.body.includes('article?id=102'), 'repair must NOT link the newer irrelevant sibling');
  });

  it('repair removes an irrelevant Related-reading line and links the relevant sibling instead', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const body = EV_BODY + '\n\nRelated reading: [Best Family Cars Compared: Space, Safety and Running Costs](https://fs-ai-5w5.pages.dev/pages/article?id=12)';
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body, status: 'draft', publishedAt: null });
    const repaired = await repairSeoFields(env, loadArticle(db, id));
    assert.ok(!repaired.article.body.includes('article?id=12'), 'the irrelevant Related-reading line is removed');
    assert.ok(repaired.article.body.includes('article?id=1'), 'the relevant sibling is linked instead');
    assert.ok(repaired.repairs.some((r) => /unrelated|irrelevant/i.test(r)), `a repair note records the removal: ${JSON.stringify(repaired.repairs)}`);
  });

  it('a misleading anchor on a relevant link fails internal-links', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const body = EV_BODY + '\n\nRelated reading: [Click here for cheap holidays and flight deals](https://fs-ai-5w5.pages.dev/pages/article?id=1)';
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body, status: 'draft', publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, false, 'an anchor that misdescribes the target must not pass');
    assert.match(internal.detail, /misleading/i, `got: ${internal.detail}`);
  });

  it('a self-link does not count as an internal link', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const body = EV_BODY + '\n\nRelated reading: [EV Charging at Home: A Complete Beginner Guide](https://fs-ai-5w5.pages.dev/pages/article?id=101)';
    const id = insertTitledArticle(db, { id: 101, title: EV_TITLE, body, status: 'draft', publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, false, 'linking to yourself is not a genuine internal link');
    assert.match(internal.detail, /no (genuinely )?relevant|self/i, `got: ${internal.detail}`);
  });

  it('a relevant DRAFT sibling never counts — no link is faked from it', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    // The only relevant sibling is a draft, in a division with no
    // published relevant article: use a fresh division-8 topic and a
    // draft sibling on the same topic.
    const title = 'How to Teach a Parrot to Count to Ten';
    const body = [
      '## Introduction', '',
      'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions.',
      '',
      '## Step by step', '',
      'Start with one object and one word, reward every attempt, and add a second object only when the first is solid.',
      '',
      '## Conclusion', '',
      'Most parrots learn the first three numbers within a few weeks of daily practice.',
    ].join('\n');
    insertTitledArticle(db, { id: 102, title: 'Teaching a Parrot to Count: A Beginner Method', body, status: 'draft', divisionId: 8, publishedAt: null });
    const id = insertTitledArticle(db, { id: 101, title, body, status: 'draft', divisionId: 8, publishedAt: null });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const internal = check(suite, 'internal-links');
    assert.equal(internal.ok, false, 'a draft sibling must not satisfy the check');
    const repaired = await repairSeoFields(env, loadArticle(db, id));
    assert.equal(repaired.noRelevantLink, true);
    assert.ok(!repaired.article.body.includes('Related reading:'), 'repair does not link a draft sibling');
  });
});
