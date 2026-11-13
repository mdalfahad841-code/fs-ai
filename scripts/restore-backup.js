// FS AI — Restore a GET /api/admin/backup JSON export.
//
// The backup is a JSON dump of 11 tables, NOT a D1-native backup, so the
// restore is: build a fresh database from database/schema.sql +
// database/seed.sql, then replay the exported rows into it. The replay is
// deliberately three steps, all in one transaction:
//
//   1. PRAGMA foreign_keys = OFF. The Worker itself notes (backend/routes/
//      admin-articles.js, deleteArticle) that D1 does not enforce ON
//      DELETE CASCADE, so a live database can hold orphans — e.g. a
//      revision whose article was deleted. Loading with FK off reproduces
//      the live database faithfully instead of failing on its orphans;
//      the load is verified afterwards with foreign_key_check, reported
//      as warnings, not a failure.
//   2. DELETE stale rows: for each backed-up table, delete rows whose id
//      is NOT in the backup (children first). Without this, seed rows the
//      owner deleted live — e.g. the two tags a CMS edit replaced —
//      reappear from the seed, and the restored database does not match
//      the backup. (Verified: an upsert-only restore left 54 tag rows
//      where the backup had 52.)
//   3. Upsert every exported row by id (INSERT ... ON CONFLICT(id) DO
//      UPDATE). NOT plain INSERT (the seed already holds the same ids, so
//      every row conflicts) and NOT INSERT OR REPLACE: REPLACE deletes the
//      old row first, which under FK enforcement fails outright on
//      ON DELETE RESTRICT parents (business_divisions) and cascade-deletes
//      rows in tables the backup does NOT cover (agent_permissions).
//      An upsert updates in place, so those seed rows survive untouched.
//
// Tables are written parents-first (RESTORE_ORDER) so foreign keys also
// resolve if the consumer enforces them; stale-row deletes run in the
// reverse order for the same reason.
//
// Two ways to use it:
//   1. Local / verification:
//        node scripts/restore-backup.js <backup.json> <out.sqlite>
//      Builds out.sqlite from schema.sql + seed.sql, restores, verifies
//      per-table counts against the backup, and reports foreign_key_check.
//      Refuses to overwrite an existing file unless --force is given.
//   2. Live D1 recovery (owner only, see docs/BACKUP-RECOVERY.md):
//        node scripts/restore-backup.js <backup.json> --sql restore.sql
//      Emits restore.sql — the same statements, pasteable into the
//      D1 Console (or `wrangler d1 execute <db> --file=restore.sql`) after
//      schema.sql + seed.sql have been applied to the fresh D1 database.
//      If the Console rejects the PRAGMA lines, delete those two lines:
//      the dependency order keeps the load valid for non-orphan data.
//      NEVER run it against the live database: it overwrites rows by id.
//
// Requires Node >= 22.5 (node:sqlite). Zero-cost: no network, no wrangler.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

// Dependency order: a row's foreign keys must already exist when it is
// written. website_settings.updated_by / articles.created_by reference
// owner_accounts, which the seed provides (id 1); revenue_records
// .account_id references monetization_accounts, also seed-provided.
const RESTORE_ORDER = [
  'website_settings',
  'business_divisions',
  'categories',
  'ai_agents',
  'articles',
  'article_revisions',
  'article_tags',
  'newsletter_subscribers',
  'agent_activity_logs',
  'automation_jobs',
  'revenue_records',
];

