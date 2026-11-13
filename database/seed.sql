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
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes, published_at) VALUES
(1, 1, 3, 'EV Charging at Home: A Complete Beginner''s Guide',
 'ev-charging-at-home-complete-beginners-guide',
 'Everything a first-time EV owner needs to know about charging at home.',
 'Charging an electric vehicle at home is usually the cheapest and most convenient option. Most owners use a standard home charger overnight, which is enough for a typical daily drive. This guide covers charger types, installation basics, charging speeds and running costs, so you can decide what your home actually needs before you spend anything.',
 'FS AI', 'published', 1, 6, '2026-11-01'),
(2, 1, 1, 'Car Maintenance Checklist: 12 Things to Check Every Month',
 'car-maintenance-checklist-12-things-every-month',
 'Twelve simple monthly checks that prevent expensive repairs.',
 'A few minutes once a month can save you a large repair bill. This checklist walks through the twelve things worth checking on any car: engine oil, coolant, tyre pressure and tread, lights, brakes, battery, wiper blades, belts, hoses, air filter and fluid levels. Each check is explained in plain language, with what "good" looks like and when to visit a mechanic.',
 'FS AI', 'published', 1, 5, '2026-11-01'),
(3, 1, 2, 'Hybrid vs Petrol: Which Saves You More in 2026?',
 'hybrid-vs-petrol-which-saves-more-2026',
 'A practical cost comparison for buyers deciding in 2026.',
 'Hybrids usually win on fuel in slow city traffic, while petrol cars can be cheaper to buy and simpler to maintain. The real answer depends on how far you drive, where you drive, and how long you keep the car. This guide compares purchase price, fuel use, servicing and resale value side by side, with a simple calculation you can repeat using your own numbers.',
 'FS AI', 'published', 1, 7, '2026-11-02'),
(4, 1, 2, 'Motorcycle Buying Guide: How to Choose Your First Bike',
 'motorcycle-buying-guide-choose-first-bike',
 'Engine size, riding position, budget and safety — in one place.',
 'Your first motorcycle should fit your body, your budget and the way you will actually ride. This guide explains engine sizes for beginners, the difference between commuter, cruiser and sport riding positions, what safety gear is non-negotiable, and the running costs new riders forget: insurance, servicing, tyres and protective clothing.',
 'FS AI', 'published', 1, 6, '2026-11-02'),
(5, 1, 1, 'How to Read Your Car''s Warning Lights',
 'how-to-read-car-warning-lights',
 'What each dashboard light means — and which ones mean stop now.',
 'Dashboard warning lights are your car asking for help, and some are more urgent than others. This guide explains the common lights — engine, oil pressure, battery, brakes, temperature, tyre pressure and airbag — what each one means, whether it is safe to keep driving, and what to check first before calling a mechanic.',
 'FS AI', 'published', 1, 5, '2026-11-03'),
(6, 1, 1, 'Fuel Economy: 15 Proven Ways to Save Fuel',
 'fuel-economy-15-proven-ways-save-fuel',
 'Fifteen habits and checks that cut fuel use without any new parts.',
 'You do not need a new car to spend less on fuel. Smooth acceleration, correct tyre pressure, removing roof racks and extra weight, servicing on time, and planning routes all add up. This guide lists fifteen proven ways to save fuel, starting with the ones that cost nothing and make the biggest difference first.',
 'FS AI', 'published', 1, 6, '2026-11-03'),
(7, 1, 3, 'ADAS Explained: How Driver Assistance Really Works',
 'adas-explained-driver-assistance',
 'Automatic braking, lane keeping and cruise control — without the jargon.',
 'ADAS — Advanced Driver Assistance Systems — is the set of features that help a driver avoid crashes: automatic emergency braking, lane-keeping assistance, blind-spot warnings and adaptive cruise control. This guide explains what each system actually does, what it cannot do, and why the driver is still always responsible.',
 'FS AI', 'published', 1, 6, '2026-11-04'),
(8, 1, 3, 'Electric Vehicle Range: What the Numbers Really Mean',
 'electric-vehicle-range-what-numbers-mean',
 'Why real-world range differs from the brochure number.',
 'An EV''s quoted range is measured in laboratory conditions, so real driving almost always gives less. Speed, cold weather, heating, hills and driving style all reduce range. This guide explains how range figures are tested, what to expect in everyday use, and how to estimate the range you will actually get from a car you are considering.',
 'FS AI', 'published', 1, 5, '2026-11-04'),
