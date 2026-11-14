// FS AI — mobile overflow regression tests (CSS-level assertions).
// Guards the measured 2026-11-14 failure: the logged-in Command Center
// rendered 501px wide at a 320px viewport (51 overflowing elements),
// because the two-column phone KPI grid could not shrink below the
// min-content of the live "Data unavailable" traffic value.
// Run: node --test tests/mobile-overflow.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stylesDir = path.join(__dirname, '..', 'frontend', 'styles');
const mainCss = fs.readFileSync(path.join(stylesDir, 'main.css'), 'utf8');
const responsiveCss = fs.readFileSync(path.join(stylesDir, 'responsive.css'), 'utf8');

/* The rules that apply at phone widths live in the max-width: 640px block.
   Extract it (balanced-brace scan, since the block holds several rules). */
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

const phone = mediaBlock(responsiveCss, '@media (max-width: 640px)');
const tablet = mediaBlock(responsiveCss, '@media (max-width: 900px)');

describe('phone KPI grid (measured 501px page at 320px, 2026-11-14)', () => {
  it('is single-column at phone widths, not 1fr 1fr', () => {
    const rule = phone.match(/\.kpi-grid\s*\{[^}]*\}/);
    assert.ok(rule, '.kpi-grid rule must exist in the 640px block');
    assert.match(rule[0], /grid-template-columns:\s*1fr\s*;/);
    assert.doesNotMatch(rule[0], /1fr\s+1fr/);
  });

  it('lets KPI grid children shrink below their content minimum', () => {
    const rule = phone.match(/\.kpi-grid\s*>\s*\*\s*\{[^}]*\}/);
    assert.ok(rule, '.kpi-grid > * rule must exist in the 640px block');
    assert.match(rule[0], /min-width:\s*0\s*;/);
  });

  it('lets long KPI values break instead of widening the grid', () => {
    assert.match(mainCss, /\.kpi-value\s*\{[^}]*overflow-wrap:\s*anywhere\s*;/);
  });
});

describe('long unbreakable content cannot widen its container', () => {
  it('cards and tool results break long words', () => {
    assert.match(mainCss, /\.card,\s*\.tool-result\s*\{[^}]*overflow-wrap:\s*break-word\s*;/);
  });

  it('no fixed width above 320px in the phone rules', () => {
    const widths = [...phone.matchAll(/width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of widths) assert.ok(w <= 320, 'phone rule width ' + w + 'px exceeds a 320px viewport');
    const minWidths = [...phone.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of minWidths) assert.ok(w <= 320, 'phone rule min-width ' + w + 'px exceeds a 320px viewport');
  });

  it('no fixed width above 320px in the tablet rules', () => {
    const widths = [...tablet.matchAll(/(?<!min-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const w of widths) assert.ok(w <= 320, 'tablet rule width ' + w + 'px exceeds a 320px viewport');
  });
});

describe('wide tables stay inside their own scroll container', () => {
  it('.table-scroll clips its 640px-min-width table instead of the page', () => {
    assert.match(mainCss, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto\s*;/);
    assert.match(mainCss, /\.table-scroll\s+table\s*\{[^}]*min-width:\s*640px\s*;/);
  });
});

describe('desktop layout is unchanged by the phone fix', () => {
  it('desktop KPI grid is still auto-fill minmax(180px, 1fr)', () => {
    assert.match(mainCss, /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(180px,\s*1fr\)\)/);
  });

  it('desktop KPI value is still 30px', () => {
    assert.match(mainCss, /\.kpi-value\s*\{[^}]*font-size:\s*30px\s*;/);
  });

  it('tool layout still collapses to one column at tablet widths', () => {
    assert.match(tablet, /\.tool-layout\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
  });
});
