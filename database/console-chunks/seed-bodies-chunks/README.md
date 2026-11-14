# Seed-bodies update — split into 5 Console-safe chunks

Why split: the single file `../seed-bodies-update.sql` is 123,482 bytes /
25 UPDATEs in one paste. A full-file paste already failed once in the D1
Console, and the schema/seed only went through after being split the same
way. These 5 parts are the same content, split by article id — re-joining
them in order reproduces the original file byte-for-byte (verified).

No comment lines inside the SQL files — comment lines made the Console
report "no SQL statements detected" for migration 004 before.

## Run in order, in the D1 Console for fs-ai-db

1. `seed-bodies-part1-articles-1-5.sql` — articles 1–5
2. `seed-bodies-part2-articles-6-10.sql` — articles 6–10
3. `seed-bodies-part3-articles-11-15.sql` — articles 11–15
4. `seed-bodies-part4-articles-16-20.sql` — articles 16–20
5. `seed-bodies-part5-articles-21-25.sql` — articles 21–25

Paste one part, run it, wait for the success message, then the next.
Each part is ~22–25 KB.

## Verify after all 5

Run in the Console, or open
`https://fs-ai.mdalfahad841.workers.dev/api/articles` and check article 1:
its `body` should start with the full multi-paragraph text, not the
2–3 sentence summary that is in live D1 as of 2026-11-13 10:25 UTC.

Quick check in the Console:

```sql
SELECT id, length(body) FROM articles ORDER BY id;
```

Every article's body length should be in the thousands, not ~200–400.

## Alternative (no Console pastes at all)

A one-time Cloudflare API token lets the assistant run this update
directly — then no Console paste is ever needed again for D1 work.
That choice is the owner's; these chunks are the fallback if he
chooses the Console path instead.
