// FS AI — Dashboard status-truth regression tests.
//
// The dashboard must never claim more than the site can prove:
//   * GA4: the tag (G-JVSCJT2DHJ) is on every public page, but NO GA4
//     Reporting/Data API is used anywhere in this repo, so the status is
//     exactly "Tracking Connected — Reporting API Not Connected" — never
//     "Connected" alone — and traffic stays "Data unavailable".
//   * Search Console: "Verification File Installed" (provable: the file
//     is served) is distinct from "Google Property Verified" (owner-
//     verified 2026-11-11). No Search Console API connection exists.
//   * Social accounts: a saved URL proves "Profile Exists" only — never
//     "Account Connected" or "Publishing API Connected".
//   * An account row must never say "Not yet created or connected" next
//     to a Connected/Verified badge, and Analytics must never say "No
//     analytics account is connected yet" while the GA4 tag is live.
// No browser or network is needed: these tests assert on the shipped
// file contents and the exported route constants.
// Run: node --test tests/dashboard-status-truth.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ACCOUNTS } = require('../backend/routes/accounts.js');
const { HONEST_ANALYTICS } = require('../backend/routes/analytics.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const DASHBOARD_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'dashboard.js'), 'utf8');
const ANALYTICS_JS = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'analytics.js'), 'utf8');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'accounts.js'), 'utf8');

const GA4_ID = 'G-JVSCJT2DHJ';
const ANALYTICS_STATUS = 'Tracking Connected — Reporting API Not Connected';
// Public pages: every page a visitor can open. pages/owner-setup.html is
// owner-only (linked only from the dashboard "Forgot password?" link) and
// is intentionally untagged, so it is not in this list.
const PUBLIC_PAGES = [
  'index.html',
  'pages/article.html',
  'pages/dashboard.html',
  'pages/division.html',
  'pages/privacy.html',
  'pages/terms.html',
  'pages/tools.html',
];

function account(id) {
  const row = ACCOUNTS.find((a) => a.id === id);
  assert.ok(row, 'missing fallback account row: ' + id);
  return row;
}

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('GA4 tag is on every public page', () => {
  for (const page of PUBLIC_PAGES) {
    it(page + ' carries the gtag.js script for ' + GA4_ID, () => {
      const html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
      assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=' + GA4_ID),
        page + ' is missing the gtag.js script tag');
      assert.ok(html.includes('gtag("config","' + GA4_ID + '")'),
        page + ' is missing the gtag config call');
    });
  }
});

describe('no GA4 Reporting/Data API exists anywhere in the repo', () => {
  it('no googleapis / analyticsdata / analyticsreporting usage in backend or frontend JS', () => {
    const files = [...jsFilesUnder(path.join(ROOT, 'backend')), ...jsFilesUnder(path.join(FRONTEND, 'scripts'))];
    assert.ok(files.length > 0, 'expected JS files to scan');
    for (const file of files) {
      // Strip comments first: the honesty comments in analytics.js /
      // accounts.js name these APIs only to deny that they are used.
      // Also strip the authorised Gemini LLM endpoint host
      // (generativelanguage.googleapis.com, backend/llm/providers/
      // gemini.js + registry.js): that is the Gemini text-generation
      // API, NOT the GA4 Reporting/Data API this test guards against.
      // Any other googleapis host (e.g. analyticsdata.googleapis.com)
      // still trips this test.
      const src = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '')
        .replace(/generativelanguage\.googleapis\.com/g, '');
      for (const token of ['googleapis', 'analyticsdata', 'analyticsreporting']) {
        assert.ok(!src.toLowerCase().includes(token),
          path.relative(ROOT, file) + ' mentions ' + token + ' outside comments — a reporting integration must not exist silently');
      }
    }
  });
});

describe('analytics API tells the exact truth', () => {
  it('HONEST_ANALYTICS status is exactly "Tracking Connected — Reporting API Not Connected"', () => {
    assert.equal(HONEST_ANALYTICS.analyticsStatus, ANALYTICS_STATUS);
    assert.ok(HONEST_ANALYTICS.note.includes(ANALYTICS_STATUS), 'note must carry the exact status');
    assert.equal(HONEST_ANALYTICS.analyticsConnected, false, 'no reporting integration exists');
  });

  it('visitors / page views / clicks stay "Data unavailable" and revenue is $0.00', () => {
    assert.equal(HONEST_ANALYTICS.visitors, 'Data unavailable');
    assert.equal(HONEST_ANALYTICS.pageViews, 'Data unavailable');
    assert.equal(HONEST_ANALYTICS.clicks, 'Data unavailable');
    assert.equal(HONEST_ANALYTICS.revenue, 0);
    assert.equal(HONEST_ANALYTICS.revenueFormatted, '$0.00');
  });

  it('analytics.js never claims "No analytics account is connected yet"', () => {
    assert.ok(!ANALYTICS_JS.includes('No analytics account is connected yet'),
      'that wording contradicts the live GA4 tag');
    assert.ok(!ANALYTICS_JS.includes('no analytics account connected yet'));
  });
});

