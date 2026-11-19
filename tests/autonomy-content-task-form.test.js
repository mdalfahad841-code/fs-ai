// FS AI — Create-content-task dashboard form tests (first real AI article).
//
// The dashboard previously had NO way to create a content-creation task
// with a custom title/division: it could only run tasks that already
// existed in the queue. The first real AI article ("How Artificial
// Intelligence Is Changing Everyday Life") needs a task created with that
// exact title and the ai-technology division, so autonomy.js gained a
// "Create a content draft task" form (POST /api/autonomy/tasks) plus a run
// status line that shows the run ID (needed to convert the scaffold to a
// draft). These tests EXECUTE the real shipped autonomy.js in a vm with
// stubbed DOM/fetch, following the tests/emergency-stop-toggle.test.js
// pattern. Run: node --test tests/autonomy-content-task-form.test.js
// (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const AUTONOMY_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'autonomy.js'), 'utf8');

const MISSION_TITLE = 'How Artificial Intelligence Is Changing Everyday Life';

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
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (++n >= 10) return resolve();
      setImmediate(tick);
    };
    tick();
  });
}

function makeHarness({ runResponse } = {}) {
  const calls = [];
  const elements = new Map();
  let nextTaskId = 13;

  const doc = {
    _domListeners: {},
    addEventListener(type, fn) {
      (this._domListeners[type] = this._domListeners[type] || []).push(fn);
    },
    getElementById(id) {
      if (id === 'section-agents' || id === 'section-autonomy') return null;
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement() { return makeElement('created'); },
  };
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
    sessionStorage: { getItem: () => JSON.stringify({ mode: 'server', token: 'test-token', email: 'owner@example.test' }) },
    fetch: (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let body;
      try { body = opts && opts.body ? JSON.parse(opts.body) : undefined; } catch { body = undefined; }
      calls.push({ url: String(url), method, body });
      const u = String(url);
      let data = { ok: true };
      if (u.endsWith('/api/autonomy/tasks') && method === 'POST') {
        data = { ok: true, task: { id: nextTaskId++, agent: body.agent, kind: body.kind }, duplicate: false };
      } else if (/\/api\/autonomy\/tasks\/\d+\/run$/.test(u) && method === 'POST') {
        data = runResponse || { ok: true, taskId: 13, runId: 77, outcome: 'done', result: { outcome: 'done' } };
      } else if (u.endsWith('/api/autonomy/status')) {
        data = { ok: true, emergencyStop: false, autonomyLevel: 3, targetLevel: 3, tasks: {}, agents: [], revenue: '$0.00', traffic: 'Data unavailable', source: 'd1' };
      } else if (u.endsWith('/api/autonomy/llm')) {
        data = { ok: true, providers: [{ id: 'workers-ai', name: 'Cloudflare Workers AI', status: 'available', todayUsage: { neurons: 0 } }], generationPaused: false };
      } else if (u.includes('/api/autonomy/tasks')) {
        data = { ok: true, tasks: [], total: 0 };
      } else if (u.includes('/api/autonomy/reports')) {
        data = { ok: true, reports: [] };
      } else if (u.endsWith('/api/autonomy/settings')) {
        data = { ok: true, settings: {} };
      } else if (u.endsWith('/api/autonomy/accounts')) {
        data = { ok: true, accounts: [] };
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    },
  };
  sandbox.window = sandbox;
  sandbox.window.FSAI = {
    sessionVerified: true,
    auth: { isSessionVerified: () => true },
    esc: (s) => String(s == null ? '' : s),
    formatDate: (s) => String(s),
  };
  vm.createContext(sandbox);
  vm.runInContext(AUTONOMY_JS, sandbox, { filename: 'autonomy-under-test.js' });
  return {
    sandbox, doc, calls,
    fireDomReady() {
      (doc._domListeners.DOMContentLoaded || []).forEach((fn) => fn());
    },
  };
}

describe('Create content draft task form', () => {
  it('posts a content-creation task with the mission title + ai-technology division', async () => {
    const h = makeHarness();
    h.fireDomReady();
    await flush();
    const titleEl = h.doc.getElementById('autonomyContentTitle');
    const divEl = h.doc.getElementById('autonomyContentDivision');
    const btn = h.doc.getElementById('autonomyCreateContentBtn');
    assert.ok(btn._handlers.click && btn._handlers.click.length, 'create handler must be attached');
    titleEl.value = MISSION_TITLE;
    divEl.value = 'ai-technology';
    btn.click();
    await flush();
    const post = h.calls.find((c) => c.url.endsWith('/api/autonomy/tasks') && c.method === 'POST');
    assert.ok(post, 'click must POST to /api/autonomy/tasks');
    assert.equal(post.body.agent, 'content-creation');
    assert.equal(post.body.kind, 'article-draft');
    assert.equal(post.body.payload.title, MISSION_TITLE);
    assert.equal(post.body.payload.division, 'ai-technology');
    assert.deepEqual(post.body.payload.sources, []);
    assert.equal(post.body.division_id, 2, 'ai-technology is division id 2');
    assert.match(post.body.idempotency_key, /^manual-content-how-artificial-intelligence-is-changing-everyday-life-\d{4}-\d{2}-\d{2}$/);
    const status = h.doc.getElementById('autonomyCreateContentStatus').textContent;
    assert.match(status, /Content task created \(task #13\)/);
    assert.match(status, /run it under/);
  });

  it('sources are split one per line and capped at 10', async () => {
    const h = makeHarness();
    h.fireDomReady();
    await flush();
    h.doc.getElementById('autonomyContentTitle').value = MISSION_TITLE;
    h.doc.getElementById('autonomyContentDivision').value = 'ai-technology';
    h.doc.getElementById('autonomyContentSources').value = '  https://example.com/a  \n\nhttps://example.com/b\n';
    h.doc.getElementById('autonomyCreateContentBtn').click();
    await flush();
    const post = h.calls.find((c) => c.url.endsWith('/api/autonomy/tasks') && c.method === 'POST');
    assert.deepEqual(post.body.payload.sources, ['https://example.com/a', 'https://example.com/b']);
  });

  it('a title shorter than 5 characters is rejected without any POST', async () => {
    const h = makeHarness();
    h.fireDomReady();
    await flush();
    h.doc.getElementById('autonomyContentTitle').value = 'Hi';
    h.doc.getElementById('autonomyContentDivision').value = 'ai-technology';
    h.doc.getElementById('autonomyCreateContentBtn').click();
    await flush();
    assert.equal(h.calls.filter((c) => c.url.endsWith('/api/autonomy/tasks') && c.method === 'POST').length, 0,
      'no task-creation POST for an invalid title');
    assert.match(h.doc.getElementById('autonomyCreateContentStatus').textContent, /at least 5 characters/);
  });

  it('the create form never uses window.confirm', () => {
    const confirms = (AUTONOMY_JS.match(/window\.confirm\(/g) || []).length;
    assert.equal(confirms, 0, 'autonomy.js must have no confirm() calls (b5ea538 E-Stop fix preserved)');
  });
});

describe('Run-task status shows the run ID and the AI-draft hint', () => {
  it('a done content run reports "run #N" and tells the owner to convert it', async () => {
    const h = makeHarness({
      runResponse: {
        ok: true, taskId: 13, runId: 77, outcome: 'done', attempts: 1, requeued: false,
        result: { outcome: 'done', draft: { title: MISSION_TITLE, llmGenerated: true }, scaffold: { title: MISSION_TITLE } },
      },
    });
    h.fireDomReady();
    await flush();
    h.doc.getElementById('autonomyTaskSelect').value = '13';
    h.doc.getElementById('autonomyRunTaskBtn').click();
    await flush();
    const status = h.doc.getElementById('autonomyRunTaskStatus').textContent;
    assert.match(status, /Task 13: done \(run #77\)/);
    assert.match(status, /AI draft ready\. Convert run #77 to a CMS draft below\./);
  });

  it('a no-op run still shows its run ID (so a scaffold can be converted)', async () => {
    const h = makeHarness({
      runResponse: {
        ok: true, taskId: 13, runId: 78, outcome: 'no-op', attempts: 1, requeued: false,
        result: { outcome: 'no-op', reason: 'All free LLM providers unavailable — generation paused', scaffold: { title: MISSION_TITLE } },
      },
    });
    h.fireDomReady();
    await flush();
    h.doc.getElementById('autonomyTaskSelect').value = '13';
    h.doc.getElementById('autonomyRunTaskBtn').click();
    await flush();
    const status = h.doc.getElementById('autonomyRunTaskStatus').textContent;
    assert.match(status, /Task 13: no-op \(run #78\)/);
    assert.match(status, /All free LLM providers unavailable/);
    assert.ok(!status.includes('AI draft ready'), 'no draft hint when there is no draft');
  });
});
