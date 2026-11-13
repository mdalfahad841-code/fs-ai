/**
 * FS AI — Articles route.
 * Returns the real 25-article catalogue. When env.DB (D1) is bound, reads
 * from the `articles` table; otherwise uses the clearly-labelled in-memory
 * fallback below (the same real catalogue, never fake live data).
 */
import {
  jsonOk, jsonError, parseQuery, d1All, nowIso, disclaimerForDivision,
} from '../middleware/validation.js';

// Public-article visibility rule (D1): status = 'published' AND
// (publish_at IS NULL OR publish_at <= now) AND the division is active.
// Column names follow database/schema.sql + migration 004: articles has
// division_id (FK to business_divisions) and published_at / publish_at —
// NOT the `division` / `publishedAt` columns this file used before.
// NOTE on seed bodies: the seed now carries the full article bodies
// (619-899 words each, matching the frontend text). The API still returns
// the D1 row as-is — never 404s or hides it for a short body — and the
// frontend falls back to its own full body by slug.
// ORDER BY ... NULLS LAST: live rows seeded before published_at existed
// have NULL dates and must sort after dated rows, not first.
const PUBLIC_LIST_SQL =
  'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
  'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
  "WHERE a.status = ? AND (a.publish_at IS NULL OR a.publish_at <= ?) AND d.is_active = 1";
const PUBLIC_SINGLE_SQL =
  'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
  'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
  'WHERE a.slug = ? AND a.status = ? AND (a.publish_at IS NULL OR a.publish_at <= ?) AND d.is_active = 1 LIMIT 1';

// Fallback list/single queries without the publish_at filter, used only
// when the live D1 has not had migration 004 applied yet (no publish_at
// column) — the status + active-division rules still apply.
const PUBLIC_LIST_SQL_NO_SCHEDULE =
  'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
  'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
  'WHERE a.status = ? AND d.is_active = 1';
const PUBLIC_SINGLE_SQL_NO_SCHEDULE =
  'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
  'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
  'WHERE a.slug = ? AND a.status = ? AND d.is_active = 1 LIMIT 1';

