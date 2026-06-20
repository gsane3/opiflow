// PBX post-call webhook receiver for the Inter Telecom/Asterisk PoC.
// Machine-to-machine route: no user auth token required.
// Stores raw call-completed events into provider_webhook_events (003_crm_core.sql).
// Business isolation and transcription pipeline are handled in later phases.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateCallBrief } from '@/lib/server/call-brief';
import { timingSafeEqualSecret } from '@/lib/server/webhook-secret';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';
import { isWithinBusinessHours, parseBusinessHours } from '@/lib/server/business-hours';

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

/**
 * `biz_<32hex>` endpoint identity → business UUID. The PBX dials a per-tenant
 * app endpoint (biz_<hex>) for each business, so this is the most reliable
 * multi-tenant business identifier — no dependency on business_phone_numbers
 * data being populated. Mirrors the inbound Twilio webhook's hex→UUID mapping.
 */
function businessIdFromBizEndpoint(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/biz_([a-f0-9]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function getNextCrmNumber(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  // Atomic per-business counter (migration 043) — two simultaneous inbound
  // calls from new numbers can no longer mint the same #N. Falls back to the
  // legacy scan pre-043.
  try {
    const { data: n, error } = await supabase.rpc('take_next_crm_number', {
      p_business_id: businessId,
    });
    if (!error && typeof n === 'number' && n > 0) return `#${n}`;
  } catch {
    // fall back
  }

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
      status: 'new',
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
  // Shared secret guard. Set PBX_WEBHOOK_SECRET to require the header. In
  // production the secret is mandatory (fail closed) unless ALLOW_INSECURE_WEBHOOKS=1
  // is set, so a misconfigured deploy cannot leave this customer-/Viber-writing
  // endpoint open to the internet.
  const webhookSecret = process.env.PBX_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-pbx-webhook-secret') ?? '';
    if (!timingSafeEqualSecret(headerSecret, webhookSecret)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
    console.error('[pbx webhook] PBX_WEBHOOK_SECRET is not set in production — rejecting. Set the secret (or ALLOW_INSECURE_WEBHOOKS=1 to override).');
    return NextResponse.json({ ok: false, error: 'webhook_not_configured' }, { status: 503 });
  } else {
    console.warn('[pbx webhook] PBX_WEBHOOK_SECRET is not set — endpoint is UNAUTHENTICATED.');
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

  const callerNumber = getString(parsed['caller_number']);
  const calledNumberRaw = getString(parsed['called_number']);
  // The PBX rang a known per-tenant app endpoint (biz_<hex>) — the most reliable
  // business identifier. Falls back to the dialed-DID lookup, then the env var.
  const bizEndpointId = businessIdFromBizEndpoint(
    getString(parsed['endpoint']) ?? getString(parsed['biz_id']) ?? getString(parsed['opiflow_ep'])
  );
  const pbxBusinessIdFromEnv = getString(process.env.PBX_BUSINESS_ID);
  // Require at least one source for business resolution before touching Supabase.
  if (!bizEndpointId && !calledNumberRaw && !pbxBusinessIdFromEnv) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
  }

  const dialStatus = getString(parsed['dialstatus']);
  const uniqueId = getString(parsed['uniqueid']) ?? eventId;
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

  // Resolve business_id: prefer called_number lookup (multi-tenant),
  // fall back to PBX_BUSINESS_ID env var (single-tenant / local PBX tests).
  let businessId: string | null = null;

  // 1) Trust the biz_<hex> endpoint the PBX rang — verified to exist so a bogus
  //    identity can't write rows for a non-business.
  if (bizEndpointId) {
    const { data: bizExists } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', bizEndpointId)
      .maybeSingle();
    if (bizExists) businessId = bizEndpointId;
  }

  // 2) Otherwise resolve by the dialed DID against business_phone_numbers.
  if (!businessId && calledNumberRaw) {
    // The PBX delivers the dialed DID in whatever form the trunk sends (e.g.
    // '302104400811' from the INVITE R-URI), while business_phone_numbers stores
    // the full E.164 form ('+302104400811'). Match against every plausible form
    // so the lookup is robust to '+', the '30' country code, and local format.
    const digits = calledNumberRaw.replace(/\D/g, '');
    if (digits) {
      const candidates = new Set<string>();
      candidates.add(digits);
      candidates.add(`+${digits}`);
      if (digits.startsWith('00')) {
        const intl = digits.slice(2);
        candidates.add(intl);
        candidates.add(`+${intl}`);
      }
      if (digits.startsWith('30') && digits.length > 10) {
        const local = digits.slice(2);
        candidates.add(local);
        candidates.add(`+${local}`);
        candidates.add(`30${local}`);
        candidates.add(`+30${local}`);
      } else if (digits.length === 10) {
        candidates.add(`30${digits}`);
        candidates.add(`+30${digits}`);
      }
      const { data: bizRow, error: bizRowError } = await supabase
        .from('business_phone_numbers')
        .select('business_id')
        .in('e164_number', Array.from(candidates))
        .eq('status', 'active')
        .maybeSingle();
      if (!bizRowError && bizRow) {
        businessId = (bizRow as unknown as { business_id: string }).business_id ?? null;
      }
    }
  }

  if (!businessId) {
    businessId = pbxBusinessIdFromEnv;
  }

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'missing_pbx_business_id' }, { status: 503 });
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

    // HYBRID intake link: the customer is auto-created/matched above, but the
    // intake LINK is intentionally NOT auto-sent here. It is sent only when the
    // operator confirms via the post-call prompt (wired elsewhere). So this
    // webhook no longer creates an intake token or sends a Viber message.

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
    ].filter(Boolean).join(' ');

    // Generate an AI brief ONLY when a real recording exists (non-fatal).
    // generateCallBrief returns null when recordingExists !== true, so missed /
    // no-recording calls never get a fabricated brief. The intake link is no
    // longer auto-sent, so intakeUrlCreated/viberSendStatus are always false/null.
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
        intakeUrlCreated: false,
        viberSendStatus: null,
      });
    } catch {
      // AI brief failure is non-fatal.
    }

    // "Not answered" drives the whole missed-call funnel below: the row status
    // ('missed' → bell/red markers), the call-back task, and the owner push.
    const upperDialStatus = (dialStatus ?? '').toUpperCase();
    const notAnswered =
      !aiBrief &&
      (upperDialStatus === '' ||
        upperDialStatus === 'NOANSWER' ||
        upperDialStatus === 'BUSY' ||
        upperDialStatus === 'CANCEL' ||
        upperDialStatus === 'FAILED' ||
        upperDialStatus === 'CONGESTION');

    let communicationSummary: string;
    if (aiBrief) {
      // Real recording -> AI brief + PBX metadata footer.
      communicationSummary = `${aiBrief}\n\n---\nPBX metadata:\n${summaryParts}`;
    } else {
      // No AI brief yet — use a plain, factual label (never a guess about what
      // was said). A recorded call shows "processing" until the transcript brief
      // overwrites this summary; an unanswered call shows "Αναπάντητη κλήση".
      const label = notAnswered
        ? 'Αναπάντητη κλήση'
        : recordingExists
        ? 'Κλήση — γίνεται επεξεργασία της ηχογράφησης…'
        : 'Κλήση χωρίς ηχογράφηση';
      communicationSummary = `${label}\n\n---\nPBX metadata:\n${summaryParts}`;
    }

    const commInsert = (status: string) =>
      supabase
        .from('communications')
        .insert({
          business_id: businessId,
          customer_id: customerLink.customerId,
          channel: 'call',
          direction: 'inbound',
          status,
          phone: normalizePhone(callerNumber),
          summary: communicationSummary,
        })
        .select('id')
        .single();

    let { data: communicationRow, error: communicationError } = await commInsert(
      notAnswered ? 'missed' : 'completed'
    );
    if (communicationError && notAnswered) {
      // Pre-migration-043 CHECK doesn't allow 'missed' yet — 'failed' also
      // lights every missed-call UI path (they test missed OR failed).
      ({ data: communicationRow, error: communicationError } = await commInsert('failed'));
    }

    if (communicationError) {
      await supabase
        .from('provider_webhook_events')
        .update({
          error_message: communicationError.message,
        })
        .eq('id', webhookEventId);

      return NextResponse.json({ ok: false, error: 'communication_store_failed' }, { status: 500 });
    }

    // No viber_messages logging here anymore: the intake link is not auto-sent
    // by this webhook. The post-call operator-confirmation flow is responsible
    // for sending the link and logging any viber_messages / send rows.

    // Missed-call funnel: the moment the plumber needs the product most. Create
    // an actionable call-back task and push it to the owner's phone — instead of
    // a label he'd only find by scanning the calls list later. Best-effort: a
    // failure here must never fail the webhook (the call row is already stored).
    if (notAnswered) {
      const missedCommId = (communicationRow as unknown as { id: string } | null)?.id ?? null;
      try {
        let who = normalizePhone(callerNumber) ?? 'άγνωστος αριθμός';
        if (customerLink.customerId) {
          const { data: cust } = await supabase
            .from('customers')
            .select('name')
            .eq('id', customerLink.customerId)
            .maybeSingle();
          const name = (cust as { name?: string | null } | null)?.name?.trim();
          if (name) who = name;
        }
        await supabase.from('tasks').insert({
          business_id: businessId,
          customer_id: customerLink.customerId,
          offer_id: null,
          title: `Αναπάντητη κλήση — κάλεσε πίσω: ${who}`,
          type: 'call_back',
          status: 'open',
          priority: 'high',
          due_date: new Date().toISOString().slice(0, 10),
          due_time: null,
          note: null,
          created_from_ai: false,
          source_brief_id: missedCommId,
          completed_at: null,
          updated_at: new Date().toISOString(),
        });
        await sendPushToBusinessOwner(businessId, {
          title: 'Αναπάντητη κλήση',
          body: `${who} — πάτησε για να καλέσεις πίσω`,
          url: customerLink.customerId ? `/customers/${customerLink.customerId}` : '/calls',
        });
      } catch {
        // best-effort
      }

      // After-hours / missed-call auto-reply to the CUSTOMER (F3, Quo parity).
      // When enabled, send one Greek acknowledgement so the caller gets instant
      // reassurance instead of silence. Gated on the business hours: during
      // configured hours we skip it (the owner calls back fast); outside hours,
      // or when no hours are set, it fires. Best-effort + tolerant of pre-044.
      try {
        const callerPhone = normalizePhone(callerNumber);
        if (callerPhone) {
          const { data: bizRow } = await supabase
            .from('businesses')
            .select('auto_reply_enabled, auto_reply_text, business_hours')
            .eq('id', businessId)
            .maybeSingle();
          const b = bizRow as { auto_reply_enabled?: boolean; auto_reply_text?: string | null; business_hours?: unknown } | null;
          const text = b?.auto_reply_text?.trim();
          if (b?.auto_reply_enabled && text) {
            const hours = parseBusinessHours(b.business_hours);
            // Fire after-hours, or always when no hours configured.
            if (!isWithinBusinessHours(hours)) {
              let preferred: string | null = null;
              if (customerLink.customerId) {
                const { data: cust } = await supabase
                  .from('customers')
                  .select('preferred_contact_method')
                  .eq('id', customerLink.customerId)
                  .maybeSingle();
                preferred = (cust as { preferred_contact_method?: string | null } | null)?.preferred_contact_method ?? null;
              }
              const referenceId = `autoreply:${businessId.slice(0, 8)}:${Date.now().toString(36)}`;
              const sent = await sendViaPreferredChannel({ preferred, phone: callerPhone, text, customerId: customerLink.customerId, referenceId });
              if (sent.ok && sent.channel !== 'none') {
                const detail = sent.channel === 'sms' ? sent.sms : sent.viber;
                const ids = extractProviderIds(detail);
                await recordOutboundMessage({
                  businessId,
                  customerId: customerLink.customerId,
                  channel: sent.channel,
                  summary: text,
                  phone: callerPhone,
                  referenceId,
                  providerRequestId: ids.providerRequestId,
                  providerMessageId: ids.providerMessageId,
                });
              }
            }
          }
        }
      } catch {
        // best-effort: auto-reply must never fail the webhook
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

