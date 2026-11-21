// FS AI — dashboard Delete button repair (Workstream A, task G, 2026-11-21).
//
// The old handler (frontend/scripts/dashboard.js) was one bare
// confirm() from deleting anything — including protected articles
// #26/#27 — and a double-click sent two DELETEs (the second 404ed).
// The repair: refuse protected articles client-side (the server also
// refuses 403 — backend/routes/admin-articles.js, WS-E H1), warn
// loudly for published articles, disable the button while a delete
// is in flight, and VERIFY the row is actually gone (GET → 404)
// before reporting success.
//
// No browser, no network, no live data: a minimal DOM shim + a canned
// fetch stub drive the real dashboard.js and assert what it does.
// Modeled on tests/dashboard-autonomy-dom.test.js.
// Run: node --test tests/delete-button.test.js
'use strict';

const { describe, it, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'scripts', 'dashboard.js'), 'utf8');

// ---- Minimal DOM shim ---------------------------------------------------
const byId = new Map();
const textLog = [];
const listeners = new Map();
const docListeners = {};

function makeEl(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    className: '',
    style: {},
    hidden: false,
    disabled: false,
    value: '',
    _text: '',
    _html: '',
    children: [],
    _attrs: {},
    setAttribute(name, value) { this._attrs[name] = String(value); if (name === 'id') { this.id = String(value); byId.set(this.id, this); } },
    getAttribute(name) { return this._attrs[name] ?? null; },
    addEventListener(type, fn) {
      if (!listeners.has(this)) listeners.set(this, {});
      const m = listeners.get(this);
      (m[type] = m[type] || []).push(fn);
    },
    appendChild(child) { this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); if (this.id) textLog.push([this.id, String(v)]); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  if (id) byId.set(id, el);
  return el;
}

