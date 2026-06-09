// POST /api/offers/[id]/notify
// Builds a Viber message for an offer response link.
//
// mode='draft' (default):
//   Revokes existing pending/sent tokens, creates a new pending token,
//   returns responseUrl + message + recipient without calling Apifon.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   offer_response_tokens (must match offer and business, must not be
//   revoked or expired). Uses the verified canonical URL to build the
//   message so the sent link matches what the user reviewed.
//   If responseUrl is absent: creates a fresh token as fallback.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel (Viber with SMS fallback, or SMS direct). The message
//   TEXT always carries the response URL so SMS delivers a usable link.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createOfferResponseToken,
  hashOfferResponseToken,
  buildOfferResponseUrl,
  markOfferResponseTokenSent,
} from '@/lib/server/offer-response-tokens';
import { normalizeApifonMsisdn } from '@/lib/server/apifon-viber';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage } from '@/lib/server/record-message';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
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

// Extracts the raw base64url token from a response URL of the form
// {origin}/offer-response/{rawToken}. Returns null for any invalid input.
function extractRawTokenFromResponseUrl(responseUrl: string): string | null {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfferRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  offer_number: string | null;
  status: string;
  total: number | null;
}

interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
  preferred_contact_method?: string | null;
}

interface TokenRow {
  id: string;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

// Fetch a customer (business-scoped) including preferred_contact_method.
// Degrades gracefully if migration 035 (preferred_contact_method present /
// extended) has not been applied yet: on a column error we retry without it.
async function fetchOfferCustomer(
  supabase: SupabaseClient,
  customerId: string,
  businessId: string
): Promise<CustomerRow | null> {
  const withPref = await supabase
    .from('customers')
    .select('id, mobile_phone, phone, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!withPref.error) {
    return (withPref.data as unknown as CustomerRow | null) ?? null;
  }

  const base = await supabase
    .from('customers')
    .select('id, mobile_phone, phone')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  return (base.data as unknown as CustomerRow | null) ?? null;
}

const VALID_MODES = ['draft', 'send'] as const;
type NotificationMode = typeof VALID_MODES[number];

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

function buildOfferMessage(offerNumber: string | null, responseUrl: string): string {
  const lines: string[] = ['Γεια σας.'];
  if (offerNumber) {
    lines.push(`Σας αποστέλλουμε την προσφορά μας ${offerNumber}.`);
  } else {
    lines.push('Σας αποστέλλουμε την προσφορά μας.');
  }
  lines.push('Για να την αποδεχτείτε ή απορρίψετε, επισκεφθείτε:');
  lines.push(responseUrl);
  return lines.join(' ');
}

// ---------------------------------------------------------------------------
// POST /api/offers/[id]/notify
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
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

