# Unslop — FS AI site — 2026-11-20

Run by the FS AI coordinator (local only, no deploy). Method: the unslop skill
by Damir Sokolovsky (@heydamir), CC BY 4.0 — audit against `references/signs.md`,
five-line direction from the product itself, nine passes in order, check, report.
Baseline before this run: 779 tests pass / 0 fail / 178 suites. Screenshots:
before in `/tmp/unslop-fsai/before/` (local render of the pre-change site).

## 1. Audit (one line per sign, with location)

Heavy slop — signs across colour, type, icons, copy, motion and components.
The November 14 Strategy Fox rollout ("all 10 styles") is itself the slop:
its glass, neu, clay, brutalist, chrome, liquid-glass and skeuo layers are
exactly what `signs.md` flags. Kept as genuine craft: the bento grid
variation, the minimal article-reading rules, flat table headers, the honest
copy (no hype, no fake claims, "Data unavailable", "$0.00"), the division
chart itself (real data), and the footer structure.

### Surfaces and colour
- Hero radial blue wash + navy-to-graphite gradient + amber liquid blob —
  `styles/main.css` `.hero`; `styles/ui-styles.css` `.hero::before/::after`.
- Gradient text: hero "DO MORE." and hero-ring numbers in a chrome gradient —
  `styles/ui-styles.css` `--chrome`, `.hero h1 span, .hero-ring strong`.
- Chrome gradient logo tile — `styles/ui-styles.css` `.brand-mark`.
- Glowing hero ring, 60px blue glow + inset glow — `styles/main.css` `.hero-ring`.
- Looping glow animation on the ring — `styles/animations.css` `@keyframes heroGlow`.
- Glass gradients + blur on header, newsletter, login card, autonomy section —
  `styles/ui-styles.css` §2, §8.
- Neumorphic inset shadows on tool chips, form fields, tool result —
  `styles/ui-styles.css` §3.
- Clay 26px radius + clay-shadow on tool cards and KPI tiles —
  `styles/ui-styles.css` §4.
- Neo-brutalist tags/pills/note-box: blue tag + 2px black border + hard shadow,
  status pills 2px border + shadow, amber note-box 3px black border + 5px shadow —
  `styles/ui-styles.css` §5.
- Skeuomorphic gradients + 3–4px bottom borders on toggles, Emergency Stop
  buttons, sign-in button — `styles/ui-styles.css` §10.
- Four division hues as chrome (4px top border per division card) —
  `scripts/app.js` `renderDivisions` (`--div-color`).
- No single three-role text system: `#c6d2e4` body, `#8995A7` muted,
  `#e9eff7` platinum, `#33465e` light body — `styles/main.css`, `styles/themes.css`.
- Division chart: all 8 bars the same accent blue, nothing leads —
  `scripts/charts.js` `fillStyle = '#2878FF'`.
- Hero particle canvas: blue dots drifting forever —
  `frontend/index.html` `#heroParticles`, `scripts/animations.js`.

### Type
- Headings at browser-default weight 700; brand-mark 800, KPI value 800,
  buttons 700, tags 700 — `styles/main.css` (no weights set on h1/h2/h3).
- Uppercase tracked labels: `.card-tag` (uppercase, .08em), `th` (uppercase,
  .06em), `.kpi-label` (uppercase, .08em), `.brand-text small` (.18em),
  `.hero-ring span` (.2em).
- Too many sizes and weights on one screen: 10/12/13/14/15/16/18/19/20/24/30/
  34/44/58px and weights 400/600/700/800.
- Numbers in mixed formats and no tabular figures anywhere.

### Icons
- Emoji division icons — `scripts/app.js` `DIVISIONS` (`🚗🤖📱💰✈️🧰❤️🎓`)
  and `pages/division.html` title.
- Emoji theme toggle `☀️ / 🌙` and `☰` nav-toggle glyph —
  `scripts/app.js` `renderHeader`.
- Icons in many sizes: 34px emoji tiles, 30px icon box, 15px toggle text.

### Spacing
- Arbitrary values off the 4px grid: 42px brand-mark, 13px search input,
  11px field padding, 22px card padding, 14px field margin, 28px newsletter
  padding, 18px footer padding.
- Uneven sibling padding: cards 22px, tool result 20px, newsletter 28px,
  note-box 14px.
- Dead empty band: the `#search` section (56px padding, one muted line)
  between hero and divisions.
- Login card spans the full 1180px wrap — a sign-in form 1100px wide with a
  large empty area below the button (dashboard screenshot).

### Copy
- Shouted hero headline in all caps: "EXPLORE MORE. KNOW MORE. DO MORE." —
  `frontend/index.html`.
