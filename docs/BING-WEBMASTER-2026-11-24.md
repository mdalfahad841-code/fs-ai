# FS AI — Bing Webmaster Tools setup — owner steps — 2026-11-24

Fix Pass 4 F5. Docs only. **Nothing here is done yet — the sign-in,
the add-site step, the verification and the sitemap submit can only
be done by the owner in his own browser.** This doc is the exact
checklist for him. No password, OTP or sign-in is ever sent to the
agent; if a step asks the agent for a password, stop and do it
yourself.

## What this is

Bing Webmaster Tools is Microsoft's free dashboard for site owners —
Bing's counterpart to Google Search Console. It shows how Bing
crawls and ranks the site, which pages are indexed, and whether the
sitemap and the IndexNow pings are being received. Cost: $0.
Sign-in: a Microsoft account, a Google account, or a Facebook
account — whichever the owner prefers.

Related Fix Pass 4 work: F4 (`docs/indexnow-submit.md`) already
submitted all 60 sitemap URLs to IndexNow once (HTTP 202 Accepted,
2026-11-24). Bing Webmaster Tools is where that submit's effect can
be observed. This doc and the IndexNow doc reference each other.

## IMPORTANT correction — read this first

The IndexNow key file already deployed at the site root
(`https://fs-ai-5w5.pages.dev/c7d67fb3...e228.txt`) does **NOT**
verify the site in Bing Webmaster Tools. The key file proves
ownership to the IndexNow protocol only (it is what IndexNow checks
when a submit arrives). Bing Webmaster Tools verification uses
different methods: an XML file (`BingSiteAuth.xml`), a meta tag
(`msvalidate.01`), or a DNS record (CNAME / Domain Connect).
This was checked against nine independent Bing Webmaster setup
guides (all agree on the same four methods; none lists the IndexNow
key file as a verification method). The official bing.com help page
could not be fetched from this environment to double-check, so if a
menu label below does not match what you see on screen, trust the
screen — Bing renames its menus from time to time.

That changes nothing about IndexNow: the key file stays where it
is, the one-off submit stands, and future IndexNow pings still use
it. It only means verification in Bing Webmaster Tools needs one of
the methods below, not the key file.

## Before you start — what you need

- The site URL: `https://fs-ai-5w5.pages.dev`
- The sitemap URL: `https://fs-ai-5w5.pages.dev/sitemap.xml`
  (60 URLs; returns HTTP 200 — verified live 2026-11-24.)
- A sign-in account. **Recommended: the Google account that owns
  the site's Google Search Console property**
  (`mdalfahad841@gmail.com` owns Search Console for this site) —
  because Option A below imports the site from Search Console and
  needs that Google account's permission. A Microsoft account works
  too, but then Option A needs the Google account anyway at the
  import step.
- About 10 minutes. No code change is needed for Option A.

## Option A (RECOMMENDED) — import from Google Search Console

Fastest route: the site is already verified in Google Search
Console, and Bing imports verified properties — with their
sitemaps — automatically. No file to upload, no tag to paste, no
deploy.

1. Go to https://www.bing.com/webmasters/ and sign in
   (Microsoft, Google or Facebook account).
2. On the add-a-site screen choose **Import from Google Search
   Console** (wording may vary slightly).
3. Sign in to the Google account that owns the Search Console
   property (`mdalfahad841@gmail.com`) and allow Bing read access
   to Search Console when asked. Bing lists the verified
   properties it can see.
4. Tick `https://fs-ai-5w5.pages.dev` and confirm the import.
   Bing copies the verification and the submitted sitemaps.

**What success looks like:** the site appears in the Bing
Webmaster Tools site list with status **Verified** immediately
after the import, and under **Sitemaps** the sitemap
`https://fs-ai-5w5.pages.dev/sitemap.xml` is already listed
(imported from Search Console). No further verification step is
needed.

**If it fails:**
- The site is not listed for import → you signed in to the wrong
  Google account. Sign out of Google in that browser and sign in
  with the account that owns the Search Console property.
- Import succeeds but the sitemap is missing from Bing's list →
  submit it by hand (see "Submit the sitemap" below).
- Bing's "Couldn't fetch" sitemap status in Google Search Console
  does **not** block this import. That is a Google-side fetch
  problem; the sitemap file itself is healthy (HTTP 200, 60 URLs).
  Bing fetches the sitemap itself after the import.

## Option B — add the site manually and verify it

Use this only if Option A is not possible (for example, the Google
account for Search Console is not available).

1. Go to https://www.bing.com/webmasters/ and sign in.
2. Choose **Add a site** (manual — not the import option) and type
   the exact URL: `https://fs-ai-5w5.pages.dev`
   (exact `https`, exact host, no trailing slash, no `www`).
