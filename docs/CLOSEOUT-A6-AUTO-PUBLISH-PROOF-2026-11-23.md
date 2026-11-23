# CLOSEOUT A6 — First-real-auto-publish proof (2026-11-23)

## ⛔ DO NOT RUN YET — read this first

**This script and doc must NOT be run against any real article yet.
No real auto-published article exists.** The first real auto-publish
has not happened: article #34 is still a draft, auto-publish has never
fired on a real article, and there is nothing to verify. Running
`scripts/verify-auto-publish.mjs` now would fail check 1 (no such
published article) — that failure would be correct, not a bug.

Run this procedure **once, immediately after the first real
auto-publish** (the daily run publishes a new article on its own;
watch for it in the next daily report, or for the owner noticing a
new article on the home page). One run, one article id, then record
the result — that is the whole of A6.

## What it proves

For one newly auto-published article, against the LIVE site:

1. **Page** — the article page answers 200 and the public API serves
   it with a non-empty title + body (the page is JS-rendered, so the
   title/body are proven via the API, not the raw HTML).
2. **Division + home** — it appears in its division's public list and
   is the first entry of the date-desc public list (the home "Latest
   guide").
3. **Sitemap** — it is in `/sitemap.xml` **after the next hourly
   sitemap-refresh run**. The sitemap does NOT update instantly: the
   refresh workflow runs at the top of every hour, commits only when
   the file changed, and the Pages deploy follows. If the check says
   WAIT, wait for the next refresh and re-run — do not claim the
   sitemap updates instantly, and do not record the proof until this
   check passes.
4. **Meta** — the per-article canonical / title / og values exist in
   the API record, and the served `article.html` contains the
   `setMeta` calls that apply them (JS-set). **Stated plainly: a
   no-JS crawler still sees the generic fallback** — the raw page
   HTML shows "Loading article…" with generic title/canonical, per
   the A3 crawler report (`docs/CLOSEOUT-A3-CRAWLER-REPORT-2026-11-23.md`).
   The script checks the served JS, not a rendered head; it never
   claims a no-JS crawler sees the per-article values.
5. **Counts** — the live published total moved by exactly **+1**
   (baseline 25 → 26, recorded 2026-11-23). The draft side (**−1**)
   is **not verifiable from any public endpoint** — drafts are never
   served publicly — so the script prints the expected draft total
   and the exact dashboard path, and the operator **must** confirm
   drafts 7 → 6 on the dashboard before the proof is recorded. The
   script never claims the draft move itself.

## Run command

```sh
node scripts/verify-auto-publish.mjs <article-id>
```

Example (first auto-published article — use its real id, not 34
unless 34 is the one that published):

```sh
node scripts/verify-auto-publish.mjs 34
```

Requirements: Node 20+ (the repo runs Node 24), internet access to
`fs-ai-5w5.pages.dev` and `fs-ai.mdalfahad841.workers.dev`. No
credentials, no D1 access, no sign-in. The script only GETs public
endpoints; it never publishes, edits or touches any article, and it
cannot write to D1.

The script refuses protected / legacy ids outright (26, 27, 28, 29,
30, 31, 33): the first auto-publish is always a NEW article, never
one of those.

## Expected output

On all-PASS (after the sitemap refresh has run):

```
Verifying newly auto-published article #34 against the live site.
Baseline (recorded 2026-11-23): 25 published, 7 drafts.
[PASS] 1. page — article page 200; API serves "#34 <title>" (slug <slug>, body <n> chars). Note: the raw page HTML is JS-rendered — the title/body are proven via the API, not the fetched HTML.
[PASS] 2. division-home — in division "<slug>" list; 1st of 26 in the date-desc public list — the home Latest guide. (Division + home pages render from this same public API.)
[PASS] 3. sitemap — /sitemap.xml (HTTP 200, <n> URLs) contains /pages/article?id=34.
[PASS] 4. meta — API record carries title "<title>" + excerpt (<n> chars); expected canonical https://fs-ai-5w5.pages.dev/pages/article?id=34, og:title "<title> — FS AI"; served article.html contains the setMeta calls for og:title / og:description / og:url / twitter:title. No-JS note: the raw page HTML still shows the generic fallback ("Loading article…") — a no-JS crawler sees generic title/canonical, per the A3 crawler report; the per-article values are applied by JS after load.
[PASS] 5. counts — live published total 26 = baseline 25 + 1; article #34 appears exactly once. MANUAL (required before recording the proof): confirm on the dashboard (Content Management → Articles, filter Draft) that drafts went 7 -> 6. Drafts are never served publicly, so no script can verify that move — if the dashboard draft count did not move by exactly -1, STOP and do not record the proof.

RESULT: PASS — all 5 checks passed.

MANUAL STEP FIRST: confirm on the dashboard (Content Management → Articles, filter Draft)
that drafts went 7 -> 6. Only then run this SQL via the D1 API:

INSERT OR REPLACE INTO autonomy_settings (key, value, updated_at) VALUES ('auto_publish_proof', '{"articleId":34,"verifiedAt":"...","verdict":"pass","checks":{"page":"pass","divisionHome":"pass","sitemap":"pass","meta":"pass","counts":"pass"},"counts":{"publishedBefore":25,"publishedAfter":26}}', '...');

After the SQL runs, the next daily health report will show autoPublishProof: OK for this article.
```

Exit code is 0 only when every check is PASS. Any FAIL or WAIT
exits non-zero and **no proof SQL is printed**.

### If check 3 says WAIT

```
[WAIT] 3. sitemap — /sitemap.xml (HTTP 200) does not contain /pages/article?id=34 yet. The sitemap refreshes HOURLY (top of the hour, sitemap-refresh workflow) — wait for the next refresh and re-run this script. Do not record the proof until this check passes.
```

Wait until after the next top-of-hour refresh (the workflow commits
only when the file changed, then Pages redeploys — allow a few
minutes past the hour), then re-run the same command. A WAIT is not
a failure of the publish; it is the sitemap pipeline doing its
hourly job.

### If a check says FAIL

Stop. Do not record any proof. The failure is the finding: read the
evidence printed with the check, fix the cause, and re-run. Common
causes: the article id is wrong (check 1), the article is not the
newest published article (check 2 — something else published first),
the sitemap refresh workflow failed (check 3 — see its GitHub Actions
run), or the published total is not baseline + 1 (check 5 — another
article published in between, or the baseline moved: update
`PUBLISHED_BEFORE` / `DRAFTS_BEFORE` at the top of the script only
if the dashboard confirms the new baseline, never to make a FAIL go
away).

## The SQL step (parent runs this, not the script)

1. Confirm the manual draft step: dashboard → Content Management →
   Articles, filter Draft — drafts must read **6** (was 7). If it
   does not read 6, **STOP** — do not run the SQL; the publish did
   something unexpected and needs investigation first.
2. Run the exact SQL the script printed (it contains the verified
   proof JSON) via the D1 API against the live database:
   `INSERT OR REPLACE INTO autonomy_settings (key, value, updated_at)
   VALUES ('auto_publish_proof', '<JSON>', '<ISO timestamp>');`
   This is a settings-row write only — it touches no article.
3. Verify the row landed:
   `SELECT key, value FROM autonomy_settings WHERE key = 'auto_publish_proof';`
   The value must be the JSON the script printed, verdict `pass`.

## What the next daily health report will show

The A5 Daily Autonomy Health Report (close-out A5, stored in the
daily report's `summary.healthReport`) has an `autoPublishProof`
check that reads exactly this key:

- **Before the SQL runs:** `autoPublishProof: NOT TESTED` —
  "No auto-published article has been verified yet — run
  docs/CLOSEOUT-A6-AUTO-PUBLISH-PROOF-2026-11-23.md after the first
  real auto-publish; its result is recorded here."
- **After the SQL runs:** `autoPublishProof: OK` with the article id,
  verification time and verdict in the detail.
- **If the recorded proof ever has a verdict other than `pass`, or
  the value is not parseable JSON:** `autoPublishProof: FAIL`.

The proof key is deliberately **excluded** from the health report's
`settings` snapshot (A5 check 9) — recording the proof must never
show up as a "settings changed" warning. It is a verification
artifact, not a setting.

## Files

- `scripts/verify-auto-publish.mjs` — the verification script (Node,
  no dependencies beyond the platform fetch; single argument: the
  article id).
- `backend/services/daily-health-report.js` — check 13
  (`autoPublishProof`) reads the `auto_publish_proof` key; unit tests
  in `tests/closeout-a5.test.js` prove a stored `pass` proof flips
  that check to OK, a `fail` verdict flips it to FAIL, and malformed
  JSON flips it to FAIL.
- Ledger: `docs/CLOSEOUT-LEDGER-2026-11-23.md` (A6 entry).

## Status

**BUILT, write-only, NOT RUN.** Written alongside A5 (2026-11-23).
Not run against any real article — none exists yet. First run is due
immediately after the first real auto-publish.
