# FS AI — GATE BOTTLENECK PROPOSALS — 2026-11-24

Fix Pass 4 F6. **PROPOSALS ONLY — no gate was changed, no article was
touched, nothing was published.** Every number below comes from the
Phase 1 READ (`docs/FIXPASS4-READ-FINDINGS-2026-11-24.md`, §R2);
nothing was re-derived from live D1 for this doc. Where R2 marks a
number DERIVED or a precondition inferred, this doc says so.

## The short answer to "why has nothing auto-published since 22 Nov?"

**0 of 7 drafts are auto-publishable, and the gate is refusing them for
honest reasons — it is working as designed, not broken.** The two
drafts the auto-publish path actually evaluates (#34, #35) fail
fact-check outright (4/14 and 6/18 verified, 10 and 12 failed claims).
The other five (#28–#31, #33) are never evaluated by the auto path at
all: #28–#31 are refused by legacy id and #33 by a pre-cutoff
timestamp, both owner rules that need a separate per-article decision
each. The binding constraint underneath almost everything is thin
evidence: 6 of the 7 drafts were fact-checked against ≤500 chars of
RSS summary, and the one draft with full-text evidence (#33, 3,985
chars) passed 15/15.

## How to read the verdicts

Two evaluators live in `backend/publishing/gate.js`:

- `evaluatePublishGate()` (10 checks) — the daily `publishGate` step
  evaluates every draft but writes no `publication_logs` row.
- `evaluateAutoPublishEligibilityPure()` (14 checks, strictly harder:
  legacy/timestamp guard, fresh SEO 11/11, duplicate overlap **exactly
  0%**, every internal link genuinely relevant, Health/Finance never
  auto-eligible, banner gone) — used only by `runAutoPublish()`, which
  tries NEW candidates only (created after the cutoff
  `2026-11-22T04:55:28Z`, never legacy #28–#31, never protected).

So #34/#35 verdicts are **LOGGED** (quoted from `publication_logs`
rows 2 and 3, 24 Nov); #28–#31/#33 verdicts are **DERIVED** (the gate
code applied to live D1 rows). Common to all 7 (passing): Emergency
Stop OFF, daily limit 0/1, publishing mode auto, auto-publishing on,
none is Health/Finance, each has exactly 1 source with a URL (division
minimum 1).

## Per-draft proposals

### #28 — "What a billion-dollar deal says about the US battery market" (ai-technology) — 7/14, DERIVED

- **Failing checks:** legacy id; fact-check-current (needs-review 6/7,
  fc 38, 23 Nov); no-unresolved-errors (1 failed — the interpretive
  claim *"The Sila–Panasonic agreement represents more than just a
  commercial contract…"*); seo-fresh-pass (needs-review); duplicate
  2% vs draft #30 (≠ 0%); readability (avg word 6.7 chars);
  internal-links (body links #14 *"7 Free AI Tools That Actually Save
  Time"* — same division, no topical keyword overlap).
  **Passing:** sources-verified (1 URL; all 6 VERIFIED claims cite
  URLs); correction-recheck (B6-adjusted count 0 — the single failed
  correction does not appear in fresh fc 38 at all);
  publication-preconditions (banner leading, position 1 — inferred
  PASS, not directly observed; see the caveat at the end).
  Evidence: 357 chars (item 154, RSS).
- **Binding blocker:** the single failed interpretive claim — a
  357-char snippet cannot support a "turning point for the U.S.
  battery market" sentence. Readability and the #14 link are secondary.
- **Options:**
  1. *Correction round (owner-authorized):* rewrite or drop the one
     failed claim, fix or replace the #14 link, shorten long words /
     sentences, then fresh fact-check + SEO and decide again. Cost: one
     agent correction pass + the owner's per-article go-ahead (the
     draft is protected from editing). Risk: low — nothing publishes
     until the gate passes or the owner overrides. Unblocks: a
     fact-check PASS is the only way this draft ever auto-publishes.
  2. *Manual publish with the override:* dashboard → Publish → type
     the audited override phrase `PUBLISH DESPITE GATE` in the
     confirmation-phrase field. Cost: none. Risk: publishes an article
     with a failed claim and a needs-review SEO — the override is
     recorded in `article_publish_overrides`, but the article still
     says something the evidence does not support. **Not recommended.**
  3. *Discard:* same Delete step as the Owner Pack (delete was fixed
     in Fix Pass 2 — FK-safe batch delete, deployed; a live delete has
     not been tested since the fix, so if Delete errors, report the
     exact error and do not retry).
     Cost: loses a near-miss draft. Risk: none to quality.
- **Recommendation: HOLD — do not publish yet.** (Owner Pack position,
  unchanged.) Ask the agent to run one correction round on the 1
  failed claim + the #14 link, then a fresh fact-check + SEO, and
  decide again on the new numbers.
- **Owner action:** none now. When the correction round is done, the
  owner decides publish / hold again on the fresh numbers.

### #29 — "A local's travel guide to Austin: what to eat, see and do in three days" (travel-lifestyle) — 9/14, DERIVED

- **Failing checks:** legacy id; fact-check-current (verdict `failed`,
  fc 39, 24 Nov); seo-fresh-pass (needs-review); duplicate **32% vs
  draft #30** (≠ 0%); readability (avg sentence 39.5 words).
  **Passing:** no-unresolved-errors (0 failed claims — fc 39 has **0
  claim rows at all**: the checker found nothing verifiable in a
  601-char body); sources-verified (1 Guardian URL recorded, though no
  stored evidence); correction-recheck (0); internal-links (links #19,
  relevant via "travel"); preconditions (no banner; structured-metadata
  ok). Evidence: **0 chars — no research_item at all** (source type
  `other`, `research_item_id` NULL).
- **Binding blocker:** there is no evidence to check anything against.
  The Guardian's terms prohibit AI use of its content, so the fetch
  feature refuses Guardian pages (`terms-prohibit-ai-use`); without
  the Guardian Open Platform API key there is no licensed route to
  full Guardian text. The 32% overlap with #30 (shared Guardian
  travel-guide boilerplate) is secondary but real.
- **Options:**
  1. *Discard (Owner Pack position):* 601 chars, zero verified claims,
     no evidence. Cost: loses the draft. Risk: none to quality — the
     article says nothing verifiable. **This is the recommendation.**
  2. *Rebuild after the Guardian key + worker path:* register the free
     key (steps in §"The Guardian key" below), build the worker path,
     re-fetch full text, rewrite the body from it, fresh fact-check +
     SEO. Cost: the owner's key registration + a new build + a full
     re-check. Risk: medium — even with evidence, the 32% overlap vs
     #30 and the 39.5-word sentences still need a rewrite. Unblocks: a
     genuinely new article, not this draft as it stands.
  3. *Manual publish with the override:* **do not publish as-is — 0
     verified claims.** (Owner Pack, unchanged.)
- **Recommendation: DISCARD in principle (keep as draft for now).**
  (Owner Pack position, unchanged.) If the owner does not want to
  wait for the Guardian key + worker path, discard it.
- **Owner action — exact:** dashboard → Content Management → Articles
  → filter Draft → find #29 → click **Delete** → confirm. Expected
  result: the draft is deleted (delete was fixed in Fix Pass 2 —
  FK-safe batch delete, deployed run #62; the old B4 foreign-key
  failure no longer applies). A live delete has NOT been tested since
  that fix — if Delete errors, report the exact error to the agent
  and do NOT click Delete again and again.

### #30 — "A local's travel guide to New York City: what to eat, see and do in three days" (travel-lifestyle) — 9/14, DERIVED

- **Failing checks:** legacy id; fact-check-current (needs-review 7/19,
  fc 35, 22 Nov); no-unresolved-errors (12 failed claims);
  correction-recheck (B6-adjusted count **3** — corrections ids 24,
  29, 31 match fc 35 claims judged UNSUPPORTED); duplicate 6% vs
  draft #35 (≠ 0%). **Passing:** seo-fresh-pass (**PASS 11/11**,
  seo 27); readability; internal-links (links #19, relevant via
  "travel"); sources-verified (1 URL; all 7 VERIFIED claims cite URLs
  — the 5 NULL-evidence rows in fc 35 are all UNSUPPORTED, not
  VERIFIED); preconditions (banner leading, position 1 — inferred
  PASS). Evidence: 500 chars (item 382, RSS).
