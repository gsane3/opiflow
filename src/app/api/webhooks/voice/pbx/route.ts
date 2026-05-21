// PBX post-call webhook receiver for the Inter Telecom/Asterisk PoC.
// Machine-to-machine route: no user auth token required.
// Stores raw call-completed events into provider_webhook_events (003_crm_core.sql).
// Business isolation and transcription pipeline are handled in later phases.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createCustomerIntakeToken, markIntakeTokenSent } from '@/lib/server/intake-tokens';
import { sendIntakeViberMessage } from '@/lib/server/apifon-viber';
import { generateCallBrief } from '@/lib/server/call-brief';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function getBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function getNextCrmNumber(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const { data } = await supabase
    .from('customers')
    .select('crm_number')
    .eq('business_id', businessId)
    .not('crm_number', 'is', null);

  const rows = (data ?? []) as unknown as Array<{ crm_number: string | null }>;
  const nums = rows
    .map((r) => {
      const match = r.crm_number?.match(/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `#${max + 1}`;
}

async function findOrCreateCallCustomer(
  supabase: SupabaseClient,
  businessId: string,
  rawPhone: string | null
): Promise<{ customerId: string | null; customerCreated: boolean; customerMatched: boolean }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { customerId: null, customerCreated: false, customerMatched: false };
  }

  const { data: existingCustomer, error: existingError } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`customer_lookup_failed: ${existingError.message}`);
  }

  if (existingCustomer) {
    const existing = existingCustomer as unknown as { id: string };

    await supabase
      .from('customers')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('business_id', businessId);

    return { customerId: existing.id, customerCreated: false, customerMatched: true };
  }

  const crmNumber = await getNextCrmNumber(supabase, businessId);
  const now = new Date().toISOString();

  const { data: newCustomer, error: createError } = await supabase
    .from('customers')
    .insert({
      business_id: businessId,
      crm_number: crmNumber,
      name: null,
      company_name: null,
      phone,
      mobile_phone: null,
      landline_phone: null,
      email: null,
      address: null,
      source: 'inbound_call',
      status: 'new_lead',
      opportunity_value: null,
      needs_summary: null,
      notes: 'Auto-created from inbound PBX call.',
      preferred_contact_method: 'phone',
      intake_status: 'none',
      last_contact_at: now,
    })
    .select('id')
    .single();

  if (createError || !newCustomer) {
    throw new Error(`customer_create_failed: ${createError?.message ?? 'unknown error'}`);
  }

  return {
    customerId: (newCustomer as unknown as { id: string }).id,
    customerCreated: true,
    customerMatched: false,
  };
}

