// webhooks-other — repository (raw DB access for the Stripe + Apifon webhooks).
//
// These webhooks resolve the tenant FROM the provider payload (Stripe metadata.businessId
// / an Apifon viber_messages lookup) and run on the service-role client, so there is NO
// authenticated user context here — the explicit .eq filters below ARE the scoping. Every
// query/upsert is byte-identical to the originating route handlers.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// --- Stripe -----------------------------------------------------------------

// Idempotent upsert keyed on the business_subscriptions.business_id UNIQUE. If no
// row exists yet (e.g. the webhook raced ahead of signup), insert one. Returns
// false on any DB error so the caller can force Stripe to retry. `planKey` is the
// app-wide PLAN.key (passed down from the route) so the insert shape is unchanged.
export async function applySubscription(
  supabase: SupabaseServer,
  businessId: string,
  planKey: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from('business_subscriptions')
    .update(fields)
    .eq('business_id', businessId)
    .select('id');
  if (error) return false;
  if (Array.isArray(data) && data.length > 0) return true;
  const { error: insErr } = await supabase
    .from('business_subscriptions')
    .insert({ business_id: businessId, plan_key: planKey, ...fields });
  return !insErr;
}

// --- Apifon -----------------------------------------------------------------

export interface ViberMessageMatch {
  id: string;
  business_id: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  communication_id: string | null;
}

const VIBER_MATCH_COLUMNS = 'id, business_id, delivered_at, failed_at, communication_id';

export async function findViberMessageRow(
  supabase: SupabaseServer,
  msgId: string | null,
  reqId: string | null,
  refId: string | null
): Promise<ViberMessageMatch | null> {
  if (msgId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('provider', 'apifon')
      .eq('provider_message_id', msgId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  if (reqId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('provider', 'apifon')
      .eq('provider_request_id', reqId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  if (refId) {
    const { data } = await supabase
      .from('viber_messages')
      .select(VIBER_MATCH_COLUMNS)
      .eq('reference_id', refId)
      .maybeSingle();
    if (data) return data as unknown as ViberMessageMatch;
  }
  return null;
}

export async function findProviderEventId(
  supabase: SupabaseServer,
  eventId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('provider_webhook_events')
    .select('id')
    .eq('provider', 'apifon')
    .eq('event_id', eventId)
    .maybeSingle();
  if (existing) {
    return (existing as unknown as { id: string }).id;
  }
  return null;
}

export async function insertProviderEvent(
  supabase: SupabaseServer,
  values: {
    event_id: string | null;
    event_type: string;
    payload: unknown;
  }
): Promise<string | null> {
  const { data: inserted } = await supabase
    .from('provider_webhook_events')
    .insert({
      provider: 'apifon',
      event_id: values.event_id,
      event_type: values.event_type,
      payload: values.payload,
      processed: false,
    })
    .select('id')
    .single();
  if (inserted) {
    return (inserted as unknown as { id: string }).id;
  }
  return null;
}

export async function updateViberMessage(
  supabase: SupabaseServer,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await supabase
    .from('viber_messages')
    .update(fields)
    .eq('id', id);
}

export async function updateCommunicationStatus(
  supabase: SupabaseServer,
  communicationId: string,
  commStatus: string,
  allowedPrior: string[],
  businessId: string | null
): Promise<void> {
  // Tenant-scope the update by the matched viber_messages row's
  // business_id (defense-in-depth: the status propagation must never
  // be able to touch a communications row outside that tenant).
  let commUpdate = supabase
    .from('communications')
    .update({ status: commStatus })
    .eq('id', communicationId)
    .in('status', allowedPrior);
  if (businessId) {
    commUpdate = commUpdate.eq('business_id', businessId);
  }
  await commUpdate;
}

export async function markProviderEventProcessed(
  supabase: SupabaseServer,
  providerEventId: string,
  now: string
): Promise<void> {
  await supabase
    .from('provider_webhook_events')
    .update({ processed: true, processed_at: now })
    .eq('id', providerEventId);
}
