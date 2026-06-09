// POST /api/customers/[id]/upload-link
// Builds a Viber photo/video upload link for a customer.
//
// mode='draft' (default):
//   Revokes existing pending/sent/opened tokens, creates a new pending token,
//   returns uploadUrl + message + recipient without calling Apifon.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   customer_upload_tokens (scoped to this customer and business, must not
//   be revoked or expired). Uses the verified canonical URL.
//   If responseUrl is absent: revokes existing + creates a fresh token.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel (Viber with SMS fallback, or SMS direct). The message
//   TEXT always carries the upload URL so SMS delivers a usable link.

import { NextRequest, NextResponse } from 'next/server';
import { selectViberPhone } from '@/lib/server/viber-phone';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createCustomerUploadToken,
  hashUploadToken,
  buildUploadUrl,
  markUploadTokenSent,
  revokePendingCustomerUploadTokens,
} from '@/lib/server/upload-tokens';
import { normalizeApifonMsisdn } from '@/lib/server/apifon-viber';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { sendCustomerLinkEmail } from '@/lib/server/customer-email';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

interface BusinessRow {
  id: string;
  name: string | null;
  email: string | null;
}

async function getBusiness(
  supabase: SupabaseClient,
  userId: string
): Promise<BusinessRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, email')
    .eq('owner_id', userId)
    .maybeSingle();
  return (data as unknown as BusinessRow | null) ?? null;
}

interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
  email: string | null;
  preferred_contact_method?: string | null;
}

interface UploadTokenLookupRow {
  id: string;
}

// Fetch the customer (business-scoped) including preferred_contact_method.
// Degrades gracefully if migration 035 (preferred_contact_method present /
// extended) has not been applied yet: on a column error we retry without it.
async function fetchCustomer(
  supabase: SupabaseClient,
  customerId: string,
  businessId: string
): Promise<{ customer: CustomerRow | null; error: boolean }> {
  const withPref = await supabase
    .from('customers')
    .select('id, mobile_phone, phone, email, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!withPref.error) {
    return { customer: (withPref.data as unknown as CustomerRow | null) ?? null, error: false };
  }

  const base = await supabase
    .from('customers')
    .select('id, mobile_phone, phone, email')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (base.error) {
    return { customer: null, error: true };
  }
  return { customer: (base.data as unknown as CustomerRow | null) ?? null, error: false };
}

// selectViberPhone + looksLikeGreekMobile → @/lib/server/viber-phone