- Wordy search placeholder with examples — `frontend/index.html`.
- "PROTECTED — AUTOMATIC MODIFICATION DISABLED" in all caps —
  `scripts/dashboard.js:206`, `scripts/autonomy.js:701`. LEFT UNCHANGED:
  pinned by `tests/dashboard-autonomy-dom.test.js:206`; it is a safety label,
  not interface copy.

### Components
- Hero has no real visual — a glowing ring with numbers instead of the
  product — `frontend/index.html` `.hero-ring`.
- KPI cards show a value + label + note with no change reference (notes are
  static facts; left as-is).

### Motion
- Liquid drift blobs looping 18s/22s — `styles/ui-styles.css` §8.
- Card hover lift `translateY(-2px/-3px)` — `styles/main.css` `.card`,
  `styles/ui-styles.css` `.tool-card:hover, .kpi-card:hover`.
- Reveal 18px rise over .6s — `styles/animations.css` `.reveal`.
- Particle canvas runs `requestAnimationFrame` forever — `scripts/animations.js`.

### Template look
- Pure graphite + system font + blue button = the default template.
- Headline would fit any product if you swapped the name.

## 2. Direction (FS AI's own — not the demo's graphite + ember)

- **Product.** A free, plain-language library of guides and tools across eight
  everyday topics — cars, AI, gadgets, money, travel, health and learning —
  run by one owner, where every number is real and nothing is sold.
- **Character.** Plain-spoken, honest, unhurried.
- **World.** A printed field guide on a shelf — paper, ink, index numbers.
- **Moments.** The hero's latest-guide preview, a real article card; the
  division chart, the one real chart, with the accent on the largest bar only.
- **Signature.** A quiet mono index number on every guide — "No. 04" — the
  field-guide numbering, on article cards, the hero preview and division titles.

## 3. Passes

1. **Colour.** Warm paper ramps replace graphite: dark page #161513, card
   #1c1a18, raised #262421, text #efe9de / secondary #aaa398 / muted
   #8a847a; light paper #f7f4ee, card #fdfbf7, text #1f1b16. Hairlines are
   text at 8–9% opacity; no shadows on dark. One accent, the real brand
   blue: data highlight #2878FF, button/active fill #1c5fd6 (white text
   5.7:1), accent text #6aa6ff dark / #1c5fd6 light. Semantic success
   #4cc38a dark / #16a34a light, danger #ff8a8a dark / #dc2626 light,
   E-stop flat fill #c62f34. All ten effect styles removed from
   `ui-styles.css` (glass, neu, clay, brutalist, chrome, liquid-glass,
   skeuo); the hero wash, ring glow, chrome gradient and blobs are gone.
   The division chart now colours only the largest bar #2878FF, the rest
   neutral. The hero keeps one small tone-shift gradient (allowed by the
   skill); the dashboard E-stop keeps its flat red fill.
2. **Type.** Georgia serif for h1/h2 display, system stack for the rest;
   weights 400/500/600 only (700/800 removed). Sentence case everywhere:
   headline, tags, table headers, KPI labels, brand small text, footer
   brand line ("Fahad Somrat AI"). Sizes pulled onto the 4px grid
   (12/14/15/16/20/24/30/36/40/48/56). Figures use tabular numbers;
   the "No. NN" signature and chart labels use ui-monospace.
3. **Icon.** One hand-drawn inline SVG set (24 viewBox, 1.5 stroke,
   currentColor): car, cpu, smartphone, banknote, send, sliders, heart,
   graduation, sun, moon, menu. It replaces all division emoji, the
   ☀️/🌙 toggle and the ☰ glyph. Division cards keep their 8px
   division-colour dot; the coloured top border is gone. The division
   page title and the header toggle/menu use the same set.
4. **Spacing.** Everything on the 4px grid: brand-mark 40px, fields
   12px/16px, cards 24px, newsletter 24px. The dead `#search` band is
   gone — the search now lives inside the hero and its hint line sits
   under the CTAs. The login card is capped at 480px and centred.
5. **Copy.** Headline is now "Explore more. Know more. Do more." in
   sentence case, serif, no span. Search placeholder shortened to
   "Search articles". A quiet stat row was added under the CTAs
   ("8 divisions · 25 articles · 20 free tools"). No other copy was
   changed; the honest numbers, the newsletter honesty note and the
   footer copy are word-for-word as before.
