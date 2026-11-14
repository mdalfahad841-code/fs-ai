// FS AI — Site-wide + admin/agents + security + SEO regression tests.
//
// Pins the findings of the 2026-11-14 site-wide/admin/security/SEO audit:
//   - sitemap has exactly 60 URLs; robots.txt points at it.
//   - homepage carries a canonical, OG tags and JSON-LD; article/division
//     pages upgrade the canonical to the per-article / per-division URL
//     in JavaScript (static HTML ships the base canonical only).
//   - newsletter copy never claims a confirmation email was sent: the
//     stored state is "pending" and the UI says so honestly.
//   - no secret VALUES ship in frontend JS/HTML (names such as
//     SESSION_SECRET may appear in the owner-setup instructions, but
//     never with a value attached).
//   - owner-only routes answer 401 without a session token.
//   - the 16-agent registry is complete and an owner-triggered run of a
//     research agent is an honest no-op, never a fake completed article.
//   - the write rate limit (30/min) is wired into the Worker fetch path.
//   - docs/BACKUP-RECOVERY.md describes the backup button that exists
//     in the dashboard (stale "until the dashboard button exists"
//     wording was fixed 2026-11-14).
//
// Run: node --test tests/sitewide-admin-security.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');
const { AGENT_REGISTRY } = require('../backend/agents/registry.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function frontendFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html)$/.test(entry.name)) out.push(full);
    }
  })(path.join(ROOT, 'frontend'));
  return out;
}

