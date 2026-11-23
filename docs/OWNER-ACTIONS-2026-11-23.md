# FS AI — Owner Actions (2026-11-23)

**Date:** 2026-11-23
**What this is:** the only things left that ONLY you (the owner) can do.
Everything technical is done. This document tells you what to do, step by
step, and what you should see after each step.
**This document does nothing by itself.** No account was connected, no
article was published or edited, no setting was changed, no cron was
touched while writing it.

**Sources:** the close-out ledger (`docs/CLOSEOUT-LEDGER-2026-11-23.md`),
the Shorts checklist (`docs/CLOSEOUT-C4-SHORTS-READINESS-2026-11-23.md`),
the Long #08 v2 upload sheet (`docs/UPLOAD-SHEET-Long-08-v2.md`), the
login-unlock doc (`docs/CLOSEOUT-B3-OWNER-UNLOCK-2026-11-23.md`), and
live read-only D1 checks run on 2026-11-23 (~12:30 Dhaka) for §3.
Anything marked **NOT VERIFIED** was not checked — do not treat it as fact.

**Rules that apply to the whole pack:**
- Connecting any account needs your one-time OAuth. The agent never
  connects an account for you.
- No secret value (token, password, client secret, API key) is written
  in this document. When a step needs a secret, give it to the agent in
  chat when it asks — it stores it as a Worker secret and never puts it
  in code or in any document.
- If you get locked out of the dashboard (5 wrong passwords = 15-minute
  lock), see `docs/CLOSEOUT-B3-OWNER-UNLOCK-2026-11-23.md`: wait 15
  minutes, or ask the agent to delete the lockout row. A session that is
  already signed in keeps working during a lockout.

---

## 1. Social OAuth — Pinterest / Facebook / Instagram / LinkedIn

**Status: nothing connected yet.** Live setting `social_auto_post` is
`off` (verified from live D1, 2026-11-23). It stays OFF until you enable
it after a successful test post (§1.6).

**The callback URL (same for all four platforms — verified in
`backend/social/oauth.js:103-105`):**

```
https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/<platform>/callback
```

Replace `<platform>` with `pinterest`, `facebook`, `instagram`, or
`linkedin`. Do NOT use the Pages address
(`fs-ai-5w5.pages.dev`) as the callback — Pages returns 404 for
`/api/*` paths. The Worker address above is the one the code uses.

**The Connect step (same for all four platforms):**

