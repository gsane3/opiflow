// Dependency-free Stripe helper (REST + fetch). Env-gated on STRIPE_SECRET_KEY.
// Webhook signatures are verified with Node crypto. See docs/PRODUCTION_ROADMAP.md.

import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function form(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.append(k, v);
  return sp.toString();
}

interface StripeResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

async function stripePost(path: string, body: string): Promise<StripeResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, status: 503, data: { error: 'stripe_not_configured' } };
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function createCheckoutSession(opts: {
  priceId: string;
  customerEmail?: string;
  businessId: string;
  successUrl: string;
  cancelUrl: string;
  /** Optional discriminator stamped on the session AND the subscription metadata
   *  (e.g. 'invoicing_addon') so the webhook can route a second subscription type
   *  without touching the main-plan path. Unset → a normal plan checkout. */
  kind?: string;
  plan?: string;
}): Promise<StripeResult> {
  return stripePost(
    '/checkout/sessions',
    form({
      mode: 'subscription',
      'line_items[0][price]': opts.priceId,
      'line_items[0][quantity]': '1',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      customer_email: opts.customerEmail,
      'metadata[businessId]': opts.businessId,
      'subscription_data[metadata][businessId]': opts.businessId,
      'metadata[kind]': opts.kind,
      'subscription_data[metadata][kind]': opts.kind,
      // Tier discriminator (base/premium) — undefined for the legacy plan, so
      // form() skips it and the classic checkout stays byte-identical.
      'metadata[plan]': opts.plan,
      'subscription_data[metadata][plan]': opts.plan,
      allow_promotion_codes: 'true',
    })
  );
}

export async function createPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<StripeResult> {
  return stripePost(
    '/billing_portal/sessions',
    form({ customer: opts.customerId, return_url: opts.returnUrl })
  );
}

/** Find a Stripe customer id by email (avoids storing it locally for the portal). */
export async function findCustomerIdByEmail(email: string): Promise<string | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const q = encodeURIComponent(`email:'${email}'`);
  const res = await fetch(`${STRIPE_API}/customers/search?query=${q}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
  return data.data?.[0]?.id ?? null;
}

/** Verify a Stripe webhook signature (HMAC-SHA256 over `${t}.${payload}`). */
export function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string
): boolean {
  if (!sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const piece of sigHeader.split(',')) {
    const idx = piece.indexOf('=');
    if (idx > 0) parts[piece.slice(0, idx)] = piece.slice(idx + 1);
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}
