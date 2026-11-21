// FS AI — truncation guard end-to-end (Workstream A, task D, 2026-11-21).
//
// A truncated article must NEVER pass the gate. This file proves the
// guard (isTruncatedDraftBody in factcheck.js) is wired into the FULL
// path, not just unit-tested:
//   generation → runContentCreation refuses a truncated LLM body;
//   SEO      → runSeoCheckOnly stores verdict 'failed' with a
//              'truncation' entry, and the auto-publish evaluator
//              refuses on seo-fresh-pass;
//   correction → runCorrection fails a truncated assembled body
//              (truncatedCorrection, retryable) and saves nothing;
//   scaffold regeneration → a generated body with unclosed HTML or
//              missing outline sections fails, nothing saved;
//   unit     → a complete body missing a required outline heading is
//              flagged as truncated.
// Real SQLite database (tests/phase2-harness.js). The LLM is stubbed
// through env.AI. Run: node --test tests/truncation-e2e.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  freshEnv, loadArticle, insertArticle, insertResearchItem, addArticleSource,
} = require('./phase2-harness.js');
const { isTruncatedDraftBody, checkArticle, runCorrection } = require('../backend/agents/autonomy/factcheck.js');
const { runSeoCheckOnly } = require('../backend/agents/autonomy/seo.js');
const { runContentCreation, regenerateScaffoldDraft } = require('../backend/agents/autonomy/content.js');
const { evaluateAutoPublishEligibility } = require('../backend/publishing/gate.js');

function stubFetch(env) {
  env.__fetchImpl = async () => new Response('', { status: 200 });
}

function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

// A complete, well-formed body (control: must NOT be flagged).
const COMPLETE_BODY = [
  '## Introduction', '',
  'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions.',
  '',
  '## Step by step', '',
  'Start with one object and one word, reward every attempt, and add a second object only when the first is solid.',
  '',
  '## Conclusion', '',
  'Most parrots learn the first three numbers within a few weeks of daily practice.',
].join('\n');

const PARROT_EVIDENCE = 'Parrots can learn to count small numbers through repetition and reward. Training works best in short daily sessions with treats, starting with one object and one word. Most parrots learn the first three numbers within a few weeks, and some continue to higher numbers with months of patient play. Counting should stay a game, never a test. Parrots respond best to a calm voice, a consistent routine and a favourite treat after every correct answer. Sessions longer than ten minutes lose the bird’s attention, so trainers stop while the parrot is still engaged.';

// Scaffold shape (from tests/content-scaffold-regen.test.js) for the
// regeneration test, with Austin evidence above the 1000-char floor.
const AUSTIN_URL = 'https://example.com/austin-guide';
const AUSTIN_EVIDENCE = 'Austin is the capital of Texas and is known for live music, food trucks and warm weather. Visitors can walk around the downtown area, swim at Barton Springs Pool and listen to bands on Sixth Street. A three-day visit works well with one day downtown, one day outdoors and one day for food and music. Barton Springs Pool is a spring-fed pool in Zilker Park, kept at about 20 degrees Celsius all year, and Zilker Park also holds the Zilker Botanical Garden and the hike-and-bike trail around Lady Bird Lake. The Texas State Capitol stands at the north end of Congress Avenue and offers free guided tours of the pink-granite building. In the evening, Mexican free-tailed bats emerge from under the Congress Avenue Bridge between March and October, a free spectacle best watched from the bridge or a boat on the lake. Food trucks cluster around South Congress and East Austin, serving tacos, barbecue brisket, breakfast tacos and vegetarian meals, while the South Congress strip has vintage shops, boots and murals. South by Southwest brings film, music and technology visitors every March, so hotels should be booked early in that month. Public buses cover the centre, but most visitors walk downtown and use a rideshare for the districts further out.';

function scaffoldBody(headings = ['Introduction', 'Getting there', 'Where to stay', 'What to see', 'Food and costs', 'Conclusion']) {
  return [
    'SCAFFOLD — full draft needed.',
    '',
    'This draft was created from an agent scaffold. No article body was fabricated: '
    + 'the owner (or an LLM) must write the full body, add sources and pass fact-checking before approval.',
    '',
    ...headings.map((h) => `## ${h}\n\n[Write this section — no content yet.]`),
    '',
    'Sources:',
    '- https://example.com/austin-guide',
  ].join('\n');
}

