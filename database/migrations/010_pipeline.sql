-- FS AI migration 010 - autonomous pipeline owner controls
-- Each auto_* switch defaults to 'off'. The live publishing mode stays
-- 'approved_only': auto_publishing='on' only arms the publish gate's
-- eligibility reporting — nothing publishes automatically while the
-- mode is approved_only. Flipping live publishing to automatic needs a
-- separate, explicit owner decision to change publishing_mode.

INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('auto_research', 'off');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('auto_generation', 'off');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('auto_factcheck', 'off');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('auto_correction', 'off');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('auto_publishing', 'off');
