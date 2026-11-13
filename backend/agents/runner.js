/**
 * FS AI — Per-agent run implementations.
 *
 * runAgent(agentId, env) performs ONE real D1 read relevant to the agent
 * and reports the honest outcome. Agents that would need a service that
 * is not connected (a free AI writer, a social poster, a traffic source)
 * report { outcome: 'no-op' } with the reason — they never log a fake
 * completed article, fake traffic, or fake publish. Every run is logged
 * by the caller (routes/agents.js) to agent_activity_logs + automation_jobs.
 */
import { d1All, d1First } from '../middleware/validation.js';

// Research agents and the division slug each one covers (seed data:
// ai_agents.division_id maps to business_divisions the same way).
export const RESEARCH_DIVISIONS = {
  'automotive-research': 'automotive',
  'technology-research': 'ai-technology',
  'gadget-research': 'gadgets-electronics',
  'finance-research': 'finance-money',
  'travel-research': 'travel-lifestyle',
  'health-research': 'health-wellness',
  'education-research': 'education-learning',
};

const NO_OP_REASON =
  'No free AI/content service is connected; run logged, no article created, no traffic generated';

function noOp(agent, extra = {}) {
  return { outcome: 'no-op', agent, reason: NO_OP_REASON, ...extra };
}

async function countRows(env, sql, params = []) {
  const rows = await d1All(env, sql, params);
  if (!rows || !rows.length) return 0;
  const row = rows[0];
  return Number(row.count ?? row.total ?? 0);
}

async function revenueTotal(env) {
  const rows = await d1All(env, 'SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_records');
  if (!rows || !rows.length) return 0;
  return Number(rows[0].total ?? 0);
}

export async function runAgent(agentId, env) {
  if (!env || !env.DB) throw new Error('Agent runs require the D1 database.');

  switch (agentId) {
    case 'seo': {
      const publishedArticles = await countRows(env,
        "SELECT COUNT(*) AS count FROM articles WHERE status = ?", ['published']);
      return {
        outcome: 'completed', agent: 'seo', publishedArticles,
        note: 'Counted published articles in D1. No content changed; SEO changes still need owner approval.',
      };
    }
    case 'analytics': {
      const total = await revenueTotal(env);
      return {
        outcome: 'completed', agent: 'analytics',
        revenueTotal: total, revenueFormatted: `$${total.toFixed(2)}`,
        pageViews: 'Data unavailable',
        note: 'GA4 pageview data is not queryable from the Worker. No analytics account is connected.',
      };
    }
    case 'monetization': {
      const total = await revenueTotal(env);
      const accounts = await countRows(env,
        "SELECT COUNT(*) AS count FROM monetization_accounts WHERE status = ?", ['active']);
      return {
        outcome: 'completed', agent: 'monetization',
        revenueTotal: total, revenueFormatted: `$${total.toFixed(2)}`,
        activeMonetizationAccounts: accounts,
        note: 'Revenue read from the D1 revenue_records ledger. No payout method exists.',
      };
    }
    case 'security': {
      // Presence booleans only — never values, never hashes.
      return {
        outcome: 'completed', agent: 'security',
        dbBound: !!env.DB,
        ownerPasswordHashSet: !!env.OWNER_PASSWORD_HASH,
        sessionSecretSet: !!env.SESSION_SECRET,
        note: 'Config presence check only. No secret values were read or logged.',
      };
    }
    case 'content-creation': {
      const drafts = await countRows(env,
        "SELECT COUNT(*) AS count FROM articles WHERE status = ?", ['draft']);
      return noOp(agentId, { draftArticles: drafts });
    }
    case 'fact-checking': {
      const awaitingCheck = await countRows(env,
        "SELECT COUNT(*) AS count FROM articles WHERE status = ?", ['pending_approval']);
      return noOp(agentId, { articlesAwaitingFactCheck: awaitingCheck });
    }
    case 'publishing': {
      const approved = await countRows(env,
        "SELECT COUNT(*) AS count FROM articles WHERE status = ?", ['approved']);
      return noOp(agentId, { approvedArticlesAwaitingPublish: approved });
    }
    case 'digital-tools': {
      const tools = await countRows(env, 'SELECT COUNT(*) AS count FROM digital_tools');
      return noOp(agentId, { digitalTools: tools });
    }
    case 'business-manager': {
      const openJobs = await countRows(env,
        "SELECT COUNT(*) AS count FROM automation_jobs WHERE status IN ('queued', 'running')");
      return {
        outcome: 'completed', agent: 'business-manager', openJobs,
        note: 'Counted open automation jobs in D1. No job was started or completed by this run.',
      };
    }
    default: {
      if (RESEARCH_DIVISIONS[agentId]) {
        const divisionSlug = RESEARCH_DIVISIONS[agentId];
        const division = await d1First(env,
          'SELECT id FROM business_divisions WHERE slug = ? LIMIT 1', [divisionSlug]);
        const articlesInDivision = division
          ? await countRows(env, 'SELECT COUNT(*) AS count FROM articles WHERE division_id = ?', [division.id])
          : 0;
        return noOp(agentId, { division: divisionSlug, articlesInDivision });
      }
      // Any other registry agent: one real read, honest no-op.
      const publishedArticles = await countRows(env,
        "SELECT COUNT(*) AS count FROM articles WHERE status = ?", ['published']);
      return noOp(agentId, { publishedArticles });
    }
  }
}
