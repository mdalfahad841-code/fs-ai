# FS AI — Completion Workstream C Notes: Social Media Framework + Card Renderer

**Date:** 2026-11-21
**Author:** Workstream C (subagent session 75aed2b2)
**Scope:** master prompt §9 — complete the social integration framework
(Pinterest, Facebook Page, Instagram, LinkedIn own profile, YouTube
DO-NOT-USE-gated, X unavailable) + implement the missing reusable
social card renderer. Foundation: W4 (`docs/FS-AI-FULL-AUTONOMOUS-
IMPLEMENTATION-2026-11-21.md` §3.4/§13.2, `docs/SOCIAL-PLATFORMS-
2026-11-21.md`) — preserved, not rewritten.

**Status of this work:** code + tests complete locally, all green
(§8). NOT deployed, NOT live-verified, NO account connected, NO post
made. Deploy is authorized tonight by the owner (2026-11-21 14:12
override) and executed by the parent — this workstream did not
deploy, push, or write live D1.

## 0. Permanent restrictions (owner, binding)

- **$0 always.** No paid service, API, subscription, trial, or card
  anywhere in this workstream. Workers AI only.
- **Never publish #28/#29/#30/#31** without a separate editorial
  authorization for each article.
- **Health/Finance always need special human review** — never
  auto-publishable (enforced by the W3 gate, untouched here).
- **Never claim a social account connected or a post/video published
  without verification** (platform confirmation + verify-back where
  supported; no post id = no success).
- **Auto-publishing only for NEW articles passing EVERY gate**,
  one-per-day limit + E-Stop preserved; existing drafts excluded.
- **`social_auto_post` stays OFF** until at least one account is
  connected AND the parent enables it post-deploy.
- **YouTube Data API stays DO-NOT-USE** (Testing consent screen →
  uploads land PRIVATE; needs Production + Google audit first).
- **X stays UNAVAILABLE_FREE_TIER** (no free tier since Feb 2026;
  no adapter; dispatcher keeps refusing X with BLOCKED_WITH_REASON).

## 1. Per-platform status

| Platform | Status | What it means |
|---|---|---|
| Pinterest | IMPLEMENTED_AND_TESTED (code) / BLOCKED_BY_OWNER_AUTHORIZATION (live) | Adapter, dispatcher path, OAuth start/callback, refresh (30d access / 60d refresh), card renderer all implemented + tested with mocked platform calls and a real SQLite DB. Live: needs the owner's one-time OAuth (checklist §6.1) + Standard access for public pins. Trial pins are owner-visible only. |
| Facebook Page | IMPLEMENTED_AND_TESTED (code) / BLOCKED_BY_OWNER_AUTHORIZATION (live) | Same. Long-lived user token → Page token exchange implemented in both OAuth callback and refresh. Live: owner Meta app + Page-admin grant needed (checklist §6.2). Own Page in Dev mode needs NO App Review. |
| Instagram (Business/Creator) | IMPLEMENTED_AND_TESTED (code) / BLOCKED_BY_OWNER_AUTHORIZATION (live) | Same. Two-step container flow unchanged; long-lived token refresh implemented. Live: NO FS AI Instagram account exists yet — the owner must create/convert one first (checklist §6.3). Media must be a public HTTPS JPEG URL — the card file must be rendered + deployed first (§2). |
| LinkedIn (own profile) | IMPLEMENTED_AND_TESTED (code) / BLOCKED_BY_OWNER_AUTHORIZATION (live) | Same. Self-serve Share on LinkedIn, no review. **No refresh tokens exist for self-serve apps** — refresh is refused with WAITING_FOR_AUTHORIZATION and the owner re-OAuths every 60 days (surfaced, tested). Read-back is unavailable (`r_member_social` closed); publication is confirmed by the 201 creation response only, recorded honestly. Company Page posting is NOT implemented (vetted Community Management API, out of scope). |
| YouTube | IMPLEMENTED_NOT_LIVE_VERIFIED / DO-NOT-USE (gated) | Adapter exists (W4) and is verified by existing tests, but the dispatcher now REFUSES every YouTube post unless `YOUTUBE_DATA_API_ENABLED === 'true'` (new gate, §3), and token refresh is refused the same way. Manual browser-upload Shorts flow is untouched and remains the only YouTube path. Needs Production consent screen + Google audit before the flag may ever be set (checklist §6.5). |
| X (Twitter) | UNAVAILABLE_FREE_TIER | No adapter, no OAuth, no refresh. Dispatcher refuses with BLOCKED_WITH_REASON / PLATFORM_UNAVAILABLE and zero network calls (tested). Pay-per-use since Feb 2026 ($0.015/post, $0.20 with URL); starter credits need a card — violates the $0 rule. Re-check docs.x.com pricing before any revisit. |

