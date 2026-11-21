/**
 * FS AI — Social: platform registry.
 *
 * One entry per platform, grounded in the official-docs research of
 * 2026-11-21 (docs/SOCIAL-PLATFORMS-2026-11-21.md — read it before
 * changing any number here). The classification is about the OFFICIAL
 * API itself, not about whether the owner has connected an account yet:
 * every platform still needs the owner's one-time OAuth.
 *
 *   SUPPORTED_FREE    — official API posts for free (own-account path).
 *   LIMITED_FREE      — official API posts for free, but with a hard
 *                       caveat (private-locked uploads, vetting, …).
 *   UNAVAILABLE_FREE  — no free official posting path (paid only).
 *
 * Daily caps below are the framework's own guardrails (the lowest
 * published figure where sources disagree — never the highest), so a
 * platform limit is hit by the framework first, not by the platform.
 * Per-call API costs that matter for the $0 rule are noted per platform.
 */
export const PLATFORMS = {
  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest',
    classification: 'SUPPORTED_FREE',
    apiBase: 'https://api.pinterest.com/v5',
    apiVersion: 'v5',
    // Free: no fee for API access. Trial access on app approval (pins
    // visible to the owner only); Standard access after a demo-video
    // review. FS AI already has a business account with claimed website.
    scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'],
    tokenLifetime: 'access 30 days; refresh 60 days — refresh inside 60 days or re-OAuth',
    contentTypes: ['image_pin', 'carousel_pin', 'video_pin'],
    limits: {
      titleChars: 100,
      descriptionChars: 800,
      linkChars: 2048,
      altTextChars: 500,
      imageMaxBytes: 20 * 1024 * 1024, // PNG/JPEG up to 20 MB, 2:3 recommended (1000x1500)
      carouselImagesMin: 2,
      carouselImagesMax: 5,
      // org_write: 300 calls/day on Trial, 100/min on Standard.
      postsPerDay: 10, // framework guardrail — far under Trial's 300/day
    },
    mediaRequired: true, // a Pin needs an image/video; text alone cannot post
    verifyEndpoint: (id) => `/pins/${id}`,
    notes: 'POST /v5/pins. No publish-time field — scheduling is ours. Trial pins are owner-visible only until Standard access.',
  },
  facebook: {
    platform: 'facebook',
    label: 'Facebook Page',
    classification: 'SUPPORTED_FREE',
    apiBase: 'https://graph.facebook.com/v26.0',
    apiVersion: 'Graph API v26.0',
    // Free. Own Page + app in Development mode works with NO App Review
    // (admin/developer role on the app); Advanced Access for other
    // people's Pages needs App Review + Business Verification (free).
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
    tokenLifetime: 'short-lived user token 1–2h → 60-day long-lived user token → Page token (effectively non-expiring while the Page/admin link holds; re-issue on invalidation)',
    contentTypes: ['text_post', 'link_post', 'photo_post', 'video_post'],
    limits: {
      messageChars: 63206, // platform max; framework keeps captions far shorter
      captionChars: 2000,
      imageMaxBytes: 10 * 1024 * 1024,
      videoMaxBytes: 10 * 1024 * 1024 * 1024,
      postsPerDay: 25, // framework guardrail (Graph API has no published daily post cap for Pages)
    },
    mediaRequired: false, // text/link posts need no media
    verifyEndpoint: (id) => `/${id}?fields=id,permalink_url,created_time`,
    notes: 'Pages only — apps cannot publish to personal timelines (since 2018). POST /{page-id}/feed, /photos, /videos.',
  },
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    classification: 'SUPPORTED_FREE',
    apiBase: 'https://graph.instagram.com/v26.0',
    apiVersion: 'Graph API v26.0 (Instagram Login path)',
    // Free. Business/Creator account required. Instagram Login path
    // (graph.instagram.com) needs NO Facebook Page; Facebook Login path
    // (graph.facebook.com) needs the IG account linked to a Page.
    // App Review needed for Advanced Access; own account in dev mode works.
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    tokenLifetime: 'long-lived user token 60 days — refresh before expiry or re-OAuth',
    contentTypes: ['image_post', 'carousel_post', 'reel', 'story'],
    limits: {
      captionChars: 2200,
      hashtagsMax: 30,
      imageMaxBytes: 8 * 1024 * 1024, // JPEG only, 4:5–1.91:1
      reelMaxBytes: 300 * 1024 * 1024, // 3s–15min
      carouselItemsMax: 10,
      // Sources disagree (25 vs 50 vs 100 / 24h). Framework uses the
      // lowest published figure (Meta's Content Publishing limit, 25).
      postsPerDay: 25,
    },
    mediaRequired: true, // media must be a PUBLIC HTTPS URL — no upload in the request body
    containerExpiryHours: 24, // media containers expire 24h after creation — create at publish time only
    verifyEndpoint: (id) => `/${id}?fields=id,permalink,timestamp`,
    notes: 'Two-step flow: POST /{ig-user-id}/media → poll status_code until FINISHED → POST /{ig-user-id}/media_publish. No text-only posts.',
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    classification: 'SUPPORTED_FREE',
    apiBase: 'https://api.linkedin.com',
    apiVersion: 'Posts API /rest/posts (LinkedIn-Version YYYYMM)',
    // Free per call (no price list). Own-profile posting is self-serve:
    // add the "Share on LinkedIn" product, scope w_member_social, no
    // review. Company Pages need the vetted Community Management API
    // (Development tier 500 calls/app/day, 100/member/day; 12 months to
    // apply for Standard) — NOT implemented here; member posts only.
    scopes: ['w_member_social', 'openid', 'profile'],
    tokenLifetime: 'access token 60 days; refresh tokens only for approved Marketing Developer Platform partners — self-serve apps re-OAuth every 60 days',
    contentTypes: ['text_post', 'article_post', 'image_post'],
    limits: {
      textChars: 3000,
      postsPerDay: 25, // framework guardrail — platform allows 150/member/day
      memberRequestsPerDay: 150,
      appRequestsPerDay: 100000,
    },
    mediaRequired: false, // text + article link posts need no media; images use a 2-step asset upload
    verifyEndpoint: null, // r_member_social (read own posts) is closed to new requests — no verify-back read available
    notes: 'POST /rest/posts with LinkedIn-Version + X-Restli-Protocol-Version: 2.0.0 headers. /v2/ugcPosts is legacy — do not use. Page posting (w_organization_social) is vetted-only and out of scope.',
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    classification: 'LIMITED_FREE',
    apiBase: 'https://www.googleapis.com/youtube/v3',
    apiVersion: 'YouTube Data API v3',
    // Free, quota-capped: 10,000 units/day/project, videos.insert costs
    // 1,600 (≈6 uploads/day max). HARD CAVEAT: uploads from an app that
    // has not passed Google's API audit land PRIVATE regardless of the
    // requested privacy, and a Testing-status OAuth app issues refresh
    // tokens that expire after 7 days. FS AI's current Shorts flow is
    // manual browser upload — this adapter NEVER replaces it; it exists
    // for a future audited project only. Community posts have NO API
    // endpoint (and need 500 subscribers anyway).
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'],
    tokenLifetime: 'OAuth refresh token; 7-day expiry while the OAuth consent screen is in Testing — publish the app to Production for long-lived tokens',
    contentTypes: ['video_upload'],
    limits: {
      titleChars: 100,
      descriptionChars: 5000,
      quotaUnitsPerDay: 10000,
      uploadQuotaUnits: 1600,
      uploadsPerDay: 6, // 10,000 / 1,600
      postsPerDay: 2, // framework guardrail — one Short a day is the FS AI cadence
    },
    mediaRequired: true, // a rendered video file (bytes) — the API takes no URL
    verifyEndpoint: (id) => `/videos?part=status,snippet&id=${id}`,
    notes: 'videos.insert (multipart/resumable upload). Un-audited = private-only. No community-post endpoint exists. Do not use while the manual browser-upload flow is the owner flow.',
  },
  x: {
    platform: 'x',
    label: 'X (Twitter)',
    classification: 'UNAVAILABLE_FREE',
    apiBase: 'https://api.x.com/2',
    apiVersion: 'X API v2',
    // NO free tier for new developers since Feb 2026: pay-per-use,
    // $0.015 per post, $0.20 per post with a URL, $0.005 per post read.
    // The $20 starter credits require saving a card + a first purchase
    // — a card requirement violates the FS AI $0 rule. Older pages still
    // list the legacy Free tier (500–1,500 posts/month); multiple
    // Sep–Nov 2026 sources agree it ended for new sign-ups.
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    tokenLifetime: 'OAuth 2.0 user token; refresh via offline.access',
    contentTypes: [],
    limits: { textChars: 280, postsPerDay: 0 },
    mediaRequired: false,
    verifyEndpoint: null,
    notes: 'UNAVAILABLE FREE OF COST. Do not implement a posting adapter; the dispatcher refuses X with BLOCKED_WITH_REASON. Re-check docs.x.com pricing before any revisit.',
  },
};

export const SUPPORTED_PLATFORMS = Object.values(PLATFORMS)
  .filter((p) => p.classification === 'SUPPORTED_FREE' || p.classification === 'LIMITED_FREE')
  .map((p) => p.platform);

export const ALL_PLATFORMS = Object.keys(PLATFORMS);

export function platformDef(platform) {
  return PLATFORMS[platform] || null;
}

export function isPostablePlatform(platform) {
  const def = platformDef(platform);
  return !!def && (def.classification === 'SUPPORTED_FREE' || def.classification === 'LIMITED_FREE');
}
