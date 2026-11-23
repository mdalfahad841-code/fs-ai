/* ------------------------------------------------------------------ */
/* Fix Pass 2, item 3 — light theme toggle.                            */
/*                                                                     */
/* THE BUG (parent's live check, 2026-11-23 12:32–12:34): the header  */
/* toggle did nothing — hero stayed RGB 24,23,21 (dark) after         */
/* repeated clicks, on two tabs. Cause: a binding race. The header   */
/* (and with it #themeToggle, #navToggle, .main-nav) is rendered by   */
/* app.js renderShared(), which runs only after the live-articles     */
/* fetch resolves (up to the 5 s timeout) — ALWAYS after              */
/* navigation.js's DOMContentLoaded handler (same dispatch, earlier   */
/* handler; even a pre-resolved liveReady schedules renderShared as  */
/* a microtask that runs after the dispatch). At bind time            */
/* getElementById('themeToggle') was null, the if-guard skipped the   */
/* binding, and the button created later had no handler. The same     */
/* race killed #navToggle and the active-link highlight. The CSS was  */
/* never at fault (:root[data-theme="light"] + the icon swap in       */
/* main.css:55-57).                                                   */
/*                                                                     */
/* THE FIX (frontend/scripts/navigation.js): delegate clicks on        */
/* document (registered at parse time), so the buttons work whenever  */
/* the header appears and survive re-renders; apply the saved/system  */
/* theme on load (saved wins, else prefers-color-scheme, else dark);  */
/* re-run the active-link highlight once the header appears           */
/* (one-shot MutationObserver); apply the theme before first paint    */
/* via the identical snippet in <head> of all 9 pages.                */
/*                                                                     */
/* HARNESS: the shipped navigation.js runs in a vm sandbox with a     */
/* minimal fake DOM (same pattern as tests/closeout-a1.test.js). The   */
/* harness reproduces the real sequence exactly: DOMContentLoaded      */
/* fires while #siteHeader is still EMPTY, the header is rendered     */
/* LATE (as renderShared does), then clicks happen.                   */
/* ------------------------------------------------------------------ */
'use strict';
const assert = require('node:assert');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const NAV_JS = read('frontend/scripts/navigation.js');
const PAGES = [
  'frontend/index.html',
  'frontend/pages/about.html',
  'frontend/pages/article.html',
  'frontend/pages/contact.html',
  'frontend/pages/dashboard.html',
  'frontend/pages/division.html',
  'frontend/pages/privacy.html',
  'frontend/pages/terms.html',
  'frontend/pages/tools.html',
];

