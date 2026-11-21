# FS AI — Social Platforms Research Matrix (2026-11-21, W4)

Researched from official developer documentation (linked per platform)
plus current third-party guides that cite those docs, 2026-11-21.
**Nothing in this file claims a platform is operational.** Every
platform still needs the owner's one-time OAuth; all live tests stay
WAITING FOR OWNER AUTHORIZATION until he completes the steps in
"Owner authorization needed" per platform.

Classification is about the OFFICIAL API itself:
- **SUPPORTED FREE** — official API posts for free (own-account path).
- **LIMITED FREE** — official API posts for free, but with a hard caveat.
- **UNAVAILABLE FREE OF COST** — no free official posting path (paid only).

## Matrix

| Platform | Classification | Free posting? | Publish endpoint | Scopes / permissions | OAuth / review | Token lifetime | Rate / quota limits | Content types | Media |
|---|---|---|---|---|---|---|---|---|---|
| Pinterest | SUPPORTED FREE | Yes — no fee; Trial access on app approval (pins owner-visible only), Standard after demo-video review | POST /v5/pins | boards:read, boards:write, pins:read, pins:write, user_accounts:read | Business account + app approval; Standard needs demo video | Access 30 days; refresh 60 days | org_write: 300/day Trial, 100/min Standard; framework cap 10/day | Image pin, carousel (2–5), video | Required; PNG/JPEG ≤20 MB, 2:3 (1000×1500) recommended; URL or base64 |
| Facebook Page | SUPPORTED FREE | Yes — no fee | POST /{page-id}/feed, /photos, /videos (Graph API v26.0) | pages_show_list, pages_manage_posts, pages_read_engagement | Own Page + app in Dev mode: NO App Review; Advanced Access (other Pages) needs App Review + Business Verification (free) | User token 1–2h → 60-day long-lived → Page token (effectively non-expiring while Page/admin link holds) | No published daily post cap; framework cap 25/day | Text, link, photo, video | Optional (text/link need none) |
| Instagram | SUPPORTED FREE | Yes — no fee | POST /{ig-user-id}/media → poll → POST /{ig-user-id}/media_publish (Graph API v26.0) | Instagram Login: instagram_business_basic, instagram_business_content_publish (Facebook Login: instagram_basic, instagram_content_publish + pages_*) | Business/Creator account required; App Review for Advanced Access; own account in dev mode works | Long-lived user token 60 days | 25 API-published posts/24h is the lowest published figure (sources also say 50 / 100 — framework uses 25); containers expire 24h after creation | Image, carousel (≤10), Reel, Story | Required; PUBLIC HTTPS URL only (no upload in body); JPEG ≤8 MB, 4:5–1.91:1; Reels 3s–15min ≤300 MB |
| LinkedIn (own profile) | SUPPORTED FREE | Yes — no fee per call | POST /rest/posts (LinkedIn-Version YYYYMM) | w_member_social (+ openid, profile for the person URN) | Self-serve "Share on LinkedIn" product — NO review | Access 60 days; refresh tokens only for approved Marketing Developer Platform partners — self-serve re-OAuth every 60 days | 150/member/day, 100,000/app/day; framework cap 25/day | Text, article link, image | Optional; images via 2-step asset upload (initializeUpload → PUT bytes) |
| LinkedIn (Company Page) | LIMITED FREE | Yes, but vetted | POST /rest/posts as urn:li:organization:{id} | w_organization_social (Community Management API) | Vetted: registered org, verified domain/email, Page super-admin verification; Development tier 500/app/day, 100/member/day; 12 months to apply for Standard | Same 60-day access token | Development tier 500/app/day, 100/member/day | Text, article, image, video, document | Optional |
| YouTube | LIMITED FREE | Yes — quota-capped, no money | videos.insert (multipart/resumable upload, Data API v3) | youtube.upload, youtube | Google Cloud project + OAuth consent screen; audit/quota-extension for public uploads | Refresh token; 7-day expiry while consent screen is in Testing — publish app to Production for long-lived tokens | 10,000 units/day/project; videos.insert = 1,600 (≈6/day max); framework cap 2/day | Video upload ONLY | Required — video BYTES (API takes no URL); no community-post endpoint exists |
| X (Twitter) | UNAVAILABLE FREE OF COST | **No** — pay-per-use since Feb 2026 for new developers: $0.015/post, $0.20/post with a URL, $0.005/post read | POST /2/tweets (would-be) | tweet.read, tweet.write, users.read, offline.access | Pay-per-use account + prepaid credits; $20 starter credits only after saving a card + first purchase (card requirement violates the FS AI $0 rule) | OAuth 2.0 user token | Per-endpoint 15-min windows on top of per-call billing; 3M post reads/month cap | Text (280 chars), image, video | Optional |
| WhatsApp Business | OUT OF SCOPE (stopped) | — | — | — | Owner stopped 2026-11-13; superseded for social automation 2026-11-21, but no WhatsApp posting adapter is built in W4 (Cloud API is for messaging, not article distribution) | — | — | — | — |

## Sources

