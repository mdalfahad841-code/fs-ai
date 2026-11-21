-- FS AI migration 024 - cross-draft duplicate fingerprints (Workstream A, 2026-11-21).
--
-- article_fingerprints records, for every article the SEO agent has
-- checked, a normalised content fingerprint plus the closest
-- near-duplicate found at that check — so a duplicate decision is
-- auditable instead of vanishing into a checks_json detail string.
--
-- Columns:
--   article_id            — the checked article (PRIMARY KEY: one live row per article).
--   fingerprint           — SHA-256 of the normalised body (same normalisation
--                           as fact_checks.body_hash — backend/utils/bodyHash.js).
--                           Two articles with the same fingerprint have
--                           identical wording after formatting-only
--                           differences are normalised away: an exact duplicate.
--   body_length / word_count / shingle_count
--                         — size of the body as checked.
--   closest_article_id / closest_status / closest_overlap_pct / closest_jaccard_pct
--                         — the nearest other article found by the cross-draft
--                           check (5-word shingle overlap + word-set Jaccard),
--                           with its status ('published' or 'draft') so a
--                           reader can tell a published duplicate from a
--                           draft collision. NULL when no other article exists.
--   decision              — 'ok' | 'near-duplicate' | 'duplicate', the decision
--                           the check recorded. 'duplicate' (shingle overlap
--                           >= 50% or Jaccard >= 90%) fails the SEO duplicate
--                           check; 'near-duplicate' (>= 25% / >= 70%) is
--                           needs-review; anything below is 'ok'.
--   checked_at            — when the fingerprint was last computed.
--
-- Writers degrade gracefully when this table does not exist yet
-- (backend/agents/autonomy/seo.js storeArticleFingerprint catches the
-- missing-table error and skips the write — the SEO verdict itself
-- never depends on this table). Readers must treat a missing row as
-- "not fingerprinted", never as "no duplicate".
--
-- Safe: additive table only. No existing data is changed.
-- Rollback: leave the table (inert — writers skip it when absent).
CREATE TABLE IF NOT EXISTS article_fingerprints (
    article_id            INTEGER PRIMARY KEY REFERENCES articles(id),
    fingerprint           TEXT NOT NULL,
    body_length           INTEGER NOT NULL DEFAULT 0,
    word_count            INTEGER NOT NULL DEFAULT 0,
    shingle_count         INTEGER NOT NULL DEFAULT 0,
    closest_article_id    INTEGER,
    closest_status        TEXT,
    closest_overlap_pct   REAL,
    closest_jaccard_pct   REAL,
    decision              TEXT NOT NULL DEFAULT 'ok'
                          CHECK (decision IN ('ok', 'near-duplicate', 'duplicate')),
    checked_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_fingerprints_fingerprint ON article_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_article_fingerprints_decision ON article_fingerprints(decision, checked_at);
