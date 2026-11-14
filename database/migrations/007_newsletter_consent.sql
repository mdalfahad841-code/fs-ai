-- FS AI migration 007 - newsletter consent persistence
-- Apply after schema.sql and migrations 001 to 006
-- Newsletter subscribe requires consent === true, but the column did not
-- exist, so consent was enforced at intake and never stored. This adds
-- consent_given_at (ISO timestamp of the consent) to newsletter_subscribers.
-- Existing rows get NULL (consent time unknown for pre-migration rows).

ALTER TABLE newsletter_subscribers ADD COLUMN consent_given_at TEXT;