describe('truncation guard — generation (task D)', () => {
  it('a generated body cut off mid-sentence is a no-op, never a draft', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Parrot counting', summary: PARROT_EVIDENCE, evidence: PARROT_EVIDENCE, url: 'https://example.com/parrot-counting' });
    stubAi(env, 'Teaching a parrot to count is a slow process built on repetition, and the trainer should start with one object and one word and then add a second object only when the first is solid and the bird is still engaged and ready to');
    const r = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    }, env);
    assert.equal(r.outcome, 'no-op', JSON.stringify(r));
    assert.match(r.reason, /truncated-generation/);
    assert.ok(r.truncationReasons.some((x) => /mid-sentence/.test(x)), `got: ${JSON.stringify(r.truncationReasons)}`);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE title = 'How to Teach a Parrot to Count'").get().n, 0, 'no draft was written');
  });

  it('a complete generated body still passes generation', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Parrot counting', summary: PARROT_EVIDENCE, evidence: PARROT_EVIDENCE, url: 'https://example.com/parrot-counting' });
    stubAi(env, COMPLETE_BODY);
    const r = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    }, env);
    assert.equal(r.outcome, 'done', JSON.stringify(r));
  });
});

describe('truncation guard — SEO suite + publish gate (task D)', () => {
  it('a truncated AI-DRAFT stores SEO verdict failed with a truncation entry, and the evaluator refuses it', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const truncated = 'AI-DRAFT — needs fact-check + owner approval.\n\n## Introduction\n\nTeaching a parrot to count is a slow process built on repetition, and the trainer should start with one object and one word and then add a second object only when the first is solid and the bird is still engaged and ready to';
    const id = insertArticle(db, truncated, { id: 101, seoTitle: 'How to Teach a Parrot to Count', seoDescription: 'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions with rewards.' });
    const result = await runSeoCheckOnly(env, loadArticle(db, id));
    assert.equal(result.verdict, 'failed', `truncation must force verdict failed, got: ${JSON.stringify(result.checks.map((c) => [c.name, c.ok]))}`);
    const truncation = result.checks.find((c) => c.name === 'truncation');
    assert.ok(truncation, 'a truncation check entry exists');
    assert.equal(truncation.ok, false);
    assert.match(truncation.detail, /mid-sentence/i);
    const stored = db.prepare('SELECT * FROM seo_checks WHERE article_id = ?').get(id);
    assert.ok(stored, 'the seo_checks row was stored');
    assert.equal(stored.verdict, 'failed', 'the stored verdict is failed, not pass/needs-review');
    assert.ok(JSON.parse(stored.checks_json).some((c) => c.name === 'truncation' && c.ok === false));
    // The gate: the evaluator must refuse on the SEO check, so this
    // draft can never auto-publish while truncated.
    const verdict = await evaluateAutoPublishEligibility(env, id);
    assert.equal(verdict.eligible, false);
    const seoCheck = (verdict.checks || []).find((c) => c.name === 'seo-fresh-pass');
    assert.ok(seoCheck, 'the evaluator has a seo-fresh-pass check');
    assert.equal(seoCheck.ok, false, `seo-fresh-pass must fail for a truncated draft: ${seoCheck.detail}`);
  });

  it('a complete body does not get a truncation entry', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, COMPLETE_BODY, { id: 101, seoTitle: 'How to Teach a Parrot to Count', seoDescription: 'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions with rewards.' });
    const result = await runSeoCheckOnly(env, loadArticle(db, id));
    assert.equal(result.checks.filter((c) => c.name === 'truncation').length, 0, 'no truncation entry for a complete body');
    assert.equal(result.checks.length, 11, 'the suite stays 11 checks when nothing is truncated');
  });
});