(9, 1, 1, 'How to Diagnose Common Engine Noises',
 'how-to-diagnose-common-engine-noises',
 'Knocks, squeals, rattles and hisses — what they usually mean.',
 'Engines make different sounds when something is wrong, and the sound itself is a useful clue. This guide describes the most common engine noises — knocking, squealing belts, rattling on start-up, hissing, and grinding — what each one usually points to, how urgent it is, and what information to give your mechanic.',
 'FS AI', 'published', 1, 6, '2026-11-05'),
(10, 1, 2, 'New vs Used Cars: A Practical Buying Guide',
 'new-vs-used-cars-practical-buying-guide',
 'Depreciation, warranty, history checks and total cost compared.',
 'A new car gives you a warranty and the latest safety features, but loses value fastest in its first years. A used car costs less up front but needs a careful history check. This guide compares the two honestly — purchase price, depreciation, warranty, insurance and inspection — and ends with a checklist to use before you pay for either.',
 'FS AI', 'published', 1, 7, '2026-11-05'),
(11, 1, 2, 'Car Safety Ratings Explained',
 'car-safety-ratings-explained',
 'What crash-test stars actually measure, and what they do not.',
 'Safety ratings look simple — a number of stars — but they measure several different things: adult protection, child protection, pedestrian protection and driver-assistance features. This guide explains how the main rating programmes test cars, how to read a rating properly, and why two cars with the same stars can still protect you differently.',
 'FS AI', 'published', 1, 5, '2026-11-06'),
(12, 1, 2, 'Best Family Cars Compared: Space, Safety and Running Costs',
 'best-family-cars-compared-space-safety-running-costs',
 'Compare family cars on the three things that matter most.',
 'Choosing a family car means balancing space for people and luggage, safety ratings, and what the car costs to run every month. This comparison explains how to judge each of the three — boot space and seating, crash-test results and safety features, fuel or charging costs, insurance and servicing — so you can shortlist cars that fit your family instead of a brochure.',
 'FS AI', 'published', 1, 7, '2026-11-06'),
(13, 2, 4, 'What Is AI? A Plain-English Guide for Beginners',
 'what-is-ai-plain-english-guide-beginners',
 'No maths, no jargon: what artificial intelligence actually is.',
 'Artificial intelligence is software that learns patterns from examples and uses them to make predictions or generate content — from chatbots to photo tools. This guide explains the idea in plain English: what machine learning means, where AI is already used in daily life, what it is good at, what it is bad at, and what to watch out for.',
 'FS AI', 'published', 1, 6, '2026-11-07'),
(14, 2, 5, '7 Free AI Tools That Actually Save Time',
 '7-free-ai-tools-that-actually-save-time',
 'Seven genuinely free AI tools, tested for real everyday tasks.',
 'Many "free" AI tools hide their useful features behind a paywall. This guide lists seven tools that are actually free to use for real tasks — writing help, summarising, image editing, transcription and research — with what each one does well, what its limits are, and when a paid alternative is genuinely unnecessary.',
 'FS AI', 'published', 1, 5, '2026-11-07'),
(15, 3, 6, 'Smartphone Buying Guide 2026: What Matters Most',
 'smartphone-buying-guide-2026-what-matters-most',
 'Processor, camera, battery, screen and updates — ranked by what matters.',
 'Phone makers advertise many numbers, but only a few decide whether a phone is good to live with. This 2026 guide ranks what matters most — software updates, battery life, camera quality in low light, screen quality and storage — and explains which specifications you can safely ignore when choosing.',
 'FS AI', 'published', 1, 6, '2026-11-08'),
(16, 3, 7, 'Laptop vs Tablet: Which One Should You Buy?',
 'laptop-vs-tablet-which-should-you-buy',
 'Work, study and entertainment compared, so you buy once.',
 'A laptop is better for typing, multitasking and heavy software; a tablet is lighter, simpler and often cheaper for reading, video and notes. This guide compares the two for work, study and entertainment, and gives a simple rule: if your main task needs a keyboard and several windows open at once, buy the laptop.',
 'FS AI', 'published', 1, 5, '2026-11-08'),
