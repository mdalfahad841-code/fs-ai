# FS AI — Integrations (2026-11-19)

Which external services FS AI genuinely needs, which are optional, and
which are stopped on the owner's order. No integration here posts,
spends, or connects an account on its own. Status words are exact:
**Connected** (live and working), **Prepared** (code ready, account not
connected), **Pending Owner Authorization** (stopped by the owner),
**Not Connected** (no account, no code path that needs one).

## Necessary (already working — no owner action needed)

| Integration | Status | What it does | Notes |
|---|---|---|---|
| GitHub (`mdalfahad841-code/fs-ai`) | Connected | Source of truth; Pages + Worker rebuild on every push to `main`. | Public repo. Pushes go through the GitHub web flow (see the parent agent's push procedure). |
| Cloudflare Pages | Connected | Serves https://fs-ai-5w5.pages.dev (25 articles, 8 divisions, 20 tools). | Free tier. Build: output `frontend`, no build command. |
| Cloudflare Workers + D1 | Connected | API at https://fs-ai.mdalfahad841.workers.dev; database `fs-ai-db` (5043ece5-a853-433c-95f1-ee15a12b6b56). | Free tier. D1 edits from this VM use the owner's D1-only API token (stored in the registered `custom.cloudflare` connection, never in chat/files). |
| Cloudflare Workers AI | Connected | The ONLY active LLM provider. Free allowance 10,000 Neurons/day; ~34 Neurons used for the first real AI article (2026-11-19). | `[ai]` binding in `config/wrangler.toml`. Groq/Gemini are NOT active and need no keys. |
| Google Search Console | Connected (Verified) | URL-prefix property verified by the owner; sitemap submitted. Homepage indexed (2026-11-19); article pages pending Google's crawl. | Sitemap shows "Couldn't fetch" in the Console UI; the file itself is valid (HTTP 200, 60 URLs). Manual "Request indexing" is quota-limited by Google — retry 2026-11-20 for article 1. |
| Google Analytics 4 (tag) | Tracking Connected — Reporting API Not Connected | The GA4 tag (`G-JVSCJT2DHJ`) fires on every page. | No GA4 Data API / OAuth exists, so the dashboard reports traffic as "Data unavailable" and revenue as $0.00. That is honest, not a bug. |
| YouTube (`@FSAI-e5f`, mdalfahad406@gmail.com) | Connected (manual) | Daily Shorts + weekly long videos, posted by the parent agent through the owner's signed-in browser session. | Channel ID `UCnuMFV5vL3c6jyJGGei2b9Q`. Community posts unavailable (needs 500 subscribers). No auto-posting code exists. The saved vault password for mdalfahad406 is WRONG — if the session dies, the owner signs in himself. |
| Pinterest (`watchwithf`, Watchwithfahad@gmail.com) | Connected (manual, FREE business account) | One Pin per article, posted by the parent agent. Boards: EV Charging, Car Maintenance, Hybrid Cars. | Business conversion done 2026-11-19 (free, no card). Analytics all zero so far — Pins are days old. No auto-posting code exists. |

## Optional (not connected — only if the owner offers)

| Integration | Status | What it would do | What it needs (owner step) |
|---|---|---|---|
| Groq (LLM fallback) | Not Connected | Fallback provider if Workers AI is ever unavailable. | Owner creates a free GroqCloud account + API key → `GROQ_API_KEY` Worker secret. NOT requested; Workers AI works. |
| Gemini API (LLM fallback) | Not Connected | Second fallback provider. | Owner creates a free key in Google AI Studio → `GEMINI_API_KEY` Worker secret. NOT requested; Workers AI works. |
| Google Analytics 4 (Data API) | Not Connected | Real visitor/page-view numbers in the dashboard. | Google Cloud OAuth consent + a service credential. Needs a Google Cloud project and owner consent — not started, and not needed while traffic is ~0. |
| AdSense | Pending | Display ads on the site once traffic exists. | Real traffic + owner identity/bank verification when eligible. YouTube monetization is a separate path (0/1,000 subscribers, 0/4,000 watch hours as of 2026-11-19). No date can be promised. |
| Affiliate programs | Pending | Affiliate links in articles once traffic exists. | Owner approval per program; no program joined yet. |
| Newsletter double opt-in (email sending) | Not Connected | Confirmation emails for subscribers (currently status `pending`, never claimed as confirmed). | A genuinely free email sender. None verified yet — do not claim double opt-in until one is connected and tested. |

## Stopped on the owner's order (do NOT resume, push, or nudge)

Ordered 2026-11-13 ("3-6 apatoto stop"). Code-level integration prep /
status display is acceptable; no account creation, connection, or
posting.

| Integration | Status | Notes |
|---|---|---|
| Facebook Page | Pending Owner Authorization | No page created, no posting code. |
| WhatsApp Business | Pending Owner Authorization | No account, no messaging code. |
| Business Email | Pending Owner Authorization | No mailbox created. |
| Cloudflare Access (dashboard lock) | Pending Owner Authorization | The dashboard gate is browser-side only (login form hides content until sign-in). Cloudflare Access would be the real lock, but onboarding asks for payment details for identity verification and the owner will not add a card (zero-cost rule). Do not retry. |

## What the site deliberately does NOT integrate

- **No social auto-posting.** `backend/agents/autonomy/social.js` is
  pack-only (captions + hashtags, zero `fetch()` calls). Every Pin and
  video is posted through the parent agent with the owner's live
  session, one at a time.
- **No paid service of any kind.** Every integration above is free-tier
  only. If a free quota ends, the feature pauses — it never switches
  to paid, and business revenue is never spent without explicit owner
  permission.
- **No other Google account.** YouTube scope is `@FSAI-e5f` only
  (mdalfahad406@gmail.com). mdalfahad841@gmail.com's own channel is
  terminated; samhafaiha@gmail.com is out of scope. Nothing else is
  looked at.
