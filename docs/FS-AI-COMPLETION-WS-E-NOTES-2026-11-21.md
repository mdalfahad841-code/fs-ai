# FS AI — Workstream E Notes: Analytics Honesty + Security Audit

**Date:** 2026-11-21 (work done 14:12–14:35 Dhaka)
**Author:** Workstream E subagent (depth 2)
**Scope:** `backend/routes/analytics.js` (owned) + read-only audit of the whole
application + two new test files. No deploy, no push, no live D1 writes, no
publishing, no test posts, no OAuth. All live values below are SELECT-only
reads from D1 (database `5043ece5-a853-433c-95f1-ee15a12b6b56`) taken
2026-11-21 ~14:13 Dhaka.

## 0. Permanent restrictions (owner authorization override, 2026-11-21 14:12)

Recorded here because they bind this workstream's deliverables:

- **$0 always.** No paid service, API, model, credit, subscription, trial,
  card requirement, or auto-upgrade. Workers AI only.
- **Never publish #28 / #29 / #30 / #31** without separate editorial
  authorization **each**. (This workstream touched none of them; live
  verification below confirms all four still draft, unchanged.)
- **Health / Finance always need special human review** — never
  auto-publishable (already enforced by the auto-publish evaluator; not
  re-tested here, not changed).
- **Never claim a social account connected or a post/video published
  without verification.** Live: no social account is connected (no
  social tables exist in live D1 yet — §1), no post is claimed anywhere
  in the analytics output.
- **Auto-publishing only for NEW articles passing EVERY gate**, one-per-day
  limit + E-Stop preserved; existing drafts excluded. (Verified in code:
  `backend/agents/autonomy/publishing.js` — three-part enablement +
  cutoff + `LEGACY_AUTO_PUBLISH_REFUSED_IDS`; unchanged by this
  workstream.)
- **Deploy is authorized for TONIGHT, before the 2026-11-22 06:00 Dhaka
  weekly run** — the weekly run will fire on the NEW code. Deployment
  inputs from this workstream are in §6; post-deploy checks in §7.

## 1. Live D1 ground truth (SELECT-only, 2026-11-21 ~14:13 Dhaka)

| Check | Live value |
|---|---|
| Published articles | 25 |
| Draft articles | 6 |
| `website_settings.total_revenue_usd` | `0.00` |
| `website_settings.emergency_stop` | `0` (OFF) |
| `autonomy_settings.publishing_mode` | `approved_only` |
| `auto_publishing` / `auto_correction` / `social_auto_post` | `off` / `off` / `off` |
| `auto_research` / `auto_generation` / `auto_factcheck` | `on` / `on` / `on` |
| `max_articles_per_day` | `1` |
| `llm_provider` | `none` |
| `auto_publish_eligible_since` | absent (not set) |
| `website_analytics` | seed row only: `2026-11-11`, source `none`, all metrics NULL |
| `social_posts` / `social_analytics` / `social_accounts` tables | **do not exist live yet** (migration 022 not applied) |
| `llm_usage`, last 7 days | 47 calls, **all Workers AI** (`@cf/openai/gpt-oss-20b`, `@cf/openai/gpt-oss-120b`, `@cf/mistralai/mistral-small-3.1-24b-instruct`) |
| #26 | draft, 4895 chars, `2026-11-19T18:53:30.327Z`, protected=1 — unchanged |
| #27 | draft, 245 chars, `2026-11-19T18:53:32.930Z`, protected=1 — unchanged |
| #28 | draft, 2157 chars — unchanged |
| #29 | draft, 593 chars — unchanged |
| #30 | draft, 4615 chars — unchanged |
| #31 | draft, 549 chars, `2026-11-21T01:19:10.364Z` — unchanged, still draft |

## 2. Analytics honesty — coverage table (live state)

New sections in `backend/routes/analytics.js`: `impressions`,
`search`, `indexed`, `video`, `traffic-sources`; `revenue` /
`social` / `engagement` / `traffic` extended with `status`,
`source` and `whatWouldMakeAvailable`. `GET
/api/analytics/detail?section=all` now also returns a `coverage`
object (see `coverageTable()`), derived from the sections actually
read — a metric is `verified` only where real data exists.

