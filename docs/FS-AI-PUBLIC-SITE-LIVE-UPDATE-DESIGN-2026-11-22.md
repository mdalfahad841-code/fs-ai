# FS AI — Public Site Live-Update Design (Phase 0, 22 November 2026)

**Status: DESIGN ONLY — NOT BUILT. Awaits owner review before Phase 2.**
**Scope:** how an auto-published article reaches the public site today (it does not), and the least-risky design that makes it reach the public site without a manual deploy.
**Rules carried from the brief:** additive only; the static bundle stays as a fallback; canonical/title/meta handling unchanged; CORS/CSP keep working; $0; no protected article (#28–#31, #33), no settings, no schedule, no secret touched.

## 1. Findings — what happens today

### 1(a). When `autoPublishArticle()` publishes a new article to D1, does anything add it to app.js, the article page, the home page lists or the division pages?

**No. Nothing does. The publish ends at the database.**

- `autoPublishArticle()` — `backend/agents/autonomy/publishing.js`. Pre-flights (audit table, article exists, eligibility gate, protected-article check, banner strip, idempotency) → a D1 `UPDATE articles SET status='published', published_at=...` (the flip; the exact statement is in the publish section before line 425) → `regenerateSitemap(env)` (lines 439–441, in-memory XML only) → `logPublicationAttempt()` (a `publication_logs` row, lines 454–458). On any failure after the flip the article is rolled back. **No step writes a file, calls the GitHub API, or triggers a deploy.** The module header states it outright (`publishing.js:41–47`): "The Worker cannot rewrite the checked-in public/sitemap.xml at runtime, so the caller (deploy step / a future dynamic /sitemap.xml route …) must write/serve the returned XML."
- `publishDueArticles()` (the scheduled path) — `backend/routes/admin-articles.js:404–460`. It flips due `status='approved'` rows to `'published'` in D1 (with the banner-strip rule), writes one `agent_activity_logs` row, and returns. Nothing else.
- **No script syncs D1 → app.js.** `scripts/` contains only `generate_seo_fields.py`, `regenerate-sitemap.mjs`, `render-social-card.py`, `restore-backup.js` — none touches `app.js` or the `ARTICLES` array.
- **No deploy is triggered by a publish.** A repo-wide search finds no GitHub API call and no Pages deploy hook in `backend/` (the only "github" hits are an account record in `backend/routes/accounts.js:25` and RSS feed URLs). No `writeFile`, KV `put` or R2 write exists in `backend/`.
- **The public pages read only the static bundle.** `frontend/scripts/app.js:86` defines `var ARTICLES = [...]` — exactly 25 entries, ids 1–25. `frontend/pages/article.html` renders via `window.FSAI.articleById(id)` (`articleById` is `ARTICLES.find(...) || null`, `app.js`); `frontend/pages/division.html` lists via `articlesByDivision()` over the same array; `frontend/index.html` renders its Latest-articles grid, division grids, counts and search from the same array, and hardcodes "25 articles" in its meta description, JSON-LD, hero stats and search placeholder (`index.html:10,16,20,21,48,59,72`).
- **The Worker's own public endpoint already reads D1 — but the frontend never calls it.** `GET /api/articles` and `GET /api/articles/:slug` (`backend/worker.js:98` → `handleArticles`, `backend/routes/articles.js:132–171`) read the `articles` table when `env.DB` is bound (published-only, active-division-only, `publish_at` respected; `PUBLIC_LIST_SQL`/`PUBLIC_SINGLE_SQL`, lines 23–34), with the same static 25-article list as fallback only when D1 is unbound. `publicArticle()` (line 94) returns the D1 row as-is (banner lines stripped). But `frontend/scripts/app.js` contains **zero** `fetch(`/`XMLHttpRequest`/Worker-URL references — the public article/division/home pages never contact the Worker. Only the dashboard, auth and newsletter scripts do (`dashboard.js:13`, `authentication.js:18`, `newsletter.js:9`, `autonomy.js:16` — all `API_BASE = 'https://fs-ai.mdalfahad841.workers.dev'`).

### 1(b). What exactly would a visitor see for a new article id?

Take a freshly auto-published article, id 34, as the example. The visitor sees **no trace of it anywhere**:

- **Article page** `/pages/article?id=34`: `articleById(34)` returns `null` → `article.html:56` renders `<h1>Article not found</h1><p>That article does not exist. <a href="../">Browse all 25 articles on the home page</a>.</p>`. (Proven live: ids 26, 28, 33, 999 and 0 all showed exactly this screen in the 22 Nov browser verification.)
- **Home page:** not in Latest articles, not in any division count, not in search — all read the static array. The hardcoded "25 articles" strings stay 25.
- **Division page:** not listed (`articlesByDivision` over the static array).
- **Sitemap:** not listed — the served `sitemap.xml` is the committed file; the publish-time regenerated XML exists only in memory (see the 22 Nov verification report, §7).
- **Search engines:** nothing to index.

**Net effect: auto-publish today publishes to the database but not to the public site.** The public site is frozen at the last manual deploy's 25 articles. A new article becomes publicly visible only when someone pushes a new deploy that carries an updated `app.js` (which today nobody does automatically). This is the last-mile block on fully autonomous operation.

## 2. Design — the least-risky way to make the public site update without a manual deploy

Principles: additive only (no existing file's behaviour is removed); the static bundle is the fallback and is never deleted; the existing canonical/title/meta code runs unchanged on whatever data it receives; no change to the publish path, gates, or settings; CORS already works; $0.

### 2.1 Live article data on the public pages (frontend change, Worker endpoint already exists)

**What changes:** one small loader, added to `frontend/scripts/app.js` (or a new `frontend/scripts/live-articles.js` loaded by the article/division/home pages). On page load it fetches `GET https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100` (list pages) and, on the article page, the single-article read for the requested id. It then **merges** the live published list over the static `ARTICLES` array:

- Live rows win for ids present in both (same id, fresher data).
- Live-only ids are added (this is how a new article appears).
- Static-only ids are **kept** — a live response never deletes a static article (protects against a partial/empty live response).
- On any failure — network error, timeout (set one, e.g. 5 s), non-200, malformed JSON — the page uses the static bundle **exactly as today**, with no visible difference and no error shown to the visitor.
- The fetch happens once per page load, in memory only (no localStorage persistence of article content — no stale-data risk across visits).

**Field mapping (explicit, because the two sides differ):** the live rows carry `id, slug, title, excerpt, body, division` (slug), `division_name`, `publishedAt`. The frontend's article objects carry `id, title, division` (name), `category, excerpt, body, date`. The loader maps `division` (slug) → division name via the existing `DIVISIONS` list in app.js, and `publishedAt` → `date`. The merge happens **before** the existing render/meta code runs, so that code needs no change.

**Canonical / title / meta — unchanged mechanism:** `article.html:64,95` already builds the canonical from the article object (`…/pages/article?id=` + id) and sets title/meta description from `a.title`/`a.excerpt`. A live-loaded article flows through that same code, so its canonical is self-referencing automatically. Division and home titles are set from the same merged data. **No canonical, title or meta code is touched** — the design only changes where the data comes from.

**Body rendering — reuse the existing path verbatim:** the live row's `body` must be rendered by the exact same code that renders a static article's body today (the same sanitiser/markdown step, whatever it is — the design does not invent a second renderer). This is a named verification item in Phase 2: a fixture article must render identically through the live path and the static path.

**CORS — no change needed.** The Worker allows the Pages origin: `ALLOWED_ORIGINS` (`backend/worker.js:38–42`) is `['https://fs-ai-5w5.pages.dev', 'http://localhost:8787', 'http://localhost:5173']`, and `corsHeaders()` (`worker.js:44–54`) echoes an allowed origin with `Vary: Origin`. The public `GET /api/articles` goes through the same `withCors` wrapper as `/api/health` (whose responses already carry `Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev`). The request is a simple GET with no credentials, so no preflight. Verify live in Phase 2 (the response to a browser-origin GET must carry the Pages origin header).

**CSP — one line to carry into the Pages headers work (Phase 1 item 3).** The Pages `_headers` file ships CSP-Report-Only first. The Report-Only policy **must include `connect-src 'self' https://fs-ai.mdalfahad841.workers.dev`** so the future live fetch is not flagged (and any later enforced CSP must keep it). The Worker's own CSP (`default-src 'self' …`, `worker.js:66–71`) applies to Worker responses, not to the Pages documents, so it needs no change. No other CSP directive changes: the fetch is data, not a script/style/image.

**Rate limits / caching — bounded by construction.** The Worker rate-limits POSTs (30/min, `worker.js:105`); public GETs are not rate-limited today, and one list fetch per page load is bounded by page views. Recommended (not required): add `Cache-Control: public, max-age=300` to `GET /api/articles` responses in the Worker so a page view does not cost a D1 read every time — additive, one header, testable in isolation. If it is not added, the design still works; it just reads D1 on every page load.

**What this design does NOT change:** `autoPublishArticle()`, `publishDueArticles()`, any gate, the sitemap generator, article URLs (ids stay the addressing scheme; the API addresses by slug — the list endpoint returns both, so the frontend keeps addressing by id), the static bundle (kept, as fallback and as the no-JS content), or any setting.

### 2.2 Sitemap without a manual deploy — recommended: scheduled regeneration + deploy (no Pages Function)

The sitemap must be served from `pages.dev` (that is where Google fetches it), so the Worker alone cannot fix it. Two options were weighed:

- **Option A (recommended) — scheduled `npm run sitemap` + auto-deploy.** Add one GitHub Actions workflow (new file, additive) that runs on a schedule (hourly) and on demand: it runs `node scripts/regenerate-sitemap.mjs --require-live` (which already merges live D1 articles into the static list and writes both `public/sitemap.xml` and `frontend/sitemap.xml`), and commits + pushes **only if the file changed** (`git diff --quiet` guard — no commit loop when nothing changed). The push triggers the existing Pages auto-deploy. $0 (GitHub Actions free tier for a public repo). No Worker change, no Pages Function, no deployment-model change, no new service. Downside: up to one schedule interval of lag (hourly = at most ~1 hour between a publish and the sitemap listing it). That lag is acceptable for a sitemap — Google re-reads on its own schedule anyway.
  - Caveat, stated plainly: the script's live D1 merge needs wrangler authenticated for the fs-ai account in the workflow (`wrangler d1 execute … --remote`). If that auth is not available, the script warns and writes the static-only sitemap — which would silently omit new articles. The workflow must therefore use `--require-live` (exit 1 on a failed live fetch) so a silent static-only write can never pass as success.
- **Option B (not recommended) — a Pages Function serving `/sitemap.xml` live.** A `functions/sitemap.xml.js` would fetch the regenerated XML from the Worker (or query D1) on every request: zero lag. Risks: it changes the Pages deployment from static to Functions; it adds a new runtime dependency in front of the sitemap (if the Function or the Worker call fails, the sitemap 500s — worse than a stale sitemap); it needs the Function to reach D1 or the Worker securely. More moving parts for a benefit (zero lag) the sitemap does not need.

**Recommendation: Option A.** It reuses the generator that already exists, changes nothing about how the site is deployed, and fails loudly instead of silently.

### 2.3 Verification plan for Phase 2 (not run yet)

1. **Unit tests first:** merge/fallback logic with mocked fetch (live wins, live-only added, static-only kept, failure → static exactly, timeout → static, malformed JSON → static); field mapping (slug → division name, publishedAt → date); the canonical/title/meta code paths untouched (existing tests still pass).
2. **Live-read path, no publish needed:** `GET https://fs-ai.mdalfahad841.workers.dev/api/articles` already returns the 25 published articles from live D1 (`source: 'd1'`) — verify live that the list matches the static bundle, so the merge must render byte-identically on the existing 25.
3. **New-article case, without a real publish:** a scratch-DB Worker (a test Worker bound to a scratch D1 holding one fixture article) serves the fixture through the same endpoint; the frontend (preview deploy or a local page load against the scratch Worker) must show the fixture article on the article/division/home pages with a self-referencing canonical, and must show the static 25 when the scratch Worker is unreachable. The fixture is removed afterwards; no real article is ever published to test.
4. **Sitemap (Option A):** after the workflow exists, force-run it once and confirm the committed sitemap is unchanged when nothing published (no empty commit), then — after a real publish — confirm the next scheduled run adds the new article and the served sitemap lists it.
5. **Regression:** all 60 sitemap URLs still 200; article/division/tool pages render identically; CSP-Report-Only shows no new violations from the fetch; the dashboard and owner flows untouched.

## 3. What this design deliberately does not do

- It does not change the publish path, the eligibility gate, the Emergency Stop, or any schedule.
- It does not change article URLs, division URLs, tool URLs, or the sitemap's URL set (only its contents, via the existing generator).
- It does not remove the static bundle, and it does not make the public site depend on the Worker being up: if the Worker is down, the site is exactly today's site.
- It does not add a Pages Function, a new service, a paid tier, or a new secret.
- It does not touch any protected article.

## 4. Open points for the owner's review

1. Option A (scheduled sitemap regeneration, ≤1 h lag) vs Option B (Pages Function, zero lag, more risk) — the design recommends A.
2. The optional `Cache-Control: public, max-age=300` on `GET /api/articles` — include it in Phase 2 or leave the endpoint uncached?
3. The scratch-DB Worker for the new-article test — acceptable as a free-tier test deployment, or prefer a different fixture method?
4. Anything in §2.1 that should change before building (e.g. a different fetch timeout, or sessionStorage caching instead of in-memory only)?
