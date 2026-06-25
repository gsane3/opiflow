// GDPR account/business erasure — owner-gated cascade across tables + Storage.
//
// ADOPTED to the modular pattern (src/server/modules/account): thin adapter. The
// storage purge + per-table cascade + fail-loud business/auth-user deletes live in
// the service; the rate limit, owner gate, audit events and structured logs stay
// here (orchestration/observability). Responses are byte-identical: rate_limited
// (429), forbidden_owner_only (403), delete_failed (500), auth_delete_failed (500,
// dataDeleted:true), and { ok, storageRemoved, storagePurgeIncomplete } (200).

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser, assertOwner } from '@/server/core/http';
import { handleApiError } from '@/server/core/errors';
import { recordAuditEvent } from '@/lib/server/audit';
import { createRateLimiter, clientKey } from '@/lib/rate-limit';
import { log } from '@/lib/observability';
import { deleteAccount } from '@/server/modules/account/account.service';

export const runtime = 'nodejs';

const deleteLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });

export async function POST(request: NextRequest) {
  const rl = await deleteLimiter.check(clientKey(request));
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
    // Only the owner may erase the entire business + auth user.
    assertOwner(ctx);
  } catch (err) {
    return handleApiError(err);
  }
  const { userId, businessId } = ctx;

  await recordAuditEvent({ businessId, actorUserId: userId, action: 'account_delete' });

  const result = await deleteAccount(ctx, {
    onStoragePurgeIncomplete: ({ removed }) => {
      log.warn('account_delete_storage_purge_incomplete', { businessId, removed });
    },
  });

  if (result.kind === 'business_failed') {
    log.error('account_delete_business_failed', { businessId });
    await recordAuditEvent({ businessId, actorUserId: userId, action: 'account_delete_failed' });
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }

  if (result.kind === 'auth_failed') {
    // Data is deleted but the auth identity lingers — surface it so it can be retried.
    log.error('account_delete_auth_user_failed', { businessId, userId });
    return NextResponse.json({ ok: false, error: 'auth_delete_failed', dataDeleted: true }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    storageRemoved: result.storageRemoved,
    storagePurgeIncomplete: result.storagePurgeIncomplete,
  });
}
