/**
 * FS AI — Research agent module.
 * Builds sourced research briefs. A brief is only "ready" when it has at
 * least 2 https sources; claims without sources are flagged, never passed on.
 */
import { DIVISIONS } from '../routes/divisions.js';

export const RESEARCH_DIVISIONS = {
  automotive: 'Automotive Research',
  'ai-technology': 'Technology Research',
  'gadgets-electronics': 'Gadget Research',
  'finance-money': 'Finance Research',
  'travel-lifestyle': 'Travel Research',
  'digital-tools': 'Digital Tools',
  'health-wellness': 'Health Research',
  'education-learning': 'Education Research',
};

export function researchBrief(topic, divisionSlug) {
  const division = DIVISIONS.find((d) => d.slug === divisionSlug);
  return {
    id: `brief-${Date.now().toString(36)}`,
    topic: String(topic).slice(0, 200),
    division: division ? division.name : 'Unassigned',
    researcher: RESEARCH_DIVISIONS[divisionSlug] || 'Research',
    questions: [
      `What is ${topic}, in plain language?`,
      `What does a beginner most need to know about ${topic}?`,
      `What are the common mistakes or risks around ${topic}?`,
      `What is different or important about ${topic} in Bangladesh?`,
    ],
    claims: [],
    sources: [],
    status: 'researching',
    createdAt: new Date().toISOString(),
  };
}

export function addClaim(brief, claim, sourceUrl) {
  if (!sourceUrl || !/^https:\/\//.test(sourceUrl)) {
    brief.claims.push({ claim: String(claim).slice(0, 500), source: null, verified: false, flag: 'No source — do not publish this claim.' });
    return brief.claims[brief.claims.length - 1];
  }
  const entry = { claim: String(claim).slice(0, 500), source: sourceUrl, verified: true, flag: null };
  brief.claims.push(entry);
  if (!brief.sources.find((s) => s.url === sourceUrl)) brief.sources.push({ url: sourceUrl, addedAt: new Date().toISOString() });
  return entry;
}

export function finishBrief(brief) {
  const unverified = brief.claims.filter((c) => !c.verified);
  const ready = brief.sources.length >= 2 && unverified.length === 0;
  brief.status = ready ? 'ready' : 'needs-work';
  brief.check = {
    sources: brief.sources.length,
    claims: brief.claims.length,
    unverifiedClaims: unverified.length,
    ready,
    issues: [
      ...(brief.sources.length < 2 ? ['At least 2 sources are required.'] : []),
      ...unverified.map((c) => `Unverified claim: ${c.claim}`),
    ],
  };
  return brief;
}
