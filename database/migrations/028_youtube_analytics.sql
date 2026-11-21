-- 028_youtube_analytics.sql — D1 mirror of the local YouTube analytics store
-- (work/youtube_analytics.db). FILE ONLY — never applied by Workstream D.
-- Created 2026-11-21 (Workstream D, FS AI final completion).
-- Purpose: record YouTube Studio performance per video at 1h/24h/48h/7d/28d
-- so future builds can compare against real data instead of repeating blind.
--
-- Rules (binding, mirror the local store):
-- * Unavailable metrics are stored as NULL, never zero.
-- * avg_view_duration_s that exceeds the video length is IMPOSSIBLE
--   (seen live: v4 15:07 vs 0:52, #03 14:05 vs 0:59, #04 12:02 vs 0:53).
--   Such rows carry anomaly_flag='avg_view_duration_exceeds_length' and
--   must be excluded from every optimisation query. Never use them.
-- * No decisions on tiny samples: stay-rate comparisons require >= 30 views.
-- * Live collection via the YouTube Analytics/Data APIs is BLOCKED until the
--   owner authorises OAuth and the consent screen leaves Testing; until then
--   rows are fed by manual Studio import only (source='studio-manual').
-- * This migration adds tables only. It touches no existing table and no
--   article/protected record. Safe to apply with the standard db:migrate flow.
--   Rollback: DROP TABLE youtube_performance; DROP TABLE youtube_videos;
--   DROP TABLE youtube_anomalies; (no other object depends on them).

CREATE TABLE IF NOT EXISTS youtube_videos (
  video_key TEXT PRIMARY KEY,
  youtube_id TEXT,
  kind TEXT NOT NULL,              -- 'short' | 'long'
  article_id INTEGER,
  title TEXT,
  duration_s REAL,
  published_at TEXT,
  cover_accent TEXT,
  cover_hook TEXT,
  hook_first_line TEXT
);

CREATE TABLE IF NOT EXISTS youtube_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_key TEXT NOT NULL REFERENCES youtube_videos(video_key),
  period TEXT NOT NULL,            -- '1h' | '24h' | '48h' | '7d' | '28d'
  observed_at TEXT NOT NULL,       -- ISO timestamp of the Studio reading
  views INTEGER,
  engaged_views INTEGER,
  shown_in_feed INTEGER,
  stayed_pct REAL,                 -- viewed vs swiped: % stayed
  avg_view_duration_s REAL,
  avg_pct_viewed REAL,
  watch_time_s REAL,
  subs_gained INTEGER,
  likes INTEGER,
  comments INTEGER,
  impressions INTEGER,
  ctr_pct REAL,
  traffic_json TEXT,               -- {"feed": 71.4, "search": 9.1, ...}
  restrictions TEXT,               -- NULL = unknown; 'none' = Studio shows none
  source TEXT NOT NULL DEFAULT 'studio-manual',
  anomaly_flag TEXT,               -- NULL or 'avg_view_duration_exceeds_length'
  UNIQUE(video_key, period, observed_at)
);

CREATE TABLE IF NOT EXISTS youtube_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  value_shown TEXT,
  reason TEXT,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yt_perf_video ON youtube_performance(video_key, period);
CREATE INDEX IF NOT EXISTS idx_yt_perf_observed ON youtube_performance(observed_at);
