// Next Best Action — DB signal-loading + tolerant persistence.
//
// Reads existing tables (folder, offers, appointments, uploads, intake, messages,
// call brief) to build the deterministic `NextActionSignals`, ranks them via the
// pure ranker, reconciles against the persisted `next_actions` row, and writes the
// single active recommendation. TOLERANT: if `next_actions` (migration 054) is not
// applied yet, every read/write degrades to a computed-only, non-persistent action
// (the card still shows; "Όχι τώρα"/"Υπενθύμισέ μου" are local-only until applied).
//
// The brief text is read ONLY to keyword-match inside the ranker — it never lands
// in a stored/returned field. The public /f/[token] portal does not touch this.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  rankNextAction, describeNextAction, reconcileNextAction, toClientAction,
  type NextActionSignals, type NextActionRecord, type ClientNextAction, type RankedNextAction,
} from '@/lib/server/next-action';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

const SENT_OFFER_STATUSES = ['sent_manually', 'sent_provider'];
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const DEFAULT_SNOOZE_MINUTES = 24 * 60; // "Υπενθύμισέ μου αργότερα" → next day

function tsMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Signal loaders
// ---------------------------------------------------------------------------

/** Latest call-brief text for a customer (internal; keyword-matched only). */
async function latestCallBrief(supabase: SupabaseServer, businessId: string, customerId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('communications')
      .select('summary')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('channel', 'call')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { summary?: string | null } | null)?.summary ?? null;
  } catch {
    return null;
  }
}

