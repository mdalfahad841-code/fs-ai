/**
 * FS AI — Content Creation agent module.
 * Drafts articles from a finished research brief only. Drafts are never
 * published here — they go to Fact Checking, then to the owner for approval.
 */
import { stepReadability, stepFactCheck } from '../services/content.js';
import { escapeHtml } from '../security/crypto.js';

export function draftFromBrief(brief) {
  if (!brief || brief.status !== 'ready') {
    return { ok: false, error: 'Brief is not ready — finish research and verify all claims first.' };
  }
  const sections = [
    { heading: 'Introduction', body: `${brief.topic} — what it is, and why it matters.` },
    { heading: 'What you need to know', body: brief.claims.map((c) => c.claim).join(' ') || 'Key points from the research brief.' },
    { heading: 'Step by step', body: 'Practical steps, in order, in plain language.' },
    { heading: 'Common mistakes', body: 'Mistakes to avoid, based on the research.' },
    { heading: 'Summary', body: `The key points about ${brief.topic}, in short.` },
  ];
  const draft = {
    id: `draft-${Date.now().toString(36)}`,
    title: brief.topic,
    division: brief.division,
    sections,
    sources: brief.sources,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  return { ok: true, draft };
}

export function checkDraft(draft) {
  const text = draft.sections.map((s) => `${s.heading} ${s.body}`).join(' ');
  const readability = stepReadability(text);
  const factCheck = stepFactCheck(draft, draft.sources);
  return {
    draftId: draft.id,
    readability,
    factCheck,
    readyForFactChecking: readability.passed && factCheck.passed,
    issues: [...(readability.passed ? [] : [readability.advice]), ...factCheck.issues],
  };
}

export function sanitiseDraft(draft) {
  return {
    ...draft,
    title: escapeHtml(draft.title || ''),
    sections: draft.sections.map((s) => ({ heading: escapeHtml(s.heading), body: escapeHtml(s.body) })),
  };
}
