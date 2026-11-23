/**
 * FS AI — Server-side SEO heads for crawlers (Fix Pass 2, item 2, 2026-11-23).
 *
 * A Cloudflare Pages Function (frontend/functions/pages/*.js) rewrites the three
 * JS-rendered pages — /pages/article?id=N, /pages/division?division=X,
 * /pages/tools?tool=Y — so a crawler that does not run JavaScript sees
 * the same per-page title / description / canonical / og+twitter tags /
 * JSON-LD and a noscript body that a real browser sees after JS runs
 * (close-out A3 only injected those tags in JS, which no-JS crawlers
 * never see — see docs/CLOSEOUT-A3-CRAWLER-REPORT-2026-11-23.md).
 *
 * WHY A PAGES FUNCTION, NOT BUILD-TIME GENERATION (mechanism decision):
 * static hosting cannot vary content by query string — /pages/article?id=1
 * and ?id=2 serve the same file — so build-time generation would need new
 * URLs (article-1.html, ...) plus sitemap changes plus redirects, which
 * breaks the brief's "keeps every existing URL" rule (Pages _redirects
 * cannot match query strings either). Only a Function can keep the exact
 * ?id= / ?division= / ?tool= URLs with per-id server-side heads. The
 * deploy setup CAN host one: the Pages project is Git-connected
 * (auto-deploys on push to main) with build output directory `frontend`
 * (README.md "Build command: (none) / Build output directory: frontend"),
 * so the project root is the repo root and `frontend/functions/` lives there,
 * alongside — not inside — the build output, exactly as the Cloudflare
 * Pages Functions routing docs require ("If no Function is matched, it
 * will fall back to a static asset" — a matched Function runs first, so
 * frontend/functions/pages/article.js runs for /pages/article even though
 * frontend/pages/article.html exists). frontend/_routes.json (in the
 * build output directory, per the same docs) limits Function invocation
 * to the three page paths, so every other request stays purely static.
 * ONE config assumption the parent must verify live: the Pages dashboard
 * "Root directory" is the repo root (the default, implied by the
 * relative output dir `frontend`). If the live curl proof shows generic
 * heads after deploy, the root is set to `frontend` instead and the
 * frontend/functions/ tree belongs under frontend/frontend/functions/.
 *
 * WHY A STRING TRANSFORM, NOT HTMLRewriter: HTMLRewriter is a Workers
 * runtime API that does not exist in Node, so a Function built on it
 * could not be unit-tested by this repo's node --test suite — the
 * rewrite logic would be untested code. This module does the same
 * rewrite as a pure string transform over the site's own pinned static
 * templates (exact anchor strings, asserted by tests/fixpass2-item2.test.js
 * against the shipped pages), with fail-closed behaviour: any anchor
 * missing or appearing more than once aborts the whole rewrite and the
 * original static page is served untouched. The module uses no
 * Workers-only APIs, so the tests exercise the real code path.
 *
 * DATA — the same data the page already uses (merged static + live list):
 * - Articles: the static bundle (frontend/scripts/app.js ARTICLES) is
 *   the source of truth for ids 1–25 — STATIC WINS for shared ids, the
 *   same merge rule as app.js mergeLiveArticles (the D1 excerpts differ
 *   from the static excerpts for all 25, so the Worker API must NOT
 *   override them). The Worker GET /api/articles?limit=100 is fetched
 *   ONLY when the requested id is not in the static bundle (a newly
 *   auto-published article); on any fetch failure the unknown id falls
 *   back to the static page. Drafts are NEVER exposed: the API returns
 *   published articles only, and the static bundle holds no drafts.
 * - Divisions / tools: app.js DIVISIONS / TOOLS, parsed from the deployed
 *   app.js text (fetched via env.ASSETS, same deploy, no network). The
 *   Worker /api/divisions and /api/tools endpoints are deliberately NOT
 *   used: their division descriptions differ from the page's, and their
 *   tool slugs differ from the page's ?tool= ids (currency-manual-rate
 *   vs currency-converter, storage vs storage-converter, ...). Using
 *   them would serve heads that disagree with the JS-rendered page.
 * - The static bundle is parsed once per isolate (module-level cache
 *   keyed on the app.js text); a deploy creates fresh isolates, so a
 *   deploy can never serve the previous bundle's heads.
 *
 * FALLBACK (never a 500, never a broken page): on ANY error — app.js
 * unreadable or unparseable, live fetch failed, unknown id/slug/tool,
 * draft id, anchor mismatch, body containing a noscript breakout —
 * the handler returns the original static page byte-identical with its
 * original headers. Unknown ids keep the existing behaviour (article:
 * JS shows "Article not found"; division: JS shows "Division not
 * found"; tool: the page shows the default tool, as today).
 *
 * CACHE (no cache poisoning): a rewritten response carries exactly
 * `Cache-Control: public, max-age=0, must-revalidate` — the site's
 * existing HTML caching (Fix Pass 2 item 0 found the same header on
 * the homepage). max-age=0 + must-revalidate means the edge must
 * revalidate with the Function before serving a stored copy, so a
 * rewritten response for ?id=1 can never be served for ?id=2 without
 * the Function re-running and returning the correct content. No Vary
 * header is set: the response varies by URL (query string), which is
 * part of the cache key — Vary is for request headers and would add
 * nothing. The static file's ETag / Last-Modified are STRIPPED from
 * rewritten responses: they describe the static file, not the rewritten
 * body, and the static file's ETag does not change when app.js data
 * changes (a stale validator could otherwise bless a wrong 304).
 * Unrewritten (fallback) responses keep the original headers untouched.
 *
 * NO-JS BROWSER NOTE: the noscript body is invisible to JS browsers
 * (scripting enabled) and is discarded when the page JS replaces the
 * container's innerHTML, so the visible page is byte-identical for
 * real browsers — the rewrite is head/noscript-only. Hero wording is
 * untouched.
 *
 * This module is imported by frontend/functions/pages/{article,division,tools}.js
 * AND by tests/fixpass2-item2.test.js. It must stay free of Workers-only
 * APIs (no HTMLRewriter, no env access except through the injected
 * deps of handleSeoRequest) so the Node suite can load it.
 */
