// Account (GDPR erasure) — repository (data access for cascade + storage).
//
// Parity-matched to POST /api/account/delete. Holds the tenant-scoped per-table
// deletes (belt-and-suspenders for tables without an FK cascade from businesses),
// the PK-keyed authoritative `businesses` delete, the recursive Storage walk +
// purge, and the auth-user delete. Each call mirrors the live route's fail-loud
// vs best-effort behaviour exactly; the service composes them.

import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

export type RepoContext = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

// Child rows first (most also cascade from businesses; explicit for safety).
export const CASCADE_TABLES = [
  'communications',
  'tasks',
  'offers',
  'offer_response_tokens',
  'appointment_response_tokens',
  'customer_intake_tokens',
  'customer_upload_tokens',
  'customer_upload_sessions',
  'customers',
  'phone_number_requests',
  'business_subscriptions',
  'business_users',
] as const;

// Every uploaded customer file lives under `customer-uploads/<businessId>/…`
// (see buildUploadStoragePath). Storage objects are NOT covered by the Postgres
// FK cascade, so GDPR erasure must remove them explicitly. Supabase `.list()` is
// not recursive, so walk the (businessId → customerId → token → file) tree.
export async function collectStorageFiles(
  supabase: RepoContext['supabase'],
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 6) return []; // safety bound against unexpected nesting
  const out: string[] = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const entry of data) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase returns sub-folders as entries with a null id; files carry an id.
    if (entry.id === null) {
      out.push(...(await collectStorageFiles(supabase, bucket, full, depth + 1)));
    } else {
      out.push(full);
    }
  }
  return out;
}

export async function purgeBusinessStorage(
  supabase: RepoContext['supabase'],
  bucket: string,
  businessId: string,
): Promise<{ removed: number; failed: boolean }> {
  try {
    const paths = await collectStorageFiles(supabase, bucket, businessId);
    if (paths.length === 0) return { removed: 0, failed: false };
    let removed = 0;
    let failed = false;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) failed = true;
      else removed += chunk.length;
    }
    return { removed, failed };
  } catch {
    return { removed: 0, failed: true };
  }
}

/** Best-effort tenant-scoped delete of every child table. Swallows per-table failures. */
export async function deleteCascadeTables(ctx: RepoContext): Promise<void> {
  const db = tenantDb(ctx.supabase, ctx.businessId);
  for (const t of CASCADE_TABLES) {
    try {
      await db.from(t).delete();
    } catch {
      // table may not exist / not business-scoped — ignore (cascade covers it)
    }
  }
}

/**
 * Authoritative delete of the business row (cascades the rest). FAIL-LOUD: returns
 * true on success, false when the delete errors or throws. The `businesses` table's
 * PK *is* its id (no business_id column), so this targets `.eq('id', businessId)`
 * directly on the service client — NOT through tenantDb.
 */
export async function deleteBusinessRow(ctx: RepoContext): Promise<boolean> {
  try {
    const { error } = await ctx.supabase.from('businesses').delete().eq('id', ctx.businessId);
    if (error) return false;
  } catch {
    return false;
  }
  return true;
}

/** Delete the auth user. FAIL-LOUD: true on success, false on error/throw. */
export async function deleteAuthUser(ctx: RepoContext): Promise<boolean> {
  try {
    const { error } = await ctx.supabase.auth.admin.deleteUser(ctx.userId);
    if (error) return false;
  } catch {
    return false;
  }
  return true;
}