(17, 4, 8, 'Monthly Budgeting: The 50/30/20 Rule Explained',
 'monthly-budgeting-50-30-20-rule-explained',
 'Split your income into needs, wants and savings — with real numbers.',
 'The 50/30/20 rule is a simple way to budget: about 50% of your income for needs like rent and food, 30% for wants, and 20% for savings and paying off debt. This guide shows the rule with real example numbers, how to adjust it when your income is small, and what to do first if 50% does not cover your needs.',
 'FS AI', 'published', 1, 5, '2026-11-09'),
(18, 4, 8, 'How to Start Saving With a Small Income',
 'how-to-start-saving-with-small-income',
 'Saving is possible on a small income — start tiny and automate it.',
 'Saving feels impossible when money is tight, but the habit matters more than the amount. This guide shows how to start with a very small fixed amount, pay yourself first on payday, cut one recurring cost, build a small emergency fund before anything else, and grow the amount slowly as income rises.',
 'FS AI', 'published', 1, 5, '2026-11-09'),
(19, 5, 10, 'Travel on a Budget: Plan a Trip Without Overspending',
 'travel-on-a-budget-plan-trip-without-overspending',
 'Transport, stays, food and activities — planned before you spend.',
 'A good budget trip is planned before the money is spent, not after. This guide covers setting a total trip budget first, choosing cheaper travel dates, comparing stays, eating where locals eat, and keeping a daily spending limit — with a simple planning order that keeps a trip affordable without making it miserable.',
 'FS AI', 'published', 1, 6, '2026-11-10'),
(20, 6, 12, 'Free Digital Tools: Converters and Calculators You Can Use Today',
 'free-digital-tools-converters-calculators',
 'Twenty free tools on FS AI — no sign-up, no payment, no download.',
 'FS AI offers twenty free digital tools: fuel-cost, loan, savings, percentage and age calculators, unit and currency converters, BMI, tip, discount and compound-interest calculators, and more. This guide lists them all, explains what each one does, and shows how to get a correct answer in seconds with no sign-up and no payment.',
 'FS AI', 'published', 1, 4, '2026-11-10'),
(21, 7, 14, 'Walking for Health: A Beginner''s Fitness Guide',
 'walking-for-health-beginners-fitness-guide',
 'The simplest exercise there is — and how to start properly.',
 'Walking is one of the easiest and safest ways to get fitter: it needs no equipment, no gym and no experience. This beginner''s guide covers how much to walk, how to build up gradually, good walking posture, suitable shoes, and how to make walking a daily habit that actually lasts.',
 'FS AI', 'published', 1, 4, '2026-11-11'),
(22, 8, 15, 'How to Learn a New Digital Skill in 30 Days',
 'how-to-learn-new-digital-skill-in-30-days',
 'A realistic 30-day plan: one skill, daily practice, one finished project.',
 'Thirty days is enough to learn the basics of one digital skill — if you practise a little every day instead of studying in big bursts. This guide gives a realistic plan: pick one skill, learn the core concepts in week one, practise with small tasks in weeks two and three, and finish one real project in week four that proves what you learned.',
 'FS AI', 'published', 1, 5, '2026-11-11'),
(23, 7, 14, 'Home Workout Basics: No Equipment Needed',
 'home-workout-basics-no-equipment-needed',
 'A safe beginner routine using only your body weight.',
 'You do not need a gym or equipment to start exercising. This guide covers a safe beginner home routine — warm-up, bodyweight squats, push-ups, planks and stretching — how many sets and repetitions to start with, how to progress week by week, and the warning signs that mean you should stop and rest.',
 'FS AI', 'published', 1, 5, '2026-11-11'),
(24, 4, 9, 'Understanding Interest: Loans Explained Simply',
 'understanding-interest-loans-explained-simply',
 'Simple interest, compound interest and loan payments in plain language.',
 'Interest is the price of borrowing money — and understanding it is the difference between a loan you can afford and one you cannot. This guide explains simple and compound interest with worked examples, how a monthly loan payment is calculated, and why paying a little extra each month shortens a loan so much.',
 'FS AI', 'published', 1, 5, '2026-11-11'),
(25, 5, 11, 'How to Plan a Road Trip: Checklist and Costs',
 'how-to-plan-road-trip-checklist-costs',
 'Route, car check, budget and packing — one checklist for the whole trip.',
 'A good road trip is planned in four parts: the route and stops, a pre-trip car check, a realistic cost budget (fuel, tolls, food and stays), and a packing checklist. This guide gives you all four, including a fuel-cost estimate you can calculate before you leave so the trip never surprises your wallet.',
 'FS AI', 'published', 1, 6, '2026-11-11');

