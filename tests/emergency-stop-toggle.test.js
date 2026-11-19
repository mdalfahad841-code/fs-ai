// FS AI — Emergency Stop toggle regression tests.
//
// Regression (found live 2026-11-19): clicking "Turn Emergency Stop ON"
// on the Owner Command Center dashboard never changed the state — after
// reloads it still showed OFF. Root cause: BOTH dashboard click handlers
// (dashboard.js #emergencyStopBtn and autonomy.js #autonomyStopBtn) gated
// the POST behind window.confirm(). In any environment where the dialog
// is auto-dismissed (automated browsers, some WebViews) confirm() returns
// false, the handler returns early, and NO request is ever sent — silently,
// with no error and no state change. The other authenticated writes on
// the same page (e.g. the Analytics agent run) have no confirm gate and
// worked in the same session, and the backend endpoint itself is covered
// by tests/agents-admin.test.js.
//
// The fix: the toggle posts immediately on click, with no confirm gate.
// The action is instantly reversible (one more click turns it back) and
// the button label is explicit, so no confirm is needed — and a safety
// control must work on the first tap in every browser.
//
// These tests EXECUTE the real shipped handler code in a vm with stubbed
// DOM/fetch: with window.confirm stubbed to return false (auto-dismiss
// simulation) the click must still POST { stopped: true } to
// /api/admin/emergency-stop. With the old code this test fails (no POST).
// Run: node --test tests/emergency-stop-toggle.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const DASHBOARD_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'dashboard.js'), 'utf8');
const AUTONOMY_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'autonomy.js'), 'utf8');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');

/* --- Minimal DOM/fetch stubs to execute the shipped IIFEs --- */

function makeElement(id) {
  const el = {
    id,
    _handlers: {},
    addEventListener(type, fn) {
      (this._handlers[type] = this._handlers[type] || []).push(fn);
    },
    click() {
      (this._handlers.click || []).forEach((fn) => fn.call(this));
    },
    appendChild() {},
    insertBefore() {},
    remove() {},
    setAttribute() {},
    scrollIntoView() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    parentNode: null,
    nextSibling: null,
  };
  return el;
}

function flush() {
  // Let promise chains (.then handlers) settle.
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (++n >= 10) return resolve();
      setImmediate(tick);
    };
    tick();
  });
}

function makeHarness({ script, sessionVerified }) {
  const calls = []; // every fetch call: { url, method, body }
  const confirmCalls = [];
  const elements = new Map();
  let stopState = false; // fake server-side emergency_stop value

  const doc = {
    _domListeners: {},
    addEventListener(type, fn) {
      (this._domListeners[type] = this._domListeners[type] || []).push(fn);
    },
    getElementById(id) {
      // The section itself and its anchor do not exist until buildSection()
      // creates the section; everything else gets a stub element.
      if (id === 'section-agents' || id === 'section-autonomy') return null;
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement() { return makeElement('created'); },
  };
  // dashboardContent must look visible + verified for autonomy.js to start.
  const content = doc.getElementById('dashboardContent');
  content.hidden = false;
  content.style.display = '';

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    _windowListeners: {},
    addEventListener(type, fn) {
      (this._windowListeners[type] = this._windowListeners[type] || []).push(fn);
    },
    document: doc,
    // A valid server-mode session, so token() returns a Bearer token and
    // autonomy.js's startIfReady() succeeds (which also clears its poll
    // interval — without a token the interval would run forever and the
    // test process would never exit).
    sessionStorage: { getItem: () => JSON.stringify({ mode: 'server', token: 'test-token', email: 'owner@example.test' }) },
    fetch: (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let body;
      try { body = opts && opts.body ? JSON.parse(opts.body) : undefined; } catch { body = undefined; }
      calls.push({ url: String(url), method, body });
      let data = { ok: true };
      if (String(url).endsWith('/api/admin/emergency-stop')) {
        if (method === 'POST') { stopState = !!body.stopped; data = { ok: true, stopped: stopState, source: 'd1' }; }
        else data = { ok: true, stopped: stopState, source: 'd1' };
      } else if (String(url).endsWith('/api/autonomy/status')) {
        data = {
          ok: true, emergencyStop: stopState, autonomyLevel: 3, targetLevel: 3,
          tasks: {}, agents: [], revenue: '$0.00', traffic: 'Data unavailable', source: 'd1',
        };
      } else if (String(url).endsWith('/api/autonomy/llm')) {
        data = { ok: true, providers: [], generationPaused: true };
      } else if (String(url).includes('/api/autonomy/tasks')) {
        data = { ok: true, tasks: [], total: 0 };
      } else if (String(url).includes('/api/autonomy/reports')) {
        data = { ok: true, reports: [] };
      } else if (String(url).endsWith('/api/autonomy/settings')) {
        data = { ok: true, settings: {} };
      } else if (String(url).endsWith('/api/autonomy/accounts')) {
        data = { ok: true, accounts: [] };
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(data),
      });
    },
  };
  sandbox.window = sandbox;
  sandbox.window.confirm = (msg) => { confirmCalls.push(String(msg)); return false; }; // auto-dismissed dialog
  if (sessionVerified) {
    sandbox.window.FSAI = {
      sessionVerified: true,
      auth: { isSessionVerified: () => true },
      esc: (s) => String(s == null ? '' : s),
      formatDate: (s) => String(s),
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'dashboard-under-test.js' });
  return {
    sandbox, doc, calls, confirmCalls,
    get stopState() { return stopState; },
    fireDomReady() {
      (doc._domListeners.DOMContentLoaded || []).forEach((fn) => fn());
    },
  };
}

