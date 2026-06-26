#!/usr/bin/env node
// =============================================================================
// check-migrations.mjs — diff supabase/migrations/*.sql against what the live DB
// has recorded in public.schema_migrations (migration 065).
// =============================================================================
// Migrations are applied by hand in the Supabase SQL editor, so this is how you
// confirm the DB matches the repo (no silent drift).
//
//   node scripts/check-migrations.mjs            # report drift (exit 1 if any)
//   node scripts/check-migrations.mjs --backfill # mark ALL on-disk migrations as
//                                                 # applied (run ONCE, after 065,
//                                                 # since 001..064 are already live)
//
// Env (set these before running — the script never reads .env for you):
//   SUPABASE_URL                 e.g. https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    the service-role key (bypasses RLS)
// =============================================================================
import { readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
const URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BACKFILL = process.argv.includes('--backfill');

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(2);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// On-disk migrations: { version: filename }, version = the numeric prefix.
const onDisk = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .reduce((acc, filename) => {
    acc[filename.split('_')[0]] = filename;
    return acc;
  }, {});

async function fetchApplied() {
  const res = await fetch(`${URL}/rest/v1/schema_migrations?select=version`, { headers });
  if (res.status === 404 || res.status === 400) {
    console.error('schema_migrations table not found — apply migration 065 first.');
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`DB query failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  return new Set((await res.json()).map((r) => r.version));
}

if (BACKFILL) {
  const rows = Object.entries(onDisk).map(([version, filename]) => ({ version, filename }));
  const res = await fetch(`${URL}/rest/v1/schema_migrations`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`Backfill failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  console.log(`✓ Backfilled ${rows.length} migrations into schema_migrations (existing rows untouched).`);
  process.exit(0);
}

const applied = await fetchApplied();
const versions = Object.keys(onDisk).sort();
const missing = versions.filter((v) => !applied.has(v));
const orphan = [...applied].filter((v) => !(v in onDisk)).sort();

console.log(`On disk: ${versions.length} migrations · Recorded applied: ${applied.size}`);
if (orphan.length) console.log(`\n⚠️  Recorded in DB but NOT on disk: ${orphan.join(', ')}`);

if (missing.length === 0) {
  console.log('\n✓ All on-disk migrations are recorded as applied. No drift.');
  process.exit(0);
}
console.log(`\n✗ ${missing.length} migration(s) on disk NOT recorded as applied:`);
for (const v of missing) console.log(`   - ${onDisk[v]}`);
console.log('\nApply them in the Supabase SQL editor (each new one self-records via its');
console.log('trailing INSERT). For the one-time historical backfill, run with --backfill.');
process.exit(1);
