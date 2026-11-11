

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

CREATE TABLE IF NOT EXISTS website_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key     TEXT NOT NULL UNIQUE,
    setting_value   TEXT NOT NULL DEFAULT '',
    description     TEXT,
    updated_by      INTEGER REFERENCES owner_accounts(id) ON DELETE SET NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_website_settings_key ON website_settings(setting_key);

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
