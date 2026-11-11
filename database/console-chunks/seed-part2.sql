
-- ---------------------------------------------------------------------------
-- Agent permissions — explicit boundaries. No agent exceeds these.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_permissions (agent_id, permission, scope) VALUES
(1, 'jobs.create', 'all'), (1, 'jobs.read', 'all'), (1, 'agents.read', 'all'),
(1, 'approvals.request', 'all'),
(2, 'research.create', 'automotive'), (2, 'research.read', 'automotive'),
(2, 'articles.draft', 'automotive'),
(3, 'research.create', 'ai-technology'), (3, 'research.read', 'ai-technology'),
(3, 'articles.draft', 'ai-technology'),
(4, 'research.create', 'gadgets-electronics'), (4, 'research.read', 'gadgets-electronics'),
(4, 'articles.draft', 'gadgets-electronics'),
(5, 'research.create', 'finance-money'), (5, 'research.read', 'finance-money'),
(5, 'articles.draft', 'finance-money'),
(6, 'research.create', 'travel-lifestyle'), (6, 'research.read', 'travel-lifestyle'),
(6, 'articles.draft', 'travel-lifestyle'),
(7, 'tools.create', 'digital-tools'), (7, 'tools.read', 'digital-tools'),
(7, 'tools.update', 'digital-tools'),
(8, 'research.create', 'health-wellness'), (8, 'research.read', 'health-wellness'),
(8, 'articles.draft', 'health-wellness'),
(9, 'research.create', 'education-learning'), (9, 'research.read', 'education-learning'),
(9, 'articles.draft', 'education-learning'),
(10, 'articles.read', 'all'), (10, 'seo.audit', 'all'), (10, 'keywords.read', 'all'),
(11, 'articles.draft', 'all'), (11, 'articles.read', 'all'),
(12, 'articles.read', 'all'), (12, 'fact_check.verify', 'all'),
(13, 'articles.read', 'all'), (13, 'approvals.request', 'all'),
(14, 'analytics.read', 'all'),
(15, 'monetization.read', 'all'), (15, 'revenue.read', 'all'),
(16, 'security.read', 'all'), (16, 'security.log', 'all');

-- ---------------------------------------------------------------------------
-- 25 articles — exact titles, real slugs, real excerpts and opening bodies.
-- status 'published', fact_checked 1: this is the live article list.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(1, 1, 3, 'EV Charging at Home: A Complete Beginner''s Guide',
 'ev-charging-at-home-complete-beginners-guide',
 'Everything a first-time EV owner needs to know about charging at home.',
 'Charging an electric vehicle at home is usually the cheapest and most convenient option. Most owners use a standard home charger overnight, which is enough for a typical daily drive. This guide covers charger types, installation basics, charging speeds and running costs, so you can decide what your home actually needs before you spend anything.',
 'FS AI', 'published', 1, 6);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(2, 1, 1, 'Car Maintenance Checklist: 12 Things to Check Every Month',
 'car-maintenance-checklist-12-things-every-month',
 'Twelve simple monthly checks that prevent expensive repairs.',
 'A few minutes once a month can save you a large repair bill. This checklist walks through the twelve things worth checking on any car: engine oil, coolant, tyre pressure and tread, lights, brakes, battery, wiper blades, belts, hoses, air filter and fluid levels. Each check is explained in plain language, with what "good" looks like and when to visit a mechanic.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(3, 1, 2, 'Hybrid vs Petrol: Which Saves You More in 2026?',
 'hybrid-vs-petrol-which-saves-more-2026',
 'A practical cost comparison for buyers deciding in 2026.',
 'Hybrids usually win on fuel in slow city traffic, while petrol cars can be cheaper to buy and simpler to maintain. The real answer depends on how far you drive, where you drive, and how long you keep the car. This guide compares purchase price, fuel use, servicing and resale value side by side, with a simple calculation you can repeat using your own numbers.',
 'FS AI', 'published', 1, 7);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(4, 1, 2, 'Motorcycle Buying Guide: How to Choose Your First Bike',
 'motorcycle-buying-guide-choose-first-bike',
 'Engine size, riding position, budget and safety — in one place.',
 'Your first motorcycle should fit your body, your budget and the way you will actually ride. This guide explains engine sizes for beginners, the difference between commuter, cruiser and sport riding positions, what safety gear is non-negotiable, and the running costs new riders forget: insurance, servicing, tyres and protective clothing.',
 'FS AI', 'published', 1, 6);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(5, 1, 1, 'How to Read Your Car''s Warning Lights',
 'how-to-read-car-warning-lights',
 'What each dashboard light means — and which ones mean stop now.',
 'Dashboard warning lights are your car asking for help, and some are more urgent than others. This guide explains the common lights — engine, oil pressure, battery, brakes, temperature, tyre pressure and airbag — what each one means, whether it is safe to keep driving, and what to check first before calling a mechanic.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(6, 1, 1, 'Fuel Economy: 15 Proven Ways to Save Fuel',
 'fuel-economy-15-proven-ways-save-fuel',
 'Fifteen habits and checks that cut fuel use without any new parts.',
 'You do not need a new car to spend less on fuel. Smooth acceleration, correct tyre pressure, removing roof racks and extra weight, servicing on time, and planning routes all add up. This guide lists fifteen proven ways to save fuel, starting with the ones that cost nothing and make the biggest difference first.',
 'FS AI', 'published', 1, 6);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(7, 1, 3, 'ADAS Explained: How Driver Assistance Really Works',
 'adas-explained-driver-assistance',
 'Automatic braking, lane keeping and cruise control — without the jargon.',
 'ADAS — Advanced Driver Assistance Systems — is the set of features that help a driver avoid crashes: automatic emergency braking, lane-keeping assistance, blind-spot warnings and adaptive cruise control. This guide explains what each system actually does, what it cannot do, and why the driver is still always responsible.',
 'FS AI', 'published', 1, 6);