'use strict';

export const SITE_URL = 'https://fs-ai-5w5.pages.dev';
export const OG_IMAGE_URL = 'https://fs-ai-5w5.pages.dev/og-image.png';
export const LIVE_API_URL = 'https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100';
export const LIVE_FETCH_TIMEOUT_MS = 5000;
/** Exact Cache-Control for every rewritten response (see header). */
export const SEO_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
/** The three paths the Function rewrites (mirrored in frontend/_routes.json). */
export const REWRITE_PATHS = ['/pages/article', '/pages/division', '/pages/tools'];

/* ------------------------------------------------------------------ */
/* Escaping.                                                           */
/* ------------------------------------------------------------------ */

/** Escape for an HTML attribute value or element text. Apostrophes are
 * left as-is: they are legal in double-quoted attributes and in text. */
export function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON for embedding inside <script type="application/ld+json">:
 * JSON.stringify plus < escaped, so a "</script>" inside a title or
 * excerpt can never break out of the script element. */
export function safeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

/* ------------------------------------------------------------------ */
/* Static-bundle parsing (the data the browser pages already use).     */
/*                                                                     */
/* The bundle is frontend/scripts/app.js. The three arrays are JS data
   literals — with ONE exception: ARTICLES references the string
   constant GENERAL_DISCLAIMER (app.js line 7; used by the Finance
   articles' `disclaimer:` field). parseStaticData extracts that
   constant and binds it when evaluating the literal, so the parse
   stays exact; the disclaimer itself is not head data and is never
   emitted. They are extracted with a string-aware scanner and
   evaluated with `new Function` — the input is the site's OWN deployed
   file (same deploy, first-party code, never user input) and the
   result is shape-validated below; any failure returns null
   (fail-closed). There is no ${} interpolation anywhere in the file
   (grep count 0, pinned by tests/fixpass2-item2.test.js), so template
   literals evaluate to plain strings; the scanner still handles ${}
   for future safety. */
/* ------------------------------------------------------------------ */

/**
 * Extract the JS array literal assigned to `var <varName> = [...]` from
 * source text. String-aware: ', ", ` strings (with escapes), //
 * and block comments, and ${...} interpolations inside template
 * literals are all skipped correctly, so brackets inside them never
 * disturb the depth count. Returns the literal text including the
 * outer brackets, or null when the variable is absent or unbalanced.
 */
