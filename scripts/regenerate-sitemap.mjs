// FS AI — regenerate both committed sitemaps from the generator.
//
// Usage: node scripts/regenerate-sitemap.mjs
// Writes public/sitemap.xml AND frontend/sitemap.xml from
// backend/services/seo.js sitemapXml() — the two files must stay
// identical, and tests/sitemap-canonical.test.js asserts their loc
// sets equal the generator output. Re-run after adding a published
// article, a division, a tool, or a public page. (Phase 3, P8.)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sitemapXml, sitemapEntries } from '../backend/services/seo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const xml = sitemapXml();
const entries = sitemapEntries();
for (const target of ['public/sitemap.xml', 'frontend/sitemap.xml']) {
  writeFileSync(join(root, target), `${xml}\n`, 'utf8');
  console.log(`wrote ${target} (${entries.length} entries)`);
}
const locs = entries.map((e) => e.loc);
const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
if (dupes.length) {
  console.error(`DUPLICATE locs: ${dupes.join(', ')}`);
  process.exit(1);
}
console.log('no duplicate locs');
