// Webhooks-voice — repository (raw service-role data access for the 7 voice webhooks).
//
// These webhooks resolve the tenant FROM the provider payload (biz_<hex> endpoint,
// dialed DID, communication_id, or the PBX_BUSINESS_ID env) and use the SERVICE-ROLE
// Supabase client — there is no authenticated user, so this module does NOT use the
// tenantDb wrapper; every query carries its explicit .eq('business_id', …) / id filter
// exactly as the original routes did. The intent is byte-identical SQL: column lists,
// filters, ordering, limits, and `.maybeSingle()`/`.single()` are preserved verbatim so
// the response shapes the PBX/Twilio callers parse never change.

import { createServerSupabaseClient } from '../../../lib/supabase/server';

export type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ---------------------------------------------------------------------------
// PBX call-completed webhook
// ---------------------------------------------------------------------------

export async function getNextCrmNumber(
  supabase: SupabaseServer,
  businessId: string,
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

export async function findOrCreateCallCustomer(
  supabase: SupabaseServer,
  businessId: string,
  rawPhone: string | null,
  normalizePhone: (raw: string | null) => string | null,
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

export async function businessExistsById(
  supabase: SupabaseServer,
  businessId: string,
): Promise<boolean> {
  const { data: bizExists } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .maybeSingle();
  return Boolean(bizExists);
}

export async function resolveBusinessIdByDid(
  supabase: SupabaseServer,
  candidates: string[],
): Promise<string | null> {
  const { data: bizRow, error: bizRowError } = await supabase
    .from('business_phone_numbers')
    .select('business_id')
    .in('e164_number', candidates)
    .eq('status', 'active')
    .maybeSingle();
  if (!bizRowError && bizRow) {
    return (bizRow as unknown as { business_id: string }).business_id ?? null;
  }
  return null;
}

export async function findExistingPbxWebhookEvent(
  supabase: SupabaseServer,
  eventId: string,
): Promise<{ id: string; processed: boolean } | null> {
  const { data: existing } = await supabase
    .from('provider_webhook_events')
    .select('id, processed')
    .eq('provider', 'pbx')
    .eq('event_id', eventId)
    .maybeSingle();
  return (existing as { id: string; processed: boolean } | null) ?? null;
}

export async function findCommunicationByUniqueId(
  supabase: SupabaseServer,
  businessId: string,
  uniqueId: string,
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const res = await supabase
    .from('communications')
    .select('id')
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .like('summary', `%uniqueid=${uniqueId}%`)
    .limit(1)
    .maybeSingle();
  return { data: (res.data as { id: string } | null) ?? null, error: res.error };
}

export async function markWebhookEventProcessed(
  supabase: SupabaseServer,
  id: string,
): Promise<void> {
  await supabase
    .from('provider_webhook_events')
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', id);
}

export async function insertPbxWebhookEvent(
  supabase: SupabaseServer,
  values: { event_id: string | null; event_type: string; payload: unknown },
): Promise<{ id: string } | null> {
  const { data: insertedWebhookEvent, error: insertError } = await supabase
    .from('provider_webhook_events')
    .insert({
      provider: 'pbx',
      event_id: values.event_id,
      event_type: values.event_type,
      payload: values.payload,
      processed: false,
    })
    .select('id')
    .single();
  if (insertError || !insertedWebhookEvent) return null;
  return insertedWebhookEvent as { id: string };
}

export async function setWebhookEventErrorMessage(
  supabase: SupabaseServer,
  id: string,
  message: string,
): Promise<void> {
  await supabase
    .from('provider_webhook_events')
    .update({ error_message: message })
    .eq('id', id);
}

export function insertCommunicationCall(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string | null;
    status: string;
    phone: string | null;
    summary: string;
  },
) {
  return supabase
    .from('communications')
    .insert({
      business_id: values.business_id,
      customer_id: values.customer_id,
      channel: 'call',
      direction: 'inbound',
      status: values.status,
      phone: values.phone,
      summary: values.summary,
    })
    .select('id')
    .single();
}

/**
 * Inbound calls are logged TWICE: the native client posts /api/calls/log on
 * hangup (Twilio client-leg CallSid) and this webhook inserts its own row
 * (Asterisk uniqueid, embedded in the summary) — two identities that never
 * match, so «Πρόσφατες» showed every call twice. Find the client's recent row
 * for the same number so the webhook can MERGE into it instead of inserting.
 * Guards: same business+phone, inbound call, recent (minutes), no PBX summary
 * yet (uniqueid=) and no brief — so two distinct calls can't be merged.
 */
export async function findRecentNativeInboundCall(
  supabase: SupabaseServer,
  businessId: string,
  phone: string,
  sinceIso: string,
): Promise<{ id: string; customer_id: string | null } | null> {
  const { data } = await supabase
    .from('communications')
    .select('id, customer_id, summary, brief_created_at')
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .eq('direction', 'inbound')
    .eq('phone', phone)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5);
  const rows = (data ?? []) as { id: string; customer_id: string | null; summary: string | null; brief_created_at: string | null }[];
  const match = rows.find((r) => !r.brief_created_at && !(r.summary ?? '').includes('uniqueid='));
  return match ? { id: match.id, customer_id: match.customer_id } : null;
}

