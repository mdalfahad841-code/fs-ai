// FS AI — 16-agent registry tests.
// Self-contained: the registry under test is defined in this file, mirroring
// database/seed.sql (agents + agent_permissions). If the seed changes, this
// file must change with it.
// Run: node --test tests/agents.test.js  (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Registry under test — mirrors database/seed.sql exactly.
// ---------------------------------------------------------------------------
const AGENTS = [
  { id: 1, name: 'Business Manager', slug: 'business-manager', role: 'manager', division: null, canPublish: false,
    permissions: ['jobs.create', 'jobs.read', 'agents.read', 'approvals.request'] },
  { id: 2, name: 'Automotive Research', slug: 'automotive-research', role: 'research', division: 'automotive', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 3, name: 'Technology Research', slug: 'technology-research', role: 'research', division: 'ai-technology', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 4, name: 'Gadget Research', slug: 'gadget-research', role: 'research', division: 'gadgets-electronics', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 5, name: 'Finance Research', slug: 'finance-research', role: 'research', division: 'finance-money', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 6, name: 'Travel Research', slug: 'travel-research', role: 'research', division: 'travel-lifestyle', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 7, name: 'Digital Tools', slug: 'digital-tools-agent', role: 'tools', division: 'digital-tools', canPublish: false,
    permissions: ['tools.create', 'tools.read', 'tools.update'] },
  { id: 8, name: 'Health Research', slug: 'health-research', role: 'research', division: 'health-wellness', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 9, name: 'Education Research', slug: 'education-research', role: 'research', division: 'education-learning', canPublish: false,
    permissions: ['research.create', 'research.read', 'articles.draft'] },
  { id: 10, name: 'SEO', slug: 'seo', role: 'seo', division: null, canPublish: false,
    permissions: ['articles.read', 'seo.audit', 'keywords.read'] },
  { id: 11, name: 'Content Creation', slug: 'content-creation', role: 'content', division: null, canPublish: false,
    permissions: ['articles.draft', 'articles.read'] },
  { id: 12, name: 'Fact Checking', slug: 'fact-checking', role: 'fact_check', division: null, canPublish: false,
    permissions: ['articles.read', 'fact_check.verify'] },
  { id: 13, name: 'Publishing', slug: 'publishing', role: 'publishing', division: null, canPublish: false,
    permissions: ['articles.read', 'approvals.request'] },
  { id: 14, name: 'Analytics', slug: 'analytics', role: 'analytics', division: null, canPublish: false,
    permissions: ['analytics.read'] },
  { id: 15, name: 'Monetization', slug: 'monetization', role: 'monetization', division: null, canPublish: false,
    permissions: ['monetization.read', 'revenue.read'] },
  { id: 16, name: 'Security', slug: 'security', role: 'security', division: null, canPublish: false,
    permissions: ['security.read', 'security.log'] },
];

// Permissions no agent is ever allowed to hold.
const FORBIDDEN_PERMISSIONS = [
  'articles.publish',
  'articles.delete',
  'admin.grant',
  'admin.revoke',
  'owner.impersonate',
  'revenue.write',
  'settings.write',
  'users.delete',
];

// Roles that exist in the system.
const KNOWN_ROLES = new Set([
  'manager', 'research', 'tools', 'seo', 'content', 'fact_check',
  'publishing', 'analytics', 'monetization', 'security',
]);

// The 8 divisions research agents may be scoped to.
const DIVISIONS = new Set([
  'automotive', 'ai-technology', 'gadgets-electronics', 'finance-money',
  'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning',
]);

function hasPermission(agent, permission) {
  return agent.permissions.includes(permission);
}

