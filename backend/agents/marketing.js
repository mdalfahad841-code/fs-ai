/**
 * FS AI — Marketing agent module.
 * DRAFT PREPARATION ONLY. Nothing is posted anywhere by this module.
 * Facebook: no account created yet. YouTube: handle @FSAI-e5f exists, but
 * no posting happens without a connected account AND owner approval.
 * Pinterest: profile watchwithf exists, same rule. Newsletter: draft only.
 */
import { ACCOUNTS } from '../routes/accounts.js';

export function accountStatus(platformId) {
  const account = ACCOUNTS.find((a) => a.id === platformId);
  return account ? account.status : 'unknown';
}

export function prepareFacebookDraft(article) {
  if (accountStatus('facebook') !== 'created' && accountStatus('facebook') !== 'connected') {
    return { ok: false, error: 'Facebook account is pending — no Facebook account exists yet. Draft cannot be posted; a text draft is prepared below for the owner only.', draft: facebookText(article), posted: false };
  }
  return { ok: true, draft: facebookText(article), posted: false, note: 'Draft only — posting needs owner approval.' };
}

export function facebookText(article) {
  return `${article.title}\n\n${article.excerpt || ''}\n\nRead more on FS AI — One Platform. Multiple Possibilities.\n#FSAI`;
}

export function prepareYouTubeDraft(article) {
  return {
    ok: true,
    channel: '@FSAI-e5f',
    draft: {
      title: `${article.title} | FS AI`,
      description: `${article.excerpt || ''}\n\nFS AI — One Platform. Multiple Possibilities.`,
      outline: ['Hook (first 10 seconds)', 'Main points', 'Summary and call to watch more'],
    },
    posted: false,
    note: 'Draft/outline only — no video is uploaded without a connected account and owner approval.',
  };
}

export function preparePinterestDraft(article) {
  return {
    ok: true,
    profile: 'watchwithf',
    draft: {
      title: article.title,
      description: (article.excerpt || '').slice(0, 200),
      board: article.divisionName || article.division || 'FS AI',
      link: `https://fs-ai-5w5.pages.dev/articles/${article.slug}`,
    },
    posted: false,
    note: 'Draft only — no pin is published without owner approval.',
  };
}

export function prepareNewsletterDraft(articles) {
  const list = (articles || []).slice(0, 5);
  return {
    ok: true,
    subject: `FS AI — ${list.length} new reads this week`,
    body: [
      'Assalamu Alaikum,',
      '',
      'New on FS AI this week:',
      ...list.map((a) => `- ${a.title}`),
      '',
      'FS AI — One Platform. Multiple Possibilities.',
    ].join('\n'),
    sent: false,
    note: 'Draft only — no newsletter is sent without a connected email service and owner approval. Business Email is still pending.',
  };
}

export function marketingDraftsFor(article) {
  return {
    facebook: prepareFacebookDraft(article),
    youtube: prepareYouTubeDraft(article),
    pinterest: preparePinterestDraft(article),
  };
}
