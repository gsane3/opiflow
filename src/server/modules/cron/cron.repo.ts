// Cron — repository (data access for the machine-auth cron jobs).
//
// These jobs are system-wide (NOT per-user): they iterate businesses and scan
// rows across all tenants using the service-role client supplied by the route.
// Tenant scoping stays explicit (.eq('business_id', ...)) exactly as the routes
// did — there is no user-derived tenant context here.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ---------------------------------------------------------------------------
// folder-unread-reminder
// ---------------------------------------------------------------------------

export interface UnreadRow {
  business_id: string;
  work_folder_id: string;
  customer_id: string | null;
}

export async function selectUnreadCandidates(
  supabase: SupabaseServer,
  olderThanIso: string,
  newerThanIso: string,
  limit: number,
): Promise<{ data: UnreadRow[] | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('communications')
    .select('business_id, work_folder_id, customer_id')
    .is('read_at', null)
    .eq('direction', 'outbound')
    .not('work_folder_id', 'is', null)
    .in('channel', ['sms', 'viber', 'email'])
    .lt('created_at', olderThanIso)
    .gt('created_at', newerThanIso)
    .order('created_at', { ascending: true })
    .limit(limit);
  return { data: (data ?? null) as UnreadRow[] | null, error };
}

export async function getFolderForNudge(
  supabase: SupabaseServer,
  workFolderId: string,
  businessId: string,
): Promise<{ title: string | null; customer_id: string | null } | null> {
  const { data: folder } = await supabase
    .from('work_folders')
    .select('title, customer_id')
    .eq('id', workFolderId)
    .eq('business_id', businessId)
    .maybeSingle();
  return folder as { title: string | null; customer_id: string | null } | null;
}

// ---------------------------------------------------------------------------
// intake-reminder
// ---------------------------------------------------------------------------

export interface CandidateTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
  reminder_count: number | null;
  reminder_sent_at: string | null;
}

export interface CustomerRow {
  id: string;
  business_id: string;
  name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  preferred_contact_method: string | null;
}

