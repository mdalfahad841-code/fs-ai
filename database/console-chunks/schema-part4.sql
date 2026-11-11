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