export async function mergeCommunicationCall(
  supabase: SupabaseServer,
  id: string,
  values: { customer_id: string | null; status: string; summary: string },
) {
  const update: Record<string, unknown> = { status: values.status, summary: values.summary };
  if (values.customer_id) update.customer_id = values.customer_id;
  return supabase
    .from('communications')
    .update(update)
    .eq('id', id)
    .select('id')
    .single();
}

export async function getCustomerName(
  supabase: SupabaseServer,
  customerId: string,
): Promise<string | null | undefined> {
  const { data: cust } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle();
  return (cust as { name?: string | null } | null)?.name;
}

export async function insertMissedCallTask(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string | null;
    title: string;
    due_date: string;
    source_brief_id: string | null;
  },
): Promise<void> {
  await supabase.from('tasks').insert({
    business_id: values.business_id,
    customer_id: values.customer_id,
    offer_id: null,
    title: values.title,
    type: 'call_back',
    status: 'open',
    priority: 'high',
    due_date: values.due_date,
    due_time: null,
    note: null,
    created_from_ai: false,
    source_brief_id: values.source_brief_id,
    completed_at: null,
    updated_at: new Date().toISOString(),
  });
}

export async function getBusinessAutoReply(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ auto_reply_enabled?: boolean; auto_reply_text?: string | null; business_hours?: unknown } | null> {
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('auto_reply_enabled, auto_reply_text, business_hours')
    .eq('id', businessId)
    .maybeSingle();
  return bizRow as { auto_reply_enabled?: boolean; auto_reply_text?: string | null; business_hours?: unknown } | null;
}

export async function getCustomerPreferredContactMethod(
  supabase: SupabaseServer,
  customerId: string,
): Promise<string | null> {
  const { data: cust } = await supabase
    .from('customers')
    .select('preferred_contact_method')
    .eq('id', customerId)
    .maybeSingle();
  return (cust as { preferred_contact_method?: string | null } | null)?.preferred_contact_method ?? null;
}

// ---------------------------------------------------------------------------
// PBX recording webhook
// ---------------------------------------------------------------------------

export async function findCommunicationById(
  supabase: SupabaseServer,
  communicationIdParam: string,
): Promise<{
  data: { id: string; summary: string | null; customer_id: string | null; business_id: string | null } | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from('communications')
    .select('id, summary, customer_id, business_id')
    .eq('id', communicationIdParam)
    .eq('channel', 'call')
    .maybeSingle();
  if (error) return { data: null, error };
  if (data) {
    const row = data as unknown as { id: string; summary: string | null; customer_id: string | null; business_id: string | null };
    return { data: row, error: null };
  }
  return { data: null, error: null };
}