**"Connected" rule (unchanged):** no platform is reported
`connected` until a real authorized account is verified
(`GET /api/social/status` requires a stored encrypted token + status
`connected` + unexpired token). Live D1 (read-only check 2026-11-21 ~14:15 Dhaka): **no `social_*`
tables exist yet** (migration 022 not applied live), `emergency_stop = 0`, no `social_auto_post` /
`publishing_mode` / `auto_publishing` rows (defaults apply: off /
approved_only). Articles live: 25 published, 6 drafts; #26–#31 all
still draft. Nothing in this workstream changes those rows.

## 2. Card renderer — design + honest capability verdict

**Verdict: IMPLEMENTED_AND_TESTED.** The W4 gap ("no rendered card
image exists in the repo") is closed. Two layers, one layout:

1. **SVG source of truth — `backend/social/card.js`** (pure JS,
   Workers-compatible, zero dependencies). `renderSocialCard({title,
   divisionSlug, divisionName, platform})` renders the FS AI pin
   design the owner already approved: single solid dark-navy
   background `#0A1527` (pixel-verified from the live
   `pin-bg-navy-1000x1500.jpg`), article title only, division label,
   FS AI brand + `fs-ai-5w5.pages.dev` footer. Sizes:
   Pinterest 1000×1500, Instagram 1080×1350 (4:5), Facebook
   1200×630, LinkedIn 1200×627. YouTube/X have no card (video-only /
   unavailable). Division accent colours are the live site's own
   plate colours (`frontend/scripts/app.js` DIVISIONS list).
2. **Rasterizer — `scripts/render-social-card.py`** (Pillow 10.2.0 +
   DejaVu fonts, both already present in this environment; no new
   package, no network, no paid service). Mirrors the SVG layout
   (same sizes, colours, margins, 100-char title truncation) and
   writes real PNG (default) / JPEG (Instagram) files:
   `python3 scripts/render-social-card.py --title "..." --platform
   pinterest --division-slug automotive --division-name Automotive
   --article-id 5 --out frontend/public/social-cards/`
   Verified live in this session: 1000×1500 PNG + 1080×1350 JPEG,
   navy centre pixel `(10,21,39)`, accent bar, byte-identical output
   across runs.

**Honesty rules (enforced by construction, pinned by tests):**
only the article's REAL title (verbatim, truncated only to the
100-char platform title limit with an ellipsis), the REAL division
name, and brand + site URL ever appear. No adjectives, no
superlatives, no invented claims, no numbers, no stock imagery.
Deterministic (no dates/randomness; djb2 fingerprint). Readable:
white-on-navy title contrast 18.27:1; every division label passes
WCAG 4.5:1 on navy (accent used only when it passes, else white).

**Remaining honest gap (not a blocker for the framework):** the
Worker cannot rasterize (no font rasterizer in Workers), so the PNG
is produced at publish-prep time by the local script and must be
deployed to `https://fs-ai-5w5.pages.dev/social-cards/article-<id>-
<platform>.png` (see `cardPublicUrl()`) BEFORE a Pinterest/Instagram
post can publish. The pack builder (`backend/agents/autonomy/
social.js`) now attaches that deterministic URL to media-required
drafts AND records the warning "Card image must be rendered …
and deployed to <url> before this post can publish" on the draft —
it never claims the file exists. `frontend/public/social-cards/`
does not exist yet; the parent creates it at deploy/publish time
(render the card, drop the file in, deploy Pages).

## 3. What was completed in the framework (beyond W4)

- **Token encryption (was already AES-256-GCM, kept):**
  `backend/social/tokens.js`, key from `SOCIAL_TOKEN_SECRET`,
  fail-closed, never logged. No change needed.
