import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyStripeSignature } from '@/lib/billing/stripe';
import { PLAN } from '@/lib/billing/plans';
import { log } from '@/lib/observability';
import { applyStripeEvent } from '@/server/modules/webhooks-other/webhooks-other.service';

export const runtime = 'nodejs';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// Stripe webhook: activates/cancels the business subscription on payment events.
// Hardened (audit P0-7): idempotent upsert with row-count, persists the Stripe
// linkage (billing_provider/billing_ref), handles subscription.updated/deleted +
// payment_failed, and returns a non-2xx on DB failure so Stripe RETRIES instead
// of the event being silently dropped.
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

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const obj = event.data?.object ?? {};
  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
  const businessId = typeof metadata.businessId === 'string' ? metadata.businessId : null;

  const HANDLED = new Set([
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
  ]);
  // Unhandled event types: acknowledge so Stripe stops retrying.
  if (!event.type || !HANDLED.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  // Renewal failure: there is no past_due state in this slice (added with the
  // entitlement model migration) — surface for monitoring only for now.
  if (event.type === 'invoice.payment_failed') {
    log.warn('stripe_invoice_payment_failed', { businessId });
    return NextResponse.json({ received: true });
  }

  if (!businessId) {
    log.warn('stripe_event_without_businessId', { type: event.type });
    return NextResponse.json({ received: true });
  }

  let supabase: SupabaseServer;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'config' }, { status: 503 });
  }

  const ok = await applyStripeEvent(supabase, event, businessId, PLAN.key);

  if (!ok) {
    log.error('stripe_subscription_write_failed', { type: event.type, businessId });
    return NextResponse.json({ ok: false, error: 'db_write_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
