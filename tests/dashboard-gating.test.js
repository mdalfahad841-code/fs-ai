// FS AI — Command Center dashboard gating tests.
//
// The dashboard page must show ONLY the owner sign-in form (plus a
// Forgot password link) before login; the dashboard content appears
// only after a real server login. These tests assert on the shipped
// file contents, so no browser or network is needed.
// Run: node --test tests/dashboard-gating.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const DASHBOARD_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'dashboard.html'), 'utf8');
const OWNER_SETUP_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'owner-setup.html'), 'utf8');
const AUTH_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'authentication.js'), 'utf8');

describe('dashboard.html gating', () => {
  it('wraps all dashboard content in #dashboardContent, hidden by default', () => {
    assert.match(DASHBOARD_HTML, /<div id="dashboardContent"[^>]*>/);
    const openTag = DASHBOARD_HTML.match(/<div id="dashboardContent"[^>]*>/)[0];
    assert.ok(openTag.includes('hidden'), 'dashboardContent must carry the hidden attribute');
    assert.ok(/display\s*:\s*none/.test(openTag), 'dashboardContent must be display:none by default');
    // The gated content lives inside the container.
    const gated = DASHBOARD_HTML.slice(DASHBOARD_HTML.indexOf('id="dashboardContent"'));
    for (const marker of ['kpiGrid', 'divisionCounts', 'latestArticles', 'agentList', 'accountList']) {
      assert.ok(gated.includes('id="' + marker + '"'), marker + ' must be inside #dashboardContent');
    }
  });

  it('shows the Owner sign-in card first, with no demo wording', () => {
    assert.ok(DASHBOARD_HTML.includes('<h2>Owner sign in</h2>'), 'heading must be "Owner sign in"');
    assert.ok(!DASHBOARD_HTML.includes('Demo sign-in'), 'must not contain "Demo sign-in"');
    assert.ok(!DASHBOARD_HTML.includes('no real server login'), 'must not contain the stale "no real server login" text');
    assert.ok(DASHBOARD_HTML.includes('Your password is checked by the FS AI server'), 'accurate server-login line must be present');
    // The login card comes before the gated content in the document.
    assert.ok(
      DASHBOARD_HTML.indexOf('Owner sign in') < DASHBOARD_HTML.indexOf('id="dashboardContent"'),
      'login card must appear before #dashboardContent'
    );
  });

  it('has a Forgot password? link to owner-setup.html and no demo email prefill', () => {
    assert.ok(DASHBOARD_HTML.includes('Forgot password?'), 'must contain a "Forgot password?" link');
    assert.match(DASHBOARD_HTML, /<a href="owner-setup\.html">Forgot password\?<\/a>/);
    assert.ok(!DASHBOARD_HTML.includes('demo@fs-ai.local'), 'must not prefill the demo email');
    assert.ok(DASHBOARD_HTML.includes('placeholder="mdalfahad841@gmail.com"'), 'email field must hint the owner email');
    assert.ok(DASHBOARD_HTML.includes('placeholder="Your owner password"'), 'password field must hint the owner password');
    assert.ok(DASHBOARD_HTML.includes('>Sign in</button>'), 'submit button must read "Sign in"');
  });

  it('keeps the Back to home link and the site footer', () => {
    assert.ok(DASHBOARD_HTML.includes('href="../index.html"'), 'Back to home link must be kept');
    assert.ok(DASHBOARD_HTML.includes('id="siteFooter"'), 'site footer must be kept');
  });
});

describe('owner-setup.html (Forgot password page)', () => {
  it('exists and explains the hash replacement', () => {
    assert.ok(OWNER_SETUP_HTML.includes('OWNER_PASSWORD_HASH'), 'must mention OWNER_PASSWORD_HASH');
    assert.ok(OWNER_SETUP_HTML.includes('replace the OWNER_PASSWORD_HASH variable'), 'must tell the owner to replace the Worker variable');
    assert.ok(OWNER_SETUP_HTML.includes('href="dashboard.html"'), 'must link back to the Command Center');
    // The on-device crypto is unchanged: PBKDF2 100000 iterations, SHA-256.
    assert.ok(OWNER_SETUP_HTML.includes('PBKDF2'), 'must still use PBKDF2');
    assert.ok(OWNER_SETUP_HTML.includes('iterations: 100000'), 'must still use 100000 iterations');
    assert.ok(OWNER_SETUP_HTML.includes("'pbkdf2$100000$'"), 'must still emit the pbkdf2$100000$ hash format');
  });
});

describe('authentication.js gating logic', () => {
  it('reveals #dashboardContent only for a real server session', () => {
    assert.ok(AUTH_JS.includes("getElementById('dashboardContent')"), 'must look up #dashboardContent');
    assert.ok(AUTH_JS.includes("s.mode === 'server'"), 'must require mode === \'server\'');
    assert.ok(AUTH_JS.includes("s.token"), 'must require a stored server token');
    // The gate is applied on every render, not just on sign-in.
    const renderBody = AUTH_JS.slice(AUTH_JS.indexOf('function render()'));
    assert.ok(renderBody.includes('dashboardContent'), 'render() must toggle #dashboardContent');
    assert.ok(renderBody.includes("content.style.display = serverSignedIn ? '' : 'none'"), 'render() must hide the content when not server-signed-in');
  });

  it('never prefills the demo email in the form', () => {
    assert.ok(!AUTH_JS.includes("demoEmail').value ="), 'must not set the email field to the demo address');
  });
});