| Metric | Status (live) | Evidence / method |
|---|---|---|
| Article impressions | **UNAVAILABLE** | `website_analytics` holds only the seed row (source `none`, NULL metrics). Reason + what-would-make-available returned; value `null`, never 0. |
| Article clicks | **UNAVAILABLE** | Same snapshot as impressions. |
| Article CTR | **UNAVAILABLE** | CTR is computed (`clicks / page_views`, 1 decimal) only when a real snapshot carries both numbers; otherwise `null` with a note that it is never estimated. Tested both ways. |
| Search performance | **UNAVAILABLE** | No Search Console data in D1. Reason: "Search Console data is not stored in D1". What would make it available: connect the Search Console API and store query/click/impression/position rows (no such table exists yet). |
| Indexed pages | **UNAVAILABLE** | No indexed-page count stored in D1. Manual note only (not a metric): homepage indexed via URL Inspection 2026-11-19; Article 1 not indexed; sitemap "Couldn't fetch" / 0 pages as of 2026-11-20. |
| Social engagement | **UNAVAILABLE** | `social_analytics` table does not exist live (migration 022 not applied). Becomes VERIFIED from real D1 rows once 022 is applied (tested with rows: saves=7 returned verbatim). |
| Video views | **UNAVAILABLE** | YouTube Data API not connected; no video-metrics table. Manual note only: Shorts performance known only from manual Studio checks (latest Short #05, 2026-11-21). |
| Watch time | **UNAVAILABLE** | Same as video views. |
| Traffic sources | **UNAVAILABLE** | GA4 Data API not connected; no per-source rows in D1. |
| Revenue | **VERIFIED — $0.00** | Reads the real setting `website_settings.total_revenue_usd` (`0.00` live). Tested: changing the setting to `12.34` reads back `$12.34`. AdSense not connected. |

**Estimated: 0 metrics.** This codebase has no estimation method, so no
metric is ever labelled `estimated` (`coverage.estimated` is always 0;
pinned by test).

Other detail sections already VERIFIED from live D1 (unchanged
behaviour, re-confirmed): articles, drafts, research, fact-checks,
SEO, AI usage (Workers AI only), errors, queue, reports, activity.
Stale checks are flagged (`factchecks`/`seo` `stale` when the check
predates the article edit; impressions snapshot stale after 7 days —
`freshness.stale` now propagates the section's own stale flag instead
of always reporting `false`; legacy `GET /api/analytics` gains
`snapshotStale`).

### Feedback loop — VERIFIED read-only

- `backend/routes/analytics.js` contains **no** `d1Run`, no `INSERT`,
  no `UPDATE`, no `DELETE` (pinned by test).
- The **only** writer of `autonomy_settings` in `backend/` is the
  owner-only `POST /api/autonomy/settings` handler
  (`backend/routes/orchestrator.js:499`, allowlisted keys — §3).
- The **only** writer of the Emergency Stop flag is
  `setEmergencyStop` (`backend/routes/admin.js`) — pinned by test.
- The weekly report's recommendations (`scheduler.js:1427-1447`) are
  **human-readable strings only**; no code path reads them back or
  acts on them.
- **Conclusion: analytics NEVER auto-changes publishing policy.** No
  code path from any analytics read to any settings write exists. If
  one is ever added, it must go through the owner-only settings
  endpoint with an explicit owner action — nothing in this workstream
  creates such a path.

### What changed in `backend/routes/analytics.js` (owned file)

1. New unavailable markers with `reason` + `whatWouldMakeAvailable`:
   `IMPRESSIONS_UNAVAILABLE`, `SEARCH_PERF_UNAVAILABLE`,
   `INDEXED_UNAVAILABLE`, `VIDEO_UNAVAILABLE`,
   `TRAFFIC_SOURCES_UNAVAILABLE`.
2. New sections: `sectionImpressions` (verified-on-real-snapshot /
   unavailable-on-seed, CTR, 7-day staleness),
   `sectionSearch`, `sectionIndexed`, `sectionVideo`,
   `sectionTrafficSources`.
3. `sectionRevenue`: added `status: 'verified'`,
   `source: 'website_settings.total_revenue_usd'`,
   `whatWouldMakeAvailable`. `sectionSocial` / `sectionEngagement`:
   `status: 'verified'` + `source` when tables exist, else unavailable
   + `whatWouldMakeAvailable`. `traffic`: added
   `whatWouldMakeAvailable` to both children (shape unchanged).
4. `coverageTable(sections)` exported; `section=all` returns it.
5. `wrap()` propagates `data.stale` into `freshness.stale`;
   `handleAnalytics` gains `snapshotStale` / `snapshotNote`.
6. Hardening (FIXED): `latestCheckRows()` now enforces an allowlist
   (`fact_checks`, `seo_checks` only) before interpolating the table
   name into SQL. The only callers already passed literals; the
   allowlist makes that a guarantee, not a convention.

## 3. Security audit — full table

Method: read the code (Worker, all routes, middleware, social,
publishing, LLM registry, RSS, frontend dashboard/article pages);
every D1 query construction checked for placeholders vs
interpolation; live D1 read-only checks where a claim needed ground
truth. Severity is judged against **this app's actual deployment**
(Cloudflare Pages static frontend + Workers + D1; dashboard gate is
enforced server-side by `requireOwner` on every owner route; the
dashboard page itself is a static file).

| # | Finding | Evidence (file:line) | Severity | Status |
|---|---|---|---|---|
| H1 | **Protected articles can be edited, published, and DELETED through manual endpoints — `assertNotProtected` never wired into admin-articles.js.** `deleteArticle`, `updateArticle`, `setPublishState` fetch the row and mutate it with no protection check. `protection.js` states every manual per-article entry point "must call `assertNotProtected`" and names "admin article edit/publish/delete" as callers — but `grep assertNotProtected backend/routes/admin-articles.js` returns **0 calls** (only `scheduler.js:629,810` task-level and `orchestrator.js:1123,1387` recheck/correct call it). The dashboard Delete button (`dashboard.js:240`) is one `confirm()` click from deleting #26/#27. Live #26/#27 are `is_protected=1`. Exploitability: requires an owner session (or the owner misclicking) — not reachable unauthenticated — but the 2026-11-20 incident (SEO repair overwrote #26/#27) shows this exact class already bit once via automation; the manual path is the remaining hole. | `backend/routes/admin-articles.js:183` (`updateArticle`), `:257` (`deleteArticle`), `:288` (`setPublishState`); `backend/publishing/protection.js` (docstring + `assertNotProtected`); `frontend/scripts/dashboard.js:240` | **High** | **PATCH-PROPOSED** — WS-A owns the Delete repair; file not edited by WS-E. Exact patch below. A skipped test pins the required behaviour (`tests/security-boundaries.test.js`, "protected-article Delete guard"). |
| H2 | **No security headers on any Worker response, and article bodies render as raw HTML.** `corsHeaders`/`withCors` set only CORS headers — no CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` (`backend/worker.js:44-56`). `frontend/pages/article.html` injects the body unescaped: `'<div class="article-full">' + stripDraftBanner(a.body) + '</div>'`. Any path that renders a D1/LLM-authored body without sanitisation is stored-XSS for every visitor, with no CSP to contain it. Mitigating today: the public article page renders the static `ARTICLES` list (code-reviewed content) and dashboard rendering escapes via `FSAI.esc`; D1 bodies reach visitors only through API-driven rendering. Still the missing CSP is the gap. | `backend/worker.js:44-56`; `frontend/pages/article.html:137` | **High** (defence-in-depth) | **PATCH-PROPOSED** — `worker.js` is shared/coordinator-owned; not edited. Exact patch below (step 1 + the inline-script caveat). |
| M1 | **Groq / Gemini still in the default LLM fallback order.** `DEFAULT_PROVIDER_ORDER = ['workers-ai', 'groq', 'gemini']` (`backend/llm/registry.js:22`); `providerStatus` marks either `available` the moment its key exists, and `wrangler.toml` says the layer "falls back to Groq/Gemini only when their keys exist". That contradicts the standing rule "Workers AI must be the only active LLM provider — no Groq/Gemini unless explicitly authorized later". Live D1 proves no violation yet (47 calls / 7 days, all Workers AI), but a set key would silently activate a second provider. | `backend/llm/registry.js:18,22,66-73`; `config/wrangler.toml` (`[ai]` comment) | **Medium** | **PATCH-PROPOSED** — exact patch below. Policy change; coordinator to run `tests/autonomy-llm.test.js` after applying. |
| M2 | **Login brute-force has no per-account lockout and no failed-login logging.** Only throttle is the shared 30 POST/min/IP limiter (`backend/middleware/rate-limit.js:13,58`); PBKDF2-100k per attempt is the only per-attempt cost (`backend/security/crypto.js`). No lockout, no failed-attempt counter, no alert. Single-owner app, so the blast radius is one account — but it is the owner account. | `backend/routes/auth.js` (login handler); `backend/middleware/rate-limit.js:13` | **Medium** | **PATCH-PROPOSED** — exact patch sketch below. |
| M3 | **Social publish route maps an E-Stop block to HTTP 502, not 423.** The dispatcher returns `{ status: 'blocked', failure: { code: 'ESTOP' } }`, but the route maps only `waiting_authorization` → 423 and everything else → 502 (`backend/routes/social.js:241`). Agent runs answer 423 and daily/weekly return `skipped`; the social route is the inconsistent one. A 502 reads as a server error to monitoring/alerting, hiding an intentional halt. The block itself is correct (verified: no platform call, post stays `blocked`, 0 attempts). | `backend/routes/social.js:241`; `backend/social/dispatcher.js:58-63,126` | **Medium** | **PATCH-PROPOSED** — WS-C file (`routes/social.js`); not edited. Exact patch below. Pinned by test (asserts the safe behaviour + ESTOP code, not the wrong code). |
| M4 | **Session tokens: 7-day expiry, no rotation, no revoke-all.** `createSession` issues a fresh token per login but never invalidates older ones; `revokeSession` deletes only the presented token (`backend/middleware/auth.js:44-67`). A stolen token works for up to 7 days. Mitigated: single owner, token in `sessionStorage` (not a cookie), otherwise-good XSS posture. | `backend/middleware/auth.js:44-67` | **Medium** | **ACCEPTED-RISK** (owner-visible): single-owner app, no shared devices in use; recommend a "revoke all sessions" owner action as follow-up work, not a deploy blocker. |
| L1 | **Rate-limit D1 check-then-increment is non-atomic.** `d1Check` SELECTs then INSERTs/UPDATEs (`backend/middleware/rate-limit.js:25-45`); concurrent isolates can both pass. Memory fallback is per-isolate. Limits here are abuse friction, not a security boundary, for a single-owner app. | `backend/middleware/rate-limit.js:25-45` | Low | **ACCEPTED-RISK** — would need an atomic upsert; not a deploy blocker. |
| L2 | **Backup export includes subscriber emails + all settings in one owner-only call.** `BACKUP_TABLES` (`backend/routes/admin.js:63`) includes `newsletter_subscribers` and `website_settings`; `GET /api/admin/backup` returns the whole dump. (Verified: `sessions` is **not** in the list — token hashes are not exported — and restore already skips sessions, `tests/backup-restore.test.js:215`.) Owner-only route, so this is the export doing its job; risk is a stolen owner token = one-call bulk exfil. | `backend/routes/admin.js:63-95` | Low | **ACCEPTED-RISK** — keep the export owner-only; never share the exported file. No code change. |
| L3 | **`updatePost` builds its SET clause from caller keys, regex-filtered only.** Keys pass `/^[a-z_]+$/` but there is no column allowlist (`backend/social/store.js:163`). Values are bound. Callers are internal (dispatcher) only — verified safe as implemented. (`updateAccountTokens`, `store.js:79-89`, uses literal column names only — safe.) | `backend/social/store.js:155-172` | Low | **PATCH-PROPOSED** — WS-C file; exact patch below. |
| L4 | **Delete leaves orphan rows.** `deleteArticle` deletes only the `articles` row (`backend/routes/admin-articles.js:257-265`); `article_tags` and `article_sources` rows for the article remain. Revisions are kept by design (audit history). | `backend/routes/admin-articles.js:257-265` | Low | **PATCH-PROPOSED** — WS-A file; exact patch below. |
| L5 | **CORS allowlist includes localhost origins** (`http://localhost:8787`, `http://localhost:5173`, `backend/worker.js:28-33`). No `Access-Control-Allow-Credentials` is ever set, so no credentialed cross-origin request is possible; localhost origins matter only if an attacker runs a server on the victim's machine. | `backend/worker.js:28-33,44-56` | Low | **ACCEPTED-RISK** — dev convenience; remove the localhost entries in a production-only config if desired. |
| L6 | **Social verify returns the platform error verbatim** (`backend/routes/social.js`, verify catch: `reason.slice(0, 500)` stored + returned). Owner-only route; platform errors carry no secret. | `backend/routes/social.js` (verify handler) | Low | **ACCEPTED-RISK** — owner-only; no action. |

### Verified safe / not applicable (with evidence)

- **SQL injection — none found.** Every D1 call uses prepared statements
  with bound parameters. Dynamic SQL fragments come only from internal
  constants / fixed lists: `analytics.js` table name (now allowlisted —
  §2.6), `admin.js` `BACKUP_TABLES` (fixed list), `protectedExclusion`
  (constant ids `[26, 27]`), `publishing.js` legacy-refusal ids
  (constant), `orchestrator.js` RSS-audit `WHERE` (internal boolean).
  Tested: crafted `platform` filter and crafted article id return
  no rows / 404, tables intact.
- **Authentication — sound.** PBKDF2 100k iterations, SHA-256, 16-byte
  salt, constant-time compare (`crypto.js`); sessions stored as
  `SHA-256(secret:token)`, 7-day expiry, expiry checked server-side;
  the raw `SESSION_SECRET` is **never** accepted as a Bearer token
  (pinned by test); missing secret fails closed (503). Login never
  reveals which part was wrong.
- **Authorization — sound.** Every owner route is gated by
  `requireOwner` in `worker.js` before its handler runs; `handleSocial`
  re-checks inside as defence-in-depth. Public routes are read-only
  except newsletter subscribe/unsubscribe (validated, consent-gated).
- **Settings allowlist — sound.** `SETTING_RULES`
  (`orchestrator.js:129-163`) is the only way settings change; unknown
  keys (including `total_revenue_usd`, `emergency_stop`,
  `llm_provider_order`, `SESSION_SECRET`) and invalid values are
  refused 400 (pinned by test). `publishing_mode: auto` alone publishes
  nothing (three-part enablement).
- **Token encryption — sound.** AES-256-GCM, random 12-byte IV,
  key = SHA-256(`SOCIAL_TOKEN_SECRET`), stored `v1:iv:ciphertext`
  (`social/tokens.js`); fail-closed without the secret; tampered
  ciphertext rejected (GCM auth); plaintext never appears in the stored
  form (pinned by test). Note: key derivation is a single SHA-256, so
  `SOCIAL_TOKEN_SECRET` must be long and random (see §6).
- **XSS (dashboard) — sound.** `dashboard.js` / `autonomy.js` /
  `search.js` / `charts.js` escape through `FSAI.esc` consistently
  (spot-checked 30+ interpolations); `escapeHtml` verified by test.
  Residual risk is H2 (raw article-body HTML + no CSP).
- **CSRF — not applicable.** Auth is a Bearer token from
  `sessionStorage`; no cookies are set, no `Allow-Credentials`.
  `createCsrfToken` / `verifyCsrfToken` exist in `crypto.js` but have
  no callers (dead code — if cookie auth is ever introduced, wire them
  in first).
- **Secrets in code — none.** Pattern scan for API keys / tokens /
  JWTs / GitHub tokens across the tree: no hits. `.env.example` holds
  placeholders only (verified by character-shape check — all values are
  lowercase hyphenated words; `CLOUDFLARE_ACCOUNT_ID` is literally
  `your-cloudflare-account-id`). No `.env` file exists in the tree.
- **Logging / error leakage — clean.** No password, token, secret or
  hash is logged anywhere (`console.*` grep); the Worker edge catch
  returns a generic 500; owner-only routes may include a truncated
  `err.message` (acceptable — owner-only).
- **Webhooks — none exist.** No webhook endpoint, no signature to
  validate; nothing to fix.
- **Newsletter — no enumeration leak.** Unsubscribe always answers 200
  even for unknown addresses; duplicate subscribe answers 200 without
  leaking state; consent is required and persisted.
- **RSS / SSRF — owner-only, https-only.** Source creation is
  owner-only, validates the feed live before storing, and `rss.js`
  fetches https only with a 5s timeout and a 50-item cap.
- **Dashboard gate is browser-side only — known, accepted.** The
  dashboard page is a static file; the real gate is the API
  (`requireOwner`). Public numbers shipped in the static page are the
  same honest numbers as the public site. No change.

### Emergency Stop — verified end to end in code + tests

| Path | ON behaviour | OFF restores | Evidence |
|---|---|---|---|
| Manual agent run (`POST /api/agents/:id/run`) | 423, run logged `skipped` | 200 path | `agents.js:122-125`; existing `emergency-stop-toggle.test.js` |
| `runTask` (dashboard / re-check) | 423, task `BLOCKED_WITH_REASON` | normal execution | `scheduler.js:634` |
| Scheduled publish (`publishDueArticles`) | 0 published, `skipped: true`, article stays `approved` | publishes due approved articles | `admin-articles.js:352`; new test |
| Daily workflow | skipped, no report row written | runs normally | `scheduler.js:1071`; new test |
| Weekly workflow | skipped, no report row written | runs normally | `scheduler.js:1369`; new test |
| Auto-publish (`runAutoPublish` / gate) | no-op, reason "Emergency Stop is on" | normal eligibility | `publishing.js:345`; `gate.js:224,717` |
| Social dispatcher | throws ESTOP pre-flight, post `blocked`, 0 attempts, no platform call | next check (account/OAuth) applies | `dispatcher.js:58-63`; new tests |
| Social publish route | refuses, failure code ESTOP, post stays `blocked` | normal publish path | `social.js` publish handler; new test (see M3 for the 502-vs-423 code note) |

No partial state on any blocked path: blocked runs write a `skipped`
log row and nothing else. Live E-Stop stays **OFF** — this workstream
did not toggle it (live read: `0`).

## 4. Exact patches proposed (files WS-E must not edit)

### Patch H1 — guard the manual article endpoints (WS-A file: `backend/routes/admin-articles.js`)

```js
// Top of file, with the other imports:
import { assertNotProtected } from '../publishing/protection.js';

// In deleteArticle(), immediately after the 404 check:
const guard = await assertNotProtected(env, id);
if (!guard.ok) return jsonError(guard.reason, 403);

// Same two lines in updateArticle() (after its fetchArticle 404 check)
// and in setPublishState() (after its fetchArticle 404 check).
```

Un-skip the test in `tests/security-boundaries.test.js` ("protected-article
Delete guard") once this lands; it asserts DELETE #26 → 403 and the row
survives.

### Patch H2 — security headers (shared file: `backend/worker.js`, coordinator)

```js
// Inside withCors(), after the CORS headers are set:
headers.set('X-Content-Type-Options', 'nosniff');
headers.set('X-Frame-Options', 'DENY');
headers.set('Referrer-Policy', 'no-referrer');
headers.set('Content-Security-Policy',
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://fs-ai-5w5.pages.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
```

Caveat (do not skip): `frontend/pages/article.html` and the dashboard
use inline `<script>` blocks, so `script-src 'self'` alone would break
them — that is why `'unsafe-inline'` is in step 1. Tightening to a
nonce/hash CSP requires extracting the inline scripts first; step 1
still buys `frame-ancestors`, `base-uri`, `object-src` (via
`default-src`) and MIME-sniffing protection. Step 2 (follow-up):
sanitise article-body HTML at render time instead of injecting it raw.

### Patch M1 — Workers AI only in the default order (`backend/llm/registry.js`)

```js
// Before:
export const DEFAULT_PROVIDER_ORDER = ['workers-ai', 'groq', 'gemini'];
// After:
export const DEFAULT_PROVIDER_ORDER = ['workers-ai'];
```

`PROVIDERS` still lists Groq/Gemini as `not-configured` (status
reporting unchanged); re-enabling one later = explicit owner
authorization + setting `llm_provider_order` via the settings API.
Also update the `config/wrangler.toml` `[ai]` comment ("falls back to
Groq/Gemini only when their keys exist" → "no fallback is configured;
Workers AI only unless the owner sets llm_provider_order"). Run
`tests/autonomy-llm.test.js` after applying.

### Patch M2 — login lockout (sketch; `backend/routes/auth.js`)

```js
// Module-level (per-isolate; D1-backed counting is the follow-up):
const failedLogins = new Map(); // email -> { count, lockedUntil }
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
// In the login handler, before createSession():
//   - if lockedUntil > now → 429 "Too many failed sign-ins — try again in 15 minutes."
//   - on failure: count++, set lockedUntil when count hits 5; log the
//     attempt (email + timestamp only, never the password).
//   - on success: delete the entry.
```

### Patch M3 — E-Stop answers 423 on the social publish route (WS-C file: `backend/routes/social.js:241`)

```js
// Before:
return jsonError(result.failure?.rootCause || 'Publishing failed.', result.status === 'waiting_authorization' ? 423 : 502, { result, post: updated });
// After:
return jsonError(result.failure?.rootCause || 'Publishing failed.',
  result.status === 'waiting_authorization' || result.failure?.code === 'ESTOP' ? 423 : 502,
  { result, post: updated });
```

### Patch L3 — allowlist for `updatePost` (WS-C file: `backend/social/store.js`)

```js
const POST_UPDATABLE = new Set(['status', 'error', 'attempts', 'platform_post_id', 'published_at', 'caption', 'media_url', 'scheduled_for']);
// In updatePost(): replace `if (!/^[a-z_]+$/.test(key)) continue;`
// with `if (!POST_UPDATABLE.has(key)) continue;`
```

### Patch L4 — Delete cleans up its own rows (WS-A file: `backend/routes/admin-articles.js`, in `deleteArticle`)

```js
// After the articles DELETE, before returning:
await d1Run(env, 'DELETE FROM article_tags WHERE article_id = ?', [id]);
await d1Run(env, 'DELETE FROM article_sources WHERE article_id = ?', [id]);
// Keep article_revisions / fact_checks / seo_checks as history (by design).
```

## 5. Files changed + test evidence

| File | Change |
|---|---|
| `backend/routes/analytics.js` | New sections + coverage table + stale propagation + `latestCheckRows` allowlist (§2). `node --check` clean. |
| `tests/analytics-honesty.test.js` | **New, 20 tests.** |
| `tests/security-boundaries.test.js` | **New, 16 pass + 1 intentionally skipped** (H1 pin). |
| `docs/FS-AI-COMPLETION-WS-E-NOTES-2026-11-21.md` | This file. |

No other files touched. No `package.json` change. No migration
created or applied. No articles modified. No settings changed live.

Test runs (each file run alone, per the no-concurrent-full-suite rule):

```
node --test tests/analytics-honesty.test.js
  tests 20, pass 20, fail 0, skipped 0
node --test tests/security-boundaries.test.js
  tests 17, pass 16, fail 0, skipped 1 (H1 pin — see §3)
node --test tests/analytics-honesty.test.js tests/security-boundaries.test.js
  tests 37, pass 36, fail 0, skipped 1
```

Neighbouring-suite regression check (run after the analytics change,
sequential, not the full suite):

```
node --test tests/control-center.test.js tests/autonomy-analytics.test.js \
  tests/social-routes.test.js tests/social-dispatcher.test.js \
  tests/emergency-stop-toggle.test.js tests/auth.test.js
  tests 61, pass 61, fail 0, skipped 0
```

**Transient tree breakage observed (not caused by WS-E, resolved by
WS-A).** At ~08:20:52 Dhaka, while WS-E was verifying, a concurrent
WS-A edit to `backend/agents/autonomy/seo.js` left a broken import
(`from '../publishing/divisions.js'`, resolving to the non-existent
`backend/agents/publishing/divisions.js`) — `node --test
tests/security-boundaries.test.js` failed to load with
`ERR_MODULE_NOT_FOUND`. WS-A corrected the path to
`'../../publishing/divisions.js'` at ~08:21:55; the WS-E suites were
re-run immediately after and are green again (37 tests, 36 pass,
0 fail, 1 skipped). Final state verified at the end of this session.
No WS-E file was involved; WS-E did not touch `seo.js`. Lesson for
the coordinator: concurrent streams must not assume the tree is
green at any given minute — the merge-time full-suite run is the
gate that counts.

Baseline full suite (coordinator, 2026-11-21 14:10): 1106 pass / 0 fail.
WS-E adds 36 passing tests (37 with the 1 skip). The full suite was
**not** re-run by WS-E (other workstreams are running concurrently);
the coordinator must run `npm test` after merging all streams.

## 6. Deployment procedure inputs (WS-E area — for the parent)

Deploy is authorized for tonight, before the 2026-11-22 06:00 Dhaka
weekly run. WS-E does not deploy; these are the inputs the parent
needs from this area.

### 6.1 Migrations — verified present in this tree, in order

Files present: `database/migrations/001`–`023` (no 024–028 in this
tree). Migrations 016–019 are already live (019 live since
2026-11-20). **Apply live, in order: 020, 021, 022, 023.**

| # | File | What it creates | WS-E relevance |
|---|---|---|---|
| 020 | `020_task_lifecycle_health.sql` | `system_health_checks` + task terminal-state columns | Health endpoint returns real checks instead of `unknown` |
| 021 | `021_publication_logs.sql` | `publication_logs` | Auto-publish idempotency/rollback log |
| 022 | `022_social_media.sql` | `social_accounts`, `social_posts`, `social_analytics` | Social/engagement analytics sections flip from UNAVAILABLE to real D1 counts; social status endpoint works |
| 023 | `023_seo_body_hash.sql` | `seo_checks.body_hash` + `body_length` | SEO staleness by body hash |

Verify each after applying (SELECT from `sqlite_master` / a
`SELECT COUNT(*)` probe). The code degrades gracefully pre-migration
(missing tables → section `unavailable`, never a 500), but the new
features do not function without them. If WS-C/WS-D add migrations
024–028 in their streams, the coordinator must order the full set
before applying — WS-E verified only 001–023 in this tree.

### 6.2 Env secrets — exact set commands (parent executes)

No new secret is introduced by WS-E. One secret is **required
before any social use** (token encryption fails closed without it):

```bash
# SOCIAL_TOKEN_SECRET — long random string; obtain the VALUE from the
# owner through the Secure Vault flow. Never type it in chat, never
# commit it, never reuse SESSION_SECRET for it.
wrangler secret put SOCIAL_TOKEN_SECRET
```

Do **not** set `GROQ_API_KEY` or `GEMINI_API_KEY` (Workers AI only —
see finding M1). Verify the existing secrets are present without
rotating them during deploy: `SESSION_SECRET`,
`OWNER_PASSWORD_HASH`. (`wrangler secret list` shows names only —
never print values.) The D1 binding is `fs-ai-db`,
id `5043ece5-a853-433c-95f1-ee15a12b6b56` (a public identifier from
`config/wrangler.toml`, not a secret).

OAuth note: there is **no OAuth callback route** in this build
(`upsertAccount` has no callers). Social tokens can only enter D1 via
a direct, owner-authorized D1 write after the one-time per-platform
OAuth completes in the browser. Never paste a token into the dashboard
or chat; the parent performs the authorized D1 insert (or WS-C's
follow-up wires a callback with a `state` check first).

### 6.3 Rollback notes

- **Code rollback:** redeploy the previous Cloudflare Pages
  deployment / previous Worker version from the Cloudflare dashboard.
  No WS-E code change is irreversible.
- **D1 rollback:** migrations 020–023 are additive (`CREATE TABLE IF
  NOT EXISTS` + new columns). No rollback migration is needed; if the
  deploy is rolled back, the new tables simply sit unused and the old
  code degrades exactly as it does pre-migration. Do **not** drop the
  new tables on rollback — they hold no live data yet, and dropping
  risks deleting rows created after deploy.
- **If auto-publish was enabled after deploy**, set
  `publishing_mode` back to `approved_only` **before** rolling the
  code back, so no publish can fire mid-rollback.
- **E-Stop stays OFF** through deploy and rollback unless the parent
  deliberately toggles it for the §7 live check (and restores it).
- **Backup first:** take the owner backup (`POST
  /api/admin/backup/run` or the existing backup file
  `~/workspace/fs-ai-source/fs-ai-backup-20261121.tar.gz` — do not
  overwrite it) before deploy, per the standing deploy procedure.

### 6.4 Deploy-secrets audit (this workstream)

- Tree scan for secret patterns (API keys, JWTs, GitHub tokens,
  `sk-`/`gsk_`/`AIza`): **no hits**.
- `.env.example`: placeholders only (verified by character-shape
  check; all values lowercase hyphenated words). No `.env` file.
- No password, API key, access token or personal credential appears
  in code, tests, docs, or **this notes file**.
- `config/wrangler.toml` contains only the public D1 database id and
  non-secret vars.

## 7. Post-deploy verification checklist (WS-E area — parent runs)

Run after tonight's deploy, before the 06:00 weekly run where marked
`[pre-weekly]`. All calls owner-authenticated unless marked public.

1. `[pre-weekly]` **Routes respond.** `GET /api/health` (public) →
   200 `{status:'ok'}`. `GET /api/health/latest` (owner) → 200 with
   real component checks (not `unknown` — migration 020 applied).
   `GET /api/social/status` (owner) → 200, `connected: false` for
   every platform until OAuth.
2. `[pre-weekly]` **Analytics honesty live.** `GET
   /api/analytics/detail?section=all` (owner) → 200; every section has
   `{data, asOf, freshness}`; `coverage` present with `estimated: 0`;
   traffic / search / indexed / video / traffic-sources /
   impressions return `status: 'unavailable'`, `value: null` with a
   reason; `revenue` is VERIFIED `$0.00`. `GET /api/analytics`
   (public) → visitors `Data unavailable`, revenue `$0.00`.
3. `[pre-weekly]` **Dashboard renders.** Control Center loads; traffic
   shows "Data unavailable"; no platform claims "Connected"; YouTube
   panel shows "Browser session / Not API-connected" and contains no
   password field.
4. `[pre-weekly]` **Settings unchanged.** Live D1 read:
   `publishing_mode approved_only`, `auto_publishing off`,
   `auto_correction off`, `social_auto_post off`,
   `auto_research/generation/factcheck on`, `max_articles_per_day 1`,
   E-Stop `0`, revenue `$0.00`, published 25.
5. `[pre-weekly]` **Protected records unchanged.** #26 (4895 chars,
   `2026-11-19T18:53:30.327Z`), #27 (245 chars,
   `2026-11-19T18:53:32.930Z`), #31 draft (549 chars,
   `2026-11-21T01:19:10.364Z`); #28/#29/#30 still draft with the §1
   lengths.