- Pinterest API v5 docs: https://developers.pinterest.com/docs/api/v5/ and auth: https://developers.pinterest.com/docs/getting-started/authentication/
  - Guides checked 2026-11-21: https://socialhelper.app/blog/pinterest-api, https://getcastforge.com/blog/pinterest-api-v5-create-pins, https://bundle.social/blog/pinterest-pin-api, https://www.pinbridge.io/blog/pinterest-api-guide/
- Facebook Pages API: Meta for Developers, Permissions Reference + Pages API (Graph API v24.0/v26.0)
  - Guides checked 2026-11-21: https://www.outstand.so/blog/facebook-api, https://singhamandeep.com/facebook-page-api-permissions-app-review/, https://www.creatoros.ca/blog/facebook-graph-api-page-posting-without-app-review/
- Instagram Graph API / Instagram Platform: Meta for Developers — Instagram Platform overview + Content Publishing
  - Guides checked 2026-11-21: https://www.postzen.dev/blog/instagram-api-integration-guide, https://bundle.social/blog/instagram-posting-api, https://www.outstand.so/instagram, https://robotsonpayroll.com/resources/instagram-autoposter
- YouTube Data API v3 quota (official): https://developers.google.com/youtube/v3/determine_quota_cost/ — 10,000 units/day default, videos.insert 1,600
  - Guides checked 2026-11-21: https://outlierkit.com/resources/youtube-api-quota/, https://rustman.org/wiki/youtube-channels-from-terminal/
- LinkedIn Share on LinkedIn / Posts API: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
  - Guides checked 2026-11-21: https://dev.to/frandeveloper/is-the-linkedin-api-free-pricing-and-posting-access-in-2026-4im9, https://www.blotato.com/blog/linkedin-posting-api, https://social-sdk.dev/guides/linkedin-posts-api, https://socialhelper.app/blog/linkedin-api
