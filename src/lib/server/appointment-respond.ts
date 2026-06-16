// Shared appointment-response (confirm / decline / request-time-change) logic —
// extracted from the public appointment-response token route so BOTH that route
// AND the folder-scoped portal endpoint apply identical guards + side effects.
// The folder flow has no appointment-response token, so callers pass
// `tokenId: undefined` to skip the token-state update; `workFolderId` stamps the
// communications row onto the folder timeline.

import type { SupabaseClient } from '@supabase/supabase-js';
import { markAppointmentResponseTokenResponded } from './appointment-response-tokens';
import { sendPushToBusinessOwner } from './push';
import { FINAL_TASK_STATUSES, isBeforeToday, timeChangeOptions } from './appointment-status';

export type AppointmentResponse = 'accepted' | 'declined' | 'time_change_requested';

export interface AppointmentForResponse {
  id: string;
  customer_id: string | null;
  title: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  note: string | null;
}

export interface ApplyAppointmentResponseResult {
  ok: boolean;
  httpStatus: number;
  error?: string;
  title?: string;
  status?: string;
  dueDate?: string | null;
  dueTime?: string | null;
}

// ---- Note + summary builders ----------------------------------------------

export function buildAppointmentNoteAppend(
  response: AppointmentResponse,
  isoDate: string,
  requestedDueDate: string | null,
  requestedDueTime: string | null,
  comment: string | null,
): string {
  let line =
    response === 'accepted'
      ? `Απάντηση μέσω δημόσιου link: Αποδοχή ραντεβού στις ${isoDate}.`
      : response === 'declined'
        ? `Απάντηση μέσω δημόσιου link: Αδυναμία παρουσίας στις ${isoDate}.`
        : `Απάντηση μέσω δημόσιου link: Αίτημα αλλαγής ώρας στις ${isoDate}.`;
  if (requestedDueDate || requestedDueTime) {
    line += ` Νέα πρόταση: ${[requestedDueDate, requestedDueTime].filter(Boolean).join(' ')}.`;
  }
  if (comment) line += ` Σχόλιο: ${comment}`;
  return line;
}

export function buildAppointmentCommunicationSummary(
  response: AppointmentResponse,
  dueDate: string | null,
  dueTime: string | null,
  requestedDueDate: string | null,
  requestedDueTime: string | null,
  comment: string | null,
): string {
  const when = [dueDate, dueTime].filter(Boolean).join(' ');
  let base =
    response === 'accepted'
      ? `Ο πελάτης αποδέχτηκε το ραντεβού ${when} μέσω δημόσιου link.`
      : response === 'declined'
        ? `Ο πελάτης δήλωσε ότι δεν μπορεί για το ραντεβού ${when} μέσω δημόσιου link.`
        : `Ο πελάτης ζήτησε αλλαγή ώρας για το ραντεβού ${when} μέσω δημόσιου link.`;
  if (requestedDueDate || requestedDueTime) {
    base += ` Νέα πρόταση: ${[requestedDueDate, requestedDueTime].filter(Boolean).join(' ')}.`;
  }
  if (comment) base += ` Σχόλιο: ${comment}`;
  return base;
}

export function resolveAppointmentChannel(sentChannel: string | null | undefined): string {
  if (sentChannel === 'viber' || sentChannel === 'sms' || sentChannel === 'email') return sentChannel;
  return 'sms';
}

/**
 * Apply a customer's appointment response to an already-fetched, tenant-validated,
 * appointment-type task. Re-checks final/expiry guards + the exact ±60 reschedule
 * rule itself (defense in depth). The task STATUS is intentionally never changed —
 * confirm/decline/reschedule are recorded as a note + token state + timeline row,
 * matching the existing route. `tokenId`/`workFolderId` behave as in offer-accept.
 */
