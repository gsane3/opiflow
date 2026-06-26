// Cron — service (job orchestration for the machine-auth cron endpoints).
//
// Each exported function is one cron job's post-auth body, moved verbatim out of
// its route. The routes keep auth/verify, env preconditions, the service-role
// client construction, and the bespoke NextResponse mapping; this module owns
// the DB sweep + effectful-lib orchestration. Tenant scoping stays explicit
// (these jobs iterate businesses with .eq('business_id', ...)) — there is no
// user-derived tenant context.
//
// Effectful libs (push / send-channel / intake-token mint / twilio recording /
// timeline logging) stay as thin calls here and their result handling is
// preserved exactly.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  createServiceSupabaseClient,
  createCustomerIntakeToken,
} from '../../../lib/server/intake-tokens';
import { sendViaPreferredChannel } from '../../../lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '../../../lib/server/record-message';
import { log } from '../../../lib/observability';
import {
  bumpReminderBookkeeping,
  countWeeklyStats,
  expireCustomerIntake,
  expireToken,
  fetchCustomerForReminder,
  fetchCustomerForScheduledMessage,
  fetchWeeklySummaryOptOut,
  getFolderForNudge,
  markRecordingEventProcessed,
  markScheduledMessageFailed,
  markScheduledMessageSent,
  markTokenSent,
  revokeToken,
  selectBusinesses,
  selectDueScheduledMessages,
  selectExpireCandidates,
  selectPendingRecordingEvents,
  selectReminderCandidates,
  selectUnreadCandidates,
  type CandidateTokenRow,
  type CustomerRow,
  type PendingEvent,
} from './cron.repo';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// The push lib (`@/lib/server/push`) and the twilio-recording lib
// (`@/lib/server/twilio-recording`) import via the `@/` alias, which the unit
// runner can't resolve. We keep their TYPES via type-only `import(...)` queries
// (erased at compile time) and load their VALUES lazily inside the jobs — the
// tests cover the pre-effect branches so the real libs never enter the test
// graph, while the live routes load them exactly as before.
type PushLib = typeof import('../../../lib/server/push');
type TwilioLib = typeof import('../../../lib/server/twilio-recording');

const loadPush = async (): Promise<PushLib> => import('../../../lib/server/push');
const loadTwilio = async (): Promise<TwilioLib> => import('../../../lib/server/twilio-recording');

// ===========================================================================
// folder-unread-reminder
// ===========================================================================

const FOLDER_UNREAD_WINDOW_START_MS = 48 * 60 * 60 * 1000; // oldest message we still nag about
const FOLDER_UNREAD_WINDOW_END_MS = 24 * 60 * 60 * 1000; // unread for at least this long
const FOLDER_UNREAD_BATCH_LIMIT = 100;

function isFolderUnreadMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('read_at') || (msg.includes('column') && msg.includes('does not exist'));
}