6. **Components.** The hero's ring is replaced by a real visual: the
   latest-guide preview card (newest article by date, with its real
   tag, title, excerpt, "No. NN" and date) under a "Latest guide" label.
   Division and article cards carry the "No. NN" signature. Buttons
   are flat: one blue fill, one outline, no gradients, no bottom
   borders. Status pills are quiet flat pills with an 8px dot. The
   dashboard keeps every control; only its surfaces, radii and pill
   styles changed. The KPI notes are static facts and were left as-is.
7. **Visuals.** No generated or stock image. The hero visual is the
   coded latest-guide preview card (the skill's rule: dashboards and
   app screens need no generated image). No third-party material
   anywhere; zero-cost unchanged.
8. **Motion.** One easing `cubic-bezier(0.22, 1, 0.36, 1)`; reveal is an
   8px rise over 0.4s with 40–60ms stagger; hover is a border-colour
   change only. The particle canvas, liquid drift, hero glow and card
   lifts are all deleted. `prefers-reduced-motion` still disables the
   entrance.
9. **Details.** Brand-mark is a flat blue tile with white "FS". Focus
   rings are a 2px accent outline. The honest-numbers box keeps its
   amber left bar on a quiet surface. Light theme is a full warm-paper
   ramp (checked by screenshot, see §4).

Two defects the check render caught and fixed: the division page title
was set with `innerHTML` only, which broke the division-not-found test's
`textContent` read — the plain name is now set first, then the icon +
name markup; and the footer still carried the all-caps brand line, now
"Fahad Somrat AI".

## 4. Before / after

Before shots: `/tmp/unslop-fsai/before/` (home, division-auto, article-1,
dashboard, tools, home-light — `.top.png` + `.full.png` each). After shots:
`/tmp/unslop-fsai/after/` (same six, plus home-mobile and
dashboard-mobile at 390px). Both sets were rendered locally on
`http://localhost:8811/` (the changed source). Console errors in both
runs are environmental only: the GA tag
`ERR_TUNNEL_CONNECTION_FAILED` and a favicon 404, present before and
after, not site bugs.

- **Home, dark.** Before: blue wash, glowing ring with big numbers,
  all-caps headline, emoji icons, coloured top borders on division
  cards, every chart bar blue. After: serif sentence-case headline,
  latest-guide preview card on the right, line icons with 8px dots,
  flat cards, quiet stat row, only the Automotive bar blue in the
  chart, honest-numbers box quiet with an amber left bar.
- **Home, light.** Before: light wash + ring (same slop, lighter).
  After: warm paper #f7f4ee, moon icon in the toggle, dark blue buttons,
  white preview card with a hairline border — readable throughout.
  (Note: the light shot needs `localStorage fsai-theme=light`; the
  `prefers-color-scheme` media query does not drive the theme.)
- **Division (Automotive).** Before: car emoji in the title, coloured
  top borders, all-caps tags. After: line car icon in the serif title,
  sentence-case blue tags, "No. 01/02/03" on every card.
- **Article 1.** Before: default-weight title, no index number. After:
  serif title, "No. 01 · Published 11 Nov 2026" in the meta line,
  hairline under h2s, same body text word-for-word.
- **Dashboard (login).** Before: a sign-in form stretched across the
  full 1180px wrap with a large empty area. After: a centred 480px
  card, flat fields and flat blue Sign in button, same email
  placeholder, same "Forgot password?" and "Sign out" controls.
- **Tools.** Before: inset-shadow chips, clay cards, brutalist
  shadows. After: flat chips (active = blue border), flat fields,
  flat result panel; the Fuel Cost tool renders and calculates as
  before.
- **Mobile (390px).** Home: serif hero stacks, full-width search
  button, latest-guide card below, no horizontal overflow. Dashboard:
  login card fills the width, no overflow. Verified by screenshot.

## 5. Test results

- Baseline before this run: **779 tests pass / 0 fail / 178 suites**
  (`npm test`, exit 0, log `/tmp/fsai-baseline-test.log`).
- First run after the changes: **778 pass / 1 fail** —
  `tests/division-not-found.test.js:190` (`?division=automotive`): the
  division title was set with `innerHTML` only, so the test's
  `textContent` read still saw the seeded "All divisions". Fixed in
  `pages/division.html` (plain name set first, then icon + name markup);
  the fix is a real robustness improvement, not a test change.
- Final run after all fixes: **779 tests pass / 0 fail / 178 suites**
  (`npm test`, exit 0, log `/tmp/fsai-final-test.log`).
- `tests/ui-styles.test.js` was rewritten with the same 30 `it()` blocks
  and the same exact-value style, now guarding the quiet layer instead
  of the removed effects (bento/minimalism/flat kept; explicit no-slop
  assertions for glass/neu/clay/brutalist/chrome/liquid/skeuo;
  dashboard coverage; motion assertions moved to `animations.css`;
  mapping-doc assertion now also requires the superseded note and the
  new report). This is a spec change by owner order, not a weakening:
  every changed assertion is documented here and in the test header.
