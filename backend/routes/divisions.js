/**
 * FS AI — Divisions route. The 8 real divisions of FAHAD SOMRAT AI.
 * D1 first when bound, otherwise the clearly-labelled in-memory fallback.
 */
import { jsonOk, jsonError, parseQuery } from '../middleware/validation.js';
import { ARTICLES } from './articles.js';

export const DIVISIONS = [
  { id: 1, slug: 'automotive', name: 'Automotive', tagline: 'Cars, bikes and driving, explained simply.', description: 'Buying guides, maintenance checklists, fuel saving and EV guides for everyday drivers.' },
  { id: 2, slug: 'ai-technology', name: 'AI & Technology', tagline: 'AI and technology in plain English.', description: 'Beginner-friendly guides to artificial intelligence and the free tools that save time.' },
  { id: 3, slug: 'gadgets-electronics', name: 'Gadgets & Electronics', tagline: 'Phones, laptops and gadgets — what matters most.', description: 'Practical buying guides for smartphones, laptops and everyday electronics.' },
  { id: 4, slug: 'finance-money', name: 'Finance & Money', tagline: 'Budgeting, saving and money basics.', description: 'Budgeting rules, saving on a small income, loans and interest explained simply.' },
  { id: 5, slug: 'travel-lifestyle', name: 'Travel & Lifestyle', tagline: 'Travel well without overspending.', description: 'Budget travel planning, road-trip checklists and practical trip costs.' },
  { id: 6, slug: 'digital-tools', name: 'Digital Tools', tagline: 'Free converters and calculators.', description: 'Free, no-sign-up digital tools: converters, calculators and everyday utilities.' },
  { id: 7, slug: 'health-wellness', name: 'Health & Wellness', tagline: 'Simple, realistic health habits.', description: 'Walking, home workouts and beginner fitness guides with no equipment needed.' },
  { id: 8, slug: 'education-learning', name: 'Education & Learning', tagline: 'Learn a new skill, step by step.', description: 'Practical learning plans, including learning a new digital skill in 30 days.' },
];

export function divisionsWithCounts() {
  return DIVISIONS.map((d) => ({
    ...d,
    articleCount: ARTICLES.filter((a) => a.division === d.slug).length,
  }));
}

export async function handleDivisions(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (method !== 'GET') return jsonError('Method not allowed', 405);

  if (parts.length === 3) {
    const slug = decodeURIComponent(parts[2]);
    if (env.DB) {
      const { results } = await env.DB.prepare('SELECT * FROM divisions WHERE slug = ? LIMIT 1').bind(slug).all();
      if (!results.length) return jsonError('Division not found', 404);
      const count = ARTICLES.filter((a) => a.division === slug).length;
      return jsonOk({ division: { ...results[0], articleCount: count }, source: 'd1' });
    }
    const division = DIVISIONS.find((d) => d.slug === slug);
    if (!division) return jsonError('Division not found', 404);
    return jsonOk({
      division: { ...division, articleCount: ARTICLES.filter((a) => a.division === slug).length },
      articles: ARTICLES.filter((a) => a.division === slug),
      source: 'fallback',
    });
  }

  void parseQuery(url);
  if (env.DB) {
    const { results } = await env.DB.prepare('SELECT * FROM divisions ORDER BY id ASC').all();
    return jsonOk({ divisions: results, total: results.length, source: 'd1' });
  }
  const divisions = divisionsWithCounts();
  return jsonOk({ divisions, total: divisions.length, source: 'fallback' });
}
