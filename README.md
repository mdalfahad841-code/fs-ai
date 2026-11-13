# FS AI — FAHAD SOMRAT AI

**One Platform. Multiple Possibilities.**

> **EXPLORE MORE. KNOW MORE. DO MORE.**

FS AI is a zero-cost, autonomous multi-niche digital business platform founded,
owned and administered by **Fahad Somrat**. It publishes research-backed articles,
free digital tools and learning content across eight divisions, run day to day by
a 14-agent AI Business Management System (plus the Central Business Manager and
support agents — 16 agents in total) with publishing only after owner approval.

This repository is the **source-code package**: database schema, migrations and
seed data, Cloudflare configuration, public assets and tests. The public website
itself is a static frontend served from the `frontend/` directory.

## The 8 Divisions

| # | Division | Focus |
|---|----------|-------|
| 1 | Automotive | Cars, bikes, EVs, maintenance, buying guides |
| 2 | AI & Technology | AI explained plainly, free AI tools, tech guides |
| 3 | Gadgets & Electronics | Smartphones, laptops, tablets, buying guides |
| 4 | Finance & Money | Budgeting, saving, loans, interest explained simply |
| 5 | Travel & Lifestyle | Budget travel, road trips, planning checklists |
| 6 | Digital Tools | Free converters, calculators and utilities |
| 7 | Health & Wellness | Fitness, walking, home workouts |
| 8 | Education & Learning | Digital skills, learning guides |

## Architecture (zero-cost, free tier only)

```
GitHub repo (source of truth)
        |
        v
Cloudflare Pages  -- serves the static frontend (free tier)
        |
Cloudflare Workers -- API routes, agent automation (free tier)
        |
Cloudflare D1     -- SQLite database (free tier)
```

- **Frontend:** static HTML/CSS/JS, built by the Pages build step.
- **Backend:** Cloudflare Workers (free tier: 100,000 requests/day, 10 ms CPU).
- **Database:** Cloudflare D1 (free tier, SQLite-compatible).
- **No paid services anywhere.** No paid domain, hosting, API, AI model/credits,
  subscription, template, plugin or software. If a free quota ends, the feature
  pauses — it never auto-switches to paid.
- **No secrets in this repo.** All credentials are placeholders in
  `.env.example`; real values live only in Cloudflare / GitHub Secrets.

## How to run locally

Prerequisites: Node.js 20+ and npm. No account or paid service is needed to
run the tests or preview the static site.

```bash
# 1. Clone
git clone https://github.com/mdalfahad841-code/fs-ai.git
cd fs-ai

# 2. Copy the environment template and fill in your own values
cp .env.example .env

# 3. Install dev tools (wrangler only; no runtime dependencies)
npm install

# 4. Run the test suite
npm test

# 5. Preview the static frontend locally (any static server works)
npx wrangler pages dev frontend
# or: npx serve frontend
```

Local D1 development (optional, needs a free Cloudflare account):

```bash
npx wrangler d1 create fs-ai-db        # one-time; paste the ID into wrangler.toml
npx wrangler d1 execute fs-ai-db --local --file=database/schema.sql
npx wrangler d1 execute fs-ai-db --local --file=database/seed.sql
npx wrangler dev
```

## How to deploy

Repository: **https://github.com/mdalfahad841-code/fs-ai**

### 1. GitHub

Push this package to the repo above (branch `main`). Nothing in this repo
contains a secret; CI needs no credentials beyond the Cloudflare deploy token
stored as a GitHub Secret by the owner.

### 2. Cloudflare Pages (frontend)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Select repo `mdalfahad841-code/fs-ai`, branch `main`.
3. Build command: (none — static site) / Build output directory: `frontend`.
4. Deploy. The site is live on the `*.pages.dev` URL Cloudflare assigns.

### 3. Cloudflare D1 (database) — schema → migrations → seed order

Run in this exact order. The full schema is the reference; the migrations are
the incremental path for an existing database.

