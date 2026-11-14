// FS AI — division chart mobile legibility regression tests.
// 2026-11-14 mobile audit: on a 320px phone the chart caption
// ("Articles per division — 25 articles total") was drawn past the canvas
// edge and clipped, and long division labels overflowed the 150px gutter.
// The chart now shrinks the gutter, ellipsises long labels and shortens
// the caption on narrow canvases. Canvas is faked: measureText uses a
// 7px-per-char approximation (13px Arial), which overestimates narrow
// glyphs and underestimates wide ones — the assertions use that same
// approximation, so they pin the logic, not real font metrics.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');

const ROOT = path.join(__dirname, '..');

function loadCharts(cssW) {
  const calls = [];
  const ctx = {
    fillText(text, x, y) { calls.push({ text: String(text), x, y, align: this.textAlign }); },
    fillRect() {},
    clearRect() {},
    scale() {},
    measureText(text) { return { width: String(text).length * 7 }; },
    canvas: null,
  };
  const canvas = {
    clientWidth: cssW,
    getContext() { return ctx; },
    width: 0, height: 0,
  };
  const listeners = {};
  const sandbox = {
    window: {
      FSAI: {
        ARTICLES: Array.from({ length: 25 }, (_, i) => ({ id: i + 1 })),
        countsByDivision() {
          return [
            { division: 'Automotive', count: 12 },
            { division: 'AI & Technology', count: 2 },
            { division: 'Gadgets & Electronics', count: 2 },
            { division: 'Finance & Money Education', count: 3 },
            { division: 'Travel & Lifestyle', count: 2 },
            { division: 'Digital Tools & Utilities', count: 1 },
            { division: 'Health & Wellness', count: 2 },
            { division: 'Education & Learning', count: 1 },
          ];
        },
        esc(s) { return String(s); },
      },
      devicePixelRatio: 1,
      addEventListener() {},
    },
    document: {
      documentElement: { getAttribute() { return null; } },
      getElementById() { return null; },
      addEventListener(ev, fn) { listeners[ev] = fn; },
    },
  };
  sandbox.window.FSAI = sandbox.window.FSAI;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'frontend/scripts/charts.js'), 'utf8'), sandbox);
  sandbox.window.FSAI.drawDivisionChart(canvas);
  return calls;
}

describe('division chart stays inside the canvas', () => {
  for (const cssW of [280, 360, 640]) {
    it(`no text drawn outside a ${cssW}px canvas`, () => {
      const calls = loadCharts(cssW);
      assert.ok(calls.length > 0, 'expected fillText calls');
      for (const c of calls) {
        const w = c.text.length * 7;
        const left = c.align === 'right' ? c.x - w : c.x;
        const right = c.align === 'right' ? c.x : c.x + w;
        assert.ok(left >= 0, `${c.text} starts at ${left}px on a ${cssW}px canvas`);
        assert.ok(right <= cssW, `${c.text} ends at ${right}px on a ${cssW}px canvas`);
      }
    });
  }

  it('caption is shortened on a narrow canvas and full on a wide one', () => {
    const narrow = loadCharts(280).map((c) => c.text);
    const wide = loadCharts(640).map((c) => c.text);
    assert.ok(narrow.includes('25 articles total'), 'narrow caption must be the short form');
    assert.ok(wide.some((t) => t.startsWith('Articles per division')), 'wide caption keeps the full form');
  });

  it('long division labels are ellipsised on a narrow canvas', () => {
    const texts = loadCharts(280).map((c) => c.text);
    assert.ok(texts.some((t) => t.includes('…')), 'at least one long label must be shortened with …');
    assert.ok(texts.some((t) => t === 'Automotive'), 'short labels stay whole');
  });
});