-- ---------------------------------------------------------------------------
-- Article tags (two per article)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES
(1, 'EV'), (1, 'home charging'),
(2, 'maintenance'), (2, 'checklist'),
(3, 'hybrid'), (3, 'fuel savings'),
(4, 'motorcycle'), (4, 'buying guide'),
(5, 'dashboard'), (5, 'warning lights'),
(6, 'fuel economy'), (6, 'saving money'),
(7, 'ADAS'), (7, 'driver assistance'),
(8, 'EV'), (8, 'range'),
(9, 'engine'), (9, 'diagnostics'),
(10, 'buying guide'), (10, 'new vs used'),
(11, 'safety'), (11, 'crash test'),
(12, 'family cars'), (12, 'comparison'),
(13, 'AI basics'), (13, 'beginners'),
(14, 'free AI tools'), (14, 'productivity'),
(15, 'smartphone'), (15, 'buying guide 2026'),
(16, 'laptop'), (16, 'tablet'),
(17, 'budgeting'), (17, '50/30/20'),
(18, 'saving'), (18, 'small income'),
(19, 'budget travel'), (19, 'trip planning'),
(20, 'free tools'), (20, 'calculators'),
(21, 'walking'), (21, 'fitness'),
(22, 'learning'), (22, 'digital skills'),
(23, 'home workout'), (23, 'no equipment'),
(24, 'interest'), (24, 'loans'),
(25, 'road trip'), (25, 'checklist');

-- ---------------------------------------------------------------------------
-- 20 free digital tools
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO digital_tools (id, name, slug, division_id, description, tool_type, formula) VALUES
(1, 'Fuel Cost Calculator', 'fuel-cost-calculator', 6,
 'Estimate fuel cost for a trip from distance, mileage and fuel price.', 'calculator',
 'cost = (distance / mileage) x fuel price'),
(2, 'Loan Payment Calculator', 'loan-payment-calculator', 6,
 'Monthly loan payment from principal, annual rate and term.', 'calculator',
 'M = P x r(1+r)^n / ((1+r)^n - 1)'),
(3, 'Savings Goal Calculator', 'savings-goal-calculator', 6,
 'Monthly saving needed to reach a goal by a target date.', 'calculator',
 'monthly = goal / months'),
(4, 'Percentage Calculator', 'percentage-calculator', 6,
 'Percent of a number, percent change and percentage points.', 'calculator',
 'part = total x percent / 100'),
(5, 'Age Calculator', 'age-calculator', 6,
 'Age in years, months and days from a date of birth.', 'calculator',
 'age = today - date of birth'),
(6, 'Unit Converter', 'unit-converter', 6,
 'Convert length, weight and temperature units.', 'converter',
 '1 km = 0.621371 miles; 1 kg = 2.20462 lb; F = C x 9/5 + 32'),
(7, 'BMI Calculator', 'bmi-calculator', 6,
 'Body mass index from weight and height.', 'calculator',
 'BMI = weight kg / (height m)^2'),
(8, 'Currency Converter', 'currency-converter', 6,
 'Convert between currencies using a free exchange-rate source at runtime.', 'converter',
 'converted = amount x rate (rate fetched live; none stored)'),
(9, 'Tip Calculator', 'tip-calculator', 6,
 'Tip amount and total bill, split per person.', 'calculator',
 'tip = bill x tip percent / 100'),
(10, 'Discount Calculator', 'discount-calculator', 6,
 'Sale price and amount saved from a discount percent.', 'calculator',
 'sale price = price x (1 - discount / 100)'),
(11, 'Compound Interest Calculator', 'compound-interest-calculator', 6,
 'Future value of savings with compound interest.', 'calculator',
 'A = P(1 + r/n)^(n x t)'),
(12, 'EMI Calculator', 'emi-calculator', 6,
 'Equated monthly instalment for a loan.', 'calculator',
 'EMI = P x r(1+r)^n / ((1+r)^n - 1)'),
(13, 'Travel Budget Calculator', 'travel-budget-calculator', 6,
 'Total trip budget from daily costs and trip length.', 'calculator',
 'total = (daily transport + stay + food + activities) x days'),