export async function findCommunicationForRecordingByUniqueId(
  supabase: SupabaseServer,
  businessId: string,
  uniqueid: string,
): Promise<{
  data: { id: string; summary: string | null; customer_id: string | null } | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from('communications')
    .select('id, summary, customer_id')
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .like('summary', `%uniqueid=${uniqueid}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error };
  if (data) {
    const row = data as unknown as { id: string; summary: string | null; customer_id: string | null };
    return { data: row, error: null };
  }
  return { data: null, error: null };
}

export async function markTranscriptionStarted(
  supabase: SupabaseServer,
  communicationId: string,
  businessId: string,
  auditNow: string,
): Promise<void> {
  await supabase
    .from('communications')
    .update({
      recording_received_at: auditNow,
      transcription_started_at: auditNow,
    })
    .eq('id', communicationId)
    .eq('business_id', businessId);
}

export async function markProcessingFailed(
  supabase: SupabaseServer,
  communicationId: string,
  businessId: string,
  errorCode: string,
): Promise<void> {
  await supabase
    .from('communications')
    .update({
      processing_failed_at: new Date().toISOString(),
      processing_error_code: errorCode,
    })
    .eq('id', communicationId)
    .eq('business_id', businessId);
}

export async function saveBriefToCommunication(
  supabase: SupabaseServer,
  communicationId: string,
  businessId: string,
  brief: string,
  briefNow: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('communications')
    .update({
      summary: brief,
      brief_created_at: briefNow,
      audio_discarded_at: briefNow,
      transcript_discarded_at: briefNow,
    })
    .eq('id', communicationId)
    .eq('business_id', businessId);
  return { error };
}

export async function insertAiDraftTask(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string;
    title: string;
    type: string;
    due_date: string;
    note: string;
    source_brief_id: string;
  },
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { data: taskRow, error: taskInsertError } = await supabase
    .from('tasks')
    .insert({
      business_id: values.business_id,
      customer_id: values.customer_id,
      offer_id: null,
      title: values.title,
      type: values.type,
      status: 'ai_draft',
      priority: 'normal',
      due_date: values.due_date,
      due_time: null,
      note: values.note,
      created_from_ai: true,
      source_brief_id: values.source_brief_id,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  return { data: (taskRow as { id: string } | null) ?? null, error: taskInsertError };
}

// ---------------------------------------------------------------------------
// PBX voicemail webhook
// ---------------------------------------------------------------------------

export async function findCustomerByPhone(
  supabase: SupabaseServer,
  businessId: string,
  phone: string,
): Promise<string | null> {
  const { data: cust } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (cust as { id: string } | null)?.id ?? null;
}

export async function findExistingCommunicationByUniqueId(
  supabase: SupabaseServer,
  businessId: string,
  uniqueid: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('communications')
    .select('id')
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .like('summary', `%uniqueid=${uniqueid}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (existing as { id: string } | null)?.id ?? null;
}

export async function updateCommunicationSummary(
  supabase: SupabaseServer,
  communicationId: string,
  businessId: string,
  summary: string,
): Promise<void> {
  await supabase.from('communications').update({ summary }).eq('id', communicationId).eq('business_id', businessId);
}

export function insertVoicemailCommunication(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string | null;
    status: string;
    phone: string | null;
    summary: string;
  },
) {
  return supabase
    .from('communications')
    .insert({
      business_id: values.business_id,
      customer_id: values.customer_id,
      channel: 'call',
      direction: 'inbound',
      status: values.status,
      phone: values.phone,
      summary: values.summary,
    })
    .select('id')
    .single();
}

// ---------------------------------------------------------------------------
// Twilio inbound webhook
// ---------------------------------------------------------------------------