// Extracts the raw base64url token from an upload URL of the form
// {origin}/upload/{rawToken}. Returns null for any invalid input.
function extractRawTokenFromUploadUrl(responseUrl: string): string | null {
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

function buildUploadMessage(uploadUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  return [
    'Καλησπέρα σας. Για καλύτερη εξυπηρέτηση, μπορείτε να ανεβάσετε φωτογραφίες ή βίντεο από τη συσκευή και τον χώρο στον παρακάτω σύνδεσμο:',
    uploadUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
}

const VALID_MODES = ['draft', 'send'] as const;
type UploadLinkMode = typeof VALID_MODES[number];

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/upload-link
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
  const { supabase, userId, businessId } = auth.ctx;

  try {
    const business = await getBusiness(supabase, userId);
    const businessName = business?.name ?? null;
    const businessEmail = business?.email ?? null;

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

    let mode: UploadLinkMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as UploadLinkMode;
    }

    const { id: customerId } = await params;

    // Verify the customer belongs to this business.
    const { customer: customerData, error: customerError } = await fetchCustomer(
      supabase,
      customerId,
      businessId
    );

    if (customerError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!customerData) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const customer = customerData;
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Draft mode: revoke existing, create pending token, return message + url
    // -------------------------------------------------------------------------

    if (mode === 'draft') {
      try {
        await revokePendingCustomerUploadTokens({ businessId, customerId });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerUploadToken>>;
      try {
        tokenResult = await createCustomerUploadToken({
          businessId,
          customerId,
          sentChannel: null,
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      const uploadUrl = tokenResult.uploadUrl;
      const message = buildUploadMessage(uploadUrl, businessName);
      const recipient = selectViberPhone(customer);

      return NextResponse.json({
        ok: true,
        mode: 'draft',
        sent: false,
        responseUrl: uploadUrl,
        message,
        recipient,
        fallbackReason: null,
      });
    }

    // -------------------------------------------------------------------------
    // Send mode
    // -------------------------------------------------------------------------

    const reviewedResponseUrl = str(raw.responseUrl);
    let uploadUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      // Verify the reviewed responseUrl: extract raw token, hash it, look up
      // the row scoped to this customer and business so an attacker cannot
      // substitute a token that belongs to a different customer.
      const rawToken = extractRawTokenFromUploadUrl(reviewedResponseUrl);
      if (!rawToken) {
        return NextResponse.json({ ok: false, error: 'invalid_link' }, { status: 400 });
      }

      const tokenHash = hashUploadToken(rawToken);

      const { data: tokenData, error: tokenQueryError } = await serviceClient
        .from('customer_upload_tokens')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('customer_id', customerId)
        .eq('business_id', businessId)
        .in('status', ['pending', 'sent', 'opened'])
        .gt('expires_at', now)
        .is('revoked_at', null)
        .maybeSingle();

      if (tokenQueryError) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      if (!tokenData) {
        return NextResponse.json({ ok: false, error: 'link_expired' }, { status: 422 });
      }

      verifiedTokenId = (tokenData as unknown as UploadTokenLookupRow).id;
      uploadUrl = buildUploadUrl(rawToken);
    } else {
      // No reviewed URL: revoke existing tokens and create a fresh one.
      try {
        await revokePendingCustomerUploadTokens({ businessId, customerId });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerUploadToken>>;
      try {
        tokenResult = await createCustomerUploadToken({
          businessId,
          customerId,
          sentChannel: 'viber',
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      uploadUrl = tokenResult.uploadUrl;
    }

    const messageText = buildUploadMessage(uploadUrl, businessName);

    // -------------------------------------------------------------------------
    // Email channel (#56): send the upload link by email via Resend.
    // -------------------------------------------------------------------------
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return NextResponse.json({ ok: true, sent: false, fallbackReason: 'missing_email' });
      }

      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Αποστολή φωτογραφιών',
        text: messageText,
        businessName,
        businessEmail,
      });

      if (!emailResult.ok) {
        const fallbackReason =
          emailResult.reason === 'missing_email_config' ? 'provider_unavailable' : 'provider_failed';
        return NextResponse.json({ ok: true, sent: false, fallbackReason });
      }

      await recordOutboundMessage({
        businessId,
        customerId,
        channel: 'email',
        summary: 'Αίτημα φωτογραφιών',
      });

      if (verifiedTokenId) {
        try {
          await markUploadTokenSent({
            tokenId: verifiedTokenId,
            sentChannel: 'email',
            sentToPhone: null,
          });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }

      return NextResponse.json({ ok: true, sent: true, fallbackReason: null });
    }

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
      ? `upload-link:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `upload-link:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}`;

    // Send via the customer's preferred channel (Viber with SMS fallback, or
    // SMS direct). messageText already contains the upload URL, so SMS — which
    // has no action button — still delivers a usable link.
    const result = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone: rawPhone,
      text: messageText,
      customerId,
      referenceId,
    });

    if (!result.ok) {
      const fallbackReason =
        result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason,
      });
    }

    // Log to the customer timeline (#57). Best-effort; non-fatal.
    {
      const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
      await recordOutboundMessage({
        businessId,
        customerId,
        channel: result.channel === 'sms' ? 'sms' : 'viber',
        summary: 'Αίτημα φωτογραφιών',
        phone: rawPhone,
        referenceId,
        providerRequestId: ids.providerRequestId,
        providerMessageId: ids.providerMessageId,
      });
    }

    // Mark the verified token as sent (non-fatal if it fails).
    if (verifiedTokenId) {
      try {
        await markUploadTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: result.channel === 'sms' ? 'sms' : 'viber',
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
