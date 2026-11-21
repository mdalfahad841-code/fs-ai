/**
 * FS AI — Social: card renderer (SVG).
 *
 * The known W4 gap, closed here: Pinterest and Instagram cannot post
 * text — they need a rendered image. This module renders the FS AI
 * pin design (text-only, dark-navy background, article title only —
 * the design the owner already approved for Pinterest) as a
 * deterministic SVG, one size per platform. A local rasterizer
 * (scripts/render-social-card.py, Pillow — free, already installed in
 * this environment) converts the same layout to the PNG/JPEG files the
 * adapters consume; see that script for the byte-identical layout
 * mirror. The Worker itself never rasterizes — Workers have no font
 * rasterizer — so the SVG is the deployable source of truth and the
 * PNG is produced at publish-prep time and hosted under
 * https://fs-ai-5w5.pages.dev/social-cards/ (see cardPublicUrl).
 *
 * Honesty rules, enforced by construction and pinned by tests:
 *  - Only the article's REAL title (verbatim, truncated only to the
 *    platform title limit with an ellipsis), the REAL division name,
 *    and the FS AI brand + site URL ever appear. No adjectives, no
 *    superlatives, no invented claims, no numbers, no stock imagery.
 *  - Deterministic: same inputs -> byte-identical SVG (no dates,
 *    no randomness). Fingerprint is a djb2 hash of the SVG.
 *  - Readable: white title on dark navy (contrast ~15:1); the
 *    division label uses the division accent colour only when it
 *    passes WCAG 4.5:1 on navy, otherwise white.
 *  - Division accent colours are the live site's own plate colours
 *    (frontend/scripts/app.js DIVISIONS list).
 */
export const CARD_NAVY = '#0A1527';
export const CARD_WHITE = '#FFFFFF';
export const CARD_MUTED = '#9FB3D1';
export const CARD_SITE = 'fs-ai-5w5.pages.dev';
export const CARD_BRAND = 'FS AI';

export const DIVISION_ACCENTS = {
  automotive: '#2878FF',
  'ai-technology': '#19C37D',
  'gadgets-electronics': '#F5A623',
  'finance-money': '#12A594',
  'travel-lifestyle': '#E85D3D',
  'digital-tools': '#9D6BC4',
  'health-wellness': '#D64570',
  'education-learning': '#A9805B',
};
export const DEFAULT_ACCENT = '#2878FF';

export const CARD_SPECS = {
  pinterest: { width: 1000, height: 1500, titleFont: 84, maxTitleLines: 6, format: 'png', note: 'Pinterest 2:3 (1000x1500 recommended)' },
  instagram: { width: 1080, height: 1350, titleFont: 78, maxTitleLines: 5, format: 'jpg', note: 'Instagram 4:5 (1080x1350); JPEG only, public HTTPS URL' },
  facebook: { width: 1200, height: 630, titleFont: 64, maxTitleLines: 3, format: 'png', note: 'Facebook link image 1200x630' },
  linkedin: { width: 1200, height: 627, titleFont: 64, maxTitleLines: 3, format: 'png', note: 'LinkedIn article image 1200x627' },
};

export function cardSpecFor(platform) {
  return CARD_SPECS[platform] || null;
}

export function accentForDivision(divisionSlug) {
  return DIVISION_ACCENTS[String(divisionSlug || '').toLowerCase()] || DEFAULT_ACCENT;
}

export function cardFileName(articleId, platform) {
  const spec = cardSpecFor(platform);
  if (!spec) throw new Error(`No card spec for platform: ${platform}`);
  return `article-${Number(articleId)}-${platform}.${spec.format}`;
}

