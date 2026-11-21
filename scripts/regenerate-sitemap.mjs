// FS AI — regenerate both committed sitemaps from the static generator
// PLUS live published articles from D1.
//
// Usage:
//   node scripts/regenerate-sitemap.mjs [--dry-run] [--from-json <file>] [--require-live]
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
// Live data source: `wrangler d1 execute fs-ai-db --remote --json`
// (requires wrangler authenticated for the fs-ai account). For offline
// use or tests pass --from-json <file> with
// {"articles":[{"id","published_at"}], "divisions":[{"slug"}]}.
// --dry-run prints the XML instead of writing. If the live fetch fails,
// the script warns loudly and writes the static-only sitemap (exit 0),
// unless --require-live is passed (exit 1 — use it in the deploy
// pipeline once wrangler auth exists there).
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

function parseWranglerJson(stdout) {
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const rows = first?.results ?? first?.rows ?? [];
  return Array.isArray(rows) ? rows : [];
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
  const staticEntries = sitemapEntries();
  let liveArticles = null;
  let liveOk = false;
  if (fromJsonIdx >= 0 && args[fromJsonIdx + 1]) {
    const data = JSON.parse(readFileSync(args[fromJsonIdx + 1], 'utf8'));
    liveArticles = data.articles || [];
    liveOk = true;
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