describe('SEO files (sitemap / robots / canonicals)', () => {
  it('sitemap.xml lists exactly 60 URLs', () => {
    const xml = read('frontend/sitemap.xml');
    const locs = xml.match(/<loc>[^<]+<\/loc>/g) || [];
    assert.equal(locs.length, 60, `expected 60 <loc> entries, found ${locs.length}`);
    assert.ok(locs.includes('<loc>https://fs-ai-5w5.pages.dev/</loc>'));
    assert.ok(locs.includes('<loc>https://fs-ai-5w5.pages.dev/pages/article.html?id=25</loc>'));
    assert.ok(locs.includes('<loc>https://fs-ai-5w5.pages.dev/pages/privacy.html</loc>'));
  });

  it('robots.txt allows all and names the sitemap', () => {
    const txt = read('frontend/robots.txt');
    assert.match(txt, /User-agent: \*/);
    assert.match(txt, /Allow: \//);
    assert.match(txt, /Sitemap: https:\/\/fs-ai-5w5\.pages\.dev\/sitemap\.xml/);
  });

  it('homepage has canonical, OG tags and JSON-LD', () => {
    const html = read('frontend/index.html');
    assert.match(html, /<link rel="canonical" href="https:\/\/fs-ai-5w5\.pages\.dev\/">/);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:url" content="https:\/\/fs-ai-5w5\.pages\.dev\/">/);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /<meta name="description" content="[^"]+">/);
  });

  it('article and division pages inject a per-item canonical in JS', () => {
    const article = read('frontend/pages/article.html');
    assert.match(article, /canonical = 'https:\/\/fs-ai-5w5\.pages\.dev\/pages\/article\.html\?id=' \+ a\.id/);
    const division = read('frontend/pages/division.html');
    assert.match(division, /canonical/);
    assert.ok(division.includes('division'), 'division page handles per-division canonical');
  });

  it('privacy and terms pages exist with canonicals', () => {
    for (const page of ['frontend/pages/privacy.html', 'frontend/pages/terms.html']) {
      assert.ok(fs.existsSync(path.join(ROOT, page)), `${page} must exist`);
      assert.match(read(page), /<link rel="canonical" href="https:\/\/fs-ai-5w5\.pages\.dev\/pages\/(privacy|terms)\.html">/);
    }
  });
});

describe('Newsletter honesty (no simulated sent email)', () => {
  it('homepage + privacy copy says pending, never claims an email was sent', () => {
    const home = read('frontend/index.html');
    const privacy = read('frontend/pages/privacy.html');
    for (const text of [home, privacy]) {
      assert.match(text, /pending confirmation/);
      assert.match(text, /no (free )?email sender is connected/i);
    }
    const all = home + privacy + read('frontend/scripts/newsletter.js');
    assert.doesNotMatch(all, /check your inbox/i);
    assert.doesNotMatch(all, /we (have )?sent (you )?(a |an )?confirmation email/i);
    assert.doesNotMatch(all, /confirmation email (has been|was) sent/i);
  });
});

describe('No secret values in shipped frontend code', () => {
  it('frontend JS/HTML carries no API key, token or password value', () => {
    const secretPatterns = [
      /sk-[A-Za-z0-9]{8,}/, // OpenAI-style keys
      /cfpat_[A-Za-z0-9_-]{10,}/, // Cloudflare API tokens
      /CLOUDFLARE_API_TOKEN\s*=\s*['"]?[A-Za-z0-9]{10,}/,
      /SESSION_SECRET\s*=\s*['"][^'"]+['"]/,
      /OWNER_PASSWORD_HASH\s*=\s*['"][^'"]+['"]/,
      /Bearer [A-Za-z0-9._-]{20,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const file of frontendFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of secretPatterns) {
        assert.doesNotMatch(text, pattern, `${path.relative(ROOT, file)} matches ${pattern}`);
      }
    }
  });

  it('.env.example holds placeholders only, no real values', () => {
    const env = read('.env.example');
    // Placeholder wording only ("your-…"), never a real token.
    assert.match(env, /CLOUDFLARE_API_TOKEN=your-[a-z-]+/);
    assert.match(env, /SESSION_SECRET=your-[a-z-]+/);
    assert.doesNotMatch(env, /CLOUDFLARE_API_TOKEN=\S*[A-Za-z0-9]{20,}/);
  });
});

describe('Owner-only routes reject unauthenticated access', () => {
  let env;
  before(async () => { env = await makeOwnerEnv(); });

  it('GET /api/agents, /api/admin/* and /api/auth/me answer 401 without a token', async () => {
    for (const p of [
      '/api/agents', '/api/agents/status', '/api/agents/business-manager',
      '/api/agents/business-manager/logs', '/api/admin/subscribers',
      '/api/admin/backup', '/api/admin/emergency-stop',
      '/api/admin/articles', '/api/admin/divisions', '/api/auth/me',
    ]) {
      const res = await handleRequest(new Request(`http://localhost${p}`), env);
      assert.equal(res.status, 401, `${p} must be 401 without a token`);
      assert.match((await res.json()).error, /Owner session required/);
    }
  });

  it('POST /api/agents/:id/run answers 401 without a token', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/agents/business-manager/run', null), env);
    assert.equal(res.status, 401);
  });
});

describe('16-agent registry and honest manual runs', () => {
  let env;
  let token;
  before(async () => {
    env = await makeOwnerEnv();
    token = await loginOk(handleRequest, env);
  });

  it('registry holds exactly 16 agents, each with id, role, responsibilities and permissions', () => {
    assert.equal(AGENT_REGISTRY.length, 16);
    const ids = AGENT_REGISTRY.map((a) => a.id);
    assert.equal(new Set(ids).size, 16, 'agent ids must be unique');
    for (const agent of AGENT_REGISTRY) {
      assert.ok(agent.name, `${agent.id} needs a name`);
      assert.ok(agent.role, `${agent.id} needs a role`);
      assert.ok(Array.isArray(agent.responsibilities) && agent.responsibilities.length > 0,
        `${agent.id} needs responsibilities`);
      assert.ok(agent.permissions, `${agent.id} needs permission boundaries`);
    }
  });

  it('owner run of a research agent is an honest no-op, never fake work', async () => {
    const res = await handleRequest(
      authedRequest('POST', '/api/agents/automotive-research/run', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.outcome, 'no-op');
    assert.match(body.result.reason, /No free AI\/content service is connected/);
  });

  it('owner run of the SEO agent completes with a real D1 count', async () => {
    const res = await handleRequest(
      authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.outcome, 'completed');
    assert.equal(typeof body.result.publishedArticles, 'number');
  });

  it('pause/resume/disable round-trips through the owner API', async () => {
    const paused = await handleRequest(
      authedRequest('POST', '/api/agents/seo/pause', token), env);
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).agent.status, 'paused');
    const resumed = await handleRequest(
      authedRequest('POST', '/api/agents/seo/resume', token), env);
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).agent.status, 'active');
  });
});

describe('Rate limiting is wired into the Worker fetch path', () => {
  it('rapid write bursts are answered 429', async () => {
    const env = await makeOwnerEnv();
    const statuses = [];
    for (let i = 0; i < 40; i++) {
      const res = await handleRequest(authedRequest('POST', '/api/newsletter/subscribe', null,
        { email: `rate-test-${i}@example.com`, consent: true }), env);
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected at least one 429 in 40 rapid writes, got ${statuses.join(',')}`);
  });
});

describe('Backup doc matches the dashboard that ships', () => {
  it('BACKUP-RECOVERY.md names the Download backup button, not a missing one', () => {
    const doc = read('docs/BACKUP-RECOVERY.md');
    assert.match(doc, /Download backup \(JSON\)/);
    assert.doesNotMatch(doc, /until the dashboard button exists/);
    const dashboard = read('frontend/pages/dashboard.html');
    assert.match(dashboard, /id="backupDownloadBtn"/);
  });
});
