#!/usr/bin/env python3
"""FS AI — Social card rasterizer (Workstream C, 2026-11-21).

Renders the deterministic SVG layout from backend/social/card.js to a
real PNG/JPEG file using Pillow (free, already installed in this
environment; DejaVu fonts ship with the OS). No paid service, no
network, no new dependency.

The layout mirrors card.js exactly: same platform sizes, same dark
navy (#0A1527), same division accent colours (the live site's plate
colours), same title truncation (100 chars, the platform title limit),
same margins and proportions. The title is the article's REAL title,
verbatim — nothing is added to it.

Usage:
  python3 scripts/render-social-card.py --title "How to Read Your Car's Warning Lights" \\
      --platform pinterest --division-slug automotive --division-name Automotive \\
      --article-id 5 --out frontend/public/social-cards/article-5-pinterest.png

  --format jpg   # Instagram needs JPEG
  --out DIR      # writes article-<id>-<platform>.<ext> into DIR when --out is a directory

The produced file is what the adapters consume: Pinterest takes the
file (base64) or its public URL; Instagram takes the public HTTPS URL
only, so the file must be deployed to https://fs-ai-5w5.pages.dev/
under social-cards/ before an Instagram post can publish.
"""
import argparse
import json
import os
import sys

NAVY = (10, 21, 39)
WHITE = (255, 255, 255)
MUTED = (159, 179, 209)

DIVISION_ACCENTS = {
    "automotive": "#2878FF",
    "ai-technology": "#19C37D",
    "gadgets-electronics": "#F5A623",
    "finance-money": "#12A594",
    "travel-lifestyle": "#E85D3D",
    "digital-tools": "#9D6BC4",
    "health-wellness": "#D64570",
    "education-learning": "#A9805B",
}
DEFAULT_ACCENT = "#2878FF"

SPECS = {
    "pinterest": {"width": 1000, "height": 1500, "title_font": 84, "max_lines": 6, "format": "png"},
    "instagram": {"width": 1080, "height": 1350, "title_font": 78, "max_lines": 5, "format": "jpg"},
    "facebook": {"width": 1200, "height": 630, "title_font": 64, "max_lines": 3, "format": "png"},
    "linkedin": {"width": 1200, "height": 627, "title_font": 64, "max_lines": 3, "format": "png"},
}

FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts",
]


def find_font(bold=True):
    names = ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"] if bold else ["DejaVuSans.ttf"]
    for d in FONT_DIRS:
        for name in names:
            path = os.path.join(d, name)
            if os.path.exists(path):
                return path
    raise SystemExit("No usable font found (looked for DejaVuSans in /usr/share/fonts).")


def hex_rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _lum(rgb):
    def f(v):
        s = v / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def wrap(draw, text, font, max_width, max_lines):
    words = text.split()
    lines, line = [], ""
    for word in words:
        cand = f"{line} {word}" if line else word
        if draw.textlength(cand, font=font) <= max_width or not line:
            line = cand
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    truncated = False
    if len(lines) > max_lines:
        truncated = True
        kept = lines[:max_lines]
        last = kept[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        kept[-1] = last + "…"
        return kept, truncated
    return lines, truncated


def render(title, platform, division_slug="", division_name="", article_id=None):
    from PIL import Image, ImageDraw, ImageFont

    spec = SPECS[platform]
    width, height = spec["width"], spec["height"]
    scale = width / 1000.0
    margin = round(width * 0.07)
    content_width = width - margin * 2
    accent = hex_rgb(DIVISION_ACCENTS.get((division_slug or "").lower(), DEFAULT_ACCENT))
    label = (division_name or division_slug or "FS AI").upper()
    label_color = accent if contrast(accent, NAVY) >= 4.5 else WHITE

    clean = " ".join(str(title).split())
    if len(clean) > 100:
        clean = clean[:99].rstrip() + "…"

    img = Image.new("RGB", (width, height), NAVY)
    draw = ImageDraw.Draw(img)
    bold_path = find_font(bold=True)
    regular_path = find_font(bold=False)

    bar_h = round(16 * scale)
    draw.rectangle([0, 0, width, bar_h], fill=accent)

    label_font = ImageFont.truetype(bold_path, round(spec["title_font"] * 0.34))
    label_y = round(height * 0.20)
    draw.text((margin, label_y), label, font=label_font, fill=label_color)
    rule_y = label_y + round(48 * scale * 0.55)
    draw.rectangle([margin, rule_y, margin + round(72 * scale), rule_y + round(6 * scale)], fill=accent)

    font_size = spec["title_font"]
    title_font = ImageFont.truetype(bold_path, font_size)
    lines, truncated = wrap(draw, clean, title_font, content_width, spec["max_lines"])
    if truncated and font_size > spec["title_font"] * 0.8:
        font_size = round(spec["title_font"] * 0.88)
        title_font = ImageFont.truetype(bold_path, font_size)
        lines, truncated = wrap(draw, clean, title_font, content_width, spec["max_lines"])
    line_h = round(font_size * 1.22)
    y = round(height * 0.30)
    for line in lines:
        draw.text((margin, y), line, font=title_font, fill=WHITE)
        y += line_h

    brand_font = ImageFont.truetype(bold_path, round(30 * scale))
    site_font = ImageFont.truetype(regular_path, round(26 * scale))
    footer_y = height - round(64 * scale)
    draw.text((margin, footer_y), "FS AI", font=brand_font, fill=WHITE)
    draw.text((margin, footer_y + round(40 * scale)), "fs-ai-5w5.pages.dev", font=site_font, fill=MUTED)

    return img, {
        "platform": platform,
        "width": width,
        "height": height,
        "title": clean,
        "division": division_name or division_slug,
        "accent": "#%02X%02X%02X" % accent,
        "title_truncated": truncated,
        "label_contrast": round(contrast(label_color, NAVY), 2),
        "title_contrast": round(contrast(WHITE, NAVY), 2),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render an FS AI social card (PNG/JPEG).")
    ap.add_argument("--title", required=True, help="Article title, verbatim.")
    ap.add_argument("--platform", required=True, choices=sorted(SPECS))
    ap.add_argument("--division-slug", default="")
    ap.add_argument("--division-name", default="")
    ap.add_argument("--article-id", type=int, default=None)
    ap.add_argument("--format", choices=["png", "jpg"], default=None)
    ap.add_argument("--out", required=True, help="Output file, or a directory (filename derived from --article-id).")
    args = ap.parse_args(argv)

    spec = SPECS[args.platform]
    fmt = args.format or spec["format"]
    if os.path.isdir(args.out):
        if args.article_id is None:
            ap.error("--out is a directory, so --article-id is required to derive the filename.")
        out_path = os.path.join(args.out, f"article-{args.article_id}-{args.platform}.{fmt}")
    else:
        out_path = args.out

    img, meta = render(args.title, args.platform, args.division_slug, args.division_name, args.article_id)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    if fmt == "jpg":
        img.save(out_path, "JPEG", quality=92)
    else:
        img.save(out_path, "PNG")
    meta["file"] = out_path
    meta["format"] = fmt
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