- **Binding blocker:** 12 failed claims, mostly UNSUPPORTED /
  CONFLICTING — checked against a 500-char RSS snippet, and some
  claims could only be checked against Guardian sources, which the
  fetch feature refuses.
- **Options:**
  1. *Correction plan after the Guardian key:* register the key, build
     the worker path, re-check the 12 failed claims against full
     Guardian text, correct or drop the ones that still fail, then
     fresh fact-check + SEO. Cost: the owner's key registration + a
     build + a correction pass + the owner's per-article go-ahead.
     Risk: low. Unblocks: the only route to a fact-check PASS.
  2. *Correction plan without the Guardian key:* correct the 12
     failed claims from non-Guardian evidence only, or drop the
     claims that cannot be supported. Cost: a correction pass.
     Risk: medium — claims whose only source is Guardian text cannot
     be verified this way and must be dropped, which may gut the
     article.
  3. *Manual publish with the override:* **not recommended** — 12
     failed claims is too many to override. (Owner Pack position.)
- **Recommendation: HOLD — do not publish yet.** (Owner Pack
  position, unchanged.) Ask the agent for a correction plan for the
  12 failed claims (after the Guardian key, if Guardian evidence is
  needed), then a fresh fact-check + fresh SEO, and decide again.
- **Owner action:** none now — except the Guardian key decision
  (below), which is the precondition for option 1.

