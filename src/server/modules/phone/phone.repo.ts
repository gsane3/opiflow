// Phone — repository (data access for the five /api/phone routes).
//
// These routes read the `businesses` table by its PK (`id` IS the business id —
// there is NO business_id column there), so the business-scoped reads use
// `.eq('id', businessId)` directly, NOT tenantDb. Per-user/presence rows are scoped
// by their own (`business_id` / `user_id`) columns exactly as the live routes do.
//
// IMPORTANT: every helper returns the RAW `{ data, error }` (or a tolerant value)
// so the service/route can reproduce each route's exact branch — including the
// deliberately swallowed-error "degraded" paths — byte-for-byte. No AppError funnel
// here: these routes never use the AppError model.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import type {
  BizNumberRow,
  BrowserSipEndpointRow,
  PresenceRow,
  RecordingRow,
  SubStatusRow,
  TelephonyRow,
} from './phone.types';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ---- twilio-token gates ----------------------------------------------------

/** businesses.business_phone_number for the gate (maybeSingle; error swallowed by caller). */
export async function getBusinessNumber(
  supabase: SupabaseServer,
  businessId: string,
): Promise<BizNumberRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('business_phone_number')
    .eq('id', businessId)
    .maybeSingle();
  return (data as BizNumberRow | null) ?? null;
}

/** business_subscriptions.status for the gate (maybeSingle; error swallowed by caller). */
export async function getSubscriptionStatusRow(
  supabase: SupabaseServer,
  businessId: string,
): Promise<SubStatusRow | null> {
  const { data } = await supabase
    .from('business_subscriptions')
    .select('status, plan_key')
    .eq('business_id', businessId)
    .maybeSingle();
  return (data as SubStatusRow | null) ?? null;
}

// ---- browser-token ---------------------------------------------------------

/** businesses (id, business_phone_number) for the browser-token flow. Returns the
 *  raw { data, error } so the route can branch on businessError / missing exactly. */
export async function getBusinessForBrowserToken(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ data: { id: string; business_phone_number: string | null } | null; error: unknown }> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, business_phone_number')
    .eq('id', businessId)
    .maybeSingle();
  return { data: (data as { id: string; business_phone_number: string | null } | null) ?? null, error };
}

/** Best-effort ensure_browser_sip_endpoint RPC (bookkeeping only; caller swallows). */
export async function ensureBrowserSipEndpoint(
  supabase: SupabaseServer,
  businessId: string,
  userId: string,
): Promise<void> {
  await supabase.rpc('ensure_browser_sip_endpoint', {
    p_business_id: businessId,
    p_user_id: userId,
  });
}

/** Non-revoked browser SIP endpoint rows (latest 1) for the per-user credential path. */
export async function getBrowserSipEndpoints(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ rows: BrowserSipEndpointRow[] | null; error: unknown }> {
  const { data: rows, error } = await supabase
    .from('browser_sip_endpoints')
    .select('id, sip_username, sip_password_enc, status')
    .eq('business_id', businessId)
    .neq('status', 'revoked')
    .limit(1);
  return { rows: (rows as BrowserSipEndpointRow[] | null) ?? null, error };
}

/** Count of businesses (exact, head-only) for the shared-credential safety gate. */
export async function countBusinesses(
  supabase: SupabaseServer,
): Promise<number | null> {
  const { count } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true });
  return count ?? null;
}

// ---- telephony -------------------------------------------------------------

/** telephony GET row (maybeSingle; thrown errors caught by the service → degraded). */
export async function getTelephony(
  supabase: SupabaseServer,
  businessId: string,
): Promise<TelephonyRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('telephony_mode, forwarding_source_number, business_phone_number')
    .eq('id', businessId)
    .maybeSingle();
  return (data as TelephonyRow | null) ?? null;
}

/** telephony PUT update. Returns the raw { error } so the service mirrors the route. */
export async function updateTelephony(
  supabase: SupabaseServer,
  businessId: string,
  mode: string,
  forwardingSourceNumber: string | null,
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('businesses')
    .update({
      telephony_mode: mode,
      forwarding_source_number: forwardingSourceNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', businessId);
  return { error };
}

// ---- presence --------------------------------------------------------------

/** presence GET row (maybeSingle; thrown errors caught by the service → degraded). */
export async function getPresence(
  supabase: SupabaseServer,
  userId: string,
  businessId: string,
): Promise<PresenceRow | null> {
  const { data } = await supabase
    .from('business_user_presence')
    .select('status, updated_at')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .maybeSingle();
  return (data as PresenceRow | null) ?? null;
}

/** presence PUT upsert (onConflict user_id,business_id). Returns raw { error }. */
export async function upsertPresence(
  supabase: SupabaseServer,
  userId: string,
  businessId: string,
  status: string,
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('business_user_presence')
    .upsert(
      { user_id: userId, business_id: businessId, status, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,business_id' }
    );
  return { error };
}

// ---- recording -------------------------------------------------------------

/** recording GET row (maybeSingle). Returns raw { data, error } for the error branch. */
export async function getRecording(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ data: RecordingRow | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('businesses')
    .select('record_calls')
    .eq('id', businessId)
    .maybeSingle();
  return {
    data: (data as RecordingRow | null) ?? null,
    error: (error as { code?: string; message?: string } | null) ?? null,
  };
}

/** recording PUT update. Returns raw { error } so the service can classify it. */
export async function updateRecording(
  supabase: SupabaseServer,
  businessId: string,
  recordCalls: boolean,
): Promise<{ error: { code?: string; message?: string } | null }> {
  const { error } = await supabase
    .from('businesses')
    .update({ record_calls: recordCalls, updated_at: new Date().toISOString() })
    .eq('id', businessId);
  return { error: (error as { code?: string; message?: string } | null) ?? null };
}
