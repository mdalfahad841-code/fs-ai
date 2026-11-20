// FS AI — quiet UI layer regression tests (unslop run, 2026-11-20).
// Guards the unslop redesign in frontend/styles/ui-styles.css: the sheet
// exists, every public page links it, the keepers (bento grid, minimalism,
// flat design) are present, the removed effect styles stay removed, light
// theme overrides exist, and nothing in it can widen a 320px phone viewport
// (layout rules are desktop-only, min-width).
// History: this file guarded the November 14 Strategy Fox rollout (10 effect
// styles). The owner ordered unslop applied to the FS AI site first, and the
// audit found those effects were the slop itself, so the assertions were
// rewritten on 2026-11-20 to guard the quiet layer instead — same number of
// checks, same exact-value style, opposite values. See
// docs/UNSLOP-FS-AI-REPORT-2026-11-20.md.
// Run: node --test tests/ui-styles.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'ui-styles.css'), 'utf8');
const MAIN = fs.readFileSync(path.join(FRONTEND, 'styles', 'main.css'), 'utf8');
const ANIM = fs.readFileSync(path.join(FRONTEND, 'styles', 'animations.css'), 'utf8');
const THEMES = fs.readFileSync(path.join(FRONTEND, 'styles', 'themes.css'), 'utf8');
const ALL = MAIN + '\n' + CSS;

/* Every page that ships the site design links the sheet last, after
   themes.css. owner-setup.html is deliberately excluded: it is a standalone
   phone-only password-hash utility with inline styles and no site chrome. */
const LINKED_PAGES = [
  ['index.html', 'styles/ui-styles.css'],
  ['404.html', '/styles/ui-styles.css'],
  ['pages/about.html', '../styles/ui-styles.css'],
  ['pages/article.html', '../styles/ui-styles.css'],
  ['pages/contact.html', '../styles/ui-styles.css'],
  ['pages/dashboard.html', '../styles/ui-styles.css'],
  ['pages/division.html', '../styles/ui-styles.css'],
  ['pages/privacy.html', '../styles/ui-styles.css'],
  ['pages/terms.html', '../styles/ui-styles.css'],
  ['pages/tools.html', '../styles/ui-styles.css'],
];

function balancedBraces(css) {
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      assert.ok(depth >= 0, 'unbalanced closing brace');
    }
  }
  assert.equal(depth, 0, 'unbalanced braces');
}

function mediaBlock(css, query) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, query + ' must exist');
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces after ' + query);
}

describe('ui-styles.css exists and parses', () => {
  it('is present and non-trivial', () => {
    assert.ok(CSS.length > 2000, 'stylesheet looks too small: ' + CSS.length + ' chars');
  });

  it('has balanced braces', () => {
    balancedBraces(CSS);
  });
});

describe('every site page links the stylesheet last', () => {
  for (const [page, href] of LINKED_PAGES) {
    it(page + ' links ' + href, () => {
      const html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
      assert.ok(html.includes('<link rel="stylesheet" href="' + href + '">'), page + ' must link ui-styles.css');
      assert.ok(
        html.indexOf('themes.css') < html.indexOf('ui-styles.css'),
        page + ' must load ui-styles.css after themes.css'
      );
    });
  }

  it('owner-setup.html stays standalone (no site stylesheets)', () => {
    const html = fs.readFileSync(path.join(FRONTEND, 'pages', 'owner-setup.html'), 'utf8');
    assert.ok(!html.includes('styles/main.css'), 'owner-setup must not gain site CSS');
    assert.ok(!html.includes('ui-styles.css'), 'owner-setup must not gain ui-styles.css');
  });
});