export async function selectReminderCandidates(
  supabase: SupabaseServer,
  nowIso: string,
  staleBeforeIso: string,
  maxReminders: number,
  limit: number,
): Promise<{ data: CandidateTokenRow[] | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .select('id, business_id, customer_id, reminder_count, reminder_sent_at')
    .eq('status', 'sent')
    .is('submitted_at', null)
    .gt('expires_at', nowIso)
    .lt('updated_at', staleBeforeIso)
    .lt('reminder_count', maxReminders)
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${staleBeforeIso}`)
    .order('updated_at', { ascending: true })
    .limit(limit);
  return { data: (data ?? null) as CandidateTokenRow[] | null, error };
}

export async function fetchCustomerForReminder(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
): Promise<{ data: CustomerRow | null; error: unknown }> {
  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id, business_id, name, phone, mobile_phone, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return { data: (customerData as unknown as CustomerRow) ?? null, error: customerError };
}

export async function markTokenSent(
  supabase: SupabaseServer,
  newTokenId: string,
  sentChannel: string | null,
  phone: string,
  nextReminderCount: number,
  sentNowIso: string,
): Promise<void> {
  await supabase
    .from('customer_intake_tokens')
    .update({
      status: 'sent',
      sent_channel: sentChannel,
      sent_to_phone: phone,
      reminder_count: nextReminderCount,
      reminder_sent_at: sentNowIso,
      updated_at: sentNowIso,
    })
    .eq('id', newTokenId);
}

export async function revokeToken(
  supabase: SupabaseServer,
  tokenId: string,
  sentNowIso: string,
): Promise<void> {
  await supabase
    .from('customer_intake_tokens')
    .update({
      status: 'revoked',
      revoked_at: sentNowIso,
      updated_at: sentNowIso,
    })
    .eq('id', tokenId);
}

export async function bumpReminderBookkeeping(
  supabase: SupabaseServer,
  tokenId: string,
  nextReminderCount: number,
  sentNowIso: string,
): Promise<void> {
  await supabase
    .from('customer_intake_tokens')
    .update({
      reminder_count: nextReminderCount,
      reminder_sent_at: sentNowIso,
      updated_at: sentNowIso,
    })
    .eq('id', tokenId);
}

export interface ExpireCandidateRow {
  id: string;
  business_id: string;
  customer_id: string;
}

export async function selectExpireCandidates(
  supabase: SupabaseServer,
  graceBeforeIso: string,
  maxReminders: number,
  limit: number,
): Promise<{ data: ExpireCandidateRow[] | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .select('id, business_id, customer_id')
    .eq('status', 'sent')
    .is('submitted_at', null)
    .gte('reminder_count', maxReminders)
    .lt('reminder_sent_at', graceBeforeIso)
    .limit(limit);
  return { data: (data ?? null) as ExpireCandidateRow[] | null, error };
}

export async function expireToken(supabase: SupabaseServer, tokenId: string, ts: string): Promise<void> {
  await supabase
    .from('customer_intake_tokens')
    .update({ status: 'expired', updated_at: ts })
    .eq('id', tokenId);
}

export async function expireCustomerIntake(
  supabase: SupabaseServer,
  customerId: string,
  businessId: string,
  ts: string,
): Promise<void> {
  await supabase
    .from('customers')
    .update({ intake_status: 'expired', updated_at: ts })
    .eq('id', customerId)
    .eq('business_id', businessId)
    .neq('intake_status', 'submitted');
}

// ---------------------------------------------------------------------------
// recordings-reconcile
// ---------------------------------------------------------------------------

export interface PendingEvent {
  id: string;
  created_at: string;
  payload: {
    call_sid?: string;
    recording_url?: string;
    recording_sid?: string | null;
    from_number?: string | null;
  } | null;
}

export async function selectPendingRecordingEvents(
  supabase: SupabaseServer,
  limit: number,
): Promise<{ data: PendingEvent[] | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('provider_webhook_events')
    .select('id, created_at, payload')
    .eq('provider', 'twilio')
    .eq('event_type', 'recording_pending')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  return { data: (data ?? null) as unknown as PendingEvent[] | null, error };
}

export async function markRecordingEventProcessed(
  supabase: SupabaseServer,
  eventId: string,
  errorMessage: string | null,
): Promise<void> {
  await supabase
    .from('provider_webhook_events')
    .update({ processed: true, processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq('id', eventId);
}

// ---------------------------------------------------------------------------
// scheduled-messages
// ---------------------------------------------------------------------------

export interface ScheduledMessageRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  channel: string;
  body: string;
}

export async function selectDueScheduledMessages(
  supabase: SupabaseServer,
  nowIso: string,
  limit: number,
): Promise<{ data: ScheduledMessageRow[] | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('id, business_id, customer_id, channel, body')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  return { data: (data ?? null) as ScheduledMessageRow[] | null, error };
}

export async function fetchCustomerForScheduledMessage(
  supabase: SupabaseServer,
  customerId: string,
): Promise<{ phone: string | null; mobile_phone: string | null; landline_phone: string | null; preferred_contact_method: string | null } | null> {
  const { data: cust } = await supabase
    .from('customers')
    .select('phone, mobile_phone, landline_phone, preferred_contact_method')
    .eq('id', customerId)
    .maybeSingle();
  return cust as { phone: string | null; mobile_phone: string | null; landline_phone: string | null; preferred_contact_method: string | null } | null;
}

export async function markScheduledMessageFailed(
  supabase: SupabaseServer,
  id: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from('scheduled_messages')
    .update({ status: 'failed', error_message: errorMessage, sent_at: new Date().toISOString() })
    .eq('id', id);
}

export async function markScheduledMessageSent(supabase: SupabaseServer, id: string): Promise<void> {
  await supabase
    .from('scheduled_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id);
}

// ---------------------------------------------------------------------------
// weekly-summary
// ---------------------------------------------------------------------------

export async function selectBusinesses(
  supabase: SupabaseServer,
): Promise<{ data: Array<{ id: string }> | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase.from('businesses').select('id');
  return { data: (data ?? null) as Array<{ id: string }> | null, error };
}

export async function fetchWeeklySummaryOptOut(
  supabase: SupabaseServer,
  businessId: string,
): Promise<{ data: { weekly_summary_enabled?: boolean } | null; error: unknown }> {
  const { data: optRow, error: optErr } = await supabase
    .from('businesses')
    .select('weekly_summary_enabled')
    .eq('id', businessId)
    .maybeSingle();
  return { data: (optRow as { weekly_summary_enabled?: boolean } | null), error: optErr };
}

export async function countWeeklyStats(
  supabase: SupabaseServer,
  businessId: string,
  weekAgoIso: string,
  followupTypes: string[],
): Promise<{ calls: number; missed: number; openFollowups: number }> {
  const [callsRes, missedRes, tasksRes] = await Promise.all([
    supabase
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .gte('created_at', weekAgoIso),
    supabase
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .in('status', ['missed', 'failed'])
      .gte('created_at', weekAgoIso),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'open')
      .in('type', followupTypes),
  ]);

  return {
    calls: callsRes.count ?? 0,
    missed: missedRes.count ?? 0,
    openFollowups: tasksRes.count ?? 0,
  };
}