describe('Agent registry shape', () => {
  it('has exactly 16 agents', () => {
    assert.equal(AGENTS.length, 16);
  });

  it('every agent has the required fields (id, name, slug, role, permissions)', () => {
    for (const agent of AGENTS) {
      assert.equal(typeof agent.id, 'number', `${agent.name}: id`);
      assert.ok(agent.name && agent.name.length > 0, `${agent.slug}: name`);
      assert.ok(agent.slug && agent.slug.length > 0, `${agent.name}: slug`);
      assert.ok(KNOWN_ROLES.has(agent.role), `${agent.name}: unknown role ${agent.role}`);
      assert.ok(Array.isArray(agent.permissions), `${agent.name}: permissions array`);
    }
  });

  it('names and slugs are unique', () => {
    const names = new Set(AGENTS.map((a) => a.name));
    const slugs = new Set(AGENTS.map((a) => a.slug));
    assert.equal(names.size, AGENTS.length, 'duplicate agent name');
    assert.equal(slugs.size, AGENTS.length, 'duplicate agent slug');
  });

  it('ids are 1–16 with no gaps', () => {
    const ids = AGENTS.map((a) => a.id).sort((x, y) => x - y);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('includes the Central Business Manager as agent 1', () => {
    const manager = AGENTS.find((a) => a.slug === 'business-manager');
    assert.ok(manager);
    assert.equal(manager.role, 'manager');
    assert.equal(manager.id, 1);
  });

  it('includes all 15 specialist agents by name', () => {
    const names = AGENTS.map((a) => a.name);
    for (const expected of [
      'Automotive Research', 'Technology Research', 'Gadget Research',
      'Finance Research', 'Travel Research', 'Digital Tools',
      'Health Research', 'Education Research', 'SEO', 'Content Creation',
      'Fact Checking', 'Publishing', 'Analytics', 'Monetization', 'Security',
    ]) {
      assert.ok(names.includes(expected), `missing agent: ${expected}`);
    }
  });
});

describe('Permission boundaries', () => {
  it('every agent has at least one permission', () => {
    for (const agent of AGENTS) {
      assert.ok(agent.permissions.length >= 1, `${agent.name} has no permissions`);
    }
  });

  it('no agent holds a forbidden permission', () => {
    for (const agent of AGENTS) {
      for (const forbidden of FORBIDDEN_PERMISSIONS) {
        assert.ok(
          !hasPermission(agent, forbidden),
          `${agent.name} must not hold ${forbidden}`,
        );
      }
    }
  });

  it('no agent can publish directly (canPublish is false for all)', () => {
    for (const agent of AGENTS) {
      assert.equal(agent.canPublish, false, `${agent.name} must not publish directly`);
    }
  });

  it('the Publishing agent cannot publish without an owner approval request', () => {
    const publishing = AGENTS.find((a) => a.slug === 'publishing');
    assert.ok(!hasPermission(publishing, 'articles.publish'));
    assert.ok(hasPermission(publishing, 'approvals.request'));
  });

  it('only the Business Manager coordinates jobs', () => {
    const jobCreators = AGENTS.filter((a) => hasPermission(a, 'jobs.create'));
    assert.deepEqual(jobCreators.map((a) => a.slug), ['business-manager']);
  });

  it('research agents are scoped to a real division, never "all"', () => {
    for (const agent of AGENTS.filter((a) => a.role === 'research')) {
      assert.ok(agent.division, `${agent.name} has no division scope`);
      assert.ok(DIVISIONS.has(agent.division), `${agent.name}: bad division ${agent.division}`);
    }
  });

  it('research agents can draft but cannot publish or approve', () => {
    for (const agent of AGENTS.filter((a) => a.role === 'research')) {
      assert.ok(hasPermission(agent, 'articles.draft'), `${agent.name} cannot draft`);
      assert.ok(!hasPermission(agent, 'articles.publish'), `${agent.name} can publish`);
      assert.ok(!hasPermission(agent, 'approvals.request'), `${agent.name} can self-approve`);
    }
  });

  it('Fact Checking is the only agent that can verify facts', () => {
    const verifiers = AGENTS.filter((a) => hasPermission(a, 'fact_check.verify'));
    assert.deepEqual(verifiers.map((a) => a.slug), ['fact-checking']);
  });

  it('Analytics can only read analytics (no write, no publish)', () => {
    const analytics = AGENTS.find((a) => a.slug === 'analytics');
    assert.deepEqual(analytics.permissions, ['analytics.read']);
  });

  it('Monetization can read revenue but never write it', () => {
    const monetization = AGENTS.find((a) => a.slug === 'monetization');
    assert.ok(hasPermission(monetization, 'revenue.read'));
    assert.ok(!hasPermission(monetization, 'revenue.write'));
  });

  it('Security can log events but holds no content or money permissions', () => {
    const security = AGENTS.find((a) => a.slug === 'security');
    assert.ok(hasPermission(security, 'security.log'));
    assert.ok(!hasPermission(security, 'articles.draft'));
    assert.ok(!hasPermission(security, 'revenue.read'));
  });
});