/* --- Minimal fake DOM ------------------------------------------- */
function matchesSimple(el, sel) {
  if (!el) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  return el.tagName.toLowerCase() === sel.toLowerCase();
}
function matchesSelector(el, sel) {
  // Supports '#id', '.class', 'tag' and one descendant step ('.main-nav a').
  const parts = sel.trim().split(/\s+/);
  if (parts.length === 1) return matchesSimple(el, parts[0]);
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  let n = el.parent;
  const rest = parts.slice(0, -1);
  let i = rest.length - 1;
  while (n && i >= 0) {
    if (matchesSimple(n, rest[i])) i -= 1;
    n = n.parent;
  }
  return i < 0;
}
function makeEl(tag, opts) {
  const el = {
    tagName: tag.toUpperCase(),
    id: (opts && opts.id) || '',
    parent: (opts && opts.parent) || null,
    children: [],
    _classes: new Set((opts && opts.classes) || []),
    _attrs: {},
    _listeners: {},
    classList: {
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      toggle(c) {
        const has = el._classes.has(c);
        if (has) el._classes.delete(c); else el._classes.add(c);
        return !has;
      },
      contains(c) { return el._classes.has(c); },
    },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    addEventListener(t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    closest(sel) {
      // Real browsers accept any valid selector here, including
      // descendant steps ('.main-nav a') — match that, not just simple ones.
      let n = el;
      while (n) { if (matchesSelector(n, sel)) return n; n = n.parent; }
      return null;
    },
    querySelector(sel) {
      const all = el.querySelectorAll(sel);
      return all.length ? all[0] : null;
    },
    querySelectorAll(sel) {
      const out = [];
      (function walk(node) {
        for (const child of node.children) {
          if (matchesSelector(child, sel)) out.push(child);
          walk(child);
        }
      })(el);
      return out;
    },
    scrollIntoView() {},
  };
  return el;
}

/* Run navigation.js in a vm sandbox. Options: saved theme value,
   system prefers-light, current pathname. Returns the harness. */
function makeNavSandbox(src, opts) {
  const o = opts || {};
  const listeners = {};
  const docListeners = listeners;
  const store = {};
  if (o.saved !== undefined && o.saved !== null) store['fsai-theme'] = o.saved;
  const events = [];
  const moInstances = [];

  const docEl = makeEl('html');
  const siteHeader = makeEl('div', { id: 'siteHeader' });
  siteHeader.setAttribute('data-active', 'Home');
  const registry = { siteHeader };
  const roots = [siteHeader];

  const document = {
    documentElement: docEl,
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    getElementById(id) { return registry[id] || null; },
    querySelector(sel) {
      for (const r of roots) {
        if (matchesSelector(r, sel)) return r;
        const found = r.querySelector(sel);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(sel) {
      let out = [];
      for (const r of roots) {
        if (matchesSelector(r, sel)) out.push(r);
        out = out.concat(r.querySelectorAll(sel));
      }
      return out;
    },
  };
  class FakeMO {
    constructor(cb) { this.cb = cb; this.disconnected = false; moInstances.push(this); }
    observe() { this.observed = true; }
    disconnect() { this.disconnected = true; }
  }
  const sandbox = {
    window: {
      location: { pathname: o.pathname || '/' },
      matchMedia() { return { matches: !!o.prefersLight }; },
      dispatchEvent(ev) { events.push(ev.type); return true; },
    },
    document,
    localStorage: {
      getItem(k) { return k in store ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    MutationObserver: FakeMO,
    CustomEvent: class { constructor(type) { this.type = type; } },
    console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'navigation-under-test.js' });

  function fireDomReady() { (docListeners.DOMContentLoaded || []).forEach((fn) => fn()); }
  /* Simulate app.js renderShared() LATE: populate #siteHeader with the
     header markup (theme toggle, nav toggle, .main-nav with links) and
     fire the MutationObserver callbacks as the real observer would. */
  function renderHeaderLate() {
    const header = makeEl('header', { classes: ['site-header'], parent: siteHeader });
    siteHeader.children.push(header);
    const themeBtn = makeEl('button', { id: 'themeToggle', parent: header });
    header.children.push(themeBtn);
    registry.themeToggle = themeBtn;
    const sun = makeEl('svg', { classes: ['icon-sun'], parent: themeBtn });
    themeBtn.children.push(sun);
    const navToggle = makeEl('button', { id: 'navToggle', parent: header });
    navToggle.setAttribute('aria-expanded', 'false');
    header.children.push(navToggle);
    registry.navToggle = navToggle;
    const nav = makeEl('nav', { classes: ['main-nav'], parent: header });
    header.children.push(nav);
    const links = [
      ['/', 'Home'], ['/pages/division', 'Divisions'], ['/pages/tools', 'Tools'],
    ];
    for (const [href, text] of links) {
      const a = makeEl('a', { parent: nav });
      a.setAttribute('href', href);
      a.textContent = text;
      nav.children.push(a);
    }
    for (const mo of moInstances) {
      if (!mo.disconnected && mo.observed) mo.cb([{ addedNodes: [header] }]);
    }
    return { header, themeBtn, sun, navToggle, nav };
  }
  function click(el) {
    for (const fn of (docListeners.click || [])) fn({ target: el });
  }
  return {
    sandbox, store, events, moInstances, docEl, siteHeader, registry,
    fireDomReady, renderHeaderLate, click,
    theme() { return docEl.getAttribute('data-theme'); },
  };
}

/* The pre-fix binding, verbatim (old navigation.js lines 18-34, theme
   part): look the button up at DOMContentLoaded and bind only if it
   exists. Used by the regression test to prove the scenario catches
   the race — the real pre-fix file is in the Fix Pass 2 backup
   (fs-ai-backup-20261123-fixpass2.tar.gz, frontend/scripts/navigation.js). */
const OLD_THEME_BINDING = `
document.addEventListener('DOMContentLoaded', function () {
  var saved = null;
  try { saved = localStorage.getItem('fsai-theme'); } catch (e) { saved = null; }
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var light = document.documentElement.getAttribute('data-theme') === 'light';
      if (light) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('fsai-theme', 'dark'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        try { localStorage.setItem('fsai-theme', 'light'); } catch (e) {}
      }
      try { window.dispatchEvent(new CustomEvent('fsai:theme-change')); } catch (e) {}
    });
  }
});
`;

/* ------------------------------------------------------------------ */
/* 3.1 — the race, reproduced (old code fails, new code passes).       */
/* ------------------------------------------------------------------ */
describe('3.1 the binding race (regression)', () => {
  it('OLD code: a click after the late header render does nothing (the reported bug)', () => {
    const t = makeNavSandbox(OLD_THEME_BINDING, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    // The old code bound nothing: the late button has no listeners.
    assert.equal((late.themeBtn._listeners.click || []).length, 0, 'old code bound no click handler');
    t.click(late.themeBtn);
    assert.equal(t.theme(), null, 'theme must stay dark — this is the bug');
    assert.equal(t.store['fsai-theme'], undefined, 'nothing persisted');
  });

  it('NEW code: the same late render + click switches to light', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    t.click(late.themeBtn);
    assert.equal(t.theme(), 'light', 'delegated click must set data-theme=light');
    assert.equal(t.store['fsai-theme'], 'light', 'choice persisted');
    assert.ok(t.events.includes('fsai:theme-change'), 'theme-change event dispatched');
  });

  it('new code never looks the button up by id at bind time', () => {
    assert.ok(!NAV_JS.includes("getElementById('themeToggle')"), 'no direct theme-button lookup');
    assert.ok(!NAV_JS.includes("getElementById('navToggle')"), 'no direct nav-button lookup');
    assert.ok(NAV_JS.includes("closest('#themeToggle')"), 'theme toggle is delegated');
    assert.ok(NAV_JS.includes("closest('#navToggle')"), 'nav toggle is delegated');
  });
});

/* ------------------------------------------------------------------ */
/* 3.2 — toggle behaviour.                                             */
/* ------------------------------------------------------------------ */
describe('3.2 toggle switches dark <-> light and persists', () => {
  it('click toggles to light, click again back to dark, state persisted each time', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    t.click(late.themeBtn);
    assert.equal(t.theme(), 'light');
    assert.equal(t.store['fsai-theme'], 'light');
    t.click(late.themeBtn);
    assert.equal(t.theme(), null, 'dark is the absence of the attribute');
    assert.equal(t.store['fsai-theme'], 'dark');
    t.click(late.themeBtn);
    assert.equal(t.theme(), 'light');
  });

  it('a click on the icon inside the button still toggles (closest, not target)', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    t.click(late.sun);
    assert.equal(t.theme(), 'light', 'svg child click must reach the button via closest');
  });

  it('the toggle works on a re-rendered header (delegation survives innerHTML replacement)', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const first = t.renderHeaderLate();
    t.click(first.themeBtn);
    assert.equal(t.theme(), 'light');
    // app.js re-renders the header: fresh button, same id.
    const second = t.renderHeaderLate();
    assert.notEqual(second.themeBtn, first.themeBtn, 'harness really replaced the button');
    t.click(second.themeBtn);
    assert.equal(t.theme(), null, 'fresh button must toggle back without rebinding');
  });
});

/* ------------------------------------------------------------------ */
/* 3.3 — saved choice / system preference on load.                     */
/* ------------------------------------------------------------------ */
describe('3.3 saved choice wins, else system preference, else dark', () => {
  it("saved 'light' applies on load", () => {
    const t = makeNavSandbox(NAV_JS, { saved: 'light' });
    t.fireDomReady();
    assert.equal(t.theme(), 'light');
  });

  it("saved 'dark' applies on load even when the system prefers light", () => {
    const t = makeNavSandbox(NAV_JS, { saved: 'dark', prefersLight: true });
    t.fireDomReady();
    assert.equal(t.theme(), null, 'saved dark must beat the system preference');
  });

  it('no saved choice + system prefers light -> light', () => {
    const t = makeNavSandbox(NAV_JS, { prefersLight: true });
    t.fireDomReady();
    assert.equal(t.theme(), 'light');
  });

  it('no saved choice + system prefers dark -> dark (default)', () => {
    const t = makeNavSandbox(NAV_JS, { prefersLight: false });
    t.fireDomReady();
    assert.equal(t.theme(), null);
  });

  it("saved 'light' beats a dark system preference", () => {
    const t = makeNavSandbox(NAV_JS, { saved: 'light', prefersLight: false });
    t.fireDomReady();
    assert.equal(t.theme(), 'light');
  });
});

/* ------------------------------------------------------------------ */
/* 3.4 — mobile nav toggle (same race, same fix).                      */
/* ------------------------------------------------------------------ */
describe('3.4 nav toggle works after the late render', () => {
  it('click opens and closes the menu, aria attributes follow', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    t.click(late.navToggle);
    assert.ok(late.nav.classList.contains('open'), 'menu opens');
    assert.equal(late.navToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(late.navToggle.getAttribute('aria-label'), 'Close menu');
    t.click(late.navToggle);
    assert.ok(!late.nav.classList.contains('open'), 'menu closes');
    assert.equal(late.navToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(late.navToggle.getAttribute('aria-label'), 'Open menu');
  });

  it('clicking a nav link closes an open menu', () => {
    const t = makeNavSandbox(NAV_JS, {});
    t.fireDomReady();
    const late = t.renderHeaderLate();
    t.click(late.navToggle);
    assert.ok(late.nav.classList.contains('open'));
    const link = late.nav.children[0];
    t.click(link);
    assert.ok(!late.nav.classList.contains('open'), 'link click must close the menu');
  });
});

/* ------------------------------------------------------------------ */
/* 3.5 — active-link highlight after the late render.                  */
/* ------------------------------------------------------------------ */
describe('3.5 active-link highlight runs once the header appears', () => {
  it('the link matching the current page gains .active after the late render', () => {
    const t = makeNavSandbox(NAV_JS, { pathname: '/pages/tools' });
    t.fireDomReady();
    assert.equal(t.sandbox.document.querySelectorAll('.main-nav a').length, 0, 'no nav yet at DOMContentLoaded');
    const late = t.renderHeaderLate();
    const toolsLink = late.nav.children.find((a) => a.getAttribute('href') === '/pages/tools');
    assert.ok(toolsLink.classList.contains('active'), 'tools link must be highlighted');
    assert.ok(!late.nav.children[0].classList.contains('active'), 'home link must not be highlighted');
  });

  it('the observer disconnects after the highlight runs', () => {
    const t = makeNavSandbox(NAV_JS, { pathname: '/' });
    t.fireDomReady();
    assert.equal(t.moInstances.length, 1, 'one header observer attached');
    t.renderHeaderLate();
    assert.ok(t.moInstances[0].disconnected, 'observer must disconnect after the header appears');
  });
});

/* ------------------------------------------------------------------ */
/* 3.6 — pre-paint <head> snippet (all 9 pages).                       */
/* ------------------------------------------------------------------ */
function headSnippet(html) {
  const m = html.match(/<script>try\{var __fsaiTheme[\s\S]*?<\/script>/);
  return m ? m[0] : null;
}
describe('3.6 pre-paint theme snippet in <head>', () => {
  it('all 9 pages carry the identical snippet, before the themes.css link', () => {
    let first = null;
    for (const rel of PAGES) {
      const html = read(rel);
      const snippet = headSnippet(html);
      assert.ok(snippet, rel + ' must carry the pre-paint theme snippet');
      if (first === null) first = snippet;
      else assert.equal(snippet, first, rel + ' snippet must be identical to index.html');
      assert.ok(html.indexOf(snippet) < html.indexOf('themes.css'),
        rel + ': snippet must come before the themes.css link');
    }
  });

  it('the snippet resolves the theme the same way navigation.js does', () => {
    const snippet = headSnippet(read('frontend/index.html'));
    assert.ok(snippet, 'index must carry the snippet');
    function runSnippet(saved, prefersLight) {
      const store = {};
      if (saved !== null) store['fsai-theme'] = saved;
      const docEl = makeEl('html');
      const sandbox = {
        document: { documentElement: docEl },
        localStorage: {
          getItem(k) { return k in store ? store[k] : null; },
        },
        window: {
          matchMedia() { return { matches: prefersLight }; },
        },
      };
      sandbox.window.window = sandbox.window;
      vm.createContext(sandbox);
      const js = snippet.replace(/^<script>/, '').replace(/<\/script>$/, '');
      vm.runInContext(js, sandbox);
      return docEl.getAttribute('data-theme');
    }
    assert.equal(runSnippet('light', false), 'light', "saved light wins");
    assert.equal(runSnippet('dark', true), null, "saved dark beats system light");
    assert.equal(runSnippet(null, true), 'light', 'no saved choice + system light -> light');
    assert.equal(runSnippet(null, false), null, 'no saved choice + system dark -> dark');
  });
});