- **Token expiry monitoring (NEW — `backend/social/refresh.js`):**
  `tokenExpiryStatus()` → valid / expiring_soon (≤7d, configurable)
  / expired / unknown / not_connected; `listExpiringAccounts(env)`
  for the dashboard/health check (never includes a token).
- **Refresh-token handling (NEW — `backend/social/refresh.js`):**
  official flows only — Pinterest (new access 30d + new refresh
  60d), Facebook (fb_exchange_token → fresh Page token), Instagram
  (ig_refresh_token → new 60d long-lived token). LinkedIn: refused
  with WAITING_FOR_AUTHORIZATION (no refresh tokens, re-OAuth every
  60d). YouTube: refused unless `YOUTUBE_DATA_API_ENABLED='true'`.
  X: no refresh. Dispatcher preflight auto-refreshes an expired
  token **only when a refresh token is stored**; otherwise (or on
  refresh failure) it returns WAITING_FOR_AUTHORIZATION with zero
  platform publish calls. Refreshed tokens are re-encrypted and
  persisted via `store.updateAccountTokens()` (migration 027
  columns, with a fallback to the 022 columns on a pre-027 DB —
  tested).
- **OAuth state validation (NEW — `backend/social/oauth.js`):**
  stateless HMAC-SHA256-signed state (key = SOCIAL_TOKEN_SECRET),
  10-minute expiry, bound to one platform; tampered / wrong-platform
  / expired states are refused before any exchange.
- **OAuth routes (NEW — `backend/routes/social.js`):**
  `GET /api/social/oauth/:platform/start` (owner-only, returns the
  authorization URL + signed state), `GET /api/social/oauth/
  :platform/callback?code&state` (validates state, exchanges the
  code — incl. short→long-lived exchange for Facebook/Instagram and
  Page-token fetch for Facebook — encrypts + stores tokens, never
  returns one), `POST /api/social/accounts/:id/refresh`
  (owner-triggered refresh). The callback is the ONE social route
  exempt from the Bearer check inside `handleSocial` (a platform
  redirect carries no Bearer header; the signed state + single-use
  code is its auth — see §7 for the one-line `worker.js` exemption
  still needed for a live browser redirect).
- **Permission validation (NEW — `backend/social/oauth.js`):**
  `missingScopes()` / `hasRequiredScopes()` against the platform's
  required set. Surfaced advisorially in the verify route
  (`missingScopes` + `scopeWarning`); a working token still verifies
  true. Deliberately NOT a publish blocker: stored test/legacy scope
  sets are partial (e.g. the seeded Pinterest grant lacks
  `boards:write`), and blocking on them would break existing
  connected flows — the failure would surface at the first post that
  needs the missing scope, with the scope named.
- **Media validation (NEW — `backend/social/media.js`):**
  format + dimensions read from PNG IHDR / JPEG SOF headers (no
  decoder, Workers-compatible), per-platform size limits, Instagram
  JPEG-only + 4:5–1.91:1 aspect window, Pinterest ≥600px width.
  Dispatcher validates `mediaBytes` BEFORE any platform call
  (VALIDATION, 0 attempts). Adapters' existing content validation
  unchanged.
- **YouTube DO-NOT-USE gate (NEW — `backend/social/dispatcher.js`
  preflight):** YouTube posts are refused with
  PLATFORM_UNAVAILABLE unless `YOUTUBE_DATA_API_ENABLED === 'true'`
  (default off). The gate lives in the dispatcher — the single choke
  point — so no route, scheduler step, or pack builder can reach the
  adapter while it is off.
- **Publishing logs (unchanged, verified):** `social_posts` rows
  carry status/attempts/error/platform_post_id/platform_url/
  published_at; `social_analytics` stores only real platform
  metrics; reports say "Data unavailable" with no engagement rows.
- **Retry handling (unchanged, tested):** transient-only (429/5xx/
  network), exponential backoff 1s→2s→4s, max 3 attempts, then an
  honest failure with the real root cause (see §8).
- **Duplicate-post protection (unchanged, tested):** store-level
  idempotency key + dispatcher guard; force re-post only via explicit
  owner approval.
