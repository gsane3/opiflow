import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { assignPhoneNumber } from '@/lib/server/phone-number-pool';

const VALID_TYPES = ['technical_services', 'sales_services', 'projects_construction', 'other'] as const;
const VALID_CONTACT_METHODS = ['phone', 'email', 'viber'] as const;

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    const name = str(raw.name);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }

    const type = str(raw.type);
    if (type !== null && !(VALID_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }

    const preferredContactMethod = str(raw.preferred_contact_method)
      ?? 'phone';
    if (!(VALID_CONTACT_METHODS as readonly string[]).includes(preferredContactMethod)) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }

    // Validate city (optional, max 100 chars)
    const cityVal = str(raw.city);
    if (cityVal !== null && cityVal.length > 100) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }

    const rawVatRate = raw.default_vat_rate;
    let defaultVatRate = 24;
    if (rawVatRate !== undefined && rawVatRate !== null) {
      const n = Number(rawVatRate);
      if (!isFinite(n)) {
        return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
      }
      defaultVatRate = n;
    }

    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: false, error: 'business_already_exists' }, { status: 409 });
    }

    const { data: business, error: insertError } = await supabase
      .from('businesses')
      .insert({
        owner_id: user.id,
        name,
        type: type ?? null,
        phone: str(raw.phone),
        email: str(raw.email),
        address: str(raw.address),
        city: cityVal,
        vat_number: str(raw.vat_number),
        tax_office: str(raw.tax_office),
        default_vat_rate: defaultVatRate,
        default_offer_terms: str(raw.default_offer_terms),
        default_acceptance_text: str(raw.default_acceptance_text),
        preferred_contact_method: preferredContactMethod,
      })
      .select(
        'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, created_at, updated_at'
      )
      .single();

    if (insertError || !business) {
      return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
    }

    const { error: memberError } = await supabase
      .from('business_users')
      .insert({
        business_id: business.id,
        user_id: user.id,
        role: 'owner',
        accepted_at: new Date().toISOString(),
      });

    if (memberError) {
      await supabase.from('businesses').delete().eq('id', business.id);
      return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
    }

    const bizId = (business as unknown as { id: string }).id;
    const phoneResult = await assignPhoneNumber(supabase, bizId, cityVal);

    return NextResponse.json({
      ok: true,
      business: {
        ...(business as Record<string, unknown>),
        business_phone_number: phoneResult.assigned ? phoneResult.e164Number : null,
      },
      phoneAssigned: phoneResult.assigned,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
  }
}