    // Optional mode (default 'draft')
    let mode: NotificationMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as NotificationMode;
    }

    const { id: offerId } = await params;

    // Fetch offer (business-scoped)
    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .select('id, business_id, customer_id, offer_number, status, total')
      .eq('id', offerId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (offerError) {
      return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
    }
    if (!offerData) {
      return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    }

    const offer = offerData as unknown as OfferRow;
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Draft mode: create pending token, return message + responseUrl + recipient
    // -------------------------------------------------------------------------

    if (mode === 'draft') {
      const { error: revokeError } = await serviceClient
        .from('offer_response_tokens')
        .update({ status: 'revoked', revoked_at: now, updated_at: now })
        .eq('business_id', businessId)
        .eq('offer_id', offerId)
        .in('status', ['pending', 'sent'])
        .is('revoked_at', null);

      if (revokeError) {
        return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createOfferResponseToken>>;
      try {
        tokenResult = await createOfferResponseToken({
          businessId,
          offerId,
          sentChannel: null,
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
      }

      const responseUrl = tokenResult.responseUrl;
      const message = buildOfferMessage(offer.offer_number, responseUrl);

      // Look up customer phone for display in the review modal.
      let recipient: string | null = null;
      if (offer.customer_id) {
        const customerData = await fetchOfferCustomer(supabase, offer.customer_id, businessId);
        if (customerData) {
          recipient = selectViberPhone(customerData);
        }
      }

      return NextResponse.json({
        ok: true,
        mode: 'draft',
        responseUrl,
        message,
        recipient,
        sent: false,
      });
    }

    // -------------------------------------------------------------------------
    // Send mode
    // -------------------------------------------------------------------------

    const reviewedResponseUrl = str(raw.responseUrl);
    let messageText: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      // Verify the reviewed responseUrl: extract raw token, hash it, look up the
      // row. The query is scoped to this offer and business so an attacker cannot
      // substitute a token that belongs to a different offer.
      const rawToken = extractRawTokenFromResponseUrl(reviewedResponseUrl);
      if (!rawToken) {
        return NextResponse.json({ ok: false, error: 'invalid_response_url' }, { status: 400 });
      }

      const tokenHash = hashOfferResponseToken(rawToken);

      const { data: tokenData, error: tokenQueryError } = await serviceClient
        .from('offer_response_tokens')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('offer_id', offerId)
        .eq('business_id', businessId)
        .in('status', ['pending', 'sent', 'opened'])
        .gt('expires_at', now)
        .maybeSingle();

      if (tokenQueryError) {
        return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
      }
      if (!tokenData) {
        return NextResponse.json({ ok: false, error: 'link_expired' }, { status: 422 });
      }

      verifiedTokenId = (tokenData as unknown as TokenRow).id;
      // Build message from the server-canonical URL (same as what draft returned),
      // not the raw frontend-provided string.
      const canonicalUrl = buildOfferResponseUrl(rawToken);
      messageText = buildOfferMessage(offer.offer_number, canonicalUrl);
    } else {
      // No reviewed URL provided: revoke and create a fresh token as fallback.
      const { error: revokeError } = await serviceClient
        .from('offer_response_tokens')
        .update({ status: 'revoked', revoked_at: now, updated_at: now })
        .eq('business_id', businessId)
        .eq('offer_id', offerId)
        .in('status', ['pending', 'sent'])
        .is('revoked_at', null);

      if (revokeError) {
        return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createOfferResponseToken>>;
      try {
        tokenResult = await createOfferResponseToken({
          businessId,
          offerId,
          sentChannel: 'viber',
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
      }

      messageText = buildOfferMessage(offer.offer_number, tokenResult.responseUrl);
    }

    // Look up customer phone for Viber send
    if (!offer.customer_id) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_customer',
        message: messageText,
      });
    }

    const customerData = await fetchOfferCustomer(supabase, offer.customer_id, businessId);

    if (!customerData) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_customer',
        message: messageText,
      });
    }

    const customer = customerData;
    const rawPhone = selectViberPhone(customer);

    if (!rawPhone) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_mobile',
        message: messageText,
      });
    }

    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_mobile',
        message: messageText,
      });
    }

    const referenceId = verifiedTokenId
      ? `offer-notif:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `offer-notif:${businessId.slice(0, 8)}:${offerId.slice(0, 8)}`;

    // Send via the customer's preferred channel (Viber with SMS fallback, or
    // SMS direct). messageText already contains the response URL, so SMS —
    // which has no action button — still delivers a usable link.
    const sendResult = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone: rawPhone,
      text: messageText,
      customerId: offer.customer_id,
      referenceId,
    });

    if (!sendResult.ok) {
      const reason =
        sendResult.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: sendResult.channel,
        status: 'fallback_required',
        reason,
        message: messageText,
      });
    }

    // Mark the reviewed token as sent (non-fatal if it fails -- the message was already sent).
    if (verifiedTokenId) {
      try {
        await markOfferResponseTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: sendResult.channel === 'sms' ? 'sms' : 'viber',
          sentTo: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    // Sent successfully → advance the customer through the pipeline.
    //  - status = 'in_progress' so the funnel reflects that an offer is out.
    //  - opportunity_value = offer total (when known) so we can build sales stats later.
    // Both are best-effort and non-fatal: the offer (Viber message) was already sent.
    if (offer.customer_id) {
      try {
        const customerUpdate: Record<string, unknown> = {
          status: 'in_progress',
          updated_at: new Date().toISOString(),
        };
        if (typeof offer.total === 'number' && offer.total > 0) {
          customerUpdate.opportunity_value = offer.total;
        }
        await supabase
          .from('customers')
          .update(customerUpdate)
          .eq('id', offer.customer_id)
          .eq('business_id', businessId);
      } catch {
        // intentionally swallowed: the offer was already sent
      }
    }

    // Advance the OFFER's own status so it no longer reads as "Πρόχειρη" after a
    // real send. Best-effort & non-fatal; never regress an offer that already
    // reached a final state (accepted/rejected/expired) or was already sent.
    try {
      if (offer.status === 'draft' || offer.status === 'ready_to_send') {
        await supabase
          .from('offers')
          .update({ status: 'sent_manually', updated_at: new Date().toISOString() })
          .eq('id', offer.id)
          .eq('business_id', businessId);
      }
    } catch {
      // intentionally swallowed: the Viber message was already sent
    }

    // Surface requestId / messageId from whichever underlying send succeeded.
    const sentDetail = (sendResult.channel === 'sms' ? sendResult.sms : sendResult.viber) as
      | { requestId?: string | null; messageId?: string | null }
      | undefined;

    // Log to the customer timeline (#57). Best-effort; non-fatal.
    if (offer.customer_id) {
      await recordOutboundMessage({
        businessId,
        customerId: offer.customer_id,
        channel: sendResult.channel === 'sms' ? 'sms' : 'viber',
        summary: offer.offer_number ? `Προσφορά ${offer.offer_number}` : 'Αποστολή προσφοράς',
        phone: rawPhone,
        referenceId,
        providerRequestId: sentDetail?.requestId ?? null,
        providerMessageId: sentDetail?.messageId ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      channel: sendResult.channel,
      status: 'sent',
      reason: null,
      requestId: sentDetail?.requestId ?? null,
      messageId: sentDetail?.messageId ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
  }
}
