import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

    const { data: subRow } = await supabase
      .from('business_subscriptions')
      .select('plan_key, status, trial_ends_at')
      .eq('business_id', bizId)
      .maybeSingle();

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

    return NextResponse.json({
      ok: true,
      business,
      phoneAssigned:
        typeof biz.business_phone_number === 'string' && biz.business_phone_number.length > 0,
      activationAllowed,
      subscription,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'business_route_failed' }, { status: 500 });
  }
}
