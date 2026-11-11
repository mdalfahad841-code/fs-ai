/**
 * FS AI — Content service.
 * The 14-step content workflow. Every step is real executable logic:
 * research, intent, keywords, sources, draft, fact-check, readability,
 * SEO check, duplicate check, prepare, submit for owner approval, publish
 * after approval, monitor, update. Nothing publishes without owner approval.
 */
import { escapeHtml } from '../security/crypto.js';
import { DIVISIONS } from '../routes/divisions.js';

export const WORKFLOW_STEPS = [
  'research', 'intent', 'keywords', 'sources', 'draft', 'fact-check',
  'readability', 'seo-check', 'duplicate-check', 'prepare',
  'submit-for-approval', 'publish-after-approval', 'monitor', 'update',
];

export const STOP_WORDS = new Set('a an the and or of to in on for with is are was were be by at from as it this that these those i you he she we they'.split(' '));

export function stepResearch(topic, divisionSlug) {
  const division = DIVISIONS.find((d) => d.slug === divisionSlug) || null;
  return {
    step: 'research', topic,
    division: division ? division.name : 'Unassigned',
    questions: [
      `What does a beginner need to know about ${topic}?`,
      `What mistakes do people commonly make with ${topic}?`,
      `What would a reader in Bangladesh need to know about ${topic}?`,
    ],
    notes: 'Research from reputable, verifiable sources only. Record every source URL.',
  };
}

export function stepIntent(topic) {
  const t = topic.toLowerCase();
  let intent = 'informational';
  if (/(buy|best|choose|vs|versus|compare)/.test(t)) intent = 'commercial';
  else if (/(how to|guide|checklist|steps)/.test(t)) intent = 'how-to';
  return { step: 'intent', topic, intent, audience: 'general reader, beginner level' };
}

export function stepKeywords(topic) {
  const words = topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w && !STOP_WORDS.has(w));
  const primary = words.slice(0, 3).join(' ');
  return {
    step: 'keywords', topic, primary,
    secondary: words.slice(0, 5),
    longTail: [`${primary} guide`, `how to ${primary}`, `${primary} for beginners`].filter((k) => k.trim().length > 3),
  };
}

export function stepSources(topic) {
  return {
    step: 'sources', topic,
    required: 2,
    sources: [],
    rule: 'At least 2 independent reputable sources. No source = no factual claim. Add sources with addSource().',
  };
}

