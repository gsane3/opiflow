import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyStripeSignature } from '@/lib/billing/stripe';

export const runtime = 'nodejs';

// Stripe webhook: activates/cancels the business subscription on payment events.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }

  const payload = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!verifyStripeSignature(payload, sig, secret)) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const obj = event.data?.object ?? {};
  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
  const businessId = typeof metadata.businessId === 'string' ? metadata.businessId : null;

  if (businessId) {
    try {
      const supabase = createServerSupabaseClient();
      if (event.type === 'checkout.session.completed') {
        await supabase.from('business_subscriptions').update({ status: 'active' }).eq('business_id', businessId);
      } else if (event.type === 'customer.subscription.deleted') {
        await supabase.from('business_subscriptions').update({ status: 'cancelled' }).eq('business_id', businessId);
      }
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({ received: true });
}
