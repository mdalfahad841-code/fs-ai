INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(18, 4, 8, 'How to Start Saving With a Small Income',
 'how-to-start-saving-with-small-income',
 'Saving is possible on a small income — start tiny and automate it.',
 'Saving feels impossible when money is tight, but the habit matters more than the amount. This guide shows how to start with a very small fixed amount, pay yourself first on payday, cut one recurring cost, build a small emergency fund before anything else, and grow the amount slowly as income rises.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(19, 5, 10, 'Travel on a Budget: Plan a Trip Without Overspending',
 'travel-on-a-budget-plan-trip-without-overspending',
 'Transport, stays, food and activities — planned before you spend.',
 'A good budget trip is planned before the money is spent, not after. This guide covers setting a total trip budget first, choosing cheaper travel dates, comparing stays, eating where locals eat, and keeping a daily spending limit — with a simple planning order that keeps a trip affordable without making it miserable.',
 'FS AI', 'published', 1, 6);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(20, 6, 12, 'Free Digital Tools: Converters and Calculators You Can Use Today',
 'free-digital-tools-converters-calculators',
 'Twenty free tools on FS AI — no sign-up, no payment, no download.',
 'FS AI offers twenty free digital tools: fuel-cost, loan, savings, percentage and age calculators, unit and currency converters, BMI, tip, discount and compound-interest calculators, and more. This guide lists them all, explains what each one does, and shows how to get a correct answer in seconds with no sign-up and no payment.',
 'FS AI', 'published', 1, 4);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(21, 7, 14, 'Walking for Health: A Beginner''s Fitness Guide',
 'walking-for-health-beginners-fitness-guide',
 'The simplest exercise there is — and how to start properly.',
 'Walking is one of the easiest and safest ways to get fitter: it needs no equipment, no gym and no experience. This beginner''s guide covers how much to walk, how to build up gradually, good walking posture, suitable shoes, and how to make walking a daily habit that actually lasts.',
 'FS AI', 'published', 1, 4);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(22, 8, 15, 'How to Learn a New Digital Skill in 30 Days',
 'how-to-learn-new-digital-skill-in-30-days',
 'A realistic 30-day plan: one skill, daily practice, one finished project.',
 'Thirty days is enough to learn the basics of one digital skill — if you practise a little every day instead of studying in big bursts. This guide gives a realistic plan: pick one skill, learn the core concepts in week one, practise with small tasks in weeks two and three, and finish one real project in week four that proves what you learned.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(23, 7, 14, 'Home Workout Basics: No Equipment Needed',
 'home-workout-basics-no-equipment-needed',
 'A safe beginner routine using only your body weight.',
 'You do not need a gym or equipment to start exercising. This guide covers a safe beginner home routine — warm-up, bodyweight squats, push-ups, planks and stretching — how many sets and repetitions to start with, how to progress week by week, and the warning signs that mean you should stop and rest.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(24, 4, 9, 'Understanding Interest: Loans Explained Simply',
 'understanding-interest-loans-explained-simply',
 'Simple interest, compound interest and loan payments in plain language.',
 'Interest is the price of borrowing money — and understanding it is the difference between a loan you can afford and one you cannot. This guide explains simple and compound interest with worked examples, how a monthly loan payment is calculated, and why paying a little extra each month shortens a loan so much.',
 'FS AI', 'published', 1, 5);
INSERT OR IGNORE INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes) VALUES
(25, 5, 11, 'How to Plan a Road Trip: Checklist and Costs',
 'how-to-plan-road-trip-checklist-costs',
 'Route, car check, budget and packing — one checklist for the whole trip.',
 'A good road trip is planned in four parts: the route and stops, a pre-trip car check, a realistic cost budget (fuel, tolls, food and stays), and a packing checklist. This guide gives you all four, including a fuel-cost estimate you can calculate before you leave so the trip never surprises your wallet.',
 'FS AI', 'published', 1, 6);-- ---------------------------------------------------------------------------
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
