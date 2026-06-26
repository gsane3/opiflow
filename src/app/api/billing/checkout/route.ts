import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { isStripeConfigured } from '@/lib/billing/stripe';
import { startCheckout } from '@/server/modules/billing/billing.service';

export const runtime = 'nodejs';

// Creates a Stripe Checkout subscription session for the caller's business.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured() || !process.env.STRIPE_PRICE_ID) {
    return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  // Billing is owner-only.
  const denied = requireOwner(auth.ctx);
  if (denied) return denied;
  const { businessId } = auth.ctx;

  const origin = request.headers.get('origin') ?? 'https://opiflow.ai';
  const result = await startCheckout({
    priceId: process.env.STRIPE_PRICE_ID,
    businessId,
    origin,
  });
  if (result.kind !== 'ok') {
    return NextResponse.json({ ok: false, error: 'checkout_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