1. Finish the platform's app setup below (steps 1–3 in each subsection).
2. Give the client ID and client secret to the agent when it asks. The
   agent stores them as Worker secrets (never in code, never in chat
   history beyond your message). Secret names (from
   `backend/social/oauth.js:94-99`): Pinterest
   `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET`; Facebook
   `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`; Instagram
   `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET`; LinkedIn
   `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.
3. While signed in to the FS AI dashboard as Owner, open this URL in
   your browser (replace `<platform>`):
   `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/<platform>/start`
4. The page returns a JSON reply with an `authorizationUrl`. Open that
   URL **within 10 minutes** (the state token expires after 10 minutes).
5. On the platform's page, sign in with the account you want connected
   and grant the scopes listed for that platform below.
6. The platform sends you back to the callback URL. The Worker exchanges
   the code, encrypts the tokens, and stores them. You should see a
   success reply.
7. Expected result: dashboard → Control Center → Social shows that
   platform as **connected** with the account name. If it still shows
   "not connected", tell the agent the exact error text — do not retry
   the same link after the 10 minutes have passed; ask the agent for a
   fresh start URL.

### 1.1 Pinterest

1. Go to the Pinterest developers site and create an app.
2. In the app settings, add this redirect URI exactly:
   `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/pinterest/callback`
3. Note the app's client ID and client secret (step 2 of the common
   flow above).
4. Scopes the Worker asks for (from `backend/social/platforms.js`):
   `boards:read`, `boards:write`, `pins:read`, `pins:write`,
   `user_accounts:read`.
5. Expected result after Connect: dashboard shows Pinterest connected.
   Tokens last 30 days (access) / 60 days (refresh) — refresh inside
   60 days or re-OAuth.
6. **Trial access warning:** a new Pinterest app starts on Trial access
   — its Pins are visible to you only. Standard access (Pins visible to
   everyone) needs a demo-video review by Pinterest. The test post in
   §1.6 will be owner-visible only until Standard access is granted.

**Do NOT remove this line from the site:** the Pinterest website is
already CLAIMED. `frontend/index.html` line 11 carries the verification
tag:

```html
<meta name="p:domain_verify" content="8809cf58fdce34599cf8a76611cf5e1c"/>
```

That tag must STAY. If it is removed, the website claim is lost.

### 1.2 Facebook

1. Go to Meta for Developers and create an app.
2. In the app settings, add this redirect URI exactly:
   `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/facebook/callback`
3. Note the App ID and App Secret (step 2 of the common flow above).
4. Scopes the Worker asks for: `pages_show_list`,
   `pages_manage_posts`, `pages_read_engagement`.
5. **You need a Facebook Page first.** The Worker posts to Pages only —
   apps cannot publish to personal timelines (since 2018). Your own
   Page in Development mode works with no App Review (you must be an
   admin/developer on the app). If you have no Page, create one first;
   the Page setup was stopped on 2026-11-13 on your order, so this is a
   separate decision by you.
6. Expected result after Connect: dashboard shows Facebook Page
   connected. The Page token is effectively non-expiring while the
   Page/admin link holds.

### 1.3 Instagram

1. Go to Meta for Developers and create an app (same Meta app as
   Facebook can be used).
2. In the app settings, add this redirect URI exactly:
   `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/instagram/callback`
3. Note the client ID and client secret (step 2 of the common flow
   above).
4. Scopes the Worker asks for: `instagram_business_basic`,
   `instagram_business_content_publish`.
5. **You need a Business or Creator Instagram account.** The Instagram
   Login path needs NO Facebook Page. The account must be Business or
   Creator — a personal account cannot connect.
6. Expected result after Connect: dashboard shows Instagram connected.
   Token lasts 60 days — refresh before expiry or re-OAuth.
7. Note: Instagram posts need media (a public HTTPS image/video URL).
   Text-only posts are not possible.

### 1.4 LinkedIn

1. Go to the LinkedIn developers site and create an app.
2. In the app settings, add the **"Share on LinkedIn"** product, then
   add this redirect URI exactly:
   `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/linkedin/callback`
3. Note the client ID and client secret (step 2 of the common flow
   above).
4. Scopes the Worker asks for: `w_member_social`, `openid`, `profile`.
5. **Member (personal profile) posts only.** Company Page posting needs
   a vetted API that is out of scope — the Worker does not implement it.
6. Expected result after Connect: dashboard shows LinkedIn connected.
   Token lasts 60 days. There is no refresh token for self-serve apps —
   re-OAuth every 60 days.

### 1.5 X — stays unavailable (no free posting path)

Do not try to connect X. There is no free tier for new developers:
posting is pay-per-use ($0.015 per post, $0.20 per post with a URL),
and the starter credits need a saved card plus a first purchase — a
card requirement breaks the FS AI $0 rule. The Worker refuses X with
BLOCKED_WITH_REASON. (Source: `backend/social/platforms.js`, X entry.)

### 1.6 Test with ONE post, then enable auto-post

Do this separately for EACH platform you connect:

1. Ask the agent to publish **one** test post to that platform only
   (one article link).
2. Open the platform yourself and check the post is really there.
3. Expected result: the post is visible on the platform, with the
   correct article link.
4. Only after the test post works, enable auto-posting: dashboard →
   Autonomy settings → **Social auto-post** → set to `on`.
   (Allowed values: `off`, `draft_only`, `on` — see
   `backend/routes/orchestrator.js:153` and
   `frontend/scripts/autonomy.js:691-709`.)
5. **Until then, `social_auto_post` stays OFF.** Verified live: it is
   `off` today. Do not turn it on before a successful test post.

---

## 2. Email sender + newsletter flag

### The decision

**No free email sender exists for FS AI today.** That is why newsletter
confirmation emails are impossible right now: the subscribe endpoint
stores every new subscriber as **pending** and says so honestly
(`backend/routes/newsletter.js:52-68`,
`frontend/scripts/newsletter.js:18` — "Confirmation emails cannot be
sent yet: no free email sender is connected."). Subscribers stay
pending until a sender is connected AND they confirm.

**What "a sender" means:** a service that sends the confirmation email
when someone subscribes. Without one, the newsletter form can only
collect pending addresses — it can never confirm anyone.

### Options (under the $0 rule)

No sender has been verified as free and working for FS AI. Before the
flag is turned on, a sender must be picked AND verified: free tier with
no card required, and it must work from a Cloudflare Worker. Candidates
to verify (NOT VERIFIED — their current free tiers were not checked
while writing this pack): Resend free tier, Brevo free tier. Do not
turn the flag on for a sender that has not been verified free — a paid
plan or a card requirement breaks the $0 rule.

### How to turn the newsletter flag ON (once a sender exists)

Do NOT do this until a sender is connected and verified.

1. The agent sets the flag in `frontend/scripts/newsletter.js`, line 16:
   `var NEWSLETTER_ENABLED = false;` → `true`.
2. The agent deploys the site normally.
3. You verify: open the home page — the newsletter form now appears,
   and subscribing no longer shows the "no free email sender" note.
   (When the flag is `false`, the forms are not rendered at all —
   verified in `frontend/scripts/newsletter.js:125` and by the A1
   live check: no newsletter form on the home page.)
4. Expected result: a test subscription receives a real confirmation
   email. If it does not, the sender is not working — turn the flag
   back OFF and tell the agent.

**Do NOT turn the flag on now.** The flag is `false` today (verified in
the deployed code), and there is no sender.

---

## 3. Decision packet — protected drafts #28, #29, #30, #31, #33

**Verified live from D1 on 2026-11-23 (~12:30 Dhaka, read-only SELECTs
only). All five are still `draft`. None was published, edited, or
deleted. `is_protected` is `0` for all five (only #26/#27 carry the
database protection flag) — "protected" here means the owner's rule:
these legacy drafts need a separate authorization each; they are never
auto-published.**

**Two mechanics you must know before you decide anything:**

1. **The dashboard Publish button does NOT check the gate.** Clicking
   Publish (`POST /api/admin/articles/:id/publish`,
   `backend/routes/admin-articles.js`) publishes immediately, even
   when the article's gate is Blocked. The gate only stops the
   *automatic* daily publish. A manual Publish is your override — use
   it only when you mean it.
2. **The dashboard Delete button does NOT work for these five today.**
   Every one of them has fact-check rows (and all but #33 also have SEO
   rows), and those tables are `NO ACTION` foreign keys — deleting the
   article FAILS on live D1 with `FOREIGN KEY constraint failed` and
   nothing is deleted (ledger B4; code comment in
   `backend/routes/admin-articles.js:302`). The code does not delete
   those rows first and does not refuse cleanly yet — that is an open
   code decision (delete the fact-check/SEO rows first, or refuse with
   a clean 409). So "discard" below means: click Delete, expect the
   error, and leave the article as a draft until the B4 follow-up code
   ships — do NOT click Delete again and again. Note: a failed delete
   still writes one audit row for an article that still exists (B4).

**Publish step (same for all five):** dashboard → sign in as Owner →
Content Management → Articles → filter Draft → find the article →
click **Publish** → confirm. Expected result: the status pill changes
to Published; the article opens at
`https://fs-ai-5w5.pages.dev/pages/article?id=<N>`; the published
total moves 25 → 26. **After any publish, tell the agent at once** —
the A6 auto-publish proof baseline (25 published / 7 drafts, recorded
2026-11-23) changes, and the next daily run's counts move with it.