export async function runFolderUnreadSweep(): Promise<{ ok: boolean; nudged: number; reason?: string }> {
  const supabase = createServiceSupabaseClient();
  const now = Date.now();
  const olderThanIso = new Date(now - FOLDER_UNREAD_WINDOW_END_MS).toISOString();
  const newerThanIso = new Date(now - FOLDER_UNREAD_WINDOW_START_MS).toISOString();

  const { data, error } = await selectUnreadCandidates(
    supabase,
    olderThanIso,
    newerThanIso,
    FOLDER_UNREAD_BATCH_LIMIT,
  );

  if (error) {
    if (isFolderUnreadMissingColumnError(error)) return { ok: true, nudged: 0, reason: 'migration_057_pending' };
    console.error('[folder-unread-reminder cron] query failed:', error.message);
    return { ok: false, nudged: 0, reason: 'query_failed' };
  }

  const rows = data ?? [];
  // One nudge per folder, even if several messages are unread.
  const seen = new Set<string>();
  let nudged = 0;
  const { sendPushToBusinessOwner } = await loadPush();

  for (const row of rows) {
    if (seen.has(row.work_folder_id)) continue;
    seen.add(row.work_folder_id);
    try {
      const f = await getFolderForNudge(supabase, row.work_folder_id, row.business_id);
      const customerId = row.customer_id ?? f?.customer_id ?? null;
      await sendPushToBusinessOwner(row.business_id, {
        title: 'Αδιάβαστο μήνυμα',
        body: `${f?.title ?? 'Έργο'} — ο πελάτης δεν έχει δει ακόμα το μήνυμά σου.`,
        url: customerId ? `/customers/${customerId}` : '/calls',
        data: { type: 'folder_unread', workFolderId: row.work_folder_id, customerId: customerId ?? '' },
      });
      nudged += 1;
    } catch (err) {
      console.error(
        '[folder-unread-reminder cron] nudge failed for folder',
        row.work_folder_id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { ok: true, nudged };
}

// ===========================================================================
// intake-reminder
// ===========================================================================

const INTAKE_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
const INTAKE_MAX_REMINDERS = 2; // never send more than 2 reminders per customer
const INTAKE_BATCH_LIMIT = 50; // cap work per run
// Soft-expire grace after the last (2nd) reminder — the owner's "6h after the
// 24h mark". Approximate on the daily cron, which the owner accepted.
const INTAKE_EXPIRE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ReminderRunResult {
  ok: boolean;
  resent: number;
  skipped: number;
  expired?: number;
  reason?: string;
}

function intakeStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Prefer a mobile number; fall back to the generic phone field.
function selectPhone(customer: CustomerRow): string | null {
  return intakeStr(customer.mobile_phone) ?? intakeStr(customer.phone);
}

function buildReminderMessage(url: string): string {
  return `Υπενθύμιση: συμπλήρωσε τα στοιχεία σου: ${url}`;
}

// Postgres "undefined column" error code. When migration 035 has not been
// applied yet, selecting reminder_count / reminder_sent_at fails with 42703.
function isIntakeMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return (
    msg.includes('reminder_count') ||
    msg.includes('reminder_sent_at') ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

export async function runReminderSweep(): Promise<ReminderRunResult> {
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - INTAKE_STALE_AFTER_MS).toISOString();

  const { data, error } = await selectReminderCandidates(
    supabase,
    nowIso,
    staleBeforeIso,
    INTAKE_MAX_REMINDERS,
    INTAKE_BATCH_LIMIT,
  );

  if (error) {
    // Migration 035 not applied yet -> safe no-op until it lands.
    if (isIntakeMissingColumnError(error)) {
      return { ok: true, resent: 0, skipped: 0, reason: 'migration_035_pending' };
    }
    console.error('[intake-reminder cron] candidate query failed:', error.message);
    return { ok: false, resent: 0, skipped: 0, reason: 'query_failed' };
  }

  const candidates = (data ?? []) as CandidateTokenRow[];
  if (candidates.length === 0) {
    return { ok: true, resent: 0, skipped: 0 };
  }

  let resent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      // Load the customer for this token.
      const { data: customerData, error: customerError } = await fetchCustomerForReminder(
        supabase,
        candidate.customer_id,
        candidate.business_id,
      );

      if (customerError || !customerData) {
        skipped += 1;
        continue;
      }

      const customer = customerData as unknown as CustomerRow;
      const phone = selectPhone(customer);
      if (!phone) {
        skipped += 1;
        continue;
      }

      // Mint a fresh, sendable token (raw token of the old row is not
      // recoverable — only its hash is stored). Default 72h expiry.
      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId: candidate.business_id,
          customerId: candidate.customer_id,
          phone,
          sentChannel: null, // becomes 'sent' below only if the send succeeds
        });
      } catch (err) {
        console.error(
          '[intake-reminder cron] token mint failed for customer',
          candidate.customer_id,
          err instanceof Error ? err.message : err
        );
        skipped += 1;
        continue;
      }

      const newTokenId = tokenResult.row.id;
      const text = buildReminderMessage(tokenResult.intakeUrl);

      // Send via the customer's preferred channel (Viber -> SMS fallback, or
      // SMS direct). Non-throwing; the message TEXT carries the URL so SMS works.
      const sendResult = await sendViaPreferredChannel({
        preferred: customer.preferred_contact_method,
        phone,
        text,
        customerId: customer.id,
        referenceId: `reminder:${candidate.id}`,
      });

      const sentNowIso = new Date().toISOString();
      const nextReminderCount = (candidate.reminder_count ?? 0) + 1;

      if (sendResult.ok) {
        // Mark the new token as actually sent and carry the reminder
        // bookkeeping forward onto it.
        await markTokenSent(
          supabase,
          newTokenId,
          sendResult.channel === 'none' ? null : sendResult.channel,
          phone,
          nextReminderCount,
          sentNowIso,
        );

        // Supersede the stale token so it is no longer a candidate.
        await revokeToken(supabase, candidate.id, sentNowIso);

        resent += 1;
      } else {
        // Send failed (e.g. Apifon not configured). Revoke the freshly-minted,
        // never-delivered token to avoid orphan pending rows, and bump the
        // OLD token's reminder bookkeeping so we back off for an hour and
        // eventually stop after the cap (prevents tight retry loops).
        await revokeToken(supabase, newTokenId, sentNowIso);

        await bumpReminderBookkeeping(supabase, candidate.id, nextReminderCount, sentNowIso);

        skipped += 1;
      }
    } catch (err) {
      console.error(
        '[intake-reminder cron] candidate processing failed:',
        err instanceof Error ? err.message : err
      );
      skipped += 1;
    }
  }

  return { ok: true, resent, skipped };
}

