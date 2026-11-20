/**
 * FS AI — database-backed article protection.
 *
 * Owner order (2026-11-19/20): articles #26 and #27 are verification
 * test artifacts whose content must never be overwritten by an automatic
 * run (the nightly seoRun repaired them live on 20 Nov 2026; the parent
 * restored them exactly from article_revisions).
 *
 * Two layers, defence-in-depth:
 *   1. `articles.is_protected` (migration 013) is the source of truth —
 *      any article can be protected by setting the flag, and the flag
 *      travels with the row in backups/restores.
 *   2. `PROTECTED_TEST_ARTICLES` is the constant fallback, so #26/#27
 *      stay protected on a DB where migration 013 has not been applied
 *      yet (or where the column is missing for any other reason).
 *
 * `isProtected` never throws: a missing column, a missing row, or a
 * missing DB binding all fall through to the constant.
 *
 * Scope: this module only ANSWERS whether an article is protected. It
 * does not block anything by itself — the automatic draft selections in
 * backend/routes/scheduler.js exclude protected articles via
 * `protectedExclusion`, and manual per-article entry points must call
 * `assertNotProtected` before modifying an article (see the Fix 1
 * report for the full wiring list).
 */
import { d1First } from '../middleware/validation.js';

// Protected test articles — the fallback list. Keep in sync with
// migration 013's UPDATE (id IN (26, 27)).
export const PROTECTED_TEST_ARTICLES = [26, 27];

// SQL fragment + bound params that exclude the protected test articles
// from an automatic draft selection. Exclusion happens in the query, not
// after fetching, so LIMIT still counts only eligible drafts.
export function protectedExclusion(column) {
  const placeholders = PROTECTED_TEST_ARTICLES.map(() => '?').join(', ');
  return { clause: `${column} NOT IN (${placeholders})`, params: [...PROTECTED_TEST_ARTICLES] };
}

/**
 * True when the article is protected: its `is_protected` flag is 1 in
 * D1, or its id is in PROTECTED_TEST_ARTICLES. Never throws — when the
 * column does not exist yet (migration 013 not applied), when the row
 * is missing, or when no DB is bound, the constant decides.
 */
export async function isProtected(env, articleId) {
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    const row = await d1First(env, 'SELECT is_protected FROM articles WHERE id = ? LIMIT 1', [id]);
    if (row && Number(row.is_protected) === 1) return true;
  } catch {
    // Column missing (migration 013 not applied) or DB unavailable —
    // fall through to the constant below.
  }
  return PROTECTED_TEST_ARTICLES.includes(id);
}

/**
 * Manual-entry-point guard: { ok: true } when the article may be
 * modified, or { ok: false, reason } when it is protected. Callers
 * (orchestrator task creation/run, admin article edit/publish/delete)
 * must refuse the modification when ok is false.
 */
export async function assertNotProtected(env, articleId) {
  const id = Number(articleId);
  if (await isProtected(env, id)) {
    return { ok: false, reason: `Article #${id} is protected — automatic modification disabled.` };
  }
  return { ok: true };
}

// Task agents/kinds that MODIFY an existing article's content, verified
// from the dispatch code (not assumed):
//   - agent 'seo' (any kind) -> runSeo, which repairs body/SEO fields.
//   - agent 'fact-checking', kind 'correct' -> runCorrection, which
//     rewrites the body. Kind 'fact-check' is advisory only (read-only).
//   - agent 'publishing' takes no per-article target (runPublishing
//     publishes gate-passed due articles only), so it needs no guard
//     here; #26/#27 are drafts that cannot pass the gate anyway.
//   - agent 'content-creation' INSERTs new articles only.
// The manual task entry points (create / run / retry) refuse these for
// protected articles; the scheduled workflows exclude protected
// articles in their SQL selections instead.
export function taskModifiesArticle(agent, kind) {
  if (agent === 'seo') return true;
  if (agent === 'fact-checking' && kind === 'correct') return true;
  return false;
}

// For a task object (payload object or JSON string): returns { ok: true }
// when the task does not modify a protected article, otherwise
// { ok: false, reason, protected: true }.
export async function assertTaskNotProtected(env, task) {
  if (!task || !taskModifiesArticle(task.agent, task.kind)) return { ok: true };
  let payload = task.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { ok: true }; }
  }
  if (!payload || typeof payload !== 'object') return { ok: true };
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: true };
  const check = await assertNotProtected(env, articleId);
  return check.ok ? { ok: true } : { ...check, protected: true };
}
