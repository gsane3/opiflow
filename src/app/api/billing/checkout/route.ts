import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { isStripeConfigured } from '@/lib/billing/stripe';
import { startCheckout } from '@/server/modules/billing/billing.service';

export const runtime = 'nodejs';

// Per-tier ANNUAL Stripe prices (s44 packaging). Absent env → the tier isn't
// sellable yet and requesting it is billing_not_configured; no plan in the body
// → the legacy monthly plan, byte-identical to before.
function tierPriceId(plan: string): string | undefined {
  if (plan === 'base') return process.env.STRIPE_PRICE_ID_BASE;
  if (plan === 'premium') return process.env.STRIPE_PRICE_ID_PREMIUM;
  return undefined;
}

// Creates a Stripe Checkout subscription session for the caller's business.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  // Billing is owner-only.
  const denied = requireOwner(auth.ctx);
  if (denied) return denied;
  const { businessId } = auth.ctx;

  let plan: string | null = null;
  try {
    const body = (await request.json()) as { plan?: unknown };
    if (body && (body.plan === 'base' || body.plan === 'premium')) plan = body.plan;
  } catch {
    // no/invalid body → legacy plan (the pre-tier client sends none)
  }

  const priceId = plan ? tierPriceId(plan) : process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });
  }

  const origin = request.headers.get('origin') ?? 'https://opiflow.ai';
  const result = await startCheckout({
    priceId,
    businessId,
    origin,
    ...(plan ? { plan } : {}),
  });
  if (result.kind !== 'ok') {
    return NextResponse.json({ ok: false, error: 'checkout_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
