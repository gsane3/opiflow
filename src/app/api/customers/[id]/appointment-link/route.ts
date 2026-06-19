// POST /api/customers/[id]/appointment-link
// Builds a Viber appointment response link for a customer.
//
// mode='draft' (default):
//   Creates a new appointment response token, returns responseUrl + message +
//   recipient without calling Apifon. Adds a warning when due_date or due_time
//   is missing.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   appointment_response_tokens (scoped to this task and business, must not
//   be revoked or expired). Uses the verified canonical URL.
//   If responseUrl is absent: creates a fresh token as fallback.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel (Viber with SMS fallback, or SMS direct). The message
//   TEXT always carries the response URL so SMS delivers a usable link.

import { NextRequest, NextResponse } from 'next/server';
import { selectViberPhone } from '@/lib/server/viber-phone';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createAppointmentResponseToken,
  hashAppointmentResponseToken,
  buildAppointmentResponseUrl,
  markAppointmentResponseTokenSent,
} from '@/lib/server/appointment-response-tokens';
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

// Fetch by resolved business id (membership-aware), not owner_id — so invited
// team members keep the business name/email in the outgoing message.
async function getBusiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<BusinessRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, email')
    .eq('id', businessId)
    .maybeSingle();
  return (data as unknown as BusinessRow | null) ?? null;
}

interface TaskRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  type: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
}

interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
  email: string | null;
  preferred_contact_method?: string | null;
}

interface ApptTokenLookupRow {
  id: string;
}

const VALID_APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

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