- No other test file was changed. The `PROTECTED` all-caps badge string
  is still asserted by `tests/dashboard-autonomy-dom.test.js:206` and
  still passes.

## 6. Deliberately unchanged

- **"PROTECTED — AUTOMATIC MODIFICATION DISABLED"** — all-caps safety
  label in `scripts/dashboard.js:206` and `scripts/autonomy.js:701`,
  pinned by `tests/dashboard-autonomy-dom.test.js:206`. It is a safety
  label, not interface copy.
- **Article content and data** — every article body, title, tag, date
  and division count is byte-identical; only the "No. NN" meta and the
  tag case changed. No D1 data touched, no article rewritten.
- **Dashboard behaviour and login/session logic** — untouched by rule;
  only surfaces, radii, pills and the login-card width changed. Every
  control (sign in/out, forgot password, autonomy sections, E-stop,
  KPI tiles, tables) is still present and wired the same way.
- **Backend, worker, migrations, autonomy agents, publishing flags**
  — untouched. Emergency Stop, auto_* flags and `approved_only` are
  exactly as before.
- **KPI tile notes** — static facts ("25 articles", "8 divisions") with
  no change reference; left as-is.
- **about.html strings** — `tests/pages-contact-about.test.js` pins
  them; the file was not touched.
- **← / → arrows and ✓ / ✗ status marks** — typographic navigation and
  status marks, not emoji; kept. No pictographic emoji remains in the
  frontend (verified by a Unicode-range sweep: only arrows and
  check/cross marks).
- **The hero's small tone-shift gradient** — the one gradient the skill
  allows; everything else gradient-free.
- **Favicon** — still missing (404 in both before and after renders);
  out of scope for this run.
- **`pages/owner-setup.html`** — stays standalone with inline styles,
  as documented.

---

## Round 2 — 2026-11-20 (same day, after the user saw it on his phone)

**What the user said.** He opened the redesigned site on his phone (All
divisions page) and said: *"Eta to beshi simple hoi gece kono design nei"*
— too simple, no design. The round-1 direction was right but its Moments
and Signature were too faint: the division cards showed only an 8px colour
dot, the hero preview was a small plain card, and the type hierarchy was
too flat. This round is a fix, not a new feature: **enrich, do NOT revert.**
Every slop sign from `references/signs.md` is still absent (no glows, no
gradients-as-chrome, no emoji, no particles, no glass/neu/clay/brutalist/
chrome/liquid-glass/skeuo, no shouting copy). Work local only — nothing
deployed, nothing pushed, no D1 data, no login/session logic, no backend.

**A finding from his screenshot.** It shows the DESKTOP bento layout on
his phone (3–4 columns, full nav, no hamburger): his Chrome renders a
~980px viewport, likely "Desktop site" mode. Reproduced with a 980px
viewport screenshot; the plates were therefore verified at 980px as well
as 390px mobile and 1280px desktop.

### Direction addendum

The field-guide world, character and "No. NN" signature are unchanged.
What changes is the weight of the Moments and the Signature: each
division now has a real visual identity — a bold flat-colour plate with
a hand-drawn white line scene of the division's object — and the hero's
latest-guide preview is a genuinely rich moment, a tall cover plate
instead of a small plain card. The "No. NN" index is made MORE present,
not less: a mono chip on a dark chip on every plate, plus a big "No. NN"
on the hero cover.

### Per-pass changes

- **Colour / identity.** The 8 divisions now each have a distinct flat
  colour (they previously shared blue×3, green×2, amber×2): automotive
  #2878FF, ai-technology #19C37D, gadgets-electronics #F5A623,
  finance-money #12A594 teal, travel-lifestyle #E85D3D coral,
  digital-tools #9D6BC4 muted plum, health-wellness #D64570 rose,
  education-learning #A9805B sepia. Colour is visible at a glance as a
  solid plate band, not an 8px dot (the dot is removed from the markup;
  its CSS rules stay in `main.css` — one existing test pins `.div-icon`
  background).
- **Icon / illustration.** Each division card now opens with a flat
  plate — solid division colour + a large hand-drawn white line SVG
  scene of the division's object, coded in `frontend/scripts/app.js`
  (`DIVISION_SCENES`, `divisionArt(id, aspect)`,
  `divisionPlate(d, no, cls, aspect)`, `divisionNo(id)`): car on a road
  with sun, CPU with squares, phone with signal arcs, banknote with
  coins, plane with a dashed route, sliders with knobs, heart with a
  pulse line, graduation cap with books. Original inline SVG, no stock,
  no gradients-as-glow. Art is anchored right (`xMaxYMid slice`) so the
  icon is never cropped on narrow plates; the scene sits at x 96–150 so
  it survives the crop; the banner uses `xMaxYMid meet`.
