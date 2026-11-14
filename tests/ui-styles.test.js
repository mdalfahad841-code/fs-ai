// FS AI — UI design styles regression tests (Strategy Fox reel, 2026-11-14).
// Guards the 10-style rollout in frontend/styles/ui-styles.css: the sheet
// exists, every public page links it, all 10 styles + the dashboard
// coverage are present, light-theme overrides exist, and nothing in it can
// widen a 320px phone viewport (layout rules are desktop-only, min-width).
// Run: node --test tests/ui-styles.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'ui-styles.css'), 'utf8');

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

describe('all 10 styles are present', () => {
  it('1. bento grid — home grids and KPI tiles, desktop-only', () => {
    const bento = mediaBlock(CSS, '@media (min-width: 901px)');
    assert.match(bento, /#divisionGrid/);
    assert.match(bento, /#articleGrid/);
    assert.match(bento, /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
    assert.match(bento, /grid-column:\s*span 2/);
  });

  it('2. glassmorphism — frosted header, hero ring, search, login card', () => {
    assert.match(CSS, /\.site-header\s*\{[^}]*backdrop-filter:\s*blur\(14px\)/);
    assert.match(CSS, /\.hero-ring\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(CSS, /#loginCard\s*\{[^}]*backdrop-filter:\s*blur\(16px\)/);
  });

  it('3. neumorphism — pressed tool chips and inset fields', () => {
    assert.match(CSS, /\.tool-chip\.active\s*\{[^}]*box-shadow:\s*inset/);
    assert.match(CSS, /\.field input, \.field select, \.field textarea\s*\{[^}]*box-shadow:\s*inset/);
  });

  it('4. claymorphism — puffy tool cards and KPI tiles', () => {
    assert.match(CSS, /\.tool-card, \.kpi-card\s*\{[^}]*border-radius:\s*26px/);
    assert.match(CSS, /--clay-shadow:/);
  });

  it('5. neo-brutalism — tags, pills and the honest-numbers box', () => {
    assert.match(CSS, /\.card-tag\s*\{[^}]*box-shadow:\s*3px 3px 0/);
    assert.match(CSS, /\.status-pill\s*\{[^}]*border:\s*2px solid currentColor/);
    assert.match(CSS, /\.note-box\s*\{[^}]*box-shadow:\s*5px 5px 0/);
  });

  it('6. minimalism — article reading page and dashboard tables/logs', () => {
    assert.match(CSS, /\.article-body h2, \.article-full h2\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/);
    assert.match(CSS, /\.dashboard-section ul\.clean li\s*\{[^}]*padding:\s*14px 2px/);
  });

  it('7. retro Y2K — chrome accent, restrained to brand + hero', () => {
    assert.match(CSS, /--chrome:\s*linear-gradient/);
    assert.match(CSS, /\.brand-mark\s*\{[^}]*background:\s*var\(--chrome\)/);
    assert.match(CSS, /\.hero h1 span, \.hero-ring strong\s*\{[^}]*background:\s*var\(--chrome\)/);
  });

  it('8. liquid glass — hero blobs, newsletter, autonomy section', () => {
    assert.match(CSS, /\.hero::before\s*\{[^}]*animation:\s*liquidDrift/);
    assert.match(CSS, /@keyframes liquidDrift/);
    assert.match(CSS, /\.newsletter\s*\{[^}]*backdrop-filter:\s*blur\(14px\)/);
    assert.match(CSS, /#section-autonomy\s*\{[^}]*backdrop-filter:\s*blur\(12px\)/);
  });

  it('9. flat design — icon chips, table headers, labels', () => {
    assert.match(CSS, /\.div-icon\s*\{[^}]*background:\s*var\(--surface-2\)/);
    assert.match(CSS, /th\s*\{\s*background:\s*var\(--surface-2\);/);
    assert.match(CSS, /\.kpi-label\s*\{[^}]*text-transform:\s*uppercase/);
  });

  it('10. skeuomorphism — physical toggles, alarm buttons, sign-in', () => {
    assert.match(CSS, /\.theme-toggle, \.nav-toggle\s*\{[^}]*border-bottom-width:\s*3px/);
    assert.match(CSS, /#emergencyStopBtn, #autonomyStopBtn\s*\{[^}]*border-bottom-width:\s*4px/);
    assert.match(CSS, /#demoLoginForm \.btn-primary\s*\{[^}]*border-bottom-width:\s*3px/);
  });
});

describe('dashboard coverage (Command Center)', () => {
  it('login gate card, autonomy section and stop buttons are styled', () => {
    assert.match(CSS, /#loginCard/);
    assert.match(CSS, /#section-autonomy/);
    assert.match(CSS, /#emergencyStopBtn/);
    assert.match(CSS, /#autonomyStopBtn/);
  });

  it('KPI tiles, status pills and tables carry the dashboard styles', () => {
    assert.match(CSS, /\.kpi-card/);
    assert.match(CSS, /\.status-pill/);
    assert.match(CSS, /\.table-scroll th, \.table-scroll td/);
  });
});

describe('themes and phone safety', () => {
  it('light-theme overrides exist for the styles that need them', () => {
    const lightRules = CSS.match(/:root\[data-theme="light"\]/g) || [];
    assert.ok(lightRules.length >= 8, 'expected light-theme overrides, found ' + lightRules.length);
  });

  it('no layout rule applies below desktop widths', () => {
    assert.ok(!CSS.includes('@media (max-width:'), 'ui-styles.css must not add max-width layout rules');
  });

  it('liquid-glass motion respects reduced-motion', () => {
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(CSS, /\.hero::before, \.hero::after\s*\{\s*animation:\s*none/);
  });

  it('any fixed width above 320px is clipped inside the hero (overflow hidden)', () => {
    // The liquid-glass blobs are 420px/360px, but they sit inside .hero,
    // which main.css gives overflow: hidden — they can never widen the page.
    const withoutBlobs = CSS.replace(/\.hero::(before|after)\s*\{[^}]*\}/g, '');
    const widths = [...withoutBlobs.matchAll(/(?<!min-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of widths) assert.ok(w <= 320, 'fixed width ' + w + 'px exceeds a 320px viewport');
    assert.match(CSS, /\.hero::before\s*\{[^}]*width:\s*420px/);
  });
});

describe('mapping doc', () => {
  it('docs/UI-STYLES-2026-11-14.md lists all 10 styles and the dashboard', () => {
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
  });
});
