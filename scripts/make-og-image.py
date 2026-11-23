#!/usr/bin/env python3
"""FS AI — generate the branded Open Graph image (1200x630) locally.

No third-party assets, no downloads: flat dark-navy background (the same
#0A1527 as the Pinterest pin design, backend/social/card.js CARD_NAVY),
brand blue #2878FF accent, site name + tagline drawn with system DejaVu
fonts. Output goes to frontend/og-image.png (the Pages-served root) and
a mirror copy in public/og-image.png (same convention as sitemap.xml,
which is kept in both places).

Run: python3 scripts/make-og-image.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 630
NAVY = (10, 21, 39)          # #0A1527 — Pinterest pin background
BLUE = (40, 120, 255)        # #2878FF — brand blue
WHITE = (255, 255, 255)
MUTED = (159, 179, 200)      # soft blue-grey for secondary lines
LIGHT_BLUE = (106, 166, 255)  # #6AA6FF — light brand blue

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def tracked_text(draw, xy, text, fill, fnt, tracking=0):
    """Draw text with extra letter spacing (PIL has no tracking)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, fill=fill, font=fnt)
        x += draw.textlength(ch, font=fnt) + tracking
    return x


def main():
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)

    # Brand mark: solid blue square with "FS", top-left.
    d.rounded_rectangle([72, 72, 192, 192], radius=18, fill=BLUE)
    mark_font = font(FONT_BOLD, 64)
    d.text((132, 108), "FS", fill=WHITE, font=mark_font, anchor="mm")

    # Site name.
    name_font = font(FONT_BOLD, 150)
    d.text((228, 72), "FS AI", fill=WHITE, font=name_font)

    # Full name, letterspaced, muted.
    sub_font = font(FONT_REG, 34)
    tracked_text(d, (76, 268), "FAHAD SOMRAT AI", MUTED, sub_font, tracking=8)

    # Accent rule.
    d.rectangle([76, 348, 276, 356], fill=BLUE)

    # Tagline.
    tag_font = font(FONT_BOLD, 52)
    d.text((76, 392), "One Platform. Multiple Possibilities.", fill=LIGHT_BLUE, font=tag_font)

    # Footer line.
    foot_font = font(FONT_REG, 30)
    d.text((76, 540), "Free articles and free tools  ·  fs-ai-5w5.pages.dev", fill=MUTED, font=foot_font)

    targets = [
        os.path.join(ROOT, "frontend", "og-image.png"),
        os.path.join(ROOT, "public", "og-image.png"),
    ]
    for target in targets:
        img.save(target, "PNG")
        print("wrote %s (%d bytes)" % (target, os.path.getsize(target)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