6. **E-Stop path live (parent only, once, restore to OFF).**
   `POST /api/admin/emergency-stop {stopped:true}` → agent run
   answers 423; `POST {stopped:false}` → normal path; final live
   state **OFF** (`website_settings.emergency_stop = '0'`). Do not
   leave it ON into the weekly run.
7. **After the 2026-11-22 06:00 Dhaka weekly run (fires on the NEW
   code):** new `daily_reports` rows for 2026-11-22 (kinds `daily`
   AND `weekly`); published still 25; #26/#27/#31 unchanged (same
   lengths/updated_at as §1); queue drained per the new drain logic
   (oldest-first, 1/day content cap); nothing auto-published
   (`publishing_mode` still `approved_only`); E-Stop OFF; no new
   social posts (no OAuth yet).
8. **First live drain / first live social post (when authorized):**
   verify against the §3 E-Stop table and the §2 coverage table —
   counts from D1 only, never from the dashboard's word for it.

## 8. Blockers (exact)

1. **H1 (protected Delete/edit/publish guard) — blocked on WS-A.**
   The fix lives in `backend/routes/admin-articles.js`, owned by
   WS-A's Delete repair. WS-E cannot edit it; the exact patch is in
   §4 (Patch H1) and a skipped test pins the required behaviour.
   Until it lands, an owner session can delete #26/#27 with one
   dashboard click. Mitigation until fixed: do not use the dashboard
   Delete button on any protected article.