async function loadFolderSignals(
  supabase: SupabaseServer,
  businessId: string,
  folderId: string,
  customerId: string,
  folderStatus: string | null,
  folderUpdatedAt: string | null,
  nowMs: number,
): Promise<NextActionSignals> {
  const [linkRes, offersRes, apptRes, uploadRes, intakeRes, msgRes, briefText] = await Promise.all([
    supabase.from('customer_folder_tokens').select('status')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('status', ['sent', 'opened']).limit(1),
    supabase.from('offers').select('status, updated_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('tasks').select('status, type')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('type', ['book_appointment', 'visit_customer']),
    supabase.from('customer_upload_tokens').select('status')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('customer_intake_tokens').select('status')
      .eq('business_id', businessId).eq('work_folder_id', folderId),
    supabase.from('communications').select('direction, created_at')
      .eq('business_id', businessId).eq('work_folder_id', folderId).in('channel', ['sms', 'viber'])
      .order('created_at', { ascending: false }).limit(1),
    latestCallBrief(supabase, businessId, customerId),
  ]);

  const offers = (offersRes.data ?? []) as Array<{ status: string; updated_at: string | null }>;
  const appts = (apptRes.data ?? []) as Array<{ status: string; type: string }>;
  const uploads = (uploadRes.data ?? []) as Array<{ status: string }>;
  const intakes = (intakeRes.data ?? []) as Array<{ status: string }>;
  const lastMsg = ((msgRes.data ?? []) as Array<{ direction: string; created_at: string }>)[0] ?? null;

  const hasOffer = offers.length > 0;
  const offerAccepted = offers.some((o) => o.status === 'accepted');
  const offerSentAwaitingOver48h = offers.some(
    (o) => SENT_OFFER_STATUSES.includes(o.status)
      && (tsMs(o.updated_at) ?? nowMs) < nowMs - FORTY_EIGHT_HOURS_MS,
  );
  const appointmentScheduled = appts.some((a) => a.status === 'open' || a.status === 'completed');
  const uploadCompleted = uploads.some((u) => u.status === 'completed');
  const photosRequestPending = uploads.some((u) => u.status === 'sent' || u.status === 'opened');
  const intakeSubmitted = intakes.some((i) => i.status === 'submitted');
  const detailsRequestPending = intakes.some((i) => i.status === 'sent' || i.status === 'opened');
  const inboundUnanswered = lastMsg?.direction === 'inbound';

  const lastActivityAtMs = Math.max(
    tsMs(folderUpdatedAt) ?? 0,
    tsMs(lastMsg?.created_at) ?? 0,
    ...offers.map((o) => tsMs(o.updated_at) ?? 0),
  ) || null;

  return {
    scope: 'folder',
    nowMs,
    folderStatus,
    linkSent: ((linkRes.data ?? []) as unknown[]).length > 0,
    hasOffer,
    offerAccepted,
    offerSentAwaitingOver48h,
    uploadCompleted,
    intakeSubmitted,
    photosRequestPending,
    detailsRequestPending,
    appointmentScheduled,
    inboundUnanswered,
    workLooksComplete: false, // conservative for v1 (no auto "done" inference)
    briefText,
    lastActivityAtMs,
  };
}

async function loadCustomerSignals(
  supabase: SupabaseServer,
  businessId: string,
  customerId: string,
  nowMs: number,
): Promise<NextActionSignals> {
  const [msgRes, briefText] = await Promise.all([
    supabase.from('communications').select('direction, created_at')
      .eq('business_id', businessId).eq('customer_id', customerId).in('channel', ['sms', 'viber'])
      .order('created_at', { ascending: false }).limit(1),
    latestCallBrief(supabase, businessId, customerId),
  ]);
  const lastMsg = ((msgRes.data ?? []) as Array<{ direction: string; created_at: string }>)[0] ?? null;
  return {
    scope: 'customer',
    nowMs,
    inboundUnanswered: lastMsg?.direction === 'inbound',
    briefText,
  };
}

// ---------------------------------------------------------------------------
// Persist + select the single active action (tolerant of a missing table).
// ---------------------------------------------------------------------------

const ROW_COLS = 'id, action_type, title, explanation, confidence, priority, status, due_at, updated_at';

async function persistAndSelect(
  supabase: SupabaseServer,
  scope: { businessId: string; customerId: string; workFolderId: string | null },
  candidate: RankedNextAction,
  copy: { title: string; explanation: string },
  nowMs: number,
): Promise<ClientNextAction | null> {
  const { businessId, customerId, workFolderId } = scope;

  // Read existing rows for this scope. ANY error → treat the table as not-applied
  // and fall back to a computed-only, non-persistent action.
  let q = supabase.from('next_actions').select(ROW_COLS).eq('business_id', businessId);
  q = workFolderId ? q.eq('work_folder_id', workFolderId) : q.is('work_folder_id', null).eq('customer_id', customerId);
  const existingRes = await q.order('updated_at', { ascending: false }).limit(20);

  if (existingRes.error) {
    if (candidate.actionType === 'no_action') return null;
    return toClientAction(
      { id: null, action_type: candidate.actionType, title: copy.title, explanation: copy.explanation, confidence: candidate.confidence, due_at: null },
      false,
    );
  }

  const rows = (existingRes.data ?? []) as Array<NextActionRecord & {
    title: string; explanation: string | null; confidence: number | null;
  }>;
  const decision = reconcileNextAction(candidate, rows, nowMs);

  if (decision.kind === 'none') return null;

  if (decision.kind === 'retire') {
    // The active row's trigger has resolved — close it and show nothing.
    await supabase.from('next_actions')
      .update({ status: 'superseded', updated_at: new Date(nowMs).toISOString() })
      .eq('id', decision.id).eq('business_id', businessId);
    return null;
  }

  if (decision.kind === 'existing') {
    const row = rows.find((r) => r.id === decision.id);
    if (row) {
      return toClientAction(
        { id: row.id, action_type: row.action_type, title: row.title, explanation: row.explanation, confidence: row.confidence, due_at: row.due_at },
        true,
      );
    }
    // Fell out from under us — recompute by inserting.
  }

  // kind === 'insert' (or the existing row vanished): optionally supersede, then insert.
  const supersedeId = decision.kind === 'insert' ? decision.supersedeId : null;
  if (supersedeId) {
    await supabase.from('next_actions')
      .update({ status: 'superseded', updated_at: new Date(nowMs).toISOString() })
      .eq('id', supersedeId).eq('business_id', businessId);
  }

  const insertRow = {
    business_id: businessId,
    customer_id: customerId,
    work_folder_id: workFolderId,
    action_type: candidate.actionType,
    title: copy.title,
    explanation: copy.explanation,
    confidence: candidate.confidence,
    priority: candidate.priority,
    source_event_type: candidate.sourceEventType,
    status: 'pending',
    updated_at: new Date(nowMs).toISOString(),
  };
  const insRes = await supabase.from('next_actions').insert(insertRow).select(ROW_COLS).maybeSingle();

  if (insRes.error || !insRes.data) {
    // Likely a race on the one-active unique index — re-select the active row.
    let aq = supabase.from('next_actions').select(ROW_COLS).eq('business_id', businessId).in('status', ['pending', 'snoozed']);
    aq = workFolderId ? aq.eq('work_folder_id', workFolderId) : aq.is('work_folder_id', null).eq('customer_id', customerId);
    const again = await aq.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    const r = again.data as (NextActionRecord & { title: string; explanation: string | null; confidence: number | null }) | null;
    if (r) {
      return toClientAction(
        { id: r.id, action_type: r.action_type, title: r.title, explanation: r.explanation, confidence: r.confidence, due_at: r.due_at },
        true,
      );
    }
    // Could not persist — degrade to computed-only.
    return toClientAction(
      { id: null, action_type: candidate.actionType, title: copy.title, explanation: copy.explanation, confidence: candidate.confidence, due_at: null },
      false,
    );
  }

  const r = insRes.data as NextActionRecord & { title: string; explanation: string | null; confidence: number | null };
  return toClientAction(
    { id: r.id, action_type: r.action_type, title: r.title, explanation: r.explanation, confidence: r.confidence, due_at: r.due_at },
    true,
  );
}

// ---------------------------------------------------------------------------
// Public entry points (used by the API routes; safe to call best-effort).
// ---------------------------------------------------------------------------

/** Compute + persist the folder's single Next Best Action. Returns null when none. */
export async function computeFolderNextAction(
  supabase: SupabaseServer,
  businessId: string,
  folderId: string,
): Promise<ClientNextAction | null> {
  const folderRes = await supabase
    .from('work_folders').select('id, customer_id, status, updated_at')
    .eq('id', folderId).eq('business_id', businessId).maybeSingle();
  const folder = folderRes.data as { id: string; customer_id: string; status: string | null; updated_at: string | null } | null;
  if (!folder) return null;

  const nowMs = Date.now();
  const signals = await loadFolderSignals(
    supabase, businessId, folderId, folder.customer_id, folder.status, folder.updated_at, nowMs,
  );
  const candidate = rankNextAction(signals);
  const copy = describeNextAction(candidate, signals);
  return persistAndSelect(supabase, { businessId, customerId: folder.customer_id, workFolderId: folderId }, candidate, copy, nowMs);
}

/** Compute + persist a customer's Next Best Action (only when they have NO folder). */
export async function computeCustomerNextAction(
  supabase: SupabaseServer,
  businessId: string,
  customerId: string,
): Promise<ClientNextAction | null> {
  // If the customer already has a folder, the recommendation lives at folder level.
  const folderCheck = await supabase
    .from('work_folders').select('id').eq('business_id', businessId).eq('customer_id', customerId).limit(1);
  if (((folderCheck.data ?? []) as unknown[]).length > 0) return null;

  const nowMs = Date.now();
  const signals = await loadCustomerSignals(supabase, businessId, customerId, nowMs);
  const candidate = rankNextAction(signals);
  const copy = describeNextAction(candidate, signals);
  return persistAndSelect(supabase, { businessId, customerId, workFolderId: null }, candidate, copy, nowMs);
}

// ---------------------------------------------------------------------------
// Lifecycle (accept / dismiss / snooze / complete) — tolerant of a missing table.
// ---------------------------------------------------------------------------

export type NextActionLifecycle = 'accept' | 'dismiss' | 'snooze' | 'complete';

const LIFECYCLE_STATUS: Record<NextActionLifecycle, string> = {
  accept: 'accepted', dismiss: 'dismissed', snooze: 'snoozed', complete: 'completed',
};

export function isNextActionLifecycle(v: unknown): v is NextActionLifecycle {
  return v === 'accept' || v === 'dismiss' || v === 'snooze' || v === 'complete';
}

/** Apply a lifecycle transition to one action row (business-scoped). Best-effort. */
export async function applyNextActionLifecycle(
  supabase: SupabaseServer,
  params: { businessId: string; id: string; action: NextActionLifecycle; snoozeMinutes?: number },
): Promise<{ ok: boolean }> {
  const now = Date.now();
  const update: Record<string, unknown> = {
    status: LIFECYCLE_STATUS[params.action],
    updated_at: new Date(now).toISOString(),
  };
  if (params.action === 'snooze') {
    const mins = Number.isFinite(params.snoozeMinutes) && (params.snoozeMinutes ?? 0) > 0
      ? Math.min(params.snoozeMinutes as number, 7 * 24 * 60) : DEFAULT_SNOOZE_MINUTES;
    update.due_at = new Date(now + mins * 60 * 1000).toISOString();
  }
  try {
    const { error } = await supabase
      .from('next_actions').update(update).eq('id', params.id).eq('business_id', params.businessId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