export function extractArrayLiteral(source, varName) {
  if (typeof source !== 'string' || !source) return null;
  const marker = 'var ' + varName + ' = [';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length - 1; // index of the opening '['
  let depth = 0;
  // Mode stack. 'code' is the base; 'sq'/'dq'/'tpl' are string modes;
  // 'interp' is a ${...} inside a template literal, with its own
  // brace depth kept in the parallel braceStack.
  const modes = ['code'];
  const braceStack = [];
  const top = () => modes[modes.length - 1];
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    const mode = top();
    if (mode === 'sq' || mode === 'dq') {
      const quote = mode === 'sq' ? "'" : '"';
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) modes.pop();
      i += 1;
      continue;
    }
    if (mode === 'tpl') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { modes.pop(); i += 1; continue; }
      if (ch === '$' && next === '{') {
        modes.push('interp');
        braceStack.push(1);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'interp') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === "'") { modes.push('sq'); i += 1; continue; }
      if (ch === '"') { modes.push('dq'); i += 1; continue; }
      if (ch === '`') { modes.push('tpl'); i += 1; continue; }
      if (ch === '{') { braceStack[braceStack.length - 1] += 1; i += 1; continue; }
      if (ch === '}') {
        braceStack[braceStack.length - 1] -= 1;
        if (braceStack[braceStack.length - 1] === 0) {
          braceStack.pop();
          modes.pop(); // back to the enclosing template literal
        }
        i += 1;
        continue;
      }
      // Brackets inside an interpolation are real code and balanced by
      // definition, so the '[' / ']' counting below still nets out.
      if (ch === '[') { depth += 1; i += 1; continue; }
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) return source.slice(start + marker.length - 1, i + 1);
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    // mode === 'code'
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }
    if (ch === "'") { modes.push('sq'); i += 1; continue; }
    if (ch === '"') { modes.push('dq'); i += 1; continue; }
    if (ch === '`') { modes.push('tpl'); i += 1; continue; }
    if (ch === '[') { depth += 1; i += 1; continue; }
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start + marker.length - 1, i + 1);
      if (depth < 0) return null;
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