describe('accounts API fallback tells the exact truth', () => {
  it('Search Console is Verified by the owner 2026-11-11, with no API connection claimed', () => {
    const row = account('search-console');
    assert.equal(row.status, 'verified');
    assert.ok(row.detail.includes('Verified by the owner 2026-11-11'), 'must keep the owner-verified date');
    assert.ok(row.detail.includes('google745797e85dfd966e.html'), 'must name the verification file');
    assert.ok(row.detail.includes('No Search Console API connection exists'));
    assert.ok(!row.detail.includes('Not connected yet'), 'must not say "Not connected yet"');
  });

  it('Analytics status is exactly "Tracking Connected — Reporting API Not Connected"', () => {
    const row = account('analytics');
    assert.equal(row.status, ANALYTICS_STATUS);
    assert.ok(row.detail.includes('Data unavailable'));
    assert.ok(!row.detail.includes('Not connected yet'), 'must not say "Not connected yet" while the tag is live');
  });

  it('GitHub / YouTube / Pinterest say "Profile Exists", never "Account Connected"', () => {
    for (const [id, handle] of [['github', 'mdalfahad841-code'], ['youtube', '@FSAI-e5f'], ['pinterest', 'watchwithf']]) {
      const row = account(id);
      assert.equal(row.status, 'created');
      assert.equal(row.handle, handle);
      assert.ok(row.url, id + ' must keep its profile URL');
      assert.ok(row.detail.toLowerCase().includes('profile exists'), id + ' detail must say the profile exists');
      assert.ok(row.detail.includes('No publishing API is connected') || row.detail.includes('No account connection or publishing API is connected'),
        id + ' detail must disclaim any connection/publishing API');
      assert.ok(!row.detail.includes('no code uploaded yet'), 'stale "no code uploaded yet" wording must not return');
    }
  });

  it('Facebook / WhatsApp Business / Business Email stay "Pending Owner Authorization"', () => {
    for (const id of ['facebook', 'whatsapp-business', 'business-email']) {
      const row = account(id);
      assert.equal(row.status, 'pending');
      assert.equal(row.url, null);
      assert.ok(row.detail.includes('Pending owner authorization'), id + ' must say pending owner authorization');
      assert.ok(row.detail.includes('not created yet'), id + ' must not be claimed as created');
    }
  });

  it('no fallback row says "No analytics account is connected yet"', () => {
    assert.ok(!ACCOUNTS_JS.includes('No analytics account is connected yet'));
    assert.ok(!ACCOUNTS_JS.includes('no analytics account connected yet'));
  });
});

describe('dashboard.js corrects the API without contradicting itself', () => {
  it('Analytics override status is exactly "Tracking Connected — Reporting API Not Connected"', () => {
    assert.ok(DASHBOARD_JS.includes("'analytics': { status: '" + ANALYTICS_STATUS + "'"),
      'ACCOUNT_OVERRIDES analytics status must be the exact phrase');
    assert.ok(!DASHBOARD_JS.includes("'analytics': { status: 'Connected'"),
      'bare "Connected" analytics override must not return');
  });

  it('Search Console override keeps the owner-verified date and disclaims an API connection', () => {
    assert.ok(DASHBOARD_JS.includes('Google Property Verified by the owner 2026-11-11'),
      'Search Console override must keep the 2026-11-11 owner verification');
    assert.ok(DASHBOARD_JS.toLowerCase().includes('no search console api connection exists'));
  });

  it('SEO Analytics check uses the exact status, never bare "Connected"', () => {
    assert.ok(DASHBOARD_JS.includes("status: '" + ANALYTICS_STATUS + "'"),
      'SEO Analytics check must use the exact status');
    assert.ok(!DASHBOARD_JS.includes("label: 'Analytics (GA4 " + GA4_ID + ")', status: 'Connected'"));
  });

  it('accountRow never shows "Not yet created or connected" for a tracking-connected row', () => {
    // The guard must cover the long Analytics status, which has no URL.
    assert.ok(DASHBOARD_JS.includes("indexOf('Tracking Connected') === 0"),
      'accountRow must treat "Tracking Connected …" as a connected row');
    assert.ok(!DASHBOARD_JS.includes('Analytics is connected (GA4)'),
      'the old "Analytics is connected" Overview note must not return');
  });

  it('no "No analytics account is connected yet" anywhere in dashboard.js', () => {
    assert.ok(!DASHBOARD_JS.includes('No analytics account is connected yet'));
    assert.ok(!DASHBOARD_JS.includes('no analytics account connected yet'));
  });
});

describe('Search Console verification file and sitemap shipped in the repo', () => {
  it('verification file content is exactly the Google token', () => {
    const content = fs.readFileSync(path.join(FRONTEND, 'google745797e85dfd966e.html'), 'utf8').trim();
    assert.equal(content, 'google-site-verification: google745797e85dfd966e.html');
  });

  it('sitemap.xml is valid XML with 60 URLs', () => {
    const sitemap = fs.readFileSync(path.join(FRONTEND, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.startsWith('<?xml'), 'sitemap must be XML');
    const count = (sitemap.match(/<url>/g) || []).length;
    assert.equal(count, 60, 'sitemap must list 60 URLs');
    assert.ok(sitemap.includes('<loc>https://fs-ai-5w5.pages.dev/</loc>'));
  });

  it('robots.txt is served from the repo and points at the sitemap', () => {
    const robots = fs.readFileSync(path.join(FRONTEND, 'robots.txt'), 'utf8');
    assert.ok(robots.includes('Sitemap: https://fs-ai-5w5.pages.dev/sitemap.xml'));
  });
});
