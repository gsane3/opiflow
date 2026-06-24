import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { createPortalSession, findCustomerIdByEmail, isStripeConfigured } from '@/lib/billing/stripe';

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
  const { supabase, userId } = auth.ctx;

  let email: string | null = null;
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
  } catch {
    // ignore
  }
  if (!email) return NextResponse.json({ ok: false, error: 'no_email' }, { status: 400 });

  const customerId = await findCustomerIdByEmail(email);
  if (!customerId) return NextResponse.json({ ok: false, error: 'no_customer' }, { status: 404 });

  const origin = request.headers.get('origin') ?? 'https://opiflow.ai';
  const result = await createPortalSession({ customerId, returnUrl: `${origin}/settings` });
  if (!result.ok || typeof result.data.url !== 'string') {
    return NextResponse.json({ ok: false, error: 'portal_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.data.url });
}