function evalArrayLiteral(literal, bindings = {}) {
  if (typeof literal !== 'string' || !literal) return null;
  try {
    // The literal is a data array from the site's own deployed
    // app.js (see header). `new Function` evaluates it in a clean
    // scope with only the given bindings in scope; the result is
    // shape-validated by the caller.
    const names = Object.keys(bindings);
    const values = names.map((name) => bindings[name]);
    const value = new Function(...names, 'return (' + literal + ');')(...values); // eslint-disable-line no-new-func
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Extract a top-level `var <varName> = '...'` string constant from
 * app.js text (the GENERAL_DISCLAIMER the ARTICLES literal references).
 * Returns the string, or '' when the constant cannot be found — the
 * disclaimer is not head data, so a missing value must never block
 * the parse (the articles' other fields are still validated). */
function extractStringConstant(source, varName) {
  const re = new RegExp('var ' + varName + '\\s*=\\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")');
  const m = re.exec(source);
  if (!m) return '';
  try {
    const value = new Function('return (' + m[1] + ');')(); // eslint-disable-line no-new-func
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isValidDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Parse the static bundle (app.js text) into { articles, divisions,
 * tools }. All-or-nothing: any missing array, unparsable literal, or
 * malformed row returns null — a corrupt bundle must never produce
 * half-rewritten heads.
 */
export function parseStaticData(appJsText) {
  if (typeof appJsText !== 'string' || !appJsText) return null;
  const articlesLiteral = extractArrayLiteral(appJsText, 'ARTICLES');
  const divisionsLiteral = extractArrayLiteral(appJsText, 'DIVISIONS');
  const toolsLiteral = extractArrayLiteral(appJsText, 'TOOLS');
  if (!articlesLiteral || !divisionsLiteral || !toolsLiteral) return null;
  const articles = evalArrayLiteral(articlesLiteral, {
    GENERAL_DISCLAIMER: extractStringConstant(appJsText, 'GENERAL_DISCLAIMER'),
  });
  const divisions = evalArrayLiteral(divisionsLiteral);
  const tools = evalArrayLiteral(toolsLiteral);
  if (!articles || !divisions || !tools) return null;
  for (const a of articles) {
    if (!a || typeof a !== 'object') return null;
    if (!Number.isInteger(a.id) || a.id < 1) return null;
    if (!isNonEmptyString(a.title)) return null;
    if (!isNonEmptyString(a.division)) return null;
    if (typeof a.category !== 'string') return null;
    if (!isValidDate(a.date)) return null;
    if (typeof a.excerpt !== 'string' || typeof a.body !== 'string') return null;
  }
  for (const d of divisions) {
    if (!d || typeof d !== 'object') return null;
    if (!isNonEmptyString(d.id) || !isNonEmptyString(d.name)) return null;
    if (!isNonEmptyString(d.description)) return null;
  }
  for (const t of tools) {
    if (!t || typeof t !== 'object') return null;
    if (!isNonEmptyString(t.id) || !isNonEmptyString(t.name)) return null;
    if (!isNonEmptyString(t.description)) return null;
  }
  return { articles, divisions, tools };
}

/* ------------------------------------------------------------------ */
/* Article lookup — static first, live only for ids the bundle lacks.  */
/* ------------------------------------------------------------------ */

/** Mirror of app.js mapLiveArticle: a live /api/articles row mapped to
 * the frontend shape. Division comes from `division_name`, falling
 * back to the slug resolved through the static DIVISIONS. Returns null
 * for an unplaceable row (no id/title/division). */
export function mapLiveArticle(row, divisions) {
  if (!row || typeof row !== 'object') return null;
  // Defense in depth: the API filters status='published', but a draft
  // row must never be served even if one ever leaked into the response.
  // A row without a status field is accepted (the API already filtered).
  if (typeof row.status === 'string' && row.status !== 'published') return null;
  const id = Number(row.id);
  if (!id || !Number.isFinite(id)) return null;
  if (!isNonEmptyString(row.title)) return null;
  const publishedAt = (typeof row.publishedAt === 'string')
    ? row.publishedAt
    : ((typeof row.published_at === 'string') ? row.published_at : '');
  const date = /^\d{4}-\d{2}-\d{2}/.test(publishedAt) ? publishedAt.slice(0, 10) : '';
  let divisionName = (typeof row.division_name === 'string' && row.division_name) ? row.division_name : '';
  if (!divisionName && typeof row.division === 'string' && Array.isArray(divisions)) {
    const d = divisions.find((x) => x.id === row.division);
    divisionName = d ? d.name : '';
  }
  if (!divisionName) return null;
  const a = {
    id,
    title: row.title,
    division: divisionName,
    category: '',
    date,
    excerpt: (typeof row.excerpt === 'string') ? row.excerpt : '',
    body: (typeof row.body === 'string') ? row.body : '',
  };
  if (typeof row.slug === 'string' && row.slug) a.slug = row.slug;
  if (typeof row.disclaimer === 'string' && row.disclaimer) a.disclaimer = row.disclaimer;
  return a;
}

/** Find an article by id the way the page does: the static bundle
 * first (static wins for shared ids), then — only for ids the bundle
 * lacks — the live rows. A live row without a valid date is never
 * used (the head needs a real datePublished). Returns null when the
 * id is not a published article anywhere. */
export function findArticle(staticData, liveRows, rawId) {
  const id = Number(rawId);
  if (!id || !Number.isFinite(id)) return null;
  const fromStatic = staticData.articles.find((a) => a.id === id);
  if (fromStatic) return fromStatic;
  if (!Array.isArray(liveRows)) return null;
  for (const row of liveRows) {
    const mapped = mapLiveArticle(row, staticData.divisions);
    if (mapped && mapped.id === id && isValidDate(mapped.date)) return mapped;
  }
  return null;
}

function divisionSlugForName(divisions, name) {
  const d = (divisions || []).find((x) => x.name === name);
  return d ? d.id : null;
}

function articleNo(id) {
  return 'No. ' + String(id).padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* Head builders — the exact values the page JS injects (A3), so the    */
/* crawler head and the browser head agree.                            */
/* ------------------------------------------------------------------ */

export function articleCanonical(id) {
  return SITE_URL + '/pages/article?id=' + id;
}

export function divisionCanonical(slug) {
  return SITE_URL + '/pages/division?division=' + slug;
}

export function toolCanonical(slug) {
  return SITE_URL + '/pages/tools?tool=' + slug;
}

function articleJsonLd(article) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    inLanguage: 'en',
    author: { '@type': 'Person', name: 'Fahad Somrat' },
    publisher: { '@type': 'Organization', name: 'FS AI', url: SITE_URL + '/' },
    mainEntityOfPage: articleCanonical(article.id),
    articleSection: article.division,
  };
}

function articleBreadcrumbs(article, divisions) {
  const slug = divisionSlugForName(divisions, article.division);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: article.division,
        item: slug ? divisionCanonical(slug) : SITE_URL + '/pages/division',
      },
      { '@type': 'ListItem', position: 3, name: article.title, item: articleCanonical(article.id) },
    ],
  };
}

/** The noscript body for an article page: title, meta line, excerpt
 * and the full body HTML (the same HTML the page JS renders). The body
 * is the site's own trusted content — it is already rendered via
 * innerHTML by the page JS. A body containing a noscript breakout is
 * refused by the rewriter (see rewriteArticleHtml). */
export function articleNoscript(article) {
  return '<h1>' + escHtml(article.title) + '</h1>'
    + '<p class="card-tag">' + escHtml(article.division) + ' · ' + escHtml(article.category) + '</p>'
    + '<p class="article-meta"><span class="article-no">' + escHtml(articleNo(article.id)) + '</span> · Published '
    + escHtml(article.date) + ' · FS AI · ' + escHtml(article.division) + '</p>'
    + '<p><strong>' + escHtml(article.excerpt) + '</strong></p>'
    + '<div class="article-full">' + article.body + '</div>';
}

function divisionJsonLd(division) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: division.name + ' — FS AI',
    url: divisionCanonical(division.id),
    description: division.description,
    isPartOf: { '@type': 'WebSite', name: 'FS AI', url: SITE_URL + '/' },
  };
}

