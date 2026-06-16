// Public folder-portal appointment response (Portal v2). Folder token in the URL
// is the sole credential (hashed, fail-closed). The task is fetched TRIPLE-scoped
// to the token's business_id AND work_folder_id AND asserted to be an appointment
// type, so a customer holding one folder's link can only act on that folder's
// appointments (cross-folder/business/wrong-type = 404, no oracle). Side effects
// run through the SAME shared lib as the appointment-response token route
// (applyAppointmentResponse), tokenId omitted, work_folder_id stamped. Service-
// role only; raw DB errors never leak.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';
import { findValidFolderToken } from '@/lib/server/folder-tokens';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { applyAppointmentResponse, type AppointmentForResponse } from '@/lib/server/appointment-respond';
import { APPOINTMENT_TYPES } from '@/lib/server/appointment-status';

export const runtime = 'nodejs';

const publicLimiter = makePublicLimiter(10, 60_000);

const TASK_COLUMNS = 'id, customer_id, title, type, status, due_date, due_time, note';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; taskId: string }> },
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const { token: rawToken, taskId } = await params;

  // Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const responseRaw = raw.response ?? raw.action;
  if (responseRaw !== 'accepted' && responseRaw !== 'declined' && responseRaw !== 'time_change_requested') {
    return NextResponse.json({ ok: false, error: 'invalid_response' }, { status: 400 });
  }
  const response = responseRaw as 'accepted' | 'declined' | 'time_change_requested';

  let comment: string | null = null;
  if (typeof raw.comment === 'string') {
    const trimmed = raw.comment.trim();
    if (trimmed.length > 0) comment = trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
  }

  let requestedDueDate: string | null = null;
  if (raw.requestedDueDate !== undefined && raw.requestedDueDate !== null) {
    if (typeof raw.requestedDueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.requestedDueDate)) {
      return NextResponse.json({ ok: false, error: 'invalid_requested_due_date' }, { status: 400 });
    }
    requestedDueDate = raw.requestedDueDate;
  }
  let requestedDueTime: string | null = null;
  if (raw.requestedDueTime !== undefined && raw.requestedDueTime !== null) {
    if (typeof raw.requestedDueTime !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(raw.requestedDueTime)) {
      return NextResponse.json({ ok: false, error: 'invalid_requested_due_time' }, { status: 400 });
    }
    requestedDueTime = raw.requestedDueTime;
  }

  // Validate the folder token (fail closed).
  let tokenRow;
  try {
    tokenRow = await findValidFolderToken(rawToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'appointment_response_failed' }, { status: 500 });
  }
  if (!tokenRow) {
    return NextResponse.json({ ok: false, error: 'folder_link_invalid_or_expired' }, { status: 404 });
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'appointment_response_failed' }, { status: 500 });
  }

  // IDOR-critical: fetch the task scoped to BOTH the token's business_id AND its
  // work_folder_id, and assert it is an appointment type. Any mismatch → 404.
  let task: AppointmentForResponse;
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', taskId)
      .eq('business_id', tokenRow.business_id)
      .eq('work_folder_id', tokenRow.work_folder_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: 'appointment_response_failed' }, { status: 500 });
    }
    const row = data as unknown as (AppointmentForResponse & { type: string }) | null;
    if (!row || !(APPOINTMENT_TYPES as readonly string[]).includes(row.type)) {
      return NextResponse.json({ ok: false, error: 'appointment_not_found' }, { status: 404 });
    }
    task = row;
  } catch {
    return NextResponse.json({ ok: false, error: 'appointment_response_failed' }, { status: 500 });
  }

  // Same shared path as the token route — tokenId omitted; stamp work_folder_id.
  const result = await applyAppointmentResponse({
    supabase,
    businessId: tokenRow.business_id,
    task,
    response,
    comment,
    requestedDueDate,
    requestedDueTime,
    sentChannel: tokenRow.sent_channel,
    tokenId: undefined,
    workFolderId: tokenRow.work_folder_id,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({
    ok: true,
    response,
    appointment: { title: result.title, status: result.status, dueDate: result.dueDate, dueTime: result.dueTime },
  });
}
