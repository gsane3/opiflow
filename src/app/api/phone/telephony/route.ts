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
import { readTelephony, validateTelephony, writeTelephony } from '@/server/modules/phone/phone.service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const view = await readTelephony(supabase, businessId);
    return NextResponse.json(
      {
        ok: true,
        mode: view.mode,
        forwardingSourceNumber: view.forwardingSourceNumber,
        businessPhoneNumber: view.businessPhoneNumber,
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
  const validated = validateTelephony(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE });
  }
  const { mode, forwardingSourceNumber } = validated;

  try {
    const { error } = await writeTelephony(supabase, businessId, mode, forwardingSourceNumber);
    if (error) {
      return NextResponse.json({ ok: false, error: 'telephony_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, mode, forwardingSourceNumber }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'telephony_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
  }
}