function toolJsonLd(tool) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.name + ' — FS AI',
    url: toolCanonical(tool.id),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
  };
  if (tool.description) ld.description = tool.description;
  return ld;
}

/* ------------------------------------------------------------------ */
/* String rewrites (fail-closed).                                      */
/*                                                                     */
/* Each replacement counts its anchor: exactly one occurrence, or the  */
/* whole rewrite is abandoned and the original HTML is returned        */
/* untouched. The anchors are the shipped pages' exact strings — if    */
/* a page is ever edited, the tests in tests/fixpass2-item2.test.js    */
/* fail loudly instead of the rewrite silently going stale.            */
/* ------------------------------------------------------------------ */

/** Replace `anchor` with `replacement` exactly once. Returns the new
 * string, or null when the anchor is absent or appears more than once. */
function replaceOnce(html, anchor, replacement) {
  const first = html.indexOf(anchor);
  if (first === -1) return null;
  if (html.indexOf(anchor, first + anchor.length) !== -1) return null;
  return html.slice(0, first) + replacement + html.slice(first + anchor.length);
}

/** Replace the <script type="application/ld+json" id="..."> element
 * (matched by id, content-agnostic) with a new element carrying
 * `json`. Returns the new string, or null when the element is absent
 * or appears more than once. */
function replaceJsonLdScript(html, elementId, json) {
  const re = new RegExp(
    '<script type="application\\/ld\\+json" id="' + elementId + '">[\\s\\S]*?<\\/script>',
  );
  const matches = html.match(re);
  if (!matches || matches.length !== 1) return null;
  // The regex is not global, so match() returns at most one entry;
  // a second element with the same id would only be caught by the
  // indexOf check below.
  if (html.indexOf('id="' + elementId + '"', html.indexOf(matches[0]) + matches[0].length) !== -1) return null;
  return html.replace(re, '<script type="application/ld+json" id="' + elementId + '">' + json + '</script>');
}

function hasNoscriptBreakout(body) {
  return /<\/noscript/i.test(body) || /<script/i.test(body);
}

/**
 * Rewrite the static article page for one article. Returns
 * { html, rewritten: true } or { html: <original>, rewritten: false }.
 * The loading paragraph is replaced by the noscript body (JS browsers
 * discard it when the page JS renders; no-JS browsers read the
 * article). Everything else in the file is untouched.
 */
