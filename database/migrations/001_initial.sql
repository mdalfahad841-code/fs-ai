-- ============================================================================
-- FS AI — Migration 001: initial core tables
-- Creates: business_divisions, categories, articles, article_tags,
--          ai_agents, website_settings
-- Apply before 002_agents_accounts.sql. Then run database/seed.sql.
-- Cloudflare D1 / SQLite.
-- ============================================================================

PRAGMA foreign_keys = ON;

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
    created_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_division ON articles(division_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_slug     ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status   ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);

CREATE TABLE IF NOT EXISTS article_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (article_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag     ON article_tags(tag);

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

CREATE TABLE IF NOT EXISTS website_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key     TEXT NOT NULL UNIQUE,
    setting_value   TEXT NOT NULL DEFAULT '',
    description     TEXT,
    updated_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_website_settings_key ON website_settings(setting_key);
