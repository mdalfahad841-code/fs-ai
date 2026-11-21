/**
 * FS AI — Social: public module surface.
 *
 * The coordinator wires backend/routes/social.js into backend/worker.js
 * (registration snippet in the W4 report — routes are NOT registered
 * here). The scheduler's social-pack step keeps calling
 * backend/agents/autonomy/social.js, which now also writes DRAFT
 * social_posts rows (never publishes) when migration 022 is applied.
 */
export * from './errors.js';
export * from './platforms.js';
export * from './content.js';
export { encryptToken, decryptToken, isEncryptedToken } from './tokens.js';
export * from './store.js';
export { getAdapter, loadAccountWithToken } from './adapters/index.js';
export { dispatchPost, dispatchDuePosts, preflight, MAX_ATTEMPTS, BACKOFF_MS } from './dispatcher.js';
export * from './card.js';
export * from './media.js';
export * from './oauth.js';
export * from './refresh.js';