export function rewriteArticleHtml(html, article, divisions) {
  if (typeof html !== 'string' || !article || hasNoscriptBreakout(article.body || '')) {
    return { html, rewritten: false };
  }
  const canonical = articleCanonical(article.id);
  const title = article.title + ' — FS AI';
  let out = html;
  const steps = [
    ['<title>Article — FS AI</title>', '<title>' + escHtml(title) + '</title>'],
    ['<meta name="description" content="Read a free FS AI article.">',
      '<meta name="description" content="' + escHtml(article.excerpt) + '">'],
    ['<meta property="og:title" content="Article — FS AI">',
      '<meta property="og:title" content="' + escHtml(title) + '">'],
    ['<meta property="og:description" content="Read a free FS AI article.">',
      '<meta property="og:description" content="' + escHtml(article.excerpt) + '">'],
    ['<meta name="twitter:title" content="Article — FS AI">',
      '<meta name="twitter:title" content="' + escHtml(title) + '">'],
    ['<meta name="twitter:description" content="Read a free FS AI article.">',
      '<meta name="twitter:description" content="' + escHtml(article.excerpt) + '">'],
  ];
  for (const [anchor, replacement] of steps) {
    out = replaceOnce(out, anchor, replacement);
    if (out === null) return { html, rewritten: false };
  }
  // New tags the static page does not ship (one shared URL would be
  // wrong for every article): og:url, canonical, article properties,
  // Article + BreadcrumbList JSON-LD. The ids match the ones the page
  // JS creates, so JS replaces them in place instead of duplicating.
  let extra = '<meta property="og:url" content="' + escHtml(canonical) + '">\n'
    + '<link rel="canonical" href="' + escHtml(canonical) + '">\n'
    + '<meta property="article:published_time" content="' + escHtml(article.date) + '">\n'
    + '<meta property="article:section" content="' + escHtml(article.division) + '">\n';
  if (article.category) {
    extra += '<meta property="article:tag" content="' + escHtml(article.category) + '">\n';
  }
  extra += '<script type="application/ld+json" id="articleJsonLd">' + safeJsonLd(articleJsonLd(article)) + '</script>\n'
    + '<script type="application/ld+json" id="articleCrumbs">' + safeJsonLd(articleBreadcrumbs(article, divisions)) + '</script>\n';
  out = replaceOnce(out, '</head>', extra + '</head>');
  if (out === null) return { html, rewritten: false };
  out = replaceOnce(
    out,
    '<p class="muted">Loading article…</p>',
    '<noscript>' + articleNoscript(article) + '</noscript>',
  );
  if (out === null) return { html, rewritten: false };
  return { html: out, rewritten: true };
}

/**
 * Rewrite the static division page for one division. The all-divisions
 * view (no ?division=) is NOT rewritten — its generic tags are correct
 * for the bare URL. The articles list in the noscript is static-only:
 * a newly published article joins it at the next deploy (same as the
 * static bundle); the head tags need no live fetch.
 */
