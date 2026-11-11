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
