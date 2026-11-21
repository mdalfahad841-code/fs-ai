-- FS AI migration 026 - daily publication reservations (Workstream A, 2026-11-21).
--
-- daily_publication_reservations is the atomic reservation behind the
-- daily publishing limit (backend/agents/autonomy/publishing.js
-- reserveDailyPublicationSlot). The old code checked the limit with a
-- read (count published today) and published with a separate write —
-- two concurrent auto-publish calls could both read 0 and both publish
-- inside one Dhaka day (TOCTOU). A reservation is claimed with ONE
-- atomic statement:
--   INSERT INTO daily_publication_reservations (dhaka_day, article_id, status, reserved_at)
--   SELECT ?, ?, 'reserved', ?
--   WHERE (SELECT COUNT(*) FROM daily_publication_reservations
--          WHERE dhaka_day = ? AND status IN ('reserved','consumed')) < ?
-- SQLite/D1 executes that statement atomically, so concurrent claims
-- serialise: only max_articles_per_day reservations can exist per
-- Dhaka day, and a second claimant inserts 0 rows.
--
-- Lifecycle (all in publishing.js):
--   reserved  — slot held while the publish flip + sitemap + log run.
--   consumed  — the publish succeeded; the slot is spent for the day.
--   released  — the publish failed or was rolled back; the slot is
--               free again, so a failed publication never consumes
--               the daily limit and a retry can reserve again.
-- A released row is never reused for a new reservation: the count query
-- only counts 'reserved'/'consumed', and (dhaka_day, article_id) is
-- UNIQUE, so one article holds at most one row per day. Rows are
-- append-only history (never DELETE them — a released row is the proof
-- a failed publish did not consume the limit).
--
-- Pre-026 fallback: when this table does not exist yet, publishing.js
-- enforces the same limit with an atomic conditional UPDATE on the
-- articles row itself (the published-today count is a predicate inside
-- the UPDATE, not a separate read), so the limit still holds on a
-- database without this migration — the reservation table adds the
-- explicit audit trail, not the atomicity.
--
-- dhaka_day is the owner's calendar day in Asia/Dhaka (YYYY-MM-DD),
-- computed in JS as the UTC date +6h — the same day boundary as
-- DHAKA_DAY_START_SQL in backend/publishing/gate.js.
--
-- Safe: additive table only. No existing data is changed.
-- Rollback: leave the table (inert — the guarded-UPDATE fallback
-- enforces the limit without it).
CREATE TABLE IF NOT EXISTS daily_publication_reservations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dhaka_day    TEXT NOT NULL,
    article_id   INTEGER NOT NULL REFERENCES articles(id),
    status       TEXT NOT NULL DEFAULT 'reserved'
                 CHECK (status IN ('reserved', 'consumed', 'released')),
    reserved_at  TEXT NOT NULL DEFAULT (datetime('now')),
    released_at  TEXT,
    UNIQUE (dhaka_day, article_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_pub_res_day ON daily_publication_reservations(dhaka_day, status);