export async function runExpireSweep(): Promise<{ expired: number; reason?: string }> {
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const graceBeforeIso = new Date(now.getTime() - INTAKE_EXPIRE_GRACE_MS).toISOString();

  const { data, error } = await selectExpireCandidates(
    supabase,
    graceBeforeIso,
    INTAKE_MAX_REMINDERS,
    INTAKE_BATCH_LIMIT,
  );

  if (error) {
    if (isIntakeMissingColumnError(error)) return { expired: 0, reason: 'migration_035_pending' };
    console.error('[intake-reminder cron] expire query failed:', error.message);
    return { expired: 0, reason: 'query_failed' };
  }

  const stale = (data ?? []) as Array<{ id: string; business_id: string; customer_id: string }>;
  let expired = 0;
  for (const tok of stale) {
    try {
      const ts = new Date().toISOString();
      await expireToken(supabase, tok.id, ts);
      await expireCustomerIntake(supabase, tok.customer_id, tok.business_id, ts);
      expired += 1;
    } catch (err) {
      console.error(
        '[intake-reminder cron] expire failed for token',
        tok.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { expired };
}

// ===========================================================================
// recordings-reconcile
// ===========================================================================

const RECORDINGS_BATCH_LIMIT = 10;
const RECORDINGS_GIVE_UP_HOURS = 48;

export type ReconcileRecordingsResult =
  | { kind: 'skip'; skipped: string }
  | { kind: 'query_failed' }
  | { kind: 'done'; examined: number; succeeded: number; deferred: number; gaveUp: number };

export async function reconcileRecordings(args: {
  supabase: SupabaseServer;
  accountSid: string;
  authToken: string;
}): Promise<ReconcileRecordingsResult> {
  const { supabase, accountSid, authToken } = args;

  const { data, error } = await selectPendingRecordingEvents(supabase, RECORDINGS_BATCH_LIMIT);

  if (error) {
    // ONLY a missing table is a benign skip; any other error means the brief
    // reconciliation is broken — surface it (500) instead of silently dropping
    // recordings that never get their AI brief.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { kind: 'skip', skipped: 'events_unavailable' };
    }
    log.error('cron_recordings_reconcile_query_failed', { code: error.code });
    return { kind: 'query_failed' };
  }

  const events = (data ?? []) as unknown as PendingEvent[];
  let succeeded = 0;
  let gaveUp = 0;
  let deferred = 0;

  const twilio = events.length > 0 ? await loadTwilio() : null;
  const deleteTwilioRecording = (...a: Parameters<TwilioLib['deleteTwilioRecording']>) => twilio!.deleteTwilioRecording(...a);
  const downloadRecordingWav = (...a: Parameters<TwilioLib['downloadRecordingWav']>) => twilio!.downloadRecordingWav(...a);
  const findCallCommunication = (...a: Parameters<TwilioLib['findCallCommunication']>) => twilio!.findCallCommunication(...a);
  const processRecordingForCommunication = (...a: Parameters<TwilioLib['processRecordingForCommunication']>) => twilio!.processRecordingForCommunication(...a);

  for (const event of events) {
    const callSid = event.payload?.call_sid;
    const recordingUrl = event.payload?.recording_url;
    const recordingSid = event.payload?.recording_sid ?? null;
    const fromNumber = event.payload?.from_number ?? null;
    const ageHours = (Date.now() - new Date(event.created_at).getTime()) / 3_600_000;

    const markProcessed = async (errorMessage: string | null) => {
      await markRecordingEventProcessed(supabase, event.id, errorMessage);
    };

    if (!callSid || !recordingUrl) {
      await markProcessed('invalid_payload');
      continue;
    }

    const giveUp = async (reason: string) => {
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(reason);
      gaveUp += 1;
    };

    const comm = await findCallCommunication(supabase, callSid);

    if (comm?.brief_created_at) {
      // Already briefed elsewhere — just clean up.
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(null);
      succeeded += 1;
      continue;
    }

    if (!comm) {
      if (ageHours > RECORDINGS_GIVE_UP_HOURS) await giveUp('communication_never_found');
      else deferred += 1;
      continue;
    }

    const download = await downloadRecordingWav(recordingUrl, accountSid, authToken);
    if ('error' in download) {
      if (download.error === 'size_invalid') await giveUp('recording_size_invalid');
      else if (ageHours > RECORDINGS_GIVE_UP_HOURS) await giveUp('download_failed');
      else deferred += 1;
      continue;
    }

    const ok = await processRecordingForCommunication({
      supabase,
      comm,
      audioFile: download.file,
      fromNumber,
      callSid,
    });

    if (ok) {
      if (recordingSid) await deleteTwilioRecording(recordingSid, accountSid, authToken);
      await markProcessed(null);
      succeeded += 1;
    } else if (ageHours > RECORDINGS_GIVE_UP_HOURS) {
      await giveUp('transcription_failed');
    } else {
      deferred += 1;
    }
  }

  return { kind: 'done', examined: events.length, succeeded, deferred, gaveUp };
}

// ===========================================================================
// scheduled-messages
// ===========================================================================

const SCHEDULED_BATCH_LIMIT = 50;

export type DispatchScheduledMessagesResult =
  | { kind: 'skip'; skipped: string }
  | { kind: 'query_failed' }
  | { kind: 'done'; examined: number; sent: number; failed: number };

export async function dispatchScheduledMessages(args: {
  supabase: SupabaseServer;
}): Promise<DispatchScheduledMessagesResult> {
  const { supabase } = args;

  const nowIso = new Date().toISOString();
  const { data, error } = await selectDueScheduledMessages(supabase, nowIso, SCHEDULED_BATCH_LIMIT);

  if (error) {
    // ONLY a missing table (pre-044) is a benign skip. Any other error (timeout,
    // permission, connection) means the cron is actually broken — return 500 so
    // Vercel/monitoring see it instead of silently never sending due messages.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { kind: 'skip', skipped: 'scheduled_messages_unavailable' };
    }
    log.error('cron_scheduled_messages_query_failed', { code: error.code });
    return { kind: 'query_failed' };
  }

  const rows = (data ?? []) as Array<{ id: string; business_id: string; customer_id: string | null; channel: string; body: string }>;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Resolve the customer's phone + preferred channel at send time.
      let phone: string | null = null;
      let preferred: string | null = null;
      if (row.customer_id) {
        const c = await fetchCustomerForScheduledMessage(supabase, row.customer_id);
        phone = c ? (c.mobile_phone || c.phone || c.landline_phone) : null;
        preferred = c?.preferred_contact_method ?? null;
      }

      if (!phone) {
        await markScheduledMessageFailed(supabase, row.id, 'no_phone');
        failed += 1;
        continue;
      }

      const referenceId = `sched:${row.id.slice(0, 12)}`;
      const channelOverride = row.channel === 'sms' || row.channel === 'viber' ? row.channel : null;
      const result = await sendViaPreferredChannel({ preferred: channelOverride ?? preferred, phone, text: row.body, customerId: row.customer_id, referenceId });

      if (result.ok && result.channel !== 'none') {
        const detail = result.channel === 'sms' ? result.sms : result.viber;
        const ids = extractProviderIds(detail);
        await recordOutboundMessage({
          businessId: row.business_id,
          customerId: row.customer_id,
          channel: result.channel,
          summary: row.body,
          phone,
          referenceId,
          providerRequestId: ids.providerRequestId,
          providerMessageId: ids.providerMessageId,
        });
        await markScheduledMessageSent(supabase, row.id);
        sent += 1;
      } else {
        await markScheduledMessageFailed(supabase, row.id, result.reason ?? 'send_failed');
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { kind: 'done', examined: rows.length, sent, failed };
}

// ===========================================================================
// weekly-summary
// ===========================================================================

const WEEKLY_FOLLOWUP_TYPES = ['call_back', 'follow_up_offer', 'send_offer', 'wait_for_reply'];

export type WeeklySummaryResult =
  | { kind: 'query_failed' }
  | { kind: 'done'; pushed: number; skipped: number; examined: number };

export async function runWeeklySummary(args: {
  supabase: SupabaseServer;
}): Promise<WeeklySummaryResult> {
  const { supabase } = args;

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: businesses, error } = await selectBusinesses(supabase);
  if (error) {
    return { kind: 'query_failed' };
  }

  let pushed = 0;
  let skipped = 0;

  for (const row of (businesses ?? []) as Array<{ id: string }>) {
    const businessId = row.id;
    try {
      // Owner opt-out (tolerate pre-044: column may not exist → treat as enabled).
      const { data: optRow, error: optErr } = await fetchWeeklySummaryOptOut(supabase, businessId);
      if (!optErr && (optRow as { weekly_summary_enabled?: boolean } | null)?.weekly_summary_enabled === false) {
        skipped += 1;
        continue;
      }

      const { calls, missed, openFollowups } = await countWeeklyStats(
        supabase,
        businessId,
        weekAgoIso,
        WEEKLY_FOLLOWUP_TYPES,
      );

      // Nothing happened and nothing pending → don't nag.
      if (calls === 0 && openFollowups === 0) {
        skipped += 1;
        continue;
      }

      const parts: string[] = [`${calls} κλήσεις`];
      if (missed > 0) parts.push(`${missed} αναπάντητες`);
      if (openFollowups > 0) parts.push(`${openFollowups} εκκρεμότητες`);

      const { sendPushToBusinessOwner } = await loadPush();
      await sendPushToBusinessOwner(businessId, {
        title: 'Η εβδομάδα σου στο Opiflow',
        body: parts.join(' · '),
        url: openFollowups > 0 ? '/tasks' : '/dashboard',
        data: { type: 'weekly_summary' },
      });
      pushed += 1;
    } catch {
      // never let one business fail the run
      skipped += 1;
    }
  }

  return { kind: 'done', pushed, skipped, examined: (businesses ?? []).length };
}