export async function getBusinessOwnerId(
  supabase: SupabaseServer,
  businessId: string,
): Promise<string | undefined> {
  const { data: biz } = await supabase
    .from('businesses')
    .select('owner_id')
    .eq('id', businessId)
    .maybeSingle();
  return (biz as { owner_id?: string } | null)?.owner_id;
}

export async function getOwnerPresenceStatus(
  supabase: SupabaseServer,
  businessId: string,
  ownerId: string,
): Promise<string | undefined> {
  const { data: presence } = await supabase
    .from('business_user_presence')
    .select('status')
    .eq('business_id', businessId)
    .eq('user_id', ownerId)
    .maybeSingle();
  return (presence as { status?: string } | null)?.status;
}

export async function getBlockedCustomerPhones(
  supabase: SupabaseServer,
  businessId: string,
): Promise<Array<{ phone: string | null; mobile_phone: string | null; landline_phone: string | null }>> {
  const { data: blockedRows } = await supabase
    .from('customers')
    .select('phone, mobile_phone, landline_phone')
    .eq('business_id', businessId)
    .eq('blocked', true);
  return (
    (blockedRows as Array<{ phone: string | null; mobile_phone: string | null; landline_phone: string | null }> | null) ?? []
  );
}

// ---------------------------------------------------------------------------
// Twilio outbound webhook
// ---------------------------------------------------------------------------

export async function finalizeOutboundLeg(
  supabase: SupabaseServer,
  callSid: string,
  dialStatus: string,
): Promise<void> {
  await supabase
    .from('communications')
    .update({ status: dialStatus === 'completed' ? 'completed' : 'failed' })
    .eq('channel', 'call')
    .eq('provider_call_id', callSid)
    .eq('status', 'started');
}

export async function getBusinessDidWithRecord(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ data: { business_phone_number?: string | null; record_calls?: boolean | null } | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('businesses')
    .select('business_phone_number, record_calls')
    .eq('id', businessId)
    .maybeSingle();
  return {
    data: (data as { business_phone_number?: string | null; record_calls?: boolean | null } | null) ?? null,
    error,
  };
}

export async function getBusinessDidLegacy(
  supabase: SupabaseServer,
  businessId: string,
): Promise<string | null | undefined> {
  const { data: legacy } = await supabase
    .from('businesses')
    .select('business_phone_number')
    .eq('id', businessId)
    .maybeSingle();
  return (legacy as { business_phone_number?: string | null } | null)?.business_phone_number?.trim();
}

export async function countOutboundCallsSince(
  supabase: SupabaseServer,
  businessId: string,
  since: string,
): Promise<number | null | undefined> {
  const { count } = await supabase
    .from('communications')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('channel', 'call')
    .eq('direction', 'outbound')
    .gte('created_at', since);
  return count;
}

export async function findCustomerIdByPhone(
  supabase: SupabaseServer,
  businessId: string,
  phone: string,
): Promise<string | null> {
  const { data: cust } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (cust as { id: string } | null)?.id ?? null;
}

export async function insertOutboundDialTimeRow(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string | null;
    phone: string | null;
    provider_call_id: string;
  },
): Promise<{ error: { message: string } | null }> {
  const { error: insertError } = await supabase.from('communications').insert({
    business_id: values.business_id,
    customer_id: values.customer_id,
    channel: 'call',
    direction: 'outbound',
    status: 'started',
    phone: values.phone,
    summary: 'Εξερχόμενη κλήση',
    provider_call_id: values.provider_call_id,
  });
  return { error: insertError };
}

export async function insertOutboundDialTimeRowLegacy(
  supabase: SupabaseServer,
  values: {
    business_id: string;
    customer_id: string | null;
    phone: string | null;
    callSid: string;
  },
): Promise<void> {
  await supabase.from('communications').insert({
    business_id: values.business_id,
    customer_id: values.customer_id,
    channel: 'call',
    direction: 'outbound',
    status: 'started',
    phone: values.phone,
    summary: `Εξερχόμενη κλήση\ntwilio_sid=${values.callSid}`,
  });
}
