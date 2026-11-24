# FS AI — IndexNow one-off submit — 2026-11-24

Fix Pass 4 F4. One-off only: this submits the 60 sitemap URLs to
IndexNow exactly once. No auto-ping was added (see the proposal at
the end).

## What IndexNow is — and what it is NOT

IndexNow is a free protocol (Microsoft/Bing) that lets a site tell
search engines "these URLs changed, come and crawl them" instead of
waiting for the next crawl. A site proves ownership with a public
key file at its root, then POSTs a list of URLs to
https://api.indexnow.org/indexnow.

**It does NOT cover Google.** IndexNow is honoured by Bing, Yandex
and some other engines. Google does not use IndexNow — Google's
indexing still depends on the sitemap + its own crawl schedule (the
Search Console "Couldn't fetch" sitemap problem is a separate,
Google-side issue; this submit does nothing for it). So: this is a
free Bing-side nudge, not a fix for Google indexing. Expect no
visible change in Search Console from it.

## The key (public by design)

- Key: `c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228`
  (64 hex chars, generated with `openssl rand -hex 32`, 2026-11-24).
- Key file (committed, served by Pages): `frontend/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt`
- Live URL: https://fs-ai-5w5.pages.dev/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt
- The file contains exactly the key on one line (64 chars + newline).
  The key is meant to be public — it is not a secret and must never
  be treated as one, but it also must never be changed without
  re-submitting: IndexNow verifies the key file on every submit.

## The one-off submit

**Run this ONLY after the key file is deployed and verified live**
(`curl -s https://fs-ai-5w5.pages.dev/<key>.txt` must return the key
above). Run it exactly once. The URL list below was extracted from
the live sitemap on 2026-11-24 and verified: 60 URLs, all on
`fs-ai-5w5.pages.dev`, all unique.

To rebuild the list from the live sitemap at any time:

```sh
curl -s https://fs-ai-5w5.pages.dev/sitemap.xml \
  | grep -o "<loc>[^<]*</loc>" | sed 's/<[^>]*>//g' | wc -l
# expect 60
```

The exact submit command (JSON body inlined; 3,596 bytes):

