CREATE TABLE IF NOT EXISTS research_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id INTEGER NOT NULL REFERENCES business_divisions(id),
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL DEFAULT 'rss' CHECK (source_type IN ('rss', 'atom', 'other')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_fetched_at TEXT,
    last_status TEXT,
    last_error TEXT,
    items_discovered INTEGER NOT NULL DEFAULT 0,
    duplicates_found INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_sources_division ON research_sources(division_id, is_active);
CREATE INDEX IF NOT EXISTS idx_research_sources_url ON research_sources(url);
CREATE TABLE IF NOT EXISTS research_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER REFERENCES research_sources(id),
    division_id INTEGER NOT NULL REFERENCES business_divisions(id),
    title TEXT NOT NULL,
    url TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    summary TEXT,
    evidence_text TEXT,
    is_outdated INTEGER NOT NULL DEFAULT 0 CHECK (is_outdated IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_items_division ON research_items(division_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_research_items_source ON research_items(source_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_research_items_url ON research_items(url);
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Electrek', 'https://electrek.co/feed/', 'rss' FROM business_divisions WHERE slug = 'automotive';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'InsideEVs', 'https://insideevs.com/feed/', 'rss' FROM business_divisions WHERE slug = 'automotive';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The Verge - Transportation', 'https://www.theverge.com/rss/transportation/index.xml', 'atom' FROM business_divisions WHERE slug = 'automotive';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Google AI Blog', 'https://blog.google/technology/ai/rss/', 'rss' FROM business_divisions WHERE slug = 'ai-technology';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'OpenAI News', 'https://openai.com/news/rss.xml', 'rss' FROM business_divisions WHERE slug = 'ai-technology';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'MIT Technology Review', 'https://www.technologyreview.com/feed/', 'rss' FROM business_divisions WHERE slug = 'ai-technology';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The Verge', 'https://www.theverge.com/rss/index.xml', 'atom' FROM business_divisions WHERE slug = 'gadgets-electronics';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Engadget', 'https://www.engadget.com/rss.xml', 'rss' FROM business_divisions WHERE slug = 'gadgets-electronics';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'WIRED', 'https://www.wired.com/feed/rss', 'rss' FROM business_divisions WHERE slug = 'gadgets-electronics';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'BBC News - Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'rss' FROM business_divisions WHERE slug = 'finance-money';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The Economist - Finance & Economics', 'https://www.economist.com/finance-and-economics/rss.xml', 'rss' FROM business_divisions WHERE slug = 'finance-money';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'NerdWallet', 'https://www.nerdwallet.com/blog/feed/', 'rss' FROM business_divisions WHERE slug = 'finance-money';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Conde Nast Traveler', 'https://www.cntraveler.com/feed/rss', 'rss' FROM business_divisions WHERE slug = 'travel-lifestyle';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The Guardian - Travel', 'https://www.theguardian.com/travel/rss', 'rss' FROM business_divisions WHERE slug = 'travel-lifestyle';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Skift', 'https://www.skift.com/feed/', 'rss' FROM business_divisions WHERE slug = 'travel-lifestyle';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'MDN Blog', 'https://developer.mozilla.org/en-US/blog/rss.xml', 'rss' FROM business_divisions WHERE slug = 'digital-tools';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The GitHub Blog', 'https://github.blog/feed/', 'rss' FROM business_divisions WHERE slug = 'digital-tools';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Stack Overflow Blog', 'https://stackoverflow.blog/feed/', 'rss' FROM business_divisions WHERE slug = 'digital-tools';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'BBC News - Health', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'rss' FROM business_divisions WHERE slug = 'health-wellness';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Medical Xpress', 'https://www.medicalxpress.com/rss-feed/', 'rss' FROM business_divisions WHERE slug = 'health-wellness';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'The Guardian - Health', 'https://www.theguardian.com/society/health/rss', 'rss' FROM business_divisions WHERE slug = 'health-wellness';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'EdSurge', 'https://www.edsurge.com/feed', 'rss' FROM business_divisions WHERE slug = 'education-learning';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Inside Higher Ed', 'https://www.insidehighered.com/rss.xml', 'rss' FROM business_divisions WHERE slug = 'education-learning';
INSERT OR IGNORE INTO research_sources (division_id, name, url, source_type) SELECT id, 'Higher Ed Dive', 'https://www.educationdive.com/feeds/news/', 'rss' FROM business_divisions WHERE slug = 'education-learning';