- **Components.** The single-division page gets the same plate as a
  banner (`#divisionBanner` container in
  `frontend/pages/division.html`, filled via
  `divisionPlate(div, null, 'div-plate--banner', 'xMaxYMid meet')`).
  The hero's latest-guide preview now has a tall cover plate (180px
  desktop / 148px mobile) with the article's division scene large and a
  big "No. NN" (16px), title 26px; body below unchanged in copy. The
  small `.div-icon` tile is removed from division-card markup.
- **Type.** Stronger size/weight contrast, still 400/500/600 only,
  serif display kept: hero h1 clamp(40px, 5.5vw, 64px), section h2 32px
  (26px mobile), card h3 20px, division-card h3 22px, article h1 and
  `#divisionTitle` 40px.
- **Spacing.** Mobile plate heights in
  `frontend/styles/responsive.css`: 104px cards, 148px hero cover,
  120px banner.
- **Copy, motion, visuals.** Unchanged. No copy changed anywhere; no
  motion change; no generated or stock image — every illustration is
  coded inline SVG.

### Test changes

- Baseline before this round: **779 pass / 0 fail / 178 suites**.
- First run after the changes: **782 pass / 1 fail** —
  `tests/division-not-found.test.js:190` (`?division=automotive…`):
  `title.insertAdjacentHTML is not a function` — the test's fake DOM
  has no `insertAdjacentHTML`/`parentNode`. Fixed by using the
  `#divisionBanner` container + `innerHTML` (real-browser-safe and
  fake-DOM-safe), NOT by weakening the test; the test harness gained
  the `divisionBanner` stub + 3 new assertions in the existing
  automotive test (banner has `div-plate--banner`, `No. 01`,
  `background:#2878FF`).
- Final run: **783 pass / 0 fail / 179 suites** (`npm test`, exit 0).
- `tests/ui-styles.test.js` gained a "round 2 — illustration plates"
  describe block with 4 new `it()` blocks (8 distinct colours; plate
  markup + index number; hero cover 180px; plates flat-colour only —
  no gradient/shadow/blur/text-shadow), documented in the test header;
  count 20 → 24 `it()` blocks. No existing check was changed or
  weakened.

### Verification

Before shots in `/tmp/unslop-fsai/round2/before/` (7 shots), after shots
in `/tmp/unslop-fsai/round2/after/` (10 shots + 2 cropped tops),
rendered locally on `http://localhost:8812/` (the changed source;
server confirmed stopped afterwards). The shoot script scrolls the page
first, then force-adds `.visible` to all `.reveal` elements (screenshot
aid only — the real reveal uses IntersectionObserver threshold 0.12,
which does not fire for below-fold cards in a headless full-page shot).
Console errors in all runs are only the known environmental ones (GA
`ERR_TUNNEL_CONNECTION_FAILED`, favicon 404).

- **Divisions at 980px (his viewport).** All 8 plates bold, icons
  whole, scenes visible, No. chips legible.
- **Divisions desktop 1280 + mobile 390.** Single-column full-width
  plates on mobile; bento grid on desktop.
- **Home desktop + light + mobile.** Hero cover works, 64px serif
  headline. Light theme plates pop on warm paper in both themes.
- **Division (Automotive) banner.** Wide blue band, scene right,
  No. chip left.
- **Article 1.** 40px serif title, meta "No. 01 · Published 11 Nov
  2026", body word-for-word intact.
- **Dashboard desktop + mobile.** Login card centred, all controls
  present.

### Files changed (round 2)

`frontend/pages/division.html`, `frontend/scripts/app.js`,
`frontend/styles/main.css`, `frontend/styles/responsive.css`,
`tests/division-not-found.test.js`, `tests/ui-styles.test.js`. Nothing
else. Local only — not deployed, not pushed.

### Deliberately unchanged (round 2)

- Every slop sign stays absent; the field-guide direction, the "No. NN"
  signature, flat cards, serif titles and sentence case are kept.
- **All content and behaviour** — every feature, section, link,
  article, tool and dashboard control exactly as-is. No copy changed.
- **Login/session logic, backend, D1 data, publishing flags** —
  untouched by rule.
- **The `.div-icon` / `.div-dot` CSS rules** stay in `main.css`
  (one existing test pins `.div-icon` background); only the markup
  use was removed.

---

Unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0.
