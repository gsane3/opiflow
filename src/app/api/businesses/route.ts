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

    // postal_code must be exactly 5 digits if provided.
    const postalCodeVal = str(raw.postal_code);
    if (postalCodeVal !== null && !/^\d{5}$/.test(postalCodeVal)) {
      return NextResponse.json({ ok: false, error: 'invalid_postal_code' }, { status: 400 });
    }

    // website must start with http:// or https:// if provided.
    const websiteVal = str(raw.website);
    if (websiteVal !== null && !/^https?:\/\/.+/.test(websiteVal)) {
      return NextResponse.json({ ok: false, error: 'invalid_website' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // Package and voucher validation
    // -------------------------------------------------------------------------

    // packageKey is required. Normalized to lowercase, max 50 chars.
    const rawPackageKey = raw['packageKey'];
    if (typeof rawPackageKey !== 'string' || !rawPackageKey.trim()) {
      return NextResponse.json({ ok: false, error: 'invalid_package' }, { status: 400 });
    }
    const packageKey = rawPackageKey.trim().toLowerCase().slice(0, 50);
    if (!/^[a-z0-9_-]{1,50}$/.test(packageKey)) {
      return NextResponse.json({ ok: false, error: 'invalid_package' }, { status: 400 });
    }

    // voucherCode is optional. Trimmed, max 50 chars.
    let voucherCode: string | null = null;
    const rawVoucherCode = raw['voucherCode'];
    if (rawVoucherCode !== undefined && rawVoucherCode !== null) {
      if (typeof rawVoucherCode !== 'string') {
        return NextResponse.json({ ok: false, error: 'invalid_voucher' }, { status: 400 });
      }
      const trimmedVoucher = rawVoucherCode.trim();
      if (trimmedVoucher.length > 50) {
        return NextResponse.json({ ok: false, error: 'invalid_voucher' }, { status: 400 });
      }
      if (trimmedVoucher.length > 0) {
        voucherCode = trimmedVoucher;
      }
    }

    // Validate packageKey against active package_plans.
    const { data: planRow, error: planQueryError } = await supabase
      .from('package_plans')
      .select('plan_key')
      .eq('plan_key', packageKey)
      .eq('active', true)
      .maybeSingle();

    if (planQueryError || !planRow) {
      return NextResponse.json({ ok: false, error: 'invalid_package' }, { status: 400 });
    }

    // Validate voucherCode if provided.
    type ValidVoucher = { id: string; voucher_type: string; current_redemptions: number };
    let validVoucher: ValidVoucher | null = null;

    if (voucherCode !== null) {
      const { data: voucherRow, error: voucherQueryError } = await supabase
        .from('voucher_codes')
        .select('id, voucher_type, active, max_redemptions, current_redemptions, expires_at')
        .eq('code', voucherCode)
        .maybeSingle();

      type VoucherRow = {
        id:                  string;
        voucher_type:        string;
        active:              boolean;
        max_redemptions:     number | null;
        current_redemptions: number;
        expires_at:          string | null;
      };
      const vr = voucherRow as unknown as VoucherRow | null;

      if (voucherQueryError || !vr || !vr.active) {
        return NextResponse.json({ ok: false, error: 'invalid_voucher' }, { status: 400 });
      }
      if (vr.expires_at !== null && new Date(vr.expires_at) < new Date()) {
        return NextResponse.json({ ok: false, error: 'expired_voucher' }, { status: 400 });
      }
      if (vr.max_redemptions !== null && vr.current_redemptions >= vr.max_redemptions) {
        return NextResponse.json({ ok: false, error: 'invalid_voucher' }, { status: 400 });
      }

      validVoucher = {
        id:                  vr.id,
        voucher_type:        vr.voucher_type,
        current_redemptions: vr.current_redemptions,
      };
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
        legal_name:       str(raw.legal_name),
        trade_name:       str(raw.trade_name),
        owner_first_name: str(raw.owner_first_name),
        owner_last_name:  str(raw.owner_last_name),
        address_line1:    str(raw.address_line1),
        address_line2:    str(raw.address_line2),
        postal_code:      postalCodeVal,
        region:           str(raw.region),
        website:          websiteVal,
      })
      .select(
        'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, legal_name, trade_name, owner_first_name, owner_last_name, address_line1, address_line2, postal_code, region, website, created_at, updated_at'
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

    // Insert business_subscriptions row.
    // No Stripe or payment provider in this slice. Status reflects whether
    // a valid voucher was used (trialing) or not (pending_manual_review).
    const subscriptionStatus: string =
      validVoucher !== null ? 'trialing' : 'pending_manual_review';

    await supabase.from('business_subscriptions').insert({
      business_id:     bizId,
      plan_key:        packageKey,
      status:          subscriptionStatus,
      voucher_code_id: validVoucher !== null ? validVoucher.id : null,
    });

    // If a valid voucher was used, record the redemption and increment counter.
    // The counter update is not atomic at this scale; acceptable for MVP.
    if (validVoucher !== null) {
      await supabase.from('voucher_redemptions').insert({
        voucher_code_id: validVoucher.id,
        user_id:         user.id,
        business_id:     bizId,
      });
      await supabase
        .from('voucher_codes')
        .update({
          current_redemptions: validVoucher.current_redemptions + 1,
          updated_at:          new Date().toISOString(),
        })
        .eq('id', validVoucher.id);
    }

    const phoneResult = await assignPhoneNumber(supabase, bizId, cityVal);

    // If no number was assigned from the pool, record a pending request so the
    // admin can fulfil the assignment manually. Non-fatal: business creation
    // succeeds regardless of whether this insert succeeds.
    let numberRequest: { status: string; requestedCity: string | null } | null = null;
    if (!phoneResult.assigned) {
      try {
        const { error: reqInsertError } = await supabase
          .from('phone_number_requests')
          .insert({
            business_id:    bizId,
            requested_city: cityVal ?? null,
            source:         'onboarding',
            status:         'pending',
          });
        if (!reqInsertError) {
          numberRequest = { status: 'pending', requestedCity: cityVal ?? null };
        }
      } catch {
        // Non-fatal: pending request creation does not block business creation.
      }
    }

    return NextResponse.json({
      ok: true,
      business: {
        ...(business as Record<string, unknown>),
        business_phone_number: phoneResult.assigned ? phoneResult.e164Number : null,
      },
      phoneAssigned:      phoneResult.assigned,
      subscriptionStatus,
      ...(numberRequest !== null ? { numberRequest } : {}),
    }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: 'business_create_failed' }, { status: 500 });
  }
}
