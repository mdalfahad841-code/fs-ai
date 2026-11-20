-- FS AI migration 014 - RSS fetch audit log
-- One audit row per fetch execution per feed, so the exact cause of a
-- future double-fetch anomaly (cf. Phase 1 report section 4 / section 22
-- item 12: the 19 Nov digital-tools duplicates jump, 52 -> 152, whose
-- trigger could not be proven because no fetch audit log existed) can be
-- proven from real rows instead of inferred from counters.
-- Additive only: one new table + two indexes. No existing table, row or
-- counter is changed, and no history is backfilled -- fetches that ran
-- before this migration have no audit rows, by design (never synthesize
-- numbers for runs that were never recorded).
--
-- Column semantics (all counts are recorded at the real insert/dedupe
-- point in backend/rss/sources.js fetchSource, never recomputed):
--   items_discovered  = feed items that passed dedupe in this fetch
--                        (genuinely new items identified for insert).
--   items_inserted    = research_items rows actually written by this
--                        fetch. Normally equal to items_discovered; it
--                        is lower only when storing failed partway
--                        (status 'partial').
--   duplicates_skipped = feed items skipped as duplicates in this fetch.
-- Reconciliation: SUM(items_inserted) over 'completed'/'partial' rows
-- for a source == COUNT(research_items WHERE source_id = ?) ==
-- research_sources.items_discovered for that source (when no fetch
-- predates this migration).
--
-- Status values: 'running' while a fetch is in flight (ended_at NULL),
-- then exactly one terminal value: 'completed', 'failed' (the feed
-- fetch itself failed; nothing was stored), or 'partial' (the feed
-- fetched but storing threw partway). 'skipped-overlap' is recorded
-- when a second fetch for the same feed starts while one is already
-- running -- the second fetch never runs and never writes a
-- 'completed' row. 'running' and 'skipped-overlap' extend the three
-- terminal states in the fix spec because the overlap mechanism
-- itself needs them (a 'running' row is how a second isolate sees
-- that a fetch is in flight).
--
-- Uniqueness guard: UNIQUE (execution_id, source_id). One execution
-- (one run; a single id is generated per trigger and shared across
-- the feeds of that run) can never write two audit rows for the same
-- feed. Writers use INSERT OR IGNORE for the opening 'running' row:
-- if the insert is ignored, the row already exists for that
-- execution+feed and the caller must NOT finalise it (it does not own
-- the row). A duplicate raw INSERT is rejected by the constraint.
--
-- Overlap / staleness: a 'running' row whose started_at is older than
-- 10 minutes is treated as a crashed run, not a live one -- it never
-- blocks a later fetch and is never rewritten (it stays as evidence
-- of the crash). The live guard is the in-memory set in sources.js
-- plus this 'running' row, which is how a second Worker isolate
-- sees the in-flight fetch.

CREATE TABLE IF NOT EXISTS rss_fetch_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES research_sources(id),
    feed_url TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    execution_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'daily-workflow')),
    items_discovered INTEGER NOT NULL DEFAULT 0,
    items_inserted INTEGER NOT NULL DEFAULT 0,
    duplicates_skipped INTEGER NOT NULL DEFAULT 0,
    errors TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial', 'skipped-overlap')),
    UNIQUE (execution_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_source_started ON rss_fetch_audit(source_id, started_at);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_execution ON rss_fetch_audit(execution_id);
