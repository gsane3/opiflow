// GET/PUT /api/phone/telephony
//
// The business's telephony onboarding model for the user's existing number:
//   'native'  = Model B: use the assigned Opiflow number only.
//   'forward' = Model A: keep own number, divert (call-forward) it to the Opiflow number.
//
// Stored on businesses.telephony_mode / forwarding_source_number. Defensive: if
// migration 031 has not been applied, GET returns nulls and PUT no-ops with
// degraded:true (never 500s, so settings keeps rendering).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

const VALID = ['native', 'forward'] as const;
type Mode = (typeof VALID)[number];
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { data } = await supabase
      .from('businesses')
      .select('telephony_mode, forwarding_source_number, business_phone_number')
      .eq('id', businessId)
      .maybeSingle();
    const row =
      (data as {
        telephony_mode?: string | null;
        forwarding_source_number?: string | null;
        business_phone_number?: string | null;
      } | null) ?? {};
    return NextResponse.json(
      {
        ok: true,
        mode: row.telephony_mode ?? null,
        forwardingSourceNumber: row.forwarding_source_number ?? null,
        businessPhoneNumber: row.business_phone_number ?? null,
      },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { ok: true, mode: null, forwardingSourceNumber: null, businessPhoneNumber: null, degraded: true },
      { headers: NO_STORE }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  let body: { mode?: string; forwardingSourceNumber?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  const mode = (body.mode ?? '').trim();
  if (!VALID.includes(mode as Mode)) {
    return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400, headers: NO_STORE });
  }
  const src =
    typeof body.forwardingSourceNumber === 'string'
      ? body.forwardingSourceNumber.replace(/[^\d+]/g, '').slice(0, 24)
      : null;
  const forwardingSourceNumber = mode === 'forward' ? src || null : null;

  try {
    const { error } = await supabase
      .from('businesses')
      .update({
        telephony_mode: mode,
        forwarding_source_number: forwardingSourceNumber,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId);
    if (error) {
      return NextResponse.json({ ok: false, error: 'telephony_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, mode, forwardingSourceNumber }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'telephony_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
  }
}