- X API pricing: https://docs.x.com/x-api/getting-started/pricing — **could not be fetched directly on 2026-11-21 (domain blocked by the sandbox fetch policy)**; the pay-per-use finding rests on multiple independent Sep–Nov 2026 sources that agree and cite docs.x.com:
  - https://www.outstand.so/blog/x-api-pricing, https://www.twitterapis.com/blogs/is-twitter-api-free, https://scrapeio.com/blog/is-the-x-twitter-api-free
  - Conflict noted honestly: older pages still list the legacy Free tier (500–1,500 posts/month, e.g. https://aetherhq.dev/x-api, https://xcrop.io/blog/x-api-pricing-comparison-2026). Those figures predate the Feb 2026 pay-per-use launch. Re-check docs.x.com before any revisit.

## What is implemented (this workstream)

- `backend/social/` — platform registry (`platforms.js`), content builders (`content.js`), AES-GCM token encryption (`tokens.js`), D1 store (`store.js`), dispatcher with pre-flight + safe retry + verify-back (`dispatcher.js`), adapters: `adapters/pinterest.js`, `adapters/facebook.js`, `adapters/instagram.js`, `adapters/linkedin.js` (member posts only), `adapters/youtube.js`. **No X adapter** — the dispatcher refuses X with BLOCKED_WITH_REASON / PLATFORM_UNAVAILABLE.
- `backend/routes/social.js` — owner-only routes (NOT registered in worker.js; see snippet below).
- `database/migrations/022_social_media.sql` — `social_accounts`, `social_posts`, `social_analytics`.
- `backend/agents/autonomy/social.js` — pack builder now also writes DRAFT `social_posts` rows (never publishes) when migration 022 is applied; missing tables are reported, not fatal.
- Tests: `tests/social-adapters.test.js`, `tests/social-dispatcher.test.js`, `tests/social-routes.test.js` — all offline, mocked fetch, real SQLite.

## Known gaps (not hidden)

1. **No rendered card image exists in the repo.** FS AI pins are text-only on a dark-navy background by design, but that design is a rendered IMAGE — the APIs cannot draw it. Pinterest and Instagram adapters accept a pre-rendered card via `mediaUrl` (public HTTPS URL) or `mediaBase64` (Pinterest only) and refuse without media. A card-image renderer (or reusing the manual pin tool's output) is still needed before the first real Pinterest/Instagram post.
2. **Instagram needs a public image URL.** The FS AI site can host the card image (it is public), but nothing uploads it there yet.
3. **YouTube adapter is future-only.** FS AI Shorts are published by manual browser upload — that flow is untouched. API uploads from an unaudited project land PRIVATE, and Testing-status tokens die after 7 days. Do not switch to the API until the Google audit passes.
4. **LinkedIn read-back is impossible for self-serve apps** (`r_member_social` is closed). Publication is confirmed by the 201 creation response only, recorded honestly as such.
5. **Instagram daily limit is disputed** (25 vs 50 vs 100 per 24h across sources). The framework enforces the lowest figure (25).
6. **X pricing could not be verified against the official page directly** (fetch blocked in this environment). The UNAVAILABLE classification follows the consensus of Sep–Nov 2026 sources; re-check before any revisit.

## Owner authorization needed (per platform)

All of these are ONE-TIME owner actions. Nothing below is done by the agent — connecting an account needs the owner's own click/approval.

### Pinterest (account already exists: "FS AI" @FS_AI, business account, website claimed)
1. Owner (or agent with owner present) creates a Pinterest developer app at developers.pinterest.com (business account login, accept Developer Terms) and requests **Trial access**.
2. Owner authorizes the app with scopes `boards:read, boards:write, pins:read, pins:write, user_accounts:read` (OAuth code flow) and the app exchanges the code for an access token (30 days) + refresh token (60 days).
3. Later, for PUBLIC pins (not just owner-visible): request **Standard access** with a demo video of the app — Pinterest reviews it.
4. Token upkeep: refresh inside 60 days or re-authorize. No App Review fee, no card.

### Facebook Page (Page exists; stopped 2026-11-13, superseded 2026-11-21 for automation)
1. Owner creates a Meta developer app at developers.facebook.com (Business use case), adds Facebook Login, sets the OAuth redirect URI and a privacy policy URL.
2. Owner logs in with Facebook and grants `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` for the FS AI Page, as a Page admin.
3. Exchange the short-lived user token for a 60-day long-lived token, then fetch the Page access token (`GET /me/accounts`). No App Review is needed for the owner's own Page (app in Development mode, owner holds an app role). App Review + Business Verification only if the app ever posts to someone else's Page.
4. Token upkeep: re-issue the Page token if it is invalidated; no expiry while the Page/admin link holds.

### Instagram (no FS AI Instagram account exists yet)
1. Owner creates (or converts) an Instagram account to **Business or Creator** in the Instagram app. Personal accounts cannot use the API at all.
2. Owner creates a Meta app, adds the Instagram product, picks "API setup with Instagram login", sets the redirect URI.
3. Owner authorizes with scopes `instagram_business_basic, instagram_business_content_publish` (Instagram Login path — NO Facebook Page needed). A Facebook Page link is only needed if the Facebook Login path is chosen instead.
4. Token upkeep: long-lived token lasts 60 days — refresh before expiry. App Review only for Advanced Access (posting for accounts the owner does not own).

### LinkedIn (own profile — no FS AI company page exists)
1. Owner creates a LinkedIn developer app, adds the **Share on LinkedIn** product (self-serve, no review) and **Sign In with LinkedIn using OpenID Connect** (to get the person URN).
2. Owner authorizes with scopes `w_member_social, openid, profile`; the app stores the person URN (`urn:li:person:{id}`) as the account id.
3. Token upkeep: access token lasts 60 days — **re-OAuth every 60 days** (refresh tokens are only for approved Marketing Developer Platform partners).
4. Company Page posting is a separate, vetted step (Community Management API, registered organization, verified domain, Page super-admin verification, Development tier 500 calls/app/day) — NOT included in W4; only the owner's own profile is implemented.

### YouTube (channel @FSAI-e5f exists; manual browser upload is the current flow)
1. Owner creates a Google Cloud project, enables **YouTube Data API v3**, creates an OAuth client, and authorizes with `youtube.upload` scope for the mdalfahad406@gmail.com account.
2. **Do not switch the Shorts flow to the API yet.** Uploads stay PRIVATE until Google passes the API compliance audit, and Testing-status refresh tokens expire after 7 days. Publish the OAuth consent screen to Production and pass the audit first.
3. Quota: 10,000 units/day; each upload costs 1,600 (≈6/day max). No paid tier exists — more quota needs the extension form + audit.
4. Community posts cannot be automated at all — there is no API endpoint (and the channel needs 500 subscribers for community posts anyway).

### X (Twitter) — UNAVAILABLE FREE OF COST
- No free tier for new developers since Feb 2026. Posting costs $0.015/post ($0.20 with a URL) on pay-per-use, and starter credits require saving a card + a first purchase — a card requirement violates the FS AI $0 rule. **Do not connect X.** If the owner ever wants X, it needs an explicit paid decision and a card — not part of this workstream.

## Route registration snippet (for the coordinator — worker.js, NOT applied here)

```js
import { handleSocial } from './routes/social.js';
// ... inside route(): requireOwner is enforced inside handleSocial itself.
// Add before the final 404, alongside the other /api/* owner routes:
if (path.startsWith('/api/social/')) return handleSocial(request, env);
```

## Autonomy-settings note (for the coordinator — orchestrator.js, NOT applied here)

`backend/routes/orchestrator.js:136` currently rejects any
`social_auto_post` value other than `'off'` ("no social API auth
exists"). That validator is now out of date: the framework exists, but
auto-posting must stay OFF until the owner connects at least one
account AND explicitly enables it. Suggested change (coordinator's
file, do not apply silently): allow `'off' | 'draft_only' | 'on'` with
`'on'` permitted only as an explicit owner choice, and keep `'off'`
the default. The social routes themselves never auto-publish:
`POST /api/social/posts` is draft-only, and publishing happens only
via the explicit `POST /api/social/posts/:id/publish` owner action
(or a future scheduler step the owner enables).
