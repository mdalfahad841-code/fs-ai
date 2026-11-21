// FS AI — eight-division support tests (W3).
//
// Every division must have: independent research sources (the 3
// verified RSS feeds per division from migration 008, 24 total),
// editorial rules, internal-link scoping, a schedule slot in the
// 8-day rotation (global max 1 article/day still wins), social
// distribution hooks (hooks only — nothing auto-posts), and, for
// Health & Wellness and Finance & Money Education, a mandatory
// special-review gate (never auto-publishable) plus authoritative
// source rules for professional-advice claims.
//
// Pure config tests + one live-D1 check that research_sources really
// holds 3 active sources per division (seed 008). Run:
// node --test tests/divisions-support.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  DIVISION_CONFIG, getDivisionConfig, isSpecialReviewDivision,
  isInternalLinkRelevant, extractLinkedArticleIds,
  adviceClaimNeedsAuthority, isAuthoritativeSource, divisionDueOnDay,
} = require('../backend/publishing/divisions.js');
const { getDivisionSupportStatus } = require('../backend/routes/divisions.js');

const ROOT = path.join(__dirname, '..');

const EXPECTED_SLUGS = [
  'automotive', 'ai-technology', 'gadgets-electronics', 'finance-money',
  'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning',
];

describe('all eight divisions are configured', () => {
  it('exactly 8 divisions, one per expected slug', () => {
    assert.equal(DIVISION_CONFIG.length, 8);
    assert.deepEqual(DIVISION_CONFIG.map((d) => d.slug), EXPECTED_SLUGS);
  });

  it('every division has 3 named research sources, editorial rules, link scope, schedule slot and social hooks', () => {
    for (const d of DIVISION_CONFIG) {
      assert.equal(d.sources.length, 3, `${d.slug}: 3 sources`);
      for (const s of d.sources) {
        assert.ok(s.name && s.url && s.url.startsWith('https://'), `${d.slug}: source ${s.name} needs an https URL`);
      }
      assert.ok(d.editorial.tone, `${d.slug}: tone`);
      assert.equal(d.editorial.minWords, 600, `${d.slug}: minWords`);
      assert.equal(d.editorial.maxWords, 900, `${d.slug}: maxWords`);
      assert.ok(d.editorial.minSources >= 1, `${d.slug}: minSources`);
      assert.ok(d.internalLinkScope.includes('Same division'), `${d.slug}: link scope`);
      assert.equal(d.schedule.cycleDays, 8, `${d.slug}: 8-day rotation`);
      assert.ok(Number.isInteger(d.schedule.dayOffset) && d.schedule.dayOffset >= 0 && d.schedule.dayOffset < 8, `${d.slug}: dayOffset 0-7`);
      assert.equal(d.social.youtube, true, `${d.slug}: youtube hook`);
      assert.equal(d.social.pinterest, true, `${d.slug}: pinterest hook`);
      assert.match(d.social.note, /nothing posts automatically/i, `${d.slug}: social is hooks-only`);
    }
    // Schedule slots are unique — one division per rotation day.
    const offsets = DIVISION_CONFIG.map((d) => d.schedule.dayOffset);
    assert.equal(new Set(offsets).size, 8, 'dayOffsets must be unique');
  });

  it('divisionDueOnDay follows the rotation', () => {
    assert.equal(divisionDueOnDay('automotive', 0), true);
    assert.equal(divisionDueOnDay('automotive', 1), false);
    assert.equal(divisionDueOnDay('automotive', 8), true, 'rotation repeats every 8 days');
    assert.equal(divisionDueOnDay('education-learning', 7), true);
    assert.equal(divisionDueOnDay('nope', 0), false);
  });

  it('getDivisionSupportStatus reports all 8 with sources and rules', () => {
    const status = getDivisionSupportStatus();
    assert.equal(status.length, 8);
    for (const row of status) {
      assert.equal(row.sourceCount, 3, row.slug);
      assert.ok(row.editorial && row.schedule && row.social, row.slug);
      assert.equal(typeof row.specialReview, 'boolean', row.slug);
    }
  });

  it('live D1: research_sources holds 3 sources per division (seed 008)', () => {
    const db = new DatabaseSync(':memory:');
    const execFile = (f) => db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    execFile('database/schema.sql');
    execFile('database/migrations/005_autonomy.sql');
    execFile('database/seed.sql');
    execFile('database/migrations/008_research.sql');
    const rows = db.prepare(
      'SELECT d.slug, COUNT(rs.id) AS n FROM business_divisions d LEFT JOIN research_sources rs ON rs.division_id = d.id GROUP BY d.slug ORDER BY d.id',
    ).all();
    assert.equal(rows.length, 8);
    for (const r of rows) assert.equal(r.n, 3, `${r.slug} must have 3 research sources`);
    const total = db.prepare("SELECT COUNT(*) AS n FROM research_sources WHERE is_active = 1").get().n;
    assert.equal(total, 24, '24 active RSS sources total');
  });
});

