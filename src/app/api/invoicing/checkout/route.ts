import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, requireOwner } from '@/lib/api/auth';
import { isInvoicingAddonConfigured, startAddonCheckout } from '@/server/modules/invoicing/invoicing-addon.service';

export const runtime = 'nodejs';

// Creates a Stripe Checkout subscription session for the optional invoicing add-on
// (the monthly fee that bills the AADE/myDATA feature). Owner-only. Dormant (503)
// until STRIPE_INVOICING_PRICE_ID + Stripe are configured.
export async function POST(request: NextRequest) {
  if (!isInvoicingAddonConfigured()) {
    return NextResponse.json({ ok: false, error: 'addon_not_configured' }, { status: 503 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const denied = requireOwner(auth.ctx);
  if (denied) return denied;

  const origin = request.headers.get('origin') ?? 'https://opiflow.ai';
  const result = await startAddonCheckout({ businessId: auth.ctx.businessId, origin });
  if (result.kind !== 'ok') {
    return NextResponse.json({ ok: false, error: 'checkout_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
