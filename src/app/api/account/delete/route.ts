import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { recordAuditEvent } from '@/lib/server/audit';
import { createRateLimiter, clientKey } from '@/lib/rate-limit';
import { UPLOAD_BUCKET } from '@/lib/server/upload-tokens';
import { log } from '@/lib/observability';

export const runtime = 'nodejs';

const deleteLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });

// Every uploaded customer file lives under `customer-uploads/<businessId>/…`
// (see buildUploadStoragePath). Storage objects are NOT covered by the Postgres
// FK cascade, so GDPR erasure must remove them explicitly. Supabase `.list()` is
// not recursive, so walk the (businessId → customerId → token → file) tree.
async function collectStorageFiles(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  depth = 0
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

async function purgeBusinessStorage(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ removed: number; failed: boolean }> {
  try {
    const paths = await collectStorageFiles(supabase, UPLOAD_BUCKET, businessId);
    if (paths.length === 0) return { removed: 0, failed: false };
    let removed = 0;
    let failed = false;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove(chunk);
      if (error) failed = true;
      else removed += chunk.length;
    }
    return { removed, failed };
  } catch {
    return { removed: 0, failed: true };
  }
}

// GDPR erasure: delete the caller's customer-uploaded media + all business data,
// then the auth user. Most relational tables ON DELETE CASCADE from businesses,
// so deleting the business row removes them; the explicit per-table pass below is
// a belt-and-suspenders for any without a cascade. The authoritative deletes
// (businesses, auth user) are now FAIL-LOUD: a failure returns ok:false instead
// of pretending success.
export async function POST(request: NextRequest) {
  const rl = await deleteLimiter.check(clientKey(request));
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  // Only the owner may erase the entire business + auth user.
  const denied = requireOwner(auth.ctx);
  if (denied) return denied;
  const { supabase, userId, businessId } = auth.ctx;

  await recordAuditEvent({ businessId, actorUserId: userId, action: 'account_delete' });

  // 1) Purge uploaded customer media from Storage (not covered by FK cascade).
  const storage = await purgeBusinessStorage(supabase, businessId);
  if (storage.failed) {
    log.warn('account_delete_storage_purge_incomplete', { businessId, removed: storage.removed });
  }

  // 2) Child rows first (most also cascade from businesses; explicit for safety).
  const tables = [
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
  ];
  for (const t of tables) {
    try {
      await supabase.from(t).delete().eq('business_id', businessId);
    } catch {
      // table may not exist / not business-scoped — ignore (cascade covers it)
    }
  }

  // 3) Authoritative delete of the business row (cascades the rest). FAIL-LOUD.
  let coreFailed = false;
  try {
    const { error } = await supabase.from('businesses').delete().eq('id', businessId);
    if (error) coreFailed = true;
  } catch {
    coreFailed = true;
  }
  if (coreFailed) {
    log.error('account_delete_business_failed', { businessId });
    await recordAuditEvent({ businessId, actorUserId: userId, action: 'account_delete_failed' });
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }

  // 4) Delete the auth user last (after their data is gone). FAIL-LOUD.
  let authFailed = false;
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) authFailed = true;
  } catch {
    authFailed = true;
  }
  if (authFailed) {
    // Data is deleted but the auth identity lingers — surface it so it can be retried.
    log.error('account_delete_auth_user_failed', { businessId, userId });
    return NextResponse.json({ ok: false, error: 'auth_delete_failed', dataDeleted: true }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    storageRemoved: storage.removed,
    storagePurgeIncomplete: storage.failed,
  });
}
