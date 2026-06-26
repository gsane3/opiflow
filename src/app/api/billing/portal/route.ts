import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { isStripeConfigured } from '@/lib/billing/stripe';
import { startPortal } from '@/server/modules/billing/billing.service';

export const runtime = 'nodejs';

// Opens the Stripe customer billing portal for the caller (manage/cancel plan).
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  // Billing is owner-only (manage/cancel the subscription).
  const denied = requireOwner(auth.ctx);
  if (denied) return denied;
  const { supabase, userId, businessId } = auth.ctx;

  const origin = request.headers.get('origin') ?? 'https://opiflow.ai';
  const result = await startPortal({ supabase, userId, businessId, origin });
  if (result.kind === 'no_email') {
    return NextResponse.json({ ok: false, error: 'no_email' }, { status: 400 });
  }
  if (result.kind === 'no_customer') {
    return NextResponse.json({ ok: false, error: 'no_customer' }, { status: 404 });
  }
  if (result.kind !== 'ok') {
    return NextResponse.json({ ok: false, error: 'portal_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
