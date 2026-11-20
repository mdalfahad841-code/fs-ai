-- FS AI migration 013 - database-backed article protection
-- Adds articles.is_protected and flags the two protected test articles
-- (#26, #27) whose content must never be overwritten by automatic runs.
-- Additive column + data flag only: no article content, excerpt, SEO
-- field, source or correction row is changed. The constant fallback in
-- backend/publishing/protection.js still protects #26/#27 if this
-- migration has not been applied yet.
-- Idempotency (honest): SQLite ADD COLUMN fails if re-run on a DB that
-- already has the column ("duplicate column name"). Apply once via the
-- console chunk (one statement at a time, parent applies); the UPDATE
-- itself is safe to re-run. A fresh deploy from database/schema.sql
-- already includes the column, so 013 is only for the live D1 upgrade
-- path (same situation as migration 004 - see tests/autonomy-scheduler.test.js).

ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
UPDATE articles SET is_protected = 1 WHERE id IN (26, 27);
