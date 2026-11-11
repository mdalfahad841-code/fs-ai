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