// ---------------------------------------------------------------------------
// GET /api/webhooks/voice/pbx -- health check
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'pbx_call_completed_webhook' });
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/voice/pbx -- receive PBX call-completed event
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Shared secret guard. Set PBX_WEBHOOK_SECRET in env to require the header.
  // Leave unset during local/dev PoC to allow unauthenticated requests through.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (headerSecret !== webhookSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  // Read raw body before parse -- preserves option for future HMAC verification.
  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!isRecord(parsed)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Extract idempotency key: prefer event_id, fall back to call_id, else null.
  const eventId =
    getString(parsed['event_id']) ??
    getString(parsed['call_id']) ??
    null;

  // event_type defaults to 'call.completed' if absent from payload.
  const eventType = getString(parsed['event_type']) ?? getString(parsed['event']) ?? 'call.completed';

  const businessId = getString(process.env.PBX_BUSINESS_ID);
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

  const callerNumber = getString(parsed['caller_number']);
  const dialStatus = getString(parsed['dialstatus']);
  const uniqueId = getString(parsed['uniqueid']) ?? eventId;
  const recordingPath = getString(parsed['recording_path']);
  const recordingExists = getBoolean(parsed['recording_exists']);
  const recordingSizeBytes = getNumber(parsed['recording_size_bytes']);
  const recordingFallbackApplied = getBoolean(parsed['recording_fallback_applied']);
  const consentAnnounced = getBoolean(parsed['consent_announced']);

  // Initialise Supabase service-role client.
  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }

  try {
    let webhookEventId: string | null = null;

    // Idempotency check: if event_id is known, skip duplicate inserts.
    // The partial unique index (provider, event_id) WHERE event_id IS NOT NULL
    // also enforces this at the DB level, but a pre-check avoids a confusing
    // unique-constraint error on the client.
    if (eventId !== null) {
      const { data: existing } = await supabase
        .from('provider_webhook_events')
        .select('id, processed')
        .eq('provider', 'pbx')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existing?.processed) {
        return NextResponse.json({ ok: true, received: true, duplicate: true });
      }

      if (existing && !existing.processed) {
        const existingCommunicationQuery = uniqueId
          ? await supabase
              .from('communications')
              .select('id')
              .eq('business_id', businessId)
              .eq('channel', 'call')
              .like('summary', `%uniqueid=${uniqueId}%`)
              .limit(1)
              .maybeSingle()
          : { data: null, error: null };

        if (existingCommunicationQuery.error) {
          return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
        }

        if (existingCommunicationQuery.data) {
          await supabase
            .from('provider_webhook_events')
            .update({
              processed: true,
              processed_at: new Date().toISOString(),
              error_message: null,
            })
            .eq('id', existing.id);

          return NextResponse.json({
            ok: true,
            received: true,
            duplicate: true,
            communication_already_exists: true,
          });
        }

        webhookEventId = existing.id;
      }
    }

    // Insert raw event only when this is not an unprocessed duplicate.
    if (!webhookEventId) {
      const { data: insertedWebhookEvent, error: insertError } = await supabase
        .from('provider_webhook_events')
        .insert({
          provider: 'pbx',
          event_id: eventId,
          event_type: eventType,
          payload: parsed,
          processed: false,
        })
        .select('id')
        .single();

      if (insertError || !insertedWebhookEvent) {
        return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
      }

      webhookEventId = insertedWebhookEvent.id;
    }

    let customerLink: Awaited<ReturnType<typeof findOrCreateCallCustomer>>;
    try {
      customerLink = await findOrCreateCallCustomer(supabase, businessId, callerNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'customer_link_failed';

      await supabase
        .from('provider_webhook_events')
        .update({
          error_message: message,
        })
        .eq('id', webhookEventId);

      return NextResponse.json({ ok: false, error: 'customer_link_failed' }, { status: 500 });
    }

    let intakeUrl: string | null = null;
    let intakeTokenId: string | null = null;
    let viberSendStatus: string | null = null;
    let viberMessageId: string | null = null;
    let viberRequestId: string | null = null;
    let viberReferenceId: string | null = null;
    let viberResponseBody: unknown = null;
    let viberSendError: string | null = null;

    if (customerLink.customerId) {
      try {
        const intakeToken = await createCustomerIntakeToken({
          businessId,
          customerId: customerLink.customerId,
          phone: normalizePhone(callerNumber),
        });

        intakeUrl = intakeToken.intakeUrl;
        intakeTokenId = intakeToken.row.id;

        const viberRef = uniqueId ? `pbx:${uniqueId}` : null;
        viberReferenceId = viberRef;

        const viberResult = await sendIntakeViberMessage({
          phone: normalizePhone(callerNumber),
          intakeUrl: intakeToken.intakeUrl,
          customerId: customerLink.customerId,
          tokenId: intakeToken.row.id,
          referenceId: viberRef,
        });

        if (viberResult.ok) {
          viberSendStatus = 'sent';
          viberMessageId = viberResult.messageId;
          viberRequestId = viberResult.requestId;
          viberResponseBody = viberResult.responseBody;

          await markIntakeTokenSent({
            tokenId: intakeToken.row.id,
            sentChannel: 'viber',
            sentToPhone: normalizePhone(callerNumber),
          });
        } else if (viberResult.skipped) {
          viberSendStatus = `skipped:${viberResult.reason}`;
        } else {
          viberSendStatus = `failed:${viberResult.error}`;
          viberSendError = viberResult.error;
          viberResponseBody = viberResult.responseBody;
        }

        await supabase
          .from('customers')
          .update({
            intake_status: viberResult.ok ? 'waiting_sms' : 'none',
          })
          .eq('id', customerLink.customerId)
          .eq('business_id', businessId);
      } catch (err) {
        viberSendStatus = err instanceof Error ? `failed:${err.message}` : 'failed:unknown_error';
      }
    }

    const summaryParts = [
      'PBX inbound call completed.',
      uniqueId ? `uniqueid=${uniqueId}` : null,
      dialStatus ? `dialstatus=${dialStatus}` : null,
      recordingExists !== null ? `recording_exists=${recordingExists}` : null,
      recordingSizeBytes !== null ? `recording_size_bytes=${recordingSizeBytes}` : null,
      recordingFallbackApplied !== null ? `recording_fallback_applied=${recordingFallbackApplied}` : null,
      consentAnnounced !== null ? `consent_announced=${consentAnnounced}` : null,
      customerLink.customerCreated ? 'customer_created=true' : null,
      customerLink.customerMatched ? 'customer_matched=true' : null,
      intakeUrl ? `intake_url=${intakeUrl}` : null,
      intakeTokenId ? `intake_token_id=${intakeTokenId}` : null,
      viberSendStatus ? `viber_send_status=${viberSendStatus}` : null,
      viberMessageId ? `viber_message_id=${viberMessageId}` : null,
      recordingPath ? `recording_path=${recordingPath}` : null,
    ].filter(Boolean).join(' ');

    // Generate a demo-safe AI brief from call metadata only (non-fatal).
    // Not a transcript -- uses structured metadata to produce a draft for human review.
    // customers.needs_summary is intentionally NOT updated here.
    let aiBrief: string | null = null;
    try {
      aiBrief = await generateCallBrief({
        callerNumber: normalizePhone(callerNumber),
        dialStatus,
        uniqueId,
        recordingExists,
        recordingSizeBytes,
        recordingFallbackApplied,
        customerCreated: customerLink.customerCreated,
        customerMatched: customerLink.customerMatched,
        intakeUrlCreated: intakeTokenId !== null,
        viberSendStatus,
      });
    } catch {
      // AI brief failure is non-fatal.
    }

    const communicationSummary = aiBrief
      ? `${aiBrief}\n\n---\nPBX metadata:\n${summaryParts}`
      : summaryParts;

    const { data: communicationRow, error: communicationError } = await supabase
      .from('communications')
      .insert({
        business_id: businessId,
        customer_id: customerLink.customerId,
        channel: 'call',
        direction: 'inbound',
        status: 'completed',
        phone: normalizePhone(callerNumber),
        summary: communicationSummary,
      })
      .select('id')
      .single();

    if (communicationError) {
      await supabase
        .from('provider_webhook_events')
        .update({
          error_message: communicationError.message,
        })
        .eq('id', webhookEventId);

      return NextResponse.json({ ok: false, error: 'communication_store_failed' }, { status: 500 });
    }

    // Insert viber_messages row if a Viber send was attempted or skipped.
    // Non-fatal: failure here does not roll back the communication row.
    if (viberSendStatus !== null) {
      const viberNow = new Date().toISOString();
      const simpleViberStatus =
        viberSendStatus === 'sent' ? 'sent'
        : viberSendStatus.startsWith('skipped') ? 'skipped'
        : viberSendStatus.startsWith('failed') ? 'failed'
        : 'created';
      const senderIdEnv =
        process.env.APIFON_VIBER_SENDER_ID?.trim() ||
        process.env.APIFON_SENDER_ID?.trim() ||
        null;
      const commId =
        (communicationRow as unknown as { id: string } | null)?.id ?? null;
      const { error: viberRowError } = await supabase
        .from('viber_messages')
        .insert({
          business_id: businessId,
          customer_id: customerLink.customerId,
          communication_id: commId,
          intake_token_id: intakeTokenId,
          provider: 'apifon',
          provider_request_id: viberRequestId,
          provider_message_id: viberMessageId,
          reference_id: viberReferenceId,
          recipient_phone: normalizePhone(callerNumber),
          sender_id: senderIdEnv,
          status: simpleViberStatus,
          raw_send_response: isRecord(viberResponseBody) ? viberResponseBody : null,
          error: viberSendError,
          sent_at: simpleViberStatus === 'sent' ? viberNow : null,
          failed_at: simpleViberStatus === 'failed' ? viberNow : null,
        });
      if (viberRowError) {
        console.error('viber_messages insert failed (non-fatal):', viberRowError.message);
      }
    }

    await supabase
      .from('provider_webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', webhookEventId);

    const finalCommId = (communicationRow as unknown as { id: string } | null)?.id ?? null;
    return NextResponse.json({ ok: true, received: true, communication_created: true, communication_id: finalCommId, customer_id: customerLink.customerId, customer_created: customerLink.customerCreated, customer_matched: customerLink.customerMatched });
  } catch {
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }
}