describe('truncation guard — correction (task D)', () => {
  it('a correction whose assembled body has unclosed markup fails, retryable, body unchanged', async () => {
    const { db, env } = freshEnv();
    // Seed the evidence the fact-checker needs for its EV claims.
    insertResearchItem(db, { title: 'EV sales', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.', url: 'https://example.com/source-1' });
    const originalBody = 'EV sales reached 20 million units worldwide in 2023, according to industry reports. [The Guardian](https://example.com/ev-guide)';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.claimsFailed, 1, 'only the wrong-number claim fails');
    // The LLM rewrite is a complete sentence but leaves an unclosed
    // <p> tag INSIDE the corrected sentence (runCorrection takes the
    // rewrite's first sentence as the corrected claim text, so the tag
    // must sit there, not in a trailing sentence). The diff-based
    // guard cannot see it (the ending is fine), so the absolute guard
    // must catch it.
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the <p>International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'failed', JSON.stringify(r));
    assert.equal(r.truncatedCorrection, true, 'the failure is flagged as a truncated correction');
    assert.equal(r.recoveryReport.retryable, true, 'a truncated LLM output is temporary — retryable');
    assert.ok(r.recoveryReport.reasons.some((x) => /unclosed HTML tag <p>/i.test(x)), `got: ${JSON.stringify(r.recoveryReport.reasons)}`);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, originalBody, 'pre-edit body preserved exactly');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n, 0, 'no revision row for a truncated correction');
  });
});

describe('truncation guard — scaffold regeneration (task D)', () => {
  it('a generated body with unclosed HTML and a missing Conclusion fails, nothing saved', async () => {
    const { db, env } = freshEnv();
    const scaffold = scaffoldBody();
    const id = insertArticle(db, scaffold, { id: 101 });
    const itemId = insertResearchItem(db, { title: 'Austin travel guide', summary: AUSTIN_EVIDENCE, evidence: AUSTIN_EVIDENCE, url: AUSTIN_URL });
    addArticleSource(db, id, AUSTIN_URL, itemId, 'Austin travel guide');
    stubAi(env,
      '## Introduction\n\nAustin is the capital of Texas and is known for live music, food trucks and warm weather.\n\n'
      + '## Getting there\n\nMost visitors arrive by plane or by car, and the downtown area is easy to walk once you have arrived.\n\n'
      + '## Where to stay\n\nStaying downtown keeps the music venues and restaurants within easy walking distance.\n\n'
      + '## What to see\n\nVisitors can walk around the downtown area and swim at Barton Springs Pool.\n\n'
      + '<p>Food trucks serve tacos, barbecue and vegetarian meals at prices that suit a modest travel budget.');
    const r = await regenerateScaffoldDraft(env, id);
    assert.equal(r.outcome, 'failed', JSON.stringify(r));
    assert.ok(r.reasons.some((x) => /unclosed HTML tag <p>/i.test(x)), `got: ${JSON.stringify(r.reasons)}`);
    assert.ok(r.reasons.some((x) => /missing required section.*Conclusion/i.test(x)), `got: ${JSON.stringify(r.reasons)}`);
    assert.equal(r.recoveryReport.retryable, true);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, scaffold, 'scaffold untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });
});

describe('isTruncatedDraftBody — required sections (task D)', () => {
  it('a complete body missing a required outline heading is flagged', () => {
    const t = isTruncatedDraftBody(COMPLETE_BODY, { requiredHeadings: ['Introduction', 'Step by step', 'Conclusion', 'Sources and further reading'] });
    assert.ok(t, 'a missing required section must be flagged');
    assert.ok(t.reasons.some((x) => /missing required section.*Sources and further reading/i.test(x)), `got: ${JSON.stringify(t.reasons)}`);
  });

  it('the same body with all required headings present is not flagged', () => {
    assert.equal(isTruncatedDraftBody(COMPLETE_BODY, { requiredHeadings: ['Introduction', 'Step by step', 'Conclusion'] }), null);
  });

  it('an unclosed markdown fence is flagged', () => {
    const t = isTruncatedDraftBody('## Intro\n\nSome text here.\n\n```js\nconst x = 1;\n');
    assert.ok(t, 'an odd fence count must be flagged');
    assert.ok(t.reasons.some((x) => /unclosed markdown code fence/i.test(x)));
  });

  it('a short body that ends cleanly is NOT flagged (shortness alone is not truncation)', () => {
    const short = 'Austin is a nice city to visit for a weekend trip.';
    assert.equal(isTruncatedDraftBody(short), null, 'a complete 11-word body is short, not truncated');
  });
});