// Split a SQL file into statements: ';' outside single-quoted strings ends
// a statement; '--' starts a line comment (outside strings). Same splitter
// as tests/real-db.test.js, proven against schema.sql + seed.sql.
function splitSqlStatements(text) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inComment) {
      if (ch === '\n') { inComment = false; cur += ch; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { cur += ch; stmts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.filter((s) => s.trim());
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`restore: non-finite number in backup row: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new Error('restore: backup value contains a NUL byte, which SQLite text cannot hold');
    return "'" + value.replace(/'/g, "''") + "'";
  }
  throw new Error(`restore: unsupported value type in backup row: ${typeof value}`);
}

// One row as an id-keyed upsert. All exported tables have an INTEGER
// PRIMARY KEY `id`, so ON CONFLICT(id) is the identity that keeps links
// (articles.division_id, article_tags.article_id, ...) correct.
function upsertSql(table, row) {
  const cols = Object.keys(row);
  if (!cols.length) throw new Error(`restore: empty row for table ${table}`);
  if (!cols.includes('id')) throw new Error(`restore: row in ${table} has no id; cannot upsert without it`);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const values = cols.map((c) => sqlLiteral(row[c])).join(', ');
  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(', ');
  return `INSERT INTO "${table}" (${colList}) VALUES (${values}) ON CONFLICT("id") DO UPDATE SET ${updates};`;
}

// Delete seed rows that the backup does not contain, so rows deleted live
// do not reappear from the seed. `ids` are the backup's ids for the table;
// an empty backup list means "delete every row". Children first, so a
// RESTRICT parent is never deleted while its rows still point at it.
function deleteStaleSql(table, ids) {
  if (!ids.length) return `DELETE FROM "${table}";`;
  const sorted = [...ids].map((id) => Number(id)).sort((a, b) => a - b);
  return `DELETE FROM "${table}" WHERE "id" NOT IN (${sorted.join(', ')});`;
}

// Build the Console-pasteable SQL for a backup export, plus the per-table
// row counts the restore must end up with. Tables present in the export
// but not in RESTORE_ORDER are appended last with a warning comment; the
// transaction still fails loudly if their rows are malformed.
function buildRestoreSql(backup) {
  if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('restore: not a backup export — expected an object with a "tables" map (GET /api/admin/backup output)');
  }
  const lines = [
    '-- FS AI backup restore — generated by scripts/restore-backup.js',
    `-- exported_at: ${backup.exported_at || 'unknown'}`,
    '-- Apply ONLY to a FRESH database that already has database/schema.sql',
    '-- + database/seed.sql applied. NEVER run against the live database:',
    '-- every row overwrites the row with the same id, and rows the backup',
    '-- does not contain are deleted from the backed-up tables.',
    '-- foreign_keys is OFF during the load because D1 does not enforce',
    '-- ON DELETE CASCADE (see backend/routes/admin-articles.js), so a live',
    '-- database may hold orphans such as revisions of deleted articles.',
    '-- If the D1 Console rejects the PRAGMA lines, delete those two lines:',
    '-- the dependency order below still keeps the load valid for data',
    '-- without orphans. Verify afterwards with the counts printed by the',
    '-- restore script, or GET /api/health + the public article list.',
    'PRAGMA foreign_keys = OFF;',
    '',
  ];
  const counts = {};
  const ordered = [...RESTORE_ORDER];
  for (const table of Object.keys(backup.tables)) {
    if (!ordered.includes(table)) {
      lines.push(`-- WARNING: table ${table} is in the backup but has no known dependency order; appended last.`);
      ordered.push(table);
    }
  }
  lines.push('-- Step 1: delete seed rows the backup does not contain (children first).');
  for (const table of [...ordered].reverse()) {
    const rows = backup.tables[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`restore: tables.${table} is not an array`);
    lines.push(deleteStaleSql(table, rows.map((r) => r.id)));
  }
  lines.push('', '-- Step 2: upsert the exported rows (parents first).');
  for (const table of ordered) {
    const rows = backup.tables[table];
    if (rows === undefined) continue;
    lines.push(`-- ${table}: ${rows.length} row(s)`);
    for (const row of rows) lines.push(upsertSql(table, row));
    counts[table] = rows.length;
  }
  return { sql: lines.join('\n') + '\n', counts };
}

// Apply schema.sql + seed.sql to a database (in-memory or file). Used by
// the CLI and the tests; the live path applies the same two files in the
// D1 Console instead.
function applySchemaAndSeed(db) {
  for (const file of ['database/schema.sql', 'database/seed.sql']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSqlStatements(text)) db.exec(stmt);
  }
}

// Restore a parsed backup export into an open DatabaseSync connection.
// The database must already have schema.sql + seed.sql applied (see
// applySchemaAndSeed). Runs in one transaction and verifies, per table,
// that the row count afterwards equals the backup count; a mismatch throws
// and nothing is written (transaction rolled back). Returns { counts,
// fkViolations }: fkViolations lists foreign_key_check rows found after
// the load — orphans the live database itself holds (revisions of deleted
// articles), faithfully reproduced, not a failure.
function restoreBackup(db, backup) {
  const { sql, counts } = buildRestoreSql(backup);
  // PRAGMA foreign_keys is a no-op inside a transaction, so the OFF must
  // happen BEFORE BEGIN (the generated SQL also carries it, for the
  // D1 Console path, where statements run one by one).
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw new Error(`restore: failed, nothing was written (transaction rolled back): ${err.message}`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  const mismatches = [];
  for (const [table, expected] of Object.entries(counts)) {
    const actual = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    if (actual !== expected) {
      mismatches.push(`${table}: backup has ${expected} row(s) but the database has ${actual}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`restore: count mismatch after restore:\n  - ${mismatches.join('\n  - ')}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  return { counts, fkViolations };
}

function printUsage() {
  console.error('Usage: node scripts/restore-backup.js <backup.json> <out.sqlite> [--sql <restore.sql>] [--force]');
  console.error('   or: node scripts/restore-backup.js <backup.json> --sql <restore.sql>');
  console.error('Builds a fresh local database from schema.sql + seed.sql and restores');
  console.error('the backup into it (local SQLite only — never the live D1 database).');
}

async function main(argv) {
  const args = argv.slice(2);
  const positional = [];
  let sqlOut = null;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sql') sqlOut = args[++i];
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--help' || args[i] === '-h') { printUsage(); return 0; }
    else if (args[i].startsWith('-')) { console.error(`unknown flag: ${args[i]}`); printUsage(); return 2; }
    else positional.push(args[i]);
  }
  const [backupPath, outPath] = positional;
  if (!backupPath || (!outPath && !sqlOut)) { printUsage(); return 2; }
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const { sql, counts } = buildRestoreSql(backup);
  if (sqlOut) {
    fs.writeFileSync(sqlOut, sql);
    console.log(`wrote ${sqlOut} (${Object.values(counts).reduce((a, b) => a + b, 0)} upsert(s), ${Object.keys(counts).length} tables)`);
  }
  if (!outPath) {
    console.log('SQL only — no local database built. Apply it to a FRESH D1 database after schema.sql + seed.sql; see docs/BACKUP-RECOVERY.md.');
    return 0;
  }
  if (fs.existsSync(outPath) && !force) {
    console.error(`refusing to overwrite existing ${outPath} (pass --force to replace it)`);
    return 2;
  }
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const db = new DatabaseSync(outPath);
  try {
    applySchemaAndSeed(db);
    const { counts: verified, fkViolations } = restoreBackup(db, backup);
    console.log(`restored into ${outPath}`);
    for (const table of RESTORE_ORDER) {
      if (verified[table] !== undefined) console.log(`  ${table}: ${verified[table]} row(s)`);
    }
    if (fkViolations.length) {
      console.log(`foreign_key_check: ${fkViolations.length} violation(s) — orphans the live database holds, faithfully reproduced (e.g. revisions of deleted articles):`);
      for (const v of fkViolations.slice(0, 10)) console.log(`  ${v.table} row ${v.rowid}: references ${v.fktable || v.parent} (fkid ${v.fkid})`);
    } else {
      console.log('foreign_key_check: clean');
    }
    console.log('counts verified against the backup export.');
  } finally {
    db.close();
  }
  return 0;
}

if (require.main === module) {
  main(process.argv).then(
    (code) => { process.exit(code); },
    (err) => { console.error(err.message); process.exit(1); },
  );
}

module.exports = { RESTORE_ORDER, splitSqlStatements, sqlLiteral, upsertSql, deleteStaleSql, buildRestoreSql, applySchemaAndSeed, restoreBackup };
