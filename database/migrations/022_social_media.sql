-- FS AI migration 022 - social media management system (W4, 2026-11-21).
--
-- NOTE on numbering: the highest migration in this tree at the time of
-- writing is 019. Numbers 020/021 are reserved for parallel workstreams;
-- this file is 022 as assigned, and it is self-contained (no dependency
-- on 020/021). Apply after 019; if 020/021 land first, order does not
-- matter — every statement below is CREATE TABLE IF NOT EXISTS / index
-- creation and touches no existing table.
--
-- Three tables, all additive. No existing data is changed.
--
-- social_accounts — one row per connected platform account. Tokens are
-- NEVER stored in plain text: access_token_enc / refresh_token_enc hold
-- AES-256-GCM ciphertext (backend/social/tokens.js, key from the
-- SOCIAL_TOKEN_SECRET Worker secret). A row with status 'not_connected'
-- means "no OAuth has ever completed for this platform" — the framework
-- must never report such a platform as operational. Token expiry is
-- enforced by the dispatcher before every post; an expired/revoked
-- token puts the account in 'expired'/'revoked' and the post in
-- WAITING_FOR_AUTHORIZATION — never a silent retry, never a fake post.
--
-- social_posts — one row per article x platform distribution. The
-- idempotency_key (article_id + platform) is UNIQUE: the same article
-- may not be posted twice to the same platform unless the owner forces
-- it (force flag, owner route only). status values:
--   draft | scheduled | publishing | published | failed | blocked |
--   waiting_authorization | rate_limited | unverified
-- 'published' is written ONLY after the adapter verified the post back
-- from the platform (GET the post by its platform id). 'unverified'
-- means the platform accepted the create call but the verify-back read
-- did not find the post — the framework never claims publication then.
-- Engagement is NEVER stored here; it lives in social_analytics and
-- only from real platform responses.
--
-- social_analytics — engagement metrics exactly as returned by a
-- platform's own API (metric name + numeric value + source timestamp).
-- No rows = "Data unavailable" in reports, never an estimate or a 0
-- presented as measured.
CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  account_name TEXT,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected', 'connected', 'expired', 'revoked', 'error')),
  scopes TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, account_id)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'blocked', 'waiting_authorization', 'rate_limited', 'unverified')),
  platform_post_id TEXT,
  platform_url TEXT,
  caption TEXT,
  media_url TEXT,
  scheduled_for TEXT,
  published_at TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS social_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  social_post_id INTEGER NOT NULL REFERENCES social_posts (id),
  platform TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_social_posts_article_platform
  ON social_posts (article_id, platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_status_scheduled
  ON social_posts (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform_published
  ON social_posts (platform, published_at);
CREATE INDEX IF NOT EXISTS idx_social_analytics_post
  ON social_analytics (social_post_id, metric);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform
  ON social_accounts (platform, status);
