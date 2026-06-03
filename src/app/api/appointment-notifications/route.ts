// Appointment notification delivery route.
// Builds a Viber message for an appointment task and either returns it as a
// draft (mode=draft, default) or sends it via Apifon (mode=send).
// A response token is created for 'proposal' kind so the customer can reply.
//
// IMPORTANT: mode='draft' never calls Apifon.
// mode='send' calls Apifon only after all validation passes.
// The raw response URL is embedded inside the customer message text only;
// it is not returned as a separate response field.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { createAppointmentResponseToken } from '@/lib/server/appointment-response-tokens';
import { sendViberMessage, normalizeApifonMsisdn } from '@/lib/server/apifon-viber';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatGreekDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('el-GR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function looksLikeGreekMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/[^\d]/g, '');
  return /^6\d{9}$/.test(digits) || /^306\d{9}$/.test(digits);
}

function selectViberPhone(customer: CustomerRow): string | null {
  // Prefer mobile_phone; fall back to phone only if it looks like a Greek mobile.
  const mobile = str(customer.mobile_phone);
  if (mobile) return mobile;
  const fallback = str(customer.phone);
  if (fallback && looksLikeGreekMobile(fallback)) return fallback;
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_KINDS = ['proposal', 'time_change_approved', 'time_change_rejected'] as const;
type NotificationKind = typeof VALID_KINDS[number];

const VALID_MODES = ['draft', 'send'] as const;
type NotificationMode = typeof VALID_MODES[number];

const VALID_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

interface TaskRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  type: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  mobile_phone: string | null;
  phone: string | null;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildProposalMessage(task: TaskRow, responseUrl: string): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Σας προτείνουμε ραντεβού ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Σας προτείνουμε ραντεβού ${datePart}.`);
  } else {
    lines.push('Σας προτείνουμε ραντεβού.');
  }

  lines.push('Παρακαλούμε επιβεβαιώστε ή προτείνετε άλλη ώρα:');
  lines.push(responseUrl);

  return lines.join(' ');
}

function buildTimeChangeApprovedMessage(task: TaskRow): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Η αλλαγή ώρας εγκρίθηκε. Το ραντεβού σας είναι ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Η αλλαγή ώρας εγκρίθηκε. Το ραντεβού σας είναι ${datePart}.`);
  } else {
    lines.push('Η αλλαγή ώρας εγκρίθηκε.');
  }

  lines.push('Σας ευχαριστούμε.');

  return lines.join(' ');
}

function buildTimeChangeRejectedMessage(task: TaskRow): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα. Το ραντεβού παραμένει ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα. Το ραντεβού παραμένει ${datePart}.`);
  } else {
    lines.push('Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα.');
  }

  lines.push('Για οποιαδήποτε απορία επικοινωνήστε μαζί μας.');

  return lines.join(' ');
}

// ---------------------------------------------------------------------------
// POST /api/appointment-notifications
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    // Required: taskId
    const taskId = str(raw.taskId);
    if (!taskId) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    // Required: kind
    const kindRaw = str(raw.kind);
    if (!kindRaw) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    if (!(VALID_KINDS as readonly string[]).includes(kindRaw)) {
      return NextResponse.json({ ok: false, error: 'unsupported_kind' }, { status: 400 });
    }
    const kind = kindRaw as NotificationKind;

    // Optional: mode (default 'draft')
    let mode: NotificationMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as NotificationMode;
    }

    // Fetch task (business-scoped)
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, business_id, customer_id, type, status, due_date, due_time')
      .eq('id', taskId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_notification_failed' },
        { status: 500 }
      );
    }

    if (!taskData) {
      return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
    }

    const task = taskData as unknown as TaskRow;

    // Validate task type
    if (!(VALID_TASK_TYPES as readonly string[]).includes(task.type)) {
      return NextResponse.json({ ok: false, error: 'unsupported_task_type' }, { status: 400 });
    }

    // Validate task status: only open tasks can be notified
    if (task.status === 'cancelled' || task.status === 'completed') {
      return NextResponse.json({ ok: false, error: 'appointment_not_sendable' }, { status: 400 });
    }

    // ---------------------------------------------------------------------------
    // Build message text
    // ---------------------------------------------------------------------------

    let messageText: string;
    let tokenId: string | null = null;

    if (kind === 'proposal') {
      // Create appointment response token so the customer can confirm/decline.
      // sentChannel reflects whether we are about to send or just drafting.
      let responseTokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        responseTokenResult = await createAppointmentResponseToken({
          businessId,
          taskId,
          sentChannel: mode === 'send' ? 'viber' : 'manual',
          sentTo: null,
        });
      } catch {
        return NextResponse.json(
          { ok: false, error: 'appointment_notification_failed' },
          { status: 500 }
        );
      }

      tokenId = responseTokenResult.row.id;
      // The response URL is embedded inside the message text only; it is not
      // returned as a standalone field.
      messageText = buildProposalMessage(task, responseTokenResult.responseUrl);
    } else if (kind === 'time_change_approved') {
      messageText = buildTimeChangeApprovedMessage(task);
    } else {
      messageText = buildTimeChangeRejectedMessage(task);
    }

    // ---------------------------------------------------------------------------
    // Draft mode: return message text without calling Apifon
    // ---------------------------------------------------------------------------

    if (mode === 'draft') {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'draft',
        reason: null,
        fallbackMessage: messageText,
      });
    }

    // ---------------------------------------------------------------------------
    // Send mode: look up customer and send via Viber
    // ---------------------------------------------------------------------------

    if (!task.customer_id) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_customer',
        fallbackMessage: messageText,
      });
    }

    const { data: customerData } = await supabase
      .from('customers')
      .select('id, name, mobile_phone, phone')
      .eq('id', task.customer_id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (!customerData) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_customer',
        fallbackMessage: messageText,
      });
    }

    const customer = customerData as unknown as CustomerRow;
    const rawPhone = selectViberPhone(customer);

    if (!rawPhone) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_mobile',
        fallbackMessage: messageText,
      });
    }

    // Validate phone normalizes to a usable MSISDN before calling provider.
    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'missing_mobile',
        fallbackMessage: messageText,
      });
    }

    const referenceId = tokenId
      ? `appt-notif:${businessId.slice(0, 8)}:${tokenId.slice(0, 8)}`
      : `appt-notif:${businessId.slice(0, 8)}:${taskId.slice(0, 8)}`;

    const viberResult = await sendViberMessage({
      phone: rawPhone,
      text: messageText,
      customerId: task.customer_id,
      referenceId,
    });

    if (viberResult.skipped) {
      const skipReason =
        viberResult.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'missing_mobile';
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: skipReason,
        fallbackMessage: messageText,
      });
    }

    if (!viberResult.ok) {
      return NextResponse.json({
        ok: true,
        sent: false,
        channel: 'viber',
        status: 'fallback_required',
        reason: 'provider_failed',
        fallbackMessage: messageText,
      });
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      channel: 'viber',
      status: 'sent',
      reason: null,
      fallbackMessage: null,
      requestId: viberResult.requestId,
      messageId: viberResult.messageId,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_notification_failed' },
      { status: 500 }
    );
  }
}
