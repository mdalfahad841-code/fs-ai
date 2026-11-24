// FS AI — IndexNow key file tests (Fix Pass 4 F4, 2026-11-24).
// The IndexNow key file is the site's ownership proof for Bing's
// IndexNow protocol: the key file must exist at the site root
// (frontend/, the copy Pages serves) and contain exactly the key on
// one line. These tests pin the file and the key so a rename,
// reformat or accidental deletion cannot ship silently. The key is
// public by design (it lives in a public file) — it is not a secret.
// The one-off submit that uses it is documented in
// docs/indexnow-submit.md; no auto-ping was added.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// The IndexNow key (public by design). Keep in sync with
// docs/indexnow-submit.md and the key file name.
const INDEXNOW_KEY = 'c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228';
const KEY_FILE = path.join(ROOT, 'frontend', `${INDEXNOW_KEY}.txt`);

describe('IndexNow key file (Fix Pass 4 F4)', () => {
  it('key file exists at the site root (frontend/)', () => {
    assert.ok(fs.existsSync(KEY_FILE), `IndexNow key file must exist at frontend/${INDEXNOW_KEY}.txt`);
  });

  it('key file contains exactly the key on one line', () => {
    const text = fs.readFileSync(KEY_FILE, 'utf8');
    assert.strictEqual(text, `${INDEXNOW_KEY}\n`, 'key file must contain exactly the key plus a trailing newline, nothing else');
  });

  it('key is 64 lowercase hex chars', () => {
    assert.match(INDEXNOW_KEY, /^[0-9a-f]{64}$/, 'IndexNow key must be 64 lowercase hex chars');
  });

  it('key file name matches the key in docs/indexnow-submit.md', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'indexnow-submit.md'), 'utf8');
    assert.ok(doc.includes(INDEXNOW_KEY), 'docs/indexnow-submit.md must record the same key');
    assert.ok(doc.includes(`${INDEXNOW_KEY}.txt`), 'docs/indexnow-submit.md must record the key file name');
  });
});
