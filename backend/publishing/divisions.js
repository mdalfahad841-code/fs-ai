/**
 * FS AI — per-division publishing configuration (W3 autonomous publishing).
 *
 * One config entry per division (all 8), covering what the publish path
 * needs to decide WITHOUT inventing anything:
 *   - research sources: the 3 verified RSS feeds per division seeded by
 *     migration 008 (live-verified 2026-11-19; 24 total). The config
 *     names them so a division with no configured source is visible;
 *     the live counts come from research_sources, not from this list.
 *   - editorial rules: tone + word-count band (content.js writes
 *     600-900 words) + minimum recorded sources. Health & Finance
 *     require 2 sources, the rest 1.
 *   - internal-link scoping: links must be same-division AND topically
 *     relevant (title-keyword overlap — see isInternalLinkRelevant).
 *     A same-division link to an unrelated article
 *     does NOT count.
 *   - schedule: an 8-day rolling rotation (cycleDays 8, one division
 *     per day, dayOffset 0-7) that respects the GLOBAL
 *     max_articles_per_day=1 — a slot is a preference, never a licence
 *     to publish a second article in a day; the daily-limit check in
 *     the gate always wins.
 *   - social distribution hooks: which channels a published article
 *     MAY be distributed to. Hooks only — social_auto_post stays 'off'
 *     and no social API auth exists, so nothing posts automatically.
 *   - special review: Health & Wellness and Finance & Money Education
 *     are ALWAYS owner-approval-only (never auto-publishable) and any
 *     claim that reads as professional advice must cite a named
 *     authoritative source (see AUTHORITATIVE_HOSTS + the advice
 *     patterns); an unverified advice claim BLOCKS the article with a
 *     reason instead of auto-publishing it.
 *
 * Pure data + pure helpers only — no I/O, no D1, no LLM.
 */
import { titleKeywords } from '../agents/autonomy/seo.js';