export function addSource(workflow, url, publisher) {
  if (!/^https:\/\//.test(url)) throw new Error('Source URL must start with https://');
  workflow.sources.push({ url, publisher: publisher || 'Unknown', addedAt: new Date().toISOString() });
  return workflow.sources;
}

export function stepDraft(topic, outline) {
  const sections = Array.isArray(outline) && outline.length ? outline : ['Introduction', 'What you need to know', 'Step-by-step guide', 'Common mistakes', 'Summary'];
  return {
    step: 'draft', topic,
    title: topic,
    sections: sections.map((heading) => ({ heading, body: '' })),
    rule: 'Plain language. Short sentences. No invented numbers, prices or statistics.',
  };
}

export function stepFactCheck(draft, sources) {
  const issues = [];
  if (!sources || sources.length < 2) issues.push('Fewer than 2 sources — add at least 2 reputable sources.');
  const text = JSON.stringify(draft);
  const suspicious = /\b(always|never|guaranteed|100%|best in the world)\b/i.test(text);
  if (suspicious) issues.push('Absolute claim found (always/never/guaranteed) — soften or cite a source.');
  return { step: 'fact-check', passed: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

export function stepReadability(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgWordsPerSentence = sentences.length ? words.length / sentences.length : 0;
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 25).length;
  return {
    step: 'readability',
    words: words.length,
    sentences: sentences.length,
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    longSentences,
    passed: avgWordsPerSentence <= 20 && longSentences === 0,
    advice: avgWordsPerSentence > 20 ? 'Shorten sentences — aim for under 20 words each.' : 'Readability OK.',
  };
}

export function stepSeoCheck(article, keywords) {
  const issues = [];
  if (!article.title || article.title.length > 60) issues.push('Title should be under 60 characters.');
  if (!article.excerpt || article.excerpt.length > 160) issues.push('Meta description should be under 160 characters.');
  if (keywords && keywords.primary && !article.title.toLowerCase().includes(keywords.primary.split(' ')[0])) {
    issues.push('Primary keyword not present in the title.');
  }
  return { step: 'seo-check', passed: issues.length === 0, issues };
}

export function stepDuplicateCheck(title, existingTitles) {
  const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = normalise(title);
  const duplicates = (existingTitles || []).filter((t) => normalise(t) === target);
  const near = (existingTitles || []).filter((t) => {
    const n = normalise(t);
    return n !== target && (n.includes(target) || target.includes(n));
  });
  return { step: 'duplicate-check', passed: duplicates.length === 0, duplicates, nearDuplicates: near };
}

export function stepPrepare(article) {
  return {
    step: 'prepare',
    title: escapeHtml(article.title || ''),
    excerpt: escapeHtml(article.excerpt || ''),
    slug: (article.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    status: 'ready-for-review',
    preparedAt: new Date().toISOString(),
  };
}

export function createWorkflow(topic, divisionSlug) {
  return {
    id: `wf-${Date.now().toString(36)}`,
    topic, division: divisionSlug || null,
    steps: WORKFLOW_STEPS.map((s) => ({ name: s, status: 'pending', at: null })),
    sources: [],
    status: 'research',
    ownerApproval: 'not-submitted',
    createdAt: new Date().toISOString(),
  };
}

export function advanceWorkflow(workflow, stepName, result) {
  const step = workflow.steps.find((s) => s.name === stepName);
  if (!step) throw new Error(`Unknown workflow step: ${stepName}`);
  step.status = 'done';
  step.at = new Date().toISOString();
  if (result !== undefined) step.result = result;
  const next = workflow.steps.find((s) => s.status === 'pending');
  workflow.status = next ? next.name : 'complete';
  return workflow;
}

export function submitForApproval(workflow) {
  const done = workflow.steps.filter((s) => s.status === 'done').map((s) => s.name);
  const required = WORKFLOW_STEPS.slice(0, 10); // through 'prepare'
  const missing = required.filter((s) => !done.includes(s));
  if (missing.length) return { ok: false, error: `Cannot submit: steps incomplete: ${missing.join(', ')}` };
  workflow.ownerApproval = 'pending';
  workflow.status = 'awaiting-owner-approval';
  return { ok: true, workflow };
}

export function publishAfterApproval(workflow, approved, approver) {
  if (workflow.ownerApproval !== 'approved') {
    return { ok: false, error: 'Cannot publish: owner approval is required first.' };
  }
  if (!approved) return { ok: false, error: 'Publish refused by owner decision.' };
  workflow.status = 'published';
  workflow.publishedAt = new Date().toISOString();
  workflow.publishedBy = approver || 'owner';
  return { ok: true, workflow };
}

export function approveWorkflow(workflow, approver) {
  workflow.ownerApproval = 'approved';
  workflow.approvedBy = approver || 'owner';
  workflow.approvedAt = new Date().toISOString();
  return workflow;
}

export function monitorArticle(article) {
  // Honest monitoring: without a connected analytics source there is no
  // traffic to report. This records the check, it does not invent numbers.
  return {
    step: 'monitor', slug: article.slug, checkedAt: new Date().toISOString(),
    visitors: 'Data unavailable', revenue: 0,
    note: 'No analytics connected yet.',
  };
}

export function updateArticle(article, changes) {
  const allowed = ['title', 'excerpt', 'division'];
  const updated = { ...article };
  for (const key of allowed) if (changes[key] !== undefined) updated[key] = String(changes[key]).slice(0, 500);
  updated.updatedAt = new Date().toISOString();
  updated.status = 'published';
  return updated;
}