(14, 'Calorie Calculator', 'calorie-calculator', 6,
 'Estimate daily calorie needs from age, weight, height and activity.', 'calculator',
 'BMR (Mifflin-St Jeor) x activity factor'),
(15, 'Word Counter', 'word-counter', 6,
 'Count words, characters, sentences and reading time in any text.', 'checker',
 'words = text split on whitespace'),
(16, 'Password Generator', 'password-generator', 6,
 'Generate a random password of a chosen length and character set.', 'generator',
 'random selection from chosen character sets'),
(17, 'QR Code Generator', 'qr-code-generator', 6,
 'Generate a QR code for a link or text.', 'generator',
 'QR encoding of input text'),
(18, 'Time Zone Converter', 'time-zone-converter', 6,
 'Convert a time between two time zones.', 'converter',
 'target time = source time + offset difference'),
(19, 'Speed Converter', 'speed-converter', 6,
 'Convert speed between km/h, mph, m/s and knots.', 'converter',
 '1 mph = 1.60934 km/h; 1 knot = 1.852 km/h'),
(20, 'Area Converter', 'area-converter', 6,
 'Convert area between square metres, square feet, acres and hectares.', 'converter',
 '1 acre = 4046.86 sq m; 1 sq ft = 0.092903 sq m');

-- ---------------------------------------------------------------------------
-- Monetization accounts — only GitHub, YouTube and Pinterest are opened.
-- Everything else is PENDING until the owner verifies it. Never claim
-- otherwise.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO monetization_accounts (id, platform, account_name, account_url, handle, status, notes, verified_at) VALUES
(1, 'GitHub', 'fs-ai', 'https://github.com/mdalfahad841-code/fs-ai', 'mdalfahad841-code', 'active',
 'Source repository for the FS AI platform.', '2026-11-11'),
(2, 'YouTube', 'FS AI', 'https://www.youtube.com/@FSAI-e5f', '@FSAI-e5f', 'active',
 'FS AI YouTube channel.', '2026-11-11'),
(3, 'Pinterest', 'watchwithf', 'https://www.pinterest.com/watchwithf/', 'watchwithf', 'active',
 'FS AI Pinterest account.', '2026-11-11'),
(4, 'Facebook', NULL, NULL, NULL, 'pending',
 'PENDING — account not yet created/verified by the owner.', NULL),
(5, 'WhatsApp Business', NULL, NULL, NULL, 'pending',
 'PENDING — account not yet created/verified by the owner.', NULL),
(6, 'Business Email', NULL, NULL, NULL, 'pending',
 'PENDING — account not yet created/verified by the owner.', NULL),
(7, 'Search Console', NULL, NULL, NULL, 'pending',
 'PENDING — account not yet created/verified by the owner.', NULL),
(8, 'Analytics', NULL, NULL, NULL, 'pending',
 'PENDING — no analytics account connected yet; traffic is Data unavailable.', NULL),
(9, 'AdSense', NULL, NULL, NULL, 'pending',
 'PENDING — account not yet created/verified by the owner.', NULL),
(10, 'Affiliate', NULL, NULL, NULL, 'pending',
 'PENDING — no affiliate programme joined yet.', NULL);

-- ---------------------------------------------------------------------------
-- Revenue — honest $0.00. Only real, verified revenue is ever added.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO revenue_records (id, account_id, source, amount, currency, recorded_date, notes) VALUES
(1, NULL, 'ads', 0.00, 'USD', '2026-11-11', 'Lifetime revenue to date: $0.00. No earnings yet.');

-- ---------------------------------------------------------------------------
-- Expenses — $0.00 under the zero-cost policy (no spend without owner approval).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO expense_records (id, category, description, amount, currency, recorded_date) VALUES
(1, 'hosting', 'Cloudflare Pages + Workers + D1 (free tier)', 0.00, 'USD', '2026-11-11');

-- ---------------------------------------------------------------------------
-- Analytics — HONEST: Data unavailable. NULL metrics, no fabricated rows.
-- One row records the fact that nothing is connected.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO website_analytics (recorded_date, source, page_views, unique_visitors, clicks, top_page, notes) VALUES
('2026-11-11', 'none', NULL, NULL, NULL, NULL,
 'Data unavailable — no analytics account connected yet. No traffic, clicks or visitor numbers exist.');
