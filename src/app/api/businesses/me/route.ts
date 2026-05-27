import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const PATCH_VALID_TYPES = ['technical_services', 'sales_services', 'projects_construction', 'other'] as const;
const PATCH_VALID_CONTACT_METHODS = ['phone', 'email', 'viber'] as const;

function patchStr(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const { data: business, error: queryError } = await supabase
      .from('businesses')
      .select(
        'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, created_at, updated_at'
      )
      .eq('owner_id', user.id)
      .maybeSingle();

    if (queryError) {
      return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500 });
    }

    if (!business) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const biz = business as Record<string, unknown>;
    const bizId = biz.id as string;

    const { data: subRow, error: subError } = await supabase
      .from('business_subscriptions')
      .select('plan_key, status, trial_ends_at')
      .eq('business_id', bizId)
      .maybeSingle();

    if (subError) {
      console.error('[api/businesses/me] subscription query failed', {
        code:        subError.code,
        message:     subError.message,
        bizIdPrefix: bizId.slice(0, 8),
      });
      return NextResponse.json(
        { ok: false, error: 'subscription_query_failed' },
        { status: 500 }
      );
    }

    const ALLOWED_STATUSES = ['pending_manual_review', 'trialing', 'active'];
    const sub = subRow as {
      plan_key: string;
      status: string;
      trial_ends_at: string | null;
    } | null;
    const activationAllowed = sub !== null && ALLOWED_STATUSES.includes(sub.status);

    const subscription = sub
      ? {
          plan_key:      sub.plan_key,
          status:        sub.status,
          trial_ends_at: sub.trial_ends_at ?? null,
        }
      : null;

    // Query the latest pending phone number request for this business.
    const { data: reqRow, error: requestError } = await supabase
      .from('phone_number_requests')
      .select('status, requested_city, created_at')
      .eq('business_id', bizId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestError) {
      console.error('[api/businesses/me] number request query failed', {
        code:        requestError.code,
        message:     requestError.message,
        bizIdPrefix: bizId.slice(0, 8),
      });
      return NextResponse.json(
        { ok: false, error: 'number_request_query_failed' },
        { status: 500 }
      );
    }

    const req = reqRow as {
      status:         string;
      requested_city: string | null;
      created_at:     string;
    } | null;
    const numberRequest = req
      ? {
          status:        req.status,
          requestedCity: req.requested_city ?? null,
          createdAt:     req.created_at,
        }
      : null;

    return NextResponse.json({
      ok: true,
      business,
      phoneAssigned:
        typeof biz.business_phone_number === 'string' && biz.business_phone_number.length > 0,
      activationAllowed,
      subscription,
      numberRequest,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
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

    // name is required and must not be blank.
    const name = patchStr(raw.name);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'invalid_name' }, { status: 400 });
    }

    // type is required and must be a recognised business type.
    const type = patchStr(raw.type);
    if (!type || !(PATCH_VALID_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400 });
    }

    // preferred_contact_method is required and must be a recognised method.
    const preferredContactMethod = patchStr(raw.preferred_contact_method);
    if (!preferredContactMethod || !(PATCH_VALID_CONTACT_METHODS as readonly string[]).includes(preferredContactMethod)) {
      return NextResponse.json({ ok: false, error: 'invalid_contact_method' }, { status: 400 });
    }

    // default_vat_rate must be a finite number in [0, 100].
    let defaultVatRate: number | undefined;
    if (raw.default_vat_rate !== undefined && raw.default_vat_rate !== null) {
      const n = Number(raw.default_vat_rate);
      if (!isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ ok: false, error: 'invalid_vat_rate' }, { status: 400 });
      }
      defaultVatRate = n;
    }

    // Verify the business exists and belongs to this user.
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    // Build the update payload. Only editable profile fields are accepted.
    // Sensitive and system fields (owner_id, business_phone_number, logo_url,
    // subscription fields, etc.) are never included.
    const updates: Record<string, unknown> = {
      name,
      type,
      preferred_contact_method: preferredContactMethod,
      phone:                    patchStr(raw.phone),
      email:                    patchStr(raw.email),
      address:                  patchStr(raw.address),
      city:                     patchStr(raw.city),
      vat_number:               patchStr(raw.vat_number),
      tax_office:               patchStr(raw.tax_office),
      default_offer_terms:      patchStr(raw.default_offer_terms),
      default_acceptance_text:  patchStr(raw.default_acceptance_text),
      updated_at:               new Date().toISOString(),
    };
    if (defaultVatRate !== undefined) {
      updates.default_vat_rate = defaultVatRate;
    }

    const { data: updatedBusiness, error: updateError } = await supabase
      .from('businesses')
      .update(updates)
      .eq('owner_id', user.id)
      .select(
        'id, owner_id, name, type, phone, email, address, city, vat_number, tax_office, logo_url, default_vat_rate, default_offer_terms, default_acceptance_text, preferred_contact_method, business_phone_number, created_at, updated_at'
      )
      .single();

    if (updateError || !updatedBusiness) {
      console.error('[api/businesses/me PATCH] update failed', {
        code:         updateError?.code,
        message:      updateError?.message,
        userIdPrefix: user.id.slice(0, 8),
      });
      return NextResponse.json({ ok: false, error: 'business_update_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, business: updatedBusiness });
  } catch {
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }
}
