// Webhooks-voice — service (post-auth orchestration for the 7 voice webhooks).
//
// Parity-matched to the original route handlers. The signature/secret verification
// stays in the route (verbatim); this service receives the ALREADY-AUTHENTICATED,
// already-parsed inputs plus the service-role Supabase client and the effectful
// helpers (Deepgram/OpenAI transcription, push, send-channel, message-recording,
// call-brief) injected as dependencies, so it carries no behaviour-changing imports
// and every unit test stays hermetic.
//
// Every NextResponse/Response this service returns is byte-identical to the original
// route: the same status, headers, body shape, field set and key order. TwiML callers
// build the XML in the route (the twilio SDK lives there) and hand finished strings to
// the thin DB helpers below.

import { NextResponse } from 'next/server';
import type { BusinessHours } from '../../../lib/server/business-hours';
import type { CallCommRow } from '../../../lib/server/twilio-recording';
import type { SupabaseServer } from './webhooks-voice.repo';
import {
  businessExistsById,
  countOutboundCallsSince,
  findCommunicationByUniqueId,
  findCommunicationById,
  findCommunicationForRecordingByUniqueId,
  findCustomerByPhone,
  findCustomerIdByPhone,
  findExistingCommunicationByUniqueId,
  findExistingPbxWebhookEvent,
  findOrCreateCallCustomer,
  finalizeOutboundLeg,
  getBlockedCustomerPhones,
  getBusinessAutoReply,
  getBusinessDidLegacy,
  getBusinessDidWithRecord,
  getBusinessOwnerId,
  getCustomerName,
  getCustomerPreferredContactMethod,
  getOwnerPresenceStatus,
  insertAiDraftTask,
  findRecentNativeInboundCall,
  insertCommunicationCall,
  mergeCommunicationCall,
  insertMissedCallTask,
  insertOutboundDialTimeRow,
  insertOutboundDialTimeRowLegacy,
  insertPbxWebhookEvent,
  insertVoicemailCommunication,
  markProcessingFailed,
  markTranscriptionStarted,
  markWebhookEventProcessed,
  resolveBusinessIdByDid,
  saveBriefToCommunication,
  setWebhookEventErrorMessage,
  updateCommunicationSummary,
} from './webhooks-voice.repo';

// ===========================================================================
// PBX call-completed webhook
// ===========================================================================

export interface PbxDeps {
  generateCallBrief: (input: {
    callerNumber: string | null;
    dialStatus: string | null;
    uniqueId: string | null;
    recordingExists: boolean | null;
    recordingSizeBytes: number | null;
    recordingFallbackApplied: boolean | null;
    customerCreated: boolean;
    customerMatched: boolean;
    intakeUrlCreated: boolean;
    viberSendStatus: string | null;
  }) => Promise<string | null>;
  sendPushToBusinessOwner: (businessId: string, payload: { title: string; body: string; url?: string }) => Promise<unknown>;
  sendViaPreferredChannel: (params: {
    preferred: string | null;
    phone: string | null;
    text: string;
    customerId: string | null;
    referenceId: string;
  }) => Promise<{ ok: boolean; channel: 'viber' | 'sms' | 'none'; sms?: unknown; viber?: unknown }>;
  extractProviderIds: (detail: unknown) => { providerRequestId: string | null; providerMessageId: string | null };
  recordOutboundMessage: (params: {
    businessId: string;
    customerId: string | null;
    channel: 'viber' | 'sms';
    summary: string;
    phone: string | null;
    referenceId: string;
    providerRequestId: string | null;
    providerMessageId: string | null;
  }) => Promise<unknown>;
  isWithinBusinessHours: (hours: BusinessHours | null | undefined, date?: Date) => boolean;
  parseBusinessHours: (v: unknown) => BusinessHours | null;
  normalizePhone: (raw: string | null) => string | null;
}

export interface PbxInput {
  parsed: Record<string, unknown>;
  eventId: string | null;
  eventType: string;
  callerNumber: string | null;
  bizEndpointId: string | null;
  calledNumberRaw: string | null;
  pbxBusinessIdFromEnv: string | null;
  dialStatus: string | null;
  uniqueId: string | null;
  recordingExists: boolean | null;
  recordingSizeBytes: number | null;
  recordingFallbackApplied: boolean | null;
  consentAnnounced: boolean | null;
}

