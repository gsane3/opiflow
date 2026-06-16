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
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel — the nicer Viber action-button message when the
//   preference resolves to Viber, otherwise SMS (with Viber->SMS fallback).
//   The message TEXT always contains the link so SMS carries it too.

import { NextRequest, NextResponse } from 'next/server';
import { selectViberPhone } from '@/lib/server/viber-phone';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createCustomerIntakeToken,
  hashIntakeToken,
  buildIntakeUrl,
  markIntakeTokenSent,
} from '@/lib/server/intake-tokens';
import { sendIntakeViberMessage, normalizeApifonMsisdn } from '@/lib/server/apifon-viber';
import { sendViaPreferredChannel, channelForCustomer } from '@/lib/server/send-channel';
import { sendCustomerLinkEmail } from '@/lib/server/customer-email';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';
import { resolveWorkFolderForCreate } from '@/lib/server/folder-link';

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

interface IntakeTokenLookupRow {
  id: string;
}

// Fetch the customer (business-scoped) including preferred_contact_method.
// Degrades gracefully if migration 035 (preferred_contact_method extended /
// present) has not been applied yet: on a column error we retry without it.
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

  // Likely the preferred_contact_method column is missing — retry without it.
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
    'μέσω Opiflow Assistant',
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

    // WF-4B: optional folder context. When present, the folder must belong to
    // this business AND this customer; otherwise unchanged (workFolderId = null).
    const folderLink = await resolveWorkFolderForCreate(supabase, businessId, raw.workFolderId, customerId);
    if (!folderLink.ok) {
      return NextResponse.json({ ok: false, error: folderLink.error }, { status: folderLink.status });
    }
    const workFolderId = folderLink.workFolderId;

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
          workFolderId,
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
          workFolderId,
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      intakeUrl = tokenResult.intakeUrl;
    }

    // -------------------------------------------------------------------------
    // Email channel (#56): when the operator explicitly picks email, send the
    // link by email via Resend instead of Viber/SMS. Requires the customer to
    // have an email on file.
    // -------------------------------------------------------------------------
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return NextResponse.json({ ok: true, sent: false, fallbackReason: 'missing_email' });
      }

      const emailMessage = buildIntakeMessage(intakeUrl, businessName);
      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Στοιχεία επικοινωνίας',
        text: emailMessage,
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
        summary: 'Αίτημα στοιχείων',
      });

      if (verifiedTokenId) {
        try {
          await markIntakeTokenSent({
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

    // The message TEXT always carries the intake URL so SMS (which has no
    // action button) still delivers a usable link.
    const messageText = buildIntakeMessage(intakeUrl, businessName);

    const preferred = customer.preferred_contact_method ?? null;

    // Track the channel actually used so we record it on the token.
    let sent = false;
    let fallbackReason: string | null = null;
    let sentChannel: 'viber' | 'sms' | null = null;
    let providerRequestId: string | null = null;
    let providerMessageId: string | null = null;

    if (channelForCustomer(preferred) === 'viber') {
      // Preferred channel resolves to Viber: use the nicer Viber action-button
      // message first, and only fall back to SMS if Viber is skipped/fails.
      const viberResult = await sendIntakeViberMessage({
        phone: rawPhone,
        intakeUrl,
        customerId,
        tokenId: verifiedTokenId,
        referenceId,
        messageText,
      });

      if (viberResult.ok) {
        sent = true;
        sentChannel = 'viber';
        providerRequestId = viberResult.requestId;
        providerMessageId = viberResult.messageId;
      } else {
        // Viber skipped or failed → SMS fallback. The text already contains the
        // URL, so the link is delivered.
        const smsFallback = await sendViaPreferredChannel({
          preferred: 'sms',
          phone: rawPhone,
          text: messageText,
          customerId,
          referenceId,
        });

        if (smsFallback.ok) {
          sent = true;
          sentChannel = smsFallback.channel === 'sms' ? 'sms' : 'viber';
          const ids = extractProviderIds(smsFallback.sms);
          providerRequestId = ids.providerRequestId;
          providerMessageId = ids.providerMessageId;
        } else if (viberResult.skipped) {
          fallbackReason =
            viberResult.reason === 'missing_apifon_config'
              ? 'provider_unavailable'
              : 'missing_mobile';
        } else {
          fallbackReason = 'provider_failed';
        }
      }
    } else {
      // Preferred channel is SMS: send via the dispatcher (SMS direct).
      const result = await sendViaPreferredChannel({
        preferred,
        phone: rawPhone,
        text: messageText,
        customerId,
        referenceId,
      });

      sent = result.ok;
      if (result.ok) {
        sentChannel = result.channel === 'sms' ? 'sms' : 'viber';
        const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
        providerRequestId = ids.providerRequestId;
        providerMessageId = ids.providerMessageId;
      } else {
        fallbackReason =
          result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      }
    }

    if (!sent) {
      return NextResponse.json({
        ok: true,
        sent: false,
        fallbackReason,
      });
    }

    // Log to the customer timeline (#57). Best-effort; non-fatal.
    await recordOutboundMessage({
      businessId,
      customerId,
      channel: sentChannel ?? 'viber',
      summary: 'Αίτημα στοιχείων',
      phone: rawPhone,
      referenceId,
      providerRequestId,
      providerMessageId,
    });

    // Mark the reviewed token as sent (non-fatal if it fails).
    if (verifiedTokenId) {
      try {
        await markIntakeTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: sentChannel ?? 'viber',
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
