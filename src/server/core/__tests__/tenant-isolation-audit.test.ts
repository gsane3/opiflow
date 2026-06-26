// Cross-tenant isolation AUDIT (the convention, enforced).
//
// tenantDb (proved sound in tenant.test.ts) is only a guarantee for queries that
// actually go through it. This guard scans every server module for RAW Supabase
// access (`.from(` on the service-role client instead of the tenantDb `db.from(`)
// and asserts each such module is in a DOCUMENTED allowlist with a legitimate
// reason. A NEW module that reaches for the raw client — the exact way a
// cross-tenant leak gets introduced — fails this test until it either uses tenantDb
// or is consciously allowlisted here with a reason.
//
// This is the "lint rule / convention that forbids the raw client in adopted
// routes" + the "audit of routes that don't go through tenantDb" from the
// production-readiness review, with special attention called out for the public
// portal and webhook modules (their token / service-role auth is by design).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, sep } from 'path';

const MODULES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../modules');

// Modules that legitimately access Supabase WITHOUT the tenantDb wrapper. Each MUST
// have a documented reason. Keep this list tight — adding to it is a security decision.
const RAW_FROM_ALLOWLIST: Record<string, string> = {
  // `businesses` table is keyed by `id` (its PK IS the business id — there is NO
  // business_id column), so tenantDb can't scope it; these use .eq('id', businessId).
  businesses: 'businesses table PK=id (no business_id column); + onboarding has no business yet',
  'messaging-settings': 'businesses table (PK=id) → .eq("id", businessId)',
  'disclosure-audio': 'businesses table (PK=id), custom bearer auth',
  // Service-role / machine-auth: there is no authenticated user; the tenant is
  // resolved from the provider payload or processed across all tenants by design.
  'webhooks-voice': 'service-role; tenant resolved from provider payload, explicit .eq(business_id)/by-id',
  cron: 'machine-auth; cross-tenant batch processing by design',
  // Public portal token-auth boundary — NOT requireBusinessUser; scoped by token hash.
  'public-intake': 'public token-auth boundary; scoped by token hash',
  'public-upload': 'public token-auth boundary; scoped by token hash',
  'public-folder': 'public token-auth boundary; scoped by token hash',
  // Tenant-scoped but with explicit .eq(business_id) rather than the wrapper.
  team: 'membership tables (business_users/invites/presence); scoped by business_id/token',
  account: 'GDPR account deletion across the owner-scoped tables',
  push: 'device_push_tokens keyed by token (+ business_id)',
  'customer-folders': 'explicit .eq(business_id).eq(customer_id) + migration-047 tolerant double-select',
  'customer-reply-draft': '3 parallel grounding reads, each explicit .eq(business_id)',
  'number-requests': 'number_requests table; explicit .eq(business_id) / by-id',
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Module name = the first path segment under src/server/modules/. */
function moduleOf(file: string): string {
  const rel = file.slice(MODULES_DIR.length + 1);
  return rel.split(sep)[0];
}

// A `.from(` call is "raw" unless the receiver is the tenantDb handle `db`.
// Matches e.g. `ctx.supabase.from(`, `supabase.from(`, `serviceClient.from(`,
// `a.supabase.from(` — but NOT `db.from(`.
const RAW_FROM_RE = /(?<![\w.])(?:[\w.]*\.)?(?:supabase|client|serviceClient)\.from\(/g;

describe('tenant-isolation audit — raw Supabase access is allowlisted', () => {
  const rawByModule = new Map<string, Array<{ file: string; line: number }>>();

  for (const file of listTsFiles(MODULES_DIR)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      RAW_FROM_RE.lastIndex = 0;
      if (RAW_FROM_RE.test(text)) {
        const mod = moduleOf(file);
        if (!rawByModule.has(mod)) rawByModule.set(mod, []);
        rawByModule.get(mod)!.push({ file: file.slice(MODULES_DIR.length + 1), line: i + 1 });
      }
    });
  }

  it('every module using the raw client is documented in the allowlist', () => {
    const offenders = [...rawByModule.keys()].filter((m) => !(m in RAW_FROM_ALLOWLIST));
    if (offenders.length > 0) {
      const detail = offenders
        .map((m) => `  - ${m}: ${rawByModule.get(m)!.map((r) => `${r.file}:${r.line}`).join(', ')}`)
        .join('\n');
      throw new Error(
        `New module(s) reach for the RAW Supabase client (bypassing tenantDb). ` +
        `Use tenantDb, or add to RAW_FROM_ALLOWLIST with a reason if it's legitimately ` +
        `cross-tenant / by-id / token-auth:\n${detail}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the allowlist has no stale entries (every allowlisted module still uses the raw client)', () => {
    const stale = Object.keys(RAW_FROM_ALLOWLIST).filter((m) => !rawByModule.has(m));
    // Stale entries are not a security risk, just drift — surface them so the list stays honest.
    expect(stale, `Allowlisted modules that no longer use the raw client (prune them): ${stale.join(', ')}`).toEqual([]);
  });

  it('there ARE tenantDb-scoped modules (sanity: the scan found real code)', () => {
    // Guards against a path/scan regression silently passing the audit.
    expect(listTsFiles(MODULES_DIR).length).toBeGreaterThan(50);
  });
});