```bash
# Create the database (one-time)
npx wrangler d1 create fs-ai-db

# Put the returned database_id into config/wrangler.toml

# Option A — fresh database: apply the full schema, then the seed.
# schema.sql is complete: it includes the sessions table (owner login),
# the rate_limits table, articles.publish_at, article_revisions and
# ai_agents.status. Do NOT apply migration 004 after schema.sql — its
# ALTER TABLE steps are already in the schema and would fail as
# duplicate columns.
npx wrangler d1 execute fs-ai-db --file=database/schema.sql
npx wrangler d1 execute fs-ai-db --file=database/seed.sql

# Option B — incremental: apply migrations in order, then the seed.
# Use this path for a database that was built from the OLD schema.sql
# (before the sessions table was added to it), e.g. the live database.
npx wrangler d1 execute fs-ai-db --file=database/migrations/001_initial.sql
npx wrangler d1 execute fs-ai-db --file=database/migrations/002_agents_accounts.sql
npx wrangler d1 execute fs-ai-db --file=database/migrations/003_sessions.sql
npx wrangler d1 execute fs-ai-db --file=database/migrations/004_cms_newsletter.sql
npx wrangler d1 execute fs-ai-db --file=database/seed.sql
```

### 4. Cloudflare Workers (API / automation)

```bash
npm run deploy
# equivalent: npx wrangler deploy --config config/wrangler.toml
```

Bind the D1 database as `DB` (see `config/wrangler.toml`) and set the
environment variables from `.env.example` in the Cloudflare dashboard —
never commit real values.

## How to test

```bash
npm test            # node --test "tests/*.test.js"  (all suites)
node --test tests/formula.test.js
node --test tests/agents.test.js
node --test tests/api-smoke.test.js
```

See `tests/README.md` for what each suite covers and what is **not** tested
live. The API smoke tests skip honestly when no deployment URL is set
(`FS_AI_URL`); they never claim a live deployment passed.

## The 16 agents

Central Business Manager coordinates 15 specialist agents: Automotive Research,
Technology Research, Gadget Research, Finance Research, Travel Research, Digital
Tools, Health Research, Education Research, SEO, Content Creation, Fact
Checking, Publishing, Analytics, Monetization and Security. Every agent has a
bounded permission set recorded in `agent_permissions`; no agent can exceed its
permissions, and publishing always requires owner approval
(`approval_records`).

## Zero-cost policy (strict, non-negotiable)

- The owner's personal investment is always **$0**.
- No paid domain, hosting, API, AI model/credits, subscription, template,
  plugin, software, paid trial, credit-card requirement or automatic upgrade.
- Verified free services / quotas only. When a free quota ends, pause the
  feature — never auto-switch to paid.
- Never spend business revenue without the owner's explicit permission.

## Honest limits — read this before believing any number

- **Revenue: $0.00.** No revenue has been earned; the seed data records exactly
  that. No earnings figure is ever invented.
- **Traffic: Data unavailable.** No analytics account is connected yet, so no
  traffic, clicks or visitor numbers exist. Nothing in this repo fabricates them.
- **The static site has no live backend until deployed.** Until the Workers +
  D1 deployment above is completed, the frontend is static content only:
  no live search, no live tools backend, no newsletter storage.
- **Accounts pending owner verification.** Only GitHub, YouTube and Pinterest
  are recorded as opened (see `database/seed.sql`). Facebook, WhatsApp Business,
  Business Email, Search Console, Analytics, AdSense and Affiliate accounts are
  **PENDING** — never claim they are created or connected without verification,
  and never bypass OTP / CAPTCHA / identity checks.
- **Owner approval gate.** The agent system drafts; the owner approves. Nothing
  publishes without an `approval_records` entry.

## Project layout

```
fs-ai/
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── config/
│   ├── wrangler.toml            # Workers/Pages + D1 binding (free tier)
│   └── deployment-config.json   # Deploy steps, limits, env placeholders
├── database/
│   ├── schema.sql               # Full schema — 26 tables (incl. sessions, rate_limits)
│   ├── migrations/
│   │   ├── 001_initial.sql
│   │   ├── 002_agents_accounts.sql
│   │   ├── 003_sessions.sql
│   │   └── 004_cms_newsletter.sql
│   └── seed.sql                 # 8 divisions, 16 agents, 25 articles, 20 tools
├── public/
│   ├── favicon.svg
│   ├── robots.txt
│   └── sitemap.xml
└── tests/
    ├── README.md
    ├── formula.test.js
    ├── api-smoke.test.js
    └── agents.test.js
```

## License

All content © Fahad Somrat / FS AI. Source in this package is provided for the
owner's own deployment and maintenance.