global.document = {
  getElementById(id) { return byId.get(id) || null; },
  createElement(tag) { return makeEl(tag); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
};
global.window = global;
global.window.addEventListener = () => {};
global.window.dispatchEvent = () => true;
global.window.FSAI = {
  esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  formatDate(d) { return String(d); },
  auth: { isSessionVerified() { return false; } },
};
global.sessionStorage = {
  getItem() { return JSON.stringify({ mode: 'server', token: 'test-token' }); },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fire(type) { (docListeners[type] || []).forEach((fn) => fn()); }
function elListeners(el, type) { const m = listeners.get(el) || {}; return m[type] || []; }

describe('dashboard Delete button repair (task G)', () => {
  let fetchCalls;
  let confirmMessages;
  let confirmAnswer;
  let deleteStatus;
  let verifyStatus;
  let listEl;
  let statusEl;

  beforeEach(() => {
    byId.clear();
    textLog.length = 0;
    listeners.clear();
    // Clear document listeners too: each eval(SRC) below registers a
    // fresh DOMContentLoaded handler, and a stale one would bind a
    // second click listener on the list (two DELETEs per click).
    for (const k of Object.keys(docListeners)) delete docListeners[k];
    fetchCalls = [];
    confirmMessages = [];
    confirmAnswer = true;
    deleteStatus = 200;
    verifyStatus = 404;
    global.window.confirm = (msg) => { confirmMessages.push(msg); return confirmAnswer; };
    // The canned fetch: DELETE succeeds/fails per test, the verify
    // GET answers per test, the article list reload answers empty.
    global.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      fetchCalls.push({ method, path });
      const J = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
      if (method === 'DELETE' && path.startsWith('/api/admin/articles/')) {
        return deleteStatus === 200 ? J(200, { ok: true, deleted: 101 }) : J(deleteStatus, { error: 'simulated server failure' });
      }
      if (method === 'GET' && /^\/api\/admin\/articles\/\d+$/.test(path)) {
        return verifyStatus === 404 ? J(404, { error: 'Article not found' }) : J(200, { article: { id: 101, title: 'Draft Article' } });
      }
      if (method === 'GET' && path.startsWith('/api/admin/articles')) {
        return J(200, { articles: [], source: 'd1' });
      }
      throw new Error('unexpected fetch: ' + method + ' ' + path);
    };
    listEl = makeEl('tbody', 'adminArticleList');
    statusEl = makeEl('div', 'articleFormStatus');
    makeEl('div', 'contentStatus');
    makeEl('select', 'contentFilter');
    makeEl('form', 'articleForm');
    eval(SRC); // eslint-disable-line no-eval
    fire('DOMContentLoaded');
  });

  function fakeDeleteBtn(attrs) {
    const btn = {
      disabled: false,
      getAttribute(name) { return attrs[name] ?? null; },
      closest(sel) { return sel === '[data-article-action]' ? btn : null; },
    };
    return btn;
  }

  function clickDelete(btn) {
    const fns = elListeners(listEl, 'click');
    assert.ok(fns.length, 'a click listener is bound on the article list');
    const target = { closest(sel) { return btn.closest(sel); } };
    fns.forEach((fn) => fn({ target }));
  }

  function statusText() {
    return statusEl.textContent;
  }

  it('draft delete: confirm → one DELETE → verify 404 → "Article deleted."', async () => {
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Draft Article', 'data-status': 'draft', 'data-protected': '0',
    }));
    await sleep(50);
    assert.equal(confirmMessages.length, 1, 'exactly one confirm');
    assert.match(confirmMessages[0], /Delete article #101 "Draft Article"/, 'the confirm names the article');
    assert.ok(confirmMessages[0].includes('revisions are kept'), 'the confirm says revisions are kept');
    assert.equal(fetchCalls.filter((c) => c.method === 'DELETE').length, 1, 'exactly one DELETE');
    assert.ok(fetchCalls.some((c) => c.method === 'GET' && c.path === '/api/admin/articles/101'), 'the verify GET ran');
    assert.equal(statusText(), 'Article deleted.');
  });

  it('published delete: the confirm warns it will leave the live site', async () => {
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Live Article', 'data-status': 'published', 'data-protected': '0',
    }));
    await sleep(50);
    assert.equal(confirmMessages.length, 1);
    assert.match(confirmMessages[0], /PUBLISHED/, 'the confirm warns the article is published');
    assert.match(confirmMessages[0], /live site/, 'the confirm says it leaves the live site');
    assert.equal(fetchCalls.filter((c) => c.method === 'DELETE').length, 1, 'a published article CAN be deleted after the warning');
    assert.equal(statusText(), 'Article deleted.');
  });

  it('protected delete: refused client-side with no fetch at all', async () => {
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '26',
      'data-title': 'Protected Article', 'data-status': 'draft', 'data-protected': '1',
    }));
    await sleep(50);
    assert.equal(confirmMessages.length, 0, 'no confirm for a protected article');
    assert.equal(fetchCalls.length, 0, 'no request is sent for a protected article');
    assert.match(statusText(), /protected/i, 'the refusal names the protection');
    assert.match(statusText(), /refused/i);
  });

  it('double-click: only one DELETE is sent', async () => {
    const btn = fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Draft Article', 'data-status': 'draft', 'data-protected': '0',
    });
    clickDelete(btn);
    clickDelete(btn); // second click while the first is still in flight
    await sleep(50);
    assert.equal(fetchCalls.filter((c) => c.method === 'DELETE').length, 1, 'the second click is ignored while a delete is in flight');
    assert.equal(statusText(), 'Article deleted.');
  });

  it('server 500 on DELETE: the failure is shown with its HTTP status', async () => {
    deleteStatus = 500;
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Draft Article', 'data-status': 'draft', 'data-protected': '0',
    }));
    await sleep(50);
    assert.match(statusText(), /HTTP 500/, `got: ${statusText()}`);
    assert.ok(!fetchCalls.some((c) => c.method === 'GET' && c.path === '/api/admin/articles/101'), 'no verify GET after a failed delete');
  });

  it('DELETE succeeds but the article is still there on verify → an honest failure, not "deleted"', async () => {
    verifyStatus = 200; // the row survives the delete
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Draft Article', 'data-status': 'draft', 'data-protected': '0',
    }));
    await sleep(50);
    assert.match(statusText(), /still there/, `got: ${statusText()}`);
    assert.ok(!statusText().includes('Article deleted.'), 'must not claim success when the row survives');
  });

  it('declining the confirm sends no request', async () => {
    confirmAnswer = false;
    clickDelete(fakeDeleteBtn({
      'data-article-action': 'delete', 'data-id': '101',
      'data-title': 'Draft Article', 'data-status': 'draft', 'data-protected': '0',
    }));
    await sleep(50);
    assert.equal(fetchCalls.length, 0, 'no request when the owner declines');
  });
});
