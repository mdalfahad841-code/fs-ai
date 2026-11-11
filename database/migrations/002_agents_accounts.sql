-- ============================================================================
-- FS AI — Migration 002: agents, accounts, analytics, monetization
-- Adds: owner_accounts, user_sessions, agent_permissions, agent_activity_logs,
--       automation_jobs, approval_records, website_analytics,
--       monetization_accounts, affiliate_links, revenue_records,
--       expense_records, security_events, newsletter_subscribers,
--       article_sources, keywords, research_records, digital_tools
-- (plus categories/articles support tables not covered by 001).
-- Apply after 001_initial.sql. Then run database/seed.sql.
-- Cloudflare D1 / SQLite.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT 'Fahad Somrat',
    role            TEXT NOT NULL DEFAULT 'SYSTEM_OWNER'
                    CHECK (role IN ('SYSTEM_OWNER', 'SUPER_ADMIN', 'ADMIN')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    totp_secret     TEXT,
    backup_codes    TEXT,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_owner_accounts_email ON owner_accounts(email);
CREATE INDEX IF NOT EXISTS idx_owner_accounts_role  ON owner_accounts(role);

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

CREATE TABLE IF NOT EXISTS agent_permissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    permission      TEXT NOT NULL,
    scope           TEXT,
    granted_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    granted_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (agent_id, permission, scope)
);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_agent ON agent_permissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_perm  ON agent_permissions(permission);

CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       INTEGER,
    details         TEXT,
    status          TEXT NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success', 'failed', 'skipped')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent   ON agent_activity_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_action  ON agent_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_agent_activity_created ON agent_activity_logs(created_at);

CREATE TABLE IF NOT EXISTS automation_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    job_type        TEXT NOT NULL,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    payload         TEXT,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    scheduled_at    TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    result          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status ON automation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_agent  ON automation_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_type   ON automation_jobs(job_type);

CREATE TABLE IF NOT EXISTS approval_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS website_analytics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_date   TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'none'
                    CHECK (source IN ('none', 'google_analytics', 'cloudflare', 'manual')),
    page_views      INTEGER,
    unique_visitors INTEGER,
    clicks          INTEGER,
    top_page        TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (recorded_date, source)
);
CREATE INDEX IF NOT EXISTS idx_analytics_date   ON website_analytics(recorded_date);
CREATE INDEX IF NOT EXISTS idx_analytics_source ON website_analytics(source);

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

CREATE TABLE IF NOT EXISTS keywords (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword         TEXT NOT NULL,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    article_id      INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    search_volume   INTEGER,
    difficulty      TEXT CHECK (difficulty IN ('low', 'medium', 'high')),
    target_rank     INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (keyword, division_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword  ON keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_keywords_division ON keywords(division_id);
CREATE INDEX IF NOT EXISTS idx_keywords_article  ON keywords(article_id);

CREATE TABLE IF NOT EXISTS research_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id     INTEGER NOT NULL REFERENCES business_divisions(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    summary         TEXT,
    findings        TEXT,
    sources         TEXT,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'collected'
                    CHECK (status IN ('collected', 'verified', 'used', 'discarded')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_division ON research_records(division_id);
CREATE INDEX IF NOT EXISTS idx_research_agent    ON research_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_research_status   ON research_records(status);

CREATE TABLE IF NOT EXISTS digital_tools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    description     TEXT,
    tool_type       TEXT NOT NULL DEFAULT 'calculator'
                    CHECK (tool_type IN ('calculator', 'converter', 'generator', 'checker')),
    formula         TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_digital_tools_slug   ON digital_tools(slug);
CREATE INDEX IF NOT EXISTS idx_digital_tools_division ON digital_tools(division_id);

CREATE TABLE IF NOT EXISTS monetization_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS revenue_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER REFERENCES monetization_accounts(id) ON DELETE SET NULL,
    source          TEXT NOT NULL,
    amount          NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    recorded_date   TEXT NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revenue_account ON revenue_records(account_id);
CREATE INDEX IF NOT EXISTS idx_revenue_date    ON revenue_records(recorded_date);
CREATE INDEX IF NOT EXISTS idx_revenue_source  ON revenue_records(source);

CREATE TABLE IF NOT EXISTS expense_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT NOT NULL,
    description     TEXT,
    amount          NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    recorded_date   TEXT NOT NULL,
    approved_by     INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_date     ON expense_records(recorded_date);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense_records(category);

CREATE TABLE IF NOT EXISTS security_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT NOT NULL,
    owner_id        INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    agent_id        INTEGER REFERENCES ai_agents(id) ON DELETE SET NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    details         TEXT,
    severity        TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info', 'warning', 'critical')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_type     ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_owner    ON security_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_security_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_created  ON security_events(created_at);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
    subscribed_at   TEXT,
    unsubscribed_at TEXT,
    source          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_newsletter_email  ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status);
