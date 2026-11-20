// Sandboxed functional check for the Phase 2 dashboard integration in
// frontend/scripts/autonomy.js (Fixes 1, 4, 5, 6, 9, 10 + minors A/C/D/E).
// No browser, no network, no live data: a minimal DOM shim + a canned
// fetch stub drive the real file and assert what it renders.
// Run: node --test tests/dashboard-autonomy-dom.test.js
'use strict';

const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'scripts', 'autonomy.js'), 'utf8');

// ---- Minimal DOM shim -------------------------------------------------
const byId = new Map();
const textLog = []; // [elementId, text] for every textContent write
const listeners = new Map(); // element -> { type: [fn] }

function registerIds(html) {
  if (typeof html !== 'string') return;
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!byId.has(m[1])) byId.set(m[1], makeEl('div', m[1]));
  }
}

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
    closest() { return null; },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); if (this.id) textLog.push([this.id, String(v)]); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); registerIds(this._html); },
  });
  if (id) byId.set(id, el);
  return el;
}

const dashboardContent = makeEl('section', 'dashboardContent');
dashboardContent.hidden = false;

const docListeners = {};
global.document = {
  getElementById(id) { return byId.get(id) || null; },
  createElement(tag) { return makeEl(tag); },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
};
global.window = global;
global.window.addEventListener = () => {};
global.window.dispatchEvent = () => true;
global.window.FSAI = {
  esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  formatDate(d) { return String(d); },
  sessionVerified: true,
  auth: { isSessionVerified() { return true; } },
};
global.sessionStorage = {
  getItem() { return JSON.stringify({ mode: 'server', token: 'test-token' }); },
};

// ---- Canned fetch ------------------------------------------------------
const canned = [];
function route(method, match, body) { canned.push({ method, match, body }); }
const J = (b) => ({ ok: true, status: 200, json: async () => b });