export const DIVISION_CONFIG = [
  {
    id: 1, slug: 'automotive', name: 'Automotive',
    editorial: { tone: 'Plain-English, practical, driver-first.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'Electrek', url: 'https://electrek.co/feed/' },
      { name: 'InsideEVs', url: 'https://insideevs.com/feed/' },
      { name: 'The Verge - Transportation', url: 'https://www.theverge.com/rss/transportation/index.xml' },
    ],
    internalLinkScope: 'Same division (automotive) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 0, note: 'Day 1 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
  {
    id: 2, slug: 'ai-technology', name: 'AI & Technology',
    editorial: { tone: 'Beginner-friendly, plain English, no hype, no invented capability claims.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
      { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
      { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    ],
    internalLinkScope: 'Same division (ai-technology) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 1, note: 'Day 2 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
  {
    id: 3, slug: 'gadgets-electronics', name: 'Gadgets & Electronics',
    editorial: { tone: 'Practical, comparison-first, prices only when sourced.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
      { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
      { name: 'WIRED', url: 'https://www.wired.com/feed/rss' },
    ],
    internalLinkScope: 'Same division (gadgets-electronics) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 2, note: 'Day 3 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
  {
    id: 4, slug: 'finance-money', name: 'Finance & Money Education',
    editorial: { tone: 'Cautious, plain-language, no promises, no guaranteed returns.', minWords: 600, maxWords: 900, minSources: 2, sourceRequirement: 'At least 2 recorded sources with URLs; advice claims need a named authoritative source (see authoritativeHosts).' },
    sources: [
      { name: 'BBC News - Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
      { name: 'The Economist - Finance & Economics', url: 'https://www.economist.com/finance-and-economics/rss.xml' },
      { name: 'NerdWallet', url: 'https://www.nerdwallet.com/blog/feed/' },
    ],
    internalLinkScope: 'Same division (finance-money) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 3, note: 'Day 4 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: true, neverAutoPublish: true,
    authoritativeHosts: ['worldbank.org', 'imf.org', 'sec.gov', 'investor.gov', 'federalreserve.gov', 'bankofengland.co.uk', 'fca.org.uk', 'oecd.org'],
  },
  {
    id: 5, slug: 'travel-lifestyle', name: 'Travel & Lifestyle',
    editorial: { tone: 'Budget-conscious, practical, costs only when sourced.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'Conde Nast Traveler', url: 'https://www.cntraveler.com/feed/rss' },
      { name: 'The Guardian - Travel', url: 'https://www.theguardian.com/travel/rss' },
      { name: 'Skift', url: 'https://www.skift.com/feed/' },
    ],
    internalLinkScope: 'Same division (travel-lifestyle) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 4, note: 'Day 5 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
  {
    id: 6, slug: 'digital-tools', name: 'Digital Tools & Utilities',
    editorial: { tone: 'Step-by-step, exact, every step reproducible.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'MDN Blog', url: 'https://developer.mozilla.org/en-US/blog/rss.xml' },
      { name: 'The GitHub Blog', url: 'https://github.blog/feed/' },
      { name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/feed/' },
    ],
    internalLinkScope: 'Same division (digital-tools) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 5, note: 'Day 6 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
  {
    id: 7, slug: 'health-wellness', name: 'Health & Wellness',
    editorial: { tone: 'Gentle, realistic, no medical claims, no dosage or treatment advice without an authoritative source.', minWords: 600, maxWords: 900, minSources: 2, sourceRequirement: 'At least 2 recorded sources with URLs; advice claims need a named authoritative source (see authoritativeHosts).' },
    sources: [
      { name: 'BBC News - Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
      { name: 'Medical Xpress', url: 'https://www.medicalxpress.com/rss-feed/' },
      { name: 'The Guardian - Health', url: 'https://www.theguardian.com/society/health/rss' },
    ],
    internalLinkScope: 'Same division (health-wellness) AND topically relevant (title-keyword overlap).',
    schedule: { cycleDays: 8, dayOffset: 6, note: 'Day 7 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: true, neverAutoPublish: true,
    authoritativeHosts: ['who.int', 'nih.gov', 'cdc.gov', 'nhs.uk', 'mayoclinic.org', 'medlineplus.gov', 'health.harvard.edu', 'niddk.nih.gov'],
  },
  {
    id: 8, slug: 'education-learning', name: 'Education & Learning',
    editorial: { tone: 'Encouraging, step-by-step, practical learning plans.', minWords: 600, maxWords: 900, minSources: 1, sourceRequirement: 'At least 1 recorded source with a URL.' },
    sources: [
      { name: 'EdSurge', url: 'https://www.edsurge.com/feed' },
      { name: 'Inside Higher Ed', url: 'https://www.insidehighered.com/rss.xml' },
      { name: 'Higher Ed Dive', url: 'https://www.educationdive.com/feeds/news/' },
    ],
    internalLinkScope: 'Same division (education-learning) AND topically relevant (title-keyword overlap). Note: division 8 has only ONE published article (#22) — a draft whose only same-division sibling is topically unrelated stays blocked on internal-links; the link must never be faked.',
    schedule: { cycleDays: 8, dayOffset: 7, note: 'Day 8 of the 8-day rotation; global max 1 article/day always wins.' },
    social: { youtube: true, pinterest: true, note: 'Distribution hooks only — social_auto_post is off; nothing posts automatically.' },
    specialReview: false, neverAutoPublish: false, authoritativeHosts: [],
  },
];

export function getDivisionConfig(slug) {
  return DIVISION_CONFIG.find((d) => d.slug === slug) || null;
}

export function getDivisionConfigById(id) {
  return DIVISION_CONFIG.find((d) => d.id === Number(id)) || null;
}

export function isSpecialReviewDivision(slug) {
  const cfg = getDivisionConfig(slug);
  return Boolean(cfg && cfg.specialReview);
}

/** True when the division's slot falls on this day of the 8-day rotation. */
export function divisionDueOnDay(slug, dayIndex) {
  const cfg = getDivisionConfig(slug);
  if (!cfg) return false;
  return ((Number(dayIndex) % cfg.schedule.cycleDays) + cfg.schedule.cycleDays) % cfg.schedule.cycleDays === cfg.schedule.dayOffset;
}

// ---------------------------------------------------------------------------
// Internal-link relevance: same division AND topical overlap.
// ---------------------------------------------------------------------------

/** Article-body links in the site's canonical form (?id=N). */
export function extractLinkedArticleIds(body) {
  const ids = new Set();
  for (const m of String(body || '').matchAll(/[?&]id=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

// Words so generic they carry no topic ("guide", "best", "tips").
// A shared generic word alone must NOT establish relevance — that is
// exactly how an unrelated same-division link (#31 -> #22) would
// otherwise pass. Relevance needs >= 1 shared TOPICAL keyword.
const GENERIC_KEYWORDS = new Set([
  'guide', 'guides', 'tip', 'tips', 'best', 'top', 'how', 'why', 'what',
  'review', 'reviews', 'beginner', 'beginners', 'complete', 'ultimate',
  'simple', 'easy', 'basics', 'introduction', 'intro', 'overview',
  'learn', 'learning', 'things', 'ways', 'need', 'needs', 'know',
  // Words that appear in almost every article title and carry no topic:
  // 'article' alone must never make two titles "relevant" (2026-11-21).
  'article', 'articles', 'post', 'posts',
]);

/**
 * True only when the linked article is a genuine "related reading"
 * target: same division AND at least one shared TOPICAL title keyword
 * (stopwords filtered, same function the SEO suite uses; generic
 * words like "guide" do not count). A same-division link with no
 * topical overlap is NOT relevant and must never
 * satisfy the internal-links check.
 */
export function isInternalLinkRelevant(article, linkedArticle) {
  if (!article || !linkedArticle) return false;
  if (Number(article.division_id) !== Number(linkedArticle.division_id)) return false;
  const mine = new Set(titleKeywords(article.title).filter((k) => !GENERIC_KEYWORDS.has(k)));
  const theirs = titleKeywords(linkedArticle.title).filter((k) => !GENERIC_KEYWORDS.has(k));
  return theirs.some((k) => mine.has(k));
}

// ---------------------------------------------------------------------------
// Special review: professional-advice claims in Health / Finance.
// ---------------------------------------------------------------------------

// Language that reads as professional advice. Deliberately narrow:
// generic encouragement ("save a little each month") does not match;
// a dosage, a diagnosis/treatment claim, or a specific
// buy/sell/guaranteed-return instruction does.
const ADVICE_PATTERNS = [
  { kind: 'medical-dosage', re: /\b(dosage|dose of|\d+\s*mg per day|take .* (tablet|pill|supplement) (daily|every day))\b/i },
  { kind: 'medical-diagnosis-treatment', re: /\b(diagnos(e|is|ed|ing)|treatment for|treats? (the|your|this)|cure(s|d)? (for|the)|see (a|your) (doctor|physician)|consult (a|your) (doctor|physician)|symptoms of)\b/i },
  { kind: 'financial-investment', re: /\b(invest in|buy (shares|stocks?|crypto|bitcoin)|sell (your )?(shares|stocks?)|guaranteed returns?|risk-?free (return|investment)|you will (earn|make) .*%|take out a (loan|mortgage) to invest)\b/i },
  { kind: 'financial-tax', re: /\b(tax advice|avoid (paying )?tax|deduct .* from (your )?tax)\b/i },
];

/** { needsAuthority, kind } — kind is null when the text is not advice. */
export function adviceClaimNeedsAuthority(claimText) {
  const text = String(claimText || '');
  for (const p of ADVICE_PATTERNS) {
    if (p.re.test(text)) return { needsAuthority: true, kind: p.kind };
  }
  return { needsAuthority: false, kind: null };
}

/**
 * True when the evidence URL is a named authoritative source for the
 * division: an exact/parent host from the division's authoritativeHosts
 * list, or a .gov / .gov.uk / .edu / .ac.uk host. Unparseable URLs are
 * NOT authoritative (fail-closed).
 */
export function isAuthoritativeSource(url, slug) {
  let host = '';
  try {
    host = new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (/(^|\.)gov(\.[a-z]{2})?$/.test(host) || host.endsWith('.gov.uk') || host.endsWith('.edu') || host.endsWith('.ac.uk')) return true;
  const cfg = getDivisionConfig(slug);
  if (!cfg) return false;
  return cfg.authoritativeHosts.some((h) => host === h || host.endsWith(`.${h}`));
}
