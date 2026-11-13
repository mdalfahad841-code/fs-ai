// FS AI — Command Center dashboard section tests.
//
// The dashboard must contain all 14 sections, all inside the gated
// #dashboardContent container, and dashboard.js must load them from the
// live Worker API with the owner's Bearer token — only after the session
// is verified — showing "Sign in required" on a 401. No browser or
// network is needed: these tests assert on the shipped file contents.
// Run: node --test tests/dashboard-sections.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const DASHBOARD_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'dashboard.html'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'dashboard.js'), 'utf8');

const SECTIONS = [
  ['overview', 'Overview'],
  ['content-management', 'Content Management'],
  ['division-management', 'Division Management'],
  ['tools-management', 'Tools Management'],
  ['ai-agent-control', 'AI Agent Control'],
  ['social-media', 'Social Media Management'],
  ['newsletter-management', 'Newsletter Management'],
  ['seo-management', 'SEO Management'],
  ['analytics', 'Analytics'],
  ['monetization', 'Monetization'],
  ['account-connections', 'Account Connections'],
  ['security', 'Security'],
  ['system-logs', 'System Logs'],
  ['backup-recovery', 'Backup and Recovery'],
];

describe('dashboard.html has all 14 sections', () => {
  it('contains every section marker', () => {
    for (const [slug, label] of SECTIONS) {
      assert.ok(DASHBOARD_HTML.includes('data-section="' + slug + '"'), 'missing section: ' + label);
      assert.ok(DASHBOARD_HTML.includes('>' + label + '<'), 'missing heading: ' + label);
    }
  });

  it('keeps every section inside the gated #dashboardContent', () => {
    const gated = DASHBOARD_HTML.slice(DASHBOARD_HTML.indexOf('id="dashboardContent"'));
    for (const [slug] of SECTIONS) {
      assert.ok(gated.includes('data-section="' + slug + '"'), slug + ' must be inside #dashboardContent');
    }
    for (const marker of ['kpiGrid', 'divisionCounts', 'latestArticles', 'agentList', 'accountList']) {
      assert.ok(gated.includes('id="' + marker + '"'), marker + ' must be inside #dashboardContent');
    }
  });

  it('keeps the gate: content hidden by default, login card first', () => {
    const openTag = DASHBOARD_HTML.match(/<div id="dashboardContent"[^>]*>/)[0];
    assert.ok(openTag.includes('hidden'), 'dashboardContent must carry the hidden attribute');
    assert.ok(/display\s*:\s*none/.test(openTag), 'dashboardContent must be display:none by default');
    assert.ok(DASHBOARD_HTML.indexOf('Owner sign in') < DASHBOARD_HTML.indexOf('id="dashboardContent"'));
  });

  it('has the controls each section needs', () => {
    for (const id of [
      'adminArticleList', 'articleForm', 'articleRevisions',
      'adminDivisionList', 'divisionForm',
      'adminToolList',
      'adminAgentList', 'emergencyStopBtn', 'emergencyStopState', 'agentLogs',
      'socialAccountList', 'subscriberList',
      'seoChecks', 'analyticsGrid', 'monetizationGrid',
      'securityPanel', 'systemLogs',
      'backupDownloadBtn', 'backupCounts',
    ]) {
      assert.ok(DASHBOARD_HTML.includes('id="' + id + '"'), 'missing element: ' + id);
    }
    assert.ok(DASHBOARD_HTML.includes('BACKUP-RECOVERY.md'), 'must link the Backup and Recovery guide');
    assert.ok(DASHBOARD_HTML.includes('noindex'), 'Command Center must not be indexed');
  });
});

describe('dashboard.js loads live data only after a verified session', () => {
  it('waits for the session-verified event before loading', () => {
    assert.ok(DASHBOARD_JS.includes('fsai:session-verified'), 'must listen for fsai:session-verified');
    assert.ok(DASHBOARD_JS.includes('isSessionVerified'), 'must check the verified flag');
    assert.ok(DASHBOARD_JS.includes('sessionVerified'), 'must read window.FSAI.sessionVerified');
  });

  it('sends the Bearer token from sessionStorage on admin calls', () => {
    assert.ok(DASHBOARD_JS.includes("sessionStorage.getItem('fsai-session')"), 'must read the stored session');
    assert.ok(DASHBOARD_JS.includes("Authorization"), 'must send an Authorization header');
    assert.ok(DASHBOARD_JS.includes("'Bearer ' + t"), 'must send a Bearer token');
  });

  it('shows "Sign in required" on a 401', () => {
    assert.ok(DASHBOARD_JS.includes('Sign in required'), 'must show "Sign in required" on 401');
    assert.ok(DASHBOARD_JS.includes('r.status === 401'), 'must branch on HTTP 401');
  });

  it('fetches every section from the Worker API', () => {
    for (const endpoint of [
      '/api/articles', '/api/divisions', '/api/analytics', '/api/accounts',
      '/api/admin/articles', '/api/admin/divisions',
      '/api/tools', '/api/agents',
      '/api/admin/emergency-stop', '/api/admin/subscribers',
      '/api/admin/backup',
    ]) {
      assert.ok(DASHBOARD_JS.includes("'" + endpoint + "'") || DASHBOARD_JS.includes('"' + endpoint + '"') || DASHBOARD_JS.includes(endpoint),
        'must fetch ' + endpoint);
    }
    assert.ok(DASHBOARD_JS.includes('/logs'), 'must fetch per-agent logs');
  });

  it('covers article publish/unpublish/delete, agent run/pause/resume/disable, and backup download', () => {
    for (const action of ['data-article-action="publish"', 'data-article-action="unpublish"', "'DELETE'"]) {
      assert.ok(DASHBOARD_JS.includes(action), 'must call ' + action);
    }
    for (const action of ['data-agent-action="run"', 'data-agent-action="pause"', 'data-agent-action="resume"', 'data-agent-action="disable"']) {
      assert.ok(DASHBOARD_JS.includes(action), 'must offer ' + action);
    }
    assert.ok(DASHBOARD_JS.includes('fs-ai-backup-'), 'backup download must name the file fs-ai-backup-<date>.json');
  });

  it('never invents revenue or traffic', () => {
    assert.ok(DASHBOARD_JS.includes('Data unavailable'), 'must keep the honest "Data unavailable" traffic wording');
    assert.ok(DASHBOARD_JS.includes('$0.00'), 'must keep the honest $0.00 revenue');
    assert.ok(!DASHBOARD_JS.includes('Math.random'), 'must not generate fake numbers');
  });

  it('states the honest newsletter and paused-account facts', () => {
    assert.ok(DASHBOARD_JS.includes('pending confirmation'), 'must state subscribers are pending confirmation');
    assert.ok(DASHBOARD_JS.includes('Paused by owner'), 'must state Facebook/WhatsApp/Business Email are paused by the owner');
    assert.ok(DASHBOARD_JS.includes('G-JVSCJT2DHJ'), 'must name the connected GA4 measurement ID');
  });
});
