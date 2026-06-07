import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  isSipProvisioningEnabled,
  encryptSecret,
  decryptSecret,
  generateSipPassword,
} from '@/lib/server/sip-credentials';

export const runtime = 'nodejs';

// GET /api/phone/browser-token
//
// Returns browser SIP credentials for the authenticated user's business.
//
// Two modes, chosen automatically:
//   A) PER-USER (multi-tenant): enabled once SIP_CRED_ENC_KEY is set (i.e. the
//      Asterisk per-user endpoints are provisioned). Each business is issued its
//      OWN SIP credential — username is the deterministic biz_<id> created by
//      ensure_browser_sip_endpoint; the password is generated on first use and
//      stored AES-256-GCM encrypted in browser_sip_endpoints.sip_password_enc.
//   B) SHARED ENV (default / current behaviour): credentials come from
//      PHONE_SIP_WSS_URL, PHONE_SIP_USERNAME, PHONE_SIP_PASSWORD, PHONE_SIP_REALM.
//
// The per-user path is fully fail-safe: ANY error (table not migrated, no key,
// decrypt failure, etc.) falls through to the shared-env path, so the existing
// line keeps working until the Asterisk side is ready.
//
// Gate logic (unchanged):
//   1. Bearer token required.
//   2. Supabase getUser(token) must succeed.
//   3. Business must exist (owner_id match).
//   4. business.business_phone_number must be set (the "number assigned" gate).
//   5. Subscription must allow activation.
//   6. ensure_browser_sip_endpoint is called best-effort.
//
// sipPassword is returned only after all auth/business checks pass. It is never
// logged or included in error responses.

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

/**
 * Resolves the business's own SIP credential, generating + persisting an
 * encrypted password on first use. Returns null on any failure (caller then
 * falls back to shared env credentials).
 */
async function resolvePerUserCredential(
  supabase: SupabaseServer,
  businessId: string
): Promise<{ sipUsername: string; sipPassword: string } | null> {
  const { data: rows, error } = await supabase
    .from('browser_sip_endpoints')
    .select('id, sip_username, sip_password_enc, status')
    .eq('business_id', businessId)
    .neq('status', 'revoked')
    .limit(1);

  if (error || !rows || rows.length === 0) return null;
  const row = rows[0] as {
    id: string;
    sip_username: string | null;
    sip_password_enc: string | null;
    status: string;
  };
  if (!row.sip_username) return null;

  // Reuse the existing password, or mint + persist one on first use.
  let plaintext: string | null = row.sip_password_enc ? decryptSecret(row.sip_password_enc) : null;
  if (!plaintext) {
    plaintext = generateSipPassword();
    const enc = encryptSecret(plaintext);
    const { error: upErr } = await supabase
      .from('browser_sip_endpoints')
      .update({
        sip_password_enc: enc,
        sip_password_set_at: new Date().toISOString(),
        status: 'active',
        wss_url: process.env.PHONE_SIP_WSS_URL?.trim() || null,
        sip_realm: process.env.PHONE_SIP_REALM?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (upErr) return null;
  }

  return { sipUsername: row.sip_username, sipPassword: plaintext };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401, headers: NO_STORE });
  }
  const token = authHeader.slice(7);

  let supabase: SupabaseServer;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: 'phone_token_route_failed' }, { status: 500, headers: NO_STORE });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401, headers: NO_STORE });
    }

    // Resolve the user's business.
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, business_phone_number')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (businessError) {
      return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500, headers: NO_STORE });
    }
    if (!business) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404, headers: NO_STORE });
    }

    // Gate: business must have an assigned phone number.
    if (!business.business_phone_number) {
      return NextResponse.json({ ok: false, error: 'no_number_assigned' }, { status: 409, headers: NO_STORE });
    }

    // Gate: subscription must allow access (pending_manual_review, trialing, or active).
    const { data: subRow } = await supabase
      .from('business_subscriptions')
      .select('status')
      .eq('business_id', business.id)
      .maybeSingle();

    const subStatus = subRow ? (subRow as { status: string }).status : null;
    const activationAllowed =
      subStatus !== null && ['pending_manual_review', 'trialing', 'active'].includes(subStatus);

    if (!activationAllowed) {
      return NextResponse.json(
        { ok: false, ready: false, error: 'activation_required', message: 'activation_required' },
        { status: 403, headers: NO_STORE }
      );
    }

    // Best-effort: create/refresh the per-business browser SIP endpoint row.
    try {
      await supabase.rpc('ensure_browser_sip_endpoint', {
        p_business_id: business.id,
        p_user_id: user.id,
      });
    } catch {
      // Bookkeeping only; credential delivery does not depend on it.
    }

    const sipWssUrl = process.env.PHONE_SIP_WSS_URL?.trim() || null;
    const sipRealm = process.env.PHONE_SIP_REALM?.trim() || null;

    // --- Mode A: per-user credential (enabled once SIP_CRED_ENC_KEY is set) ---
    // Any failure falls through to the shared-env path below.
    if (isSipProvisioningEnabled() && sipWssUrl) {
      try {
        const perUser = await resolvePerUserCredential(supabase, business.id);
        if (perUser) {
          return NextResponse.json(
            {
              ok: true,
              ready: true,
              sipUsername: perUser.sipUsername,
              sipRealm,
              wssUrl: sipWssUrl,
              sipPassword: perUser.sipPassword,
              perUser: true,
              expiresAt: null,
              message: 'per_user_endpoint_ready',
            },
            { headers: NO_STORE }
          );
        }
      } catch {
        // Fall through to shared env credentials.
      }
    }

    // --- Mode B: shared env credentials (default / current behaviour) ---
    const sipUsername = process.env.PHONE_SIP_USERNAME?.trim() || null;
    const sipPassword = process.env.PHONE_SIP_PASSWORD?.trim() || null;

    const credentialsReady = sipWssUrl !== null && sipUsername !== null && sipPassword !== null;

    if (credentialsReady) {
      return NextResponse.json(
        {
          ok: true,
          ready: true,
          sipUsername,
          sipRealm,
          wssUrl: sipWssUrl,
          sipPassword,
          perUser: false,
          expiresAt: null,
          message: 'browser_endpoint_ready',
        },
        { headers: NO_STORE }
      );
    }

    return NextResponse.json(
      { ok: true, ready: false, message: 'browser_endpoint_not_configured' },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'phone_token_route_failed' }, { status: 500, headers: NO_STORE });
  }
}