export function rewriteDivisionHtml(html, division, articlesInDivision) {
  if (typeof html !== 'string' || !division) return { html, rewritten: false };
  const canonical = divisionCanonical(division.id);
  const title = division.name + ' — FS AI';
  const genericDesc = 'FS AI divisions: Automotive, AI & Technology, Gadgets & Electronics, Finance & Money, Travel & Lifestyle, Digital Tools, Health & Wellness, Education & Learning.';
  let out = html;
  const steps = [
    ['<title>Divisions — FS AI</title>', '<title>' + escHtml(title) + '</title>'],
    ['<meta name="description" content="' + genericDesc + '">',
      '<meta name="description" content="' + escHtml(division.description) + '">'],
    ['<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/division">',
      '<link rel="canonical" href="' + escHtml(canonical) + '">'],
    ['<meta property="og:title" content="Divisions — FS AI">',
      '<meta property="og:title" content="' + escHtml(title) + '">'],
    ['<meta property="og:description" content="' + genericDesc + '">',
      '<meta property="og:description" content="' + escHtml(division.description) + '">'],
    ['<meta property="og:url" content="https://fs-ai-5w5.pages.dev/pages/division">',
      '<meta property="og:url" content="' + escHtml(canonical) + '">'],
    ['<meta name="twitter:title" content="Divisions — FS AI">',
      '<meta name="twitter:title" content="' + escHtml(title) + '">'],
    ['<meta name="twitter:description" content="All FS AI divisions, one platform.">',
      '<meta name="twitter:description" content="' + escHtml(division.description) + '">'],
  ];
  for (const [anchor, replacement] of steps) {
    out = replaceOnce(out, anchor, replacement);
    if (out === null) return { html, rewritten: false };
  }
  out = replaceJsonLdScript(out, 'divisionJsonLd', safeJsonLd(divisionJsonLd(division)));
  if (out === null) return { html, rewritten: false };
  const list = (articlesInDivision || []);
  const noscript = list.length
    ? '<noscript><ul>' + list.map((a) => '<li><a href="article?id=' + a.id + '">' + escHtml(a.title) + '</a> — ' + escHtml(a.excerpt) + '</li>').join('') + '</ul></noscript>'
    : '<noscript><p>No articles in this division yet.</p></noscript>';
  out = replaceOnce(out, '<p class="muted grid-loading">Loading articles…</p>', noscript);
  if (out === null) return { html, rewritten: false };
  return { html: out, rewritten: true };
}

/**
 * Rewrite the static tools page for one tool. A bare load (no ?tool=)
 * is NOT rewritten — its generic tags are correct for the bare URL.
 * An unknown ?tool= is NOT rewritten either: the page shows the
 * default tool (Fuel Cost) for it, and inventing a per-tool canonical
 * for a URL that names no real tool would be false.
 */
export function rewriteToolHtml(html, tool) {
  if (typeof html !== 'string' || !tool) return { html, rewritten: false };
  const canonical = toolCanonical(tool.id);
  const title = tool.name + ' — FS AI';
  const genericDesc = 'Free FS AI tools: fuel cost, mileage, budget, savings, loan, currency (manual rate), converters, calculators and trip planners. No sign-up, no cost.';
  let out = html;
  const steps = [
    ['<title>Free Tools — FS AI</title>', '<title>' + escHtml(title) + '</title>'],
    ['<meta name="description" content="' + genericDesc + '">',
      '<meta name="description" content="' + escHtml(tool.description) + '">'],
    ['<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/tools">',
      '<link rel="canonical" href="' + escHtml(canonical) + '">'],
    ['<meta property="og:title" content="Free Tools — FS AI">',
      '<meta property="og:title" content="' + escHtml(title) + '">'],
    ['<meta property="og:description" content="' + genericDesc + '">',
      '<meta property="og:description" content="' + escHtml(tool.description) + '">'],
    ['<meta property="og:url" content="https://fs-ai-5w5.pages.dev/pages/tools">',
      '<meta property="og:url" content="' + escHtml(canonical) + '">'],
    ['<meta name="twitter:title" content="Free Tools — FS AI">',
      '<meta name="twitter:title" content="' + escHtml(title) + '">'],
    ['<meta name="twitter:description" content="Free tools. No sign-up, no cost.">',
      '<meta name="twitter:description" content="' + escHtml(tool.description) + '">'],
  ];
  for (const [anchor, replacement] of steps) {
    out = replaceOnce(out, anchor, replacement);
    if (out === null) return { html, rewritten: false };
  }
  out = replaceJsonLdScript(out, 'toolsJsonLd', safeJsonLd(toolJsonLd(tool)));
  if (out === null) return { html, rewritten: false };
  // The tool form needs JS; the noscript carries the tool's own
  // description so a crawler still reads what the tool does.
  out = replaceOnce(
    out,
    '<p id="toolDescription"></p>',
    '<p id="toolDescription"><noscript>' + escHtml(tool.description) + '</noscript></p>',
  );
  if (out === null) return { html, rewritten: false };
  return { html: out, rewritten: true };
}

/* ------------------------------------------------------------------ */
/* Response headers for a rewritten response (see header).             */
/* ------------------------------------------------------------------ */

/** Cache-Control for rewritten responses + strip the static file's
 * validators (ETag / Last-Modified describe the static file, not the
 * rewritten body). Unrewritten responses keep their headers untouched. */
