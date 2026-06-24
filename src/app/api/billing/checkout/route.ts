import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { createCheckoutSession, isStripeConfigured } from '@/lib/billing/stripe';

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
  const result = await createCheckoutSession({
    priceId: process.env.STRIPE_PRICE_ID,
    businessId,
    successUrl: `${origin}/settings?billing=success`,
    cancelUrl: `${origin}/settings?billing=cancelled`,
  });
  if (!result.ok || typeof result.data.url !== 'string') {
    return NextResponse.json({ ok: false, error: 'checkout_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.data.url });
}