- **Owner-only authorization (unchanged, verified):** `requireOwner`
  in `handleSocial` AND in `backend/worker.js` (`/api/social/*`
  registered, owner-only — coordinator wiring, confirmed present).
  Tokens are never returned or logged by any route.

## 4. WS-E security patches applied (forwarded 2026-11-21)

Evidence: `docs/FS-AI-COMPLETION-WS-E-NOTES-2026-11-21.md` §3/§4.
Both applied in WS-C-owned files, both with new pinning tests (§8).

- **M3 (Medium) — E-Stop publish route answers 423, not 502.**
  `backend/routes/social.js` publish handler now maps
  `waiting_authorization` OR `failure.code === 'ESTOP'` → 423.
  (The WS-E test file's comment calls this finding "M10"; the WS-E
  notes table calls it M3 — same issue.) Test:
  `tests/social-failures.test.js` "E-Stop publish route answers 423"
  — E-Stop ON → 423, `failure.code === 'ESTOP'`, post stays
  `blocked`. WS-E's own `tests/security-boundaries.test.js` also
  passes (17 tests, 16 pass, 1 pre-existing skip, 0 fail).
- **L3 (Low) — `updatePost` column allowlist.**
  `backend/social/store.js` now uses `POST_UPDATABLE` instead of
  the regex-only filter. **Deviation from the WS-E patch, deliberate
  and recorded:** the WS-E allowlist omitted `platform_url`, but the
  dispatcher records the verified platform URL on every
  published/unverified post and the dispatcher tests pin that value
  (`saved.platform_url === 'https://www.pinterest.com/pin/pin-1/'`)
  — applying the patch verbatim would have silently dropped every
  published post's URL. The allowlist therefore keeps
  `platform_url`: `status, error, attempts, platform_post_id,
  platform_url, published_at, caption, media_url, scheduled_for`.
  Test: `tests/social-failures.test.js` "updatePost allowlist" —
  allowlisted columns (incl. `platform_url`) stored; `idempotency_key`,
  `created_at`, and an injection-shaped key silently ignored; table
  intact.

## 5. Files changed / added (WS-C ownership only)

**New:**
- `backend/social/card.js` — SVG card renderer (+ `cardPublicUrl`, `cardFileName`, contrast helpers)
- `backend/social/media.js` — image format/dimension/size/aspect validation
- `backend/social/oauth.js` — state signing/validation, authorization URLs, code exchange, scope checks
- `backend/social/refresh.js` — expiry monitoring + official refresh flows + YouTube gate
- `scripts/render-social-card.py` — Pillow rasterizer mirroring `card.js`
- `database/migrations/027_social_token_refresh.sql` — see §9
- `tests/social-card-renderer.test.js` (10 tests)
- `tests/social-token-expiry.test.js` (11 tests)
- `tests/social-failures.test.js` (17 tests, incl. OAuth routes, M3, L3, YouTube gate, 429/duplicates/media)

**Edited (owned):**
- `backend/social/dispatcher.js` — YouTube gate; expired-token auto-refresh in preflight; mediaBytes validation before publish
- `backend/social/store.js` — `updateAccountTokens()` (027-aware, pre-027 fallback); L3 allowlist in `updatePost()`
- `backend/social/index.js` — exports for card/media/oauth/refresh
- `backend/routes/social.js` — OAuth start/callback/refresh routes; verify reports `missingScopes`; callback exempt from Bearer check (state-is-auth, §7); M3 423 mapping
- `backend/agents/autonomy/social.js` — pack builder attaches deterministic card URLs + render warnings for media-required platforms

**NOT touched:** `package.json` (coordinator wires the migrate
list), live D1 (read-only SELECTs only), any other workstream's
files. Backup `~/workspace/fs-ai-source/fs-ai-backup-20261121.tar.gz`
untouched.

## 6. Exact per-platform connection workflows (owner-action checklists)

Prerequisites for ALL: `SOCIAL_TOKEN_SECRET` set as a Worker secret
(§9) and migration 022 (+027) applied live. The owner does each
step; the agent never types a password or clicks OAuth for him.
Redirect URI for every platform (register this exact URI in each
dev console):
`https://fs-ai-5w5.pages.dev/api/social/oauth/<platform>/callback`

