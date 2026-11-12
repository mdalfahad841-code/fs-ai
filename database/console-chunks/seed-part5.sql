
INSERT OR IGNORE INTO monetization_accounts (id, platform, account_name, account_url, handle, status, notes, verified_at) VALUES
(1, 'GitHub', 'fs-ai', 'https://github.com/mdalfahad841-code/fs-ai', 'mdalfahad841-code', 'active',
 'Source repository for the FS AI platform.', '2026-11-11'),
(2, 'YouTube', 'FS AI', 'https://www.youtube.com/@FSAI-e5f', '@FSAI-e5f', 'active',
 'FS AI YouTube channel.', '2026-11-11'),
(3, 'Pinterest', 'watchwithf', 'https://www.pinterest.com/watchwithf/', 'watchwithf', 'active',
 'FS AI Pinterest account.', '2026-11-11'),
(4, 'Facebook', NULL, NULL, NULL, 'pending',
 'PENDING - account not yet created/verified by the owner.', NULL),
(5, 'WhatsApp Business', NULL, NULL, NULL, 'pending',
 'PENDING - account not yet created/verified by the owner.', NULL),
(6, 'Business Email', NULL, NULL, NULL, 'pending',
 'PENDING - account not yet created/verified by the owner.', NULL),
(7, 'Search Console', NULL, NULL, NULL, 'pending',
 'PENDING - account not yet created/verified by the owner.', NULL),
(8, 'Analytics', NULL, NULL, NULL, 'pending',
 'PENDING - no analytics account connected yet; traffic is Data unavailable.', NULL),
(9, 'AdSense', NULL, NULL, NULL, 'pending',
 'PENDING - account not yet created/verified by the owner.', NULL),
(10, 'Affiliate', NULL, NULL, NULL, 'pending',
 'PENDING - no affiliate programme joined yet.', NULL);

INSERT OR IGNORE INTO revenue_records (id, account_id, source, amount, currency, recorded_date, notes) VALUES
(1, NULL, 'ads', 0.00, 'USD', '2026-11-11', 'Lifetime revenue to date: $0.00. No earnings yet.');

INSERT OR IGNORE INTO expense_records (id, category, description, amount, currency, recorded_date) VALUES
(1, 'hosting', 'Cloudflare Pages + Workers + D1 (free tier)', 0.00, 'USD', '2026-11-11');

INSERT OR IGNORE INTO website_analytics (recorded_date, source, page_views, unique_visitors, clicks, top_page, notes) VALUES
('2026-11-11', 'none', NULL, NULL, NULL, NULL,
 'Data unavailable - no analytics account connected yet. No traffic, clicks or visitor numbers exist.');