**Discard step (same for all five):** dashboard → Content Management
→ Articles → filter Draft → find the article → click **Delete** →
confirm. Expected result TODAY: an error (foreign-key failure, §3
above) and the article stays a draft. That error is the known B4
block, not a mistake by you. If you still want it gone, tell the agent
"Discard #N — build the B4 delete follow-up first"; after that code
ships and deploys, the same Delete click will work.

### #28 — "What a billion-dollar deal says about the US battery market"

- **Status (verified live):** draft, body 2,157 chars. Latest
  fact-check fc 38: `needs-review`, 6 of 7 claims verified, 1 failed
  (2026-11-23 00:03:57). Latest SEO seo 23: `needs-review`
  (2026-11-23 00:04:00). Corrections so far: 5 applied, 1 failed,
  7 removed.
- **Known problems:** 1 claim still fails fact-check; SEO is
  needs-review. Gate Blocked.
- **Recommendation: HOLD — do not publish yet.** Ask the agent to run
  one correction round on the 1 failed claim, then a fresh fact-check
  + SEO, and decide again on the new numbers.
- **Publish:** the common Publish step above (id 28).
- **Discard:** the common Discard step above (id 28).

### #29 — "A local's travel guide to Austin: what to eat, see and do in three days"

- **Status (verified live):** draft, body 601 chars. Latest
  fact-check fc 10: `failed`, 0 of 0 claims verified — no evidence at
  all (2026-11-20 05:07:57). Latest SEO seo 25: `needs-review`
  (2026-11-23 00:04:04). Corrections so far: 2 removed.
