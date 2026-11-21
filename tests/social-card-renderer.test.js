// FS AI — Social card renderer tests (Workstream C, 2026-11-21).
//
// Covers backend/social/card.js (deterministic SVG renderer) and
// scripts/render-social-card.py (Pillow rasterizer, same layout):
// exact platform dimensions, real title verbatim, readable contrast,
// no misleading claims added, deterministic output, and real PNG/JPEG
// files with the right sizes. No platform is ever called.
//
// Run: node --test tests/social-card-renderer.test.js
// The rasterizer part needs python3 + Pillow in this environment; it
// skips (with a clear note) when python3 is unavailable.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  renderSocialCard, cardSpecFor, cardFileName, cardPublicUrl,
  contrastRatio, accentForDivision, CARD_NAVY, CARD_WHITE,
} = require('../backend/social/card.js');

const ROOT = path.join(__dirname, '..');
const TITLE = "How to Read Your Car's Warning Lights";
const FORBIDDEN_ADDED_CLAIMS = ['best', 'guaranteed', '#1', 'number one', 'free!', 'must buy', 'secret trick'];

function pngSize(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'must be a PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function pythonAvailable() {
  try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

describe('card specs (one size per platform)', () => {
  it('Pinterest 1000x1500, Instagram 1080x1350, Facebook 1200x630, LinkedIn 1200x627', () => {
    assert.deepEqual([cardSpecFor('pinterest').width, cardSpecFor('pinterest').height], [1000, 1500]);
    assert.deepEqual([cardSpecFor('instagram').width, cardSpecFor('instagram').height], [1080, 1350]);
    assert.deepEqual([cardSpecFor('facebook').width, cardSpecFor('facebook').height], [1200, 630]);
    assert.deepEqual([cardSpecFor('linkedin').width, cardSpecFor('linkedin').height], [1200, 627]);
    assert.equal(cardSpecFor('instagram').format, 'jpg', 'Instagram needs JPEG');
    assert.equal(cardSpecFor('pinterest').format, 'png');
    assert.equal(cardSpecFor('youtube'), null, 'YouTube is video-only — no card');
    assert.equal(cardSpecFor('x'), null, 'X has no card');
  });

  it('file names and public URLs are deterministic per article+platform', () => {
    assert.equal(cardFileName(5, 'pinterest'), 'article-5-pinterest.png');
    assert.equal(cardFileName(5, 'instagram'), 'article-5-instagram.jpg');
    assert.equal(cardPublicUrl(5, 'pinterest'), 'https://fs-ai-5w5.pages.dev/social-cards/article-5-pinterest.png');
  });
});

describe('renderSocialCard (SVG)', () => {
  it('renders the real title verbatim, the division, the brand and the site — nothing else', () => {
    const card = renderSocialCard({ title: TITLE, divisionSlug: 'automotive', divisionName: 'Automotive', platform: 'pinterest' });
    assert.equal(card.width, 1000);
    assert.equal(card.height, 1500);
    assert.ok(card.svg.includes(TITLE.replace(/'/g, '&apos;')) || card.svg.includes(TITLE), 'title must appear verbatim');
    assert.ok(card.svg.includes('AUTOMOTIVE'), 'division name must appear');
    assert.ok(card.svg.includes('FS AI'), 'brand must appear');
    assert.ok(card.svg.includes('fs-ai-5w5.pages.dev'), 'site URL must appear');
    assert.ok(card.svg.includes(CARD_NAVY), 'dark-navy background must be the pin design');
    assert.ok(card.svg.includes('#2878FF'), 'automotive accent must be the live site plate colour');
    for (const claim of FORBIDDEN_ADDED_CLAIMS) {
      assert.ok(!card.svg.toLowerCase().includes(claim), `renderer must never add the claim "${claim}"`);
    }
  });

  it('is deterministic: same inputs give byte-identical SVG and fingerprint', () => {
    const input = { title: TITLE, divisionSlug: 'ai-technology', divisionName: 'AI & Technology', platform: 'instagram' };
    const a = renderSocialCard(input);
    const b = renderSocialCard(input);
    assert.equal(a.svg, b.svg);
    assert.equal(a.fingerprint, b.fingerprint);
    const other = renderSocialCard({ ...input, title: 'A Different Title Here' });
    assert.notEqual(other.fingerprint, a.fingerprint, 'different title must change the fingerprint');
  });

  it('title contrast is readable: white on navy, and every division label passes 4.5:1', () => {
    assert.ok(contrastRatio(CARD_WHITE, CARD_NAVY) >= 7, 'title contrast must be AAA-grade');
    for (const slug of ['automotive', 'ai-technology', 'gadgets-electronics', 'finance-money', 'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning']) {
      const card = renderSocialCard({ title: TITLE, divisionSlug: slug, divisionName: slug, platform: 'facebook' });
      assert.ok(card.labelContrast >= 4.5, `division ${slug} label contrast ${card.labelContrast} must be >= 4.5:1`);
      assert.ok(card.titleContrast >= 7);
      assert.equal(card.accent, accentForDivision(slug));
    }
  });

  it('truncates a >100-char title to the platform title limit and says so', () => {
    const long = 'How to Save Money on Car Insurance Renewals and Repairs Without Losing Coverage or Paying Too Much Every Single Year for Your Family Car';
    assert.ok(long.length > 100);
    const card = renderSocialCard({ title: long, divisionSlug: 'automotive', divisionName: 'Automotive', platform: 'pinterest' });
    assert.equal(card.titleTruncated, true);
    assert.ok(card.title.length <= 101, 'truncated title stays within the 100-char limit (+ ellipsis)');
    assert.ok(card.title.endsWith('…'));
    assert.ok(card.svg.includes('How to Save Money'));
  });

  it('rejects an unknown platform and an empty title', () => {
    assert.throws(() => renderSocialCard({ title: TITLE, platform: 'x' }), /No card spec/);
    assert.throws(() => renderSocialCard({ title: '   ', platform: 'pinterest' }), /title is required/i);
  });

  it('escapes XML in the title so the SVG stays well-formed', () => {
    const card = renderSocialCard({ title: 'Cats & Dogs <Test> "Quoted"', divisionSlug: 'travel-lifestyle', divisionName: 'Travel', platform: 'linkedin' });
    assert.ok(!card.svg.includes('Cats & Dogs <Test>'), 'raw < & must not appear');
    assert.ok(card.svg.includes('Cats &amp; Dogs &lt;Test&gt;'));
  });
});

describe('render-social-card.py (Pillow rasterizer)', () => {
  it('produces a real 1000x1500 PNG for Pinterest and a 1080x1350 JPEG for Instagram', { skip: !pythonAvailable() }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsai-card-'));
    const png = path.join(dir, 'article-5-pinterest.png');
    execFileSync('python3', [
      path.join(ROOT, 'scripts/render-social-card.py'),
      '--title', TITLE, '--platform', 'pinterest',
      '--division-slug', 'automotive', '--division-name', 'Automotive',
      '--article-id', '5', '--out', png,
    ], { stdio: 'pipe' });
    const pngBuf = fs.readFileSync(png);
    assert.deepEqual(pngSize(pngBuf), { width: 1000, height: 1500 });
    assert.ok(pngBuf.length > 10000, 'PNG must carry real rendered content, not a blank frame');

    const jpg = path.join(dir, 'article-5-instagram.jpg');
    execFileSync('python3', [
      path.join(ROOT, 'scripts/render-social-card.py'),
      '--title', TITLE, '--platform', 'instagram',
      '--division-slug', 'automotive', '--division-name', 'Automotive',
      '--article-id', '5', '--out', jpg,
    ], { stdio: 'pipe' });
    const jpgBuf = fs.readFileSync(jpg);
    assert.equal(jpgBuf.subarray(0, 3).toString('hex'), 'ffd8ff', 'must be a JPEG file');
    assert.ok(jpgBuf.length > 10000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is deterministic: two runs produce byte-identical PNGs', { skip: !pythonAvailable() }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsai-card-'));
    const args = ['--title', TITLE, '--platform', 'pinterest', '--division-slug', 'automotive', '--division-name', 'Automotive', '--article-id', '5'];
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    execFileSync('python3', [path.join(ROOT, 'scripts/render-social-card.py'), ...args, '--out', a], { stdio: 'pipe' });
    execFileSync('python3', [path.join(ROOT, 'scripts/render-social-card.py'), ...args, '--out', b], { stdio: 'pipe' });
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)), 'same inputs must render byte-identical files');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
