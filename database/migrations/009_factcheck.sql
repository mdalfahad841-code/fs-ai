-- FS AI migration 009 - claim-level fact-checking, corrections, SEO checks
-- fact_checks is one verdict row per fact-check run on an article.
-- claim_checks holds one row per extracted claim with its verdict and
-- the evidence that supports it. A claim is VERIFIED only when a real
-- evidence quote from fetched source material backs it. No claim is
-- ever marked VERIFIED on a model's unsupported answer alone.
-- article_corrections records original vs corrected text per attempt
-- (max 3 attempts per claim). seo_checks stores one SEO suite result
-- per run as JSON.

CREATE TABLE IF NOT EXISTS fact_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'needs-review', 'failed')),
    claims_total INTEGER NOT NULL DEFAULT 0,
    claims_verified INTEGER NOT NULL DEFAULT 0,
    claims_failed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fact_checks_article ON fact_checks(article_id, created_at);

CREATE TABLE IF NOT EXISTS claim_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_check_id INTEGER NOT NULL REFERENCES fact_checks(id),
    claim_text TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('VERIFIED', 'INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE')),
    evidence_url TEXT,
    evidence_quote TEXT,
    explanation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claim_checks_factcheck ON claim_checks(fact_check_id);

CREATE TABLE IF NOT EXISTS article_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    claim_check_id INTEGER REFERENCES claim_checks(id),
    original_text TEXT NOT NULL,
    corrected_text TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed', 'removed')),
    recheck_verdict TEXT CHECK (recheck_verdict IN ('VERIFIED', 'INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_article ON article_corrections(article_id);

CREATE TABLE IF NOT EXISTS seo_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'needs-review', 'failed')),
    checks_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seo_checks_article ON seo_checks(article_id, created_at);
