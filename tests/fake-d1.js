// FS AI — Shared fake D1 for the CMS / newsletter / agents-admin tests.
//
// An in-memory stand-in for the Cloudflare D1 binding. It implements the
// exact SQL shapes the Worker routes issue (prepared statements with bound
// parameters), seeded with the same 8 divisions / 16 agents / accounts /
// tools as database/seed.sql. Anything else (e.g. the rate_limits table
// the rate limiter probes) throws, which the rate limiter treats as
// "no D1 table" and falls back to its in-memory store — same as the real
// Worker would on a database without that table.
// See tests/real-db.test.js for the same routes run against a real
// SQLite database built from database/schema.sql + database/seed.sql.
'use strict';

const DIVISIONS = [
  { id: 1, name: 'Automotive', slug: 'automotive', tagline: 'Cars, bikes and EVs, explained simply.', description: 'Buying guides, maintenance checklists, EV and fuel-saving advice.', sort_order: 1, is_active: 1 },
  { id: 2, name: 'AI & Technology', slug: 'ai-technology', tagline: 'AI in plain English.', description: 'What AI is, free AI tools that save time, and practical technology guides.', sort_order: 2, is_active: 1 },
  { id: 3, name: 'Gadgets & Electronics', slug: 'gadgets-electronics', tagline: 'Choose the right device.', description: 'Smartphone, laptop and tablet buying guides and comparisons.', sort_order: 3, is_active: 1 },
  { id: 4, name: 'Finance & Money', slug: 'finance-money', tagline: 'Money, explained simply.', description: 'Budgeting, saving on a small income, loans and interest in plain language.', sort_order: 4, is_active: 1 },
  { id: 5, name: 'Travel & Lifestyle', slug: 'travel-lifestyle', tagline: 'Travel more, spend less.', description: 'Budget trip planning, road-trip checklists and cost guides.', sort_order: 5, is_active: 1 },
  { id: 6, name: 'Digital Tools', slug: 'digital-tools', tagline: 'Free tools, no sign-up.', description: 'Converters and calculators you can use today, free of charge.', sort_order: 6, is_active: 1 },
  { id: 7, name: 'Health & Wellness', slug: 'health-wellness', tagline: 'Small steps, real health.', description: 'Walking, home workouts and beginner fitness guides.', sort_order: 7, is_active: 1 },
  { id: 8, name: 'Education & Learning', slug: 'education-learning', tagline: 'Learn a new skill.', description: 'Practical guides for learning digital skills in 30 days and more.', sort_order: 8, is_active: 1 },
];

const AGENTS = [
  { id: 1, name: 'Business Manager', slug: 'business-manager', role: 'manager', division_id: null, description: 'Central Business Manager.', is_active: 1, can_publish: 0 },
  { id: 2, name: 'Automotive Research', slug: 'automotive-research', role: 'research', division_id: 1, description: 'Researches automotive topics.', is_active: 1, can_publish: 0 },
  { id: 3, name: 'Technology Research', slug: 'technology-research', role: 'research', division_id: 2, description: 'Researches AI and technology topics.', is_active: 1, can_publish: 0 },
  { id: 4, name: 'Gadget Research', slug: 'gadget-research', role: 'research', division_id: 3, description: 'Researches gadgets and electronics.', is_active: 1, can_publish: 0 },
  { id: 5, name: 'Finance Research', slug: 'finance-research', role: 'research', division_id: 4, description: 'Researches finance topics.', is_active: 1, can_publish: 0 },
  { id: 6, name: 'Travel Research', slug: 'travel-research', role: 'research', division_id: 5, description: 'Researches travel and lifestyle topics.', is_active: 1, can_publish: 0 },
  { id: 7, name: 'Digital Tools', slug: 'digital-tools-agent', role: 'tools', division_id: 6, description: 'Builds and maintains the free tools.', is_active: 1, can_publish: 0 },
  { id: 8, name: 'Health Research', slug: 'health-research', role: 'research', division_id: 7, description: 'Researches health and wellness topics.', is_active: 1, can_publish: 0 },
  { id: 9, name: 'Education Research', slug: 'education-research', role: 'research', division_id: 8, description: 'Researches education topics.', is_active: 1, can_publish: 0 },
  { id: 10, name: 'SEO', slug: 'seo', role: 'seo', division_id: null, description: 'SEO agent.', is_active: 1, can_publish: 0 },
  { id: 11, name: 'Content Creation', slug: 'content-creation', role: 'content', division_id: null, description: 'Drafts articles.', is_active: 1, can_publish: 0 },
  { id: 12, name: 'Fact Checking', slug: 'fact-checking', role: 'fact_check', division_id: null, description: 'Verifies claims.', is_active: 1, can_publish: 0 },
  { id: 13, name: 'Publishing', slug: 'publishing', role: 'publishing', division_id: null, description: 'Publishes approved content.', is_active: 1, can_publish: 0 },
  { id: 14, name: 'Analytics', slug: 'analytics', role: 'analytics', division_id: null, description: 'Reports traffic honestly.', is_active: 1, can_publish: 0 },
  { id: 15, name: 'Monetization', slug: 'monetization', role: 'monetization', division_id: null, description: 'Tracks revenue honestly.', is_active: 1, can_publish: 0 },
  { id: 16, name: 'Security', slug: 'security', role: 'security', division_id: null, description: 'Security and monitoring.', is_active: 1, can_publish: 0 },
];

