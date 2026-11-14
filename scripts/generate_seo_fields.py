#!/usr/bin/env python3
"""Generate honest SEO titles/descriptions for all 25 FS AI articles from
their real titles and bodies, and write the UPDATE statements to a file.
- seo_title: the article title, cut to 60 chars at a word boundary.
- seo_description: plain text from the body start, cut to 155 chars at a
  word boundary.
No text is invented; values come only from the live API response.
SQL is escaped for the D1 API (single quotes doubled, ';' -> ',')."""
import json, re, subprocess

API = "https://fs-ai.mdalfahad841.workers.dev/api/articles"

raw = subprocess.run(
    ["curl", "-s", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", API],
    capture_output=True, text=True, timeout=60, check=True).stdout
data = json.loads(raw)

articles = data["articles"] if isinstance(data, dict) else data


def plain(html):
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def cut(text, limit):
    if len(text) <= limit:
        return text
    cut_at = text.rfind(" ", 0, limit)
    return text[: cut_at if cut_at > 0 else limit].rstrip()


def esc(value):
    return value.replace("'", "''").replace(";", ",")


lines = []
for a in sorted(articles, key=lambda x: x["id"]):
    title = cut(a["title"].strip(), 60)
    desc = cut(plain(a.get("body", "")), 155)
    lines.append(
        "UPDATE articles SET seo_title = '%s', seo_description = '%s' WHERE id = %d"
        % (esc(title), esc(desc), a["id"])
    )

with open("/tmp/seo-update.sql", "w", encoding="utf-8") as f:
    f.write(";\n".join(lines) + ";\n")

print(f"wrote {len(lines)} UPDATEs to /tmp/seo-update.sql")
for a, line in zip(sorted(articles, key=lambda x: x["id"])[:3], lines[:3]):
    print(a["id"], "->", line[:160])