3. Bing offers four verification methods. Pick ONE:

   **(i) Meta tag — recommended manual method.** Bing shows a tag
   like `<meta name="msvalidate.01" content="...">`. Copy only the
   value inside `content`. The tag must go into the `<head>` of the
   home page (`frontend/index.html`) and be deployed before you
   click Verify — so this method needs the agent: send the code
   value to the agent, the agent adds the tag and deploys, then you
   click **Verify** in Bing. Do NOT paste the full tag into a chat
   message as a password — it is a verification code, not a secret,
   but the agent only needs the `content` value.

   **(ii) XML file.** Bing gives you a file named
   `BingSiteAuth.xml`. It must be served at the site root:
   `https://fs-ai-5w5.pages.dev/BingSiteAuth.xml`. Send the file to
   the agent, the agent commits it to `frontend/` and deploys, then
   you click **Verify**. The file must stay in place after
   verification — Bing re-checks it over time.

   **(iii) DNS CNAME record.** Bing gives you a CNAME record to
   add at the DNS host. This needs access to the domain/DNS
   account for `pages.dev` — which the owner does **not** control
   (Cloudflare owns `pages.dev`), so this method is almost
   certainly **not usable** for this site. Do not spend time on it
   unless Bing offers it and the DNS host is reachable.

   **(iv) DNS auto verification (Domain Connect).** Only shown if
   the DNS provider supports it. Same problem as (iii): the
   `pages.dev` DNS is not the owner's. Skip it unless Bing offers
   it directly.

4. Click **Verify** in Bing Webmaster Tools.

**What success looks like:** the site appears in the site list
with status **Verified**. The verification proof (tag or file)
must stay in place afterwards — Bing re-checks ownership
periodically and removes access if it disappears.

**If verification fails:**
- "Verification not found" on the meta-tag method → the tag is not
  live yet. Check the home page source in a browser: the
  `msvalidate.01` tag must be in the `<head>`, not added by a
  script. If it is missing, the deploy has not landed yet — wait a
  few minutes and retry.
- "Verification not found" on the XML method → open
  `https://fs-ai-5w5.pages.dev/BingSiteAuth.xml` in a browser: it
  must load the file, not a 404 and not a redirect to a login page.
- Still failing after the proof is visibly live → wait and click
  Verify again; Bing's check can lag a fresh deploy by minutes.
  Do not remove the proof and start over.

## Submit the sitemap

(Only needed if it is not already listed — Option A imports it
automatically.)

1. In Bing Webmaster Tools open **Sitemaps** (under Configure My
   Site / the left menu).
2. If `https://fs-ai-5w5.pages.dev/sitemap.xml` is not listed,
   choose **Submit sitemap** and paste the full URL.
3. Submit.

**What success looks like:** the sitemap appears in the list with
status **Success** (or "Pending" while Bing fetches it — that is
normal for the first minutes) and, once read, shows discovered URLs
(60). If it shows an error, first open the sitemap URL in a browser
yourself: it must return HTTP 200 with the XML list. If the browser
shows it fine and Bing still errors, wait a day and re-check —
Bing retries on its own schedule.

## Where to look afterwards — crawl / index movement

Data appears after about **48 hours** at the earliest, and indexing
moves over **days, not minutes**. Do not expect same-day results
from the IndexNow submit or the sitemap submit.

- **Sitemaps** — the sitemap's status and how many URLs Bing
  discovered from it (expect 60 once read).
- **URL Inspection** — paste one article URL (for example
  `https://fs-ai-5w5.pages.dev/pages/article?id=1`) to see whether
  Bing has crawled it and whether it is indexed. Check a few
  article URLs, not just the home page.
- **Index Explorer** (or the indexed-pages report) — the count of
  the site's pages Bing has indexed, over time.
- **Search Performance** — impressions and clicks from Bing, once
  any page is indexed and shown. Expect zeros for the first days.
- **IndexNow** — Bing Webmaster Tools has an IndexNow view/report
  showing submitted URLs it received. The 60 URLs from the
  2026-11-24 one-off submit should appear there once Bing has
  processed them. If they do not appear after a few days, re-check
  that the key file is still live at its URL.

Re-check after **3–7 days**: sitemap status Success with 60
discovered URLs, and Index Explorer / URL Inspection showing the
first pages indexed. Record the date and the numbers in the Fix
Pass 4 ledger (F5 follow-up).

## What this does NOT do

- **Bing Webmaster Tools covers Bing (and the search engines that
  share IndexNow pings), NOT Google.** Google Search Console stays
  the place for Google. Nothing here changes Google indexing.
- Google Search Console's sitemap status ("Couldn't fetch") is a
  separate, Google-side issue. This setup does not fix it, and the
  25 Nov Article 1 indexing retry in Search Console is unaffected
  by anything in this doc.
- Submitting a sitemap or an IndexNow ping does **not guarantee
  indexing**. Bing still decides whether and when to crawl and
  index each URL. A submitted URL that Bing considers low-value
  may stay unindexed — that is normal, not an error to fix by
  re-submitting.

## Quick checklist (for the owner)

- [ ] Signed in at https://www.bing.com/webmasters/
- [ ] Site added — Option A (import from Search Console) or
      Option B (manual + one verification method)
- [ ] Site status shows **Verified**
- [ ] Sitemap `https://fs-ai-5w5.pages.dev/sitemap.xml` listed
      (imported, or submitted by hand)
- [ ] Re-check in 3–7 days: sitemap Success / 60 discovered,
      first pages in Index Explorer / URL Inspection

## Sources

Setup and verification methods checked 2026-11-24 against nine
independent Bing Webmaster Tools setup guides (goodseo.tech,
seobaz.com, gauravtiwari.org, sorank.com, searchenginetable.com,
rubikdigital.co.uk, creahive.com, kevinwelter.com,
stackharbor.com). All agree: verification is XML file
(`BingSiteAuth.xml`), meta tag (`msvalidate.01`), DNS CNAME, or
Domain Connect; import from Google Search Console verifies
automatically. None lists the IndexNow key file as a verification
method. The official bing.com help page could not be fetched from
this environment (domain blocked), so menu labels are quoted as
the guides give them — trust the live screen if a label differs.
