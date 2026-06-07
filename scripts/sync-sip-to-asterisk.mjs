#!/usr/bin/env node
/*
 * sync-sip-to-asterisk.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs per-user browser SIP credentials from the Opiflow app DB (Supabase) into
 * Asterisk's PJSIP Realtime tables (ps_auths / ps_aors / ps_endpoints).
 *
 * This is "Option A1" from docs/ASTERISK_REALTIME_PROVISIONING.md: the app stores
 * each business's SIP password AES-256-GCM-encrypted; this worker decrypts it with
 * SIP_CRED_ENC_KEY and writes the plaintext into the Asterisk DB so the browser
 * phone can REGISTER as biz_<business_id>.
 *
 * RUN IT ON THE ASTERISK BOX (so the Asterisk DB stays on localhost and is never
 * exposed to the internet; the script reaches Supabase over HTTPS).
 *
 * Reconcile each run:
 *   • browser_sip_endpoints.status = 'active'  → upsert ps_auths/ps_aors/ps_endpoints
 *   • status in ('revoked','suspended')        → delete those rows (blocks REGISTER)
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *   npm i pg            # only dependency; Node 18+ (built-in fetch/crypto)
 *
 * ── Env ──────────────────────────────────────────────────────────────────────
 *   SUPABASE_URL                https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   service-role key (read browser_sip_endpoints + businesses)
 *   SIP_CRED_ENC_KEY            the SAME 32-byte key (64-hex or base64) the app uses
 *   ASTERISK_DATABASE_URL       postgres://user:pass@localhost:5432/asterisk
 *   PHONE_SIP_REALM             (optional) realm written into ps_auths
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   node scripts/sync-sip-to-asterisk.mjs           # one-shot (ideal for cron)
 *   node scripts/sync-sip-to-asterisk.mjs --watch   # loop every 60s
 *
 *   # cron (every minute):
 *   #   * * * * * cd /opt/opiflow && /usr/bin/node scripts/sync-sip-to-asterisk.mjs >> /var/log/opiflow-sip-sync.log 2>&1
 *
 * Idempotent: safe to run repeatedly. Exit code 0 on success, 1 on fatal error.
 */

import crypto from 'node:crypto';
import pg from 'pg';

// ── Env ──────────────────────────────────────────────────────────────────────
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SIP_CRED_ENC_KEY,
  ASTERISK_DATABASE_URL,
  PHONE_SIP_REALM,
} = process.env;

function need(name, value) {
  if (!value) {
    console.error(`[sip-sync] Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}
need('SUPABASE_URL', SUPABASE_URL);
need('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);
need('SIP_CRED_ENC_KEY', SIP_CRED_ENC_KEY);
need('ASTERISK_DATABASE_URL', ASTERISK_DATABASE_URL);

// ── Crypto (mirrors src/lib/server/sip-credentials.ts) ───────────────────────
function loadKey() {
  const raw = SIP_CRED_ENC_KEY.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('[sip-sync] SIP_CRED_ENC_KEY must be 32 bytes (64 hex chars or base64).');
    process.exit(1);
  }
  return key;
}
const KEY = loadKey();

/** Decrypts "v1:iv:tag:ct" → plaintext, or null on any failure. */
function decryptSecret(payload) {
  try {
    const parts = String(payload).split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ── Supabase REST (service role; RLS bypassed) ───────────────────────────────
async function sb(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase GET ${pathAndQuery} → ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

// ── One sync pass ────────────────────────────────────────────────────────────
async function syncOnce() {
  const ts = new Date().toISOString();

  // Active endpoints that already have a password set.
  const active = await sb(
    'browser_sip_endpoints?status=eq.active&sip_password_enc=not.is.null' +
      '&select=business_id,sip_username,sip_password_enc'
  );
  // Endpoints to tear down (cancelled / suspended).
  const dead = await sb(
    'browser_sip_endpoints?status=in.(revoked,suspended)&select=sip_username'
  );

  // DIDs (for outbound caller-id) for the active set.
  const didById = {};
  const ids = [...new Set(active.map((e) => e.business_id).filter(Boolean))];
  if (ids.length) {
    const biz = await sb(`businesses?id=in.(${ids.join(',')})&select=id,business_phone_number`);
    for (const b of biz) didById[b.id] = b.business_phone_number || null;
  }

  const client = new pg.Client({ connectionString: ASTERISK_DATABASE_URL });
  await client.connect();
  let upserts = 0;
  let skipped = 0;
  let removed = 0;
  try {
    for (const e of active) {
      const username = e.sip_username;
      if (!username) {
        skipped++;
        continue;
      }
      const password = decryptSecret(e.sip_password_enc);
      if (!password) {
        // Bad/rotated key — never write a blank credential.
        skipped++;
        continue;
      }
      const did = didById[e.business_id] || null;

      await client.query(
        `INSERT INTO ps_auths (id, auth_type, username, password, realm)
         VALUES ($1, 'userpass', $1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password, realm = EXCLUDED.realm`,
        [username, password, PHONE_SIP_REALM || null]
      );
      await client.query(
        `INSERT INTO ps_aors (id, max_contacts, remove_existing)
         VALUES ($1, 1, 'yes')
         ON CONFLICT (id) DO NOTHING`,
        [username]
      );
      await client.query(
        `INSERT INTO ps_endpoints (id, transport, aors, auth, callerid)
         VALUES ($1, 'transport-wss', $1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET callerid = EXCLUDED.callerid`,
        [username, did]
      );
      upserts++;
    }

    for (const e of dead) {
      const username = e.sip_username;
      if (!username) continue;
      await client.query('DELETE FROM ps_endpoints WHERE id = $1', [username]);
      await client.query('DELETE FROM ps_aors WHERE id = $1', [username]);
      await client.query('DELETE FROM ps_auths WHERE id = $1', [username]);
      removed++;
    }
  } finally {
    await client.end();
  }

  console.log(`[sip-sync] ${ts} upserted=${upserts} removed=${removed} skipped=${skipped}`);
}

// ── Entry ────────────────────────────────────────────────────────────────────
const watch = process.argv.includes('--watch');
if (watch) {
  const loop = async () => {
    try {
      await syncOnce();
    } catch (err) {
      console.error('[sip-sync] error:', err.message);
    }
    setTimeout(loop, 60_000);
  };
  loop();
} else {
  syncOnce().catch((err) => {
    console.error('[sip-sync] fatal:', err.message);
    process.exit(1);
  });
}