/** Resolve the business_id for a PBX event (biz_<hex> → dialed DID → env). */
export async function resolvePbxBusinessId(
  supabase: SupabaseServer,
  input: PbxInput,
): Promise<string | null> {
  let businessId: string | null = null;

  // 1) Trust the biz_<hex> endpoint the PBX rang.
  if (input.bizEndpointId) {
    if (await businessExistsById(supabase, input.bizEndpointId)) businessId = input.bizEndpointId;
  }

  // 2) Otherwise resolve by the dialed DID against business_phone_numbers.
  if (!businessId && input.calledNumberRaw) {
    const digits = input.calledNumberRaw.replace(/\D/g, '');
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
      businessId = await resolveBusinessIdByDid(supabase, Array.from(candidates));
    }
  }

  if (!businessId) {
    businessId = input.pbxBusinessIdFromEnv;
  }

  return businessId;
}

/** The full post-auth PBX call-completed pipeline. Returns the exact route response. */
export async function processPbxCallCompleted(
  supabase: SupabaseServer,
  businessId: string,
  input: PbxInput,
  deps: PbxDeps,
): Promise<NextResponse> {
  const { normalizePhone } = deps;
  const {
    parsed,
    eventId,
    eventType,
    callerNumber,
    dialStatus,
    uniqueId,
    recordingExists,
    recordingSizeBytes,
    recordingFallbackApplied,
    consentAnnounced,
  } = input;

  try {
    let webhookEventId: string | null = null;

    // Idempotency check.
    if (eventId !== null) {
      const existing = await findExistingPbxWebhookEvent(supabase, eventId);

      if (existing?.processed) {
        return NextResponse.json({ ok: true, received: true, duplicate: true });
      }

      if (existing && !existing.processed) {
        const existingCommunicationQuery = uniqueId
          ? await findCommunicationByUniqueId(supabase, businessId, uniqueId)
          : { data: null, error: null };

        if (existingCommunicationQuery.error) {
          return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
        }

        if (existingCommunicationQuery.data) {
          await markWebhookEventProcessed(supabase, existing.id);

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
      const insertedWebhookEvent = await insertPbxWebhookEvent(supabase, {
        event_id: eventId,
        event_type: eventType,
        payload: parsed,
      });

      if (!insertedWebhookEvent) {
        return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
      }

      webhookEventId = insertedWebhookEvent.id;
    }

    let customerLink: { customerId: string | null; customerCreated: boolean; customerMatched: boolean };
    try {
      customerLink = await findOrCreateCallCustomer(supabase, businessId, callerNumber, normalizePhone);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'customer_link_failed';

      await setWebhookEventErrorMessage(supabase, webhookEventId, message);

      return NextResponse.json({ ok: false, error: 'customer_link_failed' }, { status: 500 });
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
    ].filter(Boolean).join(' ');

    let aiBrief: string | null = null;
    try {
      aiBrief = await deps.generateCallBrief({
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
      communicationSummary = `${aiBrief}\n\n---\nPBX metadata:\n${summaryParts}`;
    } else {
      const label = notAnswered
        ? 'Αναπάντητη κλήση'
        : recordingExists
        ? 'Κλήση — γίνεται επεξεργασία της ηχογράφησης…'
        : 'Κλήση χωρίς ηχογράφηση';
      communicationSummary = `${label}\n\n---\nPBX metadata:\n${summaryParts}`;
    }

    const commInsert = (status: string) =>
      insertCommunicationCall(supabase, {
        business_id: businessId,
        customer_id: customerLink.customerId,
        status,
        phone: normalizePhone(callerNumber),
        summary: communicationSummary,
      });

    // The native client usually logs the same call first (on hangup) with the
    // Twilio CallSid — an identity this webhook can't match. Merge into that
    // row instead of inserting a duplicate; the merged summary carries the
    // `uniqueid=` marker, so the pbx-recording webhook still attaches the brief.
    let mergedRow: { id: string } | null = null;
    const normalizedCaller = normalizePhone(callerNumber);
    if (normalizedCaller) {
      const sinceIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const nativeRow = await findRecentNativeInboundCall(supabase, businessId, normalizedCaller, sinceIso);
      if (nativeRow) {
        const { data } = await mergeCommunicationCall(supabase, nativeRow.id, {
          customer_id: customerLink.customerId,
          status: notAnswered ? 'missed' : 'completed',
          summary: communicationSummary,
        });
        mergedRow = (data as { id: string } | null) ?? null;
      }
    }

    let communicationRow: unknown = mergedRow;
    let communicationError: { message: string } | null = null;
    if (!mergedRow) {
      ({ data: communicationRow, error: communicationError } = await commInsert(
        notAnswered ? 'missed' : 'completed'
      ));
      if (communicationError && notAnswered) {
        ({ data: communicationRow, error: communicationError } = await commInsert('failed'));
      }
    }

    if (communicationError) {
      await setWebhookEventErrorMessage(supabase, webhookEventId, communicationError.message);

      return NextResponse.json({ ok: false, error: 'communication_store_failed' }, { status: 500 });
    }

    if (notAnswered) {
      const missedCommId = (communicationRow as unknown as { id: string } | null)?.id ?? null;
      try {
        let who = normalizePhone(callerNumber) ?? 'άγνωστος αριθμός';
        if (customerLink.customerId) {
          const name = (await getCustomerName(supabase, customerLink.customerId))?.trim();
          if (name) who = name;
        }
        await insertMissedCallTask(supabase, {
          business_id: businessId,
          customer_id: customerLink.customerId,
          title: `Αναπάντητη κλήση — κάλεσε πίσω: ${who}`,
          due_date: new Date().toISOString().slice(0, 10),
          source_brief_id: missedCommId,
        });
        await deps.sendPushToBusinessOwner(businessId, {
          title: 'Αναπάντητη κλήση',
          body: `${who} — πάτησε για να καλέσεις πίσω`,
          url: customerLink.customerId ? `/customers/${customerLink.customerId}` : '/calls',
        });
      } catch {
        // best-effort
      }

      try {
        const callerPhone = normalizePhone(callerNumber);
        if (callerPhone) {
          const b = await getBusinessAutoReply(supabase, businessId);
          const text = b?.auto_reply_text?.trim();
          if (b?.auto_reply_enabled && text) {
            const hours = deps.parseBusinessHours(b.business_hours);
            if (!deps.isWithinBusinessHours(hours)) {
              let preferred: string | null = null;
              if (customerLink.customerId) {
                preferred = await getCustomerPreferredContactMethod(supabase, customerLink.customerId);
              }
              const referenceId = `autoreply:${businessId.slice(0, 8)}:${Date.now().toString(36)}`;
              const sent = await deps.sendViaPreferredChannel({ preferred, phone: callerPhone, text, customerId: customerLink.customerId, referenceId });
              if (sent.ok && sent.channel !== 'none') {
                const detail = sent.channel === 'sms' ? sent.sms : sent.viber;
                const ids = deps.extractProviderIds(detail);
                await deps.recordOutboundMessage({
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

    await markWebhookEventProcessed(supabase, webhookEventId);

    const finalCommId = (communicationRow as unknown as { id: string } | null)?.id ?? null;
    return NextResponse.json({ ok: true, received: true, communication_created: true, communication_id: finalCommId, customer_id: customerLink.customerId, customer_created: customerLink.customerCreated, customer_matched: customerLink.customerMatched });
  } catch {
    return NextResponse.json({ ok: false, error: 'webhook_store_failed' }, { status: 500 });
  }
}

// ===========================================================================
// PBX recording webhook
// ===========================================================================

export interface PbxRecordingDeps {
  transcribeAndBriefCallAudio: (input: {
    audioFile: File;
    callerNumber: string | null;
    dialStatus: string | null;
    uniqueId: string | null;
    communicationSummary: string | null;
  }) => Promise<{
    transcript: string;
    brief: string;
    taskTitle: string;
    taskNote: string;
    taskType: 'call_back' | 'follow_up_offer';
    taskDueDate: string;
  } | null>;
  appendCallBrief: (
    supabase: SupabaseServer,
    params: {
      businessId: string;
      customerId?: string | null;
      communicationId?: string | null;
      briefKind: 'metadata' | 'transcript';
      briefText: string | null | undefined;
    },
  ) => Promise<void>;
}

export interface PbxRecordingInput {
  audioFile: File;
  uniqueid: string | null;
  communicationIdParam: string | null;
  callerNumber: string | null;
  dialStatus: string | null;
  bizEndpointId: string | null;
  pbxBusinessIdFromEnv: string | null;
}

export async function processPbxRecording(
  supabase: SupabaseServer,
  input: PbxRecordingInput,
  deps: PbxRecordingDeps,
): Promise<NextResponse> {
  const { audioFile, uniqueid, communicationIdParam, callerNumber, dialStatus, bizEndpointId, pbxBusinessIdFromEnv } = input;

  let businessId: string | null = null;
  let communicationId: string | null = null;
  let existingSummary: string | null = null;
  let communicationCustomerId: string | null = null;

  if (communicationIdParam) {
    const { data, error } = await findCommunicationById(supabase, communicationIdParam);

    if (error) {
      return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
    }

    if (data) {
      communicationId = data.id;
      existingSummary = data.summary;
      communicationCustomerId = data.customer_id ?? null;
      businessId = data.business_id ?? null;
    }
  }

  if (!businessId) businessId = bizEndpointId ?? pbxBusinessIdFromEnv;

  if (!businessId) {
    return NextResponse.json({ ok: false, received: true, error: 'business_unresolved' });
  }

  if (!communicationId && uniqueid) {
    const { data, error } = await findCommunicationForRecordingByUniqueId(supabase, businessId, uniqueid);

    if (error) {
      return NextResponse.json({ ok: false, error: 'communication_lookup_failed' }, { status: 500 });
    }

    if (data) {
      communicationId = data.id;
      existingSummary = data.summary;
      communicationCustomerId = data.customer_id ?? null;
    }
  }

  if (!communicationId) {
    return NextResponse.json({
      ok: false,
      received: true,
      error: 'communication_not_found',
    });
  }

  const auditNow = new Date().toISOString();
  await markTranscriptionStarted(supabase, communicationId, businessId, auditNow);

  const result = await deps.transcribeAndBriefCallAudio({
    audioFile,
    callerNumber,
    dialStatus,
    uniqueId: uniqueid,
    communicationSummary: existingSummary,
  });

  if (!result) {
    await markProcessingFailed(supabase, communicationId, businessId, 'transcription_or_brief_failed');
    return NextResponse.json({
      ok: false,
      received: true,
      error: 'transcription_failed',
    });
  }

  const briefNow = new Date().toISOString();
  const { error: updateError } = await saveBriefToCommunication(supabase, communicationId, businessId, result.brief, briefNow);

  if (updateError) {
    await markProcessingFailed(supabase, communicationId, businessId, 'communication_update_failed');
    return NextResponse.json(
      { ok: false, error: 'communication_update_failed' },
      { status: 500 }
    );
  }

  await deps.appendCallBrief(supabase, {
    businessId,
    customerId: communicationCustomerId,
    communicationId,
    briefKind: 'transcript',
    briefText: result.brief,
  });

  let taskCreated = false;
  let taskId: string | null = null;
  let taskError: string | null = null;

  if (communicationCustomerId && result.taskTitle) {
    const { data: taskRow, error: taskInsertError } = await insertAiDraftTask(supabase, {
      business_id: businessId,
      customer_id: communicationCustomerId,
      title: result.taskTitle,
      type: result.taskType,
      due_date: result.taskDueDate,
      note: result.taskNote,
      source_brief_id: communicationId,
    });

    if (taskInsertError || !taskRow) {
      taskError = 'task_create_failed';
      await markProcessingFailed(supabase, communicationId, businessId, 'task_insert_failed');
    } else {
      taskCreated = true;
      taskId = (taskRow as unknown as { id: string }).id;
    }
  }

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: communicationId,
    task_created: taskCreated,
    task_id: taskId,
    ...(taskError ? { task_error: taskError } : {}),
    transcript_length: result.transcript.length,
    brief_length: result.brief.length,
  });
}

// ===========================================================================
// PBX voicemail webhook
// ===========================================================================

export interface PbxVoicemailDeps {
  transcribeAndBriefCallAudio: PbxRecordingDeps['transcribeAndBriefCallAudio'];
  appendCallBrief: PbxRecordingDeps['appendCallBrief'];
  sendPushToBusinessOwner: (businessId: string, payload: { title: string; body: string; url?: string }) => Promise<unknown>;
}

export interface PbxVoicemailInput {
  audioFile: File;
  caller: string | null;
  uniqueid: string | null;
}

export async function processPbxVoicemail(
  supabase: SupabaseServer,
  businessId: string,
  input: PbxVoicemailInput,
  deps: PbxVoicemailDeps,
): Promise<NextResponse> {
  const { audioFile, caller, uniqueid } = input;

  const result = await deps.transcribeAndBriefCallAudio({
    audioFile,
    callerNumber: caller,
    dialStatus: 'VOICEMAIL',
    uniqueId: uniqueid,
    communicationSummary: null,
  });

  const voicemailText = result?.brief ?? null;
  const summary = voicemailText
    ? `Φωνητικό μήνυμα:\n${voicemailText}`
    : 'Φωνητικό μήνυμα (η απομαγνητοφώνηση απέτυχε).';

  let customerId: string | null = null;
  if (caller) {
    customerId = await findCustomerByPhone(supabase, businessId, caller);
  }

  let communicationId: string | null = null;
  if (uniqueid) {
    const exId = await findExistingCommunicationByUniqueId(supabase, businessId, uniqueid);
    if (exId) {
      await updateCommunicationSummary(supabase, exId, businessId, summary);
      communicationId = exId;
    }
  }
  if (!communicationId) {
    const insert = (status: string) =>
      insertVoicemailCommunication(supabase, {
        business_id: businessId,
        customer_id: customerId,
        status,
        phone: caller,
        summary,
      });
    let { data: row, error } = await insert('missed');
    if (error) ({ data: row, error } = await insert('failed')); // pre-043 fallback
    communicationId = (row as { id: string } | null)?.id ?? null;
  }

  if (communicationId && voicemailText) {
    await deps.appendCallBrief(supabase, { businessId, customerId, communicationId, briefKind: 'transcript', briefText: summary });
  }
  try {
    await deps.sendPushToBusinessOwner(businessId, {
      title: 'Νέο φωνητικό μήνυμα',
      body: caller ? `Από ${caller}` : 'Άκουσε/διάβασε το μήνυμα',
      url: customerId ? `/customers/${customerId}` : '/calls',
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ ok: true, communication_id: communicationId, transcribed: Boolean(voicemailText) });
}

// ===========================================================================
// Twilio inbound webhook — DB-side decisions (DND + block list)
// ===========================================================================

/** True when the owner has DND on (reject as busy). Fail-open on any DB hiccup. */
export async function isOwnerDnd(
  supabase: SupabaseServer,
  businessId: string,
): Promise<boolean> {
  const ownerId = await getBusinessOwnerId(supabase, businessId);
  if (ownerId) {
    const status = await getOwnerPresenceStatus(supabase, businessId, ownerId);
    if (status === 'dnd') return true;
  }
  return false;
}

/** True when the caller's last-10-digits matches a BLOCKED contact. */
export async function isCallerBlocked(
  supabase: SupabaseServer,
  businessId: string,
  last10: string,
): Promise<boolean> {
  const rows = await getBlockedCustomerPhones(supabase, businessId);
  return rows.some((r) =>
    [r.phone, r.mobile_phone, r.landline_phone].some((p) => (p ?? '').replace(/\D/g, '').slice(-10) === last10),
  );
}

// ===========================================================================
// Twilio outbound webhook — DB-side steps
// ===========================================================================

/** <Dial action> callback: finalise the dial-time row. Best-effort. */
export async function finalizeOutboundDialLeg(
  supabase: SupabaseServer,
  callSid: string,
  dialStatus: string,
): Promise<void> {
  await finalizeOutboundLeg(supabase, callSid, dialStatus);
}

export type OutboundResolution =
  | { kind: 'not_activated' }
  | { kind: 'capped' }
  | { kind: 'ok'; callerId: string; recordCalls: boolean };

/**
 * Resolve the DID/record preference, enforce the daily cap, and insert the
 * dial-time communications row. Returns a discriminated result the route maps to
 * the exact TwiML; throwing/DB-outage handling stays in the route's try/catch.
 */
export async function resolveOutboundDialPlan(
  supabase: SupabaseServer,
  args: {
    businessId: string;
    digits: string;
    callSid: string;
    dailyCallCap: number;
    normalizePhone: (raw: string) => string | null;
  },
): Promise<OutboundResolution> {
  const { businessId, digits, callSid, dailyCallCap, normalizePhone } = args;

  let recordCalls = true;
  let did: string | undefined;
  const { data, error: bizError } = await getBusinessDidWithRecord(supabase, businessId);
  if (bizError) {
    did = (await getBusinessDidLegacy(supabase, businessId)) ?? undefined;
  } else {
    did = data?.business_phone_number?.trim();
    if (data?.record_calls === false) recordCalls = false;
  }
  if (!did) {
    return { kind: 'not_activated' };
  }
  const callerId = did.replace(/^\+/, '');

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = await countOutboundCallsSince(supabase, businessId, since);
  if ((count ?? 0) >= dailyCallCap) {
    return { kind: 'capped' };
  }

  if (callSid) {
    const phone = normalizePhone(digits);
    let customerId: string | null = null;
    if (phone) {
      customerId = await findCustomerIdByPhone(supabase, businessId, phone);
    }
    const { error: insertError } = await insertOutboundDialTimeRow(supabase, {
      business_id: businessId,
      customer_id: customerId,
      phone,
      provider_call_id: callSid,
    });
    if (insertError) {
      await insertOutboundDialTimeRowLegacy(supabase, {
        business_id: businessId,
        customer_id: customerId,
        phone,
        callSid,
      });
    }
  }

  return { kind: 'ok', callerId, recordCalls };
}

// ===========================================================================
// Twilio RecordingStatusCallback webhook
// ===========================================================================

export interface TwilioRecordingDeps {
  findCallCommunication: (supabase: SupabaseServer, callSid: string) => Promise<CallCommRow | null>;
  persistRecordingEvent: (
    supabase: SupabaseServer,
    args: { callSid: string; recordingUrl: string; recordingSid: string | null; fromNumber: string | null; reason: string },
  ) => Promise<void>;
  deleteTwilioRecording: (recordingSid: string, accountSid: string, authToken: string) => Promise<boolean>;
  downloadRecordingWav: (
    recordingUrl: string,
    accountSid: string,
    authToken: string,
  ) => Promise<{ file: File } | { error: 'download_failed' | 'size_invalid' }>;
  processRecordingForCommunication: (args: {
    supabase: SupabaseServer;
    comm: CallCommRow;
    audioFile: File;
    fromNumber: string | null;
    callSid: string;
  }) => Promise<boolean>;
}

export interface TwilioRecordingInput {
  accountSid: string;
  authToken: string;
  callSid: string;
  recordingUrl: string;
  recordingSid: string | null;
  fromNumber: string | null;
}

/**
 * The post-auth Twilio recording pipeline. The route handles env-gating, form
 * parsing, signature validation, the missing-url/status guards and the Supabase
 * client creation; this runs once a completed recording with a CallSid is in hand.
 * Returns the exact route response for each branch (communication_not_found,
 * already_processed, recording_size_invalid, recording_download_failed,
 * transcription_failed, communication_updated).
 */
export async function processTwilioRecording(
  supabase: SupabaseServer,
  input: TwilioRecordingInput,
  deps: TwilioRecordingDeps,
): Promise<NextResponse> {
  const { accountSid, authToken, callSid, recordingUrl, recordingSid, fromNumber } = input;

  const comm = await deps.findCallCommunication(supabase, callSid);

  if (!comm) {
    // Not logged yet (e.g. the dial-time insert failed) — persist for the
    // reconcile cron and keep the recording at Twilio until it succeeds.
    await deps.persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'communication_not_found',
    });
    return NextResponse.json({ ok: true, received: true, error: 'communication_not_found' });
  }

  // Idempotency: a re-delivered callback for an already-briefed call only
  // needs the cloud-side cleanup.
  if (comm.brief_created_at) {
    if (recordingSid) await deps.deleteTwilioRecording(recordingSid, accountSid, authToken);
    return NextResponse.json({ ok: true, received: true, already_processed: true });
  }

  const download = await deps.downloadRecordingWav(recordingUrl, accountSid, authToken);
  if ('error' in download) {
    if (download.error === 'size_invalid') {
      // Unusable audio — never retryable; delete the cloud copy.
      if (recordingSid) await deps.deleteTwilioRecording(recordingSid, accountSid, authToken);
      return NextResponse.json({ ok: true, received: true, error: 'recording_size_invalid' });
    }
    await deps.persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'download_failed',
    });
    return NextResponse.json({ ok: true, received: true, error: 'recording_download_failed' });
  }

  const okProcessed = await deps.processRecordingForCommunication({
    supabase,
    comm,
    audioFile: download.file,
    fromNumber,
    callSid,
  });

  if (!okProcessed) {
    // Transient Deepgram/OpenAI failure — schedule a retry, keep the recording.
    await deps.persistRecordingEvent(supabase, {
      callSid,
      recordingUrl,
      recordingSid,
      fromNumber,
      reason: 'transcription_failed',
    });
    return NextResponse.json({ ok: true, received: true, error: 'transcription_failed' });
  }

  // Success — the brief is in the CRM; remove the cloud copy (privacy + cost).
  if (recordingSid) await deps.deleteTwilioRecording(recordingSid, accountSid, authToken);

  return NextResponse.json({
    ok: true,
    received: true,
    communication_updated: true,
    communication_id: comm.id,
  });
}
