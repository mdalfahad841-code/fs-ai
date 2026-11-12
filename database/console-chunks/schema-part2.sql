CREATE INDEX IF NOT EXISTS idx_research_division ON research_records(division_id);
CREATE INDEX IF NOT EXISTS idx_research_agent    ON research_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_research_status   ON research_records(status);

CREATE TABLE IF NOT EXISTS ai_agents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL,     
    division_id     INTEGER REFERENCES business_divisions(id) ON DELETE SET NULL,
    description     TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    can_publish     INTEGER NOT NULL DEFAULT 0 CHECK (can_publish IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_agents_slug   ON ai_agents(slug);
CREATE INDEX IF NOT EXISTS idx_ai_agents_role   ON ai_agents(role);
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON ai_agents(is_active);

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
