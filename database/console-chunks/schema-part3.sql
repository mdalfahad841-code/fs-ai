CREATE INDEX IF NOT EXISTS idx_digital_tools_slug   ON digital_tools(slug);
CREATE INDEX IF NOT EXISTS idx_digital_tools_division ON digital_tools(division_id);

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
