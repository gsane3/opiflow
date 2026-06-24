import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyStripeSignature } from '@/lib/billing/stripe';
import { PLAN } from '@/lib/billing/plans';
import { log } from '@/lib/observability';

export const runtime = 'nodejs';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// Idempotent upsert keyed on the business_subscriptions.business_id UNIQUE. If no
// row exists yet (e.g. the webhook raced ahead of signup), insert one. Returns
// false on any DB error so the caller can force Stripe to retry.
async function applySubscription(
  supabase: SupabaseServer,
  businessId: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from('business_subscriptions')
    .update(fields)
    .eq('business_id', businessId)
    .select('id');
  if (error) return false;
  if (Array.isArray(data) && data.length > 0) return true;
  const { error: insErr } = await supabase
    .from('business_subscriptions')
    .insert({ business_id: businessId, plan_key: PLAN.key, ...fields });
  return !insErr;
}

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
  // On a checkout session `subscription` holds the sub id; on a subscription
  // object the id IS `obj.id`.
  const subscriptionId =
    typeof obj.subscription === 'string' ? obj.subscription : typeof obj.id === 'string' ? obj.id : null;

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

  const now = new Date().toISOString();
  let ok = true;

  if (event.type === 'checkout.session.completed') {
    ok = await applySubscription(supabase, businessId, {
      status: 'active',
      billing_provider: 'stripe',
      billing_ref: subscriptionId,
      updated_at: now,
    });
  } else if (event.type === 'customer.subscription.updated') {
    const s = typeof obj.status === 'string' ? obj.status : '';
    if (s === 'active' || s === 'trialing') {
      ok = await applySubscription(supabase, businessId, {
        status: 'active',
        billing_provider: 'stripe',
        billing_ref: subscriptionId,
        updated_at: now,
      });
    } else if (s === 'canceled' || s === 'unpaid' || s === 'incomplete_expired') {
      ok = await applySubscription(supabase, businessId, {
        status: 'cancelled',
        cancelled_at: now,
        updated_at: now,
      });
    }
    // transient states (past_due, incomplete) are left unchanged in this slice
  } else if (event.type === 'customer.subscription.deleted') {
    ok = await applySubscription(supabase, businessId, {
      status: 'cancelled',
      cancelled_at: now,
      updated_at: now,
    });
  }

  if (!ok) {
    log.error('stripe_subscription_write_failed', { type: event.type, businessId });
    return NextResponse.json({ ok: false, error: 'db_write_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