### #31 — "Will More International Students Enroll Next Year?" (education-learning) — 11/14, DERIVED — closest to publishable

- **Failing checks:** legacy id; seo-fresh-pass (needs-review);
  internal-links (SEO internal-links fails). **Passing:** everything
  else, including fact-check-current (**PASS 3/3**, fc 25, 21 Nov)
  and duplicate-zero-overlap (**0%**). The body (549 chars, read
  verbatim) links **no** article at all — only the external Inside
  Higher Ed URL. The SEO detail is exact: *"No genuinely relevant
  published article exists in this division to link to — no link will
  be faked to satisfy this check."* The only published education
  article is #22 *"How to Learn a New Digital Skill in 30 Days"*
  (topically unrelated). Evidence: 307 chars (item 675, RSS).
- **Binding blocker:** none on content. The gate stays Blocked only
  because the SEO verdict is needs-review on one by-design check
  (internal-links), plus the legacy-id owner rule.
- **Options:**
  1. *Manual publish with the override (recommended):* the article
     is clean — fact-check fully passes, duplicate 0%, and the single
     SEO miss is by design, not a real defect. Publishing it is a
     deliberate manual override of a Blocked gate for a documented
     by-design reason — that is exactly what the manual Publish
     button is for. Cost: none. Risk: low — the override is recorded
     in `article_publish_overrides`, and nothing in the article is
     unverified. Side benefit: once published, #31 becomes the first
     candidate relevant sibling for #33/#34's internal-links check
     (re-run their SEO after publishing and measure — see §"The
     internal-links deadlock" below; relevance is topical-keyword
     based, so this is a try-and-measure step, not a guarantee).
  2. *Hold until a relevant education sibling exists:* costs the
     cleanest draft in the backlog while waiting for a future
     education article to publish first — but no future education
     article can auto-publish either if it also hits internal-links,
     so this waits on the same deadlock it is trying to avoid.
  3. *Discard:* no reason — the content is verified.
- **Recommendation: PUBLISH.** (Owner Pack position, unchanged.)
- **Owner action — exact:** dashboard → sign in as Owner → Content
  Management → Articles → filter Draft → find #31 → click
  **Publish** → in the confirmation-phrase field type exactly
  `PUBLISH DESPITE GATE` → confirm. Expected result: the status pill
  changes to Published; the article opens at
  `https://fs-ai-5w5.pages.dev/pages/article?id=31`; the published
  total moves 25 → 26. **After publishing, tell the agent at once**
  — the auto-publish proof baseline (25 published / 7 drafts,
  recorded 2026-11-23) changes, and the next daily run's counts move
  with it.

### #33 — "M State's Detroit Lakes campus to close amid systemwide budget woes" (education-learning) — 10/14, DERIVED