route('GET', '/api/autonomy/status', J({ ok: true,
  autonomyLevel: '3', targetLevel: '3', emergencyStop: false,
  tasks: { queued: 1, running: 0, done: 2, failed: 0, skipped: 0 },
  agents: [
    { id: 'fact-checking', role: 'Fact-Checking', status: 'active' },
    { id: 'content-creation', role: 'Content Creation', status: 'active' },
  ],
  lastRuns: { 'fact-checking': { outcome: 'no-op', startedAt: '2026-11-20T00:05:00.000Z', finishedAt: '2026-11-20T00:05:01.000Z', step: 'correction-run', reason: 'auto_correction is off.' } },
  revenue: '$0.00', traffic: 'Data unavailable', publishingMode: 'approved_only',
  maxArticlesPerDay: '1', socialAutoPost: 'off',
  autoFlags: { auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' },
  source: 'd1',
}));
route('GET', '/api/autonomy/llm', J({ ok: true,
  providers: [{ id: 'workers-ai', name: 'Workers AI', status: 'available', todayUsage: { neurons: 260 } }],
  generationPaused: false }));
route('GET', '/api/autonomy/sources', J({ ok: true, sources: [] }));
route('GET', '/api/autonomy/analytics', J({ ok: true,
  articlesByStatus: { published: 25, draft: 3 },
  drafts: [
    { id: 26, title: 'How Artificial Intelligence Is Changing Everyday Life', status: 'draft', division: 'ai-technology', isProtected: true, contentReady: false, eligible: false, blockedBy: ['fact-check 0/20 claims verified'] },
    { id: 28, title: 'What a billion-dollar deal says about the US battery market', status: 'draft', division: 'finance-money', isProtected: false, contentReady: false, eligible: false, blockedBy: ['fact-check 6/7 claims verified'] },
  ],
  llmToday: { calls: 13, neurons: 260 }, llm7d: { calls: 20, neurons: 400 },
  failedTasks: [], research: { activeSources: 24, itemsDiscovered: 693 } }));
route('GET', '/api/autonomy/tasks', J({ ok: true, tasks: [], total: 0 }));
route('GET', '/api/autonomy/reports', J({ ok: true, reports: [] }));
route('GET', '/api/autonomy/settings', J({ ok: true, settings: { autonomy_level: '3', max_articles_per_day: '1', publishing_mode: 'approved_only', social_auto_post: 'off', auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' } }));
route('GET', '/api/autonomy/accounts', J({ ok: true, accounts: [] }));
route('GET', '/api/autonomy/corrections?article_id=28', J({ ok: true, articleId: 28, total: 1, corrections: [{
  id: 5, articleId: 28, claimCheckId: 11,
  originalText: 'Motorcycle sales rose 20 percent worldwide in 2025.',
  attemptedCorrection: 'a potential key to smaller The deal—worth more than a billion dollars—aims to supply silicon-carbon anode material',
  attempt: 1, status: 'failed', recheckVerdict: 'FAILED',
  evidenceUrl: 'https://example.com/sila',
  failureReason: 'Correction garbled: spliced unrelated fragments.',
  resolutions: [],
}] }));
route('POST', '/api/autonomy/articles/28/recheck', J({ ok: true, articleId: 28, taskId: 9, taskReused: true, runId: 44, outcome: 'done', status: 'completed',
  latest: { verdict: 'needs-review', claimsTotal: 2, claimsVerified: 1, claimsFailed: 1 },
  previous: { verdict: 'needs-review', claimsTotal: 2, claimsVerified: 1, claimsFailed: 1 },
  factChecked: 0, articleVersion: { bodyChars: 100 } }));
route('POST', '/api/autonomy/articles/28/seo-check', J({ ok: true, action: 'check', articleId: 28, protected: false, verdict: 'needs-review',
  checks: [
    { name: 'readability', ok: false, detail: 'Average sentence 32.0 words. Fix: split long sentences — aim for 15-20 words per sentence.' },
    { name: 'title-length', ok: true, detail: 'Title is 52 characters.' },
  ], seoCheckId: 3, note: 'Check-only — nothing was changed.' }));
route('POST', '/api/autonomy/articles/28/seo-optimize', J({ ok: true, action: 'optimize', articleId: 28, protected: false, verdict: 'pass',
  checks: [{ name: 'readability', ok: true, detail: 'Average sentence 18.0 words.' }],
  seoCheckId: 4, repairs: ['description lengthened'], repairedFields: ['seo_description'], note: 'Repaired 1 field(s).' }));
route('GET', '/api/autonomy/rss-audit', J({ ok: true,
  audits: [{ id: 1, source_id: 3, feed_url: 'https://example.com/feed.xml', started_at: '2026-11-20T05:00:00.000Z', ended_at: '2026-11-20T05:00:05.000Z', execution_id: 'daily-2026-11-20', trigger_type: 'daily-workflow', items_discovered: 10, items_inserted: 2, duplicates_skipped: 8, errors: null, status: 'completed' }],
  total: 1, limit: 50, perSource: [], totals: { sourcesReconciled: 0, sourcesTotal: 24 },
  note: 'Audit rows exist only for fetches after migration 014; earlier fetches are not backfilled.' }));
route('POST', '/api/autonomy/tasks', J({ ok: true, task: { id: 12 }, duplicate: true,
  sourceMerge: { status: 'sources-added', added: ['https://example.com/new-source'], duplicates: ['https://example.com/old-source'], rejected: [] } }));
route('POST', '/api/autonomy/run-weekly', J({ ok: true, status: 'completed', reportId: 7 }));
route('POST', '/api/autonomy/corrections/5/resolve', J({ ok: true, correction: { id: 5, status: 'removed' }, resolution: 'accepted-unresolved-removed', gateEffect: 'Gate check 4 no longer counts this correction.' }));

global.fetch = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  for (const r of canned) {
    if (r.method === method && path.startsWith(r.match)) return r.body;
  }
  throw new Error('unexpected fetch: ' + method + ' ' + path);
};

// ---- Load the real file -------------------------------------------------
eval(SRC); // eslint-disable-line no-eval

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fire(type) { (docListeners[type] || []).forEach((fn) => fn()); }
function elListeners(el, type) { const m = listeners.get(el) || {}; return m[type] || []; }
function click(el, targetMap) {
  const fns = elListeners(el, 'click');
  assert.ok(fns.length, 'expected a click listener on ' + (el.id || el.tagName));
  const target = {
    closest(sel) {
      const hit = targetMap && targetMap[sel];
      if (!hit) return null;
      return hit;
    },
  };
  fns.forEach((fn) => fn({ target }));
}
function fakeBtn(attrs, card) {
  return {
    getAttribute(name) { return attrs[name] ?? null; },
    closest(sel) { return sel === '.card' ? (card || null) : null; },
  };
}

test('dashboard autonomy section: protected badge, correction review, re-check, SEO actions, RSS audit, weekly run', async () => {
  fire('DOMContentLoaded');
  await sleep(100);

  const section = byId.get('section-autonomy');
  assert.ok(section, 'autonomy section was built');
  const secHtml = section.innerHTML;
  for (const id of ['autonomyRunWeeklyBtn', 'autonomyRunWeeklyStatus', 'autonomyLoadRssAuditBtn', 'autonomyRssAuditList', 'autonomyRssAuditStatus', 'autonomyCorrectionList', 'autonomyCorrectionStatus']) {
    assert.ok(secHtml.includes('id="' + id + '"'), 'section contains ' + id);
  }
  console.log('PASS section markup: weekly button, RSS audit + correction review sections present');

  // Minor fix A: the step label distinguishes the two fact-checking steps.
  const agentHtml = byId.get('autonomyAgentList').innerHTML;
  assert.ok(agentHtml.includes('correction-run'), 'agent list shows the step label correction-run');
  assert.ok(agentHtml.includes('auto_correction is off'), 'agent list shows the correction no-op reason');
  console.log('PASS minor A: last-run line reads "correction-run — no-op (auto_correction is off.)"');

  // Fix 1: PROTECTED badge + disabled modifying actions on draft 26 only.
  const pipeHtml = byId.get('autonomyPipelineList').innerHTML;
  assert.ok(pipeHtml.includes('PROTECTED — AUTOMATIC MODIFICATION DISABLED'), 'pipeline shows the PROTECTED badge');
  assert.ok(pipeHtml.includes('data-autonomy-correct="28"'), 'unprotected draft 28 keeps an enabled Correct button');
  assert.ok(pipeHtml.includes('data-autonomy-seo-optimize="28"'), 'unprotected draft 28 keeps an enabled Optimize SEO button');
  assert.ok(!pipeHtml.includes('data-autonomy-correct="26"'), 'protected draft 26 has no enabled Correct button');
  assert.ok(!pipeHtml.includes('data-autonomy-seo-optimize="26"'), 'protected draft 26 has no enabled Optimize SEO button');
  assert.ok(pipeHtml.includes('data-autonomy-recheck="26"'), 'protected draft 26 keeps Re-check (advisory-only)');
  assert.ok(pipeHtml.includes('data-autonomy-seo-check="26"'), 'protected draft 26 keeps SEO Check (check-only)');
  assert.ok(pipeHtml.includes('data-autonomy-review="28"'), 'drafts have a Review button');
  console.log('PASS Fix 1: PROTECTED badge + disabled Correct/Optimize on 26; advisory actions stay enabled');

  // Fix 4: Review loads the correction list with claim + reason + Resolve.
  const pipeEl = byId.get('autonomyPipelineList');
  click(pipeEl, { '[data-autonomy-review]': fakeBtn({ 'data-autonomy-review': '28' }) });
  await sleep(50);
  const corrHtml = byId.get('autonomyCorrectionList').innerHTML;
  assert.ok(corrHtml.includes('Motorcycle sales rose 20 percent worldwide in 2025.'), 'correction list shows the original claim');
  assert.ok(corrHtml.includes('spliced unrelated fragments'), 'correction list shows the failure reason');
  assert.ok(corrHtml.includes('https://example.com/sila'), 'correction list shows the evidence URL');
  assert.ok(corrHtml.includes('accepted-unresolved-removed'), 'correction list offers the four resolutions');
  assert.ok(corrHtml.includes('data-autonomy-correction-resolve="5"'), 'correction list has a Resolve button');
  assert.ok(textLog.some(([id, t]) => id === 'autonomyCorrectionStatus' && t.includes('1 unresolved correction(s) for article #28')), 'correction status line shows the real count');
  console.log('PASS Fix 4: correction review renders claim, evidence, failure reason, resolutions');

  // Fix 4 resolve: records the resolution and reports the real state.
  const corrEl = byId.get('autonomyCorrectionList');
  const card = {
    querySelector(sel) {
      if (sel === '[data-autonomy-correction-resolution]') return { value: 'accepted-unresolved-removed' };
      if (sel === '[data-autonomy-correction-text]') return { value: '' };
      if (sel === '[data-autonomy-correction-note]') return { value: 'owner decision' };
      return null;
    },
  };
  click(corrEl, { '[data-autonomy-correction-resolve]': fakeBtn({ 'data-autonomy-correction-resolve': '5' }, card) });
  await sleep(50);
  assert.ok(textLog.some(([id, t]) => id === 'autonomyCorrectionStatus' && t.includes('Resolution recorded: accepted-unresolved-removed') && t.includes('now removed')), 'resolve reports the recorded resolution + new status');
  console.log('PASS Fix 4: resolve posts the resolution and reports the real new status');

  // Fix 5: Re-check reports latest + previous + fact_checked.
  click(pipeEl, { '[data-autonomy-recheck]': fakeBtn({ 'data-autonomy-recheck': '28' }) });
  await sleep(50);
  const detail1 = byId.get('autonomyFactCheckDetail').textContent;
  assert.ok(detail1.includes('Re-check completed for article #28'), 're-check reports completion');
  assert.ok(detail1.includes('task reused'), 're-check reports task reuse');
  assert.ok(detail1.includes('previous was needs-review'), 're-check shows the previous result');
  assert.ok(detail1.includes('fact_checked stays 0'), 're-check states fact_checked is untouched');
  console.log('PASS Fix 5: re-check shows latest + previous + task reuse + fact_checked 0');

  // Fix 6: SEO Check is check-only; Optimize reports repaired fields.
  click(pipeEl, { '[data-autonomy-seo-check]': fakeBtn({ 'data-autonomy-seo-check': '28' }) });
  await sleep(50);
  const detail2 = byId.get('autonomyFactCheckDetail').textContent;
  assert.ok(detail2.includes('check-only — nothing changed'), 'SEO check states it changed nothing');
  assert.ok(detail2.includes('Fix: split long sentences'), 'SEO check shows the actionable readability Fix line');
  click(pipeEl, { '[data-autonomy-seo-optimize]': fakeBtn({ 'data-autonomy-seo-optimize': '28' }) });
  await sleep(50);
  const detail3 = byId.get('autonomyFactCheckDetail').textContent;
  assert.ok(detail3.includes('SEO optimize completed'), 'SEO optimize reports completion');
  assert.ok(detail3.includes('repaired: seo_description'), 'SEO optimize lists the repaired fields');
  console.log('PASS Fix 6: SEO Check (check-only + Fix line) and SEO Optimize (repaired fields) report real states');

  // Fix 10: RSS audit history renders recorded rows.
  const rssBtn = byId.get('autonomyLoadRssAuditBtn');
  elListeners(rssBtn, 'click').forEach((fn) => fn());
  await sleep(50);
  const rssHtml = byId.get('autonomyRssAuditList').innerHTML;
  assert.ok(rssHtml.includes('https://example.com/feed.xml'), 'audit table shows the feed URL');
  assert.ok(rssHtml.includes('daily-workflow'), 'audit table shows the trigger type');
  assert.ok(rssHtml.includes('completed'), 'audit table shows the final status');
  assert.ok(textLog.some(([id, t]) => id === 'autonomyRssAuditStatus' && t.includes('1 recorded fetch(es)')), 'audit status line shows the real count');
  console.log('PASS Fix 10: RSS fetch history renders recorded rows + reconciliation count');

  // Fix 9: manual weekly run reports the real status.
  const weeklyBtn = byId.get('autonomyRunWeeklyBtn');
  elListeners(weeklyBtn, 'click').forEach((fn) => fn());
  await sleep(50);
  assert.ok(textLog.some(([id, t]) => id === 'autonomyRunWeeklyStatus' && t.includes('Weekly workflow completed (report #7)')), 'weekly run reports completed + report id');
  console.log('PASS Fix 9: manual weekly run reports the real completed status');

  // Minor C: the pipeline table refreshed after the actions (it still
  // lists both drafts with the PROTECTED badge after the re-check run).
  const pipeHtml2 = byId.get('autonomyPipelineList').innerHTML;
  assert.ok(pipeHtml2.includes('PROTECTED — AUTOMATIC MODIFICATION DISABLED'), 'pipeline still renders after action-triggered refresh');
  console.log('PASS minor C: pipeline refreshes after task execution without a page reload');

  // Fix 8: duplicate content-task creation reports what happened to
  // the sources instead of a bare "already existed".
  byId.get('autonomyContentTitle').value = 'Test article about batteries';
  byId.get('autonomyContentDivision').value = 'finance-money';
  byId.get('autonomyContentSources').value = 'https://example.com/new-source\nhttps://example.com/old-source';
  const createBtn = byId.get('autonomyCreateContentBtn');
  elListeners(createBtn, 'click').forEach((fn) => fn());
  await sleep(50);
  const createStatus = byId.get('autonomyCreateContentStatus').textContent;
  assert.ok(createStatus.includes('this task already existed'), 'create reports the duplicate');
  assert.ok(createStatus.includes('1 new source(s) added: https://example.com/new-source'), 'create reports the merged source');
  assert.ok(createStatus.includes('1 duplicate(s) ignored: https://example.com/old-source'), 'create reports the ignored duplicate');
  console.log('PASS Fix 8: duplicate content task reports sources-added + duplicates instead of discarding them');
});