// Extracts the raw base64url token from an appointment response URL of the form
// {origin}/appointment-response/{rawToken}. Returns null for any invalid input.
function extractRawTokenFromApptUrl(responseUrl: string): string | null {
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

function formatGreekDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('el-GR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function buildApptMessage(task: TaskRow, responseUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  let firstLine: string;
  if (datePart && timePart) {
    firstLine = `Καλησπέρα σας. Το ραντεβού σας είναι για ${datePart} ${timePart}.`;
  } else if (datePart) {
    firstLine = `Καλησπέρα σας. Το ραντεβού σας είναι για ${datePart}.`;
  } else {
    firstLine = 'Καλησπέρα σας. Το ραντεβού σας έχει καταγραφεί.';
  }

  return [
    firstLine,
    'Παρακαλούμε επιβεβαιώστε στον παρακάτω σύνδεσμο:',
    responseUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
}

const VALID_MODES = ['draft', 'send'] as const;
type ApptLinkMode = typeof VALID_MODES[number];

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/appointment-link
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
    const business = await getBusiness(supabase, businessId);
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

    let mode: ApptLinkMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as ApptLinkMode;
    }

    // Accept taskId or appointmentId (alias)
    const taskId = str(raw.taskId) ?? str(raw.appointmentId);
    if (!taskId) {
      return NextResponse.json({ ok: false, error: 'missing_task_id' }, { status: 400 });
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

    // Verify the task belongs to this customer and business.
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, business_id, customer_id, type, status, due_date, due_time')
      .eq('id', taskId)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!taskData) {
      return NextResponse.json({ ok: false, error: 'appointment_not_found' }, { status: 404 });
    }

    const task = taskData as unknown as TaskRow;

    if (!(VALID_APPOINTMENT_TASK_TYPES as readonly string[]).includes(task.type)) {
      return NextResponse.json({ ok: false, error: 'invalid_task_type' }, { status: 400 });
    }

    if (task.status === 'cancelled' || task.status === 'completed') {
      return NextResponse.json({ ok: false, error: 'appointment_not_sendable' }, { status: 400 });
    }

    const customer = customerData;
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    const hasMissingTime = !task.due_date || !task.due_time;

    // -------------------------------------------------------------------------
    // Draft mode: create pending token, return message + responseUrl + recipient
    // -------------------------------------------------------------------------

    if (mode === 'draft') {
      let tokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        tokenResult = await createAppointmentResponseToken({
          businessId,
          taskId,
          sentChannel: 'manual',
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      const responseUrl = tokenResult.responseUrl;
      const message = buildApptMessage(task, responseUrl, businessName);
      const recipient = selectViberPhone(customer);

      return NextResponse.json({
        ok: true,
        mode: 'draft',
        sent: false,
        responseUrl,
        message,
        recipient,
        fallbackReason: null,
        warning: hasMissingTime ? 'missing_appointment_time' : null,
      });
    }

    // -------------------------------------------------------------------------
    // Send mode
    // -------------------------------------------------------------------------

    const reviewedResponseUrl = str(raw.responseUrl);
    let responseUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      // Verify the reviewed responseUrl: extract raw token, hash it, look up
      // the row scoped to this task and business so an attacker cannot
      // substitute a token that belongs to a different appointment.
      const rawToken = extractRawTokenFromApptUrl(reviewedResponseUrl);
      if (!rawToken) {
        return NextResponse.json({ ok: false, error: 'invalid_link' }, { status: 400 });
      }

      const tokenHash = hashAppointmentResponseToken(rawToken);

      const { data: tokenData, error: tokenQueryError } = await serviceClient
        .from('appointment_response_tokens')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('task_id', taskId)
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

      verifiedTokenId = (tokenData as unknown as ApptTokenLookupRow).id;
      responseUrl = buildAppointmentResponseUrl(rawToken);
    } else {
      // No reviewed URL: create a fresh token.
      let tokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        tokenResult = await createAppointmentResponseToken({
          businessId,
          taskId,
          sentChannel: 'viber',
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }

      responseUrl = tokenResult.responseUrl;
    }

    const messageText = buildApptMessage(task, responseUrl, businessName);

    // -------------------------------------------------------------------------
    // Email channel (#56): send the appointment confirmation link by email.
    // -------------------------------------------------------------------------
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return NextResponse.json({ ok: true, sent: false, fallbackReason: 'missing_email' });
      }

      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Επιβεβαίωση ραντεβού',
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
        summary: 'Επιβεβαίωση ραντεβού',
      });

      if (verifiedTokenId) {
        try {
          await markAppointmentResponseTokenSent({
            tokenId: verifiedTokenId,
            sentChannel: 'email',
            sentTo: email,
          });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }

      // Mirror the viber/sms path's pipeline nudge (best-effort).
      try {
        await supabase
          .from('customers')
          .update({ status: 'in_progress', updated_at: new Date().toISOString() })
          .eq('id', customerId)
          .eq('business_id', businessId)
          .in('status', ['new', 'in_progress']);
      } catch {
        // intentionally swallowed
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
      ? `appt-link:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `appt-link:${businessId.slice(0, 8)}:${taskId.slice(0, 8)}`;

    // Send via the customer's preferred channel (Viber with SMS fallback, or
    // SMS direct). messageText already contains the response URL, so SMS —
    // which has no action button — still delivers a usable link.
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
        summary: 'Επιβεβαίωση ραντεβού',
        phone: rawPhone,
        referenceId,
        providerRequestId: ids.providerRequestId,
        providerMessageId: ids.providerMessageId,
      });
    }

    // Mark the reviewed token as sent (non-fatal if it fails).
    if (verifiedTokenId) {
      try {
        await markAppointmentResponseTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: result.channel === 'sms' ? 'sms' : 'viber',
          sentTo: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    // Appointment link sent → nudge the customer to 'in_progress', but only from an
    // earlier pipeline stage so we never downgrade an already-advanced customer
    // (e.g. 'won' / 'lost'). The .in() guard makes this a no-op for
    // any non-early status. Best-effort and non-fatal: the message was already sent.
    try {
      await supabase
        .from('customers')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', customerId)
        .eq('business_id', businessId)
        .in('status', ['new', 'in_progress']);
    } catch {
      // intentionally swallowed: the appointment link was already sent
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
