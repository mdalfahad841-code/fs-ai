/**
 * FS AI — Autonomy: publishing agent handler.
 *
 * Nothing here publishes on its own. It only calls the existing
 * publishDueArticles() (owner-approved articles whose publish_at has
 * passed) and returns its result. The Emergency Stop skip inside
 * publishDueArticles is honoured and reported as a no-op.
 */
import { publishDueArticles } from '../../routes/admin-articles.js';

export async function runPublishing(task, env) {
  const result = await publishDueArticles(env);
  if (!result.ok) return { outcome: 'failed', error: result.error || 'Scheduled publish failed.' };
  if (result.skipped) {
    return { outcome: 'no-op', reason: result.reason || 'Emergency Stop is on.', published: 0 };
  }
  return { outcome: 'done', published: result.published || 0, slugs: result.slugs || [] };
}
