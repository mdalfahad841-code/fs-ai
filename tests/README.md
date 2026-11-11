# FS AI — Tests

## How to run

```bash
npm test                        # runs everything: node --test "tests/*.test.js"
node --test tests/formula.test.js
node --test tests/agents.test.js
node --test tests/api-smoke.test.js
```

Requirements: Node.js 20+. No account, no network and no paid service is
needed for the formula and agent suites. The API smoke suite needs a live
URL only for its live section (see below).

## What each test covers

### `formula.test.js` — the 20 free digital tools

Self-contained: every formula under test is defined inside the test file, so
the suite has no missing imports and runs offline. It checks real expected
values, not placeholders:

- Fuel Cost Calculator — 300 km at 15 km/L and $1.50/L = $30.00
- Loan Payment / EMI Calculator — $10,000 at 12% over 12 months = $888.49/mo;
  $5,000 at 10% over 24 months = $230.72/mo; 0% splits evenly
- Savings Goal Calculator — $1,200 over 12 months = $100/mo
- Percentage Calculator — 20% of 250 = 50; 80 → 100 is +25%
- Age Calculator — born 2000-01-15, as of 2026-11-11: 26 y, 9 m, 27 d
- Unit Converter — km↔miles, kg↔lb, °C↔°F (including round trips)
- BMI Calculator — 70 kg at 1.75 m = 22.86
- Currency Converter — $100 at rate 0.85 = 85
- Tip Calculator — 15% on $100 = $15; split 4 ways = $28.75 each
- Discount Calculator — 25% off $200 = $150 sale, $50 saved
- Compound Interest Calculator — $1,000 at 5% monthly for 5 y = $1,283.36
- Travel Budget Calculator — $110/day × 5 days = $550
- Calorie Calculator — Mifflin-St Jeor, male and female examples
- Word Counter — words, characters, reading time at 200 wpm
- Password Generator — length and charset membership
- Speed Converter — mph↔km/h, knots→km/h
- Area Converter — acres→sq m, sq ft→sq m
- Time Zone Converter — UTC+6 → UTC+0, including day rollover

Invalid inputs (zero mileage, negative principal, discount > 100%, bad dates,
bad times) are expected to throw `RangeError`.

### `agents.test.js` — the 16-agent registry

Self-contained: the registry under test is defined inside the test file and
mirrors `database/seed.sql` exactly. It checks:

- Exactly 16 agents, ids 1–16 with no gaps, unique names and slugs
- Every agent has the required fields (id, name, slug, role, permissions)
- The Central Business Manager is agent 1; all 15 specialists are present
- Permission boundaries: every agent has ≥ 1 permission; no agent holds a
  forbidden permission (`articles.publish`, `admin.*`, `revenue.write`, …)
- No agent can publish directly (`canPublish` is false for all) — publishing
  always needs an owner approval
- Only the Business Manager creates jobs; only Fact Checking verifies facts;
  research agents are scoped to one real division and can draft but never
  publish or self-approve; Analytics can only read; Monetization reads revenue
  but never writes it

### `api-smoke.test.js` — live deployment smoke tests

- **Live section:** fetches the homepage, `robots.txt`, `sitemap.xml`,
  `favicon.svg`, `/api/health` and `/api/divisions` (expecting 8 divisions)
  at the URL in `FS_AI_URL`.
- **Local section:** tests the Worker route functions only if
  `../src/index.js` exists and exports `handleRequest`. That file is not part
  of this package yet, so these tests currently skip and say why.
- **Honest-values section (always runs):** asserts the seeded lifetime
  revenue is $0.00 and traffic is reported as "Data unavailable", never as
  a number.

To run the live section:

```bash
FS_AI_URL=https://fs-ai.pages.dev node --test tests/api-smoke.test.js
```

## What is NOT tested live

- **No live deployment is tested by default.** Without `FS_AI_URL`, the live
  section SKIPS — it does not pass and does not fail. A skipped live test
  means "not checked", never "deployment verified".
- **No traffic, clicks or revenue are tested live**, because no analytics or
  monetization account is connected. The honest values are $0.00 revenue and
  "Data unavailable" traffic.
- **No account connections are tested** (Facebook, WhatsApp Business, Business
  Email, Search Console, Analytics, AdSense, Affiliate are all PENDING owner
  verification). The smoke tests never claim any of them is connected.
- **No database is tested live.** The schema and seed are verified by
  inspection and by applying them to a local D1/SQLite database, not by these
  Node tests. To verify the SQL locally (needs `wrangler` or `sqlite3`):
  `npx wrangler d1 execute fs-ai-db --local --file=database/schema.sql`
  then the same with `database/seed.sql`.
