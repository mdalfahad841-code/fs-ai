-- ============================================================================
-- FS AI — FAHAD SOMRAT AI — seed data
-- Apply AFTER database/schema.sql (or migrations 001 + 002).
-- Idempotent-ish: INSERT OR IGNORE / OR REPLACE on unique keys where safe.
--
-- HONESTY RULES (do not change):
--   * Revenue seed is $0.00 — no earnings have been made.
--   * Analytics seed is "Data unavailable" with NULL metrics — no fake rows.
--   * Only GitHub, YouTube and Pinterest are recorded as opened accounts.
--     Facebook, WhatsApp Business, Business Email, Search Console, Analytics,
--     AdSense and Affiliate are PENDING until the owner verifies them.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Website settings
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES
('site_name', 'FS AI', 'Public brand name'),
('site_full_name', 'FAHAD SOMRAT AI', 'Full brand name'),
('tagline', 'One Platform. Multiple Possibilities.', 'Brand tagline'),
('hero_text', 'EXPLORE MORE. KNOW MORE. DO MORE.', 'Homepage hero line'),
('owner_name', 'Fahad Somrat', 'Founder, owner and administrator'),
('total_revenue_usd', '0.00', 'Honest lifetime revenue: $0.00'),
('traffic_status', 'Data unavailable', 'Honest traffic status: no analytics account connected yet'),
('currency', 'USD', 'Reporting currency');

-- ---------------------------------------------------------------------------
-- Owner account — PLACEHOLDER ONLY.
-- password_hash MUST be replaced with a real bcrypt hash (cost 10) via the
-- secure setup flow before anyone can log in. This value is not a password.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO owner_accounts (email, password_hash, display_name, role, is_active)
VALUES ('owner@example.com', 'SET_VIA_SECURE_SETUP_DO_NOT_USE', 'Fahad Somrat', 'SYSTEM_OWNER', 1);

-- ---------------------------------------------------------------------------
-- 8 business divisions
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO business_divisions (id, name, slug, tagline, description, sort_order) VALUES
(1, 'Automotive', 'automotive', 'Cars, bikes and EVs, explained simply.',
 'Buying guides, maintenance checklists, EV and fuel-saving advice.', 1),
(2, 'AI & Technology', 'ai-technology', 'AI in plain English.',
 'What AI is, free AI tools that save time, and practical technology guides.', 2),
(3, 'Gadgets & Electronics', 'gadgets-electronics', 'Choose the right device.',
 'Smartphone, laptop and tablet buying guides and comparisons.', 3),
(4, 'Finance & Money', 'finance-money', 'Money, explained simply.',
 'Budgeting, saving on a small income, loans and interest in plain language.', 4),
(5, 'Travel & Lifestyle', 'travel-lifestyle', 'Travel more, spend less.',
 'Budget trip planning, road-trip checklists and cost guides.', 5),
(6, 'Digital Tools', 'digital-tools', 'Free tools, no sign-up.',
 'Converters and calculators you can use today, free of charge.', 6),
(7, 'Health & Wellness', 'health-wellness', 'Small steps, real health.',
 'Walking, home workouts and beginner fitness guides.', 7),
(8, 'Education & Learning', 'education-learning', 'Learn a new skill.',
 'Practical guides for learning digital skills in 30 days and more.', 8);

-- ---------------------------------------------------------------------------
-- Categories (one or two per division to start)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO categories (id, division_id, name, slug, sort_order) VALUES
(1, 1, 'Car Maintenance', 'car-maintenance', 1),
(2, 1, 'Buying Guides', 'buying-guides', 2),
(3, 1, 'Electric Vehicles', 'electric-vehicles', 3),
(4, 2, 'AI Basics', 'ai-basics', 1),
(5, 2, 'Free AI Tools', 'free-ai-tools', 2),
(6, 3, 'Smartphones', 'smartphones', 1),
(7, 3, 'Laptops & Tablets', 'laptops-tablets', 2),
(8, 4, 'Budgeting', 'budgeting', 1),
(9, 4, 'Loans & Interest', 'loans-interest', 2),
(10, 5, 'Budget Travel', 'budget-travel', 1),
(11, 5, 'Road Trips', 'road-trips', 2),
(12, 6, 'Calculators', 'calculators', 1),
(13, 6, 'Converters', 'converters', 2),
(14, 7, 'Fitness', 'fitness', 1),
(15, 8, 'Digital Skills', 'digital-skills', 1);

-- ---------------------------------------------------------------------------
-- 16 AI agents — Central Business Manager + 15 specialists.
-- can_publish = 0 for ALL agents: nothing publishes without owner approval.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO ai_agents (id, name, slug, role, division_id, description, is_active, can_publish) VALUES
(1, 'Business Manager', 'business-manager', 'manager', NULL,
 'Central Business Manager: coordinates all agents, queues jobs, requests owner approval.', 1, 0),
(2, 'Automotive Research', 'automotive-research', 'research', 1,
 'Researches automotive topics: EVs, maintenance, buying guides.', 1, 0),
(3, 'Technology Research', 'technology-research', 'research', 2,
 'Researches AI and technology topics in plain language.', 1, 0),
(4, 'Gadget Research', 'gadget-research', 'research', 3,
 'Researches gadgets and electronics: phones, laptops, tablets.', 1, 0),
(5, 'Finance Research', 'finance-research', 'research', 4,
 'Researches finance topics: budgeting, saving, loans, interest.', 1, 0),
(6, 'Travel Research', 'travel-research', 'research', 5,
 'Researches travel and lifestyle topics: budget trips, road trips.', 1, 0),
(7, 'Digital Tools', 'digital-tools-agent', 'tools', 6,
 'Builds and maintains the free calculator and converter tools.', 1, 0),
(8, 'Health Research', 'health-research', 'research', 7,
 'Researches health and wellness topics: fitness, walking, workouts.', 1, 0),
(9, 'Education Research', 'education-research', 'research', 8,
 'Researches education topics: digital skills and learning guides.', 1, 0),
(10, 'SEO', 'seo', 'seo', NULL,
 'SEO agent: keywords, titles, descriptions and on-page checks.', 1, 0),
(11, 'Content Creation', 'content-creation', 'content', NULL,
 'Drafts articles from verified research; never publishes on its own.', 1, 0),
(12, 'Fact Checking', 'fact-checking', 'fact_check', NULL,
 'Verifies every claim against sources before an article can be approved.', 1, 0),
(13, 'Publishing', 'publishing', 'publishing', NULL,
 'Prepares approved articles for publication; publishes only after owner approval.', 1, 0),
(14, 'Analytics', 'analytics', 'analytics', NULL,
 'Reads connected analytics only; reports "Data unavailable" when nothing is connected.', 1, 0),
(15, 'Monetization', 'monetization', 'monetization', NULL,
 'Tracks ad and affiliate accounts and the honest $0.00 revenue ledger.', 1, 0),
(16, 'Security', 'security', 'security', NULL,
 'Security & Monitoring: login attempts, sessions and security events.', 1, 0);
