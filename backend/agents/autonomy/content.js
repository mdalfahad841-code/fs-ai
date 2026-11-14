/**
 * FS AI — Autonomy: content-creation agent handler.
 *
 * Tries the free LLM layer (backend/llm/) first. On success it returns
 * an AI-DRAFT: a real article body marked llmGenerated, still needing
 * fact-checking AND owner approval — it is never auto-published (the
 * scheduler only publishes owner-approved articles, and convert stores
 * it as a 'draft' with fact_checked = 0). When every free LLM provider
 * is unavailable or capped, it returns the scaffold only with outcome
 * 'no-op' — no article body is fabricated. No article row is inserted
 * here; the orchestrator converts a scaffold/draft into a CMS draft
 * via convertScaffoldToDraft.
 */
import {
  d1First, d1Run, nowIso, slugify, sanitiseText, isValidSlug,
  disclaimerForDivision,
} from '../../middleware/validation.js';
import { generateText } from '../../llm/index.js';

const LLM_SYSTEM_PROMPT =
  'You write plain-language educational articles for a general audience. ' +
  'Write 600-900 words in clear, simple English. Use only facts from the ' +
  'sources given in the user message. Do not invent statistics, dates, ' +
  'prices, names or claims, and do not cite any source that was not given. ' +
  'Structure the article with the outline headings given.';

function buildLlmPrompt({ title, divisionName, outline, sources }) {
  const lines = [
    `Write an article titled "${title}" for the ${divisionName} division.`,
    '',
    'Outline:',
    ...outline.map((h) => `- ${h}`),
    '',
  ];
  if (sources.length) {
    lines.push('Sources (cite only these, by name or URL, where you use them):');
    lines.push(...sources.map((s) => `- ${s}`));
  } else {
    lines.push('No sources were supplied — write only general, non-factual guidance and state nothing that would need a source.');
  }
  return lines.join('\n');
}

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

function headingsFromTitle(title, sources) {
  const headings = ['Introduction'];
  const words = String(title || '').toLowerCase();
  if (/how|guide|steps|tips/.test(words)) headings.push('How it works', 'Step-by-step');
  if (/best|top|review|compare/.test(words)) headings.push('What to look for', 'Comparison');
  if (/cost|price|budget|save|money/.test(words)) headings.push('Costs and budgeting');
  if (Array.isArray(sources) && sources.length) headings.push('Sources and further reading');
  headings.push('Key takeaways');
  return [...new Set(headings)];
}

export async function runContentCreation(task, env) {
  const payload = parsePayload(task);
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const division = typeof payload.division === 'string' ? payload.division.trim() : '';
  const sources = Array.isArray(payload.sources)
    ? payload.sources.filter((s) => typeof s === 'string').slice(0, 10)
    : [];
  if (title.length < 5) {
    return { outcome: 'failed', error: 'Content scaffold needs a title of at least 5 characters.' };
  }
  if (!division || !isValidSlug(division)) {
    return { outcome: 'failed', error: 'Content scaffold needs a valid division slug.' };
  }
  // Division must really exist — never scaffold for an unknown division.
  const row = await d1First(env, 'SELECT id, slug, name FROM business_divisions WHERE slug = ? LIMIT 1', [division]);
  if (!row) {
    return { outcome: 'failed', error: `Unknown division slug: ${division}.` };
  }
  const outline = Array.isArray(payload.outline) && payload.outline.length
    ? payload.outline.filter((h) => typeof h === 'string').slice(0, 12)
    : headingsFromTitle(title, sources);
  const seoTitle = title.slice(0, 60);
  const seoDescription = `A plain-language guide: ${title}`.slice(0, 160);
  const scaffold = {
    title,
    division,
    divisionId: row.id,
    outline,
    seoTitle,
    seoDescription,
    sources,
    factCheckFlags: sources.length === 0
      ? ['No sources supplied — every factual claim will need a source before approval.']
      : [],
    note: 'SCAFFOLD — full article body needs an LLM or the owner; no body was fabricated',
  };

  // First try the free LLM layer. Any failure is honest: fall back to
  // the scaffold with outcome 'no-op' — never fabricate a body.
  const disclaimer = disclaimerForDivision(division);
  const system = LLM_SYSTEM_PROMPT + (disclaimer
    ? ` End with this exact disclaimer sentence: "${disclaimer}"`
    : '');
  const llm = await generateText({
    prompt: buildLlmPrompt({ title, divisionName: row.name, outline, sources }),
    system,
    maxTokens: 1500,
    purpose: 'content-creation',
  }, env);
  if (llm.ok && llm.text) {
    const body = sanitiseText(llm.text, 20000);
    const draft = {
      title,
      division,
      divisionId: row.id,
      body,
      outline,
      seoTitle,
      seoDescription,
      sources,
      llmGenerated: true,
      provider: llm.provider,
      model: llm.model,
      needsFactCheck: true,
      factCheckFlags: [...scaffold.factCheckFlags, 'AI-generated draft — needs fact-checking before approval.'],
      note: 'AI-DRAFT — needs fact-check + owner approval; never auto-publish.',
    };
    return {
      outcome: 'done',
      draft,
      // The scaffold carries the LLM body too, so the existing
      // convert endpoint (which reads detail.scaffold) stores the
      // real draft body instead of a placeholder.
      scaffold: { ...scaffold, body, llmGenerated: true, provider: llm.provider, model: llm.model, needsFactCheck: true },
    };
  }
  return {
    outcome: 'no-op',
    scaffold,
    reason: 'All free LLM providers unavailable — generation paused',
    providerStatuses: llm.providerStatuses || [],
  };
}