/** Public URL where the rendered card must be hosted before a media-required post can publish. */
export function cardPublicUrl(articleId, platform) {
  return `https://fs-ai-5w5.pages.dev/social-cards/${cardFileName(articleId, platform)}`;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(hexA, hexB) {
  const la = luminance(hexA);
  const lb = luminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Estimated width of bold sans text: ~0.52em per character on average. */
function estimateWidth(text, fontSize) {
  return String(text).length * fontSize * 0.52;
}

function wrapText(text, fontSize, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (estimateWidth(candidate, fontSize) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  let truncated = false;
  if (lines.length > maxLines) {
    truncated = true;
    const kept = lines.slice(0, maxLines);
    let last = kept[kept.length - 1];
    while (last.length > 1 && estimateWidth(`${last}…`, fontSize) > maxWidth) last = last.slice(0, -1);
    kept[kept.length - 1] = `${last}…`;
    return { lines: kept, truncated };
  }
  return { lines, truncated };
}

/** djb2 fingerprint — determinism check, not a security hash. */
export function cardFingerprint(svg) {
  let hash = 5381;
  for (let i = 0; i < svg.length; i++) hash = ((hash << 5) + hash + svg.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/**
 * Render the branded card SVG for one article on one platform.
 * Input: { title, divisionSlug, divisionName, platform }.
 * The title is used verbatim (truncated only to 100 chars, the
 * platform title limit, with an ellipsis) — nothing is added to it.
 */
export function renderSocialCard({ title, divisionSlug = '', divisionName = '', platform }) {
  const spec = cardSpecFor(platform);
  if (!spec) throw new Error(`No card spec for platform: ${platform}`);
  if (!title || !String(title).trim()) throw new Error('Card title is required (the article title).');
  const cleanTitle = String(title).replace(/\s+/g, ' ').trim();
  const MAX_TITLE_CHARS = 100; // platform title limit — never render more than a post title may carry
  const displayTitle = cleanTitle.length > MAX_TITLE_CHARS
    ? `${cleanTitle.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : cleanTitle;
  const titleTruncated = displayTitle !== cleanTitle;

  const { width, height } = spec;
  const scale = width / 1000;
  const margin = Math.round(width * 0.07);
  const contentWidth = width - margin * 2;
  const accent = accentForDivision(divisionSlug);
  const label = (divisionName || divisionSlug || 'FS AI').toUpperCase();
  const labelColor = contrastRatio(accent, CARD_NAVY) >= 4.5 ? accent : CARD_WHITE;
  const labelFont = Math.round(spec.titleFont * 0.34);
  const barHeight = Math.round(16 * scale);
  const gap = Math.round(48 * scale);

  // Title: shrink once if it does not fit, then ellipsis-truncate.
  let fontSize = spec.titleFont;
  let wrapped = wrapText(displayTitle, fontSize, contentWidth, spec.maxTitleLines);
  if (wrapped.truncated && fontSize > spec.titleFont * 0.8) {
    fontSize = Math.round(spec.titleFont * 0.88);
    wrapped = wrapText(displayTitle, fontSize, contentWidth, spec.maxTitleLines);
  }
  const lineHeight = Math.round(fontSize * 1.22);
  const titleY = Math.round(height * 0.30);
  const footerY = height - Math.round(64 * scale);

  const titleLines = wrapped.lines
    .map((line, i) => `<text x="${margin}" y="${titleY + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${CARD_WHITE}">${escapeXml(line)}</text>`)
    .join('\n  ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(displayTitle)}">\n`
    + `  <rect width="${width}" height="${height}" fill="${CARD_NAVY}"/>\n`
    + `  <rect x="0" y="0" width="${width}" height="${barHeight}" fill="${accent}"/>\n`
    + `  <text x="${margin}" y="${Math.round(height * 0.20)}" font-family="Arial, Helvetica, sans-serif" font-size="${labelFont}" font-weight="700" letter-spacing="3" fill="${labelColor}">${escapeXml(label)}</text>\n`
    + `  <rect x="${margin}" y="${Math.round(height * 0.20) + Math.round(gap * 0.55)}" width="${Math.round(72 * scale)}" height="${Math.round(6 * scale)}" fill="${accent}"/>\n`
    + `${titleLines}\n`
    + `  <text x="${margin}" y="${footerY}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(30 * scale)}" font-weight="700" fill="${CARD_WHITE}">${CARD_BRAND}</text>\n`
    + `  <text x="${margin}" y="${footerY + Math.round(40 * scale)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(26 * scale)}" fill="${CARD_MUTED}">${CARD_SITE}</text>\n`
    + `</svg>`;

  return {
    platform, width, height, svg, title: displayTitle, division: divisionName || divisionSlug,
    accent, labelColor, titleTruncated: titleTruncated || wrapped.truncated,
    titleContrast: Number(contrastRatio(CARD_WHITE, CARD_NAVY).toFixed(2)),
    labelContrast: Number(contrastRatio(labelColor, CARD_NAVY).toFixed(2)),
    fingerprint: cardFingerprint(svg),
    fileName: null, // set by the caller once the article id is known (cardFileName)
  };
}
