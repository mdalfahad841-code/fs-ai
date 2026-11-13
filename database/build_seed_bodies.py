#!/usr/bin/env python3
"""Put the 25 articles' FULL bodies into the database seed.

Source of truth for the text: frontend/scripts/app.js (the ARTICLES array,
one article per line, body in a template literal). This script copies the
bodies verbatim by id (1-25) into database/seed.sql, replacing only the
`body` field of each article row -- every other field (id, division_id,
category_id, title, slug, excerpt, author, status, fact_checked,
reading_minutes, published_at) is kept exactly as it is.

It also writes database/console-chunks/seed-bodies-update.sql: one UPDATE
per article, for the owner to run in the D1 Console to upgrade the live
rows. D1 Console constraints (hard-learned):
  * pure ASCII -- Unicode punctuation is converted to ASCII equivalents;
  * NO comment lines at all;
  * NO semicolons inside string values (';' in body text becomes ',').
The same ASCII normalisation is applied to the bodies in seed.sql, so the
seed and the console chunk agree byte-for-byte on body text.

Run from the repo root:  python3 database/build_seed_bodies.py
Re-running is idempotent: it re-reads app.js and rebuilds both files.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / "frontend" / "scripts" / "app.js"
SEED_SQL = ROOT / "database" / "seed.sql"
CHUNK_SQL = ROOT / "database" / "console-chunks" / "seed-bodies-update.sql"
OLD_ROWS_SNAPSHOT = Path("/tmp/seed_old_rows.json")

# Unicode punctuation -> ASCII equivalents (D1 Console needs pure ASCII).
ASCII_MAP = {
    "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-",
    "\u2014": "-", "\u2015": "-",
    "\u2026": "...",
    "\u00d7": "x", "\u00f7": "/",
    "\u00a0": " ", "\u200b": "", "\u00ad": "",
    "\u2022": "-", "\u2192": "->", "\u00b7": "-",
}


def normalize_body(body):
    """ASCII-normalise a body; ';' inside text becomes ',' (no semicolons
    allowed inside string values in the D1 Console chunk)."""
    out = []
    for ch in body:
        if ch in ASCII_MAP:
            out.append(ASCII_MAP[ch])
        elif ord(ch) < 128:
            out.append(ch)
        else:
            raise ValueError(f"unmapped non-ASCII char U+{ord(ch):04X} {ch!r}")
    return "".join(out).replace(";", ",")


def sql_escape(value):
    return value.replace("'", "''")


def word_count(html):
    return len(re.sub(r"<[^>]+>", " ", html).split())


def parse_frontend():
    """Return {id: body} from the ARTICLES array in app.js."""
    lines = APP_JS.read_text(encoding="utf-8").splitlines()
    bodies = {}
    for line in lines:
        m = re.match(r"\s*\{\s*id: (\d+),", line)
        if not m:
            continue
        aid = int(m.group(1))
        bi = line.find("body: `")
        if bi == -1:
            raise ValueError(f"article {aid}: no body found in app.js line")
        rest = line[bi + 7:]
        ci = rest.rfind("`")
        if ci == -1:
            raise ValueError(f"article {aid}: unterminated body template literal")
        body = rest[:ci]
        if "`" in body or "${" in body:
            raise ValueError(f"article {aid}: body contains backtick/interpolation")
        if "\n" in body or "\t" in body:
            raise ValueError(f"article {aid}: body contains newline/tab")
        bodies[aid] = body
    if sorted(bodies) != list(range(1, 26)):
        raise ValueError(f"frontend articles are not ids 1-25: {sorted(bodies)}")
    return bodies


def find_statement_end(text, start):
    """Index of the ';' ending the SQL statement starting at `start`."""
    i, in_str = start, False
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "'":
                if text[i + 1] == "'":
                    i += 2
                    continue
                in_str = False
        else:
            if ch == "'":
                in_str = True
            elif ch == ";":
                return i
        i += 1
    raise ValueError("statement terminator not found")


def parse_seed_rows(stmt):
    """Parse the VALUES tuples of the articles INSERT into 12-field rows."""
    vals = stmt[stmt.index("VALUES") + len("VALUES"):]
    rows, j, n = [], 0, len(vals)
    while j < n:
        while j < n and vals[j] not in "()":
            j += 1
        if j >= n:
            break
        assert vals[j] == "(", f"expected '(' at {j}"
        j += 1
        fields = []
        while True:
            while j < n and vals[j] in " \n":
                j += 1
            if vals[j] == "'":
                j += 1
                buf = []
                while True:
                    if vals[j] == "'":
                        if vals[j + 1] == "'":
                            buf.append("'")
                            j += 2
                        else:
                            j += 1
                            break
                    else:
                        buf.append(vals[j])
                        j += 1
                fields.append("".join(buf))
            else:
                m = re.match(r"-?\d+", vals[j:])
                if not m:
                    raise ValueError(f"cannot parse field at offset {j}: {vals[j:j+40]!r}")
                fields.append(int(m.group(0)))
                j += len(m.group(0))
            while j < n and vals[j] in " \n":
                j += 1
            if vals[j] == ",":
                j += 1
                continue
            if vals[j] == ")":
                j += 1
                break
            raise ValueError(f"expected ',' or ')' at offset {j}: {vals[j:j+40]!r}")
        rows.append(fields)
        while j < n and vals[j] in " \n,":
            j += 1
        if j < n and vals[j] == ";":
            break
    if len(rows) != 25 or sorted(r[0] for r in rows) != list(range(1, 26)):
        raise ValueError(f"seed articles are not 25 rows ids 1-25: {[r[0] for r in rows]}")
    for r in rows:
        if len(r) != 12:
            raise ValueError(f"article {r[0]}: {len(r)} fields, expected 12")
    return rows


def parse_frontend_title(line):
    m = re.search(r'title: ("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\')', line)
    t = m.group(1)
    if t.startswith('"'):
        return t[1:-1]
    return t[1:-1].replace("\\'", "'")


def main():
    bodies = parse_frontend()
    lines = APP_JS.read_text(encoding="utf-8").splitlines()
    fe_titles = {}
    for line in lines:
        m = re.match(r"\s*\{\s*id: (\d+),", line)
        if m:
            fe_titles[int(m.group(1))] = parse_frontend_title(line)

    seed_text = SEED_SQL.read_text(encoding="utf-8")
    start = seed_text.index("INSERT OR IGNORE INTO articles")
    end = find_statement_end(seed_text, start)
    stmt = seed_text[start:end + 1]
    rows = parse_seed_rows(stmt)

    # Snapshot the old rows (for verifying non-body fields are unchanged).
    OLD_ROWS_SNAPSHOT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    # Title cross-check: frontend title must match the seed title per id.
    for r in rows:
        if fe_titles[r[0]] != r[3]:
            raise ValueError(
                f"title mismatch id {r[0]}: frontend {fe_titles[r[0]]!r} != seed {r[3]!r}")

    # Rebuild the statement with full bodies, keeping the original layout.
    new_rows = []
    for r in rows:
        aid = r[0]
        full = normalize_body(bodies[aid])
        new = list(r)
        new[6] = full
        new_rows.append(new)

    header = ("INSERT OR IGNORE INTO articles (id, division_id, category_id, title, "
              "slug, excerpt, body, author, status, fact_checked, reading_minutes, "
              "published_at) VALUES\n")
    rendered = []
    for idx, r in enumerate(new_rows):
        terminator = ";" if idx == len(new_rows) - 1 else ","
        rendered.append(
            f"({r[0]}, {r[1]}, {r[2]}, '{sql_escape(r[3])}',\n"
            f" '{sql_escape(r[4])}',\n"
            f" '{sql_escape(r[5])}',\n"
            f" '{sql_escape(r[6])}',\n"
            f" '{sql_escape(r[7])}', '{sql_escape(r[8])}', {r[9]}, {r[10]}, '{r[11]}'){terminator}")
    new_stmt = header + "\n".join(rendered)
    new_seed = seed_text[:start] + new_stmt + seed_text[end + 1:]
    # The comment above the statement says "opening bodies" -- now full bodies.
    new_seed = new_seed.replace(
        "-- 25 articles — exact titles, real slugs, real excerpts and opening bodies.",
        "-- 25 articles — exact titles, real slugs, real excerpts and full bodies.")
    SEED_SQL.write_text(new_seed, encoding="utf-8")

    # Console chunk: one UPDATE per article, no comments, pure ASCII.
    chunk_lines = [
        f"UPDATE articles SET body = '{sql_escape(normalize_body(bodies[aid]))}' WHERE id = {aid};"
        for aid in range(1, 26)
    ]
    chunk_text = "\n".join(chunk_lines) + "\n"
    assert chunk_text.isascii(), "chunk is not pure ASCII"
    assert "--" not in chunk_text, "chunk contains '--'"
    for line in chunk_lines:
        assert line.count(";") == 1, f"semicolon inside value: {line[:80]}"
    CHUNK_SQL.write_text(chunk_text, encoding="ascii")

    # Self-check: chunk bodies must equal the seed bodies.
    def parse_sql_string(text, pos):
        """Parse a '...' literal starting at text[pos] == \"'\"; return (value, end)."""
        assert text[pos] == "'"
        pos += 1
        buf = []
        while True:
            ch = text[pos]
            if ch == "'":
                if text[pos + 1] == "'":
                    buf.append("'")
                    pos += 2
                else:
                    return "".join(buf), pos + 1
            else:
                buf.append(ch)
                pos += 1

    check_rows = parse_seed_rows(new_stmt)
    for r in check_rows:
        aid = r[0]
        line = chunk_lines[aid - 1]
        qpos = line.index("body = '") + len("body = ")
        chunk_body, after = parse_sql_string(line, qpos)
        assert line[after:].strip() == f"WHERE id = {aid};", f"chunk line {aid} tail wrong"
        assert chunk_body == r[6], f"chunk/seed body mismatch id {aid}"
        assert r[6] == normalize_body(bodies[aid])

    counts = {aid: word_count(normalize_body(bodies[aid])) for aid in range(1, 26)}
    old_counts = {r[0]: len(r[6].split()) for r in rows}
    print(f"seed.sql updated: {len(check_rows)} articles, bodies replaced")
    print(f"old bodies: {min(old_counts.values())}-{max(old_counts.values())} words, "
          f"total {sum(old_counts.values())}")
    print(f"new bodies: min {min(counts.values())} (id {min(counts, key=counts.get)}), "
          f"max {max(counts.values())} (id {max(counts, key=counts.get)}), "
          f"total {sum(counts.values())}")
    print(f"chunk written: {CHUNK_SQL} ({len(chunk_lines)} UPDATEs, "
          f"{len(chunk_text.encode('ascii'))} bytes, pure ASCII, no comments)")
    print(f"old rows snapshot: {OLD_ROWS_SNAPSHOT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
