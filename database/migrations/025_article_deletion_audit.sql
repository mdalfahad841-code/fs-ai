-- FS AI migration 025 - article deletion audit (Workstream A, 2026-11-21).
--
-- article_deletion_audit is the audit trail the dashboard Delete button
-- never had: the live deleteArticle() in backend/routes/admin-articles.js
-- deletes the articles row with no record of who deleted what, when, or
-- why (the 8 failed Delete attempts on 2026-11-20 left no trace at all).
-- This table exists so the backend Delete patch proposed in
-- docs/FS-AI-COMPLETION-WS-A-NOTES-2026-11-21.md (Workstream A, item G)
-- can write one row per deletion BEFORE deleting the article row.
-- Nothing in the current code writes to this table yet: it is
-- write-once audit storage for the patched endpoint, never read by the
-- publish path, and it must never be deleted or trimmed (a deletion
-- audit that can be erased is not an audit).
--
-- Columns:
--   article_id / title / slug / status_at_delete
--                         — what was deleted (the article row itself is
--                           gone afterwards, so the audit row keeps the
--                           identifying facts).
--   deleted_by            — owner email from the session (auth.owner).
--   reason                — owner-supplied or system reason text.
--   body_length           — length of the deleted body (lets a later
--                           review tell a real article from a scaffold).
--   revisions_kept        — article_revisions rows retained for the id.
--   created_at            — deletion time (UTC, datetime('now')).
--
-- Safe: additive table only. No existing data is changed.
-- Rollback: leave the table (inert — nothing reads it yet).
CREATE TABLE IF NOT EXISTS article_deletion_audit (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id        INTEGER NOT NULL,
    title             TEXT NOT NULL DEFAULT '',
    slug              TEXT NOT NULL DEFAULT '',
    status_at_delete  TEXT NOT NULL DEFAULT '',
    deleted_by        TEXT,
    reason            TEXT,
    body_length       INTEGER NOT NULL DEFAULT 0,
    revisions_kept    INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_deletion_audit_article ON article_deletion_audit(article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_article_deletion_audit_created ON article_deletion_audit(created_at);