export function seoHeaders(headers) {
  const h = new Headers(headers);
  h.set('Cache-Control', SEO_CACHE_CONTROL);
  h.delete('ETag');
  h.delete('Last-Modified');
  // The rewritten body is longer than the static file: a stale
  // Content-Length copied from the static response would truncate or
  // error it. Delete it and let the runtime recompute it from the body.
  h.delete('Content-Length');
  return h;
}

/* ------------------------------------------------------------------ */
/* Handler (used by frontend/functions/pages/*.js; deps injectable for tests).  */
/*                                                                     */
/* Never throws for a rewritable page: any failure returns the static  */
/* page exactly as context.next() served it. The ONLY throw path is    */
/* context.next() itself failing, in which case there is no page to    */
/* serve at all.                                                       */
/* ------------------------------------------------------------------ */

let staticCache = null; // { text, data } — per isolate; a deploy starts fresh.

async function defaultFetchAppJsText(context) {
  try {
    const assets = context && context.env && context.env.ASSETS;
    if (!assets || typeof assets.fetch !== 'function') return null;
    const url = new URL('/scripts/app.js', context.request.url);
    const res = await assets.fetch(new Request(url));
    if (!res || !res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function defaultFetchLiveArticles() {
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  let timer = null;
  try {
    if (controller) {
      timer = setTimeout(() => { try { controller.abort(); } catch (e) { /* already settled */ } }, LIVE_FETCH_TIMEOUT_MS);
    }
    const res = await fetch(LIVE_API_URL, {
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.articles)) return null;
    return data.articles;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function loadStaticData(context, deps) {
  const fetchAppJsText = (deps && deps.fetchAppJsText) || defaultFetchAppJsText;
  const text = await fetchAppJsText(context);
  if (typeof text !== 'string' || !text) return null;
  if (staticCache && staticCache.text === text) return staticCache.data;
  const data = parseStaticData(text);
  if (!data) return null;
  staticCache = { text, data };
  return data;
}

function passthrough(res, html) {
  return new Response(html, { status: res.status, headers: res.headers });
}

export async function handleSeoRequest(context, kind, deps = {}) {
  const res = await context.next();
  if (!res || res.status !== 200) return res;
  const method = (context.request && context.request.method) || 'GET';
  if (method.toUpperCase() !== 'GET') return res;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return res;
  let html;
  try {
    html = await res.text();
  } catch {
    return res;
  }
  try {
    const staticData = await loadStaticData(context, deps);
    if (!staticData) return passthrough(res, html);
    const url = new URL(context.request.url);
    let out = null;
    if (kind === 'article') {
      const rawId = url.searchParams.get('id');
      let article = findArticle(staticData, null, rawId);
      if (!article) {
        // Only an id the static bundle lacks justifies a live fetch.
        const fetchLiveArticles = (deps && deps.fetchLiveArticles) || defaultFetchLiveArticles;
        const liveRows = await fetchLiveArticles(context);
        article = findArticle(staticData, liveRows, rawId);
      }
      if (!article) return passthrough(res, html);
      out = rewriteArticleHtml(html, article, staticData.divisions);
    } else if (kind === 'division') {
      const slug = url.searchParams.get('division');
      if (!slug) return passthrough(res, html); // all-divisions view: generic is correct
      const division = staticData.divisions.find((d) => d.id === slug);
      if (!division) return passthrough(res, html); // unknown slug: existing not-found behaviour
      const inDivision = staticData.articles.filter((a) => a.division === division.name);
      out = rewriteDivisionHtml(html, division, inDivision);
    } else if (kind === 'tool') {
      const slug = url.searchParams.get('tool');
      if (!slug) return passthrough(res, html); // bare load: generic is correct
      const tool = staticData.tools.find((t) => t.id === slug);
      if (!tool) return passthrough(res, html); // unknown tool: default-tool behaviour
      out = rewriteToolHtml(html, tool);
    } else {
      return passthrough(res, html);
    }
    if (!out || !out.rewritten) return passthrough(res, html);
    return new Response(out.html, { status: res.status, headers: seoHeaders(res.headers) });
  } catch {
    // ANY failure inside the rewrite path serves the static page.
    return passthrough(res, html);
  }
}
