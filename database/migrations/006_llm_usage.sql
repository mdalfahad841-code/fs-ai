CREATE TABLE IF NOT EXISTS llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','quota-exhausted','error','not-configured')),
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    neurons INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider_created ON llm_usage(provider, created_at);
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('llm_provider_order', 'workers-ai,groq,gemini');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('llm_daily_cap_neurons', '9000');
