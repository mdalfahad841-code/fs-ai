ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
UPDATE articles SET is_protected = 1 WHERE id IN (26, 27);