async function queryPublicList(env, division, search, limit) {
  const now = nowIso();
  try {
    let sql = PUBLIC_LIST_SQL;
    const params = ['published', now];
    if (division) { sql += ' AND d.slug = ?'; params.push(division); }
    if (search) { sql += ' AND (a.title LIKE ? OR a.excerpt LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT ?';
    params.push(limit);
    return await d1All(env, sql, params);
  } catch {
    // Migration 004 not applied yet on this database — retry without the
    // publish_at filter rather than failing the public read.
    let sql = PUBLIC_LIST_SQL_NO_SCHEDULE;
    const params = ['published'];
    if (division) { sql += ' AND d.slug = ?'; params.push(division); }
    if (search) { sql += ' AND (a.title LIKE ? OR a.excerpt LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT ?';
    params.push(limit);
    return await d1All(env, sql, params);
  }
}

async function queryPublicSingle(env, slug) {
  const now = nowIso();
  try {
    const rows = await d1All(env, PUBLIC_SINGLE_SQL, [slug, 'published', now]);
    return rows && rows[0];
  } catch {
    const rows = await d1All(env, PUBLIC_SINGLE_SQL_NO_SCHEDULE, [slug, 'published']);
    return rows && rows[0];
  }
}

function withDisclaimer(article) {
  if (!article) return article;
  const disclaimer = disclaimerForDivision(article.division);
  return disclaimer ? { ...article, disclaimer } : article;
}

export const ARTICLES = [
  { id: 1, slug: 'ev-charging-at-home-beginners-guide', title: "EV Charging at Home: A Complete Beginner's Guide", division: 'automotive', divisionName: 'Automotive', excerpt: 'Home charging explained in plain language: charger types, costs, installation and safety.', status: 'published', publishedAt: '2026-11-01' },
  { id: 2, slug: 'car-maintenance-checklist-monthly', title: 'Car Maintenance Checklist: 12 Things to Check Every Month', division: 'automotive', divisionName: 'Automotive', excerpt: 'A simple monthly checklist that keeps a car reliable and avoids costly repairs.', status: 'published', publishedAt: '2026-11-01' },
  { id: 3, slug: 'hybrid-vs-petrol-which-saves-more-2026', title: 'Hybrid vs Petrol: Which Saves You More in 2026?', division: 'automotive', divisionName: 'Automotive', excerpt: 'Fuel, maintenance and purchase costs compared honestly for 2026 buyers.', status: 'published', publishedAt: '2026-11-02' },
  { id: 4, slug: 'motorcycle-buying-guide-first-bike', title: 'Motorcycle Buying Guide: How to Choose Your First Bike', division: 'automotive', divisionName: 'Automotive', excerpt: 'Engine size, budget, safety gear and the mistakes first-time buyers should avoid.', status: 'published', publishedAt: '2026-11-02' },
  { id: 5, slug: 'how-to-read-car-warning-lights', title: "How to Read Your Car's Warning Lights", division: 'automotive', divisionName: 'Automotive', excerpt: 'What each dashboard warning light means and what to do next.', status: 'published', publishedAt: '2026-11-03' },
  { id: 6, slug: 'fuel-economy-15-proven-ways-save-fuel', title: 'Fuel Economy: 15 Proven Ways to Save Fuel', division: 'automotive', divisionName: 'Automotive', excerpt: 'Driving habits and maintenance steps that genuinely cut fuel use.', status: 'published', publishedAt: '2026-11-03' },
  { id: 7, slug: 'adas-explained-driver-assistance', title: 'ADAS Explained: How Driver Assistance Really Works', division: 'automotive', divisionName: 'Automotive', excerpt: 'Adaptive cruise, lane keeping and emergency braking — what they do and their limits.', status: 'published', publishedAt: '2026-11-04' },
  { id: 8, slug: 'electric-vehicle-range-what-numbers-mean', title: 'Electric Vehicle Range: What the Numbers Really Mean', division: 'automotive', divisionName: 'Automotive', excerpt: 'Why real-world EV range differs from the brochure figure.', status: 'published', publishedAt: '2026-11-04' },
  { id: 9, slug: 'how-to-diagnose-common-engine-noises', title: 'How to Diagnose Common Engine Noises', division: 'automotive', divisionName: 'Automotive', excerpt: 'Knocks, squeals and rattles — what common engine sounds can indicate.', status: 'published', publishedAt: '2026-11-05' },
  { id: 10, slug: 'new-vs-used-cars-practical-buying-guide', title: 'New vs Used Cars: A Practical Buying Guide', division: 'automotive', divisionName: 'Automotive', excerpt: 'A practical, numbers-first way to decide between new and used.', status: 'published', publishedAt: '2026-11-05' },
  { id: 11, slug: 'car-safety-ratings-explained', title: 'Car Safety Ratings Explained', division: 'automotive', divisionName: 'Automotive', excerpt: 'Crash-test stars, safety assist scores and what they actually measure.', status: 'published', publishedAt: '2026-11-06' },
  { id: 12, slug: 'best-family-cars-compared', title: 'Best Family Cars Compared: Space, Safety and Running Costs', division: 'automotive', divisionName: 'Automotive', excerpt: 'Family cars compared on space, safety and everyday running costs.', status: 'published', publishedAt: '2026-11-06' },
  { id: 13, slug: 'what-is-ai-plain-english-guide', title: 'What Is AI? A Plain-English Guide for Beginners', division: 'ai-technology', divisionName: 'AI & Technology', excerpt: 'Artificial intelligence explained without jargon, with everyday examples.', status: 'published', publishedAt: '2026-11-07' },
  { id: 14, slug: '7-free-ai-tools-that-save-time', title: '7 Free AI Tools That Actually Save Time', division: 'ai-technology', divisionName: 'AI & Technology', excerpt: 'Free AI tools worth using — and what to check before trusting their output.', status: 'published', publishedAt: '2026-11-07' },
  { id: 15, slug: 'smartphone-buying-guide-2026', title: 'Smartphone Buying Guide 2026: What Matters Most', division: 'gadgets-electronics', divisionName: 'Gadgets & Electronics', excerpt: 'Battery, camera, storage and support — the specs that matter in 2026.', status: 'published', publishedAt: '2026-11-08' },
  { id: 16, slug: 'laptop-vs-tablet-which-should-you-buy', title: 'Laptop vs Tablet: Which One Should You Buy?', division: 'gadgets-electronics', divisionName: 'Gadgets & Electronics', excerpt: 'Work, study and everyday use — which device fits which person.', status: 'published', publishedAt: '2026-11-08' },
  { id: 17, slug: 'monthly-budgeting-50-30-20-rule', title: 'Monthly Budgeting: The 50/30/20 Rule Explained', division: 'finance-money', divisionName: 'Finance & Money', excerpt: 'A simple budgeting rule for needs, wants and savings, with a worked example.', status: 'published', publishedAt: '2026-11-09' },
  { id: 18, slug: 'how-to-start-saving-small-income', title: 'How to Start Saving With a Small Income', division: 'finance-money', divisionName: 'Finance & Money', excerpt: 'Small, realistic saving steps that work even on a tight income.', status: 'published', publishedAt: '2026-11-09' },
  { id: 19, slug: 'travel-on-a-budget-plan-without-overspending', title: 'Travel on a Budget: Plan a Trip Without Overspending', division: 'travel-lifestyle', divisionName: 'Travel & Lifestyle', excerpt: 'Budgeting a trip before you go, so the trip stays enjoyable and affordable.', status: 'published', publishedAt: '2026-11-10' },
  { id: 20, slug: 'free-digital-tools-converters-calculators', title: 'Free Digital Tools: Converters and Calculators You Can Use Today', division: 'digital-tools', divisionName: 'Digital Tools', excerpt: 'Free converters and calculators on FS AI — no sign-up, no cost.', status: 'published', publishedAt: '2026-11-10' },
  { id: 21, slug: 'walking-for-health-beginners-fitness-guide', title: "Walking for Health: A Beginner's Fitness Guide", division: 'health-wellness', divisionName: 'Health & Wellness', excerpt: 'How to start walking for fitness safely, and how to build the habit.', status: 'published', publishedAt: '2026-11-11' },
  { id: 22, slug: 'how-to-learn-new-digital-skill-30-days', title: 'How to Learn a New Digital Skill in 30 Days', division: 'education-learning', divisionName: 'Education & Learning', excerpt: 'A 30-day plan for learning one practical digital skill, step by step.', status: 'published', publishedAt: '2026-11-11' },
  { id: 23, slug: 'home-workout-basics-no-equipment', title: 'Home Workout Basics: No Equipment Needed', division: 'health-wellness', divisionName: 'Health & Wellness', excerpt: 'Safe beginner bodyweight exercises you can do at home with no equipment.', status: 'published', publishedAt: '2026-11-11' },
  { id: 24, slug: 'understanding-interest-loans-explained', title: 'Understanding Interest: Loans Explained Simply', division: 'finance-money', divisionName: 'Finance & Money', excerpt: 'Interest, flat vs reducing balance, and the total cost of a loan, explained simply.', status: 'published', publishedAt: '2026-11-11' },
  { id: 25, slug: 'how-to-plan-road-trip-checklist-costs', title: 'How to Plan a Road Trip: Checklist and Costs', division: 'travel-lifestyle', divisionName: 'Travel & Lifestyle', excerpt: 'Route, vehicle checks, budget and packing — a complete road-trip checklist.', status: 'published', publishedAt: '2026-11-11' },
];

export async function handleArticles(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, articles, [slug]

  if (method !== 'GET') return jsonError('Method not allowed', 405);

  // Single article: /api/articles/:slug
  if (parts.length === 3) {
    const slug = decodeURIComponent(parts[2]);
    if (env.DB) {
      const article = await queryPublicSingle(env, slug);
      if (!article) return jsonError('Article not found', 404);
      return jsonOk({ article: withDisclaimer(article), source: 'd1' });
    }
    const article = ARTICLES.find((a) => a.slug === slug);
    if (!article) return jsonError('Article not found', 404);
    return jsonOk({ article: withDisclaimer(article), source: 'fallback' });
  }

  const q = parseQuery(url);
  const division = q.get('division');
  const search = (q.get('search') || '').toLowerCase();
  const limit = Math.min(Math.max(parseInt(q.get('limit') || '25', 10) || 25, 1), 100);

  if (env.DB) {
    const rows = await queryPublicList(env, division, search, limit);
    return jsonOk({ articles: rows, total: rows.length, source: 'd1' });
  }

  // In-memory fallback — the real catalogue above, clearly labelled.
  let list = ARTICLES.filter((a) => a.status === 'published');
  if (division) list = list.filter((a) => a.division === division);
  if (search) list = list.filter((a) => (a.title + ' ' + a.excerpt).toLowerCase().includes(search));
  return jsonOk({ articles: list.slice(0, limit), total: list.length, source: 'fallback' });
}