2. **H2 / M1 / M2 / M3 / L3 / L4 patches — blocked on owner files
   owned by other streams or the coordinator** (`worker.js`,
   `llm/registry.js`, `routes/auth.js`, `routes/social.js`,
   `social/store.js`, `routes/admin-articles.js`). Exact patches are
   in §4; none was applied by WS-E per the ownership rules.
3. **M1 (Groq/Gemini fallback) — needs a coordinator decision.**
   Removing them from the default order is a policy change; the
   patch is one line (§4) but the coordinator must confirm no
   live/approved use depends on it, then run
   `tests/autonomy-llm.test.js`.
4. **Full test suite — not re-run by WS-E.** Baseline 1106 pass /
   0 fail (coordinator 2026-11-21 14:10) + 36 new WS-E passes.
   Coordinator must run `npm test` after merging all workstreams;
   WS-E's own files + 6 neighbouring suites are green (§5).
5. **Live verification of the new analytics sections — blocked on
   deploy.** The `impressions` / `search` / `indexed` / `video` /
   `traffic-sources` sections and the coverage table are tested
   against real SQLite only. Their live behaviour (and the
   social/engagement flip once migration 022 is applied) must be
   confirmed by the §7 checklist after tonight's deploy.
6. **Weekly run on new code — untestable until it fires.**
   2026-11-22 06:00 Dhaka is the first live run of the new drain +
   weekly path. §7 item 7 is the verification; do not claim the
   weekly path works live before then.