### 6.1 Pinterest — account exists: "FS AI" @FS_AI, business account, website claimed
1. Owner opens https://developers.pinterest.com (logged in as the
   FS AI business account), creates a developer app, accepts the
   Developer Terms, requests **Trial access**.
2. Owner (dashboard, logged in as owner) opens
   `GET /api/social/oauth/pinterest/start`, opens the returned
   authorization URL, grants `boards:read, boards:write, pins:read,
   pins:write, user_accounts:read`.
3. Pinterest redirects to the callback (see §7 note); the app stores
   the encrypted access token (30d) + refresh token (60d). Verify:
   `POST /api/social/accounts/:id/verify` → `verified: true`.
4. Later, for PUBLIC pins (Trial pins are owner-visible only):
   request **Standard access** with a demo video of the app;
   Pinterest reviews it.
5. Upkeep: refresh runs automatically inside 60 days; if the refresh
   token expires, re-authorize (same flow). No fee, no card.

### 6.2 Facebook Page — Page exists (stopped 2026-11-13, superseded 2026-11-21 for automation)
1. Owner creates a Meta developer app at https://developers.facebook.com
   (Business use case), adds Facebook Login, sets the OAuth redirect
   URI above and a privacy policy URL.
2. Owner opens `GET /api/social/oauth/facebook/start`, logs in with
   Facebook, grants `pages_show_list, pages_manage_posts,
   pages_read_engagement` for the FS AI Page, as a Page admin.
3. The callback exchanges short-lived → 60-day long-lived user token
   → Page access token (`GET /me/accounts`) and stores the Page
   token. Verify with the verify endpoint.
4. No App Review is needed for the owner's own Page (app in
   Development mode, owner holds an app role). App Review + Business
   Verification only if the app ever posts to someone else's Page.
5. Upkeep: re-issue the Page token if invalidated; no expiry while
   the Page/admin link holds.

### 6.3 Instagram — NO FS AI Instagram account exists yet
1. Owner creates (or converts) an Instagram account to **Business
   or Creator** in the Instagram app. Personal accounts cannot use
   the API at all.
2. Owner creates a Meta app, adds the Instagram product, picks "API
   setup with Instagram login", sets the redirect URI above.
3. Owner opens `GET /api/social/oauth/instagram/start`, authorizes
   with `instagram_business_basic,
   instagram_business_content_publish` (Instagram Login path — NO
   Facebook Page needed).
4. The callback exchanges short-lived → 60-day long-lived token and
   stores it. Verify with the verify endpoint.
5. Upkeep: long-lived token lasts 60 days — refresh before expiry
   (automatic in preflight when a refresh token is stored).
6. Before the first post: render the card and deploy it so the
   public URL exists (§2) — Instagram takes a public HTTPS JPEG URL
   only.

### 6.4 LinkedIn — own profile (no FS AI company page exists)
1. Owner creates a LinkedIn developer app, adds the **Share on
   LinkedIn** product (self-serve, no review) and **Sign In with
   LinkedIn using OpenID Connect** (to get the person URN).
2. Owner opens `GET /api/social/oauth/linkedin/start`, authorizes
   with `w_member_social, openid, profile`; the app stores the person
   URN (`urn:li:person:{id}`) as the account id.
3. Upkeep: access token lasts 60 days — **re-OAuth every 60 days**
   (refresh tokens are only for approved Marketing Developer Platform
   partners; the system surfaces this as WAITING_FOR_AUTHORIZATION,
   it never silently fails).
4. Company Page posting is a separate, vetted step (Community
   Management API, registered organization, verified domain, Page
   super-admin verification) — NOT included; only the owner's own
   profile is implemented.

### 6.5 YouTube — DO-NOT-USE-YET (channel @FSAI-e5f exists; manual browser upload is the current flow)
1. **Do not switch the Shorts flow to the API yet.** Uploads stay
   PRIVATE until Google passes the API compliance audit, and
   Testing-status refresh tokens expire after 7 days.
2. When the owner decides to proceed (separate decision, not this
   workstream): create a Google Cloud project, enable YouTube Data
   API v3, create an OAuth client, publish the OAuth consent screen
   to **Production**, pass the Google audit, then authorize with
   `youtube.upload` scope for mdalfahad406@gmail.com.
