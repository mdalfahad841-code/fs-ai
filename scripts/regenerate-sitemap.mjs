// FS AI — regenerate both committed sitemaps from the static generator
// PLUS live published articles from D1.
//
// Usage:
//   node scripts/regenerate-sitemap.mjs [--dry-run] [--from-json <file>] [--from-api [url]] [--require-live]
//
// Writes public/sitemap.xml AND frontend/sitemap.xml. The two files must
// stay identical. Base entries come from backend/services/seo.js
// sitemapEntries() (home, divisions, the 25 statically-listed published
// articles, tools, about/contact/privacy/terms). Live D1 published
// articles NOT in that static list (e.g. a newly auto-published article
// with id 32+) are merged in by loc, so the served sitemap always
// reflects live D1 at deploy time — the static list alone would silently
// omit every article published after the list was last edited.
//
// Live data sources, in order:
//   1. --from-json <file> with {"articles":[{"id","published_at"}],
//      "divisions":[{"slug"}]} (offline use / tests).
//   2. --from-api [url] (Phase 2, 2026-11-22 — PREFERRED, no secret):
//      fetches the live published list from the Worker's public
//      GET /api/articles endpoint (default URL below; no auth, no
//      wrangler, no Cloudflare token). A response whose `source` is
//      present and not 'd1' is refused — the fallback list would silently
//      omit newly published articles.
//   3. Default (no flag): `wrangler d1 execute fs-ai-db --remote --json`
//      (requires wrangler authenticated for the fs-ai account — NOT
//      available in this VM and NOT available to GitHub Actions without
//      a CLOUDFLARE_API_TOKEN secret, which is why --from-api exists).
// --dry-run prints the XML instead of writing. If the live fetch fails,
// the script warns loudly and writes the static-only sitemap (exit 0),
// unless --require-live is passed (exit 1 — use it in the deploy
// pipeline and in the scheduled sitemap workflow, so a silent
// static-only write can never pass as success).
//
// NOTE: the auto-publish path regenerates the same XML from live D1 at
// publish time and reports sitemapUpdated=true when the article is in
// that XML — the SERVED file catches up when this script runs at the
// next deploy. Run this script before every deploy that follows a
// publish. (Phase 3, P8; live-merge added 2026-11-21.)
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { sitemapEntries, renderSitemapXml } from '../backend/services/seo.js';

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://fs-ai-5w5.pages.dev';
const LIVE_API_URL = 'https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100';

function parseWranglerJson(stdout) {
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const rows = first?.results ?? first?.rows ?? [];
  return Array.isArray(rows) ? rows : [];
}

/* Phase 2: read the live published list from the Worker's public endpoint
   (no auth, no secret). The endpoint returns { ok, articles, total,
   source } where each article carries id + published_at (and
   publishedAt). A non-'d1' source means D1 is unbound and the list is
   only the static fallback — refuse it, so a fallback-only sitemap can
   never silently omit newly published articles. */
async function fetchLiveFromApi(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`live API request failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.articles)) throw new Error('live API response has no articles array');
  if (typeof data.source === 'string' && data.source !== 'd1') {
    throw new Error(`live API source is '${data.source}', not 'd1' — refusing a fallback-only sitemap`);
  }
  return data.articles;
}

async function queryRemote(sql) {
  const { stdout } = await execFileAsync('wrangler', [
    'd1', 'execute', 'fs-ai-db', '--remote', '--command', sql, '--json',
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return parseWranglerJson(stdout);
}

function mergeLiveArticles(staticEntries, liveArticles) {
  const seen = new Set(staticEntries.map((e) => e.loc));
  const merged = [...staticEntries];
  let added = 0;
  for (const a of liveArticles || []) {
    const loc = `${SITE_URL}/pages/article?id=${Number(a.id)}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    merged.push({ loc, lastmod: a.published_at || '', changefreq: 'monthly', priority: 0.7 });
    added += 1;
  }
  return { merged, added };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const requireLive = args.includes('--require-live');
  const fromJsonIdx = args.indexOf('--from-json');
  const fromApiIdx = args.indexOf('--from-api');
  const staticEntries = sitemapEntries();
  let liveArticles = null;
  let liveOk = false;
  if (fromJsonIdx >= 0 && args[fromJsonIdx + 1]) {
    const data = JSON.parse(readFileSync(args[fromJsonIdx + 1], 'utf8'));
    liveArticles = data.articles || [];
    liveOk = true;
  } else if (fromApiIdx >= 0) {
    const next = args[fromApiIdx + 1];
    const url = (next && !next.startsWith('--')) ? next : LIVE_API_URL;
    try {
      liveArticles = await fetchLiveFromApi(url);
      liveOk = true;
    } catch (err) {
      console.error(`[sitemap] WARNING: live API fetch failed (${String((err && err.message) || err)}) — writing static-only sitemap.`);
      if (requireLive) process.exit(1);
    }
  } else {
    try {
      liveArticles = await queryRemote(
        "SELECT id, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC, id DESC",
      );
      liveOk = true;
    } catch (err) {
      console.error(`[sitemap] WARNING: live D1 fetch failed (${String((err && err.message) || err)}) — writing static-only sitemap. Re-run with wrangler authenticated to include newly published articles.`);
      if (requireLive) process.exit(1);
    }
  }
  const { merged, added } = liveOk ? mergeLiveArticles(staticEntries, liveArticles) : { merged: staticEntries, added: 0 };
  const xml = renderSitemapXml(merged);
  const locs = merged.map((e) => e.loc);
  const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
  if (dupes.length) {
    console.error(`DUPLICATE locs: ${dupes.join(', ')}`);
    process.exit(1);
  }
  if (dryRun) {
    process.stdout.write(`${xml}\n`);
    console.error(`[sitemap] dry run: ${merged.length} entries (${added} live-only articles merged, live fetch ${liveOk ? 'ok' : 'FAILED — static only'}) — nothing written.`);
    return;
  }
  for (const target of ['public/sitemap.xml', 'frontend/sitemap.xml']) {
    writeFileSync(join(root, target), `${xml}\n`, 'utf8');
    console.log(`wrote ${target} (${merged.length} entries, ${added} live-only articles merged)`);
  }
  console.log('no duplicate locs');
}

main().catch((err) => {
  console.error(`[sitemap] FAILED: ${String((err && err.message) || err)}`);
  process.exit(1);
});