- **Known problems:** the fact-check failed completely. The cause is
  the Guardian evidence blocker: the article's sources are Guardian
  pages, and the Guardian's terms prohibit AI use of its content, so
  the fetch feature refuses Guardian fetches (see §4). With no
  evidence, no claim can be verified. Gate Blocked.
- **Recommendation: DISCARD in principle (keep as draft for now).**
  It is 601 chars with zero verified claims. It can only be fixed
  after the Guardian API key (§4) AND the worker path are both done —
  and even then it needs a full re-check. If you do not want to wait
  for that, discard it.
- **Publish:** the common Publish step above (id 29). Do NOT publish
  as-is — 0 verified claims.
- **Discard:** the common Discard step above (id 29).

### #30 — "A local's travel guide to New York City: what to eat, see and do in three days"

- **Status (verified live):** draft, body 4,088 chars (corrected
  2026-11-22 19:30 Dhaka: 4,623 → 4,088). Latest fact-check fc 35:
  `needs-review`, 7 of 19 claims verified, 12 failed
  (2026-11-22 13:32:00). Latest SEO seo 22: `needs-review`
  (2026-11-22 00:02:52) — **STALE**: it ran before the 19:30
  correction, so it describes the old body. Corrections so far:
  2 applied, 11 failed, 4 removed.
- **Known problems:** 12 claims still fail, and the SEO result is
  stale. Gate Blocked. **B6 effect:** the gate's correction count
  (check 4) is now **3 open** (was 6) — the other 3 rows dropped out
  because their claims are VERIFIED or gone in the fresh fc 35 run.
  The gate still stays Blocked for other honest reasons (the
  needs-review fact-check with 12 failed claims). Also the Guardian
  evidence blocker applies here too (§4): some of its claims could
  only be checked against Guardian sources, which the fetch feature
  refuses.
- **Recommendation: HOLD — do not publish yet.** 12 failed claims is
  too many to override. Ask the agent for a correction plan for the
  12 failed claims (after §4, if Guardian evidence is needed), then a
  fresh fact-check + fresh SEO, and decide again.
- **Publish:** the common Publish step above (id 30).
- **Discard:** the common Discard step above (id 30).

### #31 — "Will More International Students Enroll Next Year?"