describe('Emergency Stop toggle posts without a confirm gate (regression 2026-11-19)', () => {
  it('dashboard.js: clicking #emergencyStopBtn POSTs { stopped: true } even when confirm() returns false', async () => {
    const h = makeHarness({ script: DASHBOARD_JS, sessionVerified: false });
    h.fireDomReady();
    await flush();
    const btn = h.doc.getElementById('emergencyStopBtn');
    assert.ok(btn._handlers.click && btn._handlers.click.length, 'click handler must be attached');
    btn.click();
    await flush();
    const post = h.calls.find((c) => c.url.endsWith('/api/admin/emergency-stop') && c.method === 'POST');
    assert.ok(post, 'click must POST to /api/admin/emergency-stop (confirm must not gate it)');
    assert.deepEqual(post.body, { stopped: true });
    assert.equal(h.stopState, true, 'server-side state must flip to ON');
  });

  it('autonomy.js: clicking #autonomyStopBtn POSTs { stopped: true } even when confirm() returns false', async () => {
    const h = makeHarness({ script: AUTONOMY_JS, sessionVerified: true });
    h.fireDomReady();
    await flush();
    // loadStatus() must have read the initial OFF state from the API.
    assert.equal(h.doc.getElementById('autonomyStopState').textContent, 'OFF — agent runs allowed');
    const btn = h.doc.getElementById('autonomyStopBtn');
    assert.ok(btn._handlers.click && btn._handlers.click.length, 'click handler must be attached');
    btn.click();
    await flush();
    const post = h.calls.find((c) => c.url.endsWith('/api/admin/emergency-stop') && c.method === 'POST');
    assert.ok(post, 'click must POST to /api/admin/emergency-stop (confirm must not gate it)');
    assert.deepEqual(post.body, { stopped: true });
    assert.equal(h.stopState, true, 'server-side state must flip to ON');
    // The section re-reads status after a successful toggle and shows ON.
    assert.equal(h.doc.getElementById('autonomyStopState').textContent, 'ON — agent runs are blocked (423)');
  });

  it('neither toggle handler calls window.confirm (destructive deletes still do)', () => {
    const dashConfirms = (DASHBOARD_JS.match(/window\.confirm\(/g) || []).length;
    // dashboard.js keeps confirm() only for article delete + division delete.
    assert.equal(dashConfirms, 2, 'dashboard.js must have exactly 2 confirm() calls (the two deletes)');
    const autoConfirms = (AUTONOMY_JS.match(/window\.confirm\(/g) || []).length;
    assert.equal(autoConfirms, 0, 'autonomy.js must have no confirm() calls');
    // And the confirm() calls that remain must not sit on the E-Stop path.
    for (const [name, src, btnId] of [
      ['dashboard.js', DASHBOARD_JS, 'emergencyStopBtn'],
      ['autonomy.js', AUTONOMY_JS, 'autonomyStopBtn'],
    ]) {
      const seg = src.slice(src.indexOf("el('" + btnId + "')"), src.indexOf("api('/api/admin/emergency-stop', { method: 'POST'"));
      assert.ok(seg.length > 0, name + ': E-Stop handler must exist');
      assert.ok(!seg.includes('window.confirm('), name + ': E-Stop handler must not call window.confirm');
    }
  });
});

describe('Emergency Stop toggle endpoint round-trip (local check)', () => {
  it('POST flips the stored value, agent runs answer 423 while ON, and OFF restores 200', async () => {
    const env = await makeOwnerEnv();
    const token = await loginOk(handleRequest, env);
    const off0 = await handleRequest(authedRequest('GET', '/api/admin/emergency-stop', token), env);
    assert.equal((await off0.json()).stopped, false);
    const onRes = await handleRequest(authedRequest('POST', '/api/admin/emergency-stop', token, { stopped: true }), env);
    assert.equal(onRes.status, 200);
    assert.equal((await onRes.json()).stopped, true);
    const getOn = await handleRequest(authedRequest('GET', '/api/admin/emergency-stop', token), env);
    assert.equal((await getOn.json()).stopped, true);
    const runBlocked = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(runBlocked.status, 423);
    const offRes = await handleRequest(authedRequest('POST', '/api/admin/emergency-stop', token, { stopped: false }), env);
    assert.equal((await offRes.json()).stopped, false);
    const runOk = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(runOk.status, 200);
  });
});