- **Failing checks:** legacy/timestamp guard — **timestamp only**
  (created `2026-11-22T00:02:10Z` < cutoff `04:55:28Z`); seo-fresh-pass
  (needs-review); duplicate 6% vs draft #34 (≠ 0%);
  internal-links (same no-sibling failure as #31). **Passing:**
  fact-check-current (**PASS 15/15**, all claims VERIFIED with
  evidence URLs, fc 34, 22 Nov); no-unresolved-errors (0 failed);
  sources-verified; correction-recheck (B6-adjusted count **0** —
  all 4 failed correction rows match claims fc 34 judged VERIFIED on
  full evidence; the earlier reading that the gate "still counts 4
  stale rows" is **wrong under B6**); readability; preconditions
  (banner leading, position 1 — inferred PASS). Evidence: **3,985
  chars** (item 714, `article-fetch`, extraction `ok`) — the only
  draft with full-text evidence, and the only one that passed
  fact-check 15/15. That is the pattern in one line.
- **Binding blocker:** the pre-cutoff timestamp — an owner rule, not a
  content defect. The 6% duplicate vs draft #34 and the by-design
  internal-links miss are secondary.
- **Options:**
  1. *Manual publish with the override (recommended):* the Owner
     Pack's condition is now met — the SEO check it was waiting for
     **ran on 24 Nov: needs-review 10/11, internal-links only**.
     Fact-check fully passes on full-text evidence, B6 corrections
     are 0, and the remaining misses are the timestamp rule (owner
     decision), a 6% overlap vs another *draft*, and the by-design
     internal-links check. Cost: none. Risk: low — same shape as
     #31, and the override is recorded. Note: publishing #33 does
     NOT clear #34's duplicate check — 6% vs now-*published* #33
     still fails the exactly-0% rule, so #34 still needs a rewrite
     (see §"The duplicate comparator" below).
  2. *Hold for the duplicate/internal-links to clear first:* the
     duplicate only clears if #34 is rewritten to 0% overlap, and
     internal-links only clears if a relevant education sibling
     publishes first — both are other drafts' work, not #33's. Waiting
     keeps a fully-verified article unpublished for other articles'
     sake.
  3. *Discard:* no reason — 15/15 verified on full-text evidence.
- **Recommendation: PUBLISH.** (Owner Pack position was "HOLD until
  one SEO check runs — then publish"; that check has now run, so the
  position becomes PUBLISH.)
- **Owner action — exact:** same as #31, but for id 33: dashboard →
  Publish → type exactly `PUBLISH DESPITE GATE` in the
  confirmation-phrase field → confirm. Expected result: the article
  opens at `https://fs-ai-5w5.pages.dev/pages/article?id=33`; the
  published total moves 25 → 26 (or 26 → 27 if #31 went first).
  Tell the agent at once after publishing.

### #34 — "The spirit of a borderless Europe steams from the pots and pans of Vienna" (education-learning) — 9/14, LOGGED (row 2)

- **Failing checks (publication_logs row 2, 2026-11-24 00:06:55,
  quoted in substance):** fact-check-current (needs-review **4/14**,
  fc 40, 24 Nov); 10 failed claims; seo-fresh-pass (needs-review,
  seo 28: 10/11, internal-links only); duplicate 6% vs draft #33
  (≠ 0%); internal-links. **Passing:** not-legacy-draft (created
  after the cutoff); sources-verified (1 source); correction-recheck
  (0 open); readability; special-review; E-Stop; daily-limit;
  publishing-rules; preconditions. Evidence: 372 chars (item 709,
  RSS). Row 1 (23 Nov 00:04:24) was pure timing — created 57 s
  before publishGate ran, no checks on record yet.
- **Binding blocker:** the fact-check (4/14, 10 failed claims).
  **Even if the duplicate and internal-links blockers were fixed, the
  fact-check still blocks #34.** The duplicate comparator is draft
  #33 and the internal-links miss is the same no-sibling failure as
  #31/#33.
- **Options:**
  1. *Correction round (owner-authorized):* correct or drop the 10
     failed claims, rewrite to 0% overlap vs #33, then fresh
     fact-check + SEO. Cost: a correction pass + the owner's
     go-ahead (#34 is READ-ONLY under the Fix Pass 4 brief, so no
     edit can happen in this pass). Risk: low. Unblocks: the only
     route to auto-publishable.
  2. *Manual publish with the override:* **not recommended** — 10
     failed claims is too many to override, and the SEO is
     needs-review.
  3. *Discard:* premature — the article is new (created 23 Nov) and
     its claims have not had a correction round yet.
- **Recommendation: HOLD — do not publish yet.** Ask the agent for a
  correction plan for the 10 failed claims (after this pass, with the
  owner's per-article go-ahead), then a fresh fact-check + SEO, and
  decide again.
- **Owner action:** none now. The correction round needs the owner's
  go-ahead naming #34.

### #35 — (travel-lifestyle) — 7/14, LOGGED (row 3)

- **Failing checks (publication_logs row 3, 2026-11-24 00:07:00):**
  fact-check-current (needs-review **6/18**, fc 41, 24 Nov); 12
  failed claims; seo-fresh-pass / duplicate / readability /
  internal-links — all "No SEO check on record" (no `seo_checks` row
  exists for #35; the 24 Nov seoRun checked only 3 articles and #35
  was not among them); publication-preconditions ("Structured-metadata
  check missing from the latest SEO run"). **Passing:**
  not-legacy-draft (created after the cutoff); sources-verified;
  correction-recheck (0); special-review; E-Stop; daily-limit;
  publishing-rules. Evidence: 500 chars (item 711, RSS). The body has
  **no** internal link and a leading banner (position 1).
- **Binding blocker:** the fact-check (6/18, 12 failed claims) —
  and there is not even an SEO row yet, so the gate cannot pass it on
  any reading.
- **Options:**
  1. *Correction round + first SEO run (owner-authorized):* correct
     or drop the 12 failed claims, add a relevant internal link if
     one exists, then fresh fact-check + a first SEO check. Cost: a
     correction pass + the owner's go-ahead (#35 is READ-ONLY under
     the Fix Pass 4 brief). Risk: low. Unblocks: the only route to
     auto-publishable.
  2. *Manual publish with the override:* **not recommended** — 12
     failed claims and no SEO row at all.
  3. *Discard:* premature — same as #34, it has not had a correction
     round yet.
- **Recommendation: HOLD — do not publish yet.** Ask the agent for a
  correction plan for the 12 failed claims + a first SEO run (after
  this pass, with the owner's per-article go-ahead), then decide
  again on the fresh numbers.
- **Owner action:** none now. The correction round needs the owner's
  go-ahead naming #35.

## The duplicate comparator — should the auto rule compare only against PUBLISHED articles?

**The question.** The gate's SEO suite compares 5-word shingle overlap
against ALL articles (drafts included). The old detail text said
"overlap with another **published** article" — F3 fixed the text to
"another article", so the gate is now honest about its comparator. The
open question is whether the comparator itself should change.

**The facts.** All five non-zero overlaps are vs other **drafts**
(#28 2% vs #30; #29 32% vs #30; #30 6% vs #35; #33 6% vs #34; #34 6%
vs #33) — none vs a published article. So under the current rule,
drafts block each other: #33 and #34 mutually block each other at 6%,
and #29/#30 share 32% of Guardian travel-guide boilerplate.

**Option A — keep comparing against ALL articles (status quo).
RECOMMENDED.** The mutual blocking is protective, not just annoying:
if the comparator were published-only, #29's 32% overlap vs draft #30
would pass the duplicate check, and two near-identical travel guides
could both auto-publish on successive days once their other checks
passed. The drafts that share overlap are precisely the ones with
other, deeper blockers (#29's failed fact-check, #30's 12 failed
claims, #34's 10 failed claims) — changing the comparator publishes
nothing by itself; it only removes one blocker from four drafts that
still cannot publish. Cost: the mutual block stays until one of each
overlapping pair is rewritten to 0%. Risk: none to quality.
Owner decision needed: none — this is the current behaviour.

**Option B — compare only against PUBLISHED articles for the AUTO
rule.** This would clear the duplicate check for #28 (2% vs draft
#30), #30 (6% vs draft #35), #33 (6% vs draft #34) and #34 (6% vs
draft #33) — but none of the four becomes publishable on that alone
(#28 still fails fact-check + readability + links; #30 still has 12
failed claims; #33 still has the timestamp + internal-links; #34
still has 10 failed claims). Cost: a code change + tests + a deploy,
and a deliberate loosening of a safety property. Risk: two
near-duplicate drafts (worst case #29/#30 at 32%) could both reach
the published site. Note also that publishing one of a pair does NOT
help the other under either comparator — 6% vs a *published* #33
still fails the exactly-0% rule for #34, so the sibling still needs a
rewrite either way. **Not recommended.** If the owner wants it anyway,
it needs an explicit owner decision naming this change, recorded as a
deliberate loosening — the brief forbids loosening any gate without
one.

## The internal-links deadlock — #31 / #33 / #34

**The question.** #31, #33 and #34 all fail internal-links for the
same reason: no genuinely relevant *published* article exists in
education-learning to link to (only #22, topically unrelated). The SEO
detail is exact: *"No genuinely relevant published article exists in
this division to link to — no link will be faked to satisfy this
check."* This cannot be satisfied until a relevant education article
is published first. #28's internal-links failure is different and
fixable (it links #14 with no topical overlap — remove or replace the
link).

**Option A — publish a relevant education article first, then
re-measure. RECOMMENDED.** #31 is the candidate: it is the cleanest
draft, its own publish recommendation does not depend on any sibling
(its body links no article at all), and once published it becomes the
first candidate relevant sibling for #33/#34. After #31 publishes,
re-run the SEO check for #33 and #34 and measure whether #31 counts
as a relevant sibling for them. **Honest caveat:** relevance is
topical-keyword based (`isInternalLinkRelevant`), and #31
(international student enrollment) may not share keywords with #33
(campus closure / budget woes) or #34 (Vienna food and culture, filed
in education-learning). So this is a try-and-measure step, not a
guarantee. If #31 is not a relevant sibling for them, the next
education draft from the daily pipeline is the sibling — the daily
research + content flow produces education drafts regularly, and F3's
evidence enrichment makes future ones stronger.
Owner decision needed: the #31 publish decision above (one action,
not a rule change).

**Option B — relax the relevance requirement. FORBIDDEN without an
explicit owner decision, and NOT recommended.** `internal-links` is in
`NEVER_WAIVABLE_SEO_CHECKS` (`gate.js:57`) alongside `duplicate`:
an unrelated internal link and a duplicate body are safety properties,
not presentation, and the Fix Pass 4 brief forbids loosening any
quality, fact-check, SEO, duplication or publish gate. The default
waiver list is empty (no waivers). Relaxing it would let the site
publish articles that link to unrelated articles purely to satisfy a
check — the exact thing the check exists to prevent. If the owner
wants it anyway, it needs an explicit owner decision naming this
change, recorded as a deliberate loosening.

**Option C — keep holding #31/#33/#34 on internal-links.** Cost: the
backlog grows and nothing publishes — including #31, which has no
content defect at all. The deadlock is self-reinforcing: no future
education article can auto-publish either if it also hits
internal-links, so waiting for "a relevant sibling" while holding the
only clean candidate waits on the same deadlock it is trying to
avoid. **Not recommended.**

## The systemic cause — thin evidence, and what F3 does and does not fix

**The cause.** `parseFeedXml` truncates every RSS/Atom item summary to
500 chars (`backend/rss/rss.js:80,84`), and that summary **is** the
stored evidence (`backend/rss/sources.js:176–177`). Measured since 18
Nov: 726 RSS items, max evidence 500 chars, avg 200.5. Only ONE
full-text evidence row exists (item 714, #33's source, 3,985 chars,
via `article-fetch`). The pattern is exact: the only draft with
full-text evidence (#33) passed 15/15; every draft checked against a
300–500-char snippet has failed claims; #29 is the extreme (no stored
evidence at all, 0 claim rows).

**What F3 fixes (already deployed, run #75):** a new `evidenceEnrich`
step fetches full-text evidence for drafts the drain just converted,
before fact-checking runs — one call per drain-converted draft (max
1/day), only to its recorded `article_sources` URL, through the
existing `fetchArticleEvidence` service with all its robots/terms
compliance, failing closed to the RSS snippet on any refusal or
failure. F3 also fixed the double-fetch and made the daily counts
honest, and fixed the duplicate-overlap wording. **This helps FUTURE
drafts, not the existing 7** — #28–#31/#33 are protected from
editing and #34/#35 are READ-ONLY under the Fix Pass 4 brief, so no
existing draft's evidence can be re-fetched in this pass.

**What can still be done for the existing drafts (within the rules):**

1. *Owner-authorized correction rounds* (per draft above): the agent
   corrects or drops the failed claims and the owner authorizes the
   edit naming the article. This is the route for #28, #30, #34, #35.
2. *The Guardian key* (for #29/#30 — see below): the only licensed
   route to full Guardian text. Without it, Guardian-sourced claims
   can only be dropped, not verified.
3. *Owner-written bodies:* the owner may supply his own corrected body
   text for a draft (he has done this before — #30's correction was
   applied from his authorization). The agent then re-runs fact-check
   + SEO on the new body.
4. *A future pass that re-enriches existing drafts' evidence:* fetch
   full text for an existing draft's recorded source URL, store it as
   a new research item, re-link `article_sources`, re-run fact-check
   + SEO. This is a D1 write + article-adjacent change, so it needs
   the owner's per-article go-ahead and is NOT part of Fix Pass 4.

## The Guardian key — the #29 / #30 evidence unblocker (owner steps)

Full detail: `docs/OWNER-ACTIONS-2026-11-23.md` §4. Summary:

1. Go to **https://open-platform.theguardian.com/access/**
2. Choose the **Developer key** tier and fill in the short form (name,
   email, what is being built).
3. The key is emailed right away — no approval wait, no card. Free for
   non-commercial use: 500 calls a day, 1 call per second (commercial
   use needs a paid key — do not apply for that; FS AI uses the free
   Developer key only).
4. Give the key to the agent when it asks. Never paste it into this
   document or any public place.
5. **The key alone fixes nothing.** The worker path to use it does NOT
   exist yet — the agent builds it after the owner gives the key: a
   Guardian API client in the Worker calling
   `https://content.guardianapis.com` with the key as the `api-key`
   parameter and `show-fields=bodyText`, fetching ONLY URLs already
   recorded as `article_sources` URLs for the article being checked.

Status: BLOCKED-OWNER. No key has been registered, and no worker path
has been built.

## Owner decisions still needed (checklist)

1. **#31 — PUBLISH?** Dashboard → Publish → type exactly
   `PUBLISH DESPITE GATE`. (Recommended: yes.)
2. **#33 — PUBLISH?** Same step, id 33. (Recommended: yes — the SEO
   check the Owner Pack was waiting for has now run: 10/11,
   internal-links only.)
3. **#29 — DISCARD?** Dashboard → Delete (delete was fixed in Fix
   Pass 2; if it errors, report the exact error — do not retry).
   (Recommended: discard in
   principle.)
4. **#28 / #30 / #34 / #35 — authorize a correction round?** Each
   needs the owner's go-ahead naming the article. (#28: 1 failed
   claim + #14 link; #30: 12 failed claims; #34: 10 failed claims;
   #35: 12 failed claims + first SEO run.)
5. **Guardian Open Platform API key?** Register the free Developer
   key (steps above) and hand it to the agent — the precondition for
   fixing #29/#30's Guardian-sourced claims.
6. **Duplicate comparator — keep (Option A) or change to
   published-only (Option B)?** (Recommended: keep. Option B needs
   an explicit owner decision naming the change.)
7. **Internal-links — publish #31 first and re-measure (Option A),
   or keep holding (Option C)?** (Recommended: Option A. Option B,
   relaxing the requirement, is forbidden without an explicit owner
   decision.)

## What this doc does NOT do (honesty block)

- No gate was changed, no threshold was moved, no waiver was added.
  `NEVER_WAIVABLE_SEO_CHECKS` (`internal-links`, `duplicate`) is
  untouched.
- No article was published, edited, or deleted. #28–#31/#33 are
  protected; #34/#35 are READ-ONLY under the Fix Pass 4 brief.
- No live D1 write was made for this doc. No test suite was run
  (docs-only item).
- The DERIVED verdicts for #28–#31/#33 are computations from live D1
  + `gate.js`, not logged rows — `runAutoPublish` never evaluates
  them. The `publication-preconditions` = PASS for #28/#30/#33 is
  *inferred* (banner leading at position 1, strips like #34's, whose
  live row 2 passed preconditions; structured-metadata ok in each SEO
  row), not directly observed.
- These numbers are a 24 Nov 2026 snapshot. They will move after the
  25 Nov 00:00 UTC daily run (fresh fact-checks/SEO may change #34 /
  #35; F3's enrichment affects future drafts, not these seven).
