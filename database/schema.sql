-- ============================================================================
-- FS AI — FAHAD SOMRAT AI
-- Full database schema (Cloudflare D1 / SQLite)
-- 26 tables. Zero-cost, free tier only.
--
-- Apply order: schema.sql -> seed.sql
-- (or migrations/001_initial.sql -> 002_agents_accounts.sql ->
--  003_sessions.sql -> 004_cms_newsletter.sql -> seed.sql)
-- This file is the complete reference: it includes the `sessions` table
-- (auth code reads/writes it), the `rate_limits` table (the Worker rate
-- limiter's D1 path), articles.publish_at, article_revisions and
-- ai_agents.status, so a fresh deploy from schema.sql alone has a
-- working login, rate limiting, CMS and scheduled publishing.
-- Revenue seed is $0.00; analytics seed is "Data unavailable" — never fake
-- traffic, clicks, revenue or account connections.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. owner_accounts — the owner / admin login accounts (password-only login;
--    MFA was removed by owner decision 2026-11-11; TOTP columns stay inert)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owner_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT 'Fahad Somrat',
    role            TEXT NOT NULL DEFAULT 'SYSTEM_OWNER'
                    CHECK (role IN ('SYSTEM_OWNER', 'SUPER_ADMIN', 'ADMIN')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    totp_secret     TEXT,              -- inert: MFA removed; kept for re-enable path
    backup_codes    TEXT,              -- inert: MFA removed; kept for re-enable path
    last_login_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_owner_accounts_email ON owner_accounts(email);
CREATE INDEX IF NOT EXISTS idx_owner_accounts_role  ON owner_accounts(role);

-- ---------------------------------------------------------------------------
-- 2. user_sessions — login sessions (owner/admin only; no public accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id        INTEGER NOT NULL REFERENCES owner_accounts(id) ON DELETE CASCADE,
    session_token   TEXT NOT NULL UNIQUE,
    user_agent      TEXT,
    ip_address      TEXT,
    expires_at      TEXT NOT NULL,
    revoked_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token   ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_owner   ON user_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 2b. sessions — owner login sessions used by the auth middleware
--     (backend/middleware/auth.js). This is the table the live login flow
--     actually reads/writes (token_hash, owner_email, expires_at); it
--     used to live only in migrations/003_sessions.sql, so a fresh deploy
--     from schema.sql alone broke login. user_sessions (above) is a
--     separate, currently unused table — do not confuse the two.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 3. website_settings — key/value site settings (single source of truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key     TEXT NOT NULL UNIQUE,
    setting_value   TEXT NOT NULL DEFAULT '',
    description     TEXT,
    updated_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_website_settings_key ON website_settings(setting_key);

-- ---------------------------------------------------------------------------
-- 4. business_divisions — the 8 divisions of FS AI
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_divisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    tagline         TEXT,
    description     TEXT,
    icon            TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_business_divisions_slug  ON business_divisions(slug);
CREATE INDEX IF NOT EXISTS idx_business_divisions_order ON business_divisions(sort_order);

-- ---------------------------------------------------------------------------
-- 5. categories — article categories inside a division
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id     INTEGER NOT NULL REFERENCES business_divisions(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (division_id, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_division ON categories(division_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug     ON categories(slug);

-- ---------------------------------------------------------------------------
-- 6. articles — published / draft articles (publishing needs owner approval)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id     INTEGER NOT NULL REFERENCES business_divisions(id) ON DELETE RESTRICT,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    excerpt         TEXT,
    body            TEXT NOT NULL DEFAULT '',
    author          TEXT NOT NULL DEFAULT 'FS AI',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_approval', 'approved', 'published', 'archived')),
    fact_checked    INTEGER NOT NULL DEFAULT 0 CHECK (fact_checked IN (0, 1)),
    seo_title       TEXT,
    seo_description TEXT,
    featured_image  TEXT,
    reading_minutes INTEGER,
    published_at    TEXT,
    publish_at      TEXT,              -- scheduled publish time (migration 004); NULL = publish immediately when approved
    created_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_division ON articles(division_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_slug     ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status   ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);

-- ---------------------------------------------------------------------------
-- 7. article_tags — tag vocabulary (many-to-many via article_tags link rows
--    is modelled here as one row per (article, tag); tags are free text)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (article_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag     ON article_tags(tag);

-- ---------------------------------------------------------------------------
-- 8. article_sources — sources cited by an article (fact-checking trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    source_title    TEXT NOT NULL,
    source_url      TEXT,
    source_type     TEXT CHECK (source_type IN ('official', 'news', 'research', 'manufacturer', 'other')),
    accessed_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_sources_article ON article_sources(article_id);

-- ---------------------------------------------------------------------------
-- 9. keywords — SEO keywords tracked per division/article
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keywords (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword         TEXT NOT NULL,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    article_id      INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    search_volume   INTEGER,           -- NULL = unknown; never invented
    difficulty      TEXT CHECK (difficulty IN ('low', 'medium', 'high')),
    target_rank     INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (keyword, division_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword  ON keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_keywords_division ON keywords(division_id);
CREATE INDEX IF NOT EXISTS idx_keywords_article  ON keywords(article_id);

-- ---------------------------------------------------------------------------
-- 10. research_records — research agent output before drafting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id     INTEGER NOT NULL REFERENCES business_divisions(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    summary         TEXT,
    findings        TEXT,              -- JSON text
    sources         TEXT,              -- JSON text (list of URLs/titles)
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'collected'
                    CHECK (status IN ('collected', 'verified', 'used', 'discarded')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_division ON research_records(division_id);
CREATE INDEX IF NOT EXISTS idx_research_agent    ON research_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_research_status   ON research_records(status);

-- ---------------------------------------------------------------------------
-- 11. ai_agents — the 16-agent registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_agents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL,     -- e.g. 'research', 'seo', 'publishing', 'manager'
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    description     TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'disabled')),
    can_publish     INTEGER NOT NULL DEFAULT 0 CHECK (can_publish IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_agents_slug   ON ai_agents(slug);
CREATE INDEX IF NOT EXISTS idx_ai_agents_role   ON ai_agents(role);
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON ai_agents(is_active);

-- ---------------------------------------------------------------------------
-- 12. agent_permissions — explicit permission boundaries per agent.
--     No agent may act outside its listed permissions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_permissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    permission      TEXT NOT NULL,     -- e.g. 'articles.read', 'articles.draft'
    scope           TEXT,              -- e.g. division slug or 'all'
    granted_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    granted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (agent_id, permission, scope)
);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_agent ON agent_permissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_perm  ON agent_permissions(permission);

-- ---------------------------------------------------------------------------
-- 13. agent_activity_logs — audit trail of everything agents do
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,     -- e.g. 'draft_created', 'fact_check_passed'
    entity_type     TEXT,              -- e.g. 'article', 'tool', 'job'
    entity_id       INTEGER,
    details         TEXT,              -- JSON text
    status          TEXT NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success', 'failed', 'skipped')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent   ON agent_activity_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_action  ON agent_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_agent_activity_created ON agent_activity_logs(created_at);

-- ---------------------------------------------------------------------------
-- 14. automation_jobs — scheduled / queued automation runs (manual trigger
--     only unless the owner enables a schedule; nothing auto-publishes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    job_type        TEXT NOT NULL,     -- e.g. 'research', 'draft', 'seo_audit', 'publish'
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    payload         TEXT,              -- JSON text
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    scheduled_at    TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    result          TEXT,              -- JSON text
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status ON automation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_agent  ON automation_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_type   ON automation_jobs(job_type);

-- ---------------------------------------------------------------------------
-- 15. approval_records — owner approval gate. NOTHING publishes without one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,     -- e.g. 'article', 'tool', 'post'
    entity_id       INTEGER NOT NULL,
    requested_by    INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    approved_by     INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    decision        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (decision IN ('pending', 'approved', 'rejected', 'changes_requested')),
    decision_note   TEXT,
    requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_entity   ON approval_records(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approval_decision ON approval_records(decision);

-- ---------------------------------------------------------------------------
-- 16. website_analytics — analytics snapshots. Values are ONLY recorded
--     from a connected analytics account; until then the honest value is
--     "Data unavailable" and no rows are fabricated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_analytics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_date   TEXT NOT NULL,     -- YYYY-MM-DD
    source          TEXT NOT NULL DEFAULT 'none'
                    CHECK (source IN ('none', 'google_analytics', 'cloudflare', 'manual')),
    page_views      INTEGER,           -- NULL = unavailable
    unique_visitors INTEGER,           -- NULL = unavailable
    clicks          INTEGER,           -- NULL = unavailable
    top_page        TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (recorded_date, source)
);
CREATE INDEX IF NOT EXISTS idx_analytics_date   ON website_analytics(recorded_date);
CREATE INDEX IF NOT EXISTS idx_analytics_source ON website_analytics(source);

-- ---------------------------------------------------------------------------
-- 17. digital_tools — the free calculator / converter tools
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS digital_tools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    description     TEXT,
    tool_type       TEXT NOT NULL DEFAULT 'calculator'
                    CHECK (tool_type IN ('calculator', 'converter', 'generator', 'checker')),
    formula         TEXT,              -- human-readable formula reference
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_digital_tools_slug   ON digital_tools(slug);
CREATE INDEX IF NOT EXISTS idx_digital_tools_division ON digital_tools(division_id);

-- ---------------------------------------------------------------------------
-- 18. monetization_accounts — ad / affiliate accounts. status 'pending'
--     until the owner verifies the account exists; never claim connected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monetization_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL,     -- e.g. 'GitHub', 'YouTube', 'AdSense'
    account_name    TEXT,
    account_url     TEXT,
    handle          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
    notes           TEXT,
    verified_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (platform, account_name)
);
CREATE INDEX IF NOT EXISTS idx_monetization_platform ON monetization_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_monetization_status   ON monetization_accounts(status);

-- ---------------------------------------------------------------------------
-- 19. affiliate_links — affiliate links (only real, owner-approved links)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER REFERENCES monetization_accounts(id) ON DELETE SET NULL,
    article_id      INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    url             TEXT NOT NULL,
    network         TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_account ON affiliate_links(account_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_article ON affiliate_links(article_id);

-- ---------------------------------------------------------------------------
-- 20. revenue_records — honest revenue ledger. Starts at $0.00.
--     Only real, verified revenue is ever recorded here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER REFERENCES monetization_accounts(id) ON DELETE SET NULL,
    source          TEXT NOT NULL,     -- e.g. 'ads', 'affiliate', 'other'
    amount          NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    recorded_date   TEXT NOT NULL,     -- YYYY-MM-DD
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revenue_account ON revenue_records(account_id);
CREATE INDEX IF NOT EXISTS idx_revenue_date    ON revenue_records(recorded_date);
CREATE INDEX IF NOT EXISTS idx_revenue_source  ON revenue_records(source);

-- ---------------------------------------------------------------------------
-- 21. expense_records — spending ledger. Must stay $0.00 under the
--     zero-cost policy unless the owner explicitly approves a spend.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT NOT NULL,     -- e.g. 'hosting', 'domain', 'software'
    description     TEXT,
    amount          NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    recorded_date   TEXT NOT NULL,     -- YYYY-MM-DD
    approved_by     INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_date     ON expense_records(recorded_date);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense_records(category);

-- ---------------------------------------------------------------------------
-- 22. security_events — security & monitoring log (login attempts, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT NOT NULL,     -- e.g. 'login_success', 'login_failed', 'session_revoked'
    owner_id        INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    details         TEXT,              -- JSON text
    severity        TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info', 'warning', 'critical')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_type     ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_owner    ON security_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_security_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_created  ON security_events(created_at);

-- ---------------------------------------------------------------------------
-- 23. newsletter_subscribers — newsletter list (double opt-in; no bought lists)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
    subscribed_at   TEXT,
    unsubscribed_at TEXT,
    source          TEXT,              -- e.g. 'website', 'import'
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_newsletter_email  ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status);

-- ---------------------------------------------------------------------------
-- 24. rate_limits — Worker rate-limiter state (backend/middleware/
--     rate-limit.js). Without this table the limiter falls back to a
--     per-isolate in-memory map on every Worker, so limits do not survive
--     across isolates. Key is "<client-ip>:<read|write>".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
    key       TEXT PRIMARY KEY,
    count     INTEGER NOT NULL DEFAULT 0,
    reset_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

-- ---------------------------------------------------------------------------
-- 25. article_revisions — pre-edit copies of articles (migration 004).
--     The CMS stores the current row here BEFORE every owner edit, so the
--     edit history survives as the audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title       TEXT,
    excerpt     TEXT,
    body        TEXT,
    status      TEXT,
    revised_by  TEXT,
    revised_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_revisions_article ON article_revisions(article_id);