export async function applyAppointmentResponse(opts: {
  supabase: SupabaseClient;
  businessId: string;
  task: AppointmentForResponse;
  response: AppointmentResponse;
  comment: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
  sentChannel: string | null | undefined;
  tokenId?: string | null;
  workFolderId?: string | null;
}): Promise<ApplyAppointmentResponseResult> {
  const { supabase, businessId, task, response, comment, sentChannel, tokenId, workFolderId } = opts;
  let { requestedDueDate, requestedDueTime } = opts;

  // Guards.
  if ((FINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return { ok: false, httpStatus: 409, error: 'appointment_already_final' };
  }
  if (task.due_date && isBeforeToday(task.due_date)) {
    return { ok: false, httpStatus: 409, error: 'appointment_expired' };
  }

  // Non-time-change responses ignore any proposed slot.
  if (response !== 'time_change_requested') {
    requestedDueDate = null;
    requestedDueTime = null;
  } else {
    // Require a current slot and validate the proposal is EXACTLY ±60 min from it.
    if (!task.due_date || !task.due_time) {
      return { ok: false, httpStatus: 400, error: 'invalid_requested_time_change' };
    }
    const allowed = timeChangeOptions(task.due_date, task.due_time);
    const ok = allowed.length > 0 && allowed.some((p) => p.date === requestedDueDate && p.time === requestedDueTime);
    if (!ok) {
      return { ok: false, httpStatus: 400, error: 'invalid_requested_time_change' };
    }
  }

  const nowIso = new Date().toISOString();
  const isoDate = nowIso.split('T')[0];

  // 1. Task note append (status intentionally unchanged), fatal.
  const noteAppend = buildAppointmentNoteAppend(response, isoDate, requestedDueDate, requestedDueTime, comment);
  const updatedNote = task.note ? `${task.note}\n\n${noteAppend}` : noteAppend;
  try {
    const { error } = await supabase
      .from('tasks')
      .update({ note: updatedNote, updated_at: nowIso })
      .eq('id', task.id)
      .eq('business_id', businessId);
    if (error) return { ok: false, httpStatus: 500, error: 'appointment_response_update_failed' };
  } catch {
    return { ok: false, httpStatus: 500, error: 'appointment_response_update_failed' };
  }

  // 2. Communications row (fatal). Stamp work_folder_id when present.
  const commSummary = buildAppointmentCommunicationSummary(
    response, task.due_date, task.due_time, requestedDueDate, requestedDueTime, comment,
  );
  try {
    const { error } = await supabase.from('communications').insert({
      business_id: businessId,
      customer_id: task.customer_id,
      channel: resolveAppointmentChannel(sentChannel),
      direction: 'inbound',
      status: 'completed',
      phone: null,
      summary: commSummary,
      ...(workFolderId ? { work_folder_id: workFolderId } : {}),
    });
    if (error) return { ok: false, httpStatus: 500, error: 'appointment_response_record_failed' };
  } catch {
    return { ok: false, httpStatus: 500, error: 'appointment_response_record_failed' };
  }

  // 3. Mark the appointment-response token responded — token flow only.
  if (tokenId) {
    try {
      await markAppointmentResponseTokenResponded({ tokenId, response, comment, requestedDueDate, requestedDueTime });
    } catch {
      return { ok: false, httpStatus: 500, error: 'appointment_response_record_failed' };
    }
  }

  // 4. Owner push (best-effort, inert until FCM configured, never throws).
  await sendPushToBusinessOwner(businessId, {
    title:
      response === 'accepted'
        ? 'Ραντεβού: Επιβεβαίωση ✅'
        : response === 'declined'
          ? 'Ραντεβού: Ακύρωση'
          : 'Ραντεβού: Αίτημα αλλαγής ώρας',
    body: commSummary,
    ...(task.customer_id ? { url: `/customers/${task.customer_id}` } : {}),
    data: { type: 'appointment_response', taskId: task.id, response },
  });

  return { ok: true, httpStatus: 200, title: task.title, status: task.status, dueDate: task.due_date, dueTime: task.due_time };
}