describe('the keepers are present and the effect styles stay removed', () => {
  it('1. bento grid — home grids and KPI tiles, desktop-only', () => {
    const bento = mediaBlock(CSS, '@media (min-width: 901px)');
    assert.match(bento, /#divisionGrid/);
    assert.match(bento, /#articleGrid/);
    assert.match(bento, /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
    assert.match(bento, /grid-column:\s*span 2/);
  });

  it('2. no glass — no frosted panels, no hero ring', () => {
    assert.ok(!CSS.includes('backdrop-filter'), 'frosted glass must stay removed');
    assert.ok(!CSS.includes('.hero-ring'), 'the glowing hero ring must stay removed');
  });

  it('3. no neumorphism — no pressed or inset shadows', () => {
    assert.doesNotMatch(CSS, /box-shadow:[^;]*inset/);
  });

  it('4. no clay — no puffy radius, no clay shadow', () => {
    assert.ok(!CSS.includes('--clay-shadow'), 'clay shadow variable must stay removed');
    assert.ok(!CSS.includes('26px'), '26px clay radius must stay removed');
  });

  it('5. no neo-brutalism — no hard offset shadows or thick pill borders', () => {
    assert.ok(!CSS.includes('3px 3px 0'), 'hard tag shadow must stay removed');
    assert.ok(!CSS.includes('5px 5px 0'), 'hard note-box shadow must stay removed');
    assert.ok(!CSS.includes('2px solid currentColor'), 'thick pill border must stay removed');
  });

  it('6. minimalism — article reading page and dashboard tables/logs', () => {
    assert.match(CSS, /\.article-body h2, \.article-full h2\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/);
    assert.match(CSS, /\.dashboard-section ul\.clean li\s*\{[^}]*padding:\s*12px 0/);
  });

  it('7. no chrome gradient — no gradient text, no gradient tile', () => {
    assert.ok(!CSS.includes('--chrome'), 'chrome gradient variable must stay removed');
    assert.ok(!CSS.includes('linear-gradient'), 'hue gradients must stay removed');
    assert.ok(!CSS.includes('radial-gradient'), 'radial washes must stay removed');
  });

  it('8. no liquid motion — no drifting blobs', () => {
    assert.ok(!CSS.includes('liquidDrift'), 'liquid drift animation must stay removed');
    assert.ok(!CSS.includes('@keyframes liquidDrift'), 'liquid drift keyframes must stay removed');
  });

  it('9. flat design — icon chips, table headers, sentence-case labels', () => {
    assert.match(CSS, /\.div-icon\s*\{[^}]*background:\s*var\(--surface-2\)/);
    assert.match(CSS, /th\s*\{\s*background:\s*var\(--surface-2\);/);
    assert.match(CSS, /\.kpi-label\s*\{[^}]*letter-spacing:\s*\.01em/);
    assert.doesNotMatch(CSS, /text-transform:\s*uppercase/);
  });

  it('10. no skeuomorphism — no chunky bottom borders on controls', () => {
    assert.ok(!CSS.includes('border-bottom-width'), 'physical-button bottom borders must stay removed');
  });
});

describe('dashboard coverage (Command Center)', () => {
  it('login gate card, autonomy section and stop buttons are styled', () => {
    assert.match(ALL, /#loginCard/);
    assert.match(ALL, /#section-autonomy/);
    assert.match(ALL, /#emergencyStopBtn/);
    assert.match(ALL, /#autonomyStopBtn/);
  });

  it('KPI tiles, status pills and tables carry the dashboard styles', () => {
    assert.match(ALL, /\.kpi-card/);
    assert.match(ALL, /\.status-pill/);
    assert.match(ALL, /\.table-scroll th, \.table-scroll td/);
  });
});

describe('themes and phone safety', () => {
  it('light-theme overrides exist for the quiet layer and the paper ramp', () => {
    const lightRules = CSS.match(/:root\[data-theme="light"\]/g) || [];
    assert.ok(lightRules.length >= 2, 'expected light-theme overrides in ui-styles.css, found ' + lightRules.length);
    assert.ok(THEMES.includes('#f7f4ee'), 'light theme must use the warm paper ramp');
  });

  it('no layout rule applies below desktop widths', () => {
    assert.ok(!CSS.includes('@media (max-width:'), 'ui-styles.css must not add max-width layout rules');
  });

  it('motion is quiet — one short entrance, no loops, reduced-motion respected', () => {
    assert.doesNotMatch(ANIM, /heroGlow/);
    assert.doesNotMatch(ANIM, /liquidDrift/);
    assert.match(ANIM, /\.reveal\s*\{[^}]*translateY\(8px\)/);
    assert.match(ANIM, /\.reveal\s*\{[^}]*\.4s/);
    assert.match(ANIM, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.match(ANIM, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it('no fixed width above 320px anywhere in the sheet', () => {
    const widths = [...CSS.matchAll(/(?<!min-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of widths) assert.ok(w <= 320, 'fixed width ' + w + 'px exceeds a 320px viewport');
  });
});

describe('mapping doc', () => {
  it('docs/UI-STYLES-2026-11-14.md lists all 10 styles and the dashboard, and records that unslop superseded them', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'UI-STYLES-2026-11-14.md'), 'utf8');
    for (const name of [
      'Skeuomorphism', 'Minimalism', 'Glassmorphism', 'Neumorphism',
      'Claymorphism', 'Neo-brutalism', 'Bento grid', 'Retro Y2K',
      'Liquid glass', 'Flat design',
    ]) {
      assert.ok(doc.includes(name), 'doc must name ' + name);
    }
    assert.ok(doc.includes('Command Center'), 'doc must cover the dashboard');
    assert.ok(doc.includes('owner-setup'), 'doc must record the owner-setup exclusion');
    assert.ok(doc.includes('Superseded'), 'doc must record that the unslop run superseded the 10 styles');
    const report = fs.readFileSync(path.join(ROOT, 'docs', 'UNSLOP-FS-AI-REPORT-2026-11-20.md'), 'utf8');
    assert.ok(report.includes('Direction'), 'unslop report must state the direction');
    assert.ok(report.includes('Plain-spoken, honest, unhurried'), 'unslop report must state the character');
  });
});