3. Only after the audit passes may the parent set
   `YOUTUBE_DATA_API_ENABLED=true` (Worker secret/var) — the
   dispatcher gate and the refresh gate both read it.
4. Quota: 10,000 units/day; each upload costs 1,600 (≈6/day max);
   framework cap 2/day. Community posts cannot be automated at all
   (no API endpoint; channel needs 500 subscribers anyway).

### 6.6 X (Twitter) — UNAVAILABLE FREE OF COST
Do not connect X. No free tier for new developers since Feb 2026
(pay-per-use $0.015/post, $0.20 with a URL; starter credits need a
card + first purchase — card violates the $0 rule). If the owner ever
wants X, it needs an explicit paid decision and a card — not part of
this workstream.

## 7. Known gaps / proposed changes outside WS-C ownership

1. **Worker-level OAuth callback exemption (PROPOSED, not applied
   — `backend/worker.js` is the coordinator's file).**
   `handleSocial` now exempts `GET /api/social/oauth/*/callback`
   from its own Bearer check (the signed state token is that
   endpoint's auth), but `backend/worker.js:148` still runs
   `requireOwner` for ALL `/api/social/*` before calling
   `handleSocial` — so a live browser redirect from a platform
   would 401 before reaching the handler. Exact proposed change in
   `backend/worker.js`, before the existing social block:
   ```js
   const isSocialOAuthCallback = method === 'GET'
     && /^\/api\/social\/oauth\/[a-z]+\/callback$/.test(path);
   if (path.startsWith('/api/social/') && !isSocialOAuthCallback) {
     const auth = await requireOwner(request, env);
     if (!auth.ok) return auth.response;
     return handleSocial(request, env, ctx);
   }
   if (isSocialOAuthCallback) return handleSocial(request, env, ctx);
   ```
   (Adapt to the file's actual variable names; the existing block
   is at worker.js:148.) **Workaround until applied:** after the
   platform redirects, the owner copies the callback URL from the
   browser address bar and the parent/agent calls it once with an
   owner Bearer token (dashboard fetch / curl) — the exchange then
   runs exactly as tested.
2. **Observed, not mine (already fixed while I worked):**
   `backend/agents/autonomy/seo.js:39` imported
   `../publishing/divisions.js` (resolving to the non-existent
   `backend/agents/publishing/divisions.js`), which made
   `tests/social-routes.test.js` fail at load with
   `ERR_MODULE_NOT_FOUND` during this session. A concurrent
   workstream corrected it to `../../publishing/divisions.js`
   mid-session; the routes suite passes now (24/24 with the
   failures file). No action by WS-C; recorded because the failure
   was live in the tree during this workstream's test runs.
3. **Observed, not mine:** `tests/seo-checks.test.js` has 1 failure
   (10/11) — `internal-links` refuses the #12 link as not genuinely
   relevant. That is Workstream A's relevance rule asserting, not a
   social defect; left for its owner.
4. **Scope validation is advisory, not blocking** (§3) — by design,
   recorded here so nobody "fixes" it into a publish blocker.
5. **`frontend/public/social-cards/` does not exist yet** — created
   at deploy/publish time when the first card is rendered (§2).

## 8. Test evidence (all local, mocked platforms, real SQLite)

Run individually (never the full suite concurrently with other
workstreams — per brief):
- `node --test tests/social-card-renderer.test.js` — **10 pass / 0 fail**
  (specs, verbatim title, determinism, contrast ≥4.5:1 per division,
  100-char truncation, XML escaping, real 1000×1500 PNG + 1080×1350
  JPEG via Pillow, byte-identical re-renders)
- `node --test tests/social-token-expiry.test.js` — **11 pass / 0 fail**
  (expiry classification, refresh support map, Pinterest/Instagram
  refresh success + rotation + 60d refresh expiry, refresh failure
  keeps old tokens, LinkedIn refusal with 0 calls, YouTube gated
  refusal with 0 calls, pre-027 fallback, expiry report with no token
  leakage, dispatcher auto-refresh-then-publish, expired-without-
  refresh → WAITING_FOR_AUTHORIZATION with 0 calls)
- `node --test tests/social-failures.test.js` — **17 pass / 0 fail**
  (429 ×3 → rate_limited, backoff 1s→2s, attempts 3, no post id;
  network failure ×3; duplicate refusal; 201-with-no-id → PERMANENT;
  invalid media refused with 0 calls/0 attempts; YouTube gate with
  0 calls; OAuth state round-trip/tamper/wrong-platform/expired;
  scope checks; OAuth routes start/callback/refresh with mocked
  platform; M3 423; L3 allowlist)
- `node --test tests/social-adapters.test.js tests/social-dispatcher.test.js`
  (pre-existing W4) — **29 pass / 0 fail** (unchanged behaviour)
- `node --test tests/social-routes.test.js` (pre-existing W4) —
  **9 pass / 0 fail** (exact status-contract keys preserved)
- `node --test tests/security-boundaries.test.js` (WS-E) —
  **16 pass / 0 fail / 1 pre-existing skip** (ESTOP route behaviour
  pinned; M3 423 covered by the new WS-C test above)
- Combined run of all 7 files (WS-C 3 + W4 3 + WS-E 1):
  **93 tests, 92 pass / 0 fail / 1 pre-existing skip** (the skip is
  in `tests/security-boundaries.test.js`, not a WS-C test).
- `node --check` clean on every changed JS file. Migration 027
  verified to apply on real SQLite (schema + seed + 022 + 027;
  `social_accounts` gains `refresh_token_expires_at`,
  `token_refreshed_at`).
- **Not tested live:** no real platform was ever called, no real
  OAuth completed, no real post published, no live D1 write was made
  by this workstream. Live verification is post-deploy (§10).

## 9. Deployment procedure inputs (for the parent — DO NOT run by WS-C)

### 9.1 Migrations (ordered; coordinator adds to `package.json` `db:migrate`)
1. `database/migrations/022_social_media.sql` — **already in the
   tree (W4), NOT yet applied live** (verified: no `social_*` tables
   in live D1). Apply first.
2. `database/migrations/027_social_token_refresh.sql` — **new (WS-C)**.
   Verified free in this tree (024/025/026 do not exist here; if
   other workstreams claim 024–026, 027 stays as assigned). Additive
   only: two columns on `social_accounts`. Code tolerates a pre-027
   DB (fallback in `updateAccountTokens`), but apply it — expiry
   monitoring needs `refresh_token_expires_at`.
   Verify after applying (read-only):
   `SELECT name FROM pragma_table_info('social_accounts');`
   must include `refresh_token_expires_at`, `token_refreshed_at`.
   Rollback: the two columns are unused by any pre-027 code path
   (fallback covers it); dropping them is safe but unnecessary —
   leaving them is harmless. There is no data to roll back (no live
   social rows exist).

### 9.2 Worker secrets (exact commands — parent runs; values never in chat/files)
Generate the token secret first (any shell):
```sh
openssl rand -base64 48
```
Then, from `~/workspace/fs-ai-source/fs-ai/`:
```sh
npx wrangler secret put SOCIAL_TOKEN_SECRET --config config/wrangler.toml
# paste the generated value when prompted. This ONE secret signs OAuth
# states AND encrypts every stored social token (AES-256-GCM). If it
# is ever rotated, all stored social tokens become undecryptable and
# every account must re-OAuth — there is no recovery path by design.
# NEVER commit it, never put it in wrangler.toml [vars], never log it.
```
Per-platform OAuth client credentials — set ONLY when the owner
starts that platform's connection (§6); each is a separate secret:
```sh
npx wrangler secret put PINTEREST_CLIENT_ID --config config/wrangler.toml
npx wrangler secret put PINTEREST_CLIENT_SECRET --config config/wrangler.toml
npx wrangler secret put FACEBOOK_APP_ID --config config/wrangler.toml
npx wrangler secret put FACEBOOK_APP_SECRET --config config/wrangler.toml
npx wrangler secret put INSTAGRAM_CLIENT_ID --config config/wrangler.toml
npx wrangler secret put INSTAGRAM_CLIENT_SECRET --config config/wrangler.toml
npx wrangler secret put LINKEDIN_CLIENT_ID --config config/wrangler.toml
npx wrangler secret put LINKEDIN_CLIENT_SECRET --config config/wrangler.toml
# YouTube client id/secret ONLY if/when the audit path (§6.5) is ever approved:
npx wrangler secret put YOUTUBE_CLIENT_ID --config config/wrangler.toml
npx wrangler secret put YOUTUBE_CLIENT_SECRET --config config/wrangler.toml
```
Optional non-secret var (defaults to `https://fs-ai-5w5.pages.dev`
when absent — no change needed unless the deploy uses another
origin): `SOCIAL_OAUTH_REDIRECT_BASE` in `config/wrangler.toml`
`[vars]`.
**Do NOT set** `YOUTUBE_DATA_API_ENABLED` (leave unset = off).
`social_auto_post` stays `off` (no live row; default applies) until
accounts are connected and the parent enables it post-deploy.

### 9.3 Deploy order / rollback notes
- Deploy code + migrations 022/027 + `SOCIAL_TOKEN_SECRET` together.
  Without the secret, token storage and OAuth state fail closed
  (clear errors, no plaintext fallback) — the site still works, the
  social routes answer 503 for token operations.
- The weekly run (2026-11-22 06:00 Dhaka) fires on the new code:
  the social pack builder writes DRAFT `social_posts` rows for
  published articles (never publishes) once 022 is applied; with
  `social_auto_post` off and no accounts connected, nothing posts.
  Draft rows carry the card-render warning (§2) until cards exist.
- Rollback: redeploy the previous build; social tables/columns can
  stay (additive, no live rows yet). No protected data is touched by
  this workstream. E-Stop stays OFF; no setting is flipped by this
  deploy.

## 10. Post-deploy verification steps (WS-C area)

Run these after deploy, before any owner OAuth (parent executes;
WS-C cannot — no browser/live-write access):
1. `GET /api/social/status` (owner) → 6 platforms, all
   `connected: false`, `classification` per §1, no token fields.
2. Apply-check (read-only D1): `social_accounts`,
   `social_posts`, `social_analytics` exist; `social_accounts` has
   `refresh_token_expires_at` + `token_refreshed_at`.
3. `GET /api/social/oauth/pinterest/start` without client id → 503
   (not a broken URL); after setting the Pinterest client id → 200
   with a `pinterest.com/oauth/` URL containing a state.
4. Render one card and deploy it:
   `python3 scripts/render-social-card.py --title "<real article
   title>" --platform pinterest --division-slug <slug>
   --division-name "<name>" --article-id <id> --out
   frontend/public/social-cards/` → file served at
   `https://fs-ai-5w5.pages.dev/social-cards/article-<id>-pinterest.png`
   (HTTP 200, 1000×1500).
5. After the owner completes ONE platform's OAuth (§6): verify
   endpoint → `verified: true`, `missingScopes: []`; status shows
   that platform `connected: true` with a future `tokenExpiresAt`.
   Do NOT publish a test post to a real platform as a "test" — the
   first real post is a real article post, owner-approved.
6. Confirm `social_auto_post` is still `off` and E-Stop is OFF.
7. Confirm #26–#31 are still draft and the published count is
   still 25 (this workstream publishes nothing).
8. First weekly run on the new code (2026-11-22 06:00): check the
   daily report for social draft rows created (draft only) and zero
   publish attempts (no accounts → dispatcher refuses before any
   platform call).

## 11. Exact blockers (what stops live use, and who unblocks it)

1. **Owner one-time OAuth per platform** (§6) — blocks every live
   connection. Unblocked by: the owner, one click-flow per platform.
2. **Worker.js OAuth-callback exemption** (§7.1) — blocks the live
   browser-redirect callback flow (workaround documented). Unblocked
   by: the coordinator (one-line change in a file WS-C does not own).
3. **Pinterest Standard access** — blocks PUBLIC pins (Trial pins are
   owner-visible only). Unblocked by: owner demo-video review.
4. **Instagram account does not exist** — blocks all Instagram use.
   Unblocked by: owner creates/converts a Business/Creator account.
5. **Card PNG deployment** — blocks Pinterest/Instagram publishing
   (media-required). Unblocked by: parent renders + deploys the card
   file (§2, §10.4).
6. **YouTube audit + Production consent screen** — blocks any API
   upload. Unblocked by: owner/Google audit decision; not this
   workstream's call.
7. **X** — blocked permanently under the $0 rule (UNAVAILABLE_FREE_TIER).
