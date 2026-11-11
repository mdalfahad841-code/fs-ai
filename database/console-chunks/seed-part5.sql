
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
