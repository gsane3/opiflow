import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { recordAuditEvent } from '@/lib/server/audit';
import { createRateLimiter, clientKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const deleteLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });

// GDPR erasure: delete the caller's business + all associated data, then the
// auth user. Best-effort per table; the core PII (customers, comms, offers) is
// removed first, respecting FK order.
export async function POST(request: NextRequest) {
  const rl = await deleteLimiter.check(clientKey(request));
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, userId, businessId } = auth.ctx;

  await recordAuditEvent({ businessId, actorUserId: userId, action: 'account_delete' });

  // Child rows first, then customers, then business-scoped rows, then business.
  const tables = [
    'communications',
    'tasks',
    'offers',
    'offer_response_tokens',
    'appointment_response_tokens',
    'customer_intake_tokens',
    'customer_upload_tokens',
    'customers',
    'phone_number_requests',
    'business_subscriptions',
    'business_users',
  ];
  for (const t of tables) {
    try {
      await supabase.from(t).delete().eq('business_id', businessId);
    } catch {
      // table may not exist / not business-scoped — ignore
    }
  }
  try {
    await supabase.from('businesses').delete().eq('id', businessId);
  } catch {
    // ignore
  }
  try {
    await supabase.auth.admin.deleteUser(userId);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}