7. **Transient tree breakage by a concurrent stream — OBSERVED AND
   RESOLVED, no action.** WS-A's `seo.js` edit at ~08:20:52 left a
   broken import (`../publishing/divisions.js`); WS-A fixed it at
   ~08:21:55 (`../../publishing/divisions.js`). WS-E suites re-ran
   green afterwards (see §5). Recorded so the coordinator knows the
   one red run during verification was not a WS-E regression.

## 9. Summary for the coordinator

- **Analytics verdicts:** 1 of 10 metrics VERIFIED live (revenue
  $0.00); 9 UNAVAILABLE with reason + path to availability; 0
  ESTIMATED (nothing estimates). Feedback loop verified read-only —
  analytics cannot change publishing policy.
- **Security findings:** 2 High (H1 protected-article guard missing;
  H2 no security headers + raw body HTML), 4 Medium (M1 Groq/Gemini
  fallback; M2 login lockout; M3 E-Stop 502-vs-423; M4 session
  no-revoke-all — accepted risk), 6 Low (L1–L6, two accepted risks,
  three patch-proposed, one accepted). **Fixed by WS-E:** 1
  (`latestCheckRows` table allowlist, in the owned analytics file).
  The rest are patch-proposed with exact patches in §4 (files owned
  by WS-A / WS-C / coordinator) or accepted risks with owner-visible
  reasons.
- **Files changed:** `backend/routes/analytics.js`,
  `tests/analytics-honesty.test.js` (new),
  `tests/security-boundaries.test.js` (new), this notes file.
- **Tests:** 36 pass / 0 fail / 1 skipped (the H1 pin) in WS-E's
  files; 61/61 pass in neighbouring suites.
- **Deploy inputs:** migrations 020–023 in order (§6.1);
  `wrangler secret put SOCIAL_TOKEN_SECRET` before any social use
  (§6.2); rollback notes (§6.3); post-deploy checklist (§7).
- **Nothing was published, deployed, or written to live D1 by WS-E.**
  Live E-Stop stays OFF. #26/#27/#28/#29/#30/#31 untouched.