describe('Health & Finance special review', () => {
  it('only health-wellness and finance-money are special-review, and never auto-publishable', () => {
    assert.equal(isSpecialReviewDivision('health-wellness'), true);
    assert.equal(isSpecialReviewDivision('finance-money'), true);
    for (const slug of EXPECTED_SLUGS.filter((s) => s !== 'health-wellness' && s !== 'finance-money')) {
      assert.equal(isSpecialReviewDivision(slug), false, slug);
    }
    for (const d of DIVISION_CONFIG) {
      assert.equal(d.neverAutoPublish, d.specialReview, d.slug);
    }
    assert.ok(getDivisionConfig('health-wellness').editorial.minSources >= 2, 'health needs >= 2 sources');
    assert.ok(getDivisionConfig('finance-money').editorial.minSources >= 2, 'finance needs >= 2 sources');
    assert.ok(getDivisionConfig('health-wellness').authoritativeHosts.length > 0);
    assert.ok(getDivisionConfig('finance-money').authoritativeHosts.length > 0);
  });

  it('advice claims are detected; generic encouragement is not', () => {
    assert.equal(adviceClaimNeedsAuthority('Take 500 mg per day for best results.').needsAuthority, true);
    assert.equal(adviceClaimNeedsAuthority('You should invest in shares for guaranteed returns.').needsAuthority, true);
    assert.equal(adviceClaimNeedsAuthority('See your doctor if symptoms of chest pain appear.').needsAuthority, true);
    assert.equal(adviceClaimNeedsAuthority('Walking every day is a simple healthy habit.').needsAuthority, false);
    assert.equal(adviceClaimNeedsAuthority('Save a little money each month.').needsAuthority, false);
  });

  it('authoritative sources: named hosts + .gov/.edu count; blogs do not', () => {
    assert.equal(isAuthoritativeSource('https://www.who.int/news/item/123', 'health-wellness'), true);
    assert.equal(isAuthoritativeSource('https://www.nih.gov/news', 'health-wellness'), true);
    assert.equal(isAuthoritativeSource('https://www.investor.gov/introduction-investing', 'finance-money'), true);
    assert.equal(isAuthoritativeSource('https://www.gov.uk/guidance/tax', 'finance-money'), true);
    assert.equal(isAuthoritativeSource('https://example.com/blog-post', 'health-wellness'), false);
    assert.equal(isAuthoritativeSource('https://www.who.int/news', 'finance-money'), false, 'a health authority is not a finance authority');
    assert.equal(isAuthoritativeSource('not a url', 'health-wellness'), false);
  });
});

describe('internal-link relevance', () => {
  const article = { division_id: 1, title: 'Electric Car Charging Guide' };
  it('same division + shared title keyword is relevant', () => {
    assert.equal(isInternalLinkRelevant(article, { division_id: 1, title: 'Electric Car Maintenance Checklist' }), true);
  });
  it('same division without topical overlap is NOT relevant (#31 -> #22 trap)', () => {
    assert.equal(isInternalLinkRelevant(article, { division_id: 1, title: 'Motorcycle Buying Guide' }), false);
  });
  it('another division is NOT relevant even with overlapping words', () => {
    assert.equal(isInternalLinkRelevant(article, { division_id: 5, title: 'Electric Car Road Trips' }), false);
  });
  it('extractLinkedArticleIds finds ?id= links', () => {
    assert.deepEqual(
      extractLinkedArticleIds('See https://fs-ai-5w5.pages.dev/pages/article?id=22 and ?id=31 too.'),
      [22, 31]);
    assert.deepEqual(extractLinkedArticleIds('No links here.'), []);
  });
});