```sh
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST https://api.indexnow.org/indexnow \
  -H "Content-Type: application/json" \
  -d '{
  "host": "fs-ai-5w5.pages.dev",
  "key": "c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228",
  "keyLocation": "https://fs-ai-5w5.pages.dev/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt",
  "urlList": [
    "https://fs-ai-5w5.pages.dev/",
    "https://fs-ai-5w5.pages.dev/pages/division",
    "https://fs-ai-5w5.pages.dev/pages/division?division=automotive",
    "https://fs-ai-5w5.pages.dev/pages/division?division=ai-technology",
    "https://fs-ai-5w5.pages.dev/pages/division?division=gadgets-electronics",
    "https://fs-ai-5w5.pages.dev/pages/division?division=finance-money",
    "https://fs-ai-5w5.pages.dev/pages/division?division=travel-lifestyle",
    "https://fs-ai-5w5.pages.dev/pages/division?division=digital-tools",
    "https://fs-ai-5w5.pages.dev/pages/division?division=health-wellness",
    "https://fs-ai-5w5.pages.dev/pages/division?division=education-learning",
    "https://fs-ai-5w5.pages.dev/pages/article?id=1",
    "https://fs-ai-5w5.pages.dev/pages/article?id=2",
    "https://fs-ai-5w5.pages.dev/pages/article?id=3",
    "https://fs-ai-5w5.pages.dev/pages/article?id=4",
    "https://fs-ai-5w5.pages.dev/pages/article?id=5",
    "https://fs-ai-5w5.pages.dev/pages/article?id=6",
    "https://fs-ai-5w5.pages.dev/pages/article?id=7",
    "https://fs-ai-5w5.pages.dev/pages/article?id=8",
    "https://fs-ai-5w5.pages.dev/pages/article?id=9",
    "https://fs-ai-5w5.pages.dev/pages/article?id=10",
    "https://fs-ai-5w5.pages.dev/pages/article?id=11",
    "https://fs-ai-5w5.pages.dev/pages/article?id=12",
    "https://fs-ai-5w5.pages.dev/pages/article?id=13",
    "https://fs-ai-5w5.pages.dev/pages/article?id=14",
    "https://fs-ai-5w5.pages.dev/pages/article?id=15",
    "https://fs-ai-5w5.pages.dev/pages/article?id=16",
    "https://fs-ai-5w5.pages.dev/pages/article?id=17",
    "https://fs-ai-5w5.pages.dev/pages/article?id=18",
    "https://fs-ai-5w5.pages.dev/pages/article?id=19",
    "https://fs-ai-5w5.pages.dev/pages/article?id=20",
    "https://fs-ai-5w5.pages.dev/pages/article?id=21",
    "https://fs-ai-5w5.pages.dev/pages/article?id=22",
    "https://fs-ai-5w5.pages.dev/pages/article?id=23",
    "https://fs-ai-5w5.pages.dev/pages/article?id=24",
    "https://fs-ai-5w5.pages.dev/pages/article?id=25",
    "https://fs-ai-5w5.pages.dev/pages/tools",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=fuel-cost",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=mileage",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=maintenance-planner",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=tyre-pressure",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=monthly-budget",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=savings",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=loan-payment",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=currency-converter",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=storage-converter",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=internet-speed",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=data-unit",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=file-size",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=travel-budget",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=distance-planner",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=trip-cost",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=age-calculator",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=percentage",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=date-calculator",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=unit-converter",
    "https://fs-ai-5w5.pages.dev/pages/tools?tool=time-calculator",
    "https://fs-ai-5w5.pages.dev/pages/about",
    "https://fs-ai-5w5.pages.dev/pages/contact",
    "https://fs-ai-5w5.pages.dev/pages/privacy",
    "https://fs-ai-5w5.pages.dev/pages/terms"
  ]
}'
```

## What success looks like — and what to record

- **HTTP 200** = IndexNow accepted the submission. (202 = also
  accepted in some IndexNow implementations; 400 = bad request,
  usually a wrong key or a URL outside the host; 403 = key file not
  found or key mismatch — re-check the live key file first.)
- Record in the Fix Pass 4 ledger: the HTTP status, the date/time,
  and the URL count (60). A 200 means "received", not "indexed":
  Bing still decides whether and when to crawl each URL, and there
  is no IndexNow dashboard to check. The effect on Bing indexing is
  NOT observable immediately — mark it NOT TESTED / not yet
  available, and re-check Bing Webmaster Tools after the Bing
  Webmaster setup (F5) for any crawl/index movement.
- If the submit returns non-200, do NOT retry blindly: read the
  status, fix the cause (usually the key file not live yet), and
  retry once. Do not submit more than a few times — IndexNow rate
  limits repeated submissions.

## Proposal: auto-ping on publish (NOT implemented)

Where it would go: the publish path — `backend/publishing/gate.js`
/ the auto-publish step in `backend/routes/scheduler.js`, right after
an article's status flips to `published` and its URL is known.

How it would work: a small helper (e.g. `backend/services/indexnow.js`)
that POSTs `{host, key, keyLocation, urlList: [the one new article
URL]}` to https://api.indexnow.org/indexnow, using the same key file
already committed. One URL per publish (the new article only — not
the whole sitemap), one call, fire-and-forget.

Failure handling (hard rule): a failed ping must NEVER block or roll
back a publish. The helper must catch every error (network, non-200,
timeout — cap it at ~5 s), log the failure to `agent_runs` detail,
and return without throwing. The publish succeeds regardless; the
ping is best-effort. A manual re-submit (this doc) remains the
fallback for any missed URL.

Why it is a proposal, not a change: it adds a live external call to
the publish path (a new failure mode on the most sensitive step),
and the one-off submit above already covers all 60 current URLs —
auto-ping only pays off for future articles, one URL at a time.
Owner decision needed before implementation.