function makeFakeD1() {
  const now = new Date().toISOString();
  const tables = {
    sessions: new Map(), // tokenHash -> { owner_email, expires_at, created_at }
    articles: [],
    article_revisions: [],
    article_tags: [],
    business_divisions: DIVISIONS.map((d) => ({ ...d, created_at: now, updated_at: now })),
    categories: [],
    ai_agents: AGENTS.map((a) => ({ ...a, status: 'active', created_at: now, updated_at: now })),
    agent_activity_logs: [],
    automation_jobs: [],
    newsletter_subscribers: [],
    website_settings: [
      { id: 1, setting_key: 'site_name', setting_value: 'FS AI', description: 'Public brand name', updated_at: now },
      { id: 2, setting_key: 'traffic_status', setting_value: 'Data unavailable', description: 'Honest traffic status', updated_at: now },
    ],
    website_analytics: [
      { id: 1, recorded_date: '2026-11-11', source: 'none', page_views: null, unique_visitors: null, clicks: null, top_page: null, notes: 'Data unavailable.' },
    ],
    digital_tools: [
      { id: 1, name: 'Fuel Cost Calculator', slug: 'fuel-cost-calculator', division_id: 6, description: 'Estimate fuel cost for a trip.', tool_type: 'calculator', formula: 'cost = (distance / mileage) x fuel price', is_active: 1 },
      { id: 2, name: 'Loan Payment Calculator', slug: 'loan-payment-calculator', division_id: 6, description: 'Monthly loan payment.', tool_type: 'calculator', formula: 'M = P x r(1+r)^n / ((1+r)^n - 1)', is_active: 1 },
    ],
    monetization_accounts: [
      { id: 1, platform: 'GitHub', account_name: 'fs-ai', account_url: 'https://github.com/mdalfahad841-code/fs-ai', handle: 'mdalfahad841-code', status: 'active', notes: 'Source repository.', verified_at: '2026-11-11' },
      { id: 2, platform: 'Facebook', account_name: null, account_url: null, handle: null, status: 'pending', notes: 'PENDING — account not yet created.', verified_at: null },
    ],
    revenue_records: [],
  };
  const nextId = { articles: 1, article_revisions: 1, article_tags: 1, business_divisions: 9, ai_agents: 17, agent_activity_logs: 1, automation_jobs: 1, newsletter_subscribers: 1, website_settings: 3, digital_tools: 3, monetization_accounts: 3, website_analytics: 2, categories: 1 };

  function insertRow(table, row) {
    const id = nextId[table]++;
    const stored = { id, ...row };
    tables[table].push(stored);
    return stored;
  }

  function joinArticle(article) {
    const div = tables.business_divisions.find((d) => d.id === article.division_id);
    return { ...article, division: div ? div.slug : null, division_name: div ? div.name : null, publishedAt: article.published_at };
  }

  function sortPublishedDesc(rows) {
    return [...rows].sort((a, b) => {
      const pa = a.published_at, pb = b.published_at;
      if (pa === null && pb === null) return b.id - a.id;
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return pa < pb ? 1 : -1;
      return b.id - a.id;
    });
  }

  function handleArticlesJoin(q, params) {
    // Public single: WHERE a.slug = ? AND a.status = ? AND (publish_at...)
    if (q.includes('WHERE a.slug = ?')) {
      const [slug, status, now] = params;
      const row = tables.articles.find((a) => a.slug === slug && a.status === status
        && (a.publish_at === null || a.publish_at === undefined || a.publish_at <= now));
      if (!row) return [];
      const div = tables.business_divisions.find((d) => d.id === row.division_id);
      if (!div || div.is_active !== 1) return [];
      return [joinArticle(row)];
    }
    // Admin single: WHERE a.id = ? LIMIT 1
    if (q.includes('WHERE a.id = ?')) {
      const row = tables.articles.find((a) => a.id === Number(params[0]));
      return row ? [joinArticle(row)] : [];
    }
    // Division single-article list: WHERE d.slug = ? AND a.status = 'published'
    if (q.includes('WHERE d.slug = ?')) {
      const [slug, now] = params;
      const div = tables.business_divisions.find((d) => d.slug === slug);
      if (!div || div.is_active !== 1) return [];
      let rows = tables.articles.filter((a) => a.division_id === div.id && a.status === 'published');
      if (q.includes('publish_at <=')) rows = rows.filter((a) => a.publish_at === null || a.publish_at === undefined || a.publish_at <= now);
      return sortPublishedDesc(rows).slice(0, 100).map(joinArticle);
    }
    // Admin list: WHERE 1=1 [AND a.status = ?] [AND d.slug = ?]
    if (q.includes('WHERE 1=1')) {
      let idx = 0;
      let status = null, division = null;
      if (q.includes('AND a.status = ?')) status = params[idx++];
      if (q.includes('AND d.slug = ?')) division = params[idx++];
      let rows = [...tables.articles];
      if (status) rows = rows.filter((a) => a.status === status);
      if (division) {
        rows = rows.filter((a) => {
          const div = tables.business_divisions.find((d) => d.id === a.division_id);
          return div && div.slug === division;
        });
      }
      rows.sort((a, b) => {
        if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
        return b.id - a.id;
      });
      return rows.slice(0, 100).map(joinArticle);
    }
    // Public list: WHERE a.status = ? AND (a.publish_at IS NULL OR ...)
    let idx = 0;
    const status = params[idx++];
    let now = null;
    if (q.includes('publish_at <=')) now = params[idx++];
    let division = null;
    if (q.includes('AND d.slug = ?')) division = params[idx++];
    let search = null;
    if (q.includes('LIKE')) { search = params[idx++]; idx++; } // two LIKE params, same value
    const limit = params[params.length - 1];
    let rows = tables.articles.filter((a) => a.status === status);
    if (now !== null) rows = rows.filter((a) => a.publish_at === null || a.publish_at === undefined || a.publish_at <= now);
    rows = rows.filter((a) => {
      const div = tables.business_divisions.find((d) => d.id === a.division_id);
      return div && div.is_active === 1;
    });
    if (division) {
      rows = rows.filter((a) => {
        const div = tables.business_divisions.find((d) => d.id === a.division_id);
        return div && div.slug === division;
      });
    }
    if (search) {
      const needle = String(search).replace(/%/g, '').toLowerCase();
      rows = rows.filter((a) => ((a.title || '') + ' ' + (a.excerpt || '')).toLowerCase().includes(needle));
    }
    return sortPublishedDesc(rows).slice(0, limit).map(joinArticle);
  }

  // Generic INSERT INTO <table> (cols) VALUES (...) — '?' binds in order,
  // string/number/NULL literals and datetime('now') are honoured.
  function handleInsert(q, params) {
    const m = /^INSERT INTO ([a-z_]+) \(([^)]+)\) VALUES \((.+)\)( ON CONFLICT.*)?$/.exec(q);
    if (!m) throw new Error('fake D1: unsupported INSERT: ' + q);
    const [, table, colsRaw, valsRaw] = m;
    if (table === 'website_settings' && q.includes('ON CONFLICT')) {
      const [key, value, description, updatedAt] = params;
      const existing = tables.website_settings.find((r) => r.setting_key === key);
      if (existing) {
        existing.setting_value = value;
        existing.updated_at = updatedAt;
        return { success: true, meta: { changes: 1, last_row_id: existing.id } };
      }
      const row = insertRow('website_settings', { setting_key: key, setting_value: value, description, updated_at: updatedAt });
      return { success: true, meta: { changes: 1, last_row_id: row.id } };
    }
    const cols = colsRaw.split(',').map((c) => c.trim());
    const tokens = [];
    let cur = '', inStr = false;
    for (let i = 0; i < valsRaw.length; i++) {
      const ch = valsRaw[i];
      if (inStr) {
        cur += ch;
        if (ch === "'") inStr = false;
        continue;
      }
      if (ch === "'") { inStr = true; cur += ch; continue; }
      if (ch === ',') { tokens.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) tokens.push(cur.trim());
    const row = {};
    let p = 0;
    tokens.forEach((tok, i) => {
      if (tok === '?') row[cols[i]] = params[p++];
      else if (/^datetime\('now'\)$/i.test(tok)) row[cols[i]] = new Date().toISOString();
      else if (tok === 'NULL') row[cols[i]] = null;
      else if (/^'.*'$/.test(tok)) row[cols[i]] = tok.slice(1, -1).replace(/''/g, "'");
      else if (/^-?\d+(\.\d+)?$/.test(tok)) row[cols[i]] = Number(tok);
      else throw new Error('fake D1: unsupported INSERT literal: ' + tok);
    });
    if (table === 'sessions') {
      tables.sessions.set(row.token_hash, { owner_email: row.owner_email, expires_at: row.expires_at, created_at: row.created_at });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (!tables[table]) throw new Error('fake D1: unknown INSERT table: ' + table);
    if (row.created_at === undefined && table !== 'agent_activity_logs') row.created_at = new Date().toISOString();
    if (row.updated_at === undefined && (table === 'articles' || table === 'business_divisions' || table === 'ai_agents')) row.updated_at = row.created_at || new Date().toISOString();
    const stored = insertRow(table, row);
    return { success: true, meta: { changes: 1, last_row_id: stored.id } };
  }

  async function all(q, params) {
    if (q.startsWith('SELECT owner_email, expires_at FROM sessions')) {
      const row = tables.sessions.get(params[0]);
      return { results: row ? [{ owner_email: row.owner_email, expires_at: row.expires_at }] : [] };
    }
    if (q.includes('FROM rate_limits')) throw new Error('fake D1: no rate_limits table');
    if (q.includes('FROM articles a JOIN business_divisions d')) return { results: handleArticlesJoin(q, params) };
    if (q.startsWith('SELECT id FROM articles WHERE slug = ?')) {
      const row = tables.articles.find((a) => a.slug === params[0]);
      return { results: row ? [{ id: row.id }] : [] };
    }
    if (q.startsWith('SELECT id, slug FROM articles WHERE status = ? AND publish_at IS NOT NULL')) {
      const rows = tables.articles
        .filter((a) => a.status === params[0] && a.publish_at !== null && a.publish_at !== undefined && a.publish_at <= params[1])
        .sort((a, b) => (a.publish_at < b.publish_at ? -1 : 1))
        .map((a) => ({ id: a.id, slug: a.slug }));
      return { results: rows };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM articles WHERE division_id = ? AND status = ?')) {
      return { results: [{ count: tables.articles.filter((a) => a.division_id === Number(params[0]) && a.status === params[1]).length }] };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM articles WHERE division_id = ?')) {
      return { results: [{ count: tables.articles.filter((a) => a.division_id === Number(params[0])).length }] };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM articles WHERE status = ?')) {
      return { results: [{ count: tables.articles.filter((a) => a.status === params[0]).length }] };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM digital_tools')) {
      return { results: [{ count: tables.digital_tools.filter((t) => t.is_active === 1).length }] };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM monetization_accounts WHERE status = ?')) {
      return { results: [{ count: tables.monetization_accounts.filter((a) => a.status === params[0]).length }] };
    }
    if (q.startsWith('SELECT COUNT(*) AS count FROM automation_jobs WHERE status IN')) {
      return { results: [{ count: tables.automation_jobs.filter((j) => j.status === 'queued' || j.status === 'running').length }] };
    }
    if (q.startsWith('SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_records')) {
      const total = tables.revenue_records.reduce((s, r) => s + Number(r.amount || 0), 0);
      return { results: [{ total }] };
    }
    if (q.startsWith('SELECT * FROM business_divisions WHERE is_active = 1')) {
      return { results: tables.business_divisions.filter((d) => d.is_active === 1).sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id)).map((d) => ({ ...d })) };
    }
    if (q.startsWith('SELECT * FROM business_divisions ORDER BY')) {
      return { results: [...tables.business_divisions].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id)).map((d) => ({ ...d })) };
    }
    if (q.startsWith('SELECT * FROM business_divisions WHERE slug = ?')) {
      const row = tables.business_divisions.find((d) => d.slug === params[0] && d.is_active === 1);
      return { results: row ? [{ ...row }] : [] };
    }
    if (q.startsWith('SELECT id FROM business_divisions WHERE name = ?')) {
      const row = tables.business_divisions.find((d) => d.name === params[0]);
      return { results: row ? [{ id: row.id }] : [] };
    }
    if (q.startsWith('SELECT id FROM business_divisions WHERE slug = ?')) {
      const row = tables.business_divisions.find((d) => d.slug === params[0]);
      return { results: row ? [{ id: row.id }] : [] };
    }
    if (q.startsWith('SELECT id FROM business_divisions WHERE id = ?')) {
      const row = tables.business_divisions.find((d) => d.id === Number(params[0]));
      return { results: row ? [{ id: row.id }] : [] };
    }
    if (q.startsWith('SELECT * FROM business_divisions WHERE id = ?')) {
      const row = tables.business_divisions.find((d) => d.id === Number(params[0]));
      return { results: row ? [{ ...row }] : [] };
    }
    if (q.startsWith('SELECT * FROM ai_agents ORDER BY id ASC')) {
      return { results: tables.ai_agents.map((a) => ({ ...a })) };
    }
    if (q.startsWith('SELECT * FROM ai_agents WHERE slug = ? OR name = ?')) {
      const row = tables.ai_agents.find((a) => a.slug === params[0] || a.name === params[1]);
      return { results: row ? [{ ...row }] : [] };
    }
    if (q.startsWith('SELECT id FROM ai_agents WHERE slug = ?')) {
      const row = tables.ai_agents.find((a) => a.slug === params[0]);
      return { results: row ? [{ id: row.id }] : [] };
    }
    if (q.startsWith('SELECT * FROM agent_activity_logs WHERE agent_id = ?')) {
      const rows = tables.agent_activity_logs.filter((l) => l.agent_id === Number(params[0]))
        .sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : b.id - a.id))
        .slice(0, params[1] || 50);
      return { results: rows.map((r) => ({ ...r })) };
    }
    if (q.startsWith('SELECT * FROM agent_activity_logs ORDER BY')) {
      const rows = [...tables.agent_activity_logs]
        .sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : b.id - a.id))
        .slice(0, params[0] || 200);
      return { results: rows.map((r) => ({ ...r })) };
    }
    if (q.startsWith('SELECT tag FROM article_tags WHERE article_id = ?')) {
      return { results: tables.article_tags.filter((t) => t.article_id === Number(params[0])).sort((a, b) => (a.tag < b.tag ? -1 : 1)).map((t) => ({ tag: t.tag })) };
    }
    if (q.startsWith('SELECT * FROM article_revisions WHERE article_id = ?')) {
      const rows = tables.article_revisions.filter((r) => r.article_id === Number(params[0]))
        .sort((a, b) => (a.revised_at !== b.revised_at ? (a.revised_at < b.revised_at ? 1 : -1) : b.id - a.id))
        .slice(0, 100);
      return { results: rows.map((r) => ({ ...r })) };
    }
    if (q.startsWith('SELECT id, status FROM newsletter_subscribers WHERE email = ?')) {
      const row = tables.newsletter_subscribers.find((s) => s.email === params[0]);
      return { results: row ? [{ id: row.id, status: row.status }] : [] };
    }
    if (q.startsWith('SELECT * FROM newsletter_subscribers WHERE id = ?')) {
      const row = tables.newsletter_subscribers.find((s) => s.id === Number(params[0]));
      return { results: row ? [{ ...row }] : [] };
    }
    if (q.startsWith('SELECT * FROM newsletter_subscribers')) {
      let rows = [...tables.newsletter_subscribers];
      if (q.includes('WHERE status = ?')) rows = rows.filter((s) => s.status === params[0]);
      rows.sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : b.id - a.id));
      return { results: rows.slice(0, 100).map((r) => ({ ...r })) };
    }
    if (q.startsWith('SELECT setting_value FROM website_settings WHERE setting_key = ?')) {
      const row = tables.website_settings.find((r) => r.setting_key === params[0]);
      return { results: row ? [{ setting_value: row.setting_value }] : [] };
    }
    if (q.startsWith('SELECT * FROM monetization_accounts ORDER BY platform ASC')) {
      return { results: [...tables.monetization_accounts].sort((a, b) => (a.platform < b.platform ? -1 : 1)).map((r) => ({ ...r })) };
    }
    if (q.includes('FROM digital_tools t LEFT JOIN business_divisions d')) {
      let rows = tables.digital_tools.filter((t) => t.is_active === 1).map((t) => {
        const div = tables.business_divisions.find((d) => d.id === t.division_id);
        return { ...t, division: div ? div.slug : null, division_name: div ? div.name : null };
      });
      if (q.includes('AND t.slug = ?')) rows = rows.filter((t) => t.slug === params[0]);
      if (q.includes('AND (d.slug = ? OR t.tool_type = ?)')) {
        rows = rows.filter((t) => t.division === params[0] || t.tool_type === params[1]);
      }
      return { results: rows };
    }
    if (q.startsWith('SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1')) {
      const rows = [...tables.website_analytics].sort((a, b) => (a.recorded_date < b.recorded_date ? 1 : -1));
      return { results: rows.length ? [{ ...rows[0] }] : [] };
    }
    const backup = /^SELECT \* FROM ([a-z_]+) ORDER BY id DESC LIMIT \?$/.exec(q);
    if (backup) {
      const rows = [...(tables[backup[1]] || [])].sort((a, b) => b.id - a.id).slice(0, params[0]);
      return { results: rows.map((r) => ({ ...r })) };
    }
    throw new Error('fake D1: unsupported SELECT: ' + q);
  }

  async function run(q, params) {
    if (q.startsWith('INSERT INTO sessions')) {
      const [tokenHash, ownerEmail, expiresAt, createdAt] = params;
      tables.sessions.set(tokenHash, { owner_email: ownerEmail, expires_at: expiresAt, created_at: createdAt });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith('DELETE FROM sessions')) {
      tables.sessions.delete(params[0]);
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith('INSERT INTO ')) return handleInsert(q, params);
    if (q.startsWith('DELETE FROM article_tags WHERE article_id = ?')) {
      const before = tables.article_tags.length;
      tables.article_tags = tables.article_tags.filter((t) => t.article_id !== Number(params[0]));
      return { success: true, meta: { changes: before - tables.article_tags.length, last_row_id: 0 } };
    }
    if (q.startsWith('DELETE FROM articles WHERE id = ?')) {
      const before = tables.articles.length;
      tables.articles = tables.articles.filter((a) => a.id !== Number(params[0]));
      return { success: true, meta: { changes: before - tables.articles.length, last_row_id: 0 } };
    }
    if (q.startsWith('DELETE FROM business_divisions WHERE id = ?')) {
      const before = tables.business_divisions.length;
      tables.business_divisions = tables.business_divisions.filter((d) => d.id !== Number(params[0]));
      return { success: true, meta: { changes: before - tables.business_divisions.length, last_row_id: 0 } };
    }
    if (q.startsWith('UPDATE articles SET division_id = ?')) {
      const [division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, updated_at, id] = params;
      const row = tables.articles.find((a) => a.id === Number(id));
      if (!row) return { success: true, meta: { changes: 0, last_row_id: 0 } };
      Object.assign(row, { division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, updated_at });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith("UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?")) {
      const [status, published_at, updated_at, id] = params;
      const row = tables.articles.find((a) => a.id === Number(id));
      if (!row) return { success: true, meta: { changes: 0, last_row_id: 0 } };
      Object.assign(row, { status, published_at, updated_at });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith("UPDATE articles SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?")) {
      const [status, updated_at, id] = params;
      const row = tables.articles.find((a) => a.id === Number(id));
      if (!row) return { success: true, meta: { changes: 0, last_row_id: 0 } };
      Object.assign(row, { status, published_at: null, updated_at });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith('UPDATE business_divisions SET')) {
      const [name, slug, tagline, description, icon, sort_order, is_active, updated_at, id] = params;
      const row = tables.business_divisions.find((d) => d.id === Number(id));
      if (!row) return { success: true, meta: { changes: 0, last_row_id: 0 } };
      Object.assign(row, { name, slug, tagline, description, icon, sort_order, is_active, updated_at });
      return { success: true, meta: { changes: 1, last_row_id: 0 } };
    }
    if (q.startsWith("UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = ? WHERE email = ?")) {
      const [status, unsubscribed_at, email] = params;
      const row = tables.newsletter_subscribers.find((s) => s.email === email);
      if (row) Object.assign(row, { status, unsubscribed_at });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    if (q.startsWith("UPDATE newsletter_subscribers SET status = ?, subscribed_at = ?, unsubscribed_at = NULL WHERE email = ?")) {
      const [status, subscribed_at, email] = params;
      const row = tables.newsletter_subscribers.find((s) => s.email === email);
      if (row) Object.assign(row, { status, subscribed_at, unsubscribed_at: null });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    if (q.startsWith("UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = ? WHERE id = ?")) {
      const [status, unsubscribed_at, id] = params;
      const row = tables.newsletter_subscribers.find((s) => s.id === Number(id));
      if (row) Object.assign(row, { status, unsubscribed_at });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    if (q.startsWith('UPDATE automation_jobs SET status = ?')) {
      const [status, result, finished_at, id] = params;
      const row = tables.automation_jobs.find((j) => j.id === Number(id));
      if (row) Object.assign(row, { status, result, finished_at });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    if (q.startsWith('UPDATE ai_agents SET is_active = ?')) {
      const [is_active, status, updated_at, id] = params;
      const row = tables.ai_agents.find((a) => a.id === Number(id));
      if (row) Object.assign(row, { is_active, status, updated_at });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    if (q.startsWith('UPDATE monetization_accounts SET status = ?')) {
      const [status, notes, updated_at, platform] = params;
      const row = tables.monetization_accounts.find((a) => a.platform === platform);
      if (row) Object.assign(row, { status, notes, updated_at });
      return { success: true, meta: { changes: row ? 1 : 0, last_row_id: 0 } };
    }
    throw new Error('fake D1: unsupported statement: ' + q);
  }

  return {
    _tables: tables,
    prepare(sql) {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            all: () => all(q, params),
            run: () => run(q, params),
          };
        },
        all: () => all(q, []),
        run: () => run(q, []),
      };
    },
  };
}

module.exports = { makeFakeD1, makeOwnerEnv, loginOk, authedRequest };

const { hashPassword } = require('../backend/security/crypto.js');

const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';

// Env with a fake D1, a session secret and a real PBKDF2 hash of the
// correct password (hashed here in the test — no real credential).
async function makeOwnerEnv() {
  const env = { DB: makeFakeD1(), SESSION_SECRET: 'test-session-secret-for-cms-tests' };
  env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
  return env;
}

// Log in through the real Worker route and return the Bearer token.
async function loginOk(handleRequest, env) {
  const res = await handleRequest(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: CORRECT_PASSWORD }),
  }), env);
  if (res.status !== 200) throw new Error('test login failed: ' + res.status + ' ' + await res.text());
  const body = await res.json();
  return body.token;
}

function authedRequest(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    return new Request(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`http://localhost${path}`, { method, headers });
}