- **Status (verified live):** draft, body 549 chars. Latest
  fact-check fc 25: `pass`, 3 of 3 claims verified
  (2026-11-21 01:19:53). Latest SEO seo 24: `needs-review`
  (2026-11-23 00:04:02) — **10 of 11 checks pass**; the only failing
  check is `internal-links`, which fails by design ("No genuinely
  relevant published article exists in this division to link to — no
  link will be faked"). Corrections so far: 7 removed, 0 failed.
- **Known problems:** none on content. The gate stays Blocked only
  because the SEO verdict is needs-review on that one by-design check.
- **Recommendation: PUBLISH.** This is the cleanest of the five:
  fact-check fully passes and the single SEO miss is by design, not a
  real defect. Publishing it is a deliberate manual override of a
  Blocked gate for a documented by-design reason — that is exactly
  what the manual Publish button is for.
- **Publish:** the common Publish step above (id 31).
- **Discard:** the common Discard step above (id 31).

### #33 — "M State's Detroit Lakes campus to close amid systemwide budget woes"

- **Status (verified live):** draft, body 3,478 chars (corrected
  2026-11-22 14:07 Dhaka: 4,801 → 3,478). Latest fact-check fc 34:
  `pass`, 15 of 15 claims verified (2026-11-22 08:08:16). **No SEO
  row exists at all** — verified: zero `seo_checks` rows for #33 as
  of this check. Corrections so far: 4 applied, 13 failed, 5 removed.
- **Known problems:** no SEO check has ever run for the corrected
  body. The 23 Nov 00:00 UTC daily run did NOT produce an SEO row
  for #33 (verified — still zero rows after that run). Gate Blocked.
  **B6 effect:** the gate's correction count (check 4) is now **0**
  (was 4) — all 4 stale failed rows dropped out because fc 34
  verifies those claims against the current body. The gate still
  stays Blocked for other honest reasons (no SEO yet).
- **Recommendation: HOLD until one SEO check runs — then publish.**
  Ask the agent to run a single SEO check for #33; if it passes,
  publish it with the common Publish step. Do not publish before the
  SEO result exists.
- **Publish:** the common Publish step above (id 33), only after the
  SEO check passes.
- **Discard:** the common Discard step above (id 33).

---

## 4. Guardian API key — the #29 / #30 evidence unblocker

**The problem:** the fact-checker verifies a claim only with real
evidence quotes from fetched source material. The Guardian's terms
prohibit AI use of its content, so the fetch feature refuses Guardian
pages (`backend/services/article-fetch.js` header: "The Guardian states
exactly this; its articles therefore cannot be fetched by this feature.
The licensed route for Guardian content is the Guardian Open Platform
API, which needs an owner-registered key and a separate follow-up").
That is why #29's fact-check failed completely (0/0) and why some of
#30's claims cannot be checked.

### Step 1 — register for the free key (you do this)

1. Go to **https://open-platform.theguardian.com/access/**
2. Choose the **Developer key** tier and fill in the short form (name,
   email, what you are building).
3. The key is emailed to you right away — no approval wait, no card.
   (Source: Guardian Open Platform access page, confirmed by web
   search 2026-11-23.)
4. The Developer key is free for non-commercial use: 500 calls a day,
   1 call per second, as listed on the Guardian site. Commercial use
   needs a paid commercial key — do not apply for that; FS AI uses the
   free Developer key only.
5. Give the key to the agent when it asks. Never paste it into this
   document or any public place.

### Step 2 — the worker path (NOT built — the agent builds it after you give the key)

The key alone fixes nothing. The worker path to use it does **not
exist yet** — do not assume handing over the key unblocks anything by
itself. What it must do (for the agent to build, on your say-so after
Step 1):

1. A Guardian API client in the Worker that calls
   `https://content.guardianapis.com` with the key as the `api-key`
   parameter and `show-fields=bodyText`, to fetch the full text of a
   Guardian article.
2. It fetches ONLY URLs that are already recorded `article_sources`
   URLs for the article being checked — the same allowlist rule the
   existing fetch feature uses. It never fetches an arbitrary URL.
3. The fetched full text is stored as research evidence, in the same
   shape as the existing fetch feature's evidence, so the fact-checker
   can quote it.
4. Then the agent re-runs fact-check for #29 and #30, and you decide
   again on the new numbers (§3).

---

## 5. YouTube — keep browser uploads; Long #08 v2 upload

### 5.1 Keep browser uploads — do NOT use the YouTube Data API

- Uploads stay manual, in YouTube Studio, from the browser. That flow
  works (6 videos live, all Public).
- Do NOT use the YouTube Data API. It is do-not-use: the OAuth consent
  screen is in **Testing**, so API uploads land **PRIVATE** no matter
  what privacy is requested, and refresh tokens issued in Testing
  **expire after 7 days**. (Sources:
  `backend/social/platforms.js`, YouTube entry;
  `work/YOUTUBE-OAUTH-AUDIT-2026-11-21.md`.)
- The code has a hard do-not-use gate (`YOUTUBE_DATA_API_ENABLED`
  must be `true`; default off). Do not ask the agent to turn it on.

### 5.2 The API-audit decision (yours alone — nothing is started)

If API upload is ever wanted, Google verification ("API audit") is
required. Requirements:

1. A Google Cloud project with YouTube Data API v3 enabled.
2. An OAuth client (Web application) with redirect URI
   `https://fs-ai-5w5.pages.dev/api/social/oauth/youtube/callback`.
   (Note: this one uses the Pages address, not the workers.dev
   address — that is what the audit doc records. NOT VERIFIED live.)
3. Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` as Worker
   secrets (agent stores them; never in code).
4. Move the consent screen to Production and complete Google
   verification: privacy-policy URL, authorized domains, app
   description, YouTube API Terms compliance, a demo video of the
   OAuth flow. Review takes days to weeks (Google's queue — no date
   can be promised).
5. **Scope warning:** the code as written requests the full `youtube`
   scope (restricted — full account access) plus `youtube.upload`
   (sensitive). Restricted scopes can add a third-party security
   assessment — significant time and a fee you would have to pay.
   Recommendation (decision, not done now): before any verification
   attempt, narrow the scopes to `youtube.upload` plus
   `youtube.readonly` if reads are needed, and confirm the adapter
   only needs those. Do not start verification with the full scope
   as-is. **$0 rule: never pay for an assessment without your explicit
   approval of the exact cost.**
6. Until verification completes, the app stays effectively in Testing
   limits for new users.

Consequences if you say yes: after verification, API uploads can be
Public (quota 10,000 units/day; one upload costs 1,600 units, so
about 6 uploads/day max). Consequences if you say no (current state):
nothing changes — browser uploads keep working, and no API upload is
attempted.

### 5.3 Session login — @FSAI-e5f (keep it signed in)

Your standing order: "Youtube always log in rakhba" — keep the
session signed in so uploads never hit a sign-in block.

1. Open YouTube Studio in your browser.
2. Check the avatar (top right): it must show **mdalfahad406@gmail.com**
   and channel **@FSAI-e5f**.
3. If it shows any other account, stop: sign out and sign in as
   mdalfahad406. **Never upload from the 841 account** — its channel
   is terminated.
4. If Studio asks for a sign-in or a security challenge, you sign in
   yourself. The agent never asks for your Google password, never
   stores it, and never works around CAPTCHA or account security.
5. Leave the session signed in. Do not sign out after an upload.
   (Source: `work/BROWSER-UPLOAD-PROCEDURE-2026-11-21.md`.)

### 5.4 Long #08 v2 upload — do it from this sheet

**Video file (NOT uploaded yet):**
`FS-AI-Long-08-Electric-Vehicle-Range-What-the-Numbers-Mean-v2.mp4`
— 15,244,633 bytes, 5:32 (331.533 s), 1920×1080 30 fps. QA 14/14
PASS. v2 is the accepted animated-explainer rebuild (kinetic-card /
Barmon style). Do NOT upload v1 — v1 stays local only.
Full source: `docs/UPLOAD-SHEET-Long-08-v2.md`.

1. In Studio (signed in as mdalfahad406 / @FSAI-e5f), Create →
   Upload videos → select the v2 `.mp4`.
2. **Title** (paste exactly, 52 characters):
   `Electric Vehicle Range: What the Numbers Really Mean`
3. **Description** (paste verbatim):
   ```
   Your EV promises one range number — you get another. This guide explains what the WLTP figure really means, why real driving gives a different result, how winter changes it, and how to read the numbers before you buy.
   Learn the four-fifths charging habit that makes long trips quicker and less stressful, and the questions to ask before choosing an electric car.

   Read the full guide (free, no sign-up):
   https://fs-ai-5w5.pages.dev/pages/article.html?id=8

   Chapters:
   00:00 One Number, Three Answers
   00:32 The Laboratory Number (WLTP)
   01:12 Speed Changes Everything
   02:01 Cold Weather Costs Range
   02:44 Read the Numbers Right
   03:39 The Four-Fifths Habit
   04:20 Ask Before You Buy
   05:00 What the Numbers Mean (recap)

   Related video — EV Charging at Home (Long #01):
   https://youtu.be/hDpXk726Y54

   From FS AI — One Platform. Multiple Possibilities.
   https://fs-ai-5w5.pages.dev

   #ElectricVehicle #EVRange #ElectricCar #WLTP
   ```
4. **Chapters** (verified against the `.srt`): 00:00 One Number,
   Three Answers · 00:32 The Laboratory Number (WLTP) · 01:12 Speed
   Changes Everything · 02:01 Cold Weather Costs Range · 02:44 Read
   the Numbers Right · 03:39 The Four-Fifths Habit · 04:20 Ask Before
   You Buy · 05:00 What the Numbers Mean (recap).
5. **Thumbnail:** upload
   `FS-AI-Long-08-Electric-Vehicle-Range-What-the-Numbers-Mean-thumb.png`
   (1280×720 PNG, 144,439 bytes, under 2 MB). Do not let YouTube
   auto-pick a frame.
6. **Subtitles:** upload the v2 `.srt` as the English subtitle track
   (`FS-AI-Long-08-Electric-Vehicle-Range-What-the-Numbers-Mean-v2.srt`,
   5,252 bytes, 9 cues — byte-identical to the v1 `.srt`).
7. **Playlist:** add the video to the **FS AI long-form playlist**.
8. **End screen (last 20 seconds):** point to Long #01
   "EV Charging at Home" — https://youtu.be/hDpXk726Y54 — for the
   last 20 seconds of the video.
9. **Visibility: Public** — confirm before finishing. Do not leave it
   Private or Unlisted by accident.
10. Save / publish.

**Pre-upload checklist** (tick each one): title pasted exactly (52
chars) · description pasted verbatim (chapters, article link,
related-video link, hashtags) · chapters present and matching the
table above · thumbnail uploaded · `.srt` uploaded as English
subtitles (9 cues) · added to the FS AI long-form playlist · end
screen added (Long #01, last 20 seconds) · visibility Public · v1
file NOT uploaded.

---

## 6. Resuming the Shorts cron — after C4

**Status: the daily Shorts cron stays PAUSED.** It has been paused
since 2026-11-23 00:53. Do not resume it until every item below
passes. Full checklist:
`docs/CLOSEOUT-C4-SHORTS-READINESS-2026-11-23.md`.

| # | Item | Who | Status |
|---|---|---|---|
| 1 | Tell the agent what you disliked about the Shorts — style/look, voice, speed, or content (you said on 2026-11-23 00:52: "Short video gula valo lage nai") | Owner | OPEN — unanswered |
| 2 | Watch Short #09 v2 (sent to you as a file, not just a link) and approve with the exact words below | Owner | OPEN — not watched/approved |
| 3 | Short #09 v2 passes the automated QA gate (overall PASS, exit 0) | Agent | PASSED — attempt 2, C3 gate 7/7 PASS, exit 0 (coordinator re-ran independently) |
| 4 | Your prompt for the next video, OR the exact words "Auto-pick topics is OK again" (you said on 2026-11-22 23:18 you will give the prompts yourself) | Owner | OPEN — no prompt sent, auto-pick not re-approved |
| 5 | Division rotation — the next article after #09 must NOT be automotive #10 (Short #06 + #09 are already two automotive in a row; #10 would be the third). The agent names a different division's article before the run | Agent | OPEN — named at resume time |
| 6 | State file + cron mechanics verified by the agent, only after items 1–5 pass AND you say resume | Agent | OPEN |
| 7 | Know what you get on the first resumed day (§6 below) | Owner | Information only |
| 8 | Must NOT happen on resume: no re-render of any published video, no touching Short #09 v1, no article auto-publish by the Shorts run, `social_auto_post` stays OFF (the run still makes one Pin for the new Short itself, as it did for #06) | Agent | Standing rule |

**Your exact words to approve Short #09 v2** (item 2 — only after
watching it):

```
Short #09 v2 approved — looks good
```

**Your exact words to resume the cron** (item 6 — only after items
1–5 have passed):

```
Resume Shorts
```

No other wording resumes the cron. The agent re-enables it — you do
nothing.

**Your exact words to pause it again** (any time you dislike the next
Short — one reply, no discussion needed):

```
Pause Shorts
```

**What the agent verifies first (before re-enabling):** the state file
(`hidden_files/daily-shorts-state.json`) reads `last_uploaded` 6 and
`next_article` 9 — verified by the close-out pass on 2026-11-23 (the
file reads exactly that, with the note that the #09 upload was stopped
on your 00:52 order and the cron paused); the cron is still paused;
items 1–5 above have passed with the evidence written down.

**What happens on the first resumed run (fires 10:13:06 Dhaka):**
build → upload the approved Short #09 file → make its Pin → send you
the report with the video file, the YouTube link, and the Pin link.
Previous uploads landed late morning, around 11:30–12:00 Dhaka — no
exact minute is promised. Long #08 v2 is NOT part of this — it is
uploaded separately by you from §5.4, never by the cron. No Community
post is made (the channel has 2 subscribers; Community posts need 500).

**Do NOT resume the cron now.** Items 1, 2, and 4 are still open with
you.

---

## 7. Search Console — sitemap + indexing

**Today's numbers are NOT VERIFIED here.** A separate 11:00 cron
checked Search Console today and its result is NOT in this document.
Check the latest status in Console yourself — do not use any number
from this pack as today's number.

### 7.1 Sitemap status check

1. Open Google Search Console → the FS AI property (URL-prefix,
   verified by you).
2. Left menu → **Sitemaps**.
3. Find `https://fs-ai-5w5.pages.dev/sitemap.xml` and read its status.
4. **If it still shows "Couldn't fetch":** do not panic and do not
   assume the sitemap is broken. The 22 Nov investigation found NO
   technical blocker: the sitemap answers 200, is valid XML, lists 60
   URLs, all 60 URLs answer 200, 0 redirects, robots allows all. The
   Console status was a stale fetch from 20 Nov, and Google had not
   re-read it after the 22 Nov resubmission.
5. **Resubmit only if the sitemap changed** since the last successful
   read, or if Console shows an error naming the file itself. To
   resubmit: Sitemaps → enter
   `https://fs-ai-5w5.pages.dev/sitemap.xml` → **Submit** → expect
   "Sitemap submitted successfully". Do NOT resubmit again and again
   while the file is unchanged — it does not make Google read it
   faster.
6. Note: the served sitemap does NOT regenerate when an article
   auto-publishes. It refreshes hourly (sitemap-refresh workflow,
   top of the hour) — a newly published article appears in the served
   sitemap only after the next hourly refresh + deploy.

### 7.2 Article 1 — indexing request (request ONCE, stop on quota)

1. In Search Console → **URL Inspection** → enter the Article 1 URL
   (`https://fs-ai-5w5.pages.dev/pages/article?id=1`).
2. Click **Test live URL**. Wait for the result.
3. If the page is available to Google, click **Request indexing**.
4. **Request ONCE.** If the answer is **"Quota Exceeded"**, STOP —
   do not retry the same day. That has happened 7 times already.
   Wait for the next day's retry.
5. Record the result (date, live-test result, requested or
   quota-exceeded) and tell the agent, so the daily record stays
   honest.

### 7.3 Article 6 — monitoring only

1. In URL Inspection, check Article 6
   (`https://fs-ai-5w5.pages.dev/pages/article?id=6`) the same way.
2. **Do NOT request indexing for Article 6.** It was checked only
   ("URL is not on Google"); no indexing request was made for it.
   Just record its status.

### 7.4 What to record each time

After every Console check, note down and tell the agent: indexed page
count, not-indexed page count, crawl errors (if any), Article 1 live
test + request result, Article 6 status. Those numbers go into the
daily record — never copy an old day's numbers forward.

---

## Quick list — everything you need to do, in one place

1. **Social (§1):** create one app per platform → give the client
   ID/secret to the agent → open the start URL → grant scopes → test
   ONE post per platform → only then turn `social_auto_post` on.
   X: do not attempt.
2. **Newsletter (§2):** decide on a sender first (none verified free
   yet). The flag stays OFF until a sender exists.
3. **Drafts (§3):** #31 — publish. #33 — one SEO check, then publish.
   #28, #30 — hold for corrections. #29 — discard in principle
   (needs §4 first to ever fix it).
4. **Guardian (§4):** register the free Developer key, give it to the
   agent, then approve building the worker path.
5. **YouTube (§5):** keep the mdalfahad406 session signed in; upload
   Long #08 v2 from §5.4. API audit: your decision, nothing started.
6. **Shorts (§6):** say what you disliked, watch + approve #09 v2,
   send your next-video prompt (or "Auto-pick topics is OK again"),
   then say "Resume Shorts".
7. **Search Console (§7):** check the sitemap status in Console;
   Article 1 indexing request ONCE (stop on quota); Article 6
   monitoring only. Today's numbers: NOT VERIFIED — check Console.
