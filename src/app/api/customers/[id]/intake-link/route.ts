// POST /api/customers/[id]/intake-link
// Builds a Viber intake link for a customer.
//
// mode='draft' (default):
//   Revokes existing pending/sent tokens, creates a new pending token,
//   returns responseUrl + message + recipient without calling Apifon.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   customer_intake_tokens (scoped to this customer and business, must not
//   be revoked or expired). Uses the verified canonical URL.
//   If responseUrl is absent: revokes existing + creates a fresh token.
//   In both cases: looks up customer phone and calls Apifon via
//   sendIntakeViberMessage.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  createServiceSupabaseClient,
  createCustomerIntakeToken,
  hashIntakeToken,
  buildIntakeUrl,
  markIntakeTokenSent,
} from '@/lib/server/intake-tokens';
import { sendIntakeViberMessage, normalizeApifonMsisdn } from '@/lib/server/apifon-viber';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

interface BusinessRow {
  id: string;
  name: string | null;
}

async function getBusiness(
  supabase: SupabaseClient,
  userId: string
): Promise<BusinessRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('owner_id', userId)
    .maybeSingle();
  return (data as unknown as BusinessRow | null) ?? null;
}

interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
}

interface IntakeTokenLookupRow {
  id: string;
}

function looksLikeGreekMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/[^\d]/g, '');
  return /^6\d{9}$/.test(digits) || /^306\d{9}$/.test(digits);
}

function selectViberPhone(customer: CustomerRow): string | null {
  const mobile = str(customer.mobile_phone);
  if (mobile) return mobile;
  const fallback = str(customer.phone);
  if (fallback && looksLikeGreekMobile(fallback)) return fallback;
  return null;
}

// Extracts the raw base64url token from an intake URL of the form
// {origin}/intake/{rawToken}. Returns null for any invalid input.
function extractRawTokenFromIntakeUrl(responseUrl: string): string | null {
  try {
    const url = new URL(responseUrl);
    const parts = url.pathname.split('/');
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;
    const rawToken = decodeURIComponent(lastPart);
    if (!/^[A-Za-z0-9_-]+$/.test(rawToken)) return null;
    return rawToken;
  } catch {
    return null;
  }
}

function buildIntakeMessage(responseUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  return [
    'Καλησπέρα σας. Για να καταχωρηθεί σωστά το αίτημά σας, συμπληρώστε τα στοιχεία σας στον παρακάτω σύνδεσμο:',
    responseUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω DeskopAI Assistant',
  ].join('\n');
}

const VALID_MODES = ['draft', 'send'] as const;
type IntakeLinkMode = typeof VALID_MODES[number];

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/intake-link
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const business = await getBusiness(supabase, user.id);
    if (!business) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }
    const businessId = business.id;
    const businessName = business.name ?? null;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    let mode: IntakeLinkMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as IntakeLinkMode;
    }

    const { id: customerId } = await params;

    // Verify the customer belongs to this business.
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, mobile_phone, phone')
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (customerError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!customerData) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const customer = customerData as unknown as CustomerRow;
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Draft mode: revoke, create pending token, return message + responseUrl
    // -------------------------------------------------------------------------

    if (mode === 'draft') {
      const { error: revokeError } = await serviceClient
        .from('customer_intake_tokens')
        .update({ status: 'revoked', revoked_at: now, updated_at: now })
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .in('status', ['pending', 'sent'])
        .is('revoked_at', null);

      if (revokeError) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId,
          customerId,
          sentChannel: null,
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      const responseUrl = tokenResult.intakeUrl;
      const message = buildIntakeMessage(responseUrl, businessName);
      const recipient = selectViberPhone(customer);

      return NextResponse.json({
        ok: true,
        mode: 'draft',
        sent: false,
        responseUrl,
        message,
        recipient,
        fallbackReason: null,
      });
    }

    // -------------------------------------------------------------------------
    // Send mode
    // -------------------------------------------------------------------------

    const reviewedResponseUrl = str(raw.responseUrl);
    let intakeUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      // Verify the reviewed responseUrl: extract raw token, hash it, look up
      // the row scoped to this customer and business so an attacker cannot
      // substitute a token that belongs to a different customer.
      const rawToken = extractRawTokenFromIntakeUrl(reviewedResponseUrl);
      if (!rawToken) {
        return NextResponse.json({ ok: false, error: 'invalid_link' }, { status: 400 });
      }

      const tokenHash = hashIntakeToken(rawToken);

      const { data: tokenData, error: tokenQueryError } = await serviceClient
        .from('customer_intake_tokens')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('customer_id', customerId)
        .eq('business_id', businessId)
        .in('status', ['pending', 'sent', 'opened'])
        .gt('expires_at', now)
        .maybeSingle();

      if (tokenQueryError) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      if (!tokenData) {
        return NextResponse.json({ ok: false, error: 'link_expired' }, { status: 422 });
      }

      verifiedTokenId = (tokenData as unknown as IntakeTokenLookupRow).id;
      intakeUrl = buildIntakeUrl(rawToken);
    } else {
      // No reviewed URL: revoke existing tokens and create a fresh one.
      const { error: revokeError } = await serviceClient
        .from('customer_intake_tokens')
        .update({ status: 'revoked', revoked_at: now, updated_at: now })
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .in('status', ['pending', 'sent'])
        .is('revoked_at', null);

      if (revokeError) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId,
          customerId,
          sentChannel: 'viber',
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      intakeUrl = tokenResult.intakeUrl;
    }

    // Look up customer phone for Viber send.
    const rawPhone = selectViberPhone(customer);
    if (!rawPhone) {
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason: 'missing_mobile',
      });
    }

    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason: 'missing_mobile',
      });
    }

    const referenceId = verifiedTokenId
      ? `intake-notif:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `intake-notif:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}`;

    const messageText = buildIntakeMessage(intakeUrl, businessName);

    const viberResult = await sendIntakeViberMessage({
      phone: rawPhone,
      intakeUrl,
      customerId,
      tokenId: verifiedTokenId,
      referenceId,
      messageText,
    });

    if (viberResult.skipped) {
      const fallbackReason =
        viberResult.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'missing_mobile';
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason,
      });
    }

    if (!viberResult.ok) {
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason: 'provider_failed',
      });
    }

    // Mark the reviewed token as sent (non-fatal if it fails).
    if (verifiedTokenId) {
      try {
        await markIntakeTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: 'viber',
          sentToPhone: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      fallbackReason: null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
