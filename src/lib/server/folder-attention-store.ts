// CAM Attention engine — DB signal-loading (computed-only, business-scoped).
//
// Reads existing tables (communications, offers, appointment tasks, upload/intake
// tokens, folder link tokens) + the persisted next_actions active row, builds the
// deterministic AttentionSignals, and returns the single primary attention state.
// NOTHING is persisted and there is NO migration. Self-contained (does not touch
// next-action-store / the NBA architecture); it only READS next_actions for rule 8.
// Tolerant: any read error degrades that signal to "absent" rather than throwing.

import { createServerSupabaseClient } from '../supabase/server';
import {
  computeFolderAttention, toClientAttention,
  type AttentionSignals, type ClientFolderAttention,
} from './folder-attention';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

const SENT_OFFER_STATUSES = ['sent_manually', 'sent_provider'];
const ACTIVE_OFFER_STATUSES = ['draft', 'ready_to_send', 'sent_manually', 'sent_provider', 'accepted'];
const APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'];
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

function tsMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
}

/** Today's YYYY-MM-DD in Europe/Athens (matches how due_date is stored/displayed). */
function athensToday(nowMs: number): string {
  return new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' });
}

/**
 * The calendar day after a YYYY-MM-DD date. Pure calendar math via UTC midnight —
 * DST-SAFE (a "+24h to the epoch then reformat" trick lands on the wrong date on
 * Athens DST-transition days, silently dropping the appointment reminder).
 */
export function addCalendarDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function loadAttentionSignals(
  supabase: SupabaseServer,
  businessId: string,
  folderId: string,
  folderStatus: string | null,
  folderUpdatedAt: string | null,
  nowMs: number,
): Promise<AttentionSignals> {
  const today = athensToday(nowMs);
  const tomorrow = addCalendarDay(today);

  const [msgRes, offersRes, apptRes, uploadRes, intakeRes, linkRes, naRes] = await Promise.all([
    supabase.from('communications').select('direction, created_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('channel', ['sms', 'viber'])
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('offers').select('status, updated_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('tasks').select('status, due_date, due_time')
      .eq('business_id', businessId).eq('work_folder_id', folderId)
      .in('type', APPOINTMENT_TASK_TYPES).eq('status', 'open').in('due_date', [today, tomorrow]),
    supabase.from('customer_upload_tokens').select('status, created_at, completed_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('customer_intake_tokens').select('status, created_at, submitted_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('customer_folder_tokens').select('status')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('status', ['sent', 'opened']).limit(1),
    // Rule 8: the persisted active NBA row (tolerant — table may be absent).
    supabase.from('next_actions').select('action_type, status, due_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('status', ['pending', 'snoozed'])
      .order('updated_at', { ascending: false }).limit(1),
  ]);

  const lastMsg = ((msgRes.data ?? []) as Array<{ direction: string; created_at: string }>)[0] ?? null;
  const offers = (offersRes.data ?? []) as Array<{ status: string; updated_at: string | null }>;
  const appts = (apptRes.data ?? []) as Array<{ status: string; due_date: string | null; due_time: string | null }>;
  const uploads = (uploadRes.data ?? []) as Array<{ status: string; created_at: string | null; completed_at: string | null }>;
  const intakes = (intakeRes.data ?? []) as Array<{ status: string; created_at: string | null; submitted_at: string | null }>;

  const hasOffer = offers.some((o) => ACTIVE_OFFER_STATUSES.includes(o.status));
  const offerAwaitingOver48h = offers.some(
    (o) => SENT_OFFER_STATUSES.includes(o.status) && (tsMs(o.updated_at) ?? nowMs) < nowMs - FORTY_EIGHT_HOURS_MS,
  );

  const uploadCompleted = uploads.some((u) => u.status === 'completed' || u.completed_at != null);
  const uploadRequestPendingOver48h = uploads.some(
    (u) => (u.status === 'sent' || u.status === 'opened') && u.completed_at == null
      && (tsMs(u.created_at) ?? nowMs) < nowMs - FORTY_EIGHT_HOURS_MS,
  );
  const intakeSubmitted = intakes.some((i) => i.status === 'submitted' || i.submitted_at != null);
  const intakeRequestPendingOver48h = intakes.some(
    (i) => (i.status === 'sent' || i.status === 'opened') && i.submitted_at == null
      && (tsMs(i.created_at) ?? nowMs) < nowMs - FORTY_EIGHT_HOURS_MS,
  );

  // Appointment today wins over tomorrow.
  const todayAppt = appts.find((a) => a.due_date === today) ?? null;
  const tomorrowAppt = appts.find((a) => a.due_date === tomorrow) ?? null;
  const appointmentDue = todayAppt ? 'today' : tomorrowAppt ? 'tomorrow' : null;
  const apptRow = todayAppt ?? tomorrowAppt;
  const appointmentDueAt = apptRow
    ? `${apptRow.due_date ?? ''}${apptRow.due_time ? `T${apptRow.due_time}` : ''}` || null
    : null;

  // Rule 8: pending is always visible; snoozed only once its due time has passed.
  const naRow = ((naRes.data ?? []) as Array<{ action_type: string; status: string; due_at: string | null }>)[0] ?? null;
  let activeNextActionType: string | null = null;
  let activeNextActionDueAt: string | null = null;
  if (naRow) {
    const due = tsMs(naRow.due_at);
    const visible = naRow.status === 'pending' || (naRow.status === 'snoozed' && due != null && due <= nowMs);
    if (visible) { activeNextActionType = naRow.action_type; activeNextActionDueAt = naRow.due_at; }
  }

  const lastActivityAtMs = Math.max(
    tsMs(folderUpdatedAt) ?? 0,
    tsMs(lastMsg?.created_at) ?? 0,
    ...offers.map((o) => tsMs(o.updated_at) ?? 0),
  ) || null;

  return {
    nowMs,
    folderStatus,
    linkSent: ((linkRes.data ?? []) as unknown[]).length > 0,
    inboundUnanswered: lastMsg?.direction === 'inbound',
    hasOffer,
    uploadCompleted,
    intakeSubmitted,
    offerAwaitingOver48h,
    uploadRequestPendingOver48h,
    intakeRequestPendingOver48h,
    appointmentDue,
    appointmentDueAt,
    activeNextActionType,
    activeNextActionDueAt,
    lastActivityAtMs,
  };
}

/** Compute the folder's single attention state. Returns null for closed/not-found folders. */
export async function computeFolderAttentionForFolder(
  supabase: SupabaseServer,
  businessId: string,
  folderId: string,
): Promise<ClientFolderAttention | null> {
  const folderRes = await supabase
    .from('work_folders').select('id, status, updated_at')
    .eq('id', folderId).eq('business_id', businessId).maybeSingle();
  const folder = folderRes.data as { id: string; status: string | null; updated_at: string | null } | null;
  if (!folder) return null;
  // Closed work raises no attention — skip the signal loads entirely.
  if (folder.status === 'done' || folder.status === 'archived') return null;

  const nowMs = Date.now();
  const signals = await loadAttentionSignals(supabase, businessId, folderId, folder.status, folder.updated_at, nowMs);
  return toClientAttention(computeFolderAttention(signals));
}