/**
 * Convert a scaffold (as stored in an agent_runs.detail) into a CMS draft.
 * Same validation as the admin article create: title >= 5 chars, valid
 * division slug, unique slug (409 on clash). A plain scaffold gets a
 * body clearly marked SCAFFOLD; a scaffold carrying an LLM body
 * (llmGenerated) stores that body under a clear 'AI-DRAFT — needs
 * fact-check + owner approval' marker. Status is always 'draft' with
 * fact_checked = 0 — never published, never fact-checked.
 */
export async function convertScaffoldToDraft(env, scaffold) {
  if (!scaffold || typeof scaffold !== 'object') return { ok: false, status: 400, error: 'No scaffold found in this run.' };
  const title = typeof scaffold.title === 'string' ? scaffold.title.trim() : '';
  const division = typeof scaffold.division === 'string' ? scaffold.division.trim() : '';
  if (title.length < 5) return { ok: false, status: 400, error: 'Scaffold title is required (at least 5 characters).' };
  if (!division || !isValidSlug(division)) return { ok: false, status: 400, error: 'Scaffold division must be a valid slug.' };
  const row = await d1First(env, 'SELECT id, slug FROM business_divisions WHERE slug = ? LIMIT 1', [division]);
  if (!row) return { ok: false, status: 400, error: `Unknown division slug: ${division}.` };
  const slug = slugify(title);
  if (!slug) return { ok: false, status: 400, error: 'Could not derive a slug from the title.' };
  const clash = await d1First(env, 'SELECT id FROM articles WHERE slug = ? LIMIT 1', [slug]);
  if (clash) return { ok: false, status: 409, error: 'An article with this slug already exists.' };

  const outline = Array.isArray(scaffold.outline) ? scaffold.outline : [];
  const sources = Array.isArray(scaffold.sources) ? scaffold.sources : [];
  // An LLM draft stores its real body (marked AI-DRAFT); a plain
  // scaffold stores a placeholder outline instead. Either way the
  // article is a 'draft' with fact_checked = 0 — never published.
  const llmBody = scaffold.llmGenerated && typeof scaffold.body === 'string' && scaffold.body.trim()
    ? sanitiseText(scaffold.body, 20000) : '';
  const bodyLines = llmBody ? [
    'AI-DRAFT — needs fact-check + owner approval.',
    '',
    `This draft was written by ${scaffold.provider || 'an LLM'}${scaffold.model ? ` (${scaffold.model})` : ''}. ` +
    'It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.',
    '',
    llmBody,
    '',
    'Sources:',
    ...(sources.length ? sources.map((s) => `- ${s}`) : ['- None supplied — add sources before approval.']),
  ] : [
    'SCAFFOLD — full draft needed.',
    '',
    'This draft was created from an agent scaffold. No article body was fabricated: ' +
    'the owner (or an LLM) must write the full body, add sources and pass fact-checking before approval.',
    '',
    ...outline.map((h) => `## ${h}\n\n[Write this section — no content yet.]`),
    '',
    'Sources:',
    ...(sources.length ? sources.map((s) => `- ${s}`) : ['- None supplied — add sources before approval.']),
  ];
  const now = nowIso();
  const result = await d1Run(env,
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.id,
      sanitiseText(title, 200),
      slug,
      sanitiseText(typeof scaffold.seoDescription === 'string' ? scaffold.seoDescription : '', 500),
      bodyLines.join('\n'),
      'FS AI',
      'draft',
      0,
      sanitiseText(typeof scaffold.seoTitle === 'string' ? scaffold.seoTitle : '', 200),
      sanitiseText(typeof scaffold.seoDescription === 'string' ? scaffold.seoDescription : '', 300),
      null, null, null, null, now, now,
    ]);
  const id = result && result.meta ? result.meta.last_row_id : null;
  if (!id) return { ok: false, status: 500, error: 'Article was not stored.' };
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division, d.name AS division_name FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1', [id]);
  return { ok: true, article };
}
